import { beforeEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { __resetSliceGovMock } from "@/mocks/handlers";
import SliceInspector from "@/pages/admin/SliceInspector";

/**
 * WO-SLICE-GOVERNANCE-FULL（前端）：本体切片页从"只读、点不了" → 可编辑 + 推进为契约 + 点击就地内联图谱。
 *  1. 无契约行「推进为契约」（单）→ 徽标 无契约→1✓；顶部「全部推进」（批）。
 *  2. admin 点切片行 → 就地内联子图（LayeredDag）渲染在同页，**不跳转**图谱模块。
 *  3. admin 可编辑规格并保存；非 admin 只读（有内联子图无编辑器）。
 */
describe("WO-SLICE-GOVERNANCE-FULL · 切片可编辑 / 推进为契约 / 内联图谱", () => {
  beforeEach(() => __resetSliceGovMock());

  it("admin：推进为契约翻转徽标 + 点行就地内联子图（不跳转）+ 可编辑保存", async () => {
    const user = userEvent.setup();
    loginAs("planner"); // planner 账号含 admin 角色
    const { router } = renderApp("/admin/slices");
    await screen.findByTestId("slices-page");

    // 起点：base_risk_profile 无契约
    const badge = await screen.findByTestId("slice-fixtures-base_risk_profile");
    expect(badge.textContent).toContain("无契约");

    // 推进为契约（单）→ 徽标翻转为 1 ✓
    await user.click(await screen.findByTestId("slice-promote-base_risk_profile"));
    await waitFor(() =>
      expect(screen.getByTestId("slice-fixtures-base_risk_profile").textContent).toContain("✓"),
    );

    // 点切片行 → 就地内联子图（LayeredDag），且 URL 未跳转（仍在 /admin/slices）
    await user.click(screen.getByTestId("slice-row-model_capacity_network"));
    await screen.findByTestId("slice-graph-model_capacity_network");
    expect(screen.getByTestId("slice-graph-nodes-model_capacity_network").textContent).toBe("3");
    expect(router.state.location.pathname).toBe("/admin/slices");
    // 断言未进图谱模块：无本体图谱视图容器
    expect(screen.queryByTestId("ontology-graph-view")).toBeNull();

    // admin 可编辑：改 maxNodes → 保存（putSliceSpec）成功（不崩、不跳转）
    const editor = await screen.findByTestId("slice-editor-model_capacity_network");
    const maxNodes = within(editor).getByTestId("slice-edit-maxnodes-model_capacity_network");
    await user.clear(maxNodes);
    await user.type(maxNodes, "321");
    await user.click(within(editor).getByTestId("slice-edit-save-model_capacity_network"));
    await waitFor(() => expect(screen.getByTestId("slice-editor-model_capacity_network")).toBeTruthy());
    expect(router.state.location.pathname).toBe("/admin/slices");
  });

  it("admin：顶部「全部推进」批量补齐无契约切片", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/slices");
    await screen.findByTestId("slices-page");
    await user.click(await screen.findByTestId("slice-promote-all"));
    await waitFor(() =>
      expect(screen.getByTestId("slice-fixtures-base_risk_profile").textContent).toContain("✓"),
    );
  });

  it("gating：非 admin 只读（内联子图可见、无编辑器）；admin 有编辑器", async () => {
    // 只读：canEdit=false → 内联子图渲染，但无编辑器
    const roQc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ro = render(
      <QueryClientProvider client={roQc}>
        <SliceInspector sliceKey="base_risk_profile" canEdit={false} />
      </QueryClientProvider>,
    );
    await ro.findByTestId("slice-readonly-base_risk_profile");
    await ro.findByTestId("slice-graph-base_risk_profile"); // 就地内联子图仍渲染
    expect(ro.queryByTestId("slice-editor-base_risk_profile")).toBeNull();
    ro.unmount();

    // 可编辑：canEdit=true → 编辑器出现
    const rwQc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rw = render(
      <QueryClientProvider client={rwQc}>
        <SliceInspector sliceKey="base_risk_profile" canEdit={true} />
      </QueryClientProvider>,
    );
    await rw.findByTestId("slice-editor-base_risk_profile");
    // 无契约 → 面板内「推进为契约」按钮可用
    expect(rw.getByTestId("slice-inspector-promote-base_risk_profile")).toBeTruthy();
    rw.unmount();
  });
});
