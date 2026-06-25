import { describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * 规则即引用 P3（H5 增量1）：扩 ruleEvalPayload 把 11 个高价值求解器的输出/输入映射成规则 expression
 * 期望字段，使 evaluatedRules 真出 PASS/WARN/BLOCK（不再全 NOT_APPLICABLE）。
 * 每条「真映射」断言含阈值边界翻转；「诚实边界」断言对口径不符的规则保持 NOT_APPLICABLE（红线 RL5 不伪造尺度）。
 * 字段口径见 service.ts ruleEvalPayload 各 else-if 注释 + battery.ts rules[] expression。
 */
type Rule = { key: string; outcome: string };
async function rules(t: TestApp, key: string, args: Record<string, unknown>): Promise<Rule[]> {
  const res = await invokeSolver(t, key, args);
  expect(res.statusCode).toBe(200);
  return (res.json().data.evaluatedRules ?? []) as Rule[];
}
const out = (rs: Rule[], key: string) => rs.find((r) => r.key === key)?.outcome;

/** 改一条已发布规则的 expression 并重新发布（新版本取代旧版），用于"改规则即改推演"翻转验证。 */
async function republish(t: TestApp, key: string, expression: string, severity: string, scope: string[]): Promise<void> {
  const created = await t.app.inject({ method: "POST", url: "/a/v1/rules", headers: ADMIN, payload: { key, name: key, expression, severity, scopeObjectTypes: scope } });
  const id = created.json().id as string;
  const pub = await t.app.inject({ method: "POST", url: `/a/v1/rules/${id}/publish`, headers: ADMIN, payload: {} });
  expect(pub.statusCode).toBe(200);
}

const PLAN_AUDIT_ARGS = { dem: 100, seg_pas: 40, seg_ess: 35, seg_com: 25, sup: 90, ltaCov: 0.9, kitGap: 5, gmTarget: 20, cashCushion: 30, capex: 12 };
const CERT_ARGS = {
  engineerGroups: 2,
  items: [
    { model: "M1", line: "L1", status: "认证中", certHours: 80, gapContribution: 10 },
    { model: "M2", line: "L2", status: "认证中", certHours: 40, gapContribution: 8 },
    { model: "M3", line: "L3", status: "认证中", certHours: 120, gapContribution: 6 },
  ],
};
const CAPEX_ARGS = { scenarioKey: "x", demand: [10, 12, 14, 16], s0: [8, 8, 8, 8], projects: [{ id: "P1", q0: 1, cap: 5, capex: [6, 0, 0, 0], m: 200 }] };

describe("规则即引用 P3 · 11 求解器 payload 映射真评估（H5 增量1）", () => {
  it("plan_audit C15/C16/C18/C21/C23 全部真评估（不再 NOT_APPLICABLE）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // gmTarget 20% > 结构毛利 gmStruct → C15 marginPct(gmStruct)<floorPct(20) → BLOCK；kitGap 5>0 → C16 WARN；
    // cashCushion 30<50 → C18 BLOCK；capex 12≥10 → C23 WARN。
    const rs = await rules(t, "plan_audit", PLAN_AUDIT_ARGS);
    for (const k of ["C15", "C16", "C18", "C21", "C23"]) expect(out(rs, k)).not.toBe("NOT_APPLICABLE");
    expect(out(rs, "C16")).toBe("WARN");
    expect(out(rs, "C18")).toBe("BLOCK");
    expect(out(rs, "C23")).toBe("WARN");
  });

  it("plan_audit C16 边界翻转：阈值改 >10 后同输入由 WARN → PASS（改规则即改推演）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect(out(await rules(t, "plan_audit", PLAN_AUDIT_ARGS), "C16")).toBe("WARN"); // kitGap 5 > 0
    await republish(t, "C16", "MaterialBalance.gapTon > 10", "WARN", ["MaterialBalance"]);
    expect(out(await rules(t, "plan_audit", PLAN_AUDIT_ARGS), "C16")).toBe("PASS"); // 5 ≤ 10
  });

  it("plan_audit C16 缺口=0 → PASS（边界另一侧）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const rs = await rules(t, "plan_audit", { ...PLAN_AUDIT_ARGS, kitGap: 0 });
    expect(out(rs, "C16")).toBe("PASS");
  });

  it("plan_generate C15/C18 真评估（推荐方案毛利/现金垫），C08 诚实 NOT_APPLICABLE", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const rs = await rules(t, "plan_generate", {});
    expect(out(rs, "C15")).not.toBe("NOT_APPLICABLE");
    expect(out(rs, "C18")).not.toBe("NOT_APPLICABLE");
    // plan_generate 不产出外协比率（路径名是策略标签非比率）→ 诚实 NOT_APPLICABLE
    expect(out(rs, "C08")).toBe("NOT_APPLICABLE");
  });

  it("plan_generate C18 边界翻转：现金垫底线改 >100 后由 PASS → BLOCK（base.cash≈58）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect(out(await rules(t, "plan_generate", {}), "C18")).toBe("PASS"); // cash ~58 ≥ 50 → 不违约
    await republish(t, "C18", "AnnualScenario.cashCushion < 100", "BLOCK", ["AnnualScenario"]);
    expect(out(await rules(t, "plan_generate", {}), "C18")).toBe("BLOCK"); // 58 < 100 → 违约
  });

  it("cert_schedule C26 真评估（并行任务数 vs 工程师组数），C04 诚实 NOT_APPLICABLE", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const rs = await rules(t, "cert_schedule", CERT_ARGS);
    // 贪心装箱守 ≤groups → parallelTasks ≤ engineerGroups → PASS（规则真评而非空过）
    expect(out(rs, "C26")).toBe("PASS");
    // C04 是产能聚合口径（Line.certStatus），排程器不产出 → 诚实 NOT_APPLICABLE
    expect(out(rs, "C04")).toBe("NOT_APPLICABLE");
  });

  it("cert_schedule C26 边界翻转：阈值改 >=1 后并行任务命中 → BLOCK", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect(out(await rules(t, "cert_schedule", CERT_ARGS), "C26")).toBe("PASS");
    await republish(t, "C26", "Cert.parallelTasks >= 1", "BLOCK", ["Cert"]);
    expect(out(await rules(t, "cert_schedule", CERT_ARGS), "C26")).toBe("BLOCK"); // 有排程 → parallelTasks≥1
  });

  it("outsourcing_split C08 真评估（外协分配/总需求），C31 诚实 NOT_APPLICABLE", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // gap=100,totalDemand=400 → 外协 cap=80, outsourceRatio=80/400=0.2 ≤ 0.3 → PASS
    const rs = await rules(t, "outsourcing_split", { gap: 100, totalDemand: 400 });
    expect(out(rs, "C08")).toBe("PASS");
    // C31 良率数据不在分配求解输入/输出 → 诚实 NOT_APPLICABLE
    expect(out(rs, "C31")).toBe("NOT_APPLICABLE");
  });

  it("outsourcing_split C08 边界翻转：阈值改 >0.1 后由 PASS → WARN（0.2>0.1）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const args = { gap: 100, totalDemand: 400 };
    expect(out(await rules(t, "outsourcing_split", args), "C08")).toBe("PASS");
    await republish(t, "C08", "Order.outsourceRatio > 0.1", "WARN", ["Order"]);
    expect(out(await rules(t, "outsourcing_split", args), "C08")).toBe("WARN");
  });

  it("capex_scenario C23 真评估（总 CAPEX vs 门槛），C18 诚实 NOT_APPLICABLE", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 总 capex=6 < 10 → C23 PASS
    const rs = await rules(t, "capex_scenario", CAPEX_ARGS);
    expect(out(rs, "C23")).toBe("PASS");
    // capex_scenario 不产出企业级现金垫 → C18 诚实 NOT_APPLICABLE
    expect(out(rs, "C18")).toBe("NOT_APPLICABLE");
  });

  it("capex_scenario C23 边界翻转：阈值改 >=5 后总 capex=6 命中 → WARN", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect(out(await rules(t, "capex_scenario", CAPEX_ARGS), "C23")).toBe("PASS");
    await republish(t, "C23", "AnnualScenario.capex >= 5", "WARN", ["AnnualScenario"]);
    expect(out(await rules(t, "capex_scenario", CAPEX_ARGS), "C23")).toBe("WARN");
  });

  it("capex_scenario C23 大额 CAPEX 命中：总 capex≥10 → WARN（同尺度真评）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const big = { ...CAPEX_ARGS, projects: [{ id: "P1", q0: 1, cap: 5, capex: [12, 0, 0, 0], m: 200 }] };
    expect(out(await rules(t, "capex_scenario", big), "C23")).toBe("WARN");
  });

  it("诚实边界：口径不符的 6 求解器规则全部 NOT_APPLICABLE（不伪造尺度凑 PASS · 红线 RL5）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // risk_timeline C06/C11：张力曲线求解器不算物料缺口/检修缓冲
    const risk = await rules(t, "risk_timeline", { horizon: 30 });
    for (const k of ["C06", "C11"]) expect(out(risk, k)).toBe("NOT_APPLICABLE");
    // affected_orders C05：波及订单投影器不产出产线利用率时序
    const aff = await rules(t, "affected_orders", { baseId: "常州" });
    expect(out(aff, "C05")).toBe("NOT_APPLICABLE");
    // maintenance_stagger C11：周负荷空间错峰，不建模 bufferDays
    const ms = await rules(t, "maintenance_stagger", { peakWeeks: [10, 11], bases: [{ base: "B1", group: "g", maintWeek: 10, loadByWeek: { "8": 5, "9": 3, "12": 2 } }] });
    expect(out(ms, "C11")).toBe("NOT_APPLICABLE");
    // mitigation_select C08/C10：方案推荐器，不算外协比率/Action 审批
    const mit = await rules(t, "mitigation_select", { factor: "瓶颈工序", baseName: "常州", tightness: 92 });
    for (const k of ["C08", "C10"]) expect(out(mit, k)).toBe("NOT_APPLICABLE");
    // quarterly_gap C08/C29：缺口贪心覆盖器，无外协比率/订单开工日
    const qg = await rules(t, "quarterly_gap", { quarter: "Q3", gap: 50, options: [{ key: "outsource", name: "外协", release: 20, costRank: 2 }] });
    for (const k of ["C08", "C29"]) expect(out(qg, k)).toBe("NOT_APPLICABLE");
    // yield_diagnosis C30：2σ 统计突变法，不产出逐日 dailyYield/yieldFloor（SUSTAIN 口径不成立）
    const yd = await rules(t, "yield_diagnosis", { series: Array.from({ length: 50 }, (_, i) => ({ day: i, yield: i < 35 ? 0.95 : 0.88 })), events: [{ day: 36, kind: "换料", source: "S1" }] });
    expect(out(yd, "C30")).toBe("NOT_APPLICABLE");
  });
});
