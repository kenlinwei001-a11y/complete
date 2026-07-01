#!/usr/bin/env bash
# WO-SOURCE-TRANSPARENCY · FDE 一键编排：起真 datacore:4001(SEED_DEMO=1) + vite:5199(真后端模式) → Playwright 真 Chromium。
# 用法：bash scripts/run-source-transparency-fde.sh   （需先 pnpm -r build）
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-st-fde SEED_DEMO=1 CREDENTIAL_KEY=$KEY SERVICE_TOKEN=svc-st \
  node apps/datacore/dist/server.js > /tmp/st-dc.log 2>&1 & DC=$!
( cd apps/frontend-shell && VITE_DATACORE_URL=http://127.0.0.1:4001 VITE_AGENTCORE_URL=http://127.0.0.1:4002 \
  exec ./node_modules/.bin/vite --port 5199 --host 127.0.0.1 ) > /tmp/st-vite.log 2>&1 & VT=$!
cleanup() { kill $DC $VT 2>/dev/null; }
trap cleanup EXIT

# 等种子链真跑完（合成源连接出现）+ vite 就绪——healthz 早于 seed 完成，须等真数据。
for i in $(seq 1 90); do
  curl -sf http://127.0.0.1:4001/a/v1/connections -H 'x-debug-user: demo:admin:admin' 2>/dev/null | grep -q "合成" \
    && curl -sf http://127.0.0.1:5199/ >/dev/null 2>&1 \
    && { echo "· 全栈就绪（种子链完成）@ ${i}s"; break; }
  sleep 1
done

UI_PORT=5199 node scripts/fde-source-transparency.mjs
exit $?
