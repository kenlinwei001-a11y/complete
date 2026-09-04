import { all, H, BASE } from "./fetch.mjs";

const PEN = { 高: 26000, 中: 9000, 低: 2600 };
const CHG = 800, LINE_COV = 0.6, CON_COV = 1.0;
const chemOf = (m) => (m.includes("LFP") || m.includes("储能") ? "LFP" : "NCM");

const orders0 = (await all("Order")).map((o) => ({
  so: String(o.props.so ?? o.id), cust: String(o.props.cust ?? "—"), model: String(o.props.model ?? ""),
  qty: Number(o.props.qty ?? 0), unitPrice: Number(o.props.unitPrice ?? 0), pri: String(o.props.pri ?? "中"),
}));
const orders = orders0.filter((o) => o.so && o.qty > 0 && o.unitPrice > 0).sort((a, b) => a.so.localeCompare(b.so));
const rows = orders.map((o) => ({
  id: o.so, cust: o.cust, chem: chemOf(o.model), qty: o.qty,
  revenue: Math.round(o.qty * o.unitPrice),
  penalty: Math.round(o.qty * (PEN[o.pri] ?? PEN["中"])),
  changeover: Math.round(o.qty * CHG),
  line: `LINE-${chemOf(o.model)}`,
}));
const chemDem = new Map(); for (const r of rows) chemDem.set(r.chem, (chemDem.get(r.chem) ?? 0) + r.qty);
const lines = [...chemDem.entries()].sort().map(([c, d]) => ({ id: `LINE-${c}`, capacity: Math.max(1, Math.round(d * LINE_COV)) }));
const custDem = new Map(); for (const r of rows) custDem.set(r.cust, (custDem.get(r.cust) ?? 0) + r.qty);
const contracts = [...custDem.entries()].sort().map(([c, d]) => ({ id: c, cap: Math.max(1, Math.round(d * CON_COV)) }));

const argsOf = (w) => ({
  scale: 1, seed: 42,
  orders: rows.map((r) => ({ id: r.id, revenue: r.revenue, penalty: r.penalty, qty: r.qty, contractId: r.cust })),
  lines, contracts,
  eligibility: rows.map((r) => ({ order: r.id, line: r.line, cost: r.changeover })),
  method: "weighted",
  objectives: ["revenue", "penalty", "cost"].map((k) => ({ key: k, weight: w[k] })),
});

export async function solveB(w) {
  const r = await fetch(`${BASE}/a/v1/solvers/cross_object_occupancy/invoke`, {
    method: "POST", headers: { "X-Debug-User": H, "content-type": "application/json" },
    body: JSON.stringify({ args: argsOf(w) }),
  });
  const j = await r.json();
  return j.data ?? j;
}
export { rows, lines, contracts, orders };

if (process.argv[2] === "run") {
  console.log("orders", rows.length, "Σqty", rows.reduce((a, r) => a + r.qty, 0));
  console.log("lines", JSON.stringify(lines));
  console.log("Σrevenue pool 亿", (rows.reduce((a, r) => a + r.revenue, 0) / 1e8).toFixed(2));
  const d = await solveB({ revenue: 1, penalty: 1, cost: 1 });
  console.log("status", d.status, "served", d.servedCount, "/", d.orderCount, "displaced", d.displaced?.length);
  console.log("objectiveValues", JSON.stringify(d.objectiveValues));
  console.log("revenue 亿 =", (d.objectiveValues.revenue / 1e8).toFixed(2), "penalty 亿 =", (d.objectiveValues.penalty / 1e8).toFixed(2), "cost 万 =", (d.objectiveValues.cost / 1e4).toFixed(0));
}
