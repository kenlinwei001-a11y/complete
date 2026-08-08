import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import type { RouteObject } from "react-router-dom";
import { loginAs, renderApp } from "./utils";
import { ADMIN_PAGES, groupAdminPages, ADMIN_NAV_GROUPS } from "@/pages/adminRegistry";
import { NAV_GROUPS } from "@/pages/ShellLayout";
import { routes } from "@/App";
import { ACCOUNTS, workspaceForAccount } from "@/mocks/fixtures";
import { db } from "@/mocks/db";

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

/**
 * WO-NAV-GATE · 业务视图归组守卫（本体 §8 `G-NAV-FALLBACK-BUCKET`）
 *
 * 上面那道「结构守卫」写于 WO-SWEEP-03，防的是**管理页**漏配落「其它」。它有牙，
 * 但**只覆盖 `ADMIN_PAGES`** —— 业务视图不在射程里。于是同一个病换半边身子又犯了一次：
 * 沙盘四子视图（chain-line-map / transit-flow / physical-topology / node-inspector）
 * 后端 `BUILTIN_VIEWS` 已派单、renderer 已注册、组件也写了，**只差没人归组** →
 * 全部落进那个叫「其它」的折叠兜底桶，而该组实测**不多不少正好只有它们四个**。
 * 门存在、门有牙、咬的是另一半。
 *
 * 本组两条断言把射程补到业务视图这一半：
 *   ① 结构守卫 —— 逐账号跑真 mock 的 `workspaceForAccount`（= MSW handler 的同一条数据路径），
 *      `group !== "admin"` 的每条 navigation 都必须在 `NAV_GROUPS` 有归属，失败打印具体 key。
 *   ② 真实渲染 —— 「其它」组里不得出现任何 `/v/` 链接（管理页 leftover 由上面那道门管，本条只咬业务视图）。
 *
 * ⚠ 这两条能有牙的前提是 **mock 反映后端真实下发的视图集**：mock 若没有那四个视图，
 *    断言恒真（哑门）。mock ⊇ 后端 `BUILTIN_VIEWS(seed:true)` 由 `scripts/check-nav-group-coverage.mjs`
 *    机械守（前端不能跨 app import 源码 R1，故那半必须是门脚本，不能是本文件）。
 */
describe("WO-NAV-GATE · 业务视图归组守卫（不得落「其它」兜底桶）", () => {
  const navViewKeys = new Set(
    NAV_GROUPS.flatMap((g) => g.items.filter((it) => it.kind === "view").map((it) => it.key)),
  );

  it("结构守卫：workspace.navigation 里 group !== \"admin\" 的每一条都必须在 NAV_GROUPS 有归属", () => {
    // 逐账号（planner / base_manager / padmin）取真 mock 下发——不同角色导航集不同，
    // 只测一个账号会漏掉「只对某角色可见的视图没归组」这一形态。
    const offenders: string[] = [];
    for (const account of ACCOUNTS) {
      const ws = workspaceForAccount(account, db.tenantOverrides, db.configVersion);
      for (const item of ws.navigation as { key: string; viewKey?: string; group?: string }[]) {
        if (item.group === "admin") continue;
        const key = item.viewKey ?? item.key;
        if (!navViewKeys.has(key)) offenders.push(`${account.username}:${key}`);
      }
    }
    expect(
      offenders,
      `以下业务视图没有 NAV_GROUPS 归属 → 真实导航里落进「其它」折叠兜底桶（可达但用户找不到）：` +
        `[${offenders.join(", ")}]。修法：加进 ShellLayout.NAV_GROUPS 对应业务分组的 items，不是改 leftover 机制。`,
    ).toEqual([]);
  });

  it("mock 已反映后端下发的沙盘四子视图，且归在「推演」组（不是「其它」）", async () => {
    loginAs("planner"); // mock 里 planner 持 admin 角色（无独立 admin 账号）
    renderApp("/v/dash");
    const nav = await screen.findByTestId("nav-business");
    const sim = within(nav).getByTestId("nav-group-推演");
    for (const label of ["全链线路图", "在途与在制", "物理拓扑", "节点检视"]) {
      expect(within(sim).getByText(label)).toBeInTheDocument();
    }
  });

  it("真实渲染：admin 登录 → 「其它」兜底组不得包含任何 /v/ 业务视图链接", async () => {
    loginAs("planner");
    renderApp("/v/dash");
    const nav = await screen.findByTestId("nav-business");
    const other = within(nav).queryByTestId("nav-group-其它");
    // 组不存在 = 一项都没漏（最好的结果）；存在则里面只许有 /admin/ 项。
    const strays = other
      ? Array.from(other.querySelectorAll("a"))
          .map((a) => `${a.getAttribute("href")}（${a.textContent?.trim()}）`)
          .filter((h) => h.startsWith("/v/"))
      : [];
    expect(
      strays,
      `「其它」兜底组里出现了业务视图链接：[${strays.join(", ")}] —— ` +
        `这些视图后端派了单、前端渲染得出来，但归组归进了一个默认折叠的兜底桶，用户找不到（可达 ≠ 可发现）。`,
    ).toEqual([]);
  });
});

/**
 * WO-ROUTE-NAV-COVERAGE · **专用 route 可发现性 SEAM**（本体 §8 `G-NAV-FALLBACK-BUCKET` 第五层）
 *
 * 上面那两组守卫（管理页 / 业务视图）都以「后端下发了什么」为真相源。而 `App.tsx` 的**专用静态 route**
 * （`{ path: "v/<静态段>" }`·静态段先于 `:viewKey` 匹配）**根本不经后端下发** —— 于是它们整体在
 * 两道守卫的射程之外，实测 5/7 条零导航提及（`decision-play` 更隐蔽：写成 `kind:"view"` 后
 * `viewByKey.get()` 恒查不中 → `if (!it) return null` **静默消失**，表里写着、屏幕上永远没有）。
 *
 * 本组把射程补到第五层。**断言锚在真相源（`routes` 路由表）而不是 `NAV_GROUPS`** —— 这是关键：
 * 若锚在 `NAV_GROUPS` 上遍历，那么"把某条目摘掉"会让循环少跑一轮、断言空过（假绿）；
 * 锚在路由表上，摘掉条目 = 少一条链接 = **当场红**。
 *
 * 与门脚本 `scripts/check-nav-group-coverage.mjs` 判据④⑤⑥ 互补而非重复：
 *   · 门是**静态**的（正则读源码），跨 app 对账后端 `BUILTIN_VIEWS`，CI 每次交付都跑；
 *   · 本组是**效果层**的（真渲染 ShellLayout，看 DOM 里到底有没有那条 `<a>`），
 *     它咬得住门看不见的东西：条目在表里但渲染分支把它吃掉了（幽灵条目的确切死法）。
 */
describe("WO-ROUTE-NAV-COVERAGE · 专用 route 必须在侧栏真出现（可达 ≠ 可发现）", () => {
  /** 从真路由表派生专用静态 route（不手抄一份清单：手抄的清单和被测对象漂移了没人知道）。 */
  const dedicatedRouteKeys = ((): string[] => {
    const shell = routes.find((r) => r.path === "/");
    const children: RouteObject[] = shell?.children ?? [];
    return children
      .map((c) => c.path ?? "")
      .filter((p) => p.startsWith("v/"))
      .map((p) => p.slice(2))
      .filter((seg) => !seg.startsWith(":"));
  })();

  /** 门自身的金丝雀：路由表解析不出东西时，下面所有断言都会空过 —— 先证工具是对的（铁律 0.5 §5）。 */
  it("金丝雀：从真路由表解析得出专用 route，且含已知存在的 sim-sandbox", () => {
    expect(
      dedicatedRouteKeys,
      "从 routes 解析不出任何专用静态 route —— 这不是代码干净了，是本测试的解析器坏了（路由表写法变了就同步改这里）",
    ).not.toHaveLength(0);
    expect(dedicatedRouteKeys).toContain("sim-sandbox");
  });

  it("结构守卫：专用 route 不得挂成 kind:\"view\"（那是幽灵条目的确切形态）", () => {
    const viewKeys = new Set(
      NAV_GROUPS.flatMap((g) => g.items.filter((it) => it.kind === "view").map((it) => it.key)),
    );
    const ghosts = dedicatedRouteKeys.filter((k) => viewKeys.has(k));
    expect(
      ghosts,
      `以下专用 route 在 NAV_GROUPS 里挂成了 kind:"view"：[${ghosts.join(", ")}]。` +
        `这些 key 不经后端下发（不进 workspace.navigation）⇒ UnifiedNav 里 viewByKey.get(key) 恒查不中 ⇒ ` +
        `\`if (!it) return null\` ⇒ 条目永远不渲染，且不报错不留痕。修法：改成 { kind: "route", key, label }。`,
    ).toEqual([]);
  });

  it("效果层：默认账号登录 → 每条专用 route 在侧栏都有一条真链接（DOM 里点得到）", async () => {
    loginAs("planner");
    renderApp("/v/dash");
    const nav = await screen.findByTestId("left-nav");
    const hrefs = new Set(Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href")));
    const missing = dedicatedRouteKeys.filter((k) => !hrefs.has(`/v/${k}`));
    expect(
      missing,
      `以下专用 route 页在侧栏里找不到入口：[${missing.join(", ")}] —— ` +
        `页面写了、路由通了、点不到，只有知道 URL 的人（= 写它的那个 dev）进得去。` +
        `修法：加 { kind: "route", key: "…", label: "…" } 到 ShellLayout.NAV_GROUPS 对应分组。`,
    ).toEqual([]);
  });

  it("暗发语义未被「无条件渲染」冲掉：sim.sandbox 关 → 沙盘两个入口消失，其余专用 route 照在", async () => {
    db.tenantOverrides["sim.sandbox"] = false;
    loginAs("planner");
    renderApp("/v/dash");
    const nav = await screen.findByTestId("left-nav");
    const hrefs = new Set(Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href")));
    // R3「功能关闭 = 不存在」：暗发页的入口必须消失（不泄露功能存在性），进去也是 404（App.tsx 的 Guard）。
    expect(hrefs.has("/v/sim-sandbox"), "sim.sandbox 关着，沙盘入口仍出现在侧栏 —— 暗发语义被破坏（R3）").toBe(false);
    expect(hrefs.has("/v/sim-init"), "sim.sandbox 关着，初始化向导入口仍出现在侧栏 —— 暗发语义被破坏（R3）").toBe(false);
    // 而没有页面侧 Guard 的路由页本就人人可进，无可泄露 ⇒ 不受 entitlement 影响。
    const gateless = dedicatedRouteKeys.filter((k) => k !== "sim-sandbox" && k !== "sim-init");
    const missing = gateless.filter((k) => !hrefs.has(`/v/${k}`));
    expect(missing, `无 Guard 的专用 route 入口不该随 sim.sandbox 消失：[${missing.join(", ")}]`).toEqual([]);
  });
});
