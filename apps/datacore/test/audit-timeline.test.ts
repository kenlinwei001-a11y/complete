import { describe, expect, it } from "vitest";
import { invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * wave④ audit/generate · 每审计项独立时序（audit_timeline）：按 kind 出 90 天逐日 series + 4 阶段，
 * 与产能推演同款逐日交互，形状由 kind hash 确定性派生（R14 无 per-kind 业务常数，R6 字节一致）。
 */
describe("audit_timeline 每审计项时序（L1 + L6）", () => {
  it("L1：按 kind 出 90 天逐日 series + 4 阶段 + 越线日/峰值", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = (await (await invokeSolver(t, "audit_timeline", { kind: "毛利" })).json() as { data: { kind: string; series: number[]; stages: { d: number; label: string }[]; peak: number; threshold: number } }).data;
    expect(out.kind).toBe("毛利");
    expect(out.series.length).toBe(90);
    expect(out.series.every((v) => v >= 40 && v <= 97)).toBe(true); // clamp[40,97]
    expect(out.stages.length).toBe(4);
    expect(out.stages.map((s) => s.label)).toEqual(["事件窗", "约束越线", "波及订单", "财务击穿"]);
    expect(out.peak).toBe(Math.max(...out.series));
  });

  it("L1：不同 kind 出不同曲线（形状 kind 派生）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const a = (await (await invokeSolver(t, "audit_timeline", { kind: "毛利" })).json() as { data: { series: number[] } }).data;
    const b = (await (await invokeSolver(t, "audit_timeline", { kind: "齐套" })).json() as { data: { series: number[] } }).data;
    expect(JSON.stringify(a.series)).not.toBe(JSON.stringify(b.series));
  });

  it("L6：同 kind 字节一致", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const a = (await invokeSolver(t, "audit_timeline", { kind: "现金" })).json();
    const b = (await invokeSolver(t, "audit_timeline", { kind: "现金" })).json();
    expect(JSON.stringify((a as { data: unknown }).data)).toBe(JSON.stringify((b as { data: unknown }).data));
  });
});
