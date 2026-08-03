from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from ..db import db
from ..dependencies import audit_log, get_current_user, require_admin
from ..lightrag_client import lightrag_client

router = APIRouter(prefix="/api/tenants", tags=["tenants"])


class TenantCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    kms_workspace: str = Field(min_length=1)
    faq_workspace: str = Field(min_length=1)
    is_active: bool = True
    metadata: dict = Field(default_factory=dict)
    copy_categories_from_tenant_id: str | None = None


class TenantProvisionRequest(BaseModel):
    """고객센터 원클릭 생성: 워크스페이스도 함께 생성.

    workspace 이름을 지정하지 않으면 name 기반으로 자동 부여.
    이미 있는 워크스페이스면 create를 건너뛰고 연결만 함(멱등).
    """
    name: str = Field(min_length=1)
    kms_workspace: str | None = None   # 미지정 시 자동 생성 규칙 적용
    faq_workspace: str | None = None
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
    tenants = [dict(row) for row in rows]
    # 워크스페이스 실존 여부 확인 (삭제된 워크스페이스를 가리키는 고객센터 감지)
    try:
        existing: set[str] = set()
        page = 1
        while page <= 10:
            data = await lightrag_client.request_json(
                "GET", "/workspaces", params={"page": page, "page_size": 100}
            )
            items = data.get("workspaces") or []
            existing.update(str(w.get("workspace_id")) for w in items)
            if len(items) < 100:
                break
            page += 1
        for tenant in tenants:
            tenant["kms_workspace_exists"] = tenant.get("kms_workspace") in existing
            tenant["faq_workspace_exists"] = tenant.get("faq_workspace") in existing
    except Exception:
        for tenant in tenants:
            tenant["kms_workspace_exists"] = None
            tenant["faq_workspace_exists"] = None
    return {"tenants": tenants}


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


async def _ensure_workspace(workspace_id: str, mode: str, name: str) -> str:
    """워크스페이스가 없으면 생성. 이미 있으면 그대로 사용(멱등). 생성했으면 workspace_id 반환, 아니면 None."""
    # 존재 확인
    try:
        await lightrag_client.request_json("GET", f"/workspaces/{workspace_id}")
        return None  # 이미 존재 → 생성 안 함
    except Exception:
        pass
    # 생성
    await lightrag_client.request_json(
        "POST", "/workspaces",
        json_body={"workspace_id": workspace_id, "workspace_mode": mode, "name": name},
    )
    return workspace_id


@router.post("/provision")
async def provision_tenant(
    payload: TenantProvisionRequest,
    request: Request,
    admin: dict = Depends(require_admin),
) -> dict:
    """고객센터 원클릭 생성: KMS/FAQ 워크스페이스 생성 + 테넌트 연결 (실패 시 롤백)."""
    # 워크스페이스 이름 결정 (미지정 시 자동)
    import re as _re
    base = _re.sub(r"[^a-zA-Z0-9_-]", "_", payload.name).strip("_").lower() or f"tenant_{uuid.uuid4().hex[:8]}"
    kms_ws = payload.kms_workspace or base
    faq_ws = payload.faq_workspace or f"{base}_faq"

    created_ws: list[str] = []
    try:
        w = await _ensure_workspace(kms_ws, "kms", f"{payload.name} 문서")
        if w:
            created_ws.append(w)
        w = await _ensure_workspace(faq_ws, "answer_catalog", f"{payload.name} FAQ")
        if w:
            created_ws.append(w)
    except Exception as exc:
        # 롤백: 이번에 만든 워크스페이스 삭제
        for ws in created_ws:
            try:
                await lightrag_client.request_json("DELETE", f"/workspaces/{ws}")
            except Exception:
                pass
        raise HTTPException(status_code=502, detail=f"Workspace 생성 실패, 롤백함: {exc}")

    # 테넌트 생성
    tenant_id = f"tenant_{uuid.uuid4().hex[:12]}"
    try:
        await db.execute(
            """
            INSERT INTO KMS_ADMIN_TENANTS(
                tenant_id, name, kms_workspace, faq_workspace, is_active, metadata
            )
            VALUES($1, $2, $3, $4, $5, $6::jsonb)
            """,
            tenant_id, payload.name, kms_ws, faq_ws, payload.is_active,
            json.dumps(payload.metadata),
        )
    except Exception as exc:
        for ws in created_ws:
            try:
                await lightrag_client.request_json("DELETE", f"/workspaces/{ws}")
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"테넌트 생성 실패, 롤백함: {exc}")

    copied = 0
    if payload.copy_categories_from_tenant_id:
        copied = await _copy_categories(payload.copy_categories_from_tenant_id, tenant_id)

    await audit_log(
        request, actor_type="user", actor_id=admin["user_id"],
        action="provision_tenant", tenant_id=tenant_id,
        target_type="tenant", target_id=tenant_id,
        detail={"name": payload.name, "kms_workspace": kms_ws, "faq_workspace": faq_ws,
                "created_workspaces": created_ws, "copied_categories": copied},
    )
    return {
        "tenant_id": tenant_id,
        "kms_workspace": kms_ws,
        "faq_workspace": faq_ws,
        "created_workspaces": created_ws,
        "copied_categories": copied,
    }


@router.delete("/{tenant_id}")
async def delete_tenant(
    tenant_id: str,
    request: Request,
    admin: dict = Depends(require_admin),
    delete_workspaces: bool = False,
) -> dict:
    """테넌트 삭제. delete_workspaces=true면 연결된 워크스페이스도 삭제."""
    tenant = await db.fetchrow(
        "SELECT tenant_id, name, kms_workspace, faq_workspace FROM KMS_ADMIN_TENANTS WHERE tenant_id = $1",
        tenant_id,
    )
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    deleted_ws: list[str] = []
    if delete_workspaces:
        for ws in (tenant["kms_workspace"], tenant["faq_workspace"]):
            if not ws:
                continue
            try:
                await lightrag_client.request_json("DELETE", f"/workspaces/{ws}")
                deleted_ws.append(ws)
            except Exception:
                pass

    # audit을 먼저 기록 (tenant 삭제 후 기록하면 FK 위반)
    await audit_log(
        request, actor_type="user", actor_id=admin["user_id"],
        action="delete_tenant", tenant_id=tenant_id,
        target_type="tenant", target_id=tenant_id,
        detail={"name": tenant["name"], "deleted_workspaces": deleted_ws},
    )
    # tenant를 RESTRICT로 참조하는 admin 데이터 선정리 (장부→refs CASCADE, jobs→events CASCADE)
    await db.execute("DELETE FROM KMS_ADMIN_KNOWLEDGE_ITEMS WHERE tenant_id = $1", tenant_id)
    await db.execute("DELETE FROM KMS_ADMIN_JOBS WHERE tenant_id = $1", tenant_id)
    await db.execute("DELETE FROM KMS_ADMIN_USER_TENANTS WHERE tenant_id = $1", tenant_id)
    await db.execute("DELETE FROM KMS_ADMIN_API_CLIENTS WHERE tenant_id = $1", tenant_id)
    await db.execute("DELETE FROM KMS_ADMIN_TENANTS WHERE tenant_id = $1", tenant_id)
    return {"message": "deleted", "tenant_id": tenant_id, "deleted_workspaces": deleted_ws}
