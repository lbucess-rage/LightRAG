# LightRAG 쿼리 파이프라인 분석

> 분석일: 2026-02-10
> 대상: LightRAG Query Pipeline (content 추출, 리랭킹, 스코어 측정)
> 분석 범위: `operate.py`, `utils.py`, `lightrag.py`, `prompt.py`, `constants.py`, `base.py`, `kg/postgres_impl.py`

---

## 목차

1. [전체 처리 흐름](#1-전체-처리-흐름)
2. [Content 추출 단계](#2-content-추출-단계)
3. [순위 결정 기준 (Scoring)](#3-순위-결정-기준-scoring)
4. [리랭킹 (Reranking)](#4-리랭킹-reranking)
5. [토큰 예산 관리](#5-토큰-예산-관리)
6. [쿼리 모드별 차이](#6-쿼리-모드별-차이)
7. [핵심 파라미터 요약](#7-핵심-파라미터-요약)
8. [주요 관찰 사항 및 개선 포인트](#8-주요-관찰-사항-및-개선-포인트)
9. [End-to-End 파이프라인 다이어그램](#9-end-to-end-파이프라인-다이어그램)

---

## 1. 전체 처리 흐름

```
쿼리 요청
    │
    ▼
[1] 키워드 추출 (LLM 호출)
    ├── hl_keywords (고수준: 전역적/추상적 개념)
    └── ll_keywords (저수준: 구체적 엔티티명)
    │
    ▼
[2] KG 검색 (Stage 1: Raw Search)
    ├── 엔티티 VDB 검색 (ll_keywords, cosine similarity)
    ├── 관계 VDB 검색 (hl_keywords, cosine similarity)
    └── 벡터 청크 검색 (원본 쿼리, mix/naive 모드)
    │
    ▼
[3] 토큰 절삭 (Stage 2: Token Truncation)
    ├── 엔티티: max 6,000 토큰
    └── 관계: max 8,000 토큰
    │
    ▼
[4] 청크 수집·병합 (Stage 3: Chunk Merge)
    ├── 엔티티 관련 청크 (source_id → VECTOR/WEIGHT 선택)
    ├── 관계 관련 청크 (source_id → VECTOR/WEIGHT 선택)
    └── 라운드 로빈 병합 + 중복 제거
    │
    ▼
[5] 최종 컨텍스트 조립 (Stage 4: Context Assembly)
    ├── 리랭킹 (rerank_model_func)
    ├── min_rerank_score 필터링 (≥ 0.5)
    ├── chunk_top_k 제한 (기본 20)
    └── 동적 토큰 예산 절삭
    │
    ▼
[6] LLM 생성
    └── rag_response 프롬프트 + 컨텍스트 → 최종 응답
```

---

## 2. Content 추출 단계

### 2.1 키워드 추출 (LLM 호출)

사용자 쿼리에서 LLM을 통해 두 종류의 키워드를 추출합니다.

- **소스 파일**: `operate.py` — `get_keywords_from_query()`, `extract_keywords_only()`
- **프롬프트**: `prompt.py` — `keywords_extraction` 템플릿

```python
hl_keywords, ll_keywords = await get_keywords_from_query(
    query, query_param, global_config, hashing_kv
)
```

| 키워드 종류 | 용도 | 검색 대상 |
|------------|------|----------|
| `high_level_keywords` | 전역적/추상적 개념 | 관계(Relationship) VDB |
| `low_level_keywords` | 구체적 엔티티명 | 엔티티(Entity) VDB |

- 사용자가 `hl_keywords`/`ll_keywords`를 직접 제공하면 LLM 호출 생략
- 결과는 `(mode, query_text)` 해시 키로 캐싱

### 2.2 벡터 검색 (Cosine Similarity)

PostgreSQL pgvector의 `<=>` 연산자로 **코사인 거리**를 계산합니다.

| 검색 대상 | 기본 top_k | 유사도 임계값 | 쿼리 키워드 |
|-----------|-----------|-------------|------------|
| 엔티티 VDB (`lightrag_vdb_entity`) | 40 | cosine ≥ 0.2 (거리 < 0.8) | ll_keywords |
| 관계 VDB (`lightrag_vdb_relation`) | 40 | cosine ≥ 0.2 (거리 < 0.8) | hl_keywords |
| 청크 VDB (`lightrag_vdb_chunks`) | 20 | cosine ≥ 0.2 (거리 < 0.8) | 원본 쿼리 |

#### 엔티티 검색 SQL

```sql
SELECT e.entity_name,
       EXTRACT(EPOCH FROM e.create_time)::BIGINT AS created_at
FROM LIGHTRAG_VDB_ENTITY e
WHERE e.workspace = $1
  AND e.content_vector <=> '[{embedding_string}]'::vector < $2   -- 1 - cosine_threshold
ORDER BY e.content_vector <=> '[{embedding_string}]'::vector      -- 코사인 거리 오름차순
LIMIT $3;                                                          -- top_k
```

#### 관계 검색 SQL

```sql
SELECT r.source_id AS src_id, r.target_id AS tgt_id,
       EXTRACT(EPOCH FROM r.create_time)::BIGINT AS created_at
FROM LIGHTRAG_VDB_RELATION r
WHERE r.workspace = $1
  AND r.content_vector <=> '[{embedding_string}]'::vector < $2
ORDER BY r.content_vector <=> '[{embedding_string}]'::vector
LIMIT $3;
```

#### 벡터 청크 검색 SQL (mix/naive 모드)

```sql
SELECT c.id, c.content, c.file_path, c.full_doc_id, c.structured_content,
       EXTRACT(EPOCH FROM c.create_time)::BIGINT AS created_at
FROM LIGHTRAG_VDB_CHUNKS c
WHERE c.workspace = $1
  AND c.content_vector <=> '[{embedding_string}]'::vector < $2
ORDER BY c.content_vector <=> '[{embedding_string}]'::vector
LIMIT $3;
```

### 2.3 그래프 구조 보강

엔티티 검색 후 그래프에서 추가 정보를 조회합니다:

```python
# 노드 속성 + degree 일괄 조회
nodes_dict, degrees_dict = await asyncio.gather(
    knowledge_graph_inst.get_nodes_batch(node_ids),
    knowledge_graph_inst.node_degrees_batch(node_ids),
)
```

- **소스 파일**: `operate.py` — `_get_node_data()`
- Local 모드에서 찾은 관계는 `(노드 degree 합, edge weight)` 내림차순으로 정렬
- Global 모드에서 관계 → 양쪽 엔티티 자동 탐색

### 2.4 관련 텍스트 청크 선택

엔티티/관계의 `source_id`(청크 ID 목록)에서 원본 청크를 추출합니다.

| 방식 | 기본값 | 선택 기준 | 소스 |
|------|--------|----------|------|
| **VECTOR** | ✅ (기본) | 쿼리 임베딩과 청크 임베딩의 코사인 유사도 순 | `utils.py` — `pick_by_vector_similarity()` |
| **WEIGHT** | - | 엔티티 중요도 기반 선형 가중치 할당 | `utils.py` — `pick_by_weighted_polling()` |

#### VECTOR 방식 상세

```python
def cosine_similarity(v1, v2):
    dot_product = np.dot(v1, v2)
    norm1 = np.linalg.norm(v1)
    norm2 = np.linalg.norm(v2)
    return dot_product / (norm1 * norm2)
```

- 엔티티/관계에 연결된 모든 청크 ID를 수집
- 각 청크의 임베딩과 쿼리 임베딩의 코사인 유사도 계산
- 유사도 내림차순 정렬 후 상위 N개 선택
- N = `related_chunk_number * num_entities / 2` (기본: `5 * 엔티티 수 / 2`)

#### WEIGHT 방식 상세

- 선형 그래디언트 가중 폴링: 높은 중요도 엔티티에 더 많은 청크 할당
- 위치 i의 엔티티: `max_chunks - (i/(N-1)) * (max - min)` 개 청크
- 기본값: max = 5, min = 1
- 2라운드 할당: 1차 기대값 할당 → 2차 미사용 할당량 재배포

### 2.5 결과 병합 (Round-Robin)

Local/Global 결과를 **라운드 로빈**으로 교차 병합합니다:

```python
for i in range(max_len):
    if i < len(local_entities):   # Local 엔티티 먼저
        ...
    if i < len(global_entities):  # Global 엔티티 교대
        ...
```

- 중복 제거: 동일 `chunk_id`는 첫 출현만 유지
- 3개 소스 병합 (mix 모드): vector_chunks → entity_chunks → relation_chunks

---

## 3. 순위 결정 기준 (Scoring)

검색 결과의 순위가 결정되는 기준은 단계별로 다릅니다:

| 단계 | 대상 | 정렬 기준 | 근거 |
|------|------|----------|------|
| 엔티티 검색 | `entities_vdb` | 코사인 유사도 (높은 순) | pgvector `<=>` 거리 오름차순 |
| Local 관계 | entity edges | `(노드 degree 합, edge weight)` 내림차순 | 그래프 구조 중요도 |
| Global 관계 | `relationships_vdb` | 코사인 유사도 (높은 순) | pgvector `<=>` 거리 오름차순 |
| 벡터 청크 | `chunks_vdb` | 코사인 유사도 (높은 순) | pgvector `<=>` 거리 오름차순 |
| KG 관련 청크 (VECTOR) | source chunks | 쿼리-청크 코사인 유사도 | numpy 코사인 유사도 |
| KG 관련 청크 (WEIGHT) | source chunks | 엔티티 중요도 가중치 | 선형 그래디언트 |
| **최종 청크** | **리랭킹 후** | **리랭크 모델의 relevance_score** | 외부 리랭크 모델 |

### Local 관계의 특별한 정렬

Local 모드에서 찾은 관계(edge)는 단순 유사도가 아니라, **양쪽 노드의 degree 합 + edge weight**로 정렬됩니다:

```python
# operate.py — _find_most_related_edges_from_entities()
all_edges_data = sorted(
    all_edges_data,
    key=lambda x: (x["rank"], x["weight"]),  # rank = degree_src + degree_tgt
    reverse=True
)
```

그래프 내에서 더 많이 연결된(허브) 노드 간의 관계가 우선시됩니다.

---

## 4. 리랭킹 (Reranking)

### 4.1 동작 조건

- `enable_rerank=True` (기본값, 환경변수 `RERANK_BY_DEFAULT`로 제어)
- `rerank_model_func`이 설정되어 있어야 함

### 4.2 리랭킹 함수

**소스**: `utils.py` — `apply_rerank_if_enabled()`

```python
async def apply_rerank_if_enabled(query, retrieved_docs, global_config, enable_rerank=True, top_n=None):
    if not enable_rerank or not retrieved_docs:
        return retrieved_docs

    rerank_func = global_config.get("rerank_model_func")
    if not rerank_func:
        logger.warning("Rerank is enabled but no rerank model is configured...")
        return retrieved_docs

    document_texts = [doc.get("content") or doc.get("text") or ... for doc in retrieved_docs]
    rerank_results = await rerank_func(query=query, documents=document_texts, top_n=top_n)
```

### 4.3 리랭크 결과 처리

두 가지 결과 형식을 지원합니다:

| 형식 | 구조 | 처리 방식 |
|------|------|----------|
| **인덱스 기반** (신규) | `[{"index": 0, "relevance_score": 0.85}, ...]` | 원본 문서에 인덱스 매핑 + 점수 부여 |
| **레거시** | 이미 정렬된 문서 리스트 | 그대로 사용 |

인덱스 기반 형식에서 각 청크에 `rerank_score` 필드가 추가됩니다:

```python
doc["rerank_score"] = relevance_score
```

### 4.4 리랭킹 후 필터링

```python
# utils.py — process_chunks_unified()
min_rerank_score = global_config.get("min_rerank_score", 0.5)  # 런타임 기본값

if min_rerank_score > 0.0:
    filtered_chunks = [
        chunk for chunk in unique_chunks
        if chunk.get("rerank_score", 1.0) >= min_rerank_score
    ]
```

- 리랭크 점수 0.5 미만인 청크는 제거
- `rerank_score`가 없는 청크는 `1.0`으로 간주 (통과)

### 4.5 리랭킹 파이프라인 요약

```
청크 목록 (라운드 로빈 병합 후)
    │
    ▼
[1] rerank_model_func(query, chunks, top_n=chunk_top_k)
    → relevance_score 부여, 점수 내림차순 정렬
    │
    ▼
[2] min_rerank_score 필터 (기본 ≥ 0.5)
    → 낮은 점수 청크 제거
    │
    ▼
[3] chunk_top_k 상한 적용 (기본 20)
    → 상위 20개만 유지
    │
    ▼
[4] 토큰 예산 절삭
    → available_chunk_tokens 이내로 절삭
```

---

## 5. 토큰 예산 관리

### 5.1 고정 토큰 예산

| 항목 | 기본 토큰 예산 | 상수명 |
|------|-------------|--------|
| 엔티티 컨텍스트 | 6,000 | `DEFAULT_MAX_ENTITY_TOKENS` |
| 관계 컨텍스트 | 8,000 | `DEFAULT_MAX_RELATION_TOKENS` |
| 전체 합계 | 30,000 | `DEFAULT_MAX_TOTAL_TOKENS` |

### 5.2 동적 청크 토큰 예산

```python
# operate.py — _build_context_str()
available_chunk_tokens = max_total_tokens - (
    sys_prompt_tokens +     # 시스템 프롬프트
    kg_context_tokens +     # 엔티티 + 관계 JSON
    query_tokens +          # 사용자 쿼리
    buffer_tokens           # 200 (레퍼런스 목록 + 안전 마진)
)
```

### 5.3 절삭 함수

```python
# utils.py — truncate_list_by_token_size()
def truncate_list_by_token_size(list_data, key, max_token_size, tokenizer):
    if max_token_size <= 0:
        return []
    tokens = 0
    for i, data in enumerate(list_data):
        tokens += len(tokenizer.encode(key(data)))
        if tokens > max_token_size:
            return list_data[:i]
    return list_data
```

- **순서 유지**: 앞쪽에 위치한(=점수가 높은) 항목이 우선 포함
- 누적 토큰이 예산 초과 시 즉시 중단

---

## 6. 쿼리 모드별 차이

### 6.1 모드 비교표

| 모드 | 엔티티 검색 | 관계 검색 | 벡터 청크 | 사용 키워드 |
|------|-----------|----------|----------|-----------|
| **local** | ll_keywords로 VDB 검색 | 엔티티에서 파생 (degree+weight 순) | KG source_ids만 | low-level |
| **global** | 관계에서 파생 | hl_keywords로 VDB 검색 | KG source_ids만 | high-level |
| **hybrid** | local + global 모두 | local + global 모두 | KG source_ids만 | 양쪽 모두 |
| **mix** | local + global 모두 | local + global 모두 | KG source_ids + 직접 벡터 검색 | 양쪽 모두 |
| **naive** | 없음 | 없음 | 직접 벡터 검색만 | 없음 (LLM 키워드 추출 생략) |
| **bypass** | 없음 | 없음 | 없음 | 없음 (LLM 직접 호출) |

### 6.2 모드별 상세 설명

#### Local 모드
- **저수준 키워드**(구체적 엔티티명)로 엔티티 VDB를 검색
- 검색된 엔티티에서 연결된 edge(관계)를 탐색
- 관계 정렬: `(노드 degree 합, edge weight)` 내림차순
- 특정 엔티티 중심의 질문에 적합

#### Global 모드
- **고수준 키워드**(추상적 개념)로 관계 VDB를 검색
- 검색된 관계의 양쪽 엔티티를 자동 탐색
- 관계 정렬: 코사인 유사도 순
- 넓은 범위의 주제/개념 질문에 적합

#### Hybrid 모드
- Local + Global 결과를 라운드 로빈으로 병합
- 두 가지 시각(엔티티 중심 + 관계 중심)을 동시에 활용
- 벡터 청크 직접 검색은 하지 않음

#### Mix 모드 (기본값)
- Hybrid + 벡터 청크 직접 검색
- 3가지 소스 라운드 로빈 병합: 벡터 → 엔티티 관련 → 관계 관련
- **가장 포괄적인 검색 모드**

#### Naive 모드
- KG 검색 완전 생략
- 벡터 청크 직접 검색만 수행
- `naive_rag_response` 프롬프트 사용 (엔티티/관계 컨텍스트 없음)
- 단순 시맨틱 검색에 적합

#### Bypass 모드
- 검색 없이 LLM에 직접 질문
- RAG 파이프라인 완전 우회

---

## 7. 핵심 파라미터 요약

### 7.1 QueryParam 파라미터

| 파라미터 | 기본값 | 설명 | 소스 |
|---------|--------|------|------|
| `mode` | `"mix"` | 쿼리 모드 | `base.py` |
| `top_k` | 40 | 엔티티/관계 VDB 검색 수 | `constants.py` |
| `chunk_top_k` | 20 | 벡터 청크 검색 수 & 리랭킹 후 상한 | `constants.py` |
| `max_entity_tokens` | 6,000 | 엔티티 컨텍스트 토큰 한도 | `constants.py` |
| `max_relation_tokens` | 8,000 | 관계 컨텍스트 토큰 한도 | `constants.py` |
| `max_total_tokens` | 30,000 | 전체 컨텍스트 토큰 한도 | `constants.py` |
| `enable_rerank` | `True` | 리랭킹 활성화 여부 | 환경변수 `RERANK_BY_DEFAULT` |
| `hl_keywords` | `[]` | 사용자 지정 고수준 키워드 | `base.py` |
| `ll_keywords` | `[]` | 사용자 지정 저수준 키워드 | `base.py` |
| `response_type` | `"Multiple Paragraphs"` | LLM 응답 형식 | `base.py` |

### 7.2 시스템 설정 파라미터

| 파라미터 | 기본값 | 설명 | 소스 |
|---------|--------|------|------|
| `cosine_better_than_threshold` | 0.2 | VDB 검색 최소 코사인 유사도 | `constants.py` |
| `related_chunk_number` | 5 | 엔티티/관계당 관련 청크 최대 수 | `constants.py` |
| `kg_chunk_pick_method` | `"VECTOR"` | 관련 청크 선택 방식 | `constants.py` |
| `min_rerank_score` | 0.0 (상수) / 0.5 (런타임) | 리랭킹 최소 점수 필터 | `constants.py` / `utils.py` |

---

## 8. 주요 관찰 사항 및 개선 포인트

### 8.1 리랭크 모델 미설정 시 주의

`enable_rerank=True`가 기본이지만, `rerank_model_func`이 없으면 경고만 출력하고 원본 순서 유지됩니다. 리랭킹이 사실상 비활성화된 상태일 수 있으므로 운영 환경에서 반드시 확인 필요.

```python
# 경고 메시지
logger.warning("Rerank is enabled but no rerank model is configured...")
```

### 8.2 min_rerank_score 불일치

| 위치 | 값 | 비고 |
|------|-----|------|
| `constants.py` | `DEFAULT_MIN_RERANK_SCORE = 0.0` | 상수 정의 |
| `utils.py` (`process_chunks_unified`) | `global_config.get("min_rerank_score", 0.5)` | 런타임 기본값 |

상수는 0.0이지만 런타임 코드에서는 0.5를 기본값으로 사용합니다. 이 불일치가 의도적인 것인지 확인이 필요합니다.

### 8.3 Local 관계의 Degree 기반 정렬

코사인 유사도가 아닌 그래프 구조(노드 degree + edge weight)를 기준으로 정렬되어, **허브 노드 중심의 관계가 우선**됩니다. 이는 그래프 구조 정보를 활용하는 장점이 있지만, 유사도가 높지만 degree가 낮은 특수한 관계가 누락될 수 있습니다.

### 8.4 토큰 예산의 동적 분배

청크에 할당되는 토큰 예산은 `전체 예산 - 고정 비용`으로 동적 계산됩니다. 엔티티/관계 컨텍스트가 많으면 청크에 할당되는 토큰이 줄어들어, 원본 텍스트 참조 범위가 축소될 수 있습니다.

### 8.5 Mix 모드의 청크 다양성

3가지 소스(벡터 검색, 엔티티 관련, 관계 관련)에서 라운드 로빈으로 병합하여 검색 다양성을 확보합니다. 이는 단일 소스 의존도를 낮추는 장점이 있습니다.

### 8.6 rerank_score 미존재 시 기본값

리랭크 모델이 설정되지 않은 경우 `rerank_score` 필드가 없으며, 필터링 시 기본값 `1.0`으로 처리됩니다. 따라서 모든 청크가 필터를 통과하게 됩니다.

---

## 9. End-to-End 파이프라인 다이어그램

### Mix 모드 전체 흐름

```
┌─────────────────────────────────────────────────────┐
│                    쿼리 요청                          │
│  POST /api/query  { query, mode: "mix", ... }       │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│              [1] 키워드 추출 (LLM)                    │
│  ┌──────────────────┐  ┌──────────────────────────┐ │
│  │ hl_keywords       │  │ ll_keywords              │ │
│  │ (고수준 개념)       │  │ (저수준 엔티티)            │ │
│  └────────┬─────────┘  └──────────┬───────────────┘ │
└───────────┼────────────────────────┼────────────────┘
            │                        │
            ▼                        ▼
┌───────────────────────┐ ┌──────────────────────────┐
│ [2a] Global 검색       │ │ [2b] Local 검색           │
│                       │ │                          │
│ 관계 VDB 검색          │ │ 엔티티 VDB 검색            │
│ (hl_keywords)         │ │ (ll_keywords)            │
│ cosine sim, top_k=40  │ │ cosine sim, top_k=40     │
│         │             │ │         │                │
│         ▼             │ │         ▼                │
│ 양쪽 엔티티 탐색       │ │ 연결된 edge 탐색          │
│                       │ │ (degree+weight 정렬)      │
└───────────┬───────────┘ └──────────┬───────────────┘
            │                        │
            ▼                        ▼
┌─────────────────────────────────────────────────────┐
│        [2c] 라운드 로빈 병합 + 중복 제거               │
│  local[0] → global[0] → local[1] → global[1] → ... │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│             [3] 토큰 절삭                            │
│  엔티티: truncate(max=6,000 tokens)                  │
│  관계:   truncate(max=8,000 tokens)                  │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│             [4] 청크 수집                            │
│                                                     │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────┐│
│  │벡터 청크   │  │엔티티 관련 청크│  │관계 관련 청크  ││
│  │(직접 검색) │  │(source_id)   │  │(source_id)    ││
│  │top_k=20  │  │VECTOR 방식    │  │VECTOR 방식    ││
│  └─────┬────┘  └──────┬───────┘  └──────┬─────────┘│
│        │              │                  │          │
│        ▼              ▼                  ▼          │
│     라운드 로빈 병합: vec→entity→relation (중복 제거)  │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│             [5] 리랭킹 + 필터링                       │
│                                                     │
│  ① rerank_model_func(query, chunks, top_n=20)      │
│     → relevance_score 부여, 점수 내림차순 정렬         │
│                                                     │
│  ② min_rerank_score 필터 (≥ 0.5)                    │
│     → 낮은 관련도 청크 제거                            │
│                                                     │
│  ③ chunk_top_k 상한 (20)                            │
│     → 상위 20개만 유지                                │
│                                                     │
│  ④ 토큰 예산 절삭                                    │
│     → available = 30K - prompt - KG - query - 200   │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│             [6] 컨텍스트 조립                         │
│                                                     │
│  ┌─ Knowledge Graph Data (Entity): ──────────────┐  │
│  │  { entity_name, description, ... }            │  │
│  └───────────────────────────────────────────────┘  │
│  ┌─ Knowledge Graph Data (Relationship): ────────┐  │
│  │  { src_id, tgt_id, description, ... }         │  │
│  └───────────────────────────────────────────────┘  │
│  ┌─ Document Chunks: ───────────────────────────┐   │
│  │  { reference_id, content, file_path, ... }    │  │
│  └───────────────────────────────────────────────┘  │
│  ┌─ Reference Document List: ───────────────────┐   │
│  │  ref_id → file_name (빈도 기반 ID 할당)         │  │
│  └───────────────────────────────────────────────┘  │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│             [7] LLM 생성                             │
│                                                     │
│  시스템 프롬프트: rag_response 템플릿 + 컨텍스트        │
│  사용자 메시지: 원본 쿼리 + conversation_history       │
│  → 최종 응답 생성                                    │
└─────────────────────────────────────────────────────┘
```

---

## 부록: 관련 소스 파일 참조

| 파일 | 주요 함수/영역 |
|------|-------------|
| `lightrag/operate.py` | `kg_query()`, `naive_query()`, `_build_query_context()`, `_perform_kg_search()`, `_get_node_data()`, `_get_edge_data()`, `_get_vector_context()`, `_apply_token_truncation()`, `_merge_all_chunks()`, `_build_context_str()` |
| `lightrag/utils.py` | `apply_rerank_if_enabled()`, `process_chunks_unified()`, `pick_by_vector_similarity()`, `pick_by_weighted_polling()`, `truncate_list_by_token_size()`, `cosine_similarity()` |
| `lightrag/lightrag.py` | `aquery_llm()`, `aquery_data()` |
| `lightrag/prompt.py` | `keywords_extraction`, `kg_query_context`, `rag_response`, `naive_rag_response` |
| `lightrag/base.py` | `QueryParam` dataclass |
| `lightrag/constants.py` | 기본값 상수 정의 |
| `lightrag/kg/postgres_impl.py` | VDB SQL 템플릿 (entities, relationships, chunks) |
| `lightrag/api/routers/query_routes.py` | API 엔드포인트 (`query_text`, `query_text_stream`, `query_data`) |
