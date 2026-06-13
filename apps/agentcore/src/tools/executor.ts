import { AggregateRequestSchema, ErrorCodes, parseMcpToolFullName, QueryTimeseriesAggInputSchema, type SkillDefinition } from "@platform/contracts";
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
  constructor(
    private readonly deps: ExecutorDeps,
    private readonly opts: ExecutorOptions,
  ) {}

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

    // 3) client call
    try {
      const payload = await withTimeout(this.dispatch(toolName, input, binding), options?.timeoutMs, toolName);
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
        );
      case "get_object":
        return this.deps.dataCore.ontology.getObject(ctx, String(args.objectType), String(args.objectId));
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
      default:
        throw new Error(`unknown tool: ${toolName}`);
    }
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
