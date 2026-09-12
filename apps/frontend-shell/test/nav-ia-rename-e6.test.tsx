import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * WO-IA-E2E5E6 · E6 接缝验收 —— 仓主拍板的三处改名（用户可见命名空间 = 视图标题 `title`）：
 *   · `project-sim`   项目推演     → **接单可行性**
 *   · `global-sim`    全局项目推演 → **接单组合优选**（「优选」非「最优」：求解器无最优性保证，强承诺不上屏）
 *   · `plan-generate` 方案生成     → **规划建议**（导航标题对齐 featureName/功能名册的三比一）
 * 顺带：ProjectSimView 那句定位注释「全局主计划框架内的细排」提上屏当副标题（回答「为什么有两个页」）。
 *
 * 为什么不测 featureName：功能名册（SHARED_FEATURE_NAMES）与 AgentCore 受检副本互锁，
 * 改它须动 apps/agentcore（本单范围外）——那两半的残留登记在交单报告，不在屏上断言。
 */
describe("WO-IA-E2E5E6 · E6：三处改名上屏 + 旧名从导航消失", () => {
  it("导航显示新名（接单可行性/接单组合优选/规划建议），三个旧名一个都不在", async () => {
    loginAs("planner");
    renderApp("/v/dash");
    const nav = await screen.findByTestId("left-nav");
    // 金丝雀：导航真的渲染了（没渲出来时下面的"没有旧名"全是空过）。
    expect(nav.querySelector('a[href="/v/dash"]')).not.toBeNull();
    // 新名在（数据来自 mock allViews 的 title —— 与后端 view-manifest 同一份改）。
    for (const name of ["接单可行性", "接单组合优选", "规划建议"]) {
      expect(within(nav as HTMLElement).queryByText(name), `导航里找不到新名「${name}」`).not.toBeNull();
    }
    // 旧名不在（「项目推演」是「全局项目推演」的子串，分开咬才咬得住两个）。
    const text = nav.textContent ?? "";
    for (const old of ["全局项目推演", "项目推演", "方案生成"]) {
      expect(text, `导航里仍出现旧名「${old}」`).not.toContain(old);
    }
  });

  it("页标题同步：global-sim h2 = 接单组合优选；project-sim h3 = 接单可行性 + 副标题「全局主计划框架内的细排」", async () => {
    loginAs("planner");
    const { router } = renderApp("/v/global-sim");
    const h2 = await screen.findByRole("heading", { level: 2 });
    expect(h2.textContent).toContain("接单组合优选");
    expect(h2.textContent).not.toContain("全局项目推演");

    await router.navigate("/v/project-sim");
    const h3 = await screen.findByRole("heading", { level: 3 });
    expect(h3.textContent).toBe("接单可行性");
    // 副标题上屏：那句此前只活在注释里的定位（本页 = 全局主计划框架内的细排）。
    const sub = await screen.findByTestId("proj-sub");
    expect(sub.textContent).toContain("全局主计划框架内的细排");
  });
});
