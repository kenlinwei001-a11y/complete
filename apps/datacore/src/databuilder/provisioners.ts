// ModuleProvisioner 注册表 + 比对现状（gap_analysis）。
// "倒序"管线接缝：query→倒推 BuildPlan→**比对系统现状**→创建缺的。把散在 gap 阶段/闭包/scaffold
// 三处的"需要 vs 已有"收敛成一张跨模块统一 diff。模块全集 = BuildPlan 的 13 个 need 数组，一一对应
// 注册表里的 provisioner——**新增模块必须注册**（provisioners.test 覆盖门强制；BuildPlan 任一根级数组
// 字段未登记即红，保证"倒序"无遗漏、未来新模块自动被纳入统一机制）。
import type { BuildPlan, GapAnalysis, GapSide, ModuleKind, ScaffoldReceipt } from "@platform/contracts";
import { diffGap } from "@platform/contracts";
import type { Repos } from "../repo/repo.js";
import type { OntologyService } from "../ontology.js";
import type { AuthCtx } from "../domain.js";
import { SOLVER_KEYS } from "../solvers/service.js";

export interface ProvisionerDeps {
  repos: Repos;
  ontology: OntologyService;
}

type Side = "content" | "structure" | "code" | "cross_system";

/**
 * 一个配套模块的"对接"定义：知道本计划需要它的哪些 key（planned），以及系统现状里已存在哪些（existing）。
 * cross_system 类（B 栈在 AgentCore）无法在 DataCore 直查 → 不实现 existing，其现状由 scaffold 回执判定。
 * autoCreatable=false（求解器=代码态）→ 缺则 MISSING（落工单），不会标 TO_CREATE。
 */
export interface ModuleProvisioner {
  kind: ModuleKind;
  side: Side;
  autoCreatable: boolean;
  planned(plan: BuildPlan): string[];
  existing?(deps: ProvisionerDeps, ctx: AuthCtx): Promise<Set<string>>;
}

const uniq = (xs: string[]): string[] => [...new Set(xs)];

/** 注册表：每类模块一个 provisioner。新增配套模块 = 在此追加一项（+ MODULE_KINDS 枚举 + BuildPlan need 数组）。 */
export const MODULE_PROVISIONERS: ModuleProvisioner[] = [
  // —— 内容类（产数据/文档；DatasetProvisioner 由合成数据模块后端供给，KbDocProvisioner 由知识库供给）——
  {
    kind: "dataset", side: "content", autoCreatable: true,
    planned: (p) => p.dataSources.map((d) => d.datasetKey),
    existing: async ({ repos }, ctx) =>
      new Set((await repos.rawDatasets.list(ctx.tenantId)).flatMap((d) => [d.name, d.name.replace(/\.csv$/, "")])),
  },
  {
    kind: "kb_doc", side: "content", autoCreatable: true,
    planned: (p) => p.kbDocs.map((d) => d.title),
    existing: async ({ repos }, ctx) =>
      new Set((await repos.kbDocs.list(ctx.tenantId)).map((d) => d.filename.replace(/\.txt$/, ""))),
  },
  // —— 结构类（DataCore 本体栈）——
  {
    kind: "ontology_type", side: "structure", autoCreatable: true,
    planned: (p) => p.objectTypes.map((t) => t.typeKey),
    existing: async ({ ontology }, ctx) => new Set((await ontology.listTypes(ctx)).map((t) => t.key)),
  },
  {
    kind: "rule", side: "structure", autoCreatable: true,
    planned: (p) => p.rules.map((r) => r.key),
    existing: async ({ repos }, ctx) => new Set((await repos.rules.list(ctx.tenantId)).map((r) => r.key)),
  },
  {
    kind: "slice", side: "structure", autoCreatable: true,
    planned: (p) => p.sliceNeeds.map((s) => s.sliceKey),
    existing: async ({ repos }, ctx) => new Set((await repos.sliceSpecs.list(ctx.tenantId)).map((s) => s.sliceKey)),
  },
  // —— 代码类（求解器是纯函数代码，不能自动建；缺则落工单）——
  {
    kind: "solver", side: "code", autoCreatable: false,
    planned: (p) => p.solverNeeds.map((s) => s.solverKey),
    existing: async () => new Set<string>(SOLVER_KEYS),
  },
  // —— 跨系统类（AgentCore B 栈；现状由 scaffold 回执判定，不在 DataCore 直查）——
  { kind: "intent", side: "cross_system", autoCreatable: true, planned: (p) => p.intentNeeds.map((x) => x.intentKey) },
  { kind: "plan", side: "cross_system", autoCreatable: true, planned: (p) => p.planNeeds.map((x) => x.planKey) },
  { kind: "workflow", side: "cross_system", autoCreatable: true, planned: (p) => p.workflowNeeds.map((x) => x.workflowKey) },
  { kind: "skill", side: "cross_system", autoCreatable: true, planned: (p) => p.skillNeeds.map((x) => x.skillKey) },
  { kind: "agent", side: "cross_system", autoCreatable: true, planned: (p) => p.agentNeeds.map((x) => x.agentKey) },
  { kind: "scene", side: "cross_system", autoCreatable: true, planned: (p) => p.sceneNeeds.map((x) => x.scenarioKey) },
  { kind: "mcp", side: "cross_system", autoCreatable: true, planned: (p) => p.mcpNeeds.map((x) => x.serverName) },
];

/**
 * BuildPlan 的根级 need 数组字段 → 模块 kind。**单一来源**：gap 覆盖门用它断言
 * "BuildPlan 每个根级数组字段都已登记 + 已注册 provisioner"。新增 need 数组未登记即测试红。
 */
export const NEED_ARRAY_TO_KIND: Record<string, ModuleKind> = {
  dataSources: "dataset",
  kbDocs: "kb_doc",
  objectTypes: "ontology_type",
  rules: "rule",
  sliceNeeds: "slice",
  solverNeeds: "solver",
  intentNeeds: "intent",
  planNeeds: "plan",
  workflowNeeds: "workflow",
  skillNeeds: "skill",
  agentNeeds: "agent",
  sceneNeeds: "scene",
  mcpNeeds: "mcp",
};

/**
 * 比对现状：倒推 BuildPlan vs 系统现状 → 跨模块统一 diff（EXISTS 复用 / TO_CREATE 需新建 / MISSING 不能自动建）。
 * 结构/内容/代码类直查 DataCore；cross_system 类（B 栈）由 scaffold 回执判定（REUSED→EXISTS / MISSING→MISSING /
 * SCAFFOLDED 或无回执→TO_CREATE）。仅报含 need 的模块（needed>0）。无网络/无 LLM，同输入同输出（R6）。
 */
export async function analyzeGap(
  deps: ProvisionerDeps,
  ctx: AuthCtx,
  plan: BuildPlan,
  scaffoldReceipt?: ScaffoldReceipt,
): Promise<GapAnalysis> {
  // 无损改造（PRD §5/§6）：收集 required/existing → 调共享纯核 diffGap。对外签名与输出 byte 与改造前一致
  //（唯一调用点 service.ts 零改）。cross_system 三态经 existing(REUSED) + missing(scaffold MISSING) 集合
  // 传给 diffGap 忠实复现（SCAFFOLDED/无回执 → autoCreatable=true → TO_CREATE）。
  const recByKind = new Map<string, Map<string, "REUSED" | "SCAFFOLDED" | "MISSING">>();
  for (const it of scaffoldReceipt?.items ?? []) {
    if (!recByKind.has(it.kind)) recByKind.set(it.kind, new Map());
    recByKind.get(it.kind)!.set(it.key, it.status);
  }
  const required: Partial<Record<string, string[]>> = {};
  const existing: Partial<Record<string, ReadonlySet<string>>> = {};
  const missing: Partial<Record<string, ReadonlySet<string>>> = {};
  const side: Record<string, GapSide> = {};
  const autoCreatable: Record<string, boolean> = {};
  for (const prov of MODULE_PROVISIONERS) {
    side[prov.kind] = prov.side;
    autoCreatable[prov.kind] = prov.autoCreatable;
    const planned = uniq(prov.planned(plan));
    if (planned.length === 0) continue;
    required[prov.kind] = planned;
    if (prov.side === "cross_system") {
      const rec = recByKind.get(prov.kind);
      const ex = new Set<string>();
      const miss = new Set<string>();
      for (const key of planned) {
        const s = rec?.get(key);
        if (s === "REUSED") ex.add(key);
        else if (s === "MISSING") miss.add(key);
        // SCAFFOLDED / 无回执 → 不入两集 → diffGap 按 autoCreatable=true 判 TO_CREATE（与改造前一致）。
      }
      existing[prov.kind] = ex;
      if (miss.size > 0) missing[prov.kind] = miss;
    } else {
      existing[prov.kind] = await prov.existing!(deps, ctx);
    }
  }
  return diffGap(required, existing, { side, autoCreatable, missing, generatedAt: new Date().toISOString() });
}

/**
 * 有界配套现状快照（PRD §3/§11 · GET /a/v1/databuilder/registry-snapshot）：仅返回 DataCore 真拥有的
 * 6 类 A 栈（有 existing() 的 provisioner）。7 类 cross_system（B 栈在 AgentCore）无 existing()——
 * DataCore 看不见，query 目标聚合归 AgentCore（架构决策 §3）。确定性：kind 与 key 均升序（R6）。
 */
export async function buildRegistrySnapshot(deps: ProvisionerDeps, ctx: AuthCtx): Promise<Record<string, string[]>> {
  const snapshot: Record<string, string[]> = {};
  for (const prov of MODULE_PROVISIONERS) {
    if (!prov.existing) continue; // 仅 6 类 A 栈（content/structure/code）
    snapshot[prov.kind] = [...(await prov.existing(deps, ctx))].sort();
  }
  return snapshot;
}

/** 一行摘要（喂工作流步 detail）：需 N · 复用 X · 新建 Y · 缺 Z。 */
export function summarizeGap(g: GapAnalysis): string {
  const t = g.totals;
  return `需 ${t.needed} · 复用 ${t.existing} · 新建 ${t.toCreate} · 缺 ${t.missing}`;
}
