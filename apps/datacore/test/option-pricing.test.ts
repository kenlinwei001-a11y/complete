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
 *    落点格缺失 ⇒ gap、E2-g 零写入（deps 接口结构上无 persist 旋钮，基准/对照/候选三次只读推进）、
 *    E2-a 基准锚定（场景在场 ⇒ 对照 = E0）、业务键解析（②③④ 用内部 id，披露说业务键）、
 *    披露六要素（specKey/落点/tick 数/耗时/agentInvolved:false）
 */
import { describe, expect, it } from "vitest";

import type { Perturbation, SimStateDiffCell, SolutionCandidate, TickState } from "@platform/contracts";

import type { DerivationSpecRecord } from "../src/domain.js";
import {
  computePressureTarget,
  findPricingBinding,
  orderDisplacement,
  priceCandidate,
  pricingFingerprint,
  scenarioPerturbationsHash,
  type PricingDeps,
} from "../src/sim/option-pricing.js";

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
    readTickState: async () => ({ o1: { pressure: 0 }, o2: { pressure: 0 } }),
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
    // 基准 ≡ 对照 ≡ 候选（无场景扰动）⇒ 对照读数同样诚实零，不是「没算」
    expect(r.control.touchedOrders).toBe(0);
    expect(r.control.displacement.ordersSeen).toBe(2);
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

  it("有效世界：读数 = diffTickStates(无扰动基准, 候选世界) + 敞口只加实质受扰单", async () => {
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
    // 本夹具无场景扰动：基准 ≡ 对照 = 零态；候选态 o1:+5 / o2:+0.02 → 实质受扰 2 张；敞口 = 1M + 2M
    expect(r.after.touchedOrders).toBe(2);
    expect(r.after.faintOnly).toBe(0);
    expect(r.after.exposureYuan).toBe(3_000_000);
    expect(r.after.displacement.p50).toBe(5);
    expect(r.after.displacement.p90).toBe(5);
    expect(r.after.displacement.max).toBe(5);
    // 对照 = diff(基准, 不处置世界)；本夹具基准 ≡ 对照 ⇒ 诚实零（场景在 E0 口径见 E2-a 用例）
    expect(r.control.touchedOrders).toBe(0);
    expect(r.control.displacement.p50).toBeNull();
    expect(r.disclosure.targetObjectId).toBe("obj_line_A1");
    expect(r.disclosure.targetStateVar).toBe("utilPressure");
    expect(r.disclosure.agentInvolved).toBe(false);
    expect(r.fingerprint).toHaveLength(64);
  });

  it("E2-g 零写入：基准/对照/候选各一次只读推进（无 persist 旋钮），扰动 mode:set 落点正确", async () => {
    const calls: Array<{ n: number; ephemeral?: readonly Perturbation[]; excludeSessionPerturbations?: boolean }> = [];
    const deps = mkDeps({
      advanceTicks: async (_sid, opts) => {
        calls.push(opts);
        return { o1: { pressure: 0 } };
      },
    });
    await priceCandidate(deps, mkInput());
    expect(calls).toHaveLength(3);
    // 第 1 次：裸基准推进（排除会话扰动 = 差分锚点）
    expect(calls[0]!.ephemeral).toBeUndefined();
    expect(calls[0]!.excludeSessionPerturbations).toBe(true);
    // 第 2 次：对照（不处置）—— 会话扰动照常施加，无临时扰动
    expect(calls[1]!.ephemeral).toBeUndefined();
    expect(calls[1]!.excludeSessionPerturbations).toBeUndefined();
    // 第 3 次：候选 —— 会话扰动之上再叠候选扰动
    expect(calls[2]!.ephemeral).toHaveLength(1);
    expect(calls[2]!.excludeSessionPerturbations).toBeUndefined();
    const pert = calls[2]!.ephemeral![0]!;
    expect(pert.mode).toBe("set");
    expect(pert.targetObjectId).toBe("obj_line_A1");
    expect(pert.targetStateVar).toBe("utilPressure");
    expect(pert.durationTicks).toBeNull();
    // 候选推进第一拍生效（curTick+1）—— startTick 0 会让引擎 entersAt 恒 false、扰动从不落地
    expect(pert.startTick).toBe(4);
  });

  it("E2-a 基准锚定：场景扰动在场 ⇒ 基准从锚点重放、对照 = E0 且 Ec ≤ E0（对照不是恒零）", async () => {
    const calls: Array<{
      n: number;
      ephemeral?: readonly Perturbation[];
      excludeSessionPerturbations?: boolean;
      fromState?: TickState;
      fromTick?: number;
    }> = [];
    const anchorState: TickState = { o1: { pressure: 0 }, o2: { pressure: 0 } };
    const deps = mkDeps({
      listPerturbations: async () => [
        { id: "p0", tenantId: "demo", sessionId: "s", kind: "demand_shift", targetObjectId: "o1", targetStateVar: "x", startTick: 1, durationTicks: null, magnitude: 1, mode: "delta", label: "l", createdAt: "2026-01-01T00:00:00Z" },
      ],
      readTickState: async () => anchorState,
      advanceTicks: async (_sid, opts) => {
        calls.push(opts);
        if (opts.excludeSessionPerturbations) return anchorState; // 无场景重放期末：订单零位移
        return opts.ephemeral?.length
          ? { o1: { pressure: 0.009 }, o2: { pressure: 0.02 } } // 候选：补救后残余（o1 已落到地板下）
          : { o1: { pressure: 0.02 }, o2: { pressure: 0.02 } }; // 不处置：场景全量冲击 = E0
      },
    });
    const r = await priceCandidate(deps, mkInput());
    expect(r.kind).toBe("priced");
    if (r.kind !== "priced") return;
    // 基准 = 从锚点（最早 startTick−1 = 0）零扰动重放到对照口径（curTick − anchor + horizon 拍）
    expect(calls).toHaveLength(3);
    expect(calls[0]!.excludeSessionPerturbations).toBe(true);
    expect(calls[0]!.fromTick).toBe(0);
    expect(calls[0]!.fromState).toBe(anchorState);
    expect(calls[0]!.n).toBe(9); // curTick 3 − anchor 0 + horizon 6
    expect(calls[0]!.ephemeral).toBeUndefined();
    // E0 与 Ec 都报出；Ec ≤ E0（§0.2：残余位移对 0.01 地板比较，不是边际 |Δ|）
    expect(r.control.touchedOrders).toBe(2);
    expect(r.control.faintOnly).toBe(0);
    expect(r.control.exposureYuan).toBe(3_000_000);
    expect(r.control.displacement.p50).toBe(0.02);
    expect(r.after.touchedOrders).toBe(1); // o2 仍 0.02；o1 残余 0.009 ≤ 0.01 → faint
    expect(r.after.faintOnly).toBe(1);
    expect(r.after.exposureYuan).toBe(2_000_000);
  });

  it("E2-b′ 剂量对：同杠杆不同档 toValue ⇒ 不同扰动幅度 ⇒ aft 读数逐剂量传递（装配不漏剂量）", async () => {
    const mk = () =>
      mkDeps({
        advanceTicks: async (_sid, opts) =>
          opts.ephemeral?.length
            ? { o1: { pressure: opts.ephemeral[0]!.magnitude }, o2: { pressure: 0 } }
            : { o1: { pressure: 0 }, o2: { pressure: 0 } },
      });
    const r10 = await priceCandidate(mk(), mkInput({ candidate: mkCandidate({ toValue: 10 }) }));
    const r25 = await priceCandidate(mk(), mkInput({ candidate: mkCandidate({ toValue: 25 }) }));
    expect(r10.kind).toBe("priced");
    expect(r25.kind).toBe("priced");
    if (r10.kind !== "priced" || r25.kind !== "priced") return;
    // 同一夹具：扰动幅度 = toValue（formula this.utilization 代入），aft p90 逐剂量传递
    expect(r10.perturbation.magnitude).toBe(10);
    expect(r25.perturbation.magnitude).toBe(25);
    expect(r10.after.displacement.p90).toBe(10);
    expect(r25.after.displacement.p90).toBe(25);
    // 同屏要报的两个数（越线张数 + p90）都在读数里
    expect(r10.after.touchedOrders).toBe(1);
    expect(r25.after.touchedOrders).toBe(1);
  });

  it("E2-b″ 敞口塌缩：候选把残余压到地板下 ⇒ 越线张数从 E0 掉到 0、p90 诚实空", async () => {
    const anchorState: TickState = { o1: { pressure: 0 }, o2: { pressure: 0 } };
    const deps = mkDeps({
      listPerturbations: async () => [
        { id: "p0", tenantId: "demo", sessionId: "s", kind: "demand_shift", targetObjectId: "o1", targetStateVar: "x", startTick: 1, durationTicks: null, magnitude: 1, mode: "delta", label: "l", createdAt: "2026-01-01T00:00:00Z" },
      ],
      readTickState: async () => anchorState,
      advanceTicks: async (_sid, opts) => {
        if (opts.excludeSessionPerturbations) return anchorState;
        return opts.ephemeral?.length
          ? { o1: { pressure: 0.003 }, o2: { pressure: 0.003 } } // 候选：残余压到 0.01 地板下
          : { o1: { pressure: 0.02 }, o2: { pressure: 0.02 } }; // 不处置：E0 两张全越线
      },
    });
    const r = await priceCandidate(deps, mkInput());
    expect(r.kind).toBe("priced");
    if (r.kind !== "priced") return;
    // E0 报出：2 张越线、p90 0.02
    expect(r.control.touchedOrders).toBe(2);
    expect(r.control.displacement.p90).toBe(0.02);
    // 候选把敞口压到 ≈0：越线 2→0 张 + faint 分账 2 张；p90 从 0.02 掉到 0.003（地板下残余，
    // 不是 null —— null 只留给「零移动」，0.003 是「动过但已无越线」的诚实读数）
    expect(r.after.touchedOrders).toBe(0);
    expect(r.after.faintOnly).toBe(2);
    expect(r.after.displacement.p90).toBe(0.003);
    expect(r.after.exposureYuan).toBe(0);
  });

  it("业务键解析：②③④ 用 resolvedObjectId（内部 id）寻址；对外记录与披露仍说业务键", async () => {
    const calls: Array<{ n: number; ephemeral?: readonly Perturbation[]; excludeSessionPerturbations?: boolean }> = [];
    let propsRead = "";
    const deps = mkDeps({
      readWorldState: async () => ({ obj_material_pos_lfp: { shortageRisk: 12 } }),
      readObjectProps: async (objectId) => {
        propsRead = objectId;
        return { leadTime: 26 };
      },
      advanceTicks: async (_sid, opts) => {
        calls.push(opts);
        return { o1: { pressure: 0 } };
      },
    });
    const r = await priceCandidate(
      deps,
      mkInput({
        candidate: mkCandidate({
          lever: { objectType: "Material", objectId: "pos_lfp", prop: "leadTime", unit: "d", valueKind: "number" },
          toValue: 10,
        }),
        resolvedObjectId: "obj_material_pos_lfp",
      }),
    );
    expect(r.kind).toBe("priced");
    if (r.kind !== "priced") return;
    expect(r.specKey).toBe("material_shortage_risk");
    // ② 代入按内部 id 读 props（业务键 "pos_lfp" 在对象库里查不到任何东西）
    expect(propsRead).toBe("obj_material_pos_lfp");
    // ④ 引擎实际寻址的扰动落点 = 内部 id
    const pert = calls[2]!.ephemeral![0]!;
    expect(pert.targetObjectId).toBe("obj_material_pos_lfp");
    expect(pert.targetStateVar).toBe("shortageRisk");
    expect(pert.magnitude).toBeCloseTo(2, 6); // COALESCE(10×2/10, 0)
    // 对外记录 + 披露 = 业务键（人读业务身份；内部 id 是存储细节）
    expect(r.perturbation.targetObjectId).toBe("pos_lfp");
    expect(r.disclosure.targetObjectId).toBe("pos_lfp");
    expect(r.disclosure.specKey).toBe("material_shortage_risk");
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
