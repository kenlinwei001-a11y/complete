import { describe, expect, it } from "vitest";
// 不 import ADMIN：`invokeSolver` 的 headers 形参默认就是 ADMIN（helpers.ts:73）。
import { invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";

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

  // ── 交付级（铁律 1.5 判据三：测试必须是交付级的，不是功能测试）──────────────────────────
  // 上面 L1/L6 那几条判据全是「≥0 / 非空 / 长度对 / 字节一致」——**peakCut 报 0.0051 照样全绿**。
  // 下面两条按判据三补：(a) 每个数都能从返回的双曲线**独立算一遍**对上；(b) 对照实验。

  it("交付级 · 值校验：三个 delta 数各自从返回的双曲线独立算出", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "counterfactual_timeline", { base: "常州", factor: "瓶颈工序", horizon: 30 });
    expect(res.statusCode).toBe(200);
    const out = (res.json() as { data: { baselineSeries: number[]; mitigatedSeries: number[]; threshold: number; delta: { peakCut: number; crossDelayDays: number; ordersSaved: number } } }).data;
    const { baselineSeries: b, mitigatedSeries: m, threshold: th, delta } = out;

    // 处置生效日：从两条曲线的**首个分歧点**现算，不读实现里的常量（读了就变成同义反复）
    const tn0 = b.findIndex((v, i) => Math.abs(v - m[i]!) > 1e-9);
    expect(tn0, "两条曲线必须有分歧点，否则本测试什么都没验").toBeGreaterThan(0);

    // ① peakCut = 生效窗口内的 max 之差（不是全窗口：全窗口会落在未被处置的那几天上）
    const peakIn = (s: number[]) => Math.max(...s.slice(tn0));
    expect(delta.peakCut).toBeCloseTo(peakIn(b) - peakIn(m), 4);
    // 旁证：真削峰必须量得出处置强度。旧的全窗口口径在这里给 ≈0.005，本断言当场判负。
    expect(delta.peakCut, "峰值削减必须量得出处置强度，不能是饱和基线上的数值噪声").toBeGreaterThan(1);
    // 旧口径（全窗口）必须**明显更小** —— 这条把「改回去了」钉死
    expect(peakIn(b) - peakIn(m)).toBeGreaterThan(Math.max(...b) - Math.max(...m) + 1);

    // ② ordersSaved = 闭区间计数之差（与 crossDayOf 的 >= 同口径）
    expect(delta.ordersSaved).toBe(b.filter((v) => v >= th).length - m.filter((v) => v >= th).length);

    // ③ crossDelayDays = 首次越线日之差（1 基；未越线按窗口尾算）
    const firstCross = (s: number[]) => { const i = s.findIndex((v) => v >= th); return i === -1 ? null : i + 1; };
    const bc = firstCross(b), mc = firstCross(m);
    const expected = bc === null ? 0 : mc === null ? b.length - bc : mc - bc;
    expect(delta.crossDelayDays).toBe(expected);
  });

  it("交付级 · 对照实验：换处置方案（eff 13/10/9），峰值削减必须按各自 eff 走", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    // 三个方案 eff/tn 各不相同（extended.ts:58-62）⇒ 可预言：生效窗口内的削峰 == 其标称 eff。
    const cases: [string, number][] = [["debottleneck", 13], ["outsource_step", 10], ["reroute", 9]];
    const got: number[] = [];
    for (const [key, eff] of cases) {
      const res = await invokeSolver(t, "counterfactual_timeline", { base: "常州", factor: "瓶颈工序", horizon: 30, mitigationKey: key });
      expect(res.statusCode, `mitigationKey=${key} 应可解`).toBe(200);
      const pc = (res.json() as { data: { delta: { peakCut: number } } }).data.delta.peakCut;
      got.push(pc);
      expect(pc, `${key} 生效窗口内的削峰应等于其标称 eff=${eff}`).toBeCloseTo(eff, 4);
    }
    // 单调性：eff 大的削峰必须大。**全窗口口径下这三个数会几乎相同（都是饱和噪声）**，本断言当场判负。
    expect(got[0]!).toBeGreaterThan(got[1]!);
    expect(got[1]!).toBeGreaterThan(got[2]!);
  });

  it("L6：同 base/factor/mitigation 字节一致", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const a = (await invokeSolver(t, "counterfactual_timeline", { base: "常州", factor: "瓶颈工序", horizon: 30 })).json();
    const b = (await invokeSolver(t, "counterfactual_timeline", { base: "常州", factor: "瓶颈工序", horizon: 30 })).json();
    expect(JSON.stringify((a as { data: unknown }).data)).toBe(JSON.stringify((b as { data: unknown }).data));
  });
});
