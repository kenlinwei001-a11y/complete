/**
 * SOLVER_COVERAGE —— 「问题类目 → path-A 求解器」覆盖矩阵（诊断·纯数据）。
 *
 * WO UPG-L0-SOLVER-COVERAGE · PRD `docs/PRD-upstream-classify-precision.md` §5.1（方案 A2·诊断）。
 *
 * 目的（治「没有对的求解器」）：命中意图但**根本没有对的 path-A 求解器**的问题类目，此前静默落
 * Path B（Agent 兜底·未验证）。本矩阵把「哪些**问题类目**有 path-A 求解器覆盖」声明式钉死，
 * 并把**未覆盖类目显式列为缺口**（`UNCOVERED_PROBLEM_CLASSES`）——而非静默兜底。
 *
 * 与主单 `docs/PRD-gap-analysis-engine.md` §8 衔接：主单闭包算「给定意图缺哪个 solver」，
 * 本矩阵回答「这个**问题类目**根本没有对的 solver」——两者互补（上游① vs 下游②）。
 *
 * 契约纪律：
 *  - `@platform/contracts` 纯数据（无 datacore import·contracts-only-shared）。
 *  - **R14 抽象零业务常数**：problemClass 键是**分析型原型**（归因/趋势/对比/约束求解/…），
 *    非业务实体字面量（无「常州」/「NCM4680」）；solverKey 是求解器**结构性标识符**（非行业常数）。
 *  - 门 `solver-coverage:check`（`scripts/check-solver-coverage.mjs`·并入 `pnpm gates`·登母体 §7）：
 *    矩阵引用的**每个 solverKey 必 ∈ datacore `SOLVER_REGISTRY`**（对齐 `no-fake-done` 精神·防幽灵 key）。
 *    contracts 不可 import datacore，故 key∈registry 的断言由**门**（读两侧编译产物）+ datacore
 *    单测（`solver-coverage.test.ts`·可同时 import 两者）双守。
 */

/**
 * problemClass（分析型问题原型）→ 覆盖它的 path-A `solverKey[]`（必 ∈ `SOLVER_REGISTRY`）。
 * 只登记**真实**求解器 key（防幽灵）。键为抽象分析原型（R14）。
 */
export const SOLVER_COVERAGE: Record<string, string[]> = {
  /** 描述性聚合 / 汇总卷积（当前态是什么）。 */
  descriptive_aggregation: ["capacity_rollup", "metric_rollup", "cockpit_kpi", "finance_pnl"],
  /** 前向投影 / 时间轴推演（未来会怎样）。 */
  forward_projection: ["capacity_forecast", "risk_timeline", "audit_timeline"],
  /** 瓶颈 / 争用识别（卡在哪）。 */
  bottleneck_detection: ["bottleneck_matrix", "shared_bottleneck"],
  /** 财务口径归因（钱从哪来/差在哪·窄口径归因）。 */
  financial_attribution: ["margin_attribution", "finance_pnl", "quote_margin"],
  /** 计划偏差诊断（计划为何未达标·KPI 维根因）。 */
  plan_deviation_diagnosis: ["plan_audit", "plan_rootcause"],
  /** 质量 / 良率根因（窄口径工艺根因）。 */
  quality_root_cause: ["yield_diagnosis"],
  /** 约束优化 / 组合求解（怎么排最优）。 */
  constraint_optimization: [
    "selection_optimize",
    "assignment_optimize",
    "sequencing_optimize",
    "packing_optimize",
    "facility_location",
    "min_cost_flow",
    "set_cover",
    "independent_set",
    "combinatorial_auction",
    "inventory_optimize",
  ],
  /** 敏感性 / what-if 反事实（改一处会怎样）。 */
  sensitivity_whatif: ["optimize_whatif", "what_if_displacement", "counterfactual_timeline"],
  /** 集中度 / 暴露分析（鸡蛋是否在一个篮子）。 */
  concentration_analysis: ["concentration_risk"],
  /** 传导半径 / 影响辐射（断一处波及多远）。 */
  propagation_radius: ["supplier_disruption_radius"],
  /** 多源仲裁 / 冲突归并（各执一词时信谁）。 */
  multi_source_reconciliation: ["multisource_fusion"],
  /** 备选方案对比（哪个方案好）。 */
  alternative_comparison: ["multi_plan_compare"],
  /** 需求净额 / 齐套核算（差多少料）。 */
  requirement_netting: ["mrp_netting", "kit_readiness", "lta_gap"],
  /** 排程 / 换型时序（先做谁）。 */
  schedule_sequencing: ["changeover_sequence", "cert_schedule", "maintenance_stagger"],
  /** 缺口弥合 / 对策合成（怎么补上）。 */
  gap_closure_synthesis: ["plan_generate", "countermeasure_combo", "quarterly_gap", "mitigation_select"],
  /** 敞口评估（能不能再接·信用/额度）。 */
  exposure_assessment: ["credit_exposure"],
  /** 产能分配 / 外协切分（自制还是外协）。 */
  sourcing_allocation: ["outsourcing_split"],
  /** 排放足迹核算。 */
  emission_footprint: ["carbon_footprint"],
  /** 投资情景推演。 */
  investment_scenario: ["capex_scenario"],
  /** 受影响范围枚举（谁被影响了）。 */
  affected_scope_enumeration: ["affected_orders"],
  /** 全链条追溯 / 通用多跳推演（跨对象顺链走）。 */
  full_chain_trace: ["order_fullchain", "ksf_graph", "generic_inference"],
  /**
   * 通用跨域因果归因 / root-cause（为什么 X 恶化/越线·WO UPG-L0-COVERAGE-FILL·PRD-upstream §5.2）。
   * 由**通用** `causal_attribution`（route=graph·args 驱动泛化·每个归因数溯源真字段·R6/R14）覆盖——补齐此前
   * 「全表无通用因果归因 path-A 求解器」的高频缺口（原静默落 Path B）。窄口径归因（financial/plan/quality）另有专器。
   */
  general_causal_attribution: ["causal_attribution"],
};

/**
 * **未覆盖问题类目**（诚实缺口·显式列出·非静默落 Path B）。
 *
 * 这些分析原型在 `SOLVER_REGISTRY` **无通用 path-A 求解器**——命中此类问句只能诚实报覆盖缺口，
 * 而非静默 generic 兜底。缺口驱动 A3 覆盖补齐优先级（PRD §5.2·按 Path B 落点频次滚动）。
 *
 * 对齐 PRD §2.2 逐条核对：曾经*「全表无通用因果归因/root-cause path-A 求解器」*的缺口已由 WO
 * UPG-L0-COVERAGE-FILL 补齐——`general_causal_attribution` 现由通用 `causal_attribution` 覆盖（见上表），
 * 已从本缺口清单**移出**（覆盖 ∩ 缺口 = ∅·门 solver-coverage:check 守）。窄口径 `financial_attribution` /
 * `plan_deviation_diagnosis` / `quality_root_cause` 仍是专口径覆盖，不冒充通用归因。
 */
export const UNCOVERED_PROBLEM_CLASSES: readonly string[] = Object.freeze([
  /** 时序趋势 / 季节性分解（capacity_forecast 是产能专用·非通用趋势分解）。 */
  "temporal_trend_decomposition",
  /** 通用异常 / 离群检测（registry 无 path-A·此前走 generic/Path B）。 */
  "anomaly_detection",
  /** 非结构化语义抽取 / 主题聚类（无确定性 path-A·走 Agent/知识库）。 */
  "text_semantic_extraction",
]);

/** 已覆盖的问题类目（有 ≥1 path-A 求解器）。 */
export function coveredProblemClasses(): string[] {
  return Object.keys(SOLVER_COVERAGE);
}

/** 矩阵引用的全部 solverKey（去重·排序·确定性 R6）——门/单测据此校验 ⊆ SOLVER_REGISTRY。 */
export function coveredSolverKeys(): string[] {
  const set = new Set<string>();
  for (const keys of Object.values(SOLVER_COVERAGE)) for (const k of keys) set.add(k);
  return [...set].sort();
}

/** 某 solverKey 覆盖了哪些问题类目（反查·排序确定性）。 */
export function problemClassesForSolver(solverKey: string): string[] {
  return Object.entries(SOLVER_COVERAGE)
    .filter(([, keys]) => keys.includes(solverKey))
    .map(([cls]) => cls)
    .sort();
}

/**
 * 覆盖诊断：给定一批**已注册**的 solverKey（真实来源 = datacore `SOLVER_REGISTRY`），
 * 返回矩阵中引用但**不在**注册表的幽灵 key（应恒为空·门守之）。纯函数·R6。
 */
export function ghostSolverKeys(registeredKeys: readonly string[]): string[] {
  const registered = new Set(registeredKeys);
  return coveredSolverKeys().filter((k) => !registered.has(k));
}
