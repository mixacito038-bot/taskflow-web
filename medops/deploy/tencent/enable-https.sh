#!/usr/bin/env bash
# 给站点加 HTTPS（用腾讯云免费证书，不需要额外开 80 端口）
#
# 前提：① 有域名并已备案 ② 域名解析到本服务器 ③ 已在腾讯云申请免费证书并下载「Nginx」版
# 用法：bash enable-https.sh /root/cert/xxx.crt /root/cert/xxx.key
# 想改回 HTTP：bash enable-https.sh --off
#
# 本脚本只改 .env 里的两个开关 + 拷证书，**不修改 nginx 配置文件本身**，
# 所以反复执行是安全的（早期版本用 sed 改配置，跑两次会产生重复指令导致 nginx 起不来）。
set -euo pipefail
cd "$(dirname "$0")"

setenv() {  # setenv KEY VALUE —— 有则改、无则加
  if grep -q "^$1=" .env; then sed -i "s#^$1=.*#$1=$2#" .env; else echo "$1=$2" >> .env; fi
}

if [ "${1:-}" = "--off" ]; then
  setenv NGINX_CONF nginx.conf
  setenv WEB_INNER_PORT 80
  setenv COMPOSE_FILE docker-compose.yml     # 摘掉 80 跳转层，否则会和主端口抢 80
  docker compose up -d
  . ./.env
  echo
  echo "已切回 HTTP。"
  if [ "${WEB_PORT:-8912}" = 443 ]; then
    # 443 是给 https 用的，切回 http 后还留在 443 上会让人困惑（而且很多浏览器会试着用 https 打开）
    echo "  ⚠ 当前对外端口还是 443，建议一并换回来："
    echo "      bash manage.sh 改端口 8912"
  else
    echo "  访问地址：http://<服务器IP>:${WEB_PORT:-8912}/"
  fi
  exit 0
fi

CRT="${1:-}"; KEY="${2:-}"
[ -f "${CRT:-}" ] && [ -f "${KEY:-}" ] || {
  echo "用法：bash enable-https.sh /root/cert/xxx.crt /root/cert/xxx.key"
  echo "      bash enable-https.sh --off      # 改回 HTTP"
  exit 1; }
[ -f .env ] || { echo "请先执行 bash deploy.sh"; exit 1; }

install -m 644 "${CRT}" certs/server.crt
install -m 600 "${KEY}" certs/server.key

setenv NGINX_CONF nginx-https.conf
setenv WEB_INNER_PORT 443

# ---- 可选：80 端口做 http→https 跳转 ----
# 不开的话，用户在浏览器里直接敲域名（不写 https://）会显示「无法访问此网站」，
# 多半会以为系统坏了。开了就自动跳到 https。
port_used() {
  if command -v ss >/dev/null 2>&1; then
    ss -lnt 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$" && return 0
  elif command -v netstat >/dev/null 2>&1; then
    netstat -lnt 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$" && return 0
  fi
  (exec 3<>/dev/tcp/127.0.0.1/"$1") 2>/dev/null && { exec 3<&- 3>&-; return 0; }
  return 1
}
if port_used 80; then
  echo
  echo "  ! 宿主机 80 端口已被别的程序占用，跳过 http→https 跳转的配置。"
  echo "    影响：用户直接敲域名（不写 https://）时打不开，必须完整输入 https:// 或扫二维码。"
  setenv COMPOSE_FILE docker-compose.yml
else
  echo
  echo "  检测到 80 端口空闲。是否顺便配上 http→https 自动跳转？"
  echo "  配上以后，用户在浏览器直接敲域名也能进（会自动跳到 https）。"
  echo "  需要腾讯云安全组同时放行 80 端口。"
  printf "  配置吗？输入 yes 启用，直接回车跳过："
  read -r R80
  if [ "${R80}" = yes ]; then
    setenv COMPOSE_FILE docker-compose.yml:docker-compose.redirect80.yml
    echo "  已启用（记得安全组放行 80）"
  else
    setenv COMPOSE_FILE docker-compose.yml
    echo "  已跳过"
  fi
fi

. ./.env

docker compose up -d
sleep 3
if docker compose exec -T web nginx -t >/dev/null 2>&1; then
  echo
  echo "HTTPS 已启用： https://<你的域名>:${WEB_PORT:-8912}/"
  echo
  echo "想去掉地址里的端口号（变成 https://你的域名/）："
  echo "  bash manage.sh 改端口 443     然后在腾讯云安全组放行 443"
  echo
  echo "⚠ 腾讯云免费证书 90 天到期。到期前重新申请、下载，再跑一次本脚本即可。"
  echo "  建议现在就在手机日历上设一个提前 10 天的提醒。"
else
  echo "!! nginx 配置校验失败，已自动回滚到 HTTP"
  setenv NGINX_CONF nginx.conf
  setenv WEB_INNER_PORT 80
  setenv COMPOSE_FILE docker-compose.yml
  docker compose up -d
  echo "请检查证书文件是否是「Nginx 版」的 .crt / .key（不是 .pem/.jks）"
  exit 1
fi
