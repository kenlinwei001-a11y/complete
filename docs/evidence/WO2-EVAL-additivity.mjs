#!/usr/bin/env node
/**
 * WO2-EVAL · 横向可加性（零/A/B/A+B 四臂）+ 每行的「静息值是否带内」分类（评估轮自建）
 * A = Material.priceShock +3（obj_material_al_foil），B = 可配（默认 Line.utilPressure +3 on changzhou）
 * 判据：res(A)+res(B) vs res(AB)，err = |rAB-(rA+rB)| / max(|rA|,|rB|,|rAB|,1e-12)
 * 分类：对每个响应格，用**该实例 dist 的域表**算 sat(z)：sat(z)≠z ⇒ 静息在带内（幽灵/自走）
 * 预测（若根因成立）：err 超差的格子基本都落在「静息带内」那一档；带外格可加。
 */
const BASE = process.env.BASE || "http://127.0.0.1:4053";
const DOMS = process.env.DOMS;
const TICKS = Number(process.env.TICKS || 10);
const MAG = Number(process.env.MAG ?? 3);
const DU = "demo:admin:admin|planner|catalog_admin";
const PA = { oid: "obj_material_al_foil", sv: "priceShock", tag: "A:Material.priceShock" };
const PB = (process.env.PB || "obj_line_LINE-WS-changzhou-assembly|utilPressure").split("|");
const PBJ = { oid: PB[0], sv: PB[1], tag: `B:${PB[0]}.${PB[1]}` };

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
  let st = null;
  for (let t = 0; t <= TICKS; t++) {
    const w = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
    st = w?.state ?? {};
    if (t < TICKS) must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1 }), "tick");
  }
  return { id, st };
}
console.log(`## WO2-EVAL 可加性 · BASE=${BASE} · DOMS=${DOMS} · TICKS=${TICKS} · MAG=${MAG}`);
const z = await runOne([]), a = await runOne([PA]), b = await runOne([PBJ]), ab = await runOne([PA, PBJ]);
console.log(`zero=${z.id} A=${a.id} B=${b.id} AB=${ab.id}`);
// 金丝雀（必然为真）：三臂落点必须各自与 zero 不同 —— 否则「没反应」的读数无意义
for (const [tag, arm, p] of [["A", a, PA], ["B", b, PBJ], ["AB", ab, PA]]) {
  const zv = z.st[p.oid]?.[p.sv], av = arm.st[p.oid]?.[p.sv];
  const landed = typeof zv === "number" && typeof av === "number" && Math.abs(av - zv) > 1e-12;
  console.log(`  金丝雀 ${tag} 落点 ${p.oid}.${p.sv}: zero=${zv} 臂=${av} ⇒ ${landed ? "✅ 已落地" : "⛔ 未变（本臂读数作废）"}`);
}
const inBand = (k, v) => { const d = domains[k]; if (d === undefined) return null; return saturateToDomain(v, d.min, d.max, d.restPoint) !== v; };
const rows = [];
for (const oid of Object.keys(z.st)) for (const k of Object.keys(z.st[oid] ?? {})) {
  const zv = z.st[oid]?.[k], av = a.st[oid]?.[k], bv = b.st[oid]?.[k], abv = ab.st[oid]?.[k];
  if ([zv, av, bv, abv].some((x) => typeof x !== "number")) continue;
  const rA = av - zv, rB = bv - zv, rAB = abv - zv;
  if (Math.abs(rA) < 1e-12 && Math.abs(rB) < 1e-12) continue;
  const scale = Math.max(Math.abs(rA), Math.abs(rB), Math.abs(rAB), 1e-12);
  rows.push({ oid, k, zv, rA, rB, rAB, err: Math.abs(rAB - (rA + rB)) / scale, ib: inBand(k, zv) });
}
const bad = rows.filter((x) => x.err > 1e-6);
const inb = rows.filter((x) => x.ib === true), outb = rows.filter((x) => x.ib === false);
console.log(`\n检查 ${rows.length} 格（|rA| 或 |rB| > 1e-12）；不可加(err>1e-6) ${bad.length} 格`);
console.log(`  静息带内格：${inb.length}，其中不可加 ${inb.filter((x) => x.err > 1e-6).length}`);
console.log(`  静息带外格：${outb.length}，其中不可加 ${outb.filter((x) => x.err > 1e-6).length}`);
console.log(`  未声明域：${rows.length - inb.length - outb.length}`);
const by = {}; for (const x of rows) { (by[x.k] ??= { c: 0, b: 0, bib: 0 }).c++; if (x.err > 1e-6) { by[x.k].b++; if (x.ib) by[x.k].bib++; } }
for (const k of Object.keys(by).sort()) console.log(`  ${k}: 不可加 ${by[k].b}/${by[k].c}（其中静息带内 ${by[k].bib}）`);
console.log("top 12 by err：");
for (const x of rows.slice().sort((p, q) => q.err - p.err).slice(0, 12)) {
  console.log(`  ${x.oid}.${x.k}: z=${x.zv} 带内=${x.ib} rA=${x.rA.toExponential(6)} rB=${x.rB.toExponential(6)} rAB=${x.rAB.toExponential(6)} err=${x.err.toExponential(2)}`);
}
console.log(`DONE ${new Date().toISOString()}`);
