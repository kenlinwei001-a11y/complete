/**
 * WO-EDGE-MONEY-WEIGHT 接缝门 —— 「传导压力按**金额**算，不按**条数**算」。
 *
 * ⛔ **它咬的是链路不是函数**（SEAM-GATE）：本单拆成三半 ——
 *   ① 契约登记口径 `source_value_relative` / 归一 `IN_EDGES_GLOBAL_MEAN`（`packages/contracts/src/sim.ts`）
 *   ② DataCore 侧从本体算权重（`src/sim/pair-weights.ts`）
 *   ③ 引擎侧逐对乘权重（`src/sim/propagation.ts`）
 * 任何一半单独绿都说明不了问题：口径登记了而没实现 ⇒ 报缺；实现了而种子没声明 ⇒ 一格不动；
 * 声明了而引擎不乘 ⇒ 读数照旧。故 §1/§2 一律**从真种子的对象库出发**跑到世界态读数上。
 *
 * ── 今天的行为 X / 应该的 Y（修前实测·真后端 SEED_DEMO=1·seed 42·三元正极 +15%·tick×4）──
 * **X**：`Order.costPressure --order_of_customer--> Customer.receivablePressure` 这条边
 * `weightRef: null` ⇒ 客户名下**每张单落同一个额**，读数 = `0.5 × Σ(逐单成本压力)`
 * —— 一个**只数条数、不看金额**的量。实测四家金额天差地别的客户拿到**逐字节相同**的
 * `15.137333779669`：东风(受扰额 10.02 亿) · 深蓝(5.75 亿) · 上汽通用五菱(4.48 亿) · 零跑(2.39 亿)。
 * 按它排「先催谁的款」= 按单数排。
 * **Y**：压 10.02 亿的客户，应收压力应当是压 2.39 亿那家的约 4.20 倍（= 金额比）。
 *
 * ⚠ 本文件**不新增门脚本 / 棘轮 / 基线 JSON**（仓主禁令 3），只是本单自己的定向测试。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pairWeightKey,
  propagateTick,
  type PropagationGraph,
} from "../src/sim/propagation.js";
import {
  PropagationRuleSchema,
  pairWeightNormalizeOf,
  type PropagationRule,
  type TickState,
} from "@platform/contracts";
import { demoPropagationRulesWithDomain } from "../src/seed.js";
// ⛔ 刻意**不再** import `PRESSURE_DECAY_PER_TICK`（WO-COEF-LAMBDA）：λ 逐格不同，
// 把那个记号留在手边，下一个人顺手拿它当全表默认值就又回到「全表一个 λ」那个病。
// `ruleParamOf` 是 C35 参数的**唯一读法**（与引擎 `resolveDecayRate` 读的是同一张 params 表）。
import { STATE_VAR_DOMAINS, ruleParamOf } from "../src/synthetic/battery.js";

const SEED_TS = join(dirname(fileURLToPath(import.meta.url)), "../src/seed.ts");

/**
 * 一条 Order→Customer 形状的规则（身份格照真种子那条，数值可改）。
 *
 * ⚠ 走 `PropagationRuleSchema.parse` 而**不是**写字面量 —— 与 `sim-propagation.test.ts` 同一条：
 * 字面量会被 TS 判成"另一个同名类型"（TS2719，`propagateTick` 的形参类型来自 src 侧解析的契约包），
 * 且缺省字段（`combine`/`decay`/`weightRef`…）的默认值应当由**契约**给，不该在测试里各抄一份。
 */
const arRule = (over: Partial<PropagationRule> = {}): PropagationRule =>
  PropagationRuleSchema.parse({
    id: "r1",
    tenantId: "demo",
    key: "ar",
    sourceTypeKey: "Order",
    sourceStateVar: "costPressure",
    viaLinkKey: "order_of_customer",
    targetTypeKey: "Customer",
    targetStateVar: "receivablePressure",
    coefficient: 0.5,
    delayTicks: 0,
    status: "PUBLISHED",
    ...over,
  });

// ══════════════════════════════════════════════════════════════════════════════
// §1 病灶与修法 —— 「同条数、不同金额」与「同金额、不同条数」两个方向都要咬
//
// 世界（照真种子的形状缩小，数字取自真后端实测的那两组）：
//   · 大客户 cBig  ← 2 张单，金额 8 + 2 = 10（≈ 东风 10.02 亿）
//   · 小客户 cSml  ← 2 张单，金额 2 + 0.38 = 2.38（≈ 零跑 2.39 亿）  ← **条数相同**
//   · 多单客户 cMany ← 3 张单，金额合计同样 10                        ← **金额相同、条数不同**
// 全域基数 = 全部 7 张单的金额均值。
// ══════════════════════════════════════════════════════════════════════════════
describe("§1 应收压力：按金额算，不按条数算", () => {
  const GRAPH: PropagationGraph = {
    objects: [
      { id: "o_big_1", typeKey: "Order" }, { id: "o_big_2", typeKey: "Order" },
      { id: "o_sml_1", typeKey: "Order" }, { id: "o_sml_2", typeKey: "Order" },
      { id: "o_many_1", typeKey: "Order" }, { id: "o_many_2", typeKey: "Order" }, { id: "o_many_3", typeKey: "Order" },
      { id: "cBig", typeKey: "Customer" }, { id: "cSml", typeKey: "Customer" }, { id: "cMany", typeKey: "Customer" },
    ],
    links: [
      { fromId: "o_big_1", toId: "cBig", linkKey: "order_of_customer" },
      { fromId: "o_big_2", toId: "cBig", linkKey: "order_of_customer" },
      { fromId: "o_sml_1", toId: "cSml", linkKey: "order_of_customer" },
      { fromId: "o_sml_2", toId: "cSml", linkKey: "order_of_customer" },
      { fromId: "o_many_1", toId: "cMany", linkKey: "order_of_customer" },
      { fromId: "o_many_2", toId: "cMany", linkKey: "order_of_customer" },
      { fromId: "o_many_3", toId: "cMany", linkKey: "order_of_customer" },
    ],
  };
  /** 每张单的成本压力**相同**（真种子里同型号的单确实如此）——差别只在金额上。 */
  const C = 10;
  const BASE: TickState = Object.fromEntries(
    GRAPH.objects.map((o): [string, Record<string, number>] => [
      o.id,
      o.typeKey === "Order" ? { costPressure: C } : { receivablePressure: 0 },
    ]),
  );
  /** 金额（与真后端那两组同形状）。 */
  const VALUE: Record<string, number> = {
    o_big_1: 8, o_big_2: 2, o_sml_1: 2, o_sml_2: 0.38,
    o_many_1: 4, o_many_2: 3, o_many_3: 3,
  };
  const GLOBAL_MEAN = Object.values(VALUE).reduce((a, b) => a + b, 0) / Object.keys(VALUE).length;
  const ownerOf: Record<string, string> = {
    o_big_1: "cBig", o_big_2: "cBig", o_sml_1: "cSml", o_sml_2: "cSml",
    o_many_1: "cMany", o_many_2: "cMany", o_many_3: "cMany",
  };
  /** 全域均值归一（= `source_value_relative` 的口径）。 */
  const globalMeanWeights = (): Record<string, number> =>
    Object.fromEntries(Object.entries(VALUE).map(([o, v]) => [pairWeightKey(o, ownerOf[o]!), v / GLOBAL_MEAN]));
  /** 组内均值归一（= `source_qty_relative` 的口径）—— §2 的变异反证用。 */
  const groupMeanWeights = (): Record<string, number> => {
    const byOwner = new Map<string, string[]>();
    for (const [o, c] of Object.entries(ownerOf)) (byOwner.get(c) ?? byOwner.set(c, []).get(c)!).push(o);
    const out: Record<string, number> = {};
    for (const [c, os] of byOwner) {
      const mean = os.reduce((s, o) => s + VALUE[o]!, 0) / os.length;
      for (const o of os) out[pairWeightKey(o, c)] = VALUE[o]! / mean;
    }
    return out;
  };

  it("① 修前形态复现：无 weightRef ⇒ 读数只跟**条数**走，金额 4.2 倍的两家拿到逐字节相同的数", () => {
    const r = arRule();
    const { next } = propagateTick(GRAPH, BASE, [r], [], 0);
    // cBig 与 cSml 各 2 张单 ⇒ 0.5 × 10 × 2 = 10，两家**逐字节相同**，而金额差 10 : 2.38。
    expect(next.cBig!.receivablePressure).toBe(10);
    expect(next.cSml!.receivablePressure).toBe(10);
    expect(next.cBig!.receivablePressure).toBe(next.cSml!.receivablePressure); // ← 这就是病
    // 而金额相同、单数不同的两家反被拉开 1.5 倍 —— 病的另一面。
    expect(next.cMany!.receivablePressure).toBe(15);
    expect(next.cMany!.receivablePressure! / next.cBig!.receivablePressure!).toBe(1.5); // = 单数比 3/2
  });

  it("② 修后·实验 1「同条数、不同金额」⇒ 读数按**金额比**拉开（4 个数缺一不可）", () => {
    const r = arRule({ weightRef: { basis: "source_value_relative" } });
    const { next } = propagateTick(GRAPH, BASE, [r], [], 0, {}, {}, [], { [r.key]: globalMeanWeights() });
    const big = next.cBig!.receivablePressure!, sml = next.cSml!.receivablePressure!;
    // 读数 = 0.5 × C × (该客户金额 ÷ 全域均值)
    const expect1 = (v: number) => 0.5 * C * (v / GLOBAL_MEAN);
    expect(big).toBeCloseTo(expect1(10), 9);
    expect(sml).toBeCloseTo(expect1(2.38), 9);
    expect(big).not.toBe(sml); // ← 修前这里是相等
    // ★ 判据：压力比 **恒等于** 金额比（不是"大致相关"）
    expect(big / sml).toBeCloseTo(10 / 2.38, 9);
  });

  it("③ 修后·实验 2「同金额、不同条数」⇒ 读数**相等**（否则就没真换成金额）", () => {
    const r = arRule({ weightRef: { basis: "source_value_relative" } });
    const { next } = propagateTick(GRAPH, BASE, [r], [], 0, {}, {}, [], { [r.key]: globalMeanWeights() });
    // cBig 2 张单合计 10，cMany 3 张单合计 10 —— 金额相同、条数 2:3。
    expect(next.cMany!.receivablePressure).toBeCloseTo(next.cBig!.receivablePressure!, 9);
    // 反面咬死：修前这里是 1.5（跟着条数走）。
    expect(next.cMany!.receivablePressure! / next.cBig!.receivablePressure!).not.toBeCloseTo(1.5, 3);
  });

  it("④ 🔴 变异反证：换成**组内**均值归一 ⇒ 读数逐字节退回修前（这就是为什么分母必须是全域）", () => {
    // 这一条是本单最容易做错的地方：`source_qty_relative` 的口径看着"也是按金额分摊"，
    // 但组内归一把金额**约掉了** —— Σ权重 ≡ 该组条数 ⇒ 读数原样等于 ①，
    // 却挂着「已按金额分摊」的名义。故必须有一条测试把这个错法钉死。
    const r = arRule({ weightRef: { basis: "source_value_relative" } });
    const withGroup = propagateTick(GRAPH, BASE, [r], [], 0, {}, {}, [], { [r.key]: groupMeanWeights() });
    const noWeight = propagateTick(GRAPH, BASE, [arRule()], [], 0);
    for (const c of ["cBig", "cSml", "cMany"]) {
      expect(withGroup.next[c]!.receivablePressure).toBeCloseTo(noWeight.next[c]!.receivablePressure!, 9);
    }
    // 且组内归一下「金额差 4.2 倍」的两家又变回相等 —— 病原样复现。
    expect(withGroup.next.cBig!.receivablePressure).toBeCloseTo(withGroup.next.cSml!.receivablePressure!, 9);
  });

  it("⑤ 保总量：全域 Σ权重 = 源实例条数 ⇒ 换口径不改变世界的总体量级", () => {
    const total = Object.values(globalMeanWeights()).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(Object.keys(VALUE).length, 9); // 7 张单 ⇒ Σ权重 = 7
    // 世界总压力也因此守恒（各客户之间只是重新分配）。
    const r = arRule({ weightRef: { basis: "source_value_relative" } });
    const w = propagateTick(GRAPH, BASE, [r], [], 0, {}, {}, [], { [r.key]: globalMeanWeights() });
    const n = propagateTick(GRAPH, BASE, [arRule()], [], 0);
    const sum = (s: TickState) => ["cBig", "cSml", "cMany"].reduce((a, c) => a + (s[c]!.receivablePressure ?? 0), 0);
    expect(sum(w.next)).toBeCloseTo(sum(n.next), 9);
  });

  it("⑥ 声明了口径却拿不到整张表 ⇒ 不传导 + 显式报缺，**绝不退回 1**", () => {
    const r = arRule({ weightRef: { basis: "source_value_relative" } });
    const { next, unresolvedWeights } = propagateTick(GRAPH, BASE, [r], [], 0, {}, {}, [], {});
    expect(next.cBig!.receivablePressure).toBe(0);
    expect(unresolvedWeights).toHaveLength(1);
    expect(unresolvedWeights[0]!.basis).toBe("source_value_relative");
    expect(unresolvedWeights[0]!.reason).toBe("NO_WEIGHTS");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §2 契约登记：新口径必须在册，且归一方式**不是**既有那两种
// ══════════════════════════════════════════════════════════════════════════════
describe("§2 口径登记册", () => {
  it("source_value_relative 在册且归一为 IN_EDGES_GLOBAL_MEAN", () => {
    expect(pairWeightNormalizeOf("source_value_relative")).toBe("IN_EDGES_GLOBAL_MEAN");
    // 金丝雀：查一个**确定在册**的与一个**确定不在册**的，证明这支查法有鉴别力。
    expect(pairWeightNormalizeOf("bom_cost_share")).toBe("IN_EDGES");
    expect(pairWeightNormalizeOf("no_such_basis")).toBeNull();
  });

  it("🔴 与 source_qty_relative 的归一必须**不同** —— 相同就说明分母又退回组内了", () => {
    expect(pairWeightNormalizeOf("source_value_relative")).not.toBe(pairWeightNormalizeOf("source_qty_relative"));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §3 描述 × 系数对账 —— 屏上那句中文不许和真系数打架
//
// `GET /a/v1/sim/propagation-rules` **原样把 `description` 下发给用户**。
// 修前实测 13 条写了系数的边里 **9 条不符**（最大差 2 倍：`demo_customer_receivable_to_invoice_overdue`
// 描述 ×0.8 / 真值 0.4）。本节对账**装饰后的真种子对象**（真系数 ← C36.params 单源派生；
// 描述文本 = 屏上原话），不符即红。
//
// ⚠ 扫描类断言必须先自证工具（铁律 0.6 已落地的机制）：金丝雀 = 把一条已知相符的边
// **就地变异**成不符，扫描器必须当场抓到。抓不到 ⇒ 报「工具坏了」，不许报「代码干净」。
// ══════════════════════════════════════════════════════════════════════════════
describe("§3 描述里的系数 = 真系数", () => {
  // ⚠ **真系数的取法已于 WO-PROP-COEF-CONFIG 换轨**：修前本节扫 seed.ts 源码里的
  //   `coefficient: <数>` 字面量当真系数；该字面量已按单源纪律（G-10 P4）**移出 seed.ts** ——
  //   唯一真源在 battery.ts `PROPAGATION_COEF_PARAMS`（C36.params），种子对象的
  //   `coefficient` / `coefficientRef` 都由它派生（`demoPropagationRulesWithDomain` 装饰）。
  //   继续扫源码只会扫到 0 条、然后报「0 条不符」—— 那正是铁律 0.6 的「我没找到 ≠ 它不存在」。
  //   故对账改成：**真系数 = 装饰后种子对象上的 coefficient**（= 引擎 `effectiveCoefficient`
  //   解析到的同一个数，C36 探针逐字节核过）；**描述文本仍是用户屏上那句原话**，照扫。
  // ⚠⚠ **WO-PROP-V2-REBASE 第二次换轨**：上面那段（「真系数 = 装饰后对象上的 coefficient」）
  //   在并入 canonical 的 WO-SIM-CALIBRATION 之前是对的，之后**就不对了**——
  //   标定后落库的是**每拍入流** `稳态增益 × λ`，而 description 承诺的一直是**稳态增益**
  //   （「价格冲击 × 0.65 = 型号成本压力」读作 `target = source × 0.65`，是稳态关系不是单拍增量）。
  //   实测：不换轨则 14 行里 **12 行**报不符，其中 `demo_model_demand_to_base_load`
  //   （描述 ×0.6 / 落库 0.222 = 0.6λ）这类**本单一个字都没改过**的边也在内
  //   ⇒ 那是**口径错位**，不是描述说了谎；照旧断言等于用一道门去咬一个它没在度量的量。
  //   形态：「我用『落库系数』当作『描述承诺的那个量』的证据，而前者并不度量后者 —— 差一个 λ。」
  //
  // 换轨后：**真增益 = 落库系数 ÷ λ（当且仅当该边被预乘过 λ）**。
  // ── 🔴 WO-COEF-LAMBDA 第三次换轨（2026-09-19）：上一版这两句都不对，逐条订正 ────────────
  // 旧写法 `lambdaApplied = d != null && typeof d.max === "number"`，附带理由
  // 「声明了但 `max: null`（无界，无饱和拐点）⇒ 纯积分器，没预乘」。**两处错**：
  //  ① **`max` 不度量「会不会衰减」**。引擎 `propagation.ts` 的 `resolveDecayRate(d, ruleParams)`
  //     **只看 `d.decayRef`**，与 `max` 毫无关系；`max` 只决定 `saturateToDomain` 有没有上拐点。
  //     `max: null` 的积压族**照样按各自的 λ 衰减**，稳态里照样有 `1/λ` 要约 ⇒ **该预乘**。
  //     形态：「我用『有没有上界』当作『会不会衰减』的证据，而前者并不度量后者。」
  //  ② **λ 不是全表一个数**。C35 下挂 6 个 paramKey，实测 0.37/0.37/**0.75**/**0.75**/**0.22**。
  //     拿 `PRESSURE_DECAY_PER_TICK` 全表除，对后三个量纲分别错 2.03×/2.03×/0.59×。
  // ⇒ 现判据（与引擎同一条路，⛔ 不许各抄一份）：**`decayRef` 解析得出 λ∈(0,1) ⇒ 预乘过 ⇒ 除回去**。
  /**
   * 从描述文本抽「×N」声明数。**主逻辑与金丝雀共用这一支**（不许各抄一份正则）。
   *
   * 🔴 **2026-09-19 WO-COEF-LAMBDA 实测补洞：负号必须同时认 ASCII `-` 与 U+2212 `−`。**
   * 旧正则只写 `-?`（U+002D）。而种子的中文 description 一律用**排版减号** U+2212
   * （「变更频度 × **−0.5** = 需求负载下修量」）⇒ `× ` 后面第一个字符既不是 `-?` 也不是
   * `[\d.]`，整个 match **在该位置失败**，`stated.length === 0`
   * ⇒ 这条边被 `.filter(r => r.stated.length > 0)` 当成「描述里没写数（合法）」**整条放过**。
   * ⇒ **全表 4 条负系数边的 description 从来没被这道门对过账**，而它们恰恰是最容易写反符号的那些。
   * 形态：「我用『这道门是绿的』当作『描述与系数对上了』的证据，而前者并不度量后者
   *        —— 它根本没在判这几条。」
   * **实测（55 行 description 逐行扫，不是估的）**：旧正则命中 **13** 行，新正则 **14** 行 ——
   * 只有 `demo_order_churn_to_model_demand_load` 一条因 U+2212 逃掉过。
   * ⚠ 另 4 条负系数边（`forecast_bias` / `alt_switch` / `fg_cover_days` / `fg_drawdown_relieves`）
   *   **不在增量里**，原因不是正则而是**它们的 description 压根没写「×N」**
   *   ⇒ 它们至今仍不被本门对账（合法，但不是"被验过"）。
   *   形态同族：「我用『补好了正则』当作『负系数边都被对上了』的证据。」——补正则只捞回 1 条。
   */
  const statedOf = (description: string): number[] =>
    [...description.matchAll(/[×x]\s*([-−]?[\d.]+)/g)].map((x) => Number(x[1].replace("−", "-")));

  /** 落库系数 → description 承诺的那个量（稳态增益）= `系数 ÷ 该落点自己的 λ`。 */
  const gainOf = (targetStateVar: string, coefficient: number): number => {
    const ref = STATE_VAR_DOMAINS[targetStateVar]?.decayRef;
    if (!ref) return coefficient; // 无域/无衰减引用 ⇒ 纯积分器，没预乘 ⇒ 原样比
    const lambda = ruleParamOf(ref.ruleKey, ref.paramKey);
    // λ 读不成一个可用衰减率 ⇒ 报红，⛔ 不静默按"没预乘"处理：那会把一处配置坏掉读成一条合规的边。
    expect(
      Number.isFinite(lambda) && lambda > 0 && lambda < 1,
      `${targetStateVar} 的 λ 引用 ${ref.ruleKey}.${ref.paramKey} 解析成 ${String(lambda)} ⇒ 不是可用衰减率`,
    ).toBe(true);
    return Math.round((coefficient / lambda) * 1e6) / 1e6;
  };

  interface Row { key: string; coef: number; stated: number[]; ok: boolean }
  /** 判 (key, 真增益, 描述声明数) 三元组：声明数里至少一个与真增益相符（6 位小数，= 预算取整精度）。 */
  const rowsFromRules = (
    rules: ReadonlyArray<{ key: string; coefficient: number; description: string | null; targetStateVar: string }>,
  ): Row[] =>
    rules
      .map((r) => ({ key: r.key, coef: gainOf(r.targetStateVar, r.coefficient), stated: statedOf(r.description ?? "") }))
      .filter((r) => r.stated.length > 0) // 描述里没写数（或压根没描述）⇒ 不判定（合法）
      .map((r) => ({ ...r, ok: r.stated.some((s) => Math.abs(s - r.coef) < 1e-6) }));

  it("🐤 金丝雀先行：把一条相符的边变异成不符，对账必须当场抓到", () => {
    const rules = demoPropagationRulesWithDomain().map((r) => ({ ...r }));
    const victim = rules.find((r) => r.key === "demo_customer_receivable_to_invoice_overdue");
    expect(victim, "变异靶子不在种子里 ⇒ 这条金丝雀证明不了任何事").toBeTruthy();
    expect(victim!.description, "靶子没有描述 ⇒ 变异无处可注，这条金丝雀证明不了任何事").toBeTruthy();
    victim!.description = victim!.description!.replace("× 0.4", "× 0.8");
    expect(victim!.description, "变异没注进去 ⇒ 下面那条断言证明不了任何事").not.toContain("× 0.4");
    const bad = rowsFromRules(rules).filter((r) => !r.ok);
    expect(bad.map((r) => r.key)).toContain("demo_customer_receivable_to_invoice_overdue");
  });

  it("🐤 金丝雀②：**排版减号 U+2212** 的声明数必须抽得出来（旧正则在这里整条放过）", () => {
    // 正样例中了不够 —— 本条要证明的是「它能认出 U+2212」，故正反两个样例都跑，且共用主逻辑那一支。
    expect(statedOf("（变更频度 × −0.25 = 需求负载下修量）"), "U+2212 负号没抽出来 ⇒ 负系数边全体逃过对账").toEqual([-0.25]);
    expect(statedOf("（x × -0.25 = y）"), "ASCII 负号回归").toEqual([-0.25]);
    expect(statedOf("（这句话里没有乘号声明数）"), "无声明数时必须是空数组，否则会凭空造出对账行").toEqual([]);
  });

  it("种子里 0 条描述与真系数不符", () => {
    const rows = rowsFromRules(demoPropagationRulesWithDomain());
    // 金丝雀③：对账行数必须是真数量级，0 行时那句"0 条不符"毫无意义。
    // ⚠ 下界 13 → **14**：补上 U+2212 之后 `demo_order_churn_to_model_demand_load` 进来了（实测，见 `statedOf` 注）。
    expect(rows.length, "描述里写了系数的边条数（0 行 = 对账空转）").toBeGreaterThanOrEqual(14);
    const bad = rows.filter((r) => !r.ok);
    expect(
      bad.map((r) => `${r.key}: 描述 ×${r.stated.join("/")} vs 真值 ${r.coef}`),
      "屏上正在说与实际不符的话（GET /a/v1/sim/propagation-rules 原样下发 description）",
    ).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §4 种子接线：那条边真的声明了口径（否则上面全部白测）
// ══════════════════════════════════════════════════════════════════════════════
describe("§4 种子把口径接上了", () => {
  it("demo_order_cost_to_customer_receivable 声明 source_value_relative", () => {
    const src = readFileSync(SEED_TS, "utf8");
    const at = src.indexOf('key: "demo_order_cost_to_customer_receivable"');
    expect(at, "种子里找不到这条边").toBeGreaterThan(0);
    const block = src.slice(at, at + 2000);
    expect(block).toContain('weightRef: { basis: "source_value_relative" }');
    // 反面：`Model→Order` 那条**出边**不许加权（率被切成 N 份，量纲不成立 + 重复计账）。
    const at2 = src.indexOf('key: "demo_model_cost_to_order_cost"');
    expect(src.slice(at2, at2 + 1200)).toContain("weightRef: null");
  });
});
