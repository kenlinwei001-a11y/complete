import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { buildSolverMcpTools, SOLVERS_MCP_SERVER_INFO } from "./mcp/solvers-catalog.js";
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
  SkillExecutionSchema,
  SkillExecutionStepSchema,
  SkillGraphSchema,
  ScaffoldManifestSchema,
  DecisionTraceSchema,
  EvalCaseSchema,
  EvalSuiteSchema,
  LaunchScenarioBodySchema,
  OperationClassifyRequestSchema,
  IntentClassifyPreviewRequestSchema,
  classifyOperation,
  SkillDefinitionSchema,
  SubmitQueryBodySchema,
  WorkflowDefinitionSchema,
  InferenceTraceSchema,
  ResourceSearchRequestSchema,
  incumbentNotice,
  type SolverInputScale,
  type SolverPhase,
  type SolverTimeoutDiagnostics,
  type QueryTask,
  type ExecutionPlan,
  type AgentDefinition,
  type LlmProviderConfig,
  type McpServerConfig,
  type SceneEntryConfig,
  type Scenario,
  type ScenarioOntogenesisRun,
  type SkillDefinition,
  type WorkflowDefinition,
} from "@platform/contracts";
import { GraphScheduler, SkillGraphCompileError } from "./skill-orchestrator.js";
import { stdioPolicyFromConfig } from "./config.js";
import { validateStdioTransport } from "./mcp/runtime.js";
import { AuthError, requireRole, resolveAuth, type RequestAuth } from "./auth.js";
import { DataCoreHttpError, DataCoreUnavailableError } from "./tools/clients.js";
import { solverAllowed, viewAllowed } from "./features/registry.js";
import { CreateIntentBodySchema, CreatePlanBodySchema, UpdateIntentBodySchema, resolvePlanForIntent, resolvePlanByRef } from "./catalog/service.js";
import { encryptSecret } from "./crypto.js";
import type { AppDeps } from "./deps.js";
import { newId } from "./ids.js";
import { fallbackStats, promoteFallbackTrace } from "./ops/fallback.js";
import { HttpError } from "./router/orchestrator.js";
import { projectTrace, type TraceGapInput } from "./router/project-trace.js";
import { SIM_COMPOSE_SCENARIOS, buildComposeNarrative, classifyCapacityQuestion, mapLeversAnswer, mapGapAnswer } from "./router/live-endpoints.js";
import { streamTaskEvents } from "./api/sse.js";
import { BudgetTracker } from "./tools/budget.js";
import { detectStaticCycle, validatePlanSteps } from "./workflow/validate.js";
import { parseCapacityFeasibilityVariant } from "./agent/sim-planner.js";
import { agentRuleRefs, planStepRuleRefs } from "./refs/report.js";
import { detectBreakingSchemaChange } from "./workflow/compat.js";
import { applyListQuery, assertRetireOrDelete, computeReferences, probeMissingRefs, requireCatalogAdmin, type ListQuery } from "./resources.js";
import { classifyGap, FILL } from "./growth/probe.js";
import { perceptionMetrics } from "./router/perception-metrics.js";
import { runGrowthLoop } from "./growth/loop.js";
import { buildGrowthLoopWiring } from "./growth/scenario-grow.js";
import { builtinTool } from "./tools/registry.js";
import { lintSkill, classifySkillEvalCases, type SkillLintTarget } from "./skill-lint.js";
import { compileSkill } from "./skill-compiler.js";
// WO-REFGATE-ENT · F14：发布门判据的单一实现（本路由与 main.ts 启动期种子审计共用）。
import { getSeedSkillGateReport, runSkillPublishGate } from "./skill-publish-gate.js";
import { seedScenarios } from "./scenarios-catalog.js";
import { ensureScenarioPackageSeed } from "./mocks/seed.js";
import { EVENT_SUBSCRIPTIONS } from "./event-subscriptions.js";
import { ResourceRegistryService } from "./dril/resource-registry.js";
import { ResourceQualityService } from "./dril/quality.js";
import { relationsOf } from "./dril/relations.js";

/** PRD-IND-story §4.3：从 task.error/path 确定性派生缺口（本 base 用 task.error 归类断点 → projectTrace 标 gap 节点）。 */
function deriveTraceGap(task: QueryTask): TraceGapInput | undefined {
  if (task.status === "FAILED" && task.error) {
    const s = `${task.error.code} ${task.error.message}`.toLowerCase();
    const gapCode = /plan_not_found|plan not found/.test(s)
      ? "NO_PLAN"
      : /solver/.test(s)
        ? "SOLVER_NOT_FOUND"
        : /slice/.test(s)
          ? "NO_SLICE"
          : /shape|render|template_resolution|output\./.test(s)
            ? "SHAPE_MISMATCH"
            : /rule/.test(s)
              ? "NO_RULE"
              : /empty|no data|空/.test(s)
                ? "EMPTY_DATA"
                : "OTHER";
    return { verdict: "BLOCKED", findings: [{ gapCode, atStep: task.error.stepId, blocking: true }] };
  }
  if (task.status === "COMPLETED" && task.path === "AGENT") {
    const outOfCatalog = task.classification?.outOfCatalog ?? true;
    return {
      verdict: "BOUNDARY",
      findings: [{ gapCode: outOfCatalog ? "NO_INTENT" : "NO_CAPABILITY", atStep: "routing", blocking: false }],
    };
  }
  return undefined;
}

export async function buildServer(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: deps.config.LOG_LEVEL },
    // 前端 PRD §3/§6.2 真连别名：QOS 端点在 QOS-PRD 中挂 /api/v1，前端契约写 {B}/b/v1。
    // /b/v1 下原生路由（agents/workflows/…）不受影响，只把 QOS 子集重写到 /api/v1。
    rewriteUrl(req) {
      const url = req.url ?? "/";
      for (const seg of ["/b/v1/queries", "/b/v1/catalog", "/b/v1/ops", "/b/v1/growth"]) {
        if (url.startsWith(seg)) return "/api/v1" + url.slice("/b/v1".length);
      }
      return url;
    },
  });

  // 经网关同源访问时无需 CORS；开放宽松 CORS 仅为直连端口的开发调试（credentials 模式）。
  // 显式放行全部写方法：管理控制台 B 侧 PUT/PATCH/DELETE（工作流/Agent/技能/场景编辑）直连端口时
  // 浏览器预检需 PUT/DELETE 在 Access-Control-Allow-Methods，否则 405（部署态经网关同源不受影响）。
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

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

  /** D-29 实时环 E-c：B 侧发布类领域事件落库（经 /b/v1/outbox 馈源供前端 F1 全局轮询传播）。 */
  const emitDomainEvent = (tenantId: string, event: string, payload: Record<string, unknown> = {}): Promise<void> =>
    deps.repos.domainEvents.append({ id: newId("evt"), tenantId, event, payload, createdAt: new Date().toISOString() });

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
    // probe/fill 单源（RL3/RL10）：抽到 growth/scenario-grow.ts，与 growScenario(O9) 共用同一套补法引擎，不分叉。
    // 补法分派：① 缺数据→真人正门补(P2 真实)；② 缺执行计划/缺求解器(in-catalog)→A3 自动 scaffold DRAFT（不发布 R4）；③ 其余→骨架工单收敛到边界。
    // 每次 fill 发 growth.fill_proposed（经 E-c domain_events → F1 全局通道反映到驾驶舱）。
    const { probe, fill, scaffoldedByGap } = buildGrowthLoopWiring(deps, a, body, emitDomainEvent);
    const report = await runGrowthLoop({ question: body.query, maxRounds, probe, fill });
    // P4：成长账本(demand-indexed) + 缺功能→成长工单（厂商中立施工契约，带真实 I/O 契约 + 本体引用骨架）
    const now = new Date().toISOString();
    await deps.repos.growthLedger.insert({ id: newId("glr"), tenantId: a.tenantId, report, createdAt: now });
    // 从真实 context 推断骨架（agentcore 可见：view + selectedObjects + filters）；非空，供 code-agent 定位施工。
    const ctxTypes = [...new Set((body.context.selectedObjects ?? []).map((o) => o.objectType).filter((x): x is string => !!x))];
    const refObjectTypes = [...new Set([...ctxTypes, ...(body.context.view ? [body.context.view] : [])])];
    // 每 gapCode 期望输出形状骨架（求解器骨架契约的签名来源；B 兜底/求解器骨架知道该产出什么）。
    const OUTPUT_SHAPE_BY_GAP: Partial<Record<import("@platform/contracts").GapCode, string[]>> = {
      SOLVER_NOT_FOUND: ["value", "unit", "rows", "provenance"],
      NO_CAPABILITY: ["answer", "provenance"],
      SHAPE_MISMATCH: ["rows", "columns"],
      NO_PLAN: ["steps", "rows"],
      NO_SLICE: ["sliceKey", "rows"],
      NO_RULE: ["verdict", "explanation"],
    };
    for (const tk of report.openTickets) {
      const ticketId = newId("gtk");
      const drafts = scaffoldedByGap.get(tk.gapCode);
      await deps.repos.growthTickets.upsert({
        id: ticketId, tenantId: a.tenantId, fromQuestion: body.query, gapCode: tk.gapCode,
        ioContract: {
          inputs: [...new Set([...Object.keys(body.context.filters ?? {}), ...ctxTypes])],
          outputShape: OUTPUT_SHAPE_BY_GAP[tk.gapCode] ?? ["answer", "provenance"],
        },
        ontologyRefs: { objectTypes: refObjectTypes, slices: [], rules: [] },
        acceptance: drafts && drafts.length > 0
          ? `问句「${body.query}」应能答出可验证答案并过门禁。已 scaffold DRAFT 骨架（${drafts.map((d) => d.key).join(",")}），施工 = 审批发布/补全参数（非从零开发）。`
          : `问句「${body.query}」应能答出可验证答案并过门禁。建议补法：${FILL[tk.gapCode]}`,
        status: "OPEN", createdAt: now,
        ...(drafts && drafts.length > 0 ? { scaffoldedDrafts: drafts } : {}),
      });
      await emitDomainEvent(a.tenantId, "growth.ticket_opened", { ticketId, gapCode: tk.gapCode });
    }
    if (report.terminalState === "CONVERGED") {
      await emitDomainEvent(a.tenantId, "growth.converged", { question: body.query, rounds: report.rounds.length });
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

  // A5 感知层埋点：实体解析"误触发率"（域外/尝试）+ 最近域外明细（带最近邻候选）。
  app.get("/api/v1/perception/metrics", async (req) => {
    const a = await auth(req);
    return perceptionMetrics(a.tenantId);
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

  // 实时验证审计层：统一决策痕迹导出（聚合 task/answer/toolCalls → 单一可导出 JSON）。
  // ontology_validation 总判定 + human_review_required 显式字段；监管可直接出示。
  app.get("/api/v1/queries/:taskId/decision-trace", async (req) => {
    const a = await auth(req);
    const { taskId } = req.params as { taskId: string };
    const task = await deps.repos.tasks.get(taskId);
    if (!task || task.tenantId !== a.tenantId) throw new HttpError(404, "TASK_NOT_FOUND", `task not found: ${taskId}`);
    const toolCalls = await deps.repos.toolCalls.listByTask(taskId);
    const verdict = task.answer?.validationTrace?.crossValidation?.verdict;
    const ontologyValidation = !task.answer?.validationTrace
      ? "NONE"
      : verdict === "ALL_CONSISTENT" ? "ALL_PASS" : verdict === "CONFLICT" ? "CONFLICT" : verdict === "PARTIAL" ? "PARTIAL" : "NO_EVIDENCE";
    const humanReviewRequired =
      task.answer?.trustLevel === "AGENT_EXPLORATORY" || !!task.answer?.unverifiedNumerics || ontologyValidation === "CONFLICT";
    return DecisionTraceSchema.parse({
      decisionId: task.id,
      tenantId: task.tenantId,
      question: task.query,
      status: task.status,
      path: task.path,
      classification: task.classification,
      matchedIntent: task.matchedIntent,
      resolvedRefs: task.resolvedRefs ?? [],
      trustLevel: task.answer?.trustLevel,
      unverifiedNumerics: task.answer?.unverifiedNumerics ?? false,
      provenanceCount: task.answer?.provenance?.length ?? 0,
      ontologyValidation,
      humanReviewRequired,
      toolCalls: toolCalls.map((tc) => ({ tool: tc.toolName, outcome: tc.outcome, durationMs: tc.durationMs, at: tc.createdAt })),
      createdAt: task.createdAt,
      completedAt: task.completedAt,
    });
  });

  // PRD-IND-story §4.3：编排推演 DAG —— 把真实 QueryTask 轨迹确定性投影为 10 节点编排图。
  app.get("/api/v1/queries/:taskId/trace", async (req) => {
    const a = await auth(req);
    const { taskId } = req.params as { taskId: string };
    const task = await deps.repos.tasks.get(taskId);
    if (!task || task.tenantId !== a.tenantId) throw new HttpError(404, "TASK_NOT_FOUND", `task not found: ${taskId}`);
    const toolCalls = await deps.repos.toolCalls.listByTask(taskId);
    let plan: ExecutionPlan | undefined;
    if (task.path === "WORKFLOW" && task.matchedIntent) {
      const intent = await deps.repos.intents.get(task.matchedIntent.intentId);
      if (intent) plan = (await resolvePlanForIntent(deps.repos, intent))?.plan;
    }
    const gap = deriveTraceGap(task);
    const trace = projectTrace(
      task,
      plan,
      toolCalls.map((tc) => ({ toolName: tc.toolName, input: tc.input, outcome: tc.outcome })),
      gap,
      task.answer,
    );
    return InferenceTraceSchema.parse(trace);
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
    const published = await deps.catalog.publishIntent(intentId);
    await emitDomainEvent(a.tenantId, "intent.published", { intentId });
    return published;
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

  /**
   * WO-REFGATE-ENT · F14 · 出厂技能发布门审计的**诚实位**（`/b/v1/ops/*` 由 rewriteUrl 折到此处）。
   *
   * 为什么要有这道位：出厂技能经 `repos.skills.insert` 旁路落库，从未走过
   * `POST /b/v1/skills/:id/publish` —— 「门装上了」不等于「库里的东西都过了门」。
   * 启动期 `auditSeededSkills` 用**同一份判据**补问一遍，结论落在这里，运维随时可查。
   *
   * 四态里 `NOT_RUN` 与 `GATE_UNAVAILABLE` **都不是"干净"**：
   * 前者是没审计过，后者是注册表读不出来所以没法判——「我没找到」≠「它不存在」。
   */
  app.get("/api/v1/ops/skill-seed-gate", async (req) => {
    await auth(req);
    return getSeedSkillGateReport();
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
    // 管理平台增量 §4 发布校验：模型 ID 合法或留空（空=继承用途矩阵 agent 绑定，运行时 roleModel 回落）。
    if (agent.model.trim() && !/^[\w][\w.:/-]*$/.test(agent.model)) {
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
    await emitDomainEvent(a.tenantId, "agent.published", { id: published.id, key: published.key });
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

  // A1 求解器 MCP server 治理：列内置 `solvers` server + 全部工具（mcp__solvers__{key}，含净室通用族 +
  // A8 CP-SAT；OBO 已 entitlement 过滤）。源=求解器全集注册表（31，与 SOLVER_KEYS 对齐），非 QOS 场景
  // discover（22）。关某求解器 feature → 注册表不返回 → 工具消失（R3 先于 authz）。MCP 页据此显示/治理。
  app.get("/b/v1/mcp/servers/solvers", async (req) => {
    const a = await auth(req);
    const { query } = req.query as { query?: string };
    let items: { key: string; name: string; description: string; domain?: string; argHints?: Record<string, string> }[] = [];
    try { items = (await deps.dataCore.catalog.solverRegistry(a, query)).items; } catch { items = []; }
    return { server: SOLVERS_MCP_SERVER_INFO, tools: buildSolverMcpTools(items), count: items.length };
  });

  // ---------------------------------------------------------------------
  // WO-DRIL-P1 · Resource Registry（Decision Resource Intelligence Layer §6.4）
  // 一次发现全量资源（7+ 类统一 IntelligenceResource）。派生投影 R13·entitlement 先于 authz R3·租户隔离 R2。
  // ---------------------------------------------------------------------
  const resourceRegistry = new ResourceRegistryService({
    repos: deps.repos,
    dataCore: deps.dataCore,
    features: deps.features,
  });
  const listResources = async (req: FastifyRequest, reply: import("fastify").FastifyReply) => {
    const a = await auth(req);
    const { kind, tag } = req.query as { kind?: string; tag?: string };
    const items = await resourceRegistry.list(a, { kind, tag });
    reply.header("x-total-count", String(items.length));
    return { items, total: items.length };
  };
  const getResource = async (req: FastifyRequest) => {
    const a = await auth(req);
    const { kind, key } = req.params as { kind: string; key: string };
    const res = await resourceRegistry.get(a, kind, key);
    if (!res) throw new HttpError(404, "RESOURCE_NOT_FOUND", `resource not found: ${kind}/${key}`);
    return res;
  };
  // WO-DRIL-P2 · 混合检索（§6.4/§7）。POST 主入口（复杂 body）；GET 便捷入口（?query=）。
  const searchResources = async (req: FastifyRequest) => {
    const a = await auth(req);
    const raw = req.method === "GET" ? { query: (req.query as { query?: string }).query ?? "" } : (req.body ?? {});
    const parsed = ResourceSearchRequestSchema.safeParse(raw);
    if (!parsed.success) throw new HttpError(400, "INVALID_SEARCH_REQUEST", parsed.error.message);
    return resourceRegistry.search(a, parsed.data);
  };
  app.get("/b/v1/resources", listResources);
  app.get("/api/v1/resources", listResources);
  app.post("/b/v1/resources/search", searchResources);
  app.post("/api/v1/resources/search", searchResources);
  app.get("/b/v1/resources/search", searchResources);
  app.get("/api/v1/resources/search", searchResources);
  app.get("/b/v1/resources/:kind/:key", getResource);
  app.get("/api/v1/resources/:kind/:key", getResource);

  // WO-DRIL-P3 · 关系图（1-hop·§6.4）：资源↔资源出边（invokes/includes/binds）+ 即时派生对象类型边（reads/scopes）
  // + 入边（谁指向本资源）。派生投影 R13·租户隔离 R2·不存在 404。
  const getRelations = async (req: FastifyRequest) => {
    const a = await auth(req);
    const { kind, key } = req.params as { kind: string; key: string };
    const resource = await resourceRegistry.get(a, kind, key);
    if (!resource) throw new HttpError(404, "RESOURCE_NOT_FOUND", `resource not found: ${kind}/${key}`);
    const outRows = await deps.repos.resourceRelations.listFrom(a.tenantId, kind, key);
    const allRows = await deps.repos.resourceRelations.listByTenant(a.tenantId);
    const relations = relationsOf(outRows, kind, key, resource); // 出边（含对象类型 1-hop）
    const inbound = allRows
      .filter((r) => r.toKind === kind && r.toKey === key)
      .map((r) => ({ fromKind: r.fromKind, fromKey: r.fromKey, relType: r.relType }))
      .sort((x, y) => (x.fromKind + x.fromKey < y.fromKind + y.fromKey ? -1 : 1));
    return { resource: { kind, key }, relations, inbound };
  };
  app.get("/b/v1/resources/:kind/:key/relations", getRelations);
  app.get("/api/v1/resources/:kind/:key/relations", getRelations);

  // WO-DRIL-P3 · 运行时质量分（§5.4/§6.4）。GET 读当前 EWMA 分行；POST 记一次观测（success/latency）→ EWMA 更新
  // （运行时探针入口 + 可解释性演示）。派生投影 R13·租户隔离 R2。
  const qualityService = new ResourceQualityService(deps.repos);
  const getQuality = async (req: FastifyRequest) => {
    const a = await auth(req);
    const { kind, key } = req.params as { kind: string; key: string };
    const resource = await resourceRegistry.get(a, kind, key);
    if (!resource) throw new HttpError(404, "RESOURCE_NOT_FOUND", `resource not found: ${kind}/${key}`);
    const row = await qualityService.get(a, kind, key);
    return { kind, key, quality: row ?? null };
  };
  const postQuality = async (req: FastifyRequest) => {
    const a = await auth(req);
    const { kind, key } = req.params as { kind: string; key: string };
    const resource = await resourceRegistry.get(a, kind, key);
    if (!resource) throw new HttpError(404, "RESOURCE_NOT_FOUND", `resource not found: ${kind}/${key}`);
    const body = (req.body ?? {}) as { success?: unknown; latencyMs?: unknown };
    if (typeof body.success !== "boolean" || typeof body.latencyMs !== "number" || !Number.isFinite(body.latencyMs)) {
      throw new HttpError(400, "INVALID_QUALITY_PROBE", "body 须含 { success: boolean, latencyMs: number }");
    }
    const row = await qualityService.record(a, kind, key, { success: body.success, latencyMs: Math.max(0, body.latencyMs) });
    return { kind, key, quality: row };
  };
  app.get("/b/v1/resources/:kind/:key/quality", getQuality);
  app.get("/api/v1/resources/:kind/:key/quality", getQuality);
  app.post("/b/v1/resources/:kind/:key/quality", postQuality);
  app.post("/api/v1/resources/:kind/:key/quality", postQuality);

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
    await emitDomainEvent(a.tenantId, "workflow.published", { id: published.id, key: published.key });
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
    if (result.status === "CANCELLED") {
      await deps.events.emit(runId, "task.cancelled", { reason: result.reason });
      return reply.status(200).send({ runId, status: "CANCELLED", reason: result.reason, stepOutputs: result.stepOutputs });
    }
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
    const { force } = req.query as { force?: string };
    // ——— Skill 编写规范 §4 门禁一（结构 lint）+ 门禁一·补（B→A 引用闭合）———
    //
    // WO-REFGATE-ENT · F14：这两道判据**已抽到 `skill-publish-gate.ts`**，本路由与
    // `main.ts` 启动期种子审计**调用同一份实现**。原因是 F14 的病灶：出厂技能经
    // `repos.skills.insert` 旁路落库，以 `status:"PUBLISHED"` 直接进库，**一次也没走过本端点** ——
    // 「门装上了」于是被读成「库里的东西都过了门」，而这是两个不同的命题。
    // 抽一份实现出来（而不是在 seed 里再写一遍校验）是刻意的：抄一份就是装饰品，
    // 改主逻辑时另一份拿旧的去测、照样绿（CLAUDE.md 铁律 0.6）。
    //
    // 语义原样保留：
    //  · 短路——lint 未过即返回，**不打 DataCore**（I/O 顺序与此前字节一致）；
    //  · force——只豁免**质量门**（lint / 评测），**不豁免事实门**（引用死路）：
    //    审计签字不能让一个不存在的求解器变成存在，也不能让一条 DRAFT 规则变成已发布；
    //  · 注册表不可用（读不出 / 空集）→ `probeMissingRefs` 抛 503 REF_PROBE_UNAVAILABLE（fail-closed，向上冒泡）；
    //  · 位置仍在评测门之前、`repos.skills.update` 之前 ⇒ 拒发布 = **未落库**。
    const gate = await runSkillPublishGate({
      skill,
      allSkills: await deps.repos.skills.listByTenant(a.tenantId),
      probe: (want) => probeMissingRefs(deps.dataCore, a, want),
      options: { force: force === "true", shortCircuit: true },
    });
    const lint = gate.lint;
    const blocking = gate.violations[0];
    if (blocking) throw new HttpError(422, blocking.code, blocking.message);
    // Skill 编写规范 §4 门禁二：评测门禁——发布必附 ≥3 个 skill_quality 评测用例（关联本技能，
    // 应触发/不应触发/行为增益三类）+ 评测套件全过（force=true 审计豁免）。此前仅 lint，无评测门。
    const skillCases = (await deps.repos.evalCases.listByTenant(a.tenantId, "skill_quality")).filter((c) => c.skillKey === skill.key);
    if (skillCases.length < 3 && force !== "true") {
      throw new HttpError(422, "SKILL_EVAL_INSUFFICIENT", `技能发布需 ≥3 个 skill_quality 评测用例（含行为增益维度），当前 ${skillCases.length}；补用例或 force=true 审计豁免`);
    }
    // 门只数数 → 门真判别（修「名不副实」）：此前仅 length>=3，3 条同类用例即放行，而文案宣称"含行为增益维度"。
    // PRD §4 三类各须 ≥1（应触发/不应触发/行为增益）——尤其"不应触发"缺失时，误触发（污染所有无关任务）无人把守。
    if (force !== "true") {
      const cov = classifySkillEvalCases(skillCases);
      if (!cov.ok) {
        throw new HttpError(
          422,
          "SKILL_EVAL_COVERAGE",
          `skill_quality 评测用例类型覆盖不足（PRD §4 三类各需 ≥1）：缺 ${cov.missing.join("、")}；当前 应触发${cov.shouldTrigger}/不应触发${cov.shouldNotTrigger}/行为增益${cov.behaviorGain}；补用例或 force=true 审计豁免`,
        );
      }
    }
    if (skillCases.length >= 3 && force !== "true") {
      const run = await deps.evals.runSkillProbe(a, skill.key, { skillId: skill.id });
      if (run.passRate < 1) {
        throw new HttpError(422, "SKILL_EVAL_FAILED", `skill_quality 评测未全过（通过率 ${run.passRate}，${skillCases.length} 用例）；修用例或 force=true 审计豁免`);
      }
    }
    const published = { ...skill, status: "PUBLISHED" as const };
    await deps.repos.skills.update(published);
    // DF-5（Wave3 数据流闭环）：B 栈技能发布 → B 侧 outbox 领域事件 → /b/v1/outbox → 前端 F1 轮询失效
    // agent-editor 技能绑定下拉（同 workflow/agent/intent/scenario.published 一致模式·补 skill 缺口·TR2/3）。
    await emitDomainEvent(a.tenantId, "skill.published", { id: published.id, key: published.key });
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
    const body = req.body as Partial<SkillLintTarget> & { id?: string };
    let target: SkillLintTarget;
    if (body.id) {
      const skill = await deps.repos.skills.get(body.id);
      if (!skill || skill.tenantId !== a.tenantId) throw new HttpError(404, "SKILL_NOT_FOUND", `skill not found: ${body.id}`);
      // ⚠️ 此前这里只摘 `{summary, body, resources}` 三项 → WO-SKILL-3 的工业级契约规则
      //   （inputSchema/outputSchema 形状 · references/dependsOn 合法性与可解析性 · 依赖图环）
      //   在**编辑器干跑**这条路上从不参评：编辑器报「lint 通过」，同一个 skill 到发布门（:1246 传了全量 + ctx）
      //   却 422。同一份 lint 两条路两套输入 = 「接了线接错地方」，且两侧测试都能是绿的
      //   （单测直接调 lintSkill 并手传全量 → 覆盖不到这条窄化路径）。现在干跑与发布**同一份输入**。
      target = {
        summary: skill.summary,
        body: skill.body,
        resources: skill.resources,
        ...(skill.inputSchema ? { inputSchema: skill.inputSchema } : {}),
        ...(skill.outputSchema ? { outputSchema: skill.outputSchema } : {}),
        ...(skill.references ? { references: skill.references } : {}),
        ...(skill.dependsOn ? { dependsOn: skill.dependsOn } : {}),
      };
    } else {
      target = {
        summary: body.summary ?? "",
        body: body.body ?? "",
        resources: body.resources ?? [],
        ...(body.inputSchema ? { inputSchema: body.inputSchema } : {}),
        ...(body.outputSchema ? { outputSchema: body.outputSchema } : {}),
        ...(body.references ? { references: body.references } : {}),
        ...(body.dependsOn ? { dependsOn: body.dependsOn } : {}),
      };
    }
    // 干跑同样需要 ctx.allSkills（跨资源规则缺 ctx 时 `return []` = 恒过）；但**不**传 requirePublishedDeps
    //   —— 草稿态预览不该因依赖还没发布就报错（skill-lint.ts:32-33 的既定语义），发布门那半才收紧。
    return lintSkill(target, {}, { allSkills: await deps.repos.skills.listByTenant(a.tenantId) });
  });

  // ---- WO-SKILL-ORCHESTRATOR-S1 · Skill Graph 编排（PRD-skill-runtime-orchestrator §3.4）----
  const SkillGraphRunBody = z.object({
    /** 新路（推荐）：`Skill.execution`（`steps` 线性 / `graph` 图，审核方对名裁决）。 */
    execution: SkillExecutionSchema.optional(),
    /** `execution.graph` 的简写。 */
    graph: SkillGraphSchema.optional(),
    /**
     * 旧路：legacy `ExecutionPlan.steps[]` —— 走它会在响应 `source` 里如实标出，不静默。
     * 元素**不钉死** `PlanStepSchema`（闭合联合会挡掉 ExtraToolStep 三类真实可执行步骤）；
     * 语义校验由 `GraphScheduler` 调 `validatePlanSteps` 完成（裁决 v3 约束①：单一来源在函数不在类型）。
     */
    planSteps: z.array(SkillExecutionStepSchema).optional(),
    slots: z.record(z.string(), z.unknown()).optional(),
    context: z.unknown().optional(),
  });
  // 图调度**旁挂**于既有线性 `workflow/executor.ts`，不改后者。编译期拒环/拒未实现节点，
  // 运行期按层并发、数据只沿边流动（作用域 = 祖先输出）。
  app.post("/b/v1/skill-graphs/run", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    // 三路执行来源（审核方 2026-08-09 对名裁决）：`execution.graph` / `execution.steps` / legacy `plan.steps`。
    // 判别与「走了哪一路」的上报由 contracts `compileExecution` 单点负责——服务端不自己再判一次。
    // `graph` 是 `execution.graph` 的便捷简写（老调用形态，向后兼容）。
    const body = SkillGraphRunBody.parse(req.body ?? {});
    const execution = body.execution ?? (body.graph ? { graph: body.graph } : undefined);
    const scheduler = new GraphScheduler({ repos: deps.repos, dataCore: deps.dataCore });
    try {
      // R2 tenant_id everywhere：节点内所有仓储读取经 a.tenantId 过滤。
      return await scheduler.run(
        a,
        { ...(execution ? { execution } : {}), ...(body.planSteps ? { legacyPlanSteps: body.planSteps } : {}) },
        {
          runId: newId("sgr"),
          ...(body.slots ? { slots: body.slots } : {}),
          ...(body.context !== undefined ? { context: body.context } : {}),
        },
      );
    } catch (e) {
      if (e instanceof SkillGraphCompileError) {
        // 环 / 未实现节点 / 三路皆空 → 422 + 可读原因
        //（错误信封由 setErrorHandler 统一成 {error:{code,message,requestId}}）
        throw new HttpError(422, e.code, e.message);
      }
      throw e;
    }
  });

  /**
   * WO-SKILL-COMPILER-S1 · 技能编译（PRD-skill-compiler-registry §8.1「真新增端点」）。
   *
   * 七段管线的 S1 最小垂直切片：① Parser → ② Validator（**复用既有 `lintSkill`**）→ ③ 推理图派生。
   * Optimizer 与运行时包两段**未实现**，在 `stages[]` 里显式标 `NOT_IMPLEMENTED`——
   * 不返回空对象让调用方以为跑过了。
   *
   * 鉴权 / 租户 / 错误信封照抄同文件既有 skill 路由：`auth` → `requireCatalogAdmin`
   * → 跨租户一律 404 `SKILL_NOT_FOUND`（不泄漏存在性，R2 + PRD §4.2 GV-TENANT）。
   * 只读操作：不落库、不改状态、不发领域事件（`?dryRun` 语义即默认且唯一行为）。
   */
  app.post("/b/v1/skills/:id/compile", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { id } = req.params as { id: string };
    const skill = await deps.repos.skills.get(id);
    if (!skill || skill.tenantId !== a.tenantId) throw new HttpError(404, "SKILL_NOT_FOUND", `skill not found: ${id}`);
    // ⚠️ 必须传 ctx.allSkills：`lintSkill` 的跨资源规则（dependsOn 可解析 / 依赖图无环）在缺省时直接
    //    `return []`——不传等于「接了线没通」（同 server.ts:1243 publish 路已踩过的坑）。
    const allSkills = (await deps.repos.skills.listByTenant(a.tenantId)).filter((s) => s.tenantId === a.tenantId);
    // 发布态口径（requirePublishedDeps）只在技能已发布时套用；草稿编译不该因依赖还没发布就报错。
    return compileSkill(skill, { allSkills, requirePublishedDeps: skill.status === "PUBLISHED" });
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
    // WO-QOS-ONTOLOGY-CONTEXT · type-semantics 口径缓存失效：本体发布 / 规则变更 → 口径可能变（description/formula/expression），
    // 清 B 侧 type-semantics 缓存使下次注入取 A 最新真值（TTL 60s 兜底；单一真值在 A·非 B 手写 mirror）。
    if (!event || event.startsWith("ontology") || event.startsWith("rules")) {
      deps.dataCore.ontology.invalidateTypeSemantics?.(body.tenantId);
      invalidated.push("type-semantics");
    }
    // WO-PROMPT-DEFAULTS-WIRING · prompt.updated：admin 改了 DataCore 提示词模板 → 清 B 侧提示词缓存，
    // 使下次 classify 取 A 最新模板（TTL 60s 兜底；单一真值在 A·消硬编码漂移·传播 SLO ≤60s）。
    if (!event || event.startsWith("prompt")) {
      deps.dataCore.prompts?.invalidatePromptTemplate?.(body.tenantId);
      invalidated.push("prompt-templates");
    }
    return { ok: true, event: event || "(all)", invalidated };
  });

  app.put("/b/v1/llm/bindings", async (req) => {
    const a = await auth(req);
    requireRole(a, "catalog_admin");
    const body = z.object({ bindings: z.array(ModelBindingSchema) }).parse(req.body);
    await deps.repos.llmBindings.put(a.tenantId, body.bindings);
    return deps.repos.llmBindings.list(a.tenantId);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // WO-D2/D3 · 同步求解超时的两件事：**先回可行解**（incumbent）+ **把诊断说清楚**
  //
  // 病灶（审核方真跑坐实·承 WO-D1「取消已通到底层」）：超时之后用户什么都不知道、也什么都拿不到——
  //   ① 504 载荷只有一个 `SOLVER_TIMEOUT`：不说哪个求解器、跑了多久、数据多大、有没有可行解
  //      → 前端只能 `toastError` 泛化提示，用户与排查者都无从下手；
  //   ② CP-SAT 族在证最优之前先有 **incumbent**（逐步改进的可行解），超时却**全丢**——
  //      宁可给「已找到可行解·非最优」也不该给一片空白。
  //
  // ⚠ 诚实边界（哪一层做得到、哪一层做不到，写死在这里，不许被上层话术盖过）：
  //   - **做得到（本层）**：超时 → 先取消（D1 语义不变）→ 给底层一个**极短交卷窗口**；底层若把
  //     「自报非最优 + 真带解」的载荷交回来，就以 200 + **诚实标注**（incumbent/optimal:false/proven:false）
  //     返还，并附真诊断；交不回来 → 照旧 504，**绝不编造**一个 incumbent。
  //   - **做得到（DataCore 侧）**：`SOLVER_INCUMBENT_BUDGET_MS` 给 portfolio 一个自有时间预算，
  //     到点即把已求到的可行解**在调用方放弃之前**回过来（见 datacore solvers/portfolio.ts）。
  //     运维必须把它设成 **< 本服务 SOLVER_RUN_TIMEOUT_MS**，否则解来不及跨过网线。
  //   - **做不到（诚实标注·不假装）**：走真 HTTP 时，本层的取消 = **abort 那条 OBO fetch**，连接一断，
  //     DataCore 再想交卷也没有回程通道了；而 `services/optimizer/server.py` 是 ThreadingHTTPServer +
  //     BaseHTTPRequestHandler，**无取消接口、不感知客户端断开、更没有 incumbent 回传通道**，
  //     它只会把当次 CP-SAT 求完再写响应。故 **真 HTTP 链路上的 incumbent 只能靠 DataCore 侧的自有预算
  //     提前交卷**；本层的交卷窗口服务于「能交卷的求解客户端」（进程内/未来可回传的实现）。
  //     此处不粉饰：拿不到就是拿不到，诊断里 `hasIncumbent:false` 如实写。
  // ═══════════════════════════════════════════════════════════════════════

  /** 超时后给底层的交卷窗口：短到不改变「超时早返」的体感，长到够一次同步回传。 */
  const INCUMBENT_HANDBACK_MS = 300;

  /** 可能承载「解」的载荷键（数组或非空对象）——incumbent 判定必须**真看到解**，否则就是空壳。 */
  const SOLUTION_KEYS = [
    "allocation", "occupancy", "assignments", "schedule", "selected", "sequence", "bins",
    "openFacilities", "flows", "chosen", "winners", "values", "scenarios", "rows", "plan", "batches",
  ] as const;

  const sizeOf = (v: unknown): number => {
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === "object") return Object.keys(v as Record<string, unknown>).length;
    return 0;
  };

  /**
   * D3 · 从**真入参**统计规模（数组长度 / 对象键数）。
   * 诚实：代理层只看得见 args——订单/基地等真数据规模在 DataCore 侧，超时后拿不回来，
   * 故 `source:"args"` 如实标注「这是入参规模，不是全量数据规模」，缺就留空不编。
   */
  const summarizeArgScale = (args: Record<string, unknown>): SolverInputScale => {
    const counts: Record<string, number> = {};
    for (const [k, v] of Object.entries(args)) {
      const n = sizeOf(v);
      if (n > 0) counts[k] = n;
    }
    return {
      source: "args",
      counts,
      totalElements: Object.values(counts).reduce((s, n) => s + n, 0),
      argKeys: Object.keys(args).sort(),
    };
  };

  /** D3 · 交回解时把**实测**规模并进来（solution.* 前缀），source 升级为 mixed。 */
  const observeScale = (base: SolverInputScale, d: Record<string, unknown>): SolverInputScale => {
    const counts = { ...base.counts };
    for (const k of SOLUTION_KEYS) {
      const n = sizeOf(d[k]);
      if (n > 0) counts[`solution.${k}`] = n;
    }
    // 领域可得量：逐格产能台账 → 真实 (基地×窗口) 格数 + 去重基地数（有则给·无则不编）。
    const ledger = d.capacityLedger;
    if (Array.isArray(ledger) && ledger.length > 0) {
      counts["solution.capacityCells"] = ledger.length;
      const bases = new Set(ledger.map((r) => String((r as { baseId?: unknown }).baseId ?? "")).filter(Boolean));
      if (bases.size > 0) counts["solution.bases"] = bases.size;
    }
    const same = Object.keys(counts).length === Object.keys(base.counts).length;
    return {
      source: same ? base.source : "mixed",
      counts,
      totalElements: Object.values(counts).reduce((s, n) => s + n, 0),
      argKeys: base.argKeys,
    };
  };

  /**
   * D2 · incumbent 判定（**两条都满足才算**，缺一即「没有」）：
   *   ① 底层**自报非最优**：`incumbent:true` / `optimal:false` / `status:"FEASIBLE"`
   *      （明确 `optimal:true` 一票否决——绝不把最优解改标成 incumbent）；
   *   ② 载荷**真带解**：至少一个解字段非空。
   * 两条缺一 → 返回 null → 上层照旧 504。**不许**据此编一个 incumbent 出来。
   */
  const readIncumbent = (payload: unknown): { d: Record<string, unknown>; keys: string[] } | null => {
    if (!payload || typeof payload !== "object") return null;
    const raw = payload as Record<string, unknown>;
    const inner = raw.data;
    const d = (inner && typeof inner === "object" && !Array.isArray(inner) ? inner : raw) as Record<string, unknown>;
    if (d.optimal === true) return null; // 已证最优 → 不是 incumbent
    const declaresNonOptimal = d.incumbent === true || d.optimal === false || d.status === "FEASIBLE";
    if (!declaresNonOptimal) return null; // 没有任何「非最优」自述 → 不臆断
    const keys = SOLUTION_KEYS.filter((k) => sizeOf(d[k]) > 0);
    if (keys.length === 0) return null; // 空壳 → 当作「没有可行解」
    return { d, keys };
  };

  // ---------------------------------------------------------------------
  // Sync solver proxy (entitlement PRD §4): entitlement check FIRST —
  // solverKey bound to any disabled feature → 404 FEATURE_NOT_FOUND (not 403).
  // Then OBO passthrough to DataCore /a/v1/solvers/{key}/invoke.
  // ---------------------------------------------------------------------
  app.post("/b/v1/solvers/:key/run", async (req, reply) => {
    const a = await auth(req);
    const { key } = req.params as { key: string };
    const enabled = await deps.features.enabledSet(a.tenantId, a);
    if (!solverAllowed(enabled, key)) {
      throw new HttpError(404, "FEATURE_NOT_FOUND", "not found");
    }
    const body = z.object({ args: z.record(z.string(), z.unknown()).default({}) }).parse(req.body ?? {});
    // 增量 §0-2：同步求解 15s 超时 → 504 SOLVER_TIMEOUT（错误信封统一）。
    const timeoutMs = deps.config.SOLVER_RUN_TIMEOUT_MS;
    // ── WO-D1 · 超时/断开 → **真取消**底层求解（此前只有 Promise.race：不再等它 ≠ 取消它） ──────────────
    // 病灶实测：504@169ms 返回后再等 700ms，桩求解仍 finished=1（服务端还在烧）。全局推演页 portfolio
    // （最重求解器）滑杆 debounce 300ms 连发 → 用户见「超时」→ 调参重试 → 服务端叠加求解、旧的仍在跑。
    // 两条触发路径共用同一个控制器：① 本地 15s 超时；② 客户端断开（前端 AbortController / 网关断链）。
    // abort → OBO fetch 中断 → DataCore 侧 reply.raw "close" → 取消传到求解执行 / 优化器 sidecar 调用。
    const cancel = new AbortController();
    const onClientGone = () => {
      if (!reply.raw.writableEnded) cancel.abort(new Error(`solver ${key} run: client disconnected`));
    };
    reply.raw.on("close", onClientGone);
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    // WO-D3：真耗时锚点（诊断里的 elapsedMs 必须是**真差值**，不是把 timeoutMs 抄一遍）+ 真入参规模。
    const startedAt = Date.now();
    const argScale = summarizeArgScale(body.args);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        // 顺序要紧：先把 504 定死（race 就此定局），再 abort。反过来的话，取消信号的同步监听器会让
        // invoke 先抛「已取消」而抢跑赢 race → 用户拿到 500 而非 504（真踩过：本文件测试①先红后绿）。
        reject(new HttpError(504, "SOLVER_TIMEOUT", `solver ${key} run exceeded ${timeoutMs}ms`));
        cancel.abort(new Error(`solver ${key} run exceeded ${timeoutMs}ms`));
      }, timeoutMs);
    });
    // WO-D2：求解 promise 要**单独持有**——超时后还得回头向它讨 incumbent，不能只丢进 race 就撒手。
    const run = deps.dataCore.solver.invoke(a, key, body.args, cancel.signal);
    // 立刻挂旁路收敛（race 定局后 run 若再拒绝，不能变成 unhandledRejection 把进程带下水）。
    const settled: Promise<{ ok: true; value: unknown } | { ok: false; error: unknown }> = run.then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );
    try {
      return await Promise.race([run, timeout]);
    } catch (e) {
      // 兜底（不依赖上面的微任务顺序）：已判超时的请求，无论先抛出的是 504 还是"被我们取消"的下游错误，
      // 对外一律 504 SOLVER_TIMEOUT —— 我们自己发起的取消不该塌成 500 误导排查。
      if (!timedOut) throw e;

      // ── D2 · 交卷窗口：已取消（D1 语义不变），但再等一小会儿，看底层肯不肯把 incumbent 交回来 ──
      // 行为良好的求解客户端会在收到取消时 **resolve 已找到的可行解**（而非一律 reject）；
      // 交不出来（reject / 窗口耗尽）→ 一切照旧走 504。窗口一旦 settle 立即返回，不白等。
      let handbackTimer: NodeJS.Timeout | undefined;
      const handback = await Promise.race([
        settled,
        new Promise<null>((resolve) => { handbackTimer = setTimeout(() => resolve(null), INCUMBENT_HANDBACK_MS); }),
      ]).finally(() => { if (handbackTimer) clearTimeout(handbackTimer); });

      const handbackValue: unknown = handback?.ok === true ? handback.value : undefined;
      const handbackError: unknown = handback?.ok === false ? handback.error : undefined;
      const inc = readIncumbent(handbackValue);
      const elapsedMs = Date.now() - startedAt;
      const phase: SolverPhase = inc
        ? "incumbent_returned" // 交回了真可行解
        : handback === null
          ? "dispatched" // 窗口耗尽，底层一声不吭
          : handback.ok
            ? "incumbent_handback" // 窗口内回来了，但没带可用的可行解
            : "aborted_no_result"; // 窗口内以错误/取消收场
      const diagnostics: SolverTimeoutDiagnostics = {
        solverKey: key,
        timeoutMs,
        elapsedMs,
        handbackWindowMs: INCUMBENT_HANDBACK_MS,
        inputScale: inc ? observeScale(argScale, inc.d) : argScale,
        hasIncumbent: !!inc,
        phase,
        cancelRequested: true,
        ...(handbackError !== undefined
          ? { underlyingError: String((handbackError as { message?: unknown })?.message ?? handbackError).slice(0, 300) }
          : {}),
        honestNote:
          "耗时/规模为实测值；规模仅覆盖代理层可见的入参（订单/基地等全量数据规模在 DataCore 侧，超时后不可得）。" +
          "走真 HTTP 时取消即断链，DataCore 无回程通道交卷 —— 真链路的 incumbent 依赖 DataCore 自有预算（SOLVER_INCUMBENT_BUDGET_MS）提前返回；" +
          "CP-SAT sidecar（services/optimizer）无取消接口、无 incumbent 回传通道，这一层确实拿不到，不假装。",
      };

      if (inc) {
        // D2 · 有可行解 → 200 返还，并**诚实标注非最优**（顶层 + data 内双份，防调用方只读一处而误判最优）。
        const notice = incumbentNotice(key, timeoutMs, elapsedMs);
        const honesty = {
          incumbent: true as const,
          optimal: false as const,
          proven: false as const,
          resultKind: "incumbent" as const,
          degraded: true as const,
          notice,
        };
        const raw = (handbackValue && typeof handbackValue === "object" ? handbackValue : {}) as Record<string, unknown>;
        const innerData = raw.data;
        const stampedData =
          innerData && typeof innerData === "object" && !Array.isArray(innerData)
            ? { ...(innerData as Record<string, unknown>), ...honesty }
            : innerData;
        reply.status(200);
        return {
          ...raw,
          ...(innerData !== undefined ? { data: stampedData } : {}),
          ...honesty,
          diagnostics,
        };
      }

      // D2 · 没有 incumbent → **照旧 504，绝不编一个**；D3 · 但把诊断带上（既有 error 信封逐字节不变·老前端仍可解析）。
      reply.status(504);
      return {
        error: {
          code: "SOLVER_TIMEOUT",
          message: `solver ${key} run exceeded ${timeoutMs}ms`,
          requestId: req.id as string,
        },
        diagnostics,
      };
    } finally {
      if (timer) clearTimeout(timer);
      reply.raw.removeListener("close", onClientGone);
    }
  });

  // ---------------------------------------------------------------------
  // WO-LIVE-ENDPOINTS · 活①② 全局推演/产能页「人机对话」真后端端点（前端直连·替 MSW 桩）。
  //   活①compose：NL → 真 portfolio（twoStage·三方案联合求解·OBO 到 DataCore）→ 组装叙述（数字全取真值）。
  //     compose 单原语 · 非 path-B Agent → ranAgentLoop 恒 false（runAgentLoop 未落·分水岭）。
  //   活②capacity-live：NL → 识别产能 what-if → 真 generic_inference(levers)/gap_attribution（OBO）→ 叙述带溯源。
  // ---------------------------------------------------------------------
  app.post("/b/v1/sim/compose", async (req) => {
    const a = await auth(req);
    const body = z.object({
      query: z.string().default(""),
      sessionId: z.string().nullish(),
      page: z.string().optional(),
      context: z.record(z.string(), z.unknown()).optional(),
    }).parse(req.body ?? {});
    // 真 portfolio 联合求解（twoStage → globalSimOptimize·GlobalSimResponse.scenarios[] 供叙述权衡）。
    const res = await deps.dataCore.solver.invoke(a, "portfolio", {
      scenarios: [...SIM_COMPOSE_SCENARIOS],
      objective: "max_ontime",
      twoStage: true,
    });
    const gs = ((res as { data?: unknown }).data ?? res) as { scenarios?: Record<string, unknown>[] };
    return buildComposeNarrative(body.query, Array.isArray(gs.scenarios) ? gs.scenarios : []);
  });

  app.post("/b/v1/capacity-live/ask", async (req) => {
    const a = await auth(req);
    const body = z.object({
      baseId: z.string().default(""),
      question: z.string().optional(),
      query: z.string().optional(), // 兼容 {query} 变体（前端契约用 question）
      factor: z.string().optional(),
    }).parse(req.body ?? {});
    const q = (body.question ?? body.query ?? "").trim();
    const base = body.baseId || "该基地";
    const intent = classifyCapacityQuestion(q);
    if (intent.isWhatIf) {
      // 真 generic_inference mode:"levers"：从本基地派生 DAG 反推可撬动杠杆 + ±ε 敏感度（服务端 R6 真算）。
      const lv = await deps.dataCore.solver.invoke(a, "generic_inference", {
        mode: "levers",
        ...(body.baseId ? { scopeObjectIds: [body.baseId] } : {}),
        factors: intent.factors,
        topK: 5,
      });
      const lvData = ((lv as { data?: unknown }).data ?? lv) as Record<string, unknown>;
      const ans = mapLeversAnswer(q, base, body.baseId, lvData);
      if (ans.dataMode !== "EMPTY") return ans;
      // 杠杆反推空（本体该作用域无下游派生边）→ 诚实转 gap_attribution 真根因（不返空壳·KILL-MOCK-RED）。
    }
    // 根因归因：真 gap_attribution（scope 基地×因子·结构反向多跳分摊到叶级根因·带溯源）。
    const ga = await deps.dataCore.solver.invoke(a, "gap_attribution", {
      scope: { ...(body.baseId ? { baseId: body.baseId } : {}), ...(body.factor ? { factorId: body.factor } : {}) },
    });
    const gaData = ((ga as { data?: unknown }).data ?? ga) as Record<string, unknown>;
    return mapGapAnswer(q, base, body.baseId, body.factor, gaData);
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
  // A15：CLI 通用操作外壳——操作型意图分类（NL → QUERY 走 QOS ask / OPERATION 路由模块）。
  // 确定性关键词打分（R6，无 LLM）；低置信/多候选 → candidates 让 CLI 列出不瞎猜。CLI 与 GUI 平行同源。
  app.post("/b/v1/operations/classify", async (req) => {
    await auth(req); // R8：带 JWT（OBO）
    const { input } = OperationClassifyRequestSchema.parse(req.body);
    return classifyOperation(input);
  });
  // C10 试分类（catalog_admin 内联测试意图分类）：确定性词法打分（R6，无 LLM、非 SSE 异步），
  // 对该 package 已发布意图集(name/description/examples)打分返 top-N，让 CatalogPage「试分类」即时显命中/未命中。
  app.post("/b/v1/intents/classify-preview", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const body = IntentClassifyPreviewRequestSchema.parse(req.body);
    const all = await deps.repos.intents.listByPackage(body.packageId);
    const byKey = new Map<string, (typeof all)[number]>();
    for (const i of all) {
      if (i.status !== "PUBLISHED") continue;
      const cur = byKey.get(i.key);
      if (!cur || i.version > cur.version) byKey.set(i.key, i);
    }
    // 词法 token：拉丁词(≥2)+CJK 单字（确定性，R6）。
    const tok = (s: string): Set<string> => {
      const set = new Set<string>();
      const lower = s.toLowerCase();
      for (const m of lower.match(/[a-z0-9]{2,}/g) ?? []) set.add(m);
      for (const m of lower.match(/[一-龥]/g) ?? []) set.add(m);
      return set;
    };
    const qtok = tok(body.query);
    const scored = [...byKey.values()]
      .map((i) => {
        const itok = tok([i.name, i.description, ...i.examples].join(" "));
        const inter = [...qtok].filter((t) => itok.has(t)).length;
        const union = new Set([...qtok, ...itok]).size || 1;
        return { intentKey: i.key, name: i.name, score: Math.round((inter / union) * 1000) / 1000 };
      })
      .sort((x, y) => (y.score - x.score) || x.intentKey.localeCompare(y.intentKey));
    const top = scored[0] && scored[0].score > 0 ? scored[0].intentKey : null;
    return { matched: scored.slice(0, 5), top, outOfCatalog: top === null };
  });
  // A14：PRD 期望用例库（intent + 工具序列 + 答案）—— 真 Kimi 实跑后由 parity 报告标偏差。
  app.post("/b/v1/evals/seed-parity", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { packageId } = req.body as { packageId: string };
    if (!packageId) throw new HttpError(400, "VALIDATION_ERROR", "packageId required");
    return deps.evals.seedParityCases(a.tenantId, packageId);
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

  // D-29 实时环 E-c：B 侧领域事件馈源（前端 F1 双源轮询之一；?since=<ISO> 游标，R2 租户隔离）。
  app.get("/b/v1/outbox", async (req) => {
    const a = await auth(req);
    const since = (req.query as { since?: string }).since;
    const events = await deps.repos.domainEvents.listSince(a.tenantId, since);
    return events.map((e) => ({ eventId: e.id, event: e.event, createdAt: e.createdAt }));
  });

  // 场景启动器 P2：Scenario 升一等持久化对象（repo 单一来源；出厂 SCENARIO_CATALOG 懒播种）。
  // 首次访问某租户若仓储为空 → 幂等播种出厂 20 场景，保证目录始终完整（含自助新增场景）。
  const ensureScenarios = async (tenantId: string): Promise<Scenario[]> => {
    // 多租户：任意租户首次访问场景即懒补齐「场景包 + 意图 + 计划」（per-id 幂等，与卡解耦的根因修复）
    // —— 没有这步，非 demo 租户有卡但无意图 → classify 候选空 → OUT_OF_CATALOG。
    await ensureScenarioPackageSeed(deps.repos, tenantId);
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

  // ---------------------------------------------------------------------
  // g8-P3 跨系统 scaffold（G-8 核心收口）：A 栈构建后经 SERVICE_TOKEN 下发 B 栈清单，
  // 幂等 upsert 计划/意图/场景为 DRAFT（不自动上线，R4），跑无死路门 scenarioClosure，
  // 回执 ScaffoldReceipt{items, fullChainOk}。用户 JWT 一律 403（R8）。
  // ---------------------------------------------------------------------
  app.post("/b/v1/internal/scaffold", async (req, reply) => {
    const token = req.headers["x-service-token"];
    if (!deps.config.SERVICE_TOKEN || token !== deps.config.SERVICE_TOKEN) {
      throw new HttpError(403, "FORBIDDEN", "scaffold 仅限服务间调用（x-service-token）");
    }
    const m = ScaffoldManifestSchema.parse(req.body);
    const items: { kind: string; key: string; status: "REUSED" | "SCAFFOLDED" | "MISSING"; missingRefs?: string[] }[] = [];
    const pkg = (await deps.repos.packages.listByTenant(m.tenantId))[0];
    if (!pkg) {
      const all = [...m.planNeeds.map((p) => ["plan", p.planKey] as const), ...m.intentNeeds.map((i) => ["intent", i.intentKey] as const), ...m.sceneNeeds.map((s) => ["scene", s.scenarioKey] as const)];
      return reply.send({ items: all.map(([kind, key]) => ({ kind, key, status: "MISSING" as const, missingRefs: ["租户无场景包"] })), fullChainOk: false });
    }

    // ① 计划（先建，供意图 planRef 解析）
    const existingPlans = await deps.repos.plans.listByPackage(pkg.id);
    for (const pn of m.planNeeds) {
      if (existingPlans.some((p) => p.key === pn.planKey)) { items.push({ kind: "plan", key: pn.planKey, status: "REUSED" }); continue; }
      const solverKey = pn.solverKey ?? pn.planKey.replace(/^plan_/, "");
      // FDE 倒推出的求解器参数贯通到 step.params.args → 启动器跑此计划即真调求解器出答案（非空答）。
      await deps.catalog.createPlan(pkg.id, {
        key: pn.planKey,
        steps: [
          { id: "s1", type: "invoke_solver", params: { solverKey, args: (pn.args ?? {}) as Record<string, import("@platform/contracts").TemplateValue> } },
          { id: "s2", type: "render_answer", params: { blocks: [] } },
        ],
      });
      items.push({ kind: "plan", key: pn.planKey, status: "SCAFFOLDED" });
    }

    // ② 意图（planRef → 计划，DRAFT 可解析）
    const existingIntents = await deps.repos.intents.listByPackage(pkg.id);
    for (const inb of m.intentNeeds) {
      if (existingIntents.some((i) => i.key === inb.intentKey)) { items.push({ kind: "intent", key: inb.intentKey, status: "REUSED" }); continue; }
      await deps.catalog.createIntent(pkg.id, {
        key: inb.intentKey,
        name: inb.intentKey,
        description: "g8 故事倒推 scaffold（DRAFT，待审批发布）",
        examples: inb.triggers ?? [],
        enabledViews: "*",
        slots: [],
        planRef: { planKey: inb.planRef ?? inb.intentKey.replace(/^intent_/, "plan_"), version: "latest" },
        riskLevel: "COMPUTE",
        owner: "g8-scaffold",
      });
      items.push({ kind: "intent", key: inb.intentKey, status: "SCAFFOLDED" });
    }

    // ③ 场景（DRAFT；不自动发布 R4）
    for (const sn of m.sceneNeeds) {
      const existing = await deps.repos.scenarios.byKey(m.tenantId, sn.scenarioKey);
      if (existing) { items.push({ kind: "scene", key: sn.scenarioKey, status: "REUSED" }); continue; }
      const now = new Date().toISOString();
      const sc: Scenario = {
        id: newId("scn"),
        tenantId: m.tenantId,
        scenarioKey: sn.scenarioKey,
        name: sn.scenarioKey,
        domain: "",
        targetView: sn.targetView,
        intentKey: sn.intentKey ?? "",
        // E15（评审返工）：带上倒推问句（故事即问句）→ DRAFT 场景可经 grow/verify 跑出真答案（此前空串导致 query 报错断链）。
        triggerQuestion: sn.triggerQuestion ?? "",
        rules: [],
        riskLevel: "COMPUTE",
        summary: "g8 故事倒推 scaffold（DRAFT）",
        mode: "WORKFLOW_FIRST",
        presetContext: { targetView: sn.targetView, selectedObjects: [], slotPresets: {} },
        status: "DRAFT",
        version: 1,
        updatedAt: now,
      };
      await deps.repos.scenarios.upsert(sc);
      items.push({ kind: "scene", key: sn.scenarioKey, status: "SCAFFOLDED" });
    }

    // ③.5 工作流 / 技能 / Agent（债2：B 栈配置全可见，DRAFT；不自动上线 R4）
    for (const wn of m.workflowNeeds) {
      if (await deps.repos.workflows.latestByKey(m.tenantId, wn.workflowKey)) { items.push({ kind: "workflow", key: wn.workflowKey, status: "REUSED" }); continue; }
      const solverKey = wn.workflowKey.replace(/^wf_/, "");
      await deps.repos.workflows.insert({
        id: newId("wf"), tenantId: m.tenantId, key: wn.workflowKey, version: 1,
        name: wn.workflowKey, description: "g8 故事倒推 scaffold（DRAFT）",
        inputs: { type: "object", properties: {} },
        steps: [{ id: "s1", type: "invoke_solver", params: { solverKey, args: {} } }, { id: "s2", type: "render_answer", params: { blocks: [] } }],
        status: "DRAFT", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      items.push({ kind: "workflow", key: wn.workflowKey, status: "SCAFFOLDED" });
    }
    const existingSkills = await deps.repos.skills.listByTenant(m.tenantId);
    for (const sk of m.skillNeeds) {
      if (existingSkills.some((x) => x.key === sk.skillKey)) { items.push({ kind: "skill", key: sk.skillKey, status: "REUSED" }); continue; }
      await deps.repos.skills.insert({
        id: newId("skl"), tenantId: m.tenantId, key: sk.skillKey, version: 1,
        name: sk.skillKey, summary: `能力 ${sk.capability}（g8 scaffold）`, body: "g8 故事倒推 scaffold（DRAFT，待补全）",
        resources: [], status: "DRAFT",
      });
      items.push({ kind: "skill", key: sk.skillKey, status: "SCAFFOLDED" });
    }
    for (const an of m.agentNeeds) {
      if (await deps.repos.agents.latestByKey(m.tenantId, an.agentKey)) { items.push({ kind: "agent", key: an.agentKey, status: "REUSED" }); continue; }
      await deps.repos.agents.insert({
        id: newId("agt"), tenantId: m.tenantId, key: an.agentKey, version: 1,
        name: an.agentKey, description: "g8 故事倒推 scaffold（DRAFT）", model: "",  // 空=继承租户用途绑定（不硬编 claude·同 seed）
        systemPrompt: an.systemPrompt || `针对 ${an.agentKey} 的推演 agent`,
        tools: [], ruleBindings: { ruleKeys: [], mode: "POST_CHECK" }, skills: [], mcpServers: [],
        scopeDeclaration: { objectTypes: an.scopeObjectTypes ?? [], toolNames: an.tools ?? [] },
        status: "DRAFT",
      });
      items.push({ kind: "agent", key: an.agentKey, status: "SCAFFOLDED" });
    }

    // ④ 全链判定（DRAFT-aware 无死路门）：场景→意图→计划 结构接通即可（scaffold 产 DRAFT，
    //    用 forValidation 允许 DRAFT 计划解析；区别于发布期 scenarioClosure 的 PUBLISHED 严格门）。
    //    任一断 → fullChainOk=false + 对应场景标 MISSING（R11 跨系统断链）。
    let fullChainOk = true;
    const pkgIntents = await deps.repos.intents.listByPackage(pkg.id);
    const intentByKey = new Map<string, (typeof pkgIntents)[number]>();
    for (const i of pkgIntents) { const c = intentByKey.get(i.key); if (!c || i.version > c.version) intentByKey.set(i.key, i); }
    for (const sn of m.sceneNeeds) {
      const issues: string[] = [];
      const intent = intentByKey.get(sn.intentKey ?? "");
      if (!intent) issues.push(`意图「${sn.intentKey ?? ""}」未配置（死路）`);
      else if (!intent.planRef || !(await resolvePlanByRef(deps.repos, pkg.id, intent.planRef, { forValidation: true }))) issues.push(`意图「${sn.intentKey ?? ""}」未绑定执行计划`);
      if (issues.length > 0) {
        fullChainOk = false;
        const it = items.find((x) => x.kind === "scene" && x.key === sn.scenarioKey);
        if (it) { it.status = "MISSING"; it.missingRefs = issues; }
      }
    }
    return reply.send({ items, fullChainOk });
  });

  // 20 场景目录 §9：场景启动器卡片（单一来源=scenarios 仓储；非前端硬编码）。
  // SL2：关闭某视图 feature → 对应卡从 active 列表消失（默认仅返回 active+PUBLISHED）。
  app.get("/b/v1/scenarios", async (req) => {
    const a = await auth(req);
    const { includeInactive, includeDraft } = req.query as { includeInactive?: string; includeDraft?: string };
    const enabled = await deps.features.enabledSet(a.tenantId, a);
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
    const enabled = await deps.features.enabledSet(a.tenantId, a);
    if (!viewAllowed(enabled, sc.targetView)) throw new HttpError(404, "FEATURE_NOT_FOUND", "not found");
    const pkg = (await deps.repos.packages.listByTenant(a.tenantId))[0];
    if (!pkg) throw new HttpError(404, "PACKAGE_NOT_FOUND", "no scenario package for tenant");
    // WO-SCENARIO-INPUT-PHASE0：用户可覆盖自由文本 query；缺省仍用卡 triggerQuestion。
    const launchBody = LaunchScenarioBodySchema.parse(req.body ?? {});
    const userQuery = launchBody.query?.trim() || sc.triggerQuestion;
    // 产能可行性变体（如 "1天交付"）从用户 query 确定性解析，更新 presetSlots 让 path-A 真拿到归一化周数。
    let slotPresets = { ...sc.presetContext.slotPresets };
    if (userQuery !== sc.triggerQuestion) {
      const variant = parseCapacityFeasibilityVariant(userQuery);
      if (variant.modelId) slotPresets.model = variant.modelId;
      if (variant.demandDelta !== undefined) slotPresets.demandDelta = variant.demandDelta;
      if (variant.weeks !== undefined) slotPresets.weeks = variant.weeks;
      if (variant.baseId) slotPresets.base = variant.baseId;
      // R13 留痕：把天/周/月归一化结果带进去，让路径 A 答案的 validationTrace 可校验。
      if (variant.normalizedSlots) slotPresets._normalizedSlots = variant.normalizedSlots;
    }
    const body = SubmitQueryBodySchema.parse({
      packageId: pkg.id,
      query: userQuery,
      context: {
        view: sc.presetContext.targetView,
        selectedObjects: sc.presetContext.selectedObjects,
        filters: {},
        presetSlots: slotPresets,
        // §2.4 确定性绑定：卡声明的意图键随上下文进编排器 → GOVERNED 卡直接绑定意图（跳过 classify）。
        scenarioIntentKey: sc.intentKey,
        scenarioKey: sc.scenarioKey,
      },
    });
    const result = await deps.orchestrator.submitQuery(a, body);
    return reply.status(202).send({ taskId: result.taskId, status: result.status, streamUrl: result.streamUrl, scenario: sc.scenarioKey, query: userQuery });
  });

  // ---- PRD-scenario-ontogenesis P1：卡发育闭环（grow=亲手把 triggerQuestion 经 QOS 跑通验证→留痕→定 maturity）----
  // §2.2/§2.3：把卡的触发问句正序经 QOS 实跑到终态 → 验证真出答案（非空/非兜底/非 gap）才标 GOVERNED；
  // 否则 PROVISIONAL + 记缺口（§2.5 诚实，不静默）。留痕 ScenarioOntogenesisRun 落在卡上，前端可见"从哪来/到哪步"。
  // 一次发育验证（A10 正序实跑 triggerQuestion → 三环 + 诚实门 → 结论）。可重复调用：O9 自动补齐后重验。
  type VerifyResult = {
    dataOk: boolean; ontologyOk: boolean; capabilityOk: boolean;
    // O12 ADVISORY：跑通到终态且产出**非空、非 gap、非兜底**答案，但未达 dataOk（含承载数据块）的 GOVERNED 标尺
    // ——自动发育所得、待人工坐实的中间态信号（dataOk=true 时不参与定级；dataOk 为更严的 GOVERNED 门）。
    advisoryAnswer: boolean;
    vstatus: "VERIFIED" | "NOT_VERIFIED" | "NOT_RUN";
    vpath: "WORKFLOW" | "AGENT" | "NONE"; gapCode: string | null; answerPreview: string | null; taskId: string | null;
    closureIssues: string[];
  };
  const verifyScenario = async (a: RequestAuth, sc: Scenario): Promise<VerifyResult> => {
    // 本体环/能力环：意图存在且发布 + 计划可绑定（复用 scenarioClosure 口径）。
    const closure = await scenarioClosure(a.tenantId, sc);
    const pkg = (await deps.repos.packages.listByTenant(a.tenantId))[0];
    const intents = pkg ? await deps.repos.intents.listByPackage(pkg.id) : [];
    const intent = intents.filter((i) => i.key === sc.intentKey).sort((x, y) => y.version - x.version)[0];
    const capabilityOk = !!intent && intent.status === "PUBLISHED" && !!(await resolvePlanForIntent(deps.repos, intent));
    const ontologyOk = !!intent && !!(intent.planId);

    let dataOk = false, advisoryAnswer = false, vstatus: VerifyResult["vstatus"] = "NOT_RUN";
    let vpath: VerifyResult["vpath"] = "NONE", gapCode: string | null = null, answerPreview: string | null = null, taskId: string | null = null;
    if (capabilityOk) {
      try {
        const body = SubmitQueryBodySchema.parse({
          packageId: pkg!.id, query: sc.triggerQuestion,
          context: { view: sc.presetContext.targetView, selectedObjects: sc.presetContext.selectedObjects, filters: {}, presetSlots: sc.presetContext.slotPresets, scenarioIntentKey: sc.intentKey, scenarioKey: sc.scenarioKey },
        });
        const sub = await deps.orchestrator.submitQuery(a, body, undefined, { internal: true });
        taskId = sub.taskId;
        let t = await deps.repos.tasks.get(taskId);
        for (let i = 0; i < 120 && t && !["COMPLETED", "FAILED", "CANCELLED", "AWAITING_CLARIFICATION"].includes(t.status); i++) {
          await new Promise((r) => setTimeout(r, 100));
          t = await deps.repos.tasks.get(taskId);
        }
        vpath = t?.path === "AGENT" ? "AGENT" : t?.path === "WORKFLOW" ? "WORKFLOW" : "NONE";
        const blocks = t?.answer?.blocks ?? [];
        const gapBlock = blocks.find((b) => b.type === "gap");
        const fallbackText = blocks.some((b) => b.type === "text" && /未能产出回答|探索模式未能/.test(String((b as { markdown?: string }).markdown ?? "")));
        // 诚实门（闭 G-1）：答案必须**投影出真实数据**才算 VERIFIED——含承载数据的块。
        const dataBearing = blocks.some((b) =>
          b.type === "kpi" || b.type === "table" || b.type === "rule_violation" || b.type === "action_draft" ||
          (b.type === "text" && /⟦ref:/.test(String((b as { markdown?: string }).markdown ?? ""))));
        const hasReal = t?.status === "COMPLETED" && blocks.length > 0 && !gapBlock && !fallbackText && dataBearing;
        dataOk = hasReal;
        // O12 ADVISORY：发育闭环经**路径 B 探索（AGENT）**自动推出非空、非 gap、非兜底答案，但未达 dataBearing
        // （GOVERNED 标尺）→ 自动发育所得、待人工坐实的中间态。**关键边界**：路径 A 工作流只渲染静态占位文本
        // （RENDER_NOT_PROJECTED，无求解器投影）= 空壳占位，**不算 advisory**（仍 PROVISIONAL，守诚实门 RL4，
        // 不把占位文案升格）；唯有真经 agent 推理产出的非空答案才算 advisory（待人工坐实）。
        advisoryAnswer = t?.status === "COMPLETED" && blocks.length > 0 && !gapBlock && !fallbackText && !dataBearing && vpath === "AGENT";
        vstatus = hasReal ? "VERIFIED" : "NOT_VERIFIED";
        if (!hasReal) {
          gapCode = gapBlock ? String(((gapBlock as { report?: { findings?: { gapCode?: string }[] } }).report?.findings?.[0]?.gapCode) ?? "OTHER")
            : t?.status === "AWAITING_CLARIFICATION" ? "NEEDS_SLOTS" : t?.status === "FAILED" ? "RUNTIME_FAIL"
            : t?.status === "COMPLETED" && !dataBearing ? "RENDER_NOT_PROJECTED" : "NO_ANSWER";
        }
        const firstText = blocks.find((b) => b.type === "text") as { markdown?: string } | undefined;
        const firstKpi = blocks.find((b) => b.type === "kpi") as { label?: string; value?: unknown; unit?: string } | undefined;
        const kpiStr = firstKpi ? `${firstKpi.label}=${String(firstKpi.value)}${firstKpi.unit ?? ""}` : "";
        answerPreview = `${firstText?.markdown ?? ""}${kpiStr ? ` ${kpiStr}` : ""}`.trim().slice(0, 160) || (kpiStr || null);
      } catch (e) {
        vstatus = "NOT_VERIFIED"; gapCode = "RUNTIME_FAIL"; answerPreview = (e as Error).message.slice(0, 160);
      }
    } else {
      gapCode = !intent ? "MISSING_INTENT" : intent.status !== "PUBLISHED" ? "INTENT_NOT_PUBLISHED" : "MISSING_PLAN";
    }
    return { dataOk, advisoryAnswer, ontologyOk, capabilityOk, vstatus, vpath, gapCode, answerPreview, taskId, closureIssues: closure.issues };
  };

  const growScenario = async (a: RequestAuth, sc: Scenario): Promise<ScenarioOntogenesisRun> => {
    const runId = newId("sor");
    const ranAt = new Date().toISOString();
    let v = await verifyScenario(a, sc);

    // O9（P3 wiring，G-9 收尾）：首验未通过 + 缺口可自动补（AUTO_DERIVE）→ 触发 runGrowthLoop（探针→补齐→重跑→收敛），
    // 收敛后重验一次；真出可验证答案才标 GOVERNED（RL4 不放水）。诚实门：补不上的卡保持 PROVISIONAL + 开 GrowthTicket，绝不假装 GOVERNED。
    // 复用 §289 同一套 probe/fill 引擎（buildGrowthLoopWiring，RL3/RL10 单源不分叉），被调 runGrowthLoop/fill 零重写（RL3）。
    let growth: { triggered: boolean; terminalState?: string; rounds?: number; ticketId?: string } = { triggered: false };
    const initialAutoDerive = !v.dataOk && (v.gapCode === "MISSING_INTENT" || v.gapCode === "INTENT_NOT_PUBLISHED" || v.gapCode === "MISSING_PLAN" || v.gapCode === "NO_PLAN" || v.gapCode === "SOLVER_NOT_FOUND" || v.gapCode === "EMPTY_DATA" || v.gapCode === "RENDER_NOT_PROJECTED");
    if (initialAutoDerive) {
      const pkg = (await deps.repos.packages.listByTenant(a.tenantId))[0];
      if (pkg) {
        const loopBody = SubmitQueryBodySchema.parse({
          packageId: pkg.id, query: sc.triggerQuestion,
          context: { view: sc.presetContext.targetView, selectedObjects: sc.presetContext.selectedObjects, filters: {}, presetSlots: sc.presetContext.slotPresets, scenarioIntentKey: sc.intentKey, scenarioKey: sc.scenarioKey },
        });
        const { probe, fill, scaffoldedByGap } = buildGrowthLoopWiring(deps, a, loopBody, emitDomainEvent);
        await deps.events.emit(sc.scenarioKey, "scenario.growth_triggered", { scenarioKey: sc.scenarioKey, runId, gapCode: v.gapCode });
        const report = await runGrowthLoop({ question: sc.triggerQuestion, maxRounds: 6, probe, fill });
        growth = { triggered: true, terminalState: report.terminalState, rounds: report.rounds.length };
        await deps.repos.growthLedger.insert({ id: newId("glr"), tenantId: a.tenantId, report, createdAt: new Date().toISOString() });
        // 边界/未收敛（系统已做完它能做的，仍补不上）→ 诚实开 GrowthTicket（不静默、不假装 GOVERNED）。
        for (const tk of report.openTickets) {
          const ticketId = newId("gtk");
          const drafts = scaffoldedByGap.get(tk.gapCode);
          await deps.repos.growthTickets.upsert({
            id: ticketId, tenantId: a.tenantId, fromQuestion: sc.triggerQuestion, gapCode: tk.gapCode,
            ioContract: { inputs: [], outputShape: ["answer", "provenance"] },
            ontologyRefs: { objectTypes: sc.presetContext.targetView ? [sc.presetContext.targetView] : [], slices: [], rules: sc.rules ?? [] },
            acceptance: `场景卡「${sc.scenarioKey}」发育：问句「${sc.triggerQuestion}」应跑出可验证答案才能 GOVERNED。${drafts && drafts.length > 0 ? `已 scaffold DRAFT 骨架（${drafts.map((d) => d.key).join(",")}），施工=审批发布/补全参数。` : `建议补法：${tk.detail}`}`,
            status: "OPEN", createdAt: new Date().toISOString(),
            ...(drafts && drafts.length > 0 ? { scaffoldedDrafts: drafts } : {}),
          });
          growth.ticketId = ticketId;
          await emitDomainEvent(a.tenantId, "growth.ticket_opened", { ticketId, gapCode: tk.gapCode });
        }
        // 收敛（补法已推进）→ 重验一次：现可投影真实答案则升 GOVERNED；否则诚实保持 PROVISIONAL。
        if (report.terminalState === "CONVERGED") {
          await emitDomainEvent(a.tenantId, "growth.converged", { question: sc.triggerQuestion, rounds: report.rounds.length });
          v = await verifyScenario(a, sc);
        }
      }
    }

    // O11（P3 wiring）：卡声明 sliceTargets → 自动调 planSlice（OBO → DataCore /a/v1/slices/plan）把切片纳入发育闭环。
    // 复用既有 OBO 客户端模式（OntologyClient.planSlice，透传用户 JWT/X-Debug-User，与 invoke_solver/resolveSlice 同面）。
    // 规划器纯确定性图算法（R6）+ 命中索引即复用既有已发布切片（A3.4）。诚实门：NO_PATH（maxHops 内不可达）→ 出 NO_SLICE 缺口，不静默跳过。
    const sliceGaps: { gapCode: string; disposition: "AUTO_DERIVE" | "NEEDS_HUMAN"; detail: string }[] = [];
    const plannedSlices: string[] = [];
    for (const st of sc.sliceTargets ?? []) {
      if (!st.targets || st.targets.length === 0) continue;
      try {
        const res = await deps.dataCore.ontology.planSlice(a, { rootType: st.rootType, targets: st.targets, maxHops: 6 });
        if (res.ok) {
          plannedSlices.push(res.plan.sliceKey);
          // slice.planned 由 DataCore /a/v1/slices/plan 内部发（§4 单源）；此处不重复发，避免双源。
        } else {
          // 诚实：maxHops 内不可达 → NO_SLICE 缺口（需补本体链路/真人正门），不假装已长出。
          sliceGaps.push({ gapCode: "NO_SLICE", disposition: "NEEDS_HUMAN", detail: `切片规划失败（${st.rootType}）：${res.reason.unreachable.join("、")} 在 maxHops=6 内不可达——需补本体链路` });
        }
      } catch (e) {
        // DataCore 无 planSlice 路径/不可达 → 诚实标 NO_SLICE，不静默（守诚实门）。
        sliceGaps.push({ gapCode: "NO_SLICE", disposition: "NEEDS_HUMAN", detail: `切片规划调用失败（${st.rootType}）：${(e as Error).message.slice(0, 120)}` });
      }
    }

    // O12 三态成熟（PROVISIONAL→ADVISORY→GOVERNED）：
    //  - GOVERNED：dataOk（VERIFIED 含承载数据块）——最严人工标尺，grow 亲手验证真出数据才到。
    //  - ADVISORY：发育闭环跑通且产出非空、非 gap、非兜底答案，但未达 dataBearing（自动发育所得，待人工坐实）。
    //    诚实门（RL4）：不冒充 GOVERNED（未达数据承载标尺），也不含糊降级成 PROVISIONAL（确有 advisory 答案）。
    //  - PROVISIONAL：纯缺件、补不上、无任何 advisory 答案（诚实开票）。
    // 切片缺口（O11 NO_SLICE）即便答案验证通过也要诚实并入——切片未长出是发育闭环的真实缺口。
    const gaps = [
      ...(v.vstatus === "VERIFIED" ? [] : [{
        gapCode: v.gapCode ?? "OTHER",
        // 缺意图/计划=可自动补（grow/scaffold）；运行缺数据/求解器=需人工（真人正门/审批）。
        disposition: (v.gapCode === "MISSING_INTENT" || v.gapCode === "INTENT_NOT_PUBLISHED" || v.gapCode === "MISSING_PLAN" ? "AUTO_DERIVE" : "NEEDS_HUMAN") as "AUTO_DERIVE" | "NEEDS_HUMAN",
        detail: v.closureIssues.join("；") || (v.answerPreview ?? "触发问句未跑出真实答案") + (growth.triggered ? `（已触发自动补齐：${growth.terminalState}，${growth.rounds} 轮${growth.ticketId ? "，已开工单 " + growth.ticketId : ""}）` : ""),
      }]),
      ...sliceGaps,
    ];
    // 切片未长齐（NO_SLICE）→ 发育闭环未完整，maturity 不得 GOVERNED（封顶 ADVISORY，诚实降级）。
    const maturity: import("@platform/contracts").ScenarioMaturity =
      v.dataOk && sliceGaps.length === 0 ? "GOVERNED"
      : (v.dataOk || v.advisoryAnswer) ? "ADVISORY"
      : "PROVISIONAL";
    const run: ScenarioOntogenesisRun = {
      runId, scenarioKey: sc.scenarioKey, ranAt,
      rings: { data: v.dataOk, ontology: v.ontologyOk, capability: v.capabilityOk },
      verification: { status: v.vstatus, path: v.vpath, gapCode: v.gapCode, answerPreview: v.answerPreview, taskId: v.taskId },
      gaps, maturity,
    };
    await deps.repos.scenarios.upsert({ ...sc, maturity, lastOntogenesisRun: run, updatedAt: new Date().toISOString() });
    await deps.events.emit(sc.scenarioKey, maturity === "GOVERNED" ? "scenario.matured" : "scenario.gap_detected", { scenarioKey: sc.scenarioKey, runId, maturity, gapCode: v.gapCode, plannedSlices });
    return run;
  };

  // POST /b/v1/scenarios/:key/grow —— 亲手发育验证一张卡（admin/catalog_admin）。
  app.post("/b/v1/scenarios/:key/grow", async (req, reply) => {
    const a = await auth(req);
    const { key } = req.params as { key: string };
    await ensureScenarios(a.tenantId);
    const sc = (await deps.repos.scenarios.listByTenant(a.tenantId)).find((c) => c.scenarioKey === key || c.intentKey === key);
    if (!sc) throw new HttpError(404, "SCENARIO_NOT_FOUND", `scenario not found: ${key}`);
    const run = await growScenario(a, sc);
    return reply.status(200).send(run);
  });

  // ---- 场景管理（PRD §4 管理面）：创建/编辑 DRAFT · 发布/退役（发 scenario.* 事件）----
  const ScenarioUpsertBody = ScenarioSchema.omit({ id: true, tenantId: true, version: true, updatedAt: true, status: true }).partial({
    rules: true, riskLevel: true, summary: true, mode: true, presetContext: true,
  });
  // 列表（管理态：含 DRAFT/RETIRED；前端场景编辑器消费——每个用 workflow/agent 的场景都在此完整可配）
  app.get("/b/v1/scenarios/manage", async (req) => {
    const a = await auth(req);
    await ensureScenarios(a.tenantId);
    const enabled = await deps.features.enabledSet(a.tenantId, a);
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
      // O11：卡声明的切片自动规划目标（growScenario 据此 OBO 调 planSlice，纳入发育闭环）。
      ...(body.sliceTargets ? { sliceTargets: body.sliceTargets } : {}),
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
    // scenario.published 事件登记于 event-subscriptions.ts（§4 单一来源）；经 F1 双源轮询失效缓存。
    await emitDomainEvent(a.tenantId, "scenario.published", { key });
    return published;
  });
  // PRD-fde §3.1/P4 终态闭环：把 scaffold 出的 DRAFT 场景链(计划→意图→场景)一键发布(经审批 R4)→
  // 进场景启动器、可推演。此前发布场景要先手动逐个 publish 计划/意图,本端点按依赖序一次发布。
  app.post("/b/v1/scenarios/:key/publish-chain", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a); // R4：发布经审批角色（不自动上线）
    const { key } = req.params as { key: string };
    const sc = await deps.repos.scenarios.byKey(a.tenantId, key);
    if (!sc) throw new HttpError(404, "SCENARIO_NOT_FOUND", "scenario not found");
    const pkg = (await deps.repos.packages.listByTenant(a.tenantId))[0];
    if (!pkg) throw new HttpError(404, "PACKAGE_NOT_FOUND", "no package");
    const publishedChain: { kind: string; key: string }[] = [];
    // ① 计划 + 意图（依赖序：计划先，供意图 planRef 解析为 PUBLISHED）
    const intents = await deps.repos.intents.listByPackage(pkg.id);
    const intent = intents.filter((i) => i.key === sc.intentKey).sort((x, y) => y.version - x.version)[0];
    if (intent) {
      if (intent.planRef) {
        const plan = await resolvePlanByRef(deps.repos, pkg.id, intent.planRef, { forValidation: true });
        if (plan && plan.status !== "PUBLISHED") { await deps.catalog.publishPlan(plan.id); publishedChain.push({ kind: "plan", key: plan.key }); }
      }
      if (intent.status !== "PUBLISHED") { await deps.catalog.publishIntent(intent.id); publishedChain.push({ kind: "intent", key: intent.key }); }
    }
    // ② 场景（链补齐后重跑无死路上架门 → 通过才发布,进启动器）
    const closure = await scenarioClosure(a.tenantId, sc);
    if (!closure.ready) throw new HttpError(409, ErrorCodes.VALIDATION_ERROR, `场景引用未闭合（死路），不可发布：${closure.issues.join("；")}`);
    const published: Scenario = { ...sc, status: "PUBLISHED", version: sc.version + 1, updatedAt: new Date().toISOString() };
    await deps.repos.scenarios.upsert(published);
    publishedChain.push({ kind: "scenario", key });
    await emitDomainEvent(a.tenantId, "scenario.published", { key });
    return { scenario: published, publishedChain };
  });
  app.post("/b/v1/scenarios/:key/retire", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const { key } = req.params as { key: string };
    const sc = await deps.repos.scenarios.byKey(a.tenantId, key);
    if (!sc) throw new HttpError(404, "SCENARIO_NOT_FOUND", "scenario not found");
    const retired: Scenario = { ...sc, status: "RETIRED", updatedAt: new Date().toISOString() };
    await deps.repos.scenarios.upsert(retired);
    await emitDomainEvent(a.tenantId, "scenario.retired", { key });
    return retired;
  });

  app.get("/b/v1/scene-entries", async (req) => {
    const a = await auth(req);
    const entries = await deps.repos.sceneEntries.listByTenant(a.tenantId);
    // entitlement PRD §5 (B5 联动): entry referencing a disabled view → marked inactive
    const enabled = await deps.features.enabledSet(a.tenantId, a);
    return entries.map((e) => ({ ...e, inactive: !viewAllowed(enabled, e.viewKey) }));
  });

  // 前端 PRD §6.2 别名：按视图取场景入口（查询 Dock 的 placeholder/建议问题来源）。
  // ?view= 给定时返回单对象或 null（前端 fetchScene 消费形态）。
  app.get("/b/v1/scenes", async (req, reply) => {
    const a = await auth(req);
    const view = (req.query as Record<string, unknown>)["view"];
    const entries = await deps.repos.sceneEntries.listByTenant(a.tenantId);
    const enabled = await deps.features.enabledSet(a.tenantId, a);
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
