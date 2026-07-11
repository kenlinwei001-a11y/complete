import { z } from "zod";
import { PlanStepSchema, type PlanStep, type ExecutionPlan } from "./qos.js"; // ★ 复用现有 9 类步判别联合（additive 核心·执行器派发零改）
import { IsoTime } from "./common.js";

// ═══════════════════════════════════════════════════════════════════════════
// L1-B · ExecutionGraph 契约（脊柱地基·WO-L1B-1·纯契约 + 线性 lift·无接线）
// PRD: docs/PRD-L1B-execution-planner-workflow-runtime.md §3
// R1 contracts-only-shared · R2 tenant everywhere · R6 确定性（无 Date.now/随机/LLM）
// · R13 可溯源（节点带 source/sourceGraphId）。TaskNode 内嵌复用 PlanStep（执行器派发零改）。
// ═══════════════════════════════════════════════════════════════════════════

// ── Task 节点分类（Ch10.4 Task Type·咨询性·映射到内嵌 PlanStep）─────────────
export const TaskNodeKindSchema = z.enum([
  "DATA_QUERY", // query_objects / resolve_slice / query_timeseries_agg / search_knowledge
  "FEATURE_BUILD", // 派生特征（现多由 solver 内联·预留）
  "RULE_EXECUTE", // evaluate_rules
  "MODEL_RUN", // invoke_agent（能力节点·Ch10.9）
  "SOLVER_RUN", // invoke_solver（Ch10.13 Solver Orchestration）
  "SIMULATION", // invoke_solver（仿真类·Monte Carlo）
  "REPORT_GENERATE", // render_answer / llm_compose
  "MCP_CALL", // invoke_mcp_tool
  "ACTION_DRAFT", // create_action_draft（出站·补偿有关·R4）
]);
export type TaskNodeKind = z.infer<typeof TaskNodeKindSchema>;

// ── 确定性守卫表达式（Gateway/Transition 条件·R6·无 LLM）──────────────────
export const GuardExprSchema = z.object({
  /** 引用前驱步输出（复用现模板语法·executor.ts:123）。 */
  ref: z.string(), // "{{steps.<nodeId>.output.data.<path>}}"
  op: z.enum(["EQ", "NE", "LT", "LE", "GT", "GE", "EXISTS", "RULE_PASSED", "RULE_BLOCKED"]),
  value: z.union([z.string(), z.number(), z.boolean()]).nullable().default(null),
});
export type GuardExpr = z.infer<typeof GuardExprSchema>;

// ── 步级重试策略（簇① V2-3-164·镜像 BuildWorkflowStep attempts/maxAttempts）──
export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(5).default(1),
  backoffMs: z.number().int().min(0).default(0), // 墙钟·排除出 R6 哈希
  /** 仅这些错误码可重试（缺省=RetryableStepError 语义·align execution.ts FAILED_RETRYABLE）。 */
  retryableErrors: z.array(z.string()).optional(),
  /** 幂等标记：false=不可重试（如 create_action_draft·出站非幂等）。 */
  idempotent: z.boolean().default(true),
});
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

// ── 补偿动作（簇① V2-2-030/031·Ch48.18）─────────────────────────────────
export const CompensationActionSchema = z.object({
  forNode: z.string(), // 被补偿的 nodeId
  kind: z.enum(["NOOP", "REVERSING_ACTION", "CUSTOM"]), // 只读步=NOOP；出站=REVERSING_ACTION（经 S2·R4）
  /** REVERSING_ACTION/CUSTOM 的反向步（内嵌 PlanStep·如 create_action_draft 的撤销草案）。 */
  step: PlanStepSchema.optional(),
  reason: z.string().optional(), // R13：为何/如何补偿
});
export type CompensationAction = z.infer<typeof CompensationActionSchema>;

// ── Task 节点（执行最小单元·Ch10.4·内嵌复用 PlanStep）─────────────────────
export const TaskNodeSchema = z.object({
  nodeId: z.string(), // node_
  kind: TaskNodeKindSchema, // 咨询分类（映射内嵌步）
  /** ★ 内嵌现有 PlanStep（执行器整条 switch 派发零改·additive 核心）。 */
  step: PlanStepSchema,
  /** 前驱依赖（Ch10.11：dependsOn 内含 A 表示"本节点依赖 A"·拓扑序来源）。 */
  dependsOn: z.array(z.string()).default([]),
  retry: RetryPolicySchema.optional(),
  onError: z.enum(["FAIL", "SKIP", "COMPENSATE"]).default("FAIL"), // 扩现 OnError（qos.ts:100）+ COMPENSATE
  /** R13 溯源：节点从需求图哪推来（"rg:solver:bottleneck" / "rg:data:capacity_rollup" / "rg:render"）。 */
  source: z.string(),
  /** Skill/Agent 指派（Ch10.8/10.9·择优结果·可空）。 */
  assignedSkillId: z.string().nullable().default(null),
  assignedAgentId: z.string().nullable().default(null),
  props: z.record(z.string(), z.unknown()).optional(),
});
export type TaskNode = z.infer<typeof TaskNodeSchema>;

// ── 显式转移边（Gateway 路由用·dependsOn 之外的条件边）─────────────────────
export const TransitionSchema = z.object({
  from: z.string(), // nodeId | gatewayId
  to: z.string(), // nodeId | gatewayId
  condition: GuardExprSchema.nullable().default(null), // 空=无条件（等价 dependsOn 边）
});
export type Transition = z.infer<typeof TransitionSchema>;

// ── 网关（簇① V2-2-025·条件分支/并行分叉·非 BPMN 标准·NG3）─────────────────
export const GatewaySchema = z.object({
  gatewayId: z.string(), // gw_
  kind: z.enum(["EXCLUSIVE", "PARALLEL", "INCLUSIVE"]), // XOR 择一 / AND 全分叉 / OR 多选
  /** 分支：命中 condition 的 to 被激活；EXCLUSIVE 取首个命中；未命中分支节点标 SKIPPED。 */
  branches: z.array(z.object({ condition: GuardExprSchema.nullable(), to: z.string() })).min(1),
  /** 无分支命中时的兜底 to（EXCLUSIVE·可空=不激活任何）。 */
  default: z.string().nullable().default(null),
});
export type Gateway = z.infer<typeof GatewaySchema>;

// ── 执行图 IR（Ch10.3：Task Graph + Dependency Graph + Resource Graph）──────
export const ExecutionGraphSchema = z.object({
  graphId: z.string(), // eg_
  taskId: z.string(),
  tenantId: z.string(),
  /** R13：源需求图（L1-A 产物·可溯源"从哪个需求综合来"）。 */
  sourceGraphId: z.string().nullable(),
  intentKey: z.string().nullable(),
  nodes: z.array(TaskNodeSchema).min(1),
  transitions: z.array(TransitionSchema).default([]),
  gateways: z.array(GatewaySchema).default([]),
  entryNodes: z.array(z.string()).min(1), // 入度 0 起点（Kahn 起始就绪集）
  compensations: z.array(CompensationActionSchema).default([]),
  /** Ch9.10 覆盖分（咨询·≥0.8 可执行·<0.8 规划器回落模板·复用 L0-SOLVER-COVERAGE / RG coverageScore）。 */
  coverageScore: z.number().min(0).max(1),
  /** Ch10.13 多求解器编排 + Ch10.14 多目标向量（[DeliveryRate,-Cost,-Carbon,-SwitchCount]·喂 solver args）。 */
  objectiveVector: z.array(z.string()).default([]),
  plannerVersion: z.string(), // R6 可重放钉版
  generatedAt: IsoTime, // 调用方注入（内部不取时钟·R6）
});
export type ExecutionGraph = z.infer<typeof ExecutionGraphSchema>;

// ── 运行态（durable·镜像 BuildWorkflowRun/BuildWorkflowStep databuilder.ts:363/344）──
export const DagNodeStatusSchema = z.enum([
  "PENDING",
  "READY",
  "RUNNING",
  "DONE",
  "FAILED",
  "SKIPPED",
  "COMPENSATED",
]);
export type DagNodeStatus = z.infer<typeof DagNodeStatusSchema>;
export const WorkflowDagNodeStateSchema = z.object({
  nodeId: z.string(),
  status: DagNodeStatusSchema,
  attempts: z.number().int().default(0),
  maxAttempts: z.number().int().default(1),
  /** 步产出快照（续跑基线·= 现 stepOutputs[stepId]）。 */
  checkpoint: z.record(z.string(), z.unknown()).optional(),
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).optional(),
});
export type WorkflowDagNodeState = z.infer<typeof WorkflowDagNodeStateSchema>;
/** Ch48.9 状态机：Created→Running→Waiting→Suspended→Completed→Failed（+ 补偿态）。 */
export const DagRunStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "WAITING",
  "SUSPENDED",
  "COMPLETED",
  "FAILED",
  "COMPENSATING",
  "COMPENSATED",
]);
export type DagRunStatus = z.infer<typeof DagRunStatusSchema>;
export const WorkflowDagRunSchema = z.object({
  runId: z.string(), // wfr_
  taskId: z.string(),
  tenantId: z.string(),
  graphId: z.string(),
  status: DagRunStatusSchema,
  nodes: z.array(WorkflowDagNodeStateSchema),
  /** 全局 stepOutputs 快照（续跑/补偿的状态基线·按 nodeId 键·与并行时序无关·R6）。 */
  stepOutputs: z.record(z.string(), z.unknown()).default({}),
  resumedCount: z.number().int().default(0), // 镜像 BuildWorkflowRun.resumedCount
  startedAt: IsoTime,
  updatedAt: IsoTime,
  completedAt: IsoTime.nullable().default(null),
});
export type WorkflowDagRun = z.infer<typeof WorkflowDagRunSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// 步类型 ↔ 节点分类映射（确定性·R6·零业务魔数）
// ═══════════════════════════════════════════════════════════════════════════

/** 现 PlanStep 判别联合的全部 9 类步类型（qos.ts:105·单一来源·防幽灵步）。 */
export const PLAN_STEP_TYPES = [
  "resolve_slice",
  "query_objects",
  "invoke_solver",
  "evaluate_rules",
  "llm_compose",
  "render_answer",
  "create_action_draft",
  "invoke_agent",
  "invoke_mcp_tool",
] as const;
export type PlanStepType = (typeof PLAN_STEP_TYPES)[number];

/** 步类型 → TaskNode.kind（咨询分类·§3 注释映射·确定性）。 */
export const STEP_TYPE_TO_NODE_KIND: Record<PlanStepType, TaskNodeKind> = {
  resolve_slice: "DATA_QUERY",
  query_objects: "DATA_QUERY",
  invoke_solver: "SOLVER_RUN",
  evaluate_rules: "RULE_EXECUTE",
  llm_compose: "REPORT_GENERATE",
  render_answer: "REPORT_GENERATE",
  create_action_draft: "ACTION_DRAFT",
  invoke_agent: "MODEL_RUN",
  invoke_mcp_tool: "MCP_CALL",
};

// ═══════════════════════════════════════════════════════════════════════════
// back-compat lift（§2.1 parity 基石·纯函数·无随机/时钟·R6）
// ═══════════════════════════════════════════════════════════════════════════

/** R6：lift 默认注入的确定性 generatedAt（调用方可覆盖·内部绝不取时钟）。 */
export const LIFT_EPOCH = "1970-01-01T00:00:00.000Z";
export const LIFT_PLANNER_VERSION = "lift-linear-v1";

export interface LiftOptions {
  tenantId?: string;
  taskId?: string;
  generatedAt?: string;
  plannerVersion?: string;
  intentKey?: string | null;
  sourceGraphId?: string | null;
}

/**
 * fromLinearPlan：线性 ExecutionPlan → ExecutionGraph（线性 lift·R6·无随机/时钟）。
 * steps[i] → TaskNode{ nodeId:step.id, dependsOn:[steps[i-1].id] } 链；无 gateway；
 * entryNodes=[steps[0].id]；coverageScore=1；source="lift:linear"。
 * §2.1 parity 基石：纯线性图经 DAG 执行器退化为插入序 = 旧串行序（逐字节等价）。
 */
export function fromLinearPlan(plan: ExecutionPlan, opts: LiftOptions = {}): ExecutionGraph {
  const steps = plan.steps;
  const nodes: TaskNode[] = steps.map((step, i) => {
    const stepOnError =
      "onError" in step && step.onError !== undefined ? (step.onError as "FAIL" | "SKIP") : "FAIL";
    return {
      nodeId: step.id,
      kind: STEP_TYPE_TO_NODE_KIND[step.type as PlanStepType],
      step,
      dependsOn: i === 0 ? [] : [steps[i - 1]!.id],
      onError: stepOnError,
      source: "lift:linear",
      assignedSkillId: null,
      assignedAgentId: null,
    };
  });
  return {
    graphId: `eg_lift_${plan.id}`,
    taskId: opts.taskId ?? "",
    tenantId: opts.tenantId ?? "",
    sourceGraphId: opts.sourceGraphId ?? null,
    intentKey: opts.intentKey ?? plan.key ?? null,
    nodes,
    transitions: [],
    gateways: [],
    entryNodes: [steps[0]!.id],
    compensations: [],
    coverageScore: 1,
    objectiveVector: [],
    plannerVersion: opts.plannerVersion ?? LIFT_PLANNER_VERSION,
    generatedAt: opts.generatedAt ?? LIFT_EPOCH,
  };
}

/**
 * toLinearSteps：纯链 ExecutionGraph（单前驱链·无 gateway）→ PlanStep[]（拓扑序还原）。
 * 用于 §7 V6 parity 与门 workflow-dag:check 的往返无损自证：
 *   toLinearSteps(fromLinearPlan(p)) ≡ p.steps。
 * 非纯链（含 gateway / 多前驱 / 分叉）→ 抛错（诚实·绝不静默降级）。
 */
export function toLinearSteps(graph: ExecutionGraph): PlanStep[] {
  if (graph.gateways.length > 0) {
    throw new Error("toLinearSteps: graph 含 gateway，非纯链，无法线性还原");
  }
  const byId = new Map<string, TaskNode>();
  for (const n of graph.nodes) {
    if (byId.has(n.nodeId)) throw new Error(`toLinearSteps: 重复 nodeId "${n.nodeId}"`);
    byId.set(n.nodeId, n);
  }
  // 后继表（据 dependsOn 反向）：单前驱链要求每节点 ≤1 前驱、每节点 ≤1 后继。
  const successors = new Map<string, string[]>();
  const roots: string[] = [];
  for (const n of graph.nodes) {
    if (n.dependsOn.length > 1) {
      throw new Error(`toLinearSteps: 节点 "${n.nodeId}" 有 ${n.dependsOn.length} 个前驱，非纯链`);
    }
    if (n.dependsOn.length === 0) {
      roots.push(n.nodeId);
    } else {
      const pred = n.dependsOn[0]!;
      if (!byId.has(pred)) throw new Error(`toLinearSteps: 悬空前驱 "${pred}"`);
      const arr = successors.get(pred) ?? [];
      arr.push(n.nodeId);
      successors.set(pred, arr);
    }
  }
  if (roots.length !== 1) {
    throw new Error(`toLinearSteps: 期望唯一起点，实得 ${roots.length}（非纯链）`);
  }
  const ordered: PlanStep[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = roots[0];
  while (cur !== undefined) {
    if (seen.has(cur)) throw new Error(`toLinearSteps: 检出环 @ "${cur}"`);
    seen.add(cur);
    ordered.push(byId.get(cur)!.step);
    const succ = successors.get(cur) ?? [];
    if (succ.length > 1) {
      throw new Error(`toLinearSteps: 节点 "${cur}" 有 ${succ.length} 个后继，非纯链`);
    }
    cur = succ[0];
  }
  if (ordered.length !== graph.nodes.length) {
    throw new Error(
      `toLinearSteps: 链覆盖 ${ordered.length}/${graph.nodes.length} 节点（存在游离子图·非纯链）`,
    );
  }
  return ordered;
}

/** 往返无损自证（门 workflow-dag:check ④·纯函数·R6）。 */
export function isLiftReversible(plan: ExecutionPlan, opts: LiftOptions = {}): boolean {
  try {
    const round = toLinearSteps(fromLinearPlan(plan, opts));
    return JSON.stringify(round) === JSON.stringify(plan.steps);
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ExecutionGraph 不变量校验器（门 workflow-dag:check 引擎·纯函数·牙齿自证）
// ①DAG 无环 ②step.type ∈ PLAN_STEP_TYPES（不引幽灵步）③引用完整（dependsOn/
// transition/gateway/entryNodes 指向真节点）④entryNodes = 入度0 集 ⑤（可选）
// solverKey ∈ 白名单 / sliceKey ∈ 白名单（gate 从 datacore 注册表注入）。
// ═══════════════════════════════════════════════════════════════════════════

export interface GraphValidationOptions {
  /** 合法 solverKey 白名单（invoke_solver 节点·gate 从 SOLVER_REGISTRY 注入·缺省不校验）。 */
  solverKeys?: ReadonlySet<string>;
  /** 合法 sliceKey 白名单（resolve_slice 节点·缺省不校验）。 */
  sliceKeys?: ReadonlySet<string>;
}
export interface GraphValidationResult {
  ok: boolean;
  errors: string[];
}

const PLAN_STEP_TYPE_SET: ReadonlySet<string> = new Set<string>(PLAN_STEP_TYPES);

/**
 * validateExecutionGraph：静态守 ExecutionGraph 契约不变量（纯函数·R6·无 IO）。
 * 宽容入参以便门注入非法图自证（幽灵步/环 zod 未必挡）。
 */
export function validateExecutionGraph(
  graph: ExecutionGraph,
  opts: GraphValidationOptions = {},
): GraphValidationResult {
  const errors: string[] = [];
  const nodes = graph.nodes ?? [];
  const nodeIds = new Set<string>();
  for (const n of nodes) {
    if (nodeIds.has(n.nodeId)) errors.push(`重复 nodeId "${n.nodeId}"`);
    nodeIds.add(n.nodeId);
  }
  const gatewayIds = new Set((graph.gateways ?? []).map((g) => g.gatewayId));
  const isRef = (id: string) => nodeIds.has(id) || gatewayIds.has(id);

  // ② step.type ∈ PLAN_STEP_TYPES（不引幽灵步）+ ⑤ solverKey/sliceKey 白名单
  for (const n of nodes) {
    const t = (n.step as { type?: string } | undefined)?.type;
    if (t === undefined || !PLAN_STEP_TYPE_SET.has(t)) {
      errors.push(`节点 "${n.nodeId}" 引用幽灵步类型 "${String(t)}"（∉ PLAN_STEP_TYPES）`);
    }
    if (t === "invoke_solver" && opts.solverKeys) {
      const key = (n.step as { params?: { solverKey?: string } }).params?.solverKey;
      if (key !== undefined && !opts.solverKeys.has(key)) {
        errors.push(`节点 "${n.nodeId}" 引用幽灵 solverKey "${key}"（∉ SOLVER_REGISTRY）`);
      }
    }
    if (t === "resolve_slice" && opts.sliceKeys) {
      const key = (n.step as { params?: { sliceKey?: string } }).params?.sliceKey;
      if (key !== undefined && !opts.sliceKeys.has(key)) {
        errors.push(`节点 "${n.nodeId}" 引用幽灵 sliceKey "${key}"（∉ 白名单）`);
      }
    }
  }

  // ③ 引用完整性
  for (const n of nodes) {
    for (const dep of n.dependsOn ?? []) {
      if (!nodeIds.has(dep)) errors.push(`节点 "${n.nodeId}" 悬空前驱 "${dep}"`);
    }
  }
  for (const tr of graph.transitions ?? []) {
    if (!isRef(tr.from)) errors.push(`transition.from "${tr.from}" 悬空`);
    if (!isRef(tr.to)) errors.push(`transition.to "${tr.to}" 悬空`);
  }
  for (const gw of graph.gateways ?? []) {
    for (const b of gw.branches ?? []) {
      if (!isRef(b.to)) errors.push(`gateway "${gw.gatewayId}" 分支 to "${b.to}" 悬空`);
    }
    if (gw.default != null && !isRef(gw.default)) {
      errors.push(`gateway "${gw.gatewayId}" default "${gw.default}" 悬空`);
    }
  }
  for (const e of graph.entryNodes ?? []) {
    if (!nodeIds.has(e)) errors.push(`entryNode "${e}" 非真节点`);
  }

  // ④ entryNodes = 入度0 集（据 dependsOn）
  const zeroIn = nodes.filter((n) => (n.dependsOn ?? []).length === 0).map((n) => n.nodeId);
  const entrySet = new Set(graph.entryNodes ?? []);
  for (const e of graph.entryNodes ?? []) {
    const node = nodes.find((n) => n.nodeId === e);
    if (node && (node.dependsOn ?? []).length > 0) {
      errors.push(`entryNode "${e}" 入度≠0（有前驱·非合法起点）`);
    }
  }
  for (const z of zeroIn) {
    if (!entrySet.has(z)) errors.push(`入度0 节点 "${z}" 未登记为 entryNode`);
  }

  // ① DAG 无环（Kahn·据 dependsOn 依赖边）
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>(); // pred -> [succ]
  for (const n of nodes) indeg.set(n.nodeId, 0);
  for (const n of nodes) {
    for (const dep of n.dependsOn ?? []) {
      if (!nodeIds.has(dep)) continue; // 悬空已单独报
      adj.set(dep, [...(adj.get(dep) ?? []), n.nodeId]);
      indeg.set(n.nodeId, (indeg.get(n.nodeId) ?? 0) + 1);
    }
  }
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    for (const succ of adj.get(id) ?? []) {
      const d = (indeg.get(succ) ?? 0) - 1;
      indeg.set(succ, d);
      if (d === 0) queue.push(succ);
    }
  }
  if (visited !== nodes.length) {
    errors.push(`检出环（DAG 非法·Kahn 覆盖 ${visited}/${nodes.length} 节点）`);
  }

  return { ok: errors.length === 0, errors };
}
