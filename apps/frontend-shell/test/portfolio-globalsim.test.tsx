import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-PORTFOLIO-OPTIMAL · 全局项目推演视图（global-sim）前端接缝测。
 *
 * 订单多选 + 冻结勾选 → portfolio 求解器（mock 逐口径移植·守恒 + ≥2 方案 + 冻结）→ 方案对比矩阵 +
 * 分配台账 + capacityLedger 逐格守恒（无重复占用）+ 冻结单卡。改冻结 → 联合最优真变（KILL-MOCK-RED）。
 */
describe("global-sim · 全局项目推演（方案矩阵 + 守恒台账 + 冻结子集）", () => {
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

  it("WO-PORTFOLIO-FG-INVENTORY-OBJ：最少成品库存目标进 UI 方案 + 对比矩阵「成品库存」列渲染（mock 出真 fgInventory）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/global-sim");

    await screen.findByTestId("global-sim");
    const matrix = await screen.findByTestId("global-sim-matrix");
    // 对比矩阵新增「成品库存」列头 + 默认方案行渲染 fgInventory 单元。
    // WO-UNIT-MEANING：列头须带量纲（成品库存口径为**套·天**·裸数字无意义）——退回裸列头即红。
    expect(within(matrix).getByText("成品库存(套·天)")).toBeInTheDocument();
    expect(within(matrix).getByTestId("global-sim-fginv-max_ontime")).toBeInTheDocument();

    // 勾选「最少成品库存」方案 → 进对比矩阵，其成品库存单元渲染真值（非贴标签）。
    await user.click(screen.getByTestId("global-sim-scen-min_fg_inventory"));
    await waitFor(() => expect(screen.getByTestId("global-sim-scen-row-min_fg_inventory")).toBeInTheDocument());
    const fgCell = screen.getByTestId("global-sim-fginv-min_fg_inventory");
    expect(fgCell).toBeInTheDocument();
    expect(Number.isNaN(Number(fgCell.textContent!.replace(/[^0-9.-]/g, "")))).toBe(false);
  });

  it("windowDays 正口径：时间窗标注 = 引擎真实 windowDays 14（校正「标 21 实跑 14」·KILL-MOCK-RED）", async () => {
    loginAs("planner");
    renderApp("/v/global-sim");

    // datacore portfolio 求解器真实口径 windowDays = coeff("windowDays", 14)，仓内无 PUBLISHED
    // `portfolio_optimize_coeffs` 覆盖 → 引擎实跑缺省 14（另见 datacore actions.ts windowDaysGuess=14）。
    // UI 的时间窗标注必须与后端同口径，不得回退到旧的假口径 21（历史误标「标 21 实跑 14」·误导用户）。
    const bar = await screen.findByTestId("global-sim-batchbar");
    await waitFor(() => expect(bar.textContent).toContain("每窗 14 天"));
    expect(bar.textContent).not.toMatch(/21\s*天/);
  });
});
