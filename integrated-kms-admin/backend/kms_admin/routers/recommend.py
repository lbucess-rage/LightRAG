"""상담사 지식추천 (fusion5) — 검색 융합 + LLM 심판으로 5칸 후보 추천.

기존 /api/external/search(integrated_search)를 재사용하고, LLM 심판/요약/융합을 얹는다.
LLM 설정(RECO_LLM_URL)이 없으면 추천 없이 검색 결과만 5칸으로 반환(기존 동작 무영향).
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..dependencies import get_external_client
from ..search_service import WorkspaceScope, integrated_search

router = APIRouter(tags=["recommend"])

# ── 설정 (환경변수, 미지정 시 추천 비활성) ──────────────
RECO_LLM_URL = os.getenv("RECO_LLM_URL", "")            # 예: http://127.0.0.1:18008/v1/chat/completions
RECO_LLM_MODEL = os.getenv("RECO_LLM_MODEL", "")
RECO_LLM_THINKING = os.getenv("RECO_LLM_THINKING", "off").lower() == "on"
RECO_TOPK = int(os.getenv("RECO_TOPK", "5"))

_POOL = ThreadPoolExecutor(max_workers=6)
_NOISE = re.compile(
    r"소리샘|음성\s?사서함|음성사서함|음성\s?4상|음성\s?사삼|음성사소함|삐\s?소리|"
    r"전화를 받을 수 없|받지 않아|다시 걸어주시|통화료가 부과|대한통운|운송장"
)


def _is_noise(stt: str) -> bool:
    cust = [l for l in stt.split("\n") if l.startswith("고객:")]
    return bool(_NOISE.search("\n".join(cust[:4])))


def _llm(prompt: str, max_tokens: int = 40) -> str:
    body = {
        "model": RECO_LLM_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "max_tokens": max_tokens,
    }
    if not RECO_LLM_THINKING:
        body["chat_template_kwargs"] = {"enable_thinking": False}
    req = urllib.request.Request(
        RECO_LLM_URL, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    r = json.load(urllib.request.urlopen(req, timeout=60))
    return (r["choices"][0]["message"]["content"] or "").strip()


async def _search(scope: WorkspaceScope, query: str, category_ids: list[str], mode: str) -> list[dict]:
    payload = {
        "query": query[:8000], "category_ids": category_ids,
        "include_faq": True, "include_generative": False,
        "faq_options": {"retrieval_mode": mode},
    }
    res = await integrated_search(
        actor_type="api_client", actor_id="recommend", scope=scope, payload=payload,
    )
    faq = (res.get("faq_results") or [{}])[0]
    out = []
    for c in (faq.get("candidates") or [])[:5]:
        a = c.get("answer", {})
        out.append({
            "answer_id": a.get("answer_id"), "title": a.get("title") or a.get("answer_id"),
            "score": round(c.get("score", 0), 4), "body": a.get("body", ""),
        })
    return out


class RecommendRequest(BaseModel):
    stt: str = Field(..., description="통화 STT 전문")
    category_ids: list[str] = Field(default_factory=list, description="검색 범위(팀×방향)")
    mode: str = Field(default="fusion5")
    trace_id: str | None = None


@router.post("/api/external/recommend")
async def recommend(payload: RecommendRequest, client: dict = Depends(get_external_client)) -> dict:
    scope = WorkspaceScope(
        tenant_id=client["tenant_id"],
        kms_workspace=client["kms_workspace"],
        faq_workspace=client["faq_workspace"],
    )
    stt = payload.stt
    cats = [str(x) for x in payload.category_ids]

    if _is_noise(stt):
        return {"mode": "none", "reason": "noise_call", "slots": []}

    # 1) 검색 융합: 전문 hybrid + graph (fusion5)
    base = await _search(scope, stt, cats, "hybrid")
    if payload.mode == "fusion5":
        try:
            graph = await _search(scope, stt, cats, "graph_hybrid")
        except Exception:
            graph = []
    else:
        graph = []
    if not base and not graph:
        return {"mode": "none", "reason": "no_candidates", "slots": []}

    bodies, scores = {}, {}
    for lst, w in ((base, 1.0), (graph, 1.0)):
        for i, c in enumerate(lst):
            aid = c["answer_id"]
            bodies.setdefault(aid, c)
            scores[aid] = scores.get(aid, 0) + w / (11 + i)
    ranked = sorted(scores, key=lambda x: -scores[x])

    # 2) LLM 심판 (설정된 경우만): 1칸 추천 결정
    recommended = None
    if RECO_LLM_URL and RECO_LLM_MODEL:
        names = ranked[:5]
        lines = "\n".join("- %s" % bodies[n]["title"] for n in names)
        prompt = (
            "콜센터 상담 통화 STT입니다.\n---\n%s\n---\n"
            "아래 상담유형 후보 중 이 통화의 핵심 용건에 가장 맞는 것 하나를 고르세요.\n%s\n"
            "어느 것도 맞지 않으면 \"해당없음\". 유형 이름만 출력."
        ) % (stt[:1800], lines)
        try:
            ans = _POOL.submit(_llm, prompt).result(timeout=30)
            if "해당없음" not in ans:
                for n in sorted(names, key=len, reverse=True):
                    if n in ans or bodies[n]["title"] in ans:
                        recommended = n
                        break
        except Exception:
            recommended = None

    # 3) 5칸 구성 (추천이 있으면 1번 고정)
    order = []
    if recommended:
        order.append(recommended)
    for n in ranked:
        if n not in order:
            order.append(n)
        if len(order) >= RECO_TOPK:
            break
    slots = []
    for i, aid in enumerate(order):
        b = bodies.get(aid, {})
        slots.append({
            "rank": i + 1, "answer_id": aid, "title": b.get("title") or aid,
            "body": b.get("body", ""),
            "recommended": (i == 0 and recommended is not None),
        })
    return {"mode": "slots", "slots": slots}
