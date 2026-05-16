"""
Board API knowledge ingestion routes.

Provides endpoints for:
- Exploring REST API board/BBS endpoints and auto-detecting field mappings
- Ingesting board posts into the knowledge graph (async)
"""

import base64
import hashlib
import io
import json
import os
import re
import struct
import tempfile
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from lightrag.utils import logger, compute_mdhash_id

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

_llm_model_func = None
_vlm_model_func = None


def set_llm_model_func(func):
    """Set the LLM model function for field detection and table analysis."""
    global _llm_model_func
    _llm_model_func = func


def set_vlm_model_func(func):
    """Set the VLM model function for image analysis."""
    global _vlm_model_func
    _vlm_model_func = func


# ============================================================================
# Heuristic field candidates
# ============================================================================

TITLE_CANDIDATES = ["title", "subject", "name", "heading", "제목"]
BODY_CANDIDATES = ["content", "body", "text", "description", "html", "내용", "본문"]
ID_CANDIDATES = ["id", "idx", "seq", "no", "postId", "boardId", "articleId", "num"]
DATE_CANDIDATES = ["date", "created", "createdAt", "created_at", "reg_date", "writeDate",
                    "createdDate", "createDate", "regDate", "updatedAt", "날짜"]
AUTHOR_CANDIDATES = ["author", "writer", "user", "userName", "nickname", "작성자", "name"]
ATTACH_CANDIDATES = ["attachments", "files", "fileList", "attach", "첨부", "attachedFiles"]

ARRAY_KEY_PRIORITY = ["data", "items", "results", "list", "records", "rows", "content", "posts",
                      "articles", "entries", "board", "documents"]

# ============================================================================
# Request/Response Models
# ============================================================================


class FieldMapping(BaseModel):
    items_path: str = ""
    title_field: str = ""
    body_field: str = ""
    id_field: Optional[str] = None
    date_field: Optional[str] = None
    author_field: Optional[str] = None
    attachments_field: Optional[str] = None
    attachment_url_field: Optional[str] = None   # key for file URL/path inside each attachment object
    attachment_name_field: Optional[str] = None  # key for display name inside each attachment object
    detail_url_template: Optional[str] = None
    pagination_type: Optional[str] = None
    page_param: Optional[str] = None
    page_size_param: Optional[str] = None
    total_field: Optional[str] = None
    cursor_field: Optional[str] = None


class BoardExploreRequest(BaseModel):
    api_url: str
    method: str = "GET"
    headers: Optional[Dict[str, str]] = None
    params: Optional[Dict[str, str]] = None
    body: Optional[Dict[str, Any]] = None
    base_url: Optional[str] = None
    user_mapping: Optional[FieldMapping] = None


class BoardExploreResponse(BaseModel):
    success: bool
    sample_data: Optional[Dict[str, Any]] = None
    detected_mapping: Optional[FieldMapping] = None
    detected_items_count: int = 0
    sample_item: Optional[Dict[str, Any]] = None
    alternative_mappings: List[FieldMapping] = []
    detection_method: str = "heuristic"
    llm_confidence: Optional[str] = None
    llm_notes: Optional[str] = None
    error: Optional[str] = None


class BoardIngestRequest(BaseModel):
    api_url: str
    method: str = "GET"
    headers: Optional[Dict[str, str]] = None
    params: Optional[Dict[str, str]] = None
    body: Optional[Dict[str, Any]] = None
    field_mapping: FieldMapping
    max_pages: int = 50
    page_size: int = 20
    process_images: bool = True
    process_tables: bool = True
    process_documents: bool = True
    parser: str = "docling"
    skip_duplicates: bool = True
    update_existing: bool = False
    fetch_detail: bool = False
    base_url: Optional[str] = None
    document_prompt: Optional[str] = None
    image_prompt: Optional[str] = None
    table_prompt: Optional[str] = None


class BoardIngestResponse(BaseModel):
    task_id: str
    stream_url: str
    message: str


class BoardDeleteRequest(BaseModel):
    api_url: str
    item_ids: List[str]


class BoardDeleteResponse(BaseModel):
    deleted_items: int
    deleted_docs: int
    not_found: List[str]
    errors: List[str]


class BoardViewRequest(BaseModel):
    file_path: str  # e.g. "https://host/api/posts/123"


class BoardViewResponse(BaseModel):
    success: bool
    title: str = ""
    body: str = ""
    date: str = ""
    author: str = ""
    attachments: list = []
    raw_data: Dict[str, Any] = {}
    error: str = ""


# ============================================================================
# Router
# ============================================================================

router = APIRouter(prefix="/api/board", tags=["Board API Ingestion"])


# ============================================================================
# Helpers
# ============================================================================


def _sanitize_headers(headers: Optional[Dict[str, str]]) -> Optional[Dict[str, str]]:
    """Clean up header values: collapse multiple spaces, strip whitespace."""
    if not headers:
        return headers
    cleaned = {}
    for k, v in headers.items():
        # Collapse multiple spaces into one (common when pasting Bearer tokens)
        cleaned_val = re.sub(r'\s+', ' ', v.strip())
        cleaned[k.strip()] = cleaned_val
    return cleaned


def _resolve_url(url: str, base_url: Optional[str], api_url: str) -> str:
    """Resolve relative URL to absolute URL."""
    if url.startswith(("http://", "https://")):
        return url
    parsed = urlparse(api_url)
    effective_base = base_url or f"{parsed.scheme}://{parsed.netloc}"
    return urljoin(effective_base.rstrip("/") + "/", url.lstrip("/"))


_ATT_URL_KEYS = ("filePath", "file_path", "url", "download_url", "link", "path", "src")
_ATT_NAME_KEYS = ("attachFileNm", "fileName", "file_name", "name", "originalName")

_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"}
_DOCUMENT_EXTENSIONS = {".pdf", ".docx", ".pptx", ".xlsx", ".html", ".htm", ".md", ".csv"}


def _fix_broken_encoding(text: str) -> str:
    """Fix mojibake caused by UTF-8 bytes decoded as Latin-1.

    Some external APIs store UTF-8 filenames but serve them with wrong charset,
    producing garbled strings like 'ë\x8f\x84ì\x8b¬í\x98\x95' instead of '도심형'.
    This attempts latin-1 → bytes → utf-8 recovery; returns original on failure.
    """
    try:
        recovered = text.encode("latin-1").decode("utf-8")
        # Only accept if it actually changed and looks like valid text
        if recovered != text:
            return recovered
    except (UnicodeDecodeError, UnicodeEncodeError):
        pass
    return text


def _classify_attachment(filename: str) -> str:
    """Classify attachment as image/document/other by extension."""
    ext = ("." + filename.lower().rsplit(".", 1)[-1]) if "." in filename else ""
    if ext in _IMAGE_EXTENSIONS:
        return "image"
    if ext in _DOCUMENT_EXTENSIONS:
        return "document"
    return "other"


def _get_image_dimensions(data: bytes) -> Tuple[Optional[int], Optional[int]]:
    """Extract width/height from image bytes without PIL (pure Python).

    Supports PNG, JPEG, GIF, BMP, WebP, SVG.
    Returns (width, height) or (None, None) on failure.
    """
    try:
        # PNG
        if data[:8] == b'\x89PNG\r\n\x1a\n':
            w, h = struct.unpack('>II', data[16:24])
            return w, h
        # JPEG
        if data[:2] == b'\xff\xd8':
            fh = io.BytesIO(data)
            fh.seek(2)
            while True:
                b = fh.read(2)
                if len(b) < 2:
                    break
                marker, = struct.unpack('>H', b)
                if marker in (0xFFD9, 0xFFDA):
                    break
                b2 = fh.read(2)
                if len(b2) < 2:
                    break
                length, = struct.unpack('>H', b2)
                if marker in (0xFFC0, 0xFFC2):
                    fh.read(1)
                    h, w = struct.unpack('>HH', fh.read(4))
                    return w, h
                fh.seek(length - 2, 1)
        # GIF
        if data[:6] in (b'GIF87a', b'GIF89a'):
            w, h = struct.unpack('<HH', data[6:10])
            return w, h
        # BMP
        if data[:2] == b'BM' and len(data) >= 26:
            w, h = struct.unpack('<ii', data[18:26])
            return abs(w), abs(h)
        # WebP
        if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            if data[12:16] == b'VP8 ' and len(data) >= 30:
                w = (data[26] | (data[27] << 8)) & 0x3FFF
                h = (data[28] | (data[29] << 8)) & 0x3FFF
                return w, h
            elif data[12:16] == b'VP8L' and len(data) >= 25:
                bits = struct.unpack('<I', data[21:25])[0]
                w = (bits & 0x3FFF) + 1
                h = ((bits >> 14) & 0x3FFF) + 1
                return w, h
        # SVG — parse width/height or viewBox attributes
        if data[:5] in (b'<?xml', b'<svg ') or b'<svg' in data[:200]:
            return _parse_svg_dimensions(data)
    except Exception:
        pass
    return None, None


def _parse_svg_dimensions(data: bytes) -> Tuple[Optional[int], Optional[int]]:
    """Extract width/height from SVG data via regex on attributes."""
    import re
    try:
        text = data[:2000].decode("utf-8", errors="ignore")
    except Exception:
        return None, None

    # Try width="..." height="..." attributes first
    w_match = re.search(r'<svg[^>]*\bwidth\s*=\s*["\'](\d+(?:\.\d+)?)', text)
    h_match = re.search(r'<svg[^>]*\bheight\s*=\s*["\'](\d+(?:\.\d+)?)', text)
    if w_match and h_match:
        return int(float(w_match.group(1))), int(float(h_match.group(1)))

    # Fallback: viewBox="minX minY width height"
    vb_match = re.search(
        r'viewBox\s*=\s*["\'][\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)', text
    )
    if vb_match:
        return int(float(vb_match.group(1))), int(float(vb_match.group(2)))

    return None, None


def _should_skip_image(
    img_bytes: bytes,
    seen_hashes: Set[str],
    min_width: int = 100,
    min_height: int = 100,
    max_aspect_ratio: float = 10.0,
) -> Optional[str]:
    """Check if an image should be skipped based on dimensions, aspect ratio, and duplicates.

    Returns a skip reason string, or None if the image should be processed.
    """
    # Duplicate check (MD5 hash)
    img_hash = hashlib.md5(img_bytes).hexdigest()
    if img_hash in seen_hashes:
        return "duplicate"
    seen_hashes.add(img_hash)

    # Dimension check
    w, h = _get_image_dimensions(img_bytes)
    if w is not None and h is not None:
        if w < min_width or h < min_height:
            return f"too_small({w}x{h})"
        if w > 0 and h > 0:
            aspect = max(w / h, h / w)
            if aspect > max_aspect_ratio:
                return f"extreme_aspect_ratio({w}x{h}, ratio={aspect:.1f})"
    else:
        # Unknown format: use file size heuristic — icons are typically < 5KB
        if len(img_bytes) < 5 * 1024:
            return f"unknown_format_small_file({len(img_bytes)}B)"

    return None


def _resolve_attachment_urls(
    attachments: list,
    base_url: str,
    api_url: str,
    url_field: str = "",
    name_field: str = "",
) -> list:
    """Resolve relative paths in attachment objects to absolute URLs.

    Priority for URL resolution: base_url → domain from api_url.
    Priority for field lookup: explicit mapping field → fallback candidates.
    Also normalises each attachment to always contain 'url' and 'name' keys
    so the frontend can render them consistently.
    """
    resolved = []
    for att in attachments:
        if isinstance(att, str):
            resolved.append(att if att.startswith(("http://", "https://")) else _resolve_url(att, base_url, api_url))
            continue
        if not isinstance(att, dict):
            resolved.append(att)
            continue

        att_copy = dict(att)

        # Find the URL value: mapped field first, then fallback candidates
        raw_url = ""
        if url_field and att_copy.get(url_field):
            raw_url = str(att_copy[url_field])
        else:
            for k in _ATT_URL_KEYS:
                if att_copy.get(k):
                    raw_url = str(att_copy[k])
                    break

        # Resolve relative → absolute
        if raw_url and not raw_url.startswith(("http://", "https://")):
            raw_url = _resolve_url(raw_url, base_url, api_url)

        # Ensure 'url' key exists for frontend
        if raw_url:
            att_copy["url"] = raw_url

        # Ensure 'name' key exists: mapped field first, then fallback candidates
        if not att_copy.get("name"):
            if name_field and att_copy.get(name_field):
                att_copy["name"] = str(att_copy[name_field])
            else:
                for k in _ATT_NAME_KEYS:
                    if att_copy.get(k):
                        att_copy["name"] = str(att_copy[k])
                        break

        # Fix mojibake in attachment name (UTF-8 decoded as Latin-1)
        if att_copy.get("name"):
            att_copy["name"] = _fix_broken_encoding(att_copy["name"])

        resolved.append(att_copy)
    return resolved


def _get_by_path(data: Any, path: str) -> Any:
    """Access nested dict/list by dot-separated path."""
    if not path:
        return data
    parts = path.split(".")
    current = data
    for part in parts:
        if isinstance(current, dict):
            if part not in current:
                return None
            current = current[part]
        elif isinstance(current, list):
            try:
                current = current[int(part)]
            except (ValueError, IndexError):
                return None
        else:
            return None
    return current


def _find_array_paths(data: Any, prefix: str = "", max_depth: int = 4) -> List[Tuple[str, list]]:
    """Recursively find all array fields in a dict, returning (path, array) tuples."""
    results = []
    if max_depth <= 0:
        return results

    if isinstance(data, list) and len(data) > 0:
        results.append((prefix, data))
        return results

    if isinstance(data, dict):
        # Prioritize known keys first
        sorted_keys = sorted(
            data.keys(),
            key=lambda k: (k.lower() not in [p.lower() for p in ARRAY_KEY_PRIORITY],
                           ARRAY_KEY_PRIORITY.index(k.lower()) if k.lower() in [p.lower() for p in ARRAY_KEY_PRIORITY] else 999)
        )
        for key in sorted_keys:
            child_path = f"{prefix}.{key}" if prefix else key
            child = data[key]
            if isinstance(child, list) and len(child) > 0 and isinstance(child[0], dict):
                results.append((child_path, child))
            elif isinstance(child, dict):
                results.extend(_find_array_paths(child, child_path, max_depth - 1))

    return results


def _match_field(keys: List[str], candidates: List[str]) -> Optional[str]:
    """Find the first key that matches any candidate (case-insensitive)."""
    lower_keys = {k.lower(): k for k in keys}
    for candidate in candidates:
        if candidate.lower() in lower_keys:
            return lower_keys[candidate.lower()]
    return None


def _detect_fields_heuristic(sample_items: List[dict]) -> FieldMapping:
    """Detect field mappings using heuristic keyword matching."""
    if not sample_items:
        return FieldMapping()

    keys = list(sample_items[0].keys())
    mapping = FieldMapping(
        title_field=_match_field(keys, TITLE_CANDIDATES) or "",
        body_field=_match_field(keys, BODY_CANDIDATES) or "",
        id_field=_match_field(keys, ID_CANDIDATES),
        date_field=_match_field(keys, DATE_CANDIDATES),
        author_field=_match_field(keys, AUTHOR_CANDIDATES),
        attachments_field=_match_field(keys, ATTACH_CANDIDATES),
    )
    return mapping


async def _detect_fields_with_llm(
    sample_items: List[dict],
    response_structure: dict,
    llm_func,
) -> Tuple[FieldMapping, str, str]:
    """Use LLM to analyze API response structure and detect field mappings.

    Returns: (FieldMapping, confidence, notes)
    """
    # Truncate large values in sample items for LLM prompt
    truncated_items = []
    for item in sample_items[:2]:
        truncated = {}
        for k, v in item.items():
            if isinstance(v, str) and len(v) > 200:
                truncated[k] = v[:200] + "..."
            elif isinstance(v, list) and len(v) > 3:
                truncated[k] = v[:3]
            else:
                truncated[k] = v
        truncated_items.append(truncated)

    # Build structure summary (excluding the items array)
    structure_summary = {}
    for k, v in response_structure.items():
        if isinstance(v, list):
            structure_summary[k] = f"[Array with {len(v)} items]"
        elif isinstance(v, dict):
            structure_summary[k] = {sk: type(sv).__name__ for sk, sv in v.items()}
        else:
            structure_summary[k] = v

    prompt = f"""You are analyzing a REST API response from a bulletin board/BBS system.
Given the sample data below, identify the field mappings.

## API Response Structure (top-level keys excluding the items array):
{json.dumps(structure_summary, ensure_ascii=False, indent=2)}

## Sample Items (first items from the list):
{json.dumps(truncated_items, ensure_ascii=False, indent=2)}

## Task
Identify which fields correspond to:
1. **title_field**: The post title/subject (required)
2. **body_field**: The post body/content, usually HTML or long text (required)
3. **id_field**: Unique identifier for each post
4. **date_field**: Creation or publication date
5. **author_field**: Author/writer name
6. **attachments_field**: Array of attached files (if present)
7. **attachment_url_field**: Inside each attachment object, the key containing the file URL or relative path (e.g., "filePath", "url", "download_url", "src")
8. **attachment_name_field**: Inside each attachment object, the key containing the display filename (e.g., "attachFileNm", "fileName", "originalName", "name")
9. **detail_url_template**: If body content seems truncated or absent, suggest a detail API URL pattern using {{id}} placeholder

For pagination, analyze the top-level response structure:
10. **pagination_type**: "page_param" | "offset_limit" | "cursor" | "none"
11. **page_param**: Query parameter name for page number
12. **page_size_param**: Query parameter name for page size
13. **total_field**: JSON path to total count (e.g., "data.totalCount")
14. **cursor_field**: Field containing next page cursor/token

Respond ONLY in JSON format (no markdown code blocks):
{{
  "title_field": "...",
  "body_field": "...",
  "id_field": "..." or null,
  "date_field": "..." or null,
  "author_field": "..." or null,
  "attachments_field": "..." or null,
  "attachment_url_field": "..." or null,
  "attachment_name_field": "..." or null,
  "detail_url_template": "..." or null,
  "pagination_type": "...",
  "page_param": "..." or null,
  "page_size_param": "..." or null,
  "total_field": "..." or null,
  "cursor_field": "..." or null,
  "confidence": "high" | "medium" | "low",
  "notes": "Any observations about the API structure"
}}"""

    try:
        response = await llm_func(prompt)
        # Extract JSON from response (handle potential markdown wrapping)
        json_match = re.search(r'\{[\s\S]*\}', response)
        if not json_match:
            raise ValueError("No JSON found in LLM response")

        result = json.loads(json_match.group())

        mapping = FieldMapping(
            title_field=result.get("title_field", ""),
            body_field=result.get("body_field", ""),
            id_field=result.get("id_field"),
            date_field=result.get("date_field"),
            author_field=result.get("author_field"),
            attachments_field=result.get("attachments_field"),
            attachment_url_field=result.get("attachment_url_field"),
            attachment_name_field=result.get("attachment_name_field"),
            detail_url_template=result.get("detail_url_template"),
            pagination_type=result.get("pagination_type"),
            page_param=result.get("page_param"),
            page_size_param=result.get("page_size_param"),
            total_field=result.get("total_field"),
            cursor_field=result.get("cursor_field"),
        )

        confidence = result.get("confidence", "medium")
        notes = result.get("notes", "")
        return mapping, confidence, notes

    except Exception as e:
        logger.warning(f"LLM field detection failed: {e}")
        raise


def _validate_mapping(data: Any, mapping: FieldMapping) -> Tuple[bool, str, List[dict]]:
    """Validate a field mapping against actual data.

    Returns: (success, error_message, items)
    """
    items = _get_by_path(data, mapping.items_path)
    if items is None:
        return False, f"Path '{mapping.items_path}' not found in response", []
    if not isinstance(items, list):
        return False, f"Path '{mapping.items_path}' is not an array", []
    if len(items) == 0:
        return False, "Items array is empty", []
    if not isinstance(items[0], dict):
        return False, "Items are not objects", []

    sample = items[0]
    missing = []
    if mapping.title_field and mapping.title_field not in sample:
        missing.append(f"title_field '{mapping.title_field}'")
    if mapping.body_field and mapping.body_field not in sample:
        missing.append(f"body_field '{mapping.body_field}'")

    if missing:
        available = list(sample.keys())
        return False, f"Fields not found: {', '.join(missing)}. Available keys: {available}", []

    return True, "", items


def _chunk_text(text: str, max_size: int = 8000) -> List[str]:
    """Split text into chunks respecting paragraph and sentence boundaries."""
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
            current_chunk = f"{current_chunk}\n\n{para}" if current_chunk else para
        else:
            if current_chunk:
                chunks.append(current_chunk)
                current_chunk = ""
            if len(para) <= max_size:
                current_chunk = para
            else:
                sentences = re.split(r'(?<=[.!?])\s+', para)
                for sent in sentences:
                    if len(current_chunk) + len(sent) + 1 <= max_size:
                        current_chunk = f"{current_chunk} {sent}" if current_chunk else sent
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


# ============================================================================
# Explore endpoint
# ============================================================================


@router.post("/explore", response_model=BoardExploreResponse)
async def explore_board(body: BoardExploreRequest, http_request: Request):
    """Explore a board API and detect field mappings.

    Two modes:
    - Auto-detect (user_mapping is None): Calls API, finds arrays, uses LLM to detect fields
    - Manual validation (user_mapping provided): Validates the mapping against actual API data
    """
    # Fetch API response
    sanitized_headers = _sanitize_headers(body.headers)
    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            req_kwargs: Dict[str, Any] = {"url": body.api_url}
            if sanitized_headers:
                req_kwargs["headers"] = sanitized_headers
            if body.params:
                req_kwargs["params"] = body.params
            if body.body and body.method.upper() == "POST":
                req_kwargs["json"] = body.body

            response = await client.request(body.method.upper(), **req_kwargs)
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as e:
        return BoardExploreResponse(
            success=False,
            error=f"API returned HTTP {e.response.status_code}: {e.response.text[:200]}",
        )
    except Exception as e:
        return BoardExploreResponse(
            success=False,
            error=f"Failed to call API: {str(e)}",
        )

    # Truncate sample_data for response (avoid huge payloads)
    sample_data = data
    if isinstance(data, dict):
        sample_data = {}
        for k, v in data.items():
            if isinstance(v, list) and len(v) > 3:
                sample_data[k] = v[:3]
            else:
                sample_data[k] = v
    elif isinstance(data, list) and len(data) > 3:
        sample_data = data[:3]

    # === Manual validation mode ===
    if body.user_mapping is not None:
        success, error, items = _validate_mapping(data, body.user_mapping)
        if not success:
            return BoardExploreResponse(
                success=False,
                sample_data=sample_data if isinstance(sample_data, dict) else {"_root": sample_data},
                error=error,
                detection_method="manual",
            )

        # Build sample item preview with mapping applied
        sample_item = None
        if items:
            raw = items[0]
            sample_item = {
                "title": raw.get(body.user_mapping.title_field, ""),
                "body": str(raw.get(body.user_mapping.body_field, ""))[:300],
                "id": raw.get(body.user_mapping.id_field, "") if body.user_mapping.id_field else None,
                "date": raw.get(body.user_mapping.date_field, "") if body.user_mapping.date_field else None,
                "author": raw.get(body.user_mapping.author_field, "") if body.user_mapping.author_field else None,
                "_raw_keys": list(raw.keys()),
            }

        return BoardExploreResponse(
            success=True,
            sample_data=sample_data if isinstance(sample_data, dict) else {"_root": sample_data},
            detected_mapping=body.user_mapping,
            detected_items_count=len(items),
            sample_item=sample_item,
            detection_method="manual",
        )

    # === Auto-detect mode ===

    # Step A: Find array paths
    if isinstance(data, list):
        array_paths = [("", data)]
    else:
        array_paths = _find_array_paths(data)

    if not array_paths:
        return BoardExploreResponse(
            success=False,
            sample_data=sample_data if isinstance(sample_data, dict) else {"_root": sample_data},
            error="No arrays found in API response. Try manual mode.",
        )

    best_path, best_items = array_paths[0]

    # Step B: LLM-based field detection (with heuristic fallback)
    detected_mapping = None
    confidence = None
    notes = None
    detection_method = "heuristic"

    # Build response structure (excluding the items array)
    response_structure = {}
    if isinstance(data, dict):
        for k, v in data.items():
            path_prefix = best_path.split(".")[0] if best_path else ""
            if k != path_prefix:
                response_structure[k] = v

    if _llm_model_func and best_items and isinstance(best_items[0], dict):
        try:
            detected_mapping, confidence, notes = await _detect_fields_with_llm(
                best_items, response_structure, _llm_model_func
            )
            detected_mapping.items_path = best_path
            detection_method = "llm"
            logger.info(f"LLM field detection succeeded: confidence={confidence}")
        except Exception as e:
            logger.warning(f"LLM detection failed, falling back to heuristic: {e}")

    if detected_mapping is None:
        detected_mapping = _detect_fields_heuristic(best_items)
        detected_mapping.items_path = best_path
        detection_method = "heuristic"

    # Build alternative mappings from other array paths
    alternative_mappings = []
    for alt_path, alt_items in array_paths[1:3]:
        alt_mapping = _detect_fields_heuristic(alt_items)
        alt_mapping.items_path = alt_path
        alternative_mappings.append(alt_mapping)

    # Build sample item preview
    sample_item = None
    if best_items and isinstance(best_items[0], dict):
        raw = best_items[0]
        sample_item = {
            "title": raw.get(detected_mapping.title_field, ""),
            "body": str(raw.get(detected_mapping.body_field, ""))[:300],
            "id": raw.get(detected_mapping.id_field, "") if detected_mapping.id_field else None,
            "date": raw.get(detected_mapping.date_field, "") if detected_mapping.date_field else None,
            "author": raw.get(detected_mapping.author_field, "") if detected_mapping.author_field else None,
            "_raw_keys": list(raw.keys()),
        }

    return BoardExploreResponse(
        success=True,
        sample_data=sample_data if isinstance(sample_data, dict) else {"_root": sample_data},
        detected_mapping=detected_mapping,
        detected_items_count=len(best_items),
        sample_item=sample_item,
        alternative_mappings=alternative_mappings,
        detection_method=detection_method,
        llm_confidence=confidence,
        llm_notes=notes,
    )


# ============================================================================
# Ingest endpoint
# ============================================================================


@router.post("/ingest", response_model=BoardIngestResponse)
async def ingest_board(body: BoardIngestRequest, http_request: Request):
    """Start board ingestion as an async background task.

    Returns immediately with a task_id and stream_url for progress tracking.
    """
    from lightrag.api.task_manager import TaskType, get_task_service

    workspace = _get_workspace_from_request(http_request)
    rag = await get_workspace_rag(workspace)

    if not body.field_mapping.title_field or not body.field_mapping.body_field:
        raise HTTPException(
            status_code=400,
            detail="title_field and body_field are required in field_mapping",
        )

    # Sanitize headers before passing to background task
    body.headers = _sanitize_headers(body.headers)

    service = get_task_service()
    parsed = urlparse(body.api_url)
    domain = parsed.netloc

    task = service.create_task(
        task_type=TaskType.BOARD_INGEST,
        workspace=workspace,
        metadata={
            "api_url": body.api_url,
            "base_url": body.base_url or "",
            "domain": domain,
            "headers": body.headers or {},
            "field_mapping": body.field_mapping.model_dump(),
            "max_pages": body.max_pages,
            "page_size": body.page_size,
            "process_images": body.process_images,
            "process_tables": body.process_tables,
            "process_documents": body.process_documents,
            "parser": body.parser,
            "document_prompt": body.document_prompt or "",
            "image_prompt": body.image_prompt or "",
            "table_prompt": body.table_prompt or "",
        },
    )

    service.run_in_background(
        task.task_id,
        _ingest_board_background,
        task_id=task.task_id,
        rag=rag,
        body=body,
        workspace=workspace,
    )

    return BoardIngestResponse(
        task_id=task.task_id,
        stream_url=f"/api/tasks/{task.task_id}/stream",
        message=f"Board ingestion started for {domain}",
    )


# ============================================================================
# Background Processing
# ============================================================================


async def _fetch_page(
    api_url: str,
    method: str,
    headers: Optional[Dict[str, str]],
    params: Optional[Dict[str, str]],
    body_json: Optional[Dict[str, Any]],
    mapping: FieldMapping,
    page: int,
    page_size: int,
    cursor_value: Optional[str] = None,
) -> Tuple[List[dict], Optional[int], Optional[str]]:
    """Fetch one page of items and return (items, total_count_or_none, next_cursor)."""
    req_params = dict(params or {})

    if mapping.pagination_type == "page_param":
        if mapping.page_param:
            req_params[mapping.page_param] = str(page)
        if mapping.page_size_param:
            req_params[mapping.page_size_param] = str(page_size)
    elif mapping.pagination_type == "offset_limit":
        if mapping.page_param:
            req_params[mapping.page_param] = str((page - 1) * page_size)
        if mapping.page_size_param:
            req_params[mapping.page_size_param] = str(page_size)
    elif mapping.pagination_type == "cursor":
        if cursor_value and mapping.cursor_field:
            req_params[mapping.cursor_field] = cursor_value
        if mapping.page_size_param:
            req_params[mapping.page_size_param] = str(page_size)

    async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
        req_kwargs: Dict[str, Any] = {"url": api_url, "params": req_params}
        if headers:
            req_kwargs["headers"] = headers
        if body_json and method.upper() == "POST":
            req_kwargs["json"] = body_json

        response = await client.request(method.upper(), **req_kwargs)
        response.raise_for_status()
        data = response.json()

    items = _get_by_path(data, mapping.items_path)
    if not isinstance(items, list):
        items = []

    total = None
    if mapping.total_field:
        total_val = _get_by_path(data, mapping.total_field)
        if total_val is not None:
            try:
                total = int(total_val)
            except (ValueError, TypeError):
                pass

    next_cursor = None
    if mapping.pagination_type == "cursor" and mapping.cursor_field:
        next_cursor_val = _get_by_path(data, mapping.cursor_field)
        if next_cursor_val is not None:
            next_cursor = str(next_cursor_val)

    return items, total, next_cursor


async def _fetch_detail(
    detail_url: str,
    headers: Optional[Dict[str, str]],
    mapping: FieldMapping,
) -> Optional[dict]:
    """Fetch detail page for a single post."""
    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            req_kwargs: Dict[str, Any] = {"url": detail_url}
            if headers:
                req_kwargs["headers"] = headers
            response = await client.request("GET", **req_kwargs)
            response.raise_for_status()
            return response.json()
    except Exception as e:
        logger.warning(f"Failed to fetch detail {detail_url}: {e}")
        return None


async def _process_document_attachment(
    *,
    att_bytes: bytes,
    att_name: str,
    att_url: str,
    file_label: str,
    parent_file_path: str,
    rag,
    parser: str = "docling",
    process_images: bool = True,
    process_tables: bool = True,
    document_prompt: str = "",
    image_prompt: str = "",
    table_prompt: str = "",
    task_id: str = None,
    task_service=None,
) -> Dict[str, Any]:
    """Process a document attachment (PDF, DOCX, etc.) using the multimodal pipeline.

    Follows the same pattern as multimodal_routes._process_multimodal_background().
    """
    from lightrag.multimodal.config import MultimodalConfig
    from lightrag.multimodal.context import ContextConfig, ContextExtractor
    from lightrag.multimodal.processors import (
        ImageModalProcessor,
        TableModalProcessor,
        EquationModalProcessor,
    )

    result: Dict[str, Any] = {
        "success": False,
        "text_blocks": 0,
        "multimodal_blocks": 0,
        "errors": [],
    }

    tmp_path = None
    try:
        # 1. Save to temp file
        suffix = os.path.splitext(att_name)[1] if "." in att_name else ""
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(att_bytes)
            tmp_path = tmp.name

        # 2. Parse document
        content_list = []
        if parser == "docling":
            try:
                from lightrag.multimodal.parsers.docling_parser import DoclingMultimodalParser
                doc_parser = DoclingMultimodalParser()
                content_list = doc_parser.parse_document(tmp_path)
            except Exception as docling_err:
                logger.warning(f"Docling failed for {att_name}, falling back to PyMuPDF: {docling_err}")
                from lightrag.multimodal.parsers.pymupdf_parser import PyMuPDFMultimodalParser
                config = MultimodalConfig()
                doc_parser = PyMuPDFMultimodalParser(
                    min_image_width=config.min_image_width,
                    min_image_height=config.min_image_height,
                    max_image_aspect_ratio=config.max_image_aspect_ratio,
                    enable_duplicate_filtering=config.enable_duplicate_filtering,
                )
                content_list = doc_parser.parse_document(
                    tmp_path, extract_images=process_images,
                )
        else:
            from lightrag.multimodal.parsers.pymupdf_parser import PyMuPDFMultimodalParser
            config = MultimodalConfig()
            doc_parser = PyMuPDFMultimodalParser(
                min_image_width=config.min_image_width,
                min_image_height=config.min_image_height,
                max_image_aspect_ratio=config.max_image_aspect_ratio,
                enable_duplicate_filtering=config.enable_duplicate_filtering,
            )
            content_list = doc_parser.parse_document(
                tmp_path, extract_images=process_images,
            )

        # 3. Separate text and multimodal blocks
        text_blocks = []
        multimodal_blocks = []
        for idx, item_c in enumerate(content_list):
            item_c["_index"] = idx
            if item_c.get("type") == "text":
                text_blocks.append(item_c)
            elif item_c.get("type") in ("image", "table", "equation"):
                multimodal_blocks.append(item_c)

        result["text_blocks"] = len(text_blocks)
        result["multimodal_blocks"] = len(multimodal_blocks)

        # Update task: parsing complete
        if task_id and task_service:
            try:
                await task_service.update_progress(
                    task_id, None,
                    f"Parsed {att_name}: {len(text_blocks)} text + {len(multimodal_blocks)} multimodal blocks",
                )
            except Exception:
                pass

        # 4. Insert text
        doc_id = None
        if text_blocks:
            combined_text = "\n\n".join(
                b.get("text", "") for b in text_blocks if b.get("text")
            )
            if combined_text.strip():
                from lightrag.utils import sanitize_text_for_encoding
                cleaned_text = sanitize_text_for_encoding(combined_text)
                doc_id = compute_mdhash_id(cleaned_text, prefix="doc-")
                await rag.ainsert(combined_text, ids=[doc_id], file_paths=[file_label])
                logger.info(f"Inserted {len(text_blocks)} text blocks from attachment {att_name} (doc_id={doc_id})")

                # If multimodal blocks exist, revert status to PROCESSING
                # (ainsert marks it PROCESSED, but multimodal processing is not done yet)
                # Use direct SQL since doc_status.upsert() requires all fields
                if multimodal_blocks and hasattr(rag.doc_status, 'db'):
                    try:
                        sql = """UPDATE LIGHTRAG_DOC_STATUS
                                 SET status='processing', updated_at=CURRENT_TIMESTAMP
                                 WHERE workspace=$1 AND id=$2"""
                        await rag.doc_status.db.execute(
                            sql, {"workspace": rag.doc_status.workspace, "id": doc_id}
                        )
                        logger.info(f"Reverted doc_status to PROCESSING for multimodal: {doc_id}")
                    except Exception as e:
                        logger.warning(f"Failed to revert doc_status to PROCESSING: {e}")

        if not doc_id:
            doc_id = compute_mdhash_id(att_name + att_url, prefix="doc-")
            # Create doc_status for multimodal-only documents
            try:
                import datetime
                from datetime import timezone
                from lightrag.base import DocStatus
                await rag.doc_status.upsert({doc_id: {
                    "status": DocStatus.PROCESSING,
                    "content_summary": f"[Board Attachment] {att_name}",
                    "content_length": 0,
                    "created_at": datetime.datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.datetime.now(timezone.utc).isoformat(),
                    "file_path": file_label,
                }})
            except Exception as e:
                logger.warning(f"Failed to create doc_status for attachment {att_name}: {e}")

        # 5. Update doc_status metadata
        try:
            existing = await rag.doc_status.get_by_id(doc_id)
            if existing:
                metadata = existing.get("metadata") or {}
                metadata["parent_file_path"] = parent_file_path
                metadata["source"] = "board_attachment"
                metadata["source_url"] = att_url
                if document_prompt or image_prompt or table_prompt:
                    metadata["custom_prompts"] = {
                        "document_prompt": document_prompt,
                        "image_prompt": image_prompt,
                        "table_prompt": table_prompt,
                    }
                await rag.doc_status.upsert({doc_id: {"metadata": metadata}})
        except Exception as e:
            logger.warning(f"Failed to update metadata for attachment {att_name}: {e}")

        # 6. Process multimodal blocks
        if multimodal_blocks and (_vlm_model_func or _llm_model_func):
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

            processors = {}
            if process_images and mm_config.enable_image_processing:
                img_proc = ImageModalProcessor(
                    lightrag=rag,
                    modal_caption_func=caption_func,
                    context_extractor=context_extractor,
                    response_language=mm_config.vlm_response_language,
                )
                img_proc.pdf_path = tmp_path
                processors["image"] = img_proc

            if process_tables and mm_config.enable_table_processing:
                tbl_proc = TableModalProcessor(
                    lightrag=rag,
                    modal_caption_func=llm_func,
                    context_extractor=context_extractor,
                    response_language=mm_config.vlm_response_language,
                    vlm_caption_func=_vlm_model_func,
                )
                tbl_proc.pdf_path = tmp_path
                processors["table"] = tbl_proc

            if mm_config.enable_equation_processing:
                processors["equation"] = EquationModalProcessor(
                    lightrag=rag,
                    modal_caption_func=llm_func,
                    context_extractor=context_extractor,
                    response_language=mm_config.vlm_response_language,
                )

            # Set content source and prompts
            for proc in processors.values():
                proc.set_content_source(content_list, mm_config.content_format)
                proc.set_document_instructions(
                    document_prompt=document_prompt,
                    image_prompt=image_prompt,
                    table_prompt=table_prompt,
                )

            # Process each multimodal block
            total_blocks = len(multimodal_blocks)
            page_analyses: dict[int, list[dict]] = {}
            for i, block in enumerate(multimodal_blocks):
                content_type = block.get("type", "")
                processor = processors.get(content_type)
                if not processor:
                    continue

                # Update task progress for multimodal processing
                if task_id and task_service:
                    try:
                        await task_service.update_progress(
                            task_id, None,
                            f"Multimodal: {content_type} {i+1}/{total_blocks} (page {block.get('page_idx', '?')}) - {att_name}",
                        )
                    except Exception as e:
                        logger.warning(f"Failed to update task progress: {e}")

                try:
                    current_page = block.get("page_idx", 0)
                    item_info = {
                        "page_idx": current_page,
                        "index": block.get("_index", 0),
                        "sibling_analyses": page_analyses.get(current_page, []),
                    }
                    proc_result = await processor.process_multimodal_content(
                        modal_content=block,
                        content_type=content_type,
                        file_path=file_label,
                        item_info=item_info,
                        doc_id=doc_id,
                        chunk_order_index=block.get("_index", 0),
                    )
                    if proc_result is None:
                        continue
                    # Accumulate sibling context
                    entity_info = proc_result[1] if len(proc_result) > 1 else {}
                    desc_text = proc_result[0] if len(proc_result) > 0 else ""
                    if desc_text and entity_info.get("entity_name"):
                        page_analyses.setdefault(current_page, []).append({
                            "type": content_type,
                            "entity_name": entity_info.get("entity_name", ""),
                            "description": desc_text[:300],
                        })
                except Exception as e:
                    result["errors"].append(
                        f"Multimodal processing failed ({content_type}, page {block.get('page_idx', '?')}): {str(e)}"
                    )

        # 7. Mark as processed (use direct SQL since upsert requires all fields)
        if doc_id and hasattr(rag.doc_status, 'db'):
            try:
                sql = """UPDATE LIGHTRAG_DOC_STATUS
                         SET status='processed', updated_at=CURRENT_TIMESTAMP
                         WHERE workspace=$1 AND id=$2"""
                await rag.doc_status.db.execute(
                    sql, {"workspace": rag.doc_status.workspace, "id": doc_id}
                )
                logger.info(f"Document attachment marked as processed: {doc_id}")
            except Exception as e:
                logger.warning(f"Failed to mark document as processed: {e}")

        result["success"] = True

    except Exception as e:
        result["errors"].append(f"Document processing failed: {str(e)}")
        logger.error(f"Failed to process document attachment {att_name}: {e}", exc_info=True)
    finally:
        # Cleanup temp file
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    return result


async def _process_board_item(
    item: dict,
    mapping: FieldMapping,
    rag,
    file_label: str,
    process_images: bool,
    process_tables: bool,
    base_url: Optional[str],
    api_url: str,
    body_request_headers: Optional[Dict[str, str]] = None,
    document_prompt: str = "",
    image_prompt: str = "",
    table_prompt: str = "",
    process_documents: bool = True,
    parser: str = "docling",
    task_id: str = None,
    task_service=None,
) -> Dict[str, Any]:
    """Process a single board item: parse HTML body, insert text, handle multimodal + attachments."""
    from lightrag.url.parser import HTMLParser

    title = str(item.get(mapping.title_field, ""))
    body_content = str(item.get(mapping.body_field, ""))
    item_id = str(item.get(mapping.id_field, "")) if mapping.id_field else ""

    # Extract attachments
    attachments = []
    raw_files_field = item.get(mapping.attachments_field) if mapping.attachments_field else None
    logger.info(
        f"[board-debug-item task={task_id}] item_id={item_id} item_keys={list(item.keys())} "
        f"attachments_field={mapping.attachments_field!r} "
        f"raw_files_type={type(raw_files_field).__name__} "
        f"raw_files_value={raw_files_field!r}"
    )
    if mapping.attachments_field and item.get(mapping.attachments_field):
        raw_attachments = item[mapping.attachments_field]
        if isinstance(raw_attachments, list):
            attachments = raw_attachments

    result: Dict[str, Any] = {
        "title": title,
        "id": item_id,
        "success": False,
        "text_inserted": False,
        "images_processed": 0,
        "tables_processed": 0,
        "attachments_processed": 0,
        "documents_processed": 0,
        "errors": [],
    }

    if not body_content.strip() and not attachments:
        result["errors"].append("Empty body content and no attachments")
        return result

    # Check if body is HTML (contains tags)
    is_html = bool(re.search(r'<[a-zA-Z][^>]*>', body_content))

    combined_text = ""
    parsed_images = []
    parsed_tables = []

    if is_html:
        # Resolve relative URLs in HTML before parsing
        if base_url or api_url:
            effective_base = base_url or f"{urlparse(api_url).scheme}://{urlparse(api_url).netloc}"
            # Fix relative src/href attributes
            body_content = re.sub(
                r'(src|href)=["\'](?!https?://|data:)(/[^"\']*)["\']',
                lambda m: f'{m.group(1)}="{urljoin(effective_base.rstrip("/") + "/", m.group(2).lstrip("/"))}"',
                body_content,
            )

        html_parser = HTMLParser(
            extract_images=process_images,
            extract_tables=process_tables,
            extract_links=False,
            min_text_length=0,
            max_images=20,
            max_tables=10,
        )
        parsed = html_parser.parse(body_content, api_url)
        combined_text = parsed.main_text
        parsed_images = parsed.images if process_images else []
        parsed_tables = parsed.tables if process_tables else []
    else:
        combined_text = body_content

    # Build document text with metadata
    text_parts = []
    if title:
        text_parts.append(f"# {title}\n")

    # Add metadata
    meta_parts = []
    if mapping.date_field and item.get(mapping.date_field):
        meta_parts.append(f"Date: {item[mapping.date_field]}")
    if mapping.author_field and item.get(mapping.author_field):
        meta_parts.append(f"Author: {item[mapping.author_field]}")
    if meta_parts:
        text_parts.append(" | ".join(meta_parts) + "\n")

    text_parts.append(combined_text)
    full_text = "\n".join(text_parts)

    if not full_text.strip():
        result["errors"].append("No text content after parsing")
        return result

    # Insert text (generate doc_id for multimodal content linkage)
    doc_id = compute_mdhash_id(full_text[:1000], prefix="doc-")
    try:
        await rag.ainsert(full_text, ids=[doc_id], file_paths=[file_label], doc_nms=[title or file_label])
        result["text_inserted"] = True
    except Exception as e:
        result["errors"].append(f"Text insertion failed: {str(e)}")
        return result

    # Process multimodal content (inline images/tables + image attachments) — requires VLM/LLM
    has_image_attachments = attachments and any(
        _classify_attachment(
            a.get(mapping.attachment_name_field or "", "") or a.get(mapping.attachment_url_field or "", "")
        ) == "image"
        for a in attachments
    ) if attachments else False
    has_multimodal = (parsed_images or parsed_tables or has_image_attachments) and (_vlm_model_func or _llm_model_func)
    logger.info(
        f"[board-debug task={task_id}] item_id={item_id} file_label={file_label} "
        f"attachments_field={mapping.attachments_field!r} "
        f"attachments_count={len(attachments) if attachments else 0} "
        f"attachment_names={[a.get(mapping.attachment_name_field or '', '') or a.get(mapping.attachment_url_field or '', '') for a in (attachments or [])]} "
        f"parsed_images={len(parsed_images)} parsed_tables={len(parsed_tables)} "
        f"has_image_attachments={bool(has_image_attachments)} "
        f"vlm_func_set={_vlm_model_func is not None} llm_func_set={_llm_model_func is not None} "
        f"has_multimodal={bool(has_multimodal)} process_images={process_images} process_documents={process_documents}"
    )
    if has_multimodal:
        try:
            from lightrag.multimodal.config import MultimodalConfig
            from lightrag.multimodal.context import ContextConfig, ContextExtractor
            from lightrag.multimodal.processors import (
                ImageModalProcessor,
                TableModalProcessor,
            )
            from lightrag.url.fetcher import WebFetcher

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

            # Build normalized content_list for ContextExtractor
            content_list = [{"type": "text", "text": full_text, "page_idx": 0}]
            img_offset = 1
            for img in parsed_images:
                content_list.append({
                    "type": "image",
                    "image_caption": [img.alt] if img.alt else [],
                    "page_idx": 0,
                    "_index": img_offset,
                })
                img_offset += 1
            for tbl_idx, tbl in enumerate(parsed_tables):
                content_list.append({
                    "type": "table",
                    "table_body": tbl.markdown or tbl.html,
                    "table_caption": [tbl.caption] if tbl.caption else [],
                    "page_idx": 0,
                    "_index": img_offset + tbl_idx,
                })

            # Create processors (reused for inline content + attachments)
            image_processor = None
            table_processor = None

            if mm_config.enable_image_processing:
                image_processor = ImageModalProcessor(
                    lightrag=rag,
                    modal_caption_func=caption_func,
                    context_extractor=context_extractor,
                    response_language=mm_config.vlm_response_language,
                )
                image_processor.set_content_source(content_list, mm_config.content_format)

            if mm_config.enable_table_processing:
                table_processor = TableModalProcessor(
                    lightrag=rag,
                    modal_caption_func=llm_func,
                    context_extractor=context_extractor,
                    response_language=mm_config.vlm_response_language,
                    vlm_caption_func=_vlm_model_func,
                )
                table_processor.set_content_source(content_list, mm_config.content_format)

            # Initialize document instructions with custom prompts
            for proc in [image_processor, table_processor]:
                if proc:
                    proc.set_document_instructions(
                        document_prompt=document_prompt,
                        image_prompt=image_prompt,
                        table_prompt=table_prompt,
                    )

            # Accumulate per-page analysis results for sibling context
            page_analyses: dict[int, list[dict]] = {}
            seen_img_hashes: Set[str] = set()  # for duplicate image filtering

            # Process inline images
            if parsed_images and image_processor:
                fetcher = WebFetcher(timeout=15, max_retries=1)
                for idx, img in enumerate(parsed_images):
                    try:
                        success, img_bytes, err = await fetcher.fetch_bytes(img.src)
                        if not success:
                            continue
                        if len(img_bytes) > 10 * 1024 * 1024:
                            continue

                        # Dimension / aspect-ratio / duplicate filtering
                        skip_reason = _should_skip_image(img_bytes, seen_img_hashes)
                        if skip_reason:
                            logger.info(f"Skipping inline image ({skip_reason}): {img.src}")
                            continue

                        img_b64 = base64.b64encode(img_bytes).decode("utf-8")
                        modal_content = {
                            "type": "image",
                            "img_data": img_b64,
                            "page_idx": 0,
                            "_index": idx + 1,
                            "alt": img.alt,
                            "context": img.context,
                        }
                        item_info = {
                            "page_idx": 0,
                            "index": idx + 1,
                            "source_url": img.src,
                            "sibling_analyses": page_analyses.get(0, []),
                        }
                        proc_result = await image_processor.process_multimodal_content(
                            modal_content=modal_content,
                            content_type="image",
                            file_path=file_label,
                            item_info=item_info,
                            doc_id=doc_id,
                            chunk_order_index=idx + 1,
                        )
                        if proc_result is None:
                            continue
                        result["images_processed"] += 1
                        # Accumulate sibling analysis
                        entity_info = proc_result[1] if len(proc_result) > 1 else {}
                        desc_text = proc_result[0] if len(proc_result) > 0 else ""
                        if desc_text and entity_info.get("entity_name"):
                            page_analyses.setdefault(0, []).append({
                                "type": "image",
                                "entity_name": entity_info.get("entity_name", ""),
                                "description": desc_text[:300],
                            })
                    except Exception as e:
                        result["errors"].append(f"Image processing failed: {str(e)}")

            # Process inline tables
            if parsed_tables and table_processor:
                for idx, tbl in enumerate(parsed_tables):
                    try:
                        modal_content = {
                            "type": "table",
                            "table_body": tbl.markdown or tbl.html,
                            "table_caption": [tbl.caption] if tbl.caption else [],
                            "table_footnote": [],
                            "page_idx": 0,
                            "_index": idx + 1,
                        }
                        item_info = {
                            "page_idx": 0,
                            "index": idx + 1,
                            "sibling_analyses": page_analyses.get(0, []),
                        }
                        proc_result = await table_processor.process_multimodal_content(
                            modal_content=modal_content,
                            content_type="table",
                            file_path=file_label,
                            item_info=item_info,
                            doc_id=doc_id,
                            chunk_order_index=idx + 1,
                        )
                        result["tables_processed"] += 1
                        # Accumulate sibling analysis
                        entity_info = proc_result[1] if len(proc_result) > 1 else {}
                        desc_text = proc_result[0] if len(proc_result) > 0 else ""
                        if desc_text and entity_info.get("entity_name"):
                            page_analyses.setdefault(0, []).append({
                                "type": "table",
                                "entity_name": entity_info.get("entity_name", ""),
                                "description": desc_text[:300],
                            })
                    except Exception as e:
                        result["errors"].append(f"Table processing failed: {str(e)}")

            # Process image attachments (requires VLM)
            if attachments and image_processor:
                att_url_key = mapping.attachment_url_field
                att_name_key = mapping.attachment_name_field
                for att_idx, att in enumerate(attachments):
                    att_path = ""
                    if att_url_key and att.get(att_url_key):
                        att_path = str(att[att_url_key])
                    else:
                        for k in _ATT_URL_KEYS:
                            if att.get(k):
                                att_path = str(att[k])
                                break
                    att_name = ""
                    if att_name_key and att.get(att_name_key):
                        att_name = str(att[att_name_key])
                    else:
                        for k in _ATT_NAME_KEYS:
                            if att.get(k):
                                att_name = str(att[k])
                                break

                    if not att_path:
                        continue

                    # Fix mojibake in attachment names (UTF-8 decoded as Latin-1)
                    if att_name:
                        att_name = _fix_broken_encoding(att_name)

                    att_url = _resolve_url(att_path, base_url, api_url)
                    att_type = _classify_attachment(att_name or att_path)

                    if att_type == "image":
                        # === Image attachment: VLM processing ===
                        try:
                            async with httpx.AsyncClient(timeout=30.0, verify=False) as dl_client:
                                dl_headers = {}
                                if body_request_headers:
                                    dl_headers.update(body_request_headers)
                                resp = await dl_client.get(att_url, headers=dl_headers)
                                resp.raise_for_status()
                                img_bytes = resp.content
                        except Exception as e:
                            result["errors"].append(f"Attachment download failed ({att_name}): {str(e)}")
                            continue

                        if len(img_bytes) > 10 * 1024 * 1024:
                            result["errors"].append(f"Attachment too large: {att_name}")
                            continue

                        # Dimension / aspect-ratio / duplicate filtering
                        skip_reason = _should_skip_image(img_bytes, seen_img_hashes)
                        if skip_reason:
                            logger.info(f"Skipping image attachment ({skip_reason}): {att_name}")
                            continue

                        img_b64 = base64.b64encode(img_bytes).decode("utf-8")
                        modal_content = {
                            "type": "image",
                            "img_data": img_b64,
                            "page_idx": 0,
                            "_index": att_idx + 100,
                            "alt": att_name,
                            "context": f"Attachment: {att_name}",
                        }
                        item_info_att = {
                            "page_idx": 0,
                            "index": att_idx + 100,
                            "source_url": att_url,
                            "sibling_analyses": page_analyses.get(0, []),
                        }

                        try:
                            att_file_path = f"{title}/att/{att_name}"
                            proc_result = await image_processor.process_multimodal_content(
                                modal_content=modal_content,
                                content_type="image",
                                file_path=att_file_path,
                                item_info=item_info_att,
                                doc_id=doc_id,
                                chunk_order_index=att_idx + 100,
                            )
                            if proc_result is None:
                                continue
                            result["attachments_processed"] += 1
                            logger.info(f"Processed image attachment: {att_name} from {att_url}")
                            # Accumulate sibling analysis
                            entity_info = proc_result[1] if len(proc_result) > 1 else {}
                            desc_text = proc_result[0] if len(proc_result) > 0 else ""
                            if desc_text and entity_info.get("entity_name"):
                                page_analyses.setdefault(0, []).append({
                                    "type": "image",
                                    "entity_name": entity_info.get("entity_name", ""),
                                    "description": desc_text[:300],
                                })
                        except Exception as e:
                            result["errors"].append(f"Attachment VLM processing failed ({att_name}): {str(e)}")

        except ImportError as e:
            result["errors"].append(f"Multimodal processing not available: {str(e)}")

    # Process document attachments independently (no VLM required)
    if attachments and process_documents:
        att_url_key = mapping.attachment_url_field
        att_name_key = mapping.attachment_name_field
        for att in attachments:
            att_path = ""
            if att_url_key and att.get(att_url_key):
                att_path = str(att[att_url_key])
            else:
                for k in _ATT_URL_KEYS:
                    if att.get(k):
                        att_path = str(att[k])
                        break
            att_name = ""
            if att_name_key and att.get(att_name_key):
                att_name = str(att[att_name_key])
            else:
                for k in _ATT_NAME_KEYS:
                    if att.get(k):
                        att_name = str(att[k])
                        break

            if not att_path:
                continue

            if att_name:
                att_name = _fix_broken_encoding(att_name)

            att_type = _classify_attachment(att_name or att_path)
            if att_type != "document":
                continue

            att_url = _resolve_url(att_path, base_url, api_url)
            try:
                async with httpx.AsyncClient(timeout=60.0, verify=False) as dl_client:
                    dl_headers = {}
                    if body_request_headers:
                        dl_headers.update(body_request_headers)
                    resp = await dl_client.get(att_url, headers=dl_headers)
                    resp.raise_for_status()
                    doc_bytes = resp.content

                if len(doc_bytes) > 50 * 1024 * 1024:
                    result["errors"].append(f"Document too large: {att_name}")
                    continue

                doc_file_label = f"{title}/att/{att_name}"
                doc_result = await _process_document_attachment(
                    att_bytes=doc_bytes,
                    att_name=att_name,
                    att_url=att_url,
                    file_label=doc_file_label,
                    parent_file_path=file_label,
                    rag=rag,
                    parser=parser,
                    process_images=process_images,
                    process_tables=process_tables,
                    document_prompt=document_prompt,
                    image_prompt=image_prompt,
                    table_prompt=table_prompt,
                    task_id=task_id,
                    task_service=task_service,
                )
                if doc_result.get("success"):
                    result["documents_processed"] += 1
                    logger.info(
                        f"Processed document attachment: {att_name} "
                        f"(text={doc_result['text_blocks']}, multimodal={doc_result['multimodal_blocks']})"
                    )
                else:
                    result["errors"].extend(doc_result.get("errors", []))
            except Exception as e:
                result["errors"].append(f"Document processing failed ({att_name}): {str(e)}")

    result["success"] = True
    return result


async def _ingest_board_background(
    *,
    task_id: str,
    rag,
    body: BoardIngestRequest,
    workspace: str = "",
) -> None:
    """Background coroutine for board ingestion with progress reporting."""
    from lightrag.api.task_manager import TaskStatus, get_task_service

    service = get_task_service()
    mapping = body.field_mapping
    api_url = body.api_url
    parsed_url = urlparse(api_url)
    domain = parsed_url.netloc

    total_processed = 0
    total_skipped = 0
    total_updated = 0
    total_errors = 0
    all_errors: List[str] = []

    try:
        # === Phase 1: Validate mapping (0-5%) ===
        await service.update_progress(task_id, 2.0, "Validating field mapping...")

        # Fetch first page to validate and get total count
        try:
            first_items, total_count, next_cursor = await _fetch_page(
                api_url, body.method, body.headers, body.params, body.body,
                mapping, page=1, page_size=body.page_size,
            )
        except Exception as e:
            await service.fail_task(task_id, f"Failed to fetch first page: {str(e)}")
            return

        if not first_items:
            await service.fail_task(task_id, "No items found on first page")
            return

        # Validate mapping against actual data
        sample = first_items[0]
        if mapping.title_field and mapping.title_field not in sample:
            await service.fail_task(
                task_id,
                f"title_field '{mapping.title_field}' not found. Available: {list(sample.keys())}",
            )
            return

        if mapping.body_field and mapping.body_field not in sample:
            await service.fail_task(
                task_id,
                f"body_field '{mapping.body_field}' not found. Available: {list(sample.keys())}",
            )
            return

        # Warn if fetch_detail is enabled but detail_url_template is empty
        if body.fetch_detail and not mapping.detail_url_template:
            logger.warning(f"[Task {task_id}] fetch_detail=True but detail_url_template is empty, detail fetching disabled")
            await service.update_progress(
                task_id, 4.0,
                "Warning: fetch_detail enabled but detail_url_template is empty. Detail fetching will be skipped.",
            )
            body.fetch_detail = False

        # Determine effective max pages based on pagination_type
        no_pagination = not mapping.pagination_type or mapping.pagination_type == "none"
        effective_max_pages = 1 if no_pagination else body.max_pages

        # Estimate total pages
        if total_count is not None:
            import math
            estimated_pages = min(math.ceil(total_count / body.page_size), effective_max_pages)
            estimated_total = min(total_count, estimated_pages * body.page_size)
        else:
            estimated_pages = effective_max_pages
            estimated_total = len(first_items) if no_pagination else estimated_pages * body.page_size

        pagination_label = "no pagination (single page)" if no_pagination else f"up to {estimated_pages} pages"
        await service.update_progress(
            task_id, 5.0,
            f"Found {len(first_items)} items. Total: {total_count or 'unknown'}, {pagination_label}",
            detail={"total_count": total_count, "estimated_pages": estimated_pages, "no_pagination": no_pagination},
        )

        task = service.get_task(task_id)
        if task and task.status == TaskStatus.CANCELLED:
            return

        # === Phase 2: Page iteration (5-85%) ===
        progress_range = 80.0  # 5% -> 85%
        global_item_index = 0
        prev_page_ids: set[str] | None = None  # duplicate page detection (id_field)
        prev_page_hash: str | None = None  # duplicate page detection (content hash fallback)

        for page_num in range(1, effective_max_pages + 1):
            task = service.get_task(task_id)
            if task and task.status == TaskStatus.CANCELLED:
                return

            # Fetch page (reuse first page results for page 1)
            if page_num == 1:
                page_items = first_items
            else:
                try:
                    page_items, _, page_cursor = await _fetch_page(
                        api_url, body.method, body.headers, body.params, body.body,
                        mapping, page=page_num, page_size=body.page_size,
                        cursor_value=next_cursor,
                    )
                    next_cursor = page_cursor
                except Exception as e:
                    error_msg = f"Page {page_num} fetch failed: {str(e)}"
                    logger.warning(f"[Task {task_id}] {error_msg}")
                    all_errors.append(error_msg)
                    total_errors += 1
                    continue

            if not page_items:
                # No more items - end pagination
                logger.info(f"[Task {task_id}] No items on page {page_num}, stopping")
                break

            # Detect duplicate pages (API ignoring pagination params)
            if mapping.id_field:
                current_page_ids = {str(it.get(mapping.id_field, "")) for it in page_items}
                if prev_page_ids is not None and current_page_ids == prev_page_ids:
                    logger.info(
                        f"[Task {task_id}] Page {page_num} returned same items as previous page, "
                        f"stopping (API likely ignores pagination)"
                    )
                    break
                prev_page_ids = current_page_ids
            else:
                # Fallback: content hash based duplicate detection when id_field is not set
                import hashlib
                page_hash = hashlib.md5(
                    json.dumps(page_items, sort_keys=True, default=str).encode()
                ).hexdigest()
                if prev_page_hash is not None and page_hash == prev_page_hash:
                    logger.info(
                        f"[Task {task_id}] Page {page_num} content identical to previous, "
                        f"stopping (API likely ignores pagination)"
                    )
                    break
                prev_page_hash = page_hash

            # Cursor pagination: stop when no next cursor is returned
            if mapping.pagination_type == "cursor" and page_num > 1 and not next_cursor:
                logger.info(f"[Task {task_id}] No next cursor on page {page_num}, stopping")
                break

            page_progress_base = 5.0 + (progress_range * ((page_num - 1) / estimated_pages))
            await service.update_progress(
                task_id, page_progress_base,
                f"Processing page {page_num}/{estimated_pages}...",
            )

            for item_idx, item in enumerate(page_items):
                task = service.get_task(task_id)
                if task and task.status == TaskStatus.CANCELLED:
                    return

                global_item_index += 1
                item_id = ""
                if mapping.id_field and item.get(mapping.id_field):
                    item_id = str(item[mapping.id_field])
                else:
                    item_id = str(global_item_index)

                # Build file_label as a real URL: {scheme}://{host}{api_path}/{item_id}
                # Avoid duplicating item_id if api_url already ends with it (single-item URL)
                api_path = parsed_url.path.rstrip('/')
                if item_id and api_path.endswith(f"/{item_id}"):
                    file_label = f"{parsed_url.scheme}://{parsed_url.netloc}{api_path}"
                else:
                    file_label = f"{parsed_url.scheme}://{parsed_url.netloc}{api_path}/{item_id}"

                # Update existing: delete old documents then re-ingest
                if body.update_existing:
                    existing_ids = await rag.doc_status.get_all_doc_ids_by_file_path(file_label)
                    if existing_ids:
                        for doc_id in existing_ids:
                            try:
                                await rag.adelete_by_doc_id(doc_id)
                            except Exception as e:
                                logger.warning(f"[Task {task_id}] Failed to delete document {doc_id}: {e}")
                        total_updated += 1
                elif body.skip_duplicates:
                    is_dup = await _check_duplicate(rag, file_label)
                    if is_dup:
                        total_skipped += 1
                        continue

                # Fetch detail if configured
                if body.fetch_detail and mapping.detail_url_template:
                    detail_url = mapping.detail_url_template.replace("{id}", item_id)
                    detail_url = _resolve_url(detail_url, body.base_url, api_url)
                    detail_data = await _fetch_detail(detail_url, body.headers, mapping)
                    if detail_data:
                        # Merge detail data into item (detail overrides list data)
                        if isinstance(detail_data, dict):
                            # If detail response has items_path, extract the item
                            if mapping.items_path and _get_by_path(detail_data, mapping.items_path):
                                detail_items = _get_by_path(detail_data, mapping.items_path)
                                if isinstance(detail_items, list) and detail_items:
                                    item.update(detail_items[0])
                                elif isinstance(detail_items, dict):
                                    item.update(detail_items)
                            else:
                                item.update(detail_data)

                # Process the item
                try:
                    item_result = await _process_board_item(
                        item=item,
                        mapping=mapping,
                        rag=rag,
                        file_label=file_label,
                        process_images=body.process_images,
                        process_tables=body.process_tables,
                        base_url=body.base_url,
                        api_url=api_url,
                        body_request_headers=body.headers,
                        document_prompt=body.document_prompt or "",
                        image_prompt=body.image_prompt or "",
                        table_prompt=body.table_prompt or "",
                        process_documents=body.process_documents,
                        parser=body.parser or "docling",
                        task_id=task_id,
                        task_service=service,
                    )

                    if item_result["success"]:
                        total_processed += 1
                    else:
                        total_errors += 1
                        all_errors.extend(item_result.get("errors", []))

                except Exception as e:
                    total_errors += 1
                    error_msg = f"Item {item_id} failed: {str(e)}"
                    all_errors.append(error_msg)
                    logger.error(f"[Task {task_id}] {error_msg}")

                # Update progress per item
                if estimated_total > 0:
                    item_progress = 5.0 + (progress_range * (global_item_index / estimated_total))
                    item_progress = min(item_progress, 85.0)
                else:
                    item_progress = page_progress_base + (progress_range / estimated_pages) * (item_idx / len(page_items))

                if global_item_index % 5 == 0 or item_idx == len(page_items) - 1:
                    await service.update_progress(
                        task_id, item_progress,
                        f"Processed {total_processed} items (updated {total_updated}, skipped {total_skipped}, errors {total_errors})",
                        detail={
                            "page": page_num,
                            "processed": total_processed,
                            "updated": total_updated,
                            "skipped": total_skipped,
                            "errors": total_errors,
                        },
                    )

            # Check if we got fewer items than page_size (last page)
            if len(page_items) < body.page_size:
                logger.info(f"[Task {task_id}] Last page reached (got {len(page_items)} < {body.page_size})")
                break

        # === Phase 3: Summary (85-95%) ===
        await service.update_progress(
            task_id, 90.0,
            f"Processed {total_processed} posts, updated {total_updated}, skipped {total_skipped}, errors {total_errors}",
        )

        # === Phase 4: Complete (95-100%) ===
        await service.update_progress(task_id, 98.0, "Finalizing...")

        final_result = {
            "success": total_errors == 0,
            "api_url": api_url,
            "domain": domain,
            "total_processed": total_processed,
            "total_updated": total_updated,
            "total_skipped": total_skipped,
            "total_errors": total_errors,
            "errors": all_errors[:20],  # Limit error list
        }

        await service.complete_task(task_id, result=final_result)

    except Exception as e:
        logger.error(f"[Task {task_id}] Board ingestion failed: {e}", exc_info=True)
        await service.fail_task(task_id, str(e))


# ============================================================================
# Delete endpoint
# ============================================================================


@router.post("/delete", response_model=BoardDeleteResponse)
async def delete_board_items(body: BoardDeleteRequest, http_request: Request):
    """Delete previously ingested board items by their original post IDs.

    Reconstructs the file_path ({api_url}/{item_id}) used during ingestion,
    looks up all associated document chunks, and deletes them.
    """
    workspace = _get_workspace_from_request(http_request)
    rag = await get_workspace_rag(workspace)

    parsed = urlparse(body.api_url)

    deleted_items = 0
    deleted_docs = 0
    not_found: List[str] = []
    errors: List[str] = []

    for item_id in body.item_ids:
        api_path = parsed.path.rstrip('/')
        if item_id and api_path.endswith(f"/{item_id}"):
            file_label = f"{parsed.scheme}://{parsed.netloc}{api_path}"
        else:
            file_label = f"{parsed.scheme}://{parsed.netloc}{api_path}/{item_id}"
        try:
            doc_ids = await rag.doc_status.get_all_doc_ids_by_file_path(file_label)
            if not doc_ids:
                not_found.append(item_id)
                continue

            for doc_id in doc_ids:
                try:
                    await rag.adelete_by_doc_id(doc_id)
                    deleted_docs += 1
                except Exception as e:
                    errors.append(f"item {item_id}, doc {doc_id}: {str(e)}")
                    logger.warning(f"Failed to delete doc {doc_id} for board item {item_id}: {e}")

            deleted_items += 1
        except Exception as e:
            errors.append(f"item {item_id}: {str(e)}")
            logger.error(f"Failed to look up board item {item_id}: {e}")

    return BoardDeleteResponse(
        deleted_items=deleted_items,
        deleted_docs=deleted_docs,
        not_found=not_found,
        errors=errors,
    )


# ============================================================================
# View original board post — helpers
# ============================================================================


def _find_single_item_in_response(data: dict) -> dict:
    """Recursively find the first single-item array in a wrapped API response.

    Handles patterns like: {code, message, result: {results: [{...item...}]}}
    Returns the first dict item found inside the deepest array, or `data` as-is.
    """
    def _search(obj: Any, depth: int = 0) -> Optional[dict]:
        if depth > 5 or not isinstance(obj, dict):
            return None
        for key in ARRAY_KEY_PRIORITY:
            val = obj.get(key)
            if isinstance(val, list) and len(val) > 0 and isinstance(val[0], dict):
                return val[0]
        # Try all dict values (non-priority keys)
        for val in obj.values():
            if isinstance(val, list) and len(val) > 0 and isinstance(val[0], dict):
                return val[0]
            if isinstance(val, dict):
                found = _search(val, depth + 1)
                if found is not None:
                    return found
        return None

    found = _search(data)
    return found if found is not None else data


def _auto_extract_fields(item: dict) -> tuple:
    """Auto-detect title/body/date/author/attachments from a dict using known field name candidates."""
    def _find(candidates: list) -> str:
        for c in candidates:
            if c in item and item[c]:
                return str(item[c])
        # Case-insensitive fallback
        lower_map = {k.lower(): k for k in item}
        for c in candidates:
            real_key = lower_map.get(c.lower())
            if real_key and item[real_key]:
                return str(item[real_key])
        return ""

    title = _find(TITLE_CANDIDATES)
    body = _find(BODY_CANDIDATES)
    date = _find(DATE_CANDIDATES)
    author = _find(AUTHOR_CANDIDATES)

    attachments = []
    for c in ATTACH_CANDIDATES:
        val = item.get(c)
        if isinstance(val, list):
            attachments = val
            break

    return title, body, date, author, attachments


# ============================================================================
# View original board post
# ============================================================================


@router.post("/view", response_model=BoardViewResponse)
async def view_board_post(body: BoardViewRequest, http_request: Request):
    """Fetch and return the original board post content.

    Looks up the ingestion task that created this document to retrieve
    saved API headers and field mapping, then fetches the post from the
    original API.
    """
    from lightrag.api.task_manager import TaskType, get_task_service

    workspace = _get_workspace_from_request(http_request)
    file_path = body.file_path.strip()

    if not file_path.startswith(("http://", "https://")):
        return BoardViewResponse(success=False, error="Invalid URL")

    # Parse file_path: split into base_url and item_id
    # e.g. "https://host/api/posts/123" → base="https://host/api/posts", id="123"
    parsed = urlparse(file_path)
    path_parts = parsed.path.rstrip("/").rsplit("/", 1)
    if len(path_parts) < 2 or not path_parts[1]:
        return BoardViewResponse(success=False, error="Cannot extract item ID from URL")

    item_id = path_parts[1]
    api_base_url = f"{parsed.scheme}://{parsed.netloc}{path_parts[0]}"

    # Find matching board_ingest task with same api_url
    service = get_task_service()
    tasks = service.get_tasks_by_workspace(workspace)

    matching_task = None
    for task in sorted(tasks, key=lambda t: t.created_at, reverse=True):
        if task.task_type != TaskType.BOARD_INGEST:
            continue
        meta = task.metadata or {}
        task_api_url = meta.get("api_url", "")
        # Match: the file_path's base should match the task's api_url base
        # Also handle cases where task api_url already contains the item_id
        task_parsed = urlparse(task_api_url)
        task_base = f"{task_parsed.scheme}://{task_parsed.netloc}{task_parsed.path.rstrip('/')}"
        if task_base == api_base_url:
            matching_task = task
            break
        # Fallback: task api_url itself might be a single-item URL ending with item_id
        task_path_parts = task_parsed.path.rstrip("/").rsplit("/", 1)
        if len(task_path_parts) >= 2:
            task_parent_base = f"{task_parsed.scheme}://{task_parsed.netloc}{task_path_parts[0]}"
            if task_parent_base == api_base_url:
                matching_task = task
                break

    if not matching_task:
        return BoardViewResponse(
            success=False,
            error="No matching board ingestion task found for this URL",
        )

    meta = matching_task.metadata or {}
    headers = meta.get("headers") or {}
    field_mapping_raw = meta.get("field_mapping") or {}

    # Build the detail fetch URL
    detail_url = f"{api_base_url}/{item_id}"

    # detail_url_template: URL 패턴에서 {placeholder} 부분을 실제 ID 값으로 치환.
    # placeholder 이름은 무엇이든 상관없음 — {id}, {_id}, {postId} 등 모두 동일하게 처리.
    # 예: "/api/board/{_id}" → "/api/board/6954e02e..."
    # 주의: 여기서 사용되는 item_id는 file_path URL의 마지막 path segment에서 추출한 값.
    detail_template = field_mapping_raw.get("detail_url_template")
    if detail_template:
        detail_url = re.sub(r"\{[^}]+\}", item_id, detail_template)
        # Ensure absolute URL: relative templates need base_url prefix
        if not detail_url.startswith(("http://", "https://")):
            saved_base_url = meta.get("base_url", "")
            if saved_base_url:
                detail_url = saved_base_url.rstrip("/") + "/" + detail_url.lstrip("/")
            else:
                # Fallback: use scheme+netloc from the original file_path
                detail_url = f"{parsed.scheme}://{parsed.netloc}/{detail_url.lstrip('/')}"

    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            resp = await client.get(detail_url, headers=headers)

            if resp.status_code in (401, 403):
                return BoardViewResponse(
                    success=False,
                    error=f"인증이 만료되었거나 API에 접근할 수 없습니다: {resp.status_code}",
                )

            if resp.status_code >= 400:
                return BoardViewResponse(
                    success=False,
                    error=f"API request failed: {resp.status_code}",
                )

            data = resp.json()
    except httpx.TimeoutException:
        return BoardViewResponse(success=False, error="API request timed out")
    except Exception as e:
        return BoardViewResponse(success=False, error=f"API request failed: {str(e)}")

    # ── Unwrap: extract the actual item from the API response ──
    raw_item = data

    # 1) Try items_path from saved field_mapping
    items_path = field_mapping_raw.get("items_path", "")
    if items_path:
        unwrapped = _get_by_path(data, items_path)
        if isinstance(unwrapped, list) and len(unwrapped) > 0:
            raw_item = unwrapped[0]
        elif isinstance(unwrapped, dict):
            raw_item = unwrapped

    # 2) Fallback: if raw_item still looks like a wrapper (no title-like keys),
    #    auto-detect by searching for the first array in nested dicts
    if raw_item is data and isinstance(data, dict):
        raw_item = _find_single_item_in_response(data)

    # ── Extract fields ──
    title_field = field_mapping_raw.get("title_field", "")
    body_field = field_mapping_raw.get("body_field", "")
    date_field = field_mapping_raw.get("date_field", "")
    author_field = field_mapping_raw.get("author_field", "")
    attachments_field = field_mapping_raw.get("attachments_field", "")

    if title_field or body_field:
        # Use saved mapping
        title = str(_get_by_path(raw_item, title_field) or "") if title_field else ""
        body_content = str(_get_by_path(raw_item, body_field) or "") if body_field else ""
        date = str(_get_by_path(raw_item, date_field) or "") if date_field else ""
        author = str(_get_by_path(raw_item, author_field) or "") if author_field else ""
        attachments = _get_by_path(raw_item, attachments_field) if attachments_field else []
    else:
        # No field_mapping saved — auto-detect using known field name candidates
        title, body_content, date, author, attachments = _auto_extract_fields(raw_item)

    if not isinstance(attachments, list):
        attachments = []

    # Resolve relative URLs in attachments
    if attachments:
        saved_base_url = meta.get("base_url", "")
        saved_api_url = meta.get("api_url", "")
        att_url_field = field_mapping_raw.get("attachment_url_field", "")
        att_name_field = field_mapping_raw.get("attachment_name_field", "")
        attachments = _resolve_attachment_urls(
            attachments, saved_base_url, saved_api_url,
            url_field=att_url_field or "",
            name_field=att_name_field or "",
        )

    return BoardViewResponse(
        success=True,
        title=title,
        body=body_content,
        date=date,
        author=author,
        attachments=attachments,
        raw_data=raw_item if isinstance(raw_item, dict) else data if isinstance(data, dict) else {},
    )


# ============================================================================
# Router factory
# ============================================================================


def create_board_routes() -> APIRouter:
    """Create and return the board routes API router."""
    return router
