import type { CalibrationPairRecord } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { SolverService } from "../solvers/service.js";
import { num } from "../solvers/types.js";
import { round } from "../prng.js";
import { DAY_MS, EPS, datePlus, sliceKeyOf } from "./config.js";

/**
 * M11 §1 配对引擎：配对键 (solverKey, entityRef, targetWindow)。
 * - 预测记录在窗口**完全过期 + 数据新鲜度正常**后参与配对（源延迟 → 推迟，绝不用残缺实际值污染样本）；
 * - 实际值 = A8 同窗口聚合（ts_agg_runs / line_output_daily）；
 * - error = predicted − actual；ape = |error| / max(actual, ε)；
 * - 一个预测只配对一次；paramsVersion 与当前不同 → staleParams 标记。
 */

export interface PairingResult {
  paired: number;
  deferred: number;
  staleDeferred: boolean;
}

/** "现在"：模拟时钟激活时 = t0 + currentTick（模拟日）；否则取墙钟日期。 */
export async function simNow(repos: Repos, tenantId: string): Promise<{ date: string; tick?: number }> {
  const clock = await repos.simulationClocks.get(tenantId, tenantId);
  if (!clock) return { date: new Date().toISOString().slice(0, 10) };
  return {
    date: new Date(Date.parse(`${clock.t0.slice(0, 10)}T00:00:00Z`) + clock.currentTick * DAY_MS).toISOString().slice(0, 10),
    tick: clock.currentTick,
  };
}

export async function runPairing(repos: Repos, solvers: SolverService, tenantId: string): Promise<PairingResult> {
  const params = await solvers.getParams(tenantId);
  const { date: nowDate } = await simNow(repos, tenantId);
  const unpaired = await repos.calibrationForecasts.list(tenantId, (f) => !f.pairedAt);
  // 窗口完全过期 = 窗口末日早于"今天"（当日数据尚在产生中，不参与）
  const due = unpaired.filter((f) => f.windowTo < nowDate);
  if (due.length === 0) return { paired: 0, deferred: unpaired.length, staleDeferred: false };

  // 数据新鲜度闸门（与 C09 同一事实源）：关键源延迟 → 全部推迟配对
  const health = await repos.objects.listByType(tenantId, "DataSourceHealth");
  const stale = health.some((h) => h.props.critical === true && num(h.props.lagHours) > params.health.staleHours);
  if (stale) return { paired: 0, deferred: unpaired.length, staleDeferred: true };

  // 实际值索引：line_output_daily（A8 ts_agg_runs，日窗口、按产线）→ 按基地聚合。
  // SA-3 Workshop 层后一个基地的 10 条"产线"实为 10 道串行工序车间（制浆→…→PACK），
  // 物料顺次流经各车间，基地当日成品产出 = 单道代表工序吞吐（各车间产出的均值），
  // 而非各车间产出之和（求和会把同一批在制品按车间数重复计入）。此口径与被校准的
  // 预测（基地产能受共享化成/老化瓶颈约束 ≈ 单产线当量）同尺度，也与 Workshop 前单产线口径一致。
  const runs = await repos.tsAggRuns.list(tenantId, (r) => r.specKey === "line_output_daily");
  const lines = await repos.objects.listByType(tenantId, "Line");
  const baseByLine = new Map<string, string>();
  for (const l of lines) baseByLine.set(String(l.props.lineId ?? l.id), String(l.props.baseId ?? ""));
  const outSumByBaseDate = new Map<string, number>();
  const outCntByBaseDate = new Map<string, number>();
  for (const r of runs) {
    const b = baseByLine.get(String(r.entityId));
    if (!b) continue;
    const key = `${b}|${r.windowEnd}`;
    outSumByBaseDate.set(key, (outSumByBaseDate.get(key) ?? 0) + r.value);
    outCntByBaseDate.set(key, (outCntByBaseDate.get(key) ?? 0) + 1);
  }
  const outByBaseDate = new Map<string, number>();
  for (const [key, sum] of outSumByBaseDate) outByBaseDate.set(key, sum / (outCntByBaseDate.get(key) ?? 1));

  const c = await solvers.loadContext(tenantId);
  const currentVersion = await solvers.paramsVersion(tenantId);
  const pairedAt = new Date().toISOString();
  let paired = 0;
  let deferred = unpaired.length - due.length;

  for (const f of [...due].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const cert = c.certByModel.get(f.modelId);
    if (!cert || cert.size === 0) {
      deferred++;
      continue;
    }
    const baseIds = f.baseId ? [f.baseId] : [...cert.keys()].sort();
    // 同窗口实际值（窗口内每日每产线的聚合都必须在 —— 残缺则推迟）
    let cells = 0;
    let days = 0;
    let complete = true;
    for (let d = f.windowFrom; d <= f.windowTo && complete; d = datePlus(d, 1)) {
      days++;
      for (const b of baseIds) {
        const v = outByBaseDate.get(`${b}|${d}`);
        if (v === undefined) {
          complete = false;
          break;
        }
        cells += v;
      }
    }
    if (!complete || days === 0) {
      deferred++;
      continue;
    }
    const actual = round(cells / params.packCellCount / 10000 / days, 6);
    const error = round(f.predicted - actual, 6);
    const ape = round(Math.abs(error) / Math.max(actual, EPS), 6);
    const pair: CalibrationPairRecord = {
      id: `calpair_${tenantId}_${f.solverKey}_${f.modelId}_${f.baseId ?? "all"}_${f.windowTo}`.replace(/[^\w-]/g, "_"),
      tenantId,
      solverKey: f.solverKey,
      entityRef: f.baseId ? `Model:${f.modelId}@Base:${f.baseId}` : `Model:${f.modelId}`,
      modelId: f.modelId,
      ...(f.baseId ? { baseId: f.baseId } : {}),
      windowFrom: f.windowFrom,
      windowTo: f.windowTo,
      predicted: f.predicted,
      predictedP90: f.predictedP90,
      actual,
      error,
      ape,
      paramsVersion: f.paramsVersion,
      staleParams: f.paramsVersion !== currentVersion,
      sliceKey: sliceKeyOf(f.solverKey, f.baseId, f.modelId),
      weekOfWindow: f.weekOfWindow,
      pairedAt,
    };
    await repos.calibrationPairs.put(pair);
    f.pairedAt = pairedAt; // 一个预测只配对一次
    await repos.calibrationForecasts.put(f);
    paired++;
  }
  return { paired, deferred, staleDeferred: false };
}
