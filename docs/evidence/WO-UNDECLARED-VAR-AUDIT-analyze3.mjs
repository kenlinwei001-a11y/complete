/**
 * WO-UNDECLARED-VAR-AUDIT · 终版分析仪（第三版；前两版读数已按纪律作废，理由见 capture3.sh 头注）
 *
 * ⛔ 只读已抓取的运行期 JSON；不改产品代码 / 测试 / 门。
 * ⛔ 读数全部来自运行期真值（HTTP 原样回包 + 真起的实例上的对象读），不是 grep 源码。
 * 预言：capture.sh 头注（提交于取数之前 951ddc4a8 / 2026-10-04T10:33:59Z），逐字未改。
 *
 * 金丝雀分两类，**缺任一类本文件读数即作废**：
 *   · 正向（已知必中）：主线索的 30/30 负必须复现；扰动必须真的翻转动它。
 *   · 负向（确信合法、不许被误报成缺陷）：见 §N —— 一个**带符号且已声明**的量（forecastBias）
 *     在域内为负是合法的；我的「取值落在域的一侧」判法不许把它报成缺陷。
 */
import fs from "node:fs";
const EV = new URL(".", import.meta.url).pathname;
const J = (n) => JSON.parse(fs.readFileSync(EV + n, "utf8"));
const NINE = ["qty", "unitPrice", "leadDays", "backlogQtyTop", "backlogPriceTop", "coverDays", "deliveryDelay", "procurementDelay", "clearanceQueueDays"];
let FAIL = 0;
function canary(ok, label) { console.log(`   [金丝雀${ok ? "✅" : "❌"}] ${label}`); if (!ok) FAIL++; }
const stat = (a) => a.length ? `n=${String(a.length).padStart(4)} [${Math.min(...a)}, ${Math.max(...a)}] 负${a.filter((x) => x < 0).length} 正${a.filter((x) => x > 0).length} 零${a.filter((x) => x === 0).length}` : "⛔ 无格";
const traceByRule = (t) => { const m = {}; for (const e of t.trace) (m[e.ruleKey] ??= []).push(e.amount); return m; };
const vc = J("WO-UNDECLARED-VAR-AUDIT-view-config.json");
const rules = J("WO-UNDECLARED-VAR-AUDIT-rules.json").items.filter((r) => r.status === "PUBLISHED");
const idsByType = vc.nodeObjectIds; const typeOf = {};
for (const [t, ids] of Object.entries(idsByType)) for (const o of ids) typeOf[o] = t;

const { STATE_VAR_DOMAINS } = await import("../../apps/datacore/dist/synthetic/battery.js");
const t0 = J("WO-UNDECLARED-VAR-AUDIT-worldZ3-tick0.json");
const t3 = J("WO-UNDECLARED-VAR-AUDIT-ticksZ3.json");

// ══════════════════════════════════════════════════════════════════════════
console.log("══ §0 · 自证 + 主线索复现（正向金丝雀）══════");
console.log(`   实例：127.0.0.1:4511，对象类型 ${Object.keys(idsByType).length} 种`);
console.log(`   tick0 世界 undeclaredStateVars = ${JSON.stringify(t0.baseStateVarReport.undeclaredStateVars)}`);
canary(JSON.stringify([...t0.baseStateVarReport.undeclaredStateVars].sort()) === JSON.stringify([...NINE].sort()), "运行期点名的未声明量 = 本单要审的 9 个");
canary((t0.baseStateVarReport.saturations ?? []).filter((s) => NINE.includes(s.stateVar)).length === 0, "9 个未声明量在 tick0 入口投影被夹 0 条（未声明 ⇒ projectWorldCells 直接 continue）");
const po0 = []; for (const [oid, b] of Object.entries(t0.state)) if (oid.startsWith("obj_purchaseorder_") && typeof b.procurementDelay === "number") po0.push(b.procurementDelay);
console.log(`   主线索：PurchaseOrder.procurementDelay tick0 = ${stat(po0)}`);
canary(po0.length === 30 && po0.every((x) => x < 0) && Math.min(...po0) >= -7 && Math.max(...po0) <= -1, "正向金丝雀：30/30 全负、区间 ⊂ [-7,-1]（复现上一单 ca7205a36 的实数）");

// ══════════════════════════════════════════════════════════════════════════
console.log("\n══ §N · 负向金丝雀：已声明且带符号的量，在域内为负是合法的，不许被报成缺陷 ══════");
console.log(`   STATE_VAR_DOMAINS 条数 = ${Object.keys(STATE_VAR_DOMAINS).length}`);
const signedDeclared = Object.entries(STATE_VAR_DOMAINS).filter(([, d]) => d.min < 0).map(([k]) => k);
console.log(`   已声明且域下界 < 0 的量：${JSON.stringify(signedDeclared)}`);
const fb = []; for (const b of Object.values(t0.state)) if (typeof b.forecastBias === "number") fb.push(b.forecastBias);
console.log(`   Forecast.forecastBias（已声明，域 min=${STATE_VAR_DOMAINS.forecastBias.min}）tick0 = ${stat(fb)}`);
canary(signedDeclared.length > 0 && signedDeclared.includes("forecastBias"), "存在已声明且**下界为负**的量 ⇒ 「负值」本身不是缺陷判据");
console.log(`   ⚠ NOT-MEASURED：forecastBias 今天实测 ${stat(fb)} —— **不含负值**，故「我的判法面对一个域内合法为负的已声明量时保持沉默」这一臂**没有活样本**，如实登记为未测到，不拿它充当已通过。`);
// 负向金丝雀（真正的活样本）：
//  ① 同一条边上**两种符号都出现** ⇒ 我的「取值落在一侧」判法不许把它报成「单侧 ⇒ 分支死」。
const spZ = (() => { const m = {}; for (const e of t3.trace) (m[e.ruleKey] ??= []).push(e.amount); return m; })()["demo_supplier_procurement_delay_to_material_shortage"] ?? [];
console.log(`   ① Supplier.procurementDelay 边实测 ${stat(spZ)} —— 同一条边上两符号并存`);
canary(spZ.some((x) => x < 0) && spZ.some((x) => x > 0), "① 负向金丝雀：该边两符号并存 ⇒ 我的判法**没有**把它误报成「单侧 ⇒ 分支死」（确信它合法：货早到/晚到都该有贡献）");
//  ② Supplier.procurementDelay 2 格恰为 0 ⇒ 我的 B1 仪器会报「部分命中」。它不是缺陷（延迟 0 = 准时 ⇒ 本就无贡献）。
const sup0 = []; for (const [oid, b] of Object.entries(t0.state)) if (typeOf[oid] === "Supplier" && typeof b.procurementDelay === "number") sup0.push(b.procurementDelay);
console.log(`   ② Supplier.procurementDelay 实测 ${stat(sup0)}；该边 trace n=${spZ.length}（= ${sup0.length} − ${sup0.filter((x) => x === 0).length}）`);
canary(sup0.filter((x) => x === 0).length === 2 && spZ.length === 13, "② 负向金丝雀：仪器**会**报「2 格恰为 0 ⇒ B1 部分命中」，而取值 0 = 准时 ⇒ 本就不该有贡献 —— 判法是活的，但它报的这件事**不是缺陷**");

// ══════════════════════════════════════════════════════════════════════════
console.log("\n══ §1 · 9 个量 × 运行期实测区间 × 承载类型 × 声明状态 ══════");
const rows = [];
for (const v of NINE) {
  const byType = {};
  for (const [oid, b] of Object.entries(t0.state)) if (typeof b?.[v] === "number") (byType[typeOf[oid] ?? "UNKNOWN"] ??= []).push(b[v]);
  const all = Object.values(byType).flat();
  const asSrc = rules.filter((r) => r.sourceStateVar === v), asTgt = rules.filter((r) => r.targetStateVar === v);
  const dom = STATE_VAR_DOMAINS[v];
  rows.push({ v, n: all.length, mn: all.length ? Math.min(...all) : null, mx: all.length ? Math.max(...all) : null, neg: all.filter((x) => x < 0).length, zero: all.filter((x) => x === 0).length, carriers: Object.keys(byType), dom: dom ? `[${dom.min},${dom.max}] rest ${dom.rest}` : "**无（未声明）**", srcEdges: asSrc.map((r) => r.key), tgtEdges: asTgt.map((r) => r.key) });
  console.log(`   ${v.padEnd(19)} ${stat(all).padEnd(44)} 承载=${JSON.stringify(Object.keys(byType))} 声明=${dom ? "有" : "无"}`);
  console.log(`      出边(${asSrc.length})：${asSrc.map((r) => `${r.key}(→${r.targetStateVar},coeff=${r.coefficient},combine=${r.combine})`).join(" ") || "（无规则读它 ⇒ 出度 0）"}`);
  console.log(`      入边(${asTgt.length})：${asTgt.map((r) => `${r.key}(←${r.sourceTypeKey}.${r.sourceStateVar})`).join(" ") || "（无）"}`);
}
canary(rows.every((r) => r.dom === "**无（未声明）**"), "9 个量在 STATE_VAR_DOMAINS 里逐个查不到（域表读数本身有效）");
canary(Object.keys(STATE_VAR_DOMAINS).length === 38, `域表条数 = ${Object.keys(STATE_VAR_DOMAINS).length}（应与上一单的 38 对齐）`);

// ══════════════════════════════════════════════════════════════════════════
console.log("\n══ §2 · 引擎里以「状态量的值」为条件的全部分支（propagation.ts 真路径）══════");
console.log("   B1 sourceVal === 0 → continue ｜ B2 drive = reaction==null ? sourceVal : max(0,src−tol)"
  + "\n   B3 drive === 0 → continue ｜ B4 baseAmount === 0 → continue ｜ B5 amount === 0 → continue ｜ B6 rule.clamp");
const anyClamp = rules.filter((r) => r.clamp != null), anyReaction = rules.filter((r) => r.reaction != null);
console.log(`   实测 ${rules.length} 条：clamp 非空 ${anyClamp.length} 条（${anyClamp.map((r) => r.key + "→" + r.targetStateVar).join(",")}）；reaction 非空 ${anyReaction.length} 条`);
canary(anyReaction.length === 1, "reaction 非空 = 1 ⇒ B2 只对 1 条边生效（与上一单 ② 对齐）");
console.log("   ── B1 逐边可达性（源区间里有没有恰好 0）──");
const zt = traceByRule(t3);
for (const r of rules.filter((r) => NINE.includes(r.sourceStateVar))) {
  const arr = []; for (const [oid, b] of Object.entries(t0.state)) if (typeOf[oid] === r.sourceTypeKey && typeof b[r.sourceStateVar] === "number") arr.push(b[r.sourceStateVar]);
  const z = arr.filter((x) => x === 0).length;
  const tr = zt[r.key] ?? [];
  console.log(`      ${r.key.padEnd(56)} 源 ${r.sourceTypeKey} n=${arr.length} 恰为0=${z} ⇒ B1 ${z === arr.length && arr.length > 0 ? "🔴每拍命中" : z > 0 ? "部分命中" : "不命中"}；trace 实测 n=${tr.length}`);
}

// ══════════════════════════════════════════════════════════════════════════
console.log("\n══ §3 · 判决实验：四臂逐边 amount（同一支对照两份：零扰动 Z3 + 无关扰动 C3/L3）══════");
const ARMS = { Z3: "WO-UNDECLARED-VAR-AUDIT-ticksZ3.json", F3: "WO-UNDECLARED-VAR-AUDIT-ticksF3.json", C3: "WO-UNDECLARED-VAR-AUDIT-ticksC3.json", L3: "WO-UNDECLARED-VAR-AUDIT-ticksL3.json" };
const T = {}; for (const [a, f] of Object.entries(ARMS)) T[a] = traceByRule(J(f));
const WATCH = ["demo_po_procurement_delay_to_material_shortage", "demo_fg_cover_days_to_model_demand", "demo_order_leaddays_to_model_horizon", "demo_supplier_procurement_delay_to_material_shortage", "demo_batch_procurement_delay_to_material_shortage", "demo_supplier_delay_to_material_shortage"];
for (const k of WATCH) {
  console.log(`   ${k}`);
  for (const a of ["Z3", "F3", "C3", "L3"]) { const x = T[a][k] ?? []; console.log(`      ${a}  ${stat(x)}  Σ=${x.reduce((s, y) => s + y, 0).toFixed(6)}`); }
}
const poZ = T.Z3["demo_po_procurement_delay_to_material_shortage"], poF = T.F3["demo_po_procurement_delay_to_material_shortage"];
canary(poZ.length === 30 && poZ.every((x) => x < 0), "P2 前半：臂 Z3 该边 30/30 条贡献全负（复现主线索）");
canary(poF.length === 30 && poF.every((x) => x > 0), "P2 后半：臂 F3 该边 30/30 条贡献翻正（P1 的 0/N → N/N 形态成立）");
canary(JSON.stringify(T.C3["demo_po_procurement_delay_to_material_shortage"]) === JSON.stringify(poZ) && JSON.stringify(T.L3["demo_po_procurement_delay_to_material_shortage"]) === JSON.stringify(poZ), "无关扰动臂 C3/L3 上该边逐边 amount 与 Z3 相同 ⇒ 翻转是 PO 扰动引起的，不是「任何扰动都翻转」");
const cdZ = T.Z3["demo_fg_cover_days_to_model_demand"], cdC = T.C3["demo_fg_cover_days_to_model_demand"];
canary(cdZ.length === 18 && cdZ.every((x) => x < 0), "coverDays 边在零扰动臂每拍 18/18 命中（H1「源恒 0 ⇒ 边永不通」当场判死）");
canary(Math.abs(cdC.reduce((s, y) => s + y, 0)) > 3 * Math.abs(cdZ.reduce((s, y) => s + y, 0)), `臂 C3 该边 Σ 由 ${cdZ.reduce((s, y) => s + y, 0).toFixed(6)} 走到 ${cdC.reduce((s, y) => s + y, 0).toFixed(6)}（>3×）⇒ 该边随输入变`);
const lZ = T.Z3["demo_order_leaddays_to_model_horizon"], lL = T.L3["demo_order_leaddays_to_model_horizon"];
canary(lZ.filter((x) => x > 0).length === 23 && lL.filter((x) => x > 0).length === 0, `P5：leadDays 边正贡献数 Z3=${lZ.filter((x) => x > 0).length} → L3=${lL.filter((x) => x > 0).length}（恰为 23 张负 leadDays）`);

// ══════════════════════════════════════════════════════════════════════════
console.log("\n══ §4 · 靶格终态差分（扰动真的走到下游了吗）═══");
const st = {}; for (const [a, f] of Object.entries(ARMS)) st[a] = J(f).state;

for (const [v, lb] of [["shortageRisk", "Material.shortageRisk"], ["demandLoad", "Model.demandLoad"], ["costPressure", "Model.costPressure"]]) {
  const zc = []; for (const b of Object.values(st.Z3)) if (typeof b?.[v] === "number") zc.push(b[v]);
  console.log(`   ${lb} 臂Z3 n=${zc.length} [${Math.min(...zc).toFixed(4)}, ${Math.max(...zc).toFixed(4)}]`);
  for (const a of ["F3", "C3", "L3"]) {
    let n = 0, mx = 0, up = 0, dn = 0;
    for (const oid of Object.keys(st[a])) { const x = st.Z3[oid]?.[v], y = st[a][oid]?.[v]; if (typeof x === "number" && typeof y === "number" && Math.abs(x - y) > 1e-9) { n++; if (y > x) up++; else dn++; if (Math.abs(y - x) > Math.abs(mx)) mx = y - x; } }
    console.log(`      vs ${a}: 差异 ${n}（升${up}/降${dn}）最大Δ=${mx.toFixed(6)}`);
  }
}
const srAny = (a) => { let n = 0; for (const oid of Object.keys(st[a])) { const x = st.Z3[oid]?.shortageRisk, y = st[a][oid]?.shortageRisk; if (typeof x === "number" && typeof y === "number" && Math.abs(x - y) > 1e-9) n++; } return n; };
canary(srAny("F3") === 158 && srAny("C3") === 0 && srAny("L3") === 0, `P1：shortageRisk 差异格 F3=${srAny("F3")}/158 全升、C3=${srAny("C3")}、L3=${srAny("L3")} ⇒ 该边确实驱动下游，且只有 PO 扰动驱动`);

// ══════════════════════════════════════════════════════════════════════════
console.log("\n══ §5 · 链损叠加（simDeltaDaysFor 的真消费方；主线索的杀手读数）═══");
for (const a of ["Z3", "F3", "C3", "L3", "NONE"]) {
  const sc = J(`WO-UNDECLARED-VAR-AUDIT-cl${a}.json`).simContext;
  if (!sc) { console.log(`   ${a}: simContext 缺席（= 不传 sessionId ⇒ 与本字段引入前逐字节相同）`); continue; }
  const it = sc.appliedSteps.find((s) => s.stateVar === "procurementDelay");
  console.log(`   ${a}: tick=${sc.tick} appliedDays=${sc.appliedDays}`);
  for (const s of sc.appliedSteps) console.log(`      ${String(s.stepId).padEnd(24)} ${String(s.stateVar).padEnd(18)} stateValue=${String(s.stateValue).padEnd(22)} deltaDays=${s.deltaDays}`);
  console.log(`      PO 腿：stateValue=${it ? it.stateValue : "（不在 appliedSteps）"} deltaDays=${it ? it.deltaDays : "-"}`);
}
const cz = J("WO-UNDECLARED-VAR-AUDIT-clZ3.json").simContext, cf = J("WO-UNDECLARED-VAR-AUDIT-clF3.json").simContext, cc = J("WO-UNDECLARED-VAR-AUDIT-clC3.json").simContext;
const itz = cz.appliedSteps.find((s) => s.stateVar === "procurementDelay"), itf = cf.appliedSteps.find((s) => s.stateVar === "procurementDelay");
canary(itz && itz.stateValue < 0 && itz.deltaDays === 0, `P3 前半：臂 Z3 PO 腿 stateValue=${itz?.stateValue} < 0、deltaDays=${itz?.deltaDays}（clamp 把「早到 4 天」吞成 0）`);
canary(itf && itf.stateValue > 0 && itf.deltaDays > 0, `P3 后半：臂 F3 同一项 stateValue=${itf?.stateValue} > 0、deltaDays=${itf?.deltaDays} > 0 ⇒ Math.max(0,cell) 是活代码，随输入变`);
canary(Math.abs((cf.appliedDays - cz.appliedDays) - 3) < 1e-9, `appliedDays Z3=${cz.appliedDays} → F3=${cf.appliedDays}，差 ${(cf.appliedDays - cz.appliedDays).toFixed(9)}（= 翻转值 3）`);
canary(cc.appliedDays === cz.appliedDays, `无关扰动臂 C3 appliedDays=${cc.appliedDays} 与 Z3 逐位相同（对照臂）`);

// ══════════════════════════════════════════════════════════════════════════
console.log("\n══ §6 · Order.leadDays 的第二消费方：readBaseContention 的 (lead > 0) 守卫 ═══");
const ord = J("WO-UNDECLARED-VAR-AUDIT-orders.json").items;
const OPEN = "OPEN";
const openAll = ord.filter((o) => o.props?.status === OPEN);
const guardHit = openAll.filter((o) => { const q = o.props?.qty, l = o.props?.leadDays; return !Number.isFinite(q) || !Number.isFinite(l) || !(q > 0) || !(l > 0); });
const negAll = ord.filter((o) => typeof o.props?.leadDays === "number" && o.props.leadDays <= 0);
console.log(`   Order 总数 ${ord.length}：leadDays ≤ 0 的 ${negAll.length} 张，其中 status 分布 = ${JSON.stringify(negAll.reduce((m, o) => (m[o.props.status] = (m[o.props.status] ?? 0) + 1, m), {}))}`);
console.log(`   readBaseContention 只收 status=OPEN 的 ${openAll.length} 张；其中被 (lead>0) 守卫挡下的 = ${guardHit.length} 张`);
const ci = J("WO-UNDECLARED-VAR-AUDIT-chainimpediments.json").data.contention;
console.log(`   求解器回包 contention：verdict=${ci.verdict} basesScanned=${ci.basesScanned} contendedBases=${JSON.stringify(ci.contendedBases)}`);
console.log(`   note 含「另有 N 张订单…被排除」? ${/另有 \d+ 张订单/.test(ci.note)}（该句只在 skipped>0 时拼接）`);
canary(openAll.length === 50, `OPEN 订单 = ${openAll.length} 张（金丝雀：对象读确实取到了订单；total=${J("WO-UNDECLARED-VAR-AUDIT-orders.json").total}）`);
canary(guardHit.length === 0 && !/另有 \d+ 张订单/.test(ci.note), "该守卫今天 0 命中（两条独立读数：直接读 props + 求解器 note 未拼该句）⇒ 负 leadDays 全在非 OPEN 状态，被**更早**的 status 过滤挡掉");

console.log("\n" + (FAIL === 0 ? "✅ 全部金丝雀通过" : `❌ ${FAIL} 处金丝雀不中 —— 按纪律报「工具坏了」，本文件读数作废`));
process.exit(FAIL === 0 ? 0 : 2);
