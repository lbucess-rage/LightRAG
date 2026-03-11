# System Inspector 참고 자료

## 안전 장치 (Safety Guards)

### 금지된 SQL 키워드
다음 키워드가 포함된 SQL은 **절대 실행하지 않습니다**:
- `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `DROP`, `ALTER`, `CREATE`
- `GRANT`, `REVOKE`

### 금지된 Cypher 키워드
다음 키워드가 포함된 Cypher는 **절대 실행하지 않습니다**:
- `CREATE`, `MERGE`, `SET`, `DELETE`, `REMOVE`, `DROP`

### 허용된 패턴만 사용
- PostgreSQL: `SELECT ... FROM ... WHERE ...`
- Neo4j: `MATCH ... RETURN ...`, `MATCH ... WHERE ... RETURN ...`

---

## 자연어 → 쿼리 매핑 가이드

사용자가 자연어로 질문할 때 적절한 쿼리로 변환합니다.

### 청크 관련 질문

| 자연어 | 쿼리 전략 |
|--------|----------|
| "현재 분석 중인 청크 상태" | `doc_status`에서 processing/pending 문서 → `doc_chunks` 조인 |
| "청크가 몇 개?" | `doc_chunks` COUNT |
| "특정 문서의 청크" | `doc_chunks WHERE full_doc_id = ?` |
| "청크 크기 분포" | `doc_chunks`에서 LENGTH(content) 통계 |

### 문서 관련 질문

| 자연어 | 쿼리 전략 |
|--------|----------|
| "문서 업로드 상태" | `doc_status`에서 최근 문서 상태별 조회 |
| "실패한 문서" | `doc_status WHERE status = 'failed'` |
| "처리 중인 문서" | `doc_status WHERE status IN ('pending', 'processing')` |
| "문서 몇 개?" | `doc_status` COUNT + 상태별 그룹 |

### 엔티티/관계 질문

| 자연어 | 쿼리 전략 |
|--------|----------|
| "연결된 엔티티" | Neo4j MATCH (n)-[r]-(m) |
| "관계 종류" | Neo4j MATCH ()-[r]->() RETURN type(r) |
| "고립된 엔티티" | Neo4j MATCH (n) WHERE NOT (n)--() |
| "가장 많이 연결된" | Neo4j MATCH (n)-[r]-() ... ORDER BY count DESC |

### 스키마/워크스페이스 질문

| 자연어 | 쿼리 전략 |
|--------|----------|
| "워크스페이스 목록" | `lightrag_workspaces` SELECT |
| "스키마 구성" | API 또는 설정 파일 조회 |
| "사용 중인 템플릿" | schema templates 디렉토리 조회 |

---

## 이상 징후 감지 규칙

### 1. 고아 데이터 감지
```
IF doc_status COUNT = 0 AND vdb_entity COUNT > 0:
    WARNING: "고아 엔티티 {count}개 존재. /db-admin clean-orphans 실행 권장"
```

### 2. 처리 지연 감지
```
IF doc_status에 'processing' 상태 문서가 30분 이상 경과:
    WARNING: "문서 '{file_path}'의 처리가 {minutes}분째 진행 중. 서버 로그 확인 권장"
```

### 3. DB 동기화 불일치
```
IF PG vdb_entity COUNT != Neo4j 노드 COUNT (±5% 허용):
    WARNING: "PostgreSQL 엔티티 {pg_count} vs Neo4j 노드 {neo4j_count} 불일치"
```

### 4. 실패 문서 감지
```
IF doc_status에 'failed' 상태 문서 존재:
    INFO: "실패한 문서 {count}개 확인. error_msg 상세 내용 제공"
```

### 5. 대량 캐시 감지
```
IF llm_cache COUNT > 10000:
    INFO: "LLM 캐시 {count}개 누적. 캐시 정리 고려"
```

---

## 보고서 템플릿

### 시스템 개요 보고서
```
## 시스템 개요

### 서버 상태
- 프로세스: {running/stopped}
- API: {healthy/unreachable}

### 데이터베이스 상태
| 항목 | 수량 |
|------|------|
| 문서 | {count} |
| 청크 | {count} |
| 엔티티 | {count} |
| 관계 | {count} |
| LLM 캐시 | {count} |

### 문서 처리 상태
| 상태 | 수량 |
|------|------|
| 완료 | {count} |
| 처리 중 | {count} |
| 대기 | {count} |
| 실패 | {count} |

### 그래프 상태 (Neo4j)
- 노드: {count}
- 관계: {count}
- 노드 라벨: {labels}
- 관계 타입: {types}

### 이상 징후
- {issues or "없음"}
```

### 문서 상세 보고서
```
## 문서 상세: {file_path}

- ID: {id}
- 상태: {status}
- 워크스페이스: {workspace}
- 생성일: {created_at}
- 수정일: {updated_at}
- 청크 수: {chunk_count}
- 연관 엔티티: {entity_count}
- 연관 관계: {relation_count}

### 청크 목록
| 순번 | 크기(bytes) |
|------|------------|
| 1    | {size}     |
| ...  | ...        |

### 에러 정보 (실패 시)
{error_msg}
```

### 엔티티 관계 보고서
```
## 엔티티: {entity_name}

### 직접 연결된 관계
| 연결 대상 | 관계 타입 | 방향 |
|-----------|----------|------|
| {target}  | {type}   | →    |
| {source}  | {type}   | ←    |

### 네트워크 통계
- 직접 연결: {count}개 엔티티
- 관계 수: {count}개
```

---

## 워크스페이스 인식 쿼리

워크스페이스가 있는 테이블 조회 시:
```sql
-- 특정 워크스페이스의 문서
SELECT * FROM lightrag_doc_status WHERE workspace = '<workspace_id>';

-- 특정 워크스페이스의 엔티티
SELECT * FROM lightrag_vdb_entity WHERE workspace = '<workspace_id>';
```

워크스페이스를 지정하지 않으면 전체 조회하되, 워크스페이스별로 그룹핑하여 보여줍니다:
```sql
SELECT workspace, COUNT(*) as count
FROM lightrag_doc_status
GROUP BY workspace
ORDER BY count DESC;
```

---

## 관련 스킬 안내 문구

### DB 정리가 필요할 때
> 데이터 정리가 필요하시면 `/db-admin` 스킬을 사용해주세요.
> 예: `/db-admin clean-orphans`, `/db-admin reset-graph`

### 서버 관리가 필요할 때
> 서버 관리가 필요하시면 `/lightrag-ops` 스킬을 사용해주세요.
> 예: `/lightrag-ops restart`, `/lightrag-ops logs`

### 스키마 변경이 필요할 때
> 스키마 변경이 필요하시면 `/kg-schema` 스킬을 사용해주세요.
> 예: `/kg-schema analyze <domain>`, `/kg-schema implement <feature>`
