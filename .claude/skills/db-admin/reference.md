# DB 관리 참고 자료

## 환경별 설정 예시

### 개발 환경 (.env 예시)
```bash
# PostgreSQL
POSTGRES_HOST=10.62.130.85
POSTGRES_PORT=5432
POSTGRES_USER=lightrag_dev
POSTGRES_PASSWORD=lightrag_dev_2024
POSTGRES_DATABASE=lightrag_dev

# Neo4j
NEO4J_URI=neo4j://10.62.130.85:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=neo4j_dev_2024
```

### 운영 환경 (.env 예시)
```bash
# PostgreSQL
POSTGRES_HOST=10.62.130.84
POSTGRES_PORT=5432
POSTGRES_USER=lightrag
POSTGRES_PASSWORD=lightrag_secure_2024
POSTGRES_DATABASE=lightrag

# Neo4j
NEO4J_URI=neo4j://10.62.130.84:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=neo4j_secure_2024
```

## Docker 컨테이너 명명 규칙

| 환경 | PostgreSQL 컨테이너 | Neo4j 컨테이너 |
|------|---------------------|----------------|
| 개발 | `lightrag-postgres-dev` | `lightrag-neo4j-dev` |
| 운영 | `lightrag-postgres` | `lightrag-neo4j` |

## 자주 발생하는 문제

### 1. psql 명령어를 찾을 수 없음
```
bash: psql: 명령을 찾을 수 없습니다
```
**해결:** 로컬에 psql이 없습니다. Docker 컨테이너를 통해 접속하세요.
```bash
docker exec <postgres-container> sh -c 'PGPASSWORD=xxx psql -h host -U user -d db -c "query"'
```

### 2. 비밀번호 입력 프롬프트
```
Password for user xxx:
psql: error: fe_sendauth: no password supplied
```
**해결:** PGPASSWORD 환경변수를 설정하세요.
```bash
docker exec container sh -c 'PGPASSWORD=password psql ...'
```

### 3. 역할이 존재하지 않음
```
FATAL: role "rag" does not exist
```
**해결:** .env 파일에서 올바른 사용자 이름을 확인하세요.

### 4. 테이블이 존재하지 않음
```
ERROR: relation "lightrag_entities" does not exist
```
**해결:** 테이블 이름이 변경되었을 수 있습니다. 실제 테이블 목록 확인:
```bash
docker exec container sh -c 'PGPASSWORD=xxx psql ... -c "\dt lightrag*"'
```

### 5. Neo4j 연결 실패
```
Connection refused
```
**해결:**
1. Neo4j 컨테이너 상태 확인: `docker ps | grep neo4j`
2. 네트워크 확인: `docker exec neo4j-container ping postgres-host`

## 고아 데이터 발생 원인

### RAG-Anything 연동 시
`ainsert_custom_kg()` 함수 사용 시 `full_entities`와 `full_relations` 테이블이 갱신되지 않아 문서 삭제 시 연관 데이터를 추적할 수 없음.

```
문서 삭제 요청
    ↓
full_entities 조회 → 비어있음
    ↓
삭제할 엔티티 ID 없음
    ↓
엔티티/관계가 고아 상태로 남음
```

### 해결 방안
1. **수동 정리**: 이 스킬의 `clean-orphans` 명령 사용
2. **근본 해결**: RAG-Anything에서 `full_entities`/`full_relations` 테이블 업데이트

## 데이터 일관성 확인

### 정상 상태
- `doc_status` 개수 > 0
- `full_entities` 개수 > 0
- `full_relations` 개수 > 0

### 고아 데이터 상태
- `doc_status` 개수 = 0
- `vdb_entity` 개수 > 0
- `vdb_relation` 개수 > 0
- `full_entities` 개수 = 0

### PostgreSQL과 Neo4j 동기화 확인
```
PostgreSQL vdb_entity 개수 = Neo4j 노드 개수
PostgreSQL vdb_relation 개수 = Neo4j 관계 개수
```

## 유용한 쿼리 모음

### 특정 문서의 엔티티 조회
```sql
SELECT e.id, e.entity_name
FROM lightrag_vdb_entity e
JOIN lightrag_full_entities fe ON fe.id = '<doc_id>'
WHERE e.entity_name = ANY(fe.entity_names);
```

### 중복 엔티티 확인
```sql
SELECT entity_name, COUNT(*) as cnt
FROM lightrag_vdb_entity
GROUP BY entity_name
HAVING COUNT(*) > 1
ORDER BY cnt DESC;
```

### 연결이 많은 엔티티 (Neo4j)
```cypher
MATCH (n)-[r]-()
RETURN n.entity_id, n.name, count(r) as connections
ORDER BY connections DESC
LIMIT 10
```

### 고립된 노드 (Neo4j)
```cypher
MATCH (n)
WHERE NOT (n)--()
RETURN n.entity_id, n.name
```

## 백업 명령어

### PostgreSQL 테이블 백업
```bash
docker exec <postgres-container> sh -c 'PGPASSWORD=xxx pg_dump -h host -U user -d db -t lightrag_vdb_entity -t lightrag_vdb_relation > /tmp/backup.sql'
docker cp <postgres-container>:/tmp/backup.sql ./backup.sql
```

### Neo4j 백업 (APOC 필요)
```cypher
CALL apoc.export.json.all("/tmp/backup.json", {})
```
