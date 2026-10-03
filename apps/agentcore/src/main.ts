import { loadConfig, stdioPolicyFromConfig } from "./config.js";
import { wireDeps } from "./deps.js";
import { LlmProviderRegistry, RoutingLlmClient } from "./llm/providers.js";
import { DataCoreProviderDirectory } from "./llm/datacore-directory.js";
import { sdkMcpConnectorFactory } from "./mcp/client.js";
import { McpRuntime } from "./mcp/runtime.js";
import { Metrics } from "./metrics.js";
import { createMockDataCore } from "./mocks/clients.js";
import { distillExperienceCases, ensureScenarioPackageSeed, SEED_TENANT, seedMcpConfigs, seedRegistry, seedSceneEntries } from "./mocks/seed.js";
import { seedScenarios } from "./scenarios-catalog.js";
import { sweepInterruptedTasks, startInterruptedSweep } from "./ops/sweep.js";
import { createRepos } from "./persistence/index.js";
import { buildServer } from "./server.js";
import { auditSeededSkills } from "./skill-publish-gate.js";
import { createHttpDataCore } from "./tools/datacore-http.js";
import { LocalFsSkillResourceReader } from "./tools/skill-resources.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const repos = await createRepos(config);
  const metrics = new Metrics();

  // 场景包 + 意图 + 计划：按各自 id 幂等播种（与 workflows/skills/agents 一致），不再挂「包存在」守卫
  // —— 修复 PG 真部署「包已存在则意图永不再种 → classify 候选空 → OUT_OF_CATALOG → 探索兜底」。
  // boot 时种 demo；任意其它租户由 server.ts ensureScenarios 懒触发同一函数补齐（多租户）。
  await ensureScenarioPackageSeed(repos, SEED_TENANT);
  // 真连部署批次：B5 场景入口 + B1/B2/B4 演示注册表（缺失才播种，幂等）。
  const { agents, workflows, skills } = seedRegistry();
  for (const wf of workflows) if (!(await repos.workflows.get(wf.id))) await repos.workflows.insert(wf);
  for (const sk of skills) if (!(await repos.skills.get(sk.id))) await repos.skills.insert(sk);
  for (const ag of agents) if (!(await repos.agents.get(ag.id))) await repos.agents.insert(ag);
  // MCP 服务器演示配置（使 MCP 库页不为空）
  for (const mcp of seedMcpConfigs()) {
    if (!(await repos.mcpConfigs.get(mcp.id))) await repos.mcpConfigs.insert(mcp);
  }
  for (const scn of seedSceneEntries()) {
    if (!(await repos.sceneEntries.byView(scn.tenantId, scn.viewKey))) await repos.sceneEntries.upsert(scn);
  }
  // 场景启动器 P2：出厂 20 场景 upsert 为一等 PUBLISHED Scenario（幂等；SCENARIO_CATALOG 单一来源）。
  for (const sc of seedScenarios()) {
    if (!(await repos.scenarios.byKey(sc.tenantId, sc.scenarioKey))) await repos.scenarios.upsert(sc);
  }
  // 运营态出厂配置增量 §3：经验记忆库 50 案例（缺失才播种，幂等；search_experience 检索）
  if ((await repos.experience.listByTenant("demo")).length === 0) {
    for (const c of distillExperienceCases()) await repos.experience.upsert(c);
  }

  const dataCore = config.DATACORE_BASE_URL ? createHttpDataCore(config.DATACORE_BASE_URL) : createMockDataCore();
  // 增量 §4.1：连接生命周期运行时（http 池/退避/ERROR 状态/恢复探测；stdio 持久子进程+心跳）
  const mcp = new McpRuntime({
    repos,
    credentialKeyHex: config.CREDENTIAL_KEY,
    factory: sdkMcpConnectorFactory,
    metrics,
    stdioPolicy: stdioPolicyFromConfig(config),
  });
  // Multi-provider routing (amends QOS-PRD §6): anthropic (default) / openai /
  // openai_compatible, resolved per model spec + tenant LlmProviderConfig.
  // LLM Provider 增量 §1.1：SERVICE_TOKEN + DATACORE_BASE_URL 配齐时，provider
  // 配置/用途绑定以 DataCore 为 source of truth（60s TTL + 事件失效，密钥 5min）。
  const providerDirectory =
    config.DATACORE_BASE_URL && config.SERVICE_TOKEN
      ? new DataCoreProviderDirectory({ baseUrl: config.DATACORE_BASE_URL, serviceToken: config.SERVICE_TOKEN })
      : undefined;
  const llm = new RoutingLlmClient(new LlmProviderRegistry({ repos, config, metrics, directory: providerDirectory }));

  const skillResources = config.BLOB_DIR ? new LocalFsSkillResourceReader(config.BLOB_DIR) : undefined;
  const deps = wireDeps({ config, repos, llm, dataCore, mcp, metrics, skillResources, providerDirectory });
  const app = await buildServer(deps);

  // WO-REFGATE-ENT · F14：出厂技能一次也没过发布门 —— 上面那几行 `repos.skills.insert(sk)` 就是旁门，
  // 种子以 `status:"PUBLISHED"` 直插仓储，`POST /b/v1/skills/:id/publish` 一次都没被调用。
  // 「门装上了」于是被读成「库里的东西都过了门」，而这是两个不同的命题。
  //
  // 补法不是让启动期去打 HTTP（启动期没有 HTTP），而是让种子与发布路**共用同一份判据**
  // （`skill-publish-gate.ts`），启动时对已落库的 PUBLISHED 种子补问一遍。
  // 不阻断启动：出厂数据有问题是运维要看见的事实，不是让服务起不来的理由——
  // 事实经 **日志** + **`GET /b/v1/ops/skill-seed-gate` 诚实位** 两处外透，谁都能查。
  await auditSeededSkills({ repos, dataCore, tenantId: SEED_TENANT, logger: app.log });

  // 增量 §2-2 崩溃语义：启动扫描 EXECUTING_* 滞留 >10min 的任务 → INTERRUPTED_BY_RESTART，
  // 之后周期检查兜底（事件落库 → SSE 回放可见）。
  const swept = await sweepInterruptedTasks({ repos, events: deps.events, metrics });
  if (swept > 0) app.log.warn({ swept }, "startup sweep: stuck EXECUTING_* tasks marked INTERRUPTED_BY_RESTART");
  const stopSweep = startInterruptedSweep({ repos, events: deps.events, metrics });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "graceful shutdown");
    const timer = setTimeout(() => process.exit(1), 30_000);
    timer.unref();
    try {
      stopSweep();
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
