#!/usr/bin/env node
/** 双写入方谁赢：读数是否精确等于派生规格公式的值。
 *  Order.costPressure 规格 = creditUsedRatio*100 ; Model.costPressure 规格 = unitCost*100/unitPrice
 *  判据：|读数 − 规格式| 相对误差 ≤1e-9 ⇒ 规格赢（传导被覆盖）；否则 ⇒ 传导也在写。
 */
const BASE = process.env.BASE || "http://127.0.0.1:4051";
const TICKS = Number(process.env.TICKS || 12);
const DU = "demo:admin:admin|planner|catalog_admin";
const api = async (m, p, b) => { const r = await fetch(`${BASE}${p}`, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { s: r.status, j, t }; };
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 200)}`); return r.j; };
const f = (v, d = 9) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : String(v ?? "—"));
const CELLS = [
  { oid: "obj_order_SO-3391", sv: "costPressure", spec: (o) => o.creditUsedRatio * 100, specName: "creditUsedRatio*100" },
  { oid: "obj_order_SO-3391", sv: "creditUsedRatio", spec: null, specName: "（规格的输入）" },
  { oid: "obj_model_4680-NCM", sv: "costPressure", spec: (o) => o.unitCost * 100 / o.unitPrice, specName: "unitCost*100/unitPrice" },
];
async function run(mag, tag) {
  const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session"); const id = s?.session?.id ?? s?.id;
  if (mag !== null) await api("POST", `/a/v1/sim/sessions/${id}/perturbations`, { kind: "supply_disruption", targetObjectId: "obj_order_SO-3391", targetStateVar: "leadDays", mode: "delta", magnitude: mag, startTick: 0, durationTicks: null, label: tag });
  const snap = {};
  for (let t = 0; t <= TICKS; t++) { const w = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world"); if (t === TICKS) snap.state = w?.state ?? {}; if (t < TICKS) must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1 }), "tick"); }
  return snap.state;
}
console.log("## 双写入方谁赢 · 读数是否恰等于派生规格式");
console.log(`> BASE=${BASE} · TICKS=${TICKS} · 判据 相对误差 ≤1e-9 ⇒ 规格赢（传导被覆盖）`);
console.log("");
const arms = { zero: await run(null, "zero"), m3: await run(-3, "m3"), m20: await run(-20, "m20") };
for (const c of CELLS) {
  console.log(`### ${c.oid}.${c.sv}   规格：${c.specName}`);
  console.log("臂".padEnd(6) + "读数".padEnd(20) + "规格式值".padEnd(20) + "差".padEnd(20) + "判");
  for (const [nm, st] of Object.entries(arms)) {
    const o = st[c.oid] ?? {}; const v = o[c.sv];
    const sv = c.spec ? c.spec(o) : null;
    const d = sv === null ? null : v - sv;
    const rel = d === null ? null : Math.abs(d) / Math.max(1e-12, Math.abs(sv));
    console.log(nm.padEnd(6) + f(v).padEnd(20) + f(sv).padEnd(20) + f(d).padEnd(20) + (d === null ? "—" : rel <= 1e-9 ? "✅ 规格赢" : "❌ 传导也在写"));
  }
  console.log("");
}
console.log(`DONE ${new Date().toISOString()}`);
