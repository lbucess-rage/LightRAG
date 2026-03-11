# LightRAG 이미지 분석 파이프라인 상세 분석

> 분석일: 2026-02-10
> 대상: 멀티모달 이미지 처리 파이프라인 (PDF → 이미지 추출 → VLM 분석 → KG 엔티티 생성)
> 분석 범위: `lightrag/multimodal/` 패키지 전체, `multimodal_routes.py`, `lightrag_server.py`

---

## 목차

1. [파이프라인 개요](#1-파이프라인-개요)
2. [설정 (MultimodalConfig)](#2-설정-multimodalconfig)
3. [문서 파싱 — 이미지 추출](#3-문서-파싱--이미지-추출)
4. [이미지 필터링 기준](#4-이미지-필터링-기준)
5. [컨텍스트 추출 (ContextExtractor)](#5-컨텍스트-추출)
6. [VLM 이미지 분석](#6-vlm-이미지-분석)
7. [VLM 프롬프트 상세](#7-vlm-프롬프트-상세)
8. [VLM 응답 파싱](#8-vlm-응답-파싱)
9. [KG 엔티티 생성](#9-kg-엔티티-생성)
10. [2차 엔티티 추출 (LLM)](#10-2차-엔티티-추출)
11. [S3 이미지 업로드](#11-s3-이미지-업로드)
12. [API 엔드포인트](#12-api-엔드포인트)
13. [파서별 비교 (PyMuPDF vs Docling)](#13-파서별-비교)
14. [프로세서별 비교 (이미지 vs 테이블 vs 수식)](#14-프로세서별-비교)
15. [전체 End-to-End 흐름도](#15-전체-end-to-end-흐름도)
16. [핵심 임계값 및 제한 사항](#16-핵심-임계값-및-제한-사항)
17. [관찰 사항 및 개선 포인트](#17-관찰-사항-및-개선-포인트)

---

## 1. 파이프라인 개요

```
PDF 업로드 (API)
    │
    ▼
문서 파서 (PyMuPDF 또는 Docling)
    │  → 이미지, 텍스트, 테이블, 수식을 content_list로 추출
    ▼
백그라운드 태스크 매니저
    │  → 비동기 실행, NDJSON 스트리밍으로 진행 상황 보고
    ▼
텍스트 삽입 (rag.ainsert)
    │  → 텍스트 블록을 표준 LightRAG 파이프라인으로 처리
    ▼
ImageModalProcessor (VLM 호출)
    │  → 이미지 설명(description) + 엔티티 정보(entity_info) JSON 생성
    ▼
BaseModalProcessor._create_entity_and_chunk()
    │  → 청크를 KV + 벡터 DB에 저장, KG 노드 생성
    ▼
extract_entities() + merge_nodes_and_edges()
    │  → 설명 텍스트에서 추가 엔티티 추출
    │  → "belongs_to" edge로 이미지 엔티티에 연결
    ▼
지식 그래프 (완성)
```

---

## 2. 설정 (MultimodalConfig)

파일: `lightrag/multimodal/config.py`

모든 설정은 환경변수에서 읽으며 기본값이 있습니다.

### 2.1 VLM 설정

| 환경변수 | 기본값 | 설명 |
|---------|--------|------|
| `VLM_MODEL` | `""` | VLM 모델명 (예: `qwen3-vl-8b`) |
| `VLM_API_BASE` | `""` | VLM API 엔드포인트 (예: `http://10.62.130.84:18006/v1`) |
| `VLM_API_KEY` | `"not-needed"` | VLM API 키 |
| `VLM_RESPONSE_LANGUAGE` | `"Korean"` | VLM 응답 언어 |

### 2.2 처리 토글

| 환경변수 | 기본값 | 설명 |
|---------|--------|------|
| `ENABLE_IMAGE_PROCESSING` | `True` | 이미지 처리 활성화 |
| `ENABLE_TABLE_PROCESSING` | `True` | 테이블 처리 활성화 |
| `ENABLE_EQUATION_PROCESSING` | `True` | 수식 처리 활성화 |

### 2.3 이미지 필터링

| 환경변수 | 기본값 | 설명 |
|---------|--------|------|
| `MIN_IMAGE_WIDTH` | `100` (px) | 최소 이미지 너비 |
| `MIN_IMAGE_HEIGHT` | `100` (px) | 최소 이미지 높이 |
| `MAX_IMAGE_ASPECT_RATIO` | `10.0` | 최대 종횡비 |
| `ENABLE_DUPLICATE_FILTERING` | `True` | MD5 기반 중복 필터링 |

### 2.4 컨텍스트 추출

| 환경변수 | 기본값 | 설명 |
|---------|--------|------|
| `CONTEXT_WINDOW` | `1` | 앞뒤 페이지/청크 수 |
| `CONTEXT_MODE` | `"page"` | 컨텍스트 추출 방식 (`page` 또는 `chunk`) |
| `MAX_CONTEXT_TOKENS` | `2000` | 최대 컨텍스트 토큰 수 |
| `INCLUDE_HEADERS` | `True` | 제목/헤더 포함 여부 |
| `INCLUDE_CAPTIONS` | `True` | 캡션 포함 여부 |
| `CONTEXT_FILTER_CONTENT_TYPES` | `["text"]` | 컨텍스트에 포함할 콘텐츠 타입 |
| `CONTENT_FORMAT` | `"auto"` | 콘텐츠 형식 |

### 2.5 동시성

| 환경변수 | 기본값 | 설명 |
|---------|--------|------|
| `MAX_PARALLEL_MULTIMODAL` | `4` | 최대 병렬 처리 수 (설정만, 현재 코드에서 미적용) |

---

## 3. 문서 파싱 — 이미지 추출

### 3.1 PyMuPDF 파서 (기본)

파일: `lightrag/multimodal/parsers/pymupdf_parser.py`

```python
# 페이지별 이미지 목록 조회
image_list = page.get_images(full=True)

for img_idx, img_info in enumerate(image_list):
    xref = img_info[0]
    base_image = doc.extract_image(xref)     # 원본 이미지 바이트
    image_bytes = base_image["image"]
    width = base_image.get("width", 0)
    height = base_image.get("height", 0)
    ext = base_image.get("ext", "png")
```

**출력 형식:**
```json
{
    "type": "image",
    "img_path": "/absolute/path/to/page1_img0.png",
    "image_caption": [],
    "image_footnote": [],
    "page_idx": 0,
    "image_width": 800,
    "image_height": 600
}
```

**제한사항**: PyMuPDF는 캡션/각주를 추출하지 못함 — 항상 빈 배열

### 3.2 Docling 파서 (대안)

파일: `lightrag/multimodal/parsers/docling_parser.py`

```python
# GPU 가속 문서 AI 활용
pdf_pipeline_options = PdfPipelineOptions(
    generate_picture_images=True,    # 이미지 추출 활성화
    images_scale=2.0,                # 2배 해상도 업스케일링
    do_ocr=True,                     # OCR 활성화
    do_table_structure=True,         # 테이블 구조 감지
)
```

**출력 형식:**
```json
{
    "type": "image",
    "img_path": "/path/to/image.png",
    "image_caption": "그림 3-1. 긴급출동 서비스 처리 흐름도",
    "image_footnote": "출처: 서비스 운영 매뉴얼 2024",
    "image_label": "chart",
    "page_idx": 5
}
```

**장점**: 문서 구조에서 캡션과 각주를 자동 추출

---

## 4. 이미지 필터링 기준

이미지 추출 후 3단계 필터링을 거칩니다:

### 4.1 크기 필터

```python
if width < min_image_width or height < min_image_height:
    # 100x100 미만 이미지 제거
    continue
```

- 기본: 너비 < 100px 또는 높이 < 100px → 제거
- 목적: 아이콘, 불릿 포인트, 로고 등 소형 장식 이미지 제거

### 4.2 종횡비 필터

```python
aspect_ratio = max(width / height, height / width)
if aspect_ratio > max_image_aspect_ratio:
    # 종횡비 10:1 초과 이미지 제거
    continue
```

- 기본: 10:1 초과 → 제거
- 목적: 가로줄, 세로줄 등 장식적 막대 이미지 제거

### 4.3 중복 필터

```python
import hashlib
image_hash = hashlib.md5(image_bytes).hexdigest()
if image_hash in seen_hashes:
    continue  # 이미 처리된 이미지 건너뛰기
seen_hashes.add(image_hash)
```

- MD5 해시 기반, 같은 문서 내 동일 이미지 중복 제거
- `ENABLE_DUPLICATE_FILTERING=True` (기본) 로 제어

### 4.4 필터링 기준 요약

| 필터 | 기준 | 기본값 | 대상 |
|------|------|--------|------|
| 크기 | width/height 최소값 | 100×100 px | 소형 장식 이미지 |
| 종횡비 | max(w/h, h/w) 최대값 | 10.0 | 줄, 막대 이미지 |
| 중복 | MD5 해시 일치 | 활성화 | 반복 삽입된 이미지 |

---

## 5. 컨텍스트 추출

파일: `lightrag/multimodal/context.py`

이미지 주변의 텍스트를 수집하여 VLM에 전달합니다.

### 5.1 페이지 기반 컨텍스트 (기본)

`context_mode="page"`, `context_window=1` 일 때:

```
┌─────────────┐
│  Page N-1   │ ← 이전 페이지 텍스트
│  (텍스트)    │
├─────────────┤
│  Page N     │ ← 현재 페이지 (이미지가 있는 페이지)
│  [이미지]    │   텍스트 블록만 수집
│  (텍스트)    │
├─────────────┤
│  Page N+1   │ ← 다음 페이지 텍스트
│  (텍스트)    │
└─────────────┘
```

- `content_list`에서 `page_idx`가 `[N-1, N, N+1]` 범위인 텍스트 블록 수집
- `filter_content_types=["text"]` → 텍스트 타입만 포함
- 다른 페이지의 텍스트는 `[Page X]` 접두사 추가
- 헤더는 마크다운 `#` 형식으로 변환 (`text_level` 기반)
- 이미지/테이블 캡션은 `[Image: ...]` 또는 `[Table: ...]` 형식으로 포함

### 5.2 청크 기반 컨텍스트

`context_mode="chunk"`, `context_window=1` 일 때:

```
content_list[I-1]  ← 이전 항목
content_list[I]    ← 현재 이미지 (제외)
content_list[I+1]  ← 다음 항목
```

- `content_list`의 인덱스 기반
- 현재 항목(이미지) 자체는 제외

### 5.3 토큰 절삭

```python
# 토크나이저 사용 가능 시
tokens = tokenizer.encode(context)
if len(tokens) > max_context_tokens:
    tokens = tokens[:max_context_tokens]
    text = tokenizer.decode(tokens)
    # 마지막 20% 내 마침표(.) 또는 줄바꿈에서 끊기 시도
    # 없으면 "..." 추가
```

- `max_context_tokens=2000` (기본)
- 토크나이저 없으면 문자 수 기반 절삭

---

## 6. VLM 이미지 분석

파일: `lightrag/multimodal/processors/image.py`

### 6.1 VLM 클라이언트 설정

파일: `lightrag/api/lightrag_server.py`

```python
vlm_client = AsyncOpenAI(
    base_url=mm_config.vlm_api_base,    # "http://10.62.130.84:18006/v1"
    api_key=mm_config.vlm_api_key,      # "not-needed"
)
```

### 6.2 VLM 호출 파라미터

| 파라미터 | 값 | 비고 |
|---------|-----|------|
| 모델 | `qwen3-vl-8b` | 환경변수 `VLM_MODEL` |
| max_tokens | `4096` | 하드코딩 |
| temperature | `0.1` | 하드코딩, 매우 낮음 (결정적 출력) |
| 이미지 형식 | `data:image/png;base64,...` | 항상 PNG MIME 타입 |
| 메시지 구조 | `[image_url, text]` | 이미지가 먼저, 텍스트가 나중 |

### 6.3 이미지 처리 흐름

```python
# 1. 이미지 파일 읽기 + Base64 인코딩
image_base64 = self._encode_image_to_base64(image_path)

# 2. 주변 컨텍스트 추출
context = self._get_context_for_item(item_info)

# 3. 프롬프트 구성 (컨텍스트 유무에 따라 다른 템플릿)
if context:
    vision_prompt = PROMPTS["vision_prompt_with_context"].format(...)
else:
    vision_prompt = PROMPTS["vision_prompt"].format(...)

# 4. VLM API 호출
response = await self.modal_caption_func(
    vision_prompt,
    image_data=image_base64,
    system_prompt=PROMPTS["IMAGE_ANALYSIS_SYSTEM"].format(
        response_language=self.response_language
    ),
)

# 5. JSON 응답 파싱
return self._parse_response(response, entity_name)
```

### 6.4 VLM 응답 구조

```json
{
    "detailed_description": "이 다이어그램은 긴급출동 서비스의 처리 절차를 보여줍니다. 고객 요청 접수 → 출동 지시 → 현장 도착 → 조치 수행 → 완료 보고의 5단계로 구성됩니다...",
    "entity_info": {
        "entity_name": "긴급출동 처리 절차 흐름도",
        "entity_type": "image",
        "summary": "긴급출동 서비스의 5단계 처리 절차(접수→출동→도착→조치→보고)를 설명하는 흐름도"
    }
}
```

---

## 7. VLM 프롬프트 상세

파일: `lightrag/multimodal/prompts.py`

### 7.1 시스템 프롬프트

```
당신은 문서 이미지에서 도메인 핵심 정보를 추출하는 전문가입니다.
이미지에 포함된 기술적 내용, 장치명, 절차, 규격, 데이터 등 지식으로서 가치 있는 정보에 집중하세요.
배경색, 텍스트 색상, 레이아웃 구성, 시각적 장식 요소는 설명하지 마세요.
반드시 {response_language}로 응답하세요.
```

**핵심 원칙**: 도메인 지식에 집중, 시각적 스타일 정보 배제

### 7.2 비전 프롬프트 (컨텍스트 없음)

```
**중요: 반드시 {response_language}로 응답하세요.**

이 이미지에서 도메인 핵심 정보를 추출하고 아래 JSON 형식으로 응답하세요:

{
    "detailed_description": "이미지의 핵심 정보를 다음 지침에 따라 작성:
    - 이미지가 설명하는 주제, 장치, 절차, 개념을 구체적으로 기술
    - 이미지 내 텍스트(라벨, 제목, 설명문, 수치 등)를 정확하게 읽어서 기록
    - 다이어그램, 도식, 흐름도 등의 기술적 내용을 상세히 설명
    - 장치명, 부품명, 규격, 단위 등 고유명사와 전문 용어를 정확하게 기록
    - 대명사 대신 구체적인 명칭을 사용하여 명확하게 기술

    [추출하지 말 것]:
    - 배경색, 텍스트 색상, 글꼴, 폰트 크기 등 시각적 스타일
    - 이미지 레이아웃, 여백, 정렬, 위치 배치 등 구성 요소
    - 아이콘, 마커, 화살표 등 장식적 시각 요소의 색상이나 형태
    - '이미지 분석 결과', '시각적 분석' 같은 메타 표현",
    "entity_info": {
        "entity_name": "{entity_name}",
        "entity_type": "image",
        "summary": "이미지가 전달하는 핵심 지식을 간결하게 요약 (최대 100단어).
                    시각적 묘사가 아닌 도메인 정보 중심으로 작성."
    }
}

참고 정보:
- 캡션: {captions}
- 각주: {footnotes}

지식 그래프 구축에 유용한 도메인 핵심 정보 추출에 집중하세요.
```

### 7.3 비전 프롬프트 (컨텍스트 있음)

위 프롬프트에 추가되는 요소:

- **추가 지침**: "주변 문맥과의 연관성을 설명 (이 이미지가 문서에서 어떤 역할을 하는지)"
- **컨텍스트 섹션**: `주변 문맥 정보:\n{context}`
- **요약 지침**: "주변 문맥과의 관계를 간결하게 요약"

### 7.4 프롬프트 설계 원칙

| 원칙 | 구현 방법 |
|------|----------|
| 도메인 정보 집중 | "기술적 내용, 장치명, 절차, 규격, 데이터에 집중" |
| 시각적 노이즈 배제 | 배경색, 글꼴, 레이아웃 등 명시적 제외 목록 |
| 메타 표현 배제 | "이미지 분석 결과", "시각적 분석" 같은 표현 금지 |
| 구체적 명칭 사용 | 대명사 대신 고유명사, 전문 용어 강조 |
| 이미지 내 텍스트 추출 | 라벨, 제목, 설명문, 수치를 정확히 읽기 |
| 구조화된 출력 | JSON 형식 (description + entity_info) 강제 |

---

## 8. VLM 응답 파싱

파일: `lightrag/multimodal/base.py`

### 8.1 4단계 로버스트 파싱

VLM 출력이 종종 malformed JSON이므로 4단계 파싱 전략을 사용합니다:

| 단계 | 방법 | 설명 |
|------|------|------|
| 1 | 직접 파싱 | JSON 후보를 추출하여 `json.loads()` 시도 |
| 2 | 기본 정리 | 곱은따옴표 교체, 후행 쉼표 제거 |
| 3 | 따옴표 수정 | 이스케이프된 따옴표와 백슬래시 수정 |
| 4 | 정규식 폴백 | 개별 필드를 regex로 추출 |

### 8.2 JSON 후보 추출

```
우선순위:
1. 코드 블록: ```json ... ```
2. 균형 잡힌 중괄호 매칭
3. 단순 {..} 정규식
```

- `<think>`, `<thinking>` 태그는 사전 제거 (추론 모델 대응)

### 8.3 엔티티 이름 후처리

```python
# entity_name에 타입 접미사 자동 추가
entity_data["entity_name"] = f"{entity_data['entity_name']} ({entity_data['entity_type']})"
# 예: "긴급출동 처리 절차 흐름도" → "긴급출동 처리 절차 흐름도 (image)"

# 호출자가 entity_name을 명시적으로 제공한 경우 그것을 사용
if entity_name:
    entity_data["entity_name"] = entity_name
```

---

## 9. KG 엔티티 생성

파일: `lightrag/multimodal/base.py` — `_create_entity_and_chunk()`

### 9.1 텍스트 청크 생성

```python
chunk_id = compute_mdhash_id(str(modal_chunk), prefix="chunk-")
tokens = len(self.tokenizer.encode(modal_chunk))

chunk_data = {
    "tokens": tokens,
    "content": modal_chunk,                    # VLM description 텍스트
    "chunk_order_index": chunk_order_index,
    "full_doc_id": actual_doc_id,
    "file_path": file_path,
}
if structured_content:
    chunk_data["structured_content"] = structured_content  # 전체 메타데이터

# KV 저장소 + 벡터 DB에 저장
await self.text_chunks_db.upsert({chunk_id: chunk_data})
await self.chunks_vdb.upsert({chunk_id: chunk_data})
```

**이미지 청크의 `content`**: VLM의 `detailed_description` 출력 그대로 사용

### 9.2 KG 노드 생성

```python
node_data = {
    "entity_id": entity_info["entity_name"],
    "entity_type": "image",
    "description": entity_info["summary"],
    "source_id": chunk_id,
    "file_path": file_path,
    "created_at": int(time.time()),
    "s3_url": "https://...",           # S3 업로드 시
}
await self.knowledge_graph_inst.upsert_node(entity_info["entity_name"], node_data)
```

### 9.3 엔티티 벡터 DB 등록

```python
await self.entities_vdb.upsert({
    compute_mdhash_id(entity_name, prefix="ent-"): {
        "entity_name": entity_name,
        "entity_type": "image",
        "content": f"{entity_name}\n{summary}",  # 검색용 콘텐츠
        "source_id": chunk_id,
        "file_path": file_path,
    }
})
```

### 9.4 structured_content 구조

이미지 청크에 첨부되는 메타데이터:

```json
{
    "version": "1.0",
    "type": "image",
    "source": {
        "file_path": "긴급출동_메뉴얼.pdf",
        "doc_id": "doc-abc123",
        "chunk_order_index": 5,
        "page_idx": 3
    },
    "image": {
        "path": "/absolute/path/to/image.png",
        "s3_url": "https://s3.example.com/lightrag/images/.../image.png",
        "captions": ["그림 3-1. 긴급출동 처리 흐름도"],
        "footnotes": []
    },
    "analysis": {
        "description": "이 다이어그램은 긴급출동 서비스의..."
    },
    "entity": {
        "name": "긴급출동 처리 절차 흐름도 (image)",
        "type": "image",
        "summary": "긴급출동 서비스의 5단계 처리 절차를..."
    }
}
```

---

## 10. 2차 엔티티 추출

파일: `lightrag/multimodal/base.py` — `_process_chunk_for_extraction()`

VLM이 생성한 description 텍스트에서 LLM을 통해 추가 엔티티를 추출합니다.

### 10.1 처리 흐름

```
VLM description 텍스트
    │
    ▼
LightRAG extract_entities()
    │  → 표준 LLM 엔티티 추출 파이프라인 사용
    ▼
추가 엔티티 발견
    │  (예: "긴급출동", "고객", "출동지시" 등)
    ▼
"belongs_to" edge 생성
    │  → 각 추가 엔티티 ──belongs_to──→ 이미지 엔티티
    ▼
merge_nodes_and_edges()
    │  → 중복 해결, 그래프 상태 확정
    ▼
완료
```

### 10.2 belongs_to 관계 생성

```python
for entity_name in extracted_entities:
    if entity_name != image_entity_name:
        relation_data = {
            "description": f"Entity {entity_name} belongs to {image_entity_name}",
            "keywords": "belongs_to,part_of,contained_in",
            "source_id": chunk_id,
            "weight": 10.0,          # 높은 가중치 (구조적 관계)
            "file_path": file_path,
        }
        await self.knowledge_graph_inst.upsert_edge(
            entity_name, image_entity_name, relation_data
        )
```

**weight=10.0**: 일반 관계보다 높은 가중치로, 이미지에서 추출된 엔티티가 해당 이미지에 속한다는 구조적 관계를 강하게 표현합니다.

### 10.3 결과: 이미지 1개에서 생성되는 KG 구조

```
              [이미지 엔티티]
            긴급출동 처리 절차 흐름도 (image)
                   │
          belongs_to (weight=10.0)
           ┌───────┼───────┐
           ▼       ▼       ▼
        [긴급출동] [고객]  [출동지시]
        (SERVICE) (PERSON) (PROCEDURE)
```

---

## 11. S3 이미지 업로드

파일: `lightrag/multimodal/processors/image.py`, `lightrag/api/utils_s3.py`

### 11.1 업로드 경로

```
{S3_IMAGE_PREFIX}/{workspace}/{doc_id}/{filename}
예: lightrag/images/kevcs/doc-abc123/page3_img0.png
```

### 11.2 업로드 설정

```python
ContentDisposition: "inline"     # 브라우저에서 직접 표시
ContentType: "image/png"         # 이미지 MIME 타입
```

### 11.3 S3 URL 저장 위치

| 위치 | 용도 |
|------|------|
| `structured_content.image.s3_url` | 청크 메타데이터 |
| KG 노드 `s3_url` 속성 | 그래프 노드 속성 |
| 레퍼런스의 `download_url` | 쿼리 응답 시 클라이언트에 제공 |

---

## 12. API 엔드포인트

파일: `lightrag/api/routers/multimodal_routes.py`

### 12.1 POST /api/multimodal/process

**요청:**
```http
POST /api/multimodal/process
Content-Type: multipart/form-data
LIGHTRAG-WORKSPACE: my-workspace

file: (PDF 파일)
parser: "pymupdf"
process_images: true
process_tables: true
process_equations: true
password: (선택, PDF 비밀번호)
file_path_label: (선택, KG에 표시할 파일 경로)
```

**즉시 응답:**
```json
{
    "task_id": "task-abc123",
    "stream_url": "/api/tasks/task-abc123/stream",
    "message": "Processing started for document.pdf"
}
```

### 12.2 백그라운드 처리 단계

| 단계 | 진행률 | 작업 |
|------|--------|------|
| Phase 1 | 0-20% | 문서 파싱 (content_list 생성) |
| Phase 2 | 20-40% | 텍스트 블록 삽입 (rag.ainsert + S3 업로드) |
| Phase 3 | 40-95% | 멀티모달 블록 처리 (이미지/테이블/수식) |
| Phase 4 | 95-100% | 태스크 완료 |

### 12.3 진행 상황 스트리밍

`GET /api/tasks/{task_id}/stream` 으로 NDJSON 스트리밍:

```
{"type": "progress", "progress": 15, "message": "Parsing document..."}
{"type": "progress", "progress": 25, "message": "Inserting text chunks..."}
{"type": "progress", "progress": 50, "message": "Processing image 1/5..."}
{"type": "progress", "progress": 65, "message": "Processing image 2/5..."}
{"type": "result", "status": "completed", "data": {...}}
```

---

## 13. 파서별 비교

| 관점 | PyMuPDF (기본) | Docling (대안) |
|------|:-------------:|:-------------:|
| **속도** | 빠름 (CPU) | 느림 (GPU 가속) |
| **이미지 추출** | 페이지 내 임베디드 이미지 | 문서 구조 인식 기반 |
| **캡션 추출** | ❌ (항상 빈 배열) | ✅ (문서 구조에서 추출) |
| **각주 추출** | ❌ (항상 빈 배열) | ✅ (문서 구조에서 추출) |
| **해상도** | 원본 | 2배 업스케일링 |
| **OCR** | 미지원 | 지원 |
| **테이블 구조** | 기본적 | 고급 구조 인식 |
| **지원 형식** | PDF만 | PDF, DOCX, PPTX, XLSX, HTML, 이미지 등 |
| **의존성** | `fitz` (PyMuPDF) | `docling`, `docling_core` |
| **크기 필터** | ✅ (코드 내 구현) | 미확인 |
| **중복 필터** | ✅ (MD5 해시) | 미확인 |

---

## 14. 프로세서별 비교

| 관점 | 이미지 | 테이블 | 수식 |
|------|--------|--------|------|
| **사용 모델** | VLM (`vlm_model_func`) | LLM (`llm_model_func`) | LLM (`llm_model_func`) |
| **입력 형식** | Base64 이미지 + 텍스트 프롬프트 | 마크다운 테이블 텍스트 | LaTeX/텍스트 수식 |
| **시스템 프롬프트 언어** | 한국어 (도메인 전문가) | 한국어 (테이블 분석가) | 영어 (수학자) |
| **컨텍스트 지원** | ✅ (with_context 변형) | ✅ (with_context 변형) | ✅ (with_context 변형) |
| **S3 업로드** | ✅ (이미지 파일) | ❌ | ❌ |
| **청크 내용** | VLM description만 | 테이블 본문 + LLM description | 수식 텍스트 + 형식 + LLM 분석 |
| **엔티티 타입** | `"image"` | `"table"` | `"equation"` |
| **엔티티 이름 형식** | `{VLM 이름} (image)` | `{LLM 이름} (table)` | `{LLM 이름} (equation)` |

---

## 15. 전체 End-to-End 흐름도

### PDF 1개 → KG 생성까지의 전체 과정

```
┌────────────────────────────────────────────┐
│        [Phase 1] 문서 파싱 (0-20%)          │
│                                            │
│  POST /api/multimodal/process              │
│  file: document.pdf, parser: "pymupdf"     │
│           │                                │
│           ▼                                │
│  PyMuPDF가 PDF 파싱                         │
│  ├── 텍스트 블록 추출                        │
│  ├── 이미지 추출 + 3단계 필터링               │
│  │   ├── 크기 필터 (100×100 미만 제거)       │
│  │   ├── 종횡비 필터 (10:1 초과 제거)        │
│  │   └── 중복 필터 (MD5 해시)               │
│  ├── 테이블 추출                            │
│  └── 수식 추출                              │
│           │                                │
│           ▼                                │
│  content_list 생성:                         │
│  [{type:"text",...}, {type:"image",...},    │
│   {type:"table",...}, ...]                  │
└────────────────────┬───────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────┐
│      [Phase 2] 텍스트 삽입 (20-40%)         │
│                                            │
│  텍스트 블록 연결 → rag.ainsert()            │
│  → 표준 LightRAG 파이프라인 (청킹 + 임베딩)  │
│  → 원본 PDF → S3 업로드                     │
│  → doc_id 생성                             │
└────────────────────┬───────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────┐
│    [Phase 3] 멀티모달 처리 (40-95%)          │
│                                            │
│  content_list에서 이미지 항목 순회            │
│  ┌──────────────────────────────────────┐  │
│  │ 이미지 1개 처리:                       │  │
│  │                                      │  │
│  │ [A] 컨텍스트 추출                      │  │
│  │     Page N-1 ~ N+1 텍스트 수집         │  │
│  │     max 2000 토큰으로 절삭              │  │
│  │                                      │  │
│  │ [B] VLM 호출                          │  │
│  │     Base64 이미지 + 프롬프트            │  │
│  │     qwen3-vl-8b, temp=0.1            │  │
│  │     max_tokens=4096                   │  │
│  │                                      │  │
│  │ [C] 응답 파싱                          │  │
│  │     4단계 로버스트 JSON 파싱             │  │
│  │     → detailed_description            │  │
│  │     → entity_info                     │  │
│  │                                      │  │
│  │ [D] S3 업로드 (선택)                    │  │
│  │     이미지 파일 → S3                    │  │
│  │                                      │  │
│  │ [E] 청크 생성                          │  │
│  │     content = VLM description         │  │
│  │     → KV 저장소 + 벡터 DB              │  │
│  │                                      │  │
│  │ [F] KG 노드 생성                       │  │
│  │     entity_type = "image"             │  │
│  │     → Neo4j + PG 엔티티 VDB           │  │
│  │                                      │  │
│  │ [G] 2차 엔티티 추출                     │  │
│  │     LLM으로 description에서 추가 엔티티  │  │
│  │     → belongs_to edge (weight=10.0)   │  │
│  │     → merge_nodes_and_edges()         │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  (각 이미지, 테이블, 수식에 대해 반복)         │
└────────────────────┬───────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────┐
│      [Phase 4] 완료 (95-100%)              │
│                                            │
│  태스크 로그 저장                            │
│  → {working_dir}/task_logs/{task_id}.json  │
│  태스크 상태 → "completed"                  │
└────────────────────────────────────────────┘
```

---

## 16. 핵심 임계값 및 제한 사항

| 항목 | 값 | 소스 |
|------|-----|------|
| 최소 이미지 크기 | 100×100 px | `config.py` |
| 최대 종횡비 | 10.0 | `config.py` |
| 중복 필터링 | MD5 해시 | `pymupdf_parser.py` |
| 컨텍스트 윈도우 | 1 페이지/청크 | `config.py` |
| 최대 컨텍스트 토큰 | 2,000 | `config.py` |
| VLM max_tokens | 4,096 (하드코딩) | `lightrag_server.py` |
| VLM temperature | 0.1 (하드코딩) | `lightrag_server.py` |
| belongs_to edge weight | 10.0 | `base.py` |
| Docling images_scale | 2.0배 | `docling_parser.py` |
| 엔티티 요약 최대 | 100단어 (프롬프트 지시, 강제 아님) | `prompts.py` |
| 병렬 처리 수 | 4 (설정만, 코드 미적용) | `config.py` |

---

## 17. 관찰 사항 및 개선 포인트

### 17.1 PyMuPDF 캡션 미추출

PyMuPDF 파서는 이미지 캡션과 각주를 추출하지 못합니다. VLM에 전달되는 `captions`와 `footnotes`가 항상 빈 배열이므로, VLM이 이미지 맥락 파악에 활용할 수 있는 정보가 부족합니다. Docling 파서를 사용하면 이 문제가 해결됩니다.

### 17.2 VLM 파라미터 하드코딩

`max_tokens=4096`, `temperature=0.1`이 하드코딩되어 있습니다. 복잡한 다이어그램의 경우 4096 토큰이 부족할 수 있으며, 환경변수로 설정 가능하게 하면 유연성이 높아집니다.

### 17.3 병렬 처리 미구현

`MAX_PARALLEL_MULTIMODAL=4`로 설정할 수 있지만, 실제 처리는 순차적(sequential)입니다. 이미지가 많은 문서에서 병렬 처리를 구현하면 속도가 크게 향상될 수 있습니다.

### 17.4 이미지 MIME 타입 고정

모든 이미지가 `data:image/png;base64,...` 형식으로 전송됩니다. 원본이 JPEG, WebP 등이어도 PNG로 간주됩니다. VLM이 MIME 타입에 민감하지 않다면 실질적 문제는 없지만, 정확한 MIME 타입 전달이 바람직합니다.

### 17.5 belongs_to 관계의 높은 가중치

2차 추출된 엔티티의 `belongs_to` edge가 `weight=10.0`으로 설정됩니다. 이는 일반 관계보다 매우 높은 가중치로, 쿼리 시 이 관계가 우선 반환될 수 있습니다. 도메인에 따라 가중치 조정이 필요할 수 있습니다.

### 17.6 2차 엔티티 추출의 LLM 비용

각 이미지에 대해 VLM 1회 + LLM 1회(엔티티 추출) = 최소 2회의 모델 호출이 발생합니다. 이미지가 많은 문서에서는 비용이 급격히 증가합니다.

---

## 부록: 관련 소스 파일 참조

| 파일 | 주요 내용 |
|------|----------|
| `lightrag/multimodal/config.py` | `MultimodalConfig` — 모든 설정 파라미터 |
| `lightrag/multimodal/context.py` | `ContextExtractor` — 주변 텍스트 컨텍스트 추출 |
| `lightrag/multimodal/base.py` | `BaseModalProcessor` — KG 엔티티 생성, 2차 추출, JSON 파싱 |
| `lightrag/multimodal/prompts.py` | 모든 VLM/LLM 프롬프트 (시스템, 비전, 테이블, 수식) |
| `lightrag/multimodal/processors/image.py` | `ImageModalProcessor` — VLM 이미지 분석 |
| `lightrag/multimodal/processors/table.py` | `TableModalProcessor` — LLM 테이블 분석 |
| `lightrag/multimodal/processors/equation.py` | `EquationModalProcessor` — LLM 수식 분석 |
| `lightrag/multimodal/processors/generic.py` | `GenericModalProcessor` — 일반 콘텐츠 처리 |
| `lightrag/multimodal/parsers/pymupdf_parser.py` | PyMuPDF 파서 (이미지 추출, 필터링) |
| `lightrag/multimodal/parsers/docling_parser.py` | Docling 파서 (GPU, 캡션/각주 추출) |
| `lightrag/api/routers/multimodal_routes.py` | 멀티모달 API 엔드포인트, 백그라운드 태스크 |
| `lightrag/api/lightrag_server.py` | VLM 클라이언트 초기화, VLM/LLM 함수 정의 |
| `lightrag/api/utils_s3.py` | S3 이미지 업로드 유틸리티 |
| `lightrag/api/task_manager.py` | 비동기 태스크 관리 (진행 상황 스트리밍) |
