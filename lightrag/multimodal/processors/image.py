"""
Image modal processor - processes image content via VLM.
"""

import json
import base64
from typing import Dict, Any, Tuple
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

    async def generate_description_only(
        self,
        modal_content,
        content_type: str,
        item_info: Dict[str, Any] = None,
        entity_name: str = None,
    ) -> Tuple[str, Dict[str, Any]]:
        """Generate image description and entity info via VLM."""
        try:
            if isinstance(modal_content, str):
                try:
                    content_data = json.loads(modal_content)
                except json.JSONDecodeError:
                    content_data = {"description": modal_content}
            else:
                content_data = modal_content

            image_path = content_data.get("img_path")
            captions = content_data.get("image_caption", content_data.get("img_caption", []))
            footnotes = content_data.get("image_footnote", content_data.get("img_footnote", []))

            if not image_path:
                raise ValueError(f"No image path in modal_content: {modal_content}")

            image_path_obj = Path(image_path)
            if not image_path_obj.exists():
                raise FileNotFoundError(f"Image file not found: {image_path}")

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
                    image_path=image_path,
                    captions=captions if captions else "None",
                    footnotes=footnotes if footnotes else "None",
                    response_language=self.response_language,
                )
            else:
                vision_prompt = PROMPTS["vision_prompt"].format(
                    entity_name=default_entity_name,
                    image_path=image_path,
                    captions=captions if captions else "None",
                    footnotes=footnotes if footnotes else "None",
                    response_language=self.response_language,
                )

            # Encode image and call VLM
            image_base64 = self._encode_image_to_base64(image_path)
            if not image_base64:
                raise RuntimeError(f"Failed to encode image: {image_path}")

            response = await self.modal_caption_func(
                vision_prompt,
                image_data=image_base64,
                system_prompt=PROMPTS["IMAGE_ANALYSIS_SYSTEM"].format(
                    response_language=self.response_language
                ),
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
    ) -> Tuple[str, Dict[str, Any]]:
        """Process image content: generate description, create entity and chunk."""
        try:
            enhanced_caption, entity_info = await self.generate_description_only(
                modal_content, content_type, item_info, entity_name
            )

            if isinstance(modal_content, str):
                try:
                    content_data = json.loads(modal_content)
                except json.JSONDecodeError:
                    content_data = {"description": modal_content}
            else:
                content_data = modal_content

            image_path = content_data.get("img_path", "")
            captions = content_data.get("image_caption", content_data.get("img_caption", []))
            footnotes = content_data.get("image_footnote", content_data.get("img_footnote", []))

            # Upload image to S3
            workspace = getattr(self.lightrag, "workspace", "") or ""
            s3_url = await self._upload_image_to_s3(
                image_path, workspace=workspace, doc_id=doc_id or ""
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

            return await self._create_entity_and_chunk(
                modal_chunk, entity_info, file_path,
                batch_mode, doc_id, chunk_order_index,
                structured_content=structured_content,
                extra_node_props=extra_node_props if extra_node_props else None,
            )

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
