#!/bin/bash
# WO-C0828-P2 #43 · E2 live 重跑（改名后）
# 目的：证明改名后的**活服务**在真实 HTTP 路径上发出的是 deltaMagnitudeP50/P90。
# 环境：临时 datacore :4017（seed 42），非部署实例；4001/4002/5173 不动。
set -u
cd /Users/apple/deploy/complete
EV=docs/evidence/wo-c0828-p2-battery/fix-rename
OUT="${EV}/e2-live-rename.txt"

{
  echo "== E2 live 重跑（改名后）START=$(date '+%m-%d %H:%M:%S') =="
  echo "HEAD=$(git rev-parse --short HEAD)  dirty=$(git status --porcelain | wc -l | tr -d ' ')"
  echo "BASE=http://127.0.0.1:4017（临时实例，pid 见 /tmp/p2-probe-dc.pid）"
  echo "探针=/tmp/p2-exp-new.mjs（已 sed 到 4017，读 displacement.deltaMagnitudeP90）"
  echo
} > "${OUT}"

# 等种子世界就绪：以探针能跑出结论为判据，最多 15 分钟
READY=0
for i in $(seq 1 90); do
  T=$(node /tmp/p2-exp-new.mjs 2>&1)
  if echo "${T}" | grep -qE "PASS|FAIL|✅|❌|张"; then READY=1; echo "world ready after $((i*10))s" >> "${OUT}"; break; fi
  sleep 10
done
echo "READY=${READY} at $(date '+%H:%M:%S')" >> "${OUT}"
echo >> "${OUT}"

node /tmp/p2-exp-new.mjs >> "${OUT}" 2>&1
RC=$?
echo "CAPTURED_RC=${RC}" >> "${OUT}"
echo "CAPTURED_RC=${RC}" > "${OUT}.rc"
echo "E2_DONE RC=${RC} END=$(date '+%H:%M:%S')" >> "${OUT}"
