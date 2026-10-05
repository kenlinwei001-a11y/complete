#!/usr/bin/env node
/**
 * WO-AB-SATPROJ-closure.mjs · 把探针回执里的三样数（读数 / raw→value / λ / amount）**独立复算一遍**
 *
 * 模型（源码：propagation.ts 核衰减 + spec-base-synthesis.ts:98 + world-projection.ts:85）：
 *   raw(t)   = (1 − λ)·value(t−1) + λ·base + amount(t)
 *   value(t) = saturateToDomain(raw(t), 0, 100, 0)
 * 其中 λ = 回执 decayApplied.costPressure，base = 该会话 tick0 读数（= 派生规格 order_cost_pressure 值）。
 *
 * 只读：读 docs/evidence/WO-AB-SATPROJ-*.txt 里探针自己记下的 JSONL，不连服务。
 * 跑法：node WO-AB-SATPROJ-closure.mjs WO-AB-SATPROJ-m3.txt WO-AB-SATPROJ-ratio1.txt WO-AB-SATPROJ-ratio20.txt
 */
import { readFileSync } from "node:fs";

const f = (raw, min = 0, max = 100, rest = 0) => {
  const bandHi = (max - rest) * 0.25;
  if (bandHi > 0) {
    const kneeHi = max - bandHi;
    if (raw > kneeHi) return max - bandHi / (1 + (raw - kneeHi) / bandHi);
  }
  const bandLo = (rest - min) * 0.25;
  if (bandLo > 0) {
    const kneeLo = min + bandLo;
    if (raw < kneeLo) return min + bandLo / (1 + (kneeLo - raw) / bandLo);
  }
  return raw;
};

export function closureOf(text) {
  const m = text.match(/^JSONL=(.*)$/m);
  if (!m) return null;
  const rows = JSON.parse(m[1]);
  const base = rows.length > 0 ? null : null;
  return { rows };
}

let worst = 0;
for (const path of process.argv.slice(2)) {
  const text = readFileSync(path, "utf8");
  const m = text.match(/^JSONL=(.*)$/m);
  if (!m) { console.log(`${path}: 无 JSONL`); continue; }
  const rows = JSON.parse(m[1]);
  const lam = rows[0]?.lam;
  const base = Number((text.match(/t0 读数 = ([\d.]+)/) ?? [])[1]);
  console.log(`\n### ${path}  λ=${lam}  base(tick0 读数)=${base}`);
  console.log("t | 回执raw | 模型raw (1-λ)·x+λ·base+amt | 差 | 回执value | 模型 f(raw) | 差 | amount");
  let prev = base, mx = 0;
  for (const r of rows) {
    const amt = r.amts.length > 0 ? r.amts[0] : 0;
    if (r.sat.length === 0) {
      console.log(`${r.t} | （投影跳过：write===上一拍读数 ⇒ 不投影）| 读数 ${r.value}`);
      prev = r.value;
      continue;
    }
    const rawr = r.sat[0].raw, valr = r.sat[0].value;
    const rawm = (1 - lam) * prev + lam * base + amt;
    const valm = f(rawm);
    mx = Math.max(mx, Math.abs(rawm - rawr), Math.abs(valm - valr));
    console.log(`${r.t} | ${rawr.toFixed(12)} | ${rawm.toFixed(12)} | ${(rawm - rawr).toExponential(1)} | ${valr.toFixed(12)} | ${valm.toFixed(12)} | ${(valm - valr).toExponential(1)} | ${amt}`);
    prev = r.value;
  }
  worst = Math.max(worst, mx);
  console.log(`本臂最大偏差 = ${mx.toExponential(2)}  （round12 精度 ~5e-13）`);
}
console.log(`\n全臂最大偏差 = ${worst.toExponential(2)}`);
console.log(`DONE ${new Date().toISOString()}`);
