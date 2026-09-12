import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * DF.13c 原型 intake 面板（文件↔表可见）：粘贴 HTML → 解析数据表/关系 + 对账（自动映射/候选/未解析）。
 * 门B Playwright 真前端已验；此为 CI 回归（断言可交互，不止渲染）。
 */
describe("DF.13c · 原型 intake 面板", () => {
  it("粘贴 HTML → 解析出数据表 + 关系 + 对账（自动映射/候选/未解析）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/prototype-intake");
    const page = await screen.findByTestId("intake-page");
    // 用无 { 的占位文本（userEvent 键盘语法把 { 当特殊键；mock 不解析内容、返回确定性示例）。
    await user.type(screen.getByTestId("intake-html"), "prototype-html-content");
    await user.click(screen.getByTestId("intake-submit"));
    const result = await screen.findByTestId("intake-result");
    // 解析出的数据表（文件→表）
    await waitFor(() => expect(page.querySelectorAll('[data-testid^="intake-table-"]').length).toBeGreaterThan(0));
    // 对账三类
    expect(result.querySelectorAll('[data-testid="intake-automapped"]').length).toBeGreaterThan(0);
    expect(result.querySelectorAll('[data-testid="intake-candidate"]').length).toBeGreaterThan(0);
    expect(screen.getByTestId("intake-unparsed")).toBeInTheDocument();
  });
});
