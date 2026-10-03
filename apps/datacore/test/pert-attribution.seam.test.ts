/**
 * WO-PERT-ATTRIBUTION 接缝门 —— 「逐条边际」这条账的驱动测试。
 *
 * 它咬的是**链路不是函数**：`propagateTick` 有八个相位在改值（扰动落地/回退 · 撤销重施 ·
 * 衰减 · 延迟到货 · 规则落贡献 · clamp · 重施加 · 饱和），归因影子必须**逐处镜像**。
 * 漏任何一处，屏上得到的都是一个**看着合理但是错的**逐条边际 —— 比不披露更坏。
 * 故本文件的价值不在 §1（顺手就能绿），在：
 *  · **§2 反向金丝雀** —— 无扰动时整张表必须**为空**（⛔ 不是"一张全是 0 的表"）；
 *  · **§5 延迟跳** —— 专咬 `DelayedContribution` **刻意不记 `fromObjectId`** 这个结构事实；
 *  · **§6 误差判据** —— 归因之和必须等于「扰动世界 − 对照世界」，逐格、逐拍；
 *  · **§7/§8 clamp 与饱和** —— 值被压缩时归因必须**同比例**缩；
 *  · **§9 还手边** —— hinge 的承接上限，少了它就是**整整翻一倍**的错账。
 *
 * ⚠ 断言一律走**对照实验**（铁律 1.5 判据一）：不是"跑得起来吗"，
 *   是"把 X 改成 X'，Y 必须按某个可预言的方式变"。
 */
import { describe, expect, it } from "vitest";
import { propagateTick } from "../src/sim/propagation.js";
import type { PropagationRule, TickState } from "@platform/contracts";
import type { PerturbationAttributionJSON, PerturbationInTick } from "../src/sim/propagation.js";

const rule = (over: Partial<PropagationRule> = {}): PropagationRule => ({
  id: "r1", tenantId: "t", key: "k1",
  sourceTypeKey: "A", sourceStateVar: "demandPressure",
  viaLinkKey: "l", targetTypeKey: "B", targetStateVar: "demandLoad",
  coefficient: 1, delayTicks: 0, combine: "sum",
  // `decay` / `clamp` / `coefficientRef` / `cadenceNodeId` / `weightRef` / `description` 在契约上
  // 都是 `.nullable().default(null)` ⇒ **推断出的输出类型里是必填**（`.default()` 只让输入可省）。
  decay: null, clamp: null, coefficientRef: null, cadenceNodeId: null, weightRef: null, description: null,
  status: "PUBLISHED", domainKey: null, domainName: null,
  sourceTypeName: null, targetTypeName: null,
  ...over,
});

const graph = {
  objects: [{ id: "a1", typeKey: "A" }, { id: "b1", typeKey: "B" }],
  links: [{ fromId: "a1", toId: "b1", linkKey: "l" }],
};

/** 源从 **0** 起：对照世界的源恒 0 ⇒ 逐条边际与 trace 金额**同尺**，可直接比对。 */
const state0: TickState = { a1: { demandPressure: 0 }, b1: { demandLoad: 0 } };

/** 一条最小扰动：`a1.demandPressure += magnitude`，`startTick=1` ⇒ `producedTick=1` 即落地，永久。 */
const pert = (over: Partial<PerturbationInTick> = {}): PerturbationInTick => ({
  id: "p1", tenantId: "t", sessionId: "s", kind: "demand_shift",
  targetObjectId: "a1", targetStateVar: "demandPressure",
  startTick: 1, durationTicks: null, magnitude: 20, mode: "delta",
  label: "需求 +20", createdAt: "2026-10-03T00:00:00.000Z",
  ...over,
});

const DECAY_RULE_KEY = "sim-decay";
const DECAY_PARAM_KEY = "lambda";
/** 目标量纲声明了 λ=0.5 的衰减（`decayRef` 指向下面这份 params）。 */
const DECAY_PARAMS = { [DECAY_RULE_KEY]: { [DECAY_PARAM_KEY]: 0.5 } };
const DECAY_DOMAINS = {
  demandLoad: {
    min: 0, max: null, restPoint: 0,
    decayRef: { ruleKey: DECAY_RULE_KEY, paramKey: DECAY_PARAM_KEY },
    unit: "指数", source: "本门自建（只为检验衰减镜像，不是业务口径）",
  },
};

/** 连推 n 拍。`perts` 为空 = **对照世界**（同一套规则与域，只是没有扰动）。 */
function run(
  n: number,
  opts: {
    perts?: PerturbationInTick[];
    rules?: PropagationRule[];
    domains?: Parameters<typeof propagateTick>[9];
    params?: Parameters<typeof propagateTick>[5];
  } = {},
): ReturnType<typeof propagateTick>[] {
  const { perts = [], rules = [rule()], domains = {}, params = {} } = opts;
  let st: TickState = state0;
  let pend: Parameters<typeof propagateTick>[3] = [];
  // 归因影子与 `pending` 一样要**跨拍喂回来** —— 生产侧的同一处置见 `app.ts` 的 `attributionCarry`。
  let attr: PerturbationAttributionJSON | null = null;
  const out: ReturnType<typeof propagateTick>[] = [];
  for (let t = 0; t < n; t++) {
    // 第 8 位 perturbations、第 9 位 pairWeights、第 10 位 domains、第 11 位 priorAttribution。
    const r = propagateTick(graph, st, rules, pend, t, params, {}, perts, {}, domains, attr);
    st = r.next;
    pend = r.pending;
    attr = r.perturbationAttribution;
    out.push(r);
  }
  return out;
}

/** 取一格上某条扰动的归因。不存在 = `undefined` —— 断言必须能分辨「空表」与「归了个 0」。 */
const attrGet = (
  r: ReturnType<typeof propagateTick>,
  objId: string,
  stateVar: string,
  perturbationId: string,
): number | undefined => r.perturbationAttribution[objId]?.[stateVar]?.[perturbationId];

/** 一格归因之和（没有这一格 = 0）。 */
const attrSum = (r: ReturnType<typeof propagateTick>, objId: string, stateVar: string): number =>
  Object.values(r.perturbationAttribution[objId]?.[stateVar] ?? {}).reduce((a, b) => a + b, 0);

describe("WO-PERT-ATTRIBUTION · 一次推演给出逐条边际", () => {
  // ── §0 金丝雀：先证明这套装置**看得见扰动**，否则下面所有"归因对得上"都是空的 ──────
  it("§0 金丝雀 · 扰动世界真的动了，对照世界纹丝不动", () => {
    const withP = run(1, { perts: [pert()] })[0]!;
    const ctrl = run(1)[0]!;
    expect(ctrl.next.b1!.demandLoad).toBe(0);
    expect(withP.next.b1!.demandLoad).toBe(20);
    // 金丝雀不中 ⇒ 装置坏了，下面任何断言都不许信。
    expect(withP.next.b1!.demandLoad).not.toBe(ctrl.next.b1!.demandLoad);
  });

  // ── §1 主判据 ────────────────────────────────────────────────────────────────
  it("§1 落点与一跳下游都记在扰动头上，且与 trace 金额对得上", () => {
    const r = run(1, { perts: [pert()] })[0]!;
    expect(r.perturbationAttribution.a1!.demandPressure).toEqual({ p1: 20 });
    expect(r.perturbationAttribution.b1!.demandLoad).toEqual({ p1: 20 });
    expect(r.trace.find((x) => x.fromObjectId === "a1")!.amount).toBe(20);
  });

  // ── §2 反向金丝雀（本文件的心脏之一）────────────────────────────────────────
  it("§2 无扰动时整张表为空 —— 空 ≠ 一张全是 0 的表", () => {
    const r = run(2)[0]!;
    expect(r.perturbationAttribution).toEqual({});
    // 反面形态：⛔ `{a1:{demandPressure:{p1:0}}}` 会让下游读成「归因了，但它占 0」——
    // 与「这条扰动跟这一格没关系」是两件事，屏上是两行不同的字。
    expect(Object.keys(r.perturbationAttribution)).toHaveLength(0);
  });

  // ── §3 比例金丝雀：改幅度，归因必须按**同一比例**变 ────────────────────────────
  it("§3 幅度 20→40，逐条边际随之翻倍（不是「变大了就算」）", () => {
    const a = run(1, { perts: [pert({ magnitude: 20 })] })[0]!;
    const b = run(1, { perts: [pert({ magnitude: 40 })] })[0]!;
    expect(attrGet(a, "b1", "demandLoad", "p1")).toBe(20);
    expect(attrGet(b, "b1", "demandLoad", "p1")).toBe(40);
  });

  // ── §4 跨拍：落点格恒 == 声明幅度（WO-HOLD-PERTURBATION 的值保证，归因必须同步）──
  it("§4 三拍：落点归因恒为声明幅度，下游按累加器走", () => {
    const rs = run(3, { perts: [pert()] });
    for (const r of rs) expect(r.perturbationAttribution.a1!.demandPressure).toEqual({ p1: 20 });
    expect(rs.map((r) => r.next.b1!.demandLoad)).toEqual([20, 40, 60]);
    expect(rs.map((r) => attrGet(r, "b1", "demandLoad", "p1"))).toEqual([20, 40, 60]);
  });

  // ── §5 延迟跳：专咬「`DelayedContribution` 刻意不记 fromObjectId」────────────
  it("§5 带 delay 的那一跳：归因必须**随 pending 走**，否则到达那拍整段丢掉", () => {
    const rs = run(3, { perts: [pert()], rules: [rule({ delayTicks: 1 })] });
    // tick0：排进队列，随身带着拆解；目标格这一拍**还没到**，不该有归因。
    expect(rs[0]!.pending).toHaveLength(1);
    expect(rs[0]!.pending[0]!.attribution).toEqual({ p1: 20 });
    expect(rs[0]!.perturbationAttribution.b1?.demandLoad).toBeUndefined();
    // tick1：到达。归因若没随 pending 走，这里必然是空 —— 这就是本条的变异反证落点。
    expect(rs[1]!.next.b1!.demandLoad).toBe(20);
    expect(rs[1]!.perturbationAttribution.b1!.demandLoad).toEqual({ p1: 20 });
    expect(rs[2]!.next.b1!.demandLoad).toBe(40);
  });

  // ── §6 误差判据（最强的一条）：逐格逐拍，归因之和 == 扰动世界 − 对照世界 ────────
  it("§6 归因之和 == 「扰动世界 − 对照世界」（逐格逐拍，含衰减）", () => {
    const opts = { domains: DECAY_DOMAINS, params: DECAY_PARAMS };
    const withP = run(3, { ...opts, perts: [pert()] });
    const ctrl = run(3, opts);
    let checked = 0;
    for (let t = 0; t < 3; t++) {
      for (const objId of Object.keys(withP[t]!.next)) {
        for (const [stateVar, v] of Object.entries(withP[t]!.next[objId]!)) {
          if (typeof v !== "number") continue;
          const base = ctrl[t]!.next[objId]?.[stateVar] ?? 0;
          expect(attrSum(withP[t]!, objId, stateVar)).toBeCloseTo(v - (base as number), 9);
          checked++;
        }
      }
    }
    // 金丝雀：真的比过格子（0 格 = 上面那个循环压根没跑，不是"都对得上"）。
    expect(checked).toBeGreaterThan(0);
    // 且这一跑**真的衰减了**，否则本条只验了无衰减那一档。
    expect(Object.keys(withP[0]!.stateVarReport.decayApplied)).toContain("demandLoad");
  });

  // ── §7 clamp：值被压过 ⇒ 归因同比例缩 ────────────────────────────────────────
  it("§7 边 clamp 到 5：归因必须缩到 5，⛔ 不是留着 20", () => {
    const r = run(1, { perts: [pert()], rules: [rule({ clamp: { min: 0, max: 5 } })] })[0]!;
    expect(r.next.b1!.demandLoad).toBe(5);
    expect(r.perturbationAttribution.b1!.demandLoad).toEqual({ p1: 5 });
  });

  // ── §8 饱和：软拐点压过 ⇒ 同样同比例缩（这一处最容易漏）──────────────────────
  it("§8 量纲边界压过之后，归因与压后的值仍然相等", () => {
    const domains = {
      demandLoad: { min: 0, max: 100, restPoint: 0, decayRef: null, unit: "指数", source: "本门自建" },
    };
    const bare = run(1, { perts: [pert({ magnitude: 500 })] })[0]!;
    const sat = run(1, { perts: [pert({ magnitude: 500 })], domains })[0]!;
    expect(bare.next.b1!.demandLoad).toBe(500); // 未声明域 ⇒ 原样穿过
    expect(sat.next.b1!.demandLoad!).toBeLessThan(500); // 声明了域 ⇒ 真的被压过（这一段有牙）
    expect(sat.stateVarReport.saturations.length).toBeGreaterThan(0);
    expect(attrSum(sat, "b1", "demandLoad")).toBeCloseTo(sat.next.b1!.demandLoad!, 9);
  });

  // ── §9 还手边：hinge 的**承接上限**，少了它就是整整翻一倍的错账 ────────────────
  it("§9 还手边（容忍线 10 / 源 +20）：逐条边际是 10，⛔ 不是 20", () => {
    const hinge = rule({
      reaction: { actorTypeKey: "A", tolerance: 10, move: "CUT_ORDER", selectedBy: "RULE_TABLE", selectorRef: null },
    });
    const r = run(1, { perts: [pert({ magnitude: 20 })], rules: [hinge] })[0]!;
    // 先证明这条边**真的只传了 10**（源 20 − 容忍线 10）。
    expect(r.trace.find((x) => x.fromObjectId === "a1")!.amount).toBe(10);
    // 对照世界的源是 0（在容忍线**之下**）⇒ 这一跳的真实边际 = 10 − 0 = 10。
    // ⛔ 按「源格归因占比」无脑摊会得到 20：那等于把「基线涨到容忍线」那一整段
    //    也记到扰动头上 —— 正是本单最怕的那种「看着合理但是错」的数。
    expect(r.perturbationAttribution.b1!.demandLoad).toEqual({ p1: 10 });
  });

  // ── §10 本单存在的理由：屏上分得开「三条扰动里谁起了作用」──────────────────────
  it("§10 两条扰动落在同一格：逐条边际各归各的，而不是合成一个数", () => {
    const r = run(1, { perts: [pert({ id: "p1", magnitude: 20 }), pert({ id: "p2", magnitude: 30 })] })[0]!;
    expect(r.next.a1!.demandPressure).toBe(50);
    expect(r.perturbationAttribution.a1!.demandPressure).toEqual({ p1: 20, p2: 30 });
    expect(r.perturbationAttribution.b1!.demandLoad).toEqual({ p1: 20, p2: 30 });
  });
});
