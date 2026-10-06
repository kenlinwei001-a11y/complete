#!/usr/bin/env node
/**
 * GOALLOOP-R1b · 「被推动的订单敞口」的三种口径到底各是哪些单、各是多少钱
 *
 * 只读 + 自建会话。比三件事：
 *   U1 全表（对象层 Order 全量，500）           —— finance_world_projection 的 universe
 *   U2 世界成员（不进世界的是 COMPLETED，150）   —— entersSimWorld / listSimWorldObjects
 *   U3 被推动（本次差分真动了的单）              —— 控制台 c0828「被推动的订单敞口」的分子口径
 * 并把 Order.value 属性与 qty×unitPrice 是否一致一并核对（两处输入不同源 = 第二套真相源）。
 */
const BASE = process.env.BASE || "http://127.0.0.1:4052";
const DU = "demo:admin:admin|planner|catalog_admin";
const TICKS = Number(process.env.TICKS || 10);
const TGT = "obj_order_SO-3391";
const api = async (m, p, b) => {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 300)}`); return r.j; };
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const yi = (v) => (v / 1e8).toFixed(4) + " 亿";

const ordersRes = must(await api("GET", "/a/v1/objects?type=Order&page=1&pageSize=500"), "orders");
const orders = ordersRes?.data?.items ?? ordersRes?.items ?? [];
if (orders.length === 0) throw new Error(`orders 形状变了：${JSON.stringify(ordersRes).slice(0, 200)}`);
const s0 = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
const sid = s0?.session?.id ?? s0?.id;
const w0 = must(await api("GET", `/a/v1/sim/sessions/${sid}/world`), "world0");
const base = w0?.state ?? {};
must(await api("POST", `/a/v1/sim/sessions/${sid}/perturbations`, { kind: "supply_disruption", targetObjectId: TGT, targetStateVar: "leadDays", mode: "delta", magnitude: -3, startTick: 0, durationTicks: null, label: "r1b" }), "perturb");
for (let i = 0; i < TICKS; i++) must(await api("POST", `/a/v1/sim/sessions/${sid}/tick`, { n: 1 }), "tick");
const st = must(await api("GET", `/a/v1/sim/sessions/${sid}/world`), "worldN")?.state ?? {};

// 差分（逐格，全量状态量）
const movedIds = new Set();
let movedCells = 0;
for (const oid of Object.keys(st)) {
  const a = st[oid] ?? {}, b = base[oid] ?? {};
  let hit = false;
  for (const k of Object.keys(a)) {
    if (typeof a[k] === "number" && typeof b[k] === "number" && Math.abs(a[k] - b[k]) > 1e-12) { hit = true; movedCells += 1; }
  }
  if (hit) movedIds.add(oid);
}
const worldOrderIds = Object.keys(st).filter((id) => id.startsWith("obj_order_"));
const byId = new Map(orders.map((o) => [o.id, o]));
const wOf = (o) => num(o?.props?.qty) * num(o?.props?.unitPrice);
const valOf = (o) => num(o?.props?.value);
let u2 = 0, u3 = 0, n3 = 0, valEq = 0, valNe = 0, valExamples = [];
for (const id of worldOrderIds) { const o = byId.get(id); if (!o) continue; u2 += wOf(o); if (movedIds.has(id)) { u3 += wOf(o); n3 += 1; } if (valOf(o) !== 0) { if (Math.abs(valOf(o) - wOf(o)) < 1e-6) valEq += 1; else { valNe += 1; if (valExamples.length < 3) valExamples.push(`${id} value=${valOf(o)} vs qty×price=${wOf(o)}`); } } }
const u1 = orders.reduce((a, o) => a + wOf(o), 0);
console.log(`## GOALLOOP-R1b · session=${sid} · 扰动 ${TGT}.leadDays -3 · ${TICKS} 拍`);
console.log(`  U1 全表（对象层 Order）           ${orders.length} 张 · ${yi(u1)}`);
console.log(`  U2 世界成员（进世界、非 COMPLETED）${worldOrderIds.length} 张 · ${yi(u2)}   U1/U2 = ${(u1 / u2).toFixed(6)}`);
console.log(`  U3 被推动（本次差分真动了的单）    ${n3} 张 · ${yi(u3)}   U2/U3 = ${(u2 / (u3 || 1)).toFixed(6)} · U1/U3 = ${(u1 / (u3 || 1)).toFixed(6)}`);
console.log(`  动了的格数 = ${movedCells} · 动了的对象数 = ${movedIds.size}（含非 Order）`);
console.log(`  Order.value 与 qty×unitPrice：相等 ${valEq} 张 / 不等 ${valNe} 张 ${valExamples.length ? "例：" + valExamples.join(" ; ") : ""}`);
console.log(`SESSION=${sid}`);
console.log(`DONE ${new Date().toISOString()}`);
