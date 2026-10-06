#!/usr/bin/env node
/**
 * GOALLOOP-R1c · 控制台口径的「被推动的订单敞口」到底是多少钱
 *
 * 控制台的敞口 = 「终态 − 零扰动对照臂终态」差分里动过的订单，按对象层成交额合计
 * （与本探针 R1b 用 tick0 当参照不同 —— 控制台注释明说不许用 baseSnapshot 当参照）。
 * 故本探针按控制台口径：扰动臂 tick10 vs 零扰臂 tick10。
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

async function arm(perturb) {
  const s0 = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
  const sid = s0?.session?.id ?? s0?.id;
  if (perturb) must(await api("POST", `/a/v1/sim/sessions/${sid}/perturbations`, { kind: "supply_disruption", targetObjectId: TGT, targetStateVar: "leadDays", mode: "delta", magnitude: -3, startTick: 0, durationTicks: null, label: "r1c" }), "perturb");
  for (let i = 0; i < TICKS; i++) must(await api("POST", `/a/v1/sim/sessions/${sid}/tick`, { n: 1 }), "tick");
  const w = must(await api("GET", `/a/v1/sim/sessions/${sid}/world`), "world");
  return { sid, st: w?.state ?? {} };
}
const ordersRes = must(await api("GET", "/a/v1/objects?type=Order&page=1&pageSize=500"), "orders");
const orders = ordersRes?.data?.items ?? ordersRes?.items ?? [];
const byId = new Map(orders.map((o) => [o.id, o]));
const val = (id) => num(byId.get(id)?.props?.value) || num(byId.get(id)?.props?.qty) * num(byId.get(id)?.props?.unitPrice);

const A = await arm(true);
const C = await arm(false);
console.log(`## GOALLOOP-R1c · 控制台口径敞口 · 扰臂 ${A.sid} vs 零扰臂 ${C.sid} · ${TICKS} 拍`);
const moved = new Set(); let cells = 0;
for (const oid of Object.keys(A.st)) {
  const a = A.st[oid] ?? {}, b = C.st[oid] ?? {};
  for (const k of Object.keys(a)) if (typeof a[k] === "number" && typeof b[k] === "number" && Math.abs(a[k] - b[k]) > 1e-12) { moved.add(oid); cells += 1; }
}
const isOrder = (id) => id.startsWith("obj_order_");
const mo = [...moved].filter(isOrder);
const exp = mo.reduce((x, id) => x + val(id), 0);
const all3 = Object.keys(A.st).filter(isOrder).reduce((x, id) => x + val(id), 0);
const all500 = orders.reduce((x, o) => x + num(o?.props?.value), 0);
console.log(`  动了的格 = ${cells} · 动了的对象 = ${moved.size}（其中 Order = ${mo.length}）`);
console.log(`  ⇒ 控制台口径敞口（Order 差分集按成交额合计）= ${yi(exp)}`);
console.log(`  世界成员订单合计 = ${yi(all3)} · 对象层全表合计 = ${yi(all500)}`);
console.log(`  三口径比值：全表/世界成员 = ${(all500 / (all3 || 1)).toFixed(6)} · 世界成员/被推动 = ${(all3 / (exp || 1)).toFixed(6)} · 全表/被推动 = ${(all500 / (exp || 1)).toFixed(6)}`);
console.log(`DONE ${new Date().toISOString()}`);
