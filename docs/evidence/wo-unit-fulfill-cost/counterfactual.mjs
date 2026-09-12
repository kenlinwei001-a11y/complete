/**
 * 对照实验（**只读·不改产品**）：假如本体上真有一格「按件履约成本」，帕累托前沿会不会变？
 *
 * 做法：装配器给出的 ParetoRequest 里 `args.eligibility[].cost` 是**按指派**计价的。
 * 本脚本在**请求体里**把它换成 `按指派成本 + 每件成本 × qty`（每件成本由既有 BOM 现算），
 * 然后把这份请求 POST 给**真实求解器**。产品源码一行没改 —— 这只是证明
 * 「补上那一格之后，毛利会不会真的变成独立维」。
 *
 * 判据（铁律 1.5 判据一）：修前 19/19 逐条相同；若补上按件成本后前沿划分改变，
 * 说明缺的就是这一格，本单的结论站得住。
 */
const BASE = process.env.DC ?? "http://127.0.0.1:4071";
const H = { "Content-Type": "application/json", "X-Debug-User": "demo:admin:admin|planner|catalog_admin" };
const post = async (p, b) => {
  const r = await fetch(BASE + p, { method: "POST", headers: H, body: JSON.stringify(b) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${p} → ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
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

const [asm, ol, bh, bd, mat] = await Promise.all([
  post("/a/v1/sim/optimize-pareto/assemble", {}),
  all("OrderLine"), all("BOMHeader"), all("BOMDetail"), all("Material"),
]);
const req = asm.request;
console.log(`金丝雀：OrderLine=${ol.length}(装配器873) args.orders=${req.args.orders.length} eligibility=${req.args.eligibility.length}`);

// 每型号「每电芯物料成本」（元）= Σ BOMDetail.quantity ×(1+lossRate)× Material.unitPrice
// 量纲前置已实测成立：105/105 条 BOMDetail.unit === 其 Material.unit
const priceOf = new Map(mat.map((m) => [String(m.props.matId), Number(m.props.unitPrice)]));
const detailByBom = new Map();
for (const d of bd) (detailByBom.get(String(d.props.bomId)) ?? detailByBom.set(String(d.props.bomId), []).get(String(d.props.bomId))).push(d.props);
const unitCostOfModel = new Map();
for (const h of bh) {
  const mid = String(h.props.modelId);
  const bomId = String(h.props.bomId);
  if (unitCostOfModel.has(mid) && bomId > (unitCostOfModel.get(mid).bomId)) continue;
  let s = 0;
  for (const d of detailByBom.get(bomId) ?? []) s += Number(d.quantity) * (1 + Number(d.lossRate ?? 0)) * (priceOf.get(String(d.materialId)) ?? 0);
  const prev = unitCostOfModel.get(mid);
  if (!prev || bomId < prev.bomId) unitCostOfModel.set(mid, { bomId, cost: s });
}
const modelOfLine = new Map(ol.map((o) => [String(o.props.lineId), String(o.props.model)]));
const qtyOfOrder = new Map(req.args.orders.map((o) => [o.id, Number(o.qty)]));

// 请求体改造：eligibility[].cost += 每件成本 × qty
const elig2 = req.args.eligibility.map((e) => {
  const mid = modelOfLine.get(e.order);
  const uc = mid ? (unitCostOfModel.get(mid)?.cost ?? 0) : 0;
  return { ...e, cost: e.cost + uc * (qtyOfOrder.get(e.order) ?? 0) };
});
const req2 = { ...req, args: { ...req.args, eligibility: elig2 } };

const before = await post("/a/v1/sim/optimize-pareto", req);
const after = await post("/a/v1/sim/optimize-pareto", req2);
const idsB = before.frontier.map((s) => s.id).sort();
const idsA = after.frontier.map((s) => s.id).sort();
const same = idsB.length === idsA.length && idsB.every((x, i) => x === idsA[i]);

console.log(`\n═══ 前沿对照 ═══`);
console.log(`修前（成本按指派计价）: iterations=${before.iterations} frontier=${before.frontier.length} dominated=${before.dominated.length}`);
console.log(`修后（成本含按件履约）: iterations=${after.iterations} frontier=${after.frontier.length} dominated=${after.dominated.length}`);
console.log(`>>> 前沿 id 列表逐条相同？ ${same ? "是（补了也没用）" : "否 —— 补上按件成本后前沿划分**真的改变了**"}`);
if (!same) {
  const onlyB = idsB.filter((x) => !idsA.includes(x));
  const onlyA = idsA.filter((x) => !idsB.includes(x));
  console.log(`  修前独有 ${onlyB.length} 个；修后独有 ${onlyA.length} 个`);
  if (onlyA.length) console.log(`  修后新进前沿样例: ${onlyA.slice(0, 3).join(" | ")}`);
  if (onlyB.length) console.log(`  修后跌出前沿样例: ${onlyB.slice(0, 3).join(" | ")}`);
}
const mb = before.frontier[0].metrics, ma = after.frontier[0].metrics;
console.log(`\n成本占毛利：修前 ${(100 * mb.cost / mb.margin).toFixed(3)}%  →  修后 ${(100 * ma.cost / ma.margin).toFixed(3)}%`);

// ── 六个数：两张同型号、qty 相差约 10 倍的订单行 ──────────────────────
console.log(`\n═══ 六个数（同型号、qty 约 10 倍差的一对订单行）═══`);
const byModel = new Map();
for (const o of req.args.orders) {
  const mid = modelOfLine.get(o.id); if (!mid) continue;
  (byModel.get(mid) ?? byModel.set(mid, []).get(mid)).push(o);
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
const assignCostOf = (id) => Math.min(...req.args.eligibility.filter((e) => e.order === id).map((e) => e.cost));
if (pair) {
  const uc = unitCostOfModel.get(pair.mid).cost;
  console.log(`型号 ${pair.mid}，每电芯物料成本 ${uc.toFixed(2)} 元`);
  for (const [tag, o] of [["小单", pair.small], ["大单", pair.big]]) {
    const ac = assignCostOf(o.id);
    const mOld = o.revenue - ac;
    const mNew = o.revenue - (ac + uc * o.qty);
    console.log(`  ${tag} ${o.id}: qty=${o.qty} 营收=${Math.round(o.revenue).toLocaleString()}`);
    console.log(`      修前毛利=${Math.round(mOld).toLocaleString()} 毛利/营收=${(100 * mOld / o.revenue).toFixed(4)}%`);
    console.log(`      修后毛利=${Math.round(mNew).toLocaleString()} 毛利/营收=${(100 * mNew / o.revenue).toFixed(4)}%`);
  }
  const rOldS = (pair.small.revenue - assignCostOf(pair.small.id)) / pair.small.revenue;
  const rOldB = (pair.big.revenue - assignCostOf(pair.big.id)) / pair.big.revenue;
  const rNewS = (pair.small.revenue - (assignCostOf(pair.small.id) + uc * pair.small.qty)) / pair.small.revenue;
  const rNewB = (pair.big.revenue - (assignCostOf(pair.big.id) + uc * pair.big.qty)) / pair.big.revenue;
  console.log(`  >>> 毛利/营收 两单之差：修前 ${(100 * Math.abs(rOldS - rOldB)).toFixed(4)} 个百分点；修后 ${(100 * Math.abs(rNewS - rNewB)).toFixed(4)} 个百分点`);
  console.log(`      （修后两单比值仍相同属正常：同型号同单价时按件成本也同比例；真正拉开的是**跨型号**——见下）`);
}
console.log(`\n═══ 跨型号的毛利率（修后才拉得开）═══`);
for (const [mid, v] of [...unitCostOfModel.entries()].sort()) {
  const sample = (byModel.get(mid) ?? [])[0];
  if (!sample) continue;
  const unitRev = sample.revenue / sample.qty;
  console.log(`  ${mid}: 单价=${unitRev.toFixed(0)} 元/件 每件成本=${v.cost.toFixed(2)} 元 ⇒ 单位毛利率=${(100 * (1 - v.cost / unitRev)).toFixed(2)}%`);
}

// 确定性：同请求两次重跑
const h = (o) => JSON.stringify(o.frontier.map((s) => [s.id, s.metrics]));
const again = await post("/a/v1/sim/optimize-pareto", req2);
console.log(`\n确定性复跑：修后两次 frontier 逐字节${h(after) === h(again) ? "一致 ✓" : "不一致 ✗"}`);
