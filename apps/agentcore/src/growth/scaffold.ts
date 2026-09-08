import type { ScaffoldDraft } from "@platform/contracts";
import type { Repos } from "../persistence/repos.js";
import type { CatalogService } from "../catalog/service.js";

/**
 * 自成长发动机 A3 · 真补：对 in-catalog 但缺执行计划的缺口（NO_PLAN / SOLVER_NOT_FOUND），
 * 自动 scaffold 一个 DRAFT 执行计划，绑 generic_inference 作 B 兜底求解器——把"需从零开发"降为
 * "DRAFT 已就绪、待审批发布/补全参数"（不自动发布，R4）。幂等：planKey 已存在则返回空（REUSED）。
 */

/** 问句 → 确定性短 slug（FNV-1a，R6：同问句同 key，保证跨轮幂等）。 */
export function questionSlug(q: string): string {
  let h = 2166136261;
  for (let i = 0; i < q.length; i++) {
    h ^= q.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export async function scaffoldDraftPlan(
  deps: { repos: Repos; catalog: CatalogService },
  tenantId: string,
  planKey: string,
  solverKey = "generic_inference",
): Promise<ScaffoldDraft[]> {
  const pkg = (await deps.repos.packages.listByTenant(tenantId))[0];
  if (!pkg) return [];
  const existing = await deps.repos.plans.listByPackage(pkg.id);
  if (existing.some((p) => p.key === planKey)) return []; // 幂等：已存在不重建
  await deps.catalog.createPlan(pkg.id, {
    key: planKey,
    steps: [
      { id: "s1", type: "invoke_solver", params: { solverKey, args: {} } },
      { id: "s2", type: "render_answer", params: { blocks: [] } },
    ],
  });
  return [{ kind: "plan", key: planKey }];
}

/**
 * 自成长发动机 · 第一弱点自补（NO_INTENT）：对**诊断为 NO_INTENT**（分类无候选命中、路径B agent 兜底作答本体外）
 * 的问句，不再只甩一张"骨架工单 advanced:false"，而是当场 **scaffold 一个 DRAFT 意图**——
 * query 作触发示例、绑一条 `scaffoldDraftPlan` 产的 DRAFT 兜底计划（generic_inference），
 * 使意图路由层从"无覆盖"降为"DRAFT 意图已就绪、待审批发布/补槽"。
 *
 * 镜像 `scaffoldDraftPlan`：
 *  - **幂等（R6）**：`intentKey = intent_growth_<questionSlug>` 已存在则返回空（REUSED，跨轮不重建）。
 *  - **DRAFT 不自动发布（R4）**：`catalog.createIntent` 恒落 `status:"DRAFT"`——DRAFT 意图不进分类候选，
 *    活体路由不受污染（"避免污染目录"由 R4 门守，而非拒绝 scaffold），须真人经正门发布方生效。
 *  - **planRef=latest**：绑同 slug 的 `plan_growth_<slug>`（先经 scaffoldDraftPlan 幂等确保存在）。
 * 返回本轮真新增的 DRAFT 制品（意图 + 若首建则含计划）；供工单回填 scaffoldedDrafts（施工=审批发布，非从零）。
 */
export async function scaffoldDraftIntent(
  deps: { repos: Repos; catalog: CatalogService },
  tenantId: string,
  query: string,
  solverKey = "generic_inference",
): Promise<ScaffoldDraft[]> {
  const pkg = (await deps.repos.packages.listByTenant(tenantId))[0];
  if (!pkg) return [];
  const slug = questionSlug(query);
  const intentKey = `intent_growth_${slug}`;
  const planKey = `plan_growth_${slug}`;
  const existingIntents = await deps.repos.intents.listByPackage(pkg.id);
  if (existingIntents.some((i) => i.key === intentKey)) return []; // 幂等：已存在不重建
  // 先幂等确保 DRAFT 兜底计划在（复用 scaffoldDraftPlan·绑 generic_inference）——若同 slug 计划已由 NO_PLAN 轮建则返回空。
  const planDrafts = await scaffoldDraftPlan(deps, tenantId, planKey, solverKey);
  // 建 DRAFT 意图（createIntent 恒 status:DRAFT → R4 不自动发布）·query 作触发示例·绑上面的兜底计划。
  await deps.catalog.createIntent(pkg.id, {
    key: intentKey,
    name: `未覆盖问句·草稿意图（${query.slice(0, 32)}）`,
    description: `自成长发动机据未覆盖问句 scaffold 的 DRAFT 意图（待审批发布 R4）：${query.slice(0, 200)}`,
    examples: [query.slice(0, 200)],
    enabledViews: "*",
    slots: [],
    planRef: { planKey, version: "latest" },
    riskLevel: "COMPUTE",
    owner: "growth-engine",
  });
  return [{ kind: "intent", key: intentKey }, ...planDrafts];
}
