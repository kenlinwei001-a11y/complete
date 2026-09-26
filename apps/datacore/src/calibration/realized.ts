import type { AuthCtx, CalibrationForecastRecord, CalibrationPairRecord, RealizedOutcome, RealizedSubjectRef } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import { validationError } from "../errors.js";
import { hashString, round } from "../prng.js";
import { EPS, sliceKeyOf } from "./config.js";

/**
 * M0-F1 实料配对键（PRD-ai-sim-rev2-ground-truth §2.1）：
 * 把「这一行是那次预测的 actual」这层语义补到已有摄取面上（⛔ 不重造摄取管道）。
 *
 * 仓主定义（§2.0.1）：落库即真实数据（合成的也算）——⛔ 不许以「数据是合成的」为由拒绝登记。
 * 唯一硬拒条件 = provenance 不全（追不回是哪次 sync 的哪一行）⇒ 400 并点名缺哪个字段。
 *
 * 三入口共用一个登记器：
 *  · INGESTED（主入口）—— 摄取 sync 落行后按数据集级映射自动登记（connectors/service.ts 调用），
 *    provenance 必须带 connId/syncJobId/datasetKey/rowRef，且 syncJobId 必须追得到该连接的真实 sync 记录；
 *    连接是 mock_* ⇒ 拒绝并点名（防 §2.0 那个「记录真实、数据合成」的形态）。
 *  · MANUAL_ENTRY —— 人工录入，importedBy/importedAt 审计留痕。
 *  · WORK_ORDER_CLOSURE —— 工单结案回写（接原 PRD C3），rowRef 必须点名结案记录。
 */

/** 预测记录 ⇒ 实料配对用的 subjectRef（日窗口 from==to，asOf = windowTo）。 */
export function forecastSubjectRef(f: CalibrationForecastRecord): RealizedSubjectRef {
  return {
    typeKey: "Model",
    objectId: f.baseId ? `${f.modelId}@${f.baseId}` : f.modelId,
    prop: "dailyOutputWan", // 万套/日 —— 与 CalibrationForecastRecord.predicted 同尺度
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface RealizedRegistrationInput {
  subjectRef: RealizedSubjectRef;
  asOf: string;
  value: number;
  unit: string;
  source: RealizedOutcome["source"];
  provenance: RealizedOutcome["provenance"];
}

/**
 * 登记一条实料（三入口共用）。⛔ provenance 残缺一律 400 点名缺哪个字段，不许静默丢弃。
 * 幂等：同一 (subjectRef|asOf|value|source|provenance) 重登记 = 同一 id upsert。
 */
export async function registerRealizedOutcome(
  repos: Repos,
  tenantId: string,
  input: RealizedRegistrationInput,
): Promise<RealizedOutcome> {
  const { subjectRef, asOf, value, unit, source, provenance } = input;
  if (!subjectRef?.typeKey || !subjectRef.objectId || !subjectRef.prop) {
    throw validationError("subjectRef.typeKey/objectId/prop 均为必填（实料必须指认它观测的是哪个对象的哪个属性）");
  }
  if (!DATE_RE.test(asOf)) throw validationError(`asOf 必须是 YYYY-MM-DD 日期（实测值：'${asOf}'）`);
  if (!Number.isFinite(value)) throw validationError("value 必须是有限数（实料的实际值）");
  if (!unit) throw validationError("unit 必填（无量纲的实际值无法与预测同尺度配对）");
  if (!provenance?.importedBy) throw validationError("provenance.importedBy 缺失：实料必须留登记人（审计留痕）");
  if (!provenance.importedAt) throw validationError("provenance.importedAt 缺失：实料必须留登记时刻（审计留痕）");

  if (source === "INGESTED") {
    if (!provenance.connId) throw validationError("provenance.connId 缺失：INGESTED 实料必须可追回是哪条连接");
    if (!provenance.syncJobId) {
      throw validationError("provenance.syncJobId 缺失：INGESTED 实料必须可追回是哪次 sync（无 syncJobId ⇒ 拒绝登记为实料）");
    }
    if (!provenance.datasetKey) throw validationError("provenance.datasetKey 缺失：INGESTED 实料必须可追回是哪个数据集");
    if (!provenance.rowRef) throw validationError("provenance.rowRef 缺失：INGESTED 实料必须可追回是数据集内哪一行");
    const conn = await repos.connections.get(tenantId, provenance.connId);
    if (!conn) throw validationError(`provenance.connId '${provenance.connId}' 追不到连接记录`);
    if (conn.connectorTypeKey.startsWith("mock_")) {
      throw validationError(
        `连接 '${provenance.connId}' 的 connectorTypeKey 是 ${conn.connectorTypeKey}（mock_*）⇒ 拒绝登记为实料` +
          `（仓主定义：mock 适配器的行不落真实摄取面，防「记录真实、数据合成」形态）`,
      );
    }
    const job = await repos.syncJobs.get(tenantId, provenance.syncJobId);
    if (!job || job.connId !== provenance.connId) {
      throw validationError(
        `provenance.syncJobId '${provenance.syncJobId}' 追不到连接 '${provenance.connId}' 的真实 sync 记录 ⇒ 拒绝登记`,
      );
    }
  } else if (source === "WORK_ORDER_CLOSURE") {
    if (!provenance.rowRef) throw validationError("provenance.rowRef 缺失：工单结案回写必须点名结案记录（接原 PRD C3 留痕）");
  }

  const idKey = [
    subjectRef.typeKey, subjectRef.objectId, subjectRef.prop, asOf, String(value), unit, source,
    provenance.connId ?? "", provenance.syncJobId ?? "", provenance.datasetKey ?? "", provenance.rowRef ?? "",
  ].join("|");
  const outcome: RealizedOutcome = {
    id: `realized_${tenantId}_${Math.abs(hashString(idKey)).toString(36)}`,
    tenantId,
    subjectRef,
    asOf,
    value,
    unit,
    source,
    provenance,
  };
  await repos.realizedOutcomes.put(outcome);
  return outcome;
}

export interface RealizedPairingResult {
  /** 本次新配上的对数 */
  paired: number;
  /** 参与检查的未配对预测数（存在性读数 —— 为 0 与 paired:0 是两个不同命题） */
  examined: number;
}

/**
 * 实料 × 预测配对：未配对预测按 subjectRef+asOf 认领 RealizedOutcome 为 actual，
 * 落 CalibrationPairRecord（与 ts 配对引擎同表同 id 形）+ forecast.pairedAt（一个预测只配对一次）。
 * 同一 (subjectRef|asOf) 多条实料 ⇒ 取 importedAt 最新一条（后登记的实际值是更新的观测）。
 */
export async function pairRealizedWithForecasts(
  repos: Repos,
  tenantId: string,
  currentParamsVersion: number,
): Promise<RealizedPairingResult> {
  const unpaired = await repos.calibrationForecasts.list(tenantId, (f) => !f.pairedAt);
  if (unpaired.length === 0) return { paired: 0, examined: 0 };
  const outcomes = await repos.realizedOutcomes.list(tenantId, () => true);
  const byKey = new Map<string, RealizedOutcome>();
  for (const o of [...outcomes].sort((a, b) => (a.provenance.importedAt < b.provenance.importedAt ? -1 : 1))) {
    byKey.set(`${o.subjectRef.typeKey}|${o.subjectRef.objectId}|${o.subjectRef.prop}|${o.asOf}`, o);
  }
  const pairedAt = new Date().toISOString();
  let paired = 0;
  for (const f of [...unpaired].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const ref = forecastSubjectRef(f);
    const o = byKey.get(`${ref.typeKey}|${ref.objectId}|${ref.prop}|${f.windowTo}`);
    if (!o) continue;
    const actual = o.value;
    const error = round(f.predicted - actual, 6);
    const ape = round(Math.abs(error) / Math.max(actual, EPS), 6);
    const pair: CalibrationPairRecord = {
      id: `calpair_${tenantId}_${f.solverKey}_${f.modelId}_${f.baseId ?? "all"}_${f.windowTo}`.replace(/[^\w-]/g, "_"),
      tenantId,
      solverKey: f.solverKey,
      entityRef: f.baseId ? `Model:${f.modelId}@Base:${f.baseId}` : `Model:${f.modelId}`,
      modelId: f.modelId,
      ...(f.baseId ? { baseId: f.baseId } : {}),
      windowFrom: f.windowFrom,
      windowTo: f.windowTo,
      predicted: f.predicted,
      predictedP90: f.predictedP90,
      actual,
      error,
      ape,
      paramsVersion: f.paramsVersion,
      staleParams: f.paramsVersion !== currentParamsVersion,
      sliceKey: sliceKeyOf(f.solverKey, f.baseId, f.modelId),
      weekOfWindow: f.weekOfWindow,
      pairedAt,
    };
    await repos.calibrationPairs.put(pair);
    f.pairedAt = pairedAt;
    await repos.calibrationForecasts.put(f);
    paired++;
  }
  return { paired, examined: unpaired.length };
}
