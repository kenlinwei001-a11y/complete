/**
 * WO-GRAPH-2 · 本体图谱 14 域配色 / 中文名 配置（R14 配置驱动·零写死电池）。
 *
 * 抽自 `views/OntologyGraphView.tsx` 的 DOMAIN_COLORS / DOMAIN_LABELS / SOURCE_COLORS，
 * 收敛为图引擎共享的**单一域配置表**——GRAPH-3/4（切片 / 血缘 / KSF图 / 沙盘 / 元本体）
 * 接入同引擎时复用同一份配色，"改一处本体域→所有图谱视图实时同步"（§4 G-5 去电池）。
 *
 * 配色用设计 token（var(--c-*)），6 业务域（GRAPH_DOMAIN 14 域）补齐；这里是结构 config 非业务数据。
 */

/** 域 → 设计 token（§5）。14 域与 GRAPH_DOMAIN 对齐。 */
export const DOMAIN_COLORS: Record<string, string> = {
  factory: "var(--c-factory)",
  product: "var(--c-product)",
  process: "var(--c-process)",
  equip: "var(--c-equip)",
  people: "var(--c-people)",
  quality: "var(--c-quality)",
  capacity: "var(--c-capacity)",
  forecast: "var(--c-forecast)",
  // PRD-IND-map 缺口①：补 6 业务域配色（与 GRAPH_DOMAIN 14 域对齐，配置驱动 R14）。
  sales: "#7E8BEE",
  material: "#BC9A63",
  finance: "#DF747E",
  plan: "#B07FD8",
  external: "#D08A66",
  decision: "#54B5C4",
  solver: "var(--c-solver)",
  agent: "var(--c-agent)",
};

export const DOMAIN_LABELS: Record<string, string> = {
  factory: "工厂",
  product: "产品",
  process: "工艺",
  equip: "设备",
  people: "人员",
  quality: "质量",
  capacity: "产能",
  forecast: "预测",
  // PRD-IND-map 缺口①：6 业务域中文名。
  sales: "销售",
  material: "物料",
  finance: "财务",
  plan: "计划",
  external: "外部",
  decision: "决策应用",
  solver: "求解器",
  agent: "Agent",
};

/** 数据来源视角（§7.18 colorBy=source）：源系统着色；派生/求解/智能体不是源数据 → 淡出。 */
export const SOURCE_COLORS: Record<string, string> = {
  ERP: "#5E8FE8",
  MES: "#DD9551",
  IoT: "#43B7D7",
  CRM: "#DD7E9E",
  PLM: "#36BFA5",
  QMS: "#62BE77",
  HR: "#9D8BF0",
  WMS: "#D2B04C",
};

/** colorBy=source 下被视为"非源数据"的来源标记（派生/求解/智能体）→ 淡出。 */
export const NON_SOURCE = new Set(["派生", "求解", "智能体"]);

/** 域配色查色（缺省灰）；调用方可注入自定义表（R14 配置驱动，便于元本体换域表）。 */
export function domainColor(domain: string, table: Record<string, string> = DOMAIN_COLORS): string {
  return table[domain] ?? "var(--muted2)";
}

/** 域中文名查（缺省回原 key）。 */
export function domainLabel(domain: string, table: Record<string, string> = DOMAIN_LABELS): string {
  return table[domain] ?? domain;
}
