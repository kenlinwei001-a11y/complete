import { describe, expect, it } from "vitest";
import { applyOrderOverride } from "../src/solvers/risk.js";

/**
 * PRD-IND-dash ORDER_OVR：逐单越线注入（6 单 override）。
 * 纯函数 applyOrderOverride 确定性应用信用/毛利覆盖（R6）；6 单 PRD 逐字值种子于 battery.ts
 * affected.problems.overrides，活化于 HTML 24 单订单集（SO-3391…SO-3540）。
 */
describe("order ORDER_OVR · 逐单越线注入（applyOrderOverride 纯函数）", () => {
  it("credit override → 信用占用比强制越限（≥1.05，触发 CREDIT）", () => {
    expect(applyOrderOverride(0.8, 15, { credit: true }).creditRatio).toBeGreaterThan(1);
    expect(applyOrderOverride(1.2, 15, { credit: true }).creditRatio).toBe(1.2); // 已越限保持更高值
    expect(applyOrderOverride(0.8, 15, { credit: true }).gm).toBe(15); // 仅动信用
  });

  it("mAdj override → 细分毛利下调（可能跌破底线触发 MARGIN）", () => {
    expect(applyOrderOverride(0.8, 15, { mAdj: -3.2 }).gm).toBe(11.8);
    expect(applyOrderOverride(0.8, 15, { mAdj: -3.2 }).creditRatio).toBe(0.8); // 仅动毛利
  });

  it("无 override → 原样返回（hash 口径不变，R6）", () => {
    expect(applyOrderOverride(0.8, 15, undefined)).toEqual({ creditRatio: 0.8, gm: 15 });
    expect(applyOrderOverride(0.95, 14, {})).toEqual({ creditRatio: 0.95, gm: 14 });
  });
})
