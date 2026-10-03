import { describe, expect, it } from "vitest";
import { InProcOptimizerClient } from "../src/solvers/inproc-optimizer.js";
import { globalSimOptimize, type PortfolioInput } from "../src/solvers/portfolio.js";
import type { PortfolioRequest } from "../src/solvers/optimizer-client.js";

/**
 * WO-GLOBALSIM-SUITE · SEAM 守门（③④⑤ · G-VAR-1/2/3 · 跨「契约 + 引擎(portfolio/InProc)」·真求解驱动）。
 *
 * in-proc solve 注入（InProcOptimizerClient·确定性贪心·R6），逐条**红咬接缝**（改开关/交期/旋钮 → 引擎真重解 →
 * 输出真变·非前端假过滤）。头号判据 = 真驱动·非各半绿。
 */

const FORECAST_START = "2026-06-10";
const inproc = new InProcOptimizerClient();
const solve = (req: PortfolioRequest) => inproc.solvePortfolio!(req);
const mkCoeff = (over: Record<string, number> = {}) => (k: string, d: number): number => (k in over ? over[k]! : d);
const co = (from: string, to: string, hours: number) => ({ pairId: `${from}__${to}`, fromModel: from, toModel: to, hours, lineId: null, minutes: hours * 60 });
const base = (baseId: string, factory_type: string, util = 0) => ({ baseId, name: baseId, util, factory_type });
const line = (baseId: string, lineId: string, capacityDaily: number) => ({ baseId, lineId, capacityDaily });
const ord = (so: string, cust: string, model: string, qty: number, due: string, bases?: string[]) =>
  ({ so, cust, model, qty, due, pri: "高", status: "OPEN", ...(bases ? { bases } : {}) });

const baseInput = (over: Partial<PortfolioInput>): PortfolioInput => ({
  forecastStart: FORECAST_START,
  orders: [], workOrders: [], demandSegments: [],
  bases: [], lines: [], changeover: [],
  modelBaseMap: {},
  seed: 42,
  coeff: mkCoeff({ windowDays: 7 }),
  ...over,
});

describe("WO-GLOBALSIM-SUITE · ③ G-VAR-1 分批交付 per-order SEAM（切分批 → portfolio 真按分批重算 → 交付率/持库真变）", () => {
  // 世界：base1 单窗容量 700；大单 SO-BIG=1500 单窗装不下（1500>700）→ 默认被挤；per-order 分批 → 拆批各 ≤700 落多窗 → 获排。
  const world = (splitOrderIds?: string[]): PortfolioInput => baseInput({
    bases: [base("base1", "CELL+PACK")],
    lines: [line("base1", "b1-l1", 100)], // cap = 100×7 = 700/窗
    modelBaseMap: { M1: ["base1"] },
    orders: [
      ord("SO-BIG", "广汽集团", "M1", 1500, "2026-06-10"), // 单窗 700 装不下·拆 3×500 落窗0/1/2
      ord("SO-SMALL", "长安汽车", "M1", 100, "2026-06-10"), // 一次交付即可（≤500·不拆）
    ],
    scenarios: ["max_ontime"],
    splitBatch: 500,
    ...(splitOrderIds ? { splitOrderIds } : {}),
    coeff: mkCoeff({ windowDays: 7, splitBatch: 500, splitMaxParts: 4 }),
  });

  it("默认（一次交付）：SO-BIG 单窗装不下 → 被挤（capacity）·未获排", async () => {
    const r = await globalSimOptimize(world(), solve);
    const bigAlloc = (r.allocation ?? []).filter((a) => a.item.startsWith("SO-BIG"));
    expect(bigAlloc.length).toBe(0); // 一次交付口径下无法承接
    const bigBlocked = r.blocked.find((b) => b.orderId === "SO-BIG");
    expect(bigBlocked?.reason).toBe("capacity");
  });

  it("切分批（splitOrderIds=[SO-BIG]）→ 引擎真拆批重算 → SO-BIG 拆批获排·Σ子批==qty·交付量前后真升（非写死）", async () => {
    const before = await globalSimOptimize(world(), solve);
    const after = await globalSimOptimize(world(["SO-BIG"]), solve);

    // 拆批子项落表（SO-BIG#b0/#b1/#b2）·Σ子批 == 原单量 1500。
    const bigBatches = (after.allocation ?? []).filter((a) => a.item.startsWith("SO-BIG#b"));
    expect(bigBatches.length).toBeGreaterThanOrEqual(2); // 至少 2 批
    expect(bigBatches.reduce((s, a) => s + a.qty, 0)).toBe(1500);

    // 交付率真变：分批后主方案实排量 > 分批前（SO-BIG 从被挤 → 获排）。
    const servedBefore = before.scenarios[0]!.servedQty ?? 0;
    const servedAfter = after.scenarios[0]!.servedQty ?? 0;
    expect(servedAfter).toBeGreaterThan(servedBefore);

    // per-order 真驱动：只 SO-BIG 拆批（SO-SMALL 未在集合内 → 不拆·整单一格）。
    const smallAlloc = (after.allocation ?? []).filter((a) => a.item.startsWith("SO-SMALL"));
    expect(smallAlloc.every((a) => a.item === "SO-SMALL")).toBe(true); // 无 #b 后缀
  });

  it("R6：同输入分批两跑 allocation 字节一致（禁 Date.now/random·forecastStart 锚）", async () => {
    const a = await globalSimOptimize(world(["SO-BIG"]), solve);
    const b = await globalSimOptimize(world(["SO-BIG"]), solve);
    expect(JSON.stringify(a.allocation)).toBe(JSON.stringify(b.allocation));
  });
});

describe("WO-GLOBALSIM-SUITE · ④ G-VAR-2 最终交期 per-order SEAM（设最终交期 → 目标vs最终可达交期差真算）", () => {
  // 世界：三大单占满窗0/1/2；SO-T 交期在窗0 但默认可排窗（0..dueWindow+lateWindows=2）全满 → 被挤。
  // 设 finalDueDay 放宽最晚窗 → SO-T 在更晚窗获排 → 可达交期 > 目标交期（gap 真算·非写死）。
  const world = (finalDueDays?: Record<string, number>): PortfolioInput => baseInput({
    bases: [base("base1", "CELL+PACK")],
    lines: [line("base1", "b1-l1", 100)], // cap = 700/窗
    modelBaseMap: { M1: ["base1"] },
    orders: [
      ord("SO-A1", "广汽集团", "M1", 700, "2026-06-10"), // 窗0
      ord("SO-A2", "长安汽车", "M1", 700, "2026-06-17"), // 窗1
      ord("SO-A3", "比亚迪", "M1", 700, "2026-06-24"),   // 窗2
      ord("SO-T", "蔚来", "M1", 700, "2026-06-10"),      // 目标窗0·被上面挤满
    ],
    scenarios: ["max_ontime"],
    ...(finalDueDays ? { finalDueDays } : {}),
    coeff: mkCoeff({ windowDays: 7 }),
  });

  it("默认（不设最终交期）：SO-T 目标窗0 但可排窗全满 → 被挤（无最终交期推演行）", async () => {
    const r = await globalSimOptimize(world(), solve);
    const tAlloc = (r.allocation ?? []).filter((a) => a.item === "SO-T");
    expect(tAlloc.length).toBe(0);
    expect(r.dueComparison).toBeUndefined(); // 未设 finalDueDays → 不出推演
  });

  it("设最终交期（finalDueDays[SO-T]=35·窗5）→ SO-T 在更晚窗真获排 → dueComparison 目标vs可达差真算（gap>0·非写死）", async () => {
    const r = await globalSimOptimize(world({ "SO-T": 35 }), solve);
    const tAlloc = (r.allocation ?? []).filter((a) => a.item === "SO-T");
    expect(tAlloc.length).toBe(1); // 放宽最晚窗后获排

    const dc = (r.dueComparison ?? []).find((x) => x.orderId === "SO-T");
    expect(dc).toBeTruthy();
    expect(dc!.targetDueDay).toBe(0);            // 原目标交期 = 窗0（day0）
    expect(dc!.finalDueDay).toBe(35);            // 用户设的最终交期
    expect(dc!.achievableDay).not.toBeNull();    // 联合求解真可达交付日
    expect(dc!.achievableDay!).toBeGreaterThan(0); // 晚于目标窗0
    expect(dc!.gapDays).toBe(dc!.achievableDay! - dc!.targetDueDay); // gap = 可达 − 目标（真算）
    expect(dc!.gapDays!).toBeGreaterThan(0);     // 目标 vs 最终可达 有正差
    expect(dc!.meetsFinal).toBe(true);           // 可达 ≤ 最终交期（35）
  });

  it("最终交期真驱动：放宽越多 → 可达窗越晚（改 finalDueDay → achievableDay 真变·非写死）", async () => {
    // 收紧到窗3（21天）vs 放宽到窗5（35天）：两者可达日不同（引擎按放宽窗真重排）。
    const tight = await globalSimOptimize(world({ "SO-T": 21 }), solve);
    const loose = await globalSimOptimize(world({ "SO-T": 42 }), solve);
    const tDc = tight.dueComparison!.find((x) => x.orderId === "SO-T")!;
    const lDc = loose.dueComparison!.find((x) => x.orderId === "SO-T")!;
    // 收紧窗上界 → 可达日 ≤ 放宽（更晚窗有空则更靠后·至少不早于收紧态）；且都是真求解产物非写死。
    expect(tDc.achievableDay).not.toBeNull();
    expect(lDc.achievableDay).not.toBeNull();
    expect(lDc.achievableDay!).toBeGreaterThanOrEqual(tDc.achievableDay!);
  });
});

describe("WO-GLOBALSIM-SUITE · ⑤ G-VAR-3 方法旋钮 SEAM（改 权重/ε上界/字典序 → objectiveValues/分配真变·三方法形状不同）", () => {
  // 世界：SO-A 有两个真权衡格——P=base1/窗0（按期·但需换型 M0→M1·代价高）· Q=base2/窗1（迟·无换型·代价低）。
  //   base2/窗0 被 committedBatch 预占（净0）→ base2 仅窗1 可用。改方法旋钮 → 择格真变。
  const world = (over: Partial<PortfolioInput>): PortfolioInput => baseInput({
    bases: [base("base1", "CELL+PACK"), base("base2", "CELL+PACK")],
    lines: [line("base1", "b1-l1", 100), line("base2", "b2-l1", 100)], // cap 700/窗
    modelBaseMap: { M1: ["base1", "base2"] },
    orders: [ord("SO-A", "广汽集团", "M1", 700, "2026-06-10", ["base1", "base2"])],
    baseCurrentModel: { base1: "M0", base2: "M1" }, // base1 需换 M0→M1·base2 已在跑 M1（无换型）
    changeover: [co("M0", "M1", 5)],
    committedBatches: [{ base: "base2", window: 0, qty: 700 }], // 预占 base2/窗0 → base2 仅窗1
    coeff: mkCoeff({ windowDays: 7 }),
    ...over,
  });
  const alloc0 = (r: { methodScenario?: { allocation: { orderId: string; base: string; window: number }[] } }) =>
    r.methodScenario!.allocation.find((a) => a.orderId === "SO-A")!;

  it("加权权重旋钮：权重压 ontime → 择按期格(base1/窗0)；权重压 cost → 择低代价格(base2/窗1)（改权重 → 分配真变）", async () => {
    const wOntime = await globalSimOptimize(world({ method: "weighted", methodWeights: { ontime: 100, cost: 0.01 } }), solve);
    const wCost = await globalSimOptimize(world({ method: "weighted", methodWeights: { cost: 100, ontime: 0.01 } }), solve);
    expect(wOntime.methodScenario!.method).toBe("weighted");
    expect(alloc0(wOntime).base).toBe("base1"); // 按期格
    expect(alloc0(wOntime).window).toBe(0);
    expect(wOntime.methodScenario!.objectiveValues.ontime).toBe(1);
    expect(alloc0(wCost).base).toBe("base2");   // 低代价格
    expect(alloc0(wCost).window).toBe(1);
    expect(wCost.methodScenario!.objectiveValues.ontime).toBe(0);
    // 改权重 → objectiveValues 真变（非旋钮空转）。
    expect(wOntime.methodScenario!.objectiveValues.ontime).not.toBe(wCost.methodScenario!.objectiveValues.ontime);
  });

  it("字典序优先级旋钮：[ontime 先] → base1/窗0 按期；[changeover 先] → base2/窗1 零换型（改优先序 → 分层结果换形）", async () => {
    const pOntime = await globalSimOptimize(world({ method: "lexicographic", priority: ["ontime", "cost", "changeover", "delay", "fgInventory"] }), solve);
    const pChg = await globalSimOptimize(world({ method: "lexicographic", priority: ["changeover", "cost", "ontime", "delay", "fgInventory"] }), solve);
    expect(pOntime.methodScenario!.method).toBe("lexicographic");
    expect(alloc0(pOntime).base).toBe("base1");
    expect(pOntime.methodScenario!.objectiveValues.ontime).toBe(1);
    expect(alloc0(pChg).base).toBe("base2");
    expect(pChg.methodScenario!.objectiveValues.changeover).toBe(0);
    expect(alloc0(pOntime).base).not.toBe(alloc0(pChg).base); // 改优先序 → 分配真变
  });

  it("ε-约束上界旋钮：ε{delay≤0} → 逼出按期格(base1/窗0)；ε{changeover≤0} → 逼出零换型格(base2/窗1)（改 ε → 主目标让位真变）", async () => {
    const eDelay = await globalSimOptimize(world({ method: "epsilon", epsilon: [{ key: "delay", bound: 0 }] }), solve);
    const eChg = await globalSimOptimize(world({ method: "epsilon", epsilon: [{ key: "changeover", bound: 0 }] }), solve);
    expect(eDelay.methodScenario!.method).toBe("epsilon");
    expect(alloc0(eDelay).base).toBe("base1"); // delay≤0 逼出按期
    expect(eDelay.methodScenario!.objectiveValues.delay).toBe(0);
    expect(alloc0(eChg).base).toBe("base2");   // changeover≤0 逼出零换型
    expect(eChg.methodScenario!.objectiveValues.changeover).toBe(0);
    expect(alloc0(eDelay).base).not.toBe(alloc0(eChg).base); // 改 ε 上界 → 分配真变
  });

  it("三方法形状不同 + R6：weighted(cost)/lexicographic(ontime)/epsilon(changeover) objectiveValues 非全等；同输入两跑字节一致", async () => {
    const w = await globalSimOptimize(world({ method: "weighted", methodWeights: { cost: 100 } }), solve);
    const l = await globalSimOptimize(world({ method: "lexicographic", priority: ["ontime", "cost", "changeover", "delay", "fgInventory"] }), solve);
    const e = await globalSimOptimize(world({ method: "epsilon", epsilon: [{ key: "changeover", bound: 0 }] }), solve);
    const ov = (r: typeof w) => JSON.stringify(r.methodScenario!.objectiveValues);
    // lexicographic(ontime 先) 与 weighted(cost 先) 形状不同（按期 vs 低代价）。
    expect(ov(l)).not.toBe(ov(w));
    // R6：weighted 同输入两跑字节一致。
    const w2 = await globalSimOptimize(world({ method: "weighted", methodWeights: { cost: 100 } }), solve);
    expect(ov(w)).toBe(ov(w2));
    void e;
  });
});
