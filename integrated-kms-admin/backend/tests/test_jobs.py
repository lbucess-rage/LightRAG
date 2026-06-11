import asyncio

import httpx

from kms_admin.routers import jobs
from kms_admin.routers.jobs import (
    _job_metadata,
    _normalize_event_row,
    _normalize_job_row,
    _should_persist_stream_event,
    _stream_event_message,
    _track_summary,
)
from kms_admin.routers import knowledge


def test_track_summary_keeps_safe_document_fields_and_cleans_strings():
    summary = _track_summary(
        {
            "track_id": "track-1",
            "total_count": 1,
            "documents": [
                {
                    "id": "doc-1",
                    "status": "processed",
                    "file_path": "source\x00name.txt",
                    "content": "large body should not be returned",
                    "chunks": ["chunk body should not be returned"],
                }
            ],
        }
    )

    assert summary["track_id"] == "track-1"
    assert summary["documents"] == [
        {"id": "doc-1", "status": "processed", "file_path": "source name.txt"}
    ]


def test_job_json_fields_are_normalized_from_strings():
    job = _normalize_job_row(
        {
            "job_id": "job-1",
            "metadata": '{"tasks":[{"task_id":"task-1"}],"request_data":{"title":"문서"}}',
        }
    )
    event = _normalize_event_row(
        {
            "event_id": "event-1",
            "detail": '{"rollback_status":"completed","documents":["doc-1"]}',
        }
    )

    assert _job_metadata({"metadata": "not-json"}) == {}
    assert job["metadata"]["tasks"] == [{"task_id": "task-1"}]
    assert job["metadata"]["request_data"]["title"] == "문서"
    assert event["detail"] == {"rollback_status": "completed", "documents": ["doc-1"]}


def test_stream_event_persistence_policy_samples_progress_and_terminal_states():
    assert _should_persist_stream_event({"progress": 0}, None) is True
    assert _should_persist_stream_event({"progress": 3}, 0) is False
    assert _should_persist_stream_event({"progress": 5}, 0) is True
    assert _should_persist_stream_event({"progress": 100}, 98) is True
    assert _should_persist_stream_event({"status": "completed", "progress": 100}, 98) is True
    assert _should_persist_stream_event({"status": "failed"}, 20) is True
    assert _should_persist_stream_event({"event": "error"}, 20) is True
    assert _stream_event_message({"message": "done"}, "fallback") == "done"
    assert _stream_event_message({}, "fallback") == "fallback"


def test_immediate_doc_refs_are_created_from_direct_lightrag_response(monkeypatch):
    calls = []

    class FakeDb:
        async def execute(self, query, *params):
            calls.append((query, params))

    monkeypatch.setattr(knowledge, "db", FakeDb())

    created = asyncio.run(
        knowledge._create_immediate_doc_refs(
            "item-1",
            "kevcs",
            {
                "doc_id": "doc-a",
                "doc_ids": ["doc-b", "doc-a"],
                "documents": [{"id": "doc-c"}, {"id": "doc-b"}],
            },
        )
    )

    assert created is True
    inserted_doc_ids = [params[5] for query, params in calls if "INSERT INTO KMS_ADMIN_KNOWLEDGE_REFS" in query]
    assert inserted_doc_ids == ["doc-a", "doc-b", "doc-c"]
    assert any("UPDATE KMS_ADMIN_KNOWLEDGE_ITEMS SET status = 'ready'" in query for query, _ in calls)


def test_sync_file_label_ref_finds_url_document_without_track(monkeypatch):
    calls = []

    class FakeDb:
        async def fetchrow(self, query, *params):
            return None

        async def execute(self, query, *params):
            calls.append((query, params))

    class FakeLightRagClient:
        async def request_json(self, method, path, workspace=None, json_body=None):
            assert method == "POST"
            assert path == "/documents/paginated"
            assert workspace == "kevcs"
            return {
                "documents": [
                    {"id": "doc-a", "file_path": "other"},
                    {"id": "doc-url", "file_path": "url-label", "status": "processed"},
                ]
            }

    monkeypatch.setattr(jobs, "db", FakeDb())
    monkeypatch.setattr(jobs, "lightrag_client", FakeLightRagClient())

    track = asyncio.run(
        jobs._sync_file_label_ref(
            {"item_id": "item-1", "kms_workspace": "kevcs"},
            {"metadata": {"file_path_label": "url-label"}},
        )
    )

    assert track is not None
    assert track["documents"] == [{"id": "doc-url", "file_path": "url-label", "status": "processed"}]
    inserted_doc_ids = [params[3] for query, params in calls if "INSERT INTO KMS_ADMIN_KNOWLEDGE_REFS" in query]
    assert inserted_doc_ids == ["doc-url"]


def test_sync_file_label_ref_uses_request_data_fallback(monkeypatch):
    calls = []

    class FakeDb:
        async def fetchrow(self, query, *params):
            return None

        async def execute(self, query, *params):
            calls.append((query, params))

    class FakeLightRagClient:
        async def request_json(self, method, path, workspace=None, json_body=None):
            return {"documents": [{"id": "doc-mm", "file_path": "multimodal-label"}]}

    monkeypatch.setattr(jobs, "db", FakeDb())
    monkeypatch.setattr(jobs, "lightrag_client", FakeLightRagClient())

    track = asyncio.run(
        jobs._sync_file_label_ref(
            {
                "item_id": "item-1",
                "kms_workspace": "kevcs",
                "metadata": {"request_data": {"file_path_label": "multimodal-label"}},
            },
            {"metadata": {}},
        )
    )

    assert track["documents"] == [{"id": "doc-mm", "file_path": "multimodal-label"}]
    inserted_doc_ids = [params[3] for query, params in calls if "INSERT INTO KMS_ADMIN_KNOWLEDGE_REFS" in query]
    assert inserted_doc_ids == ["doc-mm"]


def test_sync_job_tracks_all_batch_tasks(monkeypatch):
    calls = []

    class FakeDb:
        async def fetchrow(self, query, *params):
            return None

        async def execute(self, query, *params):
            calls.append((query, params))

    class FakeLightRagClient:
        async def request_json(self, method, path, workspace=None, json_body=None):
            if method == "GET" and path == "/api/tasks/t1":
                return {"task_id": "t1", "status": "completed", "progress": 100, "metadata": {"file_path_label": "label-1"}}
            if method == "GET" and path == "/api/tasks/t2":
                return {"task_id": "t2", "status": "completed", "progress": 100, "metadata": {"file_path_label": "label-2"}}
            if method == "POST" and path == "/documents/paginated":
                return {
                    "documents": [
                        {"id": "doc-1", "file_path": "label-1"},
                        {"id": "doc-2", "file_path": "label-2"},
                    ]
                }
            raise AssertionError(f"unexpected request {method} {path}")

    monkeypatch.setattr(jobs, "db", FakeDb())
    monkeypatch.setattr(jobs, "lightrag_client", FakeLightRagClient())

    synced = asyncio.run(
        jobs._sync_job(
            {
                "job_id": "job-1",
                "item_id": "item-1",
                "job_type": "ingest_url_batch",
                "status": "running",
                "progress": 0,
                "kms_workspace": "kevcs",
                "metadata": {"tasks": [{"task_id": "t1"}, {"task_id": "t2"}]},
            }
        )
    )

    assert synced["status"] == "completed"
    assert synced["progress"] == 100
    assert [task["task_id"] for task in synced["tasks"]] == ["t1", "t2"]
    assert len(synced["track"]["documents"]) == 2
    inserted_doc_ids = [params[3] for query, params in calls if "INSERT INTO KMS_ADMIN_KNOWLEDGE_REFS" in query]
    assert inserted_doc_ids == ["doc-1", "doc-2"]


def test_sync_job_completes_running_task_when_document_ref_is_found(monkeypatch):
    calls = []

    class FakeDb:
        async def fetchrow(self, query, *params):
            return None

        async def execute(self, query, *params):
            calls.append((query, params))

    class FakeLightRagClient:
        async def request_json(self, method, path, workspace=None, json_body=None):
            if method == "GET" and path == "/api/tasks/task-1":
                return {
                    "task_id": "task-1",
                    "status": "running",
                    "progress": 5,
                    "message": "Parsing manual.pdf...",
                    "metadata": {},
                }
            if method == "POST" and path == "/documents/paginated":
                return {
                    "documents": [
                        {"id": "doc-pdf", "file_path": "pdf 지식 테스트", "status": "processed"},
                    ]
                }
            raise AssertionError(f"unexpected request {method} {path}")

    monkeypatch.setattr(jobs, "db", FakeDb())
    monkeypatch.setattr(jobs, "lightrag_client", FakeLightRagClient())

    synced = asyncio.run(
        jobs._sync_job(
            {
                "job_id": "job-1",
                "item_id": "item-1",
                "job_type": "ingest_multimodal",
                "status": "running",
                "progress": 5,
                "lightrag_task_id": "task-1",
                "kms_workspace": "kevcs",
                "metadata": {"request_data": {"file_path_label": "pdf 지식 테스트"}},
            }
        )
    )

    assert synced["status"] == "completed"
    assert synced["progress"] == 100
    assert synced["track"]["documents"] == [{"id": "doc-pdf", "file_path": "pdf 지식 테스트", "status": "processed"}]
    inserted_doc_ids = [params[3] for query, params in calls if "INSERT INTO KMS_ADMIN_KNOWLEDGE_REFS" in query]
    assert inserted_doc_ids == ["doc-pdf"]
    assert any("UPDATE KMS_ADMIN_JOBS" in query and params[1] == "completed" for query, params in calls)
    assert any("UPDATE KMS_ADMIN_KNOWLEDGE_ITEMS SET status = $2" in query and params[1] == "ready" for query, params in calls)


def test_sync_job_uses_track_id_even_without_task_id(monkeypatch):
    calls = []

    class FakeDb:
        async def fetchrow(self, query, *params):
            return None

        async def execute(self, query, *params):
            calls.append((query, params))

    class FakeLightRagClient:
        async def request_json(self, method, path, workspace=None, json_body=None):
            assert method == "GET"
            assert path == "/documents/track_status/track-1"
            assert workspace == "kevcs"
            return {
                "track_id": "track-1",
                "documents": [{"id": "doc-1", "file_path": "source-1"}],
                "total_count": 1,
            }

    monkeypatch.setattr(jobs, "db", FakeDb())
    monkeypatch.setattr(jobs, "lightrag_client", FakeLightRagClient())

    synced = asyncio.run(
        jobs._sync_job(
            {
                "job_id": "job-1",
                "item_id": "item-1",
                "job_type": "ingest_text",
                "status": "running",
                "progress": 0,
                "kms_workspace": "kevcs",
                "metadata": {"track_id": "track-1"},
            }
        )
    )

    assert synced["status"] == "completed"
    assert synced["progress"] == 100
    assert synced["track"]["documents"] == [{"id": "doc-1", "file_path": "source-1"}]
    inserted_doc_ids = [params[3] for query, params in calls if "INSERT INTO KMS_ADMIN_KNOWLEDGE_REFS" in query]
    assert inserted_doc_ids == ["doc-1"]


def test_wait_document_removed_polls_until_preview_returns_404(monkeypatch):
    class FakeLightRagClient:
        def __init__(self):
            self.calls = 0

        async def request_json(self, method, path, workspace=None, json_body=None, timeout=120.0):
            assert method == "GET"
            assert path == "/documents/doc-1/preview"
            assert workspace == "kevcs"
            self.calls += 1
            if self.calls == 1:
                return {"id": "doc-1"}
            request = httpx.Request(method, "http://lightrag.test/documents/doc-1/preview")
            response = httpx.Response(404, request=request)
            raise httpx.HTTPStatusError("not found", request=request, response=response)

    client = FakeLightRagClient()
    monkeypatch.setattr(jobs, "lightrag_client", client)

    removed = asyncio.run(
        jobs._wait_document_removed(
            "kevcs",
            "doc-1",
            attempts=2,
            delay_seconds=0,
        )
    )

    assert removed is True
    assert client.calls == 2


def test_rollback_refs_keeps_document_ref_when_delete_is_not_confirmed(monkeypatch):
    calls = []

    class FakeDb:
        async def fetch(self, query, *params):
            return [
                {
                    "ref_id": "ref-1",
                    "ref_type": "doc_id",
                    "workspace_type": "kms",
                    "workspace": "kevcs",
                    "external_id": "doc-1",
                }
            ]

        async def execute(self, query, *params):
            calls.append((query, params))

    class FakeLightRagClient:
        async def request_json(self, method, path, workspace=None, json_body=None):
            assert method == "DELETE"
            assert path == "/documents/delete_document"
            assert workspace == "kevcs"
            assert json_body["doc_ids"] == ["doc-1"]
            return {"status": "deletion_started"}

    async def fake_wait_document_removed(workspace, doc_id):
        assert workspace == "kevcs"
        assert doc_id == "doc-1"
        return False

    monkeypatch.setattr(jobs, "db", FakeDb())
    monkeypatch.setattr(jobs, "lightrag_client", FakeLightRagClient())
    monkeypatch.setattr(jobs, "_wait_document_removed", fake_wait_document_removed)

    rollback = asyncio.run(jobs._rollback_refs({"item_id": "item-1"}))

    assert rollback["removed_refs"] == 0
    assert rollback["documents"] == []
    assert rollback["errors"] == [
        {
            "ref_id": "ref-1",
            "external_id": "doc-1",
            "status_code": "delete_not_confirmed",
        }
    ]
    assert not any("DELETE FROM KMS_ADMIN_KNOWLEDGE_REFS" in query for query, _ in calls)


def test_cleanup_replaced_document_deletes_previous_after_new_doc_is_ready(monkeypatch):
    calls = []
    events = []

    class FakeDb:
        async def execute(self, query, *params):
            calls.append((query, params))

    class FakeLightRagClient:
        async def request_json(self, method, path, workspace=None, json_body=None):
            assert method == "DELETE"
            assert path == "/documents/delete_document"
            assert workspace == "kevcs"
            assert json_body["doc_ids"] == ["doc-old"]
            return {"status": "deletion_started"}

    async def fake_wait_document_removed(workspace, doc_id):
        assert workspace == "kevcs"
        assert doc_id == "doc-old"
        return True

    async def fake_job_event(job_id, event_type, message, detail=None):
        events.append((job_id, event_type, message, detail))

    monkeypatch.setattr(jobs, "db", FakeDb())
    monkeypatch.setattr(jobs, "lightrag_client", FakeLightRagClient())
    monkeypatch.setattr(jobs, "_wait_document_removed", fake_wait_document_removed)
    monkeypatch.setattr(jobs, "_job_event", fake_job_event)

    metadata = asyncio.run(
        jobs._cleanup_replaced_document(
            {"job_id": "job-1", "item_id": "item-new", "kms_workspace": "kevcs"},
            {
                "replacement": {
                    "previous_doc_id": "doc-old",
                    "delete_previous": True,
                    "previous_workspace": "kevcs",
                }
            },
            [{"id": "doc-new"}],
        )
    )

    assert metadata["replacement"]["previous_delete_status"] == "completed"
    assert metadata["replacement"]["new_doc_ids"] == ["doc-new"]
    assert any("UPDATE KMS_ADMIN_KNOWLEDGE_ITEMS" in query for query, _ in calls)
    assert events[0][1] == "replacement"


def test_cleanup_replaced_document_skips_same_doc_id(monkeypatch):
    events = []

    class FakeLightRagClient:
        async def request_json(self, method, path, workspace=None, json_body=None):
            raise AssertionError("same doc replacement must not delete the document")

    async def fake_job_event(job_id, event_type, message, detail=None):
        events.append((job_id, event_type, message, detail))

    monkeypatch.setattr(jobs, "lightrag_client", FakeLightRagClient())
    monkeypatch.setattr(jobs, "_job_event", fake_job_event)

    metadata = asyncio.run(
        jobs._cleanup_replaced_document(
            {"job_id": "job-1", "item_id": "item-new", "kms_workspace": "kevcs"},
            {
                "replacement": {
                    "previous_doc_id": "doc-old",
                    "delete_previous": True,
                    "previous_workspace": "kevcs",
                }
            },
            [{"id": "doc-old"}],
        )
    )

    assert metadata["replacement"]["previous_delete_status"] == "skipped_same_document"
    assert events[0][1] == "replacement"
