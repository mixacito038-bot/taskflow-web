#!/usr/bin/env bash
# 局域网部署一键脚本（Mac / Linux）
# 用法：进入 medops/deploy/local 目录，执行  bash setup.sh
set -euo pipefail
cd "$(dirname "$0")"

say()  { echo; echo "==== $* ===="; }
fail() { echo; echo "!! 出错：$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "未找到 docker，请先安装 Docker Desktop 并启动它"
docker compose version >/dev/null 2>&1 || fail "未找到 docker compose 插件，请更新 Docker Desktop"
docker info >/dev/null 2>&1 || fail "Docker 没有在运行，请先启动 Docker Desktop，等鲸鱼图标不再转动后重试"

# ---- 1. 生成 .env ----
say "第 1 步：准备配置"
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET=$(head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')
  # BSD sed(macOS) 与 GNU sed 参数不同，用临时文件规避
  sed "s/^JWT_SECRET=.*/JWT_SECRET=${SECRET}/" .env > .env.tmp && mv .env.tmp .env
  echo "已生成随机密钥并写入 .env"
else
  echo ".env 已存在，沿用现有配置（如需重新生成，删除 .env 后重跑）"
fi
# shellcheck disable=SC1091
. ./.env
WEB_PORT="${WEB_PORT:-80}"

# ---- 2. 数据目录 ----
say "第 2 步：创建数据目录"
mkdir -p ../../../data
echo "数据目录：$(cd ../../../data && pwd)"
echo "（数据库、签名图、附件、每日备份都在这里；备份就是复制这个文件夹）"

# ---- 3. 构建并启动后端 ----
say "第 3 步：构建并启动后端（首次需 3～5 分钟，请耐心等）"
docker compose up -d --build api
printf "等待后端就绪"
st=starting
for i in $(seq 1 60); do
  st=$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q api)" 2>/dev/null || echo starting)
  [ "${st}" = healthy ] && break
  printf "."; sleep 2
done
echo
[ "${st}" = healthy ] || fail "后端未就绪，请执行 docker compose logs api 查看日志"
echo "后端已就绪"

# ---- 4. 管理员账号 ----
say "第 4 步：创建管理员账号（已存在则重置密码）"
read -r -p "管理员账号（建议 admin）: " ADMIN_USER
[ -n "${ADMIN_USER}" ] || fail "账号不能为空"
read -r -s -p "管理员密码（至少 6 位，输入时不显示）: " ADMIN_PASS; echo
[ ${#ADMIN_PASS} -ge 6 ] || fail "密码至少 6 位"
docker compose run --rm api node src/scripts/create-admin.js "${ADMIN_USER}" "${ADMIN_PASS}"

# ---- 5. 启动网页服务 ----
say "第 5 步：启动网页服务"
docker compose up -d

# ---- 6. 提示访问地址 ----
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -n "${IP}" ] || IP=$(ipconfig getifaddr en0 2>/dev/null || echo "本机IP")
SUFFIX=""; [ "${WEB_PORT}" != "80" ] && SUFFIX=":${WEB_PORT}"

say "部署完成"
echo "在这台电脑上访问：   http://localhost${SUFFIX}/"
echo "同一局域网的手机/电脑： http://${IP}${SUFFIX}/"
echo
echo "  巡检 H5    http://${IP}${SUFFIX}/xunjian/    （手机扫码用）"
echo "  管理后台   http://${IP}${SUFFIX}/admin/      （用刚创建的管理员登录）"
echo "  资产盘点   http://${IP}${SUFFIX}/pandian/"
echo
echo "下一步：按 docs/数据初始化.md 建科室、导设备、开账号。"
echo "日常操作：docker compose ps 看状态 / docker compose logs -f api 看日志 / docker compose down 停止"
