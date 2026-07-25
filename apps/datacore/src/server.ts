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
import { seedDemo, seedDemoSynthetic, seedDemoPropagationRules, seedDemoEntitlements, DEMO_TENANT } from "./seed.js";

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
  // #5 首启预热闸（Codespaces 健康检查耗尽定位）：先 listen 再后台播种；播种期间 /readyz 503(reason:"seeding")。
  const readiness = { seeding: config.SEED_DEMO === "1" };
  const { app, services } = await buildApp({
    config,
    repos,
    blob,
    llm,
    logger,
    // 管理平台增量 §1：users 表为空且无 BOOTSTRAP 变量 → /readyz 503（原因见日志/响应）。
    bootstrapRequired: bootstrapReadiness(repos, bootstrapEnv),
    seeding: () => readiness.seeding,
  });

  // #5 定位/修：原先「先播种（pg 演示数据 ~487s）再 listen」→ 端口全程 down，Codespaces 慢盘下超 start_period →
  // healthcheck 连不上而耗尽重试 → agentcore depends_on service_healthy 永不触发（级联挂）。
  // 改为「先 listen 让端口即刻可探活，播种移到后台」——播种期间 /readyz 报 503 reason:"seeding"，
  // 编排方在预热窗内正确等待，不再"端口 down"耗尽。
  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info({ port: config.PORT }, "datacore listening (预热中 · /readyz 待播种完成)");

  try {
    // 管理平台增量 §1 优先级（见 bootstrap.ts 注释 + DEPLOY.md）：
    // ① bootstrap 检查先于 SEED_DEMO 播种决策（空表 + 环境变量 → 创建 default 租户 platform_admin，幂等）；
    // ② SEED_DEMO=1 才播种 demo 租户与演示账号（两者可叠加）；
    // ③ 空表 + 无变量 + 未播种 → /readyz 持续 503（BOOTSTRAP_REQUIRED）。
    await bootstrapPlatformAdmin(repos, bootstrapEnv, logger);
    if (config.SEED_DEMO === "1") {
      const adminCtx = await seedDemo(repos);
      logger.info("SEED_DEMO=1: generating battery-manufacturing synthetic dataset (seed 42)");
      await seedDemoSynthetic(services.synthetic, adminCtx);
      // 沙盘消"空世界"（审计 §3.5）：本体物化后播 sim 传导规则种子（确定性 R6，正交于电池合成）。
      await seedDemoPropagationRules(repos);
      logger.info("SEED_DEMO=1: seeded demo sim propagation rules (sandbox non-empty)");
      // WO-LIGHTUP：生产 demo 点亮 5 个 QOS 暗发功能（DRIL/反思/free-llm/coordinator/compose-path）——仅生产播种路径，不入基座 seedDemo。
      await seedDemoEntitlements(repos);
      logger.info("SEED_DEMO=1: lit up demo QOS dark-launch features (dril/critic/free-llm/coordinator/compose)");
    }
  } finally {
    readiness.seeding = false; // 预热完成（成/败均放行 → /readyz 落到 bootstrap 检查·失败则 main().catch 退出）
  }
  logger.info("datacore 预热完成 · /readyz ready");

  services.scheduler.start();

  services.outbox.start(async () => {
    const tenants = await repos.tenants.listAll().catch(() => []);
    const ids = new Set<string>([DEMO_TENANT, ...tenants.map((t) => t.id)]);
    return [...ids];
  });

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
