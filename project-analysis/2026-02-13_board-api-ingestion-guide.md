# LightRAG Board API Ingestion 가이드

> 작성일: 2026-02-13
> 대상: `/api/board/explore`, `/api/board/ingest`, `/api/board/delete` 엔드포인트
> 소스: `lightrag/api/routers/board_routes.py`, `lightrag_webui/src/components/documents/BoardIngestDialog.tsx`

---

## 목차

1. [개요](#1-개요)
2. [아키텍처](#2-아키텍처)
3. [API 엔드포인트 상세](#3-api-엔드포인트-상세)
   - 3.1 [POST /api/board/explore](#31-post-apiboardexplore)
   - 3.2 [POST /api/board/ingest](#32-post-apiboardingest)
   - 3.3 [POST /api/board/delete](#33-post-apiboarddelete)
4. [FieldMapping 스키마](#4-fieldmapping-스키마)
5. [페이지네이션 지원](#5-페이지네이션-지원)
6. [문서 업데이트 (update_existing)](#6-문서-업데이트-update_existing)
7. [실전 사용 예시](#7-실전-사용-예시)
8. [비동기 태스크 모니터링](#8-비동기-태스크-모니터링)
9. [프론트엔드 UI 사용법](#9-프론트엔드-ui-사용법)
10. [트러블슈팅](#10-트러블슈팅)

---

## 1. 개요

Board API Ingestion은 외부 REST API 기반 게시판/BBS 시스템에서 게시물을 수집하여 LightRAG 지식그래프로 변환하는 기능이다.

### 핵심 특성

| 특성 | 설명 |
|------|------|
| **자동 필드 감지** | API 응답 구조를 LLM/휴리스틱으로 자동 분석하여 필드 매핑 생성 |
| **비동기 처리** | 즉시 `task_id` 반환 → 백그라운드 처리 → NDJSON 스트리밍 진행률 |
| **페이지네이션** | page_param, offset_limit, cursor 방식 지원 |
| **멀티모달 통합** | 첨부파일 이미지(VLM) + 테이블(LLM) 처리 |
| **중복 제어** | `skip_duplicates` (스킵) 또는 `update_existing` (삭제 후 재삽입) |
| **워크스페이스 격리** | `LIGHTRAG-WORKSPACE` 헤더 기반 멀티테넌트 |

### 처리 흐름

```
[외부 게시판 API] → explore(자동감지) → ingest(수집) → LightRAG KG
                                                         ├── 엔티티 추출
                                                         ├── 관계 추출
                                                         └── 벡터 임베딩
```

---

## 2. 아키텍처

### 모듈 구조

```
lightrag/api/routers/
└── board_routes.py              ← 전체 로직 (explore + ingest + 헬퍼)

lightrag_webui/src/
├── api/lightrag.ts              ← TypeScript API 클라이언트 타입 정의
├── components/documents/
│   ├── BoardIngestDialog.tsx     ← 3단계 위자드 UI
│   └── TaskProgressPanel.tsx     ← 태스크 진행률 NDJSON 스트리밍 패널
└── locales/
    ├── en.json                   ← 영문 i18n
    └── ko.json                   ← 한국어 i18n
```

### 데이터 흐름

```
1. Explore Phase
   Client → POST /api/board/explore → 외부 API 호출 → LLM/휴리스틱 분석 → 매핑 반환

2. Ingest Phase
   Client → POST /api/board/ingest → task_id 즉시 반환
                                   ↓ (백그라운드)
                                   페이지 순회 → 게시물별 처리
                                   ├── HTML 정제 (태그 제거, 이미지/테이블 추출)
                                   ├── 첨부파일 이미지 → VLM 분석
                                   ├── 테이블 → LLM 분석
                                   └── rag.ainsert() → KG 저장

3. 진행률 스트리밍
   Client → GET /api/tasks/{task_id}/stream → NDJSON 이벤트
```

---

## 3. API 엔드포인트 상세

### 3.1 POST /api/board/explore

외부 게시판 API를 호출하여 응답 구조를 분석하고 필드 매핑을 자동 감지한다.

#### 요청 헤더

| 헤더 | 필수 | 설명 |
|------|------|------|
| `Content-Type` | O | `application/json` |
| `LIGHTRAG-WORKSPACE` | △ | 워크스페이스 ID (없으면 default) |

#### 요청 본문 (`BoardExploreRequest`)

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `api_url` | string | **O** | - | 외부 게시판 API의 URL |
| `method` | string | | `"GET"` | HTTP 메서드 (GET/POST) |
| `headers` | object | | null | 외부 API 호출 시 사용할 헤더 (인증 토큰 등) |
| `params` | object | | null | URL 쿼리 파라미터 |
| `body` | object | | null | POST 요청 시 JSON 본문 |
| `base_url` | string | | null | 첨부파일 상대경로 해석용 Base URL |
| `user_mapping` | FieldMapping | | null | **수동 모드**: 사용자가 입력한 매핑을 검증. null이면 자동 감지 |

#### 동작 모드

**1) 자동 감지 모드** (`user_mapping` = null)

API를 호출하고 응답에서 배열을 찾아 LLM으로 필드 매핑을 감지한다.
- 배열 탐색: 중첩 경로(예: `result.results`)까지 재귀적으로 검색
- LLM 감지 실패 시 휴리스틱 폴백 (필드명 패턴 매칭)
- 대안 매핑(`alternative_mappings`)도 함께 반환

**2) 수동 검증 모드** (`user_mapping` 제공)

사용자가 입력한 매핑이 실제 API 응답에 유효한지 검증한다.
- `items_path`로 배열 접근 가능 여부 확인
- `title_field`, `body_field`가 실제 아이템에 존재하는지 검증

#### 응답 (`BoardExploreResponse`)

| 필드 | 타입 | 설명 |
|------|------|------|
| `success` | boolean | 감지/검증 성공 여부 |
| `sample_data` | object | API 응답 샘플 (최대 3건으로 축약) |
| `detected_mapping` | FieldMapping | 감지된 필드 매핑 |
| `detected_items_count` | integer | 감지된 아이템 수 |
| `sample_item` | object | 첫 번째 아이템 미리보기 (title, body, id, date, author, _raw_keys) |
| `alternative_mappings` | FieldMapping[] | 대안 매핑 (최대 2개) |
| `detection_method` | string | `"llm"` / `"heuristic"` / `"manual"` |
| `llm_confidence` | string | LLM 감지 신뢰도: `"high"` / `"medium"` / `"low"` |
| `llm_notes` | string | LLM의 분석 메모 |
| `error` | string | 실패 시 에러 메시지 |

#### 예시: 자동 감지

```bash
curl -X POST http://localhost:9422/api/board/explore \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{
    "api_url": "https://kevcs-ap.lbucess.com/api/board/6954e0c32008e6d0e2ea6a63",
    "method": "GET",
    "headers": {
      "Authorization": "Bearer <TOKEN>"
    }
  }'
```

**응답 예시:**
```json
{
  "success": true,
  "detected_mapping": {
    "items_path": "result.results",
    "title_field": "title",
    "body_field": "content",
    "id_field": "_id",
    "date_field": "createDt",
    "author_field": "creatorId",
    "attachments_field": "files",
    "pagination_type": "none"
  },
  "detected_items_count": 1,
  "sample_item": {
    "title": "[E-pit PASS] 서비스 제휴사 충전 요금 변경 안내",
    "body": "https://www.e-pit.co.kr/brand-web/support/notice/270",
    "id": "6954e0c32008e6d0e2ea6a63",
    "date": 1767170243000,
    "author": "kevcsadmin",
    "_raw_keys": ["_id", "division", "orgId", "title", "content", "readCnt", "creatorId", "createDt", "files"]
  },
  "detection_method": "llm",
  "llm_confidence": "high"
}
```

#### 예시: 수동 검증

```bash
curl -X POST http://localhost:9422/api/board/explore \
  -H 'Content-Type: application/json' \
  -d '{
    "api_url": "https://api.example.com/posts?page=1&size=10",
    "method": "GET",
    "user_mapping": {
      "items_path": "data.items",
      "title_field": "subject",
      "body_field": "content",
      "id_field": "postNo",
      "date_field": "regDate",
      "pagination_type": "page_param",
      "page_param": "page",
      "page_size_param": "size"
    }
  }'
```

---

### 3.2 POST /api/board/ingest

게시판 게시물을 수집하여 지식그래프에 삽입하는 비동기 태스크를 시작한다.

#### 요청 헤더

| 헤더 | 필수 | 설명 |
|------|------|------|
| `Content-Type` | O | `application/json` |
| `LIGHTRAG-WORKSPACE` | **O** | 워크스페이스 ID (수집 대상 워크스페이스) |

> **주의:** 워크스페이스 헤더가 없으면 default 워크스페이스에 수집됩니다. 이후 `update_existing`으로 업데이트할 때도 동일한 워크스페이스를 지정해야 기존 문서를 찾을 수 있습니다.

#### 요청 본문 (`BoardIngestRequest`)

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `api_url` | string | **O** | - | 외부 게시판 API URL |
| `method` | string | | `"GET"` | HTTP 메서드 |
| `headers` | object | | null | 외부 API 인증 헤더 등 |
| `params` | object | | null | URL 쿼리 파라미터 |
| `body` | object | | null | POST 요청 시 JSON 본문 |
| `field_mapping` | FieldMapping | **O** | - | 필드 매핑 (explore 결과 사용) |
| `max_pages` | integer | | 50 | 최대 순회 페이지 수 |
| `page_size` | integer | | 20 | 페이지당 아이템 수 |
| `process_images` | boolean | | true | 첨부/인라인 이미지 VLM 처리 |
| `process_tables` | boolean | | true | HTML 테이블 LLM 처리 |
| `skip_duplicates` | boolean | | true | `file_path` 기준 중복 게시물 스킵 |
| `update_existing` | boolean | | false | 기존 문서 삭제 후 재삽입 (지식 갱신) |
| `fetch_detail` | boolean | | false | 게시물별 상세 API 호출 |
| `date_filter_from` | string | | null | 이 날짜 이후 게시물만 수집 |
| `base_url` | string | | null | 첨부파일 상대경로 해석용 Base URL |

#### 중복 제어 옵션 (상호 배타)

| 옵션 조합 | 동작 |
|-----------|------|
| `skip_duplicates=true` (기본) | 이미 수집된 게시물(`file_path` 존재) → 스킵 |
| `update_existing=true` | 기존 문서를 KG에서 완전 삭제(`adelete_by_doc_id`) 후 재삽입 |
| 둘 다 `false` | 무조건 삽입 시도 (동일 doc_id면 LightRAG 코어의 `filter_keys`에서 스킵됨) |

> `update_existing=true` 설정 시 `skip_duplicates`는 자동으로 무시됩니다.

#### 응답 (`BoardIngestResponse`)

| 필드 | 타입 | 설명 |
|------|------|------|
| `task_id` | string | 비동기 태스크 ID (UUID) |
| `stream_url` | string | 진행률 스트리밍 URL (`/api/tasks/{task_id}/stream`) |
| `message` | string | 시작 메시지 |

#### 태스크 완료 시 결과 (`result`)

| 필드 | 타입 | 설명 |
|------|------|------|
| `success` | boolean | 에러가 0건이면 true |
| `api_url` | string | 수집 대상 API URL |
| `domain` | string | 도메인명 |
| `total_processed` | integer | 성공적으로 처리된 게시물 수 |
| `total_updated` | integer | 기존 문서를 삭제 후 재삽입한 수 |
| `total_skipped` | integer | 중복으로 스킵된 수 |
| `total_errors` | integer | 처리 실패 수 |
| `errors` | string[] | 에러 메시지 (최대 20건) |

#### 예시: 최초 수집

```bash
curl -X POST http://localhost:9422/api/board/ingest \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{
    "api_url": "https://kevcs-ap.lbucess.com/api/board/6954e0c32008e6d0e2ea6a63",
    "method": "GET",
    "headers": {
      "Authorization": "Bearer <TOKEN>"
    },
    "field_mapping": {
      "items_path": "result.results",
      "title_field": "title",
      "body_field": "content",
      "id_field": "_id",
      "date_field": "createDt",
      "author_field": "creatorId",
      "attachments_field": "files",
      "pagination_type": "none"
    },
    "max_pages": 1,
    "page_size": 20,
    "process_images": false,
    "process_tables": false,
    "skip_duplicates": true
  }'
```

**응답:**
```json
{
  "task_id": "5baec6a6-58fd-4574-9a16-6e259d35a481",
  "stream_url": "/api/tasks/5baec6a6-58fd-4574-9a16-6e259d35a481/stream",
  "message": "Board ingestion started for kevcs-ap.lbucess.com"
}
```

#### 예시: 기존 문서 업데이트

게시물 내용이 수정된 후, 기존 지식을 삭제하고 새로 수집:

```bash
curl -X POST http://localhost:9422/api/board/ingest \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{
    "api_url": "https://kevcs-ap.lbucess.com/api/board/697968bd8a81135a68dda535",
    "method": "GET",
    "headers": {
      "Authorization": "Bearer <TOKEN>"
    },
    "field_mapping": {
      "items_path": "result.results",
      "title_field": "title",
      "body_field": "content",
      "id_field": "_id",
      "date_field": "createDt",
      "author_field": "creatorId",
      "attachments_field": "files",
      "pagination_type": "none"
    },
    "max_pages": 1,
    "skip_duplicates": false,
    "update_existing": true,
    "process_images": false,
    "process_tables": false
  }'
```

**완료 결과:**
```json
{
  "task_id": "7d901a7d-60f4-4e1d-947e-7c5940a30652",
  "task_type": "board_ingest",
  "workspace": "kevcs",
  "status": "completed",
  "progress": 100.0,
  "result": {
    "success": true,
    "total_processed": 1,
    "total_updated": 1,
    "total_skipped": 0,
    "total_errors": 0,
    "errors": []
  }
}
```

#### 예시: 페이지네이션이 있는 목록 API 전체 수집

```bash
curl -X POST http://localhost:9422/api/board/ingest \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: my-workspace' \
  -d '{
    "api_url": "https://api.example.com/board/posts",
    "method": "GET",
    "headers": {
      "Authorization": "Bearer <TOKEN>"
    },
    "field_mapping": {
      "items_path": "data.items",
      "title_field": "subject",
      "body_field": "content",
      "id_field": "postNo",
      "date_field": "regDate",
      "author_field": "writerName",
      "attachments_field": "fileList",
      "detail_url_template": "https://api.example.com/board/posts/{id}",
      "pagination_type": "page_param",
      "page_param": "page",
      "page_size_param": "size",
      "total_field": "data.totalCount"
    },
    "max_pages": 100,
    "page_size": 20,
    "process_images": true,
    "process_tables": true,
    "skip_duplicates": true,
    "fetch_detail": true,
    "base_url": "https://board.example.com"
  }'
```

---

### 3.3 POST /api/board/delete

수집된 게시판 게시물을 **원본 게시글 ID만으로** 삭제한다. 인제스트 시 사용한 `api_url`과 게시물 ID를 전달하면 내부적으로 `board://{domain}/{item_id}` 패턴의 `file_path`를 복원하여, 해당 문서의 모든 청크·엔티티·관계·벡터를 완전 삭제한다.

#### 요청 헤더

| 헤더 | 필수 | 설명 |
|------|------|------|
| `Content-Type` | O | `application/json` |
| `LIGHTRAG-WORKSPACE` | **O** | 워크스페이스 ID (수집했던 워크스페이스와 동일해야 함) |

#### 요청 본문 (`BoardDeleteRequest`)

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `api_url` | string | **O** | 인제스트 시 사용한 동일 API URL (도메인 추출용) |
| `item_ids` | string[] | **O** | 삭제할 원본 게시글 ID 목록 |

> **`api_url`이 필요한 이유:** 인제스트 시 `board://{domain}/{item_id}` 형식으로 `file_path`가 생성되므로, 동일한 `api_url`에서 도메인을 추출해야 정확히 매칭됩니다.

#### 응답 (`BoardDeleteResponse`)

| 필드 | 타입 | 설명 |
|------|------|------|
| `deleted_items` | integer | 삭제 성공한 게시글 수 |
| `deleted_docs` | integer | 삭제된 문서 청크(doc) 수 |
| `not_found` | string[] | 해당 `file_path`에 문서가 없는 게시글 ID 목록 |
| `errors` | string[] | 삭제 중 발생한 에러 메시지 |

#### 삭제 범위

`adelete_by_doc_id()`를 호출하므로 다음이 모두 삭제된다:

| 대상 | 설명 |
|------|------|
| `doc_status` | 문서 상태 레코드 |
| `doc_chunks` | 텍스트 청크 |
| `vdb_chunks` / `vdb_entity` / `vdb_relation` | 벡터 임베딩 |
| Neo4j 엔티티/관계 | 지식그래프 노드·엣지 |
| LLM 캐시 | 해당 문서의 LLM 추출 캐시 |

#### 예시: 단일 게시물 삭제

```bash
curl -X POST http://localhost:9422/api/board/delete \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{
    "api_url": "https://kevcs-ap.lbucess.com/api/board",
    "item_ids": ["6954e0c32008e6d0e2ea6a63"]
  }'
```

> `api_url`에서는 도메인(`kevcs-ap.lbucess.com`)만 추출하므로, 경로 부분은 인제스트 시와 정확히 일치하지 않아도 됩니다. 동일 도메인이기만 하면 OK.

**응답:**
```json
{
  "deleted_items": 1,
  "deleted_docs": 3,
  "not_found": [],
  "errors": []
}
```

#### 예시: 여러 게시물 일괄 삭제

동일 도메인의 게시물이면 `item_ids` 배열에 여러 ID를 전달하여 한 번에 삭제할 수 있다:

```bash
curl -X POST http://localhost:9422/api/board/delete \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{
    "api_url": "https://kevcs-ap.lbucess.com/api/board",
    "item_ids": ["6954e0c32008e6d0e2ea6a63", "697968bd8a81135a68dda535", "nonexistent-id"]
  }'
```

**응답:**
```json
{
  "deleted_items": 2,
  "deleted_docs": 5,
  "not_found": ["nonexistent-id"],
  "errors": []
}
```

#### 예시: 존재하지 않는 게시물 삭제 시도

```bash
curl -X POST http://localhost:9422/api/board/delete \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{
    "api_url": "https://example.com/api/board",
    "item_ids": ["999999"]
  }'
```

**응답:**
```json
{
  "deleted_items": 0,
  "deleted_docs": 0,
  "not_found": ["999999"],
  "errors": []
}
```

---

## 4. FieldMapping 스키마

| 필드 | 타입 | 필수 | 설명 | 예시 |
|------|------|------|------|------|
| `items_path` | string | **O** | API 응답에서 아이템 배열 경로 (점 표기법) | `"result.results"`, `"data.items"`, `""` (루트 배열) |
| `title_field` | string | **O** | 게시물 제목 필드명 | `"title"`, `"subject"` |
| `body_field` | string | **O** | 게시물 본문 필드명 | `"content"`, `"body"`, `"html"` |
| `id_field` | string | | 게시물 고유 ID 필드명 | `"_id"`, `"postNo"`, `"seq"` |
| `date_field` | string | | 작성일시 필드명 | `"createDt"`, `"regDate"` |
| `author_field` | string | | 작성자 필드명 | `"creatorId"`, `"writerName"` |
| `attachments_field` | string | | 첨부파일 배열 필드명 | `"files"`, `"attachments"` |
| `detail_url_template` | string | | 상세 API URL 템플릿 (`{id}` 치환) | `"/api/posts/{id}"` |
| `pagination_type` | string | | 페이지네이션 방식 | `"page_param"` / `"offset_limit"` / `"cursor"` / `"none"` |
| `page_param` | string | | 페이지 번호 파라미터명 | `"page"`, `"pageNo"` |
| `page_size_param` | string | | 페이지 크기 파라미터명 | `"size"`, `"limit"`, `"pageSize"` |
| `total_field` | string | | 전체 건수 필드 경로 (점 표기법) | `"data.totalCount"`, `"total"` |
| `cursor_field` | string | | 커서 기반 페이지네이션의 커서 필드 | `"nextCursor"` |

### items_path 점 표기법

중첩된 JSON 구조에서 아이템 배열까지의 경로를 점(`.`)으로 구분하여 표기:

```json
// API 응답
{
  "code": "S999",
  "result": {
    "results": [ ... ]   ← 이 배열
  }
}
// items_path = "result.results"

// 루트 배열인 경우
[ ... ]
// items_path = ""
```

---

## 5. 페이지네이션 지원

### 5.1 page_param (기본)

페이지 번호 기반. 가장 일반적인 방식.

```
GET /api/posts?page=1&size=20  →  page=2&size=20  →  page=3&size=20  → ...
```

설정:
```json
{
  "pagination_type": "page_param",
  "page_param": "page",
  "page_size_param": "size"
}
```

### 5.2 offset_limit

오프셋 기반. 일부 API에서 사용.

```
GET /api/posts?offset=0&limit=20  →  offset=20&limit=20  →  offset=40&limit=20  → ...
```

설정:
```json
{
  "pagination_type": "offset_limit",
  "page_param": "offset",
  "page_size_param": "limit"
}
```

### 5.3 cursor

커서 기반. 응답에 포함된 커서 값으로 다음 페이지를 요청.

```json
{
  "pagination_type": "cursor",
  "cursor_field": "nextCursor"
}
```

### 5.4 none

단일 페이지 (페이지네이션 없음). 단건 게시물 API에 적합.

```json
{
  "pagination_type": "none"
}
```

### 종료 조건

페이지 순회는 다음 조건 중 하나라도 충족되면 중단된다:

1. `max_pages` 도달
2. 응답 아이템이 0건
3. 응답 아이템 수 < `page_size` (마지막 페이지)
4. `total_field`에서 읽은 전체 건수 도달
5. 태스크 취소 요청

---

## 6. 문서 업데이트 (update_existing)

### 문제 상황

게시판 게시물의 내용이 수정된 후 재수집하면:

| 옵션 | 동작 | 문제 |
|------|------|------|
| `skip_duplicates=true` | `file_path` 존재하면 스킵 | 내용 변경이 반영되지 않음 |
| `skip_duplicates=false` | 스킵하지 않지만 동일 `doc_id`면 코어에서 무시 | 역시 갱신 안됨 |

### 해결: update_existing=true

```
1. file_path로 기존 doc_id 전체 조회 (get_all_doc_ids_by_file_path)
2. 각 doc_id에 대해 adelete_by_doc_id() 호출
   → doc_status, doc_chunks, doc_full 삭제
   → KG 엔티티/관계 삭제 (full_entities, full_relations 추적)
   → Neo4j 노드/관계 삭제
   → 벡터 스토리지 삭제
3. 새 문서로 재삽입 (rag.ainsert)
   → 새 엔티티/관계 추출 및 KG 반영
```

### 주의사항

- `update_existing`과 `skip_duplicates`는 **상호 배타적**. 프론트엔드에서 하나를 켜면 다른 하나가 자동 해제됨
- `update_existing`은 `skip_duplicates`보다 우선 처리됨 (코드 상 if-elif 구조)
- KG 삭제 후 LLM이 재추출하므로, 동일 내용이라도 엔티티 구성이 미세하게 달라질 수 있음 (정상)
- 반드시 **동일한 워크스페이스**로 요청해야 기존 문서를 찾을 수 있음

### 문서 식별 방식

각 게시물은 다음 형식의 `file_path`로 식별된다:

```
board://{domain}/{item_id}
```

예: `board://kevcs-ap.lbucess.com/6954e0c32008e6d0e2ea6a63`

- `domain`: API URL의 호스트명
- `item_id`: `id_field`로 지정된 필드값 (없으면 순번)

---

## 7. 실전 사용 예시

### 7.1 단건 게시물 수집 (내용이 짧은 공지)

```bash
# Step 1: Explore로 구조 파악
curl -X POST http://localhost:9422/api/board/explore \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{
    "api_url": "https://kevcs-ap.lbucess.com/api/board/6954e0c32008e6d0e2ea6a63",
    "method": "GET",
    "headers": {"Authorization": "Bearer <TOKEN>"}
  }'

# Step 2: 감지된 매핑으로 수집
curl -X POST http://localhost:9422/api/board/ingest \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{
    "api_url": "https://kevcs-ap.lbucess.com/api/board/6954e0c32008e6d0e2ea6a63",
    "method": "GET",
    "headers": {"Authorization": "Bearer <TOKEN>"},
    "field_mapping": {
      "items_path": "result.results",
      "title_field": "title",
      "body_field": "content",
      "id_field": "_id",
      "date_field": "createDt",
      "author_field": "creatorId",
      "attachments_field": "files",
      "pagination_type": "none"
    },
    "max_pages": 1,
    "skip_duplicates": true,
    "process_images": false,
    "process_tables": false
  }'

# Step 3: 태스크 결과 확인
curl -s 'http://localhost:9422/api/tasks/<task_id>' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' | python3 -m json.tool
```

### 7.2 게시물 내용 수정 후 지식 갱신

```bash
curl -X POST http://localhost:9422/api/board/ingest \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{
    "api_url": "https://kevcs-ap.lbucess.com/api/board/697968bd8a81135a68dda535",
    "method": "GET",
    "headers": {"Authorization": "Bearer <TOKEN>"},
    "field_mapping": {
      "items_path": "result.results",
      "title_field": "title",
      "body_field": "content",
      "id_field": "_id",
      "date_field": "createDt",
      "author_field": "creatorId",
      "attachments_field": "files",
      "pagination_type": "none"
    },
    "skip_duplicates": false,
    "update_existing": true,
    "process_images": false,
    "process_tables": false
  }'
```

**기대 결과:** `total_updated: 1`, `total_processed: 1`

### 7.3 POST 방식 API + 이미지 처리

```bash
curl -X POST http://localhost:9422/api/board/ingest \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: my-workspace' \
  -d '{
    "api_url": "https://internal.api.com/graphql",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer <TOKEN>",
      "X-Custom-Header": "value"
    },
    "body": {
      "query": "{ posts(limit: 50) { id title content author { name } } }"
    },
    "field_mapping": {
      "items_path": "data.posts",
      "title_field": "title",
      "body_field": "content",
      "id_field": "id",
      "pagination_type": "none"
    },
    "process_images": true,
    "process_tables": true,
    "base_url": "https://internal.cdn.com"
  }'
```

### 7.4 상세 API가 별도인 경우 (목록 + 상세)

목록 API에는 제목만 있고, 상세 API에서 본문을 가져와야 할 때:

```bash
curl -X POST http://localhost:9422/api/board/ingest \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: my-workspace' \
  -d '{
    "api_url": "https://api.example.com/board/list",
    "method": "GET",
    "field_mapping": {
      "items_path": "data",
      "title_field": "title",
      "body_field": "content",
      "id_field": "id",
      "detail_url_template": "https://api.example.com/board/{id}",
      "pagination_type": "page_param",
      "page_param": "page",
      "page_size_param": "limit",
      "total_field": "total"
    },
    "fetch_detail": true,
    "max_pages": 50,
    "page_size": 20
  }'
```

`fetch_detail=true` + `detail_url_template`이 설정되면, 각 게시물에 대해 상세 API를 추가 호출하여 본문을 병합한다.

### 7.5 수집한 게시물 삭제

수집 후 특정 게시물을 지식그래프에서 완전히 제거하고 싶을 때:

```bash
# 동일 도메인의 api_url + 게시물 ID로 삭제
curl -X POST http://localhost:9422/api/board/delete \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{
    "api_url": "https://kevcs-ap.lbucess.com/api/board",
    "item_ids": ["6954e0c32008e6d0e2ea6a63"]
  }'
```

**주의:** 인제스트 시와 **동일한 도메인의 `api_url`과 워크스페이스**를 지정해야 합니다. `api_url`에서 도메인만 추출하여 `board://{domain}/{item_id}` 패턴으로 문서를 찾기 때문입니다.

### 7.6 수집 → 업데이트 → 삭제 전체 라이프사이클

```bash
# 1. 최초 수집
curl -X POST http://localhost:9422/api/board/ingest \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{
    "api_url": "https://kevcs-ap.lbucess.com/api/board/697968bd8a81135a68dda535",
    "field_mapping": { "items_path": "result.results", "title_field": "title", "body_field": "content", "id_field": "_id", "pagination_type": "none" },
    "skip_duplicates": true
  }'

# 2. 내용 변경 후 업데이트 (기존 삭제 후 재삽입)
curl -X POST http://localhost:9422/api/board/ingest \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{
    "api_url": "https://kevcs-ap.lbucess.com/api/board/697968bd8a81135a68dda535",
    "field_mapping": { "items_path": "result.results", "title_field": "title", "body_field": "content", "id_field": "_id", "pagination_type": "none" },
    "skip_duplicates": false,
    "update_existing": true
  }'

# 3. 게시물 삭제 (지식그래프에서 완전 제거)
curl -X POST http://localhost:9422/api/board/delete \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{
    "api_url": "https://kevcs-ap.lbucess.com/api/board",
    "item_ids": ["697968bd8a81135a68dda535"]
  }'
```

---

## 8. 비동기 태스크 모니터링

### 8.1 태스크 상태 조회

```bash
curl -s 'http://localhost:9422/api/tasks/<task_id>' \
  -H 'LIGHTRAG-WORKSPACE: kevcs'
```

### 8.2 NDJSON 실시간 스트리밍

```bash
curl -N 'http://localhost:9422/api/tasks/<task_id>/stream' \
  -H 'LIGHTRAG-WORKSPACE: kevcs'
```

각 줄이 독립된 JSON 이벤트:
```json
{"task_id":"...","status":"running","progress":45.2,"message":"Processed 15 items (updated 0, skipped 3, errors 0)","detail":{"page":2,"processed":15,"updated":0,"skipped":3,"errors":0}}
{"task_id":"...","status":"running","progress":67.8,"message":"Processed 28 items (updated 0, skipped 3, errors 0)","detail":{"page":3,"processed":28,"updated":0,"skipped":3,"errors":0}}
{"task_id":"...","status":"completed","progress":100.0,"message":"Completed","result":{...}}
```

### 8.3 태스크 취소

```bash
curl -X POST 'http://localhost:9422/api/tasks/<task_id>/cancel' \
  -H 'LIGHTRAG-WORKSPACE: kevcs'
```

### 태스크 상태 흐름

```
pending → running → completed
                  → failed
                  → cancelled
```

---

## 9. 프론트엔드 UI 사용법

`BoardIngestDialog.tsx`는 3단계 위자드 UI를 제공한다.

### Step 1: API 연결

- **자동 감지 모드**: API URL 입력 → "탐색" 클릭 → AI가 구조 분석
- **수동 모드**: API URL + 필드 매핑 직접 입력 → "검증" 클릭
- HTTP 메서드, 헤더, 파라미터, Base URL 설정 가능
- 탐색 결과에서 샘플 미리보기 확인

### Step 2: 필드 매핑 (자동 감지 모드만)

- AI가 감지한 매핑을 드롭다운으로 수정 가능
- 필수 필드: `title_field`, `body_field`
- 페이지네이션 타입/파라미터 설정
- 매핑 미리보기로 실제 데이터 확인

### Step 3: 수집 옵션

- 최대 페이지 수 / 페이지당 항목 수
- 이미지 처리 / 테이블 처리 토글
- **중복 건너뛰기** vs **기존 문서 업데이트** (상호 배타 체크박스)
- 상세 API 호출 옵션
- "수집 시작" → 태스크 진행률 패널 표시

---

## 10. 트러블슈팅

### Q: `total_updated`가 0으로 나와요

**워크스페이스 불일치 가능성.** 기존 문서가 `kevcs` 워크스페이스에 있는데 요청에 `LIGHTRAG-WORKSPACE` 헤더가 없으면 `default`로 조회하여 기존 문서를 찾지 못합니다.

```bash
# 올바른 예:
curl -H 'LIGHTRAG-WORKSPACE: kevcs' ...

# 잘못된 예 (default로 수집됨):
curl ... (헤더 없음)
```

### Q: 수집은 성공했는데 KG에 엔티티가 없어요

게시물 `content`가 URL 링크만 포함하는 경우, 추출할 지식이 적어 엔티티가 소수만 생성될 수 있습니다. `fetch_detail=true`로 상세 본문을 가져오거나, 본문이 실제 텍스트인 게시물로 테스트하세요.

### Q: 중복 레코드가 생겼어요

`skip_duplicates=false` + `update_existing=false`로 수집하면 LightRAG 코어의 `filter_keys`가 동일 `doc_id`를 처리하지만, `doc_status` 테이블에는 별도 레코드가 생길 수 있습니다. `update_existing=true`를 사용하면 깨끗하게 교체됩니다.

### Q: 태스크 조회 시 "Task not found"

태스크 API에도 `LIGHTRAG-WORKSPACE` 헤더가 필요합니다. 수집 시 지정한 것과 동일한 워크스페이스로 조회하세요.

### Q: 외부 API에서 인증 에러 (401/403)

`headers`에 인증 토큰이 올바르게 설정되었는지 확인하세요. JWT 토큰이 만료되었을 수 있습니다.

```json
{
  "headers": {
    "Authorization": "Bearer <유효한_토큰>"
  }
}
```

### Q: 삭제 시 `not_found`에 ID가 나와요

1. **워크스페이스 불일치:** 인제스트 시 사용한 것과 동일한 `LIGHTRAG-WORKSPACE` 헤더를 사용하세요.
2. **api_url 불일치:** 도메인이 다르면 `file_path` 패턴이 달라집니다. 인제스트 시 사용한 `api_url`과 정확히 동일한 값을 사용하세요.
3. **이미 삭제됨:** 이전에 이미 삭제되었거나 `update_existing`으로 교체된 경우.

```bash
# file_path 패턴 확인 (DB 직접 조회)
PGPASSWORD=lightrag_secure_2024 psql -h 10.62.130.84 -U lightrag -d lightrag -c \
  "SELECT id, file_path FROM lightrag_doc_status WHERE file_path LIKE 'board://%' LIMIT 10;"
```

### Q: 페이지네이션이 무한 루프에 빠져요

- `max_pages`를 적절히 설정하세요 (기본 50)
- `total_field`를 정확히 지정하면 전체 건수 기반으로 종료됩니다
- 마지막 페이지에 빈 배열이 반환되지 않는 API의 경우, 아이템 수 < `page_size` 조건으로 종료됩니다
