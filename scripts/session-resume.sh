#!/usr/bin/env bash
# session-resume.sh · 容器重启后的**一键恢复**（幂等，随时可重复跑）
#
# 前提认知（这是常态，不是事故）：
#   本会话跑在 Anthropic 托管的一次性沙箱里（Firecracker VM + docker·hostname=vm·IP 192.0.2.2）。
#   **它按设计会被定期回收**——2026-08-06 一天内重启 6 次，与 OOM/磁盘/崩溃全无关系
#   （oom_kill=0 · 磁盘 50% · 卷跨重启存活）。所以正确目标不是「不再重启」，
#   而是「**重启变廉价**」：把损失压到 ≤ 最后一次落盘。
#
# 本脚本存在的理由 —— 打破一个循环依赖：
#   恢复靠我醒着 → 醒着靠 cron → cron 活在容器里 → 容器一重启，恢复机制自己先死。
#   把恢复固化成一条幂等命令后，**无论谁把会话叫醒**（服务端 trigger / 仓主一句话 / 任务通知），
#   一行就能回到可工作状态，不依赖我记得那张七步清单。
#
# 用法：bash scripts/session-resume.sh            # 恢复 + 报告
#       bash scripts/session-resume.sh --no-gate  # 只恢复守护，不起 gate（gate 很重，按需）

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
SCRATCH="${SCRATCH:-/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad}"
LINE="claude/wave4-integration"
NO_GATE=0
[ "${1:-}" = "--no-gate" ] && NO_GATE=1

UP=$(awk '{print int($1)}' /proc/uptime)
echo "═══ session-resume $(date '+%F %H:%M:%S') · 机器已运行 $((UP/60)) 分钟（boot $(date -d "@$(( $(date +%s) - UP ))" '+%H:%M:%S')）═══"

# ① 本地未提交的活儿先落盘 —— 排第一，因为它最容易丢且最不可复原。
if [ -n "$(git status --porcelain)" ]; then
  echo "⚠️  主工作区有未提交改动 —— 先落盘（重启会让它归零）："
  git status --short | head -10
  echo "    → 请人工判断后 commit；本脚本**不替你写 commit message**（那是产出说明，不该自动化）。"
else
  echo "✓ 主工作区干净"
fi

# ② 本地 vs 远端：唯一真正跨重启保证存活的只有远端。
LOCAL=$(git rev-parse --short HEAD)
REMOTE=$(git ls-remote origin "$LINE" 2>/dev/null | cut -c1-7)
if [ "${LOCAL:0:7}" = "$REMOTE" ]; then
  echo "✓ 工作线已推：$LOCAL == origin/$LINE"
else
  echo "⚠️  本地 $LOCAL ≠ 远端 ${REMOTE:-无} —— **立刻 push**（push 与过 gate 是两回事：推旁支零风险）"
fi

# ③ handoff 分支存活盘点：推了的还在，没推的已随重启归零。
echo "── handoff 分支（推了的才活着）──"
git ls-remote --heads origin 2>/dev/null | grep -E "sandbox-(d2|e4|f4)|slot-harvest|coord-terminal|base-unify|fix-llm|decision-info" | while read -r sha ref; do
  printf "   %s  %s\n" "${sha:0:8}" "${ref#refs/heads/claude/}"
done

# ④ autosave 守护：重启必死，必须重起（它才是"重启变廉价"的主力）。
if ps -eo args --no-headers | grep -q '[w]o-autosave'; then
  echo "✓ autosave 守护在跑 · 心跳 $(cat /tmp/wo-autosave.alive 2>/dev/null || echo "尚无")"
else
  INTERVAL=60 nohup bash scripts/wo-autosave.sh > /tmp/wo-autosave.log 2>&1 &
  sleep 2
  echo "↻ autosave 守护已重起（原进程不在）"
fi

# ⑤ gate：重启必死且不会自己回来。gate 约 40 分钟，而回收最短 ~15 分钟空闲就发生过 ——
#    所以**起了 gate 就别空等**，否则它永远跑不完（这条是实测出来的，不是保守估计）。
if [ "$NO_GATE" = "1" ]; then
  echo "· 按 --no-gate 跳过 gate"
elif ps -eo args --no-headers | grep -q '[g]ate\.sh'; then
  echo "✓ gate 已在跑"
else
  echo "↻ 重起 gate（build → gate）…"
  if out=$(pnpm -r build 2>&1); then
    LOG="$SCRATCH/gate-$(date +%H%M).log"
    nohup bash scripts/gate.sh > "$LOG" 2>&1 &
    echo "   gate 起了 → $LOG"
  else
    echo "   ✗ build 失败，gate 未起："
    echo "$out" | grep -E "error TS" | head -5
  fi
fi

echo "── 提醒 ──"
echo "· 起了 gate 就去干别的（复验 dev / 推欠账）——空等 = 会话空闲 = 被回收 = gate 白跑"
echo "· 杀进程别用 pkill -f '<含本命令的串>'（会自匹→自杀 exit 144，本会话已 3 次）；"
echo "  用 ps -eo pid,args --no-headers | grep -F '<key>' | grep -v grep 取确切 pid"
echo "· in-session cron 随容器死，醒来记得 CronList 确认；空了就重建"
