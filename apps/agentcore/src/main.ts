import { loadConfig } from "./config.js";
import { wireDeps } from "./deps.js";
import { LlmProviderRegistry, RoutingLlmClient } from "./llm/providers.js";
import { McpClient } from "./mcp/client.js";
import { Metrics } from "./metrics.js";
import { createMockDataCore } from "./mocks/clients.js";
import { seedIntentsAndPlans, seedScenarioPackage } from "./mocks/seed.js";
import { createRepos } from "./persistence/index.js";
import { buildServer } from "./server.js";
import { createHttpDataCore } from "./tools/datacore-http.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const repos = await createRepos(config);
  const metrics = new Metrics();

  // Seed the battery-manufacturing package when missing (QOS-PRD §7.6).
  const seedPkg = seedScenarioPackage();
  if (!(await repos.packages.get(seedPkg.id))) {
    await repos.packages.insert(seedPkg);
    const { intents, plans } = seedIntentsAndPlans();
    for (const p of plans) await repos.plans.insert(p);
    for (const i of intents) await repos.intents.insert(i);
  }

  const dataCore = config.DATACORE_BASE_URL ? createHttpDataCore(config.DATACORE_BASE_URL) : createMockDataCore();
  const mcp = new McpClient(repos, config.CREDENTIAL_KEY);
  // Multi-provider routing (amends QOS-PRD §6): anthropic (default) / openai /
  // openai_compatible, resolved per model spec + tenant LlmProviderConfig.
  const llm = new RoutingLlmClient(new LlmProviderRegistry({ repos, config, metrics }));

  const deps = wireDeps({ config, repos, llm, dataCore, mcp, metrics });
  const app = await buildServer(deps);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "graceful shutdown");
    const timer = setTimeout(() => process.exit(1), 30_000);
    timer.unref();
    try {
      await app.close();
      await mcp.close();
      await repos.close();
      process.exit(0);
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
