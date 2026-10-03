import { describe, expect, it } from "vitest";
import { PropagationRuleSchema, type DelayedContribution, type PropagationRule, type TickState } from "@platform/contracts";
import { pairWeightKey, propagateTick, type PropagationGraph, type RuleParamLookup } from "../src/sim/propagation.js";

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

  // ══════════════════════════════════════════════════════════════════════════
  // § 逐实例分摊权重（WO-COEF-FROM-BOM）—— 引擎侧四条判据
  //
  // 病灶（本组用例存在的理由）：修前一条规则解析出**一个**标量系数，对该源的**每一个**目标
  // 落同一个额 —— 公式里没有任何用量项。于是"占 BOM 成本 17.8% 的正极"与"占 0.9% 的铝箔"
  // 各涨 15%，给出逐字节相同的下游压力。本组咬住修完之后**三种输入各自该有的行为**，
  // 其中第 ③ 条（拿不到表 ⇒ 不传导而非退回 1）是最容易被写错的那一条：
  // 退回 1 会把修前的错行为原样保留，却挂上"已按用量分摊"的名义 —— 比修前更难发现。
  // ══════════════════════════════════════════════════════════════════════════
  describe("逐实例分摊权重 pairWeights", () => {
    /** 一源两目标：a --FEEDS--> b1 / b2。分摊要能让两个目标拿到**不同**的额。 */
    const FAN: PropagationGraph = {
      objects: [
        { id: "a", typeKey: "TypeA" },
        { id: "b1", typeKey: "TypeB" },
        { id: "b2", typeKey: "TypeB" },
      ],
      links: [
        { fromId: "a", toId: "b1", linkKey: "FEEDS" },
        { fromId: "a", toId: "b2", linkKey: "FEEDS" },
      ],
    };
    const FAN_BASE: TickState = { a: { risk: 10 }, b1: { risk: 0 }, b2: { risk: 0 } };

    it("① 修前形态复现：无 weightRef ⇒ 两个目标拿到**逐字节相同**的额（这就是病）", () => {
      const r = rule({ coefficient: 0.5 });
      const { next, unresolvedWeights } = propagateTick(FAN, FAN_BASE, [r], [], 0);
      expect(next.b1!.risk).toBe(5);
      expect(next.b2!.risk).toBe(5);
      expect(next.b1!.risk).toBe(next.b2!.risk); // ← 用量在这里一次都没被读过
      expect(unresolvedWeights).toEqual([]); // 没声明口径 ⇒ 不该报缺
    });

    it("② 声明 weightRef + 给表 ⇒ 逐对分摊，两个目标按份额拉开（amount = 强度 × 份额 × 源态）", () => {
      const r = rule({ coefficient: 0.5, weightRef: { basis: "bom_cost_share" } });
      const { next, trace } = propagateTick(FAN, FAN_BASE, [r], [], 0, {}, {}, [], {
        [r.key]: { [pairWeightKey("a", "b1")]: 0.8, [pairWeightKey("a", "b2")]: 0.2 },
      });
      // 0.5 × 0.8 × 10 = 4 / 0.5 × 0.2 × 10 = 1；两份之和 = 5 = 未分摊时**单个**目标的额。
      expect(next.b1!.risk).toBe(4);
      expect(next.b2!.risk).toBe(1);
      // trace 里落的也必须是**分摊后**的额 —— 否则屏上的溯源与世界态对不上（第二套真相源）。
      expect(trace.map((t) => [t.toObjectId, t.amount])).toEqual([["b1", 4], ["b2", 1]]);
    });

    it("③ 🔴 声明了口径却**整张表都拿不到** ⇒ 该规则不传导 + 显式报缺，**绝不退回 1**", () => {
      const r = rule({ coefficient: 0.5, weightRef: { basis: "bom_cost_share" } });
      // 权重表里没有这条规则（= 该口径所需的本体数据缺失）。
      const { next, trace, unresolvedWeights } = propagateTick(FAN, FAN_BASE, [r], [], 0, {}, {}, [], {});
      // 变异反证：若实现悄悄退回 1，这里会是 5 / 5（正是 ① 那个错行为）——
      // 断言写成"必须是 0 且必须报缺"，两条一起才咬得住。
      expect(next.b1!.risk).toBe(0);
      expect(next.b2!.risk).toBe(0);
      expect(trace).toEqual([]);
      expect(unresolvedWeights).toHaveLength(1);
      expect(unresolvedWeights[0]!.ruleKey).toBe(r.key);
      expect(unresolvedWeights[0]!.basis).toBe("bom_cost_share");
      expect(unresolvedWeights[0]!.reason).toBe("NO_WEIGHTS");
      expect(unresolvedWeights[0]!.detail).toContain("不传导");
    });

    it("④ 表在、但**某一对**查不到 ⇒ 该对份额 0（算得出来的真值），其余对照常传", () => {
      const r = rule({ coefficient: 0.5, weightRef: { basis: "bom_cost_share" } });
      const { next, trace, unresolvedWeights } = propagateTick(FAN, FAN_BASE, [r], [], 0, {}, {}, [], {
        [r.key]: { [pairWeightKey("a", "b1")]: 1 }, // b2 那一对根本不在表里
      });
      expect(next.b1!.risk).toBe(5);
      expect(next.b2!.risk).toBe(0);
      // 份额 0 的对**不落 trace**（等价于这条边今天不通），且这不是"报缺"——它算得出来。
      expect(trace.map((t) => t.toObjectId)).toEqual(["b1"]);
      expect(unresolvedWeights).toEqual([]);
    });

    // ⚠ 本单**两次**把字面 NUL 字节写进了源文件（`propagation.ts` 一次、`pair-weights.ts` 一次）：
    // 想写分隔符 `\u0000` 的**转义序列**，落盘的却是那个字节本身。后果不是编译错误 ——
    // TS 照样编译、测试照样绿，只是 `git diff --stat` 把该文件显示成 `Bin`、`grep` 报
    // 「binary file matches」⇒ 以后任何 grep/审计都会**静默跳过这个文件**。
    // 照铁律 0.6「第二次必须建机制」：这里立一道**机器先说话**的检查，不靠人记得看 diff。
    it("⑥ 源文件不许含字面 NUL 字节（本单犯过两次·grep 会静默跳过二进制文件）", async () => {
      const { readFile } = await import("node:fs/promises");
      const files = ["../src/sim/propagation.ts", "../src/sim/pair-weights.ts"];
      const offenders: string[] = [];
      let scanned = 0;
      for (const f of files) {
        const buf = await readFile(new URL(f, import.meta.url));
        scanned += buf.length;
        if (buf.includes(0)) offenders.push(f);
      }
      // 🐤 金丝雀：真读到内容了（读空文件时"没有 NUL"是句空话）。
      expect(scanned, "两个源文件都读成 0 字节 ⇒ 读取坏了，不是『很干净』").toBeGreaterThan(10000);
      expect(offenders, "这些文件里有字面 NUL 字节；要的是转义序列 \\u0000，不是那个字节本身").toEqual([]);
    });

    it("⑤ R6 确定性：同输入两跑逐字节一致（分摊不引入新的不确定来源）", () => {
      const r = rule({ coefficient: 0.5, weightRef: { basis: "bom_cost_share" } });
      const w = { [r.key]: { [pairWeightKey("a", "b1")]: 1 / 3, [pairWeightKey("a", "b2")]: 2 / 3 } };
      const one = propagateTick(FAN, FAN_BASE, [r], [], 0, {}, {}, [], w);
      const two = propagateTick(FAN, FAN_BASE, [r], [], 0, {}, {}, [], w);
      expect(JSON.stringify(one)).toBe(JSON.stringify(two));
    });
  });
});
