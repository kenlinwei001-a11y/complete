import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * §2.2-a 精修：产能推演看板三档图例文案（越线/临近/正常）+ 首要风险（peak 最高）标注。
 * 门B Playwright 已真验；此为 CI 回归。
 */
describe("§2.2-a · 风险看板图例 + 首要风险标注", () => {
  it("三档图例文案 + 首要风险卡标注", async () => {
    loginAs("planner");
    renderApp("/v/risk");
    const legend = await screen.findByTestId("risk-legend");
    expect(legend).toHaveTextContent("越线");
    expect(legend).toHaveTextContent("临近");
    expect(legend).toHaveTextContent("正常");
    // 首要风险（peak 最高）卡有标注
    await waitFor(() => expect(document.querySelectorAll('[data-testid^="risk-primary-"]').length).toBeGreaterThan(0));
  });
});
