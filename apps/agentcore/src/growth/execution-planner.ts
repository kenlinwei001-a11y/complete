// ═══════════════════════════════════════════════════════════════════════════
// L1-B · Execution Planner —— synthesizePlan(reqGraph, registries) → ExecutionGraph
// PRD-L1B-execution-planner-workflow-runtime.md §4.1（Ch10.6-10.14 满配）· WO-L1B-4
// ───────────────────────────────────────────────────────────────────────────
// 纯函数（R6·同 (RequirementGraph, 注册表版本) → 字节级同 ExecutionGraph）：
//   无 Date.now / 无 Math.random / 无 LLM / 无 IO（注册表 = 入参·调用方读）。
//   generatedAt / plannerVersion 由调用方注入（内部绝不取时钟）。
//
// 消费 L1-A RequirementGraph **下游投影**（不重造图·NG1）：
//   · sliceTargets.targets  → DATA_QUERY（resolve_slice·入度0·并行前沿·Ch10.12）
//   · solverCandidates[]    → SOLVER_RUN（invoke_solver·串成 depends_on 管线·Ch10.13）
//   · 答案输出              → REPORT_GENERATE（render_answer·扇入终态·复用 G-1 render 投影）
//
// 满配映射：
//   Ch10.6 Task Graph 生成 · Ch10.7 Task Mapping（投影→内嵌 PlanStep 确定性词典）
//   Ch10.8 Skill Match（Ontology×Scenario×HistoricalSuccess×Cost·**历史=中性1.0·NG5 不伪造**）
//   Ch10.9 Agent Assign（能力节点静态角色匹配·无评分公式·仅 MODEL_RUN 节点）
//   Ch10.11 Dependency Resolution（Kahn 拓扑·检出环→回落模板·绝不产非法图）
//   Ch10.12 Parallel（dependsOn 的补即并行集·运行时自动识别）
//   Ch10.13 Solver Orchestration（多求解器管线 depends_on 链）· Ch10.14 Multi-Objective（objectiveVector）
//   Ch9.10 覆盖门（coverageScore<0.8 → 诚实回落模板·永不误红·NG6）
//
// 每节点 ∈ 真注册表（solverKey ∈ SOLVER_REGISTRY / sliceKey ∈ 白名单·复用
//   requirement-graph:check 同源白名单）；越界候选丢弃（不入图）；最终 validateExecutionGraph 兜底。
// ═══════════════════════════════════════════════════════════════════════════

import {
  type AgentDefinition,
  type ExecutionGraph,
  type ExecutionPlan,
  type PlannerDivergence,
  type PlannerShadowRecord,
  type RequirementGraph,
  type SkillDefinition,
  type TaskNode,
  fromLinearPlan,
  validateExecutionGraph,
} from "@platform/contracts";

/** 规划器版本（R6 可重放钉版·随算法变更递增）。 */
export const EXECUTION_PLANNER_VERSION = "exec-planner/1.0.0";

/** Ch9.10 覆盖门下限（<0.8 不综合·诚实回落模板）。 */
export const COVERAGE_THRESHOLD = 0.8;

// ── 注册表（入参·调用方读·synthesizePlan 内不做 IO）──────────────────────────
export interface PlannerRegistries {
  /** 合法 solverKey 白名单（∈ SOLVER_REGISTRY·= L1-A VALID_SOLVER_KEYS·requirement-graph:check 同源）。 */
  validSolverKeys: ReadonlySet<string>;
  /** 合法 sliceKey 白名单（缺省 = 不校验 slice·由最终 validateExecutionGraph 兜底）。 */
  sliceKeys?: ReadonlySet<string>;
  /** 已发布 Skill（Ch10.8 Skill Match·择优·择版由调用方给 PUBLISHED 集）。 */
  skills?: readonly SkillDefinition[];
  /** 已发布 Agent（Ch10.9 Agent Assign·能力节点静态匹配）。 */
  agents?: readonly AgentDefinition[];
  /** 本意图模板计划绑定的 skill key（scenarioMatch 因子·来自 plan.skillRefs 解析）。 */
  boundSkillKeys?: ReadonlySet<string>;
}

export interface SynthesizePlanOptions {
  /** R6：调用方注入生成时刻（内部绝不取时钟）。 */
  generatedAt: string;
  plannerVersion?: string;
  intentKey?: string | null;
  /** Ch9.10 覆盖门下限（缺省 COVERAGE_THRESHOLD）。 */
  coverageThreshold?: number;
  /** 覆盖门 <阈 / 无可综合节点 / 综合非法 → 回落此模板（fromLinearPlan·诚实·绝不产非法图）。 */
  templateFallback?: ExecutionPlan;
}

// ── 确定性小工具（R6·无随机）────────────────────────────────────────────────
function uniqueSorted(xs: readonly string[]): string[] {
  return [...new Set(xs)].sort();
}
function round4(n: number): number {
  return Number(n.toFixed(4));
}
/** multiset a - b（a 中多出 b 的元素·保留重复·排序·确定性）。 */
function multisetDiff(a: readonly string[], b: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const x of b) counts.set(x, (counts.get(x) ?? 0) + 1);
  const out: string[] = [];
  for (const x of [...a].sort()) {
    const c = counts.get(x) ?? 0;
    if (c > 0) counts.set(x, c - 1);
    else out.push(x);
  }
  return out;
}

// ── Ch10.8 Skill Match（乘性打分·任一因子0淘汰·历史中性1.0·NG5）────────────────
export interface SkillScoreFactors {
  /** 本体匹配（Jaccard·节点域 token ∩ skill token·[0,1]）。 */
  ontologyMatch: number;
  /** 场景匹配（skill 绑定本意图=1·未绑定=0.5·弱但不淘汰）。 */
  scenarioMatch: number;
  /** 历史成功（**无学习层前置中性 1.0·诚实·绝不伪造历史分**·NG5）。 */
  historicalSuccess: number;
  /** 成本（无成本模型前中性 1.0·诚实占位·L1.5 演进）。 */
  cost: number;
}
export interface SkillMatchResult {
  skillId: string | null;
  skillKey: string | null;
  score: number;
  factors: SkillScoreFactors;
}

/** 词元化（小写·CJK 逐字 + 拉丁词·确定性）。 */
function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9_]+|[一-龥]/g) ?? []).filter(Boolean);
}
/** skill 的能力 token 集（key + name + methodology.criteria·真结构字段·非臆造）。 */
function skillTokens(skill: SkillDefinition): Set<string> {
  const parts = [skill.key, skill.name, ...(skill.methodology?.criteria ?? [])];
  return new Set(parts.flatMap(tokenize));
}
/** 节点域 token 集（solverKey / sliceKey / problemClass / source·节点真实归属）。 */
function nodeDomainTokens(node: TaskNode, reqGraph: RequirementGraph): Set<string> {
  const parts: string[] = [reqGraph.problemClass, node.source];
  const step = node.step;
  if (step.type === "invoke_solver") parts.push(step.params.solverKey);
  if (step.type === "resolve_slice") parts.push(step.params.sliceKey);
  return new Set(parts.flatMap(tokenize));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function scoreSkill(
  skill: SkillDefinition,
  node: TaskNode,
  reqGraph: RequirementGraph,
  boundSkillKeys?: ReadonlySet<string>,
): SkillMatchResult {
  const ontologyMatch = round4(jaccard(skillTokens(skill), nodeDomainTokens(node, reqGraph)));
  const scenarioMatch = boundSkillKeys?.has(skill.key) ? 1 : 0.5;
  const historicalSuccess = 1.0; // NG5：中性·不伪造历史
  const cost = 1.0; // 无成本模型·中性占位
  const score = round4(ontologyMatch * scenarioMatch * historicalSuccess * cost);
  return { skillId: skill.id, skillKey: skill.key, score, factors: { ontologyMatch, scenarioMatch, historicalSuccess, cost } };
}

/** 择优（乘性任一因子0淘汰·同分按 skillKey 升序 tie-break·R6 确定性）。 */
export function pickBestSkill(
  node: TaskNode,
  skills: readonly SkillDefinition[],
  reqGraph: RequirementGraph,
  boundSkillKeys?: ReadonlySet<string>,
): SkillMatchResult | null {
  let best: SkillMatchResult | null = null;
  for (const s of skills) {
    if (s.status !== "PUBLISHED") continue;
    const r = scoreSkill(s, node, reqGraph, boundSkillKeys);
    if (r.score <= 0) continue; // 乘性淘汰
    if (
      best === null ||
      r.score > best.score ||
      (r.score === best.score && (r.skillKey ?? "") < (best.skillKey ?? ""))
    ) {
      best = r;
    }
  }
  return best;
}

// ── Ch10.9 Agent Assign（能力节点·静态角色匹配·无评分公式·仅 MODEL_RUN）──────────
export interface AgentMatchResult {
  agentId: string | null;
  agentKey: string | null;
  /** 能力重叠（scopeDeclaration.objectTypes ∩ 需求图对象类型·信息位·非评分）。 */
  overlap: number;
}
/** 需求图涉及的对象类型集（object 节点·R11 三白名单内）。 */
function reqGraphObjectTypes(reqGraph: RequirementGraph): Set<string> {
  const out = new Set<string>();
  for (const n of reqGraph.nodes) if (n.kind === "object" && n.ontologyType) out.add(n.ontologyType);
  return out;
}
export function pickBestAgent(
  agents: readonly AgentDefinition[],
  reqGraph: RequirementGraph,
): AgentMatchResult | null {
  const need = reqGraphObjectTypes(reqGraph);
  let best: AgentMatchResult | null = null;
  for (const a of agents) {
    if (a.status !== "PUBLISHED") continue;
    let overlap = 0;
    for (const t of a.scopeDeclaration.objectTypes) if (need.has(t)) overlap++;
    if (overlap === 0) continue; // 无能力交集·不指派（诚实·非硬塞）
    if (
      best === null ||
      overlap > best.overlap ||
      (overlap === best.overlap && a.key < (best.agentKey ?? ""))
    ) {
      best = { agentId: a.id, agentKey: a.key, overlap };
    }
  }
  return best;
}

function assignSkillsAndAgents(
  nodes: TaskNode[],
  reqGraph: RequirementGraph,
  registries: PlannerRegistries,
): void {
  if (registries.skills && registries.skills.length > 0) {
    for (const n of nodes) {
      if (n.kind !== "SOLVER_RUN" && n.kind !== "REPORT_GENERATE") continue;
      const best = pickBestSkill(n, registries.skills, reqGraph, registries.boundSkillKeys);
      if (best?.skillId) n.assignedSkillId = best.skillId;
    }
  }
  if (registries.agents && registries.agents.length > 0) {
    const agent = pickBestAgent(registries.agents, reqGraph);
    if (agent?.agentId) {
      for (const n of nodes) if (n.kind === "MODEL_RUN") n.assignedAgentId = agent.agentId;
    }
  }
}

// ── Ch10.14 多目标向量（AST objectives·MIN:/MAX: 前缀·排序去重·喂 solver args）───
function deriveObjectiveVector(reqGraph: RequirementGraph): string[] {
  return uniqueSorted(reqGraph.questionAst.objectives ?? []);
}

// ── 回落模板（Ch9.10 <阈 / 无可综合 / 综合非法·诚实·绝不产非法图）──────────────
function fallbackToTemplate(
  reqGraph: RequirementGraph,
  opts: SynthesizePlanOptions,
  plannerVersion: string,
  intentKey: string | null,
  reason: string,
): ExecutionGraph {
  const generatedAt = opts.generatedAt;
  if (opts.templateFallback) {
    const g = fromLinearPlan(opts.templateFallback, {
      tenantId: reqGraph.tenantId,
      taskId: reqGraph.taskId,
      generatedAt,
      plannerVersion,
      intentKey,
      sourceGraphId: reqGraph.graphId,
    });
    // 回落图携真覆盖分（咨询·非误红）；graphId 保留 eg_lift_ 前缀（供 divergence 识别回落）。
    return { ...g, coverageScore: reqGraph.coverageScore };
  }
  // 无模板 → 诚实最小合法图（单 render 节点·绝不产非法图·永不冒充综合成功）。
  const renderId = "node_render";
  const node: TaskNode = {
    nodeId: renderId,
    kind: "REPORT_GENERATE",
    step: { id: renderId, type: "render_answer", params: { blocks: [] } },
    dependsOn: [],
    onError: "FAIL",
    source: `fallback:${reason}`,
    assignedSkillId: null,
    assignedAgentId: null,
  };
  return {
    graphId: `eg_fallback_${reqGraph.taskId}`,
    taskId: reqGraph.taskId,
    tenantId: reqGraph.tenantId,
    sourceGraphId: reqGraph.graphId,
    intentKey,
    nodes: [node],
    transitions: [],
    gateways: [],
    entryNodes: [renderId],
    compensations: [],
    coverageScore: reqGraph.coverageScore,
    objectiveVector: [],
    plannerVersion,
    generatedAt,
  };
}

/**
 * synthesizePlan：RequirementGraph 下游投影 → ExecutionGraph（Ch10.6-10.14·纯函数·R6）。
 * 覆盖门 <阈 / 无可综合节点 / 拓扑非法 → 诚实回落模板（绝不产非法图·永不误红）。
 */
export function synthesizePlan(
  reqGraph: RequirementGraph,
  registries: PlannerRegistries,
  opts: SynthesizePlanOptions,
): ExecutionGraph {
  const generatedAt = opts.generatedAt;
  const plannerVersion = opts.plannerVersion ?? EXECUTION_PLANNER_VERSION;
  const threshold = opts.coverageThreshold ?? COVERAGE_THRESHOLD;
  const intentKey = opts.intentKey ?? reqGraph.questionAst.intent.intentKey ?? null;

  // Ch9.10 覆盖门：结构覆盖 <0.8 → 不综合·回落模板（诚实 gap·NG6 咨询非判决）。
  if (reqGraph.coverageScore < threshold) {
    return fallbackToTemplate(reqGraph, opts, plannerVersion, intentKey, "coverage_below_threshold");
  }

  const nodes: TaskNode[] = [];

  // ── Ch10.6/10.7 Task Graph：sliceTargets → DATA_QUERY（入度0·并行前沿·Ch10.12）──
  const dataNodeIds: string[] = [];
  const sliceTargetKeys = reqGraph.sliceTargets ? uniqueSorted(reqGraph.sliceTargets.targets) : [];
  for (const sliceKey of sliceTargetKeys) {
    if (registries.sliceKeys && !registries.sliceKeys.has(sliceKey)) continue; // 越界丢弃·不入图
    const nodeId = `node_slice_${sliceKey}`;
    nodes.push({
      nodeId,
      kind: "DATA_QUERY",
      step: { id: nodeId, type: "resolve_slice", params: { sliceKey, args: {} }, onError: "SKIP" },
      dependsOn: [],
      onError: "SKIP",
      source: `rg:slice:${sliceKey}`,
      assignedSkillId: null,
      assignedAgentId: null,
    });
    dataNodeIds.push(nodeId);
  }

  // ── Ch10.13 Solver Orchestration：solverCandidates → SOLVER_RUN 管线（depends_on 链）──
  const objectiveVector = deriveObjectiveVector(reqGraph);
  const solverKeys = uniqueSorted(reqGraph.solverCandidates).filter((k) => registries.validSolverKeys.has(k));
  const solverNodeIds: string[] = [];
  let prevSolverId: string | null = null;
  for (const solverKey of solverKeys) {
    const nodeId = `node_solver_${solverKey}`;
    // 首求解器扇入全部数据节点（等数据齐）；后续求解器串成管线（Ch10.13·Forecast→MILP→…）。
    const dependsOn = prevSolverId ? [prevSolverId] : [...dataNodeIds];
    nodes.push({
      nodeId,
      kind: "SOLVER_RUN",
      step: {
        id: nodeId,
        type: "invoke_solver",
        params: { solverKey, args: objectiveVector.length > 0 ? { objectives: objectiveVector } : {} },
      },
      dependsOn,
      onError: "FAIL",
      source: `rg:solver:${solverKey}`,
      assignedSkillId: null,
      assignedAgentId: null,
    });
    solverNodeIds.push(nodeId);
    prevSolverId = nodeId;
  }

  // 无可综合节点（无 slice 无 solver）→ 诚实回落模板（不产空壳综合图）。
  if (dataNodeIds.length === 0 && solverNodeIds.length === 0) {
    return fallbackToTemplate(reqGraph, opts, plannerVersion, intentKey, "no_executable_nodes");
  }

  // ── REPORT_GENERATE 终态（render_answer·扇入·复用 G-1 render 投影）───────────────
  const renderId = "node_render";
  const renderDeps = prevSolverId ? [prevSolverId] : [...dataNodeIds];
  nodes.push({
    nodeId: renderId,
    kind: "REPORT_GENERATE",
    step: { id: renderId, type: "render_answer", params: { blocks: [] } },
    dependsOn: renderDeps,
    onError: "FAIL",
    source: "rg:render",
    assignedSkillId: null,
    assignedAgentId: null,
  });

  // ── Ch10.8 Skill Match + Ch10.9 Agent Assign（确定性·历史中性1.0·NG5）─────────────
  assignSkillsAndAgents(nodes, reqGraph, registries);

  const entryNodes = uniqueSorted(nodes.filter((n) => n.dependsOn.length === 0).map((n) => n.nodeId));

  const graph: ExecutionGraph = {
    graphId: `eg_${reqGraph.taskId}`,
    taskId: reqGraph.taskId,
    tenantId: reqGraph.tenantId,
    sourceGraphId: reqGraph.graphId,
    intentKey,
    nodes,
    transitions: [],
    gateways: [],
    entryNodes,
    compensations: [],
    coverageScore: reqGraph.coverageScore,
    objectiveVector,
    plannerVersion,
    generatedAt,
  };

  // ── Ch10.11 Dependency Resolution 兜底：Kahn 无环 + 节点∈注册表·非法→回落模板──────
  const validation = validateExecutionGraph(graph, {
    solverKeys: registries.validSolverKeys,
    sliceKeys: registries.sliceKeys,
  });
  if (!validation.ok) {
    return fallbackToTemplate(reqGraph, opts, plannerVersion, intentKey, `invalid_graph:${validation.errors[0] ?? "?"}`);
  }

  return graph;
}

// ── 影子 divergence（综合图 vs 模板·纯派生·acceptance C4 parity 聚合口）────────────
/** 综合图是否为回落模板（graphId 前缀识别·fromLinearPlan → eg_lift_ / 无模板 → eg_fallback_）。 */
export function isFallbackGraph(graph: ExecutionGraph): boolean {
  return graph.graphId.startsWith("eg_lift") || graph.graphId.startsWith("eg_fallback");
}

export function diffPlannerShadow(plan: ExecutionPlan, graph: ExecutionGraph): PlannerDivergence {
  const templateTypes = plan.steps.map((s) => s.type);
  const synthTypes = graph.nodes.map((n) => n.step.type);
  const added = multisetDiff(synthTypes, templateTypes);
  const removed = multisetDiff(templateTypes, synthTypes);
  return {
    templateStepCount: plan.steps.length,
    synthesizedNodeCount: graph.nodes.length,
    entryNodeCount: graph.entryNodes.length,
    maxParallelWidth: graph.entryNodes.length,
    addedStepTypes: added,
    removedStepTypes: removed,
    sameStepTypeMultiset: added.length === 0 && removed.length === 0,
    fellBackToTemplate: isFallbackGraph(graph),
  };
}

export function buildPlannerShadowRecord(
  reqGraph: RequirementGraph,
  graph: ExecutionGraph,
  divergence: PlannerDivergence,
): PlannerShadowRecord {
  return {
    taskId: reqGraph.taskId,
    tenantId: reqGraph.tenantId,
    intentKey: graph.intentKey,
    graphId: graph.graphId,
    sourceGraphId: graph.sourceGraphId,
    plannerVersion: graph.plannerVersion,
    coverageScore: reqGraph.coverageScore,
    synthesizedNodeCount: graph.nodes.length,
    divergence,
    generatedAt: graph.generatedAt,
  };
}
