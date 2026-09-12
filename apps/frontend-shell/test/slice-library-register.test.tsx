import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-SLICE-CONSUMPTION-20260912 · WO-1②：切片库登记链（AC2）。
 * 判据：
 *  ① 未登记条目对可编辑角色显「登记为切片」；点击走现有 PUT（B1 零新端点）→ 翻「已登记」章；
 *  ② 顶部「全部登记」仅 admin 可见（后端 requireAdmin——不对 data_admin 摆必然 403 的按钮）；
 *  ③ data_admin（页面可见但非 admin/catalog_admin）：行内按钮与顶部按钮都不显，只看得到「未登记」；
 *  ④ 已登记条目不再显按钮（幂等，重复登记不翻倍）。
 * 注：mock 登记表在同文件各用例间累积（MSW 模块态），用例顺序即事实顺序。
 */
describe("切片库登记链（AC2）", () => {
  it("data_admin：行内「登记为切片」与顶部「全部登记」都不显", async () => {
    loginAs("data_admin");
    renderApp("/admin/slices?tab=library");
    await screen.findByTestId("slice-library-table");
    expect(await screen.findByTestId("slice-library-unregistered-biz.factory.model_capacity")).toBeTruthy();
    expect(await screen.findByTestId("slice-library-unregistered-biz.x.order_to_base")).toBeTruthy();
    expect(screen.queryByTestId("slice-library-register-biz.factory.model_capacity")).toBeNull();
    expect(screen.queryByTestId("slice-library-register-all")).toBeNull();
  });

  it("admin：行内「登记为切片」→ PUT → 翻「已登记」章", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/slices?tab=library");
    await screen.findByTestId("slice-library-table");

    await user.click(await screen.findByTestId("slice-library-register-biz.factory.model_capacity"));
    // 章翻面 = 重拉的已登记清单里有了它（mock PUT 真写登记表）
    expect(await screen.findByTestId("slice-library-registered-biz.factory.model_capacity")).toBeTruthy();
    expect(screen.queryByTestId("slice-library-register-biz.factory.model_capacity")).toBeNull();
    // 另一条不受影响，仍可登记
    expect(await screen.findByTestId("slice-library-register-biz.x.order_to_base")).toBeTruthy();
  });

  it("admin：顶部「全部登记」→ library/build → 全部翻「已登记」章", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/slices?tab=library");
    await screen.findByTestId("slice-library-table");

    await user.click(await screen.findByTestId("slice-library-register-all"));
    expect(await screen.findByTestId("slice-library-registered-biz.factory.model_capacity")).toBeTruthy();
    expect(await screen.findByTestId("slice-library-registered-biz.x.order_to_base")).toBeTruthy();
    // 全部登记完 → 顶部按钮（带待登记计数）消失
    expect(screen.queryByTestId("slice-library-register-all")).toBeNull();
  });

  it("WO-1③（G4）：已登记页签 biz.* 默认归组折叠，不与手工切片混排", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    // 沿用上一用例的 mock 态（两条 biz.* 已登记）
    renderApp("/admin/slices");
    await screen.findByTestId("slices-table");
    // 手工切片照常在表内；biz.* 行默认不可见，只见归组条
    expect(await screen.findByTestId("slice-model_capacity_network")).toBeTruthy();
    expect(screen.queryByTestId("slice-biz.factory.model_capacity")).toBeNull();
    expect(screen.queryByTestId("slice-biz.x.order_to_base")).toBeNull();
    const toggle = await screen.findByTestId("slices-biz-group-toggle");
    expect(toggle.textContent).toContain("2 条");
    // 点开归组 → 两条 biz.* 行出现
    await user.click(toggle);
    expect(await screen.findByTestId("slice-biz.factory.model_capacity")).toBeTruthy();
    expect(await screen.findByTestId("slice-biz.x.order_to_base")).toBeTruthy();
  });
});
