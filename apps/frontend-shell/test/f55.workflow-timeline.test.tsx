import { describe, expect, it } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F55 · 工业级工作流运行时时间线（配套数据构建发动机 · PRD-build-workflow-runtime §1 目标4 可观测）：
 * 运行工作流 → 持久化步骤状态机逐运行/逐步可视化 → 失败运行可一键 resume 续跑（自愈），收敛后无残留断点。
 */
describe("F55 · 工作流运行时时间线（BuildWorkflowRun）", () => {
  it("运行工作流 → 失败运行显示断点步 + 错误 + resume → 重入续跑收敛；再运行得成功运行", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");

    const panel = await screen.findByTestId("wf-timeline");
    // 初始无运行
    expect(within(panel).getByTestId("wf-empty")).toBeTruthy();

    // 运行工作流（mock 首条故意失败，演示断点 + resume 入口）
    await user.click(within(panel).getByTestId("wf-start"));
    expect(await within(panel).findByText("FAILED")).toBeTruthy();
    expect(within(panel).getByText(/断在 cross_scaffold/)).toBeTruthy();
    const resumeBtn = within(panel).getByText(/重入续跑/);

    // 运行启动后自动展开 → 逐步可观测（含失败步的结构化错误）
    expect(within(panel).getByTestId("wf-step-dry_build")).toBeTruthy();
    expect(within(panel).getByTestId("wf-step-cross_scaffold")).toBeTruthy();
    const stepErr = within(panel).getByTestId("wf-step-error-cross_scaffold");
    expect(stepErr.textContent).toMatch(/SCAFFOLD_HTTP/);
    expect(stepErr.textContent).toMatch(/可重试/);

    // 一键 resume → 失败/未完成步收敛为成功，断点消失（自愈）
    await user.click(resumeBtn);
    await waitFor(() => expect(within(panel).queryByText(/断在 cross_scaffold/)).toBeNull());
    expect(within(panel).queryByText(/重入续跑/)).toBeNull();

    // 再运行一次 → 成功运行（无 resume 按钮）
    await user.click(within(panel).getByTestId("wf-start"));
    expect((await within(panel).findAllByText("SUCCEEDED")).length).toBeGreaterThan(0);
    // 运行计数增长到 2
    expect(within(panel).getByTestId("wf-count").textContent).toBe("2");

    // 成功运行展开 → 比对现状表（倒推 vs 现状的跨模块统一 diff）可见，含"缺"的求解器
    const gap = await within(panel).findByTestId("wf-gap-analysis");
    expect(gap.textContent).toMatch(/需 21 · 复用 8 · 新建 12 · 缺 1/);
    expect(within(gap).getByTestId("wf-gap-solver")).toBeTruthy();
  });
});
