import { describe, expect, it, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { getRenderer } from "@/views/registry";
import { NAV_GROUPS, CONSOLIDATED_INTO_SANDBOX } from "@/pages/ShellLayout";
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
    // `WorkspaceInput.views` 契约上是可选的（缺省 = 该账号无任何视图）——这里显式兜底成空数组，
    // 让下面的 `toBeDefined()` 断言去报「mock 没下发 chain-impediments」这个**真正的**结论，
    // 而不是让测试自己先抛一个 undefined 的 TypeError 把结论盖掉。
    const view = (ws.views ?? []).find((v) => v.key === "chain-impediments");
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

  /**
   * WO-SANDBOX-IA-CONSOLIDATE：本条的**方向反过来了**，但守的还是同一件事 —— 可发现性。
   *
   * 原文断言「侧栏『推演』组里有一条 /v/chain-impediments 链接」。它现在已收编进沙盘
   * （主屏阻滞点统计条 + 逐条清单，逐条取证见 docs/AUDIT-sandbox-ia-consolidate.md），
   * 单列 = 重复入口，故断言改为「**不单列**」。
   *
   * ⚠ 但「不单列」绝不许滑成「找不到」。所以本条同时咬三件事，缺一即红：
   *   ① 侧栏没有它自己的链接（重复入口已消）；
   *   ② 侧栏**有沙盘的链接** —— 沙盘就是它现在的到达路径，沙盘入口没了它就真的找不到了；
   *   ③ 也**不在**「其它」兜底桶里（只删 NAV_GROUPS 登记而不滤 leftover 的典型死法：
   *      原地掉进兜底桶，比单列还糟。这一条是那种改法的确切探针）。
   */
  it("可发现性：侧栏不再单列它（已收编），但沙盘入口在 —— 且没落进「其它」兜底桶", async () => {
    renderApp("/v/dash");
    const nav = await screen.findByTestId("nav-business");
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
    // 金丝雀：侧栏确实渲染出了业务视图链接（一条都没有 ⇒ 下面 ①③ 恒真）
    expect(hrefs.filter((h) => h.startsWith("/v/")).length).toBeGreaterThan(3);
    // ② 到达路径本身必须在（沙盘入口没了，「收编进沙盘」就是空话）
    expect(hrefs, "沙盘入口不在侧栏 ⇒ chain-impediments 的到达路径不成立").toContain("/v/sim-sandbox");
    // ① 不单列
    expect(hrefs, "/v/chain-impediments 已收编进沙盘，却仍在侧栏单列 —— 重复入口").not.toContain("/v/chain-impediments");
    // ③ 也不在兜底桶（这一条抓的是"只删登记不滤 leftover"那种改法）
    const other = within(nav).queryByTestId("nav-group-其它");
    if (other) expect(within(other).queryByText("全链阻滞点")).toBeNull();
  });

  /**
   * 结构守卫：原文咬「NAV_GROUPS 里挂 kind:"view" 而不是 kind:"route"」——
   * 那条断言的**真正标的**从来不是"在不在导航里"，而是**它必须经后端下发到达**
   * （见下一条 R3 级联：走专用 route 的话页面侧没 Guard，手敲 URL 照样进得去 ⇒ 违反 R3）。
   * 收编之后它不在 NAV_GROUPS 了，那个标的转移到收编表的 `via` 字段上，故断言跟着搬家：
   * `via` 必须是 `"workspace.views"`。改成 `"static-route"` 会让本条与门判据⑧c 同时红。
   */
  it("结构守卫：不在 NAV_GROUPS；且收编表声明 via=\"workspace.views\"（经后端下发，不是绕过下发的专用 route）", () => {
    const items = NAV_GROUPS.flatMap((g) => g.items);
    expect(
      items.filter((it) => it.key === "chain-impediments"),
      "chain-impediments 已收编进沙盘，NAV_GROUPS 里不该再有它的条目",
    ).toHaveLength(0);
    const entry = CONSOLIDATED_INTO_SANDBOX["chain-impediments"];
    expect(entry, "chain-impediments 既不在 NAV_GROUPS 也不在收编表 —— 那就是**漏登记**（落兜底桶），不是收编").toBeTruthy();
    expect(
      entry!.via,
      "改成 static-route 会绕过后端下发 ⇒ requires: [sim.sandbox] 级联断掉 ⇒ 沙盘关了页面仍进得去（违反 R3）",
    ).toBe("workspace.views");
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
