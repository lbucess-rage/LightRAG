# LightRAG 기능 카테고리 분석 리포트

> 작성일: 2026-05-16
> 분석 대상: 로컬 실행 서버 `http://127.0.0.1:9422/webui/#/`, 개발 DB 연동 환경
> 분석 범위: WebUI, FastAPI 라우터, TypeScript API 클라이언트, 현재 dev DB 조회 결과

---

## 1. 요약

현재 fork는 단순 RAG 서버가 아니라, 워크스페이스 단위로 문서/게시판/URL/멀티모달 데이터를 지식화하고, 생성된 지식 그래프를 탐색하며, 도메인 스키마와 내부 프롬프트까지 WebUI에서 관리하는 운영형 LightRAG 콘솔이다.

로컬 구동 상태는 정상이다.

| 항목 | 상태 |
|------|------|
| API 서버 | `0.0.0.0:9422` 실행 중 |
| WebUI | `/webui/` 서빙 정상 |
| Health | `status=healthy`, `webui_available=true` |
| 인증 | disabled / guest mode |
| 기본 워크스페이스 | `base` |
| 주요 저장소 | PostgreSQL + Neo4j + PGVector |
| LLM/Embedding/Rerank | 개발 서버 엔드포인트 사용 |

현재 개발 DB에는 6개 워크스페이스가 있다.

| workspace | name | documents | entities | relations | default |
|-----------|------|----------:|---------:|----------:|:-------:|
| `base` | Base | 0 | 0 | 0 | O |
| `kevcs` | 전기차충전 고객센터 | 145 | 4345 | 7982 |  |
| `gsnw` | GS네트웍스 고객센터 | 1 | 674 | 1434 |  |
| `default` | default | 0 | 0 | 0 |  |
| `gfgf` | 경기도미래세대재단 | 3 | 913 | 1115 |  |
| `sugar` | 슈가모바일 | 1 | 689 | 1105 |  |

`base`는 비어 있으므로 실제 기능 검증은 `kevcs` 등 데이터가 있는 워크스페이스로 전환해야 의미가 있다.

---

## 2. WebUI 기능 맵

상단 탭은 `SiteHeader.tsx` 기준으로 다음 8개다.

| 탭 | 주요 컴포넌트 | 역할 |
|----|--------------|------|
| Documents | `DocumentManager.tsx` | 문서 업로드, 스캔, URL/Board/멀티모달/Quick 지식화, 문서 상태 관리 |
| Knowledge Graph | `GraphViewer.tsx` | Sigma 기반 지식 그래프 시각화, 라벨 검색, 레이아웃/줌/속성 패널 |
| Entity-Relation Explorer | `EntityManagement.tsx` | 엔티티/관계 목록, 필터, 상세, 부분 그래프 탐색 |
| Schema | `SchemaManager.tsx` | 도메인 스키마 발견, 템플릿, 현재 적용 스키마, 시드 엔티티 |
| Retrieval | `RetrievalTesting.tsx` | 검색/질의 테스트, 스트리밍 응답, 레퍼런스, 쿼리 파라미터 |
| API | `ApiSite.tsx` | Swagger/OpenAPI 문서 표시 |
| Prompts | `PromptSettings.tsx` | 내부 프롬프트 조회/수정/초기화 |
| Workspaces | `WorkspaceManagement.tsx` | 워크스페이스 CRUD, 통계, 복사/이동 |

모든 일반 API 요청은 `lightrag_webui/src/api/lightrag.ts`의 axios interceptor를 통해 `LIGHTRAG-WORKSPACE` 헤더를 붙인다. Schema API는 별도 `schemaApi` interceptor가 같은 헤더를 붙인다.

---

## 3. 멀티 워크스페이스 기능

### 구조

워크스페이스는 `LIGHTRAG-WORKSPACE` 헤더를 중심으로 라우팅된다. Query API는 요청 body의 `workspace` 필드가 있으면 헤더보다 우선한다.

| 계층 | 구현 위치 |
|------|-----------|
| UI 선택기 | `lightrag_webui/src/components/workspace/WorkspaceSelector.tsx` |
| 상태 저장 | `lightrag_webui/src/stores/workspace.ts` |
| API 헤더 주입 | `lightrag_webui/src/api/lightrag.ts`, `lightrag_webui/src/api/schema.ts` |
| Backend 라우팅 | 각 router의 `_get_workspace_from_request()` |
| RAG 인스턴스 획득 | `set_rag_workspace_getter()` 패턴 |

### 동작

- 상단 우측 워크스페이스 선택기에서 현재 워크스페이스를 바꾼다.
- 선택값은 Zustand persist로 유지된다.
- 탭 전환 없이도 Graph, Entity, Schema 등은 workspace 변경 시 내부 상태를 초기화하고 새 데이터를 다시 가져온다.
- 기본 fallback은 `base` 또는 서버 default workspace다.

### 주의점

- `url_routes.py`, `multimodal_routes.py`는 헤더가 없으면 빈 문자열을 반환한다. 실제 getter 쪽 fallback이 어떻게 동작하는지 운영 환경에서 확인해야 한다.
- `prompt_routes.py`는 DB 저장은 workspace별이지만, 수정 시 프로세스 전역 `PROMPTS` dict도 즉시 바꾼다. 다중 워크스페이스에서 프롬프트 적용 범위를 검증해야 한다.

---

## 4. 다양한 데이터 소스를 통한 지식화

### 문서 업로드/스캔

| 기능 | API | UI |
|------|-----|----|
| input dir 스캔 | `POST /documents/scan` | Scan/Retry |
| 단일 파일 업로드 | `POST /documents/upload` | Upload |
| 텍스트 삽입 | `POST /documents/text`, `/documents/texts` | API 중심 |
| Quick 이미지 | `POST /documents/quick-image` | Quick |
| 문서 목록 | `POST /documents/paginated` | Uploaded Documents |
| 상태 추적 | `GET /documents/track_status/{track_id}` | 진행 패널 |
| 재처리 | `POST /documents/reprocess_failed` | Scan/Retry |
| 취소 | `POST /documents/cancel_pipeline` | Pipeline |
| 삭제/초기화 | delete/clear 계열 | Clear, Delete |

문서 상태는 `pending`, `preprocessed`, `processing`, `processed`, `failed`로 관리된다. 파일 중복은 `file_path`와 content hash 기준으로 방어한다.

### URL 지식화

| 기능 | API |
|------|-----|
| URL 검증 | `POST /api/url/validate` |
| 텍스트에서 URL 추출 | `POST /api/url/extract` |
| 단일 URL 지식화 | `POST /api/url/ingest` |
| 다중 URL 지식화 | `POST /api/url/ingest-batch` |
| 진행률 | `GET /api/tasks/{task_id}/stream` |

URL은 비동기 task로 처리된다. 옵션으로 이미지/테이블 처리, 중복 스킵, 강제 재색인, 링크 따라가기, depth 제한, 사용자 지정 프롬프트가 있다.

### Board API 지식화

| 기능 | API | 설명 |
|------|-----|------|
| 구조 탐색 | `POST /api/board/explore` | 외부 API 응답에서 배열/필드 매핑 감지 |
| 게시판 지식화 | `POST /api/board/ingest` | page/cursor/none 방식, 첨부파일, detail URL 처리 |
| 게시물 보기 | `POST /api/board/view` | 저장된 board 문서 원문 확인 |
| 삭제 | `POST /api/board/delete` | board 수집 데이터 삭제 |

`kevcs` 기준 task 이력에는 board ingestion 성공/취소/실패 기록이 다수 있다. 다만 task metadata에 외부 API 호출 header가 저장될 수 있으므로, 인증 토큰이 들어간 header는 로그/응답/공유 자료에서 반드시 마스킹해야 한다.

### 멀티모달 지식화

| 기능 | API |
|------|-----|
| 상태 확인 | `GET /api/multimodal/status` |
| 문서 파싱만 | `POST /api/multimodal/parse` |
| 파싱 + VLM/LLM 처리 | `POST /api/multimodal/process` |

현재 로컬 상태:

| 항목 | 값 |
|------|----|
| multimodal status | `ready` |
| VLM available | true |
| processors | image, table, equation, generic |
| parsers | `docling=false`, `pymupdf=false` |

VLM은 설정되어 있으나 파서 설치 상태가 false로 보인다. PDF/DOCX 멀티모달 처리 검증 전에 `pymupdf`/`docling` 의존성 설치 여부를 확인해야 한다.

---

## 5. 지식 그래프 확인

### API

| 기능 | API |
|------|-----|
| 전체 라벨 목록 | `GET /graph/label/list` |
| 연결도 높은 라벨 | `GET /graph/label/popular?limit=300` |
| 라벨 검색 | `GET /graph/label/search?q=...` |
| 서브그래프 조회 | `GET /graphs?label=*&max_depth=3&max_nodes=1000` |
| 엔티티 존재 확인 | `GET /graph/entity/exists?name=...` |
| 엔티티/관계 편집 | `/graph/entity/edit`, `/graph/relation/edit` |
| 엔티티/관계 생성 | `/graph/entity/create`, `/graph/relation/create` |
| 엔티티 병합 | `POST /graph/entities/merge` |

### UI

`GraphViewer.tsx`는 Sigma 기반이다.

- 라벨 선택/검색: `GraphLabels.tsx`
- 페이지 내 노드 검색: `GraphSearch.tsx`
- 속성 패널: `PropertiesView.tsx`
- 레이아웃/줌/전체화면/범례: `LayoutsControl`, `ZoomControl`, `FullScreenControl`, `Legend`
- workspace 변경 시 graph store와 검색 이력 초기화

`kevcs`에서 popular label 조회 결과 예시는 `E-pit`, `해피차저 앱`, image/table/document 기반 엔티티 등이다.

---

## 6. 엔티티-관계 탐색 기능

### API

| 기능 | API |
|------|-----|
| 엔티티 페이지 조회 | `POST /entities` |
| 엔티티 타입 집계 | `GET /entity-types` |
| 관계 페이지 조회 | `POST /relations` |
| 유사/관련 엔티티 | `GET /entities/{entity_id}/related` |
| 엔티티 삭제 | `DELETE /entities/{entity_id}?cascade=true` |
| 다중 엔티티 삭제 | `POST /entities/batch-delete` |
| 관계 삭제 | `DELETE /relations?cascade=true` |

### UI

`EntityManagement.tsx`는 좌측 탐색 패널과 우측 그래프, 하단 상세 패널로 구성된다.

- 엔티티 탭: `EntityExplorer.tsx`
- 관계 탭: `RelationExplorer.tsx`
- 선택 엔티티 중심 그래프: `EntityGraphView.tsx`
- 상세/이웃/속성: `EntityDetailPanel.tsx`

`kevcs` 기준 엔티티 타입은 100개 이상이며 `product`, `servicefeature`, `document`, `category`, `organization`, `policy`, `image`, `table` 등이 많이 나타난다. 대소문자 혼재(`Product`/`product`)와 `UNKNOWN` 타입이 보이므로 스키마 정규화/재지식화 시 점검 포인트다.

---

## 7. 지식화를 위한 도메인 스키마 생성 기능

### API

| 영역 | API |
|------|-----|
| 파일 기반 발견 | `POST /api/schema/discover/from-files` |
| 문서 텍스트 기반 발견 | `POST /api/schema/discover/from-document` |
| 도메인 키워드 기반 발견 | `POST /api/schema/discover/from-domain` |
| 하이브리드 발견 | `POST /api/schema/discover/hybrid` |
| 템플릿 목록/상세 | `GET /api/schema/templates`, `GET /api/schema/templates/{domain}` |
| 템플릿 CRUD | `POST/PUT/DELETE /api/schema/templates...` |
| 현재 스키마 | `GET /api/schema/current` |
| 스키마 적용/초기화 | `POST /api/schema/apply`, `POST /api/schema/reset` |
| 병합 미리보기/적용 | `POST /api/schema/merge/preview`, `/merge/apply` |
| 시드 엔티티 | `GET/POST/DELETE /api/schema/seed-entities` |

### UI

`SchemaManager.tsx`는 세 탭으로 구성된다.

- Discovery: 파일/텍스트/도메인 힌트로 스키마 발견
- Templates: 도메인 템플릿 라이브러리
- Current: 현재 적용 스키마, 시드 엔티티, apply/reset

`kevcs`는 `template:kevcs-t-1`이 적용되어 있으며 50개 이상의 도메인 엔티티 타입과 시드 엔티티가 있다. `base`는 기본 타입만 사용하는 상태다.

### 주의점

- 스키마 적용은 이후 문서 처리의 엔티티 추출에 영향을 주는 설정이다. 이미 지식화된 데이터의 엔티티 타입을 자동으로 재분류하지 않는다.
- relation type은 API 모델에 존재하지만 현재 `kevcs` 응답에서는 빈 배열이다.

---

## 8. API를 통한 검색 기능

### API

| API | 용도 | 응답 |
|-----|------|------|
| `POST /query` | 비스트리밍 검색/답변 | JSON |
| `POST /query/stream` | 채팅 UI용 스트리밍 | NDJSON |
| `POST /query/data` | LLM 답변 없이 검색 데이터만 확인 | JSON |

공통 query mode는 `naive`, `local`, `global`, `hybrid`, `mix`, `bypass`다. WebUI Retrieval 탭은 `/mix 질문` 같은 prefix로 모드를 override할 수 있다.

주요 파라미터:

- `top_k`, `chunk_top_k`
- `max_entity_tokens`, `max_relation_tokens`, `max_total_tokens`
- `hl_keywords`, `ll_keywords`
- `conversation_history`
- `user_prompt`
- `enable_rerank`
- `include_references`, `include_chunk_content`
- `highlight_entities`
- `workspace`

### UI

`RetrievalTesting.tsx`는 채팅형 테스트 콘솔이다.

- 스트리밍 응답 처리
- 레퍼런스/증거 스니펫 표시
- `<think>` 블록 분리 표시
- Mermaid/LaTeX 렌더링 보정
- QuerySettings 패널에서 모드/응답형식/top-k/토큰/리랭크/프롬프트 설정

---

## 9. 내부 프롬프트 조회/수정 기능

### API

| 기능 | API |
|------|-----|
| 전체 조회 | `GET /prompts` |
| 단건 조회 | `GET /prompts/{prompt_key}` |
| 수정 | `PUT /prompts/{prompt_key}` |
| 단건 기본값 초기화 | `DELETE /prompts/{prompt_key}` |
| 전체 초기화 | `POST /prompts/reset-all` |

수정 가능한 프롬프트는 12개다.

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

### UI

`PromptSettings.tsx`는 accordion 형태로 프롬프트를 열고 수정한다. JSON 타입은 저장 전 JSON parse 검증을 한다.

### 주의점

- DB 테이블은 workspace별 prompt row를 저장한다.
- 수정 시 서버 메모리의 `PROMPTS[prompt_key]`도 즉시 변경한다.
- 이 인메모리 변경이 워크스페이스별로 완전히 격리되는지 별도 회귀 테스트가 필요하다.
- 서버 startup 로그에서 `LIGHTRAG_PROMPTS(id)` 인덱스 생성 실패가 보인다. 실제 테이블은 `prompt_key` 기반으로 쓰이는 것으로 보이며, 마이그레이션/인덱스 정의 정리가 필요하다.

---

## 10. 워크스페이스 관리 기능

### API

| 기능 | API |
|------|-----|
| 생성 | `POST /workspaces` |
| 목록 | `GET /workspaces?page=1&page_size=20` |
| 상세 | `GET /workspaces/{workspace_id}` |
| 수정 | `PATCH /workspaces/{workspace_id}` |
| 삭제 | `DELETE /workspaces/{workspace_id}?delete_data=true` |
| 통계 | `GET /workspaces/{workspace_id}/stats` |
| 통계 동기화 | `POST /workspaces/{workspace_id}/sync-stats` |
| 기본 워크스페이스 설정 | `POST /workspaces/{workspace_id}/set-default` |
| 기본 워크스페이스 조회 | `GET /workspaces/default` |
| 설정 복사 | `POST /workspaces/{workspace_id}/copy-settings` |
| 데이터 복사 | `POST /workspaces/{workspace_id}/copy-data` |
| 데이터 이동 | `POST /workspaces/{workspace_id}/move-data` |

### UI

`WorkspaceManagement.tsx`는 카드형 관리 화면이다.

- 전체 워크스페이스/문서/엔티티/관계 합계
- 현재 워크스페이스 강조
- 기본 워크스페이스 별표 표시
- 워크스페이스 전환
- 수정, 복사, 기본값 설정, 통계 새로고침, 삭제

### 주의점

- 기본 워크스페이스는 삭제할 수 없다.
- busy workspace는 삭제/전환 일부가 제한된다.
- `copy-data` 코드는 PostgreSQL 문서/벡터/매핑 테이블 중심으로 복사한다. Neo4j graph node/edge 자체 복사까지 보장되는지는 별도 확인이 필요하다.

---

## 11. 생성한 개별 스킬

이번 분석 기준으로 다음 스킬을 추가했다.

| 스킬 | 목적 |
|------|------|
| `.agents/skills/multi-workspace-routing` | 헤더/body/default 기반 workspace 라우팅과 격리 점검 |
| `.agents/skills/knowledge-ingestion-ops` | 문서/URL/Board/멀티모달 지식화 파이프라인 점검 |
| `.agents/skills/knowledge-graph-review` | 그래프 라벨/서브그래프/API/UI 점검 |
| `.agents/skills/entity-relation-explorer` | 엔티티/관계 목록, 상세, 삭제/편집 리스크 점검 |
| `.agents/skills/domain-schema-ops` | 스키마 발견/템플릿/적용/병합/시드 엔티티 점검 |
| `.agents/skills/retrieval-api-tester` | `/query` 계열 API와 Retrieval UI 테스트 |
| `.agents/skills/prompt-admin-ops` | 프롬프트 조회/수정/초기화와 workspace 적용 범위 점검 |
| `.agents/skills/workspace-admin-ops` | 워크스페이스 CRUD/복사/이동/통계 동기화 점검 |

---

## 12. 우선 점검 과제

1. `LIGHTRAG_PROMPTS`, `LIGHTRAG_USER_PROMPT_TEMPLATES` 인덱스 생성 코드가 실제 컬럼명과 맞지 않는다. startup 에러를 정리해야 한다.
2. task metadata에 외부 API header가 저장될 수 있다. 인증 토큰 마스킹 또는 저장 제외가 필요하다.
3. 로컬 멀티모달 parser 상태가 false다. `pymupdf`/`docling` 설치 및 status API 재확인이 필요하다.
4. 워크스페이스 데이터 복사/이동이 Neo4j 그래프까지 완전히 이전하는지 검증해야 한다.
5. 프롬프트 수정 시 workspace DB row와 process-global `PROMPTS` 변경의 격리성을 테스트해야 한다.
6. `base`는 비어 있으므로 UI 기능 검증 시 반드시 데이터가 있는 워크스페이스로 전환해야 한다.
