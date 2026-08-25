"""Manage reusable OpenAI-compatible LLM connection profiles."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import time
from datetime import datetime
from typing import Any, Literal, Optional
from urllib.parse import urlparse
from uuid import uuid4

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from lightrag.utils import logger

from ..utils_api import get_combined_auth_dependency


router = APIRouter(prefix="/llm-profiles", tags=["llm-profiles"])

_PROTECTED_REQUEST_OPTIONS = {"model", "messages", "stream"}
_PROFILE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
_LLM_PURPOSES = (
    "knowledge_ingestion",
    "knowledge_structure",
    "schema_design",
    "search_answer",
    "faq_selection",
    "multimodal",
)
WorkspaceLLMPurpose = Literal[
    "knowledge_ingestion",
    "knowledge_structure",
    "schema_design",
    "search_answer",
    "faq_selection",
    "multimodal",
]


class LLMProfileCreate(BaseModel):
    profile_id: Optional[str] = Field(
        default=None,
        description="Stable profile ID. Generated when omitted.",
    )
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    provider: Literal["openai_compatible"] = "openai_compatible"
    base_url: str = Field(description="OpenAI-compatible base URL, usually ending in /v1")
    model: str = Field(min_length=1, max_length=255)
    api_key: Optional[str] = Field(
        default=None,
        description="Encrypted before storage and never returned by the API.",
    )
    timeout_seconds: int = Field(default=120, ge=1, le=3600)
    context_window: int = Field(default=131072, ge=1, le=1048576)
    max_tokens: int = Field(default=2048, ge=1, le=131072)
    temperature: float = Field(default=0.7, ge=0, le=2)
    top_p: float = Field(default=0.8, ge=0, le=1)
    presence_penalty: float = Field(default=0, ge=-2, le=2)
    thinking_enabled: bool = False
    supports_thinking: bool = True
    supports_tools: bool = False
    supports_structured_output: bool = True
    supports_vision: bool = False
    verify_tls: bool = True
    extra_options: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True

    @field_validator("profile_id")
    @classmethod
    def validate_profile_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        value = value.strip()
        if not _PROFILE_ID_PATTERN.fullmatch(value):
            raise ValueError(
                "profile_id must start with a letter or number and contain only letters, numbers, '.', '_', or '-'"
            )
        return value

    @field_validator("name", "model")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("value must not be blank")
        return value

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        return _normalize_base_url(value)

    @field_validator("extra_options")
    @classmethod
    def validate_extra_options(cls, value: dict[str, Any]) -> dict[str, Any]:
        conflicts = sorted(_PROTECTED_REQUEST_OPTIONS.intersection(value))
        if conflicts:
            raise ValueError(
                f"extra_options cannot override protected fields: {', '.join(conflicts)}"
            )
        return value


class LLMProfileUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    provider: Optional[Literal["openai_compatible"]] = None
    base_url: Optional[str] = None
    model: Optional[str] = Field(default=None, min_length=1, max_length=255)
    api_key: Optional[str] = None
    clear_api_key: bool = False
    timeout_seconds: Optional[int] = Field(default=None, ge=1, le=3600)
    context_window: Optional[int] = Field(default=None, ge=1, le=1048576)
    max_tokens: Optional[int] = Field(default=None, ge=1, le=131072)
    temperature: Optional[float] = Field(default=None, ge=0, le=2)
    top_p: Optional[float] = Field(default=None, ge=0, le=1)
    presence_penalty: Optional[float] = Field(default=None, ge=-2, le=2)
    thinking_enabled: Optional[bool] = None
    supports_thinking: Optional[bool] = None
    supports_tools: Optional[bool] = None
    supports_structured_output: Optional[bool] = None
    supports_vision: Optional[bool] = None
    verify_tls: Optional[bool] = None
    extra_options: Optional[dict[str, Any]] = None
    is_active: Optional[bool] = None

    @field_validator("name", "model")
    @classmethod
    def strip_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("value must not be blank")
        return value

    @field_validator("base_url")
    @classmethod
    def validate_optional_base_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        return _normalize_base_url(value)

    @field_validator("extra_options")
    @classmethod
    def validate_optional_extra_options(
        cls, value: Optional[dict[str, Any]]
    ) -> Optional[dict[str, Any]]:
        if value is None:
            return value
        conflicts = sorted(_PROTECTED_REQUEST_OPTIONS.intersection(value))
        if conflicts:
            raise ValueError(
                f"extra_options cannot override protected fields: {', '.join(conflicts)}"
            )
        return value


class LLMProfileResponse(BaseModel):
    profile_id: str
    name: str
    description: Optional[str] = None
    provider: str
    base_url: str
    model: str
    api_key_configured: bool
    timeout_seconds: int
    context_window: int
    max_tokens: int
    temperature: float
    top_p: float
    presence_penalty: float
    thinking_enabled: bool
    supports_thinking: bool
    supports_tools: bool
    supports_structured_output: bool
    supports_vision: bool
    verify_tls: bool
    extra_options: dict[str, Any]
    is_active: bool
    create_time: Optional[datetime] = None
    update_time: Optional[datetime] = None


class LLMProfileTestRequest(BaseModel):
    prompt: str = Field(
        default="한 문장으로 연결 상태를 확인해 주세요.",
        min_length=1,
        max_length=20000,
    )
    thinking_enabled: Optional[bool] = None
    image_url: Optional[str] = Field(
        default=None,
        description="HTTP(S) URL or a data:image/... URL for vision-capable models.",
    )
    max_tokens: Optional[int] = Field(default=None, ge=1, le=8192)

    @field_validator("image_url")
    @classmethod
    def validate_image_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        value = value.strip()
        if value.startswith("data:image/") or value.startswith(("http://", "https://")):
            return value
        raise ValueError("image_url must be an HTTP(S) URL or a data:image/... URL")


class ProbeResult(BaseModel):
    status: Literal["ok", "failed", "not_supported", "skipped"]
    status_code: Optional[int] = None
    detail: Optional[str] = None


class LLMProfileTestResponse(BaseModel):
    success: bool
    profile_id: str
    model: str
    endpoint: str
    latency_ms: int
    health: ProbeResult
    models: ProbeResult
    model_found: Optional[bool] = None
    content: Optional[str] = None
    reasoning_detected: bool = False
    reasoning_length: int = 0
    vision_requested: bool = False
    thinking_enabled: bool
    usage: Optional[dict[str, Any]] = None
    error: Optional[str] = None


class WorkspaceLLMPolicyUpsert(BaseModel):
    purpose: WorkspaceLLMPurpose
    profile_id: str = Field(min_length=1, max_length=100)
    thinking_mode: Literal["inherit", "enabled", "disabled"] = "inherit"
    timeout_seconds: Optional[int] = Field(default=None, ge=1, le=3600)
    max_tokens: Optional[int] = Field(default=None, ge=1, le=131072)
    temperature: Optional[float] = Field(default=None, ge=0, le=2)
    top_p: Optional[float] = Field(default=None, ge=0, le=1)
    presence_penalty: Optional[float] = Field(default=None, ge=-2, le=2)
    response_format: Optional[Literal["json_object"]] = None
    fallback_profile_id: Optional[str] = Field(default=None, max_length=100)
    extra_options: dict[str, Any] = Field(default_factory=dict)

    @field_validator("extra_options")
    @classmethod
    def validate_policy_options(cls, value: dict[str, Any]) -> dict[str, Any]:
        conflicts = sorted(_PROTECTED_REQUEST_OPTIONS.intersection(value))
        if conflicts:
            raise ValueError(
                f"extra_options cannot override protected fields: {', '.join(conflicts)}"
            )
        return value


class WorkspaceLLMPolicyBatchUpsert(BaseModel):
    policies: list[WorkspaceLLMPolicyUpsert] = Field(min_length=1, max_length=6)

    @field_validator("policies")
    @classmethod
    def validate_unique_purposes(
        cls, value: list[WorkspaceLLMPolicyUpsert]
    ) -> list[WorkspaceLLMPolicyUpsert]:
        purposes = [item.purpose for item in value]
        if len(purposes) != len(set(purposes)):
            raise ValueError("Each LLM purpose may appear only once")
        return value


class WorkspaceLLMPolicyResponse(BaseModel):
    workspace_id: str
    purpose: WorkspaceLLMPurpose
    profile_id: str
    profile_name: str
    profile_model: str
    thinking_mode: Literal["inherit", "enabled", "disabled"]
    timeout_seconds: Optional[int] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    presence_penalty: Optional[float] = None
    response_format: Optional[str] = None
    fallback_profile_id: Optional[str] = None
    fallback_profile_name: Optional[str] = None
    extra_options: dict[str, Any]
    update_time: Optional[datetime] = None


def _normalize_base_url(value: str) -> str:
    value = value.strip().rstrip("/")
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("base_url must be a valid HTTP(S) URL")
    suffix = "/chat/completions"
    if value.endswith(suffix):
        value = value[: -len(suffix)].rstrip("/")
    return value


def _fernet() -> Fernet:
    secret = os.getenv("LLM_PROFILE_ENCRYPTION_SECRET") or os.getenv(
        "TOKEN_SECRET", "lightrag-jwt-default-secret"
    )
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_api_key(api_key: Optional[str]) -> Optional[str]:
    if not api_key:
        return None
    return _fernet().encrypt(api_key.encode("utf-8")).decode("ascii")


def decrypt_api_key(encrypted_api_key: Optional[str]) -> Optional[str]:
    if not encrypted_api_key:
        return None
    try:
        return _fernet().decrypt(encrypted_api_key.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError(
            "Stored API key cannot be decrypted. Check LLM_PROFILE_ENCRYPTION_SECRET."
        ) from exc


def build_chat_request(
    profile: dict[str, Any], request: LLMProfileTestRequest
) -> tuple[dict[str, Any], bool]:
    thinking_enabled = (
        request.thinking_enabled
        if request.thinking_enabled is not None
        else bool(profile["thinking_enabled"])
    )
    content: Any = request.prompt
    if request.image_url:
        content = [
            {"type": "text", "text": request.prompt},
            {"type": "image_url", "image_url": {"url": request.image_url}},
        ]

    body: dict[str, Any] = {
        "model": profile["model"],
        "messages": [{"role": "user", "content": content}],
        "max_tokens": request.max_tokens or profile["max_tokens"],
        "temperature": profile["temperature"],
        "top_p": profile["top_p"],
        "presence_penalty": profile["presence_penalty"],
        "stream": False,
    }
    raw_extra_options = profile.get("extra_options") or {}
    if isinstance(raw_extra_options, str):
        raw_extra_options = json.loads(raw_extra_options)
    extra_options = dict(raw_extra_options)
    extra_body = extra_options.pop("extra_body", None)
    if isinstance(extra_body, dict):
        for key, value in extra_body.items():
            if key not in _PROTECTED_REQUEST_OPTIONS:
                body[key] = value
    for key, value in extra_options.items():
        if key not in _PROTECTED_REQUEST_OPTIONS:
            body[key] = value

    if profile.get("supports_thinking"):
        template_options = dict(body.get("chat_template_kwargs") or {})
        template_options["enable_thinking"] = thinking_enabled
        body["chat_template_kwargs"] = template_options
    return body, thinking_enabled


def _profile_from_row(row: dict[str, Any]) -> LLMProfileResponse:
    extra_options = row.get("extra_options") or {}
    if isinstance(extra_options, str):
        extra_options = json.loads(extra_options)
    return LLMProfileResponse(
        profile_id=row["profile_id"],
        name=row["name"],
        description=row.get("description"),
        provider=row["provider"],
        base_url=row["base_url"],
        model=row["model"],
        api_key_configured=bool(row.get("api_key_encrypted")),
        timeout_seconds=row["timeout_seconds"],
        context_window=row["context_window"],
        max_tokens=row["max_tokens"],
        temperature=row["temperature"],
        top_p=row["top_p"],
        presence_penalty=row["presence_penalty"],
        thinking_enabled=row["thinking_enabled"],
        supports_thinking=row["supports_thinking"],
        supports_tools=row["supports_tools"],
        supports_structured_output=row["supports_structured_output"],
        supports_vision=row["supports_vision"],
        verify_tls=row["verify_tls"],
        extra_options=extra_options,
        is_active=row["is_active"],
        create_time=row.get("create_time"),
        update_time=row.get("update_time"),
    )


def _workspace_policy_from_row(
    row: dict[str, Any],
) -> WorkspaceLLMPolicyResponse:
    extra_options = row.get("extra_options") or {}
    if isinstance(extra_options, str):
        extra_options = json.loads(extra_options)
    return WorkspaceLLMPolicyResponse(
        workspace_id=row["workspace_id"],
        purpose=row["purpose"],
        profile_id=row["profile_id"],
        profile_name=row["profile_name"],
        profile_model=row["profile_model"],
        thinking_mode=row["thinking_mode"],
        timeout_seconds=row.get("timeout_seconds"),
        max_tokens=row.get("max_tokens"),
        temperature=row.get("temperature"),
        top_p=row.get("top_p"),
        presence_penalty=row.get("presence_penalty"),
        response_format=row.get("response_format"),
        fallback_profile_id=row.get("fallback_profile_id"),
        fallback_profile_name=row.get("fallback_profile_name"),
        extra_options=extra_options,
        update_time=row.get("update_time"),
    )


def _safe_remote_error(response: httpx.Response) -> str:
    try:
        detail = response.json()
        return json.dumps(detail, ensure_ascii=False)[:1000]
    except Exception:
        return response.text[:1000]


async def _probe_get(
    client: httpx.AsyncClient, url: str, headers: dict[str, str]
) -> tuple[ProbeResult, Optional[dict[str, Any]]]:
    try:
        response = await client.get(url, headers=headers)
        if response.is_success:
            payload = response.json() if response.content else {}
            return ProbeResult(status="ok", status_code=response.status_code), payload
        return (
            ProbeResult(
                status="failed",
                status_code=response.status_code,
                detail=_safe_remote_error(response),
            ),
            None,
        )
    except Exception as exc:
        return ProbeResult(status="failed", detail=str(exc)[:1000]), None


def create_llm_profile_routes(rag, api_key: Optional[str] = None) -> APIRouter:
    """Create LLM profile management routes using the configured PostgreSQL store."""
    combined_auth = get_combined_auth_dependency(api_key)

    async def get_db():
        if hasattr(rag, "llm_response_cache") and hasattr(rag.llm_response_cache, "db"):
            return rag.llm_response_cache.db
        if hasattr(rag, "text_chunks") and hasattr(rag.text_chunks, "db"):
            return rag.text_chunks.db
        return None

    async def require_db():
        db = await get_db()
        if db is None or db.pool is None:
            raise HTTPException(status_code=503, detail="Database not available")
        return db

    async def fetch_profile(profile_id: str, *, include_secret: bool = False):
        db = await require_db()
        columns = "*" if include_secret else "*"
        async with db.pool.acquire() as conn:
            row = await conn.fetchrow(
                f"SELECT {columns} FROM LIGHTRAG_LLM_PROFILES WHERE profile_id=$1",
                profile_id,
            )
        if row is None:
            raise HTTPException(status_code=404, detail="LLM profile not found")
        return dict(row)

    async def fetch_workspace_policies(
        workspace_id: str,
    ) -> list[WorkspaceLLMPolicyResponse]:
        db = await require_db()
        async with db.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT policy.*,
                       profile.name AS profile_name,
                       profile.model AS profile_model,
                       fallback.name AS fallback_profile_name
                FROM LIGHTRAG_WORKSPACE_LLM_POLICIES policy
                JOIN LIGHTRAG_LLM_PROFILES profile
                  ON profile.profile_id = policy.profile_id
                LEFT JOIN LIGHTRAG_LLM_PROFILES fallback
                  ON fallback.profile_id = policy.fallback_profile_id
                WHERE policy.workspace_id=$1
                ORDER BY array_position($2::text[], policy.purpose)
                """,
                workspace_id,
                list(_LLM_PURPOSES),
            )
        return [_workspace_policy_from_row(dict(row)) for row in rows]

    @router.get(
        "",
        response_model=list[LLMProfileResponse],
        dependencies=[Depends(combined_auth)],
        summary="List LLM profiles",
    )
    async def list_profiles():
        db = await require_db()
        async with db.pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM LIGHTRAG_LLM_PROFILES ORDER BY name, profile_id"
            )
        return [_profile_from_row(dict(row)) for row in rows]

    @router.post(
        "",
        response_model=LLMProfileResponse,
        status_code=201,
        dependencies=[Depends(combined_auth)],
        summary="Create an LLM profile",
    )
    async def create_profile(request: LLMProfileCreate):
        db = await require_db()
        profile_id = request.profile_id or f"llm-{uuid4().hex[:12]}"
        values = request.model_dump(exclude={"profile_id", "api_key"})
        encrypted_key = encrypt_api_key(request.api_key)
        async with db.pool.acquire() as conn:
            try:
                row = await conn.fetchrow(
                    """
                    INSERT INTO LIGHTRAG_LLM_PROFILES (
                        profile_id, name, description, provider, base_url, model,
                        api_key_encrypted, timeout_seconds, context_window, max_tokens,
                        temperature, top_p, presence_penalty, thinking_enabled,
                        supports_thinking, supports_tools, supports_structured_output,
                        supports_vision, verify_tls, extra_options, is_active
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb, $21
                    ) RETURNING *
                    """,
                    profile_id,
                    values["name"],
                    values["description"],
                    values["provider"],
                    values["base_url"],
                    values["model"],
                    encrypted_key,
                    values["timeout_seconds"],
                    values["context_window"],
                    values["max_tokens"],
                    values["temperature"],
                    values["top_p"],
                    values["presence_penalty"],
                    values["thinking_enabled"],
                    values["supports_thinking"],
                    values["supports_tools"],
                    values["supports_structured_output"],
                    values["supports_vision"],
                    values["verify_tls"],
                    json.dumps(values["extra_options"], ensure_ascii=False),
                    values["is_active"],
                )
            except Exception as exc:
                if "duplicate key" in str(exc).lower():
                    raise HTTPException(
                        status_code=409, detail="LLM profile ID already exists"
                    ) from exc
                raise
        logger.info("Created LLM profile %s", profile_id)
        return _profile_from_row(dict(row))

    @router.get(
        "/workspaces/{workspace_id}/policies",
        response_model=list[WorkspaceLLMPolicyResponse],
        dependencies=[Depends(combined_auth)],
        summary="List workspace LLM policies",
    )
    async def list_workspace_policies(workspace_id: str):
        return await fetch_workspace_policies(workspace_id)

    @router.put(
        "/workspaces/{workspace_id}/policies",
        response_model=list[WorkspaceLLMPolicyResponse],
        dependencies=[Depends(combined_auth)],
        summary="Apply workspace LLM policies without restarting the server",
    )
    async def upsert_workspace_policies(
        workspace_id: str, request: WorkspaceLLMPolicyBatchUpsert
    ):
        db = await require_db()
        requested_profile_ids = {
            item.profile_id for item in request.policies
        } | {
            item.fallback_profile_id
            for item in request.policies
            if item.fallback_profile_id
        }
        async with db.pool.acquire() as conn:
            workspace_exists = await conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM LIGHTRAG_WORKSPACES WHERE workspace_id=$1)",
                workspace_id,
            )
            if not workspace_exists:
                raise HTTPException(status_code=404, detail="Workspace not found")

            profile_rows = await conn.fetch(
                """
                SELECT profile_id, is_active, supports_thinking, supports_vision
                FROM LIGHTRAG_LLM_PROFILES
                WHERE profile_id = ANY($1::text[])
                """,
                list(requested_profile_ids),
            )
            profiles = {row["profile_id"]: dict(row) for row in profile_rows}
            missing = sorted(requested_profile_ids.difference(profiles))
            if missing:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unknown LLM profile(s): {', '.join(missing)}",
                )

            for item in request.policies:
                profile = profiles[item.profile_id]
                if not profile["is_active"]:
                    raise HTTPException(
                        status_code=409,
                        detail=f"LLM profile is inactive: {item.profile_id}",
                    )
                if item.thinking_mode == "enabled" and not profile["supports_thinking"]:
                    raise HTTPException(
                        status_code=400,
                        detail=f"LLM profile does not support thinking: {item.profile_id}",
                    )
                if item.purpose == "multimodal" and not profile["supports_vision"]:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Multimodal policy requires a vision profile: {item.profile_id}",
                    )
                if item.fallback_profile_id == item.profile_id:
                    raise HTTPException(
                        status_code=400,
                        detail="Primary and fallback profiles must be different",
                    )

            async with conn.transaction():
                for item in request.policies:
                    await conn.execute(
                        """
                        INSERT INTO LIGHTRAG_WORKSPACE_LLM_POLICIES (
                            workspace_id, purpose, profile_id, thinking_mode,
                            timeout_seconds, max_tokens, temperature, top_p,
                            presence_penalty, response_format, fallback_profile_id,
                            extra_options
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb
                        )
                        ON CONFLICT (workspace_id, purpose) DO UPDATE SET
                            profile_id=EXCLUDED.profile_id,
                            thinking_mode=EXCLUDED.thinking_mode,
                            timeout_seconds=EXCLUDED.timeout_seconds,
                            max_tokens=EXCLUDED.max_tokens,
                            temperature=EXCLUDED.temperature,
                            top_p=EXCLUDED.top_p,
                            presence_penalty=EXCLUDED.presence_penalty,
                            response_format=EXCLUDED.response_format,
                            fallback_profile_id=EXCLUDED.fallback_profile_id,
                            extra_options=EXCLUDED.extra_options,
                            update_time=CURRENT_TIMESTAMP
                        """,
                        workspace_id,
                        item.purpose,
                        item.profile_id,
                        item.thinking_mode,
                        item.timeout_seconds,
                        item.max_tokens,
                        item.temperature,
                        item.top_p,
                        item.presence_penalty,
                        item.response_format,
                        item.fallback_profile_id,
                        json.dumps(item.extra_options, ensure_ascii=False),
                    )
                await conn.execute(
                    "DELETE FROM LIGHTRAG_LLM_CACHE WHERE workspace=$1", workspace_id
                )
        logger.info("Updated workspace LLM policies for %s", workspace_id)
        return await fetch_workspace_policies(workspace_id)

    @router.delete(
        "/workspaces/{workspace_id}/policies",
        status_code=204,
        dependencies=[Depends(combined_auth)],
        summary="Reset a workspace to the environment LLM settings",
    )
    async def reset_workspace_policies(workspace_id: str):
        db = await require_db()
        async with db.pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "DELETE FROM LIGHTRAG_WORKSPACE_LLM_POLICIES WHERE workspace_id=$1",
                    workspace_id,
                )
                await conn.execute(
                    "DELETE FROM LIGHTRAG_LLM_CACHE WHERE workspace=$1", workspace_id
                )
        logger.info("Reset workspace LLM policies for %s", workspace_id)

    @router.get(
        "/{profile_id}",
        response_model=LLMProfileResponse,
        dependencies=[Depends(combined_auth)],
        summary="Get an LLM profile",
    )
    async def get_profile(profile_id: str):
        return _profile_from_row(await fetch_profile(profile_id))

    @router.put(
        "/{profile_id}",
        response_model=LLMProfileResponse,
        dependencies=[Depends(combined_auth)],
        summary="Update an LLM profile without restarting the server",
    )
    async def update_profile(profile_id: str, request: LLMProfileUpdate):
        current = await fetch_profile(profile_id, include_secret=True)
        changes = request.model_dump(exclude_unset=True)
        changes.pop("clear_api_key", None)
        if request.clear_api_key:
            changes["api_key_encrypted"] = None
        elif "api_key" in changes:
            changes["api_key_encrypted"] = encrypt_api_key(changes.pop("api_key"))
        else:
            changes.pop("api_key", None)

        allowed = {
            "name",
            "description",
            "provider",
            "base_url",
            "model",
            "api_key_encrypted",
            "timeout_seconds",
            "context_window",
            "max_tokens",
            "temperature",
            "top_p",
            "presence_penalty",
            "thinking_enabled",
            "supports_thinking",
            "supports_tools",
            "supports_structured_output",
            "supports_vision",
            "verify_tls",
            "extra_options",
            "is_active",
        }
        changes = {key: value for key, value in changes.items() if key in allowed}
        if not changes:
            return _profile_from_row(current)

        assignments: list[str] = []
        parameters: list[Any] = []
        for index, (key, value) in enumerate(changes.items(), start=1):
            cast = "::jsonb" if key == "extra_options" else ""
            assignments.append(f"{key}=${index}{cast}")
            parameters.append(
                json.dumps(value, ensure_ascii=False)
                if key == "extra_options"
                else value
            )
        parameters.append(profile_id)
        assignments.append("update_time=CURRENT_TIMESTAMP")
        sql = (
            "UPDATE LIGHTRAG_LLM_PROFILES SET "
            + ", ".join(assignments)
            + f" WHERE profile_id=${len(parameters)} RETURNING *"
        )
        db = await require_db()
        async with db.pool.acquire() as conn:
            row = await conn.fetchrow(sql, *parameters)
        logger.info("Updated LLM profile %s", profile_id)
        return _profile_from_row(dict(row))

    @router.delete(
        "/{profile_id}",
        status_code=204,
        dependencies=[Depends(combined_auth)],
        summary="Delete an unassigned LLM profile",
    )
    async def delete_profile(profile_id: str):
        await fetch_profile(profile_id)
        db = await require_db()
        async with db.pool.acquire() as conn:
            assignment_count = await conn.fetchval(
                """
                SELECT COUNT(*) FROM LIGHTRAG_WORKSPACE_LLM_POLICIES
                WHERE profile_id=$1 OR fallback_profile_id=$1
                """,
                profile_id,
            )
            if assignment_count:
                raise HTTPException(
                    status_code=409,
                    detail="LLM profile is assigned to one or more workspaces",
                )
            await conn.execute(
                "DELETE FROM LIGHTRAG_LLM_PROFILES WHERE profile_id=$1", profile_id
            )
        logger.info("Deleted LLM profile %s", profile_id)

    @router.post(
        "/{profile_id}/test",
        response_model=LLMProfileTestResponse,
        dependencies=[Depends(combined_auth)],
        summary="Test text, thinking, or vision input against an LLM profile",
    )
    async def test_profile(profile_id: str, request: LLMProfileTestRequest):
        profile = await fetch_profile(profile_id, include_secret=True)
        if not profile["is_active"]:
            raise HTTPException(status_code=409, detail="LLM profile is inactive")
        if request.image_url and not profile["supports_vision"]:
            raise HTTPException(
                status_code=400,
                detail="This LLM profile is not marked as vision capable",
            )

        base_url = profile["base_url"].rstrip("/")
        endpoint = f"{base_url}/chat/completions"
        models_url = f"{base_url}/models"
        parsed = urlparse(base_url)
        health_url = f"{parsed.scheme}://{parsed.netloc}/health"
        headers = {"Content-Type": "application/json"}
        api_key_value = decrypt_api_key(profile.get("api_key_encrypted"))
        if api_key_value:
            headers["Authorization"] = f"Bearer {api_key_value}"
        body, thinking_enabled = build_chat_request(profile, request)

        started = time.perf_counter()
        timeout = httpx.Timeout(float(profile["timeout_seconds"]))
        health_result = ProbeResult(status="skipped")
        models_result = ProbeResult(status="skipped")
        model_found: Optional[bool] = None
        try:
            async with httpx.AsyncClient(
                timeout=timeout,
                verify=bool(profile["verify_tls"]),
                follow_redirects=True,
            ) as client:
                health_result, _ = await _probe_get(client, health_url, headers)
                models_result, models_payload = await _probe_get(
                    client, models_url, headers
                )
                if models_payload is not None:
                    model_ids = {
                        item.get("id")
                        for item in models_payload.get("data", [])
                        if isinstance(item, dict)
                    }
                    model_found = profile["model"] in model_ids

                response = await client.post(endpoint, headers=headers, json=body)
                latency_ms = round((time.perf_counter() - started) * 1000)
                if not response.is_success:
                    return LLMProfileTestResponse(
                        success=False,
                        profile_id=profile_id,
                        model=profile["model"],
                        endpoint=endpoint,
                        latency_ms=latency_ms,
                        health=health_result,
                        models=models_result,
                        model_found=model_found,
                        vision_requested=bool(request.image_url),
                        thinking_enabled=thinking_enabled,
                        error=f"HTTP {response.status_code}: {_safe_remote_error(response)}",
                    )

                payload = response.json()
                choices = payload.get("choices") or []
                message = choices[0].get("message", {}) if choices else {}
                content = message.get("content")
                if not isinstance(content, str):
                    content = json.dumps(content, ensure_ascii=False) if content else ""
                reasoning = message.get("reasoning") or message.get("reasoning_content")
                if not isinstance(reasoning, str):
                    reasoning = ""
                return LLMProfileTestResponse(
                    success=True,
                    profile_id=profile_id,
                    model=profile["model"],
                    endpoint=endpoint,
                    latency_ms=latency_ms,
                    health=health_result,
                    models=models_result,
                    model_found=model_found,
                    content=content,
                    reasoning_detected=bool(reasoning),
                    reasoning_length=len(reasoning),
                    vision_requested=bool(request.image_url),
                    thinking_enabled=thinking_enabled,
                    usage=payload.get("usage"),
                )
        except Exception as exc:
            latency_ms = round((time.perf_counter() - started) * 1000)
            logger.warning("LLM profile test failed for %s: %s", profile_id, exc)
            return LLMProfileTestResponse(
                success=False,
                profile_id=profile_id,
                model=profile["model"],
                endpoint=endpoint,
                latency_ms=latency_ms,
                health=health_result,
                models=models_result,
                model_found=model_found,
                vision_requested=bool(request.image_url),
                thinking_enabled=thinking_enabled,
                error=str(exc)[:1000],
            )

    return router
