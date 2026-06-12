from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from ..config import settings
from ..db import db
from ..dependencies import audit_log, get_current_user

router = APIRouter(prefix="/api/categories", tags=["categories"])


class CategoryRequest(BaseModel):
    name: str = Field(min_length=1)
    tenant_id: str | None = None
    parent_id: str | None = None
    sort_order: int = 0
    is_active: bool = True
    metadata: dict = Field(default_factory=dict)


def _effective_tenant_id(user: dict, requested: str | None = None) -> str:
    if user.get("role") == "admin" and requested:
        return requested
    return user.get("tenant_id") or settings.default_tenant_id


def _require_category_manager(user: dict) -> None:
    if user.get("role") not in {"admin", "manager"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Category write role required")


async def _category_path(name: str, parent_id: str | None, tenant_id: str) -> str:
    if not parent_id:
        return f"/{name}"
    parent = await db.fetchrow(
        "SELECT path FROM KMS_ADMIN_CATEGORIES WHERE category_id = $1 AND tenant_id = $2",
        parent_id,
        tenant_id,
    )
    if not parent:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Parent category not found")
    return f"{parent['path'] if parent else ''}/{name}"


async def _assert_valid_parent(category_id: str, parent_id: str | None, tenant_id: str) -> None:
    if not parent_id:
        return
    if category_id == parent_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Category cannot be its own parent")
    rows = await db.fetch(
        """
        WITH RECURSIVE descendants AS (
            SELECT category_id
            FROM KMS_ADMIN_CATEGORIES
            WHERE parent_id = $1
              AND tenant_id = $3
            UNION ALL
            SELECT child.category_id
            FROM KMS_ADMIN_CATEGORIES child
            JOIN descendants parent ON child.parent_id = parent.category_id
            WHERE child.tenant_id = $3
        )
        SELECT category_id
        FROM descendants
        WHERE category_id = $2
        """,
        category_id,
        parent_id,
        tenant_id,
    )
    if rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category cannot move under its descendant",
        )


async def _refresh_child_paths(parent_id: str, parent_path: str, tenant_id: str) -> None:
    children = await db.fetch(
        """
        SELECT category_id, name
        FROM KMS_ADMIN_CATEGORIES
        WHERE parent_id = $1
          AND tenant_id = $2
        ORDER BY sort_order ASC, name ASC
        """,
        parent_id,
        tenant_id,
    )
    for child in children:
        child_path = f"{parent_path}/{child['name']}"
        await db.execute(
            """
            UPDATE KMS_ADMIN_CATEGORIES
            SET path = $2, update_time = NOW()
            WHERE category_id = $1
            """,
            child["category_id"],
            child_path,
        )
        await _refresh_child_paths(child["category_id"], child_path, tenant_id)


@router.get("")
async def list_categories(
    tenant_id: str | None = Query(default=None),
    user: dict = Depends(get_current_user),
) -> dict:
    effective_tenant_id = _effective_tenant_id(user, tenant_id)
    rows = await db.fetch(
        """
        WITH RECURSIVE categories AS (
            SELECT category_id, tenant_id, parent_id, name, path, sort_order, is_active, metadata,
                   create_time, update_time
            FROM KMS_ADMIN_CATEGORIES
            WHERE tenant_id = $1
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
        total_counts AS (
            SELECT descendants.root_id AS category_id,
                   COUNT(i.item_id)::INT AS total_knowledge_count
            FROM descendants
            LEFT JOIN KMS_ADMIN_KNOWLEDGE_ITEMS i
              ON i.tenant_id = $1
             AND i.category_id = descendants.category_id
            GROUP BY descendants.root_id
        )
        SELECT categories.category_id, categories.tenant_id, categories.parent_id, categories.name,
               categories.path, categories.sort_order, categories.is_active, categories.metadata,
               categories.create_time, categories.update_time,
               COALESCE(direct_counts.direct_knowledge_count, 0)::INT AS direct_knowledge_count,
               COALESCE(total_counts.total_knowledge_count, 0)::INT AS total_knowledge_count
        FROM categories
        LEFT JOIN direct_counts ON direct_counts.category_id = categories.category_id
        LEFT JOIN total_counts ON total_counts.category_id = categories.category_id
        ORDER BY categories.path ASC, categories.sort_order ASC, categories.name ASC
        """,
        effective_tenant_id,
    )
    return {"categories": rows, "tenant_id": effective_tenant_id}


@router.post("")
async def create_category(
    payload: CategoryRequest,
    request: Request,
    user: dict = Depends(get_current_user),
) -> dict:
    _require_category_manager(user)
    tenant_id = _effective_tenant_id(user, payload.tenant_id)
    category_id = str(uuid.uuid4())
    path = await _category_path(payload.name, payload.parent_id, tenant_id)
    await db.execute(
        """
        INSERT INTO KMS_ADMIN_CATEGORIES(
            category_id, tenant_id, parent_id, name, path, sort_order, is_active, metadata
        )
        VALUES($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        """,
        category_id,
        tenant_id,
        payload.parent_id,
        payload.name,
        path,
        payload.sort_order,
        payload.is_active,
        json.dumps(payload.metadata),
    )
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="create_category",
        tenant_id=tenant_id,
        target_type="category",
        target_id=category_id,
    )
    return {"category_id": category_id, "tenant_id": tenant_id, "path": path}


@router.patch("/{category_id}")
async def update_category(
    category_id: str,
    payload: CategoryRequest,
    request: Request,
    user: dict = Depends(get_current_user),
) -> dict:
    _require_category_manager(user)
    tenant_id = _effective_tenant_id(user, payload.tenant_id)
    current = await db.fetchrow(
        "SELECT category_id FROM KMS_ADMIN_CATEGORIES WHERE category_id = $1 AND tenant_id = $2",
        category_id,
        tenant_id,
    )
    if not current:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    await _assert_valid_parent(category_id, payload.parent_id, tenant_id)
    path = await _category_path(payload.name, payload.parent_id, tenant_id)
    await db.execute(
        """
        UPDATE KMS_ADMIN_CATEGORIES
        SET parent_id = $2, name = $3, path = $4, sort_order = $5,
            is_active = $6, metadata = $7::jsonb, update_time = NOW()
        WHERE category_id = $1 AND tenant_id = $8
        """,
        category_id,
        payload.parent_id,
        payload.name,
        path,
        payload.sort_order,
        payload.is_active,
        json.dumps(payload.metadata),
        tenant_id,
    )
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="update_category",
        tenant_id=tenant_id,
        target_type="category",
        target_id=category_id,
    )
    await _refresh_child_paths(category_id, path, tenant_id)
    return {"message": "updated", "category_id": category_id, "tenant_id": tenant_id, "path": path}


@router.delete("/{category_id}")
async def deactivate_category(
    category_id: str,
    request: Request,
    tenant_id: str | None = Query(default=None),
    user: dict = Depends(get_current_user),
) -> dict:
    _require_category_manager(user)
    effective_tenant_id = _effective_tenant_id(user, tenant_id)
    await db.execute(
        """
        UPDATE KMS_ADMIN_CATEGORIES
        SET is_active = FALSE, update_time = NOW()
        WHERE category_id = $1 AND tenant_id = $2
        """,
        category_id,
        effective_tenant_id,
    )
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="deactivate_category",
        tenant_id=effective_tenant_id,
        target_type="category",
        target_id=category_id,
    )
    return {"message": "deactivated", "category_id": category_id}
