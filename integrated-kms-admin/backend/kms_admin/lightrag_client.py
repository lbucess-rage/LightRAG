from __future__ import annotations

import json
from typing import Any, AsyncIterator

import httpx

from .config import settings


def http_error_detail(exc: httpx.HTTPStatusError) -> Any:
    try:
        payload = exc.response.json()
    except ValueError:
        return exc.response.text or exc.response.reason_phrase
    if isinstance(payload, dict):
        return payload.get("detail", payload)
    return payload


class LightRAGClient:
    def __init__(self) -> None:
        self.base_url = settings.lightrag_base_url.rstrip("/")

    def _headers(self, workspace: str | None = None, *, json_content: bool = True) -> dict[str, str]:
        headers: dict[str, str] = {}
        if json_content:
            headers["Content-Type"] = "application/json"
        if workspace:
            headers["LIGHTRAG-WORKSPACE"] = workspace
        if settings.lightrag_api_key:
            headers["X-API-Key"] = settings.lightrag_api_key
        if settings.lightrag_bearer_token:
            headers["Authorization"] = f"Bearer {settings.lightrag_bearer_token}"
        return headers

    async def request_json(
        self,
        method: str,
        path: str,
        *,
        workspace: str | None = None,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        timeout: float = 120.0,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(
                method,
                f"{self.base_url}{path}",
                headers=self._headers(workspace),
                params=params,
                json=json_body,
            )
            response.raise_for_status()
            if not response.content:
                return {}
            return response.json()

    async def request_form(
        self,
        method: str,
        path: str,
        *,
        workspace: str | None = None,
        data: dict[str, Any] | None = None,
        files: dict[str, tuple[str, Any, str | None]] | None = None,
        timeout: float = 120.0,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(
                method,
                f"{self.base_url}{path}",
                headers=self._headers(workspace, json_content=False),
                data=data,
                files=files,
            )
            response.raise_for_status()
            if not response.content:
                return {}
            return response.json()

    async def request_bytes(
        self,
        method: str,
        path: str,
        *,
        workspace: str | None = None,
        timeout: float = 120.0,
    ) -> tuple[bytes, str, str | None]:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.request(
                method,
                f"{self.base_url}{path}",
                headers=self._headers(workspace, json_content=False),
            )
            response.raise_for_status()
            return (
                response.content,
                response.headers.get("content-type", "application/octet-stream"),
                response.headers.get("content-disposition"),
            )

    async def stream_ndjson(
        self,
        path: str,
        *,
        workspace: str,
        json_body: dict[str, Any],
        timeout: float = 120.0,
    ) -> AsyncIterator[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}{path}",
                headers=self._headers(workspace),
                json=json_body,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    yield json.loads(line)

    async def stream_get_ndjson(
        self,
        path: str,
        *,
        workspace: str,
        timeout: float = 120.0,
    ) -> AsyncIterator[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "GET",
                f"{self.base_url}{path}",
                headers=self._headers(workspace),
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    yield json.loads(line)


lightrag_client = LightRAGClient()
