import type { BuildPipeline, BuildPipelineKind, BuildPipelineNode } from "@platform/contracts";
import { db } from "./db";

/**
 * WO-FE-WIRE-2 件一 · databuilder pipeline 的 mock 后端（配置面 + **按它跑**）。
 *
 * 为什么 mock 里也要「按它跑」：本单验收第 2 条明写——「界面能渲染」不算、「CRUD 能存能取」也不算，
 * 必须是**在界面上改 pipeline ⇒ `/a/v1/databuilder/intake` 的实际处理行为跟着变**。
 * 若 mock 的 intake 恒返回同一坨写死 JSON，接缝测试就只能测到一半（正是本仓反复栽的「各半绿」）。
 * 故这里让 mock intake **真按 pipeline 执行**：节点关掉 → 那一段产物真的不出现；
 * 节点标「要人放行」→ run 真的停在 PAUSED 等 approve。
 *
 * 形状全部取自 `@platform/contracts`（BuildPipeline/BuildPipelineNode）——契约漂了这里**编译期就红**，
 * 不会出现「前端自己编了一套 pipeline 形状」的第二真值源。
 * 出厂默认的**内容**镜像 datacore `databuilder/pipeline-defs.ts`（跨 app 不能 import 源码，
 * 只能同形复刻；节点键与 label 与后端逐字对齐，漂了由接缝测/门暴露）。
 */

const sop = (description: string, over: Partial<BuildPipelineNode["sop"]> = {}): BuildPipelineNode["sop"] => ({
  description,
  onFailure: "ABORT",
  maxAttempts: 1,
  requiresHumanApproval: false,
  params: {},
  ...over,
});

const node = (
  id: string,
  label: string,
  description: string,
  over: Partial<BuildPipelineNode["sop"]>,
  idx: number,
): BuildPipelineNode => ({
  id,
  label,
  position: { x: 80, y: 80 + idx * 90 },
  stepKey: id,
  enabled: true,
  sop: sop(description, over),
});

const chain = (nodes: BuildPipelineNode[]) => nodes.slice(1).map((n, i) => ({ from: nodes[i]!.id, to: n.id }));

/** 数据接入出厂链：解析 → 字段对账 → 落对账队列 → 发事件（镜像 FACTORY_INTAKE_NODES）。 */
const FACTORY_INTAKE_NODES: BuildPipelineNode[] = [
  node("intake_parse", "解析", "确定性抽取原型内嵌数据表 + 关系（不 eval、不调 LLM；R6 同输入同输出）。", {}, 0),
  node("intake_reconcile", "字段对账", "原型列 ↔ 既有本体字段：精确命中自动接，其余出候选给人确认。", {}, 1),
  node("intake_persist_candidates", "落对账队列", "把对账候选落库为 HITL 队列（人确认 USE/RENAME/NEW/MERGE/DISCARD）。", {}, 2),
  node("intake_emit", "发事件", "发 prototype.intake_recorded（数据表数/关系数/未解析数/候选数）。", {}, 3),
];

const FACTORY_INTAKE_IMPORT_NODES: BuildPipelineNode[] = [
  node("import_materialize", "物化进库", "经 prototype_html 连接器落 RawDataset（数据连接器可见 + 在线查看）。", {}, 0),
  node("import_project_datasets", "投影表清单", "列出该连接下的 RawDataset（id/名/行数/字段）。", {}, 1),
  node("import_emit", "发事件", "发 prototype.materialized（连接 id/表数/总行数）。", {}, 2),
];

const FACTORY_STORY_BUILD_NODES: BuildPipelineNode[] = [
  node("dry_build", "试建：出 BuildPlan + A 三向闭包（不发布）", "出 BuildPlan + A 三向闭包，不发布。失败即止，保留现场可 resume。", {}, 0),
  node("cross_scaffold", "跨系统下发：A 闭包通过则向 AgentCore 下发 B 栈 scaffold", "HTTP 瞬时失败有界退避重试至多 3 次；仍失败则止于该步。", { maxAttempts: 3 }, 1),
  node("gap_analysis", "比对现状：倒推 BuildPlan vs 系统现状（跨模块统一 diff）", "倒推 BuildPlan 与系统现状做统一 diff。", {}, 2),
  node("publish_build", "全链 HARD 门：A⊕B 闭合则真建 + 发布 + 落切片", "A⊕B 闭合才真建 + 发布 + 落切片；未闭合则跳过（拒发布，数据不落库）。", {}, 3),
  node("validation", "推演验证痕迹：结论依据反向核对知识图谱", "结论依据反向核对知识图谱。", {}, 4),
  node("inference", "一键推演：故事主问句经 QOS/求解器跑出答案", "故事主问句经 QOS/求解器跑出答案。", {}, 5),
  node("record", "记账：装配 StoryBuildRun 落库 + 发 storybuild.run_recorded", "装配 StoryBuildRun 落库 + 发 storybuild.run_recorded。", {}, 6),
];

const FACTORY_NODES: Record<BuildPipelineKind, BuildPipelineNode[]> = {
  story_build: FACTORY_STORY_BUILD_NODES,
  intake: FACTORY_INTAKE_NODES,
  intake_import: FACTORY_INTAKE_IMPORT_NODES,
};

const FACTORY_NAMES: Record<BuildPipelineKind, string> = {
  story_build: "出厂默认 · 故事建域",
  intake: "出厂默认 · 数据接入",
  intake_import: "出厂默认 · 数据导入",
};

export const BUILD_PIPELINE_KINDS: BuildPipelineKind[] = ["story_build", "intake", "intake_import"];

/** 出厂默认（未落库·factory:true）。深拷贝防调用方改动污染常量。 */
export function factoryPipeline(kind: BuildPipelineKind): BuildPipeline {
  const nodes = structuredClone(FACTORY_NODES[kind]);
  return { id: `bpp_factory_${kind}`, tenantId: "demo", kind, name: FACTORY_NAMES[kind], nodes, edges: chain(nodes), factory: true };
}

/** 生效定义 = 租户覆盖 ?? 出厂默认（与真后端 pipelines.resolve 同语义）。 */
export function resolvePipeline(kind: BuildPipelineKind): BuildPipeline {
  return db.buildPipelines[kind] ?? factoryPipeline(kind);
}

/** 执行顺序：有边按边拓扑，无边按数组序（与后端 projectPipelineOrder 同语义）。 */
export function pipelineOrder(p: BuildPipeline): BuildPipelineNode[] {
  if (p.edges.length === 0) return p.nodes;
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const indeg = new Map(p.nodes.map((n) => [n.id, 0]));
  for (const e of p.edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const queue = p.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const out: BuildPipelineNode[] = [];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (n) out.push(n);
    for (const e of p.edges.filter((x) => x.from === id)) {
      indeg.set(e.to, (indeg.get(e.to) ?? 1) - 1);
      if ((indeg.get(e.to) ?? 0) <= 0) queue.push(e.to);
    }
  }
  // 环/悬挂节点不静默丢：按数组序补回尾部（诚实优于"看起来跑完了"）。
  for (const n of p.nodes) if (!seen.has(n.id)) out.push(n);
  return out;
}
