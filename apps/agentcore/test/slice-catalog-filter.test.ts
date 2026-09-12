import { describe, expect, it } from "vitest";
import { isMachineOnlySlice, projectSlices } from "../src/dril/resource-projector.js";

/**
 * WO-SLICE-CONSUMPTION-20260912 · G7：agent 切片目录排除 coverage_*（机器饲料不进 LLM 上下文）。
 * 现状备忘：datacore discover 靠「无 description 不入目录」意外挡着 coverage_* —— 本钉与那条规则解耦，
 * 任何一侧失守另一侧仍挡。
 */
describe("agent 切片目录排除 coverage_*（G7）", () => {
  it("isMachineOnlySlice 只认 coverage_ 前缀", () => {
    expect(isMachineOnlySlice("coverage_order")).toBe(true);
    expect(isMachineOnlySlice("coverage_equipmentoee")).toBe(true);
    expect(isMachineOnlySlice("order_fulfillment_360")).toBe(false);
    expect(isMachineOnlySlice("biz.x.order_to_base")).toBe(false);
    expect(isMachineOnlySlice("my_coverage_custom")).toBe(false); // 非前缀不误伤
  });

  it("projectSlices 过滤 coverage_*，业务切片保留", () => {
    const out = projectSlices([
      { key: "coverage_order", name: "订单覆盖", description: "x" },
      { key: "coverage_equipmentoee", name: "设备OEE覆盖", description: "x" },
      { key: "order_fulfillment_360", name: "订单履约全景", description: "x" },
      { key: "domain_d06_capacity", name: "产能域", description: "x" },
    ] as never);
    expect(out.map((r) => r.key)).toEqual(["order_fulfillment_360", "domain_d06_capacity"]);
  });
});
