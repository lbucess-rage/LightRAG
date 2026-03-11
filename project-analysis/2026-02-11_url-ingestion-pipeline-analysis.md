# LightRAG URL Knowledge Ingestion 파이프라인 분석

> 분석일: 2026-02-11 (최종 수정: 2026-02-11)
> 대상: URL 콘텐츠 추출 및 지식그래프 변환 파이프라인
> 분석 범위: `lightrag/url/`, `lightrag/api/routers/url_routes.py`, `lightrag/multimodal/processors/image.py`, `lightrag_webui/src/components/documents/URLIngestDialog.tsx`

---

## 목차

1. [시스템 개요](#1-시스템-개요)
2. [아키텍처](#2-아키텍처)
3. [백엔드 모듈 상세](#3-백엔드-모듈-상세)
4. [API 엔드포인트](#4-api-엔드포인트)
5. [7단계 처리 파이프라인](#5-7단계-처리-파이프라인)
6. [프론트엔드 UI](#6-프론트엔드-ui)
7. [환경설정](#7-환경설정)
8. [데이터 흐름 다이어그램](#8-데이터-흐름-다이어그램)
9. [주요 관찰 사항 및 개선 포인트](#9-주요-관찰-사항-및-개선-포인트)
10. [버그 수정 이력](#10-버그-수정-이력)

---

## 1. 시스템 개요

URL Knowledge Ingestion은 웹 페이지 URL을 입력받아 콘텐츠를 추출하고, 텍스트/이미지/테이블 등 멀티모달 콘텐츠를 지식그래프로 변환하는 비동기 파이프라인이다.

### 핵심 특성

| 특성 | 설명 |
|------|------|
| **비동기 처리** | API 즉시 응답 → 백그라운드 처리 → NDJSON 스트리밍 진행률 |
| **멀티모달 통합** | 텍스트 + 이미지(VLM) + 테이블(LLM) 동시 처리 |
| **재귀 크롤링** | 링크 추적으로 관련 페이지 자동 수집 (depth 제어) |
| **배치 처리** | 다수 URL 동시 제출, 개별 태스크로 병렬 처리 |
| **중복 감지** | URL 정규화 기반 doc_id로 중복 문서 방지 |
| **워크스페이스 격리** | LIGHTRAG-WORKSPACE 헤더 기반 멀티테넌트 |

---

## 2. 아키텍처

### 2.1 모듈 구조

```
lightrag/url/                        ← 코어 모듈
├── __init__.py                      ← 패키지 export
├── config.py                        ← URLIngestConfig (환경변수 기반)
├── detector.py                      ← URL 검증/정규화/추출
├── fetcher.py                       ← HTTP 비동기 페칭 (httpx + 재시도)
└── parser.py                        ← HTML 파싱 (BeautifulSoup)

lightrag/api/routers/
└── url_routes.py                    ← FastAPI 엔드포인트 + 백그라운드 처리 로직

lightrag_webui/src/
├── api/lightrag.ts                  ← TypeScript API 클라이언트
├── components/documents/
│   └── URLIngestDialog.tsx          ← URL 입력 다이얼로그 (단건/배치)
└── features/
    └── DocumentManager.tsx          ← URL 다이얼로그 통합
```

### 2.2 의존 관계

```
URLIngestDialog (Frontend)
    │
    ▼
url_routes.py (API Layer)
    │
    ├── url/detector.py    → URL 검증
    ├── url/fetcher.py     → HTTP 페칭
    ├── url/parser.py      → HTML 파싱
    │
    ├── task_manager.py    → 태스크 생성/진행률/완료
    ├── rag.ainsert()      → 텍스트 → 지식그래프
    │
    └── multimodal/
        ├── ImageModalProcessor  → 이미지 → VLM → 엔티티
        └── TableModalProcessor  → 테이블 → LLM → 엔티티
```

---

## 3. 백엔드 모듈 상세

### 3.1 URLIngestConfig (`url/config.py`)

환경변수 기반 설정. 모든 값은 기본값이 있어 무설정 실행 가능.

| 설정 | 기본값 | 환경변수 | 설명 |
|------|--------|---------|------|
| `fetch_timeout` | 30초 | `URL_FETCH_TIMEOUT` | HTTP 요청 타임아웃 |
| `fetch_max_retries` | 3 | `URL_FETCH_MAX_RETRIES` | 재시도 횟수 |
| `extract_images` | True | - | 이미지 추출 활성화 |
| `extract_tables` | True | - | 테이블 추출 활성화 |
| `download_images` | True | - | 이미지 다운로드 (VLM 처리용) |
| `max_image_size_mb` | 10.0 | - | 이미지 최대 크기 |
| `min_text_length` | 50 | - | 유효 판정 최소 텍스트 길이 |
| `max_images` | 20 | - | 페이지당 추출 이미지 수 |
| `max_tables` | 10 | - | 페이지당 추출 테이블 수 |
| `max_text_chunk_size` | 2000 | `URL_MAX_TEXT_CHUNK_SIZE` | 텍스트 청크 크기 |
| `max_crawl_depth` | 2 | `URL_MAX_CRAWL_DEPTH` | 재귀 크롤링 최대 깊이 |
| `max_crawl_urls` | 10 | `URL_MAX_CRAWL_URLS` | 페이지당 크롤링 대상 URL 수 |
| `crawl_same_domain_only` | True | - | 동일 도메인만 크롤링 |

### 3.2 URLDetector (`url/detector.py`)

URL 검증, 정규화, 텍스트에서 URL 추출을 담당.

**핵심 클래스/메서드:**

```python
@dataclass
class URLInfo:
    url: str              # 원본 URL
    normalized_url: str   # 정규화 URL (소문자 scheme/netloc, 후행 슬래시 제거)
    scheme: str           # http/https
    netloc: str           # 도메인 + 포트
    path: str             # 경로
    is_valid: bool        # 유효성
    domain: str           # 도메인 (www 접두사 제거)

class URLDetector:
    is_valid(url) -> bool          # 구문 + 스킴 검증, 제외 확장자 필터
    extract(text) -> List[str]     # 텍스트에서 URL 추출 (정규식)
    normalize(url) -> Optional[str]  # URL 정규화
    get_info(url) -> URLInfo       # 상세 정보 반환
    resolve_relative(base, rel)    # 상대 URL → 절대 URL
    is_same_domain(url1, url2)     # 동일 도메인 판정
```

**제외 확장자:** `.pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx, .zip, .rar, .7z, .tar, .gz, .mp3, .mp4, .avi, .mov, .wmv, .exe, .dmg, .apk`

### 3.3 WebFetcher (`url/fetcher.py`)

httpx 기반 비동기 HTTP 클라이언트. 지수 백오프 재시도 내장.

```python
@dataclass
class FetchResult:
    success: bool
    url: str
    content: str            # HTML/텍스트 내용
    content_type: str       # Content-Type 헤더
    status_code: int
    error_message: str
    metadata: Dict          # final_url (리다이렉트 후), headers

class WebFetcher:
    fetch(url) -> FetchResult     # HTML 페칭 (재시도 포함)
    fetch_bytes(url) -> tuple     # 바이너리 페칭 (이미지용, 재시도 없음)
```

**기본 HTTP 헤더:**
- User-Agent: Chrome 120.0.0.0 (Windows)
- Accept-Language: ko-KR, en-US
- 리다이렉트 자동 추적

**재시도 전략:**
- 지수 백오프: `2^attempt`초 대기 (1차: 2초, 2차: 4초, 3차: 8초)
- 타임아웃/연결 오류만 재시도 (HTTP 에러 코드는 재시도 안 함)

### 3.4 HTMLParser (`url/parser.py`)

BeautifulSoup 기반 HTML 구조화 파싱. lxml 우선, html.parser 폴백.

**데이터 모델:**

```python
@dataclass
class ExtractedImage:
    src: str        # 절대 URL
    alt: str        # alt 텍스트
    title: str      # title 속성
    context: str    # 주변 텍스트 (figcaption, 형제 요소)

@dataclass
class ExtractedTable:
    html: str           # 원본 HTML
    markdown: str       # 마크다운 변환
    caption: str        # 테이블 캡션
    headers: List[str]  # 컬럼 헤더
    rows: List[List[str]]  # 데이터 행

@dataclass
class ExtractedLink:
    url: str            # 절대 URL
    text: str           # 링크 텍스트 (최대 200자)
    is_internal: bool   # 내부/외부 분류

@dataclass
class ParsedContent:
    url: str
    title: str          # <title> → og:title → <h1>
    main_text: str      # 본문 텍스트
    description: str    # meta description → og:description
    images: List[ExtractedImage]
    tables: List[ExtractedTable]
    links: List[ExtractedLink]
    metadata: Dict      # 카운트 정보
```

**본문 추출 전략:**
1. 노이즈 태그 제거: `script, style, noscript, iframe, svg, canvas, video, audio, form, nav, footer, header, aside`
2. 메인 콘텐츠 영역 탐색: `article → main → [role="main"] → .content → #content`
3. 블록 레벨 태그에서 줄바꿈 보존: `p, div, h1-h6, li, tr, br, hr, blockquote, pre`
4. 공백 정규화 및 다중 줄바꿈 정리

**이미지 필터링:**
- `data:` URL 제외
- SVG 제외
- 50px 미만 작은 이미지 제외
- 최대 `max_images` × 2 탐색 후 상위 `max_images`개 반환

---

## 4. API 엔드포인트

### 4.1 라우트 등록

`lightrag_server.py`에서 등록:

```python
from lightrag.api.routers.url_routes import (
    create_url_routes,
    set_rag_workspace_getter as set_url_rag_workspace_getter,
    set_vlm_model_func as set_url_vlm_model_func,
    set_llm_model_func as set_url_llm_model_func,
)

set_url_rag_workspace_getter(get_rag_for_workspace)
app.include_router(create_url_routes())
set_url_vlm_model_func(vlm_model_func)
set_url_llm_model_func(llm_model_func)
```

### 4.2 엔드포인트 목록

| 메서드 | 경로 | 설명 | 워크스페이스 |
|--------|------|------|:----------:|
| POST | `/api/url/validate` | URL 검증 및 정규화 | O |
| POST | `/api/url/extract` | 텍스트에서 URL 추출 | X |
| POST | `/api/url/ingest` | 단건 URL 수집 (비동기) | O |
| POST | `/api/url/ingest-batch` | 배치 URL 수집 (비동기) | O |

### 4.3 요청/응답 모델

#### POST `/api/url/validate`

```python
# Request
class URLValidateRequest:
    url: str

# Response
class URLValidateResponse:
    valid: bool
    normalized_url: str = ""
    domain: str = ""
    doc_id: str = ""    # MD5(normalized_url)[:16]
```

#### POST `/api/url/extract`

```python
# Request
class URLExtractRequest:
    text: str           # URL이 포함된 텍스트

# Response
class URLExtractResponse:
    urls: List[str]     # 추출된 유효 URL 목록
```

#### POST `/api/url/ingest`

```python
# Request
class URLIngestRequest:
    url: str
    file_path_label: Optional[str] = None   # 커스텀 문서 라벨
    process_images: bool = True
    process_tables: bool = True
    skip_duplicates: bool = True
    force_reindex: bool = False             # 재처리 강제
    follow_links: bool = False              # 크롤링 활성화
    max_depth: int = 2

# Response
class URLIngestAsyncResponse:
    task_id: str
    stream_url: str     # /api/tasks/{task_id}/stream
    message: str
```

#### POST `/api/url/ingest-batch`

```python
# Request
class URLBatchIngestRequest:
    urls: List[str]
    process_images: bool = True
    process_tables: bool = True
    skip_duplicates: bool = True
    force_reindex: bool = False
    follow_links: bool = False
    max_depth: int = 2

# Response
class URLBatchIngestResponse:
    tasks: List[URLBatchTaskInfo]       # 제출된 태스크 목록
    skipped: List[URLBatchSkippedInfo]  # 건너뛴 URL 목록
    total_submitted: int
    total_skipped: int
```

---

## 5. 7단계 처리 파이프라인

`_ingest_url_background()` 함수에서 실행되는 비동기 처리 단계.

### 전체 흐름

```
Phase 1 [0-5%]     URL 검증
    │
Phase 2 [10-25%]   HTML 페칭 (httpx + 재시도)
    │
Phase 3 [25-40%]   HTML 파싱 (텍스트/이미지/테이블/링크 추출)
    │
Phase 4 [40-60%]   텍스트 청크 → KG 삽입 (rag.ainsert)
    │
Phase 5 [60-95%]   멀티모달 처리 (이미지→VLM, 테이블→LLM)
    │
Phase 6 [95-98%]   서브 URL 크롤링 (재귀, 옵션)
    │
Phase 7 [98-100%]  완료 및 결과 집계
```

### Phase 1: URL 검증 (0% → 5%)

- URLDetector로 URL 형식 검증
- 태스크 취소 상태 확인

### Phase 2: HTML 페칭 (10% → 25%)

- WebFetcher로 HTTP GET 요청
- 설정된 timeout/max_retries 적용
- 실패 시 `fail_task()` 호출 후 종료
- 성공 시 content length 리포트

### Phase 3: HTML 파싱 (25% → 40%)

- HTMLParser로 구조화된 콘텐츠 추출
  - title, description, main_text
  - images (설정에 따라)
  - tables (설정에 따라)
  - links (`follow_links=true` && `current_depth < max_depth`일 때만)
- 최소 텍스트 길이 검증 (`min_text_length`)
- 실패 시 `fail_task()` 호출

### Phase 4: 텍스트 삽입 (40% → 60%)

1. **텍스트 조합**: `제목 + 설명 + 본문` 결합
2. **청크 분할**: `_chunk_text()` 함수
   - 단락 단위(더블 줄바꿈) 우선 분할
   - 단락이 `max_text_chunk_size` 초과 시 문장 단위 분할
3. **KG 삽입**: 각 청크마다 `rag.ainsert()` 호출
   - `file_paths=file_label` (중복 감지용)
4. **진행률**: 청크별로 진행률 업데이트

### Phase 5: 멀티모달 처리 (60% → 95%)

**초기화:**
- MultimodalConfig 생성
- ImageModalProcessor (VLM 함수 필요)
- TableModalProcessor (LLM 함수 필요)

**이미지 처리 (process_images=true):**

URL 라우트에서 이미지를 다운로드하고 base64로 인코딩하여 `img_data` 키로 전달합니다.
ImageModalProcessor는 `img_data`(인라인 base64)와 `img_path`(파일 경로) 두 가지 입력을 모두 지원합니다.

```
URL 라우트: img_data(base64) + alt + context
    ↓
generate_description_only:
    img_data 있음 → image_base64 직접 사용 (파일 I/O 스킵)
    img_path 있음 → 파일에서 읽어 base64 변환 (기존 문서 파싱 경로)
    alt → captions, context → footnotes (자동 키 매핑)
    → VLM 호출 → 이미지 설명 + 엔티티 정보 생성
    ↓
process_multimodal_content:
    img_data → _upload_base64_image_to_s3 → S3 URL (임시 파일 → 업로드 → 삭제)
    img_path → _upload_image_to_s3 → S3 URL (기존 경로)
    alt → captions, context → footnotes
    → structured_content 생성 → KG 엔티티/청크 저장
```

**테이블 처리 (process_tables=true):**
```
테이블 HTML/Markdown
    → TableModalProcessor.process_multimodal_content()
    → 엔티티/관계 생성
```

**에러 처리:** 개별 이미지/테이블 실패는 기록만 하고 태스크 전체를 실패시키지 않음

### Phase 6: 서브 URL 크롤링 (95% → 98%)

`follow_links=true` && `current_depth < max_depth`일 때만 실행.

```
추출된 링크 목록
    → 내부 링크만 필터 (crawl_same_domain_only)
    → max_crawl_urls개까지
    → 각 링크:
        ├── URL 검증
        ├── 중복 체크
        ├── 자식 태스크 생성 (TaskType.URL_INGEST)
        └── _ingest_url_background(current_depth+1) 재귀 호출
```

### Phase 7: 완료 (98% → 100%)

최종 결과 집계:

```python
final_result = {
    "success": bool,          # 에러 없으면 True
    "url": str,               # 원본 URL
    "title": str,             # 페이지 제목
    "text_length": int,       # 텍스트 길이
    "image_count": int,       # 이미지 수
    "table_count": int,       # 테이블 수
    "results": [              # 항목별 처리 결과
        {"type": "image", "success": bool, "entity_name": str},
        {"type": "table", "success": bool, "entity_name": str},
    ],
    "spawned_tasks": [...],   # 크롤링으로 생성된 자식 태스크
    "crawl_depth": int        # 현재 크롤링 깊이
}
```

`service.complete_task(task_id, result=final_result)` 호출.

---

## 6. 프론트엔드 UI

### 6.1 URLIngestDialog 컴포넌트

`lightrag_webui/src/components/documents/URLIngestDialog.tsx`

**구성:**
- **탭 1 - 단건 URL**: 입력 필드 + 검증 버튼 + 결과 표시 + 수집 버튼
- **탭 2 - 배치 URL**: 텍스트 영역 (줄바꿈 구분) + 건너뛴 URL 표시

**공통 옵션:**

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| 이미지 처리 | ✓ | VLM으로 이미지 분석 |
| 테이블 처리 | ✓ | LLM으로 테이블 분석 |
| 중복 건너뛰기 | ✓ | 이미 수집된 URL 스킵 |
| 서브링크 크롤링 | ✗ | 페이지 내 링크 재귀 추적 |
| 최대 깊이 | 2 | 크롤링 깊이 (1-3) |

**처리 흐름:**

```
1. URL 입력 → "검증" 클릭
   → POST /api/url/validate
   → 결과: ✓ 도메인 + doc_id / ✗ 오류 메시지

2. "수집 시작" 클릭
   → POST /api/url/ingest (또는 /ingest-batch)
   → task_id 수신
   → TaskProgressPanel 표시 (NDJSON 스트리밍)

3. 완료 시
   → onDocumentsUploaded() 콜백 → 문서 목록 갱신
   → "닫기" 버튼 활성화
```

### 6.2 API 클라이언트

`lightrag_webui/src/api/lightrag.ts` (라인 1396-1465)

```typescript
// 검증
export const validateUrl = async (url: string): Promise<URLValidateResponse>

// 단건 수집
export const ingestUrl = async (request: URLIngestRequest): Promise<URLIngestResponse>

// 배치 수집
export const ingestUrlBatch = async (request: URLBatchIngestRequest): Promise<URLBatchIngestResponse>
```

모든 함수는 `axiosInstance` 사용 → LIGHTRAG-WORKSPACE 헤더 자동 주입.

### 6.3 DocumentManager 통합

`lightrag_webui/src/features/DocumentManager.tsx`에서:

```tsx
<URLIngestDialog onDocumentsUploaded={fetchDocuments} />
```

기존 업로드 버튼들(파일 업로드, 멀티모달 업로드) 옆에 배치.

### 6.4 국제화

`en.json`, `ko.json`의 `documentPanel.urlIngest` 네임스페이스에 모든 UI 텍스트 정의.

---

## 7. 환경설정

### 7.1 환경변수

| 환경변수 | 기본값 | 설명 |
|---------|--------|------|
| `URL_FETCH_TIMEOUT` | 30 | HTTP 타임아웃 (초) |
| `URL_FETCH_MAX_RETRIES` | 3 | 재시도 횟수 |
| `URL_MAX_TEXT_CHUNK_SIZE` | 2000 | 텍스트 청크 크기 |
| `URL_MAX_CRAWL_DEPTH` | 2 | 최대 크롤링 깊이 |
| `URL_MAX_CRAWL_URLS` | 10 | 페이지당 크롤링 URL 수 |

### 7.2 멀티모달 연동 설정

이미지/테이블 처리는 기존 멀티모달 모듈과 동일한 설정을 공유:

| 환경변수 | 설명 |
|---------|------|
| `VLM_MODEL` | VLM 모델명 (이미지 분석) |
| `VLM_API_BASE` | VLM API 주소 |
| `VLM_API_KEY` | VLM API 키 |
| `VLM_RESPONSE_LANGUAGE` | VLM 응답 언어 |

---

## 8. 데이터 흐름 다이어그램

### 8.1 단건 URL 수집

```
사용자 (브라우저)
    │
    ├── [1] POST /api/url/validate ──────────────────────────────────────┐
    │       ← { valid, normalized_url, domain, doc_id }                  │
    │                                                                     │
    ├── [2] POST /api/url/ingest ────────────────────────────────────────┤
    │       ← { task_id, stream_url, message }                           │
    │                                                                     │  서버
    ├── [3] GET /api/tasks/{task_id}/stream (NDJSON) ◀───────────────────┤
    │       ← { progress, message, detail } (반복)                       │
    │       ← { progress: 100, status: "completed", result: {...} }      │
    │                                                                     │
    └── [4] 문서 목록 갱신                                                │
                                                                          │
                                        백그라운드 파이프라인 ◀──────────┘
                                            │
                                            ├── URLDetector.validate()
                                            ├── WebFetcher.fetch()
                                            ├── HTMLParser.parse()
                                            ├── rag.ainsert() × N 청크
                                            ├── ImageModalProcessor × M
                                            ├── TableModalProcessor × K
                                            └── 서브 URL 크롤링 (옵션)
```

### 8.2 배치 URL 수집

```
사용자 (브라우저)
    │
    ├── POST /api/url/ingest-batch ──────────────────────────────────────┐
    │       { urls: [url1, url2, ...url_n] }                             │
    │       ← { tasks: [{task_id, url}, ...], skipped: [...] }           │
    │                                                                     │
    ├── GET /api/tasks/{task_id_1}/stream ◀──────┐                       │
    ├── GET /api/tasks/{task_id_2}/stream ◀──────┤  병렬 스트리밍         │
    └── GET /api/tasks/{task_id_n}/stream ◀──────┘                       │
                                                                          │
                                        백그라운드 ◀─────────────────────┘
                                            │
                                            ├── Task 1: 7단계 파이프라인
                                            ├── Task 2: 7단계 파이프라인
                                            └── Task N: 7단계 파이프라인
                                                  (독립 병렬 실행)
```

### 8.3 재귀 크롤링

```
메인 URL (depth=0)
    │
    ├── 텍스트/이미지/테이블 처리
    │
    ├── 링크 추출 ─── [내부 링크만, max_crawl_urls개]
    │   │
    │   ├── 서브 URL 1 (depth=1) ── 자식 태스크 생성
    │   │       ├── 텍스트/이미지/테이블 처리
    │   │       └── 링크 추출 → 서브 URL (depth=2) ── 자식 태스크 생성
    │   │                           └── 처리 (depth=max, 크롤링 중단)
    │   │
    │   ├── 서브 URL 2 (depth=1) ── 자식 태스크 생성
    │   │       └── ...
    │   └── ...
    │
    └── 완료 (spawned_tasks 목록 포함)
```

---

## 9. 주요 관찰 사항 및 개선 포인트

### 9.1 잘 설계된 부분

1. **모듈 분리가 명확**: detector/fetcher/parser/routes가 각각 단일 책임
2. **비동기 + 스트리밍**: 긴 처리를 블로킹하지 않고 실시간 진행률 제공
3. **점진적 에러 처리**: 이미지/테이블 실패가 전체 태스크를 중단시키지 않음
4. **중복 방지 체계**: URL 정규화 → MD5 doc_id → DB 조회 3단계
5. **재귀 크롤링 안전장치**: 깊이 제한 + 동일 도메인 필터 + URL 수 제한
6. **멀티모달 통합**: 기존 ImageModalProcessor/TableModalProcessor 재사용

### 9.2 해결된 이슈

| 이슈 | 원인 | 수정 내용 | 수정일 |
|------|------|----------|--------|
| **URL 이미지 VLM 미호출** | `img_data`(base64) 키를 `img_path`(파일경로)로만 처리 | `img_data` 직접 사용 분기 추가 | 2026-02-11 |
| **alt/context 미전달** | URL의 `alt`/`context` 키가 프로세서의 `image_caption`/`image_footnote`와 불일치 | 자동 키 매핑 추가 | 2026-02-11 |
| **base64 이미지 S3 업로드 불가** | `_upload_image_to_s3()`가 파일 경로만 지원 | `_upload_base64_image_to_s3()` 메서드 추가 | 2026-02-11 |

상세 내용은 [섹션 10. 버그 수정 이력](#10-버그-수정-이력) 참조.

### 9.3 잠재적 개선 포인트

| 영역 | 현재 상태 | 개선 방향 |
|------|----------|----------|
| **robots.txt** | 미확인 | 크롤링 전 robots.txt 준수 로직 추가 |
| **속도 제한** | 미구현 | 동일 도메인 동시 요청 수 제한 (rate limiter) |
| **JavaScript 렌더링** | 미지원 | SPA/동적 콘텐츠는 추출 불가 (Playwright 등 필요) |
| **PDF 등 바이너리** | 제외됨 | 확장자 필터에서 제외 (별도 파이프라인 필요) |
| **크롤링 중복** | 배치 내 검사만 | 크롤링 중 발견된 URL 간 전역 중복 검사 미비 |
| **메모리** | 전체 HTML 메모리 로드 | 초대형 페이지 대응 스트리밍 파싱 검토 |
| **retry 범위** | 타임아웃/연결만 | HTTP 429 (Rate Limit) 등 특정 상태 코드 재시도 추가 |

### 9.4 태스크 관리 연동

- `TaskType.URL_INGEST`로 등록됨
- 기존 `TaskType.MULTIMODAL_PROCESS`와 동일한 진행률 스트리밍 인프라 공유
- 프론트엔드 `TaskProgressPanel` 컴포넌트로 실시간 표시
- `/api/tasks/{id}/cancel`로 진행 중 취소 가능

### 9.5 파일 소스 참조

| 파일 | 핵심 역할 |
|------|----------|
| `lightrag/url/config.py` | 설정 클래스 |
| `lightrag/url/detector.py` | URL 검증/정규화/추출 |
| `lightrag/url/fetcher.py` | HTTP 비동기 페칭 |
| `lightrag/url/parser.py` | HTML 파싱 + 콘텐츠 추출 |
| `lightrag/api/routers/url_routes.py` | API 엔드포인트 + 백그라운드 파이프라인 |
| `lightrag/api/task_manager.py` | 태스크 생성/진행률/완료 |
| `lightrag/api/lightrag_server.py:84-89,1251,1304-1306` | 라우트 등록 |
| `lightrag_webui/src/api/lightrag.ts:1396-1465` | API 클라이언트 |
| `lightrag/multimodal/processors/image.py` | 이미지 VLM 처리 (URL base64 지원 추가) |
| `lightrag/multimodal/base.py` | 멀티모달 프로세서 베이스 클래스 |
| `lightrag_webui/src/components/documents/URLIngestDialog.tsx` | UI 다이얼로그 |
| `lightrag_webui/src/features/DocumentManager.tsx` | UI 통합 |

---

## 10. 버그 수정 이력

### 10.1 URL 이미지 지식화 실패 (2026-02-11)

**증상:** URL 수집 시 이미지가 지식그래프 엔티티로 정상 변환되지 않음. VLM이 호출되지 않고 의미 없는 fallback 엔티티가 생성됨.

**근본 원인:** `ImageModalProcessor`가 문서 파싱(PyMuPDF) 전용으로 설계되어, 로컬 파일 경로(`img_path`)만 처리하고 인라인 base64 데이터(`img_data`)를 지원하지 않았음.

**영향 받은 파일:** `lightrag/multimodal/processors/image.py`

#### 수정 전 데이터 흐름 (실패)

```
url_routes.py                              image.py
──────────────────                         ──────────────────
img_b64 = base64.b64encode(img_bytes)      image_path = content_data.get("img_path")
modal_content = {                              → None (키 불일치!)
    "img_data": img_b64,  ◀── 불일치 ──▶  if not image_path:
    "alt": ...,           ◀── 불일치 ──▶      raise ValueError(...)  ← 예외!
    "context": ...,       ◀── 불일치 ──▶
}                                          except:
                                               fallback_entity = {
                                                   "entity_name": "image_<hash>",
                                                   "summary": "Image content: <base64쓰레기>"
                                               }
                                               → VLM 미호출, 의미없는 엔티티 생성
```

#### 수정 내용 (3가지)

| # | 문제 | 수정 | 상세 |
|---|------|------|------|
| 1 | `img_data`(base64) 미지원 | `img_data` 키 직접 사용 분기 추가 | `img_data` 있으면 파일 I/O 없이 직접 VLM 호출, 없으면 기존 `img_path`에서 읽기 |
| 2 | `alt`/`context` 키 매핑 누락 | 자동 키 매핑 추가 | `alt` → `captions`, `context` → `footnotes`로 변환하여 VLM 프롬프트에 전달 |
| 3 | base64 이미지 S3 업로드 불가 | `_upload_base64_image_to_s3()` 추가 | base64 → 임시 파일 저장 → S3 업로드 → 임시 파일 삭제 |

#### 수정 후 데이터 흐름 (정상)

```
url_routes.py                              image.py (수정됨)
──────────────────                         ──────────────────
modal_content = {                          # 1. img_data 우선 확인
    "img_data": img_b64,  ──────────────▶  image_base64 = content_data.get("img_data")
    "alt": "설명",        ──────────────▶  if image_base64:
    "context": "주변텍스트",──────────────▶      → 파일 I/O 스킵, 직접 사용
}
                                           # 2. 키 매핑
                                           alt → captions (VLM 프롬프트 전달)
                                           context → footnotes (VLM 프롬프트 전달)

                                           # 3. VLM 호출 성공
                                           response = await modal_caption_func(
                                               prompt, image_data=image_base64, ...
                                           )
                                           → 의미있는 description + entity_info 생성

                                           # 4. S3 업로드
                                           _upload_base64_image_to_s3(img_b64, ...)
                                           → S3 URL 생성 → structured_content에 포함

                                           # 5. KG 저장
                                           _create_entity_and_chunk(...)
                                           → 정상 엔티티/청크/관계 생성
```

#### 두 가지 입력 경로 호환성

수정 후 `ImageModalProcessor`는 두 가지 입력을 모두 지원합니다:

| 소스 | 키 | 이미지 데이터 | S3 업로드 |
|------|-----|-------------|----------|
| **URL 수집** | `img_data` | 인라인 base64 (HTTP 다운로드) | `_upload_base64_image_to_s3()` |
| **문서 파싱** (PyMuPDF) | `img_path` | 로컬 파일 경로 → base64 변환 | `_upload_image_to_s3()` |
