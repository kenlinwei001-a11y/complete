import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * 去电池锁死 8a（PRD-de-battery-multitenant-config / R14）回归：
 * 订单全链的问题分类标签来自 ViewConfig.layout.categoryLabels（非前端写死 CATEGORY_LABEL）。
 * mock 把 DELIVERY 标签设为独有"交期·配置X"——它渲染出来即证明走配置。
 */
describe("去电池锁死 8a · 订单全链分类标签来自 ViewConfig.layout", () => {
  it("问题分类含 ViewConfig 独有标签 → 证明配置驱动（非硬编码）", async () => {
    loginAs("planner");
    renderApp("/v/order-chain");
    expect(await screen.findByText("交期·配置X")).toBeInTheDocument();
  });
});
