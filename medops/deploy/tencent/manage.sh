#!/usr/bin/env bash
# 日常运维小工具。用法：bash manage.sh <命令>
# 不加命令或输入不认识的命令，都会打印帮助。
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && . ./.env
WEB_PORT="${WEB_PORT:-8912}"
DATA_DIR="${DATA_DIR:-/opt/medops-data}"
# 启用 HTTPS 后自检要走 https，否则会全部报 000 让人以为服务挂了
if [ "${WEB_INNER_PORT:-80}" = 443 ]; then SCHEME=https; CURL="curl -sk"; else SCHEME=http; CURL="curl -s"; fi
BASE="${SCHEME}://127.0.0.1:${WEB_PORT}"

say() { echo; echo "==== $* ===="; }

case "${1:-帮助}" in

  状态|status)
    say "容器状态"; docker compose ps
    say "磁盘占用"; df -h / | tail -1
    echo "数据目录：$(du -sh "${DATA_DIR}" 2>/dev/null | cut -f1)  (${DATA_DIR})"
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
    [ -n "${NEW}" ] || { echo "用法：bash manage.sh 改端口 9000"; exit 1; }
    sed -i "s/^WEB_PORT=.*/WEB_PORT=${NEW}/" .env
    docker compose up -d
    echo "已改为 ${NEW}。别忘了在腾讯云安全组放行新端口、并关掉旧端口。"
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
  bash manage.sh 改端口 <新端口>  换对外端口

系统每天凌晨 2:30 会自动备份到数据目录里，但仍建议每周用「备份」命令拉一份到院内电脑。
EOF
    ;;
esac
