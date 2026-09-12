import { describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F37 · 运营态出厂配置（lived-in，PRD-addendum-lived-in-state §4 前端落点 + Y8）：
 * 驾驶舱 12 个月趋势与准交率 / 风险视图历史处置案例（点击回放）
 * / 对话坞按场景预载历史问答（半透明 + 日期 + 信任级徽章 + 分隔线）/ 全局合成水印。
 */
describe("F37 · 运营态出厂配置（lived-in）", () => {
  // ⛔ 两条「运营复盘」用例于 2026-09-12 随该屏整屏删除一并删除（仓主指令）。
  //    删屏不删测试 = 测试去 render 一个已无 renderer 的路由，红得莫名其妙；
  //    本仓纪律是**同一批删净**，不留残件。该屏的历史证据链能力若日后重建，测试重写。
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

    // WO-UNIT-MEANING · 图表纵轴口径：改前所有 chart widget 的 y 轴都是纯裸刻度（38000 是套数？OEE%？代价分？）。
    // 现在每张图上方落一行可核验的口径 caption（jsdom 无 canvas，EChart 静默降级，故轴名同文案另落 DOM）。
    // 单源：优先 `DashboardWidgetDef.unit`（后端补 unit 当天自动生效），无 unit 时退到 WidgetQueryDef 的真口径。
    expect(screen.getByTestId("chart-axis-caption-trend-12m").textContent)
      .toBe("纵轴口径：历史回放 history/bundle.trend（量纲见 widget 标题·接口未回传 unit，故只标口径不臆造单位）");
    expect(screen.getByTestId("chart-axis-caption-demand-supply-gap").textContent)
      .toBe("纵轴口径：历史回放 history/bundle.deviation（量纲见 widget 标题·接口未回传 unit，故只标口径不臆造单位）");
    // timeseries 查询的图走"序列 · 粒度 · 聚合"口径（不是臆造的单位）
    expect(screen.getByTestId("chart-axis-caption-oee-trend").textContent)
      .toMatch(/^纵轴口径：序列 oee_daily · 按日均值/);
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
    // WO-UNIT-MEANING：末列此前只出裸数「3」，列名「受影响订单」看不出是批数还是套数 → 列头带单位。
    expect(within(table).getByText("受影响订单(批)")).toBeInTheDocument();
    const crisis = screen.getByTestId("risk-case-CASE-007");
    expect(crisis).toHaveTextContent("到货危机");
    expect(crisis).toHaveTextContent("提前备料");
    await user.click(crisis);
    // 回放弹窗：当时的时序曲线（query_timeseries_agg）+ 完整时间线 + 受影响订单
    const modal = await screen.findByTestId("case-replay-modal");
    expect(within(modal).getByTestId("case-replay-curve")).toBeInTheDocument();
    /*
     * WO-UNIT-MEANING · 历史回放纵轴曾完全裸奔（只有数值，看不出是套数还是 OEE%）。
     * 契约无单源可消费（QueryTimeseriesAggOutput.points 只有 {entityId,bucket,value}，无 unit；
     * RiskCaseSchema.curve 只给 seriesKey），故**不臆造单位**而标真口径：序列键 + 聚合 + 粒度 + 实体，
     * 并显式披露「接口未回传 unit」。退回无口径图即红。
     */
    const caption = within(modal).getByTestId("case-replay-axis-caption");
    expect(caption.textContent ?? "").toContain("纵轴：序列 output:line"); // 序列键来自 curve.seriesKey（真口径，非前端硬编）
    expect(caption.textContent ?? "").toContain("按日合计"); // 与请求 agg=sum / grain=day 同一常量拼出
    expect(caption.textContent ?? "").toContain("LINE-changzhou"); // 实体 = curve.entityId
    expect(caption.textContent ?? "").toContain("未回传 unit"); // 诚实披露：无单源，不假装有单位
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
    expect(within(history).getByText("2026-07 常州基地 4680-NCM 计划达成率怎么样？")).toBeInTheDocument();
    expect(within(history).getByText("2026-07-21")).toBeInTheDocument();
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
