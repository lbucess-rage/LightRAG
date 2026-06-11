from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field

from ..config import settings
from ..db import db
from ..dependencies import audit_log, get_current_user
from ..lightrag_client import http_error_detail, lightrag_client

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


class KnowledgeMetadataRequest(BaseModel):
    title: str = Field(min_length=1)
    body: str | None = None
    tenant_id: str | None = None
    category_id: str | None = None
    enabled: bool = True
    valid_from: datetime | None = None
    valid_until: datetime | None = None
    kms_workspace: str | None = None
    faq_workspace: str | None = None
    metadata: dict = Field(default_factory=dict)


class KnowledgeBaseRequest(KnowledgeMetadataRequest):
    body: str = Field(min_length=1)


class TextKnowledgeRequest(KnowledgeBaseRequest):
    file_source: str | None = None


class TextsKnowledgeRequest(KnowledgeMetadataRequest):
    texts: list[str] = Field(min_length=1)
    file_sources: list[str] | None = None


class UrlKnowledgeRequest(KnowledgeMetadataRequest):
    url: str = Field(min_length=1)
    file_path_label: str | None = None
    process_images: bool = True
    process_tables: bool = True
    skip_duplicates: bool = True
    force_reindex: bool = False
    follow_links: bool = False
    max_depth: int = 2
    document_prompt: str | None = None
    image_prompt: str | None = None
    table_prompt: str | None = None


class UrlBatchKnowledgeRequest(KnowledgeMetadataRequest):
    urls: list[str] = Field(min_length=1)
    process_images: bool = True
    process_tables: bool = True
    skip_duplicates: bool = True
    force_reindex: bool = False
    follow_links: bool = False
    max_depth: int = 2
    document_prompt: str | None = None
    image_prompt: str | None = None
    table_prompt: str | None = None


class BoardKnowledgeRequest(KnowledgeMetadataRequest):
    api_url: str = Field(min_length=1)
    method: str = "GET"
    headers: dict[str, str] | None = None
    params: dict[str, str] | None = None
    request_body: dict[str, Any] | None = None
    field_mapping: dict[str, Any]
    max_pages: int = 50
    page_size: int = 20
    process_images: bool = True
    process_tables: bool = True
    process_documents: bool = True
    parser: str = "docling"
    skip_duplicates: bool = True
    update_existing: bool = False
    fetch_detail: bool = False
    base_url: str | None = None
    document_prompt: str | None = None
    image_prompt: str | None = None
    table_prompt: str | None = None


class ScanKnowledgeRequest(KnowledgeMetadataRequest):
    title: str = "입력 폴더 스캔"
    body: str | None = "LightRAG input directory scan"


class FaqKnowledgeRequest(KnowledgeBaseRequest):
    approved_summary: str | None = None
    guidance: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    status: str = "draft"


class FaqSourceGuidanceRequest(BaseModel):
    guidance_type: str = "keyword"
    text: str = Field(min_length=1)
    weight: float = Field(default=1.0, ge=0.0, le=10.0)
    source: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class FaqSourceDraftKnowledgeRequest(KnowledgeBaseRequest):
    source_type: str = "plain"
    source_uri: str | None = None
    file_name: str | None = None
    approved_summary: str | None = None
    content_format: str = "markdown"
    display_policy: str = "both"
    status: str = "draft"
    priority: int = 0
    tags: list[str] = Field(default_factory=list)
    source_profile: dict[str, Any] = Field(default_factory=dict)
    guidance: list[FaqSourceGuidanceRequest] = Field(default_factory=list)


class FaqAnswerUpdateRequest(BaseModel):
    title: str | None = None
    body: str | None = None
    approved_summary: str | None = None
    status: str | None = None
    valid_from: datetime | None = None
    valid_until: datetime | None = None
    tags: list[str] | None = None
    metadata: dict[str, Any] | None = None


def _faq_answer_update_body(payload: FaqAnswerUpdateRequest) -> dict[str, Any]:
    return payload.model_dump(mode="json", exclude_unset=True)


class FaqGuidanceCreateRequest(BaseModel):
    guidance_type: str = "keyword"
    text: str = Field(min_length=1)
    weight: float = Field(default=1.0, ge=0.0, le=10.0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class FaqCandidateSearchRequest(BaseModel):
    query: str = Field(min_length=1)
    top_k: int = Field(default=5, ge=1, le=20)
    min_score: float = Field(default=0.18, ge=0.0, le=1.0)
    include_drafts: bool = True
    strategy: str = "balanced"
    retrieval_mode: str = "keyword"
    vector_top_k: int = Field(default=8, ge=1, le=50)
    llm_candidate_count: int = Field(default=5, ge=1, le=10)
    allowed_answer_ids: list[str] | None = None
    response_policy: str | None = None
    include_candidates: bool = True


class ExistingKnowledgeRefRequest(BaseModel):
    id: str = Field(min_length=1)
    title: str | None = None
    summary: str | None = None
    status: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ExistingKnowledgeLinkRequest(BaseModel):
    tenant_id: str | None = None
    category_id: str | None = None
    enabled: bool = True
    valid_from: datetime | None = None
    valid_until: datetime | None = None
    kms_workspace: str | None = None
    faq_workspace: str | None = None
    link_all: bool = False
    include_kms: bool = True
    include_faq: bool = True
    documents: list[ExistingKnowledgeRefRequest] = Field(default_factory=list)
    faq_answers: list[ExistingKnowledgeRefRequest] = Field(default_factory=list)
    max_items: int = Field(default=1000, ge=1, le=5000)


class DocumentDeleteRequest(BaseModel):
    delete_file: bool = False
    delete_llm_cache: bool = False
    delete_s3_file: bool = False


class DocumentReingestRequest(KnowledgeBaseRequest):
    file_source: str | None = None
    delete_previous: bool = True


class ChunkUpdateRequest(BaseModel):
    content: str | None = None
    structured_content: Any | None = None
    clear_structured_content: bool = False
    invalidate_cache: bool = True


class DeletionRelationSelector(BaseModel):
    source_id: str = Field(min_length=1)
    target_id: str = Field(min_length=1)


class KmsDeletionRequest(BaseModel):
    target_type: str = Field(pattern="^(document|chunk|entity|relation)$")
    policy: str = "cascade_safe"
    ids: list[str] = Field(default_factory=list)
    relations: list[DeletionRelationSelector] = Field(default_factory=list)
    delete_file: bool = False
    delete_s3_file: bool = False
    delete_llm_cache: bool = False
    invalidate_cache: bool = True


class KmsDeletionRestoreRequest(BaseModel):
    overwrite: bool = False
    invalidate_cache: bool = True


class KmsEntitiesRequest(BaseModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)
    search: str | None = None
    entity_type: str | None = None
    sort_field: str = "entity_id"
    sort_direction: str = "asc"


class KmsRelationsRequest(BaseModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)
    search: str | None = None
    sort_field: str = "source_id"
    sort_direction: str = "asc"


def _raise_lightrag_error(exc: httpx.HTTPStatusError) -> None:
    raise HTTPException(
        status_code=exc.response.status_code,
        detail=http_error_detail(exc),
    ) from exc


def _text_file_sources(title: str, texts: list[str], file_sources: list[str] | None) -> list[str]:
    if file_sources:
        return file_sources[: len(texts)] + [
            f"{title}-{uuid.uuid4().hex[:8]}-{index + 1}"
            for index in range(len(file_sources), len(texts))
        ]
    return [
        f"{title}-{uuid.uuid4().hex[:8]}-{index + 1}"
        for index, _ in enumerate(texts)
    ]


def _effective_kms_workspace(user: dict, requested: str | None = None) -> str:
    if user.get("role") == "admin" and requested:
        return requested
    return user.get("kms_workspace") or settings.default_kms_workspace


def _effective_faq_workspace(user: dict, requested: str | None = None) -> str:
    if user.get("role") == "admin" and requested:
        return requested
    return user.get("faq_workspace") or settings.default_faq_workspace


def _effective_tenant_id(user: dict, requested: str | None = None) -> str:
    if user.get("role") == "admin" and requested:
        return requested
    return user.get("tenant_id") or settings.default_tenant_id


async def _create_item(
    *,
    payload: KnowledgeMetadataRequest,
    knowledge_type: str,
    user: dict,
    status: str = "draft",
) -> str:
    item_id = str(uuid.uuid4())
    tenant_id = _effective_tenant_id(user, payload.tenant_id)
    kms_workspace = _effective_kms_workspace(user, payload.kms_workspace)
    faq_workspace = _effective_faq_workspace(user, payload.faq_workspace)
    await db.execute(
        """
        INSERT INTO KMS_ADMIN_KNOWLEDGE_ITEMS(
            item_id, tenant_id, knowledge_type, title, body, category_id, enabled,
            valid_from, valid_until, kms_workspace, faq_workspace, status,
            metadata, created_by
        )
        VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
        """,
        item_id,
        tenant_id,
        knowledge_type,
        payload.title,
        payload.body,
        payload.category_id,
        payload.enabled,
        payload.valid_from,
        payload.valid_until,
        kms_workspace,
        faq_workspace,
        status,
        json.dumps(payload.metadata),
        user["user_id"],
    )
    return item_id


async def _mark_item_failed(item_id: str, message: str) -> None:
    await db.execute(
        """
        UPDATE KMS_ADMIN_KNOWLEDGE_ITEMS
        SET status = 'failed',
            metadata = metadata || $2::jsonb,
            update_time = NOW()
        WHERE item_id = $1
        """,
        item_id,
        json.dumps({"last_error": message}),
    )


async def _create_job(
    *,
    item_id: str,
    job_type: str,
    response: dict,
    status: str = "running",
    progress: float | None = None,
) -> str:
    job_id = str(uuid.uuid4())
    item = await db.fetchrow("SELECT tenant_id FROM KMS_ADMIN_KNOWLEDGE_ITEMS WHERE item_id = $1", item_id)
    lightrag_task_id = response.get("task_id")
    if not lightrag_task_id and response.get("tasks"):
        lightrag_task_id = response["tasks"][0].get("task_id")
    progress_value = progress if progress is not None else (100.0 if status == "completed" else 0.0)
    await db.execute(
        """
        INSERT INTO KMS_ADMIN_JOBS(job_id, tenant_id, item_id, job_type, status, lightrag_task_id, progress, message, metadata)
        VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        """,
        job_id,
        item.get("tenant_id") if item else settings.default_tenant_id,
        item_id,
        job_type,
        status,
        lightrag_task_id,
        progress_value,
        response.get("message"),
        json.dumps(response),
    )
    return job_id


async def _create_completed_faq_job(
    *,
    item_id: str,
    job_type: str,
    faq_workspace: str,
    answer_id: str,
    response: dict,
    message: str,
) -> str:
    return await _create_job(
        item_id=item_id,
        job_type=job_type,
        response={
            "message": message,
            "workspace": faq_workspace,
            "answer_id": answer_id,
            "faq_response": response,
        },
        status="completed",
        progress=100.0,
    )


async def _create_kms_job(
    *,
    payload: KnowledgeMetadataRequest,
    request: Request,
    user: dict,
    knowledge_type: str,
    action: str,
    job_type: str,
    path: str,
    json_body: dict[str, Any],
    timeout: float = 120.0,
) -> dict:
    item_id = await _create_item(
        payload=payload,
        knowledge_type=knowledge_type,
        user=user,
        status="processing",
    )
    kms_workspace = _effective_kms_workspace(user, payload.kms_workspace)
    try:
        response = await lightrag_client.request_json(
            "POST",
            path,
            workspace=kms_workspace,
            json_body=json_body,
            timeout=timeout,
        )
    except httpx.HTTPStatusError as exc:
        await _mark_item_failed(item_id, str(http_error_detail(exc)))
        _raise_lightrag_error(exc)
    except httpx.HTTPStatusError as exc:
        await _mark_item_failed(item_id, str(http_error_detail(exc)))
        _raise_lightrag_error(exc)
    except Exception as exc:
        await _mark_item_failed(item_id, str(exc))
        raise
    job_metadata = {**response, "request_data": json_body}
    has_immediate_refs = await _create_immediate_doc_refs(item_id, kms_workspace, response)
    job_id = await _create_job(
        item_id=item_id,
        job_type=job_type,
        response=job_metadata,
        status="completed" if has_immediate_refs and not response.get("task_id") else "running",
    )
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action=action,
        tenant_id=_effective_tenant_id(user, payload.tenant_id),
        target_type="knowledge",
        target_id=item_id,
    )
    return {"item_id": item_id, "job_id": job_id, "lightrag": response}


def _parse_metadata(metadata: str | None) -> dict[str, Any]:
    if not metadata or not metadata.strip():
        return {}
    try:
        value = json.loads(metadata)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="metadata must be a JSON object") from exc
    if not isinstance(value, dict):
        raise HTTPException(status_code=400, detail="metadata must be a JSON object")
    return value


def _json_list(value: Any) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    return []


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _document_status_filter(status: str | None) -> str | None:
    if not status or status == "all":
        return None
    return status.lower()


def _form_payload(
    *,
    title: str,
    body: str | None,
    category_id: str | None,
    enabled: bool,
    valid_from: datetime | None,
    valid_until: datetime | None,
    kms_workspace: str | None,
    faq_workspace: str | None,
    metadata: str | None,
) -> KnowledgeMetadataRequest:
    return KnowledgeMetadataRequest(
        title=title,
        body=body,
        category_id=category_id or None,
        enabled=enabled,
        valid_from=valid_from,
        valid_until=valid_until,
        kms_workspace=kms_workspace,
        faq_workspace=faq_workspace,
        metadata=_parse_metadata(metadata),
    )


async def _create_ref(
    *,
    item_id: str,
    ref_type: str,
    workspace_type: str,
    workspace: str,
    external_id: str,
    metadata: dict | None = None,
) -> None:
    await db.execute(
        """
        INSERT INTO KMS_ADMIN_KNOWLEDGE_REFS(
            ref_id, item_id, ref_type, workspace_type, workspace, external_id, metadata
        )
        VALUES($1, $2, $3, $4, $5, $6, $7::jsonb)
        """,
        str(uuid.uuid4()),
        item_id,
        ref_type,
        workspace_type,
        workspace,
        external_id,
        json.dumps(metadata or {}),
    )


async def _create_immediate_doc_refs(item_id: str, workspace: str, response: dict) -> bool:
    doc_ids: list[str] = []
    if response.get("doc_id"):
        doc_ids.append(response["doc_id"])
    for key in ("doc_ids", "document_ids"):
        if isinstance(response.get(key), list):
            doc_ids.extend(str(doc_id) for doc_id in response[key] if doc_id)
    for doc in response.get("documents") or []:
        if isinstance(doc, dict) and doc.get("id"):
            doc_ids.append(doc["id"])
    unique_doc_ids = sorted(set(doc_ids))
    for doc_id in unique_doc_ids:
        await _create_ref(
            item_id=item_id,
            ref_type="doc_id",
            workspace_type="kms",
            workspace=workspace,
            external_id=doc_id,
            metadata=response,
        )
    if unique_doc_ids:
        await db.execute(
            "UPDATE KMS_ADMIN_KNOWLEDGE_ITEMS SET status = 'ready', update_time = NOW() WHERE item_id = $1",
            item_id,
        )
    return bool(unique_doc_ids)


async def _linked_external_ids(
    *,
    tenant_id: str,
    workspace_type: str,
    workspace: str,
    ref_type: str,
) -> set[str]:
    rows = await db.fetch(
        """
        SELECT DISTINCT r.external_id
        FROM KMS_ADMIN_KNOWLEDGE_ITEMS i
        JOIN KMS_ADMIN_KNOWLEDGE_REFS r ON r.item_id = i.item_id
        WHERE i.tenant_id = $1
          AND r.workspace_type = $2
          AND r.workspace = $3
          AND r.ref_type = $4
        """,
        tenant_id,
        workspace_type,
        workspace,
        ref_type,
    )
    return {str(row["external_id"]) for row in rows if row.get("external_id")}


def _document_ref_from_lightrag(doc: dict[str, Any]) -> ExistingKnowledgeRefRequest | None:
    doc_id = doc.get("id") or doc.get("doc_id")
    if not doc_id:
        return None
    title = doc.get("file_path") or doc.get("doc_nm") or doc.get("title") or str(doc_id)
    return ExistingKnowledgeRefRequest(
        id=str(doc_id),
        title=str(title),
        summary=doc.get("content_summary") or doc.get("track_id") or "",
        status=doc.get("status"),
        metadata={
            "file_path": doc.get("file_path"),
            "doc_nm": doc.get("doc_nm"),
            "track_id": doc.get("track_id"),
            "content_length": doc.get("content_length"),
            "chunks_count": doc.get("chunks_count"),
            "created_at": doc.get("created_at"),
            "updated_at": doc.get("updated_at"),
            "error_msg": doc.get("error_msg"),
        },
    )


def _faq_ref_from_lightrag(answer: dict[str, Any]) -> ExistingKnowledgeRefRequest | None:
    answer_id = answer.get("answer_id") or answer.get("id")
    if not answer_id:
        return None
    title = answer.get("title") or answer.get("question") or str(answer_id)
    return ExistingKnowledgeRefRequest(
        id=str(answer_id),
        title=str(title),
        summary=answer.get("approved_summary") or answer.get("body") or answer.get("summary") or "",
        status=answer.get("status"),
        metadata={
            "version": answer.get("version"),
            "valid_from": answer.get("valid_from"),
            "valid_until": answer.get("valid_until"),
            "priority": answer.get("priority"),
            "tags": answer.get("tags"),
            "update_time": answer.get("update_time"),
        },
    )


async def _fetch_existing_kms_documents(workspace: str, max_items: int) -> list[ExistingKnowledgeRefRequest]:
    page = 1
    page_size = min(100, max_items)
    documents: list[ExistingKnowledgeRefRequest] = []
    while len(documents) < max_items:
        response = await lightrag_client.request_json(
            "POST",
            "/documents/paginated",
            workspace=workspace,
            json_body={
                "page": page,
                "page_size": page_size,
                "sort_field": "updated_at",
                "sort_direction": "desc",
                "status_filter": None,
            },
            timeout=120.0,
        )
        refs = [
            ref
            for doc in response.get("documents") or []
            if (ref := _document_ref_from_lightrag(doc)) is not None
        ]
        if not refs:
            break
        documents.extend(refs[: max_items - len(documents)])
        pagination = response.get("pagination") or {}
        total_pages = int(pagination.get("total_pages") or 0)
        if total_pages and page >= total_pages:
            break
        if not total_pages and len(refs) < page_size:
            break
        page += 1
    return documents


async def _fetch_existing_faq_answers(workspace: str, max_items: int) -> list[ExistingKnowledgeRefRequest]:
    page = 1
    page_size = min(100, max_items)
    answers: list[ExistingKnowledgeRefRequest] = []
    while len(answers) < max_items:
        response = await lightrag_client.request_json(
            "GET",
            "/api/answers",
            workspace=workspace,
            params={"page": page, "page_size": page_size},
            timeout=120.0,
        )
        refs = [
            ref
            for answer in response.get("answers") or []
            if (ref := _faq_ref_from_lightrag(answer)) is not None
        ]
        if not refs:
            break
        answers.extend(refs[: max_items - len(answers)])
        total = int(response.get("total") or 0)
        if total and page * page_size >= total:
            break
        if not total and len(refs) < page_size:
            break
        page += 1
    return answers


def _dedupe_refs(refs: list[ExistingKnowledgeRefRequest]) -> list[ExistingKnowledgeRefRequest]:
    seen: set[str] = set()
    deduped: list[ExistingKnowledgeRefRequest] = []
    for ref in refs:
        if ref.id in seen:
            continue
        seen.add(ref.id)
        deduped.append(ref)
    return deduped


async def _link_existing_ref(
    *,
    payload: ExistingKnowledgeLinkRequest,
    user: dict,
    ref: ExistingKnowledgeRefRequest,
    workspace_type: str,
    workspace: str,
    ref_type: str,
) -> str:
    source_type = "existing_kms_document" if workspace_type == "kms" else "existing_faq_answer"
    source_status = str(ref.status or "").lower()
    enabled = payload.enabled
    if workspace_type == "kms" and source_status and source_status not in {"processed", "ready"}:
        enabled = False
    if workspace_type == "faq" and source_status in {"archived", "expired"}:
        enabled = False
    item_payload = KnowledgeMetadataRequest(
        title=ref.title or ref.id,
        body=ref.summary or "",
        tenant_id=payload.tenant_id,
        category_id=payload.category_id,
        enabled=enabled,
        valid_from=payload.valid_from,
        valid_until=payload.valid_until,
        kms_workspace=payload.kms_workspace,
        faq_workspace=payload.faq_workspace,
        metadata={
            "source_type": source_type,
            "linked_from_existing_workspace": True,
            "linked_workspace_type": workspace_type,
            "linked_workspace": workspace,
            "linked_external_id": ref.id,
            "linked_status": ref.status,
            **(ref.metadata or {}),
        },
    )
    item_id = await _create_item(
        payload=item_payload,
        knowledge_type="existing_kms_document" if workspace_type == "kms" else "existing_faq_answer",
        user=user,
        status="ready",
    )
    await _create_ref(
        item_id=item_id,
        ref_type=ref_type,
        workspace_type=workspace_type,
        workspace=workspace,
        external_id=ref.id,
        metadata={
            "source_type": source_type,
            "linked_status": ref.status,
            **(ref.metadata or {}),
        },
    )
    await _create_job(
        item_id=item_id,
        job_type="link_existing_kms_document" if workspace_type == "kms" else "link_existing_faq_answer",
        response={
            "message": "Existing LightRAG knowledge linked to admin ledger",
            "workspace_type": workspace_type,
            "workspace": workspace,
            "external_id": ref.id,
            "source_status": ref.status,
        },
        status="completed",
        progress=100.0,
    )
    return item_id


@router.post("/link-existing")
async def link_existing_knowledge(
    payload: ExistingKnowledgeLinkRequest,
    request: Request,
    user: dict = Depends(get_current_user),
) -> dict:
    tenant_id = _effective_tenant_id(user, payload.tenant_id)
    kms_workspace = _effective_kms_workspace(user, payload.kms_workspace)
    faq_workspace = _effective_faq_workspace(user, payload.faq_workspace)
    link_payload = payload.model_copy(
        update={
            "tenant_id": tenant_id,
            "kms_workspace": kms_workspace,
            "faq_workspace": faq_workspace,
        }
    )
    linked: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    errors: list[dict[str, str]] = []

    if link_payload.include_kms:
        document_refs = (
            await _fetch_existing_kms_documents(kms_workspace, link_payload.max_items)
            if link_payload.link_all
            else _dedupe_refs(link_payload.documents)
        )
        existing_doc_ids = await _linked_external_ids(
            tenant_id=tenant_id,
            workspace_type="kms",
            workspace=kms_workspace,
            ref_type="doc_id",
        )
        for ref in document_refs:
            if ref.id in existing_doc_ids:
                skipped.append({"type": "kms", "id": ref.id, "reason": "already_linked"})
                continue
            try:
                item_id = await _link_existing_ref(
                    payload=link_payload,
                    user=user,
                    ref=ref,
                    workspace_type="kms",
                    workspace=kms_workspace,
                    ref_type="doc_id",
                )
            except Exception as exc:
                errors.append({"type": "kms", "id": ref.id, "reason": str(exc)})
                continue
            existing_doc_ids.add(ref.id)
            linked.append({"type": "kms", "id": ref.id, "item_id": item_id})

    if link_payload.include_faq:
        answer_refs = (
            await _fetch_existing_faq_answers(faq_workspace, link_payload.max_items)
            if link_payload.link_all
            else _dedupe_refs(link_payload.faq_answers)
        )
        existing_answer_ids = await _linked_external_ids(
            tenant_id=tenant_id,
            workspace_type="faq",
            workspace=faq_workspace,
            ref_type="answer_id",
        )
        for ref in answer_refs:
            if ref.id in existing_answer_ids:
                skipped.append({"type": "faq", "id": ref.id, "reason": "already_linked"})
                continue
            try:
                item_id = await _link_existing_ref(
                    payload=link_payload,
                    user=user,
                    ref=ref,
                    workspace_type="faq",
                    workspace=faq_workspace,
                    ref_type="answer_id",
                )
            except Exception as exc:
                errors.append({"type": "faq", "id": ref.id, "reason": str(exc)})
                continue
            existing_answer_ids.add(ref.id)
            linked.append({"type": "faq", "id": ref.id, "item_id": item_id})

    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="link_existing_knowledge",
        tenant_id=tenant_id,
        target_type="knowledge",
        target_id=None,
        detail={
            "kms_workspace": kms_workspace,
            "faq_workspace": faq_workspace,
            "link_all": link_payload.link_all,
            "linked_count": len(linked),
            "skipped_count": len(skipped),
            "error_count": len(errors),
        },
    )
    return {
        "tenant_id": tenant_id,
        "kms_workspace": kms_workspace,
        "faq_workspace": faq_workspace,
        "linked": linked,
        "skipped": skipped,
        "errors": errors,
        "summary": {
            "linked_count": len(linked),
            "skipped_count": len(skipped),
            "error_count": len(errors),
        },
    }


@router.get("")
async def list_knowledge(
    user: dict = Depends(get_current_user),
    tenant_id: str | None = Query(default=None),
    kms_workspace: str | None = Query(default=None),
    faq_workspace: str | None = Query(default=None),
) -> dict:
    effective_tenant_id = _effective_tenant_id(user, tenant_id)
    effective_kms_workspace = _effective_kms_workspace(user, kms_workspace)
    effective_faq_workspace = _effective_faq_workspace(user, faq_workspace)
    rows = await db.fetch(
        """
        SELECT i.*, COALESCE(jsonb_agg(to_jsonb(r)) FILTER (WHERE r.ref_id IS NOT NULL), '[]'::jsonb) AS refs
        FROM KMS_ADMIN_KNOWLEDGE_ITEMS i
        LEFT JOIN KMS_ADMIN_KNOWLEDGE_REFS r ON r.item_id = i.item_id
        WHERE i.tenant_id = $3
          AND (i.kms_workspace = $1 OR i.faq_workspace = $2)
        GROUP BY i.item_id
        ORDER BY i.update_time DESC
        LIMIT 500
        """,
        effective_kms_workspace,
        effective_faq_workspace,
        effective_tenant_id,
    )
    for row in rows:
        row["metadata"] = _json_object(row.get("metadata"))
        row["refs"] = _json_list(row.get("refs"))
    return {
        "items": rows,
        "scope": {
            "tenant_id": effective_tenant_id,
            "kms_workspace": effective_kms_workspace,
            "faq_workspace": effective_faq_workspace,
        },
    }


@router.get("/kms-documents")
async def list_kms_documents(
    user: dict = Depends(get_current_user),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=10, le=200),
    status: str | None = Query(default=None),
    sort_field: str = Query(default="updated_at"),
    sort_direction: str = Query(default="desc"),
    kms_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_kms_workspace(user, kms_workspace)
    payload = {
        "page": page,
        "page_size": page_size,
        "sort_field": sort_field,
        "sort_direction": sort_direction,
        "status_filter": _document_status_filter(status),
    }
    try:
        return await lightrag_client.request_json(
            "POST",
            "/documents/paginated",
            workspace=effective_workspace,
            json_body=payload,
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)


@router.get("/kms-documents/{doc_id}/preview")
async def get_kms_document_preview(
    doc_id: str,
    user: dict = Depends(get_current_user),
    kms_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_kms_workspace(user, kms_workspace)
    try:
        return await lightrag_client.request_json(
            "GET",
            f"/documents/{doc_id}/preview",
            workspace=effective_workspace,
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)


@router.get("/kms-documents/{doc_id}/detail")
async def get_kms_document_detail(
    doc_id: str,
    user: dict = Depends(get_current_user),
    kms_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_kms_workspace(user, kms_workspace)
    errors: list[dict[str, Any]] = []
    try:
        preview = await lightrag_client.request_json(
            "GET",
            f"/documents/{doc_id}/preview",
            workspace=effective_workspace,
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)

    async def optional_call(
        label: str,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            return await lightrag_client.request_json(
                method,
                path,
                workspace=effective_workspace,
                json_body=json_body,
            )
        except httpx.HTTPStatusError as exc:
            errors.append({"source": label, "detail": http_error_detail(exc)})
        except Exception as exc:
            errors.append({"source": label, "detail": str(exc)})
        return {}

    entities = await optional_call(
        "entities",
        "POST",
        "/entities",
        json_body={
            "page": 1,
            "page_size": 30,
            "sort_field": "entity_id",
            "sort_direction": "asc",
        },
    )
    relations = await optional_call(
        "relations",
        "POST",
        "/relations",
        json_body={
            "page": 1,
            "page_size": 30,
            "sort_field": "source_id",
            "sort_direction": "asc",
        },
    )
    entity_types = await optional_call("entity_types", "GET", "/entity-types")

    return {
        "workspace": effective_workspace,
        "preview": preview,
        "entities": entities.get("entities", []),
        "entity_pagination": entities.get("pagination", {}),
        "relations": relations.get("relations", []),
        "relation_pagination": relations.get("pagination", {}),
        "entity_types": entity_types.get("types", []),
        "graph_total_entities": entity_types.get("total_entities", 0),
        "errors": errors,
    }


@router.get("/kms-entity-types")
async def list_kms_entity_types(
    user: dict = Depends(get_current_user),
    kms_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_kms_workspace(user, kms_workspace)
    try:
        response = await lightrag_client.request_json(
            "GET",
            "/entity-types",
            workspace=effective_workspace,
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)
    return {**response, "workspace": effective_workspace}


@router.post("/kms-entities")
async def list_kms_entities(
    payload: KmsEntitiesRequest,
    user: dict = Depends(get_current_user),
    kms_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_kms_workspace(user, kms_workspace)
    try:
        response = await lightrag_client.request_json(
            "POST",
            "/entities",
            workspace=effective_workspace,
            json_body=payload.model_dump(exclude_none=True),
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)
    return {**response, "workspace": effective_workspace}


@router.get("/kms-entities/{entity_id:path}/related")
async def list_kms_related_entities(
    entity_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
    kms_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_kms_workspace(user, kms_workspace)
    try:
        response = await lightrag_client.request_json(
            "GET",
            f"/entities/{quote(entity_id, safe='')}/related",
            workspace=effective_workspace,
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="view_related_entities",
        target_type="entity",
        target_id=entity_id,
        detail={"workspace": effective_workspace, "total": response.get("total")},
    )
    return {**response, "workspace": effective_workspace}


@router.post("/kms-relations")
async def list_kms_relations(
    payload: KmsRelationsRequest,
    user: dict = Depends(get_current_user),
    kms_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_kms_workspace(user, kms_workspace)
    try:
        response = await lightrag_client.request_json(
            "POST",
            "/relations",
            workspace=effective_workspace,
            json_body=payload.model_dump(exclude_none=True),
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)
    return {**response, "workspace": effective_workspace}


@router.post("/kms-documents/{doc_id}/delete")
async def delete_kms_document(
    doc_id: str,
    payload: DocumentDeleteRequest,
    request: Request,
    user: dict = Depends(get_current_user),
    kms_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_kms_workspace(user, kms_workspace)
    try:
        response = await lightrag_client.request_json(
            "DELETE",
            "/documents/delete_document",
            workspace=effective_workspace,
            json_body={
                "doc_ids": [doc_id],
                "delete_file": payload.delete_file,
                "delete_llm_cache": payload.delete_llm_cache,
                "delete_s3_file": payload.delete_s3_file,
            },
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="delete_kms_document",
        target_type="document",
        target_id=doc_id,
        detail={"workspace": effective_workspace},
    )
    return response


@router.get("/kms-documents/{doc_id}/chunks")
async def list_kms_document_chunks(
    doc_id: str,
    user: dict = Depends(get_current_user),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=100),
    kms_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_kms_workspace(user, kms_workspace)
    try:
        return await lightrag_client.request_json(
            "GET",
            f"/chunks/by-document/{doc_id}",
            workspace=effective_workspace,
            params={"page": page, "page_size": page_size},
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)


@router.post("/kms-documents/{doc_id}/reingest")
async def reingest_kms_document(
    doc_id: str,
    payload: DocumentReingestRequest,
    request: Request,
    user: dict = Depends(get_current_user),
    kms_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_kms_workspace(user, kms_workspace or payload.kms_workspace)
    item_payload = payload.model_copy(
        update={
            "kms_workspace": effective_workspace,
            "metadata": {
                **payload.metadata,
                "source_type": "text_revision",
                "previous_doc_id": doc_id,
            },
        }
    )
    item_id = await _create_item(
        payload=item_payload,
        knowledge_type="text_revision",
        user=user,
        status="processing",
    )
    file_source = payload.file_source or payload.title
    request_data = {
        "text": payload.body,
        "file_source": file_source,
    }
    try:
        response = await lightrag_client.request_json(
            "POST",
            "/documents/text",
            workspace=effective_workspace,
            json_body=request_data,
            timeout=120.0,
        )
    except httpx.HTTPStatusError as exc:
        await _mark_item_failed(item_id, str(http_error_detail(exc)))
        _raise_lightrag_error(exc)
    except Exception as exc:
        await _mark_item_failed(item_id, str(exc))
        raise

    job_id = await _create_job(
        item_id=item_id,
        job_type="reingest_document",
        response={
            **response,
            "request_data": request_data,
            "replacement": {
                "previous_doc_id": doc_id,
                "delete_previous": payload.delete_previous,
                "previous_workspace": effective_workspace,
            },
        },
        status="running",
    )
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="reingest_kms_document",
        target_type="document",
        target_id=doc_id,
        detail={
            "workspace": effective_workspace,
            "new_item_id": item_id,
            "job_id": job_id,
            "delete_previous": payload.delete_previous,
        },
    )
    return {"item_id": item_id, "job_id": job_id, "lightrag": response}


@router.get("/kms-chunks/{chunk_id}")
async def get_kms_chunk_detail(
    chunk_id: str,
    user: dict = Depends(get_current_user),
    kms_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_kms_workspace(user, kms_workspace)
    try:
        response = await lightrag_client.request_json(
            "GET",
            f"/chunks/{chunk_id}",
            workspace=effective_workspace,
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)
    return {**response, "workspace": effective_workspace}


@router.patch("/kms-chunks/{chunk_id}")
async def update_kms_chunk(
    chunk_id: str,
    payload: ChunkUpdateRequest,
    request: Request,
    user: dict = Depends(get_current_user),
    kms_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_kms_workspace(user, kms_workspace)
    try:
        response = await lightrag_client.request_json(
            "PATCH",
            f"/chunks/{chunk_id}",
            workspace=effective_workspace,
            json_body=payload.model_dump(exclude_unset=True),
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="update_kms_chunk",
        target_type="chunk",
        target_id=chunk_id,
        detail={"workspace": effective_workspace, "invalidate_cache": payload.invalidate_cache},
    )
    return {**response, "workspace": effective_workspace}


@router.post("/kms-deletions/preview")
async def preview_kms_deletion(
    payload: KmsDeletionRequest,
    request: Request,
    user: dict = Depends(get_current_user),
    kms_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_kms_workspace(user, kms_workspace)
    try:
        response = await lightrag_client.request_json(
            "POST",
            "/deletions/preview",
            workspace=effective_workspace,
            json_body=payload.model_dump(exclude_none=True),
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="preview_kms_deletion",
        target_type=payload.target_type,
        target_id=",".join(payload.ids) if payload.ids else None,
        detail={
            "workspace": effective_workspace,
            "policy": payload.policy,
            "relations": [item.model_dump() for item in payload.relations],
            "executable": response.get("executable"),
            "summary": response.get("summary"),
        },
    )
    return {**response, "workspace": effective_workspace}


@router.post("/kms-deletions/execute")
async def execute_kms_deletion(
    payload: KmsDeletionRequest,
    request: Request,
    user: dict = Depends(get_current_user),
    kms_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_kms_workspace(user, kms_workspace)
    try:
        response = await lightrag_client.request_json(
            "POST",
            "/deletions/execute",
            workspace=effective_workspace,
            json_body=payload.model_dump(exclude_none=True),
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="execute_kms_deletion",
        target_type=payload.target_type,
        target_id=",".join(payload.ids) if payload.ids else None,
        detail={
            "workspace": effective_workspace,
            "policy": payload.policy,
            "relations": [item.model_dump() for item in payload.relations],
            "job_id": response.get("job_id"),
            "status": response.get("status"),
            "summary": response.get("preview", {}).get("summary") if isinstance(response.get("preview"), dict) else None,
        },
    )
    return {**response, "workspace": effective_workspace}


@router.get("/kms-deletions/jobs")
async def list_kms_deletion_jobs(
    user: dict = Depends(get_current_user),
    kms_workspace: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict:
    effective_workspace = _effective_kms_workspace(user, kms_workspace)
    try:
        response = await lightrag_client.request_json(
            "GET",
            "/deletions/jobs",
            workspace=effective_workspace,
            params={"limit": limit, "offset": offset},
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)
    return {**response, "workspace": effective_workspace}


@router.get("/kms-deletions/jobs/{job_id}")
async def get_kms_deletion_job(
    job_id: str,
    user: dict = Depends(get_current_user),
    kms_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_kms_workspace(user, kms_workspace)
    try:
        response = await lightrag_client.request_json(
            "GET",
            f"/deletions/jobs/{job_id}",
            workspace=effective_workspace,
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)
    return {**response, "workspace": effective_workspace}


@router.post("/kms-deletions/jobs/{job_id}/restore/preview")
async def preview_kms_deletion_restore(
    job_id: str,
    payload: KmsDeletionRestoreRequest,
    request: Request,
    user: dict = Depends(get_current_user),
    kms_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_kms_workspace(user, kms_workspace)
    try:
        response = await lightrag_client.request_json(
            "POST",
            f"/deletions/jobs/{job_id}/restore/preview",
            workspace=effective_workspace,
            json_body=payload.model_dump(),
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="preview_kms_deletion_restore",
        target_type="deletion_job",
        target_id=job_id,
        detail={"workspace": effective_workspace, "executable": response.get("executable")},
    )
    return {**response, "workspace": effective_workspace}


@router.post("/kms-deletions/jobs/{job_id}/restore/execute")
async def execute_kms_deletion_restore(
    job_id: str,
    payload: KmsDeletionRestoreRequest,
    request: Request,
    user: dict = Depends(get_current_user),
    kms_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_kms_workspace(user, kms_workspace)
    try:
        response = await lightrag_client.request_json(
            "POST",
            f"/deletions/jobs/{job_id}/restore/execute",
            workspace=effective_workspace,
            json_body=payload.model_dump(),
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="execute_kms_deletion_restore",
        target_type="deletion_job",
        target_id=job_id,
        detail={"workspace": effective_workspace, "status": response.get("status"), "restored": response.get("restored")},
    )
    return {**response, "workspace": effective_workspace}


@router.get("/faq-answers")
async def list_faq_answers(
    user: dict = Depends(get_current_user),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: str | None = Query(default=None),
    search: str | None = Query(default=None),
    validity: str | None = Query(default=None),
    faq_workspace: str | None = Query(default=None),
) -> dict:
    params: dict[str, Any] = {"page": page, "page_size": page_size}
    if status:
        params["status"] = status
    if search:
        params["search"] = search
    if validity:
        params["validity"] = validity
    effective_workspace = _effective_faq_workspace(user, faq_workspace)
    try:
        return await lightrag_client.request_json(
            "GET",
            "/api/answers",
            workspace=effective_workspace,
            params=params,
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 409:
            return {
                "answers": [],
                "total": 0,
                "page": page,
                "page_size": page_size,
                "workspace": effective_workspace,
                "workspace_error": http_error_detail(exc),
            }
        _raise_lightrag_error(exc)


@router.get("/faq-answers/{answer_id}")
async def get_faq_answer(
    answer_id: str,
    user: dict = Depends(get_current_user),
    faq_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_faq_workspace(user, faq_workspace)
    try:
        return await lightrag_client.request_json(
            "GET",
            f"/api/answers/{answer_id}",
            workspace=effective_workspace,
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)


@router.post("/faq-answers/search")
async def search_faq_answer_candidates(
    payload: FaqCandidateSearchRequest,
    request: Request,
    user: dict = Depends(get_current_user),
    faq_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_faq_workspace(user, faq_workspace)
    try:
        response = await lightrag_client.request_json(
            "POST",
            "/api/answers/search",
            workspace=effective_workspace,
            json_body=payload.model_dump(exclude_none=True),
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="search_faq_candidates",
        target_type="answer",
        target_id=None,
        detail={
            "workspace": effective_workspace,
            "query": payload.query,
            "top_k": payload.top_k,
            "include_drafts": payload.include_drafts,
            "matched": response.get("matched"),
            "answer_id": response.get("answer_id"),
        },
    )
    return {**response, "workspace": effective_workspace}


@router.patch("/faq-answers/{answer_id}")
async def update_faq_answer(
    answer_id: str,
    payload: FaqAnswerUpdateRequest,
    request: Request,
    user: dict = Depends(get_current_user),
    faq_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_faq_workspace(user, faq_workspace)
    try:
        response = await lightrag_client.request_json(
            "PATCH",
            f"/api/answers/{answer_id}",
            workspace=effective_workspace,
            json_body=_faq_answer_update_body(payload),
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="update_faq_answer",
        target_type="answer",
        target_id=answer_id,
        detail={"workspace": effective_workspace},
    )
    await db.execute(
        """
        UPDATE KMS_ADMIN_KNOWLEDGE_ITEMS i
        SET title = COALESCE($2, i.title),
            body = COALESCE($3, i.body),
            valid_from = COALESCE($4, i.valid_from),
            valid_until = COALESCE($5, i.valid_until),
            status = COALESCE($6, i.status),
            metadata = i.metadata || $7::jsonb,
            update_time = NOW()
        FROM KMS_ADMIN_KNOWLEDGE_REFS r
        WHERE r.item_id = i.item_id
          AND r.workspace_type = 'faq'
          AND r.ref_type = 'answer_id'
          AND r.external_id = $1
        """,
        answer_id,
        payload.title,
        payload.body,
        payload.valid_from,
        payload.valid_until,
        payload.status,
        json.dumps(
            {
                "approved_summary": payload.approved_summary,
                "tags": payload.tags,
                "last_faq_update": response,
            }
        ),
    )
    return response


@router.get("/faq-answers/{answer_id}/guidance")
async def list_faq_guidance(
    answer_id: str,
    user: dict = Depends(get_current_user),
    faq_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_faq_workspace(user, faq_workspace)
    try:
        guidance = await lightrag_client.request_json(
            "GET",
            f"/api/answers/{answer_id}/guidance",
            workspace=effective_workspace,
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)
    if isinstance(guidance, dict):
        guidance_items = guidance.get("guidance") or guidance.get("items") or []
    else:
        guidance_items = guidance
    return {"guidance": guidance_items or [], "workspace": effective_workspace}


@router.post("/faq-answers/{answer_id}/guidance")
async def create_faq_guidance(
    answer_id: str,
    payload: FaqGuidanceCreateRequest,
    request: Request,
    user: dict = Depends(get_current_user),
    faq_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_faq_workspace(user, faq_workspace)
    try:
        response = await lightrag_client.request_json(
            "POST",
            f"/api/answers/{answer_id}/guidance",
            workspace=effective_workspace,
            json_body=payload.model_dump(),
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="create_faq_guidance",
        target_type="answer",
        target_id=answer_id,
        detail={"workspace": effective_workspace, "guidance_id": response.get("guidance_id")},
    )
    return response


@router.delete("/faq-answers/{answer_id}/guidance/{guidance_id}")
async def delete_faq_guidance(
    answer_id: str,
    guidance_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
    faq_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_faq_workspace(user, faq_workspace)
    try:
        response = await lightrag_client.request_json(
            "DELETE",
            f"/api/answers/{answer_id}/guidance/{guidance_id}",
            workspace=effective_workspace,
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="delete_faq_guidance",
        target_type="answer",
        target_id=answer_id,
        detail={"workspace": effective_workspace, "guidance_id": guidance_id},
    )
    return response


@router.post("/faq-answers/{answer_id}/{action}")
async def run_faq_answer_action(
    answer_id: str,
    action: str,
    request: Request,
    user: dict = Depends(get_current_user),
    faq_workspace: str | None = Query(default=None),
) -> dict:
    if action not in {"publish", "archive", "vectors-rebuild"}:
        raise HTTPException(status_code=404, detail="Unsupported FAQ action")
    effective_workspace = _effective_faq_workspace(user, faq_workspace)
    path_action = "vectors/rebuild" if action == "vectors-rebuild" else action
    try:
        response = await lightrag_client.request_json(
            "POST",
            f"/api/answers/{answer_id}/{path_action}",
            workspace=effective_workspace,
            json_body={},
        )
    except httpx.HTTPStatusError as exc:
        _raise_lightrag_error(exc)
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action=f"faq_answer_{action}",
        target_type="answer",
        target_id=answer_id,
        detail={"workspace": effective_workspace},
    )
    if action in {"publish", "archive", "vectors-rebuild"}:
        status_value = "ready" if action in {"publish", "vectors-rebuild"} else "archived"
        enabled_value = action != "archive"
        await db.execute(
            """
            UPDATE KMS_ADMIN_KNOWLEDGE_ITEMS i
            SET status = $2,
                enabled = $3,
                metadata = i.metadata || $4::jsonb,
                update_time = NOW()
            FROM KMS_ADMIN_KNOWLEDGE_REFS r
            WHERE r.item_id = i.item_id
              AND r.workspace_type = 'faq'
              AND r.ref_type = 'answer_id'
              AND r.external_id = $1
            """,
            answer_id,
            status_value,
            enabled_value,
            json.dumps({"last_faq_action": action, "last_faq_action_response": response}),
        )
    return response


@router.post("/text")
async def create_text_knowledge(
    payload: TextKnowledgeRequest,
    request: Request,
    user: dict = Depends(get_current_user),
) -> dict:
    return await _create_kms_job(
        payload=payload,
        request=request,
        user=user,
        knowledge_type="text",
        action="create_text_knowledge",
        job_type="ingest_text",
        path="/documents/text",
        json_body={"text": payload.body, "file_source": payload.file_source or payload.title},
    )


@router.post("/texts")
async def create_texts_knowledge(
    payload: TextsKnowledgeRequest,
    request: Request,
    user: dict = Depends(get_current_user),
) -> dict:
    item_payload = payload.model_copy(update={"body": payload.body or "\n\n".join(payload.texts)})
    file_sources = _text_file_sources(payload.title, payload.texts, payload.file_sources)
    return await _create_kms_job(
        payload=item_payload,
        request=request,
        user=user,
        knowledge_type="texts",
        action="create_texts_knowledge",
        job_type="ingest_texts",
        path="/documents/texts",
        json_body={"texts": payload.texts, "file_sources": file_sources},
    )


@router.post("/scan")
async def create_scan_job(
    payload: ScanKnowledgeRequest,
    request: Request,
    user: dict = Depends(get_current_user),
) -> dict:
    return await _create_kms_job(
        payload=payload,
        request=request,
        user=user,
        knowledge_type="scan",
        action="create_scan_job",
        job_type="scan_input_dir",
        path="/documents/scan",
        json_body={},
    )


@router.post("/url")
async def create_url_knowledge(
    payload: UrlKnowledgeRequest,
    request: Request,
    user: dict = Depends(get_current_user),
) -> dict:
    item_payload = payload.model_copy(update={"body": payload.body or payload.url})
    return await _create_kms_job(
        payload=item_payload,
        request=request,
        user=user,
        knowledge_type="url",
        action="create_url_knowledge",
        job_type="ingest_url",
        path="/api/url/ingest",
        json_body={
            "url": payload.url,
            "file_path_label": payload.file_path_label or payload.title,
            "process_images": payload.process_images,
            "process_tables": payload.process_tables,
            "skip_duplicates": payload.skip_duplicates,
            "force_reindex": payload.force_reindex,
            "follow_links": payload.follow_links,
            "max_depth": payload.max_depth,
            "document_prompt": payload.document_prompt,
            "image_prompt": payload.image_prompt,
            "table_prompt": payload.table_prompt,
        },
    )


@router.post("/url-batch")
async def create_url_batch_knowledge(
    payload: UrlBatchKnowledgeRequest,
    request: Request,
    user: dict = Depends(get_current_user),
) -> dict:
    item_payload = payload.model_copy(update={"body": payload.body or "\n".join(payload.urls)})
    return await _create_kms_job(
        payload=item_payload,
        request=request,
        user=user,
        knowledge_type="url_batch",
        action="create_url_batch_knowledge",
        job_type="ingest_url_batch",
        path="/api/url/ingest-batch",
        json_body={
            "urls": payload.urls,
            "process_images": payload.process_images,
            "process_tables": payload.process_tables,
            "skip_duplicates": payload.skip_duplicates,
            "force_reindex": payload.force_reindex,
            "follow_links": payload.follow_links,
            "max_depth": payload.max_depth,
            "document_prompt": payload.document_prompt,
            "image_prompt": payload.image_prompt,
            "table_prompt": payload.table_prompt,
        },
    )


@router.post("/board")
async def create_board_knowledge(
    payload: BoardKnowledgeRequest,
    request: Request,
    user: dict = Depends(get_current_user),
) -> dict:
    item_payload = payload.model_copy(update={"body": payload.body or payload.api_url})
    return await _create_kms_job(
        payload=item_payload,
        request=request,
        user=user,
        knowledge_type="board",
        action="create_board_knowledge",
        job_type="ingest_board",
        path="/api/board/ingest",
        json_body={
            "api_url": payload.api_url,
            "method": payload.method,
            "headers": payload.headers,
            "params": payload.params,
            "body": payload.request_body,
            "field_mapping": payload.field_mapping,
            "max_pages": payload.max_pages,
            "page_size": payload.page_size,
            "process_images": payload.process_images,
            "process_tables": payload.process_tables,
            "process_documents": payload.process_documents,
            "parser": payload.parser,
            "skip_duplicates": payload.skip_duplicates,
            "update_existing": payload.update_existing,
            "fetch_detail": payload.fetch_detail,
            "base_url": payload.base_url,
            "document_prompt": payload.document_prompt,
            "image_prompt": payload.image_prompt,
            "table_prompt": payload.table_prompt,
        },
        timeout=180.0,
    )


async def _create_file_kms_job(
    *,
    payload: KnowledgeMetadataRequest,
    request: Request,
    user: dict,
    knowledge_type: str,
    action: str,
    job_type: str,
    path: str,
    file: UploadFile,
    data: dict[str, Any] | None = None,
) -> dict:
    body = payload.body or file.filename or payload.title
    item_payload = payload.model_copy(update={"body": body})
    item_id = await _create_item(
        payload=item_payload,
        knowledge_type=knowledge_type,
        user=user,
        status="processing",
    )
    kms_workspace = _effective_kms_workspace(user, payload.kms_workspace)
    try:
        file_bytes = await file.read()
        response = await lightrag_client.request_form(
            "POST",
            path,
            workspace=kms_workspace,
            data={key: str(value) for key, value in (data or {}).items() if value is not None},
            files={"file": (file.filename or payload.title, file_bytes, file.content_type)},
            timeout=300.0,
        )
    except httpx.HTTPStatusError as exc:
        await _mark_item_failed(item_id, str(http_error_detail(exc)))
        _raise_lightrag_error(exc)
    except Exception as exc:
        await _mark_item_failed(item_id, str(exc))
        raise
    job_metadata = {**response, "request_data": data or {}}
    has_immediate_refs = await _create_immediate_doc_refs(item_id, kms_workspace, response)
    job_id = await _create_job(
        item_id=item_id,
        job_type=job_type,
        response=job_metadata,
        status="completed" if has_immediate_refs and not response.get("task_id") else "running",
    )
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action=action,
        target_type="knowledge",
        target_id=item_id,
    )
    return {"item_id": item_id, "job_id": job_id, "lightrag": response}


@router.post("/upload")
async def create_upload_knowledge(
    request: Request,
    file: UploadFile = File(...),
    title: str = Form(...),
    body: str | None = Form(default=None),
    category_id: str | None = Form(default=None),
    enabled: bool = Form(default=True),
    valid_from: datetime | None = Form(default=None),
    valid_until: datetime | None = Form(default=None),
    kms_workspace: str | None = Form(default=None),
    faq_workspace: str | None = Form(default=None),
    metadata: str | None = Form(default=None),
    user: dict = Depends(get_current_user),
) -> dict:
    payload = _form_payload(
        title=title,
        body=body,
        category_id=category_id,
        enabled=enabled,
        valid_from=valid_from,
        valid_until=valid_until,
        kms_workspace=kms_workspace,
        faq_workspace=faq_workspace,
        metadata=metadata,
    )
    return await _create_file_kms_job(
        payload=payload,
        request=request,
        user=user,
        knowledge_type="upload",
        action="create_upload_knowledge",
        job_type="upload_document",
        path="/documents/upload",
        file=file,
    )


@router.post("/quick-image")
async def create_quick_image_knowledge(
    request: Request,
    file: UploadFile = File(...),
    title: str = Form(...),
    body: str | None = Form(default=None),
    category_id: str | None = Form(default=None),
    enabled: bool = Form(default=True),
    valid_from: datetime | None = Form(default=None),
    valid_until: datetime | None = Form(default=None),
    kms_workspace: str | None = Form(default=None),
    faq_workspace: str | None = Form(default=None),
    metadata: str | None = Form(default=None),
    image_prompt: str | None = Form(default=None),
    user: dict = Depends(get_current_user),
) -> dict:
    payload = _form_payload(
        title=title,
        body=body,
        category_id=category_id,
        enabled=enabled,
        valid_from=valid_from,
        valid_until=valid_until,
        kms_workspace=kms_workspace,
        faq_workspace=faq_workspace,
        metadata=metadata,
    )
    return await _create_file_kms_job(
        payload=payload,
        request=request,
        user=user,
        knowledge_type="quick_image",
        action="create_quick_image_knowledge",
        job_type="ingest_quick_image",
        path="/documents/quick-image",
        file=file,
        data={"title": title, "image_prompt": image_prompt or ""},
    )


@router.post("/multimodal")
async def create_multimodal_knowledge(
    request: Request,
    file: UploadFile = File(...),
    title: str = Form(...),
    body: str | None = Form(default=None),
    category_id: str | None = Form(default=None),
    enabled: bool = Form(default=True),
    valid_from: datetime | None = Form(default=None),
    valid_until: datetime | None = Form(default=None),
    kms_workspace: str | None = Form(default=None),
    faq_workspace: str | None = Form(default=None),
    metadata: str | None = Form(default=None),
    parser: str = Form(default="pymupdf"),
    process_images: bool = Form(default=True),
    process_tables: bool = Form(default=True),
    process_equations: bool = Form(default=True),
    document_prompt: str | None = Form(default=None),
    image_prompt: str | None = Form(default=None),
    table_prompt: str | None = Form(default=None),
    user: dict = Depends(get_current_user),
) -> dict:
    payload = _form_payload(
        title=title,
        body=body,
        category_id=category_id,
        enabled=enabled,
        valid_from=valid_from,
        valid_until=valid_until,
        kms_workspace=kms_workspace,
        faq_workspace=faq_workspace,
        metadata=metadata,
    )
    return await _create_file_kms_job(
        payload=payload,
        request=request,
        user=user,
        knowledge_type="multimodal",
        action="create_multimodal_knowledge",
        job_type="ingest_multimodal",
        path="/api/multimodal/process",
        file=file,
        data={
            "parser": parser,
            "file_path_label": title,
            "process_images": process_images,
            "process_tables": process_tables,
            "process_equations": process_equations,
            "document_prompt": document_prompt or "",
            "image_prompt": image_prompt or "",
            "table_prompt": table_prompt or "",
        },
    )


@router.post("/faq")
async def create_faq_knowledge(
    payload: FaqKnowledgeRequest,
    request: Request,
    user: dict = Depends(get_current_user),
) -> dict:
    item_id = await _create_item(payload=payload, knowledge_type="faq", user=user, status="processing")
    faq_workspace = _effective_faq_workspace(user, payload.faq_workspace)
    try:
        response = await lightrag_client.request_json(
            "POST",
            "/api/answers",
            workspace=faq_workspace,
            json_body={
                "title": payload.title,
                "body": payload.body,
                "approved_summary": payload.approved_summary,
                "status": payload.status,
                "valid_from": payload.valid_from.isoformat() if payload.valid_from else None,
                "valid_until": payload.valid_until.isoformat() if payload.valid_until else None,
                "tags": payload.tags,
                "metadata": {**payload.metadata, "kms_admin_item_id": item_id},
                "guidance": payload.guidance,
            },
        )
    except httpx.HTTPStatusError as exc:
        await _mark_item_failed(item_id, str(http_error_detail(exc)))
        _raise_lightrag_error(exc)
    await _create_ref(
        item_id=item_id,
        ref_type="answer_id",
        workspace_type="faq",
        workspace=faq_workspace,
        external_id=response["answer_id"],
        metadata=response,
    )
    await db.execute(
        "UPDATE KMS_ADMIN_KNOWLEDGE_ITEMS SET status = 'ready', update_time = NOW() WHERE item_id = $1",
        item_id,
    )
    job_id = await _create_completed_faq_job(
        item_id=item_id,
        job_type="faq_answer",
        faq_workspace=faq_workspace,
        answer_id=response["answer_id"],
        response=response,
        message="FAQ 답변 등록 완료",
    )
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="create_faq_knowledge",
        tenant_id=_effective_tenant_id(user, payload.tenant_id),
        target_type="knowledge",
        target_id=item_id,
        detail={"workspace": faq_workspace, "answer_id": response["answer_id"], "job_id": job_id},
    )
    return {"item_id": item_id, "job_id": job_id, "answer": response}


@router.post("/faq-source-draft")
async def create_faq_source_draft_knowledge(
    payload: FaqSourceDraftKnowledgeRequest,
    request: Request,
    user: dict = Depends(get_current_user),
) -> dict:
    item_id = await _create_item(payload=payload, knowledge_type="faq_source_draft", user=user, status="processing")
    faq_workspace = _effective_faq_workspace(user, payload.faq_workspace)
    answer_id: str | None = None
    try:
        response = await lightrag_client.request_json(
            "POST",
            "/api/answers/source-draft",
            workspace=faq_workspace,
            json_body={
                "source_type": payload.source_type,
                "source_uri": payload.source_uri,
                "file_name": payload.file_name,
                "title": payload.title,
                "body": payload.body,
                "approved_summary": payload.approved_summary,
                "content_format": payload.content_format,
                "display_policy": payload.display_policy,
                "status": payload.status,
                "priority": payload.priority,
                "tags": payload.tags,
                "source_profile": payload.source_profile,
                "guidance": [item.model_dump() for item in payload.guidance],
                "metadata": {
                    **payload.metadata,
                    "created_from": "kms_admin_faq_source_draft",
                    "kms_admin_item_id": item_id,
                },
            },
        )
        answer_id = response.get("answer", {}).get("answer_id")
        validity_update = None
        if answer_id and (payload.valid_from or payload.valid_until):
            validity_update = await lightrag_client.request_json(
                "PATCH",
                f"/api/answers/{answer_id}",
                workspace=faq_workspace,
                json_body={
                    "valid_from": payload.valid_from.isoformat() if payload.valid_from else None,
                    "valid_until": payload.valid_until.isoformat() if payload.valid_until else None,
                },
            )
            response["answer"] = validity_update
            response["validity_update"] = validity_update
        if not answer_id:
            raise HTTPException(status_code=502, detail="LightRAG source draft response did not include answer_id")
    except httpx.HTTPStatusError as exc:
        await _mark_item_failed(item_id, str(http_error_detail(exc)))
        if answer_id:
            try:
                await lightrag_client.request_json(
                    "POST",
                    f"/api/answers/{answer_id}/archive",
                    workspace=faq_workspace,
                    json_body={},
                )
            except Exception:
                pass
        _raise_lightrag_error(exc)
    except Exception as exc:
        await _mark_item_failed(item_id, str(exc))
        if answer_id:
            try:
                await lightrag_client.request_json(
                    "POST",
                    f"/api/answers/{answer_id}/archive",
                    workspace=faq_workspace,
                    json_body={},
                )
            except Exception:
                pass
        raise

    await _create_ref(
        item_id=item_id,
        ref_type="answer_id",
        workspace_type="faq",
        workspace=faq_workspace,
        external_id=answer_id,
        metadata=response,
    )
    await db.execute(
        "UPDATE KMS_ADMIN_KNOWLEDGE_ITEMS SET status = 'ready', update_time = NOW() WHERE item_id = $1",
        item_id,
    )
    job_id = await _create_completed_faq_job(
        item_id=item_id,
        job_type="faq_source_draft",
        faq_workspace=faq_workspace,
        answer_id=answer_id,
        response=response,
        message="FAQ 소스 초안 등록 완료",
    )
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="create_faq_source_draft",
        tenant_id=_effective_tenant_id(user, payload.tenant_id),
        target_type="knowledge",
        target_id=item_id,
        detail={"workspace": faq_workspace, "answer_id": answer_id, "source_type": payload.source_type, "job_id": job_id},
    )
    return {"item_id": item_id, "job_id": job_id, **response}


@router.post("/{item_id}/sync-track/{track_id}")
async def sync_text_track(
    item_id: str,
    track_id: str,
    user: dict = Depends(get_current_user),
    kms_workspace: str | None = Query(default=None),
) -> dict:
    effective_workspace = _effective_kms_workspace(user, kms_workspace)
    response = await lightrag_client.request_json(
        "GET",
        f"/documents/track_status/{track_id}",
        workspace=effective_workspace,
    )
    for doc in response.get("documents", []):
        if doc.get("id"):
            await _create_ref(
                item_id=item_id,
                ref_type="doc_id",
                workspace_type="kms",
                workspace=effective_workspace,
                external_id=doc["id"],
                metadata=doc,
            )
    status = "ready" if response.get("documents") else "processing"
    await db.execute(
        "UPDATE KMS_ADMIN_KNOWLEDGE_ITEMS SET status = $2, update_time = NOW() WHERE item_id = $1",
        item_id,
        status,
    )
    return {"item_id": item_id, "status": status, "track": response}


@router.patch("/{item_id}")
async def update_knowledge_metadata(
    item_id: str,
    payload: KnowledgeBaseRequest,
    request: Request,
    user: dict = Depends(get_current_user),
) -> dict:
    effective_tenant_id = _effective_tenant_id(user, payload.tenant_id)
    current = await db.fetchrow(
        """
        SELECT item_id
        FROM KMS_ADMIN_KNOWLEDGE_ITEMS
        WHERE item_id = $1
          AND ($2 = 'admin' OR tenant_id = $3)
        """,
        item_id,
        user.get("role"),
        effective_tenant_id,
    )
    if not current:
        raise HTTPException(status_code=404, detail="Knowledge item not found")
    await db.execute(
        """
        UPDATE KMS_ADMIN_KNOWLEDGE_ITEMS
        SET title = $2, body = $3, category_id = $4, enabled = $5,
            valid_from = $6, valid_until = $7, metadata = $8::jsonb,
            version = version + 1, update_time = NOW()
        WHERE item_id = $1
          AND ($9 = 'admin' OR tenant_id = $10)
        """,
        item_id,
        payload.title,
        payload.body,
        payload.category_id,
        payload.enabled,
        payload.valid_from,
        payload.valid_until,
        json.dumps(payload.metadata),
        user.get("role"),
        effective_tenant_id,
    )
    await audit_log(
        request,
        actor_type="user",
        actor_id=user["user_id"],
        action="update_knowledge_metadata",
        tenant_id=effective_tenant_id,
        target_type="knowledge",
        target_id=item_id,
    )
    return {"message": "updated", "item_id": item_id}
