/**
 * WO-SANDBOX-TEMPORAL-GROUNDING · §3.6 回放校验（G-E · 给 UNCALIBRATED 转正路径）。
 *
 * 传导规则拿 A8 `ts_points` 历史逐日回放 → 预测 vs 实际 → 容差内 → 规则 VALIDATED；
 * 无历史 → 诚实 NO_HISTORY（绝不假验证 · KILL-MOCK-RED）。这是 S2 徽标
 * UNCALIBRATED → VALIDATED 的唯一转正路径（母体 §8 G-10 "改规则即改推演·回放校验闭环"）。
 *
 * ── 复用而非重建（WO §4 触点表钉死）──────────────────────────────────────────
 *  · 确定性重放引擎 = sandbox 的 `sim/propagation.ts propagateTick`（同输入→同输出·R6），
 *    **不另写传导数学**——本文件只"驱动"既有引擎逐日前推，与 `/tick` 端点同一逻辑。
 *  · 回放-对比范式 = `calibration/replay.ts` M11 `replayPairs`（逐样本 预测 vs 实际、
 *    APE 累加、容差判定）的同构移植：M11 对容量预测配对样本重放，本文件对**传导规则**在
 *    A8 历史窗口上重放。M11 的 `replayPredictedDaily`（一次 rollup 重放任意样本）在此由
 *    `propagateTick`（一次 tick 重放整图）担当同一"确定性预测器"角色。
 *
 * R6 确定性：纯重算，无 Date.now / Math.random；computedAt 由调用方传入；遍历按 key 稳定排序。
 * 教师强制（teacher forcing）：每步都以**真实态**为源（真实外生 = 真历史逐日喂入），比较模型
 * 预测的 Δ 与真实 Δ —— 隔离规则本身的预测力，避免误差跨日复合污染判定。
 */
import type {
  PropagationRule,
  ReplayValidationResult,
  ReplayValidationStatus,
  RuleReplayResult,
  TickState,
} from "@platform/contracts";
import { round } from "../prng.js";
import { propagateTick, type PropagationGraph, type RuleParamLookup } from "./propagation.js";

/** 相对误差分母下限（借 calibration/config EPS 同口径，避免除 0；本地常量，零业务语义）。 */
const EPS = 1e-6;

export interface ReplayWindow {
  /** 回放窗口天数 N（步数上限 = 可用连续日对数）。 */
  days: number;
  /** 判定容差（相对·Δ 口径）：meanApe ≤ tolerance → VALIDATED。config·R14。 */
  tolerance: number;
}

/** §3.6 默认窗口（config·换租户改配置不改码 R14）。 */
export const DEFAULT_REPLAY_WINDOW: ReplayWindow = { days: 30, tolerance: 0.15 };

/** 回放输入：真实图 + 规则参数 + 逐日真实全态快照（index 0 = 窗口最早日 … 末 = 最近日）。 */
export interface ReplayHistory {
  graph: PropagationGraph;
  ruleParams: RuleParamLookup;
  /** 逐日真实态（≥2 才有 1 步可对比；由 A8 ts_points 解出，稀疏则只含真实观测日）。 */
  dailyStates: TickState[];
}

interface RuleAcc {
  apeSum: number;
  samples: number;
  cells: Set<string>;
}

/**
 * §3.6 核心：对每条规则跑历史回放，判 VALIDATED / OUT_OF_TOLERANCE / NO_HISTORY。
 *
 * 逐步 d（0..len-2）：以真实态 states[d] 为源跑 `propagateTick`（真实外生 = 真历史），
 * 得预测态 states[d+1]̂；对每条规则命中的目标格，比较 **预测Δ = next[cell]−real[d][cell]**
 * 与 **实际Δ = real[d+1][cell]−real[d][cell]**，累加 APE。延迟规则的 pending 跨步携带
 * （到达步真触发·与引擎自洽）。样本为 0 的规则诚实标 NO_HISTORY（绝不假验证）。
 *
 * @param tenantId R2 溯源
 * @param rules    PropagationRule[]（调用方应传 PUBLISHED）
 * @param window   { days, tolerance }
 * @param history  { graph, ruleParams, dailyStates }（A8 历史解出的逐日真实态）
 * @param computedAt R6：时间戳由调用方传入（不 Date.now）
 */
export function replayPropagationRules(
  tenantId: string,
  rules: PropagationRule[],
  window: ReplayWindow,
  history: ReplayHistory,
  computedAt: string,
): ReplayValidationResult {
  const sortedRules = [...rules].sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id));
  const acc = new Map<string, RuleAcc>();
  for (const r of sortedRules) acc.set(r.key, { apeSum: 0, samples: 0, cells: new Set() });
  const targetVarOf = new Map(sortedRules.map((r) => [r.key, r.targetStateVar] as const));

  const states = history.dailyStates;
  let pending = [] as ReturnType<typeof propagateTick>["pending"];
  for (let d = 0; d < states.length - 1; d++) {
    const real = states[d];
    const realNext = states[d + 1];
    if (!real || !realNext) continue;
    const out = propagateTick(history.graph, real, sortedRules, pending, d, history.ruleParams);
    pending = out.pending;
    // 归并本步每条规则触达的目标对象（trace 的 ruleKey→toObjectId；即时贡献 + 延迟到达皆有 ruleKey）。
    const hitByRule = new Map<string, Set<string>>();
    for (const tr of out.trace) {
      const set = hitByRule.get(tr.ruleKey) ?? hitByRule.set(tr.ruleKey, new Set()).get(tr.ruleKey)!;
      set.add(tr.toObjectId);
    }
    for (const rk of [...hitByRule.keys()].sort()) {
      const a = acc.get(rk);
      const tv = targetVarOf.get(rk);
      if (!a || tv === undefined) continue; // 延迟到达可能引用已过滤规则——保守跳过
      for (const oid of [...hitByRule.get(rk)!].sort()) {
        const predicted = out.next[oid]?.[tv];
        const actualNow = realNext[oid]?.[tv];
        const before = real[oid]?.[tv];
        // 三值皆须真实有限数（KILL-MOCK-RED：缺真值不补 0 造样本，诚实略过该格）。
        if (
          typeof predicted !== "number" || !Number.isFinite(predicted) ||
          typeof actualNow !== "number" || !Number.isFinite(actualNow) ||
          typeof before !== "number" || !Number.isFinite(before)
        ) continue;
        const predDelta = predicted - before;
        const actualDelta = actualNow - before;
        const ape = Math.abs(predDelta - actualDelta) / Math.max(Math.abs(actualDelta), EPS);
        a.apeSum += ape;
        a.samples += 1;
        a.cells.add(oid);
      }
    }
  }

  const ruleResults: RuleReplayResult[] = sortedRules.map((r) => {
    const a = acc.get(r.key)!;
    if (a.samples === 0) {
      return { ruleKey: r.key, status: "NO_HISTORY" as ReplayValidationStatus, samples: 0, cellsCompared: 0, meanApe: null, tolerance: window.tolerance };
    }
    const meanApe = round(a.apeSum / a.samples, 6);
    const status: ReplayValidationStatus = meanApe <= window.tolerance ? "VALIDATED" : "OUT_OF_TOLERANCE";
    return { ruleKey: r.key, status, samples: a.samples, cellsCompared: a.cells.size, meanApe, tolerance: window.tolerance };
  });

  const withHistory = ruleResults.filter((r) => r.status !== "NO_HISTORY");
  const validatedCount = ruleResults.filter((r) => r.status === "VALIDATED").length;
  const overall: ReplayValidationStatus =
    withHistory.length === 0
      ? "NO_HISTORY"
      : withHistory.every((r) => r.status === "VALIDATED")
        ? "VALIDATED"
        : "OUT_OF_TOLERANCE";

  return {
    tenantId,
    window: { days: window.days, tolerance: window.tolerance },
    status: overall,
    rules: ruleResults,
    validatedCount,
    rulesWithHistory: withHistory.length,
    computedAt,
  };
}

// ── A8 ts_points → 逐日真实全态快照（纯函数·可测·无 repos 依赖） ─────────────────
/** A8 series 的最小投影（measureFields + 真实观测点）。调用方从 repos 装配后传入。 */
export interface ReplaySeriesLike {
  measureFields: string[];
  points: { entityId: string; ts: string; values: Record<string, number> }[];
}

/**
 * 把 A8 稀疏真实序列解成逐日 `TickState[]`（供 replayPropagationRules 起跑）。
 * 只认真实观测日（稀疏则步数少·不外推不补日 → KILL-MOCK-RED）；仅保留命中 stateVars 的 measureField；
 * entity→objectId 由调用方解析（主键/id 映射）。取最近 (days+1) 个观测日，升序，位置即 tick 序。
 *
 * @returns dailyStates（升序）· coveredDays（可用步数 = 观测日数−1）· days（保留观测日数）
 */
export function buildDailyStatesFromSeries(
  seriesList: ReplaySeriesLike[],
  stateVars: string[],
  entityToObjectId: (entityId: string) => string | undefined,
  window: { days: number },
): { dailyStates: TickState[]; coveredDays: number; observedDays: number } {
  const svSet = new Set(stateVars);
  // day bucket -> objId -> stateVar -> value（同日同格后写覆盖，稳定：按 ts 升序遍历）。
  const byDay = new Map<string, TickState>();
  for (const series of seriesList) {
    const measured = series.measureFields.filter((m) => svSet.has(m));
    if (measured.length === 0) continue;
    const pts = [...series.points].sort((a, b) => a.ts.localeCompare(b.ts));
    for (const p of pts) {
      const oid = entityToObjectId(p.entityId);
      if (!oid) continue;
      const day = p.ts.slice(0, 10);
      const dayState = byDay.get(day) ?? byDay.set(day, {}).get(day)!;
      const cell = dayState[oid] ?? (dayState[oid] = {});
      for (const m of measured) {
        const v = p.values[m];
        if (typeof v === "number" && Number.isFinite(v)) cell[m] = v;
      }
    }
  }
  const days = [...byDay.keys()].sort();
  const kept = days.slice(Math.max(0, days.length - (window.days + 1)));
  const dailyStates = kept.map((d) => byDay.get(d)!);
  return { dailyStates, coveredDays: Math.max(0, dailyStates.length - 1), observedDays: dailyStates.length };
}
