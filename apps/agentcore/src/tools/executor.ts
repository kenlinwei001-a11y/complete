import { AggregateRequestSchema, ErrorCodes, parseMcpToolFullName, parseSolverMcpToolName, QueryTimeseriesAggInputSchema, type SkillDefinition } from "@platform/contracts";
import { newId } from "../ids.js";
import { SKILL_RESOURCE_TEXT_LIMIT } from "../agent/context.js";
import type { Metrics } from "../metrics.js";
import type { Repos, ToolCallRow } from "../persistence/repos.js";
import { byteLength, digest, redact } from "../util/redact.js";
import { cosine, pseudoEmbed } from "../util/embedding.js";
import { BudgetTracker } from "./budget.js";
import { builtinTool } from "./registry.js";
import { DataCoreUnavailableError, type DataCoreClient, type ToolAuthCtx } from "./clients.js";
import type { McpClientPort } from "../mcp/types.js";
import type { SkillResourceReader } from "./skill-resources.js";

export type ToolBinding = { kind: "BUILTIN" } | { kind: "MCP"; mcpConfigId: string };

export interface ToolRunResult {
  ok: boolean;
  payload: unknown;
  toolCallId: string;
  outcome: "OK" | "DENIED" | "ERROR" | "BUDGET_EXCEEDED";
  durationMs: number;
}

export interface ExecutorOptions {
  taskId: string;
  ctx: ToolAuthCtx;
  /** Path B / agent runs only — shared across nested invocations. */
  budget?: BudgetTracker;
  /** Agent scopeDeclaration.toolNames — calls outside it are rejected regardless of user perms. */
  scopeToolNames?: string[];
}

export interface ExecutorDeps {
  dataCore: DataCoreClient;
  mcp?: McpClientPort;
  repos: Repos;
  metrics: Metrics;
  /** 增量 §3：read_skill_resource 的附件内容读取端口（缺省 → 仅返回元信息）。 */
  skillResources?: SkillResourceReader;
}

const OUTPUT_LIMIT = 64 * 1024;

function withTimeout<T>(p: Promise<T>, ms: number | undefined, label: string): Promise<T> {
  if (!ms) return p;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * GuardedToolExecutor (QOS-PRD §7.3): IamClient.check → Budget(path B) → client call →
 * tool_calls audit. Client exceptions wrapped as { ok:false, payload:{ error } } — never thrown.
 */
export class GuardedToolExecutor {
  /** §13.1 任务级快照锚点：本执行器（=一次任务运行）首读时捕获，之后复用。 */
  private taskEpoch?: number;
  /** #6 任务内 READ 结果缓存（key=tool|canonicalArgs）；与任务级快照同生命周期。 */
  private readonly readCache = new Map<string, unknown>();

  constructor(
    private readonly deps: ExecutorDeps,
    private readonly opts: ExecutorOptions,
  ) {}

  /** 首读捕获租户 epoch；失败（如 DataCore 不支持）则返回 undefined → 读路径退化为活数据。 */
  private async taskSnapshotEpoch(ctx: ToolAuthCtx): Promise<number | undefined> {
    if (this.taskEpoch !== undefined) return this.taskEpoch;
    try {
      this.taskEpoch = (await this.deps.dataCore.epoch.current(ctx)).epoch;
    } catch {
      this.taskEpoch = undefined;
    }
    return this.taskEpoch;
  }

  get authCtx(): ToolAuthCtx {
    return this.opts.ctx;
  }

  async run(
    toolName: string,
    input: unknown,
    options?: {
      binding?: ToolBinding;
      timeoutMs?: number;
      /**
       * 增量 §5：并行 READ 轮的预算确定性 —— 循环侧按 tool_use 顺序预先计数，
       * 此处不再重复消耗（{ok:false} 直接回 BUDGET_EXCEEDED）。
       */
      budgetDecision?: { ok: true } | { ok: false; reason: string };
      /** 约束执行层 stage3②：声明此工具输出应符合的本体对象类型 → 运行时强制校验,不符拒（信任边界）。 */
      expectsObjectType?: string;
    },
  ): Promise<ToolRunResult> {
    const started = Date.now();
    const binding = options?.binding ?? { kind: "BUILTIN" as const };

    // 0) agent scopeDeclaration gate (platform PRD §6.3 Q2 — independent of user perms)
    if (this.opts.scopeToolNames && !this.opts.scopeToolNames.includes(toolName)) {
      return this.finish(toolName, input, { error: ErrorCodes.AGENT_SCOPE_VIOLATION }, "DENIED", started, false);
    }

    // 0.5) OBO token about to expire (<60s) → refuse to start new tool calls (platform PRD §11)
    const exp = this.opts.ctx.tokenExpiresAt;
    if (exp !== undefined && exp * 1000 - Date.now() < 60_000) {
      this.deps.metrics.oboDenied.inc();
      return this.finish(toolName, input, { error: "OBO_TOKEN_EXPIRING" }, "DENIED", started, false);
    }

    // A1 求解器 MCP 工具：mcp__solvers__{key} → 复用既有 invoke_solver 执行路径（OBO 到 DataCore，零重写）。
    // scope 门已用原名校验（line 110），此处归一到 invoke_solver 供下游分发；审计名亦记为 invoke_solver。
    const solverKeyFromMcp = parseSolverMcpToolName(toolName);
    if (solverKeyFromMcp) {
      const inp = (input ?? {}) as Record<string, unknown>;
      toolName = "invoke_solver";
      input = { solverKey: solverKeyFromMcp, args: (inp.args as Record<string, unknown>) ?? {} };
    }

    // 1) coarse-grained IAM check
    try {
      const verdict = await this.deps.dataCore.iam.check(this.opts.ctx, toolName, input);
      if (!verdict.allowed) {
        return this.finish(
          toolName,
          input,
          { error: "PERMISSION_DENIED", reason: verdict.reason ?? "无权访问" },
          "DENIED",
          started,
          false,
        );
      }
    } catch (err) {
      return this.finish(toolName, input, wrapError(err), "ERROR", started, false);
    }

    // 2) budget (path B only)；并行轮由循环侧预计数（budgetDecision 传入）
    if (options?.budgetDecision) {
      if (!options.budgetDecision.ok) {
        return this.finish(
          toolName,
          input,
          { error: "BUDGET_EXCEEDED", reason: options.budgetDecision.reason },
          "BUDGET_EXCEEDED",
          started,
          false,
        );
      }
    } else if (this.opts.budget) {
      const cost = builtinTool(toolName)?.costClass ?? "CHEAP";
      const ok = this.opts.budget.tryConsume(cost);
      if (!ok.ok) {
        return this.finish(toolName, input, { error: "BUDGET_EXCEEDED", reason: ok.reason }, "BUDGET_EXCEEDED", started, false);
      }
    }

    // 3) client call — #6 任务内 READ 结果记忆化（仅 BUILTIN READ；COMPUTE/写/MCP 不缓存，
    // 因 invoke_solver 等有副作用如 M11 forecastSnapshots/calibrationForecasts，缓存会破坏其契约）。
    // 与 #2 任务级快照一致：任务内 READ 一致，故缓存正确；仍走 finish() 记 tool_call 以保溯源。
    const cacheable = binding.kind === "BUILTIN" && builtinTool(toolName)?.sideEffect === "READ";
    const ckey = cacheable ? `${toolName}|${canonicalArgs(input)}` : "";
    if (cacheable && this.readCache.has(ckey)) {
      return this.finish(toolName, input, this.readCache.get(ckey), "OK", started, true);
    }
    try {
      const payload = await withTimeout(this.dispatch(toolName, input, binding), options?.timeoutMs, toolName);
      // stage3②：声明了 expectsObjectType → 工具输出按本体对象类型 schema/值域强制校验,不符拒（DENIED）。
      if (options?.expectsObjectType) {
        const p = payload as { rows?: unknown; data?: unknown };
        const rowsRaw = Array.isArray(p?.rows) ? p.rows : Array.isArray(p?.data) ? p.data : Array.isArray(payload) ? payload : [];
        const rows = (rowsRaw as unknown[]).filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
        if (rows.length > 0) {
          const vr = await this.deps.dataCore.ontology.validateOutput(this.opts.ctx, options.expectsObjectType, rows);
          if (!vr.ok) {
            return this.finish(toolName, input, { error: "ONTOLOGY_VALIDATION_FAILED", objectType: options.expectsObjectType, violations: vr.violations }, "DENIED", started, false);
          }
        }
      }
      if (cacheable) this.readCache.set(ckey, payload);
      return this.finish(toolName, input, payload, "OK", started, true);
    } catch (err) {
      return this.finish(toolName, input, wrapError(err), "ERROR", started, false);
    }
  }

  private async dispatch(toolName: string, input: unknown, binding: ToolBinding): Promise<unknown> {
    const ctx = this.opts.ctx;
    if (binding.kind === "MCP") {
      if (!this.deps.mcp) throw new Error("MCP client not configured");
      // 增量 §4.2：模型可见名/审计名是 mcp__{serverName}__{toolName} 全名；
      // 调下游 MCP server 时还原为原始工具名（invoke_mcp_tool 旧形态原名直传兼容）。
      const parsed = parseMcpToolFullName(toolName);
      const rawName = parsed?.toolName ?? toolName;
      return this.deps.mcp.callTool(binding.mcpConfigId, rawName, input as Record<string, unknown>);
    }
    const args = (input ?? {}) as Record<string, unknown>;
    switch (toolName) {
      case "discover": {
        const kind = String(args.kind);
        if (kind !== "slices" && kind !== "solvers" && kind !== "mcp_tools") {
          return { error: "kind must be slices|solvers|mcp_tools" };
        }
        if (kind === "mcp_tools") {
          // §2 MCP 按需加载目录：当前部署未启用 >24 工具按需加载模式 → 空目录
          return { items: [] };
        }
        return this.deps.dataCore.catalog.discover(ctx, kind, args.query ? String(args.query) : undefined);
      }
      case "resolve_slice":
        return this.deps.dataCore.ontology.resolveSlice(
          ctx,
          String(args.sliceKey),
          (args.args ?? {}) as Record<string, unknown>,
        );
      case "query_objects":
        return this.deps.dataCore.ontology.queryObjects(
          ctx,
          String(args.objectType),
          (args.filter ?? {}) as Record<string, unknown>,
          args.limit === undefined ? undefined : Math.min(Number(args.limit), 200),
          // 并发一致性 §13.1：任务内首读捕获 taskEpoch，后续读复用 → 任务级快照一致（近似 MVCC）
          await this.taskSnapshotEpoch(ctx),
        );
      case "get_object":
        return this.deps.dataCore.ontology.getObject(ctx, String(args.objectType), String(args.objectId));
      // Dogfooding P3：问运行中的系统自己（受 DataCore MetaAccessPolicy 白名单门控,OBO 透传）。
      case "query_system_ontology":
        return this.deps.dataCore.ontology.queryMetaOntology(ctx);
      case "get_breakpoint":
        return this.deps.dataCore.ontology.getMetaBreakpoint(ctx, String(args.id));
      case "impact_of":
        return this.deps.dataCore.ontology.metaImpact(ctx, String(args.node));
      case "aggregate_objects":
        // 治理增量 §3.6 / G8：contracts IO 强校验，聚合下推（避免拉全量行）。
        return this.deps.dataCore.ontology.aggregateObjects(ctx, AggregateRequestSchema.parse(input));
      case "invoke_solver":
        return this.deps.dataCore.solver.invoke(ctx, String(args.solverKey), (args.args ?? {}) as Record<string, unknown>);
      case "evaluate_rules":
        return this.deps.dataCore.rules.evaluate(
          ctx,
          args.ruleIds as string[] | "ALL_APPLICABLE",
          args.payload,
        );
      case "create_action_draft":
        return this.deps.dataCore.action.createDraft(ctx, String(args.actionType), args.payload ?? args);
      case "search_knowledge":
        return this.deps.dataCore.kb.search(ctx, {
          query: String(args.query),
          topK: args.topK === undefined ? undefined : Math.min(Math.max(1, Number(args.topK)), 10),
          connId: args.connId === undefined ? undefined : String(args.connId),
        });
      case "query_timeseries_agg":
        // contracts IO enforced at the boundary; invalid input → TOOL_ERROR (never raw rows)
        return this.deps.dataCore.timeseries.aggQuery(ctx, QueryTimeseriesAggInputSchema.parse(input));
      case "read_skill_resource":
        return this.readSkillResource(String(args.skillId ?? ""), String(args.resourceName ?? ""));
      case "search_experience":
        return this.searchExperience(String(args.query ?? ""), args.topK === undefined ? 3 : Math.min(Math.max(1, Number(args.topK)), 10));
      // 自成长发动机 A4：成长工单施工面（厂商中立，R2 租户隔离）。
      case "discover_growth_tickets":
        return this.discoverGrowthTickets(ctx.tenantId, args.status ? String(args.status) : undefined);
      case "claim_growth_ticket":
        return this.transitionGrowthTicket(ctx, String(args.ticketId ?? ""), "IN_PROGRESS", args.assignee ? String(args.assignee) : ctx.userId);
      case "submit_growth_ticket":
        return this.transitionGrowthTicket(ctx, String(args.ticketId ?? ""), "IN_REVIEW");
      default:
        throw new Error(`unknown tool: ${toolName}`);
    }
  }

  /** A4：列出成长工单（R2 租户隔离；按 status 过滤）。施工 agent 据此知道要建什么、骨架到哪。 */
  private async discoverGrowthTickets(tenantId: string, status?: string): Promise<unknown> {
    const all = await this.deps.repos.growthTickets.listByTenant(tenantId);
    const items = status ? all.filter((t) => t.status === status) : all;
    return {
      items: items.map((t) => ({
        id: t.id, fromQuestion: t.fromQuestion, gapCode: t.gapCode, status: t.status,
        ioContract: t.ioContract, ontologyRefs: t.ontologyRefs, acceptance: t.acceptance,
        scaffoldedDrafts: t.scaffoldedDrafts ?? [], assignee: t.assignee,
      })),
    };
  }

  /** A4：成长工单状态流转（claim→IN_PROGRESS / submit→IN_REVIEW）；不存在→错误，R2 隔离。 */
  private async transitionGrowthTicket(ctx: { tenantId: string }, ticketId: string, to: "IN_PROGRESS" | "IN_REVIEW", assignee?: string): Promise<unknown> {
    const tk = (await this.deps.repos.growthTickets.listByTenant(ctx.tenantId)).find((t) => t.id === ticketId);
    if (!tk) return { error: `TICKET_NOT_FOUND: ${ticketId}` };
    const updated = { ...tk, status: to, ...(assignee ? { assignee } : {}) };
    await this.deps.repos.growthTickets.upsert(updated);
    return { id: updated.id, status: updated.status, assignee: updated.assignee };
  }

  /**
   * 增量 §3：read_skill_resource —— 文本类（按 mime/扩展名判定）返回内容（≤64KB 截断+提示）；
   * 二进制类返回元信息并明示「无法直接读取」。渐进披露第三级：summary → body → resource。
   */
  private async readSkillResource(skillId: string, resourceName: string): Promise<unknown> {
    const skill = await this.deps.repos.skills.get(skillId);
    if (!skill || skill.tenantId !== this.opts.ctx.tenantId) {
      throw new Error(`skill not found: ${skillId}`);
    }
    const resource = skill.resources.find((r) => r.name === resourceName);
    if (!resource) throw new Error(`skill resource not found: ${resourceName}`);
    const mime = resource.mime ?? inferMime(resource.name);
    const meta = {
      skillId,
      name: resource.name,
      mime,
      description: resource.description ?? "",
    };
    if (!isTextMime(mime)) {
      const sizeBytes = await this.deps.skillResources?.size?.(skill as SkillDefinition, resource);
      return {
        ...meta,
        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
        readable: false,
        note: "二进制附件，无法直接读取；仅提供元信息（mime/大小/用途描述）。",
      };
    }
    const content = await this.deps.skillResources?.read(skill as SkillDefinition, resource);
    if (content === undefined) {
      return { ...meta, readable: false, note: "资源内容暂不可读（未配置资源存储）。" };
    }
    if (Buffer.byteLength(content, "utf8") > SKILL_RESOURCE_TEXT_LIMIT) {
      let sliced = content.slice(0, SKILL_RESOURCE_TEXT_LIMIT);
      while (Buffer.byteLength(sliced, "utf8") > SKILL_RESOURCE_TEXT_LIMIT) sliced = sliced.slice(0, -1024);
      return {
        ...meta,
        readable: true,
        truncated: true,
        content: sliced,
        note: `[内容超过 64KB，已截断；完整内容共 ${Buffer.byteLength(content, "utf8")} 字节]`,
      };
    }
    return { ...meta, readable: true, truncated: false, content };
  }

  /**
   * 运营态增量 §3：经验记忆库检索 —— 确定性伪向量（pseudoEmbed）余弦排序，
   * READ 级、经统一审计（tool_calls）。命中是「参考解法」而非事实源：数字红线
   * 仍由 provenance 机制约束（回答中的业务数字必须来自可溯源工具结果）。
   */
  private async searchExperience(query: string, topK: number): Promise<unknown> {
    if (!query.trim()) return { hits: [] };
    const cases = await this.deps.repos.experience.listByTenant(this.opts.ctx.tenantId);
    const qv = pseudoEmbed(query);
    const hits = cases
      .map((c) => ({
        question: c.question,
        approach: c.approach,
        outcome: c.outcome,
        scene: c.scene,
        date: c.date,
        score: Math.round(cosine(qv, c.embedding) * 1000) / 1000,
      }))
      .sort((a, b) => b.score - a.score || (a.question < b.question ? -1 : 1))
      .slice(0, topK);
    return { hits, total: cases.length };
  }

  /** Audit + metrics + result shaping (4) 写审计. */
  private async finish(
    toolName: string,
    input: unknown,
    payload: unknown,
    outcome: ToolRunResult["outcome"],
    started: number,
    ok: boolean,
  ): Promise<ToolRunResult> {
    const durationMs = Date.now() - started;
    const toolCallId = newId("tc");
    const redactedInput = redact(input);
    const redactedOutput = redact(payload);
    const row: ToolCallRow = {
      id: toolCallId,
      taskId: this.opts.taskId,
      toolName,
      input: redactedInput,
      outputDigest: digest(redactedOutput),
      output: byteLength(redactedOutput) > OUTPUT_LIMIT ? null : redactedOutput,
      outcome,
      durationMs,
      createdAt: new Date().toISOString(),
    };
    await this.deps.repos.toolCalls.insert(row);
    this.deps.metrics.toolCalls.inc({ tool: toolName, outcome });
    return { ok, payload, toolCallId, outcome, durationMs };
  }
}

/** #6 稳定参数键：键名排序后序列化，使 {a,b} 与 {b,a} 命中同一缓存。 */
function canonicalArgs(input: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  try {
    return JSON.stringify(norm(input));
  } catch {
    return String(input);
  }
}

function wrapError(err: unknown): { error: string; message?: string } {
  if (err instanceof DataCoreUnavailableError) return { error: ErrorCodes.DATACORE_UNAVAILABLE };
  const message = err instanceof Error ? err.message : String(err);
  return { error: "TOOL_ERROR", message };
}

const TEXT_MIMES = new Set(["text/markdown", "text/plain", "text/csv", "application/json"]);
const TEXT_EXT_MIME: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
};

function inferMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXT_MIME[ext] ?? "application/octet-stream";
}

function isTextMime(mime: string): boolean {
  return TEXT_MIMES.has(mime) || mime.startsWith("text/");
}
