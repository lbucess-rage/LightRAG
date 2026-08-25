import ast
import asyncio
from pathlib import Path
from datetime import datetime, timedelta, timezone

from kms_admin import search_service
from kms_admin.config import settings
from kms_admin.routers.knowledge import (
    _document_status_filter,
    _effective_faq_workspace,
    _effective_kms_workspace,
    _json_list,
    _text_file_sources,
)
from kms_admin.routers import search as search_router
from kms_admin.routers.search import EXTERNAL_CATEGORIES_SQL, IntegratedSearchRequest
from kms_admin.search_service import (
    BRIEF_ANSWER_RESPONSE_TYPE,
    CandidateScope,
    WorkspaceScope,
    build_faq_search_payload,
    build_kms_query_payload,
    extract_keywords,
    resolve_candidate_scope,
    resolve_allowed_refs,
)


def test_extract_keywords_deduplicates_and_limits():
    keywords = extract_keywords("환불 환불 방법", "멤버십 환불 정책", limit=3)

    assert keywords == ["환불", "방법", "멤버십"]


def test_build_kms_query_payload_uses_admin_defaults():
    payload = build_kms_query_payload("카드 인증 실패")

    assert payload["query"] == "카드 인증 실패"
    assert payload["mode"] == "mix"
    assert payload["response_type"] == BRIEF_ANSWER_RESPONSE_TYPE
    assert payload["include_references"] is True
    assert payload["include_chunk_content"] is True
    assert payload["highlight_entities"] is True
    assert payload["enable_rerank"] is True
    assert payload["stream"] is False


def test_build_faq_search_payload_defaults_to_graph_hybrid():
    payload = build_faq_search_payload("카드 인증 실패")

    assert payload == {
        "query": "카드 인증 실패",
        "include_candidates": True,
        "retrieval_mode": "graph_hybrid",
    }


def test_build_faq_search_payload_preserves_caller_override():
    payload = build_faq_search_payload(
        "카드 인증 실패",
        {"retrieval_mode": "hybrid", "top_k": 3},
    )

    assert payload["retrieval_mode"] == "hybrid"
    assert payload["top_k"] == 3


def test_external_categories_query_documents_valid_counts_and_active_filter():
    assert "valid_direct_knowledge_count" in EXTERNAL_CATEGORIES_SQL
    assert "valid_total_knowledge_count" in EXTERNAL_CATEGORIES_SQL
    assert "valid_from IS NULL OR valid_from <= NOW()" in EXTERNAL_CATEGORIES_SQL
    assert "valid_until IS NULL OR valid_until >= NOW()" in EXTERNAL_CATEGORIES_SQL
    assert "$2::boolean OR is_active = TRUE" in EXTERNAL_CATEGORIES_SQL


def test_admin_integrated_search_resolves_registered_tenant_pair(monkeypatch):
    class FakeDb:
        async def fetchrow(self, query, *params):
            assert params == ("tenant-1",)
            return {
                "tenant_id": "tenant-1",
                "kms_workspace": "kms-1",
                "faq_workspace": "faq-1",
            }

    monkeypatch.setattr(search_router, "db", FakeDb())
    scope = asyncio.run(
        search_router._internal_scope(
            IntegratedSearchRequest(
                query="문의",
                tenant_id="tenant-1",
                kms_workspace="stale-kms",
                faq_workspace="stale-faq",
            ),
            {"role": "admin", "tenant_id": "admin-default"},
        )
    )

    assert scope == WorkspaceScope("tenant-1", "kms-1", "faq-1")


def test_non_admin_integrated_search_ignores_requested_workspace_override():
    scope = asyncio.run(
        search_router._internal_scope(
            IntegratedSearchRequest(
                query="문의",
                tenant_id="other-tenant",
                kms_workspace="other-kms",
                faq_workspace="other-faq",
            ),
            {
                "role": "manager",
                "tenant_id": "tenant-1",
                "kms_workspace": "kms-1",
                "faq_workspace": "faq-1",
            },
        )
    )

    assert scope == WorkspaceScope("tenant-1", "kms-1", "faq-1")


def test_admin_workspace_defaults_use_test_pair():
    assert settings.default_kms_workspace == "kevcs"
    assert settings.default_faq_workspace == "kevcs_faq_pair_20260609_145749"
    assert _effective_kms_workspace({}) == "kevcs"
    assert _effective_faq_workspace({}) == "kevcs_faq_pair_20260609_145749"


def test_build_kms_query_payload_disables_chunk_content_without_references():
    payload = build_kms_query_payload(
        "카드 인증 실패",
        {"include_references": False, "include_chunk_content": True},
        stream=True,
    )

    assert payload["include_references"] is False
    assert payload["include_chunk_content"] is False
    assert payload["stream"] is True


def test_resolve_allowed_refs_is_unrestricted_without_category(monkeypatch):
    async def fail_descendants(_category_ids):
        raise AssertionError("category lookup must not run without category filters")

    monkeypatch.setattr(search_service, "_category_descendants", fail_descendants)

    doc_ids, answer_ids = asyncio.run(
        resolve_allowed_refs(
            scope=WorkspaceScope("default", "kevcs", "kevcs_faq_pair_20260609_145749"),
            category_ids=[],
        )
    )

    assert doc_ids is None
    assert answer_ids is None


def test_integrated_search_trace_includes_workspace_scope(monkeypatch):
    class FakeDb:
        async def execute(self, query, *params):
            return "INSERT 0 1"

    async def fake_candidate_scope(**_):
        return CandidateScope(
            allowed_doc_ids=[],
            allowed_answer_ids=[],
            eligibility={
                "kms": {"allowed_count": 0, "excluded_count": 0, "excluded_by_reason": {}},
                "faq": {"allowed_count": 0, "excluded_count": 0, "excluded_by_reason": {}},
            },
        )

    monkeypatch.setattr(search_service, "db", FakeDb())
    monkeypatch.setattr(search_service, "resolve_candidate_scope", fake_candidate_scope)

    result = asyncio.run(
        search_service.integrated_search(
            actor_type="user",
            actor_id="admin",
            scope=WorkspaceScope("default", "kevcs", "kevcs_faq_pair_20260609_145749"),
            payload={
                "query": "카드 인증 실패",
                "include_generative": False,
                "include_faq": False,
            },
        )
    )

    assert result["trace"]["kms_workspace"] == "kevcs"
    assert result["trace"]["faq_workspace"] == "kevcs_faq_pair_20260609_145749"
    assert "eligibility" in result["trace"]


def test_integrated_search_preserves_faq_alias_expansion_metadata(monkeypatch):
    class FakeDb:
        async def execute(self, query, *params):
            return "INSERT 0 1"

    class FakeLightRagClient:
        async def request_json(self, method, path, *, workspace=None, json_body=None):
            assert method == "POST"
            assert path == "/api/answers/search"
            assert workspace == "faq-helpdesk"
            assert json_body["retrieval_mode"] == "graph_hybrid"
            return {
                "matched": True,
                "matched_id": "ANS-TEAMS-1",
                "confidence": 0.91,
                "retrieval_mode": "graph_hybrid",
                "requested_retrieval_mode": "graph_hybrid",
                "effective_retrieval_mode": "graph_hybrid",
                "graph_status": "graph_ready",
                "selected_by": "graph_hybrid",
                "alias_expansions": [
                    {"source": "팀즈", "canonical": "Microsoft Teams"},
                ],
                "title": "Teams 연결 오류",
            }

    async def fake_candidate_scope(**_):
        return CandidateScope(
            allowed_doc_ids=[],
            allowed_answer_ids=None,
            eligibility={
                "kms": {"allowed_count": 0, "excluded_count": 0, "excluded_by_reason": {}},
                "faq": {"allowed_count": 1, "excluded_count": 0, "excluded_by_reason": {}},
            },
        )

    monkeypatch.setattr(search_service, "db", FakeDb())
    monkeypatch.setattr(search_service, "lightrag_client", FakeLightRagClient())
    monkeypatch.setattr(search_service, "resolve_candidate_scope", fake_candidate_scope)

    result = asyncio.run(
        search_service.integrated_search(
            actor_type="user",
            actor_id="manager-1",
            scope=WorkspaceScope("default", "kms-helpdesk", "faq-helpdesk"),
            payload={
                "query": "팀즈 연결이 안 돼요",
                "include_generative": False,
                "include_faq": True,
            },
        )
    )

    assert result["faq_metadata"]["matched_id"] == "ANS-TEAMS-1"
    assert result["faq_metadata"]["effective_retrieval_mode"] == "graph_hybrid"
    assert result["faq_metadata"]["graph_status"] == "graph_ready"
    assert result["faq_metadata"]["alias_expansions"] == [
        {"source": "팀즈", "canonical": "Microsoft Teams"}
    ]
    assert result["faq_results"][0]["title"] == "Teams 연결 오류"


def test_integrated_search_stream_metadata_includes_workspace_scope(monkeypatch):
    class FakeDb:
        async def execute(self, query, *params):
            return "INSERT 0 1"

    async def fake_candidate_scope(**_):
        return CandidateScope(
            allowed_doc_ids=[],
            allowed_answer_ids=[],
            eligibility={
                "kms": {"allowed_count": 0, "excluded_count": 0, "excluded_by_reason": {}},
                "faq": {"allowed_count": 0, "excluded_count": 0, "excluded_by_reason": {}},
            },
        )

    monkeypatch.setattr(search_service, "db", FakeDb())
    monkeypatch.setattr(search_service, "resolve_candidate_scope", fake_candidate_scope)

    async def collect_events():
        events = []
        async for event in search_service.integrated_search_stream(
            actor_type="user",
            actor_id="admin",
            scope=WorkspaceScope("default", "kevcs", "kevcs_faq_pair_20260609_145749"),
            payload={
                "query": "카드 인증 실패",
                "include_generative": False,
                "include_faq": False,
            },
        ):
            events.append(event)
        return events

    events = asyncio.run(collect_events())

    assert events[0]["event"] == "metadata"
    assert events[0]["kms_workspace"] == "kevcs"
    assert events[0]["faq_workspace"] == "kevcs_faq_pair_20260609_145749"
    assert "eligibility" in events[0]
    assert events[-1]["event"] == "done"
    assert events[-1]["kms_workspace"] == "kevcs"
    assert events[-1]["faq_workspace"] == "kevcs_faq_pair_20260609_145749"
    assert "eligibility" in events[-1]


def test_resolve_allowed_refs_filters_by_category(monkeypatch):
    async def fake_descendants(tenant_id, category_ids):
        assert tenant_id == "default"
        assert category_ids == ["cat-parent"]
        return ["cat-parent", "cat-child"]

    class FakeDb:
        async def fetch(self, query, *params):
            assert "i.category_id = ANY($4::text[])" in query
            assert params == (
                "kevcs",
                "kevcs_faq_pair_20260609_145749",
                "default",
                ["cat-parent", "cat-child"],
            )
            return [
                {"workspace_type": "kms", "ref_type": "doc_id", "external_id": "doc-b"},
                {"workspace_type": "kms", "ref_type": "doc_id", "external_id": "doc-a"},
                {"workspace_type": "faq", "ref_type": "answer_id", "external_id": "answer-1"},
                {"workspace_type": "faq", "ref_type": "answer_id", "external_id": "answer-1"},
            ]

    monkeypatch.setattr(search_service, "_category_descendants", fake_descendants)
    monkeypatch.setattr(search_service, "db", FakeDb())

    doc_ids, answer_ids = asyncio.run(
        resolve_allowed_refs(
            scope=WorkspaceScope("default", "kevcs", "kevcs_faq_pair_20260609_145749"),
            category_ids=["cat-parent"],
        )
    )

    assert doc_ids == ["doc-a", "doc-b"]
    assert answer_ids == ["answer-1"]


def test_resolve_candidate_scope_reports_expired_exclusions(monkeypatch):
    now = datetime.now(timezone.utc)

    async def fake_descendants(tenant_id, category_ids):
        assert tenant_id == "default"
        assert category_ids == ["cat-filter"]
        return ["cat-filter"]

    class FakeDb:
        async def fetch(self, query, *params):
            assert "i.category_id = ANY($4::text[])" in query
            assert params == (
                "kevcs",
                "kevcs_faq_pair_20260609_145749",
                "default",
                ["cat-filter"],
            )
            return [
                {
                    "item_id": "item-valid-doc",
                    "title": "유효 문서",
                    "enabled": True,
                    "valid_from": None,
                    "valid_until": None,
                    "workspace_type": "kms",
                    "ref_type": "doc_id",
                    "external_id": "doc-valid",
                },
                {
                    "item_id": "item-expired-doc",
                    "title": "만료 문서",
                    "enabled": True,
                    "valid_from": None,
                    "valid_until": now - timedelta(days=1),
                    "workspace_type": "kms",
                    "ref_type": "doc_id",
                    "external_id": "doc-expired",
                },
                {
                    "item_id": "item-disabled-answer",
                    "title": "비활성 FAQ",
                    "enabled": False,
                    "valid_from": None,
                    "valid_until": None,
                    "workspace_type": "faq",
                    "ref_type": "answer_id",
                    "external_id": "answer-disabled",
                },
                {
                    "item_id": "item-future-answer",
                    "title": "미래 FAQ",
                    "enabled": True,
                    "valid_from": now + timedelta(days=1),
                    "valid_until": None,
                    "workspace_type": "faq",
                    "ref_type": "answer_id",
                    "external_id": "answer-future",
                },
            ]

    monkeypatch.setattr(search_service, "_category_descendants", fake_descendants)
    monkeypatch.setattr(search_service, "db", FakeDb())

    scope = asyncio.run(
        resolve_candidate_scope(
            scope=WorkspaceScope("default", "kevcs", "kevcs_faq_pair_20260609_145749"),
            category_ids=["cat-filter"],
        )
    )

    assert scope.allowed_doc_ids == ["doc-valid"]
    assert scope.allowed_answer_ids == []
    assert scope.eligibility["kms"]["excluded_by_reason"]["expired"] == 1
    assert scope.eligibility["faq"]["excluded_by_reason"]["inactive"] == 1
    assert scope.eligibility["faq"]["excluded_by_reason"]["not_started"] == 1
    assert scope.eligibility["kms"]["excluded_items"][0]["title"] == "만료 문서"


def test_resolve_candidate_scope_uses_full_workspace_without_category(monkeypatch):
    class FailDb:
        async def fetch(self, query, *params):
            raise AssertionError("workspace-wide scope must not require mapped knowledge refs")

    monkeypatch.setattr(search_service, "db", FailDb())

    scope = asyncio.run(
        resolve_candidate_scope(
            scope=WorkspaceScope("tenant-1", "base", "faq-helpdesk"),
            category_ids=[],
        )
    )

    assert scope.allowed_doc_ids is None
    assert scope.allowed_answer_ids is None
    assert scope.eligibility["scope_mode"] == "workspace"
    assert scope.eligibility["kms"]["allowed_count"] is None
    assert scope.eligibility["faq"]["allowed_count"] is None


def test_query_param_allowed_doc_ids_is_optional_and_backward_compatible():
    base_py = Path(__file__).resolve().parents[3] / "lightrag" / "base.py"
    module = ast.parse(base_py.read_text())
    query_param = next(
        node
        for node in module.body
        if isinstance(node, ast.ClassDef) and node.name == "QueryParam"
    )
    allowed_doc_ids = next(
        node
        for node in query_param.body
        if isinstance(node, ast.AnnAssign)
        and isinstance(node.target, ast.Name)
        and node.target.id == "allowed_doc_ids"
    )

    assert ast.unparse(allowed_doc_ids.annotation) == "list[str] | None"
    assert isinstance(allowed_doc_ids.value, ast.Constant)
    assert allowed_doc_ids.value.value is None


def test_query_param_allowed_doc_ids_accepts_scope():
    query_routes_py = Path(__file__).resolve().parents[3] / "lightrag" / "api" / "routers" / "query_routes.py"
    source = query_routes_py.read_text()

    assert "allowed_doc_ids" in source
    assert "QueryParam(**request_data)" in source


def test_admin_texts_ingest_generates_file_sources_for_each_text():
    file_sources = _text_file_sources(
        "smoke",
        ["first", "second"],
        None,
    )

    assert len(file_sources) == 2
    assert all(source.startswith("smoke-") for source in file_sources)


def test_admin_texts_ingest_pads_partial_file_sources():
    file_sources = _text_file_sources(
        "smoke",
        ["first", "second"],
        ["first-source"],
    )

    assert len(file_sources) == 2
    assert file_sources[0] == "first-source"
    assert file_sources[1].startswith("smoke-")


def test_json_list_parses_jsonb_strings_from_asyncpg():
    assert _json_list('[{"ref_id": "r1"}]') == [{"ref_id": "r1"}]


def test_document_status_filter_matches_lightrag_enum_case():
    assert _document_status_filter(None) is None
    assert _document_status_filter("all") is None
    assert _document_status_filter("PROCESSED") == "processed"
    assert _document_status_filter("FAILED") == "failed"
    assert _json_list([{"ref_id": "r2"}]) == [{"ref_id": "r2"}]
