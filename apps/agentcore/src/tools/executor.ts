import { ErrorCodes, QueryTimeseriesAggInputSchema } from "@platform/contracts";
import { newId } from "../ids.js";
import type { Metrics } from "../metrics.js";
import type { Repos, ToolCallRow } from "../persistence/repos.js";
import { byteLength, digest, redact } from "../util/redact.js";
import { BudgetTracker } from "./budget.js";
import { builtinTool } from "./registry.js";
import { DataCoreUnavailableError, type DataCoreClient, type ToolAuthCtx } from "./clients.js";
import type { McpClientPort } from "../mcp/types.js";

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
    options?: { binding?: ToolBinding; timeoutMs?: number },
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

    // 2) budget (path B only)
    if (this.opts.budget) {
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
      return this.deps.mcp.callTool(binding.mcpConfigId, toolName, input as Record<string, unknown>);
    }
    const args = (input ?? {}) as Record<string, unknown>;
    switch (toolName) {
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
      default:
        throw new Error(`unknown tool: ${toolName}`);
    }
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
