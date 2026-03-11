"""
LightRAG URL Knowledge Ingestion Module

Extracts web content from URLs and converts it into knowledge graph data.

Components:
- URLDetector: URL validation, normalization, and extraction
- WebFetcher: Async HTTP fetcher with retry logic
- HTMLParser: HTML content parser (text, images, tables)
- URLIngestConfig: Configuration with environment variable support
"""

from lightrag.url.detector import URLDetector, URLInfo
from lightrag.url.fetcher import WebFetcher, FetchResult
from lightrag.url.parser import HTMLParser, ParsedContent, ExtractedImage, ExtractedTable
from lightrag.url.config import URLIngestConfig

__all__ = [
    "URLDetector",
    "URLInfo",
    "WebFetcher",
    "FetchResult",
    "HTMLParser",
    "ParsedContent",
    "ExtractedImage",
    "ExtractedTable",
    "URLIngestConfig",
]
