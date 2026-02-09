"""
Context extraction for multimodal content processing.

Extracts surrounding text context for modal items (images, tables, equations)
to provide better analysis through VLM/LLM.
"""

from dataclasses import dataclass, field
from typing import Dict, Any, List

from lightrag.utils import logger


@dataclass
class ContextConfig:
    """Configuration for context extraction"""

    context_window: int = 1
    context_mode: str = "page"  # "page" or "chunk"
    max_context_tokens: int = 2000
    include_headers: bool = True
    include_captions: bool = True
    filter_content_types: List[str] = field(default_factory=lambda: ["text"])


class ContextExtractor:
    """Universal context extractor supporting multiple content source formats.

    Extracts surrounding text from a content_list (MinerU/Docling format)
    to provide context for multimodal item analysis.
    """

    def __init__(self, config: ContextConfig = None, tokenizer=None):
        self.config = config or ContextConfig()
        self.tokenizer = tokenizer

    def extract_context(
        self,
        content_source: Any,
        current_item_info: Dict[str, Any],
        content_format: str = "auto",
    ) -> str:
        """Extract context for current item from content source.

        Args:
            content_source: Source content (list, dict, or string)
            current_item_info: Info about current item (page_idx, index, etc.)
            content_format: Format hint ("minerU", "text_chunks", "text", "auto")

        Returns:
            Extracted context text
        """
        if not content_source and not self.config.context_window:
            return ""

        try:
            if content_format == "minerU" and isinstance(content_source, list):
                return self._extract_from_content_list(content_source, current_item_info)
            elif content_format == "text_chunks" and isinstance(content_source, list):
                return self._extract_from_text_chunks(content_source, current_item_info)
            elif content_format == "text" and isinstance(content_source, str):
                return self._extract_from_text_source(content_source, current_item_info)
            else:
                # Auto-detect
                if isinstance(content_source, list):
                    return self._extract_from_content_list(content_source, current_item_info)
                elif isinstance(content_source, dict):
                    return self._extract_from_dict_source(content_source, current_item_info)
                elif isinstance(content_source, str):
                    return self._extract_from_text_source(content_source, current_item_info)
                else:
                    logger.warning(f"Unsupported content source type: {type(content_source)}")
                    return ""
        except Exception as e:
            logger.error(f"Error extracting context: {e}")
            return ""

    def _extract_from_content_list(
        self, content_list: List[Dict], current_item_info: Dict
    ) -> str:
        if self.config.context_mode == "chunk":
            return self._extract_chunk_context(content_list, current_item_info)
        return self._extract_page_context(content_list, current_item_info)

    def _extract_page_context(
        self, content_list: List[Dict], current_item_info: Dict
    ) -> str:
        current_page = current_item_info.get("page_idx", 0)
        window = self.config.context_window
        start_page = max(0, current_page - window)
        end_page = current_page + window + 1

        context_texts = []
        for item in content_list:
            item_page = item.get("page_idx", 0)
            item_type = item.get("type", "")

            if start_page <= item_page < end_page and item_type in self.config.filter_content_types:
                text = self._extract_text_from_item(item)
                if text and text.strip():
                    if item_page != current_page:
                        context_texts.append(f"[Page {item_page}] {text}")
                    else:
                        context_texts.append(text)

        return self._truncate_context("\n".join(context_texts))

    def _extract_chunk_context(
        self, content_list: List[Dict], current_item_info: Dict
    ) -> str:
        current_index = current_item_info.get("index", 0)
        window = self.config.context_window
        start_idx = max(0, current_index - window)
        end_idx = min(len(content_list), current_index + window + 1)

        context_texts = []
        for i in range(start_idx, end_idx):
            if i != current_index:
                item = content_list[i]
                if item.get("type", "") in self.config.filter_content_types:
                    text = self._extract_text_from_item(item)
                    if text and text.strip():
                        context_texts.append(text)

        return self._truncate_context("\n".join(context_texts))

    def _extract_text_from_item(self, item: Dict) -> str:
        item_type = item.get("type", "")

        if item_type == "text":
            text = item.get("text", "")
            text_level = item.get("text_level", 0)
            if self.config.include_headers and text_level > 0:
                return f"{'#' * text_level} {text}"
            return text

        elif item_type == "image" and self.config.include_captions:
            captions = item.get("image_caption", item.get("img_caption", []))
            if captions:
                return f"[Image: {', '.join(captions)}]"

        elif item_type == "table" and self.config.include_captions:
            captions = item.get("table_caption", [])
            if captions:
                return f"[Table: {', '.join(captions)}]"

        return ""

    def _extract_from_dict_source(self, dict_source: Dict, current_item_info: Dict) -> str:
        if "content" in dict_source:
            context = str(dict_source["content"])
        elif "text" in dict_source:
            context = str(dict_source["text"])
        else:
            text_parts = [str(v) for v in dict_source.values() if isinstance(v, str)]
            context = "\n".join(text_parts)
        return self._truncate_context(context)

    def _extract_from_text_source(self, text_source: str, current_item_info: Dict) -> str:
        return self._truncate_context(text_source)

    def _extract_from_text_chunks(self, text_chunks: List[str], current_item_info: Dict) -> str:
        current_index = current_item_info.get("index", 0)
        window = self.config.context_window
        start_idx = max(0, current_index - window)
        end_idx = min(len(text_chunks), current_index + window + 1)

        context_texts = []
        for i in range(start_idx, end_idx):
            if i != current_index and i < len(text_chunks):
                chunk_text = str(text_chunks[i]).strip()
                if chunk_text:
                    context_texts.append(chunk_text)

        return self._truncate_context("\n".join(context_texts))

    def _truncate_context(self, context: str) -> str:
        if not context:
            return ""

        if self.tokenizer:
            tokens = self.tokenizer.encode(context)
            if len(tokens) <= self.config.max_context_tokens:
                return context

            truncated_tokens = tokens[: self.config.max_context_tokens]
            truncated_text = self.tokenizer.decode(truncated_tokens)

            last_period = truncated_text.rfind(".")
            last_newline = truncated_text.rfind("\n")

            if last_period > len(truncated_text) * 0.8:
                return truncated_text[: last_period + 1]
            elif last_newline > len(truncated_text) * 0.8:
                return truncated_text[:last_newline]
            return truncated_text + "..."
        else:
            if len(context) <= self.config.max_context_tokens:
                return context

            truncated = context[: self.config.max_context_tokens]
            last_period = truncated.rfind(".")
            last_newline = truncated.rfind("\n")

            if last_period > len(truncated) * 0.8:
                return truncated[: last_period + 1]
            elif last_newline > len(truncated) * 0.8:
                return truncated[:last_newline]
            return truncated + "..."
