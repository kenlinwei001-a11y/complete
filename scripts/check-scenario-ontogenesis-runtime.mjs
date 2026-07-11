#!/usr/bin/env node
/**
 * 门 `scenario-ontogenesis-runtime:check`（PRD-scenario-ontogenesis §6·收口门 ONTO-SCEN-GATE-WRITEBACK）：
 * **真跑通**而非查存在。把 20 张出厂卡逐张 grow（在内存态真起 agentcore + mock DataCore 合成世界），
 * 断言 §6 逐卡不变量的**运行期**内核——静态门 check-ontogenesis.mjs 明说测不了、诚实跳过的那三条，这里真跑：
 *
 *   §6.1（数据环）：每张 maturity=GOVERNED 卡的 ScenarioOntogenesisRun.verification.status==VERIFIED
 *                  且 rings.data 且答案含**承载数据块**（kpi/table/action_draft/rule_violation/⟦ref⟧）——投影真数据，非占位。
 *   §6.5（无静默残缺）：任何 maturity≠GOVERNED 卡必有 gaps[]，每条 disposition∈{AUTO_DERIVE,NEEDS_HUMAN}，
 *                  NEEDS_HUMAN 必带 ticketId（诚实开单，绝不静默掉答）。
 *   工作流地板（确定性·无 LLM 也必过）：13 张 WORKFLOW_FIRST 卡**必须** GOVERNED+VERIFIED
 *                  （§2.4 确定性 scenario-bind 走 Path A，不依赖 LLM）——退化即红（revert 齿）。
 *   §2.4 点卡真决策视图：抽样 launch → classification.model==deterministic:scenario-bind + path==WORKFLOW
 *                  + 答案含承载数据块（北极星「点卡→真决策视图」的运行期证）。
 *
 * 绿测试≠能用：本门是 gates 链里唯一**真把 20 卡 grow 一遍**的门，与 seed-demo-smoke（真起 datacore）同范式。
 * AGENT_FIRST 卡的诚实边界：本 mock 世界 + 确定性 scenario-bind 使其亦走 Path A 出真数据 → 实测 GOVERNED；
 * 若某卡因 LLM 缺席落 PROVISIONAL，§6.5 分支保证它诚实开单而非静默——两种都合规，门都放行（只钉工作流地板+无静默残缺）。
 *
 * 前置：gates 链在本门之前已 `pnpm -r build`（agentcore dist 新鲜）。
 */
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const AC = (p) => pathToFileURL(join(process.cwd(), "apps/agentcore/dist", p)).href;
const fail = [];

const mods = await Promise.all([
  import(AC("config.js")), import(AC("deps.js")), import(AC("llm/mock.js")), import(AC("mcp/mock.js")),
  import(AC("metrics.js")), import(AC("mocks/clients.js")), import(AC("mocks/seed.js")),
  import(AC("persistence/memory.js")), import(AC("server.js")), import(AC("intents/intent-mode.js")),
  import(AC("scenarios-catalog.js")),
]).catch((e) => { console.error(`✗ scenario-ontogenesis-runtime: 无法导入 agentcore dist（先 pnpm --filter agentcore build）：${e.message}`); process.exit(1); });

const [{ loadConfig }, { wireDeps }, { ScriptedLlmClient }, { MockMcpClient }, { Metrics },
  { createMockDataCore }, { SEED_TENANT, seedIntentsAndPlans, seedScenarioPackage },
  { createMemoryRepos }, { buildServer }, { intentModeFor }, { SCENARIO_CATALOG }] = mods;

const ADMIN = `${SEED_TENANT}:user-admin:catalog_admin|planner`;
const PLANNER = `${SEED_TENANT}:user-planner:planner`;
const H = (u) => ({ "x-debug-user": encodeURIComponent(u), "content-type": "application/json" });
const DATA_BEARING = (blocks) => blocks.some((b) =>
  b.type === "kpi" || b.type === "table" || b.type === "action_draft" || b.type === "rule_violation" ||
  (b.type === "text" && /⟦ref:/.test(String(b.markdown ?? ""))));

const config = loadConfig({ PORT: "0", LOG_LEVEL: "silent" });
const repos = createMemoryRepos();
await repos.packages.insert(seedScenarioPackage());
const { intents, plans } = seedIntentsAndPlans();
for (const p of plans) await repos.plans.insert(p);
for (const i of intents) await repos.intents.insert(i);
const deps = wireDeps({ config, repos, llm: new ScriptedLlmClient(), dataCore: createMockDataCore(), mcp: new MockMcpClient(), metrics: new Metrics() });
const app = await buildServer(deps);
await app.ready();

const cards = SCENARIO_CATALOG.map((c) => c.sNo);
// CORE-NL-SOLVER-ROUTING：20 → 25（S21–S25 通用多跳）；Q30-P1/P2 26→30（S26 挤占推演 + S27 因果归因 + S28–S30 横铺A）；
// Q30-P3 30→35（S31–S35 横铺B：现金流/人力/能耗 3 新域 + 改道/多约束 2 复用类·全 WORKFLOW_FIRST）；
// Q30-P4 35→36（S36 对策组合编排 countermeasure_combo_q·跨求解器编排层 Q6 NL 入口·WORKFLOW_FIRST）；
// Q30-P5 36→42（S37–S42 六条 workflow 多步链·串起已交付求解器·经 growScenario 三环长成·闭 G-9·全 WORKFLOW_FIRST）。
if (cards.length !== 42) fail.push(`§6 运行期：出厂目录不是 42 卡（实 ${cards.length}）——目录漂移`);

const table = [];
let governed = 0;
for (const k of cards) {
  const res = await app.inject({ method: "POST", url: `/b/v1/scenarios/${k}/grow`, headers: H(ADMIN) });
  if (res.statusCode !== 200) { fail.push(`卡 ${k} grow 非 200（${res.statusCode}）：${res.body.slice(0, 160)}`); table.push({ k, maturity: "ERR" }); continue; }
  const run = res.json();
  const card = SCENARIO_CATALOG.find((c) => c.sNo === k);
  const mode = intentModeFor(card.intentKey);
  let blocks = [];
  if (run.verification?.taskId) blocks = (await repos.tasks.get(run.verification.taskId))?.answer?.blocks ?? [];
  const dataBearing = DATA_BEARING(blocks);
  table.push({ k, mode, maturity: run.maturity, v: run.verification?.status, path: run.verification?.path, gap: run.verification?.gapCode, dataBearing });

  if (run.maturity === "GOVERNED") {
    governed++;
    // §6.1：GOVERNED ⟹ VERIFIED + data 环 + 承载数据块。
    if (run.verification?.status !== "VERIFIED") fail.push(`§6.1 卡 ${k}: GOVERNED 但 verification.status=${run.verification?.status}（非 VERIFIED）`);
    if (!run.rings?.data) fail.push(`§6.1 卡 ${k}: GOVERNED 但 rings.data=false（数据环未闭）`);
    if (!dataBearing) fail.push(`§6.1/§6.2 卡 ${k}: GOVERNED 但答案无承载数据块（kpi/table/action_draft/⟦ref⟧）——占位冒充（G-1 残）`);
    if ((run.gaps ?? []).length > 0) fail.push(`§6.1 卡 ${k}: GOVERNED 却带 gaps ${JSON.stringify(run.gaps)}（矛盾）`);
  } else {
    // §6.5：非 GOVERNED ⟹ 有 gaps 且每条有处置；NEEDS_HUMAN 必带 ticketId（无静默残缺）。
    const gaps = run.gaps ?? [];
    if (gaps.length === 0) fail.push(`§6.5 卡 ${k}: maturity=${run.maturity} 却无 gaps[]（静默残缺，违 R16「绝不静默」）`);
    for (const g of gaps) {
      if (!["AUTO_DERIVE", "NEEDS_HUMAN"].includes(g.disposition)) fail.push(`§6.5 卡 ${k}: gap ${g.gapCode} 处置非法（${g.disposition}）`);
      if (g.disposition === "NEEDS_HUMAN" && !g.ticketId) fail.push(`§6.5 卡 ${k}: NEEDS_HUMAN 缺口 ${g.gapCode} 无 ticketId（未诚实开单）`);
    }
  }
}

// 工作流地板（确定性齿·revert-red 靶）：18 张 WORKFLOW_FIRST 卡必 GOVERNED（无 LLM 也必过·CORE-NL-SOLVER-ROUTING 后 13→18）。
const wfCards = table.filter((r) => r.mode === "WORKFLOW_FIRST");
for (const r of wfCards) {
  if (r.maturity !== "GOVERNED") fail.push(`工作流地板 卡 ${r.k}(WORKFLOW_FIRST): 应确定性 GOVERNED，实 ${r.maturity}/${r.gap ?? ""}（渲染投影/确定性绑定退化）`);
}
if (wfCards.length < 13) fail.push(`工作流地板：WORKFLOW_FIRST 卡数 ${wfCards.length} < 13（mode 钉死表漂移）`);

// §2.4 抽样：launch S01 → 确定性绑定 + Path A + 承载数据块（点卡即真决策视图）。
{
  const lr = await app.inject({ method: "POST", url: "/b/v1/scenarios/S01/launch", headers: H(PLANNER) });
  if (lr.statusCode !== 202) fail.push(`§2.4 launch S01 非 202（${lr.statusCode}）`);
  else {
    const { taskId } = lr.json();
    let t = await repos.tasks.get(taskId);
    for (let i = 0; i < 120 && t && !["COMPLETED", "FAILED", "CANCELLED", "AWAITING_CLARIFICATION"].includes(t.status); i++) {
      await new Promise((r) => setTimeout(r, 100)); t = await repos.tasks.get(taskId);
    }
    if (t?.classification?.model !== "deterministic:scenario-bind") fail.push(`§2.4 launch S01: classification.model=${t?.classification?.model}（非 deterministic:scenario-bind，未跳过 LLM classify）`);
    if (t?.path !== "WORKFLOW") fail.push(`§2.4 launch S01: path=${t?.path}（非 WORKFLOW 确定性 Path A）`);
    if (!DATA_BEARING(t?.answer?.blocks ?? [])) fail.push(`§2.4 launch S01: 点卡答案无承载数据块（非真决策视图）`);
  }
}

await app.close();

const dist = table.reduce((a, r) => { a[r.maturity] = (a[r.maturity] ?? 0) + 1; return a; }, {});
if (fail.length > 0) {
  console.error("✗ scenario-ontogenesis-runtime:check 失败：");
  for (const f of fail) console.error("  - " + f);
  console.error("  分布：" + JSON.stringify(dist));
  console.error("  逐卡：" + table.map((r) => `${r.k}=${r.maturity}${r.v ? "/" + r.v : ""}`).join(" "));
  process.exit(1);
}
console.log(`✓ scenario-ontogenesis-runtime:check —— ${cards.length} 卡真 grow 跑通：${governed}/${cards.length} GOVERNED，分布 ${JSON.stringify(dist)}。`);
console.log(`  §6.1 每 GOVERNED 卡 VERIFIED + rings.data + 承载数据块（投影真数据）· §6.5 非 GOVERNED 卡必带 gaps 处置（无静默残缺）·`);
console.log(`  工作流地板 ${wfCards.length} 张 WORKFLOW_FIRST 全 GOVERNED（确定性·revert-red 齿）· §2.4 launch S01 确定性绑定 Path A 出真决策视图。`);
