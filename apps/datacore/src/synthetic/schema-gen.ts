import { hashString } from "../prng.js";

/**
 * g8 故事驱动全栈倒推 · P1（G-6 残留收口）：统一的 schema 驱动确定性数据生成器。
 *
 * 收编原 databuilder 私有 genCsv/genCell —— 消灭"两个数据生成器并存"（G-6）：
 * rawin 不再用 databuilder 自带生成器，统一调本模块（合成模块）的 schema 驱动生成。
 * 无行业模板时按字段 dataType 现造（schema 驱动）；确定性源 = FNV-1a hashString(prng.ts)，
 * 与原 genCell 同一哈希（同 seed/dataset/field/行号 → 字节级一致，R6）。
 */

export interface SchemaField {
  name: string;
  dataType: string; // string | number | boolean | date | enum | ref
  /** FK 一致生成（g8-P3 / A2）：主键列（其值入父表 PK 池）。 */
  isPrimaryKey?: boolean;
  /** FK 一致生成：本 ref 列指向的父数据集 key —— 取值必为父表实际生成的 PK（非凭空 mod）。 */
  refToDataset?: string;
}

export interface DatasetSpec {
  datasetKey: string;
  fields: SchemaField[];
  rowCount: number;
}

/** 单元格确定性生成（schema 驱动，无模板；与原 databuilder genCell 字节级一致）。 */
export function generateCell(dataset: string, field: string, dataType: string, i: number, seed: number): string {
  const h = hashString(`${dataset}|${field}|${i}|${seed}`);
  switch (dataType) {
    case "number":
      return String(h % 1000);
    case "boolean":
      return h % 2 === 0 ? "true" : "false";
    case "date": {
      const d = new Date(Date.UTC(2026, 0, 1) + (h % 180) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    case "ref":
      return `${field}-${h % 6}`;
    default:
      return `${field}-${i}`;
  }
}

/** 按字段 schema 生成确定性 CSV（rawin 灌注用；同 (datasetKey, fields, rowCount, seed) 字节级一致）。 */
export function generateFromSchema(datasetKey: string, fields: SchemaField[], rowCount: number, seed: number): string {
  const header = fields.map((f) => f.name).join(",");
  const lines = [header];
  for (let i = 0; i < rowCount; i++) {
    lines.push(fields.map((f) => generateCell(datasetKey, f.name, f.dataType, i, seed)).join(","));
  }
  return lines.join("\n");
}

/** 依赖序（父表先于引用它的子表）；环/缺父表则降级保持原顺序，不阻塞。 */
function topoOrder(specs: DatasetSpec[]): DatasetSpec[] {
  const byKey = new Map(specs.map((s) => [s.datasetKey, s]));
  const visited = new Set<string>();
  const out: DatasetSpec[] = [];
  const visit = (s: DatasetSpec, stack: Set<string>) => {
    if (visited.has(s.datasetKey) || stack.has(s.datasetKey)) return; // 环：跳过回边
    stack.add(s.datasetKey);
    for (const f of s.fields) {
      if (f.refToDataset && byKey.has(f.refToDataset) && f.refToDataset !== s.datasetKey) visit(byKey.get(f.refToDataset)!, stack);
    }
    stack.delete(s.datasetKey);
    visited.add(s.datasetKey);
    out.push(s);
  };
  for (const s of specs) visit(s, new Set());
  return out;
}

/**
 * FK 一致的多表确定性生成（A2 / G-6 收口）：按依赖序生成父表→收集真实 PK 池→子表 ref 列
 * 从父表 PK 池确定性取值（h % poolLen），保证"每个 ref 值都指向父表实际存在的 PK"。
 * 同 (specs, seed) 字节级一致（R6）；无 ref 的单表退化为 generateFromSchema 同输出（向后兼容）。
 */
export function generateRelatedDatasets(specs: DatasetSpec[], seed: number): Record<string, string> {
  const pkPool: Record<string, string[]> = {};
  const out: Record<string, string> = {};
  for (const spec of topoOrder(specs)) {
    const pkIdx = spec.fields.findIndex((f) => f.isPrimaryKey);
    const lines = [spec.fields.map((f) => f.name).join(",")];
    const myPks: string[] = [];
    for (let i = 0; i < spec.rowCount; i++) {
      const cells = spec.fields.map((f) => {
        const parentPool = f.refToDataset ? pkPool[f.refToDataset] : undefined;
        if (parentPool && parentPool.length > 0) {
          const h = hashString(`${spec.datasetKey}|${f.name}|${i}|${seed}`);
          return parentPool[h % parentPool.length]!; // FK → 父表实际 PK
        }
        return generateCell(spec.datasetKey, f.name, f.dataType, i, seed);
      });
      lines.push(cells.join(","));
      if (pkIdx >= 0) myPks.push(cells[pkIdx]!);
    }
    pkPool[spec.datasetKey] = myPks;
    out[spec.datasetKey] = lines.join("\n");
  }
  return out;
}
