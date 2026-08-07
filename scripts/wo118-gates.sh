#!/usr/bin/env bash
# WO-QUOTE-MARGIN-CUSTOMER 本地门：逐门显式捕获退出码（禁止 `cmd | tail; echo $?`）。
# 用法：bash scripts/wo118-gates.sh [ontology|test|build|all]
set -uo pipefail
cd "$(dirname "$0")/.."
what="${1:-all}"
fail=0

run() { # run <name> <cmd...>
  local name="$1"; shift
  local out rc
  out=$("$@" 2>&1); rc=$?
  echo "=== $name : EXIT=$rc ==="
  if [ "$rc" -ne 0 ]; then
    echo "$out" | grep -E "error TS|FAIL|AssertionError|✗|✘|× " | head -40
    echo "--- tail ---"
    echo "$out" | tail -25
    fail=1
  else
    echo "$out" | tail -8
  fi
}

case "$what" in
  build|all) run "BUILD datacore" pnpm --filter datacore build ;;
esac
case "$what" in
  ontology|all)
    run "ontology:check" pnpm run -s ontology:check
    run "dril-retrieval:check" node scripts/check-dril-retrieval.mjs
    run "scenario-slot-keys:check" node scripts/check-scenario-slot-keys.mjs
    run "arg-drop-seam:check" node scripts/check-arg-drop-seam.mjs
    ;;
esac
case "$what" in
  test|all) run "TEST datacore quote-margin seam" pnpm --filter datacore exec vitest run test/quote-margin-customer.seam.test.ts ;;
esac

echo "=== OVERALL FAIL=$fail ==="
exit "$fail"
