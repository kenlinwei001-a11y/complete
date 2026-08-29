import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F54 · 数据构建发动机：连接器深链不掉登录（Q5）+ 三建域入口说明（Q6）。
 *
 * 故事脚本（~100 字）：管理员在"数据构建发动机"点"快速合成"出报告后，想去连接器页核对产物，点了
 * "→ 连接器页核对产物"。此前这是原生 <a href> 整页刷新 → 内存里的 access token 被清空 → 弹回登录页；
 * 改为 react-router 客户端跳转后，应在 SPA 内直达连接器页、会话不丢。另外三个建域按钮（运行构建/建域
 * 并记入历史/倒推建域）此前看不懂何时点哪个，页面现给出取舍说明。
 */
describe("F54 · 连接器深链客户端跳转（Q5）+ 三建域入口说明（Q6）", () => {
  it("Q5：快速合成后点「连接器页核对产物」→ SPA 内跳连接器页，不弹回登录", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");

    const panel = await screen.findByTestId("db-quick-synth");
    await user.click(within(panel).getByTestId("qs-run"));
    const report = await within(panel).findByTestId("qs-report", undefined, { timeout: 15000 });

    // 链接是 react-router Link（客户端跳转）；点击后落连接器页（出现其页面元素），且未弹登录
    const link = within(report).getByTestId("qs-connections-link");
    await user.click(link);
    await waitFor(() => expect(screen.getByTestId("cta-connection")).toBeInTheDocument());
    // 未弹回登录：登录表单不出现（仍是登录态、token 未被整页刷新清空）
    expect(screen.queryByText("登录")).not.toBeInTheDocument();
  });

  it("Q6：三个建域按钮旁给出取舍说明（运行构建/建域并记入历史/倒推建域）", async () => {
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    const help = await screen.findByTestId("db-build-modes-help");
    expect(help).toHaveTextContent("运行构建");
    expect(help).toHaveTextContent("记入历史");
    expect(help).toHaveTextContent("先补录");
    // 说明点出关键区别：dry-run 仅预览、记入历史可溯源、补录用于脚本没说清
    expect(help).toHaveTextContent("仅预览不落库");
    expect(help).toHaveTextContent("历史推演记录");
  });
});
