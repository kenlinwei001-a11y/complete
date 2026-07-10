import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, debugUser, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import type {
  OptimizerClient,
  OptimizationRequest,
  OptimizationResult,
  SequencingRequest,
  SequencingResult,
  MinCostFlowRequest,
  MinCostFlowResult,
} from "../src/solvers/optimizer-client.js";

/**
 * Q30-P3 求解器横铺 B（新域·中成本·DESIGN-query30 §1 P3 行）确定性单测。
 *
 * 3 新域（真读 SEED 对象派生·零合成/兜底冒充）：
 *  · cash_projection      — 现金流投影（FinanceAccount 期初现金 + Order 营收/交期/毛利 + Customer 账期）。
 *  · labor_balance        — 人力平衡（LaborShift 编制/班次 + Order 派线需求）。
 *  · energy_cost_schedule — 能耗成本排程（EnergyMeter 单耗/电网因子 + Order 需求；SEED 无 TOU 电价→诚实空缺）。
 * 2 复用类（真调子求解器·非借名魔数·结果随子解变而变）：
 *  · reroute_decision          — 复用 min_cost_flow（真调 CP-SAT·arc 成本=真 ChangeoverMatrix 换型分钟）。
 *  · multi_constraint_schedule — 复用 sequencing_optimize + cert_schedule + changeover_sequence（三约束联解·真调各子解）。
 *
 * 齿：I/O 契约（输出形状字段全在场）+ R6 确定性 + 诚实空态（真无数据→空+dataMode 非 LIVE）+ 复用类证真调（值取自子解真值）。
 */

const data = (res: { json: () => unknown }) => (res.json() as { data: Record<string, unknown> }).data;
/**
 * 求解器实测/估算维（confidence.measurement·LIVE/PARTIAL）——在合成种子世界里 top-line dataMode 会被正交的
 * 真实↔合成维盖成 SYNTHETIC（demo viaModelingChain 全合成·诚实），故断言求解器自报的 measurement 子维（读真对象=LIVE·
 * 含估算参数=PARTIAL）而非被 provenance 覆盖后的头条。无 confidence（空态未叠加）时回退 dataMode。
 */
const measure = (out: Record<string, unknown>): string =>
  (out.confidence as { measurement?: string } | undefined)?.measurement ?? String(out.dataMode);
const ADMIN_CTX: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
const EMPTY = debugUser("emptytenant", "admin", "admin"); // 无任何对象的租户 → 诚实空态

/** MockOptimizer：捕获子求解器请求 + 回放已知最优（证真调——datacore 侧「组请求→映射子解结果」接线对·非魔数常数）。 */
class MockOpt implements OptimizerClient {
  lastFlow?: MinCostFlowRequest;
  lastSeq?: SequencingRequest;
  constructor(private flowObjective = 12345, private seqObjective = 4242) {}
  async solve(_req: OptimizationRequest): Promise<OptimizationResult> {
    return { status: "INFEASIBLE", optimal: false, selected: [], totalValue: 0, totalWeight: 0 };
  }
  async solveMinCostFlow(req: MinCostFlowRequest): Promise<MinCostFlowResult> {
    this.lastFlow = req;
    return { status: "OPTIMAL", optimal: true, flows: req.arcs.filter((a) => a.from === "SRC").map((a) => ({ from: a.from, to: a.to, flow: a.cap ?? 0 })), objective: this.flowObjective };
  }
  async solveSequencing(req: SequencingRequest): Promise<SequencingResult> {
    this.lastSeq = req;
    return { status: "OPTIMAL", optimal: true, sequence: req.jobs.map((j) => j.id), changeovers: 7, objective: this.seqObjective };
  }
}

// ============ 3 新域 ============

describe("Q30-P3 cash_projection（新域·真读订单/回款/占用推现金曲线）", () => {
  it("I/O 契约：现金曲线 + 安全垫最低点字段全在场", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "cash_projection", { horizonWeeks: 13 });
    expect(res.statusCode).toBe(200);
    const out = data(res);
    for (const f of ["horizonWeeks", "openingCashWan", "weeks", "minCashWan", "minCashWeek", "totalInflowWan", "totalOutflowWan", "orderCount", "baseCount", "summary"]) {
      expect(out, `缺字段 ${f}`).toHaveProperty(f);
    }
    expect(out.horizonWeeks).toBe(13);
    expect(Array.isArray(out.weeks)).toBe(true);
    expect((out.weeks as unknown[]).length).toBe(13);
    // 真读对象 → 期初现金 > 0（12 基地 FinanceAccount.cashOnHand 合计·非 0 兜底）。
    expect(out.openingCashWan as number).toBeGreaterThan(0);
    expect(out.baseCount as number).toBeGreaterThan(0);
    expect(measure(out)).toBe("LIVE");
  });

  it("现金曲线自洽：逐周期末现金 = 期初 + 净现金累积（真算术·非随机）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = data(await invokeSolver(t, "cash_projection", { horizonWeeks: 8 }));
    const weeks = out.weeks as { inflowWan: number; outflowWan: number; netWan: number; endingCashWan: number }[];
    let running = out.openingCashWan as number;
    for (const w of weeks) {
      expect(w.netWan).toBeCloseTo(Math.round((w.inflowWan - w.outflowWan) * 100) / 100, 5);
      running = Math.round((running + w.netWan) * 100) / 100;
      expect(w.endingCashWan).toBeCloseTo(running, 4);
    }
    // 安全垫 = 曲线最低点。
    const minEnding = Math.min(out.openingCashWan as number, ...weeks.map((w) => w.endingCashWan));
    expect(out.minCashWan as number).toBeCloseTo(minEnding, 4);
  });

  it("R6 确定性：同 seed 重跑字节一致", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const a = data(await invokeSolver(t, "cash_projection", { horizonWeeks: 13 }));
    const b = data(await invokeSolver(t, "cash_projection", { horizonWeeks: 13 }));
    expect(JSON.stringify(a.weeks)).toBe(JSON.stringify(b.weeks));
    expect(a.minCashWan).toBe(b.minCashWan);
    expect(a.summary).toBe(b.summary);
  });

  it("诚实空态：无对象租户 → 期初 0 + 0 单 + dataMode 非 LIVE（不冒充）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = data(await invokeSolver(t, "cash_projection", { horizonWeeks: 4 }, EMPTY));
    expect(out.openingCashWan).toBe(0);
    expect(out.orderCount).toBe(0);
    expect(out.dataMode).not.toBe("LIVE");
  });
});

describe("Q30-P3 labor_balance（新域·真读班组/派单推配工缺口）", () => {
  it("I/O 契约：逐线配工缺口字段全在场 + 编制真读", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "labor_balance", {});
    expect(res.statusCode).toBe(200);
    const out = data(res);
    for (const f of ["laborPerWan", "lines", "totalHeadcount", "totalRequiredManShifts", "totalAvailableManShifts", "totalGap", "deficitLineCount", "note", "summary"]) {
      expect(out, `缺字段 ${f}`).toHaveProperty(f);
    }
    const lines = out.lines as Record<string, unknown>[];
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines.slice(0, 1)) {
      for (const f of ["lineId", "baseId", "availableHeadcount", "shiftCount", "borrowableHeadcount", "routedDemandWan", "requiredManShifts", "availableManShifts", "gap", "skillModels"]) {
        expect(l, `线缺字段 ${f}`).toHaveProperty(f);
      }
    }
    // 真读 LaborShift → 编制 > 0（每线两班·各 18–24 人）。
    expect(out.totalHeadcount as number).toBeGreaterThan(0);
    // laborPerWan 系估算参数 → 诚实 PARTIAL（不冒充实测）。
    expect(measure(out)).toBe("PARTIAL");
  });

  it("缺口口径自洽：gap = 需求人·班 - 可用人·班（真算术）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = data(await invokeSolver(t, "labor_balance", {}));
    for (const l of out.lines as { requiredManShifts: number; availableManShifts: number; gap: number }[]) {
      expect(l.gap).toBeCloseTo(Math.round((l.requiredManShifts - l.availableManShifts) * 100) / 100, 5);
    }
  });

  it("R6 确定性：同 seed 重跑字节一致", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const a = data(await invokeSolver(t, "labor_balance", {}));
    const b = data(await invokeSolver(t, "labor_balance", {}));
    expect(JSON.stringify(a.lines)).toBe(JSON.stringify(b.lines));
    expect(a.totalGap).toBe(b.totalGap);
  });

  it("诚实空态：无对象租户 → 空 lines + PARTIAL", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = data(await invokeSolver(t, "labor_balance", {}, EMPTY));
    expect(out.lines).toEqual([]);
    expect(out.totalHeadcount).toBe(0);
    expect(out.dataMode).toBe("PARTIAL");
  });
});

describe("Q30-P3 energy_cost_schedule（新域·真读能耗×需求·SEED 无 TOU 电价诚实空缺）", () => {
  it("I/O 契约：能耗/碳排/逐周排程字段全在场（真读 EnergyMeter）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "energy_cost_schedule", { horizonWeeks: 4 });
    expect(res.statusCode).toBe(200);
    const out = data(res);
    for (const f of ["horizonWeeks", "tariffAvailable", "tariff", "bases", "schedule", "totalEnergyKwh", "totalCarbonKg", "totalEnergyCostWan", "note", "summary"]) {
      expect(out, `缺字段 ${f}`).toHaveProperty(f);
    }
    expect((out.bases as unknown[]).length).toBeGreaterThan(0);
    expect(out.totalEnergyKwh as number).toBeGreaterThan(0);
    expect(out.totalCarbonKg as number).toBeGreaterThan(0);
  });

  it("诚实空缺：无 tariff（SEED 无 TOU 电价）→ 成本 null + note 指明须调用方供（绝不虚构峰谷价）+ PARTIAL", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = data(await invokeSolver(t, "energy_cost_schedule", { horizonWeeks: 4 }));
    expect(out.tariffAvailable).toBe(false);
    expect(out.totalEnergyCostWan).toBeNull();
    expect(String(out.note)).toContain("SEED 未含分时电价");
    expect(measure(out)).toBe("PARTIAL");
    // 但能耗/碳排为真值（非空缺）。
    expect(out.totalEnergyKwh as number).toBeGreaterThan(0);
  });

  it("调用方供 tariff（分时段占比加权）→ 成本落实 + LIVE（能耗真×真提供电价·非冒充种子）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const tariff = { peak: 1.2, flat: 0.7, valley: 0.35, shares: { peak: 0.3, flat: 0.4, valley: 0.3 } };
    const out = data(await invokeSolver(t, "energy_cost_schedule", { horizonWeeks: 4, tariff }));
    expect(out.tariffAvailable).toBe(true);
    expect(out.totalEnergyCostWan as number).toBeGreaterThan(0);
    expect(measure(out)).toBe("LIVE");
    // 加权电价 = (1.2*.3+.7*.4+.35*.3)/1 = 0.745；总成本 = 总能耗×0.745/10000。
    const wp = (1.2 * 0.3 + 0.7 * 0.4 + 0.35 * 0.3) / 1.0;
    expect(out.totalEnergyCostWan as number).toBeCloseTo(Math.round((out.totalEnergyKwh as number) * wp / 10000 * 100) / 100, 0);
  });

  it("R6 确定性：同 seed 重跑字节一致", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const a = data(await invokeSolver(t, "energy_cost_schedule", { horizonWeeks: 4 }));
    const b = data(await invokeSolver(t, "energy_cost_schedule", { horizonWeeks: 4 }));
    expect(JSON.stringify(a.bases)).toBe(JSON.stringify(b.bases));
    expect(a.summary).toBe(b.summary);
  });
});

// ============ 2 复用类（真调子求解器） ============

describe("Q30-P3 reroute_decision（复用 min_cost_flow·真调 CP-SAT）", () => {
  it("I/O 契约 + 真调证据：flows/objective 直取 min_cost_flow 子解真值（随子解变而变·非常数）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const mock = new MockOpt(12345);
    t.services.solvers.setOptimizer(mock);
    const out = await t.services.solvers.invoke(ADMIN_CTX, "reroute_decision", { lineId: "LINE-changzhou" });
    for (const f of ["disruptedLineId", "disruptedModels", "reroutedVolume", "shippedVolume", "unmetVolume", "candidates", "flows", "objective", "optimal", "status", "subSolver", "note", "summary"]) {
      expect(out, `缺字段 ${f}`).toHaveProperty(f);
    }
    // 真调 min_cost_flow：请求捕获 SRC/SINK 节点（自真对象组装）+ objective 直取子解真值。
    expect(mock.lastFlow).toBeDefined();
    expect(mock.lastFlow!.nodes.map((n) => n.id)).toContain("SRC");
    expect(mock.lastFlow!.nodes.map((n) => n.id)).toContain("SINK");
    expect(out.objective).toBe(12345); // == 子解真值（非魔数常数）
    expect(out.subSolver).toBe("min_cost_flow");
    // arc 成本 = 真 ChangeoverMatrix 换型分钟（数值·非硬编码系数）。
    const srcArcs = mock.lastFlow!.arcs.filter((a) => a.from === "SRC");
    expect(srcArcs.length).toBeGreaterThan(0);
    for (const a of srcArcs) expect(typeof a.cost).toBe("number");
  });

  it("真调证据②：objective 随子解输出变而变（换 mock objective → 输出 objective 跟变·证非常数）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    t.services.solvers.setOptimizer(new MockOpt(777));
    const a = await t.services.solvers.invoke(ADMIN_CTX, "reroute_decision", { lineId: "LINE-changzhou" });
    t.services.solvers.setOptimizer(new MockOpt(888));
    const b = await t.services.solvers.invoke(ADMIN_CTX, "reroute_decision", { lineId: "LINE-changzhou" });
    expect(a.objective).toBe(777);
    expect(b.objective).toBe(888); // 输出随子解真值变 → 真调（非借名魔数常数）
  });

  it("R6 确定性：同 seed 同 mock 重跑字节一致", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    t.services.solvers.setOptimizer(new MockOpt(12345));
    const a = await t.services.solvers.invoke(ADMIN_CTX, "reroute_decision", { lineId: "LINE-changzhou" });
    t.services.solvers.setOptimizer(new MockOpt(12345));
    const b = await t.services.solvers.invoke(ADMIN_CTX, "reroute_decision", { lineId: "LINE-changzhou" });
    expect(JSON.stringify(a.candidates)).toBe(JSON.stringify(b.candidates));
    expect(JSON.stringify(a.flows)).toBe(JSON.stringify(b.flows));
  });

  it("诚实降级：最优化引擎未接入 → status=NO_OPTIMIZER + 空流（不 throw·不虚构）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    // 未 setOptimizer（默认无）→ 诚实降级。
    const out = await t.services.solvers.invoke(ADMIN_CTX, "reroute_decision", { lineId: "LINE-changzhou" });
    expect(["NO_OPTIMIZER", "EMPTY"]).toContain(out.status);
    expect(out.flows).toEqual([]);
    expect(measure(out)).toBe("PARTIAL");
  });
});

describe("Q30-P3 multi_constraint_schedule（复用 sequencing_optimize + cert_schedule + changeover_sequence·三约束联解真调）", () => {
  it("I/O 契约 + 真调证据：三子解真值嵌入（sequencing.objective==子解·changeover/cert==直调子解真值）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const mock = new MockOpt(12345, 4242);
    t.services.solvers.setOptimizer(mock);
    const out = await t.services.solvers.invoke(ADMIN_CTX, "multi_constraint_schedule", { jobType: "Order", groupField: "model" });
    for (const f of ["jointSequence", "sequencing", "changeover", "cert", "blockedByCert", "subSolvers", "constraintsSatisfied", "note", "summary"]) {
      expect(out, `缺字段 ${f}`).toHaveProperty(f);
    }
    expect(out.subSolvers).toEqual(["sequencing_optimize", "changeover_sequence", "cert_schedule"]);
    // ① 真调 sequencing_optimize：objective 直取子解真值。
    expect((out.sequencing as { objective: number }).objective).toBe(4242);
    expect(mock.lastSeq).toBeDefined();
    // ② 真调 changeover_sequence：totalChangeoverMin == 直接调 changeover_sequence 真值。
    const coDirect = data(await invokeSolver(t, "changeover_sequence", {}));
    expect((out.changeover as { totalChangeoverMin: number }).totalChangeoverMin).toBe(coDirect.totalChangeoverMin);
    // ③ 真调 cert_schedule：scheduledCount == 直接调 cert_schedule 真值。
    const certDirect = data(await invokeSolver(t, "cert_schedule", {}));
    expect((out.cert as { scheduledCount: number }).scheduledCount).toBe((certDirect.schedule as unknown[]).length);
    expect(measure(out)).toBe("LIVE");
  });

  it("联合解逐单：jointSequence 的 changeoverMin 取自 changeover_sequence 子解（真调·非各自为战）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    t.services.solvers.setOptimizer(new MockOpt());
    const out = await t.services.solvers.invoke(ADMIN_CTX, "multi_constraint_schedule", {});
    const coDirect = data(await invokeSolver(t, "changeover_sequence", {}));
    const coMap = new Map((coDirect.sequence as { orderId: string; changeoverMin: number }[]).map((x) => [x.orderId, x.changeoverMin]));
    for (const j of out.jointSequence as { orderId: string; changeoverMin: number }[]) {
      if (coMap.has(j.orderId)) expect(j.changeoverMin).toBe(coMap.get(j.orderId));
    }
  });

  it("R6 确定性：同 seed 同 mock 重跑字节一致", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    t.services.solvers.setOptimizer(new MockOpt());
    const a = await t.services.solvers.invoke(ADMIN_CTX, "multi_constraint_schedule", {});
    t.services.solvers.setOptimizer(new MockOpt());
    const b = await t.services.solvers.invoke(ADMIN_CTX, "multi_constraint_schedule", {});
    expect(JSON.stringify(a.jointSequence)).toBe(JSON.stringify(b.jointSequence));
    expect(JSON.stringify(a.changeover)).toBe(JSON.stringify(b.changeover));
  });

  it("诚实降级：排序引擎未接入 → sequencing.status=NO_OPTIMIZER + 以换型序为基序（PARTIAL·不虚构最优）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = await t.services.solvers.invoke(ADMIN_CTX, "multi_constraint_schedule", {});
    expect((out.sequencing as { status: string }).status).toBe("NO_OPTIMIZER");
    expect(measure(out)).toBe("PARTIAL");
    // 仍产出联合序（换型子解 NN 序为基序）+ 三子解字段在场。
    expect(Array.isArray(out.jointSequence)).toBe(true);
  });
});
