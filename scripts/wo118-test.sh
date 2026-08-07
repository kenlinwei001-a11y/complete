#!/usr/bin/env bash
# WO-QUOTE-MARGIN-CUSTOMER 测试门：单 fork（gate 正在占 CPU 时不加压），显式捕获退出码。
# 用法：bash scripts/wo118-test.sh <vitest 文件模式...>
set -uo pipefail
cd "$(dirname "$0")/../apps/datacore"
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
