from __future__ import annotations

import json
import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, AsyncIterator

import httpx

from .db import db
from .lightrag_client import http_error_detail, lightrag_client

TOKEN_RE = re.compile(r"[0-9A-Za-z가-힣_]+")


@dataclass
class WorkspaceScope:
    tenant_id: str | None
    kms_workspace: str
    faq_workspace: str


@dataclass
class CandidateScope:
    allowed_doc_ids: list[str] | None
    allowed_answer_ids: list[str] | None
    eligibility: dict[str, Any]


BRIEF_ANSWER_RESPONSE_TYPE = (
    "Brief answer: MAXIMUM 5 bullet points using '- ' (hyphen+space). "
    "Each point is one concise line. Fewer is better."
)

DEFAULT_KMS_QUERY_OPTIONS: dict[str, Any] = {
    "mode": "mix",
    "response_type": BRIEF_ANSWER_RESPONSE_TYPE,
    "include_references": True,
    "include_chunk_content": True,
    "highlight_entities": True,
    "enable_rerank": True,
}


def build_kms_query_payload(
    query: str,
    options: dict[str, Any] | None = None,
    *,
    stream: bool = False,
) -> dict[str, Any]:
    request_payload = {
        "query": query,
        **DEFAULT_KMS_QUERY_OPTIONS,
        **(options or {}),
    }
    if not request_payload.get("include_references"):
        request_payload["include_chunk_content"] = False
    request_payload["stream"] = stream
    return request_payload


def extract_keywords(*values: str | None, limit: int = 12) -> list[str]:
    tokens: list[str] = []
    for value in values:
        if not value:
            continue
        for token in TOKEN_RE.findall(value):
            if len(token) < 2:
                continue
            if token not in tokens:
                tokens.append(token)
            if len(tokens) >= limit:
                return tokens
    return tokens


async def _category_descendants(tenant_id: str | None, category_ids: list[str]) -> list[str]:
    if not category_ids:
        return []
    rows = await db.fetch(
        """
        WITH RECURSIVE cats AS (
            SELECT category_id
            FROM KMS_ADMIN_CATEGORIES
            WHERE category_id = ANY($2::text[])
              AND ($1::text IS NULL OR tenant_id = $1)
            UNION ALL
            SELECT child.category_id
            FROM KMS_ADMIN_CATEGORIES child
            JOIN cats parent ON child.parent_id = parent.category_id
            WHERE ($1::text IS NULL OR child.tenant_id = $1)
        )
        SELECT DISTINCT category_id FROM cats
        """,
        tenant_id,
        category_ids,
    )
    return [row["category_id"] for row in rows]


async def resolve_allowed_refs(
    *,
    scope: WorkspaceScope,
    category_ids: list[str],
) -> tuple[list[str] | None, list[str] | None]:
    if not category_ids:
        return None, None

    categories = await _category_descendants(scope.tenant_id, category_ids)
    params: list[Any] = [scope.kms_workspace, scope.faq_workspace, scope.tenant_id]
    category_filter = ""
    if categories:
        params.append(categories)
        category_filter = f"AND i.category_id = ANY(${len(params)}::text[])"

    rows = await db.fetch(
        f"""
        SELECT r.ref_type, r.external_id, r.workspace_type
        FROM KMS_ADMIN_KNOWLEDGE_ITEMS i
        JOIN KMS_ADMIN_KNOWLEDGE_REFS r ON r.item_id = i.item_id
        WHERE i.enabled = TRUE
          AND (i.valid_from IS NULL OR i.valid_from <= NOW())
          AND (i.valid_until IS NULL OR i.valid_until >= NOW())
          AND ($3::text IS NULL OR i.tenant_id = $3)
          AND (
            (r.workspace_type = 'kms' AND r.workspace = $1)
            OR (r.workspace_type = 'faq' AND r.workspace = $2)
          )
          {category_filter}
        """,
        *params,
    )
    doc_ids = [
        row["external_id"]
        for row in rows
        if row["workspace_type"] == "kms" and row["ref_type"] == "doc_id"
    ]
    answer_ids = [
        row["external_id"]
        for row in rows
        if row["workspace_type"] == "faq" and row["ref_type"] == "answer_id"
    ]
    return sorted(set(doc_ids)), sorted(set(answer_ids))


def _empty_eligibility(category_ids: list[str], expanded_category_ids: list[str]) -> dict[str, Any]:
    return {
        "category_ids": category_ids,
        "expanded_category_ids": expanded_category_ids,
        "kms": {
            "allowed_count": 0,
            "excluded_count": 0,
            "excluded_by_reason": {"expired": 0, "inactive": 0, "not_started": 0},
            "excluded_items": [],
        },
        "faq": {
            "allowed_count": 0,
            "excluded_count": 0,
            "excluded_by_reason": {"expired": 0, "inactive": 0, "not_started": 0},
            "excluded_items": [],
        },
    }


def _validity_exclusion_reason(row: dict[str, Any], now: datetime) -> str | None:
    if not row.get("enabled"):
        return "inactive"
    valid_from = row.get("valid_from")
    if valid_from is not None and valid_from > now:
        return "not_started"
    valid_until = row.get("valid_until")
    if valid_until is not None and valid_until < now:
        return "expired"
    return None


def _item_preview(row: dict[str, Any], reason: str) -> dict[str, Any]:
    return {
        "item_id": row["item_id"],
        "title": row["title"],
        "reason": reason,
        "valid_from": row["valid_from"].isoformat() if row.get("valid_from") else None,
        "valid_until": row["valid_until"].isoformat() if row.get("valid_until") else None,
    }


async def resolve_candidate_scope(
    *,
    scope: WorkspaceScope,
    category_ids: list[str],
) -> CandidateScope:
    expanded_category_ids = await _category_descendants(scope.tenant_id, category_ids) if category_ids else []
    params: list[Any] = [scope.kms_workspace, scope.faq_workspace, scope.tenant_id]
    category_filter = ""
    if category_ids:
        if not expanded_category_ids:
            return CandidateScope(
                allowed_doc_ids=[],
                allowed_answer_ids=[],
                eligibility=_empty_eligibility(category_ids, []),
            )
        params.append(expanded_category_ids)
        category_filter = f"AND i.category_id = ANY(${len(params)}::text[])"

    rows = await db.fetch(
        f"""
        SELECT
            i.item_id,
            i.title,
            i.enabled,
            i.valid_from,
            i.valid_until,
            r.ref_type,
            r.external_id,
            r.workspace_type
        FROM KMS_ADMIN_KNOWLEDGE_ITEMS i
        JOIN KMS_ADMIN_KNOWLEDGE_REFS r ON r.item_id = i.item_id
        WHERE ($3::text IS NULL OR i.tenant_id = $3)
          AND (
            (r.workspace_type = 'kms' AND r.workspace = $1 AND r.ref_type = 'doc_id')
            OR (r.workspace_type = 'faq' AND r.workspace = $2 AND r.ref_type = 'answer_id')
          )
          {category_filter}
        """,
        *params,
    )

    now = datetime.now(timezone.utc)
    doc_ids: set[str] = set()
    answer_ids: set[str] = set()
    eligibility = _empty_eligibility(category_ids, expanded_category_ids)
    excluded_keys: set[tuple[str, str]] = set()

    for row in rows:
        section = "kms" if row["workspace_type"] == "kms" else "faq"
        reason = _validity_exclusion_reason(row, now)
        if reason:
            key = (section, row["item_id"])
            if key in excluded_keys:
                continue
            excluded_keys.add(key)
            section_summary = eligibility[section]
            section_summary["excluded_count"] += 1
            section_summary["excluded_by_reason"][reason] += 1
            if len(section_summary["excluded_items"]) < 10:
                section_summary["excluded_items"].append(_item_preview(row, reason))
            continue

        if row["workspace_type"] == "kms":
            doc_ids.add(row["external_id"])
        else:
            answer_ids.add(row["external_id"])

    eligibility["kms"]["allowed_count"] = len(doc_ids)
    eligibility["faq"]["allowed_count"] = len(answer_ids)
    return CandidateScope(
        allowed_doc_ids=sorted(doc_ids),
        allowed_answer_ids=sorted(answer_ids),
        eligibility=eligibility,
    )


async def integrated_search(
    *,
    actor_type: str,
    actor_id: str | None,
    scope: WorkspaceScope,
    payload: dict[str, Any],
) -> dict[str, Any]:
    started = time.time()
    search_id = str(uuid.uuid4())
    query = str(payload["query"]).strip()
    category_ids = [str(item) for item in payload.get("category_ids") or []]
    include_generative = bool(payload.get("include_generative", True))
    include_faq = bool(payload.get("include_faq", True))
    candidate_scope = await resolve_candidate_scope(
        scope=scope,
        category_ids=category_ids,
    )
    allowed_doc_ids = candidate_scope.allowed_doc_ids
    allowed_answer_ids = candidate_scope.allowed_answer_ids

    generative_answer = None
    faq_results: list[dict[str, Any]] = []
    generative_trace_id = None
    faq_trace_id = None
    errors: list[dict[str, Any]] = []

    if include_generative and allowed_doc_ids != []:
        kms_payload = build_kms_query_payload(query, payload.get("kms_options"), stream=False)
        if allowed_doc_ids is not None:
            kms_payload["allowed_doc_ids"] = allowed_doc_ids
        try:
            generative_answer = await lightrag_client.request_json(
                "POST",
                "/query",
                workspace=scope.kms_workspace,
                json_body=kms_payload,
            )
            generative_trace_id = generative_answer.get("trace_id")
        except httpx.HTTPStatusError as exc:
            errors.append(
                {
                    "source": "generative",
                    "status_code": exc.response.status_code,
                    "detail": http_error_detail(exc),
                }
            )

    if include_faq and allowed_answer_ids != []:
        faq_payload = {
            "query": query,
            "include_candidates": True,
            **(payload.get("faq_options") or {}),
        }
        if allowed_answer_ids is not None:
            faq_payload["allowed_answer_ids"] = allowed_answer_ids
        try:
            faq_response = await lightrag_client.request_json(
                "POST",
                "/api/answers/search",
                workspace=scope.faq_workspace,
                json_body=faq_payload,
            )
            faq_trace_id = faq_response.get("trace_id")
            faq_results = [faq_response] if faq_response.get("matched") else faq_response.get("candidates", [])
        except httpx.HTTPStatusError as exc:
            errors.append(
                {
                    "source": "faq",
                    "status_code": exc.response.status_code,
                    "detail": http_error_detail(exc),
                }
            )

    keywords = extract_keywords(
        query,
        generative_answer.get("response") if isinstance(generative_answer, dict) else None,
        *(str(item.get("title") or item.get("response") or "") for item in faq_results),
    )
    latency_ms = int((time.time() - started) * 1000)
    result = {
        "search_id": search_id,
        "generative_answer": generative_answer,
        "faq_results": faq_results,
        "keywords": keywords,
        "references": (generative_answer or {}).get("references", []),
        "latency_ms": latency_ms,
        "trace": {
            "tenant_id": scope.tenant_id,
            "kms_workspace": scope.kms_workspace,
            "faq_workspace": scope.faq_workspace,
            "generative_trace_id": generative_trace_id,
            "faq_trace_id": faq_trace_id,
            "allowed_doc_count": None if allowed_doc_ids is None else len(allowed_doc_ids),
            "allowed_answer_count": None if allowed_answer_ids is None else len(allowed_answer_ids),
            "eligibility": candidate_scope.eligibility,
            "errors": errors,
        },
    }
    await db.execute(
        """
        INSERT INTO KMS_ADMIN_SEARCH_LOGS(
            search_id, tenant_id, actor_type, actor_id, query, category_ids, include_generative,
            include_faq, kms_workspace, faq_workspace, generative_trace_id, faq_trace_id,
            result_summary, latency_ms, client_trace_id
        )
        VALUES($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15)
        """,
        search_id,
        scope.tenant_id,
        actor_type,
        actor_id,
        query,
        json.dumps(category_ids),
        include_generative,
        include_faq,
        scope.kms_workspace,
        scope.faq_workspace,
        generative_trace_id,
        faq_trace_id,
        json.dumps(
            {
                "keyword_count": len(keywords),
                "faq_count": len(faq_results),
                "has_generative_answer": generative_answer is not None,
                "eligibility": candidate_scope.eligibility,
            }
        ),
        latency_ms,
        payload.get("client_trace_id"),
    )
    return result


async def integrated_search_stream(
    *,
    actor_type: str,
    actor_id: str | None,
    scope: WorkspaceScope,
    payload: dict[str, Any],
) -> AsyncIterator[dict[str, Any]]:
    started = time.time()
    search_id = str(uuid.uuid4())
    query = str(payload["query"]).strip()
    category_ids = [str(item) for item in payload.get("category_ids") or []]
    candidate_scope = await resolve_candidate_scope(
        scope=scope,
        category_ids=category_ids,
    )
    allowed_doc_ids = candidate_scope.allowed_doc_ids
    allowed_answer_ids = candidate_scope.allowed_answer_ids
    yield {
        "event": "metadata",
        "search_id": search_id,
        "tenant_id": scope.tenant_id,
        "kms_workspace": scope.kms_workspace,
        "faq_workspace": scope.faq_workspace,
        "allowed_doc_count": None if allowed_doc_ids is None else len(allowed_doc_ids),
        "allowed_answer_count": None if allowed_answer_ids is None else len(allowed_answer_ids),
        "eligibility": candidate_scope.eligibility,
    }

    accumulated = ""
    references: list[dict[str, Any]] = []
    if payload.get("include_generative", True) and allowed_doc_ids != []:
        kms_payload = build_kms_query_payload(query, payload.get("kms_options"), stream=True)
        if allowed_doc_ids is not None:
            kms_payload["allowed_doc_ids"] = allowed_doc_ids
        try:
            async for event in lightrag_client.stream_ndjson(
                "/query/stream",
                workspace=scope.kms_workspace,
                json_body=kms_payload,
            ):
                if "references" in event:
                    references = event["references"]
                if "response" in event:
                    accumulated += event["response"]
                    yield {"event": "generative_delta", "search_id": search_id, "delta": event["response"]}
                if "error" in event:
                    yield {"event": "error", "search_id": search_id, "source": "generative", "message": event["error"]}
        except httpx.HTTPStatusError as exc:
            yield {
                "event": "error",
                "search_id": search_id,
                "source": "generative",
                "status_code": exc.response.status_code,
                "message": http_error_detail(exc),
            }

    faq_results: list[dict[str, Any]] = []
    if payload.get("include_faq", True) and allowed_answer_ids != []:
        faq_payload = {
            "query": query,
            "include_candidates": True,
            **(payload.get("faq_options") or {}),
        }
        if allowed_answer_ids is not None:
            faq_payload["allowed_answer_ids"] = allowed_answer_ids
        try:
            faq_response = await lightrag_client.request_json(
                "POST",
                "/api/answers/search",
                workspace=scope.faq_workspace,
                json_body=faq_payload,
            )
            faq_results = [faq_response] if faq_response.get("matched") else faq_response.get("candidates", [])
            yield {"event": "faq_results", "search_id": search_id, "results": faq_results}
        except httpx.HTTPStatusError as exc:
            yield {
                "event": "error",
                "search_id": search_id,
                "source": "faq",
                "status_code": exc.response.status_code,
                "message": http_error_detail(exc),
            }

    latency_ms = int((time.time() - started) * 1000)
    await db.execute(
        """
        INSERT INTO KMS_ADMIN_SEARCH_LOGS(
            search_id, tenant_id, actor_type, actor_id, query, category_ids, include_generative,
            include_faq, kms_workspace, faq_workspace, result_summary, latency_ms,
            client_trace_id
        )
        VALUES($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11::jsonb, $12, $13)
        """,
        search_id,
        scope.tenant_id,
        actor_type,
        actor_id,
        query,
        json.dumps(category_ids),
        bool(payload.get("include_generative", True)),
        bool(payload.get("include_faq", True)),
        scope.kms_workspace,
        scope.faq_workspace,
        json.dumps(
            {
                "faq_count": len(faq_results),
                "references_count": len(references),
                "eligibility": candidate_scope.eligibility,
            }
        ),
        latency_ms,
        payload.get("client_trace_id"),
    )
    yield {
        "event": "done",
        "search_id": search_id,
        "tenant_id": scope.tenant_id,
        "kms_workspace": scope.kms_workspace,
        "faq_workspace": scope.faq_workspace,
        "latency_ms": latency_ms,
        "keywords": extract_keywords(query, accumulated),
        "references": references,
        "eligibility": candidate_scope.eligibility,
    }
