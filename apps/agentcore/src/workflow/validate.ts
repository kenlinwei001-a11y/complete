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
