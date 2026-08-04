#!/usr/bin/env bash
# 首次部署一键脚本：生成配置 → 起后端 → 建管理员 → 签发证书 → 全量启动
# 用法：服务器上进入 medops/deploy/ 目录，执行  bash scripts/first-run.sh
set -euo pipefail

cd "$(dirname "$0")/.."   # 定位到 deploy/ 目录

say()  { echo; echo "==== $* ===="; }
fail() { echo "!! 出错：$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "未找到 docker，请先按《部署手册》第 5 步安装 Docker"
docker compose version >/dev/null 2>&1 || fail "未找到 docker compose 插件，请先按《部署手册》第 5 步安装"

# ---- 1. 生成 .env（随机 JWT_SECRET + 域名）----
say "第 1 步：准备 .env 配置"
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET=$(head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')
  sed -i "s/^JWT_SECRET=.*/JWT_SECRET=${SECRET}/" .env
  echo "已生成随机 JWT_SECRET 并写入 deploy/.env"
else
  echo "deploy/.env 已存在，沿用现有配置"
fi

. ./.env
if [ -z "${DOMAIN:-}" ]; then
  read -r -p "请输入站点域名（如 jx.example.com，需已解析到本服务器）: " DOMAIN
  [ -n "${DOMAIN}" ] || fail "域名不能为空"
  sed -i "s/^DOMAIN=.*/DOMAIN=${DOMAIN}/" .env
fi
echo "站点域名：${DOMAIN}"

# ---- 2. 替换 nginx 配置中的域名占位符 ----
say "第 2 步：把域名写入 nginx 配置"
if grep -q "YOUR_DOMAIN" nginx/conf.d/site.conf; then
  sed -i "s/YOUR_DOMAIN/${DOMAIN}/g" nginx/conf.d/site.conf
  echo "已替换 nginx/conf.d/site.conf 中的 YOUR_DOMAIN → ${DOMAIN}"
else
  echo "nginx 配置中已无占位符，跳过"
fi

# ---- 3. 创建数据目录 ----
say "第 3 步：创建数据目录"
mkdir -p ../../data
echo "数据目录：$(cd ../../data && pwd)（SQLite 库、签名图、附件、每日备份都在这里）"

# ---- 4. 构建并启动后端 ----
say "第 4 步：构建并启动后端 api（首次构建需几分钟，请耐心等待）"
docker compose up -d --build api
printf "等待后端通过健康检查"
st=starting
for i in $(seq 1 30); do
  st=$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q api)" 2>/dev/null || echo starting)
  [ "${st}" = healthy ] && break
  printf "."; sleep 2
done
echo
[ "${st}" = healthy ] || fail "后端未就绪，请执行 docker compose logs api 查看日志"
echo "后端已就绪"

# ---- 5. 创建管理员账号 ----
say "第 5 步：创建管理员账号（已存在则重置密码）"
read -r -p "管理员账号（如 admin）: " ADMIN_USER
read -r -s -p "管理员密码（至少 6 位，输入时不显示）: " ADMIN_PASS; echo
docker compose run --rm api node src/scripts/create-admin.js "${ADMIN_USER}" "${ADMIN_PASS}"

# ---- 6. 首签 HTTPS 证书 ----
say "第 6 步：签发 HTTPS 证书（Let's Encrypt，免费）"
if docker compose run --rm --entrypoint sh certbot -c "test -e /etc/letsencrypt/live/${DOMAIN}/fullchain.pem" >/dev/null 2>&1; then
  echo "证书已存在，跳过签发"
else
  EMAIL_ARG="--register-unsafely-without-email"
  [ -n "${CERT_EMAIL:-}" ] && EMAIL_ARG="-m ${CERT_EMAIL} --no-eff-email"
  # 首签用 standalone 模式（此刻 nginx 尚未启动、80 端口空闲）；
  # 日常续期由 certbot 容器以 webroot 模式自动完成（见 docker-compose.yml）
  docker compose run --rm -p 80:80 --entrypoint certbot certbot certonly --standalone \
    -d "${DOMAIN}" --agree-tos --non-interactive ${EMAIL_ARG} \
    || fail "证书签发失败：请确认 ① 域名已解析到本服务器公网 IP ② 安全组已放行 80 端口，然后重跑本脚本"
  echo "证书签发成功"
fi

# ---- 7. 启动全部服务 ----
say "第 7 步：启动 nginx 与证书自动续期服务"
docker compose up -d

say "部署完成！请打开浏览器逐项验证"
echo "  统一入口   https://${DOMAIN}/"
echo "  巡检 H5    https://${DOMAIN}/xunjian/"
echo "  管理后台   https://${DOMAIN}/admin/   （用刚才创建的管理员登录）"
echo "  资产盘点   https://${DOMAIN}/pandian/"
echo "  健康检查   https://${DOMAIN}/api/health   （应显示 {\"ok\":true}）"
echo
echo "下一步：按 docs/数据初始化.md 建科室、导设备、开账号。"
