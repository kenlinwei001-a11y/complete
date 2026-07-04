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
  ScaffoldManifestSchema,
  DecisionTraceSchema,
  EvalCaseSchema,
  EvalSuiteSchema,
  OperationClassifyRequestSchema,
  IntentClassifyPreviewRequestSchema,
  classifyOperation,
  SkillDefinitionSchema,
  SubmitQueryBodySchema,
  WorkflowDefinitionSchema,
  InferenceTraceSchema,
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
import { stdioPolicyFromConfig } from "./config.js";
import { validateStdioTransport } from "./mcp/runtime.js";
import { AuthError, requireRole, resolveAuth, type RequestAuth } from "./auth.js";
import { DataCoreHttpError, DataCoreUnavailableError } from "./tools/clients.js";
import { solverAllowed, viewAllowed } from "./features/registry.js";
import { CreateIntentBodySchema, CreatePlanBodySchema, UpdateIntentBodySchema, resolvePlanForIntent, resolvePlanByRef } from "./catalog/service.js";
import { encryptSecret } from "./crypto.js";
import type { AppDeps } from "./deps.js";
import { newId } from "./ids.js";
import { decideDataGap, groundingVocab, decideTriggerBoundary, triggerDimensions } from "./growth/data-boundary.js";
import { annotateRequestId } from "./tracing.js";
import { fallbackStats, promoteFallbackTrace } from "./ops/fallback.js";
import { HttpError } from "./router/orchestrator.js";
import { projectTrace, type TraceGapInput } from "./router/project-trace.js";
import { streamTaskEvents } from "./api/sse.js";
import { BudgetTracker } from "./tools/budget.js";
import { detectStaticCycle, validatePlanSteps } from "./workflow/validate.js";
import { agentRuleRefs, planStepRuleRefs, skillRuleRefs } from "./refs/report.js";
import { detectBreakingSchemaChange } from "./workflow/compat.js";
import { applyListQuery, assertRetireOrDelete, computeReferences, probeMissingRefs, requireCatalogAdmin, type ListQuery } from "./resources.js";
import { classifyGap, FILL } from "./growth/probe.js";
import { perceptionMetrics } from "./router/perception-metrics.js";
import { runGrowthLoop } from "./growth/loop.js";
import { buildGrowthLoopWiring } from "./growth/scenario-grow.js";
import { builtinTool } from "./tools/registry.js";
import { lintSkill } from "./skill-lint.js";
import { seedScenarios } from "./scenarios-catalog.js";
import { ensureScenarioPackageSeed } from "./mocks/seed.js";
import { groundScenario, type GroundingContext, type GroundObject } from "./scenario-grounding.js";
import { EVENT_SUBSCRIPTIONS } from "./event-subscriptions.js";
import { ensureMaterializedIntents, reconcileIntents } from "./intents/reconcile.js";
import { MaterializedIntentSchema, SlotDefSchema } from "@platform/contracts";

/** PUT /b/v1/intents/:key 可编字段（mode 钉死不可改·bindings 可部分改）。
 *  注意：绑定 patch 字段全 optional 且**无 default**——避免 .partial() 保留 .default([]) 把未传的
 *  ruleKeys/constraintKeys 清空覆盖既有值（浅合并语义：只改传入的键）。 */
const IntentEditBodySchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  examples: z.array(z.string()).optional(),
  slots: z.array(SlotDefSchema).optional(),
  bindings: z
    .object({
      solverKey: z.string().optional(),
      ruleKeys: z.array(z.string()).optional(),
      constraintKeys: z.array(z.string()).optional(),
      skillId: z.string().optional(),
      ontologySliceKey: z.string().optional(),
      agentId: z.string().optional(),
      workflowId: z.string().optional(),
    })
    .optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]).optional(),
});

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
    // WO-AUDIT-OBS：跨服务追踪——优先复用入站 `x-request-id`（网关/前端可注入），无则生成。
    // 出站调 DataCore 时透传同一 requestId（见 tools/datacore-http.ts），两系统日志/错误信封一线可追。
    genReqId: (req) => {
      const inbound = req.headers["x-request-id"];
      const v = Array.isArray(inbound) ? inbound[0] : inbound;
      return typeof v === "string" && v.length > 0 && v.length <= 200 ? v : newId("req");
    },
    // 前端 PRD §3/§6.2 真连别名：QOS 端点在 QOS-PRD 中挂 /api/v1，前端契约写 {B}/b/v1。
    // /b/v1 下原生路由（agents/workflows/…）不受影响，只把 QOS 子集重写到 /api/v1。
    rewriteUrl(req) {
      const url = req.url ?? "/";
      for (const seg of ["/b/v1/queries", "/b/v1/catalog", "/b/v1/ops", "/b/v1/growth", "/b/v1/entries"]) {
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

  const auth = async (req: FastifyRequest): Promise<RequestAuth> => {
    const headers = { ...(req.headers as Record<string, string | string[] | undefined>) };
    // 前端 PRD §4.3 契约补充项：EventSource 无法携带自定义头，SSE 的 token 经 ?access_token= 传递
    const q = req.query as Record<string, unknown> | undefined;
    if (!headers["authorization"] && typeof q?.["access_token"] === "string") {
      headers["authorization"] = `Bearer ${q["access_token"] as string}`;
    }
    const a = await resolveAuth(headers, {
      dataCoreBaseUrl: deps.config.DATACORE_BASE_URL,
    });
    // WO-AUDIT-OBS：把贯穿两系统的 requestId 挂上 ctx → 出站调 DataCore 透传 x-request-id。
    a.requestId = req.id as string;
    return a;
  };

  // WO-AUDIT-OBS：每请求完成打 requestId（= 入站 x-request-id 或本服务生成），与 DataCore 日志同源可追。
  app.addHook("onResponse", async (req) => {
    req.log.info({ requestId: req.id, method: req.method, url: req.url, statusCode: req.raw.statusCode ?? "?" }, "request completed");
  });

  // WO-OBSERVABILITY (OBS-2)：传播桥接——把人读 requestId 挂到 HTTP root span 的 attr `app.request_id`，
  // 使日志里的 requestId 可在 trace 后端定位到 trace。入站若带 traceparent，OTel 已自动续 trace。
  app.addHook("onRequest", async (req) => {
    annotateRequestId(req.id as string);
  });

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
    // WO-6：轮询预算覆盖 LLM 时延上界（Kimi 单次 10-90s）。原 5s（100×50ms）<< LLM → 可答 in-catalog 问句
    // 被超时当失败 → classifyGap 落 BLOCKED/OTHER 假缺口、污染 StoryBuildRun。现 ~90s（180×500ms）。
    const PROBE_POLL_INTERVAL_MS = 500;
    const PROBE_MAX_POLLS = 180; // ≈90s，覆盖 Kimi 时延上界
    let task = await deps.repos.tasks.get(taskId);
    for (let i = 0; i < PROBE_MAX_POLLS && (!task || !TERMINAL.has(task.status)); i++) {
      await new Promise((r) => setTimeout(r, PROBE_POLL_INTERVAL_MS));
      task = await deps.repos.tasks.get(taskId);
    }
    if (!task) throw new HttpError(500, "PROBE_FAILED", "probe task vanished");
    // WO-6：超预算仍非终态（极少数超长推演）→ 诚实报"仍在推演"（BOUNDARY·非 blocking·非缺口），
    // **不**把未完成任务误判 BLOCKED 写进 GapReport/StoryBuildRun。
    if (!TERMINAL.has(task.status)) {
      return reply.status(200).send({
        question: task.query,
        taskId: task.id,
        verdict: "BOUNDARY" as const,
        path: task.path ?? "NONE",
        findings: [{
          gapCode: "OTHER" as const,
          evidence: `仍在推演（${task.status}，超 probe 预算 ${(PROBE_MAX_POLLS * PROBE_POLL_INTERVAL_MS) / 1000}s 未达终态）`,
          suggestedFill: "LLM 推演时延较长，请稍后重探或经 SSE 事件流等待终态；非缺口、不触发自动补",
          blocking: false,
        }],
        generatedAt: new Date().toISOString(),
      });
    }
    return reply.status(200).send(classifyGap(task));
  });

  // 自成长发动机 · P3：LOOP——探针→补齐→重跑→收敛（K 有界，前端可配 maxRounds）。
  app.post("/api/v1/growth/run", async (req, reply) => {
    const a = await auth(req);
    const body = SubmitQueryBodySchema.parse(req.body);
    const raw = (req.body ?? {}) as { maxRounds?: number; confirmed?: boolean; slotValues?: Record<string, unknown>; dataRequestDescription?: string };
    const maxRounds = Number(raw.maxRounds ?? 8); // K 前端可配

    // FILL-BOUNDARY-GUARDRAIL（用户钉「触发补须有边界·否则任意问题自由补数据=数据混乱」）：
    // 触发补数据前置三闸——B1 槽位完备（未接地先澄清）/ B2 模式封闭（只在已发布 schema+注册表值域内）/ B3 越界（词表外新实体→人工正门）。
    // 与 GROWTH-WORKLIST 过程闸（认领）正交组合。未 confirmed → 只返回边界判定，**不合成**；HARD_BLOCK 恒拒（confirmed 也不放行·新实体不得自动合成）。
    const slotValues = raw.slotValues ?? {};
    const contextText = [
      ...(body.context.selectedObjects ?? []).map((o) => o.objectId),
      ...Object.values(body.context.filters ?? {}).map((v) => String(v)),
    ].join(" ");
    const explicitType = body.context.selectedObjects?.[0]?.objectType;
    const targetTypeKey = explicitType || body.context.view || "Object";
    const publishedTypes = (await deps.dataCore.ontology.listObjectTypes(a).catch(() => [] as { key: string }[])).map((t) => t.key).filter((k): k is string => !!k);
    const decision = decideTriggerBoundary({
      question: body.query, contextText, providedSlots: slotValues, dimensions: triggerDimensions(),
      publishedTypes, targetTypeKey, targetIsExplicitType: !!explicitType,
    });
    if (decision.outcome === "HARD_BLOCK") {
      // B3 越界新实体：拒自动合成。若人工已填数据描述 → 登记 HARD 在办项（importData·带描述·待 R4 正门），否则回判定让前端收集描述。
      let worklistItem: import("@platform/contracts").WorklistItem | undefined;
      if (raw.dataRequestDescription && decision.dataRequest) {
        const nowIso = new Date().toISOString();
        worklistItem = {
          id: newId("wli"), tenantId: a.tenantId, fromQuestion: body.query, gapCode: "EMPTY_DATA",
          kind: "DATA_GAP", status: "OPEN",
          fillPlan: { mode: "HARD", action: "importData", typeKey: decision.dataRequest.typeKey },
          evidence: `[B3 越界新实体] ${decision.reason}｜数据描述: ${raw.dataRequestDescription}`,
          deeplink: "/connections", createdAt: nowIso, updatedAt: nowIso,
        };
        await deps.repos.growthWorklist.upsert(worklistItem);
        await emitDomainEvent(a.tenantId, "growth.fill_claimed", { worklistItemId: worklistItem.id, gapCode: "EMPTY_DATA", mode: "HARD", newEntity: true });
      }
      return reply.status(200).send({ boundaryGate: { ...decision, dataRequest: raw.dataRequestDescription && decision.dataRequest ? { ...decision.dataRequest, description: raw.dataRequestDescription } : decision.dataRequest }, ...(worklistItem ? { worklistItem } : {}) });
    }
    if (raw.confirmed !== true) {
      // 未确认：B1 缺槽位（CLARIFY·先澄清）或 B2 待人确认（PREVIEW·生成计划预览）→ 只回判定，不合成。
      return reply.status(200).send({ boundaryGate: decision });
    }
    // confirmed=true 且边界过（PREVIEW）→ 合并已解析槽位进 context.filters（供后续 probe/fill 接地）→ 跑 LOOP。
    const slotFilters: Record<string, string> = {};
    for (const [k, v] of Object.entries(slotValues)) {
      if (v == null || v === "") continue;
      slotFilters[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    const mergedBody = Object.keys(slotFilters).length > 0
      ? { ...body, context: { ...body.context, filters: { ...(body.context.filters ?? {}), ...slotFilters } } }
      : body;

    // probe/fill 单源（RL3/RL10）：抽到 growth/scenario-grow.ts，与 growScenario(O9) 共用同一套补法引擎，不分叉。
    // 补法分派：① 缺数据→真人正门补(P2 真实)；② 缺执行计划/缺求解器(in-catalog)→A3 自动 scaffold DRAFT（不发布 R4）；③ 其余→骨架工单收敛到边界。
    // 每次 fill 发 growth.fill_proposed（经 E-c domain_events → F1 全局通道反映到驾驶舱）。
    // GROWTH-WORKLIST-HUMAN-FILL：驾驶舱 LOOP 传 registerWorklist → SOFT fillData / 空租户 provisionWorld 不自动跑，
    // 改登记在办项(WorklistItem·OPEN·DATA_GAP)，该轮终态 NEEDS_HUMAN；人在看板认领后点触发才真跑（G-9 自动补→人工闸控补）。
    const { probe, fill, scaffoldedByGap } = buildGrowthLoopWiring(deps, a, mergedBody, emitDomainEvent, { registerWorklist: true });
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

  // ===== GROWTH-WORKLIST-HUMAN-FILL：在办看板（去自动补·人工点触发补数据缺口）=====
  // 看板 = 真在办项(DATA_GAP·growthWorklist) + 缺功能/缺计划工单(GrowthTicket 映射为 FEATURE/PLAN_SCAFFOLD 只读呈现)，统一按状态/认领人/类型筛。
  const TICKET_STATUS_TO_WORKLIST: Record<string, import("@platform/contracts").WorklistStatus> = {
    OPEN: "OPEN", IN_PROGRESS: "IN_PROGRESS", IN_REVIEW: "IN_PROGRESS", MERGED: "DONE", VERIFIED: "DONE",
  };
  const ticketToWorklist = (tk: import("@platform/contracts").GrowthTicket): import("@platform/contracts").WorklistItem => {
    const isPlan = !!(tk.scaffoldedDrafts && tk.scaffoldedDrafts.length > 0);
    return {
      id: tk.id, tenantId: tk.tenantId, fromQuestion: tk.fromQuestion, gapCode: tk.gapCode,
      kind: isPlan ? "PLAN_SCAFFOLD" : "FEATURE",
      status: TICKET_STATUS_TO_WORKLIST[tk.status] ?? "OPEN",
      owner: tk.assignee, evidence: tk.acceptance,
      deeplink: isPlan ? "/admin/actions" : undefined,
      createdAt: tk.createdAt, updatedAt: tk.createdAt,
    };
  };
  // 合并看板视图（DATA_GAP 真在办项 + 工单映射），按 createdAt 倒序。
  const listWorklistBoard = async (tenantId: string): Promise<import("@platform/contracts").WorklistItem[]> => {
    const items = await deps.repos.growthWorklist.listByTenant(tenantId);
    const tickets = (await deps.repos.growthTickets.listByTenant(tenantId)).map(ticketToWorklist);
    return [...items, ...tickets].sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));
  };

  // 列表 + 筛（状态/认领人/类型）；owner=me → 当前 actor。
  app.get("/api/v1/growth/worklist", async (req) => {
    const a = await auth(req);
    const { status, owner, kind } = req.query as { status?: string; owner?: string; kind?: string };
    let rows = await listWorklistBoard(a.tenantId);
    if (status) rows = rows.filter((r) => r.status === status);
    if (kind) rows = rows.filter((r) => r.kind === kind);
    if (owner) {
      const want = owner === "me" ? a.userId : owner;
      rows = rows.filter((r) => r.owner === want);
    }
    return { items: rows };
  });

  const getWorklistItem = async (tenantId: string, id: string) => {
    const w = await deps.repos.growthWorklist.get(tenantId, id);
    if (!w) {
      // FIX（复验 BLOCK）：FEATURE/PLAN_SCAFFOLD 是 GrowthTicket 只读映射·非可认领在办项——
      // 若误传工单 id（旧客户端），给**明确 409** 而非含糊 404（消除"认领 404 静默"），指明走各自工单流程。
      const tk = (await deps.repos.growthTickets.listByTenant(tenantId)).find((t) => t.id === id);
      if (tk) {
        const tkKind = tk.scaffoldedDrafts && tk.scaffoldedDrafts.length > 0 ? "PLAN_SCAFFOLD" : "FEATURE";
        throw new HttpError(409, "WORKLIST_ITEM_READONLY", `工单只读映射（${tkKind}）请走各自工单流程（审批/开发），不可在看板认领/补数据: ${id}`);
      }
      throw new HttpError(404, "WORKLIST_ITEM_NOT_FOUND", `worklist item not found: ${id}`);
    }
    return w;
  };

  // 认领：记 owner=actor，OPEN→CLAIMED，发 growth.fill_claimed。
  app.post("/api/v1/growth/worklist/:id/claim", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const w = await getWorklistItem(a.tenantId, id);
    const updated: import("@platform/contracts").WorklistItem = { ...w, status: "CLAIMED", owner: a.userId, updatedAt: new Date().toISOString() };
    await deps.repos.growthWorklist.upsert(updated);
    await emitDomainEvent(a.tenantId, "growth.fill_claimed", { worklistItemId: id, owner: a.userId, gapCode: w.gapCode });
    return updated;
  });

  // 释放：owner 清空，回 OPEN（认领人反悔/换人）。
  app.post("/api/v1/growth/worklist/:id/release", async (req) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const w = await getWorklistItem(a.tenantId, id);
    const updated: import("@platform/contracts").WorklistItem = { ...w, status: "OPEN", owner: undefined, updatedAt: new Date().toISOString() };
    await deps.repos.growthWorklist.upsert(updated);
    return updated;
  });

  // 人工触发「补数据缺口」：R4 认领人才可触发（owner==actor 或 admin）；据 fillPlan 真跑 fillData/provisionWorld（R6 seed 确定性）→ DONE。
  app.post("/api/v1/growth/worklist/:id/fill", async (req, reply) => {
    const a = await auth(req);
    const { id } = req.params as { id: string };
    const w = await getWorklistItem(a.tenantId, id);
    const isAdmin = a.roles.includes("admin");
    if (w.owner !== a.userId && !isAdmin) {
      throw new HttpError(403, "NOT_WORKLIST_OWNER", "只有认领人（或 admin）可触发补数据缺口——请先认领");
    }
    const plan = w.fillPlan;
    if (!plan) throw new HttpError(400, "NO_FILL_PLAN", "该在办项无补法计划，无法触发");
    let resultText: string;
    if (plan.action === "provisionWorld") {
      const prov = await deps.dataCore.ontology.provisionWorld(a, { scale: plan.scale ?? "S", seed: plan.seed ?? 42 });
      if (!prov.provisioned) throw new HttpError(409, "PROVISION_REFUSED", prov.reason ?? "provisionWorld 未执行（非空租户或被拒）");
      resultText = `已 provision 确定性合成起步世界（${prov.industry ?? "?"}·${prov.objectCount ?? 0} 对象·seed=${plan.seed ?? 42}）`;
    } else if (plan.action === "fillData") {
      const r = await deps.dataCore.ontology.fillData(a, { typeKey: plan.typeKey!, fields: plan.fields ?? ["id", "name", "value"], rows: plan.rows ?? 6, seed: plan.seed ?? 42 });
      resultText = `已确定性合成 PROVISIONAL（${plan.typeKey}·${r.rowCount} 行·seed=${plan.seed ?? 42}）`;
    } else {
      throw new HttpError(400, "FILL_ACTION_NOT_TRIGGERABLE", `补法 ${plan.action} 非自动触发类（HARD 真人正门导入/审批发布/需开发，请走对应深链）`);
    }
    const updated: import("@platform/contracts").WorklistItem = { ...w, status: "DONE", result: resultText, updatedAt: new Date().toISOString() };
    await deps.repos.growthWorklist.upsert(updated);
    await emitDomainEvent(a.tenantId, "growth.fill_triggered", { worklistItemId: id, owner: a.userId, gapCode: w.gapCode, action: plan.action });
    return reply.status(200).send(updated);
  });

  // ---- DATADEP-MANIFEST-READINESS 站③→④（通用就绪探测 → GROWTH-WORKLIST 看板·人工闸）------------
  // POST /b/v1/entries/:ref/readiness（ref=solver:<key>）：precondition-first 探测入口就绪——
  // 透传 DataCore checkReadiness（读声明式清单·present-vs-needed·非 run-first）→ 每 blocking gap 经
  // data-boundary decideDataGap 分 HARD/SOFT → **登记 WorklistItem(DATA_GAP·OPEN)**（不自动补·G-9 人工闸）：
  //   SOFT → fillPlan{action:fillData·R6 seed 确定性合成}；HARD（涉真实业务实体）→ fillPlan{action:importData·真人正门深链}。
  // 幂等：同入口同角色缺口只登记一条 OPEN（避免看板刷屏）。缺口喂看板后经 claim→fill 走既有 ⑤ 合成/导入。
  app.post("/api/v1/entries/:ref/readiness", async (req) => {
    const a = await auth(req);
    const { ref } = req.params as { ref: string };
    const decoded = decodeURIComponent(ref);
    const [kind, ...rest] = decoded.split(":");
    const key = rest.join(":");
    if (kind !== "solver" || !key) {
      throw new HttpError(400, "UNSUPPORTED_ENTRY_REF", `暂仅支持 solver:<key> 入口引用，收到「${decoded}」`);
    }
    const readiness = await deps.dataCore.solver.checkReadiness(a, key);
    const registered: import("@platform/contracts").WorklistItem[] = [];
    if (!readiness.ready) {
      const existing = await deps.repos.growthWorklist.listByTenant(a.tenantId);
      const vocab = groundingVocab();
      const openDataGap = (dedupeKey: string) =>
        existing.find((w) => w.kind === "DATA_GAP" && w.status !== "DONE" && (w.evidence.includes(`[${dedupeKey}]`) || w.fromQuestion === dedupeKey));
      const register = async (
        dedupeKey: string,
        gapCode: import("@platform/contracts").GapCode,
        evidence: string,
        fillPlan: import("@platform/contracts").WorklistFillPlan,
        deeplink?: string,
      ) => {
        const dup = openDataGap(dedupeKey);
        if (dup) {
          registered.push(dup);
          return;
        }
        const now = new Date().toISOString();
        const item: import("@platform/contracts").WorklistItem = {
          id: newId("wli"), tenantId: a.tenantId, fromQuestion: dedupeKey, gapCode, kind: "DATA_GAP", status: "OPEN",
          evidence: `[${dedupeKey}] ${evidence}`, fillPlan, deeplink, createdAt: now, updatedAt: now,
        };
        await deps.repos.growthWorklist.upsert(item);
        existing.push(item);
        await emitDomainEvent(a.tenantId, "growth.fill_claimed", { worklistItemId: item.id, gapCode, entryRef: readiness.entryRef, mode: fillPlan.mode });
        registered.push(item);
      };
      // ⑤ 统一合成（PRD §91）：**空世界**（所有 context 角色 present=0·无真实业务实体）→ **单条 provisionWorld**
      // （走 synthetic.runJob·真物化一致世界·origin=SYNTHETIC·R6 seed=42）——非通用正则 fill-data（值不接地·不物化对象）。
      const contextGaps = readiness.gaps.filter((g) => g.blocking && (g.atStep ?? "").startsWith("readiness:") && readiness.roles.some((r) => r.roleType === (g.atStep ?? "").slice("readiness:".length)));
      const worldEmpty = readiness.roles.length > 0 && readiness.roles.every((r) => r.present === 0);
      if (worldEmpty && contextGaps.length > 0) {
        await register(
          `${readiness.entryRef}|world-empty`,
          "EMPTY_DATA",
          `空世界（${readiness.roles.length} 个角色全 0 行）→ 合成确定性起步世界`,
          { mode: "SOFT", action: "provisionWorld", scale: "S", seed: 42 },
        );
      }
      for (const g of readiness.gaps) {
        if (!g.blocking) continue;
        const roleType = (g.atStep ?? "").startsWith("readiness:") ? g.atStep!.slice("readiness:".length) : "";
        const roleStat = readiness.roles.find((r) => r.roleType === roleType);
        // 空世界的 context 缺口已由上面单条 provisionWorld 统一覆盖（避免逐角色刷屏）。
        if (worldEmpty && roleStat) continue;
        const typeKey = roleStat?.resolvedType ?? roleType ?? "Object";
        const decision = decideDataGap(readiness.entryRef, `${typeKey} ${g.evidence}`, vocab, { typeKey });
        const dedupeKey = `${readiness.entryRef}|${g.atStep ?? g.gapCode}`;
        // 部分世界·单类型缺口：SOFT 经 synthetic 单类型物化（fillData·per-type）；HARD 真人正门导入。
        await register(
          dedupeKey,
          g.gapCode,
          g.evidence,
          decision.mode === "SOFT"
            ? { mode: "SOFT", action: "fillData", typeKey, fields: ["id", "name", "value"], rows: roleStat?.needed ?? 6, seed: 42 }
            : { mode: "HARD", action: "importData", typeKey },
          decision.mode === "HARD" ? "/connections" : undefined,
        );
      }
    }
    return { readiness, registered };
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
    // Skill 编写规范 §4 门禁二：评测门禁——发布必附 ≥3 个 skill_quality 评测用例（关联本技能，
    // 应触发/不应触发/行为增益三类）+ 评测套件全过（force=true 审计豁免）。此前仅 lint，无评测门。
    const skillCases = (await deps.repos.evalCases.listByTenant(a.tenantId, "skill_quality")).filter((c) => c.skillKey === skill.key);
    if (skillCases.length < 3 && force !== "true") {
      throw new HttpError(422, "SKILL_EVAL_INSUFFICIENT", `技能发布需 ≥3 个 skill_quality 评测用例（含行为增益维度），当前 ${skillCases.length}；补用例或 force=true 审计豁免`);
    }
    if (skillCases.length >= 3 && force !== "true") {
      const run = await deps.evals.run(a, "skill_quality", {});
      if (run.passRate < 1) {
        throw new HttpError(422, "SKILL_EVAL_FAILED", `skill_quality 评测未全过（通过率 ${run.passRate}，${skillCases.length} 用例）；修用例或 force=true 审计豁免`);
      }
    }
    const published = { ...skill, status: "PUBLISHED" as const };
    await deps.repos.skills.update(published);
    // WO-RESOURCE-REF §2.3：skill 出向规则引用上报 A（进被引用图，规则发布确认页/references 把该 skill 列为引用方）。
    const skRuleRefs = skillRuleRefs(published);
    if (deps.reportRefs && skRuleRefs.length > 0) {
      void deps.reportRefs(a.tenantId, { source: { kind: "skill", key: published.key, name: published.name }, refs: skRuleRefs });
    }
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
  // A15：CLI 通用操作外壳——操作型意图分类（NL → QUERY 走 QOS ask / OPERATION 路由模块）。
  // 确定性关键词打分（R6，无 LLM）；低置信/多候选 → candidates 让 CLI 列出不瞎猜。CLI 与 GUI 平行同源。
  app.post("/b/v1/operations/classify", async (req) => {
    await auth(req); // R8：带 JWT（OBO）
    const { input } = OperationClassifyRequestSchema.parse(req.body);
    return classifyOperation(input);
  });
  // ---- WO-INTENT-MATERIALIZE-BINDING-COMPLETE：一等 Intent（mode + 全绑定链 6 项）----
  // ①② 物化 20 一等 PUBLISHED Intent（CatalogPage 可看可编）·③ reconcile 自动补齐（R4 DRAFT）。
  // GET /b/v1/intents：列本租户 20 一等 Intent（?status= / ?mode= 过滤）。
  app.get("/b/v1/intents", async (req) => {
    const a = await auth(req);
    await ensureMaterializedIntents(deps.repos, a.tenantId);
    const { status, mode } = req.query as { status?: string; mode?: string };
    let list = await deps.repos.materializedIntents.listByTenant(a.tenantId);
    if (status) list = list.filter((i) => i.status === status);
    if (mode) list = list.filter((i) => i.mode === mode);
    return list.sort((x, y) => (x.key < y.key ? -1 : 1));
  });

  // GET /b/v1/intent-slices：一等本体切片注册表（Intent 绑定的数据源范围·前端/门可见）。
  app.get("/b/v1/intent-slices", async (req) => {
    const a = await auth(req);
    await ensureMaterializedIntents(deps.repos, a.tenantId);
    return (await deps.repos.intentSlices.listByTenant(a.tenantId)).sort((x, y) => (x.sliceKey < y.sliceKey ? -1 : 1));
  });

  // GET /b/v1/intents/:key：单个一等 Intent（含全绑定链）。
  app.get("/b/v1/intents/:key", async (req) => {
    const a = await auth(req);
    await ensureMaterializedIntents(deps.repos, a.tenantId);
    const { key } = req.params as { key: string };
    const intent = await deps.repos.materializedIntents.byKey(a.tenantId, key);
    if (!intent) throw new HttpError(404, "INTENT_NOT_FOUND", `intent not found: ${key}`);
    return intent;
  });

  // PUT /b/v1/intents/:key：编辑一等 Intent（CatalogPage 可编·catalog_admin）。mode 由审核方钉死不可改；
  // 可编 name/description/examples/slots/bindings。乐观锁经 version（updatedAt 留痕）。
  app.put("/b/v1/intents/:key", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    await ensureMaterializedIntents(deps.repos, a.tenantId);
    const { key } = req.params as { key: string };
    const intent = await deps.repos.materializedIntents.byKey(a.tenantId, key);
    if (!intent) throw new HttpError(404, "INTENT_NOT_FOUND", `intent not found: ${key}`);
    const patch = IntentEditBodySchema.parse(req.body);
    // R14：mode 逐意图钉死（审核方定）——不可经编辑改派。
    const merged = {
      ...intent,
      ...patch,
      bindings: patch.bindings ? { ...intent.bindings, ...patch.bindings } : intent.bindings,
      mode: intent.mode,
      updatedAt: new Date().toISOString(),
    };
    const validated = MaterializedIntentSchema.parse(merged);
    await deps.repos.materializedIntents.upsert(validated);
    await emitDomainEvent(a.tenantId, "intent.updated", { key });
    return validated;
  });

  // POST /b/v1/intents/reconcile：自动补齐（治本 ③·R4）——检测缺失绑定→scaffold DRAFT/复用既有→补齐报告。
  app.post("/b/v1/intents/reconcile", async (req) => {
    const a = await auth(req);
    requireCatalogAdmin(a);
    const report = await reconcileIntents({ repos: deps.repos, catalog: deps.catalog }, a.tenantId);
    if (report.scaffoldedCount > 0) await emitDomainEvent(a.tenantId, "intent.reconciled", { scaffoldedCount: report.scaffoldedCount });
    return report;
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
    // WO-10-②：REST 透传 llmMode（MOCK 仅证框架 / REAL 真打 LLM·真分·能红路径B故障）+ 可选超时。
    const body = z.object({
      suite: EvalSuiteSchema.default("classifier"),
      agentKey: z.string().optional(),
      llmMode: z.enum(["MOCK", "REAL"]).optional(),
      timeoutMs: z.number().int().positive().max(600000).optional(),
    }).parse(req.body ?? {});
    return deps.evals.run(a, body.suite, {
      ...(body.agentKey ? { agentKey: body.agentKey } : {}),
      ...(body.llmMode ? { llmMode: body.llmMode } : {}),
      ...(body.timeoutMs ? { timeoutMs: body.timeoutMs } : {}),
    });
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
  const ensureScenarios = async (tenantId: string, a?: RequestAuth): Promise<Scenario[]> => {
    // 多租户：任意租户首次访问场景即懒补齐「场景包 + 意图 + 计划」（per-id 幂等，与卡解耦的根因修复）
    // —— 没有这步，非 demo 租户有卡但无意图 → classify 候选空 → OUT_OF_CATALOG。
    // LAUNCHER-GROUNDED-QUESTIONS（Part A·R14）：有 auth → 按租户真数据 + sim-clock 接地各卡 slotPresets
    // 并覆写派生计划的 invoke_solver 死入参（boot 曾无接地烘焙死 lineId）→ 求解器答案回显真对象、与卡面一致。
    let groundedSlots: Map<string, Record<string, unknown>> | undefined;
    if (a) {
      const gctx = await buildGroundingContext(a);
      groundedSlots = new Map();
      for (const sc of seedScenarios(tenantId)) {
        const g = groundScenario({ triggerQuestion: sc.triggerQuestion, presetContext: sc.presetContext }, gctx);
        groundedSlots.set(sc.intentKey, g.slotPresets);
      }
    }
    await ensureScenarioPackageSeed(deps.repos, tenantId, groundedSlots);
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

  // LAUNCHER-GROUNDED-QUESTIONS（Part A·根因 R14）：为场景卡接地组装「(对象库 ∩ sim-clock) 现状」上下文。
  // 从租户真实数据（对象实例 + 模拟时钟）派生，零硬编码死对象/死月份；短 TTL 缓存（B→A 60s 口径）避免每卡往返。
  const GROUND_TYPES = ["Line", "Base", "Model", "Customer"] as const;
  const groundingCache = new Map<string, { at: number; ctx: GroundingContext }>();
  const buildGroundingContext = async (a: RequestAuth): Promise<GroundingContext> => {
    const cached = groundingCache.get(a.tenantId);
    if (cached && Date.now() - cached.at < 60_000) return cached.ctx;
    const objectsByType: Record<string, GroundObject[]> = {};
    for (const type of GROUND_TYPES) {
      try {
        const payload = await deps.dataCore.ontology.queryObjects(a, type, {}, 500);
        // 归一化响应体：HTTP DataCore 返回 { data: [...] }（data 即数组）；mock 返回 { data: { items: [...] } }。
        const dd = payload?.data as unknown;
        const raw = (Array.isArray(dd) ? dd : ((dd as { items?: unknown[] })?.items ?? [])) as Record<string, unknown>[];
        // 归一化两种形态：HTTP {id,props:{...}} / mock 扁平 {baseId,name,...}。业务主键 prop 按类型取。
        const keyProp = ({ Line: "lineId", Base: "baseId", Model: "modelId", Customer: "custName" } as Record<string, string>)[type] ?? "id";
        const objs: GroundObject[] = raw.map((item) => {
          const props = (item.props && typeof item.props === "object" ? item.props : item) as Record<string, unknown>;
          const key = String(props[keyProp] ?? item[keyProp] ?? item.id ?? item.objectId ?? "");
          const id = String(item.id ?? item.objectId ?? key);
          const label = String(props.name ?? props.custName ?? key);
          return { id, key, label };
        }).filter((o) => o.key);
        objs.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)); // 确定性首选（R6）
        objectsByType[type] = objs;
      } catch {
        // 未探测该类型（DataCore 不可达/无权限）→ 不写键（groundScenario 尽力不接地不 gap，诚实）。
      }
    }
    const clock = await deps.dataCore.ontology.getSimClock(a).catch(() => undefined);
    const ctx: GroundingContext = { simDate: clock?.simDate, objectsByType };
    groundingCache.set(a.tenantId, { at: Date.now(), ctx });
    return ctx;
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
        resources: [], mcpServers: [], status: "DRAFT",
      });
      items.push({ kind: "skill", key: sk.skillKey, status: "SCAFFOLDED" });
    }
    for (const an of m.agentNeeds) {
      if (await deps.repos.agents.latestByKey(m.tenantId, an.agentKey)) { items.push({ kind: "agent", key: an.agentKey, status: "REUSED" }); continue; }
      await deps.repos.agents.insert({
        id: newId("agt"), tenantId: m.tenantId, key: an.agentKey, version: 1,
        name: an.agentKey, description: "g8 故事倒推 scaffold（DRAFT）", model: "", // 空=继承 agent 用途绑定（不钉字面量·防 roleModel 旁路）
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
    const enabled = await deps.features.enabledSet(a.tenantId, a.token);
    const launcherOn = viewAllowed(enabled, "scenarios");
    const all = await ensureScenarios(a.tenantId, a);
    // LAUNCHER-GROUNDED-QUESTIONS（Part A）：下发前按租户真数据 + sim-clock 接地每卡
    // （死对象→真实例·相对时间→具体值·补必填槽·不可答标 needsData 入待补区）。零硬编码（R14）。
    const gctx = await buildGroundingContext(a);
    const cards = all
      .filter((s) => s.status !== "RETIRED")
      .filter((s) => includeDraft === "true" || s.status === "PUBLISHED")
      .map((s) => {
        const g = groundScenario({ triggerQuestion: s.triggerQuestion, presetContext: s.presetContext }, gctx);
        return {
          // 兼容旧字段（前端启动器/评测沿用 sNo/view/name）：投影出 ScenarioCard 形态 + 一等字段。
          sNo: s.scenarioKey,
          name: s.name,
          view: s.targetView,
          domain: s.domain,
          intentKey: s.intentKey,
          triggerQuestion: g.triggerQuestion, // 接地后具象问句（相对时间已解析）
          solver: s.solver,
          rules: s.rules,
          riskLevel: s.riskLevel,
          summary: s.summary,
          mode: s.mode,
          defaultAgentId: s.defaultAgentId,
          presetContext: { targetView: s.presetContext.targetView, selectedObjects: g.selectedObjects, slotPresets: g.slotPresets },
          status: s.status,
          willProduceDraft: s.riskLevel === "ACTION_DRAFT",
          inactive: !viewAllowed(enabled, s.targetView),
          // 接地结果：needsData=接地后仍不可答（引用类型零实例）→ 前端归入"待补数据"区。
          needsData: g.needsData,
          groundingGap: g.groundingGap,
        };
      })
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
    await ensureScenarios(a.tenantId, a);
    const all = await deps.repos.scenarios.listByTenant(a.tenantId);
    const sc = all.find((c) => c.scenarioKey === key || c.intentKey === key);
    if (!sc) throw new HttpError(404, "SCENARIO_NOT_FOUND", `scenario not found: ${key}`);
    if (sc.status !== "PUBLISHED") throw new HttpError(409, ErrorCodes.INVALID_STATE, `场景未发布（${sc.status}），不可启动`);
    // entitlement 先于 authz（R3）：场景所属视图关闭 → 功能不存在
    const enabled = await deps.features.enabledSet(a.tenantId, a.token);
    if (!viewAllowed(enabled, sc.targetView)) throw new HttpError(404, "FEATURE_NOT_FOUND", "not found");
    const pkg = (await deps.repos.packages.listByTenant(a.tenantId))[0];
    if (!pkg) throw new HttpError(404, "PACKAGE_NOT_FOUND", "no scenario package for tenant");
    // LAUNCHER-GROUNDED-QUESTIONS（Part A）：启动同样接地（死对象→真实例·相对时间→具体值），
    // 使 QOS 收到的问句/预设/选中对象均为租户真值；并注入 sim-clock 锚点 timeWindow → fillSlots
    // 的既有相对时间归结（BP-6 resolveRelativeDate）可解析任何 date 槽（R14 数据驱动·R6 确定性）。
    const gctx = await buildGroundingContext(a);
    const g = groundScenario({ triggerQuestion: sc.triggerQuestion, presetContext: sc.presetContext }, gctx);
    const body = SubmitQueryBodySchema.parse({
      packageId: pkg.id,
      query: g.triggerQuestion,
      context: {
        view: sc.presetContext.targetView,
        selectedObjects: g.selectedObjects,
        filters: {},
        presetSlots: g.slotPresets,
        ...(gctx.simDate ? { timeWindow: { from: gctx.simDate, to: gctx.simDate } } : {}),
        // §2.4 确定性绑定：卡声明的意图键随上下文进编排器 → GOVERNED 卡直接绑定意图（跳过 classify）。
        scenarioIntentKey: sc.intentKey,
        scenarioKey: sc.scenarioKey,
      },
    });
    const result = await deps.orchestrator.submitQuery(a, body);
    return reply.status(202).send({ taskId: result.taskId, status: result.status, streamUrl: result.streamUrl, scenario: sc.scenarioKey });
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
    // G-9 招牌：空租户根因（无对象世界）使卡路由落 path-B、gapCode 落 OTHER/NO_INTENT——本身不在可自动补集，
    // 但"世界全空"是确定可自动补的（经合成正门 provision 起步世界，见 fill）。故首验未过且租户世界全空 → 也触发
    // runGrowthLoop（fill 首轮 provision world → 重跑路由归位 → 收敛）。仅探测计数，零行业常数（R14）。
    let worldEmpty = false;
    if (!v.dataOk) {
      const types = await deps.dataCore.ontology.listObjectTypes(a).catch(() => [] as { instanceCount: number }[]);
      worldEmpty = types.length === 0 || types.every((t) => (t.instanceCount ?? 0) === 0);
    }
    const initialAutoDerive = !v.dataOk && (worldEmpty || v.gapCode === "MISSING_INTENT" || v.gapCode === "INTENT_NOT_PUBLISHED" || v.gapCode === "MISSING_PLAN" || v.gapCode === "NO_PLAN" || v.gapCode === "SOLVER_NOT_FOUND" || v.gapCode === "EMPTY_DATA" || v.gapCode === "RENDER_NOT_PROJECTED");
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
    // G-9 招牌留痕：若发育闭环触发且原世界全空 → 统计经合成正门 provision 出的对象世界规模（前端"长出"故事）。
    let provisionedObjects = 0;
    if (growth.triggered && worldEmpty) {
      const after = await deps.dataCore.ontology.listObjectTypes(a).catch(() => [] as { instanceCount: number }[]);
      provisionedObjects = after.reduce((s, t) => s + (t.instanceCount ?? 0), 0);
    }
    const run: ScenarioOntogenesisRun = {
      runId, scenarioKey: sc.scenarioKey, ranAt,
      rings: { data: v.dataOk, ontology: v.ontologyOk, capability: v.capabilityOk },
      verification: { status: v.vstatus, path: v.vpath, gapCode: v.gapCode, answerPreview: v.answerPreview, taskId: v.taskId },
      gaps, maturity,
      growth: { triggered: growth.triggered, terminalState: growth.terminalState ?? null, rounds: growth.rounds ?? 0, provisionedObjects },
    };
    await deps.repos.scenarios.upsert({ ...sc, maturity, lastOntogenesisRun: run, updatedAt: new Date().toISOString() });
    await deps.events.emit(sc.scenarioKey, maturity === "GOVERNED" ? "scenario.matured" : "scenario.gap_detected", { scenarioKey: sc.scenarioKey, runId, maturity, gapCode: v.gapCode, plannedSlices });
    return run;
  };

  // POST /b/v1/scenarios/:key/grow —— 亲手发育验证一张卡（admin/catalog_admin）。
  app.post("/b/v1/scenarios/:key/grow", async (req, reply) => {
    const a = await auth(req);
    const { key } = req.params as { key: string };
    await ensureScenarios(a.tenantId, a);
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
    await ensureScenarios(a.tenantId, a);
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
    await ensureScenarios(a.tenantId, a);
    const sc = await deps.repos.scenarios.byKey(a.tenantId, (req.params as { key: string }).key);
    if (!sc) throw new HttpError(404, "SCENARIO_NOT_FOUND", "scenario not found");
    return scenarioClosure(a.tenantId, sc);
  });
  app.get("/b/v1/scenarios/:key", async (req) => {
    const a = await auth(req);
    await ensureScenarios(a.tenantId, a);
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
