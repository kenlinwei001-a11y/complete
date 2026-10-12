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

// ---------------------------------------------------------------------------
// E6 · 切片按近似问句复用（description + indexEntities 检索命中既有切片，不重规划）
// ---------------------------------------------------------------------------

/**
 * 切片描述项（**派生投影，非新真值源 R13**，与 SliceIndexEntry 并行，不改契约）：
 *  - description：建该切片的故事/问句原文（自然语言），供近似问句检索；
 *  - indexEntities：该切片覆盖的实体/类型关键词（用于词重叠打分）。
 * 由调用方（slice 规划/建域）在已有 SliceIndexEntry 之上附带提供（service 装配，确定性）。
 */
export interface SliceDescriptor {
  sliceKey: string;
  rootType: string;
  description: string;
  indexEntities: string[];
}

/** 确定性分词归一（R6，无网络/LLM）：小写 + 按非字母数字/CJK 边界切 + 去停用短词。中文按字切并保留 2 字窗。 */
export function tokenizeQuestion(q: string): string[] {
  const lc = q.toLowerCase();
  // 拉丁词
  const latin = lc.match(/[a-z0-9]{2,}/g) ?? [];
  // CJK：单字 + 相邻二字 bigram（提升"瓶颈/降级/订单"等词命中率，确定性）
  const cjk = lc.match(/[一-鿿]/g) ?? [];
  const bigrams: string[] = [];
  for (let i = 0; i + 1 < cjk.length; i++) bigrams.push(cjk[i]! + cjk[i + 1]!);
  return [...new Set([...latin, ...cjk, ...bigrams])].sort();
}

/** Jaccard 相似度（确定性 R6）：|A∩B| / |A∪B|。空集→0。 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * E6 近似问句复用查找：在 rootType 匹配的切片里，用问句 token 与切片 description/indexEntities 的
 * 词重叠（Jaccard）打分，命中 ≥ threshold 的最高分切片即复用（不重新规划切片）。
 * 确定性（R6）：同问句同切片集同结果；tie-break 取分高→indexEntities 少（最贴合）→sliceKey 字典序。
 * 无命中（或全低于阈值）→ null（让规划器走正常 planSlice，不硬凑）。
 */
export function lookupReusableByQuestion(
  descriptors: SliceDescriptor[],
  rootType: string,
  question: string,
  threshold = 0.2,
): { sliceKey: string; score: number } | null {
  const qTokens = new Set(tokenizeQuestion(question));
  if (qTokens.size === 0) return null;
  const scored = descriptors
    .filter((d) => d.rootType === rootType)
    .map((d) => {
      const dTokens = new Set([...tokenizeQuestion(d.description), ...d.indexEntities.map((e) => e.toLowerCase())]);
      return { sliceKey: d.sliceKey, score: jaccard(qTokens, dTokens), span: d.indexEntities.length };
    })
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score || a.span - b.span || a.sliceKey.localeCompare(b.sliceKey));
  const best = scored[0];
  return best ? { sliceKey: best.sliceKey, score: best.score } : null;
}
