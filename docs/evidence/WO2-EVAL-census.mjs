#!/usr/bin/env node
/**
 * WO2-EVAL · 幽灵格独立普查（评估轮自建，独立于分析轮的 WO2-R3-census.mjs）
 *
 * 与 R3 版的两处独立：
 *  1) 不按「量名白名单」判带，而按**运行实例自己的域表**逐格算 sat（域是真相源）；
 *  2) sat 用**我自己独立重写的**闭式，且与实例 dist 的 saturateToDomain 逐格交叉核对（分歧即报）。
 * 判据：幽灵 = ① t0..tN 逐字节冻结 ∧ ② sat(v) ≠ v（带内）
 * 金丝雀：冻结总数 > 0（否则本探针什么都没读到）。
 */
import { createRequire } from "node:module";
const BASE = process.env.BASE || "http://127.0.0.1:4052";
const DOMS = process.env.DOMS; // dist root, e.g. /tmp/wt-ab/apps/datacore/dist
const TICKS = Number(process.env.TICKS || 12);
const DU = "demo:admin:admin|planner|catalog_admin";

const { stateVarDomains } = await import(`${DOMS}/synthetic/battery.js`);
const { saturateToDomain } = await import(`${DOMS}/sim/propagation.js`);
const domains = stateVarDomains();

// —— 我自己的独立闭式（照 propagation.ts 的几何文字重写，不 import 引擎实现）——
const BAND = 0.25;
function mySat(v, d) {
  const { min, max } = d;
  if (max === null) {
    const restLo = Math.max(min, d.restPoint);
    const bandLo = (restLo - min) * BAND;
    if (bandLo > 0) {
      const kneeLo = min + bandLo;
      if (v < kneeLo) return min + bandLo / (1 + (kneeLo - v) / bandLo);
    } else if (v < min) return min;
    return v;
  }
  if (!(max > min)) return v;
  const rest = Math.min(max, Math.max(min, d.restPoint));
  const bandHi = (max - rest) * BAND;
  if (bandHi > 0) {
    const kneeHi = max - bandHi;
    if (v > kneeHi) return max - bandHi / (1 + (v - kneeHi) / bandHi);
  } else if (v > max) return max;
  const bandLo = (rest - min) * BAND;
  if (bandLo > 0) {
    const kneeLo = min + bandLo;
    if (v < kneeLo) return min + bandLo / (1 + (kneeLo - v) / bandLo);
  } else if (v < min) return min;
  return v;
}

const api = async (m, p, b) => {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 300)}`); return r.j; };

const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
const id = s?.session?.id ?? s?.id;
const snaps = [];
for (let t = 0; t <= TICKS; t++) {
  const w = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
  snaps.push(w?.state ?? {});
  if (t < TICKS) must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1 }), "tick");
}
console.log(`## WO2-EVAL census · BASE=${BASE} · DOMS=${DOMS} · session=${id} · TICKS=${TICKS}`);
const t0 = snaps[0];
let cells = 0, frozenAll = 0, inBandAll = 0, ghost = 0, mismatch = 0, undeclared = 0, hardOut = 0, selfWalk = 0;
const byName = new Map(); // name -> {n, inBand, frozen, ghost, selfWalk, min, max, samples:[]}
for (const oid of Object.keys(t0)) {
  for (const [name, v0] of Object.entries(t0[oid] ?? {})) {
    if (typeof v0 !== "number") continue;
    cells++;
    const d = domains[name];
    if (d === undefined) { undeclared++; continue; }
    const satMine = mySat(v0, d), satDist = saturateToDomain(v0, d.min, d.max, d.restPoint);
    if (satMine !== satDist) { mismatch++; console.log(`  ⚠ sat 分歧 ${oid}.${name}: mine=${satMine} dist=${satDist}`); }
    const ib = satDist !== v0;
    const out = v0 < d.min || (d.max !== null && v0 > d.max);
    if (out) hardOut++;
    let frozen = true;
    for (let t = 1; t <= TICKS; t++) {
      const v = snaps[t][oid]?.[name];
      if (typeof v !== "number" || v !== v0) { frozen = false; break; }
    }
    if (frozen) frozenAll++;
    if (ib) inBandAll++;
    if (ib && !frozen) selfWalk++;
    let rec = byName.get(name);
    if (!rec) { rec = { n: 0, inBand: 0, frozen: 0, ghost: 0, selfWalk: 0, min: Infinity, max: -Infinity, samples: [] }; byName.set(name, rec); }
    rec.n++; rec.min = Math.min(rec.min, v0); rec.max = Math.max(rec.max, v0);
    if (ib) rec.inBand++;
    if (frozen) rec.frozen++;
    if (ib && frozen) { rec.ghost++; ghost++; if (rec.samples.length < 3) rec.samples.push(`${oid}=${v0}→sat=${satDist}`); }
    if (ib && !frozen) rec.selfWalk++;
  }
}
console.log(`格 ${cells} · 未声明量名格 ${undeclared} · sat 分歧 ${mismatch}（应为 0）`);
console.log(`★ 金丝雀（必然为真对照）：逐字节冻结 ${frozenAll} (>0 ⇒ 探针读到了东西) · 域内硬越界 ${hardOut}`);
console.log(`带内（sat(v)≠v）${inBandAll} 格 · 其中冻结（幽灵）${ghost} 格 · 其中在动（自走）${selfWalk} 格`);
const rows = [...byName.entries()].filter(([, r]) => r.inBand > 0).sort((a, b) => b[1].inBand - a[1].inBand);
console.log(`\n带内量名（${rows.length} 个）：`);
for (const [name, r] of rows) {
  console.log(`  ${name.padEnd(22)} 带内 ${String(r.inBand).padStart(4)}/${String(r.n).padStart(4)} · 冻结 ${String(r.ghost).padStart(4)} · 自走 ${String(r.selfWalk).padStart(3)} · 域内极值 [${r.min}, ${r.max}]`);
  for (const sx of r.samples) console.log(`      e.g. ${sx}`);
}
console.log(`DONE ${new Date().toISOString()}`);
