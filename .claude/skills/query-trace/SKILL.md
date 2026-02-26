---
name: query-trace
description: LightRAG 쿼리 처리 과정을 추적하고 분석하는 트레이스 에이전트 - 실시간 로그 모니터링 또는 직접 쿼리 실행
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - AskUserQuestion
---

# LightRAG 쿼리 트레이스 에이전트

쿼리 처리 과정을 추적하여 키워드 추출, 엔티티/관계 검색, 청크 선택, 리랭킹 등 각 단계의 결과를 분석합니다.

---

## 핵심 원칙

### 1. 읽기 전용 (READ-ONLY)
- 코드 수정 금지 (Edit, Write 사용 금지)
- DB 데이터 변경 금지
- 서버 시작/중지 금지

### 2. 환경변수 기반 접속
`.env` 파일에서 접속 정보를 읽습니다:
```bash
source <(grep -E "^POSTGRES_" /home/kms-rag/LightRAG/.env | sed 's/^/export /')
```

PostgreSQL 접속:
```bash
docker exec -e PGPASSWORD=<password> lightrag-postgres-dev psql -h <host> -U <user> -d <db> -c "<SQL>"
```

---

## 사용 모드

사용자가 전달한 인자를 파싱하여 모드를 결정합니다.

### 모드 1: 실시간 모니터링 (`monitor` 또는 인자 없음)
현재 진행 중인 쿼리의 로그를 실시간으로 캡처합니다.

**실행 방법:**
1. 현재 로그 라인 수 기록: `wc -l /tmp/lightrag-server.log`
2. 사용자에게 "쿼리를 보내주세요" 안내
3. 새 로그 감지 후 캡처:
```bash
# 쿼리 관련 로그 패턴 (폴링 제외)
tail -n +<start_line> /tmp/lightrag-server.log | grep -E "(Query nodes|Query edges|Local query|Global query|Naive query|Raw search|After truncation|Selecting|Round-robin|rerank|Final context|Final chunks|POST /query)"
```

### 모드 2: 직접 쿼리 실행 (`query <질문텍스트>`)
API를 직접 호출하고 로그를 분석합니다.

**실행 방법:**
1. 현재 로그 라인 수 기록
2. API 호출:
```bash
curl -s -X POST http://localhost:9422/query \
  -H "Content-Type: application/json" \
  -H "LIGHTRAG-WORKSPACE: kevcs" \
  -d '{
    "query": "<질문텍스트>",
    "mode": "hybrid",
    "only_need_context": false,
    "include_references": true,
    "stream": false
  }'
```
3. 로그 캡처 및 분석
4. API 응답과 로그를 함께 보고

**기본 파라미터** (필요 시 사용자가 오버라이드):
- `mode`: `hybrid`
- `stream`: `false` (트레이스용)
- `include_references`: `true`
- `workspace`: `kevcs` (기본값, 사용자 지정 가능)

### 모드 3: 로그 분석 (`analyze` 또는 `last`)
가장 최근 쿼리의 로그를 분석합니다.

```bash
# 마지막 쿼리 로그 블록 추출
grep -n "Query nodes:" /tmp/lightrag-server.log | tail -1
# 해당 라인부터 "POST /query" 까지 추출
```

---

## 로그 분석 항목

쿼리 로그에서 다음 항목을 추출하여 보고합니다:

### 1. 키워드 추출 (LLM 단계)
```
Query nodes: <노드 검색 키워드> (top_k, cosine)
Query edges: <관계 검색 키워드> (top_k, cosine)
```
- 원본 쿼리에서 LLM이 어떤 키워드를 추출했는지
- 기대 키워드가 누락됐는지 확인

### 2. 검색 결과 (3가지 검색)
```
Local query:  N entities, M relations   ← 엔티티 벡터 검색
Global query: N entities, M relations   ← 관계 벡터 검색
Naive query:  N chunks                  ← 청크 벡터 직접 검색
```

### 3. 필터링/리랭킹
```
Raw search results: N entities, M relations, K chunks
After truncation: N entities, M relations
Selecting N from M entity-related chunks
Selecting N from M relation-related chunks
Round-robin merged chunks: N -> M (deduplicated K)
Successfully reranked: N chunks from M original
```

### 4. 최종 컨텍스트
```
Final context: N entities, M relations, K chunks
Final chunks S+F/O: ...
```
- `E` = Entity chunk, `R` = Relation chunk
- 숫자 = source index / order index

### 5. 응답 (API 모드일 때)
- LLM 응답 텍스트
- 참조된 엔티티/청크 목록

---

## 분석 보고서 형식

```markdown
## 쿼리 트레이스 결과

**쿼리**: "..."
**모드**: hybrid

### 1. 키워드 추출
| 유형 | 키워드 |
|------|--------|
| 노드 | ... |
| 관계 | ... |

### 2. 검색 결과
| 검색 유형 | 엔티티 | 관계 | 청크 |
|-----------|--------|------|------|
| Local | N | M | - |
| Global | N | M | - |
| Naive | - | - | K |

### 3. 필터링
- Raw → Truncated: 62 → 13 entities
- 청크 선택: 110 → 40 (rerank)

### 4. 최종 컨텍스트
- 엔티티 N개, 관계 M개, 청크 K개

### 5. 발견사항
- [이슈/정상] 설명...
```

---

## DB 조회 (선택적)

필요시 검색된 엔티티/청크의 실제 데이터를 DB에서 조회합니다:

### 엔티티 검색
```sql
SELECT entity_name, content
FROM lightrag_vdb_entity
WHERE workspace = 'kevcs'
  AND entity_name ILIKE '%키워드%'
LIMIT 10;
```

### 청크 내용 확인
```sql
SELECT id, LEFT(content, 200) as preview
FROM lightrag_doc_chunks
WHERE workspace = 'kevcs'
  AND id = 'chunk-...'
LIMIT 5;
```

### Neo4j 노드/관계 확인
```bash
docker exec lightrag-neo4j-dev cypher-shell -u <user> -p <pass> -a <uri> \
  "MATCH (n) WHERE n.entity_id CONTAINS '키워드' RETURN n.entity_id, n.description LIMIT 10"
```

---

## 인자 파싱 규칙

| 인자 | 모드 | 예시 |
|------|------|------|
| (없음) | monitor | `/query-trace` |
| `monitor` | monitor | `/query-trace monitor` |
| `last` 또는 `analyze` | analyze | `/query-trace last` |
| 그 외 텍스트 | query | `/query-trace 아이오닉5 비상레버 위치` |
| `query <텍스트>` | query | `/query-trace query 아이오닉5 비상레버` |

## 워크스페이스

기본 워크스페이스는 `kevcs`입니다. 변경이 필요하면 사용자에게 질문합니다.

## 로그 파일

- 서버 로그: `/tmp/lightrag-server.log`
- 쿼리 관련 로그 필터링 시 제외 패턴: `GET /api/tasks`, `GET /api/graph`, `GET /api/documents`, `GET /health`, `GET /api/workspaces`, `GET /api/schema`
