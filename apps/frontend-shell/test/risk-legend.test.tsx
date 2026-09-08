import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-CAPSIM-REPLICA · 产能推演看板 1:1 复刻（参照 HTML §预判推演看板）：
 * 三档图例（正常/关注/瓶颈）内联在展开的 rk-det 详情面板（非看板顶部 · d7287dff 强剥离 top-legend）；
 * 首要风险（peak 最高）卡标注保留在网格卡上。
 */
describe("§CAPSIM · 风险看板详情图例 + 首要风险标注", () => {
  it("首要风险卡标注（网格）+ 点开卡后详情三档图例文案", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/risk");

    // 首要风险（peak 最高）卡有标注（网格·无需展开）
    await waitFor(() => expect(document.querySelectorAll('[data-testid^="risk-primary-"]').length).toBeGreaterThan(0));

    // 展开常州卡 → 内联详情图例（正常/关注/瓶颈 三档）
    const card = await screen.findByTestId("risk-card-常州");
    await user.click(card);
    const legend = await screen.findByTestId("risk-legend");
    expect(legend).toHaveTextContent("正常");
    expect(legend).toHaveTextContent("关注");
    expect(legend).toHaveTextContent("瓶颈");
  });
});
