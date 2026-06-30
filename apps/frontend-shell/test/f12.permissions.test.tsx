import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

describe("F12 · 权限 UI 与 feature 守卫", () => {
  it("base_manager：admin 导航隐藏；直输 /admin/permissions → 403", async () => {
    loginAs("base_manager");
    renderApp("/admin/permissions");
    expect(await screen.findByTestId("page-403")).toBeInTheDocument();
    // N1 统一域分组：base_manager 无管理页→纯 admin 组隐藏。WO-NAV-DATA 后「数据」组含 order 视图（业务台账）
    // 故不再恒空；改验纯 admin 的「建模与图谱」组隐藏以保原意。
    expect(screen.queryByTestId("nav-group-建模与图谱")).not.toBeInTheDocument();
  });

  it("base_manager：feature 关闭的视图直访 → 404（404 优先于 403）", async () => {
    loginAs("base_manager");
    renderApp("/v/plan-audit");
    expect(await screen.findByTestId("page-404")).toBeInTheDocument();
  });

  it("planner：aop（原型存在但无后端支持，renderer 未注册）→ 「该视图类型暂不支持」兜底卡", async () => {
    loginAs("planner");
    renderApp("/v/aop");
    expect(await screen.findByTestId("unsupported-view")).toBeInTheDocument();
    expect(screen.getByText("该视图类型暂不支持")).toBeInTheDocument();
  });

  it("planner：admin 导航可见且 /admin/permissions 可访问", async () => {
    loginAs("planner");
    renderApp("/admin/permissions");
    expect(await screen.findByTestId("authz-explain")).toBeInTheDocument();
    expect(screen.getByTestId("nav-group-数据")).toBeInTheDocument(); // N1 统一域分组：admin 角色见管理类域分组（WO-NAV-DATA 改名「数据」）
  });
});
