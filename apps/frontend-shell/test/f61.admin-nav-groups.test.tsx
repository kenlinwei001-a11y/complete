import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { ADMIN_PAGES, groupAdminPages, ADMIN_NAV_GROUPS } from "@/pages/adminRegistry";
import { NAV_GROUPS } from "@/pages/ShellLayout";

/**
 * nav-reorg · 管理区导航按业务域分组（配置驱动 R14，父级字号≥子级）。
 */
describe("nav-reorg · 管理区分组（groupAdminPages + 渲染）", () => {
  it("groupAdminPages：所有管理页都归入某组（无遗漏），空组剔除，确定性顺序", () => {
    const groups = groupAdminPages(ADMIN_PAGES);
    const grouped = groups.flatMap((g) => g.pages.map((p) => p.path));
    // 无遗漏：每个 ADMIN_PAGES 都出现在某组
    for (const p of ADMIN_PAGES) expect(grouped).toContain(p.path);
    // 无「其它」兜底组（说明配置已全覆盖）
    expect(groups.some((g) => g.key === "other")).toBe(false);
    // 组顺序 = 配置顺序（确定性）
    expect(groups.map((g) => g.key)).toEqual(ADMIN_NAV_GROUPS.filter((g) => g.paths.some((path) => ADMIN_PAGES.some((p) => p.path === path))).map((g) => g.key));
  });

  it("空组剔除 + 未配置页落「其它」组（不丢）", () => {
    const subset = ADMIN_PAGES.filter((p) => p.path === "connections"); // 仅一页
    const groups = groupAdminPages(subset);
    expect(groups.length).toBe(1);
    expect(groups[0]!.title).toBe("数据接入");
    // 未配置的新页 → 落「其它」
    const withUnknown = groupAdminPages([...subset, { path: "brand-new-page", label: "新页", roles: ["admin"] }]);
    expect(withUnknown.some((g) => g.key === "other" && g.pages.some((p) => p.path === "brand-new-page"))).toBe(true);
  });

  it("渲染（N1 统一域分组）：admin 登录 → 统一导航出现业务域分组头（数据接入/建模与图谱）含连接器叶项", async () => {
    loginAs("planner"); // planner 含 admin 角色 → 见全部管理页
    renderApp("/admin/connections");
    const nav = await screen.findByTestId("nav-business"); // N1：业务+管理合一套域分组
    // 分组头（NavGroup）出现
    expect(within(nav).getByTestId("nav-group-数据接入")).toBeInTheDocument();
    expect(within(nav).getByTestId("nav-group-建模与图谱")).toBeInTheDocument();
    // 叶项在组内
    expect(within(nav).getByText("连接器与上传")).toBeInTheDocument();
  });

  // WO-SWEEP-03-NAV-GROUP：ShellLayout 的 NAV_GROUPS 是左导航真实渲染用的分组源（≠ adminRegistry.groupAdminPages，
  // 后者仅本测试引用）。此前二者漂移——boundary/prototype-intake 未登记进 NAV_GROUPS → 真实导航里落「其它」兜底组。
  // 以下结构守卫 + 真实渲染断言防复发。
  it("结构守卫：NAV_GROUPS 的 admin 键覆盖全部 ADMIN_PAGES（无管理页漏配 → 不落「其它」）", () => {
    const navAdminKeys = new Set(
      NAV_GROUPS.flatMap((g) => g.items.filter((it) => it.kind === "admin").map((it) => it.key)),
    );
    const missing = ADMIN_PAGES.map((p) => p.path).filter((path) => !navAdminKeys.has(path));
    expect(missing).toEqual([]);
  });

  it("boundary / prototype-intake 归「建模与图谱」组（对齐 adminRegistry modeling 组）", () => {
    const modeling = NAV_GROUPS.find((g) => g.title === "建模与图谱")!;
    const keys = modeling.items.filter((it) => it.kind === "admin").map((it) => it.key);
    expect(keys).toContain("boundary");
    expect(keys).toContain("prototype-intake");
  });

  it("真实渲染：admin 登录 → boundary/prototype-intake 出现在「建模与图谱」组、且不落「其它」兜底组", async () => {
    loginAs("planner"); // 含 admin 角色 → 见全部管理页
    renderApp("/admin/connections");
    const nav = await screen.findByTestId("nav-business");
    // canonical 页标签：boundary → 边界册治理、prototype-intake → 原型 intake（见 adminRegistry.ADMIN_PAGES）。
    const cases: [string, string][] = [
      ["边界册治理", "nav-group-建模与图谱"],
      ["原型 intake", "nav-group-建模与图谱"],
    ];
    for (const [label, groupTestId] of cases) {
      const group = within(nav).getByTestId(groupTestId);
      expect(within(group).getByText(label)).toBeInTheDocument();
    }
    // 不再有「其它」兜底组包含这两页（若组存在也不得含它们）。
    const other = within(nav).queryByTestId("nav-group-其它");
    if (other) {
      for (const [label] of cases) expect(within(other).queryByText(label)).toBeNull();
    }
  });
});
