#!/usr/bin/env node
/** 3 个不同扰动 × 3 次独立运行：验「确定」+「走不同链路都修好了」。
 *  修好了的判据（每条都能独立复算）：
 *   ① 静息态：zero 臂相关格恒 = restPoint(0)
 *   ② 线性：mag 臂偏离量随幅度按比例（比值 = 输入比）
 *   ③ 确定性：同扰动 3 次运行逐字节同（不是随机）
 */
const BASE = process.env.BASE || "http://127.0.0.1:4052";
const TICKS = Number(process.env.TICKS || 10);
const MAG_A = Number(process.env.MAG_A ?? -3);
const MAG_B = Number(process.env.MAG_B ?? -20);
const RUNS = Number(process.env.RUNS || 3);
const DU = "demo:admin:admin|planner|catalog_admin";
const api = async (m, p, b) => { const r = await fetch(`${BASE}${p}`, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { s: r.status, j, t }; };
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 200)}`); return r.j; };

// 三个走不同链路的扰动（落点对象/状态量都不同）
const PERTS = [
  { tag: "P1 Order.leadDays(交期)",           oid: "obj_order_SO-3391",  sv: "leadDays" },
  { tag: "P2 Material.priceShock(料价)",      oid: "obj_material_al_foil", sv: "priceShock" },
  { tag: "P3 Line.utilPressure(产线利用率)",  oid: "obj_line_LINE-WS-changzhou-assembly", sv: "utilPressure" },
];

const NAMES = ["costPressure", "receivablePressure", "loadIndex", "utilPressure", "demandPressure", "shortageRisk"];
const digest = (st) => {
  const parts = [];
  for (const oid of Object.keys(st).sort()) for (const k of Object.keys(st[oid]).sort()) {
    const v = st[oid][k]; if (typeof v === "number" && NAMES.some((n) => k.endsWith(n) || k === n)) parts.push(`${oid}.${k}=${v}`);
  }
  return parts.join("|");
};
async function run(pert, mag) {
  const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session"); const id = s?.session?.id ?? s?.id;
  if (mag !== null) {
    const r = await api("POST", `/a/v1/sim/sessions/${id}/perturbations`, { kind: "supply_disruption", targetObjectId: pert.oid, targetStateVar: pert.sv, mode: "delta", magnitude: mag, startTick: 0, durationTicks: null, label: `${pert.tag} ${mag}` });
    if (r.s >= 400) return { err: `${r.s} ${(r.t || "").slice(0, 120)}` };
  }
  let st = null;
  for (let t = 0; t <= TICKS; t++) { const w = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world"); st = w?.state ?? {}; if (t < TICKS) must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1 }), "tick"); }
  return { id, st, d: digest(st) };
}
const sum = (st) => { let n = 0, nz = 0; for (const oid of Object.keys(st)) for (const k of NAMES) { const v = st[oid]?.[k]; if (typeof v === "number") { n++; if (Math.abs(v) > 1e-12) nz++; } } return `${nz}/${n}`; };

console.log(`## 3 扰动 × ${RUNS} 次独立运行 · BASE=${BASE} TICKS=${TICKS} 幅度 ${MAG_A}/${MAG_B}`);
console.log("");
for (const p of PERTS) {
  console.log(`### ${p.tag}  落点 ${p.oid}.${p.sv}`);
  const runs = [];
  for (let i = 1; i <= RUNS; i++) { const r = await run(p, MAG_A); runs.push(r); console.log(`  run#${i} ${r.err ? "❌ " + r.err : `session=${r.id}`}`); }
  const ok = runs.filter((r) => !r.err);
  if (ok.length < 2) { console.log(`  ⛔ 有效运行 <2，本扰动跳过（⛔ 不报"没反应"）\n`); continue; }
  const same = new Set(ok.map((r) => r.d)).size === 1;
  console.log(`  ── 判据③ 确定性：${RUNS} 次逐字节 ${same ? "✅ 相同（非随机）" : "❌ 不同"}`);
  console.log(`  ── 判据① 静息相关格非 0 数：${ok.map((r) => sum(r.st)).join(" / ")}`);
  // ★ 修：必须先跑【真 zero 臂】——否则 `z === 同臂` ⇒ da 恒 0 ⇒ checked=0 报假绿
  const zr = await run(p, null);
  if (zr.err) { console.log(`  ⛔ zero 臂失败：${zr.err}（本扰动判据② 记 NOT-MEASURED）\n`); continue; }
  // ★ 金丝雀口径修正：直接看【被扰动的那格自己】变没变 ——
  //   先前用"6 个量名的非0格数"当金丝雀是错口径：它度量的是"那 6 个量变没变"，
  //   而不是"扰动落没落地"。扰动打在别的量上时，前者恒等 ⇒ 会把真落地误判成没落地。
  const zp = zr.st[p.oid]?.[p.sv], ap = ok[0].st[p.oid]?.[p.sv];
  console.log(`  ── 被扰动格 ${p.oid}.${p.sv}：zero=${zp}  mag=${ap}`);
  if (typeof zp !== "number" || typeof ap !== "number" || Math.abs(ap - zp) < 1e-12) {
    console.log(`  ⛔【脉冲金丝雀失败】被扰动格自身未变 ⇒ 扰动没落地，本扰动判据记 NOT-MEASURED（⛔ 不许报"修好了"）\n`); continue;
  }
  console.log(`  ── ✅ 脉冲金丝雀：被扰动格 ${zp} → ${ap} ⇒ 扰动已落地`);
  const b = await run(p, MAG_B);
  if (b.err) { console.log(`  ⚠ 幅度 ${MAG_B} 臂失败：${b.err}\n`); continue; }
  // 判据② 线性：两个幅度下，「偏离 = 值 − zero臂值」之比应 = 输入比
  const z = zr.st; let checked = 0, maxDev = 0, bad = 0;
  for (const oid of Object.keys(z)) for (const k of NAMES) {
    const zv = z[oid]?.[k], av = ok[0].st[oid]?.[k], bv = b.st[oid]?.[k];
    if (typeof zv !== "number" || typeof av !== "number" || typeof bv !== "number") continue;
    const da = av - zv, db = bv - zv;
    if (Math.abs(da) < 1e-9) continue;
    checked++;
    const r = db / da, want = MAG_B / MAG_A;
    const dev = Math.abs(r - want) / Math.abs(want);
    if (dev > maxDev) maxDev = dev;
    if (dev > 1e-6) bad++;
  }
  if (checked === 0) console.log(`  ── 判据② 线性：⛔ 检查 0 格 —— 空集【判不了】，记 NOT-MEASURED（⛔ 不许报绿）`);
  else console.log(`  ── 判据② 线性：检查 ${checked} 格，偏离比应恒 = ${(MAG_B / MAG_A).toFixed(4)}；超差(>1e-6) ${bad} 格，最大相对偏差 ${maxDev.toExponential(2)} ${bad === 0 ? "✅" : "❌"}`);
  console.log("");
}
console.log(`DONE ${new Date().toISOString()}`);
