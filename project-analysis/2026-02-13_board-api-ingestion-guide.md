# LightRAG Board API Ingestion 가이드

> 작성일: 2026-02-13 | 최종 수정: 2026-03-11
> 대상: `/api/board/explore`, `/api/board/ingest`, `/api/board/delete`, `/api/board/view` 엔드포인트
> 소스: `lightrag/api/routers/board_routes.py`, `lightrag_webui/src/components/documents/BoardIngestDialog.tsx`

---

## 목차

1. [개요](#1-개요)
2. [아키텍처](#2-아키텍처)
3. [API 엔드포인트 상세](#3-api-엔드포인트-상세)
   - 3.1 [POST /api/board/explore](#31-post-apiboardexplore)
   - 3.2 [POST /api/board/ingest](#32-post-apiboardingest)
   - 3.3 [POST /api/board/delete](#33-post-apiboarddelete)
   - 3.4 [POST /api/board/view](#34-post-apiboardview)
4. [FieldMapping 스키마](#4-fieldmapping-스키마)
5. [페이지네이션 지원](#5-페이지네이션-지원)
6. [문서 업데이트 (update_existing)](#6-문서-업데이트-update_existing)
7. [실전 사용 예시 (curl)](#7-실전-사용-예시-curl)
8. [Python 코드 예시](#8-python-코드-예시)
9. [JavaScript/TypeScript 코드 예시](#9-javascripttypescript-코드-예시)
10. [비동기 태스크 모니터링](#10-비동기-태스크-모니터링)
11. [에러 응답 레퍼런스](#11-에러-응답-레퍼런스)
12. [프론트엔드 UI 사용법](#12-프론트엔드-ui-사용법)
13. [트러블슈팅](#13-트러블슈팅)

---

## 1. 개요

Board API Ingestion은 외부 REST API 기반 게시판/BBS 시스템에서 게시물을 수집하여 LightRAG 지식그래프로 변환하는 기능이다.

### 핵심 특성

| 특성 | 설명 |
|------|------|
| **자동 필드 감지** | API 응답 구조를 LLM/휴리스틱으로 자동 분석하여 필드 매핑 생성 |
| **비동기 처리** | 즉시 `task_id` 반환 → 백그라운드 처리 → NDJSON 스트리밍 진행률 |
| **페이지네이션** | page_param, offset_limit, cursor 방식 지원 |
| **멀티모달 통합** | 첨부파일 이미지(VLM) + 테이블(LLM) 처리, 기본 파서: Docling |
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

사용자가 이미 API 응답 구조를 알고 있을 때, `user_mapping`에 매핑을 직접 입력하여 해당 필드가 유효한지 검증할 수 있다.

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

**수동 검증 성공 응답:**

```json
{
  "success": true,
  "detected_mapping": {
    "items_path": "data.items",
    "title_field": "subject",
    "body_field": "content",
    "id_field": "postNo",
    "date_field": "regDate",
    "pagination_type": "page_param",
    "page_param": "page",
    "page_size_param": "size"
  },
  "detected_items_count": 10,
  "sample_item": {
    "title": "3월 정기 점검 안내",
    "body": "<p>서비스 정기 점검을 실시합니다...</p>",
    "id": "4521",
    "date": "2026-03-10T09:00:00",
    "_raw_keys": ["postNo", "subject", "content", "regDate", "writerName", "fileList"]
  },
  "detection_method": "manual"
}
```

#### 예시: 탐색 실패 — 외부 API 접근 불가

```bash
curl -X POST http://localhost:9422/api/board/explore \
  -H 'Content-Type: application/json' \
  -d '{
    "api_url": "https://unreachable-server.example.com/api/posts",
    "method": "GET"
  }'
```

**에러 응답:**

```json
{
  "success": false,
  "detected_items_count": 0,
  "alternative_mappings": [],
  "detection_method": "heuristic",
  "error": "API 호출 실패: All connection attempts failed"
}
```

#### 예시: 탐색 실패 — 배열을 찾을 수 없음

API가 정상 응답했지만 게시물 배열을 찾지 못한 경우:

```json
{
  "success": false,
  "sample_data": {"status": "ok", "message": "No data"},
  "detected_items_count": 0,
  "detection_method": "heuristic",
  "error": "응답에서 아이템 배열을 찾을 수 없습니다"
}
```

> **팁:** `sample_data`에 실제 API 응답이 포함되므로, 이를 확인하여 `items_path`를 수동으로 지정할 수 있습니다.

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
| `process_documents` | boolean | | true | 첨부 문서(PDF/DOCX/PPTX) 파싱 및 처리 |
| `parser` | string | | `"docling"` | 문서 파서 선택 (`"docling"` 또는 `"pymupdf"`) |
| `skip_duplicates` | boolean | | true | `file_path` 기준 중복 게시물 스킵 |
| `update_existing` | boolean | | false | 기존 문서 삭제 후 재삽입 (지식 갱신) |
| `fetch_detail` | boolean | | false | 게시물별 상세 API 호출 (`detail_url_template` 필요) |
| `base_url` | string | | null | 첨부파일 상대경로 해석용 Base URL |
| `document_prompt` | string | | null | 문서 파싱 시 LLM에 전달할 커스텀 프롬프트 |
| `image_prompt` | string | | null | 이미지 VLM 분석 시 커스텀 프롬프트 |
| `table_prompt` | string | | null | 테이블 LLM 분석 시 커스텀 프롬프트 |

> **커스텀 프롬프트:** `document_prompt`, `image_prompt`, `table_prompt`를 지정하면 멀티모달 처리 시 기본 프롬프트 대신 사용자가 지정한 프롬프트로 LLM/VLM을 호출합니다. 도메인 특화 용어나 추출 지침을 전달할 때 유용합니다.

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

수집된 게시판 게시물을 **원본 게시글 ID만으로** 삭제한다. 인제스트 시 사용한 `api_url`과 게시물 ID를 전달하면 내부적으로 `{scheme}://{host}{api_path}/{item_id}` 패턴의 `file_path`를 복원하여, 해당 문서의 모든 청크·엔티티·관계·벡터를 완전 삭제한다.

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

> **`api_url`이 필요한 이유:** 인제스트 시 `{scheme}://{host}{api_path}/{item_id}` 형식으로 `file_path`가 생성되므로, 동일한 `api_url`을 전달해야 정확히 매칭됩니다. 단건 URL의 경우 `item_id` 중복 추가를 자동 방지합니다.

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

### 3.4 POST /api/board/view

수집된 게시물의 **원본 내용을 실시간으로 조회**한다. 인제스트 시 저장된 API 헤더와 필드 매핑을 재사용하여 외부 API에서 최신 게시물을 가져온다.

> 이 엔드포인트는 참조자료 패널에서 게시물 원문을 보여줄 때 사용된다. 인제스트 태스크의 메타데이터(헤더, 매핑)를 자동으로 복원하므로, 클라이언트는 `file_path`만 전달하면 된다.

#### 요청 헤더

| 헤더 | 필수 | 설명 |
|------|------|------|
| `Content-Type` | O | `application/json` |
| `LIGHTRAG-WORKSPACE` | **O** | 워크스페이스 ID (인제스트 시와 동일) |

#### 요청 본문 (`BoardViewRequest`)

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `file_path` | string | **O** | 인제스트 시 저장된 게시물 URL (예: `https://host/api/posts/123`) |

> `file_path`는 문서 상태 테이블(`LIGHTRAG_DOC_STATUS`)의 `file_path` 컬럼 값이다. 인제스트 시 `{scheme}://{host}{api_path}/{item_id}` 형식으로 자동 생성된다.

#### 응답 (`BoardViewResponse`)

| 필드 | 타입 | 설명 |
|------|------|------|
| `success` | boolean | 조회 성공 여부 |
| `title` | string | 게시물 제목 |
| `body` | string | 게시물 본문 (HTML 포함 가능) |
| `date` | string | 작성일시 |
| `author` | string | 작성자 |
| `attachments` | array | 첨부파일 목록 (URL 절대경로로 변환됨) |
| `raw_data` | object | API 원본 응답 데이터 (디버깅용) |
| `error` | string | 실패 시 에러 메시지 |

#### 동작 원리

```
1. file_path에서 item_id와 api_base_url 추출
   예: "https://host/api/board/123" → base="https://host/api/board", id="123"

2. 동일 워크스페이스의 BOARD_INGEST 태스크에서 매칭되는 api_url 검색
   → 저장된 headers(인증 토큰), field_mapping 복원

3. detail_url_template이 있으면 해당 패턴 사용, 없으면 {base}/{id}로 호출

4. 필드 매핑으로 title/body/date/author/attachments 추출하여 반환
```

#### 예시: 게시물 원문 조회

```bash
# 인제스트 시 저장된 file_path로 원문 조회
curl -X POST http://localhost:9422/api/board/view \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{
    "file_path": "https://kevcs-ap.lbucess.com/api/board/6954e0c32008e6d0e2ea6a63"
  }'
```

**성공 응답:**

```json
{
  "success": true,
  "title": "[E-pit PASS] 서비스 제휴사 충전 요금 변경 안내",
  "body": "<p>안녕하세요, E-pit 서비스 이용 고객 여러분...</p>",
  "date": "1767170243000",
  "author": "kevcsadmin",
  "attachments": [
    {
      "url": "https://kevcs-ap.lbucess.com/files/notice_detail.pdf",
      "name": "요금변경_안내문.pdf"
    }
  ],
  "raw_data": {
    "_id": "6954e0c32008e6d0e2ea6a63",
    "title": "[E-pit PASS] 서비스 제휴사 충전 요금 변경 안내",
    "content": "<p>안녕하세요...</p>",
    "createDt": 1767170243000,
    "creatorId": "kevcsadmin",
    "files": [...]
  }
}
```

**인증 만료 응답:**

```json
{
  "success": false,
  "error": "인증이 만료되었거나 API에 접근할 수 없습니다: 401"
}
```

**매칭 태스크 없음:**

```json
{
  "success": false,
  "error": "No matching board ingestion task found for this URL"
}
```

> **주의:** view API는 인제스트 태스크의 메타데이터를 사용하므로, 해당 워크스페이스에 동일 `api_url`로 인제스트한 태스크가 존재해야 합니다. 태스크가 72시간 이상 지나 메모리에서 제거된 경우에도 DB에서 자동 로드됩니다.

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
| `attachment_url_field` | string | | 첨부파일 객체 내 URL/경로 키 | `"url"`, `"filePath"`, `"downloadUrl"` |
| `attachment_name_field` | string | | 첨부파일 객체 내 표시명 키 | `"name"`, `"fileName"`, `"originalName"` |
| `detail_url_template` | string | | 상세 API URL 템플릿 (`{id}` 치환) | `"/api/posts/{id}"` |
| `pagination_type` | string | | 페이지네이션 방식 | `"page_param"` / `"offset_limit"` / `"cursor"` / `"none"` |
| `page_param` | string | | 페이지 번호 파라미터명 | `"page"`, `"pageNo"` |
| `page_size_param` | string | | 페이지 크기 파라미터명 | `"size"`, `"limit"`, `"pageSize"` |
| `total_field` | string | | 전체 건수 필드 경로 (점 표기법) | `"data.totalCount"`, `"total"` |
| `cursor_field` | string | | 커서 기반 페이지네이션의 커서 필드 | `"nextCursor"` |

### attachment_url_field / attachment_name_field 상세

첨부파일 배열의 각 객체에서 URL과 이름을 추출할 키를 지정한다. API마다 첨부파일 구조가 다르므로 이 필드로 정확히 매핑한다.

```json
// 예시 1: 첨부파일 객체에 url, name 키가 있는 경우
"files": [
  {"url": "/download/abc.pdf", "name": "보고서.pdf", "size": 1024},
  {"url": "/download/def.jpg", "name": "사진.jpg", "size": 2048}
]
// → attachment_url_field = "url", attachment_name_field = "name"

// 예시 2: filePath, originalName 키를 사용하는 경우
"attachments": [
  {"filePath": "https://cdn.example.com/docs/report.pdf", "originalName": "월간보고서.pdf"}
]
// → attachment_url_field = "filePath", attachment_name_field = "originalName"
```

> 이 필드를 지정하지 않으면 시스템이 `url`, `path`, `href`, `src` 등 일반적인 키를 자동 탐색합니다. 자동 탐색이 실패하면 첨부파일이 처리되지 않으므로, 특수한 키 이름을 사용하는 API에서는 반드시 명시하세요.

### items_path 점 표기법

중첩된 JSON 구조에서 아이템 배열까지의 경로를 점(`.`)으로 구분하여 표기한다. API 응답 구조에 따라 다양한 깊이의 경로가 가능하다.

```json
// 예시 1: 2단계 중첩 — items_path = "result.results"
{
  "code": "S999",
  "result": {
    "results": [ ... ]   ← 이 배열
  }
}

// 예시 2: 1단계 중첩 — items_path = "data"
{
  "status": "ok",
  "data": [ ... ]   ← 이 배열
}

// 예시 3: 루트 배열 — items_path = ""
[ ... ]

// 예시 4: 3단계 중첩 — items_path = "response.body.items"
{
  "response": {
    "header": {"resultCode": "00"},
    "body": {
      "items": [ ... ]   ← 이 배열,
      "totalCount": 150
    }
  }
}
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
6. **중복 페이지 감지** — 이전 페이지와 동일한 데이터 반환 시 자동 중단
   - `id_field` 설정 시: ID 집합 비교
   - `id_field` 미설정 시: 페이지 콘텐츠 MD5 해시 비교 (무한 루프 방지)

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
{scheme}://{host}{api_path}/{item_id}
```

예: `https://kevcs-ap.lbucess.com/api/board/6954e0c32008e6d0e2ea6a63`

- 실제 API URL 형태로 저장되어, 참조자료에서 직접 조회 가능
- `item_id`: `id_field`로 지정된 필드값 (없으면 순번)
- **단건 URL 처리**: `api_url`이 이미 `item_id`를 포함하는 경우 중복 추가하지 않음

### doc_nm (문서 표시명)

게시물의 제목(`title_field`)이 `doc_nm` 독립 컬럼에 저장된다.

- 파이프라인 처리 중 `metadata`가 덮어쓰여도 `doc_nm`은 보존됨
- upsert 시 `COALESCE(EXCLUDED.doc_nm, LIGHTRAG_DOC_STATUS.doc_nm)` 로직으로 기존 값 유지
- 참조자료에서 URL 대신 게시물 제목으로 표시

---

## 7. 실전 사용 예시 (curl)

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

**주의:** 인제스트 시와 **동일한 `api_url`과 워크스페이스**를 지정해야 합니다. `api_url`에서 `{scheme}://{host}{api_path}/{item_id}` 형식으로 `file_path`를 복원하여 문서를 찾기 때문입니다.

### 7.6 커스텀 프롬프트로 도메인 특화 수집

전기차 충전 관련 게시판에서 도메인 특화 용어를 정확히 추출하고 싶을 때:

```bash
curl -X POST http://localhost:9422/api/board/ingest \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{
    "api_url": "https://kevcs-ap.lbucess.com/api/board/notices",
    "method": "GET",
    "headers": {"Authorization": "Bearer <TOKEN>"},
    "field_mapping": {
      "items_path": "result.results",
      "title_field": "title",
      "body_field": "content",
      "id_field": "_id",
      "pagination_type": "page_param",
      "page_param": "page",
      "page_size_param": "size"
    },
    "max_pages": 10,
    "page_size": 20,
    "process_images": true,
    "process_tables": true,
    "image_prompt": "이 이미지는 전기차 충전 서비스 관련 공지사항의 첨부 이미지입니다. 충전 요금, 충전소 위치, 제휴사 정보 등 핵심 내용을 한국어로 상세히 설명하세요.",
    "table_prompt": "이 테이블은 전기차 충전 요금표 또는 서비스 비교표입니다. 요금 항목, 단가, 할인율 등의 수치를 정확히 추출하여 구조화된 설명으로 변환하세요.",
    "document_prompt": "전기차 충전 인프라 관련 문서입니다. 충전 규격(AC/DC), kW 용량, 커넥터 타입, 요금 체계 등 기술 사양을 중심으로 핵심 내용을 추출하세요."
  }'
```

### 7.7 첨부파일 URL/이름 필드를 명시한 수집

첨부파일 객체의 키 이름이 비표준인 경우:

```bash
curl -X POST http://localhost:9422/api/board/ingest \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: my-workspace' \
  -d '{
    "api_url": "https://intranet.company.com/api/notices",
    "method": "GET",
    "headers": {"Authorization": "Bearer <TOKEN>"},
    "field_mapping": {
      "items_path": "data.list",
      "title_field": "nttSj",
      "body_field": "nttCn",
      "id_field": "nttId",
      "date_field": "frstRegistPnttm",
      "author_field": "frstRegisterId",
      "attachments_field": "atchFileList",
      "attachment_url_field": "streFileNm",
      "attachment_name_field": "orignlFileNm",
      "pagination_type": "page_param",
      "page_param": "pageIndex",
      "page_size_param": "recordCountPerPage"
    },
    "base_url": "https://intranet.company.com",
    "max_pages": 20,
    "process_images": true,
    "process_documents": true
  }'
```

> 한국 공공기관 API(전자정부 프레임워크 기반)는 `nttSj`(게시물제목), `nttCn`(게시물내용), `atchFileList`(첨부파일목록) 같은 필드명을 사용합니다. `attachment_url_field`와 `attachment_name_field`를 정확히 지정해야 첨부파일이 처리됩니다.

### 7.8 게시물 원문 조회 (view)

수집된 게시물의 최신 원본 내용을 확인할 때:

```bash
# 문서 목록에서 file_path 확인 후 원문 조회
curl -X POST http://localhost:9422/api/board/view \
  -H 'Content-Type: application/json' \
  -H 'LIGHTRAG-WORKSPACE: kevcs' \
  -d '{
    "file_path": "https://kevcs-ap.lbucess.com/api/board/6954e0c32008e6d0e2ea6a63"
  }'
```

> `file_path`는 문서 관리 화면에서 확인할 수 있습니다. `http://` 또는 `https://`로 시작하는 URL 형태의 `file_path`가 게시판에서 수집된 문서입니다.

### 7.9 수집 → 업데이트 → 삭제 전체 라이프사이클

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

## 8. Python 코드 예시

### 8.1 기본 수집 (requests 라이브러리)

```python
import requests
import json
import time

BASE_URL = "http://localhost:9422"
WORKSPACE = "kevcs"
HEADERS = {
    "Content-Type": "application/json",
    "LIGHTRAG-WORKSPACE": WORKSPACE,
}


def explore_board(api_url: str, auth_token: str = None) -> dict:
    """외부 게시판 API를 탐색하여 필드 매핑을 자동 감지한다."""
    payload = {
        "api_url": api_url,
        "method": "GET",
    }
    if auth_token:
        payload["headers"] = {"Authorization": f"Bearer {auth_token}"}

    resp = requests.post(f"{BASE_URL}/api/board/explore", headers=HEADERS, json=payload)
    resp.raise_for_status()
    result = resp.json()

    if result["success"]:
        print(f"✓ 감지 성공 (방식: {result['detection_method']})")
        print(f"  아이템 수: {result['detected_items_count']}")
        print(f"  매핑: {json.dumps(result['detected_mapping'], indent=2, ensure_ascii=False)}")
        if result.get("sample_item"):
            print(f"  샘플: {result['sample_item'].get('title', 'N/A')}")
    else:
        print(f"✗ 감지 실패: {result.get('error')}")

    return result


def ingest_board(api_url: str, field_mapping: dict, auth_token: str = None, **options) -> str:
    """게시판 게시물을 수집하는 비동기 태스크를 시작하고 task_id를 반환한다."""
    payload = {
        "api_url": api_url,
        "method": "GET",
        "field_mapping": field_mapping,
        "max_pages": options.get("max_pages", 50),
        "page_size": options.get("page_size", 20),
        "process_images": options.get("process_images", True),
        "process_tables": options.get("process_tables", True),
        "skip_duplicates": options.get("skip_duplicates", True),
        "update_existing": options.get("update_existing", False),
    }
    if auth_token:
        payload["headers"] = {"Authorization": f"Bearer {auth_token}"}

    resp = requests.post(f"{BASE_URL}/api/board/ingest", headers=HEADERS, json=payload)
    resp.raise_for_status()
    result = resp.json()

    print(f"✓ 태스크 시작: {result['task_id']}")
    print(f"  스트리밍 URL: {result['stream_url']}")
    return result["task_id"]


def wait_for_task(task_id: str, poll_interval: float = 2.0) -> dict:
    """태스크 완료까지 폴링으로 대기한다."""
    while True:
        resp = requests.get(f"{BASE_URL}/api/tasks/{task_id}", headers=HEADERS)
        resp.raise_for_status()
        task = resp.json()

        status = task["status"]
        progress = task.get("progress", 0)
        print(f"  [{status}] {progress:.1f}% - {task.get('message', '')}")

        if status in ("completed", "failed", "cancelled"):
            return task

        time.sleep(poll_interval)


# === 사용 예시 ===

# 1단계: 탐색
explore_result = explore_board(
    api_url="https://kevcs-ap.lbucess.com/api/board/6954e0c32008e6d0e2ea6a63",
    auth_token="YOUR_TOKEN_HERE",
)

# 2단계: 수집
if explore_result["success"]:
    task_id = ingest_board(
        api_url="https://kevcs-ap.lbucess.com/api/board/6954e0c32008e6d0e2ea6a63",
        field_mapping=explore_result["detected_mapping"],
        auth_token="YOUR_TOKEN_HERE",
        max_pages=1,
        process_images=False,
    )

    # 3단계: 완료 대기
    result = wait_for_task(task_id)
    print(f"\n완료: 처리={result['result']['total_processed']}, "
          f"스킵={result['result']['total_skipped']}, "
          f"에러={result['result']['total_errors']}")
```

### 8.2 NDJSON 스트리밍으로 실시간 진행률 수신

```python
import requests
import json


def stream_task_progress(task_id: str, workspace: str = "kevcs"):
    """NDJSON 스트리밍으로 태스크 진행률을 실시간 수신한다.

    서버가 30초마다 heartbeat를 보내므로 연결이 끊기지 않는다.
    태스크가 종료 상태(completed/failed/cancelled)가 되면 스트림이 자동 종료된다.
    """
    headers = {
        "LIGHTRAG-WORKSPACE": workspace,
        "Accept": "application/x-ndjson",
    }

    with requests.get(
        f"http://localhost:9422/api/tasks/{task_id}/stream",
        headers=headers,
        stream=True,  # 스트리밍 모드 필수
    ) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines(decode_unicode=True):
            if not line:
                continue
            event = json.loads(line)

            status = event.get("status")
            progress = event.get("progress", 0)
            message = event.get("message", "")

            # heartbeat는 무시 (detail 없음)
            if event.get("type") == "heartbeat":
                continue

            print(f"[{status}] {progress:.1f}% | {message}")

            # 상세 정보 출력
            detail = event.get("detail", {})
            if detail:
                print(f"  페이지: {detail.get('page', '-')}, "
                      f"처리: {detail.get('processed', 0)}, "
                      f"스킵: {detail.get('skipped', 0)}, "
                      f"에러: {detail.get('errors', 0)}")

            # 최종 결과
            if status in ("completed", "failed", "cancelled"):
                result = event.get("result", {})
                if result:
                    print(f"\n=== 최종 결과 ===")
                    print(json.dumps(result, indent=2, ensure_ascii=False))
                break


# 사용:
# stream_task_progress("5baec6a6-58fd-4574-9a16-6e259d35a481")
```

### 8.3 게시물 삭제

```python
def delete_board_items(api_url: str, item_ids: list, workspace: str = "kevcs") -> dict:
    """수집된 게시물을 지식그래프에서 완전 삭제한다.

    Args:
        api_url: 인제스트 시 사용한 동일 API URL (도메인 추출용)
        item_ids: 삭제할 원본 게시글 ID 목록
        workspace: 인제스트 시 사용한 동일 워크스페이스

    Returns:
        삭제 결과 (deleted_items, deleted_docs, not_found, errors)
    """
    headers = {
        "Content-Type": "application/json",
        "LIGHTRAG-WORKSPACE": workspace,
    }
    payload = {
        "api_url": api_url,
        "item_ids": item_ids,
    }

    resp = requests.post("http://localhost:9422/api/board/delete", headers=headers, json=payload)
    resp.raise_for_status()
    result = resp.json()

    print(f"삭제 완료: {result['deleted_items']}건 삭제, {result['deleted_docs']}개 청크 제거")
    if result["not_found"]:
        print(f"찾을 수 없음: {result['not_found']}")
    if result["errors"]:
        print(f"에러: {result['errors']}")

    return result


# 사용:
# delete_board_items(
#     api_url="https://kevcs-ap.lbucess.com/api/board",
#     item_ids=["6954e0c32008e6d0e2ea6a63"],
# )
```

### 8.4 전체 워크플로우 자동화 (탐색 → 수집 → 확인)

```python
def full_board_ingestion(
    api_url: str,
    workspace: str,
    auth_token: str = None,
    max_pages: int = 10,
    update_existing: bool = False,
):
    """탐색부터 수집 완료까지 전체 과정을 자동 수행한다.

    실무에서 가장 많이 사용하는 패턴. 스크립트 하나로 게시판 수집을 완료한다.
    """
    headers = {
        "Content-Type": "application/json",
        "LIGHTRAG-WORKSPACE": workspace,
    }
    api_headers = {}
    if auth_token:
        api_headers["Authorization"] = f"Bearer {auth_token}"

    # 1. 탐색
    print(f"=== 1단계: API 탐색 ===")
    explore_resp = requests.post(
        "http://localhost:9422/api/board/explore",
        headers=headers,
        json={"api_url": api_url, "headers": api_headers or None},
    )
    explore_resp.raise_for_status()
    explore = explore_resp.json()

    if not explore["success"]:
        print(f"탐색 실패: {explore.get('error')}")
        return None

    mapping = explore["detected_mapping"]
    print(f"감지 방식: {explore['detection_method']} (신뢰도: {explore.get('llm_confidence', 'N/A')})")
    print(f"아이템 수: {explore['detected_items_count']}")

    # 2. 수집
    print(f"\n=== 2단계: 수집 시작 ===")
    ingest_resp = requests.post(
        "http://localhost:9422/api/board/ingest",
        headers=headers,
        json={
            "api_url": api_url,
            "headers": api_headers or None,
            "field_mapping": mapping,
            "max_pages": max_pages,
            "skip_duplicates": not update_existing,
            "update_existing": update_existing,
        },
    )
    ingest_resp.raise_for_status()
    ingest = ingest_resp.json()
    task_id = ingest["task_id"]
    print(f"태스크 ID: {task_id}")

    # 3. 스트리밍으로 완료 대기
    print(f"\n=== 3단계: 진행률 모니터링 ===")
    stream_task_progress(task_id, workspace)

    return task_id


# 사용:
# full_board_ingestion(
#     api_url="https://api.example.com/board/posts",
#     workspace="my-workspace",
#     auth_token="YOUR_TOKEN",
#     max_pages=5,
# )
```

---

## 9. JavaScript/TypeScript 코드 예시

### 9.1 기본 수집 (fetch API)

```typescript
const BASE_URL = "http://localhost:9422";
const WORKSPACE = "kevcs";

// 공통 헤더 생성 함수
function getHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "LIGHTRAG-WORKSPACE": WORKSPACE,
  };
}

/** 외부 게시판 API를 탐색하여 필드 매핑을 자동 감지한다 */
async function exploreBoard(apiUrl: string, authToken?: string) {
  const payload: any = { api_url: apiUrl, method: "GET" };
  if (authToken) {
    payload.headers = { Authorization: `Bearer ${authToken}` };
  }

  const resp = await fetch(`${BASE_URL}/api/board/explore`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  return await resp.json();
}

/** 수집 태스크를 시작하고 task_id를 반환한다 */
async function ingestBoard(
  apiUrl: string,
  fieldMapping: Record<string, any>,
  options: {
    authToken?: string;
    maxPages?: number;
    pageSize?: number;
    processImages?: boolean;
    processTables?: boolean;
    skipDuplicates?: boolean;
    updateExisting?: boolean;
  } = {}
) {
  const payload: any = {
    api_url: apiUrl,
    method: "GET",
    field_mapping: fieldMapping,
    max_pages: options.maxPages ?? 50,
    page_size: options.pageSize ?? 20,
    process_images: options.processImages ?? true,
    process_tables: options.processTables ?? true,
    skip_duplicates: options.skipDuplicates ?? true,
    update_existing: options.updateExisting ?? false,
  };
  if (options.authToken) {
    payload.headers = { Authorization: `Bearer ${options.authToken}` };
  }

  const resp = await fetch(`${BASE_URL}/api/board/ingest`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  return await resp.json();
}

// === 사용 예시 ===
async function main() {
  // 1. 탐색
  const explore = await exploreBoard(
    "https://api.example.com/board/posts",
    "YOUR_TOKEN"
  );
  console.log("감지 결과:", explore);

  if (!explore.success) {
    console.error("탐색 실패:", explore.error);
    return;
  }

  // 2. 수집
  const ingest = await ingestBoard(
    "https://api.example.com/board/posts",
    explore.detected_mapping,
    { authToken: "YOUR_TOKEN", maxPages: 5 }
  );
  console.log("태스크 시작:", ingest.task_id);
}
```

### 9.2 NDJSON 스트리밍 수신

```typescript
/**
 * NDJSON 스트리밍으로 태스크 진행률을 실시간 수신한다.
 *
 * ReadableStream을 사용하여 서버에서 줄 단위로 이벤트를 파싱한다.
 * 브라우저와 Node.js(18+) 모두에서 동작한다.
 */
async function streamTaskProgress(
  taskId: string,
  onProgress: (event: any) => void,
  onComplete: (result: any) => void,
  onError: (error: string) => void
) {
  const resp = await fetch(`${BASE_URL}/api/tasks/${taskId}/stream`, {
    headers: {
      "LIGHTRAG-WORKSPACE": WORKSPACE,
      Accept: "application/x-ndjson",
    },
  });

  if (!resp.ok || !resp.body) {
    onError(`HTTP ${resp.status}: ${resp.statusText}`);
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // 마지막 불완전한 줄은 버퍼에 유지

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);

        // heartbeat 무시
        if (event.type === "heartbeat") continue;

        onProgress(event);

        // 종료 상태 처리
        if (["completed", "failed", "cancelled"].includes(event.status)) {
          if (event.status === "completed") {
            onComplete(event.result || {});
          } else {
            onError(`태스크 ${event.status}: ${event.message || ""}`);
          }
          return;
        }
      } catch (e) {
        console.warn("NDJSON 파싱 오류:", line);
      }
    }
  }
}

// === 사용 예시 ===
// streamTaskProgress(
//   "5baec6a6-58fd-4574-9a16-6e259d35a481",
//   (event) => console.log(`[${event.status}] ${event.progress}% - ${event.message}`),
//   (result) => console.log("완료:", result),
//   (error) => console.error("에러:", error)
// );
```

### 9.3 게시물 삭제 및 원문 조회

```typescript
/** 수집된 게시물을 지식그래프에서 완전 삭제한다 */
async function deleteBoardItems(apiUrl: string, itemIds: string[]) {
  const resp = await fetch(`${BASE_URL}/api/board/delete`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ api_url: apiUrl, item_ids: itemIds }),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  const result = await resp.json();

  console.log(`삭제 완료: ${result.deleted_items}건, 청크 ${result.deleted_docs}개 제거`);
  if (result.not_found.length > 0) {
    console.warn("찾을 수 없음:", result.not_found);
  }
  return result;
}

/** 수집된 게시물의 원본 내용을 조회한다 */
async function viewBoardPost(filePath: string) {
  const resp = await fetch(`${BASE_URL}/api/board/view`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ file_path: filePath }),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  const result = await resp.json();

  if (result.success) {
    console.log(`제목: ${result.title}`);
    console.log(`작성자: ${result.author} | 날짜: ${result.date}`);
    console.log(`본문 길이: ${result.body.length}자`);
    console.log(`첨부파일: ${result.attachments.length}개`);
  } else {
    console.error("조회 실패:", result.error);
  }
  return result;
}

// === 사용 예시 ===
// await deleteBoardItems(
//   "https://kevcs-ap.lbucess.com/api/board",
//   ["6954e0c32008e6d0e2ea6a63"]
// );
//
// await viewBoardPost(
//   "https://kevcs-ap.lbucess.com/api/board/6954e0c32008e6d0e2ea6a63"
// );
```

### 9.4 React 컴포넌트에서 활용 (프론트엔드 통합)

```typescript
import { useState, useCallback } from "react";

/**
 * Board 수집 상태를 관리하는 커스텀 훅.
 * BoardIngestDialog.tsx에서 사용하는 패턴과 동일하다.
 */
function useBoardIngestion(workspace: string) {
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>("");

  const startIngestion = useCallback(
    async (apiUrl: string, fieldMapping: any, options?: any) => {
      setIsLoading(true);
      setProgress(0);
      setStatus("수집 시작 중...");

      try {
        // 수집 태스크 시작
        const ingestResult = await ingestBoard(apiUrl, fieldMapping, options);
        const taskId = ingestResult.task_id;

        // NDJSON 스트리밍으로 진행률 수신
        await streamTaskProgress(
          taskId,
          (event) => {
            setProgress(event.progress || 0);
            setStatus(event.message || "");
          },
          (result) => {
            setProgress(100);
            setStatus(
              `완료: ${result.total_processed}건 처리, ` +
              `${result.total_skipped}건 스킵, ` +
              `${result.total_errors}건 에러`
            );
          },
          (error) => setStatus(`에러: ${error}`)
        );
      } finally {
        setIsLoading(false);
      }
    },
    [workspace]
  );

  return { isLoading, progress, status, startIngestion };
}
```

---

## 10. 비동기 태스크 모니터링

### 10.1 태스크 상태 조회

```bash
curl -s 'http://localhost:9422/api/tasks/<task_id>' \
  -H 'LIGHTRAG-WORKSPACE: kevcs'
```

### 10.2 NDJSON 실시간 스트리밍

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

### 10.3 태스크 취소

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

## 11. 에러 응답 레퍼런스

각 엔드포인트별 발생 가능한 에러 상황과 응답 형태를 정리한다.

### 11.1 explore 에러

| 상황 | HTTP 코드 | 응답 |
|------|-----------|------|
| 외부 API 접근 불가 (DNS/네트워크) | 200 | `{"success": false, "error": "API 호출 실패: ..."}` |
| 외부 API 인증 실패 | 200 | `{"success": false, "error": "API returned 401"}` |
| 응답에서 배열 없음 | 200 | `{"success": false, "error": "응답에서 아이템 배열을 찾을 수 없습니다"}` |
| 수동 매핑 검증 실패 | 200 | `{"success": false, "error": "items_path 'data.items'에 해당하는 배열이 없습니다"}` |
| RAG 워크스페이스 미설정 | 500 | `{"detail": "RAG workspace getter not configured"}` |

> **참고:** explore는 외부 API 에러를 HTTP 200으로 감싸서 반환한다. `success` 필드로 성공/실패를 판단해야 한다.

### 11.2 ingest 에러

| 상황 | HTTP 코드 | 응답 |
|------|-----------|------|
| field_mapping 누락 | 422 | `{"detail": [{"msg": "field required", "type": "value_error.missing"}]}` |
| 유효하지 않은 pagination_type | 422 | `{"detail": [{"msg": "..."}]}` |
| RAG 초기화 실패 | 500 | `{"detail": "..."}` |

태스크 내부 에러는 태스크 결과의 `errors` 배열에 기록된다:

```json
{
  "status": "completed",
  "result": {
    "success": false,
    "total_processed": 8,
    "total_errors": 2,
    "errors": [
      "게시물 abc123 처리 실패: VLM 서비스 응답 없음",
      "게시물 def456 처리 실패: 첨부파일 다운로드 타임아웃"
    ]
  }
}
```

### 11.3 delete 에러

| 상황 | HTTP 코드 | 응답 |
|------|-----------|------|
| api_url 누락 | 422 | `{"detail": [{"msg": "field required"}]}` |
| item_ids 빈 배열 | 422 | `{"detail": [{"msg": "..."}]}` |
| 문서 없음 (정상) | 200 | `{"deleted_items": 0, "not_found": ["id1"], "errors": []}` |
| KG 삭제 중 에러 | 200 | `{"deleted_items": 0, "errors": ["삭제 실패: ..."]}`  |

### 11.4 view 에러

| 상황 | HTTP 코드 | 응답 |
|------|-----------|------|
| 잘못된 URL 형식 | 200 | `{"success": false, "error": "Invalid URL"}` |
| item_id 추출 불가 | 200 | `{"success": false, "error": "Cannot extract item ID from URL"}` |
| 매칭 태스크 없음 | 200 | `{"success": false, "error": "No matching board ingestion task found for this URL"}` |
| 인증 만료 (401/403) | 200 | `{"success": false, "error": "인증이 만료되었거나 API에 접근할 수 없습니다: 401"}` |
| API 타임아웃 | 200 | `{"success": false, "error": "API request timed out"}` |
| 기타 API 에러 | 200 | `{"success": false, "error": "API request failed: 500"}` |

---

## 12. 프론트엔드 UI 사용법

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

## 13. 트러블슈팅

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
  "SELECT id, file_path, doc_nm FROM lightrag_doc_status WHERE file_path LIKE '%/api/board/%' LIMIT 10;"
```

### Q: 페이지네이션이 무한 루프에 빠져요

- `max_pages`를 적절히 설정하세요 (기본 50)
- `total_field`를 정확히 지정하면 전체 건수 기반으로 종료됩니다
- 마지막 페이지에 빈 배열이 반환되지 않는 API의 경우, 아이템 수 < `page_size` 조건으로 종료됩니다
- 중복 페이지 감지 기능이 있어 동일 데이터가 반복되면 자동 중단됩니다

### Q: 첨부파일 이미지가 처리되지 않아요

1. **VLM 서비스 확인:** VLM 서버(`VLM_API_BASE` 환경변수)가 실행 중인지 확인하세요.
2. **`process_images=true` 확인:** 기본값이 `true`이지만, 이전에 `false`로 수집했다면 명시적으로 `true`를 설정하세요.
3. **`base_url` 설정:** 첨부파일 URL이 상대경로(`/files/img.jpg`)인 경우 `base_url`을 지정해야 합니다.
4. **`attachment_url_field` 확인:** 첨부파일 객체의 URL 키가 비표준이면 명시적으로 지정하세요.

```json
{
  "base_url": "https://board.example.com",
  "field_mapping": {
    "attachments_field": "fileList",
    "attachment_url_field": "streFileNm",
    "attachment_name_field": "orignlFileNm"
  }
}
```

### Q: view API에서 "No matching board ingestion task found" 에러

1. **워크스페이스 확인:** 인제스트 시 사용한 워크스페이스와 동일한 `LIGHTRAG-WORKSPACE` 헤더를 사용하세요.
2. **태스크 존재 여부:** 서버 재시작 후 72시간 이내의 태스크만 DB에서 자동 로드됩니다. 오래된 태스크는 조회되지 않을 수 있습니다.
3. **api_url 매칭:** view는 `file_path`에서 추출한 도메인/경로와 태스크의 `api_url`을 비교합니다. 인제스트 시 사용한 URL과 경로가 일치해야 합니다.

### Q: 커스텀 프롬프트가 적용되지 않아요

`document_prompt`, `image_prompt`, `table_prompt`는 멀티모달 처리가 활성화된 경우에만 적용됩니다:

- `image_prompt` → `process_images=true` 필요
- `table_prompt` → `process_tables=true` 필요
- `document_prompt` → `process_documents=true` 필요

```json
{
  "process_images": true,
  "image_prompt": "이 이미지를 분석하세요...",
  "process_tables": true,
  "table_prompt": "이 테이블의 데이터를 추출하세요..."
}
```

### Q: 수집 속도가 느려요

- **이미지/문서 처리 비활성화:** VLM/파서 호출이 병목이 됩니다. 텍스트만 필요하면 `process_images=false`, `process_documents=false`로 설정하세요.
- **페이지 크기 증가:** `page_size`를 늘려 API 호출 횟수를 줄이세요 (외부 API가 지원하는 범위 내).
- **`fetch_detail=false`:** 목록 API에 본문이 포함되어 있다면 상세 호출을 비활성화하세요.
- **파서 선택:** `parser="pymupdf"`가 `"docling"`보다 빠릅니다 (CPU만 사용, GPU 불필요).
