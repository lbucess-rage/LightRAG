"""
Document history routes for LightRAG.

The first history surface is intentionally composed from data that already
exists: document status rows, persisted task rows, and deletion snapshots.
This makes older workspaces immediately inspectable without a migration.
"""

from __future__ import annotations

import traceback
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from lightrag.kg.shared_storage import get_default_workspace
from lightrag.utils import logger

from ..utils_api import decode_workspace_header, get_combined_auth_dependency
from .deletion_routes import (
    _ensure_snapshot_table,
    _json_loads_maybe,
    _snapshot_db,
)

router = APIRouter(prefix="/history", tags=["history"])

_get_rag_for_workspace = None


def set_rag_workspace_getter(getter_func):
    """Set the function to get RAG instance by workspace."""
    global _get_rag_for_workspace
    _get_rag_for_workspace = getter_func


async def get_workspace_rag(workspace: str):
    if _get_rag_for_workspace is not None:
        return await _get_rag_for_workspace(workspace)
    return None


def _get_workspace_from_request(request: Request) -> str:
    workspace = decode_workspace_header(request.headers.get("LIGHTRAG-WORKSPACE", ""))
    if workspace:
        return workspace
    return get_default_workspace() or "base"


async def _workspace_rag_or_default(http_request: Request, default_rag):
    workspace = _get_workspace_from_request(http_request)
    workspace_rag = await get_workspace_rag(workspace)
    return workspace, workspace_rag or default_rag


class HistoryOperation(BaseModel):
    operation_id: str = Field(description="Stable operation identifier.")
    operation_type: str = Field(description="Operation kind, such as document_ingest or delete_entity.")
    status: str = Field(description="Operation status.")
    source: str = Field(description="Underlying source used to compose the history item.")
    target_type: str = Field(description="Primary target type for the operation.")
    target_id: str | None = Field(default=None, description="Primary target identifier.")
    doc_id: str | None = Field(default=None, description="Related document identifier.")
    title: str = Field(description="Human readable title.")
    summary: str | None = Field(default=None, description="Short operation summary.")
    created_at: str | None = Field(default=None, description="Operation creation time.")
    completed_at: str | None = Field(default=None, description="Operation completion time.")
    can_restore: bool = Field(default=False, description="Whether this item has a restore action.")
    restore_job_id: str | None = Field(default=None, description="Deletion job ID used for restore.")
    restored_at: str | None = Field(default=None, description="Restore completion time, if already restored.")
    counts: dict[str, int] = Field(default_factory=dict, description="Compact affected-object counts.")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Additional structured context.")


class DocumentHistoryResponse(BaseModel):
    workspace: str
    doc_id: str
    file_path: str | None = None
    current_document: dict[str, Any] | None = None
    operations: list[HistoryOperation]
    total_count: int


def _as_dict(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        return value.model_dump()
    return dict(value) if isinstance(value, list | tuple) else {}


def _normalise_json(value: Any, default: Any = None) -> Any:
    return _json_loads_maybe(value, default)


def _compact_counts(value: dict[str, Any] | None) -> dict[str, int]:
    counts: dict[str, int] = {}
    for key, raw_value in (value or {}).items():
        if isinstance(raw_value, bool):
            continue
        if isinstance(raw_value, int):
            counts[str(key)] = raw_value
        elif isinstance(raw_value, float):
            counts[str(key)] = int(raw_value)
    return counts


def _contains_exact(value: Any, needles: set[str]) -> bool:
    if not needles:
        return False
    if isinstance(value, str):
        return value in needles
    if isinstance(value, dict):
        return any(_contains_exact(item, needles) for item in value.values())
    if isinstance(value, list | tuple | set):
        return any(_contains_exact(item, needles) for item in value)
    return False


def _first_snapshot_doc(snapshot: dict[str, Any], doc_id: str) -> dict[str, Any] | None:
    tables = snapshot.get("tables") or {}
    for row in tables.get("LIGHTRAG_DOC_STATUS") or []:
        if str(row.get("id")) == doc_id:
            return row
    for row in tables.get("LIGHTRAG_DOC_FULL") or []:
        if str(row.get("id")) == doc_id:
            return row
    return None


def _deletion_mentions_doc(row: dict[str, Any], doc_id: str, file_path: str | None) -> bool:
    request_json = _normalise_json(row.get("request_json"), {})
    preview_json = _normalise_json(row.get("preview_json"), {})
    snapshot_json = _normalise_json(row.get("snapshot_json"), {})
    needles = {doc_id}
    if file_path:
        needles.add(file_path)

    if _contains_exact(request_json, needles) or _contains_exact(preview_json, needles):
        return True

    tables = (snapshot_json or {}).get("tables") or {}
    for table_name, rows in tables.items():
        for item in rows or []:
            if str(item.get("id")) == doc_id or str(item.get("full_doc_id")) == doc_id:
                return True
            if file_path and item.get("file_path") == file_path:
                return True
            if table_name == "LIGHTRAG_DOC_STATUS" and item.get("file_path") == file_path:
                return True
    return False


def _task_mentions_doc(row: dict[str, Any], doc_id: str, doc: dict[str, Any] | None) -> bool:
    metadata = _normalise_json(row.get("metadata"), {}) or {}
    result = _normalise_json(row.get("result"), {}) or {}
    track_id = str((doc or {}).get("track_id") or "")
    file_path = str((doc or {}).get("file_path") or "")

    needles = {doc_id}
    if track_id:
        needles.add(track_id)
    if file_path:
        needles.add(file_path)

    if _contains_exact(metadata, needles) or _contains_exact(result, needles):
        return True

    if file_path and row.get("message") == file_path:
        return True
    return False


async def _current_document_operation(rag, doc_id: str) -> tuple[dict[str, Any] | None, HistoryOperation | None]:
    doc = await rag.doc_status.get_by_id(doc_id)
    if not doc:
        return None, None

    doc = _as_dict(doc)
    doc["id"] = doc_id
    status = str(doc.get("status") or "unknown")
    operation = HistoryOperation(
        operation_id=f"{doc_id}:current",
        operation_type="document_current_state",
        status=status,
        source="doc_status",
        target_type="document",
        target_id=doc_id,
        doc_id=doc_id,
        title="Current document state",
        summary=str(doc.get("content_summary") or doc.get("file_path") or doc_id),
        created_at=str(doc.get("created_at")) if doc.get("created_at") else None,
        completed_at=str(doc.get("updated_at")) if doc.get("updated_at") else None,
        counts={"chunks": int(doc.get("chunks_count") or 0)},
        metadata={
            "file_path": doc.get("file_path"),
            "track_id": doc.get("track_id"),
            "metadata": doc.get("metadata") or {},
            "error_msg": doc.get("error_msg"),
        },
    )
    return doc, operation


async def _task_history_operations(
    db,
    workspace: str,
    doc_id: str,
    doc: dict[str, Any] | None,
    limit: int,
) -> list[HistoryOperation]:
    if db is None:
        return []

    try:
        rows = await db.query(
            """
            SELECT workspace, task_id, task_type, status, progress, message,
                   result, error, metadata,
                   created_at::text AS created_at,
                   updated_at::text AS updated_at
            FROM LIGHTRAG_TASKS
            WHERE workspace = $1
            ORDER BY created_at DESC
            LIMIT $2
            """,
            [workspace, min(max(limit * 5, 50), 500)],
            multirows=True,
        )
    except Exception as e:
        logger.warning("Failed to query task history: %s", e)
        return []

    operations: list[HistoryOperation] = []
    for row in rows or []:
        row = dict(row)
        if not _task_mentions_doc(row, doc_id, doc):
            continue

        metadata = _normalise_json(row.get("metadata"), {}) or {}
        result = _normalise_json(row.get("result"), {}) or {}
        counts = _compact_counts(
            {
                "total": result.get("total_items"),
                "success": result.get("success_count"),
                "errors": result.get("error_count"),
            }
        )
        status_summary = result.get("status_summary")
        if isinstance(status_summary, dict):
            counts.update(_compact_counts(status_summary))

        task_type = str(row.get("task_type") or "task")
        operations.append(
            HistoryOperation(
                operation_id=str(row.get("task_id")),
                operation_type=task_type,
                status=str(row.get("status") or "unknown"),
                source="task",
                target_type="document",
                target_id=doc_id,
                doc_id=doc_id,
                title=f"{task_type.replace('_', ' ').title()}",
                summary=str(row.get("message") or metadata.get("file_path_label") or metadata.get("file_name") or ""),
                created_at=row.get("created_at"),
                completed_at=row.get("updated_at"),
                counts=counts,
                metadata={
                    "progress": row.get("progress"),
                    "error": row.get("error"),
                    "task_metadata": metadata,
                    "result": result,
                },
            )
        )
        if len(operations) >= limit:
            break

    return operations


async def _deletion_history_operations(
    rag,
    workspace: str,
    doc_id: str,
    doc: dict[str, Any] | None,
    limit: int,
) -> tuple[list[HistoryOperation], dict[str, Any] | None]:
    db = _snapshot_db(rag)
    if db is None:
        return [], None

    try:
        await _ensure_snapshot_table(db)
        rows = await db.query(
            """
            SELECT workspace, job_id, target_type, policy, request_json, preview_json,
                   snapshot_json, restored_at::text AS restored_at,
                   create_time::text AS created_at,
                   update_time::text AS updated_at
            FROM LIGHTRAG_DELETION_SNAPSHOTS
            WHERE workspace = $1
            ORDER BY create_time DESC
            LIMIT $2
            """,
            [workspace, min(max(limit * 5, 50), 500)],
            multirows=True,
        )
    except Exception as e:
        logger.warning("Failed to query deletion history: %s", e)
        return [], None

    operations: list[HistoryOperation] = []
    snapshot_doc: dict[str, Any] | None = None
    file_path = (doc or {}).get("file_path")

    for row in rows or []:
        row = dict(row)
        if not _deletion_mentions_doc(row, doc_id, file_path):
            continue

        request_json = _normalise_json(row.get("request_json"), {}) or {}
        preview_json = _normalise_json(row.get("preview_json"), {}) or {}
        snapshot_json = _normalise_json(row.get("snapshot_json"), {}) or {}
        if snapshot_doc is None:
            snapshot_doc = _first_snapshot_doc(snapshot_json, doc_id)

        summary = preview_json.get("summary") if isinstance(preview_json, dict) else {}
        counts = snapshot_json.get("counts", {}) if isinstance(snapshot_json, dict) else {}
        counts = _compact_counts(counts)
        counts.update({f"preview_{key}": value for key, value in _compact_counts(summary).items()})

        restored_at = row.get("restored_at")
        job_id = str(row.get("job_id"))
        target_type = str(row.get("target_type") or "unknown")
        policy = str(row.get("policy") or "unknown")
        operations.append(
            HistoryOperation(
                operation_id=job_id,
                operation_type=f"delete_{target_type}",
                status="restored" if restored_at else "completed",
                source="deletion",
                target_type=target_type,
                target_id=doc_id,
                doc_id=doc_id,
                title=f"Delete {target_type}",
                summary=f"{policy} deletion snapshot",
                created_at=row.get("created_at"),
                completed_at=row.get("updated_at"),
                can_restore=True,
                restore_job_id=job_id,
                restored_at=restored_at,
                counts=counts,
                metadata={
                    "policy": policy,
                    "request": request_json,
                    "preview_summary": summary if isinstance(summary, dict) else {},
                    "warnings": preview_json.get("warnings", []) if isinstance(preview_json, dict) else [],
                },
            )
        )
        if restored_at:
            operations.append(
                HistoryOperation(
                    operation_id=f"{job_id}:restore",
                    operation_type="restore_deletion",
                    status="completed",
                    source="deletion",
                    target_type="document",
                    target_id=doc_id,
                    doc_id=doc_id,
                    title="Restore deletion snapshot",
                    summary=f"Restored snapshot {job_id}",
                    created_at=restored_at,
                    completed_at=restored_at,
                    counts=counts,
                    metadata={"restore_job_id": job_id},
                )
            )
        if len(operations) >= limit:
            break

    return operations, snapshot_doc


def _sort_key(operation: HistoryOperation) -> str:
    return operation.completed_at or operation.created_at or ""


def create_history_routes(rag, api_key: Optional[str] = None):
    combined_auth = get_combined_auth_dependency(api_key)

    @router.get(
        "/documents/{doc_id}",
        response_model=DocumentHistoryResponse,
        dependencies=[Depends(combined_auth)],
        summary="Get document history",
        description=(
            "Returns a document-centered timeline composed from the current document status, "
            "persisted ingestion tasks, deletion snapshots, and restore events."
        ),
    )
    async def get_document_history(
        http_request: Request,
        doc_id: str,
        limit: int = Query(50, ge=1, le=200),
    ):
        try:
            workspace, workspace_rag = await _workspace_rag_or_default(http_request, rag)
            doc, current_operation = await _current_document_operation(workspace_rag, doc_id)
            db = _snapshot_db(workspace_rag)

            task_operations = await _task_history_operations(
                db, workspace, doc_id, doc, limit
            )
            deletion_operations, snapshot_doc = await _deletion_history_operations(
                workspace_rag, workspace, doc_id, doc, limit
            )

            if not doc and snapshot_doc:
                doc = {
                    "id": doc_id,
                    "file_path": snapshot_doc.get("file_path") or snapshot_doc.get("doc_name"),
                    "content_summary": snapshot_doc.get("content_summary"),
                    "status": snapshot_doc.get("status"),
                    "chunks_count": snapshot_doc.get("chunks_count"),
                    "track_id": snapshot_doc.get("track_id"),
                }

            operations = [
                item
                for item in [current_operation, *task_operations, *deletion_operations]
                if item is not None
            ]
            operations.sort(key=_sort_key, reverse=True)
            operations = operations[:limit]

            return DocumentHistoryResponse(
                workspace=workspace,
                doc_id=doc_id,
                file_path=(doc or {}).get("file_path"),
                current_document=doc,
                operations=operations,
                total_count=len(operations),
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error fetching document history: %s", e)
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    return router
