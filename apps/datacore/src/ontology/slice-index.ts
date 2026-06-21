// A3.4 切片索引 + 复用查找：派生投影（R13，非新真值源）——从已发布 SliceSpec 沿 link 图解析出
// 每切片覆盖的类型集，按 rootType 索引。规划器先 lookupReusable（命中既有切片即复用，免重复造切片），
// 未命中才新规划。确定性（同切片集同图同结果，R6）；索引随 ontology.published/slice.planned 重建。
import type { SliceIndexEntry } from "@platform/contracts";

export interface IndexSliceSpec {
  sliceKey: string;
  root: string;
  /** 每条 path = 一串 {linkKey, direction}（与 SliceSpecRecord.spec.paths 同形）。 */
  paths: { linkKey: string; direction: "out" | "in" }[][];
}
export interface IndexLink { linkKey: string; fromTypeKey: string; toTypeKey: string }

/** 经 linkKey + direction 从 type X 走一步到的类型（无则 undefined）。 */
function step(linksByKey: Map<string, IndexLink>, from: string, linkKey: string, direction: "out" | "in"): string | undefined {
  const l = linksByKey.get(linkKey);
  if (!l) return undefined;
  if (direction === "out") return l.fromTypeKey === from ? l.toTypeKey : undefined;
  return l.toTypeKey === from ? l.fromTypeKey : undefined;
}

/** 解析一条切片从 root 沿全部 paths 可达的类型集（含 root）。断链的 path 在断点止步。 */
export function resolveSpannedTypes(spec: IndexSliceSpec, links: IndexLink[]): string[] {
  const byKey = new Map(links.map((l) => [l.linkKey, l]));
  const spanned = new Set<string>([spec.root]);
  for (const path of spec.paths) {
    let cur: string | undefined = spec.root;
    for (const hop of path) {
      cur = step(byKey, cur!, hop.linkKey, hop.direction);
      if (!cur) break; // 断链止步
      spanned.add(cur);
    }
  }
  return [...spanned].sort();
}

/** 建索引：每切片一条 {sliceKey, rootType, spannedTypes}。确定性（按 sliceKey 排序）。 */
export function buildSliceIndex(specs: IndexSliceSpec[], links: IndexLink[]): SliceIndexEntry[] {
  return specs
    .map((s) => ({ sliceKey: s.sliceKey, rootType: s.root, spannedTypes: resolveSpannedTypes(s, links) }))
    .sort((a, b) => a.sliceKey.localeCompare(b.sliceKey));
}

/**
 * 复用查找：找 rootType 匹配且 spannedTypes ⊇ targets 的既有切片。
 * tie-break（R6）：覆盖类型最少者（最贴合）优先 → sliceKey 字典序。命中返回该 entry，否则 null。
 */
export function lookupReusable(index: SliceIndexEntry[], rootType: string, targets: string[]): SliceIndexEntry | null {
  const need = new Set(targets);
  const candidates = index
    .filter((e) => e.rootType === rootType && [...need].every((t) => e.spannedTypes.includes(t)))
    .sort((a, b) => a.spannedTypes.length - b.spannedTypes.length || a.sliceKey.localeCompare(b.sliceKey));
  return candidates[0] ?? null;
}
