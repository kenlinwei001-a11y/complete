import { describe, it, expect } from "vitest";
import { currentDay, currentMonth, currentQuarter, DEFAULT_SIM_T0 } from "../src/clockderive.js";
import { deriveExtendedArgs } from "../src/solvers/extended.js";
import type { SolverContext } from "../src/solvers/types.js";
import { BATTERY_SOLVER_PARAMS } from "../src/synthetic/battery.js";

/**
 * HARDCODE-CLOCK-DERIVE 门牙（审计 Hδ）——「当前」月/季/日由 sim-clock t0 派生·非硬编码。
 * teeth：改 t0 → 派生随之变；退回硬编码字面（旧 "2026-07"/"2026Q2"）→ 本用例即红。
 * R6：t0=2026-06-10（§A8 demo 权威）派生 == 旧字面语义（月对齐修正后）·确定性同 t0 同果。
 */

function ctxWithT0(t0: string): SolverContext {
  return {
    tenantId: "t",
    params: { ...BATTERY_SOLVER_PARAMS, forecastStart: t0 },
    materials: [],
    customers: [],
    arInvoices: [],
  } as unknown as SolverContext;
}

describe("clockderive · 「当前」由 t0 派生", () => {
  it("helper：月/季/日 = t0 对应值（demo t0=2026-06-10）", () => {
    expect(DEFAULT_SIM_T0).toBe("2026-06-10");
    expect(currentDay("2026-06-10")).toBe("2026-06-10");
    expect(currentMonth("2026-06-10")).toBe("2026-06");
    expect(currentQuarter("2026-06-10")).toBe("2026-Q2");
  });

  it("teeth：改 t0 → 派生月/季/日随之变（非写死）", () => {
    expect(currentMonth("2026-09-15")).toBe("2026-09");
    expect(currentQuarter("2026-09-15")).toBe("2026-Q3");
    expect(currentDay("2026-09-15")).toBe("2026-09-15");
    // 跨年 + Q1/Q4 边界
    expect(currentQuarter("2027-01-02")).toBe("2027-Q1");
    expect(currentQuarter("2026-12-31")).toBe("2026-Q4");
  });

  it("teeth：extended lta_gap 默认月 = currentMonth(t0)，非硬编码 '2026-07'", () => {
    // t0=2026-06-10 → 2026-06（旧硬编码 2026-07 与 t0 错位·此为真 bug 修正）。
    expect((deriveExtendedArgs(ctxWithT0("2026-06-10"), "lta_gap", {}) as { month: string }).month).toBe("2026-06");
    // 改 t0 → 默认月随之变（写死则此断言红）。
    expect((deriveExtendedArgs(ctxWithT0("2026-11-20"), "lta_gap", {}) as { month: string }).month).toBe("2026-11");
    // 显式传 month 覆盖派生（向后兼容）。
    expect((deriveExtendedArgs(ctxWithT0("2026-06-10"), "lta_gap", { month: "2027-01" }) as { month: string }).month).toBe("2027-01");
  });

  it("teeth：extended quarterly_gap 默认季 = currentQuarter(t0)，非硬编码 '2026Q2'（且格式为 YYYY-Qn）", () => {
    expect((deriveExtendedArgs(ctxWithT0("2026-06-10"), "quarterly_gap", {}) as { quarter: string }).quarter).toBe("2026-Q2");
    expect((deriveExtendedArgs(ctxWithT0("2026-09-15"), "quarterly_gap", {}) as { quarter: string }).quarter).toBe("2026-Q3");
    expect((deriveExtendedArgs(ctxWithT0("2026-06-10"), "quarterly_gap", { quarter: "2026-Q4" }) as { quarter: string }).quarter).toBe("2026-Q4");
  });
});
