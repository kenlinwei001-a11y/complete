import { describe, expect, it } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * #9 经营指标 →「未达成指标根因下钻」联动（per-metric drill·达成/未达成皆可）+ #10 反事实按基地。
 *
 * 接缝（SEAM）：左「经营指标」(metric-strip) 与右「根因下钻」(rootcause) 本是两个独立 widget；
 * 本用例在**合成/集成态**（renderApp("/v/dash") 真渲整块驾驶舱）断言点行 → 右面板以该指标 metricKey
 * 真调 gap_attribution 下钻，跨两 widget 的共享选择态被驱动通（非只测各半 unit）。
 *   · 未达成（有缺口）→ 深度反向归因树（provenance-dag）。
 *   · 已达成（noGap·actual≥target·solver 返空 levels）→ **不空/不报错**：达成·无缺口正向框 +
 *     该指标结构根（GREEN KPI 根节点·诚实不编缺口子树·铁律0.4）。
 * #10 反事实双轨按选定基地真变（WO-C 已接·此处复验接缝不回归）。
 */
describe("#9 驾驶舱经营指标 → 根因下钻联动（per-metric）+ #10 反事实按基地", () => {
  it("(b) 右面板标题重命名为「规划决策推演 · 未达成指标根因下钻」", async () => {
    loginAs("planner");
    renderApp("/v/dash");
    const rc = await screen.findByTestId("widget-rootcause");
    expect(within(rc).getByText("规划决策推演 · 未达成指标根因下钻")).toBeInTheDocument();
  });

  it("(a) 点【已达成】指标（交付达成率·actual≥target）→ noGap 结构树可见（非空/非报错）+ 达成·无缺口正向框", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/dash");
    const strip = await screen.findByTestId("metric-strip");
    const achievedRow = await within(strip).findByTestId("metric-kpi-delivery");

    // 未选任何指标 → 右面板走回落（提示），不显达成框（证明下钻是交互触发·非常驻）。
    const rc = screen.getByTestId("widget-rootcause");
    expect(within(rc).queryByTestId("rootcause-achieved")).toBeNull();
    expect(within(rc).getByTestId("rootcause-hint")).toBeInTheDocument();

    // 点已达成指标 → 以 metricKey=delivery_attain 真调 gap_attribution → noGap。
    await user.click(achievedRow);

    // 达成·无缺口正向框可见（不空/不报错）。
    const achieved = await within(rc).findByTestId("rootcause-achieved");
    expect(achieved).toHaveTextContent("已达成");
    expect(achieved).toHaveTextContent("交付达成率");

    // 面板标 achieved=1 + metricKey 锚定该指标。
    const cockpit = within(rc).getByTestId("cockpit-rootcause");
    expect(cockpit.getAttribute("data-achieved")).toBe("1");
    expect(cockpit.getAttribute("data-metric")).toBe("delivery_attain");

    // 结构树**非空**：noGap 仍产 GREEN KPI 根节点（该指标结构根）→ provenance-dag 渲染出来。
    expect(within(rc).getByTestId("provenance-dag")).toBeInTheDocument();
    expect(within(rc).getByTestId("dag-node-kpi:delivery_attain")).toBeInTheDocument();

    // 左侧行选中态。
    expect(within(strip).getByTestId("metric-kpi-delivery").getAttribute("data-selected")).toBe("1");
  });

  it("(a′) 点【未达成】指标（物料保障率·越线）→ 深度反向归因树（data-achieved=0·非达成框）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/dash");
    const strip = await screen.findByTestId("metric-strip");
    const breachedRow = await within(strip).findByTestId("metric-kpi-material");

    await user.click(breachedRow);

    const rc = screen.getByTestId("widget-rootcause");
    // 越线 → 走缺口树（drilled·非 achieved）。
    await within(rc).findByTestId("rootcause-drilled");
    const cockpit = within(rc).getByTestId("cockpit-rootcause");
    expect(cockpit.getAttribute("data-achieved")).toBe("0");
    expect(cockpit.getAttribute("data-metric")).toBe("material_cov");
    // 深度反向归因树可见（越线 Metric 根 + 因果链·非空）。
    expect(within(rc).getByTestId("provenance-dag")).toBeInTheDocument();
    // 越线态右面板不出「达成·无缺口」框。
    expect(within(rc).queryByTestId("rootcause-achieved")).toBeNull();
  });

  it("(c) 反事实双轨按基地真变（#10）：默认最严重基地 常州 → 切「江门」双轨真变", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/dash");
    const cf = await screen.findByTestId("cf-widget");
    const sel = (await within(cf).findByTestId("cf-basesel")) as HTMLSelectElement;
    await waitFor(() => expect(sel.options.length).toBeGreaterThan(1));
    // 默认 → 峰值最严重基地（常州·不破现状）。
    await waitFor(() => expect(within(cf).getByTestId("cf-base")).toHaveTextContent("常州"));
    const peak0 = within(cf).getByTestId("cf-peakcut").textContent;
    // 切基地 → 以 { base } 真重调 counterfactual_timeline → 双轨真变（峰值削减值随之变）。
    await user.selectOptions(sel, "江门");
    await waitFor(() => expect(within(cf).getByTestId("cf-base")).toHaveTextContent("江门"));
    await waitFor(() => expect(within(cf).getByTestId("cf-peakcut").textContent).not.toBe(peak0));
  });
});
