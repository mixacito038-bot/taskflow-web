#!/usr/bin/env bash
# 勇虹医疗设备效益管理平台 · 单机安装（TencentOS Server 4 / CentOS 系，不使用 Docker）
#
#   bash deploy/install-tencentos.sh              # 试用模式：IP 直接访问，无需域名和证书
#   bash deploy/install-tencentos.sh --behind-nginx   # 正式模式：只听本机，由 nginx 提供 HTTPS
#
# 构建产物 dist/ 已随包提供，全程不需要 npm install，也不需要访问 npm 源。
set -euo pipefail

MODE=trial
[ "${1:-}" = "--behind-nginx" ] && MODE=nginx

# 所有东西都在 /opt/yonghong 一棵树下：删这一个目录就等于卸载干净。
ROOT=/opt/yonghong
APP_DIR="${ROOT}/app"          # 运行程序
DATA_DIR="${ROOT}/data"        # 数据库 + 上传文件 + 报告
ENV_FILE="${ROOT}/yonghong.env"
SERVICE=yonghong-platform
PORT="${PORT:-8911}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "请用 root 执行（sudo bash deploy/install-tencentos.sh）"; exit 1; }
[ -d "${SRC_DIR}/dist" ] || { echo "缺少构建产物 dist/：请用完整交付包，或先执行 npm ci && npm run build"; exit 1; }

echo "==> 1/6 检查 Node 运行时（需要 >= 22.13）"
need_node=1
if command -v node >/dev/null 2>&1; then
  major=$(node -p "process.versions.node.split('.')[0]")
  minor=$(node -p "process.versions.node.split('.')[1]")
  if [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 13 ]; }; then need_node=0; fi
fi
if [ "$need_node" -eq 1 ]; then
  echo "    安装 Node 22（优先系统源，失败再用 NodeSource）"
  dnf install -y nodejs22 2>/dev/null || dnf install -y nodejs 2>/dev/null || {
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
    dnf install -y nodejs
  }
  command -v node >/dev/null || { echo "Node 安装失败：请离线安装 Node 22 后重跑本脚本"; exit 1; }
fi
NODE_BIN="$(command -v node)"
echo "    使用 ${NODE_BIN}（$(node -v)）"

echo "==> 2/6 创建服务账号与目录"
id yonghong >/dev/null 2>&1 || useradd --system --home "${DATA_DIR}" --shell /sbin/nologin yonghong
mkdir -p "${APP_DIR}" "${DATA_DIR}"

echo "==> 3/6 部署程序到 ${APP_DIR}"
# 运行只需三样：构建产物、数据库迁移、Node 服务壳；文档一并带上便于现场排查
rm -rf "${APP_DIR}/dist" "${APP_DIR}/drizzle" "${APP_DIR}/server-node"
cp -r "${SRC_DIR}/dist" "${SRC_DIR}/drizzle" "${SRC_DIR}/server-node" "${APP_DIR}/"
[ -d "${SRC_DIR}/docs" ] && { rm -rf "${APP_DIR}/docs"; cp -r "${SRC_DIR}/docs" "${APP_DIR}/"; }
chown -R yonghong:yonghong "${APP_DIR}" "${DATA_DIR}"

echo "==> 4/6 生成配置 ${ENV_FILE}"
if [ -f "${ENV_FILE}" ]; then
  echo "    已存在，保留原配置（要重置请先删除该文件）"
else
  admin_pass="$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)Aa1"
  cp "${SRC_DIR}/deploy/yonghong-platform.env.example" "${ENV_FILE}"
  sed -i "s|^BOOTSTRAP_ADMIN_PASSWORD=.*|BOOTSTRAP_ADMIN_PASSWORD=${admin_pass}|" "${ENV_FILE}"
  sed -i "s|^MFA_TOTP_ENCRYPTION_KEY=.*|MFA_TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32)|" "${ENV_FILE}"
  sed -i "s|^PORT=.*|PORT=${PORT}|" "${ENV_FILE}"
  sed -i "s|^DATA_DIR=.*|DATA_DIR=${DATA_DIR}|" "${ENV_FILE}"
  if [ "${MODE}" = "trial" ]; then
    # 试用：监听所有网卡，浏览器用 服务器IP:端口 直接访问，不需要域名和证书。
    # __Host- 安全 Cookie 要求 HTTPS，纯 HTTP 试用时降级为普通 Cookie。
    sed -i "s|^HOST=.*|HOST=0.0.0.0|" "${ENV_FILE}"
  else
    sed -i "s|^HOST=.*|HOST=127.0.0.1|" "${ENV_FILE}"
    sed -i "/APP_SESSION_ALLOW_INSECURE/d" "${ENV_FILE}"
  fi
  chmod 600 "${ENV_FILE}"
fi

echo "==> 5/6 注册并启动 systemd 服务"
sed -e "s|^ExecStart=/usr/bin/node|ExecStart=${NODE_BIN}|" \
    -e "s|^WorkingDirectory=.*|WorkingDirectory=${APP_DIR}|" \
    -e "s|^EnvironmentFile=.*|EnvironmentFile=${ENV_FILE}|" \
    -e "s|^ReadWritePaths=.*|ReadWritePaths=${DATA_DIR}|" \
  "${SRC_DIR}/deploy/yonghong-platform.service" > /etc/systemd/system/${SERVICE}.service
systemctl daemon-reload
systemctl enable --now "${SERVICE}"
systemctl restart "${SERVICE}"

echo "==> 6/6 自检"
port="$(grep -E '^PORT=' "${ENV_FILE}" | cut -d= -f2)"; port="${port:-8911}"
ok=0
for _ in $(seq 1 25); do
  if curl -fsS "http://127.0.0.1:${port}/healthz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ "${ok}" != "1" ]; then
  echo "健康检查未通过，请查看：journalctl -u ${SERVICE} -n 100 --no-pager"
  exit 1
fi

# 腾讯云 CVM 元数据可直接取公网 IP；取不到就退回内网地址
ip="$(curl -fsS --max-time 2 http://metadata.tencentyun.com/latest/meta-data/public-ipv4 2>/dev/null || true)"
[ -z "${ip}" ] && ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "${ip}" ] && ip="<服务器IP>"

echo ""
echo "──────────────────────────────────────────────"
if [ "${MODE}" = "trial" ]; then
  echo " 装好了。浏览器打开：  http://${ip}:${port}"
  echo ""
  echo " 打不开就是安全组没放行 ${port} 端口："
  echo "   腾讯云控制台 → 云服务器 → 安全组 → 入站规则 → 添加 TCP:${port}"
  echo "   建议来源填你办公室的出口 IP，别填 0.0.0.0/0"
else
  echo " 装好了。服务监听 127.0.0.1:${port}，请配置 nginx 反向代理。"
fi
echo ""
echo " 管理员账号：$(grep -E '^BOOTSTRAP_ADMIN_USERNAME=' "${ENV_FILE}" | cut -d= -f2)"
echo " 初始密码：  $(grep -E '^BOOTSTRAP_ADMIN_PASSWORD=' "${ENV_FILE}" | cut -d= -f2)   ← 首次登录会要求改密"
echo " 入口口令：  $(grep -E '^DATA_WORKBENCH_ENTRY_PASSWORD=' "${ENV_FILE}" | cut -d= -f2)   ← 左上角品牌区连击 3 次后输入"
echo ""
echo " 常用命令："
echo "   systemctl restart ${SERVICE}      重启"
echo "   journalctl -u ${SERVICE} -f       看日志"
echo "   bash ${ROOT}/src/deploy/reset-data.sh   清空数据重新试（保留账号配置）"
if [ "${MODE}" = "trial" ]; then
  echo ""
  echo " 提示：当前是试用模式（HTTP 明文、会话 Cookie 已降级）。"
  echo "       正式给医院用之前，改用 --behind-nginx 并配好 HTTPS。"
fi
echo "──────────────────────────────────────────────"
