#!/usr/bin/env bash
# 门 · 调度失衡探针 —— **欠派**与**超派**两个方向都报。
#
# ## 为什么有这个脚本
#
# `CLAUDE.md` 铁律 2 里写着「每次要写『我先去测/先看看/等一下』之前跑它」，
# 并给了它的路径 —— **而仓里一直没有这个文件**。
# 也就是说，这条被当作「机制」写进铁律的东西，本身只是一句散文。
# 这正是本仓反复记的那句话，这次落在制定规则的人自己头上：
#
#   > **写在注释里的纪律不是机制。写在文档里的也不是。**
#   > 机制的判据只有一条：**下次同样的错发生时，是机器先说话，不是人先想起来。**
#
# ## 两个方向，两次真实事故
#
# | 方向 | 病 | 实测 |
# |---|---|---|
# | **欠派** | 我拿「我正在测量」当作「不能派活」的理由 | 2026-08-09：13 小时里并发只挂 1–3 个 agent，而轻/中画像本可挂 8–10 |
# | **超派** | 我按「agent 个数」派，而真实约束是「同时跑 vitest 的个数」 | 2026-08-06 欠账 #102：6 agent 全是重画像 ⇒ 载荷 35，自伤 |
#
# 2026-08-11 超派**第二次**发生：8 个 agent、**16 个 vitest 进程**、载荷 21，
# 把自己要跑的集成门挤到跑不动。按铁律 0.6 三级处置，第 2 次必须当场建机制 —— 就是本脚本。
#
# 判据要点：**别数 agent，数 vitest。** 「6 个 agent」不是问题，「6 个都是重画像」才是。
# 同一个数字（agent 数）在两种画像下含义相反，拿它当约束必然误判。
#
# 退出码（本仓统一三分）：0 = 均衡；1 = 失衡（欠派或超派）；2 = **工具自己坏了**（不许据此说「调度正常」）。
# 2026-08-18 记账（macOS 回退链）：CORES 走 nproc→`sysctl -n hw.ncpu`→0；LOAD 走 /proc/loadavg→`sysctl -n vm.loadavg`（输出 `{ a b c }` 取第 1 数）→"?"/0 兜底语义不变；ps 去 `--no-headers` 改 `=` 空表头（GNU/BSD 通用）；队列②远端可用 DD_REMOTE 覆盖（默认 origin 不变）。
set -uo pipefail

CORES=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 0)
if [ "$CORES" -le 0 ]; then
  echo "⛔ 取不到核数 ⇒ 工具坏了，本次结论作废（不许读作「调度正常」）" >&2
  exit 2
fi

# 单一实现：金丝雀与主逻辑共用它，不许各抄一份 ps 管道。
# 抄了就是装饰品 —— 改主逻辑时金丝雀拿旧的去测、照样绿（本仓实测过这个形态）。
#
# ⚠ **必须排除自己这条进程链**，否则探针会匹配到「提问的人自己」。
# 病历（2026-08-11 实测，就发生在本脚本的变异反证里）：
#   我把金丝雀的匹配串改成一个不可能存在的词去验它会不会开火，
#   结果金丝雀**照样通过** —— 因为那个词就写在**我这条测试命令的命令行里**，
#   `ps -eo args` 把它数了进去。于是「金丝雀 ✓✓（双向）」是真的，只不过它数到的是自己。
#   更阴的是这个污染**时有时无**：老写法尾巴上挂了 `grep -v grep`，
#   我的外层命令行**恰好**含 "grep" 时就被顺手滤掉、探针看起来正常；不含时就中招。
#   同一条命令跑两次给出相反结果，而两次都不报错。
# 这与铁律 1 判据 #4「杀进程别用会自匹的模式」（`pkill -f` 自杀 3 次）是同一个病，
# 只是这次落在**金丝雀**上而不是 kill 上 —— 后果更坏：自匹的 kill 会当场自杀，
# 自匹的金丝雀只会**安静地永远通过**。
#
# 判据要落在 **PID** 上，不能只靠字串排除：把自己、父进程、以及它们的整条祖先链剔掉。
#
# ⚠ 第二层自匹（比第一层更阴，实测中招）：**别把待搜串放进 awk 的 argv**。
#   `awk -v pat="vitest" …` 会让 awk 自己的命令行含 "vitest"，而 `ps -eo args` 正在读命令行
#   ⇒ 匹配器匹配到了它自己。用**环境变量**传（env 不出现在 `ps -eo args` 里）即可根除。
count_matching() {
  local self=$$ ppid
  ppid=$(ps -o ppid= -p $$ 2>/dev/null | tr -d ' ')
  DD_PAT="$1" DD_ME="$self" DD_PAR="${ppid:-0}" \
    ps -eo pid= -o ppid= -o args= 2>/dev/null | DD_PAT="$1" DD_ME="$self" DD_PAR="${ppid:-0}" awk '
    BEGIN { pat = ENVIRON["DD_PAT"]; me = ENVIRON["DD_ME"]; par = ENVIRON["DD_PAR"] }
    $1 == me || $1 == par || $2 == me || $2 == par { next }   # 自己 / 父 / 子 / 兄弟，全剔
    index($0, pat) > 0 { n++ }
    END { print n + 0 }
  '
}

# ── 金丝雀：**双向**自证 ps 管道是活的，再据它下任何「零」结论 ──────────────────
#
# 单向金丝雀在这里救不了命：探针现在按 PID 剔掉了自己，所以「本脚本自己的名字」不再可用
# （用了必然数到 0，那是**假红**）。而随便找个存在的词能命中，只证明命令能跑，
# 不证明判据对（SOP §4.1：金丝雀必须选**只可能存在于我要测的那个维度里**的对象）。
#
# 故两边都咬 —— **缺任一边都会漏掉一半坏法**（两边我都实测踩过）：
#   ① **必中**：拿 PID 1 的命令行当样例喂给 `count_matching`，它**必须**数到 ≥1。
#      选 PID 1 是因为它满足两个硬条件：一定存在、且**一定不是我或我的父进程**
#      （所以不会被 PID 剔除逻辑误杀）。
#      ⚠ 只有负向金丝雀救不了命：把 `index($0,pat)` 改成恒假时，
#        「不可能串命中 0 次」**照样通过** —— 分不清「正确地返回 0」和「永远返回 0」。实测中招。
#   ② **必不中**：一个不可能存在的串必须数到 0。否则说明 index 恒真、什么都在「命中」，
#      那种坏法会让所有超派判据同时误报。
CANARY_ALIVE=$(ps -eo pid= -o ppid= -o args= 2>/dev/null | wc -l | tr -d ' ')
PID1=$(ps -p 1 -o args= 2>/dev/null | awk '{print $1}')
CANARY_HIT=$(count_matching "${PID1:-__no_pid1__}")
CANARY_NULL=$(count_matching "zzq-impossible-$$-canary-must-be-zero")
if [ "${CANARY_ALIVE:-0}" -lt 5 ] || [ "${CANARY_HIT:-0}" -lt 1 ] || [ "${CANARY_NULL:-1}" -ne 0 ]; then
  echo "⛔ 金丝雀不中 ⇒ ps 管道坏了：" >&2
  echo "   进程表 ${CANARY_ALIVE} 行（需 ≥5） · 必中样例「${PID1:-?}」命中 ${CANARY_HIT} 次（需 ≥1） · 不可能串命中 ${CANARY_NULL} 次（需 =0）" >&2
  echo "   本次结论作废 —— **不许**读作「没有 vitest 在跑 / 调度正常」。" >&2
  exit 2
fi

VITEST=$(count_matching "vitest")
# datacore 的 vitest 才是重画像（4 核机上的真红线）。按工作目录判，不按 agent 身份判。
HEAVY=$(ps -eo args= 2>/dev/null | grep -F 'vitest' | grep -v -F 'grep' | grep -c -F 'datacore' || true)
HEAVY=${HEAVY:-0}
LOAD=$(awk '{printf "%.1f", $1}' /proc/loadavg 2>/dev/null || sysctl -n vm.loadavg 2>/dev/null | awk '{gsub(/[{}]/, ""); printf "%.1f", $1}' || echo "?")
LOAD_INT=$(awk '{print int($1)}' /proc/loadavg 2>/dev/null || sysctl -n vm.loadavg 2>/dev/null | awk '{gsub(/[{}]/, ""); print int($1)}' || echo 0)

# 画像上限（CLAUDE.md 铁律 2 判据 2）
CAP_HEAVY=1
CAP_LOAD=$(( CORES * 2 ))

# 诚实位**现算**，不写死条数 —— 写死是假绿第 11 形态：加了断言而计数不动，
# 屏上照旧「N/N 全中」，读者以为覆盖没变。这里直接把三个实测值打出来，读者自己能核。
echo "调度探针 · ${CORES} 核 · 载荷 ${LOAD} · vitest 进程 ${VITEST}（其中 datacore=${HEAVY}）"
echo "   金丝雀 3/3：进程表 ${CANARY_ALIVE} 行 · 必中样例「${PID1}」×${CANARY_HIT} · 不可能串 ×${CANARY_NULL}"

rc=0

# ── 超派 ───────────────────────────────────────────────────────────────────────
if [ "$HEAVY" -gt "$CAP_HEAVY" ]; then
  echo "🔴 **超派**：datacore vitest 并发 ${HEAVY} > 上限 ${CAP_HEAVY}。"
  echo "   重画像 ≤1，且自己要起组合门时为 0。现在起门会被挤到跑不动，且拿到的绿是运气。"
  rc=1
fi
if [ "$LOAD_INT" -gt "$CAP_LOAD" ]; then
  echo "🔴 **超派**：载荷 ${LOAD} > ${CAP_LOAD}（核数×2）。"
  echo "   此时**不要**再起 vitest：挂墙钟的断言会给你假红，你会去查一个不存在的回归。"
  rc=1
fi

# ── 欠派 ───────────────────────────────────────────────────────────────────────
# 判据不是「agent 少」，是「机器闲着而队列非空」。队列长度由调用方传入（未传则跳过该判据，
# 并**明说跳过了** —— 静默跳过会让报告读起来像全覆盖）。
# ⚠️ **2026-08-15 改：队列长度改为自算，不再依赖调用方传参**（仓主要求
#    「少于 4 个 agent 就触发检测待派/待复验/待写WO 的清单，然后自动推进」）。
#    旧版洞在这里：不传就打一句「本次未评估」然后 **rc 保持 0** ——
#    读起来像「调度正常」，而它其实什么都没查。
#    形态：**「我用『探针退 0』当作『不欠派』的证据，而前者并不度量后者。」**
#    自算三个队列，全部取自**落盘的真相源**（不是我脑子里的印象，重启也不丢）：
#      ① 待派 = docs/REQUIREMENTS-TRACE.md 里标 ⛔ 的行
#      ② 待复验 = 已推但**未并进集成分支**的 handoff 分支（祖先关系判定，不看文件存在性）
#      ③ 待写WO = 本体 §8 里标 🔴 未修 / ◑ 部分闭合的断点
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRACE="$ROOT_DIR/docs/REQUIREMENTS-TRACE.md"
ONTO="$ROOT_DIR/docs/SYSTEM-ONTOLOGY.md"

# ① 待派
Q_TODO=0
if [ -f "$TRACE" ]; then
  Q_TODO=$(grep -c '⛔' "$TRACE" 2>/dev/null || echo 0)
else
  echo "⛔ 找不到 $TRACE ⇒ **工具坏了**，待派队列本次算不出，不许读成 0" >&2
  exit 2
fi

# ② 待复验
# ⚠️ **判据踩过一次坑，写在这里防复发**（2026-08-15 实测）：
#    第一版用「分支 tip 不是集成分支的祖先」当判据 ⇒ 报出 **288 条**。
#    错在历史分支绝大多数是 **cherry-pick / squash** 进 canonical 的，
#    **祖先关系天然不成立**，于是「早已收编」被读成「待复验」。
#    形态（CLAUDE.md 铁律 0.6 句式）：
#      **「我用『tip 不是祖先』当作『内容没并进来』的证据，而前者并不度量后者。」**
#    与本文件早已记过的「拿 git log C..b | wc -l 当有无未合并内容的判据」是同一个病。
#    改法：加**时间闸** —— 只有「tip 不比集成分支尖端旧」的才可能待复验。
#    ⚠️ 时间闸**必要不充分**：漏掉「推得早、至今没并」的分支。此边界如实打在输出里。
Q_VERIFY=0
Q_VERIFY_LIST=""
Q_VERIFY_UNKNOWN=0
INTEG="origin/claude/verify-reclaim-6"
DD_REMOTE="${DD_REMOTE:-origin}"
if git -C "$ROOT_DIR" rev-parse --verify -q "$INTEG" >/dev/null 2>&1; then
  INTEG_TS=$(git -C "$ROOT_DIR" log -1 --format=%ct "$INTEG" 2>/dev/null || echo 0)
  while read -r sha ref; do
    [ -z "$ref" ] && continue
    b="${ref#refs/heads/}"
    git -C "$ROOT_DIR" merge-base --is-ancestor "$sha" "$INTEG" 2>/dev/null && continue
    if ! git -C "$ROOT_DIR" cat-file -e "${sha}^{commit}" 2>/dev/null; then
      Q_VERIFY_UNKNOWN=$(( Q_VERIFY_UNKNOWN + 1 )); continue
    fi
    TS=$(git -C "$ROOT_DIR" log -1 --format=%ct "$sha" 2>/dev/null || echo 0)
    if [ "$TS" -ge "$INTEG_TS" ]; then
      Q_VERIFY=$(( Q_VERIFY + 1 )); Q_VERIFY_LIST="${Q_VERIFY_LIST} ${b}"
    fi
  done < <(git -C "$ROOT_DIR" ls-remote "$DD_REMOTE" 'refs/heads/claude/handoff-*' 2>/dev/null)
else
  echo "ℹ️  取不到 $INTEG ⇒ 待复验队列**未评估**（不代表为 0）"
fi

# ③ 待写WO：本体 §8 里未闭的断点
Q_GAP=0
[ -f "$ONTO" ] && Q_GAP=$(grep -cE '🔴 *未修|◑ *部分闭合' "$ONTO" 2>/dev/null || echo 0)

# 金丝雀：三个数至少有一个能算出非零，否则大概率是我抓错了文件
if [ "$Q_TODO" -eq 0 ] && [ "$Q_VERIFY" -eq 0 ] && [ "$Q_GAP" -eq 0 ]; then
  echo "⚠️  三个队列同时算出 0 —— 先怀疑是我抓错了文件/正则，再信「真没活了」。"
  echo "     复核：grep -c '⛔' $TRACE ; git ls-remote origin 'refs/heads/claude/handoff-*' | wc -l"
fi

QUEUE=$(( Q_TODO + Q_VERIFY + Q_GAP ))
echo "队列现算：待派 ${Q_TODO}（TRACE ⛔）· 待复验 ${Q_VERIFY}（已推未并）· 待写WO ${Q_GAP}（§8 未闭）= 合计 ${QUEUE}"
[ -n "$Q_VERIFY_LIST" ] && { echo "   待复验分支（前 10）："; for b in $Q_VERIFY_LIST; do echo "     · $b"; done | head -10; }
[ "$Q_VERIFY_UNKNOWN" -gt 0 ] && echo "   ℹ️  另有 ${Q_VERIFY_UNKNOWN} 条远端分支本地无对象 ⇒ **判不了**（不计入，也不等于已收编）"
echo "   ⚠️ 待复验用了时间闸（必要不充分）：推得早、至今没并的分支它看不见。"

# 仓主定的硬线：**在跑 agent < 4 就必须触发推进**
# ⚠️ **在跑 agent 数：本脚本量不了，两种启发式都实测失败，不许再猜第三种**
#    ① 按 worktree 目录名 grep 进程表 ⇒ **报 0 而实际 4 个在跑**
#       （subagent 的进程命令行里不含它的 worktree 路径，只在跑测试那几分钟短暂出现）。
#    ② 按 worktree 目录 mtime 15 分钟内有活动 ⇒ **同样报 0**（目录本身不被 touch）。
#    形态：**「我用『进程表/文件系统里的某个痕迹』当作『agent 在不在跑』的证据，
#            而那些痕迹并不度量它。」**
#    ⇒ 唯一可靠来源是**调度方自己的 agent 列表**（审核方的 ListAgents）。
#    故：由调用方传入；**不传就明说未评估，绝不默认 0** ——
#    默认 0 会让本探针永远喊「欠派」，喊多了就没人信，等于把机制做成噪声。
AGENTS="${1:-}"
if [ -z "$AGENTS" ]; then
  echo "   在跑 agent：**未传入 ⇒ 未评估**（用法：$0 <在跑agent数>；该数只有调度方的 agent 列表能给准）"
elif ! [ "$AGENTS" -eq "$AGENTS" ] 2>/dev/null; then
  echo "⛔ 在跑 agent 数「$AGENTS」不是整数 ⇒ 工具用错了，本次结论作废" >&2; exit 2
else
  echo "   在跑 agent：${AGENTS}（调用方传入）"
fi
CAP_AGENTS=4
if [ -n "$AGENTS" ] && [ "$AGENTS" -lt "$CAP_AGENTS" ] && [ "$QUEUE" -gt 0 ]; then
  echo "🔴 **欠派**：在跑 agent ${AGENTS} < 下限 ${CAP_AGENTS}，而队列合计 ${QUEUE} 非空。"
  echo "   仓主 2026-08-15 定：**少于 4 个就触发检测待派/待复验/待写WO，然后自动推进**。"
  echo "   ⚠️ 「gate 在跑」不是不派的理由 —— agent 大部分时间在读码改文件，"
  echo "      真冲突的只有它跑 vitest 那几分钟，让它自己探 vitest 进程数避让即可。"
  rc=1
fi

if false; then :
elif ! [ "$QUEUE" -eq "$QUEUE" ] 2>/dev/null; then
  echo "⛔ 待派队列长度「$QUEUE」不是整数 ⇒ 工具用错了，本次结论作废" >&2
  exit 2
elif [ "$QUEUE" -gt 0 ] && [ "$LOAD_INT" -lt "$CORES" ]; then
  echo "🔴 **欠派 ${QUEUE} 张**：机器闲着（载荷 ${LOAD} < ${CORES} 核）而待派队列非空。"
  echo "   铁律 2：被非产出动作（测量/取证/复验/等 agent）阻塞的只有它自己，不构成派活的前置条件。"
  echo "   「我先去测一下」不是理由 —— 测量与派活没有依赖关系，可以并行。"
  rc=1
fi

# ── 改错副本探针（WO 无 · 2026-08-14 建 · 铁律 0.6 二级处置：同一个错第二次必须建机制）─────
#
# 病：审核方并行开着**主工作目录**（canonical）与**集成 worktree**，两处各有一份同名脚本。
#     一次实测：用绝对路径 `/home/user/complete/scripts/check-solver-field-seam.mjs` 编辑，
#     而 Bash 的 cwd 在集成 worktree ⇒ **改的是 A、跑的是 B**。
#     于是「我改完了它还报同样的错」被读成「这个门修不好 / 判定器真的坏了」，
#     实际是修改压根没进到被执行的那份里。同日同形态第 2 次。
#
# 形态（铁律 0.6 句式）：**「我用『编辑器报告改动成功』当作『我跑的那份被改了』的证据，
#                          而前者并不度量后者。」**
#
# 为什么建在这里而不是写进检查清单：CLAUDE.md 自己写着「**检查清单是文档，不是机器，
# 所以它一次都没拦住我**」。机制的判据是「下次同样的错发生时，是机器先说话，不是人先想起来」。
# 本脚本是审核方**本来就习惯跑**的那一个（派活前、起 vitest 前都跑），
# 把探针挂在这条既有路径上，不需要任何人记得去跑一个新脚本。
#
# 判据：主工作目录（canonical）**不该**有未提交改动 —— 那里只用来读与跑 gate，所有编辑都在
# 集成 worktree 里做。它一旦有改动，最可能的解释就是刚才那一手改错了副本。
# 这条**只警告不判负**（rc 不动）：偶尔在主目录做一次性实验是合法的，
# 把它升成红会训练出「红了也照做」的习惯，反而拆掉威慑。
MAIN_WT="/home/user/complete"
if [ -d "$MAIN_WT/.git" ] || [ -f "$MAIN_WT/.git" ]; then
  STRAY="$(git -C "$MAIN_WT" status --porcelain 2>/dev/null | grep -c . || true)"
  STRAY_BR="$(git -C "$MAIN_WT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  HERE="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  if [ "$STRAY" -gt 0 ] && [ "$HERE" != "$MAIN_WT" ]; then
    echo "⚠️  **可能改错副本**：主工作目录 $MAIN_WT（分支 $STRAY_BR）有 ${STRAY} 处未提交改动，"
    echo "    而你此刻的 cwd 在 $HERE。两处各有一份同名脚本 —— 用绝对路径编辑 + 相对路径执行时，"
    echo "    会出现「改的是 A、跑的是 B」，表现为「我改完了它还报同样的错」。"
    echo "    复核一句话：ls -i <主目录>/<文件> <当前目录>/<文件>，inode 不同就是两个文件。"
    git -C "$MAIN_WT" status --porcelain 2>/dev/null | head -5 | sed 's/^/      /'
  fi
fi

[ "$rc" -eq 0 ] && echo "✅ 调度均衡（在已评估的判据内）"
exit "$rc"
