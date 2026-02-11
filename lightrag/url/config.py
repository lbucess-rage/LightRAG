"""
Configuration for URL knowledge ingestion.
"""

from dataclasses import dataclass, field

from lightrag.utils import get_env_value


@dataclass
class URLIngestConfig:
    """Configuration for URL ingestion pipeline."""

    fetch_timeout: int = field(default=get_env_value("URL_FETCH_TIMEOUT", 30, int))
    """HTTP request timeout in seconds."""

    fetch_max_retries: int = field(
        default=get_env_value("URL_FETCH_MAX_RETRIES", 3, int)
    )
    """Maximum retry attempts for failed fetches."""

    extract_images: bool = field(default=True)
    """Extract and process images from web pages."""

    extract_tables: bool = field(default=True)
    """Extract and process tables from web pages."""

    download_images: bool = field(default=True)
    """Download images for VLM processing."""

    max_image_size_mb: float = field(default=10.0)
    """Maximum image file size in MB to download."""

    min_text_length: int = field(default=50)
    """Minimum text length to consider a page valid."""

    max_images: int = field(default=20)
    """Maximum number of images to extract per page."""

    max_tables: int = field(default=10)
    """Maximum number of tables to extract per page."""

    max_text_chunk_size: int = field(
        default=get_env_value("URL_MAX_TEXT_CHUNK_SIZE", 2000, int)
    )
    """Maximum text chunk size for splitting long content before ainsert()."""

    max_crawl_depth: int = field(
        default=get_env_value("URL_MAX_CRAWL_DEPTH", 2, int)
    )
    """Maximum depth for sub-URL crawling (0 = no crawling)."""

    max_crawl_urls: int = field(
        default=get_env_value("URL_MAX_CRAWL_URLS", 10, int)
    )
    """Maximum number of sub-URLs to crawl per page."""

    crawl_same_domain_only: bool = field(default=True)
    """Only follow links within the same domain."""
