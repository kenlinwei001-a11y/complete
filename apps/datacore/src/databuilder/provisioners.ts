// ModuleProvisioner 注册表 + 比对现状（gap_analysis）。
// "倒序"管线接缝：query→倒推 BuildPlan→**比对系统现状**→创建缺的。把散在 gap 阶段/闭包/scaffold
// 三处的"需要 vs 已有"收敛成一张跨模块统一 diff。模块全集 = BuildPlan 的 15 个 need 数组，一一对应
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
 * 无 existing() 的模块（B 栈 7 类在 AgentCore·DataCore 无法直查）→ 现状由 scaffold 回执判定；
 * 有 existing() 的模块（含 S0 沙盘配套 propagation_rule——side 虽为 cross_system 以取拓扑序最后位,
 * 但表 sim_propagation_rule 在 DataCore·可直查）→ 走 existing 真读。判据是 existing 有无,非 side。
 * autoCreatable=false（求解器=代码态；传导规则/状态变量=需领域判断的建模,S0 无 scaffolder）→ 缺则 MISSING（落工单），不会标 TO_CREATE。
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
  // —— 沙盘配套类（S0 WO-SANDBOX-CONFIG-COVERAGE）——
  // autoCreatable:false（诚实·派单单 §3.2 二选一取否）：S0 无 scaffolder（系数×延迟/formula 需领域判断·
  // KILL-MOCK-RED 不假 TO_CREATE 冒充"可自动建"）→ 缺则 MISSING → GrowthTicket。后续校准/建模 WO 落地 scaffold 后可翻 true。
  {
    // 状态变量 = 对象类型上的数值派生属性（沙盘态载体·app.ts stateVars 从传导规则派生的前提）。
    // side=structure：本体结构层,先于 cross_system（拓扑序:先有派生属性,传导规则才有得引用）。
    kind: "state_var", side: "structure", autoCreatable: false,
    planned: (p) => (p.stateVarNeeds ?? []).map((s) => `${s.typeKey}.${s.stateVar}`),
    existing: async ({ ontology }, ctx) => {
      const types = await ontology.listTypes(ctx);
      return new Set(types.flatMap((t) => (t.derivedProperties ?? []).map((d) => `${t.key}.${d.propKey}`)));
    },
  },
  {
    // 传导规则（PropagationRule·表 sim_propagation_rule）。side=cross_system：取四层拓扑序最后位
    //（依赖 state_var + link 都在才建规则）；现状仍 DataCore 直查（有 existing() 即走真读,非回执）。
    // existing 只认 PUBLISHED（默认 publishedOnly=true）：DRAFT 未晋升 = 推演仍缺（WO §3.5 "PROVISIONAL 未晋升"逐字）。
    kind: "propagation_rule", side: "cross_system", autoCreatable: false,
    planned: (p) => (p.propagationRuleNeeds ?? []).map((r) => r.key),
    existing: async ({ repos }, ctx) =>
      new Set((await repos.sim.listPropagationRules(ctx.tenantId)).map((r) => r.key)),
  },
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
  propagationRuleNeeds: "propagation_rule",
  stateVarNeeds: "state_var",
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
    // 分支判据 = existing 有无（非 side）：B 栈 7 类无 existing → 回执判定；有 existing（含 S0 沙盘配套
    // propagation_rule,side 虽 cross_system 但表在 DataCore）→ 直查真读。对改造前 13 类逐一等价（byte 门守恒）。
    if (!prov.existing) {
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
 * 8 类（有 existing() 的 provisioner：6 类 A 栈 + S0 沙盘配套 state_var/propagation_rule·additive 追加,
 * 旧消费方按 kind 取值不受影响）。7 类 B 栈（在 AgentCore）无 existing()——DataCore 看不见，
 * query 目标聚合归 AgentCore（架构决策 §3）。确定性：kind 与 key 均升序（R6）。
 */
export async function buildRegistrySnapshot(deps: ProvisionerDeps, ctx: AuthCtx): Promise<Record<string, string[]>> {
  const snapshot: Record<string, string[]> = {};
  for (const prov of MODULE_PROVISIONERS) {
    if (!prov.existing) continue; // 仅 DataCore 可直查的 kind
    snapshot[prov.kind] = [...(await prov.existing(deps, ctx))].sort();
  }
  return snapshot;
}

/** 一行摘要（喂工作流步 detail）：需 N · 复用 X · 新建 Y · 缺 Z。 */
export function summarizeGap(g: GapAnalysis): string {
  const t = g.totals;
  return `需 ${t.needed} · 复用 ${t.existing} · 新建 ${t.toCreate} · 缺 ${t.missing}`;
}
