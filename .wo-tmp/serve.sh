#!/usr/bin/env bash
# WO-DIMENSION-ERRORS 私有探针：起真 datacore（内存模式 SEED_DEMO=1）
set -u
cd /home/user/complete/.claude/worktrees/agent-a8d1b82659ac55c78
PORT=${PORT:-4401}
export PORT
export JWT_SECRET=dev
export BLOB_DIR=/tmp/blobs-wodim
export SEED_DEMO=1
export CREDENTIAL_KEY=0000000000000000000000000000000000000000000000000000000000000000
node apps/datacore/dist/server.js > .wo-tmp/server-$PORT.log 2>&1 &
echo $! > .wo-tmp/server-$PORT.pid
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/a/v1/health" 2>/dev/null || true)
  if [ "$code" = "200" ]; then echo "UP after ${i}s pid=$(cat .wo-tmp/server-$PORT.pid)"; exit 0; fi
  sleep 1
done
echo "DOWN"; tail -20 .wo-tmp/server-$PORT.log; exit 1
