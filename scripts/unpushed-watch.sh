#!/usr/bin/env bash
# scripts/unpushed-watch.sh —— 现算「有多少 dev 产出还没落盘」。
#
# ══ 这不是门 ═══════════════════════════════════════════════════════════════
# 它**不接 gate.sh**、不产生红绿准入判定、不写基线 JSON（仓主 2026-08-20 禁令 3 冻结的是那些）。
# 它与 `scripts/task-probe.sh` / `scripts/dispatch-deficit.sh` 同族：**探针**，回答一个事实问题。
#
# ══ 为什么必须有它（铁律 0.6 三级处置，本条已达第 3 次）═══════════════════
# 同一个错三次，每次代价都是**真实的产出丢失**：
#   · 2026-08-06 第 1 次 —— 容器重启，一个 dev 的产出从未 push，全丢。
#   · 2026-08-08 第 2 次 —— 集成 worktree 上 12 个提交 / 3397 行零远端分支，
#     靠磁盘没被清才幸存。处置：把「每完成一个可命名单元立刻推旁支」写进 CLAUDE.md 铁律 1 判据 5，
#     并要求「派单时也必须把这条写进工单纪律」。
#   · 2026-08-22 第 3 次 —— 6 张在跑的单被容器重启杀掉，**3 张的产出全丢**。
#     而那 6 张派单里 **5 张都白纸黑字写了「每完成一个可命名单元立刻 commit + push」**。
#
# **形态**（照铁律 0.6 句式）：
#   「我用『我在派单里写了立刻 push』当作『产出会落盘』的证据，而前者并不度量后者。」
#
# 第 2 次的处置之所以没拦住第 3 次，是因为它是**文档**不是**机器** ——
# CLAUDE.md 自己那句话早就说过：**「写在注释里的纪律不是机制，写在文档里的也不是。」**
# 机制的判据是**机器先说话**。第 3 次是仓主先说话的，所以才有这个文件。
#
# ══ 判据落在「内容」上，不是「分支存不存在」═══════════════════════════════
# ⚠ 本仓踩过这个坑（铁律 0.6 第 2 条）：拿「某文件/某分支存在」当「内容已落盘」的证据。
# 远端有一条同名分支，**不代表**工作树里那些改动已经在上面。所以这里只认两个量：
#   ① `git status --porcelain`  非空 ⇒ 有改动连 commit 都没有；
#   ② `git log @{u}..HEAD`      非空 ⇒ 有 commit 没推上去；
#   ③ 压根没有 upstream         ⇒ **一次都没推过**，最危险的一档。
#
# ══ 用法 ═══════════════════════════════════════════════════════════════════
#   bash scripts/unpushed-watch.sh            # 默认只看最近 120 分钟动过的 worktree（= 本轮在跑的）
#   bash scripts/unpushed-watch.sh 30         # 只看最近 30 分钟动过的
#   bash scripts/unpushed-watch.sh all        # 全部 agent worktree
#
# 退出码：0 = 全部已落盘；1 = 有产出悬空（**不是**"构建失败"，是"该催 dev 推了"）。
set -uo pipefail

WINDOW="${1:-120}"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "不在 git 仓库里"; exit 2; }

# ── 金丝雀：先自证这套遍历真的看得见 worktree（铁律 0.6 · 扫描类结论一律先自证工具）──
# 报「0 条悬空」是个**否定结论**，而否定结论必须附金丝雀命中证据 ——
# 否则「遍历坏了」与「大家都推了」在屏上长得一模一样。
TOTAL_WT=$(git worktree list --porcelain | grep -c '^worktree ' || true)
if [ "${TOTAL_WT:-0}" -lt 2 ]; then
  echo "⚠ 工具坏了：git worktree list 只看到 ${TOTAL_WT} 个 worktree（本仓常年 >100）。"
  echo "  不报『没有悬空产出』—— 那会是把工具故障读成代码干净。"
  exit 2
fi

risky=0
checked=0
printf '扫描 %s 个 worktree（窗口：%s）\n' "$TOTAL_WT" "$([ "$WINDOW" = all ] && echo 全部 || echo "最近 ${WINDOW} 分钟动过")"
printf -- '────────────────────────────────────────────────\n'

while read -r wt; do
  case "$wt" in *"/agent-"*) ;; *) continue ;; esac
  [ -d "$wt" ] || continue
  if [ "$WINDOW" != "all" ]; then
    [ -n "$(find "$wt" -maxdepth 1 -newermt "-${WINDOW} minutes" -print -quit 2>/dev/null)" ] || continue
  fi
  checked=$((checked + 1))

  br=$(git -C "$wt" branch --show-current 2>/dev/null)
  dirty=$(git -C "$wt" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  if up=$(git -C "$wt" rev-parse --abbrev-ref '@{u}' 2>/dev/null); then
    ahead=$(git -C "$wt" log --oneline "@{u}..HEAD" 2>/dev/null | wc -l | tr -d ' ')
    never=0
  else
    up="—"; ahead=0; never=1
  fi

  # 一次都没推过、但树上有提交或改动 ⇒ 最危险
  has_work=0
  [ "$dirty" -gt 0 ] && has_work=1
  [ "$ahead" -gt 0 ] && has_work=1
  if [ "$never" -eq 1 ] && [ -n "$br" ]; then has_work=1; fi

  if [ "$has_work" -eq 1 ]; then
    risky=$((risky + 1))
    note=""
    [ "$never" -eq 1 ] && note="  ⛔ 无 upstream（一次都没推过）"
    printf '  ⚠ %-28s 未提交=%-4s 未推=%-4s%s\n' "${br:-<detached>}" "$dirty" "$ahead" "$note"
    printf '      %s\n' "$wt"
  fi
done < <(git worktree list --porcelain | awk '/^worktree /{print $2}')

printf -- '────────────────────────────────────────────────\n'
if [ "$checked" -eq 0 ]; then
  echo "窗口内没有活动的 agent worktree（金丝雀：总数 ${TOTAL_WT} ⇒ 遍历本身是好的）"
  exit 0
fi
if [ "$risky" -eq 0 ]; then
  echo "✅ ${checked} 个在跑 worktree 全部已落盘（金丝雀：总数 ${TOTAL_WT}）"
  exit 0
fi
echo "⛔ ${risky}/${checked} 个 worktree 有产出悬空 —— 容器一重启就没了。"
echo "   处置：给这些 dev 发一条『立刻 git add -A && git commit && git push -u origin HEAD:refs/heads/<branch>』，"
echo "   不许等他们把测试跑绿。推旁支零风险，它只决定『落没落盘』，不决定『能不能并线』。"
exit 1
