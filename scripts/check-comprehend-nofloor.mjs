#!/usr/bin/env node
/**
 * 门 `comprehend-nofloor:check`（WO-DB-LLM-REQUIRED-NO-FLOOR · KILL-MOCK-RED · 堵 §8 G-COMPREHEND-FLOOR）：
 * 守建域 comprehend **硬依赖 LLM·不静默回落地板造电池味垃圾**——`comprehendPlanBody`（service.ts）三条静默降级路
 * （无 LLM / catch 吞错 / 0 对象 → 落 7 词电池词表 `comprehendScript` 地板）必须全断，改诚实结构化报错。
 *
 * 静态哨兵（源码守卫·green→red：把地板降级改回即红）：
 *  1) comprehendPlanBody 有 `deterministicComprehend` 显式开关分支（离线/CI 地板·且标 comprehendedBy:"FLOOR"）。
 *  2) 无 LLM → 抛 `LLM_PURPOSE_UNBOUND`（不落地板）。
 *  3) 0 对象 → 抛 `COMPREHEND_NOT_UNDERSTOOD`（不落地板冒充理解）。
 *  4) **无静默 catch 吞错回落地板**：comprehendPlanBody 体内不得出现「`catch { }`（空吞）后 return comprehendScript」旧模式；
 *     LLM 真理解产物标 `comprehendedBy:"LLM"`。
 *  5) 契约 `BuildPlan.comprehendedBy`（"LLM"|"FLOOR"·诚实标注）在位；GapCode 含 COMPREHEND_NOT_UNDERSTOOD/LLM_UNAVAILABLE。
 *  6) 暗发 env 闸 `DC_COMPREHEND_DETERMINISTIC` 在 config.ts。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §8 G-COMPREHEND-FLOOR。用法：node scripts/check-comprehend-nofloor.mjs
 */
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const abs = (rel) => new URL(rel, root);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel), "utf8") : null);
const fail = [];

const svc = read("apps/datacore/src/databuilder/service.ts");
if (svc == null) {
  fail.push("缺 apps/datacore/src/databuilder/service.ts");
} else {
  // 抽 comprehendPlanBody 方法体（从签名到下一个 private/public 方法）。
  const m = svc.match(/private async comprehendPlanBody\([\s\S]*?\n {2}private /);
  const body = m ? m[0] : "";
  if (!body) fail.push("未定位 comprehendPlanBody 方法体（签名漂移）");
  else {
    if (!/deterministicComprehend/.test(body)) fail.push("comprehendPlanBody 缺 deterministicComprehend 显式开关（离线/CI 地板路）");
    if (!/comprehendedBy:\s*"FLOOR"/.test(body)) fail.push("确定性地板产物未标 comprehendedBy:FLOOR（诚实标注缺）");
    if (!/LLM_PURPOSE_UNBOUND/.test(body)) fail.push("无 LLM 未抛 LLM_PURPOSE_UNBOUND（仍可能静默落地板）");
    if (!/COMPREHEND_NOT_UNDERSTOOD/.test(body)) fail.push("0 对象未抛 COMPREHEND_NOT_UNDERSTOOD（仍可能落地板冒充理解）");
    if (!/comprehendedBy:\s*"LLM"/.test(body)) fail.push("LLM 真理解产物未标 comprehendedBy:LLM");
    // green→red 核心：旧「静默 catch 吞错 → return comprehendScript 地板」模式复现即红。
    if (/catch\s*(\([^)]*\))?\s*\{\s*\/?\*?[^}]*\*?\/?\s*\}\s*[\s\S]*?return\s+comprehendScript/.test(body)) {
      fail.push("comprehendPlanBody 出现「静默 catch 吞错后 return comprehendScript」旧地板降级模式（KILL-MOCK-RED 回潮）");
    }
    // 无条件兜底 return comprehendScript（不经 deterministicComprehend 门）复现即红。
    const floorReturns = [...body.matchAll(/return\s+(?:\{\s*\.\.\.)?comprehendScript/g)];
    // 允许恰一处（deterministicComprehend 门内）；>1 处或不在开关分支 → 疑似无条件兜底。
    if (floorReturns.length > 1) fail.push(`comprehendPlanBody 有 ${floorReturns.length} 处 return comprehendScript（疑无条件地板兜底·应仅 deterministicComprehend 门内一处）`);
  }
}

// 契约 + config 闸。
const growth = read("packages/contracts/src/growth.ts") ?? "";
for (const code of ["COMPREHEND_NOT_UNDERSTOOD", "LLM_UNAVAILABLE"])
  if (!growth.includes(code)) fail.push(`contracts/growth.ts GapCode 缺 ${code}`);
const dbc = read("packages/contracts/src/databuilder.ts") ?? "";
if (!/comprehendedBy:\s*z\.enum\(\["LLM",\s*"FLOOR"\]\)/.test(dbc)) fail.push("contracts/databuilder.ts BuildPlan 缺 comprehendedBy:enum([LLM,FLOOR])");
const config = read("apps/datacore/src/config.ts") ?? "";
if (!/DC_COMPREHEND_DETERMINISTIC\s*:/.test(config)) fail.push("config.ts 缺 DC_COMPREHEND_DETERMINISTIC 暗发 env 闸");

if (fail.length) {
  console.error("✗ comprehend-nofloor:check 失败：");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("✓ comprehend-nofloor:check 通过（建域硬依赖 LLM·无静默地板降级·FLOOR/LLM 诚实标注·暗发 env 闸）");
