/**
 * 轨B·增量3 optimize_whatif（what-if over optimization · 不 exec 裸代码）。
 *
 * 回路（SPEC §4，借上游 what-if 8 步收敛进安全栈）：
 *   结构化扰动 OptPerturbation（非任意代码，守 A18/R6）
 *     --DF.8 接地（target 须在已绑定 role/参数内）-->
 *   把扰动施加到「基线 args 的克隆」（不落真值 R4，复用 recompute(dryRun) 的"克隆+不 persist"骨架思想）-->
 *   **optimizer-client sidecar 重解（CP-SAT）**（FUS1：不进 A18 沙箱——沙箱跑不了 CP-SAT）-->
 *   {Δ目标值, 可行性, 冲突约束(IIS 式)} --R13--> 解释（新解 vs 原解）。
 *
 * 这是纯函数式的「扰动施加 + 结果对比」工具；真正的求解走 service 注入的 5 核心 sidecar 调用。
 * 确定性 R6：扰动按 (kind,target) 字典序稳定施加；同基线同扰动 → 同结果。
 */
import type { OptPerturbation, OptTemplateFamily, OptWhatifResult } from "@platform/contracts";
import { validationError } from "../errors.js";

/** 求解函数签名（service 注入：把结构化 args 交给对应 family 的 5 核心 sidecar 求解器）。 */
export type SolveArgsFn = (family: OptTemplateFamily, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** 深克隆（结构化 args 全是 JSON 可序列化 → 安全），保证扰动不污染基线（R4 不落真值的本地版）。 */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 取目标值（5 核心成功路径均有 objective；INFEASIBLE 时为 null 语义）。 */
function objOf(out: Record<string, unknown>): number | null {
  const feasible = out.status !== "INFEASIBLE";
  return feasible && typeof out.objective === "number" ? out.objective : null;
}

/** WO-CROSS-OBJECT-MULTIOBJ：取多目标各目标值（multi_objective/cross_object_occupancy 回报 objectiveValues）。 */
function objValuesOf(out: Record<string, unknown>): Record<string, number> | null {
  const feasible = out.status !== "INFEASIBLE";
  const ov = out.objectiveValues;
  if (!feasible || ov == null || typeof ov !== "object") return null;
  const r: Record<string, number> = {};
  for (const [k, v] of Object.entries(ov as Record<string, unknown>)) if (typeof v === "number") r[k] = v;
  return r;
}

/**
 * DF.8 接地：扰动 target 必须指向**基线 args 内已存在的可寻址参数**（role/对象 id/参数键），
 * 绝不凭空造目标。target 语法（与 5 核心 args 对齐，多行业通用）：
 *   - "facilities.<id>.openCost" / "facilities.<id>.capacity"  （facility_location）
 *   - "nodes.<id>.supply" / "arcs.<from>-<to>.cost" / ".cap"     （min_cost_flow）
 *   - "sets.<id>.cost"                                           （set_cover）
 *   - "nodes.<id>.weight"                                        （independent_set）
 *   - "bids.<id>.value"                                          （combinatorial_auction）
 *   - "objective.weight"（change_objective_weight：全局系数缩放，universal）
 */
function resolveTarget(args: Record<string, unknown>, target: string): { ok: boolean; reason?: string } {
  if (target === "objective.weight") return { ok: true };
  const parts = target.split(".");
  if (parts.length < 2) return { ok: false, reason: `target '${target}' 语法须为 <collection>.<id>[.<field>]` };
  // WO-CROSS-OBJECT-MULTIOBJ：多目标权重扰动 "objectives.<key>.weight"——objectives 按 key 匹配（非 id）。
  // 权重是"新增/调整目标权重"，即便基线 args 未显式给该目标（用默认权重）也允许，故此处放行（applyOne 负责创建/更新）。
  if (parts[0] === "objectives") return { ok: true };
  const coll = (args as Record<string, unknown>)[parts[0]!];
  if (!Array.isArray(coll)) return { ok: false, reason: `target 集合 '${parts[0]}' 不在 args 内（DF.8：扰动不得指向本体/参数外）` };
  const id = parts[1]!;
  // arcs 用 "from-to" 复合 id。
  const hit = coll.some((e: Record<string, unknown>) => {
    if (parts[0] === "arcs") return `${e.from}-${e.to}` === id;
    return String(e.id) === id;
  });
  if (!hit) return { ok: false, reason: `target '${target}' 指向的对象 '${id}' 不在 args.${parts[0]} 内（DF.8 接地失败）` };
  return { ok: true };
}

/** 把单条扰动施加到 args 克隆（in-place）。返回受影响的约束族 key（供冲突上报）。 */
function applyOne(args: Record<string, unknown>, p: OptPerturbation): string {
  // WO-CROSS-OBJECT-MULTIOBJ：多目标"设某目标权重" "objectives.<key>.weight"（objectives 按 key 匹配；缺省则以默认权重 1 创建）。
  // 须先于下面"全局系数缩放"分支——否则 change_objective_weight 会被误当作全局缩放（掩盖多目标权衡）。
  if (p.target.startsWith("objectives.")) {
    const id = p.target.split(".")[1]!;
    let coll = args.objectives as Record<string, unknown>[] | undefined;
    if (!Array.isArray(coll)) {
      coll = [];
      args.objectives = coll;
    }
    let obj = coll.find((e) => String(e.key) === id);
    if (!obj) {
      obj = { key: id, weight: 1 };
      coll.push(obj);
    }
    const w = typeof p.value === "number" ? p.value : Number(p.value);
    if (!Number.isFinite(w)) throw validationError(`objectives.${id}.weight 的 value 须为数值`);
    obj.weight = w;
    return `objectives.${id}.weight`;
  }
  if (p.kind === "change_objective_weight" || p.target === "objective.weight") {
    // 全局目标系数缩放：对所有成本/价值字段乘以权重（universal，确定性）。
    const w = typeof p.value === "number" ? p.value : Number(p.value);
    if (!Number.isFinite(w)) throw validationError("change_objective_weight 的 value 须为数值");
    for (const coll of Object.values(args)) {
      if (!Array.isArray(coll)) continue;
      for (const e of coll as Record<string, unknown>[]) {
        for (const f of ["openCost", "cost", "value", "weight"]) {
          if (typeof e[f] === "number") e[f] = (e[f] as number) * w;
        }
      }
    }
    return "objective.weight";
  }
  const [collName, id, field] = p.target.split(".");
  const coll = args[collName!] as Record<string, unknown>[];
  const obj = coll.find((e) => (collName === "arcs" ? `${e.from}-${e.to}` === id : String(e.id) === id));
  if (!obj) throw validationError(`扰动 target 对象 '${id}' 缺失`);
  const f = field ?? (collName === "facilities" ? "openCost" : collName === "bids" ? "value" : "cost");
  if (p.kind === "data_override") {
    obj[f] = typeof p.value === "number" ? p.value : Number(p.value);
  } else if (p.kind === "add_constraint") {
    // 收紧：把数值字段（如 capacity/budget/cap）设为更紧的 value（更小容量 = 更紧约束）。
    obj[f] = typeof p.value === "number" ? p.value : Number(p.value);
  } else if (p.kind === "relax_constraint") {
    // 放松：同字段设为更松的 value（更大容量）。
    obj[f] = typeof p.value === "number" ? p.value : Number(p.value);
  }
  return `${collName}.${id}.${f}`;
}

/**
 * 执行 what-if：基线求解 → 施加扰动（克隆，不落真值）→ sidecar 重解 → Δ目标 + 可行性 + 冲突约束。
 * 确定性 R6：扰动按 (kind,target) 排序后稳定施加。
 */
export async function runOptimizeWhatif(
  solve: SolveArgsFn,
  family: OptTemplateFamily,
  baselineArgs: Record<string, unknown>,
  perturbations: OptPerturbation[],
): Promise<OptWhatifResult> {
  if (perturbations.length === 0) throw validationError("optimize_whatif 需至少一条扰动");
  // DF.8 接地：每条扰动 target 须可寻址到基线 args 内。
  for (const p of perturbations) {
    const g = resolveTarget(baselineArgs, p.target);
    if (!g.ok) throw validationError(`optimize_whatif 接地失败：${g.reason}`);
  }
  // 基线求解（原 args 不改）。
  const baseOut = await solve(family, clone(baselineArgs));
  const baselineObjective = objOf(baseOut);

  // 施加扰动到克隆（R4：不落真值）；稳定序。
  const perturbed = clone(baselineArgs);
  const sorted = [...perturbations].sort((a, b) => a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target));
  const touched: string[] = [];
  for (const p of sorted) touched.push(applyOne(perturbed, p));

  // sidecar 重解（FUS1：CP-SAT sidecar，非 A18 沙箱）。
  const newOut = await solve(family, perturbed);
  const perturbedObjective = objOf(newOut);
  const feasible = newOut.status !== "INFEASIBLE";
  // 冲突约束（IIS 式近似）：不可行时，受扰动的约束族即冲突候选；可行则空。
  const conflictConstraints = feasible ? [] : [...new Set(touched)].sort();
  const deltaObjective =
    baselineObjective != null && perturbedObjective != null ? Math.round((perturbedObjective - baselineObjective) * 1e6) / 1e6 : null;

  // WO-CROSS-OBJECT-MULTIOBJ：多目标 Δ 分解——各目标（营收/违约金/换型…）扰动前后各算 Δ（改权重→各目标 Δ 分别算）。
  const baseVals = objValuesOf(baseOut);
  const newVals = objValuesOf(newOut);
  let deltaByObjective: Record<string, number> | undefined;
  if (baseVals && newVals) {
    deltaByObjective = {};
    for (const k of new Set([...Object.keys(baseVals), ...Object.keys(newVals)])) {
      const b = baseVals[k] ?? 0, n = newVals[k] ?? 0;
      deltaByObjective[k] = Math.round((n - b) * 1e6) / 1e6;
    }
  }

  const explanation = feasible
    ? deltaByObjective
      ? `扰动 ${sorted.length} 条 → 各目标 Δ：${Object.entries(deltaByObjective).map(([k, d]) => `${k} ${d >= 0 ? "+" : ""}${d}`).join("、")}`
      : `扰动 ${sorted.length} 条 → 目标 ${baselineObjective ?? "—"} → ${perturbedObjective ?? "—"}（Δ=${deltaObjective ?? "—"}）`
    : `扰动 ${sorted.length} 条 → 不可行；冲突约束族：${conflictConstraints.join("、") || "—"}`;

  return { baselineObjective, perturbedObjective, deltaObjective, deltaByObjective, feasible, conflictConstraints, explanation };
}
