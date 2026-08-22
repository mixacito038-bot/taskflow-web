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
  docker compose up -d
  . ./.env
  echo "已切回 HTTP： http://<服务器IP>:${WEB_PORT:-8912}/"
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
  docker compose up -d
  echo "请检查证书文件是否是「Nginx 版」的 .crt / .key（不是 .pem/.jks）"
  exit 1
fi
