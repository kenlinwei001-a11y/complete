import { describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * A18.4 求解器审核台（L3，MSW 假后端）：列临时求解器制品（审核中/已治理）→ 看冻结代码 →
 * 晋升 GOVERNED（解锁写真值，R4）。验"审核台 UI ↔ /a/v1/solvers/artifacts + /promote"打通。
 */
describe("A18.4 · 求解器审核台（L3）", () => {
  it("列临时求解器制品 + 状态徽章 + 看代码弹窗", async () => {
    loginAs("planner");
    renderApp("/admin/solver-review");
    await screen.findByTestId("solver-review-page");
    // 两个 mock 制品：审核中 seg_share_forecast + 已治理 material_coverage
    expect(await screen.findByTestId("solver-artifact-seg_share_forecast")).toBeTruthy();
    expect(screen.getByTestId("solver-artifact-material_coverage")).toBeTruthy();
    expect(screen.getByTestId("solver-status-seg_share_forecast").textContent).toContain("审核中");
    expect(screen.getByTestId("solver-status-material_coverage").textContent).toContain("已治理");
    // 看代码 → 冻结源码弹窗
    await userEvent.click(screen.getByTestId("solver-view-seg_share_forecast"));
    const detail = await screen.findByTestId("solver-artifact-detail");
    expect(within(detail).getByTestId("solver-source").textContent).toContain("DemandSegment");
    cleanup();
  });

  it("晋升 PROVISIONAL → GOVERNED（审核台行内按钮 → 状态翻转）", async () => {
    loginAs("planner");
    renderApp("/admin/solver-review");
    await screen.findByTestId("solver-review-page");
    // 审核中件有晋升按钮；已治理件没有
    const promoteBtn = await screen.findByTestId("solver-promote-seg_share_forecast");
    expect(screen.queryByTestId("solver-promote-material_coverage")).toBeNull();
    await userEvent.click(promoteBtn);
    // 晋升后状态翻转为已治理
    await waitFor(() => expect(screen.getByTestId("solver-status-seg_share_forecast").textContent).toContain("已治理"));
    cleanup();
  });
});
