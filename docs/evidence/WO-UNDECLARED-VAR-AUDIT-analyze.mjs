/**
 * WO-UNDECLARED-VAR-AUDIT · 9 个未声明状态量 × 真实消费分支 —— 运行期真读分析。
 *
 * ⛔ 本脚本**只读**已抓取的运行期 JSON，不改产品代码 / 测试 / 门。
 * ⛔ 读数一律取自运行期真值（HTTP 抓取的原样回包），**不是 grep 源码**。
 * 预言见同名 capture.sh 头注（提交于取数之前：951ddc4a8，2026-10-04T10:33:59Z）。
 *
 * 每节自带**金丝雀**：正向（已知必中）+ 反向（确信合法的量不许被误报）。金丝雀不中 ⇒ 退出码 2。
 */
import fs from "node:fs";
const EV = new URL(".", import.meta.url).pathname;
const J = (n) => JSON.parse(fs.readFileSync(EV + n, "utf8"));

const NINE = ["qty", "unitPrice", "leadDays", "backlogQtyTop", "backlogPriceTop", "coverDays", "deliveryDelay", "procurementDelay", "clearanceQueueDays"];

const vc = J("WO-UNDECLARED-VAR-AUDIT-view-config.json");
const rules = J("WO-UNDECLARED-VAR-AUDIT-rules.json").items.filter((r) => r.status === "PUBLISHED");
const idsByType = vc.nodeObjectIds;
const typeOf = {};
for (const [t, ids] of Object.entries(idsByType)) for (const o of ids) typeOf[o] = t;

let CANARY_FAIL = 0;
function canary(ok, label) {
  console.log(`   [金丝雀${ok ? "✅" : "❌"}] ${label}`);
  if (!ok) CANARY_FAIL++;
}

// ══════════════════════════════════════════════════════════════════════════
console.log("══ §0 · 自证：读的是本树实例（不是 4001/4002 别人的部署）══════");
console.log(`   view-config 对象类型数 = ${Object.keys(idsByType).length}，对象数 = ${Object.values(idsByType).reduce((a, b) => a + b.length, 0)}`);
const world = J("WO-UNDECLARED-VAR-AUDIT-worldZ-tick0.json");
console.log(`   world-tick0.tick = ${world.tick}（⛔ 本单一次 /tick 都没发过就读到 tick0）`);
console.log(`   baseStateVarReport.undeclaredStateVars = ${JSON.stringify(world.baseStateVarReport.undeclaredStateVars)}`);
const undeclaredFromRuntime = world.baseStateVarReport.undeclaredStateVars;
canary(JSON.stringify([...undeclaredFromRuntime].sort()) === JSON.stringify([...NINE].sort()),
  `运行期点名的未声明量 = 本单要审的 9 个（${undeclaredFromRuntime.length} 个）`);
const satTick0 = world.baseStateVarReport.saturations;
const satOnNine = satTick0.filter((s) => NINE.includes(s.stateVar));
console.log(`   tick0 入口投影饱和事件 ${satTick0.length} 条；其中落在 9 个未声明量上的 = ${satOnNine.length} 条`);
canary(satOnNine.length === 0, "9 个未声明量在 tick0 被投影夹过 0 条（未声明 ⇒ projectWorldCells 直接 continue）");

// ══════════════════════════════════════════════════════════════════════════
console.log("\n══ §1 · 9 个量 × tick0 运行期实测区间（按承载类型拆开）══════");
const state = world.state;
function cellsOf(typeKey, varName) {
  const out = [];
  for (const oid of idsByType[typeKey] ?? []) {
    const v = state[oid]?.[varName];
    if (typeof v === "number") out.push({ oid, v });
  }
  return out;
}
/** 该量在世界态里出现在哪些类型上（运行时真读，不是按名推断）。 */
function carriersOf(varName) {
  const byType = {};
  for (const [oid, bucket] of Object.entries(state)) {
    if (typeof bucket?.[varName] === "number") {
      const t = typeOf[oid] ?? "UNKNOWN";
      (byType[t] ??= []).push(bucket[varName]);
    }
  }
  return byType;
}
const measured = {};
for (const v of NINE) {
  const byType = carriersOf(v);
  measured[v] = byType;
  const parts = Object.entries(byType).map(([t, arr]) => {
    const mn = Math.min(...arr), mx = Math.max(...arr);
    const neg = arr.filter((x) => x < 0).length, zero = arr.filter((x) => x === 0).length;
    return `${t} n=${arr.length} [${mn}, ${mx}] 负${neg} 零${zero}`;
  });
  const all = Object.values(byType).flat();
  console.log(`   ${v.padEnd(19)} 总格=${String(all.length).padStart(4)}  ${parts.length ? parts.join(" | ") : "⛔ 世界态里无格"}`);
}
console.log("\n   结构化判据（来自本树 dist 的 STATE_VAR_DOMAINS，那是**声明**不是取值）：");
const { STATE_VAR_DOMAINS } = await import("../../apps/datacore/dist/synthetic/battery.js");
canary(NINE.every((v) => STATE_VAR_DOMAINS[v] === undefined), "9 个量在 STATE_VAR_DOMAINS 里逐个查不到（金丝雀：域表读数本身有效）");
canary(Object.keys(STATE_VAR_DOMAINS).length === 38, `域表条数 = ${Object.keys(STATE_VAR_DOMAINS).length}（应为 38，与上一单对齐）`);

// ══════════════════════════════════════════════════════════════════════════
console.log("\n══ §2 · 每个量的**真实消费方**（规则表 = 运行期真读的 55 条，不是源码）══════");
const rulesAsSource = {}, rulesAsTarget = {};
for (const r of rules) {
  (rulesAsSource[r.sourceStateVar] ??= []).push(r);
  (rulesAsTarget[r.targetStateVar] ??= []).push(r);
}
for (const v of NINE) {
  const src = rulesAsSource[v] ?? [], tgt = rulesAsTarget[v] ?? [];
  console.log(`   ${v}`);
  for (const r of src) {
    console.log(`      [源] ${r.key}  coeff=${r.coefficient} combine=${r.combine} reaction=${r.reaction == null ? "null(无容忍线)" : JSON.stringify(r.reaction)} clamp=${r.clamp == null ? "null" : JSON.stringify(r.clamp)} weightRef=${r.weightRef == null ? "null" : JSON.stringify(r.weightRef)} delayTicks=${r.delayTicks}`);
    console.log(`           ${r.sourceTypeKey}.${r.sourceStateVar} --${r.viaLinkKey}--> ${r.targetTypeKey}.${r.targetStateVar}`);
  }
  for (const r of tgt) console.log(`      [靶] ${r.key} ← ${r.sourceTypeKey}.${r.sourceStateVar} (combine=${r.combine})`);
  if (!src.length && !tgt.length) console.log("      ⛔ 规则表里零命中 —— 它不是任何传导边的源或靶");
  // 靶格的出度（该量自己是不是别人的源）—— 决定「有没有下游分支可被打死」
  if (tgt.length && !src.length) console.log(`      ⇒ 出度 0（无规则读它）⇒ 它自己是**叶子**，不存在下游消费分支`);
}

// ══════════════════════════════════════════════════════════════════════════
console.log("\n══ §3 · 引擎里以「状态量的值」为条件的**全部**分支（propagation.ts 运行期路径）══════");
console.log("   B1  sourceVal === 0                → continue（该边本拍整条不触发）");
console.log("   B2  drive = reaction==null ? sourceVal : max(0, sourceVal − tol)");
console.log("   B3  drive === 0                    → continue");
console.log("   B4  baseAmount === 0               → continue");
console.log("   B5  amount === 0（权份额为 0）      → continue");
console.log("   B6  rule.clamp 非空 → min/max 夹值  （本表全部 clamp=null ⇒ 不适用）");
console.log("   B7  chain-loss.ts simDeltaDaysFor: deltaDays = Math.max(0, cell)");
const anyClamp = rules.filter((r) => r.clamp != null).length;
const anyReaction = rules.filter((r) => r.reaction != null).length;
console.log(`   实测：55 条里 clamp 非空 = ${anyClamp} 条；reaction 非空 = ${anyReaction} 条（B2 只对还手边生效）`);
for (const r of rules.filter((x) => x.clamp != null)) console.log(`      ⚠ clamp 非空的是 ${r.key}：clamp=${JSON.stringify(r.clamp)} ⇒ ${r.sourceTypeKey}.${r.sourceStateVar} → ${r.targetTypeKey}.${r.targetStateVar}`);
canary(anyClamp === 1 && rules.filter((x) => x.clamp != null)[0].targetStateVar !== "shortageRisk",
  "clamp 非空 = 1 条，且它的靶**不是** Material.shortageRisk ⇒ B6 与本单 9 个量的落点无关");
canary(anyReaction === 1, "reaction 非空 = 1 ⇒ B2 只影响 1 条边（与上一单 ② 逐条对齐）");

// ── B1 逐边可达性：源区间里有没有恰好 0 ──
console.log("\n   ── B1（`sourceVal === 0 ⇒ 该边本拍不触发`）逐边可达性 ──");
for (const v of NINE) {
  for (const r of rulesAsSource[v] ?? []) {
    const arr = (carriersOf(v)[r.sourceTypeKey] ?? []);
    const zeros = arr.filter((x) => x === 0).length;
    console.log(`      ${r.key}: 源 ${r.sourceTypeKey}.${v} n=${arr.length} 恰为 0 的格 = ${zeros}/${arr.length} ⇒ B1 ${zeros === arr.length && arr.length > 0 ? "🔴 每拍都命中（边永不通）" : zeros > 0 ? "部分命中" : "不命中"}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log("\n══ §4 · 零扰动臂 Z（3 拍，disclose=1）—— 每条边的真实命中与贡献数 ══════");
function ruleItems(file) {
  const t = J(file);
  return { items: t.disclosure.rules.items, constraints: t.disclosure.constraints, contributions: t.disclosure.rules.contributions };
}
const Z = ruleItems("WO-UNDECLARED-VAR-AUDIT-ticksZ.json");
console.log(`   最后一拍贡献条数 contributions = ${Z.contributions}；declared=54 fired=${Z.items.filter((i) => i.fired).length}`);
const notFiredZ = Z.items.filter((i) => !i.fired).map((i) => i.ruleKey);
console.log(`   未 fired 的规则（${notFiredZ.length} 条）：${notFiredZ.length ? JSON.stringify(notFiredZ) : "（无）"}`);

// ══════════════════════════════════════════════════════════════════════════
console.log("\n══ §5 · 判决实验 · 臂 Z（零扰动）vs 臂 F（procurementDelay 负→正翻转）vs 臂 C（coverDays 0→10）══");
function compare(file, label) {
  const T = ruleItems(file);
  const out = { label, items: T.items };
  for (const k of ["demo_po_procurement_delay_to_material_shortage", "demo_batch_procurement_delay_to_material_shortage", "demo_supplier_procurement_delay_to_material_shortage", "demo_fg_cover_days_to_model_demand", "demo_order_leaddays_to_model_horizon", "demo_supplier_delay_to_material_shortage", "demo_order_qty_to_model_top_qty", "demo_order_price_to_model_top_price"]) {
    const it = T.items.find((i) => i.ruleKey === k);
    out[k] = it ? it.fired : "NOT_IN_TABLE";
  }
  return out;
}
const armZ = compare("WO-UNDECLARED-VAR-AUDIT-ticksZ.json", "Z");
const armF = compare("WO-UNDECLARED-VAR-AUDIT-ticksF.json", "F");
const armC = compare("WO-UNDECLARED-VAR-AUDIT-ticksC.json", "C");
const watch = ["demo_po_procurement_delay_to_material_shortage", "demo_batch_procurement_delay_to_material_shortage", "demo_supplier_procurement_delay_to_material_shortage", "demo_fg_cover_days_to_model_demand", "demo_order_leaddays_to_model_horizon", "demo_supplier_delay_to_material_shortage", "demo_order_qty_to_model_top_qty", "demo_order_price_to_model_top_price"];
console.log("   规则".padEnd(58) + "臂Z(零扰动)  臂F(PO翻正)  臂C(coverDays→10)");
for (const k of watch) console.log("   " + k.padEnd(56) + String(armZ[k]).padEnd(12) + String(armF[k]).padEnd(13) + String(armC[k]));

// ══════════════════════════════════════════════════════════════════════════
console.log("\n══ §6 · 世界态差分：扰动**真的落地了吗**（零扰动对照的判据）══");
function worldOf(f) { return J(f).state; }
const wz = worldOf("WO-UNDECLARED-VAR-AUDIT-worldZ-tick0.json");
const wf = worldOf("WO-UNDECLARED-VAR-AUDIT-worldF-tick0.json");
const wc = worldOf("WO-UNDECLARED-VAR-AUDIT-worldC-tick0.json");
function diffCount(a, b, varName) {
  let n = 0, maxAbs = 0;
  for (const oid of Object.keys(b)) {
    const x = a[oid]?.[varName], y = b[oid]?.[varName];
    if (typeof x === "number" && typeof y === "number" && Math.abs(x - y) > 1e-12) { n++; maxAbs = Math.max(maxAbs, Math.abs(x - y)); }
  }
  return { n, maxAbs };
}
for (const [nm, A, B] of [["臂F vs 臂Z", wz, wf], ["臂C vs 臂Z", wz, wc]]) {
  const d = diffCount(A, B, "procurementDelay");
  const d2 = diffCount(A, B, "coverDays");
  console.log(`   ${nm}：procurementDelay 差异格 = ${d.n}（最大 |Δ|=${d.maxAbs}）；coverDays 差异格 = ${d2.n}（最大 |Δ|=${d2.maxAbs}）`);
}
canary(diffCount(wz, wf, "procurementDelay").n === 30, "臂 F 真的把 30 张 PO 的 procurementDelay 改了（扰动落地自证）");
canary(diffCount(wz, wc, "coverDays").n === 18, "臂 C 真的把 18 个 FGI 的 coverDays 改了（扰动落地自证）");
console.log("   ⛔ 注意：这只是「扰动落地」的自证，**不度量传导** —— 传导看 §7。");

// ══════════════════════════════════════════════════════════════════════════
console.log("\n══ §7 · 链损叠加（simDeltaDaysFor 的真消费方读数：chain-loss-matrix.simContext）══");
for (const [lbl, f] of [["臂Z", "WO-UNDECLARED-VAR-AUDIT-chainlossZ.json"], ["臂F", "WO-UNDECLARED-VAR-AUDIT-chainlossF.json"], ["无会话(对照)", "WO-UNDECLARED-VAR-AUDIT-chainloss-none.json"]]) {
  const m = J(f);
  const sc = m.simContext;
  if (!sc) { console.log(`   ${lbl}: simContext 缺席（= 不传 sessionId ⇒ 与本字段引入前逐字节相同）`); continue; }
  console.log(`   ${lbl}: sessionId=${sc.sessionId} tick=${sc.tick} appliedDays=${sc.appliedDays} appliedSteps=${sc.appliedSteps.length}`);
  for (const a of sc.appliedSteps) console.log(`      ${a.stepId.padEnd(22)} ${a.stateVar.padEnd(20)} stateValue=${a.stateValue}  deltaDays=${a.deltaDays}`);
  console.log(`      excluded: ${JSON.stringify(sc.excluded)}`);
}

console.log("\n" + (CANARY_FAIL === 0 ? "✅ 全部金丝雀通过" : `❌ ${CANARY_FAIL} 处金丝雀不中 —— 按纪律报「工具坏了」，本文件读数作废`));
process.exit(CANARY_FAIL === 0 ? 0 : 2);
