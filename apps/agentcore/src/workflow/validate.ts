import type { AgentDefinition, WorkflowDefinition } from "@platform/contracts";
import type { Repos } from "../persistence/repos.js";
import type { ExtendedPlanStep } from "./executor.js";

const STEP_REF_RE = /\{\{\s*steps\.([\w-]+)\.output[^}]*\}\}/g;

function collectStepRefs(value: unknown, acc: Set<string>): void {
  if (typeof value === "string") {
    for (const m of value.matchAll(STEP_REF_RE)) acc.add(m[1] as string);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStepRefs(v, acc);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectStepRefs(v, acc);
  }
}

export interface PlanValidationOptions {
  /** Intent risk level — when given, create_action_draft is only allowed at ACTION_DRAFT. */
  riskLevel?: "READ" | "COMPUTE" | "ACTION_DRAFT";
  /** QOS execution plans must end with render_answer; standalone workflows need not. */
  requireRenderAnswer?: boolean;
}

/** 增量 §2-1：有界同步执行声明 —— workflow 总时限（Σ步骤超时上限）≤ 5 分钟。 */
export const WORKFLOW_TOTAL_TIMEOUT_LIMIT_MS = 5 * 60_000;
const STEP_DEFAULT_TIMEOUT_MS = 10_000;
const SOLVER_DEFAULT_TIMEOUT_MS = 30_000;

/** 单步骤超时上限（声明值优先；缺省与执行器一致：solver 30s，其它 10s）。 */
export function stepTimeoutBound(step: ExtendedPlanStep): number {
  const declared = (step as { timeoutMs?: number }).timeoutMs;
  if (declared !== undefined) return declared;
  return step.type === "invoke_solver" ? SOLVER_DEFAULT_TIMEOUT_MS : STEP_DEFAULT_TIMEOUT_MS;
}

/**
 * #1 余项：从 ExecutionPlan 的 `render_answer` **自动派生 renderBindings**——每个求解器步骤
 * 被渲染模板引用的输出字段路径（`{{steps.<solverStep>.output.data.<field>…}}` → `<field>…`）。
 * 这就是"渲染契约"：与 DataCore `closure.ts` 的 SHAPE 维同源，可据此校验渲染绑定 ⊆ 求解器输出形状
 * （SHAPE 校验在 DataCore 侧用 SOLVER_OUTPUT_SHAPES 执行，R1 不跨包共享实现）。返回 solverKey→字段路径集。
 */
export function deriveRenderBindings(steps: ExtendedPlanStep[]): Record<string, string[]> {
  const solverByStep = new Map<string, string>();
  for (const s of steps) {
    if (s.type === "invoke_solver") {
      const k = (s.params as { solverKey?: string }).solverKey;
      if (k) solverByStep.set(s.id, k);
    }
  }
  const out: Record<string, Set<string>> = {};
  const RE = /\{\{\s*steps\.([\w-]+)\.output\.([\w.[\]]+?)\s*\}\}/g;
  const scan = (v: unknown): void => {
    if (typeof v === "string") {
      for (const m of v.matchAll(RE)) {
        const solverKey = solverByStep.get(m[1] as string);
        if (!solverKey) continue;
        const field = (m[2] as string).replace(/^data\./, ""); // 去 ToolPayload data. 包裹
        if (field) (out[solverKey] ??= new Set()).add(field);
      }
    } else if (Array.isArray(v)) {
      for (const x of v) scan(x);
    } else if (v && typeof v === "object") {
      for (const x of Object.values(v)) scan(x);
    }
  };
  for (const s of steps) if (s.type === "render_answer") scan(s.params);
  return Object.fromEntries(Object.entries(out).map(([k, set]) => [k, [...set].sort()]));
}

/** Publish-time plan validation (QOS-PRD §4.2/§5.3, errors → PLAN_VALIDATION_ERROR). */
export function validatePlanSteps(steps: ExtendedPlanStep[], opts: PlanValidationOptions = {}): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const ids = new Set(steps.map((s) => s.id));

  steps.forEach((step, i) => {
    if (seen.has(step.id)) errors.push(`步骤 id 重复: ${step.id}`);
    const refs = new Set<string>();
    collectStepRefs(step, refs);
    for (const ref of refs) {
      if (!ids.has(ref)) {
        errors.push(`步骤 ${step.id} 引用了不存在的步骤 ${ref}`);
      } else if (!seen.has(ref)) {
        errors.push(`步骤 ${step.id} 前向引用了步骤 ${ref}（steps[i] 只能引用 j<i 的产出）`);
      }
    }
    seen.add(step.id);
    if (step.type === "render_answer" && i !== steps.length - 1) {
      errors.push(`render_answer 必须是最后一步（当前在第 ${i + 1} 步）`);
    }
    if (step.type === "create_action_draft" && opts.riskLevel !== undefined && opts.riskLevel !== "ACTION_DRAFT") {
      errors.push(`create_action_draft 仅允许出现在 riskLevel=ACTION_DRAFT 的意图计划中（当前 ${opts.riskLevel}）`);
    }
  });

  if (opts.requireRenderAnswer) {
    const last = steps[steps.length - 1];
    if (!last || last.type !== "render_answer") {
      errors.push("计划必须包含 render_answer 且为最后一步");
    }
  }

  // 增量 §2-1：发布校验 —— 步骤超时合计超过 5 分钟 → 拒绝发布（有界同步执行声明）
  const totalTimeoutMs = steps.reduce((sum, s) => sum + stepTimeoutBound(s), 0);
  if (totalTimeoutMs > WORKFLOW_TOTAL_TIMEOUT_LIMIT_MS) {
    errors.push(
      `步骤超时合计 ${totalTimeoutMs}ms 超过 workflow 总时限上限 ${WORKFLOW_TOTAL_TIMEOUT_LIMIT_MS}ms（5 分钟）`,
    );
  }
  return errors;
}

/**
 * Static reachability cycle detection across agent↔workflow references
 * (platform PRD §8.2). Returns the cycle path when found.
 */
export async function detectStaticCycle(
  repos: Repos,
  start: { kind: "agent" | "workflow"; id: string },
  /** optional not-yet-persisted definition being published */
  pending?: { agent?: AgentDefinition; workflow?: WorkflowDefinition },
): Promise<string[] | undefined> {
  const visiting: string[] = [];
  const done = new Set<string>();

  const neighbors = async (node: { kind: "agent" | "workflow"; id: string }): Promise<{ kind: "agent" | "workflow"; id: string }[]> => {
    if (node.kind === "agent") {
      const agent = pending?.agent?.id === node.id ? pending.agent : await repos.agents.get(node.id);
      if (!agent) return [];
      return agent.tools
        .filter((t): t is Extract<typeof t, { kind: "WORKFLOW" }> => t.kind === "WORKFLOW")
        .map((t) => ({ kind: "workflow" as const, id: t.workflowId }));
    }
    const wf = pending?.workflow?.id === node.id ? pending.workflow : await repos.workflows.get(node.id);
    if (!wf) return [];
    const out: { kind: "agent" | "workflow"; id: string }[] = [];
    for (const step of wf.steps) {
      if (step.type === "invoke_agent") out.push({ kind: "agent", id: step.params.agentId });
    }
    return out;
  };

  async function dfs(node: { kind: "agent" | "workflow"; id: string }): Promise<string[] | undefined> {
    const key = `${node.kind}:${node.id}`;
    if (visiting.includes(key)) return [...visiting.slice(visiting.indexOf(key)), key];
    if (done.has(key)) return undefined;
    visiting.push(key);
    for (const n of await neighbors(node)) {
      const cycle = await dfs(n);
      if (cycle) return cycle;
    }
    visiting.pop();
    done.add(key);
    return undefined;
  }

  return dfs(start);
}
