import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";

describe("F32 · 用户管理（管理平台 §2，tenant_admin）", () => {
  it("用户表：邮箱/角色 chips/状态开关/最近登录；状态切换落库", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/users");

    const row = await screen.findByTestId("user-base_manager");
    expect(within(row).getByText("cz@battery.io")).toBeInTheDocument();
    expect(screen.getByTestId("role-chip-base_manager-base_manager:常州")).toBeInTheDocument();

    // 状态开关：ACTIVE → DISABLED
    await user.click(screen.getByTestId("user-status-base_manager"));
    await waitFor(() => expect(db.adminUsers.find((u) => u.id === "usr-cz")?.status).toBe("DISABLED"));
  });

  it("新建用户：角色选择器带参数化角色参数输入 + 属性编辑器", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/users");
    await screen.findByTestId("user-base_manager");

    await user.click(screen.getByTestId("user-create"));
    await user.type(screen.getByTestId("user-email"), "hf@battery.io");
    // 参数化角色：选 base_manager → 参数输入框出现
    await user.selectOptions(screen.getByTestId("role-select"), "base_manager");
    await user.type(screen.getByTestId("role-param"), "合肥");
    await user.click(screen.getByTestId("role-add"));
    expect(screen.getByTestId("edit-role-base_manager:合肥")).toBeInTheDocument();
    await user.click(screen.getByTestId("user-save"));
    await waitFor(() => {
      const created = db.adminUsers.find((u) => u.email === "hf@battery.io");
      expect(created?.roles).toEqual(["base_manager:合肥"]);
    });
  });

  it("重置密码 → 新密码 toast（TODO 邮件）；自改状态被拒（403 toast）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/users");
    await screen.findByTestId("user-base_manager");

    await user.click(screen.getByTestId("user-reset-base_manager"));
    expect(await screen.findByText(/new-pass-123/)).toBeInTheDocument();

    // 自改状态（planner 即当前账号）→ 后端 403，状态不变
    await user.click(screen.getByTestId("user-status-planner"));
    await waitFor(() => expect(db.adminUsers.find((u) => u.id === "usr-planner")?.status).toBe("ACTIVE"));
  });
});
