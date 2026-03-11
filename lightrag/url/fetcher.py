"""
Async web content fetcher using httpx.
"""

import asyncio
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

import httpx

from lightrag.utils import logger


@dataclass
class FetchResult:
    """Result of fetching URL content."""

    success: bool
    url: str
    content: str = ""
    content_type: str = ""
    status_code: int = 0
    error_message: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


class WebFetcher:
    """Async HTTP fetcher with retry and exponential backoff."""

    DEFAULT_HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate",
    }

    def __init__(
        self,
        timeout: int = 30,
        max_retries: int = 3,
        headers: Optional[Dict[str, str]] = None,
        follow_redirects: bool = True,
    ):
        self.timeout = timeout
        self.max_retries = max_retries
        self.headers = {**self.DEFAULT_HEADERS, **(headers or {})}
        self.follow_redirects = follow_redirects

    async def fetch(self, url: str) -> FetchResult:
        """Fetch content from URL with retry logic."""
        last_error = None

        for attempt in range(self.max_retries):
            try:
                async with httpx.AsyncClient(
                    timeout=self.timeout,
                    follow_redirects=self.follow_redirects,
                    headers=self.headers,
                ) as client:
                    response = await client.get(url)
                    content_type = response.headers.get("content-type", "")

                    if response.status_code == 200:
                        return FetchResult(
                            success=True,
                            url=url,
                            content=response.text,
                            content_type=content_type,
                            status_code=response.status_code,
                            metadata={
                                "final_url": str(response.url),
                                "headers": dict(response.headers),
                            },
                        )
                    else:
                        return FetchResult(
                            success=False,
                            url=url,
                            status_code=response.status_code,
                            error_message=f"HTTP {response.status_code}",
                        )

            except httpx.TimeoutException as e:
                last_error = f"Timeout: {e}"
                logger.warning(
                    f"Timeout fetching {url} (attempt {attempt + 1}/{self.max_retries})"
                )
            except httpx.RequestError as e:
                last_error = f"Request error: {e}"
                logger.warning(
                    f"Request error fetching {url}: {e} (attempt {attempt + 1}/{self.max_retries})"
                )
            except Exception as e:
                last_error = f"Unexpected error: {e}"
                logger.error(f"Unexpected error fetching {url}: {e}")
                break

            if attempt < self.max_retries - 1:
                await asyncio.sleep(2**attempt)

        return FetchResult(
            success=False,
            url=url,
            error_message=last_error or "Unknown error",
        )

    async def fetch_bytes(self, url: str) -> tuple[bool, bytes, str]:
        """Fetch raw bytes from URL (for images). Returns (success, data, error)."""
        try:
            async with httpx.AsyncClient(
                timeout=self.timeout,
                follow_redirects=self.follow_redirects,
                headers=self.headers,
            ) as client:
                response = await client.get(url)
                if response.status_code == 200:
                    return True, response.content, ""
                return False, b"", f"HTTP {response.status_code}"
        except Exception as e:
            return False, b"", str(e)
