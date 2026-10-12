/**
 * WO-SLICE-CONSUMPTION-20260912 · resolve_slice 收敛回执（PRD-slice-consumption-governance 前置 C1）。
 *
 * 今天的行为（X）：大图形切片回执（如 order_fulfillment_360 = 296,657 B · 2026-09-12 实测）
 * 原样出 executor，进 LLM 上下文前被 truncateToolResultJson 盲切最大数组前 N 项 ——
 * LLM 丢类型全景、丢深度分布、丢深层锚点 id，尾注说「用更精确过滤重查」却没给任何可下钻线索。
 * 应该是（Y）：同字节预算内装结构化收敛形 —— 全类型×跳数计数（完整态势）+ 根节点全量 props
 * （锚点）+ 每类型深层 id 样本（下钻线索），盲切变定形。
 *
 * 透传规则（不收敛）：
 *  ① 遗留定制形（{data:{model,bases}} 等无 nodes/edges 数组的回包）—— 本就小而专；
 *  ② 小图形（nodes ≤ SLICE_CONVERGE_THRESHOLD）—— 全量回灌成本低且保真（ValidationTrace 交叉验证吃 props）。
 */
export const SLICE_CONVERGE_THRESHOLD = 40;
export const SLICE_SAMPLE_PER_TYPE = 8;
export const SLICE_SAMPLE_TOTAL_CAP = 96;

export const SLICE_RECEIPT_SHAPE = "SLICE_RECEIPT_V1" as const;

interface GraphNode {
  id: string;
  typeKey?: string;
  type?: string;
  objectKey?: string;
  props?: Record<string, unknown>;
}
interface GraphEdge {
  from: string;
  to: string;
  linkKey?: string;
}

export interface ShapedSliceReceipt {
  shape: typeof SLICE_RECEIPT_SHAPE;
  sliceKey: string;
  truncated: boolean;
  snapshotVersion?: string;
  summary: {
    totalNodes: number;
    totalEdges: number;
    /** 全类型计数（ValidationTrace 类型清单的单源）。 */
    byType: Record<string, number>;
    /** 类型×跳数计数（BFS 深度，根=0；不可达节点进 "?" 桶）。 */
    byTypeDepth: Record<string, Record<string, number>>;
  };
  /** 根节点（不被任何边指向；无指向关系时退化为首节点）——全量 props 保留。 */
  rootNodes: { id: string; typeKey: string; objectKey?: string; props?: Record<string, unknown> }[];
  /** 深层锚点样本：每类型 ≤ SLICE_SAMPLE_PER_TYPE 个，总量 ≤ SLICE_SAMPLE_TOTAL_CAP，无 props。 */
  sampleNodes: {
    id: string;
    typeKey: string;
    objectKey?: string;
    depth: number | "?";
    /** 逐字可用的下钻过滤器：query_objects(typeKey, filter) 必命中本节点（天然键字段纯结构识别）。 */
    filter?: Record<string, unknown>;
  }[];
  drilldown: {
    tools: ["get_object", "query_objects"];
    /** 各类型未被样本列出的深层节点数（= byType − 根 − 样本）。 */
    omittedByType: Record<string, number>;
    hint: string;
  };
}

const typeOf = (n: GraphNode): string => n.typeKey ?? n.type ?? "Object";

/** 图形回执（{data:{nodes[],edges[]}} 且超阈值）→ 收敛形；其余原样透传。 */
export function shapeSliceReceipt(sliceKey: string, payload: unknown): unknown {
  const body = (payload as { data?: unknown } | null)?.data ?? payload;
  const nodes = (body as { nodes?: unknown } | null)?.nodes;
  const edges = (body as { edges?: unknown } | null)?.edges;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return payload;
  if (nodes.length <= SLICE_CONVERGE_THRESHOLD) return payload;

  const ns = nodes as GraphNode[];
  const es = edges as GraphEdge[];
  const snapshotVersion = (payload as { snapshotVersion?: string } | null)?.snapshotVersion;
  const truncated = Boolean((body as { truncated?: unknown } | null)?.truncated);

  /**
   * 真根判定（纯结构，无业务常数）。
   * ⚠ 2026-09-12 AC5 实测红后修：线上回包存在**反向边**（Equipment→Process 指向上游），
   * 「不被任何边指向」会捞出 241 个伪根（真根 Order×1 + 上游叶子 Equipment×240），
   * 每个带全量 props ⇒ 收敛后 79,336B，破 <12KB 判据（实测单：/tmp/ac5-inspect.mjs 分层）。
   * 判据：零入度候选按「沿边方向可达节点数」取最大者（真根可达整图主体，上游叶子只能
   * 达自己那一小段链）；并列按回包原序；带 props 的根 ≤ SLICE_SAMPLE_PER_TYPE，
   * 溢出候选**降级为普通节点**（可进样本/omitted），无零入度节点（环图）退化为首节点。
   */
  const pointed = new Set(es.map((e) => e.to));
  let candidates = ns.filter((n) => !pointed.has(n.id));
  if (candidates.length === 0) candidates = [ns[0]!];
  const adj = new Map<string, string[]>();
  for (const e of es) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }
  const reachOf = (start: string): number => {
    const seen = new Set([start]);
    const q = [start];
    while (q.length > 0) {
      for (const nxt of adj.get(q.shift()!) ?? []) {
        if (!seen.has(nxt)) {
          seen.add(nxt);
          q.push(nxt);
        }
      }
    }
    return seen.size;
  };
  const ranked = candidates
    .map((n, i) => ({ n, i, reach: reachOf(n.id) }))
    .sort((a, b) => b.reach - a.reach || a.i - b.i);
  // 只取**最大可达层**（并列 = 互不相通的等大分量）；层内并列超帽才截前 N 个，其余降级普通节点。
  const maxReach = ranked[0]!.reach;
  const topTier = ranked.filter((r) => r.reach === maxReach);
  const roots = topTier.slice(0, SLICE_SAMPLE_PER_TYPE).map((r) => r.n);
  const rootIds = new Set(roots.map((r) => r.id));

  /**
   * BFS 跳数：从真根出发、**沿链路无向**计跳（切片语义 = root 沿链路逐跳展开，
   * 与边方向无关——反向边挂在上游的叶子同样是「第 N 跳」，不是第 0 跳）；不可达 → "?"。
   */
  const depth = new Map<string, number>();
  const uadj = new Map<string, string[]>();
  for (const e of es) {
    if (!uadj.has(e.from)) uadj.set(e.from, []);
    uadj.get(e.from)!.push(e.to);
    if (!uadj.has(e.to)) uadj.set(e.to, []);
    uadj.get(e.to)!.push(e.from);
  }
  const queue: string[] = [];
  for (const r of roots) {
    depth.set(r.id, 0);
    queue.push(r.id);
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = depth.get(cur)!;
    for (const nxt of uadj.get(cur) ?? []) {
      if (!depth.has(nxt)) {
        depth.set(nxt, d + 1);
        queue.push(nxt);
      }
    }
  }

  const byType: Record<string, number> = {};
  const byTypeDepth: Record<string, Record<string, number>> = {};
  for (const n of ns) {
    const t = typeOf(n);
    byType[t] = (byType[t] ?? 0) + 1;
    const dk = String(depth.get(n.id) ?? "?");
    if (!byTypeDepth[t]) byTypeDepth[t] = {};
    byTypeDepth[t]![dk] = (byTypeDepth[t]![dk] ?? 0) + 1;
  }

  /**
   * 下钻键（纯结构）：样本节点的 objectKey 必等于其 props 里某个字段的值（天然键），
   * 找到即随样本下发 `filter` —— query_objects(typeKey, filter) 可**逐字**下钻，
   * 不用 LLM 猜各类型的键字段名（baseId/lineId/equipId 各不相同，2026-09-12 实测
   * filter={objectKey} 命中 0，filter={baseId} 命中 1）。
   */
  const drillFilterOf = (n: GraphNode): Record<string, unknown> | undefined => {
    if (n.objectKey === undefined || !n.props) return undefined;
    for (const [k, v] of Object.entries(n.props)) {
      if (v === n.objectKey) return { [k]: v };
    }
    return undefined;
  };

  // 每类型锚点样本（稳定序 = 回包原序；超总帽即停）
  const sampledByType = new Map<string, number>();
  const sampleNodes: ShapedSliceReceipt["sampleNodes"] = [];
  for (const n of ns) {
    if (rootIds.has(n.id)) continue;
    const t = typeOf(n);
    const got = sampledByType.get(t) ?? 0;
    if (got >= SLICE_SAMPLE_PER_TYPE) continue;
    if (sampleNodes.length >= SLICE_SAMPLE_TOTAL_CAP) break;
    sampledByType.set(t, got + 1);
    const filter = drillFilterOf(n);
    sampleNodes.push({
      id: n.id,
      typeKey: t,
      ...(n.objectKey !== undefined ? { objectKey: n.objectKey } : {}),
      depth: depth.get(n.id) ?? "?",
      ...(filter !== undefined ? { filter } : {}),
    });
  }

  const rootCountByType = new Map<string, number>();
  for (const r of roots) rootCountByType.set(typeOf(r), (rootCountByType.get(typeOf(r)) ?? 0) + 1);
  const omittedByType: Record<string, number> = {};
  for (const [t, total] of Object.entries(byType)) {
    const omitted = total - (rootCountByType.get(t) ?? 0) - (sampledByType.get(t) ?? 0);
    if (omitted > 0) omittedByType[t] = omitted;
  }

  const receipt: ShapedSliceReceipt = {
    shape: SLICE_RECEIPT_SHAPE,
    sliceKey,
    truncated,
    ...(snapshotVersion !== undefined ? { snapshotVersion } : {}),
    summary: { totalNodes: ns.length, totalEdges: es.length, byType, byTypeDepth },
    rootNodes: roots.map((r) => ({
      id: r.id,
      typeKey: typeOf(r),
      ...(r.objectKey !== undefined ? { objectKey: r.objectKey } : {}),
      ...(r.props !== undefined ? { props: r.props } : {}),
    })),
    sampleNodes,
    drilldown: {
      tools: ["get_object", "query_objects"],
      omittedByType,
      hint:
        `切片 ${sliceKey} 共 ${ns.length} 节点/${es.length} 边，已收敛：summary 为全量计数，rootNodes 全量 props，sampleNodes 为每类型锚点（无 props，带下钻 filter）。` +
        `单节点详情用 get_object(objectType, sample.id)；按键下钻用 query_objects(objectType, sample.filter)；要某类型全量清单用 query_objects(objectType, {}) 按类型分页查。`,
    },
  };
  return receipt;
}
