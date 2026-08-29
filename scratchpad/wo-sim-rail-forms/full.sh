#!/usr/bin/env bash
set -o pipefail
cd /home/user/complete/.claude/worktrees/agent-a4c03805ce35d9ff9 || exit 2
OUT=/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/fe-full.txt
pnpm --filter frontend-shell exec vitest run >"$OUT" 2>&1
echo "FULL_RC=$?"
