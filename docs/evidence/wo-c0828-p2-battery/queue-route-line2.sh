#!/bin/bash
# WO-C0828-P2 · datacore 收尾排队线 v2（v1 已停：逐文件 solo 会重复 32 次 collect，负载下每次 ~60s 纯开销）
# 等 ab6 solo 线（pid 传参）退出后：
#   ① 路由族线 32 文件 —— **单次 vitest 调用** maxWorkers=1（仍串行，只是共用一次 collect）
#   ② vle-acceptance 复跑（负载定性）
set -u
cd /Users/apple/deploy/complete
EVID="docs/evidence/wo-c0828-p2-battery"
WAIT_PID="${1:?usage: queue-route-line2.sh <pid>}"
OUT="${EVID}/route-line.txt"
RD="${EVID}/datacore-route-line"
mkdir -p "${RD}"
FILES=$(cat "${EVID}/datacore-route-line-files.txt")

echo "QUEUE2 START=$(date '+%m-%d %H:%M:%S') WAIT_PID=${WAIT_PID} HEAD=$(git rev-parse --short HEAD)" > "${OUT}"
while kill -0 "${WAIT_PID}" 2>/dev/null; do sleep 30; done
echo "AB6_LINE_GONE $(date '+%H:%M:%S')" >> "${OUT}"

echo "== 路由族线 32 文件 · 单次调用 maxWorkers=1 START $(date '+%H:%M:%S') ==" >> "${OUT}"
{
  echo "cmd: vitest run <32 files> --maxWorkers=1 --testTimeout=1500000"
  echo "file_count: $(echo "${FILES}" | wc -l | tr -d ' ')"   # 金丝雀：文件表条数（空表=0，必现形）
  echo "${FILES}" | sed 's/^/  /'
} > "${RD}/battery-route.txt"
nice -n 10 pnpm --filter datacore exec vitest run ${FILES} --maxWorkers=1 --testTimeout=1500000 >> "${RD}/battery-route.txt" 2>&1
RC_ROUTE=$?
echo "RC_ROUTE=${RC_ROUTE}" > "${RD}/battery-route.txt.rc"
echo "ROUTE_LINE_RC=${RC_ROUTE} END=$(date '+%H:%M:%S')" >> "${OUT}"

echo "== vle-acceptance 复跑（负载定性）START $(date '+%H:%M:%S') ==" >> "${OUT}"
bash scripts/battery.sh solo datacore "${EVID}/vle-recheck" test/vle-acceptance.test.ts >> "${OUT}" 2>&1
RC_VLE=$?
echo "VLERECHECK_RC=${RC_VLE} END=$(date '+%H:%M:%S')" >> "${OUT}"
echo "QUEUE_DONE END=$(date '+%H:%M:%S')" >> "${OUT}"
