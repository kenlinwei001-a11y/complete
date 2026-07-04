import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { fmtQty } from "@/views/plan/OrderChainView";

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

  // UI-POLISH（P90 裸浮点）：求解器真值可为长浮点（87.34999）→ 展示应格式化为 1 位小数 87.3（review 亲点例）。
  //   fmtQty 即 OrderChainView 交期产能判 P90/需求的展示格式化函数（line 618 已接线），此处逐值断言其行为。
  it("fmtQty：裸浮点定 1 位小数、整数不带尾零（87.34999→87.3 · 1.1615→1.2 · 1260→1,260）", () => {
    expect(fmtQty(87.34999)).toBe("87.3"); // review 亲点：87.3 而非 87.34999
    expect(fmtQty(1.1615)).toBe("1.2"); // review 抓包：order-chain P90 1.1615 裸浮点
    expect(fmtQty(1260)).toBe("1,260"); // 整数不显 .0
    expect(fmtQty(800)).toBe("800");
    expect(fmtQty(Number.NaN)).toBe("—"); // 非有限值诚实占位
  });
});
