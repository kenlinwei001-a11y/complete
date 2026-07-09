import { describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { useSessionStore } from "@/store/sessionStore";

describe("F23 · 订单聚合（order-chain·ORDER-CONSOLIDATE）", () => {
  it("行点击写入 selectedObjects + 展开该单推演行（C2）；风险点 chips ≤4+折叠；基地筛选器已迁产能推演（C1②不再重复）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/order-chain");

    // 全量：8 单 / 5 客户（基地维度迁产能推演后恒展示全量·不再随基地筛选收窄）
    await waitFor(() => expect(screen.getByTestId("oc-sum-orders")).toHaveTextContent("8"));
    expect(screen.getByTestId("oc-sum-custs")).toHaveTextContent("5");
    // chips 折叠：SO-10004 关联 5 个风险点 → 显示 4 + "+1"
    expect(screen.getByTestId("oc-risk-more-SO-10004")).toHaveTextContent("+1");

    // ORDER-CONSOLIDATE C1②：基地筛选器已迁「产能推演」——此页不再有基地筛选器（去两处重复）
    expect(screen.queryByTestId("oc-base-filter")).toBeNull();
    // 明细恒全量 8 行（无基地过滤）
    const table = screen.getByTestId("oc-detail-table");
    expect(within(table).getAllByTestId(/^oc-row-/)).toHaveLength(8);

    // 行点击 → 订单写入 selectedObjects
    await user.click(screen.getByTestId("oc-row-SO-10006"));
    expect(useSessionStore.getState().selectedObjects).toEqual([
      expect.objectContaining({ objectType: "Order", objectId: "ord-SO-10006", label: "SO-10006" }),
    ]);
    // ORDER-CONSOLIDATE C2：展开行出该单推演（order_fullchain 统一结论 + 三判·真值·复用既有 order 推演数据源）
    const sim = await screen.findByTestId("oc-sim-SO-10006");
    expect(within(sim).getByTestId("oc-sim-verdict-SO-10006")).toHaveTextContent("提价3%接");
    const simJudges = within(sim).getByTestId("oc-sim-judges-SO-10006");
    expect(simJudges).toHaveTextContent("C02"); // 交期判规则
    expect(simJudges).toHaveTextContent("C06"); // 齐套判规则
    // 再点收起
    await user.click(screen.getByTestId("oc-row-SO-10006"));
    await waitFor(() => expect(screen.queryByTestId("oc-sim-SO-10006")).toBeNull());

    // 聚合口径脚注原样保留
    expect(screen.getByTestId("oc-caliber")).toHaveTextContent("[T−7, T+14]");
    expect(screen.getByTestId("oc-caliber")).toHaveTextContent("延误取最大");
  });

  it("经营数据看板 econTable（PRD-IND-order-aggregate §4.5-A）：按应用细分聚合 + 合计行；按基地聚合已迁产能推演（C1②）", async () => {
    loginAs("planner");
    renderApp("/v/order-chain");

    // 按应用细分：储能/商用车细分行 + 合计行（营收/毛利率派生自 qty×SEG 价/利）
    const econ = await screen.findByTestId("oc-econ-table");
    expect(within(econ).getByTestId("oc-econ-row-储能")).toBeInTheDocument();
    const total = within(econ).getByTestId("oc-econ-total");
    expect(total).toHaveTextContent("合计");
    expect(total).toHaveTextContent("%"); // 综合毛利率行

    // ORDER-CONSOLIDATE C1②：按基地聚合切换 + 基地行已迁「产能推演」（基地态本属产能推演·去两处重复）
    expect(screen.queryByTestId("oc-segmode-base")).toBeNull();
    expect(within(econ).queryByTestId("oc-econ-row-常州")).toBeNull();
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
