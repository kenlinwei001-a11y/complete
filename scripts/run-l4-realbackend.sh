#!/usr/bin/env bash
# L4 真后端 E2E 一键编排（TESTING-STANDARD §1 L4 真后端模式）：
# 起真 datacore:4001 + 真 agentcore:4002 + 前端 vite 真后端模式 :5200 → Playwright 真 Chromium 跑 e2e-realbackend.mjs。
# 用法：bash scripts/run-l4-realbackend.sh   （需先 pnpm -r build；playwright-core 已装；chromium 由 ms-playwright 缓存提供）
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
SVC="svc-l4"
CHROME="${CHROME:-$(ls -d "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell 2>/dev/null | head -1)}"
[ -z "$CHROME" ] && { echo "✗ 未找到 chromium headless_shell（先 npx playwright install chromium）"; exit 1; }

PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-l4run SEED_DEMO=1 CREDENTIAL_KEY=$KEY SERVICE_TOKEN=$SVC \
  AGENTCORE_BASE_URL=http://127.0.0.1:4002 node apps/datacore/dist/server.js > /tmp/l4-dc.log 2>&1 & DC=$!
PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 SERVICE_TOKEN=$SVC node apps/agentcore/dist/main.js > /tmp/l4-ac.log 2>&1 & AC=$!
( cd apps/frontend-shell && VITE_DATACORE_URL=http://127.0.0.1:4001 VITE_AGENTCORE_URL=http://127.0.0.1:4002 \
  exec ./node_modules/.bin/vite --port 5200 --host 127.0.0.1 ) > /tmp/l4-vite.log 2>&1 & VT=$!
cleanup() { kill $DC $AC $VT 2>/dev/null; }
trap cleanup EXIT

for i in $(seq 1 60); do
  curl -sf http://127.0.0.1:4001/healthz >/dev/null 2>&1 && curl -sf http://127.0.0.1:4002/healthz >/dev/null 2>&1 \
    && curl -sf http://127.0.0.1:5200/ >/dev/null 2>&1 && { echo "· 全栈就绪 @ ${i}s"; break; }
  sleep 1
done
CHROME=$CHROME FRONT=http://127.0.0.1:5200 E2E_USER="${E2E_USER:-admin}" E2E_PASS="${E2E_PASS:-demo1234}" \
  timeout 180 node scripts/e2e-realbackend.mjs
EC=$?
exit $EC
