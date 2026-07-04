import type { IndustryPack, IndustryViewDef } from "@platform/contracts";
import { SEG_REGISTRY } from "@platform/contracts";
import { SOLVER_REGISTRY, type SolverDescriptor } from "../solvers/solver-registry.js";
import { DEFAULT_SIM_T0 } from "../clockderive.js";
import { BATTERY_TEMPLATE, BATTERY_SOLVER_PARAMS } from "./battery.js";
import { LOGISTICS_TEMPLATE } from "./logistics.js";

/**
 * IndustryPack 加载器（P1 北极星 · R14 零跨文件电池硬编码收口 · 契约 `@platform/contracts industrypack.ts`）。
 *
 * 本模块是**行业栈的单一装配点**：把 5 前置 HARDCODE WO 各自 genericize 的层
 * （派发 SolverDescriptor / 结构 ViewConfig.layout / 阈值 SolverParam / 时间 t0 / 实体 SEG）
 * **收敛为单一声明式 IndustryPack 实例** + 一个 `loadIndustryPack` 加载器。runJob/seed 消费 pack 装配全栈。
 *
 * **收编（byte-identical·R6）**：电池现有散落配置以**引用**收入 `batteryPack`——
 *   · template  = `BATTERY_TEMPLATE`（ontology/generation/rules/scenarioSeed.intents/solverParams/features/…）
 *   · params    = `BATTERY_TEMPLATE.solverParams` = `BATTERY_SOLVER_PARAMS`（同一对象，阈值层单源）
 *   · views     = `BATTERY_VIEW_FRAGMENTS` 组装（结构层：曾内联在 service.ts seedViewConfigs 的电池视图结构数据）
 *   · entities  = `SEG_REGISTRY`（实体层：应用细分/关键词；值域在 template.generation.propGenerators.valueDomain）
 *   · clock.t0  = `BATTERY_SOLVER_PARAMS.forecastStart`（时间层：sim-clock t0 权威）
 *   · solver    = 省略 solverKeys → 消费全平台 `SOLVER_REGISTRY`（descriptor 平台共享·R14 零业务常数）
 * 搬家不改值——现有测试断言不变即证 R6。
 *
 * **换行业零码**：`logistics-warehouse` 只写一份 `logisticsPack`（引用既有 `LOGISTICS_TEMPLATE`）+ 登记进
 *   `PACK_REGISTRY`，加载器即为其装配全栈——无任何跨文件代码改动（G-12 非电池行业实证）。
 */

// ---------------------------------------------------------------------------
// 结构层收编：电池业务视图结构数据（曾内联在 service.ts seedViewConfigs 的写死片段·AUDIT β1–β7）。
// 迁入 pack = 换行业换 pack.views 即界面结构随之变（G-5 8a）。值逐字不变 → byte-identical。
// ---------------------------------------------------------------------------

/** 规划体检字段组（需求/供给/财务三侧·含 乘用车/储能/商用车 应用细分行）。 */
export const PLAN_AUDIT_FIELD_GROUPS = [
  {
    title: "需求侧（万套）",
    fields: [
      { key: "dem", label: "月度需求总量", unit: "万套", step: 0.1 },
      { key: "seg_pas", label: "乘用车", unit: "万套", step: 0.1 },
      { key: "seg_ess", label: "储能", unit: "万套", step: 0.1 },
      { key: "seg_com", label: "商用车", unit: "万套", step: 0.1 },
    ],
  },
  {
    title: "供给侧",
    fields: [
      { key: "sup", label: "月度可供给", unit: "万套", step: 0.1 },
      { key: "ltaCov", label: "长协覆盖率", unit: "%", step: 1 },
      { key: "kitGap", label: "正极物料缺口", unit: "吨", step: 10 },
    ],
  },
  {
    title: "财务侧",
    fields: [
      { key: "gmTarget", label: "毛利率目标", unit: "%", step: 0.5 },
      { key: "cashCushion", label: "现金安全垫(13周最低点)", unit: "亿", step: 0.5 },
      { key: "capex", label: "CAPEX 本月", unit: "亿", step: 0.5 },
    ],
  },
];

/** 方案生成六目标字段。 */
export const PLAN_GENERATE_GOAL_FIELDS = [
  { key: "revGrowthPct", label: "收入增长", unit: "%", step: 1 },
  { key: "gmFloorPct", label: "毛利底线", unit: "%", step: 0.1, hardKey: "hardGm" },
  { key: "sharePts", label: "份额增", unit: "pct", step: 1 },
  { key: "capexCap", label: "CAPEX 上限", unit: "亿", step: 1, hardKey: "hardCapex" },
  { key: "cashFloor", label: "现金底线", unit: "亿", step: 1, hardKey: "hardCash" },
  { key: "invTurns", label: "库存周转", unit: "次", step: 0.5 },
];

/** 项目沙盘三驱动因子。 */
export const PROJECT_SIM_DRIVER_FACTORS = [
  { id: "f1", label: "节拍 × OEE × 良率", sub: "IoT/MES/QMS 驱动因子" },
  { id: "f2", label: "爬坡曲线 + 检修窗", sub: "前4周 0.88→1.0 · 各基地检修周" },
  { id: "f3", label: "认证系数 + 数据健康度", sub: "PLM 认证 · P90 系数" },
];

/** 订单全链问题分类中文标签。 */
export const ORDER_CHAIN_LABELS = { DELIVERY: "交期", MARGIN: "毛利", KIT: "齐套", CREDIT: "信用" };

/** 应用细分配色（订单全链视图 segColors）。 */
export const SEG_COLORS = { 乘用车: "#5E8FE8", 商用车: "#DD9551", 储能: "#36BFA5" };

/** 订单全链经营数据看板 成品库存/在制/原料 占营收系数（固定行业占比假设·非真算·明标 assumed）。 */
export const ORDER_CHAIN_ECON = {
  assumed: true,
  note: "成品库存/在制/原料 = 营收 × 行业占比固定假设（无实测库存数据）",
  coef: { fg: [0.22, 0] as [number, number], wip: [0.3, 0] as [number, number], rm: [0.18, 0] as [number, number] },
};

/**
 * 结构层收编汇总（service.ts seedViewConfigs 从此消费·不再本地内联 → teeth：退回内联即漂移）。
 */
export const BATTERY_VIEW_FRAGMENTS = {
  planAuditFieldGroups: PLAN_AUDIT_FIELD_GROUPS,
  planGenerateGoalFields: PLAN_GENERATE_GOAL_FIELDS,
  projectSimDriverFactors: PROJECT_SIM_DRIVER_FACTORS,
  orderChainLabels: ORDER_CHAIN_LABELS,
  segColors: SEG_COLORS,
  orderChainEcon: ORDER_CHAIN_ECON,
} as const;

/** 电池业务视图 pack 投影（IndustryViewDef·结构层可校验声明；layout 引用上方片段·单源不漂）。 */
const batteryViews: Record<string, IndustryViewDef> = {
  "plan-audit": {
    title: "规划体检",
    renderer: "plan-audit",
    layout: { solverKey: "plan_audit", fieldGroups: PLAN_AUDIT_FIELD_GROUPS, outputFields: ["H", "M", "S", "score", "verdict"] },
  },
  "plan-generate": {
    title: "方案生成",
    renderer: "plan-generate",
    layout: { solverKey: "plan_generate", goalFields: PLAN_GENERATE_GOAL_FIELDS, outputFields: ["schemes", "recommend"] },
  },
  "project-sim": {
    title: "项目沙盘推演",
    renderer: "project-sim",
    layout: { solverKey: "capacity_forecast", driverFactors: PROJECT_SIM_DRIVER_FACTORS, outputFields: ["p50", "p90", "gap", "perBaseRows", "mainBn"] },
  },
  "order-chain": {
    title: "订单全链聚合",
    renderer: "order-chain",
    layout: {
      solverKey: "affected_orders",
      window: { before: 7, after: 14 },
      problemCategories: ["DELIVERY", "MARGIN", "KIT", "CREDIT"],
      categoryLabels: ORDER_CHAIN_LABELS,
      segColors: SEG_COLORS,
      econ: ORDER_CHAIN_ECON,
      outputFields: ["rows", "problems", "summary", "columns"],
    },
  },
};

// ---------------------------------------------------------------------------
// 行业包实例（收编·byte-identical 引用）
// ---------------------------------------------------------------------------

/**
 * 电池制造行业包（收编现有散落电池配置·字节一致 R6）。
 * 各字段引用既有单源常量，本包不新增任何业务常数——它只是把散落各层「聚成一处声明」。
 */
export const batteryPack: IndustryPack = {
  industryKey: "battery-manufacturing",
  template: BATTERY_TEMPLATE, // ontology/generation/rules/scenarioSeed.intents/solverParams(=BATTERY_SOLVER_PARAMS)/features/…
  // solverKeys 省略 → 消费全平台 SOLVER_REGISTRY（descriptor 平台共享·R14）。
  views: batteryViews,
  entities: { segments: SEG_REGISTRY },
  clock: { t0: BATTERY_SOLVER_PARAMS.forecastStart as string },
};

/**
 * 物流仓配选址行业包（G-12 非电池行业·换行业零码实证）。
 * 引用既有 `LOGISTICS_TEMPLATE`（零业务常数 R14）；视图走平台默认 config 派生（前端 config-driven），
 * 无应用细分（entities.segments=[]），时钟走平台默认 t0——**无任何跨文件代码改动**即为其装配全栈。
 */
export const logisticsPack: IndustryPack = {
  industryKey: "logistics-warehouse",
  template: LOGISTICS_TEMPLATE,
  // 物流选址栈消费的求解器子集（绑定共享 SOLVER_REGISTRY·descriptor 零改）——facility_location 族 + 通用推演。
  solverKeys: ["facility_location", "min_cost_flow", "set_cover", "generic_inference", "optimize_whatif"],
  views: {},
  entities: { segments: [] },
  clock: { t0: DEFAULT_SIM_T0 },
};

/** 行业包登记表（新增行业 = 在此登记一份 pack·零跨文件代码改动）。 */
export const PACK_REGISTRY: readonly IndustryPack[] = [batteryPack, logisticsPack];

/** industryKey → 行业包（O(1) 装配路由）。 */
export function loadIndustryPack(industryKey: string): IndustryPack | undefined {
  return PACK_REGISTRY.find((p) => p.industryKey === industryKey);
}

/**
 * 解析行业包消费的平台求解器 descriptor（派发层装配）：
 *  · `solverKeys` 声明 → 从共享 `SOLVER_REGISTRY` 按键过滤（顺序稳定 R6）；
 *  · 省略 → 消费全平台 descriptor（电池包用全集）。
 * **不复制 descriptor 进包**——pack 只按 key 绑定共享单源（R14 平台共享）。
 */
export function packSolverDescriptors(pack: IndustryPack): SolverDescriptor[] {
  if (!pack.solverKeys) return [...SOLVER_REGISTRY];
  const keys = new Set(pack.solverKeys);
  return SOLVER_REGISTRY.filter((d) => keys.has(d.key));
}
