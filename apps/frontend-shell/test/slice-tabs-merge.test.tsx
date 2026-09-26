import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-SLICE-CONSUMPTION-20260912 · 前置 A1：三页签合并 + 导航撤销 + 旧路径重定向（AC1）。
 * 判据：
 *  ① 默认页签 = 已登记（注册切片清单）；
 *  ② ?tab=library / ?tab=plan 深链直达对应页签；
 *  ③ 旧 /admin/slice-library 301（replace）到 /admin/slices?tab=library，旧书签不断；
 *  ④ 页签点击同页切换（已登记 ↔ 切片库 ↔ 路径规划）。
 */
describe("切片三页签合并（AC1）", () => {
  it("默认落在「已登记」页签", async () => {
    loginAs("planner");
    renderApp("/admin/slices");
    await screen.findByTestId("slices-page");
    expect(await screen.findByTestId("slices-table")).toBeTruthy();
    expect(screen.queryByTestId("slice-library-table")).toBeNull();
    expect(screen.queryByTestId("slice-builder")).toBeNull();
  });

  it("?tab=library 深链直达切片库页签", async () => {
    loginAs("planner");
    renderApp("/admin/slices?tab=library");
    await screen.findByTestId("slices-page");
    const table = await screen.findByTestId("slice-library-table");
    expect(table).toBeTruthy();
    // 库条目真渲染（mock 两库各一条）
    expect(await screen.findByTestId("slice-library-biz.factory.model_capacity")).toBeTruthy();
    expect(await screen.findByTestId("slice-library-biz.x.order_to_base")).toBeTruthy();
  });

  it("?tab=plan 深链直达路径规划页签", async () => {
    loginAs("planner");
    renderApp("/admin/slices?tab=plan");
    await screen.findByTestId("slices-page");
    expect(await screen.findByTestId("slice-builder")).toBeTruthy();
    expect(screen.queryByTestId("slices-table")).toBeNull();
  });

  it("旧 /admin/slice-library 重定向到 /admin/slices?tab=library", async () => {
    loginAs("planner");
    renderApp("/admin/slice-library");
    // 落点 = 切片三页签页的库页签（不是 404、不是空白）
    const table = await screen.findByTestId("slice-library-table");
    expect(table).toBeTruthy();
    expect(screen.queryByTestId("page-404")).toBeNull();
  });

  it("页签点击同页切换", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/slices");
    await screen.findByTestId("slices-table");

    await user.click(await screen.findByTestId("slices-tab-library"));
    expect(await screen.findByTestId("slice-library-table")).toBeTruthy();
    expect(screen.queryByTestId("slices-table")).toBeNull();

    await user.click(await screen.findByTestId("slices-tab-plan"));
    expect(await screen.findByTestId("slice-builder")).toBeTruthy();
    expect(screen.queryByTestId("slice-library-table")).toBeNull();

    await user.click(await screen.findByTestId("slices-tab-registered"));
    expect(await screen.findByTestId("slices-table")).toBeTruthy();
    expect(screen.queryByTestId("slice-builder")).toBeNull();
  });

  it("「＋新建切片」跳到路径规划页签（原 C7 构建器入口不丢）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/slices");
    await screen.findByTestId("slices-table");
    await user.click(await screen.findByTestId("slice-create"));
    expect(await screen.findByTestId("slice-builder")).toBeTruthy();
  });
});
