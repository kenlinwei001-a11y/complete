import type { AppConfig } from "./config.js";
import { ExecutionEngine } from "./engine.js";
import { TaskEvents } from "./events.js";
import { FeatureGate } from "./features/gate.js";
import { LlmSettings } from "./llm/providers.js";
import type { DataCoreProviderDirectory } from "./llm/datacore-directory.js";
import type { LlmClient } from "./llm/types.js";
import type { McpClientPort } from "./mcp/types.js";
import { Metrics } from "./metrics.js";
import type { Repos } from "./persistence/repos.js";
import { makeRefReporter, type RefReporter } from "./refs/report.js";
import { Orchestrator } from "./router/orchestrator.js";
import { CatalogService } from "./catalog/service.js";
import { PlanBuilderService } from "./plan-builder/service.js";
import { EvalService } from "./evals.js";
import type { DataCoreClient } from "./tools/clients.js";
import type { SkillResourceReader } from "./tools/skill-resources.js";

export interface AppDeps {
  config: AppConfig;
  repos: Repos;
  metrics: Metrics;
  llm: LlmClient;
  dataCore: DataCoreClient;
  mcp?: McpClientPort;
  engine: ExecutionEngine;
  events: TaskEvents;
  orchestrator: Orchestrator;
  catalog: CatalogService;
  planBuilder: PlanBuilderService;
  evals: EvalService;
  features: FeatureGate;
  llmSettings: LlmSettings;
  /** LLM Provider 增量：A 侧 provider/绑定目录（60s TTL + 事件失效）。 */
  providerDirectory?: DataCoreProviderDirectory;
  /** 引用模式增量 §2.3：B→A 引用上报（服务间凭证；未配置 = 不上报）。 */
  reportRefs?: RefReporter;
}

export function wireDeps(base: {
  config: AppConfig;
  repos: Repos;
  llm: LlmClient;
  dataCore: DataCoreClient;
  mcp?: McpClientPort;
  metrics?: Metrics;
  features?: FeatureGate;
  /** 增量 §3：read_skill_resource 内容读取端口 */
  skillResources?: SkillResourceReader;
  /** LLM Provider 增量：A 侧 provider/绑定目录 */
  providerDirectory?: DataCoreProviderDirectory;
}): AppDeps {
  const metrics = base.metrics ?? new Metrics();
  const events = new TaskEvents(base.repos);
  // mock mode (tests / no DATACORE_BASE_URL) → injectable in-memory feature set, all-on default
  const features = base.features ?? new FeatureGate({ baseUrl: base.config.DATACORE_BASE_URL });
  const llmSettings = new LlmSettings(base.repos, base.config, base.providerDirectory);
  const engine = new ExecutionEngine({
    repos: base.repos,
    metrics,
    llm: base.llm,
    dataCore: base.dataCore,
    mcp: base.mcp,
    config: base.config,
    llmSettings,
    skillResources: base.skillResources,
    features,
  });
  const orchestrator = new Orchestrator({
    repos: base.repos,
    metrics,
    config: base.config,
    engine,
    events,
    features,
    llmSettings,
  });
  const reportRefs = makeRefReporter(base.config);
  const catalog = new CatalogService(base.repos, reportRefs);
  const planBuilder = new PlanBuilderService(base.repos, catalog, base.dataCore, engine, events);
  const evals = new EvalService({ repos: base.repos, orchestrator });
  return {
    config: base.config,
    repos: base.repos,
    metrics,
    llm: base.llm,
    dataCore: base.dataCore,
    mcp: base.mcp,
    engine,
    events,
    orchestrator,
    catalog,
    planBuilder,
    evals,
    features,
    llmSettings,
    providerDirectory: base.providerDirectory,
    reportRefs,
  };
}
