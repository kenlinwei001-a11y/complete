import type { DataCategory } from "@platform/contracts";

/**
 * 数据接入分类（行业域包：锂电制造）。把"目前的数据"（本体对象类型）按业务域归类，
 * 使数据接入控制台不再是一张扁平连接列表，而是按 销售订单/物料/设备台账… 组织；
 * 每类可设 系统对接 或 文件上传，文件上传走该类对象类型派生的字段模版（可看可下载）。
 *
 * 设计原则：① 覆盖全部出厂对象类型（每个类型恰好归入一类，"合并到对应分类"完整）；
 * ② 锂电术语命名（基于锂电制造价值链：销售→计划→客户→产品→产能→工艺→设备→物料→采购→质量→财务→外部）；
 * ③ 行业可扩展（其它行业另给 manifest），非写死在应用/视图层（R14：业务常数留在域包）。
 */
export function batteryDataCategories(): DataCategory[] {
  const BOTH = ["SYSTEM_INTEGRATION", "FILE_UPLOAD"] as const;
  return [
    {
      key: "sales_orders", displayName: "销售订单", description: "客户下达的电池销售订单（型号/数量/交期/状态）。",
      typeKeys: ["Order"], modes: [...BOTH], defaultMode: "SYSTEM_INTEGRATION", connectorTypeKeys: ["sap_erp", "salesforce_crm", "rest_api", "file_upload"],
    },
    {
      key: "demand_forecast", displayName: "销售预测与计划", description: "需求预测、年度情景与触发条件、计划目标（驱动产能/排产推演）。",
      typeKeys: ["PlanTarget", "AnnualScenario", "ScenarioTrigger", "DemandSegment", "SopVersionRow", "PipelineOpportunity"], modes: [...BOTH], defaultMode: "FILE_UPLOAD", connectorTypeKeys: ["file_upload", "rest_api"],
    },
    {
      key: "customer_ar", displayName: "客户与应收", description: "客户主数据（信用/账期）与应收发票。",
      typeKeys: ["Customer", "ARInvoice"], modes: [...BOTH], defaultMode: "SYSTEM_INTEGRATION", connectorTypeKeys: ["salesforce_crm", "sap_erp", "file_upload"],
    },
    {
      key: "commercial_intelligence", displayName: "商务情报", description: "竞品份额/价格、投标记录、赢丢单与价格实现（市场份额与营收根因下钻真源）。",
      typeKeys: ["CompetitorShare", "CompetitorPrice", "BidRecord", "WinLossRecord", "PriceRealization"], modes: [...BOTH], defaultMode: "FILE_UPLOAD", connectorTypeKeys: ["file_upload", "rest_api"],
    },
    {
      key: "product_master", displayName: "产品主数据", description: "产品平台、系列、型号、版本与应用细分（毛利率口径）及工程变更。",
      typeKeys: ["ProductPlatform", "ProductSeries", "Model", "Segment", "ProductVersion", "EngineeringChange"], modes: [...BOTH], defaultMode: "FILE_UPLOAD", connectorTypeKeys: ["file_upload", "sap_erp", "rest_api"],
    },
    {
      key: "capacity_base", displayName: "产能与基地", description: "生产基地、车间、产线、产能投资项目及产品-产线/设备制造能力。",
      typeKeys: ["Base", "Workshop", "Line", "CapexProject", "ProductLineCapability", "ProductEquipmentCapability"], modes: [...BOTH], defaultMode: "SYSTEM_INTEGRATION", connectorTypeKeys: ["sap_erp", "generic_jdbc", "file_upload"],
    },
    {
      key: "production_execution", displayName: "生产执行", description: "生产工单、排程、班次计划与在制（WIP）批次/移动/质检点（MES 生产执行域）。",
      typeKeys: ["WorkOrder", "ProductionSchedule", "ShiftPlan", "WIPLot", "WIPMove", "WIPQualityCheckpoint"], modes: [...BOTH], defaultMode: "SYSTEM_INTEGRATION", connectorTypeKeys: ["generic_jdbc", "rest_api", "file_upload"],
    },
    {
      key: "process_routing", displayName: "工艺路线与工序", description: "工艺路线、工序定义、工艺能力边界及换型矩阵（瓶颈/换型排序推演）。",
      typeKeys: ["Process", "ChangeoverMatrix", "Routing", "Operation", "ProcessCapabilityWindow"], modes: [...BOTH], defaultMode: "FILE_UPLOAD", connectorTypeKeys: ["file_upload", "generic_jdbc", "rest_api"],
    },
    {
      key: "equipment_ledger", displayName: "设备与能耗", description: "设备台账 OEE、停机/告警、检修计划、维修工单、备件消耗与能耗计量（MES/IoT）。",
      typeKeys: ["Equipment", "MaintPlan", "EnergyMeter", "EquipmentOEE", "EquipmentDowntime", "EquipmentAlarm", "MaintenanceOrder", "SparePartConsumption"], modes: [...BOTH], defaultMode: "SYSTEM_INTEGRATION", connectorTypeKeys: ["generic_jdbc", "rest_api", "file_upload"],
    },
    {
      key: "material_inventory", displayName: "物料与库存", description: "物料主数据、BOM、物料替代关系、批次库存及物料平衡（断供/集中度推演）。",
      typeKeys: ["Material", "MaterialBatch", "MaterialBalance", "BOMHeader", "BOMDetail", "MaterialAlternative"], modes: [...BOTH], defaultMode: "SYSTEM_INTEGRATION", connectorTypeKeys: ["sap_erp", "generic_jdbc", "file_upload"],
    },
    {
      key: "procurement", displayName: "采购与供应商", description: "供应商主数据、采购订单、在途批次、长期协议与备份供应商池（到货延误/缺料/断供备份推演）。",
      typeKeys: ["Supplier", "PurchaseOrder", "Shipment", "LongTermAgreement", "BackupSupplierPool"], modes: [...BOTH], defaultMode: "SYSTEM_INTEGRATION", connectorTypeKeys: ["sap_erp", "rest_api", "file_upload"],
    },
    {
      key: "quality_compliance", displayName: "质量与合规", description: "质量标准、检验特性、质检批次/检验结果/缺陷记录、数据源健康度与产品认证（合规/碳护照前置）。",
      typeKeys: ["QualityStandard", "InspectionCharacteristic", "QualityLot", "InspectionResult", "DefectRecord", "DataSourceHealth", "Certification"], modes: [...BOTH], defaultMode: "FILE_UPLOAD", connectorTypeKeys: ["file_upload", "rest_api"],
    },
    {
      key: "finance_carbon", displayName: "财务与碳", description: "基地财务账户、情景财务指标、财务预算（收入/成本/毛利）、应收账龄/DSO/逾期记录与碳因子。",
      typeKeys: ["FinanceAccount", "FinanceMetric", "CarbonFactor", "FinancePlan", "ARAging", "DSO", "OverdueRecord"], modes: [...BOTH], defaultMode: "SYSTEM_INTEGRATION", connectorTypeKeys: ["sap_erp", "generic_jdbc", "file_upload"],
    },
    {
      key: "external_signal", displayName: "外部信号", description: "锂价/镍价/汇率/需求指数/政策等市场与环境信号，及大宗商品价格趋势（矿价逐周涨幅）。",
      typeKeys: ["ExternalSignal", "CommodityPriceTrend"], modes: [...BOTH], defaultMode: "SYSTEM_INTEGRATION", connectorTypeKeys: ["external_feed", "mock_external", "rest_api"],
    },
    {
      key: "decision_cockpit", displayName: "经营决策驾驶舱", description: "经营指标库/KSF/责任主体、根因归因模板与深度归因因果域（决策缺陷/因果因素/触发规则；目标-指标-责任骨架，驱动各视图 KPI · 根因 DAG · 决策推演）。",
      typeKeys: ["Metric", "KSF", "Principal", "RootCauseChain", "DecisionGap", "CausalFactor", "TriggerRule",
        // WO-CEO-DATA-2：每指标因果域 drill 真对象（市场份额/营收/现金/需求达成）。
        "CompetitorShare", "BidRecord", "CompetitorPrice", "PipelineOpportunity", "WinLossRecord", "PriceRealization", "ARAging", "DSO", "OverdueRecord"],
      modes: [...BOTH], defaultMode: "FILE_UPLOAD", connectorTypeKeys: ["file_upload", "rest_api"],
    },
    {
      key: "workforce", displayName: "人力与班组", description: "操作工考勤与技能认证（MES 人力执行域，班组排产/技能匹配前置）。",
      typeKeys: ["OperatorAttendance", "OperatorSkillCert"], modes: [...BOTH], defaultMode: "SYSTEM_INTEGRATION", connectorTypeKeys: ["generic_jdbc", "rest_api", "file_upload"],
    },
  ];
}

/** 行业 → 数据分类清单（目前仅锂电；其它行业可加 manifest）。 */
export function dataCategoriesForIndustry(_industry?: string): DataCategory[] {
  return batteryDataCategories();
}

/**
 * 字段覆盖切片（铁律："所有字段实体都需被至少一个本体切片覆盖"）：为每个分类下的对象类型生成一个
 * 单实体全字段切片（root=该类型、selector 取全、无 hop → 返回该类型全部对象的全部字段）。
 * 这既保证 100% 字段覆盖（切片字段覆盖检查），又是有用的"按类型全字段浏览/导出"能力。确定性 R6。
 */
export function batteryCoverageSlices(): { sliceKey: string; version: number; spec: import("../domain.js").SliceSpecRecord["spec"] }[] {
  const typeKeys = [...new Set(batteryDataCategories().flatMap((c) => c.typeKeys))].sort();
  return typeKeys.map((tk) => ({
    sliceKey: `coverage_${tk.toLowerCase()}`,
    version: 1,
    spec: { root: { typeKey: tk, selector: {} }, paths: [], maxNodes: 2000 },
  }));
}
