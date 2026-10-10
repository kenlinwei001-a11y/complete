import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

describe("F38 · A7 数据构建发动机（Foundry-Grade Data Builder）", () => {
  it("预设可见 + 运行构建 → 七阶段全 DONE + 闭包门禁通过", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");

    // 预设 builder 可见
    const preset = await screen.findByTestId("db-preset");
    expect(preset).toHaveTextContent("Foundry-Grade Data Builder");
    expect(preset).toHaveTextContent("PUBLISHED");

    // 运行构建
    await user.click(screen.getByTestId("db-run"));

    const result = await screen.findByTestId("db-result");
    expect(within(result).getByTestId("db-job-status")).toHaveTextContent("SUCCEEDED");
    // 七阶段全部 DONE
    for (const phase of ["intake", "comprehend", "gap", "rawin", "transform", "closure", "publish"]) {
      expect(within(result).getByTestId(`db-phase-${phase}`)).toHaveTextContent("DONE");
    }
    // 闭包门禁通过
    expect(within(result).getByTestId("db-closure-gate")).toHaveTextContent("通过");
  });

  it("dry-run → 灌注/加工/发布阶段 SKIPPED + 预览出清单", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("db-preset");

    await user.click(screen.getByTestId("db-dryrun"));
    await user.click(screen.getByTestId("db-run"));

    const result = await screen.findByTestId("db-result");
    expect(within(result).getByTestId("db-phase-rawin")).toHaveTextContent("SKIPPED");
    expect(within(result).getByTestId("db-phase-publish")).toHaveTextContent("SKIPPED");
    await waitFor(() => expect(screen.getByTestId("db-preview")).toBeInTheDocument());
  });
});
