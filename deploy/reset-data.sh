#!/usr/bin/env bash
# 清空平台数据，回到"刚装好"的状态，方便反复试功能。
# 保留 /etc/yonghong-platform.env（账号密码、入口口令不变）。
#
#   bash deploy/reset-data.sh
set -euo pipefail

DATA_DIR=/opt/yonghong/data
SERVICE=yonghong-platform

[ "$(id -u)" -eq 0 ] || { echo "请用 root 执行"; exit 1; }

echo "将删除 ${DATA_DIR} 下的全部数据（数据库、上传文件、已发布版本、报告）。"
printf "确认请输入 yes："
read -r answer
[ "${answer}" = "yes" ] || { echo "已取消"; exit 0; }

# 两种部署方式都支持：Docker 容器优先，其次 systemd 服务
uses_docker=0
if command -v docker >/dev/null 2>&1 && docker inspect "${SERVICE}" >/dev/null 2>&1; then uses_docker=1; fi

if [ "${uses_docker}" = "1" ]; then docker stop "${SERVICE}" >/dev/null; else systemctl stop "${SERVICE}" 2>/dev/null || true; fi
# 只删数据内容，保留目录本身与属主，避免重启后权限不对
rm -rf "${DATA_DIR}"/platform.sqlite "${DATA_DIR}"/platform.sqlite-* "${DATA_DIR}"/r2
chown -R yonghong:yonghong "${DATA_DIR}" 2>/dev/null || true
if [ "${uses_docker}" = "1" ]; then docker start "${SERVICE}" >/dev/null; else systemctl start "${SERVICE}"; fi

echo "已重置。数据库迁移会在启动时自动重建，用原来的管理员账号密码登录即可。"
