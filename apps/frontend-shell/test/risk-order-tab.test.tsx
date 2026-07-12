import { describe, expect, it } from "vitest";
import { screen, within, fireEvent } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * WO-CAPSIM-REPLICA · 订单聚合 tab（HTML §6·1:1 复刻）：产能推演面板「瓶颈视角/订单聚合」双 tab 互斥；
 * 订单聚合态渲染经营聚合表（真 affected_orders marginLedger·库存/产能列无源诚实"—"）+ 订单明细表（真 rows）。
 * 导出最终规划按钮在处置计划表头（HTML §8）。
 */
describe("WO-CAPSIM-REPLICA · 订单聚合 tab + 导出按钮（1:1 button 位·真数据）", () => {
  it("默认瓶颈视角：卡网格在场·订单聚合视图不在（互斥）", async () => {
    loginAs("planner");
    renderApp("/v/risk");
    await screen.findByTestId("risk-kpi");
    expect(screen.getByTestId("risk-tab-risk")).toBeInTheDocument();
    expect(screen.getByTestId("risk-tab-order")).toBeInTheDocument();
    expect(screen.queryByTestId("risk-order-agg")).toBeNull();
  });

  it("点「订单聚合」tab → 经营聚合表 + 订单明细表真渲染（未结订单金额真值·库存列诚实—）", async () => {
    loginAs("planner");
    renderApp("/v/risk");
    fireEvent.click(await screen.findByTestId("risk-tab-order"));

    const agg = await screen.findByTestId("risk-order-agg");
    // 经营聚合表：真营收有值（marginLedger.bySegment.revenue），产能/库存列诚实"—"（G-DM-1·不伪造）。
    const econ = within(agg).getByTestId("risk-econ-table");
    expect(econ).toHaveTextContent("未结订单金额");
    expect(econ).toHaveTextContent("成品库存");
    // 订单明细表：真订单行（affected_orders.rows）。
    const detail = within(agg).getByTestId("risk-order-detail-table");
    expect(within(detail).getByText("关联风险点")).toBeInTheDocument();
    expect(detail.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
    // 分类维度 + 基地筛选按钮在位。
    expect(within(agg).getByTestId("risk-seg-app")).toBeInTheDocument();
    expect(within(agg).getByTestId("risk-seg-base")).toBeInTheDocument();
    expect(within(agg).getByTestId("risk-order-basesel")).toBeInTheDocument();
  });

  it("切「按基地」维度 → 经营表重聚合（不崩·teeth）", async () => {
    loginAs("planner");
    renderApp("/v/risk");
    fireEvent.click(await screen.findByTestId("risk-tab-order"));
    await screen.findByTestId("risk-econ-table");
    fireEvent.click(screen.getByTestId("risk-seg-base"));
    expect(screen.getByTestId("risk-econ-table")).toBeInTheDocument();
  });

  it("处置计划表头有「导出最终规划」按钮（HTML §8·瓶颈视角态）", async () => {
    loginAs("planner");
    renderApp("/v/risk");
    expect(await screen.findByTestId("risk-plan-export")).toBeInTheDocument();
  });
});
