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
#
# ## 分片：包内也要有断点，否则最大的那一包就是最大的损失单元
#
# 实测（2026-08-07）：gate 跑到 4/5，contracts/llm-adapters/frontend/agentcore 都已记账，
# **偏偏死在 datacore 上** —— 那一包约 12 分钟，包内无断点，重启落在中间就整包重来。
# 于是「最大的包」＝「最可能被杀的包」＝「每次都白跑」，形成一个稳定的死循环：
# 当天 datacore 连续 4 次没跑完。
#
# 判据不是「让它跑快点」，是**把损失单元切小到远小于容器寿命**。
# 实测容器在场观测存活 13–77 分钟，故单片目标 ≤5 分钟：即使最差情况被杀，也只赔一片。
# vitest 原生 --shard=i/N 按文件分片且**互不重叠、并集为全集**，天然适合当断点边界。
declare -A SHARDS=( ["datacore"]=4 )   # 只切最大的那一包；小包切片的调度开销大于收益
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
  for p in "${PKGS[@]}"; do n="${SHARDS[$p]:-1}"; if [ "$n" -le 1 ]; then recorded "$p" && echo "  ✅ $p" || echo "  ⬜ $p"; else for i in $(seq 1 "$n"); do recorded "$p#$i/$n" && echo "  ✅ $p#$i/$n" || echo "  ⬜ $p#$i/$n"; done; fi; done
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
# 展开成「工作单元」列表：不分片的包 = 1 个单元；分片的包 = N 个单元，各自独立记账。
UNITS=()
for p in "${PKGS[@]}"; do
  n="${SHARDS[$p]:-1}"
  if [ "$n" -le 1 ]; then UNITS+=("$p"); else for i in $(seq 1 "$n"); do UNITS+=("$p#$i/$n"); done; fi
done

for u in "${UNITS[@]}"; do
  if recorded "$u"; then echo "⏭  $u —— 本 commit 已记 PASS，跳过"; continue; fi
  p="${u%%#*}"; shard="${u#*#}"
  SHARD_ARG=()
  [ "$shard" != "$u" ] && SHARD_ARG=(--shard="$shard")
  echo "▶  $u …（$(date '+%H:%M:%S')）"
  log="$LOGDIR/${u//[^a-zA-Z0-9]/_}.log"
  out=$(pnpm --filter "$p" test -- "${SHARD_ARG[@]}" 2>&1); rc=$?   # ★ 先捕获退出码，绝不经管道
  printf '%s\n' "$out" > "$log"
  # 剥 ANSI 后再取汇总行（CI 下 vitest 强开彩色，不剥会恒匹配 0 行 —— gate.sh 踩过）
  summary=$(printf '%s\n' "$out" | sed -E $'s/\x1b\\[[0-9;]*[A-Za-z]//g' | grep -E "Tests[[:space:]]+[0-9]+[[:space:]]+(passed|failed)|Tests[[:space:]]+no tests" | tail -1)
  if [ $rc -eq 0 ]; then
    echo "$u=PASS" >> "$CKPT"
    echo "   ✅ $u RC=0 · ${summary:-（无汇总行）} · $(date '+%H:%M:%S')"
  else
    FAILED=1
    echo "   ❌ $u RC=$rc · ${summary:-（无汇总行）}"
    printf '%s\n' "$out" | grep -E "error TS|FAIL|✗|AssertionError|ERR_|Unhandled|Errors +[0-9]+ error|^\s+at .*\.(ts|tsx):[0-9]+" | head -30
    echo "   完整日志：$log"
    break   # 红了就停，别浪费 CPU 跑后面的
  fi
done

echo "═════════ 结果 ═════════"
DONE=0; for u in "${UNITS[@]}"; do recorded "$u" && DONE=$((DONE+1)); done
echo "· 已记 PASS：$DONE / ${#UNITS[@]} 个工作单元（检查点 $CKPT）"
if [ "$FAILED" = "1" ]; then echo "❌ 有包未通过 —— 不得并线。修完重跑本脚本（已绿的包不会重跑）。"; exit 1; fi
if [ "$DONE" -lt "${#UNITS[@]}" ]; then
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
echo "✅ 全部工作单元通过 + 治理门全绿 @ $SHA —— 可并线。"
