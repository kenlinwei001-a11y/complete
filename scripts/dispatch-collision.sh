#!/usr/bin/env bash
# dispatch-collision.sh —— 派单那一刻问一句：这些文件，别的未并分支是不是已经在改了？
#
# 来历（2026-09-18，真实事故）：
#   我派了一张「让沙盘建会话读真实值」的单，前提是「前端今天自己 hash 编快照」。
#   那个前提对 canonical 成立 —— 我核过。但 `origin/claude/handoff-real-cells` 上
#   `resolveTick0World` 已经把这件事做完了（edgeActiveModel.ts:530，注释原文
#   「它不该再是默认路径」）。整张单的前端半是在重造一个已存在的东西。
#
#   形态（铁律 0.6 句式）：
#     「我用『canonical 上没有这个实现』当作『这件事没人做过』的证据，
#       而前者并不度量后者 —— 活可能已经做完，躺在一条未并入的分支上。」
#
# 与 check-crossbranch-reinvent.mjs 的分工（别混，两个都要）：
#   那一个：判据是「**我已经写出来的**导出符号」在别的分支存不存在 ⇒ 触发点在**提交时**。
#   本  个：判据是「**我准备去改的文件**」别的分支动没动 ⇒ 触发点在**派单时**。
#   派单那一刻我一行代码都没写，符号名还不存在，所以那一个**结构上抓不到**这类。
#
# 用法：
#   bash scripts/dispatch-collision.sh apps/datacore/src/app.ts apps/frontend-shell/src/views/sim/SandboxView.tsx
#   bash scripts/dispatch-collision.sh --dir apps/frontend-shell/src/views/sim     # 整个目录
#
# RC：有碰撞=1，无碰撞=0，工具自身有问题=2（⛔ 不许把 2 当成 0 读）

set -uo pipefail
CANON="${CANON:-origin/claude/inspiring-gates-aqczjg}"

[ $# -eq 0 ] && { echo "用法: $0 <file|--dir <path>> [more...]" >&2; exit 2; }

MODE=files
if [ "$1" = "--dir" ]; then MODE=dir; shift; fi
[ $# -eq 0 ] && { echo "⛔ --dir 后面要跟路径" >&2; exit 2; }
TARGETS=("$@")

BASE=$(git rev-parse "$CANON" 2>/dev/null) || {
  echo "⛔ 取不到基线 $CANON —— 先 git fetch origin" >&2; exit 2; }

# ── 金丝雀①：分支枚举不能是空的 ────────────────────────────────
# 报「0 条碰撞」有两种可能：真没人碰，或者我的分支遍历坏了。
# 不打印这个数，屏上这两种情况长得一模一样。
mapfile -t ALL < <(git for-each-ref --format='%(refname:short) %(objectname)' 'refs/remotes/origin/claude/handoff-*')
TOTAL=${#ALL[@]}
if [ "$TOTAL" -eq 0 ]; then
  echo "⛔ 工具坏了：一条 handoff 远端分支都枚举不到（refs/remotes/origin/claude/handoff-*）" >&2
  echo "   ⇒ 这不是「没有碰撞」，是没查成。先 git fetch origin。" >&2
  exit 2
fi

# ── 金丝雀②：目标路径在基线上得真的存在 ──────────────────────
# 路径写错（拼错 / 少一层目录）也会得到「0 条碰撞」这个否定结论。
if [ "$MODE" = files ]; then
  for f in "${TARGETS[@]}"; do
    git cat-file -e "$BASE:$f" 2>/dev/null || \
      echo "  ⚠ 基线上不存在此路径：$f（新建文件则正常；拼错的话下面的『无碰撞』不可信）"
  done
fi

echo "基线 $CANON @${BASE:0:8} · 远端 handoff 分支 $TOTAL 条"
if [ "$MODE" = dir ]; then echo "目标目录：${TARGETS[*]}"; else echo "目标文件：${#TARGETS[@]} 个"; fi
echo "────────────────────────────────────────────────"

HITS=0; SCANNED=0
for entry in "${ALL[@]}"; do
  b="${entry%% *}"; h="${entry##* }"
  # 已并入的跳过：它的内容已经在基线里，不构成「另一处实现」
  git merge-base --is-ancestor "$h" "$BASE" 2>/dev/null && continue
  mb=$(git merge-base "$BASE" "$h" 2>/dev/null) || continue
  SCANNED=$((SCANNED+1))

  if [ "$MODE" = dir ]; then
    touched=$(git diff --name-only "$mb" "$h" -- "${TARGETS[@]}" 2>/dev/null)
  else
    touched=$(git diff --name-only "$mb" "$h" -- "${TARGETS[@]}" 2>/dev/null)
  fi
  [ -z "$touched" ] && continue

  HITS=$((HITS+1))
  n=$(printf '%s\n' "$touched" | wc -l)
  stat=$(git diff --shortstat "$mb" "$h" -- "${TARGETS[@]}" 2>/dev/null | sed 's/^ *//')
  when=$(git log -1 --format=%cr "$h" 2>/dev/null)
  printf '  ⚠ %-42s %s\n' "${b#origin/claude/}" "$when"
  printf '      %s 个目标文件 · %s\n' "$n" "${stat:-?}"
  printf '%s\n' "$touched" | sed 's/^/        /' | head -6
done

echo "────────────────────────────────────────────────"
echo "扫了 $SCANNED 条未并分支（共 $TOTAL 条，其余已并入基线）"

if [ "$HITS" -gt 0 ]; then
  cat <<EOF
⛔ $HITS 条未并分支已经在改这些文件。

派单前先做这两件，⛔ 不许跳过：
  1. 逐条看它们**做到了什么程度** —— 可能整件事已经做完了，
     `git show <branch>:<file>` 读原文，别只看分支名猜。
  2. 若已做完 ⇒ **改派成「复验 + 收编」，不是「重做」**；
     若做了一半 ⇒ 派单里写明「在 <branch> 的基础上续」，并把它的 tip 给 dev。

⚠ 本条抓的是「重造」，不是「冲突」。冲突会红、看得见；
  重造不会红 —— 两个都能跑、都能过门，然后仓里多出第二套真相源。
EOF
  exit 1
fi

echo "✅ 无未并分支在改这些文件 —— 可以按新单派。"
exit 0
