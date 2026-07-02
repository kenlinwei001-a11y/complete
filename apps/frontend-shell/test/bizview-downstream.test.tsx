import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-BIZVIEW-DOWNSTREAM（业务视图下游导航 + 权威值接线·G-VIS-1）：
 * ① 台账对象展开 → 下游导航去死路（就此订单开 what-if / 看订单全链 / 起 Action 草案）。
 * ② 订单全链综合毛利率接权威 out.marginLedger（reconciled✓·非前端旁路自算）· econ 表 gmRate 诚实标估算口径。
 * ③ geo 点基地「在图谱查看」→ 图谱聚焦（focus=n-Base·大小写不敏感·mock 对齐真后端键，见 f24/f7）。
 */
describe("WO-BIZVIEW-DOWNSTREAM · 下游导航 + 权威值接线", () => {
  it("① 台账订单行展开 → 下游导航按钮出（what-if/订单全链/Action 草案）+ 点订单全链 → location 变", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    const { router } = renderApp("/v/order");
    await screen.findByTestId("ledger");
    // 展开首行
    const firstRow = (await screen.findAllByTestId(/^ledger-row-/))[0]!;
    await user.click(firstRow);
    const rowId = firstRow.getAttribute("data-testid")!.replace("ledger-row-", "");
    // 下游导航去死路：三按钮齐
    await screen.findByTestId(`ledger-actions-${rowId}`);
    expect(screen.getByTestId(`ledger-whatif-${rowId}`)).toBeTruthy();
    expect(screen.getByTestId(`ledger-orderchain-${rowId}`)).toBeTruthy();
    expect(screen.getByTestId(`ledger-action-${rowId}`)).toBeTruthy();
    // 点「看订单全链」→ location 变（非死路）
    await user.click(screen.getByTestId(`ledger-orderchain-${rowId}`));
    await waitFor(() => expect(router.state.location.pathname).toBe("/v/order-chain"));
    expect(router.state.location.search).toContain("focus=");
  });

  it("② 订单全链综合毛利率接权威 marginLedger（reconciled ✓）+ econ 表 gmRate 标估算口径（不混淆）", async () => {
    loginAs("planner");
    renderApp("/v/order-chain");
    await screen.findByTestId("order-chain-view");
    // 权威 marginLedger 面板出（与驾驶舱同一 affected_orders·reconciled 徽章）
    const ml = await screen.findByTestId("oc-margin-ledger");
    expect(ml).toBeTruthy();
    // 综合毛利率来自 marginLedger（Σ贡献=综合毛利率·闭合）——reconciled ✓
    await waitFor(() => expect(screen.getByTestId("oc-margin-ledger-reconciled")).toHaveTextContent("已闭合"));
    // econ 表自算 gmRate 诚实标「估算」口径，不冒充权威综合毛利率
    expect(within(screen.getByTestId("oc-econ-gmrate")).getByText("估算")).toBeTruthy();
  });
});
