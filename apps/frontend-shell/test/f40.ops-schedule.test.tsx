import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F40 · 运营自动化 OpsSchedule 管理台（回放编排器 §6）。
 * tenant_admin 可配置定期预测 / S&OP 自动开启 / 审批催办 / 低风险自动批准（默认关）。
 */
describe("F40 · 运营自动化（OpsSchedule）", () => {
  it("tenant_admin 配置定期预测并保存；autoApprove 默认关闭", async () => {
    const user = userEvent.setup();
    loginAs("planner"); // mock planner 账号持 admin+tenant_admin 角色
    renderApp("/admin/ops-schedule");

    const page = await screen.findByTestId("ops-schedule-page");
    expect(page).toBeInTheDocument();

    // autoApprove 默认关闭（红线：开启需显式勾选）
    const autoApprove = screen.getByTestId("autoapprove-enabled") as HTMLInputElement;
    expect(autoApprove.checked).toBe(false);

    // 添加一条定期预测计划
    await user.click(screen.getByTestId("add-forecast"));
    expect(await screen.findByTestId("forecast-0")).toBeInTheDocument();

    // 启用审批催办
    await user.click(screen.getByTestId("reminder-enabled"));

    // 保存
    await user.click(screen.getByTestId("save-schedule"));
    await waitFor(() => expect(screen.getByText("运营自动化配置已保存")).toBeInTheDocument());
  });

  it("base_manager 无 tenant_admin → 直访被 AdminGuard 拦截 403", async () => {
    loginAs("base_manager");
    renderApp("/admin/ops-schedule");
    expect(await screen.findByTestId("page-403")).toBeInTheDocument();
  });
});
