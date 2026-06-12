/**
 * 图谱/映射表共享元数据（前端 PRD §7.2/§7.18/§7.20）。
 * - 节点 domain 着色 + 源系统名映射（colorBy="source" 视角与映射表血缘列共用）
 * - 求解器节点注册（图谱 calc 边 + 映射表 kind="solver" 行）
 * - §7.18 学习闭环/智能体网络所需的概念节点与 fb/orch/agg 边
 */

export const GRAPH_DOMAIN: Record<string, string> = {
  Base: "factory", Line: "factory", Process: "process", Equipment: "equip", MaintPlan: "equip",
  Order: "product", Model: "product", Segment: "product", Shipment: "capacity",
  DataSourceHealth: "quality", CapacityPyramid: "capacity", DemandForecast: "forecast",
  Crew: "people", QualityLot: "quality",
  AnnualScenario: "plan", ScenarioTrigger: "plan", PlanTarget: "plan",
};

/** 数据域分组展示顺序（映射表组头行排序） */
export const DOMAIN_ORDER = [
  "factory", "product", "capacity", "process", "equip", "people", "quality", "forecast", "plan", "solver", "agent",
];

export const SOLVER_GRAPH: Record<string, { label: string; target: string; ruleRefs: string[] }> = {
  capacity_forecast: { label: "产能推演", target: "Model", ruleRefs: ["C03", "C08", "C09"] },
  risk_timeline: { label: "风险时间线", target: "Base", ruleRefs: ["C05"] },
  affected_orders: { label: "受影响订单", target: "Order", ruleRefs: ["C03", "C13", "C15", "C06/C16"] },
  plan_audit: { label: "规划体检", target: "Order", ruleRefs: ["C15", "C18", "C21", "C23"] },
  plan_generate: { label: "方案生成", target: "Base", ruleRefs: ["C15", "C18"] },
  capacity_rollup: { label: "产能金字塔", target: "Base", ruleRefs: ["C01", "C02"] },
  bottleneck_matrix: { label: "瓶颈矩阵", target: "Line", ruleRefs: [] },
};

/** 连接器 → 源系统显示名（映射表「源系统」列 + 图谱 source 视角图例） */
export const CONN_SYSTEM: Record<string, string> = {
  "conn-mes": "MES",
  "conn-erp": "ERP",
  "conn-plm": "PLM",
  "conn-iot": "IoT/SCADA",
  "conn-srm": "SRM",
};

/** 映射表 kind="agent" 行（静态种子清单；AgentCore 侧注册表为运行态来源） */
export const AGENT_SEEDS: { key: string; displayName: string; summary: string }[] = [
  { key: "learning-agent", displayName: "学习Agent", summary: "经验回流：偏差→校准提案→经验记忆库" },
  { key: "risk-agent", displayName: "风险预警Agent", summary: "风险时间线越线 → 通知/挂牌触发" },
  { key: "report-agent", displayName: "报告生成Agent", summary: "规划体检/方案对比报告编排" },
];

export interface GraphExtraNode {
  id: string;
  key: string;
  label: string;
  kind: string; // solver | agent | metric
  domain: string;
  source?: string;
}

/**
 * §7.18 学习闭环视角节点（nodeFilter.ids 一字不差地命中这些 id）+ 智能体网络节点。
 * id 直接使用中文概念名 —— 视角 ViewConfig 的 nodeFilter.ids 与此对齐。
 */
export const GRAPH_EXTRA_NODES: GraphExtraNode[] = [
  { id: "产能预测", key: "capacity_forecast", label: "产能预测", kind: "solver", domain: "solver" },
  { id: "聚合求解器", key: "ts_aggregate", label: "聚合求解器", kind: "solver", domain: "solver" },
  { id: "精度校准器", key: "calibrator", label: "精度校准器", kind: "solver", domain: "solver" },
  { id: "学习Agent", key: "learning-agent", label: "学习Agent", kind: "agent", domain: "agent" },
  { id: "经验记忆库", key: "memory-store", label: "经验记忆库", kind: "agent", domain: "agent" },
  { id: "风险预警Agent", key: "risk-agent", label: "风险预警Agent", kind: "agent", domain: "agent" },
  { id: "报告生成Agent", key: "report-agent", label: "报告生成Agent", kind: "agent", domain: "agent" },
  { id: "实际产出", key: "output:line", label: "实际产出", kind: "metric", domain: "capacity", source: "IoT/SCADA" },
  { id: "良率", key: "yield:process", label: "良率", kind: "metric", domain: "quality", source: "MES" },
  { id: "OEE历史", key: "oee:equip", label: "OEE历史", kind: "metric", domain: "equip", source: "IoT/SCADA" },
  { id: "OEE指标", key: "oee_current", label: "OEE指标", kind: "metric", domain: "equip", source: "IoT/SCADA" },
  { id: "工序产能", key: "process_capacity", label: "工序产能", kind: "metric", domain: "process", source: "MES" },
];

export interface GraphExtraEdge {
  from: string;
  to: string;
  kind: string; // flow | agg | fb | orch
  label: string;
}

export const GRAPH_EXTRA_EDGES: GraphExtraEdge[] = [
  // 学习闭环（fb = 反馈，orch = 编排）
  { from: "实际产出", to: "精度校准器", kind: "fb", label: "实际 vs 预测" },
  { from: "产能预测", to: "精度校准器", kind: "fb", label: "预测留痕" },
  { from: "精度校准器", to: "工序产能", kind: "fb", label: "参数回写" },
  { from: "经验记忆库", to: "产能预测", kind: "fb", label: "经验回流" },
  { from: "学习Agent", to: "精度校准器", kind: "orch", label: "校准编排" },
  { from: "学习Agent", to: "经验记忆库", kind: "orch", label: "经验写入" },
  { from: "风险预警Agent", to: "n-solver-risk_timeline", kind: "orch", label: "风险编排" },
  { from: "报告生成Agent", to: "n-solver-plan_audit", kind: "orch", label: "报告编排" },
  // 聚合/推演网络（agg/flow）
  { from: "OEE历史", to: "OEE指标", kind: "agg", label: "7d 加权聚合" },
  { from: "聚合求解器", to: "OEE指标", kind: "agg", label: "TS_AGGREGATE" },
  { from: "聚合求解器", to: "实际产出", kind: "agg", label: "日产出聚合" },
  { from: "良率", to: "工序产能", kind: "agg", label: "良率折损" },
  { from: "OEE指标", to: "工序产能", kind: "flow", label: "OEE 输入" },
  { from: "n-Equipment", to: "工序产能", kind: "flow", label: "设备节拍" },
  { from: "工序产能", to: "产能预测", kind: "flow", label: "产能输入" },
  { from: "n-Line", to: "实际产出", kind: "flow", label: "产线产出" },
];
