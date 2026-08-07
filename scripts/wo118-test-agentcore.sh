#!/usr/bin/env bash
# WO-QUOTE-MARGIN-CUSTOMER agentcore 测试门：单 fork，显式捕获退出码。
set -uo pipefail
cd "$(dirname "$0")/../apps/agentcore"
out=$(pnpm exec vitest run --pool=forks --poolOptions.forks.singleFork --no-file-parallelism "$@" 2>&1)
rc=$?
echo "TEST_EXIT=$rc"
if [ "$rc" -ne 0 ]; then
  echo "$out" | grep -E "error TS|FAIL|AssertionError|✗|× |Error:|expected" | head -60
  echo "--- tail ---"
  echo "$out" | tail -40
  exit "$rc"
fi
echo "$out" | tail -14
