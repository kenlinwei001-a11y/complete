#!/usr/bin/env bash
# 门必须显式捕获退出码（CLAUDE.md）：不许 `cmd | tail`，那取的是 tail 的 RC。
set -o pipefail
cd /home/user/complete/.claude/worktrees/agent-a4c03805ce35d9ff9 || exit 2
OUT=$(mktemp)
pnpm --filter frontend-shell exec vitest run "$@" >"$OUT" 2>&1
RC=$?
# 失败时打印原文（error TS|FAIL|AssertionError），不许只 tail 几行把错误挤掉
if [ "$RC" -ne 0 ]; then
  grep -nE "FAIL|AssertionError|error TS|Error:|✕|✗" "$OUT" | head -80
  echo "──── 尾部 60 行 ────"
fi
tail -n 60 "$OUT"
echo "RC=$RC"
exit "$RC"
