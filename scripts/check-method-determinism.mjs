#!/usr/bin/env node
/**
 * 门 `method-determinism:check`（METHOD-MC-STOCHASTIC · R6 确定性地板 · 平行 opt-determinism:check）：
 * 守随机模拟族 MC 作用域「只吃 seeded rng（mulberry32）· 无非确定来源 · 样本排序后取分位」。
 * 本体登记见 docs/SYSTEM-ONTOLOGY.md §7（门）/ §J 随机模拟族 / §8（G-12）。
 *
 * 静态断言（保守哨兵·有牙齿）：
 *  1) MC 引擎存在：apps/datacore/src/solvers/method-mc.ts 有 monteCarlo/sampleDist/quantileType7。
 *  2) 无非确定来源：method-mc.ts 全文（去注释）不得出现 Math.random / Date.now / new Date（破坏 R6）。
 *  3) 只吃 rng：sampleDist 各分布族只消费传入的 rng()——不得自造随机源。
 *  4) 样本排序取分位：monteCarlo 内对 samples 调 .sort( 后再取分位（消顺序抖动 → 分位逐字节一致）。
 *  5) 接线处 seeded：capacity.ts 的 MC 调用经 rngFromInput（种子化流），且 P90 生成处不再 `p50 * healthFactor`
 *     伪分位式（根因收口 · 不作假）。
 *  6) 校准同源：service.ts recordCalibrationForecasts 的 predictedP90 不再 `* healthFactor`（伪分位污染 MAPE）。
 *
 * 用法：node scripts/check-method-determinism.mjs
 */
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const abs = (rel) => new URL(rel, root);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel), "utf8") : null);
const stripComments = (s) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const fail = [];

// ── 1) MC 引擎存在 ───────────────────────────────────────────────────────────
const mc = read("apps/datacore/src/solvers/method-mc.ts");
if (mc == null) {
  fail.push("缺 apps/datacore/src/solvers/method-mc.ts");
} else {
  const code = stripComments(mc);
  for (const sym of ["monteCarlo", "sampleDist", "quantileType7"]) {
    if (!new RegExp(`function\\s+${sym}\\b`).test(code)) fail.push(`method-mc.ts 缺 ${sym}（MC 引擎不完整）`);
  }
  // ── 2) 无非确定来源 ────────────────────────────────────────────────────────
  if (/Math\.random\s*\(/.test(code)) fail.push("method-mc.ts 出现 Math.random（破坏 R6 确定性）");
  if (/Date\.now\s*\(/.test(code)) fail.push("method-mc.ts 出现 Date.now（破坏 R6 确定性）");
  if (/new\s+Date\s*\(/.test(code)) fail.push("method-mc.ts 出现 new Date（破坏 R6 确定性）");
  // ── 3) sampleDist 只吃 rng ──────────────────────────────────────────────────
  const sdStart = code.indexOf("function sampleDist");
  const sdEnd = code.indexOf("export interface McUnit");
  const sdSeg = sdStart >= 0 && sdEnd > sdStart ? code.slice(sdStart, sdEnd) : code;
  if (!/rng\s*\(/.test(sdSeg)) fail.push("sampleDist 未见 rng()——分布采样须只消费 seeded rng");
  // ── 4) 样本排序后取分位 ─────────────────────────────────────────────────────
  const mcStart = code.indexOf("function monteCarlo");
  const mcSeg = mcStart >= 0 ? code.slice(mcStart) : "";
  if (!/samples\.sort\s*\(/.test(mcSeg)) fail.push("monteCarlo 未见 samples.sort(——样本未排序取分位，威胁 R6");
  if (!/quantileType7\s*\(/.test(mcSeg)) fail.push("monteCarlo 未用 quantileType7 取分位");
}

// ── 5) capacity.ts 接线处 seeded + 无伪分位式 ───────────────────────────────────
const cap = read("apps/datacore/src/solvers/capacity.ts");
if (cap == null) {
  fail.push("缺 apps/datacore/src/solvers/capacity.ts");
} else {
  const code = stripComments(cap);
  if (!/rngFromInput\s*\(/.test(code)) fail.push("capacity.ts 未经 rngFromInput 派生 MC 种子流（R6）");
  if (!/monteCarlo\s*\(/.test(code)) fail.push("capacity.ts 未调 monteCarlo（P90 未走真分位）");
  // 根因收口：P90 生成处不得再有 `p50 * healthFactor` 伪分位式。
  if (/p50\s*\*\s*healthFactor/.test(code)) fail.push("capacity.ts 仍含 `p50 * healthFactor` 伪分位式（根因未收口·不作假红线）");
  if (/adjusted\s*\*\s*healthFactor/.test(code)) fail.push("capacity.ts what-if 仍含 `adjusted * healthFactor` 伪分位式");
  if (/cumP50ByWeek\[[^\]]*\]\s*(as number\s*)?\)?\s*\*\s*healthFactor/.test(code)) fail.push("capacity.ts 批次仍含 `cumP50ByWeek * healthFactor` 伪分位式");
}

// ── 6) 校准记录同源收口 ───────────────────────────────────────────────────────
const svc = read("apps/datacore/src/solvers/service.ts");
if (svc == null) {
  fail.push("缺 apps/datacore/src/solvers/service.ts");
} else {
  const code = stripComments(svc);
  if (/predictedP90:\s*round\([^)]*\*\s*healthFactor/.test(code)) {
    fail.push("service.ts recordCalibrationForecasts predictedP90 仍 `* healthFactor`（伪分位污染越用越准 MAPE·同款 fake 未收口）");
  }
}

console.log(`· method-determinism：MC seeded rng · 无非确定来源 · 样本排序取分位 · 伪分位式收口(capacity+calibration) · 违规 ${fail.length}`);
if (fail.length) {
  console.error("\n✗ method-determinism:check 未过（R6 确定性 / 不作假伪分位收口）：");
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("✓ method-determinism:check 通过（MC 作用域 seeded rng · 无 Math.random/Date · 样本排序取 type-7 分位 · p50×0.93 伪分位式零命中）。");
