import asyncio
import sys
from functools import wraps

import pytest
from pydantic import ValidationError

_pytest_argv = sys.argv[:]
sys.argv = [sys.argv[0]]
try:
    from lightrag.api.routers.llm_profile_routes import (
        LLMProfileCreate,
        LLMProfileTestRequest,
        WorkspaceLLMPolicyBatchUpsert,
        WorkspaceLLMPolicyUpsert,
        build_chat_request,
        decrypt_api_key,
        encrypt_api_key,
    )
    from lightrag.api.routers.answer_routes import (
        AnswerGraphConfig,
        AnswerGraphNode,
        AnswerGraphRelation,
        _answer_graph_llm_quality,
        _answer_graph_node_id,
    )
    from lightrag.api.llm_runtime import ResolvedLLMPolicy, WorkspaceLLMRouter
finally:
    sys.argv = _pytest_argv


def async_test(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        return asyncio.run(func(*args, **kwargs))

    return wrapper


def _profile(**overrides):
    profile = {
        "model": "lbu-slm-v6-qw",
        "max_tokens": 2048,
        "temperature": 0.7,
        "top_p": 0.8,
        "presence_penalty": 0,
        "thinking_enabled": False,
        "supports_thinking": True,
        "extra_options": {},
    }
    profile.update(overrides)
    return profile


def test_profile_normalizes_chat_completion_url():
    profile = LLMProfileCreate(
        name="Qwen",
        base_url="http://localhost:8000/v1/chat/completions/",
        model="qwen",
    )

    assert profile.base_url == "http://localhost:8000/v1"


def test_profile_rejects_protected_extra_options():
    with pytest.raises(ValidationError):
        LLMProfileCreate(
            name="Qwen",
            base_url="http://localhost:8000/v1",
            model="qwen",
            extra_options={"messages": []},
        )


def test_api_key_is_encrypted_and_round_trips(monkeypatch):
    monkeypatch.setenv("LLM_PROFILE_ENCRYPTION_SECRET", "test-secret")

    encrypted = encrypt_api_key("dummy-key")

    assert encrypted
    assert encrypted != "dummy-key"
    assert decrypt_api_key(encrypted) == "dummy-key"


def test_build_chat_request_sets_qwen_thinking_option():
    body, thinking_enabled = build_chat_request(
        _profile(thinking_enabled=True),
        LLMProfileTestRequest(prompt="연결을 확인해 주세요."),
    )

    assert thinking_enabled is True
    assert body["chat_template_kwargs"] == {"enable_thinking": True}
    assert body["messages"][0]["content"] == "연결을 확인해 주세요."


def test_build_chat_request_supports_openai_vision_content():
    body, _ = build_chat_request(
        _profile(),
        LLMProfileTestRequest(
            prompt="이미지를 분석해 주세요.",
            image_url="data:image/png;base64,AA==",
        ),
    )

    content = body["messages"][0]["content"]
    assert content[0] == {"type": "text", "text": "이미지를 분석해 주세요."}
    assert content[1] == {
        "type": "image_url",
        "image_url": {"url": "data:image/png;base64,AA=="},
    }


def test_build_chat_request_merges_provider_specific_options():
    body, _ = build_chat_request(
        _profile(
            extra_options={
                "response_format": {"type": "json_object"},
                "extra_body": {"guided_decoding_backend": "xgrammar"},
            }
        ),
        LLMProfileTestRequest(prompt="JSON으로 응답해 주세요."),
    )

    assert body["response_format"] == {"type": "json_object"}
    assert body["guided_decoding_backend"] == "xgrammar"


def test_build_chat_request_accepts_jsonb_returned_as_text():
    body, _ = build_chat_request(
        _profile(extra_options='{"seed": 7}'),
        LLMProfileTestRequest(prompt="재현 가능한 응답을 주세요."),
    )

    assert body["seed"] == 7


def test_workspace_policy_rejects_duplicate_purposes():
    with pytest.raises(ValidationError):
        WorkspaceLLMPolicyBatchUpsert(
            policies=[
                WorkspaceLLMPolicyUpsert(
                    purpose="search_answer", profile_id="qwen-v4"
                ),
                WorkspaceLLMPolicyUpsert(
                    purpose="search_answer", profile_id="qwen-v6"
                ),
            ]
        )


def test_workspace_policy_accepts_all_six_purposes():
    purposes = [
        "knowledge_ingestion",
        "knowledge_structure",
        "schema_design",
        "search_answer",
        "faq_selection",
        "multimodal",
    ]

    batch = WorkspaceLLMPolicyBatchUpsert(
        policies=[
            WorkspaceLLMPolicyUpsert(purpose=purpose, profile_id="qwen-v6")
            for purpose in purposes
        ]
    )

    assert [policy.purpose for policy in batch.policies] == purposes


@async_test
async def test_workspace_router_reads_current_policy_for_every_call(monkeypatch):
    calls = []

    async def default_llm(prompt, **kwargs):
        return "default"

    async def get_db():
        return None

    router = WorkspaceLLMRouter(default_llm, get_db)
    active_profile = {
        "profile_id": "qwen-v6",
        "name": "Qwen v6",
        "provider": "openai_compatible",
        "base_url": "http://localhost:8000/v1",
        "model": "qwen-v6",
        "api_key_encrypted": None,
        "timeout_seconds": 120,
        "max_tokens": 2048,
        "temperature": 0.6,
        "top_p": 0.95,
        "presence_penalty": 0,
        "thinking_enabled": False,
        "supports_thinking": True,
        "supports_vision": True,
        "verify_tls": True,
        "extra_options": {},
    }

    async def resolve(workspace_id, purpose):
        return ResolvedLLMPolicy(
            workspace_id=workspace_id,
            purpose=purpose,
            profile=dict(active_profile),
            fallback_profile=None,
            thinking_mode="enabled",
            timeout_seconds=None,
            max_tokens=4096,
            temperature=None,
            top_p=None,
            presence_penalty=None,
            response_format=None,
            extra_options={},
        )

    async def fake_complete(model, prompt, **kwargs):
        calls.append((model, prompt, kwargs))
        return model

    monkeypatch.setattr(router, "resolve", resolve)
    monkeypatch.setattr("lightrag.api.llm_runtime.openai_complete_if_cache", fake_complete)
    routed = router.for_workspace("faq-workspace")

    assert await routed("구조를 생성해 주세요", _llm_purpose="knowledge_structure") == "qwen-v6"
    active_profile["profile_id"] = "qwen-v4"
    active_profile["model"] = "qwen-v4"
    assert await routed("답변을 찾아 주세요", _llm_purpose="search_answer") == "qwen-v4"

    assert [item[0] for item in calls] == ["qwen-v6", "qwen-v4"]
    assert calls[0][2]["max_tokens"] == 4096
    assert calls[0][2]["extra_body"]["chat_template_kwargs"] == {
        "enable_thinking": True
    }
    assert calls[0][2]["verify_tls"] is True


@async_test
async def test_workspace_router_allows_internal_thinking_override(monkeypatch):
    captured = {}

    async def default_llm(prompt, **kwargs):
        return "default"

    router = WorkspaceLLMRouter(default_llm, lambda: None)
    profile = {
        "profile_id": "qwen-v6",
        "name": "Qwen v6",
        "provider": "openai_compatible",
        "base_url": "http://localhost:8000/v1",
        "model": "qwen-v6",
        "api_key_encrypted": None,
        "timeout_seconds": 120,
        "max_tokens": 2048,
        "temperature": 0.6,
        "top_p": 0.95,
        "presence_penalty": 0,
        "thinking_enabled": True,
        "supports_thinking": True,
        "supports_vision": False,
        "verify_tls": True,
        "extra_options": {},
    }
    policy = ResolvedLLMPolicy(
        workspace_id="faq-workspace",
        purpose="knowledge_structure",
        profile=profile,
        fallback_profile=None,
        thinking_mode="enabled",
        timeout_seconds=None,
        max_tokens=4096,
        temperature=None,
        top_p=None,
        presence_penalty=None,
        response_format="json_object",
        extra_options={},
    )

    async def resolve(*_args):
        return policy

    async def fake_complete(_model, _prompt, **kwargs):
        captured.update(kwargs)
        return "{}"

    monkeypatch.setattr(router, "resolve", resolve)
    monkeypatch.setattr("lightrag.api.llm_runtime.openai_complete_if_cache", fake_complete)

    await router.for_workspace("faq-workspace")(
        "그래프를 생성해 주세요",
        _llm_purpose="knowledge_structure",
        _llm_thinking_override=False,
    )

    assert captured["extra_body"]["chat_template_kwargs"] == {
        "enable_thinking": False
    }
    assert "_llm_thinking_override" not in captured


def test_answer_graph_quality_requires_answer_connections_and_relation_types():
    answer_node_id = _answer_graph_node_id("ANS-001")
    config = AnswerGraphConfig(
        workspace="faq-workspace",
        ai_min_relations=3,
        ai_min_relation_types=2,
    )
    nodes = [
        AnswerGraphNode(
            node_id=answer_node_id,
            entity_type="FAQAnswer",
            label="ANS-001",
        )
    ]
    weak_relations = [
        AnswerGraphRelation(
            source_id=answer_node_id,
            target_id="ANSWER_GRAPH::TERM::로밍",
            relation_type="HAS_TERM",
        )
    ]
    valid, _, reasons = _answer_graph_llm_quality(
        answer_node_id,
        nodes,
        weak_relations,
        config,
        {"REPRESENTS_QUESTION", "RESOLVES"},
    )
    assert valid is False
    assert reasons == [
        "answer_relations=1<3",
        "relation_types=1<2",
        "missing_expected=REPRESENTS_QUESTION,RESOLVES",
    ]

    strong_relations = weak_relations + [
        AnswerGraphRelation(
            source_id=answer_node_id,
            target_id="ANSWER_GRAPH::INTENT::로밍 신청",
            relation_type="REPRESENTS_QUESTION",
        ),
        AnswerGraphRelation(
            source_id=answer_node_id,
            target_id="ANSWER_GRAPH::PROCEDURE::로밍 활성화",
            relation_type="RESOLVES",
        ),
    ]
    valid, _, reasons = _answer_graph_llm_quality(
        answer_node_id,
        nodes,
        strong_relations,
        config,
        {"REPRESENTS_QUESTION", "RESOLVES"},
    )
    assert valid is True
    assert reasons == []


@async_test
async def test_workspace_router_builds_vision_message(monkeypatch):
    captured = {}

    async def default_llm(prompt, **kwargs):
        return "default"

    router = WorkspaceLLMRouter(default_llm, lambda: None)
    profile = {
        "profile_id": "vision",
        "name": "Vision",
        "provider": "openai_compatible",
        "base_url": "http://localhost:8000/v1",
        "model": "vision-model",
        "api_key_encrypted": None,
        "timeout_seconds": 120,
        "max_tokens": 1024,
        "temperature": 0.1,
        "top_p": 0.8,
        "presence_penalty": 0,
        "thinking_enabled": False,
        "supports_thinking": True,
        "supports_vision": True,
        "verify_tls": True,
        "extra_options": {},
    }
    policy = ResolvedLLMPolicy(
        workspace_id="vision-workspace",
        purpose="multimodal",
        profile=profile,
        fallback_profile=None,
        thinking_mode="disabled",
        timeout_seconds=None,
        max_tokens=None,
        temperature=None,
        top_p=None,
        presence_penalty=None,
        response_format=None,
        extra_options={},
    )

    async def resolve(*_args):
        return policy

    async def fake_complete(_model, _prompt, **kwargs):
        captured.update(kwargs)
        return "빨강"

    monkeypatch.setattr(router, "resolve", resolve)
    monkeypatch.setattr("lightrag.api.llm_runtime.openai_complete_if_cache", fake_complete)

    result = await router.for_workspace("vision-workspace")(
        "색상을 알려주세요",
        image_data="AA==",
        _llm_purpose="multimodal",
    )

    assert result == "빨강"
    content = captured["messages"][-1]["content"]
    assert content[1]["image_url"]["url"] == "data:image/png;base64,AA=="
    assert captured["verify_tls"] is True
