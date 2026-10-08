#!/usr/bin/env node
/**
 * WO-2 R3 · 幽灵格（=「静止在压缩带内」的格）全量普查 + 按量名归组
 *
 * 判据（机械、可复算）：
 *   幽灵格 := ① 零臂 12 拍逐字节冻结（不动点）∧ ② sat(v) ≠ v（压在带内，投影若执行会改它）
 *   带定义（propagation.ts:414/481-491）：压力族 min0/max100/rest0 ⇒ band=25、knee=75，v>75 压缩
 *                                        forecastBias −100..100/rest0 ⇒ |v|>75 两侧压缩
 *   （max:null 的积压族**没有上带** ⇒ 大值不算幽灵，本探针不把它们计进分子——防「口径偏宽」）
 * 输出：按量名归组 —— 格数 / 带内数 / 冻结数 / 幽灵数 / 极值 / 样本；
 *      并给「必然为真」对照：全字段冻结格数（含带外）必须 > 0，否则本探针读不到任何东西。
 */
const BASE = process.env.BASE || "http://127.0.0.1:4052";
const TICKS = Number(process.env.TICKS || 12);
const DU = "demo:admin:admin|planner|catalog_admin";
const api = async (m, p, b) => {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 200)}`); return r.j; };

const PRESSURE = new Set(["blockedPressure","demandPressure","demandLoad","loadIndex","utilPressure","queuePressure","shortageRisk","supplyRisk","expeditePressure","priceShock","costPressure","receivablePressure","overduePressure","changeoverPressure","releasePressure","feedPressure","defectPressure","turnoverPressure","switchPressure","gapPressure","reviewPressure","loadPressure","windowSqueeze","drawdownPressure","inboundExpeditePressure","transferPressure","splitPressure","promiseRisk","deliveryHoldRisk","collectionPressure","orderChurn","equipmentFailure"]);

/** 带内判定：返回 true 表示「投影若执行会改它」。非上带有界域（积压族/未声明）⇒ false。 */
function inBand(name, v) {
  if (PRESSURE.has(name)) return v > 75;                    // 上带 (max−rest)·0.25 = 25 ⇒ knee 75
  if (name === "forecastBias") return v > 75 || v < -75;    // 两侧各 25
  return false;
}
function satOf(name, v) {
  if (PRESSURE.has(name)) { const u = v - 75; return v > 75 ? 100 - 25 / (1 + u / 25) : v; }
  if (name === "forecastBias") {
    if (v > 75) return 100 - 25 / (1 + (v - 75) / 25);
    if (v < -75) return -100 + 25 / (1 + (-v - 75) / 25);
    return v;
  }
  return v;
}

const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
const id = s?.session?.id ?? s?.id;
const baseSnapshot = s?.baseSnapshot ?? s?.session?.baseSnapshot ?? null;
const snaps = [];
let lastTick = null;
for (let t = 0; t <= TICKS; t++) {
  const w = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
  snaps.push(w?.state ?? {});
  if (t < TICKS) lastTick = must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1 }), "tick");
}
const t0 = snaps[0];

console.log(`## 幽灵格普查 · BASE=${BASE} session=${id} TICKS=${TICKS}`);
const names = new Map(); // name -> {n, inBand, frozen, ghost, min, max, sample}
let frozenAll = 0, frozenInBand = 0, cells = 0;
for (const oid of Object.keys(t0)) {
  for (const [name, v0] of Object.entries(t0[oid] ?? {})) {
    if (typeof v0 !== "number") continue;
    cells++;
    let frozen = true;
    for (let t = 1; t <= TICKS; t++) {
      const v = snaps[t][oid]?.[name];
      if (typeof v !== "number" || v !== v0) { frozen = false; break; }
    }
    if (frozen) frozenAll++;
    const rec = names.get(name) ?? { n: 0, inBand: 0, frozen: 0, ghost: 0, min: Infinity, max: -Infinity, sample: null };
    rec.n++; rec.min = Math.min(rec.min, v0); rec.max = Math.max(rec.max, v0);
    const ib = inBand(name, v0);
    if (ib) rec.inBand++;
    if (frozen) rec.frozen++;
    if (ib && frozen) {
      rec.ghost++; frozenInBand++;
      if (!rec.sample || Math.abs(v0) > Math.abs(rec.sample.v)) rec.sample = { oid, v: v0, sat: satOf(name, v0) };
    }
    names.set(name, rec);
  }
}
console.log(`全格 ${cells} 格 · 全字段冻结 ${frozenAll} 格（★"必然为真"对照 > 0）· 冻结且在带内（= 幽灵） ${frozenInBand} 格`);
const rows = [...names.entries()].filter(([, r]) => r.ghost > 0).sort((a, b) => b[1].ghost - a[1].ghost);
console.log(`\n幽灵量名（${rows.length} 个）—— 按幽灵格数降序：`);
for (const [name, r] of rows) {
  console.log(`  ${name.padEnd(26)} 幽灵 ${String(r.ghost).padStart(4)} / 格 ${String(r.n).padStart(4)} · 带内 ${String(r.inBand).padStart(4)} · 冻结 ${String(r.frozen).padStart(4)} · 域内极值 [${r.min.toFixed(4)}, ${r.max.toFixed(4)}] · 样本 ${r.sample.oid}=${r.sample.v} → sat=${r.sample.sat.toFixed(6)}`);
}
const ibOnly = [...names.entries()].filter(([, r]) => r.inBand > 0 && r.ghost === 0).sort((a, b) => b[1].inBand - a[1].inBand);
console.log(`\n带内但**在动**（非幽灵，供口径对照）:`);
for (const [name, r] of ibOnly) console.log(`  ${name.padEnd(26)} 带内 ${r.inBand} / ${r.n}`);
if (lastTick) {
  const rep = lastTick?.report ?? lastTick?.stateVarReport ?? lastTick;
  const sat = rep?.saturations ?? rep?.stateVarReport?.saturations;
  console.log(`\n末拍回执 saturations 条数 = ${Array.isArray(sat) ? sat.length : "N/A"}；declaredStateVars=${(rep?.declaredStateVars ?? rep?.stateVarReport?.declaredStateVars ?? []).length} undeclared=${(rep?.undeclaredStateVars ?? rep?.stateVarReport?.undeclaredStateVars ?? []).length}`);
}
console.log(`DONE ${new Date().toISOString()}`);
