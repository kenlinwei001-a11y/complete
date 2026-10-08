#!/usr/bin/env node
/**
 * WO-2 R2 · 全格横向一致性探针 —— 不预设 6 个量名。
 *
 * 与 WO-AB-3PERT-3RUN.mjs 判据② 同一算术（da=a−z, db=b−z, 期望比=MAG_B/MAG_A），
 * 差别只有一处：**遍历世界里的每一个数值格**，再按 stateVar 名字聚合。
 * 目的：回答「超差的到底是哪些量」（上一单只看 6 个名字 ⇒ 口径偏窄）。
 */
const BASE = process.env.BASE || "http://127.0.0.1:4052";
const TICKS = Number(process.env.TICKS || 10);
const MAG_A = Number(process.env.MAG_A ?? 3), MAG_B = Number(process.env.MAG_B ?? 20);
const DU = "demo:admin:admin|planner|catalog_admin";
const api = async (m, p, b) => {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 200)}`); return r.j; };

const P = process.env.PERT === "P2"
  ? { tag: "P2 Material.priceShock", oid: "obj_material_al_foil", sv: "priceShock" }
  : process.env.PERT === "P1"
  ? { tag: "P1 Order.leadDays", oid: "obj_order_SO-3391", sv: "leadDays" }
  : { tag: "P3 Line.utilPressure", oid: "obj_line_LINE-WS-changzhou-assembly", sv: "utilPressure" };

async function runOne(mag) {
  const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
  const id = s?.session?.id ?? s?.id;
  if (mag !== null) {
    must(await api("POST", `/a/v1/sim/sessions/${id}/perturbations`, {
      kind: "supply_disruption", targetObjectId: P.oid, targetStateVar: P.sv, mode: "delta",
      magnitude: mag, startTick: 0, durationTicks: null, label: `${P.sv} ${mag}`,
    }), "pert");
  }
  let st = null;
  for (let t = 0; t <= TICKS; t++) {
    const w = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
    st = w?.state ?? {};
    if (t < TICKS) must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1 }), "tick");
  }
  return { id, st };
}

console.log(`## WO-2 R2 · 全格扫描 · BASE=${BASE} · TICKS=${TICKS} · ${P.tag} 落点 ${P.oid}.${P.sv} · 幅度 ${MAG_A}/${MAG_B}`);
const zr = await runOne(null), a = await runOne(MAG_A), b = await runOne(MAG_B);
console.log(`zero=${zr.id} a=${a.id} b=${b.id}`);
const zp = zr.st[P.oid]?.[P.sv], ap = a.st[P.oid]?.[P.sv], bp = b.st[P.oid]?.[P.sv];
console.log(`被扰动格终态：zero=${zp}  +${MAG_A}=${ap}  +${MAG_B}=${bp}`);
if (!(Math.abs(ap - zp) > 1e-12)) { console.log("⛔ 脉冲金丝雀失败（被扰动格未变）⇒ 全部记 NOT-MEASURED"); process.exit(0); }
console.log("✅ 脉冲金丝雀：扰动已落地");
console.log("");

const z = zr.st, want = MAG_B / MAG_A;
const rows = [];
for (const oid of Object.keys(z)) for (const k of Object.keys(z[oid] ?? {})) {
  const zv = z[oid]?.[k], av = a.st[oid]?.[k], bv = b.st[oid]?.[k];
  if (typeof zv !== "number" || typeof av !== "number" || typeof bv !== "number") continue;
  const da = av - zv, db = bv - zv;
  if (Math.abs(da) < 1e-9) continue;
  const r = db / da, dev = Math.abs(r - want) / want;
  rows.push({ oid, k, zv, av, bv, da, db, r, dev, band: Math.abs(zv) > 75 });
}
console.log(`检查 ${rows.length} 格；超差(>1e-6) ${rows.filter((x) => x.dev > 1e-6).length} 格；期望比 ${want.toFixed(6)}`);
console.log("");
console.log("按量名聚合（bad/checked）：");
const by = {};
for (const x of rows) { (by[x.k] ??= { c: 0, b: 0 }).c++; if (x.dev > 1e-6) by[x.k].b++; }
for (const k of Object.keys(by).sort()) console.log(`  ${k}: ${by[k].b}/${by[k].c}`);
console.log("");
const top = rows.slice().sort((x, y) => y.dev - x.dev).slice(0, 30);
console.log("top 30 by |dev|：");
for (const x of top) console.log(`  ${x.oid}.${x.k}: z=${x.zv} a=${x.av} b=${x.bv} da=${x.da} db=${x.db} r=${x.r} dev=${x.dev.toExponential(2)} ${x.band ? "[z>75 软带内]" : ""}`);
const rs = rows.map((x) => x.r).sort((p, q) => p - q);
const devs = rows.map((x) => x.dev).sort((p, q) => p - q);
console.log("");
console.log(`r 分位：p10=${rs[Math.floor(rs.length*0.1)]} p50=${rs[Math.floor(rs.length*0.5)]} p90=${rs[Math.floor(rs.length*0.9)]}`);
console.log(`dev 分位：p10=${devs[Math.floor(devs.length*0.1)]} p50=${devs[Math.floor(devs.length*0.5)]} p90=${devs[Math.floor(devs.length*0.9)]}`);
console.log(`DONE ${new Date().toISOString()}`);
