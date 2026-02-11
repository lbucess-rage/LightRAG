"""
Multimodal document processing API routes.

Provides endpoints for:
- Parsing documents with multimodal extraction (images, tables, equations)
- Processing individual multimodal content items
- Getting multimodal processing status and configuration
"""

import asyncio
import os
import tempfile
from pathlib import Path
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request
from pydantic import BaseModel

from lightrag.utils import logger, compute_mdhash_id, sanitize_text_for_encoding
from lightrag.api.utils_s3 import get_s3_client
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


class ProcessAsyncResponse(BaseModel):
    task_id: str
    stream_url: str
    message: str


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


@router.post("/process", response_model=ProcessAsyncResponse)
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
    """Parse document and process all multimodal content through VLM/LLM (async).

    Returns immediately with a task_id and stream_url for progress tracking.
    The actual processing runs in the background.

    Pipeline:
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
    from lightrag.api.task_manager import TaskType, get_task_service

    workspace = _get_workspace_from_request(http_request)
    rag = await get_workspace_rag(workspace)

    if not _llm_model_func and not _vlm_model_func:
        raise HTTPException(
            status_code=503,
            detail="No model functions configured. Set VLM_API_BASE and VLM_MODEL environment variables."
        )

    # Read file bytes before returning (file upload is only available in this request)
    file_bytes = await file.read()
    file_name = file.filename or "unknown"
    file_label = file_path_label or file_name

    # Create async task
    service = get_task_service()
    task = service.create_task(
        task_type=TaskType.MULTIMODAL_PROCESS,
        workspace=workspace,
        metadata={
            "file_name": file_name,
            "parser": parser,
            "process_images": process_images,
            "process_tables": process_tables,
            "process_equations": process_equations,
        },
    )

    # Launch background processing
    service.run_in_background(
        task.task_id,
        _process_multimodal_background,
        task_id=task.task_id,
        rag=rag,
        file_bytes=file_bytes,
        file_name=file_name,
        file_label=file_label,
        parser=parser,
        process_images=process_images,
        process_tables=process_tables,
        process_equations=process_equations,
        password=password,
    )

    return ProcessAsyncResponse(
        task_id=task.task_id,
        stream_url=f"/api/tasks/{task.task_id}/stream",
        message=f"Processing started for {file_name}",
    )


async def _process_multimodal_background(
    *,
    task_id: str,
    rag,
    file_bytes: bytes,
    file_name: str,
    file_label: str,
    parser: str,
    process_images: bool,
    process_tables: bool,
    process_equations: bool,
    password: Optional[str],
) -> None:
    """Background coroutine for multimodal document processing with progress reporting."""
    from lightrag.api.task_manager import TaskStatus, get_task_service

    service = get_task_service()
    config = _get_config()
    suffix = Path(file_name).suffix.lower()
    tmp_path = None

    try:
        # === Phase 1: Parse document (0% -> 20%) ===
        await service.update_progress(task_id, 5.0, f"Parsing {file_name}...")

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(file_bytes)
            tmp_path = Path(tmp.name)

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

        # Separate text and multimodal content
        text_blocks = []
        multimodal_blocks = []
        for idx, item in enumerate(content_list):
            item["_index"] = idx
            if item.get("type") == "text":
                text_blocks.append(item)
            elif item.get("type") in ("image", "table", "equation"):
                multimodal_blocks.append(item)

        await service.update_progress(
            task_id, 20.0,
            f"Parsed: {len(text_blocks)} text, {len(multimodal_blocks)} multimodal blocks",
            detail={"text_blocks": len(text_blocks), "multimodal_blocks": len(multimodal_blocks)},
        )

        # Check cancellation
        task = service.get_task(task_id)
        if task and task.status == TaskStatus.CANCELLED:
            return

        # === Phase 2: Insert text content (20% -> 40%) ===
        await service.update_progress(task_id, 25.0, "Inserting text content into knowledge graph...")

        doc_id = None
        if text_blocks:
            combined_text = "\n\n".join(b.get("text", "") for b in text_blocks if b.get("text"))
            if combined_text.strip():
                # Pre-compute doc_id using same logic as apipeline_enqueue_documents
                cleaned_text = sanitize_text_for_encoding(combined_text)
                doc_id = compute_mdhash_id(cleaned_text, prefix="doc-")

                await rag.ainsert(combined_text, ids=[doc_id], file_paths=[file_label])
                logger.info(f"[Task {task_id}] Inserted {len(text_blocks)} text blocks (doc_id={doc_id})")

        if not doc_id:
            # No text content - generate doc_id from file name for processors
            doc_id = compute_mdhash_id(file_name, prefix="doc-")

        await service.update_progress(task_id, 38.0, "Text content inserted")

        # Upload original document file to S3
        if tmp_path and tmp_path.exists():
            try:
                s3_client = get_s3_client()
                if s3_client.is_enabled():
                    s3_url = await s3_client.upload_file(
                        tmp_path, file_name, rag.workspace, doc_id
                    )
                    if s3_url:
                        logger.info(f"[Task {task_id}] File uploaded to S3: {s3_url}")
                        await _update_doc_s3_url_by_id(rag, doc_id, s3_url)
                        await service.update_progress(task_id, 40.0, "File uploaded to S3")
                    else:
                        await service.update_progress(task_id, 40.0, "S3 upload skipped")
                else:
                    await service.update_progress(task_id, 40.0, "S3 not enabled")
            except Exception as e:
                logger.warning(f"[Task {task_id}] S3 upload failed (non-fatal): {e}")
                await service.update_progress(task_id, 40.0, "S3 upload failed (continuing)")

        # Check cancellation
        task = service.get_task(task_id)
        if task and task.status == TaskStatus.CANCELLED:
            return

        # === Phase 3: Process multimodal content (40% -> 95%) ===
        if not multimodal_blocks:
            await service.update_progress(task_id, 95.0, "No multimodal content to process")
        else:
            await service.update_progress(
                task_id, 45.0,
                f"Processing {len(multimodal_blocks)} multimodal items...",
            )

            # Initialize processors
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

            for proc in processors.values():
                proc.set_content_source(content_list, config.content_format)

            # Process items sequentially with per-item progress
            results = []
            errors = []
            total_items = len(multimodal_blocks)
            progress_range = 50.0  # 45% -> 95%

            for i, item in enumerate(multimodal_blocks):
                # Check cancellation before each item
                task = service.get_task(task_id)
                if task and task.status == TaskStatus.CANCELLED:
                    return

                content_type = item.get("type", "")
                processor = processors.get(content_type)
                if not processor:
                    continue

                item_progress = 45.0 + (progress_range * (i / total_items))
                await service.update_progress(
                    task_id, item_progress,
                    f"Processing {content_type} {i + 1}/{total_items} (page {item.get('page_idx', '?')})",
                    detail={"current_item": i + 1, "total_items": total_items, "type": content_type},
                )

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
                        doc_id=doc_id,
                        chunk_order_index=item.get("_index", 0),
                    )
                    results.append({
                        "type": content_type,
                        "page_idx": item.get("page_idx", 0),
                        "success": True,
                        "entity_name": result[1].get("entity_name") if len(result) > 1 else None,
                    })
                except Exception as e:
                    error_msg = f"Failed to process {content_type} at page {item.get('page_idx', '?')}: {str(e)}"
                    logger.error(f"[Task {task_id}] {error_msg}")
                    errors.append(error_msg)
                    results.append({"type": content_type, "success": False, "error": str(e)})

        # === Phase 4: Complete (95% -> 100%) ===
        await service.update_progress(task_id, 98.0, "Finalizing...")

        final_result = {
            "success": len(errors) == 0 if multimodal_blocks else True,
            "file_name": file_name,
            "processed_count": len([r for r in results if r.get("success")]) if multimodal_blocks else 0,
            "total_items": len(multimodal_blocks),
            "results": results if multimodal_blocks else [],
            "errors": errors if multimodal_blocks else [],
        }

        await service.complete_task(task_id, result=final_result)

    except Exception as e:
        logger.error(f"[Task {task_id}] Background processing failed: {e}", exc_info=True)
        await service.fail_task(task_id, str(e))
    finally:
        # Clean up temp file
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


async def _update_doc_s3_url_by_id(
    rag, doc_id: str, s3_url: str, max_retries: int = 10, delay: float = 2.0
):
    """Update s3_url in doc_status using doc_id (with retry for pipeline timing)."""
    for attempt in range(max_retries):
        try:
            if hasattr(rag.doc_status, "update_s3_url"):
                success = await rag.doc_status.update_s3_url(doc_id, s3_url)
                if success:
                    logger.info(f"Updated s3_url for document: {doc_id}")
                    return
            else:
                doc_data = await rag.doc_status.get_by_id(doc_id)
                if doc_data:
                    doc_data["s3_url"] = s3_url
                    await rag.doc_status.upsert({doc_id: doc_data})
                    logger.info(f"Updated s3_url for document: {doc_id}")
                    return
            if attempt < max_retries - 1:
                await asyncio.sleep(delay)
        except Exception as e:
            if attempt < max_retries - 1:
                await asyncio.sleep(delay)
            else:
                logger.warning(f"Failed to update s3_url for {doc_id} after {max_retries} attempts: {e}")


def create_multimodal_routes() -> APIRouter:
    """Create and return the multimodal API router."""
    return router
