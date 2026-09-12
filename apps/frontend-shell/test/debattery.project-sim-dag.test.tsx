import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * 去电池锁死 8a（PRD-de-battery-multitenant-config / R14）回归：
 * 项目推演 DAG 的驱动因子层结构来自 ViewConfig.layout.driverFactors（非前端写死电池因子）。
 * mock 配置含独有"配置驱动因子-X"——它出现在 DAG 里即证明 DAG 结构走配置。
 * （回答用户先前提问："DAG 哪里可配？"——答：ViewConfig.layout。）
 */
describe("去电池锁死 8a · 项目推演 DAG 结构来自 ViewConfig.layout", () => {
  it("DAG 含 ViewConfig 独有驱动因子 → 证明 DAG 结构配置驱动（非硬编码）", async () => {
    loginAs("planner");
    renderApp("/v/project-sim");
    // DAG 随首次重算渲染；findByText 重试至配置驱动因子节点出现
    expect(await screen.findByText("配置驱动因子-X")).toBeInTheDocument();
  });
});
