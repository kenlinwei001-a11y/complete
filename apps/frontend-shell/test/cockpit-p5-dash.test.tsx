import { describe, expect, it } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * cockpit P5 前端：驾驶舱 V5/V7 版本切换（SopVersionRow）+ 反事实双轨推演双线图（counterfactual_timeline）。
 * 声明式 widget，数据走对象/求解器，前端零写死（R14）。
 */
describe("cockpit P5 · 驾驶舱版本切换 + 反事实双线图", () => {
  it("V5/V7 版本切换 chip + 选版本看供给/缺口；反事实双线图 + 差值", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/dash");

    // 版本切换 widget（SopVersionRow V1/V3/V5/V7）
    const vt = await screen.findByTestId("version-toggle");
    expect(within(vt).getByTestId("ver-chip-V7")).toHaveTextContent("待定稿");
    await user.click(within(vt).getByTestId("ver-chip-V5"));
    expect(within(vt).getByTestId("version-detail")).toHaveTextContent("缺口");

    // 反事实双轨推演 widget（counterfactual_timeline → 双曲线 + 峰值削减）
    const cf = await screen.findByTestId("cf-widget");
    await waitFor(() => expect(within(cf).getByTestId("cf-peakcut")).toBeInTheDocument());
    expect(within(cf).getByTestId("cf-chart")).toBeTruthy();
  });
});
