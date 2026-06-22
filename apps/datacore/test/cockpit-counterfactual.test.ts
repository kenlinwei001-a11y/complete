import { describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * cockpit P4 反事实双轨推演（"如不解决 XX，未来 N 天会怎样"）：counterfactual_timeline 编排 risk_timeline
 * 出 do-nothing baseline 与处置后双曲线 + 差值（峰值削减/越线日推迟/少越线日），确定性 R6。
 */
describe("cockpit P4 · 反事实双轨推演（L1 + L6）", () => {
  it("L1：双轨序列 + 差值（处置后峰值≤baseline，越线日推迟≥0）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "counterfactual_timeline", { base: "常州", factor: "瓶颈工序", horizon: 30 });
    expect(res.statusCode).toBe(200);
    const out = (res.json() as { data: { baselineSeries: number[]; mitigatedSeries: number[]; threshold: number; delta: { peakCut: number; crossDelayDays: number; ordersSaved: number }; mitigation: string } }).data;
    expect(out.baselineSeries.length).toBe(30);
    expect(out.mitigatedSeries.length).toBe(30);
    // 处置后每日 ≤ baseline（处置只会削峰，不会加剧）
    expect(out.mitigatedSeries.every((v, i) => v <= out.baselineSeries[i]! + 1e-6)).toBe(true);
    expect(out.delta.peakCut).toBeGreaterThanOrEqual(0);
    expect(out.delta.crossDelayDays).toBeGreaterThanOrEqual(0);
    expect(out.mitigation).toBeTruthy();
  });

  it("L1：缺 base/factor → 自动取峰值最高风险卡推演", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "counterfactual_timeline", { horizon: 30 });
    expect(res.statusCode).toBe(200);
    const out = (res.json() as { data: { base: string; factor: string; baselineSeries: number[] } }).data;
    expect(out.base).toBeTruthy();
    expect(out.factor).toBeTruthy();
    expect(out.baselineSeries.length).toBe(30);
  });

  it("L6：同 base/factor/mitigation 字节一致", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const a = (await invokeSolver(t, "counterfactual_timeline", { base: "常州", factor: "瓶颈工序", horizon: 30 })).json();
    const b = (await invokeSolver(t, "counterfactual_timeline", { base: "常州", factor: "瓶颈工序", horizon: 30 })).json();
    expect(JSON.stringify((a as { data: unknown }).data)).toBe(JSON.stringify((b as { data: unknown }).data));
  });
});
