#!/usr/bin/env bash
# 在腾讯云服务器上安装 Docker（已装则跳过），并配置国内镜像加速
# 用法：bash install-docker.sh
set -euo pipefail

say()  { echo; echo "==== $* ===="; }
fail() { echo; echo "!! 出错：$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "请用 root 执行：sudo bash install-docker.sh"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  say "Docker 已安装，跳过安装步骤"
  docker --version; docker compose version
else
  say "第 1 步：安装 Docker"
  # 用国内源装，直连 download.docker.com 在国内经常超时
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y -qq curl ca-certificates
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q curl ca-certificates
  else
    yum install -y -q curl ca-certificates
  fi
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh \
    || fail "下载 Docker 安装脚本失败，请检查服务器能否访问外网"
  sh /tmp/get-docker.sh --mirror Aliyun || fail "Docker 安装失败"
  systemctl enable docker && systemctl start docker
fi

say "第 2 步：配置镜像加速（很关键）"
# 腾讯云机器拉 Docker Hub 常年超时/失败，必须走加速器。
# mirror.ccs.tencentyun.com 只能在腾讯云内网访问，正好是我们的场景；
# 后面两个是公共备用源，某一个挂了还有兜底。
mkdir -p /etc/docker
if [ -f /etc/docker/daemon.json ] && grep -q registry-mirrors /etc/docker/daemon.json; then
  echo "/etc/docker/daemon.json 已配置镜像加速，保持不动"
else
  [ -f /etc/docker/daemon.json ] && cp /etc/docker/daemon.json "/etc/docker/daemon.json.bak.$(date +%s)"
  cat > /etc/docker/daemon.json <<'JSON'
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com",
    "https://docker.m.daocloud.io",
    "https://dockerproxy.net"
  ],
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
JSON
  systemctl daemon-reload && systemctl restart docker
  echo "已写入镜像加速配置并重启 Docker"
fi

say "第 3 步：验证"
docker --version
docker compose version
docker info 2>/dev/null | grep -A3 "Registry Mirrors" || true
echo
echo "Docker 准备完成。下一步执行：bash deploy.sh"
