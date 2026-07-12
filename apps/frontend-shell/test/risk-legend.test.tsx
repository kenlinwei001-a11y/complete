import { describe, expect, it } from "vitest";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * §2.2-a 精修（WO-CAPSIM-REPLICA-V2·1:1 复刻参照 HTML：网格上方三档图例已删——参照只在卡详情态出图例）：
 *  - 首要风险（peak 最高）卡标注：网格级·卡头常驻·无需展开。
 *  - 三档图例（正常/关注/瓶颈）：移入卡详情态（点开卡后 risk-detail-<base> 内的 risk-legend）。
 * 门B Playwright 已真验；此为 CI 回归。
 */
describe("§2.2-a · 风险看板首要风险标注（网格级）+ 图例（详情态）", () => {
  it("首要风险（peak 最高）卡在网格头部常驻标注（不必展开）", async () => {
    loginAs("planner");
    renderApp("/v/risk");
    await screen.findByTestId("risk-card-常州");
    await waitFor(() => expect(document.querySelectorAll('[data-testid^="risk-primary-"]').length).toBeGreaterThan(0));
  });

  it("点开卡 → 卡详情态三档图例文案（正常/关注/瓶颈）", async () => {
    loginAs("planner");
    renderApp("/v/risk");
    fireEvent.click(await screen.findByTestId("risk-card-常州"));
    const detail = await screen.findByTestId("risk-detail-常州");
    const legend = within(detail).getByTestId("risk-legend");
    expect(legend).toHaveTextContent("正常");
    expect(legend).toHaveTextContent("关注");
    expect(legend).toHaveTextContent("瓶颈");
  });
});
