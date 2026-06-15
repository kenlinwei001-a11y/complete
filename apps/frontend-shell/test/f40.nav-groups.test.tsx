import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

describe("F40 · 业务导航分级（21 项 → 5 组可折叠）", () => {
  it("功能分组头渲染；图谱体系默认折叠；点击展开", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/dash");

    const nav = await screen.findByTestId("nav-business");
    // 功能分组头
    for (const g of ["规划与平衡", "推演与风险", "数据与台账", "图谱体系"]) {
      expect(within(nav).getByTestId(`nav-group-${g}`)).toBeInTheDocument();
    }
    // 概览项（无组头）直接可见
    expect(within(nav).getByText("经营驾驶舱")).toBeVisible();
    // 图谱体系默认折叠：子项在 DOM 但不可见
    const graphChild = within(nav).getByText("图谱·全景");
    expect(graphChild).not.toBeVisible();
    // 展开
    await user.click(within(nav).getByTestId("nav-group-toggle-图谱体系"));
    await waitFor(() => expect(within(nav).getByText("图谱·全景")).toBeVisible());
    // 折叠分组里的「规划体检」展开态可见
    expect(within(nav).getByText("规划体检")).toBeVisible();
  });
});
