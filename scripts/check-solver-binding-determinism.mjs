#!/usr/bin/env node
/**
 * 门 `solver-binding-determinism:check`（WO-SOLVER-ONTOLOGY-BINDING · B3 命门 · G-17）：
 * 守 SolverBinding 绑定层「向后兼容回退 + DF.8 接地 + role 全经 resolveSolverType（无残留硬编码）」。
 * 本体登记见 docs/SYSTEM-ONTOLOGY.md §2/§3（SolverBinding 绑定边）/§8（B3 闭合·G-17）。
 *
 * 静态断言（保守哨兵，编译前跑；配套 vitest test/solver-binding.test.ts 跑真回退/接地/字段映射行为）：
 *  1) 回退一致性：solver-binding.ts 的 resolveSolverType 必须有「无绑定 → canonical 默认」回退分支
 *     （否则 demo 零绑定即回归 —— P0 红线）。
 *  2) canonical 默认表覆盖：SOLVER_CANONICAL_TYPES 须至少含 order_fullchain（B3 直接命门求解器）
 *     + context（loadContext 拓扑），且 order_fullchain 含 order role 默认 "Order"。
 *  3) DF.8 接地：solver-binding.ts 须导出 assertSolverBindingGrounded（落库前挡本体外实体）。
 *  4) 无残留硬编码：service.ts 的 orderFullchain 方法体内不得再出现 listByType(…, "Order"/"Model"/
 *     "DemandSegment"/"MaterialBalance") 字面量（须经 resolveSolverType/T(role)）。
 *  5) 缓存失效钩子：service.ts 须有 invalidateBindingCache（绑定写路径清缓存，避免 stale）。
 *
 * 用法：node scripts/check-solver-binding-determinism.mjs
 */
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const abs = (rel) => new URL(rel, root);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel), "utf8") : null);
const fail = [];

// ── 1) + 2) + 3) 绑定层回退 + 默认表 + 接地 ─────────────────────────────────
const sb = read("apps/datacore/src/solvers/solver-binding.ts");
if (sb == null) fail.push("缺 apps/datacore/src/solvers/solver-binding.ts");
else {
  if (!/export function resolveSolverType/.test(sb)) fail.push("solver-binding.ts 缺 resolveSolverType 导出");
  // 回退分支：resolveSolverType 内须引用 canonical 默认（canonicalType 或 SOLVER_CANONICAL_TYPES）作回退。
  if (!/canonicalType|SOLVER_CANONICAL_TYPES/.test(sb)) fail.push("resolveSolverType 未见 canonical 默认回退 —— 威胁向后兼容（demo 零绑定回归）");
  if (!/order_fullchain/.test(sb) || !/order:\s*"Order"/.test(sb)) fail.push("SOLVER_CANONICAL_TYPES 缺 order_fullchain.order='Order' 回退默认（B3 命门）");
  if (!/context:/.test(sb)) fail.push("SOLVER_CANONICAL_TYPES 缺 context（loadContext 拓扑回退）");
  if (!/export function assertSolverBindingGrounded/.test(sb)) fail.push("solver-binding.ts 缺 assertSolverBindingGrounded（DF.8 接地导出）");
  if (!/DF\.8/.test(sb)) fail.push("solver-binding.ts 未注明 DF.8 接地语义");
}

// ── 4) service.ts orderFullchain 无残留硬编码类型字面量 ───────────────────────
const service = read("apps/datacore/src/solvers/service.ts");
if (service == null) fail.push("缺 apps/datacore/src/solvers/service.ts");
else {
  const start = service.indexOf("private async orderFullchain");
  const end = service.indexOf("private async", start + 1);
  const body = start >= 0 && end > start ? service.slice(start, end) : "";
  if (!body) fail.push("service.ts 未找到 orderFullchain 方法体");
  else {
    for (const t of ["Order", "Model", "DemandSegment", "MaterialBalance"]) {
      const re = new RegExp(`listByType\\([^)]*"${t}"`);
      if (re.test(body)) fail.push(`orderFullchain 仍硬编码 listByType(…,"${t}")（B3 未解：须经 resolveSolverType/T(role)）`);
    }
    if (!/resolveSolverType|\bT\(/.test(body)) fail.push("orderFullchain 未经 resolveSolverType 解析类型（B3 命门未接绑定层）");
  }
  if (!/invalidateBindingCache/.test(service)) fail.push("service.ts 缺 invalidateBindingCache（绑定写路径缓存失效钩子）");
  if (!/resolveSolverType\(idx, "context"/.test(service)) fail.push("loadContext/probeTypes 未经 context role 绑定解析（realco 拓扑覆盖）");
}

console.log(`· solver-binding：回退一致性 · DF.8 接地 · orderFullchain 去硬编码 · 缓存失效 · 违规 ${fail.length}`);
if (fail.length) {
  console.error("\n✗ solver-binding-determinism:check 未过（B3·G-17·向后兼容回退 / DF.8 接地）：");
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("✓ solver-binding-determinism:check 通过（role→租户真实类型经绑定 · 无绑定回退 canonical · DF.8 接地 · 绑定层缓存失效）。");
