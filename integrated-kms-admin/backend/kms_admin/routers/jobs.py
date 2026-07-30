from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from ..config import settings
from ..db import db
from ..dependencies import audit_log, get_current_user
from ..lightrag_client import lightrag_client

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def _job_status_from_task(status: str | None) -> str:
    if status in {"completed", "failed", "cancelled"}:
        return status
    return "running"


def _clean_json_value(value: Any) -> Any:
    if isinstance(value, str):
        return "".join(char if char >= " " or char in "\n\r\t" else " " for char in value)
    if isinstance(value, list):
        return [_clean_json_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _clean_json_value(item) for key, item in value.items()}
    return value


def _track_summary(track: dict[str, Any]) -> dict[str, Any]:
    document_keys = {
        "id",
        "file_path",
        "file_source",
        "status",
        "created_at",
        "updated_at",
        "chunks_count",
        "error",
        "track_id",
    }
    summary = {key: value for key, value in track.items() if key != "documents"}
    documents = []
    for doc in track.get("documents") or []:
        if isinstance(doc, dict):
            documents.append({key: doc.get(key) for key in document_keys if key in doc})
    summary["documents"] = documents
    return _clean_json_value(summary)


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _job_metadata(job: dict[str, Any]) -> dict[str, Any]:
    return _json_object(job.get("metadata"))


def _job_workspace(job: dict[str, Any], metadata: dict[str, Any] | None = None) -> str:
    metadata = metadata or _job_metadata(job)
    metadata_workspace = str(metadata.get("workspace") or "").strip()
    if metadata_workspace:
        return metadata_workspace
    if str(job.get("job_type") or "").startswith("faq_") and job.get("faq_workspace"):
        return str(job["faq_workspace"])
    return str(
        job.get("kms_workspace")
        or job.get("faq_workspace")
        or settings.default_kms_workspace
    )


def _normalize_job_row(row: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(row)
    normalized["metadata"] = _job_metadata(normalized)
    return normalized


def _normalize_event_row(row: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(row)
    normalized["detail"] = _json_object(normalized.get("detail"))
    return normalized


def _task_ids_for_job(job: dict[str, Any], metadata: dict[str, Any]) -> list[str]:
    task_ids: list[str] = []
    if job.get("lightrag_task_id"):
        task_ids.append(job["lightrag_task_id"])
    for task_info in metadata.get("tasks") or []:
        if isinstance(task_info, dict) and task_info.get("task_id"):
            task_ids.append(task_info["task_id"])
    return list(dict.fromkeys(task_ids))


def _combined_status(tasks: list[dict[str, Any]], fallback: str) -> str:
    statuses = [task.get("status") for task in tasks]
    if not statuses:
        return fallback
    if any(status == "failed" for status in statuses):
        return "failed"
    if all(status == "cancelled" for status in statuses):
        return "cancelled"
    if all(status == "completed" for status in statuses):
        return "completed"
    return "running"


def _combined_progress(tasks: list[dict[str, Any]], fallback: float) -> float:
    progresses = [float(task.get("progress") or 0) for task in tasks]
    if not progresses:
        return fallback
    return sum(progresses) / len(progresses)


def _progress_value(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _stream_event_message(event: dict[str, Any], fallback: str) -> str:
    message = event.get("message") or event.get("detail") or event.get("status") or event.get("event")
    return str(message or fallback)


def _should_persist_stream_event(
    event: dict[str, Any],
    last_progress: float | None,
    *,
    step: float = 5.0,
) -> bool:
    status = event.get("status")
    if event.get("event") == "error" or status in {"completed", "failed", "cancelled"}:
        return True
    progress = _progress_value(event.get("progress"))
    if progress is None:
        return False
    if last_progress is None:
        return True
    return progress >= 100 or progress - last_progress >= step


async def _document_exists(workspace: str, doc_id: str) -> bool:
    try:
        await lightrag_client.request_json(
            "GET",
            f"/documents/{doc_id}/preview",
            workspace=workspace,
            timeout=20.0,
        )
        return True
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            return False
        response = await lightrag_client.request_json(
            "POST",
            "/documents/paginated",
            workspace=workspace,
            json_body={
                "page": 1,
                "page_size": 200,
                "sort_field": "updated_at",
                "sort_direction": "desc",
            },
        )
        return any(doc.get("id") == doc_id for doc in response.get("documents") or [])


async def _wait_document_removed(
    workspace: str,
    doc_id: str,
    *,
    attempts: int = 8,
    delay_seconds: float = 0.75,
) -> bool:
    for attempt in range(attempts):
        if not await _document_exists(workspace, doc_id):
            return True
        if attempt < attempts - 1:
            await asyncio.sleep(delay_seconds)
    return False


async def _upsert_doc_ref(item_id: str, workspace: str, doc: dict[str, Any]) -> None:
    doc_id = doc.get("id")
    if not doc_id:
        return
    existing = await db.fetchrow(
        """
        SELECT ref_id FROM KMS_ADMIN_KNOWLEDGE_REFS
        WHERE item_id = $1 AND workspace_type = 'kms' AND ref_type = 'doc_id' AND external_id = $2
        """,
        item_id,
        doc_id,
    )
    if existing:
        return
    await db.execute(
        """
        INSERT INTO KMS_ADMIN_KNOWLEDGE_REFS(
            ref_id, item_id, ref_type, workspace_type, workspace, external_id, metadata
        )
        VALUES($1, $2, 'doc_id', 'kms', $3, $4, $5::jsonb)
        """,
        str(uuid.uuid4()),
        item_id,
        workspace,
        doc_id,
        json.dumps(doc),
    )


async def _job_event(job_id: str, event_type: str, message: str, detail: dict[str, Any] | None = None) -> None:
    await db.execute(
        """
        INSERT INTO KMS_ADMIN_JOB_EVENTS(event_id, job_id, event_type, message, detail)
        VALUES($1, $2, $3, $4, $5::jsonb)
        """,
        str(uuid.uuid4()),
        job_id,
        event_type,
        message,
        json.dumps(detail or {}),
    )


async def _sync_track_refs(job: dict[str, Any], task: dict[str, Any] | None = None) -> dict[str, Any] | None:
    metadata = _job_metadata(job)
    track_id = metadata.get("track_id")
    if not track_id and task:
        track_id = (task.get("metadata") or {}).get("track_id")
    if not track_id or not job.get("item_id"):
        return None

    workspace = _job_workspace(job, metadata)
    track = await lightrag_client.request_json(
        "GET",
        f"/documents/track_status/{track_id}",
        workspace=workspace,
    )
    documents = track.get("documents") or []
    for doc in documents:
        await _upsert_doc_ref(job["item_id"], workspace, doc)
    if documents:
        await db.execute(
            "UPDATE KMS_ADMIN_KNOWLEDGE_ITEMS SET status = 'ready', update_time = NOW() WHERE item_id = $1",
            job["item_id"],
        )
    return _track_summary(track)


async def _sync_file_label_ref(job: dict[str, Any], task: dict[str, Any] | None = None) -> dict[str, Any] | None:
    if not job.get("item_id"):
        return None
    task_metadata = _json_object((task or {}).get("metadata"))
    job_metadata = _job_metadata(job)
    request_data = _json_object(job_metadata.get("request_data"))
    file_path_label = (
        task_metadata.get("file_path_label")
        or request_data.get("file_path_label")
        or job_metadata.get("file_path_label")
    )
    if not file_path_label:
        return None
    normalized_label = str(file_path_label).strip()
    workspace = _job_workspace(job, job_metadata)
    response = await lightrag_client.request_json(
        "POST",
        "/documents/paginated",
        workspace=workspace,
        json_body={
            "page": 1,
            "page_size": 200,
            "sort_field": "updated_at",
            "sort_direction": "desc",
        },
    )
    matches = [
        doc
        for doc in response.get("documents") or []
        if str(doc.get("file_path") or "").strip() == normalized_label
        or str(doc.get("doc_nm") or "").strip() == normalized_label
    ]
    for doc in matches:
        await _upsert_doc_ref(job["item_id"], workspace, doc)
    if matches:
        await db.execute(
            "UPDATE KMS_ADMIN_KNOWLEDGE_ITEMS SET status = 'ready', update_time = NOW() WHERE item_id = $1",
            job["item_id"],
        )
        return _track_summary(
            {
                "track_id": task_metadata.get("track_id") or job_metadata.get("track_id") or "",
                "documents": matches,
                "total_count": len(matches),
                "status_summary": {},
            }
        )
    return None


async def _sync_board_refs(job: dict[str, Any], task: dict[str, Any] | None = None) -> dict[str, Any] | None:
    if job.get("job_type") != "ingest_board" or not job.get("item_id") or not task:
        return None
    metadata = task.get("metadata") or {}
    api_url = metadata.get("api_url")
    if not api_url:
        return None
    parsed = urlparse(api_url)
    if not parsed.scheme or not parsed.netloc:
        return None
    api_path = parsed.path.rstrip("/")
    base_label = f"{parsed.scheme}://{parsed.netloc}{api_path}"
    workspace = _job_workspace(job)
    response = await lightrag_client.request_json(
        "POST",
        "/documents/paginated",
        workspace=workspace,
        json_body={
            "page": 1,
            "page_size": 200,
            "sort_field": "updated_at",
            "sort_direction": "desc",
        },
    )
    matches = [
        doc
        for doc in response.get("documents") or []
        if doc.get("file_path") == base_label or str(doc.get("file_path") or "").startswith(f"{base_label}/")
    ]
    for doc in matches:
        await _upsert_doc_ref(job["item_id"], workspace, doc)
    if matches:
        await db.execute(
            "UPDATE KMS_ADMIN_KNOWLEDGE_ITEMS SET status = 'ready', update_time = NOW() WHERE item_id = $1",
            job["item_id"],
        )
        return _track_summary(
            {
                "track_id": metadata.get("track_id") or "",
                "documents": matches,
                "total_count": len(matches),
                "status_summary": {},
            }
        )
    return None


async def _cleanup_replaced_document(
    job: dict[str, Any],
    metadata: dict[str, Any],
    documents: list[dict[str, Any]],
) -> dict[str, Any]:
    replacement = _json_object(metadata.get("replacement"))
    previous_doc_id = str(replacement.get("previous_doc_id") or "").strip()
    if not previous_doc_id or not replacement.get("delete_previous", True):
        return metadata
    if replacement.get("previous_delete_status") in {"completed", "skipped_same_document"}:
        return metadata

    new_doc_ids = {str(doc.get("id")) for doc in documents if doc.get("id")}
    if not new_doc_ids:
        return metadata

    workspace = replacement.get("previous_workspace") or _job_workspace(job, metadata)
    next_replacement = dict(replacement)
    if previous_doc_id in new_doc_ids:
        next_replacement.update(
            {
                "previous_delete_status": "skipped_same_document",
                "previous_delete_message": "New ingest resolved to the same document id.",
            }
        )
        await _job_event(
            job["job_id"],
            "replacement",
            "새 지식화 결과가 기존 문서와 동일하여 이전 문서 삭제를 건너뛰었습니다.",
            {"previous_doc_id": previous_doc_id, "new_doc_ids": sorted(new_doc_ids)},
        )
        return {**metadata, "replacement": next_replacement}

    delete_response: dict[str, Any] | None = None
    try:
        delete_response = await lightrag_client.request_json(
            "DELETE",
            "/documents/delete_document",
            workspace=workspace,
            json_body={
                "doc_ids": [previous_doc_id],
                "delete_file": False,
                "delete_llm_cache": False,
                "delete_s3_file": False,
            },
        )
        removed = await _wait_document_removed(workspace, previous_doc_id)
        if not removed:
            next_replacement.update(
                {
                    "previous_delete_status": "delete_not_confirmed",
                    "previous_delete_response": delete_response,
                }
            )
            await _job_event(
                job["job_id"],
                "replacement_warning",
                "새 지식화는 완료되었지만 이전 문서 삭제 확인에 실패했습니다.",
                {"previous_doc_id": previous_doc_id, "workspace": workspace, "delete_response": delete_response},
            )
            return {**metadata, "replacement": next_replacement}
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code != 404:
            next_replacement.update(
                {
                    "previous_delete_status": "failed",
                    "previous_delete_error": exc.response.status_code,
                }
            )
            await _job_event(
                job["job_id"],
                "replacement_error",
                "이전 문서 삭제 중 오류가 발생했습니다.",
                {"previous_doc_id": previous_doc_id, "workspace": workspace, "status_code": exc.response.status_code},
            )
            return {**metadata, "replacement": next_replacement}
    await db.execute(
        """
        UPDATE KMS_ADMIN_KNOWLEDGE_ITEMS i
        SET enabled = FALSE,
            status = 'archived',
            metadata = i.metadata || $3::jsonb,
            update_time = NOW()
        FROM KMS_ADMIN_KNOWLEDGE_REFS r
        WHERE r.item_id = i.item_id
          AND r.workspace_type = 'kms'
          AND r.ref_type = 'doc_id'
          AND r.workspace = $1
          AND r.external_id = $2
        """,
        workspace,
        previous_doc_id,
        json.dumps(
            {
                "replaced_by_job_id": job["job_id"],
                "replaced_by_item_id": job.get("item_id"),
                "replaced_by_doc_ids": sorted(new_doc_ids),
            }
        ),
    )
    next_replacement.update(
        {
            "previous_delete_status": "completed",
            "previous_delete_response": delete_response,
            "new_doc_ids": sorted(new_doc_ids),
        }
    )
    await _job_event(
        job["job_id"],
        "replacement",
        "새 지식화 완료 후 이전 문서를 삭제했습니다.",
        {"previous_doc_id": previous_doc_id, "workspace": workspace, "new_doc_ids": sorted(new_doc_ids)},
    )
    return {**metadata, "replacement": next_replacement}


async def _sync_job(job: dict[str, Any]) -> dict[str, Any]:
    task: dict[str, Any] | None = None
    tasks: list[dict[str, Any]] = []
    track: dict[str, Any] | None = None
    message = job.get("message")
    progress = float(job.get("progress") or 0)
    status = job.get("status") or "running"
    metadata = _job_metadata(job)

    task_ids = _task_ids_for_job(job, metadata)
    if task_ids:
        try:
            for task_id in task_ids:
                synced_task = await lightrag_client.request_json(
                    "GET",
                    f"/api/tasks/{task_id}",
                    workspace=_job_workspace(job, metadata),
                )
                tasks.append(synced_task)
            task = tasks[0] if tasks else None
            status = _combined_status(tasks, status)
            progress = _combined_progress(tasks, progress)
            last_message = next((synced_task.get("message") for synced_task in reversed(tasks) if synced_task.get("message")), None)
            message = last_message or message
            metadata = {**metadata, "last_task": task, "last_tasks": tasks}
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 404:
                raise
            metadata = {**metadata, "last_task_error": "not_found"}

    try:
        tracks: list[dict[str, Any]] = []
        track_sources = tasks or (
            [task]
            if task
            else ([None] if metadata.get("track_id") or _json_object(metadata.get("request_data")).get("file_path_label") else [])
        )
        for synced_task in track_sources:
            synced_track = await _sync_track_refs(job, synced_task)
            if (not synced_track or not synced_track.get("documents")) and synced_task:
                synced_track = await _sync_file_label_ref(job, synced_task)
            if (not synced_track or not synced_track.get("documents")) and not synced_task:
                synced_track = await _sync_file_label_ref(job, None)
            if (not synced_track or not synced_track.get("documents")) and synced_task:
                synced_track = await _sync_board_refs(job, synced_task)
            if synced_track:
                tracks.append(synced_track)
        if tracks:
            documents = []
            for synced_track in tracks:
                documents.extend(synced_track.get("documents") or [])
            track = {
                "track_id": ",".join(str(synced_track.get("track_id") or "") for synced_track in tracks if synced_track.get("track_id")),
                "documents": documents,
                "total_count": len(documents),
                "status_summary": {},
            }
        if track:
            metadata = {**metadata, "last_track": track}
            track_documents = [doc for doc in track.get("documents") or [] if isinstance(doc, dict)]
            if track_documents and status not in {"failed", "cancelled"}:
                status = "completed"
                progress = 100
                message = message or "Document references synchronized"
                metadata = await _cleanup_replaced_document(
                    job,
                    metadata,
                    track_documents,
                )
            elif status == "completed":
                progress = 100
                metadata = await _cleanup_replaced_document(
                    job,
                    metadata,
                    track_documents,
                )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code != 404:
            raise
        metadata = {**metadata, "last_track_error": "not_found"}

    await db.execute(
        """
        UPDATE KMS_ADMIN_JOBS
        SET status = $2, progress = $3, message = $4, metadata = $5::jsonb, update_time = NOW()
        WHERE job_id = $1
        """,
        job["job_id"],
        status,
        progress,
        message,
        json.dumps(metadata),
    )
    if status in {"completed", "failed", "cancelled"} and job.get("item_id"):
        item_status = "ready" if status == "completed" else status
        await db.execute(
            "UPDATE KMS_ADMIN_KNOWLEDGE_ITEMS SET status = $2, update_time = NOW() WHERE item_id = $1",
            job["item_id"],
            item_status,
        )
    return {"job_id": job["job_id"], "status": status, "progress": progress, "task": task, "tasks": tasks, "track": track}


async def _rollback_refs(job: dict[str, Any]) -> dict[str, Any]:
    item_id = job.get("item_id")
    if not item_id:
        return {"removed_refs": 0, "documents": [], "answers": [], "errors": []}
    refs = await db.fetch(
        """
        SELECT ref_id, ref_type, workspace_type, workspace, external_id
        FROM KMS_ADMIN_KNOWLEDGE_REFS
        WHERE item_id = $1
        ORDER BY create_time DESC
        """,
        item_id,
    )
    removed_documents: list[str] = []
    archived_answers: list[str] = []
    errors: list[dict[str, Any]] = []
    for ref in refs:
        try:
            if ref["workspace_type"] == "kms" and ref["ref_type"] == "doc_id":
                await lightrag_client.request_json(
                    "DELETE",
                    "/documents/delete_document",
                    workspace=ref["workspace"],
                    json_body={
                        "doc_ids": [ref["external_id"]],
                        "delete_file": False,
                        "delete_llm_cache": False,
                        "delete_s3_file": False,
                    },
                )
                removed = await _wait_document_removed(ref["workspace"], ref["external_id"])
                if not removed:
                    errors.append(
                        {
                            "ref_id": ref["ref_id"],
                            "external_id": ref["external_id"],
                            "status_code": "delete_not_confirmed",
                        }
                    )
                    continue
                removed_documents.append(ref["external_id"])
            elif ref["workspace_type"] == "faq" and ref["ref_type"] == "answer_id":
                await lightrag_client.request_json(
                    "POST",
                    f"/api/answers/{ref['external_id']}/archive",
                    workspace=ref["workspace"],
                    json_body={},
                )
                archived_answers.append(ref["external_id"])
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 404:
                errors.append(
                    {
                        "ref_id": ref["ref_id"],
                        "external_id": ref["external_id"],
                        "status_code": exc.response.status_code,
                    }
                )
                continue
        await db.execute("DELETE FROM KMS_ADMIN_KNOWLEDGE_REFS WHERE ref_id = $1", ref["ref_id"])
    return {
        "removed_refs": len(refs) - len(errors),
        "documents": removed_documents,
        "answers": archived_answers,
        "errors": errors,
    }


@router.get("")
async def list_jobs(user: dict = Depends(get_current_user)) -> dict:
    rows = await db.fetch(
        """
        SELECT j.*, i.title AS knowledge_title, i.knowledge_type
        FROM KMS_ADMIN_JOBS j
        LEFT JOIN KMS_ADMIN_KNOWLEDGE_ITEMS i ON i.item_id = j.item_id
        WHERE $2 = 'admin'
           OR COALESCE(j.tenant_id, i.tenant_id) = $1
        ORDER BY j.update_time DESC
        LIMIT 500
        """,
        user.get("tenant_id"),
        user.get("role"),
    )
    return {"jobs": [_normalize_job_row(row) for row in rows]}


@router.post("/sync-running")
async def sync_running_jobs(request: Request, user: dict = Depends(get_current_user)) -> dict:
    rows = await db.fetch(
        """
        SELECT j.*, i.title AS knowledge_title, i.knowledge_type, i.kms_workspace, i.faq_workspace
        FROM KMS_ADMIN_JOBS j
        LEFT JOIN KMS_ADMIN_KNOWLEDGE_ITEMS i ON i.item_id = j.item_id
        WHERE j.status IN ('pending', 'running')
          AND (
            $2 = 'admin'
            OR COALESCE(j.tenant_id, i.tenant_id) = $1
          )
        ORDER BY j.update_time DESC
        LIMIT 100
        """,
        user.get("tenant_id"),
        user.get("role"),
    )
    synced = [await _sync_job(row) for row in rows]
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="sync_running_jobs",
        target_type="job",
        detail={"count": len(synced)},
    )
    return {"synced": synced}


@router.post("/{job_id}/sync")
async def sync_job(job_id: str, request: Request, user: dict = Depends(get_current_user)) -> dict:
    job = await db.fetchrow(
        """
        SELECT j.*, i.title AS knowledge_title, i.knowledge_type, i.kms_workspace, i.faq_workspace
        FROM KMS_ADMIN_JOBS j
        LEFT JOIN KMS_ADMIN_KNOWLEDGE_ITEMS i ON i.item_id = j.item_id
        WHERE j.job_id = $1
          AND (
            $3 = 'admin'
            OR COALESCE(j.tenant_id, i.tenant_id) = $2
          )
        """,
        job_id,
        user.get("tenant_id"),
        user.get("role"),
    )
    if not job:
        return {"message": "not_found", "job_id": job_id}
    synced = await _sync_job(job)
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="sync_job",
        target_type="job",
        target_id=job_id,
    )
    return synced


@router.post("/{job_id}/cancel")
async def cancel_job(job_id: str, request: Request, user: dict = Depends(get_current_user)) -> dict:
    job = await db.fetchrow(
        """
        SELECT j.*, i.kms_workspace, i.faq_workspace
        FROM KMS_ADMIN_JOBS j
        LEFT JOIN KMS_ADMIN_KNOWLEDGE_ITEMS i ON i.item_id = j.item_id
        WHERE j.job_id = $1
          AND (
            $3 = 'admin'
            OR COALESCE(j.tenant_id, i.tenant_id) = $2
          )
        """,
        job_id,
        user.get("tenant_id"),
        user.get("role"),
    )
    if not job:
        return {"message": "not_cancellable", "job_id": job_id}
    task_ids = _task_ids_for_job(job, _job_metadata(job))
    if not task_ids:
        return {"message": "not_cancellable", "job_id": job_id}
    responses = []
    for task_id in task_ids:
        responses.append(
            await lightrag_client.request_json(
                "POST",
                f"/api/tasks/{task_id}/cancel",
                workspace=_job_workspace(job),
                json_body={},
            )
        )
    await _sync_job(job)
    rollback = await _rollback_refs(job)
    rollback_status = "completed" if not rollback["errors"] else "partial"
    await db.execute(
        """
        UPDATE KMS_ADMIN_JOBS
        SET status = 'cancelled', rollback_status = $2, message = $3, update_time = NOW()
        WHERE job_id = $1
        """,
        job_id,
        rollback_status,
        "; ".join(response.get("message", "") for response in responses if response.get("message")) or "Task cancellation requested",
    )
    if job.get("item_id"):
        await db.execute(
            "UPDATE KMS_ADMIN_KNOWLEDGE_ITEMS SET status = 'cancelled', update_time = NOW() WHERE item_id = $1",
            job["item_id"],
        )
    await _job_event(
        job_id,
        "rollback",
        "작업 취소 후 롤백을 수행했습니다.",
        rollback,
    )
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="cancel_job",
        target_type="job",
        target_id=job_id,
        detail=rollback,
    )
    return {"message": "Task cancellation requested", "responses": responses, "rollback_status": rollback_status, "rollback": rollback}


@router.post("/{job_id}/rollback")
async def rollback_job(job_id: str, request: Request, user: dict = Depends(get_current_user)) -> dict:
    job = await db.fetchrow(
        """
        SELECT j.*, i.kms_workspace, i.faq_workspace
        FROM KMS_ADMIN_JOBS j
        LEFT JOIN KMS_ADMIN_KNOWLEDGE_ITEMS i ON i.item_id = j.item_id
        WHERE j.job_id = $1
          AND (
            $3 = 'admin'
            OR COALESCE(j.tenant_id, i.tenant_id) = $2
          )
        """,
        job_id,
        user.get("tenant_id"),
        user.get("role"),
    )
    if not job:
        return {"message": "not_found", "job_id": job_id}
    synced = await _sync_job(job)
    if synced["status"] in {"pending", "running", "processing"}:
        raise HTTPException(
            status_code=409,
            detail="작업이 아직 진행 중입니다. 먼저 작업을 중단하거나 완료 후 롤백하세요.",
        )
    rollback = await _rollback_refs(job)
    rollback_status = "completed" if not rollback["errors"] else "partial"
    await db.execute(
        """
        UPDATE KMS_ADMIN_JOBS
        SET rollback_status = $2, message = $3, update_time = NOW()
        WHERE job_id = $1
        """,
        job_id,
        rollback_status,
        "Manual rollback completed" if rollback_status == "completed" else "Manual rollback partially completed",
    )
    if job.get("item_id"):
        await db.execute(
            "UPDATE KMS_ADMIN_KNOWLEDGE_ITEMS SET status = 'rolledback', update_time = NOW() WHERE item_id = $1",
            job["item_id"],
        )
    await _job_event(job_id, "rollback", "수동 롤백을 수행했습니다.", rollback)
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="rollback_job",
        target_type="job",
        target_id=job_id,
        detail=rollback,
    )
    return {"job_id": job_id, "rollback_status": rollback_status, "rollback": rollback}


@router.get("/{job_id}/stream")
async def stream_job_progress(
    job_id: str,
    persist_events: bool = Query(default=False),
    user: dict = Depends(get_current_user),
):
    job = await db.fetchrow(
        """
        SELECT j.*, i.kms_workspace, i.faq_workspace
        FROM KMS_ADMIN_JOBS j
        LEFT JOIN KMS_ADMIN_KNOWLEDGE_ITEMS i ON i.item_id = j.item_id
        WHERE j.job_id = $1
          AND (
            $3 = 'admin'
            OR COALESCE(j.tenant_id, i.tenant_id) = $2
          )
        """,
        job_id,
        user.get("tenant_id"),
        user.get("role"),
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    metadata = _job_metadata(job)
    task_ids = _task_ids_for_job(job, metadata)
    if not task_ids:
        raise HTTPException(status_code=404, detail="LightRAG task id not found")

    workspace = _job_workspace(job, metadata)

    async def stream():
        last_persisted_progress: dict[str, float] = {}
        if persist_events:
            await _job_event(
                job_id,
                "stream_open",
                "LightRAG 작업 스트림 연결을 시작했습니다.",
                {"task_ids": task_ids, "workspace": workspace},
            )
        yield json.dumps(
            {
                "event": "job",
                "job_id": job_id,
                "task_ids": task_ids,
                "workspace": workspace,
                "persist_events": persist_events,
            },
            ensure_ascii=False,
        ) + "\n"
        for task_id in task_ids:
            if persist_events:
                await _job_event(
                    job_id,
                    "task_start",
                    "LightRAG 작업 스트림 구독을 시작했습니다.",
                    {"task_id": task_id, "workspace": workspace},
                )
            yield json.dumps(
                {
                    "event": "task_start",
                    "job_id": job_id,
                    "task_id": task_id,
                    "workspace": workspace,
                    "persisted": persist_events,
                },
                ensure_ascii=False,
            ) + "\n"
            try:
                async for event in lightrag_client.stream_get_ndjson(
                    f"/api/tasks/{task_id}/stream",
                    workspace=workspace,
                    timeout=3600.0,
                ):
                    progress = _progress_value(event.get("progress"))
                    persisted = False
                    if persist_events and _should_persist_stream_event(
                        event,
                        last_persisted_progress.get(task_id),
                    ):
                        await _job_event(
                            job_id,
                            "task_progress",
                            _stream_event_message(event, "LightRAG 작업 진행 상태를 수신했습니다."),
                            {
                                "task_id": task_id,
                                "workspace": workspace,
                                "event": event,
                            },
                        )
                        if progress is not None:
                            last_persisted_progress[task_id] = progress
                        persisted = True
                    yield json.dumps(
                        {"event": "task_progress", "job_id": job_id, "persisted": persisted, **event},
                        ensure_ascii=False,
                    ) + "\n"
            except httpx.HTTPStatusError as exc:
                if persist_events:
                    await _job_event(
                        job_id,
                        "task_error",
                        f"LightRAG 작업 스트림 오류: {exc.response.status_code}",
                        {
                            "task_id": task_id,
                            "workspace": workspace,
                            "status_code": exc.response.status_code,
                            "detail": exc.response.text,
                        },
                    )
                yield json.dumps(
                    {
                        "event": "error",
                        "job_id": job_id,
                        "task_id": task_id,
                        "status_code": exc.response.status_code,
                        "detail": exc.response.text,
                        "persisted": persist_events,
                    },
                    ensure_ascii=False,
                ) + "\n"
            if persist_events:
                await _job_event(
                    job_id,
                    "task_end",
                    "LightRAG 작업 스트림 구독을 종료했습니다.",
                    {"task_id": task_id, "workspace": workspace},
                )
            yield json.dumps(
                {
                    "event": "task_end",
                    "job_id": job_id,
                    "task_id": task_id,
                    "workspace": workspace,
                    "persisted": persist_events,
                },
                ensure_ascii=False,
            ) + "\n"
        if persist_events:
            await _job_event(
                job_id,
                "stream_done",
                "LightRAG 작업 스트림 연결을 종료했습니다.",
                {"task_ids": task_ids, "workspace": workspace},
            )
        yield json.dumps({"event": "done", "job_id": job_id, "persist_events": persist_events}, ensure_ascii=False) + "\n"

    return StreamingResponse(
        stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{job_id}/events")
async def list_job_events(job_id: str, user: dict = Depends(get_current_user)) -> dict:
    job = await db.fetchrow(
        """
        SELECT j.job_id
        FROM KMS_ADMIN_JOBS j
        LEFT JOIN KMS_ADMIN_KNOWLEDGE_ITEMS i ON i.item_id = j.item_id
        WHERE j.job_id = $1
          AND (
            $3 = 'admin'
            OR COALESCE(j.tenant_id, i.tenant_id) = $2
          )
        """,
        job_id,
        user.get("tenant_id"),
        user.get("role"),
    )
    if not job:
        return {"events": []}
    rows = await db.fetch(
        """
        SELECT *
        FROM KMS_ADMIN_JOB_EVENTS
        WHERE job_id = $1
        ORDER BY create_time ASC
        """,
        job_id,
    )
    return {"events": [_normalize_event_row(row) for row in rows]}
