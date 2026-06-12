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
import { ClockTickBodySchema, QueryTimeseriesAggInputSchema, SyntheticJobBodySchema } from "@platform/contracts";
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
import { RulesService } from "./rules.js";
import { OntologyService } from "./ontology.js";
import { ConnectorService } from "./connectors/service.js";
import { CONNECTOR_TYPES } from "./connectors/registry.js";
import { RuleDocService } from "./ruledocs.js";
import { ModelingService } from "./modeling.js";
import { SyntheticService } from "./synthetic/service.js";
import { SolverService, SOLVER_KEYS } from "./solvers/service.js";
import { TimeseriesService } from "./timeseries.js";
import { SchedulerService, RuleScanService } from "./scheduler.js";
import { ActionService, MockActionExecutor, type ActionExecutor } from "./actions.js";
import { SopService } from "./sop.js";
import { PlanService } from "./planviews.js";
import { CalibrationService } from "./calibration.js";
import { buildDataHealth } from "./datahealth.js";
import { buildMappingRows } from "./mapping.js";
import { GRAPH_DOMAIN, GRAPH_EXTRA_EDGES, GRAPH_EXTRA_NODES, SOLVER_GRAPH } from "./graphmeta.js";
import { parseAggregate } from "./ontology.js";
import { KbService } from "./kb.js";
import { SimClockService } from "./simclock.js";
import { FeatureService, VIEW_FEATURE_MAP } from "./features.js";
import { createEmbeddingProvider, type EmbeddingProvider } from "./embeddings.js";
import type { AuthCtx } from "./domain.js";

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
}

export interface BuiltApp {
  app: FastifyInstance;
  services: {
    auth: AuthService;
    authz: AuthzService;
    outbox: OutboxService;
    rules: RulesService;
    ontology: OntologyService;
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
  const outbox = new OutboxService(repos, logger, deps.fetchImpl);
  const rules = new RulesService(repos, outbox);
  const solvers = new SolverService(repos);
  const ontology = new OntologyService(repos, authz, outbox, solvers);
  const timeseries = new TimeseriesService(repos, authz, outbox);
  const features = new FeatureService(repos);
  const cipher = new CredentialCipher(config.CREDENTIAL_KEY);
  const connectors = new ConnectorService(repos, blob, cipher, metrics, deps.fetchImpl ?? fetch);
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
  const ruleDocs = new RuleDocService(repos, blob, llm, rules, metrics, config.DC_LLM_MODEL, embeddings);
  const modeling = new ModelingService(repos, llm, ontology, metrics, config.DC_LLM_MODEL);
  const synthetic = new SyntheticService(repos, llm, ontology, rules, metrics, config.DC_LLM_MODEL, timeseries);
  const actions = new ActionService(repos, rules, outbox);
  const ruleScan = new RuleScanService(repos, timeseries, outbox);
  const scheduler = new SchedulerService(repos, logger.child({ component: "scheduler" }) as Logger);
  const sop = new SopService(repos, solvers, outbox);
  const kb = new KbService(repos, authz, blob, embeddings);
  const simclock = new SimClockService(repos, timeseries, ontology, ruleScan, solvers, outbox);
  const plan = new PlanService(repos, solvers, rules, outbox);
  const calibration = new CalibrationService(repos, outbox);
  // cross-wiring (kept out of constructors to avoid dependency cycles)
  synthetic.wire({ scheduler, features, actions, ts: timeseries });
  connectors.wire({ ts: timeseries, scheduler });
  simclock.setResetRunner(async (c, spec) => synthetic.runJob(c, spec));
  // §7.21: C12 → calibration.required → 提案生成（与降级/告警共用同一扫描路径）
  ruleScan.setCalibrationHook(async (tenantId, entityId) => calibration.onCalibrationRequired(tenantId, entityId));
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
      return mockExecutor.execute(draft);
    },
  };
  actions.setExecutor(domainExecutor);
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
    })
    .on("TS_AGGREGATE", async (tenantId) => {
      await timeseries.runAggregation(tenantId);
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
  app.get("/readyz", async (_req, reply) => {
    try {
      await repos.ping();
      return { status: "ready" };
    } catch {
      return reply.status(503).send({ status: "not ready" });
    }
  });
  app.get("/metrics", async (_req, reply) => reply.type("text/plain").send(metrics.render()));
  // 网关前缀别名（gateway 只反代 /a/v1/* → 经代理探活用）
  app.get("/a/v1/healthz", async () => ({ status: "ok" }));
  app.get("/a/v1/readyz", async (_req, reply) => {
    try {
      await repos.ping();
      return { status: "ready" };
    } catch {
      return reply.status(503).send({ status: "not ready" });
    }
  });

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
    const viewAllowed = (key: string) => {
      const fk = VIEW_FEATURE_MAP[key];
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
        properties: z.array(
          z.object({
            propKey: z.string(),
            dataType: z.enum(["string", "number", "boolean", "date", "enum", "ref", "json"]),
            isPrimaryKey: z.boolean().default(false),
            refToTypeKey: z.string().nullable().optional(),
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
    return reply.status(201).send(await ontology.upsertType(c, body));
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

  app.post("/a/v1/objects/query", async (req) => {
    const body = parseBody(ObjectsQuerySchema, req.body);
    return ontology.queryObjects(ctx(req), body.objectType, body.filter, body.limit);
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
  app.get("/a/v1/objects/:type/:id", async (req) => {
    const { type, id } = req.params as { type: string; id: string };
    return ontology.getObject(ctx(req), type, id);
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
  app.post("/a/v1/slices/:sliceKey/resolve", async (req) => {
    const { sliceKey } = req.params as { sliceKey: string };
    const body = parseBody(z.object({ args: z.record(z.string(), z.unknown()).default({}) }), req.body);
    return ontology.resolveSlice(ctx(req), sliceKey, body.args);
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

  // ---- S2 action approval ----------------------------------------------------
  app.post("/a/v1/action-drafts", async (req, reply) => {
    const c = ctx(req);
    const body = parseBody(ActionDraftSchema, req.body);
    const key = body.actionTypeKey ?? body.actionType;
    if (!key) throw validationError("actionTypeKey required");
    await authz.require(c, "ACTION_TYPE", key, "EXECUTE");
    const draft = await actions.create(c, {
      actionTypeKey: key,
      payload: body.payload,
      origin: body.origin,
      submit: body.submit,
    });
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
    return reply.status(201).send(await rules.create(ctx(req), body));
  });
  app.post("/a/v1/rules/:id/publish", async (req) => {
    const { id } = req.params as { id: string };
    return rules.publish(ctx(req), id);
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

  // ---- A3 modeling -----------------------------------------------------------------------
  app.post("/a/v1/modeling/suggest", async (req, reply) => {
    const body = parseBody(SuggestSchema, req.body);
    const draft = await modeling.suggest(ctx(req), body.rawDatasetIds);
    return reply.status(202).send({ draftId: draft.id, status: draft.status });
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
    try {
      const result = await modeling.publishDraft(ctx(req), id);
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
  app.get("/a/v1/features/registry", async (req) => {
    ctx(req);
    return features.registry();
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

  return {
    app,
    services: {
      auth,
      authz,
      outbox,
      rules,
      ontology,
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
    },
  };
}
