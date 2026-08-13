import { describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TIGHTNESS_METRIC } from "@platform/contracts";
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

    // WO-ORDER-ROW-DETAIL ②：写入 selectedObjects 的链**原样保留**，但入口从"整行点击的隐形副作用"
    // 挪到行尾显式按钮（整行点击现在归**展开详情**用）。此处顺带把断言加严——
    // 原断言只咬 store，屏上有没有反馈一概不管，正是"点了没反应"能一路绿着交付的原因。
    expect(screen.queryByTestId("oc-ctx-badge-SO-10006")).not.toBeInTheDocument(); // 前提：先证明徽章本来不在
    await user.click(screen.getByTestId("oc-ctx-btn-SO-10006"));
    expect(useSessionStore.getState().selectedObjects).toEqual([
      expect.objectContaining({ objectType: "Order", objectId: "ord-SO-10006", label: "SO-10006" }),
    ]);
    expect(screen.getByTestId("oc-ctx-badge-SO-10006")).toBeInTheDocument(); // 且这件事屏上看得见

    // 聚合口径脚注原样保留
    expect(screen.getByTestId("oc-caliber")).toHaveTextContent("[T−7, T+14]");
    expect(screen.getByTestId("oc-caliber")).toHaveTextContent("延误取最大");
  });

  it("经营数据看板 econTable（PRD-IND-order-aggregate §4.5-A）：按应用细分聚合 + 合计行 + 基地/细分切换", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/order-chain");

    // 默认按应用细分：储能/商用车细分行 + 合计行（营收/毛利率派生自 qty×SEG 价/利）
    const econ = await screen.findByTestId("oc-econ-table");
    expect(within(econ).getByTestId("oc-econ-row-储能")).toBeInTheDocument();
    const total = within(econ).getByTestId("oc-econ-total");
    expect(total).toHaveTextContent("合计");
    expect(total).toHaveTextContent("%"); // 综合毛利率行

    // 切「按风险基地」→ 重新按基地聚合（常州组出现，细分组消失）
    await user.click(screen.getByTestId("oc-segmode-base"));
    await waitFor(() => expect(within(screen.getByTestId("oc-econ-table")).getByTestId("oc-econ-row-常州")).toBeInTheDocument());
    expect(within(screen.getByTestId("oc-econ-table")).queryByTestId("oc-econ-row-储能")).not.toBeInTheDocument();
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
    // WO-UNIT-MEANING：峰值是**张力 0–100 指数**，此前弹窗渲染成裸「峰值 91」（会被读成 91%）。
    // 卡面早已经 formatTightness 单源治好，本共用弹窗曾是同一指标的漏网消费点——退回裸数即红。
    const peak = within(pop).getByTestId("risk-popover-peak");
    expect(peak.textContent ?? "").toMatch(new RegExp(`^${TIGHTNESS_METRIC.label}\\d+/${TIGHTNESS_METRIC.scaleMax}$`));
    // 逐日色块 strip 也不再只有颜色：图例给出量纲 + 越线阈值（阈值同样带量纲）。
    const stripLegend = within(pop).getByTestId("risk-popover-strip-legend");
    expect(stripLegend.textContent ?? "").toContain(`${TIGHTNESS_METRIC.scaleMin}–${TIGHTNESS_METRIC.scaleMax}`);
    expect(stripLegend.textContent ?? "").toMatch(new RegExp(`越线阈值 ${TIGHTNESS_METRIC.label}\\d+/${TIGHTNESS_METRIC.scaleMax}`));
    // 逐日格同口径（D+n · 张力N/100）。
    // WO-HOVER-LAYER：判据从 `title` 属性改为 **`aria-label` 可访问名** —— 原生 `title` 触屏不出、
    // 读屏行为不定、延迟约 1 秒；`aria-label` 是可访问性树里的正式名字，读屏当场念得到。
    const cells = within(pop).getByTestId("risk-popover-strip").querySelectorAll("span");
    expect(cells[0]?.getAttribute("title"), "逐日格不得再退回原生 title tooltip").toBeNull();
    expect(cells[0]?.getAttribute("aria-label") ?? "").toMatch(new RegExp(`D\\+0 · ${TIGHTNESS_METRIC.label}\\d+/${TIGHTNESS_METRIC.scaleMax}`));
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
    expect(within(pop2).getByTestId("risk-popover-peak").textContent ?? "").toContain(TIGHTNESS_METRIC.label);
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
