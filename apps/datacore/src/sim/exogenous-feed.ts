/**
 * ExogenousFeed 解析与冻结（WO-SANDBOX-TEMPORAL-GROUNDING·S6·§3.1·闭 G-A）。
 *
 * createSimSession 时按 scope+horizon 从**真源**解出逐 tick 序列并**冻结进会话**（R6·同会话同 feed·
 * 会话内不再查库·真世界后续变化不影响已开会话）。逐 tick 序列再由 propagateTick 注入 target 格。
 *
 * ⛔ KILL-MOCK-RED（§3.1 F1）：**无真源 → 不生成该 feed**（live=false·报缺口·绝不合成/外推未来）。
 *    demand_segment 只有在细分对象**声明了逐日预测率(dailyP50)+覆盖天数(coverageDays)** 时才有时序；
 *    只有聚合 p50 而无逐日/覆盖声明 → 不铺成伪日曲线，据实报缺口（诚实空态）。
 * ⛔ R6：纯函数·确定性（对象/序列稳定排序·无 Date.now/random）。同真源同 horizon → 同 feed。
 * ⛔ coverageTicks < horizon 时**只铺到覆盖处·绝不外推**（不足由 S0 horizon 预检另报，本模块只据实标 coverage）。
 */
import type { CellRef, ExogenousFeed, ExogenousFeedSource } from "@platform/contracts";
import type { ObjectInstance } from "../domain.js";
import { num, str } from "../solvers/types.js";

const PRECISION = 1e12;
const round12 = (n: number): number => {
  const r = Math.round(n * PRECISION) / PRECISION;
  return Object.is(r, -0) ? 0 : r;
};

export interface FeedSpec {
  feedKey: string;
  target: CellRef;
  source: ExogenousFeedSource;
}

/** 真源快照（app 从 repos 装配·测试可直构真对象形状）。缺省视为空（诚实）。 */
export interface FeedResolveSources {
  demandSegments: ObjectInstance[];
  sopVersions: ObjectInstance[];
  purchaseOrders: ObjectInstance[];
  maintPlans: ObjectInstance[];
  /** A8 稀疏/密序列：seriesKey → 逐 tick 真实点（tick 已归一为模拟 tick，value=测量值）。 */
  tsSeriesPoints: (seriesKey: string) => { tick: number; value: number }[];
}

/** 无真源缺口（feed 未生成·§3.1）——feed 侧诚实缺口（区别于 S0 horizon 覆盖预检）。 */
export interface FeedGap {
  feedKey: string;
  gapCode: "EMPTY_DATA";
  detail: string;
}

export interface FeedResolveResult {
  feeds: ExogenousFeed[];
  gaps: FeedGap[];
}

/** 生成 [0, len) 的等值序列（len<=0 → 空）。 */
function flatSeries(delta: number, len: number): { tick: number; delta: number }[] {
  const out: { tick: number; delta: number }[] = [];
  for (let t = 0; t < len; t++) out.push({ tick: t, delta });
  return out;
}

/** 解析一条 feed spec → feed（真源足够）或 null（无真源·同时产 gap）。 */
function resolveOne(spec: FeedSpec, horizonTicks: number, src: FeedResolveSources): { feed?: ExogenousFeed; gap?: FeedGap } {
  const { source } = spec;
  const gap = (detail: string): { gap: FeedGap } => ({ gap: { feedKey: spec.feedKey, gapCode: "EMPTY_DATA", detail } });

  if (source.kind === "demand_segment") {
    const keys = new Set(source.segmentKeys);
    const matched = src.demandSegments.filter((d) => keys.has(str(d.props.segId)) || keys.has(str(d.props.segment)));
    if (matched.length === 0) return gap(`需求细分预测未找到（segmentKeys=${source.segmentKeys.join(",")}）·无真源不合成未来`);
    // 逐日预测率 Σ dailyP50（真声明·非从聚合 p50 铺伪曲线）；覆盖天数 = 各细分声明覆盖的最小值（诚实取交集）。
    let dailyRate = 0;
    let coverage = Number.POSITIVE_INFINITY;
    let anyTemporal = false;
    for (const d of matched) {
      const daily = num(d.props.dailyP50, NaN);
      const cov = num(d.props.coverageDays, NaN);
      if (Number.isFinite(daily) && Number.isFinite(cov) && cov > 0) {
        dailyRate += Math.max(0, daily);
        coverage = Math.min(coverage, cov);
        anyTemporal = true;
      }
    }
    if (!anyTemporal) return gap(`需求细分仅有聚合 p50、无逐日预测率(dailyP50)+覆盖天数(coverageDays) 声明 → 无时序·不铺伪日曲线`);
    const coverageTicks = Math.floor(coverage);
    const len = Math.max(0, Math.min(coverageTicks, horizonTicks));
    return { feed: { feedKey: spec.feedKey, target: spec.target, source, series: flatSeries(round12(dailyRate), len), live: true, coverageTicks } };
  }

  if (source.kind === "sop_version") {
    const row = src.sopVersions.find((s) => str(s.props.verId) === source.versionRef || str(s.props.version) === source.versionRef || s.id === source.versionRef);
    if (!row) return gap(`S&OP 版本未找到（versionRef=${source.versionRef}）·无真源不合成未来`);
    const daily = num(row.props.dailyDemand, NaN);
    const cov = num(row.props.coverageDays, NaN);
    if (!Number.isFinite(daily) || !Number.isFinite(cov) || cov <= 0) return gap(`S&OP 版本无逐日需求(dailyDemand)+覆盖天数(coverageDays) 声明 → 无时序`);
    const coverageTicks = Math.floor(cov);
    const len = Math.max(0, Math.min(coverageTicks, horizonTicks));
    return { feed: { feedKey: spec.feedKey, target: spec.target, source, series: flatSeries(round12(Math.max(0, daily)), len), live: true, coverageTicks } };
  }

  if (source.kind === "purchase_order_eta") {
    // 在途订单：到达 tick 入库（离散事件·天然时序）。props.arriveTick(int) + props.qty。
    const arrivals: { tick: number; delta: number }[] = [];
    for (const po of src.purchaseOrders) {
      const t = num(po.props.arriveTick, NaN);
      const qty = num(po.props.qty, NaN);
      if (Number.isFinite(t) && Number.isFinite(qty) && t >= 0 && t < horizonTicks) arrivals.push({ tick: Math.floor(t), delta: round12(qty) });
    }
    if (arrivals.length === 0) return gap(`无在途订单落在 horizon 内（需 props.arriveTick+qty）·无真源不合成`);
    // 同 tick 合并（确定性）。
    const byTick = new Map<number, number>();
    for (const a of arrivals) byTick.set(a.tick, round12((byTick.get(a.tick) ?? 0) + a.delta));
    const series = [...byTick.entries()].sort((a, b) => a[0] - b[0]).map(([tick, delta]) => ({ tick, delta }));
    const coverageTicks = Math.max(...series.map((s) => s.tick)) + 1;
    return { feed: { feedKey: spec.feedKey, target: spec.target, source, series, live: true, coverageTicks } };
  }

  if (source.kind === "maint_plan") {
    // 检修窗口：产能降/置 0（离散·天然时序）。props.tick(int) + props.capacityDelta（负值降产）。
    const events: { tick: number; delta: number }[] = [];
    for (const mp of src.maintPlans) {
      const t = num(mp.props.tick, NaN);
      const d = num(mp.props.capacityDelta, NaN);
      if (Number.isFinite(t) && Number.isFinite(d) && t >= 0 && t < horizonTicks) events.push({ tick: Math.floor(t), delta: round12(d) });
    }
    if (events.length === 0) return gap(`无检修计划落在 horizon 内（需 props.tick+capacityDelta）·无真源不合成`);
    const byTick = new Map<number, number>();
    for (const e of events) byTick.set(e.tick, round12((byTick.get(e.tick) ?? 0) + e.delta));
    const series = [...byTick.entries()].sort((a, b) => a[0] - b[0]).map(([tick, delta]) => ({ tick, delta }));
    const coverageTicks = Math.max(...series.map((s) => s.tick)) + 1;
    return { feed: { feedKey: spec.feedKey, target: spec.target, source, series, live: true, coverageTicks } };
  }

  // ts_series：A8 真实点（tick+value）→ 逐 tick delta（value 即当 tick 的外生增量）。
  const points = src.tsSeriesPoints(source.seriesKey).filter((p) => p.tick >= 0 && p.tick < horizonTicks);
  if (points.length === 0) return gap(`A8 序列 ${source.seriesKey} 在 horizon 内无真实点·无真源不合成未来`);
  const byTick = new Map<number, number>();
  for (const p of points) byTick.set(Math.floor(p.tick), round12(p.value));
  const series = [...byTick.entries()].sort((a, b) => a[0] - b[0]).map(([tick, delta]) => ({ tick, delta }));
  const coverageTicks = Math.max(...series.map((s) => s.tick)) + 1;
  return { feed: { feedKey: spec.feedKey, target: spec.target, source, series, live: true, coverageTicks } };
}

/**
 * 解析全部 feed spec（确定性·按 feedKey 稳定排序）→ 冻结用 feeds + 无真源缺口清单。
 * @returns feeds（可冻结进会话）+ gaps（无真源·未生成·诚实报缺口卡）
 */
export function resolveExogenousFeeds(specs: FeedSpec[], horizonTicks: number, src: FeedResolveSources): FeedResolveResult {
  const feeds: ExogenousFeed[] = [];
  const gaps: FeedGap[] = [];
  for (const spec of [...specs].sort((a, b) => a.feedKey.localeCompare(b.feedKey))) {
    const { feed, gap } = resolveOne(spec, horizonTicks, src);
    if (feed) feeds.push(feed);
    if (gap) gaps.push(gap);
  }
  return { feeds, gaps };
}
