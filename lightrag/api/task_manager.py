"""
Async task management with progress streaming.

Provides background task execution with real-time NDJSON progress updates.
Used for long-running operations like multimodal document processing.
"""

import asyncio
import json
import time
import uuid
from enum import Enum
from pathlib import Path
from typing import Any, AsyncGenerator, Callable, Coroutine, Dict, List, Optional

from pydantic import BaseModel, Field

from lightrag.utils import logger


# ============================================================================
# Enums
# ============================================================================


class TaskType(str, Enum):
    DOCUMENT_INGEST = "document_ingest"
    DOCUMENT_SCAN = "document_scan"
    MULTIMODAL_PROCESS = "multimodal_process"
    URL_INGEST = "url_ingest"
    BOARD_INGEST = "board_ingest"
    FAQ_GUIDANCE_ENRICHMENT = "faq_guidance_enrichment"
    FAQ_TERM_DISCOVERY = "faq_term_discovery"
    FAQ_VECTOR_REBUILD = "faq_vector_rebuild"
    FAQ_GRAPH_REBUILD = "faq_graph_rebuild"


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


# ============================================================================
# Models
# ============================================================================


class TaskProgressEvent(BaseModel):
    """Single progress event sent via NDJSON stream."""

    task_id: str
    status: TaskStatus
    progress: float = Field(ge=0.0, le=100.0)
    message: str = ""
    detail: Optional[Dict[str, Any]] = None
    timestamp: float = Field(default_factory=time.time)


class TaskProgressLog(BaseModel):
    """Persisted progress log entry."""

    progress: float
    message: str
    timestamp: float
    detail: Optional[Dict[str, Any]] = None


class Task(BaseModel):
    """Full task information."""

    task_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    task_type: TaskType
    workspace: str = ""
    status: TaskStatus = TaskStatus.PENDING
    progress: float = 0.0
    message: str = ""
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    progress_logs: List[TaskProgressLog] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


# ============================================================================
# TaskRegistry - In-memory storage with subscriber pattern
# ============================================================================


class TaskRegistry:
    """In-memory task storage with asyncio.Queue-based subscriber pattern."""

    def __init__(self, max_tasks: int = 1000):
        self._tasks: Dict[str, Task] = {}
        self._subscribers: Dict[str, List[asyncio.Queue]] = {}
        self._max_tasks = max_tasks

    def add_task(self, task: Task) -> None:
        self._cleanup_if_needed()
        self._tasks[task.task_id] = task

    def get_task(self, task_id: str) -> Optional[Task]:
        return self._tasks.get(task_id)

    def get_tasks_by_workspace(self, workspace: str) -> List[Task]:
        return [t for t in self._tasks.values() if t.workspace == workspace]

    def update_task(self, task: Task) -> None:
        task.updated_at = time.time()
        self._tasks[task.task_id] = task

    def subscribe(self, task_id: str) -> asyncio.Queue:
        """Subscribe to progress events for a task."""
        if task_id not in self._subscribers:
            self._subscribers[task_id] = []
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers[task_id].append(queue)
        return queue

    def unsubscribe(self, task_id: str, queue: asyncio.Queue) -> None:
        """Unsubscribe from progress events."""
        if task_id in self._subscribers:
            try:
                self._subscribers[task_id].remove(queue)
            except ValueError:
                pass
            if not self._subscribers[task_id]:
                del self._subscribers[task_id]

    async def notify(self, task_id: str, event: TaskProgressEvent) -> None:
        """Notify all subscribers of a progress event."""
        if task_id in self._subscribers:
            for queue in self._subscribers[task_id]:
                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    pass

    def _cleanup_if_needed(self) -> None:
        """Remove oldest completed/failed tasks if over limit."""
        if len(self._tasks) < self._max_tasks:
            return
        terminal = [
            t
            for t in self._tasks.values()
            if t.status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED)
        ]
        terminal.sort(key=lambda t: t.updated_at)
        to_remove = len(self._tasks) - self._max_tasks + 100
        for task in terminal[:to_remove]:
            self._tasks.pop(task.task_id, None)
            self._subscribers.pop(task.task_id, None)


# ============================================================================
# TaskService - Singleton
# ============================================================================


class TaskService:
    """Singleton service for task lifecycle management."""

    def __init__(self, log_storage_path: Optional[Path] = None, db=None):
        self._registry = TaskRegistry()
        self._log_storage_path = log_storage_path
        self._db = db  # PostgreSQLDB instance (Optional)
        if self._log_storage_path:
            self._log_storage_path.mkdir(parents=True, exist_ok=True)

    def create_task(
        self,
        task_type: TaskType,
        workspace: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Task:
        """Create and register a new task."""
        task = Task(
            task_type=task_type,
            workspace=workspace,
            metadata=metadata or {},
        )
        self._registry.add_task(task)
        self._fire_save_to_db(task)
        logger.info(f"Task created: {task.task_id} type={task_type} workspace={workspace}")
        return task

    async def update_progress(
        self,
        task_id: str,
        progress: Optional[float] = None,
        message: str = "",
        detail: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Update task progress and notify subscribers.

        Args:
            progress: If None, keep current progress value (message-only update).
        """
        task = self._registry.get_task(task_id)
        if not task:
            return

        if progress is not None:
            task.progress = min(progress, 100.0)
        progress = task.progress  # Use current value for logging
        task.message = message
        if task.status == TaskStatus.PENDING:
            task.status = TaskStatus.RUNNING
        task.progress_logs.append(
            TaskProgressLog(progress=progress, message=message, timestamp=time.time(), detail=detail)
        )
        self._registry.update_task(task)
        asyncio.create_task(self._save_task_to_db(task))

        event = TaskProgressEvent(
            task_id=task_id,
            status=task.status,
            progress=task.progress,
            message=message,
            detail=detail,
        )
        await self._registry.notify(task_id, event)

    async def complete_task(
        self, task_id: str, result: Optional[Dict[str, Any]] = None
    ) -> None:
        """Mark task as completed."""
        task = self._registry.get_task(task_id)
        if not task:
            return

        task.status = TaskStatus.COMPLETED
        task.progress = 100.0
        task.message = "Completed"
        task.result = result
        self._registry.update_task(task)
        asyncio.create_task(self._save_task_to_db(task))

        event = TaskProgressEvent(
            task_id=task_id,
            status=TaskStatus.COMPLETED,
            progress=100.0,
            message="Completed",
            detail=result,
        )
        await self._registry.notify(task_id, event)
        self._persist_task_logs(task)
        logger.info(f"Task completed: {task_id}")

    async def fail_task(
        self, task_id: str, error: str, result: Optional[Dict[str, Any]] = None
    ) -> None:
        """Mark task as failed."""
        task = self._registry.get_task(task_id)
        if not task:
            return

        task.status = TaskStatus.FAILED
        task.error = error
        task.message = f"Failed: {error}"
        if result is not None:
            task.result = result
        self._registry.update_task(task)
        asyncio.create_task(self._save_task_to_db(task))

        event = TaskProgressEvent(
            task_id=task_id,
            status=TaskStatus.FAILED,
            progress=task.progress,
            message=task.message,
            detail=result,
        )
        await self._registry.notify(task_id, event)
        self._persist_task_logs(task)
        logger.error(f"Task failed: {task_id} error={error}")

    async def cancel_task(self, task_id: str) -> bool:
        """Mark task as cancelled. Returns True if cancellation was set."""
        task = self._registry.get_task(task_id)
        if not task:
            return False
        if task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
            return False

        task.status = TaskStatus.CANCELLED
        task.message = "Cancelled by user"
        self._registry.update_task(task)
        asyncio.create_task(self._save_task_to_db(task))

        event = TaskProgressEvent(
            task_id=task_id,
            status=TaskStatus.CANCELLED,
            progress=task.progress,
            message="Cancelled by user",
        )
        await self._registry.notify(task_id, event)
        logger.info(f"Task cancelled: {task_id}")
        return True

    def get_task(self, task_id: str) -> Optional[Task]:
        return self._registry.get_task(task_id)

    def get_tasks_by_workspace(self, workspace: str) -> List[Task]:
        return self._registry.get_tasks_by_workspace(workspace)

    def run_in_background(
        self,
        _task_id: str,
        coro_func: Callable[..., Coroutine],
        *args: Any,
        **kwargs: Any,
    ) -> asyncio.Task:
        """Run a coroutine in the background, linked to the given _task_id."""
        task = self._registry.get_task(_task_id)
        if task:
            task.status = TaskStatus.RUNNING
            self._registry.update_task(task)
            asyncio.create_task(self._save_task_to_db(task))

        async def _wrapper():
            try:
                await coro_func(*args, **kwargs)
            except Exception as e:
                await self.fail_task(_task_id, str(e))

        bg_task = asyncio.create_task(_wrapper())
        return bg_task

    async def stream_progress(
        self, task_id: str, heartbeat_interval: float = 30.0
    ) -> AsyncGenerator[str, None]:
        """NDJSON line generator for streaming progress events.

        Yields NDJSON lines. Sends heartbeat comments every `heartbeat_interval` seconds.
        Terminates when task reaches a terminal status.
        """
        task = self._registry.get_task(task_id)
        if not task:
            yield json.dumps({"error": f"Task {task_id} not found"}) + "\n"
            return

        # If task is already in terminal state, yield final event and return
        if task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
            yield json.dumps(
                TaskProgressEvent(
                    task_id=task_id,
                    status=task.status,
                    progress=task.progress,
                    message=task.message,
                    detail=task.result,
                ).model_dump()
            ) + "\n"
            return

        yield json.dumps(
            TaskProgressEvent(
                task_id=task_id,
                status=task.status,
                progress=task.progress,
                message=task.message,
                detail=task.result,
            ).model_dump()
        ) + "\n"

        queue = self._registry.subscribe(task_id)
        try:
            while True:
                current = self._registry.get_task(task_id)
                if current and current.status in (
                    TaskStatus.COMPLETED,
                    TaskStatus.FAILED,
                    TaskStatus.CANCELLED,
                ):
                    yield json.dumps(
                        TaskProgressEvent(
                            task_id=task_id,
                            status=current.status,
                            progress=current.progress,
                            message=current.message,
                            detail=current.result,
                        ).model_dump()
                    ) + "\n"
                    return
                try:
                    event: TaskProgressEvent = await asyncio.wait_for(
                        queue.get(), timeout=heartbeat_interval
                    )
                    yield json.dumps(event.model_dump()) + "\n"

                    if event.status in (
                        TaskStatus.COMPLETED,
                        TaskStatus.FAILED,
                        TaskStatus.CANCELLED,
                    ):
                        return
                except asyncio.TimeoutError:
                    # Send heartbeat
                    yield json.dumps({"heartbeat": True, "task_id": task_id}) + "\n"
                    # Check if task was completed while we waited
                    current = self._registry.get_task(task_id)
                    if current and current.status in (
                        TaskStatus.COMPLETED,
                        TaskStatus.FAILED,
                        TaskStatus.CANCELLED,
                    ):
                        yield json.dumps(
                            TaskProgressEvent(
                                task_id=task_id,
                                status=current.status,
                                progress=current.progress,
                                message=current.message,
                                detail=current.result,
                            ).model_dump()
                        ) + "\n"
                        return
        finally:
            self._registry.unsubscribe(task_id, queue)

    def _persist_task_logs(self, task: Task) -> None:
        """Save completed task logs to JSON file."""
        if not self._log_storage_path:
            return
        try:
            log_file = self._log_storage_path / f"{task.task_id}.json"
            log_file.write_text(
                json.dumps(task.model_dump(), default=str, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as e:
            logger.warning(f"Failed to persist task logs for {task.task_id}: {e}")

    async def _save_task_to_db(self, task: Task) -> None:
        """Fire-and-forget: save task state to PostgreSQL."""
        if not self._db:
            return
        try:
            sql = """INSERT INTO LIGHTRAG_TASKS
                (workspace, task_id, task_type, status, progress, message,
                 result, error, metadata, created_at, updated_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
                        to_timestamp($10), to_timestamp($11))
                ON CONFLICT (workspace, task_id) DO UPDATE SET
                    status = EXCLUDED.status,
                    progress = EXCLUDED.progress,
                    message = EXCLUDED.message,
                    result = EXCLUDED.result,
                    error = EXCLUDED.error,
                    metadata = EXCLUDED.metadata,
                    updated_at = EXCLUDED.updated_at"""
            params = [
                task.workspace or "",
                task.task_id,
                task.task_type.value,
                task.status.value,
                task.progress,
                task.message or "",
                json.dumps(task.result) if task.result else None,
                task.error,
                json.dumps(task.metadata) if task.metadata else "{}",
                task.created_at,
                task.updated_at,
            ]
            await self._db.query(sql, params)
        except Exception as e:
            logger.warning(f"Failed to save task {task.task_id} to DB: {e}")

    def _fire_save_to_db(self, task: Task) -> None:
        """Schedule fire-and-forget DB save."""
        if not self._db:
            return
        try:
            asyncio.get_event_loop().create_task(self._save_task_to_db(task))
        except RuntimeError:
            pass  # No running event loop

    async def load_tasks_from_db(self, max_age_hours: int = 72) -> int:
        """Load recent tasks from DB into memory registry on startup.

        Tasks of certain types (e.g., board_ingest) are always loaded
        regardless of age because their metadata is needed for ongoing
        operations like board post viewing.
        """
        if not self._db:
            return 0
        try:
            sql = f"""SELECT task_id, task_type, workspace, status, progress, message,
                            result, error, metadata,
                            EXTRACT(EPOCH FROM created_at) as created_at,
                            EXTRACT(EPOCH FROM updated_at) as updated_at
                     FROM LIGHTRAG_TASKS
                     WHERE updated_at > NOW() - INTERVAL '{int(max_age_hours)} hours'
                        OR task_type IN ('board_ingest', 'url_ingest', 'document_ingest', 'document_scan')
                     ORDER BY created_at DESC"""
            rows = await self._db.query(sql, multirows=True)
            if not rows:
                return 0
            count = 0
            for row in rows:
                try:
                    # asyncpg may return JSONB as str — parse if needed
                    raw_result = row["result"]
                    if isinstance(raw_result, str):
                        raw_result = json.loads(raw_result)
                    raw_metadata = row["metadata"]
                    if isinstance(raw_metadata, str):
                        raw_metadata = json.loads(raw_metadata)

                    task = Task(
                        task_id=row["task_id"],
                        task_type=TaskType(row["task_type"]),
                        workspace=row["workspace"] or "",
                        status=TaskStatus(row["status"]),
                        progress=row["progress"] or 0.0,
                        message=row["message"] or "",
                        created_at=row["created_at"],
                        updated_at=row["updated_at"],
                        result=raw_result,
                        error=row["error"],
                        metadata=raw_metadata or {},
                    )
                    self._registry.add_task(task)
                    count += 1
                except (ValueError, KeyError) as e:
                    logger.warning(f"Skipping invalid task row: {e}")
            logger.info(f"Loaded {count} tasks from DB")
            return count
        except Exception as e:
            logger.warning(f"Failed to load tasks from DB: {e}")
            return 0


# ============================================================================
# Module-level singleton
# ============================================================================

_task_service: Optional[TaskService] = None


def get_task_service() -> TaskService:
    """Get or create the global TaskService singleton."""
    global _task_service
    if _task_service is None:
        _task_service = TaskService()
    return _task_service


def init_task_service(log_storage_path: Optional[Path] = None, db=None) -> TaskService:
    """Initialize the global TaskService with configuration."""
    global _task_service
    _task_service = TaskService(log_storage_path=log_storage_path, db=db)
    return _task_service
