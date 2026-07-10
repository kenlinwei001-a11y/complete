import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, type TestApp } from "./helpers.js";

/**
 * Q30-P2 求解器横铺 A（复用·低成本·DESIGN-query30 §1 P2 行）确定性单测。
 *
 * 三个 path-A 求解器**各复用现有机器**（非从零）：
 *  · capex_alternatives   ← 复用 capex_scenario（CAPEX 方案比选·多方案聚合择优）。
 *  · full_cost_rollup     ← 复用 capacity_rollup + finance_pnl（产能→成本→损益卷积）。
 *  · signal_propagation   ← 复用 supplier_disruption_radius 的反向多跳 BFS（图传导）。
 *
 * 齿：I/O 契约（输出形状字段全在场）+ R6 确定性（同输入同 seed 字节一致）+ 诚实空态（真无数据→空+诚实 dataMode）
 * + 复用机器真调（与被复用机器同源产出）。真起 datacore 合成种子世界（seed=42），非 mock/手绘。
 */

const CAPEX_ALT_ARGS = {
  scenarioKey: "枣庄储能线",
  demand: [50, 48, 49, 51],
  s0: [45, 45, 45, 45],
  alternatives: [
    { key: "A", label: "小步快跑", projects: [{ id: "A1", q0: 1, cap: 4, capex: [3, 5], m: 1800, salvageRate: 0.05, lifeQuarters: 40 }] },
    { key: "B", label: "一步到位", projects: [{ id: "B1", q0: 0, cap: 8, capex: [6, 4], m: 1800, salvageRate: 0.05, lifeQuarters: 40 }] },
  ],
};

const SIGNAL_ARGS = {
  signal: "产能扰动",
  rootType: "Base",
  rootId: "changzhou",
  layers: [
    { type: "Line", viaField: "baseId" },
    { type: "Process", viaField: "lineId" },
    { type: "Equipment", viaField: "processId" },
  ],
};

const data = (res: { json: () => unknown }) => (res.json() as { data: Record<string, unknown> }).data;

describe("Q30-P2 capex_alternatives（复用 capex_scenario·CAPEX 方案比选）", () => {
  it("I/O 契约：五维比较矩阵 + 择优推荐（每方案含 avgIrr/minIrr/c23PassCount/npvSum/peakGap）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "capex_alternatives", CAPEX_ALT_ARGS);
    expect(res.statusCode).toBe(200);
    const out = data(res);
    for (const f of ["scenarioKey", "quarters", "comparedCount", "alternatives", "recommendedKey", "dims", "note"]) {
      expect(out, `缺字段 ${f}`).toHaveProperty(f);
    }
    expect(out.comparedCount).toBe(2);
    const alts = out.alternatives as Record<string, unknown>[];
    expect(alts).toHaveLength(2);
    for (const a of alts) {
      for (const f of ["key", "label", "projectCount", "avgIrr", "minIrr", "c23PassCount", "allC23Pass", "npvSum", "peakGap"]) {
        expect(a, `方案缺字段 ${f}`).toHaveProperty(f);
      }
    }
    // 择优确定性：推荐键 ∈ 方案键集。
    expect(alts.map((a) => a.key)).toContain(out.recommendedKey);
  });

  it("复用机器真调：单方案 capex_alternatives 的 avgIrr == 直接跑 capex_scenario 的项目 IRR（同源产出）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const single = { scenarioKey: "S", demand: [50, 48, 49, 51], s0: [45, 45, 45, 45], projects: CAPEX_ALT_ARGS.alternatives[0]!.projects };
    const scen = data(await invokeSolver(t, "capex_scenario", single));
    const alt = data(await invokeSolver(t, "capex_alternatives", { ...CAPEX_ALT_ARGS, alternatives: [CAPEX_ALT_ARGS.alternatives[0]!] }));
    const scenIrr = (scen.projects as { irr: number }[])[0]!.irr;
    const altAvgIrr = (alt.alternatives as { avgIrr: number }[])[0]!.avgIrr;
    expect(altAvgIrr).toBe(scenIrr); // 单项目 → 平均 IRR == 该项目 IRR（真复用 capexScenario·非另算）
  });

  it("R6 确定性：同输入同 seed 重跑字节一致", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const a = data(await invokeSolver(t, "capex_alternatives", CAPEX_ALT_ARGS));
    const b = data(await invokeSolver(t, "capex_alternatives", CAPEX_ALT_ARGS));
    expect(JSON.stringify(a.alternatives)).toBe(JSON.stringify(b.alternatives));
    expect(a.recommendedKey).toBe(b.recommendedKey);
  });

  it("诚实空态：无候选方案 → 空 alternatives + note 说明（不虚构方案）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = data(await invokeSolver(t, "capex_alternatives", { demand: [50, 48], s0: [45, 45], alternatives: [] }));
    expect(out.comparedCount).toBe(0);
    expect(out.alternatives).toEqual([]);
    expect(out.recommendedKey).toBeNull();
    expect(String(out.note)).toContain("无候选方案");
  });
});

describe("Q30-P2 full_cost_rollup（复用 capacity_rollup + finance_pnl·产能→成本→损益）", () => {
  it("I/O 契约：产能侧 + 损益侧字段全在场（capacityWeeklyWan/pnl/gmRow/marginPct/summary）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "full_cost_rollup", {});
    expect(res.statusCode).toBe(200);
    const out = data(res);
    for (const f of ["capacityWeeklyWan", "capacityBases", "revenue", "cost", "grossMargin", "marginPct", "pnl", "gmRow", "attribution", "summary"]) {
      expect(out, `缺字段 ${f}`).toHaveProperty(f);
    }
    expect(Array.isArray(out.capacityBases)).toBe(true);
    expect(Array.isArray(out.pnl)).toBe(true);
  });

  it("复用机器真调：产能侧 == capacity_rollup 真值、损益侧 == finance_pnl 真值（同源卷积·非另算）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const rollup = data(await invokeSolver(t, "capacity_rollup", { modelId: "4680-NCM" }));
    const fin = data(await invokeSolver(t, "finance_pnl", {}));
    const full = data(await invokeSolver(t, "full_cost_rollup", {}));
    // 损益侧逐值对照 finance_pnl（真复用·同源）。
    expect(JSON.stringify(full.pnl)).toBe(JSON.stringify(fin.pnl));
    expect(JSON.stringify(full.gmRow)).toBe(JSON.stringify(fin.gmRow));
    expect(full.attribution).toBe(fin.attribution);
    // 产能侧：总周产能 == capacity_rollup 各基地 weeklyWan 之和（真复用 computeRollup）。
    const sum = (rollup.bases as { weeklyWan: number }[]).reduce((s, b) => s + Math.max(0, b.weeklyWan), 0);
    expect(Math.abs((full.capacityWeeklyWan as number) - Math.round(sum * 10000) / 10000)).toBeLessThan(0.5);
  });

  it("R6 确定性：同 seed 重跑字节一致", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const a = data(await invokeSolver(t, "full_cost_rollup", {}));
    const b = data(await invokeSolver(t, "full_cost_rollup", {}));
    expect(JSON.stringify(a.pnl)).toBe(JSON.stringify(b.pnl));
    expect(a.capacityWeeklyWan).toBe(b.capacityWeeklyWan);
    expect(a.summary).toBe(b.summary);
  });
});

describe("Q30-P2 signal_propagation（复用 supplier_disruption_radius 的反向多跳 BFS·图传导）", () => {
  it("I/O 契约：半径 + 逐层受影响集 + 末端触达 + affectedSet 全在场", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "signal_propagation", SIGNAL_ARGS);
    expect(res.statusCode).toBe(200);
    const out = data(res);
    for (const f of ["signal", "rootType", "rootId", "layers", "radius", "totalAffected", "reachedType", "reachedCount", "affectedSet", "summary"]) {
      expect(out, `缺字段 ${f}`).toHaveProperty(f);
    }
    expect(out.signal).toBe("产能扰动");
    expect(out.radius as number).toBeGreaterThanOrEqual(1); // 常州基地下有真产线图 → 至少传导 1 层
    expect(Array.isArray(out.affectedSet)).toBe(true);
  });

  it("复用机器真调：signal_propagation 与 supplier_disruption_radius 同 layers 产出同 BFS 结果（半径/逐层计数一致）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const sig = data(await invokeSolver(t, "signal_propagation", SIGNAL_ARGS));
    const sup = data(await invokeSolver(t, "supplier_disruption_radius", { rootType: "Base", rootId: "changzhou", layers: SIGNAL_ARGS.layers }));
    expect(sig.radius).toBe(sup.radius); // 同一 traverseGraphRadius 机器 → 同半径
    expect(sig.totalAffected).toBe(sup.totalAffected);
    // 逐层受影响集合逐值一致（真复用 BFS·非另算）。
    expect(JSON.stringify(sig.layers)).toBe(JSON.stringify(sup.layers));
    expect(sig.reachedCount).toBe(sup.leafCount);
  });

  it("R6 确定性：同 seed 重跑字节一致（含 affectedSet 排序稳定）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const a = data(await invokeSolver(t, "signal_propagation", SIGNAL_ARGS));
    const b = data(await invokeSolver(t, "signal_propagation", SIGNAL_ARGS));
    expect(JSON.stringify(a.layers)).toBe(JSON.stringify(b.layers));
    expect(JSON.stringify(a.affectedSet)).toBe(JSON.stringify(b.affectedSet));
    expect(a.summary).toBe(b.summary);
  });

  it("诚实空态：信号源无下游图（断链根）→ 半径 0 + 空受影响集（不虚构传导）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = data(await invokeSolver(t, "signal_propagation", {
      signal: "断链信号", rootType: "Base", rootId: "__nonexistent_root__",
      layers: [{ type: "Line", viaField: "baseId" }],
    }));
    expect(out.radius).toBe(0);
    expect(out.totalAffected).toBe(0);
    expect(out.affectedSet).toEqual([]);
  });
});
