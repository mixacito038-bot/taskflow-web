#!/usr/bin/env bash
# 一键部署到 Cloudflare Workers（免费版即可试用）。
#
# 前置：
#   export CLOUDFLARE_API_TOKEN=...      # 必填，见 docs/DEPLOY-CLOUDFLARE.md 的 Token 权限清单
#   export CLOUDFLARE_ACCOUNT_ID=...     # Token 只属于一个账号时可省略
# 可选（首次部署建议设置，冷启动引导首个平台管理员）：
#   export BOOTSTRAP_ADMIN_EMAIL=admin@example.com
#   export BOOTSTRAP_ADMIN_USERNAME=yh.admin
#   export BOOTSTRAP_ADMIN_PASSWORD='一个强密码'
#   export DATA_WORKBENCH_ENTRY_PASSWORD=yonghong   # 不设则用默认
#   export MFA_TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32)
#
# 用法：bash scripts/deploy-cloudflare.sh
set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?请先 export CLOUDFLARE_API_TOKEN（见 docs/DEPLOY-CLOUDFLARE.md）}"

WORKER_NAME="${WORKER_NAME:-yonghong-equipment-platform}"
D1_NAME="${D1_NAME:-yonghong-platform-db}"
R2_NAME="${R2_NAME:-yonghong-platform-files}"

echo "==> 构建生产产物"
npm run build

echo "==> 确认/创建 D1 数据库 ${D1_NAME}"
if ! npx wrangler d1 info "${D1_NAME}" >/dev/null 2>&1; then
  npx wrangler d1 create "${D1_NAME}"
fi
DB_ID="$(npx wrangler d1 info "${D1_NAME}" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.uuid||j.id||"")})')"
if [ -z "${DB_ID}" ]; then
  echo "无法解析 D1 database_id" >&2
  exit 1
fi
echo "    database_id=${DB_ID}"

echo "==> 确认/创建 R2 存储桶 ${R2_NAME}"
npx wrangler r2 bucket create "${R2_NAME}" >/dev/null 2>&1 || true

echo "==> 生成部署配置"
node scripts/make-deploy-config.mjs "${WORKER_NAME}" "${D1_NAME}" "${DB_ID}" "${R2_NAME}"

echo "==> 应用数据库迁移（wrangler 自带 d1_migrations 追踪，可重复执行）"
npx wrangler d1 migrations apply DB --remote -c dist/server/wrangler.deploy.json

echo "==> 部署 Worker"
npx wrangler deploy -c dist/server/wrangler.deploy.json

echo ""
echo "部署完成。访问地址见上方输出的 *.workers.dev URL。"
echo "首次登录：用 BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD 登录（系统会要求修改密码），"
echo "然后在「医院与权限」为其他成员分配账号；数据准备中心可一键载入示范数据正式发布。"
