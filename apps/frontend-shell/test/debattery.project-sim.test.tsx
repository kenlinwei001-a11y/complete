import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * 去电池锁死 P1（PRD-de-battery-multitenant-config / R14）回归：
 * 项目推演的型号下拉来自 WorkspaceConfig（`scenarioPackages[0].simConfig.models`），非前端硬编码。
 * mock 配置里放了一个独有的"配置驱动型号-X"——它出现在下拉里，即证明数据走的是配置、不是写死常量。
 */
describe("去电池锁死 P1 · 项目推演型号来自 WorkspaceConfig", () => {
  it("型号下拉含 WorkspaceConfig 独有项 → 证明配置驱动（非硬编码）", async () => {
    loginAs("planner");
    renderApp("/v/project-sim");
    // findByRole 会重试，直到 workspace 异步加载、配置驱动的型号渲染出来
    const opt = await screen.findByRole("option", { name: "配置驱动型号-X" });
    expect(opt).toBeInTheDocument(); // 仅存在于 mock simConfig，不在组件 DEFAULT_MODELS → 证明配置驱动
  });
});
