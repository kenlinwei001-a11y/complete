import { describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";
import {
  countermeasureCombo,
  mapCertLever,
  mapChangeoverLever,
  mapOutsourcingLevers,
  mapCapexLever,
} from "../src/solvers/extended.js";

/**
 * Q30-P4 跨求解器编排层（治 countermeasure_combo 诈账根 · DESIGN-query30-orch §1 P4 行）。
 *
 * 验收齿（铁律0.4）：
 *  · 映射器逐个——真映射（release 逐值溯自子求解器真输出字段）+ 诚实空（子求解器真无产出→null/[]，不补位）。
 *  · 组合择优——真贪心最小成本闭合缺口 + 三选二权衡（保交付/毛利/信用）。
 *  · 真调证据——mock 某子求解器释放量 → countermeasure_combo 组合输出**跟变**（证非常数、非借名、非魔数）。
 *  · R6——同输入同 seed 字节一致。
 *  · 诚实降级仍在——无杠杆→needsRealLevers；杠杆不足→feasible:false + 残余缺口（不虚构达标·不回潮魔数）。
 */

describe("Q30-P4 · gap 释放账本映射器（真映射 + 诚实空 · 逐值溯自子求解器真输出）", () => {
  it("mapCertLever：release = Σ schedule[].unlockCapacity（直接求和·零系数）", () => {
    const certOut = {
      schedule: [
        { model: "A", line: "L1", startWeek: 1, finishWeek: 3, unlockCapacity: 26.46, priority: 0.3 },
        { model: "B", line: "L2", startWeek: 1, finishWeek: 5, unlockCapacity: 13.54, priority: 0.1 },
      ],
    };
    const lever = mapCertLever(certOut, "LIVE")!;
    expect(lever).not.toBeNull();
    expect(lever.solver).toBe("cert_schedule");
    expect(lever.release).toBe(40); // 26.46 + 13.54（逐值溯自 unlockCapacity·非魔数）
    expect(lever.costRank).toBe(1);
    expect(lever.protects).toEqual(["delivery"]);
    expect(lever.basis).toContain("unlockCapacity=40");
  });

  it("mapCertLever：无待认证型号（schedule 空）→ null（诚实缺席·不补位）", () => {
    expect(mapCertLever({ schedule: [] }, "LIVE")).toBeNull();
    expect(mapCertLever({}, "LIVE")).toBeNull();
  });

  it("mapChangeoverLever：release = savedVsDueMin/1440 × 真线日产能 /10000（物理/单位常数·非业务系数）", () => {
    // savedVsDueMin=1440 分（=1 天）× 线日产能 100000 套/天 / 10000 = 10 万套。
    const lever = mapChangeoverLever({ savedVsDueMin: 1440 }, 100000, "LIVE")!;
    expect(lever).not.toBeNull();
    expect(lever.solver).toBe("changeover_sequence");
    expect(lever.release).toBe(10);
    expect(lever.unitCost).toBe(0); // 仅重排序·零外购成本
    expect(lever.protects).toEqual(["delivery", "margin"]);
  });

  it("mapChangeoverLever：savedVsDueMin=0（排序无省时）或无真线产能 → null（诚实缺席）", () => {
    expect(mapChangeoverLever({ savedVsDueMin: 0 }, 100000, "LIVE")).toBeNull();
    expect(mapChangeoverLever({ savedVsDueMin: 500 }, 0, "LIVE")).toBeNull();
  });

  it("mapOutsourcingLevers：allocation 各渠道 qty→release·cost/qty→unitCost（逐值溯自渠道真产出）", () => {
    const osOut = {
      allocation: [
        { channel: "overtime", name: "自产加班", qty: 57.6, cost: 57.6 },
        { channel: "outsource", name: "外协", qty: 86.4, cost: 120.96 },
        { channel: "delay", name: "延期", qty: 0, cost: 0 },
      ],
    };
    const levers = mapOutsourcingLevers(osOut, "PARTIAL");
    expect(levers.map((l) => l.key)).toEqual(["outsource_overtime", "outsource_outsource"]); // qty=0 的延期诚实略过
    expect(levers[0]!.release).toBe(57.6);
    expect(levers[0]!.unitCost).toBe(1); // 57.6/57.6
    expect(levers[0]!.sacrifices).toEqual([]);
    expect(levers[1]!.unitCost).toBe(1.4); // 120.96/86.4·外协溢价
    expect(levers[1]!.sacrifices).toEqual(["margin"]); // 外协舍毛利
  });

  it("mapOutsourcingLevers：无分配 → []（诚实空）", () => {
    expect(mapOutsourcingLevers({ allocation: [] }, "MOCK")).toEqual([]);
  });

  it("mapCapexLever：release = max(S[q]−s0[q])（峰值新增产能·逐值溯自 capexScenario 真 S/s0）", () => {
    const capexOut = {
      S: [0, 0, 0, 1.75, 5.625, 7.65, 8.9, 9.5],
      s0: [],
      projects: [{ id: "ZZ", cashflow: [-3, -5, 2, 4, 6, 8] }],
    };
    const lever = mapCapexLever(capexOut, "PARTIAL")!;
    expect(lever).not.toBeNull();
    expect(lever.solver).toBe("capex_scenario");
    expect(lever.release).toBe(9.5); // 峰值 S−s0
    expect(lever.costRank).toBe(3);
    expect(lever.sacrifices).toEqual(["credit"]); // 巨额现金支出舍信用
  });

  it("mapCapexLever：无扩产项目 → null（诚实缺席）", () => {
    expect(mapCapexLever({ S: [1, 2], s0: [0, 0], projects: [] }, "PARTIAL")).toBeNull();
    expect(mapCapexLever({}, "PARTIAL")).toBeNull();
  });
});

describe("Q30-P4 · countermeasureCombo 组合择优 + 三选二 + 真调证据 + 诚实降级", () => {
  it("真调证据：mock cert 释放量变化 → 组合残余缺口跟变（证非常数·非借名·非魔数系数）", () => {
    const certLow = mapCertLever({ schedule: [{ unlockCapacity: 10, finishWeek: 2 }] }, "LIVE")!;
    const certHigh = mapCertLever({ schedule: [{ unlockCapacity: 80, finishWeek: 2 }] }, "LIVE")!;
    const comboLow = countermeasureCombo({ gap: 100, levers: [certLow], subSolvers: ["cert_schedule"] }) as {
      residualGap: number; combo: { release: number }[];
    };
    const comboHigh = countermeasureCombo({ gap: 100, levers: [certHigh], subSolvers: ["cert_schedule"] }) as {
      residualGap: number; combo: { release: number }[];
    };
    // 换子求解器（cert）真产出 → 组合释放量/残余缺口随之变（若是魔数系数则不会随 unlockCapacity 变）。
    expect(comboLow.combo[0]!.release).toBe(10);
    expect(comboLow.residualGap).toBe(90);
    expect(comboHigh.combo[0]!.release).toBe(80);
    expect(comboHigh.residualGap).toBe(20);
  });

  it("三选二：含外协（舍毛利）+ 延期（舍交付/信用）→ objectives/tradeoff 逐值反映所选杠杆标签", () => {
    const levers = [
      { key: "cert_unlock", solver: "cert_schedule", release: 40, unitCost: 0.1, costRank: 1, protects: ["delivery"] as const, sacrifices: [] as const },
      { key: "outsource_outsource", solver: "outsourcing_split", release: 40, unitCost: 1.4, costRank: 2, protects: ["delivery"] as const, sacrifices: ["margin"] as const },
      { key: "outsource_delay", solver: "outsourcing_split", release: 40, unitCost: 2.5, costRank: 3, protects: ["margin"] as const, sacrifices: ["delivery", "credit"] as const },
    ];
    const r = countermeasureCombo({ gap: 100, levers, subSolvers: ["cert_schedule", "outsourcing_split"] }) as {
      feasible: boolean; objectives: { objective: string; status: string }[]; tradeoff: { protected: string[]; sacrificed: string[] };
    };
    expect(r.feasible).toBe(true); // 40+40+40 ≥ 100
    const byObj = Object.fromEntries(r.objectives.map((o) => [o.objective, o.status]));
    // 延期被选（收尾闭合）→ 交付/信用被牺牲（SACRIFICED 优先于 PROTECTED·保守诚实）；毛利被外协牺牲。
    expect(byObj.delivery).toBe("SACRIFICED");
    expect(byObj.margin).toBe("SACRIFICED");
    expect(byObj.credit).toBe("SACRIFICED");
    expect(r.tradeoff.sacrificed.length).toBeGreaterThan(0);
  });

  it("诚实降级：杠杆不足闭合缺口 → feasible:false + 残余缺口明示（不虚构达标·不回潮魔数）", () => {
    const r = countermeasureCombo({ gap: 100, levers: [{ key: "cert", solver: "cert_schedule", release: 30, unitCost: 0.5, costRank: 1 }] }) as {
      feasible: boolean; residualGap: number; needsRealLevers: boolean;
    };
    expect(r.feasible).toBe(false);
    expect(r.residualGap).toBe(70);
    expect(r.needsRealLevers).toBe(false); // 有真杠杆·只是不足（诚实标残余·非诈账）
  });

  it("诚实降级：无杠杆 → needsRealLevers:true + 空组合（不以启发系数冒充·KILL-MOCK-RED）", () => {
    const r = countermeasureCombo({ gap: 100 }) as { needsRealLevers: boolean; combo: unknown[]; note: string };
    expect(r.needsRealLevers).toBe(true);
    expect(r.combo).toHaveLength(0);
    expect(r.note).toContain("绝不以启发系数冒充");
  });
});

describe("Q30-P4 · 编排层端到端（真调子求解器 · 逐值对照 · R6）", () => {
  it("countermeasure_combo 经 invoke 真调 4 子求解器建真杠杆·组合闭合缺口·needsRealLevers:false", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const r = (await invokeSolver(t, "countermeasure_combo", {}, ADMIN)).json().data as {
      needsRealLevers: boolean; feasible: boolean; subSolvers: string[];
      combo: { key: string; solver: string; release: number }[]; tradeoff: { protected: string[] };
    };
    expect(r.needsRealLevers).toBe(false);
    // 真调 4 子求解器（cert_schedule/changeover_sequence/outsourcing_split/capex_scenario）。
    expect(r.subSolvers).toContain("cert_schedule");
    expect(r.subSolvers).toContain("outsourcing_split");
    expect(r.subSolvers).toContain("capex_scenario");
    expect(r.combo.length).toBeGreaterThan(0);
    expect(r.combo.every((c) => typeof c.solver === "string")).toBe(true); // 每杠杆标来源求解器
  });

  it("逐值对照：组合里 cert_unlock 释放量 === cert_schedule 直 invoke 的 Σ unlockCapacity（证真调·非魔数）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const certOut = (await invokeSolver(t, "cert_schedule", {}, ADMIN)).json().data as {
      schedule: { unlockCapacity: number }[];
    };
    const certSum = Math.round(certOut.schedule.reduce((s, x) => s + x.unlockCapacity, 0) * 10000) / 10000;
    const combo = (await invokeSolver(t, "countermeasure_combo", {}, ADMIN)).json().data as {
      combo: { key: string; release: number }[]; gap: number;
    };
    const certLever = combo.combo.find((c) => c.key === "cert_unlock");
    expect(certLever).toBeDefined();
    // cert 杠杆释放量 = min(gap, Σ unlockCapacity)——组合择优取用量；若 gap ≥ certSum 则应恰等 certSum（逐值溯真产出）。
    const expected = Math.min(combo.gap, certSum);
    expect(certLever!.release).toBeCloseTo(expected, 2);
  });

  it("R6：同 seed 两次 invoke 字节一致", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const a = (await invokeSolver(t, "countermeasure_combo", {}, ADMIN)).json().data;
    const b = (await invokeSolver(t, "countermeasure_combo", {}, ADMIN)).json().data;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
