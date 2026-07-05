import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * INTAKE-XLSX-EXPORT · 数据连接器页「导出全部源数据(Excel)」按钮齿：
 * 顶栏按钮存在 + 点击真发 fetch → /a/v1/raw-datasets/export.xlsx（走下载链路·URL.createObjectURL 被调）；
 * 连接级按钮存在且带 ?connId=。
 */
describe("INTAKE-XLSX-EXPORT 前端导出按钮", () => {
  it("顶栏「导出全部源数据」按钮存在，点击 → fetch export.xlsx（无 connId）+ 触发下载", async () => {
    const createSpy = vi.fn(() => "blob:xe");
    const revokeSpy = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createSpy;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeSpy;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/connections");

    const btn = await screen.findByTestId("export-all-source-xlsx");
    expect(btn).toBeTruthy();
    await user.click(btn);

    // 真发到全数据集导出端点（无 connId 段）+ 走完 blob 下载链路。
    const called = fetchSpy.mock.calls.some(([u]) => String(u).includes("/a/v1/raw-datasets/export.xlsx") && !String(u).includes("connId"));
    expect(called).toBe(true);
    expect(createSpy).toHaveBeenCalled();
  });

  it("连接级「导出本连接源数据」按钮存在，点击 → fetch export.xlsx?connId=<id>", async () => {
    const createSpy = vi.fn(() => "blob:xe2");
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createSpy;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/connections");

    // mock 连接 conn-erp 有数据集 → 连接级导出按钮渲染。
    const connBtn = await screen.findByTestId("conn-export-xlsx-conn-erp");
    expect(connBtn).toBeTruthy();
    await user.click(connBtn);

    const called = fetchSpy.mock.calls.some(([u]) => String(u).includes("/a/v1/raw-datasets/export.xlsx") && String(u).includes("connId=conn-erp"));
    expect(called).toBe(true);
    expect(createSpy).toHaveBeenCalled();
  });
});
