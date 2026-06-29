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
  ExternalSignal: "external", // A3.1：外部信号归 external 域
};

/** 数据域分组展示顺序（映射表组头行排序） */
export const DOMAIN_ORDER = [
  "factory", "product", "capacity", "process", "equip", "people", "quality", "forecast", "plan", "solver", "agent",
];

/**
 * A3.1 · 14 业务域参考注册表（配置驱动，R14 可被行业模板覆盖；参考原型 16 域去 solver/agent 计算元域）。
 * 这是业务本体域（区别于本体 §10 系统自我域）的单一来源——给对象类型归域、A4 浏览器分组、
 * 切片规划器 tie-break（域内边优先）、跨域接缝识别共用。新增 5 域：sales/material/finance/external/decision。
 */
export interface BusinessDomain {
  key: string;
  displayName: string;
  color: string;
  /** 该域主对象类型（规划器域内切片 root 候选；空则待业务实体落域）。 */
  primaryTypes: string[];
}
export const BUSINESS_DOMAINS: BusinessDomain[] = [
  { key: "factory", displayName: "工厂/基地", color: "#4C8BF5", primaryTypes: ["Base", "Line"] },
  { key: "product", displayName: "产品/型号", color: "#36BFA5", primaryTypes: ["Model", "Order", "Segment"] },
  { key: "process", displayName: "工艺/工序", color: "#9C6ADE", primaryTypes: ["Process"] },
  { key: "equip", displayName: "设备", color: "#DD9551", primaryTypes: ["Equipment", "MaintPlan"] },
  { key: "people", displayName: "人员/班组", color: "#E2719B", primaryTypes: ["Crew"] },
  { key: "quality", displayName: "质量", color: "#46A758", primaryTypes: ["QualityLot", "DataSourceHealth"] },
  { key: "capacity", displayName: "产能", color: "#3D9AE8", primaryTypes: ["CapacityPyramid", "Shipment"] },
  { key: "forecast", displayName: "预测/需求", color: "#8E6FE8", primaryTypes: ["DemandForecast"] },
  { key: "sales", displayName: "销售/订单", color: "#E5894B", primaryTypes: ["Customer", "ARInvoice"] },
  { key: "material", displayName: "物料/供应", color: "#C2A33B", primaryTypes: ["Material", "MaterialBatch", "PurchaseOrder"] },
  { key: "finance", displayName: "财务/成本", color: "#5BB98C", primaryTypes: [] },
  { key: "plan", displayName: "规划/情景", color: "#7C8CF8", primaryTypes: ["AnnualScenario", "ScenarioTrigger", "PlanTarget"] },
  { key: "external", displayName: "外部信号", color: "#B36AC2", primaryTypes: ["ExternalSignal"] },
  { key: "decision", displayName: "决策/根因", color: "#E5484D", primaryTypes: [] },
];
export const BUSINESS_DOMAIN_KEYS = BUSINESS_DOMAINS.map((d) => d.key);

export const SOLVER_GRAPH: Record<string, { label: string; target: string; ruleRefs: string[] }> = {
  capacity_forecast: { label: "产能推演", target: "Model", ruleRefs: ["C03", "C08", "C09"] },
  risk_timeline: { label: "风险时间线", target: "Base", ruleRefs: ["C05"] },
  affected_orders: { label: "受影响订单", target: "Order", ruleRefs: ["C03", "C13", "C15", "C06/C16"] },
  plan_audit: { label: "规划体检", target: "Order", ruleRefs: ["C15", "C18", "C21", "C23"] },
  plan_generate: { label: "方案生成", target: "Base", ruleRefs: ["C15", "C18"] },
  capacity_rollup: { label: "产能金字塔", target: "Base", ruleRefs: ["C01", "C02"] },
  bottleneck_matrix: { label: "瓶颈矩阵", target: "Line", ruleRefs: [] },
  capex_scenario: { label: "年度情景测算", target: "AnnualScenario", ruleRefs: ["C18", "C23"] },
};

/** 连接器 → 源系统显示名（映射表「源系统」列 + 图谱 source 视角图例） */
export const CONN_SYSTEM: Record<string, string> = {
  "conn-mes": "MES",
  "conn-erp": "ERP",
  "conn-plm": "PLM",
  "conn-iot": "IoT/SCADA",
  "conn-srm": "SRM",
};

/**
 * WO-7：对象类型 → 真实来源系统（DataSourceHealth.sourceId 命名空间）的权威归因。
 *
 * 背景：demo 全部对象经"单一合成连接器"物化（provenance 真实——确实只有一个合成数据源），
 * 故图谱 sourceBindings.connId 对 9 业务源系统恒不匹配 → 来源系统总览逐源对象数恒 0。
 * 此表按"该数据类别在制造业 IT 架构中的真实系统主"归因（SCADA 实时遥测 / MES 生产执行 /
 * ERP 销售财务计划 / SRM 供应商协同 / PLM 型号认证 / WMS 仓储物料 / QMS 质量 / EMS 能耗），
 * 是真实业务建模而非伪造数字。未列入的类型（派生/决策/外部信号）= 无内部源系统主 → 前端
 * 归"派生/求解器/智能体"诚实单列。
 *
 * 注：这是"源系统归属"业务事实，独立于合成 provenance 管道（后者诚实=单一合成连接器）。
 */
export const TYPE_SOURCE_SYSTEM: Record<string, string> = {
  // iot-scada：设备实时遥测
  Equipment: "iot-scada",
  // mes：生产执行（基地/产线/工序/检修）
  Base: "mes", Line: "mes", Process: "mes", MaintPlan: "mes",
  // erp：销售/财务/计划/情景
  Order: "erp", Segment: "erp", Customer: "erp", ARInvoice: "erp", DemandSegment: "erp",
  FinancePlan: "erp", FinanceAccount: "erp", FinanceMetric: "erp", SopVersionRow: "erp",
  AnnualScenario: "erp", ScenarioTrigger: "erp", PlanTarget: "erp", CapexProject: "erp",
  // srm：供应商协同（在途/采购）
  Shipment: "srm", PurchaseOrder: "srm",
  // plm：型号/认证/换型
  Model: "plm", Certification: "plm", ChangeoverMatrix: "plm",
  // wms：仓储/物料
  Material: "wms", MaterialBatch: "wms", MaterialBalance: "wms",
  // qms：质量（数据源健康监控属质量管理体系）
  DataSourceHealth: "qms", QualityLot: "qms",
  // ems：能耗/碳
  EnergyMeter: "ems", CarbonFactor: "ems",
  // lims（实验室）：电芯实验室检测（WO-7 9/9·正门合成的真实 LIMS 源对象）
  LabTest: "lims",
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
