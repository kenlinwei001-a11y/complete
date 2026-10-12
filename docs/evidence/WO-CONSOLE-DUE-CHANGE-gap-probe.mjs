/**
 * 缺口探针：为「due-change 落点 → 财务指标变化」算**确切缺哪些边**。
 * 只读，跑真后端 55 条已发布规则。
 */
import { buildCellRoles } from "/Users/apple/deploy/wo-edge-wire/packages/contracts/dist/sim.js";
const BASE = "http://127.0.0.1:4001";
const H = { "X-Debug-User": "demo:admin:admin" };
const r = await fetch(`${BASE}/a/v1/sim/propagation-rules?published=true`, { headers: H });
const rules = (await r.json()).items ?? [];
const roles = buildCellRoles(rules);
const MONEY = ["Customer", "ARInvoice", "OverdueRecord"];

const ALL = [...new Set(rules.flatMap((x) => [x.sourceTypeKey, x.targetTypeKey]))].sort();

console.log(`# rules=${rules.length}`);
console.log("\n# ── ① 订单三个量今天能到哪 ─────────────────────────────");
for (const v of ["qty", "leadDays", "unitPrice", "costPressure", "shortageRisk", "demandPressure"]) {
  const s = [...roles.reachesTypes("Order", v)].sort();
  console.log(`Order.${v.padEnd(16)} ${String(s.length).padStart(2)} 型  ${s.length ? s.join(",") : "（只有自己/无）"}`);
}

console.log("\n# ── ② 有边指向 Order 的「源格」（= 回到 Order 的入口）────");
const into = new Map();
for (const x of rules) if (x.targetTypeKey === "Order") {
  const k = `${x.sourceTypeKey}.${x.sourceStateVar}`;
  (into.get(k) ?? into.set(k, []).get(k)).push(`${x.targetStateVar}${x.delayTicks ? `(d${x.delayTicks})` : ""}`);
}
for (const [k, v] of [...into].sort()) console.log(`  ${k.padEnd(28)} -> Order.{${v.join(",")}}`);

console.log("\n# ── ③ Model 侧关键格的进出边 ───────────────────────────");
for (const v of ["demandLoad", "costPressure", "forecastBias", "supplyRisk", "backlogQtyTop", "backlogHorizonDays"]) {
  const inE = rules.filter((x) => x.targetTypeKey === "Model" && x.targetStateVar === v).map((x) => `${x.sourceTypeKey}.${x.sourceStateVar}`);
  const outE = rules.filter((x) => x.sourceTypeKey === "Model" && x.sourceStateVar === v).map((x) => `${x.targetTypeKey}.${x.targetStateVar}`);
  console.log(`  Model.${v.padEnd(20)} in[${inE.join(",") || "-"}]  out[${outE.join(",") || "-"}]`);
}

console.log("\n# ── ④ 谁能到钱（Customer/ARInvoice/OverdueRecord）───────");
const moneyCells = [];
for (const t of ALL) for (const v of roles.drivableStateVarsOf(t)) {
  const s = roles.reachesTypes(t, v);
  if (MONEY.some((m) => s.has(m))) moneyCells.push(`${t}.${v}`);
}
console.log(`  可驱动 ∧ 可达钱 的格 ${moneyCells.length} 个：`);
console.log(`  ${moneyCells.sort().join(", ")}`);

console.log("\n# ── ⑤ 假设加一条 Order.leadDays → Model.X，能到 Order 吗 ─");
for (const X of ["demandLoad", "costPressure", "supplyRisk", "forecastBias"]) {
  const withEdge = [...rules, { sourceTypeKey: "Order", sourceStateVar: "leadDays", targetTypeKey: "Model", targetStateVar: X, delayTicks: 0 }];
  const r2 = buildCellRoles(withEdge);
  const reach = [...r2.reachesTypes("Order", "leadDays")].sort();
  const toOrder = reach.includes("Order"), toMoney = MONEY.filter((m) => reach.includes(m));
  console.log(`  + Order.leadDays→Model.${X.padEnd(14)} 可达 ${String(reach.length).padStart(2)} 型 | 到 Order? ${toOrder ? "✅" : "❌"} | 到钱 ${toMoney.length ? `✅[${toMoney}]` : "❌"}`);
}
