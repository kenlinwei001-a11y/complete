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
#   ② 本地 HEAD 与**远端那条分支的 tip**（一次 `ls-remote` 现问）不一致 ⇒ 有 commit 没推上去。
#
# ⛔ 曾经的第 ③ 条是错的，别改回去：**「没有 upstream（`@{u}` 取不到）」≠「一次都没推过」**。
#   `@{u}` 只是本地的一个配置项 + 缓存（remote-tracking ref），它缺失有三种成因：
#     (a) 真没推过；(b) 推了但没用 `-u`（`git push origin HEAD:refs/heads/x` 就是这种，
#         本仓工单模板教的正是这个写法 ⇒ 命中的是它）；(c) 远端分支被删/改过名。
#   实测（造了个三态夹具跑新旧两版，见 docs/evidence/WO-PROBE-BSD-FIX-*.txt）：
#   旧写法对一个**确已推到远端**的分支印「⛔ 无 upstream（一次都没推过）」，
#   而同一时刻 `git ls-remote origin` 明明白白列着那个分支与同一个 sha。
#   ⇒ 判据改成**现问远端 tip 与本地 HEAD 比**；远端取不到时印「未判定」，绝不当成「没推过」。
#
# ══ ⚠ 本机 `find` 有两套实现，`-newermt` 语义**相反**（2026-10-05 实测，别照抄任一侧）══
#   工具 shell（Claude Code 的 shim，`find () { … ARGV0=bfs "$CLAUDE_CODE_EXECPATH" … }`）：
#     `find --version` = **bfs 4.1.1**；`-newermt '-120 minutes'` ⇒ `bfs: error: Invalid timestamp.`（相对日期不认）
#     而 `-newermt '@<epoch>'` 在 bfs 下**可用**。
#   `bash scripts/*.sh`（脚本真实解释器，`command -v find` = `/usr/bin/find`）：
#     **BSD find**；`-newermt '@<epoch>'` ⇒ `find: Can't parse date/time: @…`（不认）
#     而 `-newermt '-120 minutes'` 在 BSD 下**可用**。
#   ⇒ 两个写法各在一侧是坏的，**`-mmin` / `-mtime` / `-newer <参照文件>` 三套实现都成立** —— 本脚本一律用它们。
#   ⚠ 附带陷阱：坏的那一侧会往 stderr 吐 10 行用法/报错，`find … 2>&1 | wc -l` 会把**报错行数当结果数**
#     （实测 bfs 形 = 10，真文件数是 2）。数文件数一律 `2>/dev/null` 且**另配必然命中对照**。
#
# ══ 用法 ═══════════════════════════════════════════════════════════════════
#   bash scripts/unpushed-watch.sh            # 默认只看最近 120 分钟动过的 worktree（= 本轮在跑的）
#   bash scripts/unpushed-watch.sh 30         # 只看最近 30 分钟动过的
#   bash scripts/unpushed-watch.sh all        # 全部 agent worktree
#   WATCH_REMOTE=git@github.com:<owner>/<repo>.git bash scripts/unpushed-watch.sh
#                                             # 换远端（本机 HTTPS 时通时不通，SSH 稳；不改仓库 remote）
#
# 退出码：0 = 全部已落盘；1 = 有产出悬空（**不是**"构建失败"，是"该催 dev 推了"）；
#        2 = **探针自己坏了**（时间窗过滤器/分支枚举存疑）——那时任何「都推了」的结论都不成立。
set -uo pipefail

WINDOW="${1:-120}"
WATCH_REMOTE="${WATCH_REMOTE:-origin}"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "不在 git 仓库里"; exit 2; }

# ── 金丝雀①：时间窗过滤器自证（必然命中 + 必然不命中，铁律 0.6「扫描类结论先自证工具」）──
# 「窗口内没有活动的 worktree」是个**否定结论**。过滤器坏了与「真的没人动」在屏上一模一样，
# 而后者会让本脚本 rc=0 印「全部已落盘」—— 又是否定结论冒充肯定结论。故先拿自建夹具夹逼一次：
# 一个刚写的文件**必须**被选中，一个 2020 年的文件**必须**不被选中。
if [ "$WINDOW" != "all" ]; then
  _CAN=$(mktemp -d "${TMPDIR:-/tmp}/unpushed-canary.XXXXXX" 2>/dev/null) || _CAN=""
  if [ -z "$_CAN" ]; then
    echo "⚠️  建不出夹具目录 ⇒ 时间窗过滤器**未自证**（继续跑，但「窗口内没有活动 worktree」这句不作数）"
  else
    : > "$_CAN/hit"; touch -t 202001010000 "$_CAN/miss"
    _hit=$(find "$_CAN" -maxdepth 1 -type f -mmin "-${WINDOW}" 2>/dev/null | wc -l | tr -d ' ')
    _all=$(find "$_CAN" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')
    rm -rf "$_CAN"
    if [ "${_all:-0}" -ne 2 ] || [ "${_hit:-0}" -ne 1 ]; then
      echo "⛔ 时间窗过滤器坏了：夹具里 2 个文件、只应有 1 个落在 ${WINDOW} 分钟窗内，实得 ${_hit}/${_all}。"
      echo "   ⇒ 这不是「没有活动的 worktree」，是**没查成**。此刻『都推了』一个字都不作数。"
      exit 2
    fi
  fi
fi

# ── 金丝雀②：远端分支表 —— 一次问清，判据落在「远端那条分支的 sha」上，不落在 `@{u}` 上 ──
# 见头注：`@{u}` 缺失有 (a)(b)(c) 三种成因，它**不度量**「一次都没推过」。
HEADS_RAW=$(git ls-remote --heads "$WATCH_REMOTE" 2>/dev/null); REMOTE_RC=$?
remote_tip_of() { printf '%s\n' "$HEADS_RAW" | awk -v r="refs/heads/$1" '$2==r {print $1; exit}'; }

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
    # ⚠ 时间窗用 `-mmin`（见头注：`-newermt` 两套实现语义相反，任一侧写法都会在另一侧静默失效）。
    # ⚠ 此处 `-maxdepth 1` 只看 worktree 根目录（含 linked worktree 的 `.git` 文件）——
    #   它度量的是「这个 worktree 最近被 git 操作/顶层文件改动碰过」，**不度量**「子树里有人在写」。
    #   实测 3 个 worktree：d1=0/0/1 与 depth3=0/0/6 方向一致但灵敏度低。窗口取小值时可能漏人。
    [ -n "$(find "$wt" -maxdepth 1 -mmin "-${WINDOW}" -print -quit 2>/dev/null)" ] || continue
  fi
  checked=$((checked + 1))

  br=$(git -C "$wt" branch --show-current 2>/dev/null)
  dirty=$(git -C "$wt" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  head_sha=$(git -C "$wt" rev-parse HEAD 2>/dev/null)
  ahead=0; note=""; unknown=0

  if [ "$REMOTE_RC" -ne 0 ]; then
    # ⛔ 远端取不到 ⇒ 推没推**未判定**。不许拿本地 remote-tracking 缓存当远端真相（它正是本文件要修的那个病）。
    unknown=1
    note="  ⚠ 远端不可达（ls-remote RC=${REMOTE_RC}）—— 推没推**未判定**，别当成没推"
  elif [ -z "$br" ]; then
    note="  ⚠ detached HEAD（没有分支名，远端无从对应）—— 未判定"
  else
    tip=$(remote_tip_of "$br")
    if [ -n "$tip" ] && [ "$tip" = "$head_sha" ]; then
      note="  ✓ 远端已有同名分支且 tip 与本地逐位相同"
    elif [ -n "$tip" ]; then
      ahead=$(git -C "$wt" rev-list --count "${tip}..HEAD" 2>/dev/null) || ahead="?"
      note="  ⛔ 远端同名分支停在 ${tip%"${tip#????????}"}，本地 HEAD 是 ${head_sha%"${head_sha#????????}"} —— 有提交没推"
    else
      # 远端**确实**没有这个分支名。但「没这个分支名」也不等于「内容没落盘」：
      # 可能推到了别的分支名下。故再问一句：这些提交在**任何**远端分支上找得到吗（`--remotes` 用本地缓存，只作旁证）。
      ahead=$(git -C "$wt" rev-list --count HEAD --not --remotes 2>/dev/null) || ahead="?"
      if [ "$ahead" = "0" ]; then
        note="  · 远端无同名分支，但 HEAD 的提交在别的远端分支上找得到 ⇒ 内容没丢（建议补 push -u 让名字也对上）"
      else
        note="  ⛔ 远端**确实没有** ${br}（ls-remote 成功且查无此名），且有 ${ahead} 个提交不在任何远端分支上 —— 只在本地"
      fi
    fi
  fi

  # 有产出悬空 = 有未提交改动，或确有未推提交。⛔「没有 upstream」不再是判据（见头注）。
  has_work=0
  [ "${dirty:-0}" -gt 0 ] && has_work=1
  case "$ahead" in ''|'?'|0) ;; *) [ "$ahead" -gt 0 ] && has_work=1 ;; esac
  [ "$unknown" -eq 1 ] && [ "${dirty:-0}" -eq 0 ] && has_work=0   # 远端未知时，只有本地未提交才算实锤

  if [ "$has_work" -eq 1 ]; then
    risky=$((risky + 1))
    printf '  ⚠ %-28s 未提交=%-4s 未推=%-4s%s\n' "${br:-<detached>}" "$dirty" "$ahead" "$note"
    printf '      %s\n' "$wt"
  fi
done < <(git worktree list --porcelain | awk '/^worktree /{print $2}')

printf -- '────────────────────────────────────────────────\n'
if [ "$REMOTE_RC" -ne 0 ]; then
  echo "⛔ 远端分支表没取到（$WATCH_REMOTE ls-remote RC=${REMOTE_RC}）—— 本次「推没推」整体**未判定**，"
  echo "   上面列出的只是本地未提交改动。这不是「都推了」。要判落盘请走 SSH："
  echo "     WATCH_REMOTE=git@github.com:<owner>/<repo>.git bash scripts/unpushed-watch.sh $WINDOW"
  exit 2
fi
if [ "$checked" -eq 0 ]; then
  echo "窗口内没有活动的 agent worktree（金丝雀：总数 ${TOTAL_WT}；时间窗过滤器已用夹逼夹具自证）"
  echo "  ⚠ 注意判据是「worktree 根目录/git 元数据在窗口内被动过」，不是全树内容扫描 —— 只写深层文件的 dev 可能不被选中。"
  exit 0
fi
if [ "$risky" -eq 0 ]; then
  echo "✅ ${checked} 个在跑 worktree 全部已落盘（金丝雀：总数 ${TOTAL_WT}；判据=远端 tip vs 本地 HEAD，非 @{u}）"
  exit 0
fi
echo "⛔ ${risky}/${checked} 个 worktree 有产出悬空 —— 容器一重启就没了。"
echo "   处置：给这些 dev 发一条『立刻 git add -A && git commit && git push -u origin HEAD:refs/heads/<branch>』，"
echo "   不许等他们把测试跑绿。推旁支零风险，它只决定『落没落盘』，不决定『能不能并线』。"
exit 1
