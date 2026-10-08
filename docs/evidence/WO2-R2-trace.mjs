#!/usr/bin/env node
/**
 * WO-2 R2 · 逐拍轨迹对照（三臂：zero / +3 / +20）
 * 用途：看清「响应」到底是幅度响应，还是不动点迁移/瞬态残留。
 */
const BASE = process.env.BASE || "http://127.0.0.1:4053";
const TICKS = Number(process.env.TICKS || 12);
const MAG_A = Number(process.env.MAG_A ?? 3), MAG_B = Number(process.env.MAG_B ?? 20);
const DU = "demo:admin:admin|planner|catalog_admin";
const api = async (m, p, b) => {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 200)}`); return r.j; };

const P = process.env.PERT === "P2"
  ? { oid: "obj_material_al_foil", sv: "priceShock" }
  : { oid: "obj_line_LINE-WS-changzhou-assembly", sv: "utilPressure" };

const CELLS = [
  ["obj_line_LINE-WS-changzhou-assembly", "utilPressure"],
  ["obj_order_SO-900074", "costPressure"],
  ["obj_customer_cust_11", "receivablePressure"],
  ["obj_material_al_foil", "priceShock"],
];

async function runOne(mag) {
  const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
  const id = s?.session?.id ?? s?.id;
  if (mag !== null) must(await api("POST", `/a/v1/sim/sessions/${id}/perturbations`, {
    kind: "supply_disruption", targetObjectId: P.oid, targetStateVar: P.sv, mode: "delta",
    magnitude: mag, startTick: 0, durationTicks: null, label: `${P.sv} ${mag}`,
  }), "pert");
  const out = [];
  for (let t = 0; t <= TICKS; t++) {
    const w = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
    out.push({ t, st: w?.state ?? {} });
    if (t < TICKS) must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1 }), "tick");
  }
  return out;
}
console.log(`## WO-2 R2 trace · BASE=${BASE} · TICKS=${TICKS} · ${P.oid}.${P.sv} · 幅度 ${MAG_A}/${MAG_B}`);
const z = await runOne(null), a = await runOne(MAG_A), b = await runOne(MAG_B);
for (const [oid, sv] of CELLS) {
  console.log(`\n### ${oid}.${sv}`);
  console.log("t   zero                 +" + MAG_A + "                     +" + MAG_B);
  for (let t = 0; t <= TICKS; t++) {
    const f = (x) => String(x?.[oid]?.[sv]).padEnd(20);
    console.log(`${String(t).padEnd(4)}${f(z[t].st)} ${f(a[t].st)} ${f(b[t].st)}`);
  }
}
console.log(`\nDONE ${new Date().toISOString()}`);
