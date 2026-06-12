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
  SkillDefinitionSchema,
  SubmitQueryBodySchema,
  WorkflowDefinitionSchema,
  type AgentDefinition,
  type LlmProviderConfig,
  type McpServerConfig,
  type SceneEntryConfig,
  type SkillDefinition,
  type WorkflowDefinition,
} from "@platform/contracts";
import { stdioPolicyFromConfig } from "./config.js";
import { validateStdioTransport } from "./mcp/runtime.js";
import { AuthError, requireRole, resolveAuth, type RequestAuth } from "./auth.js";
import { DataCoreHttpError, DataCoreUnavailableError } from "./tools/clients.js";
import { solverAllowed, viewAllowed } from "./features/registry.js";
import { CreateIntentBodySchema, CreatePlanBodySchema, UpdateIntentBodySchema } from "./catalog/service.js";
import { encryptSecret } from "./crypto.js";
import type { AppDeps } from "./deps.js";
import { newId } from "./ids.js";
import { fallbackStats, promoteFallbackTrace } from "./ops/fallback.js";
import { HttpError } from "./router/orchestrator.js";
import { streamTaskEvents } from "./api/sse.js";
import { BudgetTracker } from "./tools/budget.js";
import { detectStaticCycle, validatePlanSteps } from "./workflow/validate.js";
import { applyListQuery, assertRetireOrDelete, computeReferences, requireCatalogAdmin, type ListQuery } from "./resources.js";
import { builtinTool } from "./tools/registry.js";

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
    if (fieldErrors.length > 0) return { ok: false, errors: fieldErrors };
    const cycle = await detectStaticCycle(deps.repos, { kind: "agent", id }, { agent });
    if (cycle) {
      throw new HttpError(400, ErrorCodes.CYCLIC_INVOCATION, `发布被拒：静态可达环 ${cycle.join(" -> ")}`);
    }
    const all = await deps.repos.agents.listByTenant(a.tenantId);
    for (const s of all) {
      if (s.key === agent.key && s.id !== agent.id && s.status === "PUBLISHED") {
        await deps.repos.agents.update({ ...s, status: "RETIRED" });
      }
    }
    const published = { ...agent, status: "PUBLISHED" as const };
    await deps.repos.agents.update(published);
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

  app.get("/b/v1/workflows", async (req, reply) => {
    const a = await auth(req);
    const { items, total } = applyListQuery(await deps.repos.workflows.listByTenant(a.tenantId), req.query as ListQuery);
    reply.header("x-total-count", String(total));
    return items;
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
    return { ...wf, versions };
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
    if (stepErrors.length > 0) return { ok: false, errors: stepErrors };
    const published = { ...wf, status: "PUBLISHED" as const, updatedAt: new Date().toISOString() };
    await deps.repos.workflows.update(published);
    // 前端消费形态 { ok, ...workflow }（SPA WorkflowsPage 读 r.ok / r.errors）
    return { ok: true, ...published };
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
    const published = { ...skill, status: "PUBLISHED" as const };
    await deps.repos.skills.update(published);
    return published;
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

  app.get("/b/v1/llm/providers", async (req) => {
    const a = await auth(req);
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
    return deps.repos.llmBindings.list(a.tenantId);
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
      throw new HttpError(409, "STALE_WRITE", `场景入口已被他人修改（服务端 updatedAt=${existing.updatedAt}），请刷新后重试`);
    }
    const entry: SceneEntryConfig = {
      ...body,
      id: existing?.id ?? newId("scn"),
      tenantId: a.tenantId,
      updatedAt: new Date().toISOString(),
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
