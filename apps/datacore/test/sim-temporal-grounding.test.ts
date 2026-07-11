import { describe, expect, it } from "vitest";
import { PropagationRuleSchema, type ExogenousFeed, type PropagationRule, type TickState } from "@platform/contracts";
import { propagateTick, type PropagationGraph } from "../src/sim/propagation.js";
import { resolveExogenousFeeds, type FeedResolveSources, type FeedSpec } from "../src/sim/exogenous-feed.js";
import { buildSimSolverContext } from "../src/sim/context-overlay.js";
import { computeHoldConservation, hasInflowRule, holdConservationDim } from "../src/sim/hold-conservation.js";
import type { ObjectInstance } from "../src/domain.js";
import type { SolverContext } from "../src/solvers/types.js";

/**
 * WO-SANDBOX-TEMPORAL-GROUNDING（S6·§3.1–§3.5）真跑单测（KILL-MOCK-RED green→red 牙齿）。
 * 覆盖 acceptance #1（外生真驱动·逐值对）/#2（断真源诚实缺口卡·不假跑）/#3（overlay 真隔离）/
 * #4（hold 守恒逐值对）/#5（约束 clamp+违例）/#7（R6 双跑字节一致）/#8（关闸=v1.1 字节一致）。
 * （#6 回放校验 VALIDATED/NO_HISTORY 属另一 agent §3.6 范围。）
 */

const obj = (id: string, type: string, props: Record<string, unknown>): ObjectInstance =>
  ({ id, tenantId: "t1", type, props, origin: "SYNTHETIC" });

const emptySources = (over: Partial<FeedResolveSources> = {}): FeedResolveSources => ({
  demandSegments: [],
  sopVersions: [],
  purchaseOrders: [],
  maintPlans: [],
  tsSeriesPoints: () => [],
  ...over,
});

const INV_TARGET = { objectType: "Inventory", objectIds: ["inv1"], stateVar: "level" } as const;

describe("S6 §3.1 ExogenousFeed 解析+冻结（真源逐 tick·无真源不合成）", () => {
  it("#1 真 DemandSegment(逐日率+覆盖天数) → 冻结逐 tick 序列 === 真源解出（60 tick 全覆盖）", () => {
    const spec: FeedSpec = { feedKey: "demand", target: INV_TARGET, source: { kind: "demand_segment", segmentKeys: ["s1"] } };
    const seg = obj("dseg1", "DemandSegment", { segId: "s1", dailyP50: 2.5, coverageDays: 60 });
    const { feeds, gaps } = resolveExogenousFeeds([spec], 60, emptySources({ demandSegments: [seg] }));
    expect(gaps).toEqual([]);
    expect(feeds).toHaveLength(1);
    expect(feeds[0].live).toBe(true);
    expect(feeds[0].coverageTicks).toBe(60);
    expect(feeds[0].series).toHaveLength(60);
    expect(feeds[0].series[0]).toEqual({ tick: 0, delta: 2.5 });
    expect(feeds[0].series[59]).toEqual({ tick: 59, delta: 2.5 });
  });

  it("#1 覆盖不足 horizon → 只铺到覆盖处（绝不外推·coverageTicks 据实）", () => {
    const spec: FeedSpec = { feedKey: "demand", target: INV_TARGET, source: { kind: "demand_segment", segmentKeys: ["s1"] } };
    const seg = obj("dseg1", "DemandSegment", { segId: "s1", dailyP50: 3, coverageDays: 30 });
    const { feeds } = resolveExogenousFeeds([spec], 60, emptySources({ demandSegments: [seg] }));
    expect(feeds[0].coverageTicks).toBe(30);
    expect(feeds[0].series).toHaveLength(30); // 30 天覆盖·未硬凑 60（不外推）
  });

  it("#2 删该细分预测（无匹配对象）→ 缺口卡·feed 不生成·不假跑（green→red 自证）", () => {
    const spec: FeedSpec = { feedKey: "demand", target: INV_TARGET, source: { kind: "demand_segment", segmentKeys: ["s1"] } };
    const { feeds, gaps } = resolveExogenousFeeds([spec], 60, emptySources({ demandSegments: [] }));
    expect(feeds).toEqual([]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].gapCode).toBe("EMPTY_DATA");
    expect(gaps[0].detail).toMatch(/未找到/);
  });

  it("#2 仅聚合 p50、无逐日率/覆盖天数声明 → 不铺伪日曲线·据实缺口（绝不合成未来）", () => {
    const spec: FeedSpec = { feedKey: "demand", target: INV_TARGET, source: { kind: "demand_segment", segmentKeys: ["s1"] } };
    const seg = obj("dseg1", "DemandSegment", { segId: "s1", p50: 71 }); // 无 dailyP50/coverageDays
    const { feeds, gaps } = resolveExogenousFeeds([spec], 60, emptySources({ demandSegments: [seg] }));
    expect(feeds).toEqual([]);
    expect(gaps[0].detail).toMatch(/无逐日预测率|不铺伪日曲线/);
  });

  it("#7 R6：同真源同 horizon 双跑字节一致", () => {
    const spec: FeedSpec = { feedKey: "demand", target: INV_TARGET, source: { kind: "demand_segment", segmentKeys: ["s1"] } };
    const seg = obj("dseg1", "DemandSegment", { segId: "s1", dailyP50: 2.5, coverageDays: 10 });
    const a = resolveExogenousFeeds([spec], 10, emptySources({ demandSegments: [seg] }));
    const b = resolveExogenousFeeds([spec], 10, emptySources({ demandSegments: [seg] }));
    expect(a).toEqual(b);
  });

  it("ts_series 真源：A8 真实点(tick+value) → 逐 tick delta（无点则缺口）", () => {
    const spec: FeedSpec = { feedKey: "ts", target: INV_TARGET, source: { kind: "ts_series", seriesKey: "arrivals:inv" } };
    const withPts = resolveExogenousFeeds([spec], 5, emptySources({ tsSeriesPoints: (k) => (k === "arrivals:inv" ? [{ tick: 0, value: 4 }, { tick: 2, value: 6 }] : []) }));
    expect(withPts.feeds[0].series).toEqual([{ tick: 0, delta: 4 }, { tick: 2, delta: 6 }]);
    const noPts = resolveExogenousFeeds([spec], 5, emptySources());
    expect(noPts.feeds).toEqual([]);
    expect(noPts.gaps[0].gapCode).toBe("EMPTY_DATA");
  });
});

describe("S6 §3.2 引擎注入口（feeds 逐 tick 注入·关闸字节一致）", () => {
  const GRAPH: PropagationGraph = { objects: [{ id: "inv1", typeKey: "Inventory" }], links: [] };
  const feed = (delta: number, len: number): ExogenousFeed => ({
    feedKey: "demand", target: { objectType: "Inventory", objectIds: ["inv1"], stateVar: "level" },
    source: { kind: "demand_segment", segmentKeys: ["s1"] },
    series: Array.from({ length: len }, (_, t) => ({ tick: t, delta })), live: true, coverageTicks: len,
  });

  it("#1 逐 tick 轨迹 === 冻结 feed 序列（60 tick 逐值对·证非写死）", () => {
    let state: TickState = { inv1: { level: 100 } };
    const feeds = [feed(2.5, 60)];
    for (let t = 0; t < 60; t++) {
      const out = propagateTick(GRAPH, state, [], [], t, {}, feeds);
      // 本 tick 增量 === 冻结序列 series[t].delta（逐值对）。
      expect(out.next.inv1.level - (state.inv1.level ?? 0)).toBe(2.5);
      state = out.next;
    }
    expect(state.inv1.level).toBe(100 + 2.5 * 60); // 250
  });

  it("#1 改真预测（dailyP50 2.5→3.0）→ 轨迹真变（证读真源非写死）", () => {
    const run = (d: number) => {
      let s: TickState = { inv1: { level: 100 } };
      for (let t = 0; t < 10; t++) s = propagateTick(GRAPH, s, [], [], t, {}, [feed(d, 10)]).next;
      return s.inv1.level;
    };
    expect(run(2.5)).toBe(125);
    expect(run(3.0)).toBe(130);
    expect(run(2.5)).not.toBe(run(3.0));
  });

  it("#8 关闸（feeds 缺省/空）= v1.1 字节一致（next/pending/trace 同）", () => {
    const rule = PropagationRuleSchema.parse({ id: "pr1", tenantId: "t1", key: "PR", sourceTypeKey: "Inventory", sourceStateVar: "level", viaLinkKey: "FEEDS", targetTypeKey: "Inventory", targetStateVar: "level", coefficient: 0.1, delayTicks: 0, status: "PUBLISHED" });
    const base: TickState = { inv1: { level: 100 } };
    const noArg = propagateTick(GRAPH, base, [rule], [], 0); // 6 参（v1.1 调用面）
    const emptyFeeds = propagateTick(GRAPH, base, [rule], [], 0, {}, []); // 显式空 feeds
    expect(emptyFeeds.next).toEqual(noArg.next);
    expect(emptyFeeds.pending).toEqual(noArg.pending);
    expect(emptyFeeds.trace).toEqual(noArg.trace);
    expect(emptyFeeds.constraintViolations).toEqual([]);
  });

  it("#7 R6：feeds 注入双跑字节一致（含 trace 的 feed 来源）", () => {
    const base: TickState = { inv1: { level: 100 } };
    const a = propagateTick(GRAPH, base, [], [], 0, {}, [feed(2.5, 5)]);
    const b = propagateTick(GRAPH, base, [], [], 0, {}, [feed(2.5, 5)]);
    expect(a).toEqual(b);
    // trace 记 feed 来源（R13·feedKey）。
    expect(a.trace).toEqual([{ ruleKey: "feed:demand", fromObjectId: "(exogenous)", toObjectId: "inv1", amount: 2.5, viaLinkKey: "(feed)" }]);
  });
});

describe("S6 §3.5 约束层（bounds clamp + 违例暴露·不静默）", () => {
  it("#5 把库存推负 → clamp 到 0 + trace 记违例（物理不可能轨迹不静默）", () => {
    const graph: PropagationGraph = {
      objects: [{ id: "d1", typeKey: "Demand" }, { id: "inv1", typeKey: "Inventory" }],
      links: [{ fromId: "d1", toId: "inv1", linkKey: "DRAWS" }],
    };
    const rule = PropagationRuleSchema.parse({
      id: "pr_draw", tenantId: "t1", key: "R_DRAW", sourceTypeKey: "Demand", sourceStateVar: "qty",
      viaLinkKey: "DRAWS", targetTypeKey: "Inventory", targetStateVar: "level", coefficient: -1, delayTicks: 0,
      status: "PUBLISHED", bounds: { min: 0 },
    });
    const state: TickState = { d1: { qty: 20 }, inv1: { level: 5 } };
    const out = propagateTick(graph, state, [rule], [], 0);
    expect(out.next.inv1.level).toBe(0); // 5 + (-20) = -15 → clamp 到 0
    expect(out.constraintViolations).toEqual([
      { tick: 0, objectId: "inv1", stateVar: "level", raw: -15, clamped: 0, boundRef: "R_DRAW" },
    ]);
  });

  it("#5 未越界 → 无违例（bounds 只在真越界时报·不误报）", () => {
    const graph: PropagationGraph = {
      objects: [{ id: "d1", typeKey: "Demand" }, { id: "inv1", typeKey: "Inventory" }],
      links: [{ fromId: "d1", toId: "inv1", linkKey: "DRAWS" }],
    };
    const rule = PropagationRuleSchema.parse({
      id: "pr_draw", tenantId: "t1", key: "R_DRAW", sourceTypeKey: "Demand", sourceStateVar: "qty",
      viaLinkKey: "DRAWS", targetTypeKey: "Inventory", targetStateVar: "level", coefficient: -1, delayTicks: 0,
      status: "PUBLISHED", bounds: { min: 0 },
    });
    const out = propagateTick(graph, { d1: { qty: 3 }, inv1: { level: 100 } }, [rule], [], 0);
    expect(out.next.inv1.level).toBe(97);
    expect(out.constraintViolations).toEqual([]);
  });
});

describe("S6 §3.3 SimContextOverlay（模拟态·基线≠情景·R4 只读不泄漏）", () => {
  it("#3 overlay 覆盖承载对象 props·基线态≠情景态算出不同值·base 不被 mutate", () => {
    const base = { tenantId: "t1", bases: [obj("b1", "Base", { util: 0.5 })] } as unknown as SolverContext;
    const scenario = buildSimSolverContext("t1", { b1: { util: 0.9 } }, base);
    // 一个只读 util 的极简"求解器"：基线 vs 情景算出不同值（证读模拟态）。
    const readUtil = (c: SolverContext) => Number((c.bases[0].props as { util: number }).util);
    expect(readUtil(base)).toBe(0.5); // baseline 态
    expect(readUtil(scenario)).toBe(0.9); // scenario 态
    expect(readUtil(base)).not.toBe(readUtil(scenario));
    // R4：base 上下文对象未被 mutate（overlay 纯只读·不泄漏·不落真值）。
    expect(base.bases[0].props.util).toBe(0.5);
    expect(base.bases).not.toBe(scenario.bases);
  });

  it("#3 未命中 simState 的对象保持真 props（只覆盖命中格）", () => {
    const base = { tenantId: "t1", bases: [obj("b1", "Base", { util: 0.5 }), obj("b2", "Base", { util: 0.6 })] } as unknown as SolverContext;
    const scenario = buildSimSolverContext("t1", { b1: { util: 0.9 } }, base);
    expect(scenario.bases[0].props.util).toBe(0.9);
    expect(scenario.bases[1].props.util).toBe(0.6); // 未命中 → 真值不变
  });
});

describe("S6 §3.4 hold 守恒诚实（sustainingFlow 逐值对·纯政策假设标注）", () => {
  const GRAPH: PropagationGraph = { objects: [{ id: "inv1", typeKey: "Inventory" }], links: [] };
  // 用真引擎跑「不钉」的自然演化（feed 每 tick 抽 -2）得 naturalTrajectory（真轨迹·非手写）。
  const naturalTrajectory = (): number[] => {
    const feed: ExogenousFeed = {
      feedKey: "draw", target: { objectType: "Inventory", objectIds: ["inv1"], stateVar: "level" },
      source: { kind: "demand_segment", segmentKeys: ["s1"] },
      series: Array.from({ length: 5 }, (_, t) => ({ tick: t, delta: -2 })), live: true, coverageTicks: 5,
    };
    let s: TickState = { inv1: { level: 100 } };
    const traj: number[] = [];
    for (let t = 0; t < 5; t++) { s = propagateTick(GRAPH, s, [], [], t, {}, [feed]).next; traj.push(s.inv1.level as number); }
    return traj;
  };

  it("#4 sustainingFlow[i] === pinned − natural[i]（逐值对）·隐含净补/日 === mean", () => {
    const natural = naturalTrajectory(); // [98,96,94,92,90]
    expect(natural).toEqual([98, 96, 94, 92, 90]);
    const inflowRules = [{ targetTypeKey: "Inventory", targetStateVar: "level" }];
    const res = computeHoldConservation({ pinnedValue: 100, naturalTrajectory: natural, hasInflowRule: hasInflowRule(inflowRules, "Inventory", "level") });
    expect(res.sustainingFlow).toEqual([2, 4, 6, 8, 10]); // 100 − natural 逐值对
    expect(res.impliedNetReplenishPerDay).toBe(6); // mean([2,4,6,8,10])
    expect(res.policyAssumptionOnly).toBe(false); // 有流入规则支撑
    const dim = holdConservationDim(res, "trace#1");
    expect(dim.dimKey).toBe("隐含净补/日");
    expect(dim.scenario).toBe(6);
    expect(dim.verdict).toBe("UNFAVORABLE"); // 需净补=维持代价=利空
  });

  it("#4 无流入边的变量 hold → 纯政策假设标注（诚实降级·不禁跑）", () => {
    const res = computeHoldConservation({ pinnedValue: 100, naturalTrajectory: [98, 96], hasInflowRule: hasInflowRule([], "Inventory", "level") });
    expect(res.policyAssumptionOnly).toBe(true);
    expect(res.annotation).toMatch(/纯政策假设/);
    const dim = holdConservationDim(res, "trace#1");
    expect(dim.evidence).toMatch(/纯政策假设/);
  });
});
