# Multimodal Processing - 소스 코드 매핑

## 1. 파일 구조 개요

```
/home/kms-rag/RAG-Anything/
├── raganything/
│   ├── __init__.py                 # 패키지 초기화, 주요 클래스 export
│   ├── raganything.py              # RAGAnything 메인 클래스 (Mixin 조합)
│   ├── config.py                   # RAGAnythingConfig 설정 클래스
│   ├── base.py                     # 기본 타입, 상수 정의
│   ├── modalprocessors.py          # Modal Processors (핵심)
│   ├── processor.py                # ProcessorMixin (문서 처리)
│   ├── query.py                    # QueryMixin (쿼리 처리)
│   ├── batch.py                    # BatchMixin (배치 처리)
│   ├── batch_parser.py             # 배치 파싱 유틸리티
│   ├── parser.py                   # MineruParser, DoclingParser
│   ├── prompt.py                   # VLM/LLM 프롬프트 템플릿
│   ├── utils.py                    # 유틸리티 함수
│   └── enhanced_markdown.py        # 마크다운 처리 유틸리티
│
└── server/backend/app/
    ├── services/
    │   └── raganything_service.py  # RAGAnything 서비스 래퍼
    └── api/v1/
        └── documents.py            # 문서 업로드 API
```

---

## 2. 핵심 클래스 매핑

### 2.1 RAGAnything 메인 클래스

**파일:** `/home/kms-rag/RAG-Anything/raganything/raganything.py`

```python
# 주요 클래스 및 라인 번호 참조
@dataclass
class RAGAnything(QueryMixin, ProcessorMixin, BatchMixin):
    """
    Main orchestrator class combining all mixins

    Key attributes:
    - lightrag: LightRAG instance (line ~50)
    - llm_model_func: LLM callable (line ~55)
    - vision_model_func: VLM callable (line ~60)
    - embedding_func: Embedding callable (line ~65)
    - config: RAGAnythingConfig (line ~70)
    - modal_processors: Dict of processors (line ~75)
    - context_extractor: ContextExtractor (line ~80)
    - parse_cache: KV storage (line ~85)
    - doc_parser: Parser instance (line ~90)

    Key methods:
    - __post_init__(): Initialize parser, cleanup handler (line ~100)
    - _ensure_lightrag_initialized(): Setup LightRAG (line ~150)
    - _initialize_processors(): Create modal processors (line ~200)
    - finalize_storages(): Async cleanup (line ~250)
    """
```

### 2.2 Config 클래스

**파일:** `/home/kms-rag/RAG-Anything/raganything/config.py`

```python
@dataclass
class RAGAnythingConfig:
    """
    Configuration for RAGAnything

    Sections:
    - Directory settings (line ~20-30)
    - Parser settings (line ~35-50)
    - MinerU performance (line ~55-70)
    - Multimodal processing (line ~75-90)
    - Batch processing (line ~95-110)
    - Image filtering (line ~115-130)
    - Context extraction (line ~135-150)
    - Path handling (line ~155-165)

    Key fields:
    - working_dir: str
    - parser: Literal["mineru", "docling"]
    - parse_method: Literal["auto", "ocr", "txt"]
    - mineru_backend: str
    - enable_image_processing: bool
    - enable_table_processing: bool
    - enable_equation_processing: bool
    - vlm_response_language: str
    - context_window: int
    - context_mode: Literal["page", "chunk"]
    """
```

---

## 3. Modal Processors 상세

### 3.1 파일 구조

**파일:** `/home/kms-rag/RAG-Anything/raganything/modalprocessors.py`

```
modalprocessors.py 구조:
├── ContextConfig (dataclass, line ~30-50)
├── ContextExtractor (class, line ~55-200)
│   ├── __init__()
│   ├── set_content_source()
│   ├── get_context_for_item()
│   ├── _extract_from_mineru_content()
│   ├── _extract_from_text_chunks()
│   └── _truncate_to_token_limit()
│
├── BaseModalProcessor (class, line ~210-450)
│   ├── __init__()
│   ├── _get_storage_access()
│   ├── process_multimodal_content()
│   ├── generate_description_only()
│   ├── _create_entity_and_chunk()
│   ├── _process_chunk_for_extraction()
│   ├── _parse_json_response()
│   └── _extract_json_fallback()
│
├── ImageModalProcessor (class, line ~460-650)
│   ├── __init__()
│   ├── _encode_image_to_base64()
│   ├── generate_description_only()
│   ├── _build_vision_prompt()
│   └── _get_system_prompt()
│
├── TableModalProcessor (class, line ~660-800)
│   ├── __init__()
│   ├── generate_description_only()
│   ├── _build_table_prompt()
│   └── _get_system_prompt()
│
├── EquationModalProcessor (class, line ~810-920)
│   ├── __init__()
│   ├── generate_description_only()
│   ├── _build_equation_prompt()
│   └── _get_system_prompt()
│
└── GenericModalProcessor (class, line ~930-1000)
    ├── __init__()
    └── generate_description_only()
```

### 3.2 ContextExtractor 상세

**위치:** `modalprocessors.py` line ~55-200

```python
class ContextExtractor:
    """
    Extracts surrounding context for multimodal items

    Supports multiple content source formats:
    - MinerU content lists (page-based)
    - Text chunks (chunk-based)
    - Dictionary sources
    - Plain text

    Key methods:
    - set_content_source(source, source_type): Set content source
    - get_context_for_item(item_info): Extract context for item
    - _extract_from_mineru_content(): Page-based extraction
    - _extract_from_text_chunks(): Chunk-based extraction
    - _truncate_to_token_limit(): Token-aware truncation
    """
```

### 3.3 BaseModalProcessor 상세

**위치:** `modalprocessors.py` line ~210-450

```python
class BaseModalProcessor:
    """
    Base class for all modal processors

    Storage access (from LightRAG):
    - self.text_chunks_db: KV storage for chunks
    - self.chunks_vdb: Vector DB for chunks
    - self.entities_vdb: Vector DB for entities
    - self.relationships_vdb: Vector DB for relationships
    - self.knowledge_graph_inst: Neo4j graph instance

    Key methods:

    process_multimodal_content(modal_content, content_type, item_info, entity_name):
        1. generate_description_only() → (caption, entity_info)
        2. Build structured_content dict
        3. _create_entity_and_chunk()

    _create_entity_and_chunk(entity_name, entity_type, description, ...):
        1. Store chunk in text_chunks_db
        2. Upsert to chunks_vdb (embedding)
        3. Create/upsert KG node
        4. Insert to entities_vdb (embedding)
        5. _process_chunk_for_extraction()

    _process_chunk_for_extraction(full_doc_id, chunk_key, content):
        1. Call extract_entities() from lightrag.operate
        2. Create "belongs_to" relationships
        3. Upsert to vector DBs
        4. Merge to KG (if not batch mode)
        5. Call lightrag._insert_done()
    """
```

### 3.4 ImageModalProcessor 상세

**위치:** `modalprocessors.py` line ~460-650

```python
class ImageModalProcessor(BaseModalProcessor):
    """
    VLM-based image analysis

    Key methods:

    _encode_image_to_base64(image_path):
        - Read image file
        - Encode to base64
        - Return data URI string

    generate_description_only(modal_content, content_type, item_info, entity_name):
        1. Get context from context_extractor
        2. Build vision prompt (with/without context)
        3. Encode image to base64
        4. Call vision_model_func with image_data parameter
        5. Parse JSON response
        6. Return (enhanced_caption, entity_info)

    _build_vision_prompt(context, item_info):
        - Include context if available
        - Add caption/footnote from item_info
        - Use prompt template from prompt.py

    VLM call format:
        vision_model_func(
            prompt,
            image_data=base64_string,
            system_prompt=IMAGE_ANALYSIS_SYSTEM
        )
    """
```

---

## 4. Processor Mixin 상세

### 4.1 ProcessorMixin

**파일:** `/home/kms-rag/RAG-Anything/raganything/processor.py`

```python
class ProcessorMixin:
    """
    Document processing logic

    Key methods:

    process_document_complete(file_path, **kwargs):
        1. Parse document → content_list
        2. Separate text and multimodal content
        3. Insert text content to LightRAG
        4. Set content source for context extraction
        5. Process multimodal items in parallel
        6. Finalize storages

    insert_content_list(content_list, file_path, doc_id):
        - Insert pre-parsed content
        - Used for external parsers or URL content

    insert_text_content(text, file_path, doc_id):
        - Insert pure text to LightRAG
        - Track doc_id for relationships

    insert_text_content_with_multimodal_content(...):
        - Coordinated text + multimodal insertion
        - Proper ordering and context sharing

    _process_multimodal_items(items, file_path, doc_id, content_list):
        - Parallel processing with asyncio
        - Route to appropriate processor by type
    """
```

---

## 5. Parser 상세

### 5.1 MineruParser

**파일:** `/home/kms-rag/RAG-Anything/raganything/parser.py`

```python
class MineruParser(Parser):
    """
    Advanced document parser using MinerU

    Supported formats:
    - PDF (native)
    - Office documents (via LibreOffice conversion)
    - Images (OCR)
    - Text files

    Backends:
    - pipeline: Standard processing
    - hybrid-auto-engine: Hybrid with auto detection
    - vlm-auto-engine: VLM-based extraction (requires VLM URL)

    Key methods:

    parse_pdf(pdf_path, output_dir, parse_method):
        - Call magic-pdf command
        - Extract text, images, tables, equations
        - Return content_list

    parse_image(image_path, output_dir):
        - OCR processing
        - Return content_list

    parse_document(file_path, output_dir, parse_method):
        - Route by file type
        - Convert Office formats if needed

    _convert_office_to_pdf(file_path):
        - Use LibreOffice for conversion
        - Return PDF path

    _parse_mineru_output(output_dir):
        - Read MinerU JSON output
        - Convert to standardized content_list
    """

    # Content list output format
    content_list = [
        {
            "type": "text",
            "text": "content",
            "text_level": 0,  # 0=body, 1=h1, 2=h2, etc.
            "page_idx": 0
        },
        {
            "type": "image",
            "img_path": "/absolute/path/to/image.jpg",
            "image_caption": ["caption text"],
            "image_footnote": ["footnote text"],
            "page_idx": 1
        },
        {
            "type": "table",
            "table_body": "| col1 | col2 |\n|------|------|",
            "table_caption": ["table caption"],
            "table_footnote": ["table footnote"],
            "table_img_path": "/path/to/table_image.png",
            "page_idx": 2
        },
        {
            "type": "equation",
            "text": "E=mc^2",
            "text_format": "latex",
            "page_idx": 3
        }
    ]
```

---

## 6. Prompts 상세

### 6.1 프롬프트 파일

**파일:** `/home/kms-rag/RAG-Anything/raganything/prompt.py`

```python
# System Prompts (언어 설정 가능)
PROMPTS = {
    # 이미지 분석 시스템 프롬프트
    "image_analysis_system": """
        You are an expert image analyst...
        Response language: {response_language}
    """,

    # 테이블 분석 시스템 프롬프트
    "table_analysis_system": """
        You are an expert at reading and interpreting tables...
        Response language: {response_language}
    """,

    # 수식 분석 시스템 프롬프트
    "equation_analysis_system": """
        You are an expert mathematician...
        Response language: {response_language}
    """,

    # 이미지 분석 프롬프트 (컨텍스트 포함)
    "vision_prompt_with_context": """
        Context from document:
        {context}

        Analyze this image and provide:
        1. detailed_description: Comprehensive analysis
        2. entity_info: {entity_name, entity_type, summary}

        Response in JSON format.
    """,

    # 이미지 분석 프롬프트 (컨텍스트 없음)
    "vision_prompt": """
        Analyze this image and provide...
    """,

    # 테이블 분석 프롬프트 (컨텍스트 포함)
    "table_prompt_with_context": """
        Context from document:
        {context}

        Table content:
        {table_body}

        Caption: {table_caption}

        Analyze this table...
    """,

    # 수식 분석 프롬프트
    "equation_prompt_with_context": """
        Context from document:
        {context}

        Equation: {equation_text}
        Format: {equation_format}

        Analyze this equation...
    """,

    # 청크 템플릿
    "image_chunk": """
        [Image: {entity_name}]
        {description}
    """,

    "table_chunk": """
        [Table: {entity_name}]
        {table_body}
        {description}
    """,

    "equation_chunk": """
        [Equation: {entity_name}]
        {equation_text}
        {description}
    """
}
```

---

## 7. Backend 서비스

### 7.1 RAGAnything Service

**파일:** `/home/kms-rag/RAG-Anything/server/backend/app/services/raganything_service.py`

```python
class RAGAnythingService:
    """
    Singleton wrapper for RAGAnything instance

    Initialization (line ~50-150):
    - Set environment variables (PostgreSQL, Neo4j)
    - Create LLM function (openai_complete_if_cache)
    - Create VLM function (AsyncOpenAI with image support)
    - Create embedding function (openai_embed)
    - Initialize RAGAnythingConfig
    - Create RAGAnything instance

    Model functions:

    llm_model_func (line ~80):
        async def llm_model_func(prompt, system_prompt=None, **kwargs):
            return await openai_complete_if_cache(...)

    vision_model_func (line ~100):
        async def vision_model_func(prompt, image_data=None, system_prompt=None):
            # Handle base64 image_data
            # Call OpenAI-compatible VLM API
            return response

    embedding_func (line ~120):
        async def embedding_func(texts):
            return await openai_embed(texts, ...)

    Key methods:
    - initialize(): Async initialization
    - process_document(file_path, parse_method): Process single document
    - finalize(): Cleanup resources
    """
```

---

## 8. LightRAG 통합 포인트

### 8.1 직접 접근하는 LightRAG 컴포넌트

```python
# modalprocessors.py에서 접근하는 LightRAG 컴포넌트

# Storages (line ~220-240)
self.text_chunks_db = lightrag.text_chunks
self.chunks_vdb = lightrag.chunks_vdb
self.entities_vdb = lightrag.entities_vdb
self.relationships_vdb = lightrag.relationships_vdb
self.knowledge_graph_inst = lightrag.knowledge_graph_inst

# Model functions
self.embedding_func = lightrag.embedding_func
self.llm_model_func = lightrag.llm_model_func

# Cache
self.llm_response_cache = lightrag.llm_response_cache

# Tokenizer
self.tokenizer = lightrag.tokenizer  # For context truncation

# Operations (from lightrag.operate)
from lightrag.operate import extract_entities
# Used in _process_chunk_for_extraction()

# Graph operations
from lightrag.kg.utils import merge_nodes_and_edges
# Used for KG merging (if not batch mode)
```

### 8.2 호출하는 LightRAG 메서드

```python
# raganything.py에서 호출하는 LightRAG 메서드

# Initialization
await lightrag.initialize_storages()

# Text insertion
await lightrag.ainsert(text_content, file_paths=..., ids=...)

# Finalization
await lightrag.finalize_storages()

# Internal methods called by processors
lightrag._insert_done()  # Mark insertion complete
```

---

## 9. 이관 시 주의사항

### 9.1 의존성

```
RAG-Anything 의존성:
- lightrag-hku: LightRAG 코어
- magic-pdf: MinerU 파서
- aiofiles: 비동기 파일 처리
- httpx: 비동기 HTTP 클라이언트
- pillow: 이미지 처리
- asyncio: 비동기 처리
```

### 9.2 환경 변수

```bash
# 필수 환경 변수
LLM_BINDING_HOST=           # LLM API URL
LLM_BINDING_API_KEY=        # LLM API Key
VLM_BINDING_HOST=           # VLM API URL (for image processing)
VLM_BINDING_API_KEY=        # VLM API Key
EMBEDDING_BINDING_HOST=     # Embedding API URL

# MinerU 설정
MINERU_BACKEND=vlm-auto-engine
MINERU_VLM_URL=             # VLM URL for MinerU
```

### 9.3 이관 순서

```
1. content_list 형식 정의 (기존 형식 재사용)
2. ContextExtractor 이식 (독립적)
3. BaseModalProcessor 이식 (LightRAG 통합)
4. 개별 Processor 이식 (Image, Table, Equation)
5. Parser 통합 (MinerU 우선)
6. API 확장 (ainsert 멀티모달 지원)
```
