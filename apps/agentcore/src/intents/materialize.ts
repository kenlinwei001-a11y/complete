/**
 * WO-INTENT-MATERIALIZE-BINDING-COMPLETE：意图层物化 —— 从 SCENARIO_CATALOG（单一来源）派生
 * 20 个一等 PUBLISHED Intent（含 mode + 全绑定链 6 项），并注册对应的一等本体切片（SliceSpec）。
 *
 * 治本四步之 ①②：物化 20 一等 Intent + 全绑定链完整。mode 由审核方逐意图钉死（R14 配置驱动·非硬编码
 * 分派）；绑定确定性（R6：同 catalog 同物化）；骨架零业务实体名（R14：rootType/绑定为本体对象类型 key，
 * 行业绑定经 solver/IndustryPack）。
 */
import type { MaterializedIntent, IntentSliceSpec, SlotDef } from "@platform/contracts";
import { SCENARIO_CATALOG, scenarioByIntent } from "../scenarios-catalog.js";
import { INTENT_MODE } from "./intent-mode.js";

export const SEED_TENANT = "demo";

/**
 * WO MODE-DISPATCH-HONOR：mode 钉死表（审核方定·13 workflow-first / 7 agent-first）移入
 * `./intent-mode.ts`（唯一真相源·scenarios-catalog 派生一等 Scenario 的 mode 亦读同一张表）。
 * 此处 re-export 保持既有消费点（reconcile / 门 scene-agent-config:check）零变更。
 */
export { INTENT_MODE, intentModeFor } from "./intent-mode.js";

/**
 * 对口方法论 skill（B4 Skill 库单一来源·20 卡逐一挂对口方法论）。
 * SKILL-LIBRARY-EVERYWHERE §4：补种方法论 skill 后逐卡重挂对口方法论（齐套/碳合规/认证/库存/信用/换型），
 * 不再把异质场景一律指向少数几条（库存量 5→11）。export 供 seed.ts 派生 plan.skillRefs。
 */
export const INTENT_SKILL: Record<string, string> = {
  capacity_feasibility: "skl_seed_capacity",
  affected_orders: "skl_risk_diagnosis",
  risk_root_cause: "skl_risk_diagnosis",
  plan_audit_q: "skl_plan_scheme",
  plan_recommend: "skl_plan_scheme",
  adopt_mitigation: "skl_risk_diagnosis",
  cert_scheduling: "skl_cert_schedule",
  kit_analysis: "skl_kit_readiness",
  lta_gap_q: "skl_kit_readiness",
  inventory_opt: "skl_inventory_opt",
  changeover_opt: "skl_changeover",
  yield_diag: "skl_risk_diagnosis",
  maint_stagger: "skl_seed_capacity",
  outsourcing_q: "skl_plan_scheme",
  quote_margin_q: "skl_order_margin",
  credit_check: "skl_credit_risk",
  capex_review: "skl_plan_scheme",
  sop_status: "skl_sop_balance",
  quarterly_gap_q: "skl_sop_balance",
  carbon_q: "skl_carbon_compliance",
  // CORE-NL-SOLVER-ROUTING：5 个通用求解器场景卡对口方法论（复用既有出厂 skill·SKILL-LIB-POLISH②
  // 目录卡必须显式挂对口方法论，漏配即 skillIdForIntent 抛错）。
  shared_bottleneck_q: "skl_seed_capacity",
  concentration_risk_q: "skl_risk_diagnosis",
  margin_attribution_q: "skl_order_margin",
  supplier_disruption_q: "skl_risk_diagnosis",
  multisource_fusion_q: "skl_risk_diagnosis",
  // QUERY30 缺口③ Q01 样板：接单挤占推演对口「经营方案」方法论（多方案比选口径）。
  what_if_displacement_q: "skl_plan_scheme",
  // UPG-L0-COVERAGE-FILL：通用因果归因对口「风险诊断」方法论（越线根因取证口径）。
  causal_attribution_q: "skl_risk_diagnosis",
  // Q30-P2 求解器横铺 A：3 个复用求解器场景卡对口方法论（复用既有出厂 skill）。
  capex_alternatives_q: "skl_plan_scheme", // CAPEX 方案比选 → 经营方案方法论（多方案比选口径·同 capex_review）
  full_cost_rollup_q: "skl_order_margin", // 全成本卷积（成本→损益）→ 接单毛利/成本方法论
  signal_propagation_q: "skl_risk_diagnosis", // 信号图传导 → 风险诊断方法论（同 supplier_disruption_q）
};

/** 默认方法论（真实兜底·仅供非目录键的 hardcoded 计划如 what_if_displacement_q 用·目录卡禁静默回落）。 */
export const DEFAULT_SKILL_ID = "skl_seed_capacity";

/**
 * 按意图键取对口方法论 skillId。供 plan/workflow.skillRefs 与全绑定链派生。
 * SKILL-LIB-POLISH②：目录卡（∈SCENARIO_CATALOG）**必须**显式挂对口方法论——漏配即**抛错**（非静默回落
 * skl_seed_capacity·否则将来新增未映射卡会悄悄退回产能方法论而非报错）。门 skill-integrity:check 亦静态守此。
 * 非目录键（hardcoded 计划 what_if_displacement_q 等）保留 DEFAULT_SKILL_ID 真实默认。
 */
export function skillIdForIntent(intentKey: string): string {
  const explicit = INTENT_SKILL[intentKey];
  if (explicit) return explicit;
  if (scenarioByIntent(intentKey)) {
    throw new Error(
      `skillIdForIntent: 场景卡「${intentKey}」缺显式 INTENT_SKILL 映射——禁静默回落 ${DEFAULT_SKILL_ID}，请在 INTENT_SKILL 显式挂对口方法论。`,
    );
  }
  return DEFAULT_SKILL_ID;
}

/** 目录卡中未显式挂 INTENT_SKILL 映射的 intentKey（供门 skill-integrity:check 静态揪漏配·空=全覆盖）。 */
export function unmappedCatalogIntentKeys(): string[] {
  return SCENARIO_CATALOG.filter((c) => !INTENT_SKILL[c.intentKey]).map((c) => c.intentKey);
}

/** agent-first 意图绑定的场景 agent（scene-entry defaultAgent 派生·均 PUBLISHED）。 */
const INTENT_AGENT: Record<string, string> = {
  risk_root_cause: "agt_risk",
  plan_recommend: "agt_plan_generate",
  yield_diag: "agt_risk",
  maint_stagger: "agt_risk",
  outsourcing_q: "agt_plan_generate",
  capex_review: "agt_plan_generate",
  quarterly_gap_q: "agt_quarterly",
};

/** 本体切片 rootType（由 solver 读的主对象类型派生·本体对象类型 key·industry-agnostic）。 */
const INTENT_SLICE_ROOT: Record<string, string> = {
  capacity_feasibility: "Model",
  affected_orders: "Base",
  risk_root_cause: "Base",
  plan_audit_q: "Plan",
  plan_recommend: "Plan",
  adopt_mitigation: "Base",
  cert_scheduling: "Model",
  kit_analysis: "Order",
  lta_gap_q: "Material",
  inventory_opt: "Material",
  changeover_opt: "Line",
  yield_diag: "Base",
  maint_stagger: "Line",
  outsourcing_q: "Order",
  quote_margin_q: "Order",
  credit_check: "Customer",
  capex_review: "Base",
  sop_status: "Plan",
  quarterly_gap_q: "Plan",
  carbon_q: "Model",
  // CORE-NL-SOLVER-ROUTING：通用求解器读的主对象类型（切片 rootType·industry-agnostic 本体 key）。
  shared_bottleneck_q: "Base",
  concentration_risk_q: "Order",
  margin_attribution_q: "Order",
  supplier_disruption_q: "Base",
  multisource_fusion_q: "Order",
  // QUERY30 缺口③ Q01 样板：接单挤占推演主对象=急单型号（Model）。
  what_if_displacement_q: "Model",
  // UPG-L0-COVERAGE-FILL：通用因果归因主对象=越线指标（Metric·decision 域一等对象）。
  causal_attribution_q: "Metric",
  // Q30-P2 求解器横铺 A：3 个复用求解器读的主对象类型（切片 rootType·industry-agnostic 本体 key）。
  capex_alternatives_q: "Base", // CAPEX 方案比选主对象=投资落点基地
  full_cost_rollup_q: "Base", // 全成本卷积主对象=产能承载基地
  signal_propagation_q: "Base", // 信号图传导主对象=信号源基地
};

/** BP-4 对齐 seedIntentsAndPlans：sop_balance 求解器实际绑 mrp_netting（已注册·有真表）。 */
const SOLVER_OVERRIDE: Record<string, string> = { sop_balance: "mrp_netting" };

const suffix = (tenantId: string) => (tenantId === SEED_TENANT ? "" : `__${tenantId}`);

/** workflow-first 绑定的执行计划 id（= seedIntentsAndPlans 生成的计划 id·PUBLISHED）。 */
export function planIdForIntent(intentKey: string, tenantId = SEED_TENANT): string {
  return `plan_${intentKey}_v1${suffix(tenantId)}`;
}

/** 意图本地切片 key。 */
export function sliceKeyForIntent(intentKey: string): string {
  return `slice_${intentKey}`;
}

/** 求解器 key 注册表（SCENARIO_CATALOG 单一来源 + override）——供全绑定链门静态校验 solver∈注册表。 */
export function registeredSolverKeys(): Set<string> {
  const keys = new Set<string>();
  for (const c of SCENARIO_CATALOG) keys.add(SOLVER_OVERRIDE[c.solver] ?? c.solver);
  return keys;
}

/**
 * 一等本体切片注册表（每意图一片·root→hops·PUBLISHED）。缺切片时 reconcile 亦据此登记。
 * hops=[] 为 root-only 骨架切片（诚实：数据源范围声明·非虚构关联）。
 */
export function seedIntentSlices(tenantId = SEED_TENANT): IntentSliceSpec[] {
  return SCENARIO_CATALOG.map((c) => ({
    sliceKey: sliceKeyForIntent(c.intentKey),
    tenantId,
    rootType: INTENT_SLICE_ROOT[c.intentKey] ?? "Order",
    hops: [],
    description: `${c.name} 数据源范围（root=${INTENT_SLICE_ROOT[c.intentKey] ?? "Order"}）`,
    status: "PUBLISHED" as const,
  }));
}

/** 从场景卡的 presetContext 选中对象派生最小 slots（objectRef 主对象 + 预置槽键）。 */
function slotsForCard(card: (typeof SCENARIO_CATALOG)[number]): SlotDef[] {
  const slots: SlotDef[] = [];
  const primary = card.presetContext.selectedObjects[0];
  if (primary) {
    slots.push({
      name: primary.objectType.toLowerCase(),
      type: "objectRef",
      required: true,
      defaultFrom: "$.selectedObjects[0]",
      // 铁律 0.4：面向用户的人话反问（含示例锚点），绝不甩裸对象类型 key。
      clarifyPrompt: `请指明要分析的${primary.label ?? primary.objectType}（如 ${primary.label ?? primary.objectId}；也可在页面选中对象自动带入）`,
      description: `${primary.objectType} 对象引用`,
      refType: primary.objectType,
    });
  }
  return slots;
}

/**
 * 物化 20 一等 Intent（PUBLISHED·全绑定链 6 项齐）。SCENARIO_CATALOG 单一来源·确定性（R6）。
 */
export function materializeIntents(tenantId = SEED_TENANT, now = new Date().toISOString()): MaterializedIntent[] {
  return SCENARIO_CATALOG.map((card) => {
    const key = card.intentKey;
    const mode = INTENT_MODE[key] ?? "WORKFLOW_FIRST";
    const solverKey = SOLVER_OVERRIDE[card.solver] ?? card.solver;
    const bindings = {
      solverKey,
      ruleKeys: [...card.rules], // evaluation（C-规则默认 evaluation·datacore 契约「未标视为 evaluation」）
      constraintKeys: [] as string[], // constraint（本 catalog 无 constraint-typed 规则→空·reconcile 可后补）
      skillId: skillIdForIntent(key), // SKILL-LIB-POLISH②：经守卫单一来源·目录卡漏配即抛错（非静默回落）

      ontologySliceKey: sliceKeyForIntent(key),
      ...(mode === "AGENT_FIRST"
        ? { agentId: INTENT_AGENT[key] ?? "agt_seed_analyst" }
        : { workflowId: planIdForIntent(key, tenantId) }),
    };
    return {
      id: `mint_${tenantId}_${key}`,
      tenantId,
      key,
      name: card.name,
      description: card.summary,
      examples: [card.triggerQuestion],
      slots: slotsForCard(card),
      mode,
      bindings,
      status: "PUBLISHED" as const,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
  });
}

/** 便捷：按 intentKey 取物化意图（如需单卡）。 */
export function materializedIntentByKey(intentKey: string, tenantId = SEED_TENANT): MaterializedIntent | undefined {
  if (!scenarioByIntent(intentKey)) return undefined;
  return materializeIntents(tenantId).find((i) => i.key === intentKey);
}
