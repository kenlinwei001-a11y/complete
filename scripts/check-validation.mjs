#!/usr/bin/env node
/**
 * 闭环验证引擎 VLE · CI 门（PRD-addendum-validation-loop §4-CI契约 + §7 VL1/VL7；本体 R11/R4/R6）。
 *
 * 守两件事（V10 + V9）：
 *  1) **V10 · SMOKE 红阻断合并**：内存态起 datacore 服务，真跑一次 `vle.run(SMOKE)`，要求
 *     report.pass===true 且 engineeringVerificationScore ≥ BASELINE（增量0 实测基线，不得倒退）。
 *     ⑤段含**参照实现双算**断言（V5）：被测 capacity_forecast P50/P90 == 独立预言机算值，
 *     被测算错系数（curveMult 等）→ SMOKE 红 → 本门红 → 合并阻断。
 *  2) **V9 · 静态独立性**：VLE 主体(`vle.ts`)与参照预言机(`vle-oracle.ts`)**不得 import 任何被测**
 *     求解器/规则引擎（`solvers/service`、`solvers/capacity`、`ruledsl`）——用被测算被测=双算形同虚设。
 *     静态扫源码，命中即红。
 *
 * 机制：纯校验 + 真跑，无棘轮基线常数以外的状态。任一红 → 退出码 1。
 * 用法：node scripts/check-validation.mjs
 * 注：本门**尚未并入** `pnpm gates`（主线集中 wire，见交付报告《要主线 wire 的》）。
 */
import { readFileSync, existsSync } from "node:fs";
import { assertDistFresh } from "./dist-freshness.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DC = join(ROOT, "apps/datacore");
const VLE_SRC = join(DC, "src/vle.ts");
const ORACLE_SRC = join(DC, "src/vle-oracle.ts");
const DIST_DIR = join(DC, "dist");

/** 增量0 实测基线（七段全绿 + ⑤双算 → 1.0）。score 低于此即工程验证度倒退，阻断。 */
const BASELINE_SCORE = 1.0;

const fail = [];
const ok = (m) => console.log(`  ok  ${m}`);

// ── 1) V9 静态独立性：vle.ts / vle-oracle.ts 不得 import 被测求解器/规则引擎 ──
// 去注释，避免门禁误命中文档里写的「不 import solvers/service」之类反模式词。
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
// 禁止的被测模块 import 路径（参照不可用被测算被测）。
const FORBIDDEN = [
  /from\s+["'][^"']*solvers\/service[^"']*["']/,
  /from\s+["'][^"']*solvers\/capacity[^"']*["']/,
  /from\s+["'][^"']*\/ruledsl[^"']*["']/,
  /import\s*\(\s*["'][^"']*solvers\/service[^"']*["']\s*\)/, // 动态 import 也禁
];
for (const [label, file] of [["vle.ts", VLE_SRC], ["vle-oracle.ts", ORACLE_SRC]]) {
  if (!existsSync(file)) {
    fail.push(`缺 ${label}（${file}）—— VLE 主体/参照预言机未落`);
    continue;
  }
  const src = stripComments(readFileSync(file, "utf8"));
  let clean = true;
  for (const re of FORBIDDEN) {
    if (re.test(src)) {
      fail.push(`V9 静态独立性违反：${label} import 被测模块（命中 ${re}）—— 双算形同虚设`);
      clean = false;
    }
  }
  if (clean) ok(`V9 独立性：${label} 不 import 被测 solvers/service·solvers/capacity·ruledsl`);
}
// vle-oracle.ts 必须真实现参照（含 referenceCapacityForecast 导出）。
if (existsSync(ORACLE_SRC)) {
  const o = readFileSync(ORACLE_SRC, "utf8");
  if (!/export\s+(async\s+)?function\s+referenceCapacityForecast/.test(o))
    fail.push(`参照预言机缺 referenceCapacityForecast 导出（vle-oracle.ts 未实现 ⑤双算参照）`);
  else ok("参照预言机：vle-oracle.ts 导出 referenceCapacityForecast（第二套独立 P50/P90）");
}

// ── 2) V10 真跑 SMOKE：pass===true 且 score≥BASELINE ──
async function runSmoke() {
  // ⛔ 守卫必须在 import dist **之前**（欠账 #161）：本门上半段读**源码**（vle-oracle.ts 等）下断言，
  //    下半段 boot dist 真跑 SMOKE —— 两半必须是同一个世界，dist 落后就会一边说缺一边说有。
  assertDistFresh(["apps/datacore/dist/app.js"], { gate: "validation:check" });
  const { createMemoryRepos } = await import(join(DIST_DIR, "repo/memory.js"));
  const { buildApp } = await import(join(DIST_DIR, "app.js"));
  const { loadConfig } = await import(join(DIST_DIR, "config.js"));
  const { LocalFsBlobStore } = await import(join(DIST_DIR, "blob.js"));
  const { ScriptedLlmClient } = await import(join(DIST_DIR, "llm.js"));
  const { seedDemo } = await import(join(DIST_DIR, "seed.js"));
  const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", BLOB_DIR: "/tmp/vle-gate-blobs", JWT_SECRET: "gate" });
  const repos = createMemoryRepos();
  const built = await buildApp({ config, repos, blob: new LocalFsBlobStore("/tmp/vle-gate-blobs"), llm: new ScriptedLlmClient() });
  const ctx = await seedDemo(repos);
  const run = await built.services.vle.run(ctx, "SMOKE", 42);
  const rep = run.report;
  const score = rep.engineeringVerificationScore;
  if (!rep.pass) {
    const reds = rep.assertions.filter((a) => !a.pass).map((a) => `${a.segment}·${a.point}${a.diff ? `（${a.diff}）` : ""}`);
    fail.push(`V10 SMOKE 红：report.pass=false —— 红断言：\n      - ${reds.join("\n      - ")}`);
    return;
  }
  if (score < BASELINE_SCORE - 1e-9) {
    fail.push(`V10 工程验证度倒退：score=${score} < 基线 ${BASELINE_SCORE}`);
    return;
  }
  // ⑤段必须真有「参照实现双算」断言（防止双算被悄悄摘掉退回桩）。
  const refAssert = rep.assertions.find((a) => a.segment === "⑤求解器执行" && a.oracle === "reference");
  if (!refAssert) {
    fail.push(`V5 缺失：⑤求解器执行段无 reference 预言机断言（参照双算被摘 → 退回桩）`);
    return;
  }
  ok(`V10 SMOKE 真跑：pass=true · score=${score} (≥基线 ${BASELINE_SCORE}) · ${rep.assertions.length} 断言 · ⑤含参照双算 [${refAssert.pass ? "PASS" : "FAIL"}]`);
}

await runSmoke();

if (fail.length) {
  console.error("\n✗ validation:check 红：");
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n✓ validation:check 绿（V10 SMOKE pass + score≥基线 · V9 VLE/参照零被测 import · ⑤参照双算在位）");
process.exit(0);
