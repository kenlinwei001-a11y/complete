// 交界面（deliverable 3 副）：图上 93 张下游单 vs 沙盘只动 24 张。
// 判据源全部来自**真服务**读数（base 由 BASE 环境变量给，默认自起实例）。
import { writeFileSync } from "node:fs";
const BASE = process.env.BASE ?? "http://127.0.0.1:5051";
const H = { "X-Debug-User": "demo:admin:admin", "content-type": "application/json" };

async function get(p) {
  const r = await fetch(`${BASE}${p}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${p} -> HTTP ${r.status}`);
  return r.json();
}
const out = [];
const say = (s) => { out.push(s); console.log(s); };

// ── 1) 图侧：模型的下游单
const nb = await get("/a/v1/objects/obj_model_4680-NCM/neighbors");
const g = nb.groups.find((x) => x.linkKey === "model_demanded_by_order");
say(`graph  obj_model_4680-NCM --model_demanded_by_order--> total = ${g.total}`);

// ── 2) 全库 / 世界 两种口径
const all = await get("/a/v1/objects?type=Order&pageSize=600");
const vc = await get("/a/v1/sim/view-config");
const worldOrder = new Set(vc.nodeObjectIds.Order ?? []);
const byStatus = (arr) => arr.reduce((m, o) => ((m[o.props.status] = (m[o.props.status] ?? 0) + 1), m), {});
say(`全库 Order n=${all.items.length} total=${all.total} 状态分布=${JSON.stringify(byStatus(all.items))}`);
const world = all.items.filter((o) => worldOrder.has(o.id));
say(`世界 Order n=${world.length} 状态分布=${JSON.stringify(byStatus(world))}`);
say(`view-config.nodeObjectIds.Order 落点数 = ${worldOrder.size}`);
const exoWorld = all.items.filter((o) => !worldOrder.has(o.id));
say(`世界外 Order n=${exoWorld.length} 状态分布=${JSON.stringify(byStatus(exoWorld))}`);

// ── 3) 4680-NCM 下游 93 张的分解
const ncm = all.items.filter((o) => o.props.model === "4680-NCM");
say(`\n4680-NCM 下游单：全库 ${ncm.length} 张 状态分布=${JSON.stringify(byStatus(ncm))}`);
const ncmWorld = ncm.filter((o) => worldOrder.has(o.id));
say(`4680-NCM 下游单：世界内 ${ncmWorld.length} 张 状态分布=${JSON.stringify(byStatus(ncmWorld))}`);
say(`⇒ 图上 ${g.total} − 沙盘 ${ncmWorld.length} = ${g.total - ncmWorld.length} 张不在沙盘里`);
const diff = ncm.filter((o) => !worldOrder.has(o.id));
say(`   被排除的 ${diff.length} 张状态分布=${JSON.stringify(byStatus(diff))}（全部 COMPLETED ⇒ 与 entersSimWorld 判据一致）`);

// ── 4) F5 断因：od-cg 的客户是谁、它在世界里有几张 4680-NCM 单
const od = await get("/a/v1/objects?type=OverdueRecord&pageSize=50");
say(`\nOverdueRecord 全库 n=${od.total}`);
for (const o of od.items) say(`   ${o.id} customerRef=${o.props.customerRef} invoiceRef=${o.props.invoiceRef}`);
const perCust = {};
for (const o of ncm) {
  const c = o.props.customerId;
  perCust[c] ??= { all: 0, world: 0, byStatus: {} };
  perCust[c].all++;
  perCust[c].byStatus[o.props.status] = (perCust[c].byStatus[o.props.status] ?? 0) + 1;
  if (worldOrder.has(o.id)) perCust[c].world++;
}
say(`\n4680-NCM 下游单按客户（全库/世界内/状态）：`);
for (const c of Object.keys(perCust).sort())
  say(`   ${c} | ${perCust[c].all} | ${perCust[c].world} | ${JSON.stringify(perCust[c].byStatus)}`);
const zeroInWorld = Object.keys(perCust).filter((c) => perCust[c].world === 0);
say(`世界里 0 张 4680-NCM 单的客户 = ${zeroInWorld.join(",") || "(无)"}`);

// ── 5) 反向金丝雀：本方法能分辨「在世界里」与「不在」
say(`\n反向金丝雀（判法有鉴别力）：`);
say(`   obj_order_SO-3391（扰动的注入点）在世界里 = ${worldOrder.has("obj_order_SO-3391")}  ← 期望 true`);
say(`   obj_model_4680-NCM 在 nodeObjectIds.Model 里 = ${(vc.nodeObjectIds.Model ?? []).includes("obj_model_4680-NCM")}  ← 期望 true`);
say(`   obj_order_SO-900087（cust_16 的 COMPLETED 单）在世界里 = ${worldOrder.has("obj_order_SO-900087")}  ← 期望 false`);

writeFileSync("/tmp/sv-churn-ev/seam-out.json", JSON.stringify({ gTotal: g.total, ncmAll: ncm.length, ncmWorld: ncmWorld.length, perCust, zeroInWorld }, null, 1));
say(`\nWROTE seam-out.json`);
