import type { AuthCtx } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { FeatureService } from "./features.js";

/**
 * 能力发现与路由增量 §1：资源目录（discover 的供给侧）。
 *
 * 切片/求解器注册元数据（key/name/description/argHints/domain）——「没有给 LLM 看的
 * 描述就不允许发布」即目录可发现性纪律。权限与功能开通在目录层即过滤（无权/未开通的
 * 能力不出现，与"404 不泄露存在性"一致）。
 */

export interface CatalogItem {
  key: string;
  name: string;
  description: string;
  argHints: Record<string, string>;
  domain?: string;
  /** 关联 feature key（未开通 → 不出现在目录）。 */
  featureKey?: string;
}

/** 内置切片目录（与 ontology.resolveSlice 的内置分支一一对应）。 */
export const BUILTIN_SLICE_CATALOG: CatalogItem[] = [
  {
    key: "model_capacity_network",
    name: "型号可产基地网络",
    description: "给定型号，返回其可生产的基地子图（型号→可产基地的 PRODUCIBLE_AT 边）。回答『某型号能在哪些基地生产』类问题。",
    argHints: { modelId: "型号 ID，如 4680-NCM" },
    domain: "product",
  },
  {
    key: "base_risk_profile",
    name: "基地风险画像",
    description: "给定基地，返回该基地的风险画像子图（关联订单/瓶颈/风险项）。回答『某基地当前风险状况』类问题。",
    argHints: { baseId: "基地 ID，如 changzhou" },
    domain: "plan",
  },
];

/** 求解器目录（与 SOLVER_KEYS 对齐；描述供 LLM 选型）。 */
export const SOLVER_CATALOG: CatalogItem[] = [
  { key: "capacity_rollup", name: "产能上卷", description: "把工序/产线产能沿本体金字塔上卷到基地/型号维度。", argHints: { modelId: "型号 ID" }, domain: "plan" },
  { key: "capacity_forecast", name: "产能推演", description: "给定型号/数量/周数，推演产能满足度（P50/P90、缺口率、主瓶颈）。", argHints: { modelId: "型号 ID", qty: "需求量", weeks: "周数" }, domain: "plan" },
  { key: "bottleneck_matrix", name: "瓶颈矩阵", description: "按基地×工序输出瓶颈强度矩阵，定位约束工序。", argHints: { baseId: "基地 ID" }, domain: "plan" },
  { key: "risk_timeline", name: "风险时间线", description: "按日推演风险时序（越线点/根因链）。", argHints: { baseId: "基地 ID", days: "天数" }, domain: "plan" },
  { key: "affected_orders", name: "受影响订单", description: "给定扰动，返回受影响订单清单（problems/rootChain）。", argHints: { baseId: "基地 ID" }, domain: "plan" },
  { key: "plan_audit", name: "计划体检", description: "对给定计划版本做体检评分（达成率/风险敞口）。", argHints: { versionId: "计划版本 ID" }, domain: "plan", featureKey: "view.plan-audit" },
  { key: "plan_generate", name: "计划生成", description: "按目标与约束生成候选排产计划。", argHints: { objective: "目标口径" }, domain: "plan" },
  { key: "capex_scenario", name: "年度情景测算", description: "三情景产能投资测算（供给曲线/缺口窗口/项目级 IRR/util24/C23 判定）。", argHints: { scenario: "情景 key" }, domain: "plan" },
];

function matches(item: CatalogItem, query?: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    item.key.toLowerCase().includes(q) ||
    item.name.toLowerCase().includes(q) ||
    item.description.toLowerCase().includes(q)
  );
}

export class CatalogService {
  constructor(private repos: Repos, private features: FeatureService) {}

  /** §1: discover 目录（≤20，关键词过滤 + 权限/功能开通过滤）。 */
  async discover(
    ctx: AuthCtx,
    kind: "slices" | "solvers",
    query?: string,
  ): Promise<{ items: CatalogItem[] }> {
    let items: CatalogItem[];
    if (kind === "solvers") {
      items = SOLVER_CATALOG;
    } else {
      // 内置 + 已发布的自定义切片（自定义切片必须带 description，否则不入目录）
      const custom = await this.repos.sliceSpecs.list(ctx.tenantId);
      const customItems: CatalogItem[] = custom
        .filter((s) => typeof (s.spec as { description?: string }).description === "string" && (s.spec as { description?: string }).description!.trim() !== "")
        .map((s) => ({
          key: s.sliceKey,
          name: s.sliceKey,
          description: (s.spec as { description?: string }).description ?? "",
          argHints: ((s.spec as { argHints?: Record<string, string> }).argHints ?? {}),
          domain: (s.spec.root?.typeKey ? undefined : undefined),
        }));
      items = [...BUILTIN_SLICE_CATALOG, ...customItems];
    }
    // feature 过滤（未开通 → 不出现）
    const filtered: CatalogItem[] = [];
    for (const it of items) {
      if (!matches(it, query)) continue;
      if (it.featureKey && !(await this.features.enabled(ctx.tenantId, it.featureKey))) continue;
      filtered.push(it);
    }
    return { items: filtered.slice(0, 20) };
  }
}
