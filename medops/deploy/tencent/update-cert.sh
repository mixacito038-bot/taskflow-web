#!/usr/bin/env bash
# =============================================================================
#  更换 HTTPS 证书（一条命令）
#
#  用法（root 执行）：
#    bash update-cert.sh                       # 自动在 /root 下找刚上传的证书（.pem/.crt）和私钥（.key）
#    bash update-cert.sh 证书.pem 私钥.key      # 或者直接指定两个文件（顺序随意）
#    bash update-cert.sh /root/某个文件夹        # 或者指定放证书的文件夹
#  也可以：bash manage.sh cert …（同上）
#
#  会自动完成：
#    1. 检查证书：私钥和证书是不是一对、有没有过期、是否包含本站域名、有没有带中间证书、私钥有没有密码
#       （任何一项不对都会停下来说明原因，网站不受影响）
#    2. 备份现在的证书    3. 换上新证书（就地覆盖文件，不动目录）
#    4. nginx 校验配置后平滑重载（不断线）；校验不过自动换回旧证书
#    5. 从本机连一次 https，确认对外发出的已经是新证书；最后打印新证书到期日
#
#  不会动的东西：程序代码、数据、端口、http→https 跳转设置。
#  适用于任何 CA 的「Nginx 版」证书（.pem / .crt + .key），腾讯云免费证书也一样。
# =============================================================================
set -uo pipefail

DOMAIN="${MEDOPS_DOMAIN:-xunjian.youhukang.com}"
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$HERE/docker-compose.yml" ] && [ -f "$HERE/nginx-https.conf" ]; then OPS="$HERE"
else OPS="${MEDOPS_OPS_DIR:-/opt/medops/deploy/tencent}"; fi
OUT="${MEDOPS_OUT_DIR:-/root}"
TS="$(date +%Y%m%d-%H%M%S)"
BAK="$OUT/medops-cert-backup-$TS"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

ok()   { echo "  ✓ $*"; }
warn() { echo "  ! $*"; }
die()  { echo; echo "  ✗ $*"; echo; echo "  证书没有更换，网站照旧运行。"; exit 1; }
step() { echo; echo "==== $* ===="; }

echo "急救设备巡检系统 · 更换 HTTPS 证书（域名 $DOMAIN）"
command -v openssl >/dev/null 2>&1 || die "服务器上没有 openssl 命令（yum install -y openssl 后再试）"
command -v docker >/dev/null 2>&1 || die "没找到 docker 命令"
[ -f "$OPS/.env" ] && [ -f "$OPS/docker-compose.yml" ] || die "没找到 $OPS/.env —— 巡检系统不在 /opt/medops？可以设置 MEDOPS_OPS_DIR=部署目录 后再执行"
read_env() { grep -E "^$1=" "$OPS/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'" ; }
setenv() { if grep -q "^$1=" "$OPS/.env"; then sed -i "s#^$1=.*#$1=$2#" "$OPS/.env"; else echo "$1=$2" >> "$OPS/.env"; fi; }

# ---------------------------------------------------------------------------
#  小工具：读证书 / 私钥（PEM 或 DER 都认），算公钥指纹用来配对
# ---------------------------------------------------------------------------
N=0
# 把证书文件转成 PEM（原样保留整条链）；不是证书返回 1
cert_pem() {  # cert_pem 源文件 目标文件
  if grep -q -- "-----BEGIN CERTIFICATE-----" "$1" 2>/dev/null; then
    sed 's/\r$//' "$1" > "$2"; openssl x509 -in "$2" -noout 2>/dev/null && return 0
  fi
  openssl x509 -inform DER -in "$1" -out "$2" 2>/dev/null && return 0
  return 1
}
cert_pub() { openssl x509 -in "$1" -noout -pubkey 2>/dev/null | openssl pkey -pubin -outform DER 2>/dev/null | sha256sum | cut -c1-64; }
key_pub()  { openssl pkey -in "$1" -passin pass: -pubout -outform DER 2>/dev/null | sha256sum | cut -c1-64; }
EMPTY_HASH="$(printf '' | sha256sum | cut -c1-64)"
chain_n()  { grep -c -- "-----BEGIN CERTIFICATE-----" "$1"; }
end_epoch() { date -d "$(openssl x509 -in "$1" -noout -enddate | cut -d= -f2)" +%s 2>/dev/null || echo 0; }
start_epoch() { date -d "$(openssl x509 -in "$1" -noout -startdate | cut -d= -f2)" +%s 2>/dev/null || echo 0; }
names_of() {  # 证书包含的域名
  local s
  s=$(openssl x509 -in "$1" -noout -ext subjectAltName 2>/dev/null | grep -o 'DNS:[^,]*' | sed 's/DNS://' | tr '\n' ' ')
  [ -n "$s" ] || s=$(openssl x509 -in "$1" -noout -text 2>/dev/null | grep -o 'DNS:[^,]*' | sed 's/DNS://' | tr '\n' ' ')
  [ -n "$s" ] || s=$(openssl x509 -in "$1" -noout -subject 2>/dev/null | sed -n 's/.*CN *= *\([^,/]*\).*/\1/p')
  echo "$s"
}
covers() { openssl x509 -in "$1" -noout -checkhost "$DOMAIN" 2>/dev/null | grep -q "does match"; }

# ---------------------------------------------------------------------------
step "1. 找到并检查新证书"
# ---------------------------------------------------------------------------
FILES=()
if [ $# -ge 2 ]; then FILES=("$1" "$2")
  for f in "${FILES[@]}"; do [ -f "$f" ] || die "找不到文件：$f"; done
else
  ROOTDIR="${1:-$OUT}"
  [ -d "$ROOTDIR" ] || die "找不到文件夹：$ROOTDIR"
  echo "  在 $ROOTDIR 下查找证书文件（.pem / .crt / .cer / .key）…"
  while IFS= read -r f; do FILES+=("$f"); done < <(find "$ROOTDIR" -maxdepth 3 -type f -size -200k \
      \( -iname '*.pem' -o -iname '*.crt' -o -iname '*.cer' -o -iname '*.key' \) \
      -not -path '*/medops-cert-backup-*' -not -path '*/.*' -not -path '*/node_modules/*' -not -path '*/medops.bak-*' 2>/dev/null | sort)
fi
[ ${#FILES[@]} -gt 0 ] || die "在 $OUT 下没找到证书文件。请先把 .pem（或 .crt）和 .key 两个文件上传到 /root/，再执行一次"

CERTS=(); KEYS=(); ENC_KEYS=()
for f in "${FILES[@]}"; do
  if grep -q -- "PRIVATE KEY-----" "$f" 2>/dev/null; then
    if grep -q "ENCRYPTED" "$f" || [ "$(key_pub "$f")" = "$EMPTY_HASH" ]; then ENC_KEYS+=("$f"); else KEYS+=("$f"); fi
    continue
  fi
  N=$((N + 1))
  if cert_pem "$f" "$TMP/c$N.pem"; then CERTS+=("$f|$TMP/c$N.pem"); fi
done
echo "  找到证书 ${#CERTS[@]} 个、私钥 ${#KEYS[@]} 个"
for c in "${CERTS[@]}"; do echo "    证书：${c%%|*}"; done
for k in "${KEYS[@]}"; do echo "    私钥：$k"; done
for k in "${ENC_KEYS[@]}"; do echo "    私钥（带密码，nginx 用不了）：$k"; done
[ ${#CERTS[@]} -gt 0 ] || die "没有找到证书文件（.pem / .crt 里应当是 -----BEGIN CERTIFICATE----- 开头的内容）"
if [ ${#KEYS[@]} -eq 0 ]; then
  [ ${#ENC_KEYS[@]} -gt 0 ] && die "私钥文件带了密码，nginx 不能直接用。请在证书平台下载时选择「不设密码」或「Nginx 版」重新下载"
  die "没有找到私钥文件（.key，内容是 -----BEGIN … PRIVATE KEY----- 开头）。请把 .key 一起上传到 /root/"
fi

# 配对：同一把公钥的证书和私钥。多对时优先：包含本站域名 > 没过期 > 带完整证书链 > 到期最晚
BEST=""; BEST_SCORE=-1; MATCHED=0
for c in "${CERTS[@]}"; do
  src="${c%%|*}"; pem="${c##*|}"; cp="$(cert_pub "$pem")"
  for k in "${KEYS[@]}"; do
    [ "$cp" = "$(key_pub "$k")" ] || continue
    MATCHED=1
    score=0
    covers "$pem" && score=$((score + 8))
    openssl x509 -in "$pem" -noout -checkend 0 >/dev/null 2>&1 && score=$((score + 4))
    [ "$(chain_n "$pem")" -ge 2 ] && score=$((score + 2))
    if [ $score -gt $BEST_SCORE ] || { [ $score -eq $BEST_SCORE ] && [ "$(end_epoch "$pem")" -gt "$(end_epoch "${BEST##*|}")" ]; }; then
      BEST="$src|$k|$pem"; BEST_SCORE=$score
    fi
  done
done
[ $MATCHED = 1 ] || die "证书和私钥不是一对（私钥对应的不是这张证书）。请确认两个文件来自同一次下载的同一个压缩包"

CRT_SRC="${BEST%%|*}"; rest="${BEST#*|}"; KEY_SRC="${rest%%|*}"; CRT_PEM="${BEST##*|}"
NOW=$(date +%s); END=$(end_epoch "$CRT_PEM"); START=$(start_epoch "$CRT_PEM")
LEFT=$(( (END - NOW) / 86400 ))
echo
echo "  证书文件：$CRT_SRC"
echo "  私钥文件：$KEY_SRC"
echo "  包含域名：$(names_of "$CRT_PEM")"
echo "  颁发机构：$(openssl x509 -in "$CRT_PEM" -noout -issuer | sed 's/^issuer= *//')"
echo "  有效期：  $(date -d @"$START" '+%Y-%m-%d') 至 $(date -d @"$END" '+%Y-%m-%d %H:%M')（还剩 $LEFT 天）"

ok "证书和私钥是一对"
covers "$CRT_PEM" || die "这张证书不包含本站域名 $DOMAIN（它只包含：$(names_of "$CRT_PEM")）。
     浏览器会继续报不安全。请申请包含 $DOMAIN 的证书（单域名证书填 $DOMAIN，或泛域名 *.youhukang.com）"
ok "包含本站域名 $DOMAIN"
openssl x509 -in "$CRT_PEM" -noout -checkend 0 >/dev/null 2>&1 || die "这张证书已经过期了（到期日 $(date -d @"$END" '+%Y-%m-%d')）"
[ "$START" -le $((NOW + 300)) ] || die "这张证书还没生效（$(date -d @"$START" '+%Y-%m-%d %H:%M') 才开始生效），请到时间再换；或检查服务器时间是否正确：$(date '+%Y-%m-%d %H:%M')"
ok "在有效期内"
if [ "$(chain_n "$CRT_PEM")" -ge 2 ]; then ok "带了中间证书（完整证书链，手机也能正常识别）"
else
  ISS="$(openssl x509 -in "$CRT_PEM" -noout -issuer | sed 's/^issuer= *//')"; SUB="$(openssl x509 -in "$CRT_PEM" -noout -subject | sed 's/^subject= *//')"
  [ "$ISS" = "$SUB" ] && die "这是一张自签名证书，浏览器不会信任。请用正规 CA 签发的证书"
  warn "证书文件里只有一张证书、没有中间证书：电脑浏览器一般没问题，部分手机可能提示不安全。"
  warn "如果压缩包里还有 chain / ca-bundle / intermediate 之类的文件，可以把它的内容接在 .pem 后面再执行一次。"
fi
if [ "$LEFT" -le 15 ]; then warn "这张证书只剩 $LEFT 天就到期了"; fi

# ---------------------------------------------------------------------------
step "2. 备份现在的证书"
# ---------------------------------------------------------------------------
cd "$OPS" || die "进不了 $OPS"
mkdir -p certs "$BAK"
cp -p .env "$BAK/env" 2>/dev/null || true
if [ -f certs/server.crt ]; then
  cp -p certs/server.crt "$BAK/server.crt"; cp -p certs/server.key "$BAK/server.key" 2>/dev/null || true
  OLD_END="$(openssl x509 -in certs/server.crt -noout -enddate 2>/dev/null | cut -d= -f2)"
  ok "旧证书已备份到 $BAK（旧证书到期：$(date -d "$OLD_END" '+%Y-%m-%d' 2>/dev/null || echo "$OLD_END")）"
else
  ok "以前没有装过证书（$BAK 只备份了配置）"
fi
restore() {
  if [ -f "$BAK/server.crt" ]; then cat "$BAK/server.crt" > certs/server.crt; fi
  if [ -f "$BAK/server.key" ]; then cat "$BAK/server.key" > certs/server.key; fi
  cp -p "$BAK/env" .env 2>/dev/null || true
}

# ---------------------------------------------------------------------------
step "3. 换上新证书"
# ---------------------------------------------------------------------------
# 就地覆盖文件内容（不删、不挪 certs 目录：nginx 容器挂载的是这个目录本身）
sed 's/\r$//' "$CRT_PEM" > certs/server.crt
umask 077; sed 's/\r$//' "$KEY_SRC" > certs/server.key; chmod 600 certs/server.key; umask 022
chmod 644 certs/server.crt
ok "已写入 $OPS/certs/server.crt、server.key"

# ---------------------------------------------------------------------------
step "4. 让 nginx 用上新证书"
# ---------------------------------------------------------------------------
WEB_PORT="$(read_env WEB_PORT)"; WEB_PORT="${WEB_PORT:-8912}"
fingerprint() { openssl x509 -in "$1" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2; }
served() {  # 现在对外发出的证书指纹
  echo | timeout 10 openssl s_client -connect "127.0.0.1:$WEB_PORT" -servername "$DOMAIN" 2>/dev/null \
    | openssl x509 -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2
}
WANT="$(fingerprint certs/server.crt)"
web_running() { [ -n "$(docker compose ps -q web 2>/dev/null)" ] && docker compose ps web 2>/dev/null | grep -qiE 'up|running'; }

if [ "$(read_env NGINX_CONF)" != nginx-https.conf ] || [ "$(read_env WEB_INNER_PORT)" != 443 ]; then
  # 以前没开 HTTPS（或被改回了 HTTP）：打开它。http→https 跳转（COMPOSE_FILE）保持原样
  setenv NGINX_CONF nginx-https.conf
  setenv WEB_INNER_PORT 443
  ok "网站原来是 HTTP，现在切换成 HTTPS"
  docker compose up -d 2>&1 | sed -u 's/^/  /'
elif ! web_running; then
  warn "网页容器没在运行，启动它"
  docker compose up -d 2>&1 | sed -u 's/^/  /'
else
  if ! docker compose exec -T web nginx -t >"$TMP/nginx-t.log" 2>&1; then
    sed 's/^/    /' "$TMP/nginx-t.log"
    restore
    die "nginx 不接受新证书（上面是 nginx 的报错），已换回旧证书"
  fi
  ok "nginx 配置校验通过"
  docker compose exec -T web nginx -s reload >/dev/null 2>&1 && ok "nginx 已平滑重载（正在使用的人不会断线）"
fi

# ---------------------------------------------------------------------------
step "5. 确认对外发出的已经是新证书"
# ---------------------------------------------------------------------------
GOT=""
for i in $(seq 1 15); do GOT="$(served)"; [ "$GOT" = "$WANT" ] && break; sleep 2; done
if [ "$GOT" != "$WANT" ]; then
  warn "重载后连上去拿到的还不是新证书，重建网页容器再试一次（约 10 秒）"
  docker compose up -d --force-recreate web 2>&1 | sed -u 's/^/  /'
  for i in $(seq 1 30); do GOT="$(served)"; [ "$GOT" = "$WANT" ] && break; sleep 2; done
fi
if [ "$GOT" != "$WANT" ]; then
  echo
  echo "  ✗ 还是没能确认网站在用新证书（本机连 127.0.0.1:$WEB_PORT 拿到的指纹：${GOT:-连不上}）。"
  echo "    新证书已经放好、旧证书在 $BAK。请把上面全部输出截图发给 Claude。"
  echo "    想换回旧证书：cp $BAK/server.crt $BAK/server.key $OPS/certs/ && cd $OPS && docker compose up -d --force-recreate web"
  exit 1
fi
ok "网站已在使用新证书（本机 https 连接确认，指纹一致）"
curl -sk -o /dev/null -w '%{http_code}' --max-time 8 "https://127.0.0.1:$WEB_PORT/api/health" 2>/dev/null | grep -q 200 \
  && ok "后端正常（/api/health 200）" || warn "后端健康检查没有返回 200，请执行 bash manage.sh status 看一下"

# 记进后台「操作日志」（数据库升级过才有这些列；失败不影响换证书）
docker compose exec -T api node -e '
  const D = require("better-sqlite3"); const d = new D("/data/app.db");
  const has = d.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name = ?").get("audit_log", "module");
  const [crt, end, names] = process.argv.slice(1);
  if (has) d.prepare("INSERT INTO audit_log (user_id, action, detail, ip, created_at, module, op, target, summary, result) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("cert_update", crt, "manage.sh", new Date().toISOString(), "系统", "更换 HTTPS 证书", "HTTPS 证书",
      "在服务器上更换 HTTPS 证书，新证书包含 " + names + "，有效期至 " + end, "ok");
' "$(basename "$CRT_SRC")" "$(date -d @"$END" '+%Y-%m-%d')" "$(names_of "$CRT_PEM")" >/dev/null 2>&1 || true

echo
echo "==================================================================="
echo "  ✓ HTTPS 证书已更换：有效期至 $(date -d @"$END" '+%Y-%m-%d')（还剩 $LEFT 天）"
echo "==================================================================="
echo "  · 浏览器里把报错的页面关掉重新打开（或按 Ctrl+F5 / Cmd+Shift+R）即可正常访问"
echo "  · 手机上把巡检页面关掉重新打开"
echo "  · 旧证书备份在：$BAK"
echo "  · 随时查看证书还剩几天：bash $OPS/manage.sh status"
echo "  · 建议现在就在手机日历上设一个「到期前 15 天」的提醒；到时候下载新证书，上传后再执行一次本命令"
exit 0
