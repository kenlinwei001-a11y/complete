/**
 * 判据探针：12 件业务事件各自的「落点 → 可达集」，跑真后端 55 条已发布规则。
 *
 * 要回答的一件事：控制台「无论输入什么，结论都是一个」——
 *   是「能出结论的事件本来就少」，还是「都能出但汇到同一批格」？
 *
 * 只读：GET propagation-rules + GET view-config，不发任何写请求。
 */
import { buildCellRoles } from "/Users/apple/deploy/wo-edge-wire/packages/contracts/dist/sim.js";

const BASE = "http://127.0.0.1:4001";
const H = { "X-Debug-User": "demo:admin:admin" };

const get = async (p) => {
  const r = await fetch(`${BASE}${p}`, { headers: H });
  if (!r.ok) throw new Error(`${p} -> ${r.status}`);
  return r.json();
};

// ── 12 件事（逐字取自 eventCatalog.ts，含行号出处）──────────────────────────
const EVENTS = [
  { id: "material-price-up",  ln: 168, types: ["Material"],                                     vars: ["priceShock"] },
  { id: "batch-defect",       ln: 182, types: ["QualityLot", "MaterialBatch", "DefectRecord"],  vars: ["inspectBacklog", "defectPressure", "turnoverPressure"] },
  { id: "rush-order",         ln: 196, types: ["Order"],                                        vars: ["qty", "demandPressure"] },
  { id: "due-change",         ln: 213, types: ["OrderPromise", "Order"],                        vars: ["leadDays", "promiseRisk", "shortageRisk"] },
  { id: "order-cancel",       ln: 231, types: ["Order"],                                        vars: ["orderChurn"] },
  { id: "inbound-delay",      ln: 245, types: ["Supplier", "PurchaseOrder", "MaterialBatch"],   vars: ["deliveryDelay", "procurementDelay"] },
  { id: "material-short",     ln: 259, types: ["Material"],                                     vars: ["shortageRisk"] },
  { id: "equipment-down",     ln: 273, types: ["Equipment"],                                    vars: ["equipmentFailure", "loadPressure"] },
  { id: "capacity-loss",      ln: 287, types: ["Base", "Line"],                                 vars: ["loadIndex", "utilPressure"] },
  { id: "ship-to-change",     ln: 301, types: ["CustomerLocation", "InterBaseTransfer"],        vars: ["deliveryHoldRisk", "transferPressure"] },
  { id: "order-reprice",      ln: 315, types: ["Order"],                                        vars: ["unitPrice", "costPressure"] },
  { id: "forecast-bias",      ln: 331, types: ["Model", "DemandSegment"],                       vars: ["forecastBias", "demandLoad"] },
];

const rulesResp = await get("/a/v1/sim/propagation-rules?published=true");
const rules = rulesResp.items ?? [];
const cfg = await get("/a/v1/sim/view-config");
const nodeObjectIds = cfg.nodeObjectIds ?? {};
const countOf = (t) => (nodeObjectIds[t] ?? []).length;

const roles = buildCellRoles(rules);
// 屏上判据：drivable ∧ reachesTypes(...,"Order")  ← Console0828.tsx:524
const CONCLUSION = "Order";
const drivable = new Map();
for (const r of rules) {
  for (const t of [r.sourceTypeKey, r.targetTypeKey]) {
    if (drivable.has(t)) continue;
    const s = new Set();
    drivable.set(t, s);
    for (const v of roles.drivableStateVarsOf(t)) {
      if (roles.reachesTypes(t, v).has(CONCLUSION)) s.add(v);
    }
  }
}

console.log(`# rules=${rules.length}  types=${drivable.size}`);
console.log(`# 全表可落点∧可达Order 的格：`);
let totalCells = 0;
for (const [t, s] of [...drivable].sort()) if (s.size) { totalCells += s.size; console.log(`#   ${t}: ${[...s].sort().join(", ")}`); }
console.log(`# 合计 ${totalCells} 格`);

// 落点（照 eventCatalog.ts:522-536 resolveLanding 逐行）
const resolveLanding = (ev) => {
  const withInst = ev.types.filter((t) => countOf(t) > 0);
  if (withInst.length === 0) return { kind: "no-instance", tried: ev.types };
  for (const t of withInst) {
    const live = drivable.get(t);
    if (live === undefined) continue;
    const hit = ev.vars.find((v) => live.has(v));
    if (hit !== undefined) return { kind: "ok", typeKey: t, stateVar: hit, n: countOf(t) };
  }
  return { kind: "no-statevar", typeKey: withInst[0], tried: ev.vars };
};

// 每个落点格的**完整可达类型集** + 命中的 Order 型格清单（这才是"结论长什么样"）
const ORDER_CELLS = [...drivable.keys()].flatMap((t) => roles.drivableStateVarsOf(t).map((v) => `${t}.${v}`)).filter((k) => k.startsWith("Order") || k.startsWith("OrderPromise") || k.startsWith("ARInvoice") || k.startsWith("Customer"));

console.log("\n# ── 逐件事 ─────────────────────────────────────────────");
const landed = [];
for (const ev of EVENTS) {
  const L = resolveLanding(ev);
  if (L.kind !== "ok") {
    console.log(`${ev.id.padEnd(18)} ${L.kind.padEnd(12)} types=[${L.tried.join(",")}]`);
    continue;
  }
  const reach = [...roles.reachesTypes(L.typeKey, L.stateVar)].sort();
  const money = reach.filter((t) => ["Order", "OrderPromise", "ARInvoice", "Customer"].includes(t));
  landed.push({ ev: ev.id, cell: `${L.typeKey}.${L.stateVar}`, reach, money });
  console.log(`${ev.id.padEnd(18)} ok  ${`${L.typeKey}.${L.stateVar}`.padEnd(28)} 可达 ${String(reach.length).padStart(2)} 型 | 钱相关(${money.length}) [${money.join(",")}]`);
}

console.log("\n# ── 汇流检验：落点各自的可达集是否相同 ──────────────────");
const sig = new Map();
for (const x of landed) {
  const k = x.reach.join("|");
  if (!sig.has(k)) sig.set(k, []);
  sig.get(k).push(`${x.ev}(${x.cell})`);
}
console.log(`# 能落点 ${landed.length} 件，形成 ${sig.size} 个互异可达集`);
for (const [k, who] of sig) console.log(`#   [${who.length} 件] ${who.join(" ")}\n#      -> ${k}`);

console.log("\n# ── Order 型可落点格（结论格的候选面）──────────────────");
console.log(`#   ${ORDER_CELLS.length ? ORDER_CELLS.sort().join(", ") : "（无）"}`);
