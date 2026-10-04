#!/usr/bin/env bash
# WO-NEG-PRESSURE-ROOTCAUSE · 运行期取证抓取（只读 + 一拍 tick）
# ⛔ 不改任何产品代码 / 测试 / 域声明 / 公式 / 种子 —— 本脚本只发 GET 与一拍 tick。
# ⛔ 每条写请求断言 2xx（本仓刚发生过「71 个 POST 全 400 而日志被读成零红」）。
# ⛔ 不发 POST /tick {n:0}（该形状本树 400）；要读 tick0 就一次 tick 都别发。
set -u
BASE=http://127.0.0.1:4931
EV="$(cd "$(dirname "$0")" && pwd)"
H=(-H "X-Debug-User: demo:admin:admin" -H "content-type: application/json")
BAD=0
say() { printf '%s\n' "$*"; }
chk() { # chk <期望码> <实得码> <标签>
  if [ "$2" != "$1" ]; then say "  🔴 HTTP_MISMATCH $3 期望=$1 实得=$2"; BAD=$((BAD+1)); else say "  ✅ HTTP=$2 $3"; fi
}

say "════ §0 自证：连的是本树自己起的那一个 ════"
PID=$(lsof -nP -iTCP:4931 -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $2}')
CWD=$(lsof -p "$PID" -a -d cwd -Fn 2>/dev/null | tail -1 | sed 's/^n//')
say "  LISTEN pid=${PID} cwd=${CWD}"
MARK="SELFPROOF_$$_$(date +%s)"
curl -s "${H[@]}" "$BASE/a/v1/sim/view-config?m=$MARK" -o "$EV/WO-NEG-PRESSURE-view-config.json" -w "" >/dev/null
NM=$(grep -c "$MARK" /tmp/wo-neg/dc4931.log 2>/dev/null)
say "  MARK=${MARK} hits_in_log=${NM} (expect pid=${PID})"
say "  [金丝雀·日志自证] $(grep "$MARK" /tmp/wo-neg/dc4931.log 2>/dev/null | head -1 | grep -o '"pid":[0-9]*' | head -1)"

say ""
say "════ §1 建会话（写请求 → 断言 201）════"
C=$(curl -s "${H[@]}" -X POST "$BASE/a/v1/sim/sessions" -d '{}' -o "$EV/WO-NEG-PRESSURE-session.json" -w "%{http_code}")
chk 201 "$C" "POST /a/v1/sim/sessions"
ID=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$EV/WO-NEG-PRESSURE-session.json','utf8')).id||'')}catch(e){console.log('')}")
say "  sessionId=$ID"
if [ -z "$ID" ]; then say "🔴 拿不到 sessionId ⇒ 工具坏了，终止（不许把空当读数）"; echo "CAPTURED_RC=2"; exit 2; fi

say ""
say "════ §2 tick0 世界态（一次 tick 都不发）════"
C=$(curl -s "${H[@]}" "$BASE/a/v1/sim/sessions/$ID/world" -o "$EV/WO-NEG-PRESSURE-world-tick0.json" -w "%{http_code}")
chk 200 "$C" "GET …/world"

say ""
say "════ §3 规则表 + 视图配置 ════"
C=$(curl -s "${H[@]}" "$BASE/a/v1/sim/propagation-rules" -o "$EV/WO-NEG-PRESSURE-rules.json" -w "%{http_code}")
chk 200 "$C" "GET /a/v1/sim/propagation-rules"

say ""
say "════ §4 承载对象的真实 props（手算输入源）════"
# ⚠ 第一版这里传了 limit=500 ⇒ 本端点**按设计硬拒**分页别名（PAGINATION_ALIASES，app.ts:6029）
#   ⇒ 4 个 GET 全 400。那不是服务坏了，是我的探针形状错了。正确参数是 pageSize（≤500）。
for T in Material Model PurchaseOrder OrderLine; do
  C=$(curl -s "${H[@]}" "$BASE/a/v1/objects?type=$T&pageSize=500" -o "$EV/WO-NEG-PRESSURE-objs-$T.json" -w "%{http_code}")
  chk 200 "$C" "GET /a/v1/objects?type=$T&pageSize=500"
done

say ""
say "════ §4b 逐格点名取数（负格清单**从运行态数据现算**，不抄台账、不按名猜 id）════"
# ⛔ 第一版这里硬编码了一批 id（含 obj_model_圆柱-NCM）—— 实测该 id **404**，
#    说明台账里的显示名不等于对象 id。改成从 §4 刚拉下来的真实对象集里现算负格，再逐格按 id 直取。
node -e '
const fs=require("fs");
const EV=process.argv[1], TYPES=["Material","Model","PurchaseOrder","OrderLine"];
const NEG=["shortageRisk","supplyRisk","expeditePressure","demandPressure"];
const out=[];
for(const t of TYPES){
  let j; try{ j=JSON.parse(fs.readFileSync(`${EV}/WO-NEG-PRESSURE-objs-${t}.json`,"utf8")); }catch(e){ continue; }
  for(const it of (j.items||[])){
    for(const k of NEG){ const v=it.props?.[k]; if(typeof v==="number"&&v<0) out.push(`${it.type}/${it.id}\t${k}\t${v}`); }
  }
}
fs.writeFileSync("/tmp/wo-neg/neg-cells.tsv", out.join("\n")+"\n");
process.stdout.write(`  §4b 现算负格 ${out.length} 个（按 id 直取前 20 个）\n`);
' "$EV"
: > "$EV/WO-NEG-PRESSURE-objs-named.jsonl"
head -20 /tmp/wo-neg/neg-cells.tsv | cut -f1 | sort -u > /tmp/wo-neg/neg-ids.txt
# ⚠ 必须用 `< file` 而不是 `| while`：管道里的 while 跑在子壳，BAD 自增会**当场丢掉**
#   ⇒ 一次 400 会被读成「零红」，正是本仓刚付过代价的那个病。
while read -r K; do
  C=$(curl -s </dev/null "${H[@]}" "$BASE/a/v1/objects/$K" -o /tmp/wo-neg/named-one.json -w "%{http_code}")
  if [ "$C" != "200" ]; then say "  🔴 HTTP_MISMATCH GET /a/v1/objects/$K 期望=200 实得=$C"; BAD=$((BAD+1)); else
    node -e "const fs=require('fs');const b=fs.readFileSync('/tmp/wo-neg/named-one.json','utf8');process.stdout.write(JSON.stringify({ref:'$K',http:200,body:JSON.parse(b)})+'\n')" >> "$EV/WO-NEG-PRESSURE-objs-named.jsonl"
    say "  ✅ HTTP=200 GET /a/v1/objects/$K"
  fi
done < /tmp/wo-neg/neg-ids.txt

say ""
say "════ §4c Model 的出边结构（AVG(out(model_uses_material).shortageRisk) 的输入集）════"
# 同上：要哪几个型号**从现算的负格清单里取**，不硬编码。
awk -F'\t' '$2=="supplyRisk"{sub(/^Model\//,"",$1); print $1}' /tmp/wo-neg/neg-cells.tsv | sort -u > /tmp/wo-neg/nb-models.txt
while read -r M; do
  C=$(curl -s </dev/null "${H[@]}" "$BASE/a/v1/objects/$M/neighbors" -o "$EV/WO-NEG-PRESSURE-nb-$M.json" -w "%{http_code}")
  chk 200 "$C" "GET /a/v1/objects/$M/neighbors"
done < /tmp/wo-neg/nb-models.txt

say ""
say "════ §5 一拍 tick（disclose=1 → stateVarReport.saturations）════"
C=$(curl -s "${H[@]}" -X POST "$BASE/a/v1/sim/sessions/$ID/tick?disclose=1" -d '{"n":1}' -o "$EV/WO-NEG-PRESSURE-ticks-1.json" -w "%{http_code}")
chk 200 "$C" "POST …/tick n=1 disclose=1"

say ""
say "════ §6 零扰动对照臂：第二拍（同样 n=1，无任何扰动）════"
C=$(curl -s "${H[@]}" -X POST "$BASE/a/v1/sim/sessions/$ID/tick?disclose=1" -d '{"n":1}' -o "$EV/WO-NEG-PRESSURE-ticks-2.json" -w "%{http_code}")
chk 200 "$C" "POST …/tick n=1 disclose=1（第 2 拍）"

say ""
if [ "$BAD" -ne 0 ]; then say "🔴 BAD_STATUS=$BAD ⇒ 本次读数作废，不许读成零红"; echo "CAPTURED_RC=1"; exit 1; fi
say "✅ 全部写请求 2xx，BAD_STATUS=0"
echo "CAPTURED_RC=0"
