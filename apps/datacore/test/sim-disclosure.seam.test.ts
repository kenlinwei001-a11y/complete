/**
 * WO-SIM-DISCLOSURE 接缝门 —— 推演过程披露层（铁律 1.5 判据二）的驱动测试。
 *
 * ⛔ **它咬的是链路不是函数**（SEAM-GATE）：披露层（`sim/disclosure.ts` 的装配）与
 * 引擎（`sim/propagation.ts` 的 `propagateTick`）是两半，任一半漂了本文件就红：
 *  · 披露层的系数镜像与引擎的实际取值分叉 ⇒ §2 红（这是本文件最要紧的一条）；
 *  · 快照指纹掺进了扰动/拍号 ⇒ §3 红（对照实验的基准当场失效）；
 *  · 「命中」读的是规则表而不是本次实际命中集 ⇒ §4 红（反向对照）；
 *  · agent 那一栏退回留白 ⇒ §5 红。
 *
 * ⚠ 断言全部是**对照实验**式（铁律 1.5 判据一）：不是「跑得起来吗」，
 *   是「把 X 改成 X'，Y 必须按可预言的方式变」——
 *   §3 与 §4 各自还带一条**反向**断言（该变的变了，**不该变的一个字节都不许变**）。
 *
 * ⚠ 本文件**一行都不改算法**：它只喂既有引擎、读既有装配。求解器数值零改动。
 */
import { describe, expect, it } from "vitest";
import { propagateTick, PERTURBATION_TRACE_PREFIX } from "../src/sim/propagation.js";
import type { ScopeReport, StateVarDisclosure } from "../src/sim/propagation.js";
import type { PairWeightReport } from "../src/sim/pair-weights.js";
import {
  buildSimRunDisclosure,
  disclosedCoefficient,
  graphSnapshotVersion,
  PhaseTimer,
  DISCLOSURE_PHASE_ORDER,
} from "../src/sim/disclosure.js";
import type { PropagationRule, PropagationTrace, TickState } from "@platform/contracts";

// ══ 夹具 ═══════════════════════════════════════════════════════════════════
/** 一条最小的边：A.demandPressure --l--> B.demandLoad。 */
const rule = (over: Partial<PropagationRule> = {}): PropagationRule => ({
  id: "r1", tenantId: "t", key: "k1",
  sourceTypeKey: "A", sourceStateVar: "demandPressure",
  viaLinkKey: "l", targetTypeKey: "B", targetStateVar: "demandLoad",
  coefficient: 1, delayTicks: 0, combine: "sum",
  decay: null, clamp: null, coefficientRef: null, cadenceNodeId: null, weightRef: null, description: null,
  status: "PUBLISHED", domainKey: null, domainName: null,
  sourceTypeName: null, targetTypeName: null,
  ...over,
});

const graph = {
  objects: [{ id: "a1", typeKey: "A" }, { id: "b1", typeKey: "B" }],
  links: [{ fromId: "a1", toId: "b1", linkKey: "l" }],
};
/** 源恒 1 ⇒ 贡献额 = 系数本身（这样 §2 才能把「引擎用的系数」直接读出来）。 */
const state0: TickState = { a1: { demandPressure: 1 }, b1: { demandLoad: 0 } };

const scope: ScopeReport = {
  kind: "GLOBAL", target: null, hops: 1,
  objects: graph.objects.length, links: graph.links.length,
  droppedObjects: 0, droppedLinks: 0, unresolved: null,
};
const emptyWeights: PairWeightReport = { pairs: [], unresolved: [] };
const emptyStateVarReport: StateVarDisclosure = {
  declaredStateVars: [], undeclaredStateVars: [], decayUnresolved: [],
  saturations: [], decayApplied: {},
};

/** 装配一次披露层。只有被测的那几项由用例给，其余走空。 */
function build(over: Partial<Parameters<typeof buildSimRunDisclosure>[0]> = {}) {
  return buildSimRunDisclosure({
    fromTick: 0, toTick: 1,
    graph, scopeReport: scope,
    rules: [rule()], firedRuleKeys: [], trace: null,
    ruleParams: {}, ruleExpressions: {},
    pairWeightReport: emptyWeights, unresolvedWeights: [],
    cadenceGates: {}, cadenceSkipped: [], unresolvedGates: [],
    stateVarDomains: {}, stateVarReport: emptyStateVarReport,
    timings: [],
    ...over,
  });
}

// ══ §1 · 六项一项都不许缺 ═══════════════════════════════════════════════════
describe("§1 六项齐全（铁律 1.5 判据二逐项）", () => {
  it("引用的数据 / 切片 / 命中规则 / 约束 / agent / 耗时 —— 六个键都在", () => {
    const d = build();
    // 金丝雀：先证明这个断言方式抓得住缺项 —— 一个不存在的键必须读作 undefined。
    expect((d as unknown as Record<string, unknown>)["没有这一项"]).toBeUndefined();
    for (const k of ["data", "slice", "rules", "constraints", "agent", "timings"]) {
      expect(d, `披露层缺了「${k}」这一项`).toHaveProperty(k);
    }
  });

  it("切片键由契约的唯一构造处拼，前后端不许各拼各的", () => {
    expect(build().slice.sliceKey).toBe("GLOBAL");
    const local = build({
      scopeReport: { ...scope, kind: "LOCAL", target: "Model" },
    });
    expect(local.slice.sliceKey).toBe("LOCAL:Model");
    // 范围拿不到 ⇒ 键上必须带记号，**不许**与「局部解析成功」长成同一个串。
    const bad = build({
      scopeReport: { ...scope, kind: "LOCAL", target: "Model", unresolved: "查无此类型" },
    });
    expect(bad.slice.sliceKey).toBe("LOCAL:Model!unresolved");
    expect(bad.slice.unresolved).toBe("查无此类型");
  });
});

// ══ §2 · 系数镜像 == 引擎实际用的那个数（本文件最要紧的一条）══════════════════
//
// `disclosure.ts` 的 `disclosedCoefficient` 是 `propagation.ts` 私有函数
// `effectiveCoefficient` 的**镜像**。镜像与本体分叉时，屏上会用一个引擎根本没用过的数
// 去解释引擎的输出 —— 那比不披露更坏。这一节把两者钉死。
describe("§2 系数来源按**解析结果**判，不是按**声明**判", () => {
  /** 跑一拍，返回引擎真正落下的那笔贡献额。源值恒 1 ⇒ 贡献额 == 有效系数。 */
  const engineAmount = (r: PropagationRule, params: Record<string, Record<string, unknown>> = {}) => {
    const out = propagateTick(graph, state0, [r], [], 0, params as never, {}, [], {}, {});
    const t = out.trace.filter((x: PropagationTrace) => !x.ruleKey.startsWith(PERTURBATION_TRACE_PREFIX));
    expect(t.length, "这一拍应当恰好落一笔传导贡献").toBe(1);
    return t[0]!.amount;
  };

  it("没声明引用 ⇒ INLINE，且镜像的数 == 引擎落的数", () => {
    const r = rule({ coefficient: 0.35 });
    const m = disclosedCoefficient(r, {});
    expect(m).toMatchObject({ source: "INLINE", ref: null, refUnresolved: false, coefficient: 0.35 });
    expect(engineAmount(r)).toBeCloseTo(m.coefficient, 10);
  });

  it("声明了引用且取得到 ⇒ CONFIG_REF，且镜像的数 == 引擎落的数（内联那个数被顶掉）", () => {
    const r = rule({ coefficient: 0.35, coefficientRef: { ruleKey: "C1", paramKey: "k" } });
    const params = { C1: { k: 0.8 } };
    const m = disclosedCoefficient(r, params as never);
    expect(m).toMatchObject({ source: "CONFIG_REF", ref: "C1.k", refUnresolved: false, coefficient: 0.8 });
    // 对照实验：把 0.8 换成 0.2，引擎与镜像必须**一起**变到 0.2。
    const m2 = disclosedCoefficient(r, { C1: { k: 0.2 } } as never);
    expect(m2.coefficient).toBe(0.2);
    expect(engineAmount(r, params)).toBeCloseTo(0.8, 10);
    expect(engineAmount(r, { C1: { k: 0.2 } })).toBeCloseTo(0.2, 10);
  });

  it("⛔ 声明了引用但取不到 ⇒ 必须报 INLINE + refUnresolved，**不许**报 CONFIG_REF", () => {
    // 这一档就是 `pair-weights.ts` 那句 `rule.coefficientRef ? "CONFIG_REF" : "INLINE"` 会答错的地方：
    // 它把「声明了引用」当成「系数来自配置」的证据，而引擎此时**回落用了内联那个数**。
    const r = rule({ coefficient: 0.35, coefficientRef: { ruleKey: "C1", paramKey: "缺这个键" } });
    const m = disclosedCoefficient(r, { C1: { k: 0.8 } } as never);
    expect(m.source, "引用取不到时说成 CONFIG_REF 就是替引擎编了一个出处").toBe("INLINE");
    expect(m.refUnresolved).toBe(true);
    expect(m.ref, "声明过的那个引用要留在屏上——「压根没声明」与「声明了但坏了」是两件事").toBe("C1.缺这个键");
    expect(m.coefficient).toBe(0.35);
    // 引擎确实回落到内联：镜像说的就是引擎做的。
    expect(engineAmount(r, { C1: { k: 0.8 } })).toBeCloseTo(0.35, 10);
  });

  it("装配层把这三档如实汇总（withCoefficientRef 数的是声明数，refUnresolved 数的是坏掉的）", () => {
    const d = build({
      rules: [
        rule({ key: "inline", coefficient: 0.5 }),
        rule({ key: "ok", id: "r2", coefficient: 0.5, coefficientRef: { ruleKey: "C1", paramKey: "k" } }),
        rule({ key: "broken", id: "r3", coefficient: 0.5, coefficientRef: { ruleKey: "C1", paramKey: "无" } }),
      ],
      ruleParams: { C1: { k: 0.9 } } as never,
    });
    expect(d.rules.declared).toBe(3);
    expect(d.rules.withCoefficientRef).toBe(2); // 声明了引用的有两条
    expect(d.rules.refUnresolved).toBe(1); // 其中一条坏了、已回落内联
    const byKey = Object.fromEntries(d.rules.items.map((i) => [i.ruleKey, i]));
    expect(byKey["ok"]!.coefficientSource).toBe("CONFIG_REF");
    expect(byKey["ok"]!.coefficient).toBe(0.9);
    expect(byKey["broken"]!.coefficientSource).toBe("INLINE");
    expect(byKey["broken"]!.coefficient).toBe(0.5);
  });
});

// ══ §3 · 快照版本：同图恒同，异图必异（对照实验的基准）════════════════════════
describe("§3 数据快照版本只咬数据本身", () => {
  it("同一张图 ⇒ 同一个版本串（与遍历序无关）", () => {
    const shuffled = {
      objects: [...graph.objects].reverse(),
      links: [...graph.links],
    };
    expect(graphSnapshotVersion(shuffled)).toBe(graphSnapshotVersion(graph));
  });

  it("⛔ 换扰动 / 换拍号，版本串**一个字节都不许变**", () => {
    // 铁律 1.5 的对照实验判据原文：「换一个扰动再跑一次，**引用的数据快照版本必须不变**」。
    // 版本串若掺了扰动或拍号，那条判据当场失效 —— 这里就是它的落点。
    const a = build({ fromTick: 0, toTick: 1, trace: [] });
    const b = build({
      fromTick: 7, toTick: 8,
      trace: [{ ruleKey: `${PERTURBATION_TRACE_PREFIX}p1` } as unknown as PropagationTrace],
    });
    expect(b.data.snapshotVersion).toBe(a.data.snapshotVersion);
  });

  it("图真的变了 ⇒ 版本串必须变（否则它度量不了任何东西）", () => {
    const bigger = {
      objects: [...graph.objects, { id: "c1", typeKey: "C" }],
      links: [...graph.links],
    };
    expect(graphSnapshotVersion(bigger)).not.toBe(graphSnapshotVersion(graph));
  });
});

// ══ §4 · 「命中」读的是本次实际命中集，不是规则表 ═══════════════════════════
describe("§4 命中集 = 引擎这一跑的回执（反向对照）", () => {
  it("规则在表里但这一拍没产出贡献 ⇒ fired 必须是 false", () => {
    const d = build({ rules: [rule({ key: "k1" })], firedRuleKeys: [] });
    expect(d.rules.declared).toBe(1);
    expect(d.rules.fired, "规则都在、谁都没动 —— 这两件事必须分得开").toBe(0);
    expect(d.rules.items[0]!.fired).toBe(false);
  });

  it("⛔ 停用一条规则再跑 ⇒ 它必须从命中集里消失（仍列着 = 读的是规则表）", () => {
    const two = [rule({ key: "k1" }), rule({ key: "k2", id: "r2" })];
    const before = build({ rules: two, firedRuleKeys: ["k1", "k2"] });
    expect(before.rules.fired).toBe(2);
    expect(before.rules.items.filter((i) => i.fired).map((i) => i.ruleKey).sort()).toEqual(["k1", "k2"]);
    // 停用 k2：喂进引擎的规则少一条，命中集也必须少一条。
    const after = build({ rules: [rule({ key: "k1" })], firedRuleKeys: ["k1"] });
    expect(after.rules.declared).toBe(1);
    expect(after.rules.fired).toBe(1);
    expect(after.rules.items.map((i) => i.ruleKey)).not.toContain("k2");
  });

  it("⛔ 「本拍传导条数」与「图有几条边」是两个量，不许互相顶替", () => {
    // `slice.edges` 是图有多少条边（范围一定就固定），换扰动重跑一个字节不变；
    // `contributions` 才是"这一拍沿几条边传了值"。拿前者当后者用，
    // 披露层会在两次不同的跑之间给出一模一样的读数 —— 那正是「写死的展示」。
    const t = (k: string): PropagationTrace => ({ ruleKey: k } as unknown as PropagationTrace);
    const quiet = build({ trace: [] });
    const busy = build({ trace: [t("k1"), t("k1"), t(`${PERTURBATION_TRACE_PREFIX}p1`)] });
    expect(quiet.slice.edges).toBe(busy.slice.edges); // 图没变
    expect(quiet.rules.contributions).toBe(0);
    expect(busy.rules.contributions, "扰动自己写的那行不算传导").toBe(2);
    expect(busy.rules.perturbationWrites).toBe(1);
  });
});

// ══ §5 · agent 那一栏不许留白 ══════════════════════════════════════════════
describe("§5 agent 是否参与 —— 恒写，不留白", () => {
  it("推演路零 LLM ⇒ 明写未调用，且 calls/provider/model 都在", () => {
    const a = build().agent;
    expect(a.invoked).toBe(false);
    expect(a.calls).toBe(0);
    // `undefined` 会在屏上被渲染成"什么都没有"，与"没调用"读起来一样 —— 必须是 null 不是缺席。
    expect(a.provider).toBeNull();
    expect(a.model).toBeNull();
    expect(Object.keys(a).sort()).toEqual(["calls", "invoked", "model", "provider"]);
  });
});

// ══ §6 · 逐环节耗时 ════════════════════════════════════════════════════════
describe("§6 各环节耗时", () => {
  it("按固定环节序输出，合计恒排最后", () => {
    let now = 0;
    const timer = new PhaseTimer(() => now);
    const stopTotal = timer.start("total");
    const g = timer.start("graph"); now += 5; g();
    const e = timer.start("engine"); now += 3; e();
    stopTotal();
    const out = timer.timings(DISCLOSURE_PHASE_ORDER);
    expect(out.map((t) => t.phase)).toEqual(["graph", "engine", "total"]);
    expect(out.find((t) => t.phase === "graph")!.ms).toBe(5);
    expect(out.find((t) => t.phase === "total")!.ms).toBe(8);
  });

  it("同名环节累加（多拍循环里传导会 mark 多次），忘了停的不记成 0", () => {
    let now = 0;
    const timer = new PhaseTimer(() => now);
    const a = timer.start("engine"); now += 2; a();
    const b = timer.start("engine"); now += 3; b();
    timer.start("persist"); // 故意不停
    const out = timer.timings(DISCLOSURE_PHASE_ORDER);
    expect(out.find((t) => t.phase === "engine")!.ms).toBe(5);
    expect(out.find((t) => t.phase === "persist"), "没停表的环节不该冒充一个 0 毫秒的读数").toBeUndefined();
  });
});
