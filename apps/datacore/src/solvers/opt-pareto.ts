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
import type { OptPerturbation, OptTemplateFamily, ParetoBinding, ParetoObjective, ParetoRankingEntry, ParetoRequest, ParetoResult, ParetoSolution } from "@platform/contracts";
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

/**
 * 求解回包里**可当目标用的结构读数**（`objectiveValues` 之外的那一档）。
 *
 * ── 为什么要有这张表（WO-PARETO-AXES 开工实测）─────────────────────────────────
 * `cross_object_occupancy` 的回包里，「多少单获排」这件事**一直是真算出来的**
 * （`servedCount` / `orderCount`，与 `occupancy[]`/`displaced[]` 同源），
 * 但 `metricsOf` 从前只读 `objectiveValues` ⇒ 这个数**从来没进过 `metrics`** ⇒
 * 它既不能当轴、也不会出现在方案卡上。这不是"没有交付这一维"，是**接了线没投影**
 * （本仓三分法里的第二态，修法是补投影不是造字段）。
 *
 * ⚠ **白名单而不是"把所有数值字段都收进来"**：回包里同样是数字的还有
 * `lineCount` / `contractCount` 这类**与解无关的常量**（整个网格里恒定），
 * 把它们收成 metrics 会让屏上多出几根**恒定的轴** —— 恒定轴在支配比较里永远打平，
 * 于是它看起来像一个维度，实际一个解都区分不了。宁可漏也不许多。
 */
const STRUCTURAL_METRIC_KEYS = ["servedCount", "orderCount"] as const;

/**
 * 从结构读数**派生**的目标。派生式写在这一处，前端不再算第二遍（两处一漂就是屏上看不出的错）。
 *
 * ⛔ **缺一个输入就整格不给，绝不补 0**：与 `normalized()` 同一条理由 ——
 * 一个"没量到"的解补出 0 会在支配比较里冒充极值。
 * 且分母为 0 时同样不给（0 单的租户不存在"获排率"这件事，给 0 或 1 都是编）。
 */
const DERIVED_METRICS: readonly { key: string; from: readonly string[]; of: (m: Record<string, number>) => number | undefined }[] = [
  {
    // 获排率 = 获排单数 / 总单数 ∈ [0,1]。**这一族没有时间维**（订单×产线×合同的指派问题），
    // 故它是「这批需求接下了多少」，**不是「准时率」** —— 两者在屏上必须叫不同的名字，
    // 叫成准时率就是把一个本系统今天答不了的问题假装答了。
    key: "serviceRate",
    from: ["servedCount", "orderCount"],
    of: (m) => (m.orderCount! > 0 ? m.servedCount! / m.orderCount! : undefined),
  },
];

/** 从求解输出里取一个解的目标读数：多目标 `objectiveValues` 优先，标量 `objective` 兜底。 */
function metricsOf(out: Record<string, unknown>): Record<string, number> {
  const m: Record<string, number> = {};
  const ov = out.objectiveValues;
  if (ov != null && typeof ov === "object") {
    for (const [k, v] of Object.entries(ov as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v)) m[k] = q(v);
  }
  if (typeof out.objective === "number" && Number.isFinite(out.objective)) m.objective = q(out.objective);
  // 结构读数（白名单，理由见 `STRUCTURAL_METRIC_KEYS`）。`objectiveValues` 里的同名键优先 ——
  // 引擎显式声明成目标的那一份最准，结构档只是它没声明时的来源。
  for (const k of STRUCTURAL_METRIC_KEYS) {
    const v = out[k];
    if (m[k] === undefined && typeof v === "number" && Number.isFinite(v)) m[k] = q(v);
  }
  for (const d of DERIVED_METRICS) {
    if (m[d.key] !== undefined) continue; // 引擎自己给了同名读数 ⇒ 用它的，不覆盖
    if (!d.from.every((k) => typeof m[k] === "number")) continue; // 缺输入 ⇒ 整格不给
    const v = d.of(m);
    if (typeof v === "number" && Number.isFinite(v)) m[d.key] = q(v);
  }
  // 键序稳定（R6）：`JSON.stringify` 的字节取决于插入序，故重建一个字典序对象。
  const sorted: Record<string, number> = {};
  for (const k of Object.keys(m).sort()) sorted[k] = m[k]!;
  return sorted;
}

/**
 * 权重归一：负值/非有限值一律剔除；全零或全空 ⇒ **各目标等权 1**。
 *
 * 「全零 ⇒ 等权」而不是「全零 ⇒ 分母 0 ⇒ NaN」：用户把所有滑杆拉到底是一个**可达的屏上状态**，
 * 它该被读成"我没有偏好"，不该让整页读数变成 NaN。
 * 不在 `objectives` 里的键**静默忽略**（契约原话：屏上留着一个已换掉的轴的滑杆不该让求解 400）。
 */
export function normalizeWeights(
  objectives: readonly ParetoObjective[],
  weights: Readonly<Record<string, number>> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  let sum = 0;
  for (const o of objectives) {
    const w = weights?.[o.key];
    const v = typeof w === "number" && Number.isFinite(w) && w >= 0 ? q(w) : 1;
    out[o.key] = v;
    sum += v;
  }
  if (sum <= 0) for (const o of objectives) out[o.key] = 1;
  // 键序稳定（R6）：与 `metricsOf` 同一条理由。
  const sorted: Record<string, number> = {};
  for (const k of Object.keys(out).sort()) sorted[k] = out[k]!;
  return sorted;
}

/**
 * **本单的心脏（其二）**：按权重给前沿排名次 —— 而**前沿是谁，这里一个字都不改**。
 *
 * ══ 为什么归一的极值取自「全体可行候选」而不是「前沿」════════════════════════
 * 这不是审美，是那条验收判据的算术保证。设归一
 *   nₖ(s) = (读数折成「1 = 最好 · 0 = 最差」)，极值取自 `pool`。
 * `pool` 与 `weights` **无关** ⇒ nₖ(s) 与 weights 无关 ⇒ 换权重时每个解的 nₖ 都不动，
 * 变的只有 Σwₖnₖ/Σwₖ 这个加权平均 ⇒ **只可能换名次，不可能换成员**。
 * 若改成「极值取自前沿」，结论依旧（前沿也与权重无关），但少了一层：
 * 被支配解与前沿解会落在两把不同的尺上，屏上同一根轴出现两种刻度。
 *
 * ⚠ 退化域（某目标全体读数相同）⇒ 该目标对所有解贡献同一个 0.5，
 *    **不是 0 也不是 1**：全体并列时说"大家都最好"或"大家都最差"都是断言，
 *    而这一维真实的信息量是零。给 0.5 让它在加权平均里**不改变任何相对次序**。
 *
 * ⛔ 本函数**不参与**可行性判定、不参与支配比较、不被 `partitionPareto` 调用 ——
 *    它在前沿切好**之后**才跑。这是"权重不改前沿"在代码结构上的保证，不靠注释。
 */
export function rankByWeights(
  frontier: readonly ParetoSolution[],
  objectives: readonly ParetoObjective[],
  weights: Readonly<Record<string, number>>,
  pool: readonly ParetoSolution[],
): ParetoRankingEntry[] {
  const span = new Map<string, { lo: number; hi: number }>();
  for (const o of objectives) {
    const vs = pool.map((s) => s.metrics[o.key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (vs.length > 0) span.set(o.key, { lo: Math.min(...vs), hi: Math.max(...vs) });
  }
  const total = objectives.reduce((s, o) => s + (weights[o.key] ?? 0), 0);
  const scoreOf = (s: ParetoSolution): number => {
    if (total <= 0) return 0;
    let acc = 0;
    for (const o of objectives) {
      const w = weights[o.key] ?? 0;
      if (w === 0) continue;
      const sp = span.get(o.key);
      const v = s.metrics[o.key];
      // 读数缺失 ⇒ 这一维按"零信息"计（0.5），与退化域同一口径。**不补 0**：
      // 补 0 在 `dir:"min"` 下是"最好"、在 `dir:"max"` 下是"最差"，同一个补法两种含义。
      let n = 0.5;
      if (sp !== undefined && typeof v === "number" && Number.isFinite(v)) {
        const d = sp.hi - sp.lo;
        n = d === 0 ? 0.5 : o.dir === "max" ? (v - sp.lo) / d : (sp.hi - v) / d;
      }
      acc += w * n;
    }
    return q(acc / total);
  };
  return [...frontier]
    .map((s) => ({ id: s.id, score: scoreOf(s) }))
    // 全序（R6）：得分降序 → id 字典序兜底。不依赖 `Array#sort` 的稳定性。
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e, i) => ({ id: e.id, rank: i + 1, score: e.score }));
}

/**
 * 执行帕累托解集求解：杠杆网格 → 逐组合施加扰动（克隆·不落真值 R4）→ sidecar 重解 →
 * 绑定裕度 → 可行性过滤 → 逐对支配剔除 → `{frontier, dominated, iterations, residual}`，
 * 最后按**读者偏好**（`weights`）给前沿排一个名次（`ranking` / `recommendedId`）。
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

  // ── 权重：**在前沿切好之后**才登场（见 `rankByWeights` 的 ⛔ 段）───────────────
  // `frontier`/`dominated` 此刻已经定了，下面三行读它们、不改它们。
  // 归一池 = 全体参与竞争的可行解（前沿 + 被支配），与权重无关 ⇒ 换权重只换名次。
  const weights = normalizeWeights(objectives, req.weights);
  const ranking = rankByWeights(frontier, objectives, weights, [...frontier, ...dominated]);

  return {
    objectives,
    frontier,
    dominated,
    iterations: evaluated.length,
    // 守恒残差：被可行性挡在竞争之外的候选数。恒等式 iterations = frontier + dominated + residual
    // 让「解去哪了」可被机器核 —— 不平就是有解被静默吞掉了。
    residual: evaluated.length - frontier.length - dominated.length,
    weights,
    ranking,
    // 前沿为空 ⇒ `null`。**不兜一个 id 出来** —— 兜出来的那个解要么不存在、
    // 要么是被支配解，屏上会把它印成"推荐方案"。
    recommendedId: ranking[0]?.id ?? null,
    // 装配侧填、求解侧只回显（求解器不认识"本租户本体缺哪个字段"）。
    unavailableObjectives: req.unavailableObjectives ?? [],
  };
}
