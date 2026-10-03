import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F59 · A7 B 栈 scaffold 单机可见。运行工作流后展开 → cross_scaffold 步下见 scaffold 清单：
 * 倒推出的 agent/plan/scene 制品**不依赖 B 在线**即可见，单机态标"待 B 对账（pending-bstack）"+ 定义可看。
 */
describe("F59 · B 栈 scaffold 清单单机可见（ScaffoldManifestTable）", () => {
  it("成功运行展开 → scaffold 清单含 agent 制品 + pending-bstack 标记 + 定义可看", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    const panel = await screen.findByTestId("wf-timeline");

    // 第一次运行（mock 故意 FAILED）→ 再运行得 SUCCEEDED（cross_scaffold 成功，带 scaffold 清单）
    await user.click(within(panel).getByTestId("wf-start"));
    await within(panel).findByText(/断在 cross_scaffold/);
    await user.click(within(panel).getByTestId("wf-start"));
    expect((await within(panel).findAllByText("SUCCEEDED")).length).toBeGreaterThan(0);

    const manifest = await within(panel).findByTestId("wf-scaffold-manifest");
    expect(manifest.textContent).toMatch(/单机可见/);
    expect(manifest.textContent).toMatch(/pending-bstack/);
    // 看得到倒推出的 agent 制品 + 其定义（systemPrompt）
    const agentRow = within(manifest).getByTestId("wf-scaffold-agent");
    expect(agentRow.textContent).toMatch(/agt_affected_orders/);
    expect(agentRow.textContent).toMatch(/待 B 对账/);
    expect(agentRow.textContent).toMatch(/推演分析 agent/);
  });
});
