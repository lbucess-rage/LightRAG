from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from ..db import db
from ..dependencies import audit_log, get_current_user, require_admin
from ..help_seed import HELP_ROLES
from ..roles import validate_role

router = APIRouter(prefix="/api/help", tags=["help"])


class HelpVisibilityUpdate(BaseModel):
    user: bool | None = None
    manager: bool | None = None
    admin: bool | None = None


class HelpTopicUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1)
    summary: str | None = None
    body_md: str | None = None
    status: str | None = None
    sort_order: int | None = None
    visibility: HelpVisibilityUpdate | None = None


def _json_value(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return value


def _normalize_topic(row: dict[str, Any]) -> dict[str, Any]:
    row["visibility"] = _json_value(row.get("visibility"), {})
    row["screenshots"] = _json_value(row.get("screenshots"), [])
    row["metadata"] = _json_value(row.get("metadata"), {})
    return row


async def _fetch_topics(*, role: str | None = None, include_all: bool = False) -> list[dict[str, Any]]:
    where = ""
    args: list[Any] = []
    if include_all:
        where = ""
    else:
        if not role:
            raise ValueError("role is required when include_all is false")
        args.append(role)
        where = """
        WHERE t.status = 'published'
          AND EXISTS (
            SELECT 1
            FROM KMS_ADMIN_HELP_TOPIC_VISIBILITY visible
            WHERE visible.help_id = t.help_id
              AND visible.role = $1
              AND visible.is_visible = TRUE
          )
        """
    rows = await db.fetch(
        f"""
        SELECT
            t.help_id, t.nav_key, t.menu_label, t.title, t.summary, t.body_md,
            t.status, t.sort_order, t.metadata, t.create_time, t.update_time,
            COALESCE((
                SELECT jsonb_object_agg(v.role, v.is_visible)
                FROM KMS_ADMIN_HELP_TOPIC_VISIBILITY v
                WHERE v.help_id = t.help_id
            ), '{{}}'::jsonb
            ) AS visibility,
            COALESCE((
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'screenshot_id', s.screenshot_id,
                        'file_path', s.file_path,
                        'caption', s.caption,
                        'sort_order', s.sort_order
                    )
                    ORDER BY s.sort_order ASC, s.screenshot_id ASC
                )
                FROM KMS_ADMIN_HELP_SCREENSHOTS s
                WHERE s.help_id = t.help_id
            ), '[]'::jsonb
            ) AS screenshots
        FROM KMS_ADMIN_HELP_TOPICS t
        {where}
        ORDER BY t.sort_order ASC, t.menu_label ASC, t.title ASC
        """,
        *args,
    )
    return [_normalize_topic(row) for row in rows]


@router.get("/topics")
async def list_help_topics(
    role: str | None = None,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    requested_role = current_user["role"]
    if current_user["role"] == "admin" and role:
        try:
            requested_role = validate_role(role)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid role") from exc
    topics = await _fetch_topics(role=requested_role)
    return {"role": requested_role, "topics": topics}


@router.get("/admin/topics")
async def list_help_topics_for_admin(_: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    topics = await _fetch_topics(include_all=True)
    return {"topics": topics}


@router.patch("/admin/topics/{help_id}")
async def update_help_topic(
    help_id: str,
    payload: HelpTopicUpdate,
    request: Request,
    admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    current = await db.fetchrow(
        "SELECT help_id, status, title, summary, body_md, sort_order FROM KMS_ADMIN_HELP_TOPICS WHERE help_id = $1",
        help_id,
    )
    if not current:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Help topic not found")
    values = payload.model_dump(exclude_unset=True)
    if "status" in values and values["status"] not in {"draft", "review", "published", "hidden"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid status")
    content_customized = any(key in values for key in ("title", "summary", "body_md"))
    await db.execute(
        """
        UPDATE KMS_ADMIN_HELP_TOPICS
        SET title = COALESCE($2, title),
            summary = COALESCE($3, summary),
            body_md = COALESCE($4, body_md),
            status = COALESCE($5, status),
            sort_order = COALESCE($6, sort_order),
            metadata = CASE
                WHEN $7 THEN jsonb_set(COALESCE(metadata, '{}'::jsonb), '{content_customized}', 'true'::jsonb, TRUE)
                ELSE metadata
            END,
            update_time = NOW()
        WHERE help_id = $1
        """,
        help_id,
        values.get("title"),
        values.get("summary"),
        values.get("body_md"),
        values.get("status"),
        values.get("sort_order"),
        content_customized,
    )
    visibility = values.get("visibility") or {}
    if isinstance(visibility, dict):
        for role in HELP_ROLES:
            if role not in visibility or visibility[role] is None:
                continue
            await db.execute(
                """
                INSERT INTO KMS_ADMIN_HELP_TOPIC_VISIBILITY(help_id, role, is_visible)
                VALUES($1, $2, $3)
                ON CONFLICT (help_id, role) DO UPDATE
                SET is_visible = EXCLUDED.is_visible,
                    update_time = NOW()
                """,
                help_id,
                role,
                bool(visibility[role]),
            )
    await audit_log(
        request,
        actor_type="user",
        actor_id=admin["user_id"],
        action="update_help_topic",
        tenant_id=admin.get("tenant_id"),
        target_type="help_topic",
        target_id=help_id,
        detail=values,
    )
    topics = await _fetch_topics(include_all=True)
    updated = next((topic for topic in topics if topic["help_id"] == help_id), None)
    return {"message": "updated", "topic": updated}
