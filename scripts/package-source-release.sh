#!/usr/bin/env bash
# 产出"可直接上传部署"的源码交付包（中国大陆院内环境适用）。
#
#   bash scripts/package-source-release.sh [版本号]
#
# 包内同时含源码与构建产物 dist/：院内服务器即使完全没有外网，
# 也能直接 systemd 或 docker 启动，不需要 npm install、不需要拉基础镜像以外的东西。
set -euo pipefail

VERSION="${1:-$(date +%Y%m%d)}"
NAME="yonghong-platform-src-${VERSION}"
OUT_DIR="${OUT_DIR:-release}"
STAGE="${OUT_DIR}/${NAME}"

echo "==> 构建产物（需要 Node >= 22.13）"
if [ ! -d dist ] || [ "${FORCE_BUILD:-0}" = "1" ]; then
  npm ci
  npm run build
else
  echo "    已存在 dist/，跳过构建（FORCE_BUILD=1 可强制重建）"
fi

echo "==> 组装 ${STAGE}"
rm -rf "${STAGE}"
mkdir -p "${STAGE}"

# 源码与运行所需目录（不含 node_modules：运行期用不到，源码可按需重建）
for item in \
  app db drizzle server-node scripts public worker tests deploy tencent-cloud docs \
  dist \
  package.json package-lock.json tsconfig.json vite.config.ts next.config.ts \
  postcss.config.mjs eslint.config.mjs drizzle.config.ts cloudflare-runtime.d.ts \
  Dockerfile.tencent docker-compose.tencent.yml .env.tencent.docker.example \
  .npmrc.china.example README.md DEMO-RUNBOOK.md
do
  [ -e "$item" ] && cp -r "$item" "${STAGE}/" || echo "    跳过缺失项：$item"
done

# 交付包内不带任何本地数据与密钥
rm -rf "${STAGE}/.env" "${STAGE}/data" "${STAGE}/release"

cat > "${STAGE}/如何部署.txt" <<'NOTE'
勇虹医疗设备效益管理平台 · 源码交付包

单机试用（不用域名、不用证书）——两步：

    bash deploy/install-tencentos.sh
    然后在腾讯云安全组放行 TCP:3000，浏览器打开 http://<服务器IP>:3000

    脚本会打印管理员账号、随机初始密码和数据准备中心入口口令。
    详见 docs/单机试用-快速开始.md（一页看完）

正式给医院用（域名 + HTTPS）：见 docs/部署手册-腾讯云-中国区.md

其它方式：
  Docker 编排：docker compose -f docker-compose.tencent.yml up -d
  从源码重建：cp .npmrc.china.example .npmrc && npm ci && npm run build

包内已含构建产物 dist/，安装与运行都不需要 npm install，也不需要访问外网。
NOTE

echo "==> 打包 ${OUT_DIR}/${NAME}.tar.gz"
tar -czf "${OUT_DIR}/${NAME}.tar.gz" -C "${OUT_DIR}" "${NAME}"
rm -rf "${STAGE}"

echo ""
echo "交付物：${OUT_DIR}/${NAME}.tar.gz"
ls -lh "${OUT_DIR}/${NAME}.tar.gz"
echo ""
echo "服务器上执行："
echo "  tar -xzf ${NAME}.tar.gz && cd ${NAME}"
echo "  bash deploy/install-tencentos.sh"
