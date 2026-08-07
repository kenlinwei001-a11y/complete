#!/usr/bin/env bash
# WO-QUOTE-MARGIN-CUSTOMER 本地构建门：显式捕获退出码（禁止 `cmd | tail; echo $?`）。
set -uo pipefail
cd "$(dirname "$0")/.."
pkg="${1:-datacore}"
out=$(pnpm --filter "$pkg" build 2>&1)
rc=$?
echo "BUILD_EXIT=$rc"
if [ "$rc" -ne 0 ]; then
  echo "$out" | grep -E "error TS|FAIL|AssertionError" | head -40
  echo "--- tail ---"
  echo "$out" | tail -20
  exit "$rc"
fi
echo "BUILD OK"
