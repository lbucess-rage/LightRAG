# LightRAG 프롬프트 엔지니어링 에이전트

LightRAG 시스템의 모든 프롬프트를 분석, 관리, 개선하는 전담 에이전트입니다.

## 핵심 역할

1. **프롬프트 분석**: 현재 프롬프트의 구조와 효과 분석
2. **프롬프트 개선**: 도메인 특화, 성능 최적화, 품질 향상
3. **프롬프트 관리**: API/DB를 통한 프롬프트 CRUD
4. **버전 관리**: 프롬프트 변경 이력 추적

---

## 시스템 프롬프트 구조

### 프롬프트 저장 위치

| 위치 | 설명 | 우선순위 |
|------|------|---------|
| PostgreSQL (`lightrag_prompts` 테이블) | 커스텀 프롬프트 | 높음 (우선 적용) |
| `lightrag/prompt.py` | 기본 프롬프트 | 낮음 (폴백) |

### 프롬프트 목록 및 용도

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          문서 처리 (Insert) 프롬프트                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. entity_extraction_system_prompt                                         │
│     └─ 엔티티/관계 추출을 위한 시스템 역할 정의                               │
│     └─ 변수: 없음                                                           │
│                                                                             │
│  2. entity_extraction_user_prompt                                           │
│     └─ 엔티티 추출 작업 지시                                                 │
│     └─ 변수: {entity_types}, {tuple_delimiter}, {completion_delimiter},     │
│              {examples}, {language}, {input_text}                           │
│                                                                             │
│  3. entity_continue_extraction_user_prompt                                  │
│     └─ 누락된 엔티티 추가 추출                                               │
│     └─ 변수: {entity_types}, {tuple_delimiter}, {completion_delimiter}      │
│                                                                             │
│  4. entity_extraction_examples                                              │
│     └─ Few-shot 예시 (JSON 배열)                                            │
│     └─ 변수: {tuple_delimiter}, {completion_delimiter}, {entity_types},     │
│              {language}                                                     │
│                                                                             │
│  5. summarize_entity_descriptions                                           │
│     └─ 엔티티 설명 요약/병합                                                 │
│     └─ 변수: {language}                                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                          질의 처리 (Query) 프롬프트                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  6. keywords_extraction                                                     │
│     └─ 사용자 질문에서 키워드 추출                                           │
│     └─ 변수: {query}, {examples}                                            │
│     └─ ⚠️ 현재 entity_types 미사용 (개선 필요)                              │
│                                                                             │
│  7. keywords_extraction_examples                                            │
│     └─ 키워드 추출 Few-shot 예시 (JSON 배열)                                │
│     └─ 변수: 없음                                                           │
│                                                                             │
│  8. rag_response                                                            │
│     └─ 지식그래프 기반 RAG 응답 생성                                         │
│     └─ 변수: {response_type}, {user_prompt}, {context_data}                 │
│                                                                             │
│  9. naive_rag_response                                                      │
│     └─ 단순 벡터 검색 기반 응답 생성                                         │
│     └─ 변수: {response_type}, {user_prompt}, {content_data}                 │
│                                                                             │
│  10. kg_query_context                                                       │
│      └─ 지식그래프 컨텍스트 포맷팅                                           │
│      └─ 변수: 없음 (문자열 포맷)                                             │
│                                                                             │
│  11. naive_query_context                                                    │
│      └─ 단순 컨텍스트 포맷팅                                                 │
│      └─ 변수: 없음 (문자열 포맷)                                             │
│                                                                             │
│  12. fail_response                                                          │
│      └─ 검색 실패 시 응답 메시지                                             │
│      └─ 변수: 없음                                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 프롬프트 관리 API

### 1. 전체 프롬프트 조회
```bash
curl -X GET http://localhost:9422/prompts
```

### 2. 특정 프롬프트 조회
```bash
curl -X GET http://localhost:9422/prompts/{prompt_key}
```

### 3. 프롬프트 수정
```bash
curl -X PUT http://localhost:9422/prompts/{prompt_key} \
  -H "Content-Type: application/json" \
  -d '{
    "prompt_value": "새로운 프롬프트 내용...",
    "prompt_type": "text",
    "description": "수정 설명"
  }'
```

### 4. 프롬프트 초기화 (기본값으로)
```bash
curl -X POST http://localhost:9422/prompts/reset \
  -H "Content-Type: application/json" \
  -d '{"prompt_key": "keywords_extraction"}'
```

### 5. 전체 프롬프트 초기화
```bash
curl -X POST http://localhost:9422/prompts/reset-all
```

---

## 프롬프트 파일 위치

```
/home/kms-rag/LightRAG/lightrag/prompt.py
```

### 주요 상수

```python
PROMPTS["DEFAULT_TUPLE_DELIMITER"] = "<|#|>"      # 엔티티 구분자
PROMPTS["DEFAULT_COMPLETION_DELIMITER"] = "<|COMPLETE|>"  # 완료 표시
```

---

## 프롬프트 개선 가이드라인

### 1. 키워드 추출 개선 (권장)

**현재 문제점:**
- 스키마(entity_types, relation_types)가 키워드 추출에 반영되지 않음
- 도메인 특화 키워드 추출 불가

**개선 방향:**
```python
# 현재
PROMPTS["keywords_extraction"] = """
...
User Query: {query}
"""

# 개선안
PROMPTS["keywords_extraction"] = """
...
---Available Entity Types (prioritize these)---
{entity_types}

---Available Relation Types (for context)---
{relation_types}

User Query: {query}
"""
```

### 2. 엔티티 추출 개선

**고려 사항:**
- 도메인별 예시 추가
- 컨택센터 특화 엔티티 패턴

### 3. RAG 응답 개선

**고려 사항:**
- 응답 스타일 조정
- 인용(citation) 형식 개선
- 한국어 자연스러움

---

## 프롬프트 분석 명령어

### 현재 프롬프트 확인
```bash
# API로 확인
curl -s http://localhost:9422/prompts | jq '.prompts | keys'

# 파일에서 직접 확인
grep -n "^PROMPTS\[" /home/kms-rag/LightRAG/lightrag/prompt.py
```

### 프롬프트 사용 위치 추적
```bash
# 특정 프롬프트가 사용되는 위치 찾기
grep -rn "PROMPTS\[\"keywords_extraction\"\]" /home/kms-rag/LightRAG/lightrag/
```

### DB에 저장된 커스텀 프롬프트 확인
```bash
docker exec lightrag-postgres-dev sh -c "PGPASSWORD=lightrag_dev_2024 psql -h 10.62.130.85 -U lightrag_dev -d lightrag_dev -c \"
SELECT prompt_key, LEFT(prompt_value, 100) as preview, is_active
FROM lightrag_prompts
WHERE workspace = 'base';
\""
```

---

## 프롬프트 변경 워크플로우

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. 분석 (Analysis)                                                         │
│  ─────────────────                                                          │
│  • 현재 프롬프트 내용 확인                                                   │
│  • 프롬프트 사용 위치/맥락 파악                                              │
│  • 입력 변수와 출력 형식 이해                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  2. 설계 (Design)                                                           │
│  ────────────────                                                           │
│  • 개선 목표 정의                                                            │
│  • 새 프롬프트 초안 작성                                                     │
│  • 필요한 변수 추가/수정                                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  3. 테스트 (Test)                                                           │
│  ───────────────                                                            │
│  • API로 프롬프트 임시 적용                                                  │
│  • 실제 쿼리로 동작 확인                                                     │
│  • 결과 품질 평가                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  4. 적용 (Deploy)                                                           │
│  ────────────────                                                           │
│  • 코드 수정 (prompt.py) 또는 API로 DB 저장                                 │
│  • 변경 이력 문서화                                                          │
│  • 서버 재시작 (코드 수정 시)                                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 우선순위 개선 항목

| 순위 | 프롬프트 | 개선 내용 | 예상 효과 |
|------|---------|----------|----------|
| 1 | `keywords_extraction` | 스키마 정보(entity_types) 추가 | 검색 정확도 향상 |
| 2 | `entity_extraction_examples` | 컨택센터 도메인 예시 추가 | 추출 품질 향상 |
| 3 | `rag_response` | 한국어 응답 스타일 개선 | 사용자 경험 향상 |
| 4 | `fail_response` | 더 유용한 안내 메시지 | 사용자 경험 향상 |

---

## 사용 예시

### 프롬프트 분석 요청
```
/prompt-engineering analyze keywords_extraction
```

### 프롬프트 개선 제안
```
/prompt-engineering improve keywords_extraction --add-schema-hints
```

### 프롬프트 테스트
```
/prompt-engineering test keywords_extraction --query "충전기가 연결이 안되요"
```

### 프롬프트 적용
```
/prompt-engineering apply keywords_extraction --method api
```

---

## 주의사항

1. **프롬프트 변경 전 백업**: 기존 프롬프트 내용을 반드시 기록
2. **점진적 변경**: 한 번에 하나의 프롬프트만 수정
3. **테스트 필수**: 변경 후 반드시 실제 쿼리로 테스트
4. **롤백 준비**: API reset 또는 코드 복원 방법 확보
5. **문서화**: 모든 변경 사항을 이 스킬 문서에 기록

---

## 관련 파일

| 파일 | 설명 |
|------|------|
| `/home/kms-rag/LightRAG/lightrag/prompt.py` | 기본 프롬프트 정의 |
| `/home/kms-rag/LightRAG/lightrag/operate.py` | 프롬프트 사용 로직 |
| `/home/kms-rag/LightRAG/lightrag/api/routers/prompt_routes.py` | 프롬프트 API |
| `/home/kms-rag/LightRAG/lightrag/kg/postgres_impl.py` | DB 저장 로직 |
