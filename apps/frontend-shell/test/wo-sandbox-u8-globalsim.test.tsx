import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-U1-U8-SMALL · 判据 **U8「看明细不换页」**在 `global-sim` 的接缝测试。
 *
 * 病灶（改前）：三处下钻口（分配台账「细排 →」/ 被挤单卡 / 固定单卡）全是
 * `<Link to="/v/project-sim?order=…">` —— 想看一条单在本版方案里的细节，**被带走、现场清零**，
 * 正是判据点名的违反（「想看细节 ⇒ 被带走」；跳去**做别的事**才不算）。
 *
 * 改后：三处都开**同屏订单明细抽屉**（`GlobalSimOrderDrawer`），抽屉里的数全部取自
 * 屏上这份 portfolio 联合解（allocation/schedule/displaced/frozen）——与台账、排产表**同源勾稽**，
 * 零新取数、不可能同屏打架。跳页出口收进抽屉（去 project-sim 做单项目试算 = 「做别的事」）。
 *
 * 设计裁决「抽屉放该单、不放全量细排」的三条理由写在 `GlobalSimOrderDrawer.tsx` 头注。
 */
describe("判据 U8 · global-sim 订单明细抽屉（看明细不换页）", () => {
  it("U8-C1 · 台账行点「明细」→ 同屏抽屉出该单排产链，交付日与排产表**逐字相等**（同源勾稽）· 不跳页", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    const { router } = renderApp("/v/global-sim");
    await screen.findByTestId("global-sim-alloc", {}, { timeout: 20000 });

    // 排产表上 SO-10001 的交付日（同源参照物，先抓下来）。
    const schedDeliver = await screen.findByTestId("global-sim-sched-deliver-SO-10001");
    const deliverIso = schedDeliver.textContent!;

    // 改前这是 <a href=/v/project-sim…>；改后必须是按钮（不是链接 → 结构上不可能跳页）。
    const drill = screen.getByTestId("global-sim-alloc-drill-SO-10001");
    expect(drill.tagName).toBe("BUTTON");
    expect(drill).not.toHaveAttribute("href");

    await user.click(drill);

    const drawer = await screen.findByTestId("global-sim-order-drawer");
    expect(within(drawer).getByTestId("gs-drawer-verdict").textContent).toContain("已获排");
    // 出处行：求解器名指名道姓（U5 同源要求·裸数字不算）。
    expect(within(drawer).getByTestId("gs-drawer-source").textContent).toContain("portfolio");
    // 同源勾稽：抽屉的交付日 = 排产表同行的交付日，逐字相等（各自写死期望值证明不了同源）。
    expect(within(drawer).getByTestId("gs-drawer-deliver-SO-10001").textContent).toBe(`交付 ${deliverIso}`);
    // 两阶段排产链在抽屉里（电芯段→在途→Pack→交付）。
    expect(within(drawer).getByTestId("gs-drawer-schedule").textContent).toContain("在途");

    // 不跳页：路由没动，project-sim 页根本没挂载。
    expect(router.state.location.pathname).toBe("/v/global-sim");
    expect(screen.queryByTestId("project-sim-view")).toBeNull();

    // 「做别的事」的出口留在抽屉内（判据明示不算违反）。
    expect(within(drawer).getByTestId("gs-drawer-goto-project")).toHaveAttribute("href", "/v/project-sim?order=SO-10001");

    // 关闭即回现场。
    await user.click(within(drawer).getByTestId("gs-drawer-close"));
    expect(screen.queryByTestId("global-sim-order-drawer")).toBeNull();
  });

  it("U8-C2 · 被挤单卡点「未获排明细」→ 抽屉出未获排说明，量与被挤卡逐字相等 · 仍不跳页", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    const { router } = renderApp("/v/global-sim");
    // 默认演示数据里 SO-10010 被挤（乘用车产能不足 regime·MSW 真算）。
    const card = await screen.findByTestId("global-sim-displaced-SO-10010", {}, { timeout: 20000 });
    const qtyM = card.textContent!.match(/(\d[\d,]*)\s*套/);
    expect(qtyM, "被挤卡上应有「N 套」").toBeTruthy();

    await user.click(within(card).getByTestId("global-sim-drill-SO-10010"));

    const drawer = await screen.findByTestId("global-sim-order-drawer");
    expect(within(drawer).getByTestId("gs-drawer-verdict").textContent).toContain("未获排");
    const sec = within(drawer).getByTestId("gs-drawer-displaced");
    expect(sec.textContent).toContain("产能让给了更高优先级需求");
    // 抽屉里的量 = 被挤卡上的量（同源·非写死·卡面 fmt 千分位剥掉再比）。
    expect(sec.textContent).toContain(qtyM![1]!.replace(/,/g, ""));
    expect(router.state.location.pathname).toBe("/v/global-sim");
  });

  it("U8-C3 · 冻结一单 → 固定单卡点「预扣明细」→ 抽屉出预扣行（基地/窗/量与卡片一致）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim-order-SO-10003", {}, { timeout: 20000 });

    await user.click(screen.getByTestId("global-sim-freeze-SO-10003"));
    const card = await screen.findByTestId("global-sim-frozen-SO-10003", {}, { timeout: 20000 });

    await user.click(within(card).getByTestId("global-sim-drill-SO-10003"));

    const drawer = await screen.findByTestId("global-sim-order-drawer");
    expect(within(drawer).getByTestId("gs-drawer-verdict").textContent).toContain("固定单");
    const sec = within(drawer).getByTestId("gs-drawer-frozen");
    expect(sec.textContent).toContain("产能预扣");
    // 卡片上的窗口号与量，抽屉里逐字同现（同源勾稽）。
    const m = card.textContent!.match(/窗口(\d+)/);
    expect(m, "固定单卡上应有窗口号").toBeTruthy();
    expect(sec.textContent).toContain(`窗口${m![1]}`);
  });
});
