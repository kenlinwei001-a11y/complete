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
import { pairWeightNormalizeOf, type PropagationRule, type TickState } from "@platform/contracts";

const SEED_TS = join(dirname(fileURLToPath(import.meta.url)), "../src/seed.ts");

/** 一条 Order→Customer 形状的规则（身份格照真种子那条，数值可改）。 */
const arRule = (over: Partial<PropagationRule> = {}): PropagationRule => ({
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
  description: null,
  combine: "sum",
  decay: null,
  clamp: null,
  coefficientRef: null,
  weightRef: null,
  cadenceNodeId: null,
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
    GRAPH.objects.map((o) => [o.id, o.typeKey === "Order" ? { costPressure: C } : { receivablePressure: 0 }]),
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
    expect(next.cMany!.receivablePressure / next.cBig!.receivablePressure).toBe(1.5); // = 单数比 3/2
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
  /** 从 seed.ts 抽 (key, coefficient, description) 三元组。**主逻辑与金丝雀共用这一支**。 */
  function scan(src: string): { key: string; coef: number; stated: number[]; ok: boolean }[] {
    const idxs: { key: string; at: number }[] = [];
    const re = /key:\s*"([a-z0-9_]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) idxs.push({ key: m[1]!, at: m.index });
    const out: { key: string; coef: number; stated: number[]; ok: boolean }[] = [];
    for (let i = 0; i < idxs.length; i++) {
      const body = src.slice(idxs[i]!.at, i + 1 < idxs.length ? idxs[i + 1]!.at : src.length);
      const cm = /coefficient:\s*(-?[\d.]+)/.exec(body);
      if (!cm) continue; // 不是传导规则块
      const dm = /description:\s*"((?:[^"\\]|\\.)*)"/.exec(body);
      if (!dm) continue;
      const stated = [...dm[1]!.matchAll(/[×x]\s*(-?[\d.]+)/g)].map((x) => Number(x[1]));
      if (stated.length === 0) continue; // 描述里没写数 ⇒ 不判定（合法）
      const coef = Number(cm[1]);
      out.push({ key: idxs[i]!.key, coef, stated, ok: stated.some((s) => Math.abs(s - coef) < 1e-9) });
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

  it("种子里 0 条描述与真系数不符", () => {
    const rows = scan(SRC);
    // 金丝雀②：扫到的规则块数必须是真数量级，抽 0 条时上面那句"0 条不符"毫无意义。
    expect(rows.length, "描述里写了系数的边条数（抽 0 条 = 抽取器坏了）").toBeGreaterThanOrEqual(13);
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
