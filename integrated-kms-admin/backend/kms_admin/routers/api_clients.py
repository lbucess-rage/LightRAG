from __future__ import annotations

import csv
import io
import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..config import settings
from ..db import db
from ..dependencies import audit_log, require_admin
from ..security import generate_api_key, hash_api_key, mask_api_key_hash

router = APIRouter(prefix="/api/external-clients", tags=["external-clients"])


def _json_array(value: object) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    return []


def _json_object(value: object) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _normalize_search_log(row: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(row)
    normalized["category_ids"] = _json_array(normalized.get("category_ids"))
    normalized["result_summary"] = _json_object(normalized.get("result_summary"))
    return normalized


class ApiClientCreateRequest(BaseModel):
    display_name: str = Field(min_length=1)
    tenant_id: str | None = settings.default_tenant_id
    kms_workspace: str | None = None
    faq_workspace: str | None = None
    is_active: bool = True
    scopes: list[str] = Field(default_factory=lambda: ["search"])
    rate_limit_per_minute: int = 120
    metadata: dict = Field(default_factory=dict)


class ApiClientUpdateRequest(BaseModel):
    display_name: str | None = None
    is_active: bool | None = None
    tenant_id: str | None = None
    kms_workspace: str | None = None
    faq_workspace: str | None = None
    scopes: list[str] | None = None
    rate_limit_per_minute: int | None = None
    metadata: dict | None = None


async def _resolve_tenant(
    tenant_id: str | None,
    kms_workspace: str | None = None,
    faq_workspace: str | None = None,
) -> dict[str, Any]:
    if tenant_id:
        tenant = await db.fetchrow(
            """
            SELECT tenant_id, name AS tenant_name, kms_workspace, faq_workspace
            FROM KMS_ADMIN_TENANTS
            WHERE tenant_id = $1
            """,
            tenant_id,
        )
    elif kms_workspace and faq_workspace:
        tenant = await db.fetchrow(
            """
            SELECT tenant_id, name AS tenant_name, kms_workspace, faq_workspace
            FROM KMS_ADMIN_TENANTS
            WHERE kms_workspace = $1
              AND faq_workspace = $2
            ORDER BY create_time ASC
            LIMIT 1
            """,
            kms_workspace,
            faq_workspace,
        )
    else:
        tenant = await db.fetchrow(
            """
            SELECT tenant_id, name AS tenant_name, kms_workspace, faq_workspace
            FROM KMS_ADMIN_TENANTS
            WHERE tenant_id = $1
            """,
            settings.default_tenant_id,
        )
    if not tenant:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Tenant not found")
    return tenant


@router.get("")
async def list_api_clients(_: dict = Depends(require_admin)) -> dict:
    rows = await db.fetch(
        """
        SELECT c.client_id, c.display_name, c.api_key_hash, c.is_active,
               c.tenant_id, t.name AS tenant_name,
               COALESCE(t.kms_workspace, c.kms_workspace) AS kms_workspace,
               COALESCE(t.faq_workspace, c.faq_workspace) AS faq_workspace,
               c.scopes, c.rate_limit_per_minute, c.metadata,
               c.last_used_at, c.create_time, c.update_time,
               COUNT(l.search_id)::INT AS call_count,
               MAX(l.create_time) AS last_search_at
        FROM KMS_ADMIN_API_CLIENTS c
        LEFT JOIN KMS_ADMIN_TENANTS t ON t.tenant_id = c.tenant_id
        LEFT JOIN KMS_ADMIN_SEARCH_LOGS l
          ON l.actor_type = 'api_client'
         AND l.actor_id = c.client_id
        GROUP BY c.client_id
        ORDER BY c.create_time DESC
        """
    )
    for row in rows:
        row["api_key_hint"] = mask_api_key_hash(row.pop("api_key_hash"))
        row["scopes"] = _json_array(row.get("scopes"))
    return {"clients": rows}


@router.get("/{client_id}/search-logs")
async def api_client_search_logs(client_id: str, _: dict = Depends(require_admin)) -> dict:
    rows = await db.fetch(
        """
        SELECT search_id, tenant_id, actor_type, actor_id, query, category_ids,
               include_generative, include_faq, kms_workspace, faq_workspace,
               generative_trace_id, faq_trace_id, result_summary, latency_ms,
               client_trace_id, create_time
        FROM KMS_ADMIN_SEARCH_LOGS
        WHERE actor_type = 'api_client'
          AND actor_id = $1
        ORDER BY create_time DESC
        LIMIT 500
        """,
        client_id,
    )
    return {"logs": [_normalize_search_log(row) for row in rows]}


@router.get("/{client_id}/search-logs.csv")
async def api_client_search_logs_csv(
    client_id: str,
    request: Request,
    admin: dict = Depends(require_admin),
) -> StreamingResponse:
    rows = await api_client_search_logs(client_id, admin)
    buffer = io.StringIO()
    writer = csv.DictWriter(
        buffer,
        fieldnames=[
            "search_id",
            "query",
            "kms_workspace",
            "faq_workspace",
            "include_generative",
            "include_faq",
            "latency_ms",
            "client_trace_id",
            "result_summary",
            "create_time",
        ],
    )
    writer.writeheader()
    for row in rows["logs"]:
        writer.writerow(
            {
                "search_id": row.get("search_id"),
                "query": row.get("query"),
                "kms_workspace": row.get("kms_workspace"),
                "faq_workspace": row.get("faq_workspace"),
                "include_generative": row.get("include_generative"),
                "include_faq": row.get("include_faq"),
                "latency_ms": row.get("latency_ms"),
                "client_trace_id": row.get("client_trace_id"),
                "result_summary": json.dumps(row.get("result_summary") or {}, ensure_ascii=False),
                "create_time": row.get("create_time"),
            }
        )
    buffer.seek(0)
    await audit_log(
        request,
        actor_type="user",
        actor_id=admin["user_id"],
        action="download_api_client_search_logs",
        target_type="api_client",
        target_id=client_id,
        detail={"format": "csv"},
    )
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={client_id}-search-logs.csv"},
    )


@router.post("")
async def create_api_client(
    payload: ApiClientCreateRequest,
    request: Request,
    admin: dict = Depends(require_admin),
) -> dict:
    client_id = str(uuid.uuid4())
    api_key = generate_api_key()
    tenant = await _resolve_tenant(payload.tenant_id, payload.kms_workspace, payload.faq_workspace)
    await db.execute(
        """
        INSERT INTO KMS_ADMIN_API_CLIENTS(
            client_id, display_name, api_key_hash, tenant_id, kms_workspace, faq_workspace,
            is_active, scopes, rate_limit_per_minute, metadata
        )
        VALUES($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb)
        """,
        client_id,
        payload.display_name,
        hash_api_key(api_key),
        tenant["tenant_id"],
        tenant["kms_workspace"],
        tenant["faq_workspace"],
        payload.is_active,
        json.dumps(payload.scopes),
        payload.rate_limit_per_minute,
        json.dumps(payload.metadata),
    )
    await audit_log(
        request,
        actor_type="user",
        actor_id=admin["user_id"],
        action="create_api_client",
        tenant_id=tenant["tenant_id"],
        target_type="api_client",
        target_id=client_id,
        detail={"display_name": payload.display_name, "tenant_id": tenant["tenant_id"]},
    )
    return {"client_id": client_id, "api_key": api_key}


@router.patch("/{client_id}")
async def update_api_client(
    client_id: str,
    payload: ApiClientUpdateRequest,
    request: Request,
    admin: dict = Depends(require_admin),
) -> dict:
    values = payload.model_dump(exclude_unset=True)
    current = await db.fetchrow(
        "SELECT * FROM KMS_ADMIN_API_CLIENTS WHERE client_id = $1",
        client_id,
    )
    if not current:
        return {"message": "not found", "client_id": client_id}
    tenant = None
    if values.get("tenant_id") or values.get("kms_workspace") or values.get("faq_workspace"):
        tenant = await _resolve_tenant(
            values.get("tenant_id"),
            values.get("kms_workspace"),
            values.get("faq_workspace"),
        )
    await db.execute(
        """
        UPDATE KMS_ADMIN_API_CLIENTS
        SET display_name = COALESCE($2, display_name),
            is_active = COALESCE($3, is_active),
            tenant_id = COALESCE($4, tenant_id),
            kms_workspace = COALESCE($5, kms_workspace),
            faq_workspace = COALESCE($6, faq_workspace),
            scopes = COALESCE($7::jsonb, scopes),
            rate_limit_per_minute = COALESCE($8, rate_limit_per_minute),
            metadata = COALESCE($9::jsonb, metadata),
            update_time = NOW()
        WHERE client_id = $1
        """,
        client_id,
        values.get("display_name"),
        values.get("is_active"),
        tenant["tenant_id"] if tenant else None,
        tenant["kms_workspace"] if tenant else None,
        tenant["faq_workspace"] if tenant else None,
        json.dumps(values["scopes"]) if "scopes" in values else None,
        values.get("rate_limit_per_minute"),
        json.dumps(values["metadata"]) if "metadata" in values else None,
    )
    if tenant:
        values["tenant_id"] = tenant["tenant_id"]
        values["kms_workspace"] = tenant["kms_workspace"]
        values["faq_workspace"] = tenant["faq_workspace"]
    await audit_log(
        request,
        actor_type="user",
        actor_id=admin["user_id"],
        action="update_api_client",
        tenant_id=values.get("tenant_id") or current.get("tenant_id"),
        target_type="api_client",
        target_id=client_id,
        detail=values,
    )
    return {"message": "updated", "client_id": client_id}


@router.post("/{client_id}/rotate-key")
async def rotate_api_client_key(
    client_id: str,
    request: Request,
    admin: dict = Depends(require_admin),
) -> dict:
    api_key = generate_api_key()
    await db.execute(
        """
        UPDATE KMS_ADMIN_API_CLIENTS
        SET api_key_hash = $2, update_time = NOW()
        WHERE client_id = $1
        """,
        client_id,
        hash_api_key(api_key),
    )
    await audit_log(
        request,
        actor_type="user",
        actor_id=admin["user_id"],
        action="rotate_api_client_key",
        target_type="api_client",
        target_id=client_id,
    )
    return {"client_id": client_id, "api_key": api_key}


@router.post("/{client_id}/revoke-key")
async def revoke_api_client_key(
    client_id: str,
    request: Request,
    admin: dict = Depends(require_admin),
) -> dict:
    replacement_key = generate_api_key()
    await db.execute(
        """
        UPDATE KMS_ADMIN_API_CLIENTS
        SET api_key_hash = $2, is_active = FALSE, update_time = NOW()
        WHERE client_id = $1
        """,
        client_id,
        hash_api_key(replacement_key),
    )
    await audit_log(
        request,
        actor_type="user",
        actor_id=admin["user_id"],
        action="revoke_api_client_key",
        target_type="api_client",
        target_id=client_id,
    )
    return {"client_id": client_id, "message": "revoked"}
