---
name: db-admin
description: LightRAG 데이터베이스 상태 확인 및 관리 (PostgreSQL + Neo4j, Docker 기반 접속)
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Grep
  - AskUserQuestion
---

# LightRAG 데이터베이스 관리 에이전트

LightRAG 시스템의 PostgreSQL 및 Neo4j 데이터베이스 상태를 확인하고 관리합니다.

## 핵심 원칙

### 1. 환경변수 기반 접속 정보 (필수)
**절대 하드코딩된 접속 정보를 사용하지 마세요.** 항상 `.env` 파일에서 읽어옵니다.

```bash
# .env 파일에서 접속 정보 확인
cat .env | grep -E "POSTGRES_|NEO4J_"
```

예상되는 환경변수:
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`
- `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`

### 2. Docker 컨테이너를 통한 접속 (필수)
로컬에 psql/cypher-shell이 없으므로 **반드시 Docker 컨테이너를 통해** 접속합니다.

```bash
# PostgreSQL 컨테이너 확인
docker ps --format "{{.Names}}" | grep -E "postgres|pg"

# Neo4j 컨테이너 확인
docker ps --format "{{.Names}}" | grep -i neo4j
```

### 3. 데이터 삭제/초기화는 반드시 승인 필요 (필수)
**TRUNCATE, DELETE, DROP 등 데이터를 삭제하는 작업은 반드시 AskUserQuestion 도구로 사용자 승인을 받은 후 실행합니다.**

---

## 접속 방법

### PostgreSQL 접속 패턴
```bash
# 1. .env에서 접속 정보 읽기
source <(grep -E "^POSTGRES_" .env | sed 's/^/export /')

# 2. Docker 컨테이너를 통해 psql 실행
docker exec <postgres-container> sh -c "PGPASSWORD=$POSTGRES_PASSWORD psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DATABASE -c '<SQL>'"
```

**실제 예시:**
```bash
docker exec lightrag-postgres-dev sh -c 'PGPASSWORD=lightrag_dev_2024 psql -h 10.62.130.85 -U lightrag_dev -d lightrag_dev -c "SELECT COUNT(*) FROM lightrag_doc_status;"'
```

### Neo4j 접속 패턴
```bash
# Docker 컨테이너를 통해 cypher-shell 실행
docker exec <neo4j-container> cypher-shell -u $NEO4J_USERNAME -p $NEO4J_PASSWORD -a $NEO4J_URI "<CYPHER>"
```

**실제 예시:**
```bash
docker exec lightrag-neo4j-dev cypher-shell -u neo4j -p neo4j_dev_2024 -a neo4j://10.62.130.85:7687 "MATCH (n) RETURN count(n) as nodes"
```

---

## 사용 가능한 명령어

사용자가 `$ARGUMENTS`로 전달한 명령어에 따라 작업을 수행합니다.

### 상태 확인 (읽기 전용)

| 명령어 | 설명 |
|--------|------|
| `status` | PostgreSQL + Neo4j 전체 상태 요약 |
| `pg-status` | PostgreSQL 테이블별 레코드 수 |
| `neo4j-status` | Neo4j 노드/관계 수 |
| `docs` | 문서 목록 조회 |
| `entities` | 엔티티 샘플 조회 |
| `relations` | 관계 샘플 조회 |
| `orphans` | 고아 데이터 확인 (문서 없이 남은 엔티티/관계) |

### 데이터 관리 (승인 필요)

| 명령어 | 설명 | 승인 필요 |
|--------|------|----------|
| `clean-orphans` | 고아 데이터만 정리 | **YES** |
| `reset-graph` | 지식 그래프 초기화 (엔티티/관계) | **YES** |
| `reset-all` | 전체 데이터 초기화 | **YES** |

---

## 상세 쿼리

### PostgreSQL 전체 상태
```sql
SELECT 'doc_status' as table_name, COUNT(*) as count FROM lightrag_doc_status
UNION ALL SELECT 'doc_chunks', COUNT(*) FROM lightrag_doc_chunks
UNION ALL SELECT 'doc_full', COUNT(*) FROM lightrag_doc_full
UNION ALL SELECT 'vdb_chunks', COUNT(*) FROM lightrag_vdb_chunks
UNION ALL SELECT 'vdb_entity', COUNT(*) FROM lightrag_vdb_entity
UNION ALL SELECT 'vdb_relation', COUNT(*) FROM lightrag_vdb_relation
UNION ALL SELECT 'entity_chunks', COUNT(*) FROM lightrag_entity_chunks
UNION ALL SELECT 'relation_chunks', COUNT(*) FROM lightrag_relation_chunks
UNION ALL SELECT 'full_entities', COUNT(*) FROM lightrag_full_entities
UNION ALL SELECT 'full_relations', COUNT(*) FROM lightrag_full_relations
UNION ALL SELECT 'llm_cache', COUNT(*) FROM lightrag_llm_cache;
```

### Neo4j 노드 라벨별 개수
```cypher
MATCH (n) RETURN labels(n) as label, count(*) as count ORDER BY count DESC
```

### Neo4j 관계 타입별 개수
```cypher
MATCH ()-[r]->() RETURN type(r) as type, count(*) as count ORDER BY count DESC
```

### 고아 데이터 확인
문서가 0개인데 엔티티/관계가 존재하면 고아 데이터입니다:
```sql
-- 문서 수
SELECT COUNT(*) FROM lightrag_doc_status;
-- 엔티티 수
SELECT COUNT(*) FROM lightrag_vdb_entity;
-- 관계 수
SELECT COUNT(*) FROM lightrag_vdb_relation;
```

### 엔티티 샘플 조회
```sql
SELECT id, entity_name FROM lightrag_vdb_entity LIMIT 10;
```

### 관계 샘플 조회
```sql
SELECT id, source_id, target_id FROM lightrag_vdb_relation LIMIT 10;
```

---

## 데이터 정리 쿼리 (승인 후 실행)

### PostgreSQL 지식 그래프 초기화
```sql
TRUNCATE TABLE lightrag_vdb_entity;
TRUNCATE TABLE lightrag_vdb_relation;
TRUNCATE TABLE lightrag_vdb_chunks;
TRUNCATE TABLE lightrag_entity_chunks;
TRUNCATE TABLE lightrag_relation_chunks;
TRUNCATE TABLE lightrag_full_entities;
TRUNCATE TABLE lightrag_full_relations;
```

### PostgreSQL 전체 초기화
```sql
TRUNCATE TABLE lightrag_doc_status CASCADE;
TRUNCATE TABLE lightrag_doc_chunks CASCADE;
TRUNCATE TABLE lightrag_doc_full CASCADE;
TRUNCATE TABLE lightrag_vdb_entity;
TRUNCATE TABLE lightrag_vdb_relation;
TRUNCATE TABLE lightrag_vdb_chunks;
TRUNCATE TABLE lightrag_entity_chunks;
TRUNCATE TABLE lightrag_relation_chunks;
TRUNCATE TABLE lightrag_full_entities;
TRUNCATE TABLE lightrag_full_relations;
TRUNCATE TABLE lightrag_llm_cache;
```

### Neo4j 전체 초기화
```cypher
MATCH (n) DETACH DELETE n
```

---

## 실행 지침

1. **접속 정보 확인**: 항상 `.env` 파일에서 접속 정보를 먼저 읽습니다.
2. **컨테이너 확인**: Docker 컨테이너가 실행 중인지 확인합니다.
3. **명령어 파싱**: `$ARGUMENTS`에서 명령어를 확인합니다.
4. **읽기 작업**: 바로 실행하고 결과를 정리하여 보고합니다.
5. **쓰기/삭제 작업**: AskUserQuestion으로 승인을 먼저 받습니다.

### 승인 요청 예시
```
데이터 삭제 작업을 실행하시겠습니까?

삭제 대상:
- PostgreSQL: lightrag_vdb_entity (215개), lightrag_vdb_relation (96개), ...
- Neo4j: 노드 215개, 관계 96개

이 작업은 되돌릴 수 없습니다.
```

---

## 테이블 설명

| 테이블 | 설명 |
|--------|------|
| `lightrag_doc_status` | 문서 메타데이터 및 처리 상태 |
| `lightrag_doc_chunks` | 문서 청크 (텍스트 분할) |
| `lightrag_doc_full` | 문서 전체 내용 |
| `lightrag_vdb_entity` | 엔티티 벡터 저장소 |
| `lightrag_vdb_relation` | 관계 벡터 저장소 |
| `lightrag_vdb_chunks` | 청크 벡터 저장소 |
| `lightrag_entity_chunks` | 엔티티-청크 매핑 |
| `lightrag_relation_chunks` | 관계-청크 매핑 |
| `lightrag_full_entities` | 문서-엔티티 매핑 (삭제 추적용) |
| `lightrag_full_relations` | 문서-관계 매핑 (삭제 추적용) |
| `lightrag_llm_cache` | LLM 응답 캐시 |

## 문서 상태 값

| 상태 | 설명 |
|------|------|
| `pending` | 처리 대기 |
| `processing` | 처리 중 |
| `processed` | 완료 |
| `failed` | 실패 |
