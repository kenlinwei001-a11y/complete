import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { __resetSliceGovMock } from "@/mocks/handlers";

/**
 * WO-SLICE-REQUIRED-ARGS · 接缝测试（G-SLICE-ROOT-ARGS-UNDISCOVERABLE）
 *
 * 咬的是「契约/投影 ⇒ 徽标跟着变」这条缝，不是「组件存在」：
 *  - 清单行带 `requiredArgs` ⇒ 该行必须出现「需参数」徽标，且徽标文案列出参数名（人话）；
 *  - 清单行不带这个键 ⇒ 该行**必须没有**徽标（零误标）。
 * mock 清单投影与真后端同一行为（需参才带键，见 handlers.ts mockSliceGov 注释），
 * 且 mock 数据忠实复刻真种子（order_fulfillment_360 等 4 条 root selector 写 {{args.so}}）。
 *
 * 变异反证（亲手做过，见交付报告）：
 *  ① mock 投影里摘掉 requiredArgs ⇒ 「需参切片带徽标」断言红（徽标全消失）；
 *  ② 把不需参的 base_risk_profile 加上 requiredArgs ⇒ 「零误标」断言红。
 */
describe("WO-SLICE-REQUIRED-ARGS · 切片清单徽标跟着 requiredArgs 走", () => {
  beforeEach(() => __resetSliceGovMock());

  it("需参切片带「需参数」徽标且列出参数名；不需参切片零误标", async () => {
    loginAs("planner");
    renderApp("/admin/slices");
    await screen.findByTestId("slices-page");
    await screen.findByTestId("slice-row-model_capacity_network");

    // 需参（mock 投影带 requiredArgs: ["so"]）⇒ 徽标在，文案是人话且列出参数名
    const badge = screen.getByTestId("slice-reqargs-model_capacity_network");
    expect(badge.textContent).toBe("需参数：so");

    // 不需参（投影无 requiredArgs 键）⇒ 徽标必须不在（零误标）
    await screen.findByTestId("slice-row-base_risk_profile");
    expect(screen.queryByTestId("slice-reqargs-base_risk_profile")).toBeNull();
  });
});
