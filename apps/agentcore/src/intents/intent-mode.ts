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
