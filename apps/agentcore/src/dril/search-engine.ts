import {
  DRIL_DOMAIN_LAYER_WEIGHTS,
  DRIL_RANK_WEIGHTS,
  TRUST_LEVEL_ORDER,
  graphDistanceScore,
  relationStrengthScore,
  type IntelligenceResource,
  type ResourceSearchRequest,
  type ResourceSearchResponse,
  type ResourceSearchResultItem,
  type ScoreBreakdown,
  type TieredTags,
} from "@platform/contracts";
import { cosine, pseudoEmbed } from "../util/embedding.js";
import { lexTokens } from "../agent/skill-router.js";
import { extractTieredTags } from "./tag-taxonomy.js";

/**
 * WO-DRIL-P2 · ResourceSearchEngine（PRD-decision-resource-intelligence-layer §7 混合检索）。
 *
 * 管线（§7.1）：① Intent Tag 抽取（R6 正则/关键词）→ ② Structured Filter（entitlement 已由 registry 前置·
 * 此处做 kinds/requiredTags/excludeKeys/minTrustLevel 硬过滤）→ ③ Embedding 语义（advisory·可插拔·
 * 无 embedder 时降级词法）→ ④ Graph Traversal（§7.1 ④·graphDistance 复用 planSlice BFS 最短路）→
 * ⑤ 确定性加权排序（§7.1 权重精确）。
 *
 * **WO-DRIL-P3 · ontology 子分补全（§7.2）**：`ontology = 0.5·objectTypeOverlap + 0.3·graphDistance
 * + 0.2·relationStrength`。graphDistance 由 `hopsFromFocus`（DataCore planSlice BFS 派生的焦点→类型最短跳数）
 * 算 `1/(1+minHops)`；relationStrength 由 resource.relations 指向 `selectedKeys` 的占比算（组包场景）。
 * 二者缺省（无焦点图 / 无已选中）→ 中性 0 → ontology 退回纯 objectTypeOverlap（**P2 golden 字节不变**）。
 *
 * fail-open（铁律 4）：embedder=null → 词法回退（非崩溃·仍返排序结果）；无 quality → history/cost 用中性默认；
 * 无 hopsFromFocus → graphDistance 0。R6：pseudoEmbed/词法/BFS 均确定性 → 同 query 同 registry 字节级同序。
 */

export type Embedder = ((text: string) => number[]) | null;

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

type OntologyType = { key: string; label?: string };

export interface SearchEngineOptions {
  /** 语义层向量器；缺省 pseudoEmbed（确定性）；显式传 null → 词法回退（fail-open 证明用）。 */
  embedder?: Embedder;
  /** 已发布本体对象类型（L4 派生 + ontology 兼容分用）。 */
  ontologyTypes?: OntologyType[];
  /**
   * WO-DRIL-P3 · 焦点类型→各对象类型的**最短跳数**（DataCore planSlice BFS 派生·R6）。
   * 供 graphDistance 子分；缺省/空 → graphDistance 中性 0（fail-open）。
   */
  hopsFromFocus?: Map<string, number>;
  /**
   * WO-DRIL-P3 · 已选中资源键集（`${kind}|${key}`）——buildResourcePackage 组包时的"已选中"基准。
   * 供 relationStrength 子分；缺省/空 → relationStrength 中性 0（普通检索不参与）。
   */
  selectedKeys?: Set<string>;
}

export class ResourceSearchEngine {
  private readonly embedder: Embedder;
  private readonly ontologyTypes: OntologyType[];
  private readonly hopsFromFocus: Map<string, number> | undefined;
  private readonly selectedKeys: Set<string> | undefined;

  constructor(opts: SearchEngineOptions = {}) {
    this.embedder = opts.embedder === undefined ? (t) => pseudoEmbed(t) : opts.embedder;
    this.ontologyTypes = opts.ontologyTypes ?? [];
    this.hopsFromFocus = opts.hopsFromFocus;
    this.selectedKeys = opts.selectedKeys;
  }

  /** 混合检索主入口：query + 候选资源（已过 entitlement）→ 排序结果 + 解释。 */
  search(
    query: string,
    resources: IntelligenceResource[],
    req: Omit<ResourceSearchRequest, "query"> = { maxResults: 20, minScore: 0.3 },
  ): ResourceSearchResponse {
    const maxResults = req.maxResults ?? 20;
    const minScore = req.minScore ?? 0.3;
    const contextTypes = extractContextObjectTypes(req.context);

    // [1] 意图标签抽取（query 侧五级候选标签）。
    const queryTags = extractTieredTags(query, {
      candidateTypes: contextTypes,
      ontologyTypes: this.ontologyTypes,
    });
    const queryTokens = lexTokens(query);
    const qv = this.embedder ? this.embedder(query) : null;

    // [2] Structured Filter（硬过滤）。
    const filtered = resources.filter((r) => this.passesStructuredFilter(r, req));

    // [3+5] 语义 + 确定性加权排序。
    const scored: ResourceSearchResultItem[] = filtered.map((resource) => {
      const resTags = resource.tieredTags ?? extractTieredTags(resourceText(resource), {
        domain: resource.domain,
        candidateTypes: resourceObjectTypes(resource),
        ontologyTypes: this.ontologyTypes,
      });
      const breakdown = this.scoreResource(resource, resTags, {
        qv,
        queryTokens,
        queryTags,
        contextTypes,
      });
      const score = round6(
        DRIL_RANK_WEIGHTS.semantic * breakdown.semantic +
          DRIL_RANK_WEIGHTS.domain * breakdown.domain +
          DRIL_RANK_WEIGHTS.ontology * breakdown.ontology +
          DRIL_RANK_WEIGHTS.history * breakdown.history +
          DRIL_RANK_WEIGHTS.cost * breakdown.cost,
      );
      return {
        resource,
        score,
        scoreBreakdown: breakdown,
        explanation: explainResult(resource, resTags, breakdown, queryTags, contextTypes),
      };
    });

    const results = scored
      .filter((r) => r.score >= minScore)
      .sort(
        (a, b) =>
          b.score - a.score ||
          (a.resource.kind < b.resource.kind ? -1 : a.resource.kind > b.resource.kind ? 1 : 0) ||
          (a.resource.key < b.resource.key ? -1 : a.resource.key > b.resource.key ? 1 : 0),
      )
      .slice(0, maxResults);

    return { results, explanation: explainOverall(query, results, queryTags) };
  }

  private passesStructuredFilter(r: IntelligenceResource, req: Omit<ResourceSearchRequest, "query">): boolean {
    if (req.kinds && req.kinds.length > 0 && !req.kinds.includes(r.kind)) return false;
    if (req.excludeKeys && req.excludeKeys.includes(r.key)) return false;
    if (req.minTrustLevel) {
      const cur = TRUST_LEVEL_ORDER[r.quality?.trustLevel ?? "EXPERIMENTAL"];
      if (cur < TRUST_LEVEL_ORDER[req.minTrustLevel]) return false;
    }
    if (req.requiredTags) {
      const resTags = r.tieredTags ?? extractTieredTags(resourceText(r), {
        domain: r.domain,
        candidateTypes: resourceObjectTypes(r),
        ontologyTypes: this.ontologyTypes,
      });
      for (const layer of TIER_LAYERS) {
        const need = req.requiredTags[layer];
        if (!need || need.length === 0) continue;
        const have = new Set(resTags[layer] ?? []);
        if (!need.every((t) => have.has(t))) return false;
      }
    }
    return true;
  }

  private scoreResource(
    resource: IntelligenceResource,
    resTags: TieredTags,
    q: { qv: number[] | null; queryTokens: Set<string>; queryTags: TieredTags; contextTypes: string[] },
  ): ScoreBreakdown {
    return {
      semantic: round6(this.semanticScore(resource, q.qv, q.queryTokens)),
      domain: round6(domainScore(q.queryTags, resTags)),
      ontology: round6(this.ontologyScore(resource, resTags, q.queryTags, q.contextTypes)),
      history: round6(historyScore(resource)),
      cost: round6(costScore(resource)),
    };
  }

  /** Semantic（§7.2）：max cosine(query, {desc|answersQuestions|tags})；无 embedder → 词法重叠比。 */
  private semanticScore(resource: IntelligenceResource, qv: number[] | null, queryTokens: Set<string>): number {
    const cands = semanticCandidates(resource);
    if (qv && this.embedder) {
      let best = 0;
      for (const c of cands) if (c) best = Math.max(best, cosine(qv, this.embedder(c)));
      return best;
    }
    // fail-open 词法回退：命中 query token 占比（robust·非崩溃）。
    if (queryTokens.size === 0) return 0;
    let best = 0;
    for (const c of cands) {
      if (!c) continue;
      const ct = lexTokens(c);
      let inter = 0;
      for (const t of queryTokens) if (ct.has(t)) inter++;
      best = Math.max(best, inter / queryTokens.size);
    }
    return best;
  }

  /**
   * Ontology（§7.2·WO-DRIL-P3 补全）：`0.5·objectTypeOverlap + 0.3·graphDistance + 0.2·relationStrength`。
   * - objectTypeOverlap：query/context 提到的对象类型 ∩ resource 声明/派生类型的占比。
   * - graphDistance：resource 可达类型到焦点的最近跳数 → 1/(1+minHops)（planSlice BFS·缺图 → 0）。
   * - relationStrength：resource 关系指向已选中资源的占比（组包场景·普通检索 → 0）。
   */
  private ontologyScore(
    resource: IntelligenceResource,
    resTags: TieredTags,
    queryTags: TieredTags,
    contextTypes: string[],
  ): number {
    const rTypes = [...new Set<string>([...(resTags.l4_object ?? []), ...resourceObjectTypes(resource)])];

    // (1) objectTypeOverlap（0.5）。
    const qTypes = new Set<string>([...(queryTags.l4_object ?? []), ...contextTypes]);
    let overlap = 0;
    if (qTypes.size > 0) {
      const rSet = new Set(rTypes);
      let inter = 0;
      for (const t of qTypes) if (rSet.has(t)) inter++;
      overlap = inter / qTypes.size;
    }

    // (2) graphDistance（0.3）：焦点→resource 类型最短跳数（planSlice BFS·R6·缺图中性 0）。
    const graphDistance = graphDistanceScore(this.hopsFromFocus, rTypes);

    // (3) relationStrength（0.2）：resource 关系指向已选中资源占比（缺选中中性 0）。
    const relationStrength = relationStrengthScore(resource.relations, this.selectedKeys);

    return 0.5 * overlap + 0.3 * graphDistance + 0.2 * relationStrength;
  }
}

const TIER_LAYERS: (keyof TieredTags)[] = [
  "l1_domain",
  "l2_decisionType",
  "l3_scenario",
  "l4_object",
  "l5_algorithm",
];

/** Business Domain Match（§7.2）：Σ layerWeight[l]·hitRatio[l]（hitRatio = 命中/query 请求标签数）。 */
function domainScore(queryTags: TieredTags, resTags: TieredTags): number {
  let s = 0;
  for (const layer of TIER_LAYERS) {
    const q = queryTags[layer] ?? [];
    if (q.length === 0) continue;
    const have = new Set(resTags[layer] ?? []);
    let hit = 0;
    for (const t of q) if (have.has(t)) hit++;
    s += DRIL_DOMAIN_LAYER_WEIGHTS[layer] * (hit / q.length);
  }
  return s;
}

/** Historical Success（§7.2）：0.5·successRate + 0.3·accuracy + 0.2·trustWeight（无 quality → 中性 0.1）。 */
function historyScore(resource: IntelligenceResource): number {
  const q = resource.quality;
  const trust = q?.trustLevel;
  const trustWeight = trust === "GOVERNED" ? 1.0 : trust === "PRODUCTION" ? 0.8 : 0.5;
  return 0.5 * (q?.successRate ?? 0) + 0.3 * (q?.accuracy ?? 0) + 0.2 * trustWeight;
}

/** Runtime Cost（§7.2）：0.5·exp(-lat/60000) + 0.3·complexityWeight + 0.2·sidecarWeight。 */
function costScore(resource: IntelligenceResource): number {
  const solverLike = resource as { complexity?: string; requiresSidecar?: boolean };
  const lat = resource.runtime?.avgLatencyMs ?? resource.quality?.avgLatencyMs ?? 0;
  const complexity = solverLike.complexity;
  const complexityWeight = complexity === "HIGH" ? 0.6 : complexity === "MEDIUM" ? 0.8 : 1.0;
  const requiresSidecar = resource.runtime?.requiresSidecar ?? solverLike.requiresSidecar ?? false;
  const sidecarWeight = requiresSidecar ? 0.7 : 1.0;
  return 0.5 * Math.exp(-lat / 60000) + 0.3 * complexityWeight + 0.2 * sidecarWeight;
}

/** 语义候选文本（§7.2：desc / answersQuestions[] / tags[]·再补 label/capability 提召回）。 */
function semanticCandidates(r: IntelligenceResource): string[] {
  const out: string[] = [r.description, r.label];
  if (r.capability) out.push(r.capability);
  for (const q of r.answersQuestions ?? []) out.push(q);
  for (const q of r.suitableQuestions ?? []) out.push(q);
  if (r.tags && r.tags.length > 0) out.push(r.tags.join(" "));
  return out.filter(Boolean);
}

/** 资源全文（用于缺省 tieredTags 计算与词法回退）。 */
function resourceText(r: IntelligenceResource): string {
  const parts = [r.label, r.description, r.capability ?? "", ...(r.answersQuestions ?? []), ...(r.tags ?? [])];
  if (r.argHints) parts.push(...Object.values(r.argHints));
  return parts.join(" ");
}

/** 资源显式声明的对象类型（rule/agent scope·slice included·任意 inputSpec）。 */
function resourceObjectTypes(r: IntelligenceResource): string[] {
  const out: string[] = [];
  const anyR = r as {
    scopeObjectTypes?: string[];
    includedTypes?: string[];
    inputSpec?: { objectTypes?: string[] };
  };
  if (anyR.scopeObjectTypes) out.push(...anyR.scopeObjectTypes);
  if (anyR.includedTypes) out.push(...anyR.includedTypes);
  if (anyR.inputSpec?.objectTypes) out.push(...anyR.inputSpec.objectTypes);
  return out;
}

/** 从 PageContext 提取焦点对象类型（宽松探测：objectTypes / focus.objectType / block.objectType）。 */
export function extractContextObjectTypes(context: Record<string, unknown> | undefined): string[] {
  if (!context) return [];
  const out: string[] = [];
  const arr = context.objectTypes;
  if (Array.isArray(arr)) for (const t of arr) if (typeof t === "string") out.push(t);
  const focus = context.focus as { objectType?: unknown } | undefined;
  if (focus && typeof focus.objectType === "string") out.push(focus.objectType);
  const block = context.block as { objectType?: unknown } | undefined;
  if (block && typeof block.objectType === "string") out.push(block.objectType);
  return out;
}

/** 单结果解释（§7.3 模板）。 */
function explainResult(
  resource: IntelligenceResource,
  resTags: TieredTags,
  b: ScoreBreakdown,
  queryTags: TieredTags,
  contextTypes: string[],
): string {
  const l1 = (resTags.l1_domain ?? []).join("/") || "-";
  const l3 = (resTags.l3_scenario ?? []).join("/") || "-";
  const overlapTypes = [...new Set([...(resTags.l4_object ?? []), ...resourceObjectTypes(resource)])]
    .filter((t) => (queryTags.l4_object ?? []).includes(t) || contextTypes.includes(t))
    .join("/");
  const q = resource.quality;
  const lines = [
    `「${resource.label}」被推荐因为：`,
    `· 语义匹配 ${b.semantic.toFixed(3)}（描述/样例问句相关）`,
    `· 业务域匹配 ${b.domain.toFixed(3)}：L1=${l1} / L3=${l3}`,
    `· 本体兼容 ${b.ontology.toFixed(3)}${overlapTypes ? `：命中对象 ${overlapTypes}` : "（无对象重叠）"}`,
    `· 历史成功率 ${((q?.successRate ?? 0) * 100).toFixed(0)}% / 平均时延 ${q?.avgLatencyMs ?? resource.runtime?.avgLatencyMs ?? 0}ms`,
  ];
  return lines.join("\n");
}

/** 整体解释：概述 query 抽到的标签 + top 命中。 */
function explainOverall(query: string, results: ResourceSearchResultItem[], queryTags: TieredTags): string {
  const tagline = TIER_LAYERS.map((l) => (queryTags[l] ?? []).join(","))
    .filter(Boolean)
    .join(" | ");
  if (results.length === 0) {
    return `未检索到满足门槛的资源（query 标签：${tagline || "无"}）。可放宽 minScore 或换用关键词。`;
  }
  const top = results
    .slice(0, 3)
    .map((r, i) => `${i + 1}. ${r.resource.label}(${r.resource.kind}/${r.resource.key}·${r.score.toFixed(3)})`)
    .join("；");
  return `按 query「${query}」抽取标签[${tagline || "无"}]，混合检索命中 ${results.length} 项，Top：${top}。`;
}
