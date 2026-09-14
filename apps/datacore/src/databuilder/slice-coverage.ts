import type { ObjectTypeDef, LinkTypeDef, SliceSpecRecord } from "../domain.js";
import type { DataCategory } from "@platform/contracts";

/**
 * 本体切片字段覆盖检查（用户铁律："所有的字段实体都需要被至少一个本体切片覆盖"）。
 * 沿每条切片路径用链路定义解析每一跳到达的类型,把该跳 project 的字段归属到该类型;root 类型的字段
 * 视为整体覆盖（查询恒返回 root 自身全字段）。报告每个类型未被任何切片投影的非派生字段（"孤儿字段"）。
 * 确定性纯函数（R6）：同 (types, links, slices) 同结果。
 */

type SliceLite = { sliceKey: string; spec: SliceSpecRecord["spec"] };

export interface TypeFieldCoverage {
  typeKey: string;
  displayName: string;
  totalFields: number;
  coveredFields: number;
  uncovered: string[];
}
export interface FieldCoverageReport {
  byType: TypeFieldCoverage[];
  totalFields: number;
  coveredFields: number;
  fullyCovered: boolean;
}

/** 非派生属性（= 可上传/可建模的真实数据字段，与 data-template 的 uploadableFields 一致）。 */
function dataFields(t: ObjectTypeDef): string[] {
  const derived = new Set(t.derivedProperties.map((d) => d.propKey));
  return t.properties.filter((p) => !derived.has(p.propKey)).map((p) => p.propKey);
}

export function computeFieldCoverage(types: ObjectTypeDef[], links: Pick<LinkTypeDef, "key" | "fromTypeKey" | "toTypeKey">[], slices: SliceLite[]): FieldCoverageReport {
  const active = types.filter((t) => t.status === "ACTIVE");
  const linkByKey = new Map(links.map((l) => [l.key, l]));
  const covered = new Map<string, Set<string>>(); // typeKey → 已覆盖字段名集合
  const mark = (typeKey: string, fields: string[]) => {
    const set = covered.get(typeKey) ?? new Set<string>();
    for (const f of fields) set.add(f);
    covered.set(typeKey, set);
  };

  for (const slice of slices) {
    const rootType = slice.spec.root.typeKey;
    // root 自身全字段恒覆盖（root 对象总是整体返回）。
    const rootDef = active.find((t) => t.key === rootType);
    if (rootDef) mark(rootType, dataFields(rootDef));
    for (const path of slice.spec.paths) {
      let cur = rootType;
      for (const hop of path as { linkKey: string; direction: "out" | "in"; project?: string[] }[]) {
        const link = linkByKey.get(hop.linkKey);
        if (!link) break; // 链路未知 → 该路径止
        const next = hop.direction === "out" ? link.toTypeKey : link.fromTypeKey;
        if (hop.project && hop.project.length > 0) mark(next, hop.project);
        cur = next;
      }
      void cur;
    }
  }

  const byType: TypeFieldCoverage[] = active
    .map((t) => {
      const fields = dataFields(t);
      const cov = covered.get(t.key) ?? new Set<string>();
      const uncovered = fields.filter((f) => !cov.has(f)).sort();
      return { typeKey: t.key, displayName: t.displayName, totalFields: fields.length, coveredFields: fields.length - uncovered.length, uncovered };
    })
    .sort((a, b) => a.typeKey.localeCompare(b.typeKey));
  const totalFields = byType.reduce((s, t) => s + t.totalFields, 0);
  const coveredFields = byType.reduce((s, t) => s + t.coveredFields, 0);
  return { byType, totalFields, coveredFields, fullyCovered: coveredFields === totalFields };
}

export interface CategoryCoverageReport {
  categorizedTypes: string[];
  uncategorizedTypes: string[]; // 出厂类型未归入任何分类（"合并到分类"不完整）
  duplicateTypes: string[]; // 归入多个分类（应唯一）
  complete: boolean;
}

/** 校验"目前的数据"是否全部合并到分类：每个 ACTIVE 类型恰好归入一个分类。 */
export function computeCategoryCoverage(types: ObjectTypeDef[], categories: DataCategory[]): CategoryCoverageReport {
  const active = types.filter((t) => t.status === "ACTIVE").map((t) => t.key);
  const counts = new Map<string, number>();
  for (const c of categories) for (const tk of c.typeKeys) counts.set(tk, (counts.get(tk) ?? 0) + 1);
  const categorizedTypes = active.filter((tk) => (counts.get(tk) ?? 0) >= 1).sort();
  const uncategorizedTypes = active.filter((tk) => !counts.get(tk)).sort();
  const duplicateTypes = active.filter((tk) => (counts.get(tk) ?? 0) > 1).sort();
  return { categorizedTypes, uncategorizedTypes, duplicateTypes, complete: uncategorizedTypes.length === 0 && duplicateTypes.length === 0 };
}
