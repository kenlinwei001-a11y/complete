import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TIGHTNESS_METRIC } from "@platform/contracts";
import { loginAs, renderApp } from "./utils";

/**
 * AUDIT.1（audit 视图 1:1 复刻 · 时序推演）：规划体检展开审计项时序 → 与产能推演同款 **逐日圆点轴**
 * （消费 risk_timeline 已产 series）：顶部摘要 + 逐日圆点 + 三档图例 + 点选日点详情。4 节点 stepper 保留为概览。
 */
describe("AUDIT.1 · 规划体检逐日圆点轴（消费已产 series）", () => {
  it("展开 X02 → 逐日圆点轴（摘要+圆点+图例）+ 点选日点出详情；stepper 概览仍在", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/plan-audit");

    const x02 = await screen.findByTestId("audit-item-med-X02");
    await user.click(within(x02).getByTestId("tl-toggle-med-X02"));
    await screen.findByTestId("audit-risk-timeline-X02");

    // 逐日圆点轴（消费 risk_timeline card.series）
    const dda = await screen.findByTestId("dda-X02");
    expect(within(dda).getByTestId("dda-X02-summary")).toBeTruthy();
    expect(within(dda).getByTestId("dda-X02-legend")).toBeTruthy();
    // 逐日圆点（≥1 天）
    const dot0 = within(dda).getByTestId("dda-X02-dot-0");
    expect(dot0).toBeTruthy();
    // 点选某日 → 日点详情（当日传导度）
    await user.click(within(dda).getByTestId("dda-X02-dot-5"));
    expect(await within(dda).findByTestId("dda-X02-daytip")).toHaveTextContent("D+5");

    // 4 节点 stepper 概览仍保留（F15 不破）
    expect(within(x02).getByTestId("ptl-X02-node-cross")).toHaveTextContent("约束越线");
  });

  /**
   * WO-UNIT-MEANING · 逐日轴的数字不得裸奔（治用户诉求「数字要配套它的意义」）。
   * 病灶：摘要曾是「当前 52 → 峰值 91」、圆点 tooltip 曾是「D+5 · 91」——91 会被读成 91% / 91 台，
   * 真实含义是**传导度 91/100**（与 risk_timeline 张力同一 0–100 指数空间、同一越线阈值）。
   * 红咬：量程取 contracts `TIGHTNESS_METRIC.scaleMax`（改字典即改本断言）；退回 `Math.round(v)` 裸数即红。
   */
  it("摘要/圆点 tooltip/日点详情/图例一律带量纲「传导度N/100」（退回裸数即红）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/plan-audit");

    const x02 = await screen.findByTestId("audit-item-med-X02");
    await user.click(within(x02).getByTestId("tl-toggle-med-X02"));
    const dda = await screen.findByTestId("dda-X02");

    const scale = TIGHTNESS_METRIC.scaleMax;
    const withUnit = new RegExp(`传导度\\d+/${scale}`);

    // ① 顶部摘要：当前 / 峰值 / 阈值 三个数全部带量纲。
    const summary = within(dda).getByTestId("dda-X02-summary");
    expect(summary.textContent ?? "").toMatch(withUnit);
    expect(summary.textContent ?? "").toContain("阈值 传导度");
    // 退回裸「当前 52 →」形态即红（当前/峰值后必须紧跟指标名而非数字）
    expect(summary.textContent ?? "").not.toMatch(/当前\s*\d/);
    expect(summary.textContent ?? "").not.toMatch(/峰值\s*\d/);

    // ② 逐日圆点 tooltip（title）带量纲。
    const dot0 = within(dda).getByTestId("dda-X02-dot-0");
    expect(dot0.getAttribute("title") ?? "").toMatch(withUnit);

    // ③ 图例首格标出量程与方向（0–100 指数·越高越紧）。
    const legend = within(dda).getByTestId("dda-X02-legend");
    expect(legend.textContent ?? "").toContain(`${TIGHTNESS_METRIC.scaleMin}–${scale}`);
    expect(legend.textContent ?? "").toContain(TIGHTNESS_METRIC.hint);

    // ④ 点选日点详情同口径。
    await user.click(within(dda).getByTestId("dda-X02-dot-5"));
    const tip = await within(dda).findByTestId("dda-X02-daytip");
    expect(tip.textContent ?? "").toMatch(withUnit);
  });
});
