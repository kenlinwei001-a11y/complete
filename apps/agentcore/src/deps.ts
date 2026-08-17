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
import { probeMissingRefs } from "./resources.js";
import { HttpLlmBudget, NoopLlmBudget, type LlmBudgetPort } from "./ops/llm-budget.js";
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
  /** WO-A · 无代码 Plan Builder（画布 ↔ PlanDSL ↔ ExecutionPlan） */
  planBuilder: PlanBuilderService;
  evals: EvalService;
  features: FeatureGate;
  llmSettings: LlmSettings;
  /** LLM Provider 增量：A 侧 provider/绑定目录（60s TTL + 事件失效）。 */
  providerDirectory?: DataCoreProviderDirectory;
  /** 引用模式增量 §2.3：B→A 引用上报（服务间凭证；未配置 = 不上报）。 */
  reportRefs?: RefReporter;
  /** OC7（#92）：租户 LLM token 配额账本（服务间凭证；未配置 = Noop → 既有行为字节不变）。 */
  llmBudget: LlmBudgetPort;
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
  /** #92：注入自定义配额端口（测试用；缺省按 config 派生 Http/Noop）。 */
  llmBudget?: LlmBudgetPort;
}): AppDeps {
  const metrics = base.metrics ?? new Metrics();
  const events = new TaskEvents(base.repos);
  // mock mode (tests / no DATACORE_BASE_URL) → injectable in-memory feature set, all-on default
  // #89：fail-open（拉不到 entitlement 就放行全部功能）必须外透——接 metric，正常部署下应长期为 0。
  const features =
    base.features ??
    new FeatureGate({
      baseUrl: base.config.DATACORE_BASE_URL,
      onFailOpen: ({ reason }) => metrics.entitlementFailOpen.inc({ reason }),
    });
  // OC7（#92）：账本要有真消费方——AgentCore 才知道每次跑烧了多少 token。未配服务间凭证 → Noop（字节兼容）。
  const llmBudget: LlmBudgetPort =
    base.llmBudget ??
    (base.config.DATACORE_BASE_URL && base.config.SERVICE_TOKEN
      ? new HttpLlmBudget({ baseUrl: base.config.DATACORE_BASE_URL, serviceToken: base.config.SERVICE_TOKEN })
      : new NoopLlmBudget());
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
    llmBudget,
  });
  const reportRefs = makeRefReporter(base.config);
  // WO-PUBLISH-REFPROBE：探针端口在此**唯一**捆定实现（`resources.ts probeMissingRefs`）——
  // 三个 `publishPlan` 调用方（catalog 路由 / publish-chain / plan-builder）由此共享同一道门，
  // 谁都不必自己记得接线。用端口而非直接 import：见 `catalog/service.ts PlanRefProbe` 处的循环依赖实测。
  const catalog = new CatalogService(
    base.repos,
    (ctx, want) => probeMissingRefs(base.dataCore, ctx, want),
    reportRefs,
  );
  const planBuilder = new PlanBuilderService(base.repos, catalog, base.dataCore, engine, events);
  const evals = new EvalService({ repos: base.repos, orchestrator, engine });
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
    llmBudget,
  };
}
