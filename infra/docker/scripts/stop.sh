#!/bin/bash
# LightRAG Infrastructure 중지 스크립트

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(dirname "$SCRIPT_DIR")"

cd "$DOCKER_DIR"

echo "=== LightRAG Infrastructure 중지 ==="
echo ""

docker compose down

echo ""
echo "서비스가 중지되었습니다."
echo "데이터는 Docker 볼륨에 유지됩니다."
echo ""
echo "데이터를 포함하여 완전 삭제: docker compose down -v"
