import type { CalibrationPairRecord, ObjectInstance } from "../domain.js";
import { round } from "../prng.js";
import { setByPath } from "../paths.js";
import { computeRollup, curveMult } from "../solvers/capacity.js";
import { num, str, type SolverContext, type SolverParamsShape } from "../solvers/types.js";
import { EPS } from "./config.js";

/**
 * M11 重放执行体：求解器全部确定性（同输入+同参数=同输出），归因与回测建立在
 * "历史重放"之上 —— 给定（可能被替换了单因子的）上下文，重算任意配对样本的预测值。
 */

export interface ParamPatch {
  scope: "SOLVER_PARAMS" | "ONTOLOGY_PROPERTY";
  path: string;
  /** ONTOLOGY_PROPERTY：currentValue = 切片对象属性均值（按 proposed/current 等比缩放） */
  currentValue: number;
  proposedValue: number;
  modelId: string;
}

/** C09 同款健康度因子（capacity_forecast 的 P90 系数口径）。 */
export function healthFactorOf(params: SolverParamsShape, dataHealth: ObjectInstance[]): number {
  const stale = dataHealth.some((h) => h.props.critical === true && num(h.props.lagHours) > params.health.staleHours);
  return stale ? params.health.degraded : params.health.normal;
}

/** 切片对象集合（ONTOLOGY_PROPERTY 因子）：型号认证产线下的 <ObjectType> 实例。 */
export function sliceObjectsFor(c: SolverContext, modelId: string, objectType: string): ObjectInstance[] {
  const cert = c.certByModel.get(modelId);
  const lineIds = new Set([...(cert?.keys() ?? [])].map((baseId) => `LINE-${baseId}`));
  const pool = objectType === "Process" ? c.processes : objectType === "Equipment" ? c.equipment : objectType === "Line" ? c.lines : [];
  return pool.filter((o) => lineIds.has(str(o.props.lineId)));
}

export function meanProp(objs: ObjectInstance[], prop: string): number {
  const vals = objs.map((o) => num(o.props[prop])).filter((v) => Number.isFinite(v) && v > 0);
  if (vals.length === 0) return 0;
  return round(vals.reduce((a, b) => a + b, 0) / vals.length, 6);
}

/** 打补丁的上下文（不动原对象 —— 重放是只读的）。 */
export function patchContext(c: SolverContext, patch: ParamPatch): SolverContext {
  if (patch.scope === "SOLVER_PARAMS") {
    const params = structuredClone(c.params) as unknown as Record<string, unknown>;
    setByPath(params, patch.path, patch.proposedValue);
    return { ...c, params: params as unknown as SolverParamsShape };
  }
  const [objectType, prop] = patch.path.split(".") as [string, string];
  const targets = new Set(sliceObjectsFor(c, patch.modelId, objectType).map((o) => o.id));
  const scale = patch.currentValue > 0 ? patch.proposedValue / patch.currentValue : 1;
  const patchObjs = (arr: ObjectInstance[]): ObjectInstance[] =>
    arr.map((o) =>
      targets.has(o.id) ? { ...o, props: { ...o.props, [prop]: round(num(o.props[prop]) * scale, 6) } } : o,
    );
  if (objectType === "Process") return { ...c, processes: patchObjs(c.processes) };
  if (objectType === "Equipment") return { ...c, equipment: patchObjs(c.equipment) };
  if (objectType === "Line") return { ...c, lines: patchObjs(c.lines) };
  return c;
}

export interface ReplayModel {
  weeklyByBase: Map<string, number>;
  healthFactor: number;
  maintWeekByBase: Map<string, number | null>;
}

/** 一次 rollup，重放任意多个配对样本（确定性）。 */
export function buildReplayModel(c: SolverContext): ReplayModel {
  const rollup = computeRollup(c);
  const maintWeekByBase = new Map<string, number | null>();
  for (const b of c.bases) {
    const baseId = str(b.props.baseId);
    const mp = c.maintPlans.find((m) => m.props.baseId === baseId);
    maintWeekByBase.set(baseId, mp ? num(mp.props.week) : null);
  }
  return {
    weeklyByBase: new Map(rollup.bases.map((b) => [b.baseId, b.weeklyWan])),
    healthFactor: healthFactorOf(c.params, c.dataHealth),
    maintWeekByBase,
  };
}

/** 与预测记录同一公式：日预测 = Σ基地 周产能×认证系数×curveMult(week)/7。 */
export function replayPredictedDaily(
  c: SolverContext,
  model: ReplayModel,
  modelId: string,
  baseId: string | undefined,
  week: number,
): number {
  const cert = c.certByModel.get(modelId);
  if (!cert || cert.size === 0) return 0;
  const baseIds = baseId ? [baseId] : [...cert.keys()].sort();
  let total = 0;
  for (const b of baseIds) {
    const status = cert.get(b);
    if (!status) continue;
    const certFactor = c.params.certFactors[status] ?? 1;
    const weekly = model.weeklyByBase.get(b) ?? 0;
    total += round((weekly * certFactor * curveMult(c.params, week, model.maintWeekByBase.get(b) ?? null)) / 7, 6);
  }
  return round(total, 6);
}

export interface SimulatedMetrics {
  simulatedMapeAfter: number; // %
  simulatedCoverageAfter: number;
}

/** §5 回测：建议参数对窗口内全部配对样本重放 → simulatedMapeAfter / 模拟覆盖率。 */
export function replayPairs(c: SolverContext, pairs: CalibrationPairRecord[]): SimulatedMetrics {
  const model = buildReplayModel(c);
  if (pairs.length === 0) return { simulatedMapeAfter: 0, simulatedCoverageAfter: 0 };
  let apeSum = 0;
  let covered = 0;
  for (const p of pairs) {
    const pred = replayPredictedDaily(c, model, p.modelId, p.baseId, p.weekOfWindow);
    apeSum += Math.abs(pred - p.actual) / Math.max(p.actual, EPS);
    if (p.actual >= round(pred * model.healthFactor, 6)) covered++;
  }
  return {
    simulatedMapeAfter: round((apeSum / pairs.length) * 100, 2),
    simulatedCoverageAfter: round(covered / pairs.length, 4),
  };
}
