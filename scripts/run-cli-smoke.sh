#!/usr/bin/env bash
# A15.2–4 CLI handler 真后端冒烟（L2）：起真 datacore+agentcore → platform-cli.mjs 各 handler 真打端点。
# 用法：bash scripts/run-cli-smoke.sh   （需先 pnpm -r build）。generate 需 LLM provider（env-gated，默认跳）。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"); SVC="svc-cli"
PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-clismoke SEED_DEMO=1 CREDENTIAL_KEY=$KEY SERVICE_TOKEN=$SVC \
  AGENTCORE_BASE_URL=http://127.0.0.1:4002 node apps/datacore/dist/server.js > /tmp/clismoke-dc.log 2>&1 & DC=$!
PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 SERVICE_TOKEN=$SVC node apps/agentcore/dist/main.js > /tmp/clismoke-ac.log 2>&1 & AC=$!
trap 'kill $DC $AC 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -sf http://127.0.0.1:4001/healthz >/dev/null 2>&1 && curl -sf http://127.0.0.1:4002/healthz >/dev/null 2>&1 && break; sleep 1; done
export DATACORE_URL=http://127.0.0.1:4001 AGENTCORE_URL=http://127.0.0.1:4002
P() { node scripts/platform-cli.mjs "$@"; }
fail=0; chk() { if echo "$2" | grep -qE "$1"; then echo "✅ $3"; else echo "❌ $3 :: $2"; fail=1; fi; }
P login demo admin demo1234 >/dev/null 2>&1
chk '"op":"import"'   "$(P do '把csv导进来建模' --json 2>&1 | tail -1)"        "do→OPERATION(import)"
chk '"kind":"QUERY"'  "$(P do '常州影响哪些订单' --json 2>&1 | tail -1)"        "do→QUERY"
chk 'Base'            "$(P types --domain factory 2>&1)"                          "types(A4 真计数)"
chk '建域'            "$(P build '常州基地产能紧张影响订单做风险推演' --seed 7 2>&1)" "build(FDE 真建域)"
SOLVE_OUT=$(node scripts/platform-cli.mjs solve affected_orders --args '{"baseId":"changzhou","day":30,"peak":90}' 2>&1)
chk 'affected_orders' "$SOLVE_OUT" "solve(A1 真求解)"
# A15.2 import/model/rule（多步文件流）
printf 'so,qty\nSO-1,100\nSO-2,200\n' > /tmp/cli-imp.csv
IMP=$(P import /tmp/cli-imp.csv --json 2>&1 | tail -1); echo "$IMP" | grep -q connId && echo "✅ import(文件上传→连接器)" || { echo "❌ import :: $IMP"; fail=1; }
CONN=$(echo "$IMP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).connId)}catch{}})")
DS=$(curl -s "$DATACORE_URL/a/v1/raw-datasets?connId=$CONN" -H "authorization: Bearer $(node -e "console.log(JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.platform-cli.json','utf8')).accessToken)")" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const a=JSON.parse(d);console.log((Array.isArray(a)?a:a.items||[])[0]?.id||'')}catch{}})")
[ -n "$DS" ] && chk '本体草稿' "$(P model "$DS" 2>&1)" "model(数据→本体草稿)" || { echo "❌ model :: 未取到 rawDatasetId(conn=$CONN)"; fail=1; }
chk '已建' "$(P rule 'qty >= 0' --key C99 --name 量非负 --scope Order --severity WARN 2>&1)" "rule(DSL 建规则)"
echo "=== CLI 冒烟 $([ $fail -eq 0 ] && echo PASS || echo FAIL)（generate 需 LLM provider，env-gated 略）==="
exit $fail
