import { describe, expect, it } from "vitest";
import { invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * QUERY30 缺口③ Q01 样板 · `what_if_displacement`（DESIGN-query30 §2.5）——接单挤占推演。
 * 齿：① R6 确定性（同输入字节一致·禁 random/时钟）；② 四型方案枚举完整；③ 挤占级联正确
 *（高优先级最长位移天）；④ 真接 C34（挤占优先级）/C35（≥2 方案）evaluate_rules 真裁决。
 * 灭"卡面挂名"：规则真进求解器结论。
 */

// 单线争抢场景：日需求 100 > 自由产能 20 → 需挤占；含 1 高 1 低 pri 在手单（均不可外协）。
const CONTEND = {
  model: "MX",
  qty: 4200,
  weeks: 6, // horizon 42 天 → dailyDemand=ceil(4200/42)=100
  advancePct: 0.2,
  baseId: "常州",
  lines: [{ lineId: "L1", capacityDaily: 120, certifiedModels: ["MX", "MA"] }],
  orders: [
    { so: "A2", cust: "客户2", model: "MA", qty: 2100, pri: "低", marginPct: 20, penaltyClause: 0.05, substitutable: false, unitPrice: 500 },
    { so: "A1", cust: "客户1", model: "MA", qty: 2100, pri: "高", marginPct: 10, penaltyClause: 0.1, substitutable: false, unitPrice: 500 },
  ],
  newUnitPrice: 600,
};

const data = (r: { json: () => { data: Record<string, unknown> } }) => r.json().data;

describe("QUERY30 缺口③ Q01 · what_if_displacement 接单挤占推演", () => {
  it("① R6 确定性：同输入两次 invoke 字节一致（禁 random/时钟）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const a = await invokeSolver(t, "what_if_displacement", CONTEND);
    const b = await invokeSolver(t, "what_if_displacement", CONTEND);
    expect(a.statusCode).toBe(200);
    expect(JSON.stringify(data(a))).toBe(JSON.stringify(data(b)));
  });

  it("② 四型方案枚举完整（延期/外协/拆单/降级）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = data(await invokeSolver(t, "what_if_displacement", CONTEND));
    const schemes = out.schemes as { key: string; feasible: boolean }[];
    expect(schemes.map((s) => s.key)).toEqual(["delay", "outsource", "split", "downgrade"]);
    // 单线不可外协 → outsource/split 不可行；delay/downgrade 可行 → schemeCount≥2。
    expect(out.recommended).toBeTruthy();
    expect(out.schemeCount as number).toBeGreaterThanOrEqual(2);
    // 五维量化比较矩阵完整。
    const cmp = out.comparison as { columns: string[]; rows: unknown[][] };
    expect(cmp.columns).toHaveLength(6);
    expect(cmp.rows).toHaveLength(4);
  });

  it("③ 挤占级联正确：高优先级单被挤 → highPriDisplaceDays 从真单量派生（>0）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = data(await invokeSolver(t, "what_if_displacement", CONTEND));
    expect(out.feasibleWithoutDisplacement).toBe(false);
    const disp = out.displacedOrders as { so: string; pri: string; displaceDays: number; reScheme: string }[];
    // 腾容 3360 单量 → 低 pri A2(2100) 先挤、仍不足 → 高 pri A1(2100) 亦被挤。
    expect(disp.map((d) => d.so).sort()).toEqual(["A1", "A2"]);
    // 高优先级 A1 位移 ceil(2100/100)=21 天 → highPriDisplaceDays=21。
    expect(out.highPriDisplaceDays).toBe(21);
    // 逐单再方案：不可外协 → 延期方案（Q01「被影响订单也有多方案」）。
    expect(disp.every((d) => d.reScheme.includes("延期"))).toBe(true);
  });

  it("④ C34 挤占优先级不变量真裁决：高 pri 被挤 21 天 > 上限 5 → BLOCK", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = data(await invokeSolver(t, "what_if_displacement", CONTEND));
    const rules = (out.evaluatedRules ?? []) as { key: string; outcome: string }[];
    expect(rules.find((r) => r.key === "C34")?.outcome).toBe("BLOCK");
    // C35：可行方案数≥2（delay+downgrade）→ 2<2 false → PASS。
    expect(rules.find((r) => r.key === "C35")?.outcome).toBe("PASS");
  });

  it("④ C34 PASS：仅低 pri 被挤（高 pri 未动）→ highPriDisplaceDays=0 → PASS", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // dailyDemand=70（qty 2940）→ 缺口 50 → unitsToFree=2100 → 仅低 pri A2(2100) 被挤，高 pri A1 未动。
    const out = data(await invokeSolver(t, "what_if_displacement", { ...CONTEND, qty: 2940 }));
    const disp = out.displacedOrders as { so: string; pri: string }[];
    expect(disp.map((d) => d.so)).toEqual(["A2"]);
    expect(out.highPriDisplaceDays).toBe(0);
    const rules = (out.evaluatedRules ?? []) as { key: string; outcome: string }[];
    expect(rules.find((r) => r.key === "C34")?.outcome).toBe("PASS");
  });

  it("⑤ 免挤占直接承接：自由产能足量 → feasibleWithoutDisplacement=true·空挤占清单", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = data(await invokeSolver(t, "what_if_displacement", {
      ...CONTEND,
      lines: [{ lineId: "L1", capacityDaily: 500, certifiedModels: ["MX", "MA"] }],
    }));
    expect(out.feasibleWithoutDisplacement).toBe(true);
    expect(out.displacedOrders as unknown[]).toHaveLength(0);
    expect(out.highPriDisplaceDays).toBe(0);
  });
});
