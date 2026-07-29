import asyncio
import sys


_original_argv = sys.argv
sys.argv = [sys.argv[0]]
try:
    from lightrag.api.routers.answer_routes import (
        AnswerItem,
        ResolveCandidate,
        _answer_vector_content,
        _heuristic_guidance_suggestions,
        _keyword_candidate_ids,
        _llm_select_candidate,
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
