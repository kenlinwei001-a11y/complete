import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F58 · A5 FDE 编排工作流节点状态图（意图→倒推→查能力→比差→各模块生成→闭包→publish→进启动器）。
 * 运行工作流后展开 → 8 节点 DAG 可见；失败运行的"各模块生成/publish"节点红 + 缺口码（守"绿测试≠能用"）。
 */
describe("F58 · FDE 编排节点状态图（FdeGraph）", () => {
  it("运行工作流 → 展开见 8 节点 DAG；失败运行 generate/publish 节点 FAILED + 缺口码", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    const panel = await screen.findByTestId("wf-timeline");

    // 运行（mock 首条故意失败 at cross_scaffold）→ 自动展开 → FDE 节点图加载
    await user.click(within(panel).getByTestId("wf-start"));
    expect(await within(panel).findByText(/断在 cross_scaffold/)).toBeTruthy();

    // FDE 节点图：8 节点全在（固定序）
    for (const key of ["story", "comprehend", "capability", "gap", "generate", "closure", "publish", "launcher"]) {
      expect(await within(panel).findByTestId(`fde-node-${key}`)).toBeTruthy();
    }
    // 倒推/闭包节点已 DONE（dry_build 成功）；生成/publish 因 scaffold 断而 FAILED + 缺口码
    expect(within(panel).getByTestId("fde-node-comprehend").getAttribute("data-status")).toBe("DONE");
    expect(within(panel).getByTestId("fde-node-closure").getAttribute("data-status")).toBe("DONE");
    expect(within(panel).getByTestId("fde-node-generate").getAttribute("data-status")).toBe("FAILED");
    expect(within(panel).getByTestId("fde-node-gapcode-generate").textContent).toMatch(/SCAFFOLD_HTTP/);
  });
});
