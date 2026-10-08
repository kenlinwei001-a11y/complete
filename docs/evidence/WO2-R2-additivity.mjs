#!/usr/bin/env node
/**
 * WO-2 R2 · 多扰动可加性（WO-2 PRD 的正面判据）：A+B 的响应 == A 的响应 + B 的响应？
 * 三臂各自与 zero 臂比：res(A)=A−z, res(B)=B−z, res(AB)=AB−z，判 |res(AB) − (res(A)+res(B))| / scale。
 */
const BASE = process.env.BASE || "http://127.0.0.1:4052";
const TICKS = Number(process.env.TICKS || 10);
const MAG = Number(process.env.MAG ?? 3);
const DU = "demo:admin:admin|planner|catalog_admin";
const api = async (m, p, b) => {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 200)}`); return r.j; };
const PA = { oid: "obj_material_al_foil", sv: "priceShock", tag: "A:Material.priceShock" };
const PB = { oid: "obj_line_LINE-WS-changzhou-assembly", sv: "utilPressure", tag: "B:Line.utilPressure" };

async function runOne(perts) {
  const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
  const id = s?.session?.id ?? s?.id;
  for (const p of perts) must(await api("POST", `/a/v1/sim/sessions/${id}/perturbations`, {
    kind: "supply_disruption", targetObjectId: p.oid, targetStateVar: p.sv, mode: "delta",
    magnitude: MAG, startTick: 0, durationTicks: null, label: p.tag,
  }), "pert");
  let st = null;
  for (let t = 0; t <= TICKS; t++) {
    const w = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
    st = w?.state ?? {};
    if (t < TICKS) must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1 }), "tick");
  }
  return { id, st };
}
console.log(`## WO-2 R2 可加性 · BASE=${BASE} · TICKS=${TICKS} · 幅度 ${MAG}（A=priceShock, B=utilPressure）`);
const z = await runOne([]), a = await runOne([PA]), b = await runOne([PB]), ab = await runOne([PA, PB]);
console.log(`zero=${z.id}\nA=${a.id}\nB=${b.id}\nAB=${ab.id}`);
// 金丝雀：A/B 各自落地
for (const [tag, arm, p] of [["A", a, PA], ["B", b, PB], ["AB", ab, PA]]) {
  console.log(`  ${tag} 落点 ${p.sv}: ${arm.st[p.oid]?.[p.sv]}（zero=${z.st[p.oid]?.[p.sv]}）`);
}
const rows = [];
for (const oid of Object.keys(z.st)) for (const k of Object.keys(z.st[oid] ?? {})) {
  const zv = z.st[oid]?.[k], av = a.st[oid]?.[k], bv = b.st[oid]?.[k], abv = ab.st[oid]?.[k];
  if ([zv, av, bv, abv].some((x) => typeof x !== "number")) continue;
  const rA = av - zv, rB = bv - zv, rAB = abv - zv;
  const scale = Math.max(Math.abs(rA), Math.abs(rB), Math.abs(rAB), 1e-12);
  const err = Math.abs(rAB - (rA + rB)) / scale;
  if (Math.abs(rA) < 1e-12 && Math.abs(rB) < 1e-12) continue;
  rows.push({ oid, k, zv, rA, rB, rAB, err });
}
const bad = rows.filter((x) => x.err > 1e-6);
console.log(`\n检查 ${rows.length} 格（|rA| 或 |rB| > 1e-12）；不可加(err>1e-6) ${bad.length} 格`);
const by = {}; for (const x of rows) { (by[x.k] ??= { c: 0, b: 0 }).c++; if (x.err > 1e-6) by[x.k].b++; }
for (const k of Object.keys(by).sort()) console.log(`  ${k}: ${by[k].b}/${by[k].c}`);
const top = rows.slice().sort((x, y) => y.err - x.err).slice(0, 15);
console.log("top 15 by err：");
for (const x of top) console.log(`  ${x.oid}.${x.k}: z=${x.zv} rA=${x.rA} rB=${x.rB} rAB=${x.rAB} err=${x.err.toExponential(2)}`);
console.log(`DONE ${new Date().toISOString()}`);
