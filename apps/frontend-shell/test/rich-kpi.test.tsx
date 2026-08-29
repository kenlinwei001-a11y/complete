import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * DS.2 · 经营驾驶舱富 KPI 补全（可供给/收入达成/利用率瓶颈/AOP基准/现金垫C18）。
 * cockpit_kpi 一 solver 出 5 标量、各 kpi widget valuePath 取。门B Playwright 已真验；此为 CI 回归。
 */
describe("DS.2 · dash 富 KPI widget", () => {
  it("5 个富 KPI widget 渲染且有数值", async () => {
    loginAs("planner");
    renderApp("/v/dash");
    await screen.findByTestId("dashboard-grid");
    for (const k of ["supply-v7", "rev-attain", "util-peak", "aop-base", "cash-cushion"]) {
      await waitFor(() => expect(screen.getByTestId(`widget-${k}`)).toHaveTextContent(/\d/));
    }
  });
});
