#!/usr/bin/env bash
# 服务管理：bash manage.sh {status|start|stop|restart|logs|backup|uninstall}
set -euo pipefail
cd "$(dirname "$0")"

HERE="$(pwd)"
MEDOPS="$(cd ../.. && pwd)"
LABEL="com.medops.inspection"
PLIST="/Library/LaunchDaemons/${LABEL}.plist"
OS="$(uname -s)"

PORT=8080
DATA="$(cd "${MEDOPS}/.." && pwd)/data"
if [ -f config.env ]; then
  v="$(awk -F= '/^[[:space:]]*PORT[[:space:]]*=/{gsub(/[[:space:]"'"'"']/,"",$2); print $2}' config.env | tail -1)"
  [ -n "${v}" ] && PORT="${v}"
  v="$(awk -F= '/^[[:space:]]*DATA_DIR[[:space:]]*=/{sub(/^[^=]*=/,"",$0); gsub(/^[[:space:]]+|[[:space:]]+$/,"",$0); print}' config.env | tail -1)"
  [ -n "${v}" ] && DATA="${v}"
fi
LOGDIR="${DATA}/logs"

usage() {
  cat <<EOF
用法：bash manage.sh <命令>

  status     看服务是否在跑、端口是否通
  start      启动
  stop       停止
  restart    重启（改了 config.env 后用）
  logs       实时看日志（Ctrl+C 退出）
  backup     立刻做一次备份（平时每天 02:30 自动做）
  uninstall  卸载开机自启服务（不删数据）
EOF
}

is_mac() { [ "${OS}" = "Darwin" ]; }

cmd_status() {
  echo "端口：${PORT}    数据目录：${DATA}"
  if is_mac; then
    if sudo launchctl print "system/${LABEL}" >/dev/null 2>&1; then
      echo "服务：已注册（开机自启）"
      sudo launchctl print "system/${LABEL}" 2>/dev/null | awk '/state = |pid = |last exit/{print "  "$0}'
    else
      echo "服务：未注册（跑 bash setup.sh 安装）"
    fi
  else
    pgrep -f "serve.js" >/dev/null 2>&1 && echo "进程：运行中（pid $(pgrep -f serve.js | tr '\n' ' '))" || echo "进程：未运行"
  fi
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    echo "健康检查：✓ 正常 (http://127.0.0.1:${PORT}/api/health)"
  else
    echo "健康检查：✗ 不通（看日志：bash manage.sh logs）"
  fi
}

cmd_start() {
  if is_mac; then
    sudo launchctl bootstrap system "${PLIST}" 2>/dev/null || sudo launchctl load -w "${PLIST}"
  else
    ( PORT="${PORT}" DATA_DIR="${DATA}" nohup node "${HERE}/serve.js" > "${DATA}/serve.log" 2>&1 & )
  fi
  echo "已启动"
}

cmd_stop() {
  if is_mac; then
    sudo launchctl bootout "system/${LABEL}" 2>/dev/null || sudo launchctl unload "${PLIST}" 2>/dev/null || true
  else
    pkill -f "${HERE}/serve.js" 2>/dev/null || true
  fi
  echo "已停止"
}

cmd_logs() {
  if is_mac && [ -f "${LOGDIR}/medops.log" ]; then
    echo "日志：${LOGDIR}/medops.log（Ctrl+C 退出）"; echo
    tail -n 100 -f "${LOGDIR}/medops.log" "${LOGDIR}/medops.err.log"
  elif [ -f "${DATA}/serve.log" ]; then
    tail -n 100 -f "${DATA}/serve.log"
  else
    echo "还没有日志文件。服务可能没启动过，先跑 bash setup.sh"
  fi
}

cmd_backup() {
  ( cd "${MEDOPS}/server" && DATA_DIR="${DATA}" node -e '
      require("./src/scripts/backup").runBackup(process.env.DATA_DIR);
      console.log("备份完成");
    ' )
  echo "备份文件在：${DATA}/backups/"
  ls -lh "${DATA}/backups/" 2>/dev/null | tail -5
}

cmd_uninstall() {
  cmd_stop
  if is_mac; then sudo rm -f "${PLIST}" && echo "已删除 ${PLIST}"; fi
  echo "开机自启已卸载。数据仍在 ${DATA}，如需彻底清除请自行删除该文件夹。"
}

case "${1:-}" in
  status)    cmd_status ;;
  start)     cmd_start ;;
  stop)      cmd_stop ;;
  restart)   cmd_stop; sleep 2; cmd_start; sleep 3; cmd_status ;;
  logs)      cmd_logs ;;
  backup)    cmd_backup ;;
  uninstall) cmd_uninstall ;;
  *)         usage ;;
esac
