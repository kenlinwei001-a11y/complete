import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { NAV_GROUPS, CONSOLIDATED_INTO_SANDBOX, isViewConsolidatedAway, isRouteRefHidden } from "@/pages/ShellLayout";
import { db } from "@/mocks/db";
import { ACCOUNTS, workspaceForAccount } from "@/mocks/fixtures";
import { loginAs, renderApp } from "./utils";
import type { Workspace } from "@/api/types";

/**
 * WO-HOME-CONSOLIDATE-PARITY · **首页与侧栏跑同一条收编过滤**的接缝。
 *
 * ══ 它咬的是什么 ═══════════════════════════════════════════════════════════════
 * 不是「`isViewConsolidatedAway` 这个函数对不对」（那样咬的是**函数**不是**链路**，
 * 本仓假绿第 9 形态：实现有、测试有、且全绿，而生产零调用方）。
 * 咬的是**两个面渲染出来的集合之间的关系** —— 断言落在真渲染的 DOM 上，
 * 且 §3 那条是**现算**的：对任意 feature 组合都成立，不写死任何键。
 * 写死 4 个键的话，下次谁往 `CONSOLIDATED_INTO_SANDBOX` 里加第 12 条，这里照样绿，病原地复发。
 *
 * ══ ⚠ 量法的坑：侧栏集合**不许按可见性过滤** ════════════════════════════════════
 * 上一张单的 e2e 探针（`test/e2e/set-diff-probe.mjs`）用 `getBoundingClientRect` 滤了不可见元素，
 * 于是「图谱体系」这个 `collapsed: true` 的组里 **8 个 `graph-*` 链接被算成「侧栏没有」**
 * —— 它们其实在 DOM 里，只是父容器 `display:none`（`NavGroup` 折叠态那一行）。
 * 那份 JSON 因此报「首页独有 19 项」，读起来像 19 处 IA 不一致，**实际只有 11 处**。
 * 形态（铁律 0.6 句式）：
 *   **「我用『侧栏可见项』当作『侧栏有这一项』的证据，而前者并不度量后者。」**
 * 故本文件一律用 `querySelectorAll` 取**规则层**结果（渲染规则决定要不要出这条链接），
 * 折叠与否是另一件事，不许混进来。
 */

/** 侧栏**规则层**可见集：不按 CSS 可见性过滤（折叠组的链接在 DOM 里，见文件头注）。 */
function navViewKeys(container: HTMLElement): string[] {
  const nav = container.querySelector('[data-testid="left-nav"]');
  if (!nav) throw new Error("侧栏根节点没找到：量法坏了，不是断言失败");
  return [
    ...new Set(
      Array.from(nav.querySelectorAll('a[href^="/v/"]')).map((a) => (a.getAttribute("href") ?? "").slice(3)),
    ),
  ];
}

/** 首页铺出来的入口集（route 项与 view 项共用 `home-view-` 前缀，见 HomePage 那段注）。 */
function homeViewKeys(container: HTMLElement): string[] {
  return [
    ...new Set(
      Array.from(container.querySelectorAll('[data-testid^="home-view-"]')).map((e) =>
        (e.getAttribute("data-testid") ?? "").replace(/^home-view-/, ""),
      ),
    ),
  ];
}

/**
 * 当前 workspace —— 走 mock handler **同一个**构造函数（`handlers.ts` 的
 * `workspaceForAccount(account, db.tenantOverrides, db.configVersion)`），
 * 故它随 `db.tenantOverrides` 的开关而变，与屏上渲染读的是同一份真相。
 * ⛔ 不许在测试里另手搓一个 `{ features: [...] }`：那是第二份真相源，
 *   override 改了它不跟着变 ⇒ 反向对照会在一个假的开关态上「全过」。
 */
function currentWorkspace(): Workspace {
  const account = ACCOUNTS.find((a) => a.username === "planner");
  if (!account) throw new Error("mock 账号表里没有 planner：量法坏了，不是断言失败");
  return workspaceForAccount(account, db.tenantOverrides, db.configVersion) as unknown as Workspace;
}

/**
 * 「首页不许显示任何**此刻**被收编掉的入口」—— 按 kind **分派到各自的规则**。
 *
 * ⚠ 这个分派不是形式主义，本单实测栽在这上面一次（红了才发现）：
 * `what-if` / `optimize-whatif` / `cleanroom-attr` / `disruption-radius` 四个键**同时**出现在两处 ——
 * 它们是 `NAV_GROUPS` 里的 `kind:"route"` 项（显隐规则 = `isRouteRefHidden`），
 * 同时又在 `CONSOLIDATED_INTO_SANDBOX` 里登记着（`via: "static-route"`）。
 * 若无脑对所有首页键跑 `isViewConsolidatedAway`，沙盘**关**着时这四个会被判成
 * 「本该收编却出现在首页」而报红 —— 而正确行为恰恰是**此时必须出现**（沙盘关 ⇒ 回退单列，
 * 否则页面从 IA 里蒸发）。
 * 形态（铁律 0.6 句式）：
 *   **「我用『这个键在 `CONSOLIDATED_INTO_SANDBOX` 里』当作『它此刻该被首页藏掉』的证据，
 *     而前者并不度量后者 —— 那张表对 route 项只是登记『它在沙盘里也到得了』，
 *     真正管显隐的是 `consolidatedWhen` 此刻开没开。」**
 * 生产不会犯这个错（`isViewConsolidatedAway` 只喂 `workspace.navigation` 的键，
 * 而 static-route 的键根本不在那份下发里），但**断言混了就会冤枉正确的代码**。
 */
function assertNoConsolidatedEntriesOnHome(home: string[], ws: Workspace): void {
  const routeRefs = NAV_GROUPS.flatMap((g) => g.items).filter(
    (it): it is Extract<(typeof NAV_GROUPS)[number]["items"][number], { kind: "route" }> => it.kind === "route",
  );
  const routeKeys = new Set(routeRefs.map((r) => r.key));

  // route 侧：该藏的一个都不许在首页
  const leakedRoutes = routeRefs.filter((r) => isRouteRefHidden(r, ws) && home.includes(r.key)).map((r) => r.key);
  expect(leakedRoutes, "首页在单列已被收编/暗发关闭的 route 入口").toEqual([]);

  // view 侧：后端下发项走 view 规则（route 键已排除，避免上面那个 kind 混用陷阱）
  const leakedViews = home.filter((k) => !routeKeys.has(k) && isViewConsolidatedAway(k, ws));
  expect(leakedViews, "首页仍在单列已被收编的下发视图 ⇒ 本单的病没修掉").toEqual([]);
}

beforeEach(() => {
  loginAs("planner");
});
afterEach(() => {
  cleanup();
  delete db.tenantOverrides["sim.sandbox"];
  delete db.tenantOverrides["process.runtime"];
});

describe("WO-HOME-CONSOLIDATE-PARITY · 首页与侧栏同源收编", () => {
  /**
   * §3 · **本单要害**：两面一致性，现算，不写死键。
   * 两条关系一起断言，缺一条都能被绕过：
   *  ① 首页 ⊇ 侧栏 —— 侧栏有的首页必须有（上一张单修的方向，防回归）；
   *  ② 首页 ∩ 已收编 = ∅ —— 首页不许显示任何此刻被收编掉的项（本单修的方向）。
   * 只有 ① 会被「首页把所有项都铺出来」骗过；只有 ② 会被「首页什么都不铺」骗过。
   */
  it("§3 两面一致性（sim.sandbox 开）：首页 ⊇ 侧栏，且首页不含任何被收编的项", async () => {
    const { container } = renderApp("/");
    await screen.findByTestId("home-page");

    const home = homeViewKeys(container);
    const nav = navViewKeys(container);

    // 金丝雀：两边都必须有「经营驾驶舱」。不中 ⇒ 报「量法坏了」，下面的结论一律作废。
    expect(home, "金丝雀：首页量不到 dash ⇒ 量法坏了").toContain("dash");
    expect(nav, "金丝雀：侧栏量不到 dash ⇒ 量法坏了").toContain("dash");
    // 金丝雀：两个集合都不许是空的（空集合会让下面两条关系断言恒真）。
    expect(home.length).toBeGreaterThan(0);
    expect(nav.length).toBeGreaterThan(0);

    // ① 首页 ⊇ 侧栏
    const inNavNotHome = nav.filter((k) => !home.includes(k));
    expect(inNavNotHome, "侧栏有、首页没有 ⇒ 上一张单的方向回归了").toEqual([]);

    // ② 首页不含任何**此刻**被收编掉的项（现算，判据来自与侧栏同一批函数）
    assertNoConsolidatedEntriesOnHome(home, currentWorkspace());
  });

  /**
   * §1 · sim.sandbox **开** ⇒ 那批条件收编项两面同时消失。
   * 主体集合**现算**：`NAV_GROUPS` 里带 `consolidatedWhen: "sim.sandbox"` 的 `kind:"view"` 项。
   */
  it("§1 沙盘开：被收编的项在首页与侧栏**同时**不出现", async () => {
    const { container } = renderApp("/");
    await screen.findByTestId("home-page");

    const consolidatedKeys = NAV_GROUPS.flatMap((g) => g.items)
      .filter((it) => it.kind === "view" && it.consolidatedWhen === "sim.sandbox")
      .map((it) => it.key);
    // 金丝雀：这批不许为空 —— 空的话下面的 for 一次都不跑然后「全过」。
    expect(consolidatedKeys.length, "金丝雀：条件收编集为空 ⇒ 量法坏了").toBeGreaterThan(0);

    const home = homeViewKeys(container);
    const nav = navViewKeys(container);
    expect(home, "金丝雀 dash").toContain("dash");

    for (const k of consolidatedKeys) {
      expect(home, `${k} 沙盘开着仍在首页单列`).not.toContain(k);
      expect(nav, `${k} 沙盘开着仍在侧栏单列`).not.toContain(k);
    }

    // 无条件收编那一半（`CONSOLIDATED_INTO_SANDBOX` 里、且没带 consolidatedWhen）同样两面都不许有。
    // ⚠ 这一半正是「只修 consolidatedWhen 就收工」会漏掉的 5 项 —— 漏了还看不出来（屏上像修好了）。
    const unconditional = Object.keys(CONSOLIDATED_INTO_SANDBOX).filter((k) => !consolidatedKeys.includes(k));
    expect(unconditional.length, "金丝雀：无条件收编集为空 ⇒ 量法坏了").toBeGreaterThan(0);
    for (const k of unconditional) {
      expect(home, `${k} 属无条件收编，首页不该单列`).not.toContain(k);
    }
  });

  /**
   * §2 · **反向对照**：sim.sandbox **关** ⇒ 收编是条件性的，条目必须回来。
   * 这一条挡的是「把收编做成无条件删除」—— 那样沙盘关着的租户会「沙盘没有 + 入口也没有」，
   * 页面从 IA 里蒸发，比重复入口严重得多。
   *
   * ⚠ 主体只能取**沙盘关着时仍下发**的那些键：`sim-console` 等四页在 fixtures 里挂着
   * `requires: ["sim.sandbox"]`（复刻生产的级联语义）⇒ 沙盘一关它们连 `workspace.navigation`
   * 都不在，本就不该出现在任何一面。拿它们当反向对照的主体会得出「修坏了」的错误结论。
   */
  it("§2 反向对照 · 沙盘关：条件收编的项在首页与侧栏**同时**回来", async () => {
    db.tenantOverrides["sim.sandbox"] = false;
    db.tenantOverrides["process.runtime"] = true; // 暗发页开通，否则它本就不该在
    const { container } = renderApp("/");
    await screen.findByTestId("home-page");

    const home = homeViewKeys(container);
    const nav = navViewKeys(container);
    expect(home, "金丝雀 dash").toContain("dash");
    // 金丝雀：override 真生效了 —— 沙盘入口本身此刻不该在侧栏（它的 feature 关了）。
    expect(nav, "沙盘关着而沙盘入口仍在 ⇒ override 没生效，本条是空转").not.toContain("sim-sandbox");

    const ws = currentWorkspace();
    // 现算：此刻**仍被下发**、且带条件收编的键 —— 沙盘关着，它们必须两面都在。
    const delivered = ws.navigation.filter((n) => n.group !== "admin").map((n) => n.viewKey ?? n.key);
    const conditionalKeys = NAV_GROUPS.flatMap((g) => g.items)
      .filter((it) => it.kind === "view" && it.consolidatedWhen === "sim.sandbox")
      .map((it) => it.key)
      .filter((k) => delivered.includes(k));

    // 金丝雀：这批不许为空 —— 空了这条反向对照就什么都没验。
    expect(conditionalKeys.length, "金丝雀：沙盘关着却没有任何条件收编项被下发 ⇒ 本条是空转").toBeGreaterThan(0);

    for (const k of conditionalKeys) {
      expect(home, `${k} 沙盘关着，首页必须回退为单列（否则页面从 IA 蒸发）`).toContain(k);
      expect(nav, `${k} 沙盘关着，侧栏必须回退为单列`).toContain(k);
    }

    // 两面一致性在**反向**同样成立（§3 的关系不许只在一种开关态下为真）
    expect(nav.filter((k) => !home.includes(k)), "沙盘关着时侧栏有、首页没有").toEqual([]);
    assertNoConsolidatedEntriesOnHome(home, ws);
  });

  /**
   * §4 · **零丢失**：上一张单刚补进首页的 route 入口一个都不许被这次过滤误伤。
   * 现算「无条件显示的 route 项」，不写死 3 个键。
   */
  it("§4 零丢失：NAV_GROUPS 里无条件显示的 route 项，首页全在", async () => {
    const { container } = renderApp("/");
    await screen.findByTestId("home-page");

    const alwaysVisibleRoutes = NAV_GROUPS.flatMap((g) => g.items)
      .filter((it): it is Extract<(typeof NAV_GROUPS)[number]["items"][number], { kind: "route" }> => it.kind === "route")
      .filter((it) => !it.feature && !it.consolidatedWhen);

    expect(alwaysVisibleRoutes.length, "金丝雀：无条件 route 集为空 ⇒ 量法坏了").toBeGreaterThan(0);
    // 主流程起点必须在这批里（它正是上一张单实测中首页缺掉的那一个）
    expect(alwaysVisibleRoutes.map((r) => r.key)).toContain("sim-unified");

    const home = homeViewKeys(container);
    for (const r of alwaysVisibleRoutes) {
      expect(home, `route 入口 ${r.key} 被本次过滤误伤`).toContain(r.key);
    }
  });
});
