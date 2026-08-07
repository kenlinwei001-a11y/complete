#!/usr/bin/env bash
# G1 临时跑测脚本（显式捕获退出码；跑完即删）。
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || exit 2
out="$(pnpm --filter frontend-shell exec vitest run test/sandbox-g1-views.seam.test.tsx --reporter=basic 2>&1)"; rc=$?
echo "RC=$rc"
echo "$out" | tail -80
exit $rc
