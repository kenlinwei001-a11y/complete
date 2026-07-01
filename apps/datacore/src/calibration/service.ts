import type { CalibrationReport, CalibrationRunResult } from "@platform/contracts";
import type {
  ActionDraft,
  CalibrationConvergenceRecord,
  CalibrationHistoryRecord,
  CalibrationMethodKind,
  CalibrationPairRecord,
  CalibrationProposalRecord,
} from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { OutboxService } from "../outbox.js";
import type { SolverService } from "../solvers/service.js";
import type { CalibratableParamDef, CalibrationConfigShape, SolverContext } from "../solvers/types.js";
import { num, str } from "../solvers/types.js";
import { mulberry32, hashString, round } from "../prng.js";
import { invalidState, notFound } from "../errors.js";
import { getByPath } from "../paths.js";
import { calibrationConfig, datePlus, daysBetween, DAY_MS, EVAL_WINDOW_DAYS, sliceKeyOf } from "./config.js";
import { biasOf, buildSlices, coverageOf, mapePct, rollingMapeSeries } from "./metrics.js";
import {
  coverageBandDistance,
  methodEma,
  methodQuantile,
  methodReplayAttribution,
  reconstructCertPending,
  reconstructRampBase,
  type AttributionFactor,
} from "./methods.js";
import { meanProp, patchContext, replayPairs, sliceObjectsFor } from "./replay.js";
import { runPairing, simNow, type PairingResult } from "./pairing.js";

const BASELINE_DAYS = 14;
const DEFAULT_THRESHOLD_PCT = 8;
const SOLVER_KEY = "capacity_forecast";

export interface CalibrationReportQuery {
  objectType?: string;
  solverKey?: string;
  baseId?: string;
  from?: string;
}

interface Candidate {
  def: CalibratableParamDef;
  method: CalibrationMethodKind;
  currentValue: number;
  proposedValue: number;
  simulatedMapeAfter: number;
  improvement: number;
  passes: boolean;
  flags: string[];
}

export interface SliceGenerationResult {
  insufficient: boolean;
  created: number;
  held: number;
  dropped: number;
  autoApplied: number;
  proposals: CalibrationProposalRecord[];
}

/**
 * M11 校准引擎（PRD-addendum-m11-calibration）：
 * §1 配对（pairing.ts）→ §2 度量/切片（metrics.ts）→ §4 三方法推导（methods.ts）→
 * §5 回测门槛（replay.ts）→ §6 经 `校准参数变更` Action 生效/回滚 + 防护 + 元闭环。
 * 求解器确定性重放（runWithParams / compute）是归因与回测的执行体。
 */
export class CalibrationService {
  constructor(
    private repos: Repos,
    private outbox: OutboxService,
    private solvers: SolverService,
  ) {}

  // -- §1 配对 + 元闭环（模拟时钟 tick / 周任务 / 手动触发共用） ------------------------

  async runPairingOnce(tenantId: string): Promise<PairingResult> {
    return runPairing(this.repos, this.solvers, tenantId);
  }

  /** 模拟时钟 tick 钩子：聚合后配对 + 元闭环（C12 扫描在其后，按切片消费新配对）。 */
  async onTick(tenantId: string): Promise<void> {
    await this.runPairingOnce(tenantId);
    await this.runMetaLoop(tenantId);
  }

  /** §3 手动「立即校准」/ S3 CALIBRATION_RUN 周任务：全量配对 + 全切片提案生成。 */
  async runAll(tenantId: string, trigger = "手动"): Promise<CalibrationRunResult> {
    const pairing = await this.runPairingOnce(tenantId);
    await this.runMetaLoop(tenantId);
    const pairs = await this.repos.calibrationPairs.list(tenantId, (p) => !p.baseId);
    const modelIds = [...new Set(pairs.map((p) => p.modelId))].sort();
    let created = 0;
    let held = 0;
    let dropped = 0;
    let autoApplied = 0;
    let insufficient = 0;
    for (const modelId of modelIds) {
      const r = await this.generateForSlice(tenantId, modelId, trigger);
      if (r.insufficient) insufficient++;
      created += r.created;
      held += r.held;
      dropped += r.dropped;
      autoApplied += r.autoApplied;
    }
    return {
      paired: pairing.paired,
      deferred: pairing.deferred,
      staleDeferred: pairing.staleDeferred,
      slicesEvaluated: modelIds.length,
      created,
      autoApplied,
      held,
      dropped,
      insufficient,
    };
  }

  // -- WO-E1 校准活体常态化（CALIBRATION_SWEEP：周期跑 runAll + 逐轮收敛度落库·越用越准可见） ----

  /**
   * S3 CALIBRATION_SWEEP 调度作业入口：跑一轮 `runAll`（回采→配对→提案·自动应用小步长），
   * 并把本轮收敛度落库（mapeBefore→mapeAfter + 提案/自动应用数 + 参数版本）——「越用越准」的证据。
   *
   * 确定性 R6：mapeBefore/mapeAfter 均从 `report()` 派生（无随机/时钟随机性）；round = 已有记录数 + 1（单调）。
   * 自动应用（EMA 小步长）在 runAll 内生效 → 刷新预测快照 → mapeAfter 应 ≤ mapeBefore（收敛）。
   */
  async sweep(tenantId: string, trigger = "CALIBRATION_SWEEP"): Promise<CalibrationRunResult & { round: number }> {
    const mapeBefore = await this.latestMape(tenantId);
    const run = await this.runAll(tenantId, trigger);
    const mapeAfter = await this.latestMape(tenantId);
    const paramsVersion = await this.solvers.paramsVersion(tenantId);
    const existing = await this.repos.calibrationConvergence.list(tenantId);
    const round = existing.length + 1;
    await this.repos.calibrationConvergence.put({
      id: `calc_${tenantId}_${round}`,
      tenantId,
      round,
      at: new Date().toISOString(),
      trigger,
      mapeBefore,
      mapeAfter,
      slicesEvaluated: run.slicesEvaluated,
      proposalsCreated: run.created,
      autoApplied: run.autoApplied,
      ...(typeof paramsVersion === "number" ? { paramsVersion } : {}),
    });
    await this.outbox.emit(tenantId, "calibration.swept", { round, mapeBefore, mapeAfter, created: run.created, autoApplied: run.autoApplied });
    return { ...run, round };
  }

  /** GET /a/v1/calibration/convergence：逐轮收敛史（round 升序）+ 首末改善判据（越用越准可证·R2 限本租户）。 */
  async convergenceHistory(tenantId: string): Promise<CalibrationConvergenceRecord[]> {
    return (await this.repos.calibrationConvergence.list(tenantId)).sort((a, b) => a.round - b.round);
  }

  // -- §7.21 报告（pairs/切片 → 7/30d 双口径 + 阈值 + 触发标记；无配对时确定性基线兜底） ----

  async report(tenantId: string, q: CalibrationReportQuery = {}): Promise<CalibrationReport> {
    const thresholdPct = await this.thresholdPct(tenantId);
    const cfg = calibrationConfig(await this.solvers.getParams(tenantId));
    const solverOk = !q.solverKey || q.solverKey === SOLVER_KEY;
    const objectOk = !q.objectType || q.objectType === "Model" || q.objectType === "产能预测";
    let pairs = solverOk && objectOk ? await this.repos.calibrationPairs.list(tenantId) : [];
    if (q.baseId && pairs.length > 0) {
      const baseId = await this.resolveBaseId(tenantId, q.baseId);
      pairs = baseId ? pairs.filter((p) => p.baseId === baseId) : [];
    }
    const trendPairs = q.baseId ? pairs : pairs.filter((p) => !p.baseId);

    let points: { date: string; mape: number }[];
    let points30d: { date: string; mape: number }[] | undefined;
    let slices: ReturnType<typeof buildSlices> | undefined;
    if (trendPairs.length > 0) {
      points = rollingMapeSeries(trendPairs, 7);
      points30d = rollingMapeSeries(trendPairs, 30);
      slices = buildSlices(pairs, cfg.nMin);
    } else {
      points = await this.legacySeries(tenantId, q);
    }
    if (q.from) {
      points = points.filter((p) => p.date >= (q.from as string));
      if (points30d) points30d = points30d.filter((p) => p.date >= (q.from as string));
    }
    // C12 触发标记：序列中越过阈值的点（与 calibration.required 触发口径一致）
    const triggerMarks = points.filter((p) => p.mape > thresholdPct).map((p) => ({ date: p.date, ruleKey: "C12" }));
    return {
      points,
      thresholdPct,
      triggerMarks,
      ...(points30d ? { points30d } : {}),
      ...(slices ? { slices } : {}),
      nMin: cfg.nMin,
    };
  }

  /** 配对前的兼容序列：A8 forecast_dev 聚合；再无数据 → 确定性种子基线（页面不空）。 */
  private async legacySeries(tenantId: string, q: CalibrationReportQuery): Promise<{ date: string; mape: number }[]> {
    let runs = await this.repos.tsAggRuns.list(tenantId, (r) => r.specKey === "forecast_dev_daily");
    if (q.objectType && q.objectType !== "Model") runs = []; // forecast_dev 仅挂 Model
    if (q.solverKey && q.solverKey !== SOLVER_KEY) runs = [];
    if (runs.length > 0) {
      const byDate = new Map<string, number[]>();
      for (const r of runs) {
        const arr = byDate.get(r.windowEnd) ?? [];
        arr.push(r.value);
        byDate.set(r.windowEnd, arr);
      }
      return [...byDate.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([date, vals]) => ({ date, mape: round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100, 2) }));
    }
    return this.baselineSeries(tenantId, q.baseId);
  }

  /** 无任何历史时的确定性基线（seed 派生；缓慢收敛 —— 演示线 T9 的静态起点）。 */
  private async baselineSeries(tenantId: string, baseId?: string): Promise<{ date: string; mape: number }[]> {
    const clock = await this.repos.simulationClocks.get(tenantId, tenantId);
    const t0 = Date.parse(`${(clock?.t0 ?? "2026-07-01").slice(0, 10)}T00:00:00Z`);
    const seed = (clock?.seed ?? 42) ^ hashString(`calibration-baseline:${baseId ?? "all"}`);
    const rng = mulberry32(seed);
    const out: { date: string; mape: number }[] = [];
    for (let i = 0; i < BASELINE_DAYS; i++) {
      const date = new Date(t0 - (BASELINE_DAYS - i) * DAY_MS).toISOString().slice(0, 10);
      const mape = round(11.2 - i * 0.32 + (rng() - 0.5) * 1.2, 2);
      out.push({ date, mape: Math.max(3, mape) });
    }
    return out;
  }

  /** C12 阈值（%）从已发布规则表达式解析（SUSTAIN(Model.forecast_deviation > 0.08, 1) → 8）。 */
  private async thresholdPct(tenantId: string): Promise<number> {
    const rules = await this.repos.rules.list(tenantId, (r) => r.key === "C12" && r.status === "PUBLISHED");
    const expr = rules[0]?.expression ?? "";
    const m = /forecast_deviation\s*>\s*([\d.]+)/.exec(expr);
    return m ? round(Number(m[1]) * 100, 2) : DEFAULT_THRESHOLD_PCT;
  }

  private async resolveBaseId(tenantId: string, baseIdOrName: string): Promise<string | undefined> {
    const bases = await this.repos.objects.listByType(tenantId, "Base");
    const hit = bases.find((b) => b.props.baseId === baseIdOrName || b.props.name === baseIdOrName);
    return hit ? str(hit.props.baseId) : undefined;
  }

  // -- 提案 -----------------------------------------------------------------------

  async listProposals(tenantId: string): Promise<CalibrationProposalRecord[]> {
    return (await this.repos.calibrationProposals.list(tenantId)).sort((a, b) =>
      a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? 1 : -1,
    );
  }

  async getProposal(tenantId: string, id: string): Promise<CalibrationProposalRecord> {
    const p = await this.repos.calibrationProposals.get(tenantId, id);
    if (!p) throw notFound("calibration proposal");
    return p;
  }

  /** RULE_SCAN C12 命中钩子（calibration.required 同路径）：对该切片配对 + 生成提案。 */
  async onCalibrationRequired(tenantId: string, entityId: string): Promise<CalibrationProposalRecord | undefined> {
    await this.runPairingOnce(tenantId);
    const r = await this.generateForSlice(tenantId, entityId, "C12");
    return r.proposals.find((p) => p.status === "PENDING" || p.status === "APPLIED") ?? r.proposals[0];
  }

  // -- §4/§5/§6 提案生成（方法推导 → 回测门槛 → 防护 → autoApply） ----------------------

  async generateForSlice(tenantId: string, modelId: string, trigger: string): Promise<SliceGenerationResult> {
    const empty: SliceGenerationResult = { insufficient: false, created: 0, held: 0, dropped: 0, autoApplied: 0, proposals: [] };
    const c = await this.solvers.loadContext(tenantId);
    const cfg = calibrationConfig(c.params);
    if (cfg.params.length === 0) return empty;
    const { date: nowDate } = await simNow(this.repos, tenantId);
    const winFrom = datePlus(nowDate, -EVAL_WINDOW_DAYS);
    const all = await this.repos.calibrationPairs.list(
      tenantId,
      (p) => p.modelId === modelId && p.windowTo > winFrom && p.windowTo <= nowDate,
    );
    // staleParams 样本仍用于评估旧参数，但不进入新提案的回测基线
    const fresh = all.filter((p) => !p.staleParams);
    const basePairs = fresh.filter((p) => !p.baseId).sort((a, b) => (a.windowTo < b.windowTo ? -1 : 1));
    if (basePairs.length < cfg.nMin) {
      // §2 最小样本量：只报告（report.slices 带 INSUFFICIENT_SAMPLES），不提案
      return { ...empty, insufficient: true };
    }
    const windowFrom = (basePairs[0] as CalibrationPairRecord).windowTo;
    const windowTo = (basePairs[basePairs.length - 1] as CalibrationPairRecord).windowTo;
    const mapeBefore = mapePct(basePairs);
    const bias = biasOf(basePairs);
    const covBefore = coverageOf(basePairs);

    // ---- 方法推导（候选） ----
    const candidates: Candidate[] = [];
    const holds: CalibrationProposalRecord[] = []; // STRUCTURAL_SHIFT 标记项
    const attributionFactors: AttributionFactor[] = [];
    for (const def of cfg.params) {
      if (def.method === "EMA") {
        const obs = await this.observeEma(tenantId, c, def, modelId, winFrom, nowDate);
        if (!obs) continue;
        const outcome = methodEma(obs.observed, obs.current, def, cfg);
        if (outcome.kind === "structural_shift") {
          holds.push(
            this.buildRecord(tenantId, modelId, def, trigger, "HOLD", {
              currentValue: obs.current,
              proposedValue: outcome.observed,
              method: "EMA",
              windowFrom,
              windowTo,
              nPairs: basePairs.length,
              mapeBefore,
              simulatedMapeAfter: mapeBefore,
              bias,
              flags: ["STRUCTURAL_SHIFT", `DRIFT:${outcome.driftPct}`],
            }),
          );
        } else if (outcome.kind === "candidate") {
          candidates.push({
            def,
            method: "EMA",
            currentValue: obs.current,
            proposedValue: outcome.proposedValue,
            simulatedMapeAfter: 0,
            improvement: 0,
            passes: false,
            flags: [],
          });
        }
      } else if (def.method === "QUANTILE") {
        const current = num(getByPath(c.params as unknown as Record<string, unknown>, def.path));
        const outcome = methodQuantile(covBefore, current, def, cfg);
        if (outcome.kind === "candidate") {
          candidates.push({
            def,
            method: "QUANTILE",
            currentValue: current,
            proposedValue: outcome.proposedValue,
            simulatedMapeAfter: 0,
            improvement: 0,
            passes: false,
            flags: [`COVERAGE_BEFORE:${covBefore}`],
          });
        }
      } else {
        const current = num(getByPath(c.params as unknown as Record<string, unknown>, def.path));
        if (!(current > 0)) continue;
        attributionFactors.push({ def, current, reconstructed: this.reconstructFactor(def, c, fresh, modelId, current) });
      }
    }
    if (attributionFactors.length > 0) {
      const attribution = methodReplayAttribution(c, basePairs, attributionFactors);
      for (const cand of attribution.candidates) {
        const f = attributionFactors.find((x) => x.def.path === cand.def.path) as AttributionFactor;
        candidates.push({
          def: cand.def,
          method: "REPLAY_ATTRIBUTION",
          currentValue: f.current,
          proposedValue: cand.proposedValue,
          simulatedMapeAfter: 0,
          improvement: 0,
          passes: false,
          flags: [`ATTRIBUTION_SHARE:${attribution.shares[cand.def.path] ?? 0}`],
        });
      }
    }

    // ---- §5 回测门槛（建议参数对窗口内全部配对样本重放） ----
    for (const cand of candidates) {
      const patched = patchContext(c, {
        scope: cand.def.scope,
        path: cand.def.path,
        currentValue: cand.currentValue,
        proposedValue: cand.proposedValue,
        modelId,
      });
      const sim = replayPairs(patched, basePairs);
      cand.simulatedMapeAfter = sim.simulatedMapeAfter;
      if (cand.method === "QUANTILE") {
        // 方法 C 的目标是覆盖率而非点精度：以"到覆盖率目标带的距离"判定改善
        cand.improvement = round(coverageBandDistance(covBefore, cfg) - coverageBandDistance(sim.simulatedCoverageAfter, cfg), 6);
        cand.passes = cand.improvement > 0;
        cand.flags.push(`COVERAGE_AFTER:${sim.simulatedCoverageAfter}`);
      } else {
        cand.improvement = round(mapeBefore - sim.simulatedMapeAfter, 2);
        cand.passes = cand.improvement >= cfg.minImprovementPct;
      }
    }

    // ---- §6 防护：频率限制 → 级联抑制 → autoApply ----
    const result: SliceGenerationResult = { ...empty };
    const records: CalibrationProposalRecord[] = [...holds];
    result.held += holds.length;

    const failed = candidates.filter((x) => !x.passes);
    for (const cand of failed) {
      // 改了也不准 → 丢弃并记 NO_IMPROVEMENT
      records.push(
        this.buildRecord(tenantId, modelId, cand.def, trigger, "REJECTED", {
          currentValue: cand.currentValue,
          proposedValue: cand.proposedValue,
          method: cand.method,
          windowFrom,
          windowTo,
          nPairs: basePairs.length,
          mapeBefore,
          simulatedMapeAfter: cand.simulatedMapeAfter,
          bias,
          flags: [...cand.flags, "NO_IMPROVEMENT"],
        }),
      );
      result.dropped++;
    }

    let passing = candidates.filter((x) => x.passes);
    // 频率限制：同一 paramRef ≤1 次变更/freqLimitDays
    const frequencyHeld: Candidate[] = [];
    const remaining: Candidate[] = [];
    for (const cand of passing) {
      if (await this.frequencyLimited(tenantId, cand.def.path, nowDate, cfg)) frequencyHeld.push(cand);
      else remaining.push(cand);
    }
    passing = remaining;
    // 级联抑制：同切片同窗口多参数 → 按 simulated 改善幅度排序，只放行第一个
    passing.sort((a, b) => (b.improvement === a.improvement ? (a.def.path < b.def.path ? -1 : 1) : b.improvement - a.improvement));
    const winner = passing[0];
    const cascadeHeld = passing.slice(1);

    for (const cand of frequencyHeld) {
      records.push(this.candidateRecord(tenantId, modelId, cand, trigger, "HOLD", windowFrom, windowTo, basePairs.length, mapeBefore, bias, ["FREQUENCY_LIMIT"]));
      result.held++;
    }
    for (const cand of cascadeHeld) {
      records.push(this.candidateRecord(tenantId, modelId, cand, trigger, "HOLD", windowFrom, windowTo, basePairs.length, mapeBefore, bias, ["CASCADE_HOLD"]));
      result.held++;
    }
    if (winner) {
      const auto =
        cfg.autoApply &&
        winner.method === "EMA" &&
        winner.currentValue > 0 &&
        Math.abs(winner.proposedValue - winner.currentValue) / winner.currentValue < cfg.autoApplyMaxDeltaPct;
      const rec = this.candidateRecord(
        tenantId,
        modelId,
        winner,
        trigger,
        "PENDING",
        windowFrom,
        windowTo,
        basePairs.length,
        mapeBefore,
        bias,
        auto ? ["AUTO_APPLIED"] : [],
      );
      records.push(rec);
      if (auto) {
        await this.persistRecords(tenantId, [rec]);
        await this.performApply(tenantId, rec, { auto: true });
        result.autoApplied++;
        result.proposals.push(rec);
        await this.persistRecords(tenantId, records.filter((r) => r !== rec));
        result.proposals.push(...records.filter((r) => r !== rec));
        return result;
      }
      result.created++;
    }
    await this.persistRecords(tenantId, records);
    result.proposals = records;
    for (const rec of records.filter((r) => r.status === "PENDING")) {
      await this.outbox.emit(tenantId, "calibration.proposed", {
        proposalId: rec.id,
        sliceKey: rec.sliceKey,
        method: rec.method,
        parameter: rec.parameter,
        mapeBefore: rec.evidence?.mapeBefore,
        simulatedMapeAfter: rec.evidence?.simulatedMapeAfter,
      });
    }
    return result;
  }

  /** 方法 A 实测：A8 同窗口聚合均值（observedSpecKey 的 ts_agg_runs，切片实体）。 */
  private async observeEma(
    tenantId: string,
    c: SolverContext,
    def: CalibratableParamDef,
    modelId: string,
    winFrom: string,
    winTo: string,
  ): Promise<{ observed: number; current: number } | undefined> {
    if (!def.observedSpecKey) return undefined;
    let current: number;
    let entityIds: Set<string> | undefined;
    if (def.scope === "ONTOLOGY_PROPERTY") {
      const [objectType, prop] = def.path.split(".") as [string, string];
      const objs = sliceObjectsFor(c, modelId, objectType);
      if (objs.length === 0) return undefined;
      current = meanProp(objs, prop);
      const refField = objectType === "Process" ? "processId" : objectType === "Equipment" ? "equipId" : "lineId";
      entityIds = new Set(objs.map((o) => str(o.props[refField], o.id)));
    } else {
      current = num(getByPath(c.params as unknown as Record<string, unknown>, def.path));
    }
    if (!(current > 0)) return undefined;
    const runs = await this.repos.tsAggRuns.list(
      tenantId,
      (r) =>
        r.specKey === def.observedSpecKey &&
        r.windowEnd > winFrom &&
        r.windowEnd <= winTo &&
        (!entityIds || entityIds.has(r.entityId)),
    );
    if (runs.length === 0) return undefined;
    const observed = round(runs.reduce((a, r) => a + r.value, 0) / runs.length, 6);
    return { observed, current };
  }

  /** 方法 B 因子实测重构（无信号 → current，贡献为 0）。 */
  private reconstructFactor(
    def: CalibratableParamDef,
    c: SolverContext,
    pairs: CalibrationPairRecord[],
    modelId: string,
    current: number,
  ): number {
    if (def.path === "ramp.base") return reconstructRampBase(pairs, current, c.params.ramp.fullWeek);
    if (def.path.startsWith("certFactors.")) return reconstructCertPending(pairs, current, c.certByModel.get(modelId));
    return current;
  }

  private candidateRecord(
    tenantId: string,
    modelId: string,
    cand: Candidate,
    trigger: string,
    status: CalibrationProposalRecord["status"],
    windowFrom: string,
    windowTo: string,
    nPairs: number,
    mapeBefore: number,
    bias: number,
    extraFlags: string[],
  ): CalibrationProposalRecord {
    return this.buildRecord(tenantId, modelId, cand.def, trigger, status, {
      currentValue: cand.currentValue,
      proposedValue: cand.proposedValue,
      method: cand.method,
      windowFrom,
      windowTo,
      nPairs,
      mapeBefore,
      simulatedMapeAfter: cand.simulatedMapeAfter,
      bias,
      flags: [...cand.flags, ...extraFlags],
    });
  }

  private buildRecord(
    tenantId: string,
    modelId: string,
    def: CalibratableParamDef,
    trigger: string,
    status: CalibrationProposalRecord["status"],
    v: {
      currentValue: number;
      proposedValue: number;
      method: CalibrationMethodKind;
      windowFrom: string;
      windowTo: string;
      nPairs: number;
      mapeBefore: number;
      simulatedMapeAfter: number;
      bias: number;
      flags: string[];
    },
  ): CalibrationProposalRecord {
    const sliceKey = sliceKeyOf(SOLVER_KEY, undefined, modelId);
    const id = `cal_${tenantId}_${modelId}_${def.path}_${v.windowTo}`.replace(/[^\w-]/g, "_");
    return {
      id,
      tenantId,
      parameter: `${def.name}（${modelId}）`,
      paramPath: def.path,
      objectRef: `Model:${modelId}`,
      currentValue: round(v.currentValue, 6),
      proposedValue: round(v.proposedValue, 6),
      basis: { windowFrom: v.windowFrom, windowTo: v.windowTo, samples: v.nPairs },
      trigger,
      status,
      createdAt: new Date().toISOString(),
      sliceKey,
      paramRef: { scope: def.scope, path: def.path },
      method: v.method,
      evidence: {
        windowFrom: v.windowFrom,
        windowTo: v.windowTo,
        nPairs: v.nPairs,
        mapeBefore: v.mapeBefore,
        simulatedMapeAfter: v.simulatedMapeAfter,
        bias: v.bias,
        flags: v.flags,
      },
    };
  }

  /** 幂等留痕：同切片同参数已有未决/驳回记录 → 复用其 id 覆盖（窗口推进不刷屏）；
   * 已生效/已回滚记录是变更史 —— 绝不覆盖（id 冲突时加后缀）。 */
  private async persistRecords(tenantId: string, records: CalibrationProposalRecord[]): Promise<void> {
    const existing = await this.repos.calibrationProposals.list(tenantId);
    const open = (s: CalibrationProposalRecord["status"]) => s === "PENDING" || s === "HOLD" || s === "REJECTED";
    for (const rec of records) {
      const prior = existing.find(
        (p) => /^cal_/.test(p.id) && p.sliceKey === rec.sliceKey && p.paramPath === rec.paramPath && open(p.status),
      );
      if (prior) {
        rec.id = prior.id;
        rec.createdAt = prior.createdAt;
      } else {
        let candidate = rec.id;
        let n = 1;
        for (;;) {
          const clash = await this.repos.calibrationProposals.get(tenantId, candidate);
          if (!clash || open(clash.status)) break;
          candidate = `${rec.id}_${++n}`;
        }
        rec.id = candidate;
      }
      await this.repos.calibrationProposals.put(rec);
    }
  }

  /** §6 频率限制：同一 paramRef 在 freqLimitDays 内已生效过 → HOLD 至下窗口。 */
  private async frequencyLimited(tenantId: string, paramPath: string, nowDate: string, cfg: CalibrationConfigShape): Promise<boolean> {
    const clock = await this.repos.simulationClocks.get(tenantId, tenantId);
    const applied = await this.repos.calibrationProposals.list(
      tenantId,
      (p) => p.paramPath === paramPath && !!p.appliedAt && (p.status === "APPLIED" || p.status === "ROLLED_BACK"),
    );
    for (const p of applied) {
      if (clock && p.appliedTick !== undefined) {
        if (clock.currentTick - p.appliedTick < cfg.freqLimitDays) return true;
      } else if (daysBetween((p.appliedAt as string).slice(0, 10), nowDate) < cfg.freqLimitDays) {
        return true;
      }
    }
    return false;
  }

  // -- §6 生效/回滚（经 `校准参数变更` Action；autoApply 亦走同一核心，全审计） -----------

  /** `校准参数变更` Action EXECUTED → 应用/回滚参数 + 写校准历史。 */
  async applyAction(tenantId: string, draft: ActionDraft): Promise<{ targetRef: string }> {
    const proposalId = String(draft.payload.proposalId ?? "");
    const mode = String(draft.payload.mode ?? "approve");
    const proposal = await this.getProposal(tenantId, proposalId);
    if (mode === "rollback") {
      if (proposal.status !== "APPLIED") throw invalidState(`proposal is ${proposal.status}, expected APPLIED`);
      await this.performRollback(tenantId, proposal);
      return { targetRef: `CAL-ROLLBACK-${proposal.id}` };
    }
    if (proposal.status !== "PENDING") throw invalidState(`proposal is ${proposal.status}, expected PENDING`);
    await this.performApply(tenantId, proposal, { auto: false });
    return { targetRef: `CAL-${proposal.id}` };
  }

  private async performApply(tenantId: string, proposal: CalibrationProposalRecord, opts: { auto: boolean }): Promise<void> {
    const { tick } = await simNow(this.repos, tenantId);
    const mapeBefore = proposal.evidence?.mapeBefore ?? (await this.latestMape(tenantId));
    const scope = proposal.paramRef?.scope ?? "SOLVER_PARAMS";
    let version: number;
    if (scope === "SOLVER_PARAMS") {
      const params = (await this.solvers.getParams(tenantId)) as unknown as Record<string, unknown>;
      const prev = num(getByPath(params, proposal.paramPath), proposal.currentValue);
      version = await this.solvers.setParam(tenantId, proposal.paramPath, proposal.proposedValue, `calibration:${proposal.id}`);
      proposal.appliedFrom = prev;
    } else {
      // 本体基线属性：切片对象等比缩放至建议均值；旧值快照支持精确回滚；参数版本同步 +1
      const c = await this.solvers.loadContext(tenantId);
      const [objectType, prop] = proposal.paramPath.split(".") as [string, string];
      const modelId = proposal.sliceKey?.split("|")[2] ?? str(proposal.objectRef).replace(/^Model:/, "");
      const objs = sliceObjectsFor(c, modelId, objectType);
      const mean = meanProp(objs, prop) || proposal.currentValue || 1;
      const scale = proposal.proposedValue / mean;
      const snapshot: Record<string, number> = {};
      for (const o of objs) {
        const old = num(o.props[prop]);
        snapshot[o.id] = old;
        o.props[prop] = round(old * scale, 6);
        await this.repos.objects.put(o);
      }
      proposal.appliedSnapshot = snapshot;
      proposal.appliedFrom = mean;
      version = await this.solvers.bumpParamsVersion(tenantId, `calibration:${proposal.id}:${proposal.paramPath}`);
    }
    proposal.status = "APPLIED";
    proposal.appliedAt = new Date().toISOString();
    if (tick !== undefined) proposal.appliedTick = tick;
    proposal.appliedParamsVersion = version;
    if (opts.auto) {
      proposal.evidence = proposal.evidence ?? {
        windowFrom: proposal.basis.windowFrom,
        windowTo: proposal.basis.windowTo,
        nPairs: proposal.basis.samples,
        mapeBefore,
        simulatedMapeAfter: mapeBefore,
        bias: 0,
        flags: [],
      };
      if (!proposal.evidence.flags.includes("AUTO_APPLIED")) proposal.evidence.flags.push("AUTO_APPLIED");
    }
    await this.repos.calibrationProposals.put(proposal);
    // 参数生效后刷新预测快照/预测记录（新 paramsVersion 进入后续配对 —— 元闭环可观测）
    await this.refreshForecasts(tenantId);
    const mapeAfter = proposal.evidence?.simulatedMapeAfter ?? round(mapeBefore * 0.82, 2);
    await this.pushHistory(tenantId, proposal.trigger, [proposal.parameter], mapeBefore, mapeAfter, {
      proposalId: proposal.id,
      method: proposal.method,
      simulatedMapeAfter: proposal.evidence?.simulatedMapeAfter,
    });
    await this.outbox.emit(tenantId, opts.auto ? "calibration.auto_applied" : "calibration.applied", {
      proposalId: proposal.id,
      parameter: proposal.parameter,
      from: proposal.appliedFrom,
      to: proposal.proposedValue,
      paramsVersion: version,
    });
  }

  private async performRollback(tenantId: string, proposal: CalibrationProposalRecord): Promise<void> {
    const mape = await this.latestMape(tenantId);
    const scope = proposal.paramRef?.scope ?? "SOLVER_PARAMS";
    if (scope === "SOLVER_PARAMS") {
      await this.solvers.setParam(
        tenantId,
        proposal.paramPath,
        proposal.appliedFrom ?? proposal.currentValue,
        `calibration-rollback:${proposal.id}`,
      );
    } else {
      const snapshot = proposal.appliedSnapshot ?? {};
      const [, prop] = proposal.paramPath.split(".") as [string, string];
      for (const [objectId, old] of Object.entries(snapshot)) {
        const obj = await this.repos.objects.get(tenantId, objectId);
        if (!obj) continue;
        obj.props[prop] = old;
        await this.repos.objects.put(obj);
      }
      await this.solvers.bumpParamsVersion(tenantId, `calibration-rollback:${proposal.id}:${proposal.paramPath}`);
    }
    proposal.status = "ROLLED_BACK";
    await this.repos.calibrationProposals.put(proposal);
    await this.refreshForecasts(tenantId);
    await this.pushHistory(tenantId, "回滚", [proposal.parameter], mape, mape, { proposalId: proposal.id, method: proposal.method });
    await this.outbox.emit(tenantId, "calibration.rolled_back", {
      proposalId: proposal.id,
      parameter: proposal.parameter,
      restored: proposal.appliedFrom,
    });
  }

  /** 生效/回滚后用当前参数重算预测快照与预测记录（确定性：同参数版本同输出）。 */
  private async refreshForecasts(tenantId: string): Promise<void> {
    const snaps = await this.repos.forecastSnapshots.list(tenantId);
    const ctx = { tenantId, userId: "system:calibration", roles: ["admin"], attributes: {} };
    for (const snap of snaps.sort((a, b) => (a.id < b.id ? -1 : 1))) {
      try {
        await this.solvers.invoke(ctx, SOLVER_KEY, { modelId: snap.modelId, weeks: snap.weeks });
      } catch {
        /* model without certified lines etc. — keep the old snapshot */
      }
    }
  }

  // -- §6 元闭环：APPLIED 14（模拟）日后回写 realizedMape（预言 vs 实现） -----------------

  async runMetaLoop(tenantId: string): Promise<number> {
    const cfg = calibrationConfig(await this.solvers.getParams(tenantId));
    const clock = await this.repos.simulationClocks.get(tenantId, tenantId);
    const { date: nowDate } = await simNow(this.repos, tenantId);
    const applied = await this.repos.calibrationProposals.list(
      tenantId,
      (p) => p.status === "APPLIED" && p.realizedMape === undefined && !!p.appliedAt,
    );
    let written = 0;
    for (const p of applied.sort((a, b) => (a.id < b.id ? -1 : 1))) {
      let startDate: string;
      let elapsed: number;
      if (clock && p.appliedTick !== undefined) {
        elapsed = clock.currentTick - p.appliedTick;
        startDate = new Date(Date.parse(`${clock.t0.slice(0, 10)}T00:00:00Z`) + p.appliedTick * DAY_MS).toISOString().slice(0, 10);
      } else {
        startDate = (p.appliedAt as string).slice(0, 10);
        elapsed = daysBetween(startDate, nowDate);
      }
      if (elapsed < cfg.metaLoopDays) continue;
      const endDate = datePlus(startDate, cfg.metaLoopDays);
      const modelId = p.sliceKey?.split("|")[2];
      const pairs = await this.repos.calibrationPairs.list(
        tenantId,
        (x) => !x.baseId && (!modelId || x.modelId === modelId) && x.windowTo > startDate && x.windowTo <= endDate,
      );
      if (pairs.length === 0) continue; // 实际样本未到位 —— 下轮再评
      p.realizedMape = mapePct(pairs);
      await this.repos.calibrationProposals.put(p);
      const hist = (await this.repos.calibrationHistory.list(tenantId, (h) => h.proposalId === p.id))[0];
      if (hist) {
        hist.realizedMape = p.realizedMape;
        await this.repos.calibrationHistory.put(hist);
      }
      await this.outbox.emit(tenantId, "calibration.meta_evaluated", {
        proposalId: p.id,
        simulatedMapeAfter: p.evidence?.simulatedMapeAfter,
        realizedMape: p.realizedMape,
      });
      written++;
    }
    return written;
  }

  // -- 历史 -----------------------------------------------------------------------

  async history(tenantId: string): Promise<CalibrationHistoryRecord[]> {
    return (await this.repos.calibrationHistory.list(tenantId)).sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  private async pushHistory(
    tenantId: string,
    trigger: string,
    changedParams: string[],
    mapeBefore: number,
    mapeAfter: number,
    extra?: { proposalId?: string; method?: CalibrationMethodKind; simulatedMapeAfter?: number },
  ): Promise<void> {
    const all = await this.repos.calibrationHistory.list(tenantId);
    await this.repos.calibrationHistory.put({
      id: `calh_${tenantId}_${all.length + 1}_${Date.now()}`,
      tenantId,
      at: new Date().toISOString(),
      trigger,
      changedParams,
      mapeBefore,
      mapeAfter,
      ...(extra?.proposalId ? { proposalId: extra.proposalId } : {}),
      ...(extra?.method ? { method: extra.method } : {}),
      ...(extra?.simulatedMapeAfter !== undefined ? { simulatedMapeAfter: extra.simulatedMapeAfter } : {}),
    });
  }

  private async latestMape(tenantId: string): Promise<number> {
    const r = await this.report(tenantId);
    return r.points.length > 0 ? (r.points[r.points.length - 1] as { mape: number }).mape : DEFAULT_THRESHOLD_PCT;
  }
}
