#!/usr/bin/env bash
# 装「canonical 分支不许被本地操作挪动」的护栏钩子（铁律 0.6 三级处置 · 2026-08-14 第 3 次复发后建）。
#
# ── 治什么（真实事故，同一天第 3 次同形态）──────────────────────────────────────
# 审核方并行开着**主工作目录**（canonical `claude/inspiring-gates-aqczjg`）与**集成 worktree**
# （`claude/verify-reclaim-6`）。Bash 的 cwd **在回合边界会被重置回主工作目录**，
# 而我按「上一条命令还在 worktree 里」继续敲，于是：
#
#   git merge origin/claude/handoff-wo-befe-b
#     → 在 **canonical 上**执行 → **Fast-forward** → canonical 被快进到一个**没过 gate 的 dev tip**
#
# 当时 `git merge` 退 0、工作区干净、没有任何红字。是我随手 `git log` 才发现 HEAD 不对。
# 万一那一步之后跟着一条 `git push`，一个未复验的 dev 分支就直接进正线了。
#
# 形态（铁律 0.6 句式）：
#   **「我用『上一条命令在 X 目录成功』当作『这一条也在 X 目录』的证据，而前者并不度量后者。」**
#
# 前两次同形态（同日）：
#   ① 用绝对路径编辑 `/home/user/complete/scripts/check-solver-field-seam.mjs`，
#      而 cwd 在集成 worktree ⇒ 改的是 A、跑的是 B，表现为「我改完了它还报同样的错」。
#   ② 主目录与 worktree 各有一份同名门脚本，先合并才编辑（那次侥幸先查了 blob sha）。
#
# ── 为什么是这个机制而不是别的 ────────────────────────────────────────────────
# · **检查清单不算机制** —— CLAUDE.md 自己写着「检查清单是文档，不是机器，所以它一次都没拦住我」。
# · 上一版探针（`scripts/dispatch-deficit.sh` 里的「改错副本」告警）**拦不住这次**：
#   它查的是主目录有没有**未提交改动**，而一次 fast-forward merge 之后主目录是**干净**的。
#   —— 这本身就是一条教训：**机制要对准真实的失败形态，不是对准上一次的失败形态。**
# · `reference-transaction` 钩子（git ≥ 2.28）在**任何** ref 更新时触发，
#   包括 fast-forward merge、reset、branch -f、rebase —— 这些都不触发 pre-commit/pre-merge-commit。
#   它是唯一能覆盖「HEAD 被静默挪动」这一整类的挂载点。
#
# ── 它挡什么、不挡什么（诚实边界）──────────────────────────────────────────────
# 挡：本地任何把 `refs/heads/<CANON>` 挪到别处的操作。
# 不挡：`git fetch` 更新 `refs/remotes/origin/<CANON>`（那是远端投影，不是本地分支）；
#      也不挡 worktree 里对别的分支的一切操作。
# 放行：确需推正线时 `ALLOW_CANON_MOVE=1 git ...` —— 显式、一次性、可在命令行里被看见。
#
# 用法：bash scripts/install-guard-hooks.sh        # 装
#      bash scripts/install-guard-hooks.sh --check # 只验（RC=0 已装且有效 / 1 未装 / 2 工具坏了）
set -uo pipefail

CANON="claude/inspiring-gates-aqczjg"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMON="$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null)" || {
  echo "⛔ 拿不到 git-common-dir ⇒ **工具坏了**，本次什么都没装、也什么都没验。RC=2"; exit 2; }
case "$COMMON" in /*) ;; *) COMMON="$ROOT/$COMMON" ;; esac
HOOK="$COMMON/hooks/reference-transaction"

write_hook() {
  mkdir -p "$(dirname "$HOOK")"
  cat > "$HOOK" <<HOOKEOF
#!/usr/bin/env bash
# 自动生成 —— 改这里没用，改 scripts/install-guard-hooks.sh 后重装。
# 拦「本地把 canonical 分支挪走」。见该脚本头注的事故来历。
set -uo pipefail
[ "\${1:-}" = "prepared" ] || exit 0            # 只在 prepared 阶段拦（此时中止=整个事务回滚）
[ "\${ALLOW_CANON_MOVE:-}" = "1" ] && exit 0    # 显式放行（推正线时用）
CANON_REF="refs/heads/$CANON"
while read -r old new ref; do
  [ "\$ref" = "\$CANON_REF" ] || continue
  [ "\$old" = "\$new" ] && continue
  echo "⛔ 拒绝挪动 canonical 分支 \$CANON_REF" >&2
  echo "   \${old:0:8} → \${new:0:8}" >&2
  echo "   来历：cwd 在回合边界会被重置回主工作目录，于是本该在集成 worktree 跑的" >&2
  echo "         git merge / reset 落在了 canonical 上，且**静默成功**（fast-forward 无红字）。" >&2
  echo "   你大概率想做的是：cd 到集成 worktree 再跑同一条命令。" >&2
  echo "   确需推正线：ALLOW_CANON_MOVE=1 <你的命令>" >&2
  exit 1
done
exit 0
HOOKEOF
  chmod +x "$HOOK"
}

# ── 金丝雀：装完必须**真的**拦得住，且**真的**放得过（双向，缺一不可）────────────
# 单向验证测不出两种坏法：恒放行的钩子=没装，恒拦截的钩子=谁都干不了活。
selftest() {
  local tmp rc_block rc_allow
  tmp="$(mktemp -d)" || { echo "⛔ mktemp 失败 ⇒ 工具坏了。RC=2"; exit 2; }
  # 拿一个**真实存在**的 ref 名做正向样例：钩子只认 refs/heads/<CANON>，用它自己当靶子最诚实。
  # 不真去挪 canonical——用 `git update-ref --stdin` 的 dry 形态不存在，故改测钩子脚本本身。
  local probe="$tmp/probe"
  printf '%s %s %s\n' "1111111111111111111111111111111111111111" "2222222222222222222222222222222222222222" "refs/heads/$CANON" > "$probe"
  bash "$HOOK" prepared < "$probe" >/dev/null 2>&1; rc_block=$?
  ALLOW_CANON_MOVE=1 bash "$HOOK" prepared < "$probe" >/dev/null 2>&1; rc_allow=$?
  # 反向：别的分支必须放过（否则集成 worktree 一步都动不了）
  local other="$tmp/other"
  printf '%s %s %s\n' "1111111111111111111111111111111111111111" "2222222222222222222222222222222222222222" "refs/heads/claude/verify-reclaim-6" > "$other"
  local rc_other; bash "$HOOK" prepared < "$other" >/dev/null 2>&1; rc_other=$?
  # 远端投影必须放过（git fetch 要能更新 origin/<canon>）
  local remote="$tmp/remote"
  printf '%s %s %s\n' "1111111111111111111111111111111111111111" "2222222222222222222222222222222222222222" "refs/remotes/origin/$CANON" > "$remote"
  local rc_remote; bash "$HOOK" prepared < "$remote" >/dev/null 2>&1; rc_remote=$?
  rm -rf "$tmp"
  local bad=()
  [ "$rc_block"  -eq 1 ] || bad+=("挪 canonical 应拦(期望1)，实得 $rc_block")
  [ "$rc_allow"  -eq 0 ] || bad+=("ALLOW_CANON_MOVE=1 应放行(期望0)，实得 $rc_allow")
  [ "$rc_other"  -eq 0 ] || bad+=("挪别的分支应放行(期望0)，实得 $rc_other")
  [ "$rc_remote" -eq 0 ] || bad+=("更新 origin 投影应放行(期望0)，实得 $rc_remote")
  if [ ${#bad[@]} -ne 0 ]; then
    echo "⛔ 钩子金丝雀未全中 ⇒ **护栏是装饰品，不许当它装好了**："
    printf '   · %s\n' "${bad[@]}"
    return 1
  fi
  echo "✅ 钩子金丝雀 4/4 全中（拦 canonical · 放行显式覆盖 · 放行他分支 · 放行远端投影）"
  return 0
}

if [ "${1:-}" = "--check" ]; then
  [ -x "$HOOK" ] || { echo "✗ 护栏未安装：$HOOK 不存在或不可执行。跑 bash scripts/install-guard-hooks.sh"; exit 1; }
  selftest || exit 1
  echo "✅ canonical 护栏已装且有效（$HOOK）"
  exit 0
fi

write_hook
selftest || exit 1
echo "✅ 已装：$HOOK"
echo "   保护 refs/heads/$CANON 不被本地 merge/reset/branch -f/rebase 静默挪走。"
echo "   推正线时：ALLOW_CANON_MOVE=1 git push …"
