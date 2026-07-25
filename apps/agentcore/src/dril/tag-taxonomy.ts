import type { TieredTags } from "@platform/contracts";

/**
 * WO-DRIL-P2 · 五级标签 taxonomy（PRD-decision-resource-intelligence-layer §5.2 / §5.5）。
 *
 * 五级：L1 业务域 / L2 决策类型 / L3 业务场景 / L4 对象 / L5 算法。本表**只声明 L1/L2/L3/L5**
 * 的关键词映射（config-driven·租户可扩展）——它们是决策/算法/场景类目，不是业务对象名。
 *
 * **R14 零业务常数（硬纪律）**：L4 对象标签**不在本表**——它在投影期从**已发布 OntologyType.key**
 * 派生（`deriveL4FromOntology`）。本文件不内联任何业务对象字面量（如 Base/Line/Order），
 * 只有决策类型/场景/算法的通用类目词。DF.8 接地：L4 值域 = 该租户已发布对象类型全集。
 *
 * R6 确定性：所有匹配为纯关键词包含（无 LLM/无时钟），同文本同标签。
 */

/** taxonomy 条目：canonical `tag` + 触发它的关键词集（含中英、大小写不敏感）。 */
export interface TaxonomyEntry {
  tag: string;
  keywords: string[];
}

/**
 * DRIL 五级标签配置表（L1/L2/L3/L5·L4 从本体派生不在此）。
 * - l1_domain：业务域关键词——tag 对齐 DataCore BUSINESS_DOMAINS.key（B 不 import A 源·R1，
 *   故此处按 key 声明关键词映射；资源侧 L1 直接取 resource.domain，query 侧靠本表提词）。
 * - l2_decisionType：Prediction/Optimization/Simulation/Diagnosis/Monitoring/Planning。
 * - l3_scenario：产销匹配/S&OP/库存/设备维护/风险/质量/财务/认证/换型/碳/订单 等。
 * - l5_algorithm：MILP/LP/TimeSeries/Graph/Simulation/RuleEngine。
 */
export const DRIL_TAG_TAXONOMY: {
  l1_domain: TaxonomyEntry[];
  l2_decisionType: TaxonomyEntry[];
  l3_scenario: TaxonomyEntry[];
  l5_algorithm: TaxonomyEntry[];
} = {
  l1_domain: [
    { tag: "plan", keywords: ["规划", "计划", "排产", "情景", "plan"] },
    { tag: "product", keywords: ["型号", "产品", "product", "model"] },
    { tag: "factory", keywords: ["工厂", "基地", "产线", "factory", "base", "line"] },
    { tag: "quality", keywords: ["质量", "良率", "quality", "yield"] },
    { tag: "capacity", keywords: ["产能", "capacity", "瓶颈", "利用率"] },
    { tag: "forecast", keywords: ["预测", "需求", "forecast", "demand"] },
    { tag: "sales", keywords: ["销售", "订单", "接单", "sales", "order"] },
    { tag: "material", keywords: ["物料", "供应", "齐套", "库存", "material", "supply"] },
    { tag: "finance", keywords: ["财务", "成本", "毛利", "现金", "finance", "cost", "margin"] },
    { tag: "equip", keywords: ["设备", "检修", "维护", "equipment", "maintenance", "oee"] },
    { tag: "decision", keywords: ["决策", "根因", "归因", "decision", "rootcause"] },
    { tag: "external", keywords: ["外部信号", "地缘", "矿价", "external"] },
  ],
  l2_decisionType: [
    { tag: "Prediction", keywords: ["预测", "预估", "推演", "满足度", "forecast", "predict", "p50", "p90"] },
    { tag: "Optimization", keywords: ["优化", "最优", "最小化", "优选", "分配", "排序", "排程", "optimize", "optimal"] },
    { tag: "Simulation", keywords: ["模拟", "沙盘", "情景", "反事实", "what-if", "假设", "simulate", "scenario"] },
    { tag: "Diagnosis", keywords: ["诊断", "归因", "根因", "为什么", "定位", "瓶颈", "diagnose", "rootcause", "attribution"] },
    { tag: "Monitoring", keywords: ["监控", "越线", "预警", "体检", "敞口", "监测", "monitor", "audit"] },
    { tag: "Planning", keywords: ["计划", "排产", "规划", "生成", "排期", "编排", "plan", "schedule"] },
  ],
  l3_scenario: [
    { tag: "产能", keywords: ["产能", "满足度", "金字塔", "上卷", "capacity", "利用率"] },
    { tag: "产销匹配", keywords: ["产销", "供需", "s&op", "sop", "产销匹配", "supply-demand"] },
    { tag: "库存优化", keywords: ["库存", "呆滞", "水位", "inventory", "stock"] },
    { tag: "物料齐套", keywords: ["齐套", "物料", "净需求", "长协", "mrp", "material", "kit"] },
    { tag: "设备维护", keywords: ["检修", "维护", "错峰", "oee", "maintenance", "equipment"] },
    { tag: "风险", keywords: ["风险", "越线", "时间线", "扰动", "risk", "timeline"] },
    { tag: "质量良率", keywords: ["良率", "质量", "yield", "quality", "缺陷"] },
    { tag: "财务成本", keywords: ["毛利", "财务", "成本", "量价本利", "现金", "pnl", "margin", "finance"] },
    { tag: "信用敞口", keywords: ["信用", "敞口", "逾期", "应收", "credit", "exposure"] },
    { tag: "认证排期", keywords: ["认证", "排期", "cert", "certification"] },
    { tag: "换型排序", keywords: ["换型", "changeover", "切换"] },
    { tag: "碳核算", keywords: ["碳", "碳足迹", "能耗", "carbon", "emission"] },
    { tag: "订单接单", keywords: ["订单", "接单", "交期", "全链", "order", "delivery"] },
    { tag: "情景投资", keywords: ["情景", "投资", "capex", "irr", "供给曲线"] },
  ],
  l5_algorithm: [
    { tag: "MILP", keywords: ["milp", "整数规划", "指派", "assignment", "cp-sat", "cpsat", "最优化"] },
    { tag: "LP", keywords: ["lp", "线性规划", "linear"] },
    { tag: "TimeSeries", keywords: ["时序", "时间线", "逐日", "series", "timeline", "推移"] },
    { tag: "Graph", keywords: ["图", "子图", "网络", "归因", "链路", "遍历", "多跳", "graph", "dag", "network"] },
    { tag: "Simulation", keywords: ["模拟", "沙盘", "推演", "情景", "反事实", "simulate", "what-if"] },
    { tag: "RuleEngine", keywords: ["规则", "合规", "判定", "校验", "rule", "compliance"] },
  ],
};

/** 大小写不敏感的关键词包含匹配（中文直接含判；英文按 lower 含判）。 */
function hit(textLower: string, keyword: string): boolean {
  return textLower.includes(keyword.toLowerCase());
}

/** 对某一层 taxonomy 提取命中的 canonical tag 集（去重·稳定序）。 */
function matchLayer(textLower: string, entries: TaxonomyEntry[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (e.keywords.some((k) => hit(textLower, k)) && !out.includes(e.tag)) out.push(e.tag);
  }
  return out;
}

/**
 * L4 派生（R14）：从已发布 OntologyType（key + 可选中文 label）里，取在 candidateTypes（资源显式声明的
 * scope/included/input 对象类型）或文本中出现者。值域严格 ⊆ 已发布 key 全集——无手写业务对象名。
 */
export function deriveL4FromOntology(
  textLower: string,
  candidateTypes: string[],
  ontologyTypes: { key: string; label?: string }[],
): string[] {
  const published = new Map(ontologyTypes.map((t) => [t.key, t] as const));
  const out: string[] = [];
  const add = (key: string) => {
    if (published.has(key) && !out.includes(key)) out.push(key);
  };
  // ① 资源显式声明的对象类型（rule.scopeObjectTypes / agent.scopeObjectTypes / slice.includedTypes / inputSpec）。
  for (const c of candidateTypes) add(c);
  // ② 文本扫描：已发布类型 key（英文，词形较硬）或其中文 label 出现于文本 → 该类型。
  for (const t of ontologyTypes) {
    const keyHit = hit(textLower, t.key) && t.key.length >= 3; // 短 key 易误命中，设长度门
    const labelHit = t.label ? textLower.includes(t.label.toLowerCase()) : false;
    if (keyHit || labelHit) add(t.key);
  }
  return out;
}

/** 从文本 + 域 + 本体类型派生一个资源/查询的五级标签（纯函数·R6）。 */
export function extractTieredTags(
  text: string,
  opts: {
    domain?: string;
    candidateTypes?: string[];
    ontologyTypes?: { key: string; label?: string }[];
  } = {},
): TieredTags {
  const textLower = text.toLowerCase();
  const l1 = matchLayer(textLower, DRIL_TAG_TAXONOMY.l1_domain);
  // 资源侧优先用真值 domain（派生自源模块，R14 不手写）；再并入文本命中的域。
  const l1_domain = opts.domain && !l1.includes(opts.domain) ? [opts.domain, ...l1] : l1;
  return {
    l1_domain,
    l2_decisionType: matchLayer(textLower, DRIL_TAG_TAXONOMY.l2_decisionType),
    l3_scenario: matchLayer(textLower, DRIL_TAG_TAXONOMY.l3_scenario),
    l4_object: deriveL4FromOntology(textLower, opts.candidateTypes ?? [], opts.ontologyTypes ?? []),
    l5_algorithm: matchLayer(textLower, DRIL_TAG_TAXONOMY.l5_algorithm),
  };
}
