"""
Operational deletion routes for LightRAG.

These endpoints separate deletion impact preview from execution so UI and
external clients can choose an explicit deletion policy.
"""

from __future__ import annotations

import json
import time
import traceback
import uuid
from datetime import datetime
from typing import Any, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from lightrag.constants import GRAPH_FIELD_SEP
from lightrag.kg.postgres_impl import namespace_to_table_name
from lightrag.kg.shared_storage import get_default_workspace
from lightrag.utils import compute_mdhash_id, logger, make_relation_chunk_key
from lightrag.utils_graph import _find_orphan_chunks, adelete_by_entity, adelete_by_relation

from ..utils_api import decode_workspace_header, get_combined_auth_dependency

router = APIRouter(prefix="/deletions", tags=["deletions"])

_get_rag_for_workspace = None

DeletionTargetType = Literal["document", "chunk", "entity", "relation"]
DeletionPolicy = Literal[
    "graph_only",
    "cascade_safe",
    "cascade_full",
    "delete_documents",
    "force_delete_chunks",
]


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


class RelationSelector(BaseModel):
    source_id: str = Field(
        ...,
        min_length=1,
        description="Source entity name for the relation to preview or delete.",
        examples=["RAG"],
    )
    target_id: str = Field(
        ...,
        min_length=1,
        description="Target entity name for the relation to preview or delete.",
        examples=["검색"],
    )


class DeletionRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "target_type": "document",
                    "policy": "delete_documents",
                    "ids": ["doc-99a56f6420082bd50a298fa61b1d5e9c"],
                    "relations": [],
                    "delete_llm_cache": True,
                    "invalidate_cache": True,
                },
                {
                    "target_type": "chunk",
                    "policy": "force_delete_chunks",
                    "ids": ["chunk-99a56f6420082bd50a298fa61b1d5e9c"],
                    "relations": [],
                    "delete_llm_cache": True,
                    "invalidate_cache": True,
                },
                {
                    "target_type": "entity",
                    "policy": "cascade_safe",
                    "ids": ["RAG"],
                    "relations": [],
                    "invalidate_cache": True,
                },
                {
                    "target_type": "entity",
                    "policy": "cascade_full",
                    "ids": ["RAG"],
                    "relations": [],
                    "delete_llm_cache": True,
                    "invalidate_cache": True,
                },
                {
                    "target_type": "relation",
                    "policy": "cascade_safe",
                    "ids": [],
                    "relations": [
                        {
                            "source_id": "RAG",
                            "target_id": "검색",
                        }
                    ],
                    "invalidate_cache": True,
                },
            ]
        }
    )

    target_type: DeletionTargetType = Field(
        ...,
        description=(
            "Deletion target category. Use 'document' for full document deletion, "
            "'chunk' for direct chunk deletion, 'entity' for knowledge-graph entity deletion, "
            "and 'relation' for knowledge-graph relation deletion."
        ),
        examples=["entity"],
    )
    policy: DeletionPolicy = Field(
        default="cascade_safe",
        description=(
            "Deletion policy. document requires 'delete_documents'; chunk requires "
            "'force_delete_chunks'; entity/relation support 'cascade_safe', "
            "'cascade_full', or 'graph_only'. "
            "'cascade_safe' removes graph/vector/chunk mappings and deletes orphan chunks only. "
            "'cascade_full' removes the source chunks that support the target and updates all "
            "entities/relations/documents impacted by those chunks. "
            "'graph_only' removes only graph nodes or edges."
        ),
        examples=["cascade_safe"],
    )
    ids: list[str] = Field(
        default_factory=list,
        description=(
            "Target IDs for document, chunk, or entity deletion. Ignored for relation deletion. "
            "Examples: doc-..., chunk-..., or an entity name such as 'RAG'."
        ),
        examples=[["RAG"]],
    )
    relations: list[RelationSelector] = Field(
        default_factory=list,
        description=(
            "Relation targets. Required when target_type='relation'. "
            "Each item identifies one graph edge by source_id and target_id."
        ),
    )
    delete_file: bool = Field(
        default=False,
        description=(
            "Compatibility flag for document workflows. The synchronous deletion endpoint "
            "focuses on stored RAG data; physical upload-file deletion remains handled by "
            "the existing /documents/delete_document background endpoint."
        ),
    )
    delete_s3_file: bool = Field(
        default=False,
        description=(
            "Compatibility flag for document workflows. S3 object deletion remains handled by "
            "the existing /documents/delete_document background endpoint."
        ),
    )
    delete_llm_cache: bool = Field(
        default=False,
        description=(
            "When supported by the target type, delete LLM extraction cache entries tied to "
            "the target. Query cache invalidation is controlled separately by invalidate_cache."
        ),
    )
    invalidate_cache: bool = Field(
        default=True,
        description="Invalidate the workspace query cache after a successful execute operation.",
    )

    @field_validator("ids", mode="after")
    @classmethod
    def clean_ids(cls, ids: list[str]) -> list[str]:
        return [item.strip() for item in ids if item and item.strip()]


class DeletionPreviewResponse(BaseModel):
    status: str = Field(description="Preview status.")
    workspace: str = Field(description="Workspace where the deletion was previewed.")
    target_type: DeletionTargetType = Field(description="Deletion target category.")
    policy: DeletionPolicy = Field(description="Requested deletion policy.")
    executable: bool = Field(
        description="Whether the same request can be sent to /deletions/execute."
    )
    summary: dict[str, Any] = Field(
        description="Compact counts for UI confirmation screens."
    )
    impact: dict[str, Any] = Field(
        description=(
            "Detailed affected objects. Shape differs by target_type and includes affected "
            "documents, chunks, entities, relations, orphan chunks, shared chunks, and missing targets."
        )
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="Operator-facing warnings that should be shown before execution.",
    )
    missing: list[str] = Field(
        default_factory=list,
        description="Requested IDs or relation keys that were not found.",
    )


class DeletionExecuteResponse(BaseModel):
    status: str = Field(description="Execution status.")
    workspace: str = Field(description="Workspace where the deletion was executed.")
    target_type: DeletionTargetType = Field(description="Deletion target category.")
    policy: DeletionPolicy = Field(description="Executed deletion policy.")
    job_id: str | None = Field(
        default=None,
        description="Deletion snapshot job ID that can be used for restore preview/execute.",
    )
    preview: DeletionPreviewResponse = Field(
        description="Impact preview calculated immediately before execution."
    )
    results: list[dict[str, Any]] = Field(
        description="Per-target execution results, including success, not_found, or failure information."
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="Warnings copied from the preview and relevant to this execution.",
    )


class DeletionJobSummary(BaseModel):
    job_id: str
    workspace: str
    target_type: DeletionTargetType
    policy: DeletionPolicy
    created_at: str | None = None
    restored_at: str | None = None
    summary: dict[str, Any] = Field(default_factory=dict)
    counts: dict[str, int] = Field(default_factory=dict)


class DeletionJobListResponse(BaseModel):
    jobs: list[DeletionJobSummary]
    total_count: int


class DeletionJobDetail(DeletionJobSummary):
    request: dict[str, Any] = Field(default_factory=dict)
    preview: dict[str, Any] = Field(default_factory=dict)


class RestoreRequest(BaseModel):
    overwrite: bool = Field(
        default=False,
        description="When false, existing PostgreSQL rows and graph items are preserved.",
    )
    invalidate_cache: bool = Field(
        default=True,
        description="Invalidate workspace query cache after restore execution.",
    )


class RestorePreviewResponse(BaseModel):
    status: str
    workspace: str
    job_id: str
    executable: bool
    already_restored: bool = False
    counts: dict[str, int] = Field(default_factory=dict)
    conflicts: dict[str, int] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class RestoreExecuteResponse(BaseModel):
    status: str
    workspace: str
    job_id: str
    preview: RestorePreviewResponse
    restored: dict[str, int] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


def _parse_chunk_ids(raw_value: Any) -> list[str]:
    if not raw_value:
        return []
    if isinstance(raw_value, str):
        try:
            raw_value = json.loads(raw_value)
        except json.JSONDecodeError:
            raw_value = [cid for cid in raw_value.split(GRAPH_FIELD_SEP) if cid]
    if isinstance(raw_value, list):
        return [str(cid) for cid in raw_value if cid]
    return []


def _split_source_ids(source_id: Any) -> list[str]:
    if not source_id:
        return []
    return [cid for cid in str(source_id).split(GRAPH_FIELD_SEP) if cid]


def _join_source_ids(chunk_ids: list[str]) -> str:
    return GRAPH_FIELD_SEP.join(dict.fromkeys(chunk_ids))


def _json_loads_maybe(value: Any, default: Any = None) -> Any:
    if value is None:
        return default
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return default
    return value


def _json_dumps_maybe(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, str):
        return value
    return json.dumps(value)


def _snapshot_db(rag):
    return getattr(getattr(rag, "doc_status", None), "db", None)


async def _ensure_snapshot_table(db) -> None:
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS LIGHTRAG_DELETION_SNAPSHOTS (
            workspace VARCHAR(255) NOT NULL,
            job_id VARCHAR(64) NOT NULL,
            target_type VARCHAR(32) NOT NULL,
            policy VARCHAR(64) NOT NULL,
            request_json JSONB NOT NULL,
            preview_json JSONB NOT NULL,
            snapshot_json JSONB NOT NULL,
            restored_at TIMESTAMP NULL,
            create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT LIGHTRAG_DELETION_SNAPSHOTS_PK PRIMARY KEY (workspace, job_id)
        )
        """
    )


async def _fetch_snapshot_rows(
    db,
    table_name: str,
    workspace: str,
    ids: list[str],
    *,
    id_column: str = "id",
    has_vector: bool = False,
) -> list[dict[str, Any]]:
    ids = [str(item) for item in dict.fromkeys(ids) if item]
    if not ids:
        return []

    selector = (
        "(to_jsonb(t) - 'content_vector') || jsonb_build_object('content_vector', t.content_vector::text)"
        if has_vector
        else "to_jsonb(t)"
    )
    rows = await db.query(
        f"""
        SELECT {selector} AS row_data
        FROM {table_name} t
        WHERE t.workspace = $1 AND t.{id_column} = ANY($2::text[])
        ORDER BY t.{id_column}
        """,
        [workspace, ids],
        multirows=True,
    )
    return [
        _json_loads_maybe(row.get("row_data"), {})
        for row in rows or []
        if row.get("row_data") is not None
    ]


def _doc_ids_from_impact(impact: dict[str, Any]) -> list[str]:
    doc_ids: list[str] = []
    for doc in impact.get("documents", []):
        if doc.get("doc_id"):
            doc_ids.append(str(doc["doc_id"]))
    for doc in impact.get("chunk_impact", {}).get("documents", []):
        if doc.get("doc_id"):
            doc_ids.append(str(doc["doc_id"]))
    return list(dict.fromkeys(doc_ids))


def _chunk_ids_from_impact(impact: dict[str, Any]) -> list[str]:
    chunk_ids: list[str] = []
    for chunk in impact.get("chunks", []):
        if chunk.get("chunk_id"):
            chunk_ids.append(str(chunk["chunk_id"]))
    for chunk in impact.get("chunk_impact", {}).get("chunks", []):
        if chunk.get("chunk_id"):
            chunk_ids.append(str(chunk["chunk_id"]))
    chunk_ids.extend(_real_chunk_ids(impact.get("full_delete_chunk_ids", [])))
    return list(dict.fromkeys(chunk_ids))


def _entity_names_from_impact(request: DeletionRequest, impact: dict[str, Any]) -> list[str]:
    entity_names: list[str] = []
    if request.target_type == "entity":
        entity_names.extend(request.ids)
    for entity in impact.get("entities", []):
        if entity.get("entity_id"):
            entity_names.append(str(entity["entity_id"]))
        for relation in entity.get("relations", []) or []:
            if relation.get("source_id"):
                entity_names.append(str(relation["source_id"]))
            if relation.get("target_id"):
                entity_names.append(str(relation["target_id"]))
    chunk_impact = impact.get("chunk_impact", impact)
    entity_names.extend(str(item) for item in chunk_impact.get("entities_to_delete", []) if item)
    for item in chunk_impact.get("entities_to_update", []):
        if item.get("entity_id"):
            entity_names.append(str(item["entity_id"]))
    for relation in request.relations:
        entity_names.extend([relation.source_id, relation.target_id])
    return list(dict.fromkeys(entity_names))


def _relation_pairs_from_impact(request: DeletionRequest, impact: dict[str, Any]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    pairs.extend((relation.source_id, relation.target_id) for relation in request.relations)
    for entity in impact.get("entities", []):
        for relation in entity.get("relations", []) or []:
            source_id = relation.get("source_id")
            target_id = relation.get("target_id")
            if source_id and target_id:
                pairs.append((str(source_id), str(target_id)))
    for relation in impact.get("relations", []):
        source_id = relation.get("source_id")
        target_id = relation.get("target_id")
        if source_id and target_id:
            pairs.append((str(source_id), str(target_id)))
    chunk_impact = impact.get("chunk_impact", impact)
    for relation in chunk_impact.get("relations_to_delete", []) + chunk_impact.get("relations_to_update", []):
        source_id = relation.get("source_id")
        target_id = relation.get("target_id")
        if source_id and target_id:
            pairs.append((str(source_id), str(target_id)))
    return list(dict.fromkeys(pairs))


def _snapshot_counts(snapshot: dict[str, Any]) -> dict[str, int]:
    table_counts = {
        table_name.lower(): len(rows)
        for table_name, rows in (snapshot.get("tables") or {}).items()
    }
    graph = snapshot.get("graph") or {}
    table_counts["graph_nodes"] = len(graph.get("nodes") or [])
    table_counts["graph_edges"] = len(graph.get("edges") or [])
    return table_counts


async def _build_deletion_snapshot(rag, request: DeletionRequest, preview: DeletionPreviewResponse) -> dict[str, Any]:
    db = _snapshot_db(rag)
    if db is None:
        return {"supported": False, "reason": "PostgreSQL snapshot storage is not available."}

    workspace = preview.workspace
    impact = preview.impact
    doc_ids = list(dict.fromkeys(request.ids if request.target_type == "document" else []))
    doc_ids.extend(_doc_ids_from_impact(impact))
    doc_ids = list(dict.fromkeys(doc_ids))

    chunk_ids = list(dict.fromkeys(request.ids if request.target_type == "chunk" else []))
    chunk_ids.extend(_chunk_ids_from_impact(impact))
    chunk_ids = _real_chunk_ids(chunk_ids)

    entity_names = _entity_names_from_impact(request, impact)
    relation_pairs = _relation_pairs_from_impact(request, impact)
    relation_keys = [_relation_key(source_id, target_id) for source_id, target_id in relation_pairs]
    relation_vdb_ids: list[str] = []
    for source_id, target_id in relation_pairs:
        relation_vdb_ids.extend(_relation_vdb_ids(source_id, target_id))

    tables = {
        "LIGHTRAG_DOC_STATUS": await _fetch_snapshot_rows(db, "LIGHTRAG_DOC_STATUS", workspace, doc_ids),
        "LIGHTRAG_DOC_FULL": await _fetch_snapshot_rows(db, "LIGHTRAG_DOC_FULL", workspace, doc_ids),
        "LIGHTRAG_DOC_CHUNKS": await _fetch_snapshot_rows(db, "LIGHTRAG_DOC_CHUNKS", workspace, chunk_ids),
        "LIGHTRAG_VDB_CHUNKS": await _fetch_snapshot_rows(db, "LIGHTRAG_VDB_CHUNKS", workspace, chunk_ids, has_vector=True),
        "LIGHTRAG_VDB_ENTITY": await _fetch_snapshot_rows(
            db,
            "LIGHTRAG_VDB_ENTITY",
            workspace,
            entity_names,
            id_column="entity_name",
            has_vector=True,
        ),
        "LIGHTRAG_VDB_RELATION": await _fetch_snapshot_rows(
            db,
            "LIGHTRAG_VDB_RELATION",
            workspace,
            relation_vdb_ids,
            has_vector=True,
        ),
        "LIGHTRAG_ENTITY_CHUNKS": await _fetch_snapshot_rows(db, "LIGHTRAG_ENTITY_CHUNKS", workspace, entity_names),
        "LIGHTRAG_RELATION_CHUNKS": await _fetch_snapshot_rows(db, "LIGHTRAG_RELATION_CHUNKS", workspace, relation_keys),
        "LIGHTRAG_FULL_ENTITIES": await _fetch_snapshot_rows(db, "LIGHTRAG_FULL_ENTITIES", workspace, doc_ids),
        "LIGHTRAG_FULL_RELATIONS": await _fetch_snapshot_rows(db, "LIGHTRAG_FULL_RELATIONS", workspace, doc_ids),
    }

    graph_nodes = []
    for entity_name in entity_names:
        node_data = await rag.chunk_entity_relation_graph.get_node(entity_name)
        if node_data:
            graph_nodes.append({"entity_id": entity_name, "data": node_data})

    graph_edges = []
    for source_id, target_id in relation_pairs:
        edge_data = await rag.chunk_entity_relation_graph.get_edge(source_id, target_id)
        if edge_data:
            graph_edges.append(
                {
                    "source_id": source_id,
                    "target_id": target_id,
                    "data": edge_data,
                }
            )

    snapshot = {
        "supported": True,
        "tables": tables,
        "graph": {
            "nodes": graph_nodes,
            "edges": graph_edges,
        },
        "counts": {},
    }
    snapshot["counts"] = _snapshot_counts(snapshot)
    return snapshot


async def _create_deletion_snapshot(
    rag,
    workspace: str,
    request: DeletionRequest,
    preview: DeletionPreviewResponse,
) -> str | None:
    db = _snapshot_db(rag)
    if db is None:
        logger.warning("[Deletion] Snapshot skipped: PostgreSQL DB is not available")
        return None

    await _ensure_snapshot_table(db)
    snapshot = await _build_deletion_snapshot(rag, request, preview)
    if not snapshot.get("supported", False):
        return None

    job_id = f"del-{int(time.time())}-{uuid.uuid4().hex[:8]}"
    await db.execute(
        """
        INSERT INTO LIGHTRAG_DELETION_SNAPSHOTS
            (workspace, job_id, target_type, policy, request_json, preview_json, snapshot_json)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
        """,
        {
            "workspace": workspace,
            "job_id": job_id,
            "target_type": request.target_type,
            "policy": request.policy,
            "request_json": request.model_dump_json(),
            "preview_json": preview.model_dump_json(),
            "snapshot_json": json.dumps(snapshot),
        },
    )
    return job_id


async def _get_deletion_job(db, workspace: str, job_id: str) -> dict[str, Any] | None:
    await _ensure_snapshot_table(db)
    row = await db.query(
        """
        SELECT workspace, job_id, target_type, policy, request_json, preview_json,
               snapshot_json, restored_at::text AS restored_at, create_time::text AS created_at
        FROM LIGHTRAG_DELETION_SNAPSHOTS
        WHERE workspace = $1 AND job_id = $2
        """,
        [workspace, job_id],
    )
    if not row:
        return None
    row["request_json"] = _json_loads_maybe(row.get("request_json"), {})
    row["preview_json"] = _json_loads_maybe(row.get("preview_json"), {})
    row["snapshot_json"] = _json_loads_maybe(row.get("snapshot_json"), {})
    return row


def _job_summary_from_row(row: dict[str, Any]) -> DeletionJobSummary:
    preview = _json_loads_maybe(row.get("preview_json"), {})
    snapshot = _json_loads_maybe(row.get("snapshot_json"), {})
    return DeletionJobSummary(
        job_id=str(row.get("job_id")),
        workspace=str(row.get("workspace")),
        target_type=row.get("target_type"),
        policy=row.get("policy"),
        created_at=row.get("created_at"),
        restored_at=row.get("restored_at"),
        summary=preview.get("summary", {}) if isinstance(preview, dict) else {},
        counts=snapshot.get("counts", {}) if isinstance(snapshot, dict) else {},
    )


TABLE_RESTORE_COLUMNS: dict[str, list[str]] = {
    "LIGHTRAG_DOC_STATUS": [
        "workspace",
        "id",
        "content_summary",
        "content_length",
        "chunks_count",
        "status",
        "file_path",
        "chunks_list",
        "track_id",
        "metadata",
        "error_msg",
        "s3_url",
        "doc_nm",
        "created_at",
        "updated_at",
    ],
    "LIGHTRAG_DOC_FULL": [
        "id",
        "workspace",
        "doc_name",
        "content",
        "meta",
        "create_time",
        "update_time",
    ],
    "LIGHTRAG_DOC_CHUNKS": [
        "id",
        "workspace",
        "full_doc_id",
        "chunk_order_index",
        "tokens",
        "content",
        "file_path",
        "llm_cache_list",
        "create_time",
        "update_time",
        "structured_content",
    ],
    "LIGHTRAG_VDB_CHUNKS": [
        "id",
        "workspace",
        "full_doc_id",
        "chunk_order_index",
        "tokens",
        "content",
        "content_vector",
        "file_path",
        "create_time",
        "update_time",
        "structured_content",
    ],
    "LIGHTRAG_VDB_ENTITY": [
        "id",
        "workspace",
        "entity_name",
        "content",
        "content_vector",
        "create_time",
        "update_time",
        "chunk_ids",
        "file_path",
    ],
    "LIGHTRAG_VDB_RELATION": [
        "id",
        "workspace",
        "source_id",
        "target_id",
        "content",
        "content_vector",
        "create_time",
        "update_time",
        "chunk_ids",
        "file_path",
    ],
    "LIGHTRAG_ENTITY_CHUNKS": [
        "id",
        "workspace",
        "chunk_ids",
        "count",
        "create_time",
        "update_time",
    ],
    "LIGHTRAG_RELATION_CHUNKS": [
        "id",
        "workspace",
        "chunk_ids",
        "count",
        "create_time",
        "update_time",
    ],
    "LIGHTRAG_FULL_ENTITIES": [
        "id",
        "workspace",
        "entity_names",
        "count",
        "create_time",
        "update_time",
    ],
    "LIGHTRAG_FULL_RELATIONS": [
        "id",
        "workspace",
        "relation_pairs",
        "count",
        "create_time",
        "update_time",
    ],
}

JSONB_COLUMNS = {
    "chunks_list",
    "metadata",
    "meta",
    "llm_cache_list",
    "structured_content",
    "entity_names",
    "relation_pairs",
}
TIMESTAMP_COLUMNS = {"created_at", "updated_at", "create_time", "update_time"}
VECTOR_COLUMNS = {"content_vector"}
JSONB_CHUNK_ID_TABLES = {"LIGHTRAG_ENTITY_CHUNKS", "LIGHTRAG_RELATION_CHUNKS"}


def _is_jsonb_column(table_name: str, column: str) -> bool:
    return column in JSONB_COLUMNS or (
        column == "chunk_ids" and table_name in JSONB_CHUNK_ID_TABLES
    )


def _sql_cast_for_column(table_name: str, column: str) -> str:
    if _is_jsonb_column(table_name, column):
        return "::jsonb"
    if column in TIMESTAMP_COLUMNS:
        return "::timestamp"
    if column in VECTOR_COLUMNS:
        return "::vector"
    return ""


def _restore_value(table_name: str, column: str, value: Any) -> Any:
    if _is_jsonb_column(table_name, column):
        return _json_dumps_maybe(value)
    if column in TIMESTAMP_COLUMNS and isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
    return value


async def _restore_table_rows(db, table_name: str, rows: list[dict[str, Any]], overwrite: bool) -> int:
    columns = TABLE_RESTORE_COLUMNS.get(table_name)
    if not columns or not rows:
        return 0

    placeholders = [
        f"${index}{_sql_cast_for_column(table_name, column)}"
        for index, column in enumerate(columns, start=1)
    ]
    insert_columns = ", ".join(columns)
    insert_values = ", ".join(placeholders)
    if overwrite:
        update_clause = ", ".join(
            f"{column}=EXCLUDED.{column}"
            for column in columns
            if column not in {"workspace", "id"}
        )
        conflict_clause = f"ON CONFLICT (workspace, id) DO UPDATE SET {update_clause}"
    else:
        conflict_clause = "ON CONFLICT (workspace, id) DO NOTHING"
    sql = f"""
        INSERT INTO {table_name} ({insert_columns})
        VALUES ({insert_values})
        {conflict_clause}
    """

    restored = 0
    for row in rows:
        data = {
            column: _restore_value(table_name, column, row.get(column))
            for column in columns
        }
        await db.execute(sql, data)
        restored += 1
    return restored


async def _snapshot_conflict_counts(rag, snapshot: dict[str, Any], overwrite: bool) -> dict[str, int]:
    if overwrite:
        return {}
    db = _snapshot_db(rag)
    if db is None:
        return {}

    conflicts: dict[str, int] = {}
    workspace = getattr(rag, "workspace", None) or getattr(getattr(rag, "doc_status", None), "workspace", None)
    for table_name, rows in (snapshot.get("tables") or {}).items():
        if table_name not in TABLE_RESTORE_COLUMNS:
            continue
        ids = [str(row.get("id")) for row in rows or [] if row.get("id")]
        if not ids or not workspace:
            continue
        result = await db.query(
            f"SELECT COUNT(*) AS count FROM {table_name} WHERE workspace=$1 AND id = ANY($2::text[])",
            [workspace, list(dict.fromkeys(ids))],
        )
        count = int((result or {}).get("count", 0))
        if count:
            conflicts[table_name.lower()] = count

    graph = snapshot.get("graph") or {}
    node_conflicts = 0
    for node in graph.get("nodes") or []:
        entity_id = node.get("entity_id")
        if entity_id and await rag.chunk_entity_relation_graph.has_node(entity_id):
            node_conflicts += 1
    if node_conflicts:
        conflicts["graph_nodes"] = node_conflicts

    edge_conflicts = 0
    for edge in graph.get("edges") or []:
        source_id = edge.get("source_id")
        target_id = edge.get("target_id")
        if source_id and target_id and await rag.chunk_entity_relation_graph.has_edge(source_id, target_id):
            edge_conflicts += 1
    if edge_conflicts:
        conflicts["graph_edges"] = edge_conflicts

    return conflicts


async def _build_restore_preview(
    rag,
    job: dict[str, Any],
    request: RestoreRequest,
) -> RestorePreviewResponse:
    snapshot = job.get("snapshot_json") or {}
    already_restored = bool(job.get("restored_at"))
    conflicts = await _snapshot_conflict_counts(rag, snapshot, request.overwrite)
    warnings: list[str] = []

    if already_restored:
        warnings.append("This deletion job was already restored before; executing restore again is allowed.")
    if conflicts and not request.overwrite:
        warnings.append("Some snapshot rows already exist and will be skipped unless overwrite is enabled.")
    if not snapshot.get("supported", True):
        warnings.append(str(snapshot.get("reason") or "Snapshot is not restorable."))
    original_request = job.get("request_json") or {}
    if isinstance(original_request, dict) and (
        original_request.get("delete_file") or original_request.get("delete_s3_file")
    ):
        warnings.append("Database and graph data can be restored, but deleted physical files or S3 objects are not recreated.")

    return RestorePreviewResponse(
        status="success",
        workspace=str(job.get("workspace")),
        job_id=str(job.get("job_id")),
        executable=bool(snapshot.get("supported", True)),
        already_restored=already_restored,
        counts=snapshot.get("counts", {}) if isinstance(snapshot, dict) else {},
        conflicts=conflicts,
        warnings=warnings,
    )


async def _restore_snapshot(rag, snapshot: dict[str, Any], overwrite: bool) -> dict[str, int]:
    db = _snapshot_db(rag)
    if db is None:
        raise HTTPException(status_code=400, detail="PostgreSQL restore storage is not available")

    restored: dict[str, int] = {}
    restore_order = [
        "LIGHTRAG_DOC_STATUS",
        "LIGHTRAG_DOC_FULL",
        "LIGHTRAG_DOC_CHUNKS",
        "LIGHTRAG_VDB_CHUNKS",
        "LIGHTRAG_VDB_ENTITY",
        "LIGHTRAG_VDB_RELATION",
        "LIGHTRAG_ENTITY_CHUNKS",
        "LIGHTRAG_RELATION_CHUNKS",
        "LIGHTRAG_FULL_ENTITIES",
        "LIGHTRAG_FULL_RELATIONS",
    ]
    tables = snapshot.get("tables") or {}
    for table_name in restore_order:
        count = await _restore_table_rows(db, table_name, tables.get(table_name) or [], overwrite)
        if count:
            restored[table_name.lower()] = count

    graph = snapshot.get("graph") or {}
    graph_nodes = 0
    for node in graph.get("nodes") or []:
        entity_id = node.get("entity_id")
        if not entity_id:
            continue
        if not overwrite and await rag.chunk_entity_relation_graph.has_node(entity_id):
            continue
        await rag.chunk_entity_relation_graph.upsert_node(entity_id, node.get("data") or {})
        graph_nodes += 1

    graph_edges = 0
    for edge in graph.get("edges") or []:
        source_id = edge.get("source_id")
        target_id = edge.get("target_id")
        if not source_id or not target_id:
            continue
        if not overwrite and await rag.chunk_entity_relation_graph.has_edge(source_id, target_id):
            continue
        await rag.chunk_entity_relation_graph.upsert_edge(source_id, target_id, edge.get("data") or {})
        graph_edges += 1

    if graph_nodes:
        restored["graph_nodes"] = graph_nodes
    if graph_edges:
        restored["graph_edges"] = graph_edges

    await rag._insert_done()
    await _sync_workspace_stats_after_deletion(rag)
    return restored


def _real_chunk_ids(chunk_ids: list[str]) -> list[str]:
    return [
        str(chunk_id)
        for chunk_id in dict.fromkeys(chunk_ids)
        if chunk_id and str(chunk_id).startswith("chunk-")
    ]


def _relation_key(src: str, tgt: str) -> str:
    return make_relation_chunk_key(src, tgt)


def _relation_vdb_ids(src: str, tgt: str) -> list[str]:
    return [
        compute_mdhash_id(src + tgt, prefix="rel-"),
        compute_mdhash_id(tgt + src, prefix="rel-"),
    ]


def _collect_entity_full_chunk_ids(impact: dict[str, Any]) -> list[str]:
    chunk_ids: list[str] = []
    for entity in impact.get("entities", []):
        chunk_ids.extend(_real_chunk_ids(entity.get("candidate_chunks", [])))
    return list(dict.fromkeys(chunk_ids))


def _collect_relation_full_chunk_ids(impact: dict[str, Any]) -> list[str]:
    chunk_ids: list[str] = []
    for relation in impact.get("relations", []):
        chunk_ids.extend(_real_chunk_ids(relation.get("relation_chunks", [])))
    return list(dict.fromkeys(chunk_ids))


async def _workspace_rag_or_default(http_request: Request, default_rag):
    workspace = _get_workspace_from_request(http_request)
    workspace_rag = await get_workspace_rag(workspace)
    if workspace_rag is None:
        workspace_rag = default_rag
        logger.warning("[Deletion] Using default RAG instance for workspace: %s", workspace)
    return workspace, workspace_rag


async def _scan_chunk_refs(storage, chunk_ids: list[str]) -> dict[str, list[str]]:
    """Return storage key -> referenced target chunk ids."""
    if not storage or not chunk_ids:
        return {}

    refs: dict[str, set[str]] = {}
    target_chunk_ids = list(dict.fromkeys(str(chunk_id) for chunk_id in chunk_ids if chunk_id))

    if hasattr(storage, "db") and getattr(storage, "db", None) is not None:
        table_name = namespace_to_table_name(storage.namespace)
        sql = f"""
            SELECT id, chunk_ids
            FROM {table_name}
            WHERE workspace=$1
              AND EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements_text(chunk_ids) AS chunk_ref(value)
                  WHERE chunk_ref.value = ANY($2::text[])
              )
        """
        rows = await storage.db.query(
            sql,
            [storage.workspace, target_chunk_ids],
            multirows=True,
        )
        target = set(target_chunk_ids)
        for row in rows or []:
            ref_id = str(row.get("id"))
            matched = target.intersection(_parse_chunk_ids(row.get("chunk_ids")))
            if matched:
                refs.setdefault(ref_id, set()).update(matched)
        return {key: sorted(values) for key, values in refs.items()}

    data = getattr(storage, "_data", None)
    if data is not None:
        data_dict = dict(data) if not isinstance(data, dict) else data
        target = set(target_chunk_ids)
        for key, value in data_dict.items():
            value_chunk_ids = set(_parse_chunk_ids((value or {}).get("chunk_ids")))
            matched = target.intersection(value_chunk_ids)
            if matched:
                refs[str(key)] = matched

    return {key: sorted(values) for key, values in refs.items()}


async def _get_entity_chunk_ids(rag, entity_name: str) -> list[str]:
    if rag.entity_chunks:
        entity_data = await rag.entity_chunks.get_by_id(entity_name)
        if entity_data:
            chunk_ids = _parse_chunk_ids(entity_data.get("chunk_ids"))
            if chunk_ids:
                return chunk_ids

    node_data = await rag.chunk_entity_relation_graph.get_node(entity_name)
    if node_data:
        return _split_source_ids(node_data.get("source_id"))
    return []


async def _get_relation_chunk_ids(rag, source_id: str, target_id: str) -> list[str]:
    if rag.relation_chunks:
        rel_data = await rag.relation_chunks.get_by_id(_relation_key(source_id, target_id))
        if rel_data:
            chunk_ids = _parse_chunk_ids(rel_data.get("chunk_ids"))
            if chunk_ids:
                return chunk_ids

    edge_data = await rag.chunk_entity_relation_graph.get_edge(source_id, target_id)
    if edge_data:
        return _split_source_ids(edge_data.get("source_id"))
    return []


async def _get_docs_for_chunks(rag, chunk_ids: list[str]) -> dict[str, dict[str, Any]]:
    docs: dict[str, dict[str, Any]] = {}
    chunks = await rag.text_chunks.get_by_ids(chunk_ids) if rag.text_chunks else []

    for chunk_id, chunk_data in zip(chunk_ids, chunks):
        if not chunk_data:
            continue
        doc_id = chunk_data.get("full_doc_id") or chunk_data.get("doc_id")
        if doc_id and doc_id not in docs:
            doc_status = await rag.doc_status.get_by_id(doc_id)
            docs[str(doc_id)] = {
                "doc_id": str(doc_id),
                "file_path": (doc_status or {}).get("file_path") or chunk_data.get("file_path"),
                "status": (doc_status or {}).get("status"),
                "chunks_count": (doc_status or {}).get("chunks_count"),
                "matched_chunks": [chunk_id],
            }
        elif doc_id:
            docs[str(doc_id)]["matched_chunks"].append(chunk_id)

    missing_doc_chunks = [cid for cid in chunk_ids if not any(cid in doc["matched_chunks"] for doc in docs.values())]
    if missing_doc_chunks and hasattr(rag.doc_status, "db"):
        sql = """
            SELECT id, file_path, status, chunks_count, chunks_list
            FROM LIGHTRAG_DOC_STATUS
            WHERE workspace=$1 AND chunks_list @> $2::jsonb
        """
        for chunk_id in missing_doc_chunks:
            rows = await rag.doc_status.db.query(
                sql,
                [rag.doc_status.workspace, json.dumps([chunk_id])],
                multirows=True,
            )
            for row in rows or []:
                doc_id = str(row.get("id"))
                docs.setdefault(
                    doc_id,
                    {
                        "doc_id": doc_id,
                        "file_path": row.get("file_path"),
                        "status": row.get("status"),
                        "chunks_count": row.get("chunks_count"),
                        "matched_chunks": [],
                    },
                )
                if chunk_id not in docs[doc_id]["matched_chunks"]:
                    docs[doc_id]["matched_chunks"].append(chunk_id)

    data = getattr(rag.doc_status, "_data", None)
    if missing_doc_chunks and data is not None:
        data_dict = dict(data) if not isinstance(data, dict) else data
        target = set(missing_doc_chunks)
        for doc_id, doc_data in data_dict.items():
            matched = target.intersection(_parse_chunk_ids((doc_data or {}).get("chunks_list")))
            if matched:
                docs.setdefault(
                    str(doc_id),
                    {
                        "doc_id": str(doc_id),
                        "file_path": (doc_data or {}).get("file_path"),
                        "status": (doc_data or {}).get("status"),
                        "chunks_count": (doc_data or {}).get("chunks_count"),
                        "matched_chunks": [],
                    },
                )
                docs[str(doc_id)]["matched_chunks"].extend(sorted(matched))

    return docs


async def _build_chunk_impact(rag, chunk_ids: list[str]) -> dict[str, Any]:
    chunks = await rag.text_chunks.get_by_ids(chunk_ids) if rag.text_chunks else []
    existing_chunks = []
    missing_chunks = []
    for chunk_id, chunk_data in zip(chunk_ids, chunks):
        if chunk_data:
            existing_chunks.append(
                {
                    "chunk_id": chunk_id,
                    "doc_id": chunk_data.get("full_doc_id") or chunk_data.get("doc_id"),
                    "file_path": chunk_data.get("file_path"),
                    "content_length": len(chunk_data.get("content", "") or ""),
                    "tokens": chunk_data.get("tokens"),
                }
            )
        else:
            missing_chunks.append(chunk_id)

    entity_refs = await _scan_chunk_refs(rag.entity_chunks, chunk_ids)
    relation_refs = await _scan_chunk_refs(rag.relation_chunks, chunk_ids)
    docs = await _get_docs_for_chunks(rag, chunk_ids)

    entities_to_delete = []
    entities_to_update = []
    for entity_name in sorted(entity_refs):
        existing_sources = await _get_entity_chunk_ids(rag, entity_name)
        remaining = [cid for cid in existing_sources if cid not in chunk_ids]
        if remaining:
            entities_to_update.append(
                {
                    "entity_id": entity_name,
                    "removed_chunks": entity_refs[entity_name],
                    "remaining_chunks": remaining,
                }
            )
        else:
            entities_to_delete.append(entity_name)

    relations_to_delete = []
    relations_to_update = []
    for relation_key in sorted(relation_refs):
        parts = relation_key.split(GRAPH_FIELD_SEP)
        if len(parts) < 2:
            continue
        source_id, target_id = parts[0], parts[1]
        existing_sources = await _get_relation_chunk_ids(rag, source_id, target_id)
        remaining = [cid for cid in existing_sources if cid not in chunk_ids]
        item = {
            "source_id": source_id,
            "target_id": target_id,
            "removed_chunks": relation_refs[relation_key],
            "remaining_chunks": remaining,
        }
        if remaining:
            relations_to_update.append(item)
        else:
            relations_to_delete.append(item)

    return {
        "chunks": existing_chunks,
        "missing_chunks": missing_chunks,
        "documents": list(docs.values()),
        "entities_to_delete": entities_to_delete,
        "entities_to_update": entities_to_update,
        "relations_to_delete": relations_to_delete,
        "relations_to_update": relations_to_update,
    }


async def _build_document_impact(rag, doc_ids: list[str]) -> dict[str, Any]:
    documents = []
    missing = []
    target_chunk_ids: list[str] = []

    for doc_id in doc_ids:
        doc_status = await rag.doc_status.get_by_id(doc_id)
        if not doc_status:
            missing.append(doc_id)
            continue
        chunks = _parse_chunk_ids(doc_status.get("chunks_list"))
        target_chunk_ids.extend(chunks)
        documents.append(
            {
                "doc_id": doc_id,
                "file_path": doc_status.get("file_path"),
                "status": doc_status.get("status"),
                "chunks_count": doc_status.get("chunks_count"),
                "chunks": chunks,
            }
        )

    chunk_impact = await _build_chunk_impact(rag, list(dict.fromkeys(target_chunk_ids)))
    return {
        "documents": documents,
        "missing_documents": missing,
        "chunk_impact": chunk_impact,
    }


async def _build_entity_impact(rag, entity_ids: list[str], cascade: bool) -> dict[str, Any]:
    items = []
    missing = []

    for entity_id in entity_ids:
        if not await rag.chunk_entity_relation_graph.has_node(entity_id):
            missing.append(entity_id)
            continue
        node_data = await rag.chunk_entity_relation_graph.get_node(entity_id) or {}
        edges = await rag.chunk_entity_relation_graph.get_node_edges(entity_id) or []
        entity_chunk_ids = await _get_entity_chunk_ids(rag, entity_id)
        relation_chunk_ids: list[str] = []
        relations = []
        for src, tgt in edges:
            rel_chunk_ids = await _get_relation_chunk_ids(rag, src, tgt)
            real_rel_chunk_ids = _real_chunk_ids(rel_chunk_ids)
            relation_chunk_ids.extend(real_rel_chunk_ids)
            relations.append({"source_id": src, "target_id": tgt, "chunks": real_rel_chunk_ids})

        real_entity_chunk_ids = _real_chunk_ids(entity_chunk_ids)
        real_candidate_chunk_ids = _real_chunk_ids(real_entity_chunk_ids + relation_chunk_ids)
        orphan_chunks = []
        shared_chunks = []
        if cascade and real_candidate_chunk_ids:
            orphan_chunks = await _find_orphan_chunks(
                real_candidate_chunk_ids,
                rag.entity_chunks,
                rag.relation_chunks,
            )
            orphan_set = set(orphan_chunks)
            shared_chunks = [
                cid for cid in real_candidate_chunk_ids if cid not in orphan_set
            ]

        items.append(
            {
                "entity_id": entity_id,
                "entity_type": node_data.get("entity_type"),
                "description": node_data.get("description"),
                "relations": relations,
                "entity_chunks": real_entity_chunk_ids,
                "candidate_chunks": real_candidate_chunk_ids,
                "orphan_chunks": orphan_chunks,
                "shared_chunks": shared_chunks,
            }
        )

    return {"entities": items, "missing_entities": missing}


async def _build_relation_impact(rag, relations: list[RelationSelector], cascade: bool) -> dict[str, Any]:
    items = []
    missing = []

    for relation in relations:
        source_id = relation.source_id
        target_id = relation.target_id
        if not await rag.chunk_entity_relation_graph.has_edge(source_id, target_id):
            missing.append(f"{source_id}{GRAPH_FIELD_SEP}{target_id}")
            continue
        edge_data = await rag.chunk_entity_relation_graph.get_edge(source_id, target_id) or {}
        relation_chunk_ids = await _get_relation_chunk_ids(rag, source_id, target_id)
        real_relation_chunk_ids = _real_chunk_ids(relation_chunk_ids)
        orphan_chunks = []
        shared_chunks = []
        if cascade and real_relation_chunk_ids:
            orphan_chunks = await _find_orphan_chunks(
                list(dict.fromkeys(real_relation_chunk_ids)),
                rag.entity_chunks,
                rag.relation_chunks,
            )
            orphan_set = set(orphan_chunks)
            shared_chunks = [
                cid for cid in real_relation_chunk_ids if cid not in orphan_set
            ]

        items.append(
            {
                "source_id": source_id,
                "target_id": target_id,
                "description": edge_data.get("description"),
                "keywords": edge_data.get("keywords"),
                "relation_chunks": real_relation_chunk_ids,
                "orphan_chunks": orphan_chunks,
                "shared_chunks": shared_chunks,
            }
        )

    return {"relations": items, "missing_relations": missing}


def _summary_for(target_type: str, policy: str, impact: dict[str, Any]) -> dict[str, Any]:
    if target_type == "document":
        chunk_impact = impact.get("chunk_impact", {})
        return {
            "documents": len(impact.get("documents", [])),
            "chunks_to_delete": len(chunk_impact.get("chunks", [])),
            "entities_to_delete": len(chunk_impact.get("entities_to_delete", [])),
            "entities_to_update": len(chunk_impact.get("entities_to_update", [])),
            "relations_to_delete": len(chunk_impact.get("relations_to_delete", [])),
            "relations_to_update": len(chunk_impact.get("relations_to_update", [])),
        }
    if target_type == "chunk":
        return {
            "chunks_to_delete": len(impact.get("chunks", [])),
            "documents_affected": len(impact.get("documents", [])),
            "entities_to_delete": len(impact.get("entities_to_delete", [])),
            "entities_to_update": len(impact.get("entities_to_update", [])),
            "relations_to_delete": len(impact.get("relations_to_delete", [])),
            "relations_to_update": len(impact.get("relations_to_update", [])),
        }
    if target_type == "entity":
        entities = impact.get("entities", [])
        if policy == "cascade_full":
            chunk_impact = impact.get("chunk_impact", {})
            return {
                "entities_to_delete": len(entities),
                "relations_to_delete": sum(len(item.get("relations", [])) for item in entities),
                "chunks_to_delete": len(chunk_impact.get("chunks", [])),
                "documents_affected": len(chunk_impact.get("documents", [])),
                "entities_to_update": len(chunk_impact.get("entities_to_update", [])),
                "relations_to_update": len(chunk_impact.get("relations_to_update", [])),
                "graph_only": False,
            }
        return {
            "entities_to_delete": len(entities),
            "relations_to_delete": sum(len(item.get("relations", [])) for item in entities),
            "orphan_chunks_to_delete": sum(len(item.get("orphan_chunks", [])) for item in entities),
            "shared_chunks_to_scrub": sum(len(item.get("shared_chunks", [])) for item in entities),
            "graph_only": policy == "graph_only",
        }
    relations = impact.get("relations", [])
    if policy == "cascade_full":
        chunk_impact = impact.get("chunk_impact", {})
        return {
            "relations_to_delete": len(relations),
            "chunks_to_delete": len(chunk_impact.get("chunks", [])),
            "documents_affected": len(chunk_impact.get("documents", [])),
            "entities_to_delete": len(chunk_impact.get("entities_to_delete", [])),
            "entities_to_update": len(chunk_impact.get("entities_to_update", [])),
            "relations_to_update": len(chunk_impact.get("relations_to_update", [])),
            "graph_only": False,
        }
    return {
        "relations_to_delete": len(relations),
        "orphan_chunks_to_delete": sum(len(item.get("orphan_chunks", [])) for item in relations),
        "graph_only": policy == "graph_only",
    }


def _warnings_for(request: DeletionRequest, impact: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    if request.target_type in ("entity", "relation") and request.policy == "cascade_safe":
        warnings.append("cascade_safe deletes graph/vector/chunk mappings, but shared source chunks remain unless orphaned.")
    if request.target_type in ("entity", "relation") and request.policy == "cascade_full":
        warnings.append("cascade_full deletes source chunks that support the target and may update or delete other entities and relations derived from those chunks.")
    if request.target_type == "chunk" and request.policy == "force_delete_chunks":
        warnings.append("force_delete_chunks removes chunk text/vector data, updates graph references, and removes document tracking when no chunks remain.")
        for doc in impact.get("documents", []):
            if doc.get("chunks_count") == len(doc.get("matched_chunks", [])):
                warnings.append(f"document '{doc.get('doc_id')}' will be removed from document status because all chunks are selected.")
    if request.target_type in ("entity", "relation") and request.policy == "cascade_full":
        for doc in impact.get("chunk_impact", {}).get("documents", []):
            if doc.get("chunks_count") == len(doc.get("matched_chunks", [])):
                warnings.append(f"document '{doc.get('doc_id')}' will be removed from document status because all chunks are selected.")
    if request.target_type == "document" and request.policy != "delete_documents":
        warnings.append("document targets should normally use policy=delete_documents.")
    return warnings


async def _build_preview(
    rag,
    workspace: str,
    request: DeletionRequest,
) -> DeletionPreviewResponse:
    if request.target_type == "relation":
        target_count = len(request.relations)
    else:
        target_count = len(request.ids)
    if target_count == 0:
        raise HTTPException(status_code=400, detail="No deletion targets provided")

    if request.target_type == "document":
        impact = await _build_document_impact(rag, request.ids)
        missing = impact.get("missing_documents", [])
    elif request.target_type == "chunk":
        impact = await _build_chunk_impact(rag, request.ids)
        missing = impact.get("missing_chunks", [])
    elif request.target_type == "entity":
        impact = await _build_entity_impact(rag, request.ids, request.policy != "graph_only")
        if request.policy == "cascade_full":
            full_delete_chunk_ids = _collect_entity_full_chunk_ids(impact)
            impact["full_delete_chunk_ids"] = full_delete_chunk_ids
            impact["chunk_impact"] = await _build_chunk_impact(rag, full_delete_chunk_ids)
        missing = impact.get("missing_entities", [])
    else:
        impact = await _build_relation_impact(rag, request.relations, request.policy != "graph_only")
        if request.policy == "cascade_full":
            full_delete_chunk_ids = _collect_relation_full_chunk_ids(impact)
            impact["full_delete_chunk_ids"] = full_delete_chunk_ids
            impact["chunk_impact"] = await _build_chunk_impact(rag, full_delete_chunk_ids)
        missing = impact.get("missing_relations", [])

    allowed_policies = {
        "document": {"delete_documents"},
        "chunk": {"force_delete_chunks"},
        "entity": {"graph_only", "cascade_safe", "cascade_full"},
        "relation": {"graph_only", "cascade_safe", "cascade_full"},
    }
    executable = request.policy in allowed_policies[request.target_type]

    warnings = _warnings_for(request, impact)
    if not executable:
        warnings.append(f"policy '{request.policy}' is not executable for target_type '{request.target_type}'.")

    return DeletionPreviewResponse(
        status="success",
        workspace=workspace,
        target_type=request.target_type,
        policy=request.policy,
        executable=executable,
        summary=_summary_for(request.target_type, request.policy, impact),
        impact=impact,
        warnings=warnings,
        missing=missing,
    )


async def _update_doc_status_after_chunk_delete(rag, chunk_ids: set[str], docs: list[dict[str, Any]]) -> int:
    updated = 0
    now = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    for doc in docs:
        doc_id = doc.get("doc_id")
        if not doc_id:
            continue
        doc_status = await rag.doc_status.get_by_id(doc_id)
        if not doc_status:
            continue
        chunks_list = _parse_chunk_ids(doc_status.get("chunks_list"))
        remaining = [cid for cid in chunks_list if cid not in chunk_ids]
        if remaining == chunks_list:
            continue
        doc_status["chunks_list"] = remaining
        doc_status["chunks_count"] = len(remaining)
        doc_status["updated_at"] = now
        await rag.doc_status.upsert({doc_id: doc_status})
        updated += 1
    return updated


async def _get_entity_names_for_chunks(rag, chunk_ids: list[str]) -> list[str]:
    chunk_ids = _real_chunk_ids(chunk_ids)
    if not chunk_ids or not rag.entity_chunks:
        return []

    db = getattr(rag.entity_chunks, "db", None)
    if db is not None:
        sql = """
            SELECT ec.id
            FROM LIGHTRAG_ENTITY_CHUNKS ec
            JOIN LIGHTRAG_VDB_ENTITY ve
              ON ve.workspace = ec.workspace
             AND ve.entity_name = ec.id
            WHERE ec.workspace = $1
              AND EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements_text(COALESCE(ec.chunk_ids, '[]'::jsonb)) AS cid(value)
                  WHERE cid.value = ANY($2::text[])
              )
            ORDER BY ec.id
        """
        rows = await db.query(sql, [rag.entity_chunks.workspace, chunk_ids], multirows=True)
        return [str(row["id"]) for row in rows or [] if row.get("id")]

    return []


async def _get_relation_pairs_for_chunks(rag, chunk_ids: list[str]) -> list[list[str]]:
    chunk_ids = _real_chunk_ids(chunk_ids)
    if not chunk_ids or not rag.relation_chunks:
        return []

    db = getattr(rag.relation_chunks, "db", None)
    if db is not None:
        sql = """
            SELECT id
            FROM LIGHTRAG_RELATION_CHUNKS
            WHERE workspace = $1
              AND EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements_text(COALESCE(chunk_ids, '[]'::jsonb)) AS cid(value)
                  WHERE cid.value = ANY($2::text[])
              )
            ORDER BY id
        """
        rows = await db.query(sql, [rag.relation_chunks.workspace, chunk_ids], multirows=True)
        pairs: list[list[str]] = []
        for row in rows or []:
            parts = str(row.get("id") or "").split(GRAPH_FIELD_SEP)
            if len(parts) >= 2 and parts[0] and parts[1]:
                pairs.append([parts[0], parts[1]])
        return pairs

    return []


async def _cleanup_stale_document_tracking(
    rag,
    candidate_doc_ids: list[str] | None = None,
) -> dict[str, int]:
    db = getattr(getattr(rag, "full_entities", None), "db", None)
    workspace = getattr(getattr(rag, "full_entities", None), "workspace", None)
    if db is None or not workspace:
        return {
            "stale_documents_deleted": 0,
            "full_entities_deleted": 0,
            "full_relations_deleted": 0,
            "full_docs_deleted": 0,
        }

    candidate_doc_ids = list(dict.fromkeys(candidate_doc_ids or []))
    if not candidate_doc_ids:
        return {
            "stale_documents_deleted": 0,
            "full_entities_deleted": 0,
            "full_relations_deleted": 0,
            "full_docs_deleted": 0,
        }

    stale_docs_sql = """
        SELECT ds.id
        FROM LIGHTRAG_DOC_STATUS ds
        WHERE ds.workspace = $1
          AND ds.id = ANY($2::text[])
          AND COALESCE(ds.chunks_count, 0) = 0
          AND NOT EXISTS (
              SELECT 1 FROM LIGHTRAG_DOC_CHUNKS dc
              WHERE dc.workspace = ds.workspace AND dc.full_doc_id = ds.id
          )
    """
    stale_doc_rows = await db.query(stale_docs_sql, [workspace, candidate_doc_ids], multirows=True)
    stale_doc_ids = [str(row["id"]) for row in stale_doc_rows or [] if row.get("id")]

    full_docs_deleted = 0
    if stale_doc_ids:
        if getattr(rag, "full_entities", None):
            await rag.full_entities.delete(stale_doc_ids)
        if getattr(rag, "full_relations", None):
            await rag.full_relations.delete(stale_doc_ids)
        if getattr(rag, "full_docs", None):
            await rag.full_docs.delete(stale_doc_ids)
            full_docs_deleted = len(stale_doc_ids)
        if getattr(rag, "doc_status", None):
            await rag.doc_status.delete(stale_doc_ids)

    entities_sql = """
        DELETE FROM LIGHTRAG_FULL_ENTITIES fe
        WHERE fe.workspace = $1
          AND fe.id = ANY($2::text[])
          AND NOT EXISTS (
              SELECT 1 FROM LIGHTRAG_DOC_STATUS ds
              WHERE ds.workspace = fe.workspace AND ds.id = fe.id
          )
        RETURNING fe.id
    """
    relations_sql = """
        DELETE FROM LIGHTRAG_FULL_RELATIONS fr
        WHERE fr.workspace = $1
          AND fr.id = ANY($2::text[])
          AND NOT EXISTS (
              SELECT 1 FROM LIGHTRAG_DOC_STATUS ds
              WHERE ds.workspace = fr.workspace AND ds.id = fr.id
          )
        RETURNING fr.id
    """
    entity_rows = await db.query(entities_sql, [workspace, candidate_doc_ids], multirows=True)
    relation_rows = await db.query(relations_sql, [workspace, candidate_doc_ids], multirows=True)
    return {
        "stale_documents_deleted": len(stale_doc_ids),
        "full_entities_deleted": len(entity_rows or []),
        "full_relations_deleted": len(relation_rows or []),
        "full_docs_deleted": full_docs_deleted,
    }


async def _sync_workspace_stats_after_deletion(rag) -> None:
    db = getattr(getattr(rag, "doc_status", None), "db", None)
    workspace = getattr(rag, "workspace", None) or getattr(getattr(rag, "doc_status", None), "workspace", None)
    if db is not None and workspace and hasattr(db, "sync_workspace_stats"):
        await db.sync_workspace_stats(workspace)


async def _sync_document_tracking_after_mutation(
    rag,
    touched_chunk_ids: list[str],
    deleted_chunk_ids: set[str] | None = None,
    doc_hints: list[dict[str, Any]] | None = None,
) -> dict[str, int]:
    deleted_chunk_ids = deleted_chunk_ids or set()
    touched_chunk_ids = _real_chunk_ids(touched_chunk_ids)
    doc_ids: list[str] = []

    for doc in doc_hints or []:
        doc_id = doc.get("doc_id")
        if doc_id:
            doc_ids.append(str(doc_id))

    if touched_chunk_ids:
        docs_for_chunks = await _get_docs_for_chunks(rag, touched_chunk_ids)
        doc_ids.extend(docs_for_chunks.keys())

    doc_ids = list(dict.fromkeys(doc_ids))
    if not doc_ids:
        await _sync_workspace_stats_after_deletion(rag)
        return {
            "documents_updated": 0,
            "documents_deleted": 0,
            "full_tracking_updated": 0,
            "stale_documents_deleted": 0,
            "full_entities_deleted": 0,
            "full_relations_deleted": 0,
            "full_docs_deleted": 0,
        }

    updated_docs = 0
    deleted_docs = 0
    full_tracking_updated = 0
    now = time.strftime("%Y-%m-%dT%H:%M:%S%z")

    for doc_id in doc_ids:
        doc_status = await rag.doc_status.get_by_id(doc_id) if rag.doc_status else None
        if not doc_status:
            if rag.full_entities:
                await rag.full_entities.delete([doc_id])
            if rag.full_relations:
                await rag.full_relations.delete([doc_id])
            continue

        original_chunks = _parse_chunk_ids(doc_status.get("chunks_list"))
        remaining_candidates = [cid for cid in original_chunks if cid not in deleted_chunk_ids]
        chunk_rows = await rag.text_chunks.get_by_ids(remaining_candidates) if rag.text_chunks else []
        remaining_chunks = [
            chunk_id
            for chunk_id, chunk_row in zip(remaining_candidates, chunk_rows)
            if chunk_row
        ]

        if not remaining_chunks:
            if rag.full_entities:
                await rag.full_entities.delete([doc_id])
            if rag.full_relations:
                await rag.full_relations.delete([doc_id])
            if getattr(rag, "full_docs", None):
                await rag.full_docs.delete([doc_id])
            if rag.doc_status:
                await rag.doc_status.delete([doc_id])
            deleted_docs += 1
            continue

        if remaining_chunks != original_chunks or doc_status.get("chunks_count") != len(remaining_chunks):
            doc_status["chunks_list"] = remaining_chunks
            doc_status["chunks_count"] = len(remaining_chunks)
            doc_status["updated_at"] = now
            await rag.doc_status.upsert({doc_id: doc_status})
            updated_docs += 1

        entity_names = await _get_entity_names_for_chunks(rag, remaining_chunks)
        if rag.full_entities:
            if entity_names:
                await rag.full_entities.upsert(
                    {
                        doc_id: {
                            "entity_names": entity_names,
                            "count": len(entity_names),
                        }
                    }
                )
            else:
                await rag.full_entities.delete([doc_id])

        relation_pairs = await _get_relation_pairs_for_chunks(rag, remaining_chunks)
        if rag.full_relations:
            if relation_pairs:
                await rag.full_relations.upsert(
                    {
                        doc_id: {
                            "relation_pairs": relation_pairs,
                            "count": len(relation_pairs),
                        }
                    }
                )
            else:
                await rag.full_relations.delete([doc_id])
        full_tracking_updated += 1

    stale_cleanup = await _cleanup_stale_document_tracking(rag, doc_ids)
    await _sync_workspace_stats_after_deletion(rag)
    return {
        "documents_updated": updated_docs,
        "documents_deleted": deleted_docs,
        "full_tracking_updated": full_tracking_updated,
        **stale_cleanup,
    }


async def _execute_force_delete_chunks(rag, chunk_ids: list[str], impact: dict[str, Any], request: DeletionRequest) -> dict[str, Any]:
    existing_chunk_ids = [
        chunk["chunk_id"]
        for chunk in impact.get("chunks", [])
        if chunk.get("chunk_id")
    ]
    unique_chunk_ids = list(dict.fromkeys(existing_chunk_ids))
    if not unique_chunk_ids:
        return {
            "target": "chunks",
            "status": "not_found",
            "deleted_chunks": 0,
            "missing_chunks": impact.get("missing_chunks", chunk_ids),
        }
    chunk_id_set = set(unique_chunk_ids)

    cache_ids: list[str] = []
    if request.delete_llm_cache and rag.text_chunks:
        chunk_rows = await rag.text_chunks.get_by_ids(unique_chunk_ids)
        for chunk in chunk_rows:
            if not chunk:
                continue
            for cache_id in chunk.get("llm_cache_list", []) or []:
                if isinstance(cache_id, str) and cache_id not in cache_ids:
                    cache_ids.append(cache_id)

    relation_updates = 0
    relation_deletes = 0
    for relation in impact.get("relations_to_update", []):
        source_id = relation["source_id"]
        target_id = relation["target_id"]
        remaining = relation.get("remaining_chunks", [])
        edge_data = await rag.chunk_entity_relation_graph.get_edge(source_id, target_id) or {}
        edge_data["source_id"] = _join_source_ids(remaining)
        await rag.chunk_entity_relation_graph.upsert_edge(source_id, target_id, edge_data)
        if rag.relation_chunks:
            await rag.relation_chunks.upsert(
                {
                    _relation_key(source_id, target_id): {
                        "chunk_ids": remaining,
                        "count": len(remaining),
                        "updated_at": int(time.time()),
                    }
                }
            )
        relation_updates += 1

    for relation in impact.get("relations_to_delete", []):
        source_id = relation["source_id"]
        target_id = relation["target_id"]
        await rag.relationships_vdb.delete(_relation_vdb_ids(source_id, target_id))
        await rag.chunk_entity_relation_graph.remove_edges([(source_id, target_id)])
        if rag.relation_chunks:
            await rag.relation_chunks.delete([_relation_key(source_id, target_id)])
        relation_deletes += 1

    entity_updates = 0
    entity_deletes = 0
    for entity in impact.get("entities_to_update", []):
        entity_id = entity["entity_id"]
        remaining = entity.get("remaining_chunks", [])
        node_data = await rag.chunk_entity_relation_graph.get_node(entity_id) or {}
        node_data["source_id"] = _join_source_ids(remaining)
        await rag.chunk_entity_relation_graph.upsert_node(entity_id, node_data)
        if rag.entity_chunks:
            await rag.entity_chunks.upsert(
                {
                    entity_id: {
                        "chunk_ids": remaining,
                        "count": len(remaining),
                        "updated_at": int(time.time()),
                    }
                }
            )
        entity_updates += 1

    entities_to_delete = list(dict.fromkeys(impact.get("entities_to_delete", [])))
    if entities_to_delete:
        edges_to_delete: set[tuple[str, str]] = set()
        nodes_edges = await rag.chunk_entity_relation_graph.get_nodes_edges_batch(entities_to_delete)
        for edges in nodes_edges.values():
            for src, tgt in edges or []:
                edges_to_delete.add(tuple(sorted((src, tgt))))
        if edges_to_delete:
            rel_ids = []
            rel_keys = []
            for src, tgt in edges_to_delete:
                rel_ids.extend(_relation_vdb_ids(src, tgt))
                rel_keys.append(_relation_key(src, tgt))
            await rag.relationships_vdb.delete(rel_ids)
            if rag.relation_chunks:
                await rag.relation_chunks.delete(rel_keys)
        await rag.chunk_entity_relation_graph.remove_nodes(entities_to_delete)
        await rag.entities_vdb.delete([compute_mdhash_id(e, prefix="ent-") for e in entities_to_delete])
        if rag.entity_chunks:
            await rag.entity_chunks.delete(entities_to_delete)
        entity_deletes = len(entities_to_delete)

    if rag.chunks_vdb:
        await rag.chunks_vdb.delete(unique_chunk_ids)
    if rag.text_chunks:
        await rag.text_chunks.delete(unique_chunk_ids)

    doc_cleanup = await _sync_document_tracking_after_mutation(
        rag,
        unique_chunk_ids,
        chunk_id_set,
        doc_hints=impact.get("documents", []),
    )

    if request.delete_llm_cache and cache_ids and rag.llm_response_cache:
        await rag.llm_response_cache.delete(cache_ids)
    if request.invalidate_cache and rag.llm_response_cache:
        await rag.llm_response_cache.drop()
        await rag.llm_response_cache.index_done_callback()

    await rag._insert_done()

    return {
        "target": "chunks",
        "status": "success",
        "deleted_chunks": len(unique_chunk_ids),
        **doc_cleanup,
        "entities_deleted": entity_deletes,
        "entities_updated": entity_updates,
        "relations_deleted": relation_deletes,
        "relations_updated": relation_updates,
        "llm_cache_entries_deleted": len(cache_ids),
    }


DELETION_REQUEST_EXAMPLES = {
    "document-delete": {
        "summary": "문서 단위 삭제",
        "description": "문서와 문서에서 파생된 청크, 벡터, 그래프 데이터를 삭제하기 전에 영향도를 확인하거나 실행합니다.",
        "value": {
            "target_type": "document",
            "policy": "delete_documents",
            "ids": ["doc-99a56f6420082bd50a298fa61b1d5e9c"],
            "relations": [],
            "delete_llm_cache": True,
            "invalidate_cache": True,
        },
    },
    "chunk-force-delete": {
        "summary": "청크 단위 강제 삭제",
        "description": "지정 청크를 삭제하고 관련 엔티티/관계의 source_id 및 chunk mapping을 함께 정리합니다.",
        "value": {
            "target_type": "chunk",
            "policy": "force_delete_chunks",
            "ids": ["chunk-99a56f6420082bd50a298fa61b1d5e9c"],
            "relations": [],
            "delete_llm_cache": True,
            "invalidate_cache": True,
        },
    },
    "entity-cascade-safe": {
        "summary": "엔티티 안전 삭제",
        "description": "엔티티, 연결 관계, 벡터/매핑을 삭제하고 다른 엔티티/관계가 더 이상 참조하지 않는 청크만 삭제합니다.",
        "value": {
            "target_type": "entity",
            "policy": "cascade_safe",
            "ids": ["RAG"],
            "relations": [],
            "invalidate_cache": True,
        },
    },
    "entity-cascade-full": {
        "summary": "엔티티 완전 삭제",
        "description": "엔티티를 지탱하는 원본 청크까지 삭제하고, 그 청크에서 파생된 다른 엔티티/관계/문서 구조를 함께 갱신합니다.",
        "value": {
            "target_type": "entity",
            "policy": "cascade_full",
            "ids": ["RAG"],
            "relations": [],
            "delete_llm_cache": True,
            "invalidate_cache": True,
        },
    },
    "entity-graph-only": {
        "summary": "엔티티 그래프만 삭제",
        "description": "그래프 노드만 삭제합니다. 벡터, 청크, 추적 매핑은 남기므로 운영 정리에는 cascade_safe를 우선 사용하세요.",
        "value": {
            "target_type": "entity",
            "policy": "graph_only",
            "ids": ["RAG"],
            "relations": [],
            "invalidate_cache": True,
        },
    },
    "relation-cascade-safe": {
        "summary": "관계 안전 삭제",
        "description": "지정 관계의 그래프 edge, 관계 벡터, 관계-청크 매핑을 삭제하고 orphan 청크만 추가 삭제합니다.",
        "value": {
            "target_type": "relation",
            "policy": "cascade_safe",
            "ids": [],
            "relations": [
                {
                    "source_id": "RAG",
                    "target_id": "검색",
                }
            ],
            "invalidate_cache": True,
        },
    },
    "relation-cascade-full": {
        "summary": "관계 완전 삭제",
        "description": "지정 관계를 지탱하는 청크까지 삭제하고, 그 청크에서 파생된 엔티티/관계/문서 구조를 함께 갱신합니다.",
        "value": {
            "target_type": "relation",
            "policy": "cascade_full",
            "ids": [],
            "relations": [
                {
                    "source_id": "RAG",
                    "target_id": "검색",
                }
            ],
            "delete_llm_cache": True,
            "invalidate_cache": True,
        },
    },
}


PREVIEW_DESCRIPTION = """
삭제 실행 전 영향도를 계산합니다.

운영 UI나 외부 시스템은 먼저 이 API를 호출해 사용자가 삭제 대상을 확인할 수 있게 해야 합니다.
이 API는 데이터를 변경하지 않으며, 같은 요청을 `/deletions/execute`에 보낼 수 있는지 `executable`로 알려줍니다.

정책별 동작:
- `document + delete_documents`: 문서 삭제 시 함께 사라질 청크, 엔티티, 관계 영향도를 계산합니다.
- `chunk + force_delete_chunks`: 청크 직접 삭제 시 영향을 받는 문서, 엔티티, 관계를 계산합니다.
- `entity + cascade_safe`: 엔티티와 연결 관계를 삭제할 때 orphan 청크와 공유 청크를 구분합니다.
- `entity + cascade_full`: 엔티티를 지탱하는 청크까지 삭제할 때 다른 엔티티/관계/문서 영향도를 계산합니다.
- `entity + graph_only`: 그래프 노드만 삭제하는 영향도를 계산합니다.
- `relation + cascade_safe`: 관계 삭제 시 관계 매핑과 orphan 청크를 계산합니다.
- `relation + cascade_full`: 관계를 지탱하는 청크까지 삭제할 때 다른 엔티티/관계/문서 영향도를 계산합니다.
- `relation + graph_only`: 그래프 edge만 삭제하는 영향도를 계산합니다.

응답 해석:
- `summary`: 확인 모달이나 목록에 표시하기 좋은 숫자 요약입니다.
- `impact`: 실제 영향 대상의 상세 목록입니다.
- `warnings`: 실행 전에 사용자에게 보여야 할 주의사항입니다.
- `missing`: 요청했지만 찾지 못한 ID 또는 relation key입니다.
"""


EXECUTE_DESCRIPTION = """
삭제를 실제 실행합니다.

권장 흐름은 같은 request body로 먼저 `/deletions/preview`를 호출한 뒤, 사용자가 영향도를 확인하면
`/deletions/execute`를 호출하는 방식입니다. execute는 내부적으로 실행 직전 preview를 다시 계산하고,
그 결과를 응답의 `preview` 필드에 함께 반환합니다.

주의:
- 이 작업은 되돌릴 수 없습니다.
- `document`는 `policy=delete_documents`만 실행 가능합니다.
- `chunk`는 `policy=force_delete_chunks`만 실행 가능합니다.
- `entity`와 `relation`은 `cascade_safe`, `cascade_full`, 또는 `graph_only`를 사용할 수 있습니다.
- `cascade_safe`는 공유 중인 청크를 보존하고, 더 이상 참조되지 않는 orphan 청크만 삭제합니다.
- `cascade_full`은 대상 엔티티/관계를 지탱하는 청크까지 삭제하므로 같은 청크에서 파생된 다른 엔티티/관계도 함께 갱신될 수 있습니다.
- `graph_only`는 그래프만 삭제하므로 벡터/청크 매핑과 검색 결과가 불일치할 수 있습니다.
- 물리 파일 또는 S3 객체 삭제는 기존 `/documents/delete_document` background API에서 처리합니다.
"""


PREVIEW_RESPONSE_EXAMPLES = {
    "entity-preview": {
        "summary": "엔티티 삭제 영향도",
        "value": {
            "status": "success",
            "workspace": "feature-local",
            "target_type": "entity",
            "policy": "cascade_safe",
            "executable": True,
            "summary": {
                "entities_to_delete": 1,
                "relations_to_delete": 8,
                "orphan_chunks_to_delete": 0,
                "shared_chunks_to_scrub": 1,
                "graph_only": False,
            },
            "impact": {
                "entities": [
                    {
                        "entity_id": "RAG",
                        "entity_type": "product",
                        "relations": [
                            {
                                "source_id": "RAG",
                                "target_id": "검색",
                                "chunks": ["chunk-99a56f6420082bd50a298fa61b1d5e9c"],
                            }
                        ],
                        "entity_chunks": ["chunk-99a56f6420082bd50a298fa61b1d5e9c"],
                        "candidate_chunks": ["chunk-99a56f6420082bd50a298fa61b1d5e9c"],
                        "orphan_chunks": [],
                        "shared_chunks": ["chunk-99a56f6420082bd50a298fa61b1d5e9c"],
                    }
                ],
                "missing_entities": [],
            },
            "warnings": [
                "cascade_safe deletes graph/vector/chunk mappings, but shared source chunks remain unless orphaned."
            ],
            "missing": [],
        },
    },
    "chunk-preview": {
        "summary": "청크 삭제 영향도",
        "value": {
            "status": "success",
            "workspace": "feature-local",
            "target_type": "chunk",
            "policy": "force_delete_chunks",
            "executable": True,
            "summary": {
                "chunks_to_delete": 1,
                "documents_affected": 1,
                "entities_to_delete": 5,
                "entities_to_update": 0,
                "relations_to_delete": 4,
                "relations_to_update": 0,
            },
            "impact": {
                "chunks": [
                    {
                        "chunk_id": "chunk-99a56f6420082bd50a298fa61b1d5e9c",
                        "doc_id": "doc-99a56f6420082bd50a298fa61b1d5e9c",
                        "file_path": "quick-rag-definition-local-20260517-001",
                        "content_length": 420,
                    }
                ],
                "missing_chunks": [],
                "documents": [
                    {
                        "doc_id": "doc-99a56f6420082bd50a298fa61b1d5e9c",
                        "file_path": "quick-rag-definition-local-20260517-001",
                        "matched_chunks": ["chunk-99a56f6420082bd50a298fa61b1d5e9c"],
                    }
                ],
                "entities_to_delete": ["RAG"],
                "entities_to_update": [],
                "relations_to_delete": [
                    {
                        "source_id": "RAG",
                        "target_id": "검색",
                        "removed_chunks": ["chunk-99a56f6420082bd50a298fa61b1d5e9c"],
                        "remaining_chunks": [],
                    }
                ],
                "relations_to_update": [],
            },
            "warnings": [
                "force_delete_chunks removes chunk text/vector data and updates graph references; original full document text is not rewritten."
            ],
            "missing": [],
        },
    },
}


EXECUTE_RESPONSE_EXAMPLES = {
    "relation-execute": {
        "summary": "관계 삭제 실행 결과",
        "value": {
            "status": "success",
            "workspace": "feature-local",
            "target_type": "relation",
            "policy": "cascade_safe",
            "preview": {
                "status": "success",
                "workspace": "feature-local",
                "target_type": "relation",
                "policy": "cascade_safe",
                "executable": True,
                "summary": {
                    "relations_to_delete": 1,
                    "orphan_chunks_to_delete": 0,
                    "graph_only": False,
                },
                "impact": {
                    "relations": [
                        {
                            "source_id": "RAG",
                            "target_id": "검색",
                            "relation_chunks": ["chunk-99a56f6420082bd50a298fa61b1d5e9c"],
                            "orphan_chunks": [],
                            "shared_chunks": ["chunk-99a56f6420082bd50a298fa61b1d5e9c"],
                        }
                    ],
                    "missing_relations": [],
                },
                "warnings": [
                    "cascade_safe deletes graph/vector/chunk mappings, but shared source chunks remain unless orphaned."
                ],
                "missing": [],
            },
            "results": [
                {
                    "target": "RAG<SEP>검색",
                    "status": "success",
                    "message": "Relation Delete: `RAG`~`검색` deleted successfully, 0 orphaned chunks removed",
                }
            ],
            "warnings": [
                "cascade_safe deletes graph/vector/chunk mappings, but shared source chunks remain unless orphaned."
            ],
        },
    },
    "chunk-not-found": {
        "summary": "존재하지 않는 청크 실행 결과",
        "value": {
            "status": "success",
            "workspace": "feature-local",
            "target_type": "chunk",
            "policy": "force_delete_chunks",
            "preview": {
                "status": "success",
                "workspace": "feature-local",
                "target_type": "chunk",
                "policy": "force_delete_chunks",
                "executable": True,
                "summary": {
                    "chunks_to_delete": 0,
                    "documents_affected": 0,
                    "entities_to_delete": 0,
                    "entities_to_update": 0,
                    "relations_to_delete": 0,
                    "relations_to_update": 0,
                },
                "impact": {
                    "chunks": [],
                    "missing_chunks": ["chunk-not-found"],
                    "documents": [],
                    "entities_to_delete": [],
                    "entities_to_update": [],
                    "relations_to_delete": [],
                    "relations_to_update": [],
                },
                "warnings": [
                    "force_delete_chunks removes chunk text/vector data and updates graph references; original full document text is not rewritten."
                ],
                "missing": ["chunk-not-found"],
            },
            "results": [
                {
                    "target": "chunks",
                    "status": "not_found",
                    "deleted_chunks": 0,
                    "missing_chunks": ["chunk-not-found"],
                }
            ],
            "warnings": [
                "force_delete_chunks removes chunk text/vector data and updates graph references; original full document text is not rewritten."
            ],
        },
    },
}


def create_deletion_routes(rag, api_key: Optional[str] = None, doc_manager=None):
    combined_auth = get_combined_auth_dependency(api_key)

    @router.post(
        "/preview",
        response_model=DeletionPreviewResponse,
        dependencies=[Depends(combined_auth)],
        summary="Preview deletion impact",
        description=PREVIEW_DESCRIPTION,
        responses={
            200: {
                "description": "Deletion impact preview. No data is modified.",
                "content": {
                    "application/json": {
                        "examples": PREVIEW_RESPONSE_EXAMPLES,
                    }
                },
            },
            400: {
                "description": "Invalid target list or unsupported request shape.",
                "content": {
                    "application/json": {
                        "example": {"detail": "No deletion targets provided"}
                    }
                },
            },
        },
    )
    async def preview_deletion(
        http_request: Request,
        request: DeletionRequest = Body(
            ...,
            description="Deletion target and policy to analyze without mutating data.",
            openapi_examples=DELETION_REQUEST_EXAMPLES,
        ),
    ):
        try:
            workspace, workspace_rag = await _workspace_rag_or_default(http_request, rag)
            return await _build_preview(workspace_rag, workspace, request)
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error previewing deletion: %s", e)
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @router.post(
        "/execute",
        response_model=DeletionExecuteResponse,
        dependencies=[Depends(combined_auth)],
        summary="Execute deletion",
        description=EXECUTE_DESCRIPTION,
        responses={
            200: {
                "description": "Deletion execution result with the preview calculated before execution.",
                "content": {
                    "application/json": {
                        "examples": EXECUTE_RESPONSE_EXAMPLES,
                    }
                },
            },
            400: {
                "description": "The request is not executable, or the policy does not match the target type.",
                "content": {
                    "application/json": {
                        "example": {
                            "detail": "Deletion request is not executable. Call /deletions/preview for details."
                        }
                    }
                },
            },
        },
    )
    async def execute_deletion(
        http_request: Request,
        background_tasks: BackgroundTasks,
        request: DeletionRequest = Body(
            ...,
            description="Deletion target and policy to execute after the operator has reviewed preview impact.",
            openapi_examples=DELETION_REQUEST_EXAMPLES,
        ),
    ):
        try:
            workspace, workspace_rag = await _workspace_rag_or_default(http_request, rag)
            preview = await _build_preview(workspace_rag, workspace, request)
            if not preview.executable:
                raise HTTPException(status_code=400, detail="Deletion request is not executable. Call /deletions/preview for details.")

            job_id: str | None = None
            if request.target_type != "document":
                job_id = await _create_deletion_snapshot(workspace_rag, workspace, request, preview)

            results: list[dict[str, Any]] = []
            if request.target_type == "entity":
                if request.policy == "cascade_full":
                    results.append(
                        await _execute_force_delete_chunks(
                            workspace_rag,
                            preview.impact.get("full_delete_chunk_ids", []),
                            preview.impact.get("chunk_impact", {}),
                            request,
                        )
                    )
                    for entity_id in request.ids:
                        if await workspace_rag.chunk_entity_relation_graph.has_node(entity_id):
                            result = await adelete_by_entity(
                                chunk_entity_relation_graph=workspace_rag.chunk_entity_relation_graph,
                                entities_vdb=workspace_rag.entities_vdb,
                                relationships_vdb=workspace_rag.relationships_vdb,
                                entity_name=entity_id,
                                entity_chunks_storage=workspace_rag.entity_chunks,
                                relation_chunks_storage=workspace_rag.relation_chunks,
                                text_chunks_storage=workspace_rag.text_chunks,
                                chunks_vdb=workspace_rag.chunks_vdb,
                                llm_response_cache=workspace_rag.llm_response_cache,
                            )
                            results.append({"target": entity_id, "status": result.status, "message": result.message})
                else:
                    for entity_id in request.ids:
                        if request.policy == "graph_only":
                            if await workspace_rag.chunk_entity_relation_graph.has_node(entity_id):
                                await workspace_rag.chunk_entity_relation_graph.delete_node(entity_id)
                                results.append({"target": entity_id, "status": "success", "message": "Entity deleted from graph only"})
                            else:
                                results.append({"target": entity_id, "status": "not_found"})
                        else:
                            result = await adelete_by_entity(
                                chunk_entity_relation_graph=workspace_rag.chunk_entity_relation_graph,
                                entities_vdb=workspace_rag.entities_vdb,
                                relationships_vdb=workspace_rag.relationships_vdb,
                                entity_name=entity_id,
                                entity_chunks_storage=workspace_rag.entity_chunks,
                                relation_chunks_storage=workspace_rag.relation_chunks,
                                text_chunks_storage=workspace_rag.text_chunks,
                                chunks_vdb=workspace_rag.chunks_vdb,
                                llm_response_cache=workspace_rag.llm_response_cache,
                            )
                            results.append({"target": entity_id, "status": result.status, "message": result.message})
            elif request.target_type == "relation":
                if request.policy == "cascade_full":
                    results.append(
                        await _execute_force_delete_chunks(
                            workspace_rag,
                            preview.impact.get("full_delete_chunk_ids", []),
                            preview.impact.get("chunk_impact", {}),
                            request,
                        )
                    )
                    for relation in request.relations:
                        if await workspace_rag.chunk_entity_relation_graph.has_edge(relation.source_id, relation.target_id):
                            result = await adelete_by_relation(
                                chunk_entity_relation_graph=workspace_rag.chunk_entity_relation_graph,
                                relationships_vdb=workspace_rag.relationships_vdb,
                                source_entity=relation.source_id,
                                target_entity=relation.target_id,
                                relation_chunks_storage=workspace_rag.relation_chunks,
                                entity_chunks_storage=workspace_rag.entity_chunks,
                                text_chunks_storage=workspace_rag.text_chunks,
                                chunks_vdb=workspace_rag.chunks_vdb,
                                llm_response_cache=workspace_rag.llm_response_cache,
                            )
                            results.append({"target": f"{relation.source_id}{GRAPH_FIELD_SEP}{relation.target_id}", "status": result.status, "message": result.message})
                else:
                    for relation in request.relations:
                        if request.policy == "graph_only":
                            if await workspace_rag.chunk_entity_relation_graph.has_edge(relation.source_id, relation.target_id):
                                await workspace_rag.chunk_entity_relation_graph.remove_edges([(relation.source_id, relation.target_id)])
                                results.append({"target": f"{relation.source_id}{GRAPH_FIELD_SEP}{relation.target_id}", "status": "success", "message": "Relation deleted from graph only"})
                            else:
                                results.append({"target": f"{relation.source_id}{GRAPH_FIELD_SEP}{relation.target_id}", "status": "not_found"})
                        else:
                            result = await adelete_by_relation(
                                chunk_entity_relation_graph=workspace_rag.chunk_entity_relation_graph,
                                relationships_vdb=workspace_rag.relationships_vdb,
                                source_entity=relation.source_id,
                                target_entity=relation.target_id,
                                relation_chunks_storage=workspace_rag.relation_chunks,
                                entity_chunks_storage=workspace_rag.entity_chunks,
                                text_chunks_storage=workspace_rag.text_chunks,
                                chunks_vdb=workspace_rag.chunks_vdb,
                                llm_response_cache=workspace_rag.llm_response_cache,
                            )
                            results.append({"target": f"{relation.source_id}{GRAPH_FIELD_SEP}{relation.target_id}", "status": result.status, "message": result.message})
            elif request.target_type == "document":
                if doc_manager is None:
                    raise HTTPException(
                        status_code=500,
                        detail="Document deletion manager is not configured",
                    )

                existing_doc_ids = [
                    str(doc.get("doc_id"))
                    for doc in preview.impact.get("documents", [])
                    if doc.get("doc_id")
                ]
                for missing_doc_id in preview.missing:
                    results.append(
                        {
                            "target": missing_doc_id,
                            "status": "not_found",
                            "message": "Document not found",
                        }
                    )
                if not existing_doc_ids:
                    return DeletionExecuteResponse(
                        status="success",
                        workspace=workspace,
                        target_type=request.target_type,
                        policy=request.policy,
                        job_id=None,
                        preview=preview,
                        results=results,
                        warnings=preview.warnings,
                    )

                from lightrag.kg.shared_storage import (
                    get_namespace_data,
                    get_namespace_lock,
                )
                from lightrag.api.routers.document_routes import background_delete_documents

                pipeline_status = await get_namespace_data(
                    "pipeline_status",
                    workspace=workspace_rag.workspace,
                )
                pipeline_status_lock = get_namespace_lock(
                    "pipeline_status",
                    workspace=workspace_rag.workspace,
                )
                async with pipeline_status_lock:
                    if pipeline_status.get("busy", False):
                        results.append(
                            {
                                "target": ",".join(request.ids),
                                "status": "busy",
                                "message": "Cannot delete documents while pipeline is busy",
                            }
                        )
                    else:
                        job_id = await _create_deletion_snapshot(workspace_rag, workspace, request, preview)
                        background_tasks.add_task(
                            background_delete_documents,
                            workspace_rag,
                            doc_manager,
                            existing_doc_ids,
                            request.delete_file,
                            request.delete_llm_cache,
                            request.delete_s3_file,
                        )
                        results.append(
                            {
                                "target": ",".join(existing_doc_ids),
                                "status": "deletion_started",
                                "message": f"Document deletion for {len(existing_doc_ids)} documents has been initiated. Processing will continue in background.",
                                "delete_file": request.delete_file,
                                "delete_s3_file": request.delete_s3_file,
                                "delete_llm_cache": request.delete_llm_cache,
                            }
                        )
            elif request.target_type == "chunk":
                results.append(
                    await _execute_force_delete_chunks(
                        workspace_rag,
                        request.ids,
                        preview.impact,
                        request,
                    )
                )

            if request.target_type == "entity" and request.policy != "graph_only":
                tracking_result = await _sync_document_tracking_after_mutation(
                    workspace_rag,
                    _collect_entity_full_chunk_ids(preview.impact),
                )
                results.append(
                    {
                        "target": "document_tracking",
                        "status": "success",
                        **tracking_result,
                    }
                )
            elif request.target_type == "relation" and request.policy != "graph_only":
                tracking_result = await _sync_document_tracking_after_mutation(
                    workspace_rag,
                    _collect_relation_full_chunk_ids(preview.impact),
                )
                results.append(
                    {
                        "target": "document_tracking",
                        "status": "success",
                        **tracking_result,
                    }
                )

            if request.target_type in ("entity", "relation") and request.policy == "graph_only":
                await workspace_rag._insert_done()
                if request.invalidate_cache and workspace_rag.llm_response_cache:
                    await workspace_rag.llm_response_cache.drop()
                    await workspace_rag.llm_response_cache.index_done_callback()

            return DeletionExecuteResponse(
                status="success",
                workspace=workspace,
                target_type=request.target_type,
                policy=request.policy,
                job_id=job_id,
                preview=preview,
                results=results,
                warnings=preview.warnings,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error executing deletion: %s", e)
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @router.get(
        "/jobs",
        response_model=DeletionJobListResponse,
        dependencies=[Depends(combined_auth)],
        summary="List deletion restore jobs",
        description=(
            "Lists recent deletion snapshots for the current workspace. Each job is created "
            "by /deletions/execute before data is deleted and can be used for restore preview."
        ),
    )
    async def list_deletion_jobs(
        http_request: Request,
        limit: int = Query(20, ge=1, le=100),
        offset: int = Query(0, ge=0),
    ):
        try:
            workspace, workspace_rag = await _workspace_rag_or_default(http_request, rag)
            db = _snapshot_db(workspace_rag)
            if db is None:
                raise HTTPException(status_code=400, detail="Deletion snapshot storage is not available")

            await _ensure_snapshot_table(db)
            total_row = await db.query(
                """
                SELECT COUNT(*) AS count
                FROM LIGHTRAG_DELETION_SNAPSHOTS
                WHERE workspace = $1
                """,
                [workspace],
            )
            rows = await db.query(
                """
                SELECT workspace, job_id, target_type, policy, request_json, preview_json,
                       snapshot_json, restored_at::text AS restored_at, create_time::text AS created_at
                FROM LIGHTRAG_DELETION_SNAPSHOTS
                WHERE workspace = $1
                ORDER BY create_time DESC
                LIMIT $2 OFFSET $3
                """,
                [workspace, limit, offset],
                multirows=True,
            )
            return DeletionJobListResponse(
                jobs=[_job_summary_from_row(row) for row in rows or []],
                total_count=int((total_row or {}).get("count", 0)),
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error listing deletion jobs: %s", e)
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @router.get(
        "/jobs/{job_id}",
        response_model=DeletionJobDetail,
        dependencies=[Depends(combined_auth)],
        summary="Get deletion restore job",
        description="Returns the saved request, preview, and snapshot counts for one deletion job.",
    )
    async def get_deletion_job(http_request: Request, job_id: str):
        try:
            workspace, workspace_rag = await _workspace_rag_or_default(http_request, rag)
            db = _snapshot_db(workspace_rag)
            if db is None:
                raise HTTPException(status_code=400, detail="Deletion snapshot storage is not available")

            row = await _get_deletion_job(db, workspace, job_id)
            if row is None:
                raise HTTPException(status_code=404, detail="Deletion job not found")
            summary = _job_summary_from_row(row)
            return DeletionJobDetail(
                **summary.model_dump(),
                request=row.get("request_json") or {},
                preview=row.get("preview_json") or {},
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error fetching deletion job: %s", e)
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @router.post(
        "/jobs/{job_id}/restore/preview",
        response_model=RestorePreviewResponse,
        dependencies=[Depends(combined_auth)],
        summary="Preview deletion restore",
        description=(
            "Checks what a deletion job can restore and reports conflicts. "
            "Call this before /restore/execute so the operator can confirm the recovery scope."
        ),
    )
    async def preview_restore_deletion_job(
        http_request: Request,
        job_id: str,
        request: RestoreRequest | None = Body(default=None),
    ):
        try:
            workspace, workspace_rag = await _workspace_rag_or_default(http_request, rag)
            db = _snapshot_db(workspace_rag)
            if db is None:
                raise HTTPException(status_code=400, detail="Deletion snapshot storage is not available")

            row = await _get_deletion_job(db, workspace, job_id)
            if row is None:
                raise HTTPException(status_code=404, detail="Deletion job not found")
            return await _build_restore_preview(workspace_rag, row, request or RestoreRequest())
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error previewing deletion restore: %s", e)
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @router.post(
        "/jobs/{job_id}/restore/execute",
        response_model=RestoreExecuteResponse,
        dependencies=[Depends(combined_auth)],
        summary="Execute deletion restore",
        description=(
            "Restores rows and graph items saved in a deletion snapshot. "
            "Use overwrite=false for a conservative restore that skips existing rows, or "
            "overwrite=true when the operator intentionally wants snapshot values to replace current rows."
        ),
    )
    async def execute_restore_deletion_job(
        http_request: Request,
        job_id: str,
        request: RestoreRequest | None = Body(default=None),
    ):
        try:
            restore_request = request or RestoreRequest()
            workspace, workspace_rag = await _workspace_rag_or_default(http_request, rag)
            db = _snapshot_db(workspace_rag)
            if db is None:
                raise HTTPException(status_code=400, detail="Deletion snapshot storage is not available")

            row = await _get_deletion_job(db, workspace, job_id)
            if row is None:
                raise HTTPException(status_code=404, detail="Deletion job not found")
            preview = await _build_restore_preview(workspace_rag, row, restore_request)
            if not preview.executable:
                raise HTTPException(status_code=400, detail="Deletion job is not restorable")

            restored = await _restore_snapshot(
                workspace_rag,
                row.get("snapshot_json") or {},
                restore_request.overwrite,
            )
            if restore_request.invalidate_cache and workspace_rag.llm_response_cache:
                await workspace_rag.llm_response_cache.drop()
                await workspace_rag.llm_response_cache.index_done_callback()

            await db.execute(
                """
                UPDATE LIGHTRAG_DELETION_SNAPSHOTS
                SET restored_at = CURRENT_TIMESTAMP,
                    update_time = CURRENT_TIMESTAMP
                WHERE workspace = $1 AND job_id = $2
                """,
                {"workspace": workspace, "job_id": job_id},
            )
            return RestoreExecuteResponse(
                status="success",
                workspace=workspace,
                job_id=job_id,
                preview=preview,
                restored=restored,
                warnings=preview.warnings,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error executing deletion restore: %s", e)
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    return router
