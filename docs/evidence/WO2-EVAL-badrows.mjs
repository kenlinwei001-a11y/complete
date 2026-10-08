#!/usr/bin/env node
/**
 * WO2-EVAL · 追查「超差但静息不在带内」的行：四臂逐拍轨迹 + 膝盖位置 + 是否响应期驶入带内/触硬地板
 * 输出来源：同 WO2-EVAL-additivity.mjs 的四臂，但把每行的四臂轨迹留下来。
 */
const BASE = process.env.BASE || "http://127.0.0.1:4053";
const DOMS = process.env.DOMS;
const TICKS = Number(process.env.TICKS || 10);
const MAG = Number(process.env.MAG ?? 3);
const DU = "demo:admin:admin|planner|catalog_admin";
const PA = { oid: "obj_material_al_foil", sv: "priceShock", tag: "A" };
const PB = { oid: "obj_line_LINE-WS-changzhou-assembly", sv: "utilPressure", tag: "B" };
const { stateVarDomains } = await import(`${DOMS}/synthetic/battery.js`);
const { saturateToDomain } = await import(`${DOMS}/sim/propagation.js`);
const domains = stateVarDomains();
const api = async (m, p, b) => {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 260)}`); return r.j; };
async function runOne(perts) {
  const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
  const id = s?.session?.id ?? s?.id;
  for (const p of perts) must(await api("POST", `/a/v1/sim/sessions/${id}/perturbations`, { kind: "supply_disruption", targetObjectId: p.oid, targetStateVar: p.sv, mode: "delta", magnitude: MAG, startTick: 0, durationTicks: null, label: p.tag }), "pert");
  const snaps = [];
  for (let t = 0; t <= TICKS; t++) {
    const w = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
    snaps.push(w?.state ?? {});
    if (t < TICKS) must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1 }), "tick");
  }
  return snaps;
}
console.log(`## WO2-EVAL badrows · BASE=${BASE} TICKS=${TICKS} MAG=${MAG}`);
const Z = await runOne([]), A = await runOne([PA]), B = await runOne([PB]), AB = await runOne([PA, PB]);
const kneeOf = (k) => { const d = domains[k]; if (!d) return null; if (d.max === null) return null; const rest = Math.min(d.max, Math.max(d.min, d.restPoint)); const bandHi = (d.max - rest) * 0.25; return bandHi > 0 ? d.max - bandHi : null; };
// 找出与 R3 版同一口径的 bad 行
const seen = new Set();
const rows = [];
for (const oid of Object.keys(Z[0])) for (const k of Object.keys(Z[0][oid] ?? {})) {
  const zv = Z[TICKS][oid]?.[k], av = A[TICKS][oid]?.[k], bv = B[TICKS][oid]?.[k], abv = AB[TICKS][oid]?.[k];
  if ([zv, av, bv, abv].some((x) => typeof x !== "number")) continue;
  const rA = av - zv, rB = bv - zv, rAB = abv - zv;
  if (Math.abs(rA) < 1e-12 && Math.abs(rB) < 1e-12) continue;
  const scale = Math.max(Math.abs(rA), Math.abs(rB), Math.abs(rAB), 1e-12);
  const err = Math.abs(rAB - (rA + rB)) / scale;
  if (err <= 1e-6) continue;
  const z0 = Z[0][oid]?.[k];
  const d = domains[k];
  const zt0in = d ? saturateToDomain(z0, d.min, d.max, d.restPoint) !== z0 : null;
  // 四臂里这一格自己是否驶入带内（sat(v)!=v）
  const entered = [Z, A, B, AB].some((arm) => arm.some((st) => { const v = st[oid]?.[k]; return typeof v === "number" && d && saturateToDomain(v, d.min, d.max, d.restPoint) !== v; }));
  const floorHit = [Z, A, B, AB].some((arm) => arm.some((st) => { const v = st[oid]?.[k]; return typeof v === "number" && d && v < d.min; }));
  rows.push({ oid, k, zt: zv, z0, err, rA, rB, rAB, knee: kneeOf(k), zt0in, entered, floorHit, dom: d });
}
console.log(`bad 行 ${rows.length}`);
for (const r of rows.sort((x, y) => y.err - x.err)) {
  console.log(`\n${r.oid}.${r.k}  err=${r.err.toExponential(2)}  z(t0)=${r.z0} z(t${TICKS})=${r.zt} 域=[${r.dom?.min},${r.dom?.max}] rest=${r.dom?.restPoint} knee=${r.knee} 静息带内=${r.zt0in} 响应期驶入带内=${r.entered} 触下界=${r.floorHit}`);
  console.log(`   rA=${r.rA} rB=${r.rB} rAB=${r.rAB}`);
  const traj = (arm) => arm.map((st) => st[r.oid]?.[r.k]).join(" → ");
  console.log(`   zero: ${traj(Z)}`);
  console.log(`   A   : ${traj(A)}`);
  console.log(`   B   : ${traj(B)}`);
  console.log(`   AB  : ${traj(AB)}`);
}
console.log(`DONE ${new Date().toISOString()}`);
