#!/usr/bin/env node
/** WO-2 R3 · (1) 种子 baseSnapshot vs 世界 t0（看 tick0 硬界压缩的规模：blockedPressure 真值 >100 的格）
 *            (2) 零臂 12 拍「爆炸半径」：4052 vs 4054 全格 diff 随拍数演化
 */
const A = "http://127.0.0.1:4052", B = "http://127.0.0.1:4054";
const TICKS = Number(process.env.TICKS || 12);
const DU = "demo:admin:admin|planner|catalog_admin";
const api = async (base, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { s: r.status, j, t }; };
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 200)}`); return r.j; };
async function open(base) { const s = must(await api(base, "POST", "/a/v1/sim/sessions", {}), "session"); const id = s?.session?.id ?? s?.id; const base0 = s?.baseSnapshot ?? s?.session?.baseSnapshot ?? {}; const w = must(await api(base, "GET", `/a/v1/sim/sessions/${id}/world`), "world"); return { id, base0, st: w?.state ?? {} }; }
const a = await open(A), b = await open(B);
// (1) blockedPressure 种子 vs t0
const rows = Object.keys(a.base0).filter((o) => typeof a.base0[o]?.blockedPressure === "number").map((o) => ({ o, seed: a.base0[o].blockedPressure, t0: a.st[o]?.blockedPressure }));
const over = rows.filter((r) => r.seed > 100);
console.log(`## (1) 4052 种子→世界 t0 · blockedPressure 格 ${rows.length}`);
console.log(`  baseSnapshot > 100（越声明上界）的格 = ${over.length}`);
for (const r of over.slice(0, 8)) console.log(`    ${r.o}: seed=${r.seed} → t0=${r.t0}`);
console.log(`  seed ≤ 100 但在带内(>75) 的格 = ${rows.filter((r) => r.seed <= 100 && r.t0 > 75).length}`);
const changed = rows.filter((r) => r.seed !== r.t0);
console.log(`  seed ≠ t0（被 tick0 投影改过的格）= ${changed.length}`);
// (2) blast radius over ticks (zero arm)
const diffCell = (x, y) => { let n = 0; const byName = {}; for (const oid of Object.keys(x)) for (const k of Object.keys(x[oid])) { const vx = x[oid][k], vy = y[oid]?.[k]; if (typeof vx === "number" && vx !== vy) { n++; byName[k] = (byName[k] ?? 0) + 1; } } return { n, byName }; };
let d = diffCell(a.st, b.st);
console.log(`\n## (2) 零臂逐拍 diff（4052 vs 4054）`);
console.log(`  t=0  差异格 ${d.n}  ${JSON.stringify(d.byName)}`);
for (let t = 1; t <= TICKS; t++) {
  must(await api(A, "POST", `/a/v1/sim/sessions/${a.id}/tick`, { n: 1 }), "tickA");
  must(await api(B, "POST", `/a/v1/sim/sessions/${b.id}/tick`, { n: 1 }), "tickB");
  const wa = must(await api(A, "GET", `/a/v1/sim/sessions/${a.id}/world`), "wA");
  const wb = must(await api(B, "GET", `/a/v1/sim/sessions/${b.id}/world`), "wB");
  d = diffCell(wa.state ?? {}, wb.state ?? {});
  const top = Object.entries(d.byName).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join(" ");
  console.log(`  t=${String(t).padEnd(2)} 差异格 ${String(d.n).padEnd(5)} ${top}`);
}
console.log(`DONE ${new Date().toISOString()}`);
