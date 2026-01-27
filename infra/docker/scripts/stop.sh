#!/bin/bash
# LightRAG Infrastructure 중지 스크립트
# Usage: ./stop.sh [--dev]

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

echo "=== LightRAG Infrastructure 중지 ($ENV_NAME) ==="
echo "Using: $COMPOSE_FILE"
echo ""

docker compose -f "$COMPOSE_FILE" down

echo ""
echo "서비스가 중지되었습니다."
echo "데이터는 Docker 볼륨에 유지됩니다."
echo ""
echo "데이터를 포함하여 완전 삭제: docker compose -f $COMPOSE_FILE down -v"
