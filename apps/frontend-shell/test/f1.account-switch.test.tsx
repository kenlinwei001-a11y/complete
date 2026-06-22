import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "./utils";
import { queryClient } from "@/store/queryClient";

describe("F1 · workspace 驱动的多账号前端", () => {
  it("planner 与 base_manager 导航/主题不同；切账号清空缓存", async () => {
    const user = userEvent.setup();
    renderApp("/login");

    // 登录 planner（登录页为懒加载路由）
    await user.type(await screen.findByLabelText("用户名"), "planner");
    await user.type(screen.getByLabelText("密码"), "demo");
    await user.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => expect(screen.getByTestId("left-nav")).toBeInTheDocument());
    const nav1 = screen.getByTestId("nav-business");
    expect(within(nav1).getByText("本体图谱")).toBeInTheDocument();
    expect(within(nav1).getByText("规划体检")).toBeInTheDocument();
    // N1 统一域分组：admin 角色 → 管理类域分组（数据接入）出现在统一导航内
    expect(within(nav1).getByTestId("nav-group-数据接入")).toBeInTheDocument();
    // 主题 token 覆盖
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#4C90F0"),
    );

    // 切换账号 → 缓存清空
    const clearSpy = vi.spyOn(queryClient, "clear");
    await user.click(screen.getByTestId("user-menu-btn"));
    await user.click(screen.getByTestId("logout-btn"));
    expect(clearSpy).toHaveBeenCalled();

    await user.type(await screen.findByLabelText("用户名"), "base_manager");
    await user.type(screen.getByLabelText("密码"), "demo");
    await user.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => expect(screen.getByTestId("left-nav")).toBeInTheDocument());
    const nav2 = screen.getByTestId("nav-business");
    // base_manager：无本体图谱、无规划体检（feature off）
    expect(within(nav2).queryByText("本体图谱")).not.toBeInTheDocument();
    expect(within(nav2).queryByText("规划体检")).not.toBeInTheDocument();
    // 无管理类域分组（base_manager 无管理页 → 空组隐藏）
    expect(within(nav2).queryByTestId("nav-group-数据接入")).not.toBeInTheDocument();
    // 主题不同
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#36BFA5"),
    );
  });
});
