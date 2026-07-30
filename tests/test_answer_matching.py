import asyncio
import sys


_original_argv = sys.argv
sys.argv = [sys.argv[0]]
try:
    from lightrag.api.routers.answer_routes import (
        AnswerGuidance,
        AnswerItem,
        AnswerAliasGroup,
        AnswerAliasExpansion,
        ResolveCandidate,
        _answer_vector_content,
        _enrich_answer_guidance_background,
        _expand_query_aliases,
        _guidance_needs_coverage_enrichment,
        _guidance_needs_llm_enrichment,
        _heuristic_guidance_suggestions,
        _keyword_candidate_ids,
        _llm_select_candidate,
        _parse_batch_guidance_suggestions,
        _parse_term_discovery_candidates,
        _score_candidate,
    )
finally:
    sys.argv = _original_argv


def _answer(**updates) -> AnswerItem:
    values = {
        "answer_id": "ANS-TEST",
        "workspace": "faq-test",
        "title": "프린터 출력 문제",
        "body": "프린터 전원과 연결 상태를 확인해 주세요.",
        "approved_summary": "승인 담당자만 보는 내부 메모 문구",
        "status": "published",
    }
    values.update(updates)
    return AnswerItem(**values)


def test_answer_memo_does_not_contribute_to_keyword_score():
    score, matched_guidance, reason, details = _score_candidate(
        _answer(),
        [],
        "승인 담당자만 보는 내부 메모 문구",
    )

    assert score == 0
    assert matched_guidance == []
    assert reason == "weak_match"
    assert not any(key.startswith("summary_") for key in details)


def test_answer_body_still_contributes_to_keyword_score():
    score, _, _, details = _score_candidate(
        _answer(),
        [],
        "프린터 전원",
    )

    assert score > 0
    assert any(key.startswith("body_") for key in details)


def test_builtin_korean_alias_expands_to_english_product_terms():
    class EmptyAliasDatabase:
        async def query(self, sql, params, multirows=False):
            assert "LIGHTRAG_ANSWER_TERM_ALIASES" in sql
            return []

    expansions = asyncio.run(
        _expand_query_aliases(
            EmptyAliasDatabase(),
            "faq-test",
            "팀즈에서 마이크가 동작하지 않아요",
        )
    )

    teams = next(
        item for item in expansions if item.canonical_term == "Microsoft Teams"
    )
    assert teams.matched_term == "팀즈"
    assert "Teams" in teams.expanded_terms
    assert "Microsoft Teams" in teams.expanded_terms


def test_alias_expansion_scores_korean_and_english_product_queries_equally():
    expansion = AnswerAliasExpansion(
        canonical_term="Microsoft Teams",
        matched_term="팀즈",
        expanded_terms=["Microsoft Teams", "Teams", "팀즈"],
        source="builtin",
    )

    score, matched_guidance, reason, details = _score_candidate(
        _answer(
            title="Microsoft Teams 마이크 문제",
            body="Teams 장치 설정에서 마이크를 다시 선택하세요.",
        ),
        [],
        "팀즈 소리가 안 들려요",
        alias_expansions=[expansion],
    )
    english_score, _, _, english_details = _score_candidate(
        _answer(
            title="Microsoft Teams 마이크 문제",
            body="Teams 장치 설정에서 마이크를 다시 선택하세요.",
        ),
        [],
        "Teams 소리가 안 들려요",
        alias_expansions=[
            expansion.model_copy(update={"matched_term": "Teams"})
        ],
    )

    assert score == english_score
    assert details == english_details
    assert any("팀즈" in item and "Teams" in item for item in matched_guidance)
    assert reason != "weak_match"


def test_alias_expansion_prefers_product_faq_over_incidental_body_mention():
    expansion = AnswerAliasExpansion(
        canonical_term="Microsoft Teams",
        matched_term="팀즈",
        expanded_terms=["Microsoft Teams", "Teams", "팀즈"],
        source="builtin",
    )
    product_score, _, _, _ = _score_candidate(
        _answer(
            title="Teams 회의에서 마이크가 인식되지 않음",
            body="Teams 장치 설정에서 마이크를 다시 선택하세요.",
        ),
        [
            _guidance("question", "Teams 회의 연결이 되지 않아요"),
            _guidance("keyword", "Teams 연결 오류"),
        ],
        "팀즈 연결이 안돼.",
        alias_expansions=[expansion],
    )
    incidental_score, _, _, _ = _score_candidate(
        _answer(
            title="Wi-Fi 연결은 되지만 인터넷이 되지 않음",
            body="연결 확인 후 Teams가 정상 동기화되는지 확인하세요.",
        ),
        [],
        "팀즈 연결이 안돼",
        alias_expansions=[expansion],
    )

    assert product_score > incidental_score


def test_answer_memo_is_excluded_from_vector_content_and_hint_suggestions():
    answer = _answer()

    vector_content = _answer_vector_content(answer, [])
    suggestions = _heuristic_guidance_suggestions(answer, [], [], 20)

    assert answer.approved_summary not in vector_content
    assert "Summary:" not in vector_content
    assert all(answer.approved_summary not in item.text for item in suggestions)


def test_answer_memo_is_excluded_from_keyword_candidate_prefilter():
    class CapturingDatabase:
        sql = ""

        async def query(self, sql, params, multirows=False):
            self.sql = sql
            return []

    db = CapturingDatabase()
    asyncio.run(
        _keyword_candidate_ids(
            db,
            "faq-test",
            "내부 메모",
            ["published"],
            None,
        )
    )

    assert "answers.approved_summary" not in db.sql


def test_answer_memo_is_not_sent_to_llm_candidate_selector():
    class CapturingRag:
        prompt = ""

        async def llm_model_func(self, prompt, system_prompt=None):
            self.prompt = prompt
            return '{"answer_id":"ANS-TEST","confidence":0.9,"rationale":"matched"}'

    rag = CapturingRag()
    answer = _answer()
    candidate = ResolveCandidate(
        answer=answer,
        score=0.8,
        reason="title_exact:0.42",
    )

    selected_id, result = asyncio.run(
        _llm_select_candidate(rag, "프린터가 안 돼요", [candidate])
    )

    assert selected_id == answer.answer_id
    assert result["status"] == "llm_ready"
    assert answer.approved_summary not in rag.prompt


def _guidance(guidance_type: str, text: str) -> AnswerGuidance:
    return AnswerGuidance(
        guidance_id=f"agd-{guidance_type}",
        answer_id="ANS-TEST",
        workspace="faq-test",
        guidance_type=guidance_type,
        text=text,
    )


def test_batch_llm_enrichment_targets_only_weak_guidance_by_default():
    assert _guidance_needs_llm_enrichment(
        [_guidance("keyword", "프린터")]
    )
    assert not _guidance_needs_llm_enrichment(
        [
            _guidance("question", "프린터가 출력되지 않아요"),
            _guidance("keyword", "프린터"),
        ]
    )


def test_coverage_enrichment_detects_missing_bilingual_and_spoken_variants():
    answer = _answer(
        title="Microsoft Teams 회의 연결",
        tags=["Teams", "회의"],
    )
    sparse_guidance = [
        _guidance("question", "Microsoft Teams 회의가 연결되지 않습니다"),
        _guidance("keyword", "Teams 회의"),
        _guidance("keyword", "연결 오류"),
    ]
    rich_guidance = [
        _guidance("question", "Microsoft Teams 회의가 연결되지 않습니다"),
        _guidance("question", "팀즈 회의에 못 들어가요"),
        _guidance("keyword", "Teams 회의"),
        _guidance("keyword", "연결 오류"),
        _guidance("synonym", "팀즈"),
        _guidance("synonym", "화상 회의 접속 실패"),
    ]

    assert _guidance_needs_coverage_enrichment(answer, sparse_guidance)
    assert not _guidance_needs_coverage_enrichment(answer, rich_guidance)


def test_batch_llm_suggestions_reject_unknown_ids_and_duplicates():
    raw = """
    [
      {
        "answer_id": "ANS-TEST",
        "suggestions": [
          {"guidance_type": "question", "text": "프린터가 안 돼요", "weight": 1.2},
          {"guidance_type": "keyword", "text": "기존 힌트", "weight": 1.0}
        ]
      },
      {
        "answer_id": "ANS-HALLUCINATED",
        "suggestions": [
          {"guidance_type": "keyword", "text": "잘못된 ID", "weight": 1.0}
        ]
      }
    ]
    """

    parsed = _parse_batch_guidance_suggestions(
        raw,
        {"ANS-TEST"},
        {"ANS-TEST": {"기존 힌트"}},
        max_suggestions=3,
        task_id="task-test",
    )

    assert [item.text for item in parsed["ANS-TEST"]] == ["프린터가 안 돼요"]
    assert parsed["ANS-TEST"][0].metadata["task_id"] == "task-test"


def test_batch_llm_enrichment_processes_only_weak_answers(monkeypatch):
    class FakeTaskService:
        completed_result = None
        progress_updates = []

        def get_task(self, _task_id):
            return None

        async def update_progress(self, _task_id, progress, message, detail=None):
            self.progress_updates.append((progress, message, detail))

        async def complete_task(self, _task_id, result=None):
            self.completed_result = result

    class FakeDatabase:
        inserted = []

        async def query(self, sql, params, multirows=False):
            if "FROM LIGHTRAG_ANSWER_ITEMS" in sql:
                return [
                    {
                        "workspace": "faq-test",
                        "answer_id": "ANS-READY",
                        "title": "프린터 연결",
                        "body": "프린터 전원과 연결 상태를 확인합니다.",
                        "status": "draft",
                        "tags": [],
                        "metadata": {},
                    },
                    {
                        "workspace": "faq-test",
                        "answer_id": "ANS-WEAK",
                        "title": "VPN 연결",
                        "body": "VPN 클라이언트를 다시 실행합니다.",
                        "status": "draft",
                        "tags": [],
                        "metadata": {},
                    },
                ]
            if "FROM LIGHTRAG_ANSWER_GUIDANCE" in sql:
                return [
                    {
                        "guidance_id": "agd-ready-question",
                        "workspace": "faq-test",
                        "answer_id": "ANS-READY",
                        "guidance_type": "question",
                        "text": "프린터가 연결되지 않아요",
                        "weight": 1.2,
                        "metadata": {},
                    },
                    {
                        "guidance_id": "agd-ready-keyword",
                        "workspace": "faq-test",
                        "answer_id": "ANS-READY",
                        "guidance_type": "keyword",
                        "text": "프린터 연결",
                        "weight": 1.0,
                        "metadata": {},
                    },
                    {
                        "guidance_id": "agd-weak-note",
                        "workspace": "faq-test",
                        "answer_id": "ANS-WEAK",
                        "guidance_type": "note",
                        "text": "VPN 클라이언트",
                        "weight": 0.4,
                        "metadata": {},
                    },
                ]
            if "INSERT INTO LIGHTRAG_ANSWER_GUIDANCE" in sql:
                self.inserted.append(params)
                return {
                    "guidance_id": params[0],
                    "workspace": params[1],
                    "answer_id": params[2],
                    "guidance_type": params[3],
                    "text": params[4],
                    "weight": params[5],
                    "metadata": params[6],
                }
            raise AssertionError(f"Unexpected SQL: {sql}")

    class FakeRag:
        prompt = ""

        async def llm_model_func(self, prompt, system_prompt=None):
            self.prompt = prompt
            return """
            [
              {
                "answer_id": "ANS-WEAK",
                "suggestions": [
                  {"guidance_type": "question", "text": "회사 VPN이 접속되지 않아요", "weight": 1.2},
                  {"guidance_type": "keyword", "text": "원격 접속", "weight": 1.0}
                ]
              },
              {
                "answer_id": "ANS-NOT-ALLOWED",
                "suggestions": [
                  {"guidance_type": "keyword", "text": "저장 금지", "weight": 1.0}
                ]
              }
            ]
            """

    service = FakeTaskService()
    database = FakeDatabase()
    rag = FakeRag()
    monkeypatch.setattr(
        "lightrag.api.task_manager.get_task_service",
        lambda: service,
    )

    asyncio.run(
        _enrich_answer_guidance_background(
            task_id="task-enrich",
            workspace="faq-test",
            db=database,
            rag=rag,
            answer_ids=["ANS-READY", "ANS-WEAK"],
            scope="missing_or_weak",
            batch_size=10,
            max_suggestions=3,
        )
    )

    assert "ANS-WEAK" in rag.prompt
    assert "ANS-READY" not in rag.prompt
    assert [params[4] for params in database.inserted] == [
        "회사 VPN이 접속되지 않아요",
        "원격 접속",
    ]
    assert service.completed_result["target_count"] == 1
    assert service.completed_result["skipped_count"] == 1
    assert service.completed_result["guidance_created"] == 2


def test_term_discovery_keeps_only_new_aliases_with_valid_evidence():
    groups = [
        AnswerAliasGroup(
            alias_id="builtin-teams",
            workspace="*",
            canonical_term="Microsoft Teams",
            aliases=["Teams", "팀즈"],
            source="builtin",
        )
    ]
    evidence = {
        "faq:ANS-TEAMS": {
            "ref": "faq:ANS-TEAMS",
            "kind": "faq",
            "answer_id": "ANS-TEAMS",
            "label": "Teams 회의 연결 문제",
        }
    }
    raw = """
    [
      {
        "canonical_term": "Microsoft Teams",
        "aliases": ["Teams", "팀즈앱", "MS팀"],
        "term_type": "synonym",
        "confidence": 0.91,
        "rationale": "사용자가 동일 제품을 부르는 표현입니다.",
        "evidence_refs": ["faq:ANS-TEAMS", "faq:UNKNOWN"]
      }
    ]
    """

    candidates = _parse_term_discovery_candidates(raw, groups, evidence)

    assert len(candidates) == 1
    assert candidates[0]["canonical_term"] == "Microsoft Teams"
    assert candidates[0]["aliases"] == ["팀즈앱", "MS팀"]
    assert candidates[0]["evidence"] == [evidence["faq:ANS-TEAMS"]]


def test_term_discovery_rejects_alias_owned_by_another_term_group():
    groups = [
        AnswerAliasGroup(
            alias_id="workspace-slack",
            workspace="faq-test",
            canonical_term="Slack",
            aliases=["슬랙", "협업 메신저"],
        )
    ]
    raw = """
    [
      {
        "canonical_term": "Microsoft Teams",
        "aliases": ["협업 메신저", "MS 팀"],
        "term_type": "neologism",
        "confidence": 0.86,
        "rationale": "제품명을 줄여 부르는 표현입니다.",
        "evidence_refs": []
      }
    ]
    """

    candidates = _parse_term_discovery_candidates(raw, groups, {})

    assert len(candidates) == 1
    assert candidates[0]["aliases"] == ["MS 팀"]
