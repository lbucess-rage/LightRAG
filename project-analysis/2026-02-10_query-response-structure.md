# 쿼리 응답 구조 분석: References, Chunk Content, Score

> 분석일: 2026-02-10
> 대상: `/query`, `/query/stream`, `/query/data` 엔드포인트 응답 구조
> 분석 범위: `query_routes.py`, `utils.py`, `operate.py`

---

## 목차

1. [엔드포인트별 개요](#1-엔드포인트별-개요)
2. [파라미터별 응답 구조](#2-파라미터별-응답-구조)
3. [References 생성 기준](#3-references-생성-기준)
4. [Chunk Content Enrichment 흐름](#4-chunk-content-enrichment-흐름)
5. [Score 파이프라인](#5-score-파이프라인)
6. [Content 경량화 규칙](#6-content-경량화-규칙)
7. [전체 데이터 흐름 다이어그램](#7-전체-데이터-흐름-다이어그램)
8. [Pydantic 모델 정의](#8-pydantic-모델-정의)

---

## 1. 엔드포인트별 개요

| 엔드포인트 | 메서드 | 응답 형식 | `include_references` 적용 | `include_chunk_content` 적용 |
|-----------|--------|----------|:------------------------:|:---------------------------:|
| `/query` | POST | JSON | O | O |
| `/query/stream` | POST | NDJSON (스트리밍) | O | O |
| `/query/data` | POST | JSON (구조화 데이터) | **무시** (항상 포함) | **무시** (chunks 별도 제공) |

### `/query` — 표준 질의응답

```
요청 → LLM 응답 + (선택적) References 반환
```

### `/query/stream` — 스트리밍 질의응답

```
요청 → [첫 줄: references JSON] + [이후: response 청크 스트리밍]
```

### `/query/data` — 구조화 데이터 전체 반환

```
요청 → entities + relationships + chunks + references (항상 전체 포함)
```

---

## 2. 파라미터별 응답 구조

### 2.1 `include_references=false`

```json
{
  "response": "LLM 응답 텍스트...",
  "references": null
}
```

- 응답 텍스트만 반환
- References 관련 후처리 (S3 URL, chunk enrichment) 전부 스킵
- 가장 가벼운 응답

### 2.2 `include_references=true`, `include_chunk_content=false` (기본값)

```json
{
  "response": "LLM 응답 텍스트...",
  "references": [
    {
      "reference_id": "1",
      "file_path": "긴급출동 메뉴얼.pdf",
      "doc_id": "doc-276a9802186d...",
      "download_url": "https://s3.../긴급출동 메뉴얼.pdf"
    },
    {
      "reference_id": "2",
      "file_path": "정비지침서.pdf",
      "doc_id": "doc-83bc1f...",
      "download_url": "https://s3.../정비지침서.pdf"
    }
  ]
}
```

- 참조 문서 목록 제공 (파일명, 문서 ID, S3 다운로드 URL)
- 실제 chunk 텍스트/점수는 미포함
- 출처 표시용

### 2.3 `include_references=true`, `include_chunk_content=true`

```json
{
  "response": "LLM 응답 텍스트...",
  "references": [
    {
      "reference_id": "1",
      "file_path": "긴급출동 메뉴얼.pdf",
      "doc_id": "doc-276a9802186d...",
      "download_url": "https://s3.../긴급출동 메뉴얼.pdf",
      "score": 0.4719,
      "scores": [0.4719, null, 0.4593, null, 0.4278],
      "content": [],
      "structured_content": [
        {"type": "image", "image": "...", "entity": {...}, "source": {...}},
        {"type": "table", "table": "...", "entity": {...}, "source": {...}}
      ]
    }
  ]
}
```

- `score`: 해당 문서의 최대 유사도 점수
- `scores`: 개별 chunk별 유사도 점수 (병렬 배열, 유사도 내림차순)
- `content`: 텍스트 chunk 배열 (structured_content 전용이면 `[]`)
- `structured_content`: 멀티모달 구조화 데이터 배열

### 2.4 `/query/data` 응답 (항상 전체)

```json
{
  "status": "success",
  "message": "Query processed successfully",
  "data": {
    "entities": [
      {
        "entity": "니로EV",
        "type": "VEHICLE_MODEL",
        "description": "...",
        "source_id": "...",
        "file_path": "긴급출동 메뉴얼.pdf"
      }
    ],
    "relationships": [
      {
        "src_id": "니로EV",
        "tgt_id": "비상레버",
        "description": "...",
        "weight": 1.0,
        "source_id": "..."
      }
    ],
    "chunks": [
      {
        "reference_id": "1",
        "file_path": "긴급출동 메뉴얼.pdf",
        "chunk_id": "chunk-abc123",
        "content": "",
        "structured_content": {...},
        "score": 0.4719
      }
    ],
    "references": [
      {
        "reference_id": "1",
        "file_path": "긴급출동 메뉴얼.pdf",
        "doc_id": "doc-276a9..."
      }
    ]
  },
  "metadata": {
    "query_mode": "mix",
    "keywords": {
      "high_level": ["전기차 비상 조작"],
      "low_level": ["니로EV", "비상레버"]
    }
  }
}
```

---

## 3. References 생성 기준

### 3.1 생성 위치

`generate_reference_list_from_chunks()` — `utils.py:3267`

### 3.2 생성 시점

```
검색 (vector/entity/relation)
  ↓
_merge_all_chunks()          라운드로빈 병합 + chunk_id 중복 제거
  ↓
process_chunks_unified()     리랭킹 → chunk_top_k → 토큰 자르기
  ↓
generate_reference_list_from_chunks()   ← 여기서 reference 생성
  ↓
convert_to_user_format()     최종 응답 포맷
```

### 3.3 그룹핑 기준

**`file_path`가 동일한 chunk들 → 하나의 reference로 그룹핑**

| 단계 | 처리 내용 |
|------|----------|
| 1. 빈도 집계 | 각 `file_path`의 등장 횟수 카운트 |
| 2. 정렬 | 빈도 높은 순 → 동률 시 먼저 등장한 순 |
| 3. ID 부여 | 정렬 순서대로 `"1"`, `"2"`, `"3"` ... (1-based) |
| 4. chunk 연결 | 각 chunk에 `reference_id` 필드 추가 |
| 5. doc_id 매핑 | `full_doc_id` → `doc_id`로 S3 URL 조회용 |

### 3.4 예시

chunk 20개 중 15개가 `A.pdf`, 5개가 `B.pdf`에서 나온 경우:

```
Reference "1" = A.pdf (15회 출현, 우선순위 높음)
Reference "2" = B.pdf (5회 출현)
```

### 3.5 S3 URL Enrichment

`_enrich_references_with_s3_url()` — `query_routes.py:253`

```python
doc_data = await rag.doc_status.get_by_id(doc_id)
if doc_data and doc_data.get("s3_url"):
    ref_copy["download_url"] = doc_data["s3_url"]
```

- `doc_id`로 `lightrag_doc_status` 테이블 조회
- `s3_url` 값이 있으면 `download_url`로 추가

---

## 4. Chunk Content Enrichment 흐름

### 4.1 조건

```python
if request.include_references and request.include_chunk_content:
```

`include_references=True` **AND** `include_chunk_content=True`일 때만 실행.

### 4.2 처리 과정 (`query_routes.py:504-538`)

```
data.chunks (개별 chunk, reference_id 포함)
  ↓
reference_id로 그룹핑 → ref_id_to_chunks 맵 생성
  ↓
각 reference에 병렬 배열로 병합:
  ├─ content[]              텍스트 배열
  ├─ structured_content[]   구조화 데이터 배열
  ├─ scores[]               개별 chunk 점수 배열
  └─ score                  최대 점수
```

### 4.3 병렬 배열 구조

`content`, `structured_content`, `scores` 배열은 **같은 인덱스가 같은 chunk**를 가리킵니다:

```
scores[0]              = 0.4719  ← chunk #0의 유사도
content[0]             = ""      ← chunk #0의 텍스트 (structured_content 있으므로 비움)
structured_content[0]  = {...}   ← chunk #0의 구조화 데이터
```

배열 순서는 **유사도 내림차순** (라운드로빈 병합 + 리랭킹 결과 순서 유지).

---

## 5. Score 파이프라인

### 5.1 스코어 종류

| 스코어 | 소스 | 범위 | 설명 |
|--------|------|------|------|
| 코사인 유사도 | PostgreSQL VDB 청크 검색 | 0.0 ~ 1.0 | `1 - cosine_distance` |
| rerank_score | `apply_rerank_if_enabled()` | 모델 의존 | 리랭킹 모델이 부여한 관련도 |

### 5.2 전파 경로

```
[1] PostgreSQL SQL
    SELECT ... (content_vector <=> query_vector) AS distance
                                                      │
[2] _get_vector_context()                             ▼
    score = round(1.0 - float(distance), 4)     코사인 유사도로 변환
                                                      │
[3] _merge_all_chunks()                               ▼
    chunk_data["score"] = chunk["score"]          병합 시 score 전파
                                                      │
[4] process_chunks_unified()                          ▼
    if rerank_score is not None:                  리랭킹 사용 시 덮어쓰기
        chunk["score"] = round(rerank_score, 4)
                                                      │
[5] convert_to_user_format()                          ▼
    chunk_data["score"] = chunk["score"]          응답 포맷에 포함
                                                      │
[6] query_routes.py (enrichment)                      ▼
    ref_copy["scores"] = per_scores               개별 chunk 점수 배열
    ref_copy["score"] = max(per_scores)           문서 대표 점수 (최대값)
```

### 5.3 스코어 우선순위

```
rerank_score (있으면) > cosine_similarity (기본)
```

- **리랭킹 활성화** (`enable_rerank=true`): 모든 chunk에 `rerank_score` 부여 → `score`로 사용
- **리랭킹 비활성화**: vector 검색 chunk만 코사인 유사도 보유, KG 경유 chunk는 `null`

### 5.4 scores 배열의 null 값

```json
"scores": [0.4719, null, 0.4593, null, 0.4278]
```

- 숫자 값: vector 검색으로 직접 가져온 chunk (코사인 유사도)
- `null`: entity/relation 경유로 가져온 chunk (KV store 조회, 벡터 검색 아님)
- 리랭킹 활성화 시 모든 값이 숫자 (null 없음)

---

## 6. Content 경량화 규칙

### 6.1 규칙 (`convert_to_user_format()` — `utils.py:3234`)

```python
if chunk.get("structured_content"):
    chunk_data["content"] = ""         # 텍스트 비움
    chunk_data["structured_content"] = chunk["structured_content"]
else:
    chunk_data["content"] = chunk.get("content", "")  # 텍스트 유지
```

| 조건 | content | structured_content |
|------|---------|-------------------|
| structured_content 있음 | `""` (비움) | 구조화 데이터 포함 |
| structured_content 없음 | 원본 텍스트 유지 | 없음 |

### 6.2 Reference 레벨 경량화 (`query_routes.py`)

```python
contents = [c.get("content", "") for c in chunk_list]
ref_copy["content"] = [] if all(not c for c in contents) else contents
```

- 모든 chunk의 content가 빈 문자열이면 → `content: []` (빈 배열)
- 하나라도 텍스트가 있으면 → 전체 배열 유지

### 6.3 경량화 효과

멀티모달 처리된 문서(이미지/테이블/수식 → structured_content 보유)의 경우:
- 기존: `content`에 동일 텍스트 중복 포함 → 응답 크기 2배
- 개선: `content: []` + `structured_content`만 포함 → 응답 크기 ~50% 감소

일반 텍스트 문서(structured_content 미보유)는 기존과 동일하게 `content`에 텍스트 포함.

---

## 7. 전체 데이터 흐름 다이어그램

```
클라이언트 요청
  │  query, mode, include_references, include_chunk_content
  ▼
┌─────────────────────────────────┐
│  query_routes.py                │
│  QueryRequest → QueryParam     │
│  (include_chunk_content 제외)   │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│  lightrag.py                    │
│  aquery_llm() / aquery_data()  │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────┐
│  operate.py — kg_query() / naive_query()            │
│                                                     │
│  [검색] _perform_kg_search()                        │
│    ├─ vector 검색 → chunks (with distance/score)    │
│    ├─ entity 검색 → entity chunks                   │
│    └─ relation 검색 → relation chunks               │
│                                                     │
│  [병합] _merge_all_chunks()                         │
│    └─ 라운드로빈 + 중복제거, score 전파             │
│                                                     │
│  [컨텍스트] _build_context_str()                    │
│    ├─ process_chunks_unified()                      │
│    │   └─ 리랭킹, top_k, 토큰 자르기, score 통합   │
│    ├─ generate_reference_list_from_chunks()          │
│    │   └─ file_path 그룹핑 → reference_id 부여     │
│    ├─ _build_context_str() → LLM 프롬프트 구성     │
│    └─ convert_to_user_format()                      │
│        └─ chunks/entities/relations/references 포맷 │
│        └─ score 노출, content 경량화                │
└──────────┬──────────────────────────────────────────┘
           │
           │  result = {data: {references, chunks, ...}, llm_response: {...}}
           ▼
┌─────────────────────────────────────────────────────┐
│  query_routes.py — 후처리                           │
│                                                     │
│  if include_references AND include_chunk_content:   │
│    ├─ chunks를 reference_id로 그룹핑               │
│    ├─ content[], structured_content[] 병합          │
│    ├─ scores[] 병렬 배열 구성                       │
│    ├─ score = max(scores)                           │
│    └─ 빈 content → [] 변환                         │
│                                                     │
│  if include_references:                             │
│    └─ S3 download_url 추가                          │
│                                                     │
│  else:                                              │
│    └─ references = null                             │
└──────────┬──────────────────────────────────────────┘
           │
           ▼
        클라이언트 응답
```

---

## 8. Pydantic 모델 정의

### ReferenceItem (`query_routes.py:184`)

```python
class ReferenceItem(BaseModel):
    reference_id: str                                    # "1", "2", ...
    doc_id: Optional[str]                                # 문서 ID (S3 URL 조회용)
    file_path: str                                       # 원본 파일 경로
    download_url: Optional[str]                          # S3 다운로드 URL
    content: Optional[List[str]]                         # 텍스트 배열 ([] or ["chunk1", ...])
    structured_content: Optional[List[Dict[str, Any]]]   # 구조화 데이터 배열
    score: Optional[float]                               # 최대 유사도 점수
    scores: Optional[List[Optional[float]]]              # 개별 chunk 점수 (병렬 배열)
```

### QueryResponse (`query_routes.py:210`)

```python
class QueryResponse(BaseModel):
    response: str                                        # LLM 응답 텍스트
    references: Optional[List[ReferenceItem]]            # null or 참조 목록
```

### 파라미터 요약

| 파라미터 | 기본값 | 설명 |
|---------|--------|------|
| `include_references` | `true` | 참조 문서 목록 포함 여부 |
| `include_chunk_content` | `false` | 실제 chunk 내용/점수 포함 여부 (`include_references=true` 필수) |
