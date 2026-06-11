from __future__ import annotations

import json
import time
from collections import defaultdict, deque
from typing import Any

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer

from .db import db
from .roles import normalize_role
from .security import decode_access_token, hash_api_key

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)
_rate_windows: dict[str, deque[float]] = defaultdict(deque)


async def audit_log(
    request: Request,
    *,
    actor_type: str,
    actor_id: str | None,
    action: str,
    tenant_id: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    detail: dict[str, Any] | None = None,
) -> None:
    import uuid

    await db.execute(
        """
        INSERT INTO KMS_ADMIN_AUDIT_LOGS(
            audit_id, tenant_id, actor_type, actor_id, action, target_type, target_id,
            detail, ip_address, user_agent
        )
        VALUES($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
        """,
        str(uuid.uuid4()),
        tenant_id,
        actor_type,
        actor_id,
        action,
        target_type,
        target_id,
        json.dumps(detail or {}),
        request.client.host if request.client else None,
        request.headers.get("user-agent"),
    )


async def get_current_user(token: str | None = Depends(oauth2_scheme)) -> dict[str, Any]:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login required")
    payload = decode_access_token(token)
    user = await db.fetchrow(
        """
        SELECT u.user_id, u.role, u.display_name, u.is_active,
               t.tenant_id, t.name AS tenant_name, t.kms_workspace, t.faq_workspace
        FROM KMS_ADMIN_USERS u
        LEFT JOIN KMS_ADMIN_USER_TENANTS ut ON ut.user_id = u.user_id
        LEFT JOIN KMS_ADMIN_TENANTS t ON t.tenant_id = ut.tenant_id
        WHERE u.user_id = $1
        """,
        payload["sub"],
    )
    if not user or not user["is_active"]:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive user")
    user["role"] = normalize_role(user["role"])
    return user


async def require_admin(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return user


async def get_external_client(
    x_kms_admin_api_key: str | None = Header(default=None, alias="X-KMS-ADMIN-API-Key"),
) -> dict[str, Any]:
    if not x_kms_admin_api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key required")
    key_hash = hash_api_key(x_kms_admin_api_key)
    client = await db.fetchrow(
        """
        SELECT c.client_id, c.display_name, c.is_active, c.scopes,
               c.rate_limit_per_minute, t.tenant_id, t.name AS tenant_name,
               t.kms_workspace, t.faq_workspace
        FROM KMS_ADMIN_API_CLIENTS c
        JOIN KMS_ADMIN_TENANTS t ON t.tenant_id = c.tenant_id
        WHERE api_key_hash = $1
        """,
        key_hash,
    )
    if not client or not client["is_active"]:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
    scopes = client.get("scopes") or []
    if isinstance(scopes, str):
        scopes = json.loads(scopes)
    if "search" not in scopes:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Search scope required")
    now = time.monotonic()
    window = _rate_windows[client["client_id"]]
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= int(client["rate_limit_per_minute"]):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")
    window.append(now)
    await db.execute(
        "UPDATE KMS_ADMIN_API_CLIENTS SET last_used_at = NOW() WHERE client_id = $1",
        client["client_id"],
    )
    client["scopes"] = scopes
    return client
