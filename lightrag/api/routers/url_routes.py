"""
URL knowledge ingestion API routes.

Provides endpoints for:
- Validating and normalizing URLs
- Extracting URLs from text
- Ingesting web content into the knowledge graph (async)
"""

import asyncio
import base64
import datetime
import hashlib
from datetime import timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from lightrag.api.utils_api import decode_workspace_header
from lightrag.utils import logger
from lightrag.url.config import URLIngestConfig
from lightrag.url.detector import URLDetector
from lightrag.url.fetcher import FetchResult, WebFetcher
from lightrag.url.parser import HTMLParser, ParsedContent

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
    return decode_workspace_header(request.headers.get("LIGHTRAG-WORKSPACE", ""))


# ============================================================================
# Global state
# ============================================================================

_url_config: Optional[URLIngestConfig] = None
_vlm_model_func = None
_llm_model_func = None


def set_url_config(config: URLIngestConfig):
    global _url_config
    _url_config = config


def set_vlm_model_func(func):
    """Set the VLM model function for image analysis."""
    global _vlm_model_func
    _vlm_model_func = func


def set_llm_model_func(func):
    """Set the LLM model function for table analysis."""
    global _llm_model_func
    _llm_model_func = func


def _get_config() -> URLIngestConfig:
    global _url_config
    if _url_config is None:
        _url_config = URLIngestConfig()
    return _url_config


# ============================================================================
# Request/Response Models
# ============================================================================


class URLValidateRequest(BaseModel):
    url: str


class URLValidateResponse(BaseModel):
    valid: bool
    normalized_url: str = ""
    domain: str = ""
    doc_id: str = ""


class URLExtractRequest(BaseModel):
    text: str


class URLExtractResponse(BaseModel):
    urls: List[str]


class URLIngestRequest(BaseModel):
    url: str
    file_path_label: Optional[str] = None
    process_images: bool = True
    process_tables: bool = True
    skip_duplicates: bool = True
    force_reindex: bool = False
    follow_links: bool = False
    max_depth: int = 2
    document_prompt: Optional[str] = None
    image_prompt: Optional[str] = None
    table_prompt: Optional[str] = None


class URLIngestAsyncResponse(BaseModel):
    task_id: str
    stream_url: str
    message: str


class URLBatchIngestRequest(BaseModel):
    urls: List[str]
    process_images: bool = True
    process_tables: bool = True
    skip_duplicates: bool = True
    force_reindex: bool = False
    follow_links: bool = False
    max_depth: int = 2
    document_prompt: Optional[str] = None
    image_prompt: Optional[str] = None
    table_prompt: Optional[str] = None


class URLBatchTaskInfo(BaseModel):
    task_id: str
    stream_url: str
    url: str
    message: str


class URLBatchSkippedInfo(BaseModel):
    url: str
    reason: str


class URLBatchIngestResponse(BaseModel):
    tasks: List[URLBatchTaskInfo]
    skipped: List[URLBatchSkippedInfo]
    total_submitted: int
    total_skipped: int


# ============================================================================
# Router
# ============================================================================

router = APIRouter(prefix="/api/url", tags=["URL Knowledge Ingestion"])


# ============================================================================
# Helpers
# ============================================================================


def _chunk_text(text: str, max_size: int) -> List[str]:
    """Split text into chunks respecting paragraph and sentence boundaries.

    Strategy: split by paragraphs first, then by sentences if paragraphs are too large.
    """
    if max_size <= 0 or len(text) <= max_size:
        return [text]

    chunks: List[str] = []
    paragraphs = text.split("\n\n")

    current_chunk = ""
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        if len(current_chunk) + len(para) + 2 <= max_size:
            if current_chunk:
                current_chunk += "\n\n" + para
            else:
                current_chunk = para
        else:
            if current_chunk:
                chunks.append(current_chunk)
                current_chunk = ""

            if len(para) <= max_size:
                current_chunk = para
            else:
                # Paragraph too large — split by sentences
                import re
                sentences = re.split(r'(?<=[.!?])\s+', para)
                for sent in sentences:
                    if len(current_chunk) + len(sent) + 1 <= max_size:
                        if current_chunk:
                            current_chunk += " " + sent
                        else:
                            current_chunk = sent
                    else:
                        if current_chunk:
                            chunks.append(current_chunk)
                        current_chunk = sent

    if current_chunk:
        chunks.append(current_chunk)

    return chunks if chunks else [text]


async def _check_duplicate(rag, file_label: str) -> bool:
    """Check if a document with the given file_path already exists."""
    try:
        doc = await rag.doc_status.get_doc_by_file_path(file_label)
        return doc is not None
    except Exception:
        return False


@router.post("/validate", response_model=URLValidateResponse)
async def validate_url(body: URLValidateRequest, http_request: Request):
    """Validate and normalize a URL."""
    detector = URLDetector()
    info = detector.get_info(body.url)

    doc_id = ""
    if info.is_valid:
        doc_id = hashlib.md5(info.normalized_url.encode()).hexdigest()[:16]

    return URLValidateResponse(
        valid=info.is_valid,
        normalized_url=info.normalized_url if info.is_valid else "",
        domain=info.domain,
        doc_id=doc_id,
    )


@router.post("/extract", response_model=URLExtractResponse)
async def extract_urls(body: URLExtractRequest, http_request: Request):
    """Extract valid URLs from text."""
    detector = URLDetector()
    urls = detector.extract(body.text)
    return URLExtractResponse(urls=urls)


@router.post("/ingest", response_model=URLIngestAsyncResponse)
async def ingest_url(body: URLIngestRequest, http_request: Request):
    """Ingest web content from URL into the knowledge graph (async).

    Returns immediately with a task_id and stream_url for progress tracking.
    The actual processing runs in the background.

    Pipeline:
    1. Validate and normalize URL
    2. Fetch HTML content via httpx
    3. Parse HTML (text, images, tables)
    4. Insert text content into LightRAG via ainsert()
    5. Process images/tables through multimodal processors
    """
    from lightrag.api.task_manager import TaskType, get_task_service

    workspace = _get_workspace_from_request(http_request)
    rag = await get_workspace_rag(workspace)

    # Validate URL
    detector = URLDetector()
    info = detector.get_info(body.url)
    if not info.is_valid:
        raise HTTPException(status_code=400, detail=f"Invalid URL: {body.url}")

    config = _get_config()
    file_label = body.file_path_label or info.normalized_url

    # Duplicate detection
    if body.skip_duplicates and not body.force_reindex:
        is_dup = await _check_duplicate(rag, file_label)
        if is_dup:
            raise HTTPException(
                status_code=409,
                detail=f"URL already ingested: {file_label}. Use force_reindex=true to re-process.",
            )

    # Create async task
    service = get_task_service()
    task = service.create_task(
        task_type=TaskType.URL_INGEST,
        workspace=workspace,
        metadata={
            "url": info.normalized_url,
            "domain": info.domain,
            "file_path_label": file_label,
            "process_images": body.process_images,
            "process_tables": body.process_tables,
            "document_prompt": body.document_prompt or "",
            "image_prompt": body.image_prompt or "",
            "table_prompt": body.table_prompt or "",
        },
    )

    # Launch background processing
    service.run_in_background(
        task.task_id,
        _ingest_url_background,
        task_id=task.task_id,
        rag=rag,
        url=info.normalized_url,
        file_label=file_label,
        process_images=body.process_images,
        process_tables=body.process_tables,
        config=config,
        workspace=workspace,
        follow_links=body.follow_links,
        max_depth=body.max_depth,
        current_depth=0,
        document_prompt=body.document_prompt or "",
        image_prompt=body.image_prompt or "",
        table_prompt=body.table_prompt or "",
    )

    return URLIngestAsyncResponse(
        task_id=task.task_id,
        stream_url=f"/api/tasks/{task.task_id}/stream",
        message=f"URL ingestion started for {info.domain}",
    )


@router.post("/ingest-batch", response_model=URLBatchIngestResponse)
async def ingest_url_batch(body: URLBatchIngestRequest, http_request: Request):
    """Ingest multiple URLs in batch. Each URL gets its own background task.

    Validates and deduplicates URLs, then creates individual tasks for each.
    Returns task info for submitted URLs and skip info for duplicates/invalid URLs.
    """
    from lightrag.api.task_manager import TaskType, get_task_service

    workspace = _get_workspace_from_request(http_request)
    rag = await get_workspace_rag(workspace)
    config = _get_config()
    service = get_task_service()
    detector = URLDetector()

    tasks: List[URLBatchTaskInfo] = []
    skipped: List[URLBatchSkippedInfo] = []

    # Deduplicate input URLs
    seen_urls = set()

    for raw_url in body.urls:
        raw_url = raw_url.strip()
        if not raw_url:
            continue

        # Validate
        info = detector.get_info(raw_url)
        if not info.is_valid:
            skipped.append(URLBatchSkippedInfo(url=raw_url, reason="Invalid URL"))
            continue

        # Skip if already seen in this batch
        if info.normalized_url in seen_urls:
            skipped.append(URLBatchSkippedInfo(url=raw_url, reason="Duplicate in batch"))
            continue
        seen_urls.add(info.normalized_url)

        file_label = info.normalized_url

        # Duplicate detection against existing documents
        if body.skip_duplicates and not body.force_reindex:
            is_dup = await _check_duplicate(rag, file_label)
            if is_dup:
                skipped.append(URLBatchSkippedInfo(url=raw_url, reason="Already ingested"))
                continue

        # Create task
        task = service.create_task(
            task_type=TaskType.URL_INGEST,
            workspace=workspace,
            metadata={
                "url": info.normalized_url,
                "domain": info.domain,
                "file_path_label": file_label,
                "process_images": body.process_images,
                "process_tables": body.process_tables,
                "document_prompt": body.document_prompt or "",
                "image_prompt": body.image_prompt or "",
                "table_prompt": body.table_prompt or "",
            },
        )

        service.run_in_background(
            task.task_id,
            _ingest_url_background,
            task_id=task.task_id,
            rag=rag,
            url=info.normalized_url,
            file_label=file_label,
            process_images=body.process_images,
            process_tables=body.process_tables,
            config=config,
            workspace=workspace,
            follow_links=body.follow_links,
            max_depth=body.max_depth,
            current_depth=0,
            document_prompt=body.document_prompt or "",
            image_prompt=body.image_prompt or "",
            table_prompt=body.table_prompt or "",
        )

        tasks.append(URLBatchTaskInfo(
            task_id=task.task_id,
            stream_url=f"/api/tasks/{task.task_id}/stream",
            url=info.normalized_url,
            message=f"URL ingestion started for {info.domain}",
        ))

    return URLBatchIngestResponse(
        tasks=tasks,
        skipped=skipped,
        total_submitted=len(tasks),
        total_skipped=len(skipped),
    )


# ============================================================================
# Background Processing
# ============================================================================


async def _ingest_url_background(
    *,
    task_id: str,
    rag,
    url: str,
    file_label: str,
    process_images: bool,
    process_tables: bool,
    config: URLIngestConfig,
    workspace: str = "",
    follow_links: bool = False,
    max_depth: int = 2,
    current_depth: int = 0,
    document_prompt: str = "",
    image_prompt: str = "",
    table_prompt: str = "",
) -> None:
    """Background coroutine for URL knowledge ingestion with progress reporting."""
    from lightrag.api.task_manager import TaskStatus, TaskType, get_task_service

    service = get_task_service()
    doc_id_for_status = None
    has_multimodal = False

    try:
        # === Phase 1: Validate (5%) ===
        await service.update_progress(task_id, 5.0, f"Validating URL: {url}")

        task = service.get_task(task_id)
        if task and task.status == TaskStatus.CANCELLED:
            return

        # === Phase 2: Fetch (10% -> 25%) ===
        await service.update_progress(task_id, 10.0, "Fetching web content...")

        fetcher = WebFetcher(
            timeout=config.fetch_timeout,
            max_retries=config.fetch_max_retries,
        )
        fetch_result: FetchResult = await fetcher.fetch(url)

        if not fetch_result.success:
            await service.fail_task(
                task_id, f"Failed to fetch URL: {fetch_result.error_message}"
            )
            return

        await service.update_progress(
            task_id, 25.0,
            f"Fetched {len(fetch_result.content)} characters",
            detail={"content_length": len(fetch_result.content), "status_code": fetch_result.status_code},
        )

        task = service.get_task(task_id)
        if task and task.status == TaskStatus.CANCELLED:
            return

        # === Phase 3: Parse HTML (25% -> 40%) ===
        await service.update_progress(task_id, 28.0, "Parsing HTML content...")

        html_parser = HTMLParser(
            extract_images=process_images and config.extract_images,
            extract_tables=process_tables and config.extract_tables,
            extract_links=follow_links and current_depth < max_depth,
            min_text_length=config.min_text_length,
            max_images=config.max_images,
            max_tables=config.max_tables,
            max_links=config.max_crawl_urls * 2,
        )
        parsed: ParsedContent = html_parser.parse(fetch_result.content, url)

        if len(parsed.main_text) < config.min_text_length:
            await service.fail_task(
                task_id,
                f"Extracted text too short ({len(parsed.main_text)} chars, min {config.min_text_length})",
            )
            return

        link_info = f", {len(parsed.links)} links" if parsed.links else ""
        await service.update_progress(
            task_id, 40.0,
            f"Parsed: {len(parsed.main_text)} chars, {len(parsed.images)} images, {len(parsed.tables)} tables{link_info}",
            detail={
                "title": parsed.title,
                "text_length": len(parsed.main_text),
                "image_count": len(parsed.images),
                "table_count": len(parsed.tables),
                "link_count": len(parsed.links),
            },
        )

        task = service.get_task(task_id)
        if task and task.status == TaskStatus.CANCELLED:
            return

        # === Phase 4: Insert text (40% -> 60%) ===
        await service.update_progress(task_id, 42.0, "Inserting text content into knowledge graph...")

        # Build text with title and description for richer context
        text_parts = []
        if parsed.title:
            text_parts.append(f"# {parsed.title}\n")
        if parsed.description:
            text_parts.append(f"{parsed.description}\n")
        text_parts.append(parsed.main_text)
        combined_text = "\n".join(text_parts)

        # Chunk text if it exceeds max size
        chunks = _chunk_text(combined_text, config.max_text_chunk_size)
        if len(chunks) > 1:
            await service.update_progress(
                task_id, 45.0,
                f"Splitting into {len(chunks)} chunks for processing...",
            )

        for ci, chunk in enumerate(chunks):
            await rag.ainsert(chunk, file_paths=file_label, doc_nms=parsed.title or file_label)
            if len(chunks) > 1:
                chunk_progress = 42.0 + (18.0 * ((ci + 1) / len(chunks)))
                await service.update_progress(
                    task_id, chunk_progress,
                    f"Inserted chunk {ci + 1}/{len(chunks)}",
                )

        logger.info(f"[Task {task_id}] Inserted {len(chunks)} chunk(s) from {url}")

        await service.update_progress(task_id, 60.0, "Text content inserted")

        task = service.get_task(task_id)
        if task and task.status == TaskStatus.CANCELLED:
            return

        # === Phase 5: Process multimodal content (60% -> 95%) ===
        results: List[Dict[str, Any]] = []
        errors: List[str] = []
        multimodal_items = []

        if process_images and parsed.images:
            for img in parsed.images:
                multimodal_items.append({"type": "image", "data": img})
        if process_tables and parsed.tables:
            for tbl in parsed.tables:
                multimodal_items.append({"type": "table", "data": tbl})

        if not multimodal_items:
            await service.update_progress(task_id, 95.0, "No multimodal content to process")
        elif not _vlm_model_func and not _llm_model_func:
            await service.update_progress(
                task_id, 95.0,
                f"Skipping {len(multimodal_items)} multimodal items (no model configured)",
            )
        else:
            has_multimodal = True

            # Look up doc_id by file_label to sync doc status
            try:
                doc = await rag.doc_status.get_doc_by_file_path(file_label)
                if doc and "id" in doc:
                    doc_id_for_status = doc["id"]
                    from lightrag.base import DocStatus
                    await _update_doc_status(rag, doc_id_for_status, DocStatus.PROCESSING)
            except Exception as e:
                logger.warning(f"[Task {task_id}] Failed to look up doc for status sync: {e}")
            await service.update_progress(
                task_id, 62.0,
                f"Processing {len(multimodal_items)} multimodal items...",
            )

            from lightrag.multimodal.config import MultimodalConfig
            from lightrag.multimodal.context import ContextConfig, ContextExtractor
            from lightrag.multimodal.processors import (
                ImageModalProcessor,
                TableModalProcessor,
            )

            mm_config = MultimodalConfig()
            context_config = ContextConfig(
                context_window=mm_config.context_window,
                context_mode=mm_config.context_mode,
                max_context_tokens=mm_config.max_context_tokens,
                include_headers=mm_config.include_headers,
                include_captions=mm_config.include_captions,
                filter_content_types=mm_config.context_filter_content_types,
            )
            context_extractor = ContextExtractor(
                config=context_config,
                tokenizer=rag.tokenizer,
            )

            caption_func = _vlm_model_func or _llm_model_func
            llm_func = _llm_model_func or caption_func

            image_processor = None
            table_processor = None

            if process_images and mm_config.enable_image_processing:
                image_processor = ImageModalProcessor(
                    lightrag=rag,
                    modal_caption_func=caption_func,
                    context_extractor=context_extractor,
                    response_language=mm_config.vlm_response_language,
                )
            if process_tables and mm_config.enable_table_processing:
                table_processor = TableModalProcessor(
                    lightrag=rag,
                    modal_caption_func=llm_func,
                    context_extractor=context_extractor,
                    response_language=mm_config.vlm_response_language,
                    vlm_caption_func=_vlm_model_func,
                )

            # Build a minimal content_list for context
            content_list = [{"type": "text", "text": combined_text, "page_idx": 0}]
            img_offset = 1
            for img in parsed.images if process_images else []:
                content_list.append({
                    "type": "image",
                    "image_caption": [img.alt] if img.alt else [],
                    "page_idx": 0,
                    "_index": img_offset,
                })
                img_offset += 1
            for tbl_idx, tbl in enumerate(parsed.tables if process_tables else []):
                content_list.append({
                    "type": "table",
                    "table_body": tbl.markdown or tbl.html,
                    "table_caption": [tbl.caption] if tbl.caption else [],
                    "page_idx": 0,
                    "_index": img_offset + tbl_idx,
                })

            if image_processor:
                image_processor.set_content_source(content_list, mm_config.content_format)
            if table_processor:
                table_processor.set_content_source(content_list, mm_config.content_format)

            # Initialize document instructions with custom prompts
            for proc in [image_processor, table_processor]:
                if proc:
                    proc.set_document_instructions(
                        document_prompt=document_prompt,
                        image_prompt=image_prompt,
                        table_prompt=table_prompt,
                    )

            total_items = len(multimodal_items)
            progress_range = 33.0  # 62% -> 95%

            # Accumulate per-page analysis results for sibling context
            page_analyses: dict[int, list[dict]] = {}

            for i, mm_item in enumerate(multimodal_items):
                task = service.get_task(task_id)
                if task and task.status == TaskStatus.CANCELLED:
                    return

                item_type = mm_item["type"]
                item_data = mm_item["data"]
                item_progress = 62.0 + (progress_range * (i / total_items))

                await service.update_progress(
                    task_id, item_progress,
                    f"Processing {item_type} {i + 1}/{total_items}",
                    detail={"current_item": i + 1, "total_items": total_items, "type": item_type},
                )

                try:
                    if item_type == "image" and image_processor:
                        # Download image
                        img_data = item_data  # ExtractedImage
                        success, img_bytes, err = await fetcher.fetch_bytes(img_data.src)

                        if not success:
                            errors.append(f"Failed to download image {img_data.src}: {err}")
                            results.append({"type": "image", "src": img_data.src, "success": False, "error": err})
                            continue

                        # Check size limit
                        if len(img_bytes) > config.max_image_size_mb * 1024 * 1024:
                            errors.append(f"Image too large: {img_data.src}")
                            results.append({"type": "image", "src": img_data.src, "success": False, "error": "too large"})
                            continue

                        img_b64 = base64.b64encode(img_bytes).decode("utf-8")
                        modal_content = {
                            "type": "image",
                            "img_data": img_b64,
                            "page_idx": 0,
                            "_index": i + 1,
                            "alt": img_data.alt,
                            "context": img_data.context,
                        }

                        item_info = {
                            "page_idx": 0,
                            "index": i + 1,
                            "source_url": img_data.src,
                            "sibling_analyses": page_analyses.get(0, []),
                        }
                        result = await image_processor.process_multimodal_content(
                            modal_content=modal_content,
                            content_type="image",
                            file_path=file_label,
                            item_info=item_info,
                            doc_id=None,
                            chunk_order_index=i + 1,
                        )

                        # Handle skipped items (e.g., decorative image)
                        if result is None:
                            results.append({"type": "image", "src": img_data.src, "success": True, "skipped": True})
                            continue

                        entity_info = result[1] if len(result) > 1 else {}
                        description_text = result[0] if len(result) > 0 else ""
                        description_summary = (
                            (description_text[:200] + "...") if len(description_text) > 200 else description_text
                        ) if description_text else ""

                        results.append({
                            "type": "image",
                            "src": img_data.src,
                            "success": True,
                            "entity_name": entity_info.get("entity_name"),
                            "entity_type": entity_info.get("entity_type"),
                            "description": description_summary,
                            "chunk_id": entity_info.get("chunk_id"),
                            "s3_url": entity_info.get("s3_url"),
                        })

                        # Accumulate sibling analysis
                        if description_text and entity_info.get("entity_name"):
                            page_analyses.setdefault(0, []).append({
                                "type": "image",
                                "entity_name": entity_info.get("entity_name", ""),
                                "description": description_text[:300],
                            })

                    elif item_type == "table" and table_processor:
                        tbl_data = item_data  # ExtractedTable
                        modal_content = {
                            "type": "table",
                            "table_body": tbl_data.markdown or tbl_data.html,
                            "table_caption": [tbl_data.caption] if tbl_data.caption else [],
                            "table_footnote": [],
                            "page_idx": 0,
                            "_index": i + 1,
                        }

                        item_info = {
                            "page_idx": 0,
                            "index": i + 1,
                            "sibling_analyses": page_analyses.get(0, []),
                        }
                        result = await table_processor.process_multimodal_content(
                            modal_content=modal_content,
                            content_type="table",
                            file_path=file_label,
                            item_info=item_info,
                            doc_id=None,
                            chunk_order_index=i + 1,
                        )
                        entity_info = result[1] if len(result) > 1 else {}
                        description_text = result[0] if len(result) > 0 else ""
                        description_summary = (
                            (description_text[:200] + "...") if len(description_text) > 200 else description_text
                        ) if description_text else ""

                        results.append({
                            "type": "table",
                            "caption": tbl_data.caption,
                            "success": True,
                            "entity_name": entity_info.get("entity_name"),
                            "entity_type": entity_info.get("entity_type"),
                            "description": description_summary,
                            "chunk_id": entity_info.get("chunk_id"),
                        })

                        # Accumulate sibling analysis
                        if description_text and entity_info.get("entity_name"):
                            page_analyses.setdefault(0, []).append({
                                "type": "table",
                                "entity_name": entity_info.get("entity_name", ""),
                                "description": description_text[:300],
                            })

                except Exception as e:
                    error_msg = f"Failed to process {item_type}: {str(e)}"
                    logger.error(f"[Task {task_id}] {error_msg}")
                    errors.append(error_msg)
                    results.append({"type": item_type, "success": False, "error": str(e)})

        # === Phase 6: Crawl sub-URLs (95% -> 98%) ===
        spawned_tasks = []
        if follow_links and current_depth < max_depth and parsed.links:
            # Filter to internal links only if configured
            crawl_links = parsed.links
            if config.crawl_same_domain_only:
                crawl_links = [lnk for lnk in crawl_links if lnk.is_internal]

            # Limit to max_crawl_urls
            crawl_links = crawl_links[:config.max_crawl_urls]

            if crawl_links:
                await service.update_progress(
                    task_id, 96.0,
                    f"Spawning {len(crawl_links)} sub-URL tasks (depth {current_depth + 1}/{max_depth})...",
                )

                detector = URLDetector()
                for lnk in crawl_links:
                    lnk_info = detector.get_info(lnk.url)
                    if not lnk_info.is_valid:
                        continue

                    lnk_label = lnk_info.normalized_url

                    # Skip duplicates
                    is_dup = await _check_duplicate(rag, lnk_label)
                    if is_dup:
                        continue

                    child_task = service.create_task(
                        task_type=TaskType.URL_INGEST,
                        workspace=workspace,
                        metadata={
                            "url": lnk_info.normalized_url,
                            "domain": lnk_info.domain,
                            "file_path_label": lnk_label,
                            "process_images": process_images,
                            "process_tables": process_tables,
                            "parent_task_id": task_id,
                            "crawl_depth": current_depth + 1,
                        },
                    )

                    service.run_in_background(
                        child_task.task_id,
                        _ingest_url_background,
                        task_id=child_task.task_id,
                        rag=rag,
                        url=lnk_info.normalized_url,
                        file_label=lnk_label,
                        process_images=process_images,
                        process_tables=process_tables,
                        config=config,
                        workspace=workspace,
                        follow_links=True,
                        max_depth=max_depth,
                        current_depth=current_depth + 1,
                        document_prompt=document_prompt,
                        image_prompt=image_prompt,
                        table_prompt=table_prompt,
                    )

                    spawned_tasks.append({
                        "task_id": child_task.task_id,
                        "url": lnk_info.normalized_url,
                    })

                if spawned_tasks:
                    await service.update_progress(
                        task_id, 97.0,
                        f"Spawned {len(spawned_tasks)} sub-URL tasks",
                    )

        # === Phase 7: Complete (100%) ===
        await service.update_progress(task_id, 98.0, "Finalizing...")

        # Restore doc status to PROCESSED now that multimodal processing is done
        if doc_id_for_status and has_multimodal:
            from lightrag.base import DocStatus
            await _update_doc_status(rag, doc_id_for_status, DocStatus.PROCESSED)

        final_result = {
            "success": len(errors) == 0,
            "url": url,
            "title": parsed.title,
            "text_length": len(parsed.main_text),
            "processed_images": len([r for r in results if r.get("type") == "image" and r.get("success")]),
            "processed_tables": len([r for r in results if r.get("type") == "table" and r.get("success")]),
            "total_multimodal": len(multimodal_items),
            "results": results,
            "errors": errors,
            "spawned_tasks": spawned_tasks,
            "crawl_depth": current_depth,
        }

        await service.complete_task(task_id, result=final_result)

    except Exception as e:
        logger.error(f"[Task {task_id}] URL ingestion failed: {e}", exc_info=True)
        # Restore doc status to PROCESSED — text pipeline already completed successfully
        if doc_id_for_status and has_multimodal:
            from lightrag.base import DocStatus
            await _update_doc_status(rag, doc_id_for_status, DocStatus.PROCESSED)
        await service.fail_task(task_id, str(e))


async def _update_doc_status(rag, doc_id: str, status: str, max_retries=5, delay=1.0):
    """Update document status (with retry for pipeline timing)."""
    for attempt in range(max_retries):
        try:
            doc_data = await rag.doc_status.get_by_id(doc_id)
            if doc_data:
                doc_data["status"] = status
                doc_data["updated_at"] = datetime.datetime.now(timezone.utc).isoformat()
                await rag.doc_status.upsert({doc_id: doc_data})
                logger.info(f"Updated doc status for {doc_id}: {status}")
                return True
            if attempt < max_retries - 1:
                await asyncio.sleep(delay)
        except Exception as e:
            if attempt < max_retries - 1:
                await asyncio.sleep(delay)
            else:
                logger.warning(f"Failed to update doc status for {doc_id}: {e}")
    return False


def create_url_routes() -> APIRouter:
    """Create and return the URL routes API router."""
    return router
