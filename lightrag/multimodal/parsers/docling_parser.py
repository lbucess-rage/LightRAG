"""
Docling-based multimodal document parser.

Uses Docling Python API (DocumentConverter) for structured extraction of
text, images, tables, and equations from documents (PDF, Office, HTML).
"""

import base64
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional, Union

logger = logging.getLogger(__name__)


class DoclingMultimodalParser:
    """Parse documents using Docling Python API, producing content_list format.

    Docling extracts structured content blocks:
    - Text paragraphs with heading levels (section_header, title, paragraph)
    - Tables with structure (markdown export, captions, footnotes)
    - Images/Pictures (saved as PNG, with captions)
    - Equations/Formulas (LaTeX text)

    Output format (MinerU-compatible content_list):
    [
        {"type": "text", "text": "...", "text_level": 0, "page_idx": 0},
        {"type": "table", "table_body": "| ... |", "table_caption": [...], "page_idx": 1},
        {"type": "image", "img_path": "/path/to/img.png", "image_caption": [...], "page_idx": 2},
        {"type": "equation", "text": "E=mc^2", "text_format": "latex", "page_idx": 3},
    ]
    """

    SUPPORTED_FORMATS = {
        ".pdf", ".docx", ".pptx", ".xlsx",
        ".html", ".htm", ".xhtml",
        ".png", ".jpg", ".jpeg", ".tiff", ".tif",
        ".md", ".csv",
    }

    def __init__(
        self,
        output_dir: Optional[str] = None,
        images_scale: float = 2.0,
        do_ocr: bool = True,
        do_table_structure: bool = True,
    ):
        self.output_dir = output_dir
        self.images_scale = images_scale
        self.do_ocr = do_ocr
        self.do_table_structure = do_table_structure

    @staticmethod
    def check_installation() -> bool:
        """Check if Docling is available."""
        try:
            from docling.document_converter import DocumentConverter  # noqa: F401
            return True
        except ImportError:
            return False

    def parse_document(
        self,
        file_path: Union[str, Path],
        output_dir: Optional[str] = None,
        **kwargs,
    ) -> List[Dict[str, Any]]:
        """Parse document into content_list format using Docling Python API.

        Args:
            file_path: Path to the document file
            output_dir: Directory to save extracted images

        Returns:
            List of content block dicts
        """
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions

        file_path = Path(file_path)
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        ext = file_path.suffix.lower()
        if ext not in self.SUPPORTED_FORMATS:
            raise ValueError(
                f"Unsupported format: {ext}. "
                f"Supported: {', '.join(sorted(self.SUPPORTED_FORMATS))}"
            )

        # Setup image output directory
        img_output = Path(
            output_dir or self.output_dir
            or str(file_path.parent / "docling_output")
        )
        img_dir = img_output / file_path.stem / "images"
        img_dir.mkdir(parents=True, exist_ok=True)

        # Configure PDF pipeline with image extraction enabled
        pdf_pipeline_options = PdfPipelineOptions(
            generate_picture_images=True,
            images_scale=self.images_scale,
            do_ocr=self.do_ocr,
            do_table_structure=self.do_table_structure,
        )

        converter = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(
                    pipeline_options=pdf_pipeline_options
                ),
            }
        )

        # Convert document using Docling Python API
        result = converter.convert(file_path)

        # Check conversion status
        from docling.datamodel.base_models import ConversionStatus
        if result.status == ConversionStatus.FAILURE:
            errors = getattr(result, 'errors', []) or []
            error_msgs = "; ".join(str(e) for e in errors) if errors else "unknown error"
            raise RuntimeError(
                f"Docling conversion failed for {file_path.name}: {error_msgs}"
            )

        doc = result.document
        if doc is None:
            raise RuntimeError(
                f"Docling returned no document for {file_path.name} "
                f"(status: {result.status})"
            )

        # Convert DoclingDocument to content_list
        content_list = self._convert_document(doc, img_dir)

        # Log statistics
        type_counts: Dict[str, int] = {}
        for item in content_list:
            t = item.get("type", "unknown")
            type_counts[t] = type_counts.get(t, 0) + 1

        logger.info(
            f"Docling parsing: {file_path.name} - "
            f"{len(content_list)} blocks: {type_counts}"
        )

        return content_list

    def _convert_document(
        self, doc, img_dir: Path,  # noqa: C901
    ) -> List[Dict[str, Any]]:
        """Convert DoclingDocument to flat content_list."""
        from docling_core.types.doc.document import (
            TextItem,
            TableItem,
            PictureItem,
        )
        from docling_core.types.doc.labels import DocItemLabel

        content_list: List[Dict[str, Any]] = []
        img_counter = 0

        for item, level in doc.iterate_items():
            # Get page number from provenance
            page_idx = 0
            if hasattr(item, "prov") and item.prov:
                page_idx = item.prov[0].page_no

            if isinstance(item, TextItem):
                label = item.label
                text = item.text or item.orig or ""
                if not text.strip():
                    continue

                # Check if it's a formula/equation
                if label == DocItemLabel.FORMULA:
                    content_list.append({
                        "type": "equation",
                        "text": text,
                        "text_format": "latex",
                        "page_idx": page_idx,
                    })
                else:
                    # Determine heading level
                    text_level = 0
                    if label == DocItemLabel.TITLE:
                        text_level = 1
                    elif label == DocItemLabel.SECTION_HEADER:
                        text_level = min(level + 1, 6)

                    # Skip page headers/footers (noise)
                    if label in (DocItemLabel.PAGE_HEADER, DocItemLabel.PAGE_FOOTER):
                        continue

                    content_list.append({
                        "type": "text",
                        "text": text,
                        "text_level": text_level,
                        "label": label.value if hasattr(label, "value") else str(label),
                        "page_idx": page_idx,
                    })

            elif isinstance(item, TableItem):
                # Export table structure as markdown
                table_body = ""
                try:
                    table_body = item.export_to_markdown(doc)
                except Exception:
                    # Fallback: try HTML
                    try:
                        table_body = item.export_to_html()
                    except Exception:
                        table_body = str(item.data) if item.data else ""

                # Get caption text
                caption_text = []
                try:
                    ct = item.caption_text(doc)
                    if ct:
                        caption_text = [ct]
                except Exception:
                    if item.captions:
                        for cap_ref in item.captions:
                            try:
                                cap_item = doc.get_ref(cap_ref)
                                if hasattr(cap_item, "text") and cap_item.text:
                                    caption_text.append(cap_item.text)
                            except Exception:
                                pass

                # Get footnotes
                footnote_text = []
                if item.footnotes:
                    for fn_ref in item.footnotes:
                        try:
                            fn_item = doc.get_ref(fn_ref)
                            if hasattr(fn_item, "text") and fn_item.text:
                                footnote_text.append(fn_item.text)
                        except Exception:
                            pass

                content_list.append({
                    "type": "table",
                    "table_body": table_body,
                    "table_caption": caption_text,
                    "table_footnote": footnote_text,
                    "num_rows": item.data.num_rows if item.data else 0,
                    "num_cols": item.data.num_cols if item.data else 0,
                    "page_idx": page_idx,
                })

            elif isinstance(item, PictureItem):
                # Save image to file
                img_path_str = ""
                try:
                    image = item.get_image(doc)
                    if image is not None:
                        img_counter += 1
                        img_filename = f"page{page_idx}_img{img_counter}.png"
                        img_path = img_dir / img_filename
                        image.save(str(img_path), format="PNG")
                        img_path_str = str(img_path.resolve())
                    elif item.image and item.image.uri:
                        # Fallback: extract from base64 URI
                        uri = str(item.image.uri)
                        if "base64," in uri:
                            img_counter += 1
                            b64_data = uri.split("base64,")[1]
                            img_filename = f"page{page_idx}_img{img_counter}.png"
                            img_path = img_dir / img_filename
                            img_path.write_bytes(base64.b64decode(b64_data))
                            img_path_str = str(img_path.resolve())
                except Exception as e:
                    logger.warning(f"Failed to extract image at page {page_idx}: {e}")

                if not img_path_str:
                    continue

                # Get caption
                caption_text = []
                try:
                    ct = item.caption_text(doc)
                    if ct:
                        caption_text = [ct]
                except Exception:
                    if item.captions:
                        for cap_ref in item.captions:
                            try:
                                cap_item = doc.get_ref(cap_ref)
                                if hasattr(cap_item, "text") and cap_item.text:
                                    caption_text.append(cap_item.text)
                            except Exception:
                                pass

                # Get footnotes
                footnote_text = []
                if item.footnotes:
                    for fn_ref in item.footnotes:
                        try:
                            fn_item = doc.get_ref(fn_ref)
                            if hasattr(fn_item, "text") and fn_item.text:
                                footnote_text.append(fn_item.text)
                        except Exception:
                            pass

                # Image classification info
                image_label = item.label.value if hasattr(item.label, "value") else "picture"

                content_list.append({
                    "type": "image",
                    "img_path": img_path_str,
                    "image_caption": caption_text,
                    "image_footnote": footnote_text,
                    "image_label": image_label,  # "picture" or "chart"
                    "page_idx": page_idx,
                })

        return content_list
