import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import multipart from "@fastify/multipart";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { pino, type Logger } from "pino";
import { z } from "zod";
import { AggregateRequestSchema, BuildRunBodySchema, BuildWorkflowStartBodySchema, ClockTickBodySchema, PlanSliceRequestSchema, CrossValidateRequestSchema, DataBuilderConfigSchema, ImportBundleBodySchema, MetaAccessPolicyBodySchema, PROMPT_KEYS, PLATFORM_PROMPT_DEFAULTS, PutPromptTemplateBodySchema, PutLlmBudgetBodySchema, RecordUsageBodySchema, PutCalendarBodySchema, ReconcileBodySchema, QueryTimeseriesAggInputSchema, StoryInputsBodySchema, StoryRunRequestSchema, StressBodySchema, SyntheticJobBodySchema, ValidateOutputBodySchema, ValidationPolicySchema, IngestModeSchema } from "@platform/contracts";
import { validateOutputAgainstOntology } from "./ontology-validate.js";
import type { Config } from "./config.js";
import type { Repos } from "./repo/repo.js";
import type { BlobStore } from "./blob.js";
import type { LlmClient } from "./llm.js";
import { Metrics } from "./metrics.js";
import { AppError, forbidden, notFound, unauthorized, validationError } from "./errors.js";
import { newId } from "./ids.js";
import { annotateRequestId } from "./tracing.js";
import { CredentialCipher } from "./crypto.js";
import { AuthService } from "./auth.js";
import { AuthzService } from "./authz.js";
import { OutboxService } from "./outbox.js";
import { AuditService } from "./audit.js";
import { ExecutionLockService } from "./execlock.js";
import { QuarantineService } from "./quarantine.js";
import { MetaOntologyService } from "./meta/service.js";
import { NotificationService } from "./notifications.js";
import { EntityResolutionService } from "./entity-resolution.js";
import { CatalogService } from "./catalog.js";
import { VleService } from "./vle.js";
import { RulesService, assertValidExpression } from "./rules.js";
import { LlmProviderService, TenantRoutedLlmClient, registerLlmProviderRoutes } from "./llmproviders.js";
import { registerAdminPlatformRoutes } from "./adminplatform.js";
import { OntologyService } from "./ontology.js";
import { OntologyCoreService } from "./ontology-core.js";
import { WorkflowService, type AgentScaffoldClient } from "./pipeline/service.js";
import { OntologyGovernanceService, UNIT_DICTIONARY } from "./ontology-governance.js";
import { ConnectorService } from "./connectors/service.js";
import { CONNECTOR_TYPES, connectorCategories, hasAdapter } from "./connectors/registry.js";
import { planSlice } from "./ontology/slice-planner.js";
import { resolveFieldRoles } from "./solvers/field-roles.js";
import { parsePrototypeHtml, reconcileIntake, type ExistingTypeField } from "./databuilder/prototype-intake.js";
import { IntakeRequestSchema, IntakeImportRequestSchema, IntakeObjectifyRequestSchema, ReconcileResolveBodySchema } from "@platform/contracts";
import { classifySourceOrigin } from "@platform/contracts";
import xlsx from "node-xlsx";
import { BootstrapRequestSchema, type BootstrapStep, type BootstrapReport } from "@platform/contracts";
import { RetentionTableSchema, RETENTION_DEFAULTS } from "@platform/contracts"; // WO-RETENTION（⑤·数据留存/TTL）
import { AuditSinkInputSchema, type AuditSink } from "@platform/contracts"; // WO-ENTERPRISE-DR-AUDIT（sub-B·外部审计 SIEM sink）
import { OntologyBindingSchema, OptPerturbationSchema } from "@platform/contracts"; // 轨B·增量2/3 绑定层 + what-if
import { SolverBindingSchema } from "@platform/contracts"; // B3·G-17：canonical 求解器 role→租户真实类型/字段绑定
import { CreateDecisionSchema, RecordOutcomeSchema } from "@platform/contracts"; // WO-DECISION-RECORD（§3.7 D8）
import { SimilarityQuerySchema } from "@platform/contracts"; // WO-L1.5-2（企业记忆 CBR·相似检索查询）
import { DeriveBatchRequestSchema, OntologyImportBundleSchema, ScenarioImportRequestSchema, WorldSourceSchema } from "@platform/contracts"; // WO-IMPORT-MULTITABLE (G1) / WO-IMPORT-ONTOLOGY (G2) / WO-IMPORT-SCENARIO (G3) / WO-IMPORT-REPLACE-SYNTHETIC (G4)
import { PreviewSourceRefSchema } from "@platform/contracts"; // WO-MERGE-03 C1（pipeline preview 经 databuilder 取样来源引用）
import { retrieveSimilarCases, mineDecisionPatterns } from "./memory/decision-case.js"; // WO-L1.5-2/4（CBR 检索·§4.2 / 模式挖掘·§4.4⑥）
import { DecisionKernelService } from "./decision/service.js"; // WO-L2-4（决策内核服务·接真 in-process 求解器）
import { CaseIngestService } from "./memory/case-ingest.js"; // WO-L1.5-3（案例摄取·Decision→DecisionCase 旁挂）
import { OntologyWorkflowUpsertSchema, GenericInferenceInputSchema } from "@platform/contracts"; // WO-MERGE-01（OntoFlow 移植）
import { LocalTemplateIndex } from "./solvers/opt-embedding.js"; // 轨B·增量4 embedding 复用检索（advisory）
import { PropagationRuleSchema, SandboxViewConfigSchema, type DelayedContribution, type HorizonCoverage, type PropagationRule, type PropagationTrace, type SimCheckpoint, type SimDataMode, type SimSession, type TickState } from "@platform/contracts";
// S3 branch-inject（WO-SANDBOX-BRANCH-INJECT）：应对注入 + 决策维差量契约。
import { SimMitigationSchema, DecisionDimSchema, type DecisionDim, type CompareDecisionValue, type CompareDecisionVerdict } from "@platform/contracts";
import { propagateTick, type PropagationGraph, type RuleParamLookup } from "./sim/propagation.js";
// S3 branch-inject：compare 决策维经 S6 SimContextOverlay 在各分支模拟末态上真算（buildSimSolverContext·非原始态 diff）。
import { buildSimSolverContext, OVERLAYABLE_CONTEXT_ARRAYS } from "./sim/context-overlay.js";
import { deriveCertification, DEFAULT_CERT_CONFIG, DEFAULT_SANDBOX_HEAT_THRESHOLD, type CertScope, type TrialTickInput } from "./sim/certification.js";
import { resolveExogenousFeeds, type FeedResolveSources, type FeedSpec } from "./sim/exogenous-feed.js";
import { replayPropagationRules, buildDailyStatesFromSeries, DEFAULT_REPLAY_WINDOW, type ReplaySeriesLike } from "./sim/replay-validate.js";
import { validateClosure } from "./databuilder/closure.js";
import { selfCheckGaps } from "./databuilder/selfcheck.js";
import type { BuildPlan, ClosurePolicy } from "@platform/contracts";
import { buildSliceIndex, lookupReusable, lookupReusableByQuestion } from "./ontology/slice-index.js";
import { deriveSliceLibrary, libEntryToSpec } from "./ontology/slice-library.js";
import { RuleDocService } from "./ruledocs.js";
import { ModelingService } from "./modeling.js";
import { SyntheticService } from "./synthetic/service.js";
import { loadIndustryPack } from "./synthetic/industry-pack.js";
import { buildDataTemplate, buildDataTemplates } from "./synthetic/data-template.js";
import { buildIntakeCoverage } from "./intake-coverage.js";
import { dataCategoriesForIndustry } from "./synthetic/data-categories.js";
import { computeFieldCoverage, computeCategoryCoverage } from "./databuilder/slice-coverage.js";
import { BUILTIN_INDUSTRY_TEMPLATES } from "./synthetic/builtin-templates.js";
import { buildFieldCatalog, resolveEntity, searchCatalog } from "./databuilder/entity-catalog.js";
import { deriveViewPullTargets, checkPullTargetCoverage, unmetPullTargets } from "./databuilder/pull-target.js";
import { diffNeeds, type CapabilityInventory } from "./databuilder/capability-inventory.js";

const CapabilityNeedsSchema = z.object({
  objectTypes: z.array(z.string()).optional(),
  rules: z.array(z.string()).optional(),
  solvers: z.array(z.string()).optional(),
  slices: z.array(z.string()).optional(),
});
import { LivedInEngine } from "./livedin/engine.js";
import { SolverService, SOLVER_KEYS, SOLVER_OUTPUT_SHAPES } from "./solvers/service.js";
import { HttpOptimizerClient } from "./solvers/optimizer-client.js";
import { OPT_MODEL_TEMPLATES } from "./solvers/opt-templates.js";
import { assertBindingGrounded, type BindingOntologyView } from "./solvers/opt-binding.js"; // 增量E：落库前 DF.8 接地校验
import { assertSolverBindingGrounded, suggestSolverBindings } from "./solvers/solver-binding.js"; // B3·G-17：SolverBinding 落库接地 + 自动建议草案
import { TimeseriesService } from "./timeseries.js";
import { SchedulerService, RuleScanService } from "./scheduler.js";
import { RetentionService } from "./retention.js";
import { AuditSinkService } from "./audit-sink.js"; // WO-ENTERPRISE-DR-AUDIT（sub-B·外部审计 SIEM sink）
import { ActionService, type ActionExecutor } from "./actions.js";
import { buildWritebackAdapter } from "./writeback.js";
import { DecisionService } from "./decisions.js";
import { SopService } from "./sop.js";
import { PlanService } from "./planviews.js";
import { CalibrationService } from "./calibration/index.js";
import { buildDataHealth } from "./datahealth.js";
import { buildMappingRows, buildMappingRegistries } from "./mapping.js";
import { GRAPH_DOMAIN, GRAPH_EXTRA_EDGES, GRAPH_EXTRA_NODES, SOLVER_GRAPH, BUSINESS_DOMAINS } from "./graphmeta.js";
import { parseAggregate } from "./ontology.js";
import { KbService } from "./kb.js";
import { DataBuilderService } from "./databuilder/service.js";
import { buildRegistrySnapshot } from "./databuilder/provisioners.js";
import { SimClockService } from "./simclock.js";
import { HistoryService } from "./livedin/bundle.js";
import { FeatureService, VIEW_FEATURE_MAP, RETIRED_VIEW_KEYS, featureNotFound } from "./features.js";
import { ConfigBundleService } from "./config-bundle.js";
import { createEmbeddingProvider, type EmbeddingProvider } from "./embeddings.js";
import { OpsTeamService } from "./opsteam/team.js";
import { OpsScheduleService } from "./opsteam/schedule.js";
import { OpsReplayService } from "./opsteam/replay.js";
import { poolSnapshot } from "./opsteam/pools.js";
import { OpsScheduleSchema } from "@platform/contracts";
import { BOUNDARY_IMPACT, boundaryVersion } from "@platform/contracts";
import type { AuthCtx, ObjectInstance } from "./domain.js";
import { mulberry32, hashString, randInt } from "./prng.js";

declare module "fastify" {
  interface FastifyRequest {
    authCtx?: AuthCtx;
  }
}

export interface AppDeps {
  config: Config;
  repos: Repos;
  blob: BlobStore;
  llm: LlmClient;
  metrics?: Metrics;
  logger?: Logger;
  fetchImpl?: typeof fetch;
  /** 管理平台增量 §1：返回非 null 原因 → /readyz 503（users 空表 + 无 BOOTSTRAP 变量）。 */
  bootstrapRequired?: () => Promise<string | null>;
}

export interface BuiltApp {
  app: FastifyInstance;
  services: {
    auth: AuthService;
    authz: AuthzService;
    outbox: OutboxService;
    execLocks: ExecutionLockService;
    quarantine: QuarantineService;
    notifications: NotificationService;
    catalog: CatalogService;
    vle: VleService;
    rules: RulesService;
    ontology: OntologyService;
    ontologyCore: OntologyCoreService;
    governance: OntologyGovernanceService;
    connectors: ConnectorService;
    ruleDocs: RuleDocService;
    modeling: ModelingService;
    synthetic: SyntheticService;
    metrics: Metrics;
    solvers: SolverService;
    timeseries: TimeseriesService;
    scheduler: SchedulerService;
    retention: RetentionService;
    ruleScan: RuleScanService;
    actions: ActionService;
    databuilder: DataBuilderService;
    sop: SopService;
    kb: KbService;
    simclock: SimClockService;
    features: FeatureService;
    configBundle: ConfigBundleService;
    embeddings: EmbeddingProvider;
    plan: PlanService;
    calibration: CalibrationService;
    llmProviders: LlmProviderService;
    livedin: LivedInEngine;
    history: HistoryService;
    opsTeam: OpsTeamService;
    opsSchedule: OpsScheduleService;
    opsReplay: OpsReplayService;
  };
}

const LoginSchema = z.object({
  tenantId: z.string().default("demo"),
  username: z.string().min(1),
  password: z.string().min(1),
});

const ObjectsQuerySchema = z.object({
  objectType: z.string().min(1),
  filter: z.record(z.string(), z.unknown()).default({}),
  limit: z.number().int().positive().max(1000).default(100),
  // 并发一致性 §13.1：任务级快照读（工具层注入 taskEpoch）。
  asOfEpoch: z.number().int().nonnegative().optional(),
});

const EvaluateSchema = z.object({
  ruleIds: z.union([z.array(z.string()), z.literal("ALL_APPLICABLE")]),
  payload: z.record(z.string(), z.unknown()),
});

const RuleCreateSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  expression: z.string(),
  scopeObjectTypes: z.array(z.string()).default([]),
  severity: z.enum(["BLOCK", "WARN", "INFO"]),
  // WO-18：规则类型（评估规则 / 约束条件）。约束条件就是规则的一种，同库管理同被引用。缺省 evaluation（向后兼容）。
  ruleType: z.enum(["evaluation", "constraint"]).optional(),
  // 规则即引用（PRD-rules-as-references §2.2/§4）：命名阈值随 create/update 透传到 RulesService（服务层早已支持 params，
  // 此前路由 schema 漏列 → zod 默认 strip → 编辑器改 params 静默丢失；P3-a 编辑闭环必需，断点在路由接缝）。
  params: z.record(z.string(), z.number()).optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
});

const ConnectionCreateSchema = z.object({
  connectorTypeKey: z.string().min(1),
  name: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
  schedule: z.object({ cron: z.string() }).optional(),
  /** A11 per-connection 归类：缺省取连接器类型 category，可覆盖、可自定义值（R14 不锁死枚举）。 */
  category: z.string().optional(),
});

const ReviewSchema = z.object({
  action: z.enum(["APPROVE", "EDIT_APPROVE", "REJECT"]),
  patch: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      expression: z.string().optional(),
      scopeObjectTypes: z.array(z.string()).optional(),
      severity: z.enum(["BLOCK", "WARN", "INFO"]).optional(),
    })
    .optional(),
});

const SuggestSchema = z.object({ rawDatasetIds: z.array(z.string()).min(1) });

const DraftPatchSchema = z.object({ operations: z.array(z.record(z.string(), z.unknown())).min(1) });

const ExplainSchema = z.object({
  user: z
    .object({
      userId: z.string().optional(),
      roles: z.array(z.string()),
      attributes: z.record(z.string(), z.unknown()).default({}),
    })
    .optional(),
  resource: z.object({
    kind: z.enum(["OBJECT_TYPE", "CONNECTION", "RULE_SET", "ACTION_TYPE"]),
    key: z.string(),
  }),
  op: z.enum(["READ", "WRITE", "EXECUTE"]).default("READ"),
});

const WebhookSchema = z.object({ url: z.string().url(), events: z.array(z.string()).default([]) });

const ActionDraftSchema = z.object({
  actionTypeKey: z.string().min(1).optional(),
  /** legacy alias kept for QOS create_action_draft callers */
  actionType: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  origin: z.object({ taskId: z.string().optional(), agentId: z.string().optional() }).optional(),
  /** false → stay in DRAFT (暂存草稿); default true submits immediately */
  submit: z.boolean().optional(),
});

const RuleDocJsonSchema = z.object({
  filename: z.string().min(1),
  contentBase64: z.string().min(1),
});

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw validationError(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

/** OC9 净生产天数：from..to（含端点）逐日，扣周末（weekendMode）+ 节假日/检修（exceptions），加班日补回。 */
function netProductionDays(from: string, to: string, cal: { weekendMode: string; exceptions: { date: string; kind: string }[] } | undefined): number {
  const wm = cal?.weekendMode ?? "SAT_SUN_OFF";
  const holidays = new Set((cal?.exceptions ?? []).filter((e) => e.kind === "HOLIDAY" || e.kind === "MAINTENANCE").map((e) => e.date));
  const extra = new Set((cal?.exceptions ?? []).filter((e) => e.kind === "EXTRA_WORKDAY").map((e) => e.date));
  let n = 0;
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = new Date(`${from}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    let off = wm === "SAT_SUN_OFF" ? dow === 0 || dow === 6 : wm === "SUN_OFF" ? dow === 0 : false;
    if (extra.has(iso)) off = false;
    if (holidays.has(iso)) off = true;
    if (!off) n++;
  }
  return n;
}

export async function buildApp(deps: AppDeps): Promise<BuiltApp> {
  const { config, repos, blob, llm } = deps;
  const metrics = deps.metrics ?? new Metrics();
  const logger =
    deps.logger ??
    pino({ level: config.LOG_LEVEL, base: undefined, timestamp: pino.stdTimeFunctions.isoTime });

  const auth = new AuthService(repos, config.ACCESS_TOKEN_TTL_SEC, config.REFRESH_TOKEN_TTL_SEC);
  await auth.init();
  const authz = new AuthzService(repos);
  const outbox = new OutboxService(repos, logger, deps.fetchImpl, metrics);
  const audit = new AuditService(repos, outbox); // WO-AUDIT-OBS：统一 append-only 审计写入器
  const execLocks = new ExecutionLockService(repos, metrics);
  const quarantine = new QuarantineService(repos);
  const metaOntology = new MetaOntologyService(repos, outbox);
  const notifications = new NotificationService(repos);
  const entityResolution = new EntityResolutionService(repos, outbox);
  const rules = new RulesService(repos, outbox);
  const solvers = new SolverService(repos);
  const ontology = new OntologyService(repos, authz, outbox, solvers, metrics);
  const ontologyCore = new OntologyCoreService(repos, authz);
  solvers.setOntologyCore(ontologyCore); // generic_inference 求解器走本体 recompute（G-5 通用 what-if）
  solvers.setAuthz(authz); // WO-2：A6 行级过滤求解器读出层（与 query_objects 同一套策略引擎）
  solvers.setLlm(llm); // A18.2 LLM 临时求解器生成
  solvers.setOutbox(outbox); // A18.2 solver.provisional_generated 事件
  solvers.setAudit(audit); // WO-MULTISRC-FUSION：多源融合仲裁/测谎经统一 append-only 审计留痕（WO-AUDIT-OBS）
  if (process.env.OPTIMIZER_BASE_URL) {
    // selection_optimize 走自托管 CP-SAT sidecar（OR-Tools, Apache-2.0）；数据不出边界。未配置则该求解器报"未接入"。
    solvers.setOptimizer(new HttpOptimizerClient(process.env.OPTIMIZER_BASE_URL));
  }
  const timeseries = new TimeseriesService(repos, authz, outbox);
  const features = new FeatureService(repos, audit);
  const configBundle = new ConfigBundleService(repos, features);
  const catalog = new CatalogService(repos, features);
  const governance = new OntologyGovernanceService(repos, authz, ontology, ontologyCore, features, metrics, outbox);
  const cipher = new CredentialCipher(config.CREDENTIAL_KEY);
  const connectors = new ConnectorService(repos, blob, cipher, metrics, deps.fetchImpl ?? fetch);
  // LLM Provider 增量 §1：provider 配置落位 A；A2/A3/A7 调用方经租户用途路由消费
  const llmProviders = new LlmProviderService(repos, cipher, outbox);
  const routedLlm = new TenantRoutedLlmClient(repos, cipher, llm, metrics);
  const embeddings = createEmbeddingProvider(
    {
      kind: config.EMBEDDING_PROVIDER,
      baseUrl: config.EMBEDDING_BASE_URL,
      model: config.EMBEDDING_MODEL,
      dim: config.EMBEDDING_DIM,
      apiKeyEnv: config.EMBEDDING_API_KEY_ENV,
    },
    process.env,
    deps.fetchImpl ?? fetch,
  );
  const ruleDocs = new RuleDocService(repos, blob, routedLlm, rules, metrics, config.DC_LLM_MODEL, embeddings, execLocks, config.EXECUTION_SINGLETON);
  const modeling = new ModelingService(repos, routedLlm, ontology, metrics, config.DC_LLM_MODEL, quarantine);
  const synthetic = new SyntheticService(repos, routedLlm, ontology, rules, metrics, config.DC_LLM_MODEL, timeseries);
  // V5 双算注入：把被测 solvers.invoke 以回调注入 VLE（vle.ts 不 import solvers/service，V9 静态门守）。
  const vle = new VleService(repos, synthetic, ontology, (c, key, args) => solvers.invoke(c, key, args));
  const actions = new ActionService(repos, rules, outbox, notifications);
  const ruleScan = new RuleScanService(repos, timeseries, outbox);
  const scheduler = new SchedulerService(repos, logger.child({ component: "scheduler" }) as Logger);
  // WO-RETENTION（⑤·数据留存/TTL）：留存策略解析 + RETENTION_SWEEP 清理。
  const retention = new RetentionService(repos, logger.child({ component: "retention" }) as Logger, metrics);
  // WO-ENTERPRISE-DR-AUDIT（sub-B）：外部审计 SIEM sink（复用 append-only audit_log 馈源·secret 加密·旁路推 NDJSON）。
  const auditSink = new AuditSinkService(
    repos,
    cipher,
    logger.child({ component: "audit-sink" }) as Logger,
    metrics,
    deps.fetchImpl ?? fetch,
  );
  const sop = new SopService(repos, solvers, outbox);
  const kb = new KbService(repos, authz, blob, embeddings);
  const databuilder = new DataBuilderService(repos, ontology, rules, connectors, kb, solvers, outbox, routedLlm, config.DC_LLM_MODEL, config.DC_COMPREHEND_DETERMINISTIC === "1");
  const simclock = new SimClockService(repos, timeseries, ontology, ruleScan, solvers, outbox);
  const plan = new PlanService(repos, solvers, rules, outbox);
  const calibration = new CalibrationService(repos, outbox, solvers);
  // WO-L1.5-3（案例摄取·暗发 QOS_CBR_INGEST）：Decision 达终态 → 投影 DecisionCase 落库 + 发 decision_case.learned。
  const caseIngest = new CaseIngestService(repos, outbox, () => config.QOS_CBR_INGEST === "1");
  // WO-DECISION-RECORD（PRD §3.7 D8）：一等 Decision 记录服务（上下文/备选/否决/决策人/预测 vs 实现）
  const decisions = new DecisionService(repos, outbox, (c, d) => caseIngest.ingestFromDecision(c, d));
  // WO-L2-4/5（决策内核服务）：接真 in-process SolverService + 沿因果重算·装配落库 DecisionPackage·发域事件；
  // 采纳经 DecisionService/ActionService 正门（R4·不直写真值）。
  const decisionKernel = new DecisionKernelService(repos, solvers, outbox, decisions, actions, ontologyCore);
  // 运营态出厂配置增量 §1：回放引擎（生成+回放，复用真实 A8 管线 + M11 配对）
  const livedInEngine = new LivedInEngine(repos, timeseries, ontology, ruleScan, rules);
  livedInEngine.setCalibrationTicker(async (tenantId) => calibration.onTick(tenantId));
  // §5 历史查询面（bundle / watermark / live-ingest），行级权限同 A6
  const history = new HistoryService(repos, authz);
  // cross-wiring (kept out of constructors to avoid dependency cycles)
  synthetic.wire({
    scheduler,
    features,
    actions,
    ts: timeseries,
    // 轨L 增量2：注入建模链（modeling 在 synthetic 之前构造），供 demo 本体经真链产出。
    modeling,
    livedInRunner: async (c, input) => {
      const state = await livedInEngine.run(c, input);
      return { replay: state.replay };
    },
  });
  connectors.wire({ ts: timeseries, scheduler });
  simclock.setResetRunner(async (c, spec) => synthetic.runJob(c, spec));
  // §7.21: C12 → calibration.required → 提案生成（与降级/告警共用同一扫描路径）
  ruleScan.setCalibrationHook(async (tenantId, entityId) => calibration.onCalibrationRequired(tenantId, entityId));
  // ── WO-ALERT (D6 §3.7 主动决策推送) ────────────────────────────────────────────
  // 复用既有 RULE_SCAN 调度 + outbox + NotificationService：决策阈值命中越线 → 联 mitigation_select
  // 出处置建议 → 发 decision.alert（NOTIFY 层）+ push 待办（PUSH 替纯 PULL）。不直写真值（R4）。
  ruleScan.setDecisionPushHooks({
    mitigate: async (tenantId, { factor, baseName }) => {
      // 系统态 ctx（与 calibration system ctx 同款）；mitigation_select 经 deriveExtendedArgs 自动注入
      // canonical 方案库（params.risk.mitigations）→ LIVE 真案；确定性 R6、租户隔离 R2。
      const sysCtx = { tenantId, userId: "system:rule-scan", roles: ["admin"], attributes: {} };
      try {
        const out = await solvers.invoke(sysCtx, "mitigation_select", { factor, baseName });
        const recommended = typeof out.recommended === "string" ? out.recommended : undefined;
        const plans = Array.isArray(out.plans) ? (out.plans as { key?: string; name?: string }[]) : [];
        const recommendedName = plans.find((p) => p.key === recommended)?.name;
        return {
          recommended,
          recommendedName,
          urgency: typeof out.urgency === "number" ? out.urgency : undefined,
          draftPayload: (out.draftPayload as Record<string, unknown> | undefined) ?? undefined,
        };
      } catch {
        return null; // 求解失败诚实降级：仍发告警 + 待办（不带建议），不阻断扫描
      }
    },
    notify: async (tenantId, { role, title, body, refType, refId }) => {
      // notifyRole 扇出给该角色全部 ACTIVE 用户（系统发起，无 excludeUserId）。
      await notifications.notifyRole(tenantId, role, undefined, { kind: "decision_alert", title, body, refType, refId });
    },
  });
  // ──────────────────────────────────────────────────────────────────────────────
  // M11 §1: tick 聚合后配对 + 元闭环（在 RULE_SCAN 之前 —— C12 命中即有新配对可消费）
  simclock.setCalibrationTicker(async (tenantId) => calibration.onTick(tenantId));
  // S2 写回适配器（WO-ACTUATE）：领域 Action（AOP情景拍板 / 校准参数变更 / S&OP / 对象数据变更）
  // 真实落库；其余决策走 config 选择的出站写回适配器（默认 mock·自动 echo 闭环；erp_rest=真 ERP stub）。
  const outboundAdapter: ActionExecutor = buildWritebackAdapter(
    config.WRITEBACK_TARGET,
    repos,
    config.WRITEBACK_ERP_BASE_URL,
  );
  const domainExecutor: ActionExecutor = {
    kind: outboundAdapter.kind,
    async execute(draft) {
      if (draft.actionTypeKey === "AOP情景拍板") {
        const r = await plan.applyFinalize(draft.tenantId, draft);
        return { ok: true, targetRef: r.targetRef };
      }
      if (draft.actionTypeKey === "校准参数变更") {
        const r = await calibration.applyAction(draft.tenantId, draft);
        return { ok: true, targetRef: r.targetRef };
      }
      // 增量 §7.12：S&OP 定稿/变更经 Action 真实落库（EXECUTED → FINAL / inputs patch）。
      if (draft.actionTypeKey === "定稿月度计划版本") {
        const r = await sop.applyFinalizeAction(draft.tenantId, draft);
        return { ok: true, targetRef: r.targetRef };
      }
      if (draft.actionTypeKey === "计划版本变更" && typeof draft.payload.versionId === "string") {
        const r = await sop.applyChangeAction(draft.tenantId, draft);
        if (r) return { ok: true, targetRef: r.targetRef };
      }
      // Phase9B 对象级数据变更：审批通过后把 patch 合并进对象 props（origin→MANUAL 标记人工改），
      // 再重跑派生 → 之后 resolve_slice/invoke_solver 即「二次推演」。Action 审计=完整溯源。
      if (draft.actionTypeKey === "对象数据变更") {
        const objectId = String(draft.payload.objectId ?? "");
        const patch = (draft.payload.patch ?? {}) as Record<string, unknown>;
        const obj = await repos.objects.get(draft.tenantId, objectId);
        if (!obj) return { ok: false, error: `object not found: ${objectId}` };
        await repos.objects.put({ ...obj, props: { ...obj.props, ...patch }, origin: { type: "MANUAL" } });
        const sysCtx: AuthCtx = { tenantId: draft.tenantId, userId: "system:action", roles: ["admin"], attributes: {} };
        await ontology.runDerivations(sysCtx);
        return { ok: true, targetRef: `OBJ-${objectId}` };
      }
      return outboundAdapter.execute(draft);
    },
  };
  actions.setExecutor(domainExecutor);

  // ---- 回放编排器与虚拟操作团队（replay-orchestrator） ----------------------
  const opsTeam = new OpsTeamService(repos, config.FORGE_ALLOW_PROD === "1");
  const opsSchedule = new OpsScheduleService(repos, scheduler, solvers, outbox, actions);
  opsSchedule.setSop(sop);
  // §1 随运营态合成创建虚拟团队 + §2 默认剧本（仅 SYNTHETIC 租户；隔离在 opsTeam 内守卫）。
  livedInEngine.setOpsTeamSeeder(async (tenantId) => {
    await opsTeam.seedDefaultPersonas(tenantId);
    await opsTeam.seedDefaultPlaybook(tenantId);
  });
  // §3-① ask 经 AgentCore QOS（HTTP）；未配置 AGENTCORE_BASE_URL 则 ask 跳过。
  const fetchImpl = deps.fetchImpl ?? fetch;
  // g8-P3 跨系统 scaffold（A→B）：closure 后把 B 栈需求下发 AgentCore；未配 AGENTCORE_BASE_URL/SERVICE_TOKEN 则跳过。
  if (config.AGENTCORE_BASE_URL && config.SERVICE_TOKEN) {
    const agentBase = config.AGENTCORE_BASE_URL;
    const svcToken = config.SERVICE_TOKEN;
    databuilder.setScaffoldClient(async (manifest) => {
      try {
        const res = await fetchImpl(`${agentBase}/b/v1/internal/scaffold`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-service-token": svcToken },
          body: JSON.stringify(manifest),
        });
        if (!res.ok) return undefined;
        return (await res.json()) as import("@platform/contracts").ScaffoldReceipt;
      } catch {
        return undefined; // 网络抖动/连接失败 → 跳过（A 栈构建不受影响）
      }
    });
  }
  const debugHeaderFor = (a: AuthCtx): string =>
    encodeURIComponent(a.tenantId) + ":" + encodeURIComponent(a.userId) + ":" + a.roles.map(encodeURIComponent).join("|");
  // g8 §9 归一：建域后推演回填经 AgentCore QOS orchestrator 实跑（growth/probe submit→等终态→分类），
  // 而非直调求解器——"建出来的域真能在 QOS 跑通"的活证据（绿测试≠能用）。未配 AGENTCORE_BASE_URL 则
  // runInference 兜底直调求解器并标 BUILD_STATIC。
  if (config.AGENTCORE_BASE_URL) {
    const agentBase = config.AGENTCORE_BASE_URL;
    databuilder.setInferenceProbe(async (c, question) => {
      try {
        const res = await fetchImpl(`${agentBase}/api/v1/growth/probe`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-debug-user": debugHeaderFor(c) },
          body: JSON.stringify({ packageId: "pkg_battery_manufacturing", query: question, context: { view: "dash", selectedObjects: [], filters: {} } }),
        });
        if (!res.ok) return undefined;
        const gap = (await res.json()) as { verdict: string; findings?: { gapCode: string }[] };
        const answerable = gap.verdict === "ANSWERABLE";
        return { answer: answerable ? "问句可答（全链跑通）" : `断在 ${gap.findings?.[0]?.gapCode ?? gap.verdict}`, answerable };
      } catch {
        return undefined; // 网络抖动/连接失败 → 降级兜底（不阻断建域）
      }
    });
  }
  // WO-MERGE-01 B2：OntoFlow scaffold 跨系统落库客户端（A→B·OBO x-debug-user）。
  // 配置 AGENTCORE_BASE_URL 时：scaffold 生成的 Agent 真 create→publish（AgentCore 发布门探针要求 scope 对象类型
  // 在 DataCore 本体存在 —— OntoFlow publish 已先落 types，故满足）→ 场景入口 PUT（AGENT_FIRST 引用已发布 Agent）。
  // 未配置或任一步失败 → scaffold 记 persisted.deferred（诚实回执，绝不伪造已落库·KILL-MOCK-RED）。
  let agentScaffoldClient: AgentScaffoldClient | undefined;
  if (config.AGENTCORE_BASE_URL) {
    const agentBase = config.AGENTCORE_BASE_URL;
    agentScaffoldClient = {
      async push(ctx, item) {
        const oboHdr = { "x-debug-user": debugHeaderFor(ctx) };
        const jsonHdr = { "content-type": "application/json", ...oboHdr };
        try {
          // 1) 幂等：找同 key Agent（已发布→复用；DRAFT→续用其 id）；否则 create（DRAFT）。
          let agentId: string | undefined;
          let published = false;
          const listRes = await fetchImpl(`${agentBase}/b/v1/agents`, { headers: oboHdr });
          if (listRes.ok) {
            const agents = (await listRes.json()) as { id: string; key: string; status: string }[];
            const same = agents.filter((a) => a.key === item.agentKey);
            const pub = same.find((a) => a.status === "PUBLISHED");
            if (pub) { agentId = pub.id; published = true; }
            else agentId = same.find((a) => a.status === "DRAFT")?.id;
          }
          if (!agentId) {
            const createBody = {
              key: item.agentKey,
              name: item.agentTitle,
              description: "OntoFlow scaffold 生成的默认助手（通用工具 + 最小授权对象类型）",
              model: "",
              systemPrompt:
                item.systemPrompt && item.systemPrompt.trim()
                  ? item.systemPrompt
                  : `你负责本体实体「${item.typeKey}」。用通用工具在其对象上作答与推演，业务数字一律取工具真值。`,
              tools: item.tools.map((name) => ({ kind: "BUILTIN", name })),
              ruleBindings: { ruleKeys: [] as string[], mode: "POST_CHECK" },
              skills: [],
              mcpServers: [],
              scopeDeclaration: { objectTypes: item.objectTypes, toolNames: item.tools },
            };
            const cr = await fetchImpl(`${agentBase}/b/v1/agents`, { method: "POST", headers: jsonHdr, body: JSON.stringify(createBody) });
            if (!cr.ok) return { error: `agent create ${cr.status}` };
            agentId = ((await cr.json()) as { id: string }).id;
          }
          // 2) publish（幂等：已发布跳过；发布门校验失败 → 诚实报 error，不伪造）。
          if (!published) {
            const pr = await fetchImpl(`${agentBase}/b/v1/agents/${agentId}/publish`, { method: "POST", headers: jsonHdr, body: "{}" });
            if (!pr.ok) return { error: `agent publish ${pr.status}` };
            const pj = (await pr.json()) as { ok?: boolean; errors?: { message: string }[] };
            if (pj.ok === false) return { error: `agent publish rejected: ${(pj.errors ?? []).map((e) => e.message).join("; ")}` };
            published = true;
          }
          // 3) 场景入口（AGENT_FIRST·引用已发布 Agent·幂等 PUT by viewKey）。
          const sceneBody = {
            mode: "AGENT_FIRST",
            defaultAgentId: agentId,
            uiHints: { placeholder: `就「${item.sceneTitle}」提问`, suggestedQuestions: [] as string[] },
          };
          const sr = await fetchImpl(`${agentBase}/b/v1/scene-entries/${encodeURIComponent(item.sceneViewKey)}`, { method: "PUT", headers: jsonHdr, body: JSON.stringify(sceneBody) });
          if (!sr.ok) return { agentPushed: item.agentKey, error: `scene-entry ${sr.status}` };
          return { agentPushed: item.agentKey, scenePushed: item.sceneViewKey };
        } catch (e) {
          return { error: `agentcore unreachable: ${(e as Error).message}` };
        }
      },
    };
  }
  // WO-MERGE-03 C1：注入 databuilder 引擎取样能力（pipeline 画布节点级"接入"协同·非替代 runProcessing）。
  const workflows = new WorkflowService(repos, ontology, ontologyCore, agentScaffoldClient, {
    sampleRows: (c, ref, limit) => databuilder.sampleSourceRows(c, ref, limit),
  });
  const opsReplay = new OpsReplayService({
    actions,
    sop,
    solvers,
    resolvePersona: (tenantId, username) => opsTeam.resolvePersonaCtx(tenantId, username),
    ask: config.AGENTCORE_BASE_URL
      ? async (persona, input) => {
          try {
            const res = await fetchImpl(`${config.AGENTCORE_BASE_URL}/b/v1/queries`, {
              method: "POST",
              headers: { "content-type": "application/json", "x-debug-user": debugHeaderFor(persona) },
              body: JSON.stringify({
                packageId: "pkg_battery_manufacturing",
                query: input.query,
                context: { view: input.view, selectedObjects: [], filters: {}, conversationId: input.conversationId },
              }),
            });
            if (!res.ok) {
              if (res.status >= 500) throw Object.assign(new Error(`agentcore ${res.status}`), { statusCode: res.status });
              return null;
            }
            const body = (await res.json()) as { taskId?: string };
            return body.taskId ? { taskId: body.taskId } : null;
          } catch (err) {
            const e = err as { statusCode?: number };
            if (e.statusCode && e.statusCode >= 500) throw err;
            return null; // 网络抖动/连接失败 → 跳过（非错误）
          }
        }
      : null,
    listPendingDrafts: async (tenantId) => {
      const drafts = await repos.actionDrafts.list(tenantId, (d) => d.status === "PENDING_APPROVAL");
      return drafts.map((d) => ({ id: d.id, originUserId: d.origin.userId }));
    },
    listFallbackClusters: async () => [],
    promoteIntent: config.AGENTCORE_BASE_URL
      ? async (persona, traceId) => {
          try {
            const res = await fetchImpl(`${config.AGENTCORE_BASE_URL}/b/v1/ops/fallback/${traceId}/promote`, {
              method: "POST",
              headers: { "content-type": "application/json", "x-debug-user": debugHeaderFor(persona) },
              body: "{}",
            });
            if (!res.ok) return null;
            const body = (await res.json()) as { intentId?: string };
            return body.intentId ? { intentId: body.intentId } : null;
          } catch {
            return null;
          }
        }
      : null,
    adoptMitigation: async (base, approver, payload) => {
      // 经真实 S2：base persona 发起 adopt_mitigation → approver persona 审批 → EXECUTED。
      const draft = await actions.create(base, { actionTypeKey: "adopt_mitigation", payload, submit: true });
      const decided = await actions.approve(approver, draft.id);
      return { draftId: draft.id, status: decided.status };
    },
    // 执行语义 §4：opKey 幂等记录（7d）接 repos（R1：replay.ts 不直接 import 仓储）。
    idempotency: {
      get: async (tenantId, opKey) => {
        const rec = await repos.idempotencyRecords.get(tenantId, `replay|${opKey}`);
        if (!rec || rec.expiresAt < new Date().toISOString()) return undefined;
        return rec.responseDigest as unknown as import("@platform/contracts").OpsTickReport["executed"][number];
      },
      put: async (tenantId, opKey, exec) => {
        const now = Date.now();
        await repos.idempotencyRecords.put({
          id: `replay|${opKey}`,
          tenantId,
          scope: "replay",
          responseDigest: exec as unknown as Record<string, unknown>,
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 7 * 24 * 60 * 60_000).toISOString(),
        });
      },
    },
    log: (level, msg, meta) => logger[level](meta ?? {}, msg),
  });
  // §3-① 挂载到模拟时钟第⑦步（仅 SYNTHETIC 租户挂剧本）。
  simclock.setOpsPlaybookRunner(async ({ tenantId, tick, date, seed, scenarioEvents }) => {
    if (!(await opsTeam.isSyntheticTenant(tenantId))) return; // 隔离：真实租户不挂剧本
    const playbook = await opsTeam.getPlaybook(tenantId);
    if (!playbook) return;
    // 执行语义 §4：回放进度检查点——已完成的 tick 重入时跳过（动作经 opKey 幂等去重兜底）。
    const progressId = `replay|${tenantId}`;
    const progress = await repos.replayProgress.get(tenantId, progressId);
    if (progress && tick <= progress.lastCompletedTick) return;
    const report = await opsReplay.runTick(tenantId, playbook, { tick, date, seed, scenarioEvents });
    await repos.opsTickReports.put({
      id: `ops_tick_${tenantId}_${tick}`,
      tenantId,
      tick: report.tick,
      date: report.date,
      executed: report.executed,
      skipped: report.skipped,
      createdAt: new Date().toISOString(),
    });
    await repos.replayProgress.put({
      id: progressId,
      tenantId,
      lastCompletedTick: tick,
      updatedAt: new Date().toISOString(),
    });
  });
  // §6 S3 调度器三类作业 handler（真实租户运营自动化）。
  scheduler
    .on("SCHEDULED_FORECAST", async (tenantId, refId) => opsSchedule.runScheduledForecast(tenantId, refId))
    .on("SOP_AUTO_OPEN", async (tenantId) => {
      await opsSchedule.runSopAutoOpen(tenantId);
    })
    .on("APPROVAL_REMINDER", async (tenantId) => {
      await opsSchedule.runApprovalReminder(tenantId);
    });

  const systemCtx = (tenantId: string): AuthCtx => ({ tenantId, userId: "system", roles: ["admin"], attributes: {} });
  // WO-PIPE-INCR ②：连接器同步完成 → 发 connection.sync_completed 事件（闭 DL9 断链：此前该事件被前端订阅却从不产出）
  // + 真实变更（changedRows>0）触发派生重算，使同步进来的新数据自动流入对象/派生（数据→本体链自动化）。
  connectors.wire({
    onSyncCompleted: async (tenantId, info) => {
      await outbox.emit(tenantId, "connection.sync_completed", {
        connId: info.connId,
        datasets: info.datasets,
        rowCounts: info.rowCounts,
        watermarks: info.watermarks,
        incremental: info.incremental,
        changedRows: info.changedRows,
        // WO-PIPE-INCR ③：删除墓碑——上游删的行已按 pk 移除；事件带删除计数供下游知"有删除"也须刷新/重算。
        deletedRows: info.deletedRows,
        deletedCounts: info.deletedCounts,
      });
      // changedRows>0（含删除墓碑：deltaCount 计入墓碑行）或确有删除 → 触发派生重算，使删除传播到对象/派生。
      if (info.changedRows > 0 || info.deletedRows > 0) {
        try {
          await ontology.runDerivations(systemCtx(tenantId));
        } catch (err) {
          logger.warn({ err, connId: info.connId, tenantId }, "sync→派生重算失败（非致命：同步已成功）");
        }
      }
    },
  });
  scheduler
    .on("CONNECTOR_SYNC", async (tenantId, refId) => {
      // WO-PIPE-INCR ②：调度自动续传——每数据集用自身已存 watermark 作 since，增量同步而非每次全量重灌。
      await connectors.sync(systemCtx(tenantId), refId, { auto: true });
    })
    .on("DERIVATION_FULL", async (tenantId) => {
      await ontology.runDerivations(systemCtx(tenantId));
    })
    .on("RULE_SCAN", async (tenantId) => {
      await ruleScan.scan(tenantId);
      // §7.14: 情景触发条件后端判定（前端只读挂牌表）
      await plan.scanTriggers(tenantId);
      // C2: 长协执行偏差 |dev|>5% → supply_risk 事件
      await plan.scanSupplyRisk(tenantId);
    })
    .on("TS_AGGREGATE", async (tenantId) => {
      await timeseries.runAggregation(tenantId);
    })
    // M11 §3 兜底定时：每周全量校准（即使未触发 C12，温和漂移也被周期性收口）
    .on("CALIBRATION_RUN", async (tenantId) => {
      await calibration.runAll(tenantId, "CALIBRATION_RUN");
    })
    // WO-E1（校准活体常态化）：更频繁的活体清扫——每轮 runAll + 逐轮收敛度落库（越用越准可见·R2）。
    .on("CALIBRATION_SWEEP", async (tenantId) => {
      await calibration.sweep(tenantId, "CALIBRATION_SWEEP");
    })
    // WO-RETENTION（⑤）：每日清理过期+已处理的无界增长行（outbox/ts/scheduler_runs·R2 限本租户）。
    .on("RETENTION_SWEEP", async (tenantId) => {
      await retention.sweep(tenantId);
    })
    // WO-ENTERPRISE-DR-AUDIT（sub-B）：增量把 append-only audit_log 以 NDJSON 旁路推送到外部 SIEM sink。
    // flush 内部吞投递失败（不抛）→ 旁路不阻断主写/主 sweep·下次按 sinceAt 续投。
    .on("AUDIT_SINK_FLUSH", async (tenantId) => {
      await auditSink.flush(tenantId);
    });

  /** Entitlement middleware helper: bound feature off → 404 FEATURE_NOT_FOUND (before authz). */
  const requireFeatureTag = async (req: FastifyRequest, kind: "solverKeys" | "apiTags", value: string) => {
    const tenantId = req.authCtx?.tenantId;
    if (!tenantId) throw unauthorized();
    await features.requireByBinding(tenantId, kind, value);
  };

  // pino Logger satisfies FastifyBaseLogger at runtime; generics differ across pino majors.
  const httpLogger = logger.child({ component: "http" }) as unknown as FastifyBaseLogger;
  const app: FastifyInstance = Fastify({
    loggerInstance: httpLogger,
    // WO-AUDIT-OBS：跨服务追踪——优先复用入站 `x-request-id`（AgentCore 出站透传），无则生成。
    // 使同一 requestId 贯穿 AgentCore 日志 → DataCore 日志 → 错误信封，一线可追。
    genReqId: (req) => {
      const inbound = req.headers["x-request-id"];
      const v = Array.isArray(inbound) ? inbound[0] : inbound;
      return typeof v === "string" && v.length > 0 && v.length <= 200 ? v : newId("req");
    },
    bodyLimit: 100 * 1024 * 1024,
  });
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });
  await app.register(cookie);
  // 经网关同源访问时无需 CORS；开放宽松 CORS 仅为直连端口的开发调试（credentials 模式）。
  // 显式列全方法：默认仅 GET/HEAD/POST → PATCH/PUT/DELETE 预检被拒（归域/行内编辑等直连端口失效）。
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // Unified error envelope { error: { code, message, requestId } }.
  app.setErrorHandler((err: unknown, req, reply) => {
    const requestId = req.id as string;
    if (err instanceof AppError) {
      return reply
        .status(err.statusCode)
        .send({ error: { code: err.code, message: err.message, requestId } });
    }
    const e = err as { statusCode?: unknown; code?: unknown; message?: unknown };
    const status = typeof e.statusCode === "number" && e.statusCode >= 400 ? e.statusCode : 500;
    const code = status === 500 ? "INTERNAL_ERROR" : typeof e.code === "string" ? e.code : "BAD_REQUEST";
    if (status === 500) req.log.error({ err }, "unhandled error");
    return reply
      .status(status)
      .send({ error: { code, message: String(e.message ?? "error"), requestId } });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({ error: { code: "NOT_FOUND", message: "route not found", requestId: req.id as string } }),
  );

  // ---- auth hook ------------------------------------------------------------
  const PUBLIC_PATHS = new Set([
    "/healthz",
    "/readyz",
    "/metrics",
    "/a/v1/auth/login",
    "/a/v1/auth/refresh",
    "/a/v1/auth/logout",
    "/a/v1/healthz",
    "/a/v1/readyz",
    "/a/v1/.well-known/jwks.json",
  ]);

  // WO-OBSERVABILITY (OBS-2)：传播桥接——把人读 requestId 挂到 HTTP root span 的 attr `app.request_id`，
  // 使日志里的 requestId 可在 trace 后端定位到 trace（traceId↔requestId 关联）。入站若带 W3C traceparent，
  // OTel HTTP instrumentation 已自动续 trace；这里只补关联键，不替换 requestId spine。
  app.addHook("onRequest", async (req: FastifyRequest) => {
    annotateRequestId(req.id as string);
  });

  app.addHook("onRequest", async (req: FastifyRequest, _reply: FastifyReply) => {
    if (req.method === "OPTIONS") return; // CORS preflight
    const path = req.url.split("?")[0] as string;
    if (PUBLIC_PATHS.has(path)) return;
    if (!path.startsWith("/a/")) return;
    // LLM Provider 增量 §1.1 服务间凭证：X-Service-Token === env SERVICE_TOKEN →
    // roles=["service"]（仅服务间路由消费该角色；未配置 SERVICE_TOKEN 则恒不命中）。
    const svcToken = req.headers["x-service-token"];
    if (config.SERVICE_TOKEN && typeof svcToken === "string" && svcToken === config.SERVICE_TOKEN) {
      const tid = req.headers["x-tenant-id"];
      if (typeof tid !== "string" || tid.length === 0) throw validationError("X-Tenant-Id header required for service calls");
      req.authCtx = { tenantId: tid, userId: "svc:" + String(req.headers["x-service-caller"] ?? "unknown"), roles: ["service"], attributes: {} };
      return;
    }
    const debugHeader = req.headers["x-debug-user"];
    if (config.NODE_ENV !== "production" && typeof debugHeader === "string") {
      req.authCtx = await auth.debugCtx(debugHeader);
      return;
    }
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      req.authCtx = await auth.verifyAccessToken(authHeader.slice(7));
      return;
    }
    throw unauthorized();
  });

  app.addHook("onResponse", async (req) => {
    req.log.info(
      { requestId: req.id, tenantId: req.authCtx?.tenantId, method: req.method, url: req.url },
      "request completed",
    );
  });

  const ctx = (req: FastifyRequest): AuthCtx => {
    if (!req.authCtx) throw unauthorized();
    // WO-AUDIT-OBS：把贯穿两系统的 requestId 挂上 ctx，供审计写入器/服务层落库与日志同源。
    if (req.authCtx.requestId === undefined) req.authCtx.requestId = req.id as string;
    return req.authCtx;
  };

  // ---- meta -------------------------------------------------------------------
  app.get("/healthz", async () => ({ status: "ok" }));
  const readyz = async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      await repos.ping();
    } catch {
      return reply.status(503).send({ status: "not ready" });
    }
    // 管理平台增量 §1：空库且未配置 BOOTSTRAP 变量 → 503 + 明示原因（日志同步报错）。
    const reason = deps.bootstrapRequired ? await deps.bootstrapRequired() : null;
    if (reason) {
      logger.error({ reason }, "readyz blocked: bootstrap required");
      return reply.status(503).send({ status: "not ready", reason });
    }
    return { status: "ready" };
  };
  app.get("/readyz", readyz);
  app.get("/metrics", async (_req, reply) => reply.type("text/plain").send(metrics.render()));
  // 网关前缀别名（gateway 只反代 /a/v1/* → 经代理探活用）
  app.get("/a/v1/healthz", async () => ({ status: "ok" }));
  app.get("/a/v1/readyz", readyz);

  // ---- A0 IAM -------------------------------------------------------------------
  // 前端 PRD §4.1：refresh token 走 httpOnly cookie（Path 限定 /a/v1/auth）；body 透传保持向后兼容。
  const setRefreshCookie = (reply: FastifyReply, refreshToken: string) =>
    reply.setCookie("refresh_token", refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/a/v1/auth",
      maxAge: config.REFRESH_TOKEN_TTL_SEC,
    });
  app.post("/a/v1/auth/login", async (req, reply) => {
    const body = parseBody(LoginSchema, req.body);
    const pair = await auth.login(body.tenantId, body.username, body.password);
    setRefreshCookie(reply, pair.refreshToken);
    return pair;
  });
  app.post("/a/v1/auth/refresh", async (req, reply) => {
    const body = parseBody(z.object({ refreshToken: z.string().min(1).optional() }), req.body);
    const token = body.refreshToken ?? req.cookies["refresh_token"];
    if (!token) throw unauthorized("missing refresh token (cookie or body)");
    const pair = await auth.refresh(token);
    setRefreshCookie(reply, pair.refreshToken);
    return pair;
  });
  app.post("/a/v1/auth/logout", async (_req, reply) => {
    reply.clearCookie("refresh_token", { path: "/a/v1/auth" });
    return { ok: true };
  });
  app.get("/a/v1/.well-known/jwks.json", async () => auth.jwks());

  // 平台 PRD §6.1 + contracts WorkspaceSchema（前端真连对齐批次）。
  const SCENARIO_PACKAGE_NAMES: Record<string, string> = {
    pkg_battery_manufacturing: "电池制造场景包",
    "battery-manufacturing": "电池制造场景包",
  };
  /** 路由守卫别名：view.{viewKey} 形式补充进 features（/v/:viewKey 直接查 view.graph 等）。 */
  const withRouteFeatureAliases = (feats: string[]): string[] => {
    const out = new Set(feats);
    if (out.has("view.ontology-graph")) out.add("view.graph");
    if (out.has("view.risk-board")) out.add("view.risk");
    if (out.has("view.ledger")) out.add("view.order");
    // GRAPH-PANORAMA-ONLY：view.graph-{persp} 别名随八视角退役删除（RETIRED_FEATURE_KEYS 防幽灵）。
    return [...out].sort();
  };
  app.get("/a/v1/me/workspace", async (req) => {
    const c = ctx(req);
    const tenant = await repos.tenants.get(c.tenantId, c.tenantId);
    const user = await repos.users.get(c.tenantId, c.userId);
    const baseRoles = c.roles.map((r) => r.split(":")[0] as string);
    const configs = await repos.viewConfigs.list(c.tenantId, (v) =>
      baseRoles.includes(v.role) || c.roles.includes(v.role),
    );
    // Entitlement: navigation/views are filtered server-side by the resolved feature set.
    const resolved = await features.resolveForUser(c);
    const enabled = new Set(resolved.features);
    // 管理平台增量 §3：手建视图的动态功能键 view.{viewKey}（删除视图 → 功能注销 → 导航消失）。
    const dynamicViewFeatures = await features.dynamicKeys(c.tenantId);
    const viewAllowed = (key: string) => {
      if (RETIRED_VIEW_KEYS.has(key)) return false; // GRAPH-PANORAMA-ONLY 防幽灵：旧库残留 ViewConfig 不下发
      const fk = VIEW_FEATURE_MAP[key] ?? (dynamicViewFeatures.has(`view.${key}`) ? `view.${key}` : undefined);
      return !fk || enabled.has(fk);
    };
    // merge per-role configs (admin 多角色取并集，按 key 去重，admin 配置优先)
    const viewMap = new Map<string, (typeof configs)[number]["views"][number]>();
    for (const v of configs.flatMap((vc) => vc.views)) {
      if (viewAllowed(v.key) && !viewMap.has(v.key)) viewMap.set(v.key, v);
    }
    const views = [...viewMap.values()].map((v) => ({
      viewKey: v.key,
      name: v.title,
      renderer: v.renderer ?? v.key,
      layout: v.layout ?? {},
      options: v.options ?? {},
      // legacy aliases（旧前端 VM 消费 key/title）
      key: v.key,
      title: v.title,
    }));
    const navMap = new Map<string, { key: string; label: string; viewKey?: string; group: "business" | "admin" }>();
    for (const n of configs.flatMap((vc) => vc.navigation)) {
      const group = n.group ?? "business";
      if (group === "business" && !viewAllowed(n.viewKey ?? n.key)) continue;
      if (!navMap.has(`${group}:${n.key}`)) {
        navMap.set(`${group}:${n.key}`, { key: n.key, label: n.label, viewKey: n.viewKey ?? (group === "business" ? n.key : undefined), group });
      }
    }
    const navigation = [...navMap.values()];
    const scenarioPackages = [...new Set(configs.flatMap((v) => v.scenarioPackages))].map((p) => ({
      id: p,
      name: SCENARIO_PACKAGE_NAMES[p] ?? p,
    }));
    // R-PACK/R14：前端 ViewPage 以 `view.<key>` 严格门控（缺则 404）；后端 `viewAllowed` 对**无显式 feature**
    // 的视图宽松放行（返回进 views）。二者需对齐——**凡服务端已下发进 workspace.views 的视图即视为已授权**，
    // 故把其 `view.<key>` 并入下发 features（换行业 pack 驱动的自有视图无需在 FEATURE_REGISTRY 逐个登记·0 码改）。
    // 关闭某视图 → viewAllowed=false → 不进 views → 其 view.<key> 也不并入 → 前端仍 404（entitlement 语义不破）。
    const seededViewFeatureKeys = views.map((v) => `view.${v.key}`);
    const theme = Object.fromEntries(
      Object.entries(configs[0]?.theme ?? {}).map(([k, v]) => [k, String(v)]),
    );
    return {
      tenant: { id: c.tenantId, name: tenant?.name ?? c.tenantId, industry: tenant?.industry },
      user: {
        id: c.userId,
        username: user?.username ?? c.userId,
        roles: c.roles,
        attributes: { ...c.attributes, ...(user?.attributes ?? {}) },
      },
      scenarioPackages,
      views,
      theme,
      navigation,
      features: withRouteFeatureAliases([...new Set([...resolved.features, ...seededViewFeatureKeys])]),
      configVersion: resolved.configVersion,
    };
  });

  // SCENARIO-PACK-SCOPE（治启动器跨行业泄漏·G-3 邻域）：下发**本租户所属行业包**及其自带决策场景卡。
  // 据 tenant.industry 解析 IndustryPack（loadIndustryPack·单一来源；缺配置→平台默认电池，同 provision-world 口径）。
  // AgentCore 启动器目录据此按 pack 作用域播种：电池 scenarios=[] → 走既有 SCENARIO_CATALOG（byte-unchanged R6）；
  // 非电池（物流）→ 下发 pack.scenarios → 启动器只显本行业卡，零电池泄漏。OBO 用户 token 即可读（本租户自身配置）。
  app.get("/a/v1/scenarios/pack", async (req) => {
    const c = ctx(req);
    const tenant = await repos.tenants.get(c.tenantId, c.tenantId);
    const industryKey = (tenant?.industry as string) || "battery-manufacturing";
    const pack = loadIndustryPack(industryKey);
    // WO-IMPORT-SCENARIO (G3) + LAUNCHER-WIRE：本租户导入场景卡合入场景包（pack 默认 + 导入·同键导入覆盖 pack 默认）→
    // AgentCore 启动器目录经此 seam 消费导入场景。LAUNCHER-WIRE：把 G3 解析的 targetView/selectedObjects/slotPresets
    // 一并随 IndustryScenario 下发（presetContext 经 scenarioFromPackScenario 传卡面·一键推演 PRD §3.3）。
    const importedScenarios = (await repos.importedScenarios.list(c.tenantId)).map((r) => ({
      ...r.scenario,
      targetView: r.targetView,
      selectedObjects: r.resolvedObjects,
      slotPresets: r.slotPresets,
    }));
    const packScenarios = pack?.scenarios ?? [];
    const importedKeys = new Set(importedScenarios.map((s) => s.key));
    const scenarios = [...packScenarios.filter((s) => !importedKeys.has(s.key)), ...importedScenarios];
    return { industryKey, scenarios };
  });

  // ---- A6 authz -------------------------------------------------------------------
  app.post("/a/v1/authz/explain", async (req) => {
    const c = ctx(req);
    const body = parseBody(ExplainSchema, req.body);
    const target: AuthCtx = body.user
      ? {
          tenantId: c.tenantId,
          userId: body.user.userId ?? c.userId,
          roles: body.user.roles,
          attributes: body.user.attributes,
        }
      : c;
    const result = await authz.explain(target, body.resource.kind, body.resource.key, body.op);
    // 前端 PRD §7.9 调试器消费形态：matched[{policyId,resource,grants}] + rowFilter（保留原字段）
    return {
      ...result,
      matched: result.matchedPolicies.map((p) => ({
        policyId: p.id,
        resource: `${p.resource.kind}:${p.resource.key}`,
        grants: p.grants.map((g) => `${g.role}:${g.ops.join("/")}`).join(", "),
      })),
      rowFilter: result.effectiveRowFilter,
    };
  });

  // OC3 环境间配置迁移 + 跨系统 Saga（execution-semantics §3 / OC3）。admin only。
  app.get("/a/v1/config-bundles/export", async (req) => {
    const c = ctx(req);
    if (!c.roles.some((r) => r.split(":")[0] === "admin")) throw forbidden("admin only");
    return configBundle.export(c);
  });
  app.post("/a/v1/config-bundles/import", async (req) => {
    const c = ctx(req);
    if (!c.roles.some((r) => r.split(":")[0] === "admin")) throw forbidden("admin only");
    const body = ImportBundleBodySchema.parse(req.body);
    return configBundle.import(c, body.bundle, body.dryRun, body.conflictPolicy);
  });

  // OC6 平台内置提示词配置化：平台默认 + 租户 override（按租户可改）。admin only。
  const resolvePrompt = async (tenantId: string, key: (typeof PROMPT_KEYS)[number]) => {
    const ov = await repos.promptTemplates.get(tenantId, `pt_${tenantId}_${key}`);
    return ov
      ? { key, template: ov.template, source: "TENANT_OVERRIDE" as const, version: ov.version }
      : { key, template: PLATFORM_PROMPT_DEFAULTS[key], source: "PLATFORM_DEFAULT" as const, version: 0 };
  };
  app.get("/a/v1/prompt-templates", async (req) => {
    const c = ctx(req);
    if (!c.roles.some((r) => r.split(":")[0] === "admin")) throw forbidden("admin only");
    return { items: await Promise.all(PROMPT_KEYS.map((k) => resolvePrompt(c.tenantId, k))) };
  });
  app.get("/a/v1/prompt-templates/:key/resolve", async (req) => {
    const c = ctx(req);
    if (!c.roles.some((r) => r.split(":")[0] === "admin")) throw forbidden("admin only");
    const key = (req.params as { key: string }).key as (typeof PROMPT_KEYS)[number];
    if (!PROMPT_KEYS.includes(key)) throw notFound("prompt key");
    return resolvePrompt(c.tenantId, key);
  });
  app.put("/a/v1/prompt-templates/:key", async (req) => {
    const c = ctx(req);
    if (!c.roles.some((r) => r.split(":")[0] === "admin")) throw forbidden("admin only");
    const key = (req.params as { key: string }).key as (typeof PROMPT_KEYS)[number];
    if (!PROMPT_KEYS.includes(key)) throw notFound("prompt key");
    const body = PutPromptTemplateBodySchema.parse(req.body);
    const id = `pt_${c.tenantId}_${key}`;
    const prev = await repos.promptTemplates.get(c.tenantId, id);
    const rec = { id, tenantId: c.tenantId, key, template: body.template, version: (prev?.version ?? 0) + 1, updatedAt: new Date().toISOString(), updatedBy: c.userId };
    await repos.promptTemplates.put(rec);
    return rec;
  });

  const mustAdmin = (c: AuthCtx) => { if (!c.roles.some((r) => r.split(":")[0] === "admin")) throw forbidden("admin only"); };

  // OC7 LLM 成本配额与降级（租户级 token 配额 + 软/硬线）。admin only。
  const budgetStatus = (b: { hardLimitTokens: number; softLimitPct: number; usedTokens: number } | undefined) => {
    const hard = b?.hardLimitTokens ?? 0;
    const soft = Math.floor(hard * (b?.softLimitPct ?? 0.8));
    const used = b?.usedTokens ?? 0;
    const state = hard > 0 && used >= hard ? "HARD_EXCEEDED" : hard > 0 && used >= soft ? "SOFT_EXCEEDED" : "OK";
    return { usedTokens: used, hardLimitTokens: hard, softLimitTokens: soft, state, degrade: state !== "OK" } as const;
  };
  app.get("/a/v1/llm-budgets", async (req) => { const c = ctx(req); mustAdmin(c); return budgetStatus(await repos.llmBudgets.get(c.tenantId, `lbg_${c.tenantId}`)); });
  app.put("/a/v1/llm-budgets", async (req) => {
    const c = ctx(req); mustAdmin(c);
    const body = PutLlmBudgetBodySchema.parse(req.body);
    const prev = await repos.llmBudgets.get(c.tenantId, `lbg_${c.tenantId}`);
    const rec = { id: `lbg_${c.tenantId}`, tenantId: c.tenantId, hardLimitTokens: body.hardLimitTokens, softLimitPct: body.softLimitPct ?? prev?.softLimitPct ?? 0.8, periodStart: prev?.periodStart ?? new Date().toISOString(), usedTokens: prev?.usedTokens ?? 0, updatedAt: new Date().toISOString() };
    await repos.llmBudgets.put(rec); return budgetStatus(rec);
  });
  app.post("/a/v1/llm-budgets/record", async (req) => {
    const c = ctx(req); mustAdmin(c);
    const body = RecordUsageBodySchema.parse(req.body);
    const prev = await repos.llmBudgets.get(c.tenantId, `lbg_${c.tenantId}`);
    const rec = { id: `lbg_${c.tenantId}`, tenantId: c.tenantId, hardLimitTokens: prev?.hardLimitTokens ?? 0, softLimitPct: prev?.softLimitPct ?? 0.8, periodStart: prev?.periodStart ?? new Date().toISOString(), usedTokens: (prev?.usedTokens ?? 0) + body.tokens, updatedAt: new Date().toISOString() };
    await repos.llmBudgets.put(rec); return budgetStatus(rec);
  });

  // OC9 工厂日历 + 净生产窗口扣减（节假日/检修扣除）。admin only。
  app.get("/a/v1/calendars/:key", async (req) => {
    const c = ctx(req); mustAdmin(c); const key = (req.params as { key: string }).key;
    return (await repos.factoryCalendars.get(c.tenantId, `cal_${c.tenantId}_${key}`)) ?? { id: `cal_${c.tenantId}_${key}`, tenantId: c.tenantId, calendarKey: key, weekendMode: "SAT_SUN_OFF", exceptions: [], updatedAt: "" };
  });
  app.put("/a/v1/calendars/:key", async (req) => {
    const c = ctx(req); mustAdmin(c); const key = (req.params as { key: string }).key;
    const body = PutCalendarBodySchema.parse(req.body);
    const prev = await repos.factoryCalendars.get(c.tenantId, `cal_${c.tenantId}_${key}`);
    const rec = { id: `cal_${c.tenantId}_${key}`, tenantId: c.tenantId, calendarKey: key, weekendMode: body.weekendMode ?? prev?.weekendMode ?? "SAT_SUN_OFF", exceptions: body.exceptions ?? prev?.exceptions ?? [], updatedAt: new Date().toISOString() };
    await repos.factoryCalendars.put(rec); return rec;
  });
  app.get("/a/v1/calendars/:key/net-window", async (req) => {
    const c = ctx(req); mustAdmin(c); const key = (req.params as { key: string }).key;
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) throw validationError("from/to required (YYYY-MM-DD)");
    const cal = await repos.factoryCalendars.get(c.tenantId, `cal_${c.tenantId}_${key}`);
    return { calendarKey: key, from, to, netProductionDays: netProductionDays(from, to, cal) };
  });

  // OC5 写回回声抑制 + 不一致告警。admin only。
  // WO-ACTUATE：列出当前 pending 写回回声（mock 适配器 EXECUTED 后自动落，供对账/可视）。R2 租户隔离。
  app.get("/a/v1/writeback-echoes", async (req) => {
    const c = ctx(req); mustAdmin(c);
    const { ref, actionId } = req.query as { ref?: string; actionId?: string };
    const items = (await repos.writebackEchoes.list(c.tenantId, (e) =>
      (ref ? e.ref === ref : true) && (actionId ? e.actionId === actionId : true),
    )).sort((a, b) => (a.writtenAt < b.writtenAt ? 1 : -1));
    return { items };
  });
  app.post("/a/v1/writeback-echoes", async (req) => {
    const c = ctx(req); mustAdmin(c);
    const b = req.body as { ref: string; writtenValue: unknown; actionId: string };
    const rec = { id: newId("wbe"), tenantId: c.tenantId, ref: b.ref, writtenValue: b.writtenValue, writtenAt: new Date().toISOString(), actionId: b.actionId };
    await repos.writebackEchoes.put(rec); return rec;
  });
  app.post("/a/v1/writeback-echoes/reconcile", async (req) => {
    const c = ctx(req); mustAdmin(c);
    const body = ReconcileBodySchema.parse(req.body);
    const pending = (await repos.writebackEchoes.list(c.tenantId, (e) => e.ref === body.ref)).sort((a, b) => (a.writtenAt < b.writtenAt ? 1 : -1))[0];
    if (!pending) return { verdict: "NO_PENDING_WRITEBACK", ref: body.ref, incomingValue: body.incomingValue };
    const echo = JSON.stringify(pending.writtenValue) === JSON.stringify(body.incomingValue);
    if (echo) { await repos.writebackEchoes.remove(c.tenantId, pending.id); return { verdict: "ECHO_SUPPRESSED", ref: body.ref, writtenValue: pending.writtenValue, incomingValue: body.incomingValue }; }
    await outbox.emit(c.tenantId, "writeback.divergence", { ref: body.ref, written: pending.writtenValue, incoming: body.incomingValue });
    return { verdict: "DIVERGENCE", ref: body.ref, writtenValue: pending.writtenValue, incomingValue: body.incomingValue };
  });

  // 执行语义增量 §2：Outbox 死信列表 + 手动重投（中台可见）
  app.get("/a/v1/outbox/dead", async (req) => {
    const c = ctx(req);
    if (!c.roles.some((r) => r.split(":")[0] === "admin")) throw forbidden("admin only");
    const dead = await outbox.listDead(c.tenantId);
    return {
      items: dead.map((e) => ({
        id: e.id,
        eventId: e.eventId,
        event: e.event,
        aggregateKey: e.aggregateKey,
        seq: e.seq,
        attempts: e.attempts,
        lastError: e.lastError,
        createdAt: e.createdAt,
      })),
    };
  });
  app.post("/a/v1/outbox/:id/redeliver", async (req, reply) => {
    const c = ctx(req);
    if (!c.roles.some((r) => r.split(":")[0] === "admin")) throw forbidden("admin only");
    const { id } = req.params as { id: string };
    const ok = await outbox.redeliver(c.tenantId, id);
    if (!ok) throw notFound("dead-letter event not found");
    return reply.send({ ok: true });
  });
  // 执行语义增量 §1：执行锁可观测（当前持锁/租约/fence）
  app.get("/a/v1/exec-locks", async (req) => {
    const c = ctx(req);
    if (!c.roles.some((r) => r.split(":")[0] === "admin")) throw forbidden("admin only");
    const locks = await repos.executionLocks.list(c.tenantId);
    return {
      items: locks.map((l) => ({
        resourceKind: l.resourceKind,
        resourceKey: l.resourceKey,
        holderId: l.holderId,
        acquiredAt: l.acquiredAt,
        leaseUntil: l.leaseUntil,
        fence: l.fence,
        rerunRequested: l.rerunRequested,
        active: new Date(l.leaseUntil).getTime() > Date.now(),
      })),
    };
  });

  // 运营完备性 §4：数据隔离区（按原因分组 + 修复重处理 + 批量丢弃）
  app.get("/a/v1/quarantine", async (req) => {
    const c = ctx(req);
    if (!c.roles.some((r) => r.split(":")[0] === "admin" || r.split(":")[0] === "catalog_admin"))
      throw forbidden("admin / catalog_admin only");
    const { status } = req.query as { status?: "PENDING" | "REPROCESSED" | "DISCARDED" };
    return quarantine.list(c, status ?? "PENDING");
  });
  app.post("/a/v1/quarantine/:id/reprocess", async (req) => {
    const c = ctx(req);
    if (!c.roles.some((r) => r.split(":")[0] === "admin" || r.split(":")[0] === "catalog_admin"))
      throw forbidden("admin / catalog_admin only");
    const { id } = req.params as { id: string };
    const body = parseBody(z.object({ edits: z.record(z.string(), z.unknown()).optional() }), req.body);
    return quarantine.reprocess(c, id, body.edits);
  });
  app.post("/a/v1/quarantine/discard", async (req) => {
    const c = ctx(req);
    if (!c.roles.some((r) => r.split(":")[0] === "admin" || r.split(":")[0] === "catalog_admin"))
      throw forbidden("admin / catalog_admin only");
    const body = parseBody(z.object({ ids: z.array(z.string()).min(1), comment: z.string().min(1) }), req.body);
    return quarantine.discard(c, body.ids, body.comment);
  });

  // 运营完备性 §1：实体解析与黄金记录（OC1）。合并=真值变更，留痕 mergedBy/mergedAt（R4 可审计）。
  const requireDataAdmin = (c: AuthCtx) => {
    if (!c.roles.some((r) => ["admin", "data_admin"].includes(r.split(":")[0] as string))) throw forbidden("admin / data_admin only");
  };
  app.post("/a/v1/objects/merge-scan", async (req) => {
    const c = ctx(req);
    requireDataAdmin(c);
    const body = parseBody(z.object({ typeKey: z.string().min(1) }), req.body);
    return { candidates: await entityResolution.scan(c, body.typeKey) };
  });
  app.get("/a/v1/objects/merge-candidates", async (req) => entityResolution.listCandidates(ctx(req)));
  app.post("/a/v1/objects/merge-candidates/:id/merge", async (req) => {
    const c = ctx(req);
    requireDataAdmin(c);
    const { id } = req.params as { id: string };
    const body = parseBody(z.object({ goldenId: z.string().optional(), survivorship: z.record(z.string(), z.string()).optional() }), req.body ?? {});
    return entityResolution.merge(c, id, body.goldenId, body.survivorship);
  });
  app.post("/a/v1/objects/merge-candidates/:id/reject", async (req) => {
    const c = ctx(req);
    requireDataAdmin(c);
    const { id } = req.params as { id: string };
    await entityResolution.reject(c, id);
    return { ok: true };
  });
  app.get("/a/v1/objects/merges", async (req) => ({ items: await entityResolution.listMerges(ctx(req)) }));
  app.post("/a/v1/objects/merges/:id/unmerge", async (req) => {
    const c = ctx(req);
    requireDataAdmin(c);
    const { id } = req.params as { id: string };
    await entityResolution.unmerge(c, id);
    return { ok: true };
  });

  // 自成长发动机 P2：缺数据"真人正门"自动补——确定性生成 CSV → 经公开上传门(connectors.upload)
  // 导入 → RawDataset 落地可见（与真人手动上传逐跳一致、无后门；R6 同 seed 字节级一致）。
  app.post("/a/v1/growth/fill-data", async (req) => {
    const c = ctx(req);
    requireDataAdmin(c);
    const body = parseBody(z.object({ typeKey: z.string().min(1), fields: z.array(z.string().min(1)).min(1), rows: z.number().int().min(1).max(500).default(6), seed: z.number().int().default(42) }), req.body);
    const rng = mulberry32((body.seed >>> 0) ^ hashString(body.typeKey));
    const cell = (f: string, i: number): string => {
      const lf = f.toLowerCase();
      if (/(id$|key$|code|编号)/.test(lf)) return `${body.typeKey.toLowerCase()}_${i + 1}`;
      if (/(name|名称|title|名)/.test(lf)) return `${body.typeKey}-${i + 1}`;
      if (/(qty|count|num|amount|util|rate|价|量|率|数)/.test(lf)) return String(randInt(rng, 1, 1000));
      return `${f}_${i + 1}`;
    };
    const lines = [body.fields.join(",")];
    for (let i = 0; i < body.rows; i++) lines.push(body.fields.map((f) => cell(f, i)).join(","));
    const csv = lines.join("\n") + "\n";
    const filename = `growth_${body.typeKey}_${body.seed}.csv`;
    const result = await connectors.upload(c, filename, Buffer.from(csv, "utf8"));
    return { connId: result.connection.id, datasetName: result.schema.datasets[0]?.name ?? result.connection.name, rowCount: body.rows, filename, viaFrontDoor: true };
  });

  // G-9 发育闭环招牌（缺件卡→自动补→GOVERNED 活体）：空租户自动 provision 确定性合成起步世界。
  // 走真合成正门（synthetic.runJob，FK 一致·R6 字节复现·SYNTHETIC origin 可溯），industry 取**租户自身配置**
  // （服务端派生，agentcore 零行业常数 R14）。**安全门**：仅当租户当前对象世界近空（≤ 阈值）才执行——
  // 绝不覆盖已有真实数据（入空租户无可 clobber）。被场景发育 fill 在 EMPTY_DATA/空世界时调用。
  app.post("/a/v1/growth/provision-world", async (req) => {
    const c = ctx(req);
    requireDataAdmin(c);
    const body = parseBody(z.object({ scale: z.enum(["S", "M", "L", "XL"]).default("S"), seed: z.number().int().default(42) }), req.body);
    const existing = (await repos.objects.list(c.tenantId)).length;
    if (existing > 20) {
      // 非空租户：不自动合成（守 R——不伪造/覆盖真实业务数据），诚实回报。
      return { provisioned: false, reason: "TENANT_NOT_EMPTY", existingObjects: existing };
    }
    const tenant = await repos.tenants.get(c.tenantId, c.tenantId);
    const industry = (tenant?.industry as string) || "battery-manufacturing";
    const job = await synthetic.runJob(c, { industry, scale: body.scale, seed: body.seed, viaModelingChain: true });
    const objectCount = (await repos.objects.list(c.tenantId)).length;
    return { provisioned: true, jobId: job.id, industry, scale: body.scale, seed: body.seed, objectCount };
  });

  // 运营完备性 §9：通知中心（铃铛未读 + 列表 + 标记已读）
  app.get("/a/v1/notifications", async (req) => {
    const c = ctx(req);
    const { unreadOnly, limit } = req.query as { unreadOnly?: string; limit?: string };
    return notifications.list(c, { unreadOnly: unreadOnly === "true", limit: limit ? Number(limit) : 50 });
  });
  app.post("/a/v1/notifications/:id/read", async (req) => {
    const c = ctx(req);
    const { id } = req.params as { id: string };
    const ok = await notifications.markRead(c, id);
    if (!ok) throw notFound("notification");
    return { ok: true };
  });
  app.post("/a/v1/notifications/read-all", async (req) => notifications.markAllRead(ctx(req)));

  // ONTO-SCEN-LAUNCH-DET（PRD-scenario-ontogenesis §2.5·服务间）：B 侧场景卡点卡不可答开 GrowthTicket 后，
  // 经此把「发育缺口 + 工单深链」扇出给责任角色（复用 WO-ALERT NotificationService → 前端铃铛/通知中心=收件箱）。
  // 仅服务间凭证（x-service-token → roles=["service"]，与 /a/v1/references/report 同范式）；用户 JWT 一律 403。
  app.post("/a/v1/notifications/notify-role", async (req) => {
    const c = ctx(req);
    if (!c.roles.includes("service")) throw forbidden("notify-role is service-to-service only");
    const body = parseBody(
      z.object({
        role: z.string().min(1),
        kind: z.string().min(1),
        title: z.string().min(1),
        body: z.string(),
        refType: z.string().optional(),
        refId: z.string().optional(),
      }),
      req.body,
    );
    const notified = await notifications.notifyRole(c.tenantId, body.role, undefined, {
      kind: body.kind,
      title: body.title,
      body: body.body,
      ...(body.refType ? { refType: body.refType } : {}),
      ...(body.refId ? { refId: body.refId } : {}),
    });
    return { notified };
  });

  // 闭环验证引擎 VLE §4：触发验证 run + 历史 + 单次报告（admin / catalog_admin）
  app.post("/a/v1/validation/runs", async (req, reply) => {
    const c = ctx(req);
    if (!c.roles.some((r) => r.split(":")[0] === "admin" || r.split(":")[0] === "catalog_admin"))
      throw forbidden("admin / catalog_admin only");
    const body = parseBody(
      z.object({ profile: z.enum(["SMOKE", "FULL", "SOAK"]).default("SMOKE"), seed: z.number().int().optional() }),
      req.body,
    );
    const run = await vle.run(c, body.profile, body.seed ?? 42);
    return reply.status(201).send(run);
  });
  app.get("/a/v1/validation/runs", async (req) => {
    const c = ctx(req);
    if (!c.roles.some((r) => r.split(":")[0] === "admin" || r.split(":")[0] === "catalog_admin"))
      throw forbidden("admin / catalog_admin only");
    const runs = await repos.validationRuns.list(c.tenantId);
    return { items: runs.sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1)) };
  });
  app.get("/a/v1/validation/runs/:id", async (req) => {
    const c = ctx(req);
    const { id } = req.params as { id: string };
    const run = await repos.validationRuns.get(c.tenantId, id);
    if (!run) throw notFound("validation run");
    return run;
  });

  app.get("/a/v1/policies", async (req) => repos.policies.list(ctx(req).tenantId));
  app.post("/a/v1/policies", async (req, reply) => {
    const c = ctx(req);
    const body = parseBody(
      z.object({
        resource: z.object({
          kind: z.enum(["OBJECT_TYPE", "CONNECTION", "RULE_SET", "ACTION_TYPE"]),
          key: z.string(),
        }),
        grants: z.array(
          z.object({ role: z.string(), ops: z.array(z.enum(["READ", "WRITE", "EXECUTE"])) }),
        ),
        rowFilter: z.string().optional(),
      }),
      req.body,
    );
    const policy = { id: newId("pol"), tenantId: c.tenantId, ...body };
    await repos.policies.put(policy);
    return reply.status(201).send(policy);
  });

  // ---- 推演沙盘（G-11 · 增量 1：会话状态机 · SPEC §2/§5 · 行业无关 jsonb，零业务常数 R14）----
  // 全部经 entitlement 暗发（R3 先于 authz：关 = 404 FEATURE_NOT_FOUND）。tick 在增量 1 为恒等桩
  // （状态原样推进 + 逐 tick 快照，确定性 R6）；增量 3 换真 propagateTick（系数×延迟）。act=模拟态不写真值（R4）。
  const requireSim = async (c: AuthCtx, feature: string) => {
    if (!(await features.enabled(c.tenantId, feature))) throw featureNotFound();
  };
  const simState = (deltaTarget: TickState): TickState => JSON.parse(JSON.stringify(deltaTarget)) as TickState;
  const simCurrent = async (c: AuthCtx, s: SimSession): Promise<TickState> =>
    (await repos.sim.getTickState(c.tenantId, s.id, s.curTick))?.state ?? simState(s.baseSnapshot);

  // 传导图 + 规则参数（正门 R16/R4：物化对象 + 链路，任意行业；零硬编码）。/tick 与 Trial Tick 同源，
  // 避免两条路走两套装配（CORE-E2-PROPAGATE：Trial Tick 必须用与真沙盘 tick 一字不差的 propagateTick 输入）。
  const buildPropagationInputs = async (c: AuthCtx): Promise<{ graph: PropagationGraph; ruleParams: RuleParamLookup }> => {
    const objects: PropagationGraph["objects"] = [];
    for (const t of await repos.ontologyTypes.list(c.tenantId)) {
      for (const o of await repos.objects.listByType(c.tenantId, t.key)) if (!o.mergedInto) objects.push({ id: o.id, typeKey: o.type });
    }
    const links = (await repos.links.list(c.tenantId)).map((l) => ({ fromId: l.fromId, toId: l.toId, linkKey: l.type }));
    const ruleParams: RuleParamLookup = {};
    for (const r of await repos.rules.list(c.tenantId, (r) => r.status === "PUBLISHED")) {
      if (r.params) ruleParams[r.key] = r.params;
    }
    return { graph: { objects, links }, ruleParams };
  };

  // SIM-REAL-SNAPSHOT（簇D 治本 · CORE-E2-PROPAGATE C3）：从**真对象态**播 tick0 世界态——每对象取 obj.props
  // 命中 stateVar 名的**真实有限数值**属性（非数值/缺失 → 不写，诚实缺省，绝不哈希造伪）。view-config nodeObjectState
  // 与 Trial Tick 起跑态同源：推演从后端真世界态起跑，清空真源即归 0（teeth）。
  const buildRealSnapshot = async (c: AuthCtx, stateVars: string[]): Promise<TickState> => {
    const svSet = new Set(stateVars);
    const snapshot: TickState = {};
    for (const t of await repos.ontologyTypes.list(c.tenantId)) {
      for (const o of await repos.objects.listByType(c.tenantId, t.key)) {
        if (o.mergedInto) continue;
        const row: Record<string, number> = {};
        for (const [k, raw] of Object.entries(o.props as Record<string, unknown>)) {
          if (svSet.has(k) && typeof raw === "number" && Number.isFinite(raw)) row[k] = raw;
        }
        if (Object.keys(row).length > 0) snapshot[o.id] = row;
      }
    }
    return snapshot;
  };

  // ── WO-SANDBOX-TRUST-BADGE（S2·Dev-1 后端半·暗发 additive·纯透传·绝不造真值） ────────────────
  // 把**已存在的诚信信号**透传成沙盘每个数字的 dataMode——不发明新档、不伪造 LIVE（KILL-MOCK-RED 同源）。
  // 血缘上下文单遍解出（R6 纯派生·R13 溯源）：
  //  · 关键源新鲜度 = C09 同判据（solvers/service.ts:2472 一字不差）：任一 DataSourceHealth.critical 源
  //    lagHours>staleHours → 真对象值降 STALE。
  //  · origin 血缘 = obj.origin.type（SYNTHETIC/MATERIALIZED/MANUAL…），与 SolverDataMode/isSyntheticDecision 同源。
  const loadTrustContext = async (c: AuthCtx): Promise<{ criticalStale: boolean; originById: Map<string, string> }> => {
    const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const params = await solvers.getParams(c.tenantId);
    const staleHours = params.health?.staleHours ?? 2;
    const health = await repos.objects.listByType(c.tenantId, "DataSourceHealth");
    const criticalStale = health.some((h) => h.props.critical === true && n(h.props.lagHours) > staleHours);
    const originById = new Map<string, string>();
    for (const t of await repos.ontologyTypes.list(c.tenantId)) {
      for (const o of await repos.objects.listByType(c.tenantId, t.key)) {
        if (o.mergedInto) continue;
        originById.set(o.id, String((o.origin as { type?: string } | undefined)?.type ?? ""));
      }
    }
    return { criticalStale, originById };
  };

  // 逐 (对象,状态变量) 诚信位（复用 SolverDataMode 语义·LIVE=由真对象数据派生）：
  //  · origin=SYNTHETIC → SYNTHETIC（合成血缘·不冒充 LIVE）
  //  · 真对象 + 关键源滞后 → STALE（C09）
  //  · 真对象 + 源新鲜 → LIVE
  // 仅对 state 中**已有真数值**的格发位；无真值不发 → 前端诚实"来源待披露"（绝不假标 LIVE·KILL-MOCK-RED）。
  // UNCALIBRATED 由前端从 propRule.coefficientRef 空自派生（契约注 sim.ts nodeObjectMode·非本端职责）。稳定序 R6。
  const deriveCellMode = (
    trust: { criticalStale: boolean; originById: Map<string, string> },
    state: TickState,
  ): Record<string, Record<string, SimDataMode>> => {
    const mode: Record<string, Record<string, SimDataMode>> = {};
    for (const objId of Object.keys(state).sort()) {
      const originType = trust.originById.get(objId);
      const m: SimDataMode = originType === "SYNTHETIC" ? "SYNTHETIC" : trust.criticalStale ? "STALE" : "LIVE";
      const vars = state[objId] ?? {};
      const row: Record<string, SimDataMode> = {};
      for (const v of Object.keys(vars).sort()) row[v] = m;
      if (Object.keys(row).length > 0) mode[objId] = row;
    }
    return mode;
  };

  // 汇总"整体可信度"位：取最不可信档（WO §3.2 序 LIVE<UNCALIBRATED<SYNTHETIC<STALE）。
  // worst-mode 恒诚实——绝不高于最弱输入档（有任一合成/陈旧格 → 汇总即合成/陈旧·不冒充整体 LIVE）。空=undefined 不发。
  const SIM_MODE_RANK: Record<SimDataMode, number> = { LIVE: 0, UNCALIBRATED: 1, SYNTHETIC: 2, STALE: 3 };
  const summarizeCellMode = (m: Record<string, Record<string, SimDataMode>>): SimDataMode | undefined => {
    let worst: SimDataMode | undefined;
    for (const vars of Object.values(m)) {
      for (const md of Object.values(vars)) {
        if (worst === undefined || SIM_MODE_RANK[md] > SIM_MODE_RANK[worst]) worst = md;
      }
    }
    return worst;
  };

  // S6（§3.1）：把 feedSpecs 从**真源**（loadContext 真对象 + A8 真点）解出逐 tick 序列并**冻结进会话**。
  // 无真源 → 该 feed 不生成（feedGaps 诚实报缺口·绝不合成未来·KILL-MOCK-RED）。仅 sim.temporal_grounding 开时启用
  // （关闸 = 不解析·feeds 空 = v1.1 行为·acceptance #8）。
  const resolveFrozenFeeds = async (
    c: AuthCtx,
    feedSpecs: FeedSpec[],
    horizonTicks: number,
  ): Promise<{ feeds: SimSession["feeds"]; gaps: { feedKey: string; gapCode: string; detail: string }[] }> => {
    if (feedSpecs.length === 0) return { feeds: [], gaps: [] };
    const sctx = await solvers.loadContext(c.tenantId, undefined, { withExtended: true });
    const sources: FeedResolveSources = {
      demandSegments: sctx.demandSegments ?? [],
      sopVersions: sctx.sopVersions ?? [],
      purchaseOrders: sctx.purchaseOrders ?? [],
      maintPlans: sctx.maintPlans ?? [],
      // A8 真点：seriesKey → 逐 tick 真实测量（tick 已归一·无 tick 的点略去·不外推）。
      tsSeriesPoints: () => [], // 覆盖见下（按需查库·避免无 ts_series feed 时空扫）
    };
    // ts_series feed 存在时才查 A8（懒解析·确定性）。
    const tsKeys = feedSpecs.filter((f) => f.source.kind === "ts_series").map((f) => (f.source as { seriesKey: string }).seriesKey);
    if (tsKeys.length > 0) {
      const cache = new Map<string, { tick: number; value: number }[]>();
      for (const key of tsKeys) {
        if (cache.has(key)) continue;
        const series = await repos.tsSeries.list(c.tenantId, (sr) => sr.seriesKey === key);
        const pts: { tick: number; value: number }[] = [];
        for (const sr of series) {
          for (const p of await repos.tsPoints.list(c.tenantId, sr.id)) {
            if (typeof p.tick === "number") pts.push({ tick: p.tick, value: p.values[sr.measureFields[0] ?? "value"] ?? 0 });
          }
        }
        cache.set(key, pts);
      }
      sources.tsSeriesPoints = (key) => cache.get(key) ?? [];
    }
    const { feeds, gaps } = resolveExogenousFeeds(feedSpecs, horizonTicks, sources);
    return { feeds, gaps };
  };

  // ── WO-SANDBOX-TEMPORAL-GROUNDING §3.6（回放校验 + horizon 预检·暗发·可回退）─────────────
  // 暗发闸：消费**与 S6 §3.1-3.5 同一** feature key `sim.temporal_grounding`（不另立键；未注册时
  // features.enabled 安全返 false）+ env 逃生阀（供注册前真跑校验）。关闸=replay/precheck 不跑=v1.1 行为字节一致（NG6）。
  const temporalGroundingOn = async (c: AuthCtx): Promise<boolean> =>
    (await features.enabled(c.tenantId, "sim.temporal_grounding")) || process.env.SIM_TEMPORAL_GROUNDING === "1";

  // A8 `ts_points` 真实历史 → 逐日真实全态（解 series+points+entity 映射，交纯函数 buildDailyStatesFromSeries）。
  // entity→objId：该 series entityType 下 props[entityRefField]===entityId 或 obj.id===entityId（真映射·非造）。
  const buildReplayHistory = async (c: AuthCtx, rules: PropagationRule[], days: number) => {
    const { graph, ruleParams } = await buildPropagationInputs(c);
    const stateVars = [...new Set(rules.flatMap((r) => [r.sourceStateVar, r.targetStateVar]))];
    const seriesList: ReplaySeriesLike[] = [];
    const entityMap = new Map<string, string>();
    for (const s of await repos.tsSeries.list(c.tenantId)) {
      if (!s.measureFields.some((m) => stateVars.includes(m))) continue;
      const points = await repos.tsPoints.list(c.tenantId, s.id);
      if (points.length === 0) continue;
      seriesList.push({ measureFields: s.measureFields, points: points.map((p) => ({ entityId: p.entityId, ts: p.ts, values: p.values })) });
      for (const o of await repos.objects.listByType(c.tenantId, s.entityType)) {
        if (o.mergedInto) continue;
        const bizKey = String((o.props as Record<string, unknown>)[s.entityRefField] ?? "");
        if (bizKey) entityMap.set(bizKey, o.id);
        entityMap.set(o.id, o.id);
      }
    }
    const { dailyStates } = buildDailyStatesFromSeries(seriesList, stateVars, (e) => entityMap.get(e), { days });
    return { graph, ruleParams, dailyStates };
  };

  // §3.6 L3 回放：装配 A8 历史后调纯函数 replayPropagationRules（复用 propagateTick 确定性引擎·R6）。
  const runReplayValidation = async (c: AuthCtx, rules: PropagationRule[], computedAt: string) => {
    const history = await buildReplayHistory(c, rules, DEFAULT_REPLAY_WINDOW.days);
    return replayPropagationRules(c.tenantId, rules, DEFAULT_REPLAY_WINDOW, history, computedAt);
  };

  // §3.6 horizon 覆盖：真源=需求预测周期（ForecastSnapshot.weeks×7）。不足 → 诚实缺口卡（喂 GrowthTicket），绝不外推。
  const computeHorizonCoverage = async (c: AuthCtx, requestedTicks: number): Promise<HorizonCoverage> => {
    const snaps = await repos.forecastSnapshots.list(c.tenantId);
    const coveredTicks = snaps.reduce((mx, s) => Math.max(mx, Math.max(0, Math.floor(s.weeks * 7))), 0);
    const sufficient = coveredTicks >= requestedTicks;
    const gaps = sufficient
      ? []
      : [{
          gapCode: "HORIZON_UNCOVERED",
          ref: `forecast:${c.tenantId}`,
          detail: `需求预测仅覆盖 ${coveredTicks} 天，无法支撑 ${requestedTicks} 天推演——绝不静默截断/外推（KILL-MOCK-RED）。请补建覆盖 ${requestedTicks} 天的需求预测后重试。`,
        }];
    return { requestedTicks, coveredTicks, sufficient, source: "forecast_snapshot.weeks", gaps };
  };

  app.post("/a/v1/sim/sessions", async (req, reply) => {
    const c = ctx(req);
    await requireSim(c, "sim.sandbox");
    const b = (req.body ?? {}) as { baseSnapshot?: TickState; scope?: Record<string, unknown>; feedSpecs?: FeedSpec[]; horizonTicks?: number };
    const base = b.baseSnapshot ?? {};
    // S6 暗发：仅 sim.temporal_grounding 开且传了 feedSpecs 才冻结 feeds（关闸=空 feeds=v1.1·acceptance #8）。
    const tg = await features.enabled(c.tenantId, "sim.temporal_grounding");
    const horizonTicks = Math.max(1, Math.floor(Number(b.horizonTicks ?? 1)));
    const { feeds, gaps } = tg && Array.isArray(b.feedSpecs) ? await resolveFrozenFeeds(c, b.feedSpecs, horizonTicks) : { feeds: [], gaps: [] };
    const s: SimSession = {
      id: newId("sims"), tenantId: c.tenantId, baseSnapshot: base, scope: b.scope ?? {},
      status: Object.keys(base).length > 0 ? "READY" : "DRAFT", curTick: 0, parentCheckpointId: null,
      feeds,
      createdAt: new Date().toISOString(),
    };
    await repos.sim.createSession(s);
    await repos.sim.putTickState({ sessionId: s.id, tenantId: c.tenantId, tick: 0, state: simState(base), pending: [], trace: null });
    await outbox.emit(c.tenantId, "sim.session_created", { sessionId: s.id, status: s.status });
    // feedGaps 随创建响应回带（诚实缺口卡·前端可呈现"某 feed 无真源未生成"）。
    return reply.status(201).send({ ...s, ...(gaps.length > 0 ? { feedGaps: gaps } : {}) });
  });
  const getSimOr404 = async (c: AuthCtx, id: string): Promise<SimSession> => {
    const s = await repos.sim.getSession(c.tenantId, id);
    if (!s) throw notFound("sim session not found");
    return s;
  };
  app.get("/a/v1/sim/sessions", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.sandbox");
    return { items: await repos.sim.listSessions(c.tenantId) };
  });
  app.get("/a/v1/sim/sessions/:id/world", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.sandbox");
    const s = await getSimOr404(c, (req.params as { id: string }).id);
    return { tick: s.curTick, state: await simCurrent(c, s) };
  });
  app.post("/a/v1/sim/sessions/:id/tick", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.propagation");
    const s = await getSimOr404(c, (req.params as { id: string }).id);
    const n = Math.max(1, Math.floor(Number((req.body as { n?: number })?.n ?? 1)));
    let state = await simCurrent(c, s);
    // 增量 3 传导核接入（opt-in）：本租户有 PUBLISHED PropagationRule 才传导，否则退回恒等 tick
    // （无规则不触发，可回退）。propagateTick 是纯函数（R6 确定性、R14 零业务常数）。
    const propRules = await repos.sim.listPropagationRules(c.tenantId, true); // PUBLISHED only
    // S6（§3.2·暗发）：仅 sim.temporal_grounding 开时注入冻结 feeds（关闸 = 空 feeds = v1.1 逐 tick 字节一致·acceptance #8）。
    const tg = await features.enabled(c.tenantId, "sim.temporal_grounding");
    const feeds = tg ? (s.feeds ?? []) : [];
    // 有 PUBLISHED 传导规则 或 有冻结 feeds → 走真传导（否则恒等桩·可回退）。
    const propagate = propRules.length > 0 || feeds.length > 0;
    let graph: PropagationGraph = { objects: [], links: [] };
    let ruleParams: RuleParamLookup = {};
    let pending: DelayedContribution[] = propagate ? ((await repos.sim.getTickState(c.tenantId, s.id, s.curTick))?.pending ?? []) : [];
    if (propagate) {
      // 物化图 + 规则参数（buildPropagationInputs 同源，Trial Tick 复用同一装配）。feed "ALL" 目标解析亦用此图。
      ({ graph, ruleParams } = await buildPropagationInputs(c));
    }
    let trace: PropagationTrace[] | null = null;
    for (let i = 0; i < n; i++) {
      const beforeTick = s.curTick; // 当前 tick t（结算 pending arriveTick===t）
      if (propagate) {
        const out = propagateTick(graph, state, propRules, pending, beforeTick, ruleParams, feeds);
        state = out.next; pending = out.pending; trace = out.trace; s.curTick += 1;
        const cv = out.constraintViolations;
        await repos.sim.putTickState({ sessionId: s.id, tenantId: c.tenantId, tick: s.curTick, state, pending, trace, ...(cv.length > 0 ? { constraintViolations: cv } : {}) });
      } else {
        // 无 PUBLISHED 传导规则且无 feeds：恒等桩进位（状态原样，确定性 R6；可回退）。
        state = simState(state); pending = []; trace = null; s.curTick += 1;
        await repos.sim.putTickState({ sessionId: s.id, tenantId: c.tenantId, tick: s.curTick, state, pending, trace });
      }
    }
    s.status = "RUNNING"; await repos.sim.putSession(s);
    await outbox.emit(c.tenantId, "sim.tick_completed", { sessionId: s.id, curTick: s.curTick });
    // WO-SANDBOX-TRUST-BADGE（S2·暗发·关 sim.trust_badge = 字段缺席 = 响应字节一致）：本 tick 态"整体可信度"汇总位
    // （worst-mode 恒诚实·绝不冒充整体 LIVE）。按需派生·不落库（putTickState 列固定·不改迁移·pg/memory 一致）。
    const trustBadge = await features.enabled(c.tenantId, "sim.trust_badge");
    const dataMode = trustBadge ? summarizeCellMode(deriveCellMode(await loadTrustContext(c), state)) : undefined;
    return { curTick: s.curTick, state, ...(propagate ? { trace } : {}), ...(dataMode ? { dataMode } : {}) };
  });
  app.post("/a/v1/sim/sessions/:id/act", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.sandbox");
    const s = await getSimOr404(c, (req.params as { id: string }).id);
    const b = req.body as { objectId: string; stateVar: string; value: number };
    const state = await simCurrent(c, s);
    (state[b.objectId] ??= {})[b.stateVar] = Number(b.value); // 模拟态，不写真值（R4；采纳才出 ActionDraft）
    await repos.sim.putTickState({ sessionId: s.id, tenantId: c.tenantId, tick: s.curTick, state, pending: [], trace: null });
    return { curTick: s.curTick, state };
  });
  app.post("/a/v1/sim/sessions/:id/checkpoint", async (req, reply) => {
    const c = ctx(req); await requireSim(c, "sim.checkpoint");
    const s = await getSimOr404(c, (req.params as { id: string }).id);
    const cp: SimCheckpoint = { id: newId("simcp"), sessionId: s.id, tenantId: c.tenantId, tick: s.curTick,
      label: String((req.body as { label?: string })?.label ?? `tick${s.curTick}`), createdAt: new Date().toISOString() };
    await repos.sim.createCheckpoint(cp);
    await outbox.emit(c.tenantId, "sim.checkpoint_saved", { sessionId: s.id, checkpointId: cp.id, tick: cp.tick });
    return reply.status(201).send(cp);
  });
  app.post("/a/v1/sim/sessions/:id/rollback", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.checkpoint");
    const s = await getSimOr404(c, (req.params as { id: string }).id);
    const cp = await repos.sim.getCheckpoint(c.tenantId, String((req.body as { checkpointId?: string })?.checkpointId));
    if (!cp || cp.sessionId !== s.id) throw notFound("checkpoint not found");
    await repos.sim.deleteTicksAfter(c.tenantId, s.id, cp.tick);
    s.curTick = cp.tick; await repos.sim.putSession(s);
    return { curTick: s.curTick, state: await simCurrent(c, s) };
  });
  // ── S3 branch-inject（WO-SANDBOX-BRANCH-INJECT）纯函数 + 决策维 overlay 计算 ─────────────────
  // 应对注入（纯·R6）：把 mitigation.injections 逐格叠到 child tick0 baseSnapshot（不动 base·map 出新态）。
  // 关闸时调用方不传 mitigation → 恒等（child==容器分支·A/B 相同·回退演练 §5.5）。
  const applyMitigation = (base: TickState, mit: ReturnType<typeof SimMitigationSchema.parse>): TickState => {
    const next = simState(base); // 深拷贝（不 mutate 入参·R4 只读语义）
    for (const inj of mit.injections) {
      const cell = (next[inj.objectId] ??= {});
      cell[inj.stateVar] = Number(cell[inj.stateVar] ?? 0) + inj.delta;
    }
    return next;
  };
  // 决策维注册表（R14 配置驱动）：优先取请求显式 `dims`（JSON·前端/CLI 传·带 direction 才出裁定）；
  // 缺省 → 从本租户 PUBLISHED 传导规则的 target(typeKey,stateVar) 派生（direction=NEUTRAL·只报值不判优劣·诚实）。
  const resolveDecisionDims = async (c: AuthCtx, dimsRaw?: string): Promise<DecisionDim[]> => {
    if (dimsRaw) {
      try {
        const parsed = JSON.parse(dimsRaw) as unknown[];
        if (Array.isArray(parsed)) return parsed.map((d) => DecisionDimSchema.parse(d));
      } catch { /* 非法 dims JSON → 回落派生（诚实·不炸） */ }
    }
    const rules = await repos.sim.listPropagationRules(c.tenantId, true); // PUBLISHED
    const seen = new Set<string>();
    const dims: DecisionDim[] = [];
    for (const r of rules) {
      const key = `${r.targetTypeKey}.${r.targetStateVar}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dims.push(DecisionDimSchema.parse({ dimKey: key, label: key, objectType: r.targetTypeKey, stateVar: r.targetStateVar, agg: "sum", direction: "NEUTRAL" }));
    }
    return dims;
  };
  // 逐维聚合：在**overlay 后**的 SolverContext 承载数组上取 o.type===dim.objectType 的对象，读 props[stateVar] 数值
  // （overlay 已把该分支模拟末态覆盖到真对象 props·非原始 simState 直读）。无命中对象 → null（诚实无数据）。
  const aggregateDim = (overlaid: import("./solvers/types.js").SolverContext, dim: DecisionDim): number | null => {
    const rec = overlaid as unknown as Record<string, unknown>;
    const vals: number[] = [];
    for (const key of OVERLAYABLE_CONTEXT_ARRAYS) {
      const arr = rec[key];
      if (!Array.isArray(arr)) continue;
      for (const o of arr as ObjectInstance[]) {
        if (o.type !== dim.objectType) continue;
        const v = (o.props as Record<string, unknown>)[dim.stateVar];
        if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
      }
    }
    if (vals.length === 0) return null;
    switch (dim.agg) {
      case "avg": return vals.reduce((a, b) => a + b, 0) / vals.length;
      case "max": return Math.max(...vals);
      case "min": return Math.min(...vals);
      default: return vals.reduce((a, b) => a + b, 0);
    }
  };
  const EPS = 1e-9;
  const verdictOf = (a: number | null, b: number | null, dir: DecisionDim["direction"]): CompareDecisionVerdict => {
    if (a === null || b === null) return "NO_DATA";
    const d = b - a;
    if (Math.abs(d) < EPS) return "TIE";
    if (dir === "NEUTRAL") return "NO_DATA"; // 有数据但未声明方向 → 不臆断优劣（诚实·a/b 仍呈现）
    if (dir === "HIGHER_BETTER") return d > 0 ? "B_BETTER" : "A_BETTER";
    return d < 0 ? "B_BETTER" : "A_BETTER"; // LOWER_BETTER
  };
  // compare 决策维（经 S6 overlay·真求解器上下文·非造）：A/B 各取当前 tick 模拟末态 → overlay 覆盖真世界 → 逐维聚合。
  const computeDecisionDims = async (c: AuthCtx, sa: SimSession, sb: SimSession, dims: DecisionDim[]): Promise<CompareDecisionValue[]> => {
    if (dims.length === 0) return [];
    const base = await solvers.loadContext(c.tenantId, undefined, { withExtended: true });
    const stateA = await simCurrent(c, sa);
    const stateB = await simCurrent(c, sb);
    const ovA = buildSimSolverContext(c.tenantId, stateA, base);
    const ovB = buildSimSolverContext(c.tenantId, stateB, base);
    return dims.map((dim) => {
      const a = aggregateDim(ovA, dim);
      const b = aggregateDim(ovB, dim);
      return {
        dimKey: dim.dimKey, label: dim.label || dim.dimKey,
        a, b, delta: a !== null && b !== null ? b - a : null,
        direction: dim.direction, verdict: verdictOf(a, b, dim.direction),
      };
    });
  };

  app.post("/a/v1/sim/sessions/:id/branch", async (req, reply) => {
    const c = ctx(req); await requireSim(c, "sim.branch");
    const parent = await getSimOr404(c, (req.params as { id: string }).id);
    const body = (req.body ?? {}) as { checkpointId?: string; mitigation?: unknown };
    const cp = await repos.sim.getCheckpoint(c.tenantId, String(body.checkpointId));
    if (!cp || cp.sessionId !== parent.id) throw notFound("checkpoint not found");
    const baseState = (await repos.sim.getTickState(c.tenantId, parent.id, cp.tick))?.state ?? {};
    // S3 暗发：仅 sim.branch_inject 开且传了 mitigation 才注入应对（关闸=忽略=回容器分支·A/B 相同·acceptance §5.5）。
    const injectOn = await features.enabled(c.tenantId, "sim.branch_inject");
    let mitigation: ReturnType<typeof SimMitigationSchema.parse> | null = null;
    let childBase = simState(baseState);
    if (injectOn && body.mitigation != null) {
      mitigation = SimMitigationSchema.parse(body.mitigation);
      childBase = applyMitigation(baseState, mitigation); // 应对增量注入 child tick0（A 主线不动·对照）
    }
    // 应对随 child.scope.mitigation 留痕（R13·additive·scope 本为 z.record unknown·不改 SimSession 契约·merge-clean）。
    const childScope = mitigation ? { ...parent.scope, mitigation } : parent.scope;
    const child: SimSession = { id: newId("sims"), tenantId: c.tenantId, baseSnapshot: childBase, scope: childScope,
      status: "READY", curTick: 0, parentCheckpointId: cp.id, feeds: parent.feeds ?? [], createdAt: new Date().toISOString() };
    await repos.sim.createSession(child);
    await repos.sim.putTickState({ sessionId: child.id, tenantId: c.tenantId, tick: 0, state: simState(childBase), pending: [], trace: null });
    await outbox.emit(c.tenantId, "sim.branched", { parentSessionId: parent.id, childSessionId: child.id, checkpointId: cp.id, ...(mitigation ? { mitigationKey: mitigation.key } : {}) });
    return reply.status(201).send({ ...child, ...(mitigation ? { mitigation } : {}) });
  });
  app.get("/a/v1/sim/compare", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.branch");
    const q = req.query as { a?: string; b?: string; dims?: string };
    const seriesOf = async (id?: string) => (id ? (await repos.sim.listTickStates(c.tenantId, id)).map((t) => ({ tick: t.tick, state: t.state })) : []);
    const result: { a: unknown; b: unknown; decisionDims?: CompareDecisionValue[] } = { a: await seriesOf(q.a), b: await seriesOf(q.b) };
    // S3 暗发：仅 sim.branch_inject 开且两会话都在 → 附决策维差量（关闸=不返 decisionDims=旧行为字节一致·acceptance §5.5）。
    if (q.a && q.b && (await features.enabled(c.tenantId, "sim.branch_inject"))) {
      const sa = await repos.sim.getSession(c.tenantId, q.a);
      const sb = await repos.sim.getSession(c.tenantId, q.b);
      if (sa && sb) {
        const dims = await resolveDecisionDims(c, q.dims);
        const decisionDims = await computeDecisionDims(c, sa, sb, dims);
        if (decisionDims.length > 0) result.decisionDims = decisionDims;
      }
    }
    return result;
  });
  app.get("/a/v1/sim/propagation-rules", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.propagation");
    const published = (req.query as { published?: string })?.published !== "false";
    return { items: await repos.sim.listPropagationRules(c.tenantId, published) };
  });
  app.post("/a/v1/sim/propagation-rules", async (req, reply) => {
    const c = ctx(req); await requireSim(c, "sim.propagation");
    const r = PropagationRuleSchema.parse({ ...(req.body as object), id: newId("simpr"), tenantId: c.tenantId });
    await repos.sim.putPropagationRule(r);
    return reply.status(201).send(r);
  });
  // 增量 4：沙盘视图配置——由租户**本体 + 传导规则派生**（零业务常数 R14：节点/边/状态变量全来自
  // 租户自己的本体，换行业=换本体内容不改代码）。前端 5 屏从此渲染。
  app.get("/a/v1/sim/view-config", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.sandbox");
    const types = await repos.ontologyTypes.list(c.tenantId);
    const links = await repos.ontologyLinks.list(c.tenantId);
    const rules = await repos.sim.listPropagationRules(c.tenantId, true);
    const stateVars = [...new Set(rules.flatMap((r) => [r.sourceStateVar, r.targetStateVar]))].sort();
    // P0 修：每 nodeType → 真物化对象 id（= tick 引擎 idsByType 同源：repos.objects.listByType 非 mergedInto，稳定排序）。
    // SIM-REAL-SNAPSHOT（簇D 治本）：同一遍历顺带取每对象**真实当前属性态**（obj.props 命中 stateVar 名的数值属性），
    // baseSnapshot 由此播——推演从后端真世界态起跑（不再 hash(oid)）。无真值的对象/变量此处缺省（诚实空态，绝不合成）。
    const nodeObjectIds: Record<string, string[]> = {};
    for (const t of types) {
      const objs = (await repos.objects.listByType(c.tenantId, t.key))
        .filter((o) => !o.mergedInto)
        .sort((a, b) => a.id.localeCompare(b.id));
      nodeObjectIds[t.key] = objs.map((o) => o.id);
    }
    // 真快照（buildRealSnapshot 同源，Trial Tick 起跑态与此一字不差）：obj.props 命中 stateVar 名的真实数值。
    const nodeObjectState: Record<string, Record<string, number>> = await buildRealSnapshot(c, stateVars);
    // WO-SANDBOX-TRUST-BADGE（S2·暗发·关 sim.trust_badge = nodeObjectMode 缺席 = view-config 输出字节一致）：
    // 逐 (对象,变量) 诚信位透传（origin 血缘 + C09 新鲜度·纯派生·绝不造 LIVE）。前端 Dev-3 DataModeBadge 消费此位。
    const trustBadge = await features.enabled(c.tenantId, "sim.trust_badge");
    const nodeObjectMode = trustBadge ? deriveCellMode(await loadTrustContext(c), nodeObjectState) : undefined;
    const cfg = {
      tenantId: c.tenantId,
      nodeTypes: types.map((t) => t.key).sort(),
      nodeObjectIds,
      nodeObjectState,
      ...(nodeObjectMode && Object.keys(nodeObjectMode).length > 0 ? { nodeObjectMode } : {}),
      heatThreshold: DEFAULT_SANDBOX_HEAT_THRESHOLD,
      linkTypes: links.map((l) => l.key).sort(),
      stateVars,
      radarDims: [
        { key: "structure", label: "结构" },
        { key: "knowledge", label: "知识" },
        { key: "behavior", label: "行为" },
      ],
      screens: ["pipeline", "entity", "readiness", "init", "sandbox"] as const,
      propagationCount: rules.length,
    };
    return SandboxViewConfigSchema.parse(cfg);
  });

  // ---- 推演沙盘 · 增量 2：就绪认证（SimCertification = 投影既有 closure，零新校验 RL3）----
  // SPEC docs/SPEC-sandbox-readiness-certification.md。端点只装配既有 closure/gaps/Trial Tick 输入，
  // 真正的判级/三维/L4/世界完整度由纯函数 deriveCertification 投影（门 check-sim-readiness.mjs 守纯度）。
  const CLOSURE_POLICY: ClosurePolicy = {
    object: { mode: "HARD", fallback: ["BIND_EXISTING_SLICE", "CREATE_SLICE"] },
    data: { mode: "SOFT", onOrphan: "PASS_AND_MARK" },
    forward: { mode: "HARD" },
  };

  /**
   * 从 live 本体装配认证三件输入（closure/gaps/trial）+ scope 计数 —— 全部复用既有产物，零新校验。
   * scope=LOCAL 时按 target（typeKey）裁出子图；GLOBAL 时全本体。computedAt 由调用方传入（R6）。
   */
  const assembleCertification = async (
    c: AuthCtx,
    scopeKind: "GLOBAL" | "LOCAL",
    target: string | null,
    computedAt: string,
  ) => {
    const allTypes = await ontology.listTypes(c);
    const types = scopeKind === "LOCAL" && target ? allTypes.filter((t) => t.key === target) : allTypes;
    const typeKeys = new Set(types.map((t) => t.key));
    const allActions = await actions.listTypes(c);
    const allRules = await repos.rules.list(c.tenantId, (r) => r.status === "PUBLISHED");
    const allSlices = await repos.sliceSpecs.list(c.tenantId);
    const allProps = await repos.sim.listPropagationRules(c.tenantId, false);

    // 派生 present（CORE-E2-PROPAGATE C3 · 真值驱动·非声明即算）：本体声明的每条派生属性，若 scope 内
    // ≥1 真对象携带该属性的**真实有限数值** → present（真物化）；否则仅本体声明未物化 → 否。清空对象派生值即 present 掉（teeth）。
    // sourceVars 从派生公式抽真实依赖（Type.prop 引用 + 同型裸属性引用），供扇出计数与 entering 溯源（R13）。
    const AGG_KW = new Set(["SUM", "MIN", "MAX", "AVG", "COUNT", "BY", "IF", "COALESCE", "CLAMP", "WHERE", "this"]);
    const derivationSourceVars = (typeKey: string, formula: string): string[] => {
      const out = new Set<string>();
      const qualified = new Set<string>();
      for (const m of formula.matchAll(/([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g)) { out.add(`${m[1]}.${m[2]}`); qualified.add(m[1]!); qualified.add(m[2]!); }
      for (const m of formula.matchAll(/[A-Za-z_]\w*/g)) {
        const id = m[0];
        if (AGG_KW.has(id) || qualified.has(id)) continue;
        out.add(`${typeKey}.${id}`);
      }
      return [...out].sort();
    };
    const derivations: { typeKey: string; propKey: string; sourceVars: string[]; present: boolean }[] = [];
    for (const t of [...types].sort((a, b) => a.key.localeCompare(b.key))) {
      const objs = (await repos.objects.listByType(c.tenantId, t.key)).filter((o) => !o.mergedInto);
      for (const dp of t.derivedProperties) {
        const present = objs.some((o) => { const v = (o.props as Record<string, unknown>)[dp.propKey]; return typeof v === "number" && Number.isFinite(v); });
        derivations.push({ typeKey: t.key, propKey: dp.propKey, sourceVars: derivationSourceVars(t.key, dp.formula), present });
      }
    }
    const propRules = allProps.filter((p) => typeKeys.has(p.sourceTypeKey) || typeKeys.has(p.targetTypeKey));
    const slices = allSlices.filter((s) => typeKeys.has(s.spec.root.typeKey));
    // observability：被 ≥1 切片 root 覆盖的对象集合。
    const coveredTypeKeys = new Set(allSlices.map((s) => s.spec.root.typeKey));
    // writeback ActionType：scope 内（checkRules/scope 暂无显式 targetType → 全本体动作均视作可写本体）。
    const scopeActions = allActions; // ActionType 无 targetTypeKey 字段，按全本体计数（§2.2 writeback=ActionType 计数）

    // ── 投影 closure（复用 validateClosure，唯一允许的 closure 校验器）────────────
    const plan: BuildPlan = {
      id: `simcert_${c.tenantId}`, tenantId: c.tenantId, builderKey: "sim-cert", scriptHash: "", seed: 0,
      script: "", createdAt: computedAt,
      dataSources: [],
      objectTypes: types.map((t) => ({
        typeKey: t.key, displayName: t.displayName, domain: t.domain ?? "unassigned",
        sourceDataset: undefined,
        // PlanObjectProperty 不含 "json" 型 → 折成 "string"（仅供 closure OBJECT/FORWARD 维投影，不影响判级）。
        properties: t.properties.map((p) => ({ propKey: p.propKey, dataType: p.dataType === "json" ? ("string" as const) : p.dataType, isPrimaryKey: p.isPrimaryKey, refToTypeKey: p.refToTypeKey ?? null })),
      })),
      rules: allRules.filter((r) => r.scopeObjectTypes.some((k) => typeKeys.has(k))).map((r) => ({
        key: r.key, name: r.name, expression: r.expression, scopeObjectTypes: r.scopeObjectTypes, severity: r.severity,
      })),
      solverNeeds: [], kbDocs: [], dataDependencies: {},
      sliceNeeds: [], intentNeeds: [], planNeeds: [], workflowNeeds: [], skillNeeds: [], agentNeeds: [], mcpNeeds: [], sceneNeeds: [],
      propagationRuleNeeds: [], stateVarNeeds: [],
    };
    const closure = validateClosure(plan, CLOSURE_POLICY, "STRICT");
    const gaps = selfCheckGaps("", `simcert_${c.tenantId}`, closure, undefined, 0);

    // ── Trial Tick（§3 · CORE-E2-PROPAGATE C1）：派生跑 recompute + 传导真跑 propagateTick（兑现增量3，非记 0）──
    let trial: TrialTickInput;
    try {
      const rc = await ontologyCore.recompute(c, [], { dryRun: true });
      // 传导 Trial：在**真对象态快照**上真跑一遍 propagateTick（与真沙盘 /tick 同一逻辑），统计真实触发的
      // 传导规则数（产生即时贡献或落延迟 pending 的规则）。无真源 → snapshot 空 → 触发 0（诚实，teeth）。
      const publishedProps = await repos.sim.listPropagationRules(c.tenantId, true);
      let firedProp = 0;
      if (publishedProps.length > 0) {
        const { graph, ruleParams } = await buildPropagationInputs(c);
        const svs = [...new Set(publishedProps.flatMap((p) => [p.sourceStateVar, p.targetStateVar]))];
        const snap = await buildRealSnapshot(c, svs);
        const out = propagateTick(graph, snap, publishedProps, [], 0, ruleParams);
        const fired = new Set<string>();
        for (const tr of out.trace) if (tr.fromObjectId !== "(delayed)") fired.add(tr.ruleKey); // 即时贡献
        for (const p of out.pending) fired.add(p.ruleKey); // 落延迟队列（延迟规则亦真触发）
        firedProp = fired.size;
      }
      // rulesFired = 派生（recompute topo）真跑数 + 传导真触发规则数（真值驱动，非记 0）。
      trial = { passed: true, rulesFired: rc.order.length + firedProp, at: computedAt, error: null };
    } catch (e) {
      // 派生图有环（CYCLIC_DERIVATION）等 → 诚实标 FAIL，不假装通过。
      trial = { passed: false, rulesFired: 0, at: computedAt, error: e instanceof Error ? e.message : String(e) };
    }

    // ── scope 计数（投影，给纯函数）────────────────────────────────────────────
    const consumed = (t: (typeof types)[number]): number =>
      t.properties.filter((p) => allRules.some((r) => r.expression.includes(`${t.key}.${p.propKey}`)) || t.derivedProperties.length > 0).length;
    const scope: CertScope & { computedAt: string } = {
      kind: scopeKind, targetRef: scopeKind === "LOCAL" ? target : null, computedAt,
      objectTypes: types.map((t) => ({
        typeKey: t.key,
        bound: !!t.domain && t.domain !== "unassigned",
        fieldCount: t.properties.length,
        consumedFieldCount: consumed(t),
        sliceCovered: coveredTypeKeys.has(t.key),
        behaviorReady: t.derivedProperties.length > 0 && scopeActions.length > 0,
      })),
      derivations,
      actions: scopeActions.map((a) => ({ key: a.key, targetTypeKey: null })),
      slices: slices.map((s) => ({ key: s.sliceKey })),
      propagationRules: propRules.map((p) => ({
        key: p.key, sourceTypeKey: p.sourceTypeKey, sourceStateVar: p.sourceStateVar,
        targetTypeKey: p.targetTypeKey, targetStateVar: p.targetStateVar, present: true,
      })),
      needed: {
        stateVars: types.reduce((a, t) => a + t.derivedProperties.length, 0),
        derivationRules: types.reduce((a, t) => a + t.derivedProperties.length, 0),
        actions: Math.max(scopeActions.length, types.length > 0 ? 1 : 0),
        propagationRules: propRules.length, // 增量3 才声明传导 needed；当前 present=needed（不虚减完整度）
      },
    };
    return deriveCertification(closure, gaps, trial, scope, DEFAULT_CERT_CONFIG);
  };

  app.get("/a/v1/sim/sessions/:id/certification", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.certification");
    await getSimOr404(c, (req.params as { id: string }).id); // 404 隔离（R2 租户）
    const q = req.query as { scope?: string; target?: string };
    const scopeKind = q.scope === "LOCAL" ? "LOCAL" : "GLOBAL";
    const computedAt = new Date().toISOString();
    const cert = await assembleCertification(c, scopeKind, q.target ?? null, computedAt);
    // WO-S6 §3.6 L3 回放校验接线（暗发·关闸=v1.1 行为字节一致）：给 L3"已验证"实义——关键传导规则拿 A8
    // 历史回放，容差内才 VALIDATED（S2 徽标 UNCALIBRATED→VALIDATED 唯一转正路径·母体 §8 G-10）。
    if (await temporalGroundingOn(c)) {
      const rules = await repos.sim.listPropagationRules(c.tenantId, true); // PUBLISHED
      const replayValidation = await runReplayValidation(c, rules, computedAt);
      const gaps = [...cert.gaps];
      if (rules.length > 0 && replayValidation.status === "NO_HISTORY") {
        // 有已发布规则却无 A8 历史可校验 → 诚实 UNCALIBRATED（绝不假装 L3 已验证·KILL-MOCK-RED）。
        gaps.push({ gapCode: "RULES_UNCALIBRATED", ref: scopeKind === "LOCAL" ? (q.target ?? "GLOBAL") : "GLOBAL", detail: `${rules.length} 条已发布传导规则无 A8 历史可回放校验 → 系数仍 UNCALIBRATED（诚实·非假验证）。` });
      } else if (replayValidation.status === "OUT_OF_TOLERANCE") {
        const bad = replayValidation.rules.filter((r) => r.status === "OUT_OF_TOLERANCE").map((r) => r.ruleKey);
        gaps.push({ gapCode: "RULES_OUT_OF_TOLERANCE", ref: bad.join(",") || "GLOBAL", detail: `传导规则回放超差（未在容差 ${replayValidation.window.tolerance} 内）：${bad.join("·")}。系数需校准后重试。` });
      }
      // l3Validated：L3"已验证"的真义（=关键规则回放容差内）；replayValidation 全量供 S2 徽标转正消费。
      return { ...cert, gaps, replayValidation, l3Validated: replayValidation.status === "VALIDATED" };
    }
    return cert;
  });

  app.get("/a/v1/sim/sessions/:id/scope-precheck", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.sandbox");
    await getSimOr404(c, (req.params as { id: string }).id);
    const q = req.query as { scope?: string; target?: string; horizon?: string };
    const scopeKind = q.scope === "LOCAL" ? "LOCAL" : "GLOBAL";
    const cert = await assembleCertification(c, scopeKind, q.target ?? null, new Date().toISOString());
    // init step③ 世界完整度预检视图：只回完整度 + 将进入沙盘清单 + 缺件（轻量子集）。
    const base = { scope: cert.scope, targetRef: cert.targetRef, worldCompleteness: cert.worldCompleteness, canEnterSimulation: cert.canEnterSimulation, gaps: cert.gaps };
    // WO-S6 §3.6 horizon 覆盖预检（暗发）：hold/60 天类请求（?horizon=60）init 前查"需求预测覆盖 horizon 吗"，
    // 不足 → 缺口卡（喂 GrowthTicket），绝不静默截断/外推（KILL-MOCK-RED）。关闸/无 horizon 参数=原视图不变。
    const requestedTicks = Math.max(0, Math.floor(Number(q.horizon ?? 0)));
    if (requestedTicks > 0 && (await temporalGroundingOn(c))) {
      const horizonCoverage = await computeHorizonCoverage(c, requestedTicks);
      const gaps = horizonCoverage.sufficient ? base.gaps : [...base.gaps, ...horizonCoverage.gaps];
      return { ...base, horizonCoverage, gaps };
    }
    return base;
  });

  // ---- A4 ontology + objects --------------------------------------------------------
  // Dogfooding（#12/#13）：系统本体自反落库 + 活查询面。鉴权 = MetaAccessPolicy 角色白名单（默认 admin,可配置）。
  const requireMetaAccess = async (c: AuthCtx) => {
    // Entitlement 先于 authz（铁律）：功能关闭 = 不存在 → 404 FEATURE_NOT_FOUND，先于角色门。
    if (!(await features.enabled(c.tenantId, "admin.meta-ontology"))) throw featureNotFound();
    if (!(await metaOntology.hasAccess(c))) throw forbidden("无 /meta 访问权（默认仅 admin；可在 meta access-policy 配置角色白名单）");
  };
  app.post("/a/v1/meta/sync", async (req) => {
    const c = ctx(req);
    await requireMetaAccess(c);
    return metaOntology.sync(c);
  });
  app.get("/a/v1/meta/ontology", async (req) => {
    const c = ctx(req);
    await requireMetaAccess(c);
    const objs = await metaOntology.listAll(c);
    const byKind: Record<string, number> = {};
    for (const o of objs) byKind[o.type] = (byKind[o.type] ?? 0) + 1;
    return { total: objs.length, byKind };
  });
  app.get("/a/v1/meta/breakpoints/:id", async (req) => {
    const c = ctx(req);
    await requireMetaAccess(c);
    const bp = await metaOntology.getBreakpoint(c, (req.params as { id: string }).id);
    if (!bp) throw notFound("system breakpoint");
    return bp;
  });
  // 通用元对象读取：invariants/events/domains/slices/object-types
  for (const [seg, kind] of [["invariants", "SystemInvariant"], ["events", "SystemEvent"], ["domains", "SystemDomain"], ["slices", "SystemSlice"], ["object-types", "SystemObjectType"]] as const) {
    app.get(`/a/v1/meta/${seg}/:id`, async (req) => {
      const c = ctx(req);
      await requireMetaAccess(c);
      const node = await metaOntology.getNode(c, kind, decodeURIComponent((req.params as { id: string }).id));
      if (!node) throw notFound(`system ${seg}`);
      return node;
    });
  }
  app.get("/a/v1/meta/impact", async (req) => {
    const c = ctx(req);
    await requireMetaAccess(c);
    const node = String((req.query as { node?: string }).node ?? "");
    if (!node) throw validationError("node required");
    return metaOntology.impact(c, node);
  });
  // P4 #14 自动派生（保守、只读）：code 求解器注册表 vs 本体 markdown diff;只产 diff 不写。
  app.get("/a/v1/meta/derive", async (req) => {
    const c = ctx(req);
    await requireMetaAccess(c);
    return metaOntology.deriveDiff(c, [...SOLVER_KEYS]);
  });
  // 鉴权策略读写（admin only —— 谁能配"哪些角色可访问 /meta"）
  app.get("/a/v1/meta/access-policy", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return metaOntology.getAccessPolicy(c);
  });
  app.put("/a/v1/meta/access-policy", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const body = parseBody(MetaAccessPolicyBodySchema, req.body);
    return metaOntology.setAccessPolicy(c, body.roles);
  });

  app.get("/a/v1/ontology/object-types", async (req) => ontology.listTypes(ctx(req)));
  // A4 对象/类型浏览器：每已发布类型 {域(归 14 域注册表)/属性数/派生数/PK/物化对象数}，一次算（避免 N 次聚合）。
  // 轨A P1 逐对象就绪%：三真后端维度算出（零写死 R14 / 确定性 R6 / 缺数诚实标 estimated）——
  //  ① boundCoverage：非派生属性中"被 sourceBindings.fieldMappings 映射到源字段"（= 有 provenance）的占比
  //     （R12 反向-data「字段必被消费」口径；PK 计入——须能溯源至源字段才算建模到位）。
  //  ② hasBindings：是否存在任一 sourceBinding（= 该类型有 provenance 锚 / 非凭空直注）。
  //  ③ materialized：是否已物化出对象（count>0，= 从类型定义走到了实例库）。
  //  readiness = round(100*(0.6*boundCoverage + 0.2*hasBindings + 0.2*materialized))，全由真后端字段算、确定性。
  //  无 sourceBindings 整体（如沙盘链路类型/纯派生外缘）→ boundCoverage 维无数据 → estimated 标记，前端诚实降级不裸渲染。
  app.get("/a/v1/ontology/object-types/stats", async (req) => {
    const c = ctx(req);
    const types = await ontology.listTypes(c);
    const stats = [];
    for (const t of types) {
      const objs = await repos.objects.listByType(c.tenantId, t.key);
      const count = objs.filter((o) => !o.mergedInto).length;
      // 已被某 sourceBinding 的 fieldMappings 映射到源字段的属性集（= 有 provenance 的属性）。
      const boundProps = new Set<string>();
      for (const b of t.sourceBindings ?? []) for (const pk of Object.keys(b.fieldMappings ?? {})) boundProps.add(pk);
      const sourceProps = t.properties.length; // 分母：非派生属性（派生属性由公式算、不来自源字段）。
      const boundCount = t.properties.filter((p) => boundProps.has(p.propKey)).length;
      const boundCoverage = sourceProps > 0 ? boundCount / sourceProps : 0;
      const hasBindings = (t.sourceBindings?.length ?? 0) > 0;
      const materialized = count > 0;
      const estimated = !hasBindings; // 无源绑定 → 绑定覆盖维无数据，诚实标。
      const readiness = Math.round(
        100 * (0.6 * boundCoverage + 0.2 * (hasBindings ? 1 : 0) + 0.2 * (materialized ? 1 : 0)),
      );
      stats.push({
        key: t.key,
        displayName: t.displayName,
        domain: t.domain ?? GRAPH_DOMAIN[t.key] ?? "unassigned",
        propCount: t.properties.length,
        derivedCount: t.derivedProperties?.length ?? 0,
        pk: t.properties.find((p) => p.isPrimaryKey)?.propKey ?? null,
        count,
        // 逐对象就绪%三维分解（真后端字段算，前端展开可见证据）。
        readiness,
        boundCount,
        sourceProps,
        hasBindings,
        materialized,
        estimated,
      });
    }
    return { stats };
  });

  // PRD-fde §3.2 实体与字段目录索引（P1 读模型）：
  // 字段目录（类型→字段,标时序）+ 消歧（模糊实体→系统里具体候选,绝不带占位符进数据生成）。
  app.get("/a/v1/entity-catalog", async (req) => {
    const c = ctx(req);
    return { items: buildFieldCatalog(await ontology.listTypes(c)) };
  });
  app.get("/a/v1/entity-catalog/resolve", async (req) => {
    const c = ctx(req);
    const q = req.query as { q?: string; type?: string; topK?: string };
    if (!q.q) throw validationError("缺少查询参数 q");
    const candidates = await resolveEntity(c, String(q.q), ontology, { type: q.type, topK: q.topK ? Number(q.topK) : 5 });
    // 命中=具体候选;空=域外（调用方走 InputManifest 补录,不猜）
    return { query: q.q, resolved: candidates.length > 0, candidates };
  });

  // DF.5 语义目录检索：自然语言 → 具体 {typeKey.propKey}（按字段名/业务描述/单位语义匹配），
  // 喂生成接地与字段发现（"我要算毛利率"落到真实列），R2 仅本租户已发布本体、确定性排序（R6）。
  app.get("/a/v1/catalog/search", async (req) => {
    const c = ctx(req);
    const q = req.query as { q?: string; type?: string; topK?: string };
    if (!q.q) throw validationError("缺少查询参数 q");
    const hits = searchCatalog(await ontology.listTypes(c), String(q.q), {
      ...(q.type ? { type: q.type } : {}),
      ...(q.topK ? { topK: Number(q.topK) } : {}),
    });
    return { query: q.q, found: hits.length > 0, hits };
  });

  // DF.6 拉取靶登记表 + 覆盖校验：视图声明要拉的求解器输出字段（layout.outputFields）↔ SOLVER_OUTPUT_SHAPES，
  // 未满足（视图要、求解器算不出）→ UNMET（= 缺该输出字段 → TO_CREATE 生长信号，G-8/R12 输出侧）。
  app.get("/a/v1/views/pull-targets", async (req) => {
    const c = ctx(req);
    const role = (req.query as { role?: string }).role;
    const configs = await repos.viewConfigs.list(c.tenantId, (v) => !role || v.role === role);
    const seen = new Map<string, { key: string; layout?: Record<string, unknown> }>();
    for (const v of configs.flatMap((vc) => vc.views)) if (!seen.has(v.key)) seen.set(v.key, { key: v.key, layout: v.layout });
    const targets = deriveViewPullTargets([...seen.values()]);
    const findings = checkPullTargetCoverage(targets, SOLVER_OUTPUT_SHAPES);
    const unmet = unmetPullTargets(findings);
    return { targets, findings, unmet, covered: unmet.length === 0 };
  });

  // DF.7 边界影响图：改某条单一来源边界册（BASE/SEG）会波及谁——回答铁律0「改 X 影响什么」。
  // ?registry=BASE_REGISTRY|SEG_REGISTRY 可只看一条；members 派生自册长（改册自动同步）。
  app.get("/a/v1/boundary/impact", async (req) => {
    const reg = (req.query as { registry?: string }).registry;
    const impact = reg ? BOUNDARY_IMPACT.filter((b) => b.registry === reg) : BOUNDARY_IMPACT;
    return { impact, registries: BOUNDARY_IMPACT.map((b) => b.registry) };
  });

  // DF.10 边界册版本：semver + 各册内容指纹（改值留痕/跨服务缓存失效锚）。确定性（R6）。
  app.get("/a/v1/boundary/version", async () => boundaryVersion());

  // PRD-fde §3.5 能力清单(schema 级) + 比对差异：知现状→算缺口（建之前就知缺什么）。
  const buildInventory = async (c: AuthCtx): Promise<CapabilityInventory> => ({
    objectTypes: (await ontology.listTypes(c)).filter((t) => t.status === "ACTIVE").map((t) => t.key),
    rules: (await rules.list(c, "PUBLISHED")).map((r) => r.key),
    solvers: [...SOLVER_KEYS],
    slices: (await repos.sliceSpecs.list(c.tenantId)).map((s) => s.sliceKey),
  });
  app.get("/a/v1/capability-inventory", async (req) => buildInventory(ctx(req)));
  app.post("/a/v1/capability-inventory/diff", async (req) => {
    const c = ctx(req);
    const needs = parseBody(CapabilityNeedsSchema, req.body);
    return diffNeeds(needs, await buildInventory(c));
  });

  // A2 在线数据模版（G-6 收口）：从本租户已发布对象类型派生"该上传哪些列"的 CSV 模版；
  // ?withSamples=N&seed= 时多表 FK 一致生成样例（ref 值必指向父表实际 PK，可直接试灌）。
  app.get("/a/v1/data-templates", async (req) => {
    const c = ctx(req);
    const q = req.query as { withSamples?: string; seed?: string };
    const types = await ontology.listTypes(c);
    return { items: buildDataTemplates(types, { withSamples: q.withSamples ? Number(q.withSamples) : 0, seed: q.seed ? Number(q.seed) : 42 }) };
  });
  // 单类型模版直接下载（text/csv）。
  app.get("/a/v1/data-templates/:typeKey", async (req, reply) => {
    const c = ctx(req);
    const { typeKey } = req.params as { typeKey: string };
    const q = req.query as { withSamples?: string; seed?: string };
    const types = await ontology.listTypes(c);
    const tpl = buildDataTemplate(types, typeKey, { withSamples: q.withSamples ? Number(q.withSamples) : 0, seed: q.seed ? Number(q.seed) : 42 });
    if (!tpl) throw validationError(`未知对象类型 '${typeKey}'（本租户）`);
    return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${typeKey}.template.csv"`).send(tpl.csv);
  });
  // PANORAMA-FIELD-INTAKE（G-6 邻域）：全景类型 × 字段供给覆盖矩阵——以图谱全景对象节点全集
  // （= ACTIVE 已发布类型，与 /a/v1/ontology/graph 同源）为完备性基准，逐类型盘点
  // 非派生 props vs 上传模版列（G-6 数据模版/FK）∪ 连接器 sourceBindings.fieldMappings；
  // 缺口字段级清单化（非模糊），连接器缺源字段诚实进 unmapped（非隐藏）。纯派生 R14/R6。
  app.get("/a/v1/intake-coverage", async (req) => {
    const c = ctx(req);
    const types = await ontology.listTypes(c);
    return buildIntakeCoverage(types, dataCategoriesForIndustry());
  });
  // 数据接入分类（数据接入控制台）：按业务域把"目前的数据"归类（销售订单/物料/设备台账…）；
  // 每类可设 系统对接/文件上传，文件上传走该类对象类型派生的字段模版（可看可下载）。
  app.get("/a/v1/data-categories", async (req) => {
    const c = ctx(req);
    const cats = dataCategoriesForIndustry();
    const types = await ontology.listTypes(c);
    const tplByType = new Map(buildDataTemplates(types).map((t) => [t.typeKey, t]));
    const overrides = await repos.dataCategorySettings.list(c.tenantId);
    const ovOf = (key: string) => overrides.find((o) => o.categoryKey === key);
    return {
      items: cats.map((cat) => {
        const ov = ovOf(cat.key);
        return {
          ...cat,
          mode: ov?.mode ?? cat.defaultMode,
          // 用户上传 CSV 替换的自定义模版列（设置后前端显示"自定义"；未设=本体派生列）。
          customColumns: ov?.customColumns ?? null,
          // 该类对象类型 + 各自上传列数（前端可见"分类里有哪些数据/字段"）。
          types: cat.typeKeys.map((tk) => ({ typeKey: tk, displayName: tplByType.get(tk)?.displayName ?? tk, columns: tplByType.get(tk)?.columns ?? [], present: tplByType.has(tk) })),
        };
      }),
    };
  });
  // 分类上传模版（可看 JSON / ?format=csv 下载该类全部类型的合并 CSV）。
  app.get("/a/v1/data-categories/:key/template", async (req, reply) => {
    const c = ctx(req);
    const { key } = req.params as { key: string };
    const q = req.query as { withSamples?: string; seed?: string; format?: string };
    const cat = dataCategoriesForIndustry().find((x) => x.key === key);
    if (!cat) throw validationError(`未知数据分类 '${key}'`);
    const ov = (await repos.dataCategorySettings.list(c.tenantId)).find((o) => o.categoryKey === key);
    // 自定义模版（用户上传 CSV 替换）优先于本体派生列。
    if (ov?.customColumns && ov.customColumns.length > 0) {
      if (q.format === "csv") {
        return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${key}.template.csv"`).send(ov.customColumns.join(","));
      }
      return { category: { key: cat.key, displayName: cat.displayName, description: cat.description, mode: ov.mode ?? cat.defaultMode, modes: cat.modes, connectorTypeKeys: cat.connectorTypeKeys }, custom: true, templates: [{ typeKey: "__custom__", displayName: "自定义模版", columns: ov.customColumns, primaryKey: null, refColumns: [], csv: ov.customColumns.join(",") }] };
    }
    const types = await ontology.listTypes(c);
    const opts = { withSamples: q.withSamples ? Number(q.withSamples) : 0, seed: q.seed ? Number(q.seed) : 42 };
    const templates = cat.typeKeys.map((tk) => buildDataTemplate(types, tk, opts)).filter((t): t is NonNullable<typeof t> => !!t);
    if (q.format === "csv") {
      const csv = templates.map((t) => `# ${t.displayName} (${t.typeKey})\n${t.csv}`).join("\n\n");
      return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${key}.template.csv"`).send(csv);
    }
    return { category: { key: cat.key, displayName: cat.displayName, description: cat.description, mode: cat.defaultMode, modes: cat.modes, connectorTypeKeys: cat.connectorTypeKeys }, custom: false, templates };
  });
  // 分类设置写入唯一通道：读-改-写同一记录（保留另一字段）。
  const upsertCategorySetting = async (tenantId: string, key: string, patch: { mode?: import("@platform/contracts").IngestMode; customColumns?: string[] | null }) => {
    const id = `dcs_${tenantId}_${key}`;
    const prev = await repos.dataCategorySettings.get(tenantId, id);
    const rec = {
      id, tenantId, categoryKey: key,
      mode: patch.mode ?? prev?.mode,
      customColumns: patch.customColumns === null ? undefined : (patch.customColumns ?? prev?.customColumns),
      updatedAt: new Date().toISOString(),
    };
    await repos.dataCategorySettings.put(rec);
    return rec;
  };
  // 设置分类接入方式（系统对接/文件上传，按租户持久化覆盖；admin）。
  app.put("/a/v1/data-categories/:key/mode", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const { key } = req.params as { key: string };
    const cat = dataCategoriesForIndustry().find((x) => x.key === key);
    if (!cat) throw validationError(`未知数据分类 '${key}'`);
    const mode = IngestModeSchema.parse((req.body as { mode?: unknown })?.mode);
    if (!cat.modes.includes(mode)) throw validationError(`分类 '${key}' 不支持接入方式 '${mode}'`);
    return upsertCategorySetting(c.tenantId, key, { mode });
  });
  // 替换分类模版（用户上传 CSV 的列头作为自定义模版；columns=[] 复位为本体派生模版；admin）。
  app.put("/a/v1/data-categories/:key/template", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const { key } = req.params as { key: string };
    const cat = dataCategoriesForIndustry().find((x) => x.key === key);
    if (!cat) throw validationError(`未知数据分类 '${key}'`);
    const cols = z.array(z.string().min(1)).parse((req.body as { columns?: unknown })?.columns);
    return upsertCategorySetting(c.tenantId, key, { customColumns: cols.length > 0 ? cols : null });
  });
  // 本体切片字段覆盖检查（铁律："所有字段实体都需被至少一个本体切片覆盖"）+ 分类归并完整性。
  app.get("/a/v1/field-coverage", async (req) => {
    const c = ctx(req);
    const types = await ontology.listTypes(c);
    const links = await repos.ontologyLinks.list(c.tenantId);
    const slices = await repos.sliceSpecs.list(c.tenantId);
    const fieldCoverage = computeFieldCoverage(types, links, slices.map((s) => ({ sliceKey: s.sliceKey, spec: s.spec })));
    const categoryCoverage = computeCategoryCoverage(types, dataCategoriesForIndustry());
    return { fieldCoverage, categoryCoverage };
  });

  // 约束执行层：工具/外部/MCP 输出按本体对象类型 schema + 属性值域强制校验（可配置,按租户）。
  // policy 缺省用全局默认（安全侧 REJECT）;调用方（连接器导入/MCP 工具执行器）按源覆盖。
  app.post("/a/v1/ontology/validate-output", async (req) => {
    const c = ctx(req);
    const body = parseBody(ValidateOutputBodySchema, req.body);
    const typeDef = (await ontology.listTypes(c)).find((t) => t.key === body.objectType);
    if (!typeDef) throw validationError(`未知对象类型 '${body.objectType}'（本租户）`);
    // 有效策略 = 连接器持久化基线（适配该源）← 被显式 body.policy 覆盖 ← 全局默认兜底
    const base = body.connId ? (await connectors.getConnection(c, body.connId)).validationPolicy : undefined;
    const policy = ValidationPolicySchema.parse({ ...(base ?? {}), ...(body.policy ?? {}) });
    return validateOutputAgainstOntology(body.rows, typeDef, policy);
  });
  // stage2 持久化：连接器（数据源）级校验策略 + 字段映射（按租户;前端字段画像页编辑）
  app.put("/a/v1/connections/:id/validation-policy", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const policy = ValidationPolicySchema.parse((req.body as { policy?: unknown })?.policy ?? req.body);
    return connectors.setValidationPolicy(c, (req.params as { id: string }).id, policy);
  });
  app.post("/a/v1/ontology/object-types", async (req, reply) => {
    const c = ctx(req);
    const body = parseBody(
      z.object({
        key: z.string().min(1),
        displayName: z.string().min(1),
        domain: z.string().optional(),
        properties: z.array(
          z.object({
            propKey: z.string(),
            dataType: z.enum(["string", "number", "boolean", "date", "enum", "ref", "json"]),
            isPrimaryKey: z.boolean().default(false),
            refToTypeKey: z.string().nullable().optional(),
            enumValues: z.array(z.string()).optional(),
            required: z.boolean().optional(),
            temporal: z.boolean().optional(),
            searchable: z.boolean().optional(),
            unit: z.string().optional(),
            displayFormat: z.string().optional(),
          }),
        ),
        derivedProperties: z.array(z.object({ propKey: z.string(), formula: z.string() })).default([]),
        sourceBindings: z
          .array(
            z.object({
              connId: z.string(),
              dataset: z.string(),
              fieldMappings: z.record(z.string(), z.string()),
            }),
          )
          .default([]),
      }),
      req.body,
    );
    // 治理增量 §2.1：对 PUBLISHED key 重命名请求 → 拒绝（此处 key 即标识，按既有/新建判定）。
    const existing = await ontology.getType(c, body.key);
    governance.assertRenameAllowed(existing, body.key);
    // 治理增量 §1：归域 FK 校验（提供了 domain 必须在注册表内）。
    if (body.domain) {
      const domains = await governance.listDomains(c);
      if (!domains.some((d) => d.domainKey === body.domain)) {
        throw validationError(`未知域 '${body.domain}'（需先在 /a/v1/ontology/domains 注册）`);
      }
    }
    // §4 单位字典约束
    const dict = new Set(UNIT_DICTIONARY);
    for (const p of body.properties) {
      if (p.unit && !dict.has(p.unit)) throw validationError(`未知单位 '${p.unit}'（单位字典：${UNIT_DICTIONARY.join("/")}）`);
    }
    return reply.status(201).send(await ontology.upsertType(c, body));
  });

  // ---- 治理增量 §1 域治理 ----------------------------------------------------
  app.get("/a/v1/ontology/domains", async (req) => governance.listDomains(ctx(req)));
  app.post("/a/v1/ontology/domains", async (req, reply) => {
    const body = parseBody(
      z.object({
        domainKey: z.string().min(1),
        displayName: z.string().min(1),
        color: z.string().optional(),
        ownerUserId: z.string().nullable().optional(),
        description: z.string().optional(),
      }),
      req.body,
    );
    return reply.status(201).send(await governance.upsertDomain(ctx(req), body));
  });

  // ---- 治理增量 §2.2 弃用流程 ------------------------------------------------
  app.post("/a/v1/ontology/types/:key/deprecate", async (req) => {
    const { key } = req.params as { key: string };
    const body = parseBody(z.object({ supersededBy: z.string().optional() }), req.body);
    return governance.deprecate(ctx(req), "type", key, body);
  });
  app.post("/a/v1/ontology/types/:key/retire", async (req) => {
    const { key } = req.params as { key: string };
    return governance.retire(ctx(req), "type", key);
  });
  app.post("/a/v1/ontology/links/:key/deprecate", async (req) => {
    const { key } = req.params as { key: string };
    const body = parseBody(z.object({ supersededBy: z.string().optional() }), req.body);
    return governance.deprecate(ctx(req), "link", key, body);
  });
  app.post("/a/v1/ontology/links/:key/retire", async (req) => {
    const { key } = req.params as { key: string };
    return governance.retire(ctx(req), "link", key);
  });

  // ---- 治理增量 §7.4 引用反查 ------------------------------------------------
  app.get("/a/v1/ontology/references", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const elementKind = q["elementKind"] ?? "";
    const key = q["key"] ?? "";
    if (!elementKind || !key) throw validationError("elementKind 与 key 必填");
    return governance.references(ctx(req), { elementKind, key, prop: q["prop"] });
  });
  app.get("/a/v1/slices/:key/references", async (req) => {
    const { key } = req.params as { key: string };
    return governance.sliceReferences(ctx(req), key);
  });
  app.get("/a/v1/ontology/slices/:key/references", async (req) => {
    const { key } = req.params as { key: string };
    return governance.sliceReferences(ctx(req), key);
  });

  // ---- 推演验证痕迹 Layer 2：结论断言 vs 知识图谱已有事实交叉验证 -----------------
  app.post("/a/v1/ontology/cross-validate", async (req) => {
    const body = CrossValidateRequestSchema.parse(req.body);
    return ontology.crossValidate(ctx(req), body.claims);
  });

  // ---- 治理增量 §7.2 切片契约（发布门禁 + CI 手动触发）-----------------------
  app.post("/a/v1/ontology/slice-contracts/run", async (req) => {
    const results = await governance.runSliceContracts(ctx(req).tenantId);
    return { results, allPassed: results.every((r) => r.ok), failed: results.filter((r) => !r.ok) };
  });

  // ---- 治理增量 §7.1 域 owner 会签发布请求 -----------------------------------
  app.post("/a/v1/ontology/publish-requests", async (req, reply) => {
    const c = ctx(req);
    const body = parseBody(
      z.object({ ontologyVersion: z.number().int().optional(), force: z.boolean().optional() }),
      req.body,
    );
    const ov = body.ontologyVersion ?? (await ontology.currentVersion(c.tenantId)) + 1;
    // 触及域 = 全部当前类型所属域（无更细变更集时按全域；测试可控）
    const types = await ontology.listTypes(c);
    const touchedDomains = [...new Set(types.map((t) => t.domain).filter((d): d is string => !!d))];
    const links = await repos.ontologyLinks.list(c.tenantId);
    const impact = await governance.publishImpact(c, { types, links });
    const rec = await governance.createPublishRequest(c, { ontologyVersion: ov, touchedDomains, impact, force: body.force });
    return reply.status(201).send(rec);
  });
  app.get("/a/v1/ontology/publish-requests", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return governance.listPublishRequests(ctx(req), q["status"]);
  });
  app.post("/a/v1/ontology/publish-requests/:id/signoff", async (req) => {
    const c = ctx(req);
    const { id } = req.params as { id: string };
    const q = req.query as Record<string, string | undefined>;
    const body = parseBody(
      z.object({ decision: z.enum(["APPROVE", "REJECT"]), comment: z.string().optional() }),
      req.body,
    );
    const onBehalf = q["onBehalf"] === "true";
    const rec = await governance.signoff(c, id, body, onBehalf);
    // 全域 APPROVE → 自动执行发布
    if (rec.status === "APPROVED") await ontology.publishVersion(c);
    return rec;
  });

  // ---- 治理增量 §3 检索模式（搜索/邻接/聚合，全部经 A6）----------------------
  app.get("/a/v1/objects/search", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return governance.search(ctx(req), {
      q: q["q"] ?? "",
      types: q["types"] ? q["types"].split(",").filter(Boolean) : undefined,
      domains: q["domains"] ? q["domains"].split(",").filter(Boolean) : undefined,
      limit: q["limit"] ? Number(q["limit"]) : undefined,
    });
  });
  app.get("/a/v1/objects/:id/neighbors", async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as Record<string, string | undefined>;
    const dir = q["direction"];
    return governance.neighbors(ctx(req), id, {
      linkKey: q["linkKey"],
      direction: dir === "out" || dir === "in" ? dir : undefined,
      limit: q["limit"] ? Number(q["limit"]) : undefined,
    });
  });
  app.post("/a/v1/objects/aggregate", async (req) => {
    const body = parseBody(AggregateRequestSchema, req.body);
    return governance.aggregate(ctx(req), body);
  });
  app.post("/a/v1/ontology/link-types", async (req, reply) => {
    const c = ctx(req);
    const body = parseBody(
      z.object({
        key: z.string().min(1),
        fromTypeKey: z.string(),
        toTypeKey: z.string(),
        cardinality: z.enum(["1:1", "1:N", "N:N"]),
      }),
      req.body,
    );
    return reply.status(201).send(await ontology.upsertLinkType(c, body));
  });
  app.post("/a/v1/ontology/publish", async (req) => ontology.publishVersion(ctx(req)));
  app.get("/a/v1/ontology/versions", async (req) => repos.ontologyVersions.list(ctx(req).tenantId));

  // 并发一致性 §13.1：任务启动时捕获 taskEpoch（工具层注入到后续读取的 asOfEpoch）。
  app.get("/a/v1/epoch/current", async (req) => {
    const c = ctx(req);
    return { epoch: await repos.epochs.current(c.tenantId), snapshotVersion: await ontology.snapshotVersion(c.tenantId) };
  });
  app.post("/a/v1/objects/query", async (req) => {
    const body = parseBody(ObjectsQuerySchema, req.body);
    return ontology.queryObjects(ctx(req), body.objectType, body.filter, body.limit, body.asOfEpoch);
  });
  // 前端 PRD §6.4 / §7.3：对象查询（objectRef 槽位选择器 + 台账分页 + 列筛选 f_*）。
  // 响应 { items, total }（台账/选择器消费）；同时保留 { data, snapshotVersion } 兼容旧调用。
  app.get("/a/v1/objects", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const type = q["type"] ?? "";
    if (!type) throw validationError("type query parameter is required");
    const needle = (q["q"] ?? "").toLowerCase();
    const page = Math.max(1, Number(q["page"] ?? "1") || 1);
    const pageSize = Math.min(500, Math.max(1, Number(q["pageSize"] ?? "50") || 50));
    const result = await ontology.queryObjects(ctx(req), type, {}, 1000);
    let rows = result.data as { id: string; type: string; props: Record<string, unknown> }[];
    if (needle) {
      rows = rows.filter((o) => JSON.stringify({ id: o.id, ...o.props }).toLowerCase().includes(needle));
    }
    for (const [k, v] of Object.entries(q)) {
      if (!k.startsWith("f_") || !v) continue;
      const prop = k.slice(2);
      rows = rows.filter((r) => {
        const pv = r.props[prop];
        const hay = Array.isArray(pv) ? pv.join(",") : String(pv ?? "");
        return hay.includes(v);
      });
    }
    if (q["base"]) {
      rows = rows.filter((r) => {
        const pv = r.props["bases"] ?? r.props["base"] ?? r.props["baseId"];
        return (Array.isArray(pv) ? pv.join(",") : String(pv ?? "")).includes(q["base"] as string);
      });
    }
    const total = rows.length;
    const items = rows.slice((page - 1) * pageSize, page * pageSize).map((r) => ({ id: r.id, type, props: r.props }));
    return { items, total, data: items, snapshotVersion: result.snapshotVersion };
  });
  // 外部域（EXT_SIG）：环境信号清单（一等对象 ExternalSignal；行级过滤 + tenantId 由 queryObjects 保证）。
  app.get("/a/v1/external-signals", async (req) => {
    const result = await ontology.queryObjects(ctx(req), "ExternalSignal", {}, 500);
    const rows = result.data as { id: string; props: Record<string, unknown> }[];
    const signals = rows
      .map((r) => r.props)
      .sort((a, b) => String(a.category ?? "").localeCompare(String(b.category ?? "")) || String(a.signalKey).localeCompare(String(b.signalKey)));
    // WO-FAKE-09（诚实位·不拿 mock 冒充权威实测喂决策）：外部信号目前均为合成种子（mock_external StaticAdapter·
    // 无真实 EXTERNAL 行情/政策连接器实测），source 字段的机构名仅为溯源占位——诚实标 SYNTHETIC，前端据此挂
    // DataModeBadge（复用既有诚实位徽章）。接入真实外部连接器后据对象 origin 升级 LIVE。
    return {
      signals,
      total: signals.length,
      ...(signals.length > 0 ? { dataMode: "SYNTHETIC" as const } : {}),
      snapshotVersion: result.snapshotVersion,
    };
  });
  // 外部域（EXT_SIG · 信号时序）：信号近 12 月历史（确定性，从当前值按 trend 反推；R6）。
  // 注：A8 ts_points 管道服务高频传感器序列（OEE/良率/产出）；稀疏市场信号走此轻量时序。
  app.get("/a/v1/external-signals/:key/series", async (req) => {
    const { key } = req.params as { key: string };
    const rows = (await ontology.queryObjects(ctx(req), "ExternalSignal", {}, 500)).data as { props: Record<string, unknown> }[];
    const sig = rows.find((r) => String(r.props.signalKey) === key)?.props;
    if (!sig) throw notFound(`external signal ${key}`);
    const value = Number(sig.value ?? 0);
    const trend = String(sig.trend ?? "flat");
    const slope = trend === "up" ? 0.018 : trend === "down" ? -0.018 : 0; // 月环比斜率
    const asOf = String(sig.asOf ?? new Date().toISOString().slice(0, 10));
    const base = new Date(`${asOf}T00:00:00Z`);
    const points: { month: string; value: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(base.getTime());
      d.setUTCMonth(d.getUTCMonth() - i);
      // 反推：当前值 = value；i 个月前 ≈ value / (1+slope)^i，叠加确定性小波动（由 key 长度+月序定相位）。
      const drift = value / Math.pow(1 + slope, i);
      const wobble = 1 + 0.006 * Math.sin((i + key.length) * 1.3);
      points.push({ month: d.toISOString().slice(0, 7), value: Math.round(drift * wobble * 1000) / 1000 });
    }
    return { signalKey: key, unit: sig.unit ?? "", trend, points };
  });
  // 外部域（EXT_SIG P2）：信号冲击 → 规划指标敏感性（确定性弹性：Δ指标pp = Δ信号% × elasticity，按 impact 聚合）。
  // body: { shocks: [{ signalKey, deltaPct }] }。无副作用（纯计算）；R6 确定性。
  app.post("/a/v1/external-signals/sensitivity", async (req) => {
    const body = (req.body ?? {}) as { shocks?: { signalKey?: string; deltaPct?: number }[] };
    const shocks = Array.isArray(body.shocks) ? body.shocks : [];
    const rows = (await ontology.queryObjects(ctx(req), "ExternalSignal", {}, 500)).data as { props: Record<string, unknown> }[];
    const byKey = new Map(rows.map((r) => [String(r.props.signalKey), r.props]));
    const byMetric = new Map<string, { metric: string; deltaPct: number; drivers: { signalKey: string; deltaPct: number; contributionPp: number }[] }>();
    const unknown: string[] = [];
    for (const s of shocks) {
      const sig = s.signalKey ? byKey.get(s.signalKey) : undefined;
      if (!sig) { if (s.signalKey) unknown.push(s.signalKey); continue; }
      const metric = String(sig.impact ?? "未分类");
      const elasticity = Number(sig.elasticity ?? 0);
      const dPct = Number(s.deltaPct ?? 0);
      const contributionPp = Math.round(dPct * elasticity * 100) / 100;
      const m = byMetric.get(metric) ?? { metric, deltaPct: 0, drivers: [] };
      m.deltaPct = Math.round((m.deltaPct + contributionPp) * 100) / 100;
      m.drivers.push({ signalKey: String(sig.signalKey), deltaPct: dPct, contributionPp });
      byMetric.set(metric, m);
    }
    return { impacts: [...byMetric.values()].sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct)), unknownSignals: unknown };
  });
  app.get("/a/v1/objects/:type/:id", async (req) => {
    const { type, id } = req.params as { type: string; id: string };
    return ontology.getObject(ctx(req), type, id);
  });

  // 活数据可溯（PRD-live-traceable-data §3.2）：对象 → 原始行 → RawDataset → 连接器 + 派生链。
  // 回答"这个数从哪来"——把推演结果里的一个对象/数字溯回它的源头原始数据与计算口径。
  // 复用 ontology.getObject 做 READ 鉴权 + 行级过滤 + 主键解析；再取完整对象拿 origin backref。
  app.get("/a/v1/lineage/object/:type/:id", async (req) => {
    const c = ctx(req);
    const { type, id } = req.params as { type: string; id: string };
    const payload = await ontology.getObject(c, type, id); // 404/403 if not allowed (R3/A6)
    const obj = await repos.objects.get(c.tenantId, (payload.data as { id: string }).id);
    if (!obj) throw notFound("object");
    const org = obj.origin as { type: string; jobId?: string; sourceConnId?: string; rawDatasetId?: string; rawRowIdx?: number };
    let source: unknown = null;
    if (org.rawDatasetId) {
      const ds = await repos.rawDatasets.get(c.tenantId, org.rawDatasetId);
      const conn = ds ? await repos.connections.get(c.tenantId, ds.sourceConnId) : undefined;
      const rows = ds ? await repos.rawRows.list(c.tenantId, ds.id) : [];
      const rawRow = typeof org.rawRowIdx === "number" ? (rows[org.rawRowIdx] ?? null) : null;
      source = {
        // 含 lastSyncAt → 前端据此算"数据新鲜度"（R13：源延迟→派生数字标降级）
        connection: conn ? { id: conn.id, name: conn.name, connectorTypeKey: conn.connectorTypeKey, lastSyncAt: conn.lastSyncAt ?? null } : null,
        rawDataset: ds ? { id: ds.id, name: ds.name, rowCount: ds.rowCount, fields: ds.fields.map((f) => f.name) } : null,
        rawRowIdx: org.rawRowIdx ?? null,
        rawRow,
      };
    }
    const typeDef = await ontology.getType(c, type);
    const derivations = (typeDef?.derivedProperties ?? []).map((d) => ({ prop: d.propKey, formula: d.formula }));
    return {
      object: { id: obj.id, type: obj.type, origin: obj.origin },
      source, // null = 非数据对象（如纯派生/手工）或无源头 backref
      derivations, // 该类型的派生属性（= 计算字段，非原始；展示口径）
      snapshotVersion: payload.snapshotVersion,
    };
  });
  // 前端 PRD §7.2 + 增量 §7.18：类型级本体图谱。节点 = ObjectType + 求解器 + 概念节点
  // （学习闭环/智能体网络），边带 kind 字段（flow/agg/fb/orch/calc）供视角 linkKinds 过滤。
  app.get("/a/v1/ontology/graph", async (req) => {
    const c = ctx(req);
    const types = await ontology.listTypes(c);
    const links = await repos.ontologyLinks.list(c.tenantId);
    const publishedRules = await repos.rules.list(c.tenantId, (r) => r.status === "PUBLISHED");
    const typeKeys = new Set(types.map((t) => t.key));
    const nodes: Record<string, unknown>[] = types.map((t, i) => ({
      id: `n-${t.key}`,
      key: t.key,
      label: t.displayName ?? t.key,
      kind: "object",
      domain: GRAPH_DOMAIN[t.key] ?? "factory",
      tier: Math.floor(i / 4),
      properties: (t.properties ?? []).map((p) => ({
        propKey: p.propKey,
        dataType: p.dataType,
        isPrimaryKey: p.isPrimaryKey ?? false,
      })),
      sourceBindings: t.sourceBindings ?? [],
      rules: publishedRules
        .filter((r) => (r.scopeObjectTypes ?? []).includes(t.key))
        .map((r) => ({ key: r.key, name: r.name, expression: r.expression })),
      derivations: (t.derivedProperties ?? []).map((d) => ({ propKey: d.propKey, formula: d.formula })),
    }));
    const edges: Record<string, unknown>[] = links.map((l, i) => ({
      id: `e-${l.key ?? l.id ?? i}`,
      from: `n-${l.fromTypeKey}`,
      to: `n-${l.toTypeKey}`,
      label: l.key,
      kind: "flow",
      cardinality: l.cardinality ?? "1:N",
    }));
    // 派生聚合边（SUM/COUNT/AVG… BY）：源类型 → 目标类型，kind="agg"
    for (const t of types) {
      for (const d of t.derivedProperties ?? []) {
        const agg = parseAggregate(d.formula);
        if (!agg || !typeKeys.has(agg.sourceType) || agg.sourceType === t.key) continue;
        edges.push({
          id: `e-agg-${t.key}-${d.propKey}`,
          from: `n-${agg.sourceType}`,
          to: `n-${t.key}`,
          label: d.formula,
          kind: "agg",
        });
      }
    }
    for (const solverKey of SOLVER_KEYS) {
      const meta = SOLVER_GRAPH[solverKey];
      if (!meta || !typeKeys.has(meta.target)) continue;
      nodes.push({
        id: `n-solver-${solverKey}`, key: solverKey, label: meta.label, kind: "solver",
        domain: "solver", properties: [], sourceBindings: [], rules: [], derivations: [],
      });
      edges.push({ id: `e-solver-${solverKey}`, from: `n-solver-${solverKey}`, to: `n-${meta.target}`, label: "计算", kind: "calc" });
    }
    // §7.18 概念节点（学习闭环 nodeFilter.ids 一字不差）+ fb/orch/agg/flow 边
    const nodeIds = new Set(nodes.map((n) => n.id as string));
    for (const xn of GRAPH_EXTRA_NODES) {
      nodes.push({
        id: xn.id, key: xn.key, label: xn.label, kind: xn.kind, domain: xn.domain,
        ...(xn.source ? { source: xn.source } : {}),
        properties: [], sourceBindings: [], rules: [], derivations: [],
      });
      nodeIds.add(xn.id);
    }
    GRAPH_EXTRA_EDGES.forEach((xe, i) => {
      if (!nodeIds.has(xe.from) || !nodeIds.has(xe.to)) return;
      edges.push({ id: `e-x${i}`, from: xe.from, to: xe.to, label: xe.label, kind: xe.kind });
    });
    // QUERY30-ONTOLOGY-EXT（Q30 血缘）：datasource_feeds_type 边指向"对象类型"元节点——源→类型依赖的
    // schema 级落点（降级时定位血缘下游），避免悬边。仅当确有该边时才补元节点。
    if (edges.some((e) => (e.to as string) === "n-ObjectType")) {
      nodes.push({ id: "n-ObjectType", key: "ObjectType", label: "对象类型（元）", kind: "meta", domain: "quality", properties: [], sourceBindings: [], rules: [], derivations: [] });
    }
    return { nodes, edges };
  });

  // §7.20 业务建模映射表（图谱内功能）：服务端拼装分组排序后下发
  app.get("/a/v1/ontology/mapping", async (req) => {
    const c = ctx(req);
    return buildMappingRows(repos, c.tenantId);
  });
  // PRD-IND-map §4.5-③：映射表四注册表段（关系类型 / 规则 / Action / 事件）。
  app.get("/a/v1/ontology/mapping/registries", async (req) => {
    const c = ctx(req);
    return buildMappingRegistries(repos, c.tenantId);
  });
  // 能力发现与路由 §1：资源目录（discover 供给侧；权限/功能开通过滤）
  app.get("/a/v1/catalog", async (req) => {
    const { kind, query } = req.query as { kind?: string; query?: string };
    if (kind !== "slices" && kind !== "solvers") throw validationError("kind must be slices|solvers");
    return catalog.discover(ctx(req), kind, query);
  });
  // A3.1 · 14 业务域参考注册表（配置驱动 R14）：给 A4 浏览器分组、切片规划器 tie-break、跨域接缝识别共用。
  app.get("/a/v1/business-domains", async (req) => {
    ctx(req); // 鉴权上下文（域注册表为平台参考基线，按租户读）
    return { domains: BUSINESS_DOMAINS };
  });
  // A3.3 多跳切片规划器 + A3.4 索引复用：先查索引（命中既有切片即复用 reused:true），未命中才新规划。
  app.post("/a/v1/slices/plan", async (req) => {
    const c = ctx(req);
    const body = parseBody(PlanSliceRequestSchema, req.body);
    const types = (await ontology.listTypes(c)).map((t) => ({ key: t.key, domain: t.domain }));
    const links = (await repos.ontologyLinks.list(c.tenantId)).map((l) => ({ linkKey: l.key, fromTypeKey: l.fromTypeKey, toTypeKey: l.toTypeKey }));
    const specs = (await repos.sliceSpecs.list(c.tenantId)).map((s) => ({ sliceKey: s.sliceKey, root: s.spec.root.typeKey, paths: s.spec.paths }));
    const index = buildSliceIndex(specs, links);
    let reuse = lookupReusable(index, body.rootType, body.targets);
    // E6 · 切片按近似问句复用（P2，additive）：精确覆盖未命中时，用问句（原文）与既有切片 description/
    // indexEntities 的词重叠检索命中既有切片复用，不重规划。description 派生自切片覆盖类型（R13 投影，无新存储）。
    const question = typeof (req.body as { question?: unknown })?.question === "string" ? (req.body as { question: string }).question : undefined;
    let reusedByQuestion: { sliceKey: string; score: number } | null = null;
    if (!reuse && question) {
      const descriptors = index.map((e) => ({ sliceKey: e.sliceKey, rootType: e.rootType, description: `${e.sliceKey} ${e.spannedTypes.join(" ")}`, indexEntities: e.spannedTypes }));
      reusedByQuestion = lookupReusableByQuestion(descriptors, body.rootType, question);
      if (reusedByQuestion) reuse = index.find((e) => e.sliceKey === reusedByQuestion!.sliceKey) ?? null;
    }
    const res = planSlice(types, links, body);
    if (res.ok && reuse) {
      res.plan.sliceKey = reuse.sliceKey; // A3.4：复用既有已发布切片（精确覆盖 或 E6 近似问句命中）
      res.plan.reused = true;
    }
    if (res.ok) await outbox.emit(c.tenantId, "slice.planned", { sliceKey: res.plan.sliceKey, rootType: body.rootType, reused: res.plan.reused, ...(reusedByQuestion ? { reuseMatch: "QUESTION", score: reusedByQuestion.score } : {}) });
    return res;
  });
  // A3.2 域内/跨域两库（派生）：biz.<域>.<root> 单域子图 + biz.x.<from>_to_<to> 跨域接缝。scope=intra|cross|all。
  app.get("/a/v1/slices/library", async (req) => {
    const c = ctx(req);
    const scope = (req.query as { scope?: string }).scope ?? "all";
    const types = (await ontology.listTypes(c)).map((t) => ({ key: t.key, domain: t.domain }));
    const links = (await repos.ontologyLinks.list(c.tenantId)).map((l) => ({ linkKey: l.key, fromTypeKey: l.fromTypeKey, toTypeKey: l.toTypeKey }));
    const lib = deriveSliceLibrary(types, links);
    if (scope === "intra") return { intra: lib.intra };
    if (scope === "cross") return { cross: lib.cross };
    return lib;
  });
  // A3.2 登记两库为一等 SliceSpec（幂等 putSliceSpec → 进 A3.4 索引 + QOS 可调）；发 slice.planned。
  app.post("/a/v1/slices/library/build", async (req, reply) => {
    const c = ctx(req);
    requireAdmin(c);
    const types = (await ontology.listTypes(c)).map((t) => ({ key: t.key, domain: t.domain }));
    const links = (await repos.ontologyLinks.list(c.tenantId)).map((l) => ({ linkKey: l.key, fromTypeKey: l.fromTypeKey, toTypeKey: l.toTypeKey }));
    const lib = deriveSliceLibrary(types, links);
    const all = [...lib.intra, ...lib.cross];
    for (const e of all) await ontologyCore.putSliceSpec(c, e.sliceKey, 1, libEntryToSpec(e) as never);
    await outbox.emit(c.tenantId, "slice.planned", { sliceKey: "library", rootType: "*", reused: false });
    return reply.status(201).send({ registered: all.map((e) => ({ sliceKey: e.sliceKey, scope: e.scope })), intra: lib.intra.length, cross: lib.cross.length });
  });
  // A3.4 切片索引（派生投影 R13）：按 rootType + 覆盖类型集 索引已发布切片，供规划器复用 + A4 浏览。
  app.get("/a/v1/slices/index", async (req) => {
    const c = ctx(req);
    const links = (await repos.ontologyLinks.list(c.tenantId)).map((l) => ({ linkKey: l.key, fromTypeKey: l.fromTypeKey, toTypeKey: l.toTypeKey }));
    const specs = (await repos.sliceSpecs.list(c.tenantId)).map((s) => ({ sliceKey: s.sliceKey, root: s.spec.root.typeKey, paths: s.spec.paths }));
    return { entries: buildSliceIndex(specs, links) };
  });
  app.post("/a/v1/slices/:sliceKey/resolve", async (req) => {
    const { sliceKey } = req.params as { sliceKey: string };
    const c = ctx(req);
    const body = parseBody(z.object({ args: z.record(z.string(), z.unknown()).default({}) }), req.body);
    // 先走旧内置解析器（model_capacity_network / base_risk_profile）；未命中则 fall-through 到
    // 通用 SliceSpec 引擎（executeSlice），使 Agent/Workflow 的 resolve_slice 工具能检索
    // order_fulfillment_360 / order_to_cash_720 / enterprise_360 等声明式切片（修复 P0-a）。
    try {
      return await ontology.resolveSlice(c, sliceKey, body.args);
    } catch (err) {
      if (!(err instanceof AppError && err.code === "NOT_FOUND")) throw err;
      const spec = await ontologyCore.getSliceSpec(c, sliceKey);
      if (!spec) throw err;
      const out = await ontologyCore.executeSlice(c, spec.spec, body.args);
      return { data: { nodes: out.nodes, edges: out.edges, truncated: out.truncated }, snapshotVersion: out.snapshotVersion };
    }
  });
  // A1 求解器注册表（业务场景 22 + 通用 9 = 31，feature 过滤）：供 AgentCore 构建 `solvers`
  // MCP server 的全部工具（含 A8 新模型 + 净室通用族）；附输出形状供治理页/渲染绑定校验参考。
  app.get("/a/v1/solvers/registry", async (req) => {
    const c = ctx(req);
    const { query } = req.query as { query?: string };
    const { items } = await catalog.solverRegistry(c, query);
    return { solvers: items.map((it) => ({ ...it, outputShape: SOLVER_OUTPUT_SHAPES[it.key] ?? [] })) };
  });
  // SPINE 经营目标-指标-责任骨架：指标库 / KSF / 责任人（各视图 KPI 单一出处 R-一致；Metric 经 metric_rollup 派生投影）。
  const objProps = (rows: { data: unknown }) => (rows.data as { props: Record<string, unknown> }[]).map((o) => o.props);
  app.get("/a/v1/metrics", async (req) => {
    const c = ctx(req);
    const { level, ksf } = req.query as { level?: string; ksf?: string };
    const rows = await ontology.queryObjects(c, "Metric", {});
    const items = objProps(rows).filter((p) => (!level || String(p.level) === level) && (!ksf || String(p.ksfRef) === ksf));
    return { items, snapshotVersion: rows.snapshotVersion };
  });
  app.get("/a/v1/metrics/:key", async (req) => {
    const c = ctx(req);
    const key = (req.params as { key: string }).key;
    const all = await repos.objects.listByType(c.tenantId, "Metric");
    const obj = all.find((o) => String(o.props.metricId) === key || String(o.props.key) === key);
    if (!obj) throw notFound("metric");
    // R13 血缘：actual 经合成→物化，origin 记 sourceConnId/rawDatasetId/rowIdx（数据源→原始表可溯）。
    const o = obj.origin as { sourceConnId?: string; rawDatasetId?: string; rawRowIdx?: number };
    const conn = o.sourceConnId ? await repos.connections.get(c.tenantId, o.sourceConnId) : undefined;
    const ds = o.rawDatasetId ? await repos.rawDatasets.get(c.tenantId, o.rawDatasetId) : undefined;
    return {
      metric: obj.props,
      lineage: { sourceConnId: o.sourceConnId ?? null, connectionName: conn?.name ?? null, rawDatasetId: o.rawDatasetId ?? null, rawDatasetName: ds?.name ?? null, rowIdx: o.rawRowIdx ?? null },
    };
  });
  app.get("/a/v1/ksf", async (req) => {
    const rows = await ontology.queryObjects(ctx(req), "KSF", {});
    return { items: objProps(rows), snapshotVersion: rows.snapshotVersion };
  });
  app.get("/a/v1/principals", async (req) => {
    const rows = await ontology.queryObjects(ctx(req), "Principal", {});
    return { items: objProps(rows), snapshotVersion: rows.snapshotVersion };
  });
  // SPINE.2 指标快照回采（执行回采更新口径 → 发 metric.snapshot_recorded；越线项发 metric.breached 触发推演）。
  // actual 仍为派生投影（metric_rollup 实算，非凭空写真值 R13）；事件驱动驾驶舱/风险页失效 + 越线接 plan_rootcause。
  app.post("/a/v1/metrics/snapshot", async (req) => {
    const c = ctx(req);
    const out = (await ontology.invokeSolver(c, "metric_rollup", {})).data as {
      metrics: { metricId: string; key: string; actual: number; target: number; miss: boolean; chainKey?: string; ownerRef?: string | null }[];
    };
    const asOf = new Date().toISOString();
    for (const m of out.metrics) {
      await outbox.emit(c.tenantId, "metric.snapshot_recorded", { metricId: m.metricId, key: m.key, actual: m.actual, asOf });
      if (m.miss) await outbox.emit(c.tenantId, "metric.breached", { metricId: m.metricId, key: m.key, actual: m.actual, target: m.target, chainKey: m.chainKey ?? null, ownerRef: m.ownerRef ?? null });
    }
    return { recorded: out.metrics.length, breached: out.metrics.filter((m) => m.miss).length, asOf, metrics: out.metrics };
  });
  // A18.2 LLM 临时求解器生成：缺求解器 → LLM 生成纯函数 → 冻结 + 锁死沙箱跑通自检 → 注册 PROVISIONAL（未审核·UNVERIFIED）。
  app.post("/a/v1/solvers/generate", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const b = req.body as { key?: string; intent?: string };
    if (!b?.key || !b?.intent) throw validationError("key + intent required");
    return solvers.generateProvisionalSolver(c, { key: b.key, intent: b.intent, objectTypes: [] });
  });
  // A18.4 审核台队列：列临时求解器制品（每 key 最新版本 + 状态；status 过滤）。供人工审核台。
  app.get("/a/v1/solvers/artifacts", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const { status } = req.query as { status?: string };
    return { artifacts: await solvers.listArtifacts(c.tenantId, status) };
  });
  // A18.2 看临时求解器代码 + rationale + 状态（人工审核台用；GOVERNED 才能写真值）。
  app.get("/a/v1/solvers/:solverKey/artifact", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const art = await solvers.getArtifact(c.tenantId, (req.params as { solverKey: string }).solverKey);
    if (!art) throw notFound("solver artifact");
    return art;
  });
  // A18.4 晋升：人工审批把临时求解器 PROVISIONAL → GOVERNED（解锁写真值，R4）。
  app.post("/a/v1/solvers/:solverKey/promote", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return solvers.promoteSolver(c, (req.params as { solverKey: string }).solverKey);
  });
  // A18.3 写真值门控查询：某临时求解器对当前 actor 是否可写真值（创建人作用域 + 标签）。
  app.get("/a/v1/solvers/:solverKey/write-truth-check", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return solvers.checkWriteTruth(c, (req.params as { solverKey: string }).solverKey);
  });
  // A13 地板语义确定化：通用图求解器的字段角色确定性解析（结构信号 + 配置词库，去 LLM）+ 候选/置信度。
  app.get("/a/v1/solvers/:solverKey/field-roles", async (req) => {
    const c = ctx(req);
    const { solverKey } = req.params as { solverKey: string };
    const types = (await ontology.listTypes(c)).map((t) => ({
      typeKey: t.key,
      properties: t.properties.map((p) => ({ propKey: p.propKey, dataType: p.dataType, isPrimaryKey: p.isPrimaryKey, refToTypeKey: p.refToTypeKey ?? null })),
    }));
    return resolveFieldRoles(types, solverKey);
  });
  // ---- WO-SOLVER-ONTOLOGY-BINDING（B3 命门 · G-17）: canonical 求解器 role→租户真实类型/字段绑定 ----
  // 上传/合成的任意类型经 SolverBinding 喂 canonical 业务求解器出真答案；无绑定回退 canonical 默认
  // （向后兼容·demo 零回归）。DF.8 接地：绑定引用须在本租户已发布本体内，否则 400 不落库（绝不造实体）。
  // R2 仅本租户；RL4：建模发布自动建议 DRAFT 草案，须显式 activate 才生效（resolveSolverType 只认 ACTIVE）。
  app.post("/a/v1/solvers/:solverKey/bindings", async (req) => {
    const c = ctx(req);
    const { solverKey } = req.params as { solverKey: string };
    if (!(SOLVER_KEYS as readonly string[]).includes(solverKey)) throw validationError(`未知求解器 ${solverKey}`);
    const body = parseBody(SolverBindingSchema.partial({ id: true, tenantId: true, solverKey: true }), req.body);
    const binding = { ...body, id: body.id || newId("solvbnd"), tenantId: c.tenantId, solverKey };
    // DF.8 接地：引用类型/字段须在本租户已发布本体内（ACTIVE）。失败 → validationError 400，不落库。
    const types = await ontology.listTypes(c);
    assertSolverBindingGrounded(binding, types);
    await repos.solverBindings.put(binding);
    solvers.invalidateBindingCache(c.tenantId); // 缓存失效（绑定即时生效于 resolveSolverType，若 ACTIVE）
    return binding;
  });
  app.get("/a/v1/solvers/:solverKey/bindings", async (req) => {
    const c = ctx(req);
    const { solverKey } = req.params as { solverKey: string };
    const items = (await repos.solverBindings.list(c.tenantId)).filter((b) => b.solverKey === solverKey);
    return { items };
  });
  // 激活草案（RL4 人工确认）：DRAFT → ACTIVE（生效于 resolveSolverType）。
  app.post("/a/v1/solvers/:solverKey/bindings/:id/activate", async (req) => {
    const c = ctx(req);
    const { id } = req.params as { solverKey: string; id: string };
    const b = await repos.solverBindings.get(c.tenantId, id);
    if (!b) throw notFound("solver binding");
    const types = await ontology.listTypes(c);
    assertSolverBindingGrounded(b, types); // 激活时再接地一次（本体可能已变）
    const activated = { ...b, status: "ACTIVE" as const };
    await repos.solverBindings.put(activated);
    solvers.invalidateBindingCache(c.tenantId);
    return activated;
  });
  // 自动建议绑定草案（RL4·不自动生效）：按 canonical 求解器 role 用确定性词表在本租户已发布本体挑最贴切类型
  // → 产 DRAFT 草案落库（不覆盖已有绑定）。人工经 activate 确认后方生效。
  app.post("/a/v1/solvers/bindings/suggest", async (req) => {
    const c = ctx(req);
    const types = await ontology.listTypes(c);
    const existing = await repos.solverBindings.list(c.tenantId);
    const drafts = suggestSolverBindings(c.tenantId, types, existing, (sk) => newId(`solvbnd_${sk}`));
    for (const d of drafts) await repos.solverBindings.put(d);
    return { suggested: drafts.length, drafts };
  });
  // ---- WO-MULTISRC-FUSION-DOMAIN（N1·多源融合）: 融合对象快照只读查询（AUDIT 复盘·R2 隔离）----
  // multisource_fusion 求解器把 SUSPECT/冲突对象的融合态全貌 append 落 fused_objects（取哪源/为何/测谎命中
  // 什么/逐字段置信）。此端点只读消费——与 GET /a/v1/audit-log 互补（审计记动作、此记融合态）。?verdict=SUSPECT 过滤。
  app.get("/a/v1/fused-objects", async (req) => {
    const c = ctx(req);
    const { verdict, role } = req.query as { verdict?: string; role?: string };
    const items = (await repos.fusedObjects.list(c.tenantId))
      .filter((f) => (verdict ? f.verdict === verdict : true) && (role ? f.role === role : true))
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id.localeCompare(b.id)));
    return { items };
  });
  app.post("/a/v1/solvers/:solverKey/invoke", async (req) => {
    const { solverKey } = req.params as { solverKey: string };
    // entitlement first (404 FEATURE_NOT_FOUND), then authz/execution
    await requireFeatureTag(req, "solverKeys", solverKey);
    const body = parseBody(z.object({ args: z.record(z.string(), z.unknown()).default({}) }), req.body);
    let args = body.args;
    // CL.6（PRD-attribution-routing-plan-audit）：plan_audit 入参三级兜底——缺数值入参时自动取
    // currentPlanVersion（其本身再 ?? PlanTarget/场景包基线确定性派生，sop.ts:419），使"未达成原因/
    // 达成率归因"问句直达 plan_audit 出 X01–X05，agent 不因"无 plan_version_id"而放弃（R6 确定）。
    if (solverKey === "plan_audit") {
      const required = ["dem", "seg_pas", "seg_ess", "seg_com", "sup", "ltaCov", "kitGap", "gmTarget", "cashCushion", "capex"];
      if (!required.every((k) => typeof args[k] === "number")) {
        const cur = await sop.currentPlanVersion(ctx(req));
        args = { ...cur.input, ...args }; // 基线兜底 + 显式 args 覆盖
      }
    }
    return ontology.invokeSolver(ctx(req), solverKey, args);
  });
  // ---- DATADEP-MANIFEST-READINESS 站③（precondition-first·通用就绪探测）------------------------
  // 读入口声明式数据依赖清单（SOLVER_DATADEP）→ present-vs-needed 计数 → EntryReadiness{ready,roles,gaps}。
  // Entitlement 先于 authz（关闭=404 FEATURE_NOT_FOUND，同 invoke）；纯计数确定性、runtime 不调 LLM（R6）。
  // gaps 喂 GROWTH-WORKLIST 看板（④·人工闸）——agentcore /b/v1/entries/:ref/readiness 透传消费。
  app.post("/a/v1/solvers/:solverKey/readiness", async (req) => {
    const { solverKey } = req.params as { solverKey: string };
    if (!(SOLVER_KEYS as readonly string[]).includes(solverKey)) throw validationError(`未知求解器 ${solverKey}`);
    await requireFeatureTag(req, "solverKeys", solverKey);
    return solvers.checkSolverReadiness(ctx(req).tenantId, solverKey);
  });
  app.post("/a/v1/derivations/run", async (req, reply) => {
    const run = await ontology.runDerivations(ctx(req));
    return reply.status(202).send(run);
  });

  // ---- WO-EXPERIMENT（④·决策 A/B·冠军-挑战者）-------------------------------------------
  // 求解器参数版本受控实验：建实验(champion/challenger 版本+split)→start→真 invoke 确定性分流到两臂
  // →GET 回执两臂 invokeCount/均值/胜负→conclude 落胜方。关实验(无 RUNNING)恒走 champion 当前版本·零影响既有。
  app.post("/a/v1/experiments", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const b = parseBody(z.object({
      solverKey: z.string().min(1),
      championVersion: z.number().int().nonnegative(),
      challengerVersion: z.number().int().nonnegative(),
      splitPct: z.number().int().min(0).max(100),
      metricKey: z.string().min(1),
    }), req.body);
    return solvers.createExperiment(c.tenantId, b);
  });
  app.get("/a/v1/experiments/:id", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return solvers.experimentReport(c.tenantId, (req.params as { id: string }).id);
  });
  app.post("/a/v1/experiments/:id/start", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return solvers.startExperiment(c.tenantId, (req.params as { id: string }).id);
  });
  app.post("/a/v1/experiments/:id/conclude", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return solvers.concludeExperiment(c.tenantId, (req.params as { id: string }).id);
  });

  // ---- 轨B·增量1 优化融合域 /a/v1/opt/*（G-12 · 抽象模板池 · entitlement apiTag "opt"→opt.solver-pool）----
  // R3 暗发：opt.* defaultOn:false，关 = 404 FEATURE_NOT_FOUND（先于 authz）。CLI/curl 先于 UI（R15）。
  // 5 CP-SAT 核心走 optimizer-client sidecar（OPTIMIZER_BASE_URL）；未配 → 求解器报"未接入"不兜底。
  const OPT_FAMILIES = ["facility_location", "min_cost_flow", "set_cover", "independent_set", "combinatorial_auction"] as const;
  // 求解：{ family, args } 直接给抽象结构化数组（增量1）；或 { family, binding } 由 OntologyBinding
  // 从本租户本体类型化字段填（增量2 · R14 同模板绑不同本体零代码改）。二者择一。
  app.post("/a/v1/opt/solve", async (req) => {
    await requireFeatureTag(req, "apiTags", "opt");
    const body = parseBody(
      z.object({
        family: z.enum(OPT_FAMILIES),
        args: z.record(z.string(), z.unknown()).optional(),
        binding: OntologyBindingSchema.optional(),
        bindingId: z.string().optional(), // 增量E：用落库绑定（create→solve 闭环）
        seed: z.number().optional(),
      }),
      req.body,
    );
    const c = ctx(req);
    // 增量E：bindingId 优先载入落库绑定（R2 仅本租户）；与 inline binding 二选一。
    const binding = body.binding ?? (body.bindingId ? await repos.optBindings.get(c.tenantId, body.bindingId) : undefined);
    if (body.bindingId && !binding) throw notFound("binding not found");
    if (binding) {
      // 增量2：绑定层 invoke 前预处理（DF.8 接地 + role→本体字段），再走确定性 CP-SAT。
      return solvers.solveWithBinding(c, body.family, binding, { seed: body.seed });
    }
    return ontology.invokeSolver(c, body.family, body.args ?? {});
  });
  // 列模板族（池 comprehend 兜底；增量4 embedding 检索叠其上）。
  app.get("/a/v1/opt/templates", async (req) => {
    await requireFeatureTag(req, "apiTags", "opt");
    // G-12 收 provenance 门空过：返回一等可发现的 OptModelTemplate 实例（含 provenance/requiredRoles/
    // decisionVars，R14 零业务常数），而非裸 family 字符串。families 保留向后兼容。
    return { families: OPT_FAMILIES, templates: OPT_MODEL_TEMPLATES };
  });
  // 轨B·增量4 embedding 复用检索（advisory · FUS2 不入确定性求解路径）。
  // 门：gated 在 opt.solver-pool（apiTag "opt"）；opt.embedding-retrieval 关 → 退回 comprehend 关键词列表
  // （确定性兜底，不静默 · DoD §3）。开 → 本地确定性词袋检索最近模板 + 覆盖缺口信号。
  app.get("/a/v1/opt/retrieve", async (req) => {
    await requireFeatureTag(req, "apiTags", "opt");
    const c = ctx(req);
    const need = String((req.query as { need?: string }).need ?? "").trim();
    if (!need) throw validationError("opt retrieve 需 ?need=<需求文本>");
    const resolved = await features.resolve(c.tenantId);
    const embeddingOn = resolved.features.includes("opt.embedding-retrieval");
    if (!embeddingOn) {
      // 退回 comprehend：关键词匹配模板族（确定性，显式标注 mode=comprehend 不静默）。
      const q = need.toLowerCase();
      const matched = OPT_FAMILIES.filter((f) => q.includes(f) || q.includes(f.replace(/_/g, " ")));
      return { mode: "comprehend", embeddingEnabled: false, candidates: (matched.length ? matched : OPT_FAMILIES).map((key) => ({ key })), note: "opt.embedding-retrieval 未开 → 退回 comprehend 关键词列表（不静默）" };
    }
    const idx = new LocalTemplateIndex();
    const candidates = idx.nearestTemplates(need, 3);
    return { mode: "embedding", embeddingEnabled: true, candidates, coverageGap: idx.coverageGap(need), note: "advisory：embedding 仅排序/听懂，不入确定性求解路径（FUS2）" };
  });
  // 轨B·增量3 optimize_whatif：{ family, perturbations[], (args|binding) } → Δ目标/可行性/冲突约束。
  // entitlement opt.whatif（apiTag "opt-whatif"，requires opt.solver-pool）；关 = 404 R3。R4 模拟态不落真值。
  app.post("/a/v1/opt/whatif", async (req) => {
    await requireFeatureTag(req, "apiTags", "opt-whatif");
    const body = parseBody(
      z.object({
        family: z.enum(OPT_FAMILIES),
        perturbations: z.array(OptPerturbationSchema).min(1),
        args: z.record(z.string(), z.unknown()).optional(),
        binding: OntologyBindingSchema.optional(),
        seed: z.number().optional(),
      }),
      req.body,
    );
    return ontology.invokeSolver(ctx(req), "optimize_whatif", {
      family: body.family,
      perturbations: body.perturbations,
      ...(body.binding ? { binding: body.binding } : { args: body.args ?? {} }),
      ...(body.seed !== undefined ? { seed: body.seed } : {}),
    });
  });
  // 增量E·U5：OntologyBinding 落库（绑定即一等资源，每租户绑不同本体 R14）。绑定层视图（解耦 Repos）。
  const bindingView = (): BindingOntologyView => ({
    listTypes: (tid) => repos.ontologyTypes.list(tid),
    listByType: (tid, key) => repos.objects.listByType(tid, key),
  });
  // 创建绑定：DF.8 接地校验（引用须在本租户已发布本体内）通过才落库；否则 400 不落库（绝不静默造实体）。
  app.post("/a/v1/opt/bindings", async (req) => {
    await requireFeatureTag(req, "apiTags", "opt");
    const c = ctx(req);
    const body = parseBody(OntologyBindingSchema.partial({ id: true, tenantId: true }), req.body);
    const binding = { ...body, id: body.id || newId("optbnd"), tenantId: c.tenantId };
    await assertBindingGrounded(bindingView(), binding); // 接地失败 → validationError 400
    await repos.optBindings.put(binding);
    return binding;
  });
  app.get("/a/v1/opt/bindings", async (req) => {
    await requireFeatureTag(req, "apiTags", "opt");
    return { items: await repos.optBindings.list(ctx(req).tenantId) };
  });
  app.get("/a/v1/opt/bindings/:id", async (req) => {
    await requireFeatureTag(req, "apiTags", "opt");
    const c = ctx(req);
    const b = await repos.optBindings.get(c.tenantId, (req.params as { id: string }).id);
    if (!b) throw notFound("binding not found");
    return b;
  });

  // ---- 本体原子规格 §2/§3 atomic-spec engine（additive 端点）-------------------
  // §2.3 编译派生规格：解析→deps→Kahn 拓扑→环拒绝 CYCLIC_DERIVATION。
  app.post("/a/v1/ontology/derivation-specs/compile", async (req, reply) => {
    const c = ctx(req);
    const body = parseBody(
      z.object({
        ontologyVersion: z.number().int().optional(),
        specs: z.array(
          z.object({
            specKey: z.string().min(1),
            targetType: z.string().min(1),
            targetProp: z.string().min(1),
            formula: z.string().min(1),
          }),
        ),
      }),
      req.body,
    );
    const ov = body.ontologyVersion ?? (await ontology.currentVersion(c.tenantId));
    const out = await ontologyCore.compileSpecs(c, ov, body.specs);
    // §7.4：派生规格 deps 引用同步入库 element_refs。
    for (const s of out.specs) await governance.indexDerivationRefs(c, s.specKey, s.targetType, s.deps);
    return reply.status(201).send({ order: out.order, specs: out.specs.map((s) => ({ specKey: s.specKey, deps: s.deps })) });
  });
  // §2.4 增量重算：变更集 → 受影响最小集重算（拓扑序）。
  app.post("/a/v1/ontology/recompute", async (req) => {
    const c = ctx(req);
    const body = parseBody(
      z.object({
        changes: z.array(
          z.object({ typeKey: z.string(), prop: z.string(), objectIds: z.array(z.string()) }),
        ),
      }),
      req.body,
    );
    return ontologyCore.recompute(c, body.changes);
  });

  // generic-inference 通用 what-if（PRD-generic-inference / G-5 8e）：行业无关——给定"假设某对象属性=新值"，
  // 用本体派生规格(A4)前向重算受影响派生属性，返回 before/after，**不落真值**(R4，dryRun 无副作用)。
  app.post("/a/v1/inference/whatif", async (req) => {
    const c = ctx(req);
    const body = parseBody(
      z.object({
        apply: z
          .array(z.object({ objectType: z.string(), objectId: z.string(), prop: z.string(), value: z.unknown() }))
          .min(1)
          .max(50),
      }),
      req.body,
    );
    const changes = body.apply.map((a) => ({ typeKey: a.objectType, prop: a.prop, objectIds: [a.objectId] }));
    const apply = body.apply.map((a) => ({ objectId: a.objectId, prop: a.prop, value: a.value }));
    const result = await ontologyCore.recompute(c, changes, { dryRun: true, apply });
    return { deltas: result.dryRunDeltas ?? [], affectedObjects: result.updatedObjects };
  });
  // 切片清单（管理面：本体切片编辑器列表源）。tenant 隔离由 sliceSpecs.list 保证。
  app.get("/a/v1/ontology/slices", async (req) => {
    const specs = await repos.sliceSpecs.list(ctx(req).tenantId);
    return specs
      .map((s) => ({
        sliceKey: s.sliceKey,
        version: s.version,
        rootType: s.spec.root.typeKey,
        hops: s.spec.paths.reduce((n, p) => n + p.length, 0),
        linkKeys: [...new Set(s.spec.paths.flat().map((p) => p.linkKey))],
        maxNodes: s.spec.maxNodes,
        fixtures: s.spec.contractFixtures?.length ?? 0,
      }))
      .sort((a, b) => (a.sliceKey < b.sliceKey ? -1 : 1));
  });
  // §3 声明式切片：注册 + 执行（A6 逐跳剪枝、参数化、截断）。
  app.put("/a/v1/ontology/slices/:sliceKey", async (req, reply) => {
    const c = ctx(req);
    const { sliceKey } = req.params as { sliceKey: string };
    const body = parseBody(
      z.object({
        version: z.number().int().default(1),
        spec: z.object({
          root: z.object({
            typeKey: z.string(),
            selector: z.object({
              byKey: z.unknown().optional(),
              filter: z.record(z.string(), z.unknown()).optional(),
            }),
          }),
          paths: z.array(
            z.array(
              z.object({
                linkKey: z.string(),
                direction: z.enum(["out", "in"]),
                filter: z.record(z.string(), z.unknown()).optional(),
                limitPerNode: z.number().int().optional(),
                project: z.array(z.string()).optional(),
              }),
            ),
          ),
          maxNodes: z.number().int().optional(),
          contractFixtures: z
            .array(
              z.object({
                name: z.string(),
                args: z.record(z.string(), z.union([z.string(), z.number()])),
                expect: z.object({
                  rootType: z.string(),
                  minNodes: z.number().int(),
                  mustIncludeTypes: z.array(z.string()),
                  mustIncludeLinkKeys: z.array(z.string()).optional(),
                  maxNodes: z.number().int().optional(),
                }),
              }),
            )
            .optional(),
        }),
      }),
      req.body,
    );
    // 治理增量 §2.2：slice 不能新引用 DEPRECATED 的 type/link。
    const refTypeKeys = [body.spec.root.typeKey];
    const refLinkKeys = body.spec.paths.flatMap((p) => p.map((h) => h.linkKey));
    await governance.assertNewRefAllowed(c, "type", refTypeKeys);
    await governance.assertNewRefAllowed(c, "link", refLinkKeys);
    const rec = await ontologyCore.putSliceSpec(c, sliceKey, body.version, body.spec as never);
    // §7.4：入库即抽取引用三元组到 element_refs（查询即查表）。
    await governance.indexSliceRefs(c, rec);
    return reply.status(201).send({ sliceKey: rec.sliceKey, version: rec.version });
  });
  app.post("/a/v1/ontology/slices/:sliceKey/resolve", async (req) => {
    const c = ctx(req);
    const { sliceKey } = req.params as { sliceKey: string };
    const body = parseBody(z.object({ args: z.record(z.string(), z.unknown()).default({}) }), req.body);
    const spec = await ontologyCore.getSliceSpec(c, sliceKey);
    if (!spec) throw notFound(`slice ${sliceKey}`);
    return ontologyCore.executeSlice(c, spec.spec, body.args);
  });

  // ---- S2 action approval ----------------------------------------------------
  app.post("/a/v1/action-drafts", async (req, reply) => {
    const c = ctx(req);
    const body = parseBody(ActionDraftSchema, req.body);
    const key = body.actionTypeKey ?? body.actionType;
    if (!key) throw validationError("actionTypeKey required");
    await authz.require(c, "ACTION_TYPE", key, "EXECUTE");
    // 增量 §7.12：定稿走 Action —— 先校验版本可定稿（FINAL → 409 PLAN_LOCKED），创建后标记待审批。
    const finalizeVersionId =
      key === "定稿月度计划版本" && typeof body.payload.versionId === "string" ? body.payload.versionId : null;
    if (finalizeVersionId) await sop.assertFinalizeRequestable(c.tenantId, finalizeVersionId);
    const draft = await actions.create(c, {
      actionTypeKey: key,
      payload: body.payload,
      origin: body.origin,
      submit: body.submit,
    });
    if (finalizeVersionId) await sop.markFinalizePending(c.tenantId, finalizeVersionId, draft.id);
    return reply.status(201).send({ draftId: draft.id, status: draft.status, draft });
  });
  app.post("/a/v1/action-drafts/:id/submit", async (req) => {
    const { id } = req.params as { id: string };
    return actions.submit(ctx(req), id);
  });
  app.get("/a/v1/action-drafts", async (req) => {
    const { status, role } = req.query as { status?: string; role?: string };
    return actions.list(ctx(req), { status, role });
  });
  app.get("/a/v1/action-drafts/:id", async (req) => {
    const { id } = req.params as { id: string };
    return actions.get(ctx(req), id);
  });
  app.post("/a/v1/action-drafts/:id/approve", async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(z.object({ comment: z.string().optional() }), req.body);
    return actions.approve(ctx(req), id, body.comment);
  });
  app.post("/a/v1/action-drafts/:id/reject", async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(z.object({ comment: z.string().min(1, "reject comment is required") }), req.body);
    return actions.reject(ctx(req), id, body.comment);
  });
  // 前端 PRD §7.9 别名：单端点 decision（APPROVE/REJECT + comment）
  app.post("/a/v1/action-drafts/:id/decision", async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(
      z.object({ decision: z.enum(["APPROVE", "REJECT"]), comment: z.string().default("") }),
      req.body,
    );
    return body.decision === "APPROVE"
      ? actions.approve(ctx(req), id, body.comment || undefined)
      : actions.reject(ctx(req), id, body.comment || "驳回");
  });
  app.post("/a/v1/action-drafts/:id/cancel", async (req) => {
    const { id } = req.params as { id: string };
    return actions.cancel(ctx(req), id);
  });
  app.get("/a/v1/action-drafts/:id/audit", async (req) => {
    const { id } = req.params as { id: string };
    return actions.audit(ctx(req), id);
  });
  app.get("/a/v1/action-types", async (req) => actions.listTypes(ctx(req)));
  app.post("/a/v1/action-types", async (req, reply) => {
    const c = ctx(req);
    if (!c.roles.some((r) => r.split(":")[0] === "admin")) throw forbidden("admin only");
    const body = parseBody(
      z.object({
        key: z.string().min(1),
        name: z.string().min(1),
        paramsSchema: z.record(z.string(), z.unknown()).default({}),
        checkRules: z.array(z.string()).default([]),
        approvalChain: z.array(z.object({ role: z.string() })).min(1).max(3),
      }),
      req.body,
    );
    return reply.status(201).send(await actions.registerType(c, body));
  });

  // ---- WO-DECISION-RECORD（PRD §3.7 D8 · 一等 Decision 记录·问责+组织学习）-------------
  // 独立路由区块（便于与并行 agent rebase 合并）。R2 租户隔离经仓储 tenantId 过滤。
  app.post("/a/v1/decisions", async (req, reply) => {
    const body = parseBody(CreateDecisionSchema, req.body);
    const decision = await decisions.create(ctx(req), body);
    return reply.status(201).send({ decisionId: decision.id, status: decision.status, decision });
  });
  app.get("/a/v1/decisions", async (req) => {
    const { status } = req.query as { status?: string };
    return { decisions: await decisions.list(ctx(req), { status }) };
  });
  app.get("/a/v1/decisions/:id", async (req) => {
    const { id } = req.params as { id: string };
    return decisions.get(ctx(req), id);
  });
  // 补录 realizedOutcome（预测 vs 实现对比）→ decision.outcome_recorded 事件
  app.post("/a/v1/decisions/:id/outcome", async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(RecordOutcomeSchema, req.body);
    return decisions.recordOutcome(ctx(req), id, body);
  });

  // ---- L1.5 企业记忆 · CBR 案例只读检索（WO-L1.5-2·暗发 memory.cbr 门·PRD-L1.5 §2.6/§5）---------
  // 关 memory.cbr → 404 FEATURE_NOT_FOUND（R3 先于 authz·不泄漏存在性）。案例=咨询派生·数字随行免责·非业务真值。
  app.get("/a/v1/memory/cases/similar", async (req) => {
    await requireFeatureTag(req, "apiTags", "memory-cbr");
    const c = ctx(req);
    const qp = req.query as { q?: string; topK?: string; problemClass?: string; entities?: string; metrics?: string; weightsVersion?: string };
    const query = SimilarityQuerySchema.parse({
      tenantId: c.tenantId,
      text: qp.q ?? "",
      problemClass: qp.problemClass ?? null,
      entities: qp.entities ? qp.entities.split(",").filter(Boolean) : [],
      metrics: qp.metrics ? qp.metrics.split(",").filter(Boolean) : [],
      topK: qp.topK ? Number(qp.topK) : 5,
      weightsVersion: qp.weightsVersion ?? "v1",
    });
    const cases = await repos.decisionCases.list(c.tenantId); // R2：仅本租户案例
    return retrieveSimilarCases(cases, query);
  });
  app.get("/a/v1/memory/cases/:id", async (req) => {
    await requireFeatureTag(req, "apiTags", "memory-cbr");
    const c = ctx(req);
    const { id } = req.params as { id: string };
    const found = await repos.decisionCases.get(c.tenantId, id); // R2：跨租户取不到 → 404
    if (!found) throw notFound("decision case");
    return found;
  });
  // WO-L1.5-3（审核方拆缝·agent「先查案例库」检索端点·暗发 memory.cbr_retrieve 门·独立于 memory.cbr 查看门）：
  // Dev-1 的 agentcore 薄适配器（WO-L1.5-3B·retrieve_similar_cases 工具）经 OBO 调本端点做相似案例检索。
  // 关 memory.cbr_retrieve → 404 FEATURE_NOT_FOUND（R3·agent 回落路径提示·翻闸=字节一致 NG6）。R2 本租户案例。
  app.post("/a/v1/memory/cases/retrieve-similar", async (req) => {
    await requireFeatureTag(req, "apiTags", "memory-cbr-retrieve");
    const c = ctx(req);
    const body = (req.body ?? {}) as { query?: string; text?: string; problemClass?: string | null; entities?: string[]; metrics?: string[]; topK?: number };
    const query = SimilarityQuerySchema.parse({
      tenantId: c.tenantId,
      text: body.text ?? body.query ?? "",
      problemClass: body.problemClass ?? null,
      entities: Array.isArray(body.entities) ? body.entities : [],
      metrics: Array.isArray(body.metrics) ? body.metrics : [],
      topK: body.topK ?? 5,
    });
    const cases = await repos.decisionCases.list(c.tenantId); // R2：仅本租户
    return retrieveSimilarCases(cases, query);
  });
  // WO-L1.5-4（决策模式挖掘·§4.4⑥·确定性咨询·memory.cbr 门）：按 (problemClass+特征桶) 众数挖掘决策模式；
  // 达阈值 surfaced=true（浮现候选·上层转 GrowthTicket 人工闸·不自动上线规则·R4/NG2）。R2 本租户案例。
  app.get("/a/v1/memory/patterns", async (req) => {
    await requireFeatureTag(req, "apiTags", "memory-cbr");
    const c = ctx(req);
    const q = req.query as { minSupport?: string; minConfidence?: string };
    const cases = await repos.decisionCases.list(c.tenantId);
    const patterns = mineDecisionPatterns(cases, {
      minSupport: q.minSupport ? Number(q.minSupport) : undefined,
      minConfidence: q.minConfidence ? Number(q.minConfidence) : undefined,
    });
    return { patterns, total: patterns.length };
  });

  // ---- L2 决策内核 · 决策制品构建/读取（WO-L2-4·暗发·decision.kernel 门 + QOS_DECISION_KERNEL env）------
  // 构建（旁挂-call 的 datacore 落点·调用方供 query/分类/上下文）：关 env=不构（204·pipeline 零变化·RL2）；
  // 关 decision.kernel=404 FEATURE_NOT_FOUND（R3）。接真 in-process 求解器·每数字溯真求解器字段（R13/KILL-MOCK）。
  app.post("/a/v1/queries/:taskId/decision-package", async (req, reply) => {
    await requireFeatureTag(req, "apiTags", "decision-kernel");
    if (config.QOS_DECISION_KERNEL !== "1") return reply.code(204).send(); // env 暗发关=不构决策制品
    const c = ctx(req);
    const { taskId } = req.params as { taskId: string };
    const body = parseBody(
      z.object({
        query: z.string(),
        intentKey: z.string().nullable().default(null),
        slots: z.record(z.string(), z.unknown()).default({}),
        requirementGraphId: z.string().nullable().default(null),
        executionPlanId: z.string().nullable().default(null),
      }),
      req.body,
    );
    // generatedAt 在服务边界注入（R6·kernel 内部不取时钟）。
    return decisionKernel.build(c, { taskId, ...body, generatedAt: new Date().toISOString() });
  });
  app.get("/a/v1/queries/:taskId/decision-package", async (req) => {
    await requireFeatureTag(req, "apiTags", "decision-kernel");
    const c = ctx(req);
    const { taskId } = req.params as { taskId: string };
    const pkg = await decisionKernel.getByTask(c, taskId); // R2：ctx.tenantId 过滤·跨租户取不到
    if (!pkg) throw notFound("decision package");
    return pkg;
  });
  // WO-L2-5 采纳正门（§4.4·R4/RL4）：双门 decision.kernel + act.adopt-to-draft（后者由 ActionService 建 draft 时
  // 经 S2 action-type 治理保障）。采纳 → 建 Decision 台账 + ActionDraft（走审批链·不直写真值）→ 制品回填 ADOPTED。
  app.post("/a/v1/queries/:taskId/decision-package/adopt", async (req) => {
    await requireFeatureTag(req, "apiTags", "decision-kernel");
    const c = ctx(req);
    const { taskId } = req.params as { taskId: string };
    const body = parseBody(z.object({ scenarioKey: z.string().min(1) }), req.body);
    return decisionKernel.adopt(c, taskId, body.scenarioKey);
  });

  // ---- A5 rules -----------------------------------------------------------------------
  app.get("/a/v1/rules", async (req) => {
    const { status } = req.query as { status?: string };
    return rules.list(ctx(req), status);
  });
  app.post("/a/v1/rules", async (req, reply) => {
    const body = parseBody(RuleCreateSchema, req.body);
    // 管理平台增量 §5：手工创建（origin=MANUAL）的 expression 经 DSL 解析校验，错误定位字符位。
    assertValidExpression(body.expression);
    return reply.status(201).send(await rules.create(ctx(req), body));
  });
  // 管理平台增量 §5：PUT 仅 DRAFT 可改（PUBLISHED → 409 IMMUTABLE_VERSION）。
  app.put("/a/v1/rules/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(RuleCreateSchema.partial().omit({ key: true, status: true }), req.body);
    return rules.update(ctx(req), id, body);
  });
  app.post("/a/v1/rules/:id/publish", async (req) => {
    const { id } = req.params as { id: string };
    // 引用模式增量 §2.3：publish 响应附影响面 impact + warnings（scope 缩窄非阻断警告）
    return rules.publish(ctx(req), id);
  });
  // §2.3：A 规则库 references 端点（镜像 B 资源的统一形态 {references, count}）
  app.get("/a/v1/rules/:id/references", async (req) => {
    const c = ctx(req);
    const { id } = req.params as { id: string };
    const rule = await rules.get(c, id);
    const references = await rules.references(c, rule.key);
    return { references, count: references.length };
  });
  app.post("/a/v1/rules/:id/retire", async (req) => {
    const { id } = req.params as { id: string };
    return rules.retire(ctx(req), id);
  });
  // 管理平台增量 §5：编辑器「测试」—— 即时求值 / 语法错误定位字符位。
  app.post("/a/v1/rules/dry-run", async (req) => {
    ctx(req);
    const body = parseBody(
      z.object({ expression: z.string(), samplePayload: z.record(z.string(), z.unknown()).default({}) }),
      req.body,
    );
    return rules.dryRun(body.expression, body.samplePayload);
  });
  app.post("/a/v1/rules/evaluate", async (req) => {
    const body = parseBody(EvaluateSchema, req.body);
    return rules.evaluate(ctx(req), body.ruleIds, body.payload);
  });

  // ---- A1 connectors --------------------------------------------------------------------
  app.get("/a/v1/connector-types", async () => CONNECTOR_TYPES);
  // 前端 PRD §7.4 新建向导「测试连接」：按 configSchema 必填项校验（mock/file 类直接通过）。
  app.post("/a/v1/connections/test", async (req) => {
    ctx(req);
    const body = parseBody(
      z.object({
        connectorTypeKey: z.string().min(1),
        config: z.record(z.string(), z.unknown()).default({}),
      }),
      req.body,
    );
    const ct = CONNECTOR_TYPES.find((t) => t.key === body.connectorTypeKey);
    if (!ct) return { ok: false, message: `未知连接器类型：${body.connectorTypeKey}` };
    // WO-5：测试连接须反映真实可用性——无 adapter 实现的类型（sap_erp/salesforce_crm/generic_jdbc/
    // knowledge_base/external_feed…）建后必 sync FAILED、schema 500，不得返 ok:true 假绿。先于必填校验
    // （无 adapter 即不可用，与配置是否齐全无关；不让"必填齐全"假绿盖过"根本无法同步"）。
    if (!hasAdapter(body.connectorTypeKey)) {
      return { ok: false, stub: true, message: "该连接器类型尚无 adapter 实现，创建后无法同步" };
    }
    const schema = (ct.configSchema ?? {}) as { required?: string[] };
    const required = Array.isArray(schema.required) ? schema.required : [];
    const missing = required.filter((k) => {
      const v = body.config[k];
      return v == null || v === "";
    });
    if (missing.length > 0) return { ok: false, message: `缺少必填配置：${missing.join("、")}` };
    return { ok: true };
  });
  app.post("/a/v1/connections", async (req, reply) => {
    const c = ctx(req);
    const body = parseBody(ConnectionCreateSchema, req.body);
    const conn = await connectors.createConnection(c, body);
    // A11 D-29：连接创建（带 category）→ 失效连接器列表/数据分类视图。
    await outbox.emit(c.tenantId, "connection.created", { connId: conn.id, category: conn.category ?? null });
    return reply.status(201).send(conn);
  });
  app.get("/a/v1/connections", async (req) => connectors.listConnections(ctx(req)));
  // A11：连接 category 枚举并集（注册表内置 + 本租户已用自定义值）→ 前端 chip/筛选（R14 非内联）。
  app.get("/a/v1/connector-categories", async (req) => {
    const c = ctx(req);
    const used = (await connectors.listConnections(c)).map((x) => x.category).filter((v): v is string => !!v);
    return { categories: [...new Set([...connectorCategories(), ...used])].sort() };
  });
  app.post("/a/v1/connections/:id/sync", async (req, reply) => {
    const { id } = req.params as { id: string };
    // WO-PIPE-INCR ①：?since=<watermark> → 增量同步（连接器具 incremental 能力时只灌新增/变更行）；缺省全量。
    const since = (req.query as { since?: string }).since;
    const c = ctx(req);
    const job = await connectors.sync(c, id, since !== undefined ? { since } : {});
    // 回执带各数据集新 watermark（下次 sync?since= 据此只取更新行）。
    const watermarks = Object.fromEntries(
      (await repos.rawDatasets.list(c.tenantId, (d) => d.sourceConnId === id))
        .filter((d) => d.watermark)
        .map((d) => [d.name, d.watermark]),
    );
    return reply.status(202).send({ syncJobId: job.id, status: job.status, rowCounts: job.rowCounts, watermarks });
  });
  app.get("/a/v1/connections/:id/schema", async (req) => {
    const { id } = req.params as { id: string };
    return connectors.discoverSchema(ctx(req), id);
  });
  app.get("/a/v1/sync-jobs/:id", async (req) => {
    const { id } = req.params as { id: string };
    const job = await repos.syncJobs.get(ctx(req).tenantId, id);
    if (!job) throw notFound("sync job");
    return job;
  });
  app.post("/a/v1/uploads", async (req, reply) => {
    const c = ctx(req);
    const uploadVM = (r: Awaited<ReturnType<typeof connectors.upload>>) => ({
      ...r,
      // 前端 PRD §7.4 消费形态：{ connId, datasetName }
      connId: r.connection.id,
      datasetName: r.schema.datasets[0]?.name ?? r.connection.name,
    });
    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) throw validationError("multipart file required");
      const content = await file.toBuffer();
      const result = await connectors.upload(c, file.filename, content);
      return reply.status(201).send(uploadVM(result));
    }
    const body = parseBody(RuleDocJsonSchema, req.body);
    const result = await connectors.upload(c, body.filename, Buffer.from(body.contentBase64, "base64"));
    return reply.status(201).send(uploadVM(result));
  });
  app.get("/a/v1/raw-datasets", async (req) => {
    const { connId } = req.query as { connId?: string };
    return connectors.listRawDatasets(ctx(req), connId);
  });
  // INTAKE-XLSX-EXPORT · 全数据集**多 sheet** Excel 导出（用户亲定：数据连接器&上传所有源数据一张可下载 excel·闭 G-13①）。
  //  - sheet1「概览」= 每数据集一行（ID/名/行数/列数/列清单/来源连接/摄入时间/备注[空|truncated]）；后续**每数据集一 sheet**（真业务行）。
  //  - `?connId=` 过滤单连接；缺省全租户。R2：listRawDatasets(ctx) 只取本租户 → 跨租户列表空（仅概览页·诚实空态·非 500）。
  //  - 大表护栏：每 sheet 上限 ROW_CAP 行截断（防内存爆），概览「备注」列诚实标 truncated（完整数据引导单集导出）。
  //  - R6 确定性：行序=rawRows.list 原序·列序=字段画像序，无随机/时钟入内容（文件名日期段仅供人读·不入 workbook 内容）。
  app.get("/a/v1/raw-datasets/export.xlsx", async (req, reply) => {
    const c = ctx(req);
    const { connId } = req.query as { connId?: string };
    const ROW_CAP = 50000; // 每 sheet 行上限（大表护栏）
    const datasets = await connectors.listRawDatasets(c, connId); // R2：仅本租户
    // 工作表名：xlsx 限 31 字符·非法字符 []:*?/\ 折 `_`·大小写不敏感去重（保留 CJK 数据集名信息，仅剔非法字符）。
    const usedSheet = new Set<string>(["概览"]);
    const sheetName = (raw: string): string => {
      const clean = ((raw || "data").replace(/[[\]:*?/\\]/g, "_").slice(0, 31)) || "data";
      if (!usedSheet.has(clean.toLowerCase())) { usedSheet.add(clean.toLowerCase()); return clean; }
      for (let i = 2; ; i++) {
        const suf = `_${i}`;
        const cand = clean.slice(0, 31 - suf.length) + suf;
        if (!usedSheet.has(cand.toLowerCase())) { usedSheet.add(cand.toLowerCase()); return cand; }
      }
    };
    const cell = (v: unknown): string | number | boolean => {
      if (v == null) return "";
      if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
      return JSON.stringify(v);
    };
    // 来源连接名缓存（避免逐数据集重复取连接）。
    const connCache = new Map<string, string>();
    const connName = async (id?: string): Promise<string> => {
      if (!id) return "";
      if (!connCache.has(id)) { const cn = await repos.connections.get(c.tenantId, id); connCache.set(id, cn?.name ?? id); }
      return connCache.get(id)!;
    };
    const overview: (string | number | boolean)[][] = [["数据集ID", "名称", "行数", "列数", "列清单", "来源连接", "摄入时间", "备注"]];
    const sheets: { name: string; data: (string | number | boolean)[][]; options: Record<string, unknown> }[] = [];
    for (const ds of datasets) {
      const rows = await repos.rawRows.list(c.tenantId, ds.id);
      // 列序：字段画像优先（稳定）→ 补行内出现但未画像的键（诚实全列，剔除内部 _editedAt）。
      const cols: string[] = [];
      const seen = new Set<string>();
      for (const f of ds.fields ?? []) if (f?.name && !seen.has(f.name)) { seen.add(f.name); cols.push(f.name); }
      for (const r of rows) for (const k of Object.keys(r)) if (k !== "_editedAt" && !seen.has(k)) { seen.add(k); cols.push(k); }
      const truncated = rows.length > ROW_CAP;
      const shown = truncated ? rows.slice(0, ROW_CAP) : rows;
      const note = rows.length === 0 ? "空数据集（无行）" : truncated ? `已截断：仅前 ${ROW_CAP} 行（共 ${rows.length}）` : "";
      overview.push([ds.id, ds.name, rows.length, cols.length, cols.join(", "), await connName(ds.sourceConnId), ds.syncedAt ?? "", note]);
      // sheet 数据：空数据集诚实标注（不伪造行）；有行 → 表头 + 真业务行（+截断脚注）。
      let data: (string | number | boolean)[][];
      if (rows.length === 0) {
        data = [cols.length ? cols : ["(空数据集·无列)"], ["(此数据集无行数据)"]];
      } else {
        data = [cols, ...shown.map((r) => cols.map((k) => cell(r[k])))];
        if (truncated) data.push([`(已截断：仅前 ${ROW_CAP} 行，共 ${rows.length} 行——完整数据请用单集导出 /raw-datasets/:id/export)`]);
      }
      sheets.push({ name: sheetName(ds.name), data, options: {} });
    }
    const buf = xlsx.build([{ name: "概览", data: overview, options: {} }, ...sheets]);
    // 文件名日期段（供人读·非内容·不破坏 R6 workbook 字节稳定）；connId 过滤时带连接段。
    const date = new Date().toISOString().slice(0, 10);
    const scope = connId ? `_conn-${connId.replace(/[^A-Za-z0-9_.-]+/g, "_")}` : "-all";
    const filename = `source-data${scope}_${date}.xlsx`;
    return reply
      .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("content-disposition", `attachment; filename="${filename}"`)
      // 跨源下载（前端→datacore）须显式暴露 content-disposition，浏览器才读得到文件名。
      .header("access-control-expose-headers", "content-disposition")
      .send(buf);
  });
  app.get("/a/v1/raw-datasets/:id/rows", async (req) => {
    const c = ctx(req);
    const { id } = req.params as { id: string };
    const ds = await repos.rawDatasets.get(c.tenantId, id);
    if (!ds) throw notFound("raw dataset");
    return { dataset: ds, rows: await repos.rawRows.list(c.tenantId, id) };
  });
  // WO-SOURCE-TRANSPARENCY · 数据集实际数据 Excel/CSV 导出（消灭"走捷径"·让每一行业务数据从"数据连接器"页可下载可审计）。
  //  - format=xlsx（默认）：node-xlsx 生成真 .xlsx（首行表头 + 各行值）。format=csv：RFC4180 转义。
  //  - R2 租户隔离：经 ctx(req) + rawDatasets.get 只取本租户数据集；行级 A6 口径同既有 /rows 端点（同源 rawRows.list）。
  //  - R13 诚实：来源为合成（mock_* / config.synthetic）→ 文件名带 `.synthetic` 段，导出物自带"这是合成数据"标识，绝不冒充真实上传。
  //  - R6 确定性：行序稳定（rawRows.list 原序）、列序 = 字段画像 fields 序，无 Date.now/随机 → 同数据集同字节。
  app.get("/a/v1/raw-datasets/:id/export", async (req, reply) => {
    const c = ctx(req);
    const { id } = req.params as { id: string };
    const format = ((req.query as { format?: string }).format ?? "xlsx").toLowerCase();
    if (format !== "xlsx" && format !== "csv") throw validationError("format must be xlsx or csv");
    const ds = await repos.rawDatasets.get(c.tenantId, id);
    if (!ds) throw notFound("raw dataset");
    const rows = await repos.rawRows.list(c.tenantId, id);
    // 列序：优先字段画像顺序（稳定），补上行内出现但未画像的键（诚实全列）。
    const cols: string[] = [];
    const seen = new Set<string>();
    for (const f of ds.fields ?? []) if (f?.name && !seen.has(f.name)) { seen.add(f.name); cols.push(f.name); }
    for (const r of rows) for (const k of Object.keys(r)) if (k !== "_editedAt" && !seen.has(k)) { seen.add(k); cols.push(k); }
    // R13 诚实：判定来源是否合成 → 文件名标 `.synthetic`（导出物自带来源诚实位，不冒充真实）。
    const conn = ds.sourceConnId ? await repos.connections.get(c.tenantId, ds.sourceConnId) : undefined;
    const isSynthetic = conn ? classifySourceOrigin(conn.connectorTypeKey, conn.config) === "synthetic" : false;
    // 文件名段：HTTP 头值须 latin1，故非 ASCII（含 CJK 连接名）折成 `_`（避免 header 抛错）。
    // 数据集名多为 ASCII 类型键（Order/Base…）故信息保真；连接名若纯 CJK 则回退占位。
    const safe = (s: string) => {
      const cleaned = (s || "").replace(/[^\x20-\x7E]/g, "_").replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
      return cleaned || "source";
    };
    const base = `${safe(conn?.name ?? "source")}__${safe(ds.name)}${isSynthetic ? ".synthetic" : ""}`;
    const cell = (v: unknown): string | number | boolean => {
      if (v == null) return "";
      if (typeof v === "number" || typeof v === "boolean") return v;
      if (typeof v === "string") return v;
      return JSON.stringify(v);
    };
    if (format === "csv") {
      const esc = (v: unknown) => {
        const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [cols.map(esc).join(",")];
      for (const r of rows) lines.push(cols.map((k) => esc(r[k])).join(","));
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${base}.csv"`)
        // 跨源下载（前端 :5173 → datacore :4001）须显式暴露 content-disposition，浏览器才读得到文件名（.synthetic 诚实位）。
        .header("access-control-expose-headers", "content-disposition")
        .send("﻿" + lines.join("\r\n"));
    }
    // xlsx：node-xlsx build([{name, data:[header,...rows]}])。工作表名去非法字符、限 31 字符（xlsx 规范）。
    const sheetName = safe(ds.name).slice(0, 31) || "data";
    const data: (string | number | boolean)[][] = [cols, ...rows.map((r) => cols.map((k) => cell(r[k])))];
    const buf = xlsx.build([{ name: sheetName, data, options: {} }]);
    return reply
      .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("content-disposition", `attachment; filename="${base}.xlsx"`)
      .header("access-control-expose-headers", "content-disposition")
      .send(buf);
  });
  // 数据源节点在线编辑（A7 增量）：行内修改上传数据并留痕（_editedAt）。
  app.patch("/a/v1/raw-datasets/:id/rows/:idx", async (req) => {
    const c = ctx(req);
    if (!c.roles.some((r) => ["admin", "data_admin"].includes(r.split(":")[0] as string))) {
      throw forbidden("admin / data_admin only");
    }
    const { id, idx } = req.params as { id: string; idx: string };
    const ds = await repos.rawDatasets.get(c.tenantId, id);
    if (!ds) throw notFound("raw dataset");
    const patch = (req.body ?? {}) as Record<string, unknown>;
    const rows = await repos.rawRows.list(c.tenantId, id);
    const i = Number(idx);
    if (!Number.isInteger(i) || i < 0 || i >= rows.length) throw notFound("row");
    rows[i] = { ...rows[i], ...patch, _editedAt: new Date().toISOString() };
    await repos.rawRows.replace(c.tenantId, id, rows);
    return { ok: true, idx: i, row: rows[i] };
  });

  // ---- A2 rule docs ----------------------------------------------------------------------
  app.post("/a/v1/rule-docs", async (req, reply) => {
    const c = ctx(req);
    let filename: string;
    let content: Buffer;
    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) throw validationError("multipart file required");
      filename = file.filename;
      content = await file.toBuffer();
    } else {
      const body = parseBody(RuleDocJsonSchema, req.body);
      filename = body.filename;
      content = Buffer.from(body.contentBase64, "base64");
    }
    // T1：异步——准备 doc（进 EXTRACTING）后立即 202 返回，抽取后台跑（真打 LLM 数百秒不阻塞 HTTP，
    // 不再被客户端/网关超时中断）；前端轮询 GET /a/v1/rule-docs/:id 状态 + /candidates 至终态。
    const result = await ruleDocs.uploadAndStartExtraction(c, filename, content);
    return reply.status(202).send({
      docId: result.doc.id,
      jobId: result.jobId,
      status: result.doc.status, // EXTRACTING
      candidateCount: 0, // 异步：候选随后台抽取产出，前端轮询 /candidates
      droppedCandidates: result.doc.droppedCandidates,
    });
  });
  // VM 映射：segments 兜底空数组；duplicateOf 取疑似重复规则的 key（前端审核台消费）。
  const ruleDocVM = (d: Awaited<ReturnType<typeof ruleDocs.getDoc>>) => ({ ...d, segments: d.segments ?? [] });
  const candidateVM = (c: Awaited<ReturnType<typeof ruleDocs.review>>) => ({
    ...c,
    duplicateOf: c.suspectedDuplicateOf?.ruleKey,
  });
  app.get("/a/v1/rule-docs", async (req) => {
    const docs = await repos.ruleDocs.list(ctx(req).tenantId);
    return docs
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((d) => ruleDocVM(d));
  });
  app.get("/a/v1/rule-docs/:id", async (req) => {
    const { id } = req.params as { id: string };
    return ruleDocVM(await ruleDocs.getDoc(ctx(req), id));
  });
  app.get("/a/v1/rule-docs/:id/candidates", async (req) => {
    const { id } = req.params as { id: string };
    const { status } = req.query as { status?: string };
    return (await ruleDocs.listCandidates(ctx(req), id, status)).map(candidateVM);
  });
  app.post("/a/v1/rule-candidates/:id/review", async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(ReviewSchema, req.body);
    return candidateVM(await ruleDocs.review(ctx(req), id, body.action, body.patch));
  });
  // 执行语义 §6：分段抽取段落级状态 + 失败段落单独重试（PARTIAL 任务）
  app.get("/a/v1/rule-docs/:id/segments", async (req) => {
    const { id } = req.params as { id: string };
    return { items: await ruleDocs.listSegments(ctx(req), id) };
  });
  app.post("/a/v1/rule-docs/:id/segments/:segNo/retry", async (req) => {
    const { id, segNo } = req.params as { id: string; segNo: string };
    return ruleDocVM(await ruleDocs.retrySegment(ctx(req), id, Number(segNo)));
  });

  // ---- A3 modeling -----------------------------------------------------------------------
  app.post("/a/v1/modeling/suggest", async (req, reply) => {
    const body = parseBody(SuggestSchema, req.body);
    const draft = await modeling.suggest(ctx(req), body.rawDatasetIds);
    return reply.status(202).send({ draftId: draft.id, status: draft.status });
  });
  // 确定性建模管线（无 LLM；构造上字段全建模 100% 覆盖）——参考 nano-ontoprompt，融进 A3。
  app.post("/a/v1/modeling/derive", async (req, reply) => {
    const body = parseBody(SuggestSchema, req.body);
    const draft = await modeling.derive(ctx(req), body.rawDatasetIds);
    return reply.status(201).send({ draftId: draft.id, status: draft.status });
  });
  // 字段全建模覆盖报告（R12）：覆盖率 + 未建模字段清单。
  app.get("/a/v1/modeling/drafts/:id/coverage", async (req) => {
    const { id } = req.params as { id: string };
    return modeling.coverage(ctx(req), id);
  });
  // VM 映射：附带 datasets 字段画像（前端建模工作台左栏，PRD §7.6）。
  const modelingDraftVM = async (c: AuthCtx, d: Awaited<ReturnType<typeof modeling.getDraft>>) => ({
    ...d,
    datasets: await Promise.all(
      d.rawDatasetIds.map(async (dsId) => {
        const ds = await repos.rawDatasets.get(c.tenantId, dsId);
        return ds ? { name: ds.name, fields: ds.fields } : { name: dsId, fields: [] };
      }),
    ),
  });
  app.get("/a/v1/modeling/drafts", async (req) => {
    const c = ctx(req);
    const drafts = await repos.ontologyDrafts.list(c.tenantId);
    return Promise.all(
      drafts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((d) => modelingDraftVM(c, d)),
    );
  });
  app.get("/a/v1/modeling/drafts/:id", async (req) => {
    const c = ctx(req);
    const { id } = req.params as { id: string };
    return modelingDraftVM(c, await modeling.getDraft(c, id));
  });
  app.patch("/a/v1/modeling/drafts/:id", async (req) => {
    const c = ctx(req);
    const { id } = req.params as { id: string };
    const body = parseBody(DraftPatchSchema, req.body);
    return modelingDraftVM(
      c,
      await modeling.patchDraft(c, id, body.operations as unknown as import("./domain.js").DraftOperation[]),
    );
  });
  app.post("/a/v1/modeling/drafts/:id/publish", async (req) => {
    const { id } = req.params as { id: string };
    // requireFullCoverage（R12 字段全建模门）：未建模字段阻断发布（默认关，保持向后兼容）。
    const requireFullCoverage = (req.body as { requireFullCoverage?: boolean } | undefined)?.requireFullCoverage === true;
    try {
      const result = await modeling.publishDraft(ctx(req), id, { requireFullCoverage });
      return { ok: true, ...result };
    } catch (err) {
      // 前端 PRD §7.6：发布校验错误内联展示在对应卡片 → {ok:false, errors:[{typeKey,message}]}
      if (err instanceof AppError && err.code === "VALIDATION_ERROR") {
        const msgs = err.message.replace(/^publish validation failed: /, "").split("; ");
        return {
          ok: false,
          errors: msgs.map((m) => {
            const i = m.indexOf(":");
            return i > 0
              ? { typeKey: m.slice(0, i).trim(), message: m.slice(i + 1).trim() }
              : { typeKey: "", message: m };
          }),
        };
      }
      throw err;
    }
  });
  app.post("/a/v1/modeling/drafts/:id/materialize", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await modeling.materialize(ctx(req), id);
    return reply.status(202).send(result);
  });

  // ---- WO-IMPORT-MULTITABLE (G1) · 企业级多表 FK 批量导入（"导入侧"·PRD-enterprise-dataset-import §3.1）----
  // 暗发（R3 先于 authz）：data-import.multitable defaultOn:false → 关 = 404 FEATURE_NOT_FOUND。
  // ⛔ R14：平台代码零行业/电池常数——FK/类型全走既有确定性 deriveModelingSuggestion（无 LLM·R6），归域由调用方给。
  // 守 R-NO-ORPHAN-SOURCE：物化对象挂真 rawDatasetId（origin.datasetId）→ 删源即报孤儿（no-orphan 门）。
  app.post("/a/v1/modeling/derive-batch", async (req, reply) => {
    const c = ctx(req);
    if (!(await features.enabled(c.tenantId, "data-import.multitable"))) throw featureNotFound();
    const body = parseBody(DeriveBatchRequestSchema, req.body);
    const r = await modeling.deriveBatch(c, body);
    const s = r.draft.suggestion;
    return reply.status(r.published ? 201 : 200).send({
      draftId: r.draft.id,
      status: r.draft.status,
      objectTypes: s.objectTypes.map((t) => ({
        typeKey: t.typeKey,
        sourceDataset: t.sourceDataset,
        primaryKey: t.properties.find((p) => p.isPrimaryKey)?.propKey ?? null,
        domain: t.domain,
        propertyCount: t.properties.length,
      })),
      links: s.linkTypes.map((l) => ({
        fromTypeKey: l.fromTypeKey,
        toTypeKey: l.toTypeKey,
        name: l.nameSuggestion,
        viaFromField: l.viaFields.fromField,
        viaToField: l.viaFields.toField,
        cardinality: l.cardinality,
        confidence: l.confidence,
      })),
      fkCandidates: r.draft.fkCandidates,
      published: r.published ?? null,
      materialize: r.materialize ?? null,
      publishErrors: r.publishErrors ?? null,
    });
  });

  // 多文件 / zip 整包批量上传（Stage 3.15 output 目录一次进）。每文件复用单文件上传正门（连接器可见·挂真源）。
  // 逐文件成败独立报告（一张坏表不拖垮整批）；zip 内仅结构化扩展（csv/json/xlsx）入库，其余诚实跳过并报。
  app.post("/a/v1/uploads/batch", async (req, reply) => {
    const c = ctx(req);
    if (!(await features.enabled(c.tenantId, "data-import.multitable"))) throw featureNotFound();
    if (!req.isMultipart()) throw validationError("multipart required（一个或多个文件，或一个 .zip 整包）");
    const uploads: { filename: string; connId: string; datasetName: string; rawDatasetId: string | null; rowCount: number | null }[] = [];
    const errors: { filename: string; message: string }[] = [];
    const STRUCTURED = ["csv", "json", "xlsx"];
    const doUpload = async (filename: string, content: Buffer) => {
      try {
        const r = await connectors.upload(c, filename, content);
        const rds = (await connectors.listRawDatasets(c, r.connection.id))[0];
        uploads.push({
          filename,
          connId: r.connection.id,
          datasetName: r.schema.datasets[0]?.name ?? r.connection.name,
          rawDatasetId: rds?.id ?? null,
          rowCount: rds?.rowCount ?? null,
        });
      } catch (e) {
        errors.push({ filename, message: e instanceof Error ? e.message : String(e) });
      }
    };
    for await (const part of req.parts()) {
      if (part.type !== "file") continue;
      const buf = await part.toBuffer();
      const fn = part.filename || "upload";
      if (fn.toLowerCase().endsWith(".zip")) {
        // zip 整包：解压逐条目上传（懒加载 jszip·仅 zip 路径需要）。
        const { default: JSZip } = await import("jszip");
        const zip = await JSZip.loadAsync(buf);
        for (const entry of Object.values(zip.files)) {
          if (entry.dir) continue;
          const base = entry.name.split("/").pop() || entry.name;
          const ext = (base.split(".").pop() ?? "").toLowerCase();
          if (!STRUCTURED.includes(ext)) {
            errors.push({ filename: entry.name, message: `zip 内跳过非结构化文件 .${ext}（仅 csv/json/xlsx 入库）` });
            continue;
          }
          await doUpload(base, Buffer.from(await entry.async("nodebuffer")));
        }
      } else {
        await doUpload(fn, buf);
      }
    }
    return reply.status(201).send({ uploads, errors });
  });

  // ---- WO-IMPORT-ONTOLOGY (G2) · 客户本体直导（objects.json/relations.json → ObjectType/LinkType·PRD §3.2）----
  // 暗发（R3）：data-import.ontology-bundle defaultOn:false → 关 = 404 FEATURE_NOT_FOUND。
  // ⛔ R14：bundle 是外部自带本体，平台零行业常数；只搬结构、按名绑已上传数据（可选）。
  // 诚实边界：断链/表缺/字段缺 → gaps 逐项报（不静默建空/断链）；strict → 有缺口即不建不发布。
  app.post("/a/v1/ontology/import", async (req, reply) => {
    const c = ctx(req);
    if (!(await features.enabled(c.tenantId, "data-import.ontology-bundle"))) throw featureNotFound();
    const body = parseBody(OntologyImportBundleSchema, req.body);
    const r = await modeling.importOntologyBundle(c, body);
    // strict 阻断（有缺口未落库）→ 409；正常直导 → 201。
    const blocked = r.ontologyVersion === null && body.strict === true && r.gaps.length > 0;
    return reply.status(blocked ? 409 : 201).send(r);
  });

  // ---- WO-IMPORT-SCENARIO (G3) · 场景导入（Stage 3.15 场景 JSON → 平台场景卡·PRD §3.3）----
  // 暗发（R3）：data-import.scenario defaultOn:false → 关 = 404 FEATURE_NOT_FOUND。
  // ⛔ R14：平台不含 Stage 3.15 业务语义（type→求解器不写死）；answer 声明式 query 由调用方给·缺省 objects 直列。
  // 落库 → 经 GET /a/v1/scenarios/pack 合入本租户场景包 → AgentCore 启动器目录消费（既有 datacore→agentcore seam）。
  app.post("/a/v1/scenarios/import", async (req, reply) => {
    const c = ctx(req);
    if (!(await features.enabled(c.tenantId, "data-import.scenario"))) throw featureNotFound();
    const body = parseBody(ScenarioImportRequestSchema, req.body);
    const r = await modeling.importScenarios(c, body);
    return reply.status(201).send(r);
  });
  // 已导入场景卡列表（诚实可查·前后端对照）。
  app.get("/a/v1/scenarios/imported", async (req) => {
    const c = ctx(req);
    if (!(await features.enabled(c.tenantId, "data-import.scenario"))) throw featureNotFound();
    return { items: await repos.importedScenarios.list(c.tenantId) };
  });

  // ---- WO-IMPORT-REPLACE-SYNTHETIC (G4) · 世界态源开关（synthetic|imported·PRD §3.4·配 WO-CAP-01 REALDEMAND）----
  // 暗发（R3）：data-import.world-source defaultOn:false → 关 = 404。imported → 翻开既有实值杠杆 qos.risk_realdemand
  // （求解器已消费 SolverContext.features·risk.ts 真需求-产能缺口替 mockTightness 哈希）——⛔ 平台不改求解器内部。
  // 守 R-NO-ORPHAN-SOURCE：imported 但无导入真数据 → 诚实 warning（世界态空·不假装有真值）。
  const worldSourceStatus = async (c: AuthCtx) => {
    const tenant = await repos.tenants.get(c.tenantId, c.tenantId);
    const worldSource = (tenant?.worldSource as "synthetic" | "imported") ?? "synthetic";
    const realValueLeverEnabled = await features.enabled(c.tenantId, "qos.risk_realdemand");
    const rawDatasetCount = (await repos.rawDatasets.list(c.tenantId)).length;
    // KILL-MOCK-RED 命门（复验返工）：按 provenance 数——只有真导入对象才是 imported 世界态可读真值（合成物化不算）。
    const { realImported, syntheticMaterialized } = await modeling.countWorldObjectsByProvenance(c);
    const materializedObjectCount = realImported + syntheticMaterialized;
    const leverSourcedFromRealImports = worldSource === "imported" && realValueLeverEnabled && realImported > 0;
    const warnings: string[] = [];
    if (worldSource === "imported" && realImported === 0) {
      warnings.push("world_source=imported 但无真导入 provenance 对象（0 real-sourced·全合成/未导入）→ 未翻开实值杠杆（拒绝让合成 DemandSegment 自报 LIVE 决策红·KILL-MOCK-RED）；先经 uploads/batch + derive-batch 导入真数据。");
    }
    if (worldSource === "synthetic" && realValueLeverEnabled) {
      warnings.push("world_source=synthetic 但实值杠杆 qos.risk_realdemand 开（行业模板默认·非 world_source 控制）→ 合成 DemandSegment 可能自报 LIVE；如需纯合成回退请 PUT {worldSource:synthetic} 显式关杠杆（标签=行为）。");
    }
    return { worldSource, realValueLeverEnabled, leverSourcedFromRealImports, rawDatasetCount, materializedObjectCount, realImportedObjectCount: realImported, warnings };
  };
  app.get("/a/v1/world-source", async (req) => {
    const c = ctx(req);
    if (!(await features.enabled(c.tenantId, "data-import.world-source"))) throw featureNotFound();
    return worldSourceStatus(c);
  });
  app.put("/a/v1/world-source", async (req) => {
    const c = ctx(req);
    if (!(await features.enabled(c.tenantId, "data-import.world-source"))) throw featureNotFound();
    requireAdmin(c);
    const body = parseBody(WorldSourceSchema, req.body);
    const tenant = await repos.tenants.get(c.tenantId, c.tenantId);
    if (!tenant) throw notFound("tenant");
    await repos.tenants.put({ ...tenant, worldSource: body.worldSource });
    // KILL-MOCK-RED 命门（复验返工）：imported 仅在**有真导入 provenance 对象**时翻开实值杠杆——否则拒绝（保持关），
    // 不让合成物化在 imported 下自报 LIVE 决策红。synthetic → 显式关杠杆（回退合成·标签=行为·消除 default 态标签≠行为）。
    const { realImported } = await modeling.countWorldObjectsByProvenance(c);
    const enableLever = body.worldSource === "imported" && realImported > 0;
    const existing = await repos.featureConfigs.get(c.tenantId, `fcfg_${c.tenantId}`);
    const merged = { ...(existing?.overrides ?? {}), "qos.risk_realdemand": enableLever };
    await features.putTenantConfig(c, c.tenantId, merged);
    solvers.invalidateFeatureCache(c.tenantId); // 暗发开关翻转即时生效于求解器（回退演练）。
    return worldSourceStatus(c);
  });

  // ---- A7 synthetic -----------------------------------------------------------------------
  // 前端 PRD §7.7 六阶段轮询形态（作业同步完成 → 阶段即终态快照）。
  const SYNTHETIC_PHASES = ["行业模板", "本体实例化", "源对象生成", "历史时序生成（90 天）", "派生计算", "配套生成与校验"];
  const syntheticJobVM = (job: NonNullable<Awaited<ReturnType<typeof repos.syntheticJobs.get>>>) => {
    const failed = job.status === "FAILED";
    const report = job.report;
    const ts = report?.timeseries;
    return {
      ...job,
      phase: SYNTHETIC_PHASES.length - 1,
      phases: SYNTHETIC_PHASES.map((name, i) => ({
        name,
        status: failed && i === SYNTHETIC_PHASES.length - 1 ? "FAILED" : "DONE",
      })),
      report: report
        ? {
            ...report,
            timeseries: ts
              ? Object.entries(ts.pointCounts).map(([seriesKey, points]) => ({
                  seriesKey,
                  points,
                  gaps: ts.gaps.filter((g) => g.seriesKey === seriesKey).length,
                  aggSpotCheckOk: ts.aggSpotChecks.every((s) => s.ok),
                }))
              : undefined,
          }
        : undefined,
    };
  };
  app.post("/a/v1/synthetic/jobs", async (req, reply) => {
    const body = parseBody(SyntheticJobBodySchema, req.body);
    const job = await synthetic.runJob(ctx(req), body);
    return reply.status(202).send({ ...job, jobId: job.id });
  });
  app.get("/a/v1/synthetic/jobs/:id", async (req) => {
    const { id } = req.params as { id: string };
    const job = await repos.syntheticJobs.get(ctx(req).tenantId, id);
    if (!job) throw notFound("synthetic job");
    return syntheticJobVM(job);
  });
  // 行业模版下拉：内置模版（代码常数，如 battery-manufacturing —— 项目沙盘/演示数据正是它确定性生成的）
  // ∪ 本租户已存模版（LLM 生成/克隆）。内置模版此前不入 industry_templates 表 → 下拉空；这里并入surf 出来。
  app.get("/a/v1/industry-templates", async (req) => {
    const stored = await repos.industryTemplates.list(ctx(req).tenantId);
    const builtinKeys = new Set(BUILTIN_INDUSTRY_TEMPLATES.map((t) => t.industryKey));
    const builtins = BUILTIN_INDUSTRY_TEMPLATES.map((t) => ({ industryKey: t.industryKey, source: "BUILTIN" as const }));
    const rest = stored.filter((s) => !builtinKeys.has(s.industryKey)).map((s) => ({ industryKey: s.industryKey, source: s.source }));
    return [...builtins, ...rest];
  });

  // ---- Feature entitlement -----------------------------------------------------------------
  const requireAdmin = (c: AuthCtx) => {
    if (!c.roles.some((r) => ["admin", "catalog_admin"].includes(r.split(":")[0] as string))) {
      throw forbidden("admin / catalog_admin only");
    }
  };
  // ---- OntoFlow（WO-MERGE-01）本体建模工作流：CRUD/校验/预览/提升/发布 + 准备度/生成应用/通用推演 ----
  // B1 门控（Entitlement 铁律）：feature `data-builder`(apiTag) 关 → 全部 404 FEATURE_NOT_FOUND（先于 authz）。
  const requireDataBuilder = (req: FastifyRequest) => requireFeatureTag(req, "apiTags", "data-builder");
  app.get("/a/v1/ontology-workflows", async (req) => {
    await requireDataBuilder(req);
    return { items: await workflows.list(ctx(req)) };
  });
  app.post("/a/v1/ontology-workflows", async (req, reply) => {
    await requireDataBuilder(req);
    const body = parseBody(OntologyWorkflowUpsertSchema, req.body);
    const wf = await workflows.create(ctx(req), body);
    return reply.status(201).send(wf);
  });
  app.get("/a/v1/ontology-workflows/:id", async (req) => {
    await requireDataBuilder(req);
    return workflows.get(ctx(req), (req.params as { id: string }).id);
  });
  app.put("/a/v1/ontology-workflows/:id", async (req) => {
    await requireDataBuilder(req);
    const body = parseBody(OntologyWorkflowUpsertSchema, req.body);
    return workflows.update(ctx(req), (req.params as { id: string }).id, body);
  });
  app.post("/a/v1/ontology-workflows/:id/validate", async (req) => {
    await requireDataBuilder(req);
    return workflows.validate(ctx(req), (req.params as { id: string }).id);
  });
  app.post("/a/v1/ontology-workflows/:id/preview", async (req) => {
    await requireDataBuilder(req);
    // WO-MERGE-03 C1：rows 直传 或 source 引用（经 databuilder 取样）二选一（向后兼容：仍可只传 rows）。
    const body = parseBody(z.object({ nodeId: z.string().min(1), rows: z.array(z.record(z.string(), z.unknown())).optional(), source: PreviewSourceRefSchema.optional() }), req.body);
    return workflows.preview(ctx(req), (req.params as { id: string }).id, body);
  });
  app.post("/a/v1/ontology-workflows/:id/nodes/:nodeId/promote", async (req) => {
    await requireDataBuilder(req);
    const { id, nodeId } = req.params as { id: string; nodeId: string };
    return workflows.promote(ctx(req), id, nodeId);
  });
  app.post("/a/v1/ontology-workflows/:id/publish", async (req) => {
    await requireDataBuilder(req);
    return workflows.publish(ctx(req), (req.params as { id: string }).id);
  });
  app.post("/a/v1/ontology-workflows/:id/readiness", async (req) => {
    await requireDataBuilder(req);
    return workflows.readiness(ctx(req), (req.params as { id: string }).id);
  });
  app.post("/a/v1/ontology-workflows/:id/scaffold", async (req) => {
    await requireDataBuilder(req);
    return workflows.scaffold(ctx(req), (req.params as { id: string }).id);
  });
  app.post("/a/v1/ontology-workflows/:id/inference", async (req) => {
    await requireDataBuilder(req);
    const body = parseBody(GenericInferenceInputSchema, req.body);
    return workflows.inference(ctx(req), (req.params as { id: string }).id, body);
  });
  // ---- A7 Foundry-Grade Data Builder（agent 驱动 data pipeline 发动机）------------------------
  app.get("/a/v1/data-builders", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return databuilder.list(c);
  });
  app.get("/a/v1/data-builders/:id", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return databuilder.get(c, (req.params as { id: string }).id);
  });
  app.post("/a/v1/data-builders", async (req, reply) => {
    const c = ctx(req);
    requireAdmin(c);
    const body = req.body as { key: string; name: string; description?: string; config?: unknown };
    if (!body?.key || !body?.name) throw validationError("key and name required");
    return reply.status(201).send(await databuilder.create(c, body));
  });
  app.put("/a/v1/data-builders/:id", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return databuilder.update(c, (req.params as { id: string }).id, req.body as { name?: string; description?: string; config?: unknown });
  });
  app.post("/a/v1/data-builders/:id/publish", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return databuilder.publish(c, (req.params as { id: string }).id);
  });
  app.post("/a/v1/data-builders/:id/new-version", async (req, reply) => {
    const c = ctx(req);
    requireAdmin(c);
    return reply.status(201).send(await databuilder.newVersion(c, (req.params as { id: string }).id));
  });
  app.post("/a/v1/data-builders/:id/retire", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return databuilder.retire(c, (req.params as { id: string }).id);
  });
  // 校验配置（二次配置时前端可预检）
  app.post("/a/v1/data-builders/validate-config", async (req) => {
    requireAdmin(ctx(req));
    return { ok: true, config: DataBuilderConfigSchema.parse(req.body) };
  });
  // 运行 build（七阶段引擎；dryRun=预览不落库）
  app.post("/a/v1/data-builders/run", async (req, reply) => {
    const c = ctx(req);
    requireAdmin(c);
    const body = parseBody(BuildRunBodySchema, req.body);
    const job = await databuilder.run(c, body);
    return reply.status(job.status === "FAILED" ? 200 : 202).send({ ...job, jobId: job.id });
  });
  app.get("/a/v1/data-builders/jobs/list", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return databuilder.listJobs(c);
  });
  app.get("/a/v1/data-builders/plans/:id", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return databuilder.getPlan(c, (req.params as { id: string }).id);
  });

  // g8 故事驱动全栈倒推 · P1：StoryBuildRun = 构建期历史推演记录（提交故事脚本 → 建域 → 记录可回放）
  // P2：stage="manifest" → 先倒推补录表单（PENDING_INPUT，不建域），由 PATCH inputs 续跑。
  app.post("/a/v1/databuilder/runs", async (req, reply) => {
    const c = ctx(req);
    requireAdmin(c);
    const body = parseBody(StoryRunRequestSchema, req.body);
    if (body.stage === "manifest") {
      const run = await databuilder.previewStory(c, { script: body.script, seed: body.seed });
      return reply.status(201).send(run);
    }
    const run = await databuilder.runStory(c, { script: body.script, seed: body.seed, builderKey: body.builderKey, buildMode: body.buildMode }, body.inference ?? false);
    return reply.status(run.status === "FAILED" ? 200 : 201).send(run);
  });
  app.patch("/a/v1/databuilder/runs/:id/inputs", async (req, reply) => {
    const c = ctx(req);
    requireAdmin(c);
    const body = parseBody(StoryInputsBodySchema, req.body);
    const run = await databuilder.submitStoryInputs(c, (req.params as { id: string }).id, body.inputs);
    return reply.status(run.status === "FAILED" ? 200 : 201).send(run);
  });
  app.get("/a/v1/databuilder/runs", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return databuilder.listStoryRuns(c);
  });
  app.get("/a/v1/databuilder/runs/:id", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return databuilder.getStoryRun(c, (req.params as { id: string }).id);
  });
  // UPG-L0-GAPCORE（PRD-gap-analysis-engine §3/§11）：有界配套现状快照——仅 6 类 A 栈（DataCore 真拥有），
  // B 栈 cross_system 聚合归 AgentCore（§3）。R3 entitlement 先于 authz：功能关（暗发 defaultOn:false）→ 404；
  // 仅服务间凭证（x-service-token → roles=["service"]）或 OBO service，用户 JWT 一律 403（与 notify-role 同范式）。
  app.get("/a/v1/databuilder/registry-snapshot", async (req) => {
    const c = ctx(req);
    if (!(await features.enabled(c.tenantId, "databuilder.registry-snapshot"))) throw featureNotFound();
    if (!c.roles.includes("service")) throw forbidden("registry-snapshot is service-to-service only");
    return buildRegistrySnapshot({ repos, ontology }, c);
  });
  // 工业级工作流运行时：持久化步骤状态机（检查点/可重入/可重试/可观测）。
  // POST 启动一次故事建域工作流；GET 看运行 + 逐步状态/尝试/计时（可观测）；resume 从崩溃/失败处续跑。
  app.post("/a/v1/databuilder/workflow-runs", async (req, reply) => {
    const c = ctx(req);
    requireAdmin(c);
    const body = parseBody(BuildWorkflowStartBodySchema, req.body);
    const rb = BuildRunBodySchema.parse({ script: body.script, seed: body.seed, builderKey: body.builderKey, buildMode: body.buildMode });
    const wf = await databuilder.runStoryWorkflow(c, rb, body.inference ?? false, { async: body.async ?? false });
    // 异步：202 Accepted + 初始 RUNNING 快照（后台驱动，GET 轮询观察）；同步：201/200 终态。
    const code = body.async ? 202 : wf.status === "FAILED" ? 200 : 201;
    return reply.status(code).send(wf);
  });
  // 启动恢复：进程死亡时停在 RUNNING 的工作流逐个 resume 续跑（部署侧 boot 后可调）。
  app.post("/a/v1/databuilder/workflow-runs/recover", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return databuilder.recoverInterrupted(c);
  });
  // A7：单条建域的 B 栈 scaffold 持久清单（单机可见，不依赖 AGENTCORE_BASE_URL）。
  app.get("/a/v1/databuilder/runs/:id/scaffold-manifest", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return databuilder.getScaffoldManifest(c, (req.params as { id: string }).id);
  });
  // A7.2：B 上线后幂等对账（把单机态 PENDING_BSTACK 清单逐个下发 → 升 SCAFFOLDED/REUSED）。
  app.post("/a/v1/databuilder/reconcile-scaffold", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return databuilder.reconcileScaffold(c);
  });
  // A10：终态闭环末步——手动重跑主问句验证"现在真能答了"（亲手跑通；自动路由由 publish 后 onComplete 触发）。
  app.post("/a/v1/databuilder/runs/:id/verify", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return databuilder.verifyBuild(c, (req.params as { id: string }).id);
  });
  // A18.4 整域晋升编排：人工审核通过 PROVISIONAL 未审核域 → 隔离数据迁入真租户 + 逐制品晋升临时求解器
  // GOVERNED + 翻转域信任级（R4：晋升=人工审批动作）。发 domain.promoted。
  app.post("/a/v1/databuilder/runs/:id/promote", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return databuilder.promoteDomain(c, (req.params as { id: string }).id);
  });
  // prototype-intake 正门：上传原型 HTML → 确定性抽数据表 + 关系（R6）→ 对既有本体字段对账预览
  // （能映射自动接、映射不上生成候选给人确认，类比 MergeCandidate；不调 LLM）。发 prototype.intake_recorded。
  app.post("/a/v1/databuilder/intake", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const body = parseBody(IntakeRequestSchema, req.body);
    const intake = parsePrototypeHtml(body.html);
    const existing: ExistingTypeField[] = (await ontology.listTypes(c)).flatMap((t) => t.properties.map((p) => ({ typeKey: t.key, propKey: p.propKey })));
    const reconcile = reconcileIntake(intake.dataSources, existing);
    // P2：把对账候选落库为 HITL 队列（人确认 USE/RENAME/NEW/MERGE/DISCARD），preview 同时返回。
    const persisted = await Promise.all(reconcile.candidates.map(async (cand, i) => {
      const id = `rcc_${c.tenantId}_${Date.now()}_${i}`;
      const rec = { ...cand, id, tenantId: c.tenantId };
      await repos.reconcileCandidates.put(rec);
      return rec;
    }));
    await outbox.emit(c.tenantId, "prototype.intake_recorded", { datasets: intake.dataSources.length, links: intake.links.length, unparsed: intake.unparsed.length, candidates: persisted.length });
    return { intake, reconcile: { ...reconcile, candidates: persisted } };
  });
  // prototype-intake P3 导入正门：HTML 物化进库 = 经连接器（prototype_html）落 RawDataset，
  // 数据连接器可见此"导入文件"+ 在线查看每张表（值与原型一致；不写死前端代码 R8 数据流）。
  app.post("/a/v1/databuilder/intake/import", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const body = parseBody(IntakeImportRequestSchema, req.body);
    const result = await connectors.importPrototype(c, body.filename, body.html);
    const datasets = (await connectors.listRawDatasets(c, result.connection.id)).map((d) => ({
      id: d.id, name: d.name, rowCount: d.rowCount, fields: d.fields.map((f) => f.name),
    }));
    await outbox.emit(c.tenantId, "prototype.materialized", { connId: result.connection.id, datasets: datasets.length, rows: Object.values(result.rowCounts).reduce((a, b) => a + b, 0) });
    return { connection: result.connection, datasets, rowCounts: result.rowCounts };
  });
  // prototype-intake P3 闭环末步：把已导入的 RawDataset 按确定性 schema 对账物化进既有对象库
  // （"对账后的列" → 既有 type.field，不新建/不发布类型）→ ObjectInstance 可查（/admin/object-types 计数）。
  app.post("/a/v1/databuilder/intake/objectify", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const body = parseBody(IntakeObjectifyRequestSchema, req.body);
    const datasets = await connectors.listRawDatasets(c, body.connId);
    if (datasets.length === 0) throw notFound("connection raw datasets");
    const result = await modeling.materializeFromReconcile(c, datasets.map((d) => d.id));
    // WO-INTAKE-VISIBILITY（G-VIS-1）：列名未精确命中的列不再静默丢——落 reconcile-candidates 队列（带 connId+样本值），
    // 前端 SchemaReconcile 页逐列确认。确定性 id（tenantId+connId+dataset+column）→ 再 objectify 幂等不重复。
    const persistedCandidates = await Promise.all(
      result.reconcileCandidates.map(async (cand) => {
        const id = `rcc_${c.tenantId}_${body.connId}_${cand.datasetName}_${cand.prototypeColumn}`.replace(/[^\p{L}\p{N}_-]/gu, "_");
        const existing = await repos.reconcileCandidates.get(c.tenantId, id);
        // 已被人确认（RESOLVED）的不覆盖；否则落/刷新 PENDING 候选。
        if (existing?.status === "RESOLVED") return existing;
        const rec = { ...cand, id, tenantId: c.tenantId, connId: body.connId };
        await repos.reconcileCandidates.put(rec);
        return rec;
      }),
    );
    await outbox.emit(c.tenantId, "prototype.objectified", { connId: body.connId, materialized: result.materialized.length, objects: result.materialized.reduce((a, m) => a + m.count, 0), candidates: persistedCandidates.length });
    return { ...result, candidates: persistedCandidates.length };
  });
  // prototype-intake P2 / WO-INTAKE-VISIBILITY：对账候选队列（HITL）。支持 status + connId 过滤。
  app.get("/a/v1/databuilder/reconcile-candidates", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const q = req.query as { status?: string; connId?: string };
    const items = (await repos.reconcileCandidates.list(c.tenantId)).filter(
      (x) => (q.status ? x.status === q.status : true) && (q.connId ? x.connId === q.connId : true),
    );
    return { items };
  });
  // prototype-intake P2：人确认某候选（USE/RENAME/NEW/MERGE/DISCARD + 目标字段）→ RESOLVED + 事件。
  app.post("/a/v1/databuilder/reconcile-candidates/:id/resolve", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const cand = await repos.reconcileCandidates.get(c.tenantId, (req.params as { id: string }).id);
    if (!cand) throw notFound("reconcile candidate");
    const body = parseBody(ReconcileResolveBodySchema, req.body);
    const resolved = { ...cand, status: "RESOLVED" as const, resolvedAction: body.action, ...(body.target ? { resolvedTarget: body.target } : {}), resolvedAt: new Date().toISOString() };
    await repos.reconcileCandidates.put(resolved);
    await outbox.emit(c.tenantId, "schema_reconcile.resolved", { id: resolved.id, column: resolved.prototypeColumn, action: body.action });
    return resolved;
  });
  app.get("/a/v1/databuilder/workflow-runs", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return databuilder.listWorkflowRuns(c);
  });
  app.get("/a/v1/databuilder/workflow-runs/:id", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return databuilder.getWorkflowRun(c, (req.params as { id: string }).id);
  });
  // A5：FDE 编排工作流节点状态图（8 节点实时投影；前端 <FdeGraph> 轮询 + fde.node_advanced 点亮）。
  app.get("/a/v1/databuilder/workflow-runs/:id/fde-graph", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return databuilder.fdeGraph(c, (req.params as { id: string }).id);
  });
  app.post("/a/v1/databuilder/workflow-runs/:id/resume", async (req, reply) => {
    const c = ctx(req);
    requireAdmin(c);
    const wf = await databuilder.resumeStoryWorkflow(c, (req.params as { id: string }).id);
    return reply.status(wf.status === "FAILED" ? 200 : 201).send(wf);
  });
  // g8-P6 存量回填：逆向导出既有推演能力为故事脚本 → 逐条建域补血缘 = 首次全量压测
  app.post("/a/v1/databuilder/backfill", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return databuilder.backfill(c);
  });
  // g8-P4 压测：跑一组故事脚本，统计覆盖率/失败率（自动生成管线压测）
  app.post("/a/v1/databuilder/stress", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const body = parseBody(StressBodySchema, req.body);
    return databuilder.stress(c, body.scripts, body.seed);
  });
  // g8-P5 故事脚本自动生成器：从平台能力目录派生候选脚本（供持续自动输入/压测）
  app.get("/a/v1/databuilder/generate-scripts", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return databuilder.generateScripts();
  });

  app.get("/a/v1/features/registry", async (req) => {
    const c = ctx(req);
    // 管理平台增量 §3：静态注册表 + 本租户动态注册项（view.{viewKey}）。
    return features.registryFor(c.tenantId);
  });
  app.get("/a/v1/tenants/:id/features", async (req, reply) => {
    const c = ctx(req);
    const { id } = req.params as { id: string };
    if (id !== c.tenantId) throw forbidden("cross-tenant feature read");
    const resolved = await features.resolve(id);
    const etag = `W/"fv-${resolved.configVersion}"`;
    reply.header("etag", etag);
    if (req.headers["if-none-match"] === etag) return reply.status(304).send();
    return resolved;
  });
  app.put("/a/v1/tenants/:id/features", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const { id } = req.params as { id: string };
    if (id !== c.tenantId) throw forbidden("cross-tenant feature write");
    const body = parseBody(z.object({ overrides: z.record(z.string(), z.boolean()) }), req.body);
    await features.putTenantConfig(c, id, body.overrides);
    solvers.invalidateFeatureCache(id); // WO-CAP-01：暗发功能开关翻转即时生效于求解器（qos.risk_realdemand·回退演练）
    return features.resolve(id);
  });
  app.put("/a/v1/tenants/:id/features/roles/:role", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const { id, role } = req.params as { id: string; role: string };
    if (id !== c.tenantId) throw forbidden("cross-tenant feature write");
    const body = parseBody(z.object({ overrides: z.record(z.string(), z.boolean()) }), req.body);
    await features.putRoleConfig(c, id, role, body.overrides);
    solvers.invalidateFeatureCache(id); // WO-CAP-01：同上（角色层 override 变更亦清缓存）
    return features.resolve(id, role);
  });
  app.get("/a/v1/tenants/:id/features/preview", async (req) => {
    const c = ctx(req);
    const { id } = req.params as { id: string };
    if (id !== c.tenantId) throw forbidden("cross-tenant feature read");
    const { role } = req.query as { role?: string };
    const resolved = await features.resolve(id, role);
    // 前端 PRD（Entitlement 增量）：预览某角色将看到的导航/视图
    const enabled = new Set(resolved.features);
    const allowed = (key: string) => {
      if (RETIRED_VIEW_KEYS.has(key)) return false; // GRAPH-PANORAMA-ONLY 防幽灵
      const fk = VIEW_FEATURE_MAP[key];
      return !fk || enabled.has(fk);
    };
    const configs = await repos.viewConfigs.list(c.tenantId, (v) => !role || v.role === role);
    const viewMap = new Map<string, { key: string; title: string }>();
    for (const v of configs.flatMap((vc) => vc.views)) {
      if (allowed(v.key) && !viewMap.has(v.key)) viewMap.set(v.key, { key: v.key, title: v.title });
    }
    const navMap = new Map<string, { key: string; label: string }>();
    for (const n of configs.flatMap((vc) => vc.navigation)) {
      if ((n.group ?? "business") === "business" && !allowed(n.viewKey ?? n.key)) continue;
      if (!navMap.has(n.key)) navMap.set(n.key, { key: n.key, label: n.label });
    }
    return { ...resolved, navigation: [...navMap.values()], views: [...viewMap.values()] };
  });
  app.get("/a/v1/tenants/:id/features/audit", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const { id } = req.params as { id: string };
    if (id !== c.tenantId) throw forbidden("cross-tenant feature read");
    return features.audit(id);
  });

  // ---- S3 scheduler --------------------------------------------------------------------------
  app.get("/a/v1/scheduler/jobs", async (req) => {
    const { kind } = req.query as { kind?: string };
    return scheduler.listJobs(ctx(req).tenantId, kind);
  });
  app.post("/a/v1/scheduler/jobs/:id/pause", async (req) => {
    const { id } = req.params as { id: string };
    return scheduler.setStatus(ctx(req).tenantId, id, "PAUSED");
  });
  app.post("/a/v1/scheduler/jobs/:id/resume", async (req) => {
    const { id } = req.params as { id: string };
    return scheduler.setStatus(ctx(req).tenantId, id, "ACTIVE");
  });
  app.get("/a/v1/scheduler/jobs/:id/runs", async (req) => {
    const { id } = req.params as { id: string };
    return scheduler.listRuns(ctx(req).tenantId, id);
  });

  // ---- S1.8 S&OP (apiTag "sop" → view.sop-balance entitlement) --------------------------------
  app.post("/a/v1/sop/versions", async (req, reply) => {
    await requireFeatureTag(req, "apiTags", "sop");
    const body = parseBody(
      z.object({ month: z.string(), inputs: z.record(z.string(), z.unknown()).default({}) }),
      req.body,
    );
    return reply.status(201).send(await sop.create(ctx(req), body));
  });
  app.get("/a/v1/sop/versions", async (req) => {
    await requireFeatureTag(req, "apiTags", "sop");
    return sop.list(ctx(req));
  });
  app.get("/a/v1/sop/versions/:id", async (req) => {
    await requireFeatureTag(req, "apiTags", "sop");
    const { id } = req.params as { id: string };
    return sop.get(ctx(req), id);
  });
  app.patch("/a/v1/sop/versions/:id", async (req) => {
    await requireFeatureTag(req, "apiTags", "sop");
    const { id } = req.params as { id: string };
    // 两种请求形态：{ fields: {...} }（API 调用方）或字段直接平铺在 body（SPA PATCH 形态）
    const body = parseBody(z.record(z.string(), z.unknown()), req.body);
    const fields =
      body["fields"] != null && typeof body["fields"] === "object" && !Array.isArray(body["fields"])
        ? (body["fields"] as Record<string, unknown>)
        : body;
    return sop.patch(ctx(req), id, fields);
  });
  app.post("/a/v1/sop/versions/:id/advance", async (req) => {
    await requireFeatureTag(req, "apiTags", "sop");
    const { id } = req.params as { id: string };
    const body = parseBody(
      z.object({ step: z.number().int().min(1).max(5), payload: z.record(z.string(), z.unknown()).default({}) }),
      req.body,
    );
    return sop.advance(ctx(req), id, body.step, body.payload);
  });
  app.post("/a/v1/sop/versions/:id/finalize", async (req) => {
    await requireFeatureTag(req, "apiTags", "sop");
    const { id } = req.params as { id: string };
    return sop.finalize(ctx(req), id);
  });
  // 增量 §7.10：当前定稿 S&OP 版本 → plan_audit 输入字段集（规划体检基线）。
  app.get("/a/v1/plan-versions/current", async (req) => {
    await requireFeatureTag(req, "apiTags", "plan-audit");
    return sop.currentPlanVersion(ctx(req));
  });

  // CL.4 空租户冷启动引导（PRD-empty-tenant-bootstrap）：把"从空到可用计划域"理成幂等、确定、
  // 可一键跑的 7 步清单（合成 seed → 核对物化 → 建 SopVersion → 五步法 → 定稿 FINAL 走 R4 →
  // 核对 currentPlanVersion → plan_audit 有料）。任一步核对未达 → 停并报结构化缺口（诚实，不空转）。
  app.post("/a/v1/bootstrap", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const reqBody = parseBody(BootstrapRequestSchema, req.body ?? {});
    const steps: BootstrapStep[] = [];
    const report = (ok: boolean, finalVersionId?: string, gap?: BootstrapReport["gap"]): BootstrapReport => ({ ok, steps, finalVersionId, ...(gap ? { gap } : {}) });
    const countType = async (t: string) => (await repos.objects.listByType(c.tenantId, t)).filter((o) => !o.mergedInto).length;

    // ① 合成 seed 计划域（幂等：已有 PlanTarget 则跳过重合成，同 seed 字节一致 R6）
    let ptCount = await countType("PlanTarget");
    if (ptCount > 0) {
      steps.push({ step: 1, name: "合成 seed 计划域", status: "SKIPPED", verify: `已有 PlanTarget×${ptCount}（幂等跳过）` });
    } else {
      const job = await synthetic.runJob(c, { industry: reqBody.industry, scale: reqBody.scale, seed: reqBody.seed, livedIn: true });
      ptCount = await countType("PlanTarget");
      steps.push({ step: 1, name: "合成 seed 计划域", status: "DONE", produced: { jobId: job.id, seed: reqBody.seed }, verify: `job ${job.status}` });
    }
    // ② 核对计划目标物化
    if (ptCount === 0) {
      steps.push({ step: 2, name: "核对计划目标物化", status: "FAILED", gapCode: "EMPTY_PLAN_TARGET", verify: "PlanTarget 仍为 0" });
      return report(false, undefined, { step: 2, code: "EMPTY_PLAN_TARGET", hint: "合成未产出 PlanTarget；检查行业模板/seed" });
    }
    steps.push({ step: 2, name: "核对计划目标物化", status: "DONE", produced: { planTargets: ptCount }, verify: `PlanTarget×${ptCount}` });
    // ③ 核对年度情景
    const scenCount = await countType("AnnualScenario");
    if (scenCount === 0) {
      steps.push({ step: 3, name: "核对年度情景", status: "FAILED", gapCode: "EMPTY_SCENARIO", verify: "AnnualScenario 为 0" });
      return report(false, undefined, { step: 3, code: "EMPTY_SCENARIO", hint: "合成未产出 AnnualScenario" });
    }
    steps.push({ step: 3, name: "核对年度情景", status: "DONE", produced: { scenarios: scenCount } });
    // ④ 建/复用月度计划版本
    const existing = (await sop.list(c)).filter((v) => v.month === reqBody.month).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    let version = existing[existing.length - 1] ?? (await sop.create(c, { month: reqBody.month }));
    steps.push({ step: 4, name: "建月度计划版本", status: existing.length > 0 ? "SKIPPED" : "DONE", produced: { versionId: version.id, month: reqBody.month } });
    // ⑤ 五步法推进（幂等：已 EXEC_MEETING/FINAL 则跳过）。步①②③缺省 payload 从合成数据确定性派生；
    // 步④财务需显式输入（否则现金垫=0 触 C18 阻断）——取参数版本基线（cashCushion/gmTarget）作冷启动种子，
    // 使 gmRoll=gmBudget、现金垫≥C18 底线，确定性达标进⑤（R6；基线值=种子配置非前端写死 R14）。
    if (version.status === "DRAFT" || version.status === "IN_REVIEW") {
      const params = await solvers.getParams(c.tenantId);
      const baseline = (params.planBaseline as { gmTarget?: number; cashCushion?: number } | undefined) ?? { gmTarget: 16, cashCushion: 58 };
      const cashFloor = Number((params.sop as { cashFloor?: number } | undefined)?.cashFloor ?? 50);
      const gmBudget = Number(baseline.gmTarget ?? 16);
      for (let s = 1; s <= 5; s++) {
        let payload: Record<string, unknown> = {};
        if (s === 4) {
          const dem = Number((version.steps.s3 as { dem?: number } | undefined)?.dem) || 100;
          payload = { revSum: dem, gmSum: Math.round((dem * gmBudget) / 100 * 1e4) / 1e4, gmBudget, cashCushion: Math.max(Number(baseline.cashCushion ?? 58), cashFloor) };
        }
        version = await sop.advance(c, version.id, s, payload);
      }
      steps.push({ step: 5, name: "五步法推进", status: "DONE", verify: `status=${version.status}` });
    } else {
      steps.push({ step: 5, name: "五步法推进", status: "SKIPPED", verify: `已 ${version.status}` });
    }
    // ⑥ 定稿 → FINAL（走 R4 Action；单 admin 经 SA 自审）
    if (version.status !== "FINAL") {
      try {
        await sop.assertFinalizeRequestable(c.tenantId, version.id);
        const draft = await actions.create(c, {
          actionTypeKey: "定稿月度计划版本",
          payload: { versionId: version.id, month: version.month, snapshot: { steps: version.steps, supFinal: version.supFinal }, resolutions: version.resolutions },
          submit: true,
        });
        await sop.markFinalizePending(c.tenantId, version.id, draft.id);
        await actions.approve(c, draft.id);
        version = await sop.get(c, version.id);
      } catch (err) {
        const code = err instanceof AppError ? err.code : "FINALIZE_FAILED";
        steps.push({ step: 6, name: "定稿→FINAL（R4）", status: "FAILED", gapCode: code, verify: String((err as Error).message) });
        return report(false, version.id, { step: 6, code, hint: "定稿失败：单 admin 需 SA 自审（demo 默认 ALLOW_ADMIN，生产配 SELF_APPROVE_POLICY/类型 selfApproveAllowed）" });
      }
      steps.push({ step: 6, name: "定稿→FINAL（R4）", status: version.status === "FINAL" ? "DONE" : "FAILED", produced: { finalVersionId: version.id }, verify: `status=${version.status}` });
    } else {
      steps.push({ step: 6, name: "定稿→FINAL（R4）", status: "SKIPPED", verify: "已 FINAL" });
    }
    // ⑦ 核对 currentPlanVersion + 跑 plan_audit（入参取当前版本/PlanTarget 基线确定性派生）
    const cur = await sop.currentPlanVersion(c);
    if (!cur.versionId) {
      steps.push({ step: 7, name: "核对 currentPlanVersion + plan_audit", status: "FAILED", gapCode: "NO_CURRENT_VERSION", verify: "currentPlanVersion 为空" });
      return report(false, version.id, { step: 7, code: "NO_CURRENT_VERSION", hint: "无 FINAL 版本，计划域仍不可用于体检" });
    }
    let auditDiagnostics = 0;
    try {
      const audit = await ontology.invokeSolver(c, "plan_audit", cur.input as Record<string, unknown>);
      const data = audit.data as { diagnostics?: unknown[] } | undefined;
      auditDiagnostics = Array.isArray(data?.diagnostics) ? data!.diagnostics!.length : 0;
    } catch {
      /* plan_audit 入参不全时不阻断 bootstrap：currentPlanVersion=FINAL 即"从空到可用"达成 */
    }
    steps.push({ step: 7, name: "核对 currentPlanVersion + plan_audit", status: "DONE", produced: { currentVersion: cur.versionLabel, planAuditDiagnostics: auditDiagnostics }, verify: `currentPlanVersion=${cur.status}` });
    return report(true, cur.versionId);
  });

  // ---- 计划域查询面（增量 §7.14/§7.15；entitlement: plan-aop / plan-quarterly tag）-----------------
  app.get("/a/v1/plan/aop", async (req) => {
    await requireFeatureTag(req, "apiTags", "plan-aop");
    const { year } = req.query as { year?: string };
    return plan.aop(ctx(req), year ? Number(year) : undefined);
  });
  app.get("/a/v1/plan/quarterly", async (req) => {
    await requireFeatureTag(req, "apiTags", "plan-quarterly");
    const { from, n } = req.query as { from?: string; n?: string };
    return plan.quarterly(ctx(req), from, n ? Math.max(1, Number(n) || 6) : 6);
  });
  // 触发判定为后端扫描（RULE_SCAN 周期挂接）；此端点供运维/演示手动触发一轮。
  app.post("/a/v1/plan/triggers/scan", async (req) => plan.scanTriggers(ctx(req).tenantId));

  // ---- M11 校准（增量 §7.21；catalog_admin / planner）---------------------------------------------
  const requirePlannerOrAdmin = (c: AuthCtx) => {
    if (!c.roles.some((r) => ["admin", "catalog_admin", "planner"].includes(r.split(":")[0] as string))) {
      throw forbidden("planner / catalog_admin only");
    }
  };
  app.get("/a/v1/calibration/report", async (req) => {
    const c = ctx(req);
    const q = req.query as { objectType?: string; solverKey?: string; baseId?: string; from?: string };
    return calibration.report(c.tenantId, q);
  });
  app.get("/a/v1/calibration/proposals", async (req) => calibration.listProposals(ctx(req).tenantId));
  app.get("/a/v1/calibration/history", async (req) => calibration.history(ctx(req).tenantId));
  // WO-L1.5-4（反馈学习闭环·§2.4/§4.4·接现校准·不新造调参器）：把**决策结果偏差**（Decision 预测vs实现）
  // 归一为 FeedbackSignal(OUTCOME_DELTA) 并作**额外校准触发**——转既有 onCalibrationRequired（复用 EMA/重放/
  // 分位数学 + 回测门 + Action R4·**校准应用路径零改**·autoApply 恒 false·**绝不无人值守自改真值**·R4/NG1）。
  // 提案仍 PENDING 待 S2「校准参数变更」审批。FeedbackSignal 瞬态咨询（不落业务真值表）。
  app.post("/a/v1/calibration/feedback", async (req) => {
    const c = ctx(req);
    const body = parseBody(
      z.object({
        kind: z.enum(["OUTCOME_DELTA", "VOTE", "CASE_REUSE"]).default("OUTCOME_DELTA"),
        sourceRefId: z.string().min(1), // 溯源：Decision.id（OUTCOME_DELTA）/ taskId
        entityId: z.string().min(1), // 校准目标实体（如 modelId·决定触发哪个 slice 的校准）
        metricDeltas: z.record(z.string(), z.number()).optional(),
      }),
      req.body,
    );
    const signal = {
      signalId: newId("fbk"),
      tenantId: c.tenantId,
      kind: body.kind,
      sourceRefId: body.sourceRefId,
      metricDeltas: body.metricDeltas,
      verdict: null,
      at: new Date().toISOString(),
    };
    // 额外触发（不改数学）：转现校准提案生成（PENDING·经回测门·仍待 R4 审批）。
    const proposal = await calibration.onCalibrationRequired(c.tenantId, body.entityId);
    return { signal, proposalId: proposal?.id ?? null, proposalStatus: proposal?.status ?? null };
  });
  // WO-E1（校准活体常态化）：收敛史回执（逐轮 mapeAfter 下降 = 越用越准的证据·R2）。
  app.get("/a/v1/calibration/convergence", async (req) => {
    const c = ctx(req);
    const points = await calibration.convergenceHistory(c.tenantId);
    const first = points[0];
    const last = points[points.length - 1];
    const improvedPct = first && last ? Number((first.mapeAfter - last.mapeAfter).toFixed(2)) : 0;
    // FILL-E1-CALIB-LIVE·C1 dataMode 透出：末轮回落静态基线（无真配对）→ 顶层 baselineOnly=true，
    // 前端据此改画"静态基线·无真实配对·未测得改进"，不把 flat 水平线冒充"收敛良好"（诚实边界）。
    const baselineOnly = last?.baselineOnly === true;
    return {
      points: points.map((p) => ({
        round: p.round,
        at: p.at,
        trigger: p.trigger,
        mapeBefore: p.mapeBefore,
        mapeAfter: p.mapeAfter,
        slicesEvaluated: p.slicesEvaluated,
        proposalsCreated: p.proposalsCreated,
        autoApplied: p.autoApplied,
        ...(p.paramsVersion !== undefined ? { paramsVersion: p.paramsVersion } : {}),
        ...(p.baselineOnly !== undefined ? { baselineOnly: p.baselineOnly } : {}),
      })),
      rounds: points.length,
      improvedPct,
      converging: !last || !first ? true : last.mapeAfter <= first.mapeAfter,
      ...(baselineOnly ? { baselineOnly: true } : {}),
    };
  });
  // WO-E1：手动触发一轮活体清扫（运维/演示/FDE 真跑·catalog_admin；常态由 CALIBRATION_SWEEP cron 跑）。
  app.post("/a/v1/calibration/sweep", async (req) => {
    const c = ctx(req);
    if (!c.roles.some((r) => ["admin", "catalog_admin"].includes(r.split(":")[0] as string))) {
      throw forbidden("catalog_admin only");
    }
    return calibration.sweep(c.tenantId, "手动");
  });
  // 批准/回滚不直改参数：创建 `校准参数变更` Action（§S2 审批链），EXECUTED 后才落 solver_params。
  const calibrationAction = async (req: FastifyRequest, mode: "approve" | "rollback") => {
    const c = ctx(req);
    requirePlannerOrAdmin(c);
    const { id } = req.params as { id: string };
    const proposal = await calibration.getProposal(c.tenantId, id);
    await authz.require(c, "ACTION_TYPE", "校准参数变更", "EXECUTE");
    const draft = await actions.create(c, {
      actionTypeKey: "校准参数变更",
      payload: { proposalId: proposal.id, mode, parameter: proposal.parameter, proposedValue: proposal.proposedValue },
    });
    return { draftId: draft.id, status: draft.status, proposalId: proposal.id };
  };
  app.post("/a/v1/calibration/proposals/:id/approve", async (req, reply) =>
    reply.status(202).send(await calibrationAction(req, "approve")));
  app.post("/a/v1/calibration/proposals/:id/rollback", async (req, reply) =>
    reply.status(202).send(await calibrationAction(req, "rollback")));
  // M11 §3 手动触发（报告页「立即校准」按钮；catalog_admin）：配对 → 元闭环 → 全切片提案生成。
  app.post("/a/v1/calibration/run", async (req) => {
    const c = ctx(req);
    if (!c.roles.some((r) => ["admin", "catalog_admin"].includes(r.split(":")[0] as string))) {
      throw forbidden("catalog_admin only");
    }
    return calibration.runAll(c.tenantId, "手动");
  });

  // ---- 数据健康度（增量 §7.22；与 C09/P90 降级同一事实源）------------------------------------------
  app.get("/a/v1/data-health", async (req) => buildDataHealth(repos, solvers, features, ctx(req).tenantId));

  // ---- S4 knowledge base ------------------------------------------------------------------------
  app.post("/a/v1/kb/search", async (req) => {
    const body = parseBody(
      z.object({ query: z.string().min(1), topK: z.number().int().min(1).max(10).optional(), connId: z.string().optional() }),
      req.body,
    );
    return kb.search(ctx(req), body);
  });
  app.post("/a/v1/kb/:connId/docs", async (req, reply) => {
    const c = ctx(req);
    const { connId } = req.params as { connId: string };
    let filename: string;
    let content: Buffer;
    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) throw validationError("multipart file required");
      filename = file.filename;
      content = await file.toBuffer();
    } else {
      const body = parseBody(RuleDocJsonSchema, req.body);
      filename = body.filename;
      content = Buffer.from(body.contentBase64, "base64");
    }
    const result = await kb.addDoc(c, connId, filename, content);
    return reply.status(201).send({ docId: result.doc.id, chunkCount: result.chunkCount });
  });
  app.post("/a/v1/kb/:connId/sync", async (req, reply) => {
    const { connId } = req.params as { connId: string };
    return reply.status(202).send(await kb.sync(ctx(req), connId));
  });
  // WO-KB-UI（G-VIS-1）：列出某 kb 连接已灌文档（前端知识库页文档表·补断层：此前无列表路由）。
  app.get("/a/v1/kb/:connId/docs", async (req) => {
    const { connId } = req.params as { connId: string };
    return kb.listDocs(ctx(req), connId);
  });

  // ---- A8 timeseries ------------------------------------------------------------------------------
  app.post("/a/v1/timeseries/agg-query", async (req) => {
    const body = parseBody(QueryTimeseriesAggInputSchema, req.body);
    return timeseries.aggQuery(ctx(req), body);
  });
  app.get("/a/v1/timeseries/agg-specs", async (req) => repos.tsAggSpecs.list(ctx(req).tenantId));
  app.post("/a/v1/timeseries/aggregate", async (req, reply) => {
    const c = ctx(req);
    const body = parseBody(z.object({ specKeys: z.array(z.string()).optional(), full: z.boolean().optional() }), req.body);
    return reply.status(202).send(await timeseries.runAggregation(c.tenantId, body));
  });

  // ---- A8.6 simulation clock -------------------------------------------------------------------------
  // 前端 PRD §7.7 模拟时钟 VM：{ simDate, currentTick, status, script[] }（保留原字段）。
  const DAY_MS = 86400000;
  const clockVM = (clock: Record<string, unknown>) => ({
    ...clock,
    simDate: clock["simulatedDate"],
    script: ((clock["scriptProgress"] as { tick: number; event: string; fired: boolean }[]) ?? []).map((s) => ({
      tick: s.tick,
      event: s.event,
      fired: s.fired,
    })),
  });
  app.get("/a/v1/synthetic/clock", async (req) => clockVM(await simclock.getClock(ctx(req))));
  app.get("/a/v1/synthetic/clock/ticks", async (req) => {
    const c = ctx(req);
    const clock = await repos.simulationClocks.get(c.tenantId, c.tenantId);
    const t0 = clock ? Date.parse(`${clock.t0.slice(0, 10)}T00:00:00Z`) : Date.now();
    const reports = await repos.clockTickReports.list(c.tenantId);
    return reports
      .sort((a, b) => b.toTick - a.toTick)
      .map((r) => ({
        ...r,
        tick: r.toTick,
        simDate: new Date(t0 + r.toTick * DAY_MS).toISOString().slice(0, 10),
        changedProps: r.topChangedSnapshots.map((s) => ({
          object: `${s.objectType}-${s.objectId}`,
          prop: s.property,
          from: s.from ?? 0,
          to: s.to,
        })),
        newAlerts: r.alertsRaised.map((a) => ({ ruleKey: a.split(":")[0] as string, message: a })),
        clearedAlerts: r.alertsCleared,
        forecastDeviation: r.forecastDeviation?.deviation,
      }));
  });
  app.post("/a/v1/synthetic/clock/tick", async (req, reply) => {
    const body = parseBody(ClockTickBodySchema, req.body);
    const result = await simclock.tick(ctx(req), body.advance);
    return reply.status(202).send({ tickJobId: result.tickJobId, status: "SUCCEEDED", report: result.report });
  });
  app.post("/a/v1/synthetic/clock/reset", async (req, reply) => {
    return reply.status(202).send(clockVM(await simclock.reset(ctx(req))));
  });

  // ---- 运营态出厂配置增量 §5/§6（history/bundle 行级权限过滤；watermark 全局徽章；live-ingest 替换路径） ----
  app.get("/a/v1/history/bundle", async (req) => {
    // Entitlement 先于 authz：view.review 关闭 = 不存在 → 404 FEATURE_NOT_FOUND
    await requireFeatureTag(req, "apiTags", "history");
    const q = req.query as { page?: string; pageSize?: string };
    return history.bundle(ctx(req), {
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    });
  });
  app.get("/a/v1/history/watermark", async (req) => history.watermark(ctx(req)));
  app.post("/a/v1/history/live-ingest", async (req, reply) => {
    const c = ctx(req);
    requireAdmin(c);
    await requireFeatureTag(req, "apiTags", "history");
    const body = parseBody(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }), req.body);
    return reply.status(202).send(await history.liveIngest(c, body.month));
  });

  // ---- webhooks / outbox (C-2) ---------------------------------------------------------------
  app.post("/a/v1/webhooks", async (req, reply) => {
    const c = ctx(req);
    const body = parseBody(WebhookSchema, req.body);
    const hook = { id: newId("wh"), tenantId: c.tenantId, url: body.url, events: body.events, status: "ACTIVE" as const };
    await repos.webhooks.put(hook);
    return reply.status(201).send(hook);
  });
  app.get("/a/v1/webhooks", async (req) => repos.webhooks.list(ctx(req).tenantId));
  app.get("/a/v1/outbox", async (req) => {
    // 领域事件馈源（D-29 实时环 F1）：前端按 ?since=<ISO> 游标轮询，把上游变更反映到被动页面。
    // 缺省返回全量（向后兼容）；带 since 则只回 createdAt>=since（含边界,前端按 eventId 去重），按时间升序、上限 200。
    const since = (req.query as { since?: string } | undefined)?.since;
    const all = await repos.outboxEvents.list(ctx(req).tenantId);
    const sorted = all.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    const filtered = since ? sorted.filter((e) => e.createdAt >= since) : sorted;
    // status 为 additive 字段（WO-RETENTION 可核对清理后 PENDING 保留 / DISPATCHED 已删）。
    return filtered.slice(-200).map((e) => ({ eventId: e.eventId, event: e.event, status: e.status, createdAt: e.createdAt }));
  });

  // ---- WO-RETENTION（⑤·数据留存/TTL）：留存策略读写 + 手动清理（admin·R2 限本租户）---------------
  app.get("/a/v1/retention-policies", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return { policies: await retention.listPolicies(c.tenantId), defaults: RETENTION_DEFAULTS };
  });
  app.put("/a/v1/retention-policies", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const body = parseBody(
      z.object({
        table: RetentionTableSchema,
        keepDays: z.number().int().min(0),
        status: z.enum(["ACTIVE", "PAUSED"]).optional(),
      }),
      req.body,
    );
    return retention.setPolicy(c.tenantId, body.table, {
      keepDays: body.keepDays,
      status: body.status,
      updatedBy: c.userId,
    });
  });
  // 手动触发清理（运维/排障/FDE 真跑·R2 限本租户）——常态由 RETENTION_SWEEP 每日 cron 跑。
  app.post("/a/v1/retention-policies/sweep", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    return retention.sweep(c.tenantId);
  });

  // ---- WO-ENTERPRISE-DR-AUDIT（sub-B·外部审计对接·SIEM sink）--------------------------------------
  //   - 复用 append-only audit_log 作馈源 + 游标 sinceAt 增量 NDJSON 旁路推送到外部 SIEM。
  //   - R3 Entitlement 先于 authz：`audit-sink` feature 关 → 404 FEATURE_NOT_FOUND（先于 requireAdmin）。
  //   - R5 no-secrets-echo：secret 加密落库·响应**仅回 credentialRef 存在标记**，绝不回显明文/密文。
  //   - 旁路不阻主写：flush 内部吞投递失败（不返 5xx），本地 audit_log 不受影响。
  const sanitizeSink = (s: AuditSink) => ({
    id: s.id,
    tenantId: s.tenantId,
    kind: s.kind,
    endpoint: s.endpoint,
    status: s.status,
    // 仅回"是否已配 secret"——绝不回显密文/明文（R5）。
    credentialRef: s.credentialRef ? "cred:configured" : undefined,
    sinceAt: s.sinceAt,
    lastFlushAt: s.lastFlushAt,
    lastError: s.lastError,
    updatedAt: s.updatedAt,
    updatedBy: s.updatedBy,
  });
  app.get("/a/v1/audit-sinks", async (req) => {
    await requireFeatureTag(req, "apiTags", "audit-sink"); // R3：关=404，先于 authz
    const c = ctx(req);
    // 读者门：admin / platform_admin / auditor（含配置的目标 endpoint，非敏感·secret 已脱敏）。
    if (!c.roles.some((r) => ["admin", "platform_admin", "auditor"].includes(r.split(":")[0] as string))) {
      requireAdmin(c);
    }
    const sinks = await auditSink.listSinks(c.tenantId);
    return sinks.map(sanitizeSink);
  });
  app.put("/a/v1/audit-sinks", async (req) => {
    await requireFeatureTag(req, "apiTags", "audit-sink"); // R3：关=404，先于 authz
    const c = ctx(req);
    requireAdmin(c);
    const body = parseBody(AuditSinkInputSchema, req.body);
    const sink = await auditSink.setSink(c, body);
    return sanitizeSink(sink);
  });
  app.post("/a/v1/audit-sinks/flush", async (req) => {
    await requireFeatureTag(req, "apiTags", "audit-sink"); // R3：关=404，先于 authz
    const c = ctx(req);
    requireAdmin(c);
    // 旁路：flush 内部吞投递失败（不抛）→ 恒 200，回执含 delivered/ok（主写不受影响）。
    return auditSink.flush(c.tenantId);
  });

  // ---- LLM Provider 配置体系增量 §1 + 引用上报（§2.3） -------------------------------------------
  registerLlmProviderRoutes(app, { repos, service: llmProviders, outbox, ctx, fetchImpl: deps.fetchImpl ?? fetch });

  // ---- 管理平台增量：§2 租户/用户 + §3 场景包/视图配置 ------------------------------------------
  registerAdminPlatformRoutes(app, { repos, outbox, audit, features, ctx });

  // PATCH connection (schedule changes re-register/unregister CONNECTOR_SYNC jobs)
  app.patch("/a/v1/connections/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(
      z.object({
        name: z.string().optional(),
        schedule: z.object({ cron: z.string() }).nullable().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      }),
      req.body,
    );
    return connectors.updateConnection(ctx(req), id, body);
  });

  // ---- 回放编排器与虚拟操作团队 路由 ----------------------------------------
  const requireTenantAdmin = (req: FastifyRequest): AuthCtx => {
    const c = ctx(req);
    if (!c.roles.some((r) => r === "tenant_admin" || r.split(":")[0] === "admin")) {
      throw forbidden("需要 tenant_admin 角色");
    }
    return c;
  };

  // §1 虚拟操作团队（SYNTHETIC 租户；真实租户建虚拟账号被拒 R9）
  app.get("/a/v1/ops/personas", async (req) => ({ items: await opsTeam.listPersonas(ctx(req).tenantId) }));
  app.post("/a/v1/ops/personas/seed", async (req, reply) => {
    const c = requireTenantAdmin(req);
    const personas = await opsTeam.seedDefaultPersonas(c.tenantId); // 内部隔离守卫 → 403 R9
    return reply.status(201).send({ items: personas });
  });
  app.get("/a/v1/ops/playbook", async (req) => ({ playbook: await opsTeam.getPlaybook(ctx(req).tenantId) }));
  app.put("/a/v1/ops/playbook", async (req) => {
    const c = requireTenantAdmin(req);
    return { playbook: await opsTeam.putPlaybook(c.tenantId, req.body as never) }; // 隔离守卫 R9
  });
  app.get("/a/v1/ops/pools", async (req) => {
    ctx(req);
    return { pools: poolSnapshot() };
  });
  app.get("/a/v1/ops/tick-reports", async (req) => {
    const reports = await repos.opsTickReports.list(ctx(req).tenantId);
    return { items: reports.sort((a, b) => a.tick - b.tick) };
  });

  // §6 OpsSchedule（真实租户运营自动化；管理台 /admin/ops-schedule，tenant_admin）
  app.get("/a/v1/ops/schedule", async (req) => ({ schedule: await opsSchedule.get(ctx(req).tenantId) }));
  app.put("/a/v1/ops/schedule", async (req) => {
    const c = requireTenantAdmin(req);
    const body = parseBody(OpsScheduleSchema, req.body);
    return { schedule: await opsSchedule.put(c, body) };
  });

  // §6-C 类隔离：真实租户「自动提问/虚拟审批」无入口 —— API 直调被拒（R13）。
  app.post("/a/v1/ops/auto-ask", async (req) => {
    const c = ctx(req);
    if (!(await opsTeam.isSyntheticTenant(c.tenantId))) OpsScheduleService.assertNotVirtualOps();
    throw forbidden("虚拟提问仅经模拟时钟回放在 SYNTHETIC 租户产生，无直调入口");
  });

  return {
    app,
    services: {
      auth,
      authz,
      outbox,
      execLocks,
      quarantine,
      notifications,
      catalog,
      vle,
      rules,
      ontology,
      ontologyCore,
      governance,
      connectors,
      ruleDocs,
      modeling,
      synthetic,
      metrics,
      solvers,
      timeseries,
      scheduler,
      retention,
      ruleScan,
      actions,
      databuilder,
      sop,
      kb,
      simclock,
      features,
      configBundle,
      embeddings,
      plan,
      calibration,
      llmProviders,
      livedin: livedInEngine,
      history,
      opsTeam,
      opsSchedule,
      opsReplay,
    },
  };
}
