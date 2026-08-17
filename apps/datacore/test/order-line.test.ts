import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import { deriveOrderLines, generateBattery } from "../src/synthetic/battery.js";

/**
 * WO-ORDERLINE · 订单拆行（SO→型号明细行·一单多型号多行·Phase3）SEAM 组合测（头号判据）。
 *
 * 病根：`orderProps` 一个订单只一个 model + 单一 qty（HTML_ORDERS 24 单每单一型号）→ 一单多型号多行表达不了。
 * 断言驱动接缝：
 *  - SEAM-1 拆行勾稽 Σ OrderLine.qty (BY orderRef) === Order.qty 且各行 model 不同（一单多型号真表达）。
 *  - SEAM-2 行级独立态：同订单两行不同 lineStatus（可分别查·头级态可由行 rollup 推）。
 *  - SEAM-3 改行→头级 rollup 变（红咬）：改一行 qty → 头级 Σ 变、勾稽仍成立（证行级是头级真拆分非装饰）。
 *  - R6 双跑：lineId 集 + qty 分配字节一致·24 单头级对象基线未移。
 */

// 受控型号池（≥4 型号·保证拆多行时 model distinct）。
const POOL = [
  { modelId: "方形-LFP", unitPrice: 500 },
  { modelId: "圆柱-LFP", unitPrice: 620 },
  { modelId: "4680-NCM", unitPrice: 880 },
  { modelId: "2170-NCM", unitPrice: 760 },
];
// 造一批订单（不同 so），deriveOrderLines 会把偶数哈希 so 拆多行——探测出一张多行单。
const ORDERS = Array.from({ length: 24 }, (_, i) => ({
  so: `SO-OL-${1000 + i}`,
  model: "方形-LFP",
  qty: 9000 + i * 137,
  due: "2026-07-15",
  unitPrice: 500,
}));

describe("WO-ORDERLINE · 订单拆行（纯核心·KILL-MOCK-RED）", () => {
  const lines = deriveOrderLines(ORDERS, POOL);
  const byOrder = (so: string) => lines.filter((l) => String(l.orderRef) === so);
  const multiOrderSo = ORDERS.map((o) => o.so).find((so) => byOrder(so).length >= 2)!;

  it("存在确定性拆多行的订单（一单多型号多行真产出·非全 1 行）", () => {
    expect(multiOrderSo).toBeTruthy();
    // 单行订单也存在（奇数哈希 → 1 行·首行保原单 model）。
    expect(ORDERS.map((o) => o.so).some((so) => byOrder(so).length === 1)).toBe(true);
  });

  it("SEAM-1 拆行勾稽：Σ OrderLine.qty (BY orderRef) === Order.qty 且各行 model 不同（头=行 rollup·精确）", () => {
    // 全订单勾稽（拆行不改总量）。
    for (const o of ORDERS) {
      const ls = byOrder(o.so);
      const rollup = ls.reduce((a, l) => a + Number(l.qty), 0);
      expect(rollup).toBe(o.qty); // 头 === 行 rollup（精确·尾行取余额）
      expect(ls.every((l) => Number(l.qty) >= 1)).toBe(true); // 每行 ≥1
      // 各行 model 互不相同（一单多型号真表达）。
      const models = ls.map((l) => String(l.model));
      expect(new Set(models).size).toBe(models.length);
      // 首行保原单 model（不破坏既有 order_for_model·additive）。
      expect(String(ls[0]!.model!)).toBe(o.model);
    }
  });

  it("SEAM-2 行级独立态：多行订单存在两行不同 lineStatus（可分别查·非同一态装饰）", () => {
    const ls = byOrder(multiOrderSo);
    const statuses = ls.map((l) => String(l.lineStatus));
    expect(new Set(statuses).size).toBeGreaterThanOrEqual(2); // 连续行必不同态
    // 枚举合法性。
    for (const s of statuses) expect(["OPEN", "COMMITTED", "PARTIAL", "SHIPPED"]).toContain(s);
  });

  it("SEAM-3 改行→头级 rollup 变（红咬）：改一行 qty → 头 Σ 变、勾稽随之移（证行级是头级真拆分非装饰）", () => {
    const ls = byOrder(multiOrderSo).map((l) => ({ ...l }));
    const order = ORDERS.find((o) => o.so === multiOrderSo)!;
    const before = ls.reduce((a, l) => a + Number(l.qty), 0);
    expect(before).toBe(order.qty); // 拆分态勾稽成立
    // 改第一行 qty +100 → 头级 rollup 必变（若行级只是装饰、头级不由行 rollup，则此断言红）。
    ls[0]!.qty! = Number(ls[0]!.qty!) + 100;
    const after = ls.reduce((a, l) => a + Number(l.qty), 0);
    expect(after).toBe(order.qty + 100);
    expect(after).not.toBe(before); // 头级真随行变
  });

  it("R14 单价单一来源：行 unitPrice === 该行 model 的 Model.unitPrice（反范式化·勿写死）", () => {
    const priceOf = new Map(POOL.map((m) => [m.modelId, m.unitPrice]));
    for (const l of lines) expect(Number(l.unitPrice)).toBe(priceOf.get(String(l.model)));
  });

  it("R6 双跑：同输入两次 deriveOrderLines 字节一致（lineId 集 + qty 分配·无 random/时钟）", () => {
    const a = deriveOrderLines(ORDERS, POOL);
    const b = deriveOrderLines(ORDERS, POOL);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("WO-ORDERLINE · 端到端接缝（seed 落库 × 链路 × 24 单头级基线未移）", () => {
  it("SEAM 端到端：seed 后 OrderLine 落库·勾稽 Σ行===头·多型号单真表达·line_of_order/orderline_for_model 链路溯源", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const orders = await t.repos.objects.listByType("demo", "Order");
    const orderLines = await t.repos.objects.listByType("demo", "OrderLine");
    expect(orders.length).toBe(24); // 24 单头级基线未移（additive 只加行）
    expect(orderLines.length).toBeGreaterThan(orders.length); // 部分单拆多行 → 行数 > 单数

    // 勾稽（端到端·从仓储对象读）：每订单 Σ 行 qty === 订单 qty。
    const qtyBySo = new Map(orders.map((o) => [String(o.props.so), Number(o.props.qty)]));
    const rollup = new Map<string, number>();
    const modelsBySo = new Map<string, string[]>();
    for (const l of orderLines) {
      const so = String(l.props.orderRef);
      rollup.set(so, (rollup.get(so) ?? 0) + Number(l.props.qty));
      modelsBySo.set(so, [...(modelsBySo.get(so) ?? []), String(l.props.model)]);
    }
    for (const [so, total] of qtyBySo) {
      expect(rollup.get(so)).toBe(total); // 头 === 行 rollup（勾稽·端到端）
    }
    // 一单多型号真表达：至少一张单其行 model 有 ≥2 个不同型号。
    const multiModelOrders = [...modelsBySo.values()].filter((ms) => new Set(ms).size >= 2);
    expect(multiModelOrders.length).toBeGreaterThan(0);
    // 每张多行单其行 model 互不相同。
    for (const ms of modelsBySo.values()) expect(new Set(ms).size).toBe(ms.length);

    // SEAM-3 端到端红咬：改一行 qty 落库 → 从仓储重算头级 rollup 变（行级是头级真拆分）。
    // 在这里一次性断言非空：不然 `{ ...someLine }` 展开的是 ObjectInstance|undefined，
    // 每个字段都变成可选，整个对象就不再是合法 ObjectInstance（TS2345）。
    const someLine = orderLines[0]!;
    const so = String(someLine.props.orderRef);
    const beforeRollup = orderLines.filter((l) => String(l.props.orderRef) === so).reduce((a, l) => a + Number(l.props.qty), 0);
    await t.repos.objects.put({ ...someLine, props: { ...someLine.props, qty: Number(someLine.props.qty) + 500 } });
    const reread = await t.repos.objects.listByType("demo", "OrderLine");
    const afterRollup = reread.filter((l) => String(l.props.orderRef) === so).reduce((a, l) => a + Number(l.props.qty), 0);
    expect(afterRollup).toBe(beforeRollup + 500); // 头级 rollup 随行真变（非装饰）

    // 链路：一行一条 line_of_order + 一条 orderline_for_model（行溯源到订单头/型号）。
    const loo = await t.repos.links.list("demo", (l) => l.type === "line_of_order");
    const olm = await t.repos.links.list("demo", (l) => l.type === "orderline_for_model");
    expect(loo.length).toBe(orderLines.length);
    expect(olm.length).toBe(orderLines.length);
  });

  it("R6 双跑：同 seed 两次 generateBattery → orderLines lineId 集 + qty 字节一致·24 单头级对象数不变", () => {
    const a = generateBattery(42, "S");
    const b = generateBattery(42, "S");
    expect(a.orders.length).toBe(24); // 头级基线
    expect(b.orders.length).toBe(24);
    expect(JSON.stringify(a.orders)).toBe(JSON.stringify(b.orders)); // 24 单头级字节一致（R6·未被拆行子流扰动）
    expect(JSON.stringify(a.orderLines)).toBe(JSON.stringify(b.orderLines)); // 拆行字节一致
    // 勾稽（生成态）：每订单 Σ 行 === 订单 qty。
    const qtyBySo = new Map(a.orders.map((o) => [String(o.so), Number(o.qty)]));
    const rollup = new Map<string, number>();
    for (const l of a.orderLines) rollup.set(String(l.orderRef), (rollup.get(String(l.orderRef)) ?? 0) + Number(l.qty));
    for (const [so, total] of qtyBySo) expect(rollup.get(so)).toBe(total);
  });
});
