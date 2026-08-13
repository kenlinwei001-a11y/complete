#!/usr/bin/env node
/**
 * 门 `dril-registry:check`（WO-DRIL-P1 · Resource Registry 地基 · KILL-MOCK-RED · R6 · R13 · R3）：
 * 启动一个内存态 AgentCore（mock DataCore + seeded 本地 repo），发一次 `GET /b/v1/resources`，断言
 *  ① 跨 ≥7 类返回（solver/slice/rule/workflow/intent/skill/agent）；
 *  ② 新 4 kind（rule/workflow/skill/agent）各有资源；
 *  ③ 无空描述资源（每条投影 description 非空且为合法 IntelligenceResource）。
 *
 * 校验经已 build 的 dist（构建期检查，非源码跨 app import）：先 pnpm --filter agentcore build（+ contracts）。
 * 用法：node scripts/check-dril-registry.mjs
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
  console.error(`⛔ check-dril-registry.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { assertDistFresh } from "./dist-freshness.mjs";

const root = new URL("../", import.meta.url);
const abs = (rel) => new URL(rel, root);

const need = [
  ["contracts", "packages/contracts/dist/index.js"],
  ["agentcore/server", "apps/agentcore/dist/server.js"],
  ["agentcore/deps", "apps/agentcore/dist/deps.js"],
  ["agentcore/memory", "apps/agentcore/dist/persistence/memory.js"],
  ["agentcore/mocks", "apps/agentcore/dist/mocks/clients.js"],
  ["agentcore/seed", "apps/agentcore/dist/mocks/seed.js"],
  ["agentcore/config", "apps/agentcore/dist/config.js"],
];
// ⛔ 守卫必须在 import dist **之前**（欠账 #161）：本门 boot 整个 AgentCore 的 dist 跑注册/校验，
//    dist 落后 ⇒ 跑的是旧服务，却把结论当成"源码今天的注册状况"报出来。
assertDistFresh(need.map(([, rel]) => rel), { gate: "dril-registry:check" });

const { findInvalidResources } = await import(abs("packages/contracts/dist/index.js").href);
const { buildServer } = await import(abs("apps/agentcore/dist/server.js").href);
const { wireDeps } = await import(abs("apps/agentcore/dist/deps.js").href);
const { createMemoryRepos } = await import(abs("apps/agentcore/dist/persistence/memory.js").href);
const { createMockDataCore } = await import(abs("apps/agentcore/dist/mocks/clients.js").href);
const { loadConfig } = await import(abs("apps/agentcore/dist/config.js").href);
const seed = await import(abs("apps/agentcore/dist/mocks/seed.js").href);
const { ScriptedLlmClient } = await import(abs("apps/agentcore/dist/llm/mock.js").href);
const { MockMcpClient } = await import(abs("apps/agentcore/dist/mcp/mock.js").href);

const TENANT = seed.SEED_TENANT;
const config = loadConfig({ PORT: "0", LOG_LEVEL: "silent" });
const repos = createMemoryRepos();
await repos.packages.insert(seed.seedScenarioPackage());
const { intents, plans } = seed.seedIntentsAndPlans();
for (const p of plans) await repos.plans.insert(p);
for (const i of intents) await repos.intents.insert(i);
const { agents, workflows, skills } = seed.seedRegistry();
for (const w of workflows) await repos.workflows.insert(w);
for (const s of skills) await repos.skills.insert(s);
for (const a of agents) await repos.agents.insert(a);
for (const m of seed.seedMcpConfigs()) await repos.mcpConfigs.insert(m);

const deps = wireDeps({ config, repos, llm: new ScriptedLlmClient(), dataCore: createMockDataCore(), mcp: new MockMcpClient() });
const app = await buildServer(deps);
await app.ready();

const res = await app.inject({
  method: "GET",
  url: "/b/v1/resources",
  headers: { "x-debug-user": encodeURIComponent(`${TENANT}:cli:catalog_admin`), "content-type": "application/json" },
});
await app.close();

const fail = [];
if (res.statusCode !== 200) fail.push(`GET /b/v1/resources → ${res.statusCode}`);
const items = (res.json()?.items ?? []);
const kinds = new Set(items.map((r) => r.kind));
for (const k of ["solver", "slice", "rule", "workflow", "intent", "skill", "agent"]) {
  if (!kinds.has(k)) fail.push(`缺 kind: ${k}`);
}
const empty = items.filter((r) => !r.description || String(r.description).trim().length === 0);
for (const r of empty) fail.push(`空描述资源: ${r.kind}/${r.key}`);
const invalid = findInvalidResources(items);
for (const v of invalid) fail.push(`非法投影: ${v.kind}/${v.key} — ${v.reason}`);

const counts = {};
for (const r of items) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
console.log(`· 资源总数 ${items.length}·${kinds.size} 类：${JSON.stringify(counts)}`);

if (fail.length) {
  console.error("\n✗ dril-registry:check 失败：");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log(`\n✓ dril-registry:check：跨 ${kinds.size} 类发现全量资源·新 4 kind 齐备·无空描述资源。`);
