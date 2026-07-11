import type {
  CompensationAction,
  DagNodeStatus,
  DagRunStatus,
  ExecutionGraph,
  Gateway,
  GuardExpr,
  RetryPolicy,
  RuleVerdict,
  SkillDefinition,
  Transition,
  WorkflowDagNodeState,
  WorkflowDagRun,
} from "@platform/contracts";
import type { NestingCtx } from "../runtime.js";
import { resolveTemplate, TemplateResolutionError, type TemplateScope } from "../util/template.js";
import type { DagResumePayload, WorkflowDagCheckpointStore } from "./checkpoint.js";
import {
  executeStep,
  finalizeAnswer,
  finalizeFailed,
  initWorkflowState,
  mergeStepEffects,
  type ExtendedPlanStep,
  type StepRunEffects,
  type WorkflowRunDeps,
  type WorkflowRunInput,
  type WorkflowResult,
} from "./executor.js";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WO-L1B-2 · Workflow-DAG 运行时（拓扑并行 + 条件 Gateway + 步级重试）
 * WO-L1B-3 · durable checkpoint 续跑 + 补偿反向序回滚（移植 build 侧 BuildWorkflowEngine·G-8⑤/G-11）
 * PRD: docs/PRD-L1B-execution-planner-workflow-runtime.md §4.2/§4.3/§4.4/§4.5/§4.6
 *
 * · §4.2 拓扑并行（Kahn·就绪并发）：入度 0 起点就绪 → 波次并发（Promise.all）执行 →
 *   完成后后继入度-1·新就绪并发；扇入节点等全部前驱 settled 才起。
 * · §4.3 条件 Gateway（确定性择支·R6·非 BPMN）：EXCLUSIVE 取首个命中支·未命中支 SKIPPED
 *   （沿子树剪枝传播）；PARALLEL 全激活；INCLUSIVE 命中全激活。守卫纯值比较·无 LLM/随机。
 * · §4.4 durable checkpoint 续跑：每波次 DONE 节点落 WorkflowDagRun 快照（per-node checkpoint =
 *   step effects·全局 stepOutputs 快照）；进程崩溃留 RUNNING；resume 跳过 DONE 节点从就绪集重驱动
 *   （resumedCount++·答案逐字节等价·R6）。真崩溃模拟 stopAfterNode（镜像 stopAfterStep·真停·非 mock）。
 * · §4.5 步级重试：节点 retry 策略经 executeStep 内 runToolWithRetry（幂等守卫·create_action_draft 不重试）。
 * · §4.6 补偿/回滚：FATAL 且 onError=COMPENSATE（或 run 级回滚）→ 对已 DONE 且声明 CompensationAction
 *   的节点**按反向拓扑序**补偿；NOOP（只读步）跳过·REVERSING_ACTION 经 S2 Action 审批（R4·不静默反转）·
 *   不可逆步 COMPENSATED=false 诚实记录（不伪装·KILL-MOCK）。
 *
 * R6 确定性：就绪队列/波次按 nodeId 稳定排序；effects 按 nodeId 稳定序合并 → stepOutputs 键序
 *   与并行交错时序无关 → 同 (graph, inputs) 双跑字节一致。纯线性图 → 波次退化为单元素插入序
 *   = 旧串行序 → 与 runWorkflow 逐字节等价（复用同一 executeStep / finalizeAnswer·§7 V6 parity）。
 *
 * **关闸回退（C3）**：durable/续跑/补偿字段全 undefined（缺省·QOS_WORKFLOW_DAG off + NoopStore）
 *   → 行为 == WO-L1B-2 内存态执行器（逐字节等价·崩溃走 INTERRUPTED_BY_RESTART 启动扫描·可证回退）。
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** DAG 节点（运行时视图·内嵌 ExtendedPlanStep·兼容契约 ExecutionGraph.nodes 与线性 lift）。 */
export interface DagNodeInput {
  nodeId: string;
  step: ExtendedPlanStep;
  dependsOn: string[];
  retry?: RetryPolicy;
  /** WO-L1B-3：节点级失败策略（FAIL 终止 / SKIP 置空续 / COMPENSATE 触发补偿反向序·契约 TaskNode.onError）。 */
  onError?: "FAIL" | "SKIP" | "COMPENSATE";
}

/** DAG 图（运行时视图·nodes + gateways + transitions·兼容契约 ExecutionGraph 的对应字段）。 */
export interface DagGraphInput {
  nodes: DagNodeInput[];
  gateways?: Gateway[];
  transitions?: Transition[];
  entryNodes?: string[];
}

/** WO-L1B-3 补偿执行钩子：REVERSING_ACTION/CUSTOM 的反向步经此走 S2 Action 审批（R4）。 */
export interface CompensateHook {
  (input: { nodeId: string; action: CompensationAction; stepOutputs: Record<string, unknown> }): Promise<{
    /** true=反向动作已提交 S2 审批流（非静默反转·EXECUTED 才落）；false=不可逆/失败（诚实记录·不伪装）。 */
    compensated: boolean;
    detail?: string;
  }>;
}

export interface WorkflowDagRunInput {
  graph: DagGraphInput | ExecutionGraph;
  slots: Record<string, unknown>;
  context: unknown;
  nesting: NestingCtx;
  trustLevel?: "VERIFIED_WORKFLOW" | "AGENT_EXPLORATORY";
  tenantId?: string;
  skills?: SkillDefinition[];

  // ── WO-L1B-3 durable / 续跑 / 补偿（缺省全 undefined → 行为 == WO-L1B-2·逐字节等价·可证回退）──
  /** durable checkpoint 落点（缺省=不落库·== 改造前内存态执行器）。 */
  durable?: {
    store: WorkflowDagCheckpointStore;
    runId: string;
    taskId?: string;
    graphId?: string;
    /** R6 可注入时钟（内部不取 Date.now·测试固定·续跑与未中断跑时间戳不入答案哈希）。 */
    now?: () => string;
    /** 原执行 auth（tenant/user/roles·无 token）——落库供启动自动续跑重建 ctx（A6 忠实）。 */
    authCtx?: { tenantId: string; userId: string; roles: string[] };
  };
  /** 真崩溃模拟（镜像 BuildWorkflowEngine.stopAfterStep·真停驱动·非 mock）：该节点 DONE 落 checkpoint
   *  后抛 WorkflowDagInterrupted（run 留 RUNNING·可续跑）。仅测试/回退演练用。 */
  stopAfterNode?: string;
  /** 续跑：上次崩溃落库的 run 快照（跳过其 DONE 节点·从就绪集重驱动·resumedCount++·答案逐字节等价）。 */
  resumeFrom?: WorkflowDagRun;
  /** 补偿声明（反向拓扑序回滚·R4·出站经 S2）。 */
  compensations?: CompensationAction[];
  /** 补偿执行钩子（REVERSING_ACTION/CUSTOM 反向步经此走 S2·R4·缺省=不可逆诚实 COMPENSATED=false）。 */
  compensate?: CompensateHook;
  /** run 级回滚：任一节点 FATAL 即触发补偿（缺省仅在 onError=COMPENSATE 节点触发）。 */
  rollbackOnFailure?: boolean;
  /** DAG 内部域事件（非 SSE·审计/可观测·node_advanced/checkpoint_saved/run_resumed/step_retry/compensated）。 */
  emitDag?: (event: string, payload: unknown) => void;
}

/** 真崩溃中断信号（stopAfterNode 触发·run 已落 RUNNING·可续跑）。 */
export class WorkflowDagInterrupted extends Error {
  constructor(
    readonly runId: string,
    readonly atNode: string,
  ) {
    super(`workflow dag interrupted after node ${atNode} (run ${runId})`);
    this.name = "WorkflowDagInterrupted";
  }
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

type NodeStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED" | "COMPENSATED";

function isRuleVerdicts(v: unknown): v is RuleVerdict[] {
  return Array.isArray(v) && v.every((x) => x !== null && typeof x === "object" && "ruleId" in (x as object) && "passed" in (x as object));
}
function toNum(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}
function isExecutionGraph(g: DagGraphInput | ExecutionGraph): g is ExecutionGraph {
  return "graphId" in g;
}

/**
 * runWorkflowDag：DAG 执行器（拓扑并行 + Gateway 择支 + 步级重试 + durable checkpoint + 补偿反向序）。
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

  // ── WO-L1B-3 durable 态 ─────────────────────────────────────────────────
  const durable = input.durable;
  const store = durable?.store;
  const runId = durable?.runId;
  const taskId = durable?.taskId ?? runId ?? "";
  const tenantId = input.tenantId ?? (isExecutionGraph(g) ? g.tenantId : "");
  const graphId = durable?.graphId ?? (isExecutionGraph(g) ? g.graphId : (runId ?? "dag"));
  const now = durable?.now ?? (() => new Date().toISOString());
  const emitDag = input.emitDag ?? (() => undefined);
  const resumeFrom = input.resumeFrom;
  const startedAt = resumeFrom?.startedAt ?? now();
  const resumedCount = resumeFrom ? resumeFrom.resumedCount + 1 : 0;
  const nodeEffects = new Map<string, StepRunEffects>(); // per-node checkpoint 素材
  const attemptsByNode = new Map<string, number>();
  const nodeError = new Map<string, { code: string; message: string; retryable: boolean }>();
  const onErrorOf = (n: DagNodeInput | undefined): "FAIL" | "SKIP" | "COMPENSATE" =>
    n?.onError ?? (n && "onError" in n.step && n.step.onError ? (n.step.onError as "FAIL" | "SKIP") : "FAIL");

  const buildRun = (runStatus: DagRunStatus, completedAt: string | null): WorkflowDagRun => {
    const nodeStates: WorkflowDagNodeState[] = nodes.map((n) => {
      const eff = nodeEffects.get(n.nodeId);
      const err = nodeError.get(n.nodeId);
      return {
        nodeId: n.nodeId,
        status: (status.get(n.nodeId) ?? "PENDING") as DagNodeStatus,
        attempts: attemptsByNode.get(n.nodeId) ?? 0,
        maxAttempts: n.retry?.maxAttempts ?? 1,
        ...(eff ? { checkpoint: eff as unknown as Record<string, unknown> } : {}),
        ...(err ? { error: err } : {}),
      };
    });
    return {
      runId: runId ?? "",
      taskId,
      tenantId,
      graphId,
      status: runStatus,
      nodes: nodeStates,
      stepOutputs: { ...state.stepOutputs },
      resumedCount,
      startedAt,
      updatedAt: now(),
      completedAt,
    };
  };
  const resumePayload: DagResumePayload | undefined = store
    ? {
        graph: g,
        slots: input.slots,
        context: input.context,
        trustLevel,
        compensations: input.compensations,
        ...(durable?.authCtx ? { authCtx: durable.authCtx } : {}),
      }
    : undefined;
  const persist = async (runStatus: DagRunStatus, completedAt: string | null): Promise<void> => {
    if (!store || !runId) return;
    await store.save(buildRun(runStatus, completedAt), resumePayload);
  };

  // ── 续跑初始化（跳过 DONE 节点·回灌 stepOutputs/audits/slices·R6 逐字节等价）──────────────
  if (resumeFrom) {
    const effByNode = new Map<string, StepRunEffects>();
    for (const ns of resumeFrom.nodes) {
      if (ns.checkpoint && (ns.status === "DONE" || ns.status === "SKIPPED")) {
        effByNode.set(ns.nodeId, ns.checkpoint as unknown as StepRunEffects);
      }
      attemptsByNode.set(ns.nodeId, ns.attempts);
    }
    // 按原插入序回灌 stepOutputs（stepOutputs 键序 = 原完成序·保 R6 键序），并恢复 audits/slices/verdicts。
    for (const nodeId of Object.keys(resumeFrom.stepOutputs)) {
      const eff = effByNode.get(nodeId);
      if (eff) {
        mergeStepEffects(state, nodeId, eff, deps);
        nodeEffects.set(nodeId, eff);
      } else {
        state.stepOutputs[nodeId] = resumeFrom.stepOutputs[nodeId];
      }
    }
    for (const ns of resumeFrom.nodes) {
      if (ns.status === "DONE") status.set(ns.nodeId, "DONE");
      else if (ns.status === "SKIPPED") {
        status.set(ns.nodeId, "SKIPPED");
        pruned.add(ns.nodeId);
      } else if (ns.status === "COMPENSATED") status.set(ns.nodeId, "COMPENSATED");
      // FAILED / RUNNING / PENDING → 保持 PENDING（重跑·读工具幂等；gateway 重评估确定性）。
    }
    emitDag("workflow_dag.run_resumed", { runId, resumedCount, skipped: [...effByNode.keys()] });
  }

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

  // ── §4.6 补偿反向序（R4·出站经 S2·不可逆诚实 COMPENSATED=false）─────────────────────────
  let compensationVerdict: DagRunStatus | null = null;
  const runCompensation = async (): Promise<void> => {
    await persist("COMPENSATING", null);
    emitDag("workflow_dag.compensating", { runId });
    const doneOrder = Object.keys(state.stepOutputs); // 完成插入序
    const reversed = [...doneOrder].reverse(); // 反向拓扑序
    let allOk = true;
    for (const nodeId of reversed) {
      const comp = (input.compensations ?? []).find((c) => c.forNode === nodeId);
      if (!comp) continue;
      if (comp.kind === "NOOP") {
        status.set(nodeId, "COMPENSATED");
        emitDag("workflow_dag.compensated", { runId, nodeId, kind: "NOOP", compensated: true });
        continue;
      }
      // REVERSING_ACTION / CUSTOM：反向动作**必经 S2 Action 审批**（R4·绝不静默反转真实效果）。
      if (!input.compensate) {
        allOk = false; // 无补偿钩子（不可逆/未接线）→ 诚实记录 false（不伪装已补偿）。
        emitDag("workflow_dag.compensated", {
          runId,
          nodeId,
          kind: comp.kind,
          compensated: false,
          reason: comp.reason ?? "no compensate hook (irreversible outbound effect)",
        });
        continue;
      }
      const res = await input.compensate({ nodeId, action: comp, stepOutputs: state.stepOutputs });
      if (res.compensated) status.set(nodeId, "COMPENSATED");
      else allOk = false;
      emitDag("workflow_dag.compensated", {
        runId,
        nodeId,
        kind: comp.kind,
        compensated: res.compensated,
        reason: res.detail ?? comp.reason,
      });
    }
    // 全可逆步补偿成功 → COMPENSATED；有不可逆步 → FAILED（诚实·不伪装全补偿）。
    compensationVerdict = allOk ? "COMPENSATED" : "FAILED";
  };

  const handleFailure = async (fail: { nodeId: string }): Promise<void> => {
    const node = nodeById.get(fail.nodeId);
    const trigger = onErrorOf(node) === "COMPENSATE" || input.rollbackOnFailure === true;
    if (trigger && (input.compensations?.length ?? 0) > 0) {
      await runCompensation();
      await persist(compensationVerdict ?? "FAILED", now());
    } else {
      await persist("FAILED", now());
    }
  };

  // ── 拓扑波次调度循环（Kahn·就绪并发）─────────────────────────────────────
  await persist("RUNNING", null); // 初始 run 快照（存在即可续跑·resume 亦重落 resumedCount）。
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
    let firstFail: { code: string; message: string; stepId: string; nodeId: string } | null = null;
    for (const { n, outcome, effects } of results) {
      mergeStepEffects(state, n.nodeId, effects, deps);
      nodeEffects.set(n.nodeId, effects); // durable per-node checkpoint 素材
      attemptsByNode.set(n.nodeId, effects.attempts);
      if (effects.attempts > 1) emitDag("workflow_dag.step_retry", { runId, nodeId: n.nodeId, attempts: effects.attempts });
      if (outcome.kind === "ANSWER") {
        status.set(n.nodeId, "DONE");
        if (!terminal) terminal = await finalizeAnswer(deps, wfInput, state, outcome.answer);
      } else if (outcome.kind === "FAILED") {
        status.set(n.nodeId, "FAILED");
        nodeError.set(n.nodeId, { code: outcome.code, message: outcome.message, retryable: false });
        if (!firstFail) firstFail = { code: outcome.code, message: outcome.message, stepId: outcome.stepId, nodeId: n.nodeId };
      } else if (outcome.kind === "SKIPPED") {
        status.set(n.nodeId, "SKIPPED");
      } else {
        status.set(n.nodeId, "DONE");
      }
    }

    // durable：本波次后落 checkpoint（node 状态 + per-node effects + stepOutputs 快照·§4.4）。
    await persist("RUNNING", null);
    emitDag("workflow_dag.checkpoint_saved", {
      runId,
      done: nodes.filter((n) => status.get(n.nodeId) === "DONE").map((n) => n.nodeId),
    });

    // 真崩溃模拟（stopAfterNode DONE 且已落 checkpoint → 抛中断·run 留 RUNNING·可续跑·C1）。
    if (input.stopAfterNode && status.get(input.stopAfterNode) === "DONE") {
      throw new WorkflowDagInterrupted(runId ?? "", input.stopAfterNode);
    }

    // FAIL 先于 ANSWER（对齐串行"首个失败即终止"·纯线性单节点波次下二者互斥）。
    if (firstFail) {
      await handleFailure(firstFail);
      return finalizeFailed(state, firstFail.code, firstFail.message, firstFail.stepId);
    }
    if (terminal) {
      await persist("COMPLETED", now());
      return terminal;
    }
  }

  // 无 render_answer 终态叶（standalone workflow）：合成完成摘要（与串行 fallback 逐字节等价）。
  const done = await finalizeAnswer(deps, wfInput, state, {
    trustLevel,
    blocks: [{ type: "text", markdown: "工作流执行完成。" }],
    provenance: [],
    unverifiedNumerics: false,
  });
  await persist("COMPLETED", now());
  return done;
}

/**
 * resumeWorkflowDag：崩溃续跑（§4.4·移植 BuildWorkflowEngine.resume）。
 * 载入落库 run 快照 → 跳过 DONE 节点（回灌 checkpoint/stepOutputs）→ 从当前就绪集重驱动 →
 * resumedCount++ → emit workflow_dag.run_resumed。续跑答案与未中断跑逐字节等价（R6·步确定性 + 快照态完备）。
 * 薄封装 runWorkflowDag（resumeFrom 分支承载全部续跑逻辑）——统一执行核·零重造。
 */
export async function resumeWorkflowDag(
  deps: WorkflowRunDeps,
  input: WorkflowDagRunInput & { resumeFrom: WorkflowDagRun },
): Promise<WorkflowResult> {
  return runWorkflowDag(deps, input);
}
