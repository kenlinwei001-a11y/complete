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
/* ── 退出码纪律 · 顶层兜底（WO-GATE-RC2-DISCIPLINE）─────────────────────────────
 * 本仓门的退出码是**三分**约定（docs/SOP-reviewer-claim-discipline.md §3）：
 *   0 = 干净 · 1 = **真有问题**（先修代码）· 2 = **工具自己坏了**（只许说「我没查出来」）。
 * 而 node 对**未捕获异常一律退 1** —— 恰好撞上「真有问题」这个码。于是「门根本没跑起来」
 * （缺依赖 / 只读 FS / 权限 / OOM / node 版本差异 / dist 没构建）会被 gate.sh 和人一起
 * 读成「你的代码有问题」，方向**正好相反**。2026-08-11 一天之内两道门各撞一次，故建此机制。
 * 形态（铁律 0.6 句式）：「我用『进程非 0 退出』当作『代码有问题』的证据，而前者并不度量后者。」
 *
 * 这段只**加**默认失败方向，**不动**任何既有 exit(0)/exit(1)：兜底若把真违规也吞成 2，
 * 那是拿一个更糟的假绿换掉一个假红。RC=1 仍然只由主判据明确判负产生。
 * 守门的门：scripts/check-gate-exit-discipline.mjs（新加的门不带兜底会被它当场判红）。 */
process.on("uncaughtException", (e) => gateToolBroken(e));
process.on("unhandledRejection", (e) => gateToolBroken(e));
function gateToolBroken(e) {
  console.error(`⛔ check-propagation.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const CORE = "apps/datacore/src/sim/propagation.ts";
const SIM_DIR = "apps/datacore/src/sim";
const TEST = "apps/datacore/test/sim-propagation.test.ts";
/* 扫描面自证的独立口径分母（2026-08-19 · WO-GATE-SCAN-SURFACE-CENSUS）：
 * SIM_DIR 递归 .ts 总量下界 —— 当日现算 5，取 3（~60%）。
 * scanDir 对不存在的目录**静默 return**（见下），SIM_DIR 一改名 R14 扫描就真空变绿；
 * 塌到下界以下 ⇒ 报「工具坏了」RC=2，不许读作「零业务常数合规」。 */
const MIN_SIM_TS_FILES = 3;
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
let simTsScanned = 0;
const scanDir = (dir) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { scanDir(p); continue; }
    if (!/\.ts$/.test(p)) continue;
    simTsScanned++;
    const txt = readFileSync(p, "utf8");
    for (const tok of INDUSTRY_TOKENS) {
      if (txt.includes(tok)) fail.push(`R14 零业务常数违反：${p} 出现行业实体名 "${tok}"`);
    }
  }
};
scanDir(SIM_DIR);
console.log(`  · R14 扫描面：${SIM_DIR} ${simTsScanned} 个 .ts（下界 ${MIN_SIM_TS_FILES}，已过 ⇒ 射程没塌）`);
if (simTsScanned < MIN_SIM_TS_FILES) {
  console.error(`⛔ 门自己瞎了：R14 扫描面 ${SIM_DIR} 只扫到 ${simTsScanned} 个 .ts（下界 ${MIN_SIM_TS_FILES}）—— 目录改名/枚举断了，不是「行业实体名清零」。`);
  console.error("   本次结论作废：**不许**读作「R14 零业务常数合规」。");
  process.exit(2);
}
if (!fail.some((f) => f.includes("R14"))) ok(`R14 零业务常数：${SIM_DIR} ${simTsScanned} 个 .ts（扫描面下界 ${MIN_SIM_TS_FILES}，已过）无行业实体名`);

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
