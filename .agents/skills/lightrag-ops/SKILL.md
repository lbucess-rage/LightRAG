---
name: lightrag-ops
description: LightRAG 시스템 운영 관리 (서버 시작/중지, DB 연결, 데이터 초기화, 로그 확인, 헬스체크)
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Grep
---

# LightRAG 시스템 운영 관리 에이전트

LightRAG 시스템의 운영 및 관리 작업을 수행합니다.

## 프로젝트 정보

- **프로젝트 경로**: `/home/kms-rag/LightRAG`
- **가상환경**: `.venv`
- **서버 스크립트**: `./scripts/server.sh`
- **로그 파일**: `/tmp/lightrag-server.log`

## 환경 설정

### PostgreSQL
- Host: `10.62.130.84`
- Port: `5432`
- User: `lightrag`
- Password: `lightrag_secure_2024`
- Database: `lightrag`

### Neo4j
- URI: `neo4j://10.62.130.84:7687`
- User: `neo4j`
- Password: `neo4j_secure_2024`
- Container: `lightrag-neo4j`

### API Server
- URL: `http://localhost:9621`
- Health endpoint: `/health`

## 사용 가능한 명령어

사용자가 `$ARGUMENTS`로 전달한 명령어에 따라 작업을 수행합니다.

### 서버 관리

| 명령어 | 설명 |
|--------|------|
| `start` | 서버 시작 |
| `stop` | 서버 중지 |
| `restart` | 서버 재시작 |
| `status` | 서버 상태 확인 |
| `logs` | 최근 로그 확인 (tail -50) |
| `logs-follow` | 실시간 로그 확인 (tail -f) |

**서버 관리 명령어 실행 방법:**
```bash
cd /home/kms-rag/LightRAG
./scripts/server.sh <command>
```

### DB 상태 확인

| 명령어 | 설명 |
|--------|------|
| `db-status` | PostgreSQL 테이블별 레코드 수 확인 |
| `neo4j-status` | Neo4j 노드/관계 수 확인 |
| `db-all` | PostgreSQL + Neo4j 전체 상태 |

**PostgreSQL 상태 확인:**
```bash
PGPASSWORD=lightrag_secure_2024 psql -h 10.62.130.84 -p 5432 -U lightrag -d lightrag -c "
SELECT 'doc_status' as table_name, COUNT(*) as count FROM lightrag_doc_status
UNION ALL SELECT 'doc_chunks', COUNT(*) FROM lightrag_doc_chunks
UNION ALL SELECT 'llm_cache', COUNT(*) FROM lightrag_llm_cache
UNION ALL SELECT 'vdb_chunks', COUNT(*) FROM lightrag_vdb_chunks
UNION ALL SELECT 'vdb_entity', COUNT(*) FROM lightrag_vdb_entity
UNION ALL SELECT 'vdb_relation', COUNT(*) FROM lightrag_vdb_relation;
"
```

**Neo4j 상태 확인:**
```bash
docker exec lightrag-neo4j cypher-shell -u neo4j -p neo4j_secure_2024 "MATCH (n) RETURN count(n) as nodes; MATCH ()-[r]->() RETURN count(r) as relations"
```

### 데이터 초기화

| 명령어 | 설명 |
|--------|------|
| `reset-db` | PostgreSQL 데이터 테이블 초기화 |
| `reset-neo4j` | Neo4j 모든 노드/관계 삭제 |
| `reset-all` | PostgreSQL + Neo4j 전체 초기화 |

**PostgreSQL 초기화:**
```bash
PGPASSWORD=lightrag_secure_2024 psql -h 10.62.130.84 -p 5432 -U lightrag -d lightrag -c "
TRUNCATE TABLE lightrag_doc_status CASCADE;
TRUNCATE TABLE lightrag_doc_chunks CASCADE;
TRUNCATE TABLE lightrag_llm_cache CASCADE;
TRUNCATE TABLE lightrag_vdb_chunks CASCADE;
TRUNCATE TABLE lightrag_vdb_entity CASCADE;
TRUNCATE TABLE lightrag_vdb_relation CASCADE;
"
```

**Neo4j 초기화:**
```bash
docker exec lightrag-neo4j cypher-shell -u neo4j -p neo4j_secure_2024 "MATCH (n) DETACH DELETE n"
```

### 헬스체크

| 명령어 | 설명 |
|--------|------|
| `health` | API 서버 헬스체크 |
| `check-all` | 서버 + DB + Neo4j 전체 상태 확인 |

**API 헬스체크:**
```bash
curl -s http://localhost:9621/health | jq .
```

### 문서 관련

| 명령어 | 설명 |
|--------|------|
| `docs` | 최근 문서 목록 조회 |
| `docs-failed` | 실패한 문서 목록 조회 |

**최근 문서 조회:**
```bash
PGPASSWORD=lightrag_secure_2024 psql -h 10.62.130.84 -p 5432 -U lightrag -d lightrag -c "
SELECT id, file_path, status,
       CASE WHEN s3_url IS NOT NULL THEN 'Y' ELSE 'N' END as s3,
       created_at
FROM lightrag_doc_status
ORDER BY created_at DESC
LIMIT 10;
"
```

## 실행 지침

1. 사용자의 `$ARGUMENTS`를 확인하여 해당 명령어 실행
2. 명령어가 없으면 사용 가능한 명령어 목록 안내
3. 위험한 작업(reset-*)은 실행 전 확인 메시지 출력
4. 작업 결과를 명확하게 정리하여 보고

## 주의사항

- `reset-*` 명령어는 데이터가 삭제되므로 신중하게 실행
- 서버 재시작 시 잠시 서비스 중단 발생
- 로그 확인 시 민감한 정보가 포함될 수 있음
