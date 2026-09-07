// WO-PENALTY-CHANGEOVER-ONTOLOGY · 对照实验（铁律 1.5 判据一）。
// 走真路由（HTTP）+ 真求解器；不 mock、不桩。
const BASE = process.env.BASE ?? "http://127.0.0.1:4801";
const H = { "Content-Type": "application/json", "X-Debug-User": "demo:admin:admin|planner|catalog_admin" };

const post = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j.data ?? j;
};

const asm = await post("/a/v1/sim/optimize-pareto/assemble", {});
const baseArgs = asm.request.args;
const objectives = asm.request.objectives
  .filter((o) => ["revenue", "penalty", "cost"].includes(o.key))
  .map((o) => ({ key: o.key, dir: o.dir, weight: 1 }));

const solve = (orders) => post("/a/v1/solvers/cross_object_occupancy/invoke", { args: { ...baseArgs, orders, objectives } });

const fmt = (n) => (n / 1e8).toFixed(4);
const row = (tag, out, oid) => {
  const ord = out.__orders.find((o) => o.id === oid);
  const served = out.values[oid] === 1;
  return { tag, 该单违约金元: ord.penalty, 该单违约金亿: fmt(ord.penalty), 方案总违约金亿: fmt(out.objectiveValues.penalty), 该单是否获排: served ? "获排" : "被挤", 获排单数: Object.values(out.values).filter((v) => v === 1).length };
};

// ── 基线 ────────────────────────────────────────────────────────────────
const b = await solve(baseArgs.orders);
b.__orders = baseArgs.orders;
const displaced = new Set(b.displaced);

// 选一张**基线被挤**的单：取被挤集合里 qty 最小者（最容易在密度上位后真塞进去），
// tie-break id 升序 ⇒ 完全确定性，不挑数据。
const target = baseArgs.orders
  .filter((o) => displaced.has(o.id))
  .sort((x, y) => x.qty - y.qty || x.id.localeCompare(y.id))[0];

const scale = (mult) => baseArgs.orders.map((o) => (o.id === target.id ? { ...o, penalty: o.penalty * mult } : o));

// ── 组①：该单费率 ×10 ───────────────────────────────────────────────────
const up = await solve(scale(10));
up.__orders = scale(10);

// ── 反向对照 a：该单费率清零 ────────────────────────────────────────────
const zero1 = await solve(scale(0));
zero1.__orders = scale(0);

// ── 反向对照 b：全体费率清零 ⇒ 轴读数必须归零 ───────────────────────────
const allZeroOrders = baseArgs.orders.map((o) => ({ ...o, penalty: 0 }));
const zeroAll = await solve(allZeroOrders);
zeroAll.__orders = allZeroOrders;

console.log("target 订单:", target.id, "qty=", target.qty, "基线违约金=", target.penalty);
console.table([
  row("① 基线", b, target.id),
  row("② 该单 ×10", up, target.id),
  row("③ 该单 ×0", zero1, target.id),
  row("④ 全体 ×0", zeroAll, target.id),
]);
console.log("\n方案总违约金（元）:", { 基线: b.objectiveValues.penalty, 该单x10: up.objectiveValues.penalty, 该单x0: zero1.objectiveValues.penalty, 全体x0: zeroAll.objectiveValues.penalty });
console.log("排单决策变化（基线 vs ×10）: 该单", b.values[target.id] === 1 ? "获排" : "被挤", "→", up.values[target.id] === 1 ? "获排" : "被挤");
const changed = Object.keys(b.values).filter((k) => b.values[k] !== up.values[k]);
console.log("×10 后排单决策发生翻转的订单数:", changed.length, changed.slice(0, 8));
const changedAllZero = Object.keys(b.values).filter((k) => b.values[k] !== zeroAll.values[k]);
console.log("全体 ×0 后排单决策发生翻转的订单数:", changedAllZero.length);
console.log("objectiveSpread.penalty 基线:", b.objectiveSpread.penalty, "| 全体 ×0:", zeroAll.objectiveSpread.penalty);
