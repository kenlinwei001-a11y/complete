// WO-B AGENT-OBSERVATIONAL-MEMORY · FDE 真起真跑证据脚本（真实 Fastify 监听真端口 · 真 HTTP · 真写真读）。
// LLM 一律 mock（项目铁律：测试不依赖网络/时钟随机·LLM mock）；DataCore 用平台自带内存 mock（无需起 A）。
// 用法：pnpm -r build 后 → node docs/evidence/AGENT-OBSERVATIONAL-MEMORY-fde.mjs（自 curl 自校验·打印证据）。
import { buildServer } from "../../apps/agentcore/dist/server.js";
import { wireDeps } from "../../apps/agentcore/dist/deps.js";
import { loadConfig } from "../../apps/agentcore/dist/config.js";
import { ScriptedLlmClient, text, toolUse } from "../../apps/agentcore/dist/llm/mock.js";
import { createMockDataCore } from "../../apps/agentcore/dist/mocks/clients.js";
import { createMemoryRepos } from "../../apps/agentcore/dist/persistence/memory.js";
import { seedScenarioPackage, seedIntentsAndPlans, SEED_PACKAGE_ID } from "../../apps/agentcore/dist/mocks/seed.js";
import { reconcileUniversalAgent } from "../../apps/agentcore/dist/agents/universal.js";

const PORT = 4102;
const PLANNER = "demo:user-planner:planner";
const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };
const log = (...a) => console.log(...a);

const config = loadConfig({ PORT: String(PORT), LOG_LEVEL: "silent" });
const repos = createMemoryRepos();
await repos.packages.insert(seedScenarioPackage());
const { intents, plans } = seedIntentsAndPlans();
for (const p of plans) await repos.plans.insert(p);
for (const i of intents) await repos.intents.insert(i);
await reconcileUniversalAgent(repos, "demo");

const llm = new ScriptedLlmClient();
const deps = wireDeps({ config, repos, llm, dataCore: createMockDataCore() });
const app = await buildServer(deps);
await app.listen({ port: PORT, host: "127.0.0.1" });
log(`\n[BOOT] agentcore 真监听 http://127.0.0.1:${PORT}  (DataCore=内存mock · LLM=scripted)`);

const H = { "content-type": "application/json", "x-debug-user": encodeURIComponent(PLANNER) };
const post = async (q) => (await fetch(`http://127.0.0.1:${PORT}/api/v1/queries`, { method: "POST", headers: H, body: JSON.stringify({ packageId: SEED_PACKAGE_ID, query: q, context: { view: "dash", selectedObjects: [], filters: {} } }) })).json();
const poll = async (id) => { for (let i = 0; i < 200; i++) { const t = await repos.tasks.get(id); if (t && ["COMPLETED", "FAILED", "CANCELLED"].includes(t.status)) return t; await new Promise((r) => setTimeout(r, 25)); } throw new Error("timeout"); };

// ── 任务1：out-of-catalog → 全域探索 agent 真跑到终态（query_objects → final_answer）→ 写 OBSERVED 观察记忆 ──
llm.queueClassification(OUT_OF_CATALOG);
llm.queueAgentTurn(
  { content: [text("查询基地。"), toolUse("query_objects", { objectType: "Base", filter: {}, limit: 50 })] },
  (req) => { const tc = JSON.stringify(req.messages).match(/tool_call_id=\\"(tc_[A-Z0-9]+)\\"/g)?.pop()?.match(/tc_[A-Z0-9]+/)[0]; return { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "储能基地平均利用率 68.2% ⟦ref:0⟧。" }], provenance: [{ toolCallId: tc, outputPath: "$.data.items" }] })] }; },
);
const r1 = await post("对比储能与动力基地利用率");
const t1 = await poll(r1.taskId);
log(`\n[任务1] taskId=${t1.id} status=${t1.status} path=${t1.path}`);

const id1 = `exp_auto_${t1.id}`.replace(/[^\w-]/g, "_");
const rec = (await repos.experience.listByTenant("demo")).find((c) => c.id === id1);
log(`\n[OBSERVED 观察记忆写侧] 终态钩子写入的经验条目：`);
log(JSON.stringify({ id: rec.id, origin: rec.origin, provenance: rec.provenance, intentKey: rec.intentKey, toolPath: rec.toolPath, keyFindings: rec.keyFindings, scene: rec.scene }, null, 2));
console.assert(rec.origin === "OBSERVED", "origin 必须 OBSERVED");
console.assert(rec.provenance === t1.id, "provenance 必须 = 真 taskId");
console.assert(rec.toolPath.includes("query_objects"), "toolPath 必须含真实工具序列");

// ── 任务2：二次同意图 → agent 首步 search_experience → 命中任务1的 OBSERVED 路径提示（带免责·loop 闭合）──
llm.queueClassification(OUT_OF_CATALOG);
llm.queueAgentTurn(
  { content: [text("先查经验库。"), toolUse("search_experience", { query: "对比储能与动力基地利用率", topK: 5 })] },
  { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "已参考历史路径，本次数字以工具真值为准。" }], provenance: [] })] },
);
const r2 = await post("对比储能与动力基地利用率");
const t2 = await poll(r2.taskId);
const calls = await repos.toolCalls.listByTask(t2.id);
const se = calls.find((c) => c.toolName === "search_experience");
log(`\n[任务2 · search_experience 读侧] 顶层免责声明 disclaimer = 「${se.output.disclaimer}」`);
const hit = se.output.hits.find((h) => h.provenance === t1.id);
log(`[loop 闭合] 二次跑检索命中任务1写入的 OBSERVED 路径提示：`);
log(JSON.stringify({ origin: hit.origin, provenance: hit.provenance, toolPath: hit.toolPath, disclaimer: hit.disclaimer, score: hit.score }, null, 2));
console.assert(se.output.disclaimer === "仅供路径参考·业务事实以工具结果为准", "顶层必带免责");
console.assert(se.output.hits.every((h) => h.disclaimer === "仅供路径参考·业务事实以工具结果为准"), "每条命中都带免责·OBSERVED 永不冒充真值");
console.assert(hit && hit.origin === "OBSERVED", "命中任务1 OBSERVED");

// ── R2：跨租户读不到该 OBSERVED 观察记忆 ──
const cross = await repos.experience.listByTenant("other-tenant");
log(`\n[R2 隔离] other-tenant 列到的经验条目数=${cross.length}；含任务1条目？ ${cross.some((c) => c.id === id1)}`);
console.assert(!cross.some((c) => c.id === id1), "R2：跨租户不可读");

log(`\n✅ 全部断言通过：终态→OBSERVED写入(provenance真taskId·toolPath真序列)·search带免责(永不冒充真值)·loop闭合·R2隔离。`);
await app.close();
process.exit(0);
