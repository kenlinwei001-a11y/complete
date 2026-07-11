/**
 * SimContextOverlay（WO-SANDBOX-TEMPORAL-GROUNDING·S6·§3.3·闭 G-B）。
 *
 * 问题：`datadep-context.ts loadContext` 从 **live repos** 装 SolverContext；ImpactAssessment/决策维
 * 若直接在 live 上算，则**基线 == 情景**（都读真库）= 假评估。
 *
 * 解法：`buildSimSolverContext(tenantId, simState, base)` = 在 loadContext(live) 之上，把**模拟态**
 * （SimSession 某 tick 的 TickState）覆盖到承载对象的对应 props——**基线跑基线态、情景跑情景态**，才有真 delta。
 *
 * 复用 `calibration/replay.ts patchContext` 的**单因子替换同款机制**：不动原对象（重放是只读的），
 * map 出打了补丁的新数组。求解器**零改**（照常吃 SolverContext）。
 *
 * ⛔ R4（dryRun·§3.3）：overlay 是**纯只读**——绝不写 repo、绝不落真值（base 上下文对象不被 mutate，
 *    返回全新数组/对象）。F2（overlay 泄漏污染 live 库）= 立即回退判据。
 * ⛔ R6：纯函数，无 Date.now/random；同 (simState, base) → 同输出。
 */
import type { TickState } from "@platform/contracts";
import type { ObjectInstance } from "../domain.js";
import type { SolverContext } from "../solvers/types.js";

/**
 * SolverContext 上**承载对象**的数组字段（可被 simState 覆盖 props 的对象角色）。
 * 与 `solvers/types.ts SolverContext` 的 ObjectInstance[] 字段一一对应；非对象字段（params/certByModel/
 * features/rules…）不 overlay。新增承载角色时在此登记（否则该角色的模拟态覆盖会漏）。
 */
const OVERLAYABLE_ARRAYS = [
  "bases", "lines", "processes", "equipment", "maintPlans", "models", "orders", "shipments",
  "segments", "dataHealth", "demandSegments", "sopVersions", "materials", "materialBatches",
  "customers", "arInvoices", "certifications", "energyMeters", "changeoverMatrix",
  "capexProjects", "purchaseOrders", "carbonFactors",
] as const;

/**
 * 把模拟态 simState（对象 id → 状态变量 → 数值）覆盖到 base 上下文承载对象的 props（只读·R4）。
 * @param tenantId 校验用（R2·必须 === base.tenantId）
 * @param simState 某 tick 的世界态（基线态或情景态）
 * @param base     loadContext(live) 得到的真实上下文
 * @returns 覆盖后的**全新** SolverContext（base 不被 mutate）
 */
export function buildSimSolverContext(tenantId: string, simState: TickState, base: SolverContext): SolverContext {
  // 单对象覆盖：命中 simState[o.id] 才 patch（其余状态变量沿用真 props）；不动原对象（R4·只读）。
  const overlayObj = (o: ObjectInstance): ObjectInstance => {
    const patch = simState[o.id];
    if (!patch || Object.keys(patch).length === 0) return o;
    return { ...o, props: { ...o.props, ...patch } };
  };
  const out: SolverContext = { ...base, tenantId };
  const asRec = out as unknown as Record<string, unknown>;
  const baseRec = base as unknown as Record<string, unknown>;
  for (const key of OVERLAYABLE_ARRAYS) {
    const arr = baseRec[key];
    if (Array.isArray(arr)) asRec[key] = (arr as ObjectInstance[]).map(overlayObj);
  }
  return out;
}

/** 门/测试用：SolverContext 里应被 overlay 覆盖的承载数组字段名（防新增角色漏登）。 */
export const OVERLAYABLE_CONTEXT_ARRAYS: readonly string[] = OVERLAYABLE_ARRAYS;
