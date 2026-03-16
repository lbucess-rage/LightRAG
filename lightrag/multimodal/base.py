"""
Base modal processor for multimodal content processing.

Provides the foundation for all specialized modal processors (image, table, equation).
Each processor creates knowledge graph entities and chunks from multimodal content.
"""

import re
import json
import time
from typing import Dict, Any, Tuple
from dataclasses import asdict

from lightrag.utils import logger, compute_mdhash_id
from lightrag.multimodal.context import ContextExtractor
from lightrag.kg.shared_storage import get_namespace_data, get_pipeline_status_lock
from lightrag.operate import extract_entities, merge_nodes_and_edges


class BaseModalProcessor:
    """Base class for modal processors.

    Each processor takes a LightRAG instance and uses its storage interfaces
    to create knowledge graph entities and text chunks from multimodal content.
    """

    def __init__(
        self,
        lightrag,
        modal_caption_func,
        context_extractor: ContextExtractor = None,
        response_language: str = "Korean",
    ):
        """Initialize base processor.

        Args:
            lightrag: LightRAG instance (provides storage access)
            modal_caption_func: Async function for generating descriptions.
                For images: must accept (prompt, image_data=base64_str, system_prompt=str)
                For text-based: must accept (prompt, system_prompt=str)
            context_extractor: Context extractor instance
            response_language: Language for VLM/LLM responses
        """
        self.lightrag = lightrag
        self.modal_caption_func = modal_caption_func
        self.response_language = response_language

        # Access LightRAG's storage instances
        self.text_chunks_db = lightrag.text_chunks
        self.chunks_vdb = lightrag.chunks_vdb
        self.entities_vdb = lightrag.entities_vdb
        self.relationships_vdb = lightrag.relationships_vdb
        self.knowledge_graph_inst = lightrag.chunk_entity_relation_graph

        # Access LightRAG's functions and config
        self.embedding_func = lightrag.embedding_func
        self.llm_model_func = lightrag.llm_model_func
        self.global_config = asdict(lightrag)
        self.hashing_kv = lightrag.llm_response_cache
        self.tokenizer = lightrag.tokenizer

        # Context extractor
        if context_extractor is None:
            self.context_extractor = ContextExtractor(tokenizer=self.tokenizer)
        else:
            self.context_extractor = context_extractor
            if self.context_extractor.tokenizer is None:
                self.context_extractor.tokenizer = self.tokenizer

        # Content source for context extraction
        self.content_source = None
        self.content_format = "auto"

        # Document-level custom instructions
        self._document_prompt = ""
        self._image_prompt = ""
        self._table_prompt = ""

    def set_content_source(self, content_source: Any, content_format: str = "auto"):
        """Set content source for context extraction."""
        self.content_source = content_source
        self.content_format = content_format

    def set_document_instructions(self, document_prompt="", image_prompt="", table_prompt=""):
        """Set document-level custom instructions for processors."""
        self._document_prompt = (document_prompt or "").strip()
        self._image_prompt = (image_prompt or "").strip()
        self._table_prompt = (table_prompt or "").strip()

    def get_effective_instructions(self, content_type: str) -> str:
        """Get effective custom instructions with fallback to document_prompt."""
        if content_type == "image":
            return self._image_prompt or self._document_prompt
        elif content_type == "table":
            return self._table_prompt or self._document_prompt
        return self._document_prompt

    def get_seed_entities_guide(self) -> str:
        """Build seed entity naming guide for multimodal prompts."""
        seed_entities = self.global_config.get("addon_params", {}).get("seed_entities", None)
        if not seed_entities:
            return ""

        lines = ["[Seed Entity Naming Guide]",
                 "Below are canonical entity names in this domain. "
                 "Only use a canonical name if the content specifically mentions or depicts that entity. "
                 "Do NOT list entities that are not present in the content:"]
        for seed in seed_entities:
            keyword = seed.get("keyword", "")
            if not keyword:
                continue
            entity_type = seed.get("entity_type", "")
            variants = seed.get("variants", [])
            description = seed.get("description", "")
            line = f"- {keyword}"
            if entity_type:
                line += f" (type: {entity_type})"
            if variants:
                line += f" [also known as: {', '.join(variants)}]"
            lines.append(line)
            if description:
                lines.append(f"  {description}")
        lines.append("Use only the relevant canonical name(s) that actually appear in the content. "
                      "Do NOT include all seed entities — only those actually present.")
        return "\n".join(lines)

    def _get_context_for_item(self, item_info: Dict[str, Any]) -> str:
        """Get context for current processing item.

        Combines text-based context from ContextExtractor with
        sibling analysis results (already-processed items on the same page).
        """
        parts = []

        # 1. Standard text context from surrounding pages
        if self.content_source:
            try:
                text_ctx = self.context_extractor.extract_context(
                    self.content_source, item_info, self.content_format
                )
                if text_ctx and text_ctx.strip():
                    parts.append(text_ctx)
            except Exception as e:
                logger.error(f"Error getting context for item {item_info}: {e}")

        # 2. Sibling analysis results (already-processed items on the same page)
        sibling_analyses = item_info.get("sibling_analyses", [])
        if sibling_analyses:
            sibling_lines = ["[같은 페이지에서 이미 분석된 항목]"]
            for sa in sibling_analyses:
                entity_name = sa.get("entity_name", "")
                desc = sa.get("description", "")
                if entity_name and desc:
                    sibling_lines.append(f"- {entity_name}: {desc}")
            if len(sibling_lines) > 1:
                parts.append("\n".join(sibling_lines))

        return "\n\n".join(parts)

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
        """Process multimodal content. Must be implemented by subclasses."""
        raise NotImplementedError("Subclasses must implement process_multimodal_content")

    async def generate_description_only(
        self,
        modal_content,
        content_type: str,
        item_info: Dict[str, Any] = None,
        entity_name: str = None,
    ) -> Tuple[str, Dict[str, Any]]:
        """Generate description without entity extraction. Must be implemented by subclasses."""
        raise NotImplementedError("Subclasses must implement generate_description_only")

    async def _create_entity_and_chunk(
        self,
        modal_chunk: str,
        entity_info: Dict[str, Any],
        file_path: str,
        batch_mode: bool = False,
        doc_id: str = None,
        chunk_order_index: int = 0,
        structured_content: Dict[str, Any] = None,
        extra_node_props: Dict[str, Any] = None,
    ) -> Tuple[str, Dict[str, Any], Any]:
        """Create entity and text chunk in LightRAG storages.

        Args:
            modal_chunk: Text description of the modal content
            entity_info: Dict with entity_name, entity_type, summary
            file_path: Source file path
            batch_mode: If True, skip merge and insert_done
            doc_id: Document ID
            chunk_order_index: Order index of the chunk
            structured_content: Optional structured content dict
            extra_node_props: Optional extra properties for the KG node (e.g., s3_url)

        Returns:
            Tuple of (summary, entity_info_dict, chunk_results)
        """
        chunk_id = compute_mdhash_id(str(modal_chunk), prefix="chunk-")
        tokens = len(self.tokenizer.encode(modal_chunk))
        actual_doc_id = doc_id if doc_id else chunk_id

        # Store chunk in KV storage
        chunk_data = {
            "tokens": tokens,
            "content": modal_chunk,
            "chunk_order_index": chunk_order_index,
            "full_doc_id": actual_doc_id,
            "file_path": file_path,
        }
        if structured_content:
            chunk_data["structured_content"] = structured_content

        await self.text_chunks_db.upsert({chunk_id: chunk_data})

        # Store chunk in vector DB (reuse chunk_data to include structured_content)
        await self.chunks_vdb.upsert({chunk_id: chunk_data})

        # Create entity node in graph
        node_data = {
            "entity_id": entity_info["entity_name"],
            "entity_type": entity_info["entity_type"],
            "description": entity_info["summary"],
            "source_id": chunk_id,
            "file_path": file_path,
            "created_at": int(time.time()),
        }
        if extra_node_props:
            node_data.update(extra_node_props)
        await self.knowledge_graph_inst.upsert_node(entity_info["entity_name"], node_data)

        # Insert entity into vector DB
        await self.entities_vdb.upsert({
            compute_mdhash_id(entity_info["entity_name"], prefix="ent-"): {
                "entity_name": entity_info["entity_name"],
                "entity_type": entity_info["entity_type"],
                "content": f"{entity_info['entity_name']}\n{entity_info['summary']}",
                "source_id": chunk_id,
                "file_path": file_path,
            }
        })

        # Process entity and relationship extraction
        chunk_results = await self._process_chunk_for_extraction(
            chunk_id, entity_info["entity_name"], batch_mode
        )

        return (
            entity_info["summary"],
            {
                "entity_name": entity_info["entity_name"],
                "entity_type": entity_info["entity_type"],
                "description": entity_info["summary"],
                "chunk_id": chunk_id,
            },
            chunk_results,
        )

    async def _process_chunk_for_extraction(
        self, chunk_id: str, modal_entity_name: str, batch_mode: bool = False
    ):
        """Process chunk for entity and relationship extraction."""
        chunk_data = await self.text_chunks_db.get_by_id(chunk_id)
        if not chunk_data:
            logger.error(f"Chunk {chunk_id} not found")
            return

        pipeline_status = await get_namespace_data("pipeline_status")
        pipeline_status_lock = get_pipeline_status_lock()

        chunks = {chunk_id: chunk_data}

        chunk_results = await extract_entities(
            chunks=chunks,
            global_config=self.global_config,
            pipeline_status=pipeline_status,
            pipeline_status_lock=pipeline_status_lock,
            llm_response_cache=self.hashing_kv,
        )

        # Add "belongs_to" relationships for all extracted entities
        processed_chunk_results = []
        for maybe_nodes, maybe_edges in chunk_results:
            for entity_name in maybe_nodes.keys():
                if entity_name != modal_entity_name:
                    relation_data = {
                        "description": f"Entity {entity_name} belongs to {modal_entity_name}",
                        "keywords": "belongs_to,part_of,contained_in",
                        "source_id": chunk_id,
                        "weight": 10.0,
                        "file_path": chunk_data.get("file_path", "manual_creation"),
                    }
                    await self.knowledge_graph_inst.upsert_edge(
                        entity_name, modal_entity_name, relation_data
                    )

                    relation_id = compute_mdhash_id(
                        entity_name + modal_entity_name, prefix="rel-"
                    )
                    await self.relationships_vdb.upsert({
                        relation_id: {
                            "src_id": entity_name,
                            "tgt_id": modal_entity_name,
                            "keywords": relation_data["keywords"],
                            "content": f"{relation_data['keywords']}\t{entity_name}\n{modal_entity_name}\n{relation_data['description']}",
                            "source_id": chunk_id,
                            "file_path": chunk_data.get("file_path", "manual_creation"),
                        }
                    })

                    maybe_edges[(entity_name, modal_entity_name)] = [relation_data]

            processed_chunk_results.append((maybe_nodes, maybe_edges))

        if not batch_mode:
            file_path = chunk_data.get("file_path", "manual_creation")
            await merge_nodes_and_edges(
                chunk_results=chunk_results,
                knowledge_graph_inst=self.knowledge_graph_inst,
                entity_vdb=self.entities_vdb,
                relationships_vdb=self.relationships_vdb,
                global_config=self.global_config,
                pipeline_status=pipeline_status,
                pipeline_status_lock=pipeline_status_lock,
                llm_response_cache=self.hashing_kv,
                current_file_number=1,
                total_files=1,
                file_path=file_path,
            )
            await self.lightrag._insert_done()

        return processed_chunk_results

    # =========================================================================
    # Robust JSON Parsing (handles malformed LLM output)
    # =========================================================================

    def _robust_json_parse(self, response: str) -> dict:
        """Robust JSON parsing with multiple fallback strategies."""
        for json_candidate in self._extract_all_json_candidates(response):
            result = self._try_parse_json(json_candidate)
            if result:
                return result

        for json_candidate in self._extract_all_json_candidates(response):
            cleaned = self._basic_json_cleanup(json_candidate)
            result = self._try_parse_json(cleaned)
            if result:
                return result

        for json_candidate in self._extract_all_json_candidates(response):
            fixed = self._progressive_quote_fix(json_candidate)
            result = self._try_parse_json(fixed)
            if result:
                return result

        return self._extract_fields_with_regex(response)

    def _extract_all_json_candidates(self, response: str) -> list:
        """Extract all possible JSON candidates from response."""
        candidates = []

        # Remove thinking tags from reasoning models
        cleaned = re.sub(r"<think>.*?</think>", "", response, flags=re.DOTALL | re.IGNORECASE)
        cleaned = re.sub(r"<thinking>.*?</thinking>", "", cleaned, flags=re.DOTALL | re.IGNORECASE)

        # JSON in code blocks
        json_blocks = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, re.DOTALL)
        candidates.extend(json_blocks)

        # Balanced braces
        brace_count = 0
        start_pos = -1
        for i, char in enumerate(cleaned):
            if char == "{":
                if brace_count == 0:
                    start_pos = i
                brace_count += 1
            elif char == "}":
                brace_count -= 1
                if brace_count == 0 and start_pos != -1:
                    candidates.append(cleaned[start_pos : i + 1])

        # Simple regex fallback
        simple_match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if simple_match:
            candidates.append(simple_match.group(0))

        return candidates

    def _try_parse_json(self, json_str: str) -> dict:
        if not json_str or not json_str.strip():
            return None
        try:
            return json.loads(json_str)
        except (json.JSONDecodeError, ValueError):
            return None

    def _basic_json_cleanup(self, json_str: str) -> str:
        json_str = json_str.strip()
        json_str = json_str.replace("\u201c", '"').replace("\u201d", '"')
        json_str = re.sub(r",(\s*[}\]])", r"\1", json_str)
        return json_str

    def _progressive_quote_fix(self, json_str: str) -> str:
        json_str = re.sub(r'(?<!\\)\\(?=")', r"\\\\", json_str)

        def fix_string_content(match):
            content = match.group(1)
            content = re.sub(r"\\(?=[a-zA-Z])", r"\\\\", content)
            return f'"{content}"'

        json_str = re.sub(r'"([^"]*(?:\\.[^"]*)*)"', fix_string_content, json_str)
        return json_str

    def _extract_fields_with_regex(self, response: str) -> dict:
        """Extract required fields using regex as last resort."""
        logger.warning("Using regex fallback for JSON parsing")

        desc_match = re.search(
            r'"detailed_description":\s*"([^"]*(?:\\.[^"]*)*)"', response, re.DOTALL
        )
        description = desc_match.group(1) if desc_match else ""

        name_match = re.search(r'"entity_name":\s*"([^"]*(?:\\.[^"]*)*)"', response)
        entity_name = name_match.group(1) if name_match else "unknown_entity"

        type_match = re.search(r'"entity_type":\s*"([^"]*(?:\\.[^"]*)*)"', response)
        entity_type = type_match.group(1) if type_match else "unknown"

        summary_match = re.search(
            r'"summary":\s*"([^"]*(?:\\.[^"]*)*)"', response, re.DOTALL
        )
        summary = summary_match.group(1) if summary_match else description[:100]

        return {
            "detailed_description": description,
            "entity_info": {
                "entity_name": entity_name,
                "entity_type": entity_type,
                "summary": summary,
            },
        }
