#!/usr/bin/env bash
# 勇虹医疗设备效益管理平台 · Docker 一键安装（TencentOS Server 4 / CentOS 系）
#
#   bash deploy/install-docker.sh          # 试用模式：http://<服务器IP>:8911 直接访问
#
# 做了什么：装 Docker（缺才装）→ 配国内镜像加速 → 构建镜像 → 起容器
# （restart=always，宕机/重启机器都会自动拉起）→ 打印账号密码。
# 构建产物 dist/ 已随包提供，构建镜像只需拉一个基础镜像，不需要 npm install。
set -euo pipefail

ROOT=/opt/yonghong
ENV_FILE="${ROOT}/yonghong.env"
CONTAINER=yonghong-platform
IMAGE=yonghong-platform:latest
PORT="${PORT:-8911}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "请用 root 执行（sudo bash deploy/install-docker.sh）"; exit 1; }
[ -d "${SRC_DIR}/dist" ] || { echo "缺少构建产物 dist/：请用完整交付包"; exit 1; }

echo "==> 1/5 检查 Docker"
if ! command -v docker >/dev/null 2>&1; then
  echo "    安装 Docker（腾讯云软件源）"
  dnf install -y dnf-utils
  # 优先腾讯云镜像源（国内快且稳），失败再退回官方源
  dnf config-manager --add-repo https://mirrors.cloud.tencent.com/docker-ce/linux/centos/docker-ce.repo 2>/dev/null || \
    dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
  sed -i 's|https://download.docker.com|https://mirrors.cloud.tencent.com/docker-ce|g' /etc/yum.repos.d/docker-ce.repo 2>/dev/null || true
  dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
if [ ! -f /etc/docker/daemon.json ]; then
  # 腾讯云 CVM 内网镜像加速：拉基础镜像不走公网
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'JSON'
{
  "registry-mirrors": ["https://mirror.ccs.tencentyun.com"],
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" }
}
JSON
fi
systemctl enable --now docker
systemctl restart docker
docker info >/dev/null || { echo "Docker 启动失败：systemctl status docker 查看"; exit 1; }
echo "    $(docker --version)"

echo "==> 2/5 生成配置 ${ENV_FILE}"
mkdir -p "${ROOT}/data"
if [ -f "${ENV_FILE}" ]; then
  echo "    已存在，保留原配置（要重置请先删除该文件）"
else
  admin_pass="$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)Aa1"
  cp "${SRC_DIR}/deploy/yonghong-platform.env.example" "${ENV_FILE}"
  sed -i "s|^BOOTSTRAP_ADMIN_PASSWORD=.*|BOOTSTRAP_ADMIN_PASSWORD=${admin_pass}|" "${ENV_FILE}"
  sed -i "s|^MFA_TOTP_ENCRYPTION_KEY=.*|MFA_TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32)|" "${ENV_FILE}"
  sed -i "s|^PORT=.*|PORT=${PORT}|" "${ENV_FILE}"
  # 容器内固定监听 0.0.0.0 与 /data，对外暴露由 -p 决定
  sed -i "s|^HOST=.*|HOST=0.0.0.0|" "${ENV_FILE}"
  sed -i "s|^DATA_DIR=.*|DATA_DIR=/data|" "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
fi

echo "==> 3/5 构建镜像 ${IMAGE}"
build_ok=0
if docker build -f "${SRC_DIR}/Dockerfile.tencent" -t "${IMAGE}" "${SRC_DIR}"; then
  build_ok=1
else
  echo "    Docker Hub 拉取失败，改用腾讯云基础镜像重试"
  docker build -f "${SRC_DIR}/Dockerfile.tencent" \
    --build-arg BASE_IMAGE=ccr.ccs.tencentyun.com/library/node:22-bookworm-slim \
    -t "${IMAGE}" "${SRC_DIR}" && build_ok=1
fi
[ "${build_ok}" = "1" ] || { echo "镜像构建失败：请检查网络后重跑"; exit 1; }

echo "==> 4/5 启动容器（restart=always，开机/宕机自动拉起）"
docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
docker run -d --name "${CONTAINER}" \
  --restart=always \
  -p "${PORT}:${PORT}" \
  --env-file "${ENV_FILE}" \
  -e "PORT=${PORT}" \
  -v "${ROOT}/data:/data" \
  "${IMAGE}" >/dev/null

echo "==> 5/5 自检"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[ "${ok}" = "1" ] || { echo "健康检查未通过：docker logs ${CONTAINER} 查看"; exit 1; }

ip="$(curl -fsS --max-time 2 http://metadata.tencentyun.com/latest/meta-data/public-ipv4 2>/dev/null || true)"
[ -z "${ip}" ] && ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "${ip}" ] && ip="<服务器IP>"

echo ""
echo "──────────────────────────────────────────────"
echo " 装好了。浏览器打开：  http://${ip}:${PORT}"
echo ""
echo " 打不开就是安全组没放行 ${PORT}："
echo "   腾讯云控制台 → 云服务器 → 安全组 → 入站规则 → 添加 TCP:${PORT}"
echo "   建议来源填你办公室的出口 IP，别填 0.0.0.0/0"
echo ""
echo " 管理员账号：$(grep -E '^BOOTSTRAP_ADMIN_USERNAME=' "${ENV_FILE}" | cut -d= -f2)"
echo " 初始密码：  $(grep -E '^BOOTSTRAP_ADMIN_PASSWORD=' "${ENV_FILE}" | cut -d= -f2)   ← 首次登录会要求改密"
echo " 入口口令：  $(grep -E '^DATA_WORKBENCH_ENTRY_PASSWORD=' "${ENV_FILE}" | cut -d= -f2)   ← 品牌区连击 3 次后输入"
echo ""
echo " 常用命令："
echo "   docker restart ${CONTAINER}          重启"
echo "   docker logs -f --tail=100 ${CONTAINER}   看日志"
echo "   bash ${ROOT}/src/deploy/reset-data.sh    清空数据重新试"
echo ""
echo " 数据在 /opt/yonghong/data，备份拷这个目录即可。"
echo " 提示：当前是明文 HTTP 试用模式；正式给医院用之前配 nginx + HTTPS。"
echo "──────────────────────────────────────────────"
