import { describe, expect, it } from "vitest";
import { ORDERS } from "@/mocks/fixtures";
import { mockMultiObj } from "@/mocks/simSolvers";
import {
  buildOccupancyScenario,
  deriveOrderCalibers,
  PENALTY_YUAN_PER_UNIT,
  type RealOrderInput,
} from "@/views/sim/multiObjScenario";

/**
 * SEAM · multiobj-real-orderbook-seam（WO-GUI4-MULTIOBJ-REAL）
 *
 * 驱动接缝：**真实 Order 订单簿** → 场景构建 → **真 cross_object_occupancy 求解器**（mock 逐口径移植 datacore
 * InProc 加权贪心，score = wRev·revenue + wPen·penalty 同式）。三判据，任一半漏即红：
 *  ① 订单簿 = 真实 Order（无写死 toy id SO-A/B/C，含真 so id）；
 *  ② 改目标权重 → 求解器真重算 → 被挤单集 & objectiveValues **真变**（前后 diff·不变即写死作假）；
 *  ③ 营收/违约金/换型成本来自真 Order 字段（qty×unitPrice / qty×优先级单价 / qty×换型单价），非 toy 常数。
 * 「绿测试≠能用·断在接缝」——只测各半 unit 不算过。
 */

// 真实订单簿（VITE_MOCK 态 = MSW /a/v1/objects?type=Order 同源 · 真 so/qty/unitPrice/pri）。
const realOrders: RealOrderInput[] = ORDERS.map((o) => ({
  so: o.so,
  cust: o.cust,
  model: o.model,
  qty: o.qty,
  unitPrice: o.unitPrice,
  pri: o.pri,
}));

const OBJ_KEYS = ["revenue", "penalty", "cost"] as const;
function crossArgs(scenario: ReturnType<typeof buildOccupancyScenario>, w: Record<string, number>) {
  return {
    scale: 1,
    seed: 42,
    orders: scenario.orders,
    lines: scenario.lines,
    contracts: scenario.contracts,
    eligibility: scenario.eligibility,
    method: "weighted",
    objectives: OBJ_KEYS.map((k) => ({ key: k, weight: w[k] })),
  };
}

describe("SEAM · multiobj-real-orderbook-seam", () => {
  const scenario = buildOccupancyScenario(realOrders);

  it("① 订单簿来自真实 Order（无写死 toy SO-A/B/C，含真 so id）", () => {
    expect(scenario.orders.length).toBeGreaterThanOrEqual(3);
    const ids = scenario.orders.map((o) => o.id);
    // 病根：此前写死 SO-A/SO-B/SO-C 三 toy 单。
    for (const toy of ["SO-A", "SO-B", "SO-C"]) expect(ids).not.toContain(toy);
    // 真 Order so（SO-1000x·与订单簿同源）。
    expect(ids.every((id) => /^SO-\d{3,}$/.test(id))).toBe(true);
    expect(ids).toContain(ORDERS[0]!.so);
    // 订单簿覆盖全部在手真单。
    expect(scenario.orders.length).toBe(realOrders.length);
  });

  it("③ 营收/违约金/换型成本来自真 Order 字段（qty×unitPrice / qty×优先级单价 / qty×换型单价），非 toy 常数", () => {
    const sample = realOrders[3]!;
    const cal = deriveOrderCalibers(sample);
    // 营收严格 = 数量 × 单价（真值）。
    expect(cal.revenue).toBe(Math.round(sample.qty * sample.unitPrice));
    // 违约金由**真 pri** 驱动（不同优先级 → 不同单价 → 违约金随真订单变，非常数）。
    expect(cal.penalty).toBe(Math.round(sample.qty * PENALTY_YUAN_PER_UNIT[sample.pri]!));
    // 场景订单的营收/违约金逐单 = 真值派生（对拍 rows）。
    for (const r of scenario.rows) {
      expect(r.revenue).toBe(Math.round(r.qty * ORDERS.find((o) => o.so === r.id)!.unitPrice));
    }
    // 病根反例：绝无 toy 常数（revenue 300/200/150 或 penalty 10/200/20）。
    const revs = scenario.orders.map((o) => o.revenue);
    const pens = scenario.orders.map((o) => o.penalty);
    for (const toyRev of [300, 200, 150]) expect(revs).not.toContain(toyRev);
    for (const toyPen of [10, 20]) expect(pens).not.toContain(toyPen);
    // 违约金随优先级真的分层（≥2 个不同单价出现 → 非单一常数）。
    const priSet = new Set(scenario.rows.map((r) => r.pri));
    expect(priSet.size).toBeGreaterThanOrEqual(2);
  });

  it("② 改目标权重 → 真 cross_object_occupancy 重算 → 被挤单集 & objectiveValues 真变", () => {
    const revHeavy = mockMultiObj("cross_object_occupancy", crossArgs(scenario, { revenue: 2, penalty: 0, cost: 0 })) as {
      displaced: string[];
      objectiveValues: Record<string, number>;
    };
    const penHeavy = mockMultiObj("cross_object_occupancy", crossArgs(scenario, { revenue: 0, penalty: 2, cost: 0 })) as {
      displaced: string[];
      objectiveValues: Record<string, number>;
    };
    // 有真实产能约束 → 确有被挤单（不是全排下 = 权重无从取舍）。
    expect(revHeavy.displaced.length).toBeGreaterThan(0);
    expect(penHeavy.displaced.length).toBeGreaterThan(0);
    // 被挤单集**真变**（营收优先 vs 违约金优先，保的单不同）。
    expect(penHeavy.displaced).not.toEqual(revHeavy.displaced);
    // objectiveValues **真变**（后端在同一真订单簿上真重排）。
    expect(penHeavy.objectiveValues).not.toEqual(revHeavy.objectiveValues);
    // 被挤单全是真 so id（可回指真订单）。
    const allIds = new Set(scenario.orders.map((o) => o.id));
    for (const id of [...revHeavy.displaced, ...penHeavy.displaced]) expect(allIds.has(id)).toBe(true);
  });

  it("② optimize_whatif（family=cross_object_occupancy）改违约金权重 → 各目标 Δ 分解真变（非全 0）", () => {
    const whatif = mockMultiObj("optimize_whatif", {
      args: crossArgs(scenario, { revenue: 1, penalty: 1, cost: 1 }),
      perturbations: [{ target: "objectives.penalty.weight", value: 2 }],
    }) as { deltaByObjective: Record<string, number>; feasible: boolean };
    expect(whatif.feasible).toBe(true);
    // 至少一个目标 Δ ≠ 0（改权重后最优真漂移 → 各目标真变）。
    const anyChange = OBJ_KEYS.some((k) => (whatif.deltaByObjective[k] ?? 0) !== 0);
    expect(anyChange).toBe(true);
  });
});
