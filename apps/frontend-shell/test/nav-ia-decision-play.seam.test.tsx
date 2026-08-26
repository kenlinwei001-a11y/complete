import { describe, expect, it } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { NAV_GROUPS, ROUTE_NO_NAV } from "@/pages/ShellLayout";

/**
 * WO-IA-E2E5E6 · E2 接缝验收 —— 仓主裁决：「导航栏里面的『决策推演』不应该在这个位置，
 * 而是嵌入到每个需要决策的点」。⇒ **删导航项，留 route**。
 *
 * 为什么两条断言必须钉在同一条测试里（单独立的两条会各自漏掉一半故事）：
 *   · 只断言「导航里没有」 → 有人会顺手把 route 也删了，深链契约（外部可见）当场死；
 *   · 只断言「深链可达」   → 导航条目留着也没人发现（它在屏上与「忘了删」长得一模一样）。
 * 深链契约 = `/v/decision-play?fromImpediment=…&imp*` 一族 query 键（`readImpedimentEntry`），
 * 消费方：沙盘阻滞点一跳（SandboxConsole）· 驾驶舱入口（DashboardView）· 既有书签。一个键都不许动。
 */
describe("WO-IA-E2E5E6 · E2：导航无「决策推演」条目 ⊕ /v/decision-play 深链契约不变", () => {
  it("结构层：NAV_GROUPS 任何分组都没有 decision-play 条目，且豁免登记在 ROUTE_NO_NAV（有理由）", () => {
    const entries = NAV_GROUPS.flatMap((g) => g.items).filter((it) => it.key === "decision-play");
    expect(
      entries,
      `NAV_GROUPS 里又出现了 decision-play 条目（${JSON.stringify(entries)}）—— ` +
        `仓主裁决是「嵌入各决策点，不占导航位」。要恢复导航入口属导航信息架构决策，不是顺手加一行。`,
    ).toEqual([]);
    // 反向：豁免必须登记且带理由 —— 没登记 = 「忘了登记」与「刻意不给」在屏上无法区分（门的判据④也咬这条）。
    expect(ROUTE_NO_NAV["decision-play"]?.length ?? 0).toBeGreaterThanOrEqual(10);
  });

  it("效果层双断言：侧栏没有「决策推演」链接，且 imp* 深链直达页面壳、query 逐键生效", async () => {
    loginAs("planner");
    const { router } = renderApp("/v/dash");

    // ── 断言①：导航里没有「决策推演」条目（效果层：DOM 里真的没有那条 <a>）──────────
    const nav = await screen.findByTestId("left-nav");
    // 金丝雀：先证导航真的渲染了（导航没渲出来的话，下面的"没有"是空过）。
    expect(nav.querySelector('a[href="/v/dash"]')).not.toBeNull();
    expect(
      nav.querySelector('a[href="/v/decision-play"]'),
      "侧栏里仍有指向 /v/decision-play 的链接 —— E2 裁决是删导航项（route 保留），这条 <a> 不该存在",
    ).toBeNull();
    expect(
      nav.textContent ?? "",
      "侧栏文案里仍出现「决策推演」—— 导航项没删干净（label 改了名也算没删）",
    ).not.toContain("决策推演");

    // ── 断言②：/v/decision-play 深链仍可达，既有 imp* query 键行为不变 ─────────────
    // 走真路由表（createAppRouter）导航，不是测试自己挂的 <Route> —— route 被删这里当场红。
    const qs =
      "fromImpediment=imp-e2-1&impKind=断点&impStage=生产&impRule=r-cap-1" +
      "&impLocusType=Order&impLocusId=SO-E2-1&impLocusLabel=E2深链验收单&impMode=LIVE&impJoin=NO_FACTOR_DIMENSION";
    await act(async () => {
      await router.navigate(`/v/decision-play?${qs}`);
    });
    // 页面壳真渲染（route 在 = 不落 :viewKey 兜底 404）。
    await screen.findByTestId("decision-play");
    // query 键逐键生效：入口横幅带出阻滞点 id / 落点 / 规则 / 阶段 —— 这就是「深链契约没动」的断言。
    const banner = await screen.findByTestId("dp-from-impediment");
    expect(banner.getAttribute("data-impediment-id")).toBe("imp-e2-1");
    expect(banner.getAttribute("data-mode")).toBe("LIVE");
    const locus = await screen.findByTestId("dp-from-locus");
    expect(locus.textContent).toBe("Order／SO-E2-1");
    await waitFor(() => expect(banner.textContent ?? "").toContain("E2深链验收单"));
    expect(banner.textContent ?? "").toContain("r-cap-1");
    expect(banner.textContent ?? "").toContain("生产");
  });
});
