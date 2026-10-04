#!/usr/bin/env bash
# WO-UNDECLARED-VAR-AUDIT · 判决实验第三版
#
# ══════════════════════════════════════════════════════════════════════════════
# 【工具故障登记 · 前两版的读数全部作废】—— 必须先读这一段，否则会把 0 当读数用
#
#  第三版之前跑过两版抓取（capture.sh 与 capture2.sh），**71 次扰动 POST 全部 HTTP 400**
#  `VALIDATION_ERROR: kind: Invalid option ... targetObjectId: Invalid input: expected string,
#   received undefined` —— 我把 body 包成了 `{"perturbation":{...}}`，而路由是
#  `createPerturbationWorld(c, s, req.body)` 直接 `{...body, id, tenantId, sessionId, startTick, createdAt}`
#  做 `PerturbationSchema.safeParse`（`apps/datacore/src/app.ts` 的 `createPerturbationWorld`）。
#  **扁平 body + 必填 `kind`**，没有 `perturbation` 外层。
#
#  形态（铁律 0.6 句式）：
#    第一版：「我用『arm F/C 的回包是空的』当作『扰动没生效』的线索，却归因成『比错了 tick』。」
#    第二版：「我用『两臂 tick3 世界态逐格相同』当作『扰动打进去了但传导没动』的证据，
#             而前者并不度量后者 —— 写入请求根本返回 400，什么都没打进去。」
#    ★ 两次都没在抓取脚本里检查扰动 POST 的 **HTTP 状态码**，只把 body 追加进 .jsonl
#      ⇒ 半份日志被读成「零红」。修法：本版**每一条写请求都断言 201**，非 201 立即计数并在末尾硬失败。
#
# 【预言 · 写于取数之前】（与 capture.sh/capture2.sh 头注逐字相同，未被任何读数修正过）
#   P1（主线索的可达性判决）：
#     臂 Z（零扰动）与臂 F（30 张 PO 的 procurementDelay 全 set 成 +3）各推 3 拍，比**终态**：
#     预言 —— 臂 F 的 `demo_po_procurement_delay_to_material_shortage` 逐边 amount **翻正**
#             （系数 +0.07928545 × drive 由负翻正），且 `Material.shortageRisk` 相对臂 Z **升高**。
#     证伪 —— 两臂该 ruleKey 的 amount 逐边相同、或 shortageRisk 逐格相同 ⇒ 该边结构性死的。
#   P2（方向计数，照 P1 判决实验的 0/N 形态）：
#     预言 —— 臂 Z 里该边 30/30 条贡献**全负、0 条正**；臂 F 里 **0 条负、30 条正**。
#   P3（H7 的杀手读数 · chain-loss 叠加）：
#     预言 —— 臂 Z 的 chain-loss-matrix.simContext.appliedSteps 里 `material.in_transit` 一项为
#             `stateVar=procurementDelay`、`stateValue<0`、`deltaDays=0`；
#             臂 F 同一项 `stateValue>0`、`deltaDays>0`。
#     ⇒ 证明 `Math.max(0,cell)` **是活的**（随输入变），不是死代码；
#        同时证明**今天的种子世界里那一格恒 0**（被加项装饰品）。
#   P4（coverDays 的对照臂；修正为 set 200 —— 实测区间上界 42.3444，200 保证是上抬）：
#     预言 —— 臂 C 的 `demo_fg_cover_days_to_model_demand` 逐边 amount **变得比臂 Z 更负**
#             （系数 −0.00698967，覆盖天数↑ ⇒ 需求负载↓），且 `Model.demandLoad` 相对臂 Z **更低**。
#     证伪 —— 两臂逐边 amount 与 demandLoad 逐格相同 ⇒ 该边不通。
#   P5（Order.leadDays 的 23 格负值）：
#     臂 Z 实测该边 n=150、负127/正23 ⇒ 预言其中 **23 条净贡献为正**，与「23 个负 leadDays」同数；
#     臂 L 把 23 格 set 成 +30 后，预言这 23 条**翻负**。
# ══════════════════════════════════════════════════════════════════════════════
set -u
EV="$(cd "$(dirname "$0")" && pwd)"
BASE="http://127.0.0.1:4511"
AUTH='X-Debug-User: demo:admin:admin'
H=(-H "Content-Type: application/json" -H "$AUTH")
j() { curl -s "${H[@]}" "$@"; }
BAD_STATUS=0
# post201 <落盘文件> <url> <body> —— **断言 201**，非 201 计入 BAD_STATUS 并把错误正文打进文件
post201() {
  local OUT="$1" URL="$2" BODY="$3"
  local CODE
  CODE=$(j -X POST "$URL" -d "$BODY" -o "$OUT" -w "%{http_code}")
  if [ "$CODE" != "201" ]; then BAD_STATUS=$((BAD_STATUS+1)); echo "   ⛔ HTTP=$CODE body=$(head -c 200 "$OUT")"; fi
  printf '%s\n' "$CODE" >> "$OUT.code"
}
mk() { j -X POST "$BASE/a/v1/sim/sessions" -d '{}' -o "$EV/WO-UNDECLARED-VAR-AUDIT-sess$1.json" -w "%{http_code}" ; }
newid() { node -e 'console.log(require(process.argv[1]).id)' "$EV/WO-UNDECLARED-VAR-AUDIT-sess$1.json"; }

# ids_of <世界文件> <对象前缀> <可选：只取该状态量 < 0 的>
ids_of() {
  node -e '
    const fs=require("fs");
    const w=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const pfx=process.argv[2], varName=process.argv[3];
    let ids=Object.keys(w.state).filter(o=>o.startsWith(pfx));
    if (varName) ids=ids.filter(o=>typeof w.state[o][varName]==="number" && w.state[o][varName]<0);
    console.log(ids.sort().join("\n"));
  ' "$1" "$2" "${3:-}"
}

# 臂 F3：30 张 PO 的 procurementDelay set 成 +3
echo "── 臂 Z3（零扰动参照）"
mk Z3 >/dev/null; IDZ=$(newid Z3); echo "ID_Z3=$IDZ"
j "$BASE/a/v1/sim/sessions/$IDZ/world" -o "$EV/WO-UNDECLARED-VAR-AUDIT-worldZ3-tick0.json" -w "  worldZ3 HTTP=%{http_code}\n"
j -X POST "$BASE/a/v1/sim/sessions/$IDZ/tick?disclose=1" -d '{"n":3}' -o "$EV/WO-UNDECLARED-VAR-AUDIT-ticksZ3.json" -w "  ticksZ3 HTTP=%{http_code}\n"

echo "── 臂 F3（procurementDelay 负 → set 3）"
mk F3 >/dev/null; IDF=$(newid F3); echo "ID_F3=$IDF"
j "$BASE/a/v1/sim/sessions/$IDF/world" -o "$EV/WO-UNDECLARED-VAR-AUDIT-worldF3-tick0.json" -w "  worldF3 HTTP=%{http_code}\n"
: > "$EV/WO-UNDECLARED-VAR-AUDIT-perturbF3.jsonl"; : > "$EV/WO-UNDECLARED-VAR-AUDIT-perturbF3.jsonl.code"
while read -r O; do
  [ -z "$O" ] && continue
  post201 "$EV/WO-UNDECLARED-VAR-AUDIT-pF3.tmp" \
    "$BASE/a/v1/sim/sessions/$IDF/perturbations" \
    "{\"kind\":\"supply_disruption\",\"targetObjectId\":\"$O\",\"targetStateVar\":\"procurementDelay\",\"magnitude\":3,\"mode\":\"set\",\"label\":\"UV审计·采购延迟翻正\"}"
  cat "$EV/WO-UNDECLARED-VAR-AUDIT-pF3.tmp" >> "$EV/WO-UNDECLARED-VAR-AUDIT-perturbF3.jsonl"; echo >> "$EV/WO-UNDECLARED-VAR-AUDIT-perturbF3.jsonl"
done < <(ids_of "$EV/WO-UNDECLARED-VAR-AUDIT-worldF3-tick0.json" obj_purchaseorder_)
echo "  PO 扰动数=$(grep -c . "$EV/WO-UNDECLARED-VAR-AUDIT-perturbF3.jsonl") 非201=$(grep -vc '^201$' "$EV/WO-UNDECLARED-VAR-AUDIT-perturbF3.jsonl.code" || true)"
j "$BASE/a/v1/sim/sessions/$IDF/world" -o "$EV/WO-UNDECLARED-VAR-AUDIT-worldF3-after.json" -w "  worldF3-after HTTP=%{http_code}\n"
j -X POST "$BASE/a/v1/sim/sessions/$IDF/tick?disclose=1" -d '{"n":3}' -o "$EV/WO-UNDECLARED-VAR-AUDIT-ticksF3.json" -w "  ticksF3 HTTP=%{http_code}\n"

echo "── 臂 C3（FGI coverDays set 200 —— 实测上界 42.3444，200 必为上抬）"
mk C3 >/dev/null; IDC=$(newid C3); echo "ID_C3=$IDC"
j "$BASE/a/v1/sim/sessions/$IDC/world" -o "$EV/WO-UNDECLARED-VAR-AUDIT-worldC3-tick0.json" -w "  worldC3 HTTP=%{http_code}\n"
: > "$EV/WO-UNDECLARED-VAR-AUDIT-perturbC3.jsonl"; : > "$EV/WO-UNDECLARED-VAR-AUDIT-perturbC3.jsonl.code"
while read -r O; do
  [ -z "$O" ] && continue
  post201 "$EV/WO-UNDECLARED-VAR-AUDIT-pC3.tmp" \
    "$BASE/a/v1/sim/sessions/$IDC/perturbations" \
    "{\"kind\":\"supply_disruption\",\"targetObjectId\":\"$O\",\"targetStateVar\":\"coverDays\",\"magnitude\":200,\"mode\":\"set\",\"label\":\"UV审计·覆盖天数上抬\"}"
  cat "$EV/WO-UNDECLARED-VAR-AUDIT-pC3.tmp" >> "$EV/WO-UNDECLARED-VAR-AUDIT-perturbC3.jsonl"; echo >> "$EV/WO-UNDECLARED-VAR-AUDIT-perturbC3.jsonl"
done < <(ids_of "$EV/WO-UNDECLARED-VAR-AUDIT-worldC3-tick0.json" obj_finishedgoodsinventory_)
echo "  FGI 扰动数=$(grep -c . "$EV/WO-UNDECLARED-VAR-AUDIT-perturbC3.jsonl") 非201=$(grep -vc '^201$' "$EV/WO-UNDECLARED-VAR-AUDIT-perturbC3.jsonl.code" || true)"
j "$BASE/a/v1/sim/sessions/$IDC/world" -o "$EV/WO-UNDECLARED-VAR-AUDIT-worldC3-after.json" -w "  worldC3-after HTTP=%{http_code}\n"
j -X POST "$BASE/a/v1/sim/sessions/$IDC/tick?disclose=1" -d '{"n":3}' -o "$EV/WO-UNDECLARED-VAR-AUDIT-ticksC3.json" -w "  ticksC3 HTTP=%{http_code}\n"

echo "── 臂 L3（23 张负 leadDays 的 Order set 成 +30）"
mk L3 >/dev/null; IDL=$(newid L3); echo "ID_L3=$IDL"
j "$BASE/a/v1/sim/sessions/$IDL/world" -o "$EV/WO-UNDECLARED-VAR-AUDIT-worldL3-tick0.json" -w "  worldL3 HTTP=%{http_code}\n"
ids_of "$EV/WO-UNDECLARED-VAR-AUDIT-worldL3-tick0.json" obj_order_ leadDays > /tmp/uv-l3.txt
echo "  负 leadDays 的 Order 数=$(grep -c . /tmp/uv-l3.txt)"
: > "$EV/WO-UNDECLARED-VAR-AUDIT-perturbL3.jsonl"; : > "$EV/WO-UNDECLARED-VAR-AUDIT-perturbL3.jsonl.code"
while read -r O; do
  [ -z "$O" ] && continue
  post201 "$EV/WO-UNDECLARED-VAR-AUDIT-pL3.tmp" \
    "$BASE/a/v1/sim/sessions/$IDL/perturbations" \
    "{\"kind\":\"demand_shift\",\"targetObjectId\":\"$O\",\"targetStateVar\":\"leadDays\",\"magnitude\":30,\"mode\":\"set\",\"label\":\"UV审计·交期翻正\"}"
  cat "$EV/WO-UNDECLARED-VAR-AUDIT-pL3.tmp" >> "$EV/WO-UNDECLARED-VAR-AUDIT-perturbL3.jsonl"; echo >> "$EV/WO-UNDECLARED-VAR-AUDIT-perturbL3.jsonl"
done < /tmp/uv-l3.txt
echo "  Order 扰动数=$(grep -c . "$EV/WO-UNDECLARED-VAR-AUDIT-perturbL3.jsonl") 非201=$(grep -vc '^201$' "$EV/WO-UNDECLARED-VAR-AUDIT-perturbL3.jsonl.code" || true)"
j "$BASE/a/v1/sim/sessions/$IDL/world" -o "$EV/WO-UNDECLARED-VAR-AUDIT-worldL3-after.json" -w "  worldL3-after HTTP=%{http_code}\n"
j -X POST "$BASE/a/v1/sim/sessions/$IDL/tick?disclose=1" -d '{"n":3}' -o "$EV/WO-UNDECLARED-VAR-AUDIT-ticksL3.json" -w "  ticksL3 HTTP=%{http_code}\n"

echo "── 链损叠加：四臂 simContext"
for A in Z3 F3 C3 L3; do
  eval "ID=\$ID$A"
  j -X POST "$BASE/a/v1/sim/chain-loss-matrix" -d "{\"sessionId\":\"$ID\"}" -o "$EV/WO-UNDECLARED-VAR-AUDIT-cl$A.json" -w "  cl$A HTTP=%{http_code}\n"
done
j -X POST "$BASE/a/v1/sim/chain-loss-matrix" -d '{}' -o "$EV/WO-UNDECLARED-VAR-AUDIT-clNONE.json" -w "  clNONE HTTP=%{http_code}\n"

echo "── 扰动列表回读（世界真的受过这些扰动吗）"
for A in F3 C3 L3; do
  eval "ID=\$ID$A"
  j "$BASE/a/v1/sim/sessions/$ID/perturbations" -o "$EV/WO-UNDECLARED-VAR-AUDIT-plist$A.json" -w "  plist$A HTTP=%{http_code}\n"
done

echo "BAD_STATUS=$BAD_STATUS"
[ "$BAD_STATUS" -eq 0 ] || echo "⛔ 有写请求未返回 201 —— 本批读数作废，不许当 0 用"
echo "DONE3"
