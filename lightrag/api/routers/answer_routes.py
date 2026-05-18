"""Answer catalog routes for fixed-answer / FAQ workspaces."""

from __future__ import annotations

import json
import csv
import hashlib
import io
import re
import time
import traceback
import uuid
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from lightrag.kg.shared_storage import get_default_workspace
from lightrag.utils import logger

from ..utils_api import decode_workspace_header, get_combined_auth_dependency

router = APIRouter(prefix="/api/answers", tags=["answers"])

_get_rag_for_workspace = None
_ensured_dbs: set[int] = set()

AnswerStatus = Literal["draft", "published", "archived", "expired"]
DisplayPolicy = Literal["summary", "full", "both"]
ContentFormat = Literal["plain", "markdown", "html"]
GuidanceType = Literal["keyword", "question", "synonym", "negative_keyword", "note"]
ResolveStrategy = Literal["fast", "balanced"]
StructuredOperator = Literal["contains", "equals", "starts_with", "ends_with"]

VALID_WORKSPACE_MODES = {"kms", "answer_catalog", "hybrid"}
ANSWER_WORKSPACE_MODES = {"answer_catalog", "hybrid"}
TOKEN_RE = re.compile(r"[0-9A-Za-z가-힣_]+")
GUIDANCE_TYPE_MULTIPLIER = {
    "question": 1.25,
    "keyword": 1.0,
    "synonym": 0.9,
    "note": 0.55,
    "negative_keyword": -1.4,
}


def set_rag_workspace_getter(getter_func):
    """Set the function to get a workspace-scoped RAG instance."""
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
    if workspace_rag is None:
        workspace_rag = default_rag
        logger.warning("[Answers] Using default RAG instance for workspace: %s", workspace)
    return workspace, workspace_rag


def _db_from_rag(rag):
    if hasattr(rag, "llm_response_cache") and hasattr(rag.llm_response_cache, "db"):
        return rag.llm_response_cache.db
    if hasattr(rag, "text_chunks") and hasattr(rag.text_chunks, "db"):
        return rag.text_chunks.db
    return None


def _json(value: Any) -> str:
    if isinstance(value, str):
        parsed = _coerce_json(value, None)
        if isinstance(parsed, dict):
            value = parsed
    return json.dumps(value if value is not None else {}, ensure_ascii=False)


def _json_list(value: Any) -> str:
    if isinstance(value, str):
        parsed = _coerce_json(value, None)
        if isinstance(parsed, list):
            value = parsed
    return json.dumps(value if value is not None else [], ensure_ascii=False)


def _coerce_json(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, str):
        current: Any = value
        for _ in range(2):
            if not isinstance(current, str):
                return current
            try:
                current = json.loads(current)
            except json.JSONDecodeError:
                return default
        return current
    return value


async def _workspace_mode_from_db(db, workspace: str) -> str:
    workspace_row = None
    if hasattr(db, "get_workspace"):
        workspace_row = await db.get_workspace(workspace)
    else:
        workspace_row = await db.query(
            "SELECT metadata FROM LIGHTRAG_WORKSPACES WHERE workspace_id = $1",
            [workspace],
        )

    if not workspace_row:
        raise HTTPException(status_code=404, detail=f"Workspace '{workspace}' not found")

    metadata = _coerce_json(workspace_row.get("metadata"), {})
    if not isinstance(metadata, dict):
        metadata = {}
    mode = metadata.get("workspace_mode") or "kms"
    return mode if mode in VALID_WORKSPACE_MODES else "kms"


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _ensure_tables(db) -> None:
    db_key = id(db)
    if db_key in _ensured_dbs:
        return

    statements = [
        """
        CREATE TABLE IF NOT EXISTS LIGHTRAG_ANSWER_ITEMS (
            workspace TEXT NOT NULL,
            answer_id TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            approved_summary TEXT,
            content_format TEXT NOT NULL DEFAULT 'markdown',
            display_policy TEXT NOT NULL DEFAULT 'both',
            status TEXT NOT NULL DEFAULT 'draft',
            version INTEGER NOT NULL DEFAULT 1,
            valid_from TIMESTAMPTZ,
            valid_until TIMESTAMPTZ,
            priority INTEGER NOT NULL DEFAULT 0,
            tags JSONB NOT NULL DEFAULT '[]'::jsonb,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            publish_time TIMESTAMPTZ,
            create_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            update_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (workspace, answer_id)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS LIGHTRAG_ANSWER_REVISIONS (
            revision_id TEXT PRIMARY KEY,
            workspace TEXT NOT NULL,
            answer_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            snapshot_json JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS LIGHTRAG_ANSWER_GUIDANCE (
            guidance_id TEXT PRIMARY KEY,
            workspace TEXT NOT NULL,
            answer_id TEXT NOT NULL,
            guidance_type TEXT NOT NULL DEFAULT 'keyword',
            text TEXT NOT NULL,
            weight DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            create_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS LIGHTRAG_ANSWER_EVENTS (
            event_id TEXT PRIMARY KEY,
            workspace TEXT NOT NULL,
            event_type TEXT NOT NULL,
            query TEXT,
            selected_answer_id TEXT,
            candidate_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
            scores JSONB NOT NULL DEFAULT '{}'::jsonb,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            create_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS LIGHTRAG_ANSWER_SOURCE_SNAPSHOTS (
            snapshot_id TEXT PRIMARY KEY,
            workspace TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_uri TEXT,
            file_name TEXT,
            title TEXT,
            raw_content TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            content_length INTEGER NOT NULL DEFAULT 0,
            profile JSONB NOT NULL DEFAULT '{}'::jsonb,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_answer_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
            status TEXT NOT NULL DEFAULT 'captured',
            task_id TEXT,
            create_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS LIGHTRAG_ANSWER_SOURCE_LINKS (
            link_id TEXT PRIMARY KEY,
            workspace TEXT NOT NULL,
            answer_id TEXT NOT NULL,
            answer_version INTEGER NOT NULL DEFAULT 1,
            snapshot_id TEXT NOT NULL,
            link_type TEXT NOT NULL DEFAULT 'created_from',
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            create_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS IDX_ANSWERS_WORKSPACE_STATUS ON LIGHTRAG_ANSWER_ITEMS(workspace, status)",
        "CREATE INDEX IF NOT EXISTS IDX_ANSWERS_WORKSPACE_UPDATE ON LIGHTRAG_ANSWER_ITEMS(workspace, update_time DESC)",
        "CREATE INDEX IF NOT EXISTS IDX_ANSWER_GUIDANCE_WORKSPACE_ANSWER ON LIGHTRAG_ANSWER_GUIDANCE(workspace, answer_id)",
        "CREATE INDEX IF NOT EXISTS IDX_ANSWER_EVENTS_WORKSPACE_TIME ON LIGHTRAG_ANSWER_EVENTS(workspace, create_time DESC)",
        "CREATE INDEX IF NOT EXISTS IDX_ANSWER_SOURCE_SNAPSHOTS_WORKSPACE_TIME ON LIGHTRAG_ANSWER_SOURCE_SNAPSHOTS(workspace, create_time DESC)",
        "CREATE INDEX IF NOT EXISTS IDX_ANSWER_SOURCE_SNAPSHOTS_WORKSPACE_HASH ON LIGHTRAG_ANSWER_SOURCE_SNAPSHOTS(workspace, content_hash)",
        "CREATE INDEX IF NOT EXISTS IDX_ANSWER_SOURCE_LINKS_WORKSPACE_ANSWER ON LIGHTRAG_ANSWER_SOURCE_LINKS(workspace, answer_id)",
        "CREATE INDEX IF NOT EXISTS IDX_ANSWER_SOURCE_LINKS_WORKSPACE_SNAPSHOT ON LIGHTRAG_ANSWER_SOURCE_LINKS(workspace, snapshot_id)",
    ]
    for statement in statements:
        await db.execute(statement)
    _ensured_dbs.add(db_key)


class AnswerItem(BaseModel):
    answer_id: str
    workspace: str
    title: str
    body: str
    approved_summary: Optional[str] = None
    content_format: ContentFormat = "markdown"
    display_policy: DisplayPolicy = "both"
    status: AnswerStatus = "draft"
    version: int = 1
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    priority: int = 0
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    publish_time: Optional[str] = None
    create_time: Optional[str] = None
    update_time: Optional[str] = None


class AnswerGuidance(BaseModel):
    guidance_id: str
    answer_id: str
    workspace: str
    guidance_type: GuidanceType = "keyword"
    text: str
    weight: float = 1.0
    metadata: dict[str, Any] = Field(default_factory=dict)
    create_time: Optional[str] = None


class AnswerRevision(BaseModel):
    revision_id: str
    answer_id: str
    workspace: str
    version: int
    snapshot: dict[str, Any]
    created_at: Optional[str] = None


class AnswerEvent(BaseModel):
    event_id: str
    workspace: str
    event_type: str
    query: Optional[str] = None
    selected_answer_id: Optional[str] = None
    candidate_ids: list[str] = Field(default_factory=list)
    scores: dict[str, float] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    create_time: Optional[str] = None


class AnswerCreateRequest(BaseModel):
    answer_id: Optional[str] = Field(default=None, description="Optional stable answer id. Defaults to ANS-<uuid>.")
    title: str = Field(..., min_length=1, max_length=500)
    body: str = Field(..., min_length=1)
    approved_summary: Optional[str] = None
    content_format: ContentFormat = "markdown"
    display_policy: DisplayPolicy = "both"
    status: AnswerStatus = "draft"
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    priority: int = 0
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    guidance: list[str] = Field(default_factory=list, description="Initial keyword/question guidance texts.")


class AnswerUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=500)
    body: Optional[str] = Field(default=None, min_length=1)
    approved_summary: Optional[str] = None
    content_format: Optional[ContentFormat] = None
    display_policy: Optional[DisplayPolicy] = None
    status: Optional[AnswerStatus] = None
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    priority: Optional[int] = None
    tags: Optional[list[str]] = None
    metadata: Optional[dict[str, Any]] = None


class GuidanceCreateRequest(BaseModel):
    guidance_type: GuidanceType = "keyword"
    text: str = Field(..., min_length=1)
    weight: float = Field(default=1.0, ge=0.0, le=10.0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AnswerListResponse(BaseModel):
    answers: list[AnswerItem]
    total: int
    page: int
    page_size: int


class ResolveRequest(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: int = Field(default=5, ge=1, le=20)
    min_score: float = Field(default=0.18, ge=0.0, le=1.0)
    include_drafts: bool = False
    strategy: ResolveStrategy = "balanced"


class ResolveCandidate(BaseModel):
    answer: AnswerItem
    score: float
    matched_guidance: list[str] = Field(default_factory=list)
    reason: str
    score_details: dict[str, float] = Field(default_factory=dict)


class ResolveResponse(BaseModel):
    selected_answer: Optional[AnswerItem]
    confidence: float
    candidates: list[ResolveCandidate]
    trace_id: str
    rationale: str


class AnswerSearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: int = Field(default=5, ge=1, le=20)
    min_score: float = Field(default=0.18, ge=0.0, le=1.0)
    include_drafts: bool = False
    strategy: ResolveStrategy = "balanced"
    response_policy: Optional[DisplayPolicy] = None
    include_candidates: bool = True


class AnswerSearchResponse(BaseModel):
    matched: bool
    answer_id: Optional[str] = None
    title: Optional[str] = None
    response: Optional[str] = None
    summary: Optional[str] = None
    full_content: Optional[str] = None
    display_policy: Optional[DisplayPolicy] = None
    content_format: Optional[ContentFormat] = None
    status: Optional[AnswerStatus] = None
    version: Optional[int] = None
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    confidence: float = 0.0
    tags: list[str] = Field(default_factory=list)
    source_type: Optional[str] = None
    source_uri: Optional[str] = None
    candidates: list[ResolveCandidate] = Field(default_factory=list)
    trace_id: str
    rationale: str


class AnswerViewRequest(BaseModel):
    query: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AnswerFeedbackRequest(BaseModel):
    query: Optional[str] = None
    helpful: Optional[bool] = None
    note: Optional[str] = None
    selected_alternative_id: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class SourceGuidanceCandidate(BaseModel):
    guidance_type: GuidanceType = "keyword"
    text: str = Field(..., min_length=1)
    weight: float = Field(default=1.0, ge=0.0, le=10.0)
    source: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AnswerSourceDraftRequest(BaseModel):
    answer_id: Optional[str] = Field(default=None, description="Optional stable answer id. Defaults to ANS-<uuid>.")
    source_type: Literal["plain", "markdown", "html", "url", "file", "structured"] = "plain"
    source_uri: Optional[str] = None
    file_name: Optional[str] = None
    title: str = Field(..., min_length=1, max_length=500)
    body: str = Field(..., min_length=1)
    approved_summary: Optional[str] = None
    content_format: ContentFormat = "markdown"
    display_policy: DisplayPolicy = "both"
    status: AnswerStatus = "draft"
    priority: int = 0
    tags: list[str] = Field(default_factory=list)
    source_profile: dict[str, Any] = Field(default_factory=dict)
    guidance: list[SourceGuidanceCandidate] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AnswerSourceDraftResponse(BaseModel):
    answer: AnswerItem
    guidance: list[AnswerGuidance] = Field(default_factory=list)
    snapshot: Optional["AnswerSourceSnapshot"] = None
    source_link: Optional["AnswerSourceLink"] = None


class AnswerSourceSnapshot(BaseModel):
    snapshot_id: str
    workspace: str
    source_type: str
    source_uri: Optional[str] = None
    file_name: Optional[str] = None
    title: Optional[str] = None
    content_hash: str
    content_length: int = 0
    content_preview: Optional[str] = None
    profile: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_answer_ids: list[str] = Field(default_factory=list)
    status: str = "captured"
    task_id: Optional[str] = None
    create_time: Optional[str] = None


class AnswerSourceLink(BaseModel):
    link_id: str
    workspace: str
    answer_id: str
    answer_version: int = 1
    snapshot_id: str
    link_type: str = "created_from"
    metadata: dict[str, Any] = Field(default_factory=dict)
    create_time: Optional[str] = None
    snapshot: Optional[AnswerSourceSnapshot] = None


class StructuredDataset(BaseModel):
    answer_id: str
    title: str
    status: AnswerStatus
    source_type: str = "-"
    source_uri: Optional[str] = None
    kind: str = "text"
    columns: list[str] = Field(default_factory=list)
    row_count: int = 0
    sample_rows: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class StructuredFilter(BaseModel):
    field: str = Field(..., min_length=1)
    operator: StructuredOperator = "contains"
    value: str = ""


class StructuredQueryRequest(BaseModel):
    answer_id: str = Field(..., min_length=1)
    filters: list[StructuredFilter] = Field(default_factory=list)
    limit: int = Field(default=20, ge=1, le=100)
    preview_only: bool = False


class StructuredQueryResponse(BaseModel):
    answer_id: str
    title: str
    pseudo_sql: str
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int
    preview_only: bool = False


def _answer_from_row(row: dict[str, Any]) -> AnswerItem:
    tags = _coerce_json(row.get("tags"), [])
    if isinstance(tags, str):
        tags = [tags]
    if not isinstance(tags, list):
        tags = []
    metadata = _coerce_json(row.get("metadata"), {})
    if not isinstance(metadata, dict):
        metadata = {}
    return AnswerItem(
        answer_id=str(row["answer_id"]),
        workspace=str(row["workspace"]),
        title=str(row["title"]),
        body=str(row["body"]),
        approved_summary=row.get("approved_summary"),
        content_format=row.get("content_format") or "markdown",
        display_policy=row.get("display_policy") or "both",
        status=row.get("status") or "draft",
        version=int(row.get("version") or 1),
        valid_from=_iso(row.get("valid_from")),
        valid_until=_iso(row.get("valid_until")),
        priority=int(row.get("priority") or 0),
        tags=tags,
        metadata=metadata,
        publish_time=_iso(row.get("publish_time")),
        create_time=_iso(row.get("create_time")),
        update_time=_iso(row.get("update_time")),
    )


def _guidance_from_row(row: dict[str, Any]) -> AnswerGuidance:
    metadata = _coerce_json(row.get("metadata"), {})
    if not isinstance(metadata, dict):
        metadata = {}
    return AnswerGuidance(
        guidance_id=str(row["guidance_id"]),
        workspace=str(row["workspace"]),
        answer_id=str(row["answer_id"]),
        guidance_type=row.get("guidance_type") or "keyword",
        text=str(row["text"]),
        weight=float(row.get("weight") or 1.0),
        metadata=metadata,
        create_time=_iso(row.get("create_time")),
    )


def _event_from_row(row: dict[str, Any]) -> AnswerEvent:
    candidate_ids = _coerce_json(row.get("candidate_ids"), [])
    if not isinstance(candidate_ids, list):
        candidate_ids = []
    scores = _coerce_json(row.get("scores"), {})
    if not isinstance(scores, dict):
        scores = {}
    metadata = _coerce_json(row.get("metadata"), {})
    if not isinstance(metadata, dict):
        metadata = {}
    return AnswerEvent(
        event_id=str(row["event_id"]),
        workspace=str(row["workspace"]),
        event_type=str(row["event_type"]),
        query=row.get("query"),
        selected_answer_id=row.get("selected_answer_id"),
        candidate_ids=[str(item) for item in candidate_ids],
        scores={str(key): float(value) for key, value in scores.items() if isinstance(value, (int, float))},
        metadata=metadata,
        create_time=_iso(row.get("create_time")),
    )


def _content_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _source_snapshot_from_row(row: dict[str, Any]) -> AnswerSourceSnapshot:
    profile = _coerce_json(row.get("profile"), {})
    if not isinstance(profile, dict):
        profile = {}
    metadata = _coerce_json(row.get("metadata"), {})
    if not isinstance(metadata, dict):
        metadata = {}
    created_answer_ids = _coerce_json(row.get("created_answer_ids"), [])
    if not isinstance(created_answer_ids, list):
        created_answer_ids = []
    preview = row.get("content_preview")
    if preview is None and row.get("raw_content") is not None:
        preview = str(row.get("raw_content"))[:600]
    return AnswerSourceSnapshot(
        snapshot_id=str(row["snapshot_id"]),
        workspace=str(row["workspace"]),
        source_type=str(row.get("source_type") or "plain"),
        source_uri=row.get("source_uri"),
        file_name=row.get("file_name"),
        title=row.get("title"),
        content_hash=str(row.get("content_hash") or ""),
        content_length=int(row.get("content_length") or 0),
        content_preview=preview,
        profile=profile,
        metadata=metadata,
        created_answer_ids=[str(item) for item in created_answer_ids],
        status=str(row.get("status") or "captured"),
        task_id=row.get("task_id"),
        create_time=_iso(row.get("create_time")),
    )


def _source_link_from_row(
    row: dict[str, Any],
    snapshot: Optional[AnswerSourceSnapshot] = None,
) -> AnswerSourceLink:
    metadata = _coerce_json(row.get("metadata"), {})
    if not isinstance(metadata, dict):
        metadata = {}
    return AnswerSourceLink(
        link_id=str(row["link_id"]),
        workspace=str(row["workspace"]),
        answer_id=str(row["answer_id"]),
        answer_version=int(row.get("answer_version") or 1),
        snapshot_id=str(row["snapshot_id"]),
        link_type=str(row.get("link_type") or "created_from"),
        metadata=metadata,
        create_time=_iso(row.get("create_time")),
        snapshot=snapshot,
    )


def _structured_profile(answer: AnswerItem) -> dict[str, Any]:
    profile = answer.metadata.get("source_profile") if isinstance(answer.metadata, dict) else {}
    if not isinstance(profile, dict):
        profile = {}
    structured = profile.get("structured")
    if not isinstance(structured, dict):
        structured = profile
    columns = structured.get("columns") or profile.get("columns") or []
    if not isinstance(columns, list):
        columns = []
    row_count = structured.get("rowCount") or structured.get("row_count") or profile.get("rowCount") or profile.get("row_count") or 0
    try:
        row_count = int(row_count)
    except (TypeError, ValueError):
        row_count = 0
    return {
        "kind": structured.get("kind") or profile.get("kind") or answer.metadata.get("source_type") or "text",
        "columns": [str(column) for column in columns if str(column).strip()],
        "row_count": row_count,
    }


def _row_value(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return json.dumps(value, ensure_ascii=False)


def _rows_from_answer(answer: AnswerItem) -> tuple[list[dict[str, Any]], list[str], str]:
    body = answer.body.strip()
    rows: list[dict[str, Any]] = []
    kind = "text"

    if body:
        try:
            parsed = json.loads(body)
            raw_rows = parsed if isinstance(parsed, list) else [parsed]
            object_rows = [row for row in raw_rows if isinstance(row, dict)]
            if object_rows:
                rows = [{str(key): _row_value(value) for key, value in row.items()} for row in object_rows]
                kind = "json"
        except json.JSONDecodeError:
            rows = []

    if not rows and body:
        lines = [line for line in body.splitlines() if line.strip()]
        if len(lines) >= 2 and "," in lines[0]:
            reader = csv.DictReader(io.StringIO(body))
            parsed_rows = []
            for row in reader:
                if row:
                    parsed_rows.append({str(key): _row_value(value) for key, value in row.items() if key is not None})
            if parsed_rows:
                rows = parsed_rows
                kind = "table"

    profile = _structured_profile(answer)
    if not rows:
        rows = [
            {
                "answer_id": answer.answer_id,
                "title": answer.title,
                "approved_summary": answer.approved_summary or "",
                "body": answer.body,
                "status": answer.status,
                "priority": answer.priority,
                "tags": ", ".join(answer.tags),
                "source_type": answer.metadata.get("source_type") or answer.metadata.get("created_from") or "",
                "source_uri": answer.metadata.get("source_uri") or "",
            }
        ]
        kind = profile["kind"] or "answer"

    columns: list[str] = []
    for row in rows:
        for column in row.keys():
            if column not in columns:
                columns.append(column)
    for column in profile["columns"]:
        if column not in columns:
            columns.append(column)
            for row in rows:
                row.setdefault(column, "")

    return rows, columns, kind


def _dataset_from_answer(answer: AnswerItem) -> StructuredDataset:
    rows, columns, parsed_kind = _rows_from_answer(answer)
    profile = _structured_profile(answer)
    row_count = max(profile["row_count"], len(rows))
    return StructuredDataset(
        answer_id=answer.answer_id,
        title=answer.title,
        status=answer.status,
        source_type=str(answer.metadata.get("source_type") or answer.metadata.get("created_from") or "-"),
        source_uri=answer.metadata.get("source_uri"),
        kind=str(profile["kind"] or parsed_kind),
        columns=columns,
        row_count=row_count,
        sample_rows=rows[:5],
        metadata={
            "content_format": answer.content_format,
            "display_policy": answer.display_policy,
            "version": answer.version,
        },
    )


def _matches_filter(row: dict[str, Any], item: StructuredFilter) -> bool:
    value = str(row.get(item.field, "") or "").lower()
    expected = str(item.value or "").lower()
    if item.operator == "equals":
        return value == expected
    if item.operator == "starts_with":
        return value.startswith(expected)
    if item.operator == "ends_with":
        return value.endswith(expected)
    return expected in value


def _pseudo_sql(dataset: StructuredDataset, filters: list[StructuredFilter], limit: int) -> str:
    columns = ", ".join(f'"{column}"' for column in dataset.columns[:20]) or "*"
    where_parts = []
    for item in filters:
        escaped = item.value.replace("'", "''")
        if item.operator == "equals":
            where_parts.append(f'"{item.field}" = \'{escaped}\'')
        elif item.operator == "starts_with":
            where_parts.append(f'"{item.field}" LIKE \'{escaped}%\'')
        elif item.operator == "ends_with":
            where_parts.append(f'"{item.field}" LIKE \'%{escaped}\'')
        else:
            where_parts.append(f'"{item.field}" ILIKE \'%{escaped}%\'')
    where_sql = f" WHERE {' AND '.join(where_parts)}" if where_parts else ""
    return f'SELECT {columns} FROM "{dataset.answer_id}"{where_sql} LIMIT {limit};'


def _normalise_answer_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    tags = _coerce_json(snapshot.get("tags"), [])
    metadata = _coerce_json(snapshot.get("metadata"), {})
    snapshot["tags"] = tags if isinstance(tags, list) else []
    snapshot["metadata"] = metadata if isinstance(metadata, dict) else {}
    return snapshot


def _normalise_text(value: Any) -> str:
    return " ".join(str(value or "").lower().split())


def _tokens(value: Any) -> list[str]:
    return [token for token in TOKEN_RE.findall(_normalise_text(value)) if len(token) >= 2]


def _partial_overlap(query_tokens: list[str], text: str) -> float:
    if not query_tokens:
        return 0.0
    normalized_text = _normalise_text(text)
    text_tokens = _tokens(text)
    matches = 0
    for query_token in query_tokens:
        if query_token in normalized_text:
            matches += 1
            continue
        if any(query_token in text_token or text_token in query_token for text_token in text_tokens):
            matches += 1
    return matches / max(len(query_tokens), 1)


def _add_score(details: dict[str, float], key: str, amount: float) -> None:
    if amount == 0:
        return
    details[key] = round(details.get(key, 0.0) + amount, 4)


async def _get_answer_row(db, workspace: str, answer_id: str) -> dict[str, Any]:
    row = await db.query(
        """
        SELECT workspace, answer_id, title, body, approved_summary, content_format,
               display_policy, status, version, valid_from, valid_until, priority,
               tags, metadata, publish_time, create_time, update_time
        FROM LIGHTRAG_ANSWER_ITEMS
        WHERE workspace = $1 AND answer_id = $2
        """,
        [workspace, answer_id],
    )
    if not row:
        raise HTTPException(status_code=404, detail=f"Answer '{answer_id}' not found")
    return row


async def _record_revision(db, row: dict[str, Any]) -> None:
    snapshot = dict(row)
    for key, value in list(snapshot.items()):
        if isinstance(value, datetime):
            snapshot[key] = value.isoformat()
    snapshot = _normalise_answer_snapshot(snapshot)
    await db.execute(
        """
        INSERT INTO LIGHTRAG_ANSWER_REVISIONS
            (revision_id, workspace, answer_id, version, snapshot_json)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        """,
        {
            "revision_id": f"rev-{uuid.uuid4().hex}",
            "workspace": row["workspace"],
            "answer_id": row["answer_id"],
            "version": row["version"],
            "snapshot_json": _json(snapshot),
        },
    )


async def _log_event(
    db,
    workspace: str,
    event_type: str,
    query: Optional[str] = None,
    selected_answer_id: Optional[str] = None,
    candidate_ids: Optional[list[str]] = None,
    scores: Optional[dict[str, float]] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> str:
    event_id = f"evt-{uuid.uuid4().hex}"
    await db.execute(
        """
        INSERT INTO LIGHTRAG_ANSWER_EVENTS
            (event_id, workspace, event_type, query, selected_answer_id, candidate_ids, scores, metadata)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
        """,
        {
            "event_id": event_id,
            "workspace": workspace,
            "event_type": event_type,
            "query": query,
            "selected_answer_id": selected_answer_id,
            "candidate_ids": _json_list(candidate_ids or []),
            "scores": _json(scores or {}),
            "metadata": _json(metadata or {}),
        },
    )
    return event_id


async def _record_source_snapshot(
    db,
    workspace: str,
    *,
    source_type: str,
    source_uri: Optional[str],
    file_name: Optional[str],
    title: Optional[str],
    raw_content: str,
    profile: dict[str, Any],
    metadata: dict[str, Any],
    created_answer_ids: list[str],
    status: str = "captured",
    task_id: Optional[str] = None,
) -> AnswerSourceSnapshot:
    snapshot_id = f"src-{uuid.uuid4().hex}"
    content = raw_content or ""
    row = await db.query(
        """
        INSERT INTO LIGHTRAG_ANSWER_SOURCE_SNAPSHOTS
            (snapshot_id, workspace, source_type, source_uri, file_name, title,
             raw_content, content_hash, content_length, profile, metadata,
             created_answer_ids, status, task_id)
        VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb,
             $12::jsonb, $13, $14)
        RETURNING snapshot_id, workspace, source_type, source_uri, file_name, title,
                  LEFT(raw_content, 600) AS content_preview, content_hash, content_length,
                  profile, metadata, created_answer_ids, status, task_id, create_time
        """,
        [
            snapshot_id,
            workspace,
            source_type,
            source_uri,
            file_name,
            title,
            content,
            _content_hash(content),
            len(content),
            _json(profile),
            _json(metadata),
            _json_list(created_answer_ids),
            status,
            task_id,
        ],
    )
    if not row:
        raise HTTPException(status_code=500, detail="Failed to record source snapshot")
    return _source_snapshot_from_row(dict(row))


async def _record_source_link(
    db,
    workspace: str,
    *,
    answer_id: str,
    answer_version: int,
    snapshot_id: str,
    link_type: str = "created_from",
    metadata: Optional[dict[str, Any]] = None,
) -> AnswerSourceLink:
    row = await db.query(
        """
        INSERT INTO LIGHTRAG_ANSWER_SOURCE_LINKS
            (link_id, workspace, answer_id, answer_version, snapshot_id, link_type, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        RETURNING link_id, workspace, answer_id, answer_version, snapshot_id,
                  link_type, metadata, create_time
        """,
        [
            f"asl-{uuid.uuid4().hex}",
            workspace,
            answer_id,
            answer_version,
            snapshot_id,
            link_type,
            _json(metadata or {}),
        ],
    )
    if not row:
        raise HTTPException(status_code=500, detail="Failed to record source link")
    return _source_link_from_row(dict(row))


def _score_candidate(
    answer: AnswerItem,
    guidance: list[AnswerGuidance],
    query: str,
    strategy: ResolveStrategy = "balanced",
) -> tuple[float, list[str], str, dict[str, float]]:
    normalized_query = _normalise_text(query)
    query_tokens = _tokens(query)
    details: dict[str, float] = {}
    matched_guidance: list[str] = []

    title = _normalise_text(answer.title)
    summary = _normalise_text(answer.approved_summary)
    body = _normalise_text(answer.body)
    tags = _normalise_text(" ".join(answer.tags))

    if normalized_query and normalized_query in title:
        _add_score(details, "title_exact", 0.42)
    if normalized_query and normalized_query in summary:
        _add_score(details, "summary_exact", 0.24)
    if normalized_query and normalized_query in body:
        _add_score(details, "body_exact", 0.16)
    if normalized_query and normalized_query in tags:
        _add_score(details, "tag_exact", 0.2)

    _add_score(details, "title_overlap", _partial_overlap(query_tokens, title) * 0.26)
    _add_score(details, "summary_overlap", _partial_overlap(query_tokens, summary) * 0.16)
    _add_score(details, "body_overlap", _partial_overlap(query_tokens, body) * 0.1)
    _add_score(details, "tag_overlap", _partial_overlap(query_tokens, tags) * 0.18)

    for item in guidance:
        guidance_text = _normalise_text(item.text)
        multiplier = GUIDANCE_TYPE_MULTIPLIER.get(item.guidance_type, 1.0)
        exact_match = bool(
            normalized_query
            and guidance_text
            and (normalized_query in guidance_text or guidance_text in normalized_query)
        )
        overlap = _partial_overlap(query_tokens, guidance_text)
        if not exact_match and overlap <= 0:
            continue

        if item.guidance_type == "negative_keyword" and exact_match:
            _add_score(details, "negative_block", -1.0)
            matched_guidance.append(f"!{item.text}")
            return 0.0, matched_guidance[:8], "blocked_by_negative_guidance", details

        if exact_match:
            amount = min(0.42, 0.18 * item.weight) * multiplier
        else:
            amount = min(0.28, overlap * 0.24 * item.weight) * multiplier

        key = f"guidance_{item.guidance_type}"
        _add_score(details, key, amount)
        prefix = "!" if item.guidance_type == "negative_keyword" else ""
        matched_guidance.append(f"{prefix}{item.text}")

    if strategy == "balanced":
        metadata_text = _normalise_text(json.dumps(answer.metadata, ensure_ascii=False))
        _add_score(details, "metadata_overlap", _partial_overlap(query_tokens, metadata_text) * 0.08)

    _add_score(details, "priority", min(0.07, max(answer.priority, 0) * 0.01))

    raw_score = sum(details.values())
    score = min(max(raw_score, 0.0), 1.0)
    positive_details = {key: value for key, value in details.items() if value > 0}
    reason = ", ".join(f"{key}:{value:.2f}" for key, value in sorted(positive_details.items()))
    if not reason and details:
        reason = ", ".join(f"{key}:{value:.2f}" for key, value in sorted(details.items()))
    return score, matched_guidance[:8], reason or "weak_match", details


def _render_answer_response(answer: AnswerItem, display_policy: Optional[DisplayPolicy] = None) -> tuple[str, DisplayPolicy]:
    policy = display_policy or answer.display_policy
    summary = (answer.approved_summary or "").strip()
    body = answer.body.strip()
    if policy == "summary":
        return summary or body, policy
    if policy == "full":
        return body, policy
    if summary and body and summary != body:
        return f"{summary}\n\n{body}", policy
    return body or summary, policy


def create_answer_routes(rag, api_key: Optional[str] = None):
    combined_auth = get_combined_auth_dependency(api_key)

    async def db_for_request(request: Request):
        workspace = _get_workspace_from_request(request)
        base_db = _db_from_rag(rag)
        if base_db is None:
            raise HTTPException(status_code=500, detail="Database connection not available")
        await _ensure_tables(base_db)

        workspace_mode = await _workspace_mode_from_db(base_db, workspace)
        if workspace_mode not in ANSWER_WORKSPACE_MODES:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Answer catalog APIs require an answer_catalog or hybrid workspace. "
                    f"Current workspace mode is '{workspace_mode}'."
                ),
            )

        workspace_rag = await get_workspace_rag(workspace)
        if workspace_rag is None:
            workspace_rag = rag
            logger.warning("[Answers] Using default RAG instance for workspace: %s", workspace)
        db = _db_from_rag(workspace_rag)
        if db is None:
            raise HTTPException(status_code=500, detail="Database connection not available")
        await _ensure_tables(db)
        return workspace, db

    @router.get("", response_model=AnswerListResponse, dependencies=[Depends(combined_auth)])
    async def list_answers(
        request: Request,
        status: Optional[str] = Query(default=None),
        search: Optional[str] = Query(default=None),
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=20, ge=1, le=100),
    ):
        workspace, db = await db_for_request(request)
        params: list[Any] = [workspace]
        where = ["workspace = $1"]
        if status and status != "all":
            params.append(status)
            where.append(f"status = ${len(params)}")
        if search:
            params.append(f"%{search}%")
            p = f"${len(params)}"
            where.append(f"(title ILIKE {p} OR body ILIKE {p} OR approved_summary ILIKE {p})")
        where_sql = " AND ".join(where)
        count = await db.query(f"SELECT COUNT(*)::INT AS total FROM LIGHTRAG_ANSWER_ITEMS WHERE {where_sql}", params)
        total = int((count or {}).get("total") or 0)

        page_params = [*params, page_size, (page - 1) * page_size]
        rows = await db.query(
            f"""
            SELECT workspace, answer_id, title, body, approved_summary, content_format,
                   display_policy, status, version, valid_from, valid_until, priority,
                   tags, metadata, publish_time, create_time, update_time
            FROM LIGHTRAG_ANSWER_ITEMS
            WHERE {where_sql}
            ORDER BY update_time DESC, answer_id ASC
            LIMIT ${len(page_params) - 1} OFFSET ${len(page_params)}
            """,
            page_params,
            multirows=True,
        )
        return AnswerListResponse(
            answers=[_answer_from_row(dict(row)) for row in rows or []],
            total=total,
            page=page,
            page_size=page_size,
        )

    @router.post("", response_model=AnswerItem, dependencies=[Depends(combined_auth)])
    async def create_answer(request: Request, payload: AnswerCreateRequest):
        workspace, db = await db_for_request(request)
        answer_id = payload.answer_id or f"ANS-{uuid.uuid4().hex[:12]}"
        try:
            row = await db.query(
                """
                INSERT INTO LIGHTRAG_ANSWER_ITEMS
                    (workspace, answer_id, title, body, approved_summary, content_format,
                     display_policy, status, version, valid_from, valid_until, priority,
                     tags, metadata, publish_time)
                VALUES
                    ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $11,
                     $12::jsonb, $13::jsonb, CASE WHEN $8 = 'published' THEN NOW() ELSE NULL END)
                RETURNING workspace, answer_id, title, body, approved_summary, content_format,
                          display_policy, status, version, valid_from, valid_until, priority,
                          tags, metadata, publish_time, create_time, update_time
                """,
                [
                    workspace,
                    answer_id,
                    payload.title,
                    payload.body,
                    payload.approved_summary,
                    payload.content_format,
                    payload.display_policy,
                    payload.status,
                    payload.valid_from,
                    payload.valid_until,
                    payload.priority,
                    _json_list(payload.tags),
                    _json(payload.metadata),
                ],
            )
            if not row:
                raise HTTPException(status_code=500, detail="Failed to create answer")
            await _record_revision(db, dict(row))
            for text in payload.guidance:
                if not text.strip():
                    continue
                await db.execute(
                    """
                    INSERT INTO LIGHTRAG_ANSWER_GUIDANCE
                        (guidance_id, workspace, answer_id, guidance_type, text, weight, metadata)
                    VALUES ($1, $2, $3, 'keyword', $4, 1.0, '{}'::jsonb)
                    """,
                    {
                        "guidance_id": f"agd-{uuid.uuid4().hex}",
                        "workspace": workspace,
                        "answer_id": answer_id,
                        "text": text.strip(),
                    },
                )
            return _answer_from_row(dict(row))
        except HTTPException:
            raise
        except Exception as e:
            message = str(e)
            if "duplicate" in message.lower() or "unique" in message.lower():
                raise HTTPException(status_code=409, detail=f"Answer '{answer_id}' already exists")
            logger.error("Failed to create answer: %s\n%s", e, traceback.format_exc())
            raise HTTPException(status_code=500, detail=message)

    @router.post(
        "/source-draft",
        response_model=AnswerSourceDraftResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def create_answer_source_draft(request: Request, payload: AnswerSourceDraftRequest):
        workspace, db = await db_for_request(request)
        answer_id = payload.answer_id or f"ANS-{uuid.uuid4().hex[:12]}"
        snapshot_metadata = {
            **payload.metadata,
            "created_from": payload.metadata.get("created_from") or "answer_source_wizard",
            "content_format": payload.content_format,
            "tags": payload.tags,
        }
        snapshot = await _record_source_snapshot(
            db,
            workspace,
            source_type=payload.source_type,
            source_uri=payload.source_uri,
            file_name=payload.file_name,
            title=payload.title,
            raw_content=payload.body,
            profile=payload.source_profile,
            metadata=snapshot_metadata,
            created_answer_ids=[answer_id],
            status="materialized",
            task_id=payload.metadata.get("task_id"),
        )
        source_metadata = {
            **payload.metadata,
            "created_from": payload.metadata.get("created_from") or "answer_source_wizard",
            "source_type": payload.source_type,
            "source_uri": payload.source_uri,
            "file_name": payload.file_name,
            "source_profile": payload.source_profile,
            "source_snapshot_id": snapshot.snapshot_id,
            "source_content_hash": snapshot.content_hash,
        }
        try:
            row = await db.query(
                """
                INSERT INTO LIGHTRAG_ANSWER_ITEMS
                    (workspace, answer_id, title, body, approved_summary, content_format,
                     display_policy, status, version, valid_from, valid_until, priority,
                     tags, metadata, publish_time)
                VALUES
                    ($1, $2, $3, $4, $5, $6, $7, $8, 1, NULL, NULL, $9,
                     $10::jsonb, $11::jsonb, CASE WHEN $8 = 'published' THEN NOW() ELSE NULL END)
                RETURNING workspace, answer_id, title, body, approved_summary, content_format,
                          display_policy, status, version, valid_from, valid_until, priority,
                          tags, metadata, publish_time, create_time, update_time
                """,
                [
                    workspace,
                    answer_id,
                    payload.title,
                    payload.body,
                    payload.approved_summary,
                    payload.content_format,
                    payload.display_policy,
                    payload.status,
                    payload.priority,
                    _json_list(payload.tags),
                    _json(source_metadata),
                ],
            )
            if not row:
                raise HTTPException(status_code=500, detail="Failed to create answer draft")
            await _record_revision(db, dict(row))
            source_link = await _record_source_link(
                db,
                workspace,
                answer_id=answer_id,
                answer_version=int(row.get("version") or 1),
                snapshot_id=snapshot.snapshot_id,
                link_type="created_from",
                metadata={
                    "created_from": "answer_source_wizard",
                    "source_type": payload.source_type,
                    "source_uri": payload.source_uri,
                    "file_name": payload.file_name,
                },
            )

            created_guidance: list[AnswerGuidance] = []
            for item in payload.guidance:
                if not item.text.strip():
                    continue
                guidance_metadata = {
                    **item.metadata,
                    "created_from": "answer_source_wizard",
                    "source": item.source,
                }
                guidance_row = await db.query(
                    """
                    INSERT INTO LIGHTRAG_ANSWER_GUIDANCE
                        (guidance_id, workspace, answer_id, guidance_type, text, weight, metadata)
                    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
                    RETURNING guidance_id, workspace, answer_id, guidance_type, text, weight, metadata, create_time
                    """,
                    [
                        f"agd-{uuid.uuid4().hex}",
                        workspace,
                        answer_id,
                        item.guidance_type,
                        item.text.strip(),
                        item.weight,
                        _json(guidance_metadata),
                    ],
                )
                if guidance_row:
                    created_guidance.append(_guidance_from_row(dict(guidance_row)))

            return AnswerSourceDraftResponse(
                answer=_answer_from_row(dict(row)),
                guidance=created_guidance,
                snapshot=snapshot,
                source_link=source_link,
            )
        except HTTPException:
            raise
        except Exception as e:
            try:
                await db.execute(
                    "DELETE FROM LIGHTRAG_ANSWER_SOURCE_SNAPSHOTS WHERE workspace = $1 AND snapshot_id = $2",
                    [workspace, snapshot.snapshot_id],
                )
            except Exception:
                pass
            message = str(e)
            if "duplicate" in message.lower() or "unique" in message.lower():
                raise HTTPException(status_code=409, detail=f"Answer '{answer_id}' already exists")
            logger.error("Failed to create answer source draft: %s\n%s", e, traceback.format_exc())
            raise HTTPException(status_code=500, detail=message)

    @router.get("/events", response_model=list[AnswerEvent], dependencies=[Depends(combined_auth)])
    async def list_events(
        request: Request,
        event_type: Optional[str] = Query(default=None),
        selected_answer_id: Optional[str] = Query(default=None),
        limit: int = Query(default=50, ge=1, le=200),
    ):
        workspace, db = await db_for_request(request)
        params: list[Any] = [workspace]
        where = ["workspace = $1"]
        if event_type and event_type != "all":
            params.append(event_type)
            where.append(f"event_type = ${len(params)}")
        if selected_answer_id:
            params.append(selected_answer_id)
            where.append(f"selected_answer_id = ${len(params)}")
        params.append(limit)
        rows = await db.query(
            f"""
            SELECT event_id, workspace, event_type, query, selected_answer_id,
                   candidate_ids, scores, metadata, create_time
            FROM LIGHTRAG_ANSWER_EVENTS
            WHERE {' AND '.join(where)}
            ORDER BY create_time DESC
            LIMIT ${len(params)}
            """,
            params,
            multirows=True,
        )
        return [_event_from_row(dict(row)) for row in rows or []]

    @router.get("/structured/datasets", response_model=list[StructuredDataset], dependencies=[Depends(combined_auth)])
    async def list_structured_datasets(
        request: Request,
        structured_only: bool = Query(default=True),
        status: Optional[str] = Query(default="all"),
    ):
        workspace, db = await db_for_request(request)
        params: list[Any] = [workspace]
        where = ["workspace = $1"]
        if status and status != "all":
            params.append(status)
            where.append(f"status = ${len(params)}")
        rows = await db.query(
            f"""
            SELECT workspace, answer_id, title, body, approved_summary, content_format,
                   display_policy, status, version, valid_from, valid_until, priority,
                   tags, metadata, publish_time, create_time, update_time
            FROM LIGHTRAG_ANSWER_ITEMS
            WHERE {' AND '.join(where)}
            ORDER BY update_time DESC, answer_id ASC
            LIMIT 500
            """,
            params,
            multirows=True,
        )
        datasets = [_dataset_from_answer(_answer_from_row(dict(row))) for row in rows or []]
        if structured_only:
            datasets = [
                dataset
                for dataset in datasets
                if dataset.row_count > 1
                or len(dataset.columns) > 9
                or dataset.kind in {"json", "table", "structured"}
            ]
        return datasets

    @router.post("/structured/query", response_model=StructuredQueryResponse, dependencies=[Depends(combined_auth)])
    async def query_structured_dataset(request: Request, payload: StructuredQueryRequest):
        workspace, db = await db_for_request(request)
        row = await _get_answer_row(db, workspace, payload.answer_id)
        answer = _answer_from_row(dict(row))
        rows, columns, _ = _rows_from_answer(answer)
        dataset = _dataset_from_answer(answer)
        invalid_fields = [item.field for item in payload.filters if item.field not in columns]
        if invalid_fields:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown structured field(s): {', '.join(invalid_fields)}",
            )

        filtered_rows = rows
        for item in payload.filters:
            filtered_rows = [row for row in filtered_rows if _matches_filter(row, item)]

        pseudo_sql = _pseudo_sql(dataset, payload.filters, payload.limit)
        return StructuredQueryResponse(
            answer_id=answer.answer_id,
            title=answer.title,
            pseudo_sql=pseudo_sql,
            columns=columns,
            rows=[] if payload.preview_only else filtered_rows[: payload.limit],
            row_count=len(filtered_rows),
            preview_only=payload.preview_only,
        )

    @router.get("/sources/snapshots", response_model=list[AnswerSourceSnapshot], dependencies=[Depends(combined_auth)])
    async def list_source_snapshots(
        request: Request,
        source_type: Optional[str] = Query(default=None),
        answer_id: Optional[str] = Query(default=None),
        search: Optional[str] = Query(default=None),
        limit: int = Query(default=50, ge=1, le=200),
    ):
        workspace, db = await db_for_request(request)
        params: list[Any] = [workspace]
        where = ["s.workspace = $1"]
        join_sql = ""
        if answer_id:
            join_sql = """
            JOIN LIGHTRAG_ANSWER_SOURCE_LINKS l
              ON l.workspace = s.workspace AND l.snapshot_id = s.snapshot_id
            """
            params.append(answer_id)
            where.append(f"l.answer_id = ${len(params)}")
        if source_type and source_type != "all":
            params.append(source_type)
            where.append(f"s.source_type = ${len(params)}")
        if search:
            params.append(f"%{search}%")
            p = f"${len(params)}"
            where.append(f"(s.title ILIKE {p} OR s.source_uri ILIKE {p} OR s.file_name ILIKE {p} OR s.raw_content ILIKE {p})")
        params.append(limit)
        rows = await db.query(
            f"""
            SELECT DISTINCT s.snapshot_id, s.workspace, s.source_type, s.source_uri,
                   s.file_name, s.title, LEFT(s.raw_content, 600) AS content_preview,
                   s.content_hash, s.content_length, s.profile, s.metadata,
                   s.created_answer_ids, s.status, s.task_id, s.create_time
            FROM LIGHTRAG_ANSWER_SOURCE_SNAPSHOTS s
            {join_sql}
            WHERE {' AND '.join(where)}
            ORDER BY s.create_time DESC
            LIMIT ${len(params)}
            """,
            params,
            multirows=True,
        )
        return [_source_snapshot_from_row(dict(row)) for row in rows or []]

    @router.get("/{answer_id}", response_model=AnswerItem, dependencies=[Depends(combined_auth)])
    async def get_answer(request: Request, answer_id: str):
        workspace, db = await db_for_request(request)
        row = await _get_answer_row(db, workspace, answer_id)
        return _answer_from_row(dict(row))

    @router.get("/{answer_id}/sources", response_model=list[AnswerSourceLink], dependencies=[Depends(combined_auth)])
    async def list_answer_sources(request: Request, answer_id: str):
        workspace, db = await db_for_request(request)
        await _get_answer_row(db, workspace, answer_id)
        rows = await db.query(
            """
            SELECT l.link_id, l.workspace, l.answer_id, l.answer_version, l.snapshot_id,
                   l.link_type, l.metadata, l.create_time,
                   s.source_type, s.source_uri, s.file_name, s.title,
                   LEFT(s.raw_content, 600) AS content_preview,
                   s.content_hash, s.content_length, s.profile AS snapshot_profile,
                   s.metadata AS snapshot_metadata, s.created_answer_ids, s.status,
                   s.task_id, s.create_time AS snapshot_create_time
            FROM LIGHTRAG_ANSWER_SOURCE_LINKS l
            LEFT JOIN LIGHTRAG_ANSWER_SOURCE_SNAPSHOTS s
              ON s.workspace = l.workspace AND s.snapshot_id = l.snapshot_id
            WHERE l.workspace = $1 AND l.answer_id = $2
            ORDER BY l.create_time DESC
            """,
            [workspace, answer_id],
            multirows=True,
        )
        links: list[AnswerSourceLink] = []
        for row in rows or []:
            row_dict = dict(row)
            snapshot = None
            if row_dict.get("source_type"):
                snapshot = _source_snapshot_from_row(
                    {
                        "snapshot_id": row_dict["snapshot_id"],
                        "workspace": row_dict["workspace"],
                        "source_type": row_dict.get("source_type"),
                        "source_uri": row_dict.get("source_uri"),
                        "file_name": row_dict.get("file_name"),
                        "title": row_dict.get("title"),
                        "content_preview": row_dict.get("content_preview"),
                        "content_hash": row_dict.get("content_hash"),
                        "content_length": row_dict.get("content_length"),
                        "profile": row_dict.get("snapshot_profile"),
                        "metadata": row_dict.get("snapshot_metadata"),
                        "created_answer_ids": row_dict.get("created_answer_ids"),
                        "status": row_dict.get("status"),
                        "task_id": row_dict.get("task_id"),
                        "create_time": row_dict.get("snapshot_create_time"),
                    }
                )
            links.append(_source_link_from_row(row_dict, snapshot=snapshot))
        return links

    @router.post("/{answer_id}/view", dependencies=[Depends(combined_auth)])
    async def record_answer_view(
        request: Request,
        answer_id: str,
        payload: Optional[AnswerViewRequest] = None,
    ):
        workspace, db = await db_for_request(request)
        await _get_answer_row(db, workspace, answer_id)
        event_payload = payload or AnswerViewRequest()
        event_id = await _log_event(
            db,
            workspace,
            "view",
            query=event_payload.query,
            selected_answer_id=answer_id,
            candidate_ids=[answer_id],
            scores={answer_id: 1.0},
            metadata=event_payload.metadata,
        )
        return {"message": "Answer view recorded", "event_id": event_id, "answer_id": answer_id}

    @router.post("/{answer_id}/feedback", dependencies=[Depends(combined_auth)])
    async def record_answer_feedback(
        request: Request,
        answer_id: str,
        payload: AnswerFeedbackRequest,
    ):
        workspace, db = await db_for_request(request)
        await _get_answer_row(db, workspace, answer_id)
        candidate_ids = [answer_id]
        if payload.selected_alternative_id:
            await _get_answer_row(db, workspace, payload.selected_alternative_id)
            candidate_ids.append(payload.selected_alternative_id)
        metadata = {
            **payload.metadata,
            "helpful": payload.helpful,
            "note": payload.note,
            "selected_alternative_id": payload.selected_alternative_id,
        }
        event_id = await _log_event(
            db,
            workspace,
            "feedback",
            query=payload.query,
            selected_answer_id=answer_id,
            candidate_ids=candidate_ids,
            scores={answer_id: 1.0},
            metadata=metadata,
        )
        return {"message": "Answer feedback recorded", "event_id": event_id, "answer_id": answer_id}

    @router.patch("/{answer_id}", response_model=AnswerItem, dependencies=[Depends(combined_auth)])
    async def update_answer(request: Request, answer_id: str, payload: AnswerUpdateRequest):
        workspace, db = await db_for_request(request)
        current = await _get_answer_row(db, workspace, answer_id)
        next_values = dict(current)
        for key, value in payload.model_dump(exclude_unset=True).items():
            next_values[key] = value
        next_version = int(current.get("version") or 1) + 1
        row = await db.query(
            """
            UPDATE LIGHTRAG_ANSWER_ITEMS
            SET title = $3,
                body = $4,
                approved_summary = $5,
                content_format = $6,
                display_policy = $7,
                status = $8,
                version = $9,
                valid_from = $10,
                valid_until = $11,
                priority = $12,
                tags = $13::jsonb,
                metadata = $14::jsonb,
                publish_time = CASE
                    WHEN $8 = 'published' AND publish_time IS NULL THEN NOW()
                    WHEN $8 <> 'published' THEN NULL
                    ELSE publish_time
                END,
                update_time = NOW()
            WHERE workspace = $1 AND answer_id = $2
            RETURNING workspace, answer_id, title, body, approved_summary, content_format,
                      display_policy, status, version, valid_from, valid_until, priority,
                      tags, metadata, publish_time, create_time, update_time
            """,
            [
                workspace,
                answer_id,
                next_values.get("title"),
                next_values.get("body"),
                next_values.get("approved_summary"),
                next_values.get("content_format") or "markdown",
                next_values.get("display_policy") or "both",
                next_values.get("status") or "draft",
                next_version,
                next_values.get("valid_from"),
                next_values.get("valid_until"),
                int(next_values.get("priority") or 0),
                _json_list(next_values.get("tags")),
                _json(next_values.get("metadata")),
            ],
        )
        if not row:
            raise HTTPException(status_code=404, detail=f"Answer '{answer_id}' not found")
        await _record_revision(db, dict(row))
        return _answer_from_row(dict(row))

    @router.post("/{answer_id}/publish", response_model=AnswerItem, dependencies=[Depends(combined_auth)])
    async def publish_answer(request: Request, answer_id: str):
        return await update_answer(request, answer_id, AnswerUpdateRequest(status="published"))

    @router.post("/{answer_id}/archive", response_model=AnswerItem, dependencies=[Depends(combined_auth)])
    async def archive_answer(request: Request, answer_id: str):
        return await update_answer(request, answer_id, AnswerUpdateRequest(status="archived"))

    @router.get("/{answer_id}/revisions", response_model=list[AnswerRevision], dependencies=[Depends(combined_auth)])
    async def list_revisions(request: Request, answer_id: str):
        workspace, db = await db_for_request(request)
        rows = await db.query(
            """
            SELECT revision_id, workspace, answer_id, version, snapshot_json, created_at
            FROM LIGHTRAG_ANSWER_REVISIONS
            WHERE workspace = $1 AND answer_id = $2
            ORDER BY version DESC, created_at DESC
            """,
            [workspace, answer_id],
            multirows=True,
        )
        revisions = []
        for row in rows or []:
            snapshot = _coerce_json(row.get("snapshot_json"), {})
            if not isinstance(snapshot, dict):
                snapshot = {}
            revisions.append(
                AnswerRevision(
                    revision_id=str(row["revision_id"]),
                    workspace=str(row["workspace"]),
                    answer_id=str(row["answer_id"]),
                    version=int(row["version"]),
                    snapshot=_normalise_answer_snapshot(snapshot),
                    created_at=_iso(row.get("created_at")),
                )
            )
        return revisions

    @router.post(
        "/{answer_id}/revisions/{revision_id}/restore",
        response_model=AnswerItem,
        dependencies=[Depends(combined_auth)],
    )
    async def restore_revision(request: Request, answer_id: str, revision_id: str):
        workspace, db = await db_for_request(request)
        current = await _get_answer_row(db, workspace, answer_id)
        revision = await db.query(
            """
            SELECT snapshot_json
            FROM LIGHTRAG_ANSWER_REVISIONS
            WHERE workspace = $1 AND answer_id = $2 AND revision_id = $3
            """,
            [workspace, answer_id, revision_id],
        )
        if not revision:
            raise HTTPException(status_code=404, detail=f"Revision '{revision_id}' not found")

        snapshot = _coerce_json(revision.get("snapshot_json"), {})
        if not isinstance(snapshot, dict):
            raise HTTPException(status_code=409, detail="Revision snapshot is invalid")
        snapshot = _normalise_answer_snapshot(snapshot)
        next_version = int(current.get("version") or 1) + 1
        restored_status = snapshot.get("status") or current.get("status") or "draft"
        row = await db.query(
            """
            UPDATE LIGHTRAG_ANSWER_ITEMS
            SET title = $3,
                body = $4,
                approved_summary = $5,
                content_format = $6,
                display_policy = $7,
                status = $8,
                version = $9,
                valid_from = $10,
                valid_until = $11,
                priority = $12,
                tags = $13::jsonb,
                metadata = $14::jsonb,
                publish_time = CASE
                    WHEN $8 = 'published' THEN COALESCE(publish_time, NOW())
                    ELSE NULL
                END,
                update_time = NOW()
            WHERE workspace = $1 AND answer_id = $2
            RETURNING workspace, answer_id, title, body, approved_summary, content_format,
                      display_policy, status, version, valid_from, valid_until, priority,
                      tags, metadata, publish_time, create_time, update_time
            """,
            [
                workspace,
                answer_id,
                snapshot.get("title") or current.get("title"),
                snapshot.get("body") or current.get("body"),
                snapshot.get("approved_summary"),
                snapshot.get("content_format") or current.get("content_format") or "markdown",
                snapshot.get("display_policy") or current.get("display_policy") or "both",
                restored_status,
                next_version,
                snapshot.get("valid_from"),
                snapshot.get("valid_until"),
                int(snapshot.get("priority") or 0),
                _json_list(snapshot.get("tags")),
                _json(snapshot.get("metadata")),
            ],
        )
        if not row:
            raise HTTPException(status_code=404, detail=f"Answer '{answer_id}' not found")
        await _record_revision(db, dict(row))
        return _answer_from_row(dict(row))

    @router.get("/{answer_id}/guidance", response_model=list[AnswerGuidance], dependencies=[Depends(combined_auth)])
    async def list_guidance(request: Request, answer_id: str):
        workspace, db = await db_for_request(request)
        await _get_answer_row(db, workspace, answer_id)
        rows = await db.query(
            """
            SELECT guidance_id, workspace, answer_id, guidance_type, text, weight, metadata, create_time
            FROM LIGHTRAG_ANSWER_GUIDANCE
            WHERE workspace = $1 AND answer_id = $2
            ORDER BY create_time DESC
            """,
            [workspace, answer_id],
            multirows=True,
        )
        return [_guidance_from_row(dict(row)) for row in rows or []]

    @router.post("/{answer_id}/guidance", response_model=AnswerGuidance, dependencies=[Depends(combined_auth)])
    async def create_guidance(request: Request, answer_id: str, payload: GuidanceCreateRequest):
        workspace, db = await db_for_request(request)
        await _get_answer_row(db, workspace, answer_id)
        guidance_id = f"agd-{uuid.uuid4().hex}"
        row = await db.query(
            """
            INSERT INTO LIGHTRAG_ANSWER_GUIDANCE
                (guidance_id, workspace, answer_id, guidance_type, text, weight, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
            RETURNING guidance_id, workspace, answer_id, guidance_type, text, weight, metadata, create_time
            """,
            [
                guidance_id,
                workspace,
                answer_id,
                payload.guidance_type,
                payload.text,
                payload.weight,
                _json(payload.metadata),
            ],
        )
        if not row:
            raise HTTPException(status_code=500, detail="Failed to create guidance")
        return _guidance_from_row(dict(row))

    @router.delete("/{answer_id}/guidance/{guidance_id}", dependencies=[Depends(combined_auth)])
    async def delete_guidance(request: Request, answer_id: str, guidance_id: str):
        workspace, db = await db_for_request(request)
        await db.execute(
            """
            DELETE FROM LIGHTRAG_ANSWER_GUIDANCE
            WHERE workspace = $1 AND answer_id = $2 AND guidance_id = $3
            """,
            {"workspace": workspace, "answer_id": answer_id, "guidance_id": guidance_id},
        )
        return {"message": "Guidance deleted", "guidance_id": guidance_id}

    async def resolve_answer_candidates(
        workspace: str,
        db,
        payload: ResolveRequest,
        *,
        event_type: str = "resolve",
        event_metadata: Optional[dict[str, Any]] = None,
    ) -> ResolveResponse:
        started = time.time()
        status_filter = ["published"] if not payload.include_drafts else ["draft", "published"]
        rows = await db.query(
            """
            SELECT workspace, answer_id, title, body, approved_summary, content_format,
                   display_policy, status, version, valid_from, valid_until, priority,
                   tags, metadata, publish_time, create_time, update_time
            FROM LIGHTRAG_ANSWER_ITEMS
            WHERE workspace = $1
              AND status = ANY($2::text[])
              AND (valid_from IS NULL OR valid_from <= NOW())
              AND (valid_until IS NULL OR valid_until >= NOW())
            ORDER BY priority DESC, update_time DESC
            LIMIT 500
            """,
            [workspace, status_filter],
            multirows=True,
        )
        guidance_rows = await db.query(
            """
            SELECT guidance_id, workspace, answer_id, guidance_type, text, weight, metadata, create_time
            FROM LIGHTRAG_ANSWER_GUIDANCE
            WHERE workspace = $1
            """,
            [workspace],
            multirows=True,
        )
        guidance_by_answer: dict[str, list[AnswerGuidance]] = {}
        for row in guidance_rows or []:
            guidance = _guidance_from_row(dict(row))
            guidance_by_answer.setdefault(guidance.answer_id, []).append(guidance)

        candidates: list[ResolveCandidate] = []
        for row in rows or []:
            answer = _answer_from_row(dict(row))
            score, matched_guidance, reason, score_details = _score_candidate(
                answer,
                guidance_by_answer.get(answer.answer_id, []),
                payload.query,
                payload.strategy,
            )
            if score > 0:
                candidates.append(
                    ResolveCandidate(
                        answer=answer,
                        score=round(score, 4),
                        matched_guidance=matched_guidance,
                        reason=reason,
                        score_details=score_details,
                    )
                )

        candidates.sort(key=lambda item: (item.score, item.answer.priority, item.answer.update_time or ""), reverse=True)
        candidates = candidates[: payload.top_k]
        selected = candidates[0] if candidates and candidates[0].score >= payload.min_score else None
        rationale = (
            f"Selected {selected.answer.answer_id} by weighted deterministic score: {selected.reason}."
            if selected
            else "No candidate reached the minimum weighted deterministic score."
        )
        trace_id = await _log_event(
            db,
            workspace,
            event_type,
            query=payload.query,
            selected_answer_id=selected.answer.answer_id if selected else None,
            candidate_ids=[item.answer.answer_id for item in candidates],
            scores={item.answer.answer_id: item.score for item in candidates},
            metadata={
                **(event_metadata or {}),
                "latency_ms": int((time.time() - started) * 1000),
                "mode": "weighted_deterministic",
                "strategy": payload.strategy,
                "score_details": {item.answer.answer_id: item.score_details for item in candidates},
            },
        )
        return ResolveResponse(
            selected_answer=selected.answer if selected else None,
            confidence=selected.score if selected else 0.0,
            candidates=candidates,
            trace_id=trace_id,
            rationale=rationale,
        )

    @router.post("/resolve", response_model=ResolveResponse, dependencies=[Depends(combined_auth)])
    async def resolve_answer(request: Request, payload: ResolveRequest):
        workspace, db = await db_for_request(request)
        return await resolve_answer_candidates(workspace, db, payload, event_type="resolve")

    @router.post("/search", response_model=AnswerSearchResponse, dependencies=[Depends(combined_auth)])
    async def search_answer(request: Request, payload: AnswerSearchRequest):
        workspace, db = await db_for_request(request)
        result = await resolve_answer_candidates(
            workspace,
            db,
            ResolveRequest(
                query=payload.query,
                top_k=payload.top_k,
                min_score=payload.min_score,
                include_drafts=payload.include_drafts,
                strategy=payload.strategy,
            ),
            event_type="search",
            event_metadata={
                "response_policy": payload.response_policy,
                "include_candidates": payload.include_candidates,
            },
        )
        answer = result.selected_answer
        if answer is None:
            return AnswerSearchResponse(
                matched=False,
                confidence=0.0,
                candidates=result.candidates if payload.include_candidates else [],
                trace_id=result.trace_id,
                rationale=result.rationale,
            )

        response_text, display_policy = _render_answer_response(answer, payload.response_policy)
        return AnswerSearchResponse(
            matched=True,
            answer_id=answer.answer_id,
            title=answer.title,
            response=response_text,
            summary=answer.approved_summary,
            full_content=answer.body,
            display_policy=display_policy,
            content_format=answer.content_format,
            status=answer.status,
            version=answer.version,
            valid_from=answer.valid_from,
            valid_until=answer.valid_until,
            confidence=result.confidence,
            tags=answer.tags,
            source_type=answer.metadata.get("source_type") or answer.metadata.get("created_from"),
            source_uri=answer.metadata.get("source_uri"),
            candidates=result.candidates if payload.include_candidates else [],
            trace_id=result.trace_id,
            rationale=result.rationale,
        )

    @router.get("/stats/summary", dependencies=[Depends(combined_auth)])
    async def answer_stats(request: Request):
        workspace, db = await db_for_request(request)
        counts = await db.query(
            """
            SELECT
              COUNT(*)::INT AS total,
              COUNT(*) FILTER (WHERE status = 'draft')::INT AS draft,
              COUNT(*) FILTER (WHERE status = 'published')::INT AS published,
              COUNT(*) FILTER (WHERE status = 'archived')::INT AS archived
            FROM LIGHTRAG_ANSWER_ITEMS
            WHERE workspace = $1
            """,
            [workspace],
        )
        events = await db.query(
            """
            SELECT
              COUNT(*) FILTER (WHERE event_type = 'resolve')::INT AS resolves,
              COUNT(*) FILTER (WHERE event_type = 'search')::INT AS searches,
              COUNT(*) FILTER (WHERE event_type = 'view')::INT AS views,
              COUNT(*) FILTER (WHERE event_type = 'feedback')::INT AS feedback
            FROM LIGHTRAG_ANSWER_EVENTS
            WHERE workspace = $1
            """,
            [workspace],
        )
        return {
            "workspace": workspace,
            "answers": counts or {},
            "events": events or {},
        }

    return router
