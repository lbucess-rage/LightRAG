"""
Configuration for multimodal content processing
"""

from dataclasses import dataclass, field
from typing import List
from lightrag.utils import get_env_value


@dataclass
class MultimodalConfig:
    """Configuration for multimodal processing within LightRAG"""

    # VLM Configuration
    vlm_model: str = field(default=get_env_value("VLM_MODEL", "", str))
    """VLM model name (e.g., 'qwen3-vl-8b')."""

    vlm_api_base: str = field(default=get_env_value("VLM_API_BASE", "", str))
    """VLM API base URL (e.g., 'http://10.62.130.84:18006/v1')."""

    vlm_api_key: str = field(default=get_env_value("VLM_API_KEY", "not-needed", str))
    """VLM API key (default: 'not-needed' for local models)."""

    vlm_response_language: str = field(
        default=get_env_value("VLM_RESPONSE_LANGUAGE", "Korean", str)
    )
    """Language for VLM/LLM responses in multimodal analysis."""

    # Processing Toggles
    enable_image_processing: bool = field(
        default=get_env_value("ENABLE_IMAGE_PROCESSING", True, bool)
    )
    """Enable image content processing via VLM."""

    enable_table_processing: bool = field(
        default=get_env_value("ENABLE_TABLE_PROCESSING", True, bool)
    )
    """Enable table content processing via LLM."""

    enable_equation_processing: bool = field(
        default=get_env_value("ENABLE_EQUATION_PROCESSING", True, bool)
    )
    """Enable equation content processing via LLM."""

    # Concurrency
    max_parallel_multimodal: int = field(
        default=get_env_value("MAX_PARALLEL_MULTIMODAL", 4, int)
    )
    """Maximum concurrent VLM/LLM calls for multimodal processing."""

    # Image Filtering
    min_image_width: int = field(default=get_env_value("MIN_IMAGE_WIDTH", 100, int))
    """Minimum image width in pixels. Smaller images are skipped."""

    min_image_height: int = field(default=get_env_value("MIN_IMAGE_HEIGHT", 100, int))
    """Minimum image height in pixels. Smaller images are skipped."""

    max_image_aspect_ratio: float = field(
        default=get_env_value("MAX_IMAGE_ASPECT_RATIO", 10.0, float)
    )
    """Maximum aspect ratio. Images exceeding this are likely decorative and skipped."""

    enable_duplicate_filtering: bool = field(
        default=get_env_value("ENABLE_DUPLICATE_FILTERING", True, bool)
    )
    """Enable hash-based duplicate image filtering."""

    # Context Extraction
    context_window: int = field(default=get_env_value("CONTEXT_WINDOW", 1, int))
    """Number of pages/chunks to include before and after current item."""

    context_mode: str = field(default=get_env_value("CONTEXT_MODE", "page", str))
    """Context extraction mode: 'page' or 'chunk'."""

    max_context_tokens: int = field(
        default=get_env_value("MAX_CONTEXT_TOKENS", 2000, int)
    )
    """Maximum tokens in extracted context."""

    include_headers: bool = field(default=get_env_value("INCLUDE_HEADERS", True, bool))
    """Include document headers/titles in context."""

    include_captions: bool = field(
        default=get_env_value("INCLUDE_CAPTIONS", True, bool)
    )
    """Include image/table captions in context."""

    context_filter_content_types: List[str] = field(
        default_factory=lambda: get_env_value(
            "CONTEXT_FILTER_CONTENT_TYPES", "text", str
        ).split(",")
    )
    """Content types to include in context extraction."""

    content_format: str = field(
        default=get_env_value("CONTENT_FORMAT", "auto", str)
    )
    """Default content format for context extraction."""
