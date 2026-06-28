import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pino } from "pino";
import { loadConfig } from "./config.js";
import { createMemoryRepos } from "./repo/memory.js";
import { createPgRepos } from "./repo/pg.js";
import { LocalFsBlobStore } from "./blob.js";
import { createLlmClient } from "./llm.js";
import { buildApp } from "./app.js";
import { bootstrapPlatformAdmin, bootstrapReadiness } from "./bootstrap.js";
import { seedDemo, seedDemoSynthetic, seedDemoPropagationRules, seedDemoSopVersion, seedDemoLlmProvider, seedDemoOptEntitlement, seedLogisticsTenant, seedEmptyTenant, DEMO_TENANT } from "./seed.js";

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

  const bootstrapEnv = { email: config.BOOTSTRAP_ADMIN_EMAIL, password: config.BOOTSTRAP_ADMIN_PASSWORD };
  const { app, services } = await buildApp({
    config,
    repos,
    blob,
    llm,
    logger,
    // 管理平台增量 §1：users 表为空且无 BOOTSTRAP 变量 → /readyz 503（原因见日志/响应）。
    bootstrapRequired: bootstrapReadiness(repos, bootstrapEnv),
  });

  // 管理平台增量 §1 优先级（见 bootstrap.ts 注释 + DEPLOY.md）：
  // ① bootstrap 检查先于 SEED_DEMO 播种决策（空表 + 环境变量 → 创建 default 租户 platform_admin，幂等）；
  // ② SEED_DEMO=1 才播种 demo 租户与演示账号（两者可叠加）；
  // ③ 空表 + 无变量 + 未播种 → /readyz 持续 503（BOOTSTRAP_REQUIRED）。
  await bootstrapPlatformAdmin(repos, bootstrapEnv, logger);
  // G-9 招牌演示：可登录的空世界租户（dev/demo），用于实拍「一键长出此卡」空→自动 provision→GOVERNED。
  if (config.SEED_EMPTY_TENANT === "1") {
    try {
      await seedEmptyTenant(repos);
      logger.info("SEED_EMPTY_TENANT=1: seeded loginable empty-world tenant 'fresh' (admin/demo1234) for G-9 provision demo");
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "SEED_EMPTY_TENANT=1: seed empty tenant skipped");
    }
  }
  // G-12 收口（增量B·U2）：真立非电池行业租户 logi（物流仓配·空世界·opt 已开），FDE 经 provision-world 立世界。
  if (config.SEED_OPT_INDUSTRY === "1") {
    try {
      await seedLogisticsTenant(repos, services.features);
      logger.info("SEED_OPT_INDUSTRY=1: seeded non-battery logistics tenant 'logi' (admin/demo1234, opt.* on) for G-12 two-industry demo");
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "SEED_OPT_INDUSTRY=1: seed logistics tenant skipped");
    }
  }
  if (config.SEED_DEMO === "1") {
    const adminCtx = await seedDemo(repos);
    logger.info("SEED_DEMO=1: generating battery-manufacturing synthetic dataset (seed 42)");
    await seedDemoSynthetic(services.synthetic, adminCtx);
    // 沙盘消"空世界"（审计 §3.5）：本体物化后播 sim 传导规则种子（确定性 R6，正交于电池合成）。
    await seedDemoPropagationRules(repos);
    logger.info("SEED_DEMO=1: seeded demo sim propagation rules (sandbox non-empty)");
    // G-12 收口（增量A·U1）：demo 出厂开 opt.solver-pool+opt.whatif 暗发（L3 override，出厂默认可覆盖）→
    // /a/v1/opt/* 可见，CP-SAT 这一公里在活系统可发生（接 OPTIMIZER_BASE_URL sidecar 后真求最优）。
    try {
      await seedDemoOptEntitlement(services.features, adminCtx);
      logger.info("SEED_DEMO=1: enabled demo opt.solver-pool+opt.whatif entitlement (override, revertible)");
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "SEED_DEMO=1: seed opt entitlement skipped");
    }
    // UI缺口 M3：种月度 S&OP 版本（2026-07·五步法评审态），使 /v/sop-balance 非空壳（best-effort，不阻断启动）。
    try {
      await seedDemoSopVersion(services.sop, services.solvers, adminCtx);
      logger.info("SEED_DEMO=1: seeded demo S&OP version 2026-07 (sop-balance non-empty)");
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "SEED_DEMO=1: seed S&OP version skipped");
    }
    // G-3 收尾：设了 KIMI_API_KEY 则定型 demo LLM（Kimi provider + 绑定·key 走 env 不入 git·R5），重启不丢。
    if (config.KIMI_API_KEY) {
      try {
        await seedDemoLlmProvider(services.llmProviders, adminCtx, { apiKey: config.KIMI_API_KEY, baseUrl: config.KIMI_BASE_URL, model: config.KIMI_MODEL });
        logger.info(`SEED_DEMO=1: seeded demo LLM provider Kimi (${config.KIMI_MODEL}, key from env, AES-GCM at rest)`);
      } catch (e) {
        logger.warn({ err: (e as Error).message }, "SEED_DEMO=1: seed LLM provider skipped");
      }
    }
  }

  services.scheduler.start();

  services.outbox.start(async () => {
    const tenants = await repos.tenants.listAll().catch(() => []);
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
