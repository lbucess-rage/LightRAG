from __future__ import annotations

import csv
import io
import json

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..config import settings
from ..db import db
from ..dependencies import audit_log, require_admin
from ..roles import validate_role
from ..security import hash_password

router = APIRouter(prefix="/api/users", tags=["users"])


class UserCreateRequest(BaseModel):
    user_id: str = Field(min_length=1)
    password: str = Field(min_length=8)
    role: str = "user"
    display_name: str | None = None
    tenant_id: str | None = settings.default_tenant_id
    kms_workspace: str | None = None
    faq_workspace: str | None = None
    is_active: bool = True


class UserUpdateRequest(BaseModel):
    role: str | None = None
    display_name: str | None = None
    tenant_id: str | None = None
    kms_workspace: str | None = None
    faq_workspace: str | None = None
    is_active: bool | None = None


class PasswordUpdateRequest(BaseModel):
    password: str = Field(min_length=8)


async def _resolve_tenant(
    tenant_id: str | None,
    kms_workspace: str | None = None,
    faq_workspace: str | None = None,
) -> dict:
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
async def list_users(_: dict = Depends(require_admin)) -> dict:
    rows = await db.fetch(
        """
        SELECT u.user_id, u.role, u.display_name, u.is_active, u.last_login_at,
               t.tenant_id, t.name AS tenant_name, t.kms_workspace, t.faq_workspace,
               u.create_time, u.update_time
        FROM KMS_ADMIN_USERS u
        LEFT JOIN KMS_ADMIN_USER_TENANTS ut ON ut.user_id = u.user_id
        LEFT JOIN KMS_ADMIN_TENANTS t ON t.tenant_id = ut.tenant_id
        ORDER BY u.create_time DESC
        """
    )
    return {"users": rows}


@router.post("")
async def create_user(
    payload: UserCreateRequest,
    request: Request,
    admin: dict = Depends(require_admin),
) -> dict:
    try:
        role = validate_role(payload.role)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid role") from exc
    tenant = await _resolve_tenant(payload.tenant_id, payload.kms_workspace, payload.faq_workspace)
    await db.execute(
        """
        INSERT INTO KMS_ADMIN_USERS(user_id, password_hash, role, display_name, is_active)
        VALUES($1, $2, $3, $4, $5)
        """,
        payload.user_id,
        hash_password(payload.password),
        role,
        payload.display_name,
        payload.is_active,
    )
    await db.execute(
        """
        INSERT INTO KMS_ADMIN_USER_TENANTS(user_id, tenant_id)
        VALUES($1, $2)
        """,
        payload.user_id,
        tenant["tenant_id"],
    )
    await db.execute(
        """
        INSERT INTO KMS_ADMIN_USER_WORKSPACES(user_id, kms_workspace, faq_workspace)
        VALUES($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE
        SET kms_workspace = EXCLUDED.kms_workspace,
            faq_workspace = EXCLUDED.faq_workspace,
            update_time = NOW()
        """,
        payload.user_id,
        tenant["kms_workspace"],
        tenant["faq_workspace"],
    )
    await audit_log(
        request,
        actor_type="user",
        actor_id=admin["user_id"],
        action="create_user",
        tenant_id=tenant["tenant_id"],
        target_type="user",
        target_id=payload.user_id,
    )
    return {"message": "created", "user_id": payload.user_id}


@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    payload: UserUpdateRequest,
    request: Request,
    admin: dict = Depends(require_admin),
) -> dict:
    current = await db.fetchrow("SELECT user_id FROM KMS_ADMIN_USERS WHERE user_id = $1", user_id)
    if not current:
        return {"message": "not found"}
    values = payload.model_dump(exclude_unset=True)
    if "role" in values:
        try:
            values["role"] = validate_role(values["role"])
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid role") from exc
    if any(key in values for key in ("role", "display_name", "is_active")):
        await db.execute(
            """
            UPDATE KMS_ADMIN_USERS
            SET role = COALESCE($2, role),
                display_name = COALESCE($3, display_name),
                is_active = COALESCE($4, is_active),
                update_time = NOW()
            WHERE user_id = $1
            """,
            user_id,
            values.get("role"),
            values.get("display_name"),
            values.get("is_active"),
        )
    if values.get("tenant_id") or values.get("kms_workspace") or values.get("faq_workspace"):
        tenant = await _resolve_tenant(
            values.get("tenant_id"),
            values.get("kms_workspace"),
            values.get("faq_workspace"),
        )
        await db.execute(
            """
            INSERT INTO KMS_ADMIN_USER_TENANTS(user_id, tenant_id)
            VALUES($1, $2)
            ON CONFLICT (user_id) DO UPDATE
            SET tenant_id = EXCLUDED.tenant_id,
                update_time = NOW()
            """,
            user_id,
            tenant["tenant_id"],
        )
        await db.execute(
            """
            INSERT INTO KMS_ADMIN_USER_WORKSPACES(user_id, kms_workspace, faq_workspace)
            VALUES($1, $2, $3)
            ON CONFLICT (user_id) DO UPDATE
            SET kms_workspace = EXCLUDED.kms_workspace,
                faq_workspace = EXCLUDED.faq_workspace,
                update_time = NOW()
            """,
            user_id,
            tenant["kms_workspace"],
            tenant["faq_workspace"],
        )
        values["tenant_id"] = tenant["tenant_id"]
        values["kms_workspace"] = tenant["kms_workspace"]
        values["faq_workspace"] = tenant["faq_workspace"]
    await audit_log(
        request,
        actor_type="user",
        actor_id=admin["user_id"],
        action="update_user",
        target_type="user",
        target_id=user_id,
        detail=values,
    )
    return {"message": "updated", "user_id": user_id}


@router.post("/{user_id}/password")
async def update_password(
    user_id: str,
    payload: PasswordUpdateRequest,
    request: Request,
    admin: dict = Depends(require_admin),
) -> dict:
    await db.execute(
        "UPDATE KMS_ADMIN_USERS SET password_hash = $2, update_time = NOW() WHERE user_id = $1",
        user_id,
        hash_password(payload.password),
    )
    await audit_log(
        request,
        actor_type="user",
        actor_id=admin["user_id"],
        action="update_password",
        target_type="user",
        target_id=user_id,
    )
    return {"message": "updated", "user_id": user_id}


@router.get("/{user_id}/history")
async def user_history(user_id: str, _: dict = Depends(require_admin)) -> dict:
    rows = await db.fetch(
        """
        SELECT audit_id, actor_type, actor_id, action, target_type, target_id, detail, create_time
        FROM KMS_ADMIN_AUDIT_LOGS
        WHERE actor_id = $1 OR target_id = $1
        ORDER BY create_time DESC
        LIMIT 1000
        """,
        user_id,
    )
    return {"history": rows}


@router.get("/{user_id}/history.csv")
async def user_history_csv(
    user_id: str,
    request: Request,
    admin: dict = Depends(require_admin),
) -> StreamingResponse:
    rows = await user_history(user_id, admin)
    buffer = io.StringIO()
    writer = csv.DictWriter(
        buffer,
        fieldnames=["audit_id", "actor_type", "actor_id", "action", "target_type", "target_id", "detail", "create_time"],
    )
    writer.writeheader()
    for row in rows["history"]:
        row = dict(row)
        row["detail"] = json.dumps(row.get("detail") or {}, ensure_ascii=False)
        writer.writerow(row)
    buffer.seek(0)
    await audit_log(
        request,
        actor_type="user",
        actor_id=admin["user_id"],
        action="download_user_history",
        target_type="user",
        target_id=user_id,
        detail={"format": "csv"},
    )
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={user_id}-history.csv"},
    )
