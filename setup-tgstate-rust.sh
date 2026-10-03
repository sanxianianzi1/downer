#!/usr/bin/env bash
#
# 让 tgstate-rust 带上本仓库的全部补丁，并构建启动。
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
#       本脚本负责把它拉下来并按文件名顺序打上 patches/ 里的全部补丁。

set -euo pipefail
cd "$(dirname "$0")"

DIR=tgstate-rust
BASE=bf4253a5dcd686b63cf589fc8c24df7f73d2a4a6   # 上游 v2.1.7

if ! ls patches/*.patch >/dev/null 2>&1; then
  echo "找不到 patches/ 下的补丁" >&2
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

# 2. 强制回到干净的补丁基线
#    注意：单靠 git checkout <commit> 无法保证可重复执行，它有两个盲区：
#      a) 已经处于该提交时，checkout 是空操作，不会丢弃上次打补丁留下的改动；
#      b) 不会删除补丁新增的未跟踪文件（如补丁 4 新建的 src/routes/api_bot.rs）。
#    残留会让后续 git apply 失败（补丁 3、4 改同一批文件），脚本就会误报
#    「无法应用，上游代码可能已变动」。所以必须 --force 丢弃改动 + clean 删残留。
#    git clean 默认不动 .gitignore 里的文件，所以 target/、.env、*.db 都不会被删。
echo "==> 切到基线 $BASE (v2.1.7)，并清理上次的补丁残留"
git fetch --tags --quiet origin || true
git checkout --quiet --force "$BASE"
git clean --quiet -fd

# 2b. 断言工作树确实干净，否则后面的 apply 只会报出误导性的错误
dirty=$(git status --porcelain)
if [ -n "$dirty" ]; then
  echo "==> 清理后工作树仍不干净，无法安全打补丁：" >&2
  echo "$dirty" >&2
  exit 1
fi

# 3. 按文件名顺序打全部补丁
#    此时已保证是干净基线，补丁应全部正向应用。
#    「已在位」用反向应用检测：补丁已生效时 forward check 会失败、reverse check 成功。
for pf in ../patches/*.patch; do
  name=$(basename "$pf")
  if git apply --reverse --check "$pf" 2>/dev/null; then
    echo "==> $name 已在位，跳过"
  elif git apply --check "$pf" 2>/dev/null; then
    git apply "$pf"
    echo "==> 已应用 $name"
  else
    echo "==> $name 无法应用，请人工检查（上游代码可能已变动）" >&2
    exit 1
  fi
done

# 4. 自检
if grep -q "fn max_upload_body_size" src/constants.rs \
  && grep -q "max_upload_body_size()" src/main.rs \
  && grep -q 'contains("too many requests")' src/telegram/service.rs \
  && grep -q "fn global_upload_semaphore" src/telegram/service.rs \
  && grep -q "CREATE TABLE IF NOT EXISTS folders" src/database.rs \
  && grep -q "fn require_bot_key" src/routes/api_bot.rs \
  && grep -q "fn panel_router" src/routes/api_bot.rs \
  && grep -q "/api/folders" src/routes/api_bot.rs \
  && grep -q "folder-grid" app/templates/index.html; then
  echo "==> 自检通过：10GiB 上限 + flood 变体重试 + 全局闸 + 文件夹/bot 管理面 + 网页目录管理"
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
