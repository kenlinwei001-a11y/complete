import type { CalibrationReport } from "@platform/contracts";
import type { ActionDraft, CalibrationHistoryRecord, CalibrationProposalRecord } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { OutboxService } from "./outbox.js";
import { mulberry32, hashString, round } from "./prng.js";
import { invalidState, notFound } from "./errors.js";

const DAY_MS = 86400000;
const BASELINE_DAYS = 14;
const DEFAULT_THRESHOLD_PCT = 8;

export interface CalibrationReportQuery {
  objectType?: string;
  solverKey?: string;
  baseId?: string;
  from?: string;
}

/**
 * M11 校准（§7.21）：
 * - 精度趋势：MAPE 序列来自 A8 模拟时钟产生的 forecast_dev 聚合（ts_agg_runs）；
 *   无 tick 历史时返回确定性种子基线序列（页面不空）。阈值线 = C12（8%）。
 * - 参数更新提案：C12 命中时生成（calibration.required 路径挂钩）+ 种子 2 条 PENDING。
 * - 批准/回滚一律经 `校准参数变更` Action（§S2 审批链）执行；EXECUTED 后才写 solver_params，
 *   并落一条校准历史 —— "越用越准"的证据链。
 */
export class CalibrationService {
  constructor(
    private repos: Repos,
    private outbox: OutboxService,
  ) {}

  // -- 精度趋势 -------------------------------------------------------------------

  async report(tenantId: string, q: CalibrationReportQuery = {}): Promise<CalibrationReport> {
    const thresholdPct = await this.thresholdPct(tenantId);
    let runs = await this.repos.tsAggRuns.list(tenantId, (r) => r.specKey === "forecast_dev_daily");
    if (q.objectType && q.objectType !== "Model") runs = []; // forecast_dev 仅挂 Model
    if (q.solverKey && q.solverKey !== "capacity_forecast") runs = [];
    let points: { date: string; mape: number }[];
    if (runs.length > 0) {
      // A8 tick 真数据：按窗口末日聚合（多实体取均值）
      const byDate = new Map<string, number[]>();
      for (const r of runs) {
        const arr = byDate.get(r.windowEnd) ?? [];
        arr.push(r.value);
        byDate.set(r.windowEnd, arr);
      }
      points = [...byDate.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([date, vals]) => ({ date, mape: round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100, 2) }));
    } else {
      points = await this.baselineSeries(tenantId, q.baseId);
    }
    if (q.from) points = points.filter((p) => p.date >= (q.from as string));
    // C12 触发标记：序列中越过阈值的点（与 calibration.required 触发口径一致）
    const triggerMarks = points.filter((p) => p.mape > thresholdPct).map((p) => ({ date: p.date, ruleKey: "C12" }));
    return { points, thresholdPct, triggerMarks };
  }

  /** 无 tick 历史时的确定性基线（seed 派生；缓慢收敛 —— 演示线 T9 的静态起点）。 */
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

  /** RULE_SCAN C12 命中钩子（calibration.required 同路径）：幂等生成 PENDING 提案。 */
  async onCalibrationRequired(tenantId: string, entityId: string): Promise<CalibrationProposalRecord | undefined> {
    const id = `calp_${tenantId}_c12_${entityId}`.replace(/[^\w-]/g, "_");
    const existing = await this.repos.calibrationProposals.get(tenantId, id);
    if (existing && existing.status === "PENDING") return existing;
    const params = await this.currentParams(tenantId);
    const current = num(getByPath(params, "ramp.base"), 0.88);
    const runs = await this.repos.tsAggRuns.list(tenantId, (r) => r.specKey === "forecast_dev_daily" && r.entityId === entityId);
    const windows = runs.map((r) => r.windowEnd).sort();
    const rec: CalibrationProposalRecord = {
      id,
      tenantId,
      parameter: `产能预测·爬坡系数基线（${entityId}）`,
      paramPath: "ramp.base",
      objectRef: `Model:${entityId}`,
      currentValue: current,
      proposedValue: round(current + 0.01, 4),
      basis: {
        windowFrom: windows[0] ?? "",
        windowTo: windows[windows.length - 1] ?? "",
        samples: Math.max(runs.length, 1),
      },
      trigger: "C12",
      status: "PENDING",
      createdAt: new Date().toISOString(),
    };
    await this.repos.calibrationProposals.put(rec);
    return rec;
  }

  // -- Action 执行回调（不提供直改路径） ----------------------------------------------

  /** `校准参数变更` Action EXECUTED → 应用/回滚参数 + 写校准历史。 */
  async applyAction(tenantId: string, draft: ActionDraft): Promise<{ targetRef: string }> {
    const proposalId = String(draft.payload.proposalId ?? "");
    const mode = String(draft.payload.mode ?? "approve");
    const proposal = await this.getProposal(tenantId, proposalId);
    const mapeBefore = await this.latestMape(tenantId);
    if (mode === "rollback") {
      if (proposal.status !== "APPLIED") throw invalidState(`proposal is ${proposal.status}, expected APPLIED`);
      await this.writeParam(tenantId, proposal.paramPath, proposal.appliedFrom ?? proposal.currentValue);
      proposal.status = "ROLLED_BACK";
      await this.repos.calibrationProposals.put(proposal);
      await this.pushHistory(tenantId, "回滚", [proposal.parameter], mapeBefore, mapeBefore);
      return { targetRef: `CAL-ROLLBACK-${proposal.id}` };
    }
    if (proposal.status !== "PENDING") throw invalidState(`proposal is ${proposal.status}, expected PENDING`);
    const params = await this.currentParams(tenantId);
    const prev = num(getByPath(params, proposal.paramPath), proposal.currentValue);
    await this.writeParam(tenantId, proposal.paramPath, proposal.proposedValue);
    proposal.status = "APPLIED";
    proposal.appliedFrom = prev;
    proposal.appliedAt = new Date().toISOString();
    await this.repos.calibrationProposals.put(proposal);
    // 前后 MAPE 对比：后值为确定性收敛估计（真实后验由后续 tick 的 forecast_dev 序列接管）
    const mapeAfter = round(mapeBefore * 0.82, 2);
    await this.pushHistory(tenantId, proposal.trigger, [proposal.parameter], mapeBefore, mapeAfter);
    await this.outbox.emit(tenantId, "calibration.applied", {
      proposalId: proposal.id,
      parameter: proposal.parameter,
      from: prev,
      to: proposal.proposedValue,
    });
    return { targetRef: `CAL-${proposal.id}` };
  }

  async history(tenantId: string): Promise<CalibrationHistoryRecord[]> {
    return (await this.repos.calibrationHistory.list(tenantId)).sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  private async pushHistory(
    tenantId: string,
    trigger: string,
    changedParams: string[],
    mapeBefore: number,
    mapeAfter: number,
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
    });
  }

  private async latestMape(tenantId: string): Promise<number> {
    const r = await this.report(tenantId);
    return r.points.length > 0 ? (r.points[r.points.length - 1] as { mape: number }).mape : DEFAULT_THRESHOLD_PCT;
  }

  private async currentParams(tenantId: string): Promise<Record<string, unknown>> {
    const rec = await this.repos.solverParams.get(tenantId, `spar_${tenantId}`);
    return (rec?.params ?? {}) as Record<string, unknown>;
  }

  private async writeParam(tenantId: string, path: string, value: number): Promise<void> {
    const id = `spar_${tenantId}`;
    const rec = await this.repos.solverParams.get(tenantId, id);
    const params = (rec?.params ?? {}) as Record<string, unknown>;
    setByPath(params, path, value);
    await this.repos.solverParams.put({
      id,
      tenantId,
      params,
      version: (rec?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    });
  }
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function getByPath(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const k = segs[i] as string;
    const next = cur[k];
    if (next == null || typeof next !== "object") {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1] as string] = value;
}
