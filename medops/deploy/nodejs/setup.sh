#!/usr/bin/env bash
# Node 方案一键部署（macOS / Linux，无需 Docker）
# 用法：进入 medops/deploy/nodejs 目录，执行  bash setup.sh
set -euo pipefail
cd "$(dirname "$0")"

HERE="$(pwd)"
MEDOPS="$(cd ../.. && pwd)"
SERVER="${MEDOPS}/server"
DATA="$(cd "${MEDOPS}/.." && pwd)/data"
LABEL="com.medops.inspection"
OS="$(uname -s)"

say()  { echo; echo "==== $* ===="; }
fail() { echo; echo "!! 出错：$*" >&2; exit 1; }

# ---- 0. 环境自检 ----
say "第 0 步：检查运行环境"
command -v node >/dev/null 2>&1 || fail "未找到 node。请先安装 Node.js LTS：https://nodejs.org/ （装完请关掉终端重开）"
NODE_BIN="$(command -v node)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "${NODE_MAJOR}" -ge 18 ] || fail "Node.js 版本过低（当前 $(node -v)），需要 18 或更高"
command -v npm >/dev/null 2>&1 || fail "未找到 npm（通常随 Node.js 一起安装）"
echo "Node.js $(node -v)  路径 ${NODE_BIN}"
echo "系统 ${OS}"

# ---- 1. 端口 ----
PORT="${PORT:-8080}"
if [ -f config.env ]; then
  # shellcheck disable=SC1091
  PORT="$(awk -F= '/^[[:space:]]*PORT[[:space:]]*=/{gsub(/[[:space:]"'"'"']/,"",$2); print $2}' config.env | tail -1)"
  PORT="${PORT:-8080}"
  echo "沿用 config.env 中的端口：${PORT}"
fi

# ---- 2. 安装后端依赖 ----
say "第 1 步：安装后端依赖（首次需 1～3 分钟，要联网）"
if [ -d "${SERVER}/node_modules" ] && [ -f "${SERVER}/node_modules/.package-lock.json" ]; then
  echo "依赖已存在，跳过（如需重装：删除 ${SERVER}/node_modules 后重跑）"
else
  ( cd "${SERVER}" && npm install --omit=dev --no-audit --no-fund ) \
    || fail "依赖安装失败。可先换国内镜像再重试：npm config set registry https://registry.npmmirror.com"
fi
# 逐个 require 校验：npm 偶发装一半仍返回成功，这里当场拦住
( cd "${SERVER}" && node -e '
  const d = Object.keys(require("./package.json").dependencies);
  for (const m of d) require(m);
  console.log("依赖自检通过：" + d.length + " 个");
' ) || fail "依赖不完整（npm 可能装了一半）。请删除 ${SERVER}/node_modules 后重跑本脚本"

# ---- 3. 数据目录与密钥 ----
say "第 2 步：准备数据目录与密钥"
mkdir -p "${DATA}"
SECRET_FILE="${DATA}/.jwt-secret"
if [ ! -f "${SECRET_FILE}" ]; then
  head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n' > "${SECRET_FILE}"
  chmod 600 "${SECRET_FILE}"
  echo "已生成随机密钥"
else
  echo "密钥已存在，沿用（换密钥会导致所有人重新登录）"
fi
echo "数据目录：${DATA}"
echo "（数据库、签名图、附件、每日备份都在这里；备份就是复制这个文件夹）"

# ---- 4. 写 config.env ----
cat > config.env <<EOF
# Node 方案运行配置。改完执行 bash manage.sh restart 生效。
# 网页端口。1024 以下（如 80）在 macOS 需要 root，建议保持 8080。
PORT=${PORT}
# 数据目录。搬迁数据时改这里。
DATA_DIR=${DATA}
EOF
chmod 600 config.env

# ---- 5. 管理员账号 ----
say "第 3 步：创建管理员账号（已存在则重置密码）"
read -r -p "管理员账号（建议 admin）: " ADMIN_USER
[ -n "${ADMIN_USER}" ] || fail "账号不能为空"
read -r -s -p "管理员密码（至少 6 位，输入时不显示）: " ADMIN_PASS; echo
[ ${#ADMIN_PASS} -ge 6 ] || fail "密码至少 6 位"
( cd "${SERVER}" && DATA_DIR="${DATA}" JWT_SECRET="$(cat "${SECRET_FILE}")" \
    node src/scripts/create-admin.js "${ADMIN_USER}" "${ADMIN_PASS}" ) \
  || fail "创建管理员失败"

# ---- 6. 安装开机自启服务 ----
say "第 4 步：安装后台服务（开机自启 + 崩溃自愈）"
if [ "${OS}" = "Darwin" ]; then
  PLIST="/Library/LaunchDaemons/${LABEL}.plist"
  LOGDIR="${DATA}/logs"
  mkdir -p "${LOGDIR}"
  TMP_PLIST="$(mktemp)"
  sed -e "s|__LABEL__|${LABEL}|g" \
      -e "s|__NODE__|${NODE_BIN}|g" \
      -e "s|__SERVE__|${HERE}/serve.js|g" \
      -e "s|__DIR__|${HERE}|g" \
      -e "s|__USER__|$(id -un)|g" \
      -e "s|__LOGDIR__|${LOGDIR}|g" \
      launchd.plist.template > "${TMP_PLIST}"

  echo "即将安装系统服务，需要输入你的开机密码（sudo）："
  sudo cp "${TMP_PLIST}" "${PLIST}"
  sudo chown root:wheel "${PLIST}"
  sudo chmod 644 "${PLIST}"
  rm -f "${TMP_PLIST}"

  sudo launchctl bootout system "${PLIST}" 2>/dev/null || true
  sudo launchctl bootstrap system "${PLIST}" 2>/dev/null \
    || sudo launchctl load -w "${PLIST}" \
    || fail "服务注册失败，请把上面的报错发我"
  echo "已注册开机自启服务：${LABEL}"
  echo "日志：${LOGDIR}/medops.log"
else
  echo "非 macOS，跳过 launchd。可用以下方式常驻："
  echo "  · systemd（Linux）：参见 docs/Mac-Node部署指南.md 附录"
  echo "  · 临时前台运行：PORT=${PORT} DATA_DIR=${DATA} node ${HERE}/serve.js"
  ( PORT="${PORT}" DATA_DIR="${DATA}" nohup node "${HERE}/serve.js" > "${DATA}/serve.log" 2>&1 & )
  echo "已在后台启动（日志 ${DATA}/serve.log）"
fi

# ---- 7. 等待就绪并给出地址 ----
say "第 5 步：等待服务就绪"
OK=0
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then OK=1; break; fi
  printf "."
  sleep 1
done
echo
[ "${OK}" = "1" ] || fail "服务 60 秒内未就绪。看日志：bash manage.sh logs"

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "${IP}" ] && command -v route >/dev/null 2>&1; then
  DEF_IF="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
  [ -n "${DEF_IF}" ] && IP="$(ipconfig getifaddr "${DEF_IF}" 2>/dev/null || true)"
fi
if [ -z "${IP}" ] && command -v ipconfig >/dev/null 2>&1; then
  for i in en0 en1 en2 en3 en4 en5; do
    IP="$(ipconfig getifaddr "$i" 2>/dev/null || true)"; [ -n "${IP}" ] && break
  done
fi
[ -n "${IP}" ] || IP="本机IP"
SUFFIX=""; [ "${PORT}" != "80" ] && SUFFIX=":${PORT}"

say "部署完成"
echo "在这台电脑上访问：     http://localhost${SUFFIX}/"
echo "同一局域网的手机/电脑： http://${IP}${SUFFIX}/"
echo
echo "  巡检 H5    http://${IP}${SUFFIX}/xunjian/    （手机扫码用）"
echo "  管理后台   http://${IP}${SUFFIX}/admin/      （用刚创建的管理员登录）"
echo "  资产盘点   http://${IP}${SUFFIX}/pandian/"
echo
echo "⚠ 请把这台电脑的 IP 固定下来，否则重启后 IP 变了，贴出去的二维码会失效。"
echo
echo "日常操作：bash manage.sh {status|restart|stop|start|logs|uninstall}"
echo "下一步：按 docs/数据初始化.md 建科室、导设备、开账号。"
