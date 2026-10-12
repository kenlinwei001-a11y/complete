import { describe, expect, it } from "vitest";
import { LocalTemplateIndex } from "../src/solvers/opt-embedding.js";

/**
 * 轨B·增量4 embedding 复用检索（advisory）测试。
 * 守：① 确定性（同 need 两次字节一致，R6/FUS2）；② 复用检索（选址类需求→facility_location 居首）；
 * ③ 覆盖缺口（离所有模板都远→true）；④ 跨行业迁移证据（两个不同行业的"选址"需求都命中同一模板 → 实证 R14）。
 */
describe("轨B·增量4 · LocalTemplateIndex 复用检索（advisory · FUS2）", () => {
  const idx = new LocalTemplateIndex();

  it("确定性：同 need 两次检索结果字节一致（R6）", () => {
    const a = idx.nearestTemplates("选址 设施 服务覆盖", 3);
    const b = idx.nearestTemplates("选址 设施 服务覆盖", 3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("复用检索：选址类需求 → facility_location 居首", () => {
    const top = idx.nearestTemplates("我要给若干需求点选建设施 最小化开设和服务成本", 3);
    expect(top[0]!.key).toBe("facility_location");
    expect(top[0]!.score).toBeGreaterThan(0);
  });

  it("运输/调拨类需求 → min_cost_flow 居首", () => {
    const top = idx.nearestTemplates("把货物从供应点调拨配送到需求点 网络流 最小运输成本", 3);
    expect(top[0]!.key).toBe("min_cost_flow");
  });

  it("覆盖缺口：完全无关需求 → coverageGap=true（补缺信号）", () => {
    expect(idx.coverageGap("天气预报 明天会下雨吗")).toBe(true);
  });
  it("命中需求 → coverageGap=false", () => {
    expect(idx.coverageGap("选址 设施 location facility")).toBe(false);
  });

  it("跨行业迁移证据（R14）：两个不同行业的'选址'需求都命中同一 facility_location 模板（top1）", () => {
    // 以"选址/设施/开设/建设成本"为主导信号（避免"覆盖"偏向 set_cover），两行业同模板 → 实证 R14。
    const ev = idx.nearestTemplates("充电站 选址 设施 开设成本 指派", 1)[0]!;
    const vaccine = idx.nearestTemplates("疫苗接种 诊所 选址 设施 建设成本 指派", 1)[0]!;
    expect(ev.key).toBe("facility_location");
    expect(vaccine.key).toBe("facility_location"); // 同一抽象模板服两行业 → R14
  });
});
