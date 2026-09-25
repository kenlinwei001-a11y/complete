#!/usr/bin/env bash
# WO-REAL-FRONTEND-VERIFY · 起真后端 + 真前端（⛔ 禁 VITE_MOCK）
#
# ⚠ 合并说明（WO-HOME-ENTRY-FLOW × WO-PALETTE-USABLE 的 add/add 冲突，此处一次性了结）：
#   两张单**各自新建了这个文件**，差别只有端口。取**参数化的那一版 + 原来的默认值**——
#   不传 env 就是原来的 4001/4002/5173，老脚本原样能跑；并跑时才传 env 避让。
#
# ⚠ 为什么要能换端口：本轮 6 单 + 全量 gate 同跑，4001/4002/5173 会被别人占着。
#   ⛔ 硬红线：**不许 `pkill -f datacore`** 去抢端口（本轮已误杀别人 3 次）——换端口，别杀进程。
#   实测（node net.createServer 逐个试绑）：4031/4041 IN_USE，4032/4042/5193 FREE。
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
LOGDIR="${E2E_LOGDIR:-/tmp/e2e-logs}"
mkdir -p "$LOGDIR"

# 默认值 = 合并前 WO-REAL-FRONTEND-VERIFY 那版的写死值 ⇒ 不传 env 的老脚本行为不变。
DC_PORT="${E2E_DC_PORT:-4001}"
AC_PORT="${E2E_AC_PORT:-4002}"
FE_PORT="${E2E_FE_PORT:-5173}"
# BLOB_DIR 跟着端口走，否则两套服务抢同一个 blob 目录。
BLOBDIR="${E2E_BLOB_DIR:-/tmp/blobs-e2e-$DC_PORT}"

CRED=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
echo "CREDENTIAL_KEY length = ${#CRED} (must be 64)"

PORT=$DC_PORT JWT_SECRET=dev BLOB_DIR="$BLOBDIR" SEED_DEMO=1 CREDENTIAL_KEY="$CRED" \
  node "$ROOT/apps/datacore/dist/server.js" > "$LOGDIR/datacore.log" 2>&1 &
echo "datacore pid=$! port=$DC_PORT"

PORT=$AC_PORT DATACORE_BASE_URL=http://127.0.0.1:$DC_PORT SERVICE_TOKEN=dev-svc \
  node "$ROOT/apps/agentcore/dist/main.js" > "$LOGDIR/agentcore.log" 2>&1 &
echo "agentcore pid=$! port=$AC_PORT"

# 前端：**预览已 build 的产物**，不是 dev server（省 CPU），绑 127.0.0.1
# —— hostname 命中 localhost 分支，浏览器直连后端两口（两侧 CORS origin:true 已实测放行）。
cd "$ROOT/apps/frontend-shell" || exit 1
node ./node_modules/vite/bin/vite.js preview --port "$FE_PORT" --host 127.0.0.1 --strictPort \
  > "$LOGDIR/frontend.log" 2>&1 &
echo "frontend pid=$! port=$FE_PORT"

# ── 前端 build 命令（端口烤进产物，故与本文件成对使用）────────────────────────────
# 默认端口（4001/4002）时不必带这两个 env —— env.ts 的 localhost 分支就是这两个值。
# 换端口时**必须**带，且必须带在 build 那一步（preview 时再设已经太晚）：
# VITE_DATACORE_URL=http://127.0.0.1:4032 VITE_AGENTCORE_URL=http://127.0.0.1:4042 \
#   pnpm --filter frontend-shell build
# ⛔ 一个字都不许出现 VITE_MOCK —— 交付验证禁 mock（铁律 1.5 判据三）。
