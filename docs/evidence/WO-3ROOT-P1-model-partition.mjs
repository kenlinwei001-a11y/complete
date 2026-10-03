/**
 * P1 W1 · 型号带单数 + X′ 后逐单预言（供 PRD 的对照实验给可预言读数）
 * 只读：/objects/:id/neighbors 取 order_for_model；不 PATCH、不 tick 之外的操作。
 * 金丝雀：① 必然命中的链路 customer_places_order；② 虚构链路名必不命中。
 */
const H = { "X-Debug-User": "demo:admin:admin" };
const B = "http://127.0.0.1:4019/a/v1";
const g = async (p) => { const r = await fetch(B + p, { headers: H }); return { status: r.status, json: await r.json().catch(() => null) }; };
const fb = { "obj_model_2170-NCM": 1, "obj_model_4680-LFP": 88, "obj_model_4680-NCM": 50,
             "obj_model_圆柱-LFP": 88, "obj_model_方形-LFP": 8, "obj_model_方形-NCM": 79 };
const FBP = { "obj_model_2170-NCM": -98, "obj_model_4680-LFP": 77, "obj_model_4680-NCM": 1,
              "obj_model_圆柱-LFP": 75, "obj_model_方形-LFP": -85, "obj_model_方形-NCM": 58 };
const nb = await g("/objects/obj_order_SO-3391/neighbors");
const keys = (nb.json?.groups ?? []).map((x) => x.linkKey);
console.log(`金丝雀① 必然命中 customer_places_order = ${keys.includes("customer_places_order") ? "✅" : "❌ 取法坏了"}`);
console.log(`金丝雀② 虚构链路 ___nope___ 命中 = ${keys.includes("___nope___") ? "❌" : "0 ✅"}`);
if (!keys.includes("customer_places_order")) process.exit(2);
console.log(`SO-3391 邻接链路: ${keys.join(",")}`);
// 单分页取全部 Order id（用世界态里的键集，服务端已知）
const s = (await (await fetch(B + "/sim/sessions", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: "{}" })).json());
const det = await (await fetch(`${B}/sim/sessions/${s.id}`, { headers: H })).json();
const orderIds = Object.keys(det.baseSnapshot ?? {}).filter((i) => i.startsWith("obj_order_SO-")).sort();
const per = new Map(); let missing = 0; const map = new Map();
for (const o of orderIds) {
  const r = await g(`/objects/${o}/neighbors`);
  let mid = null;
  for (const grp of r.json?.groups ?? []) if (grp.linkKey === "order_for_model") mid = grp.items?.[0]?.id ?? null;
  if (mid === null) { missing++; continue; }
  map.set(o, mid); per.set(mid, (per.get(mid) ?? 0) + 1);
}
console.log(`\nOrder 总数=${orderIds.length} 解析到型号=${map.size} 解析不到=${missing}`);
console.log("型号 | X.fb | 带单数 | X′.fb | 预言Δ=x*−base=−0.6·fb′ | 上穿?");
let cross = 0, crossBase0 = 0, oob = 0;
for (const [mid, n] of [...per.entries()].sort((a, b) => b[1] - a[1])) {
  const d = +(-0.6 * FBP[mid]).toFixed(4);
  if (d > 0) cross += n;
  console.log(`${mid.replace("obj_model_", "")} | ${fb[mid]} | ${n} | ${FBP[mid]} | ${d > 0 ? "+" : ""}${d} | ${d > 0 ? "是" : "否"}`);
}
// 越域计数：x* = base − 0.6·fb′，域 [0,100]
for (const o of map.keys()) {
  const base = det.baseSnapshot[o]?.demandPressure; const mid = map.get(o);
  if (typeof base !== "number") continue;
  const xs = base - 0.6 * FBP[mid];
  if (xs > 100 || xs < 0) oob++;
  if (base === 0) crossBase0++;
}
console.log(`\n预言：上穿基值(+0.01) 单数 = ${cross}/150（X 实测 0/150）`);
console.log(`预言：x* 越出声明域 [0,100] 的单数 = ${oob}/150  ← 交办 companion 单（补写不重夹）`);
console.log(`参考：base=0 的单 ${crossBase0}/150`);
