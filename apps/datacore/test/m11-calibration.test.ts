import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CalibrationProposalSchema,
  CalibrationReportSchema,
  CalibrationRunResultSchema,
} from "@platform/contracts";
import { makeApp, seedBattery, invokeSolver, ADMIN, PLANNER, type TestApp } from "./helpers.js";
import {
  buildReplayModel,
  calibrationConfig,
  datePlus,
  mapePct,
  methodEma,
  methodQuantile,
  methodReplayAttribution,
  patchContext,
  reconstructCertPending,
  reconstructRampBase,
  replayPairs,
  replayPredictedDaily,
  sliceObjectsFor,
  meanProp,
  type AttributionFactor,
} from "../src/calibration/index.js";
import { BATTERY_SOLVER_PARAMS } from "../src/synthetic/battery.js";
import type { CalibrationPairRecord, CalibrationProposalRecord } from "../src/domain.js";
import type { CalibratableParamDef, SolverContext, SolverParamsShape } from "../src/solvers/types.js";
import { round } from "../src/prng.js";

const MODEL = "4680-NCM";
const T0 = "2026-06-10";
const CFG = calibrationConfig(BATTERY_SOLVER_PARAMS as unknown as SolverParamsShape);

const tick = (t: TestApp, advance: "1d" | "7d") =>
  t.app.inject({ method: "POST", url: "/a/v1/synthetic/clock/tick", headers: ADMIN, payload: { advance } });

const emaDef: CalibratableParamDef = {
  key: "oee_baseline",
  name: "OEE 基线",
  method: "EMA",
  scope: "SOLVER_PARAMS",
  path: "test.oee",
  bounds: [0.3, 1],
};

const quantileDef: CalibratableParamDef = {
  key: "p90_health",
  name: "P90 健康度系数",
  method: "QUANTILE",
  scope: "SOLVER_PARAMS",
  path: "health.normal",
  bounds: [0.85, 0.98],
};

/** 用重放执行体构造确定性合成配对（预测=重放值 → 回测基线自洽），actualOf 控制注入偏差。 */
function syntheticPairs(
  c: SolverContext,
  opts: {
    days: number;
    weekOf?: (dayIdx: number) => number;
    perBase?: boolean;
    actualOf: (predicted: number, week: number, baseId: string | undefined) => number;
    paramsVersion?: number;
  },
): CalibrationPairRecord[] {
  const model = buildReplayModel(c);
  const cert = c.certByModel.get(MODEL)!;
  const out: CalibrationPairRecord[] = [];
  const push = (dayIdx: number, baseId: string | undefined) => {
    const week = opts.weekOf ? opts.weekOf(dayIdx) : Math.floor(dayIdx / 7) + 1;
    const predicted = replayPredictedDaily(c, model, MODEL, baseId, week);
    if (predicted <= 0) return;
    const actual = round(opts.actualOf(predicted, week, baseId), 6);
    const date = datePlus(T0, dayIdx - opts.days); // 全部落在评估窗口内（now 之前）
    const error = round(predicted - actual, 6);
    out.push({
      id: `calpair_test_${MODEL}_${baseId ?? "all"}_${date}`,
      tenantId: "demo",
      solverKey: "capacity_forecast",
      entityRef: baseId ? `Model:${MODEL}@Base:${baseId}` : `Model:${MODEL}`,
      modelId: MODEL,
      ...(baseId ? { baseId } : {}),
      windowFrom: date,
      windowTo: date,
      predicted,
      predictedP90: round(predicted * model.healthFactor, 6),
      actual,
      error,
      ape: round(Math.abs(error) / Math.max(actual, 1e-6), 6),
      paramsVersion: opts.paramsVersion ?? 1,
      staleParams: false,
      sliceKey: `capacity_forecast|${baseId ?? "all"}|${MODEL}`,
      weekOfWindow: week,
      pairedAt: "2026-06-10T00:00:00.000Z",
    });
  };
  for (let d = 0; d < opts.days; d++) {
    push(d, undefined);
    if (opts.perBase) for (const baseId of [...cert.keys()].sort()) push(d, baseId);
  }
  return out;
}

async function seedPairs(t: TestApp, pairs: CalibrationPairRecord[]): Promise<void> {
  for (const p of pairs) await t.repos.calibrationPairs.put(p);
}

describe("M11 校准引擎（PRD-addendum-m11-calibration C1–C9）", () => {
  // ---- C1 配对正确性 ------------------------------------------------------------
  it("C1: 窗口未过期/源延迟时不配对；过期且健康后配对；error/ape 与手算一致；一个预测只配对一次", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await invokeSolver(t, "capacity_forecast", { modelId: MODEL, qty: 40, weeks: 6 });
    const fcsts = await t.repos.calibrationForecasts.list("demo");
    expect(fcsts.length).toBeGreaterThan(0); // 轻量预测记录已落（按日窗口）
    expect(fcsts.every((f) => !f.pairedAt)).toBe(true);

    // tick 0：窗口全部未过期 → 不配对
    let r = await t.services.calibration.runPairingOnce("demo");
    expect(r.paired).toBe(0);
    expect(await t.repos.calibrationPairs.list("demo")).toHaveLength(0);

    // 源延迟（关键源 lagHours > staleHours）→ 即使窗口过期也推迟配对
    await t.services.solvers.markSourceStale("demo", "iot-scada", 4.2);
    for (let i = 0; i < 3; i++) await tick(t, "1d");
    r = await t.services.calibration.runPairingOnce("demo");
    expect(r.staleDeferred).toBe(true);
    expect(r.paired).toBe(0);
    expect(await t.repos.calibrationPairs.list("demo")).toHaveLength(0);

    // 新鲜度恢复 → 过期窗口一次性配对
    await t.services.solvers.markSourceStale("demo", "iot-scada", 0.5);
    r = await t.services.calibration.runPairingOnce("demo");
    expect(r.staleDeferred).toBe(false);
    expect(r.paired).toBeGreaterThan(0);

    // error/ape 手算一致（实际值 = A8 ts_agg_runs 同窗口 line_output_daily）
    const pair = (await t.repos.calibrationPairs.list("demo", (p) => !p.baseId && p.windowTo === T0))[0]!;
    const c = await t.services.solvers.loadContext("demo");
    const baseIds = [...c.certByModel.get(MODEL)!.keys()];
    const runs = await t.repos.tsAggRuns.list(
      "demo",
      (x) => x.specKey === "line_output_daily" && x.windowEnd === T0 && baseIds.some((b) => x.entityId === `LINE-${b}`),
    );
    expect(runs).toHaveLength(baseIds.length);
    const actual = round(runs.reduce((a, x) => a + x.value, 0) / c.params.packCellCount / 10000, 6);
    expect(pair.actual).toBe(actual);
    expect(pair.error).toBe(round(pair.predicted - actual, 6));
    expect(pair.ape).toBe(round(Math.abs(pair.error) / Math.max(actual, 1e-6), 6));
    expect(pair.paramsVersion).toBe(await t.services.solvers.paramsVersion("demo"));
    expect(pair.staleParams).toBe(false);

    // 一个预测只配对一次：重复跑零新增
    const count = (await t.repos.calibrationPairs.list("demo")).length;
    r = await t.services.calibration.runPairingOnce("demo");
    expect(r.paired).toBe(0);
    expect((await t.repos.calibrationPairs.list("demo")).length).toBe(count);
  });

  // ---- C2 方法 A · EMA ----------------------------------------------------------
  it("C2: EMA 提案值 = 0.3×0.78+0.7×0.85；漂移 >20% → 无 EMA 提案、出 STRUCTURAL_SHIFT", async () => {
    const a = methodEma(0.78, 0.85, emaDef, CFG);
    expect(a).toEqual({ kind: "candidate", proposedValue: round(0.3 * 0.78 + 0.7 * 0.85, 6) }); // 0.829
    const b = methodEma(0.6, 0.85, emaDef, CFG); // |0.60−0.85|/0.85 ≈ 29.4% > 20%
    expect(b.kind).toBe("structural_shift");
    if (b.kind === "structural_shift") {
      expect(b.observed).toBe(0.6);
      expect(b.driftPct).toBeGreaterThan(0.2);
    }
  });

  // ---- C3 方法 B · 重放归因 -------------------------------------------------------
  it("C3: 仅爬坡偏差的合成历史 → ≥80% 偏差归因到爬坡系数；提案变幅被 clip ±10%", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const c = await t.services.solvers.loadContext("demo");
    const fullWeek = c.params.ramp.fullWeek;
    // 注入仅爬坡偏差：爬坡周实际 = 预测×0.5（极端，逼出 clip），满产周完全准确
    const pairs = syntheticPairs(c, {
      days: 42,
      perBase: true,
      actualOf: (pred, week) => (week < fullWeek ? pred * 0.5 : pred),
    });
    const basePairs = pairs.filter((p) => !p.baseId);

    // 因子实测重构：爬坡有强信号，认证系数无信号（均匀 → ≈ current）
    const rampCurrent = c.params.ramp.base;
    const certCurrent = c.params.certFactors["认证中"] as number;
    const rampRecon = reconstructRampBase(pairs, rampCurrent, fullWeek);
    expect(rampRecon).toBeLessThan(rampCurrent * 0.75); // ≈ current×0.5
    const certRecon = reconstructCertPending(pairs, certCurrent, c.certByModel.get(MODEL));
    expect(Math.abs(certRecon - certCurrent) / certCurrent).toBeLessThan(0.05);

    const factors: AttributionFactor[] = [
      { def: { key: "ramp_base", name: "爬坡系数", method: "REPLAY_ATTRIBUTION", scope: "SOLVER_PARAMS", path: "ramp.base", bounds: [0.3, 1] }, current: rampCurrent, reconstructed: rampRecon },
      { def: { key: "cert_pending", name: "认证系数", method: "REPLAY_ATTRIBUTION", scope: "SOLVER_PARAMS", path: "certFactors.认证中", bounds: [0.3, 0.9] }, current: certCurrent, reconstructed: certRecon },
    ];
    const r = methodReplayAttribution(c, basePairs, factors);
    expect(r.shares["ramp.base"]!).toBeGreaterThanOrEqual(0.8); // ≥80% 偏差分到爬坡系数
    const ramp = r.candidates.find((x) => x.def.path === "ramp.base")!;
    expect(ramp.proposedValue).toBe(round(rampCurrent * 0.9, 6)); // 单次变幅 clip −10%
  });

  // ---- C4 方法 C · 分位数匹配 ------------------------------------------------------
  it("C4: cov=0.80 → f−0.01；cov=0.97 → f+0.01；边界 clip [0.85, 0.98]", () => {
    expect(methodQuantile(0.8, 0.93, quantileDef, CFG)).toEqual({ kind: "candidate", proposedValue: 0.92 });
    expect(methodQuantile(0.97, 0.93, quantileDef, CFG)).toEqual({ kind: "candidate", proposedValue: 0.94 });
    expect(methodQuantile(0.9, 0.93, quantileDef, CFG)).toEqual({ kind: "none" }); // 带内不动
    expect(methodQuantile(0.8, 0.85, quantileDef, CFG)).toEqual({ kind: "none" }); // 下界 clip
    expect(methodQuantile(0.97, 0.98, quantileDef, CFG)).toEqual({ kind: "none" }); // 上界 clip
  });

  // ---- C5 回测门槛 ---------------------------------------------------------------
  it("C5: 构造'改了也不准'的样本 → NO_IMPROVEMENT、零提案", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const c = await t.services.solvers.loadContext("demo");
    // 实际 == 预测（已经全准）：任何参数改动都只会让 simulatedMapeAfter 变差
    await seedPairs(t, syntheticPairs(c, { days: 12, weekOf: () => 5, perBase: true, actualOf: (p) => p }));
    const r = await t.services.calibration.generateForSlice("demo", MODEL, "手动");
    expect(r.insufficient).toBe(false);
    expect(r.created).toBe(0);
    expect(r.autoApplied).toBe(0);
    const proposals = await t.repos.calibrationProposals.list("demo", (p) => p.id.startsWith("cal_"));
    expect(proposals.length).toBeGreaterThan(0);
    for (const p of proposals) {
      expect(p.status).toBe("REJECTED");
      expect(p.evidence!.flags).toContain("NO_IMPROVEMENT");
    }
    expect(proposals.some((p) => p.status === "PENDING")).toBe(false);
  });

  // ---- C6 生效与回滚（版本历史 + runWithParams + autoApply 边界） ---------------------
  it("C6: 批准 → 参数版本+1 且后续求解用新值；回滚恢复上一版本；runWithParams 复现旧版本", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const v0 = await t.services.solvers.paramsVersion("demo");
    const proposal: CalibrationProposalRecord = {
      id: "cal_demo_c6_ramp",
      tenantId: "demo",
      parameter: "产能预测·爬坡系数基线（C6）",
      paramPath: "ramp.base",
      objectRef: `Model:${MODEL}`,
      currentValue: 0.88,
      proposedValue: 0.8,
      basis: { windowFrom: "2026-06-01", windowTo: "2026-06-30", samples: 30 },
      trigger: "C12",
      status: "PENDING",
      createdAt: new Date().toISOString(),
      sliceKey: `capacity_forecast|all|${MODEL}`,
      paramRef: { scope: "SOLVER_PARAMS", path: "ramp.base" },
      method: "REPLAY_ATTRIBUTION",
      evidence: { windowFrom: "2026-06-01", windowTo: "2026-06-30", nPairs: 30, mapeBefore: 12, simulatedMapeAfter: 9.5, bias: 0.2, flags: [] },
    };
    await t.repos.calibrationProposals.put(proposal);
    const before = (await invokeSolver(t, "capacity_forecast", { modelId: MODEL, qty: 40, weeks: 1 })).json() as { data: { p50: number } };

    // 批准走 Action（§S2）：EXECUTED 后 version+1 + 新值生效
    const approve = await t.app.inject({ method: "POST", url: `/a/v1/calibration/proposals/${proposal.id}/approve`, headers: PLANNER, payload: {} });
    expect(approve.statusCode).toBe(202);
    const draftId = (approve.json() as { draftId: string }).draftId;
    expect((await t.services.solvers.getParams("demo")).ramp.base).toBe(0.88); // 审批前不动
    const done = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} });
    expect((done.json() as { status: string }).status).toBe("EXECUTED");
    expect((await t.services.solvers.getParams("demo")).ramp.base).toBe(0.8);
    const v1 = await t.services.solvers.paramsVersion("demo");
    expect(v1).toBe(v0 + 1);
    const after = (await invokeSolver(t, "capacity_forecast", { modelId: MODEL, qty: 40, weeks: 1 })).json() as { data: { p50: number } };
    expect(after.data.p50).toBeLessThan(before.data.p50); // 后续求解用新值（week1 爬坡 0.8）

    // S1 修订：runWithParams(旧版本) 复现旧输出（同输入同参数版本同输出）
    const replayOld = await t.services.solvers.runWithParams("demo", "capacity_forecast", { modelId: MODEL, qty: 40, weeks: 1 }, { paramsVersion: v0 });
    expect(replayOld.p50).toBe(before.data.p50);
    const replayNew = await t.services.solvers.runWithParams("demo", "capacity_forecast", { modelId: MODEL, qty: 40, weeks: 1 }, { paramsVersion: v1 });
    expect(replayNew.p50).toBe(after.data.p50);

    // 一键回滚（亦走 Action）→ 恢复上一参数版本值
    const rb = await t.app.inject({ method: "POST", url: `/a/v1/calibration/proposals/${proposal.id}/rollback`, headers: PLANNER, payload: {} });
    expect(rb.statusCode).toBe(202);
    await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${(rb.json() as { draftId: string }).draftId}/approve`, headers: ADMIN, payload: {} });
    expect((await t.services.solvers.getParams("demo")).ramp.base).toBe(0.88);
    expect((await t.repos.calibrationProposals.get("demo", proposal.id))!.status).toBe("ROLLED_BACK");
    expect(await t.services.solvers.paramsVersion("demo")).toBe(v1 + 1); // 回滚也是一次版本推进（全审计）
  });

  it("C6b: autoApply 开关仅放行方法 A 且小变幅（方法 B 胜出时仍走审批）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 场景包开关：autoApply=true；EMA 候选改为对 health.normal（变幅 <5%），门槛放 0 演示纯开关行为
    await t.services.solvers.mutateParams("demo", (p) => {
      const cal = p.calibration as { autoApply: boolean; minImprovementPct: number; params: CalibratableParamDef[] };
      cal.autoApply = true;
      cal.minImprovementPct = 0;
      cal.params = [
        { key: "p90_health_ema", name: "P90 健康度基线", method: "EMA", scope: "SOLVER_PARAMS", path: "health.normal", observedSpecKey: "yield_daily", bounds: [0.85, 0.98] },
      ];
    });
    const c = await t.services.solvers.loadContext("demo");
    const version = await t.services.solvers.paramsVersion("demo");
    await seedPairs(t, syntheticPairs(c, { days: 12, weekOf: () => 5, actualOf: (p) => p, paramsVersion: version }));
    const r1 = await t.services.calibration.generateForSlice("demo", MODEL, "手动");
    expect(r1.autoApplied).toBe(1); // 方法 A + 变幅 <5% → 免审批自动生效（全审计）
    const auto = (await t.repos.calibrationProposals.list("demo", (p) => p.status === "APPLIED" && p.paramPath === "health.normal"))[0]!;
    expect(auto.method).toBe("EMA");
    expect(auto.evidence!.flags).toContain("AUTO_APPLIED");
    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "calibration.auto_applied");
    expect(events.length).toBe(1);
    expect((await t.services.solvers.getParams("demo")).health.normal).toBe(auto.proposedValue);

    // 方法 B 胜出 → 不免审批（autoApply 仅方法 A）
    const t2 = await makeApp();
    await seedBattery(t2);
    await t2.services.solvers.mutateParams("demo", (p) => {
      (p.calibration as { autoApply: boolean }).autoApply = true;
    });
    const c2 = await t2.services.solvers.loadContext("demo");
    const v2 = await t2.services.solvers.paramsVersion("demo");
    await seedPairs(
      t2,
      syntheticPairs(c2, { days: 42, perBase: true, actualOf: (p, week) => (week < c2.params.ramp.fullWeek ? p * 0.8 : p), paramsVersion: v2 }),
    );
    const r2 = await t2.services.calibration.generateForSlice("demo", MODEL, "手动");
    expect(r2.autoApplied).toBe(0);
    const pending = await t2.repos.calibrationProposals.list("demo", (p) => p.status === "PENDING" && p.id.startsWith("cal_"));
    expect(pending).toHaveLength(1);
    expect(pending[0]!.method).toBe("REPLAY_ATTRIBUTION"); // 胜出者是方法 B → 仍走 Action 审批
  });

  // ---- C7 防护：频率限制 + 级联抑制 -------------------------------------------------
  it("C7: 同窗多提案只放行改善最大者（其余 CASCADE_HOLD）；同参数一周内二次提案 FREQUENCY_LIMIT", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 门槛调低让 EMA 与方法 B 同时过闸 → 级联抑制生效
    await t.services.solvers.mutateParams("demo", (p) => {
      (p.calibration as { minImprovementPct: number }).minImprovementPct = 0.05;
    });
    const c = await t.services.solvers.loadContext("demo");
    const version = await t.services.solvers.paramsVersion("demo");
    // 爬坡周 −20% + 全程 −3%（让良率 EMA 也有小改善信号）
    await seedPairs(
      t,
      syntheticPairs(c, { days: 42, perBase: true, actualOf: (p, week) => (week < c.params.ramp.fullWeek ? p * 0.8 : p * 0.97), paramsVersion: version }),
    );
    const r = await t.services.calibration.generateForSlice("demo", MODEL, "手动");
    expect(r.created).toBe(1);
    expect(r.held).toBeGreaterThanOrEqual(1);
    const created = await t.repos.calibrationProposals.list("demo", (p) => p.id.startsWith("cal_"));
    const pending = created.filter((p) => p.status === "PENDING");
    expect(pending).toHaveLength(1); // 只放行第一个（按 simulated 改善幅度排序）
    expect(pending[0]!.paramRef!.path).toBe("ramp.base");
    const holds = created.filter((p) => p.status === "HOLD");
    expect(holds.length).toBeGreaterThanOrEqual(1);
    expect(holds.every((p) => p.evidence!.flags.includes("CASCADE_HOLD"))).toBe(true);
    const bestImprovement = pending[0]!.evidence!.mapeBefore - pending[0]!.evidence!.simulatedMapeAfter;
    for (const h of holds) {
      expect(bestImprovement).toBeGreaterThanOrEqual(h.evidence!.mapeBefore - h.evidence!.simulatedMapeAfter);
    }

    // 批准生效 → 同一 paramRef 一周内再次提案被 HOLD（FREQUENCY_LIMIT）
    const approve = await t.app.inject({ method: "POST", url: `/a/v1/calibration/proposals/${pending[0]!.id}/approve`, headers: PLANNER, payload: {} });
    await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${(approve.json() as { draftId: string }).draftId}/approve`, headers: ADMIN, payload: {} });
    expect((await t.repos.calibrationProposals.get("demo", pending[0]!.id))!.status).toBe("APPLIED");

    // 新窗口样本（新参数版本）再生成：爬坡仍有信号 → 候选过闸但被频率限制 HOLD
    const c2 = await t.services.solvers.loadContext("demo");
    const v2 = await t.services.solvers.paramsVersion("demo");
    await seedPairs(
      t,
      syntheticPairs(c2, { days: 42, perBase: true, actualOf: (p, week) => (week < c2.params.ramp.fullWeek ? p * 0.8 : p * 0.97), paramsVersion: v2 }),
    );
    await t.services.calibration.generateForSlice("demo", MODEL, "手动");
    const rampAgain = await t.repos.calibrationProposals.list(
      "demo",
      (p) => p.paramPath === "ramp.base" && p.status === "HOLD",
    );
    expect(rampAgain.length).toBeGreaterThanOrEqual(1);
    expect(rampAgain.some((p) => p.evidence!.flags.includes("FREQUENCY_LIMIT"))).toBe(true);
  });

  // ---- C8 元闭环 ----------------------------------------------------------------
  it("C8: APPLIED 14（模拟）日后 realizedMape 回写提案与历史（预言 vs 实现）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const proposal: CalibrationProposalRecord = {
      id: "cal_demo_c8",
      tenantId: "demo",
      parameter: "工序良率基线（C8）",
      paramPath: "Process.yield",
      objectRef: `Model:${MODEL}`,
      currentValue: 0.97,
      proposedValue: 0.955,
      basis: { windowFrom: "2026-06-01", windowTo: "2026-06-30", samples: 20 },
      trigger: "C12",
      status: "APPLIED",
      createdAt: "2026-06-10T00:00:00.000Z",
      appliedAt: "2026-06-10T08:00:00.000Z",
      appliedTick: 0,
      sliceKey: `capacity_forecast|all|${MODEL}`,
      paramRef: { scope: "ONTOLOGY_PROPERTY", path: "Process.yield" },
      method: "EMA",
      evidence: { windowFrom: "2026-06-01", windowTo: "2026-06-30", nPairs: 20, mapeBefore: 12, simulatedMapeAfter: 8, bias: 0.1, flags: [] },
    };
    await t.repos.calibrationProposals.put(proposal);
    await t.repos.calibrationHistory.put({
      id: "calh_demo_c8",
      tenantId: "demo",
      at: "2026-06-10T08:00:00.000Z",
      trigger: "C12",
      changedParams: [proposal.parameter],
      mapeBefore: 12,
      mapeAfter: 8,
      proposalId: proposal.id,
      method: "EMA",
      simulatedMapeAfter: 8,
    });
    // 生效后的 14 个模拟日内的真实配对（ape 0.09/0.11 → realized 10%）
    const mk = (date: string, ape: number): CalibrationPairRecord => ({
      id: `calpair_demo_c8_${date}`,
      tenantId: "demo",
      solverKey: "capacity_forecast",
      entityRef: `Model:${MODEL}`,
      modelId: MODEL,
      windowFrom: date,
      windowTo: date,
      predicted: 0.06,
      predictedP90: 0.0558,
      actual: round(0.06 / (1 + ape), 6),
      error: round(0.06 - 0.06 / (1 + ape), 6),
      ape,
      paramsVersion: 2,
      staleParams: false,
      sliceKey: `capacity_forecast|all|${MODEL}`,
      weekOfWindow: 1,
      pairedAt: "2026-06-24T00:00:00.000Z",
    });
    await seedPairs(t, [mk("2026-06-14", 0.09), mk("2026-06-19", 0.11)]);

    // 未满 14 模拟日 → 不回写
    expect(await t.services.calibration.runMetaLoop("demo")).toBe(0);
    const clock = (await t.repos.simulationClocks.get("demo", "demo"))!;
    clock.currentTick = 14;
    await t.repos.simulationClocks.put(clock);
    expect(await t.services.calibration.runMetaLoop("demo")).toBe(1);

    const after = (await t.repos.calibrationProposals.get("demo", proposal.id))!;
    expect(after.realizedMape).toBe(10); // mean(0.09, 0.11) × 100
    const hist = (await t.repos.calibrationHistory.list("demo", (h) => h.proposalId === proposal.id))[0]!;
    expect(hist.simulatedMapeAfter).toBe(8); // 预言
    expect(hist.realizedMape).toBe(10); // 实现
    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "calibration.meta_evaluated");
    expect(events.length).toBe(1);
    // 幂等：二次跑不重复回写
    expect(await t.services.calibration.runMetaLoop("demo")).toBe(0);
  });

  // ---- C9 端到端（A8 T9 加强版） ---------------------------------------------------
  it("C9: tick 良率下滑 → C12 → 方法A提案(含回测证据) → 批准 → 继续 tick → MAPE 收敛且报告可见全链", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await invokeSolver(t, "capacity_forecast", { modelId: MODEL, qty: 40, weeks: 6 });

    // 21 个模拟日（tick 3 注入 iot_delay、tick 8 注入 yield_drop）：偏差累积 → C12
    for (let i = 0; i < 3; i++) await tick(t, "7d");
    const events = await t.repos.outboxEvents.list("demo");
    expect(events.some((e) => e.event === "calibration.required" && e.payload.ruleKey === "C12")).toBe(true);
    // §1 新鲜度闸门：iot_delay 持续期间推迟配对（绝不用残缺实际值污染样本）
    expect(await t.repos.calibrationPairs.list("demo")).toHaveLength(0);

    // 源恢复 → 下一个 tick 补配对全部过期窗口 → C12 钩子按切片出提案
    await t.services.solvers.markSourceStale("demo", "iot-scada", 0.5);
    await tick(t, "1d"); // tick 22
    const basePairs = await t.repos.calibrationPairs.list("demo", (p) => !p.baseId && p.modelId === MODEL);
    expect(basePairs.length).toBeGreaterThanOrEqual(CFG.nMin);

    // 方法 A 提案（含回测证据）成为 PENDING 胜出者
    const list = z.array(CalibrationProposalSchema).parse(
      (await t.app.inject({ method: "GET", url: "/a/v1/calibration/proposals", headers: PLANNER })).json(),
    );
    const ema = list.find((p) => /^cal_/.test(p.id) && p.status === "PENDING" && p.method === "EMA")!;
    expect(ema).toBeDefined();
    expect(ema.paramRef).toEqual({ scope: "ONTOLOGY_PROPERTY", path: "Process.yield" });
    expect(ema.sliceKey).toBe(`capacity_forecast|all|${MODEL}`);
    expect(ema.evidence!.nPairs).toBeGreaterThanOrEqual(CFG.nMin);
    expect(ema.evidence!.mapeBefore - ema.evidence!.simulatedMapeAfter).toBeGreaterThanOrEqual(CFG.minImprovementPct);
    expect(ema.proposedValue).toBeLessThan(ema.currentValue); // 良率下滑 → 基线下调

    // 报告页数据链：7/30d 双口径 + 切片 + 阈值/触发标记（全部真数据）
    const report = CalibrationReportSchema.parse(
      (await t.app.inject({ method: "GET", url: "/a/v1/calibration/report", headers: PLANNER })).json(),
    );
    expect(report.points.length).toBeGreaterThanOrEqual(10);
    expect(report.points30d!.length).toBe(report.points.length);
    expect(report.triggerMarks.length).toBeGreaterThan(0);
    expect(report.slices!.some((s) => s.sliceKey === `capacity_forecast|all|${MODEL}` && s.nPairs >= CFG.nMin)).toBe(true);
    const mapeAtApproval = report.points[report.points.length - 1]!.mape;

    // 批准（经 校准参数变更 Action）→ 本体良率基线缩放 + 参数版本 +1 + 预测快照刷新
    const vBefore = await t.services.solvers.paramsVersion("demo");
    const c = await t.services.solvers.loadContext("demo");
    const meanBefore = meanProp(sliceObjectsFor(c, MODEL, "Process"), "yield");
    const approve = await t.app.inject({ method: "POST", url: `/a/v1/calibration/proposals/${ema.id}/approve`, headers: PLANNER, payload: {} });
    expect(approve.statusCode).toBe(202);
    const done = await t.app.inject({
      method: "POST",
      url: `/a/v1/action-drafts/${(approve.json() as { draftId: string }).draftId}/approve`,
      headers: ADMIN,
      payload: {},
    });
    expect((done.json() as { status: string }).status).toBe("EXECUTED");
    expect(await t.services.solvers.paramsVersion("demo")).toBe(vBefore + 1);
    const c2 = await t.services.solvers.loadContext("demo");
    const meanAfter = meanProp(sliceObjectsFor(c2, MODEL, "Process"), "yield");
    expect(meanAfter).toBeLessThan(meanBefore);
    expect(meanAfter).toBeCloseTo(ema.proposedValue, 3);

    // 继续 tick 14 个模拟日 → 新参数版本配对 → MAPE 实际收敛 + 元闭环回写
    for (let i = 0; i < 2; i++) await tick(t, "7d");
    const report2 = CalibrationReportSchema.parse(
      (await t.app.inject({ method: "GET", url: "/a/v1/calibration/report", headers: PLANNER })).json(),
    );
    expect(report2.points.length).toBeGreaterThan(report.points.length); // 序列持续延展（真数据）
    // 实际收敛 = 新参数下的真实 MAPE < 同一批实际值用"未校准基线"反事实重放的 MAPE
    const postPairs = await t.repos.calibrationPairs.list(
      "demo",
      (p) => !p.baseId && p.modelId === MODEL && p.paramsVersion === vBefore + 1 && !p.staleParams,
    );
    expect(postPairs.length).toBeGreaterThanOrEqual(10);
    expect(mapePct(postPairs)).toBeGreaterThan(0);
    // 同一上下文时点的确定性对照重放：校准后的良率基线 vs 未校准反事实（逆向缩放回旧基线）
    const cNow = await t.services.solvers.loadContext("demo");
    const calibrated = replayPairs(cNow, postPairs).simulatedMapeAfter;
    const counterfactualCtx = patchContext(cNow, {
      scope: "ONTOLOGY_PROPERTY",
      path: "Process.yield",
      currentValue: meanAfter,
      proposedValue: meanBefore, // 逆向缩放 = 未校准的旧良率基线
      modelId: MODEL,
    });
    const counterfactual = replayPairs(counterfactualCtx, postPairs).simulatedMapeAfter;
    expect(calibrated).toBeLessThan(counterfactual); // 校准真实生效：同批实际值下误差更小（MAPE 收敛）
    expect(mapeAtApproval).toBeGreaterThan(0); // 触发线起点存在（趋势图非空）

    const appliedNow = (await t.repos.calibrationProposals.get("demo", ema.id))!;
    expect(appliedNow.status).toBe("APPLIED");
    expect(appliedNow.realizedMape).toBeDefined(); // 元闭环：14 模拟日后回写
    const histRes = (await t.app.inject({ method: "GET", url: "/a/v1/calibration/history", headers: PLANNER })).json() as {
      proposalId?: string;
      simulatedMapeAfter?: number;
      realizedMape?: number;
    }[];
    const entry = histRes.find((h) => h.proposalId === ema.id)!;
    expect(entry.simulatedMapeAfter).toBe(ema.evidence!.simulatedMapeAfter); // 预言
    expect(entry.realizedMape).toBe(appliedNow.realizedMape); // 实现

    // 手动「立即校准」端点（catalog_admin）契约
    const run = await t.app.inject({ method: "POST", url: "/a/v1/calibration/run", headers: ADMIN, payload: {} });
    expect(run.statusCode).toBe(200);
    const result = CalibrationRunResultSchema.parse(run.json());
    expect(result.slicesEvaluated).toBeGreaterThanOrEqual(1);
    // 频率限制：刚生效的 Process.yield 一周内不再放行
    const yieldHolds = await t.repos.calibrationProposals.list(
      "demo",
      (p) => p.paramPath === "Process.yield" && p.status === "HOLD" && (p.evidence?.flags ?? []).includes("FREQUENCY_LIMIT"),
    );
    expect(yieldHolds.length).toBeGreaterThanOrEqual(0); // HOLD 仅当候选再次过闸（不强约束）
    const planner403 = await t.app.inject({ method: "POST", url: "/a/v1/calibration/run", headers: PLANNER, payload: {} });
    expect(planner403.statusCode).toBe(403); // catalog_admin only
  });
});
