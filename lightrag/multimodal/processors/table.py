"""
Table modal processor - processes table content via LLM.

Supports VLM fallback when garbled CJK text is detected in table body.
"""

import json
from typing import Dict, Any, Tuple, Optional

from lightrag.utils import logger, compute_mdhash_id
from lightrag.multimodal.base import BaseModalProcessor
from lightrag.multimodal.prompts import PROMPTS
from lightrag.multimodal.text_quality import is_garbled_cjk, extract_table_cell_text


class TableModalProcessor(BaseModalProcessor):
    """Processor for table content using LLM analysis on markdown table data.

    When garbled CJK text is detected and a VLM function is available,
    falls back to VLM-based page image analysis for accurate table reading.
    """

    def __init__(
        self,
        lightrag,
        modal_caption_func,
        context_extractor=None,
        response_language: str = "Korean",
        vlm_caption_func=None,
    ):
        super().__init__(lightrag, modal_caption_func, context_extractor, response_language)
        self.vlm_caption_func = vlm_caption_func
        self.pdf_path: Optional[str] = None

    async def generate_description_only(
        self,
        modal_content,
        content_type: str,
        item_info: Dict[str, Any] = None,
        entity_name: str = None,
    ) -> Tuple[str, Dict[str, Any]]:
        """Generate table description and entity info via LLM."""
        try:
            if isinstance(modal_content, str):
                try:
                    content_data = json.loads(modal_content)
                except json.JSONDecodeError:
                    content_data = {"table_body": modal_content}
            else:
                content_data = modal_content

            table_caption = content_data.get("table_caption", [])
            table_body = content_data.get("table_body", "")
            table_footnote = content_data.get("table_footnote", [])

            # Garbled CJK check → VLM fallback
            # Extract cell text only (strip markdown | and --- structure)
            # to avoid ASCII dilution of CJK ratio
            cell_text = extract_table_cell_text(table_body)
            if (
                self.vlm_caption_func
                and self.pdf_path
                and is_garbled_cjk(
                    cell_text,
                    expected_language=self.response_language,
                )
            ):
                page_idx = item_info.get("page_idx", 0) if item_info else 0
                logger.warning(
                    f"Garbled CJK detected in table (page {page_idx}), "
                    f"falling back to VLM image analysis"
                )
                vlm_result = await self._vlm_fallback_analysis(
                    content_data, item_info, entity_name
                )
                if vlm_result is not None:
                    return vlm_result
                # If VLM fallback failed, continue with LLM path

            context = ""
            if item_info:
                context = self._get_context_for_item(item_info)

            default_entity_name = entity_name or "descriptive name for this table"

            if context:
                table_prompt = PROMPTS.get(
                    "table_prompt_with_context", PROMPTS["table_prompt"]
                ).format(
                    context=context,
                    entity_name=default_entity_name,
                    table_caption=table_caption if table_caption else "None",
                    table_body=table_body,
                    table_footnote=table_footnote if table_footnote else "None",
                    response_language=self.response_language,
                )
            else:
                table_prompt = PROMPTS["table_prompt"].format(
                    entity_name=default_entity_name,
                    table_caption=table_caption if table_caption else "None",
                    table_body=table_body,
                    table_footnote=table_footnote if table_footnote else "None",
                    response_language=self.response_language,
                )

            system_prompt = PROMPTS["TABLE_ANALYSIS_SYSTEM"].format(
                response_language=self.response_language
            )
            effective_instructions = self.get_effective_instructions("table")
            if effective_instructions:
                system_prompt += f"\n\n[Document-Specific Instructions]\n{effective_instructions}"
            seed_guide = self.get_seed_entities_guide()
            if seed_guide:
                system_prompt += f"\n\n{seed_guide}"

            response = await self.modal_caption_func(
                table_prompt,
                system_prompt=system_prompt,
            )

            return self._parse_table_response(response, entity_name)

        except Exception as e:
            logger.error(f"Error generating table description: {e}")
            fallback_entity = {
                "entity_name": entity_name or f"table_{compute_mdhash_id(str(modal_content))}",
                "entity_type": "table",
                "summary": f"Table content: {str(modal_content)[:100]}",
            }
            return str(modal_content), fallback_entity

    async def _vlm_fallback_analysis(
        self,
        content_data: Dict[str, Any],
        item_info: Dict[str, Any] = None,
        entity_name: str = None,
    ) -> Optional[Tuple[str, Dict[str, Any]]]:
        """Analyze table via VLM page image when text extraction is garbled.

        Returns:
            Tuple of (description, entity_info) on success, None on failure.
        """
        from lightrag.multimodal.page_renderer import render_page_to_base64

        page_idx = item_info.get("page_idx", 0) if item_info else 0

        try:
            image_b64 = render_page_to_base64(self.pdf_path, page_idx)
            if not image_b64:
                logger.warning(
                    f"VLM fallback: failed to render page {page_idx}, "
                    f"falling through to LLM path"
                )
                return None

            # Build prompt
            context = ""
            if item_info:
                context = self._get_context_for_item(item_info)

            default_entity_name = entity_name or "descriptive name for this table"

            if context:
                prompt = PROMPTS.get(
                    "table_vlm_fallback_prompt_with_context",
                    PROMPTS["table_vlm_fallback_prompt"],
                ).format(
                    context=context,
                    entity_name=default_entity_name,
                    response_language=self.response_language,
                )
            else:
                prompt = PROMPTS["table_vlm_fallback_prompt"].format(
                    entity_name=default_entity_name,
                    response_language=self.response_language,
                )

            system_prompt = PROMPTS["TABLE_ANALYSIS_SYSTEM"].format(
                response_language=self.response_language
            )
            effective_instructions = self.get_effective_instructions("table")
            if effective_instructions:
                system_prompt += (
                    f"\n\n[Document-Specific Instructions]\n{effective_instructions}"
                )
            seed_guide = self.get_seed_entities_guide()
            if seed_guide:
                system_prompt += f"\n\n{seed_guide}"

            response = await self.vlm_caption_func(
                prompt,
                image_data=image_b64,
                system_prompt=system_prompt,
            )

            logger.info(
                f"VLM fallback successful for table on page {page_idx}"
            )
            return self._parse_table_response(response, entity_name)

        except Exception as e:
            logger.error(
                f"VLM fallback failed for table on page {page_idx}: {e}"
            )
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
        """Process table content: generate description, create entity and chunk."""
        try:
            enhanced_caption, entity_info = await self.generate_description_only(
                modal_content, content_type, item_info, entity_name
            )

            if isinstance(modal_content, str):
                try:
                    content_data = json.loads(modal_content)
                except json.JSONDecodeError:
                    content_data = {"table_body": modal_content}
            else:
                content_data = modal_content

            table_caption = content_data.get("table_caption", [])
            table_body = content_data.get("table_body", "")
            table_footnote = content_data.get("table_footnote", [])

            modal_chunk = PROMPTS["table_chunk"].format(
                table_body=table_body,
                enhanced_caption=enhanced_caption,
            )

            # Detect if VLM fallback was used for this table
            cell_text = extract_table_cell_text(table_body)
            used_vlm_fallback = bool(
                self.vlm_caption_func
                and self.pdf_path
                and is_garbled_cjk(cell_text, expected_language=self.response_language)
            )

            structured_content = {
                "version": "1.0",
                "type": "table",
                "source": {
                    "file_path": file_path,
                    "doc_id": doc_id,
                    "chunk_order_index": chunk_order_index,
                    "page_idx": item_info.get("page_idx") if item_info else None,
                },
                "table": {
                    "caption": table_caption if table_caption else [],
                    "body_markdown": table_body,
                    "footnotes": table_footnote if table_footnote else [],
                },
                "analysis": {
                    "description": enhanced_caption,
                    "vlm_fallback": used_vlm_fallback,
                },
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
            logger.error(f"Error processing table content: {e}")
            fallback_entity = {
                "entity_name": entity_name or f"table_{compute_mdhash_id(str(modal_content))}",
                "entity_type": "table",
                "summary": f"Table content: {str(modal_content)[:100]}",
            }
            return str(modal_content), fallback_entity

    def _parse_table_response(
        self, response: str, entity_name: str = None
    ) -> Tuple[str, Dict[str, Any]]:
        """Parse table analysis response."""
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
            logger.error(f"Error parsing table analysis response: {e}")
            fallback_entity = {
                "entity_name": entity_name or f"table_{compute_mdhash_id(response)}",
                "entity_type": "table",
                "summary": response[:100] + "..." if len(response) > 100 else response,
            }
            return response, fallback_entity
