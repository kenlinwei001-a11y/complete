#!/usr/bin/env node
/**
 * 门 `datadep-manifest:check`（DATADEP-MANIFEST-READINESS 脊·输入侧覆盖门·镜像 DF.6 到输入侧）。
 *
 * 拱心石守护：**每个推演入口必须声明数据依赖清单**（precondition-first），与输出侧 no-silent-mock
 * (SOLVER_OUTPUT_SHAPES 覆盖每 SOLVER_KEY) 对偶。四道断言：
 *   ① 输入侧覆盖：每个 SOLVER_KEY 要么在 `SOLVER_DATADEP` 声明清单（读对象图的 context 求解器），
 *      要么在 EXEMPT（arg-only/读非 SolverContext 对象的求解器·文档化豁免）——两者皆非即红（防漏声明）。
 *   ② 无孤儿/悬空：每个清单 key ∈ SOLVER_KEYS；每个 roleType ∈ ROLE_CANONICAL（可解析真类型）；minRows≥1。
 *   ③ **loadContext 治本自证**：`uncoveredContextRoles()==[]`——每个 CONTEXT_ROLE 被某清单覆盖 →
 *      loadContext 读清单并集==全 22 角色（字节一致 R6）。删掉某上下文角色的唯一清单覆盖 → 此断言红
 *      （= loadContext 会漏加载该角色·求解器读空 → 治本非再加一层写死的牙齿）。
 *   ④ R14 零业务常数：清单 roleType 全为抽象角色（不含已发布业务实例名·基地/细分字面量）。
 *
 * 依赖 datacore + contracts 已构建（gates 链 `pnpm -r build` 在前）。green→red 自证：摘一个入口清单 → 红。
 */
const svc = await import("../apps/datacore/dist/solvers/service.js").catch((e) => {
  console.error(`✗ datadep-manifest:check 导入 datacore dist 失败（先 pnpm --filter datacore build）：${e.message}`);
  process.exit(1);
});
const ctxMod = await import("../apps/datacore/dist/solvers/datadep-context.js").catch((e) => {
  console.error(`✗ datadep-manifest:check 导入 datadep-context dist 失败：${e.message}`);
  process.exit(1);
});
const contracts = await import("../packages/contracts/dist/datadep.js").catch((e) => {
  console.error(`✗ datadep-manifest:check 导入 contracts dist 失败（先 pnpm --filter @platform/contracts build）：${e.message}`);
  process.exit(1);
});
const registry = await import("../packages/contracts/dist/base-registry.js").catch(() => ({}));

const SOLVER_KEYS = svc.SOLVER_KEYS;
const { SOLVER_DATADEP } = contracts;
const { ROLE_CANONICAL, uncoveredContextRoles, CONTEXT_ROLES } = ctxMod;

/**
 * 豁免集（文档化·非漏声明）：这些求解器**不以对象图为输入前置**——
 *  - arg-only 优化族（CP-SAT/组合最优化，入参显式给候选/权重·非读对象计数）：
 *    facility_location/min_cost_flow/set_cover/independent_set/combinatorial_auction/optimize_whatif/
 *    selection_optimize/assignment_optimize/sequencing_optimize/packing_optimize。
 *  - 净室通用族（args 字段映射到任意本体·非 SolverContext 固定 22 类）：
 *    generic_inference/shared_bottleneck/concentration_risk/margin_attribution/supplier_disruption_radius/
 *    multisource_fusion。
 *  - 读非 SolverContext 对象（Metric/KSF/RootCauseChain·前置随其对象·非本 registry 上下文角色）：
 *    plan_rootcause/metric_rollup/cockpit_kpi/ksf_graph。
 *  - 元/组合求解器（组合其它求解器·前置随被组合者）：counterfactual_timeline。
 */
const EXEMPT = new Set([
  "facility_location", "min_cost_flow", "set_cover", "independent_set", "combinatorial_auction",
  "optimize_whatif", "selection_optimize", "assignment_optimize", "sequencing_optimize", "packing_optimize",
  "generic_inference", "shared_bottleneck", "concentration_risk", "margin_attribution",
  "supplier_disruption_radius", "multisource_fusion",
  "plan_rootcause", "metric_rollup", "cockpit_kpi", "ksf_graph",
  "counterfactual_timeline",
]);

let red = false;

// ① 输入侧覆盖：每个 SOLVER_KEY 须声明清单或豁免。
for (const k of SOLVER_KEYS) {
  const declared = Object.prototype.hasOwnProperty.call(SOLVER_DATADEP, k);
  if (!declared && !EXEMPT.has(k)) {
    console.error(`✗ ${k}：既无 SOLVER_DATADEP 清单、又不在 EXEMPT → 推演入口无输入数据契约（拱心石缺·run-first 回潮）`);
    red = true;
  }
  if (declared && EXEMPT.has(k)) {
    console.error(`✗ ${k}：同时声明清单又豁免（矛盾·EXEMPT 应移除）`);
    red = true;
  }
}

// ② 无孤儿/悬空 + minRows≥1 + roleType 可解析。
const vocab = new Set([
  ...(Array.isArray(registry.BASE_REGISTRY) ? registry.BASE_REGISTRY.map((b) => b.name) : []),
  ...(Array.isArray(registry.SEG_REGISTRY) ? registry.SEG_REGISTRY.map((s) => s.seg) : []),
]);
for (const [k, dep] of Object.entries(SOLVER_DATADEP)) {
  if (!SOLVER_KEYS.includes(k)) {
    console.error(`✗ 清单 ${k}：非注册求解器（孤儿清单·SOLVER_KEYS 无此 key）`);
    red = true;
  }
  if (!Array.isArray(dep.requires) || dep.requires.length === 0) {
    console.error(`✗ 清单 ${k}：requires 为空（context 求解器至少需 1 个角色·空则应 EXEMPT）`);
    red = true;
  }
  for (const req of dep.requires ?? []) {
    if (!ROLE_CANONICAL[req.roleType]) {
      console.error(`✗ 清单 ${k}：roleType「${req.roleType}」无 canonical 映射（悬空·不可解析真类型）`);
      red = true;
    }
    if (!(Number.isInteger(req.minRows) && req.minRows >= 1)) {
      console.error(`✗ 清单 ${k}.${req.roleType}：minRows 须为整数 ≥1（结构性下限）`);
      red = true;
    }
    // ④ R14：roleType 不得是业务实例名（基地/细分字面量）。
    if (vocab.has(req.roleType)) {
      console.error(`✗ 清单 ${k}.${req.roleType}：roleType 命中已发布业务实例名（违 R14·须用抽象角色键）`);
      red = true;
    }
  }
}

// ⑤ WO ONTO-SCEN-RENDER-PROJ ③：契约层角色映射投影（DATADEP_ROLE_CANONICAL，切片目标派生用）
//    与 datacore ROLE_CANONICAL **逐键一致**——单一真相的两个投影，漂移即红。
const contractCanon = contracts.DATADEP_ROLE_CANONICAL ?? {};
const roleKeys = new Set([...Object.keys(ROLE_CANONICAL), ...Object.keys(contractCanon)]);
for (const role of roleKeys) {
  if (ROLE_CANONICAL[role] !== contractCanon[role]) {
    console.error(`✗ 角色映射漂移：role「${role}」datacore=${ROLE_CANONICAL[role] ?? "∅"} vs contracts=${contractCanon[role] ?? "∅"}（DATADEP_ROLE_CANONICAL 须与 ROLE_CANONICAL 逐键一致）`);
    red = true;
  }
}

// ③ loadContext 治本自证：每个上下文角色被某清单覆盖。
const uncovered = uncoveredContextRoles();
if (uncovered.length > 0) {
  console.error(
    `✗ 上下文角色未被任何清单覆盖：[${uncovered.join(", ")}] → loadContext 读清单并集将漏加载这些角色（求解器读空）。` +
    `修：在某求解器清单声明该角色，或从 CONTEXT_ROLES 移除（若已无求解器需要）。`,
  );
  red = true;
}

if (red) {
  console.error("\n✗ datadep-manifest:check 未过（上述入口/角色）。拱心石：每入口声明数据依赖清单·loadContext 读清单并集·门镜像 DF.6 到输入侧。");
  process.exit(1);
}
const declaredCount = Object.keys(SOLVER_DATADEP).length;
console.log(
  `✓ datadep-manifest:check 通过（${declaredCount} 入口声明清单 + ${EXEMPT.size} 豁免 = ${SOLVER_KEYS.length} 求解器全覆盖·` +
  `${CONTEXT_ROLES.length} 上下文角色全被清单覆盖·loadContext 读清单并集字节一致 R6）。`,
);
