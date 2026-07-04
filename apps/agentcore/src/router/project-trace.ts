import type {
  Answer,
  ExecutionPlan,
  Handoff,
  InferenceCmpRow,
  InferenceNode,
  InferenceTrace,
  PlanStep,
  QueryTask,
} from "@platform/contracts";
import { SKELETON_EDGES, SKELETON_NODES, type SkeletonNode } from "./orchestration-skeleton.js";

/**
 * 编排推演 DAG 投影（PRD-IND-story §4.3）——本 PRD 核心工程。
 *
 * 把一次**真实 QueryTask 运行**确定性投影（R6）为 HTML 同构的 10 节点编排 DAG。
 * 纯派生（R13 不新增真值）：只读 task / plan / toolCalls / gapFindings / answer，
 * 不调网络、不依赖时钟随机性。同输入 → 字节级一致输出。
 *
 * 诚实降级：无匹配真实步骤的骨架节点 → status:"pending"（"本次未执行该步"），绝不伪造 done。
 * 缺口接线：gapFindings[].atStep → 对应节点 status:"gap" + gapCode。
 */

/** 投影所需的工具调用最小形状（结构兼容 persistence/repos ToolCallRow）。 */
export interface TraceToolCall {
  toolName: string;
  input?: unknown;
  outcome: "OK" | "DENIED" | "ERROR" | "BUDGET_EXCEEDED";
}

/** 投影所需的缺口发现最小形状（结构兼容 GapReport.findings[]）。 */
export interface TraceGapFinding {
  gapCode: string;
  atStep?: string;
  blocking?: boolean;
}

export interface TraceGapInput {
  verdict?: "ANSWERABLE" | "BLOCKED" | "BOUNDARY";
  findings: TraceGapFinding[];
}

/** §4.3：PlanStep.type → 命中的骨架节点 ordinal（1..10）。多步同 type 折叠进同节点。 */
const STEP_TYPE_TO_NODE: Record<PlanStep["type"], number> = {
  resolve_slice: 2, // ② 检索切片
  query_objects: 3, // ③ 装载因子（因子类对象查询）
  invoke_solver: 4, // ④⑤⑥ 求解器（按 solverKey 细分，见 solverNodeFor）
  evaluate_rules: 8, // ⑧ 校验解释
  llm_compose: 7, // ⑦ 方案比对
  render_answer: 9, // ⑨ 写回行动（渲染最终答案块）
  create_action_draft: 9, // ⑨ 写回行动
  invoke_agent: 7, // ⑦ 方案比对（解释校验/编排 Agent）
  invoke_mcp_tool: 6, // ⑥ 情景推演（外部工具近似）
};

/**
 * invoke_solver 的 solverKey → 节点细分（④聚合 / ⑤瓶颈 / ⑥情景）。
 * 关键字启发式（确定性）：未命中关键字时归 ④ 聚合（首个求解节点）。
 */
function solverNodeFor(solverKey: string): number {
  const k = solverKey.toLowerCase();
  if (/bottleneck|瓶颈|min_?cut|根因/.test(k)) return 5;
  if (/scenario|counterfactual|情景|simulate|plan_?gen|risk_?timeline|forecast_?scenario/.test(k)) return 6;
  return 4; // capacity_rollup / aggregate / 默认聚合
}

/** 把 atStep（stepId / classify / routing / render …）映射到节点 ordinal。 */
function nodeForAtStep(atStep: string | undefined, plan: ExecutionPlan | undefined): number | undefined {
  if (!atStep) return undefined;
  const s = atStep.toLowerCase();
  if (/classify|intent/.test(s)) return 1;
  if (/routing/.test(s)) return 1;
  if (/render/.test(s)) return 9;
  // stepId → 查 plan 步骤类型
  const step = plan?.steps.find((st) => st.id === atStep);
  if (step) return nodeForStep(step);
  return undefined;
}

function nodeForStep(step: PlanStep): number {
  if (step.type === "invoke_solver") return solverNodeFor(step.params.solverKey);
  return STEP_TYPE_TO_NODE[step.type];
}

/** 步骤真实引用的数据/求解器/agent（真血缘，来自 plan 步骤入参；无则空）。 */
function stepData(step: PlanStep): { data: string[]; solvers: string[]; agents: string[] } {
  switch (step.type) {
    case "resolve_slice":
      return { data: [`切片:${step.params.sliceKey}`], solvers: [], agents: [] };
    case "query_objects":
      return { data: [`对象:${step.params.objectType}`], solvers: [], agents: [] };
    case "invoke_solver":
      return { data: [], solvers: [step.params.solverKey], agents: [] };
    case "evaluate_rules": {
      const ids = step.params.ruleIds;
      return { data: ids === "ALL_APPLICABLE" ? ["规则:ALL_APPLICABLE"] : ids.map((r) => `规则:${r}`), solvers: [], agents: [] };
    }
    case "create_action_draft":
      return { data: [`Action:${step.params.actionType}`], solvers: [], agents: [] };
    case "invoke_mcp_tool":
      return { data: [`MCP:${step.params.toolName}`], solvers: [], agents: [] };
    case "invoke_agent":
      // 真 agent 血缘：该步真实调用的 agentId（非骨架叙述名）。
      return { data: [], solvers: [], agents: [`Agent:${step.params.agentId}`] };
    default:
      return { data: [], solvers: [], agents: [] };
  }
}

const dedupe = (xs: string[]): string[] => [...new Set(xs)];

/** AGENT 路径：toolName 近似映射到节点（无精确 PlanStep）。 */
function nodeForToolName(toolName: string): number | undefined {
  const t = toolName.toLowerCase();
  if (/resolve_slice|slice/.test(t)) return 2;
  if (/query_objects|query_timeseries|search_knowledge/.test(t)) return 3;
  if (/invoke_solver|solver|rollup|forecast/.test(t)) {
    if (/bottleneck|瓶颈/.test(t)) return 5;
    if (/scenario|counterfactual|情景|risk/.test(t)) return 6;
    return 4;
  }
  if (/evaluate_rules|rule/.test(t)) return 8;
  if (/llm_compose|compose|invoke_agent|agent/.test(t)) return 7;
  if (/mcp/.test(t)) return 6;
  if (/render|answer/.test(t)) return 9;
  if (/create_action_draft|action/.test(t)) return 9;
  return undefined;
}

/**
 * AGENT 路径真血缘：把真实调用的 toolName 归入 data/solvers/agents 桶（真值，非骨架叙述名）。
 * 求解类工具 → solvers；agent 类 → agents；其余 → data。tenant/industry-agnostic（R14）。
 */
function toolLineage(toolName: string): { data: string[]; solvers: string[]; agents: string[] } {
  const t = toolName.toLowerCase();
  if (/solver|rollup|bottleneck|scenario|forecast|counterfactual|求解|瓶颈|情景/.test(t)) {
    return { data: [], solvers: [toolName], agents: [] };
  }
  if (/agent/.test(t)) return { data: [], solvers: [], agents: [toolName] };
  return { data: [`工具:${toolName}`], solvers: [], agents: [] };
}

const isFailOutcome = (o: TraceToolCall["outcome"]): boolean => o === "ERROR" || o === "BUDGET_EXCEEDED";

export function projectTrace(
  task: QueryTask,
  plan: ExecutionPlan | undefined,
  toolCalls: TraceToolCall[],
  gap: TraceGapInput | undefined,
  answer: Answer | undefined,
  handoffs: Handoff[] = [],
): InferenceTrace {
  const path = task.path ?? "NONE";

  // 每节点累积命中的步骤 id / data / solvers，以及"是否真实执行过"。
  type Acc = { done: boolean; running: boolean; failed: boolean; stepIds: string[]; data: string[]; solvers: string[]; agents: string[] };
  const acc = new Map<number, Acc>();
  const ensure = (id: number): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = { done: false, running: false, failed: false, stepIds: [], data: [], solvers: [], agents: [] };
      acc.set(id, a);
    }
    return a;
  };

  // ① 解析场景：分类存在 → done（两路径通用）。
  if (task.classification) {
    const a = ensure(1);
    a.done = true;
    if (task.matchedIntent?.intentKey) a.data.push(`意图:${task.matchedIntent.intentKey}`);
  }

  // WO-C AGENT-HANDOFF-OBJECT：本次真实发生的 agent 交接（scene→universal 回落等）→ 在①解析/路由节点
  // 标注交接血缘（谁→谁·真持久 agent id），使推演 DAG 该节点显式显示"交接"（诚实：无交接则不标）。
  for (const h of handoffs) {
    const a = ensure(1);
    a.done = true;
    a.agents.push(`交接:${h.fromAgentId}→${h.toAgentId}`);
  }

  if (path === "WORKFLOW" && plan) {
    // 精确投影：plan.steps × toolCalls（toolName = step.type，按出现顺序对齐同 type）。
    const callsByType = new Map<string, TraceToolCall[]>();
    for (const c of toolCalls) {
      const arr = callsByType.get(c.toolName) ?? [];
      arr.push(c);
      callsByType.set(c.toolName, arr);
    }
    const cursor = new Map<string, number>();
    for (const step of plan.steps) {
      const nodeId = nodeForStep(step);
      const a = ensure(nodeId);
      a.stepIds.push(step.id);
      const sd = stepData(step);
      a.data.push(...sd.data);
      a.solvers.push(...sd.solvers);
      a.agents.push(...sd.agents);
      // 对齐该 type 的第 i 个 toolCall 看 outcome。
      const idx = cursor.get(step.type) ?? 0;
      cursor.set(step.type, idx + 1);
      const call = callsByType.get(step.type)?.[idx];
      if (call) {
        if (isFailOutcome(call.outcome)) a.failed = true;
        else a.done = true;
      } else {
        // 计划有该步但无 toolCall 记录（未执行到/早失败）→ 标记 running（执行中断点）。
        a.running = true;
      }
    }
  } else if (path === "AGENT") {
    // 近似投影：toolCalls 序列 → 节点。
    for (const c of toolCalls) {
      const nodeId = nodeForToolName(c.toolName);
      if (nodeId === undefined) continue;
      const a = ensure(nodeId);
      a.stepIds.push(c.toolName);
      const tl = toolLineage(c.toolName);
      a.data.push(...tl.data);
      a.solvers.push(...tl.solvers);
      a.agents.push(...tl.agents);
      if (isFailOutcome(c.outcome)) a.failed = true;
      else a.done = true;
    }
  }

  // 答案存在 → ⑦校验/⑨写回 视为达成（渲染了答案块）。
  if (answer) {
    if (answer.blocks.some((b) => b.type === "action_draft")) ensure(9).done = true;
  }

  // 缺口接线：findings[].atStep → 节点 gap。
  const gapByNode = new Map<number, { gapCode: string; atStep?: string }>();
  for (const f of gap?.findings ?? []) {
    const nodeId = nodeForAtStep(f.atStep, plan);
    if (nodeId !== undefined) gapByNode.set(nodeId, { gapCode: f.gapCode, atStep: f.atStep });
  }

  // ⑦节点：候选方案比对表（仅当 answer 含 table 块映射为候选集时）。诚实：无结构则不渲染。
  const cmp = answer ? extractCmp(answer) : undefined;

  const nodes: InferenceNode[] = SKELETON_NODES.map((skel: SkeletonNode) => {
    const a = acc.get(skel.id);
    const gapHit = gapByNode.get(skel.id);
    let status: InferenceNode["status"];
    if (gapHit) status = "gap";
    else if (a?.failed) status = "gap";
    else if (a?.done) status = "done";
    else if (a?.running) status = "running";
    else status = "pending";

    return {
      id: skel.id,
      ordinal: skel.id,
      label: skel.label,
      shortLabel: skel.shortLabel,
      kind: skel.kind,
      rank: skel.rank,
      row: skel.row,
      in: skel.in,
      proc: skel.proc,
      out: skel.out,
      // 血缘诚实（R14·簇F 治本）：只发真实 trace 派生的数据/求解器/agent；
      // 真 lineage 缺失 → 空数组（前端显"本次未记录来源"），绝不回退骨架电池常数冒充真血缘。
      data: a && a.data.length ? dedupe(a.data) : [],
      solvers: a && a.solvers.length ? dedupe(a.solvers) : [],
      agents: a && a.agents.length ? dedupe(a.agents) : [],
      status,
      gapCode: gapHit?.gapCode,
      atStep: gapHit?.atStep,
      stepIds: a ? dedupe(a.stepIds) : [],
      ...(skel.id === 7 && cmp && cmp.length ? { cmp } : {}),
    };
  });

  return {
    taskId: task.id,
    scenario: task.query,
    path,
    verdict: gap?.verdict,
    nodes,
    edges: SKELETON_EDGES.map((e) => ({ ...e })),
    // WO-C：一等交接记录随 DAG 投影透出，前端渲染交接节点（谁→谁·带什么槽位/证据·为何）。诚实：无交接 → []。
    handoffs: handoffs.map((h) => ({ ...h })),
  };
}

/**
 * 从 Answer 抽取候选方案比对集（⑦节点 cmp）。诚实边界：只有当答案确含
 * 7 列形状的 table 块（方案/瓶颈/产能/缺口/投入/交期/风险）才渲染，否则返回 undefined——
 * 绝不写死 HTML 的 5 行示例（R14）。
 */
function extractCmp(answer: Answer): InferenceCmpRow[] | undefined {
  for (const b of answer.blocks) {
    if (b.type !== "table") continue;
    if (b.columns.length < 7) continue;
    const head = b.columns.map((c) => String(c));
    const looksLikeCmp = head.some((c) => /方案/.test(c)) && head.some((c) => /瓶颈/.test(c));
    if (!looksLikeCmp) continue;
    const rows: InferenceCmpRow[] = b.rows.map((r) => ({
      n: str(r[0]),
      bn: str(r[1]),
      cap: str(r[2]),
      gap: str(r[3]),
      cost: str(r[4]),
      due: str(r[5]),
      risk: str(r[6]),
    }));
    return rows.length ? rows : undefined;
  }
  return undefined;
}

const str = (v: unknown): string => (v == null ? "" : String(v));
