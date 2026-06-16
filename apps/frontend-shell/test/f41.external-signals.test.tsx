import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F41 · 外部信号面板（EXT_SIG）：环境信号一等对象清单（来源/单位/新鲜度可溯）+
 * 敏感性 what-if（信号冲击 → 规划指标聚合影响）。
 */
describe("F41 · 外部信号 + 敏感性面板", () => {
  it("列环境信号 + 锂价+10% 冲击 → 毛利 -0.8pp", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/external-signals");

    await screen.findByTestId("external-signals-page");
    // 一等信号对象列出（带来源/影响）
    const li = await screen.findByTestId("signal-li_carbonate_price");
    expect(li).toHaveTextContent("电池级碳酸锂价");
    expect(li).toHaveTextContent("上海有色网");
    expect(li).toHaveTextContent("毛利");

    // 施加冲击：锂价 +10% → 算敏感性 → 毛利 -0.8pp
    fireEvent.change(screen.getByTestId("shock-li_carbonate_price"), { target: { value: "10" } });
    await user.click(screen.getByTestId("run-sensitivity"));
    const result = await screen.findByTestId("sensitivity-result");
    expect(within(result).getByTestId("impact-毛利")).toHaveTextContent("-0.8 pp");

    // 信号时序：点「时序」→ 近 12 月迷你折线
    await user.click(screen.getByTestId("series-toggle-li_carbonate_price"));
    expect(await screen.findByTestId("sparkline-li_carbonate_price")).toBeInTheDocument();
  });
});
