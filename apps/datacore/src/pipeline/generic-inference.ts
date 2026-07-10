import type {
  GenericInferenceChange,
  GenericInferenceInput,
  GenericInferenceOutput,
  InferenceChangedProp,
  InferenceAggregateSummary,
} from "@platform/contracts";
import type { ObjectInstance, PropertyDef, DerivedPropertyDef } from "../domain.js";
import { evalArithmetic, parseAggregate } from "../ontology.js";
import { round } from "../prng.js";

/**
 * OntoFlow（PRD v2 · P4 · §8.2）通用 what-if 推演 —— 纯确定性函数。
 *
 * 「立即可用」边界：对某对象属性施加 Δ（或直接 setValue），沿
 *   1) 该对象自身派生（本对象算术派生，via=derived:<key>）
 *   2) 聚合边（其它类型对本类型的聚合派生 FN(SourceType.p BY byField)，via=link:<key>）
 *   3) 聚合目标对象的算术派生（再一跳，via=derived:<key>）
 * 重算受影响属性，输出 before/after 对比。仅作用于 ONTOLOGY 存储模式的类型。
 *
 * 复用既有本体派生引擎：`evalArithmetic`（算术派生）+ `parseAggregate` +
 * 与 OntologyService.applyAggregate 同语义的聚合折叠。确定性：仅函数于入参，
 * 不读时钟/随机；同输入两次调用字节级一致。
 *
 * 边界说明（文档）：本函数只做单因子、有界传播（direct → 自身派生 → 一跳聚合 → 目标自身派生）。
 * 复杂时序/容量/多轮不动点推演仍需领域求解器（solvers/*，可插拔），本期不自动获得。
 * WO-MERGE-01：输入/输出契约提为共享 contracts/pipeline.ts（前端「推演」入口 typed 消费，单一真相）。
 */

// ---- 推演上下文（datacore 侧组装）------------------------------------------

export interface InferenceTypeDef {
  key: string;
  storageMode?: "STATIC" | "ONTOLOGY";
  properties: PropertyDef[];
  derivedProperties: DerivedPropertyDef[];
}

export interface InferenceContext {
  types: InferenceTypeDef[];
  links: { key: string; fromTypeKey: string; toTypeKey: string }[];
  objectsByType: Record<string, ObjectInstance[]>;
}

const NOTE =
  "通用 what-if（立即可用）：单因子沿派生/聚合边有界传播；复杂时序/容量推演需领域求解器。";

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
const pkOf = (t: InferenceTypeDef): string => t.properties.find((p) => p.isPrimaryKey)?.propKey ?? "id";
const changedVal = (before: unknown, after: unknown): boolean => !Object.is(before, after);

/** 与 OntologyService.applyAggregate 同语义（byField 指向 target 主键值）。 */
function applyAggregate(
  agg: { fn: string; sourceProp: string; byField: string },
  target: ObjectInstance,
  targetPk: string,
  sources: ObjectInstance[],
): number {
  const key = target.props[targetPk];
  const values: number[] = [];
  let count = 0;
  for (const src of sources) {
    const by = src.props[agg.byField];
    const matches = Array.isArray(by) ? by.includes(key) : by === key;
    if (!matches) continue;
    count++;
    const v = src.props[agg.sourceProp];
    if (typeof v === "number") values.push(v);
  }
  switch (agg.fn) {
    case "COUNT":
      return count;
    case "SUM":
      return values.reduce((a, b) => a + b, 0);
    case "MIN":
      return values.length ? Math.min(...values) : 0;
    case "MAX":
      return values.length ? Math.max(...values) : 0;
    case "AVG":
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    default:
      return 0;
  }
}

function findLinkKey(
  links: { key: string; fromTypeKey: string; toTypeKey: string }[],
  sourceType: string,
  targetType: string,
): string | undefined {
  const l = links.find(
    (x) =>
      (x.fromTypeKey === sourceType && x.toTypeKey === targetType) ||
      (x.fromTypeKey === targetType && x.toTypeKey === sourceType),
  );
  return l?.key;
}

/** 重算某对象上「本对象算术派生」（非聚合），返回是否有变化 + 记录。 */
function recomputeOwnDerived(obj: ObjectInstance, t: InferenceTypeDef, changed: InferenceChangedProp[]): boolean {
  let any = false;
  for (const d of t.derivedProperties) {
    if (parseAggregate(d.formula)) continue; // 聚合派生走聚合边传播
    const before = obj.props[d.propKey];
    let after: number;
    try {
      after = round(evalArithmetic(d.formula, obj.props), 6);
    } catch {
      continue; // 非算术表达式跳过
    }
    if (changedVal(before, after)) {
      obj.props[d.propKey] = after;
      changed.push({ objectId: obj.id, typeKey: t.key, prop: d.propKey, before, after, via: `derived:${d.propKey}` });
      any = true;
    }
  }
  return any;
}

function resolveTargets(objs: ObjectInstance[], change: GenericInferenceChange, pk: string): ObjectInstance[] {
  if (!change.objectId) return objs;
  const id = change.objectId;
  return objs.filter((o) => o.id === id || o.objectKey === id || String(o.props[pk]) === id);
}

/** 通用 what-if：施加变更 → 有界传播 → before/after 列表。 */
export function computeInference(cx: InferenceContext, input: GenericInferenceInput): GenericInferenceOutput {
  const typeByKey = new Map<string, InferenceTypeDef>();
  for (const t of cx.types) if ((t.storageMode ?? "ONTOLOGY") === "ONTOLOGY") typeByKey.set(t.key, t);

  // 工作副本（不改动仓储对象）
  const byType = new Map<string, ObjectInstance[]>();
  for (const [k, objs] of Object.entries(cx.objectsByType)) {
    byType.set(k, objs.map((o) => ({ ...o, props: { ...o.props } })));
  }

  const changed: InferenceChangedProp[] = [];
  const aggregates: InferenceAggregateSummary[] = [];
  const modifiedTypes = new Set<string>();

  // 1) 直接变更 + 自身派生
  for (const ch of input.changes) {
    const t = typeByKey.get(ch.typeKey);
    if (!t) continue; // 非 ONTOLOGY / 未知类型跳过
    const targets = resolveTargets(byType.get(ch.typeKey) ?? [], ch, pkOf(t));
    for (const obj of targets) {
      const before = obj.props[ch.prop];
      const after = ch.setValue !== undefined ? ch.setValue : round(num(before) + (ch.delta ?? 0), 6);
      if (changedVal(before, after)) {
        obj.props[ch.prop] = after;
        changed.push({ objectId: obj.id, typeKey: t.key, prop: ch.prop, before, after, via: "direct" });
        modifiedTypes.add(t.key);
      }
      recomputeOwnDerived(obj, t, changed);
    }
  }

  // 2) 聚合边传播（其它类型对被改类型的聚合派生）+ 3) 目标自身派生再一跳
  for (const t of typeByKey.values()) {
    const pk = pkOf(t);
    const targets = byType.get(t.key) ?? [];
    for (const d of t.derivedProperties) {
      const agg = parseAggregate(d.formula);
      if (!agg || !modifiedTypes.has(agg.sourceType)) continue;
      const sources = byType.get(agg.sourceType) ?? [];
      const linkKey = findLinkKey(cx.links, agg.sourceType, t.key) ?? agg.sourceType;
      aggregates.push({ typeKey: t.key, prop: d.propKey, fn: agg.fn, sourceType: agg.sourceType });
      for (const obj of targets) {
        const before = obj.props[d.propKey];
        const after = round(applyAggregate(agg, obj, pk, sources), 6);
        if (changedVal(before, after)) {
          obj.props[d.propKey] = after;
          changed.push({ objectId: obj.id, typeKey: t.key, prop: d.propKey, before, after, via: `link:${linkKey}` });
          recomputeOwnDerived(obj, t, changed); // 目标自身算术派生再一跳
        }
      }
    }
  }

  return {
    deterministic: true,
    changed,
    ...(aggregates.length ? { aggregates } : {}),
    note: NOTE,
  };
}
