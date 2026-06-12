import type { CalibrationPairRecord } from "../domain.js";
import { round } from "../prng.js";
import { datePlus } from "./config.js";

/**
 * M11 §2 误差度量：MAPE（%）/ Bias = Σerror/Σactual / 覆盖率 cov = P(actual ≥ P90预测)。
 * 全部纯函数 —— 同一配对集合同输出。
 */

export function mapePct(pairs: CalibrationPairRecord[]): number {
  if (pairs.length === 0) return 0;
  return round((pairs.reduce((a, p) => a + p.ape, 0) / pairs.length) * 100, 2);
}

export function biasOf(pairs: CalibrationPairRecord[]): number {
  const sumActual = pairs.reduce((a, p) => a + p.actual, 0);
  if (sumActual === 0) return 0;
  return round(pairs.reduce((a, p) => a + p.error, 0) / sumActual, 4);
}

export function coverageOf(pairs: CalibrationPairRecord[]): number {
  if (pairs.length === 0) return 0;
  return round(pairs.filter((p) => p.actual >= p.predictedP90).length / pairs.length, 4);
}

/** 滚动 N 天 MAPE 序列（按窗口末日聚合；date 点 = (date−N, date] 内全部配对）。 */
export function rollingMapeSeries(pairs: CalibrationPairRecord[], windowDays: number): { date: string; mape: number }[] {
  const dates = [...new Set(pairs.map((p) => p.windowTo))].sort();
  return dates.map((date) => {
    const from = datePlus(date, -windowDays);
    const inWin = pairs.filter((p) => p.windowTo > from && p.windowTo <= date);
    return { date, mape: mapePct(inWin) };
  });
}

export interface SliceMetrics {
  sliceKey: string;
  solverKey: string;
  baseId: string;
  modelId: string;
  nPairs: number;
  mape7d: number;
  mape30d: number;
  bias: number;
  coverage: number;
  flags: string[];
}

/** §2 维度切片：solverKey × 基地 × 型号；n < nMin → INSUFFICIENT_SAMPLES（只报告不提案）。 */
export function buildSlices(pairs: CalibrationPairRecord[], nMin: number): SliceMetrics[] {
  const bySlice = new Map<string, CalibrationPairRecord[]>();
  for (const p of pairs) {
    const arr = bySlice.get(p.sliceKey) ?? [];
    arr.push(p);
    bySlice.set(p.sliceKey, arr);
  }
  const out: SliceMetrics[] = [];
  for (const [sliceKey, slicePairs] of [...bySlice.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const latest = slicePairs.map((p) => p.windowTo).sort().pop() as string;
    const from7 = datePlus(latest, -7);
    const from30 = datePlus(latest, -30);
    const sample = slicePairs[0] as CalibrationPairRecord;
    out.push({
      sliceKey,
      solverKey: sample.solverKey,
      baseId: sample.baseId ?? "all",
      modelId: sample.modelId,
      nPairs: slicePairs.length,
      mape7d: mapePct(slicePairs.filter((p) => p.windowTo > from7)),
      mape30d: mapePct(slicePairs.filter((p) => p.windowTo > from30)),
      bias: biasOf(slicePairs),
      coverage: coverageOf(slicePairs),
      flags: slicePairs.length < nMin ? ["INSUFFICIENT_SAMPLES"] : [],
    });
  }
  return out;
}
