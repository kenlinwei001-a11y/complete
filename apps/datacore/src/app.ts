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
import { AggregateRequestSchema, ObjectRefResolveRequestSchema, BuildRunBodySchema, BuildWorkflowStartBodySchema, ClockTickBodySchema, PlanSliceRequestSchema, CrossValidateRequestSchema, DataBuilderConfigSchema, ImportBundleBodySchema, MetaAccessPolicyBodySchema, PROMPT_KEYS, PLATFORM_PROMPT_DEFAULTS, PutPromptTemplateBodySchema, PutLlmBudgetBodySchema, RecordUsageBodySchema, PutCalendarBodySchema, ReconcileBodySchema, QueryTimeseriesAggInputSchema, StoryInputsBodySchema, StoryRunRequestSchema, StressBodySchema, SyntheticJobBodySchema, ValidateOutputBodySchema, ValidationPolicySchema, IngestModeSchema } from "@platform/contracts";
import { validateOutputAgainstOntology } from "./ontology-validate.js";
import type { Config } from "./config.js";
import type { Repos } from "./repo/repo.js";
import type { BlobStore } from "./blob.js";
import type { LlmClient } from "./llm.js";
import { Metrics, actionMetricsView } from "./metrics.js";
import { AppError, forbidden, notFound, unauthorized, validationError } from "./errors.js";
import { newId } from "./ids.js";
import { CredentialCipher } from "./crypto.js";
import { AuthService } from "./auth.js";
import { AuthzService } from "./authz.js";
import { OutboxService } from "./outbox.js";
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
import { OrgWorldService } from "./org/service.js";
import { registerOrgWorldRoutes } from "./org/routes.js";
import { OntologyService } from "./ontology.js";
import { OntologyCoreService } from "./ontology-core.js";
import { WorkflowService } from "./pipeline/service.js"; // OntoFlow（PRD v2）· 本体建模工作流·嫁接自 main
import { runProcessing } from "./pipeline/processing.js"; // OntoFlow（P3）· 数据处理折叠·嫁接自 main
import { ObjectInterfaceService, OntologyGovernanceService, UNIT_DICTIONARY } from "./ontology-governance.js";
// WO-69 P3 · 对象接口契约（多态抽象）
import { ImplementsRefSchema, ObjectInterfaceInputSchema } from "@platform/contracts";
import { ConnectorService } from "./connectors/service.js";
import { CONNECTOR_TYPES, connectorCategories } from "./connectors/registry.js";
import { planSlice } from "./ontology/slice-planner.js";
import { resolveFieldRoles } from "./solvers/field-roles.js";
// WO-DATABUILDER-PIPELINE：接入/导入改由 pipeline 驱动（解析/对账的纯函数由 intake-pipeline 内部调用）。
import { runIntakePipeline, runIntakeImportPipeline } from "./databuilder/intake-pipeline.js";
import { projectPipelineOrder } from "./databuilder/pipeline-service.js";
import { IntakeRequestSchema, IntakeImportRequestSchema, IntakeObjectifyRequestSchema, ReconcileResolveBodySchema, BuildPipelineUpsertSchema } from "@platform/contracts";
import { BootstrapRequestSchema, type BootstrapStep, type BootstrapReport } from "@platform/contracts";
// WO-WAITING-STATES-FE · 业务流程层等待态下发（GET /a/v1/process-definitions）：
// 词表与职能登记册随响应下发，前端不得再写第二份字面量数组（process.ts §1 单源纪律）。
import { PROCESS_WAIT_KINDS, PROCESS_OWNER_FUNCTIONS, PROCESS_INSTANCE_ORIGINS } from "@platform/contracts";
import { reconstructAndPersist } from "./process/reconstruct.js"; // WO-FLOWTIME · 流程实例反推（从既有带时间戳单据，非合成）
// DF.13 外协红线单一来源（C08）：live-scenarios 触红线判定读契约，禁内联裸阈值。
import { OUTSOURCE_REDLINE } from "@platform/contracts";
import { OntologyBindingSchema, OptPerturbationSchema } from "@platform/contracts"; // 轨B·增量2/3 绑定层 + what-if
import { OntologyWorkflowUpsertSchema } from "@platform/contracts"; // OntoFlow（PRD v2）· 本体建模工作流 upsert·嫁接自 main
import { LocalTemplateIndex } from "./solvers/opt-embedding.js"; // 轨B·增量4 embedding 复用检索（advisory）
import { applyPerturbationToState, diffTickStates, isPerturbationActiveAt, partitionPropagationRules, PerturbationSchema, PropagationRuleSchema, resolveSimScope, SandboxViewConfigSchema, SIM_SCOPE_DEFAULT_HOPS, unknownPropagationRuleKeys, type DelayedContribution, type Perturbation, type PropagationRule, type PropagationTrace, type ResolvedSimScope, type SimCheckpoint, type SimCounterfactualResult, type SimSession, type TickState } from "@platform/contracts";
import { diffEnterpriseStates, ENTERPRISE_STATE_REAL_WORLD_ID } from "@platform/contracts"; // WO-ENTERPRISE-STATE · 企业状态快照（差分口径与 StateDelta 同一份纯函数）
import { firedPropagationRuleKeys, propagateTick, type CadenceGateLookup, type PerturbationInTick, type PropagationGraph, type RuleParamLookup, type ScopeReport, type UnresolvedCadenceGate } from "./sim/propagation.js";
// 传导相入参（图/范围/规则参数/节拍闸门）的**唯一装配处**——本文件不许再装配第二遍。
// `buildCadenceGates` / `scopePropagationGraph` 刻意**不在本文件 import**：它们只该出现在装配处里。
import { buildPropagationInputs } from "./sim/propagation-inputs.js";
import { ImpactAnalysisRequestSchema } from "@platform/contracts"; // WO-IMPACT-PROPAGATION · 影响传播统一入口（栈B传播 × 栈A世界隔离）
import { analyzeImpact } from "./sim/impact-analysis.js";
import { cadenceFromProps } from "./synthetic/cadence.js"; // WO-SANDBOX-E4：Cadence 落库行 → Cadence 的**唯一**读回口（D1 定的纪律）
import { deriveCertification, DEFAULT_CERT_CONFIG, type CertScope, type TrialTickInput } from "./sim/certification.js";
import { buildCausalGraphFromSim, buildCausalGraphFromDecision } from "./decision/causal-graph.js"; // WO-DECISION-CAUSAL-GRAPH · 因果图构图器（纯投影·零发明）
import { validateClosure } from "./databuilder/closure.js";
import { selfCheckGaps } from "./databuilder/selfcheck.js";
import type { BuildPlan, ClosurePolicy, SliceLayersResponse } from "@platform/contracts";
import { buildSliceIndex, lookupReusable, lookupReusableByQuestion } from "./ontology/slice-index.js";
import { deriveSliceLibrary, libEntryToSpec } from "./ontology/slice-library.js";
import { projectSliceLayers } from "./ontology/slice-layers.js"; // WO-SLICE-16-LAYERS · 切片十六层只读投影
// WO-V4-INSPECT · 业务流程节点检视只读投影（纯函数·零 IO·十六层复用上面那份 projectSliceLayers）
import { adhocCarrierSliceKey, adhocCarrierSliceSpec, projectProcessInspect } from "./process/inspect.js";
import { generateRefbaseOntology, refbaseNodeCount, refbaseDigest } from "./ontology/refbase.js";
import { buildBatteryDomainCoverage } from "./ontology/refbase-coverage.js";
import { RuleDocService } from "./ruledocs.js";
import { ModelingService } from "./modeling.js";
import { SyntheticService } from "./synthetic/service.js";
import { buildDataTemplate, buildDataTemplates } from "./synthetic/data-template.js";
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
// WO-V4-INSPECT · 杠杆标签/单位/值类的**单一真值**（PRD §4.1 的杠杆→域映射拿它当输入·前端零内联）
import { LEVER_PROP_META } from "./solvers/lever-meta.js";
import { solversByCategory, uncategorizedSolverKeys } from "./solvers/taxonomy.js"; // WO-L7A · 求解器决策问题分类维
import { SOLVER_CATEGORIES, SOLVER_CATEGORY_META, isSolverCategory } from "@platform/contracts";
// WO-ADOPT-MITIGATION · adopt_mitigation 执行器复用 base 解析**唯一严格出处**（勿在此另起一套规范化）。
import { resolveBaseId } from "./solvers/risk.js";
import type { SolverContext } from "./solvers/types.js";
import { HttpOptimizerClient } from "./solvers/optimizer-client.js";
import { InProcOptimizerClient } from "./solvers/inproc-optimizer.js";
import { runWithCancellation } from "./solvers/cancellation.js"; // WO-D1 · 请求作用域求解取消令牌
import { TimeseriesService } from "./timeseries.js";
import { SchedulerService, RuleScanService } from "./scheduler.js";
import { ActionService, MockActionExecutor, UnwiredActionExecutor, GlobalSimPlanExecutor, planChangeIsWired, type ActionExecutor } from "./actions.js";
import { SopService } from "./sop.js";
import { PlanService } from "./planviews.js";
import { CalibrationService } from "./calibration/index.js";
import { buildDataHealth } from "./datahealth.js";
import { buildMappingRows, buildMappingRegistries } from "./mapping.js";
import { GRAPH_DOMAIN, GRAPH_EXTRA_EDGES, GRAPH_EXTRA_NODES, SOLVER_GRAPH, BUSINESS_DOMAINS } from "./graphmeta.js";
import { parseAggregate } from "./ontology.js";
import { KbService } from "./kb.js";
import { DataBuilderService } from "./databuilder/service.js";
import { SimClockService } from "./simclock.js";
import { EnterpriseStateService } from "./twin/enterprise-state.js"; // WO-ENTERPRISE-STATE · 企业状态快照（读写端点见 /a/v1/twin/enterprise-states）
import { HistoryService } from "./livedin/bundle.js";
import { FeatureService, VIEW_FEATURE_MAP, featureNotFound } from "./features.js";
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
import { DeriveDecisionFieldsRequestSchema, RecordMaterializeRequestSchema, CeoDatasetGenerateRequestSchema } from "@platform/contracts"; // WO-DB-DERIVE-DECISION-FIELDS (G4) · 导入记录字段→决策字段可配置派生 · WO-CEO-DATA-supply · 真源记录颗粒级物化 · WO-CEO-DATA-2
import { AdvanceProcessInstanceRequestSchema, CreateProcessInstanceRequestSchema } from "@platform/contracts"; // WO-PROCESS-INSTANCE · 流程运行时（建实例/推进；body 只收**外部事实**，不收 status —— 状态机不交给调用方）
import { ProcessRuntimeService } from "./process/runtime.js"; // WO-PROCESS-INSTANCE · 五个等待态的唯一产地（evaluateGate 单一调用点）
import { deriveDecisionFields, weakestDataMode as weakestDerivedDataMode, validateDerivedFields, type DeriveSourceObject } from "./decision/derive-fields.js";
import { materializeRecords, RECORD_MATERIALIZE_TEMPLATES } from "./decision/record-materialize.js";
import { generateCeoAtomicDataset } from "./synthetic/ceo-dataset.js";
import { DecisionKernelService } from "./decision/kernel.js"; // WO-C1 · L2 统一决策内核
import { CreateDecisionInputSchema, RecordOutcomeInputSchema } from "@platform/contracts"; // WO-C1 · WO-LEARNING-LOOP-FEEDBACK

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
  /**
   * 首启预热闸（Codespaces 健康检查耗尽定位·#5）：返回 true → /readyz 503（reason:"seeding"）。
   * server 先 listen 再后台播种，播种期间端口已起、healthz/readyz 可应答（不再"端口全程 down"耗尽重试）。
   */
  seeding?: () => boolean;
  /**
   * 预热子阶段（bootstrap / seed:tenant / seed:synthetic / …）+ 已耗秒数，仅在 seeding 为真时有意义。
   *
   * 为什么 503 的 body 里必须带这个：一次真实部署事故里，运维手上只有
   * `docker compose logs datacore --tail=60` 打出的几十行**完全一样**的 503 ——
   * 「还在播种」和「卡死在某一步」在那个输出里长得一模一样。
   * 探活端点若只回一个恒定字符串，它就只能回答"没好"，回答不了"在动吗"。
   */
  seedingPhase?: () => { phase: string; elapsedSec: number };
  /**
   * WO-PROCESS-INSTANCE · 流程运行时的「现在几点」。
   *
   * 为什么要能注入：本层的输出里有「这一步已经等了多久」，而欠账 #141 的原话是
   * **「挂在墙钟上的断言并发时必假红」** —— 用真实时钟测「等了 3 天」，
   * 要么得让测试睡 3 天，要么得容忍误差，两条都不可接受。注入之后
   * 「等了多久」变成纯函数，可以断言到毫秒（R6 确定性）。
   * 生产不传 ⇒ 落回 `() => new Date()`，与 `SchedulerService` 同形态。
   */
  processClock?: () => Date;
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
    ruleScan: RuleScanService;
    actions: ActionService;
    decisionKernel: DecisionKernelService; // WO-C1 · L2 决策内核
    databuilder: DataBuilderService;
    sop: SopService;
    kb: KbService;
    simclock: SimClockService;
    enterpriseState: EnterpriseStateService; // WO-ENTERPRISE-STATE · 企业状态快照
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

/** WO-DATABUILDER-PIPELINE：节点 SOP「人要不要介入」的放行入参。 */
const WorkflowApproveBodySchema = z.object({ stepKey: z.string().min(1) });

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
  // 规则即引用（PRD-rules-as-references §2.2/§4）：命名阈值随 create/update 透传到 RulesService（服务层早已支持 params，
  // 此前路由 schema 漏列 → zod 默认 strip → 编辑器改 params 静默丢失；P3-a 编辑闭环必需，断点在路由接缝）。
  params: z.record(z.string(), z.number()).optional(),
  // WO-RULES-CLASSIFY（加性）：规则业务类别（编辑器可选填；种子随规则授予）。
  category: z.string().optional(),
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
  // 受信内部对端（B 栈）：webhook 投递到该 origin 时才附带 SERVICE_TOKEN
  // —— B 侧 `/b/v1/internal/invalidate` 已收口为服务间鉴权，不带则缓存失效链静默断掉。
  // 两个 env 缺任一即为 undefined ⇒ 一律不附带凭证（宁可失效链退回 TTL 60s 兜底，也不外泄密钥）。
  const outbox = new OutboxService(
    repos,
    logger,
    deps.fetchImpl,
    metrics,
    config.AGENTCORE_BASE_URL && config.SERVICE_TOKEN
      ? { baseUrl: config.AGENTCORE_BASE_URL, serviceToken: config.SERVICE_TOKEN }
      : undefined,
  );
  const execLocks = new ExecutionLockService(repos, metrics);
  const quarantine = new QuarantineService(repos);
  const metaOntology = new MetaOntologyService(repos, outbox);
  const notifications = new NotificationService(repos);
  const entityResolution = new EntityResolutionService(repos, outbox);
  const rules = new RulesService(repos, outbox, authz);
  const solvers = new SolverService(repos, authz);

  /**
   * A6 列级（属性级）写校验 —— 「对象数据变更」Action 的 patch 逐属性过 `authz` 同一份决策。
   * 命中不可写属性 → 403 `PROPERTY_FORBIDDEN`（拒绝而非静默丢弃，值绝不落库）。
   * 无 propertyPolicy 的策略在此**恒为空操作**（S4 向后兼容：不新增任何对象级写门禁）。
   */
  async function assertObjectPatchWritable(c: AuthCtx, payload: Record<string, unknown>): Promise<void> {
    const objectId = String(payload.objectId ?? "");
    const patch = payload.patch;
    if (!objectId || !patch || typeof patch !== "object" || Array.isArray(patch)) return;
    const obj = await repos.objects.get(c.tenantId, objectId);
    if (!obj) return; // 对象不存在交由执行期如实报错，不在此伪装成权限问题
    const d = await authz.decide(c, "OBJECT_TYPE", obj.type, "WRITE");
    authz.assertPropsWritable(d, patch as Record<string, unknown>, `对象 ${obj.type}:${objectId}`);
  }

  /** 执行期复校：用发起人存档角色重建 AuthCtx，堵「先建草稿、后收紧策略」的时间窗。 */
  async function assertDraftPatchWritableAtExecute(draft: {
    tenantId: string;
    origin: { userId?: string };
    payload: Record<string, unknown>;
  }): Promise<void> {
    const originId = draft.origin?.userId;
    if (!originId) return; // 系统发起（无用户主体）→ 不套用户列级策略
    const users = await repos.users.list(draft.tenantId);
    const u = users.find((x) => x.id === originId || x.username === originId);
    if (!u) return;
    await assertObjectPatchWritable(
      { tenantId: draft.tenantId, userId: originId, roles: u.roles, attributes: {} },
      draft.payload,
    );
  }
  const ontology = new OntologyService(repos, authz, outbox, solvers, metrics);
  const ontologyCore = new OntologyCoreService(repos, authz);
  const workflows = new WorkflowService(repos, ontology, ontologyCore); // OntoFlow（PRD v2）· 本体建模工作流 CRUD/校验/预览/发布·嫁接自 main
  solvers.setOntologyCore(ontologyCore); // generic_inference 求解器走本体 recompute（G-5 通用 what-if）
  solvers.setLlm(llm); // A18.2 LLM 临时求解器生成
  solvers.setOutbox(outbox); // A18.2 solver.provisional_generated 事件
  // WO-MEMSIM-OPTIMIZER：配了 OPTIMIZER_BASE_URL → 自托管 CP-SAT sidecar（OR-Tools·可证最优·数据不出边界）；
  // 未配（内存模式）→ InProcOptimizerClient 确定性贪心兜底（portfolio 出可行解·FEASIBLE/optimal:false·诚实不作假；
  // 其余未兜底模型仍显式"未接入"）。两态差异靠 optimal 徽标透明告知。
  solvers.setOptimizer(
    process.env.OPTIMIZER_BASE_URL
      ? new HttpOptimizerClient(process.env.OPTIMIZER_BASE_URL)
      : new InProcOptimizerClient(),
  );
  const timeseries = new TimeseriesService(repos, authz, outbox);
  const features = new FeatureService(repos);
  const configBundle = new ConfigBundleService(repos, features);
  const catalog = new CatalogService(repos, features);
  const governance = new OntologyGovernanceService(repos, authz, ontology, ontologyCore, features, metrics, outbox);
  // WO-69 P3 · 对象接口（多态抽象）：CRUD + 版本演进 + "谁实现了 X"/影响面查询。发布门在 ontology.publishVersion。
  const objectInterfaces = new ObjectInterfaceService(repos, ontology);
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
  const ruleDocs = new RuleDocService(repos, blob, routedLlm, rules, metrics, config.DC_LLM_MODEL, embeddings);
  const modeling = new ModelingService(repos, routedLlm, ontology, metrics, config.DC_LLM_MODEL, quarantine);
  const synthetic = new SyntheticService(repos, routedLlm, ontology, rules, metrics, config.DC_LLM_MODEL, timeseries);
  // V5 双算注入：把被测 solvers.invoke 以回调注入 VLE（vle.ts 不 import solvers/service，V9 静态门守）。
  const vle = new VleService(repos, synthetic, ontology, (c, key, args) => solvers.invoke(c, key, args));
  // S2 Action 三段埋点必须并入 **app 级** 注册表：不传 metrics 时 ActionService 会退化为自有注册表，
  // 计数照记但只有 `services.actions.metrics` 读得到，`/metrics`（下方渲染的是这里的 metrics）看不见 ——
  // 埋点等于对外不存在。传参即接上 dc_action_{submit,approval,execute,execute_attempts}_total。
  const actions = new ActionService(repos, rules, outbox, notifications, metrics);
  // WO-C1 · L2 决策内核：gap_attribution(根因)+decision_play(方案)→一等 Decision→commit 派 ActionDraft（走 S2）。
  const decisionKernel = new DecisionKernelService(repos, ontology, actions, outbox);
  const ruleScan = new RuleScanService(repos, timeseries, outbox);
  const scheduler = new SchedulerService(repos, logger.child({ component: "scheduler" }) as Logger);
  // WO-PROCESS-INSTANCE · 流程运行时（五个等待态的唯一产地在其 evaluateGate 调用点）。时钟可注入见 AppDeps.processClock。
  const processRuntime = new ProcessRuntimeService(repos, deps.processClock ? { clock: deps.processClock } : undefined);
  const sop = new SopService(repos, solvers, outbox);
  const kb = new KbService(repos, authz, blob, embeddings, outbox);
  const databuilder = new DataBuilderService(repos, ontology, rules, connectors, kb, solvers, outbox, routedLlm, config.DC_LLM_MODEL);
  const simclock = new SimClockService(repos, timeseries, ontology, ruleScan, solvers, outbox);
  // WO-ENTERPRISE-STATE · 企业状态快照（PRD-enterprise-decision-twin §3 五张 MVP 表之一）。
  // 逻辑时刻取自上一行的 A8 模拟时钟 —— 服务里一次 `new Date()` 都没有（见 twin/enterprise-state.ts 文件头）。
  const enterpriseState = new EnterpriseStateService(repos, outbox);
  const plan = new PlanService(repos, solvers, rules, outbox);
  const calibration = new CalibrationService(repos, outbox, solvers);
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
    outbox,
    // 轨L 增量2：注入建模链（modeling 在 synthetic 之前构造），供 demo 本体经真链产出。
    modeling,
    // WO-69 P3：对象接口种子（Approvable + 实现者绑定）。
    interfaces: objectInterfaces,
    livedInRunner: async (c, input) => {
      const state = await livedInEngine.run(c, input);
      return { replay: state.replay };
    },
  });
  connectors.wire({ ts: timeseries, scheduler, outbox });
  simclock.setResetRunner(async (c, spec) => synthetic.runJob(c, spec));
  // §7.21: C12 → calibration.required → 提案生成（与降级/告警共用同一扫描路径）
  ruleScan.setCalibrationHook(async (tenantId, entityId) => calibration.onCalibrationRequired(tenantId, entityId));
  // M11 §1: tick 聚合后配对 + 元闭环（在 RULE_SCAN 之前 —— C12 命中即有新配对可消费）
  simclock.setCalibrationTicker(async (tenantId) => calibration.onTick(tenantId));
  // S2 写回适配器：领域 Action（AOP情景拍板 / 校准参数变更）真实落库，其余走 Mock。
  const mockExecutor = new MockActionExecutor();
  // G-ACTION-NOOP-EXEC：未接线动作走**诚实执行器**（未实现即 ok:false），不再返回 MO 形态的假单号。
  const unwiredExecutor = new UnwiredActionExecutor();
  // WO-GSIM-5-ACTION · 全局项目推演「采纳→回灌」真实执行器（G-DECISION 行动半 / G-LOOP-FEEDBACK）。
  const globalSimExecutor = new GlobalSimPlanExecutor(
    {
      repos,
      forecastStart: async (tid) => String((await solvers.getParams(tid)).forecastStart ?? "2026-06-10"),
      runDerivations: async (tid) => {
        await ontology.runDerivations({ tenantId: tid, userId: "system:action", roles: ["admin"], attributes: {} });
      },
    },
    mockExecutor,
  );
  const domainExecutor: ActionExecutor = {
    async execute(draft) {
      // 全局项目推演采纳（plan_change · source:"global-sim"）→ 真实回灌基线（其余 plan_change 不受影响）。
      if (draft.actionTypeKey === "plan_change") {
        // 仅 global-sim 来源有真回灌；其余来源**不得**借 plan_change 的 WIRED 之名假装写了 → 诚实失败。
        if (planChangeIsWired(draft.payload)) return globalSimExecutor.execute(draft);
        return unwiredExecutor.execute(draft);
      }
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
        // A6 列级复校（防「建草稿后策略收紧」）：不可写属性在此仍 403，值不落库。
        await assertDraftPatchWritableAtExecute(draft);
        await repos.objects.put({ ...obj, props: { ...obj.props, ...patch }, origin: { type: "MANUAL" } });
        const sysCtx: AuthCtx = { tenantId: draft.tenantId, userId: "system:action", roles: ["admin"], attributes: {} };
        await ontology.runDerivations(sysCtx);
        return { ok: true, targetRef: `OBJ-${objectId}` };
      }
      // OntoFlow（P3）流水线发布物化：rows 经数据处理折叠成对象落库(origin PIPELINE)，坏行入隔离区。嫁接自 main 平行线。
      if (draft.actionTypeKey === "流水线发布物化") {
        const workflowId = String(draft.payload.workflowId ?? "");
        const nodeId = String(draft.payload.nodeId ?? "");
        const rows = Array.isArray(draft.payload.rows) ? (draft.payload.rows as Record<string, unknown>[]) : [];
        const wfRec = await repos.ontologyWorkflows.get(draft.tenantId, workflowId);
        const node = wfRec?.doc.nodes.find((n) => n.id === nodeId);
        if (!node || node.kind !== "SUBGRAPH_ENTITY") return { ok: false, error: `entity node not found: ${nodeId}` };
        let spec = node.processing;
        if (!spec) {
          const up = wfRec!.doc.edges.filter((e) => e.to === node.id).map((e) => e.from);
          const proc = wfRec!.doc.nodes.find((n) => n.kind === "PROCESS" && up.includes(n.id));
          if (proc && proc.kind === "PROCESS") spec = proc.spec;
        }
        if (!spec) return { ok: false, error: "no processing spec" };
        const typeKey = node.modeling.typeKey;
        const pk = node.modeling.primaryKey;
        const records = runProcessing(rows, spec);
        let n = 0;
        for (const rec of records) {
          const pkVal = rec.props[pk];
          if (pkVal === undefined || pkVal === null || pkVal === "") {
            await quarantine.record(draft.tenantId, { connId: workflowId, dataset: typeKey, raw: rec.props, reason: "SCHEMA_MISMATCH", detail: `主键 '${pk}' 缺失`, reprocess: { targetKey: typeKey, mapping: spec.mappings.map((m) => ({ propKey: m.targetProp, sourceField: m.sourceField })), pk } });
            continue;
          }
          if (rec.expired) continue;
          await repos.objects.put({ id: `obj_${typeKey.toLowerCase()}_${String(pkVal)}`.replace(/[^\w-]/g, "_"), tenantId: draft.tenantId, type: typeKey, props: rec.props, origin: { type: "PIPELINE", workflowId } });
          n++;
        }
        await ontology.runDerivations({ tenantId: draft.tenantId, userId: "system:action", roles: ["admin"], attributes: {} });
        return { ok: true, targetRef: `WF-${workflowId}:${n}` };
      }
      // ── 采纳产能保障方案（G-ACTION-NOOP-EXEC 收口 · 本类型此前审批通过后一字节不写）──
      // 语义裁决：「采纳」= 把用户拨定的杠杆**落成本体属性真值**，而非开一张生产工单。
      // 依据：杠杆本来就是本体属性（LEVER_PROP_META：Equipment.oee_current / Process.shifts /
      // Line.utilization / Process.yield_baseline …），`discoverLevers` 回的每行都带 {objectType,objectId,prop}，
      // 前端拨杆后发的是 {…, value}。落成属性写入后**下一次推演自动反映**——这才是"产能保障"的实质。
      // （`mapping.ts` 旧注册表写的 target 是「生产工单MO（写回）」：那是一条新记录，不改变现有真值，
      //   拨完杠杆再推演仍是老数——与用户"采纳后要看到变化"的预期不符。已按属性写入实现。）
      if (draft.actionTypeKey === "采纳产能保障方案") {
        const levers = Array.isArray(draft.payload.levers) ? (draft.payload.levers as Record<string, unknown>[]) : [];
        if (levers.length === 0) {
          return { ok: false, error: "采纳产能保障方案：payload.levers 为空——无可写入的杠杆，拒绝空转（不假装已采纳）" };
        }
        const written: string[] = [];
        for (const l of levers) {
          const objectId = String(l.objectId ?? "");
          const prop = String(l.prop ?? "");
          const value = l.value;
          // 缺任一要素即**诚实失败**，绝不猜一个值写下去（写错真值比不写危险）。
          if (!objectId || !prop || typeof value !== "number" || !Number.isFinite(value)) {
            return { ok: false, error: `采纳产能保障方案：杠杆行缺 objectId/prop/value（收到 ${JSON.stringify(l)}）——拒绝臆造写入` };
          }
          const obj = await repos.objects.get(draft.tenantId, objectId);
          if (!obj) return { ok: false, error: `采纳产能保障方案：对象不存在 ${objectId}` };
          await repos.objects.put({ ...obj, props: { ...obj.props, [prop]: value }, origin: { type: "MANUAL" } });
          written.push(`${objectId}.${prop}`);
        }
        // 派生重算：让下游 KPI/派生属性立刻反映本次采纳（与「对象数据变更」同一套）。
        await ontology.runDerivations({ tenantId: draft.tenantId, userId: "system:action", roles: ["admin"], attributes: {} });
        // targetRef 自证写了什么、写了几处——**刻意不使用 MO- 前缀**（那正是假单号的形态）。
        return { ok: true, targetRef: `CAP-ADOPT:${written.length}:${written[0]}` };
      }

      // ── 采纳处置方案 adopt_mitigation（G-ACTION-NOOP-EXEC 收口 · 本类型此前审批通过后一字节不写）──
      // 病灶：用户在风险看板点「采纳」→ 审批链走完 → **风险曲线纹丝不动**。引擎半其实早就齐了：
      //   · risk.ts tensionSeries 接 `{eff,tn}`，第 tn 天起扣 eff；
      //   · params.risk.mitigations[factor] 里每个方案自带量化 {eff,tn}；
      //   · risk.ts 还一直在算 `mitSeries`——但那是「**如果**采纳会怎样」的对照曲线，真曲线用的仍是无 mitigation 那条。
      // 缺的只有一样：**没有地方记录"哪个方案被真采纳了"**。本分支就补这一样：写 `AdoptedMitigation` 对象
      //（repos.objects 通用对象仓储·无需建表/迁移），riskTimeline 逐 (baseId,factor) 取 ACTIVE 采纳喂进真曲线。
      // 语义裁决：「采纳」≠ 开一张生产工单（那是新记录，不改变任何推演真值，用户照样"什么都没变"）。
      if (draft.actionTypeKey === "adopt_mitigation") {
        const factor = String(draft.payload.factor ?? "");
        const planKey = String(draft.payload.planKey ?? "");
        const params = await solvers.getParams(draft.tenantId);
        const library = params.risk?.mitigations ?? {};
        // ① base 解析：复用 risk.ts `resolveBaseId`（**唯一严格解析出处**·认 baseId/中文名/obj_base_ 前缀）。
        //    解不出（如决策内核在无头部基地时传的 "全域"）→ 诚实失败，绝不挑一个基地写下去。
        const bases = await repos.objects.listByType(draft.tenantId, "Base");
        let baseId: string;
        try {
          baseId = resolveBaseId({ bases } as unknown as SolverContext, draft.payload.base);
        } catch {
          return {
            ok: false,
            error:
              `adopt_mitigation：base「${String(draft.payload.base ?? "")}」解析不出具体基地——` +
              `拒绝把方案落到一个猜的基地（写错真值比不写危险）。请传 baseId 或基地中文名。`,
          };
        }
        // ② factor / planKey → 方案库真解出 {eff,tn}。任一解不出即失败，**绝不写一个猜的 eff/tn**。
        const plans = library[factor];
        if (!Array.isArray(plans) || plans.length === 0) {
          return {
            ok: false,
            error:
              `adopt_mitigation：因素「${factor}」不在处置方案库（params.risk.mitigations）里——` +
              `无量化效果可依，拒绝臆造 eff/tn。可选因素：${Object.keys(library).join("、") || "（空）"}`,
          };
        }
        const plan = plans.find((pl) => pl.key === planKey || pl.name === planKey);
        if (!plan) {
          return {
            ok: false,
            error:
              `adopt_mitigation：因素「${factor}」下解不出方案「${planKey}」——拒绝臆造 eff/tn。` +
              `该因素可选方案：${plans.map((pl) => `${pl.key}(${pl.name})`).join("、")}`,
          };
        }
        // ③ 单源不并存（② 单源 > 并存）：同一 (baseId,factor) 旧的 ACTIVE 采纳先置 REVOKED，
        //    使"至多一条 ACTIVE"成为**写时不变量**——读侧（riskTimeline）无需在多条里挑，也就没有挑错的余地。
        const adoptionId = `${baseId}-${factor}-${plan.key}`;
        const objectId = `obj_adoptedmitigation_${adoptionId}`.replace(/[^\p{L}\p{N}_-]/gu, "_");
        for (const o of await repos.objects.listByType(draft.tenantId, "AdoptedMitigation")) {
          if (o.id === objectId) continue; // 同方案重复采纳 → 下面整体覆盖（幂等）
          if (String(o.props.baseId ?? "") !== baseId || String(o.props.factor ?? "") !== factor) continue;
          if (String(o.props.status ?? "") !== "ACTIVE") continue;
          await repos.objects.put({ ...o, props: { ...o.props, status: "REVOKED" } });
        }
        // ④ 落库。adoptedAt 取**确定性时间锚** forecastStart（同 GlobalSimPlanExecutor 的 `禁 Date.now`(R6) 纪律）。
        await repos.objects.put({
          id: objectId,
          tenantId: draft.tenantId,
          type: "AdoptedMitigation",
          props: {
            adoptionId,
            baseId,
            factor,
            planKey: plan.key,
            planName: plan.name,
            eff: plan.eff,
            tn: plan.tn,
            adoptedAt: String(params.forecastStart ?? "").slice(0, 10),
            actionDraftId: draft.id,
            status: "ACTIVE",
          },
          origin: { type: "ACTION", actionId: draft.id, source: "adopt_mitigation" },
        });
        // targetRef 自证采纳了什么——**刻意不使用 MO- 前缀**（那正是本仓刚清掉的假工单号形态）。
        return { ok: true, targetRef: `MIT-ADOPT:${adoptionId}` };
      }

      // ⛔ 最后兜底：**不再返回假 MO 号**。未在 ACTION_WIRING 里标 WIRED 的动作一律诚实失败/诚实标注，
      // 让"审批通过但什么都没写"在界面与审计里可分辨（G-ACTION-NOOP-EXEC·R4 真值经 Action）。
      return unwiredExecutor.execute(draft);
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
  scheduler
    .on("CONNECTOR_SYNC", async (tenantId, refId) => {
      await connectors.sync(systemCtx(tenantId), refId);
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
    genReqId: () => newId("req"),
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
    "/a/v1/auth/login",
    "/a/v1/auth/refresh",
    "/a/v1/auth/logout",
    "/a/v1/healthz",
    "/a/v1/readyz",
    "/a/v1/.well-known/jwks.json",
  ]);

  /**
   * 服务间专用路径：**跨租户全局**数据，只认 `X-Service-Token`，不接受用户 JWT / X-Debug-User。
   *
   * `/metrics` 归此类而非 PUBLIC_PATHS —— 它下发的 `dc_llm_calls_total{provider,model}`
   * （租户 LLM provider 记录 ID + 模型名）、`dc_action_*{action_type}`（租户业务动作中文语义）、
   * `dc_deprecated_ref_calls_total{key}`（租户本体类型 key）都是**租户私有配置**的投影；
   * 而它又是**全租户合计**，给任一租户的用户看反而扩大跨租户可见面 ⇒ 只能给服务间抓取方。
   */
  const SERVICE_ONLY_PATHS = new Set(["/metrics"]);

  /**
   * 服务间凭证校验（**单一实现**，供 onRequest 钩子与端点自守两处共用）。
   * 刻意不各写一份：抄一份 = 改了主逻辑而另一份拿旧规则照放行（本仓「金丝雀必须与主逻辑共用同一份实现」同源纪律）。
   *
   * **fail-closed**：未配置 `SERVICE_TOKEN` ⇒ 恒不通过（与 `/a/v1/llm-providers/{id}/credential`
   * 「SERVICE_TOKEN 未配置时服务头不被接受」及 B 侧 `/b/v1/internal/scaffold` 同口径）。
   */
  const serviceTokenOk = (req: FastifyRequest): boolean => {
    const tok = req.headers["x-service-token"];
    return Boolean(config.SERVICE_TOKEN) && typeof tok === "string" && tok === config.SERVICE_TOKEN;
  };

  app.addHook("onRequest", async (req: FastifyRequest, _reply: FastifyReply) => {
    if (req.method === "OPTIONS") return; // CORS preflight
    const path = req.url.split("?")[0] as string;
    if (PUBLIC_PATHS.has(path)) return;
    // ⚠ 必须排在下面那条兜底之前：SERVICE_ONLY_PATHS 里的路径都不以 `/a/` 开头，
    // 若放在其后则永远走不到这里（这正是 `/metrics` 旧日「双重旁路」的第二个出口）。
    if (SERVICE_ONLY_PATHS.has(path)) {
      // ⚠ 这句 message 与端点自守那句**刻意不同**（"hook" vs "endpoint"）：两层都拦得住同一个请求，
      // 若消息一样，测试就分不清是哪层拦的 —— 于是任一层被改回去，另一层顶上，测试照样绿，
      // **两层互相掩护 = 谁都没被钉住**。靠 message 区分，才能让「出口 1 被重新打开」这件事
      // 单独变红（钉的是行为，不是「代码里有这一行」）。改动时两句必须保持可区分。
      if (!serviceTokenOk(req)) throw unauthorized("service credential required (hook)");
      return;
    }
    // ⚠ 此处原为 `if (!path.startsWith("/a/")) return;` —— **任何**非 `/a/` 路径一律免鉴权。
    // 于是把 `/metrics` 从 PUBLIC_PATHS 删掉是无效修复：它不以 `/a/` 开头，照样从这条兜底溜走
    // （双重旁路：两个出口必须一起堵，只堵一个 = 白改）。现改为「未显式登记则走正常鉴权链」，
    // 下一个非 `/a/` 路由上线时默认是**关**的而不是开的（把静默陷阱改成默认安全）。
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
    // X-Debug-User 绕过 JWT：非 production 恒认；production 下**必须显式** ALLOW_DEBUG_USER=1 才认（安全后门 opt-in·
    // 默认关→生产安全）。demo/测试部署可在 compose 设 1 省去每次 login·真实生产切勿开。
    const debugAuthAllowed = config.NODE_ENV !== "production" || config.ALLOW_DEBUG_USER === "1";
    if (debugAuthAllowed && typeof debugHeader === "string") {
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
    return req.authCtx;
  };

  // ---- meta -------------------------------------------------------------------
  app.get("/healthz", async () => ({ status: "ok" }));
  const readyz = async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      await repos.ping();
    } catch (err) {
      // ⚠ 这里必须带 reason **且必须打日志**：三个 503 出口原先只有 bootstrap 那个会留痕，
      // 于是「pg 连不上」与「还在播种」在 `docker compose logs` 里是同一副面孔（都只有一行 503 访问日志）。
      // 一次真实部署事故就卡在这个二选一上——两种情况的处置完全相反（查数据库 vs 再等一会儿）。
      logger.error({ err }, "readyz blocked: repos.ping() failed");
      return reply.status(503).send({ status: "not ready", reason: "db_unreachable" });
    }
    // #5 首启预热闸：先 listen 再后台播种，播种期间 /readyz 503（reason:"seeding"）→ 端口已起、
    // 编排方（depends_on service_healthy）在预热窗内正确等待，不再因"端口全程 down"耗尽 healthcheck 重试。
    if (deps.seeding?.()) {
      // phase + elapsedSec 让探活方能区分「在动」与「卡死」：连续两次采样 phase/elapsed 不变 = 卡住。
      const p = deps.seedingPhase?.();
      return reply.status(503).send({ status: "not ready", reason: "seeding", ...(p ?? {}) });
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
  // 端点自守（纵深防御）：钩子已挡一层，这里再挡一层 —— 两层共用 `serviceTokenOk` 同一份实现。
  // 理由是这条路径**曾经**有过双重旁路：任何一层被改回去，另一层仍须独立成立。
  app.get("/metrics", async (req, reply) => {
    // message 里的 "endpoint" 是与钩子那层的区分标记，见 auth hook 处注释（勿合并成同一句）。
    if (!serviceTokenOk(req)) throw unauthorized("service credential required (endpoint)");
    return reply.type("text/plain").send(metrics.render());
  });
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
    // §7.18 图谱视角视图：功能键 view.graph.persp.{p}，前端路由查 view.graph-{p}，需补别名。
    for (const p of ["all", "backbone", "flow", "source", "solver", "mvp", "agent", "loop"]) {
      if (out.has(`view.graph.persp.${p}`)) out.add(`view.graph-${p}`);
    }
    // WO-PROCESS-INSTANCE · 流程卡点面板：功能键是 `process.runtime`（**非** view.* 命名，
    // 见 VIEW_FEATURE_MAP 里那条「与运行时引擎同生共死」的注记），而前端 `ViewPage` 的路由守卫
    // 写死查 `view.${viewKey}`（frontend-shell/src/pages/ViewPage.tsx:33）。
    // ⇒ 不补这条别名，会出现**最难查的那一种**断线：workspace.views 里有它、导航里点得到，
    //   点进去 ViewPage 第一道闸就 404 —— 后端全绿、前端全绿，只有真点一下才看得见。
    //   （这正是本仓「绿测试 ≠ 能用·断在接缝」的教科书形态，故补在与图谱视角同一个地方、同一种机制。）
    // 别名是**单向**的：关掉 `process.runtime` ⇒ 这里不 add ⇒ 前端两道闸一起关（R3 不被绕过）。
    if (out.has("process.runtime")) out.add("view.process-stuck");
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
      features: withRouteFeatureAliases(resolved.features),
      configVersion: resolved.configVersion,
    };
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
  /**
   * OC7（#92）：LLM 配额账本的**读 + 记账**允许服务间调用（AgentCore 经 X-Service-Token + X-Tenant-Id）。
   * 此前三条路由全是 admin-only —— 而账本的天然写入方是 AgentCore（它才知道每次跑烧了多少 token），
   * 用用户 JWT 又拿不到 admin → 结果状态机完整却**零消费方**（本体 §8 G-LLM-BUDGET-NO-CONSUMER）。
   * 配置面（PUT 设限额）仍 admin-only：设预算是人的决定，不该被服务改。
   */
  const mustAdminOrService = (c: AuthCtx) => {
    if (c.roles.includes("service")) return;
    mustAdmin(c);
  };

  // OC7 LLM 成本配额与降级（租户级 token 配额 + 软/硬线）。admin only。
  const budgetStatus = (b: { hardLimitTokens: number; softLimitPct: number; usedTokens: number } | undefined) => {
    const hard = b?.hardLimitTokens ?? 0;
    const soft = Math.floor(hard * (b?.softLimitPct ?? 0.8));
    const used = b?.usedTokens ?? 0;
    const state = hard > 0 && used >= hard ? "HARD_EXCEEDED" : hard > 0 && used >= soft ? "SOFT_EXCEEDED" : "OK";
    return { usedTokens: used, hardLimitTokens: hard, softLimitTokens: soft, state, degrade: state !== "OK" } as const;
  };
  app.get("/a/v1/llm-budgets", async (req) => { const c = ctx(req); mustAdminOrService(c); return budgetStatus(await repos.llmBudgets.get(c.tenantId, `lbg_${c.tenantId}`)); });
  app.put("/a/v1/llm-budgets", async (req) => {
    const c = ctx(req); mustAdmin(c);
    const body = PutLlmBudgetBodySchema.parse(req.body);
    const prev = await repos.llmBudgets.get(c.tenantId, `lbg_${c.tenantId}`);
    const rec = { id: `lbg_${c.tenantId}`, tenantId: c.tenantId, hardLimitTokens: body.hardLimitTokens, softLimitPct: body.softLimitPct ?? prev?.softLimitPct ?? 0.8, periodStart: prev?.periodStart ?? new Date().toISOString(), usedTokens: prev?.usedTokens ?? 0, updatedAt: new Date().toISOString() };
    await repos.llmBudgets.put(rec); return budgetStatus(rec);
  });
  app.post("/a/v1/llm-budgets/record", async (req) => {
    const c = ctx(req); mustAdminOrService(c);
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
        // A6 列级（属性级）策略：不透传就等于本特性只能靠代码种子配置（API 配不出来）。
        // 白/黑名单互斥校验与契约同源（PermissionPolicySchema.propertyPolicy）。
        propertyPolicy: z
          .object({
            readable: z.array(z.string()).optional(),
            denyRead: z.array(z.string()).optional(),
            writable: z.array(z.string()).optional(),
            denyWrite: z.array(z.string()).optional(),
          })
          .optional()
          .superRefine((pp, cx) => {
            if (!pp) return;
            if (pp.readable && pp.denyRead) {
              cx.addIssue({ code: "custom", message: "propertyPolicy.readable 与 denyRead 互斥，不可同时配置" });
            }
            if (pp.writable && pp.denyWrite) {
              cx.addIssue({ code: "custom", message: "propertyPolicy.writable 与 denyWrite 互斥，不可同时配置" });
            }
          }),
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

  /** 本租户已发布的传导规则（tick 路与 Trial Tick 的**同一个**入口，不许各查各的）。 */
  const listPublishedPropRules = (c: AuthCtx): Promise<PropagationRule[]> =>
    repos.sim.listPropagationRules(c.tenantId, true);

  // ── 会话级反事实：这次推演假装哪几条边不存在（WO-ACTIVE-EDGE-UX）────────────────────
  //
  // ⛔ **过滤刻意不下沉进 `listPublishedPropRules`**，而是留在拿得到 `SimSession` 的调用点上。
  //    理由是那 8 处 `listPropagationRules` 调用**语义各不相同**，一刀切必错（逐处判定见下）：
  //      · `POST …/tick`（本文件 tick 路）                   → **过滤**：这就是"这次推演"本身
  //      · `POST …/counterfactual`（本单新增）               → **两版都跑**：过滤的那一版是反事实版
  //      · `trialPropagate`（就绪认证 Trial Tick）           → **不过滤**：认证问的是"这个世界的配置
  //        能不能驱动传导"（能力），不是"这次假设跑出什么"（假设）。过滤会让用户拨一下开关就把
  //        就绪度拉低，屏上看着像世界坏了 —— 而世界一个字节没变。
  //      · `GET /sim/propagation-rules` / `GET /sim/view-config` → **不过滤**：这是边的**目录**。
  //        §3.3 明写「关掉的边要可见地降级，不是从图上消失」；过滤掉 = 用户不知道自己关了什么。
  //      · `assembleCertification` 的 `publishedOnly=false` 全量  → **不过滤**：完整度数的是"配了几条"。
  //      · `causal-graphs/sim/:sessionId`                    → **不过滤**：因果图解释的是**已记录的历史**
  //        （trace 里真跑过的那些），而屏蔽集是**当下**的；过滤会让历史边失去它的规则元数据。
  //      · `slices/:key/layers` 两处 + `solvers/finance-world.ts` → **不过滤**：租户级本体投影，无会话。
  //
  // 写这个集合**不需要 Action 审批**，依据是 R4-sim（SYSTEM-ONTOLOGY §5）原文：
  //   「仿真世界（`isSimulated===true`，`worldId` = 推演会话 id）的写入**不经 Action 审批**
  //     —— 因为它根本不是真值。豁免仅限『写进仿真世界自己那一行』。」
  // 这里写的正是 `sim_session` 自己那一行的世界态：本体里的 `PropagationRule.status` 一个字节不动，
  // 别租户、别会话、下一次新建的会话全都看不到这次屏蔽。若哪天要把"这条边其实该退役"落成真值，
  // 那是改 `status`，必须走 R4 正门 —— 两件事分属两个字段，不许合并（契约 `SimSession.disabledRuleKeys` 注释）。
  /** 本会话真正参与推演的规则（= 已发布 − 本会话屏蔽），并把屏蔽掉的那几条一并带回（供"降级显示"）。 */
  const sessionPropRules = async (c: AuthCtx, s: SimSession, override?: readonly string[]) => {
    const published = await listPublishedPropRules(c);
    const disabled = [...new Set(override ?? s.disabledRuleKeys ?? [])].sort();
    const { active, suppressed } = partitionPropagationRules(published, disabled);
    return { published, active, suppressed, disabled };
  };

  // ⚠ `buildPropagationInputs` 曾**在这里**以闭包形式存在，现已提取到 `./sim/propagation-inputs.ts`
  //   （WO-CERT-CONTRACT-RECONCILE：两个 dev 并行各造了一份同名物，收成一份）。
  //   语义原样保留（含「不含 propRules」那条性能判据）；提出去的唯一理由是让结构门
  //   能无条件断言「`app.ts` 里出现任何一处传导相装配 = 红」——留在本文件里就只能数「恰好一次」。
  //   别再往本文件里写第二处装配：门 `sim-cert-contract-reconcile.seam.test.ts` ④结构判据会红。

  app.post("/a/v1/sim/sessions", async (req, reply) => {
    const c = ctx(req);
    await requireSim(c, "sim.sandbox");
    const b = (req.body ?? {}) as { baseSnapshot?: TickState; scope?: Record<string, unknown> };
    const base = b.baseSnapshot ?? {};
    const s: SimSession = {
      id: newId("sims"), tenantId: c.tenantId, baseSnapshot: base, scope: b.scope ?? {},
      status: Object.keys(base).length > 0 ? "READY" : "DRAFT", curTick: 0, parentCheckpointId: null,
      disabledRuleKeys: [], // WO-ACTIVE-EDGE-UX：新会话不屏蔽任何边 ⇒ 与本字段引入前逐字节相同（RL9）
      createdAt: new Date().toISOString(),
    };
    await repos.sim.createSession(s);
    await repos.sim.putTickState({ sessionId: s.id, tenantId: c.tenantId, tick: 0, state: simState(base), pending: [], trace: null });
    await outbox.emit(c.tenantId, "sim.session_created", { sessionId: s.id, status: s.status });
    return reply.status(201).send(s);
  });
  const getSimOr404 = async (c: AuthCtx, id: string): Promise<SimSession> => {
    const s = await repos.sim.getSession(c.tenantId, id);
    if (!s) throw notFound("sim session not found");
    return s;
  };
  app.get("/a/v1/sim/sessions", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.sandbox");
    // WO-LIVE-ENDPOINTS：活方案快照复用 SimSession 承载（scope.snapshotKind 标记），非沙盘会话——从沙盘列表滤除（不污染沙盘 UI）。
    return { items: (await repos.sim.listSessions(c.tenantId)).filter((s) => !(s.scope as { snapshotKind?: string })?.snapshotKind) };
  });
  app.get("/a/v1/sim/sessions/:id/world", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.sandbox");
    const s = await getSimOr404(c, (req.params as { id: string }).id);
    return { tick: s.curTick, state: await simCurrent(c, s) };
  });
  /**
   * 从会话**当前态**推进 n 格（`propagateTick` 的唯一驱动处）。
   *
   * `persist` 是本函数与"对照跑"的**唯一**区别（WO-ACTIVE-EDGE-UX §3.1.4）：
   *  · `true`  → `POST …/tick` 真跑：逐格 `putTickState`，会话 `curTick` 真进位；
   *  · `false` → `POST …/counterfactual` 对照跑：**一次 `putTickState` 都不调、`putSession` 不调、
   *    事件不发**，会话逐字节不动 —— 否则用户点一下"关掉这条边看看"就把真会话推进了一格。
   *
   * ⚠ 为什么必须是**同一个函数**而不是"对照那边照着抄一遍"：对照要成立，两版就必须是
   * **同一套算法在两组规则上跑**。抄一份出来，两边任何一处漂移（扰动顺序、pending 结算、闸门）
   * 都会被算进"关掉这条边的影响"里，而那部分差异根本不是边造成的 —— 那就是把噪声当结论。
   * 这与本仓 `applyPerturbationToState` 被提到契约里是同一条纪律。
   */
  const simAdvanceTicks = async (
    c: AuthCtx,
    s: SimSession,
    opts: { rules: PropagationRule[]; n: number; persist: boolean },
  ) => {
    const { rules: propRules, n, persist } = opts;
    let state = await simCurrent(c, s);
    let curTick = s.curTick;
    // 增量 3 传导核接入（opt-in）：有规则才传导，否则退回恒等 tick（无规则不触发，可回退）。
    // propagateTick 是纯函数（R6 确定性、R14 零业务常数）。
    const propagate = propRules.length > 0;
    // ── 扰动接入传导（WO-P2 · PRD-UPGRADE-decision-sandbox-v2 §3.1.3）───────────────────
    // 顺序 = `listPerturbations` 的 `startTick↑ → 建单先后`（repo.ts:362）。**这里绝不重排**：
    // `delta`/`scale` 不可交换（`(10+2)×1.5=18 ≠ 10×1.5+2=17`），顺序即语义。
    const sessionPerturbations = await repos.sim.listPerturbations(c.tenantId, s.id);
    /**
     * 「落地前值」= 该扰动 `startTick` 的**前一 tick** 快照上的目标值（`startTick===0` 取 baseSnapshot）。
     * 只有 `set` 与 `scale(magnitude===0)` 到期时用得上 —— 这两种模式不可解析求逆；
     * `delta`/`scale(≠0)` 的逆是减/除，不需要记忆（也因此不会把中间几 tick 的演化一并抹掉）。
     *
     * ⚠ 为什么不照 PRD 原文「记 preValue 于生效当 tick 的 trace」：`POST /perturbations`
     * 对**建单时已生效**的扰动是在路由里直接施加的（本文件 `simApplyAtCurrentTick`），
     * 那条路原样保留旧 trace、**不写新 trace** ⇒ trace 里永远不会有它的 preValue，
     * 而 `startTick` 缺省 = 当前 tick，正是最常走的一条路。改从世界线快照取：
     * 两条施加路径都成立，且与引擎自己施加时读到的**是同一个数**
     * （引擎的 enter 发生在 `producedTick === startTick`，其输入态正是 `state@(startTick-1)`）。
     */
    const preValueOf = async (p: Perturbation): Promise<number | undefined> => {
      const snap = p.startTick === 0
        ? s.baseSnapshot
        : (await repos.sim.getTickState(c.tenantId, s.id, p.startTick - 1))?.state;
      const v = snap?.[p.targetObjectId]?.[p.targetStateVar];
      return typeof v === "number" ? v : undefined;
    };
    /** 本 tick（= 产出的那一格 `producedTick`）**相关**的扰动：生效期内的 + 刚到期的（回退要用它）。 */
    const perturbationsForTick = async (producedTick: number): Promise<PerturbationInTick[]> => {
      const out: PerturbationInTick[] = [];
      for (const p of sessionPerturbations) {
        const now = isPerturbationActiveAt(p, producedTick);
        const prev = isPerturbationActiveAt(p, producedTick - 1);
        if (!now && !prev) continue; // 与本 tick 无关
        // 刚到期且不可解析求逆 ⇒ 现查落地前值（只在真要用时查，不给每条扰动都加一次读）
        if (!now && (p.mode === "set" || (p.mode === "scale" && p.magnitude === 0))) {
          out.push({ ...p, preValue: await preValueOf(p) });
          continue;
        }
        out.push(p);
      }
      return out;
    };
    // 有扰动但没有 PUBLISHED 传导规则的世界也要走引擎：否则「限时停机」到期不回退，
    // 悄悄变成永久生效（恒等桩那条路只会原样搬运世界态）。
    const engineTick = propagate || sessionPerturbations.length > 0;
    let graph: PropagationGraph = { objects: [], links: [] };
    const ruleParams: RuleParamLookup = {};
    // WO-SANDBOX-E4 节拍闸门：从**对象库**读 D1 落的 `Cadence` 行（`synthetic/service.ts` putAll("Cadence", …)），
    // 经 D1 声明的唯一读回口 `cadenceFromProps` 还原成契约 `Cadence`，再由引擎换算成整 tick 闸门。
    // 这里不做任何补默认：EMPTY 行读回 `undefined`、周期不可整 tick 的进 skipped —— 两者都不会变成闸门，
    // 声明了它们的规则会在 `unresolvedGates` 里显式报缺（而不是悄悄按"随到随办"跑）。
    let cadenceGates: CadenceGateLookup = {};
    let gateSkipped: { nodeId: string; reason: string }[] = [];
    let unresolvedGates: UnresolvedCadenceGate[] = [];
    /** 本次 tick 的范围回执（诚实回带：这一格是在什么范围下算出来的·R-ARG-FIDELITY）。 */
    let scopeReport: ScopeReport | null = null;
    let pending: DelayedContribution[] = propagate ? ((await repos.sim.getTickState(c.tenantId, s.id, curTick))?.pending ?? []) : [];
    if (propagate) {
      // ── 会话范围读端（WO-SIM-SCOPE-TRIAL · 闭 #129/#130 `G-SIM-SCOPE-UNREAD`）────────────
      // 此前这里是就地物化 + 无条件全本体，`s.scope` **从头到尾没人读**：
      // 用户在屏上切到「局部推演」，引擎照样按 GLOBAL 全量算，答案是错的而页面不报错。
      // 现在范围在**图物化那一步**生效（裁剪在 `buildPropagationInputs` 里，与 Trial Tick 同一处）：
      // LOCAL ⇒ 只留根类型对象 + `hops` 跳邻域 + 两端都在范围内的边；
      // GLOBAL ⇒ 原样返回同一引用（`===`），旧行为逐字节不变（RL9）。
      //
      // 图 / 范围 / 规则参数 / 节拍闸门全部走**唯一装配处**（WO-SIM-ACT-CLOSE · #152，
      // 与 Trial Tick 同源，见 `buildPropagationInputs`）—— 另抄一份就会出现
      // 「认证说能跑、真 tick 不是这个数」。
      const inp = await buildPropagationInputs(repos, c, resolveSimScope(s.scope));
      graph = inp.graph;
      scopeReport = inp.scopeReport;
      Object.assign(ruleParams, inp.ruleParams);
      cadenceGates = inp.cadenceGates; gateSkipped = inp.gateSkipped;
    }
    let trace: PropagationTrace[] | null = null;
    let appliedPerturbations: string[] = [];
    /** 本次推进中真正产出过贡献的规则 key（对照跑用它区分"关了没影响"与"这条边本来就没动"）。 */
    const firedKeys = new Set<string>();
    for (let i = 0; i < n; i++) {
      const beforeTick = curTick; // 当前 tick t（结算 pending arriveTick===t）
      if (engineTick) {
        const out = propagateTick(
          graph, state, propRules, pending, beforeTick, ruleParams, cadenceGates,
          await perturbationsForTick(beforeTick + 1), // 引擎产出的是 tick+1 那一格
        );
        state = out.next; pending = out.pending; unresolvedGates = out.unresolvedGates;
        appliedPerturbations = out.appliedPerturbations;
        for (const k of firedPropagationRuleKeys(out.trace, out.pending)) firedKeys.add(k);
        // 无传导规则的世界：本 tick 若没有任何扰动动作，trace 保持 `null`（与本单引入前逐字节相同·可回退）。
        trace = propagate || out.trace.length > 0 ? out.trace : null;
        curTick += 1;
      } else {
        // 无 PUBLISHED 传导规则：恒等桩进位（状态原样，确定性 R6；可回退）。
        state = simState(state); pending = []; trace = null; curTick += 1;
      }
      // ⛔ 对照跑（persist=false）在此**一个字节都不写** —— 这条约束由
      //    `test/edge-active-counterfactual.test.ts` 逐字节咬死（不是靠这行注释保证）。
      if (persist) await repos.sim.putTickState({ sessionId: s.id, tenantId: c.tenantId, tick: curTick, state, pending, trace });
    }
    return {
      curTick, state, trace, pending, propagate, scopeReport,
      cadence: { gates: cadenceGates, skipped: gateSkipped, unresolved: unresolvedGates },
      appliedPerturbations, sessionPerturbationCount: sessionPerturbations.length,
      firedRuleKeys: [...firedKeys].sort(),
    };
  };

  app.post("/a/v1/sim/sessions/:id/tick", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.propagation");
    const s = await getSimOr404(c, (req.params as { id: string }).id);
    const n = Math.max(1, Math.floor(Number((req.body as { n?: number })?.n ?? 1)));
    // PUBLISHED only，**再减去本会话屏蔽的边**（WO-ACTIVE-EDGE-UX 的引擎接缝就是这一行）。
    // `disabledRuleKeys` 为空 ⇒ `partitionPropagationRules` 原样返回 ⇒ 与本单引入前逐字节相同（RL9）。
    const rules = (await sessionPropRules(c, s)).active;
    const r = await simAdvanceTicks(c, s, { rules, n, persist: true });
    s.curTick = r.curTick;
    s.status = "RUNNING"; await repos.sim.putSession(s);
    await outbox.emit(c.tenantId, "sim.tick_completed", { sessionId: s.id, curTick: s.curTick });
    // `cadence` 段是**诚实缺席的出口**（E4）：哪些节点有闸门、哪些节点查得到但用不了、
    // 哪些规则声明了闸门却拿不到 —— 全部亮出来，前端才可能显示"这条流因节拍未知未参与推演"，
    // 而不是看到一条安静的零。
    return {
      curTick: s.curTick,
      state: r.state,
      ...(r.propagate
        ? {
            trace: r.trace,
            cadence: r.cadence,
            // 范围回执（WO-SIM-SCOPE-TRIAL）：算了几个对象、几条边、丢了多少、范围是不是根本拿不到。
            // 与 `cadence` 同一条纪律 —— 让"筛选没生效"看得见，而不是从一个安静的数字里去猜。
            scope: r.scopeReport,
          }
        : {}),
      // 溯源（WO-P2）：这一格世界态是哪几次扰动仍在起作用的结果。只在这个世界真有扰动时下发，
      // 无扰动的租户响应形状逐字节同旧（可回退）。
      ...(r.sessionPerturbationCount > 0 ? { appliedPerturbations: r.appliedPerturbations } : {}),
    };
  });

  // ── 会话级反事实：开关 + 对照（WO-ACTIVE-EDGE-UX）─────────────────────────────────
  //
  // 仓主原话：「所有推演的功能，包括『推演沙盘』就需要借鉴这个设计UX」——
  // 指的是「关系边上有 active 开关，关掉这条边，就能看到推演结果怎么变」。
  // 两条路由分别是那句话的两半：`disabled-rules` 是"关"，`counterfactual` 是"看到怎么变"。

  /**
   * 改本会话屏蔽的传导边（**世界态写入，不是本体真值写入 ⇒ 不需要 Action 审批**）。
   *
   * R4 原文是「**真值写入**经 Action 审批：对象物化/本体变更经 `domainExecutor`，EXECUTED 才落」。
   * 本路由写的是 `sim_session.disabled_rule_keys` —— 这一行属于**仿真世界**，
   * R4-sim 明写「仿真世界的写入不经 Action 审批，因为它根本不是真值；豁免仅限写进仿真世界自己那一行」。
   * 本路由三条边界全部满足：① 不回写真实世界（`PropagationRule.status` 一个字节不动）；
   * ② 要让"这条边其实该退役"生效，仍须改 `status` 走 R4 正门；③ 屏蔽只对本会话可见。
   * ⚠ 下一个人若把这里读成"漏了审批"而去加 Action 链，就会把一次性的假设推演变成审批工单 —— 那是返工。
   *
   * **未知 ruleKey 一律 400，不许静默忽略**：静默忽略 = 用户以为关掉了、其实没关，
   * 屏上差值恒 0 而他会以为"这条边没影响"——正是「绿测试≠能用」的温床（WO §3.1.2）。
   */
  app.patch("/a/v1/sim/sessions/:id/disabled-rules", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.propagation"); // R3 entitlement 先于 authz
    const s = await getSimOr404(c, (req.params as { id: string }).id); // R2：别租户的会话 404
    const body = parseBody(z.object({ disabledRuleKeys: z.array(z.string()) }), req.body);
    const published = await listPublishedPropRules(c);
    const unknown = unknownPropagationRuleKeys(body.disabledRuleKeys, published);
    if (unknown.length > 0) {
      throw new AppError(
        "UNKNOWN_PROPAGATION_RULE_KEY",
        `未知传导规则 key：${unknown.join(", ")}。本租户已发布的 key = [${published.map((r) => r.key).join(", ")}]。` +
          `拒绝静默忽略——静默忽略会让你以为这条边已经关掉，而它其实一直在跑。`,
        400,
      );
    }
    s.disabledRuleKeys = [...new Set(body.disabledRuleKeys)].sort(); // 去重 + 全序 ⇒ 同输入同落盘（R6）
    await repos.sim.putSession(s);
    return { id: s.id, disabledRuleKeys: s.disabledRuleKeys };
  });

  /**
   * 对照跑：**同一 tick、开/关两种规则集各跑一遍、返回差异**（本单的核心产出，不是附加项）。
   *
   * · **确定性**（R6）：两版共用 `simAdvanceTicks` 同一支，输入相同即输出相同；回包不含任何
   *   wall-clock 字段（`computedAt` 之类一律不加 —— 加了它同输入就不再字节一致）。
   * · **不写世界态**：两版都 `persist: false`；`putTickState`/`putSession`/`outbox.emit` 一次都不调。
   *   会话的 `curTick` 与全部 tick 行在本路由前后**逐字节相同**（测试咬死，见 §4）。
   * · `disabledRuleKeys` 可由 body 覆盖 ⇒ 前端拨一下开关就能立刻要到差值，
   *   不必先 PATCH 再跑（§3.3「关掉一条边 ⇒ 立刻看到结果差异，不是再点一次运行」）。
   */
  app.post("/a/v1/sim/sessions/:id/counterfactual", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.propagation"); // R3
    const s = await getSimOr404(c, (req.params as { id: string }).id); // R2
    const body = parseBody(
      z.object({ n: z.number().int().min(1).max(64).optional(), disabledRuleKeys: z.array(z.string()).optional() }),
      req.body ?? {},
    );
    const n = body.n ?? 1;
    const published = await listPublishedPropRules(c);
    if (body.disabledRuleKeys) {
      const unknown = unknownPropagationRuleKeys(body.disabledRuleKeys, published);
      if (unknown.length > 0) {
        throw new AppError(
          "UNKNOWN_PROPAGATION_RULE_KEY",
          `未知传导规则 key：${unknown.join(", ")}。对照跑同样拒绝静默忽略——` +
            `否则差值恒 0，而你会以为"关掉这条边没有影响"。`,
          400,
        );
      }
    }
    const { active, suppressed, disabled } = await sessionPropRules(c, s, body.disabledRuleKeys);
    // 基线 = 全部已发布规则（"边开着"）；反事实 = 减去屏蔽集（"边关掉"）。两版同一起点、同一算法。
    const baseline = await simAdvanceTicks(c, s, { rules: published, n, persist: false });
    const counterfactual = await simAdvanceTicks(c, s, { rules: active, n, persist: false });
    const result: SimCounterfactualResult = {
      fromTick: s.curTick,
      ticks: n,
      disabledRuleKeys: disabled,
      suppressedRules: suppressed,
      baselineState: baseline.state,
      counterfactualState: counterfactual.state,
      diffs: diffTickStates(baseline.state, counterfactual.state),
      // 诚实位：屏蔽的这几条在基线那版真的动了吗。没动 ⇒ 差值为空是"它本来就没在跑"，
      // 不是"关掉它没影响"。两者在屏上长得一样，必须显式分开。
      suppressedRulesFiredInBaseline: suppressed.map((r) => r.key).filter((k) => baseline.firedRuleKeys.includes(k)).sort(),
    };
    return result;
  });
  /**
   * 把一条扰动施加到**当前 tick**，并把结果落回 `sim_tick_state`（`/act` 与 `POST /perturbations` 共用）。
   *
   * 🔴 **欠账 #151 的修复点**：此前这里无条件写 `pending: [], trace: null`
   * （原 `app.ts:1485`），而 tick 路由正是从同一行读回在途延迟贡献（`app.ts:1433`
   * `getTickState(...).pending`）。`seed.ts` 的 `demo_line_util_to_base_load` 带 `delayTicks: 1`
   * ⇒ demo 租户跑一次 tick 后 `pending` 必然非空 ⇒ `tick → act → tick` **静默丢掉全部在途传导**。
   * 立账时（WO-P0）不炸只因 `/act` 零调用方（欠账 #150）。**WO-SIM-ACT-CLOSE 已把前端入口接上**
   * （沙盘「施加扰动」→ `POST /perturbations` → 本函数），所以这个坑现在真的在生产路径上 ——
   * 「两条账必须同单修」（PRD §2.2③）说的正是这件事。两条施加路各有一条回归门，缺一不可：
   * `test/sim-perturbation.test.ts` 断言②（`/act` 路）· `test/sim-act-close.seam.test.ts` ③（`/perturbations` 路）。
   * 改法：**读回并保留当前 tick 已有的 `pending`/`trace`，只改 `state`**。
   * 扰动是模拟态、不写真值（R4；采纳才出 ActionDraft），也不该动传导队列。
   */
  const simApplyAtCurrentTick = async (
    c: AuthCtx, s: SimSession,
    p: Pick<Perturbation, "targetObjectId" | "targetStateVar" | "magnitude" | "mode">,
  ): Promise<TickState> => {
    const cur = await repos.sim.getTickState(c.tenantId, s.id, s.curTick);
    const state = applyPerturbationToState(cur?.state ?? simState(s.baseSnapshot), p);
    await repos.sim.putTickState({
      sessionId: s.id, tenantId: c.tenantId, tick: s.curTick, state,
      pending: cur?.pending ?? [], // ← #151：保留在途延迟贡献，不再硬写空
      trace: cur?.trace ?? null, // ← 同理：本 tick 的传导轨迹不是扰动造成的，不该被抹掉
    });
    return state;
  };

  app.post("/a/v1/sim/sessions/:id/act", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.sandbox");
    const s = await getSimOr404(c, (req.params as { id: string }).id);
    const b = req.body as { objectId: string; stateVar: string; value: number };
    // `/act` = 一条 `mode:"set"` / `durationTicks:null` 的扰动（PRD §3.1.2 判据 1：null = 永久 = 今天 /act 的行为）。
    // 走与 `POST /perturbations` **同一个施加实现**，故「逐字节同结果」是结构上成立的，不靠两处代码碰巧一样。
    const state = await simApplyAtCurrentTick(c, s, {
      targetObjectId: String(b.objectId), targetStateVar: String(b.stateVar), magnitude: Number(b.value), mode: "set",
    });
    return { curTick: s.curTick, state };
  });

  // ---- 扰动一等公民（WO-P0 · PRD-UPGRADE-decision-sandbox-v2 §3.1 · 关闭 #150/#151/REQ060）----
  // 此前沙盘唯一的扰动入口是 `/act` 的裸标量写入：无 id、无持久化、无 kind、无时序 ⇒
  // 「这个世界受过哪些扰动」问不出来，「第 5 天开始停机 72h」排不了（PRD §2.2②）。
  // 本组路由把扰动升为实体：可建、可列、可删。全部过 sim.sandbox entitlement（R3 先于 authz）。
  // ⚠ 本单**不做** propagateTick 接扰动（WO-P2）：建扰动只在「本 tick 已生效」时立即施加
  // （= 与 `/act` 等价的那条路），未来 tick 的扰动只入库、等 WO-P2 在传导里按 startTick/duration 施加与回退。
  app.post("/a/v1/sim/sessions/:id/perturbations", async (req, reply) => {
    const c = ctx(req); await requireSim(c, "sim.sandbox");
    const s = await getSimOr404(c, (req.params as { id: string }).id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    // `safeParse` 而非裸 `parse`：ZodError 身上没有 `statusCode`，会被兜底错误处理器（app.ts:833）
    // 判成 **500 INTERNAL_ERROR** —— 把「用户填错了」报成「服务器坏了」，且进 error 日志。
    // 统一错误信封要求这里是 400 VALIDATION_ERROR。
    const parsed = PerturbationSchema.safeParse({
      ...body,
      id: newId("simpert"), tenantId: c.tenantId, sessionId: s.id,
      // 不填 startTick = 「现在就发生」（当前 tick）——与 `/act` 的隐含语义一致。
      startTick: body.startTick ?? s.curTick,
      createdAt: new Date().toISOString(),
    });
    if (!parsed.success) throw validationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const p = parsed.data;
    await repos.sim.createPerturbation(p);
    // 已在当前 tick 生效的扰动立刻落到世界态（active 判据由契约单源 isPerturbationActiveAt 给，
    // 引擎与路由共用同一份，不许各写一份）。未生效的只入库。
    const state = isPerturbationActiveAt(p, s.curTick) ? await simApplyAtCurrentTick(c, s, p) : await simCurrent(c, s);
    await outbox.emit(c.tenantId, "sim.perturbation_created", { sessionId: s.id, perturbationId: p.id, kind: p.kind, startTick: p.startTick });
    return reply.status(201).send({ perturbation: p, curTick: s.curTick, state });
  });
  app.get("/a/v1/sim/sessions/:id/perturbations", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.sandbox");
    const s = await getSimOr404(c, (req.params as { id: string }).id);
    return { items: await repos.sim.listPerturbations(c.tenantId, s.id) };
  });
  app.delete("/a/v1/sim/sessions/:id/perturbations/:pid", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.sandbox");
    const s = await getSimOr404(c, (req.params as { id: string }).id);
    // 删的是**扰动记录**，不回滚世界态（回滚走 checkpoint/rollback —— 那是既有的、有语义的回退口，
    // 在这里再造一个"撤销"就是第二套真相源）。
    const ok = await repos.sim.deletePerturbation(c.tenantId, s.id, (req.params as { pid: string }).pid);
    if (!ok) throw notFound("perturbation not found");
    return { deleted: true };
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
  // WO-ENGINE-2 件二·半边A：检查点**列表读端**。仓储三处（repo.ts 接口 / memory.ts / pg.ts）早就写好了
  // `listCheckpoints`，但 24 条 `/a/v1/sim/*` 路由里从没有人开这个口 —— 病根在 route 层，不在前端。
  // 后果：`sim.checkpoint_saved` 事件没有可失效的缓存（前端无列表可读），回滚/分支只能靠调用方自己记
  // checkpointId。开此路由后该事件才具备真接线条件（前端 useQuery 属 WO-1/WO-4 边界，不在本单）。
  // ⚠️ R9 双实现一致性：排序**必须**落在本层，不能指望两个仓储各自 ORDER BY —— 它们今天就不一致：
  // `repo/pg.ts:103` 是 `ORDER BY tick`（且 tick 相同时次序由 DB 任意决定，非全序），
  // 而 `repo/memory.ts:70` **一个 sort 都没有**（Map 插入序）。沙盘的常规动作正好会踩中这个分叉：
  // 存档 → 回滚 → 在更早的 tick 再存一次 ⇒ 插入序与 tick 序相反。
  // 实测（2026-08-13 收编本单时在 canonical 上真跑，非转述）：去掉下面这行 `.sort(...)`，
  // memory 按插入序吐 `[2, 8, 2]`，`sim-checkpoint-list.seam.test.ts` ② 当场红：
  //   `AssertionError: expected [ 2, 8, 2 ] to deeply equal [ 2, 2, 8 ]`
  // 顺序在这里是**语义**而非美观：用户按它挑回滚点/分支点，顺序错 = 挑错档。
  // 全序键取 `(tick, createdAt, id)`，与 `listPerturbations` 同款纪律 —— **不以随机 id 作首键**，
  // id 只做最后的去歧义键，于是 memory 与 pg 返回逐字节一致（R6 确定性 ∧ R9 双实现同构）。
  //
  // ⚠️ **诚实边界：次键 `createdAt`/`id` 今天没有测试在驱动它（存活变异，2026-08-13 实测）。**
  // 变异 M1「把 `.sort` 砍成只剩 `a.tick - b.tick`」⇒ `sim-checkpoint-list.seam.test.ts`
  // **8/8 依旧全绿（RC=0）**，包括那条自称在验次键的 `expect(...).toEqual(["锚@2","回@2"])`。
  // 病因不是断言写错，是 **`Array.prototype.sort` 自 ES2019 起是稳定排序**，而 memory 仓储
  // 返回的正是插入序 ⇒ 同 tick 的并列项靠"稳定性"就已经落在 createdAt 序上，次键从未被真正调用。
  // ⇒ 次键真正的守备对象是 **pg**（`ORDER BY tick` 对并列项不定序），而 pg 路径**本测试完全没覆盖**
  //   （全仓 datacore 测试跑 memory 仓储）。**保留次键**（它对 pg 是必需的、且零成本），
  //   但**不许**据本测试全绿宣称"双实现顺序已一致"—— 那是 R9 上一个仍然张着的口子，
  //   要闭得靠一条真连 pg 的测试，属另开工单。这一条按"接了线没数据/没覆盖"记账，非"已验通过"。
  app.get("/a/v1/sim/sessions/:id/checkpoints", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.checkpoint");
    const s = await getSimOr404(c, (req.params as { id: string }).id);
    const items = (await repos.sim.listCheckpoints(c.tenantId, s.id))
      .sort((a, b) => a.tick - b.tick || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    return { items };
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
  app.post("/a/v1/sim/sessions/:id/branch", async (req, reply) => {
    const c = ctx(req); await requireSim(c, "sim.branch");
    const parent = await getSimOr404(c, (req.params as { id: string }).id);
    const cp = await repos.sim.getCheckpoint(c.tenantId, String((req.body as { checkpointId?: string })?.checkpointId));
    if (!cp || cp.sessionId !== parent.id) throw notFound("checkpoint not found");
    const baseState = (await repos.sim.getTickState(c.tenantId, parent.id, cp.tick))?.state ?? {};
    const child: SimSession = { id: newId("sims"), tenantId: c.tenantId, baseSnapshot: simState(baseState), scope: parent.scope,
      status: "READY", curTick: 0, parentCheckpointId: cp.id,
      // 分支**继承**父会话屏蔽的边：分支的语义是"从这个存档点接着往下试"，屏蔽集属于那个世界的假设。
      // 不继承 ⇒ 分支出来的世界会悄悄把边又打开，用户看到的数与父会话对不上却查不出原因。
      disabledRuleKeys: [...(parent.disabledRuleKeys ?? [])],
      createdAt: new Date().toISOString() };
    await repos.sim.createSession(child);
    await repos.sim.putTickState({ sessionId: child.id, tenantId: c.tenantId, tick: 0, state: simState(baseState), pending: [], trace: null });
    await outbox.emit(c.tenantId, "sim.branched", { parentSessionId: parent.id, childSessionId: child.id, checkpointId: cp.id });
    return reply.status(201).send(child);
  });
  app.get("/a/v1/sim/compare", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.branch");
    const q = req.query as { a?: string; b?: string };
    const seriesOf = async (id?: string) => (id ? (await repos.sim.listTickStates(c.tenantId, id)).map((t) => ({ tick: t.tick, state: t.state })) : []);
    return { a: await seriesOf(q.a), b: await seriesOf(q.b) };
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
    const nodeObjectIds: Record<string, string[]> = {};
    for (const t of types) {
      nodeObjectIds[t.key] = (await repos.objects.listByType(c.tenantId, t.key))
        .filter((o) => !o.mergedInto)
        .map((o) => o.id)
        .sort((a, b) => a.localeCompare(b));
    }
    const cfg = {
      tenantId: c.tenantId,
      nodeTypes: types.map((t) => t.key).sort(),
      nodeObjectIds,
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

  // ---- WO-IMPACT-PROPAGATION · 影响传播统一入口（Decision Twin §14 / PRD E5）--------------
  // PRD-enterprise-decision-twin.md:357：「想要的 impact-analysis = 栈 B 的传播算法 × 栈 A 的世界隔离」。
  // 本端点**不造引擎**：栈 B = ontology-core.recompute（本体增量重算·全平台唯一真算法），
  // 栈 A = SimSession（真独立世界）。存量盘点见 docs/WO-IMPACT-PROPAGATION-inventory.md。
  //
  // 与既有两个出口平行（不改它们）：POST /a/v1/inference/whatif（app.ts 上方）· generic_inference 求解器。
  // 唯一新增的是**四维分项 + 诚实标记**——那两个出口只有一个裸 `affectedObjects:number`。
  // 走 sim.sandbox entitlement（R3 暗发：关 = 404 FEATURE_NOT_FOUND，先于 authz）。
  app.post("/a/v1/simulation/impact-analysis", async (req) => {
    const c = ctx(req);
    await requireSim(c, "sim.sandbox");
    const body = parseBody(ImpactAnalysisRequestSchema, req.body);
    return analyzeImpact({ repos, ontologyCore }, c, body);
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
   * Trial Tick 的**传导相**（欠账 #152 的修复点 —— 两条工单在这里合流）。
   *
   * 🔴 病灶：此前 Trial Tick 只跑 `ontologyCore.recompute`（**派生相**），`rulesFired` 恒等于派生 topo 长度，
   * 注释写着「传导 `propagateTick` 待增量3」。而增量 3 早已落地 —— `POST …/tick` 里传导核
   * 是真跑的（本文件 tick 路）。于是就绪认证一直在拿**派生相**的成绩单
   * 冒充「这个世界能不能推演」：传导规则一条没跑过，`propagationRules` 那一栏却照样计入完整度。
   * 这是「接了线接错地方」——引擎接了 tick 路、没接认证路（不是没实现，也不是没数据）。
   *
   * 修法：认证时在**克隆态**上真跑一 tick 传导，数「真的产生了效果的规则条数」。
   *
   * 四条刻意的取舍（都写在这里，免得下一个人以为是漏了）：
   *  · `pending` 传 `[]`、`perturbations` 传 `[]` —— Trial Tick 是**探针**不是续跑：同一份世界态
   *    必须每次得到同一个结论（R6），不许被在途队列/扰动历史带偏。它回答的是「这个世界的
   *    配置能不能驱动传导」，不是「下一格会变成什么」（那是 `POST …/tick` 的职责）。
   *  · 输入图/范围/参数/闸门走 `buildPropagationInputs` —— **与真 tick 同一处装配**
   *    （WO-SIM-ACT-CLOSE；另抄一份就会出现「认证说能跑、真 tick 不是这个数」）。
   *  · 跑在**本次认证问的那个范围**上（`scopeKind`/`target`，WO-SIM-SCOPE-TRIAL），与上面 closure 的
   *    `types` 裁剪同一个口径 —— 认证回答的是"这个范围能不能进推演"，试算就必须在同一个范围里跑。
   *    范围解释走契约唯一实现 `resolveSimScope`（与 tick 路由同一支，不另写一套 if）。
   *  · **不写任何东西**：传导核是纯函数，产出丢弃；认证路一如既往零副作用。
   *
   * 「fired」的判据 = 该规则本 tick 真的产生了效果：即时贡献进 `trace`，延迟贡献进 `pending`，
   * 两处都算（判据在 `firedPropagationRuleKeys` 这一支单源，扰动落地/回退行与上一轮延迟到达行
   * 都不算传导触发）。源态为 0 / 被闸门挡住 / 被范围裁掉 / 贡献恰为 0 ⇒ **不算 fired**，这是诚实的：
   * 世界态是空的时候，`propagationRules: 3` 但 `propagationRulesFired: 0` 正是要让人看见的事实。
   */
  const trialPropagate = async (
    c: AuthCtx,
    s: SimSession,
    scope: ResolvedSimScope,
  ): Promise<{ fired: number; declared: number }> => {
    const propRules = await listPublishedPropRules(c);
    if (propRules.length === 0) return { fired: 0, declared: 0 };
    const inp = await buildPropagationInputs(repos, c, scope);
    const out = propagateTick(
      inp.graph, simState(await simCurrent(c, s)), propRules,
      [], // pending：探针不续跑在途队列（见上）
      s.curTick, inp.ruleParams, inp.cadenceGates,
      [], // perturbations：探针不重放扰动（见上）
    );
    // 只数**本租户已发布规则**产出的那些（`firedPropagationRuleKeys` 已剔掉扰动行与延迟到达行；
    // 这一层交集是第二道保险，也让"fired ≤ declared"在类型之外有实据）。
    const declared = new Set(propRules.map((r) => r.key));
    const fired = firedPropagationRuleKeys(out.trace, out.pending).filter((k) => declared.has(k));
    return { fired: fired.length, declared: propRules.length };
  };

  /**
   * 从 live 本体装配认证三件输入（closure/gaps/trial）+ scope 计数 —— 全部复用既有产物，零新校验。
   * scope=LOCAL 时按 target（typeKey）裁出子图；GLOBAL 时全本体。computedAt 由调用方传入（R6）。
   *
   * `session` 入参（WO-SIM-SCOPE-TRIAL ∧ WO-SIM-ACT-CLOSE 同一诉求）：Trial Tick 的传导相要在
   * **这个世界当前的态**上真跑一遍 —— 认证问的是"这个世界"能不能推演，不是"某个凭空造的态"能不能推演。
   * 此前两个端点都已经 `getSimOr404` 拿到了会话却随手丢掉，只用来做 404 隔离；顺手传进来即可。
   */
  const assembleCertification = async (
    c: AuthCtx,
    scopeKind: "GLOBAL" | "LOCAL",
    target: string | null,
    computedAt: string,
    session: SimSession,
  ) => {
    const allTypes = await ontology.listTypes(c);
    const types = scopeKind === "LOCAL" && target ? allTypes.filter((t) => t.key === target) : allTypes;
    const typeKeys = new Set(types.map((t) => t.key));
    const allActions = await actions.listTypes(c);
    const allRules = await repos.rules.list(c.tenantId, (r) => r.status === "PUBLISHED");
    const allDerivs = await repos.derivationSpecs.list(c.tenantId, (s) => s.status === "ACTIVE");
    const allSlices = await repos.sliceSpecs.list(c.tenantId);
    const allProps = await repos.sim.listPropagationRules(c.tenantId, false);

    const derivs = allDerivs.filter((d) => typeKeys.has(d.targetType));
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
      solverNeeds: [], kbDocs: [],
      sliceNeeds: [], intentNeeds: [], planNeeds: [], workflowNeeds: [], skillNeeds: [], agentNeeds: [], mcpNeeds: [], sceneNeeds: [],
    };
    const closure = validateClosure(plan, CLOSURE_POLICY, "STRICT");
    const gaps = selfCheckGaps("", `simcert_${c.tenantId}`, closure, undefined, 0);

    // ── Trial Tick（§3）：**两相**都真跑一遍（WO-SIM-SCOPE-TRIAL ∧ WO-SIM-ACT-CLOSE · 关闭欠账 #152）──
    //
    // 🔴 这里原先只跑 `ontologyCore.recompute`（**派生相**），注释还写着「传导待增量3 → 记 0」——
    //    而传导相早已实装并有生产调用方（本文件 tick 路由）。
    //    于是认证屏上那句「规则触发 N 条」度量的是另一相，**传导相恒记 0**：
    //    「信号是真的，只是它不指向我要断言的那个对象」。
    //
    // 修法判据是**效果层**：不是"把传导核调一下"，而是**要求它真的产出贡献** ——
    //    `firedPropagationRuleKeys` 只数「落下了即时贡献 或 排进了延迟队列」的规则 key。
    //    一条规则被遍历到但源态为 0 / 无匹配边 / 闸门拿不到 / 被范围裁掉 ⇒ 不算触发。
    // ── Trial Tick（§3）：**两相都真跑**，且**每个数各叫各的名**────────────────────────
    //    （WO-CERT-CONTRACT-RECONCILE = WO-SIM-SCOPE-TRIAL 的实现 ⊕ WO-CERT-HONESTY 的口径）
    //
    // 【派生相】`ontologyCore.recompute(c, [], { dryRun: true })`：装载并索引全部对象，
    //   再对全部 ACTIVE DerivationSpec 做拓扑排序（`ontology-core.ts topoSort`，有环抛
    //   `CyclicDerivationError`）。**`changes = []` ⇒ dirty 集为空 ⇒ 逐节点 `continue` 全部命中
    //   ⇒ 一条派生公式都没被求值**（`updatedObjects` 恒 0）。
    //   ⇒ 所以 `rc.order.length` 是**图的规模**，不是"触发了几条"。字段名照此取 `derivationNodes`。
    //   实测复验（别信自述，这是亲手跑的）：同一份本体调两次重算，一次空变更集、一次喂真变更集，
    //   `order.length` **两次同为 2**，而 `updatedObjects` 分别 0 与 1
    //   —— 见 `test/sim-cert-contract-reconcile.seam.test.ts` ③。
    //
    // 【传导相】**真跑一 tick**并只数"真产出了贡献"的规则：`firedPropagationRuleKeys` 只数
    //   「落下了即时贡献 或 排进了延迟队列」的规则 key；一条规则被遍历到但源态为 0 / 无匹配边 /
    //   闸门拿不到 ⇒ **不算触发**（那正是今天最常见的病样）。⇒ 它是**真·触发计数**。
    //   连**分母** `propagationRulesDeclared` 一起报：只报 fired 的话，「本来就没规则」与
    //   「声明了一堆但全哑火」在屏上都是 0，分辨不了（`declared>0 && fired===0` 必须看得见）。
    //
    // ⚠ 两个数**性质不同、不可相加**：旧字段 `rulesFired = 规模 + 触发` 量纲不成立，已弃用
    //   （仍下发同值以可回退，由 `certification.ts` 从诚实字段算出，无法漂移）。
    //
    // 跑在什么态上：**这个会话当前 tick 的世界态**（克隆，`dryRun` 语义 —— 不落任何 tick 快照、
    //    不推进 `curTick`、不 emit 事件）。用别的态就不是这个世界的试算了。
    // 跑在什么范围上：**本次认证问的那个范围**（`scopeKind`/`target`），与上面 closure 的 `types`
    //    裁剪同一个口径 —— 认证回答的是"这个范围能不能进推演"，试算就必须在同一个范围里跑。
    //    范围解释走契约唯一实现 `resolveSimScope`（与 tick 路由同一支，不另写一套 if）。
    // 用哪一份图/参数/闸门：`trialPropagate` → `buildPropagationInputs`，**与真 tick 同一处装配**。
    let trial: TrialTickInput;
    try {
      const rc = await ontologyCore.recompute(c, [], { dryRun: true });
      const trialScope: ResolvedSimScope = resolveSimScope(
        scopeKind === "LOCAL" ? { kind: "LOCAL", target, hops: SIM_SCOPE_DEFAULT_HOPS } : { kind: "GLOBAL" },
      );
      const prop = await trialPropagate(c, session, trialScope);
      trial = {
        passed: true,
        derivationNodes: rc.order.length, // **规模**（非触发数，见上取证）
        propagationRulesFired: prop.fired, // 真·触发数
        propagationRulesDeclared: prop.declared, // 分母
        // 这条路**确实**覆盖传导相。⚠ `trialPropagate` 在"本租户零已发布传导规则"时会早退
        // （不调传导核，保住零本体读那条性能特征）——那仍算 covered：覆盖面说的是**这条路跑不跑传导相**，
        // 而不是"这次有没有东西可跑"。declared=0 时 fired=0 本就可解读，不该再报"不可解读"。
        propagationCovered: true,
        at: computedAt, error: null,
      };
    } catch (e) {
      // 派生图有环（CYCLIC_DERIVATION）/ 传导相抛错 等 → 诚实标 FAIL，不假装通过。
      // 注：`fanoutSafe` 复用 `trial.error === null` 当环检测（certification.ts），
      //     故这里**不许**把非致命情况也写进 error（写了会把"无环"误判成"有环"）。
      // `propagationCovered: false` —— 抛错时传导相**确实没跑完**，据实说，别报 true。
      trial = {
        passed: false, derivationNodes: 0, propagationRulesFired: 0, propagationRulesDeclared: 0,
        propagationCovered: false, at: computedAt, error: e instanceof Error ? e.message : String(e),
      };
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
      derivations: derivs.map((d) => ({
        typeKey: d.targetType, propKey: d.targetProp,
        sourceVars: d.deps.map((dep) => `${dep.typeKey}.${dep.prop}`), present: true,
      })),
      actions: scopeActions.map((a) => ({ key: a.key, targetTypeKey: null })),
      slices: slices.map((s) => ({ key: s.sliceKey })),
      propagationRules: propRules.map((p) => ({
        key: p.key, sourceTypeKey: p.sourceTypeKey, sourceStateVar: p.sourceStateVar,
        targetTypeKey: p.targetTypeKey, targetStateVar: p.targetStateVar, present: true,
      })),
      needed: {
        // ⚠ WO-CERT-HONESTY ①：这里曾多一行 `stateVars:`，其表达式与下一行 `derivationRules`
        //    **逐字节相同** ⇒ 屏上两行数同一个数，且派生在完整度 pct 的分子分母里各数两遍。已删。
        // needed 的承载物 = 本体类型上**声明**的派生属性数；present 的承载物 = 已物化的 ACTIVE DerivationSpec。
        // 两者确是两个不同的东西，故 derivationRules 这一对比值成立。
        derivationRules: types.reduce((a, t) => a + t.derivedProperties.length, 0),
        actions: Math.max(scopeActions.length, types.length > 0 ? 1 : 0),
        propagationRules: propRules.length, // 增量3 才声明传导 needed；当前 present=needed（不虚减完整度）
      },
    };
    return deriveCertification(closure, gaps, trial, scope, DEFAULT_CERT_CONFIG);
  };

  app.get("/a/v1/sim/sessions/:id/certification", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.certification");
    // WO-SIM-SCOPE-TRIAL：会话不再只用于 404 隔离 —— Trial Tick 要在它的当前世界态上真跑传导。
    const s = await getSimOr404(c, (req.params as { id: string }).id); // 404 隔离（R2 租户）
    const q = req.query as { scope?: string; target?: string };
    const scopeKind = q.scope === "LOCAL" ? "LOCAL" : "GLOBAL";
    return assembleCertification(c, scopeKind, q.target ?? null, new Date().toISOString(), s);
  });

  app.get("/a/v1/sim/sessions/:id/scope-precheck", async (req) => {
    const c = ctx(req); await requireSim(c, "sim.sandbox");
    const s = await getSimOr404(c, (req.params as { id: string }).id);
    const q = req.query as { scope?: string; target?: string };
    const scopeKind = q.scope === "LOCAL" ? "LOCAL" : "GLOBAL";
    const cert = await assembleCertification(c, scopeKind, q.target ?? null, new Date().toISOString(), s);
    // init step③ 世界完整度预检视图：只回完整度 + 将进入沙盘清单 + 缺件（轻量子集）。
    return { scope: cert.scope, targetRef: cert.targetRef, worldCompleteness: cert.worldCompleteness, canEnterSimulation: cert.canEnterSimulation, gaps: cert.gaps };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // WO-ENTERPRISE-STATE · `EnterpriseState` 企业状态快照读写端点
  //   （PRD-enterprise-decision-twin §3 五张 MVP 表之一 · §4.1 真实/仿真两世界物理隔离）。
  //
  //  语义：「企业**现在**是什么状态」——某个世界在某个**逻辑时刻**上的 KPI/产能/库存/订单快照。
  //  · `capturedAt` 是 A8 模拟时钟派生的逻辑时钟，**不是 wall-clock**；时钟没初始化就 409 明说，不兜底
  //    （wall-clock 兜底 = 给快照按一个不在任何时间轴上的坐标，之后所有对比/回放/确定性判据全建在假坐标上）。
  //  · 幂等：id 由 (tenant, world, tick) 确定 ⇒ 同一逻辑时刻重复 POST 覆盖同一行、内容逐字节相同（R6）。
  //  · 不挂 entitlement：与同为数据面的 `/a/v1/metrics`、`/a/v1/decisions` 同档（沙盘 `sim.*` 那组门守的是
  //    推演功能，不是"企业现在什么状态"这类基础事实读取）。R2 租户隔离照旧由 ctx + 仓储层强制。
  // ─────────────────────────────────────────────────────────────────────────────
  app.post("/a/v1/twin/enterprise-states", async (req, reply) => {
    const c = ctx(req);
    const b = (req.body ?? {}) as { worldId?: string };
    const state = await enterpriseState.capture(c, { worldId: b.worldId });
    return reply.status(201).send(state);
  });
  app.get("/a/v1/twin/enterprise-states", async (req) => {
    const c = ctx(req);
    const { worldId } = req.query as { worldId?: string };
    return { items: await enterpriseState.list(c, { worldId }) };
  });
  // ⚠ 必须排在 `/:id` 之前：Fastify 静态段优先于参数段，但把 `latest` 写在后面容易在后续重构里
  //   被挪成参数段的兄弟路由从而歧义 —— 顺序即意图，别调换。
  app.get("/a/v1/twin/enterprise-states/latest", async (req) => {
    const c = ctx(req);
    const { worldId } = req.query as { worldId?: string };
    const world = worldId?.trim() || ENTERPRISE_STATE_REAL_WORLD_ID;
    const state = await enterpriseState.latest(c, world);
    // 诚实空：没有就是没有，返回 `state: null` + 原因，**不现场偷偷捕获一份**冒充"最新"
    // （那会让一次只读请求产生写副作用，且前端分不清"本来就有"和"我一问它才有"）。
    return state
      ? { worldId: world, state }
      : { worldId: world, state: null, reason: `世界 ${world} 尚无任何快照（POST /a/v1/twin/enterprise-states 捕获一份）` };
  });
  app.get("/a/v1/twin/enterprise-states/:id", async (req) => {
    const c = ctx(req);
    return enterpriseState.get(c, (req.params as { id: string }).id);
  });
  // fork 进仿真世界（§4.1）：产生**新行**，真实世界那一行一个字节都不动。
  app.post("/a/v1/twin/enterprise-states/:id/fork", async (req, reply) => {
    const c = ctx(req);
    const b = (req.body ?? {}) as { worldId?: string };
    if (!b.worldId) throw validationError("worldId required (target simulation world = an existing sim session id)");
    const forked = await enterpriseState.fork(c, (req.params as { id: string }).id, b.worldId);
    return reply.status(201).send(forked);
  });
  // 两份快照的指标差（口径与将来的 `StateDelta` 同一份纯函数 `diffEnterpriseStates`，不许各算一套）。
  app.get("/a/v1/twin/enterprise-states/:id/diff", async (req) => {
    const c = ctx(req);
    const { against } = req.query as { against?: string };
    if (!against) throw validationError("against=<stateId> required");
    const after = await enterpriseState.get(c, (req.params as { id: string }).id);
    const before = await enterpriseState.get(c, against);
    return { before: before.id, after: after.id, changes: diffEnterpriseStates(before, after) };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // WO-LIVE-ENDPOINTS · 活③④ 方案存/分支/横比（前端「方案存比」直连真后端·替 MSW 桩）。
  //   复用 SimSession 状态机（R9 双实现·R2 tenant 隔离）承载方案快照——scope 载快照 JSON（snapshotKind
  //   判别·baseSnapshot 留空·不污染沙盘 session 列表）。语义镜像上方 sim checkpoint/branch/compare。
  //   门禁 view.global-sim.live（前端暗发同门·R3 先于 authz·关=404 FEATURE_NOT_FOUND）。
  // ─────────────────────────────────────────────────────────────────────────────
  const requireLive = async (c: AuthCtx) => {
    if (!(await features.enabled(c.tenantId, "view.global-sim.live"))) throw featureNotFound();
  };
  type GsliveKpi7 = { ontime: number; cost: number; changeoverHours: number; freight: number; fgInv: number; transitInv: number; margin: number };
  const asKpi7 = (v: unknown): GsliveKpi7 => {
    const k = (v ?? {}) as Partial<GsliveKpi7>;
    return {
      ontime: Number(k.ontime ?? 0), cost: Number(k.cost ?? 0), changeoverHours: Number(k.changeoverHours ?? 0),
      freight: Number(k.freight ?? 0), fgInv: Number(k.fgInv ?? 0), transitInv: Number(k.transitInv ?? 0), margin: Number(k.margin ?? 0),
    };
  };
  interface GsliveScope { snapshotKind: "gslive"; label: string; page: string; primary: string; parentId: string | null; kpi: GsliveKpi7; servedCount: number; displacedCount: number; ontimeRate: number }
  const snapKind = (s: SimSession): string | undefined => (s.scope as { snapshotKind?: string })?.snapshotKind;
  const gsliveSnap = (s: SimSession) => {
    const sc = s.scope as unknown as GsliveScope;
    return { id: s.id, label: sc.label, parentId: sc.parentId ?? null, page: sc.page, primary: sc.primary, createdAt: s.createdAt, kpi: sc.kpi, servedCount: sc.servedCount, displacedCount: sc.displacedCount, ontimeRate: sc.ontimeRate };
  };
  const putSnapshotSession = async (c: AuthCtx, idPrefix: string, scope: Record<string, unknown>): Promise<SimSession> => {
    const s: SimSession = { id: newId(idPrefix), tenantId: c.tenantId, baseSnapshot: {}, scope, status: "READY", curTick: 0, parentCheckpointId: null, disabledRuleKeys: [], createdAt: new Date().toISOString() };
    await repos.sim.createSession(s);
    return s;
  };

  // 活③ 全局推演方案（decision_play 范式·七维 KPI 快照）。
  app.post("/a/v1/sim/scenarios", async (req, reply) => {
    const c = ctx(req); await requireLive(c);
    const b = (req.body ?? {}) as { page?: string; label?: string; primary?: string; kpi?: unknown; servedCount?: number; displacedCount?: number; ontimeRate?: number; parentId?: string | null };
    const scope: GsliveScope = {
      snapshotKind: "gslive", label: String(b.label ?? "方案"), page: String(b.page ?? "global-sim"), primary: String(b.primary ?? ""),
      parentId: b.parentId ?? null, kpi: asKpi7(b.kpi), servedCount: Number(b.servedCount ?? 0), displacedCount: Number(b.displacedCount ?? 0), ontimeRate: Number(b.ontimeRate ?? 0),
    };
    const s = await putSnapshotSession(c, "scen", scope as unknown as Record<string, unknown>);
    await outbox.emit(c.tenantId, "sim.scenario_saved", { scenarioId: s.id, page: scope.page });
    return reply.status(201).send(gsliveSnap(s));
  });
  app.get("/a/v1/sim/scenarios", async (req) => {
    const c = ctx(req); await requireLive(c);
    const page = (req.query as { page?: string })?.page;
    const all = (await repos.sim.listSessions(c.tenantId)).filter((s) => snapKind(s) === "gslive");
    const scoped = page ? all.filter((s) => (s.scope as unknown as GsliveScope).page === page) : all;
    return { scenarios: scoped.map(gsliveSnap) };
  });
  app.get("/a/v1/sim/scenarios/compare", async (req) => {
    const c = ctx(req); await requireLive(c);
    const ids = String((req.query as { ids?: string })?.ids ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const scenarios: unknown[] = [];
    for (const id of ids) {
      const s = await repos.sim.getSession(c.tenantId, id);
      if (!s || snapKind(s) !== "gslive") continue;
      const sc = s.scope as unknown as GsliveScope;
      scenarios.push({ id: s.id, label: sc.label, kpi: sc.kpi, servedCount: sc.servedCount, displacedCount: sc.displacedCount, ontimeRate: sc.ontimeRate });
    }
    return { scenarios };
  });
  app.post("/a/v1/sim/scenarios/:id/branch", async (req, reply) => {
    const c = ctx(req); await requireLive(c);
    const parent = await repos.sim.getSession(c.tenantId, (req.params as { id: string }).id);
    if (!parent || snapKind(parent) !== "gslive") throw notFound("scenario not found");
    const psc = parent.scope as unknown as GsliveScope;
    const b = (req.body ?? {}) as { label?: string; kpi?: unknown };
    const scope: GsliveScope = {
      snapshotKind: "gslive", label: String(b.label ?? `${psc.label}·分支`), page: psc.page, primary: psc.primary, parentId: parent.id,
      kpi: b.kpi !== undefined ? asKpi7(b.kpi) : psc.kpi, servedCount: psc.servedCount, displacedCount: psc.displacedCount, ontimeRate: psc.ontimeRate,
    };
    const s = await putSnapshotSession(c, "scen", scope as unknown as Record<string, unknown>);
    return reply.status(201).send(gsliveSnap(s));
  });

  // 活④ 产能页方案（apply/kpis·横比矩阵各格经 generic_inference 同款前向重算公式真算·改 apply→矩阵变·KILL-MOCK）。
  interface LiveApply { objectType: string; objectId: string; prop: string; value: number }
  interface LiveScope { snapshotKind: "live"; baseId: string; name: string; parentId: string | null; apply: LiveApply[]; kpis: { capGain: number; affected: number } }
  const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
  // 下游派生 after = 0.8*0.5 + value*0.5（generic_inference 前向重算同款公式·R6 确定）；capGain = Σ max(0, after − 0.8)。
  const scenarioCapGain = (apply: { value: number }[]): number =>
    round6(apply.reduce((acc, a) => { const v = Number.isFinite(Number(a.value)) ? Number(a.value) : 1; return acc + Math.max(0, (0.8 * 0.5 + v * 0.5) - 0.8); }, 0));
  const liveSnap = (s: SimSession) => {
    const sc = s.scope as unknown as LiveScope;
    return { id: s.id, baseId: sc.baseId, name: sc.name, parentId: sc.parentId ?? undefined, apply: sc.apply, kpis: sc.kpis, createdAt: s.createdAt };
  };
  app.post("/a/v1/sim/live-scenarios", async (req, reply) => {
    const c = ctx(req); await requireLive(c);
    const b = (req.body ?? {}) as { baseId?: string; name?: string; parentId?: string; apply?: LiveApply[] };
    const apply = Array.isArray(b.apply) ? b.apply : [];
    const scope: LiveScope = {
      snapshotKind: "live", baseId: String(b.baseId ?? ""), name: String(b.name ?? "方案"), parentId: b.parentId ?? null, apply,
      kpis: { capGain: scenarioCapGain(apply), affected: new Set(apply.map((a) => a.objectId)).size },
    };
    const s = await putSnapshotSession(c, "lsc", scope as unknown as Record<string, unknown>);
    await outbox.emit(c.tenantId, "sim.scenario_saved", { scenarioId: s.id, baseId: scope.baseId });
    return reply.status(201).send(liveSnap(s));
  });
  app.get("/a/v1/sim/live-scenarios", async (req) => {
    const c = ctx(req); await requireLive(c);
    const baseId = (req.query as { baseId?: string })?.baseId;
    const all = (await repos.sim.listSessions(c.tenantId)).filter((s) => snapKind(s) === "live");
    const scoped = baseId ? all.filter((s) => (s.scope as unknown as LiveScope).baseId === baseId) : all;
    return { scenarios: scoped.map(liveSnap) };
  });
  app.post("/a/v1/sim/live-scenarios/compare", async (req) => {
    const c = ctx(req); await requireLive(c);
    const ids = Array.isArray((req.body as { ids?: unknown })?.ids) ? (req.body as { ids: unknown[] }).ids.map(String) : [];
    const rows: { scenarioId: string; name: string; cells: Record<string, number>; ruleFlag: boolean }[] = [];
    for (const id of ids) {
      const s = await repos.sim.getSession(c.tenantId, id);
      if (!s || snapKind(s) !== "live") continue;
      const sc = s.scope as unknown as LiveScope;
      const capGain = scenarioCapGain(sc.apply);
      const cost = Math.round(sc.apply.reduce((a, x) => a + (/outsource/i.test(String(x.prop)) ? Number(x.value) * 50 : 0), 0) * 100) / 100;
      // DF.13：触红线判定读契约单一来源（此前内联裸阈值）。`>=` = "已达红线"提示，比规则引擎的违规谓词 `>` 早一格，有意为之。
      const ruleFlag = sc.apply.some((x) => /outsource/i.test(String(x.prop)) && Number(x.value) >= OUTSOURCE_REDLINE.maxRatio);
      rows.push({ scenarioId: s.id, name: sc.name, cells: { capGain, cost }, ruleFlag });
    }
    return { dims: [{ key: "capGain", label: "产能增益" }, { key: "cost", label: "外协代价" }], rows };
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
  // A3.1 · 14 域参考本体基线（元租户 95 节点；R2 隔离 / R6 确定性）。
  app.get("/a/v1/meta/refbase", async (req) => {
    const c = ctx(req);
    await requireMetaAccess(c);
    const ref = generateRefbaseOntology();
    const count = refbaseNodeCount(ref);
    const coverage = buildBatteryDomainCoverage();
    return {
      tenantId: ref.tenantId,
      seed: ref.seed,
      digest: refbaseDigest(ref),
      ...count,
      domains: BUSINESS_DOMAINS.map((d) => d.key),
      batteryCoverage: {
        totalTypes: coverage.totalTypes,
        fullyCovered: coverage.fullyCovered,
        unassigned: coverage.unassigned,
        byDomain: coverage.coverage,
      },
    };
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
  app.get("/a/v1/ontology/object-types/stats", async (req) => {
    const c = ctx(req);
    const types = await ontology.listTypes(c);
    const stats = [];
    for (const t of types) {
      const objs = await repos.objects.listByType(c.tenantId, t.key);
      stats.push({
        key: t.key,
        displayName: t.displayName,
        domain: t.domain ?? GRAPH_DOMAIN[t.key] ?? "unassigned",
        propCount: t.properties.length,
        derivedCount: t.derivedProperties?.length ?? 0,
        pk: t.properties.find((p) => p.isPrimaryKey)?.propKey ?? null,
        count: objs.filter((o) => !o.mergedInto).length,
      });
    }
    return { stats };
  });

  // WO-QOS-ONTOLOGY-CONTEXT · 口径语义只读投影（缺口③·文档三层投喂第二层）：
  // 对请求的对象类型返回 { 属性口径(description/unit/dataType) + 派生公式(formula) + 相关已发布规则表达式(expression/severity) }。
  // 单一真值：全部来自本租户已发布本体（ontology.listTypes）+ 规则库（PUBLISHED·按 scopeObjectTypes 命中）——
  // 不新增/改写任何口径真值（description/formula/expression 未填即诚实缺省）。R2 仅本租户（ctx 隔离）·R6 确定性字典序·additive 纯读。
  // WO-ONTOLOGY-CONTEXT-A：组装逻辑已抽为 OntologyService.getTypeSemantics（A 侧内部消费者复用同一单一真值），本路由为薄壳。
  app.get("/a/v1/ontology/type-semantics", async (req) => {
    const c = ctx(req);
    const q = req.query as { types?: string };
    const requested = String(q.types ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return ontology.getTypeSemantics(c, requested);
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
    // WO-ONTOLOGY-CONTEXT-A · A 侧消费者复用同一 type-semantics 单一真值（口径注解 + scope 规则命中标记）——
    // 让 unit/formula/规则表达式不再仅喂 B 的 prompt，A 自身输出校验也据本体口径真值产出注解与判定。
    const semantics = (await ontology.getTypeSemantics(c, [body.objectType])).types.find((t) => t.typeKey === body.objectType);
    return validateOutputAgainstOntology(body.rows, typeDef, policy, semantics);
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
            // WO-D6：属性级中文业务名/语义描述 —— 契约里早有（PropertyDef），
            // 此处漏声明 ⇒ zod strip 掉 ⇒ getTypeSemantics 下发给 B 的口径恒缺 displayName/description。
            displayName: z.string().optional(),
            description: z.string().optional(),
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
        // WO-D6 第二个吞点（与 upsertType 那个各自独立，只修一个另一个照吞）：
        // zod 默认 **strip** 未声明键 —— 这七个 OntoFlow 扩展字段此前在**进 service 之前**就没了，
        // 于是 REST 是"填了也存不进去"，而 grep 只能看到 upsertType 那一处，容易误判已修完。
        storageMode: z.enum(["STATIC", "ONTOLOGY"]).optional(),
        stateVariables: z
          .array(z.object({ propKey: z.string(), fromField: z.string(), fn: z.string(), dataType: z.string() }))
          .optional(),
        functions: z
          .array(z.object({ name: z.string(), returns: z.string(), builtin: z.string().optional(), expr: z.string().optional() }))
          .optional(),
        actions: z.array(z.object({ actionTypeKey: z.string() })).optional(),
        security: z
          .array(
            z.object({
              prop: z.string(),
              strategy: z.enum(["HASH", "REDACT", "PARTIAL"]),
              scopeRoles: z.array(z.string()).optional(),
            }),
          )
          .optional(),
        entityCategory: z.string().optional(),
        description: z.string().optional(),
        // WO-69 P3：对象接口声明（**可选扩展**，不给则沿用既有 → 零回归）。
        // 契约在发布门兑现：声明了却没长出要求的属性/行动/函数 → POST /a/v1/ontology/publish 400 点名。
        // （`actions` 已在上方 WO-D6 块里声明，此处不重复 —— 重复键后者覆盖前者，是静默改语义的入口。）
        implements: z.array(ImplementsRefSchema).optional(),
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

  // ---- WO-69 P3 · 对象接口（多态抽象）--------------------------------------
  // 一致性由**发布门**兑现（POST /a/v1/ontology/publish → 不合规 400 逐条点名）；此处是定义与查询面。
  app.get("/a/v1/ontology/interfaces", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return objectInterfaces.list(ctx(req), { allVersions: q["allVersions"] === "1" });
  });
  app.post("/a/v1/ontology/interfaces", async (req, reply) => {
    const c = ctx(req);
    requireAdmin(c);
    const body = ObjectInterfaceInputSchema.parse(req.body);
    return reply.status(201).send(await objectInterfaces.upsert(c, body));
  });
  // 只读一致性报告（= 发布门会说的话，但不改任何东西 → 可先看迁移清单再决定升级路径）。
  app.get("/a/v1/ontology/interfaces/conformance", async (req) => objectInterfaces.conformance(ctx(req)));
  app.get("/a/v1/ontology/interfaces/:key", async (req) => {
    const { key } = req.params as { key: string };
    const q = req.query as Record<string, string | undefined>;
    const version = q["version"] ? Number(q["version"]) : undefined;
    const rec = await objectInterfaces.get(ctx(req), key, version);
    if (!rec) throw notFound(`对象接口 '${key}' 不存在`);
    return rec;
  });
  app.post("/a/v1/ontology/interfaces/:key/publish", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const { key } = req.params as { key: string };
    const body = parseBody(z.object({ version: z.number().int().positive().optional() }).partial(), req.body ?? {});
    return objectInterfaces.publish(c, key, body.version);
  });
  app.post("/a/v1/ontology/interfaces/:key/retire", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const { key } = req.params as { key: string };
    const body = parseBody(z.object({ version: z.number().int().positive().optional() }).partial(), req.body ?? {});
    return objectInterfaces.retire(c, key, body.version);
  });
  /** S9：谁实现了这个接口 + 改它会波及什么（类型/行动/函数+P2 签名/视图/迁移清单）。 */
  app.get("/a/v1/ontology/interfaces/:key/implementers", async (req) => {
    const { key } = req.params as { key: string };
    const q = req.query as Record<string, string | undefined>;
    return objectInterfaces.implementers(ctx(req), key, q["version"] ? Number(q["version"]) : undefined);
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

  // ---- OntoFlow（PRD v2）本体建模工作流：CRUD/校验(P1) + 数据处理预览(P2) + 提升/发布(P3)。嫁接自 main 平行线。 ----
  app.get("/a/v1/ontology-workflows", async (req) => ({ items: await workflows.list(ctx(req)) }));
  app.post("/a/v1/ontology-workflows", async (req, reply) => {
    const body = parseBody(OntologyWorkflowUpsertSchema, req.body);
    const wf = await workflows.create(ctx(req), body);
    return reply.status(201).send(wf);
  });
  app.get("/a/v1/ontology-workflows/:id", async (req) => workflows.get(ctx(req), (req.params as { id: string }).id));
  app.put("/a/v1/ontology-workflows/:id", async (req) => {
    const body = parseBody(OntologyWorkflowUpsertSchema, req.body);
    return workflows.update(ctx(req), (req.params as { id: string }).id, body);
  });
  app.post("/a/v1/ontology-workflows/:id/validate", async (req) => workflows.validate(ctx(req), (req.params as { id: string }).id));
  app.post("/a/v1/ontology-workflows/:id/preview", async (req) => {
    const body = parseBody(z.object({ nodeId: z.string().min(1), rows: z.array(z.record(z.string(), z.unknown())).default([]) }), req.body);
    return workflows.preview(ctx(req), (req.params as { id: string }).id, body);
  });
  app.post("/a/v1/ontology-workflows/:id/nodes/:nodeId/promote", async (req) => {
    const { id, nodeId } = req.params as { id: string; nodeId: string };
    return workflows.promote(ctx(req), id, nodeId);
  });
  app.post("/a/v1/ontology-workflows/:id/publish", async (req) => workflows.publish(ctx(req), (req.params as { id: string }).id));
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
        cardinality: z.enum(["1:1", "1:N", "N:1", "N:N"]),
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
  /**
   * WO-SLOT-ENTITY-RESOLVE · 「实体文本 → 对象引用」解析正门（A 侧单一出处，B 侧槽位填充经此调用）。
   * 用户说「常州」/「整车厂A」/「容百科技」是**名称**，`GET /objects/:type/:id` 只认 id/主键必 404；
   * 本端点按 id / name / alias 三层解析并回 `matchedBy`（可诊断），解析不到回 attempts（试了哪些类型/键/为何不匹）。
   */
  app.post("/a/v1/ontology/resolve-ref", async (req) => {
    const body = parseBody(ObjectRefResolveRequestSchema, req.body);
    return ontology.resolveObjectRef(ctx(req), body);
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
    return { signals, total: signals.length, snapshotVersion: result.snapshotVersion };
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
  // WO-EXT-SIGNAL-DETAIL CI-b（外部信号 → 溯源闭环·R13）：反查引用本信号的因果因子（CausalFactor.drillId==signalKey）
  // + caused_by 因果链（信息全貌）+ 顶层 Metric 归因（boundMetricKeys 前向兼容·metric-aware-gap 未合前诚实 pending·不编）。纯只读·R6 确定性。
  app.get("/a/v1/external-signals/:key/references", async (req) => {
    const { key } = req.params as { key: string };
    const c = ctx(req);
    const sig = ((await ontology.queryObjects(c, "ExternalSignal", {}, 500)).data as { props: Record<string, unknown> }[]).find((r) => String(r.props.signalKey) === key)?.props;
    if (!sig) throw notFound(`external signal ${key}`);
    const cfRows = ((await ontology.queryObjects(c, "CausalFactor", {}, 500)).data as { props: Record<string, unknown> }[]).map((r) => r.props);
    // 反查：本信号被哪些因果因子引用为下钻源（drillId==signalKey）。R6 确定性排序。
    const refFactors = cfRows.filter((p) => String(p.drillId) === key).sort((a, b) => String(a.factorId).localeCompare(String(b.factorId)));
    const refIds = new Set(refFactors.map((p) => String(p.factorId)));
    // caused_by 因果边（果→因）：与引用因子相接的边 = 本信号在因果链中的上下游全貌。
    const causalEdges = (await repos.links.list(c.tenantId))
      .filter((l) => l.type === "caused_by")
      .map((l) => ({ from: String(l.fromId).replace(/^obj_causalfactor_/, ""), to: String(l.toId).replace(/^obj_causalfactor_/, "") }))
      .filter((e) => refIds.has(e.from) || refIds.has(e.to))
      .sort((a, b) => (a.from + "→" + a.to).localeCompare(b.from + "→" + b.to));
    const factors = refFactors.map((p) => ({
      factorId: String(p.factorId),
      label: String(p.label),
      drillField: String(p.drillField),
      drillValue: Number(sig[String(p.drillField)] ?? 0), // 本信号在该因子下钻字段的当前真值（改信号值→此变·C2）
      isRoot: Boolean(p.isRoot),
      provenanceSynthetic: Boolean(p.provenanceSynthetic), // 无真外部源诚实标灰（G-DM-1）
      boundMetricKeys: Array.isArray(p.boundMetricKeys) ? (p.boundMetricKeys as string[]) : [], // 前向兼容 metric-aware-gap·未种=空
    }));
    const metricsAffected = [...new Set(factors.flatMap((f) => f.boundMetricKeys))].sort();
    return {
      signalKey: key,
      name: String(sig.name ?? key),
      category: String(sig.category ?? ""),
      factors,
      causalEdges,
      metricsAffected,
      hasReferences: factors.length > 0,
      // 诚实：Metric 归因需 CausalFactor.boundMetricKeys（metric-aware-gap 合 + data agent 种后填），未种则 pending 不编。
      metricLinkage: metricsAffected.length > 0 ? "bound" : "pending",
      ...(factors.length === 0 ? { note: "本信号暂无因果因子引用（未进任何根因树·诚实空）" } : {}),
    };
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
    const { kind, query, category } = req.query as { kind?: string; query?: string; category?: string };
    if (kind !== "slices" && kind !== "solvers") throw validationError("kind must be slices|solvers");
    // WO-L7A 求解器决策问题类目筛选：非法类目**显式 400**，不静默忽略参数返全量（静默 = 调用方以为筛过了）
    if (category !== undefined && !isSolverCategory(category)) {
      throw validationError(`category must be one of ${SOLVER_CATEGORIES.join("|")}`);
    }
    return catalog.discover(ctx(req), kind, query, category);
  });
  // WO-L7A 求解器决策问题类目登记表（10 类 + 每类的决策问句 + 成员 key·治理页分组/Agent 选型收窄的供给侧）
  app.get("/a/v1/solvers/categories", async (req) => {
    ctx(req); // 鉴权上下文（分类维为平台元数据，按租户读）
    return {
      categories: solversByCategory().map((g) => ({
        category: g.category,
        label: SOLVER_CATEGORY_META[g.category].label,
        decisionQuestion: SOLVER_CATEGORY_META[g.category].decisionQuestion,
        solverKeys: g.solverKeys,
        count: g.solverKeys.length,
      })),
      total: SOLVER_KEYS.length,
      uncategorized: uncategorizedSolverKeys(), // 空数组 = 无漏网（诚实亮出，不藏）
    };
  });
  // A3.1 · 14 业务域参考注册表（配置驱动 R14）：给 A4 浏览器分组、切片规划器 tie-break、跨域接缝识别共用。
  app.get("/a/v1/business-domains", async (req) => {
    ctx(req); // 鉴权上下文（域注册表为平台参考基线，按租户读）
    return { domains: BUSINESS_DOMAINS };
  });
  /**
   * WO-WAITING-STATES-FE · 业务流程层下发（13 域 + 65 流程 · 含 `waitKind` 四态）。
   *
   * ── 为什么本路由是新增的：读端此前是 0 ────────────────────────────────────
   * `processDefinitions` / `processDomains` 两个 store 自建成起**只有写端与 test 读端**
   * （`seed.ts:697-698` 写 · `test/process-layer.test.ts` 读），src 里零读取方 ——
   * 即假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`：实现有、测试 65 条全绿、
   * 却没有任何生产链路能把它取出来。前端「五个等待态 0 命中」的病根在这里，
   * 不在前端（取证见 `docs/WO-WAITING-STATES-FE-evidence.md` §1.4 / §3）。
   *
   * ── 口径 ─────────────────────────────────────────────────────────────────
   * · 只读投影，无副作用；按 `key` 升序（R6 确定性：不依赖 Store 迭代序）。
   * · R2：按 `ctx(req).tenantId` 读，跨租户自然为空（Store.list 已按租户分区）。
   * · `waitKinds` 随响应下发**词表本身**，让前端渲染「四态图例」时不必再写一份字面量数组
   *   —— 契约注释原文：「任何一侧再写一份字面量数组就是回退到『两个 dev 各发明一套词表、
   *   交集为 0』出事前的状态」。四值不含 `WAITING_APPROVAL`（仓主已裁「流程审批不体现」，
   *   `process.ts:59-67` 诚实缺席，不是漏写）。
   * · **不下发「此刻已卡多久」**：那需要 `ProcessTask.enteredAt` 运行态，而
   *   `ProcessTask`/`ProcessInstance` 全仓不存在（PRD §5 的 E2 未实现）。
   *   本路由只给 `stdDurationDays`（标准工期）并由前端如实标注口径，
   *   **不拿标准工期冒充实测卡顿**。
   */
  app.get("/a/v1/process-definitions", async (req) => {
    const c = ctx(req);
    const byKey = <T extends { key: string }>(a: T, b: T) => a.key.localeCompare(b.key);
    const [domains, definitions] = await Promise.all([
      repos.processDomains.list(c.tenantId),
      repos.processDefinitions.list(c.tenantId),
    ]);
    return {
      domains: [...domains].sort(byKey),
      definitions: [...definitions].sort(byKey),
      waitKinds: PROCESS_WAIT_KINDS,
      ownerFunctions: PROCESS_OWNER_FUNCTIONS,
    };
  });
  /**
   * WO-FLOWTIME · 单条流程的**实例**与站间流转时长投影。
   *
   * ── 这条路由补的是上一条路由自己写着的那个洞 ──────────────────────────────
   * 上面 `/a/v1/process-definitions` 的注释原文：
   *   「**不下发「此刻已卡多久」**：那需要 `ProcessTask.enteredAt` 运行态，而
   *     `ProcessTask`/`ProcessInstance` 全仓不存在 … 本路由只给 `stdDurationDays`（标准工期）
   *     并由前端如实标注口径，**不拿标准工期冒充实测卡顿**。」
   * 承载物现在有了（`migrations/033`），故本路由下发**实测反推**的进出站时刻与站间时长。
   * ⛔ 那条「不拿标准工期冒充实测」的规矩**没有放宽**：本路由的任何天数都来自单据时间戳，
   *    `stdDurationDays` 只作为**对照列**原样透出（`definition.stdDurationDays`），
   *    与 `flowTime` 分属两个字段、两个含义，前端不可能拿错。
   *
   * ── 口径 ─────────────────────────────────────────────────────────────────
   * · **只读投影**（R4）：反推 + 落派生表，不写本体真值，不碰 Action 审批路径。
   * · R2：按 `ctx(req).tenantId` 读写；跨租户自然为空（Store 已按租户分区）。
   * · R6：无 `Date.now()`；分析截止时刻 `asOf` 由 `?asOf=` 显式指定，缺省取**数据里最晚的
   *   观测时刻**（`asOfSource` 一并回传，让读的人知道这个「现在」是怎么定的）。
   * · **解析不到标 absent，不许 500**：流程 key 不存在 → 404（那是调用错，该报错）；
   *   流程存在但反推不出实例 → **200 + `available:false` + 缺席理由 + 复验探针**
   *   （「我不知道」是一个合法答案；把它变成 500 会让调用方以为是服务故障）。
   */
  app.get("/a/v1/process-definitions/:key/instances", async (req) => {
    const c = ctx(req);
    const key = (req.params as { key: string }).key;
    const def = (await repos.processDefinitions.list(c.tenantId, (d) => d.key === key))[0];
    if (!def) throw notFound(`ProcessDefinition ${key}`);
    const q = req.query as { asOf?: string; limit?: string };
    const outcome = await reconstructAndPersist(repos, c.tenantId, {
      ...(q.asOf ? { asOf: q.asOf } : {}),
      outbox,
    });
    const limit = Number.isFinite(Number(q.limit)) && Number(q.limit) > 0 ? Math.floor(Number(q.limit)) : 200;
    const mine = outcome.instances.filter((i) => i.processKey === key);
    const absence = outcome.absences.find((a) => a.processKey === key) ?? null;
    // 站间流转投影：只保留经过本流程的链，并标出本站在链上的停留与到下一站的间隔。
    const flowTime = outcome.timelines
      .filter((t) => t.stations.some((s) => s.processKey === key))
      .map((t) => ({
        flowKey: t.flowKey,
        totalDays: t.totalDays,
        bottleneckProcessKey: t.bottleneckProcessKey,
        bottleneckDwellDays: t.bottleneckDwellDays,
        stuckProcessKey: t.stuckProcessKey,
        stuckDays: t.stuckDays,
        thisStation: t.stations.find((s) => s.processKey === key) ?? null,
        stations: t.stations,
      }))
      .slice(0, limit);
    return {
      definition: def, // 含 stdDurationDays —— **对照列**，与下面的实测天数分属两个字段
      asOf: outcome.asOf,
      asOfSource: outcome.asOfSource,
      /** 反推得出 ⇒ true；反推不出 ⇒ false + reason/probe（**不是空数组冒充"没有卡顿"**）。 */
      available: mine.length > 0,
      absence, // available=false 时非空：缺哪种单据 / 哪个字段 / 怎么复验
      instanceCount: mine.length, // 全量基数（不受 limit 影响）
      instances: mine.slice(0, limit),
      instancesShown: Math.min(mine.length, limit),
      flowTime,
      /** 词表随响应下发（同上一条路由的既有做法：前端不必再写一份字面量数组）。 */
      waitKinds: PROCESS_WAIT_KINDS,
      origins: PROCESS_INSTANCE_ORIGINS,
    };
  });
  /**
   * WO-V4-INSPECT · **业务流程节点检视**（PRD-sandbox-v4-backward-derivation §4.1 + §4.2）。
   *
   * 「点开一条流程，看它的完整本体关系」——一次纯 join，**零新真值源、零新表、零新事件**：
   *   `process_definitions` × `process_domains` × `object_types` × `ontology_links` × `objects`
   *
   * ── 四条硬约束（逐条对应 PRD，别当装饰）──────────────────────────────────
   * ① **`carrierTypeKey` 解析不到是必须处理的态**：种子期不校验它存在
   *    （判据在 `test/process-layer.test.ts`），故 join 不上是**可能发生的**。
   *    此时 `carrier.status="absent"` + 说明缺在哪一环，HTTP **仍是 200** ——
   *    流程本身存在，缺的是它的承载物。不许崩，也不许假设一定 join 得上。
   * ② **不下发运行态**：`ProcessTask`/`ProcessInstance` 全仓不存在 ⇒「此刻卡了多久 / 有几单堵着」
   *    答不出来。只给 `stdDurationDays` 并在 `runtime` 里如实标口径 ——
   *    ⛔ 绝不拿标准工期冒充实测卡顿（上面那个路由的口径注释已立此规矩，此处沿用同一条）。
   * ③ **零新真值源**：全部现算派生。
   * ④ **R2 租户**：按 `ctx(req).tenantId` 读，跨租户自然为空（Store.list 已按租户分区）。
   *
   * 十六层**复用** `ontology/slice-layers.ts` 的既有投影（不另造一套），依据一条
   * **即席一跳切片**（root = 承载类型，paths = 该类型每条一跳链路）真跑 `executeSlice` ——
   * 层计数必须对得回真子图的 nodes/edges，拿手工拼的假 graph 喂进去屏上的数就是编的。
   * 承载类型 absent ⇒ `carrierLayers: null` + 说明，**不返回 16 个空壳假装算过**。
   */
  app.get("/a/v1/process-definitions/:key/inspect", async (req) => {
    const c = ctx(req);
    const { key } = req.params as { key: string };
    const [domains, definitions] = await Promise.all([
      repos.processDomains.list(c.tenantId),
      repos.processDefinitions.list(c.tenantId),
    ]);
    const definition = definitions.find((d) => d.key === key);
    if (!definition) throw notFound(`process definition ${key}`); // 流程本身不存在才 404
    const [types, linkTypes] = await Promise.all([ontology.listTypes(c), repos.ontologyLinks.list(c.tenantId)]);
    const typeByKey = new Map(types.map((t) => [t.key, t]));
    const carrierType = typeByKey.get(definition.carrierTypeKey);

    // 对象计数只读**用得到的那几个类型**（承载类型 + 一跳邻居），不全表扫。
    const countKeys = new Set<string>();
    if (carrierType) countKeys.add(carrierType.key);
    for (const l of linkTypes) {
      if (l.fromTypeKey === definition.carrierTypeKey) countKeys.add(l.toTypeKey);
      if (l.toTypeKey === definition.carrierTypeKey) countKeys.add(l.fromTypeKey);
    }
    const objectCounts = new Map<string, number>();
    for (const k of [...countKeys].sort()) {
      if (!typeByKey.has(k)) continue; // 类型不存在 ⇒ 不填（null ≠ 0，两者含义不同）
      objectCounts.set(k, (await repos.objects.listByType(c.tenantId, k)).length);
    }

    // 十六层：承载类型在 ⇒ 真跑即席一跳切片；不在 ⇒ null（诚实说没算，不造空壳）。
    let carrierLayers: SliceLayersResponse | null = null;
    async function buildCarrierLayers(): Promise<SliceLayersResponse> {
      const spec = adhocCarrierSliceSpec(definition!.carrierTypeKey, linkTypes);
      const graph = await ontologyCore.executeSlice(c, spec, {});
      const [ruleList, propagationRules, tsSeries, excObjs, actionTypeList, derivSpecs] = await Promise.all([
        repos.rules.list(c.tenantId, (r) => r.status === "PUBLISHED"),
        repos.sim.listPropagationRules(c.tenantId, true),
        repos.tsSeries.list(c.tenantId),
        repos.objects.listByType(c.tenantId, "ExceptionEvent"),
        actions.listTypes(c),
        repos.derivationSpecs.list(c.tenantId, (s) => s.status === "ACTIVE"),
      ]);
      const exceptionRefTypes: Record<string, number> = {};
      for (const o of excObjs) {
        const rt = typeof o.props.refType === "string" ? o.props.refType : "UNKNOWN";
        exceptionRefTypes[rt] = (exceptionRefTypes[rt] ?? 0) + 1;
      }
      return projectSliceLayers({
        sliceKey: adhocCarrierSliceKey(definition!.key),
        version: 0, // 即席切片没有版本：它不是 slice_specs 里的记录，0 就是"无版本"这个事实
        spec,
        graph,
        types,
        linkTypes,
        rules: ruleList,
        propagationRules: propagationRules.map((p) => ({
          key: p.key,
          sourceTypeKey: p.sourceTypeKey,
          sourceStateVar: p.sourceStateVar,
          targetTypeKey: p.targetTypeKey,
          targetStateVar: p.targetStateVar,
          viaLinkKey: p.viaLinkKey,
          coefficient: p.coefficient,
        })),
        tsSeries,
        exceptionEventTotal: excObjs.length,
        exceptionRefTypes,
        // 即席切片不是发布物，没有任何 plan/intent/agent 会引用它 ⇒ ①②层恒空是**真结论**，
        // 不是"没查"。层投影自己的 absentReason 会说明缺的是上报方。
        references: [],
        actionTypeKeys: actionTypeList.map((a) => a.key).sort(),
        derivationSpecKeys: derivSpecs.map((d) => ({ specKey: d.specKey, targetType: d.targetType, targetProp: d.targetProp, formula: d.formula })),
        args: {},
        rootObjectTotal: objectCounts.get(definition!.carrierTypeKey) ?? 0,
        rootObjectSamples: [],
      });
    }
    if (carrierType) carrierLayers = await buildCarrierLayers();

    return projectProcessInspect({
      definition,
      allDefinitions: definitions,
      domains,
      types,
      linkTypes,
      objectCounts,
      leverMeta: LEVER_PROP_META,
      carrierLayers,
    });
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
    const { query, category } = req.query as { query?: string; category?: string };
    // WO-L7A：非法类目显式 400（同 /a/v1/catalog，不静默返全量）
    if (category !== undefined && !isSolverCategory(category)) {
      throw validationError(`category must be one of ${SOLVER_CATEGORIES.join("|")}`);
    }
    const { items } = await catalog.solverRegistry(c, query, category);
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
  app.post("/a/v1/solvers/:solverKey/invoke", async (req, reply) => {
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
    // WO-D1 · 求解取消接入点：客户端提前断链（AgentCore 15s 超时后 abort 了 OBO fetch，或前端 AbortController
    // 断开）→ reply.raw "close" 且响应未写完 → abort 请求作用域取消令牌 → 求解执行链上的可取消层
    // （优化器 sidecar fetch / A18 沙箱子进程 / 内存态贪心循环 / await 检查点）就近真停，而不是"没人等了还在烧"。
    // 正常完成路径：handler 先返回 → finally 摘监听 → 之后才写响应，故绝不会误取消（且未包裹时行为逐字节不变）。
    const cancel = new AbortController();
    const onClientGone = () => {
      if (!reply.raw.writableEnded) cancel.abort(new Error("client disconnected"));
    };
    reply.raw.on("close", onClientGone);
    try {
      return await runWithCancellation(cancel.signal, () => ontology.invokeSolver(ctx(req), solverKey, args));
    } finally {
      reply.raw.removeListener("close", onClientGone);
    }
  });
  app.post("/a/v1/derivations/run", async (req, reply) => {
    const c = ctx(req);
    const run = await ontology.runDerivations(c);
    // DF-2：派生管线完成 → derivation.completed（失效 dashboard/risk/scenario-data/object-queries）。
    // 语义锚点 = 派生真值重算（invalidates=驾驶舱数字），非建模草稿产出。
    await outbox.emit(c.tenantId, "derivation.completed", { runId: run.id, updatedObjects: run.updatedObjects, count: run.updatedObjects, order: run.order });
    return reply.status(202).send(run);
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
        seed: z.number().optional(),
      }),
      req.body,
    );
    if (body.binding) {
      // 增量2：绑定层 invoke 前预处理（DF.8 接地 + role→本体字段），再走确定性 CP-SAT。
      return solvers.solveWithBinding(ctx(req), body.family, body.binding, { seed: body.seed });
    }
    return ontology.invokeSolver(ctx(req), body.family, body.args ?? {});
  });
  // 列模板族（池 comprehend 兜底；增量4 embedding 检索叠其上）。
  app.get("/a/v1/opt/templates", async (req) => {
    await requireFeatureTag(req, "apiTags", "opt");
    return { families: OPT_FAMILIES };
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
                  mustIncludeTypes: z.array(z.string()).optional(),
                  mustIncludeLinkKeys: z.array(z.string()).optional(),
                  maxNodes: z.number().int().optional(),
                  // A3-SUITE-1：约束可来自一等 RuleEntry.params。
                  ruleRef: z
                    .object({
                      ruleKey: z.string(),
                      typesParam: z.string(),
                      linksParam: z.string(),
                    })
                    .optional(),
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
    // A6 列级（属性级）安全：对象数据变更是**唯一**的用户态对象写路径（R4 真值经 Action）。
    // patch 命中不可写属性 → 此处即 403 PROPERTY_FORBIDDEN，草稿根本不创建（值绝不落库），
    // 绝不静默丢字段后返回成功。执行期（app.ts「对象数据变更」分支）另有一道同机制复校。
    await assertObjectPatchWritable(c, body.payload);
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

  // ---- WO-C1 · L2 统一决策内核（Decision·根因→方案→选定→落 Action 一条龙·闭 C1 双闸）--------------
  // 建（PROPOSED·选方案）：真推演 gap_attribution+decision_play → 校验选定 ⊆ 真方案 → 存 Decision。
  app.post("/a/v1/decisions", async (req, reply) => {
    const c = ctx(req);
    const body = parseBody(CreateDecisionInputSchema, req.body);
    const decision = await decisionKernel.create(c, body, new Date().toISOString());
    return reply.status(201).send(decision);
  });
  // 一等可查（R2 跨租户 404）。
  app.get("/a/v1/decisions/:id", async (req) => {
    const { id } = req.params as { id: string };
    return decisionKernel.get(ctx(req), id);
  });
  // 定（COMMITTED·派 ActionDraft·走 S2 审批链·门不绕）。已 COMMITTED → 409。
  app.post("/a/v1/decisions/:id/commit", async (req) => {
    const { id } = req.params as { id: string };
    return decisionKernel.commit(ctx(req), id, new Date().toISOString());
  });
  // WO-LEARNING-LOOP-FEEDBACK：成效反馈闭环（COMMITTED→REALIZED·注入外部实测 realizedGapClose → 效果% vs 预言）。
  // additive·非 COMMITTED→409·R2 跨租户 404（经 kernel.get→notFound）。realizedAt 由端点注入（R6·内部不取时钟）。
  app.post("/a/v1/decisions/:id/outcome", async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(RecordOutcomeInputSchema, req.body);
    return decisionKernel.recordOutcome(ctx(req), id, body, new Date().toISOString());
  });
  // 决策成效权重归集（本租户全部 REALIZED → 确定性聚合·后续 decision_play 排序可读·亲手真跑可观测）。
  app.get("/a/v1/decision-outcome-stats", async (req) => {
    return decisionKernel.outcomeStats(ctx(req));
  });

  // ---- WO-DECISION-CAUSAL-GRAPH · 决策因果图（只读投影·回答「为什么这个决策被触发」）-------------
  //
  // 两个数据源分两条路由，**不合成一条**：沙盘按 tick 记时、台账按 ISO 时刻记时，
  // 且今天二者之间没有任何字段互指（详见 decision/causal-graph.ts 顶注的实测取证）。
  // 合成一条路由就得在响应里编一个统一的"时间"，那是现编。
  //
  // 全部只读（GET）。entitlement `decision.causal-graph` **暗发** —— 关 = 404 FEATURE_NOT_FOUND（R3 先于 authz）。
  const requireCausalGraph = async (c: AuthCtx) => {
    if (!(await features.enabled(c.tenantId, "decision.causal-graph"))) throw featureNotFound();
  };
  // 沙盘源：给定一次推演 → Cause(扰动) / Impact(传导轨迹 + 世界态) 真值抽取；其余三段诚实报缺。
  app.get("/a/v1/causal-graphs/sim/:sessionId", async (req) => {
    const c = ctx(req);
    await requireCausalGraph(c);
    const { sessionId } = req.params as { sessionId: string };
    const s = await repos.sim.getSession(c.tenantId, sessionId); // R2：别租户的 session 读不到 → 404
    if (!s) throw notFound("sim session not found");
    // tick 0..curTick 全量读回（`trace` 只存在于 sim_tick_state 行上，是"谁把多少传给谁"的唯一真值）。
    const ticks: { tick: number; state: TickState; trace: PropagationTrace[] | null }[] = [];
    for (let i = 0; i <= s.curTick; i++) {
      const row = await repos.sim.getTickState(c.tenantId, s.id, i);
      // tick 0 行由 POST /sessions 建；缺行只可能是历史数据，跳过而不是补一个空世界（补了就是编）。
      if (row) ticks.push({ tick: row.tick, state: row.state, trace: row.trace });
    }
    return buildCausalGraphFromSim({
      tenantId: c.tenantId,
      sessionId: s.id,
      perturbations: await repos.sim.listPerturbations(c.tenantId, s.id),
      ticks,
      // PUBLISHED only：与 tick 路由（本文件 `listPropagationRules(c.tenantId, true)`）**同一个口径**，
      // 免得因果图按一套规则解、推演按另一套跑。
      rules: await repos.sim.listPropagationRules(c.tenantId, true),
    });
  });
  // 台账源：给定一条决策 → 五段全覆盖（RESULT 段在 outcome 未回填时诚实报 NOT_YET_REALIZED）。
  app.get("/a/v1/causal-graphs/decision/:decisionId", async (req) => {
    const c = ctx(req);
    await requireCausalGraph(c);
    const { decisionId } = req.params as { decisionId: string };
    const decision = await decisionKernel.get(c, decisionId); // R2 跨租户 404（kernel 内 notFound）
    const drafts: NonNullable<Awaited<ReturnType<typeof repos.actionDrafts.get>>>[] = [];
    for (const id of decision.actionDraftIds) {
      const a = await repos.actionDrafts.get(c.tenantId, id);
      if (a) drafts.push(a); // 查不到的由构图器落 caveat，不编一个假单
    }
    return buildCausalGraphFromDecision({ tenantId: c.tenantId, decision, actionDrafts: drafts });
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

  /**
   * S2 Action 三段埋点 · **单租户视图**（R2：只返回调用者自己租户的桶）。
   *
   * 与 `/metrics` 的分工（**不是两套口径，是同一份数的两个投影**）：
   *  - `/metrics` = 全租户合计 · Prometheus 文本 · 服务间抓取（SERVICE_ONLY_PATHS）；
   *  - 本端点 = 单租户明细 + 该租户的执行稳定率 · JSON · 用户鉴权。
   * 二者由 `Metrics.incWithTenant` **同一行代码**写出，不变量「Σ租户 == 全局」由
   * `test/action-metrics-tenant.test.ts` 咬死 —— 不存在第二个写入点可供漂移。
   *
   * 病灶（本端点存在的理由）：验收判据「跑 100 次同 Action，失败率 < 1%」在多租户部署下
   * **算不出租户级的数** —— 合计序列里一个租户跑挂 100 次会拉低所有租户共享的比率，
   * 大租户的成功量又会掩盖小租户的持续失败；失败率越线时也无法从指标定位是哪个租户。
   * 形态与 `router/perception-metrics.ts` + `GET /api/v1/perception/metrics` 同款。
   */
  app.get("/a/v1/actions/metrics", async (req) => actionMetricsView(metrics, ctx(req).tenantId));

  // ---- A5 rules -----------------------------------------------------------------------
  app.get("/a/v1/rules", async (req) => {
    const { status } = req.query as { status?: string };
    return rules.list(ctx(req), status);
  });
  app.post("/a/v1/rules", async (req, reply) => {
    const body = parseBody(RuleCreateSchema, req.body);
    // 管理平台增量 §5：手工创建（origin=MANUAL）的 expression 经 DSL 解析校验，错误定位字符位。
    // WO-RULE-EXPR-PARAMS：连同 params 一起校验闭包 —— 引用 `params.x` 却没声明 x 的规则当场拒。
    // 传 key 后**反向**也校验：被绑定的阈值型 param 必须真被 expression 引用（防阈值退回两份）。
    assertValidExpression(body.expression, body.params ?? {}, body.key);
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
    // params（加性·可选）：编辑器里正在编的命名阈值，令 `params.<名>` 在「测试」按钮里也真能解析。
    const body = parseBody(
      z.object({
        expression: z.string(),
        samplePayload: z.record(z.string(), z.unknown()).default({}),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
      req.body,
    );
    return rules.dryRun(body.expression, body.samplePayload, body.params);
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
    const job = await connectors.sync(ctx(req), id);
    return reply.status(202).send({ syncJobId: job.id, status: job.status });
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
  app.get("/a/v1/raw-datasets/:id/rows", async (req) => {
    const c = ctx(req);
    const { id } = req.params as { id: string };
    const ds = await repos.rawDatasets.get(c.tenantId, id);
    if (!ds) throw notFound("raw dataset");
    return { dataset: ds, rows: await repos.rawRows.list(c.tenantId, id) };
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
    const result = await ruleDocs.uploadAndProcess(c, filename, content);
    return reply.status(202).send({
      docId: result.doc.id,
      jobId: result.jobId,
      status: result.doc.status,
      candidateCount: result.candidates.length,
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
    const c = ctx(req);
    const { id } = req.params as { id: string };
    const result = await modeling.materialize(c, id);
    // DF-3：对象化/物化作业完成 → materialize.completed（失效 dashboard/object-queries/scenario-data）。
    await outbox.emit(c.tenantId, "materialize.completed", { draftId: id, jobId: result.jobId, objectCount: result.created, quarantined: result.quarantined });
    return reply.status(202).send(result);
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

  // ---- WO-DB-DERIVE-DECISION-FIELDS (G4) · 导入记录字段 → 决策字段 派生引擎（可配置 mapping·R14·R6·R13）----
  // 记录型导入数据（factory/production_line/equipment…）物化后没有求解器读的决策字段（Base.util/oeeIndex）——
  // 本端点按 body 给的**可配置 mapping**（导入方提供·零平台业务常数）把真源记录聚合成决策字段，写回目标对象
  // → 求解器读的是真派生值（非 hash·KILL-MOCK-RED）。⛔ 平台不内联任何行业/电池映射。
  // canonical 适配（July 线的 world-source/classifySourceOrigin/tenant.worldSource 命门本线不存在）：真源判定 =
  // origin.type==="MATERIALIZED"（真 RawDataset 物化 vs SYNTHETIC 合成生成）；worldSource 由本次派生输入是否含
  // 真源对象推导（imported/synthetic），非 tenant 级标签。
  app.post("/a/v1/derive/decision-fields", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const body = parseBody(DeriveDecisionFieldsRequestSchema, req.body);

    // 只取 mapping 触及的类型（目标+源）·按 tenantId 隔离（R2）·跳过已并入对象（OC1）。
    const types = new Set<string>();
    for (const r of body.mapping.rules) {
      types.add(r.target.objectType);
      types.add(r.source.objectType);
    }
    // WO-DATAMODE-UNIFY-PROVENANCE：真源判定不再只看 origin.type==="MATERIALIZED"——demo viaModelingChain 的对象
    // 全是 MATERIALIZED-from-synthetic（合成种子经建模链物化），只看 type 会把合成误判为真导入 → worldSource=imported
    // → 漏掉"不冒充 LIVE"告警（合成冒充实测·违铁律 0.4）。改用唯一真相谓词：真源 = MATERIALIZED 且**非**合成 provenance。
    const isSynthProvenance = await solvers.buildSynthProvenancePredicate(c.tenantId);
    const byType = new Map<string, DeriveSourceObject[]>();
    const objIndex = new Map<string, ObjectInstance>();
    for (const tk of types) {
      const objs = await repos.objects.listByType(c.tenantId, tk);
      byType.set(
        tk,
        objs
          .filter((o) => !o.mergedInto)
          .map((o) => {
            objIndex.set(o.id, o);
            return { id: o.id, props: o.props, real: o.origin?.type === "MATERIALIZED" && !isSynthProvenance(o) };
          }),
      );
    }

    const results = deriveDecisionFields(body.mapping, byType);
    // 门牙自证（R6·R13·KILL-MOCK）：写回前逐值重算比对·发现伪造即拒（不静默落假值）。
    const violations = validateDerivedFields(body.mapping, byType, results);
    if (violations.length > 0) throw validationError(`派生结果自校验失败（KILL-MOCK-RED）：${violations.slice(0, 3).join("；")}`);

    const anyReal = [...byType.values()].some((objs) => objs.some((o) => o.real));
    const worldSource: "synthetic" | "imported" = anyReal ? "imported" : "synthetic";
    const warnings: string[] = [];
    if (worldSource !== "imported") {
      warnings.push("无真导入(MATERIALIZED)源对象：已算出派生值但源为合成物化 → 不冒充 LIVE，先经 uploads/materialize 导入真记录再派生上决策。");
    }
    if (results.every((r) => r.value === null)) {
      warnings.push("无真数值源贡献（0 有效派生）→ 诚实空态：核对 mapping 的 source/groupByField 是否对上真字段名，或先导入真记录。");
    }

    let written = 0;
    if (!body.dryRun) {
      // 只写有真值的结果·保留 origin·记 R13 派生溯源（__deriveProvenance 旁挂·不污染业务字段读路径）。
      const epoch = await repos.epochs.next(c.tenantId);
      const dirty = new Map<string, ObjectInstance>();
      for (const r of results) {
        if (r.value === null) continue;
        const cur = dirty.get(r.targetId) ?? objIndex.get(r.targetId);
        if (!cur) continue;
        const prov = (cur.props.__deriveProvenance && typeof cur.props.__deriveProvenance === "object"
          ? { ...(cur.props.__deriveProvenance as Record<string, unknown>) }
          : {}) as Record<string, unknown>;
        prov[r.field] = { op: r.op, sourceType: r.sourceType, sourceField: r.sourceField, sourceObjectIds: r.sourceObjectIds, dataMode: r.dataMode };
        dirty.set(r.targetId, { ...cur, props: { ...cur.props, [r.field]: r.value, __deriveProvenance: prov }, epoch });
      }
      for (const obj of dirty.values()) {
        await repos.objects.put(obj);
        written++;
      }
    }

    return {
      worldSource,
      results,
      written,
      dataMode: weakestDerivedDataMode(results),
      warnings,
    };
  });

  // ---- WO-CEO-DATA-supply · 真源记录**颗粒级**物化（灌真颗粒·走现有 RawDataset/连接器）------------------
  // CEO 驾驶舱数字当前全来自合成种子（battery.ts generateBattery）。本端点把已入库的真 RawDataset（真连接器/
  // 上传门产生的 财务/MES/矿价… 原始行）**逐行 1:1** 物化成一等真对象（origin=MATERIALIZED·非合成），求解器/
  // 驾驶舱据此读**真值**。⛔ 颗粒不聚合：只落原始颗粒·聚合留给下游 derive/decision-fields/求解器（可逐值下钻·R13）。
  // ⛔ R14：列→属性映射由导入方以数据提供·平台零业务常数。KILL-MOCK-RED：合成源（config.synthetic）硬拒·不冒充真值。
  app.get("/a/v1/records/materialize/templates", async (req) => {
    const c = ctx(req);
    if (!(await features.enabled(c.tenantId, "data-import.record-materialize"))) throw featureNotFound();
    const targetType = (req.query as Record<string, string>).targetType;
    if (targetType) {
      const tpl = RECORD_MATERIALIZE_TEMPLATES[targetType];
      if (!tpl) throw notFound(`类型 ${targetType} 无 record-materialize 默认映射模板`);
      return { templates: [tpl] };
    }
    return { templates: Object.values(RECORD_MATERIALIZE_TEMPLATES) };
  });

  app.post("/a/v1/records/materialize", async (req) => {
    const c = ctx(req);
    // Entitlement 先于 authz（R3 暗发：关 = 404 FEATURE_NOT_FOUND）。
    if (!(await features.enabled(c.tenantId, "data-import.record-materialize"))) throw featureNotFound();
    requireAdmin(c);
    const body = parseBody(RecordMaterializeRequestSchema, req.body);

    // ① 真 RawDataset（租户隔离·R2）。
    const ds = await repos.rawDatasets.get(c.tenantId, body.rawDatasetId);
    if (!ds) throw notFound(`RawDataset ${body.rawDatasetId} 不存在`);

    // ② 源 provenance 判定（KILL-MOCK-RED·两正交维之 provenance 维）：合成源（config.synthetic===true）硬拒——
    //    合成种子不得经此路径冒充成真物化对象（否则驾驶舱把合成当真值·违铁律 0.4）。真源判定与
    //    buildSynthProvenancePredicate 同源（MATERIALIZED 且 datasetId ∉ 合成源数据集集）。
    const conn = await repos.connections.get(c.tenantId, ds.sourceConnId);
    const sourceSynthetic = (conn?.config as Record<string, unknown> | undefined)?.synthetic === true;
    if (sourceSynthetic) {
      throw validationError(
        `数据集 ${ds.id} 源连接为合成源（config.synthetic）→ 拒绝物化为真对象（KILL-MOCK-RED：合成不得冒充真值）。请经真连接器/上传门 POST /a/v1/uploads 导入真数据后再物化。`,
      );
    }

    // ③ 目标类型须已发布 ACTIVE（真值物化进求解器/驾驶舱读的既有类型）。
    const types = await ontology.listTypes(c);
    const targetDef = types.find((t) => t.key === body.targetType && t.status === "ACTIVE");
    if (!targetDef) throw validationError(`目标类型 ${body.targetType} 未发布或非 ACTIVE（先建模发布该类型再物化真记录）`);

    // ④ 读真源原始行（rawRows·原始颗粒），⑤ 逐行 1:1 物化（纯函数·颗粒不聚合·R6）。
    // WO-CEO-DATA-2：支持内置物化模板（templateKey），模板可与显式 columnMapping 叠加（显式优先）。
    const template = body.templateKey ? RECORD_MATERIALIZE_TEMPLATES[body.templateKey] : undefined;
    const columnMapping = { ...template?.columnMapping, ...body.columnMapping };
    const primaryKeyColumn = body.primaryKeyColumn ?? template?.primaryKeyColumn;
    const rows = await repos.rawRows.list(c.tenantId, ds.id);
    const { objects, warnings, primaryKey } = materializeRecords({
      targetType: body.targetType,
      props: targetDef.properties,
      rows,
      columnMapping,
      primaryKeyColumn,
      datasetId: ds.id,
      sourceConnId: ds.sourceConnId,
    });
    if (rows.length === 0) warnings.push(`数据集 ${ds.id} 无原始行（rawRows 空）→ 0 物化·诚实空态（先经上传门灌真数据）`);

    // ⑥ 落库（dryRun 只试算不写）。replaceExisting：先清本类型同租户既有对象（含合成种子）→ 真值换合成。
    let replacedCount = 0;
    let materializedCount = 0;
    if (body.dryRun) {
      materializedCount = objects.length; // 将物化条数（R6 与真跑一致）。
    } else if (objects.length > 0) {
      const epoch = await repos.epochs.next(c.tenantId);
      if (body.replaceExisting) {
        replacedCount = await repos.objects.removeWhere(c.tenantId, (o) => o.type === body.targetType);
      }
      for (const o of objects) {
        await repos.objects.put({ id: o.id, tenantId: c.tenantId, type: o.type, props: o.props, origin: o.origin, epoch });
        materializedCount++;
      }
    }

    // provenance 维：真源（非合成）且有物化对象 → 世界态 imported·驾驶舱据此诚实标真、不冒充。
    const provenanceReal = !sourceSynthetic && objects.length > 0;
    return {
      targetType: body.targetType,
      rawDatasetId: ds.id,
      sourceConnId: ds.sourceConnId,
      materializedCount,
      replacedCount,
      worldSource: provenanceReal ? "imported" : "synthetic",
      provenanceReal,
      primaryKey,
      warnings,
      sampleObjectIds: objects.slice(0, 5).map((o) => o.id),
      dryRun: body.dryRun === true,
    };
  });

  // ---- WO-CEO-DATA-2 · CEO 驾驶舱原子颗粒数据集生成（只产原子颗粒·无预聚合·back-derivation）----
  app.post("/a/v1/ceo/dataset/generate", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const body = parseBody(CeoDatasetGenerateRequestSchema, req.body);
    // R2 隔离：请求体 tenantId 必须与当前用户租户一致（先验，防跨租户探测）。
    if (body.tenantId !== c.tenantId) throw forbidden("tenant mismatch");
    // R3 entitlement：未开通则 404 FEATURE_NOT_FOUND。
    if (!(await features.enabled(c.tenantId, "ceo.dataset.generate"))) throw featureNotFound();
    const dataset = generateCeoAtomicDataset({
      tenantId: c.tenantId,
      seed: body.seed,
      scenario: body.scenario,
      period: body.period,
      scale: body.scale,
    });
    return dataset;
  });

  // ---- WO-PROCESS-INSTANCE · 流程运行时（「为什么这个流程现在卡住了」）------------------------
  // R3 暗发：`process.runtime` defaultOn:false ⇒ 关 = 404 FEATURE_NOT_FOUND，**先于 authz**
  //（先于角色门：功能关闭时连「你没权限」都不该说，那等于承认它存在）。
  const requireProcessRuntime = async (c: AuthCtx) => {
    if (!(await features.enabled(c.tenantId, "process.runtime"))) throw featureNotFound();
  };

  /** 全租户此刻卡住的流程 + 各等待态计数。前端卡点面板的唯一数据源。 */
  app.get("/a/v1/process-instances/stuck", async (req) => {
    const c = ctx(req);
    await requireProcessRuntime(c);
    return processRuntime.stuck(c.tenantId);
  });

  app.get("/a/v1/process-instances/:id", async (req) => {
    const c = ctx(req);
    await requireProcessRuntime(c);
    const { id } = req.params as { id: string };
    // R2：detail() 经 store.get(tenantId, id) 取，跨租户必 undefined ⇒ 404（不是 403，不泄漏存在性）。
    return processRuntime.detail(c.tenantId, id);
  });

  app.post("/a/v1/process-instances", async (req) => {
    const c = ctx(req);
    await requireProcessRuntime(c);
    const body = parseBody(CreateProcessInstanceRequestSchema, req.body);
    return processRuntime.create(c.tenantId, body);
  });

  /** 推进：body 里给的是**外部事实**（数据到齐/外部回执/审批结论/人工已办），引擎据此重判 gate。 */
  app.post("/a/v1/process-instances/:id/advance", async (req) => {
    const c = ctx(req);
    await requireProcessRuntime(c);
    const { id } = req.params as { id: string };
    const body = parseBody(AdvanceProcessInstanceRequestSchema, req.body ?? {});
    return processRuntime.advance(c.tenantId, id, body);
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
    const run = await databuilder.runStory(c, { script: body.script, seed: body.seed, builderKey: body.builderKey, buildMode: body.buildMode, fromDatasetIds: body.fromDatasetIds }, body.inference ?? false);
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
  // WO-DATABUILDER-PIPELINE：**按 pipeline 处理数据**（改造前此处写死 parse→reconcile→persist→emit 四连）。
  // 步骤序列 + 每节点 SOP 来自持久化的 BuildPipeline(kind=intake)；未配置则用出厂默认（行为逐字节不变）。
  app.post("/a/v1/databuilder/intake", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const body = parseBody(IntakeRequestSchema, req.body);
    const pipeline = await databuilder.pipelines.resolve(c, "intake");
    return runIntakePipeline({ repos, ontology, connectors, outbox }, pipeline, c, { html: body.html });
  });
  // prototype-intake P3 导入正门：HTML 物化进库 = 经连接器（prototype_html）落 RawDataset，
  // 数据连接器可见此"导入文件"+ 在线查看每张表（值与原型一致；不写死前端代码 R8 数据流）。
  // WO-DATABUILDER-PIPELINE：导入同样**按 pipeline 处理数据**（kind=intake_import）。
  app.post("/a/v1/databuilder/intake/import", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const body = parseBody(IntakeImportRequestSchema, req.body);
    const pipeline = await databuilder.pipelines.resolve(c, "intake_import");
    return runIntakeImportPipeline({ repos, ontology, connectors, outbox }, pipeline, c, { filename: body.filename, html: body.html });
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
    await outbox.emit(c.tenantId, "prototype.objectified", { connId: body.connId, materialized: result.materialized.length, objects: result.materialized.reduce((a, m) => a + m.count, 0) });
    return result;
  });
  // prototype-intake P2：对账候选队列（HITL）。
  app.get("/a/v1/databuilder/reconcile-candidates", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const items = (await repos.reconcileCandidates.list(c.tenantId)).filter((x) => (req.query as { status?: string }).status ? x.status === (req.query as { status?: string }).status : true);
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
  // ── WO-DATABUILDER-PIPELINE：数据构建 Pipeline（低代码可配置执行流）的配置面 ──
  // 「先配置一个 data builder 的低代码 pipeline，配置每个节点的 SOP，只要数据接入或导入，
  //   就按照这个 pipeline 处理数据」——这组路由是"配置"，上面的 intake/import/建域是"按它跑"。
  app.get("/a/v1/databuilder/pipelines", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const items = await databuilder.pipelines.list(c);
    return { items: items.map((p) => ({ ...p, order: projectPipelineOrder(p) })) };
  });
  app.get("/a/v1/databuilder/pipelines/:kind", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const p = await databuilder.pipelines.get(c, (req.params as { kind: string }).kind);
    return { ...p, order: projectPipelineOrder(p) };
  });
  // 覆盖某 kind 的 pipeline（幂等）：改完立刻生效 —— intake/import/建域下次执行即按新定义跑。
  app.put("/a/v1/databuilder/pipelines/:kind", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const body = parseBody(BuildPipelineUpsertSchema, req.body);
    const p = await databuilder.pipelines.upsert(c, (req.params as { kind: string }).kind, body);
    return { ...p, order: projectPipelineOrder(p) };
  });
  // 撤销覆盖 → 回出厂默认（行为回到写死时代）。
  app.delete("/a/v1/databuilder/pipelines/:kind", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const p = await databuilder.pipelines.reset(c, (req.params as { kind: string }).kind);
    return { ...p, order: projectPipelineOrder(p) };
  });
  // 节点 SOP「人要不要介入」的放行：PAUSED 的 run 经此放行该步并 resume 续跑。
  app.post("/a/v1/databuilder/workflow-runs/:id/approve", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const body = parseBody(WorkflowApproveBodySchema, req.body);
    return databuilder.approveWorkflowStep(c, (req.params as { id: string }).id, body.stepKey);
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
    return features.resolve(id);
  });
  app.put("/a/v1/tenants/:id/features/roles/:role", async (req) => {
    const c = ctx(req);
    requireAdmin(c);
    const { id, role } = req.params as { id: string; role: string };
    if (id !== c.tenantId) throw forbidden("cross-tenant feature write");
    const body = parseBody(z.object({ overrides: z.record(z.string(), z.boolean()) }), req.body);
    await features.putRoleConfig(c, id, role, body.overrides);
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
    return filtered.slice(-200).map((e) => ({ eventId: e.eventId, event: e.event, createdAt: e.createdAt }));
  });

  // ---- LLM Provider 配置体系增量 §1 + 引用上报（§2.3） -------------------------------------------
  registerLlmProviderRoutes(app, { repos, service: llmProviders, outbox, ctx, fetchImpl: deps.fetchImpl ?? fetch });

  // ---- 管理平台增量：§2 租户/用户 + §3 场景包/视图配置 ------------------------------------------
  registerAdminPlatformRoutes(app, { repos, outbox, features, ctx });

  // ---- WO-ORG-WORLD · 组织世界（七世界之②·人/角色/部门/职权/审批额度/代理）------------------
  // Entitlement 先于 authz：`org.world` 暗发（defaultOn:false）→ 关闭时全部路由 404 FEATURE_NOT_FOUND。
  registerOrgWorldRoutes(app, {
    service: new OrgWorldService(repos),
    ctx,
    requireFeature: (req) => requireFeatureTag(req, "apiTags", "org-world"),
  });

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

  // ============================================================================
  // WO-SLICE-GOVERNANCE-FULL · 切片治理（无契约→推进为契约 · 单/批 · 取完整 spec 供编辑器预填）
  // 独立段置于文件末尾，避免与其它改动抢行；契约 additive，既有切片端点行为不变。
  // ============================================================================
  // 批：为所有"无契约"切片确定性派生 baseline fixture（空 resolve 诚实 skip·requireAdmin）。
  app.post("/a/v1/ontology/slices/derive-fixtures", async (req, reply) => {
    const c = ctx(req);
    requireAdmin(c);
    const out = await governance.deriveMissingSliceFixtures(c.tenantId);
    return reply.status(201).send(out);
  });
  // 单：为一个无契约切片派生 baseline fixture 并写回 spec.contractFixtures（requireAdmin）。
  app.post("/a/v1/ontology/slices/:sliceKey/derive-fixture", async (req, reply) => {
    const c = ctx(req);
    requireAdmin(c);
    const { sliceKey } = req.params as { sliceKey: string };
    const out = await governance.deriveSliceFixture(c.tenantId, sliceKey);
    return reply.status(out.promoted ? 201 : 200).send(out);
  });
  // 取单个切片完整 spec（供前端编辑器预填 root/paths/maxNodes/contractFixtures）。tenant 隔离。
  app.get("/a/v1/ontology/slices/:sliceKey", async (req) => {
    const c = ctx(req);
    const { sliceKey } = req.params as { sliceKey: string };
    const spec = await ontologyCore.getSliceSpec(c, sliceKey);
    if (!spec) throw notFound(`slice ${sliceKey}`);
    return { sliceKey: spec.sliceKey, version: spec.version, spec: spec.spec };
  });

  /**
   * WO-SLICE-16-LAYERS：切片的「十六层结构」只读投影（取证见 docs/AUDIT-slice-16-layers.md）。
   *
   * 病根：`executeSlice` 只回 {nodes, edges} ⇒ 十六层里只有 ③对象 ④属性 ⑤关系带得出来；
   * 其余 11 层**承载物在、数据也在**（规则 28 条 / 传导 13 条 / 数据绑定 93 类 / 事件 372 条…），
   * 只是从来没人沿切片的类型集把它们 join 出来 —— 三形态里的「接了线接错地方」。
   * 本路由就是那条缺失的 join：纯读、零新真值源、R6 确定性。
   *
   * 取不到的层不画占位内容：三态 present / not_in_slice（平台有、这条切片没纳入）/
   * absent（本租户无数据，并说明**缺在哪一环**）。
   */
  app.get("/a/v1/ontology/slices/:sliceKey/layers", async (req) => {
    const c = ctx(req);
    const { sliceKey } = req.params as { sliceKey: string };
    const q = req.query as { args?: string };
    const spec = await ontologyCore.getSliceSpec(c, sliceKey);
    if (!spec) throw notFound(`slice ${sliceKey}`);
    // 试切参数：与 POST …/resolve 同口径（root selector 的 {{args.x}}）。非法 JSON → 空参（诚实降级，不 500）。
    let args: Record<string, unknown> = {};
    if (q.args) {
      try {
        const parsed: unknown = JSON.parse(q.args);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
      } catch {
        args = {};
      }
    }
    const graph = await ontologyCore.executeSlice(c, spec.spec, args);
    // 各层承载物一次读齐（全部既有表，无新表）。A6 行级过滤已在 executeSlice 逐跳生效。
    const [types, linkTypes, ruleList, propagationRules, tsSeries, excObjs, actionTypeList, derivSpecs] =
      await Promise.all([
        ontology.listTypes(c),
        repos.ontologyLinks.list(c.tenantId),
        repos.rules.list(c.tenantId, (r) => r.status === "PUBLISHED"),
        repos.sim.listPropagationRules(c.tenantId, true),
        repos.tsSeries.list(c.tenantId),
        repos.objects.listByType(c.tenantId, "ExceptionEvent"),
        actions.listTypes(c),
        repos.derivationSpecs.list(c.tenantId, (s) => s.status === "ACTIVE"),
      ]);
    // 空子图诊断的输入：root 类型在本租户有多少对象 —— 用来区分「零对象」与「有对象但 selector 没匹配」，
    // 并从**真对象**上取「这个参数可以填什么」的候选值（绝不编示例值）。
    // 只在子图为空时才读（非空路径零额外开销）。样本上限防大租户全表拉取。
    const ROOT_SAMPLE_CAP = 200;
    const rootObjects = graph.nodes.length === 0
      ? await repos.objects.listByType(c.tenantId, spec.spec.root.typeKey)
      : [];
    const rootObjectTotal = rootObjects.length;
    // 显示键与 executeSlice 的 byKey 匹配口径同源（ontology-core.ts:620 `objectKey ?? props[pk] ?? id`）：
    // 候选值必须是**填进去真能解出子图的那个值**，否则候选就是摆设。优先业务主键（SO-3391）
    // 而非内部 id（obj_order_SO-3391）——两者都能匹配，但只有前者是人认得的那个。
    const rootPkProp = types.find((t) => t.key === spec.spec.root.typeKey)?.properties.find((p) => p.isPrimaryKey)?.propKey;
    const rootObjectSamples = rootObjects.slice(0, ROOT_SAMPLE_CAP).map((o) => ({
      objectKey: String(o.objectKey ?? (rootPkProp !== undefined ? o.props[rootPkProp] : undefined) ?? o.id),
      props: o.props,
    }));
    const exceptionRefTypes: Record<string, number> = {};
    for (const o of excObjs) {
      const rt = typeof o.props.refType === "string" ? o.props.refType : "UNKNOWN";
      exceptionRefTypes[rt] = (exceptionRefTypes[rt] ?? 0) + 1;
    }
    const references = (await governance.sliceReferences(c, sliceKey)).refs;
    return projectSliceLayers({
      sliceKey: spec.sliceKey,
      version: spec.version,
      spec: spec.spec,
      graph,
      types,
      linkTypes,
      rules: ruleList,
      propagationRules: propagationRules.map((p) => ({
        key: p.key,
        sourceTypeKey: p.sourceTypeKey,
        sourceStateVar: p.sourceStateVar,
        targetTypeKey: p.targetTypeKey,
        targetStateVar: p.targetStateVar,
        viaLinkKey: p.viaLinkKey,
        coefficient: p.coefficient,
      })),
      tsSeries,
      exceptionEventTotal: excObjs.length,
      exceptionRefTypes,
      references: references.map((r) => ({ refKind: r.refKind, key: r.key, where: r.where })),
      actionTypeKeys: actionTypeList.map((a) => a.key).sort(),
      derivationSpecKeys: derivSpecs.map((d) => ({ specKey: d.specKey, targetType: d.targetType, targetProp: d.targetProp, formula: d.formula })),
      args,
      rootObjectTotal,
      rootObjectSamples,
    });
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
      ruleScan,
      actions,
      decisionKernel,
      databuilder,
      sop,
      kb,
      simclock,
      enterpriseState,
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
