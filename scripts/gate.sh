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

# ⛔ 前置自证（RC=2「门自己坏了」，与 RC=1「代码真违规」分开）—— 这是 CLAUDE.md 铁律 0.6
#    三级处置的第 3 级落地：同一个错第 3 次了，必须由**机器**先说话。
#
#    来历（三次，形态完全相同）：
#      ① 2026-08-09 多个 dev 在**没装 node_modules** 的 worktree 上开工，
#         报 `Failed to resolve entry for package "@platform/contracts"` —— 被读成「契约包坏了」。
#      ② 同期另一族：`@platform/llm-adapters` 未 build，datacore vitest 直接 `Tests no tests`。
#         处置是往**派单模板**里加两句话。**文档不是机制**（本仓自己的第 11 条错账原话）。
#      ③ 2026-08-13 审核方自己在新建的 verify worktree 上跑本脚本：`vitest: not found`、
#         `node_modules missing`，脚本照样打出「❌ 未通过：BUILD … TEST … —— **不得并线**」。
#         那句话是**说谎**：它度量的不是代码，而是「这台机器上没装依赖」。
#
#    形态（铁律 0.6 句式）：**「我用『门红了』当作『代码有问题』的证据，而前者并不度量后者。」**
#
#    判据：跑门所需的**工具本身**必须先自证在位。缺 ⇒ RC=2 + 明确说「本次结论作废」，
#    **不许**落进 FAILED 数组、不许打印「不得并线」——那是给真违规留的话。
preflight() {
  local missing=() root; root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  [ -d "$root/node_modules" ] || missing+=("根 node_modules")
  # 正金丝雀：vitest 是 TEST 段真正要调的那个二进制，缺了整段测试恒假红。
  [ -x "$root/node_modules/.bin/vitest" ] || missing+=("node_modules/.bin/vitest")
  for p in packages/contracts packages/llm-adapters apps/datacore apps/agentcore apps/frontend-shell; do
    [ -d "$root/$p/node_modules" ] || missing+=("$p/node_modules")
  done
  # 负金丝雀：一个**必然存在**的路径若也报缺，说明判据本身坏了（如 root 解析错），
  # 那时同样报 RC=2 —— 「我没找到」与「它不存在」是两个命题。
  if [ ! -f "$root/package.json" ]; then
    echo "⛔ 前置自证失败：连 package.json 都找不到（root=$root）⇒ **本脚本的路径解析坏了**，不是仓库缺东西。"
    echo "   本次结论作废。RC=2"
    exit 2
  fi
  if [ ${#missing[@]} -ne 0 ]; then
    echo "⛔ 门自己没装好，**未度量任何代码**：缺 ${missing[*]}"
    echo "   先跑：pnpm install --prefer-offline && pnpm --filter @platform/contracts build && pnpm --filter @platform/llm-adapters build"
    echo "   ⚠️ 这**不是**「不得并线」——本次什么都没验，结论作废。RC=2"
    exit 2
  fi
  echo "✓ 前置自证：node_modules ×6 + vitest 二进制均在位（缺任一即 RC=2「门坏了」而非 RC=1「代码坏了」）"
}
preflight

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
    # 失败时打印足量上下文（含 TS 错误行），而不是只 tail 几行把错误挤掉。
    # ⛔ 本过滤器自己出过事（真实踩过）：原模式只有 `error TS|FAIL|✗|AssertionError|ERR_`，
    #    遇到 **teardown 期未捕获异步错误**（vitest「This error was caught after test environment
    #    was torn down」·全部用例 passed 但进程退出码非 0）时，**错误本体一个字都没打印出来**，
    #    只剩一句 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL —— 诊断时拿不到是哪个文件、哪个 timer 泄漏。
    #    本脚本抬头写着"不许只 tail 几行把错误挤掉"，那一次它自己犯了这条。已补泄漏/未捕获类特征词
    #    与堆栈行（`at xxx.tsx:1:1`），并把尾部上下文从 15 行放宽到 40 行。
    echo "$out" | grep -E "error TS|FAIL|✗|AssertionError|ERR_|Unhandled|unhandled|caught after|Errors +[0-9]+ error|Serialized Error|rejection|^\s+at .*\.(ts|tsx):[0-9]+" | head -40
    echo "$out" | tail -40
    echo "❌ ${name} RC=${rc}"
    FAILED+=("${name}")
  fi
}

run "BUILD (pnpm -r build)" pnpm -r build
run "genuine-sim:check" node scripts/check-genuine-sim.mjs
# WO-NAV-GATE · 导航归组覆盖门（本体 §8 G-NAV-FALLBACK-BUCKET 的机械门那一半）。
#
# 接 gate.sh 而**不**接 `pnpm gates` 是刻意的、且不是偷懒：`check-ontology-writeback.mjs` 正向断言
# 「每个并入 `pnpm gates` 的门都必须在本体 §7 登记」。本门由 dev 单产出、§7 回写归审核方，
# 上 gates 链却没同批写 §7 → `ontology-writeback:check` 当场红。故先接 gate.sh（GATE_SH，
# 每次交付门真跑，不是死门），门账 disposition=WIRE 记着「§7 登记后升 GATES_CHAIN」这笔待办。
run "nav-group-coverage:check" node scripts/check-nav-group-coverage.mjs
# WO-STALE-CLAIMS · 过期「自称实测」声明门（本体 §8 G-STALE-MEASURED-CLAIM 的机械那一半）。
#
# 同上不接 `pnpm gates` 而接本脚本，理由一模一样：`check-ontology-writeback.mjs` 正向断言
# 「每个并入 `pnpm gates` 的门都必须在本体 §7 登记」，而 §7 回写归审核方。故先接 GATE_SH。
#
# 它咬的是「实测的保质期等于做实测的那一天」：一句没日期、没复验方式的"运行态实测 X 是 0"，
# 上游一补齐就变成屏上说谎，而**自称实测**恰恰让复审不再追那一层。
# 最狠的一层是 STALE-3/4：把声明里引用的事实（某对象类型在不在 putAll 册上 / 某符号有没有消费方）
# **当场读回来核** —— 上游一补齐，声明当场红，不靠人记性。
run "stale-claims:check" node scripts/check-stale-claims.mjs
# WO-SANDBOX-A2 · 全链扫描「零写死」门（PRD-sandbox-redesign §9 验收 A2 / §10.1 点亮判据 A2）。
#
# 建它的直接理由：§9 A2 白纸黑字写「`chain-scan-honesty:check` 绿」，而这道门**根本不存在**——
# 制度点名、实际没有的门 = 那条验收今天无法机械核（同族前例：boundary-singlesource 曾红着且零接线
# 24 个 commit，欠账 #76）。**验收判据点名一道不存在的门，比没有判据更危险**：它让人以为核过了。
#
# 同上两条接 gate.sh 而不接 `pnpm gates`：`check-ontology-writeback.mjs` 正向断言要求进 gates 链的门
# 必须在本体 §7 登记，而本单不得动 package.json（会连带顶 ontology-writeback 的棘轮）。
# 门账 disposition=WIRE 记着「§7 登记落地后升 GATES_CHAIN」这笔待办。
run "chain-scan-honesty:check" node scripts/check-chain-scan-honesty.mjs
# `pnpm gates` = 一批治理门（debattery / arg-drop-seam / action-wiring / 本体一致 / 全链闭包 / 描述覆盖 …）。
#
# ⛔ 为何补进来（第三层假绿·本地与 CI 覆盖面不一致）：本脚本自称"防假绿的单一入口"，
#    而它原先只跑 3 条静态门，CI 却另跑 `pnpm gates` + `check-ontology-writeback.mjs`。
#    于是**照 LOOP 纪律只跑 `bash scripts/gate.sh` 的审核方，拿到的是比 CI 弱的检查**——
#    本地全绿 → 推上去 CI 才红，或更糟：本地绿被当成"验过了"直接并线。
#    「门存在 ≠ 门在跑」的下一层是「**门在跑 ≠ 你跑的那道门等于 CI 那道门**」。
#    debattery/arg-drop-seam 原先单列，已含在 `pnpm gates` 里，去重后只保留 genuine-sim（不在 gates 列表）。
#
# ⚠️ 门数**现算不写死**：这行标签曾长期写着"13 条治理门"，而实际已涨到 15
#    （新增 action-wiring / outsource-redline / ontology-descriptions 时没人回来改标签）。
#    标签说谎与假绿同族——看门的人以为自己知道跑了多少道，其实读的是过期常数。
#    出处唯一 = package.json 的 gates 脚本，这里只做投影。
GATES_N="$(node -e 'console.log(require("./package.json").scripts.gates.split("&&").length)' 2>/dev/null || echo "?")"
run "pnpm gates（${GATES_N} 条治理门）" pnpm gates
run "ontology-writeback:check" node scripts/check-ontology-writeback.mjs
# ⚠️ 刻意**不**并入 handoff 并线台账门（`check-handoff-integration.mjs`）：
#    它以**远端** canonical 为真值，读不到本地未推送的工作副本 → 本地必然红。
#    把一条设计上本地恒红的门放进日常入口，只会训练出"红了也照并"的习惯，反而拆掉所有门的威慑。
#    它留在 CI 单独的 job 里（那里的远端视图才是完整的），本地需要时用
#    `node scripts/check-handoff-integration.mjs --canonical HEAD` 自查。

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
    # ⛔ 与 run() 同一处教训（**TEST 段才是真正踩到的那处**）：窄过滤器遇到 teardown 期未捕获异步错误
    #    （全部用例 passed、`Errors 1 error`、进程退出码非 0）时，错误本体一个字都打不出来，
    #    只剩 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL —— 拿不到是哪个文件/哪个 timer 泄漏，无法定性。
    #    诊断这类"全绿却红"必须看到堆栈行与包名分隔行，故一并放宽。
    echo "$out" | grep -E "error TS|FAIL|✗|AssertionError|ERR_|Unhandled|unhandled|caught after|Errors +[0-9]+ error|Serialized Error|rejection|^\s+at .*\.(ts|tsx):[0-9]+" | head -40
    # 各包分隔行（`/path/apps/xxx:`）能指认是哪个包退的码——全绿却红时这是第一手线索。
    echo "$out" | grep -E "^/.*/(apps|packages)/[^:]+:$" | head -10
    echo "$out" | tail -40
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
