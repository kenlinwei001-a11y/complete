import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { ADMIN_PAGES, canAccessAdmin } from "@/pages/adminRegistry";

/**
 * F63 · GROWTH-TICKET-MERGE（用户亲定 2026-07-06）：自成长驾驶舱 /admin/growth 与工单中心 /admin/tickets
 * 功能多重合 → 合为一个工单中心（超集）。四齿：
 *  ① 导航无 growth 独立项（撤退）；
 *  ② 工单中心承接驾驶舱两处独有功能——诊断触发入口 + 量化指标头条（防丢·断言在）；
 *  ③ /admin/growth 302→/admin/tickets 一致性（tombstone 防死链）；
 *  ④ 角色门取并集 admin/data_admin/catalog_admin 可达（防某角色合并后失访问）。
 * revert 任一 → 红。
 */
describe("F63 · GROWTH-TICKET-MERGE（驾驶舱归并工单中心·四齿）", () => {
  it("齿① 导航无 growth 独立项（撤退）+ 工单中心项在", async () => {
    loginAs("planner"); // admin+catalog_admin+planner+tenant_admin
    renderApp("/admin/tickets");
    await screen.findByTestId("ticket-center-page");

    const nav = screen.getByTestId("left-nav");
    // growth 独立导航项已撤（label「自成长发动机」不再出现于左导航）。
    expect(within(nav).queryByText("自成长发动机")).toBeNull();
    // 没有指向已退役 /admin/growth 的导航链接。
    const growthLink = within(nav).queryAllByRole("link").find((a) => a.getAttribute("href") === "/admin/growth");
    expect(growthLink).toBeUndefined();
    // 工单中心导航项在（承接主体）。
    expect(within(nav).getByText("工单中心")).toBeInTheDocument();
  });

  it("齿② 工单中心承接诊断触发入口 + 量化指标头条（两独有功能·防丢）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/tickets");
    await screen.findByTestId("ticket-center-page");

    // (b) 量化指标头条：需求可答率（账本 2 条 1 CONVERGED → 50%）+ 补成率。
    const metrics = await screen.findByTestId("tc-metrics");
    expect(within(metrics).getByTestId("tc-metric-answer-rate")).toHaveTextContent("50%");
    expect(within(metrics).getByTestId("tc-metric-fillrate")).toHaveTextContent("%");
    expect(within(metrics).getByTestId("tc-metric-open")).toBeInTheDocument();
    expect(within(metrics).getByTestId("tc-metric-mine")).toBeInTheDocument();

    // (a) 诊断触发入口：折叠态 → 点开 → 运行框 → 运行诊断 → 本次运行报告（把客户问题当燃料跑一轮 QOS）。
    expect(screen.queryByTestId("tc-diagnose-panel")).toBeNull(); // 默认折叠
    await user.click(screen.getByTestId("tc-diagnose-toggle"));
    const panel = await screen.findByTestId("tc-diagnose-panel");
    expect(within(panel).getByTestId("tc-diagnose-query")).toBeInTheDocument();
    await user.click(within(panel).getByTestId("tc-diagnose-run"));
    // 报告真渲染（终态徽章 + 第 1 轮）。
    const report = await screen.findByTestId("tc-diagnose-report");
    expect(within(report).getByTestId("tc-diagnose-terminal")).toBeInTheDocument();
    expect(within(report).getByTestId("tc-diagnose-round-1")).toBeInTheDocument();
  });

  it("齿③ /admin/growth 302→/admin/tickets（tombstone 一致性·防死链）", async () => {
    loginAs("planner");
    const { router } = renderApp("/admin/growth");
    // 旧路由承接落回工单中心（重定向后渲染工单中心页）。
    await screen.findByTestId("ticket-center-page");
    expect(router.state.location.pathname).toBe("/admin/tickets");
  });

  it("齿④ 角色门并集：admin/data_admin/catalog_admin 三角色皆可达工单中心；域外角色不可达", () => {
    const tickets = ADMIN_PAGES.find((p) => p.path === "tickets")!;
    expect(tickets.roles).toEqual(expect.arrayContaining(["admin", "data_admin", "catalog_admin"]));
    // 并集三角色逐一可达（防某角色合并后失访问）。
    expect(canAccessAdmin(["admin"], tickets)).toBe(true);
    expect(canAccessAdmin(["data_admin"], tickets)).toBe(true); // growth 独有角色·并集后保留
    expect(canAccessAdmin(["catalog_admin"], tickets)).toBe(true);
    // 域外角色不可达（角色门非全放行）。
    expect(canAccessAdmin(["viewer"], tickets)).toBe(false);
    // growth 页已退役——ADMIN_PAGES 无 growth 登记。
    expect(ADMIN_PAGES.find((p) => p.path === "growth")).toBeUndefined();
  });
});
