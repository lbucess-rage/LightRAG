---
name: retrieval-api-tester
description: LightRAG Retrieval 탭과 /query, /query/stream, /query/data API의 검색 모드, top-k, token budget, rerank, references, streaming, workspace 라우팅을 테스트하거나 분석할 때 사용한다.
---

# Retrieval API Tester

## 목적

LightRAG 검색 API와 Retrieval UI가 워크스페이스별 지식베이스를 올바르게 검색하고 응답하는지 검증한다.

## 핵심 파일

| 영역 | 파일 |
|------|------|
| UI | `lightrag_webui/src/features/RetrievalTesting.tsx` |
| Settings | `lightrag_webui/src/components/retrieval/QuerySettings.tsx` |
| Message/reference | `ChatMessage.tsx`, `ReferencePanel.tsx` |
| API client | `lightrag_webui/src/api/lightrag.ts` |
| Backend | `lightrag/api/routers/query_routes.py` |
| Query model | `lightrag/base.py` |

## API 비교

| API | 용도 | 형식 |
|-----|------|------|
| `POST /query` | 완성된 LLM 답변 | JSON |
| `POST /query/stream` | 실시간 채팅 응답 | NDJSON |
| `POST /query/data` | LLM 없이 검색 데이터만 확인 | JSON |

## 응답 JSON 구조

`POST /query`:

- top-level: `response`, `references`
- `response`: LLM 최종 답변 문자열
- `references[]`: `reference_id`, `doc_id`, `file_path`, `download_url`, `content`, `structured_content`, `score`, `scores`, `evidence`, `doc_nm`
- `references[].structured_content[]`: 텍스트는 `type`, `source`, `content`, `version`, `score`; 이미지는 `type`, `image`, `entity`, `source`, `version`, `analysis`, `score`

`POST /query/data`:

- top-level: `status`, `message`, `data`, `metadata`
- `data.entities[]`: `entity_name`, `entity_type`, `description`, `source_id`, `file_path`, `created_at`
- `data.relationships[]`: `src_id`, `tgt_id`, `description`, `keywords`, `weight`, `source_id`, `file_path`, `created_at`
- `data.chunks[]`: `reference_id`, `file_path`, `chunk_id`, `score`, `content`, `structured_content`
- `data.references[]`: `reference_id`, `file_path`, `doc_id`
- `metadata`: `query_mode`, `keywords.high_level`, `keywords.low_level`, `processing_info`

`POST /query/stream`:

- NDJSON line stream
- line variants: `{"references":[...]}`, repeated `{"response":"..."}`, final/near-final `{"evidence_map":{...}}`
- stream consumer는 line 단위 JSON parse 후 `references`, `response`, `evidence_map`, `error` 키를 분기 처리한다.

## 테스트 절차

1. 데이터가 있는 workspace를 고른다.
2. `only_need_context` 또는 `/query/data`로 검색 데이터가 나오는지 먼저 확인한다.
3. `mode`를 `naive`, `local`, `global`, `hybrid`, `mix`, `bypass`로 바꾸며 응답 차이를 기록한다.
4. `include_references=true`, `include_chunk_content=true` 조합으로 citation과 chunk 근거를 확인한다.
5. stream API는 NDJSON line 단위로 `references`, `response`, `error`, `evidence_map`을 처리하는지 본다.

## 기본 curl 예시

```bash
curl -s -X POST http://127.0.0.1:9422/query/data \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{"query":"E-pit 앱에서 충전소 상세 정보는 어떻게 확인해?","mode":"mix","top_k":10,"chunk_top_k":5}'
```

```bash
curl -s -X POST http://127.0.0.1:9422/query \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{"query":"E-pit 앱에서 충전소 상세 정보는 어떻게 확인해?","mode":"mix","include_references":true}'
```

## UI 확인

- Retrieval 탭에서 `/mix 질문`, `/local 질문` prefix가 모드 override로 작동하는지 확인한다.
- QuerySettings의 top-k, token budget, rerank, response type, user prompt가 요청 payload에 반영되는지 본다.
- 스트리밍 중 `<think>` 블록, Mermaid, LaTeX, references가 깨지지 않는지 확인한다.

## 보고 형식

- workspace와 query
- mode별 결과 차이
- references/score/evidence 존재 여부
- latency 또는 streaming 상태
- 에러와 서버 로그 요약
