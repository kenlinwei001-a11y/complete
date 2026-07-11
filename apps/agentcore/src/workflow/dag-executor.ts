import type { ExecutionGraph, Gateway, GuardExpr, RetryPolicy, RuleVerdict, SkillDefinition, Transition } from "@platform/contracts";
import type { NestingCtx } from "../runtime.js";
import { resolveTemplate, TemplateResolutionError, type TemplateScope } from "../util/template.js";
import {
  executeStep,
  finalizeAnswer,
  finalizeFailed,
  initWorkflowState,
  mergeStepEffects,
  type ExtendedPlanStep,
  type WorkflowRunDeps,
  type WorkflowRunInput,
  type WorkflowResult,
} from "./executor.js";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WO-L1B-2 · Workflow-DAG 运行时（拓扑并行 + 条件 Gateway + 步级重试·无 durable/补偿）
 * PRD: docs/PRD-L1B-execution-planner-workflow-runtime.md §4.2/§4.3/§4.5
 *
 * · §4.2 拓扑并行（Kahn·就绪并发）：入度 0 起点就绪 → 波次并发（Promise.all）执行 →
 *   完成后后继入度-1·新就绪并发；扇入节点等全部前驱 settled 才起。
 * · §4.3 条件 Gateway（确定性择支·R6·非 BPMN）：EXCLUSIVE 取首个命中支·未命中支 SKIPPED
 *   （沿子树剪枝传播）；PARALLEL 全激活；INCLUSIVE 命中全激活。守卫纯值比较·无 LLM/随机。
 * · §4.5 步级重试：节点 retry 策略经 executeStep 内 runToolWithRetry（幂等守卫·create_action_draft 不重试）。
 *
 * R6 确定性：就绪队列/波次按 nodeId 稳定排序；effects 按 nodeId 稳定序合并 → stepOutputs 键序
 *   与并行交错时序无关 → 同 (graph, inputs) 双跑字节一致。纯线性图 → 波次退化为单元素插入序
 *   = 旧串行序 → 与 runWorkflow 逐字节等价（复用同一 executeStep / finalizeAnswer·§7 V6 parity）。
 *
 * durable checkpoint 续跑 / 补偿回滚留 WO-L1B-3（本单只做内存态并行执行器·不做 checkpoint 续跑）。
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** DAG 节点（运行时视图·内嵌 ExtendedPlanStep·兼容契约 ExecutionGraph.nodes 与线性 lift）。 */
export interface DagNodeInput {
  nodeId: string;
  step: ExtendedPlanStep;
  dependsOn: string[];
  retry?: RetryPolicy;
}

/** DAG 图（运行时视图·nodes + gateways + transitions·兼容契约 ExecutionGraph 的对应字段）。 */
export interface DagGraphInput {
  nodes: DagNodeInput[];
  gateways?: Gateway[];
  transitions?: Transition[];
  entryNodes?: string[];
}

export interface WorkflowDagRunInput {
  graph: DagGraphInput | ExecutionGraph;
  slots: Record<string, unknown>;
  context: unknown;
  nesting: NestingCtx;
  trustLevel?: "VERIFIED_WORKFLOW" | "AGENT_EXPLORATORY";
  tenantId?: string;
  skills?: SkillDefinition[];
}

/** 线性 ExtendedPlanStep[] → DAG 链图（引擎暗发路径·纯线性 lift·退化为串行序·§2.1 parity）。 */
export function liftStepsToDagGraph(steps: ExtendedPlanStep[]): DagGraphInput {
  const nodes: DagNodeInput[] = steps.map((step, i) => ({
    nodeId: step.id,
    step,
    dependsOn: i === 0 ? [] : [steps[i - 1]!.id],
  }));
  return { nodes, gateways: [], transitions: [], entryNodes: steps.length > 0 ? [steps[0]!.id] : [] };
}

type NodeStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";

function isRuleVerdicts(v: unknown): v is RuleVerdict[] {
  return Array.isArray(v) && v.every((x) => x !== null && typeof x === "object" && "ruleId" in (x as object) && "passed" in (x as object));
}
function toNum(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}

/**
 * runWorkflowDag：DAG 执行器（拓扑并行 + Gateway 择支 + 步级重试）。
 * 复用 executeStep（步派发/render/规则拦截零重造）与 finalizeAnswer/finalizeFailed（终态组装共用）。
 */
export async function runWorkflowDag(deps: WorkflowRunDeps, input: WorkflowDagRunInput): Promise<WorkflowResult> {
  const g = input.graph;
  const trustLevel = input.trustLevel ?? "VERIFIED_WORKFLOW";
  const state = initWorkflowState();
  const scope: TemplateScope = { slots: input.slots, context: input.context, steps: state.stepOutputs };
  // executeStep / finalizeAnswer 需 WorkflowRunInput 形（steps 空占位·实际步来自 graph.nodes）。
  const wfInput: WorkflowRunInput = {
    steps: [],
    slots: input.slots,
    context: input.context,
    nesting: input.nesting,
    trustLevel,
    tenantId: input.tenantId,
    skills: input.skills,
  };

  const nodes = g.nodes as DagNodeInput[];
  const nodeById = new Map(nodes.map((n) => [n.nodeId, n]));
  const gateways = (g.gateways ?? []) as Gateway[];
  const transitions = (g.transitions ?? []) as Transition[];
  const gatewayById = new Map(gateways.map((gw) => [gw.gatewayId, gw]));

  const status = new Map<string, NodeStatus>();
  for (const n of nodes) status.set(n.nodeId, "PENDING");
  const pruned = new Set<string>(); // gateway 剪枝的节点（子树 SKIP）
  const activated = new Set<string>(); // gateway 激活的分支目标
  const gwEvaluated = new Set<string>();

  // gateway 进边：transition{from: node, to: gateway} → gateway 的 feeder 节点集。
  const gwFeeders = new Map<string, string[]>();
  for (const tr of transitions) {
    if (gatewayById.has(tr.to) && nodeById.has(tr.from)) {
      gwFeeders.set(tr.to, [...(gwFeeders.get(tr.to) ?? []), tr.from]);
    }
  }
  // 被 gateway 门控的节点（分支目标 / default）——仅在其 gateway 评估激活后方就绪。
  const gatedBy = new Map<string, string>();
  for (const gw of gateways) {
    for (const b of gw.branches) if (nodeById.has(b.to)) gatedBy.set(b.to, gw.gatewayId);
    if (gw.default && nodeById.has(gw.default)) gatedBy.set(gw.default, gw.gatewayId);
  }

  const settled = (id: string): boolean => {
    const s = status.get(id);
    return s === "DONE" || s === "SKIPPED";
  };

  // 剪枝传播：pruned 节点标 SKIPPED；其下游若全部前驱皆 pruned（无活路）→ 递归剪枝（扇入 join 存活）。
  const prune = (nodeId: string): void => {
    if (pruned.has(nodeId) || !nodeById.has(nodeId)) return;
    pruned.add(nodeId);
    status.set(nodeId, "SKIPPED");
    for (const d of nodes) {
      if (d.dependsOn.includes(nodeId) && d.dependsOn.every((p) => pruned.has(p))) prune(d.nodeId);
    }
  };

  // 确定性守卫求值（§4.3·纯值比较·无 LLM/随机·R6）。
  const evalGuard = (guard: GuardExpr | null): boolean => {
    if (!guard) return true;
    let val: unknown;
    try {
      val = resolveTemplate(guard.ref, scope);
    } catch (err) {
      if (err instanceof TemplateResolutionError) return false;
      throw err;
    }
    switch (guard.op) {
      case "EXISTS":
        return val !== null && val !== undefined;
      case "EQ":
        return val === guard.value;
      case "NE":
        return val !== guard.value;
      case "LT":
        return toNum(val) < toNum(guard.value);
      case "LE":
        return toNum(val) <= toNum(guard.value);
      case "GT":
        return toNum(val) > toNum(guard.value);
      case "GE":
        return toNum(val) >= toNum(guard.value);
      case "RULE_PASSED":
        return isRuleVerdicts(val) && val.every((v) => v.passed);
      case "RULE_BLOCKED":
        return isRuleVerdicts(val) && val.some((v) => !v.passed && v.severity === "BLOCK");
      default:
        return false;
    }
  };

  const evaluateGateway = (gw: Gateway): void => {
    if (gw.kind === "EXCLUSIVE") {
      let chosen: string | null = null;
      for (const b of gw.branches) {
        if (evalGuard(b.condition)) {
          chosen = b.to;
          break;
        }
      }
      if (chosen === null) chosen = gw.default ?? null;
      for (const b of gw.branches) if (b.to !== chosen && nodeById.has(b.to)) prune(b.to);
      if (gw.default && gw.default !== chosen && nodeById.has(gw.default)) prune(gw.default);
      if (chosen && nodeById.has(chosen)) activated.add(chosen);
    } else if (gw.kind === "PARALLEL") {
      for (const b of gw.branches) if (nodeById.has(b.to)) activated.add(b.to);
    } else {
      // INCLUSIVE：命中全激活·未命中剪枝；无命中回落 default。
      let any = false;
      for (const b of gw.branches) {
        if (evalGuard(b.condition)) {
          if (nodeById.has(b.to)) {
            activated.add(b.to);
            any = true;
          }
        } else if (nodeById.has(b.to)) {
          prune(b.to);
        }
      }
      if (!any && gw.default && nodeById.has(gw.default)) activated.add(gw.default);
    }
  };

  // ── 拓扑波次调度循环（Kahn·就绪并发）─────────────────────────────────────
  for (;;) {
    let progressed = false;

    // 1) 评估就绪的 gateway（全 feeder DONE·或无 feeder 的入口 gateway）。
    for (const gw of gateways) {
      if (gwEvaluated.has(gw.gatewayId)) continue;
      const feeders = gwFeeders.get(gw.gatewayId) ?? [];
      if (feeders.length === 0 || feeders.every((f) => status.get(f) === "DONE")) {
        evaluateGateway(gw);
        gwEvaluated.add(gw.gatewayId);
        progressed = true;
      }
    }

    // 2) 收集就绪节点：PENDING·未剪枝·全前驱 settled·（若门控则须 activated）。按 nodeId 稳定排序。
    const ready = nodes
      .filter((n) => {
        if (status.get(n.nodeId) !== "PENDING" || pruned.has(n.nodeId)) return false;
        if (!n.dependsOn.every(settled)) return false;
        if (gatedBy.has(n.nodeId) && !activated.has(n.nodeId)) return false;
        return true;
      })
      .sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0));

    if (ready.length === 0) {
      if (progressed) continue; // gateway 刚评估·重扫可能新就绪
      break; // 无 gateway 进展且无就绪 → 收敛（全 settled 或死锁停）
    }

    // 3) 波次并发执行（Promise.all·各节点 step.started 前置 → 交错推帧·C1）。
    for (const n of ready) status.set(n.nodeId, "RUNNING");
    const results = await Promise.all(
      ready.map(async (n) => ({ n, ...(await executeStep(deps, wfInput, n.step, scope, state.stepAudits, trustLevel, n.retry)) })),
    );

    // 4) 按 nodeId 稳定序合并 effects（R6：stepOutputs 键序与并行完成时序无关）+ 判终态。
    let terminal: WorkflowResult | null = null;
    let firstFail: { code: string; message: string; stepId: string } | null = null;
    for (const { n, outcome, effects } of results) {
      mergeStepEffects(state, n.nodeId, effects, deps);
      if (outcome.kind === "ANSWER") {
        status.set(n.nodeId, "DONE");
        if (!terminal) terminal = await finalizeAnswer(deps, wfInput, state, outcome.answer);
      } else if (outcome.kind === "FAILED") {
        status.set(n.nodeId, "FAILED");
        if (!firstFail) firstFail = { code: outcome.code, message: outcome.message, stepId: outcome.stepId };
      } else if (outcome.kind === "SKIPPED") {
        status.set(n.nodeId, "SKIPPED");
      } else {
        status.set(n.nodeId, "DONE");
      }
    }

    // FAIL 先于 ANSWER（对齐串行"首个失败即终止"·纯线性单节点波次下二者互斥）。
    if (firstFail) return finalizeFailed(state, firstFail.code, firstFail.message, firstFail.stepId);
    if (terminal) return terminal;
  }

  // 无 render_answer 终态叶（standalone workflow）：合成完成摘要（与串行 fallback 逐字节等价）。
  return finalizeAnswer(deps, wfInput, state, {
    trustLevel,
    blocks: [{ type: "text", markdown: "工作流执行完成。" }],
    provenance: [],
    unverifiedNumerics: false,
  });
}
