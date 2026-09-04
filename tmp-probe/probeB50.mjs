const H = "demo:admin:admin|planner|catalog_admin";
const BASE = "http://127.0.0.1:4711";
const PEN = { 高: 26000, 中: 9000, 低: 2600 };
const CHG = 800, LINE_COV = 0.6;
const chemOf = (m) => (m.includes("LFP") || m.includes("储能") ? "LFP" : "NCM");

const r = await fetch(`${BASE}/a/v1/objects?type=Order&q=`, { headers: { "X-Debug-User": H } });
const j = await r.json();
const orders = (j.items ?? []).map((o) => ({
  so: String(o.props.so ?? o.id), cust: String(o.props.cust ?? "—"), model: String(o.props.model ?? ""),
  qty: Number(o.props.qty ?? 0), unitPrice: Number(o.props.unitPrice ?? 0), pri: String(o.props.pri ?? "中"),
})).filter((o) => o.so && o.qty > 0 && o.unitPrice > 0).sort((a, b) => a.so.localeCompare(b.so));
const rows = orders.map((o) => ({
  id: o.so, cust: o.cust, chem: chemOf(o.model), qty: o.qty,
  revenue: Math.round(o.qty * o.unitPrice), penalty: Math.round(o.qty * (PEN[o.pri] ?? PEN["中"])),
  changeover: Math.round(o.qty * CHG), line: `LINE-${chemOf(o.model)}`,
}));
const chemDem = new Map(); for (const x of rows) chemDem.set(x.chem, (chemDem.get(x.chem) ?? 0) + x.qty);
const lines = [...chemDem.entries()].sort().map(([c, d]) => ({ id: `LINE-${c}`, capacity: Math.max(1, Math.round(d * LINE_COV)) }));
const custDem = new Map(); for (const x of rows) custDem.set(x.cust, (custDem.get(x.cust) ?? 0) + x.qty);
const contracts = [...custDem.entries()].sort().map(([c, d]) => ({ id: c, cap: Math.max(1, Math.round(d)) }));
const args = {
  scale: 1, seed: 42,
  orders: rows.map((x) => ({ id: x.id, revenue: x.revenue, penalty: x.penalty, qty: x.qty, contractId: x.cust })),
  lines, contracts, eligibility: rows.map((x) => ({ order: x.id, line: x.line, cost: x.changeover })),
  method: "weighted", objectives: [{ key: "revenue", weight: 1 }, { key: "penalty", weight: 1 }, { key: "cost", weight: 1 }],
};
const rr = await fetch(`${BASE}/a/v1/solvers/cross_object_occupancy/invoke`, {
  method: "POST", headers: { "X-Debug-User": H, "content-type": "application/json" }, body: JSON.stringify({ args }),
});
const d = (await rr.json()).data;
console.log("n orders", rows.length, "pool 亿", (rows.reduce((a, x) => a + x.revenue, 0) / 1e8).toFixed(2));
console.log("served", d.servedCount, "/", d.orderCount);
console.log("revenue 亿", (d.objectiveValues.revenue / 1e8).toFixed(2), "penalty 亿", (d.objectiveValues.penalty / 1e8).toFixed(2), "cost 万", (d.objectiveValues.cost / 1e4).toFixed(0));
