/**
 * WO-PRESSURE-TO-MONEY 接缝门 —— 「**已交付关闭的订单不该再被涨价推动**」。
 *
 * ⛔ **它咬的是链路不是函数**（SEAM-GATE）：本单拆成三半 ——
 *   ① 契约登记口径 `target_on_hand_gate` / 归一 `NONE`（`packages/contracts/src/sim.ts`）
 *      + 判据谓词 `isOnHandOrderStatus`（`packages/contracts/src/order-status.ts`）
 *   ② DataCore 侧从**本体真数据**（`Order.status`）算 0/1 闸门（`src/sim/pair-weights.ts`）
 *   ③ 引擎侧逐对乘权重（`src/sim/propagation.ts`）
 * 任何一半单独绿都说明不了问题：口径登记了而没实现 ⇒ 报缺；实现了而种子没声明 ⇒ 一格不动；
 * 声明了而引擎不乘 ⇒ 读数照旧。故 §1 一律**从真种子的对象库出发**（真 `Order.status`）
 * 跑到世界态读数上，不手搓权重表。
 *
 * ── 今天的行为 X / 应该的 Y（修前实测·真后端 SEED_DEMO=1·seed 42·铝箔 +15%·tick×3）──
 * **X**：推演层**根本不看订单状态** —— `propagation.ts` 的 `baseAmount = coeff × drive × factor`
 * 没有状态项，建图 `listByType` 不按状态筛。实测同一型号下
 * 一张 `COMPLETED`（`SO-900027`）与一张 `OPEN`（`SO-3431`）拿到**逐字节相同**的
 * `costPressure = 0.155730079229`。被推动 **500/500 张 · 454.64 亿 · 100.0%**，
 * 其中 350 张已交付关闭（占金额 65.55%）—— 料已耗用、成本已锁定，涨价推它们没有业务含义。
 * 拿这个敞口当分母去算毛利，得到的是**精确的错数**，比「算不出来」更坏。
 * **Y**：`COMPLETED` ⇒ 0（不推），在手单读数**逐字节不变**（闸门不把份额摊给别人）。
 * 修后实测：已完成 **0** / 待排产 **0.155730079229**；敞口 **150/500 · 156.63 亿 · 34.5%**。
 *
 * ⚠ 本文件**不新增门脚本 / 棘轮 / 基线 JSON**（仓主禁令 3），只是本单自己的定向测试。
 */
import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import { buildPairWeights } from "../src/sim/pair-weights.js";
import { propagateTick, type PropagationGraph } from "../src/sim/propagation.js";
import {
  isOnHandOrderStatus,
  pairWeightNormalizeOf,
  PAIR_WEIGHT_BASIS_REGISTRY,
  PropagationRuleSchema,
  type PropagationRule,
  type TickState,
} from "@platform/contracts";

const BASIS = "target_on_hand_gate";

/** 真种子那条 `Model.costPressure --model_demanded_by_order--> Order.costPressure`（数值可改）。 */
const costRule = (over: Partial<PropagationRule> = {}): PropagationRule =>
  PropagationRuleSchema.parse({
    id: "r_cost",
    tenantId: "demo",
    key: "demo_model_cost_to_order_cost",
    sourceTypeKey: "Model",
    sourceStateVar: "costPressure",
    viaLinkKey: "model_demanded_by_order",
    targetTypeKey: "Order",
    targetStateVar: "costPressure",
    coefficient: 0.9,
    delayTicks: 0,
    status: "PUBLISHED",
    ...over,
  });

/** 从**真仓储**拼出 Model×Order 这一跳的图（不手搓 id —— 手搓的图在链路改名后照样绿）。 */
async function realGraph(t: TestApp): Promise<PropagationGraph> {
  const objects: PropagationGraph["objects"] = [];
  for (const typeKey of ["Model", "Order"]) {
    for (const o of await t.repos.objects.listByType("demo", typeKey)) {
      if (!o.mergedInto) objects.push({ id: o.id, typeKey: o.type });
    }
  }
  const links = (await t.repos.links.list("demo"))
    .filter((l) => l.type === "model_demanded_by_order")
    .map((l) => ({ fromId: l.fromId, toId: l.toId, linkKey: l.type }));
  return { objects, links };
}

describe("§1 状态闸门：已交付关闭的单不再被涨价推动（真种子 · 真 Order.status）", () => {
  /** 每个型号都压同一个成本压力 ⇒ 差别**只**来自订单状态。 */
  const C = 10;

  async function setup(t: TestApp) {
    const graph = await realGraph(t);
    const orders = await t.repos.objects.listByType("demo", "Order");
    const statusOf = new Map(orders.map((o) => [o.id, String(o.props.status ?? "")]));
    const base: TickState = Object.fromEntries(
      graph.objects.map((o): [string, Record<string, number>] => [
        o.id,
        o.typeKey === "Model" ? { costPressure: C } : { costPressure: 0 },
      ]),
    );
    /** 只看真的有入边的那些单（没有边的单本来就不会动，拿它当证据会把"没边"读成"闸住了"）。 */
    const linked = new Set(graph.links.map((l) => l.toId));
    const done = [...linked].filter((id) => statusOf.get(id) === "COMPLETED").sort();
    const open = [...linked].filter((id) => isOnHandOrderStatus(statusOf.get(id))).sort();
    return { graph, base, done, open, statusOf };
  }

  it("🐤 金丝雀：真种子里三态都有、且都真的挂着边（缺一态 ⇒ 下面的『0 vs 全额』读不出是闸门还是没数据）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const { graph, done, open, statusOf } = await setup(t);
    expect(graph.links.length, "model_demanded_by_order 一条边都没有 ⇒ 取数坏了").toBeGreaterThan(0);
    expect(done.length, "真种子里没有 COMPLETED 单 ⇒ 本用例前提不成立（不是闸门坏了）").toBeGreaterThan(0);
    expect(open.length, "真种子里没有在手单 ⇒ 同上").toBeGreaterThan(0);
    // 谓词与本体数据对得上：在手集合恰好是「非 COMPLETED」（不是"我以为的"那个集合）。
    const linked = new Set(graph.links.map((l) => l.toId));
    const notCompleted = [...linked].filter((id) => statusOf.get(id) !== "COMPLETED").sort();
    expect(open).toEqual(notCompleted);
  });

  it("🔴 头号判据 · SEAM：同一次涨价 ⇒ 已完成单 = 0、在手单 = 全额（四个数缺一不可）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const { graph, base, done, open } = await setup(t);

    // ── 修前：无 weightRef ⇒ 两者**逐字节相同**（这就是病）─────────────────────────
    const before = propagateTick(graph, base, [costRule()], [], 0).next;
    const bDone = before[done[0]!]!.costPressure!;
    const bOpen = before[open[0]!]!.costPressure!;
    expect(bDone, "修前已完成单没被推动 ⇒ 病灶复现不出来，后面的对比无意义").toBeGreaterThan(0);
    expect(bDone).toBe(bOpen); // ← 这就是病：状态完全不进公式

    // ── 修后：挂 `target_on_hand_gate` ⇒ 已完成 0、在手仍是全额 ────────────────────
    const rule = costRule({ weightRef: { basis: BASIS } });
    const { weights, report } = await buildPairWeights(t.repos, "demo", [rule], graph);
    expect(report.unresolved, `权重装配报缺：${JSON.stringify(report.unresolved)}`).toHaveLength(0);
    const after = propagateTick(graph, base, [rule], [], 0, {}, {}, [], weights).next;
    const aDone = after[done[0]!]!.costPressure!;
    const aOpen = after[open[0]!]!.costPressure!;

    expect(aDone, "已完成单仍被推动 ⇒ 闸门没生效").toBe(0);
    expect(aOpen, "在手单没被推动 ⇒ 闸门把不该关的也关了").toBeGreaterThan(0);
    expect(aDone).not.toBe(aOpen); // 修前这里是相等
    // 🔴 **全部**已完成单都归 0（只看第一张会漏掉"恰好那一张是 0"）。
    for (const id of done) expect(after[id]!.costPressure, `已完成单 ${id} 仍被推动`).toBe(0);
    for (const id of open) expect(after[id]!.costPressure, `在手单 ${id} 被误闸`).toBeGreaterThan(0);
    // zeroPairs 与已完成单的条数对得上（回执不说谎）。
    const pairs = report.pairs.find((p) => p.ruleKey === rule.key)!;
    expect(pairs.basis).toBe(BASIS);
    expect(pairs.zeroPairs).toBe(graph.links.filter((l) => done.includes(l.toId)).length);
  });

  it("🔴 闸门**不重新分配**：在手单的读数修前修后**逐字节相同**（NONE 的全部要害）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const { graph, base, open } = await setup(t);
    const before = propagateTick(graph, base, [costRule()], [], 0).next;
    const rule = costRule({ weightRef: { basis: BASIS } });
    const { weights } = await buildPairWeights(t.repos, "demo", [rule], graph);
    const after = propagateTick(graph, base, [rule], [], 0, {}, {}, [], weights).next;
    // 任何**归一**口径都会把已完成单的份额摊给同组幸存者 ⇒ 在手读数会变大。
    // 本条要的是「那 350 张本来就不该被推」⇒ 总量真的变小，而不是换人承担。
    for (const id of open) {
      expect(after[id]!.costPressure, `在手单 ${id} 的读数被闸门改变了 ⇒ 份额被重新分配了`).toBe(
        before[id]!.costPressure,
      );
    }
  });

  it("诚实报缺：目标类型一格 status 都没有 ⇒ unresolved + 原因，**不把整张表压成 0**", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 造一条指向**没有 status 这一列**的类型的规则（Model 上没有 status）。
    const rule = costRule({
      key: "gate_on_typeless",
      sourceTypeKey: "Order",
      viaLinkKey: "model_demanded_by_order",
      targetTypeKey: "Model",
      weightRef: { basis: BASIS },
    });
    // 反向图：Order → Model（让边真的存在，否则走的是"边为 0"那一支，测不到本分支）。
    const graph = await realGraph(t);
    const flipped: PropagationGraph = {
      objects: graph.objects,
      links: graph.links.map((l) => ({ fromId: l.toId, toId: l.fromId, linkKey: l.linkKey })),
    };
    const { weights, report } = await buildPairWeights(t.repos, "demo", [rule], flipped);
    expect(report.unresolved.map((u) => u.ruleKey)).toContain(rule.key);
    expect(report.unresolved.find((u) => u.ruleKey === rule.key)!.reason).toMatch(/status|在不在手/);
    // ⛔ 关键：**没有**给一张全 0 的表 —— 全 0 表会让边静默停摆，且与"闸门正常工作"读起来一样。
    expect(weights[rule.key]).toBeUndefined();
  });
});

describe("§2 口径登记册", () => {
  it(`${BASIS} 在册且归一为 NONE（闸门不归一）`, () => {
    expect(PAIR_WEIGHT_BASIS_REGISTRY.map((b) => b.key)).toContain(BASIS);
    expect(pairWeightNormalizeOf(BASIS)).toBe("NONE");
  });

  it("🔴 与既有三种归一必须**不同** —— 相同就说明闸门又被归一回 1 了", () => {
    for (const k of ["bom_cost_share", "source_qty_relative", "source_value_relative"]) {
      expect(pairWeightNormalizeOf(k)).not.toBe("NONE");
    }
  });

  it("判据谓词来自登记册，不是本层发明的三档系数（RL5）", () => {
    expect(isOnHandOrderStatus("OPEN")).toBe(true);
    expect(isOnHandOrderStatus("IN_PRODUCTION")).toBe(true);
    expect(isOnHandOrderStatus("COMPLETED")).toBe(false);
  });
});
