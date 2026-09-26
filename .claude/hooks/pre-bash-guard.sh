#!/usr/bin/env bash
# PreToolUse(Bash) 钩子 —— **硬拦**两类当天造成真实损失的命令形态。
#
# 为什么是钩子不是纪律：2026-09-18 实测 —— CLAUDE.md 整份（约 1000 行）**每一轮都注入上下文**，
# 而当天同族错误仍犯 3 次、自匹杀进程仍犯 2 次。**规则在眼前 ≠ 会照做。**
# 同日唯一真正拦住过的东西是一个 stop hook（两次）。所以这里只放**机器**。
#
# ⚠ 刻意只拦两条，不做「全面检查」——CLAUDE.md 自己记着：
#   「喊多了就没人信，等于把机制做成噪声」。宁可漏，不可吵。
#
# 契约：stdin 收 {"tool_name":..., "tool_input":{"command":...}}；
#       exit 0 = 放行；exit 2 = 拦截，stderr 回给模型。
set -uo pipefail

payload="$(cat)"
cmd="$(printf '%s' "$payload" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -1)"
[ -z "$cmd" ] && exit 0

# ── ⚠ 先剥「数据」，再匹「构造」——否则这个钩子自己就犯它要防的那个病 ──────────
# 实测（写完它的当天第一次真用就炸）：提交信息里**引用**了危险形态的字面文本
# （`cmd | tail; echo $?` 这几个字），钩子匹到了**提交信息正文**并拦下一次合法提交。
# 形态正是 CLAUDE.md 铁律 0.6 第 6 条：**「那个串出现过」不度量「那是它的赋值」。**
# 所以匹配之前必须先把**引号里的数据**剥掉，只留真正的 shell 构造：
#   ① `-m '...'` / `-m "..."` 提交信息  ② heredoc 正文  ③ 单引号字符串字面量
strip="$cmd"
strip="$(printf '%s' "$strip" | sed "s/-m[[:space:]]*'[^']*'/-m MSG/g; s/-m[[:space:]]*\\\\\"[^\\\\]*\\\\\"/-m MSG/g")"
strip="$(printf '%s' "$strip" | sed "s/<<[[:space:]]*'\?[A-Za-z_]\+'\?.*//")"
strip="$(printf '%s' "$strip" | sed "s/'[^']*'/STR/g")"
cmd="$strip"

# ── 拦截 ① 「看」与「动」写在同一条命令里 ───────────────────────────────
# 当天事故：一条命令**先打印**每个进程的 cwd、**然后杀掉**它们。输出里明明白白写着
# `cwd=agent-aaa39e4197dbce871`（一个**还活着**的 agent 的服务），我杀了它。
# 证据和动作在同一次执行里 ⇒ 证据永远来不及拦住动作。
# 判据：同一条命令里既有**进程枚举**又有**不可逆动作**。
has_enum=0
printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])(ps[[:space:]]|readlink|/proc/|pgrep)' && has_enum=1
has_destroy=0
printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])(kill([[:space:]]|$)|pkill|killall)' && has_destroy=1

if [ "$has_enum" = 1 ] && [ "$has_destroy" = 1 ]; then
  cat >&2 <<'EOF'
⛔ 拦截：这条命令同时做了「枚举进程」和「杀进程」。

来历（2026-09-18 真实损失）：同样形态的一条命令先打印 `cwd=agent-aaa39e4197dbce871`
—— 那是一个**还活着**的 agent 的服务 —— 然后在同一次执行里把它杀了。
**证据就在输出里，但它和动作同步发生，来不及拦住任何东西。**

改法：拆成两次调用。
  第 1 次：只枚举，把 pid 和 cwd 打出来，**看清楚每一个是谁的**。
  第 2 次：拿确切 pid 去 kill。
⚠ 并且别用会自匹的模式（命令行含关键字会把探针自己匹进去，本会话已因此自杀 5 次）。
EOF
  exit 2
fi

# ── 拦截 ② 管道吃掉退出码 ─────────────────────────────────────────────
# `cmd | tail -n; echo $?` 取的是**管道末端**的退出码（恒 0）。
# 本仓据此把一个 agentcore **编译失败**的 commit 判为「BUILD 通过」并入正线，
# 直到部署方 build 失败才暴露 —— 错误原文当时就在日志里，被假绿盖过。
if printf '%s' "$cmd" | grep -qE '\|[[:space:]]*(tail|head|grep|sed|awk|cut|wc)[^;&|]*[;&][[:space:]]*(echo|printf)[^;&|]*\$\?'; then
  cat >&2 <<'EOF'
⛔ 拦截：`... | <过滤器> ; echo $?` —— 这里的 `$?` 是**管道末端**那个命令的退出码，恒为 0。

来历：本仓据此把一个 **agentcore 编译失败**的 commit 判成「BUILD 通过」并入正线。
今天你自己也踩过两次（一次把脚本真实的 RC=1 读成 0，一次把 SIGPIPE 的 141 当结论）。

改法：输出落文件，RC 直捕，两步分开。
  cmd > /tmp/out.log 2>&1
  RC=$?          # ← 这才是 cmd 的退出码
  grep ... /tmp/out.log
EOF
  exit 2
fi

exit 0
