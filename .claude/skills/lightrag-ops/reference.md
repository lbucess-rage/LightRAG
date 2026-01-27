# LightRAG 운영 참고 자료

## 디렉토리 구조

```
/home/kms-rag/LightRAG/
├── .venv/                    # Python 가상환경
├── .claude/                  # Claude Code 설정
│   └── skills/
│       └── lightrag-ops/     # 이 skill
├── scripts/
│   └── server.sh             # 서버 관리 스크립트
├── lightrag/                 # 메인 소스코드
│   ├── api/                  # API 서버
│   │   ├── routers/
│   │   │   └── document_routes.py
│   │   └── utils_s3.py       # S3 유틸리티
│   └── kg/
│       └── postgres_impl.py  # PostgreSQL 구현
├── rag_storage/              # RAG 저장소
├── inputs/                   # 입력 파일 디렉토리
└── docker/                   # Docker 설정
```

## PostgreSQL 테이블 설명

| 테이블 | 설명 |
|--------|------|
| `lightrag_doc_status` | 문서 처리 상태 (id, file_path, status, s3_url 등) |
| `lightrag_doc_chunks` | 문서 청크 정보 |
| `lightrag_llm_cache` | LLM 응답 캐시 |
| `lightrag_vdb_chunks` | 벡터 DB 청크 |
| `lightrag_vdb_entity` | 벡터 DB 엔티티 |
| `lightrag_vdb_relation` | 벡터 DB 관계 |

## 문서 상태 (status)

| 상태 | 설명 |
|------|------|
| `pending` | 처리 대기 중 |
| `preprocessed` | 전처리 완료 |
| `processed` | 처리 완료 |
| `failed` | 처리 실패 |

## 자주 사용하는 쿼리

### 특정 문서 조회
```sql
SELECT * FROM lightrag_doc_status WHERE id = 'doc-xxx';
```

### 실패한 문서 조회
```sql
SELECT id, file_path, error_msg, created_at
FROM lightrag_doc_status
WHERE status = 'failed'
ORDER BY created_at DESC;
```

### S3 URL이 없는 문서 조회
```sql
SELECT id, file_path, status, created_at
FROM lightrag_doc_status
WHERE s3_url IS NULL AND status = 'processed';
```

### 청크 수 확인
```sql
SELECT doc_id, COUNT(*) as chunk_count
FROM lightrag_doc_chunks
GROUP BY doc_id
ORDER BY chunk_count DESC;
```

## Neo4j 쿼리

### 노드 라벨별 개수
```cypher
MATCH (n) RETURN labels(n) as label, count(*) as count
```

### 관계 타입별 개수
```cypher
MATCH ()-[r]->() RETURN type(r) as type, count(*) as count
```

### 특정 엔티티 조회
```cypher
MATCH (n {entity_id: 'xxx'}) RETURN n
```

## 트러블슈팅

### 서버가 시작되지 않을 때
1. 포트 사용 확인: `lsof -i :9621`
2. 이전 프로세스 종료: `kill <PID>`
3. 로그 확인: `tail -100 /tmp/lightrag-server.log`

### DB 연결 실패
1. PostgreSQL 컨테이너 확인: `docker ps | grep postgres`
2. Neo4j 컨테이너 확인: `docker ps | grep neo4j`
3. 네트워크 확인: `ping 10.62.130.84`

### S3 업로드 실패
1. 환경변수 확인: `grep S3 .env`
2. AWS 자격증명 확인
3. 버킷 권한 확인
