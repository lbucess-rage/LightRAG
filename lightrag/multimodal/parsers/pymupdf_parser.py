"""
PyMuPDF-based multimodal document parser.

Extracts text, images, and tables from PDF documents using PyMuPDF (fitz).
This is the lightweight/fast parser option that doesn't require GPU or external CLI tools.
"""

import hashlib
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional, Union

logger = logging.getLogger(__name__)


class PyMuPDFMultimodalParser:
    """Parse PDF documents using PyMuPDF, producing content_list format.

    Extracts:
    - Text blocks with page indices
    - Embedded images (saved as PNG files)
    - Basic table detection (from text structure)

    This parser is fast and CPU-only. For deeper multimodal extraction
    (table structure, equations), use DoclingMultimodalParser instead.
    """

    def __init__(
        self,
        output_dir: Optional[str] = None,
        min_image_width: int = 100,
        min_image_height: int = 100,
        max_image_aspect_ratio: float = 10.0,
        enable_duplicate_filtering: bool = True,
    ):
        self.output_dir = output_dir
        self.min_image_width = min_image_width
        self.min_image_height = min_image_height
        self.max_image_aspect_ratio = max_image_aspect_ratio
        self.enable_duplicate_filtering = enable_duplicate_filtering

    @staticmethod
    def check_installation() -> bool:
        """Check if PyMuPDF is available."""
        try:
            import fitz  # noqa: F401
            return True
        except ImportError:
            return False

    def parse_document(
        self,
        file_path: Union[str, Path],
        output_dir: Optional[str] = None,
        password: Optional[str] = None,
        extract_images: bool = True,
        **kwargs,
    ) -> List[Dict[str, Any]]:
        """Parse PDF document into content_list format.

        Args:
            file_path: Path to the PDF file
            output_dir: Directory to save extracted images
            password: Optional password for encrypted PDFs
            extract_images: Whether to extract embedded images

        Returns:
            List of content block dicts
        """
        import fitz

        file_path = Path(file_path)
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        if file_path.suffix.lower() != ".pdf":
            raise ValueError(f"PyMuPDF parser only supports PDF files, got: {file_path.suffix}")

        # Read as bytes to avoid path encoding issues
        file_bytes = file_path.read_bytes()
        doc = fitz.open(stream=file_bytes, filetype="pdf")

        if doc.is_encrypted:
            if not password:
                doc.close()
                raise ValueError("PDF is encrypted but no password provided")
            if not doc.authenticate(password):
                doc.close()
                raise ValueError("Incorrect PDF password")

        # Setup image output directory
        img_output = Path(output_dir or self.output_dir or str(file_path.parent / "pymupdf_output"))
        img_dir = img_output / file_path.stem / "images"
        if extract_images:
            img_dir.mkdir(parents=True, exist_ok=True)

        content_list: List[Dict[str, Any]] = []
        seen_image_hashes: set = set()

        for page_idx, page in enumerate(doc):
            # Extract text blocks
            text = page.get_text("text", sort=True)
            if text and text.strip():
                content_list.append({
                    "type": "text",
                    "text": text.strip(),
                    "page_idx": page_idx,
                })

            # Extract images
            if extract_images:
                image_items = self._extract_page_images(
                    doc, page, page_idx, img_dir, seen_image_hashes
                )
                content_list.extend(image_items)

        page_count = doc.page_count
        doc.close()

        logger.info(
            f"PyMuPDF parsing: {file_path.name} - "
            f"{len(content_list)} blocks from {page_count} pages"
        )

        return content_list

    def _extract_page_images(
        self,
        doc,
        page,
        page_idx: int,
        img_dir: Path,
        seen_hashes: set,
    ) -> List[Dict[str, Any]]:
        """Extract images from a single page."""
        import fitz

        items = []
        image_list = page.get_images(full=True)

        for img_idx, img_info in enumerate(image_list):
            xref = img_info[0]

            try:
                base_image = doc.extract_image(xref)
                if not base_image:
                    continue

                image_bytes = base_image["image"]
                width = base_image.get("width", 0)
                height = base_image.get("height", 0)
                ext = base_image.get("ext", "png")

                # Filter small images
                if width < self.min_image_width or height < self.min_image_height:
                    continue

                # Filter extreme aspect ratios (likely decorative)
                if width > 0 and height > 0:
                    aspect_ratio = max(width / height, height / width)
                    if aspect_ratio > self.max_image_aspect_ratio:
                        continue

                # Filter duplicates
                if self.enable_duplicate_filtering:
                    img_hash = hashlib.md5(image_bytes).hexdigest()
                    if img_hash in seen_hashes:
                        continue
                    seen_hashes.add(img_hash)

                # Save image
                img_filename = f"page{page_idx}_img{img_idx}.{ext}"
                img_path = img_dir / img_filename
                img_path.write_bytes(image_bytes)

                items.append({
                    "type": "image",
                    "img_path": str(img_path.resolve()),
                    "image_caption": [],
                    "image_footnote": [],
                    "page_idx": page_idx,
                    "image_width": width,
                    "image_height": height,
                })

            except Exception as e:
                logger.warning(f"Failed to extract image {img_idx} from page {page_idx}: {e}")

        return items
