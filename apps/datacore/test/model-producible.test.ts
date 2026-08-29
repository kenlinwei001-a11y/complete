import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver } from "./helpers.js";

/**
 * PRD-IND-model 缺口①③：型号产能推演收敛可产网络。capacity_forecast 输出 nonProducible（不可产基地+原因）
 * + totalBases/producibleCount（N/总数 收敛注解）；reason 由 Model.chem × Base.kind 派生（R13/R14，前端零写死）。
 */
describe("model · 可产网络收敛（nonProducible + chem/pos 种子）", () => {
  it("Model 对象带 chem/pos 元信息（种子，非写死）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const models = await t.repos.objects.listByType("demo", "Model");
    const m = models.find((x) => x.props.modelId === "圆柱-LFP")!;
    expect(m.props.chem).toBe("LFP");
    expect(m.props.pos).toBe("储能");
  });

  it("capacity_forecast → producibleCount/totalBases + nonProducible（带派生 reason），可产+不可产 = 全基地", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = (await invokeSolver(t, "capacity_forecast", { modelId: "4680-NCM", qty: 40, weeks: 6 })).json() as {
      data: { perBaseRows: { baseId: string }[]; nonProducible: { base: string; reason: string }[]; totalBases: number; producibleCount: number };
    };
    const d = out.data;
    expect(d.totalBases).toBeGreaterThan(0);
    expect(d.producibleCount).toBe(d.perBaseRows.length);
    // 可产 + 不可产 = 全基地（收敛网络完整）
    expect(d.producibleCount + d.nonProducible.length).toBe(d.totalBases);
    // 不可产基地带派生原因（非空，可溯 chem×kind）
    if (d.nonProducible.length > 0) {
      expect(d.nonProducible[0]!.reason.length).toBeGreaterThan(0);
      expect(d.nonProducible[0]!.base.length).toBeGreaterThan(0);
    }
  });
});
