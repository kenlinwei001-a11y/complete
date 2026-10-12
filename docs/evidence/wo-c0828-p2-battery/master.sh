#!/bin/bash
# WO-C0828-P2 四包电池 · 收编门（在 merge 后树 complete/ 跑）
# 被验 commit：51a13d002（= ab3e045a5 P2 merge + 本体回写）
# 顺序：五包 build → datacore 全包 → agentcore（已知红 solo→全包）→ frontend 全包
# 已知红处置：datacore 2 允许存量红（solo 红，不进 argv，全包后对 P1 豁免 + 新红 A/B）
#            agentcore dsh-degraded-seams A3（solo 绿，进 argv）；runtime-workflow/solver-cancel-seam 全包后 solo A/B
#            frontend 8 存量持久红（不进 argv，全包后 baseline A/B /tmp/wt-base-front @4a8e02fc6）
set -u
cd /Users/apple/deploy/complete
EVID="docs/evidence/wo-c0828-p2-battery"
mkdir -p "${EVID}"
REV=$(git rev-parse --short HEAD)
echo "VERIFIED_COMMIT=${REV} FULL=$(git rev-parse HEAD) START=$(date '+%m-%d %H:%M:%S')" > "${EVID}/master.txt"

for pkg in @platform/contracts @platform/llm-adapters datacore agentcore frontend-shell; do
  echo "== build ${pkg} START $(date '+%H:%M:%S') ==" >> "${EVID}/master.txt"
  pnpm --filter "${pkg}" build > "${EVID}/build-${pkg#@platform/}.txt" 2>&1
  echo "BUILD_RC[${pkg}]=$? END=$(date '+%H:%M:%S')" >> "${EVID}/master.txt"
done

echo "== datacore 电池 START $(date '+%H:%M:%S') ==" >> "${EVID}/master.txt"
bash scripts/battery.sh run datacore "${EVID}/datacore" > "${EVID}/datacore-run.txt" 2>&1
echo "BATTERY_RC[datacore]=$? END=$(date '+%H:%M:%S')" >> "${EVID}/master.txt"

echo "== agentcore 电池 START $(date '+%H:%M:%S') ==" >> "${EVID}/master.txt"
bash scripts/battery.sh run agentcore "${EVID}/agentcore" test/dsh-degraded-seams.test.ts > "${EVID}/agentcore-run.txt" 2>&1
echo "BATTERY_RC[agentcore]=$? END=$(date '+%H:%M:%S')" >> "${EVID}/master.txt"

echo "== frontend-shell 电池 START $(date '+%H:%M:%S') ==" >> "${EVID}/master.txt"
bash scripts/battery.sh run frontend-shell "${EVID}/frontend" > "${EVID}/frontend-run.txt" 2>&1
echo "BATTERY_RC[frontend-shell]=$? END=$(date '+%H:%M:%S')" >> "${EVID}/master.txt"

echo "ALL_DONE END=$(date '+%H:%M:%S')" >> "${EVID}/master.txt"
