/**
 * WO-C0828-P2 · option-pricing 单元测试（PRD-sim-options-decision-surface.md §4.2）
 *
 * 判据覆盖：
 *  - ① 查绑定：命中 / prop 不在公式 / targetType 不匹配 / 聚合式跳过（诚实缺格不上桌）
 *  - ② 代入：自属性式 = toValue / 复合式按真 props 代入 / 顶层 COALESCE 兜底 / 不可译 / 坏式子
 *  - ⑤ 位移分布口径：与前端 buildMoneyView.magnitude 逐字节同式（0.01 地板、[0.01,1,10] 档、
 *    最近秩分位、faint/实质分账、订单集金丝雀）
 *  - 指纹：确定性 + 输入敏感性（R6）
 *  - 装配：E2-c 零扰动对照（诚实零 ≠ gap）、E2-d 反向金丝雀（无绑定 ⇒ gap，⛔ 不返 0）、
 *    落点格缺失 ⇒ gap、E2-g 零写入（deps 接口结构上无 persist 旋钮，且只调两次只读推进）、
 *    披露六要素（specKey/落点/tick 数/耗时/agentInvolved:false）
 */
import { describe, expect, it } from "vitest";

import type { Perturbation, SimStateDiffCell, SolutionCandidate, TickState } from "@platform/contracts";

import type { DerivationSpecRecord } from "../src/domain";
import {
  computePressureTarget,
  findPricingBinding,
  orderDisplacement,
  priceCandidate,
  pricingFingerprint,
  scenarioPerturbationsHash,
  type PricingDeps,
} from "../src/sim/option-pricing";

/* ── 夹具 ─────────────────────────────────────────────────────────────────── */

const mkSpec = (over: Partial<DerivationSpecRecord>): DerivationSpecRecord => ({
  id: "dspec_test",
  tenantId: "demo",
  ontologyVersion: 1,
  specKey: "test_spec",
  targetType: "Line",
  targetProp: "utilPressure",
  formula: "this.utilization",
  deps: [{ typeKey: "Line", prop: "utilization" }],
  status: "ACTIVE",
  ...over,
});

const SPECS: readonly DerivationSpecRecord[] = [
  mkSpec({ id: "dspec_line_util", specKey: "line_util_pressure" }),
  mkSpec({
    id: "dspec_mat_shortage",
    specKey: "material_shortage_risk",
    targetType: "Material",
    targetProp: "shortageRisk",
    formula: "COALESCE(this.leadTime * 2 / 10, 0)",
    deps: [{ typeKey: "Material", prop: "leadTime" }],
  }),
  mkSpec({
    id: "dspec_agg",
    specKey: "order_qty_agg",
    targetType: "Order",
    targetProp: "qtyAgg",
    formula: "out(Order.qty)",
    deps: [{ typeKey: "Order", prop: "qty", direction: "out" }],
  }),
];

const baseCandidate: SolutionCandidate = {
  candidateId: "cand_line_a1",
  impedimentId: "imp_1",
  label: "常州 A 线利用率 95→89.9",
  lever: { objectType: "Line", objectId: "obj_line_A1", prop: "utilization", unit: "%", valueKind: "percent" },
  fromValue: 95,
  toValue: 89.9153,
  join: { kind: "LOCUS_PROP", path: "line:obj_line_A1" },
  rungKind: "THRESHOLD",
  rungSource: "规则 C05 阈值 95",
  effectKind: "METRIC_SELF",
  dims: [
    { key: "utilPressure", label: "利用率压力", value: 89.9153, baseline: 95, unit: "", betterWhen: "lower", dataMode: "LIVE" },
  ],
  provenance: { solverKey: "impediment-options", formula: "this.utilization", inputs: ["Line.utilization"] },
  dataMode: "LIVE",
};

const mkCandidate = (over: Partial<SolutionCandidate>): SolutionCandidate => ({ ...baseCandidate, ...over });

const cell = (objectId: string, delta: number): SimStateDiffCell => ({
  objectId,
  stateVar: "pressure",
  baseline: 0,
  counterfactual: delta,
  delta,
  direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
});

const mkDeps = (over?: Partial<PricingDeps>): PricingDeps => {
  let clock = 0;
  return {
    listPerturbations: async () => [],
    readWorldState: async () => ({ obj_line_A1: { utilPressure: 95 } }),
    readObjectProps: async () => ({ utilization: 95.8912 }),
    listOrderIds: async () => ["o1", "o2"],
    listOrderValues: async () => new Map([["o1", 1_000_000], ["o2", 2_000_000]]),
    advanceTicks: async (_sid, opts) =>
      opts.ephemeral?.length ? { o1: { pressure: 5 }, o2: { pressure: 0.02 } } : { o1: { pressure: 0 }, o2: { pressure: 0 } },
    now: () => ++clock,
    makeId: (p) => `${p}_test`,
    ...over,
  };
};

const mkInput = (over?: Partial<Parameters<typeof priceCandidate>[1]>) => ({
  tenantId: "demo",
  sessionId: "sims_test",
  curTick: 3,
  horizon: 6,
  candidate: baseCandidate,
  specs: SPECS,
  sessionCreatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

/* ── ① 查绑定 ─────────────────────────────────────────────────────────────── */

describe("findPricingBinding（① 查绑定）", () => {
  it("命中：targetType 同且公式引用 this.<prop>", () => {
    expect(findPricingBinding(SPECS, "Line", "utilization")?.specKey).toBe("line_util_pressure");
  });
  it("不命中：prop 不在公式里（value ≠ qty，防前缀误配）", () => {
    expect(findPricingBinding(SPECS, "Line", "oee")).toBeNull();
  });
  it("不命中：targetType 不同", () => {
    expect(findPricingBinding(SPECS, "Process", "utilization")).toBeNull();
  });
  it("聚合式跳过：运行期被诚实跳过的那类当不了定价绑定", () => {
    expect(findPricingBinding(SPECS, "Order", "qty")).toBeNull();
  });
});

/* ── ② 代入 ───────────────────────────────────────────────────────────────── */

describe("computePressureTarget（② 代入）", () => {
  it("自属性式：代入 = toValue", () => {
    const spec = SPECS[0]!;
    expect(computePressureTarget(spec, { utilization: 95.8912 }, "utilization", 89.9153)).toBeCloseTo(89.9153, 6);
  });
  it("复合式：按真 props 代入（leadTime 26→10 ⇒ 2，复验 02 同款病指纹样本）", () => {
    const spec = SPECS[1]!;
    expect(computePressureTarget(spec, { leadTime: 26 }, "leadTime", 10)).toBeCloseTo(2, 6);
  });
  it("顶层 COALESCE 兜底：除零 → fallback 0（与 runDerivations 同语义）", () => {
    const spec = mkSpec({ formula: "COALESCE(this.qtyOnHand / this.dailyDemand, 0)" });
    expect(computePressureTarget(spec, { qtyOnHand: 5, dailyDemand: 0 }, "qtyOnHand", 5)).toBe(0);
  });
  it("不可译（聚合）→ null", () => {
    expect(computePressureTarget(SPECS[2]!, { qty: 10 }, "qty", 12)).toBeNull();
  });
  it("坏式子 → null", () => {
    const spec = mkSpec({ formula: "this.utilization +" });
    expect(computePressureTarget(spec, { utilization: 95 }, "utilization", 89)).toBeNull();
  });
});

/* ── ⑤ 位移分布 ───────────────────────────────────────────────────────────── */

describe("orderDisplacement（⑤ 位移分布，与 buildMoneyView.magnitude 同口径）", () => {
  it("分档 + 最近秩分位 + faint 分账（非订单格排除）", () => {
    const diffs = [cell("o1", -0.005), cell("o1", -0.002), cell("o2", 0.02), cell("o3", 5), cell("o4", 12), cell("nonOrder", 999)];
    const d = orderDisplacement(diffs, new Set(["o1", "o2", "o3", "o4"]));
    expect(d.ordersSeen).toBe(4);
    expect(d.faintOnly).toBe(1); // o1 最大 |Δ|=0.005 ≤ 0.01
    expect(d.touchedOrders).toBe(3);
    expect([...d.touchedOrderIds].sort()).toEqual(["o2", "o3", "o4"]);
    // mags 升序 [0.005, 0.02, 5, 12]：p50 = 第 floor(4×0.5)=2 个 = 5；p90 = 第 floor(4×0.9)=3 个 = 12
    expect(d.p50).toBe(5);
    expect(d.p90).toBe(12);
    expect(d.max).toBe(12);
    expect(d.buckets.map((b) => [b.label, b.n])).toEqual([
      ["微弱 ≤0.01", 1],
      ["轻 0.01–1", 1],
      ["中 1–10", 1],
      ["重 >10", 1],
    ]);
  });
  it("空差分：诚实零（p50/p90/max = null，桶全 0，不是「没算」）", () => {
    const d = orderDisplacement([], new Set(["o1"]));
    expect(d.ordersSeen).toBe(1);
    expect(d.touchedOrders).toBe(0);
    expect(d.faintOnly).toBe(0);
    expect(d.p50).toBeNull();
    expect(d.p90).toBeNull();
    expect(d.max).toBeNull();
    expect(d.buckets.every((b) => b.n === 0)).toBe(true);
  });
  it("金丝雀：差分非空但订单集为空 ⇒ ordersSeen=0（遍历坏了必须可分辨，不许读成「没有波及」）", () => {
    const d = orderDisplacement([cell("o1", 5)], new Set());
    expect(d.ordersSeen).toBe(0);
    expect(d.touchedOrders).toBe(0);
  });
});

/* ── 指纹 ─────────────────────────────────────────────────────────────────── */

describe("指纹（R6 确定性）", () => {
  it("同输入同输出；任一维变化即变", () => {
    const a = pricingFingerprint({ sessionId: "s1", curTick: 3, scenarioHash: "h", candidateId: "c1" });
    expect(pricingFingerprint({ sessionId: "s1", curTick: 3, scenarioHash: "h", candidateId: "c1" })).toBe(a);
    expect(pricingFingerprint({ sessionId: "s1", curTick: 4, scenarioHash: "h", candidateId: "c1" })).not.toBe(a);
    expect(pricingFingerprint({ sessionId: "s1", curTick: 3, scenarioHash: "h", candidateId: "c2" })).not.toBe(a);
  });
  it("场景扰动哈希：顺序无关、内容敏感", () => {
    const p = (id: string, magnitude: number): Perturbation => ({
      id,
      tenantId: "demo",
      sessionId: "s",
      kind: "capacity_loss",
      targetObjectId: "o1",
      targetStateVar: "utilPressure",
      startTick: 0,
      durationTicks: null,
      magnitude,
      mode: "set",
      label: "l",
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect(scenarioPerturbationsHash([p("a", 1), p("b", 2)])).toBe(scenarioPerturbationsHash([p("b", 2), p("a", 1)]));
    expect(scenarioPerturbationsHash([p("a", 1)])).not.toBe(scenarioPerturbationsHash([p("a", 2)]));
  });
});

/* ── 装配 ─────────────────────────────────────────────────────────────────── */

describe("priceCandidate（④⑤⑥ 装配）", () => {
  it("E2-c 零扰动对照：候选态 = 对照态 ⇒ 诚实零（priced + 全零读数，⛔ 不是 gap 也不是假数）", async () => {
    const deps = mkDeps({ advanceTicks: async () => ({ o1: { pressure: 0 } }) });
    const r = await priceCandidate(deps, mkInput({ candidate: mkCandidate({ toValue: 95 }) }));
    expect(r.kind).toBe("priced");
    if (r.kind !== "priced") return;
    expect(r.after.touchedOrders).toBe(0);
    expect(r.after.exposureYuan).toBe(0);
    expect(r.after.displacement.p50).toBeNull();
    expect(r.after.displacement.ordersSeen).toBe(2);
    expect(r.disclosure.specKey).toBe("line_util_pressure");
    expect(r.disclosure.tickCount).toBe(6);
    expect(r.disclosure.agentInvolved).toBe(false);
    expect(r.disclosure.elapsedMs.total).toBeGreaterThan(0);
  });

  it("E2-d 反向金丝雀：无绑定 ⇒ gap NO_BINDING，列缺的绑定，⛔ 不返 0", async () => {
    const deps = mkDeps();
    const r = await priceCandidate(deps, mkInput({ specs: SPECS.filter((s) => s.targetType !== "Line") }));
    expect(r.kind).toBe("gap");
    if (r.kind !== "gap") return;
    expect(r.reason).toBe("NO_BINDING");
    expect(r.missingBinding).toEqual({ objectType: "Line", prop: "utilization" });
    expect(r.disclosure.specKey).toBeNull();
  });

  it("落点格不存在 ⇒ gap TARGET_CELL_ABSENT（⛔ 不许造格）", async () => {
    const deps = mkDeps({ readWorldState: async () => ({}) });
    const r = await priceCandidate(deps, mkInput());
    expect(r.kind).toBe("gap");
    if (r.kind !== "gap") return;
    expect(r.reason).toBe("TARGET_CELL_ABSENT");
  });

  it("式子可译但求值失败 ⇒ gap PRESSURE_TARGET_UNCOMPUTABLE", async () => {
    const deps = mkDeps();
    const r = await priceCandidate(deps, mkInput({ specs: [mkSpec({ formula: "this.utilization +" })] }));
    expect(r.kind).toBe("gap");
    if (r.kind !== "gap") return;
    expect(r.reason).toBe("PRESSURE_TARGET_UNCOMPUTABLE");
  });

  it("有效世界：读数 = diffTickStates(对照, 候选) 口径 + 敞口只加实质受扰单", async () => {
    const deps = mkDeps();
    const r = await priceCandidate(deps, mkInput({ candidate: mkCandidate({ toValue: 89.9153 }) }));
    expect(r.kind).toBe("priced");
    if (r.kind !== "priced") return;
    expect(r.specKey).toBe("line_util_pressure");
    expect(r.perturbation).toEqual({
      targetObjectId: "obj_line_A1",
      targetStateVar: "utilPressure",
      mode: "set",
      magnitude: 89.9153,
    });
    // 候选态 o1:+5 / o2:+0.02 → 实质受扰 2 张；敞口 = 1M + 2M
    expect(r.after.touchedOrders).toBe(2);
    expect(r.after.faintOnly).toBe(0);
    expect(r.after.exposureYuan).toBe(3_000_000);
    expect(r.after.displacement.p50).toBe(5);
    expect(r.after.displacement.p90).toBe(5);
    expect(r.after.displacement.max).toBe(5);
    // 对照读数恒诚实零（diff(对照,对照)）
    expect(r.control.touchedOrders).toBe(0);
    expect(r.control.displacement.p50).toBeNull();
    expect(r.disclosure.targetObjectId).toBe("obj_line_A1");
    expect(r.disclosure.targetStateVar).toBe("utilPressure");
    expect(r.disclosure.agentInvolved).toBe(false);
    expect(r.fingerprint).toHaveLength(64);
  });

  it("E2-g 零写入：对照与候选各一次只读推进（无 persist 旋钮），扰动 mode:set 落点正确", async () => {
    const calls: Array<{ n: number; ephemeral?: readonly Perturbation[] }> = [];
    const deps = mkDeps({
      advanceTicks: async (_sid, opts) => {
        calls.push(opts);
        return { o1: { pressure: 0 } };
      },
    });
    await priceCandidate(deps, mkInput());
    expect(calls).toHaveLength(2);
    expect(calls[0]!.ephemeral).toBeUndefined();
    expect(calls[1]!.ephemeral).toHaveLength(1);
    const pert = calls[1]!.ephemeral![0]!;
    expect(pert.mode).toBe("set");
    expect(pert.targetObjectId).toBe("obj_line_A1");
    expect(pert.targetStateVar).toBe("utilPressure");
    expect(pert.durationTicks).toBeNull();
  });

  it("指纹随输入而变：同一候选不同场景哈希 ⇒ 不同指纹", async () => {
    const deps = mkDeps({
      listPerturbations: async () => [
        { id: "p1", tenantId: "demo", sessionId: "s", kind: "capacity_loss", targetObjectId: "o1", targetStateVar: "x", startTick: 0, durationTicks: null, magnitude: 1, mode: "set", label: "l", createdAt: "2026-01-01T00:00:00Z" },
      ],
    });
    const a = await priceCandidate(deps, mkInput());
    const b = await priceCandidate(mkDeps(), mkInput());
    expect(a.kind).toBe("priced");
    expect(b.kind).toBe("priced");
    if (a.kind !== "priced" || b.kind !== "priced") return;
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});
