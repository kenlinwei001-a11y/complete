import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F15（增量 §7.10-4 / 验收表）：plan-audit 展开 X02 时序推演 →
 * PropagationTimeline 渲染四节点传导链（事件窗→约束越线→波及订单→财务击穿），
 * 订单节点可点开订单弹窗。组件与 §7.11 问题卡共用（全局唯一实现）。
 */
describe("F15 · 规划体检 · 时序推演传导链", () => {
  it("展开 X02 →「⏱ 时序推演」→ 四节点传导链 + 受影响订单可点开弹窗", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/plan-audit");

    // 基线自动体检 → X02 产销缺口（**硬卡**，缺口 2.07 万套/月）
    // WO-MOCK-SCALE-TRUTH：这里原写 `med`（软风险·缺口 0.8）—— 那是**年口径假基线**的产物：
    // 旧 mock 的 dem 375.0 / sup 374.2 都是年数塞进月字段，两个大数相减恰好只差 0.8，
    // 落在 (gapSoft 0.3, gapHard 2] 里 ⇒ 看着像"软风险"。量级修对后
    // dem 27.92 − sup 25.8523 = 2.0677 > gapHard 2 ⇒ X02 是**硬卡**，
    // 与真后端 `plan_audit` 实测一致（H=[X02]·verdict「站不住」·score 43）。
    // 即「档位变了」不是回归，正是本单要治的那个谎被拆穿后的**正确**读数。
    const x02 = await screen.findByTestId("audit-item-hard-X02");
    expect(x02).toHaveTextContent("产销缺口");

    // 折叠开关「⏱ 时序推演（不解决会怎样）」→ 调 risk_timeline 渲染 PropagationTimeline
    await user.click(within(x02).getByTestId("tl-toggle-hard-X02"));
    await screen.findByTestId("audit-risk-timeline-X02");
    const ptl = await screen.findByTestId("ptl-X02");

    // 四节点横向 stepper：事件窗 → 约束越线 → 波及订单 → 财务击穿（按严重度着色 data-sev）
    const event = within(ptl).getByTestId("ptl-X02-node-event");
    const cross = within(ptl).getByTestId("ptl-X02-node-cross");
    const orders = within(ptl).getByTestId("ptl-X02-node-orders");
    const finance = within(ptl).getByTestId("ptl-X02-node-finance");
    expect(event).toHaveTextContent("事件窗");
    expect(event).toHaveTextContent("检修窗 D+4");
    expect(cross).toHaveTextContent("约束越线");
    expect(cross).toHaveTextContent("D+5"); // 常州·化成柜张力 crossDay=5
    expect(cross).toHaveAttribute("data-sev", "2");
    expect(orders).toHaveTextContent("波及订单");
    expect(orders).toHaveTextContent("2 单在越线窗口内");
    expect(finance).toHaveTextContent("财务击穿");

    // 受影响订单行可点开订单弹窗（risk_timeline → affected_orders 同源）
    await user.click(within(orders).getByTestId("ptl-X02-order-SO-10001"));
    const modal = await screen.findByTestId("ptl-X02-order-modal");
    expect(modal).toHaveTextContent("蔚途汽车");
    expect(modal).toHaveTextContent("4680-NCM");
    expect(modal).toHaveTextContent("3 天");
  });
});
