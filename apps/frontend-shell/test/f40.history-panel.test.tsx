import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F40 · 历史记录侧滑面板（顶栏时钟图标）：所有登录用户（含非 admin）可从顶栏时钟打开
 * 推演历史侧滑面板，看本租户最近 QOS 推演（问句/状态/摘要），可查证据链/重放。
 */
describe("F40 · 推演历史侧滑面板（时钟图标）", () => {
  it("planner（非 admin）点顶栏时钟 → 侧滑面板列出推演历史 + 关闭", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/dash");

    // 顶栏时钟图标对所有登录用户可见
    const clock = await screen.findByTestId("history-clock");
    await user.click(clock);

    // 侧滑面板打开 + 列出历史项
    const panel = await screen.findByTestId("history-panel");
    await waitFor(() => expect(within(panel).getAllByTestId("history-item").length).toBeGreaterThan(0));
    expect(panel).toHaveTextContent("4680-NCM 加 20% 六周能不能接？");
    expect(within(panel).getAllByTestId("history-view").length).toBeGreaterThan(0);
    expect(within(panel).getAllByTestId("history-replay").length).toBeGreaterThan(0);

    // 关闭
    await user.click(within(panel).getByTestId("history-close"));
    await waitFor(() => expect(screen.queryByTestId("history-panel")).not.toBeInTheDocument());
  });
});
