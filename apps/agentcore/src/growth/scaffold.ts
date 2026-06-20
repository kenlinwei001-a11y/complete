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
