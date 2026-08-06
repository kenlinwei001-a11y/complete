#!/usr/bin/env bash
# task-probe.sh · 后台任务健康探针（铁律 3 的执行体）
#
# 由来（2026-08-06 真实事故，一天之内四次）：
#   本会话容器重启 **4 次**，每次都把正在跑的 gate 与后台 dev 全部杀掉。
#   而我（审核方）每次都是**用户问了才去查**——「任务是否被卡死了」这句话被问了 6 次。
#   更早还有一次相反的误判：一个 QueryTask 停在 EXECUTING_AGENT 19 分钟，
#   我差点报「还在算」，实测 token 计数 20 秒一个数没变、CPU 0.5% —— **它早就死了，只是没人宣告**。
#
# 核心判据（**不是「跑了多久」，是「还在不在动」**）：
#   跑了 40 分钟但输出一直在长  = 正常，继续等
#   跑了 8 分钟但输出 8 分钟没动 = 卡死，要干预
#   这两种「时长」完全相反，只看时长必然误判。
#
# 用法：
#   bash scripts/task-probe.sh                    # 探本会话所有已知后台产物
#   bash scripts/task-probe.sh <file> [file...]   # 探指定日志/输出文件
#   SILENT_LIMIT=1800 bash scripts/task-probe.sh  # 自定静默阈值（秒·默认 1800=30min）
#
# 退出码：0 = 全部健康或已确认死亡并给出处置；2 = 存在「进程在但不动」的真卡死（需人工介入）

set -uo pipefail

SILENT_LIMIT="${SILENT_LIMIT:-1800}"     # 静默多久算可疑（秒）
SAMPLE_GAP="${SAMPLE_GAP:-20}"           # 二次采样间隔（秒）——用来区分「慢」与「停」
NOW=$(date +%s)
UP_SEC=$(awk '{print int($1)}' /proc/uptime)

echo "═══ 任务探针 $(date '+%F %H:%M:%S') · 机器已运行 ${UP_SEC}s ═══"

# ── 0. 先判机器：重启会一次性杀光所有后台任务，且现场全是「静默很久」——
#       不先判这一条，会把「集体阵亡」误诊成「集体卡死」，处置方向完全相反。
MACHINE_RESTARTED=0
if [ "$UP_SEC" -lt "$SILENT_LIMIT" ]; then
  MACHINE_RESTARTED=1
  echo "⚠️  机器仅运行 ${UP_SEC}s（< 静默阈值 ${SILENT_LIMIT}s）—— **容器很可能刚重启**。"
  echo "    → 所有后台任务应视为**已阵亡**，不是卡死。处置顺序："
  echo "      ① 先查各 handoff 分支远端有没有东西（git ls-remote）—— 推了的还在，没推的已丢"
  echo "      ② 自己的工作线立刻 commit + push（别再等 gate）"
  echo "      ③ 重派未推送的任务，并在工单里重申「每个可命名单元立刻 push」"
fi

# ── 1. 收集探测目标
TARGETS=("$@")
if [ ${#TARGETS[@]} -eq 0 ]; then
  SESS="${CLAUDE_SESSION_DIR:-}"
  for d in "$SESS" /tmp/claude-*/*/*/tasks /tmp/claude-*/*/*/scratchpad; do
    [ -d "$d" ] || continue
    # 只收**本次 boot 之后**动过的产物：更早的一律是上个容器生命周期的残骸，不是活任务。
    # 首版用 `-mmin -1440`（24h），结果把 21 小时前的陈年日志全报成「💀 阵亡」，
    # 刷了一屏噪音、真实状态反而被淹掉 —— 探针自己变成了假警报源（2026-08-06 实测）。
    while IFS= read -r f; do TARGETS+=("$f"); done < <(find "$d" -maxdepth 1 -type f \( -name '*.output' -o -name '*.log' \) -newermt "@$(( $(date +%s) - UP_SEC ))" 2>/dev/null)
  done
fi
[ ${#TARGETS[@]} -eq 0 ] && { echo "（没找到可探的产物文件；用 bash scripts/task-probe.sh <file> 指定）"; exit 0; }

# ── 2. 第一次采样
declare -A SZ1 MT1
for f in "${TARGETS[@]}"; do
  [ -f "$f" ] || continue
  SZ1["$f"]=$(stat -c%s "$f"); MT1["$f"]=$(stat -c%Y "$f")
done

SUSPECT=()
for f in "${!SZ1[@]}"; do
  silent=$(( NOW - ${MT1[$f]} ))
  [ "$silent" -ge "$SILENT_LIMIT" ] && SUSPECT+=("$f")
done

if [ ${#SUSPECT[@]} -eq 0 ]; then
  echo "✅ 所有目标在 ${SILENT_LIMIT}s 内都有写入 —— 无可疑任务。"
  for f in "${!SZ1[@]}"; do
    printf "   %-52s %8s bytes  静默 %ss\n" "$(basename "$f")" "${SZ1[$f]}" "$(( NOW - ${MT1[$f]} ))"
  done
  exit 0
fi

# ── 3. 对可疑目标做二次采样 —— **这一步是命门**：
#       「静默」可能是「在算一个长步骤」，也可能是「已经不动了」。
#       只有隔一段再看一次，才能把这两者分开。凭一次快照下结论 = 上午那个误判的复现。
echo "⏳ ${#SUSPECT[@]} 个目标静默超阈值，二次采样（${SAMPLE_GAP}s）以区分「慢」与「停」…"
sleep "$SAMPLE_GAP"

RC=0
for f in "${SUSPECT[@]}"; do
  sz2=$(stat -c%s "$f" 2>/dev/null || echo -1)
  name=$(basename "$f")
  silent=$(( $(date +%s) - ${MT1[$f]} ))

  # 该文件对应的进程还在不在？（按文件名里的任务 id / 日志名粗匹配，匹不到就报「无法定位」——不猜）
  key=$(basename "$f" | sed -e 's/\.output$//' -e 's/\.log$//')
  alive=$(ps -eo pid,args --no-headers | grep -F "$key" | grep -v grep | wc -l)

  if [ "$sz2" -gt "${SZ1[$f]}" ]; then
    printf "🟢 %-46s 仍在写入（%s→%s bytes）—— **慢，不是卡死**，继续等\n" "$name" "${SZ1[$f]}" "$sz2"
  elif [ "$MACHINE_RESTARTED" = "1" ]; then
    printf "💀 %-46s 静默 %ss 且机器刚重启 —— **阵亡**，按上方 ①②③ 处置\n" "$name" "$silent"
  elif [ "$alive" -gt 0 ]; then
    printf "🔴 %-46s 静默 %ss 但进程仍在 —— **真卡死**，需人工介入\n" "$name" "$silent"
    echo "     → 别直接 pkill -f '<含本命令字串的模式>'：会把探针自己也匹进去（本会话已自杀 3 次，exit 144）。"
    echo "       用 ps -eo pid,args --no-headers | grep -F '<key>' | grep -v grep 取到确切 pid 再 kill。"
    RC=2
  else
    printf "⚫ %-46s 静默 %ss 且进程已不在 —— 已结束/被杀，查产物与远端分支定性\n" "$name" "$silent"
  fi
done
exit $RC
