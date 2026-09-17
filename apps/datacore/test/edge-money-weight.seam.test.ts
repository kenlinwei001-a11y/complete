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
// §3b 的分支判据从**真值**读，不从文本猜：
// `demoPropagationRulesWithDomain()` 是播种与测试共用的同一支（seed.ts 该函数注释原文）；
// `STATE_VAR_DOMAINS` 是「这个量纲会不会被引擎衰减」的全平台唯一出处。
import { demoPropagationRulesWithDomain } from "../src/seed.js";
import { STATE_VAR_DOMAINS } from "../src/synthetic/battery.js";

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
// 描述 ×0.8 / 真值 0.4）。本节扫种子源码，不符即红。
//
// ⚠ 扫描类断言必须先自证工具（铁律 0.6 已落地的机制）：金丝雀 = 把一条已知相符的边
// **就地变异**成不符，扫描器必须当场抓到。抓不到 ⇒ 报「工具坏了」，不许报「代码干净」。
// ══════════════════════════════════════════════════════════════════════════════
describe("§3 描述里的系数 = 真系数", () => {
  /**
   * 从 seed.ts 抽 (key, 稳态增益, description) 三元组。**主逻辑与金丝雀共用这一支**。
   *
   * ── ⚠ 2026-09-16 改断言（WO-SIM-DESAT-3 ②）：比的那个数从 `coefficient` 换成**稳态增益** ──
   *
   * **为什么必须改**：本单把字段口径改成 `coefficient = 稳态增益 × λ`
   * （`seed.ts` 的 `inflowCoefficient`）。旧抽取器的 `coefficient:\s*(-?[\d.]+)` 对
   * `coefficient: inflowCoefficient(0.423)` **一条都抽不到** ⇒ `rows.length` 掉到 0，
   * 而 §3 那条金丝雀（`>= 13`）会当场报红。**是机器先说话，不是人想起来的。**
   *
   * **形态（照铁律 0.6 句式，说的是旧断言的毛病）**：
   * > 「我用『描述里那个数 == `coefficient` 字段值』当作『屏上那句话是真的』的证据，
   * >   而前者并不度量后者 —— 描述说的是**稳态**（`target = source × c`），
   * >   字段存的是**每拍入流**，两个不同量纲的数被拿来判相等。」
   *
   * **为什么改后不比改前弱（反而更强）**：
   *  ① 旧断言把两个**不同口径**的数判相等，等式成立只是因为当时两者恰好共用一个字面量；
   *     改后两侧都是**稳态口径**，比的是同一个量 —— 这才真的度量「屏上那句话是不是真的」。
   *  ② 覆盖面没缩：仍扫全部规则块、仍要求 ≥13 条写了系数的边、仍是"0 条不符"。
   *  ③ **另加了一条旧断言没有的**：下面 §3b 断言字段值 ≡ `稳态增益 × λ` ——
   *     即「引擎真收到的那个数」与「屏上承诺的那个数」之间那一步换算也被咬住。
   *     旧断言里这一步根本不存在（那时没有这一步）。
   */
  /**
   * 把 `seed.ts` 切成「一条规则一块」。**§3 与 §3b 共用这一支** ——
   * ⛔ 不许各抄一份切块正则：抄了就是装饰品，改主正则时另一份拿旧的去切、照样绿
   * （CLAUDE.md 铁律 0.6「门脚本里的金丝雀必须与主逻辑共用同一份实现」同一条）。
   */
  function ruleBlocks(src: string): { key: string; body: string }[] {
    const idxs: { key: string; at: number }[] = [];
    const re = /key:\s*"([a-z0-9_]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) idxs.push({ key: m[1]!, at: m.index });
    return idxs.map((x, i) => ({
      key: x.key,
      body: src.slice(x.at, i + 1 < idxs.length ? idxs[i + 1]!.at : src.length),
    }));
  }

  function scan(src: string): { key: string; gain: number; stated: number[]; ok: boolean }[] {
    const out: { key: string; gain: number; stated: number[]; ok: boolean }[] = [];
    for (const blk of ruleBlocks(src)) {
      // 稳态增益 = `inflowCoefficient(...)` 的实参。⛔ 不许回落去抽裸字面量：
      // 抽到裸数就意味着有人绕过了 `inflowCoefficient`，那正是本单要堵的口。
      const cm = /coefficient:\s*inflowCoefficient\((-?[\d.]+)\)/.exec(blk.body);
      if (!cm) continue; // 不是传导规则块（或它走的是「不预乘 λ」那一支，见 §3b 支②）
      const dm = /description:\s*"((?:[^"\\]|\\.)*)"/.exec(blk.body);
      if (!dm) continue;
      const stated = [...dm[1]!.matchAll(/[×x]\s*(-?[\d.]+)/g)].map((x) => Number(x[1]));
      if (stated.length === 0) continue; // 描述里没写数 ⇒ 不判定（合法）
      const gain = Number(cm[1]);
      out.push({ key: blk.key, gain, stated, ok: stated.some((s) => Math.abs(s - gain) < 1e-9) });
    }
    return out;
  }

  const SRC = readFileSync(SEED_TS, "utf8");

  it("🐤 金丝雀先行：把一条相符的边变异成不符，扫描器必须当场抓到", () => {
    const mutated = SRC.replace("应收压力 × 0.4 = 发票逾期压力", "应收压力 × 0.8 = 发票逾期压力");
    expect(mutated, "变异没注进去 ⇒ 下面那条断言证明不了任何事").not.toBe(SRC);
    const bad = scan(mutated).filter((r) => !r.ok);
    expect(bad.map((r) => r.key)).toContain("demo_customer_receivable_to_invoice_overdue");
  });

  it("种子里 0 条描述与真稳态增益不符", () => {
    const rows = scan(SRC);
    // 金丝雀②：扫到的规则块数必须是真数量级，抽 0 条时上面那句"0 条不符"毫无意义。
    expect(rows.length, "描述里写了系数的边条数（抽 0 条 = 抽取器坏了）").toBeGreaterThanOrEqual(13);
    const bad = rows.filter((r) => !r.ok);
    expect(
      bad.map((r) => `${r.key}: 描述 ×${r.stated.join("/")} vs 真稳态增益 ${r.gain}`),
      "屏上正在说与实际不符的话（GET /a/v1/sim/propagation-rules 原样下发 description）",
    ).toEqual([]);
  });

  // ── §3b 换算这一步也要被咬住（WO-SIM-DESAT-3 新增的那条，旧断言里不存在）──────────
  //
  // 描述承诺的是**稳态**（`target = source × 增益`），而引擎每拍做的是 `target += source × coefficient`。
  // 两者之间隔着一次 `× λ`。这一步若被绕过（有人直接写裸字面量），屏上那句话就又变成谎话，
  // 而 §3 只比"描述 vs 实参"，**看不见这一步** —— 故这里单独咬。
  /**
   * ── 口径订正（WO-SALES-RING 复验收编）：旧断言「**全部** 50 条边都经 `inflowCoefficient`」已过期 ──
   *
   * **旧断言的隐含前提**：每条边的目标都会衰减，所以入流一律要预乘 λ。
   * **它不成立**：`inflowCoefficient(g) = g × λ` 服务的是**会衰减**的压力族 ——
   * 目标每拍衰减 λ ⇒ 稳态 = 入流/λ ⇒ 入流预乘 λ 才落到稳态增益 g。
   * 而引擎只衰减**已声明取值域**的量纲（`propagation.ts` 那句「只动声明过取值域的格子」，
   * 且 `decayRateOf` 只遍历 `Object.keys(domains)`）。
   * 目标**不在** `STATE_VAR_DOMAINS` 里 ⇒ 引擎不衰减 ⇒ **没有 λ 可约** ⇒
   * 预乘的那个 λ 不会被下游约掉，而是**直接留在读数里**。
   *
   * 实测代价（真后端 SEED_DEMO=1）：三条订单真实字段边曾写 `inflowCoefficient(1)`，
   * 屏上「在手订单最大单台数（套）」因此**长期只报真值的 37%** ——
   * 4680-NCM `16131 → 5968.47`、方形-LFP `21777 → 8057.49`，比值逐位 `0.370000`。
   *
   * **形态（铁律 0.6 句式）**：
   * > 「我用『这条边经过了 `inflowCoefficient`』当作『它的标定是对的』的证据，而前者并不度量后者
   * >   —— 对不衰减的目标，预乘 λ 恰恰是错的。」
   *
   * ⛔ **修法不是删门、更不是加白名单**（白名单迟早被例外吃光），而是**把口径收窄成两支**：
   *   支① 目标 ∈ `STATE_VAR_DOMAINS`（会衰减）⇒ **必须**预乘 λ；
   *   支② 目标 ∉ `STATE_VAR_DOMAINS`（不衰减）⇒ **必须不**预乘。
   * 收窄后**比旧门更强**：旧门只有支①这一半，支② 那个方向（本单真正踩到的坑）**一次都没被守过**。
   *
   * **分支判据从真值读、不从文本猜**：`demoPropagationRulesWithDomain()` 是播种与测试**共用的同一支**
   * （`seed.ts` 该函数注释原文「测试与播种共用这一支，不许各算一遍」），
   * 与 `seed-demo-propagation.test.ts` §② 增益预算门的 `STATE_VAR_DOMAINS[r.targetStateVar] !== undefined`
   * **是同一条判据线**，不再各立一份。文本侧只回答「这一行是**怎么写的**」——
   * 这一问**值判不了**：`0.222` 既可能是 `inflowCoefficient(0.6)` 也可能是有人手写的裸 `0.222`，
   * 两者数值逐字节相同。故文本与真值**必须 join**，缺任一半这道门都瞎一只眼。
   */
  it("系数标定分两支：会衰减的目标必须预乘 λ，不衰减的目标必须不预乘（λ 仍取自 C35）", () => {
    // ── 真值侧：规则表（与播种同一支）────────────────────────────────────────────
    const rules = demoPropagationRulesWithDomain();
    // 金丝雀①：规则表必须是真数量级（读成空时下面每一句都会在空集上恒真）
    expect(rules.length, "规则表读成空/读少了 ⇒ 取数坏了，不是「边变少了」").toBeGreaterThanOrEqual(50);

    // ── 文本侧：每条规则的 coefficient **是怎么写的**（包了 inflowCoefficient 还是裸数）──
    // ⚠ 必须**行首锚定**：不锚定会把注释里提到的 `coefficient: z.number()` 也算进来
    // （实测当场报「有边绕过 inflowCoefficient」，而那根本不是字段，是一句中文注释里的引用）。
    // 形态：「我用『源码里出现了 coefficient:』当作『这里有一条边的系数字段』的证据。」
    const wrapped = new Map<string, boolean>();
    for (const blk of ruleBlocks(SRC)) {
      const cm = /^[ \t]*coefficient:[ \t]*([^\n]*)/m.exec(blk.body);
      if (cm) wrapped.set(blk.key, cm[1]!.trimStart().startsWith("inflowCoefficient("));
    }
    // 金丝雀②：文本侧抽到的条数必须与真值表同量级（抽 0 行 = 抽取器坏了）
    expect(wrapped.size, "seed.ts 里抽到的 coefficient 行数（抽 0 行 = 抽取器坏了）").toBeGreaterThanOrEqual(50);
    // 金丝雀③ · join 完整性：真值表里的每条规则都必须在文本里找得到对应行。
    // 少一条就意味着它**两支都进不去**，会被静默漏掉 —— 这正是「扫描器自洽成绿」的经典形态。
    const unjoined = rules.filter((r) => !wrapped.has(r.key)).map((r) => r.key);
    expect(unjoined, "真值表里的规则在 seed.ts 文本里找不到 coefficient 行 ⇒ join 坏了，它会被两支同时漏掉").toEqual([]);

    // ── 分两支（判据来自真值：目标在不在取值域表）────────────────────────────────
    const decaying = rules.filter((r) => STATE_VAR_DOMAINS[r.targetStateVar] !== undefined);
    const exogenous = rules.filter((r) => STATE_VAR_DOMAINS[r.targetStateVar] === undefined);

    // ⛔ 反空绿守卫：任一支扫成空集，那一支的 `toEqual([])` 就在空集上恒真 = 门瞎了一只眼。
    // （域表读成空 ⇒ 支①空；域表把所有量纲都收进去 ⇒ 支②空。两种都必须当场报「量法坏了」。）
    expect(decaying.length, "「会衰减」这一支是空集 ⇒ 量法坏了（STATE_VAR_DOMAINS 读成空？），支① 恒真").toBeGreaterThan(0);
    expect(exogenous.length, "「不衰减」这一支是空集 ⇒ 量法坏了，本门退化成旧的单边门，支② 恒真").toBeGreaterThan(0);

    // 支①：会衰减 ⇒ 必须预乘 λ（漏乘 ⇒ 稳态比描述承诺的大 1/λ ≈ 2.70 倍）
    const missingLambda = decaying
      .filter((r) => wrapped.get(r.key) === false)
      .map((r) => `${r.key}(目标 ${r.targetStateVar} 已声明取值域)`);
    expect(
      missingLambda,
      "目标已声明取值域（引擎每拍按 λ 衰减）却直接写裸系数 ⇒ 稳态会比描述承诺的大 1/λ 倍",
    ).toEqual([]);

    // 支②：不衰减 ⇒ 必须不预乘（多乘 ⇒ 读数恒为真值的 λ 倍，实测 0.37×）
    const spuriousLambda = exogenous
      .filter((r) => wrapped.get(r.key) === true)
      .map((r) => `${r.key}(目标 ${r.targetStateVar} 不在取值域表)`);
    expect(
      spuriousLambda,
      "目标不在取值域表（引擎不衰减、无 λ 可约）却预乘了 λ ⇒ 读数恒为真值的 λ 倍" +
        "（实测：backlogQtyTop 曾长期只报 max(Order.qty) 的 37%，16131 报成 5968.47）",
    ).toEqual([]);

    // λ 必须是 C35 那一个，不是这里内联的一个同值字面量（R14/RL5）。
    const helper = /const inflowCoefficient[\s\S]*?\n};/.exec(SRC)?.[0] ?? "";
    expect(helper, "找不到 inflowCoefficient 定义 ⇒ 抽取器坏了").toContain("PRESSURE_DECAY_PER_TICK");
    expect(helper, "λ 被内联成字面量 0.37 ⇒ 改 C35 规则不再改推演").not.toMatch(/0\.37/);
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
