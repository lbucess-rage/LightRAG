"""
Chunk inspection and management routes for LightRAG.

These endpoints expose the document -> chunk -> entity/relation structure so
operators can inspect, edit, preview-delete, and delete chunks through the
common deletion API.
"""

from __future__ import annotations

import json
import math
import time
import traceback
from typing import Any, Literal, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from lightrag.constants import GRAPH_FIELD_SEP
from lightrag.kg.shared_storage import get_default_workspace
from lightrag.utils import logger

from ..utils_api import decode_workspace_header, get_combined_auth_dependency
from .deletion_routes import _build_chunk_impact, _parse_chunk_ids, _scan_chunk_refs

router = APIRouter(prefix="/chunks", tags=["chunks"])

_get_rag_for_workspace = None

ChunkSortField = Literal[
    "id",
    "file_path",
    "full_doc_id",
    "chunk_order_index",
    "tokens",
    "create_time",
    "update_time",
]
SortDirection = Literal["asc", "desc"]


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
    if workspace_rag is None:
        workspace_rag = default_rag
        logger.warning("[Chunks] Using default RAG instance for workspace: %s", workspace)
    return workspace, workspace_rag


def _coerce_json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def _chunk_type(structured_content: Any) -> str:
    data = _coerce_json(structured_content)
    if not data:
        return "text"
    if isinstance(data, dict):
        return str(data.get("type") or "structured")
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and item.get("type"):
                return str(item["type"])
        return "structured"
    return "structured"


def _content_preview(content: str | None, limit: int = 220) -> str:
    text = (content or "").replace("\n", " ").strip()
    return text[:limit] + ("..." if len(text) > limit else "")


def _pagination(page: int, page_size: int, total_count: int) -> dict[str, Any]:
    total_pages = math.ceil(total_count / page_size) if total_count else 0
    return {
        "page": page,
        "page_size": page_size,
        "total_count": total_count,
        "total_pages": total_pages,
        "has_next": page < total_pages,
        "has_prev": page > 1,
    }


def _relation_parts(relation_key: str) -> tuple[str, str] | None:
    parts = relation_key.split(GRAPH_FIELD_SEP)
    if len(parts) < 2:
        return None
    return parts[0], parts[1]


class PaginationInfo(BaseModel):
    page: int
    page_size: int
    total_count: int
    total_pages: int
    has_next: bool
    has_prev: bool


class ChunksRequest(BaseModel):
    page: int = Field(default=1, ge=1, description="Page number.")
    page_size: int = Field(default=20, ge=1, le=100, description="Items per page.")
    doc_id: Optional[str] = Field(
        default=None,
        description="Filter by document id / full_doc_id.",
        examples=["doc-99a56f6420082bd50a298fa61b1d5e9c"],
    )
    search: Optional[str] = Field(
        default=None,
        description="Search chunk id, file path, content, or structured_content JSON.",
    )
    chunk_type: Optional[str] = Field(
        default=None,
        description="Filter by structured content type. Use text, image, table, equation, or all.",
        examples=["image"],
    )
    sort_field: ChunkSortField = Field(default="chunk_order_index")
    sort_direction: SortDirection = Field(default="asc")

    @field_validator("doc_id", "search", "chunk_type", mode="after")
    @classmethod
    def clean_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class ChunkListItem(BaseModel):
    chunk_id: str
    doc_id: Optional[str] = None
    file_path: Optional[str] = None
    chunk_order_index: Optional[int] = None
    tokens: Optional[int] = None
    content_preview: str
    content_length: int
    chunk_type: str
    has_structured_content: bool
    entity_count: int = 0
    relation_count: int = 0
    created_at: Optional[int] = None
    updated_at: Optional[int] = None


class ChunksResponse(BaseModel):
    chunks: list[ChunkListItem]
    pagination: PaginationInfo


class ChunkEntityRef(BaseModel):
    entity_id: str
    entity_type: Optional[str] = None
    description: Optional[str] = None
    degree: int = 0


class ChunkRelationRef(BaseModel):
    source_id: str
    target_id: str
    keywords: Optional[str] = None
    description: Optional[str] = None
    weight: Optional[float] = None


class ChunkDocumentRef(BaseModel):
    doc_id: Optional[str] = None
    file_path: Optional[str] = None
    status: Optional[str] = None
    chunks_count: Optional[int] = None


class ChunkDetailResponse(BaseModel):
    chunk_id: str
    doc_id: Optional[str] = None
    file_path: Optional[str] = None
    chunk_order_index: Optional[int] = None
    tokens: Optional[int] = None
    content: str
    content_length: int
    chunk_type: str
    structured_content: Any = None
    llm_cache_list: list[str] = Field(default_factory=list)
    created_at: Optional[int] = None
    updated_at: Optional[int] = None
    document: Optional[ChunkDocumentRef] = None
    entities: list[ChunkEntityRef] = Field(default_factory=list)
    relations: list[ChunkRelationRef] = Field(default_factory=list)
    deletion_impact: dict[str, Any] = Field(default_factory=dict)


class ChunkUpdateRequest(BaseModel):
    content: Optional[str] = Field(
        default=None,
        description="New chunk text content. If omitted, content is unchanged.",
    )
    structured_content: Any = Field(
        default=None,
        description="New structured content JSON. Use clear_structured_content=true to remove it.",
    )
    clear_structured_content: bool = Field(
        default=False,
        description="Remove structured_content from this chunk.",
    )
    invalidate_cache: bool = Field(
        default=True,
        description="Drop query cache after updating chunk content or metadata.",
    )


async def _list_chunks_from_postgres(rag, request: ChunksRequest) -> tuple[list[dict[str, Any]], int]:
    where = ["workspace=$1"]
    params: list[Any] = [rag.text_chunks.workspace]

    if request.doc_id:
        params.append(request.doc_id)
        where.append(f"full_doc_id=${len(params)}")

    if request.search:
        params.append(f"%{request.search}%")
        placeholder = f"${len(params)}"
        where.append(
            f"(id ILIKE {placeholder} OR file_path ILIKE {placeholder} "
            f"OR content ILIKE {placeholder} OR structured_content::text ILIKE {placeholder})"
        )

    chunk_type = (request.chunk_type or "all").lower()
    if chunk_type != "all":
        if chunk_type == "text":
            where.append(
                "(structured_content IS NULL "
                "OR structured_content = 'null'::jsonb "
                "OR (jsonb_typeof(structured_content) = 'object' AND structured_content->>'type' = 'text') "
                "OR (jsonb_typeof(structured_content) = 'array' AND structured_content->0->>'type' = 'text'))"
            )
        else:
            params.append(chunk_type)
            placeholder = f"${len(params)}"
            where.append(
                f"((jsonb_typeof(structured_content) = 'object' AND structured_content->>'type' = {placeholder}) "
                f"OR (jsonb_typeof(structured_content) = 'array' AND structured_content->0->>'type' = {placeholder}))"
            )

    sort_columns = {
        "id": "id",
        "file_path": "file_path",
        "full_doc_id": "full_doc_id",
        "chunk_order_index": "chunk_order_index",
        "tokens": "tokens",
        "create_time": "create_time",
        "update_time": "update_time",
    }
    sort_column = sort_columns[request.sort_field]
    direction = request.sort_direction.upper()
    where_sql = " AND ".join(where)

    count_sql = f"SELECT COUNT(*)::INT AS total FROM LIGHTRAG_DOC_CHUNKS WHERE {where_sql}"
    count_row = await rag.text_chunks.db.query(count_sql, params)
    total_count = int((count_row or {}).get("total") or 0)

    params_with_page = [*params, request.page_size, (request.page - 1) * request.page_size]
    limit_placeholder = f"${len(params_with_page) - 1}"
    offset_placeholder = f"${len(params_with_page)}"
    select_sql = f"""
        SELECT id, tokens, COALESCE(content, '') AS content,
               chunk_order_index, full_doc_id, file_path, structured_content,
               EXTRACT(EPOCH FROM create_time)::BIGINT AS create_time,
               EXTRACT(EPOCH FROM update_time)::BIGINT AS update_time
        FROM LIGHTRAG_DOC_CHUNKS
        WHERE {where_sql}
        ORDER BY {sort_column} {direction} NULLS LAST, id ASC
        LIMIT {limit_placeholder} OFFSET {offset_placeholder}
    """
    rows = await rag.text_chunks.db.query(select_sql, params_with_page, multirows=True)
    return rows or [], total_count


async def _list_chunks_from_memory(rag, request: ChunksRequest) -> tuple[list[dict[str, Any]], int]:
    data = getattr(rag.text_chunks, "_data", {}) or {}
    rows: list[dict[str, Any]] = []
    for chunk_id, value in dict(data).items():
        chunk = dict(value or {})
        chunk["id"] = chunk_id
        if request.doc_id and chunk.get("full_doc_id") != request.doc_id:
            continue
        if request.search:
            haystack = json.dumps(chunk, ensure_ascii=False).lower()
            if request.search.lower() not in haystack:
                continue
        chunk_type = (request.chunk_type or "all").lower()
        if chunk_type != "all" and _chunk_type(chunk.get("structured_content")).lower() != chunk_type:
            continue
        rows.append(chunk)

    reverse = request.sort_direction == "desc"
    rows.sort(key=lambda item: item.get(request.sort_field) or "", reverse=reverse)
    total_count = len(rows)
    start = (request.page - 1) * request.page_size
    return rows[start : start + request.page_size], total_count


async def _chunk_list_items(rag, rows: list[dict[str, Any]]) -> list[ChunkListItem]:
    chunk_ids = [str(row.get("id")) for row in rows if row.get("id")]
    entity_refs = await _scan_chunk_refs(rag.entity_chunks, chunk_ids)
    relation_refs = await _scan_chunk_refs(rag.relation_chunks, chunk_ids)
    entity_counts: dict[str, int] = {chunk_id: 0 for chunk_id in chunk_ids}
    relation_counts: dict[str, int] = {chunk_id: 0 for chunk_id in chunk_ids}
    for matched_chunks in entity_refs.values():
        for chunk_id in matched_chunks:
            entity_counts[chunk_id] = entity_counts.get(chunk_id, 0) + 1
    for matched_chunks in relation_refs.values():
        for chunk_id in matched_chunks:
            relation_counts[chunk_id] = relation_counts.get(chunk_id, 0) + 1

    items: list[ChunkListItem] = []
    for row in rows:
        chunk_id = str(row.get("id"))
        structured_content = _coerce_json(row.get("structured_content"))
        content = row.get("content") or ""
        items.append(
            ChunkListItem(
                chunk_id=chunk_id,
                doc_id=row.get("full_doc_id") or row.get("doc_id"),
                file_path=row.get("file_path"),
                chunk_order_index=row.get("chunk_order_index"),
                tokens=row.get("tokens"),
                content_preview=_content_preview(content),
                content_length=len(content),
                chunk_type=_chunk_type(structured_content),
                has_structured_content=bool(structured_content),
                entity_count=entity_counts.get(chunk_id, 0),
                relation_count=relation_counts.get(chunk_id, 0),
                created_at=row.get("create_time") or row.get("created_at"),
                updated_at=row.get("update_time") or row.get("updated_at"),
            )
        )
    return items


async def _build_chunk_detail(rag, chunk_id: str) -> ChunkDetailResponse:
    chunk = await rag.text_chunks.get_by_id(chunk_id) if rag.text_chunks else None
    if not chunk:
        raise HTTPException(status_code=404, detail=f"Chunk '{chunk_id}' not found")

    structured_content = _coerce_json(chunk.get("structured_content"))
    doc_id = chunk.get("full_doc_id") or chunk.get("doc_id")
    document = None
    if doc_id and rag.doc_status:
        doc_status = await rag.doc_status.get_by_id(doc_id)
        if doc_status:
            document = ChunkDocumentRef(
                doc_id=str(doc_id),
                file_path=doc_status.get("file_path") or chunk.get("file_path"),
                status=str(doc_status.get("status")) if doc_status.get("status") else None,
                chunks_count=doc_status.get("chunks_count"),
            )

    entity_refs = await _scan_chunk_refs(rag.entity_chunks, [chunk_id])
    relation_refs = await _scan_chunk_refs(rag.relation_chunks, [chunk_id])

    entities: list[ChunkEntityRef] = []
    for entity_id in sorted(entity_refs):
        node = await rag.chunk_entity_relation_graph.get_node(entity_id) or {}
        edges = await rag.chunk_entity_relation_graph.get_node_edges(entity_id) or []
        entities.append(
            ChunkEntityRef(
                entity_id=entity_id,
                entity_type=node.get("entity_type"),
                description=node.get("description"),
                degree=len(edges),
            )
        )

    relations: list[ChunkRelationRef] = []
    for relation_key in sorted(relation_refs):
        parts = _relation_parts(relation_key)
        if not parts:
            continue
        source_id, target_id = parts
        edge = await rag.chunk_entity_relation_graph.get_edge(source_id, target_id) or {}
        relations.append(
            ChunkRelationRef(
                source_id=source_id,
                target_id=target_id,
                keywords=edge.get("keywords"),
                description=edge.get("description"),
                weight=edge.get("weight"),
            )
        )

    content = chunk.get("content") or ""
    return ChunkDetailResponse(
        chunk_id=chunk_id,
        doc_id=doc_id,
        file_path=chunk.get("file_path"),
        chunk_order_index=chunk.get("chunk_order_index"),
        tokens=chunk.get("tokens"),
        content=content,
        content_length=len(content),
        chunk_type=_chunk_type(structured_content),
        structured_content=structured_content,
        llm_cache_list=[str(item) for item in chunk.get("llm_cache_list", []) or []],
        created_at=chunk.get("create_time") or chunk.get("created_at"),
        updated_at=chunk.get("update_time") or chunk.get("updated_at"),
        document=document,
        entities=entities,
        relations=relations,
        deletion_impact=await _build_chunk_impact(rag, [chunk_id]),
    )


def create_chunk_routes(rag, api_key: Optional[str] = None):
    combined_auth = get_combined_auth_dependency(api_key)

    @router.post(
        "",
        response_model=ChunksResponse,
        dependencies=[Depends(combined_auth)],
        summary="List chunks",
        description=(
            "List document chunks in the current workspace with pagination, search, "
            "document filtering, chunk type filtering, and entity/relation counts."
        ),
    )
    async def list_chunks(http_request: Request, request: ChunksRequest = Body(...)):
        try:
            _, workspace_rag = await _workspace_rag_or_default(http_request, rag)
            if not workspace_rag.text_chunks:
                raise HTTPException(status_code=500, detail="Chunk storage is not configured")

            if hasattr(workspace_rag.text_chunks, "db") and workspace_rag.text_chunks.db:
                rows, total_count = await _list_chunks_from_postgres(workspace_rag, request)
            else:
                rows, total_count = await _list_chunks_from_memory(workspace_rag, request)

            return ChunksResponse(
                chunks=await _chunk_list_items(workspace_rag, rows),
                pagination=_pagination(request.page, request.page_size, total_count),
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error listing chunks: %s", e)
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @router.get(
        "/by-document/{doc_id}",
        response_model=ChunksResponse,
        dependencies=[Depends(combined_auth)],
        summary="List chunks for one document",
    )
    async def list_chunks_by_document(
        http_request: Request,
        doc_id: str,
        page: int = 1,
        page_size: int = 100,
    ):
        request = ChunksRequest(
            page=page,
            page_size=page_size,
            doc_id=doc_id,
            sort_field="chunk_order_index",
            sort_direction="asc",
        )
        return await list_chunks(http_request, request)

    @router.get(
        "/{chunk_id}",
        response_model=ChunkDetailResponse,
        dependencies=[Depends(combined_auth)],
        summary="Get chunk detail",
        description="Return full chunk content, structured content, document info, linked entities, linked relations, and deletion impact.",
    )
    async def get_chunk_detail(http_request: Request, chunk_id: str):
        try:
            _, workspace_rag = await _workspace_rag_or_default(http_request, rag)
            return await _build_chunk_detail(workspace_rag, chunk_id)
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error getting chunk detail: %s", e)
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @router.patch(
        "/{chunk_id}",
        response_model=ChunkDetailResponse,
        dependencies=[Depends(combined_auth)],
        summary="Update chunk content or structured content",
        description=(
            "Update a chunk's text content and/or structured_content JSON. The chunk vector is "
            "re-embedded when the vector store is available. Graph extraction is not rerun; "
            "operators should reprocess the source document when semantic entity changes are needed."
        ),
    )
    async def update_chunk(
        http_request: Request,
        chunk_id: str,
        request: ChunkUpdateRequest,
    ):
        try:
            _, workspace_rag = await _workspace_rag_or_default(http_request, rag)
            if not workspace_rag.text_chunks:
                raise HTTPException(status_code=500, detail="Chunk storage is not configured")

            chunk = await workspace_rag.text_chunks.get_by_id(chunk_id)
            if not chunk:
                raise HTTPException(status_code=404, detail=f"Chunk '{chunk_id}' not found")

            fields_set = request.model_fields_set
            if (
                "content" not in fields_set
                and "structured_content" not in fields_set
                and not request.clear_structured_content
            ):
                raise HTTPException(status_code=400, detail="No chunk fields to update")

            if "content" in fields_set and request.content is not None:
                chunk["content"] = request.content

            if request.clear_structured_content:
                chunk["structured_content"] = None
            elif "structured_content" in fields_set:
                chunk["structured_content"] = request.structured_content

            chunk.setdefault("tokens", 0)
            chunk.setdefault("chunk_order_index", 0)
            chunk.setdefault("full_doc_id", chunk.get("doc_id") or "")
            chunk.setdefault("file_path", "")
            chunk["update_time"] = int(time.time())

            await workspace_rag.text_chunks.upsert({chunk_id: chunk})
            if workspace_rag.chunks_vdb:
                await workspace_rag.chunks_vdb.upsert({chunk_id: chunk})

            if request.invalidate_cache and workspace_rag.llm_response_cache:
                await workspace_rag.llm_response_cache.drop()
                await workspace_rag.llm_response_cache.index_done_callback()

            await workspace_rag._insert_done()
            return await _build_chunk_detail(workspace_rag, chunk_id)
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error updating chunk: %s", e)
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    return router
