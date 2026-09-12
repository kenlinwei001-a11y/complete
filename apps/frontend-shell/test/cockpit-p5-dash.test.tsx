import { describe, expect, it } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TIGHTNESS_METRIC } from "@platform/contracts";
import { loginAs, renderApp } from "./utils";

/**
 * cockpit P5 前端：驾驶舱 V5/V7 版本切换（SopVersionRow）+ 反事实双轨推演双线图（counterfactual_timeline）。
 * 声明式 widget，数据走对象/求解器，前端零写死（R14）。
 */
describe("cockpit P5 · 驾驶舱版本切换 + 反事实双线图", () => {
  it("V5/V7 版本切换 chip + 选版本看供给/缺口；反事实双线图 + 差值", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/dash");

    // 版本切换 widget（SopVersionRow V1/V3/V5/V7）
    const vt = await screen.findByTestId("version-toggle");
    expect(within(vt).getByTestId("ver-chip-V7")).toHaveTextContent("待定稿");
    await user.click(within(vt).getByTestId("ver-chip-V5"));
    expect(within(vt).getByTestId("version-detail")).toHaveTextContent("缺口");

    // 反事实双轨推演 widget（counterfactual_timeline → 双曲线 + 峰值削减）
    const cf = await screen.findByTestId("cf-widget");
    await waitFor(() => expect(within(cf).getByTestId("cf-peakcut")).toBeInTheDocument());
    expect(within(cf).getByTestId("cf-chart")).toBeTruthy();

    /*
     * WO-UNIT-MEANING：「峰值削减 12」曾裸奔——12 是台/百分点看不出，实为**张力指数的削减量**。
     * 差值不能套 formatTightness（那是水平值「张力12/100」，语义相反），故拼「N 点张力（0–100 指数）」；
     * 双轨曲线的纵轴同样补口径行（jsdom 无 canvas，轴名不可见，故同文案落 DOM caption）。
     */
    expect(within(cf).getByText(/点张力（0–100 指数）/)).toBeInTheDocument();
    const cap = within(cf).getByTestId("cf-axis-caption").textContent ?? "";
    expect(cap).toContain(`纵轴：${TIGHTNESS_METRIC.label}`);
    expect(cap).toContain(TIGHTNESS_METRIC.hint);
    expect(cap).toMatch(new RegExp(`越线阈值 ${TIGHTNESS_METRIC.label}\\d+/${TIGHTNESS_METRIC.scaleMax}`));
  });

  it("反事实基地选择器：默认最严重基地 + 切基地→双轨真变（KILL-MOCK·C1/C2/C3）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/dash");

    const cf = await screen.findByTestId("cf-widget");
    // C1：基地选择器渲染，基地列表真取自 risk_timeline cards（>1 个基地·非写死）
    const sel = (await within(cf).findByTestId("cf-basesel")) as HTMLSelectElement;
    await waitFor(() => expect(sel.options.length).toBeGreaterThan(1));
    // C3：默认仍最严重基地（常州·峰值最高·不破现状）
    await waitFor(() => expect(within(cf).getByTestId("cf-base")).toHaveTextContent("常州"));
    const peakCut0 = within(cf).getByTestId("cf-peakcut").textContent;

    // C2：切到另一基地 → 以 { base } 真重调 solver → 双轨真变（base 标签 + 峰值削减值都随之变，非同一条曲线）
    await user.selectOptions(sel, "江门");
    await waitFor(() => expect(within(cf).getByTestId("cf-base")).toHaveTextContent("江门"));
    await waitFor(() => expect(within(cf).getByTestId("cf-peakcut").textContent).not.toBe(peakCut0));
  });
});
