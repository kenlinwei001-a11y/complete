import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * AUDIT.1（audit 视图 1:1 复刻 · 时序推演）：规划体检展开审计项时序 → 与产能推演同款 **逐日圆点轴**
 * （消费 risk_timeline 已产 series）：顶部摘要 + 逐日圆点 + 三档图例 + 点选日点详情。4 节点 stepper 保留为概览。
 */
describe("AUDIT.1 · 规划体检逐日圆点轴（消费已产 series）", () => {
  it("展开 X02 → 逐日圆点轴（摘要+圆点+图例）+ 点选日点出详情；stepper 概览仍在", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/plan-audit");

    const x02 = await screen.findByTestId("audit-item-med-X02");
    await user.click(within(x02).getByTestId("tl-toggle-med-X02"));
    await screen.findByTestId("audit-risk-timeline-X02");

    // 逐日圆点轴（消费 risk_timeline card.series）
    const dda = await screen.findByTestId("dda-X02");
    expect(within(dda).getByTestId("dda-X02-summary")).toBeTruthy();
    expect(within(dda).getByTestId("dda-X02-legend")).toBeTruthy();
    // 逐日圆点（≥1 天）
    const dot0 = within(dda).getByTestId("dda-X02-dot-0");
    expect(dot0).toBeTruthy();
    // 点选某日 → 日点详情（当日传导度）
    await user.click(within(dda).getByTestId("dda-X02-dot-5"));
    expect(await within(dda).findByTestId("dda-X02-daytip")).toHaveTextContent("D+5");

    // 4 节点 stepper 概览仍保留（F15 不破）
    expect(within(x02).getByTestId("ptl-X02-node-cross")).toHaveTextContent("约束越线");
  });
});
