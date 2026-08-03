import asyncio
import json
from datetime import UTC, datetime

from kms_admin.routers import knowledge
from kms_admin.routers.knowledge import (
    BoardViewProxyRequest,
    FaqCandidateSearchRequest,
    FaqStructuredMaterializeRequest,
    FaqAnswerUpdateRequest,
    _create_completed_faq_job,
    _faq_answer_update_body,
    _link_materialized_faq_answers,
    _materialized_answer_ids,
)


def test_faq_answer_update_body_serializes_datetimes_for_lightrag():
    payload = FaqAnswerUpdateRequest(
        title="검증 FAQ",
        valid_from=datetime(2026, 6, 10, 0, 0, tzinfo=UTC),
        valid_until=datetime(2026, 6, 17, 0, 0, tzinfo=UTC),
        tags=["verify"],
    )

    body = _faq_answer_update_body(payload)

    assert body == {
        "title": "검증 FAQ",
        "valid_from": "2026-06-10T00:00:00Z",
        "valid_until": "2026-06-17T00:00:00Z",
        "tags": ["verify"],
    }


def test_completed_faq_job_records_answer_ref_and_full_progress(monkeypatch):
    calls = []

    class FakeDb:
        async def fetchrow(self, query, *params):
            assert "KMS_ADMIN_KNOWLEDGE_ITEMS" in query
            assert params == ("item-1",)
            return {"tenant_id": "default"}

        async def execute(self, query, *params):
            calls.append((query, params))

    monkeypatch.setattr(knowledge, "db", FakeDb())

    job_id = asyncio.run(
        _create_completed_faq_job(
            item_id="item-1",
            job_type="faq_answer",
            faq_workspace="faq-ws",
            answer_id="answer-1",
            response={"answer_id": "answer-1", "title": "FAQ"},
            message="FAQ 답변 등록 완료",
        )
    )

    assert job_id
    insert = next((params for query, params in calls if "INSERT INTO KMS_ADMIN_JOBS" in query), None)
    assert insert is not None
    assert insert[2] == "item-1"
    assert insert[3] == "faq_answer"
    assert insert[4] == "completed"
    assert insert[6] == 100.0
    assert insert[7] == "FAQ 답변 등록 완료"
    metadata = json.loads(insert[8])
    assert metadata["workspace"] == "faq-ws"
    assert metadata["answer_id"] == "answer-1"
    assert metadata["faq_response"]["title"] == "FAQ"


def test_board_view_proxy_uses_effective_kms_workspace(monkeypatch):
    calls = []

    class FakeLightRagClient:
        async def request_json(self, method, path, *, workspace=None, json_body=None, **kwargs):
            calls.append((method, path, workspace, json_body))
            return {"success": True, "title": "게시글", "body": "본문"}

    monkeypatch.setattr(knowledge, "lightrag_client", FakeLightRagClient())

    response = asyncio.run(
        knowledge.view_board_knowledge_source(
            BoardViewProxyRequest(file_path="https://kevcs-ap.lbucess.com/api/board/post-1"),
            user={"role": "admin", "kms_workspace": "base"},
            kms_workspace="kevcs",
        )
    )

    assert response["success"] is True
    assert calls == [
        (
            "POST",
            "/api/board/view",
            "kevcs",
            {"file_path": "https://kevcs-ap.lbucess.com/api/board/post-1"},
        )
    ]


def test_faq_candidate_search_defaults_to_hybrid():
    payload = FaqCandidateSearchRequest(query="팀즈 연결이 안 돼요")

    assert payload.retrieval_mode == "hybrid"


def test_materialized_answer_ids_prefers_complete_snapshot():
    answer_ids = _materialized_answer_ids(
        {
            "snapshot": {
                "created_answer_ids": ["ANS-1", "ANS-2", "ANS-3"],
            },
            "answers": [{"answer_id": "ANS-1"}],
        }
    )

    assert answer_ids == ["ANS-1", "ANS-2", "ANS-3"]


def test_link_materialized_faq_answers_bulk_inserts_all_snapshot_ids(monkeypatch):
    operations = []

    class FakeDb:
        async def execute_many_transaction(self, requested_operations):
            operations.extend(requested_operations)

    monkeypatch.setattr(knowledge, "db", FakeDb())

    linked = asyncio.run(
        _link_materialized_faq_answers(
            response={
                "snapshot": {
                    "created_answer_ids": ["ANS-1", "ANS-2", "ANS-3"],
                    "source_uri": "file://sample.xlsx",
                },
                "answers": [
                    {
                        "answer_id": "ANS-1",
                        "title": "Teams 연결 오류",
                        "approved_summary": "Teams 연결 문제 처리",
                    }
                ],
                "guidance_enrichment_task_id": "task-guidance",
            },
            payload=FaqStructuredMaterializeRequest(
                raw_content='[{"id":"1","question":"Teams 연결이 안 돼요"}]',
                title="IT 헬프데스크",
                tenant_id="tenant-1",
            ),
            user={
                "user_id": "manager-1",
                "role": "manager",
                "tenant_id": "tenant-1",
                "kms_workspace": "kms-1",
            },
            faq_workspace="faq-1",
            source_label="sample.xlsx",
        )
    )

    assert linked["answer_ids"] == ["ANS-1", "ANS-2", "ANS-3"]
    assert linked["linked_count"] == 3
    assert linked["task_ids"] == ["task-guidance"]
    assert len(operations) == 3
    item_rows = operations[0][1]
    ref_rows = operations[1][1]
    job_rows = operations[2][1]
    assert len(item_rows) == len(ref_rows) == len(job_rows) == 3
    assert [row[5] for row in ref_rows] == ["ANS-1", "ANS-2", "ANS-3"]
    assert job_rows[0][3] == "faq_structured_batch"
    assert job_rows[0][4] == "running"
    assert job_rows[1][3] == "faq_structured_answer"
    assert job_rows[1][4] == "completed"
