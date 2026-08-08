import { describe, expect, it, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { getRenderer } from "@/views/registry";
import { NAV_GROUPS } from "@/pages/ShellLayout";
import { ACCOUNTS, workspaceForAccount } from "@/mocks/fixtures";
import { db } from "@/mocks/db";
import { loginAs, renderApp } from "./utils";

/**
 * WO-IMPEDIMENTS-REACHABLE · **咬链路，不咬组件**
 *
 * ## 这个文件补的是什么
 *
 * `chain-impediments` 此前有两条测试（`chain-impediment.seam.test.tsx` 39 例 +
 * `chain-impediment-mockwire.test.tsx`），**全绿**，而页面**一次都打不开**。
 * 原因是那两条都从 `getRenderer("chain-impediments")` 直接取组件再渲染 ——
 * 它们证明的是「拿到 renderer 之后能画出来」，**不证明「有任何东西能让你拿到 renderer」**。
 * 真实链路上，到达 renderer 只有两条路：
 *   ① `/v/:viewKey` → `ViewPage` → `workspace.features` 有 `view.<key>`（否则 404）
 *      ∧ `workspace.views` 有该条目（否则 403）→ `getRenderer(view.renderer)`；
 *   ② `App.tsx` 的专用静态 route 直挂组件。
 * 两条路当时**一条都没有**（后端 `BUILTIN_VIEWS` 无此 key、`App.tsx` 无专用 route）。
 *
 * 所以本文件的断言一律**从 URL 出发**（`renderApp("/v/chain-impediments")`），
 * 落点是「屏幕上真出现了这一页」与「侧栏真有一条点得到的链接」。
 * 摘掉后端派单那一行，本文件当场红；而上面那两条老测试照样全绿 —— 这正是它们的盲区。
 *
 * ## 与门脚本 `scripts/check-nav-group-coverage.mjs` 判据⑦ 的分工
 *
 * 门是**静态**的（正则读四份源码，跨 app 对账，CI 每次交付都跑），它答「有没有路径」；
 * 本文件是**效果层**的（真跑 MSW + 真渲染 ViewPage），它答「那条路径走过去到底出不出东西」。
 * 静态门看不见「路由通了但页面渲染分支把它吃掉」，效果层看不见「后端源码改了但 mock 没跟」。
 * 两边都要，缺一边就是本仓栽过的那两种哑门。
 */
describe("WO-IMPEDIMENTS-REACHABLE · /v/chain-impediments 真打得开（可达 ≠ 已注册）", () => {
  beforeEach(() => {
    loginAs("planner"); // mock 里 planner 持 admin 角色（无独立 admin 账号）
  });

  /**
   * 金丝雀：下面几条断言的前提是 mock 真的下发了这个视图。
   * mock 若没有它，`renderApp` 会落 403/404，而"没渲染出来"会被误读成"组件坏了"；
   * 更糟的是归组类断言会**恒真**（集合里根本没这一项）——本仓 `provenRed` 字段存在的理由。
   */
  it("金丝雀：mock workspace 真下发 chain-impediments（视图 + feature 双闸都开），且 renderer 注册在案", () => {
    const planner = ACCOUNTS.find((a) => a.username === "planner")!;
    const ws = workspaceForAccount(planner, db.tenantOverrides, db.configVersion);
    const view = ws.views.find((v) => v.key === "chain-impediments");
    expect(
      view,
      "mock allViews 里没有 chain-impediments —— 不是页面坏了，是本测试的前提没成立（后端 BUILTIN_VIEWS 与 mock fixtures 已漂移）",
    ).toBeDefined();
    // renderer 字段必须逐字对齐后端单一来源，否则 ViewPage 拿它去 getRenderer 会落「该视图类型暂不支持」兜底卡
    expect(view!.renderer).toBe("chain-impediments");
    expect(ws.features).toContain("view.chain-impediments");
    expect(getRenderer("chain-impediments"), "registry 里没有 chain-impediments").toBeDefined();
  });

  it("链路层：直接访问 /v/chain-impediments → ViewPage 双闸放行 → 真渲染出整页（三类分组 + 诚实位）", async () => {
    renderApp("/v/chain-impediments");
    // ci-root/ci-summary 只在真组件里出现；落 404/403/「暂不支持」兜底卡时一个都不会有。
    await screen.findByTestId("ci-summary");
    expect(screen.getByTestId("ci-root")).toBeInTheDocument();
    for (const kind of ["BOTTLENECK", "CONGESTION", "BREAK"] as const) {
      expect(screen.getByTestId(`ci-group-${kind}`)).toBeInTheDocument();
    }
    // 诚实位随链路一起到位（不是"页面出来了"就算数：PARTIAL 不许被画成实测）
    expect(screen.getByTestId("ci-honesty-counts")).toBeInTheDocument();
  });

  it("可发现性：侧栏「推演」组里有一条 /v/chain-impediments 链接，且没落进「其它」兜底桶", async () => {
    renderApp("/v/dash");
    const nav = await screen.findByTestId("nav-business");
    const sim = within(nav).getByTestId("nav-group-推演");
    const link = within(sim).getByText("全链阻滞点");
    expect(link.closest("a")?.getAttribute("href")).toBe("/v/chain-impediments");
    // 反向：「其它」组（若存在）不得含它 —— 可达但折叠在兜底桶里 = 用户找不到（同族病第四层）
    const other = within(nav).queryByTestId("nav-group-其它");
    if (other) expect(within(other).queryByText("全链阻滞点")).toBeNull();
  });

  it("结构守卫：NAV_GROUPS 里它挂的是 kind:\"view\"（本视图**经后端下发**，挂成 route 会变成一条绕过下发的死链）", () => {
    const items = NAV_GROUPS.flatMap((g) => g.items);
    const hit = items.filter((it) => it.key === "chain-impediments");
    expect(hit, "chain-impediments 在 NAV_GROUPS 里一条都没有").toHaveLength(1);
    expect(hit[0]!.kind).toBe("view");
  });

  /**
   * 本条是「为什么走 BUILTIN_VIEWS 而不是专用 route」的**承重断言**。
   *
   * 它是沙盘家族第五个成员，必须与沙盘同生共死（`requires: ["sim.sandbox"]` 级联）。
   * 专用 route 那条路给不了这个：route 条目能按 feature 隐藏入口，但页面侧没有 Guard，
   * 手敲 URL 照样进得去 —— 那就违反 R3「功能关闭 = 不存在」。
   * 所以这条断言不只是"顺手多测一个开关"，它是选型理由本身：改成专用 route 会让它红。
   */
  it("R3 级联：sim.sandbox 关 → 入口消失**且**页面 404（与沙盘同生共死，不留孤儿态）", async () => {
    db.tenantOverrides["sim.sandbox"] = false;
    const planner = ACCOUNTS.find((a) => a.username === "planner")!;
    const ws = workspaceForAccount(planner, db.tenantOverrides, db.configVersion);
    expect(ws.features, "父功能关了，view.chain-impediments 仍在 → 级联没生效").not.toContain(
      "view.chain-impediments",
    );

    renderApp("/v/chain-impediments");
    const nav = await screen.findByTestId("nav-business");
    const hrefs = new Set(Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href")));
    expect(hrefs.has("/v/chain-impediments"), "sim.sandbox 关着，阻滞点入口仍在侧栏 —— 泄露了功能存在性（R3）").toBe(
      false,
    );
    // 页面侧：feature 先于权限 → 404（不是 403，不泄露"这个功能存在但你没权限"）
    expect(screen.queryByTestId("ci-root"), "sim.sandbox 关着，页面仍渲染得出来 —— 孤儿态（R3）").toBeNull();
  });
});
