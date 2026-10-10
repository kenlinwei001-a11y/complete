import { describe, expect, it } from "vitest";
import { invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { computeOrderPromise, deriveOrderPromises, type AtpSupplyInputs } from "../src/synthetic/battery.js";

/**
 * WO-ATP-PROMISE · 订单承诺（ATP/CTP·「这单能不能接、何时交」）SEAM 组合测（头号判据·数据半×引擎半一 dev）。
 *
 * 净读三源供给：① 成品现货 FinishedGoodsInventory.qtyOnHand ② 在制未交 WorkOrder.qtyActual
 * ③ 交期前可排产能 Σ 可产 Line.max_capacity_day × 交期前净生产窗口天。
 * 断言驱动接缝：改产能/库存颗粒 → committableQty/promiseDate/atpStatus 真变（红咬）。
 */

const T0 = "2026-06-10"; // forecastStart（asOf 固定 T0·R6）

// 一张交期前需排产的订单（现货+在制不足 → 依赖产能填满，产能一动承诺就变）。
const ORDER = { model: "4680-NCM", qty: 1000, due: "2026-06-14", bases: ["changzhou"] }; // dueDay=4
const mkSupply = (capPerDay: number, onHand: number): AtpSupplyInputs => ({
  finishedGoodsInv: [{ model: "4680-NCM", qtyOnHand: onHand, qtyReserved: 0 }],
  workOrders: [{ modelId: "4680-NCM", qtyActual: 100, status: "生产中" }], // 在制未交 100
  lines: [{ baseId: "changzhou", max_capacity_day: capPerDay }],
});

describe("WO-ATP-PROMISE · 订单承诺（ATP/CTP）净室三源承诺", () => {
  // ---- 纯核心（KILL-MOCK-RED·改颗粒→承诺必变，最紧红咬） ----
  it("SEAM-1 改产能→承诺真变：Line.max_capacity_day 调高/低 → committableQty/promiseDate 随之变", () => {
    // 基线：产能 100/日 → 交期前(4天)可排 400；现货200+在制100+排产400=700 < 需求1000 → PARTIAL
    const base = computeOrderPromise(ORDER, mkSupply(100, 200), T0);
    expect(base.atpStatus).toBe("PARTIAL");
    expect(base.committableQty).toBe(700); // 200+100+400
    expect(base.shortfallQty).toBe(300);
    expect(base.bottleneck).toBe("产能");
    expect(base.promiseDate).toBe("2026-06-17"); // ceil(700/100)=7 天 → T0+7（超交期）

    // 调高产能 → 可承接量增、承诺日提前、翻 CONFIRMED（红咬：solver 忽略产能则不变即红）
    const up = computeOrderPromise(ORDER, mkSupply(300, 200), T0);
    expect(up.committableQty).toBe(1000); // 200+100+min(1200,700)=1000
    expect(up.atpStatus).toBe("CONFIRMED");
    expect(up.shortfallQty).toBe(0);
    expect(up.committableQty).toBeGreaterThan(base.committableQty);
    expect(Date.parse(up.promiseDate!)).toBeLessThan(Date.parse(base.promiseDate!)); // 承诺日提前

    // 调低产能 → 可承接量减、承诺日推后
    const down = computeOrderPromise(ORDER, mkSupply(50, 200), T0);
    expect(down.committableQty).toBe(500); // 200+100+min(200,700)=500
    expect(down.committableQty).toBeLessThan(base.committableQty);
    expect(Date.parse(down.promiseDate!)).toBeGreaterThan(Date.parse(base.promiseDate!));
  });

  it("SEAM-2 改库存→承诺真变：FG.qtyOnHand 变 → committableQty 变·atpStatus CONFIRMED↔PARTIAL 翻转", () => {
    const partial = computeOrderPromise(ORDER, mkSupply(100, 200), T0); // 现货200 → PARTIAL 700
    expect(partial.atpStatus).toBe("PARTIAL");

    // 现货抬到覆盖全需求 → 翻 CONFIRMED、承诺日即 T0（无需排产）
    const confirmed = computeOrderPromise(ORDER, mkSupply(100, 1000), T0);
    expect(confirmed.committableQty).toBe(1000);
    expect(confirmed.atpStatus).toBe("CONFIRMED");
    expect(confirmed.promiseDate).toBe(T0); // 现货即今日
    expect(confirmed.committableQty).toBeGreaterThan(partial.committableQty);

    // 现货清零 → 可承接量再降（红咬：solver 忽略库存则不变即红）
    const none = computeOrderPromise(ORDER, mkSupply(100, 0), T0);
    expect(none.committableQty).toBe(500); // 0+100+min(400,900)=500
    expect(none.committableQty).toBeLessThan(partial.committableQty);
  });

  it("勾稽：committableQty = Σbreakdown[].qty（现货+在制+排产 ≤ requestedQty）· shortfallQty = requestedQty − committableQty", () => {
    for (const s of [mkSupply(100, 200), mkSupply(300, 200), mkSupply(50, 0), mkSupply(100, 1000)]) {
      const r = computeOrderPromise(ORDER, s, T0);
      const sum = r.breakdown.reduce((a, b) => a + b.qty, 0);
      expect(sum).toBe(r.committableQty); // 三源拆解 Σ = 可承接量
      expect(r.committableQty).toBeLessThanOrEqual(r.requestedQty);
      expect(r.shortfallQty).toBe(r.requestedQty - r.committableQty);
      // 顺序：现货→在制→排产
      expect(r.breakdown.map((b) => b.source)).toEqual(["现货", "在制", "排产"]);
    }
  });

  it("R6 双跑：同输入两次 computeOrderPromise deep-equal（无 random/时钟）", () => {
    const a = computeOrderPromise(ORDER, mkSupply(100, 200), T0);
    const b = computeOrderPromise(ORDER, mkSupply(100, 200), T0);
    expect(a).toEqual(b);
  });

  it("诚实透出：无可产产线 → 排产源=0·promiseDate=null·bottleneck=齐套", () => {
    const noLine = computeOrderPromise(ORDER, { finishedGoodsInv: [], workOrders: [], lines: [] }, T0);
    expect(noLine.committableQty).toBe(0);
    expect(noLine.atpStatus).toBe("UNMET");
    expect(noLine.promiseDate).toBeNull();
    expect(noLine.bottleneck).toBe("齐套");
  });

  // ---- 引擎半 SEAM-GATE：atp_check 求解器读对象图，改仓储颗粒 → 重跑承诺真变（端到端接缝） ----
  it("SEAM 端到端·atp_check 读对象图：改 Line.max_capacity_day（产能）与 FG.qtyOnHand（库存）→ 重跑承诺随之变", async () => {
    const t: TestApp = await makeApp();
    // 受控最小对象图（净读三源；无其它 Line/FG/WO 干扰）
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "obj_order_SOATP1", tenantId: "demo", type: "Order", props: { so: "SO-ATP-1", model: "4680-NCM", qty: 1000, due: "2026-06-14", bases: ["changzhou"], status: "OPEN" } });
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "obj_fg_1", tenantId: "demo", type: "FinishedGoodsInventory", props: { fgId: "FG-1", model: "4680-NCM", qtyOnHand: 200, qtyReserved: 0 } });
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "obj_wo_1", tenantId: "demo", type: "WorkOrder", props: { woId: "WO-1", modelId: "4680-NCM", qtyActual: 100, status: "生产中" } });
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "obj_line_1", tenantId: "demo", type: "Line", props: { lineId: "L1", baseId: "changzhou", max_capacity_day: 100 } });

    // 基线：PARTIAL·可承接 700·承诺日 2026-06-17·卡口 产能
    const base = (await invokeSolver(t, "atp_check", { orderRef: "SO-ATP-1" }).then((r) => r.json())) as { data: Record<string, unknown> };
    expect(base.data.atpStatus).toBe("PARTIAL");
    expect(base.data.committableQty).toBe(700);
    expect(base.data.promiseDate).toBe("2026-06-17");
    expect(base.data.bottleneck).toBe("产能");
    // 勾稽：三源拆解 Σ = 可承接量
    const bd = base.data.breakdown as { source: string; qty: number }[];
    expect(bd.reduce((a, b) => a + b.qty, 0)).toBe(700);

    // 改产能颗粒（调高）→ 重跑 → CONFIRMED·可承接 1000·承诺日提前（引擎真读 Line·红咬）
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "obj_line_1", tenantId: "demo", type: "Line", props: { lineId: "L1", baseId: "changzhou", max_capacity_day: 300 } });
    const capUp = (await invokeSolver(t, "atp_check", { orderRef: "SO-ATP-1" }).then((r) => r.json())) as { data: Record<string, unknown> };
    expect(capUp.data.committableQty).toBe(1000);
    expect(capUp.data.atpStatus).toBe("CONFIRMED");
    expect(Date.parse(capUp.data.promiseDate as string)).toBeLessThan(Date.parse(base.data.promiseDate as string));

    // 复位产能 + 改库存颗粒（现货抬满）→ 重跑 → CONFIRMED（库存翻转·引擎真读 FG·红咬）
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "obj_line_1", tenantId: "demo", type: "Line", props: { lineId: "L1", baseId: "changzhou", max_capacity_day: 100 } });
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "obj_fg_1", tenantId: "demo", type: "FinishedGoodsInventory", props: { fgId: "FG-1", model: "4680-NCM", qtyOnHand: 1000, qtyReserved: 0 } });
    const stockUp = (await invokeSolver(t, "atp_check", { orderRef: "SO-ATP-1" }).then((r) => r.json())) as { data: Record<string, unknown> };
    expect(stockUp.data.committableQty).toBe(1000);
    expect(stockUp.data.atpStatus).toBe("CONFIRMED"); // PARTIAL→CONFIRMED 库存驱动翻转
    expect(stockUp.data.promiseDate).toBe(T0); // 现货即今日

    // R6：同仓储态两跑 atp_check deep-equal（净读纯算·无时钟随机）
    const r1 = (await invokeSolver(t, "atp_check", { orderRef: "SO-ATP-1" }).then((r) => r.json())) as { data: unknown };
    const r2 = (await invokeSolver(t, "atp_check", { orderRef: "SO-ATP-1" }).then((r) => r.json())) as { data: unknown };
    expect(r1.data).toEqual(r2.data);
  });

  // ---- 数据半：种子 OrderPromise 台账（每 OPEN 订单一条·与 atp_check 同口径） + 链路 ----
  it("种子：每 OPEN 订单一条 OrderPromise + promise_for_order 链路溯源到订单（确定性）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const orders = await t.repos.objects.listByType("demo", "Order");
    const openOrders = orders.filter((o) => String(o.props.status) === "OPEN");
    const promises = await t.repos.objects.listByType("demo", "OrderPromise");
    expect(promises.length).toBeGreaterThan(0);
    expect(promises.length).toBe(openOrders.length); // 一 OPEN 订单一承诺行

    // 每条承诺 orderRef 溯源到真订单 + 勾稽 shortfall = requested − committable + 状态枚举合法
    const orderSos = new Set(orders.map((o) => String(o.props.so)));
    for (const p of promises) {
      expect(orderSos.has(String(p.props.orderRef))).toBe(true);
      expect(Number(p.props.shortfallQty)).toBe(Number(p.props.requestedQty) - Number(p.props.committableQty));
      expect(["CONFIRMED", "PARTIAL", "UNMET"]).toContain(String(p.props.atpStatus));
      expect(String(p.props.asOf)).toBe(T0);
    }
    // promise_for_order 链路：每条承诺一条边
    const links = await t.repos.links.list("demo", (l) => l.type === "promise_for_order");
    expect(links.length).toBe(promises.length);
  });

  it("R6 双跑：同 seed 两次 deriveOrderPromises 字节一致", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const orders = (await t.repos.objects.listByType("demo", "Order")).map((o) => o.props);
    const fg = (await t.repos.objects.listByType("demo", "FinishedGoodsInventory")).map((o) => o.props);
    const wo = (await t.repos.objects.listByType("demo", "WorkOrder")).map((o) => o.props);
    const lines = (await t.repos.objects.listByType("demo", "Line")).map((o) => o.props);
    const a = deriveOrderPromises(orders, fg, wo, lines, T0);
    const b = deriveOrderPromises(orders, fg, wo, lines, T0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.length).toBeGreaterThan(0);
  });
});
