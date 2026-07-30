#!/usr/bin/env bash
# 四包交付门（单一入口）。
#
# ⛔ 存在理由 = 一次真实事故：此前手写门用
#      pnpm -r build 2>&1 | tail -8; echo "BUILD_EXIT=$?"
#    取到的是**管道最后一个命令 tail 的退出码**，`tail` 永远成功 → BUILD_EXIT 恒为 0，
#    于是一个 **agentcore 编译失败**（skill-probe.ts 用了 canonical 尚无的 SkillDefinition.sideEffect）
#    的 commit 被判定"BUILD 通过"并并入正线，直到部署方 build 失败才暴露。
#    错误信息当时就明明白白打在日志里，只是被 `BUILD_EXIT=0` 盖过去了。
#
# 纪律：本脚本内**一律先执行、显式捕获 $?，再决定是否打印**；任何 `cmd | tail` 之后取 $? 都是假绿。
#      新增门请照抄 run() 的写法，不要在管道后读 $?。
#
# 用法：bash scripts/gate.sh              # 全量（build + 静态门 + 四包测试）
#      bash scripts/gate.sh --no-test    # 只跑 build + 静态门（快检）
set -uo pipefail

FAILED=()
run() {
  local name="$1"; shift
  echo "───── ${name} ─────"
  local out rc
  out="$("$@" 2>&1)"; rc=$?          # ★ 先捕获退出码，绝不经管道
  if [ $rc -eq 0 ]; then
    echo "$out" | tail -3
    echo "✅ ${name} RC=0"
  else
    # 失败时打印足量上下文（含 TS 错误行），而不是只 tail 几行把错误挤掉
    echo "$out" | grep -E "error TS|FAIL|✗|AssertionError|ERR_" | head -25
    echo "$out" | tail -15
    echo "❌ ${name} RC=${rc}"
    FAILED+=("${name}")
  fi
}

run "BUILD (pnpm -r build)" pnpm -r build
run "debattery:check" node scripts/check-debattery.mjs
run "genuine-sim:check" node scripts/check-genuine-sim.mjs
run "arg-drop-seam:check" node scripts/check-arg-drop-seam.mjs

if [ "${1:-}" != "--no-test" ]; then
  # datacore 勿并发多 vitest（CLAUDE.md LOOP 纪律）→ workspace-concurrency=1
  run "TEST (四包·串行)" pnpm -r --workspace-concurrency=1 test
fi

echo
echo "═════════ GATE 结果 ═════════"
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "✅ 全绿（可并线）"
  exit 0
fi
echo "❌ 未通过：${FAILED[*]}"
echo "   —— 不得并线。修完重跑本脚本。"
exit 1
