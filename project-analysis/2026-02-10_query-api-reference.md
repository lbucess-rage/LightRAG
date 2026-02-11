# LightRAG Query API 상세 분석

> 분석일: 2026-02-10
> 대상: `/api/query`, `/api/query/stream`, `/api/query/data`
> 분석 범위: `query_routes.py`, `lightrag.py`, `base.py`

---

## 목차

1. [API 개요 및 비교](#1-api-개요-및-비교)
2. [공통 요청 파라미터 (QueryRequest)](#2-공통-요청-파라미터)
3. [POST /api/query — 비스트리밍 응답](#3-post-apiquery--비스트리밍-응답)
4. [POST /api/query/stream — 스트리밍 응답](#4-post-apiquerystream--스트리밍-응답)
5. [POST /api/query/data — 데이터 전용 응답](#5-post-apiquerydata--데이터-전용-응답)
6. [응답 스키마 상세](#6-응답-스키마-상세)
7. [워크스페이스 결정 규칙](#7-워크스페이스-결정-규칙)
8. [사용 시나리오별 추천 API](#8-사용-시나리오별-추천-api)
9. [클라이언트 구현 가이드](#9-클라이언트-구현-가이드)
10. [파라미터 조합별 동작 매트릭스](#10-파라미터-조합별-동작-매트릭스)
11. [에러 처리](#11-에러-처리)
12. [성능 고려사항](#12-성능-고려사항)

---

## 1. API 개요 및 비교

### 1.1 3개 API 한눈에 보기

| 관점 | `/api/query` | `/api/query/stream` | `/api/query/data` |
|------|:------------:|:-------------------:|:-----------------:|
| **LLM 생성** | ✅ | ✅ | ❌ |
| **응답 형식** | JSON | NDJSON 스트림 | JSON |
| **Content-Type** | `application/json` | `application/x-ndjson` | `application/json` |
| **실시간 출력** | ❌ (완성 후 반환) | ✅ (청크 단위) | ❌ |
| **레퍼런스 포함** | 선택적 | 선택적 | 항상 포함 |
| **청크 내용 포함** | 선택적 | 선택적 | 항상 포함 |
| **엔티티/관계 데이터** | ❌ | ❌ | ✅ |
| **메타데이터** | ❌ | ❌ | ✅ |
| **stream 파라미터** | 무시됨 | 유효 | 무시됨 |
| **내부 호출** | `aquery_llm(stream=False)` | `aquery_llm(stream=*)` | `aquery_data()` |

### 1.2 핵심 차이 요약

- **`/api/query`**: 완성된 LLM 답변을 한 번에 받고 싶을 때
- **`/api/query/stream`**: LLM 답변을 실시간으로 스트리밍 받고 싶을 때 (챗 UI)
- **`/api/query/data`**: LLM 답변 없이 검색된 원본 데이터(엔티티, 관계, 청크)만 받고 싶을 때

---

## 2. 공통 요청 파라미터

### 2.1 QueryRequest 전체 필드

세 API 모두 동일한 `QueryRequest` 모델을 사용합니다.

| 파라미터 | 타입 | 기본값 | 필수 | 설명 |
|---------|------|--------|:----:|------|
| `query` | string | - | ✅ | 쿼리 텍스트 (최소 3자) |
| `mode` | string | `"mix"` | - | 쿼리 모드 (`local`/`global`/`hybrid`/`naive`/`mix`/`bypass`) |
| `stream` | boolean | `true` | - | 스트리밍 여부 (`/query/stream`만 유효) |
| `top_k` | integer | `40` | - | 엔티티/관계 VDB 검색 수 (≥ 1) |
| `chunk_top_k` | integer | `20` | - | 청크 VDB 검색 수 + 리랭킹 후 상한 (≥ 1) |
| `max_entity_tokens` | integer | `6000` | - | 엔티티 컨텍스트 토큰 한도 (≥ 1) |
| `max_relation_tokens` | integer | `8000` | - | 관계 컨텍스트 토큰 한도 (≥ 1) |
| `max_total_tokens` | integer | `30000` | - | 전체 컨텍스트 토큰 한도 (≥ 1) |
| `hl_keywords` | string[] | `[]` | - | 고수준 키워드 (빈 배열 = LLM 자동 추출) |
| `ll_keywords` | string[] | `[]` | - | 저수준 키워드 (빈 배열 = LLM 자동 추출) |
| `conversation_history` | object[] | `null` | - | 대화 이력 (`[{"role": "user/assistant", "content": "..."}]`) |
| `response_type` | string | `"Multiple Paragraphs"` | - | 응답 형식 지시 (≥ 1자) |
| `user_prompt` | string | `null` | - | 커스텀 시스템 프롬프트 |
| `enable_rerank` | boolean | `true` | - | 리랭킹 활성화 여부 |
| `include_references` | boolean | `true` | - | 레퍼런스 포함 여부 (`/query/data`는 항상 포함) |
| `include_chunk_content` | boolean | `false` | - | 레퍼런스에 청크 텍스트 포함 여부 |
| `workspace` | string | `null` | - | 대상 워크스페이스 (헤더/기본값보다 우선) |
| `only_need_context` | boolean | `null` | - | 컨텍스트만 반환 (LLM 생략) |
| `only_need_prompt` | boolean | `null` | - | 프롬프트만 반환 (LLM 생략) |

### 2.2 파라미터별 상세 설명 및 유의사항

#### `query` (필수)
```json
{"query": "머신러닝의 핵심 알고리즘은 무엇인가?"}
```
- **최소 3자** 이상 필요 (3자 미만 시 400 에러)
- 앞뒤 공백은 자동 제거 (strip)
- 쿼리가 50자 미만이고 키워드 추출에 실패하면, 전체 쿼리를 저수준 키워드로 사용
- 쿼리가 50자 이상이고 키워드 추출에 실패하면, 에러 응답 반환

#### `mode`
```json
{"mode": "mix"}
```
| 모드 | 검색 범위 | 추천 상황 |
|------|----------|----------|
| `local` | 엔티티 중심 | 특정 개체 정보 질문 |
| `global` | 관계 중심 | 넓은 주제/관계 질문 |
| `hybrid` | 엔티티 + 관계 | 복합 질문 |
| `mix` | 엔티티 + 관계 + 벡터 청크 | **기본값, 대부분의 상황에 추천** |
| `naive` | 벡터 청크만 | KG 미사용 단순 검색 |
| `bypass` | 검색 없음 | LLM 직접 대화 |

#### `top_k`
```json
{"top_k": 20}
```
- **local 모드**: 검색할 엔티티 수를 결정
- **global 모드**: 검색할 관계 수를 결정
- **hybrid/mix 모드**: 엔티티와 관계 각각에 적용
- **naive/bypass 모드**: 사용되지 않음
- 값이 클수록 더 많은 데이터를 검색하지만, 처리 시간 증가
- **유의**: 실제 반환 수는 토큰 한도에 의해 추가로 제한될 수 있음

#### `chunk_top_k`
```json
{"chunk_top_k": 10}
```
- 벡터 청크 검색 시 초기 검색 수
- 리랭킹 후 최종 유지할 청크 수의 상한
- **naive/mix 모드**에서 특히 중요 (직접 벡터 검색)
- **유의**: `top_k`보다 크게 설정하면 의미 없음 (대부분의 경우)

#### `hl_keywords` / `ll_keywords`
```json
{
  "hl_keywords": ["인공지능", "머신러닝", "딥러닝"],
  "ll_keywords": ["신경망", "CNN", "트랜스포머"]
}
```
- 빈 배열(`[]`): LLM이 쿼리에서 자동 추출 (추가 LLM 호출 1회)
- 직접 지정: LLM 키워드 추출 호출 생략 → **응답 속도 향상**
- `hl_keywords`: global 모드에서 관계 VDB 검색에 사용
- `ll_keywords`: local 모드에서 엔티티 VDB 검색에 사용
- **유의**: naive/bypass 모드에서는 무시됨

#### `conversation_history`
```json
{
  "conversation_history": [
    {"role": "user", "content": "AI란 무엇인가?"},
    {"role": "assistant", "content": "AI는 인공지능으로..."}
  ]
}
```
- **LLM 생성에만 사용** — 검색(retrieval) 결과에 영향 없음
- **캐시 키에 포함되지 않음** — 같은 쿼리는 대화 이력이 달라도 동일 캐시 결과 반환
- 각 메시지에 `role` 키가 반드시 있어야 함 (없으면 400 에러)
- `/query/data`에서는 무의미 (LLM 호출 없음)

#### `response_type`
```json
{"response_type": "Bullet Points"}
```
- LLM에게 응답 형식을 지시하는 문자열
- 예시: `"Multiple Paragraphs"`, `"Single Paragraph"`, `"Bullet Points"`, `"Table"`, `"Summary"`
- `/query/data`에서는 무의미

#### `user_prompt`
```json
{"user_prompt": "당신은 보험 전문가입니다. 질문에 대해 전문적으로 답변하세요."}
```
- 기본 시스템 프롬프트를 대체하는 커스텀 프롬프트
- **유의**: 전체 시스템 프롬프트가 교체되므로, 필요한 지시사항을 모두 포함해야 함

#### `enable_rerank`
```json
{"enable_rerank": true}
```
- `true` (기본값): 리랭크 모델로 청크를 재정렬
- `false`: 초기 벡터 검색 순서 유지
- **유의**: 리랭크 모델이 서버에 설정되어 있지 않으면, `true`여도 원본 순서 유지 (경고 로그만 출력)

#### `include_references`
```json
{"include_references": true}
```
- `/query`, `/query/stream`: 이 값에 따라 레퍼런스 포함/제외
- `/query/data`: **항상 레퍼런스 포함** (이 파라미터 무시)

#### `include_chunk_content`
```json
{"include_chunk_content": true}
```
- `true`: 레퍼런스에 원본 청크 텍스트와 `structured_content`, 관련도 `score`/`scores` 포함
- `false` (기본값): 레퍼런스에 `reference_id`와 `file_path`만 포함
- `include_references=true`일 때만 유효
- **유의**: 청크 내용이 포함되면 응답 크기가 크게 증가할 수 있음

#### `workspace`
```json
{"workspace": "my-project"}
```
워크스페이스 결정 우선순위:
1. 요청 body의 `workspace` 필드 (최우선)
2. HTTP 헤더 `LIGHTRAG-WORKSPACE`
3. 서버 기본 워크스페이스 (없으면 `"base"`)

#### `only_need_context` / `only_need_prompt`
```json
{"only_need_context": true}
```
- 디버깅/분석 용도의 고급 파라미터
- `only_need_context=true`: 검색된 컨텍스트 문자열만 반환 (LLM 미호출)
- `only_need_prompt=true`: LLM에 보낼 전체 프롬프트 반환 (LLM 미호출)
- 둘 다 true: `only_need_context` 우선
- **유의**: 일반 클라이언트에서는 사용할 필요 없음. `/query/data`를 대신 사용 추천

---

## 3. POST /api/query — 비스트리밍 응답

### 3.1 개요

LLM 답변이 완전히 생성된 후 한 번에 JSON으로 반환합니다.

### 3.2 요청 예시

```http
POST /api/query
Content-Type: application/json
LIGHTRAG-WORKSPACE: my-workspace

{
  "query": "긴급출동 서비스의 처리 절차를 알려줘",
  "mode": "mix",
  "include_references": true,
  "top_k": 20,
  "chunk_top_k": 10
}
```

### 3.3 응답 형식

```json
{
  "response": "긴급출동 서비스의 처리 절차는 다음과 같습니다...",
  "references": [
    {
      "reference_id": "1",
      "doc_id": "doc-abc123",
      "file_path": "긴급출동_메뉴얼.pdf",
      "download_url": "https://s3.example.com/..."
    },
    {
      "reference_id": "2",
      "doc_id": "doc-def456",
      "file_path": "서비스_가이드.pdf"
    }
  ]
}
```

### 3.4 응답 모델 (QueryResponse)

| 필드 | 타입 | 설명 |
|------|------|------|
| `response` | string | LLM이 생성한 답변 텍스트 |
| `references` | ReferenceItem[] \| null | 레퍼런스 목록 (`include_references=false`면 null) |

### 3.5 특징

- `stream` 파라미터가 무시됨 — 항상 `stream=False`로 강제
- 응답이 완성될 때까지 클라이언트가 대기해야 함
- LLM 캐시 히트 시 빠르게 반환
- 빈 결과 시 `response`가 `"No relevant context found for the query."`

### 3.6 적합한 상황

- 백엔드 간 API 통신 (서버 to 서버)
- 배치 처리
- 응답 전체가 필요한 후처리 로직
- 모바일 앱에서 로딩 인디케이터 표시 후 전체 결과 표시

---

## 4. POST /api/query/stream — 스트리밍 응답

### 4.1 개요

LLM 답변을 실시간으로 NDJSON(Newline-Delimited JSON) 형식으로 스트리밍합니다.

### 4.2 요청 예시

```http
POST /api/query/stream
Content-Type: application/json
LIGHTRAG-WORKSPACE: my-workspace

{
  "query": "긴급출동 서비스의 처리 절차를 알려줘",
  "mode": "mix",
  "stream": true,
  "include_references": true
}
```

### 4.3 응답 형식 (스트리밍, stream=true)

```
Content-Type: application/x-ndjson

{"references": [{"reference_id": "1", "file_path": "긴급출동_메뉴얼.pdf"}, ...]}
{"response": "긴급출동 서비스의"}
{"response": " 처리 절차는 다음과"}
{"response": " 같습니다. 첫째,"}
{"response": " 고객으로부터 긴급출동"}
{"response": " 요청을 접수합니다..."}
```

### 4.4 응답 형식 (비스트리밍, stream=false 또는 캐시 히트)

```
Content-Type: application/x-ndjson

{"references": [...], "response": "긴급출동 서비스의 처리 절차는 다음과 같습니다..."}
```

단일 라인에 레퍼런스와 전체 응답이 함께 포함됩니다.

### 4.5 응답 라인 타입

| 라인 종류 | 구조 | 설명 |
|-----------|------|------|
| 레퍼런스 | `{"references": [...]}` | 첫 번째 라인 (include_references=true일 때) |
| 응답 청크 | `{"response": "텍스트..."}` | LLM 생성 텍스트 조각 |
| 에러 | `{"error": "에러 메시지"}` | 스트리밍 중 오류 발생 시 |

### 4.6 HTTP 응답 헤더

```
Cache-Control: no-cache
Connection: keep-alive
Content-Type: application/x-ndjson
X-Accel-Buffering: no
```

- `X-Accel-Buffering: no`: Nginx 프록시 환경에서 버퍼링 방지

### 4.7 stream 파라미터 동작

| stream 값 | 실제 동작 |
|-----------|----------|
| `true` (기본값) | NDJSON 다중 라인 스트리밍 |
| `false` | NDJSON 단일 라인 (완성 후 반환) |
| (캐시 히트 시) | `true`여도 NDJSON 단일 라인 |

**주의**: `stream=false`로 설정해도 Content-Type은 `application/x-ndjson`이며, 단지 단일 라인으로 전체 응답이 반환됩니다.

### 4.8 적합한 상황

- **챗봇 UI**: 실시간 타이핑 효과
- **웹 프론트엔드**: 사용자에게 즉시 응답 표시
- **장시간 쿼리**: 응답 생성이 오래 걸릴 때 진행 상황 표시
- **대화형 인터페이스**: 레퍼런스를 먼저 표시하고 답변을 점진적으로 표시

---

## 5. POST /api/query/data — 데이터 전용 응답

### 5.1 개요

**LLM 호출 없이** 검색된 원본 데이터(엔티티, 관계, 청크, 레퍼런스)를 구조화된 JSON으로 반환합니다.

### 5.2 요청 예시

```http
POST /api/query/data
Content-Type: application/json
LIGHTRAG-WORKSPACE: my-workspace

{
  "query": "긴급출동 서비스",
  "mode": "local",
  "top_k": 10,
  "chunk_top_k": 5
}
```

### 5.3 응답 형식

```json
{
  "status": "success",
  "message": "Query executed successfully",
  "data": {
    "entities": [
      {
        "entity_name": "긴급출동서비스",
        "entity_type": "SERVICE",
        "description": "고객에게 긴급 상황 시 출동 서비스를 제공하는...",
        "source_id": "chunk-001<SEP>chunk-002",
        "file_path": "긴급출동_메뉴얼.pdf",
        "reference_id": "1"
      }
    ],
    "relationships": [
      {
        "src_id": "긴급출동서비스",
        "tgt_id": "고객",
        "description": "긴급출동서비스는 고객의 요청에 의해 시작된다",
        "keywords": "요청, 서비스, 시작",
        "weight": 0.85,
        "source_id": "chunk-001",
        "file_path": "긴급출동_메뉴얼.pdf",
        "reference_id": "1"
      }
    ],
    "chunks": [
      {
        "content": "긴급출동 서비스는 고객이 차량 고장 등의...",
        "file_path": "긴급출동_메뉴얼.pdf",
        "chunk_id": "chunk-001",
        "reference_id": "1"
      }
    ],
    "references": [
      {
        "reference_id": "1",
        "file_path": "긴급출동_메뉴얼.pdf"
      }
    ]
  },
  "metadata": {
    "query_mode": "local",
    "keywords": {
      "high_level": ["서비스", "긴급"],
      "low_level": ["긴급출동", "출동서비스"]
    },
    "processing_info": {
      "total_entities_found": 15,
      "total_relations_found": 8,
      "entities_after_truncation": 5,
      "relations_after_truncation": 3,
      "final_chunks_count": 5
    }
  }
}
```

### 5.4 응답 모델 (QueryDataResponse)

| 필드 | 타입 | 설명 |
|------|------|------|
| `status` | string | `"success"` 또는 `"failure"` |
| `message` | string | 상태 메시지 |
| `data` | object | 검색 결과 데이터 |
| `data.entities` | object[] | 엔티티 목록 |
| `data.relationships` | object[] | 관계 목록 |
| `data.chunks` | object[] | 텍스트 청크 목록 |
| `data.references` | object[] | 레퍼런스 목록 |
| `metadata` | object | 쿼리 메타데이터 |
| `metadata.query_mode` | string | 사용된 쿼리 모드 |
| `metadata.keywords` | object | 추출된 키워드 (high_level, low_level) |
| `metadata.processing_info` | object | 처리 통계 |

### 5.5 모드별 데이터 반환 차이

| 모드 | entities | relationships | chunks | references |
|------|:--------:|:-------------:|:------:|:----------:|
| local | ✅ 있음 | ✅ 있음 | ✅ 있음 | ✅ |
| global | ✅ 있음 | ✅ 있음 | ✅ 있음 | ✅ |
| hybrid | ✅ 있음 | ✅ 있음 | ✅ 있음 | ✅ |
| mix | ✅ 있음 | ✅ 있음 | ✅ 있음 | ✅ |
| naive | ❌ 빈 배열 | ❌ 빈 배열 | ✅ 있음 | ✅ |
| bypass | ❌ 빈 배열 | ❌ 빈 배열 | ❌ 빈 배열 | ❌ 빈 배열 |

### 5.6 내부 동작

```python
# query_routes.py
param = request.to_query_params(False)  # stream=False 강제
response = await workspace_rag.aquery_data(request.query, param=param)
```

`aquery_data()`는 내부적으로:
1. `only_need_context=True`와 `stream=False`를 강제 설정
2. `kg_query()` 또는 `naive_query()`를 호출하되 LLM 생성 단계를 건너뜀
3. 검색된 엔티티, 관계, 청크, 레퍼런스를 구조화하여 반환

### 5.7 적합한 상황

- **커스텀 RAG 파이프라인**: 검색 결과를 받아 자체 LLM으로 처리
- **검색 품질 분석**: 어떤 엔티티/관계가 검색되는지 확인
- **디버깅**: 검색 파이프라인 동작 검증
- **시각화**: 지식 그래프 탐색 UI
- **데이터 내보내기**: 검색 결과를 외부 시스템에 전달
- **키워드 확인**: LLM이 어떤 키워드를 추출했는지 확인
- **처리 통계 확인**: 토큰 절삭 전후 엔티티/관계 수 비교

---

## 6. 응답 스키마 상세

### 6.1 ReferenceItem 스키마

`/api/query`와 `/api/query/stream`의 레퍼런스 항목:

| 필드 | 타입 | 조건 | 설명 |
|------|------|------|------|
| `reference_id` | string | 항상 | 고유 레퍼런스 ID (숫자 문자열) |
| `doc_id` | string \| null | 있으면 | 시스템 문서 ID |
| `file_path` | string | 항상 | 소스 파일 경로 |
| `download_url` | string \| null | S3 활성화 시 | S3 다운로드 URL |
| `content` | string[] \| null | `include_chunk_content=true` | 청크 텍스트 목록 |
| `structured_content` | object[] \| null | `include_chunk_content=true` | 구조화된 청크 콘텐츠 |
| `score` | float \| null | `include_chunk_content=true` | 최고 관련도 점수 |
| `scores` | float[] \| null | `include_chunk_content=true` | 청크별 관련도 점수 |

### 6.2 include_chunk_content=true 시 레퍼런스 구조

```json
{
  "reference_id": "1",
  "doc_id": "doc-abc123",
  "file_path": "문서.pdf",
  "download_url": "https://s3.example.com/...",
  "content": [
    "첫 번째 청크 텍스트...",
    "두 번째 청크 텍스트..."
  ],
  "structured_content": [
    {"type": "table", "description": "표 분석 결과..."}
  ],
  "score": 0.92,
  "scores": [0.92, 0.85]
}
```

- `content`: 같은 파일에서 검색된 모든 청크의 텍스트 (관련도 내림차순)
- `structured_content`: 멀티모달 처리된 구조화 콘텐츠 (이미지/테이블 분석 결과 등)
- `score`: 해당 파일의 최고 관련도 점수
- `scores`: `content`/`structured_content` 배열과 병렬인 청크별 점수

### 6.3 Entity 스키마 (query/data)

| 필드 | 타입 | 설명 |
|------|------|------|
| `entity_name` | string | 엔티티 이름 |
| `entity_type` | string | 엔티티 타입 (CONCEPT, PERSON, ORG 등) |
| `description` | string | 엔티티 설명 |
| `source_id` | string | 원본 청크 ID(들) (`<SEP>` 구분) |
| `file_path` | string | 소스 파일 경로 |
| `reference_id` | string | 레퍼런스 ID |

### 6.4 Relationship 스키마 (query/data)

| 필드 | 타입 | 설명 |
|------|------|------|
| `src_id` | string | 소스 엔티티 이름 |
| `tgt_id` | string | 타겟 엔티티 이름 |
| `description` | string | 관계 설명 |
| `keywords` | string | 관련 키워드 |
| `weight` | number | 관계 가중치 |
| `source_id` | string | 원본 청크 ID(들) |
| `file_path` | string | 소스 파일 경로 |
| `reference_id` | string | 레퍼런스 ID |

---

## 7. 워크스페이스 결정 규칙

3개 API 모두 동일한 워크스페이스 결정 로직을 사용합니다:

```
우선순위 1: 요청 body의 "workspace" 필드
    │ (비어있으면)
    ▼
우선순위 2: HTTP 헤더 "LIGHTRAG-WORKSPACE"
    │ (비어있으면)
    ▼
우선순위 3: 서버 기본 워크스페이스
    │ (미설정이면)
    ▼
폴백: "base"
```

**프론트엔드 구현 시 참고:**
- `axiosInstance` 인터셉터가 자동으로 `LIGHTRAG-WORKSPACE` 헤더를 추가
- `fetch()` 직접 사용 시 헤더를 수동으로 추가해야 함

---

## 8. 사용 시나리오별 추천 API

### 8.1 시나리오 결정 트리

```
질문: 사용자에게 LLM 답변을 보여줘야 하는가?
    │
    ├── Yes → 실시간 표시가 필요한가?
    │         │
    │         ├── Yes → /api/query/stream (stream=true)
    │         │
    │         └── No → /api/query
    │
    └── No → 검색 데이터(엔티티/관계/청크)가 필요한가?
              │
              ├── Yes → /api/query/data
              │
              └── No → API 호출 불필요
```

### 8.2 구체적 시나리오별 추천

| 시나리오 | 추천 API | 추천 모드 | 핵심 파라미터 |
|---------|----------|----------|-------------|
| **챗봇 UI** | `/query/stream` | `mix` | `stream=true`, `include_references=true` |
| **검색 결과 미리보기** | `/query/data` | `mix` | `chunk_top_k=5` |
| **배치 질의응답** | `/query` | `mix` | `include_references=true` |
| **지식그래프 탐색** | `/query/data` | `local` | `top_k=20` |
| **관계 분석** | `/query/data` | `global` | `top_k=30` |
| **문서 검색** | `/query/data` | `naive` | `chunk_top_k=10` |
| **LLM 직접 대화** | `/query/stream` | `bypass` | `stream=true` |
| **검색 품질 평가** | `/query/data` | 모든 모드 | `enable_rerank=true` |
| **출처 표시 필요** | `/query` | `mix` | `include_references=true`, `include_chunk_content=true` |
| **다국어 응답** | `/query` | `mix` | `response_type="한국어로 3문장"` |

---

## 9. 클라이언트 구현 가이드

### 9.1 JavaScript/TypeScript — /api/query

```typescript
const response = await fetch('/api/query', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'LIGHTRAG-WORKSPACE': 'my-workspace',
  },
  body: JSON.stringify({
    query: '긴급출동 서비스 절차는?',
    mode: 'mix',
    include_references: true,
  }),
});

const data = await response.json();
console.log(data.response);       // LLM 답변
console.log(data.references);     // 레퍼런스 목록
```

### 9.2 JavaScript/TypeScript — /api/query/stream

```typescript
const response = await fetch('/api/query/stream', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'LIGHTRAG-WORKSPACE': 'my-workspace',
  },
  body: JSON.stringify({
    query: '긴급출동 서비스 절차는?',
    mode: 'mix',
    stream: true,
    include_references: true,
  }),
});

const reader = response.body?.getReader();
const decoder = new TextDecoder();
let references = null;
let fullResponse = '';

while (true) {
  const { done, value } = await reader!.read();
  if (done) break;

  const lines = decoder.decode(value, { stream: true }).split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const data = JSON.parse(line);

    if (data.references) {
      references = data.references;
      // 레퍼런스를 먼저 UI에 표시
    }
    if (data.response) {
      fullResponse += data.response;
      // 청크를 실시간으로 UI에 추가
    }
    if (data.error) {
      console.error('스트리밍 에러:', data.error);
    }
  }
}
```

### 9.3 JavaScript/TypeScript — /api/query/data

```typescript
const response = await fetch('/api/query/data', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'LIGHTRAG-WORKSPACE': 'my-workspace',
  },
  body: JSON.stringify({
    query: '긴급출동 서비스',
    mode: 'local',
    top_k: 10,
  }),
});

const data = await response.json();
console.log(data.status);                    // "success"
console.log(data.data.entities);             // 엔티티 목록
console.log(data.data.relationships);        // 관계 목록
console.log(data.data.chunks);               // 청크 목록
console.log(data.metadata.keywords);         // 추출된 키워드
console.log(data.metadata.processing_info);  // 처리 통계
```

### 9.4 Python — /api/query/stream

```python
import httpx
import json

async def stream_query(query: str, workspace: str = "base"):
    async with httpx.AsyncClient() as client:
        async with client.stream(
            "POST",
            "http://localhost:9422/api/query/stream",
            json={
                "query": query,
                "mode": "mix",
                "stream": True,
                "include_references": True,
            },
            headers={"LIGHTRAG-WORKSPACE": workspace},
        ) as response:
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                data = json.loads(line)

                if "references" in data:
                    print(f"References: {data['references']}")
                if "response" in data:
                    print(data["response"], end="", flush=True)
                if "error" in data:
                    print(f"\nError: {data['error']}")
```

### 9.5 cURL 예시

```bash
# /api/query
curl -X POST http://localhost:9422/api/query \
  -H "Content-Type: application/json" \
  -H "LIGHTRAG-WORKSPACE: my-workspace" \
  -d '{"query": "긴급출동 서비스 절차는?", "mode": "mix"}'

# /api/query/stream
curl -X POST http://localhost:9422/api/query/stream \
  -H "Content-Type: application/json" \
  -H "LIGHTRAG-WORKSPACE: my-workspace" \
  -d '{"query": "긴급출동 서비스 절차는?", "mode": "mix", "stream": true}' \
  --no-buffer

# /api/query/data
curl -X POST http://localhost:9422/api/query/data \
  -H "Content-Type: application/json" \
  -H "LIGHTRAG-WORKSPACE: my-workspace" \
  -d '{"query": "긴급출동 서비스", "mode": "local", "top_k": 10}'
```

---

## 10. 파라미터 조합별 동작 매트릭스

### 10.1 API별 파라미터 유효성

| 파라미터 | `/query` | `/query/stream` | `/query/data` |
|---------|:--------:|:---------------:|:-------------:|
| `query` | ✅ 유효 | ✅ 유효 | ✅ 유효 |
| `mode` | ✅ 유효 | ✅ 유효 | ✅ 유효 |
| `stream` | ❌ 무시 (항상 false) | ✅ 유효 | ❌ 무시 (항상 false) |
| `top_k` | ✅ 유효 | ✅ 유효 | ✅ 유효 |
| `chunk_top_k` | ✅ 유효 | ✅ 유효 | ✅ 유효 |
| `max_entity_tokens` | ✅ 유효 | ✅ 유효 | ✅ 유효 |
| `max_relation_tokens` | ✅ 유효 | ✅ 유효 | ✅ 유효 |
| `max_total_tokens` | ✅ 유효 | ✅ 유효 | ✅ 유효 |
| `hl_keywords` | ✅ 유효 | ✅ 유효 | ✅ 유효 |
| `ll_keywords` | ✅ 유효 | ✅ 유효 | ✅ 유효 |
| `conversation_history` | ✅ LLM에 전달 | ✅ LLM에 전달 | ❌ 무의미 |
| `response_type` | ✅ 유효 | ✅ 유효 | ❌ 무의미 |
| `user_prompt` | ✅ 유효 | ✅ 유효 | ❌ 무의미 |
| `enable_rerank` | ✅ 유효 | ✅ 유효 | ✅ 유효 |
| `include_references` | ✅ 유효 | ✅ 유효 | ❌ 무시 (항상 포함) |
| `include_chunk_content` | ✅ 유효 | ✅ 유효 | ❌ 무시 (항상 포함) |
| `workspace` | ✅ 유효 | ✅ 유효 | ✅ 유효 |
| `only_need_context` | ✅ 유효 | ✅ 유효 | ❌ 내부 강제 true |
| `only_need_prompt` | ✅ 유효 | ✅ 유효 | ❌ 무의미 |

### 10.2 모드별 유효 파라미터

| 파라미터 | local | global | hybrid | mix | naive | bypass |
|---------|:-----:|:------:|:------:|:---:|:-----:|:------:|
| `top_k` | ✅ 엔티티 | ✅ 관계 | ✅ 양쪽 | ✅ 양쪽 | ❌ 무시 | ❌ 무시 |
| `chunk_top_k` | ⚠️ KG 청크만 | ⚠️ KG 청크만 | ⚠️ KG 청크만 | ✅ 벡터+KG | ✅ 벡터 | ❌ 무시 |
| `max_entity_tokens` | ✅ | ✅ | ✅ | ✅ | ❌ 무시 | ❌ 무시 |
| `max_relation_tokens` | ✅ | ✅ | ✅ | ✅ | ❌ 무시 | ❌ 무시 |
| `hl_keywords` | ❌ 무시 | ✅ | ✅ | ✅ | ❌ 무시 | ❌ 무시 |
| `ll_keywords` | ✅ | ❌ 무시 | ✅ | ✅ | ❌ 무시 | ❌ 무시 |
| `enable_rerank` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ 무시 |

---

## 11. 에러 처리

### 11.1 HTTP 에러 코드

| 코드 | 원인 | 예시 |
|------|------|------|
| 400 | 잘못된 파라미터 | 쿼리 3자 미만, 잘못된 mode 값 |
| 401 | 인증 실패 | API 키 누락/불일치 |
| 500 | 서버 내부 에러 | LLM 서비스 불가, DB 연결 실패 |

### 11.2 스트리밍 에러 처리

`/api/query/stream`에서는 스트리밍 도중 에러가 발생할 수 있습니다:

```
{"references": [...]}
{"response": "답변 시작..."}
{"response": " 계속 진행 중에"}
{"error": "LLM service temporarily unavailable"}
```

- 부분 응답이 이미 전달된 후 에러 발생 가능
- 클라이언트는 반드시 `error` 필드를 확인해야 함
- HTTP 상태 코드는 이미 200으로 전송된 상태

### 11.3 빈 결과 처리

| API | 빈 결과 시 동작 |
|-----|---------------|
| `/query` | `response: "No relevant context found for the query."` |
| `/query/stream` | `{"response": "No relevant context found for the query."}` |
| `/query/data` | `status: "success"`, `data: {entities: [], relationships: [], chunks: [], references: []}` |

---

## 12. 성능 고려사항

### 12.1 응답 시간 요인

| 요인 | 영향 | 최적화 방법 |
|------|------|-----------|
| 키워드 추출 | LLM 1회 호출 추가 | `hl_keywords`/`ll_keywords` 직접 지정 |
| top_k 크기 | 검색·처리 시간 증가 | 필요한 만큼만 설정 (20~40 추천) |
| 리랭킹 | 추가 모델 호출 | `enable_rerank=false`로 비활성화 |
| 토큰 예산 | 큰 예산 = 더 많은 데이터 처리 | 기본값 사용 또는 줄이기 |
| LLM 캐시 | 동일 쿼리 재호출 시 즉시 반환 | 동일 파라미터 조합 활용 |
| 모드 선택 | bypass < naive < local/global < hybrid/mix | 필요한 최소 모드 선택 |

### 12.2 LLM 호출 횟수

| 모드 | 키워드 추출 | 응답 생성 | 합계 |
|------|:---------:|:--------:|:----:|
| local~mix (키워드 미지정) | 1회 | 1회 | 2회 |
| local~mix (키워드 지정) | 0회 | 1회 | 1회 |
| naive | 0회 | 1회 | 1회 |
| bypass | 0회 | 1회 | 1회 |
| `/query/data` (모든 모드) | 0~1회 | 0회 | 0~1회 |

### 12.3 캐싱 동작

- **키워드 캐시**: `(mode, query_text)` 해시 키 → 동일 쿼리의 키워드 추출 재사용
- **응답 캐시**: `(mode, query, response_type, top_k, ...)` 해시 키 → 동일 조건의 LLM 응답 재사용
- **유의**: `conversation_history`는 캐시 키에 포함되지 않음

### 12.4 추천 기본 설정

```json
{
  "mode": "mix",
  "top_k": 20,
  "chunk_top_k": 10,
  "enable_rerank": true,
  "include_references": true,
  "include_chunk_content": false
}
```

일반적인 사용에서 위 설정이 속도와 품질의 균형을 제공합니다. 성능이 중요한 경우 `top_k`와 `chunk_top_k`를 줄이고, 키워드를 직접 지정하세요.

---

## 부록: 관련 소스 파일 참조

| 파일 | 주요 내용 |
|------|----------|
| `lightrag/api/routers/query_routes.py` | API 엔드포인트 정의, QueryRequest/QueryResponse 모델, 레퍼런스 처리 |
| `lightrag/lightrag.py` | `aquery_llm()`, `aquery_data()` — 모드 디스패치 |
| `lightrag/operate.py` | `kg_query()`, `naive_query()` — 검색·생성 로직 |
| `lightrag/base.py` | `QueryParam`, `QueryResult` — 데이터 모델 |
| `lightrag/prompt.py` | `rag_response`, `naive_rag_response`, `kg_query_context` — 프롬프트 템플릿 |
| `lightrag/utils.py` | `process_chunks_unified()`, `apply_rerank_if_enabled()` — 리랭킹·청크 처리 |
