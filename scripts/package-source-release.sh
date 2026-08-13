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

# 依赖只在锁文件真的变了的时候才重装。
# npm ci 会先把 node_modules 整个删掉再装一遍，在这台机器上比构建本身还慢好几倍；
# 而打包绝大多数时候锁文件一个字没动，那一遍纯属白等。用锁文件哈希做戳记来判断。
LOCK_STAMP="node_modules/.yh-lock-sha256"
ensure_deps() {
  local want have
  want="$(sha256sum package-lock.json | cut -d' ' -f1)"
  have="$([ -f "${LOCK_STAMP}" ] && cat "${LOCK_STAMP}" || echo "")"
  if [ ! -d node_modules ] || [ "${want}" != "${have}" ]; then
    echo "    依赖有变动（或首次安装），执行 npm ci"
    npm ci
    printf '%s' "${want}" > "${LOCK_STAMP}"
  else
    echo "    锁文件未变，复用现有 node_modules"
  fi
}

echo "==> 构建产物（需要 Node >= 22.13）"
if [ ! -d dist ] || [ "${FORCE_BUILD:-0}" = "1" ]; then
  ensure_deps
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

服务器上整段粘贴：

    mkdir -p /opt/yonghong/src && \
    tar -xzf /root/yonghong-platform-src-*.tar.gz -C /opt/yonghong/src --strip-components=1 && \
    cd /opt/yonghong/src && \
    bash deploy/install-docker.sh

然后在腾讯云安全组放行 TCP:8911，浏览器打开 http://<服务器IP>:8911

脚本会打印管理员账号、随机初始密码、数据准备中心入口口令。
一页说明见 docs/单机试用-快速开始.md

所有文件都在 /opt/yonghong 一棵树下（src 源码 / app 程序 / data 数据）。
正式上线（域名 + HTTPS）见 docs/部署手册-腾讯云-中国区.md
包内已含构建产物 dist/，安装与运行都不需要 npm install，也不需要外网。
NOTE

echo "==> 打包 ${OUT_DIR}/${NAME}.tar.gz"
# 有 pigz 就多核压，没有就退回 gzip。8MB 的包在单核 gzip 上要等好几秒，
# 多核能压到一两秒；退路必须留着，院内打包机上不一定装了 pigz。
if command -v pigz >/dev/null 2>&1; then
  tar -cf - -C "${OUT_DIR}" "${NAME}" | pigz -p "$(nproc)" > "${OUT_DIR}/${NAME}.tar.gz"
else
  tar -czf "${OUT_DIR}/${NAME}.tar.gz" -C "${OUT_DIR}" "${NAME}"
fi
rm -rf "${STAGE}"

echo ""
echo "交付物：${OUT_DIR}/${NAME}.tar.gz"
ls -lh "${OUT_DIR}/${NAME}.tar.gz"
echo ""
echo "服务器上执行："
echo "  tar -xzf ${NAME}.tar.gz && cd ${NAME}"
echo "  bash deploy/install-docker.sh"
