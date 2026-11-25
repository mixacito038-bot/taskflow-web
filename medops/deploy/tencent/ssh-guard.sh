#!/usr/bin/env bash
# 服务器 SSH 防暴力破解。只管「SSH 登录」这一件事：不碰 Docker、不碰网站、不碰这台机器上别人的服务。
#
#   bash ssh-guard.sh                 看现状（只读）：被猜了多少次、哪些 IP 在猜、最近谁登录成功、防护开了没有
#   bash ssh-guard.sh protect [IP…]   第一步（推荐，马上做）：开启自动封禁 + 收紧登录限制。
#                                     不改登录方式，你现在怎么登录还怎么登录。后面可写医院的固定 IP，永不封禁
#   bash ssh-guard.sh key-only        第二步（彻底）：只允许「密钥」登录、关掉密码登录——密码再也猜不了。
#                                     必须先配好密钥、并且用密钥登录进来再执行（脚本会检查，不满足不改）
#   bash ssh-guard.sh password-on     撤销第二步，恢复密码登录
#   bash ssh-guard.sh unban [IP]      解封（自己输错密码被封时用；不写 IP = 全部解封）
#   bash ssh-guard.sh undo            撤销本脚本做的全部改动
#
# 每次改动前都备份到 /root/medops-ssh-backup-<时间>/；改完先用 sshd -t 检查，不通过自动恢复，绝不会把 sshd 改坏。
# 重新加载 sshd 不会断开已经登录的窗口。万一真的登不上：腾讯云控制台 → 实例 → 登录 →「VNC 登录」，
# 用 root 密码进去执行 bash /root/medops-ssh-guard.sh undo（VNC 不走 SSH，不受这里任何设置影响）。
set -u
export LC_ALL=C.UTF-8 2>/dev/null || true

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
SSHD_CONFIG=/etc/ssh/sshd_config
CONF_D=/etc/ssh/sshd_config.d
GUARD="${CONF_D}/01-medops-guard.conf"        # 第一步：登录限制、内置封禁
KEYONLY="${CONF_D}/00-medops-keyonly.conf"    # 第二步：只许密钥（排在最前，压过 50-cloud-init 等里的 PasswordAuthentication yes）
F2B_JAIL=/etc/fail2ban/jail.d/medops-sshd.local
RL_UNIT=/etc/systemd/system/medops-ssh-ratelimit.service
RL_SCRIPT=/usr/local/sbin/medops-ssh-ratelimit.sh
SECURE_LOG=/var/log/secure; [ -f "$SECURE_LOG" ] || SECURE_LOG=/var/log/auth.log
MYIP=$(echo "${SSH_CONNECTION:-}" | awk '{print $1}')
MYPORT=$(echo "${SSH_CONNECTION:-}" | awk '{print $2}')

say()  { echo; echo "==== $* ===="; }
ok()   { echo "  ✓ $*"; }
warn() { echo "  ! $*"; }
die()  { echo "  ✗ $*"; exit 1; }
has()  { command -v "$1" >/dev/null 2>&1; }
systemd_up() { [ -d /run/systemd/system ] && has systemctl; }
need_root() { [ "$(id -u)" = 0 ] || die "请用 root 执行"; }

# ---------------------------------------------------------------- sshd 相关
sshd_bin() { command -v sshd || echo /usr/sbin/sshd; }
eff() { "$(sshd_bin)" -T 2>/dev/null | awk -v k="$1" 'tolower($1)==k{ $1=""; sub(/^ /,""); print; exit }'; }
ssh_port() { local p; p=$(eff port); echo "${p:-22}"; }
sshd_service() {
  if systemd_up; then
    for s in sshd ssh; do systemctl list-unit-files "${s}.service" 2>/dev/null | grep -q "^${s}.service" && { echo "$s"; return; }; done
  fi
  echo sshd
}
reload_sshd() {
  # reload：已经登录的窗口不会断
  if systemd_up; then systemctl reload "$(sshd_service)" 2>/dev/null && return 0; fi
  local pid; pid=$(cat /run/sshd.pid /var/run/sshd.pid 2>/dev/null | head -1)
  [ -n "$pid" ] && kill -HUP "$pid" 2>/dev/null && return 0
  return 1
}
backup() {
  # 每次一个新目录（同一秒内连着执行两次也不会混在一起）
  BK=$(mktemp -d "/root/medops-ssh-backup-$(date +%Y%m%d-%H%M%S)-XXXX")
  cp -a "$SSHD_CONFIG" "$BK/" 2>/dev/null
  mkdir -p "$BK/$(basename "$CONF_D")"
  [ -d "$CONF_D" ] && cp -a "$CONF_D/." "$BK/$(basename "$CONF_D")/" 2>/dev/null
  [ -f "$F2B_JAIL" ] && cp -a "$F2B_JAIL" "$BK/" 2>/dev/null
  echo "  （改动前的配置已备份到 $BK）"
}
restore() {
  echo "  正在恢复改动前的配置……"
  cp -a "$BK/$(basename "$SSHD_CONFIG")" "$SSHD_CONFIG" 2>/dev/null
  if [ -d "$BK/$(basename "$CONF_D")" ]; then rm -f "$GUARD" "$KEYONLY"; cp -a "$BK/$(basename "$CONF_D")/." "$CONF_D/" 2>/dev/null; fi
  "$(sshd_bin)" -t 2>/dev/null && reload_sshd >/dev/null 2>&1
  echo "  已恢复，SSH 和原来一样"
}
# 主配置里没有 Include sshd_config.d 时补上（放在第一行：sshd 取「第一次出现」的值，这样我们的设置才生效）
ensure_include() {
  mkdir -p "$CONF_D"
  if ! grep -qiE '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/\*\.conf' "$SSHD_CONFIG"; then
    sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' "$SSHD_CONFIG"
    ok "主配置里加上了 Include /etc/ssh/sshd_config.d/*.conf"
  fi
}
sshd_supports() { "$(sshd_bin)" -t -o "$1" >/dev/null 2>&1; }
apply_or_restore() {
  local err
  if ! err=$("$(sshd_bin)" -t 2>&1); then echo "  ✗ sshd 配置检查没通过：$err"; restore; exit 1; fi
  if ! reload_sshd; then echo "  ✗ sshd 重新加载失败"; restore; exit 1; fi
  command -v restorecon >/dev/null 2>&1 && restorecon -R "$CONF_D" >/dev/null 2>&1
  return 0
}

# ---------------------------------------------------------------- 日志
fail_lines() {
  if [ -f "$SECURE_LOG" ]; then grep -aE 'Failed password|Invalid user|authentication failure|Connection closed by authenticating user|Disconnected from authenticating user' "$SECURE_LOG" 2>/dev/null
  elif has journalctl; then journalctl -u "$(sshd_service)" --since "7 days ago" --no-pager 2>/dev/null | grep -aE 'Failed password|Invalid user|authentication failure'
  fi
}
accepted_lines() {
  if [ -f "$SECURE_LOG" ]; then grep -a 'Accepted ' "$SECURE_LOG" 2>/dev/null
  elif has journalctl; then journalctl -u "$(sshd_service)" --since "30 days ago" --no-pager 2>/dev/null | grep -a 'Accepted '
  fi
}
ip_of() { grep -oE 'from [0-9a-fA-F:.]+' | awk '{print $2}'; }

# ---------------------------------------------------------------- fail2ban / 限速
f2b_on() { has fail2ban-client && fail2ban-client status sshd >/dev/null 2>&1; }
rl_on() { has iptables && iptables -C INPUT -p tcp --dport "$(ssh_port)" -m conntrack --ctstate NEW -m recent --name MEDOPS_SSH --update --seconds 60 --hitcount 6 -j DROP 2>/dev/null; }

status() {
  echo "SSH 登录防护 · 现状（只读）    $(date '+%Y-%m-%d %H:%M:%S')"
  say "SSH 服务"
  echo "  版本：$( (ssh -V 2>&1 || "$(sshd_bin)" -V 2>&1) | grep -o 'OpenSSH_[^ ,]*' | head -1)    端口：$(ssh_port)"
  echo "  密码登录：$(eff passwordauthentication)    密钥登录：$(eff pubkeyauthentication)    root 登录：$(eff permitrootlogin)    每次连接最多试：$(eff maxauthtries) 次"
  local keys; keys=$(grep -cE '^(ssh-|ecdsa-|sk-)' /root/.ssh/authorized_keys 2>/dev/null); keys=${keys:-0}
  echo "  root 已登记的密钥：${keys} 把"
  [ -n "$MYIP" ] && echo "  你这次是从 ${MYIP} 登录的"

  say "被猜密码的情况"
  local all today
  all=$(fail_lines | wc -l)
  today=$(fail_lines | grep -cE "^($(date '+%b %e')|$(date '+%Y-%m-%d'))" )   # 传统 syslog 格式（腾讯云）或 ISO 格式
  echo "  日志里共 ${all} 条失败记录，今天 ${today} 条（日志：${SECURE_LOG}）"
  echo "  猜得最多的 IP（前 8 个）："
  fail_lines | ip_of | sort | uniq -c | sort -rn | head -8 | awk '{printf "    %-40s %s 次\n", $2, $1}'

  say "最近登录成功的记录（请确认都是你们自己）"
  accepted_lines | tail -8 | sed -E 's/.*(Accepted [a-z-]+) for ([^ ]+) from ([^ ]+) port.*/\1  \2  \3/; s/^/    /' | \
    sed 's/Accepted password/用密码登录/; s/Accepted publickey/用密钥登录/; s/Accepted keyboard-interactive\/pam/用密码登录/'
  has last && { echo "  （系统登录记录）"; last -i -n 6 2>/dev/null | grep -v '^$' | grep -v '^wtmp' | sed 's/^/    /'; }

  say "防护"
  [ -f "$GUARD" ] && ok "登录限制已开（每次连接最多试 $(eff maxauthtries) 次，30 秒内要登完）" || warn "登录限制没开（执行 bash $SELF protect）"
  if [ -n "$(eff persourcepenalties)" ] && [ -f "$GUARD" ] && grep -q PerSourcePenalties "$GUARD"; then ok "SSH 内置封禁已开（同一 IP 反复输错，越错封得越久，最长 1 天）"; fi
  if f2b_on; then
    ok "自动封禁（fail2ban）运行中：现在封着 $(fail2ban-client status sshd 2>/dev/null | awk -F: '/Currently banned/{gsub(/[ \t]/,"",$2);print $2}') 个 IP，累计封过 $(fail2ban-client status sshd 2>/dev/null | awk -F: '/Total banned/{gsub(/[ \t]/,"",$2);print $2}') 个"
  elif rl_on; then ok "限速已开（同一 IP 1 分钟内最多连 5 次，超了直接丢弃）"
  else warn "没有自动封禁"; fi
  if [ "$(eff passwordauthentication)" = no ]; then ok "只允许密钥登录：密码猜不了（彻底）"
  else warn "还允许密码登录：只要密码够复杂就进不来，但会一直被猜（彻底的办法：bash $SELF key-only）"; fi
}

protect() {
  need_root
  echo "SSH 登录防护 · 第一步：自动封禁 + 登录限制（不改登录方式）"
  backup
  ensure_include
  local white="127.0.0.1 ::1"
  [ -n "$MYIP" ] && white="$white $MYIP"
  for ip in "$@"; do
    echo "$ip" | grep -qE '^[0-9a-fA-F:.]+(/[0-9]+)?$' && white="$white $ip" || warn "「$ip」不是 IP 地址，忽略"
  done
  white=$(echo "$white" | tr ' ' '\n' | awk 'NF && !seen[$0]++' | tr '\n' ' ' | sed 's/ $//')

  say "1. 收紧 sshd 登录限制"
  {
    echo "# 由 medops-ssh-guard.sh 生成（$(date '+%Y-%m-%d %H:%M')）。撤销：bash /root/medops-ssh-guard.sh undo（或 manage.sh ssh-guard undo）"
    # 注释单独成行：旧版 OpenSSH 不认行尾注释
    echo "# 一次连接最多试 4 次（默认 6）"
    echo "MaxAuthTries 4"
    echo "# 30 秒内没登录完就断开（默认 120）"
    echo "LoginGraceTime 30"
    echo "# 同时在登录的连接多了就开始拒绝（防大量连接拖垮 sshd）"
    echo "MaxStartups 10:30:60"
    echo "PermitEmptyPasswords no"
  } > "$GUARD"
  chmod 600 "$GUARD"
  # OpenSSH 9.8 起自带「同一 IP 反复失败就拒绝」：每失败一次封 60 秒，叠加，最长 1 天
  if sshd_supports "PerSourcePenalties=authfail:60 max:86400"; then
    { echo "PerSourcePenalties authfail:60 noauth:10 grace-exceeded:60 max:86400"
      echo "PerSourcePenaltyExemptList $(echo "$white" | tr ' ' ',')"; } >> "$GUARD"
    PEN=1
  else PEN=0; fi
  apply_or_restore
  ok "登录限制已生效：每次连接最多试 4 次、30 秒内登完"
  [ "$PEN" = 1 ] && ok "SSH 内置封禁已开（这台机器的 OpenSSH 支持）" || echo "  （这台机器的 OpenSSH 版本没有内置封禁，下面用 fail2ban）"

  say "2. 自动封禁：同一 IP 10 分钟内输错 5 次 → 封 1 天（只封 SSH 端口，网站照常访问）"
  echo "  永不封禁（白名单）：${white}"
  local f2b=0
  if ! has fail2ban-client; then
    echo "  安装 fail2ban……"
    if has dnf; then dnf -y -q install fail2ban-server >/dev/null 2>&1 || dnf -y -q install fail2ban >/dev/null 2>&1
    elif has yum; then yum -y -q install fail2ban-server >/dev/null 2>&1 || yum -y -q install fail2ban >/dev/null 2>&1
    elif has apt-get; then DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fail2ban >/dev/null 2>&1; fi
  fi
  if has fail2ban-client; then
    local action backend logline
    if systemd_up && systemctl is-active --quiet firewalld 2>/dev/null; then action=firewallcmd-rich-rules
    elif has iptables; then action=iptables-multiport
    else action=nftables-multiport; fi
    if [ -f "$SECURE_LOG" ]; then backend=auto; logline="logpath = ${SECURE_LOG}"; else backend=systemd; logline=""; fi
    mkdir -p /etc/fail2ban/jail.d
    cat > "$F2B_JAIL" <<EOF
# 由 medops-ssh-guard.sh 生成。撤销：bash /root/medops-ssh-guard.sh undo（或 manage.sh ssh-guard undo）
[DEFAULT]
ignoreip = ${white}
banaction = ${action}
banaction_allports = ${action/multiport/allports}

[sshd]
enabled  = true
port     = $(ssh_port)
backend  = ${backend}
${logline}
maxretry = 5
findtime = 600
bantime  = 86400
EOF
    # 一天里被封过 3 次的再封一周（recidive）：它读 fail2ban 自己的日志文件。
    # backend、logpath 都要写明——有的系统默认 backend=systemd，缺 python 模块时连 sshd 的封禁也一起起不来
    local f2blog; f2blog=$(fail2ban-client -d 2>/dev/null | grep -o "'logtarget', '[^']*'" | head -1 | cut -d"'" -f4)
    if [ -n "$f2blog" ] && [ "${f2blog#/}" != "$f2blog" ]; then
      printf '\n# 一天里被封过 3 次的：再封一周\n[recidive]\nenabled  = true\nbackend  = auto\nlogpath  = %s\nbantime  = 604800\nfindtime = 86400\nmaxretry = 3\n' "$f2blog" >> "$F2B_JAIL"
    fi
    local logsz=0; [ -n "$f2blog" ] && [ -f "$f2blog" ] && logsz=$(stat -c %s "$f2blog")
    if systemd_up; then
      systemctl enable fail2ban >/dev/null 2>&1
      systemctl restart fail2ban >/dev/null 2>&1
    else
      fail2ban-client stop >/dev/null 2>&1; sleep 1
      fail2ban-client -x start >/dev/null 2>&1
    fi
    # 光看 status 不够：jail 加上了但没启动时 status 照样有输出。到 fail2ban 自己的日志里确认「Jail 'sshd' started」
    local started=0 newlog=""
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
      sleep 1
      if [ -n "$f2blog" ] && [ -f "$f2blog" ]; then
        newlog=$(tail -c +"$((logsz + 1))" "$f2blog" 2>/dev/null)
        echo "$newlog" | grep -q "Jail 'sshd' started" && { started=1; break; }
        echo "$newlog" | grep -qE "has failed|Failed to initialize" && break
      elif f2b_on; then started=1; break; fi
    done
    if [ "$started" = 1 ] && f2b_on; then
      f2b=1; ok "fail2ban 已运行（封禁方式：${action}），开机自动启动"
    else
      warn "fail2ban 没启动成功，已撤掉它的配置（不影响 SSH）"
      echo "$newlog" | grep ERROR | tail -2 | cut -c1-200 | sed 's/^/    /'
      rm -f "$F2B_JAIL"
      if systemd_up; then systemctl restart fail2ban >/dev/null 2>&1; fi
    fi
  else
    warn "这台机器装不上 fail2ban（软件源里没有）"
  fi

  if [ "$f2b" = 0 ] && [ "$PEN" = 0 ]; then
    # 都没有：用系统自带的防火墙限速兜底。只在 INPUT 链加针对 SSH 端口的两条规则，不动 Docker 的规则
    if has iptables && ! { systemd_up && systemctl is-active --quiet firewalld 2>/dev/null; }; then
      local port; port=$(ssh_port)
      cat > "$RL_SCRIPT" <<EOF
#!/usr/bin/env bash
# medops-ssh-guard：SSH 端口限速（同一 IP 60 秒内新连接超过 5 次就丢弃）。白名单：${white}
P=${port}
del() { while iptables -D INPUT "\$@" 2>/dev/null; do :; done; }
R1=(-p tcp --dport \$P -m conntrack --ctstate NEW -m recent --name MEDOPS_SSH --update --seconds 60 --hitcount 6 -j DROP)
R2=(-p tcp --dport \$P -m conntrack --ctstate NEW -m recent --name MEDOPS_SSH --set)
case "\${1:-apply}" in
  apply) del "\${R1[@]}"; del "\${R2[@]}"; iptables -I INPUT 1 "\${R1[@]}" && iptables -I INPUT 1 "\${R2[@]}"
         for ip in ${white}; do case "\$ip" in *:*) ;; *) del -p tcp --dport \$P -s "\$ip" -j ACCEPT; iptables -I INPUT 1 -p tcp --dport \$P -s "\$ip" -j ACCEPT;; esac; done ;;
  remove) del "\${R1[@]}"; del "\${R2[@]}"; for ip in ${white}; do case "\$ip" in *:*) ;; *) del -p tcp --dport \$P -s "\$ip" -j ACCEPT;; esac; done ;;
esac
EOF
      chmod 700 "$RL_SCRIPT"
      if bash "$RL_SCRIPT" apply && rl_on; then
        if systemd_up; then
          cat > "$RL_UNIT" <<EOF
[Unit]
Description=medops-ssh-guard: SSH 端口限速
After=network-online.target docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$RL_SCRIPT apply
ExecStop=$RL_SCRIPT remove

[Install]
WantedBy=multi-user.target
EOF
          systemctl daemon-reload >/dev/null 2>&1; systemctl enable medops-ssh-ratelimit >/dev/null 2>&1
        fi
        ok "已用防火墙限速兜底：同一 IP 1 分钟内最多连 5 次（重启后自动恢复）"
      else
        bash "$RL_SCRIPT" remove >/dev/null 2>&1; rm -f "$RL_SCRIPT"
        warn "防火墙限速没加上"
      fi
    else
      warn "没有可用的自动封禁手段：请务必用足够复杂的 root 密码，并尽快做第二步（只允许密钥登录）"
    fi
  fi

  say "完成"
  echo "  你现在的登录方式不变。已经登录的窗口不受影响。"
  echo "  自己输错密码被封了：换个网络（比如手机热点）登录后执行 bash $SELF unban，或等 1 天自动解封；"
  echo "  实在登不上：腾讯云控制台 → 实例 → 登录 →「VNC 登录」，执行 bash $SELF undo。"
  echo "  看效果：过几个小时执行 bash $SELF   （会显示封了多少个 IP）"
  echo "  要彻底杜绝被猜密码：配好密钥后执行 bash $SELF key-only"
}

session_used_key() {
  [ -n "$MYIP" ] && [ -n "$MYPORT" ] || return 1
  accepted_lines | grep -q "Accepted publickey for root from ${MYIP} port ${MYPORT}\b"
}

key_only() {
  need_root
  echo "SSH 登录防护 · 第二步：只允许密钥登录（关掉密码登录）"
  local keys; keys=$(grep -cE '^(ssh-|ecdsa-|sk-)' /root/.ssh/authorized_keys 2>/dev/null); keys=${keys:-0}
  [ "$keys" -gt 0 ] || die "root 还没有登记任何密钥（/root/.ssh/authorized_keys 为空）。先按说明在自己电脑上生成密钥、传上来，再用密钥登录后执行这一步"
  if ! session_used_key; then
    echo "  ✗ 你这次不是用密钥登录进来的（或者查不到登录方式）。"
    echo "    为了不把自己锁在外面，必须先确认密钥能用：关掉这个窗口，用密钥重新登录（不输密码就进来了），再执行这一步。"
    exit 1
  fi
  ok "root 已登记 ${keys} 把密钥；你这次就是用密钥登录的（${MYIP}）"
  echo
  echo "  ⚠ 改完以后，所有人都不能再用密码 SSH 登录这台服务器（包括 FinalShell 里存的密码），"
  echo "    这台机器上其他系统的维护人员如果也用密码登录，请先通知他们改用密钥。"
  echo "    网站、手机端、管理后台不受任何影响；腾讯云控制台的「VNC 登录」仍可用密码登录（应急用）。"
  printf "  确认关闭密码登录？输入 yes 回车："
  local ans; if [ "${MEDOPS_SSH_YES:-}" = 1 ]; then ans=yes; else read -r ans </dev/tty 2>/dev/null || ans=""; fi
  [ "$ans" = yes ] || die "没有输入 yes，什么都没改"
  backup
  ensure_include
  local kbd=KbdInteractiveAuthentication
  sshd_supports "KbdInteractiveAuthentication=no" || kbd=ChallengeResponseAuthentication
  cat > "$KEYONLY" <<EOF
# 由 medops-ssh-guard.sh 生成（$(date '+%Y-%m-%d %H:%M')）：只允许密钥登录。恢复密码登录：bash /root/medops-ssh-guard.sh password-on（或 manage.sh ssh-guard password-on）
PasswordAuthentication no
${kbd} no
PubkeyAuthentication yes
PermitRootLogin prohibit-password
EOF
  chmod 600 "$KEYONLY"
  apply_or_restore
  if [ "$(eff passwordauthentication)" != no ]; then
    echo "  ✗ 改完检查发现密码登录仍然开着（有别的配置压过了），已恢复原样，请把这段输出发给技术支持"
    restore; exit 1
  fi
  if [ "$(eff pubkeyauthentication)" = no ]; then echo "  ✗ 密钥登录被关着，已恢复原样"; restore; exit 1; fi
  # 本机自测：服务器现在只接受密钥（127.0.0.1 在白名单里，不会被封）
  if has ssh; then
    local out; out=$(ssh -o BatchMode=yes -o PreferredAuthentications=none -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
      -o ConnectTimeout=5 -p "$(ssh_port)" root@127.0.0.1 true 2>&1)
    if echo "$out" | grep -q 'publickey' && ! echo "$out" | grep -q 'password'; then ok "本机自测：服务器现在只接受密钥"
    else warn "本机自测结果：${out}"; fi
  fi
  say "完成：密码再也猜不了"
  echo "  ⚠ 先别关这个窗口！新开一个窗口用密钥登录试试："
  echo "    能登上 → 一切正常，可以关掉旧窗口；"
  echo "    登不上 → 回到这个窗口执行 bash $SELF password-on 恢复密码登录，再联系技术支持。"
}

password_on() {
  need_root
  [ -f "$KEYONLY" ] || { ok "本来就允许密码登录（没有找到第二步的配置）"; return; }
  backup
  rm -f "$KEYONLY"
  apply_or_restore
  ok "已恢复密码登录（当前：PasswordAuthentication $(eff passwordauthentication)）"
}

unban() {
  need_root
  if f2b_on; then
    if [ -n "${1:-}" ]; then fail2ban-client unban "$1" >/dev/null 2>&1 && ok "已解封 $1"
    else fail2ban-client unban --all >/dev/null 2>&1 && ok "已解封全部 IP"; fi
  fi
  [ -w /proc/net/xt_recent/MEDOPS_SSH ] && { if [ -n "${1:-}" ]; then echo "-$1" > /proc/net/xt_recent/MEDOPS_SSH; else echo / > /proc/net/xt_recent/MEDOPS_SSH; fi; ok "限速记录已清空"; }
  echo "  （SSH 内置封禁会在 1 分钟～1 天内自动解除；白名单里的 IP 永不封禁）"
}

undo() {
  need_root
  echo "撤销 medops-ssh-guard 做的全部改动"
  backup
  rm -f "$GUARD" "$KEYONLY"
  apply_or_restore
  ok "sshd 恢复原来的设置（密码登录：$(eff passwordauthentication)）"
  if [ -f "$F2B_JAIL" ]; then
    rm -f "$F2B_JAIL"
    if systemd_up; then systemctl restart fail2ban >/dev/null 2>&1; else fail2ban-client reload >/dev/null 2>&1; fi
    ok "fail2ban 的 SSH 封禁已关（fail2ban 软件本身保留，不影响别的）"
  fi
  if [ -f "$RL_SCRIPT" ]; then
    bash "$RL_SCRIPT" remove >/dev/null 2>&1
    if systemd_up && [ -f "$RL_UNIT" ]; then systemctl disable medops-ssh-ratelimit >/dev/null 2>&1; rm -f "$RL_UNIT"; systemctl daemon-reload >/dev/null 2>&1; fi
    rm -f "$RL_SCRIPT"
    ok "防火墙限速已移除"
  fi
}

case "${1:-status}" in
  status|看|"") status ;;
  protect)      shift; protect "$@" ;;
  key-only)     key_only ;;
  password-on)  password_on ;;
  unban)        shift; unban "${1:-}" ;;
  undo)         undo ;;
  *) sed -n '2,16p' "$SELF" | sed 's/^# \{0,1\}//' ;;
esac
