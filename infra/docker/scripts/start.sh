#!/bin/bash
# LightRAG Infrastructure 시작 스크립트
# Usage: ./start.sh [--dev]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(dirname "$SCRIPT_DIR")"

cd "$DOCKER_DIR"

# 개발 환경 플래그 확인
COMPOSE_FILE="docker-compose.yml"
ENV_NAME="Production"
if [ "$1" = "--dev" ] || [ "$1" = "-d" ]; then
    COMPOSE_FILE="docker-compose.dev.yml"
    ENV_NAME="Development"
fi

# .env 파일 확인
if [ ! -f .env ]; then
    echo "Error: .env 파일이 없습니다."
    echo "다음 명령어로 생성하세요: cp .env.example .env"
    exit 1
fi

echo "=== LightRAG Infrastructure 시작 ($ENV_NAME) ==="
echo "Using: $COMPOSE_FILE"
echo ""

# Docker Compose 시작
docker compose -f "$COMPOSE_FILE" up -d

echo ""
echo "=== 서비스 시작 대기 중... ==="
sleep 5

# 상태 확인
docker compose -f "$COMPOSE_FILE" ps

echo ""
echo "=== 연결 정보 ==="
echo "PostgreSQL: localhost:${POSTGRES_PORT:-5432}"
echo "Neo4j HTTP: http://localhost:${NEO4J_HTTP_PORT:-7474}"
echo "Neo4j Bolt: bolt://localhost:${NEO4J_BOLT_PORT:-7687}"
echo ""
echo "로그 확인: docker compose -f $COMPOSE_FILE logs -f"
