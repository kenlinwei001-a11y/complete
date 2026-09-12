import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * 轨 G · C6 引用控件闭合 + C8 试运行 + render 可视编排（WorkflowsPage）。
 * 用 DRAFT 工作流 wf-draft（含 invoke_solver / invoke_agent / render_answer 步）。
 * 断言：solverKey/agentId 为引用下拉（三态：选择/查看/＋新建）；render_answer 为 block 可视编辑（非裸 JSON）；
 * 试运行调 run 端点并展示步骤输出时间线。
 * 注：jsdom 仅证逻辑；死路/可达由门B真浏览器把关（G-4 教训）。
 */
async function openDraftWorkflow() {
  loginAs("planner");
  renderApp("/admin/workflows");
  await screen.findByTestId("workflow-editor");
  // 切到 DRAFT 工作流（wf-draft）
  const select = (await screen.findByLabelText("选择 workflow")) as HTMLSelectElement;
  await userEvent.selectOptions(select, "wf-draft");
  await screen.findByTestId("wf-step-s2");
}

describe("C6/C8 · 工作流引用闭合 + 试运行 + render 可视", () => {
  it("C6：invoke_solver 的 solverKey 为引用下拉（含查看/＋新建三态）", async () => {
    await openDraftWorkflow();
    const sel = await screen.findByTestId("wf-solver-select-s2");
    expect(sel).toBeTruthy();
    // 已选值（fixture solverKey=risk_timeline）旁有"查看"与"＋新建"
    expect(screen.getByTestId("wf-solver-select-s2-view")).toBeTruthy();
    expect(screen.getByTestId("wf-solver-select-s2-new")).toBeTruthy();
  });

  it("C6：invoke_agent 的 agentId 为引用下拉", async () => {
    await openDraftWorkflow();
    expect(await screen.findByTestId("wf-agent-select-s3")).toBeTruthy();
    expect(screen.getByTestId("wf-agent-select-s3-new")).toBeTruthy();
  });

  it("C8：render_answer 为 block 可视编排（非裸 JSON），可加 block 选类型", async () => {
    const user = userEvent.setup();
    await openDraftWorkflow();
    const editor = await screen.findByTestId("wf-render-blocks-s4");
    expect(editor).toBeTruthy();
    await user.click(within(editor).getByTestId("wf-block-add-s4"));
    const typeSel = await within(editor).findByTestId("wf-block-type-s4-0");
    expect(typeSel).toBeTruthy();
    await user.selectOptions(typeSel, "kpi");
    expect((typeSel as HTMLSelectElement).value).toBe("kpi");
  });

  it("C8：试运行调 run 端点并展示步骤输出时间线", async () => {
    const user = userEvent.setup();
    await openDraftWorkflow();
    await user.click(await screen.findByTestId("wf-dry-run"));
    const result = await screen.findByTestId("wf-dry-run-result");
    expect(result).toBeTruthy();
    // 步骤输出时间线含 s2 行
    await waitFor(() => expect(screen.getByTestId("wf-dry-run-step-s2")).toBeTruthy());
  });
});
