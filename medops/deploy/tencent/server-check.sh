#!/usr/bin/env bash
# 急救设备巡检系统 · 服务器体检（只读：只看、不改任何东西，不重启、不动别人的服务）
#
# 用法（服务器上，root）：
#   bash server-check.sh                    # 装过 20261125 之后的升级包也可以：cd /opt/medops/deploy/tencent && bash manage.sh doctor
#   bash server-check.sh xunjian.youhukang.com   # 域名不同时把域名写在后面
#
# 看什么：系统负载、内存、磁盘、时间、Docker、巡检系统的容器和网页、HTTPS 证书、数据库与每日备份、
#         最近 24 小时的报错、端口、SSH 暴力登录尝试。最后列一个总结（✓ 正常 / ! 留意 / ✗ 要处理）。
# 结果同时存一份到 /root/medops-server-check-<时间>.txt，方便整个发给技术支持。
set -u
APP_DIR="${MEDOPS_APP_DIR:-/opt/medops}"
DEPLOY="${APP_DIR}/deploy/tencent"
DOMAIN="${1:-xunjian.youhukang.com}"
OUT="/root/medops-server-check-$(date +%Y%m%d-%H%M%S).txt"
[ -w /root ] || OUT="/tmp/medops-server-check-$(date +%Y%m%d-%H%M%S).txt"

OK=(); WARN=(); BAD=()
ok()   { echo "  ✓ $*"; OK+=("$*"); }
warn() { echo "  ! $*"; WARN+=("$*"); }
bad()  { echo "  ✗ $*"; BAD+=("$*"); }
say()  { echo; echo "==== $* ===="; }
has()  { command -v "$1" >/dev/null 2>&1; }

main() {
WEB_PORT=8912; WEB_INNER_PORT=80; DATA_DIR=/opt/medops-data   # .env 里有就用 .env 的
echo "急救设备巡检系统 · 服务器体检    $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "（只读检查，不改动任何东西）"

# ---------------------------------------------------------------- 系统
say "系统"
. /etc/os-release 2>/dev/null && echo "  系统：${PRETTY_NAME:-未知}    内核：$(uname -r)"
echo "  主机名：$(hostname)    已运行：$(uptime -p 2>/dev/null || uptime)"
CPUS=$(nproc 2>/dev/null || echo 1)
LOAD=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)
echo "  CPU：${CPUS} 核    负载（1/5/15 分钟）：${LOAD}"
L15=$(cut -d' ' -f3 /proc/loadavg 2>/dev/null || echo 0)
if awk -v l="$L15" -v c="$CPUS" 'BEGIN{exit !(l > c*2)}'; then warn "15 分钟平均负载 ${L15} 偏高（${CPUS} 核）"; else ok "负载正常（${L15} / ${CPUS} 核）"; fi

# ---------------------------------------------------------------- 时间
say "时间"
echo "  服务器时间：$(date '+%Y-%m-%d %H:%M:%S')    时区：$(timedatectl show -p Timezone --value 2>/dev/null || date +%Z)"
SYNC=$(timedatectl show -p NTPSynchronized --value 2>/dev/null || echo "")
if [ "$SYNC" = yes ]; then ok "时间已和网络时间同步"
elif [ "$SYNC" = no ]; then warn "时间没有和网络时间同步（签字日期以服务器时间为准，差太多会签错日子）"
else echo "  （无法读取时间同步状态）"; fi

# ---------------------------------------------------------------- 内存
say "内存"
free -h 2>/dev/null | sed 's/^/  /'
AVAIL_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $7}')
if [ -n "${AVAIL_MB}" ]; then
  if [ "${AVAIL_MB}" -lt 150 ]; then bad "可用内存只剩 ${AVAIL_MB} MB"
  elif [ "${AVAIL_MB}" -lt 400 ]; then warn "可用内存 ${AVAIL_MB} MB，偏少"
  else ok "可用内存 ${AVAIL_MB} MB"; fi
fi
echo "  占内存最多的进程："
ps -eo pid,%mem,%cpu,etime,comm --sort=-%mem 2>/dev/null | head -8 | sed 's/^/    /'

# ---------------------------------------------------------------- 磁盘
say "磁盘"
df -h / /opt 2>/dev/null | awk 'NR==1 || !seen[$1]++' | sed 's/^/  /'
USE=$(df -P / 2>/dev/null | awk 'NR==2{gsub("%","",$5); print $5}')
if [ -n "${USE}" ]; then
  if [ "${USE}" -ge 95 ]; then bad "系统盘已用 ${USE}%（满了会写不进数据、签不了字）"
  elif [ "${USE}" -ge 85 ]; then warn "系统盘已用 ${USE}%"
  else ok "系统盘已用 ${USE}%"; fi
fi
IUSE=$(df -Pi / 2>/dev/null | awk 'NR==2{gsub("%","",$5); print $5}')
[ -n "${IUSE}" ] && [ "${IUSE}" != "-" ] && [ "${IUSE}" -ge 90 ] && warn "系统盘文件数（inode）已用 ${IUSE}%"

# ---------------------------------------------------------------- 巡检系统配置
say "巡检系统"
if [ ! -d "${DEPLOY}" ]; then
  bad "找不到 ${DEPLOY}（巡检系统不在默认位置？）"
else
  cd "${DEPLOY}"
  # 只读出这几项，不打印 .env 里的密钥
  if [ -f .env ]; then
    for k in WEB_PORT WEB_INNER_PORT DATA_DIR; do
      v=$(grep -E "^${k}=" .env | tail -1 | cut -d= -f2- | tr -d '"'"'"'\r')
      [ -n "$v" ] && printf -v "$k" '%s' "$v"
    done
    grep -qE '^JWT_SECRET=.{16,}' .env && ok "登录密钥已配置（内容不显示）" || bad ".env 里没有登录密钥 JWT_SECRET，或太短"
  else
    bad "${DEPLOY}/.env 不存在"
  fi
  if [ -f "${APP_DIR}/RELEASE" ]; then
    echo "  当前版本：$(tr '\n' ' ' < "${APP_DIR}/RELEASE")"
  else
    echo "  当前版本：（没有 RELEASE 文件，可能是手工部署的）"
  fi
  echo "  代码目录：${APP_DIR}    数据目录：${DATA_DIR}    对外端口：${WEB_PORT}（容器内 ${WEB_INNER_PORT}）"
fi

# ---------------------------------------------------------------- Docker
say "Docker"
if ! has docker; then
  bad "没有安装 docker"
else
  echo "  Docker：$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo 读不到（服务没启动？）)    Compose：$(docker compose version --short 2>/dev/null || echo 没有)"
  if systemctl is-active --quiet docker 2>/dev/null; then ok "Docker 服务在运行"; else warn "systemctl 显示 Docker 服务不在运行（或无法查询）"; fi
  systemctl is-enabled --quiet docker 2>/dev/null && ok "Docker 已设为开机自启" || warn "Docker 没有设为开机自启（服务器重启后巡检系统不会自己起来）"
  if [ -d "${DEPLOY}" ]; then
    cd "${DEPLOY}"
    echo "  巡检系统的容器："
    docker compose ps 2>/dev/null | sed 's/^/    /'
    for c in $(docker compose ps -q 2>/dev/null); do
      NAME=$(docker inspect -f '{{.Name}}' "$c" 2>/dev/null | tr -d /)
      STATE=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null)
      RC=$(docker inspect -f '{{.RestartCount}}' "$c" 2>/dev/null)
      POL=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$c" 2>/dev/null)
      STARTED=$(docker inspect -f '{{.State.StartedAt}}' "$c" 2>/dev/null | cut -c1-19 | tr T ' ')
      OOM=$(docker inspect -f '{{.State.OOMKilled}}' "$c" 2>/dev/null)
      echo "    ${NAME}：${STATE}，启动于 ${STARTED} (UTC)，自动重启 ${RC} 次，重启策略 ${POL}"
      [ "${STATE}" = running ] && ok "容器 ${NAME} 在运行" || bad "容器 ${NAME} 状态 ${STATE}"
      [ "${RC:-0}" -gt 0 ] && warn "容器 ${NAME} 自己重启过 ${RC} 次（程序崩溃过，看下面的报错）"
      [ "${OOM}" = true ] && bad "容器 ${NAME} 曾因内存不足被杀"
      case "${POL}" in always|unless-stopped) ;; *) warn "容器 ${NAME} 的重启策略是「${POL}」，服务器重启后可能不会自动起来" ;; esac
    done
    [ -z "$(docker compose ps -q 2>/dev/null)" ] && bad "巡检系统的容器一个都没在运行"
  fi
  echo "  本机全部容器（含别人的服务，只看不动）："
  docker ps --format '    {{.Names}}  {{.Status}}  {{.Ports}}' 2>/dev/null | head -20
  echo "  Docker 占用磁盘："
  docker system df 2>/dev/null | sed 's/^/    /'
fi

# ---------------------------------------------------------------- 网页
say "网页（本机自检）"
if [ "${WEB_INNER_PORT:-80}" = 443 ]; then BASE="https://127.0.0.1:${WEB_PORT}"; CURL="curl -sk"; else BASE="http://127.0.0.1:${WEB_PORT}"; CURL="curl -s"; fi
for u in /api/health /xunjian/ /admin/ /pandian/ /; do
  t0=$(date +%s%N)
  code=$(${CURL} -o /dev/null -w '%{http_code}' --max-time 10 "${BASE}${u}" 2>/dev/null || echo 000)
  ms=$(( ($(date +%s%N) - t0) / 1000000 ))
  if [ "$code" = 200 ]; then ok "${u} 正常（${ms} 毫秒）"; else bad "${u} 返回 ${code}"; fi
done
if [ "${WEB_INNER_PORT:-80}" = 443 ]; then
  # 用正式域名、走本机、真的校验证书：浏览器看到的就是这个结果
  V=$(curl -s -o /dev/null -w '%{http_code} %{ssl_verify_result}' --max-time 10 --resolve "${DOMAIN}:443:127.0.0.1" "https://${DOMAIN}/api/health" 2>/dev/null)
  if [ "${V%% *}" = 200 ]; then ok "https://${DOMAIN} 证书校验通过（和浏览器看到的一样）"
  else bad "https://${DOMAIN} 证书校验没通过（${V:-连不上}），浏览器可能报不安全"; fi
  PUB=$(getent hosts "${DOMAIN}" 2>/dev/null | awk '{print $1}' | head -1)
  MYIP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null)
  echo "  域名 ${DOMAIN} 解析到：${PUB:-（解析失败）}    本机公网 IP：${MYIP:-（查不到）}"
  [ -n "${PUB}" ] && [ -n "${MYIP}" ] && { [ "${PUB}" = "${MYIP}" ] && ok "域名解析指向本机" || warn "域名解析（${PUB}）不是本机公网 IP（${MYIP}）"; }
fi

# ---------------------------------------------------------------- 证书
if [ -f "${DEPLOY}/certs/server.crt" ]; then
  say "HTTPS 证书"
  C="${DEPLOY}/certs/server.crt"
  echo "  域名：$(openssl x509 -noout -ext subjectAltName -in "$C" 2>/dev/null | tail -1 | sed 's/^ *//')"
  echo "  签发：$(openssl x509 -noout -issuer -in "$C" 2>/dev/null | sed 's/^issuer=//')"
  END=$(openssl x509 -enddate -noout -in "$C" 2>/dev/null | cut -d= -f2)
  ENDS=$(date -d "${END}" +%s 2>/dev/null || echo 0)
  if [ "${ENDS}" -gt 0 ]; then
    LEFT=$(( (ENDS - $(date +%s)) / 86400 ))
    echo "  到期：$(date -d "${END}" '+%Y-%m-%d')（还剩 ${LEFT} 天）"
    if [ "${LEFT}" -lt 0 ]; then bad "证书已过期"
    elif [ "${LEFT}" -le 15 ]; then warn "证书 ${LEFT} 天后到期，请准备新证书（上传到 /root/ 后 bash manage.sh cert）"
    else ok "证书还有 ${LEFT} 天到期"; fi
  fi
  N=$(grep -c 'BEGIN CERTIFICATE' "$C" 2>/dev/null)
  [ "${N:-0}" -ge 2 ] && ok "证书带了中间证书（${N} 张）" || warn "证书文件只有 ${N} 张，缺中间证书时部分手机会报不安全"
fi

# ---------------------------------------------------------------- 数据与备份
say "数据与备份"
if [ -d "${DATA_DIR:-/opt/medops-data}" ]; then
  D="${DATA_DIR:-/opt/medops-data}"
  echo "  数据目录合计：$(du -sh "$D" 2>/dev/null | cut -f1)"
  for f in app.db app.db-wal; do [ -f "$D/$f" ] && echo "    $f：$(du -h "$D/$f" | cut -f1)"; done
  for d in files backups ams; do [ -d "$D/$d" ] && echo "    $d/：$(du -sh "$D/$d" 2>/dev/null | cut -f1)，$(find "$D/$d" -type f 2>/dev/null | wc -l) 个文件"; done
  LAST=$(ls -1t "$D"/backups/app-*.db 2>/dev/null | head -1)
  if [ -n "${LAST}" ]; then
    AGE=$(( ($(date +%s) - $(stat -c %Y "${LAST}")) / 3600 ))
    echo "  最近一份自动备份：$(basename "${LAST}")（$(du -h "${LAST}" | cut -f1)，${AGE} 小时前）"
    echo "  自动备份份数：$(ls -1 "$D"/backups/app-*.db 2>/dev/null | wc -l)（保留 30 天）"
    if [ "${AGE}" -le 30 ]; then ok "每日自动备份正常（最近一份 ${AGE} 小时前）"
    elif [ "${AGE}" -le 54 ]; then warn "最近一份自动备份是 ${AGE} 小时前（每天 02:30 一份）"
    else bad "已经 ${AGE} 小时没有自动备份了"; fi
  else
    warn "数据目录里没有自动备份（每天 02:30 自动做，刚装好的不到一天属正常）"
  fi
  ROOTBK=$(ls -1t /root/medops-backup-*.tar.gz 2>/dev/null | wc -l)
  [ "${ROOTBK}" -gt 0 ] && echo "  /root 下升级时留的备份：${ROOTBK} 份，合计 $(du -ch /root/medops-backup-*.tar.gz 2>/dev/null | tail -1 | cut -f1)（不会自动删，多了可以拉回院内后删掉旧的）"
  [ "${ROOTBK}" -gt 15 ] && warn "/root 下的升级备份有 ${ROOTBK} 份，占空间"
else
  bad "数据目录 ${DATA_DIR:-/opt/medops-data} 不存在"
fi

# ---------------------------------------------------------------- 报错
if [ -d "${DEPLOY}" ] && has docker; then
  say "最近 24 小时的报错（后端）"
  cd "${DEPLOY}"
  ERRS=$(docker compose logs --no-color --since 24h api 2>/dev/null | grep -E '"level":(50|60)|Error|ERROR|✗|未捕获|uncaught' | grep -v 'level":30' )
  NERR=$(printf '%s' "${ERRS}" | grep -c . )
  if [ "${NERR}" -eq 0 ]; then ok "后端最近 24 小时没有报错"
  else
    warn "后端最近 24 小时有 ${NERR} 行报错（下面是最后几行）"
    printf '%s\n' "${ERRS}" | tail -8 | cut -c1-300 | sed 's/^/    /'
  fi
  say "最近 24 小时的网页访问（nginx）"
  WEBLOG=$(docker compose logs --no-color --since 24h web 2>/dev/null)
  TOTAL=$(printf '%s\n' "${WEBLOG}" | grep -cE '" [0-9]{3} ')
  E5=$(printf '%s\n' "${WEBLOG}" | grep -cE '" 5[0-9]{2} ')
  E429=$(printf '%s\n' "${WEBLOG}" | grep -cE '" 429 ')
  echo "  请求 ${TOTAL} 次，其中服务器错误（5xx）${E5} 次，请求过于频繁（429）${E429} 次"
  [ "${E5}" -gt 20 ] && warn "最近 24 小时有 ${E5} 次 5xx 错误" || ok "5xx 错误 ${E5} 次"
  [ "${E5}" -gt 0 ] && printf '%s\n' "${WEBLOG}" | grep -E '" 5[0-9]{2} ' | tail -5 | cut -c1-250 | sed 's/^/    /'
fi

# ---------------------------------------------------------------- 端口与安全
say "端口与安全"
if has ss; then
  echo "  正在监听的端口："
  ss -ltnp 2>/dev/null | awk 'NR>1{print $4, $6}' | sed 's/users:((//; s/,pid=.*//' | sort -u | head -25 | sed 's/^/    /'
fi
FAILS=""
if [ -f /var/log/secure ]; then FAILS=$(grep -c "Failed password\|Invalid user" /var/log/secure 2>/dev/null)
elif has journalctl; then FAILS=$(journalctl -u sshd --since "24 hours ago" 2>/dev/null | grep -c "Failed password\|Invalid user"); fi
if [ -n "${FAILS}" ]; then
  echo "  SSH 登录失败记录：${FAILS} 次（/var/log/secure 或最近 24 小时）"
  [ "${FAILS}" -gt 1000 ] && warn "有大量 SSH 暴力猜密码（${FAILS} 次）：root 密码务必足够复杂，可在腾讯云安全组里只放行医院的 IP 访问 22 端口"
fi
[ -f /var/run/reboot-required ] && warn "系统提示需要重启以完成更新"

# ---------------------------------------------------------------- 总结
say "总结"
echo "  ✓ 正常 ${#OK[@]} 项    ! 留意 ${#WARN[@]} 项    ✗ 要处理 ${#BAD[@]} 项"
for x in "${BAD[@]}"; do echo "  ✗ $x"; done
for x in "${WARN[@]}"; do echo "  ! $x"; done
[ ${#BAD[@]} -eq 0 ] && [ ${#WARN[@]} -eq 0 ] && echo "  全部正常。"
echo
echo "  这份结果已保存到：${OUT}"
}

main 2>&1 | tee "${OUT}"
