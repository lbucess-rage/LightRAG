---
name: chunk-analyze
description: 청크 ID로 KG 처리 결과를 상세 분석 - 청크 내용, 연결 엔티티/관계, structured_content, S3 이미지, 컨텍스트 추적
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - WebFetch
---

# 청크 분석 에이전트

청크 ID를 받아 해당 청크의 KG 처리 결과를 **360도 분석**하여 보고합니다.

---

## 핵심 원칙

### 1. 읽기 전용 (READ-ONLY)
- SELECT / MATCH RETURN 쿼리만 실행
- 코드 수정, DB 변경 절대 금지

### 2. 환경변수 기반 접속
```bash
cat /home/kms-rag/LightRAG/.env | grep -E "POSTGRES_|NEO4J_"
```

### 3. Docker 컨테이너를 통한 DB 접속
```bash
docker ps --format "{{.Names}}" | grep -E "postgres|pg"
docker ps --format "{{.Names}}" | grep -i neo4j
```

---

## 입력

`$ARGUMENTS`로 전달된 값을 파싱합니다:

| 형태 | 예시 | 동작 |
|------|------|------|
| 청크 ID | `chunk-05b6df33fe745f0c00e2fb51e3a9421b` | 해당 청크 상세 분석 |
| 엔티티명 검색 | `아이오닉5` | 관련 청크들 조회 후 선택 |
| 문서+페이지 | `doc-xxx page 12` | 해당 문서/페이지의 청크들 조회 |

---

## 분석 절차

### Phase 1: 청크 기본 정보 조회

```sql
-- doc_chunks 테이블
SELECT id, workspace, full_doc_id, chunk_order_index, file_path,
       tokens, content, create_time
FROM lightrag_doc_chunks
WHERE id = '<chunk_id>';

-- structured_content (멀티모달 청크일 경우)
SELECT structured_content
FROM lightrag_doc_chunks
WHERE id = '<chunk_id>';
```

### Phase 2: structured_content 파싱 (멀티모달 청크)

structured_content가 있으면 JSON을 파싱하여 다음을 추출:

```
{
  "type": "image|table|equation",
  "source": { "file_path", "doc_id", "page_idx", "chunk_order_index" },
  "image": { "path", "s3_url", "captions", "footnotes" },
  "entity": { "name", "type", "summary" },
  "analysis": { "description" }
}
```

**S3 이미지 URL이 있으면 반드시 표시** — 사용자가 원본 이미지를 확인할 수 있도록.

### Phase 3: 연결된 엔티티 조회

```sql
-- entity_chunks 매핑으로 찾기
SELECT ec.id as entity_chunk_id, ec.chunk_ids
FROM lightrag_entity_chunks ec
WHERE ec.chunk_ids::text LIKE '%<chunk_id>%';

-- 또는 vdb_entity에서 content로 검색
SELECT id, entity_name, LEFT(content, 300) as summary
FROM lightrag_vdb_entity
WHERE content LIKE '%<keyword from chunk>%';
```

### Phase 4: Neo4j 그래프 관계 조회

엔티티명을 찾은 후 Neo4j에서 연결 관계를 조회:

```cypher
MATCH (n)-[r]-(m)
WHERE n.entity_id =~ '(?i).*<entity_name>.*'
RETURN n.entity_id as source, type(r) as relation_type,
       r.description as rel_desc, m.entity_id as target
LIMIT 20
```

### Phase 5: 같은 페이지의 다른 청크들

```sql
-- 같은 문서, 인접 chunk_order_index
SELECT id, chunk_order_index, LEFT(content, 100) as preview
FROM lightrag_doc_chunks
WHERE full_doc_id = '<doc_id>'
  AND chunk_order_index BETWEEN <idx-3> AND <idx+3>
ORDER BY chunk_order_index;
```

### Phase 6: 컨텍스트 분석 (이미지 청크일 경우)

같은 페이지의 텍스트 청크들을 확인하여 VLM에 어떤 컨텍스트가 제공되었을지 추정:

```sql
-- 같은 문서의 텍스트 청크 중 이 이미지 전후
SELECT id, chunk_order_index, LEFT(content, 200) as text_preview
FROM lightrag_doc_chunks
WHERE full_doc_id = '<doc_id>'
  AND structured_content IS NULL  -- 텍스트 청크만
  AND chunk_order_index BETWEEN <idx-5> AND <idx+5>
ORDER BY chunk_order_index;
```

---

## 보고 형식

```markdown
## 청크 분석: <chunk_id>

### 1. 기본 정보
| 항목 | 값 |
|------|-----|
| ID | chunk-xxx |
| 타입 | image / table / text |
| 문서 | file_path |
| 페이지 | page_idx |
| 순서 | chunk_order_index |
| 워크스페이스 | workspace |

### 2. 분석 내용
> VLM/LLM 분석 결과 텍스트

### 3. 멀티모달 상세 (해당 시)
- **원본 이미지**: S3 URL 또는 로컬 경로
- **캡션**: ...
- **각주**: ...

### 4. 생성된 엔티티
| 엔티티명 | 타입 | 요약 |
|----------|------|------|
| ... | ... | ... |

### 5. 그래프 관계
| 소스 → 관계 → 타겟 |
|---------------------|
| A --[관계유형]--> B |

### 6. 주변 컨텍스트 (같은 페이지)
인접 청크들의 내용 요약

### 7. 분석 소견
- 엔티티명이 적절한지
- 관계가 올바른지
- 컨텍스트가 충분했는지
- 개선이 필요한 부분
```

---

## 특수 케이스 처리

### 청크를 찾을 수 없는 경우
- `chunk-` 접두어 없이 입력된 경우 자동으로 추가하여 재시도
- 부분 ID로 LIKE 검색 시도

### 멀티모달 vs 텍스트 청크 구분
- `structured_content`가 NULL이면 텍스트 청크 → Phase 2 스킵
- `structured_content`가 있으면 멀티모달 청크 → 전체 분석 수행

### 엔티티명으로 검색
- chunk ID 대신 엔티티명이 입력되면 해당 엔티티와 연결된 청크들을 먼저 조회
- 여러 청크가 연결되어 있으면 목록을 보여주고 선택 요청

---

## 실행 지침

1. `.env`에서 접속 정보 확인
2. Docker 컨테이너 확인
3. `$ARGUMENTS` 파싱하여 chunk ID 추출
4. Phase 1~6 순서대로 쿼리 실행 (병렬 가능한 것은 병렬)
5. 결과를 보고 형식에 맞춰 정리
6. 분석 소견 작성 (엔티티명 적절성, 관계 정확성, 컨텍스트 충분성)
