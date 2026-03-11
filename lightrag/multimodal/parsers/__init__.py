"""
Document parsers for multimodal content extraction.

Parsers convert documents into content_list format:
[
    {"type": "text", "text": "...", "page_idx": 0},
    {"type": "image", "img_path": "/path/to/img.png", "image_caption": [...], "page_idx": 1},
    {"type": "table", "table_body": "...", "table_caption": [...], "page_idx": 2},
    {"type": "equation", "text": "...", "text_format": "latex", "page_idx": 3},
]
"""

from lightrag.multimodal.parsers.docling_parser import DoclingMultimodalParser
from lightrag.multimodal.parsers.pymupdf_parser import PyMuPDFMultimodalParser

__all__ = [
    "DoclingMultimodalParser",
    "PyMuPDFMultimodalParser",
]
