#!/usr/bin/env node
/**
 * C 的独立复算（只读离线）—— 不引用 A/B 的脚本。
 * 输入：SATPROJ 探针 txt（含 JSONL）。
 * 复算两条：
 *   ① 写回前 raw 是否 = round12(round12(rest + (1-λ)(x_{t-1}-rest)) + λ(base - rest) + amount_t)
 *      —— rest=0、λ=0.37、base 取 txt 的 t0 读数（观测）。
 *   ② 落盘值是否 = round12(saturateToDomain(raw, 0, 100, 0))（源码公式 propagation.ts:466）。
 * 逐 tick 打印偏差。
 */
import { readFileSync } from "node:fs";
const round12 = (n) => { const r = Math.round(n * 1e12) / 1e12; return Object.is(r, -0) ? 0 : r; };
const sat = (raw, min, max, rest) => {
  if (!(max > min)) return raw;
  const bandHi = (max - rest) * 0.25;
  if (bandHi > 0) { const knee = max - bandHi; if (raw > knee) return max - bandHi / (1 + (raw - knee) / bandHi); }
  else if (raw > max) return max;
  const bandLo = (rest - min) * 0.25;
  if (bandLo > 0) { const knee = min + bandLo; if (raw < knee) return min + bandLo / (1 + (knee - raw) / bandLo); }
  else if (raw < min) return min;
  return raw;
};

const file = process.argv[2];
const txt = readFileSync(file, "utf8");
const m0 = txt.match(/t0 读数 = ([0-9.]+)/);
const base = Number(m0[1]);
const jline = txt.split("\n").find((l) => l.startsWith("JSONL="));
const rows = JSON.parse(jline.slice("JSONL=".length));
const LAM = 0.37, REST = 0;
let prev = base;
let maxRawDev = 0, maxValDev = 0;
const detail = [];
for (const r of rows) {
  const amt = (r.amts ?? []).reduce((a, b) => a + b, 0);
  const kernel = round12(REST + (1 - LAM) * (prev - REST));
  const rawPred = round12(kernel + LAM * (base - REST) + amt);
  const valPred = round12(sat(rawPred, 0, 100, REST));
  const rawDev = r.sat.length ? Math.abs(rawPred - r.sat[0].raw) : null;
  const valDev = Math.abs(valPred - r.value);
  if (rawDev !== null) maxRawDev = Math.max(maxRawDev, rawDev);
  maxValDev = Math.max(maxValDev, valDev);
  detail.push(`t=${r.t} x_prev=${prev} amt=${amt} rawPred=${rawPred} rawRec=${r.sat.length ? r.sat[0].raw : "[]"} valPred=${valPred} valRec=${r.value} rawDev=${rawDev} valDev=${valDev}`);
  prev = r.value;
}
console.log(`file=${file}`);
console.log(`base=${base} λ=0.37 rest=0`);
console.log(detail.join("\n"));
console.log(`MAX raw dev = ${maxRawDev}`);
console.log(`MAX value dev = ${maxValDev}`);
// 纯不动点（c=0）：x = f(0.63x + 0.37*base)
let x = base;
for (let i = 0; i < 5000; i++) { const raw = round12(0.63 * x + 0.37 * base); x = round12(sat(raw, 0, 100, 0)); }
console.log(`c=0 不动点 x* = ${x}  (偏离 base = ${round12(x - base)})`);
console.log(`实测 t12 = ${rows[rows.length - 1].value} (偏离 base = ${round12(rows[rows.length - 1].value - base)})`);
console.log(`SKIP（复算）`);
