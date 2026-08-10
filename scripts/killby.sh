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
mapfile -t PIDS < <(ps -eo pid,args --no-headers | grep -F -- "$KEY" | grep -v grep |
  awk -v me="$SELF" -v pa="$PARENT" '$1!=me && $1!=pa {print $1}')

if [ "${#PIDS[@]}" -eq 0 ]; then
  echo "killby: 无匹配 '$KEY'（0 个进程）"
  exit 0
fi
echo "killby: 匹配 ${#PIDS[@]} 个 → ${PIDS[*]}"
for p in "${PIDS[@]}"; do kill "-$SIG" "$p" 2>/dev/null || true; done
sleep 0.3
LEFT=$(ps -eo pid --no-headers | tr -d ' ' | grep -c -x -F -- "$(printf '%s\n' "${PIDS[@]}")" 2>/dev/null || true)
echo "killby: 已发 SIG$SIG，本 shell(pid=$SELF)/父(pid=$PARENT) 已排除"
