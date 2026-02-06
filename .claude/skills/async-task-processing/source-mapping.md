# Async Task Processing - 소스 코드 매핑

## 1. 파일 구조 개요

```
/home/kms-rag/RAG-Anything/server/backend/app/
├── models/
│   ├── __init__.py
│   ├── enums.py              # TaskType, TaskStatus 열거형
│   ├── task.py               # Task 데이터 모델
│   ├── request.py            # API 요청 모델
│   └── response.py           # API 응답 모델
│
├── services/
│   ├── __init__.py
│   └── task_service.py       # TaskRegistry, TaskService (핵심)
│
├── api/v1/
│   ├── __init__.py
│   ├── tasks.py              # Task API 엔드포인트
│   ├── documents.py          # 문서 업로드 (태스크 사용 예시)
│   └── url.py                # URL 인제스트 (태스크 사용 예시)
│
├── utils/
│   └── logger.py             # 로깅 설정
│
├── config.py                 # 서버 설정
└── main.py                   # FastAPI 앱 라이프사이클
```

---

## 2. 핵심 모델 매핑

### 2.1 TaskType / TaskStatus

**파일:** `/home/kms-rag/RAG-Anything/server/backend/app/models/enums.py`

```python
from enum import Enum

class TaskType(str, Enum):
    """
    Task type enumeration

    Values:
    - DOCUMENT_UPLOAD: 문서 업로드 및 처리
    - URL_INGEST: URL 콘텐츠 인제스트
    - BATCH_PROCESS: 배치 처리
    - QUERY: 쿼리 처리 (선택적)
    """
    DOCUMENT_UPLOAD = "document_upload"
    URL_INGEST = "url_ingest"
    BATCH_PROCESS = "batch_process"
    QUERY = "query"


class TaskStatus(str, Enum):
    """
    Task status enumeration

    Lifecycle: PENDING → RUNNING → COMPLETED/FAILED/CANCELLED

    Values:
    - PENDING: 대기 중
    - RUNNING: 실행 중
    - COMPLETED: 완료
    - FAILED: 실패
    - CANCELLED: 취소됨
    """
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
```

### 2.2 Task Model

**파일:** `/home/kms-rag/RAG-Anything/server/backend/app/models/task.py`

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Any

@dataclass
class Task:
    """
    Task data model

    Fields:
    - task_id: str                    # 고유 ID (UUID)
    - task_type: TaskType             # 태스크 유형
    - status: TaskStatus              # 현재 상태
    - created_at: datetime            # 생성 시간
    - started_at: datetime | None     # 시작 시간
    - completed_at: datetime | None   # 완료 시간

    Progress fields:
    - current_stage: str              # 현재 단계 (예: "PARSING", "INGESTING")
    - current_message: str            # 진행 메시지
    - progress_percent: int           # 진행률 (0-100)

    Result fields:
    - result: dict | None             # 완료 시 결과 데이터
    - error: str | None               # 실패 시 에러 메시지

    Logging:
    - progress_logs: list[dict]       # 전체 진행 로그

    Metadata:
    - details: dict                   # 추가 메타데이터
    """

    task_id: str
    task_type: TaskType
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    current_stage: str = ""
    current_message: str = ""
    progress_percent: int = 0

    result: Optional[dict] = None
    error: Optional[str] = None

    progress_logs: list = field(default_factory=list)
    details: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization"""
        return {
            "task_id": self.task_id,
            "task_type": self.task_type.value,
            "status": self.status.value,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "current_stage": self.current_stage,
            "current_message": self.current_message,
            "progress_percent": self.progress_percent,
            "result": self.result,
            "error": self.error,
            "details": self.details
        }


@dataclass
class TaskProgressEvent:
    """
    Progress event for SSE streaming

    Fields:
    - task_id: str
    - status: TaskStatus
    - stage: str
    - message: str
    - progress: int (0-100)
    - result: dict | None (when completed)
    - error: str | None (when failed)
    - timestamp: datetime
    """

    task_id: str
    status: TaskStatus
    stage: str
    message: str
    progress: int
    result: Optional[dict] = None
    error: Optional[str] = None
    timestamp: datetime = field(default_factory=datetime.now)

    def to_sse_data(self) -> str:
        """Format as SSE data string"""
        import json
        return json.dumps({
            "task_id": self.task_id,
            "status": self.status.value,
            "stage": self.stage,
            "message": self.message,
            "progress": self.progress,
            "result": self.result,
            "error": self.error,
            "timestamp": self.timestamp.isoformat()
        })
```

---

## 3. Task Service 상세

### 3.1 TaskRegistry

**파일:** `/home/kms-rag/RAG-Anything/server/backend/app/services/task_service.py`

```python
import asyncio
from collections import OrderedDict
from typing import Dict, List

class TaskRegistry:
    """
    In-memory task storage with LRU cleanup

    Attributes:
    - tasks: OrderedDict[str, Task]           # task_id → Task
    - subscribers: Dict[str, List[Queue]]     # task_id → SSE queues
    - max_tasks: int = 1000                   # Maximum stored tasks
    - cleanup_threshold: int = 800            # Cleanup trigger point

    Key methods:

    add_task(task: Task) -> None:
        - Store task in registry
        - Trigger cleanup if over threshold

    get_task(task_id: str) -> Task | None:
        - Retrieve task by ID

    update_task(task: Task) -> None:
        - Update existing task
        - Move to end (LRU)

    remove_task(task_id: str) -> None:
        - Remove task from registry
        - Clean up subscribers

    subscribe(task_id: str) -> asyncio.Queue:
        - Create new Queue for SSE
        - Add to subscribers list
        - Return queue

    unsubscribe(task_id: str, queue: asyncio.Queue) -> None:
        - Remove queue from subscribers

    notify_subscribers(task_id: str, event: TaskProgressEvent) -> None:
        - Put event in all subscriber queues
        - Non-blocking (use put_nowait)

    _cleanup() -> None:
        - Remove oldest completed/failed tasks
        - Keep running tasks
        - Maintain max_tasks limit
    """

    def __init__(self, max_tasks: int = 1000):
        self.tasks: OrderedDict[str, Task] = OrderedDict()
        self.subscribers: Dict[str, List[asyncio.Queue]] = {}
        self.max_tasks = max_tasks
        self.cleanup_threshold = int(max_tasks * 0.8)

    async def notify_subscribers(self, task_id: str, event: TaskProgressEvent):
        """Notify all SSE subscribers of progress update"""
        if task_id in self.subscribers:
            for queue in self.subscribers[task_id]:
                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    pass  # Skip if queue is full
```

### 3.2 TaskService

**파일:** `/home/kms-rag/RAG-Anything/server/backend/app/services/task_service.py`

```python
import uuid
import json
from pathlib import Path

class TaskService:
    """
    Singleton task management service

    Initialization:
    - Create TaskRegistry
    - Setup log directory
    - Start cleanup scheduler

    Attributes:
    - registry: TaskRegistry
    - log_dir: Path
    - instance: TaskService (singleton)

    Key methods:

    create_task(task_type: TaskType, details: dict = None) -> str:
        1. Generate UUID task_id
        2. Create Task instance
        3. Add to registry
        4. Return task_id

    start_task(task_id: str) -> None:
        - Update status to RUNNING
        - Set started_at
        - Log progress

    update_progress(
        task_id: str,
        stage: str,
        message: str,
        progress: int
    ) -> None:
        1. Get task from registry
        2. Update progress fields
        3. Add to progress_logs
        4. Create TaskProgressEvent
        5. Notify subscribers
        6. Save log file

    complete_task(task_id: str, result: dict) -> None:
        - Update status to COMPLETED
        - Set completed_at
        - Store result
        - Notify subscribers
        - Save final log

    fail_task(task_id: str, error: str) -> None:
        - Update status to FAILED
        - Set completed_at
        - Store error
        - Notify subscribers
        - Save error log

    cancel_task(task_id: str) -> bool:
        - Update status to CANCELLED
        - Return success/failure

    get_task(task_id: str) -> Task | None:
        - Retrieve task from registry

    list_tasks(
        task_type: TaskType = None,
        status: TaskStatus = None,
        limit: int = 100
    ) -> list[Task]:
        - Filter and return tasks

    async stream_progress(task_id: str) -> AsyncGenerator:
        1. Subscribe to task
        2. Yield initial state
        3. Loop:
           - Wait for event with timeout
           - Yield event as SSE
           - Send heartbeat on timeout
           - Break on completion
        4. Unsubscribe

    _save_task_log(task: Task) -> None:
        - Save task to JSON file
        - Include all progress_logs
    """

    _instance = None

    @classmethod
    def get_instance(cls) -> "TaskService":
        if cls._instance is None:
            cls._instance = TaskService()
        return cls._instance

    def __init__(self):
        self.registry = TaskRegistry()
        self.log_dir = Path("logs/tasks")
        self.log_dir.mkdir(parents=True, exist_ok=True)

    async def run_in_background(
        self,
        task_id: str,
        coro: Coroutine
    ) -> None:
        """
        Execute coroutine in background with task tracking

        Usage:
            task_id = task_service.create_task(TaskType.DOCUMENT_UPLOAD)
            asyncio.create_task(
                task_service.run_in_background(task_id, process_document())
            )
        """
        try:
            self.start_task(task_id)
            result = await coro
            self.complete_task(task_id, result)
        except Exception as e:
            self.fail_task(task_id, str(e))

    async def stream_progress(self, task_id: str):
        """
        Async generator for SSE streaming

        Yields:
            str: SSE formatted data

        Example SSE output:
            data: {"task_id": "xxx", "status": "running", "progress": 50, ...}

            data: {"task_id": "xxx", "status": "completed", "result": {...}}
        """
        queue = self.registry.subscribe(task_id)
        task = self.registry.get_task(task_id)

        # Yield initial state
        if task:
            yield self._format_sse(TaskProgressEvent(
                task_id=task_id,
                status=task.status,
                stage=task.current_stage,
                message=task.current_message,
                progress=task.progress_percent,
                result=task.result,
                error=task.error
            ))

        try:
            while True:
                try:
                    # Wait for event with 30s timeout
                    event = await asyncio.wait_for(
                        queue.get(),
                        timeout=30.0
                    )
                    yield self._format_sse(event)

                    # Break on terminal states
                    if event.status in (
                        TaskStatus.COMPLETED,
                        TaskStatus.FAILED,
                        TaskStatus.CANCELLED
                    ):
                        break

                except asyncio.TimeoutError:
                    # Send heartbeat
                    yield ": heartbeat\n\n"

        finally:
            self.registry.unsubscribe(task_id, queue)

    def _format_sse(self, event: TaskProgressEvent) -> str:
        """Format event as SSE data"""
        return f"data: {event.to_sse_data()}\n\n"
```

---

## 4. Task API 상세

### 4.1 Tasks API Endpoints

**파일:** `/home/kms-rag/RAG-Anything/server/backend/app/api/v1/tasks.py`

```python
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/tasks", tags=["tasks"])

@router.get("")
async def list_tasks(
    task_type: str = None,
    status: str = None,
    limit: int = 100
) -> list[dict]:
    """
    List all tasks with optional filtering

    Query params:
    - task_type: Filter by type (document_upload, url_ingest, etc.)
    - status: Filter by status (pending, running, completed, failed)
    - limit: Maximum number of tasks to return

    Response:
    [
        {
            "task_id": "...",
            "task_type": "document_upload",
            "status": "completed",
            "progress_percent": 100,
            ...
        }
    ]
    """
    task_service = TaskService.get_instance()
    tasks = task_service.list_tasks(
        task_type=TaskType(task_type) if task_type else None,
        status=TaskStatus(status) if status else None,
        limit=limit
    )
    return [task.to_dict() for task in tasks]


@router.get("/{task_id}")
async def get_task(task_id: str) -> dict:
    """
    Get task by ID

    Response:
    {
        "task_id": "...",
        "task_type": "document_upload",
        "status": "running",
        "current_stage": "PARSING",
        "current_message": "Parsing document...",
        "progress_percent": 30,
        ...
    }
    """
    task_service = TaskService.get_instance()
    task = task_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task.to_dict()


@router.get("/{task_id}/stream")
async def stream_task_progress(task_id: str):
    """
    SSE stream for task progress

    Response: Server-Sent Events stream

    Event format:
        data: {"task_id": "...", "status": "running", "progress": 50, ...}

        data: {"task_id": "...", "status": "completed", "result": {...}}

    Heartbeat (every 30s):
        : heartbeat
    """
    task_service = TaskService.get_instance()
    task = task_service.get_task(task_id)

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return StreamingResponse(
        task_service.stream_progress(task_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # Disable nginx buffering
        }
    )


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: str) -> dict:
    """
    Cancel a running task

    Response:
    {
        "success": true,
        "task_id": "..."
    }
    """
    task_service = TaskService.get_instance()
    success = task_service.cancel_task(task_id)
    if not success:
        raise HTTPException(status_code=400, detail="Cannot cancel task")
    return {"success": True, "task_id": task_id}


@router.get("/logs")
async def list_task_logs(limit: int = 50) -> list[str]:
    """
    List saved task log files

    Response:
    ["task_xxx.json", "task_yyy.json", ...]
    """
    task_service = TaskService.get_instance()
    log_files = sorted(
        task_service.log_dir.glob("*.json"),
        key=lambda f: f.stat().st_mtime,
        reverse=True
    )[:limit]
    return [f.name for f in log_files]


@router.get("/logs/{task_id}")
async def get_task_log(task_id: str) -> dict:
    """
    Get saved task log by ID

    Response:
    {
        "task_id": "...",
        "progress_logs": [...],
        ...
    }
    """
    task_service = TaskService.get_instance()
    log_file = task_service.log_dir / f"{task_id}.json"
    if not log_file.exists():
        raise HTTPException(status_code=404, detail="Log not found")

    with open(log_file) as f:
        return json.load(f)
```

---

## 5. 사용 예시

### 5.1 문서 업로드 (Async)

**파일:** `/home/kms-rag/RAG-Anything/server/backend/app/api/v1/documents.py`

```python
@router.post("/upload-async")
async def upload_document_async(
    file: UploadFile = File(...),
    parse_method: str = Query("txt")
):
    """
    Async document upload with task tracking

    Flow:
    1. Save uploaded file
    2. Create task
    3. Queue background processing
    4. Return task_id and stream_url
    """
    # Save file
    file_path = await save_uploaded_file(file)

    # Create task
    task_service = TaskService.get_instance()
    task_id = task_service.create_task(
        TaskType.DOCUMENT_UPLOAD,
        details={"file_path": file_path, "parse_method": parse_method}
    )

    # Queue background work
    async def process():
        try:
            task_service.update_progress(
                task_id, "PARSING", "Parsing document...", 20
            )
            content_list = await parse_document(file_path, parse_method)

            task_service.update_progress(
                task_id, "INGESTING", "Ingesting content...", 50
            )
            doc_id = await raganything.insert_content_list(content_list)

            task_service.update_progress(
                task_id, "FINALIZING", "Finalizing...", 90
            )
            return {"doc_id": doc_id, "content_count": len(content_list)}

        except Exception as e:
            raise

    asyncio.create_task(
        task_service.run_in_background(task_id, process())
    )

    return {
        "task_id": task_id,
        "stream_url": f"/api/v1/tasks/{task_id}/stream"
    }
```

### 5.2 URL 인제스트 (Async)

**파일:** `/home/kms-rag/RAG-Anything/server/backend/app/api/v1/url.py`

```python
@router.post("/ingest-async")
async def ingest_url_async(request: URLIngestRequest):
    """
    Async URL ingestion with task tracking

    Flow:
    1. Create task
    2. Queue background URL processing
    3. Update progress at each stage
    4. Return task_id and stream_url
    """
    task_service = TaskService.get_instance()
    task_id = task_service.create_task(
        TaskType.URL_INGEST,
        details={"url": request.url, "crawl": request.crawl}
    )

    async def process():
        task_service.update_progress(
            task_id, "VALIDATING", "Validating URL...", 10
        )
        # Validate URL

        task_service.update_progress(
            task_id, "FETCHING", "Fetching content...", 30
        )
        # Fetch content

        task_service.update_progress(
            task_id, "PARSING", "Parsing HTML...", 50
        )
        # Parse HTML

        task_service.update_progress(
            task_id, "CONVERTING", "Converting content...", 70
        )
        # Convert to content_list

        task_service.update_progress(
            task_id, "INGESTING", "Ingesting to knowledge graph...", 90
        )
        # Insert to LightRAG

        return {"doc_id": doc_id, "url": request.url}

    asyncio.create_task(
        task_service.run_in_background(task_id, process())
    )

    return {
        "task_id": task_id,
        "stream_url": f"/api/v1/tasks/{task_id}/stream"
    }
```

---

## 6. SSE 클라이언트 예시

### 6.1 JavaScript 클라이언트

```javascript
// Frontend SSE client example

function subscribeToTask(taskId) {
    const eventSource = new EventSource(`/api/v1/tasks/${taskId}/stream`);

    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        console.log(`Progress: ${data.progress}%`);
        console.log(`Stage: ${data.stage}`);
        console.log(`Message: ${data.message}`);

        // Update UI
        updateProgressBar(data.progress);
        updateStatusMessage(data.message);

        // Check completion
        if (data.status === 'completed') {
            console.log('Task completed:', data.result);
            eventSource.close();
        } else if (data.status === 'failed') {
            console.error('Task failed:', data.error);
            eventSource.close();
        }
    };

    eventSource.onerror = (error) => {
        console.error('SSE error:', error);
        eventSource.close();
    };

    return eventSource;
}
```

### 6.2 Python 클라이언트

```python
# Python SSE client example
import httpx
import json

async def subscribe_to_task(task_id: str, base_url: str):
    """Subscribe to task progress via SSE"""
    url = f"{base_url}/api/v1/tasks/{task_id}/stream"

    async with httpx.AsyncClient() as client:
        async with client.stream("GET", url) as response:
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data = json.loads(line[6:])

                    print(f"Progress: {data['progress']}%")
                    print(f"Stage: {data['stage']}")

                    if data['status'] in ('completed', 'failed'):
                        return data
```

---

## 7. 이관 시 주의사항

### 7.1 의존성

```
Task Service 의존성:
- fastapi: Web framework
- asyncio: Async support
- uuid: Task ID generation
- pathlib: File path handling
- json: Serialization
```

### 7.2 설정 옵션

```python
# Task service configuration
TASK_MAX_STORED = 1000          # Maximum tasks in registry
TASK_LOG_DIR = "logs/tasks"     # Log file directory
SSE_HEARTBEAT_INTERVAL = 30     # Heartbeat interval (seconds)
SSE_QUEUE_SIZE = 100            # Max queue size per subscriber
```

### 7.3 이관 순서

```
1. Task, TaskType, TaskStatus 모델 정의
2. TaskProgressEvent 모델 정의
3. TaskRegistry 구현
4. TaskService 구현 (Singleton)
5. SSE 스트리밍 구현
6. Task API 엔드포인트 추가
7. 기존 API에 async 버전 추가
8. 클라이언트 예제 작성
```

### 7.4 LightRAG 통합

```python
# LightRAG에 통합 시 사용 패턴

# 1. ainsert_async() 메서드 추가
async def ainsert_async(self, content, ...) -> str:
    """Async insert with task tracking"""
    task_id = task_service.create_task(TaskType.DOCUMENT_UPLOAD)

    asyncio.create_task(
        task_service.run_in_background(
            task_id,
            self.ainsert(content, ...)
        )
    )

    return task_id

# 2. 진행상황 콜백 지원
async def ainsert(
    self,
    content,
    progress_callback: Callable[[str, int], None] = None,
    ...
):
    """Insert with optional progress callback"""
    if progress_callback:
        progress_callback("PARSING", 20)
    # ... parsing ...

    if progress_callback:
        progress_callback("EXTRACTING", 50)
    # ... extraction ...
```
