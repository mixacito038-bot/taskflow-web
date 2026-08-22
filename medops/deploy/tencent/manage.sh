#!/usr/bin/env bash
# 日常运维小工具。用法：bash manage.sh <命令>
# 不加命令或输入不认识的命令，都会打印帮助。
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && . ./.env
WEB_PORT="${WEB_PORT:-8912}"
DATA_DIR="${DATA_DIR:-/opt/medops-data}"
# 端口占用探测：优先 ss/netstat，都没有时用 bash 内建的 /dev/tcp 试连
port_used() {
  if command -v ss >/dev/null 2>&1; then
    ss -lnt 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$" && return 0
  elif command -v netstat >/dev/null 2>&1; then
    netstat -lnt 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$" && return 0
  fi
  (exec 3<>/dev/tcp/127.0.0.1/"$1") 2>/dev/null && { exec 3<&- 3>&-; return 0; }
  return 1
}

# 启用 HTTPS 后自检要走 https，否则会全部报 000 让人以为服务挂了
if [ "${WEB_INNER_PORT:-80}" = 443 ]; then SCHEME=https; CURL="curl -sk"; else SCHEME=http; CURL="curl -s"; fi
BASE="${SCHEME}://127.0.0.1:${WEB_PORT}"

say() { echo; echo "==== $* ===="; }

case "${1:-帮助}" in

  状态|status)
    say "容器状态"; docker compose ps
    say "磁盘占用"; df -h / | tail -1
    echo "数据目录：$(du -sh "${DATA_DIR}" 2>/dev/null | cut -f1)  (${DATA_DIR})"
    if [ "${WEB_INNER_PORT:-80}" = 443 ] && [ -f certs/server.crt ]; then
      say "HTTPS 证书"
      END=$(openssl x509 -enddate -noout -in certs/server.crt 2>/dev/null | cut -d= -f2)
      if [ -n "${END}" ]; then
        ENDS=$(date -d "${END}" +%s 2>/dev/null || echo 0)
        NOWS=$(date +%s)
        if [ "${ENDS}" -gt 0 ]; then
          LEFT=$(( (ENDS - NOWS) / 86400 ))
          echo "  到期：$(date -d "${END}" '+%Y-%m-%d' 2>/dev/null)  剩余 ${LEFT} 天"
          [ "${LEFT}" -lt 0 ]  && echo "  ✗ 证书已过期！浏览器会报不安全，请立即重新申请并跑 enable-https.sh"
          [ "${LEFT}" -ge 0 ] && [ "${LEFT}" -le 15 ] && echo "  ! 快到期了，请尽快重新申请证书（腾讯云免费证书 90 天一续）"
        else
          echo "  到期：${END}"
        fi
      fi
    fi

    say "本机自检"
    echo "  （检查地址：${BASE}）"
    for u in /api/health / /xunjian/ /admin/ /pandian/; do
      code=$(${CURL} -o /dev/null -w '%{http_code}' --max-time 8 "${BASE}${u}" || echo 000)
      printf '  %-14s %s %s\n' "$u" "$code" "$([ "$code" = 200 ] && echo ✓ || echo ✗)"
    done
    ;;

  日志|logs)
    docker compose logs --tail="${2:-100}" -f
    ;;

  重启|restart)
    say "重启服务"; docker compose restart; sleep 3; docker compose ps
    ;;

  停止|stop)
    say "停止服务（数据不会丢，随时可以再启动）"; docker compose down
    ;;

  启动|start)
    say "启动服务"; docker compose up -d; sleep 3; docker compose ps
    ;;

  备份|backup)
    say "立即做一份完整备份"
    OUT="${2:-/root/medops-backup-$(date +%Y%m%d-%H%M%S).tar.gz}"
    STAGE=$(mktemp -d)
    trap 'rm -rf "$STAGE"' EXIT
    mkdir -p "${STAGE}/medops-data"

    # 直接 tar 正在被写的 app.db 可能抓到一个"写到一半"的快照（WAL 模式下尤其）。
    # 所以先让容器内跑一次 VACUUM INTO 生成**一致**的副本，再把这份副本当作 app.db 打包。
    if docker compose exec -T api node src/scripts/backup.js >/dev/null 2>&1; then
      SNAP=$(ls -1t "${DATA_DIR}"/backups/app-*.db 2>/dev/null | head -1)
      if [ -n "${SNAP}" ]; then
        cp "${SNAP}" "${STAGE}/medops-data/app.db"
        echo "  使用一致性快照：$(basename "${SNAP}")"
      fi
    fi
    if [ ! -f "${STAGE}/medops-data/app.db" ]; then
      echo "  ! 容器没在跑，改为直接复制数据库文件（若此刻正好有人在签字，可能丢最后几秒的数据）"
      cp "${DATA_DIR}/app.db" "${STAGE}/medops-data/app.db" 2>/dev/null || true
    fi
    # 签名图、附件、历史备份一并带走
    for d in files backups; do
      [ -d "${DATA_DIR}/${d}" ] && cp -a "${DATA_DIR}/${d}" "${STAGE}/medops-data/"
    done

    tar czf "${OUT}" -C "${STAGE}" medops-data
    echo "备份文件：${OUT}  ($(du -h "${OUT}" | cut -f1))"
    echo
    echo "⚠ 备份和数据在同一台机器上，机器坏了两边一起没。"
    echo "  请在自己电脑上执行下面这条，把它拉回院内保存："
    echo "  scp root@$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || echo 服务器IP):${OUT} ~/Downloads/"
    ;;

  恢复|restore)
    F="${2:-}"
    [ -n "${F}" ] && [ -f "${F}" ] || { echo "用法：bash manage.sh 恢复 /root/medops-backup-xxx.tar.gz"; exit 1; }
    say "恢复数据（会覆盖当前数据，请确认）"
    read -r -p "确认用 ${F} 覆盖 ${DATA_DIR} ？输入 yes 继续：" c
    [ "${c}" = yes ] || { echo "已取消"; exit 0; }
    docker compose down
    TMP=$(mktemp -d)
    tar xzf "${F}" -C "${TMP}" || { echo "备份文件解不开，可能传输过程中损坏"; rm -rf "${TMP}"; exit 1; }
    SRC="${TMP}/medops-data"
    [ -d "${SRC}" ] || SRC=$(find "${TMP}" -maxdepth 1 -mindepth 1 -type d | head -1)
    [ -f "${SRC}/app.db" ] || { echo "备份里没有 app.db，不像是本系统的备份"; rm -rf "${TMP}"; exit 1; }
    mv "${DATA_DIR}" "${DATA_DIR}.old.$(date +%s)"
    mv "${SRC}" "${DATA_DIR}"
    rm -rf "${TMP}"
    docker compose up -d
    sleep 5
    echo
    docker compose ps
    echo "恢复完成。旧数据保留在 ${DATA_DIR}.old.*，确认系统正常后可自行删除。"
    ;;

  升级|update)
    say "升级：用新的源码包覆盖代码后执行本命令"
    docker compose up -d --build
    sleep 5; docker compose ps
    echo "数据库结构会在后端启动时自动升级，老数据不受影响。"
    ;;

  重置管理员|reset-admin)
    say "重置/新建管理员账号"
    read -r -p "  账号名: " AU
    read -r -s -p "  新密码（至少 6 位）: " AP; echo
    docker compose run --rm -T api node src/scripts/create-admin.js "${AU}" "${AP}"
    echo "完成。该账号已可用新密码登录。"
    ;;

  改端口|port)
    NEW="${2:-}"
    [ -n "${NEW}" ] || { echo "用法：bash manage.sh 改端口 443"; exit 1; }
    case "${NEW}" in ''|*[!0-9]*) echo "端口必须是数字"; exit 1;; esac
    [ "${NEW}" -ge 1 ] && [ "${NEW}" -le 65535 ] || { echo "端口范围应在 1～65535"; exit 1; }

    # 换端口前必须先查占用。不查的话 docker 会抛一句很难懂的 bind 错误，
    # 而且此时旧容器已经停了 —— 等于把好好的站点弄挂了还不知道为什么。
    if [ "${NEW}" != "${WEB_PORT}" ] && port_used "${NEW}"; then
      echo
      echo "  当前占用 ${NEW} 端口的进程："
      { (ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null || true) | grep -E "[:.]${NEW}\b" | sed 's/^/    /'; } || true
      echo
      echo "!! 端口 ${NEW} 已被别的程序占用，本次未做任何改动（站点仍在 ${WEB_PORT} 上正常运行）。" >&2
      echo "   换一个空闲端口，或先停掉占用它的服务。" >&2
      exit 1
    fi

    say "把对外端口从 ${WEB_PORT} 改为 ${NEW}"
    sed -i "s/^WEB_PORT=.*/WEB_PORT=${NEW}/" .env
    docker compose up -d
    sleep 3
    docker compose ps --format '{{.Name}}\t{{.Ports}}'
    echo
    echo "已改为 ${NEW}。还要做两件事："
    echo "  1. 腾讯云安全组放行 ${NEW}（不放行的话外面打不开）"
    echo "  2. 二维码里写死了地址，换端口后要重新生成打印"
    ;;

  *)
    cat <<'EOF'
急救设备巡检系统 · 运维命令

  bash manage.sh 状态            看容器是否正常、磁盘还剩多少、各页面能不能打开
  bash manage.sh 日志 [行数]      实时看后端日志（Ctrl+C 退出）
  bash manage.sh 重启            重启服务
  bash manage.sh 停止 / 启动      停机 / 开机（数据不会丢）
  bash manage.sh 备份 [文件路径]  立即备份，并打印把它拉回本地的命令
  bash manage.sh 恢复 <备份文件>  用备份覆盖当前数据
  bash manage.sh 升级            上传新代码后重新构建启动
  bash manage.sh 重置管理员       忘记管理员密码时用
  bash manage.sh 改端口 <新端口>  换对外端口（会先查端口是否被占用）

系统每天凌晨 2:30 会自动备份到数据目录里，但仍建议每周用「备份」命令拉一份到院内电脑。
EOF
    ;;
esac
