from __future__ import annotations

import json
import logging
from typing import Any

import asyncpg

from .config import settings
from .help_seed import HELP_ROLES, load_help_seed_topics
from .security import hash_password

logger = logging.getLogger(__name__)


class Database:
    def __init__(self) -> None:
        self.pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        if self.pool is None:
            self.pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=10)

    async def close(self) -> None:
        if self.pool is not None:
            await self.pool.close()
            self.pool = None

    async def fetch(self, sql: str, *args: Any) -> list[dict[str, Any]]:
        assert self.pool is not None
        rows = await self.pool.fetch(sql, *args)
        return [dict(row) for row in rows]

    async def fetchrow(self, sql: str, *args: Any) -> dict[str, Any] | None:
        assert self.pool is not None
        row = await self.pool.fetchrow(sql, *args)
        return dict(row) if row else None

    async def execute(self, sql: str, *args: Any) -> str:
        assert self.pool is not None
        return await self.pool.execute(sql, *args)

    async def execute_many_transaction(
        self,
        operations: list[tuple[str, list[tuple[Any, ...]]]],
    ) -> None:
        assert self.pool is not None
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                for sql, args in operations:
                    if args:
                        await connection.executemany(sql, args)

    async def migrate(self) -> None:
        statements = [
            """
            CREATE TABLE IF NOT EXISTS KMS_ADMIN_TENANTS (
                tenant_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kms_workspace TEXT NOT NULL,
                faq_workspace TEXT NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                create_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                update_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS KMS_ADMIN_USERS (
                user_id TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                display_name TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                failed_login_count INTEGER NOT NULL DEFAULT 0,
                last_login_at TIMESTAMPTZ,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                create_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                update_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS KMS_ADMIN_USER_TENANTS (
                user_id TEXT PRIMARY KEY REFERENCES KMS_ADMIN_USERS(user_id) ON DELETE CASCADE,
                tenant_id TEXT NOT NULL REFERENCES KMS_ADMIN_TENANTS(tenant_id) ON DELETE RESTRICT,
                create_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                update_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS KMS_ADMIN_USER_WORKSPACES (
                user_id TEXT PRIMARY KEY REFERENCES KMS_ADMIN_USERS(user_id) ON DELETE CASCADE,
                kms_workspace TEXT NOT NULL,
                faq_workspace TEXT NOT NULL,
                create_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                update_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS KMS_ADMIN_API_CLIENTS (
                client_id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                api_key_hash TEXT NOT NULL UNIQUE,
                api_key_encrypted TEXT,
                tenant_id TEXT REFERENCES KMS_ADMIN_TENANTS(tenant_id) ON DELETE RESTRICT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                kms_workspace TEXT NOT NULL,
                faq_workspace TEXT NOT NULL,
                scopes JSONB NOT NULL DEFAULT '["search"]'::jsonb,
                rate_limit_per_minute INTEGER NOT NULL DEFAULT 120,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                last_used_at TIMESTAMPTZ,
                create_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                update_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS KMS_ADMIN_CATEGORIES (
                category_id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL REFERENCES KMS_ADMIN_TENANTS(tenant_id) ON DELETE CASCADE,
                parent_id TEXT REFERENCES KMS_ADMIN_CATEGORIES(category_id) ON DELETE SET NULL,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                create_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                update_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS KMS_ADMIN_KNOWLEDGE_ITEMS (
                item_id TEXT PRIMARY KEY,
                tenant_id TEXT REFERENCES KMS_ADMIN_TENANTS(tenant_id) ON DELETE RESTRICT,
                knowledge_type TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT,
                category_id TEXT REFERENCES KMS_ADMIN_CATEGORIES(category_id) ON DELETE SET NULL,
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
                valid_from TIMESTAMPTZ,
                valid_until TIMESTAMPTZ,
                kms_workspace TEXT,
                faq_workspace TEXT,
                status TEXT NOT NULL DEFAULT 'draft',
                version INTEGER NOT NULL DEFAULT 1,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_by TEXT,
                create_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                update_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS KMS_ADMIN_KNOWLEDGE_REFS (
                ref_id TEXT PRIMARY KEY,
                item_id TEXT NOT NULL REFERENCES KMS_ADMIN_KNOWLEDGE_ITEMS(item_id) ON DELETE CASCADE,
                ref_type TEXT NOT NULL,
                workspace_type TEXT NOT NULL,
                workspace TEXT NOT NULL,
                external_id TEXT NOT NULL,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                create_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS KMS_ADMIN_JOBS (
                job_id TEXT PRIMARY KEY,
                tenant_id TEXT REFERENCES KMS_ADMIN_TENANTS(tenant_id) ON DELETE RESTRICT,
                item_id TEXT REFERENCES KMS_ADMIN_KNOWLEDGE_ITEMS(item_id) ON DELETE SET NULL,
                job_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                lightrag_task_id TEXT,
                progress DOUBLE PRECISION NOT NULL DEFAULT 0,
                message TEXT,
                rollback_status TEXT,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                create_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                update_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS KMS_ADMIN_JOB_EVENTS (
                event_id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL REFERENCES KMS_ADMIN_JOBS(job_id) ON DELETE CASCADE,
                event_type TEXT NOT NULL,
                message TEXT,
                detail JSONB NOT NULL DEFAULT '{}'::jsonb,
                create_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS KMS_ADMIN_SEARCH_LOGS (
                search_id TEXT PRIMARY KEY,
                tenant_id TEXT REFERENCES KMS_ADMIN_TENANTS(tenant_id) ON DELETE SET NULL,
                actor_type TEXT NOT NULL,
                actor_id TEXT,
                query TEXT NOT NULL,
                category_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
                include_generative BOOLEAN NOT NULL DEFAULT TRUE,
                include_faq BOOLEAN NOT NULL DEFAULT TRUE,
                kms_workspace TEXT,
                faq_workspace TEXT,
                generative_trace_id TEXT,
                faq_trace_id TEXT,
                result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
                latency_ms INTEGER NOT NULL DEFAULT 0,
                client_trace_id TEXT,
                create_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS KMS_ADMIN_AUDIT_LOGS (
                audit_id TEXT PRIMARY KEY,
                tenant_id TEXT REFERENCES KMS_ADMIN_TENANTS(tenant_id) ON DELETE SET NULL,
                actor_type TEXT NOT NULL,
                actor_id TEXT,
                action TEXT NOT NULL,
                target_type TEXT,
                target_id TEXT,
                detail JSONB NOT NULL DEFAULT '{}'::jsonb,
                ip_address TEXT,
                user_agent TEXT,
                create_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS KMS_ADMIN_HELP_TOPICS (
                help_id TEXT PRIMARY KEY,
                nav_key TEXT NOT NULL,
                menu_label TEXT NOT NULL,
                title TEXT NOT NULL,
                summary TEXT NOT NULL DEFAULT '',
                body_md TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'draft',
                sort_order INTEGER NOT NULL DEFAULT 0,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                create_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                update_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS KMS_ADMIN_HELP_TOPIC_VISIBILITY (
                help_id TEXT NOT NULL REFERENCES KMS_ADMIN_HELP_TOPICS(help_id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                is_visible BOOLEAN NOT NULL DEFAULT FALSE,
                update_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY(help_id, role)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS KMS_ADMIN_HELP_SCREENSHOTS (
                screenshot_id TEXT PRIMARY KEY,
                help_id TEXT NOT NULL REFERENCES KMS_ADMIN_HELP_TOPICS(help_id) ON DELETE CASCADE,
                file_path TEXT NOT NULL,
                caption TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                create_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                update_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """,
            "CREATE INDEX IF NOT EXISTS IDX_KMS_ADMIN_ITEMS_CATEGORY ON KMS_ADMIN_KNOWLEDGE_ITEMS(category_id)",
            "CREATE INDEX IF NOT EXISTS IDX_KMS_ADMIN_ITEMS_TENANT ON KMS_ADMIN_KNOWLEDGE_ITEMS(tenant_id)",
            "CREATE INDEX IF NOT EXISTS IDX_KMS_ADMIN_ITEMS_VALIDITY ON KMS_ADMIN_KNOWLEDGE_ITEMS(enabled, valid_from, valid_until)",
            "CREATE INDEX IF NOT EXISTS IDX_KMS_ADMIN_REFS_ITEM ON KMS_ADMIN_KNOWLEDGE_REFS(item_id)",
            "CREATE INDEX IF NOT EXISTS IDX_KMS_ADMIN_JOB_EVENTS_JOB_TIME ON KMS_ADMIN_JOB_EVENTS(job_id, create_time ASC)",
            "CREATE INDEX IF NOT EXISTS IDX_KMS_ADMIN_CATEGORIES_TENANT ON KMS_ADMIN_CATEGORIES(tenant_id, parent_id, sort_order, name)",
            "CREATE INDEX IF NOT EXISTS IDX_KMS_ADMIN_SEARCH_TENANT_TIME ON KMS_ADMIN_SEARCH_LOGS(tenant_id, create_time DESC)",
            "CREATE INDEX IF NOT EXISTS IDX_KMS_ADMIN_SEARCH_TIME ON KMS_ADMIN_SEARCH_LOGS(create_time DESC)",
            "CREATE INDEX IF NOT EXISTS IDX_KMS_ADMIN_AUDIT_TIME ON KMS_ADMIN_AUDIT_LOGS(create_time DESC)",
            "CREATE INDEX IF NOT EXISTS IDX_KMS_ADMIN_HELP_TOPICS_ORDER ON KMS_ADMIN_HELP_TOPICS(status, sort_order, menu_label)",
            "ALTER TABLE KMS_ADMIN_API_CLIENTS ADD COLUMN IF NOT EXISTS tenant_id TEXT",
            "ALTER TABLE KMS_ADMIN_API_CLIENTS ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT",
            "ALTER TABLE KMS_ADMIN_CATEGORIES ADD COLUMN IF NOT EXISTS tenant_id TEXT",
            "ALTER TABLE KMS_ADMIN_KNOWLEDGE_ITEMS ADD COLUMN IF NOT EXISTS tenant_id TEXT",
            "ALTER TABLE KMS_ADMIN_JOBS ADD COLUMN IF NOT EXISTS tenant_id TEXT",
            "ALTER TABLE KMS_ADMIN_SEARCH_LOGS ADD COLUMN IF NOT EXISTS tenant_id TEXT",
            "ALTER TABLE KMS_ADMIN_AUDIT_LOGS ADD COLUMN IF NOT EXISTS tenant_id TEXT",
            "UPDATE KMS_ADMIN_USERS SET role = 'user', update_time = NOW() WHERE role = 'viewer'",
        ]
        for statement in statements:
            await self.execute(statement)
        await self.ensure_default_tenant()
        await self.backfill_tenant_ids()
        await self.seed_help_topics()
        await self.bootstrap_admin()
        await self.ensure_default_user_tenant()

    async def ensure_default_tenant(self) -> None:
        await self.execute(
            """
            INSERT INTO KMS_ADMIN_TENANTS(
                tenant_id, name, kms_workspace, faq_workspace, is_active, metadata
            )
            VALUES($1, $2, $3, $4, TRUE, $5::jsonb)
            ON CONFLICT (tenant_id) DO UPDATE
            SET name = COALESCE(NULLIF(KMS_ADMIN_TENANTS.name, ''), EXCLUDED.name),
                kms_workspace = CASE
                    WHEN KMS_ADMIN_TENANTS.kms_workspace IN ('', 'base')
                    THEN EXCLUDED.kms_workspace
                    ELSE KMS_ADMIN_TENANTS.kms_workspace
                END,
                faq_workspace = CASE
                    WHEN KMS_ADMIN_TENANTS.faq_workspace IN ('', 'base')
                    THEN EXCLUDED.faq_workspace
                    ELSE KMS_ADMIN_TENANTS.faq_workspace
                END,
                update_time = NOW()
            """,
            settings.default_tenant_id,
            settings.default_tenant_name,
            settings.default_kms_workspace,
            settings.default_faq_workspace,
            json.dumps({"bootstrap": True, "default": True}),
        )

    async def backfill_tenant_ids(self) -> None:
        await self.execute(
            """
            INSERT INTO KMS_ADMIN_TENANTS(
                tenant_id, name, kms_workspace, faq_workspace, is_active, metadata
            )
            SELECT DISTINCT
                'tenant_' || md5(kms_workspace || '|' || faq_workspace),
                kms_workspace || ' / ' || faq_workspace,
                kms_workspace,
                faq_workspace,
                TRUE,
                '{"created_from":"workspace_pair_backfill"}'::jsonb
            FROM KMS_ADMIN_USER_WORKSPACES
            WHERE kms_workspace IS NOT NULL
              AND faq_workspace IS NOT NULL
            ON CONFLICT (tenant_id) DO NOTHING
            """
        )
        for table in (
            "KMS_ADMIN_API_CLIENTS",
            "KMS_ADMIN_KNOWLEDGE_ITEMS",
            "KMS_ADMIN_SEARCH_LOGS",
        ):
            await self.execute(
                f"""
                UPDATE {table} target
                SET tenant_id = tenant.tenant_id
                FROM KMS_ADMIN_TENANTS tenant
                WHERE target.tenant_id IS NULL
                  AND target.kms_workspace = tenant.kms_workspace
                  AND target.faq_workspace = tenant.faq_workspace
                """
            )
        await self.execute(
            """
            UPDATE KMS_ADMIN_CATEGORIES
            SET tenant_id = $1
            WHERE tenant_id IS NULL
            """,
            settings.default_tenant_id,
        )
        await self.execute(
            """
            UPDATE KMS_ADMIN_KNOWLEDGE_ITEMS
            SET tenant_id = $1
            WHERE tenant_id IS NULL
            """,
            settings.default_tenant_id,
        )
        await self.execute(
            """
            UPDATE KMS_ADMIN_API_CLIENTS
            SET tenant_id = $1
            WHERE tenant_id IS NULL
            """,
            settings.default_tenant_id,
        )
        await self.execute(
            """
            UPDATE KMS_ADMIN_JOBS j
            SET tenant_id = i.tenant_id
            FROM KMS_ADMIN_KNOWLEDGE_ITEMS i
            WHERE j.tenant_id IS NULL
              AND j.item_id = i.item_id
              AND i.tenant_id IS NOT NULL
            """
        )
        await self.execute(
            """
            UPDATE KMS_ADMIN_JOBS
            SET tenant_id = $1
            WHERE tenant_id IS NULL
            """,
            settings.default_tenant_id,
        )
        await self.execute(
            """
            WITH faq_items AS (
                SELECT
                    i.item_id,
                    COALESCE(i.tenant_id, $1) AS tenant_id,
                    i.knowledge_type,
                    i.status,
                    i.create_time,
                    i.update_time,
                    MIN(r.workspace) AS workspace,
                    MIN(r.external_id) AS answer_id,
                    COALESCE(jsonb_agg(r.metadata) FILTER (WHERE r.ref_id IS NOT NULL), '[]'::jsonb) AS refs
                FROM KMS_ADMIN_KNOWLEDGE_ITEMS i
                LEFT JOIN KMS_ADMIN_KNOWLEDGE_REFS r
                  ON r.item_id = i.item_id
                 AND r.workspace_type = 'faq'
                 AND r.ref_type = 'answer_id'
                WHERE i.knowledge_type IN ('faq', 'faq_source_draft')
                  AND NOT EXISTS (
                    SELECT 1
                    FROM KMS_ADMIN_JOBS j
                    WHERE j.item_id = i.item_id
                  )
                GROUP BY i.item_id, i.tenant_id, i.knowledge_type, i.status, i.create_time, i.update_time
            )
            INSERT INTO KMS_ADMIN_JOBS(
                job_id, tenant_id, item_id, job_type, status, progress, message, metadata, create_time, update_time
            )
            SELECT
                'faq-backfill-' || item_id,
                tenant_id,
                item_id,
                CASE WHEN knowledge_type = 'faq_source_draft' THEN 'faq_source_draft' ELSE 'faq_answer' END,
                CASE
                    WHEN status IN ('failed', 'cancelled', 'archived') THEN status
                    WHEN status = 'processing' THEN 'running'
                    ELSE 'completed'
                END,
                CASE WHEN status = 'processing' THEN 0.0 ELSE 100.0 END,
                CASE WHEN knowledge_type = 'faq_source_draft' THEN 'FAQ 소스 초안 등록 완료' ELSE 'FAQ 답변 등록 완료' END,
                jsonb_build_object(
                    'backfilled', TRUE,
                    'workspace', workspace,
                    'answer_id', answer_id,
                    'refs', refs
                ),
                create_time,
                update_time
            FROM faq_items
            """,
            settings.default_tenant_id,
        )
        await self.execute(
            """
            UPDATE KMS_ADMIN_SEARCH_LOGS
            SET tenant_id = $1
            WHERE tenant_id IS NULL
            """,
            settings.default_tenant_id,
        )
        await self.execute(
            """
            UPDATE KMS_ADMIN_AUDIT_LOGS
            SET tenant_id = $1
            WHERE tenant_id IS NULL
            """,
            settings.default_tenant_id,
        )
        await self.execute(
            """
            INSERT INTO KMS_ADMIN_USER_TENANTS(user_id, tenant_id)
            SELECT w.user_id, COALESCE(t.tenant_id, $1)
            FROM KMS_ADMIN_USER_WORKSPACES w
            LEFT JOIN KMS_ADMIN_TENANTS t
              ON t.kms_workspace = w.kms_workspace
             AND t.faq_workspace = w.faq_workspace
            WHERE EXISTS (SELECT 1 FROM KMS_ADMIN_USERS u WHERE u.user_id = w.user_id)
            ON CONFLICT (user_id) DO NOTHING
            """,
            settings.default_tenant_id,
        )

    async def bootstrap_admin(self) -> None:
        current = await self.fetchrow(
            "SELECT user_id FROM KMS_ADMIN_USERS WHERE user_id = $1",
            settings.bootstrap_admin_id,
        )
        if current:
            return
        await self.execute(
            """
            INSERT INTO KMS_ADMIN_USERS(user_id, password_hash, role, display_name, metadata)
            VALUES($1, $2, 'admin', $3, $4::jsonb)
            """,
            settings.bootstrap_admin_id,
            hash_password(settings.bootstrap_admin_password),
            "Administrator",
            json.dumps({"bootstrap": True}),
        )
        logger.info("Bootstrapped admin account: %s", settings.bootstrap_admin_id)

    async def ensure_default_user_tenant(self) -> None:
        await self.execute(
            """
            INSERT INTO KMS_ADMIN_USER_TENANTS(user_id, tenant_id)
            SELECT $1, $2
            WHERE EXISTS (SELECT 1 FROM KMS_ADMIN_USERS WHERE user_id = $1)
            ON CONFLICT (user_id) DO UPDATE
            SET tenant_id = COALESCE(KMS_ADMIN_USER_TENANTS.tenant_id, EXCLUDED.tenant_id),
                update_time = NOW()
            """,
            settings.bootstrap_admin_id,
            settings.default_tenant_id,
        )

    async def seed_help_topics(self) -> None:
        for topic in load_help_seed_topics():
            await self.execute(
                """
                INSERT INTO KMS_ADMIN_HELP_TOPICS(
                    help_id, nav_key, menu_label, title, summary, body_md,
                    status, sort_order, metadata
                )
                VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
                ON CONFLICT (help_id) DO UPDATE
                SET title = CASE
                        WHEN COALESCE(KMS_ADMIN_HELP_TOPICS.metadata->>'seeded_from', '') = 'docs/help'
                         AND COALESCE(KMS_ADMIN_HELP_TOPICS.metadata->>'content_customized', 'false') <> 'true'
                        THEN EXCLUDED.title
                        ELSE KMS_ADMIN_HELP_TOPICS.title
                    END,
                    summary = CASE
                        WHEN COALESCE(KMS_ADMIN_HELP_TOPICS.metadata->>'seeded_from', '') = 'docs/help'
                         AND COALESCE(KMS_ADMIN_HELP_TOPICS.metadata->>'content_customized', 'false') <> 'true'
                        THEN EXCLUDED.summary
                        ELSE KMS_ADMIN_HELP_TOPICS.summary
                    END,
                    body_md = CASE
                        WHEN COALESCE(KMS_ADMIN_HELP_TOPICS.metadata->>'seeded_from', '') = 'docs/help'
                         AND COALESCE(KMS_ADMIN_HELP_TOPICS.metadata->>'content_customized', 'false') <> 'true'
                        THEN EXCLUDED.body_md
                        ELSE KMS_ADMIN_HELP_TOPICS.body_md
                    END,
                    menu_label = CASE
                        WHEN COALESCE(KMS_ADMIN_HELP_TOPICS.metadata->>'seeded_from', '') = 'docs/help'
                         AND COALESCE(KMS_ADMIN_HELP_TOPICS.metadata->>'content_customized', 'false') <> 'true'
                        THEN EXCLUDED.menu_label
                        ELSE KMS_ADMIN_HELP_TOPICS.menu_label
                    END,
                    nav_key = CASE
                        WHEN COALESCE(KMS_ADMIN_HELP_TOPICS.metadata->>'seeded_from', '') = 'docs/help'
                         AND COALESCE(KMS_ADMIN_HELP_TOPICS.metadata->>'content_customized', 'false') <> 'true'
                        THEN EXCLUDED.nav_key
                        ELSE KMS_ADMIN_HELP_TOPICS.nav_key
                    END,
                    update_time = CASE
                        WHEN COALESCE(KMS_ADMIN_HELP_TOPICS.metadata->>'seeded_from', '') = 'docs/help'
                         AND COALESCE(KMS_ADMIN_HELP_TOPICS.metadata->>'content_customized', 'false') <> 'true'
                        THEN NOW()
                        ELSE KMS_ADMIN_HELP_TOPICS.update_time
                    END
                """,
                topic.help_id,
                topic.nav_key,
                topic.menu_label,
                topic.title,
                topic.summary,
                topic.body_md,
                topic.status,
                topic.sort_order,
                json.dumps({"seeded_from": "docs/help", "screenshot_required": True}),
            )
            for role in HELP_ROLES:
                await self.execute(
                    """
                    INSERT INTO KMS_ADMIN_HELP_TOPIC_VISIBILITY(help_id, role, is_visible)
                    VALUES($1, $2, $3)
                    ON CONFLICT (help_id, role) DO NOTHING
                    """,
                    topic.help_id,
                    role,
                    topic.visibility.get(role, False),
                )
            await self.execute(
                """
                INSERT INTO KMS_ADMIN_HELP_SCREENSHOTS(
                    screenshot_id, help_id, file_path, caption, sort_order
                )
                VALUES($1, $2, $3, $4, 10)
                ON CONFLICT (screenshot_id) DO NOTHING
                """,
                f"{topic.help_id}-primary",
                topic.help_id,
                topic.screenshot_path,
                topic.screenshot_caption,
            )


db = Database()
