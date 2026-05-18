"""
Task management API routes.

Provides endpoints for:
- Querying task status
- Streaming task progress via NDJSON
- Listing workspace tasks
- Cancelling tasks
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from lightrag.api.utils_api import decode_workspace_header
from lightrag.api.task_manager import TaskStatus, get_task_service
from lightrag.utils import logger

# ============================================================================
# Workspace isolation pattern
# ============================================================================

_get_rag_for_workspace = None


def set_rag_workspace_getter(getter):
    global _get_rag_for_workspace
    _get_rag_for_workspace = getter


def _get_workspace_from_request(request: Request) -> str:
    return decode_workspace_header(request.headers.get("LIGHTRAG-WORKSPACE", ""))


# ============================================================================
# Response Models
# ============================================================================


class TaskStatusResponse(BaseModel):
    task_id: str
    task_type: str
    workspace: str
    status: TaskStatus
    progress: float
    message: str
    created_at: float
    updated_at: float
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class TaskListResponse(BaseModel):
    tasks: List[TaskStatusResponse]
    total: int


class TaskCancelResponse(BaseModel):
    task_id: str
    cancelled: bool
    message: str


# ============================================================================
# Router
# ============================================================================

router = APIRouter(prefix="/api/tasks", tags=["Tasks"])


@router.get("", response_model=TaskListResponse)
async def list_tasks(http_request: Request):
    """List all tasks for the current workspace."""
    workspace = _get_workspace_from_request(http_request)
    service = get_task_service()
    tasks = service.get_tasks_by_workspace(workspace)

    task_responses = [
        TaskStatusResponse(
            task_id=t.task_id,
            task_type=t.task_type.value,
            workspace=t.workspace,
            status=t.status,
            progress=t.progress,
            message=t.message,
            created_at=t.created_at,
            updated_at=t.updated_at,
            result=t.result,
            error=t.error,
            metadata=t.metadata,
        )
        for t in tasks
    ]

    return TaskListResponse(tasks=task_responses, total=len(task_responses))


@router.get("/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(task_id: str, http_request: Request):
    """Get status of a specific task."""
    workspace = _get_workspace_from_request(http_request)
    service = get_task_service()
    task = service.get_task(task_id)

    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    if task.workspace != workspace:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    return TaskStatusResponse(
        task_id=task.task_id,
        task_type=task.task_type.value,
        workspace=task.workspace,
        status=task.status,
        progress=task.progress,
        message=task.message,
        created_at=task.created_at,
        updated_at=task.updated_at,
        result=task.result,
        error=task.error,
        metadata=task.metadata,
    )


@router.get("/{task_id}/stream")
async def stream_task_progress(task_id: str, http_request: Request):
    """Stream task progress as NDJSON.

    Returns a streaming response with newline-delimited JSON events.
    Each line is a JSON object with task_id, status, progress, message, etc.
    Heartbeat events are sent every 30 seconds to keep the connection alive.
    Stream terminates when the task reaches a terminal state.
    """
    workspace = _get_workspace_from_request(http_request)
    service = get_task_service()
    task = service.get_task(task_id)

    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    if task.workspace != workspace:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    return StreamingResponse(
        service.stream_progress(task_id),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Content-Type": "application/x-ndjson",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{task_id}/cancel", response_model=TaskCancelResponse)
async def cancel_task(task_id: str, http_request: Request):
    """Cancel a running task."""
    workspace = _get_workspace_from_request(http_request)
    service = get_task_service()
    task = service.get_task(task_id)

    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    if task.workspace != workspace:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    cancelled = await service.cancel_task(task_id)

    if cancelled:
        return TaskCancelResponse(
            task_id=task_id,
            cancelled=True,
            message="Task cancellation requested",
        )
    else:
        return TaskCancelResponse(
            task_id=task_id,
            cancelled=False,
            message=f"Task cannot be cancelled (status: {task.status.value})",
        )


def create_task_routes() -> APIRouter:
    """Create and return the task API router."""
    return router
