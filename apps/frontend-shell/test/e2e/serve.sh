#!/usr/bin/env bash
# WO-REAL-FRONTEND-VERIFY · 起真后端 + 真前端（⛔ 禁 VITE_MOCK）
#
# ⚠ CREDENTIAL_KEY 必须写死一个 64 位十六进制串。
#   本环境**没有 `xxd`** —— 用 `xxd` 生成会得到空串，后端启动即 `too_small`，
#   极易被误判成契约包坏了。这就是它写死在这里的原因。
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
LOGDIR="${E2E_LOGDIR:-/tmp/e2e-logs}"
mkdir -p "$LOGDIR"

CRED=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
echo "CREDENTIAL_KEY length = ${#CRED} (must be 64)"

PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 CREDENTIAL_KEY="$CRED" \
  node "$ROOT/apps/datacore/dist/server.js" > "$LOGDIR/datacore.log" 2>&1 &
echo "datacore pid=$!"

PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 SERVICE_TOKEN=dev-svc \
  node "$ROOT/apps/agentcore/dist/main.js" > "$LOGDIR/agentcore.log" 2>&1 &
echo "agentcore pid=$!"

# 前端：**预览已 build 的产物**，不是 dev server（省 CPU），端口 5173、绑 127.0.0.1
# —— hostname 命中 localhost 分支，浏览器直连 4001/4002（两侧 CORS origin:true 已实测放行）。
cd "$ROOT/apps/frontend-shell" || exit 1
node ./node_modules/vite/bin/vite.js preview --port 5173 --host 127.0.0.1 --strictPort \
  > "$LOGDIR/frontend.log" 2>&1 &
echo "frontend pid=$!"
