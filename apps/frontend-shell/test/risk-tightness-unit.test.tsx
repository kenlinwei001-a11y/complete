import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { TIGHTNESS_METRIC, formatTightness } from "@platform/contracts";

/**
 * WO-UNIT-MEANING · 张力量纲回归（治 G-UNIT-NORMALIZE·用户诉求「所有数字都要配套它的意义」）。
 *
 * 病灶：卡面因素 chip 渲染成「设备OEE 76」——76 紧贴 "OEE" 会被直接读成 **OEE=76%**，
 * 而真实含义是「设备OEE 这个因素的**张力** 76/100」。审计中误导性最强的一处（错读比缺单位更坑）。
 *
 * 红咬：量纲**单一真值**在 `@platform/contracts` 的 `TIGHTNESS_METRIC`/`formatTightness`——
 * 退回裸数字（`{factor} {Math.round(v)}`）即红；改 scaleMax 即改本断言（证真单源·非前端各写一份 R14）。
 */
describe("WO-UNIT-MEANING · 张力值带量纲（0–100 指数·非百分比）", () => {
  it("卡面因素 chip 显示「张力N/100」而非裸数字（防被读成 OEE=76%）", async () => {
    loginAs("planner");
    renderApp("/v/risk");

    const chips = await waitFor(async () => {
      const el = document.querySelector('[data-testid^="risk-chips-"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });

    const text = chips.textContent ?? "";
    // ① 带量纲标签与量程（「张力76/100」形态）——退回裸数字即红。
    expect(text).toContain(TIGHTNESS_METRIC.label);
    expect(text).toContain(`/${TIGHTNESS_METRIC.scaleMax}`);
    // ② 至少一个 chip 形如「<因素> 张力<N>/100」（因素名与张力值之间不再直接相邻裸数字）。
    expect(text).toMatch(new RegExp(`${TIGHTNESS_METRIC.label}\\d+/${TIGHTNESS_METRIC.scaleMax}`));
  });

  it("详情逐因素行与逐日点 tooltip 同口径带量纲（同一 formatTightness 单源）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/risk");

    const card = await screen.findByTestId("risk-card-常州");
    await user.click(card);
    const tl = await screen.findByTestId("risk-timeline");
    // 主因素副标题「张力A/100→张力B/100 · …」——退回 `62→83` 即红。
    expect(tl.textContent ?? "").toMatch(new RegExp(`${TIGHTNESS_METRIC.label}\\d+/${TIGHTNESS_METRIC.scaleMax}`));
  });

  it("formatTightness 单源纯函数：带量程 / null 诚实「—」不臆造 0", () => {
    expect(formatTightness(76)).toBe(`${TIGHTNESS_METRIC.label}76/${TIGHTNESS_METRIC.scaleMax}`);
    expect(formatTightness(75.6)).toBe(`${TIGHTNESS_METRIC.label}76/${TIGHTNESS_METRIC.scaleMax}`); // 四舍五入
    expect(formatTightness(null)).toBe("—");
    expect(formatTightness(undefined)).toBe("—");
    expect(formatTightness(Number.NaN)).toBe("—"); // 非有限值不臆造
  });
});
