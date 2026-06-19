import type { BuildPlan, ProducedArtifact, ProducedModule, ScaffoldReceipt, StoryBuildRun } from "@platform/contracts";

/** B 栈 scaffold 制品 kind → 下游模块（intent/plan 同归"意图/计划"目录页）。 */
const SCAFFOLD_KIND_TO_MODULE: Record<string, ProducedModule> = {
  intent: "catalog",
  plan: "catalog",
  workflow: "workflow",
  skill: "skill",
  agent: "agent",
  mcp: "mcp",
  scene: "scene",
};

/**
 * 区5 模块同步矩阵真值源（纯函数，确定性 R6）：把一次建域的产出聚合为 ProducedArtifact[]——
 *   - 数据连接器：真实差集捕获的连接器/数据集（CREATED + PUBLISHED，已落库）；
 *   - A 栈本体/切片/规则：建域成功 = CREATED + PUBLISHED；失败 = DRAFT（未生效，R4）；
 *   - 求解器：注册绑定非新建 → REUSED + PUBLISHED（缺失则不在 plan，落自检/工单）；
 *   - B 栈 scaffold：SCAFFOLDED=新建 DRAFT（R4 审批前未生效）· REUSED=既有复用 · MISSING=断链不入矩阵。
 */
export function deriveProducedArtifacts(
  plan: BuildPlan | undefined,
  scaffoldReceipt: ScaffoldReceipt | undefined,
  producedConnections: string[],
  producedDatasets: string[],
  status: StoryBuildRun["status"],
): ProducedArtifact[] {
  const published = status === "SUCCEEDED";
  const aStatus: ProducedArtifact["status"] = published ? "PUBLISHED" : "DRAFT";
  const arts: ProducedArtifact[] = [];

  for (const c of producedConnections) arts.push({ module: "connector", kind: "connection", key: c, action: "CREATED", status: "PUBLISHED" });
  for (const d of producedDatasets) arts.push({ module: "connector", kind: "dataset", key: d, action: "CREATED", status: "PUBLISHED" });

  if (plan) {
    for (const o of plan.objectTypes) arts.push({ module: "ontology", kind: "objectType", key: o.typeKey, action: "CREATED", status: aStatus });
    for (const s of plan.sliceNeeds) arts.push({ module: "slice", kind: "slice", key: s.sliceKey, action: "CREATED", status: aStatus });
    for (const r of plan.rules) arts.push({ module: "rule", kind: "rule", key: r.key, action: "CREATED", status: aStatus });
    for (const sn of plan.solverNeeds) arts.push({ module: "solver", kind: "solver", key: sn.solverKey, action: "REUSED", status: "PUBLISHED" });
  }

  for (const it of scaffoldReceipt?.items ?? []) {
    if (it.status === "MISSING") continue;
    const module = SCAFFOLD_KIND_TO_MODULE[it.kind];
    if (!module) continue;
    arts.push({
      module,
      kind: it.kind,
      key: it.key,
      action: it.status === "REUSED" ? "REUSED" : "CREATED",
      status: it.status === "REUSED" ? "PUBLISHED" : "DRAFT",
    });
  }

  return arts;
}
