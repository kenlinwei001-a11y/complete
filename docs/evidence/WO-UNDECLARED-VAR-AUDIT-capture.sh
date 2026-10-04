#!/usr/bin/env bash
# WO-UNDECLARED-VAR-AUDIT · 运行期取证抓取（只读；⛔ 不改产品代码/测试/门）
#
# ══════════════════════════════════════════════════════════════════════════════
# 【预言 · 写于取数之前】—— 照 P1 判决实验的规矩：先写预言的，后取数。
#   下面每一条都能被本次读数**当场证伪**；不中即如实登记「预言错」，不许改预言迁就读数。
# ══════════════════════════════════════════════════════════════════════════════
#
# H1 · coverDays 恒 0 ⇒ 一条边每拍被 `sourceVal === 0 → continue` 掐死
#   预言：FinishedGoodsInventory.coverDays 在 tick0 世界态里 **18 格全部 = 0**（distinct 值数 = 1）。
#         ⇒ propagation.ts 的 `if (sourceVal === 0) continue;` 每拍命中
#         ⇒ 边 demo_fg_cover_days_to_model_demand **一次都不进 trace**（零扰动臂 3 拍 firedRuleKeys 里没有它）。
#   证伪条件：coverDays 有任何一格 ≠ 0（H1 判死）；或该边进了 trace（H1 判死）。
#   出处线索（不是结论）：domain.ts 的 status 注释「coverDays **18 个对象、1 个 distinct 值：0**」、
#     seed-derivation-specs.ts 的 fgi_cover_days 公式 `COALESCE(this.qtyOnHand / this.dailyDemand, 0)`。
#
# H2 · procurementDelay 全负（主线索复现）—— 但**预言它打不死控制流分支**
#   预言：PurchaseOrder.procurementDelay 30 格全部 < 0，区间 ⊂ [-7,-1]（复现上一单的实数）。
#         且它在 tick0 **原样落进世界态**（未声明域 ⇒ projectWorldCells 不夹，saturations 里 0 条）。
#   预言（**方向**）：该值恒负 ⇒ 边 demo_po_procurement_delay_to_material_shortage 对
#         Material.shortageRisk 的贡献**恒为负**（系数 +0.07928545 × 负值）。
#   预言（**分支**）：**打不死任何控制流分支** —— `sourceVal === 0` 只在**恰好 0** 时命中，负值不命中；
#         `drive = sourceVal`（该规则 reaction 未声明）⇒ drive ≠ 0 ⇒ 边照常进 trace。
#   证伪条件：零扰动臂里该 ruleKey 的 amount 出现**正数**（则「恒负」判死）。
#         ⚠ 若判死，那不是缺陷 —— 是 H2 的预言错了，如实登记。
#
# H3 · deliveryDelay 恒正 ⇒ 无 0 掐断
#   预言：Supplier.deliveryDelay = (1 − onTimeRate) × 100 ∈ [1,10]，30 格里 0 格 = 0
#         ⇒ 边 demo_supplier_delay_to_material_shortage 每拍对每个供应商都进 trace。
#   证伪条件：出现 0 值格 ⇒ 该供应商那条边本拍哑火。
#
# H4 · leadDays 含负值，但**符号是对的**
#   预言：Order.leadDays 有负值格。其唯一出边系数 = −0.084090909（**负**）
#         ⇒ 负 leadDays × 负系数 = **正**贡献进 Model.costPressure
#         ⇒ 「交期压缩 ⇒ 成本压力上升」这一支**可达**（不是被负值打死的分支）。
#   证伪条件：零扰动臂里该 ruleKey 的 amount 出现**负值**（则语义被负号打反）。
#
# H5 · qty / unitPrice / backlogQtyTop / backlogPriceTop —— 链在此**终止**，无下游分支可打死
#   预言：Order.qty ∈ [708,21777] 全正、Order.unitPrice ∈ [13594,22660] 全正（combine:"max"、系数 1.0、无衰减）
#         ⇒ 靶格 Model.backlogQtyTop / backlogPriceTop 只有入边、**出度 0**
#         ⇒ 这四格没有「真实的消费分支」这回事（不是死了，是本来就没有下游）。
#   证伪条件：全 55 条规则里存在以 backlogQtyTop / backlogPriceTop 为 sourceStateVar 的（则 H5 判死）。
#
# H6 · clearanceQueueDays 无 0/负 ⇒ 无掐断
#   预言：CustomsClearance.clearanceQueueDays 只有 1 格，值 = 2（> 0）
#         ⇒ 它唯一消费方 chain-loss.ts `simDeltaDaysFor` 的 `Math.max(0, cell)` **不改变**它（deltaDays = 2）。
#   证伪条件：该格 ≤ 0。
#
# H7 · chain-loss 的 `+ sim.deltaDays` 在 PurchaseOrder 承载物上**恒等于 +0**（被加项装饰品）
#   预言：对链上每一张 PurchaseOrder，`simDeltaDaysFor(overlay,"PurchaseOrder",poId)` 回
#         `deltaDays === 0` 而 `stateValue < 0` ⇒ `days = baseDays + 0`。
#         ⇒ 与 P1 同族：**「被加项恒 0 ⇒ 加号是装饰品」**（本仓 mutation-dud 条目的第二形态）。
#   证伪条件：任一 PO 的 deltaDays > 0。
#
# ── 判决实验（两臂，缺一臂不构成结论）──────────────────────────────────────────
#   臂 Z（零扰动对照）：新会话，**一格扰动都不播**，推 3 拍。
#   臂 F（翻符号，逼分支）：新会话，把 30 张 PurchaseOrder 的 procurementDelay
#        **全体 set 成 +3**（负 → 正翻转），推 3 拍。
#   预言 Z：臂 Z 的该 ruleKey amount **全部 < 0**；Material.shortageRisk 由该边**只被下压**。
#   预言 F：臂 F 的该 ruleKey amount **全部 > 0**（drive 翻正）⇒
#           「采购延迟 ⇒ 物料短缺」这一支**可达**，H2 的「打不死分支」成立，
#           而「全负」只是**今天的种子数据如此**（数据态，不是结构态）。
#   若臂 F 也一动不动 ⇒ 该边**结构上死的**（≠ 数据态），裁决相反。这是本实验的可证伪点。
#
# ── 臂 F2（coverDays 的对照臂）────────────────────────────────────────────────
#   预言：把 FGI 的 coverDays 从 0 set 成 +10 ⇒ 边 demo_fg_cover_days_to_model_demand **当拍进 trace**
#         （对照臂证明「不进 trace」确实源于「源恒 0」，而不是这条边本身没接线）。
#   若臂 F2 也不进 trace ⇒ 病因是**没接线/接线错**，不是「值恒 0」—— 三种修法完全不同，必须分开。
# ══════════════════════════════════════════════════════════════════════════════
set -u
EV="$(cd "$(dirname "$0")" && pwd)"
BASE="http://127.0.0.1:4511"
AUTH='X-Debug-User: demo:admin:admin'
H=(-H "Content-Type: application/json" -H "$AUTH")

j() { curl -s "${H[@]}" "$@"; }

echo "── 0) 自证：只连自己那一个实例（端口回显 + 本树独有字段）"
j "$BASE/a/v1/sim/view-config?SELFPROOF_UV=1" -o "$EV/WO-UNDECLARED-VAR-AUDIT-view-config.json" -w "view-config HTTP=%{http_code}\n"

echo "── 1) 规则表（55 条 PUBLISHED）"
j "$BASE/a/v1/sim/propagation-rules" -o "$EV/WO-UNDECLARED-VAR-AUDIT-rules.json" -w "rules HTTP=%{http_code}\n"

echo "── 2) 臂 Z：新会话（零扰动）"
j -X POST "$BASE/a/v1/sim/sessions" -d '{}' -o "$EV/WO-UNDECLARED-VAR-AUDIT-sessZ.json" -w "sessZ HTTP=%{http_code}\n"
IDS=$(node -e 'const s=require(process.argv[1]);console.log(s.id)' "$EV/WO-UNDECLARED-VAR-AUDIT-sessZ.json")
echo "ID_Z=$IDS"
j "$BASE/a/v1/sim/sessions/$IDS/world" -o "$EV/WO-UNDECLARED-VAR-AUDIT-worldZ-tick0.json" -w "worldZ HTTP=%{http_code}\n"
# ⚠ POST /tick {n:0} 会静默推一拍 ⇒ 读 tick0 只走 GET /world，一次 tick 都不发。
j -X POST "$BASE/a/v1/sim/sessions/$IDS/tick?disclose=1" -d '{"n":3}' -o "$EV/WO-UNDECLARED-VAR-AUDIT-ticksZ.json" -w "ticksZ HTTP=%{http_code}\n"

echo "── 3) 臂 F：新会话（把 30 张 PO 的 procurementDelay set 成 +3，负→正翻转）"
j -X POST "$BASE/a/v1/sim/sessions" -d '{}' -o "$EV/WO-UNDECLARED-VAR-AUDIT-sessF.json" -w "sessF HTTP=%{http_code}\n"
IDF=$(node -e 'const s=require(process.argv[1]);console.log(s.id)' "$EV/WO-UNDECLARED-VAR-AUDIT-sessF.json")
echo "ID_F=$IDF"
j "$BASE/a/v1/sim/sessions/$IDF/world" -o "$EV/WO-UNDECLARED-VAR-AUDIT-worldF-tick0.json" -w "worldF HTTP=%{http_code}\n"
# 30 张采购单逐个扰动（串行；一次一格，避免并发写同一世界）
node -e '
const fs=require("fs");
const w=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const ids=Object.keys(w.state).filter(o=>o.startsWith("obj_purchaseorder_")).sort();
console.log(ids.join("\n"));
' "$EV/WO-UNDECLARED-VAR-AUDIT-worldF-tick0.json" > /tmp/uv-po-ids.txt
echo "PO_N=$(wc -l < /tmp/uv-po-ids.txt)"
: > "$EV/WO-UNDECLARED-VAR-AUDIT-perturbF.jsonl"
while read -r PO; do
  [ -z "$PO" ] && continue
  j -X POST "$BASE/a/v1/sim/sessions/$IDF/perturbations" \
    -d "{\"perturbation\":{\"targetObjectId\":\"$PO\",\"targetStateVar\":\"procurementDelay\",\"magnitude\":3,\"mode\":\"set\"}}" \
    >> "$EV/WO-UNDECLARED-VAR-AUDIT-perturbF.jsonl"
  echo >> "$EV/WO-UNDECLARED-VAR-AUDIT-perturbF.jsonl"
done < /tmp/uv-po-ids.txt
echo "PERTURB_LINES=$(grep -c . "$EV/WO-UNDECLARED-VAR-AUDIT-perturbF.jsonl")"
j -X POST "$BASE/a/v1/sim/sessions/$IDF/tick?disclose=1" -d '{"n":3}' -o "$EV/WO-UNDECLARED-VAR-AUDIT-ticksF.json" -w "ticksF HTTP=%{http_code}\n"

echo "── 4) 臂 F2：coverDays 的对照臂（0 → +10，逼那条被 0 掐死的边）"
j -X POST "$BASE/a/v1/sim/sessions" -d '{}' -o "$EV/WO-UNDECLARED-VAR-AUDIT-sessC.json" -w "sessC HTTP=%{http_code}\n"
IDC=$(node -e 'const s=require(process.argv[1]);console.log(s.id)' "$EV/WO-UNDECLARED-VAR-AUDIT-sessC.json")
echo "ID_C=$IDC"
j "$BASE/a/v1/sim/sessions/$IDC/world" -o "$EV/WO-UNDECLARED-VAR-AUDIT-worldC-tick0.json" -w "worldC HTTP=%{http_code}\n"
node -e '
const fs=require("fs");
const w=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const ids=Object.keys(w.state).filter(o=>o.startsWith("obj_finishedgoodsinventory_")).sort();
console.log(ids.join("\n"));
' "$EV/WO-UNDECLARED-VAR-AUDIT-worldC-tick0.json" > /tmp/uv-fgi-ids.txt
echo "FGI_N=$(wc -l < /tmp/uv-fgi-ids.txt)"
: > "$EV/WO-UNDECLARED-VAR-AUDIT-perturbC.jsonl"
while read -r FGI; do
  [ -z "$FGI" ] && continue
  j -X POST "$BASE/a/v1/sim/sessions/$IDC/perturbations" \
    -d "{\"perturbation\":{\"targetObjectId\":\"$FGI\",\"targetStateVar\":\"coverDays\",\"magnitude\":10,\"mode\":\"set\"}}" \
    >> "$EV/WO-UNDECLARED-VAR-AUDIT-perturbC.jsonl"
  echo >> "$EV/WO-UNDECLARED-VAR-AUDIT-perturbC.jsonl"
done < /tmp/uv-fgi-ids.txt
echo "PERTURB_C_LINES=$(grep -c . "$EV/WO-UNDECLARED-VAR-AUDIT-perturbC.jsonl")"
j -X POST "$BASE/a/v1/sim/sessions/$IDC/tick?disclose=1" -d '{"n":3}' -o "$EV/WO-UNDECLARED-VAR-AUDIT-ticksC.json" -w "ticksC HTTP=%{http_code}\n"

echo "── 5) 链损叠加臂：同两臂各取一次 chain-loss-matrix（带 sessionId）"
echo "   这是 simDeltaDaysFor 的**真消费方**读数：simContext.appliedSteps[] 带 stateValue 与 deltaDays。"
j -X POST "$BASE/a/v1/sim/chain-loss-matrix" -d "{\"sessionId\":\"$IDS\"}" -o "$EV/WO-UNDECLARED-VAR-AUDIT-chainlossZ.json" -w "chainlossZ HTTP=%{http_code}\n"
j -X POST "$BASE/a/v1/sim/chain-loss-matrix" -d "{\"sessionId\":\"$IDF\"}" -o "$EV/WO-UNDECLARED-VAR-AUDIT-chainlossF.json" -w "chainlossF HTTP=%{http_code}\n"
j -X POST "$BASE/a/v1/sim/chain-loss-matrix" -d '{}' -o "$EV/WO-UNDECLARED-VAR-AUDIT-chainloss-none.json" -w "chainloss-none HTTP=%{http_code}\n"

echo "DONE"
