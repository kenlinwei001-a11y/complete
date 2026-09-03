import { describe, expect, it } from "vitest";
import type { ParetoObjective, ParetoRequest, ParetoResult } from "@platform/contracts";
import { ParetoResultSchema, normalizeParetoWeights, rankParetoByWeights } from "@platform/contracts";
import { runOptimizePareto } from "../src/solvers/opt-pareto.js";
import type { SolveArgsFn } from "../src/solvers/opt-whatif.js";

/**
 * WO-PARETO-AXES · **「目标权重只换名次、不换解集」接缝门** + 交付轴投影门。
 *
 * ══ 这道门守的是哪一句话 ═══════════════════════════════════════════════════════
 *
 * 仓主原话：「**在界面上用来设定不同目标的权重，系统输出多个方案和方案比对，
 * 而不是输出一个方案**」。这句话有一个**可被机器咬住**的判据，也只有这一个：
 *
 * > **同一组输入，换两组差别很大的权重 ⇒ 非支配解集合逐条相同，只有排序/推荐变。**
 *
 * 它把两件在屏上长得**一模一样**的东西分开：
 *  · **真多目标** —— 算一次给出所有非支配解，权重只决定读者先看哪个；
 *  · **标量化**   —— 每次拿一组权重把多目标压成单目标再求一次最优，一次只给一个答案，
 *                  连续拖几次滑杆看起来也像"一串方案"。
 *
 * ⚠ 这不是假想的风险，本族引擎**真的吃权重**：`inproc-optimizer.ts` 的
 *   `solveCrossObjectOccupancy` 读 `args.objectives[].weight`，按 `wRev·revenue + wPen·penalty`
 *   排装入序、按 `wCost·cost` 选线 ⇒ **权重一旦流进 `args`，换权重就会换出一批不同的解**。
 *   故本门的用例 ③ 不只断"前沿没变"，还直接断**每一次 `solve()` 收到的 args 里没有权重**——
 *   前者是结果、后者是原因，只断结果的话，哪天有人从别的路径把权重塞进去而恰好前沿没变，
 *   这道门会放行一个已经坏掉的机制。
 *
 * ══ 固定装置（读数手算过，两目标真权衡）═══════════════════════════════════════
 *   days = 30 − 0.5·OT − 2·OS   （OT ∈ {0,8,16}，OS ∈ {0,2,4}）
 *   cost = 3·OS
 * ⇒ 前沿 3 点：(days,cost) = (22,0) · (18,6) · (14,12)。
 *   两目标皆 min 且**方向相反**（要天数短就得多花钱）⇒ 权重一偏，名次必翻。
 *   这正是"能验出排序变"的前提：若两根轴同向（本仓 demo 租户实测 Spearman = 1.0
 *   —— revenue/cost/serviceRate 三根全同序），换权重是**换不动名次**的，
 *   那样的装置只能验"前沿没变"这一半，验不了"排序变了"那一半。
 */

const DAYS = "chainNonValueDays";
const COST = "outsourceCostWan";
const OBJECTIVES: ParetoObjective[] = [
  { key: DAYS, dir: "min", label: "全链非增值天数", unit: "天" },
  { key: COST, dir: "min", label: "外协成本", unit: "万元" },
];
const OT_TARGET = "facilities.OT.openCost";
const OS_TARGET = "facilities.OS.openCost";
const BASE_ARGS = {
  facilities: [{ id: "OT", openCost: 0 }, { id: "OS", openCost: 0 }],
  clients: [{ id: "C1" }],
  assignCosts: [{ client: "C1", facility: "OT", cost: 1 }],
};

/** 每次 `solve()` 收到的 args 都留一份底 —— 用例 ③ 靠它证「权重没流进求解」。 */
function recordingSolve(): { solve: SolveArgsFn; seen: Record<string, unknown>[] } {
  const seen: Record<string, unknown>[] = [];
  const solve: SolveArgsFn = async (_fam, a) => {
    seen.push(a);
    const facs = a.facilities as { id: string; openCost: number }[];
    const ot = facs.find((f) => f.id === "OT")!.openCost;
    const os = facs.find((f) => f.id === "OS")!.openCost;
    return {
      status: "OPTIMAL",
      optimal: true,
      objectiveValues: { [DAYS]: 30 - 0.5 * ot - 2 * os, [COST]: 3 * os },
    };
  };
  return { solve, seen };
}

const reqWith = (weights?: Record<string, number>): ParetoRequest => ({
  sessionId: "sess-axes-1",
  family: "facility_location",
  args: BASE_ARGS,
  objectives: OBJECTIVES,
  levers: [
    { key: OT_TARGET, label: "加班", values: [0, 8, 16] },
    { key: OS_TARGET, label: "外协", values: [0, 2, 4] },
  ],
  ...(weights ? { weights } : {}),
});

const ids = (r: ParetoResult): string[] => r.frontier.map((s) => s.id).sort();
const order = (r: ParetoResult): string[] => r.ranking.map((e) => e.id);

describe("WO-PARETO-AXES · 权重只换名次不换解集", () => {
  it("① 金丝雀：装置本身立得住（9 候选 / 3 前沿 / 账是平的）—— 不中就是装置坏了，不是结论", async () => {
    const { solve } = recordingSolve();
    const res = await runOptimizePareto(solve, reqWith());
    // 报任何"没变化 / 没命中"的否定结论之前，先证明这个装置**真的在算东西**。
    expect(res.iterations).toBe(9);
    expect(res.frontier.length).toBe(3);
    expect(res.dominated.length).toBe(6);
    // 守恒恒等式（解不许被静默吞掉）。
    expect(res.frontier.length + res.dominated.length + res.residual).toBe(res.iterations);
    // 回包过契约（新增的四格都在，且形状对）。
    expect(() => ParetoResultSchema.parse(res)).not.toThrow();
    expect(res.ranking.length).toBe(res.frontier.length);
  });

  it("② 【本单头号判据】换两组差别很大的权重：前沿逐条相同，排序与推荐都变", async () => {
    const heavyDays = await runOptimizePareto(recordingSolve().solve, reqWith({ [DAYS]: 10, [COST]: 0.1 }));
    const heavyCost = await runOptimizePareto(recordingSolve().solve, reqWith({ [DAYS]: 0.1, [COST]: 10 }));

    // ── 前沿：**逐条相同**。这一条不成立 ⇒ 实现已经退化成标量化，必须重做。
    expect(ids(heavyDays)).toEqual(ids(heavyCost));
    expect(heavyDays.frontier.length).toBe(3);
    // 被支配集同样不许动（它和前沿是同一个判据的正反两面）。
    expect(heavyDays.dominated.map((s) => s.id).sort()).toEqual(heavyCost.dominated.map((s) => s.id).sort());
    // 连每个解的读数都必须逐字相同 —— "成员相同但数变了"同样是重算过的证据。
    expect(heavyDays.frontier.map((s) => s.metrics)).toEqual(heavyCost.frontier.map((s) => s.metrics));

    // ── 排序：**必须变**。若两次名次相同，要么权重没接上，要么两根轴同序（装置选错了）。
    expect(order(heavyDays)).not.toEqual(order(heavyCost));
    expect(heavyDays.recommendedId).not.toBe(heavyCost.recommendedId);

    // ── 而且变得**符合业务直觉**（不是随便换了个序就算数）：
    //    重天数 ⇒ 推荐天数最短那个解；重成本 ⇒ 推荐成本最低那个解。
    const metricOf = (r: ParetoResult, id: string | null, k: string): number =>
      r.frontier.find((s) => s.id === id)!.metrics[k]!;
    expect(metricOf(heavyDays, heavyDays.recommendedId, DAYS)).toBe(14); // 天数最短
    expect(metricOf(heavyCost, heavyCost.recommendedId, COST)).toBe(0); // 成本最低
    // 两次推荐恰好是前沿的两端 ⇒ 名次是**整条翻过来**的，不是抖动。
    expect(order(heavyDays)).toEqual([...order(heavyCost)].reverse());
  });

  it("③ 【原因侧】权重**一次都没有**流进 `solve()` 的 args —— 引擎吃权重，接错就是标量化", async () => {
    const { solve, seen } = recordingSolve();
    await runOptimizePareto(solve, reqWith({ [DAYS]: 10, [COST]: 0.1 }));
    expect(seen.length).toBe(9); // 金丝雀：确实录到了 9 次求解，不是 0 次而空过
    for (const a of seen) {
      // 顶层不许出现 `weights`。
      expect(Object.keys(a)).not.toContain("weights");
      // 也不许有人把它塞进引擎真正读的那一格（`args.objectives[].weight`）。
      expect(a.objectives).toBeUndefined();
      // 序列化一遍兜底：任何嵌套层级里都不该出现这个键。
      expect(JSON.stringify(a)).not.toContain("weight");
    }
  });

  it("④ 权重缺省 / 全零 / 负数 / 陌生键：都不许把结果算成 NaN，也不许改前沿", async () => {
    const base = await runOptimizePareto(recordingSolve().solve, reqWith());
    const allZero = await runOptimizePareto(recordingSolve().solve, reqWith({ [DAYS]: 0, [COST]: 0 }));
    const negative = await runOptimizePareto(recordingSolve().solve, reqWith({ [DAYS]: -5, [COST]: 1 }));
    // 屏上留着一根**已经换掉的轴**的滑杆，不该让整次求解 400。
    const stranger = await runOptimizePareto(recordingSolve().solve, reqWith({ 已经不存在的轴: 7 }));

    for (const r of [base, allZero, negative, stranger]) {
      expect(ids(r)).toEqual(ids(base));
      for (const e of r.ranking) expect(Number.isFinite(e.score)).toBe(true);
    }
    // 全零 ⇒ 回落成各目标等权 1（读成"我没有偏好"，不是"分母 0"）。
    expect(allZero.weights).toEqual({ [COST]: 1, [DAYS]: 1 });
    expect(allZero.weights).toEqual(base.weights);
    // 负数那一格回落成 1；另一格照用。
    expect(negative.weights).toEqual({ [COST]: 1, [DAYS]: 1 });
  });

  it("⑤ 确定性 R6：同输入连跑两次，`JSON.stringify` 逐字节相同（含 weights/ranking 三格）", async () => {
    const w = { [DAYS]: 3.5, [COST]: 1.25 };
    const a = await runOptimizePareto(recordingSolve().solve, reqWith(w));
    const b = await runOptimizePareto(recordingSolve().solve, reqWith(w));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // 键序稳定：`weights` 是字典序重建过的，不随请求里的书写顺序变。
    const flipped = await runOptimizePareto(recordingSolve().solve, reqWith({ [COST]: 1.25, [DAYS]: 3.5 }));
    expect(JSON.stringify(flipped)).toBe(JSON.stringify(a));
  });

  it("⑥ 【跨包同源】前端就地重排与服务端回包**出自同一段代码**，逐条相同", async () => {
    // 屏上拖滑杆走的是 `rerankByWeights` → 契约包的 `rankParetoByWeights`；
    // 服务端回包走的是 `runOptimizePareto` → **同一个函数**。
    // 这一条咬的就是"两边不是各写一份" —— 各写一份时它们会在某组权重上分岔，而屏上看不出来。
    const w = { [DAYS]: 9, [COST]: 0.5 };
    const res = await runOptimizePareto(recordingSolve().solve, reqWith(w));
    const local = rankParetoByWeights(
      res.frontier,
      res.objectives,
      normalizeParetoWeights(res.objectives, w),
      [...res.frontier, ...res.dominated],
    );
    expect(local).toEqual(res.ranking);
    expect(local[0]?.id).toBe(res.recommendedId);
  });
});

/**
 * ── 交付轴：**这一维一直被真算着，只是从没投影成 `metrics`** ─────────────────────
 *
 * 开工实测（本机 4531 内存态 demo 租户）：`cross_object_occupancy` 的回包里
 * `servedCount=336 / orderCount=873` 一直都在，而 `metricsOf` 从前只读 `objectiveValues`
 * ⇒ 这个数进不了 `metrics` ⇒ 既不能当轴、也不上方案卡。
 * 这是本仓三分法里的**第二态（接了线没投影）**，修法是补投影，不是造字段。
 */
describe("WO-PARETO-AXES · 交付轴（获排率）投影", () => {
  const SERVE = "serviceRate";
  const OBJ2: ParetoObjective[] = [
    { key: COST, dir: "min", label: "成本" },
    { key: SERVE, dir: "max", label: "获排率" },
  ];
  /** stub：档位越高服务得越多、也越贵 ⇒ 两根轴真权衡。 */
  const solveServe: SolveArgsFn = async (_fam, a) => {
    const cap = (a.facilities as { id: string; openCost: number }[]).find((f) => f.id === "OT")!.openCost;
    return {
      status: "FEASIBLE",
      optimal: false,
      objectiveValues: { [COST]: cap },
      servedCount: cap * 10,
      orderCount: 200,
    };
  };
  const reqServe: ParetoRequest = {
    family: "cross_object_occupancy",
    args: BASE_ARGS,
    objectives: OBJ2,
    levers: [{ key: OT_TARGET, label: "产能", values: [4, 10, 16] }],
  };

  it("⑦ `servedCount`/`orderCount` 进 metrics，且派生出 `serviceRate = 获排 ÷ 总数`", async () => {
    const res = await runOptimizePareto(solveServe, reqServe);
    expect(res.iterations).toBe(3);
    const byCost = new Map(res.frontier.concat(res.dominated).map((s) => [s.metrics[COST], s.metrics]));
    // 金丝雀：先证一个我确定取得到的量（成本）在，再断言新投影的那几个也在。
    expect(byCost.get(10)?.[COST]).toBe(10);
    expect(byCost.get(10)?.servedCount).toBe(100);
    expect(byCost.get(10)?.orderCount).toBe(200);
    expect(byCost.get(10)?.[SERVE]).toBeCloseTo(0.5, 6);
    expect(byCost.get(16)?.[SERVE]).toBeCloseTo(0.8, 6);
    // 三个档位在两根轴上互不支配 ⇒ 全在前沿（成本越低获排越少，真权衡）。
    expect(res.frontier.length).toBe(3);
  });

  it("⑧ **缺输入就整格不给，绝不补 0** —— 补 0 会让缺数据的解在 `max` 方向上冒充最差/最好", async () => {
    // 引擎不回 `orderCount` ⇒ `serviceRate` 这一格必须**不存在**，而不是 0。
    const noTotal: SolveArgsFn = async (_f, a) => {
      const cap = (a.facilities as { id: string; openCost: number }[]).find((f) => f.id === "OT")!.openCost;
      return { status: "FEASIBLE", optimal: false, objectiveValues: { [COST]: cap }, servedCount: cap * 10 };
    };
    const res = await runOptimizePareto(noTotal, { ...reqServe, objectives: [{ key: COST, dir: "min" }, { key: "servedCount", dir: "max" }] });
    for (const s of [...res.frontier, ...res.dominated]) {
      expect(s.metrics.servedCount).toBeTypeOf("number"); // 金丝雀：能取到的那个确实取到了
      expect(s.metrics[SERVE]).toBeUndefined(); // 取不到的那个是**缺席**，不是 0
    }
    // 分母为 0 同样是缺席（0 单的租户不存在"获排率"这件事）。
    const zeroTotal: SolveArgsFn = async () => ({
      status: "FEASIBLE", optimal: false, objectiveValues: { [COST]: 1 }, servedCount: 0, orderCount: 0,
    });
    const r0 = await runOptimizePareto(zeroTotal, { ...reqServe, objectives: [{ key: COST, dir: "min" }, { key: "servedCount", dir: "max" }] });
    for (const s of [...r0.frontier, ...r0.dominated]) expect(s.metrics[SERVE]).toBeUndefined();
  });

  it("⑨ 装配器点名的「要不到的轴」原样回显到结果里 —— 屏上那一列必须说得出为什么", async () => {
    const gaps = [
      { key: "margin", label: "毛利", reason: "营收侧与成本侧量纲不一致，且两侧都不含用量项" },
      { key: "cash", label: "现金", reason: "本族没有时间维，现金周期无从起算" },
    ];
    const res = await runOptimizePareto(solveServe, { ...reqServe, unavailableObjectives: gaps });
    expect(res.unavailableObjectives).toEqual(gaps);
    // 不给 ⇒ 空数组（**不是** undefined）：前端可以无条件 `.map()`，不必到处判空。
    const none = await runOptimizePareto(solveServe, reqServe);
    expect(none.unavailableObjectives).toEqual([]);
  });
});
