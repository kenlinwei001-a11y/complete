import { describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * WO-1 件一 · databuilder pipeline「配置面 × 放行面」驱动接缝测试。
 *
 * 咬的不是「界面能渲染」也不是「CRUD 能存能取」——那两半各自绿都可能接缝仍断。
 * 本文件咬的是整条：**在界面上改 pipeline ⇒ 执行口的实际处理行为跟着变**：
 *
 *   ② 配置 ⇒ 生效（intake 执行口）：
 *      出厂态先跑一遍 intake 取基线（对账有自动映射）→ 在配置面把 intake 的
 *      「字段对账」节点停用并存盘 ⇒ 同一个 intake 口再跑，对账产物诚实缺省
 *      （解析产物还在 —— 证明 pipeline 跑了，只是行为跟着配置变了）；
 *      再「恢复出厂默认」（DELETE）⇒ 行为回到出厂。
 *
 *   ③ 配置 ⇒ 放行（建域执行口 + approve 入口）：
 *      在配置面给 story_build 的 publish_build 节点勾上「人工放行」并存盘
 *      ⇒ 数据构建发动机页「运行工作流」出来的 run 停在 PAUSED，行上出现
 *      「✋ 放行 publish_build」入口（且 PAUSED 不再提供「重入续跑」——
 *      resume 不是 approve 的替代品）⇒ 点放行 ⇒ run 收敛 SUCCEEDED。
 *      没有这条入口，PAUSED 的 run 就是死锁：谁也放不了行。
 *
 * mock 侧三条执行口（intake / import / 建域 workflow-runs）都**现读**同一份
 * pipeline store（handlers.ts · MOCK_BUILD_PIPELINES），与真后端「每次执行现读
 * 生效定义」同语义 —— 所以这里测到的行为变化不是 UI 自导自演，是接缝真通。
 *
 * 现场清理：每条用例收尾把改过的 kind 恢复出厂默认（mock store 是模块级的，
 * 不还原会污染同文件后续用例 —— 还原动作本身也顺带覆盖了 DELETE 端点的驱动）。
 */

const INTAKE_HTML = "<html><body><table><tr><td>demo</td></tr></table></body></html>";

/** 跑一次原型 intake（填 HTML → 提交 → 等结果面板），返回结果容器。 */
async function runIntakeOnce() {
  cleanup();
  loginAs("planner");
  renderApp("/admin/prototype-intake");
  await screen.findByTestId("intake-page");
  fireEvent.change(screen.getByTestId("intake-html"), { target: { value: INTAKE_HTML } });
  fireEvent.click(screen.getByTestId("intake-submit"));
  return await screen.findByTestId("intake-result");
}

/** 打开配置面某 kind 的编辑器。 */
async function openPipelineEditor(kind: "story_build" | "intake" | "intake_import") {
  cleanup();
  loginAs("planner");
  renderApp("/admin/build-pipelines");
  await screen.findByTestId("bp-page");
  fireEvent.click(await screen.findByTestId(`bp-kind-${kind}`));
  return await screen.findByTestId(`bp-editor-${kind}`);
}

describe("WO-1 件一 · pipeline 配置面 × 放行面驱动接缝", () => {
  it("配置面首层：三条 pipeline 卡的结论（出厂徽章 + 启用计数 + 放行计数）", async () => {
    loginAs("planner");
    renderApp("/admin/build-pipelines");
    await screen.findByTestId("bp-page");

    for (const kind of ["story_build", "intake", "intake_import"] as const) {
      expect(await screen.findByTestId(`bp-kind-${kind}`)).toBeTruthy();
      expect(screen.getByTestId(`bp-factory-${kind}`).textContent).toBe("出厂默认");
      expect(screen.getByTestId(`bp-summary-${kind}`).textContent).toMatch(/节点启用/);
    }
    // 出厂 story_build 7 节点全启用、无人工放行节点；intake 4 节点；intake_import 3 节点
    expect(screen.getByTestId("bp-summary-story_build").textContent).toContain("7/7");
    expect(screen.getByTestId("bp-summary-intake").textContent).toContain("4/4");
    expect(screen.getByTestId("bp-summary-intake_import").textContent).toContain("3/3");

    // 第二层：点开 intake 卡 ⇒ 每个节点的 SOP（干什么/失败怎么办/要不要人工放行）可见可编
    fireEvent.click(screen.getByTestId("bp-kind-intake"));
    const editor = await screen.findByTestId("bp-editor-intake");
    expect(within(editor).getByTestId("bp-node-intake_parse")).toBeTruthy();
    expect(within(editor).getByTestId("bp-sop-intake_reconcile")).toBeTruthy();
    expect((within(editor).getByTestId("bp-enabled-intake_reconcile") as HTMLInputElement).checked).toBe(true);
    expect(within(editor).getByTestId("bp-onfailure-intake_reconcile")).toBeTruthy();
    expect((within(editor).getByTestId("bp-approval-intake_reconcile") as HTMLInputElement).checked).toBe(false);
  });

  it("驱动接缝：界面停用 intake 对账节点 ⇒ /a/v1/databuilder/intake 实际处理行为跟着变；恢复出厂 ⇒ 行为还原", async () => {
    // 基线（出厂）：对账有自动映射产物
    const base = await runIntakeOnce();
    expect(within(base).getByTestId("intake-tables")).toBeTruthy();
    expect((await within(base).findAllByTestId("intake-automapped")).length).toBeGreaterThan(0);

    // 配置这一半：停用「字段对账」节点并存盘
    const editor = await openPipelineEditor("intake");
    fireEvent.click(within(editor).getByTestId("bp-enabled-intake_reconcile"));
    expect((within(editor).getByTestId("bp-enabled-intake_reconcile") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(editor).getByTestId("bp-save-intake"));
    await waitFor(() => expect(screen.getByTestId("bp-factory-intake").textContent).toBe("租户覆盖"));
    expect(screen.getByTestId("bp-summary-intake").textContent).toContain("3/4");

    // 生效那一半：同一个 intake 口，解析产物还在（pipeline 确实跑了），对账产物诚实缺省
    const after = await runIntakeOnce();
    expect(await within(after).findByTestId("intake-tables")).toBeTruthy();
    expect(within(after).queryByTestId("intake-automapped")).toBeNull();
    expect(within(after).queryByTestId("intake-candidate")).toBeNull();

    // 现场清理：恢复出厂默认（DELETE）⇒ 行为回到出厂（对账产物回来）
    const editor2 = await openPipelineEditor("intake");
    fireEvent.click(within(editor2).getByTestId("bp-reset-intake"));
    await waitFor(() => expect(screen.getByTestId("bp-factory-intake").textContent).toBe("出厂默认"));
    const restored = await runIntakeOnce();
    expect((await within(restored).findAllByTestId("intake-automapped")).length).toBeGreaterThan(0);
  });

  it("放行接缝：配置 publish_build 要人工放行 ⇒ 建域 run 停 PAUSED 且行上有真放行入口 ⇒ 放行后收敛；PAUSED 不给 resume", async () => {
    // 配置这一半：story_build 的 publish_build 勾「人工放行」并存盘
    const editor = await openPipelineEditor("story_build");
    const approval = within(editor).getByTestId("bp-approval-publish_build") as HTMLInputElement;
    expect(approval.checked).toBe(false);
    fireEvent.click(approval);
    fireEvent.click(within(editor).getByTestId("bp-save-story_build"));
    await waitFor(() => expect(screen.getByTestId("bp-factory-story_build").textContent).toBe("租户覆盖"));
    expect(screen.getByTestId("bp-summary-story_build").textContent).toContain("1 个节点要人工放行");

    // 生效那一半：数据构建发动机页跑工作流 ⇒ run 停在 publish_build 前（PAUSED 保留现场）
    cleanup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    const panel = await screen.findByTestId("wf-timeline");
    fireEvent.click(within(panel).getByTestId("wf-start"));

    const approveBtn = (await within(panel).findByTestId(/wf-approve-/)) as HTMLButtonElement;
    const runId = approveBtn.getAttribute("data-testid")!.replace("wf-approve-", "");
    expect(approveBtn.textContent).toContain("publish_build");
    expect(within(panel).getByTestId(`wf-status-${runId}`).textContent).toBe("PAUSED");
    // resume 不是 approve 的替代品：PAUSED 的 run 不提供「重入续跑」（只有 FAILED 才给）
    expect(within(panel).queryByTestId(`wf-resume-${runId}`)).toBeNull();
    // 放行闸前的步已跑完、闸步起 pending（现场保留，不是整 run 重来）
    const row = within(panel).getByTestId(`wf-run-${runId}`);
    expect(row.textContent).toContain("步完成");

    // 点真放行入口 ⇒ approve 后续跑收敛 SUCCEEDED，放行入口消失
    fireEvent.click(approveBtn);
    await waitFor(() => expect(within(panel).getByTestId(`wf-status-${runId}`).textContent).toBe("SUCCEEDED"));
    expect(within(panel).queryByTestId(`wf-approve-${runId}`)).toBeNull();

    // 现场清理：story_build 恢复出厂（下条用例/别个文件不受影响）
    const editor2 = await openPipelineEditor("story_build");
    fireEvent.click(within(editor2).getByTestId("bp-reset-story_build"));
    await waitFor(() => expect(screen.getByTestId("bp-factory-story_build").textContent).toBe("出厂默认"));
  });
});
