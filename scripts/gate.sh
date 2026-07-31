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

# TEST 段专用：成功时也必须**逐包点名**。
#
# 包数 = 5，不是长期口口相传的"四包"：除 datacore/agentcore/frontend-shell/@platform/contracts 外，
# @platform/llm-adapters 也有 17 个真测试（在 src/ 内联，不在 test/ 目录，故一直被漏数）。
#
# 为何单列（第二层假绿·真实踩过的报告盲区）：run() 成功分支只 `tail -3`，四包串行跑完
# 只剩最后一包的汇总，看不出前三包到底跑没跑。`pnpm -r test` 确实会因任一包失败而整体非 0，
# 但"某包 test 脚本被删/改名 → 该包被静默跳过"同样是 RC=0——「看不见它跑过」正是上次假绿的成因。
# 故此处断言汇总行数 ≥ EXPECT_PKGS：少一包即红，并把实际点名打出来。
EXPECT_PKGS=5
run_test() {
  echo "───── TEST (五包·串行) ─────"
  local out rc roll cnt
  # datacore 勿并发多 vitest（CLAUDE.md LOOP 纪律）→ workspace-concurrency=1
  out="$(pnpm -r --workspace-concurrency=1 test 2>&1)"; rc=$?   # ★ 先捕获退出码，绝不经管道
  # ⚠ 匹配前必须剥 ANSI 转义码。GitHub Actions 设 CI=true，vitest 因此**强开彩色输出**，
  #   汇总行实际形如 `Tests \e[22m \e[1m\e[31m16 failed`——"Tests" 与数字之间夹着转义序列，
  #   而原正则要求二者之间只有空格，于是 CI 上恒匹配 0 行、点名判 0/5 而误报"有包被静默跳过"。
  #   本地用 $(...) 捕获时无 TTY、vitest 不着色，故本地一直正常——**又一次"本地绿只代表本地绿"**。
  #   剥码比设 NO_COLOR 更稳：不依赖下游工具是否尊重该环境变量。
  local plain
  plain="$(printf '%s\n' "$out" | sed -E $'s/\x1b\\[[0-9;]*[A-Za-z]//g')"
  roll="$(printf '%s\n' "$plain" | grep -E "Tests[[:space:]]+[0-9]+[[:space:]]+(passed|failed)|Tests[[:space:]]+no tests")"
  cnt="$(printf '%s\n' "$roll" | grep -c . )"
  if [ $rc -ne 0 ]; then
    echo "$out" | grep -E "error TS|FAIL|✗|AssertionError|ERR_" | head -25
    echo "$out" | tail -15
    echo "❌ TEST (五包·串行) RC=${rc}"
    FAILED+=("TEST (五包·串行)")
    return
  fi
  echo "· 逐包点名（每包一行汇总）："
  echo "$roll" | sed 's/^/  /'
  if [ "$cnt" -lt "$EXPECT_PKGS" ]; then
    echo "❌ TEST (五包·串行) 只有 ${cnt}/${EXPECT_PKGS} 包产出测试汇总 —— 有包被静默跳过（test 脚本缺失/改名？），RC=0 不算通过"
    FAILED+=("TEST 逐包点名 ${cnt}/${EXPECT_PKGS}")
    return
  fi
  echo "✅ TEST (五包·串行) RC=0（${cnt}/${EXPECT_PKGS} 包全部点名）"
}

if [ "${1:-}" != "--no-test" ]; then
  run_test
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
