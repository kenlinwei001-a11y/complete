import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F44 · 自成长发动机 P2 就地审批面板（§6.4）：数据构建发动机页内嵌待审批补齐，
 * admin 当前页直接批复，无需跳转 /admin/actions。
 */
describe("F44 · 数据构建发动机就地审批", () => {
  it("页内列出待审批补齐 + 就地批准（不跳转）", async () => {
    const user = userEvent.setup();
    loginAs("planner"); // planner 账号含 admin 角色
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");

    // 就地审批面板列出 PENDING_APPROVAL 草稿（act-001）
    const panel = await screen.findByTestId("db-approvals");
    expect(within(panel).getByTestId("db-approval-count")).toHaveTextContent("1");
    const row = within(panel).getByTestId("db-approval-act-001");
    expect(row).toHaveTextContent("shift_plan_change");

    // 当前页直接批准（无路由跳转）
    await user.click(within(row).getByTestId("db-approve-act-001"));
    await screen.findByText("已批复");
    // 仍在数据构建发动机页（未跳转）
    expect(screen.getByTestId("data-builder-page")).toBeInTheDocument();
  });
});
