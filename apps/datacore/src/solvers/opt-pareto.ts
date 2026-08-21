/**
 * WO-SIM-BE-PARETO · `optimize_pareto` —— 推演沙盘的**帕累托解集**。
 *
 * ══ 今天的行为是 X，应该是 Y ══════════════════════════════════════════════════
 *
 * **X（实测原文 `opt-whatif.ts:191-203`）**：`runOptimizeWhatif` 一次调用只回**两个**解 ——
 *   ```
 *   const baselineSolution  = solutionOf(baseOut);   // 基线求解结果
 *   const perturbedSolution = solutionOf(newOut);    // 施加一组扰动后重解的结果
 *   ```
 *   两者是**同一条扰动路径上的前后快照**；标量目标只有一个（`objOf` 取 `out.objective`），
 *   多目标情形也只有 `deltaByObjective` 这份**Δ 分解**。全文件零支配比较、零解集。
 *
 * **Y（本文件）**：一次调用回**一组解** —— 按杠杆网格枚举组合、各自重解，
 *   按**显式声明的多目标方向**做逐对支配剔除，互不支配者进 `frontier[]`、被支配者进 `dominated[]`。
 *
 * ══ 命名撞车（开工第一件事就撞上，记在这里防下一个人重蹈）══════════════════════
 *
 * 本仓已有 `buildPareto`（`frontend-shell/src/views/sim/sandboxConsoleModel.ts:612`）——
 * 那是**帕累托图**：按 `pctOfChainLoss` 降序取 Top-16 的单指标排行，无目标、无方向、无支配关系。
 * 与本文件的**帕累托前沿**同名不同物。实测全仓 `dominat|支配` 仅 1 处命中，
 * 且是 `databuilder-pipeline.seam.test.ts` 里一个讲「pipeline 支配导入口」的用例名 ——
 * 与多目标支配无关。故解集能力**此前确实不存在**，本单是新建而非重复造轮子。
 *
 * ══ 确定性 R6 ═══════════════════════════════════════════════════════════════
 * 无 `Date` / 无 `Math.random` / 无 I/O（求解经注入的 `SolveArgsFn`）。
 * 杠杆按 key 字典序、档位去重升序、笛卡尔积按里程表序枚举、输出按全序排序 ⇒
 * 同 (session, 杠杆集, 参数版本) 重跑 `JSON.stringify` 逐字节一致。
 */
import type { OptPerturbation, OptTemplateFamily, ParetoBinding, ParetoObjective, ParetoRequest, ParetoResult, ParetoSolution } from "@platform/contracts";
import { validationError } from "../errors.js";
import { applyPerturbationSet, type SolveArgsFn } from "./opt-whatif.js";

/**
 * 数值量化分辨率。全链读数一律 `round(x*1e6)/1e6`，与 `opt-whatif.ts` 的 Δ 口径**同一个常数** ——
 * 两处若各用各的精度，同一个解在 what-if 里和在解集里会显示成两个数。
 */
const QUANT = 1e6;
const q = (x: number): number => Math.round(x * QUANT) / QUANT;

/**
 * `tight`（顶到边）的判据 —— **唯一声明处，前端不许猜阈值**。
 *
 * `slack <= PARETO_TIGHT_EPS` 即为 tight。取**绝对** eps 而非相对百分比：
 * 全链数值已按 `QUANT` 量化，`1e-6` 正好是这条链的数值分辨率，
 * 比它更小的裕度不是「差一点」，是量化噪声。用相对阈值反而会让
 * `limit` 很大的约束永远 tight、`limit` 很小的永远不 tight。
 */
export const PARETO_TIGHT_EPS = 1 / QUANT;

/** 笛卡尔积规模上限（保险丝）。超了宁可让调用方收窄网格，也不静默截断——截断会让前沿缺一角而无人知。 */
export const PARETO_MAX_ITERATIONS = 4096;

/**
 * 解的稳定 id 的**唯一构造处**（同 `chain-sim.ts` 的 `solutionCandidateId` 之所以是函数）。
 *
 * 入参全部取自解自身的公开字段（`levers`），故 id 可从解本身重建 ——
 * 这是「单源」能被机器核的前提：若拼法里混进候选外的东西（遍历序号、时间戳），
 * 重建就对不上，门当场红。
 */
export function paretoSolutionId(levers: readonly { key: string; value: number }[]): string {
  return `pareto_${[...levers].sort((a, b) => a.key.localeCompare(b.key)).map((l) => `${l.key}=${q(l.value)}`).join("|")}`;
}

/**
 * 把一个目标读数**归一到"越小越好"**，让支配比较只需写一次。
 * `dir:"max"` 取负 —— 而不是在比较处写两套分支：两套分支意味着 `max` 那半迟早只有一半被测到。
 */
function normalized(metrics: Readonly<Record<string, number>>, o: ParetoObjective): number {
  const v = metrics[o.key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    // 取不到目标读数 ⇒ 调用方或求解器出了问题。**绝不补 0**（0 会被读成"这个目标很好"，
    // 于是这个解会爬到前沿最前面 —— 一个缺数据的解冒充最优解，比报错危险得多）。
    throw validationError(`解缺目标读数 '${o.key}'（不补 0：补 0 会让缺数据的解冒充最优解）`);
  }
  return o.dir === "max" ? -v : v;
}

/**
 * **支配判据**（本文件的心脏）：
 *
 * > `A 支配 B` ⟺ **所有目标上 A 不劣于 B**，**且至少一个目标上 A 严格优于 B**。
 *
 * 归一到最小化后即：`∀o: na(o) <= nb(o)` 且 `∃o: na(o) < nb(o)`。
 *
 * ⚠️ 下面那个 `<=` 是本单变异反证的注入点。把它改成 `<`，判据就从
 * **弱支配**（允许在某个目标上打平）退化成**强支配**（必须每个目标都严格更好）——
 * 于是「成本打平、天数更差」这类解**不再被判为被支配**，会混进 `frontier[]`。
 * 而它看起来完全正常：前沿仍是一条曲线，只是上面多了几个本该被剔掉的点。
 * 这正是我画那页仿真图时踩的坑（把一个被支配解标成了前沿，两个目标一比当场露馅）。
 */
export function dominates(
  a: Pick<ParetoSolution, "metrics">,
  b: Pick<ParetoSolution, "metrics">,
  objectives: readonly ParetoObjective[],
): boolean {
  const noWorse = objectives.every((o) => normalized(a.metrics, o) <= normalized(b.metrics, o));
  const someBetter = objectives.some((o) => normalized(a.metrics, o) < normalized(b.metrics, o));
  return noWorse && someBetter;
}

/**
 * 逐对支配剔除 —— 把可行解切成「前沿」与「被支配」两堆。
 *
 * **只有可行解参与竞争**：不可行解（求解 INFEASIBLE / 绑定约束越界）既不进 `frontier`
 * 也不进 `dominated`，而是计入 `residual`。理由是数学定义 ——
 * 帕累托前沿是**可行集**上的非支配集；把不可行解放进 `dominated[]` 会让
 * 「`dominated[]` 里每一个都被 `frontier[]` 中至少一个支配」这条不变量当场破掉
 * （一个不可行解可能在所有目标上都很漂亮，只是它违反了约束）。
 *
 * 两个数组由**同一个判据的正反两面**产生 ⇒ `frontier ∩ dominated == ∅` 是结构上成立的，
 * 不靠两处代码碰巧一致。
 */
export function partitionPareto(
  solutions: readonly ParetoSolution[],
  objectives: readonly ParetoObjective[],
): { frontier: ParetoSolution[]; dominated: ParetoSolution[] } {
  const feasible = solutions.filter((s) => s.feasible);
  const isDominated = (s: ParetoSolution): boolean => feasible.some((o) => o.id !== s.id && dominates(o, s, objectives));
  return {
    frontier: feasible.filter((s) => !isDominated(s)),
    dominated: feasible.filter((s) => isDominated(s)),
  };
}

/**
 * 解的全序（R6）：逐目标归一值升序 → `id` 字典序兜底。
 * 不依赖 `Array#sort` 的稳定性（`wo-capacity-100pct` R7–R9 轮修的正是"排序契约靠巧合"）。
 */
function compareSolutions(objectives: readonly ParetoObjective[]) {
  return (a: ParetoSolution, b: ParetoSolution): number => {
    for (const o of objectives) {
      const d = normalized(a.metrics, o) - normalized(b.metrics, o);
      if (d !== 0) return d;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

/** 杠杆网格 → 笛卡尔积（里程表序：最后一根杠杆变化最快）。确定性来自调用方已排好的序。 */
function cartesian(grid: readonly { key: string; values: number[] }[]): { key: string; value: number }[][] {
  let acc: { key: string; value: number }[][] = [[]];
  for (const g of grid) {
    const next: { key: string; value: number }[][] = [];
    for (const combo of acc) for (const v of g.values) next.push([...combo, { key: g.key, value: v }]);
    acc = next;
  }
  return acc;
}

/** 从求解输出里取一个解的目标读数：多目标 `objectiveValues` 优先，标量 `objective` 兜底。 */
function metricsOf(out: Record<string, unknown>): Record<string, number> {
  const m: Record<string, number> = {};
  const ov = out.objectiveValues;
  if (ov != null && typeof ov === "object") {
    for (const [k, v] of Object.entries(ov as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v)) m[k] = q(v);
  }
  if (typeof out.objective === "number" && Number.isFinite(out.objective)) m.objective = q(out.objective);
  // 键序稳定（R6）：`JSON.stringify` 的字节取决于插入序，故重建一个字典序对象。
  const sorted: Record<string, number> = {};
  for (const k of Object.keys(m).sort()) sorted[k] = m[k]!;
  return sorted;
}

/**
 * 执行帕累托解集求解：杠杆网格 → 逐组合施加扰动（克隆·不落真值 R4）→ sidecar 重解 →
 * 绑定裕度 → 可行性过滤 → 逐对支配剔除 → `{frontier, dominated, iterations, residual}`。
 */
export async function runOptimizePareto(solve: SolveArgsFn, req: ParetoRequest): Promise<ParetoResult> {
  const objectives = req.objectives;
  if (objectives.length < 2) throw validationError("optimize_pareto 需至少两个目标（单目标下『前沿』退化成『最优解』，那是 optimize_whatif 的活）");
  const dupObj = objectives.map((o) => o.key).find((k, i, arr) => arr.indexOf(k) !== i);
  if (dupObj !== undefined) throw validationError(`目标键重复：'${dupObj}'（同一目标声明两次，方向可能互相矛盾）`);

  // 杠杆网格规范化（R6）：按 key 字典序；档位去重 + 升序 ⇒ 请求里的书写顺序不影响结果。
  const grid = [...req.levers]
    .map((l) => ({ key: l.key, label: l.label, values: [...new Set(l.values.map(q))].sort((a, b) => a - b) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const dupLever = grid.map((g) => g.key).find((k, i, arr) => arr.indexOf(k) !== i);
  if (dupLever !== undefined) throw validationError(`杠杆 target 重复：'${dupLever}'（同一根杠杆给了两套档位，笛卡尔积会自相矛盾）`);

  const combos = cartesian(grid);
  if (combos.length > PARETO_MAX_ITERATIONS) {
    throw validationError(
      `杠杆网格笛卡尔积 ${combos.length} 超上限 ${PARETO_MAX_ITERATIONS}（请收窄档位）——` +
        `此处宁可拒绝也不静默截断：截断会让前沿缺一角，而屏上看起来仍是一条完整曲线。`,
    );
  }

  const baselineArgs = req.args ?? {};
  const family = req.family as OptTemplateFamily;
  const constraints = req.constraints ?? [];
  const labelOf = new Map(grid.map((g) => [g.key, g.label ?? g.key]));

  const evaluated: ParetoSolution[] = [];
  for (const combo of combos) {
    // 杠杆档位 → 结构化扰动（复用 what-if 的 DF.8 接地 + 施加实现，不另写一份）。
    const perturbations: OptPerturbation[] = combo.map((l) => ({ kind: "data_override", target: l.key, value: l.value }));
    const { args } = applyPerturbationSet(baselineArgs, perturbations);
    const out = await solve(family, args);

    const solverFeasible = out.status !== "INFEASIBLE";
    const metrics = metricsOf(out);
    // 目标读数齐不齐 —— 缺一个就判不可行（**不补 0**，理由见 `normalized`）。
    const missing = objectives.filter((o) => typeof metrics[o.key] !== "number").map((o) => o.key);

    const bindings: ParetoBinding[] = constraints
      .map((c) => {
        const value = metrics[c.key];
        // 约束读数取不到 ⇒ 记 slack 为负、tight 为真：宁可判它越界，也不让一个"没量到"的解
        // 冒充"没越界"（沿用本仓「算不出不许填 0」的口径）。
        if (typeof value !== "number") return { key: c.key, value: Number.NaN, limit: c.limit, slack: Number.NaN, tight: true };
        const slack = q(c.limit - value);
        return { key: c.key, value, limit: c.limit, slack, tight: slack <= PARETO_TIGHT_EPS };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
    const withinLimits = bindings.every((b) => Number.isFinite(b.slack) && b.slack >= 0);

    const levers = [...combo].sort((a, b) => a.key.localeCompare(b.key));
    evaluated.push({
      id: paretoSolutionId(levers),
      label: levers.map((l) => `${labelOf.get(l.key) ?? l.key}=${l.value}`).join(" · "),
      levers,
      metrics,
      bindings,
      feasible: solverFeasible && missing.length === 0 && withinLimits,
    });
  }

  const { frontier, dominated } = partitionPareto(evaluated, objectives);
  const cmp = compareSolutions(objectives);
  frontier.sort(cmp);
  dominated.sort(cmp);

  return {
    objectives,
    frontier,
    dominated,
    iterations: evaluated.length,
    // 守恒残差：被可行性挡在竞争之外的候选数。恒等式 iterations = frontier + dominated + residual
    // 让「解去哪了」可被机器核 —— 不平就是有解被静默吞掉了。
    residual: evaluated.length - frontier.length - dominated.length,
  };
}
