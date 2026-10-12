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

# ⚠ 便携性（2026-10-05 实测 · macOS 13 / BSD userland）：
#   机器年龄：Linux 读 /proc/uptime；macOS **没有 /proc**，用 kern.boottime 反算（`awk: can't open file /proc/uptime`）。
#   时刻格式化：GNU 是 `date -d @<epoch>`，BSD 是 `date -r <epoch>`（BSD date **不认 -d**，实测 `illegal option -- d`）。
UP=$(awk '{print int($1)}' /proc/uptime 2>/dev/null)
if [ -z "$UP" ]; then
  # ⚠ 锚 `[ ,{]sec = ` —— 见 task-probe.sh 同处的实测：贪婪 `.*` 会匹到 `usec =`（微秒余数），
  #   取值变成「now − usec ≈ now」⇒ 横幅印「机器已运行 29851023 分钟」（≈57 年）。
  _BOOT=$(sysctl -n kern.boottime 2>/dev/null | sed -n 's/.*[ ,{]sec = \([0-9][0-9]*\).*/\1/p')
  [ -n "$_BOOT" ] && UP=$(( $(date +%s) - _BOOT ))
fi
if [ -n "$UP" ]; then
  _BOOT_AT=$(( $(date +%s) - UP ))
  BOOT_HHMM=$(date -d "@${_BOOT_AT}" '+%H:%M:%S' 2>/dev/null || date -r "${_BOOT_AT}" '+%H:%M:%S' 2>/dev/null || echo "未判定")
  UP_TXT="$((UP/60)) 分钟"
else
  BOOT_HHMM="未判定"; UP_TXT="未判定"
fi
echo "═══ session-resume $(date '+%F %H:%M:%S') · 机器已运行 ${UP_TXT}（boot ${BOOT_HHMM}）═══"

# 进程表：`ps -eo args` + tail -n +2 剥表头（GNU 与 BSD 都成立）。
# ⚠ 原来的 `ps -eo args --no-headers` 是 GNU 写法 ⇒ BSD ps 回 `illegal option -- -`、**一行都不回**
#   ⇒ 下面两个守护判据**恒 false** ⇒ 每次恢复都以为守护死了、去重起（重复 daemon / 第二个 gate）。
ps_args() { ps -eo args 2>/dev/null | tail -n +2; }
# ⚠ 再加一条：剔掉**调用方自己的 argv**（实测 2026-10-05）。`zsh -c "…wo-autosave…"` 这类包装进程的
#   整条命令行里就带着关键字，它既不是本脚本也不是 grep ⇒ `ps_args | grep -q '[w]o-autosave'` **恒真**
#   ⇒「守护已死」被读成「守护在跑」⇒ **该重起的不重起**。剔法与本仓 killby.sh / task-probe.sh 同源：
#   整行含**本脚本自身路径**的（只有本脚本的副本/包装会带它）一律不看。
ps_pure() { ps_args | awk -v self="$0" 'index($0, self) == 0'; }
PS_TOTAL=$(ps_args | wc -l | tr -d ' ')

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
# ⚠ 「取不到远端」不度量「远端没有这个分支」。原写法把 ls-remote 的失败吞成空串，
#   然后印「远端 无 —— 立刻 push」—— 那是句**无法检查却照样断言**的话（远端不可达时它照样说「无」）。
#   实测本机 HTTPS 时通时不通（有一次卡 56 秒才失败），SSH 稳定 ⇒ 判「推没推」请走 SSH 一次性 URL。
REMOTE_RAW=$(git ls-remote origin "$LINE" 2>/dev/null); LS_RC=$?
if [ "$LS_RC" -ne 0 ]; then
  echo "⚠️  取不到远端（git ls-remote 失败 RC=${LS_RC}）—— **未判定**，这不等于「没推过」。"
  echo "   要判「推没推」走 SSH：git ls-remote git@github.com:<owner>/<repo>.git \"$LINE\""
elif [ -z "$REMOTE_RAW" ]; then
  echo "⚠️  远端**确实没有** $LINE 这条分支（ls-remote 成功且回空）—— 本地 $LOCAL 一次都没推过，立刻 push"
else
  REMOTE=$(printf '%s' "$REMOTE_RAW" | cut -c1-7)
  if [ "${LOCAL:0:7}" = "$REMOTE" ]; then
    echo "✓ 工作线已推：$LOCAL == origin/$LINE"
  else
    # ⚠ CJK 吞变量名（2026-10-05 实测）：变量名后面**直接**跟全角括号时，那半个全角被并进变量名 ⇒ `set -u` 下
    #   `REMOTE…: unbound variable` ⇒ **脚本在这一行整个中止（RC=1）**，后面的 autosave/gate 恢复全没跑。
    #   只在本分支（本地≠远端）触发 —— 而那恰是最常见的一态。含 CJK 处一律写 ${VAR}。
    echo "⚠️  本地 ${LOCAL} ≠ 远端 ${REMOTE}（origin/${LINE}）—— **立刻 push**（push 与过 gate 是两回事：推旁支零风险）"
  fi
fi

# ③ handoff 分支存活盘点：推了的还在，没推的已随重启归零。
echo "── handoff 分支（推了的才活着）──"
# ⚠ 「一条都没列出来」有两种成因，处置相反：远端不可达 / 真的没存活分支。
#   原写法 `git ls-remote --heads origin 2>/dev/null | grep …` 把失败吞成空串 ⇒
#   远端一挂就印「一条都没有」——那是句**无法检查却照样断言**的话（铁律 0.6 句式）。
#   故先取 RC，再看内容；RC≠0 一律印「未判定」。
HEADS_RAW=$(git ls-remote --heads origin 2>/dev/null); HEADS_RC=$?
if [ "$HEADS_RC" -ne 0 ]; then
  echo "   ⚠️ 取不到远端分支列表（ls-remote 失败 RC=${HEADS_RC}）—— **未判定**："
  echo "      这不等于「没有存活的分支」。要判存活请走 SSH："
  echo "      git ls-remote --heads git@github.com:<owner>/<repo>.git"
else
  printf '%s\n' "$HEADS_RAW" | grep -E "sandbox-(d2|e4|f4)|slot-harvest|coord-terminal|base-unify|fix-llm|decision-info" | while read -r sha ref; do
    printf "   %s  %s\n" "${sha:0:8}" "${ref#refs/heads/claude/}"
  done
  # 金丝雀：ls-remote 成功时分支总数必然远大于 0；为 0 说明这次枚举是空的（工具坏了），
  # 与「那批 handoff 分支都没了」在屏上长得一样，必须区分。
  HEADS_N=$(printf '%s\n' "$HEADS_RAW" | grep -c . || true)
  if [ "${HEADS_N:-0}" -eq 0 ]; then
    echo "   ⛔ 远端分支枚举到 0 条（ls-remote 成功但回空）—— **工具读到了空表**，本节结论作废"
  else
    echo "   （金丝雀：远端共 ${HEADS_N} 条分支 ⇒ 这次枚举是活的）"
  fi
fi

# ④ autosave 守护：重启必死，必须重起（它才是"重启变廉价"的主力）。
if [ "${PS_TOTAL:-0}" -lt 2 ]; then
  echo "⛔ 进程表只读到 ${PS_TOTAL:-0} 行 ⇒ autosave 在不在跑**未判定**。"
  echo "   本节**不重起**守护 —— 在「不知道」时起第二个 daemon 比不起更坏（两个守护抢同一个心跳文件）。"
elif ps_pure | grep -q '[w]o-autosave'; then
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
elif [ "${PS_TOTAL:-0}" -lt 2 ]; then
  echo "· 进程表只读到 ${PS_TOTAL:-0} 行 ⇒ gate 在不在跑**未判定**，本脚本不擅自起第二个（白烧一次 build+40 分钟）"
elif ps_pure | grep -q '[g]ate\.sh'; then
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
echo "  用 ps -eo pid,args | tail -n +2 | grep -F '<key>' | grep -v grep 取确切 pid"
echo "· in-session cron 随容器死，醒来记得 CronList 确认；空了就重建"
