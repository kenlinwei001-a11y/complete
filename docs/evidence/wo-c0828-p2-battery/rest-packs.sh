#!/bin/bash
# WO-C0828-P2 收编门 · 剩余两包（datacore 改 delta 线后的并行流）
# agentcore：P2 增量 0 文件 → 跑全包保记录（P1 实测 27 min）
# frontend-shell：P2 增量主体（8 文件）→ 全包（P1 实测 82 min）
set -u
cd /Users/apple/deploy/complete
EVID="docs/evidence/wo-c0828-p2-battery"
{
  echo "HEAD=$(git rev-parse --short HEAD) START=$(date '+%m-%d %H:%M:%S')"
  echo "== agentcore 全包 =="
} > "${EVID}/rest-packs.txt"

bash scripts/battery.sh run agentcore "${EVID}/agentcore" test/dsh-degraded-seams.test.ts >> "${EVID}/rest-packs.txt" 2>&1
echo "BATTERY_RC[agentcore]=$? END=$(date '+%m-%d %H:%M:%S')" >> "${EVID}/rest-packs.txt"

bash scripts/battery.sh run frontend-shell "${EVID}/frontend" >> "${EVID}/rest-packs.txt" 2>&1
echo "BATTERY_RC[frontend-shell]=$? END=$(date '+%m-%d %H:%M:%S')" >> "${EVID}/rest-packs.txt"
echo "REST_DONE END=$(date '+%m-%d %H:%M:%S')" >> "${EVID}/rest-packs.txt"
