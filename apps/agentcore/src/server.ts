import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { z, ZodError } from "zod";
import {
  AgentDefinitionSchema,
  ClarificationReplyBodySchema,
  ErrorCodes,
  LlmProviderConfigSchema,
  MCP_CONFIG_NOTES,
  MCP_SERVER_NAME_RE,
  McpServerConfigSchema,
  mcpServerNameSlug,
  ModelBindingSchema,
  SceneEntryConfigSchema,
  ScenarioSchema,
  EvalCaseSchema,
  EvalSuiteSchema,
  SkillDefinitionSchema,
  SubmitQueryBodySchema,
  WorkflowDefinitionSchema,
  type AgentDefinition,
  type LlmProviderConfig,
  type McpServerConfig,
  type SceneEntryConfig,
  type Scenario,
  type SkillDefinition,
  type WorkflowDefinition,
} from "@platform/contracts";
import { stdioPolicyFromConfig } from "./config.js";
import { validateStdioTransport } from "./mcp/runtime.js";
import { AuthError, requireRole, resolveAuth, type RequestAuth } from "./auth.js";
import { DataCoreHttpError, DataCoreUnavailableError } from "./tools/clients.js";
import { solverAllowed, viewAllowed } from "./features/registry.js";
import { CreateIntentBodySchema, CreatePlanBodySchema, UpdateIntentBodySchema, resolvePlanForIntent } from "./catalog/service.js";
import { encryptSecret } from "./crypto.js";
import type { AppDeps } from "./deps.js";
import { newId } from "./ids.js";
import { fallbackStats, promoteFallbackTrace } from "./ops/fallback.js";
import { HttpError } from "./router/orchestrator.js";
import { streamTaskEvents } from "./api/sse.js";
import { BudgetTracker } from "./tools/budget.js";
import { detectStaticCycle, validatePlanSteps } from "./workflow/validate.js";
import { agentRuleRefs, planStepRuleRefs } from "./refs/report.js";
import { detectBreakingSchemaChange } from "./workflow/compat.js";
import { applyListQuery, assertRetireOrDelete, computeReferences, probeMissingRefs, requireCatalogAdmin, type ListQuery } from "./resources.js";
import { classifyGap } from "./growth/probe.js";
import { runGrowthLoop } from "./growth/loop.js";
import { builtinTool } from "./tools/registry.js";
import { lintSkill } from "./skill-lint.js";
import { SCENARIO_CATALOG, seedScenarios } from "./scenarios-catalog.js";
import { EVENT_SUBSCRIPTIONS } from "./event-subscriptions.js";

export async function buildServer(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: deps.config.LOG_LEVEL },
    // 前端 PRD §3/§6.2 真连别名：QOS 端点在 QOS-PRD 中挂 /api/v1，前端契约写 {B}/b/v1。
    // /b/v1 下原生路由（agents/workflows/…）不受影响，只把 QOS 子集重写到 /api/v1。
    rewriteUrl(req) {
      const url = req.url ?? "/";
      for (const seg of ["/b/v1/queries", "/b/v1/catalog", "/b/v1/ops"]) {
        if (url.startsWith(seg)) return "/api/v1" + url.slice("/b/v1".length);
      }
      return url;
    },
  });

  // 经网关同源访问时无需 CORS；开放宽松 CORS 仅为直连端口的开发调试（credentials 模式）。
  await app.register(cors, { origin: true, credentials: true });

  // tolerate empty JSON bodies (e.g. POST .../publish without payload)
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (typeof body !== "string" || body.length === 0) return done(null, undefined);
    try {
      done(null, JSON.parse(body));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  const auth = (req: FastifyRequest): Promise<RequestAuth> => {
    const headers = { ...(req.headers as Record<string, string | string[] | undefined>) };
    // 前端 PRD §4.3 契约补充项：EventSource 无法携带自定义头，SSE 的 token 经 ?access_token= 传递
    const q = req.query as Record<string, unknown> | undefined;
    if (!headers["authorization"] && typeof q?.["access_token"] === "string") {
      headers["authorization"] = `Bearer ${q["access_token"] as string}`;
    }
    return resolveAuth(headers, {
      dataCoreBaseUrl: deps.config.DATACORE_BASE_URL,
    });
  };

  app.setErrorHandler((err, req, reply) => {
    const requestId = req.id as string;
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, requestId } });
    }
    // OBO 透传：DataCore 上游错误保留原始 status/code（如 404 FEATURE_NOT_FOUND / 409 PLAN_LOCKED）
    if (err instanceof DataCoreHttpError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, requestId } });
    }
    if (err instanceof DataCoreUnavailableError) {
      return reply.status(502).send({ error: { code: err.code, message: err.message, requestId } });
    }
    if (err instanceof AuthError) {
      return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: err.message, requestId } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: ErrorCodes.VALIDATION_ERROR,
          message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          requestId,
        },
      });
    }
    req.log.error(err);
    const message = err instanceof Error ? err.message : String(err);
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message, requestId } });
  });

  // ---------------------------------------------------------------------
  // health / metrics
  // ---------------------------------------------------------------------
  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/readyz", async () => {
    let dataCoreReachable: boolean | "unknown" = "unknown";
    if (deps.config.DATACORE_BASE_URL) {
      try {
        const res = await fetch(`${deps.config.DATACORE_BASE_URL}/healthz`, { signal: AbortSignal.timeout(2000) });
        dataCoreReachable = res.ok;
      } catch {
        dataCoreReachable = false; // reported only — readiness does not hard-fail on DataCore
      }
    }
    return { status: "ok", dataCoreReachable };
  });

  app.get("/metrics", async (_req, reply) => {
    reply.header("content-type", "text/plain; version=0.0.4");
    return deps.metrics.render();
  });

  // 网关前缀别名（gateway 只反代 /b/v1/* → 经代理探活用）
  app.get("/b/v1/healthz", async () => ({ status: "ok" }));
  app.get("/b/v1/readyz", async () => ({ status: "ok" }));

  // ---------------------------------------------------------------------
  // QOS §8.1–8.3
  // ---------------------------------------------------------------------
  app.post("/api/v1/queries", async (req, reply) => {
    const a = await auth(req);
    const body = SubmitQueryBodySchema.parse(req.body);
    const idem = req.headers["idempotency-key"];
    const result = await deps.orchestrator.submitQuery(a, body, typeof idem === "string" ? idem : undefined);
    return reply.status(202).send({ taskId: result.taskId, status: result.status, streamUrl: result.streamUrl });
  });

  // 需求拉动的自成长发动机 · P1：QOS 缺口探针——把问句真跑一遍 orchestrator → 终态 → 结构化 GapReport。
  app.post("/api/v1/growth/probe", async (req, reply) => {
    const a = await auth(req);
    const body = SubmitQueryBodySchema.parse(req.body);
    const { taskId } = await deps.orchestrator.submitQuery(a, body);
    const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
    let task = await deps.repos.tasks.get(taskId);
    for (let i = 0; i < 100 && (!task || !TERMINAL.has(task.status)); i++) {
      await new Promise((r) => setTimeout(r, 50));
      task = await deps.repos.tasks.get(taskId);
    }
    if (!task) throw new HttpError(500, "PROBE_FAILED", "probe task vanished");
    return reply.status(200).send(classifyGap(task));
  });

  // 自成长发动机 · P3：LOOP——探针→补齐→重跑→收敛（K 有界，前端可配 maxRounds）。
  app.post("/api/v1/growth/run", async (req, reply) => {
    const a = await auth(req);
    const body = SubmitQueryBodySchema.parse(req.body);
    const maxRounds = Number((req.body as { maxRounds?: number })?.maxRounds ?? 8); // K 前端可配
    const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
    const probe = async () => {
      const { taskId } = await deps.orchestrator.submitQuery(a, body);
      let task = await deps.repos.tasks.get(taskId);
      for (let i = 0; i < 100 && (!task || !TERMINAL.has(task.status)); i++) {
        await new Promise((r) => setTimeout(r, 50));
        task = await deps.repos.tasks.get(taskId);
      }
      if (!task) throw new HttpError(500, "PROBE_FAILED", "probe task vanished");
      return classifyGap(task);
    };
    // 补法分派：缺数据→真人正门补(P2 真实)；其余暂不可自动补→出需开发工单（收敛到边界）。
    const fill = async (gap: import("@platform/contracts").GapFinding) => {
      if (gap.gapCode === "EMPTY_DATA") {
        try {
          await deps.dataCore.ontology.fillData(a, { typeKey: body.context.view || "Object", fields: ["id", "name", "value"], rows: 6, seed: 42 });
          return { gapCode: gap.gapCode, action: "缺数据真人正门补(fill-data)", advanced: true };
        } catch {
          return { gapCode: gap.gapCode, action: "fill-data 失败", advanced: false, ticket: { gapCode: gap.gapCode, detail: gap.evidence } };
        }
      }
      return { gapCode: gap.gapCode, action: `${gap.suggestedFill}（当前不可自动补→工单）`, advanced: false, ticket: { gapCode: gap.gapCode, detail: gap.evidence } };
    };
    const report = await runGrowthLoop({ question: body.query, maxRounds, probe, fill });
    // P4：成长账本(demand-indexed) + 缺功能→成长工单(厂商中立施工契约)
    const now = new Date().toISOString();
    await deps.repos.growthLedger.insert({ id: newId("glr"), tenantId: a.tenantId, report, createdAt: now });
    for (const tk of report.openTickets) {
      await deps.repos.growthTickets.upsert({
        id: newId("gtk"), tenantId: a.tenantId, fromQuestion: body.query, gapCode: tk.gapCode,
        ioContract: { inputs: Object.keys(body.context.filters ?? {}), outputShape: [] },
        ontologyRefs: { objectTypes: [], slices: [], rules: [] },
        acceptance: `问句「${body.query}」应能答出可验证答案并过门禁`, status: "OPEN", createdAt: now,
      });
    }
    return reply.status(200).send(report);
  });

  // P4：成长账本（demand-indexed）—— 每个客户问题→缺口→补法→终态→工单，发现盲区/量化覆盖度。
  app.get("/api/v1/growth/ledger", async (req) => {
    const a = await auth(req);
    return { items: await deps.repos.growthLedger.listByTenant(a.tenantId) };
  });
  // P4：成长工单（缺功能的厂商中立施工契约；OPEN→…→VERIFIED）。
  app.get("/api/v1/growth/tickets", async (req) => {
    const a = await auth(req);
    return { items: await deps.repos.growthTickets.listByTenant(a.tenantId) };
  });

  // P5：code-agent 执行器接缝——工单领取/草稿/重跑验证闭环（厂商中立：任意 agent 经 REST/CLI/MCP 同面操作）。
  const getTicket = async (tenantId: string, id: string) => {
    const tk = (await deps.repos.growthTickets.listByTenant(tenantId)).find((t) => t.id === id);
    if (!tk) throw new HttpError(404, "TICKET_NOT_FOUND", `growth ticket not found: ${id}`);
    return tk;
  };
  app.post("/api/v1/growth/tickets/:id/claim", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const { assignee } = (req.body ?? {}) as { assignee?: string };
    const tk = await getTicket(a.tenantId, id);
    const updated = { ...tk, status: "IN_PROGRESS" as const, assignee: assignee ?? a.userId };
    await deps.repos.growthTickets.upsert(updated);
    return updated;
  });
  app.post("/api/v1/growth/tickets/:id/submit", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const tk = await getTicket(a.tenantId, id);
    await deps.repos.growthTickets.upsert({ ...tk, status: "IN_REVIEW" });
    return { ...tk, status: "IN_REVIEW" };
  });
  // 重跑验证：施工合并后重跑该工单的问句 → 若现在可答 → VERIFIED（闭环收敛）；否则停 IN_REVIEW 并回带新缺口。
  app.post("/api/v1/growth/tickets/:id/verify", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const ctxBody = (req.body ?? {}) as { context?: Record<string, unknown> };
    const tk = await getTicket(a.tenantId, id);
    const pkg = (await deps.repos.packages.listByTenant(a.tenantId))[0];
    if (!pkg) throw new HttpError(404, "PACKAGE_NOT_FOUND", "no package");
    const probeBody = SubmitQueryBodySchema.parse({ packageId: pkg.id, query: tk.fromQuestion, context: { view: "dash", selectedObjects: [], filters: {}, ...(ctxBody.context ?? {}) } });
    const { taskId } = await deps.orchestrator.submitQuery(a, probeBody);
    const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
    let task = await deps.repos.tasks.get(taskId);
    for (let i = 0; i < 100 && (!task || !TERMINAL.has(task.status)); i++) {
      await new Promise((r) => setTimeout(r, 50));
      task = await deps.repos.tasks.get(taskId);
    }
    const gap = classifyGap(task!);
    const verified = gap.verdict === "ANSWERABLE";
    const updated = { ...tk, status: verified ? ("VERIFIED" as const) : ("IN_REVIEW" as const) };
    await deps.repos.growthTickets.upsert(updated);
    return { ticket: updated, verified, gapReport: gap };
  });

  // Phase9C 推演历史列表：按租户列最近任务（id/问句/路径/状态/结论摘要/时间），供"推演历史"页浏览+重放。
  app.get("/api/v1/queries", async (req) => {
    const a = await auth(req);
    const q = req.query as { limit?: string };
    const limit = Math.min(Math.max(1, Number(q.limit ?? "50") || 50), 200);
    const tasks = await deps.repos.tasks.listByTenant(a.tenantId, limit);
    return {
      items: tasks.map((t) => {
        const firstText = t.answer?.blocks.find((b) => b.type === "text");
        const answerText = firstText && firstText.type === "text" ? firstText.markdown : "";
        return {
          taskId: t.id,
          query: t.query,
          path: t.path ?? null,
          status: t.status,
          view: (t.context as { view?: string } | undefined)?.view ?? null,
          conversationId: t.conversationId,
          classification: t.classification ?? null,
          answerSummary: answerText.slice(0, 200),
          createdAt: t.createdAt,
          completedAt: t.completedAt ?? null,
        };
      }),
      total: tasks.length,
    };
  });

  app.get("/api/v1/queries/:taskId/events", async (req, reply) => {
    const a = await auth(req);
    const { taskId } = req.params as { taskId: string };
    const task = await deps.repos.tasks.get(taskId);
    if (!task || task.tenantId !== a.tenantId) {
      throw new HttpError(404, "TASK_NOT_FOUND", `task not found: ${taskId}`);
    }
    await streamTaskEvents(req, reply, deps.events, taskId);
    return reply;
  });

  app.post("/api/v1/queries/:taskId/clarification", async (req, reply) => {
    const a = await auth(req);
    const { taskId } = req.params as { taskId: string };
    const body = ClarificationReplyBodySchema.parse(req.body);
    await deps.orchestrator.handleClarification(taskId, a, body);
    return reply.status(202).send({ taskId, status: "ROUTING" });
  });

  app.post("/api/v1/queries/:taskId/cancel", async (req, reply) => {
    const a = await auth(req);
    const { taskId } = req.params as { taskId: string };
    await deps.orchestrator.cancel(taskId, a);
    return reply.status(202).send({ taskId });
  });

  app.post("/api/v1/queries/:taskId/feedback", async (req, reply) => {
    const a = await auth(req);
    const { taskId } = req.params as { taskId: string };
    const body = z.object({ vote: z.enum(["UP", "DOWN"]) }).parse(req.body);
    await deps.orchestrator.feedback(taskId, a, body.vote);
    return reply.status(204).send();
  });

  app.get("/api/v1/queries/:taskId", async (req) => {
    const a = await auth(req);
    const { taskId } = req.params as { taskId: string };
    const task = await deps.repos.tasks.get(taskId);
    if (!task || task.tenantId !== a.tenantId) {
      throw new HttpError(404, "TASK_NOT_FOUND", `task not found: ${taskId}`);
    }
    return task;
  });

  // 活数据可溯（PRD-live-traceable-data §3.2，结果→入参对象）：一次推演结果引用了哪些对象。
  // 收集本任务的 selectedObjects + objectRef 槽位 → 每个对象前端再经 DataCore 对象 lineage
  // 溯回原始行/连接器，形成"结果 → 入参对象 → 原始数据"的完整可溯链。
  app.get("/api/v1/queries/:taskId/lineage", async (req) => {
    const a = await auth(req);
    const { taskId } = req.params as { taskId: string };
    const task = await deps.repos.tasks.get(taskId);
    if (!task || task.tenantId !== a.tenantId) {
      throw new HttpError(404, "TASK_NOT_FOUND", `task not found: ${taskId}`);
    }
    const seen = new Set<string>();
    const inputObjects: { objectType: string; objectId: string; label?: string; via: string }[] = [];
    const push = (o: unknown, via: string) => {
      if (o && typeof o === "object") {
        const r = o as { objectType?: unknown; objectId?: unknown; label?: unknown };
        if (typeof r.objectType === "string" && typeof r.objectId === "string") {
          const k = `${r.objectType}|${r.objectId}`;
          if (!seen.has(k)) {
            seen.add(k);
            inputObjects.push({ objectType: r.objectType, objectId: r.objectId, label: typeof r.label === "string" ? r.label : undefined, via });
          }
        }
      }
    };
    for (const o of task.context?.selectedObjects ?? []) push(o, "selectedObjects");
    for (const [name, v] of Object.entries(task.slots ?? {})) push(v, `slot:${name}`);
    return { taskId, query: task.query, matchedIntent: task.matchedIntent ?? null, inputObjects };
  });

  // ---------------------------------------------------------------------
  // Catalog management §8.4 (role catalog_admin)
  // ---------------------------------------------------------------------
  app.get("/api/v1/catalog/packages/:packageId/intents", async (req) => {
    await auth(req);
    const { packageId } = req.params as { packageId: string };
    const q = req.query as { view?: string; status?: string };
    return deps.catalog.listIntents(packageId, q);
  });

  app.post("/api/v1/catalog/packages/:packageId/intents", async (req, reply) => {
    const a = await auth(req);
    requireRole(a, "catalog_admin");
    const { packageId } = req.params as { packageId: string };
    const body = CreateIntentBodySchema.parse(req.body);
    return reply.status(201).send(await deps.catalog.createIntent(packageId, body));
  });

  app.put("/api/v1/catalog/intents/:intentId", async (req) => {
    const a = await auth(req);
    requireRole(a, "catalog_admin");
    const { intentId } = req.params as { intentId: string };
    const body = UpdateIntentBodySchema.parse(req.body);
    return deps.catalog.updateIntent(intentId, body);
  });

  app.post("/api/v1/catalog/intents/:intentId/publish", async (req) => {
    const a = await auth(req);
    requireRole(a, "catalog_admin");
    const { intentId } = req.params as { intentId: string };
    return deps.catalog.publishIntent(intentId);
  });

  app.post("/api/v1/catalog/intents/:intentId/retire", async (req) => {
    const a = await auth(req);
    requireRole(a, "catalog_admin");
    const { intentId } = req.params as { intentId: string };
    return deps.catalog.retireIntent(intentId);
  });

  app.get("/api/v1/catalog/packages/:packageId/plans", async (req) => {
    await auth(req);
    const { packageId } = req.params as { packageId: string };
    return deps.catalog.listPlans(packageId, req.query as { status?: string });
  });

  app.post("/api/v1/catalog/packages/:packageId/plans", async (req, reply) => {
    const a = await auth(req);
    requireRole(a, "catalog_admin");
    const { packageId } = req.params as { packageId: string };
    const body = CreatePlanBodySchema.parse(req.body);
    return reply.status(201).send(await deps.catalog.createPlan(packageId, body));
  });

  app.put("/api/v1/catalog/plans/:planId", async (req) => {
    const a = await auth(req);
    requireRole(a, "catalog_admin");
    const { planId } = req.params as { planId: string };
    const body = CreatePlanBodySchema.partial().parse(req.body);
    return deps.catalog.updatePlan(planId, body);
  });

  app.post("/api/v1/catalog/plans/:planId/publish", async (req) => {
    const a = await auth(req);
    requireRole(a, "catalog_admin");
    const { planId } = req.params as { planId: string };
    return deps.catalog.publishPlan(planId);
  });

  // ---------------------------------------------------------------------
  // Ops §8.5 (孵化闭环)
  // ---------------------------------------------------------------------
  app.get("/api/v1/ops/fallback-stats", async (req) => {
    const a = await auth(req);
    const q = req.query as { packageId?: string; from?: string; to?: string };
    return fallbackStats(deps.repos, { tenantId: a.tenantId, ...q });
  });

  app.post("/api/v1/ops/fallback/:traceId/promote", async (req, reply) => {
    const a = await auth(req);
    requireRole(a, "catalog_admin");
    const { traceId } = req.params as { traceId: string };
    return reply.status(201).send(await promoteFallbackTrace(deps.repos, a.tenantId, traceId));
  });

  // ---------------------------------------------------------------------
  // B1 Agent registry
  // ---------------------------------------------------------------------
  const CreateAgentBody = AgentDefinitionSchema.omit({ id: true, tenantId: true, version: true, status: true });

  app.get("/b/v1/agents", async (req, reply) => {
    const a = await auth(req);
    // 管理平台增量 §4：?status=&q= 过滤 + 分页 50（响应保持数组形态，total 经 x-total-count）。
    const { items, total } = applyListQuery(await deps.repos.agents.listByTenant(a.tenantId), req.query as ListQuery);
    reply.header("x-total-count", String(total));
    return items;
  });

  app.get("/b/v1/agents/:id", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const agent = await deps.repos.agents.get(id);
    if (!agent || agent.tenantId !== a.tenantId) throw new HttpError(404, "AGENT_NOT_FOUND", `agent not found: ${id}`);
    // 管理平台增量 §4：详情含同 key 版本列表
    const versions = (await deps.repos.agents.listByTenant(a.tenantId))
      .filter((x) => x.key === agent.key)
      .sort((x, y) => y.version - x.version)
      .map((x) => ({ id: x.id, version: x.version, status: x.status }));
    return { ...agent, versions };
  });

  app.post("/b/v1/agents", async (req, reply) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const body = CreateAgentBody.parse(req.body);
    const existing = await deps.repos.agents.latestByKey(a.tenantId, body.key);
    const agent: AgentDefinition = {
      ...body,
      id: newId("agt"),
      tenantId: a.tenantId,
      version: (existing?.version ?? 0) + 1,
      status: "DRAFT",
    };
    await deps.repos.agents.insert(agent);
    return reply.status(201).send(agent);
  });

  app.put("/b/v1/agents/:id", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const agent = await deps.repos.agents.get(id);
    if (!agent || agent.tenantId !== a.tenantId) throw new HttpError(404, "AGENT_NOT_FOUND", `agent not found: ${id}`);
    // 管理平台增量 §4：PUBLISHED 版本不可变 → 409 IMMUTABLE_VERSION（new-version 派生新 DRAFT 再改）
    if (agent.status !== "DRAFT") throw new HttpError(409, ErrorCodes.IMMUTABLE_VERSION, "仅 DRAFT 状态的 agent 可修改（请用 new-version 派生）");
    const body = CreateAgentBody.partial().parse(req.body);
    const updated = { ...agent, ...body, id: agent.id, tenantId: agent.tenantId, version: agent.version } as AgentDefinition;
    await deps.repos.agents.update(updated);
    return updated;
  });

  app.post("/b/v1/agents/:id/publish", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const agent = await deps.repos.agents.get(id);
    if (!agent || agent.tenantId !== a.tenantId) throw new HttpError(404, "AGENT_NOT_FOUND", `agent not found: ${id}`);
    if (agent.status !== "DRAFT") throw new HttpError(409, ErrorCodes.INVALID_STATE, "仅 DRAFT 状态的 agent 可发布");
    // 发布前置校验（最小授权声明 / 提示词非空）→ 200 {ok:false, errors[{field,message}]}
    // （前端 PRD §7.8：发布错误内联渲染在编辑器分区，而非 4xx toast）
    const fieldErrors: { field: string; message: string }[] = [];
    if (agent.scopeDeclaration.objectTypes.length === 0) {
      fieldErrors.push({ field: "scopeDeclaration.objectTypes", message: "必须声明对象类型范围（最小授权）" });
    }
    if (!agent.systemPrompt.trim()) {
      fieldErrors.push({ field: "systemPrompt", message: "系统提示词不能为空" });
    }
    // 管理平台增量 §4 发布校验：模型 ID 合法 + 工具/技能/MCP 引用存在
    if (!agent.model.trim() || !/^[\w][\w.:/-]*$/.test(agent.model)) {
      fieldErrors.push({ field: "model", message: `模型 ID 非法：「${agent.model}」` });
    }
    for (const tool of agent.tools) {
      if (tool.kind === "BUILTIN" && !builtinTool(tool.name)) {
        fieldErrors.push({ field: "tools", message: `内置工具不存在：${tool.name}` });
      } else if (tool.kind === "MCP") {
        const cfg = await deps.repos.mcpConfigs.get(tool.mcpConfigId);
        if (!cfg || cfg.tenantId !== a.tenantId) fieldErrors.push({ field: "tools", message: `MCP 配置不存在：${tool.mcpConfigId}` });
      } else if (tool.kind === "WORKFLOW") {
        const wf = await deps.repos.workflows.get(tool.workflowId);
        if (!wf || wf.tenantId !== a.tenantId) fieldErrors.push({ field: "tools", message: `工作流不存在：${tool.workflowId}` });
      }
    }
    for (const sref of agent.skills) {
      const sk = await deps.repos.skills.get(sref.skillId);
      if (!sk || sk.tenantId !== a.tenantId) fieldErrors.push({ field: "skills", message: `技能不存在：${sref.skillId}` });
    }
    for (const m of agent.mcpServers) {
      const cfg = await deps.repos.mcpConfigs.get(m.mcpConfigId);
      if (!cfg || cfg.tenantId !== a.tenantId) fieldErrors.push({ field: "mcpServers", message: `MCP 配置不存在：${m.mcpConfigId}` });
    }
    // B→A 存在性探针（引用闭合）：scopeDeclaration 声明的对象类型必须在 DataCore 本体存在。
    if (agent.scopeDeclaration.objectTypes.length > 0) {
      const missing = await probeMissingRefs(deps.dataCore, a, { objectTypes: agent.scopeDeclaration.objectTypes });
      for (const t of missing.objectTypes) fieldErrors.push({ field: "scopeDeclaration.objectTypes", message: `对象类型「${t}」在 DataCore 本体不存在（死路）` });
    }
    if (fieldErrors.length > 0) return { ok: false, errors: fieldErrors };
    const cycle = await detectStaticCycle(deps.repos, { kind: "agent", id }, { agent });
    if (cycle) {
      throw new HttpError(400, ErrorCodes.CYCLIC_INVOCATION, `发布被拒：静态可达环 ${cycle.join(" -> ")}`);
    }
    // AIP Evals §2 发布门禁：存在 agent_quality 用例时必跑，通过率 < 上一次运行 → 阻断
    // （force=true 审计豁免）；无用例则跳过（没有关联套件即无回归项）。
    const evalCases = await deps.repos.evalCases.listByTenant(a.tenantId, "agent_quality");
    if (evalCases.length > 0) {
      const { force } = req.query as { force?: string };
      const run = await deps.evals.run(a, "agent_quality", { agentKey: agent.key });
      const prior = (await deps.repos.evalRuns.listByTenant(a.tenantId))
        .filter((r) => r.suite === "agent_quality" && r.agentKey === agent.key && r.id !== run.id)
        .sort((x, y) => (x.startedAt > y.startedAt ? -1 : 1))[0];
      if (prior && run.passRate < prior.passRate && force !== "true") {
        return { ok: false, errors: [{ field: "eval", message: `评测回归：本次通过率 ${run.passRate} < 上次 ${prior.passRate}（agent_quality）；修复用例或 force=true 审计豁免` }], evalRunId: run.id };
      }
    }
    const all = await deps.repos.agents.listByTenant(a.tenantId);
    for (const s of all) {
      if (s.key === agent.key && s.id !== agent.id && s.status === "PUBLISHED") {
        await deps.repos.agents.update({ ...s, status: "RETIRED" });
      }
    }
    const published = { ...agent, status: "PUBLISHED" as const };
    await deps.repos.agents.update(published);
    // 引用模式增量 §2.3：agent 出向规则引用上报 A（影响面反查事实源，fire-and-forget）
    const ruleRefs = agentRuleRefs(published);
    if (deps.reportRefs && ruleRefs.length > 0) {
      void deps.reportRefs(a.tenantId, { source: { kind: "agent", key: published.key, name: published.name }, refs: ruleRefs });
    }
    // 前端消费形态 { ok, ...agent }（SPA AgentsPage 读 r.ok / r.errors）
    return { ok: true, ...published };
  });

  // ---- 管理平台增量 §4：agents 统一资源模式（new-version / retire / references / delete） ----
  const ConfirmBody = z.object({ confirm: z.boolean().default(false) });

  app.post("/b/v1/agents/:id/new-version", async (req, reply) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const src = await deps.repos.agents.get(id);
    if (!src || src.tenantId !== a.tenantId) throw new HttpError(404, "AGENT_NOT_FOUND", `agent not found: ${id}`);
    const latest = await deps.repos.agents.latestByKey(a.tenantId, src.key);
    const copy: AgentDefinition = { ...src, id: newId("agt"), version: (latest?.version ?? src.version) + 1, status: "DRAFT" };
    await deps.repos.agents.insert(copy);
    return reply.status(201).send(copy);
  });

  app.get("/b/v1/agents/:id/references", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const agent = await deps.repos.agents.get(id);
    if (!agent || agent.tenantId !== a.tenantId) throw new HttpError(404, "AGENT_NOT_FOUND", `agent not found: ${id}`);
    const references = await computeReferences(deps.repos, a.tenantId, "agent", id);
    return { references, count: references.length };
  });

  app.post("/b/v1/agents/:id/retire", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const agent = await deps.repos.agents.get(id);
    if (!agent || agent.tenantId !== a.tenantId) throw new HttpError(404, "AGENT_NOT_FOUND", `agent not found: ${id}`);
    const refs = await computeReferences(deps.repos, a.tenantId, "agent", id);
    assertRetireOrDelete("retire", refs, ConfirmBody.parse(req.body ?? {}).confirm);
    const retired = { ...agent, status: "RETIRED" as const };
    await deps.repos.agents.update(retired);
    return retired;
  });

  app.delete("/b/v1/agents/:id", async (req, reply) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const agent = await deps.repos.agents.get(id);
    if (!agent || agent.tenantId !== a.tenantId) throw new HttpError(404, "AGENT_NOT_FOUND", `agent not found: ${id}`);
    const refs = await computeReferences(deps.repos, a.tenantId, "agent", id);
    assertRetireOrDelete("delete", refs, true);
    await deps.repos.agents.remove(id);
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------------
  // B2 Workflows
  // ---------------------------------------------------------------------
  const CreateWorkflowBody = WorkflowDefinitionSchema.omit({
    id: true,
    tenantId: true,
    version: true,
    status: true,
    createdAt: true,
    updatedAt: true,
  });

  // 管理面闭合性 §1：ExecutionPlan ≡ Workflow。kind 由步骤类型自动判定——含
  // invoke_agent/invoke_mcp_tool → ORCHESTRATION，否则 PLAN（kind=PLAN 即"执行计划"，
  // 是意图 workflowRef 绑定下拉的唯一来源）。
  const workflowKind = (wf: WorkflowDefinition): "PLAN" | "ORCHESTRATION" =>
    wf.steps.some((s) => s.type === "invoke_agent" || s.type === "invoke_mcp_tool") ? "ORCHESTRATION" : "PLAN";
  const withKind = <T extends WorkflowDefinition>(wf: T) => ({ ...wf, kind: workflowKind(wf) });

  // 管理面闭合性 §4：求解器目录（只读）——workflow 步骤 solverKey 下拉的数据源。
  // 复用能力路由增量 §1 的 DataCore 目录（含 description/argHints）。求解器由平台提供、
  // 不可自助创建，但必须可见（合法的"可见不可创建"边界，非死路）。
  app.get("/b/v1/solvers", async (req) => {
    const a = await auth(req);
    const { query } = req.query as { query?: string };
    try {
      const out = await deps.dataCore.catalog.discover(a, "solvers", query);
      return { ...out, createHint: "求解器由平台提供，如需新增请联系实施" };
    } catch {
      return { items: [], createHint: "求解器由平台提供，如需新增请联系实施" };
    }
  });

  app.get("/b/v1/workflows", async (req, reply) => {
    const a = await auth(req);
    const { kind } = req.query as { kind?: string };
    let list = await deps.repos.workflows.listByTenant(a.tenantId);
    if (kind === "PLAN" || kind === "ORCHESTRATION") list = list.filter((wf) => workflowKind(wf) === kind);
    const { items, total } = applyListQuery(list, req.query as ListQuery);
    reply.header("x-total-count", String(total));
    return items.map(withKind);
  });

  app.get("/b/v1/workflows/:id", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const wf = await deps.repos.workflows.get(id);
    if (!wf || wf.tenantId !== a.tenantId) throw new HttpError(404, "WORKFLOW_NOT_FOUND", `workflow not found: ${id}`);
    const versions = (await deps.repos.workflows.listByTenant(a.tenantId))
      .filter((x) => x.key === wf.key)
      .sort((x, y) => y.version - x.version)
      .map((x) => ({ id: x.id, version: x.version, status: x.status }));
    return { ...withKind(wf), versions };
  });

  // 管理面闭合性 §3：发布前干校验（编辑器实时调用）——同发布校验但不改状态。
  app.post("/b/v1/workflows/:id/validate", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const wf = await deps.repos.workflows.get(id);
    if (!wf || wf.tenantId !== a.tenantId) throw new HttpError(404, "WORKFLOW_NOT_FOUND", `workflow not found: ${id}`);
    const msgs = validatePlanSteps(wf.steps, {});
    const errors: { stepId?: string; code: string; message: string }[] = msgs.map((m) => {
      const stepId = /步骤(?: id 重复:)? ?([\w-]+)/.exec(m)?.[1];
      return { ...(stepId && wf.steps.some((s) => s.id === stepId) ? { stepId } : {}), code: ErrorCodes.PLAN_VALIDATION_ERROR, message: m };
    });
    const cycle = errors.length === 0 ? await detectStaticCycle(deps.repos, { kind: "workflow", id }, { workflow: wf }) : undefined;
    if (cycle) errors.push({ code: ErrorCodes.CYCLIC_INVOCATION, message: `静态可达环 ${cycle.join(" -> ")}` });
    return { ok: errors.length === 0, kind: workflowKind(wf), errors };
  });

  app.post("/b/v1/workflows", async (req, reply) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const body = CreateWorkflowBody.parse(req.body);
    const existing = await deps.repos.workflows.latestByKey(a.tenantId, body.key);
    const now = new Date().toISOString();
    const wf: WorkflowDefinition = {
      ...body,
      id: newId("wf"),
      tenantId: a.tenantId,
      version: (existing?.version ?? 0) + 1,
      status: "DRAFT",
      createdAt: now,
      updatedAt: now,
    };
    await deps.repos.workflows.insert(wf);
    return reply.status(201).send(wf);
  });

  app.put("/b/v1/workflows/:id", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const wf = await deps.repos.workflows.get(id);
    if (!wf || wf.tenantId !== a.tenantId) throw new HttpError(404, "WORKFLOW_NOT_FOUND", `workflow not found: ${id}`);
    if (wf.status !== "DRAFT") throw new HttpError(409, ErrorCodes.IMMUTABLE_VERSION, "仅 DRAFT 状态的 workflow 可修改（请用 new-version 派生）");
    const body = CreateWorkflowBody.partial().parse(req.body);
    const updated = { ...wf, ...body, id: wf.id, tenantId: wf.tenantId, version: wf.version, updatedAt: new Date().toISOString() } as WorkflowDefinition;
    await deps.repos.workflows.update(updated);
    return updated;
  });

  app.post("/b/v1/workflows/:id/publish", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const body = z.object({ force: z.boolean().default(false) }).parse(req.body ?? {});
    const wf = await deps.repos.workflows.get(id);
    if (!wf || wf.tenantId !== a.tenantId) throw new HttpError(404, "WORKFLOW_NOT_FOUND", `workflow not found: ${id}`);
    if (wf.status !== "DRAFT") throw new HttpError(409, ErrorCodes.INVALID_STATE, "仅 DRAFT 状态的 workflow 可发布");
    // 前端 PRD §7.8：发布校验错误定位到步骤行 → 200 {ok:false, errors[{stepId?,code,message}]}
    const msgs = validatePlanSteps(wf.steps, {});
    const stepErrors: { stepId?: string; code: string; message: string }[] = msgs.map((m) => {
      const stepId = /步骤(?: id 重复:)? ?([\w-]+)/.exec(m)?.[1];
      return { ...(stepId && wf.steps.some((s) => s.id === stepId) ? { stepId } : {}), code: ErrorCodes.PLAN_VALIDATION_ERROR, message: m };
    });
    const cycle = stepErrors.length === 0
      ? await detectStaticCycle(deps.repos, { kind: "workflow", id }, { workflow: wf })
      : undefined;
    if (cycle) {
      stepErrors.push({ code: ErrorCodes.CYCLIC_INVOCATION, message: `发布被拒：静态可达环 ${cycle.join(" -> ")}` });
    }
    // B→A 存在性探针（引用闭合）：步骤引用的求解器/规则必须在 DataCore 真实存在（无死路）。
    if (stepErrors.length === 0) {
      const solverKeys: string[] = [];
      const ruleKeys: string[] = [];
      for (const st of wf.steps) {
        const p = st.params as Record<string, unknown>;
        if (st.type === "invoke_solver" && typeof p.solverKey === "string") solverKeys.push(p.solverKey);
        if (st.type === "evaluate_rules" && Array.isArray(p.ruleIds)) for (const r of p.ruleIds as unknown[]) if (typeof r === "string") ruleKeys.push(r);
      }
      const missing = await probeMissingRefs(deps.dataCore, a, { solverKeys, ruleKeys });
      for (const s of missing.solvers) {
        const stepId = wf.steps.find((st) => (st.params as Record<string, unknown>).solverKey === s)?.id;
        stepErrors.push({ ...(stepId ? { stepId } : {}), code: ErrorCodes.VALIDATION_ERROR, message: `求解器「${s}」在 DataCore 未注册（死路）` });
      }
      for (const r of missing.rules) {
        const stepId = wf.steps.find((st) => Array.isArray((st.params as Record<string, unknown>).ruleIds) && ((st.params as Record<string, unknown>).ruleIds as string[]).includes(r))?.id;
        stepErrors.push({ ...(stepId ? { stepId } : {}), code: ErrorCodes.VALIDATION_ERROR, message: `规则「${r}」在 DataCore 规则库不存在（死路）` });
      }
    }
    if (stepErrors.length > 0) return { ok: false, errors: stepErrors };

    // 引用模式增量 §2.3：影响面（latest 引用本 key 的 agent —— references 反查）
    const allWorkflows = await deps.repos.workflows.listByTenant(a.tenantId);
    const siblingIds = new Set(allWorkflows.filter((x) => x.key === wf.key).map((x) => x.id));
    const allAgents = await deps.repos.agents.listByTenant(a.tenantId);
    const latestReferrers = allAgents.filter(
      (ag) =>
        ag.status !== "RETIRED" &&
        ag.tools.some((t) => t.kind === "WORKFLOW" && t.version === "latest" && siblingIds.has(t.workflowId)),
    );
    const impact = {
      agents: latestReferrers.length,
      plans: 0,
      intents: 0,
      refs: latestReferrers.map((ag) => ({ kind: "agent" as const, key: ag.key, version: ag.version, name: ag.name })),
    };

    // §2.3 兼容性门禁：inputs schema 破坏性变更 + 存在 latest 引用方 → 发布被拒
    const prevPublished = allWorkflows
      .filter((x) => x.key === wf.key && x.id !== wf.id && x.status === "PUBLISHED")
      .sort((x, y) => y.version - x.version)[0];
    const breaking = prevPublished ? detectBreakingSchemaChange(prevPublished.inputs, wf.inputs) : [];
    let forced = false;
    if (breaking.length > 0 && latestReferrers.length > 0) {
      if (!body.force) {
        throw new HttpError(
          409,
          ErrorCodes.BREAKING_CHANGE_WITH_LATEST_REFS,
          `破坏性变更（${breaking.join("；")}）且存在 latest 引用方：${latestReferrers
            .map((x) => `agent:${x.name}(${x.key})`)
            .join("、")}。可改为兼容、让引用方先 pin，或同步升级引用方后用 force=true（catalog_admin，全审计）`,
        );
      }
      forced = true;
      // force 发布全审计（结构化日志 + 事件留痕，便于追责）
      req.log.warn(
        { workflowKey: wf.key, version: wf.version, breaking, referrers: latestReferrers.map((x) => x.key), user: a.userId },
        "BREAKING_CHANGE force publish",
      );
    }

    const published = { ...wf, status: "PUBLISHED" as const, updatedAt: new Date().toISOString() };
    await deps.repos.workflows.update(published);
    // §2.3：workflow 出向规则引用上报 A
    const wfRuleRefs = planStepRuleRefs(published.steps);
    if (deps.reportRefs && wfRuleRefs.length > 0) {
      void deps.reportRefs(a.tenantId, { source: { kind: "workflow", key: published.key, name: published.name }, refs: wfRuleRefs });
    }
    // 前端消费形态 { ok, ...workflow }（SPA WorkflowsPage 读 r.ok / r.errors）；§2.3 附 impact
    return { ok: true, ...published, impact, ...(forced ? { forced: true, breakingChanges: breaking } : {}) };
  });

  // ---- 管理平台增量 §4：workflows 统一资源模式 ----
  app.post("/b/v1/workflows/:id/new-version", async (req, reply) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const src = await deps.repos.workflows.get(id);
    if (!src || src.tenantId !== a.tenantId) throw new HttpError(404, "WORKFLOW_NOT_FOUND", `workflow not found: ${id}`);
    const latest = await deps.repos.workflows.latestByKey(a.tenantId, src.key);
    const now = new Date().toISOString();
    const copy: WorkflowDefinition = {
      ...src,
      id: newId("wf"),
      version: (latest?.version ?? src.version) + 1,
      status: "DRAFT",
      createdAt: now,
      updatedAt: now,
    };
    await deps.repos.workflows.insert(copy);
    return reply.status(201).send(copy);
  });

  app.get("/b/v1/workflows/:id/references", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const wf = await deps.repos.workflows.get(id);
    if (!wf || wf.tenantId !== a.tenantId) throw new HttpError(404, "WORKFLOW_NOT_FOUND", `workflow not found: ${id}`);
    const references = await computeReferences(deps.repos, a.tenantId, "workflow", id);
    return { references, count: references.length };
  });

  // rule/solver 反查（响应式失效环可见性）：改了规则/求解器 → 哪些编排资源引用它（DataCore 资源按 key 反查）。
  app.get("/b/v1/rules/:key/references", async (req) => {
    const a = await auth(req);
    const { key } = req.params as { key: string };
    const references = await computeReferences(deps.repos, a.tenantId, "rule", key);
    return { references, count: references.length };
  });
  app.get("/b/v1/solvers/:key/references", async (req) => {
    const a = await auth(req);
    const { key } = req.params as { key: string };
    const references = await computeReferences(deps.repos, a.tenantId, "solver", key);
    return { references, count: references.length };
  });

  app.post("/b/v1/workflows/:id/retire", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const wf = await deps.repos.workflows.get(id);
    if (!wf || wf.tenantId !== a.tenantId) throw new HttpError(404, "WORKFLOW_NOT_FOUND", `workflow not found: ${id}`);
    const refs = await computeReferences(deps.repos, a.tenantId, "workflow", id);
    assertRetireOrDelete("retire", refs, z.object({ confirm: z.boolean().default(false) }).parse(req.body ?? {}).confirm);
    const retired = { ...wf, status: "RETIRED" as const, updatedAt: new Date().toISOString() };
    await deps.repos.workflows.update(retired);
    return retired;
  });

  app.delete("/b/v1/workflows/:id", async (req, reply) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const wf = await deps.repos.workflows.get(id);
    if (!wf || wf.tenantId !== a.tenantId) throw new HttpError(404, "WORKFLOW_NOT_FOUND", `workflow not found: ${id}`);
    const refs = await computeReferences(deps.repos, a.tenantId, "workflow", id);
    assertRetireOrDelete("delete", refs, true);
    await deps.repos.workflows.remove(id);
    return reply.status(204).send();
  });

  /** Standalone workflow run with step.* event stream (platform §8.2). */
  app.post("/b/v1/workflows/:id/run", async (req, reply) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const wf = await deps.repos.workflows.get(id);
    if (!wf || wf.tenantId !== a.tenantId) throw new HttpError(404, "WORKFLOW_NOT_FOUND", `workflow not found: ${id}`);
    const body = z.object({ inputs: z.record(z.string(), z.unknown()).default({}) }).parse(req.body ?? {});
    const runId = newId("wfr");
    await deps.events.emit(runId, "task.accepted", { taskId: runId });
    const budget = new BudgetTracker();
    const result = await deps.engine.runWorkflowSteps({
      taskId: runId,
      steps: wf.steps,
      slots: body.inputs,
      context: {},
      ctx: a,
      nesting: { callChain: [], budget }, // top-level run not counted toward nesting depth
      emit: (e, p) => deps.events.emit(runId, e, p).then(() => undefined),
    });
    if (result.status === "FAILED") {
      await deps.events.emit(runId, "task.failed", result.error);
      return reply.status(200).send({ runId, status: "FAILED", error: result.error, stepOutputs: result.stepOutputs });
    }
    await deps.events.emit(runId, "answer.final", result.answer);
    return reply
      .status(200)
      .send({ runId, status: "COMPLETED", answer: result.answer, stepOutputs: result.stepOutputs });
  });

  app.get("/b/v1/workflow-runs/:runId/events", async (req, reply) => {
    await auth(req);
    const { runId } = req.params as { runId: string };
    await streamTaskEvents(req, reply, deps.events, runId);
    return reply;
  });

  // ---------------------------------------------------------------------
  // B4 Skills
  // ---------------------------------------------------------------------
  const CreateSkillBody = SkillDefinitionSchema.omit({ id: true, tenantId: true, version: true, status: true });

  app.get("/b/v1/skills", async (req, reply) => {
    const a = await auth(req);
    const { items, total } = applyListQuery(await deps.repos.skills.listByTenant(a.tenantId), req.query as ListQuery);
    reply.header("x-total-count", String(total));
    return items;
  });

  // 管理平台增量 §4：详情（含同 key 版本列表）
  app.get("/b/v1/skills/:id", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const skill = await deps.repos.skills.get(id);
    if (!skill || skill.tenantId !== a.tenantId) throw new HttpError(404, "SKILL_NOT_FOUND", `skill not found: ${id}`);
    const versions = (await deps.repos.skills.listByTenant(a.tenantId))
      .filter((x) => x.key === skill.key)
      .sort((x, y) => y.version - x.version)
      .map((x) => ({ id: x.id, version: x.version, status: x.status }));
    return { ...skill, versions };
  });

  app.post("/b/v1/skills", async (req, reply) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const body = CreateSkillBody.parse(req.body);
    const existing = (await deps.repos.skills.listByTenant(a.tenantId)).filter((s) => s.key === body.key);
    const skill: SkillDefinition = {
      ...body,
      id: newId("skl"),
      tenantId: a.tenantId,
      version: Math.max(0, ...existing.map((s) => s.version)) + 1,
      status: "DRAFT",
    };
    await deps.repos.skills.insert(skill);
    return reply.status(201).send(skill);
  });

  app.put("/b/v1/skills/:id", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const skill = await deps.repos.skills.get(id);
    if (!skill || skill.tenantId !== a.tenantId) throw new HttpError(404, "SKILL_NOT_FOUND", `skill not found: ${id}`);
    if (skill.status !== "DRAFT") throw new HttpError(409, ErrorCodes.IMMUTABLE_VERSION, "仅 DRAFT 状态的 skill 可修改（请用 new-version 派生）");
    const body = CreateSkillBody.partial().parse(req.body);
    const updated = { ...skill, ...body, id: skill.id, tenantId: skill.tenantId, version: skill.version } as SkillDefinition;
    await deps.repos.skills.update(updated);
    return updated;
  });

  app.post("/b/v1/skills/:id/publish", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const skill = await deps.repos.skills.get(id);
    if (!skill || skill.tenantId !== a.tenantId) throw new HttpError(404, "SKILL_NOT_FOUND", `skill not found: ${id}`);
    // Skill 编写规范 §4 门禁一：结构 lint 必过（force=true 走审计豁免）。
    const { force } = req.query as { force?: string };
    const lint = lintSkill(skill);
    if (!lint.ok && force !== "true") {
      throw new HttpError(422, "SKILL_LINT_FAILED", `技能结构 lint 未通过（${lint.violations.length} 项）：${lint.violations.map((x) => x.rule).join(", ")}`);
    }
    const published = { ...skill, status: "PUBLISHED" as const };
    await deps.repos.skills.update(published);
    // 引用模式增量 §2.3：影响面（引用同 key 任一版本的 agent；latest 下次加载即新内容 — L8）
    const siblingIds = new Set(
      (await deps.repos.skills.listByTenant(a.tenantId)).filter((x) => x.key === skill.key).map((x) => x.id),
    );
    const referrers = (await deps.repos.agents.listByTenant(a.tenantId)).filter(
      (ag) => ag.status !== "RETIRED" && ag.skills.some((sr) => siblingIds.has(sr.skillId)),
    );
    const impact = {
      agents: referrers.length,
      plans: 0,
      intents: 0,
      refs: referrers.map((ag) => ({ kind: "agent" as const, key: ag.key, version: ag.version, name: ag.name })),
    };
    return { ...published, impact, lint };
  });

  // Skill 编写规范 §4：编辑器「结构 lint」干跑（不改状态；含已存 skill 或临时 body）。
  app.post("/b/v1/skills/lint", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const body = req.body as { id?: string; summary?: string; body?: string; resources?: { name: string }[] };
    let target: { summary: string; body: string; resources: { name: string }[] };
    if (body.id) {
      const skill = await deps.repos.skills.get(body.id);
      if (!skill || skill.tenantId !== a.tenantId) throw new HttpError(404, "SKILL_NOT_FOUND", `skill not found: ${body.id}`);
      target = { summary: skill.summary, body: skill.body, resources: skill.resources };
    } else {
      target = { summary: body.summary ?? "", body: body.body ?? "", resources: body.resources ?? [] };
    }
    return lintSkill(target);
  });

  // ---- 管理平台增量 §4：skills 统一资源模式 ----
  app.post("/b/v1/skills/:id/new-version", async (req, reply) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const src = await deps.repos.skills.get(id);
    if (!src || src.tenantId !== a.tenantId) throw new HttpError(404, "SKILL_NOT_FOUND", `skill not found: ${id}`);
    const siblings = (await deps.repos.skills.listByTenant(a.tenantId)).filter((x) => x.key === src.key);
    const copy: SkillDefinition = { ...src, id: newId("skl"), version: Math.max(...siblings.map((x) => x.version)) + 1, status: "DRAFT" };
    await deps.repos.skills.insert(copy);
    return reply.status(201).send(copy);
  });

  app.get("/b/v1/skills/:id/references", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const skill = await deps.repos.skills.get(id);
    if (!skill || skill.tenantId !== a.tenantId) throw new HttpError(404, "SKILL_NOT_FOUND", `skill not found: ${id}`);
    const references = await computeReferences(deps.repos, a.tenantId, "skill", id);
    return { references, count: references.length };
  });

  app.post("/b/v1/skills/:id/retire", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const skill = await deps.repos.skills.get(id);
    if (!skill || skill.tenantId !== a.tenantId) throw new HttpError(404, "SKILL_NOT_FOUND", `skill not found: ${id}`);
    const refs = await computeReferences(deps.repos, a.tenantId, "skill", id);
    assertRetireOrDelete("retire", refs, z.object({ confirm: z.boolean().default(false) }).parse(req.body ?? {}).confirm);
    const retired = { ...skill, status: "RETIRED" as const };
    await deps.repos.skills.update(retired);
    return retired;
  });

  app.delete("/b/v1/skills/:id", async (req, reply) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const skill = await deps.repos.skills.get(id);
    if (!skill || skill.tenantId !== a.tenantId) throw new HttpError(404, "SKILL_NOT_FOUND", `skill not found: ${id}`);
    const refs = await computeReferences(deps.repos, a.tenantId, "skill", id);
    assertRetireOrDelete("delete", refs, true);
    await deps.repos.skills.remove(id);
    return reply.status(204).send();
  });

  /** Presigned-ish local resource URL target. */
  app.get("/b/v1/skills/:id/resources/:name", async (req) => {
    const a = await auth(req);
    const { id, name } = req.params as { id: string; name: string };
    const skill = await deps.repos.skills.get(id);
    if (!skill || skill.tenantId !== a.tenantId) throw new HttpError(404, "SKILL_NOT_FOUND", `skill not found: ${id}`);
    const resource = skill.resources.find((r) => r.name === name);
    if (!resource) throw new HttpError(404, "RESOURCE_NOT_FOUND", `resource not found: ${name}`);
    return { name: resource.name, blobKey: resource.blobKey };
  });

  // ---------------------------------------------------------------------
  // B3 MCP configs (credentialRef → AES-GCM encrypted credentials, never echoed)
  // 增量 §4.2/§4.3：serverName 命名空间校验 + stdio 安全红线（默认禁用/白名单/角色门）
  // ---------------------------------------------------------------------
  const CreateMcpBody = McpServerConfigSchema.omit({
    id: true,
    tenantId: true,
    credentialRef: true,
    serverName: true,
  }).extend({
    credential: z.string().optional(),
  });

  /** §4.2：serverName 由 name 推导，须命中 ^[a-z0-9_]{2,24}$ 且租户内唯一。 */
  const resolveServerName = async (tenantId: string, name: string, selfId?: string): Promise<string> => {
    const serverName = mcpServerNameSlug(name);
    if (!MCP_SERVER_NAME_RE.test(serverName)) {
      throw new HttpError(
        400,
        ErrorCodes.VALIDATION_ERROR,
        `无法从 name 推导合法 serverName（需满足 ^[a-z0-9_]{2,24}$）：${name}`,
      );
    }
    const all = await deps.repos.mcpConfigs.listByTenant(tenantId);
    for (const c of all) {
      if (c.id === selfId) continue;
      const other = c.serverName ?? mcpServerNameSlug(c.name);
      if (other === serverName) {
        throw new HttpError(409, ErrorCodes.VALIDATION_ERROR, `serverName 租户内必须唯一：${serverName} 已被 ${c.name} 占用`);
      }
    }
    return serverName;
  };

  /** §4.3 红线：stdio 仅 platform_admin 可配（无 admin 兜底）；env 开关 + 白名单 + args 字符集。 */
  const enforceStdioPolicy = (a: RequestAuth, transport: McpServerConfig["transport"]): void => {
    if (transport.type !== "stdio") return;
    if (!a.roles.includes("platform_admin")) {
      throw new HttpError(403, "FORBIDDEN", "stdio 类型的 MCP 配置仅 platform_admin 可创建/修改（RCE 红线）");
    }
    const violation = validateStdioTransport(transport, stdioPolicyFromConfig(deps.config));
    if (violation) {
      throw new HttpError(400, ErrorCodes.VALIDATION_ERROR, `stdio 配置被拒：${violation}`);
    }
  };

  app.get("/b/v1/mcp-configs", async (req, reply) => {
    const a = await auth(req);
    const { items, total } = applyListQuery(await deps.repos.mcpConfigs.listByTenant(a.tenantId), req.query as ListQuery);
    reply.header("x-total-count", String(total));
    return items;
  });

  // §4.4 边界声明：配置页注明文案（本期 tools-only / 静态 bearer）
  app.get("/b/v1/mcp-configs/notes", async (req) => {
    await auth(req);
    return MCP_CONFIG_NOTES;
  });

  app.post("/b/v1/mcp-configs", async (req, reply) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { credential, ...body } = CreateMcpBody.parse(req.body);
    const serverName = await resolveServerName(a.tenantId, body.name);
    enforceStdioPolicy(a, body.transport);
    let credentialRef: string | undefined;
    if (credential) {
      credentialRef = newId("cred");
      await deps.repos.credentials.insert({
        id: credentialRef,
        tenantId: a.tenantId,
        name: `mcp:${body.name}`,
        ciphertext: encryptSecret(credential, deps.config.CREDENTIAL_KEY),
        createdAt: new Date().toISOString(),
      });
    }
    const config: McpServerConfig = {
      ...body,
      id: newId("mcp"),
      tenantId: a.tenantId,
      serverName,
      credentialRef,
      credentialKind: credential ? "static_bearer" : body.credentialKind,
      // 管理平台增量 §4：统一资源模式 —— 创建即 DRAFT v1（旧记录 lifecycle 缺省 = 可变，向后兼容）
      version: body.version ?? 1,
      lifecycle: body.lifecycle ?? "DRAFT",
    };
    await deps.repos.mcpConfigs.insert(config);
    return reply.status(201).send(config);
  });

  // 管理平台增量 §4：详情（含同 serverName 版本列表）
  app.get("/b/v1/mcp-configs/:id", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const cfg = await deps.repos.mcpConfigs.get(id);
    if (!cfg || cfg.tenantId !== a.tenantId) throw new HttpError(404, "MCP_CONFIG_NOT_FOUND", `mcp config not found: ${id}`);
    const sn = cfg.serverName ?? mcpServerNameSlug(cfg.name);
    const versions = (await deps.repos.mcpConfigs.listByTenant(a.tenantId))
      .filter((x) => (x.serverName ?? mcpServerNameSlug(x.name)) === sn)
      .sort((x, y) => (y.version ?? 0) - (x.version ?? 0))
      .map((x) => ({ id: x.id, version: x.version ?? 1, status: x.lifecycle ?? "DRAFT" }));
    return { ...cfg, versions };
  });

  // 前端 PRD §7.8「连接测试」：tools/list 发现结果（失败 → ok:false + message，不抛 5xx）。
  app.post("/b/v1/mcp-configs/:id/test", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const existing = await deps.repos.mcpConfigs.get(id);
    if (!existing || existing.tenantId !== a.tenantId) {
      throw new HttpError(404, "MCP_CONFIG_NOT_FOUND", `mcp config not found: ${id}`);
    }
    if (!deps.mcp) return { ok: false, tools: [], message: "MCP client 未启用" };
    try {
      const tools = await deps.mcp.listTools(id);
      return { ok: true, tools: tools.map((t) => ({ name: t.name, description: t.description })) };
    } catch (err) {
      return { ok: false, tools: [], message: err instanceof Error ? err.message : String(err) };
    }
  });

  app.put("/b/v1/mcp-configs/:id", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const existing = await deps.repos.mcpConfigs.get(id);
    if (!existing || existing.tenantId !== a.tenantId) {
      throw new HttpError(404, "MCP_CONFIG_NOT_FOUND", `mcp config not found: ${id}`);
    }
    // 管理平台增量 §4：PUBLISHED 版本不可变（旧记录 lifecycle 缺省 → 仍可改，向后兼容）
    if (existing.lifecycle === "PUBLISHED") {
      throw new HttpError(409, ErrorCodes.IMMUTABLE_VERSION, "PUBLISHED 的 MCP 配置不可修改（请用 new-version 派生）");
    }
    const { credential, ...body } = CreateMcpBody.partial().parse(req.body);
    // §4.3：既有 stdio 配置的任何修改、或改成 stdio，都走红线校验
    if (existing.transport.type === "stdio" || body.transport?.type === "stdio") {
      enforceStdioPolicy(a, body.transport ?? existing.transport);
    }
    let serverName = existing.serverName ?? mcpServerNameSlug(existing.name);
    if (body.name !== undefined && body.name !== existing.name) {
      serverName = await resolveServerName(a.tenantId, body.name, id);
    }
    let credentialRef = existing.credentialRef;
    if (credential) {
      credentialRef = newId("cred");
      await deps.repos.credentials.insert({
        id: credentialRef,
        tenantId: a.tenantId,
        name: `mcp:${body.name ?? existing.name}`,
        ciphertext: encryptSecret(credential, deps.config.CREDENTIAL_KEY),
        createdAt: new Date().toISOString(),
      });
    }
    const updated: McpServerConfig = { ...existing, ...body, id, tenantId: a.tenantId, serverName, credentialRef };
    await deps.repos.mcpConfigs.update(updated);
    return updated;
  });

  // 增量 §4.1：「刷新工具清单」—— 清掉 schema 缓存（TTL 10min）并重新 tools/list。
  app.post("/b/v1/mcp-configs/:id/refresh-tools", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const existing = await deps.repos.mcpConfigs.get(id);
    if (!existing || existing.tenantId !== a.tenantId) {
      throw new HttpError(404, "MCP_CONFIG_NOT_FOUND", `mcp config not found: ${id}`);
    }
    if (!deps.mcp) return { ok: false, tools: [], message: "MCP client 未启用" };
    try {
      const tools = await (deps.mcp.refreshTools ? deps.mcp.refreshTools(id) : deps.mcp.listTools(id));
      return { ok: true, tools: tools.map((t) => ({ name: t.name, description: t.description })) };
    } catch (err) {
      return { ok: false, tools: [], message: err instanceof Error ? err.message : String(err) };
    }
  });

  // ---- 管理平台增量 §4：mcp-configs 统一资源模式（publish = 连接测试必须通过） ----
  app.post("/b/v1/mcp-configs/:id/publish", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const existing = await deps.repos.mcpConfigs.get(id);
    if (!existing || existing.tenantId !== a.tenantId) {
      throw new HttpError(404, "MCP_CONFIG_NOT_FOUND", `mcp config not found: ${id}`);
    }
    if (existing.lifecycle === "PUBLISHED") {
      throw new HttpError(409, ErrorCodes.INVALID_STATE, "已是 PUBLISHED 状态");
    }
    if (!deps.mcp) return { ok: false, errors: [{ field: "transport", message: "MCP client 未启用，连接测试无法执行" }] };
    try {
      await deps.mcp.listTools(id);
    } catch (err) {
      // 发布校验：连接测试必须通过（前端内联渲染，不抛 5xx）
      return { ok: false, errors: [{ field: "transport", message: `连接测试失败：${err instanceof Error ? err.message : String(err)}` }] };
    }
    const sn = existing.serverName ?? mcpServerNameSlug(existing.name);
    for (const sib of await deps.repos.mcpConfigs.listByTenant(a.tenantId)) {
      if (sib.id !== id && (sib.serverName ?? mcpServerNameSlug(sib.name)) === sn && sib.lifecycle === "PUBLISHED") {
        await deps.repos.mcpConfigs.update({ ...sib, lifecycle: "RETIRED" });
      }
    }
    const published: McpServerConfig = { ...existing, lifecycle: "PUBLISHED", version: existing.version ?? 1 };
    await deps.repos.mcpConfigs.update(published);
    return { ok: true, ...published };
  });

  app.post("/b/v1/mcp-configs/:id/new-version", async (req, reply) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const src = await deps.repos.mcpConfigs.get(id);
    if (!src || src.tenantId !== a.tenantId) throw new HttpError(404, "MCP_CONFIG_NOT_FOUND", `mcp config not found: ${id}`);
    const sn = src.serverName ?? mcpServerNameSlug(src.name);
    const siblings = (await deps.repos.mcpConfigs.listByTenant(a.tenantId)).filter(
      (x) => (x.serverName ?? mcpServerNameSlug(x.name)) === sn,
    );
    const copy: McpServerConfig = {
      ...src,
      id: newId("mcp"),
      version: Math.max(...siblings.map((x) => x.version ?? 1)) + 1,
      lifecycle: "DRAFT",
    };
    await deps.repos.mcpConfigs.insert(copy);
    return reply.status(201).send(copy);
  });

  app.get("/b/v1/mcp-configs/:id/references", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const cfg = await deps.repos.mcpConfigs.get(id);
    if (!cfg || cfg.tenantId !== a.tenantId) throw new HttpError(404, "MCP_CONFIG_NOT_FOUND", `mcp config not found: ${id}`);
    const references = await computeReferences(deps.repos, a.tenantId, "mcp-config", id);
    return { references, count: references.length };
  });

  app.post("/b/v1/mcp-configs/:id/retire", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const cfg = await deps.repos.mcpConfigs.get(id);
    if (!cfg || cfg.tenantId !== a.tenantId) throw new HttpError(404, "MCP_CONFIG_NOT_FOUND", `mcp config not found: ${id}`);
    const refs = await computeReferences(deps.repos, a.tenantId, "mcp-config", id);
    assertRetireOrDelete("retire", refs, z.object({ confirm: z.boolean().default(false) }).parse(req.body ?? {}).confirm);
    const retired: McpServerConfig = { ...cfg, lifecycle: "RETIRED" };
    await deps.repos.mcpConfigs.update(retired);
    return retired;
  });

  app.delete("/b/v1/mcp-configs/:id", async (req, reply) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const cfg = await deps.repos.mcpConfigs.get(id);
    if (!cfg || cfg.tenantId !== a.tenantId) throw new HttpError(404, "MCP_CONFIG_NOT_FOUND", `mcp config not found: ${id}`);
    const refs = await computeReferences(deps.repos, a.tenantId, "mcp-config", id);
    assertRetireOrDelete("delete", refs, true);
    await deps.repos.mcpConfigs.remove(id);
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------------
  // Multi-LLM providers & model bindings (amends QOS-PRD §6 — provider configurable)
  // credentialRef secrets are AES-GCM encrypted like MCP creds and never echoed.
  // ---------------------------------------------------------------------
  const CreateLlmProviderBody = LlmProviderConfigSchema.omit({
    id: true,
    tenantId: true,
    credentialRef: true,
  }).extend({ credential: z.string().optional() });

  // LLM Provider 增量：source of truth 落位 DataCore —— directory 配置时本路由
  // 退化为对 A 的只读薄别名（SPA 兼容）；否则保留 B 本地旧通道。
  app.get("/b/v1/llm/providers", async (req) => {
    const a = await auth(req);
    if (deps.providerDirectory) {
      return deps.providerDirectory.providers(a.tenantId);
    }
    return deps.repos.llmProviders.listByTenant(a.tenantId);
  });

  app.post("/b/v1/llm/providers", async (req, reply) => {
    const a = await auth(req);
    requireRole(a, "catalog_admin");
    const { credential, ...body } = CreateLlmProviderBody.parse(req.body);
    let credentialRef: string | undefined;
    if (credential) {
      credentialRef = newId("cred");
      await deps.repos.credentials.insert({
        id: credentialRef,
        tenantId: a.tenantId,
        name: `llm:${body.key}`,
        ciphertext: encryptSecret(credential, deps.config.CREDENTIAL_KEY),
        createdAt: new Date().toISOString(),
      });
    }
    const config: LlmProviderConfig = { ...body, id: newId("llmp"), tenantId: a.tenantId, credentialRef };
    await deps.repos.llmProviders.upsert(config);
    return reply.status(201).send(config);
  });

  app.put("/b/v1/llm/providers/:id", async (req) => {
    const a = await auth(req);
    requireRole(a, "catalog_admin");
    const { id } = req.params as { id: string };
    const existing = await deps.repos.llmProviders.get(id);
    if (!existing || existing.tenantId !== a.tenantId) {
      throw new HttpError(404, "LLM_PROVIDER_NOT_FOUND", `llm provider not found: ${id}`);
    }
    const { credential, ...body } = CreateLlmProviderBody.partial().parse(req.body);
    let credentialRef = existing.credentialRef;
    if (credential) {
      credentialRef = newId("cred");
      await deps.repos.credentials.insert({
        id: credentialRef,
        tenantId: a.tenantId,
        name: `llm:${body.key ?? existing.key}`,
        ciphertext: encryptSecret(credential, deps.config.CREDENTIAL_KEY),
        createdAt: new Date().toISOString(),
      });
    }
    const updated: LlmProviderConfig = { ...existing, ...body, id, tenantId: a.tenantId, credentialRef };
    await deps.repos.llmProviders.upsert(updated);
    return updated;
  });

  app.get("/b/v1/llm/bindings", async (req) => {
    const a = await auth(req);
    if (deps.providerDirectory) {
      // A 用途矩阵形态 [{purpose, providerId, modelId}]（只读别名）
      return deps.providerDirectory.bindings(a.tenantId);
    }
    return deps.repos.llmBindings.list(a.tenantId);
  });

  // -----------------------------------------------------------------------
  // 引用模式增量 §2.4：内部缓存失效钩子 —— A 的 C-2 webhook 注册表回调此端点
  // （{kind}.updated 事件 → 立即失效 B 侧对 A 资源的缓存；TTL 60s 兜底）。
  // 该操作幂等无害（仅清缓存），不要求鉴权 —— 与 webhook 投递形态（裸 POST JSON）对齐。
  // -----------------------------------------------------------------------
  app.post("/b/v1/internal/invalidate", async (req) => {
    const body = (req.body ?? {}) as { event?: string; tenantId?: string; payload?: unknown };
    const event = body.event ?? "";
    const invalidated: string[] = [];
    if (!event || event.startsWith("llm_provider") || event.startsWith("llm_binding")) {
      deps.providerDirectory?.invalidate(body.tenantId);
      invalidated.push("llm-providers");
    }
    if (!event || event.startsWith("feature")) {
      if (body.tenantId) deps.features.invalidate(body.tenantId);
      invalidated.push("features");
    }
    // rules.updated：B 不缓存规则定义（每次求值经 A REST），propagation 即时 —— 仅确认收到
    if (event.startsWith("rules")) invalidated.push("rules(no-cache)");
    return { ok: true, event: event || "(all)", invalidated };
  });

  app.put("/b/v1/llm/bindings", async (req) => {
    const a = await auth(req);
    requireRole(a, "catalog_admin");
    const body = z.object({ bindings: z.array(ModelBindingSchema) }).parse(req.body);
    await deps.repos.llmBindings.put(a.tenantId, body.bindings);
    return deps.repos.llmBindings.list(a.tenantId);
  });

  // ---------------------------------------------------------------------
  // Sync solver proxy (entitlement PRD §4): entitlement check FIRST —
  // solverKey bound to any disabled feature → 404 FEATURE_NOT_FOUND (not 403).
  // Then OBO passthrough to DataCore /a/v1/solvers/{key}/invoke.
  // ---------------------------------------------------------------------
  app.post("/b/v1/solvers/:key/run", async (req) => {
    const a = await auth(req);
    const { key } = req.params as { key: string };
    const enabled = await deps.features.enabledSet(a.tenantId, a.token);
    if (!solverAllowed(enabled, key)) {
      throw new HttpError(404, "FEATURE_NOT_FOUND", "not found");
    }
    const body = z.object({ args: z.record(z.string(), z.unknown()).default({}) }).parse(req.body ?? {});
    // 增量 §0-2：同步求解 15s 超时 → 504 SOLVER_TIMEOUT（错误信封统一）。
    const timeoutMs = deps.config.SOLVER_RUN_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new HttpError(504, "SOLVER_TIMEOUT", `solver ${key} run exceeded ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([deps.dataCore.solver.invoke(a, key, body.args), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  });

  // ---------------------------------------------------------------------
  // B5 Scene entries
  // ---------------------------------------------------------------------
  const UpsertSceneBody = SceneEntryConfigSchema.omit({ id: true, tenantId: true });

  // AIP Evals §2 / E4：评测用例 CRUD + 跑套件 + 历史 + 种子 + 兜底转化。
  app.get("/b/v1/evals", async (req) => {
    const a = await auth(req);
    const { suite } = req.query as { suite?: "classifier" | "agent_quality" | "regression" };
    return { items: await deps.repos.evalCases.listByTenant(a.tenantId, suite) };
  });
  app.post("/b/v1/evals", async (req, reply) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const body = EvalCaseSchema.omit({ id: true, tenantId: true, createdAt: true }).parse(req.body);
    const c = await deps.evals.createCase({ ...body, tenantId: a.tenantId });
    return reply.status(201).send(c);
  });
  app.post("/b/v1/evals/seed-scenarios", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { packageId } = req.body as { packageId: string };
    if (!packageId) throw new HttpError(400, "VALIDATION_ERROR", "packageId required");
    return deps.evals.seedScenarioCases(a.tenantId, packageId);
  });
  app.post("/b/v1/evals/from-fallback/:taskId", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { taskId } = req.params as { taskId: string };
    const { intentKey } = req.body as { intentKey: string };
    if (!intentKey) throw new HttpError(400, "VALIDATION_ERROR", "intentKey required");
    const c = await deps.evals.fromFallback(a.tenantId, taskId, intentKey);
    if (!c) throw new HttpError(404, "FALLBACK_NOT_FOUND", `fallback trace not found: ${taskId}`);
    return c;
  });
  app.post("/b/v1/evals/run", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const body = z.object({ suite: EvalSuiteSchema.default("classifier"), agentKey: z.string().optional() }).parse(req.body ?? {});
    return deps.evals.run(a, body.suite, { ...(body.agentKey ? { agentKey: body.agentKey } : {}) });
  });
  app.get("/b/v1/evals/runs", async (req) => {
    const a = await auth(req);
    return { items: await deps.repos.evalRuns.listByTenant(a.tenantId) };
  });

  // 数据流闭环 §3/§6：联动刷新接线注册表（前端缓存失效路由的单一来源）。
  // ?event= 过滤某事件的下游；?view= 反查某消费页依赖的事件。
  app.get("/b/v1/event-subscriptions", async (req) => {
    await auth(req);
    const { event, view } = req.query as { event?: string; view?: string };
    let items = EVENT_SUBSCRIPTIONS;
    if (event) items = items.filter((s) => s.event === event);
    if (view) items = items.filter((s) => s.invalidates.includes(view));
    return { total: items.length, items };
  });

  // 场景启动器 P2：Scenario 升一等持久化对象（repo 单一来源；出厂 SCENARIO_CATALOG 懒播种）。
  // 首次访问某租户若仓储为空 → 幂等播种出厂 20 场景，保证目录始终完整（含自助新增场景）。
  const ensureScenarios = async (tenantId: string): Promise<Scenario[]> => {
    const existing = await deps.repos.scenarios.listByTenant(tenantId);
    const keys = new Set(existing.map((s) => s.scenarioKey));
    let added = false;
    // 按 key 幂等补齐出厂 20 场景（即便已有自助新增/退役场景也不漏播、不覆盖既有）。
    for (const sc of seedScenarios(tenantId)) {
      if (!keys.has(sc.scenarioKey)) {
        await deps.repos.scenarios.upsert(sc);
        added = true;
      }
    }
    return added ? deps.repos.scenarios.listByTenant(tenantId) : existing;
  };

  // 场景闭包/就绪（PRD §3.6 上架门 + 引用闭合「无死路」）：场景调用的链路必须全配置好——
  // intentKey→意图存在 · 意图→执行计划存在 · AGENT 模式→defaultAgent 已发布。断链则不可发布。
  const scenarioClosure = async (tenantId: string, sc: Scenario): Promise<{ ready: boolean; issues: string[] }> => {
    const issues: string[] = [];
    const pkg = (await deps.repos.packages.listByTenant(tenantId))[0];
    if (!pkg) return { ready: false, issues: ["租户无场景包"] };
    const intents = await deps.repos.intents.listByPackage(pkg.id);
    const byKey = new Map<string, (typeof intents)[number]>();
    for (const i of intents) {
      const cur = byKey.get(i.key);
      if (!cur || i.version > cur.version) byKey.set(i.key, i);
    }
    const intent = byKey.get(sc.intentKey);
    if (!intent) {
      issues.push(`意图「${sc.intentKey}」未配置（死路）`);
    } else if (!(await resolvePlanForIntent(deps.repos, intent))) {
      issues.push(`意图「${sc.intentKey}」未绑定执行计划（workflow）`);
    }
    if (sc.mode === "AGENT_FIRST" || sc.mode === "AGENT_ONLY") {
      if (!sc.defaultAgentId) issues.push("AGENT 模式缺 defaultAgent");
      else {
        const agent = await deps.repos.agents.get(sc.defaultAgentId);
        if (!agent || agent.tenantId !== tenantId) issues.push(`defaultAgent 不存在：${sc.defaultAgentId}`);
        else if (agent.status !== "PUBLISHED") issues.push(`defaultAgent 未发布：${agent.name}`);
      }
    }
    return { ready: issues.length === 0, issues };
  };

  // 20 场景目录 §9：场景启动器卡片（单一来源=scenarios 仓储；非前端硬编码）。
  // SL2：关闭某视图 feature → 对应卡从 active 列表消失（默认仅返回 active+PUBLISHED）。
  app.get("/b/v1/scenarios", async (req) => {
    const a = await auth(req);
    const { includeInactive, includeDraft } = req.query as { includeInactive?: string; includeDraft?: string };
    const enabled = await deps.features.enabledSet(a.tenantId, a.token);
    const launcherOn = viewAllowed(enabled, "scenarios");
    const all = await ensureScenarios(a.tenantId);
    const cards = all
      .filter((s) => s.status !== "RETIRED")
      .filter((s) => includeDraft === "true" || s.status === "PUBLISHED")
      .map((s) => ({
        // 兼容旧字段（前端启动器/评测沿用 sNo/view/name）：投影出 ScenarioCard 形态 + 一等字段。
        sNo: s.scenarioKey,
        name: s.name,
        view: s.targetView,
        domain: s.domain,
        intentKey: s.intentKey,
        triggerQuestion: s.triggerQuestion,
        solver: s.solver,
        rules: s.rules,
        riskLevel: s.riskLevel,
        summary: s.summary,
        mode: s.mode,
        defaultAgentId: s.defaultAgentId,
        presetContext: s.presetContext,
        status: s.status,
        willProduceDraft: s.riskLevel === "ACTION_DRAFT",
        inactive: !viewAllowed(enabled, s.targetView),
      }))
      .sort((a, b) => (a.sNo < b.sNo ? -1 : 1));
    const items = includeInactive === "true" ? cards : cards.filter((c) => !c.inactive);
    return { launcherEnabled: launcherOn, total: items.length, items };
  });

  // 场景启动器（PRD-scenario-launcher §3.5）：点一张场景卡 → 服务端组装 presetContext（单一来源
  // =SCENARIO_CATALOG）→ 提交 QOS Query。selectedObjects + presetSlots 经 SessionContext 注入，
  // 命中意图后必填槽位由 fillSlots 从 presetSlots/选中对象满足 → 零反问、直达路径A 推演。
  app.post("/b/v1/scenarios/:key/launch", async (req, reply) => {
    const a = await auth(req);
    const { key } = req.params as { key: string };
    await ensureScenarios(a.tenantId);
    const all = await deps.repos.scenarios.listByTenant(a.tenantId);
    const sc = all.find((c) => c.scenarioKey === key || c.intentKey === key);
    if (!sc) throw new HttpError(404, "SCENARIO_NOT_FOUND", `scenario not found: ${key}`);
    if (sc.status !== "PUBLISHED") throw new HttpError(409, ErrorCodes.INVALID_STATE, `场景未发布（${sc.status}），不可启动`);
    // entitlement 先于 authz（R3）：场景所属视图关闭 → 功能不存在
    const enabled = await deps.features.enabledSet(a.tenantId, a.token);
    if (!viewAllowed(enabled, sc.targetView)) throw new HttpError(404, "FEATURE_NOT_FOUND", "not found");
    const pkg = (await deps.repos.packages.listByTenant(a.tenantId))[0];
    if (!pkg) throw new HttpError(404, "PACKAGE_NOT_FOUND", "no scenario package for tenant");
    const body = SubmitQueryBodySchema.parse({
      packageId: pkg.id,
      query: sc.triggerQuestion,
      context: {
        view: sc.presetContext.targetView,
        selectedObjects: sc.presetContext.selectedObjects,
        filters: {},
        presetSlots: sc.presetContext.slotPresets,
      },
    });
    const result = await deps.orchestrator.submitQuery(a, body);
    return reply.status(202).send({ taskId: result.taskId, status: result.status, streamUrl: result.streamUrl, scenario: sc.scenarioKey });
  });

  // ---- 场景管理（PRD §4 管理面）：创建/编辑 DRAFT · 发布/退役（发 scenario.* 事件）----
  const ScenarioUpsertBody = ScenarioSchema.omit({ id: true, tenantId: true, version: true, updatedAt: true, status: true }).partial({
    rules: true, riskLevel: true, summary: true, mode: true, presetContext: true,
  });
  // 列表（管理态：含 DRAFT/RETIRED；前端场景编辑器消费——每个用 workflow/agent 的场景都在此完整可配）
  app.get("/b/v1/scenarios/manage", async (req) => {
    const a = await auth(req);
    await ensureScenarios(a.tenantId);
    const enabled = await deps.features.enabledSet(a.tenantId, a.token);
    const all = await deps.repos.scenarios.listByTenant(a.tenantId);
    // 每个场景附引用闭包就绪（intent→plan→agent 全配置好 = 无死路），前端显示就绪/断链。
    const withClosure = await Promise.all(
      all.map(async (s) => ({ ...s, inactive: !viewAllowed(enabled, s.targetView), closure: await scenarioClosure(a.tenantId, s) })),
    );
    return withClosure.sort((x, y) => (x.scenarioKey < y.scenarioKey ? -1 : 1));
  });
  // 单场景闭包（编辑器实时校验）。
  app.get("/b/v1/scenarios/:key/closure", async (req) => {
    const a = await auth(req);
    await ensureScenarios(a.tenantId);
    const sc = await deps.repos.scenarios.byKey(a.tenantId, (req.params as { key: string }).key);
    if (!sc) throw new HttpError(404, "SCENARIO_NOT_FOUND", "scenario not found");
    return scenarioClosure(a.tenantId, sc);
  });
  app.get("/b/v1/scenarios/:key", async (req) => {
    const a = await auth(req);
    await ensureScenarios(a.tenantId);
    const sc = await deps.repos.scenarios.byKey(a.tenantId, (req.params as { key: string }).key);
    if (!sc) throw new HttpError(404, "SCENARIO_NOT_FOUND", "scenario not found");
    return sc;
  });
  // 创建/编辑：scenarioKey 已存在 → 编辑（仅 DRAFT 可改全字段；PUBLISHED 则派生 DRAFT 由前端 new-version 触发，
  // 此处 PUT 直接对 DRAFT 生效，PUBLISHED 改字段返回 409 提示先退役/派生）。
  const upsertScenario = async (req: Parameters<typeof auth>[0], expectKey?: string): Promise<Scenario> => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const raw = { ...(req.body as Record<string, unknown>) };
    if (expectKey) raw.scenarioKey = expectKey;
    const body = ScenarioUpsertBody.parse(raw);
    // viewKey 闭合（PRD admin-console-closure §5-①）：targetView 必须是真实视图（来自 workspace 导航/feature）。
    const existing = await deps.repos.scenarios.byKey(a.tenantId, body.scenarioKey);
    if (existing && existing.status === "PUBLISHED") {
      throw new HttpError(409, ErrorCodes.INVALID_STATE, `场景 ${body.scenarioKey} 已发布，请先退役再改或新建键`);
    }
    if (existing?.updatedAt && (body as { updatedAt?: string }).updatedAt && (body as { updatedAt?: string }).updatedAt !== existing.updatedAt) {
      throw new HttpError(409, "STALE_WRITE", "场景已被他人修改，请刷新后重试");
    }
    const now = new Date().toISOString();
    const sc: Scenario = {
      id: existing?.id ?? newId("scn"),
      tenantId: a.tenantId,
      scenarioKey: body.scenarioKey,
      name: body.name,
      domain: body.domain,
      targetView: body.targetView,
      intentKey: body.intentKey,
      triggerQuestion: body.triggerQuestion,
      solver: body.solver,
      rules: body.rules ?? [],
      riskLevel: body.riskLevel ?? "COMPUTE",
      summary: body.summary ?? "",
      mode: body.mode ?? "WORKFLOW_FIRST",
      defaultAgentId: body.defaultAgentId,
      presetContext: body.presetContext ?? { targetView: body.targetView, selectedObjects: [], slotPresets: {} },
      status: "DRAFT",
      version: existing?.version ?? 1,
      updatedAt: now,
    };
    // AGENT_* 模式必须有已发布 defaultAgent（与 scene-entries 一致）。
    if ((sc.mode === "AGENT_FIRST" || sc.mode === "AGENT_ONLY")) {
      if (!sc.defaultAgentId) throw new HttpError(400, ErrorCodes.VALIDATION_ERROR, "AGENT_* 模式必须提供 defaultAgentId");
      const agent = await deps.repos.agents.get(sc.defaultAgentId);
      if (!agent || agent.tenantId !== a.tenantId) throw new HttpError(400, ErrorCodes.VALIDATION_ERROR, `defaultAgent 不存在：${sc.defaultAgentId}`);
      if (agent.status !== "PUBLISHED") throw new HttpError(400, ErrorCodes.VALIDATION_ERROR, `AGENT_* 模式要求 defaultAgent 已发布：${agent.name} 当前 ${agent.status}`);
    }
    await deps.repos.scenarios.upsert(sc);
    return sc;
  };
  app.post("/b/v1/scenarios", async (req, reply) => reply.status(201).send(await upsertScenario(req)));
  app.put("/b/v1/scenarios/:key", async (req) => upsertScenario(req, (req.params as { key: string }).key));
  app.post("/b/v1/scenarios/:key/publish", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { key } = req.params as { key: string };
    const sc = await deps.repos.scenarios.byKey(a.tenantId, key);
    if (!sc) throw new HttpError(404, "SCENARIO_NOT_FOUND", "scenario not found");
    // 上架门（R11/§3.6 无死路）：引用链未全配置好 → 拒绝发布，列出断链项。
    const closure = await scenarioClosure(a.tenantId, sc);
    if (!closure.ready) throw new HttpError(409, ErrorCodes.VALIDATION_ERROR, `场景引用未闭合（死路），不可发布：${closure.issues.join("；")}`);
    const published: Scenario = { ...sc, status: "PUBLISHED", version: sc.version + 1, updatedAt: new Date().toISOString() };
    await deps.repos.scenarios.upsert(published);
    // scenario.published 事件登记于 event-subscriptions.ts（§4 单一来源）；前端按 invalidates 失效缓存。
    return published;
  });
  app.post("/b/v1/scenarios/:key/retire", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { key } = req.params as { key: string };
    const sc = await deps.repos.scenarios.byKey(a.tenantId, key);
    if (!sc) throw new HttpError(404, "SCENARIO_NOT_FOUND", "scenario not found");
    const retired: Scenario = { ...sc, status: "RETIRED", updatedAt: new Date().toISOString() };
    await deps.repos.scenarios.upsert(retired);
    return retired;
  });

  app.get("/b/v1/scene-entries", async (req) => {
    const a = await auth(req);
    const entries = await deps.repos.sceneEntries.listByTenant(a.tenantId);
    // entitlement PRD §5 (B5 联动): entry referencing a disabled view → marked inactive
    const enabled = await deps.features.enabledSet(a.tenantId, a.token);
    return entries.map((e) => ({ ...e, inactive: !viewAllowed(enabled, e.viewKey) }));
  });

  // 前端 PRD §6.2 别名：按视图取场景入口（查询 Dock 的 placeholder/建议问题来源）。
  // ?view= 给定时返回单对象或 null（前端 fetchScene 消费形态）。
  app.get("/b/v1/scenes", async (req, reply) => {
    const a = await auth(req);
    const view = (req.query as Record<string, unknown>)["view"];
    const entries = await deps.repos.sceneEntries.listByTenant(a.tenantId);
    const enabled = await deps.features.enabledSet(a.tenantId, a.token);
    const marked = entries.map((e) => ({ ...e, inactive: !viewAllowed(enabled, e.viewKey) }));
    if (typeof view === "string" && view.length > 0) {
      return reply.send(marked.find((e) => e.viewKey === view) ?? null);
    }
    return marked;
  });

  app.put("/b/v1/scene-entries/:viewKey", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { viewKey } = req.params as { viewKey: string };
    const body = UpsertSceneBody.parse({ ...(req.body as Record<string, unknown>), viewKey });
    if ((body.mode === "AGENT_FIRST" || body.mode === "AGENT_ONLY") && !body.defaultAgentId) {
      throw new HttpError(400, ErrorCodes.VALIDATION_ERROR, "AGENT_* 模式必须提供 defaultAgentId");
    }
    // 管理平台增量 §4（M5）：AGENT_* 模式的 defaultAgent 必须存在且已发布（失败信息明确）。
    if ((body.mode === "AGENT_FIRST" || body.mode === "AGENT_ONLY") && body.defaultAgentId) {
      const agent = await deps.repos.agents.get(body.defaultAgentId);
      if (!agent || agent.tenantId !== a.tenantId) {
        throw new HttpError(400, ErrorCodes.VALIDATION_ERROR, `defaultAgent 不存在：${body.defaultAgentId}`);
      }
      if (agent.status !== "PUBLISHED") {
        throw new HttpError(
          400,
          ErrorCodes.VALIDATION_ERROR,
          `AGENT_* 模式要求 defaultAgent 已发布：${agent.name}（${body.defaultAgentId}）当前为 ${agent.status}，请先发布该 Agent`,
        );
      }
    }
    const existing = await deps.repos.sceneEntries.byView(a.tenantId, viewKey);
    // 管理平台增量 §4：场景入口无版本化 —— updatedAt 乐观锁（客户端带旧值 → 409）。
    if (existing?.updatedAt && body.updatedAt && body.updatedAt !== existing.updatedAt) {
      deps.metrics.versionConflicts.inc({ resource: "scene_entry" });
      throw new HttpError(409, "STALE_WRITE", `场景入口已被他人修改（服务端 updatedAt=${existing.updatedAt}），请刷新后重试`);
    }
    // updatedAt 必须严格单调：同毫秒内的连续写入仍产生不同的乐观锁版本
    // （否则两次相邻保存的 updatedAt 相等，过期客户端无法被检出 → STALE_WRITE 漏检）。
    let nextUpdatedAt = new Date().toISOString();
    if (existing?.updatedAt && nextUpdatedAt <= existing.updatedAt) {
      nextUpdatedAt = new Date(new Date(existing.updatedAt).getTime() + 1).toISOString();
    }
    const entry: SceneEntryConfig = {
      ...body,
      id: existing?.id ?? newId("scn"),
      tenantId: a.tenantId,
      updatedAt: nextUpdatedAt,
    };
    await deps.repos.sceneEntries.upsert(entry);
    return entry;
  });

  // ---- 管理平台增量 §4：scene-entries 引用清单（统一形态；入口为叶子 → 恒空）+ 删除 ----
  app.get("/b/v1/scene-entries/:id/references", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const entry = (await deps.repos.sceneEntries.get(id)) ?? (await deps.repos.sceneEntries.byView(a.tenantId, id));
    if (!entry || entry.tenantId !== a.tenantId) throw new HttpError(404, "SCENE_ENTRY_NOT_FOUND", `scene entry not found: ${id}`);
    const references = await computeReferences(deps.repos, a.tenantId, "scene-entry", entry.id);
    return { references, count: references.length };
  });

  app.delete("/b/v1/scene-entries/:id", async (req, reply) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const entry = (await deps.repos.sceneEntries.get(id)) ?? (await deps.repos.sceneEntries.byView(a.tenantId, id));
    if (!entry || entry.tenantId !== a.tenantId) throw new HttpError(404, "SCENE_ENTRY_NOT_FOUND", `scene entry not found: ${id}`);
    await deps.repos.sceneEntries.remove(entry.id);
    return reply.status(204).send();
  });

  return app;
}
