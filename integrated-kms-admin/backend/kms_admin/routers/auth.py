from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from ..db import db
from ..dependencies import audit_log, get_current_user
from ..roles import normalize_role
from ..security import create_access_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    user_id: str = Field(min_length=1)
    password: str = Field(min_length=1)


@router.post("/login")
async def login(payload: LoginRequest, request: Request) -> dict:
    user = await db.fetchrow(
        """
        SELECT u.user_id, u.password_hash, u.role, u.display_name, u.is_active,
               t.tenant_id, t.name AS tenant_name, t.kms_workspace, t.faq_workspace
        FROM KMS_ADMIN_USERS u
        LEFT JOIN KMS_ADMIN_USER_TENANTS ut ON ut.user_id = u.user_id
        LEFT JOIN KMS_ADMIN_TENANTS t ON t.tenant_id = ut.tenant_id
        WHERE u.user_id = $1
        """,
        payload.user_id,
    )
    if not user or not user["is_active"] or not verify_password(payload.password, user["password_hash"]):
        if user:
            await db.execute(
                """
                UPDATE KMS_ADMIN_USERS
                SET failed_login_count = failed_login_count + 1, update_time = NOW()
                WHERE user_id = $1
                """,
                payload.user_id,
            )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    await db.execute(
        """
        UPDATE KMS_ADMIN_USERS
        SET failed_login_count = 0, last_login_at = NOW(), update_time = NOW()
        WHERE user_id = $1
        """,
        payload.user_id,
    )
    await audit_log(
        request,
        actor_type="user",
        actor_id=payload.user_id,
        action="login",
        tenant_id=user["tenant_id"],
        target_type="user",
        target_id=payload.user_id,
    )
    role = normalize_role(user["role"])
    token = create_access_token(
        subject=user["user_id"],
        role=role,
        metadata={
            "tenant_id": user["tenant_id"],
            "kms_workspace": user["kms_workspace"],
            "faq_workspace": user["faq_workspace"],
        },
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "user_id": user["user_id"],
            "role": role,
            "display_name": user["display_name"],
            "tenant_id": user["tenant_id"],
            "tenant_name": user["tenant_name"],
            "kms_workspace": user["kms_workspace"],
            "faq_workspace": user["faq_workspace"],
        },
    }


@router.get("/me")
async def me(user: dict = Depends(get_current_user)) -> dict:
    return {"user": user}


@router.post("/logout")
async def logout(request: Request, user: dict = Depends(get_current_user)) -> dict:
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="logout",
        tenant_id=user.get("tenant_id"),
        target_type="user",
        target_id=user["user_id"],
    )
    return {"message": "logged out"}
