#!/usr/bin/env bash
# 腾讯云一键部署：生成配置 → 建数据目录 → 构建后端 → 建管理员 → 起服务 → 自检
# 用法：进入 medops/deploy/tencent 目录，执行  bash deploy.sh
# 本脚本可以反复执行（幂等）：已存在的配置、管理员、数据都不会被覆盖。
set -euo pipefail
cd "$(dirname "$0")"

say()  { echo; echo "==== $* ===="; }
ok()   { echo "  ✓ $*"; }
warn() { echo "  ! $*"; }
fail() { echo; echo "!! 出错：$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "未找到 docker。请先执行：sudo bash install-docker.sh"
docker compose version >/dev/null 2>&1 || fail "未找到 docker compose 插件。请先执行：sudo bash install-docker.sh"
docker info >/dev/null 2>&1 || fail "Docker 没有运行。执行 sudo systemctl start docker 后重试"

# ---------- 1. 配置 ----------
say "第 1 步：准备配置"
if [ ! -f .env ]; then
  SECRET=$(head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')
  {
    echo "# 本文件由 deploy.sh 自动生成，含签名密钥，请勿外传、勿提交到代码仓库"
    echo "JWT_SECRET=${SECRET}"
    echo "WEB_PORT=${WEB_PORT:-8912}"
    echo "DATA_DIR=${DATA_DIR:-/opt/medops-data}"
  } > .env
  chmod 600 .env
  ok "已生成 .env（含随机密钥）"
else
  ok ".env 已存在，沿用现有配置（要重置密钥就删掉 .env 重跑，但所有人需重新登录）"
fi
# shellcheck disable=SC1091
. ./.env
WEB_PORT="${WEB_PORT:-8912}"
DATA_DIR="${DATA_DIR:-/opt/medops-data}"
ok "对外端口：${WEB_PORT}"
ok "数据目录：${DATA_DIR}"

# ---------- 2. 数据目录 ----------
say "第 2 步：创建数据目录"
mkdir -p "${DATA_DIR}"
ok "$(cd "${DATA_DIR}" && pwd)  ← 备份就是把这个目录整个拷走"

# ---------- 3. 放行端口 ----------
say "第 3 步：放行服务器本机防火墙"
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port="${WEB_PORT}"/tcp >/dev/null && firewall-cmd --reload >/dev/null
  ok "firewalld 已放行 ${WEB_PORT}/tcp"
elif command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "${WEB_PORT}"/tcp >/dev/null
  ok "ufw 已放行 ${WEB_PORT}/tcp"
else
  ok "本机未启用防火墙，无需处理"
fi
warn "腾讯云【安全组】还要单独放行 ${WEB_PORT} 端口——这一步在网页控制台做，脚本改不了"

# ---------- 4. 先探一下 npm 源通不通 ----------
say "第 4 步：检查 npm 源"
# 不先探直接构建的话，源不通时 npm 自己会重试很久才报错，屏幕上看着像卡死了。
# 这里 8 秒内选出一个能用的源，选不到就当场说清楚，不让人干等。
pick_registry() {
  for r in "${NPM_REGISTRY:-https://registry.npmmirror.com}" https://registry.npmjs.org; do
    [ -n "$r" ] || continue
    if curl -sf -o /dev/null --max-time 8 "${r}/fastify" 2>/dev/null; then echo "$r"; return 0; fi
  done
  return 1
}
if REG=$(pick_registry); then
  ok "使用 npm 源：${REG}"
  if grep -q '^NPM_REGISTRY=' .env; then sed -i "s#^NPM_REGISTRY=.*#NPM_REGISTRY=${REG}#" .env
  else echo "NPM_REGISTRY=${REG}" >> .env; fi
  export NPM_REGISTRY="${REG}"
else
  fail "两个 npm 源都连不上（npmmirror 和 npmjs）。请确认服务器能访问外网：curl -I https://registry.npmmirror.com"
fi

# ---------- 5. 构建后端 ----------
say "第 5 步：构建并启动后端（首次要拉镜像+编译，约 3～8 分钟，请耐心等）"
docker compose up -d --build api || fail "后端构建失败。若卡在拉取镜像，多半是没配镜像加速：sudo bash install-docker.sh"
printf "  等待后端健康检查通过"
st=starting
for i in $(seq 1 45); do
  st=$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q api)" 2>/dev/null || echo starting)
  [ "${st}" = healthy ] && break
  printf "."; sleep 2
done
echo
[ "${st}" = healthy ] || fail "后端未就绪。查看日志：docker compose logs --tail=80 api"
ok "后端已就绪"

# ---------- 6. 管理员账号 ----------
say "第 6 步：管理员账号"
if docker compose run --rm -T api node -e "
  const {initDb,getDb}=require('./src/db/connection');
  initDb(process.env.DATA_DIR);
  const n=getDb().prepare(\"SELECT count(*) c FROM users WHERE role='admin'\").get().c;
  process.exit(n>0?0:1);
" </dev/null >/dev/null 2>&1; then
  ok "已存在管理员账号，跳过创建（忘记密码请执行：bash manage.sh 重置管理员）"
else
  echo "  这是第一次部署，现在创建管理员。密码至少 6 位，输入时屏幕不显示。"
  read -r -p "  管理员账号名（建议 admin）: " AU
  [ -n "${AU}" ] || fail "账号名不能为空"
  read -r -s -p "  管理员密码: " AP1; echo
  read -r -s -p "  再输一次确认: " AP2; echo
  [ "${AP1}" = "${AP2}" ] || fail "两次输入的密码不一致，请重跑本脚本"
  [ ${#AP1} -ge 6 ] || fail "密码至少 6 位"
  docker compose run --rm -T api node src/scripts/create-admin.js "${AU}" "${AP1}" </dev/null || fail "创建管理员失败"
  ok "管理员 ${AU} 已创建"
fi

# ---------- 7. 全量启动 ----------
say "第 7 步：启动网站服务"
docker compose up -d || fail "启动失败，查看：docker compose logs --tail=80"
sleep 3
ok "容器已启动"

# ---------- 8. 自检 ----------
say "第 8 步：自检（在服务器本机访问，验证服务本身没问题）"
BASE="http://127.0.0.1:${WEB_PORT}"
allok=1
check() {
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1" || echo 000)
  if [ "$code" = "$2" ]; then ok "$3  ($code)"; else echo "  ✗ $3  期望 $2，实际 $code"; allok=0; fi
}
check "${BASE}/api/health" 200 "后端健康检查"
check "${BASE}/"           200 "统一入口页"
check "${BASE}/xunjian/"   200 "巡检 H5"
check "${BASE}/admin/"     200 "管理后台"
check "${BASE}/pandian/"   200 "资产盘点"
# 非标准端口最容易踩的坑：少打斜杠时跳转会不会把 :8912 弄丢
loc=$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 10 "${BASE}/admin" || true)
case "${loc}" in
  *:${WEB_PORT}/admin/|/admin/|"") ok "少打斜杠时跳转正常（未丢失端口号）" ;;
  *) echo "  ✗ /admin 跳转到了 ${loc}，端口号丢了"; allok=0 ;;
esac
body=$(curl -s --max-time 10 "${BASE}/api/health" || true)
case "${body}" in *'"ok":true'*) ok "健康检查返回 ${body}" ;; *) echo "  ✗ 健康检查返回异常：${body}"; allok=0 ;; esac

IP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || echo "你的服务器公网IP")
say "部署完成"
if [ "${allok}" = 1 ]; then
  echo "服务器本机自检全部通过。现在用电脑/手机浏览器访问下面的地址："
else
  echo "自检有未通过项（见上），先按提示排查；下面是访问地址："
fi
echo
echo "  统一入口   http://${IP}:${WEB_PORT}/"
echo "  巡检 H5    http://${IP}:${WEB_PORT}/xunjian/      ← 发给护士长和巡检员，做成二维码贴墙上"
echo "  管理后台   http://${IP}:${WEB_PORT}/admin/        ← 设备科在电脑上用"
echo "  资产盘点   http://${IP}:${WEB_PORT}/pandian/"
echo
echo "如果本机自检通过、但浏览器打不开，99% 是腾讯云【安全组】没放行 ${WEB_PORT} 端口。"
echo "下一步：按 docs/数据初始化.md 建科室 → 导设备 → 开账号。"
echo "日常运维：bash manage.sh 帮助"
