"""
Generic modal processor - processes arbitrary content types via LLM.
"""

import json
from typing import Dict, Any, Tuple

from lightrag.utils import logger, compute_mdhash_id
from lightrag.multimodal.base import BaseModalProcessor
from lightrag.multimodal.prompts import PROMPTS


class GenericModalProcessor(BaseModalProcessor):
    """Fallback processor for content types without a specialized processor."""

    async def generate_description_only(
        self,
        modal_content,
        content_type: str,
        item_info: Dict[str, Any] = None,
        entity_name: str = None,
    ) -> Tuple[str, Dict[str, Any]]:
        """Generate generic content description via LLM."""
        try:
            context = ""
            if item_info:
                context = self._get_context_for_item(item_info)

            default_entity_name = entity_name or f"descriptive name for this {content_type}"

            if context:
                generic_prompt = PROMPTS.get(
                    "generic_prompt_with_context", PROMPTS["generic_prompt"]
                ).format(
                    context=context,
                    content_type=content_type,
                    entity_name=default_entity_name,
                    content=str(modal_content),
                    response_language=self.response_language,
                )
            else:
                generic_prompt = PROMPTS["generic_prompt"].format(
                    content_type=content_type,
                    entity_name=default_entity_name,
                    content=str(modal_content),
                    response_language=self.response_language,
                )

            system_prompt = PROMPTS["GENERIC_ANALYSIS_SYSTEM"].format(
                content_type=content_type,
                response_language=self.response_language,
            )
            effective_instructions = self.get_effective_instructions(content_type)
            if effective_instructions:
                system_prompt += f"\n\n[Document-Specific Instructions]\n{effective_instructions}"
            seed_guide = self.get_seed_entities_guide()
            if seed_guide:
                system_prompt += f"\n\n{seed_guide}"

            response = await self.modal_caption_func(
                generic_prompt,
                system_prompt=system_prompt,
            )

            return self._parse_generic_response(response, entity_name, content_type)

        except Exception as e:
            logger.error(f"Error generating {content_type} description: {e}")
            fallback_entity = {
                "entity_name": entity_name or f"{content_type}_{compute_mdhash_id(str(modal_content))}",
                "entity_type": content_type,
                "summary": f"{content_type} content: {str(modal_content)[:100]}",
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
        """Process generic content: generate description, create entity and chunk."""
        try:
            enhanced_caption, entity_info = await self.generate_description_only(
                modal_content, content_type, item_info, entity_name
            )

            modal_chunk = PROMPTS["generic_chunk"].format(
                content_type=content_type.title(),
                content=str(modal_content),
                enhanced_caption=enhanced_caption,
            )

            structured_content = {
                "version": "1.0",
                "type": content_type,
                "source": {
                    "file_path": file_path,
                    "doc_id": doc_id,
                    "chunk_order_index": chunk_order_index,
                    "page_idx": item_info.get("page_idx") if item_info else None,
                },
                "content": {"raw": str(modal_content)},
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
            logger.error(f"Error processing {content_type} content: {e}")
            fallback_entity = {
                "entity_name": entity_name or f"{content_type}_{compute_mdhash_id(str(modal_content))}",
                "entity_type": content_type,
                "summary": f"{content_type} content: {str(modal_content)[:100]}",
            }
            return str(modal_content), fallback_entity

    def _parse_generic_response(
        self, response: str, entity_name: str = None, content_type: str = "content"
    ) -> Tuple[str, Dict[str, Any]]:
        """Parse generic analysis response."""
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
            logger.error(f"Error parsing {content_type} analysis response: {e}")
            fallback_entity = {
                "entity_name": entity_name or f"{content_type}_{compute_mdhash_id(response)}",
                "entity_type": content_type,
                "summary": response[:100] + "..." if len(response) > 100 else response,
            }
            return response, fallback_entity
