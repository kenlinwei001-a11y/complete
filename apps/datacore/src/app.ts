import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import multipart from "@fastify/multipart";
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
import { SolverService } from "./solvers/service.js";
import { TimeseriesService } from "./timeseries.js";
import { SchedulerService, RuleScanService } from "./scheduler.js";
import { ActionService } from "./actions.js";
import { SopService } from "./sop.js";
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
  // cross-wiring (kept out of constructors to avoid dependency cycles)
  synthetic.wire({ scheduler, features, actions, ts: timeseries });
  connectors.wire({ ts: timeseries, scheduler });
  simclock.setResetRunner(async (c, spec) => synthetic.runJob(c, spec));
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
    "/a/v1/.well-known/jwks.json",
  ]);

  app.addHook("onRequest", async (req: FastifyRequest, _reply: FastifyReply) => {
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

  // ---- A0 IAM -------------------------------------------------------------------
  app.post("/a/v1/auth/login", async (req) => {
    const body = parseBody(LoginSchema, req.body);
    return auth.login(body.tenantId, body.username, body.password);
  });
  app.post("/a/v1/auth/refresh", async (req) => {
    const body = parseBody(z.object({ refreshToken: z.string().min(1) }), req.body);
    return auth.refresh(body.refreshToken);
  });
  app.get("/a/v1/.well-known/jwks.json", async () => auth.jwks());

  app.get("/a/v1/me/workspace", async (req) => {
    const c = ctx(req);
    const tenant = await repos.tenants.get(c.tenantId, c.tenantId);
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
    const views = configs.flatMap((v) => v.views).filter((v) => viewAllowed(v.key));
    const scenarioPackages = [...new Set(configs.flatMap((v) => v.scenarioPackages))];
    const navigation = configs.flatMap((v) => v.navigation).filter((n) => viewAllowed(n.key));
    const theme = configs[0]?.theme ?? {};
    return {
      tenant: tenant ? { id: tenant.id, name: tenant.name, industry: tenant.industry } : { id: c.tenantId },
      scenarioPackages,
      views,
      theme,
      navigation,
      features: resolved.features,
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
    return authz.explain(target, body.resource.kind, body.resource.key, body.op);
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
  // 前端 PRD §6.4 别名：objectRef 槽位搜索选择器（GET /a/v1/objects?type=&q=）
  app.get("/a/v1/objects", async (req) => {
    const q = req.query as Record<string, unknown>;
    const type = typeof q["type"] === "string" ? (q["type"] as string) : "";
    const needle = typeof q["q"] === "string" ? (q["q"] as string).toLowerCase() : "";
    if (!type) throw validationError("type query parameter is required");
    const result = await ontology.queryObjects(ctx(req), type, {}, 200);
    const rows = (result.data as Record<string, unknown>[]).filter((o) => {
      if (!needle) return true;
      const p = (o["props"] as Record<string, unknown>) ?? {};
      const hay = JSON.stringify([
        o["name"], o["label"], o["id"], p["name"], p["label"], p["so"], p["cust"], p["modelId"], p["baseId"],
      ]).toLowerCase();
      return hay.includes(needle);
    });
    return { data: rows.slice(0, 20), snapshotVersion: result.snapshotVersion };
  });
  app.get("/a/v1/objects/:type/:id", async (req) => {
    const { type, id } = req.params as { type: string; id: string };
    return ontology.getObject(ctx(req), type, id);
  });
  // 前端 PRD §7.2：类型级本体图谱（节点=ObjectType，边=LinkType）
  app.get("/a/v1/ontology/graph", async (req) => {
    const c = ctx(req);
    const types = (await ontology.listTypes(c)) as unknown as Record<string, unknown>[];
    const links = (await repos.ontologyLinks.list(c.tenantId)) as unknown as Record<string, unknown>[];
    return {
      nodes: types.map((t) => ({
        key: t["typeKey"] ?? t["key"],
        displayName: t["displayName"] ?? t["typeKey"] ?? t["key"],
        domain: t["domain"] ?? "factory",
        tier: t["tier"] ?? 0,
        kind: t["kind"] ?? "object",
        properties: Object.keys((t["properties"] as Record<string, unknown>) ?? {}),
        sourceBindings: t["sourceBindings"] ?? [],
      })),
      edges: links.map((l) => ({
        key: l["key"] ?? l["id"],
        from: l["fromTypeKey"] ?? l["from"],
        to: l["toTypeKey"] ?? l["to"],
        name: l["name"] ?? l["key"],
        cardinality: l["cardinality"] ?? "1:N",
      })),
    };
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
    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) throw validationError("multipart file required");
      const content = await file.toBuffer();
      const result = await connectors.upload(c, file.filename, content);
      return reply.status(201).send(result);
    }
    const body = parseBody(RuleDocJsonSchema, req.body);
    const result = await connectors.upload(c, body.filename, Buffer.from(body.contentBase64, "base64"));
    return reply.status(201).send(result);
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
  app.get("/a/v1/rule-docs/:id", async (req) => {
    const { id } = req.params as { id: string };
    return ruleDocs.getDoc(ctx(req), id);
  });
  app.get("/a/v1/rule-docs/:id/candidates", async (req) => {
    const { id } = req.params as { id: string };
    const { status } = req.query as { status?: string };
    return ruleDocs.listCandidates(ctx(req), id, status);
  });
  app.post("/a/v1/rule-candidates/:id/review", async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(ReviewSchema, req.body);
    return ruleDocs.review(ctx(req), id, body.action, body.patch);
  });

  // ---- A3 modeling -----------------------------------------------------------------------
  app.post("/a/v1/modeling/suggest", async (req, reply) => {
    const body = parseBody(SuggestSchema, req.body);
    const draft = await modeling.suggest(ctx(req), body.rawDatasetIds);
    return reply.status(202).send({ draftId: draft.id, status: draft.status });
  });
  app.get("/a/v1/modeling/drafts/:id", async (req) => {
    const { id } = req.params as { id: string };
    return modeling.getDraft(ctx(req), id);
  });
  app.patch("/a/v1/modeling/drafts/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(DraftPatchSchema, req.body);
    return modeling.patchDraft(
      ctx(req),
      id,
      body.operations as unknown as import("./domain.js").DraftOperation[],
    );
  });
  app.post("/a/v1/modeling/drafts/:id/publish", async (req) => {
    const { id } = req.params as { id: string };
    return modeling.publishDraft(ctx(req), id);
  });
  app.post("/a/v1/modeling/drafts/:id/materialize", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await modeling.materialize(ctx(req), id);
    return reply.status(202).send(result);
  });

  // ---- A7 synthetic -----------------------------------------------------------------------
  app.post("/a/v1/synthetic/jobs", async (req, reply) => {
    const body = parseBody(SyntheticJobBodySchema, req.body);
    const job = await synthetic.runJob(ctx(req), body);
    return reply.status(202).send(job);
  });
  app.get("/a/v1/synthetic/jobs/:id", async (req) => {
    const { id } = req.params as { id: string };
    const job = await repos.syntheticJobs.get(ctx(req).tenantId, id);
    if (!job) throw notFound("synthetic job");
    return job;
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
    return features.resolve(id, role);
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
    const body = parseBody(z.object({ fields: z.record(z.string(), z.unknown()) }), req.body);
    return sop.patch(ctx(req), id, body.fields);
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
  app.get("/a/v1/synthetic/clock", async (req) => simclock.getClock(ctx(req)));
  app.post("/a/v1/synthetic/clock/tick", async (req, reply) => {
    const body = parseBody(ClockTickBodySchema, req.body);
    const result = await simclock.tick(ctx(req), body.advance);
    return reply.status(202).send({ tickJobId: result.tickJobId, status: "SUCCEEDED", report: result.report });
  });
  app.post("/a/v1/synthetic/clock/reset", async (req, reply) => {
    return reply.status(202).send(await simclock.reset(ctx(req)));
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
    },
  };
}
