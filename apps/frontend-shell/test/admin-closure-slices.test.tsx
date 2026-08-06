import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * 轨 G · C7 切片编辑器（SlicesPage · AC8 步1）。
 * 断言：＋新建切片 → root+targets 可视构建 → 规划路径（planSlice）→ 入库（PUT）→ 试切预览（resolve 子图）。
 * 此前 SlicesPage 仅只读列表（AC8 步1 死路）。
 */
describe("C7 · 切片编辑器（建切片→试切→入库）", () => {
  it("＋新建 → 选 root+target → 规划 → 入库 → 试切预览出子图", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/slices");
    await screen.findByTestId("slices-page");

    await user.click(await screen.findByTestId("slice-create"));
    const builder = await screen.findByTestId("slice-builder");
    expect(builder).toBeTruthy();

    // 选 root（首个对象类型）
    const root = within(builder).getByTestId("slice-root") as HTMLSelectElement;
    await waitFor(() => expect(root.options.length).toBeGreaterThan(1));
    await user.selectOptions(root, root.options[1]!.value);

    // 选一个 target
    const targets = await within(builder).findByTestId("slice-targets");
    const firstTarget = within(targets).getAllByRole("button")[0]!;
    await user.click(firstTarget);

    // 规划路径
    await user.click(within(builder).getByTestId("slice-plan"));
    const planResult = await screen.findByTestId("slice-plan-result");
    expect(planResult).toBeTruthy();

    // 入库
    await user.click(screen.getByTestId("slice-save"));
    // 试切预览
    await user.click(screen.getByTestId("slice-preview"));
    const preview = await screen.findByTestId("slice-preview-result");
    expect(within(preview).getByTestId("slice-preview-nodes").textContent).toBe("2");
    // WO-UNIT-MEANING：此前只有「节点 2 · 边 1」的裸数（2 是节点数还是层数/跳数？）→ 补计数单位并锁死
    expect(within(preview).getByText(/节点/).textContent).toMatch(/节点\s*2\s*个 · 边\s*\d+\s*条/);
  });
});
