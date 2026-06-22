import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * audit.3 · 财务 KSF 图（问题 → 关键成功要素 KSF → 财务指标 3 层），数据走 ksf_graph 求解器（前端零写死）。
 * 问题节点点击 → 高亮其传导的 KSF + 财务指标 + 联动该问题的 audit_timeline 逐日圆点轴。
 */
describe("audit.3 · 财务 KSF 图 + 问题节点联动时序", () => {
  it("3 层节点渲染（KSF 5 要素）；点问题 → 高亮 KSF + 联动逐日圆点轴", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/plan-audit");

    const graph = await screen.findByTestId("ksf-graph");
    // 三层列
    expect(within(graph).getByTestId("ksf-col-problems")).toBeTruthy();
    expect(within(graph).getByTestId("ksf-col-ksf")).toBeTruthy();
    expect(within(graph).getByTestId("ksf-col-fin")).toBeTruthy();
    // KSF 五要素
    for (const k of ["k_dem", "k_bal", "k_kit", "k_cash", "k_cost"]) {
      expect(within(graph).getByTestId(`ksf-node-${k}`)).toBeTruthy();
    }

    // 点击"毛利率越线"问题 → 联动其时序轴（audit_timeline → DailyDotAxis）
    await user.click(within(graph).getByTestId("ksf-problem-prob:kpi-margin"));
    const tl = await within(graph).findByTestId("ksf-timeline-prob:kpi-margin");
    expect(tl).toBeTruthy();
    await within(graph).findByTestId("ksf-dda-prob:kpi-margin");
  });
});
