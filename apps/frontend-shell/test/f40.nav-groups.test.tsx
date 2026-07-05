import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

describe("F40 · 统一域分组导航（N1：视图+管理合一套域分组，可折叠）", () => {
  it("功能分组头渲染；图谱单组融合（NAV-GRAPH-MERGE·无「图谱体系」冗余组）；组头可折叠展开", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/dash");

    const nav = await screen.findByTestId("nav-business");
    // N1 统一域分组头（推演/台账与地图/建模与图谱…）
    for (const g of ["规划与平衡", "推演", "台账与地图", "建模与图谱"]) {
      expect(within(nav).getByTestId(`nav-group-${g}`)).toBeInTheDocument();
    }
    // 概览项（无组头）直接可见
    expect(within(nav).getByText("经营驾驶舱")).toBeVisible();

    // NAV-GRAPH-MERGE（用户亲报 IA 冗余）：不再存在独立「图谱体系」组——八视角直达并入「建模与图谱」。
    // 回退成两组（恢复独立图谱体系组）即红。
    expect(within(nav).queryByTestId("nav-group-图谱体系")).toBeNull();
    const modelingGroup = within(nav).getByTestId("nav-group-建模与图谱");
    // 图谱主入口 + 八视角直达 + 建模管理页同组（深链不丢·不漏「其它」组）。
    for (const label of ["图谱·全景", "图谱·主干分级", "本体建模"]) {
      expect(within(modelingGroup).getByText(label)).toBeVisible();
    }
    // 八视角未泄漏到「其它」兜底组（若泄漏说明并组时从 NAV_GROUPS 覆盖面丢失）。
    const leftover = within(nav).queryByTestId("nav-group-其它");
    if (leftover) expect(within(leftover).queryByText("图谱·全景")).toBeNull();

    // 组头折叠仍可用（折叠记忆机制不因并组受损）：折叠→子项不可见；展开→恢复。
    await user.click(within(nav).getByTestId("nav-group-toggle-建模与图谱"));
    await waitFor(() => expect(within(nav).getByText("图谱·全景")).not.toBeVisible());
    await user.click(within(nav).getByTestId("nav-group-toggle-建模与图谱"));
    await waitFor(() => expect(within(nav).getByText("图谱·全景")).toBeVisible());
  });
});
