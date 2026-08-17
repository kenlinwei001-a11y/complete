import { describe, expect, it } from "vitest";
import { PropagationRuleSchema, type DelayedContribution, type PropagationRule, type TickState } from "@platform/contracts";
import { propagateTick, type PropagationGraph, type RuleParamLookup } from "../src/sim/propagation.js";

/**
 * 传导核 propagateTick 单测（SPEC §1 · 增量 3）。
 *
 * 行业无关（R14）：全部用抽象 typeKey/stateVar/linkKey（TypeA.risk --FEEDS--> TypeB.risk），
 * 零电池/供应链/医疗实体名。验：①单 tick 传导贡献正确 ②改 coefficient → 输出随之变
 * ③delayTicks=2 → 贡献延迟到达 ④确定性 R6（同输入两次 toEqual）⑤Temporal Trust（不读未来）
 * ⑥系数引用 rule.params（改 param 即改果）。
 */

// 抽象图：a(TypeA) --FEEDS--> b(TypeB)。零行业语义。
const GRAPH: PropagationGraph = {
  objects: [
    { id: "a", typeKey: "TypeA" },
    { id: "b", typeKey: "TypeB" },
  ],
  links: [{ fromId: "a", toId: "b", linkKey: "FEEDS" }],
};
const BASE: TickState = { a: { risk: 10 }, b: { risk: 0 } };

const rule = (over: Partial<PropagationRule>): PropagationRule =>
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

describe("传导核 propagateTick（SPEC §1 · 行业无关 R14）", () => {
  it("① 单 tick 传导贡献正确：amount = coefficient × source 状态", () => {
    const r = rule({ coefficient: 0.5 });
    const { next, trace } = propagateTick(GRAPH, BASE, [r], [], 0);
    // b.risk += 0.5 × a.risk(10) = 5；a 不变（源态只读）。
    expect(next.b!.risk).toBe(5);
    expect(next.a!.risk).toBe(10);
    expect(trace).toEqual([
      { ruleKey: "PR_FEEDS", fromObjectId: "a", toObjectId: "b", amount: 5, viaLinkKey: "FEEDS" },
    ]);
  });

  it("② 改 coefficient → 输出随之变（配置驱动·改系数即改果）", () => {
    const out1 = propagateTick(GRAPH, BASE, [rule({ coefficient: 0.5 })], [], 0);
    const out2 = propagateTick(GRAPH, BASE, [rule({ coefficient: 0.9 })], [], 0);
    expect(out1.next.b!.risk).toBe(5);
    expect(out2.next.b!.risk).toBe(9);
    expect(out2.next.b!.risk).not.toBe(out1.next.b!.risk);
  });

  it("③ delayTicks=2 → 贡献排进 pending，延迟 2 tick 到达（不在当前 tick 落地）", () => {
    const r = rule({ coefficient: 0.5, delayTicks: 2 });
    // tick0：computes 贡献 amount=5，arriveTick=0+2=2 排进 pending；b 当前不变。
    const t0 = propagateTick(GRAPH, BASE, [r], [], 0);
    expect(t0.next.b!.risk).toBe(0); // 延迟未到
    expect(t0.pending).toEqual([
      { arriveTick: 2, targetObjectId: "b", targetStateVar: "risk", amount: 5, ruleKey: "PR_FEEDS" },
    ]);
    // tick1：arriveTick===1 无 → 仍不落地（又排一条 arriveTick=3）。
    const t1 = propagateTick(GRAPH, t0.next, [r], t0.pending, 1);
    expect(t1.next.b!.risk).toBe(0);
    // tick2：arriveTick===2 结算 → b.risk += 5 到达。
    const t2 = propagateTick(GRAPH, t1.next, [r], t1.pending, 2);
    expect(t2.next.b!.risk).toBe(5);
  });

  it("④ 确定性 R6：同输入两次 toEqual（字节一致）", () => {
    const rules = [rule({ key: "PR_A", coefficient: 0.3 }), rule({ id: "pr2", key: "PR_B", coefficient: 0.7, delayTicks: 1 })];
    const pending: DelayedContribution[] = [{ arriveTick: 0, targetObjectId: "b", targetStateVar: "risk", amount: 1, ruleKey: "X" }];
    const a = propagateTick(GRAPH, BASE, rules, pending, 0);
    const b = propagateTick(GRAPH, BASE, rules, pending, 0);
    expect(a).toEqual(b);
  });

  it("⑤ Temporal Trust：tick t 只读 ≤t 态——源态在 next 上的同 tick 变化不回灌进本 tick 计算", () => {
    // 链 a --FEEDS--> b --FEEDS--> c（同一 linkKey/stateVar），两条规则同 tick：
    //   r1: a→b（coef 1），r2: b→c（coef 1）。若读未来，c 会拿到 b 的新值(10)；
    //   时间信任下 c 只读本 tick 的 b(=0) → c 贡献 0。
    const graph: PropagationGraph = {
      objects: [
        { id: "a", typeKey: "TypeA" },
        { id: "b", typeKey: "TypeB" },
        { id: "c", typeKey: "TypeC" },
      ],
      links: [
        { fromId: "a", toId: "b", linkKey: "FEEDS" },
        { fromId: "b", toId: "c", linkKey: "FEEDS" },
      ],
    };
    const base: TickState = { a: { risk: 10 }, b: { risk: 0 }, c: { risk: 0 } };
    const r1 = rule({ id: "pr1", key: "PR_AB", sourceTypeKey: "TypeA", targetTypeKey: "TypeB", coefficient: 1 });
    const r2 = rule({ id: "pr2", key: "PR_BC", sourceTypeKey: "TypeB", targetTypeKey: "TypeC", coefficient: 1 });
    const { next } = propagateTick(graph, base, [r1, r2], [], 0);
    expect(next.b!.risk).toBe(10); // a→b 本 tick 生效
    expect(next.c!.risk).toBe(0); // b→c 读的是本 tick 的 b(=0)，绝不读 b 的未来值(10)
  });

  it("⑥ 系数引用 rule.params（coefficientRef）：改 param 即改果（G-10 P1）", () => {
    const r = rule({ coefficient: 0.5, coefficientRef: { ruleKey: "R_THRESH", paramKey: "feedCoeff" } });
    const params1: RuleParamLookup = { R_THRESH: { feedCoeff: 0.2 } };
    const params2: RuleParamLookup = { R_THRESH: { feedCoeff: 0.8 } };
    const out1 = propagateTick(GRAPH, BASE, [r], [], 0, params1);
    const out2 = propagateTick(GRAPH, BASE, [r], [], 0, params2);
    expect(out1.next.b!.risk).toBe(2); // 0.2 × 10（引用优先于内联 0.5）
    expect(out2.next.b!.risk).toBe(8); // 0.8 × 10（改 param 即改果）
    // 引用缺失 → 退回内联 coefficient(0.5)。
    const outFallback = propagateTick(GRAPH, BASE, [r], [], 0, {});
    expect(outFallback.next.b!.risk).toBe(5);
  });

  it("combine=max：多入边取最大而非累加（确定性）", () => {
    const graph: PropagationGraph = {
      objects: [
        { id: "a1", typeKey: "TypeA" },
        { id: "a2", typeKey: "TypeA" },
        { id: "b", typeKey: "TypeB" },
      ],
      links: [
        { fromId: "a1", toId: "b", linkKey: "FEEDS" },
        { fromId: "a2", toId: "b", linkKey: "FEEDS" },
      ],
    };
    const base: TickState = { a1: { risk: 10 }, a2: { risk: 4 }, b: { risk: 0 } };
    const r = rule({ coefficient: 1, combine: "max" });
    const { next } = propagateTick(graph, base, [r], [], 0);
    expect(next.b!.risk).toBe(10); // max(10,4) 而非 sum(14)
  });

  it("clamp：贡献后夹到 [min,max]", () => {
    const r = rule({ coefficient: 10, clamp: { min: 0, max: 50 } });
    const { next } = propagateTick(GRAPH, BASE, [r], [], 0);
    expect(next.b!.risk).toBe(50); // 10×10=100 → clamp 50
  });

  it("decay：衰减系数 amp×(1−dist/den)，dist=1", () => {
    const r = rule({ coefficient: 1, decay: { window: 3, den: 2 } });
    const { next } = propagateTick(GRAPH, BASE, [r], [], 0);
    // factor = 1 − 1/2 = 0.5 → 0.5 × 10 = 5。
    expect(next.b!.risk).toBe(5);
  });
});
