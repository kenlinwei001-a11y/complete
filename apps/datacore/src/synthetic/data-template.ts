import type { ObjectTypeDef } from "../domain.js";
import { generateRelatedDatasets, type DatasetSpec, type SchemaField } from "./schema-gen.js";

/**
 * 在线数据模版（A2 / G-6 收口）：从本租户已发布本体对象类型派生"该上传哪些列"的 CSV 模版。
 * 列 = 非派生属性（派生列由系统算出、用户不必填）；ref 列标注其指向的父类型。
 * 带样例时多表 FK 一致生成（ref 值必指向父表实际 PK），让模版"可直接试灌"而非凭空假值。
 */

export interface DataTemplate {
  typeKey: string;
  displayName: string;
  columns: string[];
  primaryKey: string | null;
  refColumns: { column: string; refToType: string }[];
  /** CSV：仅表头（无样例）或表头 + N 行 FK 一致样例。 */
  csv: string;
}

/** 对象类型 → 可上传列（排除派生属性）。 */
function uploadableFields(type: ObjectTypeDef): SchemaField[] {
  const derived = new Set(type.derivedProperties.map((d) => d.propKey));
  return type.properties
    .filter((p) => !derived.has(p.propKey))
    .map((p) => ({
      name: p.propKey,
      dataType: p.dataType,
      isPrimaryKey: p.isPrimaryKey,
      ...(p.dataType === "ref" && p.refToTypeKey ? { refToDataset: p.refToTypeKey } : {}),
    }));
}

function headerCsv(fields: SchemaField[]): string {
  return fields.map((f) => f.name).join(",");
}

/**
 * 为一组对象类型构建数据模版。withSamples>0 时跨类型 FK 一致生成样例行（ref 指向父表实际 PK），
 * 否则只给表头。确定性（R6）：同 (types, withSamples, seed) 字节级一致。
 */
export function buildDataTemplates(types: ObjectTypeDef[], opts: { withSamples?: number; seed?: number } = {}): DataTemplate[] {
  const active = types.filter((t) => t.status === "ACTIVE");
  const fieldsByType = new Map(active.map((t) => [t.key, uploadableFields(t)]));
  const samples = opts.withSamples && opts.withSamples > 0;
  let csvByType: Record<string, string> = {};
  if (samples) {
    const specs: DatasetSpec[] = active.map((t) => ({ datasetKey: t.key, fields: fieldsByType.get(t.key)!, rowCount: opts.withSamples! }));
    csvByType = generateRelatedDatasets(specs, opts.seed ?? 42);
  }
  return active.map((t) => {
    const fields = fieldsByType.get(t.key)!;
    const pk = fields.find((f) => f.isPrimaryKey);
    return {
      typeKey: t.key,
      displayName: t.displayName,
      columns: fields.map((f) => f.name),
      primaryKey: pk?.name ?? null,
      refColumns: fields.filter((f) => f.refToDataset).map((f) => ({ column: f.name, refToType: f.refToDataset! })),
      csv: samples ? csvByType[t.key]! : headerCsv(fields),
    };
  });
}

/** 单类型模版（直接下载用）。未找到 → undefined。 */
export function buildDataTemplate(types: ObjectTypeDef[], typeKey: string, opts: { withSamples?: number; seed?: number } = {}): DataTemplate | undefined {
  // 仍传入全集以保证 FK 样例能引到父表 PK；再挑出目标类型。
  return buildDataTemplates(types, opts).find((t) => t.typeKey === typeKey);
}
