// A3.3 多跳切片规划器：在 OntologyLink 图上做**确定性**路径搜索 → 自动产 SlicePlan（root→hops）。
// 纯函数（输入 types+links+req，无 IO/无 LLM/无随机）。确定性靠固定 tie-break，同图同目标字节一致（R6）。
import type { SlicePlan, SlicePlanHop, PlanSliceRequest, PlanSliceResponse } from "@platform/contracts";

export interface PlannerType { key: string; domain?: string }
export interface PlannerLink { linkKey: string; fromTypeKey: string; toTypeKey: string }

interface Edge { linkKey: string; from: string; to: string; direction: "out" | "in"; sameDomain: boolean }

/** 建无向可达图（每条 link 产正向 out 边 + 反向 in 边）；sameDomain 用于 tie-break（域内优先）。 */
function buildAdjacency(types: PlannerType[], links: PlannerLink[]): Map<string, Edge[]> {
  const domainOf = new Map(types.map((t) => [t.key, t.domain ?? ""]));
  const adj = new Map<string, Edge[]>();
  const push = (from: string, e: Edge) => { if (!adj.has(from)) adj.set(from, []); adj.get(from)!.push(e); };
  for (const l of links) {
    const same = (domainOf.get(l.fromTypeKey) ?? "") !== "" && domainOf.get(l.fromTypeKey) === domainOf.get(l.toTypeKey);
    push(l.fromTypeKey, { linkKey: l.linkKey, from: l.fromTypeKey, to: l.toTypeKey, direction: "out", sameDomain: same });
    push(l.toTypeKey, { linkKey: l.linkKey, from: l.toTypeKey, to: l.fromTypeKey, direction: "in", sameDomain: same });
  }
  // 确定性邻边序（tie-break，R6）：域内边优先 → 目标类型 key 字典序 → linkKey 字典序 → out 先于 in。
  for (const es of adj.values()) {
    es.sort((a, b) =>
      Number(b.sameDomain) - Number(a.sameDomain) ||
      a.to.localeCompare(b.to) ||
      a.linkKey.localeCompare(b.linkKey) ||
      a.direction.localeCompare(b.direction),
    );
  }
  return adj;
}

/** 确定性 BFS 最短路：邻边按上面的序展开，target 首次出队即重建路径（固定 tie-break → 唯一路径）。 */
function shortestPath(adj: Map<string, Edge[]>, root: string, target: string, maxHops: number): SlicePlanHop[] | null {
  if (root === target) return [];
  const prev = new Map<string, { edge: Edge; from: string }>();
  const depth = new Map<string, number>([[root, 0]]);
  const queue: string[] = [root];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = depth.get(cur)!;
    if (d >= maxHops) continue;
    for (const e of adj.get(cur) ?? []) {
      if (depth.has(e.to)) continue; // 已访问（BFS 首达即最短）
      depth.set(e.to, d + 1);
      prev.set(e.to, { edge: e, from: cur });
      if (e.to === target) {
        const hops: SlicePlanHop[] = [];
        let node = target;
        while (node !== root) {
          const p = prev.get(node)!;
          hops.unshift({ linkKey: p.edge.linkKey, direction: p.edge.direction, toType: p.edge.to });
          node = p.from;
        }
        return hops;
      }
      queue.push(e.to);
    }
  }
  return null;
}

const hopEvidence = (root: string, hops: SlicePlanHop[]): string =>
  [root, ...hops.map((h) => `-[${h.linkKey}:${h.direction}]-> ${h.toType}`)].join(" ");

/**
 * 规划：对每个 target 求 root→target 最短路。全部可达 → SlicePlan；任一不可达 → NO_PATH（列 unreachable）。
 * sliceKey 由 root+targets 确定性派生（同请求同 key，利于 A3.4 索引复用）。
 */
export function planSlice(types: PlannerType[], links: PlannerLink[], req: PlanSliceRequest): PlanSliceResponse {
  const adj = buildAdjacency(types, links);
  const typeKeys = new Set(types.map((t) => t.key));
  const domainOf = new Map(types.map((t) => [t.key, t.domain ?? ""]));
  const sortedTargets = [...new Set(req.targets)].sort();
  const paths: SlicePlan["paths"] = [];
  const evidence: string[] = [];
  const spanned = new Set<string>();
  const unreachable: string[] = [];
  if (domainOf.get(req.rootType)) spanned.add(domainOf.get(req.rootType)!);

  for (const target of sortedTargets) {
    if (!typeKeys.has(target) || !typeKeys.has(req.rootType)) { unreachable.push(target); continue; }
    const hops = shortestPath(adj, req.rootType, target, req.maxHops);
    if (hops === null) { unreachable.push(target); continue; }
    paths.push({ target, hops });
    evidence.push(hopEvidence(req.rootType, hops));
    for (const h of hops) { const d = domainOf.get(h.toType); if (d) spanned.add(d); }
  }

  if (unreachable.length > 0) {
    return { ok: false, reason: { code: "NO_PATH", rootType: req.rootType, unreachable: unreachable.sort() } };
  }
  const sliceKey = `biz.plan.${req.rootType.toLowerCase()}__${sortedTargets.map((t) => t.toLowerCase()).join("_")}`.replace(/[^\w.]/g, "_");
  const plan: SlicePlan = {
    sliceKey,
    rootType: req.rootType,
    paths,
    pathEvidence: evidence,
    spannedDomains: [...spanned].sort(),
    reused: false,
  };
  return { ok: true, plan };
}
