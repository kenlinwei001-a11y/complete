/**
 * Real-LLM smoke test: runs acceptance cases A1 / A2 / B1 against in-memory repos
 * + mock DataCore clients with a REAL provider client (amends QOS-PRD §6).
 *
 * Providers (SMOKE_PROVIDER, default anthropic):
 *   anthropic          — requires ANTHROPIC_API_KEY
 *   openai             — requires OPENAI_API_KEY (or SMOKE_API_KEY_ENV)
 *   openai_compatible  — requires SMOKE_BASE_URL (+ key via SMOKE_API_KEY_ENV)
 * SMOKE_MODEL overrides both classifier/agent models (plain model id).
 *
 * Usage examples:
 *   pnpm --filter agentcore run smoke:llm
 *   SMOKE_PROVIDER=openai_compatible SMOKE_BASE_URL=https://api.deepseek.com \
 *     SMOKE_API_KEY_ENV=DEEPSEEK_API_KEY SMOKE_MODEL=deepseek-chat \
 *     pnpm --filter agentcore run smoke:llm
 */
import { loadConfig } from "../config.js";
import { wireDeps } from "../deps.js";
import { AnthropicLlmClient } from "../llm/anthropic.js";
import { OpenAiLlmClient } from "../llm/openai.js";
import type { LlmClient } from "../llm/types.js";
import { Metrics } from "../metrics.js";
import { createMockDataCore } from "../mocks/clients.js";
import { SEED_PACKAGE_ID, SEED_TENANT, seedIntentsAndPlans, seedScenarioPackage } from "../mocks/seed.js";
import { createMemoryRepos } from "../persistence/memory.js";

const provider = process.env.SMOKE_PROVIDER ?? "anthropic";
if (process.env.SMOKE_MODEL) {
  process.env.QOS_CLASSIFIER_MODEL = process.env.SMOKE_MODEL;
  process.env.QOS_AGENT_MODEL = process.env.SMOKE_MODEL;
}

const config = loadConfig();
const repos = createMemoryRepos();
const metrics = new Metrics();
await repos.packages.insert(seedScenarioPackage());
const { intents, plans } = seedIntentsAndPlans();
for (const p of plans) await repos.plans.insert(p);
for (const i of intents) await repos.intents.insert(i);

let llm: LlmClient;
if (provider === "anthropic") {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is required for smoke:llm (SMOKE_PROVIDER=anthropic)");
    process.exit(1);
  }
  llm = new AnthropicLlmClient(metrics);
} else if (provider === "openai" || provider === "openai_compatible") {
  const baseUrl = process.env.SMOKE_BASE_URL;
  if (provider === "openai_compatible" && !baseUrl) {
    console.error("SMOKE_BASE_URL is required for SMOKE_PROVIDER=openai_compatible");
    process.exit(1);
  }
  const apiKeyEnv = process.env.SMOKE_API_KEY_ENV ?? "OPENAI_API_KEY";
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) {
    console.error(`${apiKeyEnv} is required for SMOKE_PROVIDER=${provider}`);
    process.exit(1);
  }
  llm = new OpenAiLlmClient({ apiKey, baseUrl, metrics });
} else {
  console.error(`unknown SMOKE_PROVIDER: ${provider}`);
  process.exit(1);
}

const deps = wireDeps({ config, repos, llm, dataCore: createMockDataCore(), metrics });

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
