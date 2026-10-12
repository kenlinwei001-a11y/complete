#!/usr/bin/env bash
# 按关键字安全杀进程 —— 替代 `pkill -f <pat>`。
#
# 来历（铁律 1 判据 #4 + 铁律 0.6 三级处置）：`pkill -f '<pat>'` 会把**发出这条命令的 shell 自己**
# 也匹进去（它的命令行里就含 `<pat>`）⇒ 自杀，exit 143/144。本会话已因此自杀 **4 次**。
# 前 3 次的处置都是「在 CLAUDE.md 里写一句下次注意」—— 而「下次注意」不是机制：
# 第 4 次照犯。机制的判据是**机器先说话**，所以改成这个封装：调它就不可能自匹。
#
# 用法：bash scripts/killby.sh <关键字> [信号]
#   bash scripts/killby.sh 'chrome-linux/chrome'
#   bash scripts/killby.sh 'dist/server.js' TERM
set -uo pipefail
KEY="${1:?用法: killby.sh <关键字> [信号]}"
SIG="${2:-KILL}"
SELF=$$
PARENT=$PPID

# 关键：先取快照再过滤，且**显式排除自己与父 shell** —— 这是不自杀的唯一保证。
#
# ⚠ 2026-10-05 实测：原写法在本机（macOS 13 · BSD ps · 系统 bash 3.2）**每一次**都是
#   「一行都不杀 + 4 行报错」，两个独立成因（改掉一个仍然是坏的）：
#   ① `mapfile` 是 bash 4+ 内建，本机 bash 是 **3.2** ⇒ `mapfile: command not found`
#      ⇒ PIDS 从未被赋值 ⇒ `set -u` 下取 `${#PIDS[@]}` 直接报 unbound。
#      （同族先例：dispatch-collision.sh:42-50 已改用 read 循环并写明这条，本处照它。）
#   ② `ps -eo pid,args --no-headers` 是 GNU 写法 ⇒ BSD ps 回 `illegal option -- -`、
#      **一行进程都不回** ⇒ 就算有 mapfile 也永远匹配不到任何进程。
#   ③ 另：只按 pid 剔自己/父**不够** —— 子 shell 继承同一份 argv（含 KEY）而 pid 既非 $SELF 也非 $PARENT，
#      实测同一 KEY 会多出 2 个「自己人」（那会让报数虚高，且在极端情形下被自己杀掉）。
#      故用 `index($0,self)==0` 把**整行含本脚本路径**的副本一次剔干净。
PIDS=()
while IFS= read -r _p; do
  [ -n "$_p" ] && PIDS+=("$_p")
done < <(ps -eo pid,args | tail -n +2 | grep -F -- "$KEY" | grep -v grep |
  awk -v me="$SELF" -v pa="$PARENT" -v self="$0" \
      '$1!=me && $1!=pa && index($0,self)==0 {print $1}')

# ── 金丝雀：进程表读得到吗？──────────────────────────────────────────────
# 「0 个匹配」是个**否定结论**。管道坏掉时它与「真的没有匹配」在屏上长得一模一样。
PS_TOTAL=$(ps -eo pid,args 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')
if [ "${PS_TOTAL:-0}" -lt 2 ]; then
  echo "⛔ killby 自己坏了：进程表只读到 ${PS_TOTAL:-0} 行 —— 这不是「无匹配」，是**没查成**。" >&2
  echo "   ⛔ 此刻**什么都没杀**；别把这个 0 读成「那些进程已经没了」。" >&2
  exit 2
fi

if [ "${#PIDS[@]}" -eq 0 ]; then
  echo "killby: 无匹配 '$KEY'（0 个进程；金丝雀：进程表 ${PS_TOTAL} 行 ⇒ ps 管道是活的）"
  exit 0
fi
echo "killby: 匹配 ${#PIDS[@]} 个 → ${PIDS[*]}"
for p in "${PIDS[@]}"; do kill "-$SIG" "$p" 2>/dev/null || true; done
sleep 0.3
LEFT=$(ps -eo pid | tail -n +2 | tr -d ' ' | grep -c -x -F -- "$(printf '%s\n' "${PIDS[@]}")" 2>/dev/null || true)
echo "killby: 已发 SIG${SIG}，本 shell(pid=${SELF})/父(pid=${PARENT}) 已排除"
