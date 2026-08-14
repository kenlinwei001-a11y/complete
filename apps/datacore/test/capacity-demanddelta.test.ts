import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, type TestApp } from "./helpers.js";
import { capacityForecast } from "../src/solvers/capacity.js";
import { BATTERY_SOLVER_PARAMS } from "../src/synthetic/battery.js";
import { round } from "../src/prng.js";
import type { SolverContext, SolverParamsShape } from "../src/solvers/types.js";
import type { ObjectInstance } from "../src/domain.js";

// PRD-CAP-DEMANDDELTA 回归：demandDelta 真实驱动 effectiveDemand，
// 单位 GWh→万套，且 capWanP50===0 时诚实降级为 EMPTY（不伪造成果）。

async function forecast(t: TestApp, args: Record<string, unknown>) {
  const res = await invokeSolver(t, "capacity_forecast", args);
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: Record<string, unknown> }).data;
}

function mk(type: string, id: string, props: Record<string, unknown>): ObjectInstance {
  return { id, type, props, origin: { type: "SYNTHETIC" } } as unknown as ObjectInstance;
}

describe("PRD-CAP-DEMANDDELTA · capacity_forecast demandDelta + EMPTY guard", () => {
  it("无显式 qty 时：effectiveDemand = 订单簿基线 × (1 + demandDelta)，缺口分母为 effectiveDemand", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const modelId = "4680-NCM";
    const weeks = 6;
    const demandDelta = 0.2;
    const out = await forecast(t, { modelId, weeks, demandDelta });

    const baseline = out.baselineDemand as number;
    const effective = out.effectiveDemand as number;
    const gap = out.gap as number;
    const gapPct = out.gapPct as number;

    expect(typeof baseline).toBe("number");
    expect(baseline).toBeGreaterThan(0);
    expect(effective).toBe(round(baseline * (1 + demandDelta), 4));
    expect(out.demandDelta).toBe(demandDelta);

    const capWanP90 = out.capWanP90 as number;
    // gap 是**带符号**（capacity.ts:497 `effectiveDemand - capWanP90`·富余为负·与下方 gapPct 的 Math.max(0,gap) 一致）；
    // 当前 canonical 产能 > 订单簿×1.2 时 4680-NCM 为富余（gap<0）——原断言误裹 Math.max(0,…) 会假失败。
    expect(gap).toBe(round(effective - capWanP90, 4));
    if (effective > 0) {
      expect(gapPct).toBe(round(Math.max(0, gap) / effective, 4));
    }
  });

  it("显式 qty 时：effectiveDemand = qty × (1 + demandDelta)，且覆盖订单簿基线", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const qty = 50;
    const demandDelta = -0.1;
    const out = await forecast(t, { modelId: "4680-NCM", qty, weeks: 6, demandDelta });

    const effective = out.effectiveDemand as number;
    expect(effective).toBe(round(qty * (1 + demandDelta), 4));
    expect(out.baselineDemand).toBeGreaterThan(0); // 仍然回显，但不参与
    expect(out.gap).toBe(round(Math.max(0, effective - (out.capWanP90 as number)), 4));
  });

  it("capWanP50 === 0 时返回 dataMode=EMPTY，mainBottleneck 为空，feasibilityNote 说明数据缺口", () => {
    const params = BATTERY_SOLVER_PARAMS as unknown as SolverParamsShape;
    const modelId = "m_empty";
    const base = mk("Base", "obj_b_empty", { baseId: "b_empty", name: "空基地", formationCapDaily: 1e9, agingCapDaily: 1e9 });
    const model = mk("Model", "obj_m_empty", { modelId, name: "空型号", chem: "NCM" });
    const certByModel = new Map([[modelId, new Map([["b_empty", "量产"]])]]);
    const ctx: SolverContext = {
      tenantId: "demo",
      params,
      bases: [base],
      lines: [],
      processes: [],
      equipment: [],
      maintPlans: [],
      models: [model],
      orders: [],
      shipments: [],
      segments: [],
      dataHealth: [],
      certByModel,
      materials: [],
    } as unknown as SolverContext;

    const out = capacityForecast(ctx, { modelId, weeks: 6 });
    expect(out.dataMode).toBe("EMPTY");
    expect(out.capWanP50).toBe(0);
    expect(out.capWanP90).toBe(0);
    expect(out.ok).toBe(false);
    expect(out.mainBottleneck).toBe("");
    expect(out.mainBn).toBe("");
    expect(String(out.feasibilityNote)).toContain("产能数据为零");
    expect(out.gapPct).toBe(0);
  });

  it("输出 provenance 携带公式与口径标签", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = await forecast(t, { modelId: "4680-NCM", demandDelta: 0.1, weeks: 6 });
    const prov = out.provenance as Record<string, { formula: string; valueLabel: string }> | undefined;
    expect(prov).toBeTruthy();
    expect(prov!.capWanP50.formula).toContain("weeklyCap");
    expect(prov!.effectiveDemand.valueLabel).toContain("有效需求");
    expect(prov!.gap.valueLabel).toContain("缺口比例");
  });
});
