import {
  BottleneckMatrixOutputSchema,
  CapacityForecastOutputSchema,
  PlanAuditOutputSchema,
  PlanGenerateOutputSchema,
  RiskTimelineOutputSchema,
} from "@platform/contracts";

/**
 * HARDCODE-DISPATCH-REGISTRY 治本 · 求解器派发**单一来源**（registry-of-descriptors）。
 *
 * 此前「这个 solverKey 走哪条派发路径 / 输出什么形状 / 默认诚实位 / 是否套 A6 读出过滤」这一**同一事实**
 * 被复制成 ~7 张平行硬编码表（`SOLVER_KEYS` 全集 · `SOLVER_OUTPUT_SHAPES` · `LIVE_DEFAULT_SOLVERS` ·
 * `A6_READOUT_SOLVERS` · `compute` switch · `invokeRaw` if 链 · extended 三联）——加一个求解器要改 N 处、易漂移。
 *
 * 治本：每求解器**一条 descriptor**（key + route + outputShape + flags），上述平行表全部**从本登记派生**
 * （service.ts 迭代本表，非查 N 张平行表）。参照已落同构范式 `CONTEXT_ROLES`(datadep-context.ts) ——
 * 纯声明式数据（无内联函数引用·R14 零业务常数），派发码据 descriptor 字段决定路由/形状/诚实位。
 *
 * **语义零变（R6）**：`SOLVER_REGISTRY` 顺序 == 原 `SOLVER_KEYS` 顺序；outputShape 逐 key 字节一致；
 * flags 集合与原并行表逐 key 一致（drift 由 `solver-registry.test` + 构造期断言守）。
 *
 * `route` 决定运行期派发桶（语义与重构前 invokeRaw/compute 完全一致）：
 *  - `context`：经 `loadContext` 装配 SolverContext → 纯 `compute()` 求解（capacity/risk/plan/capex/audit_timeline…）。
 *  - `graph`：读任意对象图的净室/优化求解器，在 `invokeRaw` **先于** loadContext 拦截（key→私有方法·见 service.ts graphHandlers）。
 *  - `extended`：20 场景 §2 的 13+1 扩展求解器，经 `compute()` default 分支走 EXTENDED_REGISTRY（extended.ts）。
 */
export type SolverRoute = "context" | "graph" | "extended";

export interface SolverDescriptor {
  /** 求解器键（跨系统稳定标识）。 */
  readonly key: string;
  /** 运行期派发桶（决定 loadContext/compute vs graph 拦截 vs extended 分支）。 */
  readonly route: SolverRoute;
  /**
   * R11-SHAPE 顶层输出 key 全集（**未叠加** dataMode/confidence 横切位——那两位由 service.ts 统一追加）。
   * 权威：context 的 5 契约求解器取契约 schema `.shape`；其余取实现成功路径顶层 key。
   */
  readonly outputShape: readonly string[];
  /**
   * WO-2：读出型求解器（输出即 Base/Line/Process/Equipment 拓扑本身）——经 loadContext 套 A6 行级过滤读出层。
   * 其余求解器 A6 经 visibleOrders 作用于订单结果，不套读出过滤。原 `A6_READOUT_SOLVERS` 集合。
   */
  readonly a6Readout?: boolean;
  /**
   * WO-DM-tail：invoke wrapper 未自置 dataMode 时的**默认诚实位白名单**——仅经核实纯真对象读出/真优化、
   * 零业务魔数/哈希者默认 LIVE；其余默认 PARTIAL（诚实不过宣称）。原 `LIVE_DEFAULT_SOLVERS` 集合。
   */
  readonly liveDefault?: boolean;
}

const shapeKeys = (schema: { shape: Record<string, unknown> }): readonly string[] => Object.keys(schema.shape);

/** 求解器派发单一来源（顺序即原 SOLVER_KEYS 顺序·勿随意重排，多处消费依赖确定性 R6）。 */
export const SOLVER_REGISTRY: readonly SolverDescriptor[] = [
  { key: "capacity_rollup", route: "context", outputShape: ["bases", "ruleRefs"], a6Readout: true, liveDefault: true },
  { key: "capacity_forecast", route: "context", outputShape: shapeKeys(CapacityForecastOutputSchema) },
  { key: "bottleneck_matrix", route: "context", outputShape: shapeKeys(BottleneckMatrixOutputSchema), a6Readout: true },
  { key: "risk_timeline", route: "context", outputShape: shapeKeys(RiskTimelineOutputSchema) },
  { key: "affected_orders", route: "context", outputShape: ["baseId", "affected", "total", "count", "columns", "rows", "fallback", "problems", "summary"] },
  { key: "plan_audit", route: "context", outputShape: shapeKeys(PlanAuditOutputSchema), liveDefault: true },
  { key: "plan_generate", route: "context", outputShape: shapeKeys(PlanGenerateOutputSchema), liveDefault: true },
  { key: "capex_scenario", route: "context", outputShape: ["scenarioKey", "quarters", "demand", "s0", "S", "G", "windows", "projects", "c23"] },
  { key: "mitigation_select", route: "extended", outputShape: ["factor", "baseName", "urgency", "plans", "recommended", "draftPayload", "options", "factors", "error"] },
  { key: "cert_schedule", route: "extended", outputShape: ["schedule", "engineerGroups", "ruleRefs"] },
  { key: "kit_readiness", route: "extended", outputShape: ["rows", "shortageCount", "ruleRefs"] },
  { key: "lta_gap", route: "extended", outputShape: ["material", "month", "netDemand", "coverage", "gap", "po", "ruleRefs"] },
  { key: "inventory_optimize", route: "extended", outputShape: ["over", "under", "idle", "releasableCash", "ruleRefs"] },
  { key: "changeover_sequence", route: "extended", outputShape: ["lineId", "sequence", "totalChangeoverMin", "savedVsDueMin", "infeasible", "ruleRefs"] },
  { key: "yield_diagnosis", route: "extended", outputShape: ["breakpoint", "candidates", "ruleRefs"] },
  { key: "maintenance_stagger", route: "extended", outputShape: ["adjustments", "unresolved", "ruleRefs"] },
  { key: "outsourcing_split", route: "extended", outputShape: ["allocation", "totalCost", "savedVsAllDelay", "outsourceQualityGate", "ruleRefs"] },
  { key: "quote_margin", route: "extended", outputShape: ["margin", "floor", "diff", "verdict", "breakdown", "ruleRefs"] },
  { key: "credit_exposure", route: "extended", outputShape: ["limit", "exposure", "available", "exposureBreakdown", "overdue", "newOrderVerdict", "ruleRefs"] },
  { key: "quarterly_gap", route: "extended", outputShape: ["quarter", "combo", "residualGap", "ruleRefs"] },
  { key: "carbon_footprint", route: "extended", outputShape: ["modelId", "baseName", "total", "breakdown", "threshold", "verdict", "maxLever", "ruleRefs"] },
  { key: "countermeasure_combo", route: "extended", outputShape: ["gap", "combo", "residualGap", "totalCost", "feasible", "needsRealLevers", "subSolvers", "objectives", "tradeoff", "note", "ruleRefs"] },
  { key: "plan_rootcause", route: "graph", outputShape: ["kpis", "dag", "offTargetCount", "summary", "ruleRefs", "excludedFactors"] },
  { key: "metric_rollup", route: "graph", outputShape: ["metrics", "missCount", "byLevel", "summary"], liveDefault: true },
  { key: "cockpit_kpi", route: "graph", outputShape: ["supplyV7", "revAttainPct", "utilPeak", "aopBaseRev", "cashCushion"], liveDefault: true },
  { key: "counterfactual_timeline", route: "context", outputShape: ["baselineSeries", "mitigatedSeries", "threshold", "factor", "base", "mitigation", "delta", "events", "summary"] },
  { key: "order_fullchain", route: "graph", outputShape: ["so", "verdict", "vc", "kpis", "judges", "conds", "dag", "summary"] },
  { key: "mrp_netting", route: "graph", outputShape: ["materials", "shortageCount", "summary"], liveDefault: true },
  { key: "finance_pnl", route: "graph", outputShape: ["pnl", "gmRow", "attribution", "summary"], liveDefault: true },
  { key: "audit_timeline", route: "context", outputShape: ["kind", "series", "stages", "peak", "crossDay", "threshold", "events", "affectedOrders"] },
  { key: "ksf_graph", route: "graph", outputShape: ["problems", "ksfNodes", "finNodes", "edges", "summary"], liveDefault: true },
  { key: "generic_inference", route: "graph", outputShape: ["deltas", "rows", "affectedObjects", "count", "rootTypes"], liveDefault: true },
  { key: "shared_bottleneck", route: "graph", outputShape: ["bottlenecks", "contention", "downgraded", "summary"], liveDefault: true },
  { key: "concentration_risk", route: "graph", outputShape: ["concentrations", "topExposure", "summary"], liveDefault: true },
  { key: "margin_attribution", route: "graph", outputShape: ["inverted", "rootDrivers", "invertedCount", "summary"], liveDefault: true },
  { key: "supplier_disruption_radius", route: "graph", outputShape: ["rootType", "rootId", "layers", "radius", "totalAffected", "leafType", "leafCount", "summary"] },
  { key: "selection_optimize", route: "graph", outputShape: ["status", "optimal", "selected", "totalValue", "totalWeight", "itemType", "budget", "candidateCount", "summary"], liveDefault: true },
  { key: "assignment_optimize", route: "graph", outputShape: ["status", "optimal", "assignments", "objective", "itemType", "binType", "itemCount", "binCount", "summary"], liveDefault: true },
  { key: "sequencing_optimize", route: "graph", outputShape: ["status", "optimal", "sequence", "changeovers", "objective", "jobType", "jobCount", "summary"], liveDefault: true },
  { key: "packing_optimize", route: "graph", outputShape: ["status", "optimal", "bins", "binCount", "objective", "itemType", "itemCount", "binCapacity", "summary"], liveDefault: true },
  { key: "facility_location", route: "graph", outputShape: ["status", "optimal", "openFacilities", "assignments", "objective", "facilityType", "clientType", "facilityCount", "clientCount", "summary"], liveDefault: true },
  { key: "min_cost_flow", route: "graph", outputShape: ["status", "optimal", "flows", "objective", "nodeType", "arcCount", "nodeCount", "summary"], liveDefault: true },
  { key: "set_cover", route: "graph", outputShape: ["status", "optimal", "chosen", "objective", "setType", "universeSize", "setCount", "summary"], liveDefault: true },
  { key: "independent_set", route: "graph", outputShape: ["status", "optimal", "chosen", "objective", "nodeType", "edgeCount", "nodeCount", "summary"], liveDefault: true },
  { key: "combinatorial_auction", route: "graph", outputShape: ["status", "optimal", "winners", "objective", "bidType", "itemCount", "bidCount", "summary"], liveDefault: true },
  { key: "optimize_whatif", route: "graph", outputShape: ["baselineObjective", "perturbedObjective", "deltaObjective", "feasible", "conflictConstraints", "explanation", "summary"], liveDefault: true },
  { key: "multisource_fusion", route: "graph", outputShape: ["role", "fused", "suspectCount", "conflictCount", "dataMode", "strategies", "summary"] },
  // QUERY30 缺口③ Q01 样板：接单挤占推演（extended 路由·args 驱动·确定性 R6·接 C34/C35）。
  { key: "what_if_displacement", route: "extended", outputShape: ["newOrder", "base", "feasibleWithoutDisplacement", "freeDaily", "shortfallDaily", "displacedOrders", "highPriDisplaceDays", "totalDisplaced", "schemes", "schemeCount", "recommended", "comparison", "ruleRefs", "summary"] },
  // QUERY30 缺口③ Q01 样板：多方案五维比较矩阵（extended 路由·纯聚合层·确定性 R6·≥2 可比方案门 C35 口径）。
  { key: "multi_plan_compare", route: "extended", outputShape: ["matrix", "recommendedKey", "dims", "comparedCount", "note"] },
  // UPG-L0-COVERAGE-FILL：通用因果归因 / root-cause（graph 路由·真读对象图·args 驱动泛化·确定性 R6·零业务常数 R14）。
  // 治 general_causal_attribution 覆盖缺口（PRD-upstream §5.2）——每个归因数溯源真字段，诚实空态不冒充。liveDefault：纯真对象读出/真聚合。
  { key: "causal_attribution", route: "graph", outputShape: ["crossed", "rootDrivers", "crossedCount", "totalGap", "direction", "valueField", "driverField", "summary"], liveDefault: true },
  // Q30-P2 求解器横铺 A（复用·低成本·DESIGN-query30 §1 P2 行）：
  //  · capex_alternatives — CAPEX 方案比选，**复用** capex_scenario（context 路由·多方案各跑一次再聚合择优·含启发默认 PARTIAL）。
  { key: "capex_alternatives", route: "context", outputShape: ["scenarioKey", "quarters", "comparedCount", "alternatives", "recommendedKey", "dims", "note"] },
  //  · full_cost_rollup — 全成本卷积（产能→成本→损益），**复用** capacity_rollup + finance_pnl（graph 路由·纯真对象读出+算术·liveDefault）。
  { key: "full_cost_rollup", route: "graph", outputShape: ["capacityWeeklyWan", "capacityBases", "revenue", "cost", "grossMargin", "marginPct", "pnl", "gmRow", "attribution", "summary"], liveDefault: true },
  //  · signal_propagation — 信号图传导（沿供应链/产线图扩散半径与受影响集），**复用** supplier_disruption_radius 的反向多跳 BFS（graph 路由）。
  { key: "signal_propagation", route: "graph", outputShape: ["signal", "rootType", "rootId", "layers", "radius", "totalAffected", "reachedType", "reachedCount", "affectedSet", "summary"] },
  // Q30-P3 求解器横铺 B（新域·中成本·DESIGN-query30 §1 P3 行）——3 新域（graph 路由·真读 SEED 对象派生·零合成/兜底冒充）+ 2 复用类（真调子求解器·非借名魔数）：
  //  · cash_projection — 现金流投影（新域·真读 FinanceAccount 期初现金 + Order 值/交期/毛利 + Customer 账期 → 逐周回款/付款/现金曲线·13 周安全垫·纯真对象+算术）。
  { key: "cash_projection", route: "graph", outputShape: ["horizonWeeks", "openingCashWan", "weeks", "minCashWan", "minCashWeek", "totalInflowWan", "totalOutflowWan", "orderCount", "baseCount", "summary"], liveDefault: true },
  //  · labor_balance — 人力平衡（新域·真读 LaborShift 编制/班次 + Process 出勤 + Order 派线需求 → 逐线配工与缺口；laborPerWan 系估算参数故默认 PARTIAL·不冒充实测）。
  { key: "labor_balance", route: "graph", outputShape: ["laborPerWan", "lines", "totalHeadcount", "totalRequiredManShifts", "totalAvailableManShifts", "totalGap", "deficitLineCount", "note", "summary"] },
  //  · energy_cost_schedule — 能耗成本排程（新域·真读 EnergyMeter 单耗/电网因子 + Order 需求 → 能耗/碳排逐周排程；⚠ SEED 无分时电价→tariff 须经 args 提供·缺失诚实空态不冒充）。
  { key: "energy_cost_schedule", route: "graph", outputShape: ["horizonWeeks", "tariffAvailable", "tariff", "bases", "schedule", "totalEnergyKwh", "totalCarbonKg", "totalEnergyCostWan", "note", "summary"] },
  //  · reroute_decision — 改道决策（**复用** min_cost_flow·真调 CP-SAT sidecar）：断供/停线产线的产量改道到有余量候选产线，最小成本流分配（arc 成本=真 ChangeoverMatrix 换型分钟·非魔数）。
  { key: "reroute_decision", route: "graph", outputShape: ["disruptedLineId", "disruptedModels", "reroutedVolume", "shippedVolume", "unmetVolume", "candidates", "flows", "objective", "optimal", "status", "subSolver", "note", "summary"] },
  //  · multi_constraint_schedule — 多约束联合排产（**复用**排产族 sequencing_optimize + cert_schedule + changeover_sequence·三约束联解·真调各子求解器·非各自为战·非借名魔数）。
  { key: "multi_constraint_schedule", route: "graph", outputShape: ["jointSequence", "sequencing", "changeover", "cert", "blockedByCert", "subSolvers", "constraintsSatisfied", "note", "summary"] },
] as const;

/** key→descriptor（O(1) 查·派发码用）。 */
export const SOLVER_BY_KEY: ReadonlyMap<string, SolverDescriptor> = new Map(SOLVER_REGISTRY.map((d) => [d.key, d]));

/** 求解器键全集（顺序即登记顺序）——派生原 `SOLVER_KEYS` 平行表。 */
export const REGISTRY_SOLVER_KEYS: readonly string[] = SOLVER_REGISTRY.map((d) => d.key);

/** route==="graph" 的键集合（invokeRaw 拦截桶·构造期核对 graphHandlers 无漂移）。 */
export const GRAPH_SOLVER_KEYS: readonly string[] = SOLVER_REGISTRY.filter((d) => d.route === "graph").map((d) => d.key);

/** route==="extended" 的键集合（核对 extended.ts EXTENDED_REGISTRY 无漂移）。 */
export const EXTENDED_ROUTE_KEYS: readonly string[] = SOLVER_REGISTRY.filter((d) => d.route === "extended").map((d) => d.key);

/** 派生原 `SOLVER_OUTPUT_SHAPES`（**未叠加** dataMode/confidence·service.ts 追加）。 */
export function registryOutputShapes(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const d of SOLVER_REGISTRY) out[d.key] = [...d.outputShape];
  return out;
}

/** 派生原 `LIVE_DEFAULT_SOLVERS`。 */
export const LIVE_DEFAULT_KEYS: ReadonlySet<string> = new Set(SOLVER_REGISTRY.filter((d) => d.liveDefault).map((d) => d.key));

/** 派生原 `A6_READOUT_SOLVERS`。 */
export const A6_READOUT_KEYS: ReadonlySet<string> = new Set(SOLVER_REGISTRY.filter((d) => d.a6Readout).map((d) => d.key));
