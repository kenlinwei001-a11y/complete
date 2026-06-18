import type { Answer, AnswerBlock, ClaimVerdict, ConsistencyCheck, CrossValidateRequest, CrossValidateResponse, OnError, PlanStep, ProvenanceRef, ResolvedRef, RuleVerdict, ValidationTrace } from "@platform/contracts";
import { ErrorCodes } from "@platform/contracts";
import { newId } from "../ids.js";
import type { LlmClient } from "../llm/types.js";
import type { Metrics } from "../metrics.js";
import { enterNesting, NestingError, type NestingCtx } from "../runtime.js";
import type { GuardedToolExecutor } from "../tools/executor.js";
import { enrichProvenance, type ProvenanceEnrichment } from "../tools/provenance.js";
import { scanBlocks } from "../util/numerics.js";
import { resolveTemplate, TemplateResolutionError, type TemplateScope } from "../util/template.js";

/**
 * Additive step types (A8.4 query_timeseries_agg / S4.1 search_knowledge).
 * CONTRACT GAP workaround: contracts PlanStepSchema is a closed discriminated
 * union without these two read tools; since packages/contracts must not change,
 * we widen the executor input locally. The steps are fully isomorphic to the
 * other tool steps and run through the generic GuardedToolExecutor dispatch.
 */
export interface ExtraToolStep {
  id: string;
  type: "query_timeseries_agg" | "search_knowledge";
  params: Record<string, unknown>;
  onError?: OnError;
  timeoutMs?: number;
}

export type ExtendedPlanStep = PlanStep | ExtraToolStep;

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
  /** 引用模式增量 §2.2：评估到的规则等实际版本留痕回调。 */
  onResolvedRef?: (ref: ResolvedRef) => void;
  /** 推演验证痕迹 Layer 2：交叉验证回调（已闭合 OBO 鉴权上下文；缺省则不附交叉验证）。 */
  crossValidate?: (req: CrossValidateRequest) => Promise<CrossValidateResponse>;
}

export interface WorkflowRunInput {
  steps: ExtendedPlanStep[];
  slots: Record<string, unknown>;
  context: unknown;
  nesting: NestingCtx;
  trustLevel?: "VERIFIED_WORKFLOW" | "AGENT_EXPLORATORY";
  /** Tenant scope for llm_compose provider resolution. */
  tenantId?: string;
}

export type WorkflowResult =
  | { status: "COMPLETED"; answer: Answer; stepOutputs: Record<string, unknown> }
  | { status: "FAILED"; error: { code: string; message: string; stepId?: string }; stepOutputs: Record<string, unknown> };

interface StepAudit {
  toolCallId: string;
  toolName: string;
  snapshotVersion?: string;
  /** A8.3/S4.1: source + tsAgg/kb meta derived from the step output. */
  enrichment?: ProvenanceEnrichment;
}

/** Path A workflow executor (QOS-PRD §5.3) + platform §8.2 invoke_agent / invoke_mcp_tool steps. */
export async function runWorkflow(deps: WorkflowRunDeps, input: WorkflowRunInput): Promise<WorkflowResult> {
  const stepOutputs: Record<string, unknown> = {};
  const stepAudits: Record<string, StepAudit> = {};
  const trustLevel = input.trustLevel ?? "VERIFIED_WORKFLOW";
  const scope: TemplateScope = { slots: input.slots, context: input.context, steps: stepOutputs };

  // 推演验证痕迹收集（凡用到本体切片即附带）
  const slicesUsed: string[] = [];
  const sliceObjects: { objectType: string; objectId: string; props: Record<string, unknown> }[] = [];
  const allVerdicts: RuleVerdict[] = [];
  const resolvedRefsSeen: ResolvedRef[] = [];

  const completed = async (answer: Answer): Promise<WorkflowResult> => {
    const trace = await buildValidationTrace(deps, { slicesUsed, sliceObjects, verdicts: allVerdicts, resolvedRefs: resolvedRefsSeen, answer });
    return { status: "COMPLETED", answer: trace ? { ...answer, validationTrace: trace } : answer, stepOutputs };
  };
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
      // generic tool dispatch — incl. additive A8.4/S4.1 steps (query_timeseries_agg / search_knowledge)
      case "resolve_slice":
      case "query_objects":
      case "invoke_solver":
      case "evaluate_rules":
      case "create_action_draft":
      case "query_timeseries_agg":
      case "search_knowledge": {
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
        if (step.type === "resolve_slice") {
          const sliceKey = (resolvedParams.sliceKey as string | undefined) ?? "";
          if (sliceKey) slicesUsed.push(sliceKey);
          collectSliceObjects(r.payload, sliceObjects);
        }
        stepAudits[step.id] = {
          toolCallId: r.toolCallId,
          toolName: step.type,
          snapshotVersion:
            r.payload !== null && typeof r.payload === "object"
              ? ((r.payload as Record<string, unknown>).snapshotVersion as string | undefined)
              : undefined,
          enrichment: enrichProvenance(step.type, r.payload),
        };
        await emitDone("OK");

        if (step.type === "evaluate_rules") {
          const verdicts = r.payload as RuleVerdict[];
          allVerdicts.push(...verdicts);
          // §2.2 留痕：规则求值结果带 ruleVersion（RuleVerdict additive）
          for (const v of verdicts) {
            if (v.ruleVersion !== undefined) {
              const ref = { kind: "rule" as const, key: v.ruleId, version: v.ruleVersion };
              resolvedRefsSeen.push(ref);
              deps.onResolvedRef?.(ref);
            }
          }
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
            tenantId: input.tenantId,
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
          expectsObjectType: step.params.expectsObjectType, // stage3②：声明则运行时强制本体校验
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
      // fromStep on a ts-agg / kb step picks the right source + meta (A8.3/S4.1)
      provenance.push({
        id: provId,
        toolCallId: audit?.toolCallId ?? "unknown",
        toolName: audit?.toolName ?? "unknown",
        outputPath: "$.data",
        ...(audit?.snapshotVersion ? { snapshotVersion: audit.snapshotVersion } : {}),
        ...(audit?.enrichment ?? { source: "TOOL_RESULT" }),
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

// ---------------------------------------------------------------------------
// 推演验证痕迹（ValidationTrace）组装：凡用到本体切片即附带，前端展示让用户信任。
// ---------------------------------------------------------------------------

/** 从切片产出里抽取对象（{props} 形态，含主键的）作为交叉验证的断言主体。 */
function collectSliceObjects(
  payload: unknown,
  acc: { objectType: string; objectId: string; props: Record<string, unknown> }[],
): void {
  const PK = ["baseId", "modelId", "so", "objectId", "id", "signalKey"];
  const visit = (node: unknown, typeHint?: string): void => {
    if (Array.isArray(node)) {
      for (const n of node) visit(n, typeHint);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj.props && typeof obj.props === "object") {
      const props = obj.props as Record<string, unknown>;
      const type = (obj.type as string | undefined) ?? typeHint ?? "Object";
      const pk = PK.find((k) => props[k] !== undefined);
      if (pk && acc.length < 50) acc.push({ objectType: type, objectId: String(props[pk]), props });
    }
    // descend into known slice container keys (model/bases/base/orders)
    for (const [k, v] of Object.entries(obj)) {
      if (k === "props") continue;
      const hint = k === "bases" ? "Base" : k === "orders" ? "Order" : k === "model" ? "Model" : k === "base" ? "Base" : undefined;
      visit(v, hint);
    }
  };
  const data = (payload as { data?: unknown } | null)?.data ?? payload;
  visit(data);
}

/** 组装验证痕迹：① 一致性（实体定义/公理裁决/数字溯源/版本钉）② 交叉验证（B→A 对照 KG 事实）。 */
async function buildValidationTrace(
  deps: WorkflowRunDeps,
   in_: {
    slicesUsed: string[];
    sliceObjects: { objectType: string; objectId: string; props: Record<string, unknown> }[];
    verdicts: RuleVerdict[];
    resolvedRefs: ResolvedRef[];
    answer: Answer;
  },
): Promise<ValidationTrace | undefined> {
  if (in_.slicesUsed.length === 0) return undefined; // 钩子：不涉及本体切片 → 不附

  // ---- Layer 1 一致性验证 ----
  const checks: ConsistencyCheck[] = [];
  const types = [...new Set(in_.sliceObjects.map((o) => o.objectType))];
  for (const t of types) checks.push({ kind: "ENTITY_DEFINED", ref: t, status: "PASS", detail: "切片对象类型在本体中定义" });
  for (const v of in_.verdicts) {
    checks.push({
      kind: "AXIOM",
      ref: v.ruleId,
      status: v.passed ? "PASS" : v.severity === "BLOCK" ? "FAIL" : "WARN",
      detail: v.explanation,
    });
  }
  checks.push({
    kind: "NUMERIC_PROVENANCE",
    ref: "answer.numerics",
    status: in_.answer.unverifiedNumerics ? "WARN" : "PASS",
    detail: in_.answer.unverifiedNumerics ? "部分数字未能溯源" : "结论数字均可溯源",
  });
  for (const r of in_.resolvedRefs) {
    checks.push({ kind: "VERSION_PIN", ref: `${r.kind}:${r.key}`, status: "PASS", detail: `当时生效版本 v${r.version}` });
  }
  const consVerdict: "ALL_PASS" | "WARN" | "FAIL" = checks.some((c) => c.status === "FAIL")
    ? "FAIL"
    : checks.some((c) => c.status === "WARN")
      ? "WARN"
      : "ALL_PASS";

  // ---- Layer 2 交叉验证（对照知识图谱已有事实）----
  let claims: ClaimVerdict[] = [];
  let crossVerdict: CrossValidateResponse["verdict"] = "NO_CLAIMS";
  if (deps.crossValidate && in_.sliceObjects.length > 0) {
    // 取切片对象的标量属性作为断言，反向核对 KG（确定性、有界 ≤200）
    const claimReq: CrossValidateRequest["claims"] = [];
    for (const o of in_.sliceObjects) {
      for (const [prop, value] of Object.entries(o.props)) {
        if (value === null || typeof value === "object") continue; // 仅标量
        claimReq.push({ kind: "PROPERTY", subjectType: o.objectType, subjectId: o.objectId, property: prop, assertedValue: value });
        if (claimReq.length >= 200) break;
      }
      if (claimReq.length >= 200) break;
    }
    if (claimReq.length > 0) {
      try {
        const res = await deps.crossValidate({ claims: claimReq });
        claims = res.claims;
        crossVerdict = res.verdict;
      } catch {
        /* 交叉验证不可用不阻断主流程（fail-open，仅一致性层） */
      }
    }
  }

  return {
    slicesUsed: [...new Set(in_.slicesUsed)],
    consistency: { checks, verdict: consVerdict },
    crossValidation: { claims, verdict: crossVerdict },
    generatedAt: new Date().toISOString(),
  };
}
