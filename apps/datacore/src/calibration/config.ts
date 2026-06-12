import type { CalibratableParamDef, CalibrationConfigShape, SolverParamsShape } from "../solvers/types.js";

export const EPS = 1e-6;
export const DAY_MS = 86400000;

/** 评估窗口（滚动 30 天 —— 提案证据窗口与 §2 双口径的长口径一致）。 */
export const EVAL_WINDOW_DAYS = 30;

const DEFAULT_CONFIG: CalibrationConfigShape = {
  alpha: 0.3,
  structuralDriftPct: 0.2,
  minImprovementPct: 1,
  nMin: 10,
  autoApply: false,
  autoApplyMaxDeltaPct: 0.05,
  freqLimitDays: 7,
  metaLoopDays: 14,
  quantile: { lowCov: 0.85, highCov: 0.95, step: 0.01, min: 0.85, max: 0.98 },
  params: [],
};

/** 场景包配置（solverParams.calibration），缺省回落到内置默认。 */
export function calibrationConfig(params: SolverParamsShape): CalibrationConfigShape {
  const cfg = params.calibration;
  if (!cfg) return DEFAULT_CONFIG;
  return {
    ...DEFAULT_CONFIG,
    ...cfg,
    quantile: { ...DEFAULT_CONFIG.quantile, ...(cfg.quantile ?? {}) },
    params: Array.isArray(cfg.params) ? cfg.params : [],
  };
}

export function clampBounds(v: number, def: CalibratableParamDef): number {
  const [lo, hi] = def.bounds;
  return Math.min(hi, Math.max(lo, v));
}

export function datePlus(dateIso: string, days: number): string {
  return new Date(Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)) / DAY_MS,
  );
}

export function sliceKeyOf(solverKey: string, baseId: string | undefined, modelId: string): string {
  return `${solverKey}|${baseId ?? "all"}|${modelId}`;
}
