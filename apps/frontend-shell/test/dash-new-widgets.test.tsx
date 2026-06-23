import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * PRD-cockpit §2.1 补遗：经营驾驶舱 order-ledger（订单经营台账）+ plan-drill（规划决策推演）widget。
 * 配套真前端 Playwright 验证（门B）已通过；此为 CI 回归（断言可交互，不止渲染）。
 */
describe("dash · order-ledger + plan-drill widget（补遗）", () => {
  it("订单经营台账：台账行 + 综合毛利率 + 细分筛选 + 点行下钻 order-chain", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    const { router } = renderApp("/v/dash");
    const ledger = await screen.findByTestId("dash-order-ledger");
    // 等 affected_orders 异步加载完（台账行渲染）
    await waitFor(() => expect(ledger.querySelectorAll('[data-testid^="ledger-row-"]').length).toBeGreaterThan(0));
    expect(within(ledger).getByTestId("ledger-gmrate")).toBeInTheDocument();
    expect(ledger.querySelectorAll('[data-testid^="ledger-seg-"]').length).toBeGreaterThan(1);
    const rows = ledger.querySelectorAll('[data-testid^="ledger-row-"]');
    await user.click(rows[0] as HTMLElement);
    await waitFor(() => expect(router.state.location.pathname).toBe("/v/order-chain"));
  });

  it("规划决策推演：4 级别 chip + KPI 条 + 点开根因 DAG + 去体检导航 plan-audit", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    const { router } = renderApp("/v/dash");
    const drill = await screen.findByTestId("dash-plan-drill");
    expect(drill.querySelectorAll('[data-testid^="drill-level-"]').length).toBe(4);
    // 等 plan_rootcause 异步加载完（KPI 条渲染）
    await waitFor(() => expect(drill.querySelectorAll('[data-testid^="drill-kpi-"]').length).toBeGreaterThan(0));
    const kpis = drill.querySelectorAll('[data-testid^="drill-kpi-"]');
    await user.click(kpis[0] as HTMLElement);
    await waitFor(() => expect(within(drill).getByTestId("drill-dag")).toBeInTheDocument());
    await user.click(within(drill).getByTestId("drill-to-audit"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/v/plan-audit"));
  });
});
