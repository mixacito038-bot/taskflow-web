#!/usr/bin/env bash
# 生成「一键升级包」：一个自带代码的 .sh 文件。上传到服务器后执行一次即可完成升级
# （备份 → 替换 → 重建 → 健康检查/失败自动回退 → 签字数据体检），见 install.sh.in。
#
# 用法（在仓库任意目录）：
#   bash medops/deploy/release/build-release.sh [输出目录] [额外路径...]
#     输出目录默认 medops/deploy/release/out/
#     额外路径：相对 medops/ 的路径。默认只带「程序」（后端、手机端、管理后台、manage.sh），
#     不带 nginx 配置、docker-compose、资产盘点 —— 这些在服务器上可能被改过，
#     确实要一起更新时才把路径加在后面，例如：deploy/tencent/docker-compose.yml
#
# 只打包「已提交」的代码：medops/ 下有未提交的改动会拒绝打包，保证升级包和仓库一致。
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(git -C "$HERE" rev-parse --show-toplevel)
OUT=${1:-$HERE/out}
[ $# -gt 0 ] && shift
if [ -n "$(git -C "$ROOT" status --porcelain -- medops ':!medops/deploy/release/out')" ]; then
  echo "medops/ 下有未提交的改动，先提交再打包：" >&2
  git -C "$ROOT" status --short -- medops >&2
  exit 1
fi
VERSION=$(TZ=Asia/Shanghai date +%Y%m%d-%H%M)
COMMIT=$(git -C "$ROOT" rev-parse --short HEAD)
PATHS=(server/src server/scripts server/test server/package.json server/package-lock.json
       server/Dockerfile server/.dockerignore h5 admin/dist admin/src deploy/tencent/manage.sh "$@")
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
git -C "$ROOT" archive --format=tar "HEAD:medops" "${PATHS[@]}" | gzip -9n > "$TMP/payload.tgz"
SHA=$(sha256sum "$TMP/payload.tgz" | cut -d' ' -f1)
mkdir -p "$OUT"
F="$OUT/medops-upgrade-$VERSION.sh"
sed -e "s/@VERSION@/$VERSION/g" -e "s/@COMMIT@/$COMMIT/g" -e "s/@SHA256@/$SHA/g" "$HERE/install.sh.in" > "$F"
printf '\n__PAYLOAD_BELOW__\n' >> "$F"
base64 -w 76 "$TMP/payload.tgz" >> "$F"
chmod +x "$F"
bash -n "$F"                                    # 语法自检（只检查脚本部分）
echo "$F"
echo "  版本 $VERSION · 提交 $COMMIT · $(du -h "$F" | cut -f1) · 含 $(tar tzf "$TMP/payload.tgz" | grep -vc '/$') 个文件" >&2
