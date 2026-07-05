import { describe, expect, it } from "vitest";
import { ADMIN, PLANNER, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * QUERY30 缺口② C34–C50（DESIGN-query30 §2.3 · 17 条跨切片多跳推演约束）真接 evaluate_rules。
 * 每条：① 触发/不触发用例对（measured 命名空间经真求解器 evaluateRuleRefs 出 PASS/WARN/BLOCK）；
 * ② params 改值生效齿（republish 改 rule.params 阈值 → 同输入行为翻转，改 param 即改裁决）。
 * C42/C45/C50 另测 S2 审批链（ActionType.checkRules → submit 预检 BLOCK 短路）。
 * 灭"卡面挂名"：规则真进求解器结论，不是只挂在 SOLVER_RULE_REFS 标签。
 */
type Rule = { key: string; outcome: string };
async function rules(t: TestApp, solverKey: string, args: Record<string, unknown>): Promise<Rule[]> {
  const res = await invokeSolver(t, solverKey, args);
  expect(res.statusCode).toBe(200);
  return (res.json().data.evaluatedRules ?? []) as Rule[];
}
const out = (rs: Rule[], key: string) => rs.find((r) => r.key === key)?.outcome;

/** 改一条已发布规则的 params（保持 expression/severity）并发布新版 → 求解器读新阈值。 */
async function republishParams(t: TestApp, key: string, name: string, expression: string, severity: string, scope: string[], params: Record<string, number>): Promise<void> {
  const created = await t.app.inject({ method: "POST", url: "/a/v1/rules", headers: ADMIN, payload: { key, name, expression, severity, scopeObjectTypes: scope, params } });
  const id = created.json().id as string;
  const pub = await t.app.inject({ method: "POST", url: `/a/v1/rules/${id}/publish`, headers: ADMIN, payload: {} });
  expect(pub.statusCode).toBe(200);
}

// [ruleKey, solverKey, name, expression, severity, scope, defaultThreshold(param name→val),
//  triggerArgs, expectViolate, noTriggerArgs]
const CERT_BASE = { engineerGroups: 3, items: [{ model: "M1", line: "L1", status: "认证中", certHours: 40, gapContribution: 5 }] };
const CHG_BASE = { lineId: "L1", current: "A", orders: [{ orderId: "o1", modelId: "B", dueDay: 1 }], matrix: { A: { B: 90 } } };
const QG_BASE = { quarter: "Q3", gap: 50, options: [{ key: "outsource", name: "外协", release: 20, costRank: 2 }] };
const MS_BASE = { peakWeeks: [10, 11], bases: [{ base: "B1", group: "g", maintWeek: 10, loadByWeek: { "8": 5, "9": 3, "12": 2 } }] };
const YD_BASE = { series: Array.from({ length: 50 }, (_, i) => ({ day: i, yield: i < 35 ? 0.95 : 0.88 })), events: [{ day: 36, kind: "换料", source: "S1" }] };

describe("QUERY30 缺口② C34–C50 · 触发/不触发对 + params 改值生效齿（真接 evaluate_rules）", () => {
  it("C34 挤占优先级不变量 → BLOCK（affected_orders·被挤天数超上限）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect(out(await rules(t, "affected_orders", { baseId: "常州", Displace: { highPriDisplaceDays: 8 } }), "C34")).toBe("BLOCK");
    expect(out(await rules(t, "affected_orders", { baseId: "常州", Displace: { highPriDisplaceDays: 3 } }), "C34")).toBe("PASS");
    // param 齿：上限抬到 10 → 同 8 天不再违规
    await republishParams(t, "C34", "挤占优先级不变量", "Displace.highPriDisplaceDays > maxDisplaceDays", "BLOCK", ["Order"], { maxDisplaceDays: 10 });
    expect(out(await rules(t, "affected_orders", { baseId: "常州", Displace: { highPriDisplaceDays: 8 } }), "C34")).toBe("PASS");
  });

  it("C35 重大变更须≥2方案（plan_generate·方案数下限·param 齿翻转）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 求解器真产出 3 方案，默认 minSchemes=2 → 3<2 false → PASS
    expect(out(await rules(t, "plan_generate", {}), "C35")).toBe("PASS");
    // param 齿：minSchemes 抬到 5 → 3<5 → BLOCK（触发）
    await republishParams(t, "C35", "重大变更须≥2方案", "PlanSet.schemeCount < minSchemes", "BLOCK", ["Order"], { minSchemes: 5 });
    expect(out(await rules(t, "plan_generate", {}), "C35")).toBe("BLOCK");
  });

  it("C36 锁价期现金敞口上限 → BLOCK（credit_exposure）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = { creditLimit: 100, receivables: 10, wipUnbilled: 5, overdue: [] };
    expect(out(await rules(t, "credit_exposure", { ...base, LockedPrice: { cashExposure: 300 } }), "C36")).toBe("BLOCK");
    expect(out(await rules(t, "credit_exposure", { ...base, LockedPrice: { cashExposure: 100 } }), "C36")).toBe("PASS");
    await republishParams(t, "C36", "锁价期现金敞口上限", "LockedPrice.cashExposure > maxLockedExposure", "BLOCK", ["Order"], { maxLockedExposure: 500 });
    expect(out(await rules(t, "credit_exposure", { ...base, LockedPrice: { cashExposure: 300 } }), "C36")).toBe("PASS");
  });

  it("C37 违约金/毛利权衡线 → BLOCK（affected_orders·净增益<0）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect(out(await rules(t, "affected_orders", { baseId: "常州", Tradeoff: { incrementalMargin: 10, penaltyTotal: 30 } }), "C37")).toBe("BLOCK");
    expect(out(await rules(t, "affected_orders", { baseId: "常州", Tradeoff: { incrementalMargin: 50, penaltyTotal: 10 } }), "C37")).toBe("PASS");
    // param 齿：minNetGain 降到 -100 → 净增益 -20 ≥ -100 → 不违规
    await republishParams(t, "C37", "违约金/毛利权衡线", "Tradeoff.netGain < minNetGain", "BLOCK", ["Order"], { minNetGain: -100 });
    expect(out(await rules(t, "affected_orders", { baseId: "常州", Tradeoff: { incrementalMargin: 10, penaltyTotal: 30 } }), "C37")).toBe("PASS");
  });

  it("C38 供应商集中度红线 → WARN（lta_gap）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect(out(await rules(t, "lta_gap", { Supplier: { concentrationPct: 0.7 } }), "C38")).toBe("WARN");
    expect(out(await rules(t, "lta_gap", { Supplier: { concentrationPct: 0.5 } }), "C38")).toBe("PASS");
    await republishParams(t, "C38", "供应商集中度红线", "Supplier.concentrationPct > concentrationRedline", "WARN", ["Supplier"], { concentrationRedline: 0.8 });
    expect(out(await rules(t, "lta_gap", { Supplier: { concentrationPct: 0.7 } }), "C38")).toBe("PASS");
  });

  it("C39 连败批次自动隔离 → BLOCK（yield_diagnosis·连败≥3）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect(out(await rules(t, "yield_diagnosis", { ...YD_BASE, LabTest: { consecutiveFails: 3 } }), "C39")).toBe("BLOCK");
    expect(out(await rules(t, "yield_diagnosis", { ...YD_BASE, LabTest: { consecutiveFails: 1 } }), "C39")).toBe("PASS");
    await republishParams(t, "C39", "连败批次自动隔离", "LabTest.consecutiveFails > maxConsecutiveFails", "BLOCK", ["LabTest"], { maxConsecutiveFails: 5 });
    expect(out(await rules(t, "yield_diagnosis", { ...YD_BASE, LabTest: { consecutiveFails: 3 } }), "C39")).toBe("PASS");
  });

  it("C40 检修逾期设备禁排产 → BLOCK（maintenance_stagger）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect(out(await rules(t, "maintenance_stagger", { ...MS_BASE, Maint: { overdueDays: 5 } }), "C40")).toBe("BLOCK");
    expect(out(await rules(t, "maintenance_stagger", { ...MS_BASE, Maint: { overdueDays: 0 } }), "C40")).toBe("PASS");
    await republishParams(t, "C40", "检修逾期设备禁排产", "Maint.overdueDays > maxOverdueDays", "BLOCK", ["MaintPlan"], { maxOverdueDays: 7 });
    expect(out(await rules(t, "maintenance_stagger", { ...MS_BASE, Maint: { overdueDays: 5 } }), "C40")).toBe("PASS");
  });

  it("C41 加班时长合规上限 → WARN（outsourcing_split）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = { gap: 100, totalDemand: 400 };
    expect(out(await rules(t, "outsourcing_split", { ...base, Labor: { overtimeHours: 48 } }), "C41")).toBe("WARN");
    expect(out(await rules(t, "outsourcing_split", { ...base, Labor: { overtimeHours: 20 } }), "C41")).toBe("PASS");
    await republishParams(t, "C41", "加班时长合规上限", "Labor.overtimeHours > overtimeCapHours", "WARN", ["LaborShift"], { overtimeCapHours: 60 });
    expect(out(await rules(t, "outsourcing_split", { ...base, Labor: { overtimeHours: 48 } }), "C41")).toBe("PASS");
  });

  it("C42 信用上调审批链 → BLOCK（credit_exposure·超阈）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = { creditLimit: 100, receivables: 10, wipUnbilled: 5, overdue: [] };
    expect(out(await rules(t, "credit_exposure", { ...base, CreditUplift: { upliftPct: 0.2 } }), "C42")).toBe("BLOCK");
    expect(out(await rules(t, "credit_exposure", { ...base, CreditUplift: { upliftPct: 0.05 } }), "C42")).toBe("PASS");
    await republishParams(t, "C42", "信用上调审批链", "CreditUplift.upliftPct > approvalThresholdPct", "BLOCK", ["Customer"], { approvalThresholdPct: 0.3 });
    expect(out(await rules(t, "credit_exposure", { ...base, CreditUplift: { upliftPct: 0.2 } }), "C42")).toBe("PASS");
  });

  it("C43 认证外包质量等效门 → BLOCK（cert_schedule·等效分不足）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect(out(await rules(t, "cert_schedule", { ...CERT_BASE, CertOutsource: { equivalenceScore: 0.8 } }), "C43")).toBe("BLOCK");
    expect(out(await rules(t, "cert_schedule", { ...CERT_BASE, CertOutsource: { equivalenceScore: 0.95 } }), "C43")).toBe("PASS");
    await republishParams(t, "C43", "认证外包质量等效门", "CertOutsource.equivalenceScore < minEquivalence", "BLOCK", ["Certification"], { minEquivalence: 0.7 });
    expect(out(await rules(t, "cert_schedule", { ...CERT_BASE, CertOutsource: { equivalenceScore: 0.8 } }), "C43")).toBe("PASS");
  });

  it("C44 谷段迁移不破交期 → WARN（changeover_sequence）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect(out(await rules(t, "changeover_sequence", { ...CHG_BASE, OffPeak: { deliverySlipDays: 2 } }), "C44")).toBe("WARN");
    expect(out(await rules(t, "changeover_sequence", { ...CHG_BASE, OffPeak: { deliverySlipDays: 0 } }), "C44")).toBe("PASS");
    await republishParams(t, "C44", "谷段迁移不破交期", "OffPeak.deliverySlipDays > maxSlipDays", "WARN", ["EnergyMeter"], { maxSlipDays: 3 });
    expect(out(await rules(t, "changeover_sequence", { ...CHG_BASE, OffPeak: { deliverySlipDays: 2 } }), "C44")).toBe("PASS");
  });

  it("C45 自动对策仅生成草稿 → BLOCK（mitigation_select·自动执行数>0）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = { factor: "瓶颈工序", baseName: "常州", tightness: 92 };
    expect(out(await rules(t, "mitigation_select", { ...base, AutoAction: { autoExecutedCount: 1 } }), "C45")).toBe("BLOCK");
    expect(out(await rules(t, "mitigation_select", { ...base, AutoAction: { autoExecutedCount: 0 } }), "C45")).toBe("PASS");
    await republishParams(t, "C45", "自动对策仅生成草稿", "AutoAction.autoExecutedCount > maxAutoExecute", "BLOCK", ["ScenarioTrigger"], { maxAutoExecute: 2 });
    expect(out(await rules(t, "mitigation_select", { ...base, AutoAction: { autoExecutedCount: 1 } }), "C45")).toBe("PASS");
  });

  it("C46 SOP final 版锁定 → BLOCK（plan_audit·final 后改动）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = { dem: 100, seg_pas: 40, seg_ess: 35, seg_com: 25, sup: 90, ltaCov: 0.9, kitGap: 5, gmTarget: 20, cashCushion: 30, capex: 12 };
    expect(out(await rules(t, "plan_audit", { ...base, Sop: { postFinalEdits: 1 } }), "C46")).toBe("BLOCK");
    expect(out(await rules(t, "plan_audit", { ...base, Sop: { postFinalEdits: 0 } }), "C46")).toBe("PASS");
    await republishParams(t, "C46", "SOP final 版锁定", "Sop.postFinalEdits > maxPostFinalEdits", "BLOCK", ["SopVersionRow"], { maxPostFinalEdits: 3 });
    expect(out(await rules(t, "plan_audit", { ...base, Sop: { postFinalEdits: 1 } }), "C46")).toBe("PASS");
  });

  it("C47 跨期方案多期联检 → WARN（quarterly_gap·下期偏差超容差）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect(out(await rules(t, "quarterly_gap", { ...QG_BASE, CrossPeriod: { nextPeriodDeviationPct: 0.15 } }), "C47")).toBe("WARN");
    expect(out(await rules(t, "quarterly_gap", { ...QG_BASE, CrossPeriod: { nextPeriodDeviationPct: 0.05 } }), "C47")).toBe("PASS");
    await republishParams(t, "C47", "跨期方案多期联检", "CrossPeriod.nextPeriodDeviationPct > maxCarryDeviation", "WARN", ["PlanTarget"], { maxCarryDeviation: 0.2 });
    expect(out(await rules(t, "quarterly_gap", { ...QG_BASE, CrossPeriod: { nextPeriodDeviationPct: 0.15 } }), "C47")).toBe("PASS");
  });

  it("C48 复线观察期重停 → BLOCK（yield_diagnosis·观察期重破线）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect(out(await rules(t, "yield_diagnosis", { ...YD_BASE, Observe: { rebreaks: 1 } }), "C48")).toBe("BLOCK");
    expect(out(await rules(t, "yield_diagnosis", { ...YD_BASE, Observe: { rebreaks: 0 } }), "C48")).toBe("PASS");
    await republishParams(t, "C48", "复线观察期重停", "Observe.rebreaks > maxRebreaks", "BLOCK", ["Process"], { maxRebreaks: 1 });
    expect(out(await rules(t, "yield_diagnosis", { ...YD_BASE, Observe: { rebreaks: 1 } }), "C48")).toBe("PASS");
  });

  it("C49 断料停线损失口径统一 → WARN（affected_orders·口径方差超限）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect(out(await rules(t, "affected_orders", { baseId: "常州", StopLoss: { caliberVariancePct: 0.08 } }), "C49")).toBe("WARN");
    expect(out(await rules(t, "affected_orders", { baseId: "常州", StopLoss: { caliberVariancePct: 0.02 } }), "C49")).toBe("PASS");
    await republishParams(t, "C49", "断料停线损失口径统一", "StopLoss.caliberVariancePct > maxCaliberVariance", "WARN", ["Shipment"], { maxCaliberVariance: 0.1 });
    expect(out(await rules(t, "affected_orders", { baseId: "常州", StopLoss: { caliberVariancePct: 0.08 } }), "C49")).toBe("PASS");
  });

  it("C50 降级期高危动作双签 → BLOCK（capacity_forecast·未双签高危动作）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = { modelId: "4680-NCM", demandDelta: 0.1 };
    expect(out(await rules(t, "capacity_forecast", { ...base, Degrade: { unsignedHighRiskActions: 1 } }), "C50")).toBe("BLOCK");
    expect(out(await rules(t, "capacity_forecast", { ...base, Degrade: { unsignedHighRiskActions: 0 } }), "C50")).toBe("PASS");
    await republishParams(t, "C50", "降级期高危动作双签", "Degrade.unsignedHighRiskActions > maxUnsigned", "BLOCK", ["DataSourceHealth"], { maxUnsigned: 2 });
    expect(out(await rules(t, "capacity_forecast", { ...base, Degrade: { unsignedHighRiskActions: 1 } }), "C50")).toBe("PASS");
  });

  it("诚实边界：measured 命名空间不在场 → NOT_APPLICABLE（不冒充 PASS·RL5）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 不传任何 QUERY30 命名空间 → C34/C37/C49 全 NOT_APPLICABLE（affected_orders）
    const aff = await rules(t, "affected_orders", { baseId: "常州" });
    for (const k of ["C34", "C37", "C49"]) expect(out(aff, k)).toBe("NOT_APPLICABLE");
    // credit_exposure 不传 LockedPrice/CreditUplift → C36/C42 NOT_APPLICABLE，且既有 C13/C32 不受影响
    const cr = await rules(t, "credit_exposure", { creditLimit: 100, receivables: 10, wipUnbilled: 5, overdue: [] });
    expect(out(cr, "C36")).toBe("NOT_APPLICABLE");
    expect(out(cr, "C42")).toBe("NOT_APPLICABLE");
    expect(out(cr, "C13")).toBe("PASS");
    expect(out(cr, "C32")).toBe("PASS");
  });
});

describe("QUERY30 缺口② C42/C45/C50 · S2 审批链 checkRules（submit 预检 BLOCK 短路）", () => {
  async function submitAction(t: TestApp, actionTypeKey: string, payload: Record<string, unknown>) {
    return t.app.inject({ method: "POST", url: "/a/v1/action-drafts", headers: PLANNER, payload: { actionTypeKey, payload } });
  }

  it("C42 信用额度上调：超阈 payload → submit 预检 BLOCK（拒）；阈内 → 过预检", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const blocked = await submitAction(t, "信用额度上调", { customerId: "E", CreditUplift: { upliftPct: 0.2 } });
    expect(blocked.statusCode).toBe(400);
    expect(JSON.stringify(blocked.json())).toContain("规则预检");
    const ok = await submitAction(t, "信用额度上调", { customerId: "E", CreditUplift: { upliftPct: 0.05 } });
    expect(ok.statusCode).toBeLessThan(300); // 过 C42 预检 → 进审批链
  });

  it("C45 执行自动对策：autoExecutedCount>0 → submit BLOCK；=0 → 过预检", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const blocked = await submitAction(t, "执行自动对策", { triggerId: "T1", AutoAction: { autoExecutedCount: 1 } });
    expect(blocked.statusCode).toBe(400);
    const ok = await submitAction(t, "执行自动对策", { triggerId: "T1", AutoAction: { autoExecutedCount: 0 } });
    expect(ok.statusCode).toBeLessThan(300);
  });

  it("C50 降级期高危决策：未双签 → submit BLOCK；已双签(0) → 过预检", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const blocked = await submitAction(t, "降级期高危决策", { decisionRef: "D1", Degrade: { unsignedHighRiskActions: 1 } });
    expect(blocked.statusCode).toBe(400);
    const ok = await submitAction(t, "降级期高危决策", { decisionRef: "D1", Degrade: { unsignedHighRiskActions: 0 } });
    expect(ok.statusCode).toBeLessThan(300);
  });
});
