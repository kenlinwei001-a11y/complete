import type { Answer, AnswerBlock, PlanStep, ProvenanceRef, RuleVerdict } from "@platform/contracts";
import { ErrorCodes } from "@platform/contracts";
import { newId } from "../ids.js";
import type { LlmClient } from "../llm/types.js";
import type { Metrics } from "../metrics.js";
import { enterNesting, NestingError, type NestingCtx } from "../runtime.js";
import type { GuardedToolExecutor } from "../tools/executor.js";
import { scanBlocks } from "../util/numerics.js";
import { resolveTemplate, TemplateResolutionError, type TemplateScope } from "../util/template.js";

const SOLVER_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface AgentStepInvoker {
  (params: {
    agentId: string;
    version: number | "latest";
    prompt: string;
    expectsSchema?: Record<string, unknown>;
    nesting: NestingCtx;
  }): Promise<{ structured?: unknown; answer: Answer }>;
}

export interface WorkflowRunDeps {
  executor: GuardedToolExecutor;
  llm: LlmClient;
  metrics: Metrics;
  composeModel: string;
  emit: (event: string, payload: unknown) => Promise<void>;
  runAgentStep?: AgentStepInvoker;
}

export interface WorkflowRunInput {
  steps: PlanStep[];
  slots: Record<string, unknown>;
  context: unknown;
  nesting: NestingCtx;
  trustLevel?: "VERIFIED_WORKFLOW" | "AGENT_EXPLORATORY";
}

export type WorkflowResult =
  | { status: "COMPLETED"; answer: Answer; stepOutputs: Record<string, unknown> }
  | { status: "FAILED"; error: { code: string; message: string; stepId?: string }; stepOutputs: Record<string, unknown> };

interface StepAudit {
  toolCallId: string;
  toolName: string;
  snapshotVersion?: string;
}

/** Path A workflow executor (QOS-PRD §5.3) + platform §8.2 invoke_agent / invoke_mcp_tool steps. */
export async function runWorkflow(deps: WorkflowRunDeps, input: WorkflowRunInput): Promise<WorkflowResult> {
  const stepOutputs: Record<string, unknown> = {};
  const stepAudits: Record<string, StepAudit> = {};
  const trustLevel = input.trustLevel ?? "VERIFIED_WORKFLOW";
  const scope: TemplateScope = { slots: input.slots, context: input.context, steps: stepOutputs };

  const completed = (answer: Answer): WorkflowResult => ({ status: "COMPLETED", answer, stepOutputs });
  const failed = (code: string, message: string, stepId?: string): WorkflowResult => ({
    status: "FAILED",
    error: { code, message, stepId },
    stepOutputs,
  });

  for (const step of input.steps) {
    const started = Date.now();
    await deps.emit("step.started", { stepId: step.id, type: step.type });

    let resolvedParams: Record<string, unknown>;
    try {
      resolvedParams = resolveTemplate(step.params, scope) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof TemplateResolutionError) {
        await deps.emit("step.completed", { stepId: step.id, type: step.type, outcome: "FAILED", durationMs: 0 });
        return failed(ErrorCodes.TEMPLATE_RESOLUTION_ERROR, err.message, step.id);
      }
      throw err;
    }

    const onError = "onError" in step && step.onError ? step.onError : "FAIL";
    const emitDone = (outcome: string) =>
      deps.emit("step.completed", { stepId: step.id, type: step.type, outcome, durationMs: Date.now() - started });

    switch (step.type) {
      case "resolve_slice":
      case "query_objects":
      case "invoke_solver":
      case "evaluate_rules":
      case "create_action_draft": {
        const timeoutMs =
          step.type === "invoke_solver" ? ((step as { timeoutMs?: number }).timeoutMs ?? SOLVER_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
        const r = await deps.executor.run(step.type, resolvedParams, { timeoutMs });

        if (r.outcome === "DENIED") {
          // Permission denial → COMPLETED with 权限不足 text (NOT FAILED), no data-existence leak.
          await emitDone("DENIED");
          const target =
            (resolvedParams.objectType as string | undefined) ??
            (resolvedParams.sliceKey as string | undefined) ??
            (resolvedParams.solverKey as string | undefined) ??
            step.type;
          const answer: Answer = {
            trustLevel,
            blocks: [{ type: "text", markdown: `你没有访问 ${target} 的权限` }],
            provenance: [],
            unverifiedNumerics: false,
          };
          return completed(answer);
        }
        if (!r.ok) {
          if (onError === "SKIP") {
            stepOutputs[step.id] = null;
            await emitDone("SKIPPED");
            continue;
          }
          await emitDone("FAILED");
          const code = (r.payload as { error?: string } | undefined)?.error ?? "TOOL_ERROR";
          const message = (r.payload as { message?: string } | undefined)?.message ?? `步骤 ${step.id} 执行失败`;
          return failed(code, message, step.id);
        }

        stepOutputs[step.id] = r.payload;
        stepAudits[step.id] = {
          toolCallId: r.toolCallId,
          toolName: step.type,
          snapshotVersion:
            r.payload !== null && typeof r.payload === "object"
              ? ((r.payload as Record<string, unknown>).snapshotVersion as string | undefined)
              : undefined,
        };
        await emitDone("OK");

        if (step.type === "evaluate_rules") {
          const verdicts = r.payload as RuleVerdict[];
          const blocking = verdicts.filter((v) => !v.passed && v.severity === "BLOCK");
          if (blocking.length > 0) {
            // BLOCK violation → terminate; task COMPLETED with rule_violation 模板 answer (不算失败).
            const provenance: ProvenanceRef[] = [];
            const blocks: AnswerBlock[] = blocking.map((v) => {
              const provId = newId("prov");
              provenance.push({
                id: provId,
                source: "TOOL_RESULT",
                toolCallId: r.toolCallId,
                toolName: "evaluate_rules",
                outputPath: "$",
              });
              return {
                type: "rule_violation",
                ruleId: v.ruleId,
                severity: v.severity,
                explanation: v.explanation,
                provId,
              };
            });
            blocks.push({
              type: "text",
              markdown: `本次请求被业务规则拦截（${blocking.map((v) => v.ruleId).join("、")}），详见上方违规说明 ⟦ref:0⟧。`,
            });
            return completed({ trustLevel, blocks, provenance, unverifiedNumerics: false });
          }
        }

        if (step.type === "create_action_draft") {
          const draft = r.payload as { draftId: string };
          await deps.emit("action_draft.created", {
            draftId: draft.draftId,
            actionType: resolvedParams.actionType,
          });
        }
        continue;
      }

      case "llm_compose": {
        try {
          const text = await deps.llm.compose({
            model: deps.composeModel,
            instruction: String(resolvedParams.instruction),
            inputs: (resolvedParams.inputs as unknown[]) ?? [],
          });
          stepOutputs[step.id] = { text };
          await emitDone("OK");
        } catch (err) {
          await emitDone("FAILED");
          return failed("LLM_COMPOSE_ERROR", err instanceof Error ? err.message : String(err), step.id);
        }
        continue;
      }

      case "invoke_agent": {
        if (!deps.runAgentStep) {
          await emitDone("FAILED");
          return failed("UNSUPPORTED_STEP", "invoke_agent not supported in this context", step.id);
        }
        deps.metrics.nestedInvocations.inc({ kind: "agent" });
        try {
          const child = enterNesting(input.nesting, "agent", step.params.agentId);
          const result = await deps.runAgentStep({
            agentId: step.params.agentId,
            version: step.params.version,
            prompt: typeof resolvedParams.prompt === "string" ? resolvedParams.prompt : JSON.stringify(resolvedParams.prompt),
            expectsSchema: step.params.expectsSchema,
            nesting: child,
          });
          stepOutputs[step.id] =
            step.params.expectsSchema !== undefined
              ? { data: result.structured }
              : { data: { answer: result.answer } };
          await emitDone("OK");
        } catch (err) {
          await emitDone("FAILED");
          if (err instanceof NestingError) return failed(err.code, err.message, step.id);
          return failed("AGENT_STEP_ERROR", err instanceof Error ? err.message : String(err), step.id);
        }
        continue;
      }

      case "invoke_mcp_tool": {
        const r = await deps.executor.run(String(resolvedParams.toolName ?? step.params.toolName), resolvedParams.args ?? {}, {
          binding: { kind: "MCP", mcpConfigId: step.params.mcpConfigId },
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });
        if (!r.ok) {
          await emitDone("FAILED");
          const code = (r.payload as { error?: string } | undefined)?.error ?? "TOOL_ERROR";
          return failed(code, `MCP 工具调用失败: ${step.params.toolName}`, step.id);
        }
        stepOutputs[step.id] = { data: r.payload };
        stepAudits[step.id] = { toolCallId: r.toolCallId, toolName: step.params.toolName };
        await emitDone("OK");
        continue;
      }

      case "render_answer": {
        const answer = renderAnswer(
          resolvedParams.blocks as Record<string, unknown>[],
          stepAudits,
          trustLevel,
          deps.metrics,
        );
        await emitDone("OK");
        return completed(answer);
      }
    }
  }

  // No render_answer step (standalone workflows): synthesize a summary answer from outputs.
  return completed({
    trustLevel,
    blocks: [{ type: "text", markdown: "工作流执行完成。" }],
    provenance: [],
    unverifiedNumerics: false,
  });
}

/** render_answer: AnswerBlockTemplate → AnswerBlock[], each fromStep → generated ProvenanceRef. */
function renderAnswer(
  blockTemplates: Record<string, unknown>[],
  stepAudits: Record<string, StepAudit>,
  trustLevel: "VERIFIED_WORKFLOW" | "AGENT_EXPLORATORY",
  metrics: Metrics,
): Answer {
  const provenance: ProvenanceRef[] = [];
  const blocks: AnswerBlock[] = [];

  for (const tpl of blockTemplates) {
    const { fromStep, ...rest } = tpl as { fromStep?: string } & Record<string, unknown>;
    let provId: string | undefined;
    if (fromStep) {
      const audit = stepAudits[fromStep];
      provId = newId("prov");
      provenance.push({
        id: provId,
        source: "TOOL_RESULT",
        toolCallId: audit?.toolCallId ?? "unknown",
        toolName: audit?.toolName ?? "unknown",
        outputPath: "$.data",
        ...(audit?.snapshotVersion ? { snapshotVersion: audit.snapshotVersion } : {}),
      });
    }
    const type = rest.type as string;
    if (type === "text") {
      blocks.push({ type: "text", markdown: String(rest.markdown ?? "") });
    } else if (type === "table") {
      blocks.push({
        type: "table",
        columns: (rest.columns as string[]) ?? [],
        rows: ((rest.rows as (string | number | null)[][]) ?? []).map((row) =>
          row.map((c) => (c === null || typeof c === "number" ? c : String(c))),
        ),
        provId: provId ?? newId("prov"),
      });
    } else if (type === "kpi") {
      blocks.push({
        type: "kpi",
        label: String(rest.label ?? ""),
        value: String(rest.value ?? ""),
        ...(rest.unit !== undefined ? { unit: String(rest.unit) } : {}),
        provId: provId ?? newId("prov"),
      });
    } else if (type === "rule_violation") {
      blocks.push({
        type: "rule_violation",
        ruleId: String(rest.ruleId ?? ""),
        severity: String(rest.severity ?? ""),
        explanation: String(rest.explanation ?? ""),
        provId: provId ?? newId("prov"),
      });
    } else if (type === "action_draft") {
      blocks.push({
        type: "action_draft",
        draftId: String(rest.draftId ?? ""),
        actionType: String(rest.actionType ?? ""),
        summary: String(rest.summary ?? ""),
      });
    }
  }

  const unverified = scanBlocks(blocks);
  if (unverified) {
    // Path A出现该情况属实现 bug —— 仍只打标，不阻断（§5.5）
    metrics.unverifiedNumerics.inc({ path: trustLevel === "VERIFIED_WORKFLOW" ? "WORKFLOW" : "AGENT" });
  }
  return { trustLevel, blocks, provenance, unverifiedNumerics: unverified };
}
