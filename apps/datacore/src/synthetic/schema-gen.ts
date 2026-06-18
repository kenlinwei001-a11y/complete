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
