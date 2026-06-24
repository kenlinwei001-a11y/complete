import { describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * 规则即引用 P3-b：扩 ruleEvalPayload —— 为高价值求解器把输出/上下文映射成规则 expression 期望字段，
 * 使 evaluatedRules 真出 PASS/WARN/BLOCK（不再全 NOT_APPLICABLE）。每条断言含阈值边界翻转。
 * 字段口径见 service.ts ruleEvalPayload 注释 + battery.ts rules[] expression。
 */
type Rule = { key: string; outcome: string };
async function rules(t: TestApp, key: string, args: Record<string, unknown>): Promise<Rule[]> {
  const res = await invokeSolver(t, key, args);
  expect(res.statusCode).toBe(200);
  return (res.json().data.evaluatedRules ?? []) as Rule[];
}
const out = (rs: Rule[], key: string) => rs.find((r) => r.key === key)?.outcome;

describe("规则即引用 P3-b · 求解器输出→规则 payload 映射真评估", () => {
  it("quote_margin C15/C24：毛利率 < 底线 → BLOCK；高于底线 → PASS（比率口径，边界翻转）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // margin=(100-50-10-5)/100=0.35 ≥ floor 0.10 → PASS
    const pass = await rules(t, "quote_margin", { price: 100, bom: [{ unit: 1, spotPrice: 40, processRate: 0.25 }], mfgRate: 0.1, logistics: 5, segmentFloor: 0.1 });
    expect(out(pass, "C15")).toBe("PASS");
    expect(out(pass, "C24")).toBe("PASS");
    // margin=(100-50-40-5)/100=0.05 < floor 0.10 → BLOCK
    const block = await rules(t, "quote_margin", { price: 100, bom: [{ unit: 1, spotPrice: 40, processRate: 0.25 }], mfgRate: 0.4, logistics: 5, segmentFloor: 0.1 });
    expect(out(block, "C15")).toBe("BLOCK");
    expect(out(block, "C24")).toBe("BLOCK");
  });

  it("credit_exposure C13/C32：creditUsedRatio>1 BLOCK & 逾期>30天 BLOCK；边界翻转", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // exposure=30+20=50, limit=100 → ratio 0.5 ≤1 PASS；无逾期 → C32 PASS
    const ok = await rules(t, "credit_exposure", { creditLimit: 100, receivables: 30, wipUnbilled: 20, overdue: [] });
    expect(out(ok, "C13")).toBe("PASS");
    expect(out(ok, "C32")).toBe("PASS");
    // exposure=80+40=120 > limit 100 → ratio 1.2 >1 BLOCK；逾期 38>30 → C32 BLOCK
    const bad = await rules(t, "credit_exposure", { creditLimit: 100, receivables: 80, wipUnbilled: 40, overdue: [{ invoiceId: "x", overdueDays: 38, amount: 5 }] });
    expect(out(bad, "C13")).toBe("BLOCK");
    expect(out(bad, "C32")).toBe("BLOCK");
  });

  it("carbon_footprint C33：目的地EU且碳足迹超阈 → BLOCK；非EU或达标 → PASS（IMPLIES）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const m = [{ material: "正极", unit: 1, factor: 50 }];
    const p = [{ process: "涂布", energy: 2, gridFactor: 15 }]; // total=50+30=80
    // EU + 80 > 阈值 70 → 违约束 → BLOCK
    const eu = await rules(t, "carbon_footprint", { modelId: "M", baseName: "成都", materials: m, processes: p, euThreshold: 70, destination: "EU" });
    expect(out(eu, "C33")).toBe("BLOCK");
    // 非 EU 目的地 → 无碳护照门 → PASS
    const cn = await rules(t, "carbon_footprint", { modelId: "M", baseName: "成都", materials: m, processes: p, euThreshold: 70, destination: "CN" });
    expect(out(cn, "C33")).toBe("PASS");
    // EU 但达标（阈值抬到 100 ≥ 80）→ PASS（边界翻转）
    const euOk = await rules(t, "carbon_footprint", { modelId: "M", baseName: "成都", materials: m, processes: p, euThreshold: 100, destination: "EU" });
    expect(out(euOk, "C33")).toBe("PASS");
  });

  it("kit_readiness C06/C16：存在物料缺口 → WARN；齐套 → PASS", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // M2 缺口：need=10×1=10, avail=2（在途 etaDay9 > startDay5 不计）→ shortage 8 >0 → WARN
    const short = await rules(t, "kit_readiness", { orders: [{ orderId: "O1", qty: 10, startDay: 5, materials: [{ material: "M2", onHand: 2, inTransit: [{ qty: 100, etaDay: 9 }], bomUnit: 1 }] }] });
    expect(out(short, "C06")).toBe("WARN");
    expect(out(short, "C16")).toBe("WARN");
    // 现库充足 → 无缺口 → PASS
    const full = await rules(t, "kit_readiness", { orders: [{ orderId: "O1", qty: 10, startDay: 5, materials: [{ material: "M1", onHand: 100, inTransit: [], bomUnit: 1 }] }] });
    expect(out(full, "C06")).toBe("PASS");
    expect(out(full, "C16")).toBe("PASS");
  });

  it("lta_gap C16：现货缺口>0 → WARN；长协覆盖足额 → PASS", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // netDemand=100×1-0-0=100, ltaAvail=0 → gap 100 >0 → WARN
    const gap = await rules(t, "lta_gap", { material: "三元正极", month: "2026-07", monthDemand: 100, bomUnit: 1, inventory: 0, inTransit: 0, ltaAnnualLock: 0, monthQuota: 0, executedThisMonth: 0 });
    expect(out(gap, "C16")).toBe("WARN");
    // 库存覆盖全部 → netDemand≤0 → gap 0 → PASS
    const cov = await rules(t, "lta_gap", { material: "三元正极", month: "2026-07", monthDemand: 100, bomUnit: 1, inventory: 200, inTransit: 0, ltaAnnualLock: 0, monthQuota: 0, executedThisMonth: 0 });
    expect(out(cov, "C16")).toBe("PASS");
  });

  it("inventory_optimize C16：欠储 underQty>0 → WARN；水位充足 → PASS", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // target=10×(5+5)=100; under=0.8×100-10=70 >0 → WARN
    const under = await rules(t, "inventory_optimize", { safetyDays: 5, materials: [{ matId: "M1", dailyUse: 10, leadTime: 5, onHand: 10, unitPrice: 1, idleDays: 0 }] });
    expect(out(under, "C16")).toBe("WARN");
    // onHand 充足（≥0.8×target）→ 无欠储 → PASS
    const ok = await rules(t, "inventory_optimize", { safetyDays: 5, materials: [{ matId: "M1", dailyUse: 10, leadTime: 5, onHand: 90, unitPrice: 1, idleDays: 0 }] });
    expect(out(ok, "C16")).toBe("PASS");
  });

  it("changeover_sequence C22：单步换型>120 → WARN；皆≤120 → PASS（边界翻转）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // A→B=150 >120 → WARN（current=A，单订单 B）
    const slow = await rules(t, "changeover_sequence", { lineId: "L1", current: "A", orders: [{ orderId: "o1", modelId: "B", dueDay: 1 }], matrix: { A: { B: 150 } } });
    expect(out(slow, "C22")).toBe("WARN");
    // A→B=90 ≤120 → PASS
    const fast = await rules(t, "changeover_sequence", { lineId: "L1", current: "A", orders: [{ orderId: "o1", modelId: "B", dueDay: 1 }], matrix: { A: { B: 90 } } });
    expect(out(fast, "C22")).toBe("PASS");
  });

  it("诚实边界：无法映射口径的规则仍落 NOT_APPLICABLE（不冒充 PASS）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // changeover_sequence 的 C29 = Order.daysToStart<3，求解器输出无 daysToStart → NOT_APPLICABLE
    const rs = await rules(t, "changeover_sequence", { lineId: "L1", current: "A", orders: [{ orderId: "o1", modelId: "B", dueDay: 1 }], matrix: { A: { B: 90 } } });
    expect(out(rs, "C29")).toBe("NOT_APPLICABLE");
    // lta_gap 的 C27 = Lta.deviationPct>0.05，输出无 deviationPct → NOT_APPLICABLE
    const lt = await rules(t, "lta_gap", { material: "三元正极", month: "2026-07", monthDemand: 100, bomUnit: 1, inventory: 0, inTransit: 0, ltaAnnualLock: 0, monthQuota: 0, executedThisMonth: 0 });
    expect(out(lt, "C27")).toBe("NOT_APPLICABLE");
  });
});
