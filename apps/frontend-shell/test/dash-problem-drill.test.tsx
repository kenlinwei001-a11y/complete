import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * 修复：经营驾驶舱「待解决的问题」卡片此前是纯 div（无 onClick），无法下钻。
 * 现改为可点击按钮 → 导航订单全链聚合（order-chain）并带 ?problem=<category>，
 * order-chain 数据就绪后自动展开该类逐单根因 DAG（PRD-cockpit §2.3 问题归并→台账逐单根因）。
 */
describe("dash · 待解决问题卡片下钻", () => {
  it("问题卡片是可点击按钮，点击 → 路由 /v/order-chain?problem=<category>", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    const { router } = renderApp("/v/dash");
    const panel = await screen.findByTestId("dash-problems");

    // 卡片是 <button>（可点击），而非纯 div
    const card = panel.querySelector('[data-testid^="dash-problem-"]') as HTMLElement | null;
    expect(card).toBeTruthy();
    expect(card!.tagName).toBe("BUTTON");
    const category = card!.getAttribute("data-testid")!.replace("dash-problem-", "");

    await user.click(card!);
    await waitFor(() => expect(router.state.location.pathname).toBe("/v/order-chain"));
    expect(router.state.location.search).toContain(`problem=${encodeURIComponent(category)}`);
  });
});
