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
  // 20 场景目录 §2 新增 13（成熟度 E6a）
  { key: "mitigation_select", name: "处置方案优选", description: "按因素从方案库打分排序，给推荐案与草稿 payload。", argHints: { baseName: "基地名", factor: "风险因素" }, domain: "plan" },
  { key: "cert_schedule", name: "认证排期", description: "按缺口贡献/工时优先级，受 C26 并行约束贪心排认证到周。", argHints: { items: "待认证集", engineerGroups: "工程师组数" }, domain: "plan" },
  { key: "kit_readiness", name: "物料齐套", description: "逐单算齐套率（含在途按 ETA），输出缺料与建议。", argHints: { orders: "订单+物料数据" }, domain: "plan" },
  { key: "lta_gap", name: "长协补缺", description: "净需求/覆盖率/现货缺口与分批 PO 建议。", argHints: { material: "物料", month: "月份" }, domain: "plan" },
  { key: "inventory_optimize", name: "库存优化", description: "目标水位/超储/欠储/呆滞与可释放资金。", argHints: { materials: "物料库存数据" }, domain: "plan" },
  { key: "changeover_sequence", name: "换型排序", description: "最近邻贪心最小化换型时长，标注交期不可行单。", argHints: { lineId: "产线", orders: "周订单" }, domain: "plan" },
  { key: "yield_diagnosis", name: "良率诊断", description: "2σ 滑窗突变检测 + 根因候选按时间贴近度排序。", argHints: { processKey: "工序", series: "良率时序" }, domain: "plan" },
  { key: "maintenance_stagger", name: "检修错峰", description: "检修周与交付高峰冲突 → ±4 周内选负荷最低周。", argHints: { bases: "基地检修+负荷" }, domain: "plan" },
  { key: "outsourcing_split", name: "外协分配", description: "加班/外协/延期三渠道按单位成本升序贪心分配。", argHints: { gap: "缺口", weeks: "周数" }, domain: "plan" },
  { key: "quote_margin", name: "接单毛利", description: "BOM 成本四项分解 + 毛利率对比细分底线。", argHints: { price: "报价", bom: "BOM" }, domain: "plan" },
  { key: "credit_exposure", name: "信用敞口", description: "敞口=应收+在产；可用额与逾期判定（C32）。", argHints: { custName: "客户", creditLimit: "额度" }, domain: "plan" },
  { key: "quarterly_gap", name: "季度缺口对策", description: "对策按成本升序贪心覆盖季度缺口，残余明示。", argHints: { quarter: "季度", gap: "缺口" }, domain: "plan" },
  { key: "carbon_footprint", name: "碳足迹核算", description: "物料+能耗两段碳排，对比欧盟阈值给改善杠杆。", argHints: { modelId: "型号", baseName: "基地" }, domain: "plan" },
  { key: "countermeasure_combo", name: "对策组合编排器", description: "跨求解器编排：多杠杆按成本贪心闭合缺口，每段标注来源求解器，返回组合/残差/总成本/可行性。", argHints: { gap: "缺口", levers: "杠杆集(可选)" }, domain: "plan" },
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
    // §1：带关键词的发现（agent 上下文预算）截断 ≤20；无关键词=管理台全量列表。
    return { items: query ? filtered.slice(0, 20) : filtered };
  }
}
