import { round, hashString } from "../prng.js";
import { validationError } from "../errors.js";
import { baseName, clamp, dayFrom, maintWeekOf, num, str, type SolverContext } from "./types.js";

// ---------------------------------------------------------------------------
// S1.3 bottleneck_matrix — LIVE vs MOCK dual mode
// ---------------------------------------------------------------------------

export function primaryFactor(c: SolverContext, baseId: string): string {
  const name = baseName(c, baseId);
  return c.params.bottleneck.primary[name] ?? c.params.bottleneck.defaultPrimary;
}

/** MOCK 口径 (exact prototype formula): seed=(base首字符码+因素首字符码×7) mod 9. */
export function mockTightness(c: SolverContext, baseId: string, factor: string): number {
  const m = c.params.bottleneck.mock;
  const bName = baseName(c, baseId);
  const seed = ((bName.charCodeAt(0) || 0) + (factor.charCodeAt(0) || 0) * m.factorMult) % m.mod;
  if (factor === primaryFactor(c, baseId)) {
    return Math.min(m.primaryCap, m.primaryBase + (seed % m.mod));
  }
  const base = c.bases.find((b) => b.props.baseId === baseId);
  const util = num(base?.props.util, 0);
  return Math.min(m.secondaryCap, m.secondaryBase + seed + (util > m.utilHigh ? m.utilHighAdd : m.utilLowAdd));
}

/** LIVE 口径: normalize real snapshot metrics (falls back to MOCK per factor when absent). */
function liveTightness(c: SolverContext, baseId: string, factor: string): { value: number; live: boolean } {
  const lp = c.params.bottleneck.live;
  if (factor === "设备OEE") {
    const eq = c.equipment.filter((e) => e.props.baseId === baseId && typeof e.props.oee_current === "number");
    if (eq.length > 0) {
      const avg = eq.reduce((a, e) => a + num(e.props.oee_current), 0) / eq.length;
      return { value: clamp(Math.round(lp.oeeBase + (1 - avg) * lp.oeeK), 0, 100), live: true };
    }
  }
  if (factor === "瓶颈工序") {
    const lines = c.lines.filter((l) => l.props.baseId === baseId && typeof l.props.utilization === "number");
    if (lines.length > 0) {
      const avg = lines.reduce((a, l) => a + num(l.props.utilization), 0) / lines.length;
      return { value: clamp(Math.round(avg * lp.utilK + lp.utilBase), 0, 100), live: true };
    }
  }
  if (factor === "良率波动") {
    const procs = c.processes.filter((pr) => pr.props.baseId === baseId && typeof pr.props.yield_baseline === "number");
    if (procs.length > 0) {
      const avg = procs.reduce((a, pr) => a + num(pr.props.yield_baseline), 0) / procs.length;
      return { value: clamp(Math.round(lp.yieldBase + (1 - avg) * lp.yieldK), 0, 100), live: true };
    }
  }
  return { value: mockTightness(c, baseId, factor), live: false };
}

export function bottleneckMatrix(
  c: SolverContext,
  args: { dataMode?: string; baseIds?: string[] },
): { dataMode: "LIVE" | "MOCK"; factors: string[]; rows: { base: string; tightness: Record<string, number>; primary: string }[] } {
  const factors = c.params.bottleneck.factors;
  const wantLive = args.dataMode === "LIVE";
  let anyLive = false;
  const baseIds = args.baseIds ?? c.bases.map((b) => str(b.props.baseId));
  const rows = baseIds
    .sort()
    .map((baseId) => {
      const tightness: Record<string, number> = {};
      for (const f of factors) {
        if (wantLive) {
          const r = liveTightness(c, baseId, f);
          tightness[f] = r.value;
          anyLive = anyLive || r.live;
        } else {
          tightness[f] = mockTightness(c, baseId, f);
        }
      }
      return { base: baseName(c, baseId), tightness, primary: primaryFactor(c, baseId) };
    });
  return { dataMode: wantLive && anyLive ? "LIVE" : "MOCK", factors, rows };
}

// ---------------------------------------------------------------------------
// S1.4 risk_timeline — baseline climb + event pulses
// ---------------------------------------------------------------------------

export interface RiskEvent {
  type: "maint_window" | "delivery_peak" | "arrival_gap";
  day: number;
  amp: number;
  factors: string[];
}

const EVENT_FACTORS: Record<RiskEvent["type"], string[]> = {
  maint_window: ["设备OEE", "瓶颈工序"],
  delivery_peak: ["瓶颈工序", "人力工时"],
  arrival_gap: ["物料齐套", "物流时长"],
};

/** Events are first-class objects from the ontology (maint plans / order due days / arrival cycle / delayed shipments). */
export function riskEvents(c: SolverContext, baseId: string, horizon: number): RiskEvent[] {
  const p = c.params.risk;
  const events: RiskEvent[] = [];
  const mw = maintWeekOf(c, baseId);
  if (mw !== null) {
    const day = mw * 7 - 3;
    if (day >= 1 && day <= horizon) {
      events.push({ type: "maint_window", day, amp: p.eventAmps.maint_window, factors: EVENT_FACTORS.maint_window });
    }
  }
  for (const o of c.orders) {
    const bases = Array.isArray(o.props.bases) ? (o.props.bases as string[]) : [];
    if (!bases.includes(baseId)) continue;
    const dueDay = dayFrom(c.params.forecastStart, str(o.props.due));
    if (dueDay >= 1 && dueDay <= horizon) {
      events.push({ type: "delivery_peak", day: dueDay, amp: p.eventAmps.delivery_peak, factors: EVENT_FACTORS.delivery_peak });
    }
  }
  for (let d = p.arrivalCycleDays; d <= horizon; d += p.arrivalCycleDays) {
    events.push({ type: "arrival_gap", day: d, amp: p.eventAmps.arrival_gap, factors: EVENT_FACTORS.arrival_gap });
  }
  // Delayed in-transit shipments (scenario shipment_delay) add an extra arrival-gap pulse at the new ETA.
  for (const s of c.shipments) {
    if (s.props.baseId !== baseId || s.props.status !== "DELAYED") continue;
    const day = num(s.props.etaDay);
    if (day >= 1 && day <= horizon) {
      events.push({ type: "arrival_gap", day, amp: p.eventAmps.arrival_gap, factors: EVENT_FACTORS.arrival_gap });
    }
  }
  return events.sort((a, b) => a.day - b.day || (a.type < b.type ? -1 : 1));
}

/** Mock 口径 target位 (riskTarget hash analogue, coefficients from solverParams). */
export function riskTarget(c: SolverContext, baseId: string, factor: string, cur: number): number {
  const t = c.params.risk.targetLift;
  const lift = (((baseName(c, baseId).charCodeAt(0) || 0) + (factor.charCodeAt(0) || 0)) % t.mod) + t.base;
  return Math.min(96, cur + lift);
}

/** tension(b,f,d) per S1.4 — returns the daily series for d=1..H. */
export function tensionSeries(
  c: SolverContext,
  baseId: string,
  factor: string,
  horizon: number,
  events: RiskEvent[],
  mitigation?: { eff: number; tn: number },
): number[] {
  const p = c.params.risk;
  const cur = mockTightness(c, baseId, factor);
  const tgt = riskTarget(c, baseId, factor, cur);
  const series: number[] = [];
  for (let d = 1; d <= horizon; d++) {
    const vb = cur + (tgt - cur) * Math.min(1, d / (p.rampDen * horizon));
    let pulse = 0;
    for (const e of events) {
      if (!e.factors.includes(factor)) continue;
      const dist = Math.abs(d - e.day);
      if (dist > p.pulseWindow) continue;
      const ps = Math.max(p.psFloor, 1 - (vb - p.psStart) / p.psDen);
      pulse += e.amp * ps * (1 - dist / p.pulseDecayDen);
    }
    let v = Math.min(p.cap, Math.round(vb + pulse));
    if (mitigation && d >= mitigation.tn) v = Math.max(0, v - mitigation.eff);
    series.push(v);
  }
  return series;
}

export function crossDayOf(series: number[], threshold: number): number | null {
  const idx = series.findIndex((v) => v >= threshold);
  return idx === -1 ? null : idx + 1;
}

export interface RiskTimelineArgs {
  base?: string; // baseId or 中文名
  factor?: string;
  horizon?: number;
  mitigation?: { base?: string; factor?: string; planKey: string };
}

function resolveBaseId(c: SolverContext, ref: string): string {
  const b = c.bases.find((x) => x.props.baseId === ref || x.props.name === ref);
  if (!b) throw validationError(`unknown base: ${ref}`);
  return str(b.props.baseId);
}

export function riskTimeline(c: SolverContext, args: RiskTimelineArgs): Record<string, unknown> {
  const p = c.params.risk;
  const horizon = Math.max(1, Math.floor(num(args.horizon, 30)));
  const pairs: { baseId: string; factor: string; forced: boolean }[] = [];
  if (args.base && args.factor) {
    pairs.push({ baseId: resolveBaseId(c, args.base), factor: args.factor, forced: true });
  } else {
    for (const b of c.bases.map((x) => str(x.props.baseId)).sort()) {
      const primary = primaryFactor(c, b);
      for (const f of c.params.bottleneck.factors) {
        if (f === primary) continue;
        if (mockTightness(c, b, f) >= p.threshold) continue;
        pairs.push({ baseId: b, factor: f, forced: false });
      }
    }
  }

  const cards: Record<string, unknown>[] = [];
  for (const pair of pairs) {
    const events = riskEvents(c, pair.baseId, horizon);
    const series = tensionSeries(c, pair.baseId, pair.factor, horizon, events);
    const crossDay = crossDayOf(series, p.threshold);
    if (!pair.forced && crossDay === null) continue;
    const card: Record<string, unknown> = {
      base: baseName(c, pair.baseId),
      baseId: pair.baseId,
      factor: pair.factor,
      peak: Math.max(...series),
      crossDay,
      series,
      events: events.map((e) => ({ type: e.type, day: e.day, amp: e.amp, factors: e.factors })),
      affectedOrders: affectedOrders(c, {
        baseId: pair.baseId,
        day: crossDay ?? horizon,
        peak: Math.max(...series),
      }).affected,
    };
    // 处置方案消解: tension − eff from T+n, both curves returned side by side.
    const mit = args.mitigation;
    if (mit && (!mit.base || resolveBaseId(c, mit.base) === pair.baseId) && (!mit.factor || mit.factor === pair.factor)) {
      const plans = p.mitigations[pair.factor] ?? [];
      const plan = plans.find((pl) => pl.key === mit.planKey || pl.name === mit.planKey);
      if (!plan) throw validationError(`unknown mitigation plan '${mit.planKey}' for factor ${pair.factor}`);
      const mitSeries = tensionSeries(c, pair.baseId, pair.factor, horizon, events, { eff: plan.eff, tn: plan.tn });
      card.mitigated = {
        series: mitSeries,
        appliedPlan: plan.name,
        effectiveFrom: plan.tn,
        peak: Math.max(...mitSeries),
        crossDay: crossDayOf(mitSeries, p.threshold),
      };
    }
    cards.push(card);
  }
  cards.sort((a, b) => {
    const ca = (a.crossDay as number | null) ?? Number.MAX_SAFE_INTEGER;
    const cb = (b.crossDay as number | null) ?? Number.MAX_SAFE_INTEGER;
    return ca - cb || (str(a.base) < str(b.base) ? -1 : 1);
  });
  return {
    horizon,
    threshold: p.threshold,
    cards: cards.slice(0, p.maxCards),
    mitigationLibrary: p.mitigations,
  };
}

// ---------------------------------------------------------------------------
// S1.5 affected_orders — window [day−7, day+14], delay estimate, condition
// filter with nearest-due fallback.
// ---------------------------------------------------------------------------

export interface AffectedOrdersArgs {
  baseId: string;
  day?: number;
  peak?: number;
  fromDay?: number;
  toDay?: number;
  condition?: { prop: string; op: "<" | ">" | "<=" | ">=" | "=="; value: number };
}

export function affectedOrders(
  c: SolverContext,
  args: AffectedOrdersArgs,
  orders?: { id: string; props: Record<string, unknown> }[],
): { baseId: string; affected: Record<string, unknown>[]; total: number; fallback: boolean } {
  const p = c.params;
  const baseId = resolveBaseId(c, str(args.baseId));
  const pool = (orders ?? c.orders).filter((o) => {
    const bases = Array.isArray(o.props.bases) ? (o.props.bases as string[]) : [];
    return bases.includes(baseId);
  });
  const day = args.day;
  const from = day !== undefined ? day - p.affected.windowBefore : num(args.fromDay, 0);
  const to = day !== undefined ? day + p.affected.windowAfter : num(args.toDay, 180);
  const peak = num(args.peak, 90);
  const inWindow = pool
    .map((o) => ({ o, dueDay: dayFrom(p.forecastStart, str(o.props.due)) }))
    .filter((x) => x.dueDay >= from && x.dueDay <= to)
    .sort((a, b) => a.dueDay - b.dueDay || (str(a.o.props.so) < str(b.o.props.so) ? -1 : 1));

  let selected = inWindow;
  let fallback = false;
  if (args.condition) {
    const cond = args.condition;
    const filtered = inWindow.filter((x) => {
      const v = num(x.o.props[cond.prop], NaN);
      if (Number.isNaN(v)) return false;
      switch (cond.op) {
        case "<": return v < cond.value;
        case ">": return v > cond.value;
        case "<=": return v <= cond.value;
        case ">=": return v >= cond.value;
        case "==": return v === cond.value;
      }
    });
    if (filtered.length > 0) {
      selected = filtered;
    } else {
      // 命中为空 → 回退为窗口内交期最近 max 单
      const anchor = day ?? from;
      selected = [...inWindow]
        .sort((a, b) => Math.abs(a.dueDay - anchor) - Math.abs(b.dueDay - anchor))
        .slice(0, p.affected.fallbackMax);
      fallback = true;
    }
  }

  const affected = selected.map(({ o, dueDay }) => {
    const jit = hashString(str(o.props.so)) % p.affected.jitterMod;
    const delay = Math.max(1, Math.round((peak - p.risk.threshold) / p.affected.delayDiv) + jit);
    return {
      so: o.props.so,
      cust: o.props.cust,
      model: o.props.model,
      qty: o.props.qty,
      due: o.props.due,
      dueDay,
      delay,
      impact: round(Math.min(1, 0.2 + delay / 10), 2),
    };
  });
  return { baseId, affected, total: affected.length, fallback };
}
