#!/usr/bin/env bash
# gate-resumable.sh · 断点续跑版交付门（scripts/gate.sh 的抗重启替身）
#
# ## 为什么要有这个东西（2026-08-06 实测出来的，不是设计出来的）
#
# `scripts/gate.sh` 的 TEST 段是**一次 `pnpm -r test` 跑完五包**。跑满约 35–40 分钟。
# 而本沙箱是托管的一次性容器，**按设计会被定期回收** —— 当天重启 10 次，
# 间隔短的时候不到 20 分钟。于是出现一个结构性死锁：
#
#   gate 需要 40 分钟 > 重启间隔 ⇒ **gate 永远跑不完**。
#   当天连续三次都是刚进 TEST 段就被杀（14:31 起→15:33 杀 · 15:41 起→15:54 杀）。
#
# 关键在于：**每次被杀，前面已经跑绿的包全部作废重跑**。这才是真正的浪费 ——
# 不是"运气不好"，是把 40 分钟的工作放在一个平均寿命更短的容器里且不做检查点。
#
# ## 判据不变，只把「一次跑完」改成「逐包记账」
#
# 每包单独跑、单独记结果，**检查点按 commit sha 分文件**。重启后重跑本脚本：
# 同一个 commit 上已记 PASS 的包直接跳过，只补没跑完的那些。
# 一次重启的代价从「40 分钟全丢」降到「当前这一包重来」（最长约 12 分钟）。
#
# ⚠ **检查点必须绑 commit sha**，否则就成了假绿的新形态：
#   改了代码却复用上个 commit 的绿记录 —— 那个绿是真的，只是它不指向你要断言的对象。
#   （当天已犯过同族错误：dev 在主工作目录改文件，gate 报的全绿指向一个中间态。）
#
# ## 与 gate.sh 的关系
# 治理门那批只要 ~1 分钟，不值得记账，每次都重跑（也顺便保证门账是新的）。
# ⚠ 别在这里写死门的条数：本脚本第一版写了「21 条」，迁移号门并进来后就成了 22，
#   标签与现实脱节 —— 正是本仓一直在罚的那类问题（一个断言性的说法，没人去核对它所断言的东西）。
# 本脚本**不替代** gate.sh 的其余段落；判据完全相同 —— 五包全绿 + 治理门全绿，少一包即红。
#
# 用法：
#   bash scripts/gate-resumable.sh          # 跑（可反复跑，自动续）
#   bash scripts/gate-resumable.sh --status # 只看当前 commit 的进度，不跑
#   bash scripts/gate-resumable.sh --reset  # 清掉当前 commit 的检查点重来

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

SCRATCH="${SCRATCH:-/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad}"
mkdir -p "$SCRATCH"

SHA="$(git rev-parse --short HEAD)"
DIRTY="$(git status --porcelain | head -1)"
CKPT="$SCRATCH/gate-ckpt-$SHA.txt"
LOGDIR="$SCRATCH/gate-logs-$SHA"
mkdir -p "$LOGDIR"

# 包按「跑得快的在前」排 —— 早拿到的绿更可能在下次重启前落账。
PKGS=("@platform/contracts" "@platform/llm-adapters" "frontend-shell" "agentcore" "datacore")

echo "═══ gate-resumable · commit $SHA · $(date '+%F %H:%M:%S') · 机器已运行 $(awk '{print int($1/60)}' /proc/uptime) 分钟 ═══"
if [ -n "$DIRTY" ]; then
  echo "⛔ 工作树不干净 —— 拒绝跑。"
  echo "   gate 的结论必须指向一个确定的 commit；带着未提交改动跑出来的绿证明不了任何 commit。"
  git status --short | head -10
  exit 1
fi

recorded() { [ -f "$CKPT" ] && grep -qx "$1=PASS" "$CKPT"; }

if [ "${1:-}" = "--status" ]; then
  echo "检查点：$CKPT"
  for p in "${PKGS[@]}"; do recorded "$p" && echo "  ✅ $p" || echo "  ⬜ $p"; done
  exit 0
fi
if [ "${1:-}" = "--reset" ]; then rm -f "$CKPT"; echo "已清 $CKPT"; exit 0; fi

# ── 治理门（快·每次重跑）──────────────────────────────────────────────
echo "───── 治理门（每次重跑，不记账）─────"
out=$(pnpm gates 2>&1); rc=$?
if [ $rc -ne 0 ]; then
  echo "❌ 治理门 RC=$rc"
  printf '%s\n' "$out" | grep -E "✗|❌|error" | head -20
  exit 1
fi
echo "✅ 治理门 RC=0"

out=$(node scripts/check-ontology-writeback.mjs 2>&1); rc=$?
if [ $rc -ne 0 ]; then echo "❌ ontology-writeback RC=$rc"; printf '%s\n' "$out" | tail -8; exit 1; fi
echo "✅ ontology-writeback RC=0"

# ── 五包逐个跑·逐个记账 ───────────────────────────────────────────────
echo "───── TEST（五包·逐包记账·可续跑）─────"
FAILED=0
for p in "${PKGS[@]}"; do
  if recorded "$p"; then echo "⏭  $p —— 本 commit 已记 PASS，跳过"; continue; fi
  echo "▶  $p …（$(date '+%H:%M:%S')）"
  log="$LOGDIR/${p//[^a-zA-Z0-9]/_}.log"
  out=$(pnpm --filter "$p" test 2>&1); rc=$?          # ★ 先捕获退出码，绝不经管道
  printf '%s\n' "$out" > "$log"
  # 剥 ANSI 后再取汇总行（CI 下 vitest 强开彩色，不剥会恒匹配 0 行 —— gate.sh 踩过）
  summary=$(printf '%s\n' "$out" | sed -E $'s/\x1b\\[[0-9;]*[A-Za-z]//g' | grep -E "Tests[[:space:]]+[0-9]+[[:space:]]+(passed|failed)|Tests[[:space:]]+no tests" | tail -1)
  if [ $rc -eq 0 ]; then
    echo "$p=PASS" >> "$CKPT"
    echo "   ✅ $p RC=0 · ${summary:-（无汇总行）} · $(date '+%H:%M:%S')"
  else
    FAILED=1
    echo "   ❌ $p RC=$rc · ${summary:-（无汇总行）}"
    printf '%s\n' "$out" | grep -E "error TS|FAIL|✗|AssertionError|ERR_|Unhandled|Errors +[0-9]+ error|^\s+at .*\.(ts|tsx):[0-9]+" | head -30
    echo "   完整日志：$log"
    break   # 红了就停，别浪费 CPU 跑后面的
  fi
done

echo "═════════ 结果 ═════════"
DONE=0; for p in "${PKGS[@]}"; do recorded "$p" && DONE=$((DONE+1)); done
echo "· 已记 PASS：$DONE / ${#PKGS[@]}（检查点 $CKPT）"
if [ "$FAILED" = "1" ]; then echo "❌ 有包未通过 —— 不得并线。修完重跑本脚本（已绿的包不会重跑）。"; exit 1; fi
if [ "$DONE" -lt "${#PKGS[@]}" ]; then
  echo "⏸  尚未跑完（大概率被容器回收打断）。**直接重跑本脚本即可续**，已绿的包会跳过。"
  exit 2
fi
# 收尾复核：跑完了，但工作树/HEAD 若已变，这份绿就不指向它了
# ⚠ 治理门**自己会写产物**（check-prd-coverage / check-prd-ontology 重算索引、
#   check-ontology-anchors --update 校准行号、门禁产物文档）。第一版把这些也算作"工作树被污染"
#   ⇒ **每次跑完都会把自己判作废**，一次都过不了。判据必须区分
#   「门自己的输出」与「别人在我跑的时候改了源码」——后者才是要拦的。
#   故收尾只看**非门产物**的改动。门产物照常提交，它们本来就是 gate 的产出物之一。
GATE_ARTIFACTS='^(docs/prd-coverage-index\.json|docs/prd-ontology-index\.json|docs/ONTOLOGY-SLICE-GAPS\.md|scripts/ontology-anchor-baseline\.json)$'
FOREIGN="$(git status --porcelain | awk '{print $2}' | grep -Ev "$GATE_ARTIFACTS" || true)"
if [ "$(git rev-parse --short HEAD)" != "$SHA" ] || [ -n "$FOREIGN" ]; then
  echo "⛔ 跑完期间 HEAD 变了、或有**非门产物**的改动 —— 本次结果作废（它证明的不是当前这个 commit）。"
  [ -n "$FOREIGN" ] && { echo "   非门产物改动："; printf '   %s\n' $FOREIGN; }
  exit 1
fi
echo "✅ 五包全绿 + 治理门全绿 @ $SHA —— 可并线。"
