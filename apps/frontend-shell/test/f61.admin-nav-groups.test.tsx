import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { ADMIN_PAGES, groupAdminPages, ADMIN_NAV_GROUPS } from "@/pages/adminRegistry";

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

  it("WO-11.5：推演历史（query-history）不再是孤儿页——注册进 ADMIN_PAGES 且落「编排与场景」组（导航可达）", () => {
    expect(ADMIN_PAGES.some((p) => p.path === "query-history")).toBe(true);
    const orchestration = ADMIN_NAV_GROUPS.find((g) => g.key === "orchestration")!;
    expect(orchestration.paths).toContain("query-history");
    // 经分组后真出现在「编排与场景」组（不落「其它」兜底）
    const groups = groupAdminPages(ADMIN_PAGES);
    const orch = groups.find((g) => g.title === "编排与场景")!;
    expect(orch.pages.some((p) => p.path === "query-history")).toBe(true);
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
});
