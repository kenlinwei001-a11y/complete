// 数据构建 Pipeline · 出厂默认定义 + 解析（stepKey 注册表 → 可执行步骤序列）。
//
// 「数据构建发动机」原先把步骤写死在 service.ts 的常量数组里；本文件把**序列 + 每节点 SOP**外化成数据：
//   · 出厂默认（FACTORY_*）= 未配置任何 pipeline 时使用的定义，**逐字节复现写死时代的行为**
//     （同样的 stepKey、同样的顺序、同样的 maxAttempts、失败一律 ABORT、无人工介入）；
//   · 租户存一条同 kind 的 BuildPipeline 即覆盖 → 序列/重试/跳过/人工介入全部跟着数据变。
//
// 步骤**实现**仍是代码（闭包，包住 AuthCtx/service）；pipeline 决定「跑哪些、什么顺序、失败怎么办」。
import type { BuildPipeline, BuildPipelineKind, BuildPipelineNode, BuildNodeSop } from "@platform/contracts";
import { validationError } from "../errors.js";
import type { StepContext, StepResult, WorkflowStepDef } from "./workflow-engine.js";

/** 出厂 SOP：失败即止、单次尝试、无人工介入 —— 与写死时代的引擎语义完全一致。 */
const sop = (description: string, over: Partial<BuildNodeSop> = {}): BuildNodeSop => ({
  description,
  onFailure: "ABORT",
  maxAttempts: 1,
  requiresHumanApproval: false,
  params: {},
  ...over,
});

const node = (stepKey: string, label: string, description: string, over: Partial<BuildNodeSop> = {}, i = 0): BuildPipelineNode => ({
  id: `n_${stepKey}`,
  label,
  position: { x: 0, y: i * 120 },
  stepKey,
  enabled: true,
  sop: sop(description, over),
});

/** 顺序链边（n1→n2→…）：序列由**边**表达 → 改边即改执行顺序（数据驱动，非代码常量）。 */
const chain = (nodes: BuildPipelineNode[]): { from: string; to: string }[] =>
  nodes.slice(1).map((n, i) => ({ from: nodes[i]!.id, to: n.id }));

/**
 * 故事建域出厂 pipeline —— 与改造前 buildStorySteps 的 7 步**一一对应**：
 * dry_build → cross_scaffold(maxAttempts 3) → gap_analysis → publish_build → validation → inference → record。
 * 任一处改动都会被 pipeline-factory-invariance 测试当场咬住（金值钉死）。
 */
export const FACTORY_STORY_BUILD_NODES: BuildPipelineNode[] = [
  // label 逐字沿用写死时代的 title → 落库的 BuildWorkflowStep.title 不变（行为不变性的一部分）。
  node("dry_build", "试建：出 BuildPlan + A 三向闭包（不发布）", "出 BuildPlan + A 三向闭包，不发布。失败即止，保留现场可 resume。", {}, 0),
  // 跨系统 HTTP：瞬时失败有界重试（写死时代 maxAttempts: 3 + isRetryable=RetryableStepError）。
  node("cross_scaffold", "跨系统下发：A 闭包通过则向 AgentCore 下发 B 栈 scaffold", "HTTP 瞬时失败有界退避重试至多 3 次；仍失败则止于该步。", { maxAttempts: 3 }, 1),
  node("gap_analysis", "比对现状：倒推 BuildPlan vs 系统现状（跨模块统一 diff）", "倒推 BuildPlan 与系统现状做统一 diff。", {}, 2),
  node("publish_build", "全链 HARD 门：A⊕B 闭合则真建 + 发布 + 落切片", "A⊕B 闭合才真建 + 发布 + 落切片；未闭合则跳过（拒发布，数据不落库）。", {}, 3),
  node("validation", "推演验证痕迹：结论依据反向核对知识图谱", "结论依据反向核对知识图谱。", {}, 4),
  node("inference", "一键推演：故事主问句经 QOS/求解器跑出答案", "故事主问句经 QOS/求解器跑出答案。", {}, 5),
  node("record", "记账：装配 StoryBuildRun 落库 + 发 storybuild.run_recorded", "装配 StoryBuildRun 落库 + 发 storybuild.run_recorded。", {}, 6),
];

/**
 * 数据接入出厂 pipeline（POST /a/v1/databuilder/intake）——「只要数据接入，就按这个 pipeline 处理数据」。
 * 解析 → 对账 → 落 HITL 队列 → 发事件。
 */
export const FACTORY_INTAKE_NODES: BuildPipelineNode[] = [
  node("intake_parse", "解析", "确定性抽取原型内嵌数据表 + 关系（不 eval、不调 LLM；R6 同输入同输出）。", {}, 0),
  node("intake_reconcile", "字段对账", "原型列 ↔ 既有本体字段：精确命中自动接，其余出候选给人确认。", {}, 1),
  node("intake_persist_candidates", "落对账队列", "把对账候选落库为 HITL 队列（人确认 USE/RENAME/NEW/MERGE/DISCARD）。", {}, 2),
  node("intake_emit", "发事件", "发 prototype.intake_recorded（数据表数/关系数/未解析数/候选数）。", {}, 3),
];

/**
 * 数据导入出厂 pipeline（POST /a/v1/databuilder/intake/import）——「只要数据导入，就按这个 pipeline 处理数据」。
 * 经连接器物化 → 投影数据表清单 → 发事件。
 */
export const FACTORY_INTAKE_IMPORT_NODES: BuildPipelineNode[] = [
  node("import_materialize", "物化进库", "经 prototype_html 连接器落 RawDataset（数据连接器可见 + 在线查看）。", {}, 0),
  node("import_project_datasets", "投影表清单", "列出该连接下的 RawDataset（id/名/行数/字段）。", {}, 1),
  node("import_emit", "发事件", "发 prototype.materialized（连接 id/表数/总行数）。", {}, 2),
];

const FACTORY_NAMES: Record<BuildPipelineKind, string> = {
  story_build: "出厂默认 · 故事建域",
  intake: "出厂默认 · 数据接入",
  intake_import: "出厂默认 · 数据导入",
};

const FACTORY_NODES: Record<BuildPipelineKind, BuildPipelineNode[]> = {
  story_build: FACTORY_STORY_BUILD_NODES,
  intake: FACTORY_INTAKE_NODES,
  intake_import: FACTORY_INTAKE_IMPORT_NODES,
};

export const BUILD_PIPELINE_KINDS: BuildPipelineKind[] = ["story_build", "intake", "intake_import"];

/** 出厂默认 pipeline（未落库；租户存一条同 kind 即覆盖）。深拷贝防调用方改动污染常量。 */
export function factoryPipeline(tenantId: string, kind: BuildPipelineKind): BuildPipeline {
  const nodes = structuredClone(FACTORY_NODES[kind]);
  return {
    id: `bpp_factory_${kind}`,
    tenantId,
    kind,
    name: FACTORY_NAMES[kind],
    nodes,
    edges: chain(nodes),
    factory: true,
  };
}

/** 步骤实现（闭包已包住 AuthCtx/service）：pipeline 只引用它的键。 */
export interface StepImpl {
  title: string;
  run: (context: StepContext) => Promise<StepResult>;
  /** 抛错分类（默认仅 RetryableStepError 视为可重试）；SOP onFailure=RETRY 时无条件可重试。 */
  isRetryable?: (e: unknown) => boolean;
}

export type StepRegistry = Record<string, StepImpl>;

/**
 * 执行顺序：**有边按边拓扑排序**（Kahn，同层按 nodes 数组下标稳定），无边退回数组顺序。
 * 出厂默认自带顺序链边 → 改边即改顺序，序列真正从数据里读出来。
 */
export function orderPipelineNodes(pipeline: BuildPipeline): BuildPipelineNode[] {
  const nodes = pipeline.nodes;
  if (pipeline.edges.length === 0) return [...nodes];
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  const adj = new Map(nodes.map((n) => [n.id, [] as string[]]));
  for (const e of pipeline.edges) {
    if (!idx.has(e.from) || !idx.has(e.to)) continue; // 悬空边忽略（validate 另行报）
    adj.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const ready = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const out: BuildPipelineNode[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => (idx.get(a) ?? 0) - (idx.get(b) ?? 0)); // 稳定：同层按数组下标
    const id = ready.shift()!;
    out.push(nodes[idx.get(id)!]!);
    for (const to of adj.get(id) ?? []) {
      indeg.set(to, (indeg.get(to) ?? 0) - 1);
      if ((indeg.get(to) ?? 0) === 0) ready.push(to);
    }
  }
  // 有环 → 剩余节点按数组顺序补在后面（validate 会报 CYCLE；执行不静默丢节点）。
  if (out.length < nodes.length) {
    const seen = new Set(out.map((n) => n.id));
    for (const n of nodes) if (!seen.has(n.id)) out.push(n);
  }
  return out;
}

/**
 * pipeline 定义 + 步骤注册表 → 可执行步骤序列。
 * **这是「写死 → 可配置」的接缝**：顺序/是否执行/重试次数/失败策略/人工介入全部来自 pipeline 数据。
 * 未注册的 stepKey 直接报错（不静默跳过 —— 静默会把配置错误伪装成"跑通了"）。
 */
export function resolvePipelineSteps(pipeline: BuildPipeline, registry: StepRegistry): WorkflowStepDef[] {
  const steps: WorkflowStepDef[] = [];
  for (const n of orderPipelineNodes(pipeline)) {
    if (!n.enabled) continue;
    const impl = registry[n.stepKey];
    if (!impl) {
      throw validationError(`pipeline ${pipeline.kind} 节点 ${n.id} 绑定了未注册的 stepKey：${n.stepKey}`);
    }
    steps.push({
      stepKey: n.stepKey,
      title: n.label || impl.title,
      maxAttempts: n.sop.maxAttempts,
      onFailure: n.sop.onFailure,
      requiresApproval: n.sop.requiresHumanApproval,
      params: n.sop.params,
      run: impl.run,
      isRetryable: impl.isRetryable,
    });
  }
  return steps;
}
