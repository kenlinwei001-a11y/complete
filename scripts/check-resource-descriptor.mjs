#!/usr/bin/env node
/**
 * 门 `resource-descriptor:check`（WO-RESOURCE-DESCRIPTOR · 统一资源描述契约 + 发现门 · KILL-MOCK-RED · R6 · R13 · R14）：
 * 把「没有给 LLM 看的描述就不允许发布」的发布纪律（先前只在 catalog.test 守求解器一池，约 line 54）
 * **推广到全五池**——求解器目录 / 本体切片 / 工作流·操作意图 / 字段目录 / MCP 工具。任一可发现资源
 * 投影成 ResourceDescriptor 后 description 为空 → 门红（发布纪律有牙）。
 *
 * 校验经已 build 的 dist（跨包读 dist 是构建期检查，非源码跨 app import，不违反 contracts-only-shared）：
 *  ① contracts dist → OPERATION_CATALOG（工作流/操作意图池）+ findUndescribed / ResourceDescriptorSchema（校验器）；
 *  ② datacore dist  → datacoreResourceDescriptors()（求解器全集 + 内置切片池）；
 *  ③ agentcore dist → BUILTIN_TOOLS + FINAL_ANSWER_TOOL + LOAD_SKILL_TOOL（MCP 工具池）。
 *
 * green→red 有牙：任一池新增/回潮一个无 description 资源 → 本门退 1。确定性（R6）：同 dist 同结果。
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7 门 resource-descriptor:check + §2 ResourceDescriptor 契约。
 * 用法：node scripts/check-resource-descriptor.mjs（先 pnpm -r build 或至少 build contracts/datacore/agentcore）。
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
  console.error(`⛔ check-resource-descriptor.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const abs = (rel) => new URL(rel, root);
const fail = [];
const poolCounts = {};

const distContracts = abs("packages/contracts/dist/index.js");
const distDatacore = abs("apps/datacore/dist/catalog.js");
const distAgentcore = abs("apps/agentcore/dist/tools/registry.js");

for (const [label, u] of [["contracts", distContracts], ["datacore", distDatacore], ["agentcore", distAgentcore]]) {
  if (!existsSync(u)) fail.push(`${label} dist 未构建（${u.pathname}）——先 pnpm -r build 再跑本门`);
}
if (fail.length) {
  console.error("✗ resource-descriptor:check 失败：");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}

const contracts = await import(distContracts.href);
const datacore = await import(distDatacore.href);
const agentcore = await import(distAgentcore.href);

const { findUndescribed, OPERATION_CATALOG } = contracts;
if (typeof findUndescribed !== "function") { console.error("✗ contracts 未导出 findUndescribed（契约缺失）"); process.exit(1); }

/** 收集全五池 → 统一 ResourceDescriptor 投影（确定性）。 */
const candidates = [];

// 池①②：求解器全集 + 内置切片（datacore 半）。
const dc = datacore.datacoreResourceDescriptors?.() ?? [];
poolCounts.solver = dc.filter((d) => d.kind === "solver").length;
poolCounts.slice = dc.filter((d) => d.kind === "slice").length;
candidates.push(...dc);

// 池③：工作流 · 操作意图（op==="workflow" → workflow，其余 → intent）。
let workflow = 0, intent = 0;
for (const e of OPERATION_CATALOG ?? []) {
  const kind = e.op === "workflow" ? "workflow" : "intent";
  if (kind === "workflow") workflow++; else intent++;
  candidates.push({
    kind,
    key: e.op,
    label: e.label,
    description: e.description,
    ...(e.keywords ? { tags: e.keywords } : {}),
  });
}
poolCounts.workflow = workflow;
poolCounts.intent = intent;

// 池④：MCP 工具（内置工具 + 终止/加载技能工具）。description 源自 descriptionForLLM。
const mcpTools = [
  ...(agentcore.BUILTIN_TOOLS ?? []),
  ...(agentcore.FINAL_ANSWER_TOOL ? [agentcore.FINAL_ANSWER_TOOL] : []),
  ...(agentcore.LOAD_SKILL_TOOL ? [agentcore.LOAD_SKILL_TOOL] : []),
];
for (const t of mcpTools) {
  candidates.push({ kind: "mcp_tool", key: t.name, label: t.name, description: t.descriptionForLLM });
}
poolCounts.mcp_tool = mcpTools.length;

// 池⑤：字段目录（field）为**租户运行态**池——字段描述随已发布对象类型（DF.5 语义描述），非平台静态注册表，
// 由 discover/searchCatalog 运行态守（无描述字段不出现在可发现结果）；ResourceDescriptor kind=field 供其发布态校验。
// 故本静态门覆盖四个平台静态注册池；field 池的空描述过滤在 catalog.discover / entity-catalog.searchCatalog 运行态生效。

if (candidates.length === 0) { console.error("✗ 未收集到任何可发现资源（dist 空？）"); process.exit(1); }

const violations = findUndescribed(candidates);
if (violations.length) {
  console.error(`✗ resource-descriptor:check 失败：${violations.length} 个可发现资源缺/空 description（无描述不允许发布·全池纪律）：`);
  for (const v of violations.slice(0, 30)) console.error(`  - [${v.kind ?? "?"}] ${v.key ?? "(无 key)"} #${v.index}: ${v.reason}`);
  process.exit(1);
}

const summary = Object.entries(poolCounts).map(([k, n]) => `${k}:${n}`).join(" · ");
console.log(`✓ resource-descriptor:check 通过（全池 ${candidates.length} 资源均带非空 description · ${summary} · field 运行态守）`);
