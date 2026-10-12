/**
 * WO-MULTIOBJ-CONVERGE · 求解回包 → **目标读数**的唯一实现（跨包共用一份）。
 *
 * ══ 今天的行为是 X，应该是 Y ══════════════════════════════════════════════════
 *
 * **X（实测原文，本机 4711 内存态 demo 租户，SEED_DEMO=1）**：同一个租户、同一批订单，
 *   平台上有两个多目标界面，各自**从零算了一遍自己的轴**：
 *   · `/v/sim-optimize`（方案寻优）→ `opt-assemble.ts` 装配 → `opt-pareto.ts` 的 `metricsOf`
 *     读 `objectiveValues` + 结构读数 + 派生（`serviceRate` / `margin`）。
 *     粒度 `OrderLine`（873 行），营收 = `OrderLine.unitPrice × qty` = 480.62 亿池，
 *     最优解读数 **244.59 亿 / 获排率 21.6%**。
 *   · `/v/global-sim` 的「多目标联合 WHAT-IF」→ 前端 `multiObjScenario.ts` 自己派生三口径，
 *     粒度 `Order`（**且只取 `searchObjects` 的第一页 50/500 单**），营收 = `Order.unitPrice × qty`，
 *     读数 **39.49 亿**。两个数差 **6.19 倍**，屏上没有任何一处说得清为什么。
 *
 * **Y（本文件）**：目标读数**只有一处实现**。求解回包（`cross_object_occupancy` 或同族）
 *   进来，六轴读数出去；`opt-pareto.ts` 与前端多目标面板 **import 同一段代码**，
 *   于是「同一根轴在两个界面上是不是同一个数」变成**结构上成立**，不靠两处碰巧一致。
 *
 * ⚠ 这与 `rankParetoByWeights` 住进本包是同一条理由，原文见 `sim.ts` 那一段：
 *   「解法不是"小心地抄一遍"，是**只写一份、两边都 import 它**」。
 *
 * ══ 确定性 R6 ═══════════════════════════════════════════════════════════════
 * 纯函数：无 `Date` / 无 `Math.random` / 无 I/O。键序按字典序重建 ⇒
 * `JSON.stringify` 逐字节稳定。
 */
import type { ParetoObjective } from "./sim.js";

/**
 * 数值量化分辨率。全链读数一律 `round(x*1e6)/1e6`，与 `opt-whatif.ts` 的 Δ 口径**同一个常数** ——
 * 两处若各用各的精度，同一个解在 what-if 里和在解集里会显示成两个数。
 */
export const PARETO_METRIC_QUANT = 1e6;
export const quantizeParetoMetric = (x: number): number => Math.round(x * PARETO_METRIC_QUANT) / PARETO_METRIC_QUANT;

/**
 * 求解回包里**可当目标用的结构读数**（`objectiveValues` 之外的那一档）。
 *
 * `cross_object_occupancy` 的回包里，「多少单获排」这件事**一直是真算出来的**
 * （`servedCount` / `orderCount`，与 `occupancy[]`/`displaced[]` 同源），
 * 但从前只读 `objectiveValues` ⇒ 这个数**从来没进过 metrics** ⇒ 它既不能当轴、也不上方案卡。
 * 这不是"没有交付这一维"，是**接了线没投影**（三分法第二态，修法是补投影不是造字段）。
 *
 * ⚠ **白名单而不是"把所有数值字段都收进来"**：回包里同样是数字的还有
 * `lineCount` / `contractCount` 这类**与解无关的常量**（整个网格里恒定），
 * 把它们收成 metrics 会让屏上多出几根**恒定的轴** —— 恒定轴在支配比较里永远打平，
 * 于是它看起来像一个维度，实际一个解都区分不了。宁可漏也不许多。
 */
export const PARETO_STRUCTURAL_METRIC_KEYS = ["servedCount", "orderCount"] as const;

/**
 * 从结构读数**派生**的目标。派生式写在这一处，前端不再算第二遍（两处一漂就是屏上看不出的错）。
 *
 * ⛔ **缺一个输入就整格不给，绝不补 0**：一个"没量到"的解补出 0 会在支配比较里冒充极值。
 * 且分母为 0 时同样不给（0 单的租户不存在"获排率"这件事，给 0 或 1 都是编）。
 */
export const PARETO_DERIVED_METRICS: readonly {
  key: string;
  from: readonly string[];
  of: (m: Record<string, number>) => number | undefined;
  /**
   * **只在调用方显式声明该键为目标时才算**。
   *
   * `serviceRate` 是无量纲比值，**任何**回包上算出来都成立，故不设门。
   * 而 `margin` 是两格**钱**的差 —— 它成立的前提（两侧同货币单位）**本层看不见**。
   * 无条件算 ⇒ 任何一个 revenue/cost 量纲没对齐的调用方都会静默拿到一个错得离谱的毛利
   * （本仓实测过 元 vs 万元 差 10⁴ 倍那一例）。
   */
  gated?: boolean;
}[] = [
  {
    // 获排率 = 获排单数 / 总单数 ∈ [0,1]。**这一族没有时间维**（订单×产线×合同的指派问题），
    // 故它是「这批需求接下了多少」，**不是「准时率」** —— 两者在屏上必须叫不同的名字。
    key: "serviceRate",
    from: ["servedCount", "orderCount"],
    of: (m) => (m.orderCount! > 0 ? m.servedCount! / m.orderCount! : undefined),
  },
  {
    // 毛利 = 营收 − 成本，**逐解现算**（revenue/cost 随杠杆变 ⇒ 这一格随解变）。
    key: "margin",
    from: ["revenue", "cost"],
    of: (m) => m.revenue! - m.cost!,
    gated: true,
  },
];

/**
 * 求解输出 → 一个解的目标读数：多目标 `objectiveValues` 优先，标量 `objective` 兜底，
 * 再补结构读数白名单，最后跑派生表。
 *
 * @param out          求解器回包（`objectiveValues` / `objective` / `servedCount` / `orderCount` …）
 * @param declaredKeys 调用方在 `objectives[]` 里声明的键集 —— 带 `gated` 的派生读数只对它们放行。
 */
export function deriveParetoMetrics(
  out: Readonly<Record<string, unknown>>,
  declaredKeys: ReadonlySet<string>,
): Record<string, number> {
  const m: Record<string, number> = {};
  const ov = out.objectiveValues;
  if (ov != null && typeof ov === "object") {
    for (const [k, v] of Object.entries(ov as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) m[k] = quantizeParetoMetric(v);
    }
  }
  if (typeof out.objective === "number" && Number.isFinite(out.objective)) m.objective = quantizeParetoMetric(out.objective);
  // 结构读数（白名单）。`objectiveValues` 里的同名键优先 —— 引擎显式声明成目标的那一份最准。
  for (const k of PARETO_STRUCTURAL_METRIC_KEYS) {
    const v = out[k];
    if (m[k] === undefined && typeof v === "number" && Number.isFinite(v)) m[k] = quantizeParetoMetric(v);
  }
  for (const d of PARETO_DERIVED_METRICS) {
    if (m[d.key] !== undefined) continue; // 引擎自己给了同名读数 ⇒ 用它的，不覆盖
    if (d.gated === true && !declaredKeys.has(d.key)) continue; // 没声明 ⇒ 这一格根本不存在
    if (!d.from.every((k) => typeof m[k] === "number")) continue; // 缺输入 ⇒ 整格不给
    const v = d.of(m);
    if (typeof v === "number" && Number.isFinite(v)) m[d.key] = quantizeParetoMetric(v);
  }
  // 键序稳定（R6）：`JSON.stringify` 的字节取决于插入序，故重建一个字典序对象。
  const sorted: Record<string, number> = {};
  for (const k of Object.keys(m).sort()) sorted[k] = m[k]!;
  return sorted;
}

/** `objectives[]` → 声明键集（`deriveParetoMetrics` 的第二个实参的**唯一构造处**）。 */
export function declaredObjectiveKeys(objectives: readonly ParetoObjective[]): ReadonlySet<string> {
  return new Set(objectives.map((o) => o.key));
}
