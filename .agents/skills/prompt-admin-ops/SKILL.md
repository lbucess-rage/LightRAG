---
name: prompt-admin-ops
description: LightRAG Prompts 탭과 /prompts API를 사용해 내부 프롬프트 목록, 단건 조회, 수정, 기본값 초기화, workspace별 적용 범위와 인메모리 PROMPTS 반영을 점검할 때 사용한다.
---

# Prompt Admin Ops

## 목적

LightRAG 내부 프롬프트를 안전하게 조회하고, 수정/초기화가 필요한 경우 변경 범위와 리스크를 확인한다.

## 핵심 파일

| 영역 | 파일 |
|------|------|
| UI | `lightrag_webui/src/features/PromptSettings.tsx` |
| API client | `lightrag_webui/src/api/lightrag.ts` |
| Backend | `lightrag/api/routers/prompt_routes.py` |
| Defaults | `lightrag/prompt.py` |

## 조회 API

```bash
curl -s http://127.0.0.1:9422/prompts -H 'LIGHTRAG-WORKSPACE: kevcs'
curl -s http://127.0.0.1:9422/prompts/keywords_extraction -H 'LIGHTRAG-WORKSPACE: kevcs'
```

## 수정 가능한 프롬프트

- `entity_extraction_system_prompt`
- `entity_extraction_user_prompt`
- `entity_continue_extraction_user_prompt`
- `entity_extraction_examples`
- `summarize_entity_descriptions`
- `fail_response`
- `rag_response`
- `naive_rag_response`
- `kg_query_context`
- `naive_query_context`
- `keywords_extraction`
- `keywords_extraction_examples`

## 변경 절차

1. 현재 workspace와 prompt value를 조회한다.
2. 변경 전 값을 별도 메모한다.
3. JSON type prompt는 저장 전 JSON parse 가능 여부를 확인한다.
4. `PUT /prompts/{prompt_key}`로 수정한다.
5. 같은 workspace와 다른 workspace에서 조회해 격리 여부를 확인한다.
6. 검색/지식화 중 어느 경로에 영향을 주는 prompt인지 검증한다.

## 초기화

쓰기 API:

- 단건 초기화: `DELETE /prompts/{prompt_key}`
- 전체 초기화: `POST /prompts/reset-all`

전체 초기화는 해당 workspace custom prompt row를 삭제한다. 사용자 확인 없이 실행하지 않는다.

## 주의사항

- DB row는 workspace별이다.
- backend는 수정 시 `PROMPTS[prompt_key]`도 즉시 변경한다. 이는 process-global dict이므로 워크스페이스 격리 테스트가 필요하다.
- startup 로그의 prompt table index 오류는 실제 컬럼명과 index 생성 코드 불일치 가능성을 의미한다.
