# LightRAG Infrastructure Docker Setup

PostgreSQL + Neo4j를 Docker로 구성하여 LightRAG의 데이터 저장소로 사용합니다.

## 구성 요소

| 서비스 | 이미지 | 용도 | 포트 |
|--------|--------|------|------|
| PostgreSQL 16 | `pgvector/pgvector:pg16` | KV, Vector, DocStatus 저장소 | 5432 |
| Neo4j 5.26 | `neo4j:5.26.0-community` | Graph 저장소 | 7474 (HTTP), 7687 (Bolt) |

## 버전 선택 근거

### PostgreSQL
- **pgvector/pgvector:pg16**: PostgreSQL 16 + pgvector 확장이 포함된 공식 이미지
- pgvector는 LightRAG의 벡터 유사도 검색에 필수
- HNSW 인덱스 지원으로 빠른 벡터 검색 가능

### Neo4j
- **neo4j:5.26.0-community**: 최신 안정 버전
- Community 에디션으로 무료 사용 가능
- LightRAG의 그래프 스토리지에 최적화 (PostgreSQL AGE보다 성능 우수)

## 시작하기

### 1. 환경변수 설정

```bash
cd infra/docker
cp .env.example .env
# .env 파일을 열어 비밀번호 등 설정
```

### 2. 서비스 시작

```bash
# 시작
./scripts/start.sh

# 또는 직접 docker compose 사용
docker compose up -d
```

### 3. 상태 확인

```bash
./scripts/status.sh

# 또는
docker compose ps
docker compose logs -f
```

### 4. 서비스 중지

```bash
./scripts/stop.sh

# 또는
docker compose down
```

## LightRAG 연결 설정

Docker 서버가 `10.0.0.100`에서 실행 중이라면, LightRAG의 `.env`에 다음을 설정:

```bash
# Storage 선택
LIGHTRAG_KV_STORAGE=PGKVStorage
LIGHTRAG_DOC_STATUS_STORAGE=PGDocStatusStorage
LIGHTRAG_VECTOR_STORAGE=PGVectorStorage
LIGHTRAG_GRAPH_STORAGE=Neo4JStorage

# PostgreSQL 연결
POSTGRES_HOST=10.0.0.100
POSTGRES_PORT=5432
POSTGRES_USER=lightrag
POSTGRES_PASSWORD=your_password
POSTGRES_DATABASE=lightrag
POSTGRES_MAX_CONNECTIONS=20
POSTGRES_VECTOR_INDEX_TYPE=HNSW

# Neo4j 연결
NEO4J_URI=neo4j://10.0.0.100:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_neo4j_password
NEO4J_DATABASE=neo4j
```

## 리소스 요구사항

### 최소 사양
- CPU: 2 cores
- RAM: 4 GB
- Disk: 20 GB SSD

### 권장 사양
- CPU: 4+ cores
- RAM: 8+ GB
- Disk: 50+ GB SSD

## 백업 및 복구

### PostgreSQL 백업
```bash
docker exec lightrag-postgres pg_dump -U lightrag lightrag > backup.sql
```

### PostgreSQL 복구
```bash
docker exec -i lightrag-postgres psql -U lightrag lightrag < backup.sql
```

### Neo4j 백업
```bash
# Neo4j Admin 사용 (컨테이너 중지 필요)
docker compose stop neo4j
docker run --rm \
  -v lightrag-docker_neo4j_data:/data \
  -v $(pwd)/backup:/backup \
  neo4j:5.26.0-community \
  neo4j-admin database dump neo4j --to-path=/backup
docker compose start neo4j
```

## 문제 해결

### PostgreSQL 연결 오류
```bash
# 로그 확인
docker logs lightrag-postgres

# 컨테이너 내부에서 확인
docker exec -it lightrag-postgres psql -U lightrag -d lightrag
```

### Neo4j 연결 오류
```bash
# 로그 확인
docker logs lightrag-neo4j

# 웹 UI 접속 (브라우저)
http://<서버IP>:7474
```

### pgvector 확장 확인
```bash
docker exec -it lightrag-postgres psql -U lightrag -d lightrag -c "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';"
```
