#!/usr/bin/env node
/**
 * 门 `dril-quality:check`（WO-DRIL-P3 · Graph Traversal + Quality Score · SEAM 头号判据 · R6）：
 *  ① Quality EWMA 确定性（contracts ewmaUpdate 手算 byte-exact·α=0.1）；
 *  ② 低质量资源检索排名**下降** vs 高质量同侪（history 0.10 真移动）+ 翻转反证（mutation）；
 *  ③ graphDistance：离焦点更近（planSlice BFS 跳数更少）ontology 子分更高·排名更前 + mutation；
 *  ④ 端点冒烟：boot 内存态 AgentCore → POST 质量探针 → 再检索见 history 上移；GET relations 1-hop 出边。
 *
 * 校验经已 build 的 dist（构建期检查·非源码跨 app import）：先 pnpm -r build。
 * 用法：node scripts/check-dril-quality.mjs
 */
import { existsSync } from "node:fs";

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
  ["agentcore/search-engine", "apps/agentcore/dist/dril/search-engine.js"],
  ["agentcore/quality", "apps/agentcore/dist/dril/quality.js"],
  ["agentcore/relations", "apps/agentcore/dist/dril/relations.js"],
];
for (const [label, rel] of need) {
  if (!existsSync(abs(rel))) {
    console.error(`✗ dril-quality:check：${label} dist 未构建（${rel}）——先 pnpm -r build`);
    process.exit(1);
  }
}

const { ewmaUpdate, graphDistanceScore, relationStrengthScore } = await import(abs("packages/contracts/dist/index.js").href);
const { ResourceSearchEngine } = await import(abs("apps/agentcore/dist/dril/search-engine.js").href);

const fail = [];
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ① EWMA 确定性（手算对照）。
let s = ewmaUpdate({}, { success: true, latencyMs: 1000 });
if (!(s.successRate === 1 && s.usageCount === 1 && s.avgLatencyMs === 1000)) fail.push("EWMA 首观测无 prev 应 =观测本身");
s = ewmaUpdate(s, { success: false, latencyMs: 3000 });
if (!close(s.successRate, 0.9) || !close(s.avgLatencyMs, 1200) || s.usageCount !== 2) fail.push(`EWMA 二观测手算不符：${JSON.stringify(s)}`);
if (JSON.stringify(ewmaUpdate({ successRate: 0.5, usageCount: 3, avgLatencyMs: 2000 }, { success: true, latencyMs: 1000 })) !==
    JSON.stringify(ewmaUpdate({ successRate: 0.5, usageCount: 3, avgLatencyMs: 2000 }, { success: true, latencyMs: 1000 }))) {
  fail.push("EWMA 非确定性（同输入异输出）");
}

// 构造两个除单一变量外全同的 solver 资源。
const solver = (key, extra) => ({
  kind: "solver", key, label: "产能推演求解器", description: "给定型号数量周数，推演产能满足度与缺口率。",
  isDeterministic: true, requiresSidecar: false,
  tieredTags: { l1_domain: ["plan"], l2_decisionType: [], l3_scenario: [], l4_object: [], l5_algorithm: [] }, ...extra,
});
const rankOf = (res, key) => res.results.findIndex((r) => r.resource.key === key);
const engine = new ResourceSearchEngine();
const Q = "产能推演满足度缺口";

// ② 低质量排名下降 vs 高质量同侪（高质量 key 取字典序更靠后·排前证明 history 而非 tie-break）+ mutation。
{
  const high = solver("zzz_high", { quality: { successRate: 0.95, accuracy: 0.9, trustLevel: "GOVERNED" } });
  const low = solver("aaa_low", { quality: { successRate: 0.05, accuracy: 0.0, trustLevel: "EXPERIMENTAL" } });
  const res = engine.search(Q, [high, low], { maxResults: 10, minScore: 0 });
  if (!(rankOf(res, "zzz_high") < rankOf(res, "aaa_low"))) fail.push("高质量未排在低质量同侪之上（history 未咬）");
  const hi = res.results.find((x) => x.resource.key === "zzz_high");
  const lo = res.results.find((x) => x.resource.key === "aaa_low");
  if (!(hi.scoreBreakdown.history > lo.scoreBreakdown.history)) fail.push("history 子分未随 successRate 分离");
  // mutation：翻转质量 → 排名翻转。
  const a2 = solver("zzz_high", { quality: { successRate: 0.05, accuracy: 0.0, trustLevel: "EXPERIMENTAL" } });
  const b2 = solver("aaa_low", { quality: { successRate: 0.95, accuracy: 0.9, trustLevel: "GOVERNED" } });
  const res2 = engine.search(Q, [a2, b2], { maxResults: 10, minScore: 0 });
  if (!(rankOf(res2, "aaa_low") < rankOf(res2, "zzz_high"))) fail.push("mutation：翻转 successRate 排名未翻转");
  console.log(`· 质量排序：high.history=${hi.scoreBreakdown.history} > low.history=${lo.scoreBreakdown.history}·mutation 翻转 OK`);
}

// ③ graphDistance 纯函数 + SEAM 排序 + mutation。
if (graphDistanceScore(new Map([["Line", 1]]), ["Line"]) !== 0.5) fail.push("graphDistanceScore(1 hop) ≠ 0.5");
if (graphDistanceScore(undefined, ["Line"]) !== 0) fail.push("graphDistanceScore 无图应 0");
{
  const eng = new ResourceSearchEngine({ hopsFromFocus: new Map([["Base", 0], ["Line", 1], ["Equipment", 3]]) });
  const near = solver("near", { scopeObjectTypes: ["Line"] });
  const far = solver("far", { scopeObjectTypes: ["Equipment"] });
  const res = eng.search("产能推演", [near, far], { maxResults: 10, minScore: 0 });
  const nr = res.results.find((x) => x.resource.key === "near");
  const fr = res.results.find((x) => x.resource.key === "far");
  if (!(nr.scoreBreakdown.ontology > fr.scoreBreakdown.ontology)) fail.push("graphDistance：近资源 ontology 未高于远资源");
  if (!(rankOf(res, "near") < rankOf(res, "far"))) fail.push("graphDistance：近资源未排前");
  const flip = new ResourceSearchEngine({ hopsFromFocus: new Map([["Base", 0], ["Line", 3], ["Equipment", 1]]) });
  const res2 = flip.search("产能推演", [near, far], { maxResults: 10, minScore: 0 });
  if (!(rankOf(res2, "far") < rankOf(res2, "near"))) fail.push("graphDistance mutation：翻转跳数图排名未翻转");
  console.log(`· graphDistance：near.ontology=${nr.scoreBreakdown.ontology} > far.ontology=${fr.scoreBreakdown.ontology}·mutation 翻转 OK`);
}

// relationStrength 纯函数。
if (relationStrengthScore([{ toKind: "solver", toKey: "X" }, { toKind: "slice", toKey: "Y" }], new Set(["solver|X"])) !== 0.5) {
  fail.push("relationStrengthScore(1/2) ≠ 0.5");
}

// ④ 端点冒烟：boot 内存态 → 探针 → 再检索 history 上移；relations 1-hop。
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
for (const sk of skills) await repos.skills.insert(sk);
for (const a of agents) await repos.agents.insert(a);
for (const m of seed.seedMcpConfigs()) await repos.mcpConfigs.insert(m);

const deps = wireDeps({ config, repos, llm: new ScriptedLlmClient(), dataCore: createMockDataCore(), mcp: new MockMcpClient() });
const app = await buildServer(deps);
await app.ready();
const H = { "x-debug-user": encodeURIComponent(`${TENANT}:cli:catalog_admin`), "content-type": "application/json" };
const doSearch = async () => (await app.inject({ method: "POST", url: "/b/v1/resources/search", headers: H, payload: { query: "产能推演满足度缺口", minScore: 0, kinds: ["solver"] } })).json();
const cfHistory = (body) => body.results.find((r) => r.resource.key === "capacity_forecast")?.scoreBreakdown.history;

const base = await doSearch();
const baseH = cfHistory(base);
if (baseH === undefined) fail.push("端点冒烟：capacity_forecast 不在检索结果");
for (let i = 0; i < 3; i++) {
  const p = await app.inject({ method: "POST", url: "/b/v1/resources/solver/capacity_forecast/quality", headers: H, payload: { success: true, latencyMs: 800 } });
  if (p.statusCode !== 200) fail.push(`质量探针 → ${p.statusCode}`);
}
const high = await doSearch();
const highH = cfHistory(high);
if (!(highH > baseH)) fail.push(`端点冒烟：探成功后 history 未上移（${baseH} → ${highH}）`);

const rel = await app.inject({ method: "GET", url: "/b/v1/resources/workflow/capacity_check/relations", headers: H });
const relBody = rel.json();
if (rel.statusCode !== 200) fail.push(`relations 端点 → ${rel.statusCode}`);
else if (!relBody.relations?.some((r) => r.relType === "invokes" && r.toKind === "solver" && r.toKey === "capacity_forecast")) {
  fail.push("relations 端点：capacity_check 缺 invokes→capacity_forecast 出边");
}
await app.close();
console.log(`· 端点冒烟：capacity_forecast history ${baseH} →(探3次成功)→ ${highH}·relations 1-hop OK`);

if (fail.length) {
  console.error("\n✗ dril-quality:check 失败：");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("\n✓ dril-quality:check：EWMA 确定·低质量排名下降(+mutation)·graphDistance 近者优先(+mutation)·探针→再检索 history 上移·relations 1-hop。");
