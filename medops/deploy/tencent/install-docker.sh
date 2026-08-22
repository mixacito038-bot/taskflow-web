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

say "第 2 步：镜像加速"
# ⚠ 这台机器可能已经在跑别的业务容器（本脚本就遇到过与永洪 BI 共存的情况）。
# 改 /etc/docker/daemon.json 必须重启 Docker 守护进程，**会把别人的容器一起重启**。
# 所以规则是：Docker 本来就能正常拉镜像 → 一个字都不改；拉不动 → 明确告知影响再让用户决定。
NEED_MIRROR=0
if grep -q registry-mirrors /etc/docker/daemon.json 2>/dev/null; then
  echo "已配置镜像加速，保持不动"
else
  printf "正在测试能否拉取镜像（最多 60 秒）…"
  if timeout 60 docker pull nginx:1.27-alpine >/dev/null 2>&1; then
    echo " 可以，无需配置加速，不动现有 Docker 配置"
  else
    echo " 拉不动"
    NEED_MIRROR=1
  fi
fi

if [ "$NEED_MIRROR" = 1 ]; then
  RUNNING=$(docker ps -q 2>/dev/null | wc -l | tr -d ' ')
  echo
  echo "需要配置国内镜像加速，否则后面构建会卡在拉镜像。"
  echo "但这一步要重启 Docker 守护进程——"
  if [ "${RUNNING}" -gt 0 ]; then
    echo "  ⚠ 检测到本机当前有 ${RUNNING} 个容器在运行，重启 Docker 会让它们一起重启（通常几十秒内自行恢复）："
    docker ps --format '      - {{.Names}}  ({{.Image}})' 2>/dev/null
    echo
    echo "  如果这些是业务容器，建议改在业务低峰期做，或先问过对应负责人。"
  else
    echo "  当前没有其它容器在运行，重启没有影响。"
  fi
  echo
  printf "确认现在配置并重启 Docker 吗？输入 yes 继续，直接回车跳过：" 
  read -r ANS
  if [ "${ANS}" = yes ]; then
    mkdir -p /etc/docker
    [ -f /etc/docker/daemon.json ] && cp /etc/docker/daemon.json "/etc/docker/daemon.json.bak.$(date +%s)" && echo "  原配置已备份"
    # 合并而不是覆盖：机器上可能已有 data-root、insecure-registries 等别的业务在用的配置
    if [ -s /etc/docker/daemon.json ] && command -v python3 >/dev/null 2>&1; then
      python3 - <<'PYEOF'
import json
p='/etc/docker/daemon.json'
try:
    cfg=json.load(open(p))
except Exception:
    cfg={}
cfg.setdefault('registry-mirrors', ["https://mirror.ccs.tencentyun.com","https://docker.m.daocloud.io"])
cfg.setdefault('log-driver','json-file')
cfg.setdefault('log-opts',{"max-size":"10m","max-file":"5"})
json.dump(cfg, open(p,'w'), indent=2, ensure_ascii=False)
print('  已把镜像加速合并进原有配置（其余设置保持不变）')
PYEOF
    else
      cat > /etc/docker/daemon.json <<'JSON'
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com",
    "https://docker.m.daocloud.io"
  ],
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
JSON
      echo "  已写入镜像加速配置"
    fi
    systemctl daemon-reload && systemctl restart docker
    echo "  Docker 已重启"
  else
    echo "  已跳过。若后续构建卡在拉镜像，回来重跑本脚本并选 yes。"
  fi
fi

say "第 3 步：验证"
docker --version
docker compose version
docker info 2>/dev/null | grep -A3 "Registry Mirrors" || true
echo
echo "Docker 准备完成。下一步执行：bash deploy.sh"
