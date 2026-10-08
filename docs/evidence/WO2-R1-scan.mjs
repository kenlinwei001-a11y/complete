#!/usr/bin/env node
/**
 * WO-2 R1 · 横向一致性探针 v1 —— 先看清「谁在超差」。
 *
 * 只读探针：建会话（世界可重建）→ 施加一条扰动 → 逐拍 tick → 读世界。
 * 输出三件：
 *   ① 被扰动格逐拍轨迹（zero / +m 各幅度）—— 看脉冲怎么衰减
 *   ② 判据② 线性 的逐格明细（zv/av/bv/da/db/比），按 |dev| 降序
 *   ③ 每次 tick 回执里的 saturations（若有）—— 谁被投影压了
 */
const BASE = process.env.BASE || "http://127.0.0.1:4052";
const TICKS = Number(process.env.TICKS || 10);
const DU = "demo:admin:admin|planner|catalog_admin";
const api = async (m, p, b) => {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 200)}`); return r.j; };

const NAMES = ["costPressure", "receivablePressure", "loadIndex", "utilPressure", "demandPressure", "shortageRisk"];

async function runOne(oid, sv, mag) {
  const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
  const id = s?.session?.id ?? s?.id;
  if (mag !== null) {
    must(await api("POST", `/a/v1/sim/sessions/${id}/perturbations`, {
      kind: "supply_disruption", targetObjectId: oid, targetStateVar: sv, mode: "delta",
      magnitude: mag, startTick: 0, durationTicks: null, label: `${sv} ${mag}`,
    }), "pert");
  }
  const traj = [];      // 被扰动格逐拍值
  const sats = [];      // 每拍 saturations
  let st = null;
  for (let t = 0; t <= TICKS; t++) {
    const w = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
    st = w?.state ?? {};
    traj.push({ t, v: st[oid]?.[sv] });
    if (t < TICKS) {
      const r = must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1 }), "tick");
      // 回执里的饱和账（视版本字段名而定，两种都试）
      const s1 = r?.stateVarReport?.saturations ?? r?.stateVarReport?.saturation ?? null;
      if (Array.isArray(s1) && s1.length) sats.push({ t: t + 1, list: s1 });
      st = r?.state ?? st;
    }
  }
  return { id, st, traj, sats };
}

const P = process.env.PERT === "P2"
  ? { tag: "P2 Material.priceShock", oid: "obj_material_al_foil", sv: "priceShock" }
  : { tag: "P3 Line.utilPressure", oid: "obj_line_LINE-WS-changzhou-assembly", sv: "utilPressure" };
const MAG_A = Number(process.env.MAG_A ?? 3), MAG_B = Number(process.env.MAG_B ?? 20);

console.log(`## WO-2 R1 · BASE=${BASE} · TICKS=${TICKS} · ${P.tag} 落点 ${P.oid}.${P.sv} · 幅度 ${MAG_A}/${MAG_B}`);
console.log("");
const zr = await runOne(P.oid, P.sv, null);
console.log(`── 被扰动格逐拍轨迹（zero 臂）：${zr.traj.map((x) => `${x.t}:${x.v}`).join(" → ")}`);
console.log(`   session zero=${zr.id}`);
const a = await runOne(P.oid, P.sv, MAG_A);
console.log(`── 被扰动格逐拍轨迹（+${MAG_A} 臂）：${a.traj.map((x) => `${x.t}:${x.v}`).join(" → ")}`);
console.log(`   session a=${a.id}`);
const b = await runOne(P.oid, P.sv, MAG_B);
console.log(`── 被扰动格逐拍轨迹（+${MAG_B} 臂）：${b.traj.map((x) => `${x.t}:${x.v}`).join(" → ")}`);
console.log(`   session b=${b.id}`);
console.log("");
if (zr.sats.length || a.sats.length || b.sats.length) {
  for (const [tag, r] of [["zero", zr], [`+${MAG_A}`, a], [`+${MAG_B}`, b]]) {
    for (const s of r.sats) console.log(`饱和账[${tag}] t=${s.t}: ${JSON.stringify(s.list).slice(0, 400)}`);
  }
} else console.log("（三个臂的 tick 回执里都没带 saturations —— 字段名或版本不对，非「没有饱和」的证据）");
console.log("");

// 判据② 明细
const z = zr.st; let rows = [];
for (const oid of Object.keys(z)) for (const k of NAMES) {
  const zv = z[oid]?.[k], av = a.st[oid]?.[k], bv = b.st[oid]?.[k];
  if (typeof zv !== "number" || typeof av !== "number" || typeof bv !== "number") continue;
  const da = av - zv, db = bv - zv;
  if (Math.abs(da) < 1e-9) continue;
  const r = db / da, want = MAG_B / MAG_A, dev = Math.abs(r - want) / Math.abs(want);
  rows.push({ oid, k, zv, av, bv, da, db, r, dev });
}
rows.sort((x, y) => y.dev - x.dev);
console.log(`── 判据② 明细：检查 ${rows.length} 格；超差(>1e-6) ${rows.filter((x) => x.dev > 1e-6).length} 格；期望比 = ${(MAG_B / MAG_A).toFixed(6)}`);
console.log("top 25 by |dev|:");
for (const x of rows.slice(0, 25)) {
  console.log(`  ${x.oid}.${x.k}: z=${x.zv} a=${x.av} b=${x.bv} da=${x.da} db=${x.db} r=${x.r} dev=${x.dev.toExponential(2)}`);
}
console.log("");
console.log(`distinct r 值（前 20）：${[...new Set(rows.map((x) => x.r.toFixed(6)))].slice(0, 20).join(", ")}`);
console.log(`da 分布：max=${Math.max(...rows.map((x) => Math.abs(x.da)))} min=${Math.min(...rows.map((x) => Math.abs(x.da)))}`);
console.log(`按名统计超差：`);
const byName = {};
for (const x of rows) { byName[x.k] ??= { checked: 0, bad: 0 }; byName[x.k].checked++; if (x.dev > 1e-6) byName[x.k].bad++; }
for (const k of Object.keys(byName).sort()) console.log(`  ${k}: ${byName[k].bad}/${byName[k].checked}`);
console.log(`DONE ${new Date().toISOString()}`);
