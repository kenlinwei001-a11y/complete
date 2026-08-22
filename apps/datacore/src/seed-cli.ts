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
import { seedDemo, seedDemoSynthetic, seedDemoPropagationRules, seedDemoProcessLayer, seedDemoOrgWorld, seedDemoEntitlements } from "./seed.js";
import { seedDemoDerivationSpecs } from "./seed-derivation-specs.js";
import { seedDemoSimWorld } from "./sim/seed-world.js";

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
    // WO-Q0 业务流程层（与 server.ts 的启动播种路径**必须同步**——两条播种路径漂了，
    // 就会出现「容器起得来的环境有流程层、跑过 pnpm seed 的环境没有」这种只在某些机器上复现的坑）。
    await seedDemoProcessLayer(repos);
    logger.info("seeded business process layer (13 domains × 65 processes)");
    // WO-ORG-WORLD 组织世界（与 server.ts 播种路径**必须同步**，理由同上）。
    await seedDemoOrgWorld(repos);
    logger.info("seeded organization world (departments/roles/persons + authorities/limits/delegation)");
    await seedDemoEntitlements(repos);
    logger.info("lit up demo QOS dark-launch features (dril/critic/free-llm/coordinator/compose)");
    // WO-SLICE-DERIV-EMPTY 派生溯源规格（与 server.ts 播种路径**必须同步**，理由同上）。
    const nSpecs = await seedDemoDerivationSpecs(repos, services.ontologyCore, services.governance, adminCtx);
    logger.info(`compiled ${nSpecs} demo derivation specs (evidence layer non-empty)`);
    // WO-SIM-SEED-WORLD 推演种子世界（与 server.ts 播种路径**必须同步**，理由同上）。
    // 同样排最后：它读的是上面几步播出来的对象与规则。
    const simWorld = await seedDemoSimWorld(repos, services.sim, adminCtx);
    logger.info(
      simWorld.created
        ? `seeded demo sim world (RUNNING @tick${simWorld.curTick}, ${simWorld.origin?.cells ?? 0} 格 / 实测 ${simWorld.origin?.measuredCells ?? 0} 格` +
          // 与 server.ts 那条**逐字同步**（两条播种路径漂了就会出现「容器里有扰动、pnpm seed 出来的没有」）。
          (simWorld.choice
            ? `；扰动落 ${simWorld.choice.targetObjectId}.${simWorld.choice.targetStateVar} delta+${simWorld.choice.magnitude}，下游 ${simWorld.choice.reachCells} 格)`
            : `；**未播扰动** — ${simWorld.perturbationReason ?? "unknown"}）`)
        : `demo sim world not created — ${simWorld.reason ?? "unknown"}`,
    );
  }
  await repos.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
