"""
Equation modal processor - processes mathematical equations via LLM.
"""

import json
from typing import Dict, Any, Tuple

from lightrag.utils import logger, compute_mdhash_id
from lightrag.multimodal.base import BaseModalProcessor
from lightrag.multimodal.prompts import PROMPTS


class EquationModalProcessor(BaseModalProcessor):
    """Processor for mathematical equation content using LLM."""

    async def generate_description_only(
        self,
        modal_content,
        content_type: str,
        item_info: Dict[str, Any] = None,
        entity_name: str = None,
    ) -> Tuple[str, Dict[str, Any]]:
        """Generate equation description and entity info via LLM."""
        try:
            if isinstance(modal_content, str):
                try:
                    content_data = json.loads(modal_content)
                except json.JSONDecodeError:
                    content_data = {"equation": modal_content}
            else:
                content_data = modal_content

            equation_text = content_data.get("text")
            equation_format = content_data.get("text_format", "")

            context = ""
            if item_info:
                context = self._get_context_for_item(item_info)

            default_entity_name = entity_name or "descriptive name for this equation"

            if context:
                equation_prompt = PROMPTS.get(
                    "equation_prompt_with_context", PROMPTS["equation_prompt"]
                ).format(
                    context=context,
                    equation_text=equation_text,
                    equation_format=equation_format,
                    entity_name=default_entity_name,
                    response_language=self.response_language,
                )
            else:
                equation_prompt = PROMPTS["equation_prompt"].format(
                    equation_text=equation_text,
                    equation_format=equation_format,
                    entity_name=default_entity_name,
                    response_language=self.response_language,
                )

            response = await self.modal_caption_func(
                equation_prompt,
                system_prompt=PROMPTS["EQUATION_ANALYSIS_SYSTEM"].format(
                    response_language=self.response_language
                ),
            )

            return self._parse_equation_response(response, entity_name)

        except Exception as e:
            logger.error(f"Error generating equation description: {e}")
            fallback_entity = {
                "entity_name": entity_name or f"equation_{compute_mdhash_id(str(modal_content))}",
                "entity_type": "equation",
                "summary": f"Equation content: {str(modal_content)[:100]}",
            }
            return str(modal_content), fallback_entity

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
        """Process equation content: generate description, create entity and chunk."""
        try:
            enhanced_caption, entity_info = await self.generate_description_only(
                modal_content, content_type, item_info, entity_name
            )

            if isinstance(modal_content, str):
                try:
                    content_data = json.loads(modal_content)
                except json.JSONDecodeError:
                    content_data = {"equation": modal_content}
            else:
                content_data = modal_content

            equation_text = content_data.get("text")
            equation_format = content_data.get("text_format", "")

            modal_chunk = PROMPTS["equation_chunk"].format(
                equation_text=equation_text,
                equation_format=equation_format,
                enhanced_caption=enhanced_caption,
            )

            structured_content = {
                "version": "1.0",
                "type": "equation",
                "source": {
                    "file_path": file_path,
                    "doc_id": doc_id,
                    "chunk_order_index": chunk_order_index,
                    "page_idx": item_info.get("page_idx") if item_info else None,
                },
                "equation": {
                    "text": equation_text,
                    "format": equation_format,
                },
                "analysis": {"description": enhanced_caption},
                "entity": {
                    "name": entity_info.get("entity_name"),
                    "type": entity_info.get("entity_type"),
                    "summary": entity_info.get("summary"),
                },
            }

            return await self._create_entity_and_chunk(
                modal_chunk, entity_info, file_path,
                batch_mode, doc_id, chunk_order_index,
                structured_content=structured_content,
            )

        except Exception as e:
            logger.error(f"Error processing equation content: {e}")
            fallback_entity = {
                "entity_name": entity_name or f"equation_{compute_mdhash_id(str(modal_content))}",
                "entity_type": "equation",
                "summary": f"Equation content: {str(modal_content)[:100]}",
            }
            return str(modal_content), fallback_entity

    def _parse_equation_response(
        self, response: str, entity_name: str = None
    ) -> Tuple[str, Dict[str, Any]]:
        """Parse equation analysis response."""
        try:
            response_data = self._robust_json_parse(response)
            description = response_data.get("detailed_description", "")
            entity_data = response_data.get("entity_info", {})

            if not description or not entity_data:
                raise ValueError("Missing required fields")

            required = ["entity_name", "entity_type", "summary"]
            if not all(k in entity_data for k in required):
                raise ValueError("Missing required fields in entity_info")

            entity_data["entity_name"] = f"{entity_data['entity_name']} ({entity_data['entity_type']})"
            if entity_name:
                entity_data["entity_name"] = entity_name

            return description, entity_data

        except (json.JSONDecodeError, AttributeError, ValueError) as e:
            logger.error(f"Error parsing equation analysis response: {e}")
            fallback_entity = {
                "entity_name": entity_name or f"equation_{compute_mdhash_id(response)}",
                "entity_type": "equation",
                "summary": response[:100] + "..." if len(response) > 100 else response,
            }
            return response, fallback_entity
