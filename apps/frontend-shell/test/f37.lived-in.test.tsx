import { describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F37 · 运营态出厂配置（lived-in，PRD-addendum-lived-in-state §4 前端落点 + Y8）：
 * 运营回顾证据链页面 / 驾驶舱 12 个月趋势与准交率 / 风险视图历史处置案例（点击回放）
 * / 对话坞按场景预载历史问答（半透明 + 日期 + 信任级徽章 + 分隔线）/ 全局合成水印。
 */
describe("F37 · 运营态出厂配置（lived-in）", () => {
  it("运营回顾：MAPE 回弹标注 + 校准被拒原因 + S&OP V1–V12 爬坡 + 规则演进 + 孵化记录", async () => {
    loginAs("planner");
    renderApp("/v/review");

    await screen.findByTestId("review-view");
    // MAPE 收敛曲线 + 危机回弹点标注（W21 +1.8pct）
    expect(screen.getByTestId("mape-curve")).toBeInTheDocument();
    expect(screen.getByTestId("mape-event-w21")).toHaveTextContent("到货危机");
    expect(screen.getByTestId("mape-event-w21")).toHaveTextContent("+1.8pct");
    // 校准史：8 次提案、2 次被拒带方法学原因（漂移闸门 / 回测门槛）
    const calTable = screen.getByTestId("calibration-history-table");
    expect(within(calTable).getAllByText("REJECTED")).toHaveLength(2);
    expect(screen.getByTestId("cal-rejected-cal_lh_demo_4")).toHaveTextContent("结构性漂移闸门");
    expect(screen.getByTestId("cal-rejected-cal_lh_demo_6")).toHaveTextContent("回测门槛");
    expect(screen.getByTestId("cal-rejected-cal_lh_demo_6")).toHaveTextContent("不足 1pct");
    // S&OP 版本史：V1 88% → V12 94%
    expect(screen.getByTestId("sop-V1")).toHaveTextContent("88%");
    expect(screen.getByTestId("sop-V12")).toHaveTextContent("94%");
    // 规则演进：C16 覆盖天数 3→5 挂「到货危机复盘」
    expect(screen.getByTestId("rule-C16-v2.0")).toHaveTextContent("到货危机复盘");
    expect(screen.getByTestId("rule-C08-v1.3")).toHaveTextContent("Order.outsourceRatio > 0.2");
    // 意图孵化 ×3：「由兜底问题《…》×N 次孵化于某月」
    expect(screen.getByTestId("incubated-incubated_formation_cap")).toHaveTextContent("由兜底问题《为什么常州的化成产能上不去》×17 次孵化于 2025-10");
    expect(within(screen.getByTestId("incubation-list")).getAllByText(/孵化于/)).toHaveLength(3);
  });

  it("运营回顾：Action 审计史分页（60 条 / 每页 20 → 3 页，翻页换数据）", async () => {
    const user = userEvent.setup();
    cleanup();
    loginAs("planner");
    renderApp("/v/review");

    await screen.findByTestId("action-audit-table");
    expect(screen.getByTestId("action-page-indicator")).toHaveTextContent("1/3");
    // 统计行（82%-ish 分布：50 EXECUTED / 6 REJECTED / 2 CANCELLED / 2 FAILED）
    expect(screen.getByText(/已执行 50/)).toBeInTheDocument();
    expect(screen.getByText(/驳回 6/)).toBeInTheDocument();
    // 被拒记录带像样的审批意见
    expect((await screen.findAllByText("外协贴近 C08 红线，改用夜班方案")).length).toBeGreaterThanOrEqual(1);
    const firstRow = within(screen.getByTestId("action-audit-table")).getAllByRole("row")[1]!;
    const firstId = firstRow.textContent;
    await user.click(screen.getByTestId("action-page-next"));
    await waitFor(() => expect(screen.getByTestId("action-page-indicator")).toHaveTextContent("2/3"));
    await waitFor(() => {
      const newFirst = within(screen.getByTestId("action-audit-table")).getAllByRole("row")[1]!;
      expect(newFirst.textContent).not.toBe(firstId);
    });
  });

  it("驾驶舱：12 个月产出趋势 widget + 准交率 KPI + 年度已执行工单 + 已交付台账", async () => {
    cleanup();
    loginAs("planner");
    renderApp("/v/dash");

    await screen.findByTestId("widget-trend-12m");
    // #5 富出处悬浮：widget ⓘ 升六要素溯源（悬浮即弹来源/推导/新鲜度）
    const u = userEvent.setup();
    await u.hover(screen.getByTestId("prov-v-widget-trend-12m"));
    const tip = await screen.findByTestId("prov-tip");
    expect(tip).toHaveTextContent("query_timeseries_agg");
    await u.unhover(screen.getByTestId("prov-v-widget-trend-12m"));
    // 准交率 = 可见范围重算（mock：12 单中 9 单按期 → 75%）
    const ontime = await screen.findByTestId("widget-ontime-rate");
    await waitFor(() => expect(ontime).toHaveTextContent("75"));
    const executed = screen.getByTestId("widget-executed-workorders");
    await waitFor(() => expect(executed).toHaveTextContent("50"));
    // 已交付台账（生命周期完整的 livedIn 订单）
    const ledger = screen.getByTestId("widget-delivered-ledger");
    await waitFor(() => expect(ledger).toHaveTextContent("SO-20001"));
    expect(ledger).toHaveTextContent("delayDays");
    // #5 三线偏差复合图 + 问题聚合摘要 widget 渲染
    expect(screen.getByTestId("widget-demand-supply-gap")).toBeInTheDocument();
    const summary = await screen.findByTestId("widget-problem-summary");
    await waitFor(() => expect(within(summary).getByTestId("widget-summary-problems")).toBeInTheDocument());
    expect(within(summary).getByTestId("summary-problem-DELIVERY")).toHaveTextContent("交期");
  });

  it("风险视图：历史处置案例区（越线→采纳→消解），点击案例回放当时的时序曲线", async () => {
    const user = userEvent.setup();
    cleanup();
    loginAs("planner");
    renderApp("/v/risk");

    const table = await screen.findByTestId("risk-cases-table");
    expect(within(table).getAllByRole("row").length).toBeGreaterThanOrEqual(4); // 表头 + 3 例
    const crisis = screen.getByTestId("risk-case-CASE-007");
    expect(crisis).toHaveTextContent("到货危机");
    expect(crisis).toHaveTextContent("提前备料");
    await user.click(crisis);
    // 回放弹窗：当时的时序曲线（query_timeseries_agg）+ 完整时间线 + 受影响订单
    const modal = await screen.findByTestId("case-replay-modal");
    expect(within(modal).getByTestId("case-replay-curve")).toBeInTheDocument();
    const timeline = within(modal).getByTestId("case-timeline");
    expect(timeline).toHaveTextContent("风险越线");
    expect(timeline).toHaveTextContent("采纳「提前备料」处置方案");
    expect(timeline).toHaveTextContent("曲线消解");
    expect(within(modal).getByTestId("case-affected-orders")).toHaveTextContent("SO-20025");
  });

  it("Y8 对话坞：按场景预载历史问答（日期 + 信任级徽章 + 「以上为历史问答」分隔线）", async () => {
    const user = userEvent.setup();
    cleanup();
    loginAs("planner");
    renderApp("/v/dash");

    await screen.findByTestId("query-dock-bar");
    await user.click(screen.getByRole("button", { name: "展开对话" }));
    const history = await screen.findByTestId("dock-history");
    // dash 场景 4 条（§1.2 每场景 2–6 条）
    expect(within(history).getByText("本月计划达成率怎么样？")).toBeInTheDocument();
    expect(within(history).getByText("2026-06-21")).toBeInTheDocument();
    // 信任级徽章正确（dash 历史 = VERIFIED_WORKFLOW）
    expect(screen.getByTestId("dock-history-trust-0")).toHaveAttribute("data-trust", "VERIFIED_WORKFLOW");
    expect(screen.getByTestId("dock-history-trust-0")).toHaveTextContent("已验证 · 工作流");
    // 分隔线
    expect(screen.getByTestId("dock-history-divider")).toHaveTextContent("以上为历史问答");
  });

  it("Y8 对话坞：自由探索（graph）历史问答为 AGENT 信任级样例", async () => {
    const user = userEvent.setup();
    cleanup();
    loginAs("planner");
    renderApp("/v/graph");

    await screen.findByTestId("query-dock-bar");
    await user.click(screen.getByRole("button", { name: "展开对话" }));
    await screen.findByTestId("dock-history");
    expect(screen.getByTestId("dock-history-trust-0")).toHaveAttribute("data-trust", "AGENT_EXPLORATORY");
    expect(screen.getByTestId("dock-history-trust-0")).toHaveTextContent("探索 · AI");
  });

  it("全局合成水印徽章：hover（title）显示 generatedFrom 与 seed", async () => {
    cleanup();
    loginAs("planner");
    renderApp("/v/dash");

    const wm = await screen.findByTestId("synthetic-watermark");
    expect(wm).toHaveTextContent("合成数据");
    expect(wm.getAttribute("title")).toContain("seed 42");
    expect(wm.getAttribute("title")).toContain("battery-manufacturing");
    expect(wm.getAttribute("title")).toContain("2025-07-01 ~ 2026-07-01");
  });

  it("行级权限作用于历史（mock 语义）：base_manager 仅常州案例/订单，准交率按可见范围重算", async () => {
    cleanup();
    loginAs("base_manager");
    renderApp("/v/risk");

    const table = await screen.findByTestId("risk-cases-table");
    expect(within(table).getByTestId("risk-case-CASE-007")).toBeInTheDocument();
    expect(within(table).queryByTestId("risk-case-CASE-003")).toBeNull();
    expect(within(table).queryByTestId("risk-case-CASE-009")).toBeNull();
  });
});
