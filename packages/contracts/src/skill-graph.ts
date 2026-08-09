/**
 * Skill Graph（Reasoning Graph）契约与编译器 · `docs/PRD-skill-runtime-orchestrator.md` §3.1/§3.2/§3.3/§8
 *
 * WO-SKILL-ORCHESTRATOR-S1 切片范围：**图契约 + 拓扑分层 + 环检测**（纯函数，零 IO）。
 * 调度/执行在 `apps/agentcore/src/skill-orchestrator.ts`（R1 contracts-only-shared：契约留在本包，
 * 两 app 与前端同源，agentcore 不得本地重定义）。
 *
 * ── 复用声明（防「同一概念两套词表，交集为 0」）──────────────────────────────────
 * 本文件**不新造**下列词表，一律从既有契约借：
 *   · `TemplateValueSchema`（qos.ts）  —— 节点 params 与今天 `PlanStep.params` **逐字段同构**，
 *     模板引用语法同为 `{{steps.<id>.output.<path>}}`，由 agentcore `util/template.ts resolveTemplate`
 *     **同一个解析器**求值（PRD §3.1「与今天 PlanStep.params 逐字段同构」）。
 *   · `OnErrorSchema`（qos.ts）        —— FAIL|SKIP，与 `PlanStep.onError` 同义同枚举。
 *   · `NODE_KIND_TO_PLAN_STEP_TYPE`   —— 节点 kind ↔ 既有 `PlanStep.type` 的**单一映射表**
 *     （PRD §3.1「节点类型 ↔ 今日派发的一一对应」）。契约测试逐条断言映射目标是**真的**
 *     `PlanStepSchema` 判别值 —— 任何一边改名，测试当场红，两套词表漂不起来。
 *
 * ── 诚实边界（S1 未做的，显式 NOT_IMPLEMENTED，绝不静默跳过）────────────────────
 *   · 已实现节点 kind 仅 `skill` / `solver`（`IMPLEMENTED_NODE_KINDS`）。其余 kind 留枚举位，
 *     编译期返回 `NOT_IMPLEMENTED` 并点名是哪个节点、哪个 kind。
 *   · 边 kind `cond`（条件边 + 确定性 guard，PRD §3.3-2）未实现 → 编译期 NOT_IMPLEMENTED。
 *   · **R11「图须以 render 节点收口」本切片不校验** —— 因为 `render` 本身还是 NOT_IMPLEMENTED，
 *     此时强制 render 可达 = 任何 S1 图都无法编译。这是**已知未覆盖门**，不是"已经守住了"，
 *     已登记本体 §8 `G-SKILL-GRAPH-NO-RENDER-CLOSURE`。
 */
import { z } from "zod";
import { OnErrorSchema, PlanStepSchema, TemplateValueSchema, type PlanStep } from "./qos.js";

// ---------------------------------------------------------------------------
// §3.1 结构
// ---------------------------------------------------------------------------

/** PRD §3.1 全部节点 kind（前四类为 SPEC 要求，后四类为既有 PlanStep 的图内表达，`skill` 见 §8.1）。 */
export const SKILL_GRAPH_NODE_KINDS = [
  "skill",
  "solver",
  "rule",
  "agent",
  "human",
  "slice",
  "render",
  "mcp",
  "compose",
] as const;
export const SkillGraphNodeKindSchema = z.enum(SKILL_GRAPH_NODE_KINDS);
export type SkillGraphNodeKind = z.infer<typeof SkillGraphNodeKindSchema>;

/**
 * S1 真正能跑的节点 kind。其余一律编译期 NOT_IMPLEMENTED。
 * 加一个 kind 到这里 = 承诺 `skill-orchestrator.ts` 里有对应 dispatch 分支且有 SEAM 覆盖。
 */
export const IMPLEMENTED_NODE_KINDS = ["skill", "solver"] as const;
export type ImplementedNodeKind = (typeof IMPLEMENTED_NODE_KINDS)[number];

/**
 * 节点 kind ↔ 既有 `PlanStep.type` 的**唯一映射**（PRD §3.1 表）。
 * `skill` 无对应 PlanStep —— 它是 PRD §8.1 的新概念（编译期内联展开的 Skill 引用节点），
 * 映射为 null 是**诚实标注**，不是遗漏。
 */
export const NODE_KIND_TO_PLAN_STEP_TYPE: Readonly<Record<SkillGraphNodeKind, string | null>> = {
  solver: "invoke_solver",
  rule: "evaluate_rules",
  agent: "invoke_agent",
  human: "create_action_draft",
  slice: "resolve_slice",
  render: "render_answer",
  mcp: "invoke_mcp_tool",
  compose: "llm_compose",
  skill: null,
};

/** PRD §3.1：determinism 派生自 kind（agent/compose = LLM，其余 PURE），显式写出以便门校验。 */
export const SkillGraphDeterminismSchema = z.enum(["PURE", "LLM"]);
export type SkillGraphDeterminism = z.infer<typeof SkillGraphDeterminismSchema>;

/** determinism 的**单一派生源**——不许调用方各自判断（R-一致）。 */
export function determinismOf(kind: SkillGraphNodeKind): SkillGraphDeterminism {
  return kind === "agent" || kind === "compose" ? "LLM" : "PURE";
}

export const SkillGraphNodeSchema = z.object({
  /** 图内唯一。同时作为模板作用域键：`{{steps.<id>.output.<path>}}`。 */
  id: z.string().min(1),
  kind: SkillGraphNodeKindSchema,
  /** 与今天 `PlanStep.params` 逐字段同构（同一 TemplateValue 词表、同一解析器）。 */
  params: z.record(z.string(), TemplateValueSchema).default({}),
  /** 派生自 kind；显式给出时必须与 `determinismOf(kind)` 一致（编译期校验）。 */
  determinism: SkillGraphDeterminismSchema.optional(),
  /** 角色标识（并行后角色**必须由节点自带**，PRD §3.5-b）。 */
  role: z.string().optional(),
  /** 对应 Skill.progress.phases[] 的语义阶段名。 */
  phase: z.string().optional(),
  /** 与今天 `PlanStep.onError` 同义。 */
  onError: OnErrorSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
});
export type SkillGraphNode = z.infer<typeof SkillGraphNodeSchema>;

/**
 * PRD §3.1 边：
 *   seq      数据/顺序依赖
 *   parallel 显式声明可与兄弟并发（语义上**等价于共同前驱的多条 seq**——故拓扑上同样是依赖边）
 *   cond     条件边（S1 NOT_IMPLEMENTED）
 */
export const SKILL_GRAPH_EDGE_KINDS = ["seq", "parallel", "cond"] as const;
export const SkillGraphEdgeKindSchema = z.enum(SKILL_GRAPH_EDGE_KINDS);
export type SkillGraphEdgeKind = z.infer<typeof SkillGraphEdgeKindSchema>;

export const IMPLEMENTED_EDGE_KINDS = ["seq", "parallel"] as const;

export const SkillGraphEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: SkillGraphEdgeKindSchema.default("seq"),
});
export type SkillGraphEdge = z.infer<typeof SkillGraphEdgeSchema>;

/** 保守缺省并发度（PRD §3.4：并发上限做成参数，**不许无上限**）。 */
export const DEFAULT_MAX_PARALLEL = 4;
/** 并发度硬上界：图作者写多大都不许越过（4 核机自保）。 */
export const MAX_PARALLEL_CEILING = 16;

/** 展开后总节点数上界（PRD §8.2「建议 64」）。 */
export const MAX_GRAPH_NODES = 64;

export const SkillGraphSchema = z.object({
  nodes: z.array(SkillGraphNodeSchema).min(1).max(MAX_GRAPH_NODES),
  edges: z.array(SkillGraphEdgeSchema).default([]),
  /** 并发上限（PRD §3.4 `maxParallelNodes`）。**不许无上限**：缺省 4，硬上界 16。 */
  maxParallelNodes: z.number().int().min(1).max(MAX_PARALLEL_CEILING).default(DEFAULT_MAX_PARALLEL),
});
export type SkillGraph = z.infer<typeof SkillGraphSchema>;

// ---------------------------------------------------------------------------
// §3.2/§3.4 编译：拓扑分层 + 环检测
// ---------------------------------------------------------------------------

export interface SkillGraphLayer {
  index: number;
  /** 同层节点，**按声明序**（R6：不是完成序，也不是字典序）。 */
  nodeIds: string[];
}

export type CompileGraphResult =
  | {
      ok: true;
      /** 入度 0 的节点集（按声明序）。 */
      entry: string[];
      layers: SkillGraphLayer[];
      /** 每个节点的直接前驱（按声明序）—— 调度器据此建模板作用域（边 = 可见性授权）。 */
      predecessors: Record<string, string[]>;
    }
  | {
      ok: false;
      code: SkillGraphCompileErrorCode;
      message: string;
      /** 仅环错误：可读环路径 `["a","b","a"]`，与既有 `detectStaticCycle` 的表示同形。 */
      cycle?: string[];
    };

export const SKILL_GRAPH_COMPILE_ERROR_CODES = [
  /** 复用既有 ErrorCodes.CYCLIC_INVOCATION 的同一词（common.ts）——「有环」全仓一个说法。 */
  "CYCLIC_INVOCATION",
  "NOT_IMPLEMENTED",
  "GRAPH_INVALID",
] as const;
export type SkillGraphCompileErrorCode = (typeof SKILL_GRAPH_COMPILE_ERROR_CODES)[number];

/**
 * 编译一张图 → 确定性分层执行计划。
 *
 * 确定性（R6 红线）：分层与层内顺序**只由声明序决定**。同一张图重复编译，`layers[]` 逐字节一致。
 * 实现上层内顺序取 `nodes[]` 下标序，不用 Map 迭代序，也不做字典序排序。
 */
export function compileGraph(graph: SkillGraph): CompileGraphResult {
  const nodes = graph.nodes;
  const order = new Map<string, number>();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (order.has(n.id)) {
      return { ok: false, code: "GRAPH_INVALID", message: `节点 id 重复：${n.id}` };
    }
    order.set(n.id, i);
  }

  // —— 诚实边界：未实现的节点/边 kind 显式拒绝，绝不静默跳过 ——
  const implementedNodes: ReadonlySet<string> = new Set<string>(IMPLEMENTED_NODE_KINDS);
  for (const n of nodes) {
    if (!implementedNodes.has(n.kind)) {
      return {
        ok: false,
        code: "NOT_IMPLEMENTED",
        message: `节点「${n.id}」的 kind=${n.kind} 尚未实现（S1 仅实现 ${IMPLEMENTED_NODE_KINDS.join("/")}）——诚实拒绝，不静默跳过`,
      };
    }
    if (n.determinism !== undefined && n.determinism !== determinismOf(n.kind)) {
      return {
        ok: false,
        code: "GRAPH_INVALID",
        message: `节点「${n.id}」声明 determinism=${n.determinism}，与 kind=${n.kind} 派生值 ${determinismOf(n.kind)} 不符`,
      };
    }
  }
  const implementedEdges: ReadonlySet<string> = new Set<string>(IMPLEMENTED_EDGE_KINDS);
  for (const e of graph.edges) {
    if (!implementedEdges.has(e.kind)) {
      return {
        ok: false,
        code: "NOT_IMPLEMENTED",
        message: `边「${e.from}→${e.to}」的 kind=${e.kind} 尚未实现（S1 仅实现 ${IMPLEMENTED_EDGE_KINDS.join("/")}）——诚实拒绝，不静默跳过`,
      };
    }
    if (!order.has(e.from)) {
      return { ok: false, code: "GRAPH_INVALID", message: `边引用了不存在的节点：${e.from}` };
    }
    if (!order.has(e.to)) {
      return { ok: false, code: "GRAPH_INVALID", message: `边引用了不存在的节点：${e.to}` };
    }
    if (e.from === e.to) {
      return {
        ok: false,
        code: "CYCLIC_INVOCATION",
        message: `图存在环：${e.from} -> ${e.from}`,
        cycle: [e.from, e.from],
      };
    }
  }

  // 邻接表 / 前驱表：**按声明序**建（边的声明序 → 决定同前驱下的稳定顺序）。
  const succ = new Map<string, string[]>();
  const pred = new Map<string, string[]>();
  for (const n of nodes) {
    succ.set(n.id, []);
    pred.set(n.id, []);
  }
  const seenEdge = new Set<string>();
  for (const e of graph.edges) {
    const k = `${e.from}\u0000${e.to}`;
    if (seenEdge.has(k)) continue; // seq + parallel 平行重边 → 语义上同一条依赖，去重后不影响拓扑
    seenEdge.add(k);
    succ.get(e.from)!.push(e.to);
    pred.get(e.to)!.push(e.from);
  }

  // —— 环检测：三色 DFS，返回**可读环路径**（与 workflow/validate.ts detectStaticCycle 同形：
  //    visiting 栈 + slice(indexOf) 切出真实环段，调用方 join(" -> ") 即可展示）——
  const visiting: string[] = [];
  const done = new Set<string>();
  const dfs = (id: string): string[] | undefined => {
    const at = visiting.indexOf(id);
    if (at >= 0) return [...visiting.slice(at), id];
    if (done.has(id)) return undefined;
    visiting.push(id);
    for (const nxt of succ.get(id) ?? []) {
      const c = dfs(nxt);
      if (c) return c;
    }
    visiting.pop();
    done.add(id);
    return undefined;
  };
  for (const n of nodes) {
    const cycle = dfs(n.id);
    if (cycle) {
      return {
        ok: false,
        code: "CYCLIC_INVOCATION",
        message: `图存在环：${cycle.join(" -> ")}（图必须是 DAG；请删掉造成回边的那条边）`,
        cycle,
      };
    }
  }

  // —— Kahn 分层（波前）：每层 = 当前入度为 0 的全部节点，层内按声明序 ——
  const indeg = new Map<string, number>();
  for (const n of nodes) indeg.set(n.id, (pred.get(n.id) ?? []).length);

  const entry = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const layers: SkillGraphLayer[] = [];
  const emitted = new Set<string>();
  let frontier = entry.slice();
  while (frontier.length > 0) {
    layers.push({ index: layers.length, nodeIds: frontier.slice() });
    for (const id of frontier) emitted.add(id);
    const next: string[] = [];
    for (const id of frontier) {
      for (const s of succ.get(id) ?? []) {
        indeg.set(s, (indeg.get(s) ?? 0) - 1);
        if (indeg.get(s) === 0) next.push(s);
      }
    }
    // 声明序（R6）：不依赖 Map/Set 迭代顺序，显式按 nodes[] 下标排。
    next.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    frontier = next;
  }

  if (emitted.size !== nodes.length) {
    // 环已在上面拒过；走到这里说明拓扑实现自身有 bug，宁可红也不产出半张计划。
    const stuck = nodes.filter((n) => !emitted.has(n.id)).map((n) => n.id);
    return {
      ok: false,
      code: "GRAPH_INVALID",
      message: `分层未覆盖全部节点（残留 ${stuck.join(", ")}）——拒绝产出不完整执行计划`,
    };
  }

  const predecessors: Record<string, string[]> = {};
  for (const n of nodes) {
    predecessors[n.id] = (pred.get(n.id) ?? []).slice().sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }

  return { ok: true, entry, layers, predecessors };
}

// ---------------------------------------------------------------------------
// Skill.execution · 三条线共用字段（审核方对名裁决 2026-08-09）
// ---------------------------------------------------------------------------

/**
 * ⚠⚠ **三条 PRD 线共用的字段名，改名会同时断三条链——改之前先看这段。** ⚠⚠
 *
 * 事故背景（审核方裁决原文）：同一个字段一度有三个名字——
 *   · `docs/PRD-skill-migration.md:165`          → `execution.plan[]`
 *   · `docs/PRD-skill-compiler-registry.md:176`  → `skill.execution.steps`
 *   · `docs/PRD-skill-runtime-orchestrator.md:41`→ `compileGraph(Skill.execution ⊕ legacy plan.steps)`
 * 三条线各按各的名字落地 ⇒ 互相读到 `undefined` ⇒ **静默回落 legacy** ⇒ 功能等于没做，而四包全绿。
 * 同族 `G-SIDEEFFECT-VOCAB-SPLIT`。
 *
 * **裁决：字段名 `Skill.execution.steps`，元素类型复用既有 `PlanStep` 判别联合，不新造。**
 *
 * 改名会断的链：
 *   ① 迁移线（PRD-skill-migration）：存量 Skill → `execution.steps` 的搬运写不进来；
 *   ② 编译器线（PRD-skill-compiler-registry）：`.skill` 包编译产物落不到这个字段；
 *   ③ 运行时线（本文件 · PRD-skill-runtime-orchestrator）：`compileExecution` 读不到执行来源，
 *      静默回落 legacy —— 正是这条裁决要堵的那个洞。
 *
 * ── 本 dev 对裁决的技术异议（照裁决先落，但不沉默）────────────────────────────
 * `steps: PlanStep[]` 是**线性**形态：`PlanStep` 判别联合里**没有边、没有并行、没有 skill 节点 kind**，
 * 它按构造就表达不了图。所以 `execution.steps` 单独存在时，**并行调度这个增量永远不会发生**——
 * 而这恰恰是裁决想避免的「功能等于没做还全绿」，只是换了个位置发作。
 * 故本文件让 `execution` 同时容纳两种形态（与 PRD-skill-runtime-orchestrator §3.2 一致）：
 *   · `steps` → 线性（裁决指定名，元素就是 `PlanStep`，逐字节复用）
 *   · `graph` → 图（本线的增量；PRD §3.2「source = Skill.execution.graph → 直接用」）
 * 并由 `compileExecution` **显式判别当前走的是哪一路并在返回里标出 `source`**，
 * 任何一路都不许静默：没有任何来源 = 显式报错，不是空跑。
 *
 * ── 落点边界 ──────────────────────────────────────────────────────────────
 * 本 WO 的文件边界不含 `packages/contracts/src/agentcore.ts`，故**未**把 `execution` 挂进
 * `SkillDefinitionSchema`。挂载归 Skill 契约线；本文件先把形状与判别语义定死，三条线共用。
 */
export const SkillExecutionSchema = z
  .object({
    /** 裁决指定名 · 线性形态 · 元素**就是** `PlanStep`（复用既有判别联合，不新造）。 */
    steps: z.array(PlanStepSchema).min(1).max(MAX_GRAPH_NODES).optional(),
    /** 图形态（本线增量）· PRD §3.2「source = Skill.execution.graph → 直接用」。 */
    graph: SkillGraphSchema.optional(),
    /** PRD §3.3-1：DETERMINISTIC 图内不得出现 LLM 节点（agent/compose）。 */
    mode: z.enum(["DETERMINISTIC", "AGENTIC"]).optional(),
  })
  .strict();
export type SkillExecution = z.infer<typeof SkillExecutionSchema>;

/**
 * 执行来源。**必须在返回里标出来**——「回落 legacy」一旦是静默的，
 * 这个特性就等于没做而测试照绿（审核方裁决判据 #1）。
 */
export const EXECUTION_SOURCES = ["execution.graph", "execution.steps", "legacy.plan.steps"] as const;
export type ExecutionSource = (typeof EXECUTION_SOURCES)[number];

/** `PlanStep.type` → 节点 kind 的**反向映射**，从正向表派生（不手抄第二份）。 */
export const PLAN_STEP_TYPE_TO_NODE_KIND: Readonly<Record<string, SkillGraphNodeKind>> =
  Object.freeze(
    Object.fromEntries(
      (Object.entries(NODE_KIND_TO_PLAN_STEP_TYPE) as [SkillGraphNodeKind, string | null][])
        .filter((e): e is [SkillGraphNodeKind, string] => e[1] !== null)
        .map(([kind, type]) => [type, kind]),
    ),
  );

/**
 * 线性 `PlanStep[]` → **链式退化图**（PRD §3.2）。
 *
 * 保守：一律编成全 seq 链，**不做隐式并行推断**（今天的 steps 不带依赖信息，任何自动分组都是猜；
 * 「更快但偶尔错」是本仓最贵的错法）。想并行必须显式写 `execution.graph` 的 parallel 边。
 */
export function chainGraphFromPlanSteps(
  steps: PlanStep[],
): { ok: true; graph: SkillGraph } | { ok: false; code: SkillGraphCompileErrorCode; message: string } {
  const nodes: SkillGraphNode[] = [];
  for (const s of steps) {
    const kind = PLAN_STEP_TYPE_TO_NODE_KIND[s.type];
    if (!kind) {
      return {
        ok: false,
        code: "NOT_IMPLEMENTED",
        message: `PlanStep.type=${s.type}（步骤「${s.id}」）在图节点词表里没有对应 kind —— 诚实拒绝，不静默丢步`,
      };
    }
    nodes.push({
      id: s.id,
      kind,
      params: ("params" in s ? (s.params as Record<string, unknown>) : {}) as SkillGraphNode["params"],
      ...("onError" in s && s.onError ? { onError: s.onError } : {}),
      ...("timeoutMs" in s && typeof s.timeoutMs === "number" ? { timeoutMs: s.timeoutMs } : {}),
    });
  }
  const edges: SkillGraphEdge[] = [];
  for (let i = 1; i < nodes.length; i++) {
    edges.push({ from: nodes[i - 1]!.id, to: nodes[i]!.id, kind: "seq" });
  }
  return { ok: true, graph: { nodes, edges, maxParallelNodes: DEFAULT_MAX_PARALLEL } };
}

export type CompileExecutionResult =
  | {
      ok: true;
      /** 走的哪一路（裁决判据 #1：不许静默）。 */
      source: ExecutionSource;
      graph: SkillGraph;
      entry: string[];
      layers: SkillGraphLayer[];
      predecessors: Record<string, string[]>;
    }
  | { ok: false; code: SkillGraphCompileErrorCode; message: string; cycle?: string[]; source?: ExecutionSource };

/**
 * 唯一升格入口（PRD §0.2「`compileGraph(plan.steps)` 为唯一升格入口」）。
 *
 * 判别序：`execution.graph` → `execution.steps` → `legacy plan.steps`。
 * **三路都没有 = 显式报错**，绝不"什么都没有就当空图跑通"——静默回落正是本裁决要堵的洞。
 */
export function compileExecution(input: {
  execution?: SkillExecution | undefined;
  legacyPlanSteps?: PlanStep[] | undefined;
}): CompileExecutionResult {
  let source: ExecutionSource;
  let graph: SkillGraph;

  if (input.execution?.graph) {
    source = "execution.graph";
    graph = input.execution.graph;
  } else if (input.execution?.steps && input.execution.steps.length > 0) {
    source = "execution.steps";
    const chained = chainGraphFromPlanSteps(input.execution.steps);
    if (!chained.ok) return { ...chained, source };
    graph = chained.graph;
  } else if (input.legacyPlanSteps && input.legacyPlanSteps.length > 0) {
    source = "legacy.plan.steps";
    const chained = chainGraphFromPlanSteps(input.legacyPlanSteps);
    if (!chained.ok) return { ...chained, source };
    graph = chained.graph;
  } else {
    return {
      ok: false,
      code: "GRAPH_INVALID",
      message:
        "没有任何执行来源：execution.graph / execution.steps / legacy plan.steps 三路皆空 —— " +
        "拒绝空跑（静默回落 = 功能等于没做而测试照绿，审核方 2026-08-09 对名裁决判据 #1）",
    };
  }

  const compiled = compileGraph(graph);
  if (!compiled.ok) return { ...compiled, source };
  return { ok: true, source, graph, entry: compiled.entry, layers: compiled.layers, predecessors: compiled.predecessors };
}

/**
 * 某节点的**全部祖先**（传递闭包）。调度器用它来构造模板作用域：
 * **只有祖先的输出对该节点可见** —— 边就是数据可见性的授权。
 * 没有边 → 引用不到 → `TemplateResolutionError`（这正是「数据真的流过了边」的强制点）。
 */
export function ancestorsOf(nodeId: string, predecessors: Record<string, string[]>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string): void => {
    for (const p of predecessors[id] ?? []) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
      walk(p);
    }
  };
  walk(nodeId);
  return out;
}
