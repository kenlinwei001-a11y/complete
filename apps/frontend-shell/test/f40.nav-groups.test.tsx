import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/** GRAPH-PANORAMA-ONLY（用户亲定 2026-07-05）：七视角标签——导航中出现任何一个即违裁定（teeth）。 */
const RETIRED_PERSP_LABELS = [
  "图谱·主干分级",
  "图谱·产能推演网络",
  "图谱·数据来源",
  "图谱·求解器布局",
  "图谱·MVP",
  "图谱·智能体网络",
  "图谱·学习闭环",
];

describe("F40 · 统一域分组导航（N1：视图+管理合一套域分组，可折叠）", () => {
  it("功能分组头渲染；建模与图谱组仅存「图谱全景」（GRAPH-PANORAMA-ONLY·七视角全删）；组头可折叠展开", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/dash");

    const nav = await screen.findByTestId("nav-business");
    // N1 统一域分组头（推演/建模与图谱…）
    for (const g of ["规划与平衡", "推演", "建模与图谱"]) {
      expect(within(nav).getByTestId(`nav-group-${g}`)).toBeInTheDocument();
    }
    // 概览项（无组头）直接可见
    expect(within(nav).getByText("经营驾驶舱")).toBeVisible();

    // NAV-GRAPH-MERGE（用户亲报 IA 冗余）：不再存在独立「图谱体系」组。回退成两组即红。
    expect(within(nav).queryByTestId("nav-group-图谱体系")).toBeNull();

    // NAV-DROP-LEDGER-MAP（用户亲定 2026-07-06·teeth）：低价值「台账与地图」组（仅基地地理视图）已退役——
    // 组头不再出现；基地地理视图不得漏入「其它」兜底组（重加回组或项即红）。
    expect(within(nav).queryByTestId("nav-group-台账与地图")).toBeNull();
    expect(within(nav).queryByText("基地地理视图")).toBeNull();
    const leftoverLm = within(nav).queryByTestId("nav-group-其它");
    if (leftoverLm) expect(within(leftoverLm).queryByText("基地地理视图")).toBeNull();

    // GRAPH-PANORAMA-ONLY（用户亲定 2026-07-05·无豁免）：图谱唯一入口=「图谱全景」；
    // 七视角（主干/流/源/求解器/MVP/智能体/学习闭环）全删——重新加回任何一个即红。
    const modelingGroup = within(nav).getByTestId("nav-group-建模与图谱");
    for (const label of ["图谱全景", "本体建模"]) {
      expect(within(modelingGroup).getByText(label)).toBeVisible();
    }
    for (const retired of RETIRED_PERSP_LABELS) {
      expect(within(nav).queryByText(retired)).toBeNull();
    }
    // 全景旧名（图谱·全景 / 本体图谱）也不再单列（graph-all 与主入口已合一）。
    expect(within(nav).queryByText("图谱·全景")).toBeNull();
    expect(within(nav).queryByText("本体图谱")).toBeNull();
    // 未泄漏到「其它」兜底组。
    const leftover = within(nav).queryByTestId("nav-group-其它");
    if (leftover) expect(within(leftover).queryByText("图谱全景")).toBeNull();

    // 组头折叠仍可用（折叠记忆机制不因删视角受损）：折叠→子项不可见；展开→恢复。
    await user.click(within(nav).getByTestId("nav-group-toggle-建模与图谱"));
    await waitFor(() => expect(within(nav).getByText("图谱全景")).not.toBeVisible());
    await user.click(within(nav).getByTestId("nav-group-toggle-建模与图谱"));
    await waitFor(() => expect(within(nav).getByText("图谱全景")).toBeVisible());
  });
});
