#!/usr/bin/env node
/**
 * R15「CLI 对等」门禁（A15）：每个对外模块能力必须有 CLI 等价命令或 GUI 深链
 * （注册在 OPERATION_CATALOG），否则 = CLI 功能洼地，CI 红。与 debattery:check/chain:check 同款治理范式。
 *
 * 校验：
 *  1) OPERATION_CATALOG 每条都有 cliCommand 或 uiDeepLink（R15 对等的诚实边界）；
 *  2) 每条 cliCommand 在 CLI 调度表（scripts/platform-cli.mjs run{} + do 路由）可达，或显式深链豁免；
 *  3) 棘轮基线 scripts/cli-parity-baseline.json 记"已知缺命令实现"存量，防回潮（缺实现数 ≤ 基线）。
 * 用法：node scripts/check-cli-parity.mjs [--update]
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
  console.error(`⛔ check-cli-parity.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync, writeFileSync, existsSync } from "node:fs";

const BASELINE = "scripts/cli-parity-baseline.json";
const CLI = "scripts/platform-cli.mjs";
const update = process.argv.includes("--update");

// 从契约源解析 OPERATION_CATALOG（避免引 TS：正则抽 op/cliCommand/uiDeepLink 三元）。
const cat = readFileSync("packages/contracts/src/operation-intent.ts", "utf8");
const entries = [...cat.matchAll(/\{\s*op:\s*"([a-z_]+)",[\s\S]*?\}/g)].map((m) => {
  const block = m[0];
  const op = m[1];
  const hasCli = /cliCommand:\s*"([^"]+)"/.exec(block);
  const hasLink = /uiDeepLink:\s*"([^"]+)"/.exec(block);
  return { op, cliCommand: hasCli?.[1], uiDeepLink: hasLink?.[1] };
}).filter((e) => e.op && /label:/.test(cat.slice(cat.indexOf(`op: "${e.op}"`), cat.indexOf(`op: "${e.op}"`) + 400)));

const fail = [];
// 1) 每条必须有 cliCommand 或 uiDeepLink
for (const e of entries) {
  if (!e.cliCommand && !e.uiDeepLink) fail.push(`OPERATION_CATALOG[op=${e.op}] 既无 cliCommand 也无 uiDeepLink（R15 对等违反）`);
}

// 2) cliCommand 在 CLI 调度可达：run{} 映射键 OR do 路由认识的命令 OR 深链豁免
const cli = existsSync(CLI) ? readFileSync(CLI, "utf8") : "";
const runMap = (cli.match(/const run = \{([\s\S]*?)\};/)?.[1] ?? "");
const cliCmds = new Set([...runMap.matchAll(/([a-zA-Z]+):/g)].map((m) => m[1]));
const doRouted = /cmdDo|operations\/classify/.test(cli); // do 万能路由存在则 cliCommand 经分类可达

const missingImpl = [];
for (const e of entries) {
  if (!e.cliCommand) continue; // 纯深链项不要求 run{} 实现
  const reachable = cliCmds.has(e.cliCommand) || doRouted;
  if (!reachable) missingImpl.push(e.cliCommand);
}

// 3) 棘轮基线
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { missingImpl: [] };
if (update) {
  writeFileSync(BASELINE, JSON.stringify({ missingImpl: missingImpl.sort() }, null, 2) + "\n");
  console.log(`· cli-parity 基线已更新：${missingImpl.length} 项缺实现`);
}
const baseSet = new Set(base.missingImpl ?? []);
const regressions = missingImpl.filter((c) => !baseSet.has(c));
for (const c of regressions) fail.push(`CLI 命令 ${c} 在 OPERATION_CATALOG 注册但 CLI 不可达（新增对外能力须同 PR 接 CLI；或登记深链）`);

console.log(`· OPERATION_CATALOG：${entries.length} 条（cliCommand ${entries.filter((e) => e.cliCommand).length} · 深链 ${entries.filter((e) => e.uiDeepLink).length}）`);
console.log(`· CLI 调度命令：${cliCmds.size}（do 万能路由：${doRouted ? "在" : "无"}）`);
console.log(`· 缺实现（基线 ${baseSet.size} · 当前 ${missingImpl.length} · 回潮 ${regressions.length}）`);

if (fail.length) {
  console.error("\n✗ R15 CLI 对等门禁未过：");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("\n✓ R15 CLI 对等：OPERATION_CATALOG 每条均有 CLI 命令或深链；无回潮。");
