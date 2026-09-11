#!/usr/bin/env bash
# worktree-pin-check.sh —— 派出去的 agent 到底在哪棵树上？
#
# 用法：
#   bash scripts/worktree-pin-check.sh <PIN> <agentId> [agentId ...]   # 判这几个（RC 有意义）
#   bash scripts/worktree-pin-check.sh <PIN>                           # 只列全表，RC=3「未评估」
#
# 退出码：0 = 指定的都不落后 · 1 = 有落后（逐条点名）· 2 = 量法坏了 · 3 = 未评估
#
# ⚠ 为什么必须传 agentId：本仓 worktree 目录里躺着大量**历史残留**（实测 46 个，
#   其中 28 个落后于 PIN），它们全是干完活的旧单，落后是正常的、无害的。
#   bash 里没有可靠信号能分辨「这个 worktree 背后还有 agent 在跑」——
#   同 scripts/dispatch-deficit.sh 那条教训（两种启发式都实测报 0 而实际 4 个在跑）。
#   ⇒ **不传就明说未评估（RC=3），绝不默认「全都对」（RC=0）也绝不把残留算成告警（RC=1）。**
#   在跑的 agentId 从调度方的 agent 列表取，脚本量不了。
#
# ───────────────────────────────────────────────────────────────────────────
# 来历（照 CLAUDE.md 铁律 0.6 三级处置：这是第 2 次，故建机制而非只记账）
#
#   第 1 次 · 2026-08-29 LOOP10：五个角色里一个钉在 778cc589（06-15 的树），
#            其余四个在 3408572c。同一问题得到「20 单」与「500 单」两个都正确的
#            答案，差 25 倍。三份报告摆在一起才看出来，机制一次都没说话。
#
#   第 2 次 · 2026-09-11 COO 目标取证：派出 8 个取证 agent，派单里写死
#            「你的 worktree 已在此 commit (fbfa88f1)」。实测 reflog：
#            **8 个全部起点是 778cc589**，落后 4665 个提交
#            （apps/datacore/src 差 175 文件 / +68,349 行；battery.ts 1249 → 7053）。
#            6 个自己发现并 detach 到 PIN，2 个没有，1 个交了报告才说。
#
# 形态（铁律 0.6 句式）：
#   「我用『我在派单里写了 PIN=xxx』当作『agent 的树在 xxx』的证据，
#     而前者并不度量后者 —— worktree 的基线由工具决定，不由我写的字决定。」
#
# 同源第二句（本次我自己当场又犯了一遍，一并记下）：
#   「我用『现在 git worktree list 显示它在 PIN 上』当作『它一直在 PIN 上』的证据
#     —— 快照不度量历史。那 6 个是**自己纠过来的**，起点全是过期树。」
#   ⇒ 故本脚本**同时报起点与现状**；只报现状会把「自纠过的」与「本来就对的」混为一谈，
#     而这两者对派单模板的含义完全相反（前者证明模板坏了，后者证明模板好使）。
#
# ⚠ 这不是一道门：不参与交付准入、不咬红任何东西，只是派单前后的探针
#   （同 scripts/dispatch-deficit.sh · scripts/unpushed-watch.sh 那一族）。
#   ⇒ 不受「新增门 / 棘轮 / 基线 JSON 冻结」那条禁令约束。
# ───────────────────────────────────────────────────────────────────────────

set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "✗ 量法坏了：不在 git 仓库里"; exit 2; }

PIN_RAW="${1:-HEAD}"; shift || true
PIN="$(git rev-parse --verify -q "$PIN_RAW^{commit}")" || {
  echo "✗ 量法坏了：PIN '$PIN_RAW' 解析不出提交"; exit 2; }
PIN_S="${PIN:0:8}"
IDS=("$@")

GITDIR="$(git rev-parse --git-common-dir)"
WTDIR="$GITDIR/worktrees"

# ── 金丝雀：先证明遍历是活的 ───────────────────────────────────────────
# ⛔ 没有这一段，「0 条落后」与「遍历坏了」在屏上一模一样。
TOTAL=0
[ -d "$WTDIR" ] && TOTAL="$(find "$WTDIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"
echo "金丝雀 · worktree 总数 = $TOTAL · PIN = $PIN_S ($(git log -1 --format=%ad --date=short "$PIN"))"
if [ "$TOTAL" -eq 0 ]; then
  echo "→ 一个 worktree 都没有。若你确信派了 agent，那是**遍历坏了**，不是大家都对。"
  exit 2
fi

# 要判的集合：给了 id 就只判这几个；没给就全列但不判
if [ "${#IDS[@]}" -gt 0 ]; then
  echo "判定范围：你点名的 ${#IDS[@]} 个 agent（其余 $((TOTAL - ${#IDS[@]})) 个视为历史残留，不判）"
else
  echo "⚠ 未评估：你没告诉我哪些 agent 在跑。下面是全表，仅供参考 —— 落后的多半是历史残留。"
fi
echo
printf '%-36s %-10s %-10s %s\n' "worktree" "起点" "现在" "判定"
printf '%-36s %-10s %-10s %s\n' "------------------------------------" "--------" "--------" "----"

BEHIND=0; CHECKED=0; SELFFIXED=0; MISSING=0

judge_one() {   # $1 = 目录名（agent-xxx）
  local name="$1" d="$WTDIR/$1" log head_now start verdict n
  log="$d/logs/HEAD"
  head_now="$(git --git-dir="$d" rev-parse --verify -q HEAD 2>/dev/null)" || head_now=""
  if [ -z "$head_now" ]; then
    printf '%-36s %-10s %-10s %s\n' "${name:0:36}" "?" "?" "⚠ 读不到 HEAD（不计入统计）"
    return
  fi
  CHECKED=$((CHECKED+1))
  # reflog 行格式：<旧值> <新值> <who> <ts> <tz>\t<msg>；首行的"新值"即起点
  start=""; [ -f "$log" ] && start="$(head -1 "$log" 2>/dev/null | awk '{print $2}')"
  if [ "$head_now" = "$PIN" ]; then
    if [ -n "$start" ] && [ "$start" != "$PIN" ]; then
      verdict="✅ 在 PIN（⚠ 自纠来的，起点不是 PIN ⇒ 派单模板坏了）"; SELFFIXED=$((SELFFIXED+1))
    else
      verdict="✅ 在 PIN"
    fi
  elif git merge-base --is-ancestor "$head_now" "$PIN" 2>/dev/null; then
    n="$(git rev-list --count "$head_now..$PIN" 2>/dev/null || echo '?')"
    verdict="❌ 落后 PIN $n 个提交"; BEHIND=$((BEHIND+1))
  else
    verdict="◑ 不是 PIN 的祖先（自有提交或旁支，人工判）"
  fi
  printf '%-36s %-10s %-10s %s\n' "${name:0:36}" "${start:0:8}" "${head_now:0:8}" "$verdict"
}

if [ "${#IDS[@]}" -gt 0 ]; then
  for id in "${IDS[@]}"; do
    n="agent-${id#agent-}"
    if [ -d "$WTDIR/$n" ]; then judge_one "$n"
    else printf '%-36s %-10s %-10s %s\n' "${n:0:36}" "-" "-" "⚠ 无此 worktree（已回收？未用隔离？）"; MISSING=$((MISSING+1)); fi
  done
else
  for d in "$WTDIR"/*/; do judge_one "$(basename "$d")"; done
fi

echo
echo "已核 $CHECKED 个 · 落后 $BEHIND 个 · 自纠 $SELFFIXED 个 · 找不到 $MISSING 个"

if [ "$SELFFIXED" -gt 0 ]; then
  echo
  echo "⚠ 有 $SELFFIXED 个是 agent **自己**纠到 PIN 的 ⇒ 派单模板里那句"
  echo "  「你的 worktree 已在此 commit」是**断言**不是**自证命令**。下次派单必须写成："
  echo "     git rev-parse --short HEAD"
  echo "     git merge-base --is-ancestor HEAD $PIN_S \\"
  echo "       && { echo 落后; git checkout --detach $PIN_S; } || echo 不落后"
fi

if [ "${#IDS[@]}" -eq 0 ]; then
  echo
  echo "⚠ RC=3「未评估」—— 上面这张表**不构成**「调度正常」，也不构成告警。"
  echo "  要让 RC 有意义，把在跑的 agentId 传进来：$0 $PIN_S <id> [id ...]"
  exit 3
fi

if [ "$BEHIND" -gt 0 ]; then
  echo
  echo "⛔ 有 agent 在过期树上取证。它报的每一条『整条缺 / 零命中 / 做不到』都可能是"
  echo "   『N 个提交之前还没做』而不是『今天没有』。处置："
  echo "   ① 让它 \`git checkout --detach $PIN_S\`（只 detach 到 PIN，不切命名分支、不 commit）"
  echo "   ② 让它在 PIN 上**重跑每一条否定结论**，重跑时重新打金丝雀"
  echo "   ③ 报告头写明哪些数取自过期树、哪些已在 PIN 上复核；没复核的降级『未测』"
  exit 1
fi
exit 0
