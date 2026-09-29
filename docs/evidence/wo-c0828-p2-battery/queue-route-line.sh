#!/bin/bash
# WO-C0828-P2 · datacore 收尾排队线
# 等 ab6 solo 线（pid 传参）退出后：① 32 文件路由族线（solo）② vle-acceptance 复跑（负载定性）
# 之所以排队而不是并行：本机已有别的 agent 的 datacore 全包在跑（/tmp/wo-perf/gate.sh），
# 我的 datacore 同时只跑一条。
set -u
cd /Users/apple/deploy/complete
EVID="docs/evidence/wo-c0828-p2-battery"
WAIT_PID="${1:?usage: queue-route-line.sh <pid>}"
OUT="${EVID}/route-line.txt"

echo "QUEUE START=$(date '+%m-%d %H:%M:%S') WAIT_PID=${WAIT_PID} HEAD=$(git rev-parse --short HEAD)" > "${OUT}"
while kill -0 "${WAIT_PID}" 2>/dev/null; do sleep 30; done
echo "AB6_LINE_GONE $(date '+%H:%M:%S')" >> "${OUT}"

echo "== 路由族线 32 文件（solo）START $(date '+%H:%M:%S') ==" >> "${OUT}"
bash scripts/battery.sh solo datacore "${EVID}/datacore-route-line" $(cat "${EVID}/datacore-route-line-files.txt") >> "${OUT}" 2>&1
echo "ROUTE_LINE_RC=$? END=$(date '+%H:%M:%S')" >> "${OUT}"

echo "== vle-acceptance 复跑（负载定性）START $(date '+%H:%M:%S') ==" >> "${OUT}"
bash scripts/battery.sh solo datacore "${EVID}/vle-recheck" test/vle-acceptance.test.ts >> "${OUT}" 2>&1
echo "VLERECHECK_RC=$? END=$(date '+%H:%M:%S')" >> "${OUT}"
echo "QUEUE_DONE END=$(date '+%H:%M:%S')" >> "${OUT}"
