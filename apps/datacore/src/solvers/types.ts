import type { ObjectInstance } from "../domain.js";

/** Typed view over the per-tenant solverParams JSONB (battery defaults in synthetic/battery.ts). */
export interface SolverParamsShape {
  forecastStart: string;
  packCellCount: number;
  certFactors: Record<string, number>;
  ramp: { base: number; step: number; fullWeek: number };
  maintMult: number;
  health: { normal: number; degraded: number; staleHours: number };
  whatIf: { nightShiftCoef: number; channelCoef: number; outsourceMax: number };
  logistics: { byAddress: Record<string, number>; defaultDays: number };
  bottleneck: {
    factors: string[];
    primary: Record<string, string>;
    defaultPrimary: string;
    mock: {
      mod: number;
      factorMult: number;
      primaryBase: number;
      primaryCap: number;
      secondaryBase: number;
      secondaryCap: number;
      utilHigh: number;
      utilHighAdd: number;
      utilLowAdd: number;
    };
    live: { oeeK: number; oeeBase: number; utilK: number; utilBase: number; yieldK: number; yieldBase: number };
  };
  risk: {
    threshold: number;
    cap: number;
    rampDen: number;
    pulseWindow: number;
    pulseDecayDen: number;
    psFloor: number;
    psStart: number;
    psDen: number;
    maxCards: number;
    targetLift: { base: number; mod: number };
    eventAmps: { maint_window: number; delivery_peak: number; arrival_gap: number };
    arrivalCycleDays: number;
    mitigations: Record<string, { key: string; name: string; eff: number; tn: number; cost: string; risk: string }[]>;
  };
  affected: {
    windowBefore: number;
    windowAfter: number;
    delayDiv: number;
    jitterMod: number;
    fallbackMax: number;
    /** §S1.5 修订: problems[] 4 类归并阈值 */
    problems: {
      creditBase: number;
      creditMod: number;
      gmFloor: number;
      essModels: string[];
      comModels: string[];
      ruleKeys: Record<string, string>;
    };
  };
  /** §7.14/§7.15 计划域参数 */
  planview: {
    seasonal: number[];
    rollingCorrPct: number[];
    growthYoY: number;
    weeksPerQuarter: number;
    increments: { quarter: string; name: string; delta: number }[];
    ltaMaterials: string[];
    ltaForcedPct: number;
    deliveryPeakMin: number;
    scenarios: {
      conservativeFactor: number;
      aggressiveFactor: number;
      finance: Record<string, { cashCushion: number; capex: number; irr: number }>;
    };
  };
  audit: {
    segTolerance: number;
    gapHard: number;
    gapSoft: number;
    gmHardOver: number;
    gmSoftUnder: number;
    kitHard: number;
    kitFixTons: number;
    cashHard: number;
    cashSoft: number;
    essShareBaseline: number;
    essShareTol: number;
    capexSoft: number;
    segMargins: { pas: number; ess: number; com: number };
    scoreH: number;
    scoreM: number;
    passScore: number;
    condScore: number;
  };
  planGenerate: {
    base: { rev: number; gm: number; share: number; turns: number; cash: number };
    targets: { gmFloor: number; cashFloor: number; capexCap: number };
    paths: Record<string, { name: string; rev: number; gm: number; share: number; capex: number; turns: number; cash: number }>;
    scores: {
      profitBase: number;
      profitK: number;
      scaleBase: number;
      scaleK: number;
      cashBase: number;
      cashK: number;
      growthBase: number;
      growthK: number;
      stabBase: number;
      stabK: number;
      hardPenalty: number;
    };
    schemeNames: { steady: string; balanced: string; aggressive: string };
    gains: Record<string, string[]>;
    gives: Record<string, string[]>;
  };
  sop: { gapRed: number; dvThreshold: number; cashFloor: number; monthlyWeeks: number; gmTolerance: number };
  dupSimilarityThreshold: number;
}

/** Ontology slice snapshot every solver computes from (deterministic input). */
export interface SolverContext {
  tenantId: string;
  params: SolverParamsShape;
  bases: ObjectInstance[];
  lines: ObjectInstance[];
  processes: ObjectInstance[];
  equipment: ObjectInstance[];
  maintPlans: ObjectInstance[];
  models: ObjectInstance[];
  orders: ObjectInstance[];
  shipments: ObjectInstance[];
  segments: ObjectInstance[];
  dataHealth: ObjectInstance[];
  /** modelId → baseId → 量产 | 认证中 (from model_certified_on edge props). */
  certByModel: Map<string, Map<string, string>>;
}

export function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Days between forecastStart and an ISO date (date — start, in whole days). */
export function dayFrom(startIso: string, dateIso: string): number {
  return Math.round((Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${startIso.slice(0, 10)}T00:00:00Z`)) / 86400000);
}

export function baseName(c: SolverContext, baseId: string): string {
  const b = c.bases.find((x) => x.props.baseId === baseId);
  return str(b?.props.name, baseId);
}

export function maintWeekOf(c: SolverContext, baseId: string): number | null {
  const mp = c.maintPlans.find((m) => m.props.baseId === baseId);
  return mp ? num(mp.props.week) : null;
}
