#!/usr/bin/env node
/**
 * WO2-EVAL · 三臂轨迹 + 独立闭式模型（评估轮自建）
 * 模型（我自己从源码语义重写，不 import 引擎）：
 *   per tick: x' = r12(rest + (1-λ)(x-rest))          // 核衰减（propagation.ts:962）
 *             x'' = r12(x' + λ(base-rest))            // C2 合成（LEVEL 且登记 valueRef 才做；DEVIATION 跳过）
 *             x3 = r12(sat(x'')) 仅当 x'' ≠ x（判据① 字节代理）且 sat≠x''
 *   其中 λ=0.37, rest=0, sat 为 0.25 带闭式。
 * 输出：引擎轨迹 vs 模型轨迹逐拍对照 + t=fin 比值。
 */
const BASE = process.env.BASE || "http://127.0.0.1:4052";
const TICKS = Number(process.env.TICKS || 12);
const OID = process.env.OID || "obj_line_LINE-WS-zigong-winding";
const SV = process.env.SV || "blockedPressure";
const MAG_A = Number(process.env.MAG_A ?? 3), MAG_B = Number(process.env.MAG_B ?? 20);
const MODEL = process.env.MODEL !== "0"; // 1 = 跑闭式模型对照
const LAMBDA = Number(process.env.LAMBDA ?? 0.37);
const DU = "demo:admin:admin|planner|catalog_admin";
const api = async (m, p, b) => {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 260)}`); return r.j; };
const r12 = (x) => { const r = Math.round(x * 1e12) / 1e12; return Object.is(r, -0) ? 0 : r; };
const sat = (v) => {
  const max = 100, rest = 0, bandHi = (max - rest) * 0.25, kneeHi = max - bandHi;
  if (v > kneeHi) return max - bandHi / (1 + (v - kneeHi) / bandHi);
  return v;
};

async function arm(mag) {
  const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
  const id = s?.session?.id ?? s?.id;
  const bs = (s?.baseSnapshot ?? s?.session?.baseSnapshot ?? {})[OID]?.[SV];
  if (mag !== null) {
    const r = await api("POST", `/a/v1/sim/sessions/${id}/perturbations`, { kind: "supply_disruption", targetObjectId: OID, targetStateVar: SV, mode: "delta", magnitude: mag, startTick: 0, durationTicks: null, label: `${SV} ${mag}` });
    if (r.s >= 400) throw new Error(`pert: ${r.s} ${(r.t || "").slice(0, 200)}`);
  }
  const traj = [];
  for (let t = 0; t <= TICKS; t++) {
    const w = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
    traj.push((w?.state ?? {})[OID]?.[SV]);
    if (t < TICKS) must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1 }), "tick");
  }
  return { id, bs, traj };
}

const zero = await arm(null), a = await arm(MAG_A), b = await arm(MAG_B);
console.log(`## WO2-EVAL trace · BASE=${BASE} · ${OID}.${SV} · TICKS=${TICKS} · base=${zero.bs} · zero=${zero.id} a=${a.id} b=${b.id}`);

// 模型：x0 = 臂在 t0 的读数（扰动已落地）；每拍如上。base = 零臂静息读数 (= baseSnapshot)。
// C2on：LEVEL 且登记 valueRef ⇒ 加 λ(base−rest)。DEVIATION ⇒ C2 恒等。用 arm 实际 t0 起点 + 由 zero 臂 t0 推断 C2 是否生效。
function model(x0, base, n, c2) {
  let x = x0; const out = [x];
  for (let i = 0; i < n; i++) {
    let nx = r12(0 + (1 - LAMBDA) * (x - 0));
    if (c2) nx = r12(nx + LAMBDA * (base - 0));
    if (nx !== x) { const s = r12(sat(nx)); if (s !== nx) nx = s; }
    x = nx; out.push(x);
  }
  return out;
}
function report(tag, armv, c2) {
  const x0 = armv.traj[0];
  console.log(`\n── ${tag}：t0=${x0}（zero t0=${zero.traj[0]}）`);
  if (!MODEL) return;
  const m = model(x0, zero.traj[0], TICKS, c2);
  let firstDiff = -1;
  for (let t = 0; t <= TICKS; t++) {
    const e = armv.traj[t], mm = m[t];
    const same = e === mm;
    if (!same && firstDiff < 0) firstDiff = t;
    console.log(`   t=${String(t).padStart(2)} 引擎=${String(e).padEnd(22)} 模型=${String(mm).padEnd(22)} ${same ? "==" : "≠"}`);
  }
  console.log(`   模型照合：${firstDiff < 0 ? "★ 全拍逐位相同" : `✖ 首个分歧在 t=${firstDiff}`}`);
}
report(`zero 臂（C2 生效? 由静息冻结/衰减判定）`, zero, false);
report(`+${MAG_A} 臂（模型按 C2 生效跑）`, a, true);
report(`+${MAG_B} 臂（模型按 C2 生效跑）`, b, true);

const dz = r12(a.traj[TICKS] - zero.traj[TICKS]), db = r12(b.traj[TICKS] - zero.traj[TICKS]);
console.log(`\nt=${TICKS}: Δ(+${MAG_A})=${dz} Δ(+${MAG_B})=${db} ⇒ r = ${dz === 0 ? "∞" : (db / dz)}（应 ${MAG_B / MAG_A}）`);
console.log(`独立闭式参照: 3 臂应为 ${MAG_A}×0.63^${TICKS} = ${MAG_A * Math.pow(0.63, TICKS)}；${MAG_B}×0.63^${TICKS} = ${MAG_B * Math.pow(0.63, TICKS)}`);
console.log(`DONE ${new Date().toISOString()}`);
