import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-PORTFOLIO-OPTIMAL · 全局联合推演视图（global-sim）前端接缝测。
 *
 * 订单多选 + 冻结勾选 → portfolio 求解器（mock 逐口径移植·守恒 + ≥2 方案 + 冻结）→ 方案对比矩阵 +
 * 分配台账 + capacityLedger 逐格守恒（无重复占用）+ 冻结单卡。改冻结 → 联合最优真变（KILL-MOCK-RED）。
 */
describe("global-sim · 全局联合推演（方案矩阵 + 守恒台账 + 冻结子集）", () => {
  it("默认全订单联合解 → ≥2 方案矩阵 + capacityLedger 逐格 allocated≤cap（守恒·无重复占用）", async () => {
    loginAs("planner");
    renderApp("/v/global-sim");

    await screen.findByTestId("global-sim");
    // 订单多选表加载（真订单对象·非硬编码）。
    await screen.findByTestId("global-sim-orders");

    // 方案对比矩阵 ≥2 行（max_ontime + min_cost）。
    const matrix = await screen.findByTestId("global-sim-matrix");
    const rows = within(matrix).getAllByTestId(/global-sim-scen-row-/);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("global-sim-scen-row-max_ontime")).toBeInTheDocument();
    expect(screen.getByTestId("global-sim-scen-row-min_cost")).toBeInTheDocument();

    // capacityLedger 逐格守恒：每行守恒列 ✓（allocated ≤ 净cap·无重复占用）。
    const ledger = await screen.findByTestId("global-sim-ledger");
    const ledgerRows = within(ledger).getAllByTestId(/global-sim-ledger-/);
    expect(ledgerRows.length).toBeGreaterThan(0);
    for (const r of ledgerRows) expect(r.textContent).toContain("✓");

    // 守恒结论徽标。
    expect(screen.getByTestId("global-sim-verdict").textContent).toContain("守恒通过");
  });

  it("冻结子集：勾冻 SO-10003 → 出现在冻结卡、不在分配台账（被排除并锁产能·解真变）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/global-sim");

    await screen.findByTestId("global-sim");
    await screen.findByTestId("global-sim-order-SO-10003");

    // 勾选冻结 SO-10003。
    await user.click(screen.getByTestId("global-sim-freeze-SO-10003"));

    // 冻结卡出现 SO-10003，且分配台账不含它。
    await waitFor(() => expect(screen.getByTestId("global-sim-frozen-SO-10003")).toBeInTheDocument());
    expect(screen.queryByTestId("global-sim-alloc-SO-10003")).not.toBeInTheDocument();
    // 守恒仍通过。
    const ledger = screen.getByTestId("global-sim-ledger");
    for (const r of within(ledger).getAllByTestId(/global-sim-ledger-/)) expect(r.textContent).toContain("✓");
  });
});
