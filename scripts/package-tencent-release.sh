#!/usr/bin/env bash
# 一键产出腾讯云部署交付物：构建 → Docker 镜像 → 可离线分发的 tar.gz。
# 用法：bash scripts/package-tencent-release.sh [镜像标签]
set -euo pipefail

TAG="${1:-$(date +%Y%m%d)}"
IMAGE="yonghong-platform:${TAG}"
OUT_DIR="${OUT_DIR:-release}"

echo "==> npm ci && npm run build"
npm ci
npm run build

echo "==> docker build ${IMAGE}"
docker build -f Dockerfile.tencent -t "${IMAGE}" -t yonghong-platform:latest .

mkdir -p "${OUT_DIR}"
echo "==> 导出镜像 ${OUT_DIR}/yonghong-platform-${TAG}.tar.gz"
docker save "${IMAGE}" | gzip > "${OUT_DIR}/yonghong-platform-${TAG}.tar.gz"

cp docker-compose.tencent.yml "${OUT_DIR}/"
cp .env.tencent.docker.example "${OUT_DIR}/"
cp docs/DEPLOY-TENCENT-DOCKER.md "${OUT_DIR}/"

echo ""
echo "交付物已生成到 ${OUT_DIR}/："
ls -lh "${OUT_DIR}/"
echo ""
echo "服务器上执行："
echo "  docker load < yonghong-platform-${TAG}.tar.gz"
echo "  cp .env.tencent.docker.example .env && vi .env"
echo "  docker compose -f docker-compose.tencent.yml up -d"
