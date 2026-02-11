# LightRAG 쿼리 모드별 동작 방식 분석

> 분석일: 2026-02-10
> 대상: LightRAG Query Modes (local, global, hybrid, mix, naive, bypass)
> 분석 범위: `operate.py`, `lightrag.py`, `prompt.py`, `base.py`, `query_routes.py`

---

## 목차

1. [쿼리 모드 개요](#1-쿼리-모드-개요)
2. [디스패치 아키텍처](#2-디스패치-아키텍처)
3. [LOCAL 모드 상세](#3-local-모드-상세)
4. [GLOBAL 모드 상세](#4-global-모드-상세)
5. [HYBRID 모드 상세](#5-hybrid-모드-상세)
6. [MIX 모드 상세](#6-mix-모드-상세)
7. [NAIVE 모드 상세](#7-naive-모드-상세)
8. [BYPASS 모드 상세](#8-bypass-모드-상세)
9. [모드 비교 종합표](#9-모드-비교-종합표)
10. [횡단 관심사 (Cross-Cutting)](#10-횡단-관심사)
11. [API 엔드포인트별 동작](#11-api-엔드포인트별-동작)
12. [QueryParam 파라미터 참조](#12-queryparam-파라미터-참조)

---

## 1. 쿼리 모드 개요

LightRAG는 6개의 쿼리 모드를 제공하며, 각 모드는 검색 전략과 컨텍스트 구성 방식이 다릅니다.

| 모드 | 핵심 전략 | 적합한 질문 유형 |
|------|----------|----------------|
| **local** | 엔티티 중심 검색 (저수준 키워드) | "X는 무엇인가?", "X의 특성은?" |
| **global** | 관계 중심 검색 (고수준 키워드) | "X와 Y의 관계는?", "전반적 동향은?" |
| **hybrid** | Local + Global 결합 | 엔티티와 관계 모두 필요한 복합 질문 |
| **mix** | Hybrid + 벡터 청크 직접 검색 | 가장 포괄적, 기본 모드 |
| **naive** | 벡터 청크만 검색 (KG 비사용) | 단순 시맨틱 검색, RAG 기본 모드 |
| **bypass** | 검색 없이 LLM 직접 호출 | 일반 대화, 지식 불필요한 질문 |

---

## 2. 디스패치 아키텍처

### 2.1 API 진입점

파일: `lightrag/api/routers/query_routes.py`

```
POST /api/query        → query_text()     → aquery_llm(stream=False)
POST /api/query/stream → query_text_stream() → aquery_llm(stream=True)
POST /api/query/data   → query_data()     → aquery_data(only_need_context=True)
```

### 2.2 핵심 디스패처

파일: `lightrag/lightrag.py`

```
aquery_llm(query, param)
    │
    ├── mode ∈ {local, global, hybrid, mix}
    │   └── kg_query()           ← operate.py
    │
    ├── mode == "naive"
    │   └── naive_query()        ← operate.py
    │
    └── mode == "bypass"
        └── LLM 직접 호출        ← lightrag.py 내부
```

```
aquery_data(query, param)
    │
    ├── mode ∈ {local, global, hybrid, mix}
    │   └── kg_query(only_need_context=True)    ← LLM 호출 생략
    │
    ├── mode == "naive"
    │   └── naive_query(only_need_context=True)  ← LLM 호출 생략
    │
    └── mode == "bypass"
        └── 빈 데이터 반환
```

### 2.3 kg_query 내부 4-Stage 파이프라인

`kg_query()` → `_build_query_context()` 내부:

```
Stage 1: _perform_kg_search()     ← 검색 (모드별 분기)
Stage 2: _apply_token_truncation() ← 토큰 절삭
Stage 3: _merge_all_chunks()       ← 청크 수집·병합
Stage 4: _build_context_str()      ← 최종 컨텍스트 조립 (리랭킹 포함)
```

---

## 3. LOCAL 모드 상세

### 3.1 동작 흐름

```
쿼리 → 키워드 추출 → ll_keywords 사용
                       │
                       ▼
              엔티티 VDB 검색
              (ll_keywords, top_k=40, cosine ≥ 0.2)
                       │
                       ▼
              그래프에서 연결된 edge 탐색
              (degree합 + weight 내림차순 정렬)
                       │
                       ▼
              엔티티/관계 토큰 절삭
              (6,000 / 8,000 토큰)
                       │
                       ▼
              관련 청크 수집 (source_id 기반)
              ├── 엔티티 관련 청크 (VECTOR 방식)
              └── 관계 관련 청크 (VECTOR 방식)
                       │
                       ▼
              라운드 로빈 병합 → 리랭킹 → LLM 생성
```

### 3.2 검색 단계

**함수**: `_perform_kg_search()` → `_get_node_data(ll_keywords)`

1. **엔티티 벡터 검색**: `entities_vdb.query(ll_keywords, top_k=40)`
   - 코사인 유사도 기반, 임계값 ≥ 0.2
   - 결과: 유사도 내림차순 정렬

2. **그래프 보강**: 검색된 엔티티의 노드 속성 + degree 일괄 조회
   ```python
   nodes_dict, degrees_dict = await asyncio.gather(
       knowledge_graph_inst.get_nodes_batch(node_ids),
       knowledge_graph_inst.node_degrees_batch(node_ids),
   )
   ```

3. **관련 edge 탐색**: `_find_most_related_edges_from_entities()`
   - 검색된 엔티티에 연결된 모든 edge를 수집
   - **정렬 기준**: `(rank, weight)` 내림차순
   - `rank` = 양쪽 노드의 degree 합 (허브 노드 우선)
   - `weight` = edge 가중치

### 3.3 검색하지 않는 것

- ❌ 관계 VDB 직접 검색 (`_get_edge_data` 미호출)
- ❌ 청크 VDB 직접 검색 (`_get_vector_context` 미호출)
- ❌ hl_keywords 사용하지 않음

### 3.4 청크 선택

엔티티/관계의 `source_id`에서 원본 청크 ID를 추출하여 선택:
- **VECTOR 방식** (기본): 쿼리 임베딩과 청크 임베딩의 코사인 유사도 순
- 엔티티 관련 청크 소스: `"E"`, 관계 관련 청크 소스: `"R"`

### 3.5 프롬프트

- **컨텍스트 템플릿**: `PROMPTS["kg_query_context"]` (엔티티 + 관계 + 청크 + 레퍼런스)
- **LLM 프롬프트**: `PROMPTS["rag_response"]` (KG 데이터 + 문서 청크 통합 안내)

### 3.6 적합한 사용 시나리오

- 특정 엔티티에 대한 상세 정보 질문
- "X는 무엇인가?", "X의 정의를 알려줘"
- 구체적인 사실 확인 질문

---

## 4. GLOBAL 모드 상세

### 4.1 동작 흐름

```
쿼리 → 키워드 추출 → hl_keywords 사용
                       │
                       ▼
              관계 VDB 검색
              (hl_keywords, top_k=40, cosine ≥ 0.2)
                       │
                       ▼
              양쪽 엔티티 자동 탐색
              (발견 순서 유지, 정렬 없음)
                       │
                       ▼
              엔티티/관계 토큰 절삭
              (6,000 / 8,000 토큰)
                       │
                       ▼
              관련 청크 수집 (source_id 기반)
              ├── 엔티티 관련 청크
              └── 관계 관련 청크
                       │
                       ▼
              라운드 로빈 병합 → 리랭킹 → LLM 생성
```

### 4.2 검색 단계

**함수**: `_perform_kg_search()` → `_get_edge_data(hl_keywords)`

1. **관계 벡터 검색**: `relationships_vdb.query(hl_keywords, top_k=40)`
   - 코사인 유사도 기반, 임계값 ≥ 0.2
   - 결과: **코사인 유사도 내림차순** 정렬 (Local 모드와 다름!)

2. **양쪽 엔티티 탐색**: `_find_most_related_entities_from_relationships()`
   - 관계의 양쪽 엔티티 이름을 수집
   - 노드 데이터 일괄 조회
   - **발견 순서** 유지 (degree 기반 정렬 없음)

### 4.3 Local 모드와의 핵심 차이

| 관점 | LOCAL | GLOBAL |
|------|-------|--------|
| **진입점** | 엔티티 VDB → edge 탐색 | 관계 VDB → 엔티티 탐색 |
| **키워드** | ll_keywords (구체적) | hl_keywords (추상적) |
| **관계 정렬** | degree합 + weight 내림차순 | 코사인 유사도 내림차순 |
| **엔티티 정렬** | 코사인 유사도 | 발견 순서 (정렬 없음) |

### 4.4 검색하지 않는 것

- ❌ 엔티티 VDB 직접 검색 (`_get_node_data` 미호출)
- ❌ 청크 VDB 직접 검색 (`_get_vector_context` 미호출)
- ❌ ll_keywords 사용하지 않음

### 4.5 적합한 사용 시나리오

- 넓은 주제나 개념에 대한 질문
- "X 분야의 전반적인 동향은?", "X와 Y의 관계는?"
- 추상적/개념적 질문

---

## 5. HYBRID 모드 상세

### 5.1 동작 흐름

```
쿼리 → 키워드 추출 → ll_keywords + hl_keywords 모두 사용
                       │
           ┌───────────┴───────────┐
           ▼                       ▼
    엔티티 VDB 검색          관계 VDB 검색
    (ll_keywords)           (hl_keywords)
           │                       │
           ▼                       ▼
    연결된 edge 탐색        양쪽 엔티티 탐색
    (degree+weight)        (발견 순서)
           │                       │
           └───────────┬───────────┘
                       ▼
              라운드 로빈 병합 (중복 제거)
              local[0] → global[0] → local[1] → global[1] → ...
                       │
                       ▼
              엔티티/관계 토큰 절삭 → 청크 수집 → 리랭킹 → LLM 생성
```

### 5.2 검색 단계

**Local 검색 + Global 검색 동시 실행:**

```python
# _perform_kg_search() 내부
if len(ll_keywords) > 0:
    local_entities, local_relations = await _get_node_data(ll_keywords, ...)

if len(hl_keywords) > 0:
    global_relations, global_entities = await _get_edge_data(hl_keywords, ...)
```

### 5.3 병합 전략

**엔티티 라운드 로빈 병합:**
```python
for i in range(max(len(local_entities), len(global_entities))):
    if i < len(local_entities):
        # local 엔티티 추가 (중복 아닌 경우)
    if i < len(global_entities):
        # global 엔티티 추가 (중복 아닌 경우)
```

- 중복 판별: `entity_name` 기준
- **Local 엔티티가 같은 인덱스에서 우선** (먼저 추가)

**관계 라운드 로빈 병합:**
- 중복 판별: `sorted((src, tgt))` 튜플 기준
- 동일 패턴: Local 관계 우선

### 5.4 검색하지 않는 것

- ❌ 청크 VDB 직접 검색 (`_get_vector_context` 미호출)
- 벡터 청크 직접 검색 없음 — KG에서 파생된 청크만 사용

### 5.5 적합한 사용 시나리오

- 엔티티와 관계 정보 모두 필요한 복합 질문
- "X 기관에서 Y 프로젝트를 어떻게 진행했나?"
- 구체적 사실 + 맥락적 관계 동시 필요

---

## 6. MIX 모드 상세

### 6.1 동작 흐름 (기본 모드)

```
쿼리 → 키워드 추출 → ll_keywords + hl_keywords 모두 사용
                       │
     ┌─────────────────┼─────────────────┐
     ▼                 ▼                 ▼
엔티티 VDB 검색   관계 VDB 검색    청크 VDB 검색
(ll_keywords)    (hl_keywords)    (원본 쿼리)
     │                 │                 │
     ▼                 ▼                 │
edge 탐색         엔티티 탐색           │
     │                 │                 │
     └────────┬────────┘                 │
              ▼                          │
   라운드 로빈 병합 (중복 제거)            │
              │                          │
              ▼                          │
   엔티티/관계 토큰 절삭                   │
              │                          │
              ▼                          │
   KG 관련 청크 수집                      │
   ├── 엔티티 관련 (source_id)            │
   └── 관계 관련 (source_id)              │
              │                          │
              └──────────┬───────────────┘
                         ▼
              3-소스 라운드 로빈 청크 병합
              vector[0] → entity[0] → relation[0] → ...
                         │
                         ▼
              리랭킹 → 필터링 → 토큰 절삭 → LLM 생성
```

### 6.2 Hybrid와의 핵심 차이: 벡터 청크 직접 검색

```python
# _perform_kg_search() 내부
if query_param.mode == "mix" and chunks_vdb:
    vector_chunks = await _get_vector_context(query, chunks_vdb, query_param, query_embedding)
```

- **Hybrid**: KG에서 파생된 청크만 사용 (2-소스 병합)
- **Mix**: KG 파생 청크 + 벡터 직접 검색 청크 (3-소스 병합)

### 6.3 벡터 청크 직접 검색

**함수**: `_get_vector_context()`

```python
search_top_k = query_param.chunk_top_k or query_param.top_k  # 기본 20
results = await chunks_vdb.query(query, top_k=search_top_k, query_embedding=query_embedding)
```

- 원본 쿼리 텍스트로 직접 검색 (키워드가 아님)
- `structured_content`가 있으면 KV 스토어에서 보강
- 청크 소스: `"C"` (Vector Chunk)

### 6.4 3-소스 청크 병합

```python
# _merge_all_chunks() 내부
for i in range(max_len):
    if i < len(vector_chunks):    # 벡터 직접 검색 (Mix 전용)
        ...
    if i < len(entity_chunks):    # 엔티티 관련
        ...
    if i < len(relation_chunks):  # 관계 관련
        ...
```

- 중복 제거: `chunk_id` 기준 (최초 출현만 유지)
- 벡터 청크가 라운드 로빈에서 첫 번째 → 직접 관련성 높은 청크 우선

### 6.5 KG 검색 실패 시 폴백

```python
if not search_result["final_entities"] and not search_result["final_relations"]:
    if query_param.mode != "mix":
        return None      # local/global/hybrid: 실패
    else:
        if not search_result["chunk_tracking"]:
            return None  # mix: 벡터 청크도 없으면 실패
        # mix: 벡터 청크만으로도 계속 진행 가능!
```

**Mix 모드만의 특별한 동작**: KG 검색 결과가 0이어도 벡터 청크가 있으면 응답 생성 가능.

### 6.6 적합한 사용 시나리오

- **기본 모드 (추천)**: 대부분의 질문에 가장 포괄적인 결과
- KG가 충분하지 않아도 벡터 검색으로 보완
- 새로운 도메인/문서에서 아직 KG가 완성되지 않은 경우

---

## 7. NAIVE 모드 상세

### 7.1 동작 흐름

```
쿼리 → (키워드 추출 없음)
         │
         ▼
  청크 VDB 직접 검색
  (원본 쿼리, chunk_top_k=20)
         │
         ▼
  리랭킹 → min_rerank_score 필터 → chunk_top_k 제한
         │
         ▼
  토큰 예산 절삭
         │
         ▼
  naive_query_context 템플릿 조립
         │
         ▼
  naive_rag_response 프롬프트 → LLM 생성
```

### 7.2 완전히 독립된 코드 경로

**함수**: `naive_query()` — `kg_query()`와 완전히 별개

```python
# operate.py — naive_query()
# 1. 키워드 추출 없음
# 2. 벡터 청크만 검색
vector_chunks = await _get_vector_context(query, chunks_vdb, query_param, None)
```

### 7.3 KG 모드와의 차이

| 관점 | KG 모드 (local~mix) | NAIVE 모드 |
|------|---------------------|-----------|
| 키워드 추출 | LLM 호출 | 없음 |
| 엔티티/관계 검색 | 있음 | 없음 |
| 컨텍스트에 엔티티 | 포함 | 미포함 |
| 컨텍스트에 관계 | 포함 | 미포함 |
| 청크 소스 | KG 파생 + (벡터 직접) | 벡터 직접만 |
| 컨텍스트 템플릿 | `kg_query_context` | `naive_query_context` |
| LLM 프롬프트 | `rag_response` | `naive_rag_response` |

### 7.4 컨텍스트 템플릿

**`naive_query_context`** (prompt.py):
```
Document Chunks (Each entry has a reference_id...):
```json
{text_chunks_str}
```

Reference Document List:
```
{reference_list_str}
```
```

엔티티/관계 섹션이 **완전히 없음**.

### 7.5 LLM 프롬프트 차이

**`rag_response`** (KG 모드):
> "integrate relevant facts from the **Knowledge Graph and Document Chunks**"

**`naive_rag_response`** (Naive 모드):
> "integrate relevant facts from the **Document Chunks**"

Knowledge Graph에 대한 언급이 완전히 제거됨.

### 7.6 반환 데이터

```python
raw_data = convert_to_user_format(
    [],   # 엔티티 없음
    [],   # 관계 없음
    processed_chunks_with_ref_ids,
    reference_list,
    "naive",
)
```

### 7.7 적합한 사용 시나리오

- 전통적인 RAG 방식이 필요한 경우
- KG 구축 전 초기 단계
- 벡터 유사도 기반의 단순 검색
- KG 품질이 낮아서 노이즈가 많을 때 우회

---

## 8. BYPASS 모드 상세

### 8.1 동작 흐름

```
쿼리 → LLM 직접 호출 (검색 없음)
         │
         ▼
  LLM(query, system_prompt, conversation_history)
         │
         ▼
  응답 반환 (데이터 없음)
```

### 8.2 코드 경로

**`aquery_llm()` 내부에서 직접 처리** (lightrag.py):

```python
elif param.mode == "bypass":
    use_llm_func = param.model_func or global_config["llm_model_func"]
    use_llm_func = partial(use_llm_func, _priority=8)  # 최고 우선순위
    response = await use_llm_func(
        query.strip(),
        system_prompt=system_prompt,
        history_messages=param.conversation_history,
        enable_cot=True,
        stream=param.stream,
    )
```

### 8.3 특징

- **검색 없음**: 벡터 검색, KG 검색 모두 생략
- **키워드 추출 없음**: LLM 키워드 추출 호출 없음
- **컨텍스트 없음**: 외부 지식 주입 없음
- **최고 LLM 우선순위**: `_priority=8` (다른 모드는 5)
- **chain-of-thought 활성화**: `enable_cot=True`

### 8.4 반환 데이터

```python
# aquery_data()에서 bypass 처리
empty_raw_data = convert_to_user_format([], [], [], [], "bypass")
# → 모든 데이터가 비어있음
```

### 8.5 적합한 사용 시나리오

- LLM의 내장 지식만으로 충분한 질문
- 일반 대화 (인사, 간단한 설명)
- 검색이 불필요한 창의적 작업
- 시스템 테스트 (LLM 응답 확인)

---

## 9. 모드 비교 종합표

### 9.1 검색 동작 비교

| 관점 | LOCAL | GLOBAL | HYBRID | MIX | NAIVE | BYPASS |
|------|:-----:|:------:|:------:|:---:|:-----:|:------:|
| 키워드 추출 | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| ll_keywords 사용 | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| hl_keywords 사용 | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| 엔티티 VDB 검색 | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| 관계 VDB 검색 | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| 청크 VDB 직접 검색 | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| KG 관련 청크 수집 | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |

### 9.2 정렬/순위 비교

| 관점 | LOCAL | GLOBAL | HYBRID | MIX | NAIVE | BYPASS |
|------|-------|--------|--------|-----|-------|--------|
| 엔티티 정렬 | cosine sim | 발견 순서 | 라운드 로빈 | 라운드 로빈 | N/A | N/A |
| 관계 정렬 | degree+weight | cosine sim | 라운드 로빈 | 라운드 로빈 | N/A | N/A |
| 청크 병합 | E+R 라운드로빈 | E+R 라운드로빈 | E+R 라운드로빈 | V+E+R 라운드로빈 | 단일 소스 | N/A |

### 9.3 프롬프트/컨텍스트 비교

| 관점 | LOCAL | GLOBAL | HYBRID | MIX | NAIVE | BYPASS |
|------|-------|--------|--------|-----|-------|--------|
| 디스패처 함수 | `kg_query()` | `kg_query()` | `kg_query()` | `kg_query()` | `naive_query()` | 직접 호출 |
| 컨텍스트 템플릿 | `kg_query_context` | `kg_query_context` | `kg_query_context` | `kg_query_context` | `naive_query_context` | 없음 |
| LLM 프롬프트 | `rag_response` | `rag_response` | `rag_response` | `rag_response` | `naive_rag_response` | 없음 |
| 컨텍스트에 엔티티 | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| 컨텍스트에 관계 | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| KG 빈 상태에서 동작 | ❌ | ❌ | ❌ | ✅* | ✅ | ✅ |
| LLM 우선순위 | 5 | 5 | 5 | 5 | 5 | 8 |

\* Mix 모드는 벡터 청크가 있으면 KG가 비어도 동작 가능

---

## 10. 횡단 관심사

### 10.1 only_need_context 동작

**KG 모드 (local~mix):**
```python
# kg_query() 내부
if query_param.only_need_context and not query_param.only_need_prompt:
    return QueryResult(content=context_result.context, raw_data=context_result.raw_data)
    # → LLM 호출 생략, 컨텍스트 문자열 반환
```

**Naive 모드:**
```python
# naive_query() 내부
if query_param.only_need_context and not query_param.only_need_prompt:
    return QueryResult(content=context_content, raw_data=raw_data)
```

**Bypass 모드:**
```python
# aquery_data() 내부
empty_raw_data = convert_to_user_format([], [], [], [], "bypass")
# → 빈 데이터 반환 (검색할 컨텍스트 없음)
```

### 10.2 only_need_prompt 동작

```python
# kg_query(), naive_query() 공통
if query_param.only_need_prompt:
    prompt_content = "\n\n".join([sys_prompt, "---User Query---", user_query])
    return QueryResult(content=prompt_content, raw_data=...)
    # → LLM에 보낼 전체 프롬프트 반환 (LLM 호출 생략)
```

**우선순위:**
| only_need_context | only_need_prompt | 결과 |
|:-:|:-:|------|
| False | False | 전체 실행 (검색 + LLM) |
| True | False | 컨텍스트만 반환 |
| False | True | 프롬프트만 반환 |
| True | True | 컨텍스트만 반환 (context 우선) |

### 10.3 conversation_history 처리

**모든 모드 공통:**
- LLM 호출 시 `history_messages=param.conversation_history`으로 전달
- **키워드 추출에는 사용되지 않음** → 대화 맥락이 검색에 반영되지 않음
- **캐시 키에 포함되지 않음** → 같은 쿼리는 대화 이력이 달라도 같은 캐시 결과 반환

### 10.4 스트리밍 vs 비스트리밍

| 관점 | 비스트리밍 (`/query`) | 스트리밍 (`/query/stream`) |
|------|----------------------|--------------------------|
| 파라미터 | `stream=False` | `stream=True` |
| LLM 반환 | `str` | `AsyncIterator` |
| QueryResult | `content=response` | `response_iterator=response` |
| API 응답 | JSON 단일 응답 | NDJSON 스트림 |
| 레퍼런스 전달 | 응답 JSON에 포함 | 스트림 첫 번째 라인 |
| 캐시 히트 시 | 문자열 반환 | 비스트리밍으로 폴백 |

### 10.5 캐시 키 구성

**키워드 캐시:**
- 키: `hash(mode, text)`
- 타입: `"keywords"`

**쿼리 응답 캐시:**
- 키: `hash(mode, query, response_type, top_k, chunk_top_k, max_entity_tokens, max_relation_tokens, max_total_tokens, hl_keywords_str, ll_keywords_str, user_prompt, enable_rerank)`
- 타입: `"query"`
- **주의**: `conversation_history`는 캐시 키에 미포함

### 10.6 키워드 추출 폴백

```python
# kg_query() 내부
if hl_keywords == [] and ll_keywords == []:
    if len(query) < 50:
        ll_keywords = [query]   # 짧은 쿼리: 전체를 ll_keyword로 사용
    else:
        return QueryResult(content=PROMPTS["fail_response"])  # 긴 쿼리: 실패 응답
```

- 50자 미만 쿼리: 쿼리 전체를 저수준 키워드로 사용
- 50자 이상 쿼리: 키워드 추출 실패 시 에러 응답 반환

---

## 11. API 엔드포인트별 동작

### 11.1 POST /api/query (query_text)

```
요청: { query, mode, top_k, ... }
처리: aquery_llm(stream=False)
응답: { response: "LLM 답변", references: [...] }  (선택적)
```

- `include_references=True`일 때만 레퍼런스 포함
- 단일 JSON 응답

### 11.2 POST /api/query/stream (query_text_stream)

```
요청: { query, mode, stream: true, ... }
처리: aquery_llm(stream=True)
응답: NDJSON 스트림
  Line 1: { type: "references", data: [...] }    (레퍼런스 먼저)
  Line 2+: { type: "chunk", data: "텍스트..." }   (응답 청크)
  Last:    { type: "done" }                        (종료 신호)
```

### 11.3 POST /api/query/data (query_data)

```
요청: { query, mode, top_k, ... }
처리: aquery_data(only_need_context=True, stream=False)
응답: {
  status: "success",
  data: {
    entities: [...],
    relationships: [...],
    chunks: [...],
    references: [...]
  },
  metadata: { mode, ... }
}
```

- LLM 호출 없음 — 검색 데이터만 반환
- Bypass 모드: 빈 데이터 반환

---

## 12. QueryParam 파라미터 참조

파일: `lightrag/base.py`

| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|--------|------|
| `mode` | Literal | `"mix"` | 쿼리 모드 |
| `only_need_context` | bool | `False` | 컨텍스트만 반환 (LLM 생략) |
| `only_need_prompt` | bool | `False` | 프롬프트만 반환 (LLM 생략) |
| `response_type` | str | `"Multiple Paragraphs"` | 응답 형식 지시 |
| `stream` | bool | `False` | 스트리밍 여부 |
| `top_k` | int | `40` | 엔티티/관계 VDB 검색 수 |
| `chunk_top_k` | int | `20` | 청크 VDB 검색 수 + 리랭킹 후 상한 |
| `max_entity_tokens` | int | `6,000` | 엔티티 컨텍스트 토큰 한도 |
| `max_relation_tokens` | int | `8,000` | 관계 컨텍스트 토큰 한도 |
| `max_total_tokens` | int | `30,000` | 전체 컨텍스트 토큰 한도 |
| `hl_keywords` | list[str] | `[]` | 사용자 지정 고수준 키워드 |
| `ll_keywords` | list[str] | `[]` | 사용자 지정 저수준 키워드 |
| `conversation_history` | list[dict] | `[]` | 대화 이력 |
| `model_func` | Callable\|None | `None` | 커스텀 LLM 함수 |
| `user_prompt` | str\|None | `None` | 커스텀 시스템 프롬프트 |
| `enable_rerank` | bool | `True` | 리랭킹 활성화 |
| `include_references` | bool | `False` | 레퍼런스 포함 여부 |

---

## 부록: 모드 선택 가이드

```
질문 유형 분석
    │
    ├── 특정 엔티티에 대한 질문? ──── Yes ──→ LOCAL
    │
    ├── 관계/동향/개념적 질문? ──── Yes ──→ GLOBAL
    │
    ├── 엔티티+관계 복합 질문? ──── Yes ──→ HYBRID
    │
    ├── 확실하지 않음? ──── Yes ──→ MIX (기본값, 추천)
    │
    ├── KG 품질이 낮음/없음? ──── Yes ──→ NAIVE
    │
    └── 검색 불필요? ──── Yes ──→ BYPASS
```

### 모드별 비용 (LLM 호출 수)

| 모드 | 키워드 추출 | 쿼리 응답 | 합계 |
|------|:---------:|:--------:|:----:|
| LOCAL | 1회 (캐싱) | 1회 | 2회 |
| GLOBAL | 1회 (캐싱) | 1회 | 2회 |
| HYBRID | 1회 (캐싱) | 1회 | 2회 |
| MIX | 1회 (캐싱) | 1회 | 2회 |
| NAIVE | 0회 | 1회 | 1회 |
| BYPASS | 0회 | 1회 | 1회 |

Naive와 Bypass는 키워드 추출이 없어 LLM 호출이 1회 적음.

---

## 부록: 관련 소스 파일 참조

| 파일 | 주요 함수/영역 |
|------|-------------|
| `lightrag/operate.py` | `kg_query()`, `naive_query()`, `_perform_kg_search()`, `_build_query_context()`, `_get_node_data()`, `_get_edge_data()`, `_get_vector_context()`, `_merge_all_chunks()`, `_build_context_str()`, `_apply_token_truncation()`, `_find_related_text_unit_from_entities()`, `_find_related_text_unit_from_relations()`, `get_keywords_from_query()`, `extract_keywords_only()` |
| `lightrag/lightrag.py` | `aquery_llm()`, `aquery_data()` |
| `lightrag/prompt.py` | `keywords_extraction`, `kg_query_context`, `naive_query_context`, `rag_response`, `naive_rag_response`, `fail_response` |
| `lightrag/base.py` | `QueryParam`, `QueryResult` |
| `lightrag/utils.py` | `process_chunks_unified()`, `apply_rerank_if_enabled()`, `pick_by_vector_similarity()`, `pick_by_weighted_polling()`, `truncate_list_by_token_size()` |
| `lightrag/constants.py` | `DEFAULT_TOP_K`, `DEFAULT_CHUNK_TOP_K`, `DEFAULT_MAX_ENTITY_TOKENS`, `DEFAULT_MAX_RELATION_TOKENS`, `DEFAULT_MAX_TOTAL_TOKENS`, `DEFAULT_COSINE_THRESHOLD` |
| `lightrag/api/routers/query_routes.py` | `query_text()`, `query_text_stream()`, `query_data()`, `QueryRequest`, `QueryResponse` |
