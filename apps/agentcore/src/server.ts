import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import {
  AgentDefinitionSchema,
  ClarificationReplyBodySchema,
  ErrorCodes,
  McpServerConfigSchema,
  SceneEntryConfigSchema,
  SkillDefinitionSchema,
  SubmitQueryBodySchema,
  WorkflowDefinitionSchema,
  type AgentDefinition,
  type McpServerConfig,
  type SceneEntryConfig,
  type SkillDefinition,
  type WorkflowDefinition,
} from "@platform/contracts";
import { AuthError, requireRole, resolveAuth, type RequestAuth } from "./auth.js";
import { CreateIntentBodySchema, CreatePlanBodySchema, UpdateIntentBodySchema } from "./catalog/service.js";
import { encryptSecret } from "./crypto.js";
import type { AppDeps } from "./deps.js";
import { newId } from "./ids.js";
import { fallbackStats, promoteFallbackTrace } from "./ops/fallback.js";
import { HttpError } from "./router/orchestrator.js";
import { streamTaskEvents } from "./api/sse.js";
import { BudgetTracker } from "./tools/budget.js";
import { detectStaticCycle, validatePlanSteps } from "./workflow/validate.js";

export async function buildServer(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: deps.config.LOG_LEVEL } });

  const auth = (req: FastifyRequest): Promise<RequestAuth> =>
    resolveAuth(req.headers as Record<string, string | string[] | undefined>, {
      dataCoreBaseUrl: deps.config.DATACORE_BASE_URL,
    });

  app.setErrorHandler((err, req, reply) => {
    const requestId = req.id as string;
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, requestId } });
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

  app.get("/b/v1/agents", async (req) => {
    const a = await auth(req);
    return deps.repos.agents.listByTenant(a.tenantId);
  });

  app.get("/b/v1/agents/:id", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const agent = await deps.repos.agents.get(id);
    if (!agent || agent.tenantId !== a.tenantId) throw new HttpError(404, "AGENT_NOT_FOUND", `agent not found: ${id}`);
    return agent;
  });

  app.post("/b/v1/agents", async (req, reply) => {
    const a = await auth(req);
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
    const { id } = req.params as { id: string };
    const agent = await deps.repos.agents.get(id);
    if (!agent || agent.tenantId !== a.tenantId) throw new HttpError(404, "AGENT_NOT_FOUND", `agent not found: ${id}`);
    if (agent.status !== "DRAFT") throw new HttpError(409, ErrorCodes.INVALID_STATE, "仅 DRAFT 状态的 agent 可修改");
    const body = CreateAgentBody.partial().parse(req.body);
    const updated = { ...agent, ...body, id: agent.id, tenantId: agent.tenantId, version: agent.version } as AgentDefinition;
    await deps.repos.agents.update(updated);
    return updated;
  });

  app.post("/b/v1/agents/:id/publish", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const agent = await deps.repos.agents.get(id);
    if (!agent || agent.tenantId !== a.tenantId) throw new HttpError(404, "AGENT_NOT_FOUND", `agent not found: ${id}`);
    if (agent.status !== "DRAFT") throw new HttpError(409, ErrorCodes.INVALID_STATE, "仅 DRAFT 状态的 agent 可发布");
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
    return published;
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

  app.get("/b/v1/workflows", async (req) => {
    const a = await auth(req);
    return deps.repos.workflows.listByTenant(a.tenantId);
  });

  app.get("/b/v1/workflows/:id", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const wf = await deps.repos.workflows.get(id);
    if (!wf || wf.tenantId !== a.tenantId) throw new HttpError(404, "WORKFLOW_NOT_FOUND", `workflow not found: ${id}`);
    return wf;
  });

  app.post("/b/v1/workflows", async (req, reply) => {
    const a = await auth(req);
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
    const { id } = req.params as { id: string };
    const wf = await deps.repos.workflows.get(id);
    if (!wf || wf.tenantId !== a.tenantId) throw new HttpError(404, "WORKFLOW_NOT_FOUND", `workflow not found: ${id}`);
    if (wf.status !== "DRAFT") throw new HttpError(409, ErrorCodes.INVALID_STATE, "仅 DRAFT 状态的 workflow 可修改");
    const body = CreateWorkflowBody.partial().parse(req.body);
    const updated = { ...wf, ...body, id: wf.id, tenantId: wf.tenantId, version: wf.version, updatedAt: new Date().toISOString() } as WorkflowDefinition;
    await deps.repos.workflows.update(updated);
    return updated;
  });

  app.post("/b/v1/workflows/:id/publish", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const wf = await deps.repos.workflows.get(id);
    if (!wf || wf.tenantId !== a.tenantId) throw new HttpError(404, "WORKFLOW_NOT_FOUND", `workflow not found: ${id}`);
    if (wf.status !== "DRAFT") throw new HttpError(409, ErrorCodes.INVALID_STATE, "仅 DRAFT 状态的 workflow 可发布");
    const errors = validatePlanSteps(wf.steps, {});
    if (errors.length > 0) throw new HttpError(400, ErrorCodes.PLAN_VALIDATION_ERROR, errors.join("；"));
    const cycle = await detectStaticCycle(deps.repos, { kind: "workflow", id }, { workflow: wf });
    if (cycle) {
      throw new HttpError(400, ErrorCodes.CYCLIC_INVOCATION, `发布被拒：静态可达环 ${cycle.join(" -> ")}`);
    }
    const published = { ...wf, status: "PUBLISHED" as const, updatedAt: new Date().toISOString() };
    await deps.repos.workflows.update(published);
    return published;
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
      nesting: { callChain: [`workflow:${wf.id}`], budget },
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

  app.get("/b/v1/skills", async (req) => {
    const a = await auth(req);
    return deps.repos.skills.listByTenant(a.tenantId);
  });

  app.post("/b/v1/skills", async (req, reply) => {
    const a = await auth(req);
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
    const { id } = req.params as { id: string };
    const skill = await deps.repos.skills.get(id);
    if (!skill || skill.tenantId !== a.tenantId) throw new HttpError(404, "SKILL_NOT_FOUND", `skill not found: ${id}`);
    if (skill.status !== "DRAFT") throw new HttpError(409, ErrorCodes.INVALID_STATE, "仅 DRAFT 状态的 skill 可修改");
    const body = CreateSkillBody.partial().parse(req.body);
    const updated = { ...skill, ...body, id: skill.id, tenantId: skill.tenantId, version: skill.version } as SkillDefinition;
    await deps.repos.skills.update(updated);
    return updated;
  });

  app.post("/b/v1/skills/:id/publish", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const skill = await deps.repos.skills.get(id);
    if (!skill || skill.tenantId !== a.tenantId) throw new HttpError(404, "SKILL_NOT_FOUND", `skill not found: ${id}`);
    const published = { ...skill, status: "PUBLISHED" as const };
    await deps.repos.skills.update(published);
    return published;
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
  // ---------------------------------------------------------------------
  const CreateMcpBody = McpServerConfigSchema.omit({ id: true, tenantId: true, credentialRef: true }).extend({
    credential: z.string().optional(),
  });

  app.get("/b/v1/mcp-configs", async (req) => {
    const a = await auth(req);
    return deps.repos.mcpConfigs.listByTenant(a.tenantId);
  });

  app.post("/b/v1/mcp-configs", async (req, reply) => {
    const a = await auth(req);
    const { credential, ...body } = CreateMcpBody.parse(req.body);
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
    const config: McpServerConfig = { ...body, id: newId("mcp"), tenantId: a.tenantId, credentialRef };
    await deps.repos.mcpConfigs.insert(config);
    return reply.status(201).send(config);
  });

  app.put("/b/v1/mcp-configs/:id", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const existing = await deps.repos.mcpConfigs.get(id);
    if (!existing || existing.tenantId !== a.tenantId) {
      throw new HttpError(404, "MCP_CONFIG_NOT_FOUND", `mcp config not found: ${id}`);
    }
    const { credential, ...body } = CreateMcpBody.partial().parse(req.body);
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
    const updated: McpServerConfig = { ...existing, ...body, id, tenantId: a.tenantId, credentialRef };
    await deps.repos.mcpConfigs.update(updated);
    return updated;
  });

  // ---------------------------------------------------------------------
  // B5 Scene entries
  // ---------------------------------------------------------------------
  const UpsertSceneBody = SceneEntryConfigSchema.omit({ id: true, tenantId: true });

  app.get("/b/v1/scene-entries", async (req) => {
    const a = await auth(req);
    return deps.repos.sceneEntries.listByTenant(a.tenantId);
  });

  app.put("/b/v1/scene-entries/:viewKey", async (req) => {
    const a = await auth(req);
    const { viewKey } = req.params as { viewKey: string };
    const body = UpsertSceneBody.parse({ ...(req.body as Record<string, unknown>), viewKey });
    if ((body.mode === "AGENT_FIRST" || body.mode === "AGENT_ONLY") && !body.defaultAgentId) {
      throw new HttpError(400, ErrorCodes.VALIDATION_ERROR, "AGENT_* 模式必须提供 defaultAgentId");
    }
    const existing = await deps.repos.sceneEntries.byView(a.tenantId, viewKey);
    const entry: SceneEntryConfig = { ...body, id: existing?.id ?? newId("scn"), tenantId: a.tenantId };
    await deps.repos.sceneEntries.upsert(entry);
    return entry;
  });

  return app;
}
