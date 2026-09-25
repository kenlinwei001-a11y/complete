import { SOLVER_CATEGORIES, type SolverCategory } from "@platform/contracts";
import { SOLVER_KEYS } from "./service.js";

/**
 * WO-L7A · 内置求解器 → 决策问题类目 的归档表（59 条·一条不漏）。
 *
 * **本文件不含任何求解器计算逻辑**，也不改任何 key 名（改 key = 断链）。它只做一件事：
 * 给 `SOLVER_KEYS` 这张 59 条的平表挂上一维「解决什么决策问题」的分类，让"按类找求解器"成为可能。
 *
 * ## 机器先说话（铁律 0.6 的机制落地，不是"下次注意"）
 * `Record<SolverKey, SolverCategory>` 的键类型直接取自 `typeof SOLVER_KEYS[number]`：
 * - **新增一个 solver 却忘了归类 → `tsc` 当场红**（Record 缺键），不用等谁想起来；
 * - **写错/写了一个不存在的 key → `tsc` 当场红**（Record 多键）；
 * - **类目名写错 → `tsc` 当场红**（值不在 10 类枚举里）。
 * 运行时那一层（`uncategorizedSolverKeys()` + `solver-taxonomy.test.ts`）是第二道，防的是
 * "类型对了但数量对不上"（例如 SOLVER_KEYS 被改成 string[] 后类型约束失效）。
 *
 * ## 归纳原则
 * 按「回答什么决策问句」分，**不**按算法分（见 `SOLVER_CATEGORY_META[*].decisionQuestion`）。
 * 每条归类后面的注释写的是**判据**——它回答的那句问话，而不是它内部怎么算。
 *
 * ## 确定性（R6）
 * 一切对外顺序都不取 `Object.keys(SOLVER_CATEGORY_MAP)`：
 * 类目内顺序 = `SOLVER_KEYS` 声明序，类目间顺序 = `SOLVER_CATEGORIES` 声明序。
 */

/** 内置求解器 key 联合类型（权威 = `SOLVER_KEYS`，本表不另抄一份名单）。 */
export type SolverKey = (typeof SOLVER_KEYS)[number];

export const SOLVER_CATEGORY_MAP: Record<SolverKey, SolverCategory> = {
  // ── 产能与瓶颈：「产能够不够、被哪道工序/哪个共享资源卡住了」 ──
  capacity_rollup: "capacity_bottleneck", // 各基地/型号维度产能上卷到多少
  capacity_forecast: "capacity_bottleneck", // 未来几周产能满足度/缺口率/主瓶颈
  bottleneck_matrix: "capacity_bottleneck", // 瓶颈落在哪个基地哪道工序
  base_capacity_outlook: "capacity_bottleneck", // 某基地未来 30/60/90 天产能够不够、缺口哪天出现
  shared_bottleneck: "capacity_bottleneck", // 哪些对象挤同一共享资源、谁该降级（净室通用版同一问句）
  chain_impediments: "capacity_bottleneck", // 全链哪里有卡点/堵点/断点、产能被什么夹住

  // ── 计划与排程：「谁在什么时候、按什么顺序、在哪个基地做；这版计划行不行」 ──
  plan_generate: "planning_scheduling", // 按目标与约束排一版候选计划
  plan_audit: "planning_scheduling", // 这版计划达成率/风险敞口如何（计划体检）
  sop_reschedule: "planning_scheduling", // 某单能否提前交、挤占谁、拆哪些基地
  portfolio: "planning_scheduling", // 全订单×全基地×时间怎么排最优、冻结这几单其余怎么排
  changeover_sequence: "planning_scheduling", // 产线一周订单按什么换型顺序排
  cert_schedule: "planning_scheduling", // 认证工程师按什么优先级排到哪一周
  maintenance_stagger: "planning_scheduling", // 检修排在哪周才和交付高峰错开
  job_shop_schedule: "planning_scheduling", // 工序在哪台设备、几点开工几点完工（时间轴）
  sequencing_optimize: "planning_scheduling", // 作业按什么顺序排，切换代价最小（通用版同一问句）

  // ── 物料与库存：「料够不够齐套、缺口补多少、库存水位摆在哪」 ──
  kit_readiness: "material_inventory", // 逐单齐套率多少、缺哪些料、在途 ETA
  lta_gap: "material_inventory", // 长协覆盖多少、现货缺口补多少、分批 PO 怎么下
  inventory_optimize: "material_inventory", // 目标水位定在哪、超储欠储呆滞各多少
  mrp_netting: "material_inventory", // 物料净需求多少、最早齐套是哪天

  // ── 风险预警与影响传导：「会不会出事、什么时候越线、会波及到谁」 ──
  risk_timeline: "risk_propagation", // 风险逐日怎么走、哪天越线
  counterfactual_timeline: "risk_propagation", // 如果不解决，未来 N 天会怎样（双轨对比）
  audit_timeline: "risk_propagation", // 某审计项 90 天怎么从事件窗传导到财务击穿
  affected_orders: "risk_propagation", // 这个扰动会波及哪些订单
  supplier_disruption_radius: "risk_propagation", // 某供应商断供影响半径多大、波及哪些下游
  concentration_risk: "risk_propagation", // 看似分散实则汇聚到哪个单点（暗线集中风险）

  // ── 归因与根因诊断：「为什么没达标、缺口归到哪些根因、各占多少」 ──
  plan_rootcause: "root_cause_attribution", // 某 KPI 为什么没达标、根因在哪个因子
  gap_attribution: "root_cause_attribution", // 总缺口一路归到哪些叶子原子因素、各占多少
  supply_demand_gap_attribution: "root_cause_attribution", // 供需为什么对不上：需求虚高还是供不上
  margin_attribution: "root_cause_attribution", // 毛利为什么倒挂、哪个成本项拖垮的
  yield_diagnosis: "root_cause_attribution", // 良率为什么突然下降、突变点在哪
  chain_loss_attribution: "root_cause_attribution", // 全链时间都耗在哪个环节、凭什么这个占比
  process_flow_time: "root_cause_attribution", // **哪一条**流程实例卡住、卡在谁那里、卡了多久（实例粒度，与上一条的环节粒度分层）

  // ── 对策与缺口闭合：「怎么补、方案代价多大、组合起来能收窄多少」 ──
  mitigation_select: "countermeasure_closure", // 这个风险因素该选哪个处置方案
  countermeasure_combo: "countermeasure_closure", // 多杠杆怎么组合闭合缺口、残差还剩多少
  quarterly_gap: "countermeasure_closure", // 季度缺口用哪些对策覆盖、按什么优先级
  outsourcing_split: "countermeasure_closure", // 缺口在加班/外协/延期三渠道各分多少
  decision_play: "countermeasure_closure", // 这个根因怎么补、各方案代价收益、什么信号触发什么行动

  // ── 商务接单与承诺：「这单能不能接、何时交、赚不赚、客户能不能欠」 ──
  atp_check: "order_commitment", // 这单能接多少、承诺日是哪天、卡在哪一源
  order_fullchain: "order_commitment", // 这单能不能接（交期/齐套/财务三闸）、为何要提价
  quote_margin: "order_commitment", // 这个报价毛利多少、够不够细分底线
  credit_exposure: "order_commitment", // 客户敞口多大、可用额还剩多少、逾没逾期

  // ── 经营绩效与财务测算：「指标达成多少、钱怎么样、这笔投入投不投」 ──
  metric_rollup: "performance_finance", // 各经营指标目标 vs 实际、哪些越线
  cockpit_kpi: "performance_finance", // 驾驶舱几个核心经营 KPI 各是多少
  ksf_graph: "performance_finance", // 关键成功要素怎么支撑财务计划、哪些问题在威胁它
  finance_pnl: "performance_finance", // 量价本利：收入/成本/毛利 预算 vs 滚动差多少
  // WO-FINANCE-WORLDSTATE：与上一条**分层**不是重复 —— 那个答「本体真值下三科目各是多少」（静态口径），
  // 这个答「在**这个推演世界里**、施加了那条扰动之后，成本/毛利/应收各变成多少钱」（世界态投影口径）。
  finance_world_projection: "performance_finance",
  capex_scenario: "performance_finance", // 三情景产能投资投不投、项目 IRR 与缺口窗口
  carbon_footprint: "performance_finance", // 单位产品碳成本多少、对比阈值差多少（可持续口径的经营账）

  // ── 通用组合最优化：「给定候选与约束，选谁/分给谁/装哪/怎么流才是可证最优」 ──
  selection_optimize: "combinatorial_allocation", // 预算内选哪个价值最大子集
  assignment_optimize: "combinatorial_allocation", // 待办指派到哪个容器/基地总成本最低
  packing_optimize: "combinatorial_allocation", // 用最少容器怎么装完
  facility_location: "combinatorial_allocation", // 在哪几个点开设施、需求点分派给谁
  min_cost_flow: "combinatorial_allocation", // 网络上供需怎么流成本最小
  set_cover: "combinatorial_allocation", // 用哪个最小成本子集覆盖全部元素
  independent_set: "combinatorial_allocation", // 冲突图上选哪一组互不相邻的最大权点
  combinatorial_auction: "combinatorial_allocation", // 组合出价里判谁中标、物品不重复分配
  multi_objective: "combinatorial_allocation", // 多个冲突目标怎么权衡取舍
  cross_object_occupancy: "combinatorial_allocation", // 订单×产线×合同三元占用怎么指派、谁被挤掉

  // ── 假设推演与关联探查：「改一个假设下游会怎样、沿本体能关联到什么」 ──
  generic_inference: "whatif_exploration", // 把某属性改成 X，下游派生链会怎样
  optimize_whatif: "whatif_exploration", // 改参/加约束/换权重后目标值变多少、还可行吗
  ontology_query: "whatif_exploration", // 沿本体从 X 走到 Y 关联到哪些对象、聚合是多少
};

/** 类目内求解器的稳定序：`SOLVER_KEYS` 声明序（不依赖对象键序·R6）。 */
const KEY_ORDER = new Map<string, number>((SOLVER_KEYS as readonly string[]).map((k, i) => [k, i]));

/** 单个求解器的类目；未登记 → `undefined`（诚实返回，不兜底塞一个"其他"）。 */
export function solverCategoryOf(solverKey: string): SolverCategory | undefined {
  return (SOLVER_CATEGORY_MAP as Record<string, SolverCategory>)[solverKey];
}

/** 某类目下的全部求解器 key（按 `SOLVER_KEYS` 声明序·确定性 R6）。 */
export function solversInCategory(category: SolverCategory): string[] {
  return (SOLVER_KEYS as readonly string[])
    .filter((k) => solverCategoryOf(k) === category)
    .sort((a, b) => (KEY_ORDER.get(a) ?? 0) - (KEY_ORDER.get(b) ?? 0));
}

/** 全量分组投影：类目序 = `SOLVER_CATEGORIES` 声明序，组内序 = `SOLVER_KEYS` 声明序（R6）。 */
export function solversByCategory(): { category: SolverCategory; solverKeys: string[] }[] {
  return SOLVER_CATEGORIES.map((category) => ({ category, solverKeys: solversInCategory(category) }));
}

/**
 * 漏网检测（运行时第二道门）：返回 `SOLVER_KEYS` 里**没有**类目的 key。
 * 空数组 = 59/59 全覆盖。类型层已经拦过一次，这一道防的是类型约束被绕开的情形。
 */
export function uncategorizedSolverKeys(): string[] {
  return (SOLVER_KEYS as readonly string[]).filter((k) => solverCategoryOf(k) === undefined);
}
