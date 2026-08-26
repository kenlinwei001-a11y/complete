// ModuleProvisioner 注册表 + 比对现状（gap_analysis）。
// "倒序"管线接缝：query→倒推 BuildPlan→**比对系统现状**→创建缺的。把散在 gap 阶段/闭包/scaffold
// 三处的"需要 vs 已有"收敛成一张跨模块统一 diff。模块全集 = BuildPlan 的 13 个 need 数组，一一对应
// 注册表里的 provisioner——**新增模块必须注册**（provisioners.test 覆盖门强制；BuildPlan 任一根级数组
// 字段未登记即红，保证"倒序"无遗漏、未来新模块自动被纳入统一机制）。
import type {
  BuildNeedsReport,
  BuildPlan,
  GapAnalysis,
  GapAnalysisEntry,
  GapItem,
  GapStatus,
  ModuleKind,
  NeedGroup,
  NeedItem,
  NeedItemStatus,
  ScaffoldReceipt,
} from "@platform/contracts";
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
  const recByKind = new Map<string, Map<string, "REUSED" | "SCAFFOLDED" | "MISSING">>();
  for (const it of scaffoldReceipt?.items ?? []) {
    if (!recByKind.has(it.kind)) recByKind.set(it.kind, new Map());
    recByKind.get(it.kind)!.set(it.key, it.status);
  }
  const entries: GapAnalysisEntry[] = [];
  for (const prov of MODULE_PROVISIONERS) {
    const planned = uniq(prov.planned(plan));
    if (planned.length === 0) continue;
    let items: GapItem[];
    if (prov.side === "cross_system") {
      const rec = recByKind.get(prov.kind);
      items = planned.map((key) => {
        const s = rec?.get(key);
        const status: GapStatus = s === "REUSED" ? "EXISTS" : s === "MISSING" ? "MISSING" : "TO_CREATE";
        return { key, status };
      });
    } else {
      const existing = await prov.existing!(deps, ctx);
      items = planned.map((key) => ({ key, status: existing.has(key) ? "EXISTS" : prov.autoCreatable ? "TO_CREATE" : "MISSING" }));
    }
    entries.push({
      kind: prov.kind,
      side: prov.side,
      needed: items.length,
      existing: items.filter((i) => i.status === "EXISTS").length,
      toCreate: items.filter((i) => i.status === "TO_CREATE").length,
      missing: items.filter((i) => i.status === "MISSING").length,
      items,
    });
  }
  const totals = entries.reduce(
    (a, e) => ({ needed: a.needed + e.needed, existing: a.existing + e.existing, toCreate: a.toCreate + e.toCreate, missing: a.missing + e.missing }),
    { needed: 0, existing: 0, toCreate: 0, missing: 0 },
  );
  return { entries, totals, generatedAt: new Date().toISOString() };
}

/** 一行摘要（喂工作流步 detail）：需 N · 复用 X · 新建 Y · 缺 Z。 */
export function summarizeGap(g: GapAnalysis): string {
  const t = g.totals;
  return `需 ${t.needed} · 复用 ${t.existing} · 新建 ${t.toCreate} · 缺 ${t.missing}`;
}

// ---------------------------------------------------------------------------
// 建**之前**的 13 类缺口清单（WO-DBUI-13-NEEDS）
//
// ── 这一段修的是什么病（先说清楚，免得下一个人又诊错）───────────────────────────
// 病**不是**「BuildPlan 没有按 id 读的端点」—— `GET /a/v1/data-builders/plans/:id`
// （`app.ts` 的 data-builders 路由段）**早就有**：2026-08-15 实测，干跑后立刻 200 且 13 个
// need 数组全在。复验 `test/databuilder-needs.seam.test.ts` §0（这句话的可执行版本）。
// 真病是**「接了线接错地方」**：`analyzeGap` 有两个生产调用方（工作流的 gap 步 / 入库前复验），
// 唯独**干跑这条路上没挂** —— 干跑直接 `setPhase("gap","SKIPPED")`，
// 回执只塞了 5 个键的 `job.preview`。计划就在同一个函数作用域里躺着，只是没人去比对现状。
//
// ── 为什么不直接复用 `analyzeGap`（两者差在哪，差的正是诚实位）────────────────────
//  ① `analyzeGap` **跳过 needed=0 的类**（`if (planned.length === 0) continue`）⇒ 13 类只回来一部分，
//     而「本次用不到工作流」本身就是用户要的答案之一，不该消失。
//  ② `analyzeGap` 在**没有 scaffold 回执**时，把 7 类跨系统需求**一律默认成 `TO_CREATE`**。
//     建完之后有回执，这个默认是对的；**建之前没有回执**，它就变成了**拿猜当测** ——
//     屏上会显示「本次新建 2 个工作流」，而真相是「DataCore 这一刻根本不知道 B 栈有没有」。
//     A→B 今天只有 `POST /b/v1/internal/scaffold` 一条路，它是**下发即创建**、没有只读探针。
//     故本函数对这种情形出 `UNKNOWN` + `evidence:"NOT_PROBED"`，**绝不写 0**（0 会被读成「不缺」）。
//
// 两个函数共用同一份 `MODULE_PROVISIONERS` 注册表 —— 单一来源在**注册表**上，不在这两个投影上。
// ---------------------------------------------------------------------------

/** 跨系统回执状态 → 本次现状。**没有回执项 = 查不到**（`UNKNOWN`），不是「要新建」。 */
function crossSystemStatus(s: "REUSED" | "SCAFFOLDED" | "MISSING" | undefined): NeedItemStatus {
  if (s === "REUSED") return "EXISTS";
  if (s === "SCAFFOLDED") return "TO_CREATE";
  if (s === "MISSING") return "MISSING";
  return "UNKNOWN";
}

/**
 * 13 类逐类的「需要几个 / 各是哪几个 / 现状如何」。
 *
 * @param scaffoldReceipt 有回执（建之后）⇒ 跨系统类也能定状态；无回执（建之前）⇒ 跨系统类如实 UNKNOWN。
 */
export async function buildNeedsReport(
  deps: ProvisionerDeps,
  ctx: AuthCtx,
  plan: BuildPlan,
  scaffoldReceipt?: ScaffoldReceipt,
): Promise<BuildNeedsReport> {
  const recByKind = new Map<string, Map<string, "REUSED" | "SCAFFOLDED" | "MISSING">>();
  for (const it of scaffoldReceipt?.items ?? []) {
    if (!recByKind.has(it.kind)) recByKind.set(it.kind, new Map());
    recByKind.get(it.kind)!.set(it.key, it.status);
  }

  const groups: NeedGroup[] = [];
  for (const prov of MODULE_PROVISIONERS) {
    // ⚠ 与 analyzeGap 的关键差别：**不跳过 needed=0** —— 「本次用不到」也要说出口。
    const planned = uniq(prov.planned(plan));
    let items: NeedItem[];
    if (prov.side === "cross_system") {
      const rec = recByKind.get(prov.kind);
      items = planned.map((key) => ({ key, status: crossSystemStatus(rec?.get(key)) }));
    } else {
      const existing = await prov.existing!(deps, ctx);
      items = planned.map((key) => ({
        key,
        status: existing.has(key) ? "EXISTS" : prov.autoCreatable ? "TO_CREATE" : "MISSING",
      }));
    }
    const count = (s: NeedItemStatus): number => items.filter((i) => i.status === s).length;
    const unknown = count("UNKNOWN");
    groups.push({
      kind: prov.kind,
      side: prov.side,
      // 证据强度**从数据派生**，不是另写一套判断：有任何一条查不到，这一组就不算查过。
      evidence: unknown > 0 ? "NOT_PROBED" : "PROBED",
      needed: items.length,
      existing: count("EXISTS"),
      toCreate: count("TO_CREATE"),
      missing: count("MISSING"),
      unknown,
      items,
    });
  }

  const totals = groups.reduce(
    (a, g) => ({
      needed: a.needed + g.needed,
      existing: a.existing + g.existing,
      toCreate: a.toCreate + g.toCreate,
      missing: a.missing + g.missing,
      unknown: a.unknown + g.unknown,
    }),
    { needed: 0, existing: 0, toCreate: 0, missing: 0, unknown: 0 },
  );

  return {
    groups,
    totals,
    unprobedKinds: groups.filter((g) => g.evidence === "NOT_PROBED").map((g) => g.kind),
    generatedAt: new Date().toISOString(),
  };
}

/** 一行摘要（喂阶段 detail）：需 N · 复用 X · 待建 Y · 建不出 Z · 查不到 U。 */
export function summarizeNeeds(r: BuildNeedsReport): string {
  const t = r.totals;
  return `需 ${t.needed} · 复用 ${t.existing} · 待建 ${t.toCreate} · 建不出 ${t.missing} · 现状查不到 ${t.unknown}`;
}
