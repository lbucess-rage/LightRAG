"""
Image modal processor - processes image content via VLM.
"""

import json
import base64
from typing import Dict, Any, Optional, Tuple
from pathlib import Path

from lightrag.utils import logger, compute_mdhash_id
from lightrag.multimodal.base import BaseModalProcessor
from lightrag.multimodal.prompts import PROMPTS


class ImageModalProcessor(BaseModalProcessor):
    """Processor for image content using Vision Language Model (VLM)."""

    def _encode_image_to_base64(self, image_path: str) -> str:
        """Encode image file to base64 string."""
        try:
            with open(image_path, "rb") as f:
                return base64.b64encode(f.read()).decode("utf-8")
        except Exception as e:
            logger.error(f"Failed to encode image {image_path}: {e}")
            return ""

    async def classify_image(
        self, image_base64: str, page_idx: int = None,
        alt_text: str = None, context_text: str = None,
    ) -> str:
        """Stage 1: Classify image as meaningful or decorative.

        When pdf_path is available, sends both the page snapshot and the
        extracted image so the VLM can judge the element's role in context.
        Falls back to image-only classification otherwise.

        For URL/board images without pdf_path, alt_text and context_text
        hints are appended to help the VLM make a more accurate judgment.
        """
        try:
            page_b64 = None
            if getattr(self, "pdf_path", None) and page_idx is not None:
                from lightrag.multimodal.page_renderer import render_page_to_base64
                page_b64 = render_page_to_base64(self.pdf_path, page_idx, dpi=150)

            if page_b64:
                # Page snapshot + extracted image → more accurate classification
                response = await self.modal_caption_func(
                    PROMPTS["image_classification_with_page_prompt"],
                    image_data=[page_b64, image_base64],
                    system_prompt=PROMPTS["IMAGE_CLASSIFICATION_SYSTEM"],
                )
            else:
                # Fallback: image-only classification (URL images, render failure)
                prompt = PROMPTS["image_classification_prompt"]
                # Append alt/context hints for better accuracy without page context
                hints = []
                if alt_text:
                    hints.append(f"Alt text: {alt_text}")
                if context_text:
                    hints.append(f"Surrounding context: {context_text[:200]}")
                if hints:
                    prompt += "\n\nAdditional hints:\n" + "\n".join(hints)

                response = await self.modal_caption_func(
                    prompt,
                    image_data=image_base64,
                    system_prompt=PROMPTS["IMAGE_CLASSIFICATION_SYSTEM"],
                )

            classification = response.strip().lower()
            if "decorative" in classification:
                return "decorative"
            return "meaningful"
        except Exception as e:
            logger.warning(f"Image classification failed, defaulting to decorative: {e}")
            return "decorative"

    @staticmethod
    def _is_non_knowledge_image(entity_info: Dict[str, Any], description: str) -> bool:
        """Check if VLM analysis result indicates a non-knowledge image.

        Filters out images that VLM classified as meaningful but are actually
        logos, title images, icons, headings, or other non-informational content.

        Args:
            entity_info: Dict with entity_name, entity_type, summary
            description: VLM-generated description text

        Returns:
            True if the image should be skipped (non-knowledge content)
        """
        entity_name = (entity_info.get("entity_name") or "").lower()
        summary = (entity_info.get("summary") or "").lower()

        # Patterns that indicate non-knowledge images
        # Check entity name for explicit non-knowledge indicators
        skip_name_patterns = [
            "로고",           # logo
            "아이콘",         # icon
            "제목 이미지",    # title image
            "제목이미지",
            "제목 (",         # title followed by type marker e.g. "메뉴얼 제목 (image)"
            "표지",           # cover page
            "헤더",           # header
            "푸터",           # footer
            "워터마크",       # watermark
            "브랜드",         # brand
            "배너",           # banner
            "레이블",         # label (e.g. version label, model label)
            "라벨",           # label (alternate spelling)
            "식별 마커",      # identification marker
            "위치 마커",      # location marker
            "logo",
            "icon",
            "title image",
            "title (",
            "cover image",
            "heading image",
            "brand",
            "watermark",
            "banner",
            "label (",
            "marker",
        ]

        for pattern in skip_name_patterns:
            if pattern in entity_name:
                return True

        # Check if entity name ends with common non-knowledge suffixes
        # e.g., "한국자동차환경협회 로고 (image)" → contains "로고"
        # Already covered above

        # Check summary for non-knowledge indicators
        skip_summary_patterns = [
            "식별 로고",       # identification logo
            "기업 로고",       # company logo
            "기관 로고",       # organization logo
            "브랜드 로고",     # brand logo
            "문서의 제목을 나타",  # represents document title
            "문서 제목 이미지",
            "장식적 요소",     # decorative element
            "위치 표시 아이콘",  # location indicator icon
            "탐색 아이콘",     # navigation icon
        ]

        for pattern in skip_summary_patterns:
            if pattern in summary:
                return True

        return False

    async def generate_description_only(
        self,
        modal_content,
        content_type: str,
        item_info: Dict[str, Any] = None,
        entity_name: str = None,
    ) -> Optional[Tuple[str, Dict[str, Any]]]:
        """Generate image description and entity info via VLM.

        Returns None if image is classified as decorative (skip signal).
        """
        try:
            if isinstance(modal_content, str):
                try:
                    content_data = json.loads(modal_content)
                except json.JSONDecodeError:
                    content_data = {"description": modal_content}
            else:
                content_data = modal_content

            image_path = content_data.get("img_path")
            image_base64 = content_data.get("img_data", "")
            # Support both PyMuPDF keys (image_caption/image_footnote) and URL keys (alt/context)
            captions = content_data.get("image_caption", content_data.get("img_caption", []))
            footnotes = content_data.get("image_footnote", content_data.get("img_footnote", []))
            # Map URL route keys: alt → captions, context → footnotes
            if not captions and content_data.get("alt"):
                captions = [content_data["alt"]]
            if not footnotes and content_data.get("context"):
                footnotes = [content_data["context"]]

            # Resolve image_base64: either from img_data (URL route) or from file (PyMuPDF)
            if not image_base64 and image_path:
                image_path_obj = Path(image_path)
                if not image_path_obj.exists():
                    raise FileNotFoundError(f"Image file not found: {image_path}")
                image_base64 = self._encode_image_to_base64(image_path)

            if not image_base64:
                raise ValueError(f"No image data: img_path={image_path}, img_data={'present' if content_data.get('img_data') else 'absent'}")

            # === Stage 1: Classification gate ===
            display_path = image_path or content_data.get("alt", "url_image")
            page_idx = item_info.get("page_idx") if item_info else None
            alt_text = content_data.get("alt")
            context_text = content_data.get("context")
            classification = await self.classify_image(
                image_base64, page_idx=page_idx,
                alt_text=alt_text, context_text=context_text,
            )
            if classification == "decorative":
                logger.info(
                    f"Image classified as decorative, skipping: "
                    f"{display_path} (page {item_info.get('page_idx') if item_info else '?'})"
                )
                return None

            # Extract context
            context = ""
            if item_info:
                context = self._get_context_for_item(item_info)

            default_entity_name = entity_name or "unique descriptive name for this image"

            # Build prompt
            if context:
                vision_prompt = PROMPTS.get(
                    "vision_prompt_with_context", PROMPTS["vision_prompt"]
                ).format(
                    context=context,
                    entity_name=default_entity_name,
                    image_path=display_path,
                    captions=captions if captions else "None",
                    footnotes=footnotes if footnotes else "None",
                    response_language=self.response_language,
                )
            else:
                vision_prompt = PROMPTS["vision_prompt"].format(
                    entity_name=default_entity_name,
                    image_path=display_path,
                    captions=captions if captions else "None",
                    footnotes=footnotes if footnotes else "None",
                    response_language=self.response_language,
                )

            system_prompt = PROMPTS["IMAGE_ANALYSIS_SYSTEM"].format(
                response_language=self.response_language
            )
            effective_instructions = self.get_effective_instructions("image")
            if effective_instructions:
                system_prompt += f"\n\n[Document-Specific Instructions]\n{effective_instructions}"
            seed_guide = self.get_seed_entities_guide()
            if seed_guide:
                system_prompt += f"\n\n{seed_guide}"

            response = await self.modal_caption_func(
                vision_prompt,
                image_data=image_base64,
                system_prompt=system_prompt,
            )

            return self._parse_response(response, entity_name)

        except Exception as e:
            logger.error(f"Error generating image description: {e}")
            fallback_entity = {
                "entity_name": entity_name or f"image_{compute_mdhash_id(str(modal_content))}",
                "entity_type": "image",
                "summary": f"Image content: {str(modal_content)[:100]}",
            }
            return str(modal_content), fallback_entity

    async def _upload_image_to_s3(
        self, image_path: str, workspace: str = "", doc_id: str = ""
    ) -> str | None:
        """Upload image to S3 if enabled. Returns S3 URL or None."""
        try:
            from lightrag.api.utils_s3 import get_s3_client

            s3_client = get_s3_client()
            if not s3_client.is_enabled():
                return None

            image_path_obj = Path(image_path)
            if not image_path_obj.exists():
                return None

            return await s3_client.upload_image(
                file_path=image_path_obj,
                filename=image_path_obj.name,
                workspace=workspace,
                doc_id=doc_id,
            )
        except ImportError:
            logger.debug("S3 client not available for image upload")
            return None
        except Exception as e:
            logger.warning(f"Failed to upload image to S3: {e}")
            return None

    async def _upload_base64_image_to_s3(
        self, image_base64: str, workspace: str = "", doc_id: str = ""
    ) -> str | None:
        """Upload base64-encoded image to S3. Returns S3 URL or None."""
        try:
            from lightrag.api.utils_s3 import get_s3_client
            import tempfile
            import os

            s3_client = get_s3_client()
            if not s3_client.is_enabled():
                return None

            # Write base64 to temp file for upload
            img_bytes = base64.b64decode(image_base64)
            filename = f"url_image_{compute_mdhash_id(image_base64[:100])}.png"
            with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as tmp:
                tmp.write(img_bytes)
                tmp_path = Path(tmp.name)

            try:
                return await s3_client.upload_image(
                    file_path=tmp_path,
                    filename=filename,
                    workspace=workspace,
                    doc_id=doc_id,
                )
            finally:
                os.unlink(tmp_path)
        except ImportError:
            logger.debug("S3 client not available for base64 image upload")
            return None
        except Exception as e:
            logger.warning(f"Failed to upload base64 image to S3: {e}")
            return None

    async def process_multimodal_content(
        self,
        modal_content,
        content_type: str,
        file_path: str = "manual_creation",
        entity_name: str = None,
        item_info: Dict[str, Any] = None,
        batch_mode: bool = False,
        doc_id: str = None,
        chunk_order_index: int = 0,
    ) -> Optional[Tuple[str, Dict[str, Any]]]:
        """Process image content: generate description, create entity and chunk.

        Returns None if image is classified as decorative (skipped).
        """
        try:
            result = await self.generate_description_only(
                modal_content, content_type, item_info, entity_name
            )
            if result is None:
                return None  # Propagate skip signal (decorative image)

            enhanced_caption, entity_info = result

            # === Stage 2: Post-VLM content filter ===
            # Skip images whose VLM analysis indicates non-knowledge content
            # (logos, title images, icons, decorative headings)
            if self._is_non_knowledge_image(entity_info, enhanced_caption):
                display_path = ""
                if isinstance(modal_content, dict):
                    display_path = modal_content.get("img_path", "")
                elif isinstance(modal_content, str):
                    try:
                        display_path = json.loads(modal_content).get("img_path", "")
                    except (json.JSONDecodeError, AttributeError):
                        pass
                logger.info(
                    f"Image filtered as non-knowledge content, skipping: "
                    f"{entity_info.get('entity_name', '?')} "
                    f"(page {item_info.get('page_idx') if item_info else '?'}, path: {display_path})"
                )
                return None

            if isinstance(modal_content, str):
                try:
                    content_data = json.loads(modal_content)
                except json.JSONDecodeError:
                    content_data = {"description": modal_content}
            else:
                content_data = modal_content

            image_path = content_data.get("img_path", "")
            image_base64_data = content_data.get("img_data", "")
            captions = content_data.get("image_caption", content_data.get("img_caption", []))
            footnotes = content_data.get("image_footnote", content_data.get("img_footnote", []))
            if not captions and content_data.get("alt"):
                captions = [content_data["alt"]]
            if not footnotes and content_data.get("context"):
                footnotes = [content_data["context"]]

            # Upload image to S3 (from file path or base64 data)
            workspace = getattr(self.lightrag, "workspace", "") or ""
            s3_url = None
            if image_path:
                s3_url = await self._upload_image_to_s3(
                    image_path, workspace=workspace, doc_id=doc_id or ""
                )
            elif image_base64_data:
                s3_url = await self._upload_base64_image_to_s3(
                    image_base64_data, workspace=workspace, doc_id=doc_id or ""
                )

            modal_chunk = PROMPTS["image_chunk"].format(
                enhanced_caption=enhanced_caption,
            )

            structured_content = {
                "version": "1.0",
                "type": "image",
                "source": {
                    "file_path": file_path,
                    "doc_id": doc_id,
                    "chunk_order_index": chunk_order_index,
                    "page_idx": item_info.get("page_idx") if item_info else None,
                },
                "image": {
                    "path": image_path,
                    "s3_url": s3_url,
                    "captions": captions if captions else [],
                    "footnotes": footnotes if footnotes else [],
                },
                "analysis": {"description": enhanced_caption},
                "entity": {
                    "name": entity_info.get("entity_name"),
                    "type": entity_info.get("entity_type"),
                    "summary": entity_info.get("summary"),
                },
            }

            # Pass s3_url as extra KG node property for frontend display
            extra_node_props = {}
            if s3_url:
                extra_node_props["s3_url"] = s3_url

            result = await self._create_entity_and_chunk(
                modal_chunk, entity_info, file_path,
                batch_mode, doc_id, chunk_order_index,
                structured_content=structured_content,
                extra_node_props=extra_node_props if extra_node_props else None,
            )
            # Include s3_url in returned entity info for frontend preview
            if s3_url and len(result) > 1 and isinstance(result[1], dict):
                result[1]["s3_url"] = s3_url
            return result

        except Exception as e:
            logger.error(f"Error processing image content: {e}")
            fallback_entity = {
                "entity_name": entity_name or f"image_{compute_mdhash_id(str(modal_content))}",
                "entity_type": "image",
                "summary": f"Image content: {str(modal_content)[:100]}",
            }
            return str(modal_content), fallback_entity

    def _parse_response(
        self, response: str, entity_name: str = None
    ) -> Tuple[str, Dict[str, Any]]:
        """Parse VLM response into description and entity info."""
        try:
            response_data = self._robust_json_parse(response)
            description = response_data.get("detailed_description", "")
            entity_data = response_data.get("entity_info", {})

            if not description or not entity_data:
                raise ValueError("Missing required fields in response")

            required = ["entity_name", "entity_type", "summary"]
            if not all(k in entity_data for k in required):
                raise ValueError("Missing required fields in entity_info")

            entity_data["entity_name"] = f"{entity_data['entity_name']} ({entity_data['entity_type']})"
            if entity_name:
                entity_data["entity_name"] = entity_name

            return description, entity_data

        except (json.JSONDecodeError, AttributeError, ValueError) as e:
            logger.error(f"Error parsing image analysis response: {e}")
            fallback_entity = {
                "entity_name": entity_name or f"image_{compute_mdhash_id(response)}",
                "entity_type": "image",
                "summary": response[:100] + "..." if len(response) > 100 else response,
            }
            return response, fallback_entity
