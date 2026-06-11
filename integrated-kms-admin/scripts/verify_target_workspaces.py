#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from dataclasses import dataclass
from typing import Any, Iterable

import httpx


DEFAULT_BASE_URL = "http://127.0.0.1:9522"
DEFAULT_KMS_WORKSPACE = "kevcs"
DEFAULT_FAQ_WORKSPACE = "kevcs_faq_pair_20260609_145749"
DEFAULT_QUERY = "카드 인증이 실패할 때 어떻게 해야 하나요?"

BRIEF_ANSWER_RESPONSE_TYPE = (
    "Brief answer: MAXIMUM 5 bullet points using '- ' (hyphen+space). "
    "Each point is one concise line. Fewer is better."
)


@dataclass
class CheckResult:
    name: str
    detail: str


class Verifier:
    def __init__(self, args: argparse.Namespace) -> None:
        timeout = httpx.Timeout(args.timeout, connect=10.0)
        self.client = httpx.Client(base_url=args.base_url.rstrip("/"), timeout=timeout)
        self.args = args
        self.results: list[CheckResult] = []
        self.token = ""

    def close(self) -> None:
        self.client.close()

    @property
    def auth_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    def pass_check(self, name: str, detail: str = "") -> None:
        self.results.append(CheckResult(name, detail))
        print(f"[OK] {name}{f' - {detail}' if detail else ''}")

    def request(
        self,
        method: str,
        path: str,
        *,
        expected: Iterable[int] = (200,),
        auth: bool = True,
        **kwargs: Any,
    ) -> httpx.Response:
        headers = kwargs.pop("headers", {})
        if auth:
            headers = {**self.auth_headers, **headers}
        response = self.client.request(method, path, headers=headers, **kwargs)
        if response.status_code not in set(expected):
            body = response.text[:1000]
            raise AssertionError(f"{method} {path} returned {response.status_code}: {body}")
        return response

    def json_request(
        self,
        method: str,
        path: str,
        *,
        expected: Iterable[int] = (200,),
        auth: bool = True,
        **kwargs: Any,
    ) -> dict[str, Any]:
        response = self.request(method, path, expected=expected, auth=auth, **kwargs)
        try:
            payload = response.json()
        except json.JSONDecodeError as exc:
            raise AssertionError(f"{method} {path} did not return JSON") from exc
        if not isinstance(payload, dict):
            raise AssertionError(f"{method} {path} returned non-object JSON")
        return payload

    def login(self) -> None:
        payload = self.json_request(
            "POST",
            "/api/auth/login",
            auth=False,
            json={"user_id": self.args.admin_id, "password": self.args.admin_password},
        )
        self.token = str(payload.get("access_token") or "")
        if not self.token:
            raise AssertionError("login did not return access_token")
        self.pass_check("admin login", self.args.admin_id)

    def verify_health_and_me(self) -> None:
        health = self.json_request("GET", "/api/system/health", auth=False)
        if health.get("status") != "ok":
            raise AssertionError(f"admin health is not ok: {health}")
        if not health.get("database", {}).get("ok"):
            raise AssertionError("admin database health is not ok")
        if health.get("lightrag", {}).get("status") != "healthy":
            raise AssertionError("LightRAG health is not healthy through admin")
        self.pass_check("system health", f"latency={health.get('latency_ms')}ms")

        me = self.json_request("GET", "/api/auth/me")
        user = me.get("user") or me
        if user.get("kms_workspace") != self.args.kms_workspace:
            raise AssertionError(f"unexpected KMS workspace in /me: {user}")
        if user.get("faq_workspace") != self.args.faq_workspace:
            raise AssertionError(f"unexpected FAQ workspace in /me: {user}")
        self.pass_check(
            "auth workspace pair",
            f"{user.get('kms_workspace')} / {user.get('faq_workspace')}",
        )

    @staticmethod
    def _workspace_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
        for key in ("workspaces", "items", "data"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
        return []

    @staticmethod
    def _row_mentions(row: dict[str, Any], value: str) -> bool:
        return any(str(item) == value for item in row.values()) or value in json.dumps(
            row,
            ensure_ascii=False,
        )

    def verify_workspaces(self) -> None:
        kms_payload = self.json_request(
            "GET",
            "/api/lightrag/workspaces",
            params={"workspace_mode": "kms", "search": self.args.kms_workspace},
        )
        kms_rows = self._workspace_rows(kms_payload)
        if not any(self._row_mentions(row, self.args.kms_workspace) for row in kms_rows):
            raise AssertionError(f"KMS workspace not found: {self.args.kms_workspace}")
        self.pass_check("KMS workspace selectable", self.args.kms_workspace)

        faq_payload = self.json_request(
            "GET",
            "/api/lightrag/workspaces",
            params={"workspace_mode": "answer_catalog", "search": self.args.faq_workspace},
        )
        faq_rows = self._workspace_rows(faq_payload)
        if not any(self._row_mentions(row, self.args.faq_workspace) for row in faq_rows):
            raise AssertionError(f"FAQ workspace not found: {self.args.faq_workspace}")
        self.pass_check("FAQ workspace selectable", self.args.faq_workspace)

    def verify_categories(self) -> None:
        payload = self.json_request("GET", "/api/categories")
        if "categories" not in payload:
            raise AssertionError("category response is missing categories")
        self.pass_check("category list", f"count={len(payload['categories'])}")

    def verify_category_crud(self, suffix: str) -> None:
        parent = self.json_request(
            "POST",
            "/api/categories",
            json={"name": f"codex-verify-{suffix}", "metadata": {"source": "verify"}},
        )
        parent_id = parent["category_id"]
        child = self.json_request(
            "POST",
            "/api/categories",
            json={
                "name": f"child-{suffix}",
                "parent_id": parent_id,
                "metadata": {"source": "verify"},
            },
        )
        child_id = child["category_id"]
        updated = self.json_request(
            "PATCH",
            f"/api/categories/{child_id}",
            json={
                "name": f"child-renamed-{suffix}",
                "parent_id": parent_id,
                "sort_order": 1,
                "is_active": True,
                "metadata": {"source": "verify", "updated": True},
            },
        )
        if f"child-renamed-{suffix}" not in updated.get("path", ""):
            raise AssertionError(f"category rename did not update path: {updated}")
        self.request("DELETE", f"/api/categories/{child_id}")
        self.request("DELETE", f"/api/categories/{parent_id}")
        self.pass_check("category tree CRUD", f"parent={parent_id} child={child_id}")

    def verify_users(self) -> None:
        payload = self.json_request("GET", "/api/users")
        if not isinstance(payload.get("users"), list):
            raise AssertionError("users response is missing users")
        self.pass_check("user list", f"count={len(payload['users'])}")

    def verify_user_crud(self, suffix: str) -> None:
        user_id = f"codex_verify_{suffix}"
        first_password = "VerifyPass123!"
        second_password = "VerifyPass456!"
        self.json_request(
            "POST",
            "/api/users",
            json={
                "user_id": user_id,
                "password": first_password,
                "role": "user",
                "display_name": "Codex Verify User",
                "kms_workspace": self.args.kms_workspace,
                "faq_workspace": self.args.faq_workspace,
                "is_active": True,
            },
        )
        login = self.json_request(
            "POST",
            "/api/auth/login",
            auth=False,
            json={"user_id": user_id, "password": first_password},
        )
        if not login.get("access_token"):
            raise AssertionError("created user cannot login")
        self.json_request(
            "POST",
            f"/api/users/{user_id}/password",
            json={"password": second_password},
        )
        login2 = self.json_request(
            "POST",
            "/api/auth/login",
            auth=False,
            json={"user_id": user_id, "password": second_password},
        )
        if not login2.get("access_token"):
            raise AssertionError("password-updated user cannot login")
        self.json_request("GET", f"/api/users/{user_id}/history")
        self.request("GET", f"/api/users/{user_id}/history.csv")
        self.json_request(
            "PATCH",
            f"/api/users/{user_id}",
            json={"is_active": False, "display_name": "Codex Verify User Disabled"},
        )
        self.pass_check("user create/login/password/history/deactivate", user_id)

    def verify_knowledge_read(self) -> str | None:
        payload = self.json_request(
            "GET",
            "/api/knowledge",
            params={
                "kms_workspace": self.args.kms_workspace,
                "faq_workspace": self.args.faq_workspace,
            },
        )
        scope = payload.get("scope") or {}
        if scope.get("kms_workspace") != self.args.kms_workspace:
            raise AssertionError(f"knowledge scope mismatch: {scope}")
        self.pass_check("knowledge ledger list", f"items={len(payload.get('items') or [])}")

        docs = self.json_request(
            "GET",
            "/api/knowledge/kms-documents",
            params={"kms_workspace": self.args.kms_workspace, "page": 1, "page_size": 10},
        )
        doc_rows = docs.get("documents") or docs.get("items") or []
        if not doc_rows:
            raise AssertionError("KMS document list is empty")
        doc_id = doc_rows[0].get("id")
        if not doc_id:
            raise AssertionError(f"first KMS document has no id: {doc_rows[0]}")
        self.pass_check("KMS document list", f"count={len(doc_rows)} first={doc_id}")

        detail = self.json_request(
            "GET",
            f"/api/knowledge/kms-documents/{doc_id}/detail",
            params={"kms_workspace": self.args.kms_workspace},
        )
        if not detail.get("preview"):
            raise AssertionError("KMS document detail is missing preview")
        self.pass_check(
            "KMS document detail",
            f"chunks={len(detail.get('preview', {}).get('chunks') or [])}",
        )

        chunks = self.json_request(
            "GET",
            f"/api/knowledge/kms-documents/{doc_id}/chunks",
            params={"kms_workspace": self.args.kms_workspace},
        )
        chunk_rows = chunks.get("chunks") or []
        if chunk_rows:
            chunk_id = chunk_rows[0].get("id") or chunk_rows[0].get("chunk_id")
            if chunk_id:
                self.json_request(
                    "GET",
                    f"/api/knowledge/kms-chunks/{chunk_id}",
                    params={"kms_workspace": self.args.kms_workspace},
                )
                self.json_request(
                    "POST",
                    "/api/knowledge/kms-deletions/preview",
                    params={"kms_workspace": self.args.kms_workspace},
                    json={
                        "target_type": "chunk",
                        "policy": "force_delete_chunks",
                        "ids": [chunk_id],
                        "relations": [],
                        "invalidate_cache": True,
                    },
                )
                self.pass_check("KMS chunk detail and delete preview", chunk_id)
        return doc_id

    def verify_graph(self) -> None:
        types = self.json_request(
            "GET",
            "/api/knowledge/kms-entity-types",
            params={"kms_workspace": self.args.kms_workspace},
        )
        if int(types.get("total_entities") or 0) <= 0:
            raise AssertionError("entity type response has no entities")
        self.pass_check("KMS entity types", f"total={types.get('total_entities')}")

        entities = self.json_request(
            "POST",
            "/api/knowledge/kms-entities",
            params={"kms_workspace": self.args.kms_workspace},
            json={"page": 1, "page_size": 5, "sort_field": "entity_id", "sort_direction": "asc"},
        )
        entity_rows = entities.get("entities") or []
        if not entity_rows:
            raise AssertionError("entity list is empty")
        entity_id = entity_rows[0]["entity_id"]
        self.json_request(
            "GET",
            f"/api/knowledge/kms-entities/{entity_id}/related",
            params={"kms_workspace": self.args.kms_workspace},
        )
        self.pass_check("KMS entities and related lookup", entity_id)

        relations = self.json_request(
            "POST",
            "/api/knowledge/kms-relations",
            params={"kms_workspace": self.args.kms_workspace},
            json={"page": 1, "page_size": 5, "sort_field": "source_id", "sort_direction": "asc"},
        )
        if not relations.get("relations"):
            raise AssertionError("relation list is empty")
        self.pass_check("KMS relations", f"count={relations.get('pagination', {}).get('total_count')}")

    def verify_faq(self) -> None:
        answers = self.json_request(
            "GET",
            "/api/knowledge/faq-answers",
            params={"faq_workspace": self.args.faq_workspace, "page": 1, "page_size": 5},
        )
        answer_rows = answers.get("answers") or []
        self.pass_check("FAQ answer list", f"count={len(answer_rows)}")
        if answer_rows:
            answer_id = answer_rows[0].get("answer_id")
            if answer_id:
                self.json_request(
                    "GET",
                    f"/api/knowledge/faq-answers/{answer_id}",
                    params={"faq_workspace": self.args.faq_workspace},
                )
                self.json_request(
                    "GET",
                    f"/api/knowledge/faq-answers/{answer_id}/guidance",
                    params={"faq_workspace": self.args.faq_workspace},
                )
                self.pass_check("FAQ answer detail/guidance", answer_id)

        candidates = self.json_request(
            "POST",
            "/api/knowledge/faq-answers/search",
            params={"faq_workspace": self.args.faq_workspace},
            json={
                "query": self.args.query,
                "top_k": 5,
                "include_drafts": True,
                "include_candidates": True,
            },
        )
        if not candidates.get("matched") and not candidates.get("candidates"):
            raise AssertionError("FAQ candidate search returned no match or candidates")
        self.pass_check(
            "FAQ candidate search",
            f"matched={candidates.get('matched')} candidates={len(candidates.get('candidates') or [])}",
        )

    def verify_faq_mutating(self, suffix: str) -> None:
        marker = f"CODEX_VERIFY_FAQ_{suffix}"
        created = self.json_request(
            "POST",
            "/api/knowledge/faq-source-draft",
            json={
                "title": f"codex verify FAQ source draft {suffix}",
                "body": (
                    f"{marker}. Temporary FAQ source draft created by the integrated KMS admin "
                    "verification script."
                ),
                "approved_summary": f"{marker} summary",
                "enabled": True,
                "valid_from": "2026-01-01T00:00:00Z",
                "valid_until": "2030-01-01T00:00:00Z",
                "kms_workspace": self.args.kms_workspace,
                "faq_workspace": self.args.faq_workspace,
                "source_type": "plain",
                "source_uri": f"verify://{suffix}",
                "file_name": f"verify-{suffix}.txt",
                "content_format": "markdown",
                "display_policy": "both",
                "status": "draft",
                "priority": 0,
                "tags": ["codex-verify"],
                "source_profile": {"source": "verify"},
                "metadata": {"source": "verify", "marker": marker},
                "guidance": [
                    {
                        "guidance_type": "keyword",
                        "text": marker,
                        "weight": 1.0,
                        "source": "verify",
                        "metadata": {"source": "verify"},
                    }
                ],
            },
        )
        answer_id = (created.get("answer") or {}).get("answer_id") or created.get("answer_id")
        if not answer_id:
            raise AssertionError(f"FAQ source draft did not return answer_id: {created}")

        updated = self.json_request(
            "PATCH",
            f"/api/knowledge/faq-answers/{answer_id}",
            params={"faq_workspace": self.args.faq_workspace},
            json={
                "title": f"codex verify FAQ updated {suffix}",
                "body": f"{marker}. Updated temporary FAQ answer body.",
                "approved_summary": f"{marker} updated summary",
                "status": "draft",
                "valid_from": "2026-01-01T00:00:00Z",
                "valid_until": "2030-01-01T00:00:00Z",
                "tags": ["codex-verify", "updated"],
                "metadata": {"source": "verify", "updated": True},
            },
        )
        if updated.get("answer_id") != answer_id:
            raise AssertionError(f"FAQ patch returned unexpected answer: {updated}")

        guidance = self.json_request(
            "POST",
            f"/api/knowledge/faq-answers/{answer_id}/guidance",
            params={"faq_workspace": self.args.faq_workspace},
            json={
                "guidance_type": "question",
                "text": f"{marker} question?",
                "weight": 1.0,
                "metadata": {"source": "verify"},
            },
        )
        guidance_id = guidance.get("guidance_id") or (guidance.get("guidance") or {}).get("guidance_id")
        if not guidance_id:
            raise AssertionError(f"FAQ guidance create did not return guidance_id: {guidance}")
        guidance_list = self.json_request(
            "GET",
            f"/api/knowledge/faq-answers/{answer_id}/guidance",
            params={"faq_workspace": self.args.faq_workspace},
        )
        if not any(item.get("guidance_id") == guidance_id for item in guidance_list.get("guidance") or []):
            raise AssertionError(f"created FAQ guidance not found in list: {guidance_list}")
        self.json_request(
            "DELETE",
            f"/api/knowledge/faq-answers/{answer_id}/guidance/{guidance_id}",
            params={"faq_workspace": self.args.faq_workspace},
        )

        self.json_request(
            "POST",
            f"/api/knowledge/faq-answers/{answer_id}/publish",
            params={"faq_workspace": self.args.faq_workspace},
        )
        self.json_request(
            "POST",
            f"/api/knowledge/faq-answers/{answer_id}/vectors-rebuild",
            params={"faq_workspace": self.args.faq_workspace},
        )
        self.json_request(
            "POST",
            f"/api/knowledge/faq-answers/{answer_id}/archive",
            params={"faq_workspace": self.args.faq_workspace},
        )
        final = self.json_request(
            "GET",
            f"/api/knowledge/faq-answers/{answer_id}",
            params={"faq_workspace": self.args.faq_workspace},
        )
        if final.get("status") != "archived":
            raise AssertionError(f"FAQ answer was not archived after verification: {final}")
        self.pass_check("FAQ source draft/update/guidance/publish/rebuild/archive", answer_id)

    def verify_integrated_search(self) -> None:
        payload = self.json_request(
            "POST",
            "/api/search/integrated",
            json={
                "query": self.args.query,
                "category_ids": [],
                "include_generative": True,
                "include_faq": True,
                "kms_workspace": self.args.kms_workspace,
                "faq_workspace": self.args.faq_workspace,
                "kms_options": {
                    "mode": "mix",
                    "response_type": BRIEF_ANSWER_RESPONSE_TYPE,
                    "include_references": True,
                    "include_chunk_content": True,
                    "highlight_entities": True,
                    "enable_rerank": True,
                },
                "faq_options": {"top_k": 5, "include_candidates": True},
                "client_trace_id": f"verify-{uuid.uuid4().hex[:8]}",
            },
        )
        trace = payload.get("trace") or {}
        if trace.get("kms_workspace") != self.args.kms_workspace:
            raise AssertionError(f"integrated search KMS trace mismatch: {trace}")
        if trace.get("faq_workspace") != self.args.faq_workspace:
            raise AssertionError(f"integrated search FAQ trace mismatch: {trace}")
        if payload.get("generative_answer") is None and not payload.get("faq_results"):
            raise AssertionError(f"integrated search returned no result: {payload}")
        self.pass_check(
            "integrated search",
            f"latency={payload.get('latency_ms')}ms keywords={len(payload.get('keywords') or [])}",
        )

    def verify_stats_and_jobs(self) -> None:
        stats = self.json_request("GET", "/api/system/stats", params={"period": "7d"})
        if not stats.get("totals"):
            raise AssertionError("stats response missing totals")
        self.request("GET", "/api/system/stats.csv", params={"period": "7d"})
        self.json_request(
            "GET",
            "/api/system/stats/keyword-detail",
            params={"period": "30d", "keyword": self.args.query},
        )
        self.pass_check("stats and keyword detail", f"searches={stats['totals'].get('searches')}")

        jobs = self.json_request("GET", "/api/jobs")
        job_rows = jobs.get("jobs") or []
        self.pass_check("job list", f"count={len(job_rows)}")
        stream_job = next(
            (
                job
                for job in job_rows
                if job.get("lightrag_task_id")
                or any(task.get("task_id") for task in (job.get("metadata") or {}).get("tasks") or [])
            ),
            None,
        )
        if stream_job:
            with self.client.stream(
                "GET",
                f"/api/jobs/{stream_job['job_id']}/stream",
                params={"persist_events": False},
                headers=self.auth_headers,
            ) as response:
                if response.status_code != 200:
                    raise AssertionError(f"job stream failed: {response.status_code} {response.text}")
                first_line = next(response.iter_lines(), "")
                if '"event": "job"' not in first_line:
                    raise AssertionError(f"unexpected job stream first line: {first_line}")
            self.pass_check("job stream", stream_job["job_id"])

    def verify_external_client(self, suffix: str) -> None:
        created = self.json_request(
            "POST",
            "/api/external-clients",
            json={
                "display_name": f"codex verify client {suffix}",
                "kms_workspace": self.args.kms_workspace,
                "faq_workspace": self.args.faq_workspace,
                "scopes": ["search"],
                "rate_limit_per_minute": 10,
                "metadata": {"source": "verify"},
            },
        )
        client_id = created["client_id"]
        api_key = created["api_key"]
        external_headers = {"X-KMS-ADMIN-API-Key": api_key}

        external = self.json_request(
            "POST",
            "/api/external/search",
            auth=False,
            headers=external_headers,
            json={
                "query": self.args.query,
                "include_generative": False,
                "include_faq": True,
                "faq_options": {"top_k": 5, "include_candidates": True},
                "client_trace_id": f"external-verify-{suffix}",
            },
        )
        if not external.get("search_id"):
            raise AssertionError(f"external search missing search_id: {external}")

        with self.client.stream(
            "POST",
            "/api/external/search/stream",
            headers=external_headers,
            json={
                "query": self.args.query,
                "include_generative": False,
                "include_faq": True,
                "faq_options": {"top_k": 3, "include_candidates": True},
            },
        ) as response:
            if response.status_code != 200:
                raise AssertionError(f"external stream failed: {response.status_code} {response.text}")
            first_line = next(response.iter_lines(), "")
            if "metadata" not in first_line:
                raise AssertionError(f"unexpected external stream first line: {first_line}")

        rotated = self.json_request("POST", f"/api/external-clients/{client_id}/rotate-key")
        new_key = rotated["api_key"]
        self.request(
            "POST",
            "/api/external/search",
            expected=(401,),
            auth=False,
            headers=external_headers,
            json={"query": self.args.query, "include_generative": False, "include_faq": True},
        )
        self.json_request(
            "POST",
            "/api/external/search",
            auth=False,
            headers={"X-KMS-ADMIN-API-Key": new_key},
            json={"query": self.args.query, "include_generative": False, "include_faq": True},
        )
        self.json_request(
            "PATCH",
            f"/api/external-clients/{client_id}",
            json={"is_active": False, "display_name": f"codex verify client {suffix} disabled"},
        )
        self.json_request("POST", f"/api/external-clients/{client_id}/revoke-key")
        self.pass_check("external client create/search/stream/rotate/revoke", client_id)

    def verify_text_ingest(self, suffix: str) -> None:
        title = f"codex verify text ingest {suffix}"
        created = self.json_request(
            "POST",
            "/api/knowledge/text",
            json={
                "title": title,
                "body": (
                    f"{title}. Temporary verification document for integrated KMS admin. "
                    f"Marker CODEX_VERIFY_TEXT_{suffix}."
                ),
                "enabled": True,
                "kms_workspace": self.args.kms_workspace,
                "faq_workspace": self.args.faq_workspace,
                "file_source": title,
                "metadata": {"source": "verify"},
            },
        )
        job_id = created["job_id"]
        synced: dict[str, Any] = {}
        for _ in range(self.args.ingest_poll_attempts):
            time.sleep(self.args.ingest_poll_interval)
            synced = self.json_request("POST", f"/api/jobs/{job_id}/sync")
            if synced.get("status") in {"completed", "failed", "cancelled"}:
                break
        if synced.get("status") != "completed":
            raise AssertionError(f"text ingest did not complete: {synced}")
        track_docs = (synced.get("track") or {}).get("documents") or []
        if not track_docs:
            raise AssertionError(f"text ingest completed without document refs: {synced}")
        rollback = self.json_request("POST", f"/api/jobs/{job_id}/rollback")
        if rollback.get("rollback_status") != "completed":
            raise AssertionError(f"unexpected rollback result: {rollback}")
        self.pass_check("text knowledge ingest and rollback", job_id)

    def run(self) -> None:
        suffix = time.strftime("%Y%m%d%H%M%S")
        self.login()
        self.verify_health_and_me()
        self.verify_workspaces()
        self.verify_categories()
        self.verify_users()
        self.verify_knowledge_read()
        self.verify_graph()
        self.verify_faq()
        self.verify_integrated_search()
        self.verify_stats_and_jobs()
        if self.args.mutating:
            self.verify_category_crud(suffix)
            self.verify_user_crud(suffix)
            self.verify_faq_mutating(suffix)
            self.verify_external_client(suffix)
        if self.args.ingest_text:
            self.verify_text_ingest(suffix)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify Integrated KMS Admin against the target LightRAG workspaces.",
    )
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--admin-id", default="admin")
    parser.add_argument("--admin-password", default="admin123")
    parser.add_argument("--kms-workspace", default=DEFAULT_KMS_WORKSPACE)
    parser.add_argument("--faq-workspace", default=DEFAULT_FAQ_WORKSPACE)
    parser.add_argument("--query", default=DEFAULT_QUERY)
    parser.add_argument("--timeout", type=float, default=180.0)
    parser.add_argument(
        "--mutating",
        action="store_true",
        help="Also verify category/user/external-client write flows.",
    )
    parser.add_argument(
        "--ingest-text",
        action="store_true",
        help="Also create a temporary text knowledge item and rollback its LightRAG refs.",
    )
    parser.add_argument("--ingest-poll-attempts", type=int, default=16)
    parser.add_argument("--ingest-poll-interval", type=float, default=1.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    verifier = Verifier(args)
    try:
        verifier.run()
    finally:
        verifier.close()
    print(f"\nVerified {len(verifier.results)} checks against {args.base_url}.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"\n[FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
