import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F50 · 数据构建发动机页面统一规格 P3 + P3.5 + P4。
 * - 区6 完整性·自检·信任：全链闭包可视化（BOUND/MISSING + R12 双向闭包徽章）+ 故事覆盖度（逐句映射）。
 * - 区7 一键推演（P3.5）：可达 → 「一键推演」按钮落 targetView；不可达 → 诚实显示"断在 <缺口码>"。
 * - P4 三页归一：自成长缺口工单看板内嵌（自成长收编）+ 快速合成入口同在（无功能丢失）。
 */
describe("F50 · 数据构建发动机控制台 P3/P3.5/P4（区6 信任 + 区7 推演 + 三页归一）", () => {
  it("区6：建域后展开 → 全链闭包可视化（R12 双向闭包徽章 HARD/SOFT）+ 故事覆盖度逐句映射", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    const timeline = await screen.findByTestId("sbr-timeline");

    await user.click(screen.getByTestId("sbr-run"));
    // 区6① 全链闭包可视化 + ② R12 徽章
    const closureViz = await within(timeline).findByTestId("sbr-closureviz");
    expect(within(closureViz).getByText(/完整 ✓/)).toBeTruthy();
    expect(within(closureViz).getAllByTestId("r12-ok").length).toBeGreaterThan(0);
    // 区6③ 故事覆盖度：逐句映射（demo 脚本三句全命中 → 没遗漏）
    const coverage = await within(timeline).findByTestId("sbr-coverage");
    expect(within(coverage).getByText(/逐句已建模/)).toBeTruthy();
    expect(within(coverage).getAllByTestId("coverage-mapped").length).toBeGreaterThan(0);
    // 区6④ 推演验证痕迹（一致性 + 交叉验证）回写 run → 内嵌 ValidationTracePanel
    expect(await within(timeline).findByTestId("validation-trace")).toBeTruthy();
  });

  it("区7 可达：构建端到端可跑场景 → 「一键推演」按钮出现（落 targetView 真实业务页）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    const timeline = await screen.findByTestId("sbr-timeline");

    await user.click(screen.getByTestId("sbr-run"));
    // 干净建域 → 推演可达 → 一键推演按钮（落 risk 页）
    const btn = await within(timeline).findByText(/一键推演/);
    expect(btn).toBeTruthy();
    expect(btn.closest("button")).toBeTruthy();
    // 点击不报错（注入 presetContext + submitQuery + 跳转，复用场景启动器）
    await user.click(btn);
  });

  it("区7 不可达诚实：仍缺求解器的故事 → 「不可达：断在 SOLVER_NOT_FOUND」，不假装能跳", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    const timeline = await screen.findByTestId("sbr-timeline");

    const ta = screen.getByTestId("db-script");
    await user.clear(ta);
    await user.type(ta, "缺求解器的风险推演场景");
    await user.click(screen.getByTestId("sbr-run"));

    expect(await within(timeline).findByText(/推演当前不可达：断在/)).toBeTruthy();
    expect(within(timeline).getByText("SOLVER_NOT_FOUND")).toBeTruthy();
  });

  it("P4 三页归一：自成长缺口工单看板内嵌 + 快速合成入口同在（无功能丢失，UI-7）", async () => {
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    // 自成长收编：缺口工单看板内嵌 + 聚焦视图深链
    const growth = await screen.findByTestId("db-growth-console");
    expect(within(growth).getByText(/自成长聚焦视图/)).toBeTruthy();
    // 合成数据页收编：快速合成入口同在本页
    expect(screen.getByTestId("db-quick-synth")).toBeTruthy();
  });
});
