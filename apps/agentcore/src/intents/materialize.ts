/**
 * WO-INTENT-MATERIALIZE-BINDING-COMPLETE：意图层物化 —— 从 SCENARIO_CATALOG（单一来源）派生
 * 20 个一等 PUBLISHED Intent（含 mode + 全绑定链 6 项），并注册对应的一等本体切片（SliceSpec）。
 *
 * 治本四步之 ①②：物化 20 一等 Intent + 全绑定链完整。mode 由审核方逐意图钉死（R14 配置驱动·非硬编码
 * 分派）；绑定确定性（R6：同 catalog 同物化）；骨架零业务实体名（R14：rootType/绑定为本体对象类型 key，
 * 行业绑定经 solver/IndustryPack）。
 */
import type { MaterializedIntent, IntentMode, IntentSliceSpec, SlotDef } from "@platform/contracts";
import { SCENARIO_CATALOG, scenarioByIntent } from "../scenarios-catalog.js";

export const SEED_TENANT = "demo";

/**
 * mode 逐意图（审核方定·钉死·勿改）：workflow-first(13)=价值在输出「是多少/过不过/有哪些」；
 * agent-first(7)=价值在推理「为什么/哪个好/怎么选」。全 -first 保兜底（数字红线防造假）。
 */
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
  risk_root_cause: "AGENT_FIRST",
  plan_recommend: "AGENT_FIRST",
  yield_diag: "AGENT_FIRST",
  maint_stagger: "AGENT_FIRST",
  outsourcing_q: "AGENT_FIRST",
  capex_review: "AGENT_FIRST",
  quarterly_gap_q: "AGENT_FIRST",
};

/** 对口方法论 skill（复用出厂 skl_*·B4 Skill 库）。 */
const INTENT_SKILL: Record<string, string> = {
  capacity_feasibility: "skl_seed_capacity",
  affected_orders: "skl_risk_diagnosis",
  risk_root_cause: "skl_risk_diagnosis",
  plan_audit_q: "skl_plan_scheme",
  plan_recommend: "skl_plan_scheme",
  adopt_mitigation: "skl_risk_diagnosis",
  cert_scheduling: "skl_seed_capacity",
  kit_analysis: "skl_risk_diagnosis",
  lta_gap_q: "skl_sop_balance",
  inventory_opt: "skl_sop_balance",
  changeover_opt: "skl_seed_capacity",
  yield_diag: "skl_risk_diagnosis",
  maint_stagger: "skl_seed_capacity",
  outsourcing_q: "skl_plan_scheme",
  quote_margin_q: "skl_order_margin",
  credit_check: "skl_order_margin",
  capex_review: "skl_plan_scheme",
  sop_status: "skl_sop_balance",
  quarterly_gap_q: "skl_sop_balance",
  carbon_q: "skl_risk_diagnosis",
};

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
      skillId: INTENT_SKILL[key] ?? "skl_seed_capacity",
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
