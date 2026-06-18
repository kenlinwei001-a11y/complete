import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F45 · 自成长发动机驾驶舱（P6）：运行 LOOP → GapReport 逐轮 + 收敛终态；成长账本 + 工单看板 + 量化指标。
 */
describe("F45 · 自成长发动机驾驶舱", () => {
  it("账本/工单/指标加载 + 运行一轮见收敛终态与逐轮缺口", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/growth");
    await screen.findByTestId("growth-cockpit-page");

    // 量化指标（账本 2 条、1 条 CONVERGED → 可答率 50%）
    expect(await screen.findByTestId("metric-answer-rate")).toHaveTextContent("50%");
    expect(screen.getByTestId("metric-open-tickets")).toHaveTextContent("1");

    // 成长账本列出历史运行
    expect(await screen.findByTestId("ledger-glr_1")).toHaveTextContent("常州影响哪些订单");
    expect(screen.getByTestId("ledger-glr_2")).toHaveTextContent("BOUNDARY");

    // 工单看板 + 认领
    const tk = await screen.findByTestId("ticket-gtk_1");
    expect(tk).toHaveTextContent("NO_CAPABILITY");
    await user.click(within(tk).getByTestId("claim-gtk_1"));
    await screen.findByText("已认领");

    // 运行一轮 → 终态 + 逐轮缺口
    await user.click(screen.getByTestId("growth-run"));
    const report = await screen.findByTestId("growth-report");
    expect(within(report).getByTestId("growth-terminal")).toHaveTextContent("边界");
    expect(within(report).getByTestId("growth-round-1")).toHaveTextContent("NO_INTENT");
  });
});
