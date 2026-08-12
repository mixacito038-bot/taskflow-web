#!/usr/bin/env bash
# 勇虹医疗设备效益管理平台 · TencentOS Server 4 (x86_64) 一键安装（不使用 Docker）
#
#   在解压后的源码目录里执行：bash deploy/install-tencentos.sh
#
# 做了什么：装 Node 22（若缺）→ 建服务账号与数据目录 → 部署到 /opt/yonghong-platform
# → 写 /etc/yonghong-platform.env → 注册 systemd 服务并启动 → 自检。
# 构建产物 dist/ 已随包提供，全程不需要 npm install。
set -euo pipefail

APP_DIR=/opt/yonghong-platform
DATA_DIR=/var/lib/yonghong-platform
ENV_FILE=/etc/yonghong-platform.env
SERVICE=yonghong-platform
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
  echo "    安装 Node 22（优先用系统源，失败再用 NodeSource）"
  dnf install -y nodejs22 2>/dev/null || dnf install -y nodejs 2>/dev/null || {
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
    dnf install -y nodejs
  }
  command -v node >/dev/null || { echo "Node 安装失败：请离线安装 Node 22 后重跑本脚本"; exit 1; }
else
  echo "    已满足：$(node -v)"
fi

echo "==> 2/6 创建服务账号与目录"
id yonghong >/dev/null 2>&1 || useradd --system --home "${DATA_DIR}" --shell /sbin/nologin yonghong
mkdir -p "${APP_DIR}" "${DATA_DIR}"

echo "==> 3/6 部署程序到 ${APP_DIR}"
# 只投放运行必需的三样：产物、迁移、服务壳；文档一并带上便于现场排查
rm -rf "${APP_DIR}/dist" "${APP_DIR}/drizzle" "${APP_DIR}/server-node"
cp -r "${SRC_DIR}/dist" "${SRC_DIR}/drizzle" "${SRC_DIR}/server-node" "${APP_DIR}/"
[ -d "${SRC_DIR}/docs" ] && { rm -rf "${APP_DIR}/docs"; cp -r "${SRC_DIR}/docs" "${APP_DIR}/"; }
chown -R yonghong:yonghong "${APP_DIR}" "${DATA_DIR}"

echo "==> 4/6 生成配置 ${ENV_FILE}"
if [ -f "${ENV_FILE}" ]; then
  echo "    已存在，保留原配置（如需改口令请手工编辑）"
else
  admin_pass="$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)Aa1"
  mfa_key="$(openssl rand -hex 32)"
  cp "${SRC_DIR}/deploy/yonghong-platform.env.example" "${ENV_FILE}"
  sed -i "s|^BOOTSTRAP_ADMIN_PASSWORD=.*|BOOTSTRAP_ADMIN_PASSWORD=${admin_pass}|" "${ENV_FILE}"
  sed -i "s|^MFA_TOTP_ENCRYPTION_KEY=.*|MFA_TOTP_ENCRYPTION_KEY=${mfa_key}|" "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
  echo "    已生成随机初始管理员密码，见本脚本结尾输出"
fi

echo "==> 5/6 注册并启动 systemd 服务"
cp "${SRC_DIR}/deploy/yonghong-platform.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now "${SERVICE}"

echo "==> 6/6 自检"
port="$(grep -E '^PORT=' "${ENV_FILE}" | cut -d= -f2)"; port="${port:-3000}"
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${port}/healthz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ "${ok:-0}" != "1" ]; then
  echo "健康检查未通过，请查看：journalctl -u ${SERVICE} -n 100 --no-pager"
  exit 1
fi

echo ""
echo "──────────────────────────────────────────────"
echo " 安装完成。服务监听 127.0.0.1:${port}"
echo " 管理员账号：$(grep -E '^BOOTSTRAP_ADMIN_USERNAME=' "${ENV_FILE}" | cut -d= -f2)"
echo " 初始密码：  $(grep -E '^BOOTSTRAP_ADMIN_PASSWORD=' "${ENV_FILE}" | cut -d= -f2)   ← 首次登录强制改密"
echo " 入口口令：  $(grep -E '^DATA_WORKBENCH_ENTRY_PASSWORD=' "${ENV_FILE}" | cut -d= -f2)   ← 品牌区连击 3 次后输入"
echo ""
echo " 下一步（正式使用必做）："
echo "   1. 配 nginx + HTTPS：参考 tencent-cloud/nginx.conf.example"
echo "   2. HTTPS 通了以后，删掉 ${ENV_FILE} 里的 APP_SESSION_ALLOW_INSECURE=1 并 systemctl restart ${SERVICE}"
echo "   3. 安全组只放行 22 与 443，不要对公网开放 ${port}"
echo "──────────────────────────────────────────────"
