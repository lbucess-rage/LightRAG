from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..config import settings
from ..db import db
from ..dependencies import get_current_user, get_external_client
from ..search_service import WorkspaceScope, integrated_search, integrated_search_stream

router = APIRouter(tags=["search"])


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
    client_trace_id: str | None = None


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

    requested_kms_workspace = payload.kms_workspace if user.get("role") == "admin" else None
    requested_faq_workspace = payload.faq_workspace if user.get("role") == "admin" else None
    return WorkspaceScope(
        tenant_id=user.get("tenant_id") if not requested_kms_workspace and not requested_faq_workspace else None,
        kms_workspace=requested_kms_workspace or user.get("kms_workspace") or settings.default_kms_workspace,
        faq_workspace=requested_faq_workspace or user.get("faq_workspace") or settings.default_faq_workspace,
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
