---
name: multi-workspace-routing
description: LightRAG 멀티 워크스페이스 라우팅, 데이터 격리, 헤더/body/default 우선순위, WebUI 워크스페이스 전환 동작을 분석하거나 점검할 때 사용한다.
---

# Multi Workspace Routing

## 목적

LightRAG의 요청이 올바른 워크스페이스로 라우팅되는지 확인한다. 읽기 작업을 우선하고, 생성/삭제/이동 같은 쓰기 작업은 사용자가 명시적으로 요청한 경우에만 수행한다.

## 핵심 파일

| 영역 | 파일 |
|------|------|
| UI selector | `lightrag_webui/src/components/workspace/WorkspaceSelector.tsx` |
| UI store | `lightrag_webui/src/stores/workspace.ts` |
| API client | `lightrag_webui/src/api/lightrag.ts`, `lightrag_webui/src/api/schema.ts` |
| Backend routes | `lightrag/api/routers/*_routes.py` |
| Workspace admin | `lightrag/api/routers/workspace_routes.py` |

## 점검 절차

1. 서버 상태를 확인한다.
   ```bash
   curl -s http://127.0.0.1:9422/health
   ```
2. 워크스페이스 목록과 현재 기본값을 확인한다.
   ```bash
   curl -s 'http://127.0.0.1:9422/workspaces?page=1&page_size=100'
   curl -s http://127.0.0.1:9422/workspaces/default
   ```
3. 같은 API를 서로 다른 `LIGHTRAG-WORKSPACE` 헤더로 호출하여 데이터 격리를 비교한다.
   ```bash
   curl -s http://127.0.0.1:9422/entity-types -H 'LIGHTRAG-WORKSPACE: base'
   curl -s http://127.0.0.1:9422/entity-types -H 'LIGHTRAG-WORKSPACE: kevcs'
   ```
4. Query API는 body의 `workspace`가 헤더보다 우선한다는 점을 별도로 확인한다.
5. WebUI에서는 상단 우측 selector로 workspace를 전환하고, Documents/Graph/Entity/Schema 탭이 새 데이터를 다시 로드하는지 확인한다.

## 우선순위 규칙

Query API의 워크스페이스 결정 순서:

1. 요청 body의 `workspace`
2. HTTP header `LIGHTRAG-WORKSPACE`
3. 서버 default workspace
4. fallback `base`

대부분의 document/graph/entity/prompt/workspace router는 header를 읽고 default로 fallback한다. URL/Multimodal router는 header가 없으면 빈 문자열을 반환하므로 getter fallback 동작을 함께 확인한다.

## 보고 형식

- 현재 workspace 목록과 default 표시
- 같은 API를 workspace별로 호출한 비교표
- UI 전환 시 stale data 여부
- 라우터별 fallback 차이
- 격리 위반 가능성이 있는 endpoint

## 주의사항

- `base`는 비어 있을 수 있다. 기능 검증은 데이터가 있는 workspace를 선택한다.
- prompt 수정은 DB row는 workspace별이지만 process-global `PROMPTS` dict도 바꾼다. 프롬프트 격리 점검은 `prompt-admin-ops`를 함께 사용한다.
