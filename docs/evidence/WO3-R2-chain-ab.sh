#!/bin/bash
# WO-3 R2 · 「世界在哪台机上」没有承载物 —— A/B 直证
# 同一 worldId，两个 datacore 进程：
#   P1 4052 = 建会话的那个进程（本单改后臂）   → 期望 200 available:true
#   P2 4053 = 另一个 datacore（改前臂）        → 期望 404 "sim world not found"（与「世界不存在」同串）
#   P3 4052 + 不存在的 id                      → 期望 404 "sim world not found"（同一串）
# 金丝雀（必然为真）：4052 会话列表里必须有该 id，否则 P1 的 200 无从谈起。
set -u
H='x-debug-user: demo:admin:admin'
SID=sims_bxx8gv6w3eeyvwqk
post() { # $1=base $2=worldId $3=tag
  echo "── [$3] POST $1 invoke worldId=$2"
  curl -s -m 20 -o /tmp/wo3-r2-body.json -w "HTTP %{http_code}\n" \
    -H "$H" -H 'content-type: application/json' \
    -d "{\"args\":{\"worldId\":\"$2\"}}" \
    "$1/a/v1/solvers/finance_world_projection/invoke"
  head -c 400 /tmp/wo3-r2-body.json; echo; echo
}
echo "── 金丝雀：4052 会话列表含 $SID ?"
curl -s -m 10 -H "$H" "http://127.0.0.1:4052/a/v1/sim/sessions" | grep -c "$SID"
post http://127.0.0.1:4052 "$SID"                "P1 世界所在进程"
post http://127.0.0.1:4053 "$SID"                "P2 另一台 datacore · 同一世界名"
post http://127.0.0.1:4052 "sims_no_such_world_zzzz" "P3 世界所在进程 · 不存在的名"
echo "── 前端那一跳（经 agentcore 4055 → 4052）："
curl -s -m 30 -o /tmp/wo3-r2-body2.json -w "HTTP %{http_code}\n" \
  -H "$H" -H 'content-type: application/json' \
  -d "{\"args\":{\"worldId\":\"$SID\"}}" \
  "http://127.0.0.1:4055/b/v1/solvers/finance_world_projection/run"
head -c 300 /tmp/wo3-r2-body2.json; echo
