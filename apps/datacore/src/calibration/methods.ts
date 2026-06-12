import type { CalibrationPairRecord } from "../domain.js";
import { round } from "../prng.js";
import type { CalibratableParamDef, CalibrationConfigShape, SolverContext } from "../solvers/types.js";
import { clampBounds, EPS } from "./config.js";
import { buildReplayModel, patchContext, replayPredictedDaily } from "./replay.js";

/**
 * M11 §4 参数建议值推导 —— 三种方法的纯函数实现（确定性、可单测）：
 *   A = EMA（直接可观测）· B = 重放归因（间接系数）· C = 分位数匹配（P90 覆盖率）。
 */

export type MethodOutcome =
  | { kind: "candidate"; proposedValue: number }
  | { kind: "structural_shift"; observed: number; driftPct: number }
  | { kind: "none" };

// ---- 方法 A · EMA -----------------------------------------------------------

export function methodEma(
  observed: number,
  current: number,
  def: CalibratableParamDef,
  cfg: CalibrationConfigShape,
): MethodOutcome {
  if (!(current > 0) || !(observed > 0)) return { kind: "none" };
  const drift = Math.abs(observed - current) / current;
  // 结构性漂移闸门：>20% → 不出 EMA 提案，改出 STRUCTURAL_SHIFT 标记项（换线/大修后旧基线失效信号）
  if (drift > cfg.structuralDriftPct) {
    return { kind: "structural_shift", observed: round(observed, 6), driftPct: round(drift, 4) };
  }
  const proposed = clampBounds(round(cfg.alpha * observed + (1 - cfg.alpha) * current, 6), def);
  if (Math.abs(proposed - current) < EPS) return { kind: "none" };
  return { kind: "candidate", proposedValue: proposed };
}

// ---- 方法 C · 分位数匹配 ------------------------------------------------------

export function methodQuantile(
  cov: number,
  current: number,
  def: CalibratableParamDef,
  cfg: CalibrationConfigShape,
): MethodOutcome {
  const q = cfg.quantile;
  let proposed = current;
  if (cov < q.lowCov) proposed = current - q.step;
  else if (cov > q.highCov) proposed = current + q.step;
  proposed = clampBounds(Math.min(q.max, Math.max(q.min, round(proposed, 6))), def);
  if (Math.abs(proposed - current) < EPS) return { kind: "none" };
  return { kind: "candidate", proposedValue: proposed };
}

/** 方法 C 的回测口径：覆盖率到目标带 [lowCov, highCov] 的距离（点精度 MAPE 不适用）。 */
export function coverageBandDistance(cov: number, cfg: CalibrationConfigShape): number {
  if (cov < cfg.quantile.lowCov) return round(cfg.quantile.lowCov - cov, 6);
  if (cov > cfg.quantile.highCov) return round(cov - cfg.quantile.highCov, 6);
  return 0;
}

// ---- 方法 B · 重放归因 --------------------------------------------------------

export interface AttributionFactor {
  def: CalibratableParamDef;
  current: number;
  /** 实测重构值（从配对样本反推；无信号时 == current → 贡献为 0） */
  reconstructed: number;
}

export interface AttributionResult {
  shares: Record<string, number>; // path → |贡献| 占比
  candidates: { def: CalibratableParamDef; proposedValue: number }[];
}

/**
 * 对每个候选因子 f：贡献_f = Solver(基线参数, 但 f 用实测重构值) − Solver(全基线参数)（历史输入重放）；
 * 残余偏差按 |贡献_f| 占比分配；proposed_f = current_f × (1 + 分配偏差_f / 预测值)，单次变幅 clip ±10%。
 */
export function methodReplayAttribution(
  c: SolverContext,
  pairs: CalibrationPairRecord[],
  factors: AttributionFactor[],
): AttributionResult {
  if (pairs.length === 0 || factors.length === 0) return { shares: {}, candidates: [] };
  const modelId = (pairs[0] as CalibrationPairRecord).modelId;
  const baseModel = buildReplayModel(c);
  const basePred = (p: CalibrationPairRecord) => replayPredictedDaily(c, baseModel, p.modelId, p.baseId, p.weekOfWindow);

  // 单因子替换重放 → 平均贡献
  const contributions = new Map<string, number>();
  for (const f of factors) {
    if (Math.abs(f.reconstructed - f.current) < EPS) {
      contributions.set(f.def.path, 0);
      continue;
    }
    const patched = patchContext(c, {
      scope: f.def.scope,
      path: f.def.path,
      currentValue: f.current,
      proposedValue: f.reconstructed,
      modelId,
    });
    const patchedModel = buildReplayModel(patched);
    let sum = 0;
    for (const p of pairs) {
      sum += replayPredictedDaily(patched, patchedModel, p.modelId, p.baseId, p.weekOfWindow) - basePred(p);
    }
    contributions.set(f.def.path, sum / pairs.length);
  }

  const totalAbs = [...contributions.values()].reduce((a, v) => a + Math.abs(v), 0);
  const shares: Record<string, number> = {};
  for (const f of factors) {
    shares[f.def.path] = totalAbs < EPS ? 0 : round(Math.abs(contributions.get(f.def.path) ?? 0) / totalAbs, 4);
  }
  if (totalAbs < EPS) return { shares, candidates: [] };

  // 残余偏差 = mean(actual − predicted)（符号决定调参方向）
  const residual = pairs.reduce((a, p) => a + (p.actual - p.predicted), 0) / pairs.length;
  const predMean = pairs.reduce((a, p) => a + p.predicted, 0) / pairs.length;
  if (predMean < EPS) return { shares, candidates: [] };

  const candidates: { def: CalibratableParamDef; proposedValue: number }[] = [];
  for (const f of factors) {
    const share = shares[f.def.path] ?? 0;
    if (share < EPS) continue;
    let proposed = f.current * (1 + (share * residual) / predMean);
    // 小步长防震荡：单次变幅 clip ±10%
    proposed = Math.min(f.current * 1.1, Math.max(f.current * 0.9, proposed));
    proposed = clampBounds(round(proposed, 6), f.def);
    if (Math.abs(proposed - f.current) / Math.max(f.current, EPS) < 1e-4) continue;
    candidates.push({ def: f.def, proposedValue: proposed });
  }
  return { shares, candidates };
}

// ---- 因子实测重构（方法 B 的输入） ---------------------------------------------

/**
 * 爬坡系数：爬坡周与满产周的 actual/predicted 比值之比（均匀偏差 → 重构值 ≈ current → 零贡献）。
 */
export function reconstructRampBase(pairs: CalibrationPairRecord[], current: number, fullWeek: number): number {
  const ratio = (p: CalibrationPairRecord) => p.actual / Math.max(p.predicted, EPS);
  const ramp = pairs.filter((p) => !p.baseId && p.weekOfWindow < fullWeek);
  const full = pairs.filter((p) => !p.baseId && p.weekOfWindow >= fullWeek);
  if (ramp.length === 0 || full.length === 0) return current;
  const rampMean = ramp.reduce((a, p) => a + ratio(p), 0) / ramp.length;
  const fullMean = full.reduce((a, p) => a + ratio(p), 0) / full.length;
  if (fullMean < EPS) return current;
  return round(current * (rampMean / fullMean), 6);
}

/**
 * 认证中系数：认证中基地与量产基地的 actual/predicted 比值之比（按基地切片配对）。
 */
export function reconstructCertPending(
  pairs: CalibrationPairRecord[],
  current: number,
  certByBase: Map<string, string> | undefined,
): number {
  if (!certByBase) return current;
  const ratio = (p: CalibrationPairRecord) => p.actual / Math.max(p.predicted, EPS);
  const pending = pairs.filter((p) => p.baseId && certByBase.get(p.baseId) === "认证中");
  const prod = pairs.filter((p) => p.baseId && certByBase.get(p.baseId) === "量产");
  if (pending.length === 0 || prod.length === 0) return current;
  const pendingMean = pending.reduce((a, p) => a + ratio(p), 0) / pending.length;
  const prodMean = prod.reduce((a, p) => a + ratio(p), 0) / prod.length;
  if (prodMean < EPS) return current;
  return round(current * (pendingMean / prodMean), 6);
}
