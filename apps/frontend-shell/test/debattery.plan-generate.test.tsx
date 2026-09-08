import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * 去电池锁死 8a（PRD-de-battery-multitenant-config / R14）回归：
 * 规划建议的目标字段结构来自 ViewConfig.layout.goalFields（非前端写死 GOAL_FIELDS）。
 * mock 配置里把 sharePts 标签设为独有"份额增·配置驱动X"——它渲染出来即证明结构走配置。
 */
describe("去电池锁死 8a · 规划建议目标字段来自 ViewConfig.layout", () => {
  it("目标面板含 ViewConfig 独有字段标签 → 证明结构配置驱动（非硬编码）", async () => {
    loginAs("planner");
    renderApp("/v/plan-generate");
    expect(await screen.findByText("份额增·配置驱动X")).toBeInTheDocument();
  });
});
