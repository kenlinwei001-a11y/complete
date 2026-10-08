#!/usr/bin/env node
/** WO-2 R3 · P1 路径 A/B：4052（现状）vs 4054（P1 副本：Line|blockedPressure + Model|forecastBias = DEVIATION）
 *  判据 (a) 该量名零臂值 == restPoint（配"旧基值在带内"对照）
 *  判据 (c) tick0 全格 diff：差异必须**只**落在被裁定的两个量名上（E2：其余格逐字节不动）
 */
const A = "http://127.0.0.1:4052", B = "http://127.0.0.1:4054";
const DU = "demo:admin:admin|planner|catalog_admin";
const api = async (base, m, p, b) => {
  const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 200)}`); return r.j; };
async function t0(base) {
  const s = must(await api(base, "POST", "/a/v1/sim/sessions", {}), "session");
  const id = s?.session?.id ?? s?.id;
  const w = must(await api(base, "GET", `/a/v1/sim/sessions/${id}/world`), "world");
  return { id, st: w?.state ?? {} };
}
const a = await t0(A), b = await t0(B);
console.log(`## P1 A/B · A=${A} (${a.id})  B=${B} (${b.id})`);
// (a) 被裁定量名的零臂值
for (const name of ["blockedPressure", "forecastBias"]) {
  const scan = (st) => { let n = 0, nz = 0, mn = Infinity, mx = -Infinity; for (const oid of Object.keys(st)) { const v = st[oid]?.[name]; if (typeof v !== "number") continue; n++; if (v !== 0) nz++; mn = Math.min(mn, v); mx = Math.max(mx, v); } return { n, nz, mn, mx }; };
  const sa = scan(a.st), sb = scan(b.st);
  console.log(`\n(a) ${name}: A 格数 ${sa.n} 非0 ${sa.nz} 极值[${sa.mn}, ${sa.mx}]  |  B 格数 ${sb.n} 非0 ${sb.nz} 极值[${sb.mn}, ${sb.mx}]  ${sb.n > 0 && sb.nz === 0 ? "✅ 全格 == restPoint(0)" : "❌"}`);
}
// 对照（必然为真）：A 上该量名至少一格旧基值在带内
const inbandA = Object.keys(a.st).filter((o) => typeof a.st[o]?.blockedPressure === "number" && a.st[o].blockedPressure > 75);
console.log(`\n对照（必然为真）：A(4052) blockedPressure 带内(>75) 格数 = ${inbandA.length}（>0 才证明 (a) 不是空集）；样本 ${inbandA[0]} = ${a.st[inbandA[0]]?.blockedPressure}`);
// (c) tick0 diff
const diffs = {};
let diffCells = 0;
const namesA = new Set(); for (const o of Object.keys(a.st)) for (const k of Object.keys(a.st[o])) namesA.add(k);
for (const oid of Object.keys(a.st)) for (const k of Object.keys(a.st[oid])) {
  const va = a.st[oid][k], vb = b.st[oid]?.[k];
  if (typeof va === "number" && va !== vb) { diffCells++; diffs[k] = (diffs[k] ?? 0) + 1; }
}
const objsA = Object.keys(a.st).length, objsB = Object.keys(b.st).length;
let cellsA = 0, cellsB = 0, cellsSame = 0;
for (const oid of Object.keys(a.st)) for (const k of Object.keys(a.st[oid])) { cellsA++; const va = a.st[oid][k], vb = b.st[oid]?.[k]; if (typeof va === "number" && va === vb) cellsSame++; }
for (const oid of Object.keys(b.st)) for (const k of Object.keys(b.st[oid])) cellsB++;
console.log(`\n(c) tick0 diff：对象数 A=${objsA} B=${objsB}（应相等 ${objsA === objsB ? "✅" : "❌"}）· 格数 A=${cellsA} B=${cellsB}（应相等）· 数值不同的格 ${diffCells}（占 ${(100 * diffCells / cellsA).toFixed(2)}%）`);
console.log(`    差异按量名: ${JSON.stringify(diffs)}`);
console.log(`    ⇒ 差异是否只落在 {blockedPressure, forecastBias}: ${Object.keys(diffs).every((k) => k === "blockedPressure" || k === "forecastBias") ? "✅" : "❌ 有外溢"}`);
console.log(`DONE ${new Date().toISOString()}`);
