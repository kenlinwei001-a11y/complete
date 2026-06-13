import { hashString, mulberry32, round } from "../prng.js";
import { clampFor, gauss, type TsGenEntity, type TsGenSpec } from "../synthetic/tsgen.js";

/**
 * 运营态出厂配置增量 §1：一年期（T−365d → T0）确定性时序生成器。
 *
 * 与 90 天标准历史（synthetic/tsgen.genPoint）的差别只有叙事弧线（§1.3）：
 * ① 全年爬坡 —— OEE/产出/利用率/达成率基线 ×(0.86 → 1.0)，约第 300 天打满，
 *    与 §1.2「OEE 全年爬坡 0.86→1.0」逐字对应；良率走温和爬坡（0.97 → 1.0）。
 * ② Q2 检修季 —— 各基地错峰检修（窗口 = MaintPlan.lastMaintStart 起 14 天，
 *    与本体检修计划对象同源/同月），窗口内 ×0.72，月度产出可见下凹（Y3）。
 * ③ 事件（incident）下凹-消解曲线 —— 10 例告警-处置闭环案例（含 Q4 到货危机）
 *    在对应基地/时间窗内产生「越线 → 采纳方案 → 曲线消解」的形状（Y4/前端案例回放）。
 *
 * 确定性：同 (seed, seriesKey, entityId, dateIso) → 同值（独立于标准 90 天流）。
 */

const DAY_MS = 86400000;

/** 事件（案例）窗口：from→low 线性下探至 depth，low→adopted 持平，adopted→to 线性恢复。 */
export interface LivedIncident {
  from: string; // 影响开始（越线前数日）
  low: string; // 越线日（crossedAt）
  adopted: string; // 采纳处置方案日
  to: string; // 曲线消解日（resolvedAt）
  depth: number; // 谷底乘数（到货危机 0.78，普通案例 ~0.86）
}

export interface LivedGenContext {
  seed: number;
  /** 回放起点（T−365d）的 epoch ms —— dayIndex 锚点。 */
  replayFromMs: number;
  /** 每基地检修窗口（14 天，[start, end)），源自 MaintPlan.lastMaintStart。 */
  maint: Map<string, { start: string; end: string }>;
  /** 每基地事件窗口列表（告警-处置闭环案例）。 */
  incidents: Map<string, LivedIncident[]>;
}

function lerpDate(dateIso: string, fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  const x = Date.parse(`${dateIso}T00:00:00Z`);
  if (b <= a) return 1;
  return Math.min(1, Math.max(0, (x - a) / (b - a)));
}

/** 事件乘数：窗口外恒 1；窗口内 下探 → 持平 → 恢复。 */
export function incidentFactor(dateIso: string, inc: LivedIncident): number {
  if (dateIso < inc.from || dateIso >= inc.to) return 1;
  if (dateIso < inc.low) return 1 - (1 - inc.depth) * lerpDate(dateIso, inc.from, inc.low);
  if (dateIso < inc.adopted) return inc.depth;
  return inc.depth + (1 - inc.depth) * lerpDate(dateIso, inc.adopted, inc.to);
}

/** 年度爬坡：0.86 → 1.0（第 rampDays 天打满）；良率温和（0.97 → 1.0）。 */
export function yearRamp(dayIndex: number, mild: boolean): number {
  const t = Math.min(1, Math.max(0, dayIndex / 300));
  return mild ? 0.97 + 0.03 * t : 0.86 + 0.14 * t;
}

export function livedPoint(
  spec: TsGenSpec,
  entity: TsGenEntity,
  dateIso: string,
  dayIndex: number,
  ctx: LivedGenContext,
): Record<string, number> {
  const rng = mulberry32(hashString(`${ctx.seed}|lived|${spec.seriesKey}|${entity.entityId}|${dateIso}`));
  const mild = spec.seriesKey.startsWith("yield");
  let v = spec.base.mean * yearRamp(dayIndex, mild) + spec.base.noise * gauss(rng);
  const effects = spec.effects ?? [];
  if (effects.includes("weekend_dip")) {
    const dow = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) v *= 0.88;
  }
  if (effects.includes("maint_window_dip")) {
    const w = ctx.maint.get(entity.baseId);
    if (w && dateIso >= w.start && dateIso < w.end) v *= 0.72;
  }
  for (const inc of ctx.incidents.get(entity.baseId) ?? []) {
    const f = incidentFactor(dateIso, inc);
    if (f >= 1) continue;
    // 良率受事件影响较弱（材料波动 ≠ 直接良率塌方）
    v *= mild ? 1 - (1 - f) * 0.3 : f;
  }
  v = clampFor(spec, round(v, 4));
  const values: Record<string, number> = { [spec.measureField]: v };
  if (spec.weightField) values[spec.weightField] = round(800 + 400 * rng(), 2);
  return values;
}

/** 检修窗口（14 天）：起点 = MaintPlan.lastMaintStart（与 90 天历史下凹同源对象）。 */
export function livedMaintWindows(
  maintPlans: { baseId: string; lastMaintStart: string }[],
): Map<string, { start: string; end: string }> {
  const map = new Map<string, { start: string; end: string }>();
  for (const mp of maintPlans) {
    const start = Date.parse(`${mp.lastMaintStart}T00:00:00Z`);
    map.set(mp.baseId, {
      start: mp.lastMaintStart,
      end: new Date(start + 14 * DAY_MS).toISOString().slice(0, 10),
    });
  }
  return map;
}

/** 基地检修「归属月」：窗口与各月重叠天数最多的那个月（Y3 三层勾稽口径）。 */
export function maintMonthOf(window: { start: string; end: string }): string {
  const counts = new Map<string, number>();
  let t = Date.parse(`${window.start}T00:00:00Z`);
  const end = Date.parse(`${window.end}T00:00:00Z`);
  while (t < end) {
    const month = new Date(t).toISOString().slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
    t += DAY_MS;
  }
  let best = "";
  let bestN = -1;
  for (const [m, n] of counts) {
    if (n > bestN || (n === bestN && m > best)) {
      best = m;
      bestN = n;
    }
  }
  return best;
}
