#!/bin/bash
# LightRAG Infrastructure 시작 스크립트

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(dirname "$SCRIPT_DIR")"

cd "$DOCKER_DIR"

# .env 파일 확인
if [ ! -f .env ]; then
    echo "Error: .env 파일이 없습니다."
    echo "다음 명령어로 생성하세요: cp .env.example .env"
    exit 1
fi

echo "=== LightRAG Infrastructure 시작 ==="
echo ""

# Docker Compose 시작
docker compose up -d

echo ""
echo "=== 서비스 시작 대기 중... ==="
sleep 5

# 상태 확인
docker compose ps

echo ""
echo "=== 연결 정보 ==="
echo "PostgreSQL: localhost:${POSTGRES_PORT:-5432}"
echo "Neo4j HTTP: http://localhost:${NEO4J_HTTP_PORT:-7474}"
echo "Neo4j Bolt: bolt://localhost:${NEO4J_BOLT_PORT:-7687}"
echo ""
echo "로그 확인: docker compose logs -f"
