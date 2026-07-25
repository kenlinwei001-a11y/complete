/** Standalone seed script: `pnpm --filter datacore seed` (uses pg when DATABASE_URL is set). */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pino } from "pino";
import { loadConfig } from "./config.js";
import { createMemoryRepos } from "./repo/memory.js";
import { createPgRepos } from "./repo/pg.js";
import { LocalFsBlobStore } from "./blob.js";
import { createLlmClient } from "./llm.js";
import { buildApp } from "./app.js";
import { seedDemo, seedDemoSynthetic, seedDemoPropagationRules, seedDemoEntitlements } from "./seed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.LOG_LEVEL });
  if (!config.DATABASE_URL) {
    logger.warn("no DATABASE_URL — in-memory mode is seeded at boot; nothing to persist here");
  }
  const repos = config.DATABASE_URL
    ? await createPgRepos(config.DATABASE_URL, join(__dirname, "..", "migrations"))
    : createMemoryRepos();
  const { services } = await buildApp({
    config,
    repos,
    blob: new LocalFsBlobStore(config.BLOB_DIR),
    llm: createLlmClient({}),
    logger,
  });
  const adminCtx = await seedDemo(repos);
  logger.info("seeded tenant demo + admin/planner/base_manager accounts");
  if (config.SEED_DEMO === "1") {
    await seedDemoSynthetic(services.synthetic, adminCtx);
    logger.info("generated battery-manufacturing synthetic dataset (seed 42)");
    await seedDemoPropagationRules(repos);
    logger.info("seeded demo sim propagation rules (sandbox non-empty)");
    await seedDemoEntitlements(repos);
    logger.info("lit up demo QOS dark-launch features (dril/critic/free-llm/coordinator/compose)");
  }
  await repos.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
