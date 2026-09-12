import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * PRD-IND-risk §2.4：处置行动计划表（buildRiskPlanRows）——风险看板底部渲染主因素首选方案 +
 * 峰值≥90 备份 + 14 天内反提 S&OP，列=行动项/详情/责任人/启动/完成/预期/规则。数据来自 risk_timeline.planRows。
 */
describe("risk · 处置行动计划表（planRows）", () => {
  it("风险看板渲染处置计划表：行动/责任人/启动·完成/规则 + 反提 S&OP 行", async () => {
    loginAs("planner");
    renderApp("/v/risk");

    const table = await screen.findByTestId("risk-plan-table");
    // 主因素首选方案行（常州·正极备料，越线前 7 天启动）
    const r0 = within(table).getByTestId("risk-plan-row-0");
    expect(r0).toHaveTextContent("常州");
    expect(r0).toHaveTextContent("基地负责人");
    expect(r0).toHaveTextContent("越线前7天");
    // 备份方案行（峰值≥90 双保险）
    expect(table).toHaveTextContent("备份方案");
    expect(table).toHaveTextContent("峰值≥90 双保险");
    // 14 天内反提月度计划差异 → 计划中心 → S&OP（C21）
    expect(table).toHaveTextContent("反提月度计划差异");
    expect(table).toHaveTextContent("计划中心 → S&OP");
    expect(table).toHaveTextContent("C21");
  });
});
