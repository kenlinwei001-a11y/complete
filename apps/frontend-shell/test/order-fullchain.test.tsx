import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * ORD（order 视图 1:1 复刻）：订单全链推演面板（order_fullchain）——订单选择器 + 统一结论（三色）+
 * 三判明细 + 11 节点业务建模链 DAG + 采纳→Action。问题归并 4 类作超集保留在下方（f23 不破）。
 */
describe("ORD · 订单全链推演面板（order_fullchain）", () => {
  it("ofc 面板：统一结论 + 三判明细表 + 11 节点 DAG + 采纳按钮；问题归并超集仍在", async () => {
    loginAs("planner");
    renderApp("/v/order-chain");
    const panel = await screen.findByTestId("ofc-panel");
    // 统一结论（三色）——等求解器查询解析
    expect((await within(panel).findByTestId("ofc-verdict")).textContent).toContain("提价3%接");
    // 三判明细表（交期/齐套/财务三闸规则）
    const judges = within(panel).getByTestId("ofc-judges");
    expect(judges.textContent).toContain("C02");
    expect(judges.textContent).toContain("C06");
    expect(judges.textContent).toContain("C18");
    // 11 节点业务建模链 DAG
    expect(within(panel).getByTestId("ofc-dag")).toBeTruthy();
    // 采纳按钮
    expect(within(panel).getByTestId("ofc-adopt")).toBeTruthy();
    // 超集：问题归并 4 类仍在
    expect(screen.getByTestId("oc-problems")).toBeTruthy();
  });
});
