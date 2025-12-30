#!/bin/bash
# LightRAG Infrastructure 상태 확인 스크립트

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(dirname "$SCRIPT_DIR")"

cd "$DOCKER_DIR"

echo "=== LightRAG Infrastructure 상태 ==="
echo ""

# 컨테이너 상태
echo "--- 컨테이너 상태 ---"
docker compose ps

echo ""
echo "--- 리소스 사용량 ---"
docker stats --no-stream lightrag-postgres lightrag-neo4j 2>/dev/null || echo "컨테이너가 실행 중이 아닙니다."

echo ""
echo "--- PostgreSQL 연결 테스트 ---"
docker exec lightrag-postgres pg_isready -U lightrag 2>/dev/null && echo "PostgreSQL: OK" || echo "PostgreSQL: FAILED"

echo ""
echo "--- Neo4j 연결 테스트 ---"
curl -s -o /dev/null -w "%{http_code}" http://localhost:${NEO4J_HTTP_PORT:-7474} 2>/dev/null | grep -q "200" && echo "Neo4j: OK" || echo "Neo4j: FAILED (or not accessible)"

echo ""
echo "--- pgvector 확장 확인 ---"
docker exec lightrag-postgres psql -U lightrag -d lightrag -t -c "SELECT 'pgvector version: ' || extversion FROM pg_extension WHERE extname = 'vector';" 2>/dev/null || echo "pgvector: NOT CHECKED"
