"""
PDF page renderer for VLM fallback processing.

Renders PDF pages to PNG images (base64-encoded) for VLM analysis
when text extraction produces garbled results.
"""

import base64
from pathlib import Path

from lightrag.utils import logger


def render_page_to_base64(pdf_path: str, page_idx: int, dpi: int = 200) -> str:
    """Render a specific PDF page to a base64-encoded PNG image.

    Args:
        pdf_path: Path to the PDF file
        page_idx: Zero-based page index
        dpi: Resolution for rendering (default: 200, good balance for VLM analysis)

    Returns:
        Base64-encoded PNG string, or empty string on failure
    """
    try:
        import fitz  # PyMuPDF

        pdf_path = str(pdf_path)
        if not Path(pdf_path).exists():
            logger.warning(f"PDF file not found: {pdf_path}")
            return ""

        doc = fitz.open(pdf_path)
        if page_idx < 0 or page_idx >= len(doc):
            logger.warning(f"Page index {page_idx} out of range (total: {len(doc)})")
            doc.close()
            return ""

        page = doc[page_idx]
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        png_bytes = pix.tobytes("png")
        doc.close()

        return base64.b64encode(png_bytes).decode("utf-8")

    except ImportError:
        logger.error("PyMuPDF (fitz) not installed, cannot render PDF pages")
        return ""
    except Exception as e:
        logger.error(f"Failed to render page {page_idx} from {pdf_path}: {e}")
        return ""
