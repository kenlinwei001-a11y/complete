import { round, hashString } from "../prng.js";
import { SEG_REGISTRY } from "@platform/contracts";
import { validationError } from "../errors.js";
import { baseName, baseProvenanceSynthetic, clamp, dayFrom, maintWeekOf, num, str, type SolverContext } from "./types.js";
import { deriveDisposition } from "./disposition.js";
import type { ObjectInstance } from "../domain.js";

// ---------------------------------------------------------------------------
// S1.3 bottleneck_matrix — LIVE vs MOCK dual mode
// ---------------------------------------------------------------------------

export function primaryFactor(c: SolverContext, baseId: string): string {
  const name = baseName(c, baseId);
  return c.params.bottleneck.primary[name] ?? c.params.bottleneck.defaultPrimary;
}

/**
 * cockpit P4 真闭环（PRD §2.3「riskCases 由实时算而非写死」）：历史处置案例严重度由**基地真实数据**
 * 确定性派生——基地利用率压力 + 该因子是否为基地主瓶颈（加成）+ 是否结构性危机事件。
 * 替代 CASE_SPECS 手写 severity 字面量（R13 可溯源：severity 来自 util/primaryFactor/crisis；R6 同输入同判）。
 * 阈值 92/78 + 主瓶颈加成 12（业务区间，后端求解器域参数；高利用率基地的主瓶颈因子=高危）。
 */
export function caseSeverityFromData(util: number, isPrimaryFactor: boolean, crisis: boolean): "LOW" | "MEDIUM" | "HIGH" {
  if (crisis) return "HIGH"; // 结构性危机（到货断供）恒高危
  const score = util + (isPrimaryFactor ? 12 : 0);
  return score >= 92 ? "HIGH" : score >= 78 ? "MEDIUM" : "LOW";
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
export function liveTightness(c: SolverContext, baseId: string, factor: string): { value: number; live: boolean } {
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

// ---------------------------------------------------------------------------
// WO-CAPLIVE-1-ATOM · 逐工序原子因子张力归一（factor enumeration expand·treat G-CAPACITY-FACTOR-SHALLOW）。
// base 级 liveTightness 只有 3 因子（设备OEE/瓶颈工序/良率波动）且按基地均值——这里暴露**逐值**归一子，
// 让 capacity.ts byProcessModel 把张力深化到**每工序**颗粒（读该工序自身良率基线/其设备 OEE/该工序利用率）。
// 系数一律取 params.bottleneck.live（R14 入参·不内联），口径与 liveTightness 分支逐一对齐（同 base=同值）。
// ---------------------------------------------------------------------------

/** 良率 → 张力（0-100·= liveTightness 良率波动 分支口径：yieldBase + (1−良率)×yieldK）。 */
export function yieldTension(c: SolverContext, yieldValue: number): number {
  const lp = c.params.bottleneck.live;
  return clamp(Math.round(lp.yieldBase + (1 - yieldValue) * lp.yieldK), 0, 100);
}

/** 设备 OEE → 张力（0-100·= liveTightness 设备OEE 分支口径：oeeBase + (1−OEE)×oeeK）。 */
export function oeeTension(c: SolverContext, oeeValue: number): number {
  const lp = c.params.bottleneck.live;
  return clamp(Math.round(lp.oeeBase + (1 - oeeValue) * lp.oeeK), 0, 100);
}

/** 利用率 → 张力（0-100·= liveTightness 瓶颈工序 分支口径：利用率×utilK + utilBase）。 */
export function utilTension(c: SolverContext, utilValue: number): number {
  const lp = c.params.bottleneck.live;
  return clamp(Math.round(utilValue * lp.utilK + lp.utilBase), 0, 100);
}

export function bottleneckMatrix(
  c: SolverContext,
  args: { dataMode?: string; baseIds?: string[] },
): { dataMode: "LIVE" | "MOCK"; factors: string[]; rows: { base: string; tightness: Record<string, number>; primary: string; provenanceSynthetic: boolean }[] } {
  const factors = c.params.bottleneck.factors;
  const wantLive = args.dataMode === "LIVE";
  let anyLive = false;
  // #13 灰数据接缝修：入参 baseId 可为 id 或中文名（前端传 card.base=基地名"常州"）→ 规范到真 baseId("changzhou")，
  // 否则 liveTightness 按 `e.props.baseId===baseId` 过滤真 Equipment/Line/Process 恒空 → dataMode 恒 MOCK（LIVE 死接线·
  // 改真 OEE 格子不变色）。未知 ref 保留原值（不抛·不回归·liveTightness 自 MOCK 兜底），口径同 riskTimeline 的 resolveBaseId。
  const resolveRef = (ref: string): string => {
    const b = c.bases.find((x) => x.props.baseId === ref || x.props.name === ref);
    return b ? str(b.props.baseId) : ref;
  };
  const baseIds = (args.baseIds ?? c.bases.map((b) => str(b.props.baseId))).map(resolveRef);
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
      // #13 provenance 维（守 KILL-MOCK-RED/铁律0.4·加性正交·不改 dataMode）：底层对象是否合成物化 → true →
      // 前端诚实标"合成·未接实测"，不因 dataMode=LIVE（读到真 OEE/util/良率）就把 demo 合成种子谎报"实测"。镜像 riskTimeline 每卡。
      return { base: baseName(c, baseId), tightness, primary: primaryFactor(c, baseId), provenanceSynthetic: baseProvenanceSynthetic(c, baseId) };
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
  tag?: string;
  obj?: string;
  desc?: string;
  src?: string;
}

const EVENT_FACTORS: Record<RiskEvent["type"], string[]> = {
  maint_window: ["设备OEE", "瓶颈工序"],
  delivery_peak: ["瓶颈工序", "人力工时"],
  arrival_gap: ["物料齐套", "物流时长"],
};

/** Events are first-class objects from the ontology (maint plans / order due days / arrival cycle / delayed shipments). */
// PRD-IND-risk §4.6 来源系统（③种子，SRC_META 逐字）：检修=EAM/CMMS · 交付=S&OP/ERP · 到货=WMS/ERP。
const EVENT_SRC = { maint: "EAM/CMMS 检修计划", delivery: "S&OP/ERP 订单交期", arrival: "WMS/ERP 采购与在途" } as const;
/** §4.6 量化经 hashN 派生（确定性 R6）：同 (key) 同值。 */
const hn = (key: string, mod: number): number => hashString(key) % mod;

export function riskEvents(c: SolverContext, baseId: string, horizon: number): RiskEvent[] {
  const p = c.params.risk;
  const events: RiskEvent[] = [];
  const bn = baseName(c, baseId);
  const mw = maintWeekOf(c, baseId);
  if (mw !== null) {
    const day = mw * 7 - 3;
    if (day >= 1 && day <= horizon) {
      // §4.6 检修窗口：年度检修（第w周）：计划停机 d 天，设备OEE 下调 o 个百分点。
      const days = 3 + hn(`${baseId}:maint:days`, 4);
      const oee = 4 + hn(`${baseId}:maint:oee`, 5);
      events.push({ type: "maint_window", day, amp: p.eventAmps.maint_window, factors: EVENT_FACTORS.maint_window,
        tag: "检修窗", obj: bn, desc: `年度检修（第${mw}周）：计划停机 ${days} 天，设备OEE 由基线下调 ${oee} 个百分点`, src: EVENT_SRC.maint });
    }
  }
  for (const o of c.orders) {
    const bases = Array.isArray(o.props.bases) ? (o.props.bases as string[]) : [];
    if (!bases.includes(baseId)) continue;
    const dueDay = dayFrom(c.params.forecastStart, str(o.props.due));
    if (dueDay >= 1 && dueDay <= horizon) {
      // §4.6 交付高峰：{so}·{cust} 交付 {qty} 万套到期：当周排产负载 +{load} 个百分点，需额外工时约 {qty×1.6} 人·班。
      const so = str(o.props.so); const cust = str(o.props.cust); const qty = num(o.props.qty);
      const load = 6 + hn(`${so}:load`, 8);
      events.push({ type: "delivery_peak", day: dueDay, amp: p.eventAmps.delivery_peak, factors: EVENT_FACTORS.delivery_peak,
        tag: "交付高峰", obj: so, desc: `${so}·${cust} 交付 ${qty} 万套到期：当周产线排产负载 +${load} 个百分点，需额外工时约 ${Math.round(qty * 1.6)} 人·班`, src: EVENT_SRC.delivery });
    }
  }
  for (let d = p.arrivalCycleDays; d <= horizon; d += p.arrivalCycleDays) {
    // §4.6 到货间隙（物料）：关键正极安全库存覆盖降至 {cover} 天（阈值 5），物料齐套率 {kit}%（阈值 80）。
    const cover = 3 + hn(`${baseId}:cover:${d}`, 3);
    const kit = 70 + hn(`${baseId}:kit:${d}`, 12);
    events.push({ type: "arrival_gap", day: d, amp: p.eventAmps.arrival_gap, factors: EVENT_FACTORS.arrival_gap,
      tag: "到货间隙", obj: bn, desc: `关键正极安全库存覆盖降至 ${cover} 天（阈值 5 天），物料齐套率 ${kit}%（阈值 80%）`, src: EVENT_SRC.arrival });
  }
  // Delayed in-transit shipments (scenario shipment_delay) add an extra arrival-gap pulse at the new ETA.
  for (const s of c.shipments) {
    if (s.props.baseId !== baseId || s.props.status !== "DELAYED") continue;
    const day = num(s.props.etaDay);
    if (day >= 1 && day <= horizon) {
      // §4.6 到货间隙（物流）：在途到货延迟 {lead} 天，待检在途 {n} 批。
      const lead = 2 + hn(`${baseId}:lead:${day}`, 5);
      const nb = 1 + hn(`${baseId}:ntransit:${day}`, 3);
      events.push({ type: "arrival_gap", day, amp: p.eventAmps.arrival_gap, factors: EVENT_FACTORS.arrival_gap,
        tag: "到货间隙", obj: bn, desc: `在途到货延迟 ${lead} 天，待检在途 ${nb} 批`, src: EVENT_SRC.arrival });
    }
  }
  return events.sort((a, b) => a.day - b.day || (a.type < b.type ? -1 : 1));
}

/**
 * 爬坡目标位（riskTimeline forward 推演的 climb 上限）。`cur` 是曲线起锚：
 * - lt.live 时由调用方传入实测当前张力（真 OEE/利用率/良率）→ target = 实测锚 + lift（真锚上的确定性前瞻增量），card.dataMode=LIVE；
 * - 无真源时 cur=mockTightness → 全 MOCK（card.dataMode=MOCK 诚实披露"估算"）。
 * `lift` 是确定性前瞻增量（"未来 N 天会恶化多少"的投影斜率·R6 无随机/时钟）；本身非实测量，其诚实性由 card.dataMode 披露（LIVE=锚实测/MOCK=估算）。
 */
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
  // 轨M 增量1（真推演红线）：基线张力优先用真数据（liveTightness 读 OEE/利用率/良率），
  // 无真数据源的因素（人力工时/物料齐套/物流时长/换型损失）回落 mock。调用方传入以保 series 与 dataMode 同源。
  baseline?: number,
): number[] {
  const p = c.params.risk;
  const cur = baseline ?? mockTightness(c, baseId, factor);
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
  /** WO-LIVE-DISPOSITION：活台拨杆假设值，与 capacityInferenceApply 同一克隆语义（无副作用·R6）。 */
  apply?: { objectType: string; objectId: string; prop: string; value: unknown }[];
}

/** 与 capacity.ts patchCapacityContext 同一覆盖语义：浅克隆对应对象数组、不 mutate 原 ctx。 */
function patchContext(
  c: SolverContext,
  typeKey: string,
  objId: string,
  prop: string,
  value: unknown,
): SolverContext {
  const bump = (arr: ObjectInstance[]): ObjectInstance[] =>
    arr.map((o) => (o.id === objId ? { ...o, props: { ...o.props, [prop]: value } } : o));
  switch (typeKey) {
    case "Process":
      return { ...c, processes: bump(c.processes) };
    case "Equipment":
      return { ...c, equipment: bump(c.equipment) };
    case "Line":
      return { ...c, lines: bump(c.lines) };
    case "Material":
      return { ...c, materials: bump(c.materials ?? []) };
    default:
      return { ...c };
  }
}

function baseFreeDaily(baseId: string, lines: ObjectInstance[], baseObj: ObjectInstance | undefined): number {
  const capDaily = lines.filter((l) => str(l.props.baseId) === baseId).reduce((a, l) => a + num(l.props.capacityDaily), 0);
  const util = num(baseObj?.props.util);
  return round(capDaily * Math.max(0, 1 - util / 100), 2);
}

function resolveBaseId(c: SolverContext, ref: string): string {
  const b = c.bases.find((x) => x.props.baseId === ref || x.props.name === ref);
  if (!b) throw validationError(`unknown base: ${ref}`);
  return str(b.props.baseId);
}

export function riskTimeline(c: SolverContext, args: RiskTimelineArgs): Record<string, unknown> {
  const p = c.params.risk;
  const horizon = Math.max(1, Math.floor(num(args.horizon, 30)));

  // WO-LIVE-DISPOSITION：活台拨杆假设值，与 capacityInferenceApply 同一克隆语义（不 mutate 原 ctx·R6）。
  let ctx = c;
  const apply = Array.isArray(args.apply) ? args.apply : [];
  for (const ov of apply) {
    if (typeof ov.objectType !== "string" || typeof ov.objectId !== "string" || typeof ov.prop !== "string") {
      throw validationError("apply 项需包含 objectType/objectId/prop/value");
    }
    ctx = patchContext(ctx, ov.objectType, ov.objectId, ov.prop, ov.value);
  }

  const pairs: { baseId: string; factor: string; forced: boolean }[] = [];
  if (args.base && args.factor) {
    pairs.push({ baseId: resolveBaseId(ctx, args.base), factor: args.factor, forced: true });
  } else {
    for (const b of ctx.bases.map((x) => str(x.props.baseId)).sort()) {
      const primary = primaryFactor(ctx, b);
      for (const f of ctx.params.bottleneck.factors) {
        if (f === primary) continue;
        if (mockTightness(ctx, b, f) >= p.threshold) continue;
        pairs.push({ baseId: b, factor: f, forced: false });
      }
    }
  }

  const cards: Record<string, unknown>[] = [];
  for (const pair of pairs) {
    const events = riskEvents(ctx, pair.baseId, horizon);
    // 轨M 增量1（真推演红线）：series 是确定性 forward 推演（基线 climb + 真事件脉冲）。
    // 诚实披露：liveTightness 给该因素的"实测当前张力"——有真数据(LIVE: 设备OEE/瓶颈工序/良率波动 读
    // 真 OEE/利用率/良率)则 dataMode=LIVE 且 currentTightness 亮真值；无真数据源(MOCK: 人力工时/物料齐套/
    // 物流时长/换型损失)则 dataMode=MOCK → 前端显"估算（无实测）"，红/黄不再裸渲染当真值。
    const lt = liveTightness(ctx, pair.baseId, pair.factor);
    // 轨M 增量1（假1 红曲线锚实测·KILL-MOCK-RED·治 tensionSeries baseline 死代码）：有真数据（lt.live：设备OEE/瓶颈工序/
    // 良率波动 读真 OEE/利用率/良率）时把「实测当前张力」lt.value 作 baseline 传入 → 红曲线锚实测而非 charCode 哈希 mockTightness；
    // 无真源（人力工时/物料齐套/物流时长/换型损失）→ undefined 回落 mock，card.dataMode=MOCK 诚实披露。
    // 改真 Equipment.oee_current → lt.value 变 → cur 变 → series/peak 真变（curl 前后可验）。
    const baseline = lt.live ? lt.value : undefined;
    const series = tensionSeries(ctx, pair.baseId, pair.factor, horizon, events, undefined, baseline);
    const crossDay = crossDayOf(series, p.threshold);
    if (!pair.forced && crossDay === null) continue;
    const card: Record<string, unknown> = {
      base: baseName(ctx, pair.baseId),
      baseId: pair.baseId,
      factor: pair.factor,
      // measurement 维（读到真 OEE/util/良率即 LIVE·不动）——保 currentTightness.live 语义与轨M 增量1。
      dataMode: lt.live ? "LIVE" : "MOCK",
      currentTightness: { value: lt.value, live: lt.live },
      // WO-DATAMODE-UNIFY-PROVENANCE（provenance 维·加性·两正交维·不改 dataMode/live）：本卡底层对象是否合成物化。
      // demo 合成世界（Base/设备/产线/工序全 MATERIALIZED-from-synthetic）→ true → 前端诚实灰、不显"实测当前 N"。
      provenanceSynthetic: baseProvenanceSynthetic(ctx, pair.baseId),
      peak: Math.max(...series),
      crossDay,
      series,
      events: events.map((e) => ({ type: e.type, day: e.day, amp: e.amp, factors: e.factors, ...(e.tag ? { tag: e.tag } : {}), ...(e.obj ? { obj: e.obj } : {}), ...(e.desc ? { desc: e.desc } : {}), ...(e.src ? { src: e.src } : {}) })),
      affectedOrders: affectedOrders(ctx, {
        baseId: pair.baseId,
        day: crossDay ?? horizon,
        peak: Math.max(...series),
      }).affected,
    };
    // 处置方案消解: tension − eff from T+n, both curves returned side by side.
    const mit = args.mitigation;
    if (mit && (!mit.base || resolveBaseId(ctx, mit.base) === pair.baseId) && (!mit.factor || mit.factor === pair.factor)) {
      const plans = p.mitigations[pair.factor] ?? [];
      const plan = plans.find((pl) => pl.key === mit.planKey || pl.name === mit.planKey);
      if (!plan) throw validationError(`unknown mitigation plan '${mit.planKey}' for factor ${pair.factor}`);
      // 处置曲线与基线同锚（baseline·lt.live 时为实测当前张力）→ 削减量作用在真实锚点上，不回落哈希。
      const mitSeries = tensionSeries(ctx, pair.baseId, pair.factor, horizon, events, { eff: plan.eff, tn: plan.tn }, baseline);
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
  // 去重：每个基地只保留 peak 最高的一张卡片，同时汇总该基地所有越线 factor（产能推演每基地一张）
  const bestByBase = new Map<string, Record<string, unknown>>();
  const allByBase = new Map<string, Record<string, unknown>[]>();
  for (const card of cards) {
    const b = str(card.base);
    const list = allByBase.get(b) ?? [];
    list.push(card);
    allByBase.set(b, list);
    const existing = bestByBase.get(b);
    if (!existing || num(card.peak) > num(existing.peak)) {
      bestByBase.set(b, card);
    }
  }
  cards.splice(0, cards.length);
  for (const b of bestByBase.keys()) {
    const best = bestByBase.get(b)!;
    const all = allByBase.get(b) ?? [];
    best.allFactors = all
      .filter((c2) => c2 !== best)
      .map((c2) => ({ factor: str(c2.factor), peak: num(c2.peak), crossDay: (c2.crossDay as number | null) ?? null }));
    cards.push(best);
  }
  cards.sort((a, b) => {
    const ca = (a.crossDay as number | null) ?? Number.MAX_SAFE_INTEGER;
    const cb = (b.crossDay as number | null) ?? Number.MAX_SAFE_INTEGER;
    return ca - cb || (str(a.base) < str(b.base) ? -1 : 1);
  });
  const shown = cards.slice(0, p.maxCards);
  // 顶层 dataMode：全 LIVE→LIVE，全 MOCK→MOCK，混合→PARTIAL（前端据此提示"部分估算"）。
  const modes = new Set(shown.map((c2) => c2.dataMode as string));
  const dataMode = modes.size === 0 ? "MOCK" : modes.size === 1 ? [...modes][0] : "PARTIAL";
  return {
    horizon,
    threshold: p.threshold,
    dataMode,
    cards: shown,
    mitigationLibrary: p.mitigations,
    planRows: buildRiskPlanRows(ctx, shown, p.threshold, horizon),
  };
}

// PRD-IND-risk §2.4：处置行动计划表——每基地主因素首选方案 + 峰值≥90 备份 + 14 天内反提 S&OP；按启动日排序。
const RISK_OWNER_NAMES = ["王", "李", "张", "刘", "陈", "杨", "赵", "黄"];
const RISK_FACTOR_OBJ: Record<string, string> = {
  瓶颈工序: "产线负载率",
  设备OEE: "设备OEE",
  人力工时: "人力工时供给",
  物料齐套: "物料供给齐套",
  物流时长: "物流在途时效",
  换型损失: "换型占用",
  良率波动: "良率稳定性",
};
function riskHashN(s: string, mod: number): number {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 997;
  return x % mod;
}
function mmdd(startIso: string, day: number): string {
  const ms = Date.parse(`${startIso.slice(0, 10)}T00:00:00Z`) + day * 86400000;
  return new Date(ms).toISOString().slice(5, 10);
}
function buildRiskPlanRows(
  c: SolverContext,
  cards: Record<string, unknown>[],
  threshold: number,
  horizon: number,
): Record<string, unknown>[] {
  const fs = c.params.forecastStart;
  const mits = c.params.risk.mitigations;
  // WO-LIVE-DISPOSITION：处置系数复用 base_capacity_outlook 的 PUBLISHED 规则（R14·单源）。
  const coeffRule = c.rules?.base_outlook_coeffs;
  const overtimeUpliftPct = num(coeffRule?.params?.overtimeUpliftPct, 0.15);
  const crossBaseAbsorbPct = num(coeffRule?.params?.crossBaseAbsorbPct, 0.6);
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const early: string[] = [];

  const makeSteps = (card: Record<string, unknown>): ReturnType<typeof deriveDisposition> => {
    const baseId = str(card.baseId);
    const baseObj = c.bases.find((b) => str(b.props.baseId) === baseId);
    const freeDaily = baseFreeDaily(baseId, c.lines, baseObj);
    const futureQty = round(
      c.orders
        .filter((o) => {
          if (!Array.isArray(o.props.bases)) return false;
          const firstBase = str((o.props.bases as unknown[])[0]);
          if (firstBase !== baseId) return false;
          const dueDay = dayFrom(fs, str(o.props.due));
          return dueDay >= 1 && dueDay <= horizon;
        })
        .reduce((a, o) => a + num(o.props.qty), 0),
      2,
    );
    const shortfall = round(Math.max(0, num(card.peak) - threshold), 2);
    return deriveDisposition(shortfall, {
      horizon,
      crossDay: (card.crossDay as number | null) ?? null,
      forecastStart: fs,
      baseId,
      overtimeUpliftPct,
      crossBaseAbsorbPct,
      freeDaily,
      inProdTotal: 0,
      futureQty,
    });
  };

  for (const card of cards) {
    const base = str(card.base);
    const factor = str(card.factor);
    const peak = Math.round(num(card.peak));
    const cross = (card.crossDay as number | null) ?? num(card.horizon, 14);
    if (cross <= 14 && !early.includes(base)) early.push(base);
    if (seen.has(base)) continue; // 每基地主因素一行（cards 已按越线日排序）
    seen.add(base);
    const owner = `基地负责人 · ${RISK_OWNER_NAMES[riskHashN(base, 8)]}经理`;
    const sols = mits[factor] ?? [];
    const s0 = sols[0];
    if (!s0) continue;
    const steps = makeSteps(card);
    rows.push({
      act: `${s0.name}（${base.replace("基地", "").replace("·总部", "")}）`,
      det: `峰值${peak}·${RISK_FACTOR_OBJ[factor] ?? factor}`,
      owner,
      start: `T+${cross - 7}·${mmdd(fs, cross - 7)}（越线前7天）`,
      done: `T+${cross}·${mmdd(fs, cross)}（越线日）`,
      eff: `消解≈${s0.eff}·${s0.tn}天起效`,
      rule: "C05",
      steps,
    });
    if (peak >= 90 && sols[1]) {
      rows.push({
        act: `${sols[1].name}（${base.replace("基地", "").replace("·总部", "")}·备份方案）`,
        det: "峰值≥90 双保险",
        owner,
        start: `T+${cross - 3}·${mmdd(fs, cross - 3)}`,
        done: `T+${cross + 7}·${mmdd(fs, cross + 7)}`,
        eff: `消解≈${sols[1].eff}·${sols[1].tn}天起效`,
        rule: "C05",
        steps,
      });
    }
  }
  if (early.length > 0) {
    rows.push({
      act: `反提月度计划差异（${early.map((b) => b.replace("基地", "").replace("·总部", "")).join("、")}）`,
      det: "14 天内越线，需计划层资源协同",
      owner: "计划中心 → S&OP",
      start: `T+1·${mmdd(fs, 1)}`,
      done: "本周 S&OP",
      eff: "计划-执行闭环，差异进入月度议程",
      rule: "C21",
      steps: [],
    });
  }
  rows.sort((a, b) => String(a.start).localeCompare(String(b.start), undefined, { numeric: true }));
  return rows;
}

/**
 * audit / generate 视图 · 每审计项独立时序（audit_timeline，确定性 R6）：按 kind（产销/毛利/齐套/现金/份额/
 * 爬坡/外协/capex23/struct）出 90 天逐日传导度 series——4 阶段（事件窗→约束越线→波及订单→财务击穿）锚点
 * 分段线性 + 固定 hashN 微抖动 + clamp[40,97]，越线日/峰值。**与产能推演 risk_timeline 同款逐日交互**（前端共用组件）。
 * 形状由 kind 名 hash 确定性派生（R14 无 per-kind 业务常数），阈值取 params.risk.threshold。args: { kind, horizon=90 }。
 */
export function auditTimeline(c: SolverContext, args: Record<string, unknown>): Record<string, unknown> {
  const kind = str(args.kind, "struct");
  const horizon = Math.max(30, Math.floor(num(args.horizon, 90)));
  const threshold = c.params.risk.threshold;
  const h = hashString(kind);
  const peakDay = 16 + (h % 40);
  const peakVal = clamp(threshold + 2 + (h % 12), 40, 97);
  const base = 48 + (h % 10);
  const series: number[] = [];
  for (let d = 0; d < horizon; d++) {
    const ramp = d <= peakDay ? base + (peakVal - base) * (d / Math.max(1, peakDay)) : peakVal - (peakVal - base) * 0.4 * ((d - peakDay) / Math.max(1, horizon - peakDay));
    const jitter = (hashString(`${kind}:${d}`) % 7) - 3;
    series.push(round(clamp(ramp + jitter, 40, 97), 0));
  }
  const crossIdx = series.findIndex((v) => v >= threshold);
  const stages = [
    { d: Math.max(2, peakDay - 14), label: "事件窗" },
    { d: peakDay, label: "约束越线" },
    { d: Math.min(horizon - 1, peakDay + 7), label: "波及订单" },
    { d: Math.min(horizon - 1, peakDay + 18), label: "财务击穿" },
  ];
  // PRD §5：复用 risk_timeline 的 events/affectedOrders 引擎——按 kind hash 选代表基地（确定性 R6），
  // 使每审计项逐日轴也带当日事件 + 受影响订单（与产能推演同款悬停详情）。
  const baseIds = c.bases.map((b) => str(b.props.baseId)).sort();
  const repBase = baseIds.length > 0 ? baseIds[h % baseIds.length]! : "";
  const events = repBase ? riskEvents(c, repBase, horizon) : [];
  const orders = repBase ? affectedOrders(c, { baseId: repBase, day: crossIdx < 0 ? horizon : crossIdx, peak: Math.max(...series) }).affected : [];
  return {
    kind, series, stages, peak: Math.max(...series), crossDay: crossIdx < 0 ? null : crossIdx, threshold,
    // 轨M 增量2（audit_timeline 去哈希诚实标·KILL-MOCK-RED）：series/peak/crossDay 是按 kind 名 hashString 确定性派生的
    // **形状投影**（SolverContext 无逐日审计口径实测时序源）→ dataMode 恒 MOCK + provenanceSynthetic 披露，绝不裸渲染当
    // 实测真值（前端据此显"估算/合成"，不把恒越线红当真）。真时序/真求解器接入后可升 LIVE（audit_timeline 数据半待补）。
    dataMode: "MOCK",
    provenanceSynthetic: true,
    note: "逐日 series/峰值/越线日为按审计口径名确定性派生的形状投影（无逐日实测时序源）·估算非实测——不裸渲染当真值",
    events: events.map((e) => ({ type: e.type, day: e.day, amp: e.amp, factors: e.factors, ...(e.tag ? { tag: e.tag } : {}), ...(e.obj ? { obj: e.obj } : {}), ...(e.desc ? { desc: e.desc } : {}), ...(e.src ? { src: e.src } : {}) })),
    affectedOrders: orders,
  };
}

/**
 * cockpit P4 反事实双轨推演（"如不解决 XX，未来 N 天会怎样"）：编排 risk_timeline——baseline = do-nothing
 * 前向曲线、mitigated = 处置后曲线（mitigation eff/tn 衰减，复用 tensionSeries 同口径）→ 双序列 + 差值
 * （峰值削减/越线日推迟/少越线日）。确定性 R6（同 base/factor/mitigation 字节一致），不引入新时序基建。
 * args: { base?, factor?, horizon=30, mitigationKey? }（缺 base/factor → 取自动卡里峰值最高者）。
 */
export function counterfactualTimeline(c: SolverContext, args: Record<string, unknown>): Record<string, unknown> {
  const horizon = Math.max(1, Math.floor(num(args.horizon, 30)));
  let base = args.base ? str(args.base) : "";
  let factor = args.factor ? str(args.factor) : "";
  if (!base || !factor) {
    const probe = riskTimeline(c, { horizon }) as { cards: { base: string; factor: string; peak: number }[] };
    const worst = [...probe.cards].sort((a, b) => b.peak - a.peak || (a.base < b.base ? -1 : 1))[0];
    if (!worst) throw validationError("counterfactual_timeline 无可推演风险卡（指定 base+factor）");
    base = base || worst.base;
    factor = factor || worst.factor;
  }
  const mits = c.params.risk.mitigations[factor] ?? [];
  const mitKey = args.mitigationKey ? str(args.mitigationKey) : mits[0]?.key;
  if (!mitKey) throw validationError(`counterfactual_timeline 因子 ${factor} 无对症方案`);
  const run = riskTimeline(c, { base, factor, horizon, mitigation: { base, factor, planKey: mitKey } }) as {
    threshold: number;
    cards: { base: string; factor: string; series: number[]; peak: number; crossDay: number | null; events: unknown[]; mitigated?: { series: number[]; appliedPlan: string; peak: number; crossDay: number | null } }[];
  };
  const card = run.cards[0];
  if (!card?.mitigated) throw validationError("counterfactual_timeline 处置曲线生成失败");
  const threshold = run.threshold;
  const baselineSeries = card.series;
  const mitigatedSeries = card.mitigated.series;
  const overDays = (s: number[]) => s.filter((v) => v >= threshold).length;
  const bCross = card.crossDay;
  const mCross = card.mitigated.crossDay;
  const crossDelayDays = bCross === null ? 0 : mCross === null ? baselineSeries.length - bCross : mCross - bCross;
  return {
    baselineSeries,
    mitigatedSeries,
    threshold,
    factor,
    base: card.base,
    mitigation: card.mitigated.appliedPlan,
    delta: {
      peakCut: round(card.peak - card.mitigated.peak, 4),
      crossDelayDays,
      ordersSaved: Math.max(0, overDays(baselineSeries) - overDays(mitigatedSeries)),
    },
    events: card.events,
    summary: `如不解决「${card.base}·${factor}」：峰值 ${Math.round(card.peak)} → 处置后 ${Math.round(card.mitigated.peak)}（削 ${Math.round(card.peak - card.mitigated.peak)}）、越线日推迟 ${crossDelayDays} 天`,
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
): { baseId: string; affected: Record<string, unknown>[]; total: number; count: number; columns: string[]; rows: unknown[][]; fallback: boolean; problems: OrderProblemGroupOut[] } {
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
  // G-2：AgentCore 种子 plan 的 render 读 data.rows/data.count；补别名使跨服务一致
  // （与 capacity_forecast 的 gapPct/mainBottleneck 别名同范式，治"mock 藏住的形状不匹配"）。
  return {
    baseId,
    affected,
    total: affected.length,
    count: affected.length,
    columns: ["so", "cust", "model", "qty", "due"],
    rows: affected.map((o) => [o.so, o.cust, o.model, o.qty, o.due]),
    fallback,
    problems,
  };
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
// DF.3b（PRD order §4.5-C）：营收口径统一到原型 SEG_REGISTRY 万元/套（2.2/1.4/1.8），
// 取代旧 {0.6/0.55/0.5} 不一致口径 → affectedOrders summary.revenue 与 order econTable 同源一致。
// WO-UNIT-NORMALIZE §3：Order.qty 单位=套 · 金额(亿)=Σ qty(套)×priceWan(万元/套)/1e4。
// summary.revenue 与 problems[].financeImpact 同用 SEG_PRICE(=priceWan) 价基（消除旧 unitPrice 元 vs priceWan 万元 的 30x 劈裂）。
const SEG_PRICE: Record<string, number> = Object.fromEntries(SEG_REGISTRY.map((s) => [s.key, s.priceWan]));

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
        e = { so, cust: str(a.cust), seg: segmentOf(c, str(a.cust)).name, model: str(a.model), qty: num(a.qty), due: str(a.due), delay: num(a.delay), risks: [] };
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

  // PRD-IND-order-aggregate §4.5-D：明细按交期升序（最早到期最先看），交期相同按订单号。
  const rows = [...byOrder.values()].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.so < b.so ? -1 : 1));
  const totalQty = round(rows.reduce((s, r) => s + r.qty, 0), 2);
  // WO-UNIT-NORMALIZE §3：亿 = Σ qty(套)×priceWan(万元/套) / 1e4（与 financeImpact 同价基同公式）。
  const revenue = round(rows.reduce((s, r) => s + r.qty * (SEG_PRICE[segmentOf(c, r.cust).key] ?? 0.6), 0) / 1e4, 4);
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

// PRD-IND-order-aggregate §4.5-B：应用细分按客户名判定（客户名单与合成数据 CUSTOMERS 保持一致）。
const PAS_CUSTOMERS = new Set(["广汽集团", "长安汽车", "吉利汽车", "东风汽车", "小鹏汽车"]);
const COM_CUSTOMERS = new Set(["宇通客车", "金龙客车", "奇瑞", "瑞驰新能源", "Ashok Leyland"]);
const ESS_CUSTOMERS = new Set(["国家电网", "国家电投", "南方电网", "龙源电力"]);
export function segOfCust(cust: string): "pas" | "ess" | "com" {
  if (COM_CUSTOMERS.has(cust)) return "com";
  if (ESS_CUSTOMERS.has(cust)) return "ess";
  return "pas";
}
function segmentOf(c: SolverContext, cust: string): { key: string; name: string; gm: number } {
  const key = segOfCust(cust);
  const seg = c.segments.find((s) => s.props.segKey === key);
  return { key, name: str(seg?.props.name, key), gm: num(seg?.props.gmRate, c.params.audit.segMargins[key]) };
}

/**
 * PRD-IND-dash ORDER_OVR：逐单越线注入的纯应用函数（确定性 R6）——
 * `credit:true` 把信用占用比强制越限（≥1.05 → 触发 CREDIT 判定）；`mAdj` 直接下调细分毛利（→ 可能触发 MARGIN）。
 * 无 override 时原样返回（hash 派生口径不变）。
 */
export function applyOrderOverride(
  baseCredit: number,
  baseGm: number,
  ov?: { credit?: boolean; mAdj?: number; why?: string },
): { creditRatio: number; gm: number } {
  return {
    creditRatio: ov?.credit ? Math.max(baseCredit, 1.05) : baseCredit,
    gm: ov?.mAdj ? round(baseGm + ov.mAdj, 1) : baseGm,
  };
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
    const dueDay = num(row.dueDay);
    const delay = num(row.delay);
    // PRD-IND-dash ORDER_OVR：逐单越线注入——override 信用超限 / 毛利下调（含 why），否则 hash 派生（R6）。
    const ov = cfg.overrides?.[so];
    const baseCredit = round(cfg.creditBase + (hashString(`${cust}|${so}`) % cfg.creditMod) / 100, 2);
    const seg = segmentOf(c, cust);
    const { creditRatio, gm: segGm } = applyOrderOverride(baseCredit, seg.gm, ov);
    const etaDay = num(shipment?.props.etaDay);
    const kitGapDays = shipment && (shipment.props.status === "DELAYED" || etaDay > dueDay) ? Math.max(1, etaDay - dueDay) : 0;
    const plan = mitPlan(bottleneck);
    const remedyBn = plan ? `对策：${plan.name}（T+${plan.tn} 生效，预计消解 ${plan.eff} 点）` : `对策：${bottleneck}专项消解`;

    // 归并优先级：更具体的判定（信用/毛利/齐套）优先，交期为窗口内订单的兜底判定。
    if (creditRatio > 1) {
      add("CREDIT", row,
        `信用判定：客户 ${cust} 信用占用比 ${creditRatio} 超过额度上限 1.0（规则 ${cfg.ruleKeys.CREDIT}）`,
        ov?.why ? `根因：${ov.why}` : `根因：${cust} 在手订单集中放量，信用敞口未同步扩容`,
        "对策：信用复核 + 预收款比例上调，超限部分分批释放");
      continue;
    }
    if (segGm < cfg.gmFloor) {
      add("MARGIN", row,
        `毛利判定：${seg.name}细分毛利 ${segGm}% 低于底线 ${cfg.gmFloor}%（规则 ${cfg.ruleKeys.MARGIN}）`,
        ov?.why ? `根因：${ov.why}` : `根因：${seg.name}细分结构毛利偏低，延误追加成本进一步侵蚀`,
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
    // WO-UNIT-NORMALIZE §3：金额(亿) = Σ qty(套)×priceWan(万元/套) / 1e4。价基 = SEG_PRICE(priceWan)，与 summary.revenue 一致（消除旧 unitPrice 元 × 10000 的 30x 劈裂/超估）。
    const finance = round(b.rows.reduce((a, r) => a + num(r.qty) * (SEG_PRICE[segmentOf(c, str(r.cust)).key] ?? 0.6), 0) / 1e4, 4);
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
