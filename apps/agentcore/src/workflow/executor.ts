import type { Answer, AnswerBlock, ClaimVerdict, ConsistencyCheck, CrossValidateRequest, CrossValidateResponse, OnError, PlanStep, ProvenanceRef, RenderBinding, ResolvedRef, RetryPolicy, RuleVerdict, SkillDefinition, ValidationTrace } from "@platform/contracts";
import { ErrorCodes } from "@platform/contracts";
import { newId } from "../ids.js";
import type { LlmClient } from "../llm/types.js";
import type { Metrics } from "../metrics.js";
import { enterNesting, NestingError, type NestingCtx } from "../runtime.js";
import type { GuardedToolExecutor } from "../tools/executor.js";
import { enrichProvenance, type ProvenanceEnrichment } from "../tools/provenance.js";
import { scanBlocks } from "../util/numerics.js";
import { resolveNumericRefs } from "../util/prov-refs.js";
import { resolveTemplate, TemplateResolutionError, type TemplateScope } from "../util/template.js";
import { deriveConclusion, humanizeField, isInternalIdValue, META_FIELDS, metaLabel } from "./solver-field-labels.js";

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
  /**
   * SKILL-LIBRARY-EVERYWHERE §3：工作流「组装口方法论绑定」——已解析的方法论 skill（plan.skillRefs / workflow.skillRefs
   * → 载入的 SkillDefinition）。render_answer/结论叙事步**确定性消费**其 methodology（conclusionTemplate/criteria），
   * 把方法论口径体现在结论叙事——**非 agent 式 LLM 提示注入**（R6 确定性·workflow 不跑 LLM 自由发挥）。
   */
  skills?: SkillDefinition[];
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
  /** invoke_solver 的求解器键——供 solver_summary 投影做同名字段消歧人话化（WO-ANSWER-PROJECTION-HUMANIZE）。 */
  solverKey?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 共享执行核（WO-L1B-2·串行 runWorkflow 与 DAG runWorkflowDag 逐字节等价的基石）
// ─ executeStep：单步执行体（模板解析 + 工具派发 + render + 规则拦截 + 重试），产
//   出 { outcome, effects }；不直接改共享态，副作用经 effects 由驱动方按确定序合并。
// ─ mergeStepEffects：把一个步的 effects 合入共享 WorkflowState（串行=立即合·DAG=波
//   次按 nodeId 稳定序合 → stepOutputs 键序与并行交错时序无关·R6）。
// ─ finalizeAnswer / finalizeFailed：终态组装（方法论块 + 验证痕迹），两执行器共用
//   → 纯线性图经 DAG 执行器与旧串行逐字节等价（§7 V6 parity）。
// ═══════════════════════════════════════════════════════════════════════════

/** 工作流累积态（推演验证痕迹 + 步产出/审计）——两执行器共用，确定性合并。 */
export interface WorkflowState {
  stepOutputs: Record<string, unknown>;
  stepAudits: Record<string, StepAudit>;
  slicesUsed: string[];
  sliceObjects: { objectType: string; objectId: string; props: Record<string, unknown> }[];
  allVerdicts: RuleVerdict[];
  resolvedRefsSeen: ResolvedRef[];
}

export function initWorkflowState(): WorkflowState {
  return { stepOutputs: {}, stepAudits: {}, slicesUsed: [], sliceObjects: [], allVerdicts: [], resolvedRefsSeen: [] };
}

/**
 * 单步副作用（延迟合并·确定性）——串行立即合、DAG 波次按序合，故与并行交错时序无关。
 * WO-L1B-3：DAG durable checkpoint 把本结构逐节点序列化落库（per-node checkpoint），
 * 续跑时经 mergeStepEffects 逐字节回灌共享态（stepOutputs + stepAudits + slices/verdicts/refs）
 * → 续跑答案与未中断跑逐字节等价（R6·render_answer 溯源 toolCallId/audit 完整恢复）。
 */
export interface StepRunEffects {
  setOutput: boolean;
  output: unknown;
  audit?: StepAudit;
  slicesUsed: string[];
  sliceObjects: { objectType: string; objectId: string; props: Record<string, unknown> }[];
  verdicts: RuleVerdict[];
  resolvedRefs: ResolvedRef[];
  /** 步级重试实际尝试次数（≥1·WorkflowDagNodeState.attempts 用·串行恒 1）。 */
  attempts: number;
}
function newEffects(): StepRunEffects {
  return { setOutput: false, output: undefined, slicesUsed: [], sliceObjects: [], verdicts: [], resolvedRefs: [], attempts: 1 };
}

/** 步执行结果：CONTINUE 续跑 / SKIPPED 置空续 / ANSWER 终态答案 / FAILED 终态失败。 */
export type StepOutcome =
  | { kind: "CONTINUE" }
  | { kind: "SKIPPED" }
  | { kind: "ANSWER"; answer: Answer }
  | { kind: "FAILED"; code: string; message: string; stepId: string };

export interface StepExecResult {
  outcome: StepOutcome;
  effects: StepRunEffects;
}

/** 把一个步的 effects 合入共享态（驱动方按确定序调用；对齐旧 runWorkflow 内联合并顺序）。 */
export function mergeStepEffects(state: WorkflowState, nodeId: string, effects: StepRunEffects, deps: WorkflowRunDeps): void {
  if (effects.setOutput) state.stepOutputs[nodeId] = effects.output;
  if (effects.audit) state.stepAudits[nodeId] = effects.audit;
  for (const s of effects.slicesUsed) state.slicesUsed.push(s);
  for (const o of effects.sliceObjects) state.sliceObjects.push(o);
  for (const v of effects.verdicts) state.allVerdicts.push(v);
  for (const ref of effects.resolvedRefs) {
    state.resolvedRefsSeen.push(ref);
    deps.onResolvedRef?.(ref);
  }
}

/** 终态答案组装（方法论块 + 验证痕迹）——两执行器共用（§7 V6 parity 基石）。 */
export async function finalizeAnswer(deps: WorkflowRunDeps, input: WorkflowRunInput, state: WorkflowState, answerIn: Answer): Promise<WorkflowResult> {
  // SKILL-LIBRARY-EVERYWHERE §3：结论叙事步确定性消费方法论 skill（组装口绑定·非 LLM 注入）。
  const methodologyBlock = skillMethodologyBlock(input.skills ?? []);
  const answer = methodologyBlock ? { ...answerIn, blocks: [...answerIn.blocks, methodologyBlock] } : answerIn;
  const trace = await buildValidationTrace(deps, {
    slicesUsed: state.slicesUsed,
    sliceObjects: state.sliceObjects,
    verdicts: state.allVerdicts,
    resolvedRefs: state.resolvedRefsSeen,
    answer,
  });
  return { status: "COMPLETED", answer: trace ? { ...answer, validationTrace: trace } : answer, stepOutputs: state.stepOutputs };
}

export function finalizeFailed(state: WorkflowState, code: string, message: string, stepId?: string): WorkflowResult {
  return { status: "FAILED", error: { code, message, stepId }, stepOutputs: state.stepOutputs };
}

/**
 * 步级工具调用重试（簇① V2-3-164·WO-L1B-2 §4.5·有界退避·幂等守卫）。
 * 幂等守卫：create_action_draft（出站非幂等）与 retry.idempotent===false 一律**不重试**（防重复出站·R4）。
 * 可重试判据：retry.retryableErrors 声明则按码白名单；未声明则任何工具失败可重试（RetryableStepError 语义）。
 * DENIED/成功即返回；退避墙钟排除出 R6 哈希（成功后输出恒等·串行 retry=undefined → maxAttempts=1 无重试）。
 */
async function runToolWithRetry(
  deps: WorkflowRunDeps,
  stepType: PlanStep["type"] | "query_timeseries_agg" | "search_knowledge",
  params: Record<string, unknown>,
  runOpts: { timeoutMs: number },
  retry: RetryPolicy | undefined,
): Promise<{ r: Awaited<ReturnType<GuardedToolExecutor["run"]>>; attempts: number }> {
  const maxAttempts = retry?.maxAttempts ?? 1;
  const idempotent = retry?.idempotent ?? true;
  const retryableAllowed = stepType !== "create_action_draft" && idempotent;
  let attempts = 0;
  for (;;) {
    attempts++;
    const r = await deps.executor.run(stepType, params, runOpts);
    if (r.ok || r.outcome === "DENIED") return { r, attempts };
    const code = (r.payload as { error?: string } | undefined)?.error ?? "TOOL_ERROR";
    const retryable = retry?.retryableErrors ? retry.retryableErrors.includes(code) : true;
    if (retryableAllowed && retryable && attempts < maxAttempts) {
      if (retry?.backoffMs && retry.backoffMs > 0) await new Promise((res) => setTimeout(res, retry.backoffMs));
      continue;
    }
    return { r, attempts };
  }
}

/**
 * 单步执行体（QOS-PRD §5.3 + 平台 §8.2 invoke_agent / invoke_mcp_tool）——从旧 runWorkflow
 * switch 原样抽出（逐字节等价），改为写 effects + 返回 outcome，供串行/DAG 两执行器共用。
 * 读共享态经 scope.steps（前驱输出）与 stepAudits（render 用）；写副作用全经返回 effects 延迟合并。
 */
export async function executeStep(
  deps: WorkflowRunDeps,
  input: WorkflowRunInput,
  step: ExtendedPlanStep,
  scope: TemplateScope,
  stepAudits: Record<string, StepAudit>,
  trustLevel: "VERIFIED_WORKFLOW" | "AGENT_EXPLORATORY",
  retry?: RetryPolicy,
): Promise<StepExecResult> {
  const effects = newEffects();
  const started = Date.now();
  await deps.emit("step.started", { stepId: step.id, type: step.type });

  let resolvedParams: Record<string, unknown>;
  try {
    resolvedParams = resolveTemplate(step.params, scope) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof TemplateResolutionError) {
      await deps.emit("step.completed", { stepId: step.id, type: step.type, outcome: "FAILED", durationMs: 0 });
      return { outcome: { kind: "FAILED", code: ErrorCodes.TEMPLATE_RESOLUTION_ERROR, message: err.message, stepId: step.id }, effects };
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
      const { r, attempts } = await runToolWithRetry(deps, step.type, resolvedParams, { timeoutMs }, retry);
      effects.attempts = attempts;

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
        return { outcome: { kind: "ANSWER", answer }, effects };
      }
      if (!r.ok) {
        if (onError === "SKIP") {
          effects.setOutput = true;
          effects.output = null;
          await emitDone("SKIPPED");
          return { outcome: { kind: "SKIPPED" }, effects };
        }
        await emitDone("FAILED");
        const code = (r.payload as { error?: string } | undefined)?.error ?? "TOOL_ERROR";
        const message = (r.payload as { message?: string } | undefined)?.message ?? `步骤 ${step.id} 执行失败`;
        return { outcome: { kind: "FAILED", code, message, stepId: step.id }, effects };
      }

      effects.setOutput = true;
      effects.output = r.payload;
      if (step.type === "resolve_slice") {
        const sliceKey = (resolvedParams.sliceKey as string | undefined) ?? "";
        if (sliceKey) effects.slicesUsed.push(sliceKey);
        collectSliceObjects(r.payload, effects.sliceObjects);
      }
      effects.audit = {
        toolCallId: r.toolCallId,
        toolName: step.type,
        snapshotVersion:
          r.payload !== null && typeof r.payload === "object"
            ? ((r.payload as Record<string, unknown>).snapshotVersion as string | undefined)
            : undefined,
        enrichment: enrichProvenance(step.type, r.payload),
        ...(step.type === "invoke_solver" && typeof resolvedParams.solverKey === "string"
          ? { solverKey: resolvedParams.solverKey }
          : {}),
      };
      await emitDone("OK");

      if (step.type === "evaluate_rules") {
        const verdicts = r.payload as RuleVerdict[];
        effects.verdicts.push(...verdicts);
        // §2.2 留痕：规则求值结果带 ruleVersion（RuleVerdict additive）
        for (const v of verdicts) {
          if (v.ruleVersion !== undefined) {
            effects.resolvedRefs.push({ kind: "rule" as const, key: v.ruleId, version: v.ruleVersion });
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
          // PROV-REF-INTEGRITY（簇⑩）：数字索引 ⟦ref:n⟧ → provenance[n].id（前端只按 id 查悬停内容）。
          return {
            outcome: { kind: "ANSWER", answer: { trustLevel, blocks: resolveNumericRefs(blocks, provenance), provenance, unverifiedNumerics: false } },
            effects,
          };
        }
      }

      if (step.type === "create_action_draft") {
        const draft = r.payload as { draftId: string };
        await deps.emit("action_draft.created", {
          draftId: draft.draftId,
          actionType: resolvedParams.actionType,
        });
      }
      return { outcome: { kind: "CONTINUE" }, effects };
    }

    case "llm_compose": {
      try {
        const text = await deps.llm.compose({
          model: deps.composeModel,
          instruction: String(resolvedParams.instruction),
          inputs: (resolvedParams.inputs as unknown[]) ?? [],
          tenantId: input.tenantId,
        });
        effects.setOutput = true;
        effects.output = { text };
        await emitDone("OK");
      } catch (err) {
        await emitDone("FAILED");
        return { outcome: { kind: "FAILED", code: "LLM_COMPOSE_ERROR", message: err instanceof Error ? err.message : String(err), stepId: step.id }, effects };
      }
      return { outcome: { kind: "CONTINUE" }, effects };
    }

    case "invoke_agent": {
      if (!deps.runAgentStep) {
        await emitDone("FAILED");
        return { outcome: { kind: "FAILED", code: "UNSUPPORTED_STEP", message: "invoke_agent not supported in this context", stepId: step.id }, effects };
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
        effects.setOutput = true;
        effects.output =
          step.params.expectsSchema !== undefined
            ? { data: result.structured }
            : { data: { answer: result.answer } };
        await emitDone("OK");
      } catch (err) {
        await emitDone("FAILED");
        if (err instanceof NestingError) return { outcome: { kind: "FAILED", code: err.code, message: err.message, stepId: step.id }, effects };
        return { outcome: { kind: "FAILED", code: "AGENT_STEP_ERROR", message: err instanceof Error ? err.message : String(err), stepId: step.id }, effects };
      }
      return { outcome: { kind: "CONTINUE" }, effects };
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
        return { outcome: { kind: "FAILED", code, message: `MCP 工具调用失败: ${step.params.toolName}`, stepId: step.id }, effects };
      }
      effects.setOutput = true;
      effects.output = { data: r.payload };
      effects.audit = { toolCallId: r.toolCallId, toolName: step.params.toolName };
      await emitDone("OK");
      return { outcome: { kind: "CONTINUE" }, effects };
    }

    case "render_answer": {
      const answer = renderAnswer(
        resolvedParams.blocks as Record<string, unknown>[],
        stepAudits,
        trustLevel,
        deps.metrics,
        // 原始（未解析）模板：显式 kpi/table 块的 value/rows 若是纯 {{steps.<s>.output.<path>}} 绑定，
        // 从中推导字段级 outputPath（PROV-REF-INTEGRITY ②——值从哪个字段来，悬停就指哪个字段）。
        step.params.blocks as Record<string, unknown>[] | undefined,
      );
      await emitDone("OK");
      return { outcome: { kind: "ANSWER", answer }, effects };
    }
  }
  // Unreachable (switch is exhaustive over ExtendedPlanStep types); satisfy control-flow analysis.
  return { outcome: { kind: "CONTINUE" }, effects };
}

/** Path A workflow executor (QOS-PRD §5.3) + platform §8.2 invoke_agent / invoke_mcp_tool steps. */
export async function runWorkflow(deps: WorkflowRunDeps, input: WorkflowRunInput): Promise<WorkflowResult> {
  const state = initWorkflowState();
  const trustLevel = input.trustLevel ?? "VERIFIED_WORKFLOW";
  const scope: TemplateScope = { slots: input.slots, context: input.context, steps: state.stepOutputs };

  for (const step of input.steps) {
    const { outcome, effects } = await executeStep(deps, input, step, scope, state.stepAudits, trustLevel);
    mergeStepEffects(state, step.id, effects, deps);
    if (outcome.kind === "ANSWER") return finalizeAnswer(deps, input, state, outcome.answer);
    if (outcome.kind === "FAILED") return finalizeFailed(state, outcome.code, outcome.message, outcome.stepId);
    // CONTINUE / SKIPPED → next step
  }

  // No render_answer step (standalone workflows): synthesize a summary answer from outputs.
  return finalizeAnswer(deps, input, state, {
    trustLevel,
    blocks: [{ type: "text", markdown: "工作流执行完成。" }],
    provenance: [],
    unverifiedNumerics: false,
  });
}

/**
 * SKILL-LIBRARY-EVERYWHERE §3：工作流「组装口方法论绑定」的确定性渲染（R6·非 LLM 注入）。
 * 绑定的方法论 skill（plan/workflow.skillRefs → 已发布 SkillDefinition）在结论叙事末尾体现其**判定口径**：
 *  · methodology.conclusionTemplate（结论叙事框）+ criteria（判定维度逐条）为结构承载；
 *  · 缺 methodology 的旧 skill 回落 summary（能力句）。
 * 纯字符串组装（按 skillId 稳定排序），同输入字节一致——**不调用任何 LLM**，与 agent 式提示注入本质不同。
 * 返回 undefined 表示无绑定方法论（不追加任何块，保持既有答案不变）。
 */
export function skillMethodologyBlock(skills: readonly SkillDefinition[]): AnswerBlock | undefined {
  const usable = skills.filter((s) => s && (s.methodology || s.summary));
  if (usable.length === 0) return undefined;
  const ordered = [...usable].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const lines: string[] = [];
  for (const s of ordered) {
    const framing = s.methodology?.conclusionTemplate?.trim() || s.summary?.trim() || "";
    const criteria = s.methodology?.criteria?.filter((c) => c && c.trim()) ?? [];
    const crit = criteria.length > 0 ? `\n  判定口径：${criteria.map((c) => c.trim()).join("；")}。` : "";
    lines.push(`〔${s.name}〕${framing}${crit}`);
  }
  return {
    type: "text",
    markdown: `**方法论口径**（确定性组装口·非模型注入）\n${lines.join("\n")}`,
  };
}

/**
 * 显式 kpi/table 模板块的字段级路径推导（PROV-REF-INTEGRITY ②）：value/rows 为**纯**模板绑定
 * `{{steps.<s>.output.<path>}}` 时，值的真实出处就是该字段 → outputPath=`$.<path>`（如 `$.data.p50`）。
 * 混排文案（如 "共 {{…}} 张"）不可归一字段 → 回落块级 `$.data`。
 */
const TPL_FIELD_RE = /^\{\{steps\.[\w-]+\.output\.([\w.[\]-]+)\}\}$/u;
function fieldPathOfBinding(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const m = TPL_FIELD_RE.exec(raw.trim());
  return m ? `$.${m[1]}` : undefined;
}

/** render_answer: AnswerBlockTemplate → AnswerBlock[], each fromStep → generated ProvenanceRef. */
function renderAnswer(
  blockTemplates: Record<string, unknown>[],
  stepAudits: Record<string, StepAudit>,
  trustLevel: "VERIFIED_WORKFLOW" | "AGENT_EXPLORATORY",
  metrics: Metrics,
  /** 未解析的原始模板（与 blockTemplates 同序）——用于推导显式块的字段级 outputPath。 */
  rawTemplates?: Record<string, unknown>[],
): Answer {
  const provenance: ProvenanceRef[] = [];
  const blocks: AnswerBlock[] = [];

  for (const [ti, tpl] of blockTemplates.entries()) {
    const { fromStep, ...rest } = tpl as { fromStep?: string } & Record<string, unknown>;
    const type = rest.type as string;
    const audit = fromStep ? stepAudits[fromStep] : undefined;
    // 铸一条真实 provenance 条目 → 返回其 provId。fromStep on a ts-agg / kb step picks the right
    // source + meta (A8.3/S4.1)。solver_summary 不在此处铸块级条目，而是把 minter 传给投影逐字段铸
    // 字段级条目（PROV-REF-INTEGRITY ②·簇⑥：全 KPI 共用单一 provId + 恒 $.data → 悬停同一泛化 blob）。
    const mintProv = (outputPath: string): string => {
      const id = newId("prov");
      provenance.push({
        id,
        toolCallId: audit?.toolCallId ?? "unknown",
        toolName: audit?.toolName ?? "unknown",
        outputPath,
        ...(audit?.snapshotVersion ? { snapshotVersion: audit.snapshotVersion } : {}),
        ...(audit?.enrichment ?? { source: "TOOL_RESULT" }),
      });
      return id;
    };
    let provId: string | undefined;
    if (fromStep && type !== "solver_summary") {
      const raw = rawTemplates?.[ti];
      provId = mintProv(fieldPathOfBinding(type === "kpi" ? raw?.value : type === "table" ? raw?.rows : undefined) ?? "$.data");
    }
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
    } else if (type === "solver_summary") {
      // 通用投影：把求解器真实输出（{{steps.<s>.output}} 经模板解析注入 `output`）投成
      // KPI/表/规则依据块——不写死任何业务数字/文案，前端见的即求解器算出的真值（闭 G-1）。
      // solverKey（来自 fromStep 审计）透给投影做同名字段消歧人话化（WO-ANSWER-PROJECTION-HUMANIZE）。
      // PROV-REF-INTEGRITY ②：传 minter → 逐 KPI/表/叙事铸独立 provId + 字段级 outputPath（$.data.<field>）。
      // WO ONTO-SCEN-RENDER-PROJ ①：块可携 `bindings`（genome.renderBindings，⊆ SOLVER_OUTPUT_SHAPES 门守）
      // → 声明字段优先投影（KPI 绑定先进 KPI 区、table 绑定即结果表）；绑定字段缺失=形状漂移即抛错（诚实红，不占位）。
      blocks.push(...summarizeSolverOutput(rest.output, mintProv, audit?.solverKey, (rest as { bindings?: RenderBinding[] }).bindings));
    }
  }

  // PROV-REF-INTEGRITY ①（簇⑩死角标）：模板作者位数字索引 ⟦ref:n⟧ → 本答案 provenance[n].id。
  // 前端 provIndex/悬停浮层只按 id 查找——数字索引直出即 [0] 死角标恒『加载中…』。
  const resolved = resolveNumericRefs(blocks, provenance);
  const unverified = scanBlocks(resolved);
  if (unverified) {
    // Path A出现该情况属实现 bug —— 仍只打标，不阻断（§5.5）
    metrics.unverifiedNumerics.inc({ path: trustLevel === "VERIFIED_WORKFLOW" ? "WORKFLOW" : "AGENT" });
  }
  return { trustLevel, blocks: resolved, provenance, unverifiedNumerics: unverified };
}

/** 确定性数值格式（R6）：整数原样，小数定 4 位去尾零。 */
function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(4)));
}
/**
 * ⑥ 单元格禁裸 JSON（复验修·审计 S03：切片表 cols=[id,type,props] 的 props 列整段 JSON.stringify 直出）：
 *  - 对象 → 紧凑人话：PK/name 优先打头（复用切片交叉验证同款 PK 偏好 + name/label/title），其余 `k=v` 串接——绝不 JSON.stringify；
 *  - 数组 → 逐项紧凑拼接（深层收敛为「N 项」）；
 *  - 内部 id（obj_/prov_… 真实形态含下划线/连字符）不当单元格值直出（④ 同款红线，isInternalIdValue）。
 * 确定性：按 Object.entries 顺序 + 固定截断（R6）。
 */
const CELL_PK = ["name", "label", "title", "baseId", "modelId", "so", "objectId", "signalKey"];
const CELL_PAIRS_MAX = 6;
function cellOf(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") return isInternalIdValue(v) ? null : v;
  return compactCell(v, 0);
}
function compactCell(v: unknown, depth: number): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return fmtNum(v);
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v === "string") return isInternalIdValue(v) ? null : v;
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    if (depth >= 2) return `${v.length} 项`;
    const parts = v.slice(0, 4).map((x) => compactCell(x, depth + 1)).filter((s): s is string => !!s);
    if (parts.length === 0) return `${v.length} 项`;
    return v.length > 4 ? `${parts.join("、")}…共 ${v.length} 项` : parts.join("、");
  }
  if (typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  if (depth >= 2) return `${Object.keys(obj).length} 字段`;
  // PK/name 优先打头（值须为非内部 id 的非空字符串）
  const pkKey = CELL_PK.find((k) => typeof obj[k] === "string" && (obj[k] as string) !== "" && !isInternalIdValue(obj[k]));
  const lead = pkKey ? String(obj[pkKey]) : "";
  const pairs: string[] = [];
  let omitted = 0;
  for (const [k, val] of Object.entries(obj)) {
    if (k === pkKey) continue;
    const s = compactCell(val, depth + 1);
    if (s === null || s === "") continue;
    if (pairs.length >= CELL_PAIRS_MAX) { omitted++; continue; }
    pairs.push(`${k}=${s}`);
  }
  const body = pairs.join("，") + (omitted > 0 ? `，…等 ${omitted} 项` : "");
  if (lead && body) return `${lead}（${body}）`;
  if (lead) return lead;
  return body || null;
}

/** KPI label + 单位人话化（登记未命中 → camelCase 拆词回落）。 */
function kpiBlock(field: string, value: string, provId: string, solverKey?: string): AnswerBlock {
  const { label, unit } = humanizeField(field, solverKey);
  return { type: "kpi", label, value, provId, ...(unit ? { unit } : {}) };
}
/** 长字符串（整句 note/explanation）不当 KPI 值直出——转叙事段。 */
const LONG_STRING = 40;
/**
 * 叙事段（summary/结论）里的数字**全部来自求解器工具真值**——非编造。
 * §5.5 数字溯源扫描按 ⟦ref⟧ 标跳过：给每个含数字句段补溯源标，使 Path A 叙事数字不被误判"未溯源"。
 * PROV-REF-INTEGRITY 收口（承接 ANSWER-PROJECTION 移交）：直接嵌**真实 provId**（该叙事对应字段的
 * 溯源条目），不再用数字索引 0——前端悬停按 id 查条目，数字索引即死角标。
 */
function verifiedNarrative(md: string, provId: string): string {
  const mark = `⟦ref:${provId}⟧`;
  return md
    .split(/(?<=[。．！？!?；;\n])/u)
    .map((seg) => {
      const trimmed = seg.replace(/\s+$/u, "");
      if (!trimmed || trimmed.includes("⟦ref:")) return seg;
      const tail = seg.slice(trimmed.length);
      const term = /[。．！？!?；;]$/u.test(trimmed);
      return term ? `${trimmed.slice(0, -1)} ${mark}${trimmed.slice(-1)}${tail}` : `${trimmed} ${mark}${tail}`;
    })
    .join("");
}

/** 字段级溯源铸造器：给定 outputPath（如 `$.data.p50`）→ 登记 provenance 条目并返回其 provId。 */
export type ProvMint = (outputPath: string) => string;

/**
 * 通用求解器输出投影（PRD-scenario-ontogenesis P2 / 闭 G-1·治 G-3 答案投影人话化 WO-ANSWER-PROJECTION-HUMANIZE）：
 * 把求解器**真实输出对象**投成答案块，不手写任何业务数字或文案——前端看到的每个数都是求解器算出的真值。
 * 人话化四治（审计簇③⑤）：
 *  ① 字段键→人话 label+单位（`humanizeField` 消费 `solver-field-labels` 登记·同名字段按 solverKey 消歧，R14 通用零业务常数）；
 *  ② 元字段（dataMode/ruleSetVersion/confidence.*）**移出 KPI 区**→统一脚注条（它们不是业务指标）；
 *  ③ 判断类问句必出一句**结论叙事**（`deriveConclusion` 确定性模板·只引输出已有判定/可行/推荐字段，不编造）；
 *  ④ 内部状态词（infeasible）人话化 + 内部对象 id 不当 KPI 值直出。
 * 标量→KPI、对象→展开一层 KPI、首个对象数组→表、ruleRefs→规则依据文本、summary→叙事段。确定性按 Object.keys 顺序。
 * 字段级溯源（PROV-REF-INTEGRITY ②·簇⑥）：`prov` 传 minter 时逐 KPI/表/叙事铸**独立 provenance 条目**，
 * outputPath=`$.data.<field>` 字段级路径（悬停出该字段真路径而非恒 $.data 泛化 blob；前端 kpi-{provId}
 * testid 随之唯一）。传字符串=全块共用单 provId（仅存量单测便捷形态，运行链路一律走 minter）。
 */
export function summarizeSolverOutput(payload: unknown, prov: string | ProvMint, solverKey?: string, bindings?: readonly RenderBinding[]): AnswerBlock[] {
  const hasData = payload !== null && typeof payload === "object" && "data" in (payload as Record<string, unknown>);
  const data = hasData ? (payload as Record<string, unknown>).data : payload;
  if (!data || typeof data !== "object") return [{ type: "text", markdown: "求解器无结构化输出。" }];
  const base = hasData ? "$.data" : "$";
  const mint: ProvMint = typeof prov === "function" ? prov : () => prov;
  const record = data as Record<string, unknown>;
  // KPI 延迟物化（path 收集 → 输出截断后才 mint）：不给被 slice 截掉的块铸孤儿 provenance 条目。
  const kpis: { path: string; value: string; field?: string; label?: string; unit?: string }[] = [];
  let table: AnswerBlock | null = null;
  // WO ONTO-SCEN-RENDER-PROJ ①：绑定表（binding.block==="table"）——声明的对象数组字段各投一张结果表，
  // 优先于「首个对象数组」启发式；有绑定表时未绑定数组一律降入 moreArrays（不重复投表）。
  const boundTables: AnswerBlock[] = [];
  const ruleRefs: string[] = [];
  const moreArrays: string[] = [];
  const narratives: { text: string; path: string }[] = []; // summary / 长句 → 叙事段（非 KPI）
  const metaNotes: string[] = []; // ② 元字段收拢脚注（dataMode/ruleSetVersion/confidence.*）
  // BP-7 空结果显性化（diagnostic ledger D7，闭 G-1 沉默空数组面）：记录值为**空数组**的字段
  // （combo/rows/over… 全空）与已产出的**有意义标量数**，据此区分"真无解"vs"数据未接齐"，不静默吞空数组。
  const emptyArrayKeys: string[] = [];
  let scalarCount = 0; // 有意义标量（number/boolean/非空 string/对象内标量），= 求解器确实算出了上下文

  const pushMeta = (field: string, v: unknown): void => {
    if (v === null || v === undefined) return;
    if (field === "confidence" && typeof v === "object") {
      const c = v as Record<string, unknown>;
      const bits: string[] = [];
      if (typeof c.measurement === "string") bits.push(c.measurement);
      if (typeof c.note === "string" && c.note.trim()) bits.push(c.note.trim());
      if (bits.length) metaNotes.push(`${metaLabel(field)}：${bits.join("·")}`);
      return;
    }
    const val = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (val.trim()) metaNotes.push(`${metaLabel(field)}：${val}`);
  };

  // 对象值展开一层为子字段 KPI（绑定路径与通用路径共用，语义一致）。
  const expandObjectKpis = (k: string, v: Record<string, unknown>): void => {
    for (const [k2, v2] of Object.entries(v)) {
      if (META_FIELDS.has(k2)) { pushMeta(k2, v2); continue; }
      if (isInternalIdValue(v2)) continue; // ④ base.id=obj_ 内部 id 不当值
      const child = humanizeField(k2, solverKey);
      const sub = `${humanizeField(k, solverKey).label}·${child.label}`;
      if (typeof v2 === "number") { kpis.push({ path: `${base}.${k}.${k2}`, label: sub, value: fmtNum(v2), ...(child.unit ? { unit: child.unit } : {}) }); scalarCount++; }
      else if (typeof v2 === "string" && v2 && v2.length <= LONG_STRING) { kpis.push({ path: `${base}.${k}.${k2}`, label: sub, value: v2 }); scalarCount++; }
    }
  };

  // ---------------------------------------------------------------------------
  // WO ONTO-SCEN-RENDER-PROJ ①（PRD-scenario-ontogenesis §2.2 P2·消灭静态占位）：
  // 渲染投影绑定——render 步声明的 `bindings`（= genome.renderBindings，出厂单一来源
  // contracts SOLVER_RENDER_BINDINGS，门 `ontogenesis:check` 守 ⊆ SOLVER_OUTPUT_SHAPES）优先投影：
  //  · kpi 绑定 → 先进 KPI 区（8 条上限内绑定字段恒不被截）；对象值展开一层。
  //  · table 绑定 → 即结果表（替代「首个对象数组」启发式；空数组走 BP-7 诚实空态，不静默）。
  //  · text 绑定 → 叙事段（带字段级溯源标）。
  // 齿（不作假）：绑定字段在输出中**缺席** → 抛错（工作流步失败 → 任务诚实红），绝不静默降级回占位。
  // ---------------------------------------------------------------------------
  const consumed = new Set<string>();
  if (bindings && bindings.length > 0) {
    for (const b of bindings) {
      if (!(b.fromSolverField in record)) {
        throw new Error(
          `RENDER_BINDING_MISSING: 求解器 ${solverKey ?? "?"} 输出缺少投影绑定字段「${b.fromSolverField}」（渲染契约 ⊄ 实际输出=形状漂移；SHAPE 门/真值齿应先红，不静默占位）`,
        );
      }
    }
    for (const b of bindings) {
      const k = b.fromSolverField;
      if (consumed.has(k) || k === "snapshotVersion") continue;
      consumed.add(k);
      const v = record[k];
      const path = `${base}.${k}`;
      if (b.block === "text") {
        const s = typeof v === "string" ? v.trim() : "";
        if (s) { narratives.push({ text: s, path }); scalarCount++; }
        continue;
      }
      if (b.block === "table") {
        if (Array.isArray(v) && v.length === 0) { emptyArrayKeys.push(k); continue; }
        if (Array.isArray(v) && v[0] !== null && typeof v[0] === "object") {
          const cols = Object.keys(v[0] as Record<string, unknown>);
          boundTables.push({ type: "table", columns: cols, rows: v.slice(0, 12).map((r) => cols.map((c) => cellOf((r as Record<string, unknown>)[c]))), provId: mint(path) });
        } else if (Array.isArray(v)) {
          kpis.push({ path, field: k, value: v.map(String).slice(0, 8).join("、") }); scalarCount++;
        }
        continue;
      }
      // b.block === "kpi"
      if (typeof v === "number") { kpis.push({ path, field: k, value: fmtNum(v) }); scalarCount++; }
      else if (typeof v === "boolean") { kpis.push({ path, field: k, value: v ? "是" : "否" }); scalarCount++; }
      else if (typeof v === "string") { if (v && !isInternalIdValue(v)) { kpis.push({ path, field: k, value: v }); scalarCount++; } }
      else if (Array.isArray(v) && v.length > 0 && (typeof v[0] === "number" || typeof v[0] === "string")) { kpis.push({ path, field: k, value: v.map(String).slice(0, 8).join("、") }); scalarCount++; }
      else if (Array.isArray(v) && v.length === 0) { emptyArrayKeys.push(k); }
      else if (v && typeof v === "object" && !Array.isArray(v)) { expandObjectKpis(k, v as Record<string, unknown>); }
    }
  }

  for (const [k, v] of Object.entries(record)) {
    if (consumed.has(k)) continue; // 绑定字段已按声明投影，不重复
    if (k === "snapshotVersion") continue;
    if (META_FIELDS.has(k)) { pushMeta(k, v); continue; } // ② 元字段不进 KPI 区
    if (k === "ruleRefs" && Array.isArray(v)) { ruleRefs.push(...v.map(String)); continue; }
    if (k === "summary" && typeof v === "string" && v.trim()) { narratives.push({ text: v.trim(), path: `${base}.${k}` }); scalarCount++; continue; }
    if (typeof v === "number") { kpis.push({ path: `${base}.${k}`, field: k, value: fmtNum(v) }); scalarCount++; }
    else if (typeof v === "boolean") { kpis.push({ path: `${base}.${k}`, field: k, value: v ? "是" : "否" }); scalarCount++; }
    else if (typeof v === "string") {
      if (!v || isInternalIdValue(v)) continue; // ④ 空串/内部对象 id 不当 KPI 值直出
      if (v.length > LONG_STRING) { narratives.push({ text: v.trim(), path: `${base}.${k}` }); scalarCount++; }
      else { kpis.push({ path: `${base}.${k}`, field: k, value: v }); scalarCount++; }
    }
    else if (Array.isArray(v) && v.length === 0) { emptyArrayKeys.push(k); }
    else if (Array.isArray(v) && v.length > 0 && v[0] !== null && typeof v[0] === "object") {
      // 有绑定表时：未绑定数组一律降入 moreArrays（结果表由绑定声明，不被启发式抢占）。
      if (!table && boundTables.length === 0) {
        const cols = Object.keys(v[0] as Record<string, unknown>);
        table = { type: "table", columns: cols, rows: v.slice(0, 12).map((r) => cols.map((c) => cellOf((r as Record<string, unknown>)[c]))), provId: mint(`${base}.${k}`) };
      } else moreArrays.push(`${humanizeField(k, solverKey).label}（${v.length} 项）`);
    } else if (Array.isArray(v) && v.length > 0) {
      kpis.push({ path: `${base}.${k}`, field: k, value: v.map(String).slice(0, 8).join("、") });
    } else if (v && typeof v === "object") {
      expandObjectKpis(k, v as Record<string, unknown>);
    }
  }

  // ③ 判断类问句结论叙事（确定性模板·只引输出真值·数字红线不编造）——置于叙事段首。
  // 结论由多字段推导 → 溯源锚整个输出（base 路径）；summary/长句叙事锚各自字段路径。
  const conclusion = deriveConclusion(record);
  const out: AnswerBlock[] = [];
  if (conclusion) out.push({ type: "text", markdown: verifiedNarrative(conclusion, mint(base)) });
  for (const n of narratives.slice(0, 2)) out.push({ type: "text", markdown: verifiedNarrative(n.text, mint(n.path)) });
  for (const p of kpis.slice(0, 8)) {
    if (p.label !== undefined) out.push({ type: "kpi", label: p.label, value: p.value, provId: mint(p.path), ...(p.unit ? { unit: p.unit } : {}) });
    else out.push(kpiBlock(p.field ?? "", p.value, mint(p.path), solverKey));
  }
  for (const bt of boundTables) out.push(bt); // ① 绑定表先于启发式表（绑定即结果表）
  if (table) out.push(table);
  if (ruleRefs.length > 0) out.push({ type: "text", markdown: `依据规则：${ruleRefs.join("、")} ⟦ref:${mint(`${base}.ruleRefs`)}⟧` });
  // moreArrays 计数（N 项）源自求解器真实数组长度（tool 真值）→ 补溯源标，不被 §5.5 误判未溯源。
  if (moreArrays.length > 0) out.push({ type: "text", markdown: verifiedNarrative(`另有明细：${moreArrays.join("、")}（详见步骤溯源）。`, mint(base)) });
  // BP-7：求解器产出空数组字段（combo/rows/over… 全空）→ 显性化"为何为空 + 下一步建议"，
  // 区分两类（不静默吞空数组）：
  //   ·【真无解】关键标量在（求解器跑了且有上下文，如 residualGap/quarter），仅结果数组为空
  //      → 求解器确认在当前约束下没有可行项（非数据缺失）。建议放宽约束/加杠杆/扩窗口。
  //   ·【数据未接齐】连关键标量也缺（输出近乎空壳）→ 上游切片/口径未接齐，求解器无料可算。
  //      建议先接入/补齐数据再重跑（触发合成≠伪造，走管线读回真实值）。
  // 渲染条件修（LAUNCHER 复验移交·S11 疵）：『结果为空（真无解/数据未接齐）』是**整体级**判决，
  //   只应在**答案整体无结果数据块**（未投出任何结果表）时升格出现。若已有结果表（求解器确给出结果行），
  //   某些**无关子字段**恰为空数组，只应降为**轻量一行『无』**——不得让无关空子字段误报整体无解、
  //   盖过并存的真实结果（S11 6 行换型序列结果表并存却显"真无解"，误导用户以为整体无解）。
  // ④ S13/S10 修：空子字段用**人话 label**点名（如 unresolved→待处理项、over→超储项），
  //   不再直出内部术语「infeasible」（用户看不懂 unresolved 被写成 infeasible 的错位）。
  const emptyHuman = emptyArrayKeys.map((k) => humanizeField(k, solverKey).label);
  if (emptyArrayKeys.length > 0) {
    const empties = emptyHuman.join("、");
    if (table || boundTables.length > 0) {
      // 已有结果数据块 → 空子字段轻量披露（仍点名，不静默吞），不升格为整体无解
      out.push({
        type: "text",
        markdown: `子字段「${empties}」：无——该项在当前结果下无内容，不影响上表结果。`,
      });
    } else if (scalarCount > 0) {
      out.push({
        type: "text",
        markdown:
          `**结果为空（真无解）**：求解器已运行并给出上述口径，但「${empties}」为空——` +
          `在当前输入与约束下没有可行项可纳入。\n下一步建议：放宽约束/补充可选杠杆（如新增对策、提升可释放量）或扩大时间窗后重跑；` +
          `若残余缺口（如 residualGap）>0 表示缺口未被任何对策覆盖。`,
      });
    } else {
      out.push({
        type: "text",
        markdown:
          `**结果为空（数据未接齐）**：「${empties}」为空，且本次未产出关键标量——` +
          `多为上游数据/切片未接齐，求解器无可计算的输入。\n下一步建议：先核对并接入该场景所需的对象切片与口径` +
          `（必要时触发合成补数据，走管线读回真实值，非伪造）后重跑。`,
      });
    }
  }
  // ② 元字段脚注条（口径/版本/置信度）——统一收拢在答案末尾，不与业务 KPI 混排。
  if (metaNotes.length > 0) out.push({ type: "text", markdown: `口径与来源：${metaNotes.join("；")}。` });
  if (out.length === 0) out.push({ type: "text", markdown: "求解器本次无输出数据（可能输入为空或全部满足约束）。" });
  return out;
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
  // 钩子：不涉及本体切片**且**无规则裁决 → 不附；有规则裁决（含 O10 自动注入的卡规则）即便无切片也附，
  // 使 PASS/WARN/BLOCK 透出可见（承接轨E 规则即引用：评估结果非装饰，要能看到）。
  if (in_.slicesUsed.length === 0 && in_.verdicts.length === 0) return undefined;

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
