#!/usr/bin/env bash
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || exit 2
out="$(pnpm --filter datacore exec vitest run test/g1-probe.test.ts --reporter=basic 2>&1)"; rc=$?
echo "RC=$rc"
echo "$out" > /tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/g1-probe.txt
echo "written: scratchpad/g1-probe.txt ($(echo "$out" | wc -l) lines)"
exit $rc
