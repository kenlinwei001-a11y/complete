import { describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { useSessionStore } from "@/store/sessionStore";

describe("F23 · 订单全链聚合（order-chain）", () => {
  it("基地筛选联动明细与财务汇总条；行点击写入 selectedObjects；风险点 chips ≤4+折叠", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/order-chain");

    // 全量：8 单 / 4 客户
    await waitFor(() => expect(screen.getByTestId("oc-sum-orders")).toHaveTextContent("8"));
    expect(screen.getByTestId("oc-sum-custs")).toHaveTextContent("5");
    // chips 折叠：SO-10004 关联 5 个风险点 → 显示 4 + "+1"
    expect(screen.getByTestId("oc-risk-more-SO-10004")).toHaveTextContent("+1");

    // 筛选常州 → 明细与汇总联动收窄
    await user.selectOptions(screen.getByTestId("oc-base-filter"), "常州");
    await waitFor(() => expect(screen.getByTestId("oc-sum-orders")).toHaveTextContent("3"));
    const table = screen.getByTestId("oc-detail-table");
    expect(within(table).getAllByTestId(/^oc-row-/)).toHaveLength(3);
    // 清除 chip
    expect(screen.getByTestId("oc-clear-filter")).toHaveTextContent("常州");
    await user.click(screen.getByTestId("oc-clear-filter"));
    await waitFor(() => expect(screen.getByTestId("oc-sum-orders")).toHaveTextContent("8"));

    // 行点击 → 订单写入 selectedObjects
    await user.click(screen.getByTestId("oc-row-SO-10006"));
    expect(useSessionStore.getState().selectedObjects).toEqual([
      expect.objectContaining({ objectType: "Order", objectId: "ord-SO-10006", label: "SO-10006" }),
    ]);

    // 聚合口径脚注原样保留
    expect(screen.getByTestId("oc-caliber")).toHaveTextContent("[T−7, T+14]");
    expect(screen.getByTestId("oc-caliber")).toHaveTextContent("延误取最大");
  });

  it("风险点 chip 悬停弹窗与 risk-board 共用 RiskPopover 组件（同一 data-testid=risk-popover 渲染）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/order-chain");

    // order-chain 侧：chip 悬停 → RiskPopover
    const chip = await screen.findByTestId("oc-risk-chip-SO-10001-常州");
    await user.hover(chip);
    const pop = await screen.findByTestId("risk-popover");
    expect(pop).toHaveTextContent("常州");
    expect(pop).toHaveTextContent("化成柜张力");
    expect(pop).toHaveTextContent("D+5");
    expect(within(pop).getByTestId("risk-popover-strip")).toBeInTheDocument();
    await user.unhover(chip);
    await waitFor(() => expect(screen.queryByTestId("risk-popover")).not.toBeInTheDocument());

    // risk-board 侧：同一共享组件（components/Risk/RiskPopover）渲染同一 testid 弹窗
    cleanup();
    loginAs("planner");
    renderApp("/v/risk");
    const badge = await screen.findByTestId("risk-factor-常州");
    await user.hover(badge);
    const pop2 = await screen.findByTestId("risk-popover");
    expect(pop2).toHaveTextContent("化成柜张力");
  });

  it("待解决问题 4 类卡 → 点开抽屉渲染 LayeredDag 四层（订单→判定→根因→对策）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/order-chain");

    const problems = await screen.findByTestId("oc-problems");
    for (const cat of ["DELIVERY", "MARGIN", "KIT", "CREDIT"]) {
      expect(within(problems).getByTestId(`oc-problem-${cat}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("oc-problem-DELIVERY")).toHaveTextContent("5 单受影响");

    await user.click(screen.getByTestId("oc-problem-DELIVERY"));
    const dag = await screen.findByTestId("problem-dag");
    expect(dag).toHaveAttribute("data-layers", "4");
    // 四层链节点（第一条链）
    expect(within(dag).getByTestId("problem-dag-node-0-order")).toBeInTheDocument();
    expect(within(dag).getByTestId("problem-dag-node-0-judgement")).toBeInTheDocument();
    expect(within(dag).getByTestId("problem-dag-node-0-rootCause")).toBeInTheDocument();
    expect(within(dag).getByTestId("problem-dag-node-0-remedy")).toBeInTheDocument();
  });
});
