import { hashString, mulberry32, round } from "../prng.js";

/**
 * 派生序列规格（R13 结论可溯源）：达成率不再是独立 seed 的"裸数字"，而是由命名损因相乘算出——
 * `attainment = 设备效率达成 × 良率达成 × 排程事件损`。各因子确定性、可持久化、可逐日拆解（解释"为何未达成"
 * = 设备效率损 + 良率损 + 检修/周末/爬坡损）。计划基准（oeePlan/yieldPlan）为治理常量，由调用方从
 * solverParams 注入（R14 应用层无业务常数）。实际 OEE/良率分布镜像 oee:equip / yield:process 生成器。
 */
export interface TsGenDerive {
  kind: "attainment";
  /** 计划 OEE / 良率基准（治理目标，R14 config-driven）。达成 = 实际 / 计划。 */
  oeePlan: number;
  yieldPlan: number;
  /** 实际 OEE / 良率分布（镜像 oee:equip / yield:process，使派生与底层链路同源）。 */
  oeeMean: number;
  oeeNoise: number;
  yieldMean: number;
  yieldNoise: number;
}

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
  /** 派生序列：measureField 由 derive 命名损因相乘算出，并额外持久化各分量（R13 逐日拆因）。 */
  derive?: TsGenDerive;
}

/**
 * 派生达成率额外持久化的分量字段（逐日拆因 / 逐设备勾稽 R13）：
 * 设备效率达成 / 良率达成 / 产线实际OEE / 产线实际良率 / 排程标记（0正常·1周末·2检修）。
 * 注：demo 历史（generateHistory）走真拓扑 rollup 填 lineOee/lineYield（与 oee:equip×line / yield:process×line
 * 逐台勾稽）；simclock/livedin 前向逐 tick 经 genPoint 近似生成（无跨序列 rollup），仅填可算字段。
 */
export const ATTAIN_COMPONENT_FIELDS = ["oeeAttain", "yieldAttain", "lineOee", "lineYield", "eventFlag"] as const;

/** 排程标记：2 检修 / 1 周末 / 0 正常。由日期 + 检修窗口确定性派生。 */
export function attainEventFlag(dateIso: string, maintWindow: { start: string; end: string } | undefined): number {
  if (maintWindow && dateIso >= maintWindow.start && dateIso < maintWindow.end) return 2;
  const dow = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 ? 1 : 0;
}

/**
 * 逐设备勾稽核心（R13·单一来源）：产线达成率由该线**真实**设备/工序值算出——
 *   产线OEE = Σ(设备oee×产量)/Σ产量   产线良率 = avg(工序yield)
 *   达成率 = (产线OEE/计划OEE) × (产线良率/计划良率)，钳 [0.4,0.995]
 * 纯函数、确定性（R6）。被 generateHistory（历史）与 simclock（前向 tick）共用，消除"历史真 rollup、
 * 前向却镜像"的口径裂缝。缺数据回退计划基准（不放水）。
 */
export function rollupLineAttainment(
  equipOee: { oee: number; output: number }[],
  procYield: number[],
  plan: { oeePlan: number; yieldPlan: number },
  eventFlag: number,
): Record<string, number> {
  let wOee = 0;
  let wSum = 0;
  for (const e of equipOee) {
    wOee += e.oee * e.output;
    wSum += e.output;
  }
  const lineOee = wSum > 0 ? wOee / wSum : plan.oeePlan;
  const lineYield = procYield.length ? procYield.reduce((a, b) => a + b, 0) / procYield.length : plan.yieldPlan;
  const oeeAttain = round(lineOee / plan.oeePlan, 4);
  const yieldAttain = round(lineYield / plan.yieldPlan, 4);
  const attainment = Math.min(0.995, Math.max(0.4, round(oeeAttain * yieldAttain, 4)));
  return { attainment, oeeAttain, yieldAttain, lineOee: round(lineOee, 4), lineYield: round(lineYield, 4), eventFlag };
}

export interface TsGenEntity {
  entityId: string;
  baseId: string;
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
  // 派生分量（仅 attainment 派生序列）：设备效率达成 / 良率达成，逐日持久化以支持拆因。
  let oeeAttain = 0;
  let yieldAttain = 0;
  let v: number;
  if (spec.derive?.kind === "attainment") {
    // R13 真派生：达成率 = 设备效率达成 × 良率达成 × 排程事件损（事件损由下方共用 effects 块施加）。
    // 实际 OEE/良率独立确定性抽样（镜像 oee:equip / yield:process 分布），除以治理计划基准得达成分量。
    const d = spec.derive;
    const oeeRng = mulberry32(hashString(`${seed}|attain-oee|${entity.entityId}|${dateIso}`));
    const yieldRng = mulberry32(hashString(`${seed}|attain-yield|${entity.entityId}|${dateIso}`));
    const oeeActual = Math.min(0.995, Math.max(0.4, d.oeeMean + d.oeeNoise * gauss(oeeRng)));
    const yieldActual = Math.min(0.995, Math.max(0.4, d.yieldMean + d.yieldNoise * gauss(yieldRng)));
    oeeAttain = round(oeeActual / d.oeePlan, 4);
    yieldAttain = round(yieldActual / d.yieldPlan, 4);
    v = oeeAttain * yieldAttain; // 结构性基线（事件损前）
  } else {
    v = spec.base.mean + spec.base.noise * gauss(rng);
    if (spec.drift) v += spec.drift * dayIndex;
  }
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
  v = clampFor(spec, round(v, 4));
  const values: Record<string, number> = { [spec.measureField]: v };
  if (spec.derive?.kind === "attainment") {
    // 前向 tick 近似（simclock/livedin）：分量为镜像分布，事件经 effects 已乘入 v。
    // 排程标记 eventFlag：2 检修 / 1 周末 / 0 正常（demo 历史由 generateHistory 真 rollup 覆盖）。
    const dow = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
    const inMaint = !!(maintWindow && dateIso >= maintWindow.start && dateIso < maintWindow.end);
    values.oeeAttain = oeeAttain;
    values.yieldAttain = yieldAttain;
    values.eventFlag = inMaint ? 2 : dow === 0 || dow === 6 ? 1 : 0;
  }
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
