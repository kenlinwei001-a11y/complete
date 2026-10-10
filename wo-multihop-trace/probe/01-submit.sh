#!/bin/bash
# WO-MULTIHOP-TRACE · 01 提交多跳 query（唯一一次提交，不改 query 文本）
set -u
BASE="${BASE:-http://127.0.0.1:4002}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUTDIR="${1:-$HERE/../evidence}"
mkdir -p "$OUTDIR"

node -e '
const fs=require("fs");
const q=fs.readFileSync(process.argv[1],"utf8").trim();
const body={packageId:"pkg_battery_manufacturing",query:q,context:{view:"cockpit",selectedObjects:[],filters:{}}};
fs.writeFileSync(process.argv[2],JSON.stringify(body));
console.log("query utf8 bytes: "+Buffer.byteLength(q,"utf8"));
' "$HERE/query.txt" "$OUTDIR/01-request-body.json"

RC=$(curl -s --max-time 60 -X POST "$BASE/api/v1/queries" \
  -H "X-Debug-User: demo:admin:admin" \
  -H "Content-Type: application/json" \
  --data-binary "@$OUTDIR/01-request-body.json" \
  -o "$OUTDIR/01-submit.json" -w "%{http_code}")
echo "$RC" > "$OUTDIR/01-submit.rc"
echo "HTTP:$RC"

node -e '
const fs=require("fs");
try{
  const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  console.log("TASKID:"+(j.taskId||j.id||"(none)"));
  console.log("PATH:"+(j.path||"(none)"));
  console.log("STATUS:"+(j.status||"(none)"));
  console.log("CLASSIFICATION:"+JSON.stringify(j.classification||null));
}catch(e){console.log("PARSE_ERR:"+e.message);}
' "$OUTDIR/01-submit.json"
