import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * 去电池锁死 8a（PRD-de-battery-multitenant-config / R14）回归：
 * 规划体检的字段组结构来自 ViewConfig.layout.fieldGroups（非前端写死 FIELD_GROUPS）。
 * mock 配置里放了独有"配置驱动分组-X"——它渲染出来即证明结构走的是配置。
 */
describe("去电池锁死 8a · 规划体检字段组来自 ViewConfig.layout", () => {
  it("体检面板含 ViewConfig 独有分组 → 证明结构配置驱动（非硬编码）", async () => {
    loginAs("planner");
    renderApp("/v/plan-audit");
    expect(await screen.findByText("配置驱动分组-X")).toBeInTheDocument();
  });
});
