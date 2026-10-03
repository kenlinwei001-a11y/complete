#!/bin/bash
# WO-C0828-P2 · 定向集（机器降级下的替代证据面）
# 为什么不是全包/路由族线：本机 free 内存 ~7MB、压缩器 ~10GB、swap 12.5GB/23.5GB，
#   单条用例被拉到 1,402,810ms（正常秒级）；agentcore 209 文件 12h 只跑完 85 个（40%）。
#   全包与 32 文件路由族线在可预见时间内不可能完成 —— 改跑「P2 改动面」本身。
# 覆盖面：P2 diff 里被改过的每一个测试文件（datacore 1 + frontend 5）。
set -u
cd /Users/apple/deploy/complete
EVID="docs/evidence/wo-c0828-p2-battery/targeted"
mkdir -p "${EVID}"
{
  echo "HEAD=$(git rev-parse --short HEAD) FULL=$(git rev-parse HEAD) START=$(date '+%m-%d %H:%M:%S')"
  echo "理由：机器降级（Pages free ~7MB / compressor ~10GB / swap 12.5G of 23.5G）"
  echo "覆盖：git diff --name-status b4cd399c4 ab3e045a5 -- '*/test/*' 里的全部文件"
} > "${EVID}/README.txt"

nice -n 10 pnpm --filter datacore exec vitest run test/option-pricing.test.ts \
  --maxWorkers=1 --testTimeout=1500000 > "${EVID}/datacore-option-pricing.txt" 2>&1
RC_DC=$?
echo "CAPTURED_RC=${RC_DC}" >> "${EVID}/datacore-option-pricing.txt"
echo "CAPTURED_RC=${RC_DC}" > "${EVID}/datacore-option-pricing.txt.rc"

nice -n 10 pnpm --filter frontend-shell exec vitest run \
  test/console0828-decision.seam.test.tsx \
  test/exposure-responds-to-perturbation.seam.test.ts \
  test/sim-session-lifecycle.seam.test.tsx \
  test/sim-unified-shell.seam.test.tsx \
  test/sim-rail-forms.seam.test.tsx \
  --maxWorkers=1 --testTimeout=1500000 > "${EVID}/frontend-p2-touched.txt" 2>&1
RC_FE=$?
echo "CAPTURED_RC=${RC_FE}" >> "${EVID}/frontend-p2-touched.txt"
echo "CAPTURED_RC=${RC_FE}" > "${EVID}/frontend-p2-touched.txt.rc"

echo "TARGETED_DONE END=$(date '+%m-%d %H:%M:%S')" >> "${EVID}/README.txt"
