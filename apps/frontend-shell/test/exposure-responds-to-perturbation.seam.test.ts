/**
 * ══ SEAM · 扰动影响面必须**随扰动变化** ══════════════════════════════════════════
 *
 * 仓主实拍（2026-09-14）：「我输入不同的扰动因素，该截屏数据没有变化…前端展示的都是假的？」
 * 真浏览器对照实验证实：原材料涨价 vs 设备故障 → 150/350/17家/156.6亿 **逐字节相同**。
 *
 * 本门就是那次事故的机器化。⛔ 断言的是**关系**（不同输入⇒不同输出），不是**值**：
 * 写死期望值的断言，在被测逻辑改成另一个恒定值时照样能改绿；这一条改不绿。
 */
import { describe, expect, it } from "vitest";
import { respondsToInput, stableForSameInput } from "@platform/contracts";
import { buildMoneyView, type CellDelta, type OrderRow } from "../src/views/sim/unified/console0828/console0828Model";

/** 真实形态的订单：三种状态按实测比例（COMPLETED 350 / IN_PRODUCTION 100 / OPEN 50 的缩样）。 */
const ORDERS: OrderRow[] = [
  ...Array.from({ length: 7 }, (_, i) => ({ id: `o_done_${i}`, cust: `C${i % 3}`, qty: 10, value: 1e8, due: null, status: "COMPLETED", model: "M" })),
  ...Array.from({ length: 2 }, (_, i) => ({ id: `o_prod_${i}`, cust: `C${i}`, qty: 10, value: 1e8, due: null, status: "IN_PRODUCTION", model: "M" })),
  { id: "o_open_0", cust: "C0", qty: 10, value: 1e8, due: null, status: "OPEN", model: "M" },
];
const d = (id: string, delta: number): CellDelta => ({ objectId: id, stateVar: "costPressure", before: 50, after: 50 + delta, delta });
const noCause = (): string | null => null;

// 扰动 A：两张未完成单被**实质推动**（幅度 5 / 3）
const A: CellDelta[] = [d("o_prod_0", 5), d("o_prod_1", 3), d("o_open_0", 2), d("o_done_0", 9)];
// 扰动 B：同样三张单都动了，但**全在噪声级**（≤0.01）——业务上等于没影响
const B: CellDelta[] = [d("o_prod_0", 0.002), d("o_prod_1", 0.001), d("o_open_0", 0.003), d("o_done_0", 9)];

describe("SEAM · 扰动影响面随扰动变化", () => {
  it("① 两个不同扰动 ⇒ 被推动的单数必须不同（这一条就是那次事故）", () => {
    const va = buildMoneyView(A, ORDERS, noCause);
    const vb = buildMoneyView(B, ORDERS, noCause);
    const r = respondsToInput("被推动的单", va, vb, (v) => v.exposedOrders);
    expect(r.ok, r.message).toBe(true);
  });

  it("② 敞口金额同口径 —— 否则会出现「单数变了金额没变」的自相矛盾", () => {
    const r = respondsToInput("合计敞口", buildMoneyView(A, ORDERS, noCause), buildMoneyView(B, ORDERS, noCause), (v) => v.exposure);
    expect(r.ok, r.message).toBe(true);
  });

  it("③ 反向金丝雀：同一个扰动跑两次必须完全相同（R6）", () => {
    const r = stableForSameInput("被推动的单", buildMoneyView(A, ORDERS, noCause), buildMoneyView(A, ORDERS, noCause), (v) => v.exposedOrders);
    expect(r.ok, r.message).toBe(true);
  });

  it("④ 已完成单一张都不进影响面（仓主报的原始 bug）", () => {
    const v = buildMoneyView(A, ORDERS, noCause);
    expect(v.settledExcluded, "引擎给已完成单算了 delta，本视图必须把它们计入 settledExcluded 并排除").toBe(1);
    expect(v.exposedOrders + v.settledExcluded + v.faintOnly).toBe(new Set(A.map((x) => x.objectId)).size);
  });
});
