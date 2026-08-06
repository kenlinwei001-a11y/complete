#!/usr/bin/env bash
# wo-autosave.sh · 后台 dev 产出自动落盘守护（铁律 1 的配套执行体）
#
# 由来（2026-08-06 真实损失）：本会话容器重启 **4 次**。第四次那会儿：
#   · E4 dev —— 死前自己 push 过 → 417 行（含 355 行 SEAM 测试）**全部保住**
#   · D2 dev —— 一次没提交 → **产出归零**
# 同一次重启，两种结局，差别只在「有没有落盘」。
#
# 为什么不是「更频繁地轮询任务状态」：重启是**瞬间**杀进程，轮询再密也只是**更早知道它死了**，
# 工作照样丢。能救工作的只有一件事：**在被杀之前就已经推上去**。
# 所以本脚本不做监控，它做**抢救性落盘**——每 INTERVAL 秒把每个 agent worktree 的
# 未提交改动 commit 成 `autosave(<branch>): <时刻>` 并 push 到该 worktree 自己的分支。
#
# 诚实边界：
#   · autosave commit 是**未经自验的快照**，等同于 wip —— 复验方必须照 wip 对待，
#     不得据此判定交付（本会话已有先例：审核方抢救落盘的 D2/F4 就明写了这一条）。
#   · 它不碰正线（只推 worktree 自己 checkout 的分支），也不会替 dev 写交付说明。
#   · detached HEAD 的 worktree 跳过（没有分支可推，硬造分支会污染命名空间）。
#
# 用法：
#   nohup bash scripts/wo-autosave.sh > /tmp/wo-autosave.log 2>&1 &   # 起守护
#   INTERVAL=60 bash scripts/wo-autosave.sh --once                     # 跑一轮就退（调试/手动抢救）
#   pkill -f wo-autosave                                               # 停（注意：别在含该串的命令里跑 pkill）

set -uo pipefail
INTERVAL="${INTERVAL:-60}"
ROOT="${ROOT:-/home/user/complete}"
ONCE=0
[ "${1:-}" = "--once" ] && ONCE=1

sweep() {
  local now; now=$(date '+%m-%d %H:%M:%S')
  local saved=0 skipped=0
  for wt in "$ROOT"/.claude/worktrees/*/; do
    [ -d "$wt/.git" ] || [ -f "$wt/.git" ] || continue
    local br; br=$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null) || continue
    # detached HEAD：无分支可推，跳过（不硬造分支）
    [ "$br" = "HEAD" ] && { skipped=$((skipped+1)); continue; }
    # 没有未提交改动 → 只确保已提交的部分推上去
    if [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
      git -C "$wt" add -A 2>/dev/null || continue
      git -C "$wt" -c user.name=autosave -c user.email=autosave@local commit -q \
        -m "autosave($br): $now 容器重启防丢快照

**未经 dev 自验·无变异反证·不得据此判定交付**。
由 scripts/wo-autosave.sh 自动落盘：本会话容器已重启 4 次，
未提交的工作会随重启归零（D2 就是这么丢的）。此 commit 只保证
「不白干」，复验一律照 wip 对待。" 2>/dev/null && saved=$((saved+1))
    fi
    # 推：**只推真实 handoff 分支**（claude/*）。
    # 自动生成的 worktree-agent-* 一律只在本地 commit，不推 —— 理由是实测出来的：
    # 本会话四次重启，**磁盘每次都完整存活**（scratchpad/worktree/node_modules 全在），
    # 所以「本地已提交」就已经足够防重启丢失；push 只为防更罕见的掉盘。
    # 无差别推会往远端灌一堆 worktree-agent-* 垃圾分支（我第一版就灌了 14 条）。
    # ⚠️ 那 14 条**至今没删掉**：本环境的 git 代理拒绝分支删除
    #    （`send-pack: unexpected disconnect while reading sideband packet`）。
    #    原注释写的是「已清」——那是句没有检查所断言条件的假话，改此。留作已知债。
    case "$br" in
      claude/*) git -C "$wt" push -q -u origin "HEAD:$br" 2>/dev/null || true ;;
      *) : ;;
    esac
  done
  echo "[$now] autosave 扫描完成：落盘 $saved · 跳过(detached) $skipped"
}

echo "wo-autosave 启动（每 ${INTERVAL}s 扫一次 $ROOT/.claude/worktrees/*）"
while :; do
  sweep
  [ "$ONCE" = "1" ] && break
  sleep "$INTERVAL"
done
