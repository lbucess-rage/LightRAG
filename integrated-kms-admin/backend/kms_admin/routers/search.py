from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..config import settings
from ..db import db
from ..dependencies import get_current_user, get_external_client
from ..search_service import WorkspaceScope, integrated_search, integrated_search_stream

router = APIRouter(tags=["search"])


EXTERNAL_CATEGORIES_SQL = """
WITH RECURSIVE categories AS (
    SELECT category_id, tenant_id, parent_id, name, path, sort_order, is_active, metadata,
           create_time, update_time
    FROM KMS_ADMIN_CATEGORIES
    WHERE tenant_id = $1
      AND ($2::boolean OR is_active = TRUE)
),
descendants AS (
    SELECT category_id AS root_id, category_id
    FROM categories
    UNION ALL
    SELECT descendants.root_id, child.category_id
    FROM descendants
    JOIN categories child ON child.parent_id = descendants.category_id
),
direct_counts AS (
    SELECT category_id, COUNT(*)::INT AS direct_knowledge_count
    FROM KMS_ADMIN_KNOWLEDGE_ITEMS
    WHERE tenant_id = $1
      AND category_id IS NOT NULL
    GROUP BY category_id
),
valid_direct_counts AS (
    SELECT category_id, COUNT(*)::INT AS valid_direct_knowledge_count
    FROM KMS_ADMIN_KNOWLEDGE_ITEMS
    WHERE tenant_id = $1
      AND category_id IS NOT NULL
      AND enabled = TRUE
      AND (valid_from IS NULL OR valid_from <= NOW())
      AND (valid_until IS NULL OR valid_until >= NOW())
    GROUP BY category_id
),
total_counts AS (
    SELECT descendants.root_id AS category_id,
           COUNT(i.item_id)::INT AS total_knowledge_count
    FROM descendants
    LEFT JOIN KMS_ADMIN_KNOWLEDGE_ITEMS i
      ON i.tenant_id = $1
     AND i.category_id = descendants.category_id
    GROUP BY descendants.root_id
),
valid_total_counts AS (
    SELECT descendants.root_id AS category_id,
           COUNT(i.item_id)::INT AS valid_total_knowledge_count
    FROM descendants
    LEFT JOIN KMS_ADMIN_KNOWLEDGE_ITEMS i
      ON i.tenant_id = $1
     AND i.category_id = descendants.category_id
     AND i.enabled = TRUE
     AND (i.valid_from IS NULL OR i.valid_from <= NOW())
     AND (i.valid_until IS NULL OR i.valid_until >= NOW())
    GROUP BY descendants.root_id
)
SELECT categories.category_id, categories.tenant_id, categories.parent_id, categories.name,
       categories.path, categories.sort_order, categories.is_active, categories.metadata,
       categories.create_time, categories.update_time,
       COALESCE(direct_counts.direct_knowledge_count, 0)::INT AS direct_knowledge_count,
       COALESCE(total_counts.total_knowledge_count, 0)::INT AS total_knowledge_count,
       COALESCE(valid_direct_counts.valid_direct_knowledge_count, 0)::INT AS valid_direct_knowledge_count,
       COALESCE(valid_total_counts.valid_total_knowledge_count, 0)::INT AS valid_total_knowledge_count
FROM categories
LEFT JOIN direct_counts ON direct_counts.category_id = categories.category_id
LEFT JOIN total_counts ON total_counts.category_id = categories.category_id
LEFT JOIN valid_direct_counts ON valid_direct_counts.category_id = categories.category_id
LEFT JOIN valid_total_counts ON valid_total_counts.category_id = categories.category_id
ORDER BY categories.path ASC, categories.sort_order ASC, categories.name ASC
"""


class IntegratedSearchRequest(BaseModel):
    query: str = Field(min_length=1)
    category_ids: list[str] = Field(default_factory=list)
    tenant_id: str | None = None
    include_generative: bool = True
    include_faq: bool = True
    kms_workspace: str | None = None
    faq_workspace: str | None = None
    kms_options: dict[str, Any] = Field(default_factory=dict)
    faq_options: dict[str, Any] = Field(default_factory=dict)
    display_options: dict[str, Any] = Field(default_factory=dict)
    client_trace_id: str | None = None


@router.get("/api/external/categories")
async def list_external_categories(
    include_inactive: bool = Query(default=False),
    client: dict = Depends(get_external_client),
) -> dict:
    rows = await db.fetch(EXTERNAL_CATEGORIES_SQL, client["tenant_id"], include_inactive)
    return {
        "tenant_id": client["tenant_id"],
        "tenant_name": client.get("tenant_name"),
        "kms_workspace": client["kms_workspace"],
        "faq_workspace": client["faq_workspace"],
        "categories": rows,
        "usage": {
            "search_request_field": "category_ids",
            "descendants_included": True,
            "validity_policy": (
                "Search candidates are filtered by enabled=true, valid_from<=server_now, "
                "and valid_until>=server_now. Clients do not pass validity dates in search requests."
            ),
            "validity_trace_field": "trace.eligibility",
        },
    }


async def _internal_scope(payload: IntegratedSearchRequest, user: dict) -> WorkspaceScope:
    if user.get("role") == "admin" and payload.tenant_id:
        tenant = await db.fetchrow(
            """
            SELECT tenant_id, kms_workspace, faq_workspace
            FROM KMS_ADMIN_TENANTS
            WHERE tenant_id = $1
              AND is_active = TRUE
            """,
            payload.tenant_id,
        )
        if tenant:
            return WorkspaceScope(
                tenant_id=tenant["tenant_id"],
                kms_workspace=tenant["kms_workspace"],
                faq_workspace=tenant["faq_workspace"],
            )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Active tenant workspace pair not found",
        )

    requested_kms_workspace = payload.kms_workspace if user.get("role") == "admin" else None
    requested_faq_workspace = payload.faq_workspace if user.get("role") == "admin" else None
    if requested_kms_workspace or requested_faq_workspace:
        tenant = await db.fetchrow(
            """
            SELECT tenant_id, kms_workspace, faq_workspace
            FROM KMS_ADMIN_TENANTS
            WHERE kms_workspace = $1
              AND faq_workspace = $2
              AND is_active = TRUE
            ORDER BY create_time ASC
            LIMIT 1
            """,
            requested_kms_workspace or user.get("kms_workspace"),
            requested_faq_workspace or user.get("faq_workspace"),
        )
        if not tenant:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Requested workspaces are not a registered active pair",
            )
        return WorkspaceScope(
            tenant_id=tenant["tenant_id"],
            kms_workspace=tenant["kms_workspace"],
            faq_workspace=tenant["faq_workspace"],
        )
    return WorkspaceScope(
        tenant_id=user.get("tenant_id"),
        kms_workspace=user.get("kms_workspace") or settings.default_kms_workspace,
        faq_workspace=user.get("faq_workspace") or settings.default_faq_workspace,
    )


@router.post("/api/search/integrated")
async def search_internal(payload: IntegratedSearchRequest, user: dict = Depends(get_current_user)) -> dict:
    scope = await _internal_scope(payload, user)
    return await integrated_search(
        actor_type="user",
        actor_id=user["user_id"],
        scope=scope,
        payload=payload.model_dump(),
    )


@router.post("/api/external/search")
async def search_external(
    payload: IntegratedSearchRequest,
    client: dict = Depends(get_external_client),
) -> dict:
    scope = WorkspaceScope(
        tenant_id=client["tenant_id"],
        kms_workspace=client["kms_workspace"],
        faq_workspace=client["faq_workspace"],
    )
    return await integrated_search(
        actor_type="api_client",
        actor_id=client["client_id"],
        scope=scope,
        payload=payload.model_dump(),
    )


@router.post("/api/external/search/stream")
async def search_external_stream(
    payload: IntegratedSearchRequest,
    client: dict = Depends(get_external_client),
) -> StreamingResponse:
    scope = WorkspaceScope(
        tenant_id=client["tenant_id"],
        kms_workspace=client["kms_workspace"],
        faq_workspace=client["faq_workspace"],
    )

    async def stream():
        async for event in integrated_search_stream(
            actor_type="api_client",
            actor_id=client["client_id"],
            scope=scope,
            payload=payload.model_dump(),
        ):
            yield f"{json.dumps(event, ensure_ascii=False)}\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")
