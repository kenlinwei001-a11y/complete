import { z } from "zod";

/**
 * PRD-scenario-ontogenesis §2.1/§2.2 P2（WO ONTO-SCEN-RENDER-PROJ ①）：
 * 场景卡渲染投影绑定单一来源 —— 每求解器声明「把哪些**真实输出字段**投成哪种答案块」。
 *
 * 这是 `ScenarioGenome.renderBindings` 的出厂事实源（卡=胚胎声明目标闭包），也是 seed 派生计划
 * render 步的投影驱动（agentcore `mocks/seed.ts` 派生循环消费）——**消灭静态占位文本**：
 * 答案的 KPI/表/叙事块全部投影求解器真实输出字段，不再烘焙任何写死文案。
 *
 * 设计不变量：
 *  - **⊆ SOLVER_OUTPUT_SHAPES（闭 G-2/SHAPE）**：每条 `fromSolverField` 必须在该求解器于 datacore
 *    `SOLVER_OUTPUT_SHAPES`（solver-registry 派生）登记的输出形状内。门 `ontogenesis:check` 读两侧
 *    编译产物校验，违反即红；datacore 侧另有**真值齿**（真实 invoke 断言每个绑定字段在输出中在场）。
 *  - **零业务常数（R14）**：只声明字段语义（哪个字段投成什么块），不含任何行业实体名/业务数字；
 *    字段→人话 label 由 agentcore `solver-field-labels` 正交提供。
 *  - **确定性（R6）**：绑定序即投影序（KPI 绑定优先进 KPI 区、table 绑定即结果表）。
 *
 * 与 `SOLVER_RULE_REFS`（规则即引用）同款范式：契约层登记，两侧消费，门守漂移。
 */
export const RenderBindingSchema = z.object({
  /** 投成哪种答案块：kpi=标量指标（对象值展开一层）· table=结果表（对象数组）· text=叙事段（字符串）。 */
  block: z.enum(["kpi", "table", "text"]),
  /** 求解器输出顶层字段名（⊆ 该求解器 SOLVER_OUTPUT_SHAPES 登记形状，门守）。 */
  fromSolverField: z.string().min(1),
});
export type RenderBinding = z.infer<typeof RenderBindingSchema>;

/**
 * 出厂 16 张派生场景卡（S04/S05/S07…S20）所用求解器的投影绑定登记。
 * 键=求解器 key（sop_balance 卡经 BP-4 改绑 mrp_netting，登记 mrp_netting）。
 * 字段选取依据：真实 DataCore invoke 实测输出（docs/evidence 留痕）——每个绑定字段都是
 * 实现**无条件产出**的真实字段（datacore 真值齿钉死，缺字段即红）。
 */
export const SOLVER_RENDER_BINDINGS: Readonly<Record<string, readonly RenderBinding[]>> = Object.freeze({
  plan_audit: [
    { block: "kpi", fromSolverField: "score" },
    { block: "kpi", fromSolverField: "verdict" },
    { block: "table", fromSolverField: "M" },
  ],
  plan_generate: [
    { block: "kpi", fromSolverField: "recommend" },
    { block: "table", fromSolverField: "schemes" },
  ],
  cert_schedule: [
    { block: "kpi", fromSolverField: "engineerGroups" },
    { block: "table", fromSolverField: "schedule" },
  ],
  kit_readiness: [
    { block: "kpi", fromSolverField: "shortageCount" },
    { block: "table", fromSolverField: "rows" },
  ],
  lta_gap: [
    { block: "kpi", fromSolverField: "netDemand" },
    { block: "kpi", fromSolverField: "coverage" },
    { block: "kpi", fromSolverField: "gap" },
    { block: "table", fromSolverField: "po" },
  ],
  inventory_optimize: [
    { block: "kpi", fromSolverField: "releasableCash" },
    { block: "table", fromSolverField: "under" },
  ],
  changeover_sequence: [
    { block: "kpi", fromSolverField: "totalChangeoverMin" },
    { block: "kpi", fromSolverField: "savedVsDueMin" },
    { block: "table", fromSolverField: "sequence" },
  ],
  yield_diagnosis: [
    { block: "kpi", fromSolverField: "breakpoint" },
    { block: "table", fromSolverField: "candidates" },
  ],
  maintenance_stagger: [
    { block: "table", fromSolverField: "adjustments" },
  ],
  outsourcing_split: [
    { block: "kpi", fromSolverField: "totalCost" },
    { block: "kpi", fromSolverField: "savedVsAllDelay" },
    { block: "kpi", fromSolverField: "outsourceQualityGate" },
    { block: "table", fromSolverField: "allocation" },
  ],
  quote_margin: [
    { block: "kpi", fromSolverField: "margin" },
    { block: "kpi", fromSolverField: "floor" },
    { block: "kpi", fromSolverField: "diff" },
    { block: "kpi", fromSolverField: "verdict" },
  ],
  credit_exposure: [
    { block: "kpi", fromSolverField: "limit" },
    { block: "kpi", fromSolverField: "exposure" },
    { block: "kpi", fromSolverField: "available" },
    { block: "kpi", fromSolverField: "newOrderVerdict" },
    { block: "table", fromSolverField: "overdue" },
  ],
  capex_scenario: [
    { block: "kpi", fromSolverField: "quarters" },
    { block: "table", fromSolverField: "projects" },
  ],
  mrp_netting: [
    { block: "text", fromSolverField: "summary" },
    { block: "kpi", fromSolverField: "shortageCount" },
    { block: "table", fromSolverField: "materials" },
  ],
  quarterly_gap: [
    { block: "kpi", fromSolverField: "quarter" },
    { block: "kpi", fromSolverField: "residualGap" },
    { block: "table", fromSolverField: "combo" },
  ],
  carbon_footprint: [
    { block: "kpi", fromSolverField: "total" },
    { block: "kpi", fromSolverField: "threshold" },
    { block: "kpi", fromSolverField: "verdict" },
    { block: "kpi", fromSolverField: "maxLever" },
  ],
  // QUERY30 缺口③ Q01 样板：接单挤占推演。KPI=推荐案/可行方案数/高优先级最长位移天；表=四型方案 + 挤占清单；叙事=结论。
  what_if_displacement: [
    { block: "kpi", fromSolverField: "recommended" },
    { block: "kpi", fromSolverField: "schemeCount" },
    { block: "kpi", fromSolverField: "highPriDisplaceDays" },
    { block: "table", fromSolverField: "schemes" },
    { block: "table", fromSolverField: "displacedOrders" },
    { block: "text", fromSolverField: "summary" },
  ],
  // QUERY30 缺口③ Q01 样板：多方案五维比较矩阵。KPI=推荐方案键/可比方案数；表=五维比较矩阵；叙事=择优说明/门。
  multi_plan_compare: [
    { block: "kpi", fromSolverField: "recommendedKey" },
    { block: "kpi", fromSolverField: "comparedCount" },
    { block: "table", fromSolverField: "matrix" },
    { block: "text", fromSolverField: "note" },
  ],
  // CORE-NL-SOLVER-ROUTING：5 个通用多跳求解器（route=graph）的投影绑定（⊆ solver-registry outputShape·
  // datacore render-bindings-real-fields.test 真 invoke 逐字段钉「真在输出中」）。每卡 ≥1 kpi/table 承载数据块。
  shared_bottleneck: [
    { block: "table", fromSolverField: "bottlenecks" },
    { block: "table", fromSolverField: "contention" },
    { block: "table", fromSolverField: "downgraded" },
    { block: "text", fromSolverField: "summary" },
  ],
  concentration_risk: [
    { block: "table", fromSolverField: "concentrations" },
    { block: "text", fromSolverField: "summary" },
  ],
  margin_attribution: [
    { block: "kpi", fromSolverField: "invertedCount" },
    { block: "table", fromSolverField: "inverted" },
    { block: "table", fromSolverField: "rootDrivers" },
    { block: "text", fromSolverField: "summary" },
  ],
  supplier_disruption_radius: [
    { block: "kpi", fromSolverField: "radius" },
    { block: "kpi", fromSolverField: "totalAffected" },
    { block: "kpi", fromSolverField: "leafCount" },
    { block: "table", fromSolverField: "layers" },
    { block: "text", fromSolverField: "summary" },
  ],
  multisource_fusion: [
    { block: "kpi", fromSolverField: "suspectCount" },
    { block: "kpi", fromSolverField: "conflictCount" },
    { block: "table", fromSolverField: "fused" },
    { block: "text", fromSolverField: "summary" },
  ],
  // Q30-P2 求解器横铺 A（复用 capex_scenario）：CAPEX 方案比选。KPI=推荐方案键/可比方案数；表=五维比较矩阵；叙事=择优说明。
  capex_alternatives: [
    { block: "kpi", fromSolverField: "recommendedKey" },
    { block: "kpi", fromSolverField: "comparedCount" },
    { block: "table", fromSolverField: "alternatives" },
    { block: "text", fromSolverField: "note" },
  ],
  // Q30-P2 求解器横铺 A（复用 capacity_rollup+finance_pnl）：全成本卷积。KPI=总周产能/毛利/毛利率；表=量价本利科目+基地产能；叙事=卷积结论。
  full_cost_rollup: [
    { block: "kpi", fromSolverField: "capacityWeeklyWan" },
    { block: "kpi", fromSolverField: "grossMargin" },
    { block: "kpi", fromSolverField: "marginPct" },
    { block: "table", fromSolverField: "pnl" },
    { block: "table", fromSolverField: "capacityBases" },
    { block: "text", fromSolverField: "summary" },
  ],
  // Q30-P2 求解器横铺 A（复用 supplier_disruption_radius 的 BFS）：信号图传导。KPI=半径/受影响总数/末端触达数；表=逐层集；叙事=传导结论。
  signal_propagation: [
    { block: "kpi", fromSolverField: "radius" },
    { block: "kpi", fromSolverField: "totalAffected" },
    { block: "kpi", fromSolverField: "reachedCount" },
    { block: "table", fromSolverField: "layers" },
    { block: "text", fromSolverField: "summary" },
  ],
  // Q30-P3 求解器横铺 B（新域·中成本）——3 新域 + 2 复用类，绑定字段均求解器无条件产出（真值齿钉死·缺字段即红）。
  // cash_projection 现金流投影：KPI=安全垫最低/期初现金；表=逐周现金曲线；叙事=投影结论。
  cash_projection: [
    { block: "kpi", fromSolverField: "minCashWan" },
    { block: "kpi", fromSolverField: "openingCashWan" },
    { block: "table", fromSolverField: "weeks" },
    { block: "text", fromSolverField: "summary" },
  ],
  // labor_balance 人力平衡：KPI=净缺口/欠配线数；表=逐线配工缺口；叙事=估算口径说明。
  labor_balance: [
    { block: "kpi", fromSolverField: "totalGap" },
    { block: "kpi", fromSolverField: "deficitLineCount" },
    { block: "table", fromSolverField: "lines" },
    { block: "text", fromSolverField: "note" },
  ],
  // energy_cost_schedule 能耗成本排程：KPI=总能耗/总碳排；表=逐基地能耗；叙事=电价缺失诚实说明。
  energy_cost_schedule: [
    { block: "kpi", fromSolverField: "totalEnergyKwh" },
    { block: "kpi", fromSolverField: "totalCarbonKg" },
    { block: "table", fromSolverField: "bases" },
    { block: "text", fromSolverField: "note" },
  ],
  // reroute_decision 改道决策（复用 min_cost_flow 真调）：KPI=改道量/总成本；表=候选产线；叙事=改道结论。
  reroute_decision: [
    { block: "kpi", fromSolverField: "shippedVolume" },
    { block: "kpi", fromSolverField: "objective" },
    { block: "table", fromSolverField: "candidates" },
    { block: "text", fromSolverField: "summary" },
  ],
  // multi_constraint_schedule 多约束联合排产（复用排产族三子解真调）：KPI=换型子解/认证子解（对象展开一层）；表=联合排产序；叙事=三约束联解说明。
  multi_constraint_schedule: [
    { block: "kpi", fromSolverField: "changeover" },
    { block: "kpi", fromSolverField: "cert" },
    { block: "table", fromSolverField: "jointSequence" },
    { block: "text", fromSolverField: "summary" },
  ],
  // UPG-L0-COVERAGE-FILL：通用因果归因 root-cause。KPI=越线项数/总缺口；表=越线明细 + 根因主驱动（真证据字段量化）；叙事=归因链结论。
  causal_attribution: [
    { block: "kpi", fromSolverField: "crossedCount" },
    { block: "kpi", fromSolverField: "totalGap" },
    { block: "table", fromSolverField: "crossed" },
    { block: "table", fromSolverField: "rootDrivers" },
    { block: "text", fromSolverField: "summary" },
  ],
});
