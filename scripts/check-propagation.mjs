#!/usr/bin/env node
/**
 * 传导核门禁（增量 3 · SPEC-sandbox-propagation-and-session §1 · 不变量 R6/R14 + Temporal Trust）。
 *
 * 守传导核 `apps/datacore/src/sim/propagation.ts` 的四条硬性质（静态 + test-backed）：
 *  1) 系数×延迟正确 + 改系数即改果：跑传导单测 sim-propagation.test.ts（vitest）全绿即背书
 *     （单测断言 amount=coef×source、改 coefficient 输出变、delay=2 第 t+2 到达、改 param 即改果）。
 *  2) Temporal Trust：propagation.ts 不得读"未来 tick"——静态扫已知未来窥视反模式
 *     （state[tick+1]/future/next[...]作为读源喂回本 tick 计算）。源态只读入参 state。
 *  3) 确定性 R6：propagation.ts 不得出现 Math.random / Date.now / new Date()（时钟/随机）。
 *  4) R14 零业务常数：sim/ 目录不得出现行业实体名（委托既有 debattery 词表的子集自查）。
 *
 * 机制：纯校验，无棘轮基线（新文件、零存量）。任一红 → 退出码 1。
 * 用法：node scripts/check-propagation.mjs
 * 注：本门**尚未并入** `pnpm gates`（主线集中 wire，见交付报告《要主线 wire 的》）。
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const CORE = "apps/datacore/src/sim/propagation.ts";
const SIM_DIR = "apps/datacore/src/sim";
const TEST = "apps/datacore/test/sim-propagation.test.ts";
const fail = [];
const ok = (m) => console.log(`  ok  ${m}`);

// ── 前置：文件存在 ──
if (!existsSync(CORE)) fail.push(`缺传导核 ${CORE}（增量 3 未落）`);
if (!existsSync(TEST)) fail.push(`缺传导单测 ${TEST}`);

// 去注释（块 /* */ 与行 //），避免门禁误命中文档里的反模式词（如注释写"不调 Date.now"）。
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

if (existsSync(CORE)) {
  const raw = readFileSync(CORE, "utf8");
  const src = stripComments(raw);

  // 2) Temporal Trust：禁读未来 tick。已知反模式：
  //    - state[tick+1] / state[tick + 1]（读未来快照）
  //    - 把 next 当读源喂回贡献计算（next 只能写、不能作为 source 读）。
  const futureRead = [
    /state\s*\[\s*tick\s*\+/, // state[tick+...] 读未来
    /\bfutureState\b/,
    /readAhead|peekFuture|lookahead/i,
  ];
  for (const re of futureRead) {
    if (re.test(src)) fail.push(`Temporal Trust 违反：propagation.ts 命中未来窥视反模式 ${re}`);
  }
  // 源态读取必须来自入参 state（不得 `sourceVal = next[...]`）。
  if (/sourceVal\s*=\s*next\s*\[/.test(src)) fail.push(`Temporal Trust 违反：源态从 next（本 tick 写出）读取，应只读入参 state`);
  if (!/state\s*\[\s*sourceId\s*\]/.test(src)) fail.push(`未见从入参 state 读源态（state[sourceId]）——核可能未按 Temporal Trust 实现`);
  if (fail.length === 0 || !fail.some((f) => f.includes("Temporal Trust"))) ok("Temporal Trust：源态只读入参 state、无未来窥视反模式");

  // 3) 确定性 R6：禁时钟/随机。
  const nondet = [/Math\.random/, /Date\.now/, /new Date\(/];
  let detClean = true;
  for (const re of nondet) {
    if (re.test(src)) { fail.push(`确定性 R6 违反：propagation.ts 命中 ${re}（时钟/随机破坏可复现）`); detClean = false; }
  }
  if (detClean) ok("确定性 R6：无 Math.random / Date.now / new Date()");

  // 校验：核确实做了 coefficient × source × (delay→pending)（结构性自检，防空实现冒充）。
  if (!/coefficient|effectiveCoefficient/.test(src)) fail.push("核未引用 coefficient（系数缺位）");
  if (!/arriveTick\s*[:=]/.test(src) || !/delayTicks/.test(src)) fail.push("核未实现延迟（arriveTick/delayTicks 缺位）");
  if (!/coefficientRef/.test(src)) fail.push("核未实现系数引用 coefficientRef（G-10 P1「改规则即改推演」）");
}

// 4) R14 零业务常数（sim/ 目录子集自查；与 debattery 同范式，避免行业锁死）。
const INDUSTRY_TOKENS = [
  "常州", "合肥", "西安", "宜宾", "溧阳", "化成", "涂布", "卷绕", "分切", "老化",
  "4680", "刀片", "Supplier", "Factory", "锂电", "电芯", "电池",
];
const scanDir = (dir) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { scanDir(p); continue; }
    if (!/\.ts$/.test(p)) continue;
    const txt = readFileSync(p, "utf8");
    for (const tok of INDUSTRY_TOKENS) {
      if (txt.includes(tok)) fail.push(`R14 零业务常数违反：${p} 出现行业实体名 "${tok}"`);
    }
  }
};
scanDir(SIM_DIR);
if (!fail.some((f) => f.includes("R14"))) ok(`R14 零业务常数：${SIM_DIR} 无行业实体名`);

// 1) test-backed：跑传导单测（系数×延迟正确 + 改系数即改果 + delay 到达 + 改 param 即改果）。
if (existsSync(TEST)) {
  try {
    execSync("pnpm --filter datacore exec vitest run sim-propagation", { stdio: "pipe", encoding: "utf8" });
    ok("test-backed：sim-propagation.test.ts 全绿（系数×延迟正确 + 改系数即改果 + delay 到达 + 改 param 即改果）");
  } catch (err) {
    const out = (err.stdout || "") + (err.stderr || "");
    fail.push(`传导单测未绿（系数/延迟/确定性背书失败）：\n${out.split("\n").slice(-20).join("\n")}`);
  }
}

if (fail.length) {
  console.error("\npropagation:check FAIL");
  for (const f of fail) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("\npropagation:check PASS");
