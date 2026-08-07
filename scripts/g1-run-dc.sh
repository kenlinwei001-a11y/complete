#!/usr/bin/env bash
# G1 临时跑测脚本 · datacore 半（显式捕获退出码；跑完即删）。
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || exit 2
out="$(pnpm --filter datacore exec vitest run test/sandbox-g1-seam.test.ts --reporter=basic 2>&1)"; rc=$?
echo "RC=$rc"
echo "$out" | tail -140
exit $rc
