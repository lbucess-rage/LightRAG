from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from kms_admin.config import settings  # noqa: E402
from kms_admin.db import db  # noqa: E402


ADMIN_TABLES = (
    "KMS_ADMIN_JOB_EVENTS",
    "KMS_ADMIN_KNOWLEDGE_REFS",
    "KMS_ADMIN_JOBS",
    "KMS_ADMIN_SEARCH_LOGS",
    "KMS_ADMIN_AUDIT_LOGS",
    "KMS_ADMIN_API_CLIENTS",
    "KMS_ADMIN_KNOWLEDGE_ITEMS",
    "KMS_ADMIN_CATEGORIES",
    "KMS_ADMIN_USER_WORKSPACES",
    "KMS_ADMIN_USER_TENANTS",
    "KMS_ADMIN_USERS",
    "KMS_ADMIN_TENANTS",
)


async def reset_admin_db(yes: bool) -> None:
    if not yes:
        raise SystemExit(
            "Refusing to reset admin DB without --yes. "
            f"Target database: {settings.safe_database_url}"
        )
    await db.connect()
    try:
        for table in ADMIN_TABLES:
            await db.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
        await db.migrate()
    finally:
        await db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Reset only Integrated KMS Admin database tables.")
    parser.add_argument("--yes", action="store_true", help="Confirm dropping KMS_ADMIN_* tables.")
    args = parser.parse_args()
    asyncio.run(reset_admin_db(args.yes))
    print("KMS_ADMIN_* tables reset and migrated.")


if __name__ == "__main__":
    main()
