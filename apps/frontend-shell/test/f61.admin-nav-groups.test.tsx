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

  it("渲染（N1 统一域分组 · WO-NAV-DATA）：admin 登录 → 统一导航出现业务域分组头（数据/建模与图谱）含连接器叶项", async () => {
    loginAs("planner"); // planner 含 admin 角色 → 见全部管理页
    renderApp("/admin/connections");
    const nav = await screen.findByTestId("nav-business"); // N1：业务+管理合一套域分组
    // 分组头（NavGroup）出现：WO-NAV-DATA 把「数据接入」组改名为「数据」。
    expect(within(nav).getByTestId("nav-group-数据")).toBeInTheDocument();
    expect(within(nav).getByTestId("nav-group-建模与图谱")).toBeInTheDocument();
    // 叶项在组内
    expect(within(nav).getByText("连接器与上传")).toBeInTheDocument();
  });

  // WO-SWEEP-03-NAV-GROUP：ShellLayout 的 NAV_GROUPS 是真实渲染用的分组源（≠ adminRegistry.groupAdminPages）。
  // 此前二者漂移——6 个管理页（knowledge/schema-reconcile/decisions/audit-log/boundary/prototype-intake）
  // 未登记进 NAV_GROUPS → 真实导航里落「其它」兜底组。以下守卫防复发。
  it("结构守卫：NAV_GROUPS 的 admin 键覆盖全部 ADMIN_PAGES（无管理页漏配 → 不落「其它」）", () => {
    const navAdminKeys = new Set(
      NAV_GROUPS.flatMap((g) => g.items.filter((it) => it.kind === "admin").map((it) => it.key)),
    );
    const missing = ADMIN_PAGES.map((p) => p.path).filter((path) => !navAdminKeys.has(path));
    expect(missing).toEqual([]);
  });

  it("6 页归组与 adminRegistry.ADMIN_NAV_GROUPS 对齐（data/modeling/ops/governance）", () => {
    // 期望归属：adminRegistry 的域组 → ShellLayout 的组标题。
    const expectByGroupTitle: Record<string, string[]> = {
      "数据": ["knowledge"],
      "建模与图谱": ["schema-reconcile", "boundary", "prototype-intake"],
      "运营与审批": ["decisions"],
      "平台与系统": ["audit-log"],
    };
    for (const [title, paths] of Object.entries(expectByGroupTitle)) {
      const group = NAV_GROUPS.find((g) => g.title === title)!;
      const keys = group.items.filter((it) => it.kind === "admin").map((it) => it.key);
      for (const p of paths) expect(keys).toContain(p);
    }
  });

  it("真实渲染：admin 登录 → 6 页出现在各自域组内、且不落「其它」兜底组", async () => {
    loginAs("planner"); // 含 admin 角色 → 见全部管理页
    renderApp("/admin/connections");
    const nav = await screen.findByTestId("nav-business");
    // 6 页 label → 期望所在组的 testid
    const cases: [string, string][] = [
      ["知识库", "nav-group-数据"],
      ["字段对账", "nav-group-建模与图谱"],
      ["边界册治理", "nav-group-建模与图谱"],
      ["原型接入", "nav-group-建模与图谱"],
      ["决策记录", "nav-group-运营与审批"],
      ["审计日志", "nav-group-平台与系统"],
    ];
    for (const [label, groupTestId] of cases) {
      const group = within(nav).getByTestId(groupTestId);
      expect(within(group).getByText(label)).toBeInTheDocument();
    }
    // 不再有「其它」兜底组包含这 6 页（若组存在也不得含它们）。
    const other = within(nav).queryByTestId("nav-group-其它");
    if (other) {
      for (const [label] of cases) expect(within(other).queryByText(label)).toBeNull();
    }
  });
});
