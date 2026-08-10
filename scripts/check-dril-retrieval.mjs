#!/usr/bin/env node
/**
 * 门 `dril-retrieval:check`（WO-DRIL-P2 · 五级标签 + 混合检索 · SEAM 头号判据 · R6 · R14 · fail-open）：
 *  ① golden query set（NL→预期资源 key，≥8 条）经真排序 → 预期资源进入 **top-3 ≥ 90%**（真检索·非同义反复）；
 *  ② fail-open：embedder=null（词法回退）仍返合理 top-1（byte-兼容·不崩）；
 *  ③ R6：同 query 同资源集 → 字节级同序；
 *  ④ 端点冒烟：boot 内存态 AgentCore，POST /b/v1/resources/search → 含 scoreBreakdown + explanation。
 *
 * 校验经已 build 的 dist（构建期检查·非源码跨 app import）：先 pnpm --filter agentcore build（+ contracts）。
 * 用法：node scripts/check-dril-retrieval.mjs
 */
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
  ["agentcore/search-engine", "apps/agentcore/dist/dril/search-engine.js"],
  ["agentcore/projector", "apps/agentcore/dist/dril/resource-projector.js"],
  ["agentcore/taxonomy", "apps/agentcore/dist/dril/tag-taxonomy.js"],
];
// ⛔ 守卫必须在 import dist **之前**（欠账 #161）：本门用 dist 的检索引擎/投影器算排名断言，
//    dist 落后 ⇒ 排名来自旧实现，结论却讲成"源码的检索质量"。
assertDistFresh(need.map(([, rel]) => rel), { gate: "dril-retrieval:check" });

const { ResourceSearchEngine } = await import(abs("apps/agentcore/dist/dril/search-engine.js").href);
const { projectSolvers } = await import(abs("apps/agentcore/dist/dril/resource-projector.js").href);
const { extractTieredTags } = await import(abs("apps/agentcore/dist/dril/tag-taxonomy.js").href);

// 代表性求解器目录（镜像 DataCore SOLVER_CATALOG / COCKPIT_SOLVER_CATALOG 的真实描述）。
const GOLDEN_CATALOG = [
  { key: "capacity_forecast", name: "产能推演", description: "给定型号/数量/周数，推演产能满足度（P50/P90、缺口率、主瓶颈）。", domain: "plan" },
  { key: "capacity_rollup", name: "产能上卷", description: "把工序/产线产能沿本体金字塔上卷到基地/型号维度。", domain: "capacity" },
  { key: "bottleneck_matrix", name: "瓶颈矩阵", description: "按基地×工序输出瓶颈强度矩阵，定位约束工序。", domain: "capacity" },
  { key: "risk_timeline", name: "风险时间线", description: "按日推演风险时序（越线点/根因链）。", domain: "plan" },
  { key: "affected_orders", name: "受影响订单", description: "给定扰动，返回受影响订单清单（problems/rootChain）。", domain: "sales" },
  { key: "inventory_optimize", name: "库存优化", description: "目标水位/超储/欠储/呆滞与可释放资金。", domain: "material" },
  { key: "kit_readiness", name: "物料齐套", description: "逐单算齐套率（含在途按 ETA），输出缺料与建议。", domain: "material" },
  { key: "yield_diagnosis", name: "良率诊断", description: "2σ 滑窗突变检测 + 根因候选按时间贴近度排序。", domain: "quality" },
  { key: "changeover_sequence", name: "换型排序", description: "最近邻贪心最小化换型时长，标注交期不可行单。", domain: "plan" },
  { key: "credit_exposure", name: "信用敞口", description: "敞口=应收+在产；可用额与逾期判定（C32）。", domain: "finance" },
  { key: "carbon_footprint", name: "碳足迹核算", description: "物料+能耗两段碳排，对比欧盟阈值给改善杠杆。", domain: "plan" },
  { key: "maintenance_stagger", name: "检修错峰", description: "检修周与交付高峰冲突 → ±4 周内选负荷最低周。", domain: "equip" },
  { key: "cert_schedule", name: "认证排期", description: "按缺口贡献/工时优先级，受 C26 并行约束贪心排认证到周。", domain: "plan" },
  { key: "finance_pnl", name: "量价本利科目表", description: "读 FinancePlan 出收入/销售成本/毛利 预算vs滚动vs差异 + 毛利率行。", domain: "finance" },
  { key: "supply_demand_gap_attribution", name: "供需失衡双向归因", description: "产销缺口双向分摊到需求端(预测偏差)与供给端(产能/物料/设备)，各占多少、每叶证据。", domain: "decision", answersQuestions: ["供需为什么对不上", "需求预测虚高还是供不上", "各占多少"], tags: ["supply-demand", "gap", "attribution", "forecast"] },
  // WO-DRIL-PRECISION：对口根因族——镜像真目录 answersQuestions（NL 样例问句·让对口 solver 拿语义分）。
  { key: "gap_attribution", name: "深度反向缺口归因", description: "总目标缺口沿本体反向多跳结构分摊到基地×订单×瓶颈叶，再沿因果边溯到终点根因，产原子因素表+residual。回答『总缺口一路归到哪些最终根因、各占多少、每叶证据』。", domain: "decision", answersQuestions: ["为什么这个指标没达标", "份额下降的根因是什么", "储能份额为什么下降逐层拆根因", "逐层拆根因、缺口一路归到哪些最终根因", "总缺口主要来自哪一层、各占多少", "每叶证据是什么"], tags: ["gap", "attribution", "rootcause", "缺口归因", "逐层拆根因", "指标没达标"] },
  { key: "margin_attribution", name: "毛利倒挂归因", description: "成本项拆解 + 倒挂群主驱动聚合，定位毛利倒挂的根因成本项。净室通用。", domain: "generic", answersQuestions: ["毛利为什么倒挂", "哪个成本项拖垮了毛利", "毛利倒挂的根因成本项是哪些", "成本项怎么拆解定位倒挂", "倒挂群的主驱动成本是什么"], tags: ["margin", "毛利倒挂", "成本项", "cost", "attribution"] },
];
const ONTOLOGY_TYPES = [
  { key: "Base", label: "基地" }, { key: "Line", label: "产线" }, { key: "Model", label: "型号" },
  { key: "Order", label: "订单" }, { key: "Material", label: "物料" }, { key: "Equipment", label: "设备" },
  { key: "Customer", label: "客户" },
];
const GOLDEN_QUERIES = [
  { query: "哪个求解器算产能缺口满足度", expect: "capacity_forecast" },
  { query: "产线换型顺序怎么排最省换型时间", expect: "changeover_sequence" },
  { query: "库存呆滞和超储欠储怎么优化释放资金", expect: "inventory_optimize" },
  { query: "订单物料齐套率怎么算缺料", expect: "kit_readiness" },
  { query: "良率突然下降的根因诊断", expect: "yield_diagnosis" },
  { query: "客户信用逾期敞口多大", expect: "credit_exposure" },
  { query: "设备检修和交付高峰冲突怎么错峰", expect: "maintenance_stagger" },
  { query: "产品碳足迹核算能耗碳排", expect: "carbon_footprint" },
  { query: "供需产销为什么对不上双向归因", expect: "supply_demand_gap_attribution" },
  { query: "认证工程师怎么排期到周", expect: "cert_schedule" },
  // WO-DRIL-PRECISION 命门：对口根因 solver 须排到榜首（此前 gap_attribution 第4·margin_attribution 抢第1）。
  { query: "储能份额为什么下降 逐层拆根因", expect: "gap_attribution" },
];

const resources = projectSolvers(GOLDEN_CATALOG).map((r) => ({
  ...r,
  tieredTags: extractTieredTags(`${r.label} ${r.description} ${r.capability ?? ""}`, { domain: r.domain, ontologyTypes: ONTOLOGY_TYPES }),
}));

const fail = [];
const engine = new ResourceSearchEngine({ ontologyTypes: ONTOLOGY_TYPES });

// ① golden top-3 命中率。
const misses = [];
for (const g of GOLDEN_QUERIES) {
  const res = engine.search(g.query, resources, { maxResults: 10, minScore: 0 });
  const top3 = res.results.slice(0, 3).map((r) => r.resource.key);
  if (!top3.includes(g.expect)) misses.push(`${g.query} → 期望 ${g.expect}·实得 [${top3.join(", ")}]`);
}
const hitRate = (GOLDEN_QUERIES.length - misses.length) / GOLDEN_QUERIES.length;
console.log(`· golden top-3 命中率 ${(hitRate * 100).toFixed(1)}%（${GOLDEN_QUERIES.length - misses.length}/${GOLDEN_QUERIES.length}）`);
if (misses.length) for (const m of misses) console.log("  ✗ " + m);
if (hitRate < 0.9) fail.push(`top-3 命中率 ${(hitRate * 100).toFixed(1)}% < 90%`);

// ② fail-open：null embedder 词法回退。
const kw = new ResourceSearchEngine({ embedder: null, ontologyTypes: ONTOLOGY_TYPES });
const kwRes = kw.search("库存呆滞怎么优化", resources, { maxResults: 5, minScore: 0 });
if (!kwRes.results.length) fail.push("fail-open：null embedder 返回空（应词法回退）");
else if (!kwRes.results.slice(0, 3).map((r) => r.resource.key).includes("inventory_optimize")) {
  fail.push(`fail-open：null embedder top-3 未含 inventory_optimize（实得 ${kwRes.results.slice(0, 3).map((r) => r.resource.key).join(",")}）`);
}

// ③ R6 确定性。
const d1 = JSON.stringify(engine.search("良率下降根因", resources, { maxResults: 8, minScore: 0 }));
const d2 = JSON.stringify(engine.search("良率下降根因", resources, { maxResults: 8, minScore: 0 }));
if (d1 !== d2) fail.push("R6：同 query 同资源集非字节同序");

// ④ 端点冒烟：boot 内存态 AgentCore，POST /b/v1/resources/search。
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
  method: "POST",
  url: "/b/v1/resources/search",
  headers: { "x-debug-user": encodeURIComponent(`${TENANT}:cli:catalog_admin`), "content-type": "application/json" },
  payload: { query: "推演产能满足度 P50 缺口", minScore: 0 },
});
await app.close();
if (res.statusCode !== 200) fail.push(`POST /b/v1/resources/search → ${res.statusCode}`);
else {
  const body = res.json();
  const top = body.results?.[0];
  if (!top) fail.push("端点冒烟：无检索结果");
  else {
    if (top.resource.key !== "capacity_forecast") fail.push(`端点冒烟：top-1 应为 capacity_forecast·实得 ${top.resource.key}`);
    for (const k of ["semantic", "domain", "ontology", "history", "cost"]) {
      if (typeof top.scoreBreakdown?.[k] !== "number") fail.push(`端点冒烟：scoreBreakdown 缺 ${k}`);
    }
    if (!body.explanation) fail.push("端点冒烟：缺 explanation");
    console.log(`· 端点冒烟 top-1=${top.resource.key} score=${top.score} · scoreBreakdown=${JSON.stringify(top.scoreBreakdown)}`);
  }
}

if (fail.length) {
  console.error("\n✗ dril-retrieval:check 失败：");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log(`\n✓ dril-retrieval:check：golden top-3 命中率 ${(hitRate * 100).toFixed(1)}% ≥ 90%·fail-open 词法回退·R6 同序·端点带 scoreBreakdown+explanation。`);
