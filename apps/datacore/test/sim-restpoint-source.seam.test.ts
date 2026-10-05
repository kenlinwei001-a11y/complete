import { describe, expect, it } from "vitest";
import { PropagationRuleSchema, type PropagationRule, type TickState } from "@platform/contracts";
import {
  propagateTick,
  type PropagationGraph,
  type StateVarDomainLookup,
} from "../src/sim/propagation.js";

/**
 * WO-RESTPOINT-SOURCE-B · **传导核的驱动量是「偏离」，不是「水平」**（SEAM：核 × 静息点来源）。
 *
 * ══ 病灶：今天的行为是 X，应该是 Y ═══════════════════════════════════════════════
 *
 * **X（改前）**：`drive = sourceVal` —— 源读数**整值**当流量。于是一个停在 90.38 的源，
 * 每拍往下游灌 `系数 × 90.38`；**零扰动的世界照样一路漂**（实测：`Customer.receivablePressure`
 * 唯一入边来自 `Order.costPressure`（系数 0.5），源三拍只动了 8.6%，目标却翻了 4 倍，
 * 每拍注入 ≈ 0.5 × 90.38 ≈ 45.2）。本体 §2.I 不变量 ③ 早已写死 `x* = rest + 流入/λ`
 * ⇒ **零扰动 ⇒ 流入必须为 0**。这条判据在改前恒假，因为流入里含着源的**水平**。
 *
 * **Y（应该）**：`drive = 源读数 − 源侧静息点`，静息点取该格**在这个世界里的静息值**：
 *   ① `baseSnapshot[objId][sv]`（这个世界 tick0 的基值 —— 零扰动世界里该格恒定于它）
 *   ② `domains[sv].restPoint`（无基值格的兜底）
 *   ③ 两处都没有 ⇒ **不归一的整值直读** + `unresolvedRestPoints` 显式点名（⛔ 绝不 `?? 0`）
 *
 * ══ 本门为什么是 SEAM 而不是纯单测 ══════════════════════════════════════════════
 *
 * 咬的是**两个半边同时成立**：核的新口径（偏离）与**静息点的两个来源**（基值 / 域册子）。
 * 少了任一半，读数就退回"水平"，而读数本身不会报错 —— 这正是本仓点名的静默错答形态。
 * 故 ① 号臂是**金丝雀**：同一个探针必须能在同一张图上**读出两种口径的差**（水平 5 / 偏离 0），
 * 否则下面每一条"偏离=0"都可能只是探针坏了（铁律：否定结论前必须先跑必然命中的对照）。
 *
 * 行业无关（R14）：全部抽象 typeKey/stateVar/linkKey，零电池/供应链实体名。
 */

// 抽象图：a(TypeA) --FEEDS--> b(TypeB)。零行业语义（与 `sim-propagation.test.ts` 同一形状）。
const GRAPH: PropagationGraph = {
  objects: [
    { id: "a", typeKey: "TypeA" },
    { id: "b", typeKey: "TypeB" },
  ],
  links: [{ fromId: "a", toId: "b", linkKey: "FEEDS" }],
};

const rule = (over: Partial<PropagationRule> = {}): PropagationRule =>
  PropagationRuleSchema.parse({
    id: over.id ?? "pr1",
    tenantId: "t1",
    key: over.key ?? "PR_FEEDS",
    sourceTypeKey: "TypeA",
    sourceStateVar: "risk",
    viaLinkKey: "FEEDS",
    targetTypeKey: "TypeB",
    targetStateVar: "risk",
    coefficient: 0.5,
    delayTicks: 0,
    status: "PUBLISHED",
    ...over,
  });

/** 域册子一条（`StateVarDomain` 是闭形状，给全字段 —— 缺字段会让"未声明"与"声明错"混在一起）。 */
const dom = (restPoint: number): StateVarDomainLookup => ({
  risk: { min: 0, max: 100, restPoint, decayRef: null, unit: "0–100 测试指数", source: "本门自造" },
});

describe("WO-RESTPOINT-SOURCE-B · 源侧静息点（驱动量 = 源读数 − 静息点）", () => {
  // ══════════════════════════════════════════════════════════════════════════
  // 🐤 金丝雀（跑在任何结论之前）：同一个探针必须能分辨两种口径
  // ══════════════════════════════════════════════════════════════════════════
  it("① 🐤 金丝雀：同一张图/同一条规则，探针能读出「水平口径 5」与「偏离口径 0」之差", () => {
    const r = rule({ coefficient: 0.5 });
    // 源停在 10（基值也是 10 = 这个世界里它的静息值）。
    const state: TickState = { a: { risk: 10 } };

    // 甲：旧口径（不喂第 11 位 ⇒ 无基值；域册子也不喂 ⇒ 无兜底）⇒ 整值直读 ⇒ 0.5 × 10 = 5。
    //    这一格**必须非 0** —— 它是本门的"必然命中"对照：它要是也读出 0，
    //    说明坏的是探针（或核整条边都不传了），**不许**据此说"偏离口径生效了"。
    const legacy = propagateTick(GRAPH, state, [r], [], 0);
    expect(legacy.next.b!.risk, "🐤 金丝雀落空：旧口径本该灌入 0.5 × 10 = 5").toBe(5);

    // 乙：新口径（源就在静息点上）⇒ 偏离 0 ⇒ 一格都不动。
    const atRest = propagateTick(GRAPH, state, [r], [], 0, {}, {}, [], {}, {}, { a: { risk: 10 } });
    expect(atRest.next.b?.risk ?? 0, "源在静息点上，流入必须为 0").toBe(0);
    expect(atRest.trace, "偏离为 0 ⇒ 不落 trace").toEqual([]);

    // 两种口径读数不同 ⇒ 本探针有分辨力（下面每条"0"才作数）。
    expect(atRest.next.b?.risk ?? 0).not.toBe(legacy.next.b!.risk);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ② 核级「零扰动 ⇒ 逐拍恒定」（判据①的核内版本）
  // ══════════════════════════════════════════════════════════════════════════
  it("② 零扰动逐拍恒定：4 拍跑下来世界态逐字节不变（含链式上游，不是只看直接目标）", () => {
    // 链 a --FEEDS--> b --FEEDS--> c（同 stateVar/同 linkKey，两条规则）。
    const chain: PropagationGraph = {
      objects: [
        { id: "a", typeKey: "TypeA" },
        { id: "b", typeKey: "TypeB" },
        { id: "c", typeKey: "TypeB" },
      ],
      links: [
        { fromId: "a", toId: "b", linkKey: "FEEDS" },
        { fromId: "b", toId: "c", linkKey: "FEEDS" },
      ],
    };
    const r1 = rule({ coefficient: 0.5 });
    const r2 = rule({ id: "pr2", key: "PR_FEEDS_2", sourceTypeKey: "TypeB", coefficient: 0.5 });
    const base: TickState = { a: { risk: 10 }, b: { risk: 4 } };
    const domains = dom(0); // 域册子声明 restPoint=0 —— 兜底档，本臂靠基值档
    let state: TickState = { a: { risk: 10 }, b: { risk: 4 } };

    let out0 = propagateTick(chain, state, [r1, r2], [], 0, {}, {}, [], {}, domains, base);
    // 🐤 金丝雀：本臂必须先证明"这条链**本来**是会传的" —— 否则"没动"可能只是边不通。
    //    给源加 3（= 偏离静息点 3）⇒ 下游必须按系数真的动起来。
    const moved = propagateTick(chain, { a: { risk: 13 }, b: { risk: 4 } }, [r1, r2], [], 0, {}, {}, [], {}, domains, base);
    expect(moved.next.b!.risk, "🐤 金丝雀：偏离 3 就该灌 0.5×3=1.5（链是通的）").toBeCloseTo(5.5, 12);

    // 世界在静息（a=10、b=4 与基值逐字节相同）⇒ 逐拍恒定。
    for (let t = 0; t < 4; t++) {
      const out = propagateTick(chain, state, [r1, r2], [], t, {}, {}, [], {}, domains, base);
      expect(out.next, `第 ${t} 拍世界动了（零扰动 ⇒ 逐拍恒定）`).toEqual(state);
      expect(out.unresolvedRestPoints, "全部源格都有基值 ⇒ 本拍不该有静息点缺席").toEqual([]);
      state = out.next;
      expect(out0.next).toEqual(state); // 每拍都与第一拍逐字节相同（不是"逐渐稳下来"）
    }
    // 反向金丝雀（证明上面那句 toEqual([]) 不是恒真）：缺基值且域册子也为空 ⇒ 必须点名。
    const unsigned = propagateTick(chain, state, [r1, r2], [], 0);
    expect(unsigned.unresolvedRestPoints.length, "🐤 反向金丝雀：无参照时清单非空").toBeGreaterThan(0);
    void out0;
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ③ 扰动 ⇒ 只灌「偏离」那一份（水平那一截不许再进下游）
  // ══════════════════════════════════════════════════════════════════════════
  it("③ 偏离口径：源 10→13 ⇒ 只灌 0.5×3=1.5；⛔ 不是 0.5×13=6.5（改前的水平口径）", () => {
    const r = rule({ coefficient: 0.5 });
    const base: TickState = { a: { risk: 10 } };
    const out = propagateTick(GRAPH, { a: { risk: 13 } }, [r], [], 0, {}, {}, [], {}, dom(0), base);
    expect(out.next.b!.risk).toBe(1.5);
    expect(out.next.b!.risk, "读到 6.5 就是又把水平灌下去了（本单要治的正是它）").not.toBe(6.5);
    expect(out.trace).toEqual([
      { ruleKey: "PR_FEEDS", fromObjectId: "a", toObjectId: "b", amount: 1.5, viaLinkKey: "FEEDS" },
    ]);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ④ 三档严格线性（判据②的核内版本：偏离口径不许把线性弄坏）
  // ══════════════════════════════════════════════════════════════════════════
  it("④ 三档严格线性：偏离 1 / 3 / 30 ⇒ 0.5 / 1.5 / 15（比值恰为 30.00 与 3.00）", () => {
    const r = rule({ coefficient: 0.5 });
    const base: TickState = { a: { risk: 10 } };
    const at = (d: number) =>
      propagateTick(GRAPH, { a: { risk: 10 + d } }, [r], [], 0, {}, {}, [], {}, dom(0), base).next.b!.risk!;
    const [d1, d3, d30] = [at(1), at(3), at(30)];
    expect([d1, d3, d30]).toEqual([0.5, 1.5, 15]);
    expect(d30 / d1).toBe(30); // 严格 30.00，不是 29.9x
    expect(d3 / d1).toBe(3);
    // ⚠ 水平口径下这三个数是 5.5 / 6.5 / 20 ⇒ 比值 3.63 / 1.18（非线性），
    //    故本臂同时也把"回退到水平口径"钉成红。
    expect([d30 / d1, d3 / d1]).not.toEqual([3.6363636363636362, 1.1818181818181819]);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ⑤ 诚实缺席：静息点取不到 ⇒ 点名 + **不归一的整值直读**，⛔ 不退回 0
  // ══════════════════════════════════════════════════════════════════════════
  it("⑤ 取不到静息点 ⇒ unresolvedRestPoints 点名（含受影响实例数）· 且逐字节同旧（不是悄悄按 0 减）", () => {
    const r = rule({ coefficient: 0.5 });
    const state: TickState = { a: { risk: 10 } };
    // 既不喂基值、也不喂域册子 —— 本仓 20+ 处按位置传 9~10 个实参的调用点就是这个形状。
    const out = propagateTick(GRAPH, state, [r], [], 0);
    expect(out.unresolvedRestPoints).toEqual([
      {
        ruleKey: "PR_FEEDS",
        sourceStateVar: "risk",
        reason: "NO_REFERENCE",
        affectedSourceObjects: 1,
        detail: expect.stringContaining("不退回 0"),
      },
    ]);
    // 🔴 关键：缺参照时**没有做归一**，读数与旧口径逐字节相同（5，不是 10−0 的"看着像修了"）。
    //    ⛔ 若这里变成 10 或其他值，说明核在缺参照时自己编了一个静息点（本单明令禁止）。
    expect(out.next.b!.risk, "缺参照 ⇒ 整值直读（与改前逐字节同）；⛔ 不许拿 0 当静息点").toBe(5);

    // 两处都缺时的**边界**：源读数为 0 的格不产生贡献（旧式早退的等价接管）。
    const zeroSrc = propagateTick(GRAPH, { a: { risk: 0 } }, [r], [], 0);
    expect(zeroSrc.next.b?.risk ?? 0).toBe(0);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ⑥ 兜底档：无基值格退回 domains[].restPoint（与基值档**分开**，次序不许颠倒）
  // ══════════════════════════════════════════════════════════════════════════
  it("⑥ 无基值格 ⇒ 退回域册子的 restPoint（10 − 5 = 5 ⇒ 灌 0.5×5=2.5）；有基值时基值优先", () => {
    const r = rule({ coefficient: 0.5 });
    const state: TickState = { a: { risk: 10 } };
    // 域册子声明 restPoint=5；基值里**没有**这一格 ⇒ 走兜底档。
    const fallback = propagateTick(GRAPH, state, [r], [], 0, {}, {}, [], {}, dom(5), {});
    expect(fallback.next.b!.risk).toBe(2.5);
    expect(fallback.unresolvedRestPoints, "域册子有声明 ⇒ 不算缺席").toEqual([]);

    // 基值档优先：同一份域册子（restPoint=5）、基值说这一格的静息值是 10 ⇒ 偏离 0（基值赢）。
    const baseWins = propagateTick(GRAPH, state, [r], [], 0, {}, {}, [], {}, dom(5), { a: { risk: 10 } });
    expect(baseWins.next.b?.risk ?? 0, "基值档必须优先于域册子兜底档").toBe(0);

    // 域册子声明 restPoint=0（本合同 47 条边的全部情形）⇒ 与旧口径**同一个变量、零额外浮点**。
    const zeroRest = propagateTick(GRAPH, state, [r], [], 0, {}, {}, [], {}, dom(0), {});
    expect(zeroRest.next.b!.risk).toBe(5);
    expect(zeroRest.unresolvedRestPoints).toEqual([]);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ⑦ 还手边：**本单未处置**，逐字节保持原样（读的仍是水平、tolerance 未重算）
  // ══════════════════════════════════════════════════════════════════════════
  it("⑦ 还手边未处置留档：drive = max(0, 源读数 − tolerance) —— 有非零基值也不减基值", () => {
    const r = rule({
      coefficient: 1,
      reaction: { actorTypeKey: "TypeB", tolerance: 4, move: "CUT_ORDER", selectedBy: "RULE_TABLE", selectorRef: null },
    });
    const out = propagateTick(GRAPH, { a: { risk: 10 } }, [r], [], 0, {}, {}, [], {}, dom(0), { a: { risk: 3 } });
    // 水平口径：10 − 4 = 6（⛔ 不是"偏离 10−3=7 再减 4 = 3"）。
    expect(out.next.b!.risk, "还手边本单未处置：仍按水平 − tolerance").toBe(6);
    // 未越过容忍线 ⇒ 不还手（同一支上的既有语义，别被本轮改动带走）。
    const under = propagateTick(GRAPH, { a: { risk: 3 } }, [r], [], 0, {}, {}, [], {}, dom(0), { a: { risk: 3 } });
    expect(under.next.b?.risk ?? 0).toBe(0);
  });
});
