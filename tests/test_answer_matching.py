import asyncio
import sys


_original_argv = sys.argv
sys.argv = [sys.argv[0]]
try:
    from lightrag.api.routers.answer_routes import (
        AnswerGuidance,
        AnswerGraphConfig,
        AnswerAsset,
        AnswerItem,
        AnswerAliasGroup,
        AnswerAliasExpansion,
        ResolveRequest,
        ResolveCandidate,
        _answer_id_from_graph_node,
        _answer_asset_content_url,
        _answer_vector_content,
        _clarification_question,
        _deterministic_answer_graph_projection,
        _enrich_answer_guidance_background,
        _expand_query_aliases,
        _guidance_needs_coverage_enrichment,
        _guidance_needs_llm_enrichment,
        _graph_result_similarity,
        _heuristic_guidance_suggestions,
        _keyword_candidate_ids,
        _llm_select_candidate,
        _parse_batch_guidance_suggestions,
        _parse_answer_graph_llm_result,
        _parse_term_discovery_candidates,
        _precision_abstention_reason,
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


def test_graph_hybrid_is_an_optional_resolve_mode():
    request = ResolveRequest(query="팀즈 연결이 안돼요", retrieval_mode="graph_hybrid")

    assert request.retrieval_mode == "graph_hybrid"
    assert request.selection_policy == "workspace"


def test_graph_config_has_conservative_precision_defaults():
    config = AnswerGraphConfig(workspace="faq-test")

    assert config.precision_mode is False
    assert config.precision_min_score == 0.35
    assert config.min_score_margin == 0.08
    assert config.min_category_margin == 0.05
    assert config.min_evidence_sources == 2
    assert config.llm_min_confidence == 0.8


def _resolve_candidate(
    answer_id: str,
    score: float,
    *,
    category: str = "유심",
    keyword: float = 0.3,
    vector: float = 0.7,
    graph: float = 0.8,
    selected_by: str = "graph_hybrid",
) -> ResolveCandidate:
    return ResolveCandidate(
        answer=_answer(
            answer_id=answer_id,
            metadata={"category": category},
        ),
        score=score,
        reason="test",
        selected_by=selected_by,
        score_details={
            "keyword_score": keyword,
            "vector_score": vector,
            "graph_score": graph,
        },
    )


def test_precision_policy_accepts_clear_multi_source_candidate():
    selected = _resolve_candidate("ANS-SIM-001", 0.72)
    candidates = [
        selected,
        _resolve_candidate("ANS-SIM-002", 0.52),
        _resolve_candidate("ANS-ROAM-001", 0.41, category="로밍"),
    ]

    reason, diagnostics = _precision_abstention_reason(
        selected,
        candidates,
        ResolveRequest(
            query="유심이 인식되지 않아요",
            retrieval_mode="graph_hybrid",
            selection_policy="precision",
        ),
        AnswerGraphConfig(workspace="faq-test", precision_mode=True),
        {"status": "not_requested"},
    )

    assert reason is None
    assert diagnostics["score_margin"] == 0.2
    assert diagnostics["evidence_sources"] == ["keyword", "vector", "graph"]


def test_precision_policy_accepts_short_query_when_evidence_is_clear():
    selected = _resolve_candidate("ANS-SIM-001", 0.72)

    reason, diagnostics = _precision_abstention_reason(
        selected,
        [selected],
        ResolveRequest(
            query="유심 안돼",
            retrieval_mode="graph_hybrid",
            selection_policy="precision",
        ),
        AnswerGraphConfig(workspace="faq-test", precision_mode=True),
        {"status": "not_requested"},
    )

    assert reason is None
    assert diagnostics["score_margin"] == 0.72


def test_precision_policy_selects_top_candidate_when_categories_are_close():
    selected = _resolve_candidate("ANS-SIM-001", 0.56)
    candidates = [
        selected,
        _resolve_candidate(
            "ANS-PAY-001",
            0.54,
            category="결제",
        ),
    ]

    reason, diagnostics = _precision_abstention_reason(
        selected,
        candidates,
        ResolveRequest(
            query="카드 안돼",
            retrieval_mode="graph_hybrid",
            selection_policy="precision",
        ),
        AnswerGraphConfig(workspace="faq-test", precision_mode=True),
        {"status": "not_requested"},
    )

    assert reason is None
    assert diagnostics["category_margin"] == 0.02
    assert diagnostics["category_competition"] is True


def test_precision_policy_selects_top_candidate_when_same_category_scores_are_close():
    selected = _resolve_candidate("ANS-SIM-001", 0.62)
    candidates = [
        selected,
        _resolve_candidate("ANS-SIM-002", 0.58),
    ]

    reason, diagnostics = _precision_abstention_reason(
        selected,
        candidates,
        ResolveRequest(
            query="유심 인식 문제가 있어요",
            retrieval_mode="graph_hybrid",
            selection_policy="precision",
        ),
        AnswerGraphConfig(workspace="faq-test", precision_mode=True),
        {"status": "not_requested"},
    )

    assert reason is None
    assert diagnostics["score_margin"] == 0.04
    assert diagnostics["candidate_competition"] is True


def test_precision_policy_rejects_single_source_candidate():
    selected = _resolve_candidate(
        "ANS-SIM-001",
        0.72,
        keyword=0.0,
        vector=0.72,
        graph=0.0,
        selected_by="vector",
    )

    reason, diagnostics = _precision_abstention_reason(
        selected,
        [selected],
        ResolveRequest(
            query="카드 교체",
            retrieval_mode="graph_hybrid",
            selection_policy="precision",
        ),
        AnswerGraphConfig(workspace="faq-test", precision_mode=True),
        {"status": "not_requested"},
    )

    assert reason == "insufficient_evidence"
    assert diagnostics["evidence_sources"] == ["vector"]


def test_precision_policy_records_close_category_competition_without_abstaining():
    selected = _resolve_candidate("ANS-SIM-001", 0.62)
    candidates = [
        selected,
        _resolve_candidate("ANS-PORT-001", 0.60, category="번호이동"),
    ]

    reason, diagnostics = _precision_abstention_reason(
        selected,
        candidates,
        ResolveRequest(
            query="번호는 유지하고 유심만 바꿔요",
            retrieval_mode="graph_hybrid",
            selection_policy="precision",
        ),
        AnswerGraphConfig(workspace="faq-test", precision_mode=True),
        {"status": "not_requested"},
    )

    assert reason is None
    assert diagnostics["category_margin"] == 0.02
    assert diagnostics["category_competition"] is True


def test_precision_policy_accepts_close_llm_selected_candidate():
    selected = _resolve_candidate(
        "ANS-SIM-001",
        0.62,
        selected_by="llm_id_selector",
    )
    candidates = [
        selected,
        _resolve_candidate("ANS-SIM-002", 0.58),
    ]

    reason, diagnostics = _precision_abstention_reason(
        selected,
        candidates,
        ResolveRequest(
            query="유심이 인식되지 않아요",
            retrieval_mode="llm_rerank",
            selection_policy="precision",
        ),
        AnswerGraphConfig(workspace="faq-test", enabled=True, precision_mode=True),
        {
            "status": "llm_ready",
            "answer_id": "ANS-SIM-001",
            "confidence": 0.91,
        },
    )

    assert reason is None
    assert diagnostics["llm_confidence"] == 0.91
    assert diagnostics["confident_llm_selection"] is True
    assert diagnostics["candidate_competition"] is True


def test_precision_policy_allows_very_confident_llm_to_use_request_score_floor():
    selected = _resolve_candidate(
        "ANS-SIM-001",
        0.31,
        selected_by="llm_id_selector",
    )

    reason, diagnostics = _precision_abstention_reason(
        selected,
        [selected],
        ResolveRequest(
            query="PUK 잠김",
            min_score=0.25,
            retrieval_mode="llm_rerank",
            selection_policy="precision",
        ),
        AnswerGraphConfig(workspace="faq-test", enabled=True, precision_mode=True),
        {
            "status": "llm_ready",
            "answer_id": "ANS-SIM-001",
            "confidence": 0.95,
        },
    )

    assert reason is None
    assert diagnostics["effective_min_score"] == 0.25


def test_precision_policy_allows_configured_llm_confidence_to_use_request_score_floor():
    selected = _resolve_candidate(
        "ANS-SIM-001",
        0.31,
        selected_by="llm_id_selector",
    )

    reason, diagnostics = _precision_abstention_reason(
        selected,
        [selected],
        ResolveRequest(
            query="PUK 잠김",
            min_score=0.25,
            retrieval_mode="llm_rerank",
            selection_policy="precision",
        ),
        AnswerGraphConfig(workspace="faq-test", enabled=True, precision_mode=True),
        {
            "status": "llm_ready",
            "answer_id": "ANS-SIM-001",
            "confidence": 0.85,
        },
    )

    assert reason is None
    assert diagnostics["effective_min_score"] == 0.25


def test_ambiguous_candidates_produce_a_clarification_question():
    candidates = [
        _resolve_candidate("ANS-SIM-001", 0.52),
        _resolve_candidate("ANS-SIM-002", 0.49),
    ]

    question = _clarification_question(
        candidates,
        "ambiguous_candidates",
        {},
    )

    assert question is not None
    assert "어느 내용인지 알려주세요" in question


def test_llm_clarification_question_takes_precedence():
    question = _clarification_question(
        [_resolve_candidate("ANS-SIM-001", 0.52)],
        "ambiguous_intent",
        {
            "clarification_question": (
                "유심이 인식되지 않는 문제인가요, 개통이 되지 않는 문제인가요?"
            )
        },
    )

    assert question == "유심이 인식되지 않는 문제인가요, 개통이 되지 않는 문제인가요?"


def test_exceptionally_strong_candidate_survives_llm_ambiguity():
    selected = _resolve_candidate("ANS-SIM-008", 0.86)
    candidates = [
        selected,
        _resolve_candidate("ANS-SIM-004", 0.42),
    ]

    reason, diagnostics = _precision_abstention_reason(
        selected,
        candidates,
        ResolveRequest(
            query="유심 배송",
            retrieval_mode="llm_rerank",
            selection_policy="precision",
        ),
        AnswerGraphConfig(workspace="faq-test", enabled=True, precision_mode=True),
        {
            "status": "llm_ready",
            "answer_id": None,
            "confidence": 0.6,
            "decision_reason": "ambiguous",
        },
    )

    assert reason is None
    assert diagnostics["exceptionally_strong_candidate"] is True


def test_regular_candidate_does_not_override_llm_ambiguity():
    selected = _resolve_candidate("ANS-SIM-001", 0.52)
    candidates = [
        selected,
        _resolve_candidate("ANS-SIM-002", 0.38),
    ]

    reason, diagnostics = _precision_abstention_reason(
        selected,
        candidates,
        ResolveRequest(
            query="유심 안돼",
            retrieval_mode="llm_rerank",
            selection_policy="precision",
        ),
        AnswerGraphConfig(workspace="faq-test", enabled=True, precision_mode=True),
        {
            "status": "llm_ready",
            "answer_id": None,
            "confidence": 0.6,
            "decision_reason": "ambiguous",
        },
    )

    assert reason == "ambiguous_intent"
    assert diagnostics["exceptionally_strong_candidate"] is False


def test_precision_policy_rejects_when_llm_is_unavailable():
    selected = _resolve_candidate(
        "ANS-SIM-001",
        0.72,
        selected_by="graph_hybrid",
    )

    reason, diagnostics = _precision_abstention_reason(
        selected,
        [selected],
        ResolveRequest(
            query="유심이 인식되지 않아요",
            retrieval_mode="llm_rerank",
            selection_policy="precision",
        ),
        AnswerGraphConfig(workspace="faq-test", enabled=True, precision_mode=True),
        {
            "status": "llm_failed",
            "error": "temporary provider timeout",
        },
    )

    assert reason == "llm_unavailable"
    assert diagnostics["llm_status"] == "llm_failed"


def test_precision_policy_respects_llm_no_match():
    selected = _resolve_candidate(
        "ANS-SIM-001",
        0.72,
        selected_by="graph_hybrid",
    )

    reason, _ = _precision_abstention_reason(
        selected,
        [selected],
        ResolveRequest(
            query="노트북 배터리를 교체하고 싶어요",
            retrieval_mode="llm_rerank",
            selection_policy="precision",
        ),
        AnswerGraphConfig(workspace="faq-test", enabled=True, precision_mode=True),
        {
            "status": "llm_ready",
            "answer_id": None,
            "confidence": 0.95,
        },
    )

    assert reason == "llm_no_match"


def test_graph_similarity_uses_backend_score_instead_of_result_rank():
    config = AnswerGraphConfig(workspace="faq-test")

    assert config.min_similarity == 0.60
    assert _graph_result_similarity({"similarity": 0.72, "distance": 0.1}) == 0.72
    assert _graph_result_similarity({"distance": 0.38}) == 0.38
    assert _graph_result_similarity({}) == 0.0


def test_deterministic_faq_graph_uses_answer_hints_metadata_and_aliases():
    answer = _answer(
        answer_id="ANS-TEAMS",
        title="Teams 회의에서 마이크가 인식되지 않음",
        body="Teams 장치 설정에서 마이크를 다시 선택하세요.",
        tags=["회의", "협업 도구"],
        metadata={
            "product": "Microsoft Teams",
            "symptoms": ["마이크 인식 실패", "회의 연결 오류"],
        },
    )
    guidance = [
        AnswerGuidance(
            guidance_id="agd-question",
            answer_id=answer.answer_id,
            workspace=answer.workspace,
            guidance_type="question",
            text="팀즈 연결이 안돼요",
        ),
        AnswerGuidance(
            guidance_id="agd-negative",
            answer_id=answer.answer_id,
            workspace=answer.workspace,
            guidance_type="negative_keyword",
            text="프린터",
        ),
    ]
    aliases = [
        AnswerAliasGroup(
            alias_id="alias-teams",
            workspace=answer.workspace,
            canonical_term="Microsoft Teams",
            aliases=["Teams", "팀즈"],
        )
    ]

    nodes, relations = _deterministic_answer_graph_projection(
        answer,
        guidance,
        aliases,
        AnswerGraphConfig(workspace=answer.workspace),
    )

    node_labels = {(node.entity_type, node.label) for node in nodes}
    relation_types = {relation.relation_type for relation in relations}
    assert ("FAQAnswer", answer.title) in node_labels
    assert ("Intent", "팀즈 연결이 안돼요") in node_labels
    assert ("Product", "Microsoft Teams") in node_labels
    assert ("Symptom", "마이크 인식 실패") in node_labels
    assert ("Term", "팀즈") in node_labels
    assert ("Term", "프린터") not in node_labels
    assert {"REPRESENTS_QUESTION", "APPLIES_TO", "HAS_SYMPTOM", "ALIAS_OF"} <= relation_types
    answer_relation = next(
        relation
        for relation in relations
        if _answer_id_from_graph_node(relation.source_id) == answer.answer_id
    )
    assert answer_relation.source_id.startswith("FAQ::FAQANSWER::")


def test_llm_faq_graph_result_is_bounded_by_workspace_schema():
    config = AnswerGraphConfig(
        workspace="faq-test",
        entity_types=["FAQAnswer", "Product", "Symptom"],
        relation_types=["APPLIES_TO", "HAS_SYMPTOM"],
    )
    raw = """
    {
      "entities": [
        {"type": "Product", "label": "Microsoft Teams"},
        {"type": "Secret", "label": "should-not-be-stored"}
      ],
      "relations": [
        {
          "source_type": "FAQAnswer",
          "source_label": "ANS-TEAMS",
          "target_type": "Product",
          "target_label": "Microsoft Teams",
          "type": "APPLIES_TO"
        },
        {
          "source_type": "FAQAnswer",
          "source_label": "ANS-TEAMS",
          "target_type": "Secret",
          "target_label": "should-not-be-stored",
          "type": "LEAKS"
        }
      ]
    }
    """

    nodes, relations = _parse_answer_graph_llm_result(raw, config)

    assert [(node.entity_type, node.label) for node in nodes] == [
        ("Product", "Microsoft Teams")
    ]
    assert len(relations) == 1
    assert relations[0].relation_type == "APPLIES_TO"


def test_answer_body_still_contributes_to_keyword_score():
    score, _, _, details = _score_candidate(
        _answer(),
        [],
        "프린터 전원",
    )

    assert score > 0
    assert any(key.startswith("body_") for key in details)


def test_exact_negative_guidance_blocks_the_candidate():
    score, matched_guidance, reason, details = _score_candidate(
        _answer(),
        [
            AnswerGuidance(
                guidance_id="agd-negative",
                answer_id="ANS-TEST",
                workspace="faq-test",
                guidance_type="negative_keyword",
                text="토너",
                weight=1.2,
            )
        ],
        "프린터 토너 구매처를 알려주세요",
    )

    assert score == 0
    assert matched_guidance == ["!토너"]
    assert reason == "blocked_by_negative_guidance"
    assert details["negative_block"] == -1.0


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


def test_answer_asset_description_contributes_to_keyword_and_vector_search():
    asset = AnswerAsset(
        asset_id="asset-guide",
        workspace="faq-test",
        answer_id="ANS-TEST",
        asset_type="image",
        storage_type="external",
        storage_uri="https://example.com/sim-guide.png",
        caption="유심 교체 설정 화면",
        alt_text="휴대폰 유심 관리 메뉴에서 교체 신청 버튼을 선택하는 화면",
        search_text="SIM 카드 변경 메뉴 QR 코드",
    )
    answer = _answer(assets=[asset])

    score, _, reason, details = _score_candidate(
        answer,
        [],
        "SIM 카드 변경 메뉴를 보여주세요",
    )
    vector_content = _answer_vector_content(answer, [])

    assert score > 0
    assert reason != "weak_match"
    assert details["asset_overlap"] > 0
    assert "유심 교체 설정 화면" in vector_content
    assert "SIM 카드 변경 메뉴 QR 코드" in vector_content


def test_answer_asset_content_url_distinguishes_external_and_local_storage():
    external = {
        "asset_id": "asset-external",
        "answer_id": "ANS-TEST",
        "storage_type": "external",
        "storage_uri": "https://example.com/guide.png",
    }
    local = {
        "asset_id": "asset-local",
        "answer_id": "ANS-TEST",
        "storage_type": "local",
        "storage_uri": "faq-test/ANS-TEST/asset-local/guide.png",
    }

    assert _answer_asset_content_url(external) == "https://example.com/guide.png"
    assert _answer_asset_content_url(local) == (
        "/api/answers/ANS-TEST/assets/asset-local/content"
    )


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
        system_prompt = ""

        async def llm_model_func(self, prompt, system_prompt=None):
            self.prompt = prompt
            self.system_prompt = system_prompt or ""
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
    assert "Do not reject a query merely because it is short" in rag.system_prompt
    assert "never fill in an omitted product" in rag.system_prompt


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
