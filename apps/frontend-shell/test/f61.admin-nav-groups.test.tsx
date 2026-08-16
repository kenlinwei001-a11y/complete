import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import type { RouteObject } from "react-router-dom";
import { loginAs, renderApp } from "./utils";
import { ADMIN_PAGES, groupAdminPages, ADMIN_NAV_GROUPS } from "@/pages/adminRegistry";
import { NAV_GROUPS, CONSOLIDATED_INTO_SANDBOX, ROUTE_NO_NAV } from "@/pages/ShellLayout";
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

  it("结构守卫：workspace.navigation 里 group !== \"admin\" 的每一条，要么在 NAV_GROUPS 有归属，要么已显式收编", () => {
    // 逐账号（planner / base_manager / padmin）取真 mock 下发——不同角色导航集不同，
    // 只测一个账号会漏掉「只对某角色可见的视图没归组」这一形态。
    //
    // WO-SANDBOX-IA-CONSOLIDATE：第三种合法状态 = **已收编**（`CONSOLIDATED_INTO_SANDBOX`）。
    // 「没归组」与「已收编」屏上都表现为"导航里没有"，但性质相反：前者是遗漏（落兜底桶），
    // 后者是声明（有表、有理由、有门对账）。本条放行后者，下一条专门咬"收编不许掉进兜底桶"。
    const offenders: string[] = [];
    for (const account of ACCOUNTS) {
      const ws = workspaceForAccount(account, db.tenantOverrides, db.configVersion);
      for (const item of ws.navigation as { key: string; viewKey?: string; group?: string }[]) {
        if (item.group === "admin") continue;
        const key = item.viewKey ?? item.key;
        if (!navViewKeys.has(key) && !CONSOLIDATED_INTO_SANDBOX[key]) offenders.push(`${account.username}:${key}`);
      }
    }
    expect(
      offenders,
      `以下业务视图没有 NAV_GROUPS 归属 → 真实导航里落进「其它」折叠兜底桶（可达但用户找不到）：` +
        `[${offenders.join(", ")}]。修法二选一：加进 ShellLayout.NAV_GROUPS 对应业务分组的 items；` +
        `或若已收编进某控制台，进 CONSOLIDATED_INTO_SANDBOX 并写明到达路径。都不是改 leftover 机制。`,
    ).toEqual([]);
  });

  /**
   * WO-SANDBOX-IA-CONSOLIDATE · 上一版这里断言「沙盘四子视图归在『推演』组」。
   * 那条断言现在**方向反过来**：它们已收编进沙盘控制台（画布模式 / 图层 / 常驻栏），
   * 不该再有平级入口 —— 逐条到达路径的实测取证见 `docs/AUDIT-sandbox-ia-consolidate.md`。
   *
   * ⚠ 但只把它们从 NAV_GROUPS 删掉是**不够**的：后端仍把这些键派进 `workspace.navigation`
   *   （必须仍派，否则 `/v/<key>` 深链接 404），于是 `UnifiedNav` 的 `leftover` 会照单全收，
   *   它们**原地掉进「其它」兜底桶** —— 那正是本组门要治的病，比单列还糟。
   *   故这条同时咬两件事：① 不在「推演」组；② 也不在「其它」组（在任何组里都不许出现）。
   */
  it("沙盘开（默认）：九个收编键在左导航里**一条都不出现**（既不在「推演」也不在「其它」）", async () => {
    loginAs("planner"); // mock 里 planner 持 admin 角色（无独立 admin 账号）
    renderApp("/v/dash");
    const nav = await screen.findByTestId("nav-business");
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
    // 金丝雀：导航里确实有 /v/ 链接（一条都没有的话，下面的 not.toContain 全是恒真的空转）
    expect(hrefs.filter((h) => h.startsWith("/v/")).length).toBeGreaterThan(3);
    // 已知必中：沙盘自己、以及保留的独立场景，必须还在
    for (const keep of ["/v/sim-sandbox", "/v/project-sim", "/v/risk"]) expect(hrefs).toContain(keep);
    // 九个收编键：一条都不许在
    for (const key of Object.keys(CONSOLIDATED_INTO_SANDBOX)) {
      expect(hrefs, `/v/${key} 已收编进沙盘，却仍在左导航里 —— 重复入口`).not.toContain(`/v/${key}`);
    }
  });

  /**
   * 收编的**反向那半**：沙盘 entitlement 关掉之后，被收编的四个专用 route 页必须**回到导航里**。
   *
   * 这条防的是一种很容易做出来的回归：IA 整理时把条目一删了事 ——
   * 沙盘开的租户看起来一切正常（东西在沙盘里），沙盘**关**的租户则是
   * 「沙盘没有 + 导航也没有」= 四个页从 IA 里蒸发，只剩手敲 URL 可达。
   * 五个 `via:"workspace.views"` 的子视图不在本条射程：它们的 entitlement 本就 `requires: ["sim.sandbox"]`，
   * 沙盘关 ⇒ 它们连下发都没有、`/v/<key>` 本来就 404 —— 没有可回退的东西（这是事实，不是豁免）。
   */
  it("沙盘关：四个 static-route 收编页**回到**导航里（收编 ≠ 删除）", async () => {
    db.tenantOverrides["sim.sandbox"] = false;
    try {
      loginAs("planner");
      renderApp("/v/dash");
      const nav = await screen.findByTestId("nav-business");
      const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
      // R3 暗发：沙盘自己必须消失（这同时也是本条的金丝雀 —— 它若还在，说明 override 没生效，下面全是空转）
      expect(hrefs, "sim.sandbox 关着，沙盘入口仍在 —— override 没生效，本条断言全是空转").not.toContain("/v/sim-sandbox");
      const fallbackKeys = Object.entries(CONSOLIDATED_INTO_SANDBOX)
        .filter(([, v]) => v.via === "static-route")
        .map(([k]) => k);
      expect(fallbackKeys.length, "static-route 收编项为空 ⇒ 本条恒真").toBeGreaterThan(0);
      for (const key of fallbackKeys) {
        expect(hrefs, `沙盘关着，/v/${key} 却也不在导航里 —— 这一页从 IA 里蒸发了（收编做成了删除）`).toContain(`/v/${key}`);
      }
    } finally {
      delete db.tenantOverrides["sim.sandbox"];
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

  /**
   * WO-SANDBOX-IA-CONSOLIDATE：本条从「每条专用 route 都要在侧栏有链接」改成
   * 「每条专用 route 都要**有一条到达路径**」—— 因为现在合法的到达路径有两种，不是一种：
   *   · 侧栏单列（`kind:"route"` 条目照常渲染）；
   *   · 或被某控制台收编（`CONSOLIDATED_INTO_SANDBOX`）且**那个控制台此刻在侧栏里** ——
   *     用户点得进控制台，就点得到里面的模式。
   * 只咬第一种会把「已收编」误报成「找不到入口」（那是把 IA 整理判成回归）；
   * 而完全不咬则会把「条目删了、控制台也没有」放过去（那才是真回归，由下一条咬）。
   */
  it("效果层：默认账号登录 → 每条专用 route 都有到达路径（侧栏单列，或经在侧栏的沙盘收编）", async () => {
    loginAs("planner");
    renderApp("/v/dash");
    const nav = await screen.findByTestId("left-nav");
    const hrefs = new Set(Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href")));
    // 金丝雀：沙盘入口本身必须在侧栏 —— 它不在的话，"经沙盘收编"这条到达路径根本不成立。
    expect(hrefs.has("/v/sim-sandbox"), "沙盘入口不在侧栏 ⇒ 收编项的到达路径不成立，本条的放行是假的").toBe(true);
    const missing = dedicatedRouteKeys.filter((k) => !hrefs.has(`/v/${k}`) && !CONSOLIDATED_INTO_SANDBOX[k] && !(k in ROUTE_NO_NAV));
    expect(
      missing,
      `以下专用 route 页既不在侧栏单列、也没被任何控制台收编、也未登记 ROUTE_NO_NAV 豁免：[${missing.join(", ")}] —— ` +
        `页面写了、路由通了、点不到，只有知道 URL 的人（= 写它的那个 dev）进得去。` +
        `修法：加 { kind: "route", key: "…", label: "…" } 到 ShellLayout.NAV_GROUPS 对应分组；` +
        `若确属仓主裁决「刻意不给导航入口」（如 decision-play），登记 ShellLayout.ROUTE_NO_NAV 并写理由（门与本测试都对账这张表）。`,
    ).toEqual([]);
  });

  it("暗发语义未被「无条件渲染」冲掉：sim.sandbox 关 → 沙盘入口消失，其余专用 route 照在（含收编项回退）", async () => {
    db.tenantOverrides["sim.sandbox"] = false;
    try {
      loginAs("planner");
      renderApp("/v/dash");
      const nav = await screen.findByTestId("left-nav");
      const hrefs = new Set(Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href")));
      // R3「功能关闭 = 不存在」：暗发页的入口必须消失（不泄露功能存在性），进去也是 404（App.tsx 的 Guard）。
      expect(hrefs.has("/v/sim-sandbox"), "sim.sandbox 关着，沙盘入口仍出现在侧栏 —— 暗发语义被破坏（R3）").toBe(false);
      expect(hrefs.has("/v/sim-init"), "sim.sandbox 关着，初始化向导入口仍出现在侧栏 —— 暗发语义被破坏（R3）").toBe(false);
      // 而没有页面侧 Guard 的路由页本就人人可进，无可泄露 ⇒ 不受 entitlement 影响。
      // ⚠ 收编项（consolidatedWhen: "sim.sandbox"）在这一档**必须回来**：沙盘不在了，收编也就不成立。
      // ⚠ ROUTE_NO_NAV 豁免项（decision-play）在这一档**不回来**：它不是被收编，是仓主裁决刻意不给导航入口。
      const gateless = dedicatedRouteKeys.filter((k) => k !== "sim-sandbox" && k !== "sim-init" && !(k in ROUTE_NO_NAV));
      const missing = gateless.filter((k) => !hrefs.has(`/v/${k}`));
      expect(missing, `无 Guard 的专用 route 入口不该随 sim.sandbox 消失：[${missing.join(", ")}]`).toEqual([]);
    } finally {
      delete db.tenantOverrides["sim.sandbox"];
    }
  });
});
