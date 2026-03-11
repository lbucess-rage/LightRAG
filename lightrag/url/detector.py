"""
URL detection, validation, and normalization.
"""

import re
from dataclasses import dataclass
from typing import List, Optional
from urllib.parse import urljoin, urlparse, urlunparse

from lightrag.utils import logger


@dataclass
class URLInfo:
    """URL information container."""

    url: str
    normalized_url: str
    scheme: str
    netloc: str
    path: str
    is_valid: bool
    domain: str


class URLDetector:
    """URL validation, extraction, and normalization."""

    URL_PATTERN = re.compile(
        r"https?://"
        r"(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,6}\.?|"
        r"localhost|"
        r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})"
        r"(?::\d+)?"
        r"(?:/?|[/?]\S+)",
        re.IGNORECASE,
    )

    EXCLUDED_EXTENSIONS = {
        ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
        ".zip", ".rar", ".7z", ".tar", ".gz",
        ".mp3", ".mp4", ".avi", ".mov", ".wmv",
        ".exe", ".dmg", ".apk",
    }

    def __init__(
        self,
        allowed_schemes: Optional[List[str]] = None,
        exclude_extensions: bool = True,
    ):
        self.allowed_schemes = allowed_schemes or ["http", "https"]
        self.exclude_extensions = exclude_extensions

    def is_valid(self, url: str) -> bool:
        if not url or not isinstance(url, str):
            return False
        try:
            parsed = urlparse(url.strip())
            if parsed.scheme.lower() not in self.allowed_schemes:
                return False
            if not parsed.netloc:
                return False
            if self.exclude_extensions:
                path_lower = parsed.path.lower()
                for ext in self.EXCLUDED_EXTENSIONS:
                    if path_lower.endswith(ext):
                        return False
            return True
        except Exception as e:
            logger.debug(f"URL validation error for '{url}': {e}")
            return False

    def extract(self, text: str) -> List[str]:
        """Extract valid URLs from text."""
        if not text:
            return []
        matches = self.URL_PATTERN.findall(text)
        seen = set()
        valid_urls = []
        for url in matches:
            normalized = self.normalize(url)
            if normalized and normalized not in seen:
                if self.is_valid(normalized):
                    valid_urls.append(normalized)
                    seen.add(normalized)
        return valid_urls

    def normalize(self, url: str) -> Optional[str]:
        """Normalize URL for consistent storage and deduplication."""
        if not url:
            return None
        try:
            url = url.strip()
            parsed = urlparse(url)
            scheme = parsed.scheme.lower()
            netloc = parsed.netloc.lower()
            path = parsed.path
            if path and path != "/" and path.endswith("/"):
                path = path.rstrip("/")
            if not path:
                path = "/"
            return urlunparse((scheme, netloc, path, parsed.params, parsed.query, ""))
        except Exception as e:
            logger.debug(f"URL normalization error for '{url}': {e}")
            return None

    def get_info(self, url: str) -> URLInfo:
        """Get detailed URL information."""
        normalized = self.normalize(url) or url
        is_valid = self.is_valid(url)
        try:
            parsed = urlparse(normalized)
            domain = parsed.netloc.split(":")[0]
            if domain.startswith("www."):
                domain = domain[4:]
            return URLInfo(
                url=url,
                normalized_url=normalized,
                scheme=parsed.scheme,
                netloc=parsed.netloc,
                path=parsed.path,
                is_valid=is_valid,
                domain=domain,
            )
        except Exception:
            return URLInfo(
                url=url, normalized_url=normalized,
                scheme="", netloc="", path="",
                is_valid=False, domain="",
            )

    def resolve_relative(self, base_url: str, relative_url: str) -> str:
        """Resolve relative URL to absolute URL."""
        return urljoin(base_url, relative_url)

    def is_same_domain(self, url1: str, url2: str) -> bool:
        """Check if two URLs are from the same domain."""
        info1 = self.get_info(url1)
        info2 = self.get_info(url2)
        return info1.domain == info2.domain
