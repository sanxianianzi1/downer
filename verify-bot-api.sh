#!/usr/bin/env bash
#
# bot 管理面（/api/bot/*）自检。在 VPS 上、仓库根目录执行：
#   ./verify-bot-api.sh
#
# 前置：.env 已配置 TGSTATE_BOT_KEY，且 tgstate 已用新镜像重启。
# 全程只操作临时目录 _bot_selfcheck，不动真实文件。

set -euo pipefail

BASE="${TGSTATE_CHECK_URL:-http://127.0.0.1:8000}"
KEY="$(grep -E '^TGSTATE_BOT_KEY=' .env | head -1 | cut -d= -f2- | tr -d '\"' | tr -d "'" | xargs)"

if [ -z "$KEY" ]; then
  echo "FAIL: .env 里没有 TGSTATE_BOT_KEY" >&2
  exit 1
fi

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }

# 1. 无密钥 → 401
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/bot/folders")
[ "$code" = "401" ] || fail "无密钥应得 401，实际 $code"
pass "无密钥被拒（401）"

# 2. 错误密钥 → 401
code=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Bot-Key: wrong-key" "$BASE/api/bot/folders")
[ "$code" = "401" ] || fail "错误密钥应得 401，实际 $code"
pass "错误密钥被拒（401）"

# 3. 正确密钥 → 200
resp=$(curl -s -H "X-Bot-Key: $KEY" "$BASE/api/bot/folders")
echo "$resp" | grep -q '"folders"' || fail "列表响应异常：$resp"
pass "根目录列表正常"

# 4. 建临时目录
resp=$(curl -s -X POST -H "X-Bot-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"name":"_bot_selfcheck"}' "$BASE/api/bot/folders")
echo "$resp" | grep -q '"status":"ok"' || fail "建目录失败：$resp"
fid=$(echo "$resp" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
[ -n "$fid" ] || fail "建目录响应缺 id：$resp"
pass "创建目录（id=$fid）"

# 5. 改名
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "X-Bot-Key: $KEY" \
  -H 'Content-Type: application/json' -d '{"name":"_bot_selfcheck_renamed"}' \
  "$BASE/api/bot/folders/$fid/rename")
[ "$code" = "200" ] || fail "目录改名应得 200，实际 $code"
pass "目录改名"

# 6. 级联删除
resp=$(curl -s -X DELETE -H "X-Bot-Key: $KEY" "$BASE/api/bot/folders/$fid")
echo "$resp" | grep -q '"status":"ok"' || fail "级联删除失败：$resp"
echo "$resp" | grep -q '"folders_deleted":1' || fail "级联删除计数异常：$resp"
pass "级联删除"

# 7. 列表里不再出现
resp=$(curl -s -H "X-Bot-Key: $KEY" "$BASE/api/bot/folders")
echo "$resp" | grep -q '_bot_selfcheck' && fail "临时目录仍存在" || true
pass "临时目录已清理"

echo ""
echo "全部自检通过。接下来在 Telegram 里实测：/ls、/mkdir 影视/测试、/mv、/rmdir confirm"
