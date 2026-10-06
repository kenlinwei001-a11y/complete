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
import type { Perturbation, PropagationRule, TickState } from "@platform/contracts";
import type { PerturbationInTick } from "../src/sim/propagation.js";

/** 一条最小的链：A.p --l--> B.p（系数 1，无延迟）。用它复现"纯积分器"这个形态。 */
const rule = (over: Partial<PropagationRule> = {}): PropagationRule => ({
  id: "r1", tenantId: "t", key: "k1",
  sourceTypeKey: "A", sourceStateVar: "demandPressure",
  viaLinkKey: "l", targetTypeKey: "B", targetStateVar: "utilPressure",
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
const state0: TickState = { a1: { demandPressure: 50 }, b1: { utilPressure: 0 } };
const RULE_PARAMS = { [STATE_DECAY_RULE_KEY]: { [STATE_DECAY_PARAM_KEY]: PRESSURE_DECAY_PER_TICK } };

/** 连推 n 拍，返回每拍 b1.utilPressure。 */
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
    out.push(st.b1!.utilPressure!);
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
    expect(ok.stateVarReport.decayApplied.utilPressure).toBe(PRESSURE_DECAY_PER_TICK);
    expect(ok.stateVarReport.decayUnresolved).toEqual([]);

    // 变异：把 C35 的参数拿掉 ⇒ 必须报缺，且**不衰减**（回到纯积分器），不许静默兜一个 λ
    const missing = run(1, stateVarDomains(), {} as never).last;
    expect(missing.stateVarReport.decayApplied).toEqual({});
    const names = missing.stateVarReport.decayUnresolved.map((x) => x.stateVar);
    expect(names).toContain("utilPressure");
    expect(missing.stateVarReport.decayUnresolved[0]!.ruleKey).toBe(STATE_DECAY_RULE_KEY);
  });

  // ── §3 未声明的量纲**不许被偷偷夹住**，且必须在回执里有名字 ──────────────────────
  it("§3 未声明取值域的量纲不夹不衰减，但被逐个点名（诚实缺席，不是静默兜底）", () => {
    const d = stateVarDomains();
    // 样本 = 「仍刻意在表外」的量纲，两个的理由各异（2026-09-18 T6 换样：
    // 原样本 queueDays/inspectBacklog 已进表 —— 评审形态②裁定「消化速率=产能，有出处」，
    // 本断言的前提被那单有意拆掉的正是「全仓没有第二处出处」）。
    expect(d.clearanceQueueDays).toBeUndefined(); // 天数族：T6 裁决 defer —— 实测 −8.9 天负值交仓主，夹下界 0 = 把数据 bug 藏成正常
    expect(d.qty).toBeUndefined();                // 件数族：Order 真值支属性，设计上永不登记取值域（真值支不饱和，饱和即污染业务真值）
    // 🔴 回归钉子（WO-SIM-DOMAIN-DECLARE·2026-09-17）：`blockedPressure` **必须**已声明。
    // 它是 47 条边里**唯一**「入边≠0 且出边≠0」的压力族量纲（入 `Process.queuePressure ×0.55`、
    // 出 `→ WorkOrder.releasePressure ×0.6`）⇒ 唯一一个把无界读数**泵进下游已声明链**的口子。
    // 漏声明的实测代价（真 datacore `SEED_DEMO=1`·种子世界 tick3 分支推 6 拍）：
    //   130/130 格越界，max **2284.49**（上界的 22.8 倍）。
    // ⚠ WO-PROP-V2-REBASE 收编：canonical 这枚钉子与分支的换样**同时成立**（断言的是不同的键），
    //   故两段都留、⛔ 不是「取并集」—— 取并集指的是同一条目留下状态相反的两份。
    // 🔴 WO-DERIV-BACKFILL（2026-10-06）**只改了这一格**：`max: 100 → null`，另三项一个字节没动。
    //   钉子的另一半（漏声明的代价）照旧成立，**但原文那句收敛判据已被换掉**，不是悄悄删：
    //   原写「补上后 130/130 全部落回 [0,100]，max 97.68」—— 该句的前提是这格的量纲 ≤100，
    //   而它的**真实基值本来就超过 100**：规格输出实测 **27.72–182.73**（130/130 逐位相符，
    //   49/130 越界，见 `battery.ts` 该键那段与 `/tmp` 的 tick0 越界普查）。
    //   ⇒ 上限拦的已不是发散，而是**真实读数**；发散改由 `min: 0` + `restPoint: 0` + λ 挡
    //     —— 那两半各有一条驱动测试：本节 §1（有界声明 ⇒ 留在 0–100）与 §9（无界声明 ⇒
    //     不夹上界、但稳态仍收敛到 rest+inflow/λ）。⛔ 本行不是「放宽断言」：改的是**声明**。
    expect(d.blockedPressure).toBeDefined();
    expect(d.blockedPressure!.min).toBe(0);
    expect(d.blockedPressure!.max).toBeNull();
    expect(d.blockedPressure!.restPoint).toBe(0);
    // 声明了域**还不够**——没有 decayRef 它仍是（带夹值的）纯积分器，会稳稳顶在上界附近。
    expect(d.blockedPressure!.decayRef?.ruleKey).toBe(STATE_DECAY_RULE_KEY);
    const { last } = run(1, d);
    expect(last.stateVarReport.declaredStateVars).toContain("utilPressure");
    // 本图上只有 demandPressure/utilPressure 两个量纲，都已声明 ⇒ 未声明表为空但字段必须在
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
    const hot: TickState = { a1: { demandPressure: 50 }, b1: { utilPressure: 5000 } };
    const base = propagateTick(graph, hot, [rule()], [], 0, RULE_PARAMS, {}, [], {}, d);
    const bumped = propagateTick(
      graph, { a1: { demandPressure: 500 }, b1: { utilPressure: 5000 } }, [rule()], [], 0, RULE_PARAMS, {}, [], {}, d,
    );
    // 源 ×10 ⇒ 目标读数必须**更大**（而不是两者都钉在 100）
    expect(bumped.next.b1!.utilPressure!).toBeGreaterThan(base.next.b1!.utilPressure!);
    expect(bumped.next.b1!.utilPressure!).toBeLessThan(100);
    // 且这次饱和必须被披露，不许静默夹住
    expect(base.stateVarReport.saturations.some((s) => s.objectId === "b1" && s.stateVar === "utilPressure")).toBe(true);
    const ev = base.stateVarReport.saturations.find((s) => s.stateVar === "utilPressure")!;
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

  // ══════════════════════════════════════════════════════════════════════════
  // §7 WO-SATURATE-EXOGENOUS · **压缩器只许压「这一拍产生的新读数」**
  //
  // 病灶：`saturateToDomain` 在合法域内不是恒等、且不幂等（`u ← u/(1+u)` ⇒ 全体漂向 kneeHi），
  // 而饱和相每拍对 `next` 里每格无差别重跑一遍 ⇒ **零驱动的格子自己会走**。
  // 真链路实测（真 datacore `SEED_DEMO=1` + 真 REST，`obj_material_al_foil.priceShock`，
  // `mode:"set"` 推 12 拍）修前四臂：
  //   SET  74 ⇒ 74 …… 74（带内，本来就不动）
  //   SET  80 ⇒ 80 → 79.1667 …… **76.470588235293**（合法值自己缩水）
  //   SET 150 ⇒ 150 → 93.75 …… **77.027027027027**
  //   SET 200 ⇒ 200 → 95.8333 …… **77.049180327869**
  // 最贵的一层不是"数变小"：**第一次压缩好不容易保住的序被抹平** —— 12 拍后 150 与 200
  // 只差 **0.0222**（一次性压缩本该差 2.0833，94 倍），正是软拐点当初要根治的那个病走后门回来。
  //
  // ⚠ 这里**不许**改成「照抄衰减相的 `writtenVars` 豁免」：那只治入度 0 的外生量纲
  //   （demo 租户实测 4 个：equipmentFailure / forecastBias / loadPressure / priceShock），
  //   而入度>0 的 29 个累加器同样中招 —— ② 就是那个反例，豁免版照样红。
  // ══════════════════════════════════════════════════════════════════════════
  describe("§7 饱和相只压缩本拍产生的新读数（WO-SATURATE-EXOGENOUS）", () => {
    const d = stateVarDomains();
    /** 拐点：域 [0,100] rest=0 ⇒ bandHi=(100−0)×0.25=25 ⇒ kneeHi=75。 */
    const KNEE_HI = 75;
    /** λ=0 = **显式**要纯积分器（引擎注释：「尊重它」）⇒ 衰减相一格不碰，动了就只能是饱和相。 */
    const NO_DECAY = { [STATE_DECAY_RULE_KEY]: { [STATE_DECAY_PARAM_KEY]: 0 } };

    /** 连推 n 拍，回 (a1.demandPressure, b1.utilPressure) 两条轨迹。 */
    function drive(n: number, st0: TickState, params: typeof RULE_PARAMS) {
      let st = st0;
      let pend: Parameters<typeof propagateTick>[3] = [];
      const src: number[] = []; const tgt: number[] = []; const satCount: number[] = [];
      for (let t = 0; t < n; t++) {
        const r = propagateTick(graph, st, [rule()], pend, t, params, {}, [], {}, d);
        st = r.next; pend = r.pending;
        src.push(st.a1!.demandPressure!); tgt.push(st.b1!.utilPressure!);
        satCount.push(r.stateVarReport.saturations.length);
      }
      return { src, tgt, satCount };
    }

    it("§7.0 🐤 非空金丝雀 · 本夹具里确实存在入度 0 的已声明量纲（否则 §7.1 什么都没测）", () => {
      const written = new Set([rule().targetStateVar]);
      const exogenous = ["demandPressure", "utilPressure"].filter((v) => !written.has(v) && d[v] !== undefined);
      expect(exogenous).toEqual(["demandPressure"]); // 入度 0 且已声明 ⇒ 非空
      // 且它高侧真的有压缩带（带宽为 0 的量纲根本不会出现本单的病）
      expect((d.demandPressure!.max! - d.demandPressure!.restPoint) * 0.25).toBe(25);
    });

    it("§7.1 外生量纲（入度 0）：合法值零漂移，超界值**只夹一次**且保序", () => {
      // 合法值 80 ∈ (kneeHi,max]：修前 12 拍漂到 76.470588235293，修后必须逐拍恒 80。
      const legal = drive(12, { a1: { demandPressure: 80 }, b1: { utilPressure: 0 } }, RULE_PARAMS);
      expect(new Set(legal.src)).toEqual(new Set([80]));

      // 🐤 对照臂：拐点下的 74 修前修后**逐字节不变** —— 证明带内行为一个字节没动。
      const ctrl = drive(12, { a1: { demandPressure: 74 }, b1: { utilPressure: 0 } }, RULE_PARAMS);
      expect(new Set(ctrl.src)).toEqual(new Set([74]));

      // 超界 150 / 200：第 1 拍各夹一次进域内，此后恒定（幂等）。
      const a150 = drive(12, { a1: { demandPressure: 150 }, b1: { utilPressure: 0 } }, RULE_PARAMS);
      const a200 = drive(12, { a1: { demandPressure: 200 }, b1: { utilPressure: 0 } }, RULE_PARAMS);
      expect(a150.src[0]).toBeCloseTo(93.75, 10);
      expect(a200.src[0]).toBeCloseTo(95.833333333333, 10);
      expect(new Set(a150.src)).toEqual(new Set([a150.src[0]]));   // 夹过就不再动
      expect(new Set(a200.src)).toEqual(new Set([a200.src[0]]));
      for (const v of [a150.src[11]!, a200.src[11]!]) { expect(v).toBeLessThan(100); expect(v).toBeGreaterThan(KNEE_HI); }

      // 🔴 序必须**跨 12 拍**活下来：修前两臂在第 12 拍只差 0.0222，被磨成同一个数。
      const gap12 = a200.src[11]! - a150.src[11]!;
      expect(gap12).toBeGreaterThan(2);           // 修前 0.0222 ⇒ 这一条当场红
      expect(gap12).toBeCloseTo(a200.src[0]! - a150.src[0]!, 10); // 与第 1 拍的差**一模一样**＝零磨损
    });

    it("§7.2 零入流累加器（入度>0 · λ=0 · inflow=0）：12 拍逐字节不动 —— 豁免修法在这里必红", () => {
      // 源恒 0 ⇒ 贡献 = 1×0 = 0；λ=0 ⇒ 衰减相跳过 ⇒ 本拍**没有任何相位**动过 b1.utilPressure。
      // 修前：80 → 76.470588235293，且每拍都记一次饱和事件（零动力学的暗流）。
      const r = drive(12, { a1: { demandPressure: 0 }, b1: { utilPressure: 80 } }, NO_DECAY);
      expect(new Set(r.tgt)).toEqual(new Set([80]));
      expect(r.satCount.reduce((a, b) => a + b, 0)).toBe(0); // 一次饱和都不该发生
      // 金丝雀：同一装置在**有**入流时照样会饱和（否则上一行只是"装置坏了"）
      const hot = drive(1, { a1: { demandPressure: 5000 }, b1: { utilPressure: 80 } }, NO_DECAY);
      expect(hot.satCount[0]).toBeGreaterThan(0);
    });

    it("§7.3 有新读数的格子照旧压缩 —— 发散防线一个字节没动", () => {
      // 常量入流 50、λ=0（无衰减）⇒ 唯一的收敛机制就是饱和相。6 拍必须仍留在域内且收敛。
      const { series } = run(6, d, NO_DECAY);
      for (const v of series) { expect(v).toBeGreaterThan(0); expect(v).toBeLessThan(100); }
      const deltas = series.slice(1).map((v, i) => v - series[i]!);
      expect(Math.abs(deltas.at(-1)!)).toBeLessThan(Math.abs(deltas[0]!));
      // 🐤 同一装置去掉域声明就发散（证明这条"没发散"有鉴别力）
      expect(run(6, {}, NO_DECAY).series[5]!).toBeGreaterThan(250);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // §8 WO-HOLD-PERTURBATION · 生效期内的落点每拍按**声明**重施
  //
  // 病灶（2026-10-02 真服务实测）：扰动相是「一次性施加 + 到期反向施加」而**不是每拍重施**，
  // 于是契约里白纸黑字写着「`null` = 永久」的落笔，一旦落在**有入边的累加器**上，
  // 就被衰减相逐拍收掉 —— 真 datacore 上 `Order.demandPressure` 声明 +30：
  // 90 → 45.6 → 17.628 → 0.00564（3 拍，8 拍后 0）；而同一批里落在入度 0 量纲上的两条
  // （`Material.priceShock` 42→62、`Equipment.equipmentFailure` 21→23）三拍分毫不差。
  // **同一句声明、两种命运 ⇒ 声明与实现相反。**
  //
  // 治法：生效期内，先把该变换从**累加器**里撤掉（衰减与入流跑自然轨迹），跑完再按声明加回去。
  // 于是幅度**不参与衰减**（不会被吃掉），也**不复合**（不是每拍在上一拍的结果上再乘一次）。
  //
  // ⚠ 为什么不是「跳过衰减」（第一版 WO-PIN-LANDING，已实测并撤下）：落点原地不动、幅度也不参与
  //   动力学，且"声明的那部分"与"世界自己演化出来的那部分"糊在一个数里，屏上分不开。
  //   第一版满足「不动」，但**不满足「真永久」** —— 世界自己那部分一停，落点就跟着停。
  //
  // ⚠ 本段与 §7 那条豁免**不是一回事，别合并**：§7 治的是"饱和相无差别重压上一拍的输出"，
  //   本段治的是"衰减相把用户声明的东西当自己的存量收走"。前者在饱和相，后者在衰减相，
  //   同一个病（把两件事合成一件）在本文件已经犯过一次。
  // ══════════════════════════════════════════════════════════════════════════
  describe("§8 WO-HOLD-PERTURBATION · 生效期内的落点每拍按声明重施", () => {
    const d = stateVarDomains();
    /** 源恒 0 ⇒ 规则每拍贡献 0 ⇒ 目标格上**只剩衰减一个力**（判据一：不然测不出因果）。 */
    const prePert: TickState = { a1: { demandPressure: 0 }, b1: { utilPressure: 60 } };
    const pert = (over: Partial<Perturbation> = {}): PerturbationInTick => ({
      id: "p1", tenantId: "t", sessionId: "s",
      kind: "demand_shift",
      targetObjectId: "b1", targetStateVar: "utilPressure",
      startTick: 1, durationTicks: null, magnitude: 30, mode: "delta",
      label: "测试用：目标格 +30", createdAt: "2026-01-01T00:00:00.000Z",
      ...over,
    });

    /** 连推 n 拍，回 b1.utilPressure 轨迹 + 每拍重施/未重施的格数（**披露字段**，不是内部变量）。 */
    function drive(n: number, ps: PerturbationInTick[], from: TickState = prePert): { series: number[]; held: number[]; unresolved: number[] } {
      let st = from;
      let pend: Parameters<typeof propagateTick>[3] = [];
      const series: number[] = []; const held: number[] = []; const unresolved: number[] = [];
      for (let t = 0; t < n; t++) {
        const r = propagateTick(graph, st, [rule()], pend, t, RULE_PARAMS, {}, ps, {}, d);
        st = r.next; pend = r.pending;
        series.push(st.b1!.utilPressure!);
        held.push(r.stateVarReport.heldPerturbations.length);
        unresolved.push(r.stateVarReport.heldUnresolved.length);
      }
      return { series, held, unresolved };
    }
    /** 无扰动臂的轨迹 —— **同一次 drive**，不是抄来的常数。下面每条都拿它当基准。 */
    const CONTROL = drive(4, []).series;

    it("§8.0 🐤 前置金丝雀 · utilPressure 确实是「会被衰减」的那一类（否则本段什么都没测）", () => {
      // ① 它是某条规则的 target ⇒ 进 writtenVars（衰减相只碰这一类）；② 它有域声明且 λ 解析得出。
      expect(rule().targetStateVar).toBe("utilPressure");
      expect(d.utilPressure).toBeDefined();
      // 无扰动 ⇒ 一格不重施，且它自己就在散：60 → 37.8 → 23.814 → 15.00282
      const { series, held, unresolved } = drive(3, []);
      expect(held).toEqual([0, 0, 0]);
      expect(unresolved).toEqual([0, 0, 0]);
      expect(series).toEqual([37.8, 23.814, 15.00282]);
      expect(CONTROL.slice(0, 3)).toEqual([37.8, 23.814, 15.00282]); // 基准臂自证
    });

    it("§8.1 判据一 · durationTicks=null（契约「永久」）的幅度**不被衰减吃掉**：每拍恒等于 自然值+30", () => {
      const { series, held } = drive(3, [pert()]);
      expect(held).toEqual([1, 1, 1]); // 生效期覆盖三拍 ⇒ 三拍都重施
      // 核心判据：与**同一装置的无扰动臂**逐拍相减，差恒为 30 —— 不缩水（不是被吃掉），也不变大（不是复利）。
      // ⚠ 期望值由基准臂现算，⛔ 不写死 67.8/53.814/45.00282：那是把这条轨迹抄成第二套真相源。
      series.forEach((v, i) => expect(v - CONTROL[i]!).toBeCloseTo(30, 9));
      // 反向对照（这一条才是"永久"的定义）：第一版「跳过衰减」在这里会是 90 → 90 → 90，
      // 幅度**不随世界演化**；本版必须随自然轨迹一起走 —— 两条臂在 series[2] 上必须分开。
      expect(series[2]!).toBeLessThan(90 - 1);
    });

    it("§8.2 反向金丝雀 · 给了 durationTicks 就必须在到期那一拍交还给自然轨迹（重施不是永久豁免）", () => {
      const { series, held } = drive(4, [pert({ durationTicks: 2 })]);
      // 生效期 = producedTick 1、2 ⇒ 重施；producedTick=3 到期：先按 delta 回退（−30），**同一拍起不再加回**
      expect(held).toEqual([1, 1, 0, 0]);
      series.slice(0, 2).forEach((v, i) => expect(v - CONTROL[i]!).toBeCloseTo(30, 9));
      // 到期之后必须**逐字节回到**无扰动臂：不是"近似"，是这条世界线上这个扰动的痕迹只该剩在历史值里
      expect(series.slice(2)).toEqual(CONTROL.slice(2));
    });

    it("§8.2b 对照 · scale 档：入流落在**缩放之后**，不复合（不是每拍在上一拍结果上再乘一次）", () => {
      // ⚠ 本用例**必须带非零入流**（`a1.demandPressure = 1`）。第一版用 §8.0 那份 rest=0 的静置夹具，
      //   当场被变异反证抖出**没有牙**：`rest=0` 时衰减是线性的，`0.63×(60×1.5) ≡ (0.63×60)×1.5`
      //   —— 「落地一次」与「每拍重施」在这个夹具上给出逐位相同的轨迹，断言恒真。
      //   形态：「我用『这条断言在正确实现下通过』当作『它抓得住错误实现』的证据」。
      //   金丝雀就在下面一行：有入流时两版必然分开（57.7 vs 58.2），无入流时分开不了。
      const from: TickState = { a1: { demandPressure: 1 }, b1: { utilPressure: 60 } };
      const ctl = drive(3, [], from).series;
      const { series } = drive(3, [pert({ mode: "scale", magnitude: 1.5 })], from);
      // 判据：整条轨迹 = 自然轨迹 ×1.5。入流若被排除在缩放之外（落地一次的旧行为），第一拍就是 57.7 ≠ 58.2。
      series.forEach((v, i) => expect(v).toBeCloseTo(ctl[i]! * 1.5, 9));
      // 非复利：复利三拍后是 17.02972×1.5³ = 57.5，而正确值是 25.54458 —— 两个数量级分得开。
      expect(series[2]!).toBeLessThan(40);
    });

    it("§8.3 RL9 可回退 · 无扰动时两份清单都为空，且读数与本节引入前逐字节同", () => {
      const r = propagateTick(graph, prePert, [rule()], [], 0, RULE_PARAMS, {}, [], {}, d);
      expect(r.stateVarReport.heldPerturbations).toEqual([]);
      expect(r.stateVarReport.heldUnresolved).toEqual([]);
      expect(r.next.b1!.utilPressure).toBe(37.8);
      // 判据落在**值**上而不是清单上：清单为空可能只是"没登记"，值不动才说明真的没碰。
      expect(JSON.stringify(r.next)).toBe(JSON.stringify({ ...prePert, b1: { utilPressure: 37.8 } }));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // §9 WO-DERIV-BACKFILL · `max: null` 的语义：**上界真的没了，λ 那一半一个字节没丢**
  //
  // 本单把 9 格从压力族名单移出、改声明 `max: null`，判据是**式子的分母是产能/额度、不是占比**：
  // 件÷日产能、元÷授信额度这些量，分子超过分母是**真实业务状态**（超负荷接单 / 应收超授信），
  // 实测基值就落在 100 以上（`Line.blockedPressure` 27.72–182.73、`Base.loadIndex` 74.18–552.02），
  // 原先一律盖 `max: 100` 是把真实读数夹成 100。
  //
  // ⚠ 上面 §1–§8 的夹具**已改钉到仍有上界的 `utilPressure`**（原先钉在 `demandLoad` 上）——
  //   那份「声明后留在 0–100 内」的断言是 WO-PROP-CLAMP 的核心，**不许为了本单把它放宽**，
  //   换一个仍然有界的样本，牙就还在。本节补的才是新语义自己那一半。
  //
  // 判据落在一个能**闭式手算**的数上（铁律 1.5 判据一）：`x(t+1) = rest + (1−λ)x(t) + inflow`
  // （propagation.ts 衰减相原文）⇒ 稳态 `rest + inflow/λ`；rest=0、入流 50、λ=0.37 ⇒ **50/0.37**。
  // ══════════════════════════════════════════════════════════════════════════
  it("§9 `max: null` ⇒ 不夹上界、稳态仍是可手算的有限值 rest + inflow/λ", () => {
    const d = stateVarDomains();
    expect(d.demandLoad?.max, "本臂前提：demandLoad 已改无界声明（若拍回 100，本臂退化成 §1）").toBeNull();
    expect(d.demandLoad?.restPoint).toBe(0);
    const unbounded = rule({ targetStateVar: "demandLoad" });
    let st: TickState = { a1: { demandPressure: 50 }, b1: { demandLoad: 0 } };
    let pend: Parameters<typeof propagateTick>[3] = [];
    let last: ReturnType<typeof propagateTick> | null = null;
    // 40 拍：离稳态的距离是 0.63⁴⁰ ≈ 9.4e−9（手算得出），足够把稳态读到 4 位。
    for (let t = 0; t < 40; t++) {
      const r = propagateTick(graph, st, [unbounded], pend, t, RULE_PARAMS, {}, [], {}, d);
      st = r.next; pend = r.pending; last = r;
    }
    const v = st.b1!.demandLoad!;
    expect(v, "上界还在（读数被压回 100 以内）⇒ 本单的 max:null 没落到引擎里").toBeGreaterThan(100);
    expect(v, "稳态 ≠ rest + inflow/λ ⇒ 无界那一半改了，衰减那一半也被动了").toBeCloseTo(50 / PRESSURE_DECAY_PER_TICK, 4);
    expect(
      last!.stateVarReport.saturations.some((s) => s.stateVar === "demandLoad"),
      "无界声明不该再报上界饱和（报了就是把 null 当成了某个数在夹）",
    ).toBe(false);
  });
});
