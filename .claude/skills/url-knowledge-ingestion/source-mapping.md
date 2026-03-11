# URL Knowledge Ingestion - 소스 코드 매핑

## 1. 파일 구조 개요

```
/home/kms-rag/RAG-Anything/
├── raganything/url/
│   ├── __init__.py          # Export 정의
│   ├── detector.py          # URL 검증/정규화
│   ├── fetcher.py           # 웹 콘텐츠 가져오기
│   ├── parser.py            # HTML/Markdown 파싱
│   ├── converter.py         # content_list 변환
│   ├── crawler.py           # 재귀 크롤링
│   └── service.py           # 메인 오케스트레이터
│
└── server/backend/app/
    ├── services/
    │   └── url_service.py   # 비동기 태스크 관리
    └── api/v1/
        └── url.py           # REST API 엔드포인트
```

---

## 2. 핵심 클래스 매핑

### 2.1 URLDetector

**파일:** `/home/kms-rag/RAG-Anything/raganything/url/detector.py`

```python
class URLDetector:
    """
    URL validation and normalization

    Key methods:

    validate_url(url: str) -> bool:
        - Check URL format validity
        - Verify scheme (http/https)
        - Return True/False

    normalize_url(url: str) -> str:
        - Add scheme if missing (default: https)
        - Remove trailing slashes
        - Normalize case for domain
        - Return normalized URL

    extract_domain(url: str) -> str:
        - Parse URL
        - Extract domain/host
        - Return domain string

    generate_doc_id(url: str) -> str:
        - Hash URL (MD5/SHA256)
        - Return unique doc_id for storage

    is_same_domain(url1: str, url2: str) -> bool:
        - Compare domains
        - Used for domain-restricted crawling
    """
```

### 2.2 WebFetcher

**파일:** `/home/kms-rag/RAG-Anything/raganything/url/fetcher.py`

```python
@dataclass
class FetcherConfig:
    """
    Fetcher configuration

    Fields:
    - provider: str = "requests"    # "requests" | "jina"
    - timeout: int = 30             # Request timeout (seconds)
    - max_retries: int = 3          # Retry count
    - retry_delay: float = 1.0      # Delay between retries
    - user_agent: str = "..."       # Custom User-Agent
    - cache_enabled: bool = True    # Enable response caching
    - cache_ttl: int = 3600         # Cache TTL (seconds)
    """

class WebFetcher:
    """
    Fetch web content from URLs

    Providers:
    - requests: Standard HTTP client
    - jina: Jina Reader API (better for JS-rendered pages)

    Key methods:

    async fetch(url: str) -> FetchResult:
        1. Check cache (if enabled)
        2. Select provider
        3. Make HTTP request
        4. Handle retries on failure
        5. Cache response
        6. Return FetchResult

    async _fetch_with_requests(url: str) -> str:
        - Use httpx/aiohttp
        - Return raw HTML

    async _fetch_with_jina(url: str) -> str:
        - Call Jina Reader API
        - Return cleaned content

    FetchResult:
        - url: str
        - content: str (HTML/Markdown)
        - status_code: int
        - content_type: str
        - fetched_at: datetime
    """
```

### 2.3 HTMLParser

**파일:** `/home/kms-rag/RAG-Anything/raganything/url/parser.py`

```python
@dataclass
class ParserConfig:
    """
    Parser configuration

    Fields:
    - extract_images: bool = True      # Extract image URLs
    - extract_tables: bool = True      # Extract tables as markdown
    - extract_links: bool = True       # Extract links (for crawling)
    - preserve_structure: bool = True  # Keep header hierarchy
    - max_content_length: int = None   # Limit content length
    """

class HTMLParser:
    """
    Parse HTML to structured content

    Key methods:

    parse(html: str, base_url: str) -> ParseResult:
        1. Parse HTML with BeautifulSoup
        2. Extract main content (remove nav, footer, ads)
        3. Convert to markdown
        4. Extract images, tables, links
        5. Return ParseResult

    _html_to_markdown(soup: BeautifulSoup) -> str:
        - Convert HTML tags to markdown
        - Preserve headers (h1-h6 → #-######)
        - Convert lists, blockquotes
        - Handle code blocks

    _extract_images(soup: BeautifulSoup, base_url: str) -> list[ImageInfo]:
        - Find all <img> tags
        - Resolve relative URLs
        - Extract alt text
        - Return list of ImageInfo(url, alt, context)

    _extract_tables(soup: BeautifulSoup) -> list[TableInfo]:
        - Find all <table> tags
        - Convert to markdown format
        - Extract captions
        - Return list of TableInfo(markdown, caption)

    _extract_links(soup: BeautifulSoup, base_url: str) -> list[str]:
        - Find all <a> tags
        - Resolve relative URLs
        - Filter external links (if domain restricted)
        - Return list of URLs

    ParseResult:
        - text: str (markdown)
        - images: list[ImageInfo]
        - tables: list[TableInfo]
        - links: list[str]
        - title: str
        - meta_description: str
    """

class MarkdownParser:
    """
    Parse Markdown content (for pre-parsed content)

    Used when content is already markdown (e.g., from Jina)

    Key methods:

    parse(markdown: str) -> ParseResult:
        - Extract structure from markdown
        - Find image references
        - Find table blocks
        - Return ParseResult
    """
```

### 2.4 ContentConverter

**파일:** `/home/kms-rag/RAG-Anything/raganything/url/converter.py`

```python
@dataclass
class ConverterConfig:
    """
    Converter configuration

    Fields:
    - download_images: bool = True     # Download images locally
    - max_image_size: int = 5*1024*1024  # Max image size (5MB)
    - temp_dir: str = "/tmp/url_content"  # Temp directory
    - image_extensions: list = [".jpg", ".png", ".gif", ".webp"]
    """

class ContentConverter:
    """
    Convert parsed content to content_list format

    Key methods:

    async convert(parse_result: ParseResult, url: str) -> list[dict]:
        1. Convert text to text items
        2. Download and convert images
        3. Convert tables
        4. Return content_list

    _convert_text(text: str) -> list[dict]:
        - Split by headers/paragraphs
        - Create text items with page_idx=0
        - Detect text_level from markdown headers

    async _convert_images(images: list[ImageInfo]) -> list[dict]:
        - Download each image
        - Save to temp directory
        - Create image items with img_path

    _convert_tables(tables: list[TableInfo]) -> list[dict]:
        - Create table items with table_body
        - Include table_caption

    async _download_image(url: str) -> str | None:
        - Fetch image content
        - Check size limit
        - Save to temp file
        - Return local path or None on failure

    cleanup():
        - Remove temp directory
        - Clean up downloaded files

    Output format (content_list):
    [
        {"type": "text", "text": "# Title", "text_level": 1, "page_idx": 0},
        {"type": "text", "text": "Paragraph...", "text_level": 0, "page_idx": 0},
        {"type": "image", "img_path": "/tmp/xxx.jpg", "image_caption": ["alt"], "page_idx": 0},
        {"type": "table", "table_body": "| ... |", "table_caption": ["..."], "page_idx": 0}
    ]
    """
```

### 2.5 URLCrawler

**파일:** `/home/kms-rag/RAG-Anything/raganything/url/crawler.py`

```python
@dataclass
class CrawlerConfig:
    """
    Crawler configuration

    Fields:
    - max_depth: int = 2              # Maximum crawl depth
    - max_pages: int = 50             # Maximum pages to crawl
    - same_domain_only: bool = True   # Restrict to same domain
    - crawl_delay: float = 1.0        # Delay between requests (rate limiting)
    - url_pattern: str | None = None  # Regex pattern to filter URLs
    - exclude_patterns: list = []     # Patterns to exclude
    """

class URLCrawler:
    """
    Recursive URL crawler

    Key methods:

    async crawl(start_url: str) -> CrawlResult:
        1. Initialize visited set
        2. Add start_url to queue
        3. BFS crawl with depth tracking
        4. Respect rate limiting
        5. Return CrawlResult

    async _crawl_page(url: str, depth: int) -> list[str]:
        - Fetch page
        - Parse HTML
        - Extract links
        - Filter by domain/pattern
        - Return valid links

    _should_crawl(url: str) -> bool:
        - Check if already visited
        - Check domain restriction
        - Check URL pattern
        - Check exclude patterns
        - Return True/False

    _apply_rate_limit():
        - Wait for crawl_delay
        - Prevent server overload

    CrawlResult:
        - urls: list[str]           # All discovered URLs
        - stats: CrawlStats         # Crawl statistics

    CrawlStats:
        - total_urls: int
        - crawled_count: int
        - failed_count: int
        - duration_seconds: float
    """
```

### 2.6 URLKnowledgeService

**파일:** `/home/kms-rag/RAG-Anything/raganything/url/service.py`

```python
@dataclass
class URLServiceConfig:
    """
    Combined configuration for URL service

    Fields:
    - fetcher: FetcherConfig
    - parser: ParserConfig
    - converter: ConverterConfig
    - crawler: CrawlerConfig | None
    - skip_duplicates: bool = True
    - reindex_existing: bool = False
    """

class URLKnowledgeService:
    """
    Main orchestrator for URL knowledge ingestion

    Components:
    - detector: URLDetector
    - fetcher: WebFetcher
    - parser: HTMLParser
    - converter: ContentConverter
    - crawler: URLCrawler (optional)
    - raganything: RAGAnything instance

    Processing stages:
    - VALIDATE: URL validation
    - CRAWL: Recursive crawling (optional)
    - FETCH: Content fetching
    - PARSE: HTML parsing
    - CONVERT: content_list conversion
    - INGEST: LightRAG insertion
    - COMPLETE: Done

    Key methods:

    async ingest_url(url: str) -> IngestResult:
        1. VALIDATE: detector.validate_url()
        2. FETCH: fetcher.fetch()
        3. PARSE: parser.parse()
        4. CONVERT: converter.convert()
        5. INGEST: raganything.insert_content_list()
        6. Return IngestResult

    async ingest_with_crawl(url: str) -> IngestResult:
        1. VALIDATE: detector.validate_url()
        2. CRAWL: crawler.crawl()
        3. For each URL:
           - FETCH, PARSE, CONVERT, INGEST
        4. Return combined IngestResult

    async _check_duplicate(url: str) -> bool:
        - Generate doc_id
        - Check if exists in storage
        - Return True if duplicate

    IngestResult:
        - url: str
        - doc_id: str
        - status: str (success/failed)
        - content_stats: ContentStats
        - error: str | None

    ContentStats:
        - text_count: int
        - image_count: int
        - table_count: int
        - total_chars: int
    """
```

---

## 3. Backend 서비스

### 3.1 URL Service (Backend)

**파일:** `/home/kms-rag/RAG-Anything/server/backend/app/services/url_service.py`

```python
@dataclass
class URLIngestTask:
    """
    URL ingestion task model

    Fields:
    - task_id: str
    - url: str
    - status: str (pending/running/completed/failed)
    - progress: int (0-100)
    - message: str
    - doc_id: str | None
    - content_count: int
    - text_count: int
    - image_count: int
    - table_count: int
    - error_message: str | None
    - metadata: dict
    - crawl_stats: dict | None
    """

class URLService:
    """
    Async task-based URL ingestion service

    Singleton pattern for shared state

    Key methods:

    create_task(url: str, config: dict) -> str:
        - Create URLIngestTask
        - Generate task_id
        - Store in task registry
        - Return task_id

    async run_ingest(task_id: str):
        - Get task from registry
        - Update status to RUNNING
        - Call URLKnowledgeService.ingest_url()
        - Update progress at each stage
        - Handle errors
        - Update status to COMPLETED/FAILED

    get_task(task_id: str) -> URLIngestTask:
        - Return task by ID

    list_tasks() -> list[URLIngestTask]:
        - Return all tasks

    Progress updates (via TaskService):
        - VALIDATING: 10%
        - FETCHING: 30%
        - PARSING: 50%
        - CONVERTING: 70%
        - INGESTING: 90%
        - COMPLETE: 100%
    """
```

### 3.2 URL API

**파일:** `/home/kms-rag/RAG-Anything/server/backend/app/api/v1/url.py`

```python
# API Endpoints

@router.post("/url/validate")
async def validate_url(request: URLValidateRequest) -> URLValidateResponse:
    """
    Validate URL before ingestion

    Request:
        - url: str

    Response:
        - valid: bool
        - normalized_url: str
        - domain: str
        - error: str | None
    """

@router.post("/url/ingest")
async def ingest_url(request: URLIngestRequest) -> URLIngestResponse:
    """
    Synchronous URL ingestion

    Request:
        - url: str
        - crawl: bool = False
        - max_depth: int = 2
        - max_pages: int = 50

    Response:
        - doc_id: str
        - status: str
        - content_stats: dict
    """

@router.post("/url/ingest-async")
async def ingest_url_async(request: URLIngestAsyncRequest) -> TaskResponse:
    """
    Asynchronous URL ingestion with task tracking

    Request:
        - url: str
        - crawl: bool = False
        - crawl_config: dict | None

    Response:
        - task_id: str
        - stream_url: str (SSE endpoint)
    """

@router.post("/url/batch-ingest")
async def batch_ingest_urls(request: BatchURLIngestRequest) -> BatchResponse:
    """
    Batch URL ingestion

    Request:
        - urls: list[str]
        - parallel: int = 3

    Response:
        - task_ids: list[str]
        - stream_url: str
    """

@router.get("/url/tasks/{task_id}")
async def get_url_task(task_id: str) -> URLIngestTask:
    """
    Get URL ingestion task status
    """

# Safety limits (in code)
MAX_CRAWL_DEPTH = 3
MAX_PAGES_PER_CRAWL = 50
MIN_CRAWL_DELAY = 0.5
```

---

## 4. 데이터 흐름

### 4.1 단일 URL 처리

```
POST /url/ingest
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  URLKnowledgeService.ingest_url(url)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. URLDetector.validate_url(url)                               │
│     → normalized_url, doc_id                                    │
│                                                                  │
│  2. WebFetcher.fetch(normalized_url)                            │
│     → FetchResult(html, status_code)                            │
│                                                                  │
│  3. HTMLParser.parse(html, url)                                 │
│     → ParseResult(text, images, tables, links)                  │
│                                                                  │
│  4. ContentConverter.convert(parse_result, url)                 │
│     → content_list [text, image, table items]                   │
│                                                                  │
│  5. RAGAnything.insert_content_list(content_list, url, doc_id)  │
│     → Text → LightRAG.ainsert()                                 │
│     → Images → ImageModalProcessor                              │
│     → Tables → TableModalProcessor                              │
│                                                                  │
│  6. Return IngestResult(doc_id, stats)                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 크롤링 + 처리

```
POST /url/ingest-async {crawl: true}
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  URLKnowledgeService.ingest_with_crawl(url)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. URLDetector.validate_url(url)                               │
│                                                                  │
│  2. URLCrawler.crawl(url)                                       │
│     ┌───────────────────────────────────────────┐               │
│     │  Depth 0: start_url                       │               │
│     │     ↓ extract links                       │               │
│     │  Depth 1: [link1, link2, ...]            │               │
│     │     ↓ extract links (with delay)         │               │
│     │  Depth 2: [link3, link4, ...]            │               │
│     │     ↓ stop at max_depth                  │               │
│     │  Return: all_urls                         │               │
│     └───────────────────────────────────────────┘               │
│                                                                  │
│  3. For each URL in all_urls (parallel):                        │
│     - Fetch → Parse → Convert → Ingest                          │
│     - Update progress via TaskService                           │
│                                                                  │
│  4. Return combined IngestResult                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. LightRAG 통합 포인트

### 5.1 호출하는 LightRAG 메서드

```python
# service.py에서 호출

# Via RAGAnything
await raganything.insert_content_list(
    content_list=content_list,
    file_path=url,  # URL as file_path
    doc_id=doc_id
)

# Internally calls:
# - lightrag.ainsert() for text
# - Modal processors for multimodal content
```

### 5.2 직접 통합 시 사용할 메서드

```python
# LightRAG에 직접 통합 시

# Text content
await lightrag.ainsert(
    text_content,
    file_paths=url,
    ids=doc_id
)

# Multimodal content (확장 필요)
await lightrag.ainsert_multimodal(
    content_list,
    file_paths=url,
    ids=doc_id
)
```

---

## 6. 이관 시 주의사항

### 6.1 의존성

```
URL 모듈 의존성:
- httpx / aiohttp: 비동기 HTTP 클라이언트
- beautifulsoup4: HTML 파싱
- markdownify: HTML→Markdown 변환
- pillow: 이미지 처리 (다운로드 검증)
- validators: URL 검증
```

### 6.2 환경 변수

```bash
# Jina Reader (선택)
JINA_API_KEY=               # Jina Reader API Key

# Fetcher 설정
URL_FETCH_TIMEOUT=30
URL_FETCH_RETRIES=3
URL_FETCH_DELAY=1.0

# Crawler 제한
URL_MAX_CRAWL_DEPTH=3
URL_MAX_PAGES=50
```

### 6.3 이관 순서

```
1. URLDetector 이식 (독립적)
2. WebFetcher 이식 (HTTP 클라이언트)
3. HTMLParser 이식 (BeautifulSoup)
4. ContentConverter 이식 (content_list 형식)
5. URLCrawler 이식 (재귀 크롤링)
6. URLKnowledgeService 통합 (메인 오케스트레이터)
7. API 확장 (ainsert_url 메서드)
8. REST API 엔드포인트 추가
```
