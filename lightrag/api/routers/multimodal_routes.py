"""
Multimodal document processing API routes.

Provides endpoints for:
- Parsing documents with multimodal extraction (images, tables, equations)
- Processing individual multimodal content items
- Getting multimodal processing status and configuration
"""

import os
import asyncio
import tempfile
from pathlib import Path
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request
from pydantic import BaseModel

from lightrag.utils import logger
from lightrag.multimodal.config import MultimodalConfig
from lightrag.multimodal.context import ContextConfig, ContextExtractor
from lightrag.multimodal.processors import (
    ImageModalProcessor,
    TableModalProcessor,
    EquationModalProcessor,
    GenericModalProcessor,
)

# ============================================================================
# Workspace isolation pattern
# ============================================================================

_get_rag_for_workspace = None


def set_rag_workspace_getter(getter):
    global _get_rag_for_workspace
    _get_rag_for_workspace = getter


async def get_workspace_rag(workspace: str):
    if _get_rag_for_workspace is None:
        raise HTTPException(status_code=500, detail="RAG workspace getter not configured")
    return await _get_rag_for_workspace(workspace)


def _get_workspace_from_request(request: Request) -> str:
    return request.headers.get("LIGHTRAG-WORKSPACE", "")


# ============================================================================
# Global state
# ============================================================================

_multimodal_config: Optional[MultimodalConfig] = None
_vlm_model_func = None
_llm_model_func = None


def set_multimodal_config(config: MultimodalConfig):
    global _multimodal_config
    _multimodal_config = config


def set_vlm_model_func(func):
    """Set the VLM model function for image analysis."""
    global _vlm_model_func
    _vlm_model_func = func


def set_llm_model_func(func):
    """Set the LLM model function for table/equation analysis."""
    global _llm_model_func
    _llm_model_func = func


def _get_config() -> MultimodalConfig:
    global _multimodal_config
    if _multimodal_config is None:
        _multimodal_config = MultimodalConfig()
    return _multimodal_config


# ============================================================================
# Response Models
# ============================================================================

class MultimodalStatusResponse(BaseModel):
    status: str
    config: Dict[str, Any]
    vlm_available: bool
    parsers: Dict[str, bool]
    processors: List[str]


class ParseDocumentResponse(BaseModel):
    success: bool
    file_name: str
    content_list_count: int
    content_type_counts: Dict[str, int]
    text_blocks: int
    image_blocks: int
    table_blocks: int
    equation_blocks: int


class ProcessContentResponse(BaseModel):
    success: bool
    processed_count: int
    results: List[Dict[str, Any]]
    errors: List[str]


# ============================================================================
# Router
# ============================================================================

router = APIRouter(prefix="/api/multimodal", tags=["Multimodal Processing"])


@router.get("/status", response_model=MultimodalStatusResponse)
async def get_multimodal_status(http_request: Request):
    """Get multimodal processing status and configuration."""
    config = _get_config()

    # Check parser availability
    parsers = {}
    try:
        from lightrag.multimodal.parsers.docling_parser import DoclingMultimodalParser
        parsers["docling"] = DoclingMultimodalParser.check_installation()
    except Exception:
        parsers["docling"] = False

    try:
        from lightrag.multimodal.parsers.pymupdf_parser import PyMuPDFMultimodalParser
        parsers["pymupdf"] = PyMuPDFMultimodalParser.check_installation()
    except Exception:
        parsers["pymupdf"] = False

    # Available processors
    processors = []
    if config.enable_image_processing:
        processors.append("image")
    if config.enable_table_processing:
        processors.append("table")
    if config.enable_equation_processing:
        processors.append("equation")
    processors.append("generic")

    return MultimodalStatusResponse(
        status="ready" if _vlm_model_func or _llm_model_func else "no_model_configured",
        config={
            "vlm_model": config.vlm_model,
            "vlm_api_base": config.vlm_api_base,
            "response_language": config.vlm_response_language,
            "enable_image": config.enable_image_processing,
            "enable_table": config.enable_table_processing,
            "enable_equation": config.enable_equation_processing,
            "max_parallel": config.max_parallel_multimodal,
            "context_window": config.context_window,
            "context_mode": config.context_mode,
        },
        vlm_available=_vlm_model_func is not None,
        parsers=parsers,
        processors=processors,
    )


@router.post("/parse", response_model=ParseDocumentResponse)
async def parse_document(
    http_request: Request,
    file: UploadFile = File(...),
    parser: str = Form(default="pymupdf"),
    extract_images: bool = Form(default=True),
    password: Optional[str] = Form(default=None),
):
    """Parse a document into multimodal content_list format.

    Extracts text, images, tables, and equations from the document.
    Returns content type counts without processing through VLM/LLM.

    Args:
        file: Document file (PDF, DOCX, etc.)
        parser: Parser to use ('pymupdf' or 'docling')
        extract_images: Whether to extract images from PDF
        password: Optional password for encrypted PDFs
    """
    workspace = _get_workspace_from_request(http_request)

    try:
        file_bytes = await file.read()
        file_name = file.filename or "unknown"
        suffix = Path(file_name).suffix.lower()

        # Save to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(file_bytes)
            tmp_path = Path(tmp.name)

        try:
            if parser == "docling":
                from lightrag.multimodal.parsers.docling_parser import DoclingMultimodalParser
                doc_parser = DoclingMultimodalParser()
                content_list = doc_parser.parse_document(tmp_path)
            else:
                from lightrag.multimodal.parsers.pymupdf_parser import PyMuPDFMultimodalParser
                config = _get_config()
                doc_parser = PyMuPDFMultimodalParser(
                    min_image_width=config.min_image_width,
                    min_image_height=config.min_image_height,
                    max_image_aspect_ratio=config.max_image_aspect_ratio,
                    enable_duplicate_filtering=config.enable_duplicate_filtering,
                )
                content_list = doc_parser.parse_document(
                    tmp_path,
                    password=password,
                    extract_images=extract_images,
                )

            # Count content types
            type_counts: Dict[str, int] = {}
            for item in content_list:
                t = item.get("type", "unknown")
                type_counts[t] = type_counts.get(t, 0) + 1

            # Store content_list in memory for subsequent processing
            # (In a full implementation, this would be stored in a session/cache)
            http_request.app.state.last_content_list = content_list
            http_request.app.state.last_file_name = file_name

            return ParseDocumentResponse(
                success=True,
                file_name=file_name,
                content_list_count=len(content_list),
                content_type_counts=type_counts,
                text_blocks=type_counts.get("text", 0),
                image_blocks=type_counts.get("image", 0),
                table_blocks=type_counts.get("table", 0),
                equation_blocks=type_counts.get("equation", 0),
            )

        finally:
            # Clean up temp file
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    except Exception as e:
        logger.error(f"Error parsing document: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Document parsing failed: {str(e)}")


@router.post("/process", response_model=ProcessContentResponse)
async def process_multimodal_content(
    http_request: Request,
    file: UploadFile = File(...),
    parser: str = Form(default="pymupdf"),
    file_path_label: Optional[str] = Form(default=None),
    process_images: bool = Form(default=True),
    process_tables: bool = Form(default=True),
    process_equations: bool = Form(default=True),
    password: Optional[str] = Form(default=None),
):
    """Parse document and process all multimodal content through VLM/LLM.

    This is the full pipeline:
    1. Parse document into content_list
    2. Insert text content into LightRAG via ainsert()
    3. Process images/tables/equations through modal processors
    4. Create knowledge graph entities for multimodal content

    Args:
        file: Document file
        parser: Parser to use ('pymupdf' or 'docling')
        file_path_label: Label for file_path in knowledge graph
        process_images: Process image content through VLM
        process_tables: Process table content through LLM
        process_equations: Process equation content through LLM
        password: Optional password for encrypted PDFs
    """
    workspace = _get_workspace_from_request(http_request)
    rag = await get_workspace_rag(workspace)
    config = _get_config()

    if not _llm_model_func and not _vlm_model_func:
        raise HTTPException(
            status_code=503,
            detail="No model functions configured. Set VLM_API_BASE and VLM_MODEL environment variables."
        )

    try:
        file_bytes = await file.read()
        file_name = file.filename or "unknown"
        suffix = Path(file_name).suffix.lower()
        file_label = file_path_label or file_name

        # Save to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(file_bytes)
            tmp_path = Path(tmp.name)

        try:
            # Step 1: Parse document
            if parser == "docling":
                from lightrag.multimodal.parsers.docling_parser import DoclingMultimodalParser
                doc_parser = DoclingMultimodalParser()
                content_list = doc_parser.parse_document(tmp_path)
            else:
                from lightrag.multimodal.parsers.pymupdf_parser import PyMuPDFMultimodalParser
                doc_parser = PyMuPDFMultimodalParser(
                    min_image_width=config.min_image_width,
                    min_image_height=config.min_image_height,
                    max_image_aspect_ratio=config.max_image_aspect_ratio,
                    enable_duplicate_filtering=config.enable_duplicate_filtering,
                )
                content_list = doc_parser.parse_document(
                    tmp_path, password=password, extract_images=process_images
                )

            # Step 2: Separate text and multimodal content
            text_blocks = []
            multimodal_blocks = []
            for idx, item in enumerate(content_list):
                item["_index"] = idx
                if item.get("type") == "text":
                    text_blocks.append(item)
                elif item.get("type") in ("image", "table", "equation"):
                    multimodal_blocks.append(item)

            # Step 3: Insert text content via LightRAG ainsert
            if text_blocks:
                combined_text = "\n\n".join(b.get("text", "") for b in text_blocks if b.get("text"))
                if combined_text.strip():
                    await rag.ainsert(
                        combined_text,
                        file_paths=file_label,
                    )
                    logger.info(f"Inserted {len(text_blocks)} text blocks via ainsert")

            # Step 4: Process multimodal content through processors
            context_config = ContextConfig(
                context_window=config.context_window,
                context_mode=config.context_mode,
                max_context_tokens=config.max_context_tokens,
                include_headers=config.include_headers,
                include_captions=config.include_captions,
                filter_content_types=config.context_filter_content_types,
            )
            context_extractor = ContextExtractor(
                config=context_config,
                tokenizer=rag.tokenizer,
            )

            # Initialize processors
            processors = {}
            caption_func = _vlm_model_func or _llm_model_func
            llm_func = _llm_model_func or caption_func

            if process_images and config.enable_image_processing:
                processors["image"] = ImageModalProcessor(
                    lightrag=rag,
                    modal_caption_func=caption_func,
                    context_extractor=context_extractor,
                    response_language=config.vlm_response_language,
                )
            if process_tables and config.enable_table_processing:
                processors["table"] = TableModalProcessor(
                    lightrag=rag,
                    modal_caption_func=llm_func,
                    context_extractor=context_extractor,
                    response_language=config.vlm_response_language,
                )
            if process_equations and config.enable_equation_processing:
                processors["equation"] = EquationModalProcessor(
                    lightrag=rag,
                    modal_caption_func=llm_func,
                    context_extractor=context_extractor,
                    response_language=config.vlm_response_language,
                )

            # Set content source for context extraction
            for proc in processors.values():
                proc.set_content_source(content_list, config.content_format)

            # Process multimodal blocks with concurrency limit
            results = []
            errors = []
            semaphore = asyncio.Semaphore(config.max_parallel_multimodal)

            async def process_item(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
                content_type = item.get("type", "")
                processor = processors.get(content_type)
                if not processor:
                    return None

                async with semaphore:
                    try:
                        item_info = {
                            "page_idx": item.get("page_idx", 0),
                            "index": item.get("_index", 0),
                        }
                        result = await processor.process_multimodal_content(
                            modal_content=item,
                            content_type=content_type,
                            file_path=file_label,
                            item_info=item_info,
                            doc_id=None,
                            chunk_order_index=item.get("_index", 0),
                        )
                        return {
                            "type": content_type,
                            "page_idx": item.get("page_idx", 0),
                            "success": True,
                            "entity_name": result[1].get("entity_name") if len(result) > 1 else None,
                        }
                    except Exception as e:
                        error_msg = f"Failed to process {content_type} at page {item.get('page_idx', '?')}: {str(e)}"
                        logger.error(error_msg)
                        errors.append(error_msg)
                        return {"type": content_type, "success": False, "error": str(e)}

            # Process all multimodal items
            tasks = [process_item(item) for item in multimodal_blocks]
            task_results = await asyncio.gather(*tasks, return_exceptions=True)

            for r in task_results:
                if isinstance(r, Exception):
                    errors.append(str(r))
                elif r is not None:
                    results.append(r)

            return ProcessContentResponse(
                success=len(errors) == 0,
                processed_count=len(results),
                results=results,
                errors=errors,
            )

        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing multimodal content: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Multimodal processing failed: {str(e)}")


def create_multimodal_routes() -> APIRouter:
    """Create and return the multimodal API router."""
    return router
