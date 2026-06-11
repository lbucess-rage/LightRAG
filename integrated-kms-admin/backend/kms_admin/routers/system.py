from __future__ import annotations

import csv
import io
import time

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse

from ..config import settings
from ..db import db
from ..dependencies import audit_log, get_current_user, require_admin
from ..lightrag_client import lightrag_client

router = APIRouter(prefix="/api/system", tags=["system"])


def _period_days(period: str) -> int:
    return {
        "24h": 1,
        "today": 1,
        "7d": 7,
        "30d": 30,
        "90d": 90,
    }.get(period, 7)


@router.get("/health")
async def health() -> dict:
    db_ok = False
    lightrag_status = None
    started = time.time()
    try:
        row = await db.fetchrow("SELECT 1 AS ok")
        db_ok = bool(row and row["ok"] == 1)
    except Exception as exc:
        lightrag_status = {"db_error": str(exc)}
    try:
        lightrag_status = await lightrag_client.request_json("GET", "/health")
    except Exception as exc:
        lightrag_status = {"error": str(exc)}
    return {
        "status": "ok" if db_ok else "degraded",
        "database": {"ok": db_ok, "url": settings.safe_database_url},
        "lightrag": lightrag_status,
        "latency_ms": int((time.time() - started) * 1000),
    }


@router.get("/stats")
async def stats(
    period: str = Query("7d"),
    tenant_id: str | None = Query(default=None),
    user: dict = Depends(get_current_user),
) -> dict:
    period_days = _period_days(period)
    tenant_filter = tenant_id if user.get("role") == "admin" and tenant_id else None
    if user.get("role") != "admin":
        tenant_filter = user.get("tenant_id")
    totals = await db.fetchrow(
        """
        WITH current_logs AS (
          SELECT actor_type, include_generative, include_faq, latency_ms
          FROM KMS_ADMIN_SEARCH_LOGS
          WHERE create_time >= NOW() - ($1 * INTERVAL '1 day')
            AND ($2::text IS NULL OR tenant_id = $2)
        ),
        previous_logs AS (
          SELECT search_id
          FROM KMS_ADMIN_SEARCH_LOGS
          WHERE create_time >= NOW() - (($1 * 2) * INTERVAL '1 day')
            AND create_time < NOW() - ($1 * INTERVAL '1 day')
            AND ($2::text IS NULL OR tenant_id = $2)
        )
        SELECT
          (SELECT COUNT(*) FROM KMS_ADMIN_CATEGORIES WHERE $2::text IS NULL OR tenant_id = $2)::INT AS categories,
          (SELECT COUNT(*) FROM KMS_ADMIN_KNOWLEDGE_ITEMS WHERE $2::text IS NULL OR tenant_id = $2)::INT AS knowledge_items,
          (SELECT COUNT(*) FROM KMS_ADMIN_SEARCH_LOGS WHERE $2::text IS NULL OR tenant_id = $2)::INT AS searches,
          (SELECT COUNT(*) FROM current_logs)::INT AS period_searches,
          (SELECT COUNT(*) FROM previous_logs)::INT AS previous_period_searches,
          (
            SELECT COUNT(*)
            FROM KMS_ADMIN_USERS u
            LEFT JOIN KMS_ADMIN_USER_TENANTS ut ON ut.user_id = u.user_id
            WHERE $2::text IS NULL OR ut.tenant_id = $2
          )::INT AS users,
          COALESCE((SELECT ROUND(AVG(latency_ms)) FROM current_logs), 0)::INT AS avg_latency_ms,
          (SELECT COUNT(*) FROM current_logs WHERE actor_type = 'api_client')::INT AS external_searches,
          (SELECT COUNT(*) FROM current_logs WHERE actor_type <> 'api_client')::INT AS internal_searches,
          (SELECT COUNT(*) FROM current_logs WHERE include_generative)::INT AS generative_searches,
          (SELECT COUNT(*) FROM current_logs WHERE include_faq)::INT AS faq_searches
        """,
        period_days,
        tenant_filter,
    )
    by_category = await db.fetch(
        """
        SELECT COALESCE(c.name, '미분류') AS label, COUNT(i.item_id)::INT AS count
        FROM KMS_ADMIN_KNOWLEDGE_ITEMS i
        LEFT JOIN KMS_ADMIN_CATEGORIES c ON c.category_id = i.category_id AND c.tenant_id = i.tenant_id
        WHERE $1::text IS NULL OR i.tenant_id = $1
        GROUP BY COALESCE(c.name, '미분류')
        ORDER BY count DESC, label ASC
        LIMIT 50
        """,
        tenant_filter,
    )
    by_date = await db.fetch(
        """
        WITH days AS (
          SELECT generate_series(
            ((NOW() AT TIME ZONE 'Asia/Seoul')::DATE - ($1::INT - 1)),
            (NOW() AT TIME ZONE 'Asia/Seoul')::DATE,
            INTERVAL '1 day'
          )::DATE AS day
        )
        SELECT TO_CHAR(d.day, 'YYYY-MM-DD') AS label,
               COUNT(l.search_id)::INT AS count
        FROM days d
        LEFT JOIN KMS_ADMIN_SEARCH_LOGS l
          ON (l.create_time AT TIME ZONE 'Asia/Seoul')::DATE = d.day
         AND l.create_time >= NOW() - ($1 * INTERVAL '1 day')
         AND ($2::text IS NULL OR l.tenant_id = $2)
        GROUP BY d.day
        ORDER BY d.day ASC
        """,
        period_days,
        tenant_filter,
    )
    by_hour = await db.fetch(
        """
        WITH hours AS (
          SELECT generate_series(0, 23)::INT AS hour
        )
        SELECT LPAD(h.hour::TEXT, 2, '0') || ':00' AS label,
               COUNT(l.search_id)::INT AS count
        FROM hours h
        LEFT JOIN KMS_ADMIN_SEARCH_LOGS l
          ON EXTRACT(HOUR FROM l.create_time AT TIME ZONE 'Asia/Seoul')::INT = h.hour
         AND l.create_time >= NOW() - ($1 * INTERVAL '1 day')
         AND ($2::text IS NULL OR l.tenant_id = $2)
        GROUP BY h.hour
        ORDER BY h.hour ASC
        """,
        period_days,
        tenant_filter,
    )
    by_actor = await db.fetch(
        """
        SELECT CASE
                 WHEN actor_type = 'api_client' THEN '외부 API'
                 WHEN actor_type = 'user' THEN '내부 사용자'
                 ELSE actor_type
               END AS label,
               COUNT(*)::INT AS count
        FROM KMS_ADMIN_SEARCH_LOGS
        WHERE create_time >= NOW() - ($1 * INTERVAL '1 day')
          AND ($2::text IS NULL OR tenant_id = $2)
        GROUP BY label
        ORDER BY count DESC, label ASC
        """,
        period_days,
        tenant_filter,
    )
    by_channel = await db.fetch(
        """
        SELECT CASE
                 WHEN include_generative AND include_faq THEN 'AI + FAQ'
                 WHEN include_generative THEN 'AI 답변'
                 WHEN include_faq THEN 'FAQ 답변'
                 ELSE '기록만'
               END AS label,
               COUNT(*)::INT AS count
        FROM KMS_ADMIN_SEARCH_LOGS
        WHERE create_time >= NOW() - ($1 * INTERVAL '1 day')
          AND ($2::text IS NULL OR tenant_id = $2)
        GROUP BY label
        ORDER BY count DESC, label ASC
        """,
        period_days,
        tenant_filter,
    )
    keywords = await db.fetch(
        """
        SELECT LOWER(query) AS label, COUNT(*)::INT AS count
        FROM KMS_ADMIN_SEARCH_LOGS
        WHERE create_time >= NOW() - ($1 * INTERVAL '1 day')
          AND ($2::text IS NULL OR tenant_id = $2)
        GROUP BY LOWER(query)
        ORDER BY count DESC, label ASC
        LIMIT 30
        """,
        period_days,
        tenant_filter,
    )
    return {
        "period": period,
        "tenant_id": tenant_filter,
        "period_days": period_days,
        "period_start": by_date[0]["label"] if by_date else None,
        "period_end": by_date[-1]["label"] if by_date else None,
        "totals": totals,
        "by_category": by_category,
        "by_date": by_date,
        "by_hour": by_hour,
        "by_actor": by_actor,
        "by_channel": by_channel,
        "keywords": keywords,
    }


@router.get("/stats.csv")
async def stats_csv(
    request: Request,
    period: str = Query("7d"),
    user: dict = Depends(get_current_user),
) -> StreamingResponse:
    payload = await stats(period=period, tenant_id=None, user=user)
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=["section", "label", "count"])
    writer.writeheader()
    for key, value in (payload.get("totals") or {}).items():
        writer.writerow({"section": "totals", "label": key, "count": value})
    for section in ("by_category", "by_date", "by_hour", "by_actor", "by_channel", "keywords"):
        for row in payload.get(section) or []:
            writer.writerow({"section": section, "label": row.get("label"), "count": row.get("count")})
    buffer.seek(0)
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="download_stats",
        target_type="system_stats",
        target_id=period,
        detail={"format": "csv", "period": period},
    )
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=kms-admin-stats-{period}.csv"},
    )


@router.get("/stats/keyword-detail")
async def keyword_detail(
    keyword: str = Query(min_length=1),
    period: str = Query("7d"),
    tenant_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    user: dict = Depends(get_current_user),
) -> dict:
    period_days = _period_days(period)
    tenant_filter = tenant_id if user.get("role") == "admin" and tenant_id else None
    if user.get("role") != "admin":
        tenant_filter = user.get("tenant_id")
    summary = await db.fetchrow(
        """
        SELECT COUNT(*)::INT AS count,
               COALESCE(ROUND(AVG(latency_ms)), 0)::INT AS avg_latency_ms,
               COUNT(*) FILTER (WHERE include_generative)::INT AS generative_count,
               COUNT(*) FILTER (WHERE include_faq)::INT AS faq_count
        FROM KMS_ADMIN_SEARCH_LOGS
        WHERE create_time >= NOW() - ($1 * INTERVAL '1 day')
          AND LOWER(query) = LOWER($2)
          AND ($3::text IS NULL OR tenant_id = $3)
        """,
        period_days,
        keyword,
        tenant_filter,
    )
    rows = await db.fetch(
        """
        SELECT search_id, tenant_id, actor_type, actor_id, query, category_ids,
               include_generative, include_faq, kms_workspace, faq_workspace,
               generative_trace_id, faq_trace_id, result_summary, latency_ms,
               client_trace_id, create_time
        FROM KMS_ADMIN_SEARCH_LOGS
        WHERE create_time >= NOW() - ($1 * INTERVAL '1 day')
          AND LOWER(query) = LOWER($2)
          AND ($3::text IS NULL OR tenant_id = $3)
        ORDER BY create_time DESC
        LIMIT $4
        """,
        period_days,
        keyword,
        tenant_filter,
        limit,
    )
    by_date = await db.fetch(
        """
        SELECT TO_CHAR(create_time AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS label,
               COUNT(*)::INT AS count
        FROM KMS_ADMIN_SEARCH_LOGS
        WHERE create_time >= NOW() - ($1 * INTERVAL '1 day')
          AND LOWER(query) = LOWER($2)
          AND ($3::text IS NULL OR tenant_id = $3)
        GROUP BY label
        ORDER BY label ASC
        """,
        period_days,
        keyword,
        tenant_filter,
    )
    return {
        "keyword": keyword,
        "period": period,
        "tenant_id": tenant_filter,
        "period_days": period_days,
        "summary": summary,
        "by_date": by_date,
        "logs": rows,
    }


@router.get("/audit")
async def audit(_: dict = Depends(require_admin)) -> dict:
    rows = await db.fetch(
        """
        SELECT audit_id, actor_type, actor_id, action, target_type, target_id,
               detail, ip_address, create_time
        FROM KMS_ADMIN_AUDIT_LOGS
        ORDER BY create_time DESC
        LIMIT 500
        """
    )
    return {"logs": rows}
