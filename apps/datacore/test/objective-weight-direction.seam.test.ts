import { describe, expect, it } from "vitest";
import { ADMIN, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * WO-OBJECTIVE-SIGN · 目标权重**方向**接缝（前端控件 → 请求体 → 求解器目标函数）。
 *
 * ══ 今天的行为是 X，应该是 Y（实测·真订单簿 50 单）═══════════════════════════════
 *
 * **X（修前）**：`solveCrossObjectOccupancy` 的装入优先序 = `wRev·revenue + wPen·penalty` 的
 *   **绝对值**降序，而被消耗的约束资源是 `qty`。因 `revenue = qty × unitPrice`，
 *   绝对分 `= qty × 单位价值` ⇒ 排序被 **qty** 支配：把"营收权重"调大 = 优先塞**最大的单**
 *   （不是最赚的单）。实测把营收权重 0→2：获排 **20→19→18→17→16**（严格递减）、
 *   营收 39.35→39.31→39.49→39.26→**38.76 亿**、违约金 12.11→**16.87 亿** ——
 *   **调大「营收（越高越好）」的权重，营收反而跌、违约金也涨**，两项同时变差，
 *   即"没有权衡"，与屏上承诺相反。
 *
 * **Y（本文件咬住的）**：优先序 = **逐目标 min-max 归一后的单位产能净价值密度**
 *   `Σ ±w_k · norm_k(读数_k / qty)`（营收与"避掉的违约金" `+`，指派代价 `−`）。
 *   于是"我更在乎营收" ⇒ 优先高**单价**单 ⇒ 营收**单调不降**、并以违约金变差为代价（真权衡）。
 *
 * ══ 为什么这条测试非走真路由不可（本仓假绿第 9 形态）═══════════════════════════
 * 同族既有测试（`opt-multiobj.test.ts` / `opt-pareto.seam.test.ts`）喂的都是 **mock 求解器**
 * 或 **stub SolveArgsFn** —— 它们咬的是"路由把权重原样传下去了吗"，
 * **咬不到"求解器拿到权重之后算得对不对"**。这个 bug 正是活在那道缝里：
 * 权重一路传到底、回包也真变，只是**变的方向是反的**，于是三包全绿、屏上有数、结论错。
 * 故本文件：真 `makeApp` + 真 `seedBattery` 种子 + 真 `POST /a/v1/solvers/.../invoke` 路由
 * + **真 InProcOptimizer**（内存态生产走的就是它），一个替身都不放。
 *
 * ══ 断言必须能失败（A1 那条的教训）═══════════════════════════════════════════════
 * "单调不降"单独拿出来是**半个恒真断言**：一条完全不动的平线也满足它。
 * 故必须同时咬 **② 至少有一处严格上升** —— 两条合起来才既排除"反向"也排除"空转"。
 */

/** 违约金优先级单价（元/未交付套）· 与面板 `multiObjScenario.ts` 同一口径。 */
const PENALTY_PER_UNIT: Record<string, number> = { 高: 26000, 中: 9000, 低: 2600 };
/** 换型/建线摊销单价（元/套）· 同上。**全体订单同一个数** ⇒ 该维单位读数零极差（见 ③）。 */
const CHANGEOVER_PER_UNIT = 800;
/** 产线容量覆盖率 <1 ⇒ 排不下 ⇒ 权重取舍才有意义（覆盖率给满则谁都排得下，本测将失去判别力）。 */
const LINE_COVERAGE = 0.6;

const chemOf = (model: string): "NCM" | "LFP" => (model.includes("LFP") || model.includes("储能") ? "LFP" : "NCM");

interface RealOrder { so: string; cust: string; model: string; qty: number; unitPrice: number; pri: string }

/**
 * 真 Order → cross_object_occupancy 三元组。**镜像面板 `buildOccupancyScenario` 的口径**。
 *
 * ⚠ 本测断言的是**方向不变式**（升权重 ⇒ 营收不降），不是具体金额 ⇒ 即便上面几个系数日后漂了，
 * 断言依然有效、依然能失败。这是刻意的：把测试钉在金额上，改一次系数就要改一次测试，
 * 改着改着就没人看它到底在证什么了。
 */
function buildScenario(input: RealOrder[]) {
  const orders = input
    .filter((o) => o.so && Number.isFinite(o.qty) && o.qty > 0 && Number.isFinite(o.unitPrice) && o.unitPrice > 0)
    .sort((a, b) => a.so.localeCompare(b.so));
  const chemDemand = new Map<string, number>();
  for (const o of orders) chemDemand.set(chemOf(o.model), (chemDemand.get(chemOf(o.model)) ?? 0) + o.qty);
  const custDemand = new Map<string, number>();
  for (const o of orders) custDemand.set(o.cust, (custDemand.get(o.cust) ?? 0) + o.qty);
  return {
    orders: orders.map((o) => ({
      id: o.so,
      revenue: Math.round(o.qty * o.unitPrice),
      penalty: Math.round(o.qty * (PENALTY_PER_UNIT[o.pri] ?? PENALTY_PER_UNIT["中"]!)),
      qty: o.qty,
      contractId: o.cust,
    })),
    lines: [...chemDemand.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([chem, dem]) => ({ id: `LINE-${chem}`, capacity: Math.max(1, Math.round(dem * LINE_COVERAGE)) })),
    contracts: [...custDemand.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cust, dem]) => ({ id: cust, cap: Math.max(1, Math.round(dem)) })),
    eligibility: orders.map((o) => ({ order: o.so, line: `LINE-${chemOf(o.model)}`, cost: Math.round(o.qty * CHANGEOVER_PER_UNIT) })),
  };
}

interface OccOut {
  status: string;
  objectiveValues: Record<string, number>;
  servedCount: number;
  objective?: number;
  objectiveSpread?: Record<string, number>;
}

async function enableOpt(t: TestApp): Promise<void> {
  await t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "opt.solver-pool": true, "opt.multiobj": true } },
  });
}

async function realOrders(t: TestApp): Promise<RealOrder[]> {
  const r = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Order&q=", headers: ADMIN });
  expect(r.statusCode).toBe(200);
  const items = (r.json() as { items: { id: string; props: Record<string, unknown> }[] }).items ?? [];
  return items.map((o) => ({
    so: String(o.props.so ?? o.id),
    cust: String(o.props.cust ?? "—"),
    model: String(o.props.model ?? ""),
    qty: Number(o.props.qty ?? 0),
    unitPrice: Number(o.props.unitPrice ?? 0),
    pri: String(o.props.pri ?? "中"),
  }));
}

describe("WO-OBJECTIVE-SIGN · 权重 → 目标函数方向（真种子 · 真路由 · 真 InProcOptimizer）", () => {
  it("① 营收权重升 ⇒ 营收读数单调不降 ② 且至少一处严格上升（排除「空转」） ③ 违约金同向变差（真权衡）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await enableOpt(t);
    const scenario = buildScenario(await realOrders(t));

    // 金丝雀：先证这份订单簿**够格做这个实验** —— 单价与优先级都必须有差异，
    // 且产能确实不够（排不下）。任一不成立，下面的"权重取舍"根本无从谈起，
    // 断言会退化成恒真，而屏上看不出来。
    expect(scenario.orders.length).toBeGreaterThanOrEqual(10);
    const unitPrices = new Set(scenario.orders.map((o) => Math.round(o.revenue / o.qty)));
    const penUnits = new Set(scenario.orders.map((o) => Math.round(o.penalty / o.qty)));
    expect(unitPrices.size).toBeGreaterThan(1);
    expect(penUnits.size).toBeGreaterThan(1);
    const totalQty = scenario.orders.reduce((s, o) => s + o.qty, 0);
    const totalCap = scenario.lines.reduce((s, l) => s + l.capacity, 0);
    expect(totalCap).toBeLessThan(totalQty);

    const runAt = async (wRev: number): Promise<OccOut> => {
      const r = await t.app.inject({
        method: "POST", url: "/a/v1/solvers/cross_object_occupancy/invoke", headers: ADMIN,
        payload: {
          args: {
            scale: 1, seed: 42,
            orders: scenario.orders, lines: scenario.lines, contracts: scenario.contracts, eligibility: scenario.eligibility,
            method: "weighted",
            // 这一行就是**屏上那三根滑杆**：前端把它们原样放进 `objectives[].weight`。
            objectives: [{ key: "revenue", weight: wRev }, { key: "penalty", weight: 1 }, { key: "cost", weight: 1 }],
          },
        },
      });
      expect(r.statusCode).toBe(200);
      return (r.json() as { data: OccOut }).data;
    };

    // 权重升序网格。**跨度必须够大**：这条链上"高优先级单同时也是高单价单"很常见，
    // 它们在两根轴上都占优 ⇒ 任何权重比都排不动它们 ⇒ 窄网格会落在一段平台上，
    // 平台本身不是 bug，但只扫平台就证不出方向（这正是本单实测踩到的坑，记在此防下一个人重扫窄网格）。
    const grid = [0, 1, 4, 16, 32];
    const runs: OccOut[] = [];
    for (const w of grid) runs.push(await runAt(w));

    // 求解必须真的成功（否则下面比的是两个空壳）。
    for (const o of runs) expect(o.status).not.toBe("INFEASIBLE");

    const rev = runs.map((o) => o.objectiveValues.revenue!);
    const pen = runs.map((o) => o.objectiveValues.penalty!);

    // ① 单调不降 —— 修前这条必红（实测修前是**严格递减**：39.49 → 38.76 亿）。
    for (let i = 1; i < rev.length; i++) {
      expect(rev[i]!, `营收在 wRev ${grid[i - 1]}→${grid[i]} 处下降了（${rev[i - 1]} → ${rev[i]}）`).toBeGreaterThanOrEqual(rev[i - 1]!);
    }
    // ② 至少一处**严格**上升 —— 没有这条，一条完全不动的平线也能骗过 ①。
    expect(rev[rev.length - 1]!, "全程零变化：权重没有真正进入目标函数（滑杆空转）").toBeGreaterThan(rev[0]!);
    // ③ 代价那一侧必须同向变差 —— 只涨不付代价说明它根本不是在**权衡**，而是某处单调放大。
    expect(pen[pen.length - 1]!, "营收升了而违约金没变差：这不是权衡，是另一处出了问题").toBeGreaterThan(pen[0]!);
  });

  it("④ 标量目标 `objective` 必须下发（「改权重 → 目标值动」这条链的落点）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await enableOpt(t);
    const scenario = buildScenario(await realOrders(t));
    const run = async (w: Record<string, number>): Promise<OccOut> => {
      const r = await t.app.inject({
        method: "POST", url: "/a/v1/solvers/cross_object_occupancy/invoke", headers: ADMIN,
        payload: { args: { scale: 1, seed: 42, ...scenario, method: "weighted",
          objectives: [{ key: "revenue", weight: w.revenue }, { key: "penalty", weight: w.penalty }, { key: "cost", weight: w.cost }] } },
      });
      expect(r.statusCode).toBe(200);
      return (r.json() as { data: OccOut }).data;
    };
    const base = await run({ revenue: 1, penalty: 1, cost: 1 });
    // 修前回包里**没有任何一个标量**代表"这组权重下这个解有多好" ⇒ 这条断言修前必红。
    expect(typeof base.objective, "回包缺 objective：改权重→目标值这条链没有落点").toBe("number");

    // 同一个解、只把营收权重翻倍 ⇒ 加权标量目标必须跟着动（它是 wRev 的严格增函数：营收项系数变了）。
    const doubled = await run({ revenue: 2, penalty: 1, cost: 1 });
    expect(doubled.objective).not.toBe(base.objective);
  });

  it("⑤ `objectiveSpread` 如实报出「哪一维分不出订单先后」 —— 屏上据此置灰，不是写死白名单", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await enableOpt(t);
    const scenario = buildScenario(await realOrders(t));
    const r = await t.app.inject({
      method: "POST", url: "/a/v1/solvers/cross_object_occupancy/invoke", headers: ADMIN,
      payload: { args: { scale: 1, seed: 42, ...scenario, method: "weighted",
        objectives: [{ key: "revenue", weight: 1 }, { key: "penalty", weight: 1 }, { key: "cost", weight: 1 }] } },
    });
    expect(r.statusCode).toBe(200);
    const out = (r.json() as { data: OccOut }).data;
    const spread = out.objectiveSpread;
    expect(spread, "回包缺 objectiveSpread：前端就只能靠写死白名单猜哪根滑杆是死的").toBeDefined();
    // 金丝雀：先证这份判据**认得出"活的"维** —— 单价与违约单价都有差异 ⇒ 极差必 > 0。
    // 少了这一句，「cost 报 0」与「整个判据算坏了恒报 0」在屏上一模一样。
    expect(spread!.revenue).toBeGreaterThan(0);
    expect(spread!.penalty).toBeGreaterThan(0);
    // 换型单价对全体订单是同一个常数（`CHANGEOVER_PER_UNIT`）⇒ 单位读数零极差
    // ⇒ 该权重乘上去只是给每一单加同一个数，**数学上不可能改变任何一对订单的先后**。
    expect(spread!.cost, "换型维极差不为 0 —— 要么口径变了，要么这份判据算错了").toBe(0);
  });
});
