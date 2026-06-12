import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pino } from "pino";
import { loadConfig } from "./config.js";
import { createMemoryRepos } from "./repo/memory.js";
import { createPgRepos } from "./repo/pg.js";
import { LocalFsBlobStore } from "./blob.js";
import { createLlmClient } from "./llm.js";
import { buildApp } from "./app.js";
import { seedDemo, seedDemoSynthetic, DEMO_TENANT } from "./seed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.LOG_LEVEL });

  // Persistence behind the repository interface: pg when DATABASE_URL is set, in-memory otherwise.
  const repos = config.DATABASE_URL
    ? await createPgRepos(config.DATABASE_URL, join(__dirname, "..", "migrations"))
    : createMemoryRepos();
  const blob = new LocalFsBlobStore(config.BLOB_DIR);
  const llm = createLlmClient(config);

  const { app, services } = await buildApp({ config, repos, blob, llm, logger });

  const adminCtx = await seedDemo(repos);
  if (config.SEED_DEMO === "1") {
    logger.info("SEED_DEMO=1: generating battery-manufacturing synthetic dataset (seed 42)");
    await seedDemoSynthetic(services.synthetic, adminCtx);
  }

  services.scheduler.start();

  services.outbox.start(async () => {
    const tenants = await repos.tenants.list(DEMO_TENANT).catch(() => []);
    const ids = new Set<string>([DEMO_TENANT, ...tenants.map((t) => t.id)]);
    return [...ids];
  });

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info({ port: config.PORT }, "datacore listening");

  // Graceful shutdown on SIGTERM (drain in-flight work, ≤30s).
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");
    const timeout = setTimeout(() => process.exit(1), 30_000);
    timeout.unref();
    services.outbox.stop();
    services.scheduler.stop();
    void app
      .close()
      .then(() => repos.close())
      .then(() => {
        clearTimeout(timeout);
        process.exit(0);
      })
      .catch(() => process.exit(1));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
