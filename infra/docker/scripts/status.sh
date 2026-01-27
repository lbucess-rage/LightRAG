#!/bin/bash
# LightRAG Infrastructure 상태 확인 스크립트
# Usage: ./status.sh [--dev]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(dirname "$SCRIPT_DIR")"

cd "$DOCKER_DIR"

# 개발 환경 플래그 확인
COMPOSE_FILE="docker-compose.yml"
ENV_NAME="Production"
CONTAINER_SUFFIX=""
if [ "$1" = "--dev" ] || [ "$1" = "-d" ]; then
    COMPOSE_FILE="docker-compose.dev.yml"
    ENV_NAME="Development"
    CONTAINER_SUFFIX="-dev"
fi

POSTGRES_CONTAINER="lightrag-postgres${CONTAINER_SUFFIX}"
NEO4J_CONTAINER="lightrag-neo4j${CONTAINER_SUFFIX}"
DB_NAME="${POSTGRES_DATABASE:-lightrag}"
DB_USER="${POSTGRES_USER:-lightrag}"

# 개발 환경일 경우 기본값 변경
if [ -n "$CONTAINER_SUFFIX" ]; then
    DB_NAME="${POSTGRES_DATABASE:-lightrag_dev}"
    DB_USER="${POSTGRES_USER:-lightrag_dev}"
fi

echo "=== LightRAG Infrastructure 상태 ($ENV_NAME) ==="
echo ""

# 컨테이너 상태
echo "--- 컨테이너 상태 ---"
docker compose -f "$COMPOSE_FILE" ps

echo ""
echo "--- 리소스 사용량 ---"
docker stats --no-stream "$POSTGRES_CONTAINER" "$NEO4J_CONTAINER" 2>/dev/null || echo "컨테이너가 실행 중이 아닙니다."

echo ""
echo "--- PostgreSQL 연결 테스트 ---"
docker exec "$POSTGRES_CONTAINER" pg_isready -U "$DB_USER" 2>/dev/null && echo "PostgreSQL: OK" || echo "PostgreSQL: FAILED"

echo ""
echo "--- Neo4j 연결 테스트 ---"
curl -s -o /dev/null -w "%{http_code}" http://localhost:${NEO4J_HTTP_PORT:-7474} 2>/dev/null | grep -q "200" && echo "Neo4j: OK" || echo "Neo4j: FAILED (or not accessible)"

echo ""
echo "--- pgvector 확장 확인 ---"
docker exec "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT 'pgvector version: ' || extversion FROM pg_extension WHERE extname = 'vector';" 2>/dev/null || echo "pgvector: NOT CHECKED"
