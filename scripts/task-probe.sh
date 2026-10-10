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
#        ⚠ 2 亦用于「**探针自己坏了**」——两者都需要人工介入，屏上会写明是哪一种。
#
# ══ 便携性（2026-10-05 实测：本机 macOS 13 · BSD ps · 系统 bash 3.2）══════════
# 本脚本原先是「只在 GNU 下成立」的写法，在 mac 上**静默失效**过四处，全是实测读数：
#   ① `ps -eo pid,args --no-headers` ⇒ BSD ps 回 `illegal option -- -`，**一行进程都不回**（RC=1）
#      ⇒ alive 恒 0，而 0 被读成「没有在跑」。「我没找到」与「它不存在」是两个命题。
#   ② `declare -A`（关联数组）⇒ bash 3.2 没这个内建 ⇒ SZ1/MT1 一个元素都没有 ⇒ SUSPECT 恒空
#      ⇒ 对着 2020 年就没写过的文件印「✅ 所有目标都有写入」（实测 false-green，比 ① 更坏）。
#   ③ `stat -c%s` / `-c%Y` ⇒ BSD stat 不认 `-c` ⇒ 大小与时间戳读不到。
#   ④ `find -newermt "@<epoch>"` ⇒ BSD find 不认 `@epoch`（`Can't parse date/time`）⇒ 目标枚举恒空。
# 修法一律**双平台成立**，不是把 mac 写法换成另一个 mac 写法：
#   剥表头用 `tail -n +2`（`dispatch-deficit.sh:75` 的 awk 剥表头是同一思路的既有先例）；
#   关联数组换平行索引数组；stat 双语法回退；时间窗改用 `-mmin`（GNU/BSD 都成立）。
set -uo pipefail

# 剥表头取进程表：`ps -eo <fmt>` + `tail -n +2`（GNU 与 BSD 都成立）
ps_lines() { ps -eo "$1" 2>/dev/null | tail -n +2; }

# 文件大小 / mtime：GNU 用 `-c`，BSD/macOS 用 `-f`。两种都失败 ⇒ 返回空，由调用方判「探针坏了」。
f_size()  { stat -c%s "$1" 2>/dev/null || stat -f%z "$1" 2>/dev/null; }
f_mtime() { stat -c%Y "$1" 2>/dev/null || stat -f%m "$1" 2>/dev/null; }

SILENT_LIMIT="${SILENT_LIMIT:-1800}"     # 静默多久算可疑（秒）
SAMPLE_GAP="${SAMPLE_GAP:-20}"           # 二次采样间隔（秒）——用来区分「慢」与「停」
NOW=$(date +%s)

# 机器运行时长：Linux 读 /proc/uptime；macOS **没有 /proc**，用 kern.boottime 反算。
UP_SEC=$(awk '{print int($1)}' /proc/uptime 2>/dev/null)
if [ -z "$UP_SEC" ]; then
  # ⚠ 正则必须锚 `[ ,{]sec = `：kern.boottime 原文是 `{ sec = <epoch>, usec = <usec> } ...`，
  #   写成 `.*sec = \([0-9]*\)` 时**贪婪的 `.*` 会去匹 `usec =`**（`usec` 里含 `sec`）⇒ 取到的是 **usec**（微秒余数）。
  #   实测（2026-10-05）：`_BOOT=109907` ⇒ `UP_SEC ≈ now`（≈1791061815，不是运行时长）⇒ 两个后果都坏：
  #     ① 横幅印「机器已运行 29851030 分钟」（≈57 年）；② 下面的 `-mmin -$((UP_SEC/60+1))` 变成**三千万分钟窗口**
  #        ⇒ 时间闸形同虚设，21 小时前的陈旧日志又会被探成「任务」（正是本文件注释里说已经修掉的那类噪音）。
  _BOOT=$(sysctl -n kern.boottime 2>/dev/null | sed -n 's/.*[ ,{]sec = \([0-9][0-9]*\).*/\1/p')
  [ -n "$_BOOT" ] && UP_SEC=$(( NOW - _BOOT ))
fi
[ -z "$UP_SEC" ] && echo "⚠️  读不到机器运行时长（/proc/uptime 与 kern.boottime 都不行）—— **机器重启判据未判定**，本节不据此断言任何任务「阵亡」。"

# ── 金丝雀⓪：进程表读得到吗？────────────────────────────────────────────
# 报「没有在跑」是个**否定结论**。进程表读空时，它和「真的没有在跑」在屏上长得一模一样，
# 所以先自证读得到，再据它下任何「零」结论。
PS_TOTAL=$(ps_lines pid,args | wc -l | tr -d ' ')
if [ "${PS_TOTAL:-0}" -lt 2 ]; then
  echo "⛔ 探针自己坏了：ps 表只读到 ${PS_TOTAL:-0} 行。"
  echo "   ⇒ 这不是「没有进程在跑」，是**没查成**。此刻任何「进程已结束」的结论都不成立。"
  exit 2
fi

echo "═══ 任务探针 $(date '+%F %H:%M:%S') · 机器已运行 ${UP_SEC:-未判定}s · 进程表 ${PS_TOTAL} 行 ═══"

# ── 0. 先判机器：重启会一次性杀光所有后台任务，且现场全是「静默很久」——
#       不先判这一条，会把「集体阵亡」误诊成「集体卡死」，处置方向完全相反。
MACHINE_RESTARTED=0
if [ -z "$UP_SEC" ]; then
  :  # 未判定：不设 MACHINE_RESTARTED —— 缺一个数时**不硬判生死**（本文件第 91–95 行的同一条纪律）
elif [ "$UP_SEC" -lt "$SILENT_LIMIT" ]; then
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
    # 时间窗：原写法 `-newermt "@<epoch>"` 在 BSD find 上是 `Can't parse date/time: @...`（实测），
    # 配上 2>/dev/null 就是**安静的空枚举** ⇒ 每次都报「没找到可探的产物」。改用 `-mmin`（GNU/BSD 都成立）。
    SINCE_MIN=$(( ${UP_SEC:-86400} / 60 + 1 ))
    while IFS= read -r f; do TARGETS+=("$f"); done < <(find "$d" -maxdepth 1 -type f \( -name '*.output' -o -name '*.log' \) -mmin "-${SINCE_MIN}" 2>/dev/null)
  done
fi
[ ${#TARGETS[@]} -eq 0 ] && { echo "（没找到可探的产物文件；用 bash scripts/task-probe.sh <file> 指定）"; exit 0; }

# ── 2. 第一次采样
# ⚠ 原来是 `declare -A SZ1 MT1`（关联数组）。本机系统 bash 是 **3.2**，没有关联数组：
#   `declare -A` 报 invalid option，随后按**文件名**当下标的赋值全部 `syntax error: operand expected`
#   ⇒ 两个表各一个元素都没有 ⇒ SUSPECT 恒空 ⇒ 对着 2020 年起就没动过的文件印「✅ 都有写入」。
#   改用 bash 3.2 可用的**平行索引数组**（语义等价）。
FILES=(); SZ1=(); MT1=()
for f in "${TARGETS[@]}"; do
  [ -f "$f" ] || continue
  _sz=$(f_size "$f"); _mt=$(f_mtime "$f")
  if [ -z "$_sz" ] || [ -z "$_mt" ]; then
    echo "⛔ 探针自己坏了：读不到 $(basename "$f") 的大小/时间戳（stat 的 -c 与 -f 两种语法都失败）。"
    echo "   ⇒ 不许据此印「健康」—— 读不到数与「没有异常」在屏上长得一模一样。"
    exit 2
  fi
  FILES+=("$f"); SZ1+=("$_sz"); MT1+=("$_mt")
done

# ⚠ 假绿口（2026-10-05 实测）：`task-probe.sh <写错的路径>` 时上面那行 `[ -f "$f" ] || continue` 把
#   不存在的目标全跳过 ⇒ FILES 空 ⇒ SUSPECT 空 ⇒ 印「✅ 所有目标在 Ns 内都有写入 —— 无可疑任务」+ RC=0。
#   路径写错与「真的一切健康」在屏上一模一样 —— 又是否定结论冒充肯定结论。
if [ ${#FILES[@]} -eq 0 ]; then
  echo "⛔ 一个可探的目标都没有：你给的 ${#TARGETS[@]} 个路径**都不存在**（或都不可读）。"
  echo "   ⇒ 这不是「全部健康」，是**没探成**。路径拼错时，本探针的 ✅ 一个字都不作数。"
  exit 2
fi

SUSPECT=()   # 存**下标**（不是文件名），下面靠它回查 FILES/SZ1/MT1
for i in "${!FILES[@]}"; do
  silent=$(( NOW - ${MT1[$i]} ))
  [ "$silent" -ge "$SILENT_LIMIT" ] && SUSPECT+=("$i")
done

if [ ${#SUSPECT[@]} -eq 0 ]; then
  echo "✅ 所有目标在 ${SILENT_LIMIT}s 内都有写入 —— 无可疑任务。"
  for i in "${!FILES[@]}"; do
    printf "   %-52s %8s bytes  静默 %ss\n" "$(basename "${FILES[$i]}")" "${SZ1[$i]}" "$(( NOW - ${MT1[$i]} ))"
  done
  exit 0
fi

# ── 3. 对可疑目标做二次采样 —— **这一步是命门**：
#       「静默」可能是「在算一个长步骤」，也可能是「已经不动了」。
#       只有隔一段再看一次，才能把这两者分开。凭一次快照下结论 = 上午那个误判的复现。
echo "⏳ ${#SUSPECT[@]} 个目标静默超阈值，二次采样（${SAMPLE_GAP}s）以区分「慢」与「停」…"
sleep "$SAMPLE_GAP"

RC=0
for i in "${SUSPECT[@]}"; do
  f="${FILES[$i]}"
  sz2=$(f_size "$f"); [ -z "$sz2" ] && sz2=-1
  name=$(basename "$f")
  silent=$(( $(date +%s) - ${MT1[$i]} ))

  # 该文件对应的进程还在不在？
  # ⚠️ 首版拿日志文件名去 grep 进程命令行，然后据此断言「进程已不在」——**那是句无法检查却照样断言的话**：
  #    `gate-wave4f.log` 这个串压根不会出现在 `bash scripts/gate.sh` 的 args 里，于是每一次长跑 gate
  #    都被报成「已结束/被杀」。2026-08-06 实测：gate 已跑 33 分钟、vitest 在 90–100% CPU，探针却报它死了。
  #    （与本仓 execute-plan 裸 catch 报「未接入 provider」同族：断言性的句子，从不检查它所断言的条件。）
  # 修法：匹不到就诚实说**匹不到**，并用「系统里有没有高 CPU 的 node」做旁证，绝不硬判生死。
  key=$(basename "$f" | sed -e 's/\.output$//' -e 's/\.log$//')
  # ⚠ 自匹：`bash task-probe.sh <file>` 时，**探针自己的命令行里就有那个路径**（路径含 key）
  #   ⇒ 不剔掉就把自己数进去，「有进程在跑」恒为真（实测：对着一个没有对应进程的目标也印 🔴）。
  #   ⛔ 只按 `$$`/`$PPID` 剔**不够** —— 实测：两个**子 shell 继承同一份 argv 而 pid 既非 $$ 也非 $PPID**，
  #     它们照样被数进去（同一 key 数出 alive=2）。故再加一条：整行含本脚本自身路径的一律剔。
  alive=$(ps_lines pid,args | awk -v me="$$" -v pa="$PPID" -v self="$0" \
            '$1 != me && $1 != pa && index($0, self) == 0' \
          | grep -F -- "$key" | grep -v grep | wc -l | tr -d ' ')
  busy=$(ps_lines pcpu,comm | awk '$2=="node" && $1>20' | wc -l | tr -d ' ')
  # ⚠ `grep -v grep` 是**自滤**：key 里若含 "grep" 字样，真命中会被连着滤掉 ⇒
  #   「探针坏了」与「真没有」在屏上又长得一样。真碰上就显式告警，不静默。
  case "$key" in *grep*) echo "     ⚠ key 含 'grep' 字样 —— 本行 alive 读数被自滤污染，**不可信**";; esac

  if [ "$sz2" -gt "${SZ1[$i]}" ]; then
    printf "🟢 %-46s 仍在写入（%s→%s bytes）—— **慢，不是卡死**，继续等\n" "$name" "${SZ1[$i]}" "$sz2"
  elif [ "$MACHINE_RESTARTED" = "1" ]; then
    printf "💀 %-46s 静默 %ss 且机器刚重启 —— **阵亡**，按上方 ①②③ 处置\n" "$name" "$silent"
  elif [ "$alive" -gt 0 ]; then
    printf "🔴 %-46s 静默 %ss 但进程仍在 —— **真卡死**，需人工介入\n" "$name" "$silent"
    echo "     → 别直接 pkill -f '<含本命令字串的模式>'：会把探针自己也匹进去（本会话已自杀 3 次，exit 144）。"
    echo "       用 ps -eo pid,args | tail -n +2 | grep -F '<key>' | grep -v grep 取到确切 pid 再 kill。"
    RC=2
  elif [ "$busy" -gt 0 ]; then
    printf "🟡 %-46s 静默 %ss，进程名匹不到（**无法定位**，不硬判生死）；但系统里有 %s 个高 CPU node 在跑\n" "$name" "$silent" "$busy"
    echo "     → 长跑 gate 的正常形态就是这样（日志到阶段末才写、命令行不含日志名）。"
    echo "       要定性请直接看：ps -eo pid,etime,args | tail -n +2 | awk '/gate\\.sh/ && !/awk/'"
  else
    printf "⚫ %-46s 静默 %ss · 进程名匹不到 · 系统无高 CPU node —— 大概率已结束/被杀，查产物与远端分支定性\n" "$name" "$silent"
  fi
done
exit $RC
