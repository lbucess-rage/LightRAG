from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from ..db import db
from ..dependencies import audit_log, get_current_user, require_admin

router = APIRouter(prefix="/api/tenants", tags=["tenants"])


class TenantCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    kms_workspace: str = Field(min_length=1)
    faq_workspace: str = Field(min_length=1)
    is_active: bool = True
    metadata: dict = Field(default_factory=dict)
    copy_categories_from_tenant_id: str | None = None


class TenantUpdateRequest(BaseModel):
    name: str | None = None
    kms_workspace: str | None = None
    faq_workspace: str | None = None
    is_active: bool | None = None
    metadata: dict | None = None


class CategoryCopyRequest(BaseModel):
    source_tenant_id: str = Field(min_length=1)


async def _copy_categories(source_tenant_id: str, target_tenant_id: str) -> int:
    if source_tenant_id == target_tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source and target tenant are same")
    existing = await db.fetchrow(
        "SELECT COUNT(*)::INT AS count FROM KMS_ADMIN_CATEGORIES WHERE tenant_id = $1",
        target_tenant_id,
    )
    if existing and existing["count"] > 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Target tenant already has categories")
    source_rows = await db.fetch(
        """
        SELECT category_id, parent_id, name, path, sort_order, is_active, metadata
        FROM KMS_ADMIN_CATEGORIES
        WHERE tenant_id = $1
        ORDER BY path ASC, sort_order ASC, name ASC
        """,
        source_tenant_id,
    )
    id_map: dict[str, str] = {}
    copied = 0
    for row in source_rows:
        new_id = str(uuid.uuid4())
        id_map[row["category_id"]] = new_id
        parent_id = id_map.get(row["parent_id"]) if row.get("parent_id") else None
        await db.execute(
            """
            INSERT INTO KMS_ADMIN_CATEGORIES(
                category_id, tenant_id, parent_id, name, path, sort_order, is_active, metadata
            )
            VALUES($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            """,
            new_id,
            target_tenant_id,
            parent_id,
            row["name"],
            row["path"],
            row["sort_order"],
            row["is_active"],
            json.dumps(row.get("metadata") or {}),
        )
        copied += 1
    return copied


@router.get("")
async def list_tenants(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") == "admin":
        rows = await db.fetch(
            """
            SELECT tenant_id, name, kms_workspace, faq_workspace, is_active, metadata,
                   create_time, update_time
            FROM KMS_ADMIN_TENANTS
            ORDER BY name ASC, tenant_id ASC
            """
        )
    else:
        rows = await db.fetch(
            """
            SELECT tenant_id, name, kms_workspace, faq_workspace, is_active, metadata,
                   create_time, update_time
            FROM KMS_ADMIN_TENANTS
            WHERE tenant_id = $1
            """,
            user.get("tenant_id"),
        )
    return {"tenants": rows}


@router.post("")
async def create_tenant(
    payload: TenantCreateRequest,
    request: Request,
    admin: dict = Depends(require_admin),
) -> dict:
    tenant_id = f"tenant_{uuid.uuid4().hex[:12]}"
    await db.execute(
        """
        INSERT INTO KMS_ADMIN_TENANTS(
            tenant_id, name, kms_workspace, faq_workspace, is_active, metadata
        )
        VALUES($1, $2, $3, $4, $5, $6::jsonb)
        """,
        tenant_id,
        payload.name,
        payload.kms_workspace,
        payload.faq_workspace,
        payload.is_active,
        json.dumps(payload.metadata),
    )
    copied = 0
    if payload.copy_categories_from_tenant_id:
        copied = await _copy_categories(payload.copy_categories_from_tenant_id, tenant_id)
    await audit_log(
        request,
        actor_type="user",
        actor_id=admin["user_id"],
        action="create_tenant",
        tenant_id=tenant_id,
        target_type="tenant",
        target_id=tenant_id,
        detail={"name": payload.name, "copied_categories": copied},
    )
    return {"tenant_id": tenant_id, "copied_categories": copied}


@router.patch("/{tenant_id}")
async def update_tenant(
    tenant_id: str,
    payload: TenantUpdateRequest,
    request: Request,
    admin: dict = Depends(require_admin),
) -> dict:
    values = payload.model_dump(exclude_unset=True)
    current = await db.fetchrow("SELECT tenant_id FROM KMS_ADMIN_TENANTS WHERE tenant_id = $1", tenant_id)
    if not current:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    await db.execute(
        """
        UPDATE KMS_ADMIN_TENANTS
        SET name = COALESCE($2, name),
            kms_workspace = COALESCE($3, kms_workspace),
            faq_workspace = COALESCE($4, faq_workspace),
            is_active = COALESCE($5, is_active),
            metadata = COALESCE($6::jsonb, metadata),
            update_time = NOW()
        WHERE tenant_id = $1
        """,
        tenant_id,
        values.get("name"),
        values.get("kms_workspace"),
        values.get("faq_workspace"),
        values.get("is_active"),
        json.dumps(values["metadata"]) if "metadata" in values else None,
    )
    if values.get("kms_workspace") or values.get("faq_workspace"):
        tenant = await db.fetchrow(
            """
            SELECT tenant_id, kms_workspace, faq_workspace
            FROM KMS_ADMIN_TENANTS
            WHERE tenant_id = $1
            """,
            tenant_id,
        )
        if tenant:
            await db.execute(
                """
                UPDATE KMS_ADMIN_API_CLIENTS
                SET kms_workspace = $2,
                    faq_workspace = $3,
                    update_time = NOW()
                WHERE tenant_id = $1
                """,
                tenant_id,
                tenant["kms_workspace"],
                tenant["faq_workspace"],
            )
            await db.execute(
                """
                UPDATE KMS_ADMIN_USER_WORKSPACES w
                SET kms_workspace = $2,
                    faq_workspace = $3,
                    update_time = NOW()
                FROM KMS_ADMIN_USER_TENANTS ut
                WHERE ut.user_id = w.user_id
                  AND ut.tenant_id = $1
                """,
                tenant_id,
                tenant["kms_workspace"],
                tenant["faq_workspace"],
            )
    await audit_log(
        request,
        actor_type="user",
        actor_id=admin["user_id"],
        action="update_tenant",
        tenant_id=tenant_id,
        target_type="tenant",
        target_id=tenant_id,
        detail=values,
    )
    return {"message": "updated", "tenant_id": tenant_id}


@router.post("/{tenant_id}/categories/copy")
async def copy_tenant_categories(
    tenant_id: str,
    payload: CategoryCopyRequest,
    request: Request,
    admin: dict = Depends(require_admin),
) -> dict:
    copied = await _copy_categories(payload.source_tenant_id, tenant_id)
    await audit_log(
        request,
        actor_type="user",
        actor_id=admin["user_id"],
        action="copy_tenant_categories",
        tenant_id=tenant_id,
        target_type="tenant",
        target_id=tenant_id,
        detail={"source_tenant_id": payload.source_tenant_id, "copied_categories": copied},
    )
    return {"tenant_id": tenant_id, "copied_categories": copied}
