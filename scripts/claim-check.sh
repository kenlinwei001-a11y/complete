#!/usr/bin/env bash
#
# claim-check —— **下结论之前**跑的自检。配套 `docs/SOP-reviewer-claim-discipline.md`。
#
# ## 为什么有这个工具
#
# 2026-08-11 一天之内，审核方（我）连下 **8 个错误结论**，全部同一个形态：
#
#     「我用 X 当作 Y 的证据，而 X 并不度量 Y。」
#
# 而且其中 5 次是**工具在骗人**，不是判断力问题 —— 树旧了、dist 旧了、端口被占了、
# 路径写错了、分支记错了。这些都是**机器能替我查的**，靠人记得去查就一定会漏。
#
# 所以本脚本只做一件事：**把「我以为」变成「机器说」**。
# 它不替你思考，它只负责在你张嘴之前告诉你「你脚下这块地是不是新的」。
#
# ## 用法
#
#   claim-check.sh tree                    工作树是不是落后 canonical（报「代码里没有」之前必跑）
#   claim-check.sh dist <pkg>              该包的 dist 是不是比 src 旧（起服务/读 dist 之前必跑）
#   claim-check.sh has <what> <where>      what 在不在 where 上（说「某某会随某分支进正线」之前必跑）
#   claim-check.sh port <port>             端口是不是干净（起服务之前必跑）
#   claim-check.sh grep <symbol> [path]    带金丝雀的 grep（报「零命中」之前必跑）
#   claim-check.sh all                     tree + 三个包的 dist 一起过一遍
#
# 退出码：0 = 可以下结论；1 = 有问题，**你现在看到的证据不可信**；2 = 工具自己坏了。
set -uo pipefail
CANON="${CANONICAL_BRANCH:-claude/inspiring-gates-aqczjg}"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "⛔ 不在 git 仓库里"; exit 2; }

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }

# ── tree：工作树落后 = 你 grep 的是一棵旧树 ──────────────────────────────────
# 病历：主工作目录停在 5208fd9b，落后 canonical **112 个提交**。于是
#   · 「`GATE_UNAVAILABLE` 全仓 grep 不到」→ 实有 5 处（是 dev 顶回来才发现的）
#   · 「S3 枚举器要从零建」→ 实际整环都在，差点让 dev 造第二套
# 两条都是**否定结论**，都错，都因为脚下那棵树是旧的。
cmd_tree() {
  git -C "$REPO_ROOT" fetch origin --quiet 2>/dev/null
  local head remote behind
  head=$(git -C "$REPO_ROOT" rev-parse HEAD)
  remote=$(git -C "$REPO_ROOT" rev-parse --verify -q "refs/remotes/origin/$CANON") || {
    warn "⚠️ 取不到 origin/$CANON —— **未判定**，这不等于「不落后」"; return 1; }
  if [ "$head" = "$remote" ]; then grn "✅ 工作树 = canonical ($(echo "$head" | cut -c1-8))"; return 0; fi
  if git -C "$REPO_ROOT" merge-base --is-ancestor "$head" "$remote"; then
    behind=$(git -C "$REPO_ROOT" rev-list --count "$head..$remote")
    red "🔴 工作树落后 canonical **$behind 个提交**（HEAD $(echo "$head"|cut -c1-8)）"
    red "   ⇒ 你在这棵树上 grep 出来的「没有」，可能只是「这棵树里还没有」。"
    red "   修：git fetch origin && git merge --ff-only origin/$CANON"
    return 1
  fi
  grn "✅ 工作树不落后（含本地新提交 $(git -C "$REPO_ROOT" rev-list --count "$remote..$head") 个）"
}

# ── dist：dist 比 src 旧 = 你起的服务不是你读的代码 ──────────────────────────
# 病历：`apps/datacore/dist` 落后源码 12 小时，`/a/v1/ontology/slices/:key/layers`
# 这条**当天才加**的路由在旧 dist 上 404 ⇒ 我差点报「路由不存在」。
cmd_dist() {
  local pkg="${1:-}"; [ -z "$pkg" ] && { red "用法: claim-check.sh dist <pkg>"; return 2; }
  local d="$REPO_ROOT/apps/$pkg/dist" s="$REPO_ROOT/apps/$pkg/src"
  [ -d "$s" ] || { d="$REPO_ROOT/packages/$pkg/dist"; s="$REPO_ROOT/packages/$pkg/src"; }
  [ -d "$s" ] || { red "⛔ 找不到 $pkg 的 src"; return 2; }
  [ -d "$d" ] || { red "🔴 $pkg 没有 dist —— 先 build"; return 1; }
  local ns nd
  ns=$(find "$s" -type f -newer "$d" 2>/dev/null | head -1)
  nd=$(find "$s" -type f -printf '%T@\n' 2>/dev/null | sort -rn | head -1)
  # 判据：src 里有没有**比 dist 目录任一产物都新**的文件
  local newest_dist; newest_dist=$(find "$d" -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1)
  local newest_src;  newest_src=$(find "$s" -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1)
  local td ts; td=${newest_dist%% *}; ts=${newest_src%% *}
  if [ -z "$td" ] || [ -z "$ts" ]; then red "⛔ 读不到时间戳 —— 工具坏了，不许判「新鲜」"; return 2; fi
  if awk "BEGIN{exit !($ts > $td)}"; then
    red "🔴 $pkg 的 dist **过期**：源码比产物新"
    red "   最新源码: ${newest_src#* }"
    red "   最新产物: ${newest_dist#* }"
    red "   ⇒ 你起的服务不是你读的代码。修：pnpm --filter $pkg build"
    return 1
  fi
  grn "✅ $pkg dist 不比 src 旧"
}

# ── has：说「某某会随某分支进正线」之前 ──────────────────────────────────────
# 病历（同一天犯两次）：
#   · 早上对仓主说「cert 门绿了，沙盘 declutter/导航合并/产能卡片/地铁线路图就一起进正线」
#     → 实测四条对 cert 的 merge-base **全部「不在」**。
#   · 说「S3 是沙盘缺的那一环」→ 整环都在。
# 两次都是**拿记忆当证据**。记忆不度量分支内容。
cmd_has() {
  local what="${1:-}" where="${2:-}"
  [ -z "$what" ] || [ -z "$where" ] && { red "用法: claim-check.sh has <分支/提交> <目标分支>"; return 2; }
  git -C "$REPO_ROOT" fetch origin --quiet 2>/dev/null
  local a b
  a=$(git -C "$REPO_ROOT" rev-parse --verify -q "$what" || git -C "$REPO_ROOT" rev-parse --verify -q "origin/$what") \
    || { red "⛔ 解析不出 '$what' —— 这不是「不在」，是**名字写错了**"; return 2; }
  b=$(git -C "$REPO_ROOT" rev-parse --verify -q "$where" || git -C "$REPO_ROOT" rev-parse --verify -q "origin/$where") \
    || { red "⛔ 解析不出 '$where'"; return 2; }
  if git -C "$REPO_ROOT" merge-base --is-ancestor "$a" "$b"; then
    grn "✅ $what 在 $where 上（祖先关系成立）"
    return 0
  fi
  local n; n=$(git -C "$REPO_ROOT" rev-list --count "$b..$a")
  red "🔴 $what 的**提交**不在 $where 上（它有 $n 个提交不在目标里）"

  # ── 第二判据：内容 ────────────────────────────────────────────────────────
  # 病历（2026-08-11，dev 顶回来的）：`transit-geometry` / `impediments-reachable`
  # 当初是 **cherry-pick** 进 canonical 的 ⇒ SHA 不同、祖先关系不成立，**内容却在**。
  # 形态：**「我用『祖先关系』当作『内容在不在』的证据，而前者并不度量后者。」**
  # 所以否定结论不能只靠祖先关系 —— 必须再比一次 blob。
  local same=0 diff=0 absent=0 total=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    total=$((total+1))
    local x y
    x=$(git -C "$REPO_ROOT" rev-parse --verify -q "$a:$f" 2>/dev/null) || { absent=$((absent+1)); continue; }
    y=$(git -C "$REPO_ROOT" rev-parse --verify -q "$b:$f" 2>/dev/null) || { absent=$((absent+1)); continue; }
    if [ "$x" = "$y" ]; then same=$((same+1)); else diff=$((diff+1)); fi
  done < <(git -C "$REPO_ROOT" diff --name-only "$b...$a" 2>/dev/null)

  if [ "$total" -eq 0 ]; then
    warn "   ⚠️ 取不到改动文件清单 —— **内容判据未跑**，不许据此说「内容也不在」"
    return 1
  fi
  echo "   内容判据：改动 $total 个文件 · blob 与目标相同 $same · 不同 $diff · 缺失 $absent"
  if [ "$same" -gt 0 ]; then
    warn "   ⚠️ 有 $same 个文件与 $where **逐字节相同** ⇒ 很可能是 cherry-pick 进去的。"
    warn "      **只许说「它的提交不在」，不许说「它的内容不在」。** 逐文件核对哪些已在、哪些真缺。"
  else
    red "   两个判据一致：提交不在、内容也没一个文件相同 ⇒ 可以说「它不在 $where 上」。"
  fi
  return 1
}

# ── port：起服务之前 ────────────────────────────────────────────────────────
# 病历：新进程报 `errno -98` (EADDRINUSE) **静默没起来**，而三个旧进程继续在答，
# 其中一个拿着 12 小时前的 dist ⇒ 我以为「重建没生效，路由真不存在」。
cmd_port() {
  local p="${1:-}"; [ -z "$p" ] && { red "用法: claim-check.sh port <端口>"; return 2; }
  local pids
  pids=$(ps -eo pid,args --no-headers | grep -E 'dist/(server|main)\.js' | grep -v grep | awk '{print $1}')
  if [ -n "$pids" ]; then
    red "🔴 有存活的服务进程，起新的会 EADDRINUSE 并**静默失败**（旧的继续答你）："
    ps -eo pid,lstart,args --no-headers | grep -E 'dist/(server|main)\.js' | grep -v grep | sed 's/^/     /'
    red "   ⇒ 先逐个 kill，再起。起完**必须**查日志有无 EADDRINUSE/errno，别只看进程在不在。"
    return 1
  fi
  grn "✅ 无存活服务进程，端口 $p 可用"
}

# ── grep：报「零命中」之前 ──────────────────────────────────────────────────
# 病历：我 grep `GATE_UNAVAILABLE` 报 0，换个词能 grep 到，于是判「工具是好的」——
# 但那个词**新旧两棵树都有**，它压根不度量「树新不新」。
# **金丝雀选错对象，等于没有金丝雀。**
cmd_grep() {
  local sym="${1:-}" path="${2:-$REPO_ROOT}"
  [ -z "$sym" ] && { red "用法: claim-check.sh grep <symbol> [path]"; return 2; }
  cmd_tree || { red "   ⇒ 树都不新，这次 grep 的结果不可信。先修树。"; return 1; }
  local files n
  n=$(grep -rIl --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git -- "$sym" "$path" 2>/dev/null | wc -l)
  files=$(find "$path" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' \) \
            -not -path '*/node_modules/*' -not -path '*/dist/*' 2>/dev/null | wc -l)
  echo "   扫描规模：$files 个源文件（已排除 node_modules/dist）"
  if [ "$n" -gt 0 ]; then grn "✅ '$sym' 命中 $n 个文件 —— 肯定结论，可直接用"; return 0; fi
  warn "⚠️ '$sym' **零命中**。这是一个**否定结论**，报出去之前还差两步："
  warn "   ① 追一层间接调用：re-export / 高阶函数 / 依赖注入 / 字符串键分发 / 事件订阅 —— grep 一次都看不见"
  warn "   ② 换一个**只可能存在于新代码里**的符号做金丝雀（不是随便找个词）"
  warn "   在这两步做完之前，只许说「我没找到」，**不许说「它不存在」**。"
  return 1
}

cmd_all() {
  local rc=0
  cmd_tree || rc=1
  for p in datacore agentcore frontend-shell contracts; do
    [ -d "$REPO_ROOT/apps/$p/src" ] || [ -d "$REPO_ROOT/packages/$p/src" ] || continue
    cmd_dist "$p" || rc=1
  done
  return $rc
}

case "${1:-}" in
  tree) shift; cmd_tree "$@" ;;
  dist) shift; cmd_dist "$@" ;;
  has)  shift; cmd_has  "$@" ;;
  port) shift; cmd_port "$@" ;;
  grep) shift; cmd_grep "$@" ;;
  all)  shift; cmd_all  "$@" ;;
  *) sed -n '1,30p' "$0" | sed 's|^# \{0,1\}||'; exit 2 ;;
esac
