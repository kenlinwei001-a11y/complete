/**
 * WO-UNITCOST-LAND · 组②③ 落地验收（**真起的服务**，禁 mock）。
 *
 * 与上一单 `counterfactual.mjs` 的关键区别：那份是**在请求体里手改** eligibility 成本的只读实验
 * （产品源码一行没改）；本份**一个字段都不改请求体** —— 装配器自己从本体绑 `unit_cost`，
 * 绑定层自己把 `unitCost × qty` 加进成本。所以这里若还看得到前沿变化，那就是**真落地了**。
 *
 * 「修前」的构造方式也随之改变：不再是"加上去"，而是**把按件那一项减回去**
 * （`cost − unitCost × qty`），得到接线前那份请求，再拿同一个求解器跑一遍。
 * 两次都走真 `/a/v1/sim/optimize-pareto`，同一个引擎、同一份参数版本。
 *
 * 金丝雀（先自证工具）：装配器回包里 `unit_cost` 角色必须在、`costIncludesUnitFulfillment`
 * 必须为 true、且 OrderLine 上真读得到非零 `unitCost`。任一不成立 ⇒ 报「**我的工具/接线坏了**」，
 * 不许把后面的读数当结论。
 */
const BASE = process.env.DC ?? "http://127.0.0.1:4185";
const H = { "Content-Type": "application/json", "X-Debug-User": "demo:admin:admin|planner|catalog_admin" };
const post = async (p, b) => {
  const r = await fetch(BASE + p, { method: "POST", headers: H, body: JSON.stringify(b) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${p} → ${r.status} ${JSON.stringify(j).slice(0, 400)}`);
  return j;
};
const all = async (t) => {
  const o = []; let tot = Infinity;
  for (let p = 1; o.length < tot && p <= 100; p++) {
    const r = await fetch(`${BASE}/a/v1/objects?type=${t}&page=${p}&pageSize=200`, { headers: H });
    const j = await r.json(); tot = j.total; if (!j.items.length) break; o.push(...j.items);
  }
  return o;
};
console.log(`命中端口：${BASE}`);

const asm = await post("/a/v1/sim/optimize-pareto/assemble", {});
const req = asm.request;
const ol = await all("OrderLine");

// ── 金丝雀 ─────────────────────────────────────────────────────────────
// ⚠ 回包里角色表的键是 `roles`（不是 `binding.roleBindings`）—— 第一版工具读错了键，
//   于是把「接线好好的」报成「unit_cost 角色缺」。金丝雀当场拦下，没让这个假结论出门。
const roles = (asm.roles ?? []).map((r) => `${r.role}=${r.ref}`);
const unitCostRole = roles.find((r) => r.startsWith("unit_cost="));
const nonZero = ol.filter((l) => Number(l.props.unitCost) > 0).length;
const args = asm.request.args;
console.log("═══ 金丝雀 ═══");
console.log(`  装配器绑定角色：${roles.join("  ")}`);
console.log(`  未绑角色：${JSON.stringify(asm.unboundRoles)}  ← penalty 必须在此（否则 unitCost 被错绑成违约金）`);
console.log(`  unit_cost 角色：${unitCostRole ?? "**缺（接线没生效）**"}`);
console.log(`  OrderLine.unitCost 非零行：${nonZero}/${ol.length}`);
console.log(`  口径自述：costIncludesUnitFulfillment=${args.costIncludesUnitFulfillment} unitCostQtyProp=${args.unitCostQtyProp} assignCostBound=${args.assignCostBound} currencyAligned=${args.currencyAligned} currencyUnit=${args.currencyUnit}`);
for (const o of asm.request.objectives ?? []) console.log(`  目标 ${o.key}：${o.label}${o.unit ? `（${o.unit}）` : ""}`);
if (!unitCostRole || nonZero === 0 || args.costIncludesUnitFulfillment !== true) { console.log("⛔ 金丝雀不中 —— 接线/工具坏了，下面读数一律不作数"); process.exit(2); }
if (!(asm.unboundRoles ?? []).includes("penalty")) { console.log("⛔ penalty 被绑上了 —— 强度量当了总量，见 opt-assemble.ts penProp 守卫"); process.exit(2); }

// ── 「修前」重建：把按件那一项从 eligibility 成本里减回去 ────────────────
const qtyOf = new Map(req.args.orders.map((o) => [o.id, Number(o.qty)]));
const ucOf = new Map(ol.map((l) => [String(l.props.lineId), Number(l.props.unitCost)]));
const eligBefore = req.args.eligibility.map((e) => ({ ...e, cost: e.cost - (ucOf.get(e.order) ?? 0) * (qtyOf.get(e.order) ?? 0) }));
const reqBefore = { ...req, args: { ...req.args, eligibility: eligBefore } };

const before = await post("/a/v1/sim/optimize-pareto", reqBefore);
const after = await post("/a/v1/sim/optimize-pareto", req);
const idsB = before.frontier.map((s) => s.id).sort();
const idsA = after.frontier.map((s) => s.id).sort();
const same = idsB.length === idsA.length && idsB.every((x, i) => x === idsA[i]);

console.log(`\n═══ 组③ 前沿真的变了吗 ═══`);
console.log(`修前（成本只按指派计价）: frontier=${before.frontier.length} dominated=${before.dominated.length} iterations=${before.iterations}`);
console.log(`修后（成本含按件履约）  : frontier=${after.frontier.length} dominated=${after.dominated.length} iterations=${after.iterations}`);
console.log(`>>> 前沿 id 列表逐条相同？ ${same ? "**是 —— 字段没真接进求解器**" : "否 —— 前沿划分真的改变了 ✓"}`);
const onlyB = idsB.filter((x) => !idsA.includes(x));
const onlyA = idsA.filter((x) => !idsB.includes(x));
console.log(`  修前前沿 id（${idsB.length}）: ${idsB.join(" ")}`);
console.log(`  修后前沿 id（${idsA.length}）: ${idsA.join(" ")}`);
console.log(`  修后新进前沿 ${onlyA.length} 个: ${onlyA.join(" ") || "—"}`);
console.log(`  修后跌出前沿 ${onlyB.length} 个: ${onlyB.join(" ") || "—"}`);
const mb = before.frontier[0].metrics, ma = after.frontier[0].metrics;
console.log(`  成本占毛利：修前 ${(100 * mb.cost / mb.margin).toFixed(3)}%  →  修后 ${(100 * ma.cost / ma.margin).toFixed(3)}%`);

// ── 组② 单位经济学：同型号、qty 约 10 倍差的一对订单行 ────────────────────
console.log(`\n═══ 组② 单位经济学生效（六个数）═══`);
const modelOf = new Map(ol.map((l) => [String(l.props.lineId), String(l.props.model)]));
const byModel = new Map();
for (const o of req.args.orders) {
  const mid = modelOf.get(o.id); if (!mid) continue;
  if (!byModel.has(mid)) byModel.set(mid, []);
  byModel.get(mid).push(o);
}
let pair = null;
for (const [mid, list] of [...byModel.entries()].sort()) {
  const s = [...list].sort((a, b) => a.qty - b.qty);
  for (let i = 0; i < s.length && !pair; i++) for (let j = s.length - 1; j > i; j--) {
    const r = s[j].qty / s[i].qty;
    if (r >= 9.5 && r <= 10.5) { pair = { mid, small: s[i], big: s[j] }; break; }
  }
  if (pair) break;
}
if (!pair) { console.log("（本批单里找不到 qty 差 ~10 倍的同型号对 —— 这是取样问题不是接线问题）"); }
else {
  const costOf = (elig, id) => Math.min(...elig.filter((e) => e.order === id).map((e) => e.cost));
  const uc = ucOf.get(pair.small.id);
  console.log(`型号 ${pair.mid}，按件履约成本 ${uc} 元/电芯`);
  const row = [];
  for (const [tag, o] of [["小单", pair.small], ["大单", pair.big]]) {
    const cB = costOf(eligBefore, o.id), cA = costOf(req.args.eligibility, o.id);
    const mB = o.revenue - cB, mA = o.revenue - cA;
    row.push({ tag, id: o.id, qty: o.qty, rev: o.revenue, mB, mA, rB: mB / o.revenue, rA: mA / o.revenue });
    console.log(`  ${tag} ${o.id}: qty=${o.qty}  营收=${Math.round(o.revenue).toLocaleString()}`);
    console.log(`      修前 毛利=${Math.round(mB).toLocaleString()}  毛利/营收=${(100 * mB / o.revenue).toFixed(4)}%`);
    console.log(`      修后 毛利=${Math.round(mA).toLocaleString()}  毛利/营收=${(100 * mA / o.revenue).toFixed(4)}%`);
  }
  const [s, b] = row;
  console.log(`  >>> 毛利/营收 两单是否不同：修前 ${s.rB === b.rB ? "**相同（退化）**" : "不同 ✓"}（差 ${(100 * Math.abs(s.rB - b.rB)).toFixed(4)} 个百分点）` +
    `；修后 ${s.rA === b.rA ? "**相同（退化）**" : "不同 ✓"}（差 ${(100 * Math.abs(s.rA - b.rA)).toFixed(4)} 个百分点）`);
}

console.log(`\n═══ 跨型号单位毛利率（按件成本落地后才拉得开）═══`);
const seen = new Map();
for (const l of ol) { const m = String(l.props.model); if (!seen.has(m)) seen.set(m, l.props); }
for (const [mid, p] of [...seen.entries()].sort()) {
  console.log(`  ${mid}: 单价=${p.unitPrice} 元/件  按件成本=${p.unitCost} 元/件  ⇒ 单位毛利率=${(100 * (1 - Number(p.unitCost) / Number(p.unitPrice))).toFixed(2)}%`);
}

// 确定性：同请求两次重跑
const h = (o) => JSON.stringify(o.frontier.map((s) => [s.id, s.metrics]));
const again = await post("/a/v1/sim/optimize-pareto", req);
console.log(`\n确定性复跑：修后两次 frontier 逐字节${h(after) === h(again) ? "一致 ✓" : "不一致 ✗"}`);
