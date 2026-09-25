#!/usr/bin/env bash
# WO-HOME-ENTRY-FLOW · 起真后端 + 真前端（⛔ 禁 VITE_MOCK）
#
# 与 `claude/handoff-wo-real-frontend-verify` 那份的差别只有**端口**：
#   本轮另有 6 张单 + 全量 gate 在跑，4001/4002/5173 可能被别人占着。
#   ⛔ 派单硬红线：**不许 `pkill -f datacore`**（本轮已误杀 3 次）——改成自选不冲突端口。
#   实测（node net.createServer 逐个试绑）：4031/4041 IN_USE，4032/4042/5193 FREE ⇒ 取后三个。
#
# ⚠ 端口一换就多一件事必须做：`apps/frontend-shell/src/env.ts` 对 localhost **写死** 4001/4002
#   （`isLocalhost ? "http://127.0.0.1:4001"`）。Vite 在 **build 时**内联 import.meta.env，
#   故必须在 `pnpm --filter frontend-shell build` 那一步就带上 VITE_DATACORE_URL / VITE_AGENTCORE_URL，
#   preview 时再设已经太晚（产物里烤的还是 4001）。build 命令见本文件末尾注释。
#
# ⚠ CREDENTIAL_KEY 必须写死一个 64 位十六进制串。
#   本环境**没有 `xxd`** —— 用 `xxd` 生成会得到空串，后端启动即 `too_small`，
#   极易被误判成契约包坏了。这就是它写死在这里的原因。
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
LOGDIR="${E2E_LOGDIR:-/tmp/e2e-home-entry-logs}"
mkdir -p "$LOGDIR"

DC_PORT="${E2E_DC_PORT:-4032}"
AC_PORT="${E2E_AC_PORT:-4042}"
FE_PORT="${E2E_FE_PORT:-5193}"

CRED=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
echo "CREDENTIAL_KEY length = ${#CRED} (must be 64)"

PORT=$DC_PORT JWT_SECRET=dev BLOB_DIR=/tmp/blobs-home-entry SEED_DEMO=1 CREDENTIAL_KEY="$CRED" \
  node "$ROOT/apps/datacore/dist/server.js" > "$LOGDIR/datacore.log" 2>&1 &
echo "datacore pid=$! port=$DC_PORT"

PORT=$AC_PORT DATACORE_BASE_URL=http://127.0.0.1:$DC_PORT SERVICE_TOKEN=dev-svc \
  node "$ROOT/apps/agentcore/dist/main.js" > "$LOGDIR/agentcore.log" 2>&1 &
echo "agentcore pid=$! port=$AC_PORT"

# 前端：**预览已 build 的产物**，不是 dev server（省 CPU）。
cd "$ROOT/apps/frontend-shell" || exit 1
node ./node_modules/vite/bin/vite.js preview --port "$FE_PORT" --host 127.0.0.1 --strictPort \
  > "$LOGDIR/frontend.log" 2>&1 &
echo "frontend pid=$! port=$FE_PORT"

# ── 前端 build 命令（端口烤进产物，故与本文件成对使用）────────────────────────────
# VITE_DATACORE_URL=http://127.0.0.1:4032 VITE_AGENTCORE_URL=http://127.0.0.1:4042 \
#   pnpm --filter frontend-shell build
# ⛔ 一个字都不许出现 VITE_MOCK —— 交付验证禁 mock（铁律 1.5 判据三）。
