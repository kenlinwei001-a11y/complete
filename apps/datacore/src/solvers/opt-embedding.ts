/**
 * 轨B·增量4 embedding 复用检索（advisory · net-new · 目标从上游"多样性"倒转为"复用/补缺"）。
 *
 * ⚠ FUS2：embedding 只做**候选排序/听懂**层，**绝不进确定性求解路径**（R6 地板）。真正绑定+求解仍是 CP-SAT。
 * ⚠ 这是平台今天没有的全新基建（现有 lookupReusable 是确定性结构匹配）。这里用**本地确定性
 *   词袋向量 + 余弦相似度**（无网络/无 LLM/无 Math.random → 确定性可复现），作为 advisory 检索；
 *   关 entitlement（opt.embedding-retrieval）→ 端点退回 comprehend 关键词列表，不静默（DoD §3）。
 *
 * 三用途（全收敛/需求驱动）：① need→最近现有模板复用；② 覆盖缺口（离所有模板都远→补缺信号）；
 * ③ 跨行业迁移证据（"充电站选址"≈"诊所选址"→一模板服两行业，实证 R14）。
 */

/** 模板描述索引项（平台级元资产，跨租户共享核心；租户场景文本进检索侧守 R2，不入索引）。 */
export interface TemplateDoc {
  key: string;
  text: string; // 模板族 + 别名 + 典型用途描述（中英混合关键词）
}

/** 默认 5 核心模板的检索描述（零业务常数：只描述抽象 OR 结构与通用用途，不含行业实体名）。 */
export const DEFAULT_TEMPLATE_DOCS: TemplateDoc[] = [
  { key: "facility_location", text: "facility location 选址 设施 选点 开设 服务覆盖 选哪些点 建设成本 指派 最小总成本 location siting where to build serve clients" },
  { key: "min_cost_flow", text: "min cost flow 最小成本流 调拨 运输 配送 网络流 供需 平衡 路径 容量 transport routing distribution network flow supply demand" },
  { key: "set_cover", text: "set cover 集合覆盖 选最少 覆盖全部 巡检 监测点 覆盖需求 最小集合 coverage cover all minimum sets monitoring" },
  { key: "independent_set", text: "independent set 独立集 互斥 不冲突 不可同时 选最多 冲突约束 排他 incompatible conflict mutually exclusive scheduling" },
  { key: "combinatorial_auction", text: "combinatorial auction 组合拍卖 赢者裁定 打包出价 投标 分配 收益最大 bundle bid winner allocation procurement" },
];

const TOKEN = /[a-z0-9]+|[一-鿿]/gi;
function tokens(text: string): string[] {
  return (text.toLowerCase().match(TOKEN) ?? []).filter((t) => t.length > 0);
}

/** 词频向量（Map term→count）。确定性。 */
function tf(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens(text)) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** 余弦相似度（两词频向量）。确定性，[0,1]。 */
function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const [, v] of a) na += v * v;
  for (const [, v] of b) nb += v * v;
  for (const [t, v] of a) { const w = b.get(t); if (w) dot += v * w; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * 平台级模板 embedding 索引（本地确定性词袋实现；接口与 SPEC §3 OptEmbeddingIndex 同构，
 * 留待后续替换为真向量后端而不改调用方）。
 */
export class LocalTemplateIndex {
  private docs: { key: string; vec: Map<string, number> }[];
  constructor(docs: TemplateDoc[] = DEFAULT_TEMPLATE_DOCS) {
    this.docs = docs.map((d) => ({ key: d.key, vec: tf(`${d.key} ${d.text}`) }));
  }

  /** 检索最近模板（复用）：need 文本 → 候选 {key,score} 按相似度降序（tie-break key 字典序，R6）。 */
  nearestTemplates(needText: string, k = 3): { key: string; score: number }[] {
    const q = tf(needText);
    return this.docs
      .map((d) => ({ key: d.key, score: Math.round(cosine(q, d.vec) * 1e6) / 1e6 }))
      .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
      .slice(0, k);
  }

  /** 覆盖缺口：need 离所有模板都远（top1 < threshold）→ true（发"长新模板"信号，需求驱动非为多样）。 */
  coverageGap(needText: string, threshold = 0.05): boolean {
    const top = this.nearestTemplates(needText, 1)[0];
    return !top || top.score < threshold;
  }
}
