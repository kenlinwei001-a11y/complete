// WO-DB-DERIVE-DECISION-FIELDS (G4) — apps/datacore/src/decision/derive-fields.ts
//
// **导入记录字段 → 决策字段 派生引擎**（纯核·确定性 R6·零业务常数 R14·真值溯源 R13）。
//
// 第一性（REVIEW-field-schema-user-vs-platform.md §4 · KILL-MOCK-RED）：
//   导入的记录型数据（factory/production_line/equipment…）落库后**没有**求解器读的决策字段（Base.util /
//   Base.oeeIndex …）——它们**必须从真导入值聚合算出**，绝不 hash(名)/写死系数/兜底冒充。本引擎按**可配置
//   mapping**（DecisionFieldMapping·导入方以数据提供）把真源记录聚合成决策字段。电池只是一份 mapping 实例，
//   引擎代码不内联任何电池/行业常数（R14 generality-mandatory）。
//
// 不变量（逐条守）：
//   R6  · 无 Date.now / Math.random / hash 造值；同 (mapping, 源快照) → 字节级同结果（rules 按给定序·目标按 id
//         排序·sourceObjectIds 排序 → 稳定）。
//   R13 · 每个派生值挂 sourceObjectIds（贡献它的真源对象）→ 逐值可回溯真记录。
//   R14 · 口径全来自 mapping 数据（op/field/groupByField/scale…）·引擎零行业常数。
//   R2  · 引擎只吃调用方按 tenantId 隔离取来的对象（不自查库·租户隔离由调用方闭合）。

import type {
  DecisionFieldMapping,
  DecisionFieldRule,
  DerivedDataMode,
  DerivedFieldResult,
} from "@platform/contracts";
import { round } from "../prng.js";

/** 引擎输入对象（调用方从 repos.objects.listByType 投影·real=是否真导入 provenance）。 */
export interface DeriveSourceObject {
  id: string;
  props: Record<string, unknown>;
  /** 真导入 provenance（origin=MATERIALIZED 且源连接 real-sourced）→ 决定该源贡献能否上 LIVE 决策。 */
  real: boolean;
}

/** typeKey → 该类型对象列表（调用方按租户取好·引擎不查库·R2）。 */
export type ObjectsByType = ReadonlyMap<string, readonly DeriveSourceObject[]>;

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // 记录型导入常把数值存成字符串（CSV）→ 宽松解析真值（非造值·仍是真源字段）。
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** 聚合一组源记录得决策值（纯函数·无副作用）。返回 null = 无有效真数值贡献（诚实空态·不造）。 */
function aggregate(
  rule: DecisionFieldRule,
  group: readonly DeriveSourceObject[],
): { value: number | null; contributors: DeriveSourceObject[] } {
  const contributors: DeriveSourceObject[] = [];
  if (rule.op === "count") {
    for (const o of group) contributors.push(o);
    return { value: contributors.length, contributors };
  }
  const vals: number[] = [];
  const denoms: number[] = [];
  const weights: number[] = [];
  for (const o of group) {
    const v = numOrNull(o.props[rule.source.field]);
    if (v === null) continue;
    if (rule.op === "ratio") {
      const d = rule.source.denomField ? numOrNull(o.props[rule.source.denomField]) : null;
      if (d === null) continue; // 分母缺 → 该记录不贡献（诚实·不假设）
      vals.push(v);
      denoms.push(d);
    } else if (rule.op === "weighted_avg") {
      const w = rule.source.weightField ? numOrNull(o.props[rule.source.weightField]) : null;
      if (w === null) continue;
      vals.push(v);
      weights.push(w);
    } else {
      vals.push(v);
    }
    contributors.push(o);
  }
  if (vals.length === 0) return { value: null, contributors: [] };
  let raw: number;
  switch (rule.op) {
    case "avg":
      raw = vals.reduce((a, b) => a + b, 0) / vals.length;
      break;
    case "sum":
      raw = vals.reduce((a, b) => a + b, 0);
      break;
    case "min":
      raw = Math.min(...vals);
      break;
    case "max":
      raw = Math.max(...vals);
      break;
    case "ratio": {
      const denom = denoms.reduce((a, b) => a + b, 0);
      if (denom === 0) return { value: null, contributors: [] }; // 除零 → 诚实空（不造 Infinity/兜底）
      raw = vals.reduce((a, b) => a + b, 0) / denom;
      break;
    }
    case "weighted_avg": {
      const wsum = weights.reduce((a, b) => a + b, 0);
      if (wsum === 0) return { value: null, contributors: [] };
      let acc = 0;
      for (let i = 0; i < vals.length; i++) acc += vals[i]! * weights[i]!;
      raw = acc / wsum;
      break;
    }
    default:
      return { value: null, contributors: [] };
  }
  if (typeof rule.scale === "number") raw *= rule.scale;
  if (typeof rule.clampMin === "number") raw = Math.max(rule.clampMin, raw);
  if (typeof rule.clampMax === "number") raw = Math.min(rule.clampMax, raw);
  return { value: round(raw, rule.precision ?? 6), contributors };
}

/** 诚实位：贡献源全真=LIVE·部分真=PARTIAL·全合成=SYNTHETIC·无贡献=EMPTY。 */
function dataModeOf(value: number | null, contributors: readonly DeriveSourceObject[]): DerivedDataMode {
  if (value === null || contributors.length === 0) return "EMPTY";
  const realN = contributors.filter((o) => o.real).length;
  if (realN === contributors.length) return "LIVE";
  if (realN === 0) return "SYNTHETIC";
  return "PARTIAL";
}

/**
 * 派生引擎主入口（纯·确定性）：按 mapping 逐规则，把源类型记录聚合成目标对象的决策字段。
 * 目标按 id 升序、源按分组键归组、sourceObjectIds 排序 → 字节级稳定（R6）。
 * 每目标对象出一条结果（含无源贡献的 EMPTY·诚实暴露空态·不静默略过）。
 */
export function deriveDecisionFields(
  mapping: DecisionFieldMapping,
  objectsByType: ObjectsByType,
): DerivedFieldResult[] {
  const out: DerivedFieldResult[] = [];
  for (const rule of mapping.rules) {
    const targets = [...(objectsByType.get(rule.target.objectType) ?? [])].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    const sources = objectsByType.get(rule.source.objectType) ?? [];
    const byKey = new Map<string, DeriveSourceObject[]>();
    for (const s of sources) {
      const k = String(s.props[rule.source.groupByField] ?? "");
      if (k === "") continue; // 无分组键 → 不归任何目标（诚实·不瞎挂）
      let arr = byKey.get(k);
      if (!arr) byKey.set(k, (arr = []));
      arr.push(s);
    }
    for (const t of targets) {
      const key = String(t.props[rule.targetKeyField] ?? "");
      const group = key === "" ? [] : byKey.get(key) ?? [];
      const { value, contributors } = aggregate(rule, group);
      out.push({
        targetType: rule.target.objectType,
        targetId: t.id,
        targetKey: key,
        field: rule.target.field,
        op: rule.op,
        sourceType: rule.source.objectType,
        sourceField: rule.source.field,
        value,
        contributingCount: contributors.length,
        sourceObjectIds: contributors.map((o) => o.id).sort(),
        dataMode: dataModeOf(value, contributors),
      });
    }
  }
  return out;
}

/** 整体诚实位（取最弱·全 LIVE 才 LIVE·无任何非空结果 → EMPTY）。 */
export function weakestDataMode(results: readonly DerivedFieldResult[]): DerivedDataMode {
  const nonEmpty = results.filter((r) => r.value !== null);
  if (nonEmpty.length === 0) return "EMPTY";
  if (nonEmpty.some((r) => r.dataMode === "SYNTHETIC")) return "SYNTHETIC";
  if (nonEmpty.some((r) => r.dataMode === "PARTIAL")) return "PARTIAL";
  return "LIVE";
}

/**
 * KILL-MOCK 测谎（`derive-fields:check` 的牙齿·门自证）：
 * 独立**重算**每条结果的真值并与其 value 逐值比对——任何 value ≠ 从真源重算（如被 hash/写死/兜底伪造）
 * → 违例。同时逮"有值却无 sourceObjectIds"（R13 死角·无溯源数字=造值嫌疑）。返回违例串数组（空=干净）。
 * gate 与单测注入伪造值即 green→red。
 */
export function validateDerivedFields(
  mapping: DecisionFieldMapping,
  objectsByType: ObjectsByType,
  results: readonly DerivedFieldResult[],
): string[] {
  const violations: string[] = [];
  const truth = deriveDecisionFields(mapping, objectsByType);
  const truthByKey = new Map<string, DerivedFieldResult>();
  for (const r of truth) truthByKey.set(`${r.targetType}.${r.field}#${r.targetId}`, r);
  for (const r of results) {
    const k = `${r.targetType}.${r.field}#${r.targetId}`;
    const t = truthByKey.get(k);
    if (!t) {
      violations.push(`结果 ${k} 无对应真源重算项（幽灵派生·目标/字段不在 mapping 真算集）`);
      continue;
    }
    if (r.value !== null && r.sourceObjectIds.length === 0 && r.op !== "count") {
      violations.push(`${k} 有派生值 ${r.value} 却无 sourceObjectIds（R13 死角·无溯源数字=伪造嫌疑）`);
    }
    // 逐值比对真源重算：被 hash/写死/兜底改过的值必与真重算不符 → 逮住。
    if (r.value === null || t.value === null) {
      if (r.value !== t.value) violations.push(`${k} value=${r.value} 与真源重算 ${t.value} 不符（空态被伪造/漏算）`);
    } else if (round(r.value, 6) !== round(t.value, 6)) {
      violations.push(`${k} value=${r.value} ≠ 真源重算 ${t.value}（决策值被伪造/hash/兜底冒充·KILL-MOCK-RED）`);
    }
  }
  return violations;
}
