"""Resolve and invoke workspace-specific OpenAI-compatible LLM profiles."""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal

from lightrag.llm.openai import openai_complete_if_cache
from lightrag.types import GPTKeywordExtractionFormat
from lightrag.utils import logger

from .routers.llm_profile_routes import decrypt_api_key


LLM_PURPOSES = (
    "knowledge_ingestion",
    "knowledge_structure",
    "schema_design",
    "search_answer",
    "faq_selection",
    "multimodal",
)
LLMPurpose = Literal[
    "knowledge_ingestion",
    "knowledge_structure",
    "schema_design",
    "search_answer",
    "faq_selection",
    "multimodal",
]

_PROTECTED_OPTIONS = {
    "api_key",
    "base_url",
    "messages",
    "model",
    "stream",
}


def _json_object(value: Any) -> dict[str, Any]:
    if not value:
        return {}
    if isinstance(value, str):
        value = json.loads(value)
    return dict(value) if isinstance(value, dict) else {}


@dataclass(slots=True)
class ResolvedLLMPolicy:
    workspace_id: str
    purpose: str
    profile: dict[str, Any]
    fallback_profile: dict[str, Any] | None
    thinking_mode: str
    timeout_seconds: int | None
    max_tokens: int | None
    temperature: float | None
    top_p: float | None
    presence_penalty: float | None
    response_format: str | None
    extra_options: dict[str, Any]


class WorkspaceLLMRouter:
    """Route each LLM call using the current workspace policy from PostgreSQL."""

    def __init__(
        self,
        default_llm_func: Callable[..., Awaitable[Any]],
        db_getter: Callable[[], Awaitable[Any]],
    ) -> None:
        self._default_llm_func = default_llm_func
        self._db_getter = db_getter

    def for_workspace(self, workspace_id: str) -> Callable[..., Awaitable[Any]]:
        workspace_id = workspace_id or "base"

        async def routed_llm_func(
            prompt: Any,
            system_prompt: str | None = None,
            history_messages: list[dict[str, Any]] | None = None,
            keyword_extraction: bool = False,
            **kwargs: Any,
        ) -> Any:
            purpose = kwargs.pop("_llm_purpose", "search_answer")
            if purpose not in LLM_PURPOSES:
                logger.warning(
                    "Unknown LLM purpose %s for workspace %s; using search_answer",
                    purpose,
                    workspace_id,
                )
                purpose = "search_answer"

            policy = await self.resolve(workspace_id, purpose)
            if policy is None:
                return await self._default_llm_func(
                    prompt,
                    system_prompt=system_prompt,
                    history_messages=history_messages,
                    keyword_extraction=keyword_extraction,
                    **kwargs,
                )

            try:
                return await self._invoke_profile(
                    policy.profile,
                    policy,
                    prompt,
                    system_prompt,
                    history_messages,
                    keyword_extraction,
                    kwargs,
                )
            except Exception:
                if policy.fallback_profile is None:
                    raise
                logger.exception(
                    "Primary LLM profile %s failed for workspace %s purpose %s; retrying with %s",
                    policy.profile["profile_id"],
                    workspace_id,
                    purpose,
                    policy.fallback_profile["profile_id"],
                )
                return await self._invoke_profile(
                    policy.fallback_profile,
                    policy,
                    prompt,
                    system_prompt,
                    history_messages,
                    keyword_extraction,
                    kwargs,
                )

        routed_llm_func.__name__ = f"workspace_llm_{workspace_id}"
        return routed_llm_func

    async def resolve(
        self, workspace_id: str, purpose: str
    ) -> ResolvedLLMPolicy | None:
        db = await self._db_getter()
        if db is None or db.pool is None:
            return None

        async with db.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT policy.*,
                       profile.name AS profile_name,
                       profile.provider AS profile_provider,
                       profile.base_url AS profile_base_url,
                       profile.model AS profile_model,
                       profile.api_key_encrypted AS profile_api_key_encrypted,
                       profile.timeout_seconds AS profile_timeout_seconds,
                       profile.max_tokens AS profile_max_tokens,
                       profile.temperature AS profile_temperature,
                       profile.top_p AS profile_top_p,
                       profile.presence_penalty AS profile_presence_penalty,
                       profile.thinking_enabled AS profile_thinking_enabled,
                       profile.supports_thinking AS profile_supports_thinking,
                       profile.supports_vision AS profile_supports_vision,
                       profile.verify_tls AS profile_verify_tls,
                       profile.extra_options AS profile_extra_options,
                       fallback.name AS fallback_name,
                       fallback.provider AS fallback_provider,
                       fallback.base_url AS fallback_base_url,
                       fallback.model AS fallback_model,
                       fallback.api_key_encrypted AS fallback_api_key_encrypted,
                       fallback.timeout_seconds AS fallback_timeout_seconds,
                       fallback.max_tokens AS fallback_max_tokens,
                       fallback.temperature AS fallback_temperature,
                       fallback.top_p AS fallback_top_p,
                       fallback.presence_penalty AS fallback_presence_penalty,
                       fallback.thinking_enabled AS fallback_thinking_enabled,
                       fallback.supports_thinking AS fallback_supports_thinking,
                       fallback.supports_vision AS fallback_supports_vision,
                       fallback.verify_tls AS fallback_verify_tls,
                       fallback.extra_options AS fallback_extra_options
                FROM LIGHTRAG_WORKSPACE_LLM_POLICIES policy
                JOIN LIGHTRAG_LLM_PROFILES profile
                  ON profile.profile_id = policy.profile_id AND profile.is_active = TRUE
                LEFT JOIN LIGHTRAG_LLM_PROFILES fallback
                  ON fallback.profile_id = policy.fallback_profile_id
                 AND fallback.is_active = TRUE
                WHERE policy.workspace_id=$1 AND policy.purpose=$2
                """,
                workspace_id,
                purpose,
            )
        if row is None:
            return None

        values = dict(row)
        profile = self._profile_from_join(values, "profile")
        fallback_profile = (
            self._profile_from_join(values, "fallback")
            if values.get("fallback_model")
            else None
        )
        return ResolvedLLMPolicy(
            workspace_id=workspace_id,
            purpose=purpose,
            profile=profile,
            fallback_profile=fallback_profile,
            thinking_mode=values["thinking_mode"],
            timeout_seconds=values.get("timeout_seconds"),
            max_tokens=values.get("max_tokens"),
            temperature=values.get("temperature"),
            top_p=values.get("top_p"),
            presence_penalty=values.get("presence_penalty"),
            response_format=values.get("response_format"),
            extra_options=_json_object(values.get("extra_options")),
        )

    @staticmethod
    def _profile_from_join(values: dict[str, Any], prefix: str) -> dict[str, Any]:
        return {
            "profile_id": values[f"{prefix}_id"]
            if f"{prefix}_id" in values
            else values.get("profile_id")
            if prefix == "profile"
            else values.get("fallback_profile_id"),
            "name": values.get(f"{prefix}_name"),
            "provider": values.get(f"{prefix}_provider"),
            "base_url": values.get(f"{prefix}_base_url"),
            "model": values.get(f"{prefix}_model"),
            "api_key_encrypted": values.get(f"{prefix}_api_key_encrypted"),
            "timeout_seconds": values.get(f"{prefix}_timeout_seconds"),
            "max_tokens": values.get(f"{prefix}_max_tokens"),
            "temperature": values.get(f"{prefix}_temperature"),
            "top_p": values.get(f"{prefix}_top_p"),
            "presence_penalty": values.get(f"{prefix}_presence_penalty"),
            "thinking_enabled": values.get(f"{prefix}_thinking_enabled"),
            "supports_thinking": values.get(f"{prefix}_supports_thinking"),
            "supports_vision": values.get(f"{prefix}_supports_vision"),
            "verify_tls": values.get(f"{prefix}_verify_tls"),
            "extra_options": _json_object(values.get(f"{prefix}_extra_options")),
        }

    async def _invoke_profile(
        self,
        profile: dict[str, Any],
        policy: ResolvedLLMPolicy,
        prompt: Any,
        system_prompt: str | None,
        history_messages: list[dict[str, Any]] | None,
        keyword_extraction: bool,
        call_options: dict[str, Any],
    ) -> Any:
        options: dict[str, Any] = {}
        options.update(
            {
                key: value
                for key, value in profile["extra_options"].items()
                if key not in _PROTECTED_OPTIONS
            }
        )
        options.update(
            {
                key: value
                for key, value in policy.extra_options.items()
                if key not in _PROTECTED_OPTIONS
            }
        )
        options.update(call_options)
        thinking_override = options.pop("_llm_thinking_override", None)

        image_data = options.pop("image_data", None)
        if image_data is not None:
            if not profile["supports_vision"]:
                raise RuntimeError(
                    f"LLM profile {profile['profile_id']} does not support vision input"
                )
            images = image_data if isinstance(image_data, list) else [image_data]
            user_content: list[dict[str, Any]] = [
                {"type": "text", "text": str(prompt)}
            ]
            for image in images:
                image_url = str(image)
                if not image_url.startswith(("data:image/", "http://", "https://")):
                    image_url = f"data:image/png;base64,{image_url}"
                user_content.append(
                    {"type": "image_url", "image_url": {"url": image_url}}
                )
            messages: list[dict[str, Any]] = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.extend(history_messages or [])
            messages.append({"role": "user", "content": user_content})
            options["messages"] = messages

        for key, profile_value, policy_value in (
            ("timeout", profile["timeout_seconds"], policy.timeout_seconds),
            ("max_tokens", profile["max_tokens"], policy.max_tokens),
            ("temperature", profile["temperature"], policy.temperature),
            ("top_p", profile["top_p"], policy.top_p),
            (
                "presence_penalty",
                profile["presence_penalty"],
                policy.presence_penalty,
            ),
        ):
            if key not in options or options[key] is None:
                options[key] = policy_value if policy_value is not None else profile_value

        if keyword_extraction:
            options["response_format"] = GPTKeywordExtractionFormat
        elif policy.response_format == "json_object" and "response_format" not in options:
            options["response_format"] = {"type": "json_object"}

        if profile["supports_thinking"]:
            if isinstance(thinking_override, bool):
                thinking_enabled = thinking_override
            elif policy.thinking_mode == "enabled":
                thinking_enabled = True
            elif policy.thinking_mode == "disabled":
                thinking_enabled = False
            else:
                thinking_enabled = bool(profile["thinking_enabled"])
            extra_body = dict(options.get("extra_body") or {})
            template_options = dict(extra_body.get("chat_template_kwargs") or {})
            template_options["enable_thinking"] = thinking_enabled
            extra_body["chat_template_kwargs"] = template_options
            options["extra_body"] = extra_body

        logger.info(
            "Routing LLM call workspace=%s purpose=%s profile=%s model=%s thinking=%s",
            policy.workspace_id,
            policy.purpose,
            profile["profile_id"],
            profile["model"],
            options.get("extra_body", {})
            .get("chat_template_kwargs", {})
            .get("enable_thinking"),
        )
        return await openai_complete_if_cache(
            profile["model"],
            prompt,
            system_prompt=system_prompt,
            history_messages=history_messages or [],
            base_url=profile["base_url"],
            api_key=decrypt_api_key(profile.get("api_key_encrypted")) or "dummy",
            keyword_extraction=keyword_extraction,
            verify_tls=bool(profile["verify_tls"]),
            **options,
        )
