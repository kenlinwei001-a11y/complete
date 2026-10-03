#!/bin/bash
# WO-C0828-P2 · 续跑线（铁律 1.6：只跑剩下那部分，不重开）
# 背景：第一次启动的路由族线 + agentcore 全包死在「机器近乎停摆」窗口里
#   （Pages free ~7MB / swap 12.5G / 单条用例 1,402,810ms / 路由线 9.5h 只完成 1/32）。
#   停掉我方重线后内存回到 ~700MB free，故续跑：先路由族线（剩 31 文件），再 frontend 全包。
# 定向集（targeted.sh）在跑，故排队等它退出，避免三条同时抢内存。
set -u
cd /Users/apple/deploy/complete
EVID="docs/evidence/wo-c0828-p2-battery"
WAIT_PID="${1:?usage: resume-line.sh <pid>}"
OUT="${EVID}/resume-line.txt"
RD="${EVID}/datacore-route-line"
mkdir -p "${RD}" "${EVID}/frontend"

echo "RESUME START=$(date '+%m-%d %H:%M:%S') WAIT_PID=${WAIT_PID} HEAD=$(git rev-parse --short HEAD)" > "${OUT}"
while kill -0 "${WAIT_PID}" 2>/dev/null; do sleep 30; done
echo "TARGETED_GONE $(date '+%H:%M:%S') FREE=$(vm_stat | awk '/Pages free/{print $3}')" >> "${OUT}"

echo "== 路由族线 32 文件 · 第二次启动 START $(date '+%H:%M:%S') ==" >> "${OUT}"
FILES=$(cat "${EVID}/datacore-route-line-files.txt")
{
  echo "cmd: vitest run <32 files> --maxWorkers=1 --testTimeout=1500000"
  echo "说明：第二次启动 —— 第一次（23:44 起）在机器降级窗口里 9.5 小时只完成 1 个文件被停"
  echo "file_count: $(echo "${FILES}" | wc -l | tr -d ' ')"
  echo "${FILES}" | sed 's/^/  /'
} > "${RD}/battery-route-2.txt"
nice -n 10 pnpm --filter datacore exec vitest run ${FILES} --maxWorkers=1 --testTimeout=1500000 >> "${RD}/battery-route-2.txt" 2>&1
RC_ROUTE=$?
echo "CAPTURED_RC=${RC_ROUTE}" > "${RD}/battery-route-2.txt.rc"
echo "ROUTE2_RC=${RC_ROUTE} END=$(date '+%H:%M:%S')" >> "${OUT}"

echo "== frontend 全包 START $(date '+%H:%M:%S') ==" >> "${OUT}"
bash scripts/battery.sh run frontend-shell "${EVID}/frontend" >> "${OUT}" 2>&1
RC_FE=$?
echo "FRONTEND_RC=${RC_FE} END=$(date '+%H:%M:%S')" >> "${OUT}"
echo "RESUME_DONE END=$(date '+%H:%M:%S')" >> "${OUT}"
