#!/usr/bin/env bash
#
# 让 tgstate-rust 带上「上传上限 10GiB」补丁，并构建启动。
#
# 什么时候用：
#   - VPS 重装 / 换机器 / 换了部署目录
#   - 别人 clone 了本仓库，但 compose 里的 ./tgstate-rust 目录不存在
#
# 用法：
#   ./setup-tgstate-rust.sh          准备代码 + 构建启动
#   ./setup-tgstate-rust.sh --prep   只准备代码，不构建
#
# 背景：tgstate-rust/ 是上游克隆，被 .gitignore 排除，不进本仓库。
#       本脚本负责把它拉下来并打上补丁，补丁见 patches/。

set -euo pipefail
cd "$(dirname "$0")"

DIR=tgstate-rust
BASE=bf4253a5dcd686b63cf589fc8c24df7f73d2a4a6   # 上游 v2.1.7
PATCHFILE=patches/tgstate-rust-10gib-body-limit.patch

if [ ! -f "$PATCHFILE" ]; then
  echo "找不到补丁 $PATCHFILE" >&2
  exit 1
fi

# 1. 拉代码
if [ ! -d "$DIR/.git" ]; then
  echo "==> 克隆上游 tgstate-rust"
  git clone https://github.com/buyi06/tgstate-rust.git "$DIR"
else
  echo "==> 已存在 $DIR，跳过克隆"
fi

cd "$DIR"

# 2. 切到补丁基线
echo "==> 切到基线 $BASE (v2.1.7)"
git fetch --tags --quiet origin || true
git checkout --quiet "$BASE"

# 3. 打补丁（可重复执行）
if grep -q "fn max_upload_body_size" src/constants.rs; then
  echo "==> 补丁已在位，跳过"
elif git apply --check "../$PATCHFILE" 2>/dev/null; then
  git apply "../$PATCHFILE"
  echo "==> 补丁已应用"
else
  echo "==> 补丁无法应用，请人工检查（上游代码可能已变动）" >&2
  exit 1
fi

# 4. 自检
if grep -q "fn max_upload_body_size" src/constants.rs && grep -q "max_upload_body_size()" src/main.rs; then
  echo "==> 自检通过：上传上限 10GiB（可用 MAX_UPLOAD_BODY_SIZE_MB 覆盖）"
else
  echo "==> 自检失败：补丁未正确生效" >&2
  exit 1
fi

cd ..

if [ "${1:-}" = "--prep" ]; then
  echo "==> 代码已就绪，未构建。需要时执行： docker compose up -d --build"
  exit 0
fi

# 5. 构建启动
if [ ! -f .env ]; then
  echo "==> 缺少 .env，请先复制 .env.example 并填好内容" >&2
  exit 1
fi

echo "==> 构建并启动"
docker compose up -d --build
echo "==> 当前状态"
docker compose ps
