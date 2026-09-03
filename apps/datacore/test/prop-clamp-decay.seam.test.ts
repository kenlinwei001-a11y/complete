/**
 * WO-PROP-CLAMP 接缝门 —— 「无衰减无夹值纯积分器」这条账的驱动测试。
 *
 * ⛔ **它咬的是链路不是函数**（SEAM-GATE）：数据侧（`battery.ts` 的 `STATE_VAR_DOMAINS` 声明
 * ＋ `BATTERY_RULES` 的 C35 衰减率）与引擎侧（`propagateTick` 的衰减相 + 保序饱和）
 * 是两半，任一半漏了本文件就红：
 *  · 域声明没接进装配处 ⇒ §1 发散断言红；
 *  · C35 的 λ 拿不到 ⇒ §2 `decayApplied` 红（而不是悄悄按不衰减跑）；
 *  · 饱和退回硬截断 ⇒ §4 保序断言红（这就是本单验收判据 ⑤ 的变异反证落点）。
 *
 * ⚠ 断言全部用**对照实验**式（铁律 1.5 判据一）：不是"跑得起来吗"，
 *    是"把 X 改成 X'，Y 必须按可预言的方式变"。
 */
import { describe, expect, it } from "vitest";
import { propagateTick, saturateToDomain } from "../src/sim/propagation.js";
import { stateVarDomains, STATE_DECAY_RULE_KEY, STATE_DECAY_PARAM_KEY, PRESSURE_DECAY_PER_TICK } from "../src/synthetic/battery.js";
import type { PropagationRule, TickState } from "@platform/contracts";

/** 一条最小的链：A.p --l--> B.p（系数 1，无延迟）。用它复现"纯积分器"这个形态。 */
const rule = (over: Partial<PropagationRule> = {}): PropagationRule => ({
  id: "r1", tenantId: "t", key: "k1",
  sourceTypeKey: "A", sourceStateVar: "demandPressure",
  viaLinkKey: "l", targetTypeKey: "B", targetStateVar: "demandLoad",
  coefficient: 1, delayTicks: 0, combine: "sum",
  // `weightRef`(WO-COEF-FROM-BOM) 与 `description`(WO-ONTOLOGY-EDGE-EDIT · 52e17495) 是本批
  // 另外两单给契约加的字段。两者都是 `.nullable().default(null)` ⇒ **推断出的输出类型里是必填**
  // （zod 的 `.default()` 只让「输入」可省，不让「输出」可省）。本夹具写在那两单之前，
  // 收编时补 null —— 与 b74ebaab 给前端夹具补 weightRef 是同一笔账，不是本单的行为改动。
  decay: null, clamp: null, coefficientRef: null, cadenceNodeId: null, weightRef: null, description: null,
  status: "PUBLISHED", domainKey: null, domainName: null,
  sourceTypeName: null, targetTypeName: null,
  ...over,
});

const graph = {
  objects: [{ id: "a1", typeKey: "A" }, { id: "b1", typeKey: "B" }],
  links: [{ fromId: "a1", toId: "b1", linkKey: "l" }],
};
/** 源恒 50（常量入流），目标从 0 起。 */
const state0: TickState = { a1: { demandPressure: 50 }, b1: { demandLoad: 0 } };
const RULE_PARAMS = { [STATE_DECAY_RULE_KEY]: { [STATE_DECAY_PARAM_KEY]: PRESSURE_DECAY_PER_TICK } };

/** 连推 n 拍，返回每拍 b1.demandLoad。 */
function run(n: number, domains: Record<string, never> | ReturnType<typeof stateVarDomains>, params = RULE_PARAMS) {
  let st = state0;
  let pend: Parameters<typeof propagateTick>[3] = [];
  const out: number[] = [];
  let last: ReturnType<typeof propagateTick> | null = null;
  for (let t = 0; t < n; t++) {
    // 第 9 位是 pairWeights（WO-COEF-FROM-BOM），第 10 位才是 domains —— 收编两单时定的次序。
    // ⚠ 这里**不许再写 `domains as never`**：`never` 对任何形参都可赋值，那个断言会把
    // 「参数传错位置」这类错整类吞掉，正是本仓「假绿」的形态。
    const r = propagateTick(graph, st, [rule()], pend, t, params, {}, [], {}, domains);
    st = r.next; pend = r.pending; last = r;
    out.push(st.b1!.demandLoad!);
  }
  return { series: out, last: last! };
}

describe("WO-PROP-CLAMP · 传导核不再是无衰减无夹值的纯积分器", () => {
  // ── §0 金丝雀：先证明这套装置**测得到**发散，否则下面的"不发散"毫无意义 ──────────
  it("§0 金丝雀 · 不给域声明时，它就是纯积分器（本单的病灶原样复现）", () => {
    const { series } = run(6, {});
    // 常量入流 50、系数 1、无衰减无夹值 ⇒ 严格线性累加 50,100,150,…
    expect(series).toEqual([50, 100, 150, 200, 250, 300]);
    // 金丝雀命中 = 这套装置确实能看见发散。看不见就不许信下面任何一条"没发散"。
    expect(series[5]!).toBeGreaterThan(series[0]! * 5);
  });

  // ── §1 对照实验：同一条链，加上域声明后必须**收敛且留在量纲内** ──────────────────
  it("§1 对照实验 · 声明取值域后，6 拍留在 0–100 内且收敛（不再 O(t^d) 发散）", () => {
    const { series } = run(6, stateVarDomains());
    for (const v of series) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(100); // 保序饱和恒**不达**上界，故用严格小于
    }
    // 收敛判据 = **压缩**：末段的逐拍变化必须显著小于首段。
    // （不写"逐拍单调收窄"—— 起点 0 远离稳态，前几拍会先加速，那是 leaky integrator 的正常暂态，
    //   拿单调性当收敛判据会把一个健康的暂态判成发散。判据要落在"变化在收窄"这件事上。）
    const deltas = series.slice(1).map((v, i) => v - series[i]!);
    expect(Math.abs(deltas.at(-1)!)).toBeLessThan(Math.abs(deltas[0]!));
    // 纯积分器在同样 6 拍上**没有**这个性质：它的增量恒定（50），永不收窄。
    const naiveDeltas = (() => { const s = run(6, {}).series; return s.slice(1).map((v, i) => v - s[i]!); })();
    expect(Math.abs(naiveDeltas.at(-1)!)).toBe(Math.abs(naiveDeltas[0]!));
    // 与 §0 同拍对比：这就是本单要的那个"前后差"
    expect(series[5]!).toBeLessThan(run(6, {}).series[5]!);
  });

  // ── §2 衰减率必须**走引用**拿到（C35），拿不到要诚实报缺而不是悄悄不衰减 ──────────
  it("§2 λ 走 C35 引用；规则参数缺失 ⇒ decayUnresolved 报缺、绝不补默认", () => {
    const ok = run(1, stateVarDomains()).last;
    expect(ok.stateVarReport.decayApplied.demandLoad).toBe(PRESSURE_DECAY_PER_TICK);
    expect(ok.stateVarReport.decayUnresolved).toEqual([]);

    // 变异：把 C35 的参数拿掉 ⇒ 必须报缺，且**不衰减**（回到纯积分器），不许静默兜一个 λ
    const missing = run(1, stateVarDomains(), {} as never).last;
    expect(missing.stateVarReport.decayApplied).toEqual({});
    const names = missing.stateVarReport.decayUnresolved.map((x) => x.stateVar);
    expect(names).toContain("demandLoad");
    expect(missing.stateVarReport.decayUnresolved[0]!.ruleKey).toBe(STATE_DECAY_RULE_KEY);
  });

  // ── §3 未声明的量纲**不许被偷偷夹住**，且必须在回执里有名字 ──────────────────────
  it("§3 未声明取值域的量纲不夹不衰减，但被逐个点名（诚实缺席，不是静默兜底）", () => {
    const d = stateVarDomains();
    expect(d.queueDays).toBeUndefined();     // 天数族：全仓没有第二处出处，故刻意不声明
    expect(d.inspectBacklog).toBeUndefined(); // 件数族：同上
    const { last } = run(1, d);
    expect(last.stateVarReport.declaredStateVars).toContain("demandLoad");
    // 本图上只有 demandPressure/demandLoad 两个量纲，都已声明 ⇒ 未声明表为空但字段必须在
    expect(Array.isArray(last.stateVarReport.undeclaredStateVars)).toBe(true);
  });

  // ── §4 保序饱和：**变异反证**就在这里（判据 ⑤）──────────────────────────────────
  it("§4 饱和必须保序 —— 换成硬截断，本条立刻红", () => {
    // 三个都远超上界的原始值，压回后必须**严格递增**（硬截断会让三者相同 = 引擎被夹死）
    const a = saturateToDomain(150, 0, 100, 0);
    const b = saturateToDomain(1500, 0, 100, 0);
    const c = saturateToDomain(150000, 0, 100, 0);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    // 恒不达上界（否则相邻值会并数，退化成硬截断）
    for (const v of [a, b, c]) { expect(v).toBeLessThan(100); expect(v).toBeGreaterThan(0); }
    // 带内原值不动（未越界的数据一个字节都不许碰）
    expect(saturateToDomain(42, 0, 100, 0)).toBe(42);
    // 🔴 回归钉子：`restPoint === min` 时**下界无压缩带** —— 合法的 0 必须原样是 0。
    //    第一版两侧同带宽，这里返回 12.5，等于给全世界垫了个凭空地板（衰减把万物拉向 0）。
    expect(saturateToDomain(0, 0, 100, 0)).toBe(0);
    expect(saturateToDomain(1, 0, 100, 0)).toBe(1);
    expect(saturateToDomain(-5, 0, 100, 0)).toBe(0); // 真低于下界 ⇒ 硬地板
    // 带方向的量纲（forecastBias 域 −100..100 · 静息点 0）：下侧**有**空间 ⇒ 两侧都保序
    expect(saturateToDomain(0, -100, 100, 0)).toBe(0);
    expect(saturateToDomain(-150, -100, 100, 0)).toBeGreaterThan(-100);
    expect(saturateToDomain(-1500, -100, 100, 0)).toBeLessThan(saturateToDomain(-150, -100, 100, 0));
    // 拐点连续（C¹）：拐点处取值恰为拐点本身，不造折角
    expect(saturateToDomain(75, 0, 100, 0)).toBe(75);
  });

  // ── §5 扰动仍然推得动读数（判据 ④ 金丝雀：夹值不能把引擎夹死）──────────────────
  it("§5 金丝雀 · 深度饱和的格子上，扰动依然按可预言方向改变读数", () => {
    const d = stateVarDomains();
    // 先把 b1 顶到深度饱和（原始值远超 100）
    const hot: TickState = { a1: { demandPressure: 50 }, b1: { demandLoad: 5000 } };
    const base = propagateTick(graph, hot, [rule()], [], 0, RULE_PARAMS, {}, [], {}, d);
    const bumped = propagateTick(
      graph, { a1: { demandPressure: 500 }, b1: { demandLoad: 5000 } }, [rule()], [], 0, RULE_PARAMS, {}, [], {}, d,
    );
    // 源 ×10 ⇒ 目标读数必须**更大**（而不是两者都钉在 100）
    expect(bumped.next.b1!.demandLoad!).toBeGreaterThan(base.next.b1!.demandLoad!);
    expect(bumped.next.b1!.demandLoad!).toBeLessThan(100);
    // 且这次饱和必须被披露，不许静默夹住
    expect(base.stateVarReport.saturations.some((s) => s.objectId === "b1" && s.stateVar === "demandLoad")).toBe(true);
    const ev = base.stateVarReport.saturations.find((s) => s.stateVar === "demandLoad")!;
    expect(ev.raw).toBeGreaterThan(100); // 原始值原样留在回执里，一个字节都不丢
    expect(ev.value).toBeLessThan(100);
    expect(ev.bound).toBe("max");
  });

  // ── §6 RL9 可回退：不给 domains ⇒ 与本单引入前**逐字节相同** ─────────────────────
  it("§6 additive · 不给 domains 时行为与本单引入前逐字节相同", () => {
    const withArg = propagateTick(graph, state0, [rule()], [], 0, {}, {}, [], {}, {});
    const withoutArg = propagateTick(graph, state0, [rule()], [], 0, {}, {});
    expect(withArg.next).toEqual(withoutArg.next);
    expect(withArg.stateVarReport.saturations).toEqual([]);
    expect(withArg.stateVarReport.decayApplied).toEqual({});
  });
});
