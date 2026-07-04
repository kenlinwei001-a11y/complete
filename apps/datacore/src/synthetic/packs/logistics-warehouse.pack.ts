import type { IndustryPack, IndustryScenario, IndustryViewDef } from "@platform/contracts";
import { LOGISTICS_TEMPLATE } from "../logistics.js";
import { DEFAULT_SIM_T0 } from "../../clockderive.js";

/**
 * 物流仓配选址行业包（`packs/` 目录约定 · G-12 非电池行业 · 换行业零码实证 · 文件名 = industryKey）。
 *
 * 引用既有 `LOGISTICS_TEMPLATE`（零业务常数 R14）。本包**自带非电池 viewLayouts + 决策场景卡**（C3 活体）：
 *   · views     = 配送网络看板（dashboard·config-driven·KPI 全来自 Warehouse/Store 对象聚合·非电池 KPI）。
 *   · scenarios = 决策场景卡（问题 + 声明式答案 query，浏览器可答·逐值对后端对象库）。
 *   · solverKeys= 选址族求解器子集（绑定共享 SOLVER_REGISTRY·descriptor 零改）——facility_location 真 CP-SAT 需 OR-Tools sidecar
 *      （env-gated·opt-logistics-industry / opt-real-sidecar 测试证）；无 sidecar 环境场景卡用对象聚合直答（真数据）。
 *   · entities  = 无应用细分（segments=[]）；clock 走平台默认 t0。
 * **加载器为其装配全栈——无任何跨文件代码改动**（新增行业 = 加 `packs/<key>.pack.ts` 一个文件）。
 */

/** 配送网络看板视图（renderer=dashboard·KPI/表全为声明式 query·前端零写死 R14·非电池 KPI）。 */
const logisticsViews: Record<string, IndustryViewDef> = {
  "logi-network": {
    title: "配送网络看板",
    renderer: "dashboard",
    // moduleLinks/feedbackChain 置空 → 剥离通用看板的电池链路 chrome（config 覆盖·前端零改）。
    layout: {
      moduleLinks: [],
      feedbackChain: [],
      widgets: [
        {
          key: "store-count", type: "kpi", title: "门店总数", unit: "家",
          query: { kind: "objects-aggregate", objectType: "Store", agg: "count", prop: "storeId" },
          provenance: { toolName: "query_objects", outputPath: "$.count", label: "count(Store) 门店行计数", inputs: ["Store.storeId"], sourceSystem: "本体对象库·Store（门店主数据）" },
        },
        {
          key: "wh-count", type: "kpi", title: "配送仓总数", unit: "座",
          query: { kind: "objects-aggregate", objectType: "Warehouse", agg: "count", prop: "whId" },
          provenance: { toolName: "query_objects", outputPath: "$.count", label: "count(Warehouse) 配送仓行计数", inputs: ["Warehouse.whId"], sourceSystem: "本体对象库·Warehouse（配送仓主数据）" },
        },
        {
          key: "demand-total", type: "kpi", title: "月度配送需求总量", unit: "件",
          query: { kind: "objects-aggregate", objectType: "Store", agg: "sum", prop: "demand" },
          provenance: { toolName: "query_objects", outputPath: "$.sum(demand)", label: "Σ Store.demand 全网月度需求", inputs: ["Store.demand"], sourceSystem: "本体对象库·Store（需求）" },
        },
        {
          key: "capacity-total", type: "kpi", title: "总日吞吐产能", unit: "件/日",
          query: { kind: "objects-aggregate", objectType: "Warehouse", agg: "sum", prop: "capacity" },
          provenance: { toolName: "query_objects", outputPath: "$.sum(capacity)", label: "Σ Warehouse.capacity 全网日吞吐", inputs: ["Warehouse.capacity"], sourceSystem: "本体对象库·Warehouse（吞吐产能）" },
        },
        {
          key: "avg-serve-cost", type: "kpi", title: "平均单仓服务成本", unit: "元/件",
          query: { kind: "objects-aggregate", objectType: "Warehouse", agg: "avg", prop: "serveCost" },
          provenance: { toolName: "query_objects", outputPath: "$.avg(serveCost)", label: "avg(Warehouse.serveCost) 服务成本均值", inputs: ["Warehouse.serveCost"], sourceSystem: "本体对象库·Warehouse（服务成本）" },
        },
        {
          key: "avg-open-cost", type: "kpi", title: "平均开仓成本", unit: "万元",
          query: { kind: "objects-aggregate", objectType: "Warehouse", agg: "avg", prop: "openCost" },
          provenance: { toolName: "query_objects", outputPath: "$.avg(openCost)", label: "avg(Warehouse.openCost) 开仓成本均值", inputs: ["Warehouse.openCost"], sourceSystem: "本体对象库·Warehouse（开仓成本）" },
        },
        {
          key: "warehouse-table", type: "table", title: "配送仓清单（候选设施）", span: 2,
          query: { kind: "objects", objectType: "Warehouse", columns: ["whId", "region", "openCost", "serveCost", "capacity"], limit: 20 },
          provenance: { toolName: "query_objects", outputPath: "$.items", label: "Warehouse 对象查询（选址候选设施）", sourceSystem: "本体对象库·Warehouse" },
        },
        {
          key: "store-table", type: "table", title: "门店清单（需求点）", span: 2,
          query: { kind: "objects", objectType: "Store", columns: ["storeId", "region", "demand"], limit: 20 },
          provenance: { toolName: "query_objects", outputPath: "$.items", label: "Store 对象查询（需求点）", sourceSystem: "本体对象库·Store" },
        },
      ],
    },
  },
};

/**
 * 决策场景卡（C3 活体·浏览器可答·逐值对后端对象库）。
 * 均以 objects-aggregate / objects 声明式 query 直答（真数据·确定性 R6·不依赖外部 sidecar）；
 * facility_location 选址最优化（真 CP-SAT）由 solverKeys 绑定 + env-gated 集成测试证（无 sidecar 环境不作浏览器活体）。
 */
const logisticsScenarios: IndustryScenario[] = [
  {
    key: "network-demand",
    title: "配送网络覆盖规模",
    question: "全网需覆盖多少月度配送需求量？（选址覆盖规模输入）",
    answer: { kind: "objects-aggregate", objectType: "Store", agg: "sum", prop: "demand", unit: "件" },
  },
  {
    key: "site-cost-profile",
    title: "候选配送仓成本画像",
    question: "各候选配送仓的开仓成本 / 服务成本 / 日吞吐如何？（选址最优化输入清单）",
    answer: { kind: "objects", objectType: "Warehouse", columns: ["whId", "region", "openCost", "serveCost", "capacity"], limit: 20 },
  },
];

export const pack: IndustryPack = {
  industryKey: "logistics-warehouse",
  template: LOGISTICS_TEMPLATE,
  // 物流选址栈消费的求解器子集（绑定共享 SOLVER_REGISTRY·descriptor 零改）——facility_location 族 + 通用推演。
  solverKeys: ["facility_location", "min_cost_flow", "set_cover", "generic_inference", "optimize_whatif"],
  views: logisticsViews,
  scenarios: logisticsScenarios,
  entities: { segments: [] },
  clock: { t0: DEFAULT_SIM_T0 },
};
