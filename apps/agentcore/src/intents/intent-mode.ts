/**
 * WO MODE-DISPATCH-HONOR：意图 mode 钉死表的**唯一真相源**（单一来源·勿两处各写一套）。
 *
 * mode 逐意图（审核方定·钉死·勿改）：workflow-first(13)=价值在输出「是多少/过不过/有哪些」；
 * agent-first(7)=价值在推理「为什么/哪个好/怎么选」。全 -first 保兜底（数字红线防造假）。
 *
 * 为什么独立成模块：materialize.ts（物化一等 Intent）与 scenarios-catalog.ts（出厂一等 Scenario 投影）
 * 都要按本表派生 mode——materialize.ts import scenarios-catalog.ts，若表留在 materialize.ts 会成环。
 * 本模块零依赖（仅契约类型），两侧共用同一张表（审计簇⑦根因=场景实体一揽子 WORKFLOW_FIRST 把钉死表架空）。
 */
import type { IntentMode } from "@platform/contracts";

export const INTENT_MODE: Record<string, IntentMode> = {
  capacity_feasibility: "WORKFLOW_FIRST",
  affected_orders: "WORKFLOW_FIRST",
  plan_audit_q: "WORKFLOW_FIRST",
  adopt_mitigation: "WORKFLOW_FIRST",
  cert_scheduling: "WORKFLOW_FIRST",
  kit_analysis: "WORKFLOW_FIRST",
  lta_gap_q: "WORKFLOW_FIRST",
  inventory_opt: "WORKFLOW_FIRST",
  changeover_opt: "WORKFLOW_FIRST",
  quote_margin_q: "WORKFLOW_FIRST",
  credit_check: "WORKFLOW_FIRST",
  sop_status: "WORKFLOW_FIRST",
  carbon_q: "WORKFLOW_FIRST",
  // CORE-NL-SOLVER-ROUTING：5 个通用多跳求解器场景卡——价值在「有哪些/谁最狠/是多少」（求解器算出的
  // 承载数据表），故 WORKFLOW_FIRST（路径A 确定性作答，非 agent 自由推理）。
  shared_bottleneck_q: "WORKFLOW_FIRST",
  concentration_risk_q: "WORKFLOW_FIRST",
  margin_attribution_q: "WORKFLOW_FIRST",
  supplier_disruption_q: "WORKFLOW_FIRST",
  multisource_fusion_q: "WORKFLOW_FIRST",
  // QUERY30 缺口③ Q01 样板：接单挤占推演——价值在「能不能接/挤占哪些/有哪些方案」（求解器承载数据表）→ WORKFLOW_FIRST。
  what_if_displacement_q: "WORKFLOW_FIRST",
  // UPG-L0-COVERAGE-FILL：通用因果归因（为什么 X 越线/恶化）——价值在「越线多少/根因主驱动是谁」（求解器量化承载数据）→ WORKFLOW_FIRST（确定性是地板·不落 Path B）。
  causal_attribution_q: "WORKFLOW_FIRST",
  // UPG-L0-COVERAGE-FILL / CLASSIFY-FUSE 返工：风险越线根因（S03「常州物料齐套为什么这天越线」）此前 AGENT_FIRST
  // → 无 LLM 时恒 Path B FAILED。改 WORKFLOW_FIRST：重定向到 path-A 通用 causal_attribution 求解器（route=graph·
  // 读真对象图·每个归因数溯源真字段），价值在「越线多少/根因主驱动是哪个物料」承载数据 → 确定性作答不落 Path B。
  risk_root_cause: "WORKFLOW_FIRST",
  // Q30-P2 求解器横铺 A：3 个复用求解器场景卡——价值在「哪套最优/全成本态势/传导到谁」（求解器承载数据表）→ WORKFLOW_FIRST。
  capex_alternatives_q: "WORKFLOW_FIRST",
  full_cost_rollup_q: "WORKFLOW_FIRST",
  signal_propagation_q: "WORKFLOW_FIRST",
  // Q30-P3 求解器横铺 B：3 新域 + 2 复用类场景卡——价值在「现金曲线/配工缺口/能耗排程/改道分配/联合排产」（求解器承载数据表）→ WORKFLOW_FIRST。
  cash_projection_q: "WORKFLOW_FIRST",
  labor_balance_q: "WORKFLOW_FIRST",
  energy_cost_schedule_q: "WORKFLOW_FIRST",
  reroute_decision_q: "WORKFLOW_FIRST",
  multi_constraint_schedule_q: "WORKFLOW_FIRST",
  // Q30-P4 跨求解器编排层（治 countermeasure 诈账根）：对策组合编排——价值在「杠杆组合怎么排/保哪两个舍哪个/总成本残余缺口」（编排层真调子求解器承载数据表）→ WORKFLOW_FIRST。
  countermeasure_combo_q: "WORKFLOW_FIRST",
  // Q30-P5 发育层（DESIGN-query30 §2.5·闭 G-9）：6 条 workflow 多步链场景卡——价值在求解器承载的数据表
  // （现金曲线/改道分配/联合排产/毛利倒挂/传导集中/资本比选）→ WORKFLOW_FIRST（确定性路径A 真跑双求解器链）。
  cash_alert_combo_chain: "WORKFLOW_FIRST",
  disruption_reroute_chain: "WORKFLOW_FIRST",
  kit_schedule_chain: "WORKFLOW_FIRST",
  fullcost_margin_chain: "WORKFLOW_FIRST",
  signal_concentration_chain: "WORKFLOW_FIRST",
  capex_cash_chain: "WORKFLOW_FIRST",
  plan_recommend: "AGENT_FIRST",
  yield_diag: "AGENT_FIRST",
  maint_stagger: "AGENT_FIRST",
  outsourcing_q: "AGENT_FIRST",
  capex_review: "AGENT_FIRST",
  quarterly_gap_q: "AGENT_FIRST",
};

/** 按意图键取权威 mode（未钉死的自助/pack 意图默认 workflow-first·与既有语义一致）。 */
export function intentModeFor(intentKey: string): IntentMode {
  return INTENT_MODE[intentKey] ?? "WORKFLOW_FIRST";
}

/**
 * agent-first 意图 → 绑定的出厂场景 agent id（均 PUBLISHED sceneAgent）。**单一来源**（勿两处各写一套）：
 * materialize.ts（物化一等 Intent.bindings.agentId）与 scenarios-catalog.ts（一等 Scenario.defaultAgentId 投影）
 * 都从本表派生——同 INTENT_MODE 的动机，放零依赖模块避 materialize↔scenarios-catalog 成环。
 *
 * WO-SWEEP-01-SCENE-SEED：此前该表只在 materialize.ts 里，scenarioFromCard 无从取用 → 6 张 AGENT_FIRST 场景卡
 * （S05/S12/S13/S14/S17/S19）的一等 Scenario.defaultAgentId 恒空 → 启动器渲染断链（AGENT_FIRST 无 agent 不可启动）。
 * 提到此处后两侧共用同一映射，出厂 Scenario 投影即带真实 PUBLISHED defaultAgentId。
 */
export const INTENT_AGENT: Record<string, string> = {
  risk_root_cause: "agt_risk",
  plan_recommend: "agt_plan_generate",
  yield_diag: "agt_risk",
  maint_stagger: "agt_risk",
  outsourcing_q: "agt_plan_generate",
  capex_review: "agt_plan_generate",
  quarterly_gap_q: "agt_quarterly",
};

/** agent-first 兜底终点：未显式映射的 agent-first 意图回落一等全域探索智能体（agt_universal 亦 PUBLISHED）。 */
export const FALLBACK_AGENT_ID = "agt_seed_analyst";

/** 按意图键取绑定场景 agent id（agent-first 专用；未映射回落兜底 agent·与既有 materialize 语义一致）。 */
export function intentAgentFor(intentKey: string): string {
  return INTENT_AGENT[intentKey] ?? FALLBACK_AGENT_ID;
}
