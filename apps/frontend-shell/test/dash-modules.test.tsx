import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * PRD-IND-dash §2.5/§2.6：回采校准链（5 节点）+ 模块直达（6 卡 · 点击进入对应视图）。
 * 结构/导航/叙事，view.layout 优先下发，常量兜底（R14）。
 */
describe("dash · 回采校准链 + 模块直达", () => {
  it("回采链 5 节点 + 模块直达 6 卡渲染，点卡片路由到对应视图", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    const { router } = renderApp("/v/dash");
    await screen.findByTestId("dashboard-grid");

    // 待解决的问题面板（自下而上归并，affected_orders 同源）
    const probs = await screen.findByTestId("dash-problems");
    expect(probs).toHaveTextContent("待解决的问题");
    expect(probs).toHaveTextContent("影响");

    // 回采校准链 5 节点（实际 → 月度 → 季度 → 年度 → C12 反向调参）
    const fb = await screen.findByTestId("dash-feedback-chain");
    expect(fb).toHaveTextContent("月度 S&OP 三线差异");
    expect(screen.getByTestId("dash-fb-4")).toHaveTextContent("C12");

    // 模块直达 6 卡
    const mods = screen.getByTestId("dash-modules");
    for (const k of ["aop", "quarter", "sop", "risk", "order", "all"]) {
      expect(screen.getByTestId(`dash-mod-${k}`)).toBeInTheDocument();
    }
    expect(mods).toHaveTextContent("年度情景规划台");

    // 点「产能推演」→ 路由 /v/risk
    await user.click(screen.getByTestId("dash-mod-risk"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/v/risk"));
  });
});
