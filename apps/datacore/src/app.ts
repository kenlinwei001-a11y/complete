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
import { AggregateRequestSchema, BuildRunBodySchema, ClockTickBodySchema, CrossValidateRequestSchema, DataBuilderConfigSchema, QueryTimeseriesAggInputSchema, SyntheticJobBodySchema } from "@platform/contracts";
import type { Config } from "./config.js";
import type { Repos } from "./repo/repo.js";
import type { BlobStore } from "./blob.js";
import type { LlmClient } from "./llm.js";
import { Metrics } from "./metrics.js";
import { AppError, forbidden, notFound, unauthorized, validationError } from "./errors.js";
import { newId } from "./ids.js";
import { CredentialCipher } from "./crypto.js";
import { AuthService } from "./auth.js";
import { AuthzService } from "./authz.js";
import { OutboxService } from "./outbox.js";
import { ExecutionLockService } from "./execlock.js";
import { QuarantineService } from "./quarantine.js";
import { NotificationService } from "./notifications.js";
import { EntityResolutionService } from "./entity-resolution.js";
import { CatalogService } from "./catalog.js";
import { VleService } from "./vle.js";
import { RulesService, assertValidExpression } from "./rules.js";
import { LlmProviderService, TenantRoutedLlmClient, registerLlmProviderRoutes } from "./llmproviders.js";
import { registerAdminPlatformRoutes } from "./adminplatform.js";
import { OntologyService } from "./ontology.js";
import { OntologyCoreService } from "./ontology-core.js";
import { OntologyGovernanceService, UNIT_DICTIONARY } from "./ontology-governance.js";
import { ConnectorService } from "./connectors/service.js";
import { CONNECTOR_TYPES } from "./connectors/registry.js";
import { RuleDocService } from "./ruledocs.js";
import { ModelingService } from "./modeling.js";
import { SyntheticService } from "./synthetic/service.js";
import { LivedInEngine } from "./livedin/engine.js";
import { SolverService, SOLVER_KEYS } from "./solvers/service.js";
import { TimeseriesService } from "./timeseries.js";
import { SchedulerService, RuleScanService } from "./scheduler.js";
import { ActionService, MockActionExecutor, type ActionExecutor } from "./actions.js";
import { SopService } from "./sop.js";
import { PlanService } from "./planviews.js";
import { CalibrationService } from "./calibration/index.js";
import { buildDataHealth } from "./datahealth.js";
import { buildMappingRows } from "./mapping.js";
import { GRAPH_DOMAIN, GRAPH_EXTRA_EDGES, GRAPH_EXTRA_NODES, SOLVER_GRAPH } from "./graphmeta.js";
import { parseAggregate } from "./ontology.js";
import { KbService } from "./kb.js";
import { DataBuilderService } from "./databuilder/service.js";
import { SimClockService } from "./simclock.js";
import { HistoryService } from "./livedin/bundle.js";
import { FeatureService, VIEW_FEATURE_MAP } from "./features.js";
import { createEmbeddingProvider, type EmbeddingProvider } from "./embeddings.js";
import { OpsTeamService } from "./opsteam/team.js";
import { OpsScheduleService } from "./opsteam/schedule.js";
import { OpsReplayService } from "./opsteam/replay.js";
import { poolSnapshot } from "./opsteam/pools.js";
import { OpsScheduleSchema } from "@platform/contracts";
import type { AuthCtx } from "./domain.js";
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
    ruleScan: RuleScanService;
    actions: ActionService;
    sop: SopService;
    kb: KbService;
    simclock: SimClockService;
    features: FeatureService;
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
  status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
});

const ConnectionCreateSchema = z.object({
  connectorTypeKey: z.string().min(1),
  name: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
  schedule: z.object({ cron: z.string() }).optional(),
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
  const execLocks = new ExecutionLockService(repos, metrics);
  const quarantine = new QuarantineService(repos);
  const notifications = new NotificationService(repos);
  const entityResolution = new EntityResolutionService(repos, outbox);
  const rules = new RulesService(repos, outbox);
  const solvers = new SolverService(repos);
  const ontology = new OntologyService(repos, authz, outbox, solvers, metrics);
  const ontologyCore = new OntologyCoreService(repos, authz);
  const timeseries = new TimeseriesService(repos, authz, outbox);
  const features = new FeatureService(repos);
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
  const ruleDocs = new RuleDocService(repos, blob, routedLlm, rules, metrics, config.DC_LLM_MODEL, embeddings);
  const modeling = new ModelingService(repos, routedLlm, ontology, metrics, config.DC_LLM_MODEL, quarantine);
  const synthetic = new SyntheticService(repos, routedLlm, ontology, rules, metrics, config.DC_LLM_MODEL, timeseries);
  const vle = new VleService(repos, synthetic, ontology);
  const actions = new ActionService(repos, rules, outbox, notifications);
  const ruleScan = new RuleScanService(repos, timeseries, outbox);
  const scheduler = new SchedulerService(repos, logger.child({ component: "scheduler" }) as Logger);
  const sop = new SopService(repos, solvers, outbox);
  const kb = new KbService(repos, authz, blob, embeddings);
  const databuilder = new DataBuilderService(repos, ontology, rules, connectors, kb);
  const simclock = new SimClockService(repos, timeseries, ontology, ruleScan, solvers, outbox);
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
    livedInRunner: async (c, input) => {
      const state = await livedInEngine.run(c, input);
      return { replay: state.replay };
    },
  });
  connectors.wire({ ts: timeseries, scheduler });
  simclock.setResetRunner(async (c, spec) => synthetic.runJob(c, spec));
  // §7.21: C12 → calibration.required → 提案生成（与降级/告警共用同一扫描路径）
  ruleScan.setCalibrationHook(async (tenantId, entityId) => calibration.onCalibrationRequired(tenantId, entityId));
  // M11 §1: tick 聚合后配对 + 元闭环（在 RULE_SCAN 之前 —— C12 命中即有新配对可消费）
  simclock.setCalibrationTicker(async (tenantId) => calibration.onTick(tenantId));
  // S2 写回适配器：领域 Action（AOP情景拍板 / 校准参数变更）真实落库，其余走 Mock。
  const mockExecutor = new MockActionExecutor();
  const domainExecutor: ActionExecutor = {
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
      return mockExecutor.execute(draft);
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
  const debugHeaderFor = (a: AuthCtx): string =>
    encodeURIComponent(a.tenantId) + ":" + encodeURIComponent(a.userId) + ":" + a.roles.map(encodeURIComponent).join("|");
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
  await app.register(cors, { origin: true, credentials: true });

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
    // §7.18 图谱视角视图：功能键 view.graph.persp.{p}，前端路由查 view.graph-{p}，需补别名。
    for (const p of ["all", "backbone", "flow", "source", "solver", "mvp", "agent", "loop"]) {
      if (out.has(`view.graph.persp.${p}`)) out.add(`view.graph-${p}`);
    }
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
      }),
      req.body,
    );
    const policy = { id: newId("pol"), tenantId: c.tenantId, ...body };
    await repos.policies.put(policy);
    return reply.status(201).send(policy);
  });

  // ---- A4 ontology + objects --------------------------------------------------------
  app.get("/a/v1/ontology/object-types", async (req) => ontology.listTypes(ctx(req)));
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
  // 能力发现与路由 §1：资源目录（discover 供给侧；权限/功能开通过滤）
  app.get("/a/v1/catalog", async (req) => {
    const { kind, query } = req.query as { kind?: string; query?: string };
    if (kind !== "slices" && kind !== "solvers") throw validationError("kind must be slices|solvers");
    return catalog.discover(ctx(req), kind, query);
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
  app.post("/a/v1/solvers/:solverKey/invoke", async (req) => {
    const { solverKey } = req.params as { solverKey: string };
    // entitlement first (404 FEATURE_NOT_FOUND), then authz/execution
    await requireFeatureTag(req, "solverKeys", solverKey);
    const body = parseBody(z.object({ args: z.record(z.string(), z.unknown()).default({}) }), req.body);
    return ontology.invokeSolver(ctx(req), solverKey, body.args);
  });
  app.post("/a/v1/derivations/run", async (req, reply) => {
    const run = await ontology.runDerivations(ctx(req));
    return reply.status(202).send(run);
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
    const body = parseBody(ConnectionCreateSchema, req.body);
    return reply.status(201).send(await connectors.createConnection(ctx(req), body));
  });
  app.get("/a/v1/connections", async (req) => connectors.listConnections(ctx(req)));
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
    const { id } = req.params as { id: string };
    const result = await modeling.materialize(ctx(req), id);
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
  app.get("/a/v1/industry-templates", async (req) => repos.industryTemplates.list(ctx(req).tenantId));

  // ---- Feature entitlement -----------------------------------------------------------------
  const requireAdmin = (c: AuthCtx) => {
    if (!c.roles.some((r) => ["admin", "catalog_admin"].includes(r.split(":")[0] as string))) {
      throw forbidden("admin / catalog_admin only");
    }
  };
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
  app.post("/a/v1/databuilder/runs", async (req, reply) => {
    const c = ctx(req);
    requireAdmin(c);
    const body = parseBody(BuildRunBodySchema, req.body);
    const run = await databuilder.runStory(c, body);
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
  app.get("/a/v1/outbox", async (req) => repos.outboxEvents.list(ctx(req).tenantId));

  // ---- LLM Provider 配置体系增量 §1 + 引用上报（§2.3） -------------------------------------------
  registerLlmProviderRoutes(app, { repos, service: llmProviders, outbox, ctx, fetchImpl: deps.fetchImpl ?? fetch });

  // ---- 管理平台增量：§2 租户/用户 + §3 场景包/视图配置 ------------------------------------------
  registerAdminPlatformRoutes(app, { repos, outbox, features, ctx });

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
      ruleScan,
      actions,
      sop,
      kb,
      simclock,
      features,
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
