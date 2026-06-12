/**
 * Real-LLM smoke test (requires ANTHROPIC_API_KEY): runs acceptance cases A1 / A2 / B1
 * against in-memory repos + mock DataCore clients with the real Anthropic SDK client.
 * Usage: pnpm --filter agentcore run smoke:llm
 */
import { loadConfig } from "../config.js";
import { wireDeps } from "../deps.js";
import { AnthropicLlmClient } from "../llm/anthropic.js";
import { Metrics } from "../metrics.js";
import { createMockDataCore } from "../mocks/clients.js";
import { SEED_PACKAGE_ID, SEED_TENANT, seedIntentsAndPlans, seedScenarioPackage } from "../mocks/seed.js";
import { createMemoryRepos } from "../persistence/memory.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is required for smoke:llm");
  process.exit(1);
}

const config = loadConfig();
const repos = createMemoryRepos();
const metrics = new Metrics();
await repos.packages.insert(seedScenarioPackage());
const { intents, plans } = seedIntentsAndPlans();
for (const p of plans) await repos.plans.insert(p);
for (const i of intents) await repos.intents.insert(i);

const deps = wireDeps({ config, repos, llm: new AnthropicLlmClient(metrics), dataCore: createMockDataCore(), metrics });

const auth = { tenantId: SEED_TENANT, userId: "smoke-user", roles: ["planner"] };

async function runCase(name: string, query: string, context: Record<string, unknown>): Promise<void> {
  console.log(`\n=== ${name}: ${query}`);
  const { taskId } = await deps.orchestrator.submitQuery(auth, {
    packageId: SEED_PACKAGE_ID,
    query,
    context: { view: "risk", selectedObjects: [], filters: {}, ...context } as never,
  });
  // wait for terminal state
  for (let i = 0; i < 120; i++) {
    const task = await repos.tasks.get(taskId);
    if (task && ["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) {
      console.log(`status=${task.status} path=${task.path}`);
      console.log(JSON.stringify(task.answer ?? task.error, null, 2).slice(0, 2000));
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log("TIMEOUT waiting for task");
}

await runCase("A1", "影响哪些订单？", {
  selectedObjects: [{ objectType: "Base", objectId: "base_changzhou", label: "常州" }],
});
await runCase("A2", "4680-NCM 加 20% 六周能不能接？", {});
await runCase("B1", "对比一下储能基地和动力基地的平均利用率", {});

console.log("\nsmoke:llm done");
process.exit(0);
