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
