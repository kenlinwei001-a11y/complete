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

export interface OrderProblemGroupOut {
  category: "DELIVERY" | "MARGIN" | "KIT" | "CREDIT";
  title: string;
  orderCount: number;
  financeImpact: number;
  rootCauseSummary: string;
  rootChains: { orderId: string; layers: { kind: "order" | "judgement" | "rootCause" | "remedy"; label: string }[] }[];
}

export function affectedOrders(
  c: SolverContext,
  args: AffectedOrdersArgs,
  orders?: { id: string; props: Record<string, unknown> }[],
): { baseId: string; affected: Record<string, unknown>[]; total: number; fallback: boolean; problems: OrderProblemGroupOut[] } {
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
  const problems = buildOrderProblems(c, baseId, affected, day ?? num(args.toDay, 180));
  return { baseId, affected, total: affected.length, fallback, problems };
}

// ---------------------------------------------------------------------------
// §7.16 订单全链聚合（order-chain 视图）：跨基地聚合，输出 {summary, rows[seg+risks], problems}。
// 复用单基地 affectedOrders + 风险时间线；与前端 AffectedOrdersOutputVM 对齐。
// 调用约定：affected_orders 无 baseId → 走此聚合；可选 args.base 过滤到单基地。
// ---------------------------------------------------------------------------

interface AggRiskRef {
  base: string;
  factor: string;
  crossDay: number | null;
  peak: number;
  threshold: number;
}
const SEG_PRICE: Record<string, number> = { pas: 0.6, com: 0.55, ess: 0.5 };

export function affectedOrdersAggregate(
  c: SolverContext,
  args: { base?: string; horizon?: number },
): {
  summary: { orderCount: number; totalQty: number; custCount: number; revenue: number };
  rows: { so: string; cust: string; seg: string; model: string; qty: number; due: string; delay: number; risks: AggRiskRef[] }[];
  problems: OrderProblemGroupOut[];
} {
  const threshold = c.params.risk.threshold;
  const horizon = Math.max(1, Math.floor(num(args.horizon, 30)));
  const filterBase = args.base ? resolveBaseId(c, str(args.base)) : null;
  const baseIds = c.bases
    .map((b) => str(b.props.baseId))
    .filter((id) => (filterBase ? id === filterBase : true));

  const byOrder = new Map<
    string,
    { so: string; cust: string; seg: string; model: string; qty: number; due: string; delay: number; risks: AggRiskRef[] }
  >();
  const probByCat = new Map<string, OrderProblemGroupOut>();

  for (const baseId of baseIds) {
    const single = affectedOrders(c, { baseId, toDay: 180 });
    const factor = primaryFactor(c, baseId);
    const series = tensionSeries(c, baseId, factor, horizon, riskEvents(c, baseId, horizon));
    const ref: AggRiskRef = { base: baseName(c, baseId), factor, peak: Math.max(0, ...series), crossDay: crossDayOf(series, threshold), threshold };
    for (const a of single.affected) {
      const so = str(a.so);
      let e = byOrder.get(so);
      if (!e) {
        e = { so, cust: str(a.cust), seg: segmentOf(c, str(a.model)).name, model: str(a.model), qty: num(a.qty), due: str(a.due), delay: num(a.delay), risks: [] };
        byOrder.set(so, e);
      }
      e.delay = Math.max(e.delay, num(a.delay));
      if (!e.risks.some((r) => r.base === ref.base)) e.risks.push(ref);
    }
    for (const pr of single.problems) {
      const m = probByCat.get(pr.category);
      if (!m) probByCat.set(pr.category, { ...pr, rootChains: [...pr.rootChains] });
      else {
        m.orderCount += pr.orderCount;
        m.financeImpact += pr.financeImpact;
        m.rootChains.push(...pr.rootChains);
      }
    }
  }

  const rows = [...byOrder.values()].sort((a, b) => (a.so < b.so ? -1 : 1));
  const totalQty = round(rows.reduce((s, r) => s + r.qty, 0), 2);
  const revenue = round(rows.reduce((s, r) => s + r.qty * (SEG_PRICE[segmentOf(c, r.model).key] ?? 0.6), 0), 2);
  const summary = { orderCount: rows.length, totalQty, custCount: new Set(rows.map((r) => r.cust)).size, revenue };
  return { summary, rows, problems: [...probByCat.values()] };
}

// ---------------------------------------------------------------------------
// §S1.5 修订 — problems[] 4 类归并（DELIVERY/MARGIN/KIT/CREDIT）+ 逐单 4 层根因链
// （订单→判定→根因→对策）。完全确定性：从订单属性 + 规则口径推导，不依赖随机。
// ---------------------------------------------------------------------------

const PROBLEM_TITLES: Record<string, string> = {
  DELIVERY: "交期风险订单",
  MARGIN: "毛利承压订单",
  KIT: "齐套缺口订单",
  CREDIT: "信用额度超限订单",
};

function segmentOf(c: SolverContext, modelId: string): { key: string; name: string; gm: number } {
  const cfg = c.params.affected.problems;
  const key = cfg.essModels.includes(modelId) ? "ess" : cfg.comModels.includes(modelId) ? "com" : "pas";
  const seg = c.segments.find((s) => s.props.segKey === key);
  return { key, name: str(seg?.props.name, key), gm: num(seg?.props.gmRate, c.params.audit.segMargins[key as "pas" | "ess" | "com"]) };
}

function buildOrderProblems(
  c: SolverContext,
  baseId: string,
  affected: Record<string, unknown>[],
  riskDay: number,
): OrderProblemGroupOut[] {
  const cfg = c.params.affected.problems;
  const bName = baseName(c, baseId);
  const base = c.bases.find((b) => b.props.baseId === baseId);
  const bottleneck = str(base?.props.bottleneck, c.params.bottleneck.defaultPrimary);
  const shipment = c.shipments
    .filter((s) => s.props.baseId === baseId)
    .sort((a, b) => (str(a.props.shipId) < str(b.props.shipId) ? -1 : 1))[0];
  const buckets = new Map<string, { rows: Record<string, unknown>[]; chains: OrderProblemGroupOut["rootChains"] }>();
  const add = (cat: string, row: Record<string, unknown>, judgement: string, rootCause: string, remedy: string) => {
    let b = buckets.get(cat);
    if (!b) {
      b = { rows: [], chains: [] };
      buckets.set(cat, b);
    }
    b.rows.push(row);
    b.chains.push({
      orderId: str(row.so),
      layers: [
        { kind: "order", label: `订单 ${str(row.so)} · ${str(row.cust)} · ${num(row.qty)} 套（交期 ${str(row.due)}）` },
        { kind: "judgement", label: judgement },
        { kind: "rootCause", label: rootCause },
        { kind: "remedy", label: remedy },
      ],
    });
  };
  const mitPlan = (factor: string) => (c.params.risk.mitigations[factor] ?? [])[0];

  for (const row of affected) {
    const so = str(row.so);
    const cust = str(row.cust);
    const modelId = str(row.model);
    const dueDay = num(row.dueDay);
    const delay = num(row.delay);
    const creditRatio = round(cfg.creditBase + (hashString(`${cust}|${so}`) % cfg.creditMod) / 100, 2);
    const seg = segmentOf(c, modelId);
    const etaDay = num(shipment?.props.etaDay);
    const kitGapDays = shipment && (shipment.props.status === "DELAYED" || etaDay > dueDay) ? Math.max(1, etaDay - dueDay) : 0;
    const plan = mitPlan(bottleneck);
    const remedyBn = plan ? `对策：${plan.name}（T+${plan.tn} 生效，预计消解 ${plan.eff} 点）` : `对策：${bottleneck}专项消解`;

    // 归并优先级：更具体的判定（信用/毛利/齐套）优先，交期为窗口内订单的兜底判定。
    if (creditRatio > 1) {
      add("CREDIT", row,
        `信用判定：客户 ${cust} 信用占用比 ${creditRatio} 超过额度上限 1.0（规则 ${cfg.ruleKeys.CREDIT}）`,
        `根因：${cust} 在手订单集中放量，信用敞口未同步扩容`,
        "对策：信用复核 + 预收款比例上调，超限部分分批释放");
      continue;
    }
    if (seg.gm < cfg.gmFloor) {
      add("MARGIN", row,
        `毛利判定：${seg.name}细分毛利 ${seg.gm}% 低于底线 ${cfg.gmFloor}%（规则 ${cfg.ruleKeys.MARGIN}）`,
        `根因：${seg.name}细分结构毛利偏低，延误追加成本进一步侵蚀`,
        "对策：细分结构调优 + 高毛利订单优先排产");
      continue;
    }
    if (kitGapDays > 0) {
      add("KIT", row,
        `齐套判定：关键物料到货晚于交期 ${kitGapDays} 天（在途批次 ${str(shipment?.props.shipId)}，规则 ${cfg.ruleKeys.KIT}）`,
        `根因：${bName}基地到货间隙，物料齐套率不足`,
        "对策：加急采购 / 前置仓备货，压缩到货间隙");
      continue;
    }
    if (dueDay <= riskDay) {
      add("DELIVERY", row,
        `交期判定：交期 D+${dueDay} 落入越线窗口（风险越线日 D+${riskDay}），预计延误 ${delay} 天（规则 ${cfg.ruleKeys.DELIVERY}）`,
        `根因：${bName}基地 ${bottleneck} 紧张，越线窗口内产出不足`,
        remedyBn);
      continue;
    }
    add("DELIVERY", row,
      `交期判定：交期 D+${dueDay} 处于风险窗口尾段，预计延误 ${delay} 天（规则 ${cfg.ruleKeys.DELIVERY}）`,
      `根因：${bName}基地 ${bottleneck} 紧张，排产顺延`,
      remedyBn);
  }

  const out: OrderProblemGroupOut[] = [];
  for (const cat of ["DELIVERY", "MARGIN", "KIT", "CREDIT"] as const) {
    const b = buckets.get(cat);
    if (!b || b.rows.length === 0) continue;
    const finance = round(b.rows.reduce((a, r) => a + num(r.qty) * 10000 * num(c.orders.find((o) => o.props.so === r.so)?.props.unitPrice, 600), 0) / 1e8, 4);
    out.push({
      category: cat,
      title: PROBLEM_TITLES[cat] as string,
      orderCount: b.rows.length,
      financeImpact: finance,
      rootCauseSummary:
        cat === "CREDIT"
          ? `${b.rows.length} 单客户信用占用超限（C13 口径），需信用复核`
          : cat === "MARGIN"
            ? `${b.rows.length} 单落在低毛利细分，结构毛利低于 ${cfg.gmFloor}% 底线`
            : cat === "KIT"
              ? `${b.rows.length} 单受 ${bName}基地到货间隙影响，物料齐套不足`
              : `${b.rows.length} 单交期落入 ${bName}基地 ${bottleneck} 越线窗口`,
      rootChains: b.chains,
    });
  }
  return out;
}
