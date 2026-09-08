import { hashString, mulberry32, round } from "../prng.js";

/** Battery-pack extension of the A8.6 tsGenerator contract (measure/weight names). */
export interface TsGenSpec {
  seriesKey: string;
  entityType: string;
  grain: "shift" | "day";
  base: { mean: number; noise: number };
  drift?: number;
  effects?: ("weekend_dip" | "maint_window_dip" | "ramp_curve")[];
  measureField: string;
  weightField?: string;
}

export interface TsGenEntity {
  entityId: string;
  baseId: string;
  /**
   * WO-SCALE-COHERENCE（R18 realized 层）：绝对量序列(output:line)的 per-base 尺度因子。
   * 令实现产出 = 基地夹定产能 × 排产达成率，与 computeRollup 的 gwh 派生产能同锚（否则实现/预测脱尺度 →
   * 校准 MAPE 恒高、良率信号被淹）。仅绝对量序列由调用方按 seriesKey 传入；比率/占比序列不传(=1)。
   */
  scale?: number;
}

export interface ScenarioModifiers {
  /** util:line additive boost (yield_drop). */
  utilBoost?: number;
  /** yield:process multiplicative factor (yield_drop). */
  yieldFactor?: number;
}

const DAY_MS = 86400000;

/** Deterministic gaussian: Box–Muller over a per-(seed,series,entity,day) PRNG. */
export function gauss(rng: () => number): number {
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function clampFor(spec: TsGenSpec, v: number): number {
  if (spec.seriesKey.startsWith("oee") || spec.seriesKey.startsWith("yield") || spec.seriesKey.startsWith("attainment")) {
    return Math.min(0.995, Math.max(0.4, v));
  }
  if (spec.seriesKey.startsWith("util")) return Math.min(99.5, Math.max(40, v));
  return Math.max(0, v);
}

/**
 * One deterministic point per (generator, entity, day). `dayIndex` counts from
 * the start of the 90-day history (0..89 history, 90+ ticks) so drift and the
 * ramp curve continue seamlessly across the t0 boundary. Same (seed, series,
 * entity, day) → identical value — tick replays are byte-identical.
 */
export function genPoint(
  spec: TsGenSpec,
  entity: TsGenEntity,
  dateIso: string,
  dayIndex: number,
  seed: number,
  maintWindow: { start: string; end: string } | undefined,
  scenario?: ScenarioModifiers,
): Record<string, number> {
  const rng = mulberry32(hashString(`${seed}|${spec.seriesKey}|${entity.entityId}|${dateIso}`));
  let v = spec.base.mean + spec.base.noise * gauss(rng);
  if (spec.drift) v += spec.drift * dayIndex;
  const effects = spec.effects ?? [];
  if (effects.includes("weekend_dip")) {
    const dow = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) v *= 0.88;
  }
  if (effects.includes("maint_window_dip") && maintWindow && dateIso >= maintWindow.start && dateIso < maintWindow.end) {
    v *= 0.72;
  }
  if (effects.includes("ramp_curve")) {
    const week = Math.floor(dayIndex / 7);
    if (week < 4) v *= 0.88 + 0.03 * week;
  }
  if (scenario) {
    if (spec.seriesKey.startsWith("util") && scenario.utilBoost) v += scenario.utilBoost;
    if (spec.seriesKey.startsWith("yield") && scenario.yieldFactor) v *= scenario.yieldFactor;
  }
  // WO-SCALE-COHERENCE：绝对量序列按 per-base gwh 派生尺度缩放（均值/噪声/漂移/剧本效应同比 → 相对结构不变）。
  if (entity.scale && entity.scale !== 1) v *= entity.scale;
  v = clampFor(spec, round(v, 4));
  const values: Record<string, number> = { [spec.measureField]: v };
  if (spec.weightField) {
    values[spec.weightField] = round(800 + 400 * rng(), 2);
  }
  return values;
}

/** Maintenance windows per base: the historic occurrence + the forecast-week occurrence. */
export function maintWindowsFor(
  maintPlans: { baseId: string; week: number; lastMaintStart: string }[],
  t0Iso: string,
): Map<string, { start: string; end: string }[]> {
  const t0 = Date.parse(`${t0Iso.slice(0, 10)}T00:00:00Z`);
  const map = new Map<string, { start: string; end: string }[]>();
  for (const mp of maintPlans) {
    const hist = Date.parse(`${mp.lastMaintStart}T00:00:00Z`);
    const future = t0 + (mp.week - 1) * 7 * DAY_MS;
    map.set(mp.baseId, [
      { start: new Date(hist).toISOString().slice(0, 10), end: new Date(hist + 7 * DAY_MS).toISOString().slice(0, 10) },
      { start: new Date(future).toISOString().slice(0, 10), end: new Date(future + 7 * DAY_MS).toISOString().slice(0, 10) },
    ]);
  }
  return map;
}

export function windowFor(
  windows: Map<string, { start: string; end: string }[]>,
  baseId: string,
  dateIso: string,
): { start: string; end: string } | undefined {
  return (windows.get(baseId) ?? []).find((w) => dateIso >= w.start && dateIso < w.end);
}
