import type { ObjectTypeDef, PropertyDef } from "../domain.js";
import { WAVE1_SCALE_FACTOR } from "@platform/contracts";
import { mulberry32, round } from "../prng.js";

/**
 * 20 场景目录 §7 GenSpec 扩展（成熟度 E6b）：为 13 个新求解器确定性生成所需对象数据，
 * 让场景从 presetContext 即可端到端出结果（无需手传 args）。
 *
 * 确定性：同 seed 字节级一致（mulberry32 派生子流，无时钟/随机）。§7 戏剧点植入：
 * 商用车集团G 逾期 38 天｜6 批 >90 日呆滞｜成都 4680-NCM 碳超标｜2 单 PO 延迟。
 */

const p = (propKey: string, dataType: PropertyDef["dataType"] = "number", isPrimaryKey = false): PropertyDef => ({
  propKey,
  dataType,
  isPrimaryKey,
});

type TypeDef = Omit<ObjectTypeDef, "id" | "tenantId" | "version" | "status">;
const def = (key: string, displayName: string, domain: string, props: PropertyDef[]): TypeDef => ({
  key,
  displayName,
  domain,
  properties: props,
  derivedProperties: [],
  sourceBindings: [],
});

export function extendedObjectTypes(): TypeDef[] {
  return [
    // Phase 2 Wave 2：扩展 Material 属性 + 新增 Supplier（供应链支撑）
    def("Material", "物料", "supply", [
      p("matId", "string", true), p("name", "string"), p("unitPrice"), p("leadTime"), p("carbonFactor"), p("bomUnit"), p("dailyUse"), p("onHand"), p("inTransit"), p("devPct"), p("outsourceYield"),
      p("materialCode", "string"), p("category", "enum"), p("spec", "string"), p("unit", "string"),
      { propKey: "supplierId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Supplier" },
      p("shelfLife"), p("isKeyMaterial", "boolean"), p("status", "enum"),
    ]),
    def("Supplier", "供应商", "supply", [
      p("supplierId", "string", true), p("supplierCode", "string"), p("name", "string"), p("category", "enum"),
      p("materialType", "enum"), p("rating", "enum"), p("region", "string"), p("leadTime"), p("minOrderQty"), p("onTimeRate"), p("status", "enum"),
      // WO-CEO-2：供货量字段（actual<contracted = 上游减供·因果链一环·gap_attribution 叶级真值）
      p("contractedSupplyTon"), p("actualSupplyTon"),
      // WO-CEO-DATA-2：真源供货履约字段（ERP/SRM 接入后 provenanceSynthetic 翻真）。
      p("deliveryDate", "string"), p("poNumber", "string"),
    ]),
    // WO-CEO-2 供应链/地缘/决策域（gap_attribution 深度反向归因·因果链实体·§0 案例落成真对象）：
    def("LongTermAgreement", "长期协议", "supply", [
      p("ltaId", "string", true), p("supplierId", "string"), p("materialType", "enum"),
      p("contractedQtyTon"), p("actualDeliveredTon"), p("priceLinked", "boolean"), p("breachPenaltyWan"),
      // WO-CEO-DATA-2：真合同字段（真源前标灰）。
      p("priceFormula", "string"), p("effectiveDate", "string"), p("expiryDate", "string"), p("deliveryDate", "string"), p("poNumber", "string"),
    ]),
    def("BackupSupplierPool", "备份供应池", "supply", [
      p("poolId", "string", true), p("materialType", "enum"), p("memberCount"), p("certWeeks"), p("procureFreqPerYear"),
    ]),
    def("CommodityPriceTrend", "矿产价格趋势", "external", [
      p("trendId", "string", true), p("commodity", "string"), p("weekOf", "string"), p("pricePerTon"), p("pctChange"),
      // WO-CEO-DATA-2：真行情溯源字段。
      p("source", "string"), p("spec", "string"), p("currency", "string"),
    ]),
    def("DecisionGap", "决策缺陷", "decision", [
      p("gapId", "string", true), p("kind", "enum"), p("description", "string"), p("severity"), p("ownerRef", "string"),
      // WO-CEO-DATA-2：评审录入溯源。
      p("reviewDate", "string"), p("evidence", "string"),
    ]),
    // WO-CEO-DATA-2 · 每指标多假设因果域 drill 真对象（市场份额 / 营收 / 现金 / 需求达成）。
    def("CompetitorShare", "竞品份额", "commercial", [
      p("shareId", "string", true), p("competitor", "string"), p("segment", "string"), p("sharePct"), p("period", "string"),
    ]),
    def("BidRecord", "投标记录", "commercial", [
      p("bidId", "string", true), p("segment", "string"), p("win", "boolean"), p("lossReason", "string"), p("amount"), p("competitorRef", "string"),
    ]),
    def("CompetitorPrice", "竞品价格", "commercial", [
      p("priceId", "string", true), p("competitor", "string"), p("model", "string"), p("pricePerKwh"), p("period", "string"),
    ]),
    def("PipelineOpportunity", "商机漏斗", "commercial", [
      p("oppId", "string", true), p("segment", "string"), p("stage", "string"), p("amount"), p("winProb"),
    ]),
    def("WinLossRecord", "赢丢单记录", "commercial", [
      p("oppId", "string", true), p("result", "enum"), p("reason", "string"),
    ]),
    def("PriceRealization", "价格实现", "commercial", [
      p("realizationId", "string", true), p("model", "string"), p("listPrice"), p("realizedPrice"), p("period", "string"),
    ]),
    def("ARAging", "应收账龄", "finance", [
      p("agingId", "string", true), p("customerRef", "string"), p("bucket", "string"), p("amount"),
    ]),
    def("DSO", "DSO", "finance", [
      p("dsoId", "string", true), p("segment", "string"), p("days"), p("period", "string"),
    ]),
    def("OverdueRecord", "逾期记录", "finance", [
      p("overdueId", "string", true), p("invoiceRef", "string"), p("overdueDays"), p("customerRef", "string"),
    ]),
    // 因果因素节点（caused_by 遍历的一等节点·每个下钻到真证据对象·结构叶→地缘/决策终点）：
    def("CausalFactor", "因果因素", "decision", [
      p("factorId", "string", true), p("label", "string"), p("drillType", "string"), p("drillId", "string"),
      p("drillField", "string"), p("kind", "enum"), p("isRoot", "boolean"), p("provenanceSynthetic", "boolean"),
      // WO-METRIC-AWARE-SEAM：该因果因素是哪些 Metric 的**归因起点（结构入口/gap 节点）**——gap_attribution 按
      // metric.key 命中 boundMetricKeys → 从此节点起 BFS 沿 caused_by 遍历到域根（isRoot 叶）。空/缺 = 无绑定
      // （引擎回落默认结构入口 cf-cathode-shortage·供应类 metric 现行行为不破）。种绑定=本 WO（数据×引擎一套机制）。
      p("boundMetricKeys", "json"),
    ]),
    // WO-CEO-3 触发规则（信号阈值→行动·一等可编辑·阈值可被 RuleEntry.params 覆盖·decision_play 引擎评估）：
    def("TriggerRule", "触发规则", "decision", [
      p("triggerId", "string", true), p("signalRef", "string"), p("op", "enum"), p("threshold"),
      p("action", "string"), p("actionDetail", "string"), p("cfgRuleKey", "string"),
    ]),
    def("MaterialBatch", "物料批次", "supply", [p("batchId", "string", true), p("matId", "string"), p("qty"), p("ageDays"), p("idleDays")]),
    def("Customer", "客户", "commercial", [p("custId", "string", true), p("custName", "string"), p("creditLimit"), p("termDays"), p("receivables"), p("wipUnbilled"), p("maxOverdueDays")]),
    def("ARInvoice", "应收发票", "commercial", [p("invoiceId", "string", true), p("custName", "string"), p("amount"), p("overdueDays")]),
    def("Certification", "认证", "factory", [p("certId", "string", true), p("modelId", "string"), p("lineId", "string"), p("status", "string"), p("certHours"), p("gapContribution")]),
    def("EnergyMeter", "能耗计量", "factory", [p("meterId", "string", true), p("baseId", "string"), p("processKey", "string"), p("energyPerUnit"), p("gridFactor")]),
    def("ChangeoverMatrix", "换型矩阵", "factory", [p("pairId", "string", true), p("fromModel", "string"), p("toModel", "string"), p("minutes")]),
    def("CapexProject", "产能投资项目", "plan", [p("projectId", "string", true), p("name", "string"), p("irr"), p("util24"), p("c23pass", "boolean")]),
    def("PurchaseOrder", "采购订单", "supply", [p("poId", "string", true), p("matId", "string"), p("qty"), p("etaDay"), p("delayed", "boolean")]),
    def("CarbonFactor", "碳因子", "supply", [p("factorId", "string", true), p("kind", "string"), p("key", "string"), p("factor")]),
    // Phase5A 财务域：基地现金账户 + 情景级财务指标（让 finance 进切片，凑满 9 域）。
    def("FinanceAccount", "基地财务账户", "finance", [p("accId", "string", true), p("baseId", "string"), p("cashOnHand"), p("receivable"), p("payable"), p("workingCapital")]),
    def("FinanceMetric", "情景财务指标", "finance", [p("metricId", "string", true), p("scenarioKey", "string"), p("cashCushion"), p("irr"), p("capexSpent"), p("netMargin")]),
    // 外部域（EXT_SIG）：环境/市场信号一等对象（domain=external；规划敏感性输入 P2）。
    def("ExternalSignal", "外部信号", "external", [p("signalKey", "string", true), p("name", "string"), p("category", "string"), p("value"), p("unit", "string"), p("asOf", "string"), p("source", "string"), p("trend", "string"), p("impact", "string"), p("elasticity"), p("eventRef", "string")]),
  ];
}

const MATERIALS = [
  { matId: "pos_ncm", name: "三元正极", base: 180, materialCode: "MAT-001", category: "正极材料", spec: "NCM811", unit: "kg", isKey: true, supplierIds: ["SUP-001", "SUP-002"] },
  { matId: "pos_lfp", name: "磷酸铁锂正极", base: 95, materialCode: "MAT-002", category: "正极材料", spec: "LFP-100", unit: "kg", isKey: true, supplierIds: ["SUP-001", "SUP-003"] },
  { matId: "neg_graphite", name: "石墨负极", base: 60, materialCode: "MAT-003", category: "负极材料", spec: "人造石墨", unit: "kg", isKey: true, supplierIds: ["SUP-004", "SUP-005"] },
  { matId: "sep_film", name: "隔膜", base: 28, materialCode: "MAT-004", category: "隔膜", spec: "湿法隔膜", unit: "㎡", isKey: true, supplierIds: ["SUP-006", "SUP-007"] },
  { matId: "elyte", name: "电解液", base: 45, materialCode: "MAT-005", category: "电解液", spec: "高电压电解液", unit: "L", isKey: true, supplierIds: ["SUP-008", "SUP-009"] },
  { matId: "cu_foil", name: "铜箔", base: 70, materialCode: "MAT-006", category: "其他", spec: "6μm铜箔", unit: "kg", isKey: false, supplierIds: ["SUP-010"] },
  { matId: "al_foil", name: "铝箔", base: 32, materialCode: "MAT-007", category: "其他", spec: "12μm铝箔", unit: "kg", isKey: false, supplierIds: ["SUP-011"] },
  { matId: "cell_case", name: "电芯壳体", base: 18, materialCode: "MAT-008", category: "结构件", spec: "4680壳体", unit: "个", isKey: true, supplierIds: ["SUP-012", "SUP-013"] },
];

const SUPPLIERS = [
  { supplierId: "SUP-001", supplierCode: "RBKJ", name: "容百科技", category: "原材料", materialType: "正极", rating: "S", region: "华东", leadTime: 5, minOrderQty: 1000, onTimeRate: 0.98, status: "合格" },
  { supplierId: "SUP-002", supplierCode: "DSKJ", name: "当升科技", category: "原材料", materialType: "正极", rating: "A", region: "华北", leadTime: 7, minOrderQty: 800, onTimeRate: 0.95, status: "合格" },
  { supplierId: "SUP-003", supplierCode: "CYLK", name: "长远锂科", category: "原材料", materialType: "正极", rating: "B", region: "华中", leadTime: 8, minOrderQty: 600, onTimeRate: 0.92, status: "观察" },
  { supplierId: "SUP-004", supplierCode: "BTR", name: "贝特瑞", category: "原材料", materialType: "负极", rating: "S", region: "华南", leadTime: 4, minOrderQty: 1200, onTimeRate: 0.97, status: "合格" },
  { supplierId: "SUP-005", supplierCode: "SSGF", name: "杉杉股份", category: "原材料", materialType: "负极", rating: "A", region: "华东", leadTime: 6, minOrderQty: 900, onTimeRate: 0.94, status: "合格" },
  { supplierId: "SUP-006", supplierCode: "EJGF", name: "恩捷股份", category: "原材料", materialType: "隔膜", rating: "S", region: "西南", leadTime: 5, minOrderQty: 1000, onTimeRate: 0.96, status: "合格" },
  { supplierId: "SUP-007", supplierCode: "XYCZ", name: "星源材质", category: "原材料", materialType: "隔膜", rating: "A", region: "华南", leadTime: 7, minOrderQty: 700, onTimeRate: 0.93, status: "合格" },
  { supplierId: "SUP-008", supplierCode: "TCSZ", name: "天赐材料", category: "原材料", materialType: "电解液", rating: "S", region: "华东", leadTime: 4, minOrderQty: 1500, onTimeRate: 0.98, status: "合格" },
  { supplierId: "SUP-009", supplierCode: "XZB", name: "新宙邦", category: "原材料", materialType: "电解液", rating: "A", region: "华南", leadTime: 6, minOrderQty: 1000, onTimeRate: 0.95, status: "合格" },
  { supplierId: "SUP-010", supplierCode: "NDF", name: "诺德股份", category: "原材料", materialType: "其他", rating: "A", region: "华东", leadTime: 5, minOrderQty: 800, onTimeRate: 0.94, status: "合格" },
  { supplierId: "SUP-011", supplierCode: "DKS", name: "鼎胜新材", category: "原材料", materialType: "其他", rating: "A", region: "华中", leadTime: 6, minOrderQty: 700, onTimeRate: 0.93, status: "合格" },
  { supplierId: "SUP-012", supplierCode: "KDL", name: "科达利", category: "原材料", materialType: "结构件", rating: "S", region: "华南", leadTime: 3, minOrderQty: 2000, onTimeRate: 0.99, status: "合格" },
  { supplierId: "SUP-013", supplierCode: "ZYZY", name: "震裕科技", category: "原材料", materialType: "结构件", rating: "A", region: "华东", leadTime: 5, minOrderQty: 1000, onTimeRate: 0.96, status: "合格" },
  { supplierId: "SUP-014", supplierCode: "LYGF", name: "凌云股份", category: "原材料", materialType: "结构件", rating: "B", region: "华北", leadTime: 8, minOrderQty: 500, onTimeRate: 0.91, status: "观察" },
];

// WO-CEO-2 供货量约定（正极 3 家植入减供：actual<contracted → 上游减供因果一环·常数不消耗 rng·R6）。
const CATHODE_CONTRACT: Record<string, number> = { "SUP-001": 8000, "SUP-002": 6000, "SUP-003": 4000 };

// WO-CEO-2 长协：正极供应商约定量/实际交付/价格联动条款/违约成本（actual<contracted=违约·因果链一环）。
const LONG_TERM_AGREEMENTS = [
  { ltaId: "lta-lfp-rbkj", supplierId: "SUP-001", materialType: "正极", contractedQtyTon: 8000, actualDeliveredTon: 7200, priceLinked: false, breachPenaltyWan: 320 },
  { ltaId: "lta-lfp-cylk", supplierId: "SUP-003", materialType: "正极", contractedQtyTon: 4000, actualDeliveredTon: 3400, priceLinked: false, breachPenaltyWan: 180 },
  { ltaId: "lta-ncm-dskj", supplierId: "SUP-002", materialType: "正极", contractedQtyTon: 6000, actualDeliveredTon: 5850, priceLinked: true, breachPenaltyWan: 60 },
];

// WO-CEO-2 备份供应池：正极池薄（成员少+认证周期长 → 断供无替代 → root=认证周期长）。
const BACKUP_SUPPLIER_POOLS = [
  { poolId: "pool-cathode", materialType: "正极", memberCount: 2, certWeeks: 16, procureFreqPerYear: 2 },
  { poolId: "pool-anode", materialType: "负极", memberCount: 4, certWeeks: 8, procureFreqPerYear: 4 },
];

// WO-CEO-2 矿价趋势：碳酸锂逐周上涨（地缘冲突推升 → 上游成本 → 减供/违约）。R6：常数。
const COMMODITY_PRICE_TRENDS = [
  { trendId: "licarb-w1", commodity: "碳酸锂", weekOf: "2026-06-01", pricePerTon: 84000, pctChange: 3.2 },
  { trendId: "licarb-w2", commodity: "碳酸锂", weekOf: "2026-06-08", pricePerTon: 88500, pctChange: 5.4 },
  { trendId: "licarb-w3", commodity: "碳酸锂", weekOf: "2026-06-15", pricePerTon: 92800, pctChange: 4.9 },
  { trendId: "licarb-w4", commodity: "碳酸锂", weekOf: "2026-06-22", pricePerTon: 96000, pctChange: 3.4 },
];

// WO-CEO-2 决策缺陷：因果链终点（前瞻缺失/条款缺失·可归的最终根）。
const DECISION_GAPS = [
  { gapId: "dgap-forecast", kind: "前瞻缺失", description: "矿价前瞻缺失：未预判地缘冲突推升锂价，长协未设价格联动条款", severity: 0.8, ownerRef: "prin-procure", reviewDate: "2026-06-10", evidence: "长协无价格联动条款" },
  { gapId: "dgap-clause", kind: "条款缺失", description: "长协无违约追偿/替代激活条款，断供时无兜底", severity: 0.6, ownerRef: "prin-procure", reviewDate: "2026-06-10", evidence: "备份池仅2家" },
];

// WO-CEO-DATA-2 · 每指标多假设因果域（market_share / revenue / cash / demand_attain）。
// 因果方向：caused_by 从「果」指向「因」（share_gap --caused_by--> bid_loss ...）。
const SUPPLY_CAUSAL_FACTORS = [
  { factorId: "cf-cathode-shortage", label: "正极粉短缺", drillType: "MaterialBalance", drillId: "mbal-2", drillField: "gapTon", kind: "派生", isRoot: false, provenanceSynthetic: false },
  { factorId: "cf-upstream-cut", label: "上游减供", drillType: "Supplier", drillId: "SUP-003", drillField: "actualSupplyTon", kind: "实测", isRoot: false, provenanceSynthetic: false },
  { factorId: "cf-lta-breach", label: "长协违约", drillType: "LongTermAgreement", drillId: "lta-lfp-cylk", drillField: "actualDeliveredTon", kind: "派生", isRoot: false, provenanceSynthetic: false },
  { factorId: "cf-ore-price", label: "锂价上涨", drillType: "CommodityPriceTrend", drillId: "licarb-w4", drillField: "pctChange", kind: "外部信号", isRoot: false, provenanceSynthetic: true },
  { factorId: "cf-geopolitical", label: "地缘冲突推升矿价", drillType: "ExternalSignal", drillId: "li_carbonate_price", drillField: "value", kind: "外部信号", isRoot: false, provenanceSynthetic: true },
  { factorId: "cf-backup-thin", label: "备份池不足", drillType: "BackupSupplierPool", drillId: "pool-cathode", drillField: "memberCount", kind: "派生", isRoot: false, provenanceSynthetic: false },
  { factorId: "cf-cert-cycle", label: "认证周期长(root)", drillType: "BackupSupplierPool", drillId: "pool-cathode", drillField: "certWeeks", kind: "派生", isRoot: true, provenanceSynthetic: false },
  { factorId: "cf-decision-gap", label: "价格预判缺失(root)", drillType: "DecisionGap", drillId: "dgap-forecast", drillField: "severity", kind: "决策", isRoot: true, provenanceSynthetic: false },
];

const MARKET_SHARE_CAUSAL_FACTORS = [
  { factorId: "cf-share-gap", label: "份额缺口", drillType: "Metric", drillId: "market_share", drillField: "actual", kind: "派生", isRoot: false, provenanceSynthetic: false, boundMetricKeys: ["market_share"] },
  { factorId: "cf-competitor-price", label: "竞品降价(root)", drillType: "CompetitorPrice", drillId: "cp-catl-4680-NCM", drillField: "pricePerKwh", kind: "实测", isRoot: true, provenanceSynthetic: false },
  { factorId: "cf-bid-loss", label: "丢标率(root)", drillType: "BidRecord", drillId: "bid-pass-001", drillField: "win", kind: "实测", isRoot: true, provenanceSynthetic: false },
  { factorId: "cf-delivery-reputation", label: "交付口碑(root)", drillType: "BidRecord", drillId: "bid-com-001", drillField: "lossReason", kind: "派生", isRoot: true, provenanceSynthetic: false },
];

const REVENUE_CAUSAL_FACTORS = [
  { factorId: "cf-rev-gap", label: "营收缺口", drillType: "Metric", drillId: "revenue", drillField: "actual", kind: "派生", isRoot: false, provenanceSynthetic: false, boundMetricKeys: ["revenue"] },
  { factorId: "cf-pipeline-shrink", label: "漏斗萎缩(root)", drillType: "PipelineOpportunity", drillId: "opp-passenger-001", drillField: "amount", kind: "实测", isRoot: true, provenanceSynthetic: false },
  { factorId: "cf-price-erosion", label: "价格实现率跌(root)", drillType: "PriceRealization", drillId: "pr-4680-NCM", drillField: "realizedPrice", kind: "实测", isRoot: true, provenanceSynthetic: false },
  { factorId: "cf-churn", label: "大单流失(root)", drillType: "WinLossRecord", drillId: "wl-opp-pass-001", drillField: "reason", kind: "派生", isRoot: true, provenanceSynthetic: false },
];

const CASH_CAUSAL_FACTORS = [
  { factorId: "cf-cash-gap", label: "现金缺口", drillType: "Metric", drillId: "cash", drillField: "actual", kind: "派生", isRoot: false, provenanceSynthetic: false, boundMetricKeys: ["cash"] },
  { factorId: "cf-ar-aging", label: "账龄恶化(root)", drillType: "ARAging", drillId: "ar-cust0-90p", drillField: "bucket", kind: "实测", isRoot: true, provenanceSynthetic: false },
  { factorId: "cf-dso-stretch", label: "DSO拉长(root)", drillType: "DSO", drillId: "dso-energy_storage", drillField: "days", kind: "实测", isRoot: true, provenanceSynthetic: false },
  { factorId: "cf-customer-concentration", label: "大客户逾期集中(root)", drillType: "OverdueRecord", drillId: "ovd-G-001", drillField: "overdueDays", kind: "实测", isRoot: true, provenanceSynthetic: false },
];

const DEMAND_ATTAIN_CAUSAL_FACTORS = [
  { factorId: "cf-demand-gap", label: "需求达成缺口", drillType: "Metric", drillId: "demand_attain", drillField: "actual", kind: "派生", isRoot: false, provenanceSynthetic: false, boundMetricKeys: ["demand_attain"] },
  { factorId: "cf-forecast-bias", label: "预测偏差(root)", drillType: "PipelineOpportunity", drillId: "opp-energy_storage-001", drillField: "winProb", kind: "派生", isRoot: true, provenanceSynthetic: false },
  { factorId: "cf-capacity-short", label: "产能缺口(root)", drillType: "Equipment", drillId: "EQ-changzhou-001", drillField: "oee_current", kind: "实测", isRoot: true, provenanceSynthetic: false },
  { factorId: "cf-material-short", label: "物料短缺(root)", drillType: "MaterialBalance", drillId: "mbal-2", drillField: "gapTon", kind: "派生", isRoot: true, provenanceSynthetic: false },
];

export const CAUSAL_FACTORS = [
  ...SUPPLY_CAUSAL_FACTORS,
  ...MARKET_SHARE_CAUSAL_FACTORS,
  ...REVENUE_CAUSAL_FACTORS,
  ...CASH_CAUSAL_FACTORS,
  ...DEMAND_ATTAIN_CAUSAL_FACTORS,
];

// WO-CEO-3 触发规则（信号阈值→行动·decision_play 引擎评估·阈值可被 RuleEntry `trigger_thresholds`.params 覆盖·C3）。
// 信号：li_carbonate_price=ExternalSignal.value；licarb_pct_cum=CommodityPriceTrend 累计涨幅(引擎派生)。
const TRIGGER_RULES = [
  { triggerId: "trig-backup-cert", signalRef: "licarb_pct_cum", op: ">", threshold: 12, action: "启动备份供应商认证", actionDetail: "锂价累计涨幅越阈 → 提前激活备份池认证，压缩认证周期", cfgRuleKey: "trigger_thresholds" },
  { triggerId: "trig-lta-reprice", signalRef: "li_carbonate_price", op: ">", threshold: 90000, action: "长协重谈加价格联动条款", actionDetail: "碳酸锂现价越阈 → 触发长协价格联动条款重谈，止住违约敞口", cfgRuleKey: "trigger_thresholds" },
  { triggerId: "trig-fx-hedge", signalRef: "usd_cny", op: ">", threshold: 8, action: "启动汇率对冲", actionDetail: "汇率越阈 → 对冲出口营收（当前未越·不 fire）", cfgRuleKey: "trigger_thresholds" },
];

// WO-CEO-2 caused_by 因果边（果→因·真实物化·gap_attribution 引擎遍历输出边序列 C2）。
const SUPPLY_CAUSAL_EDGES = [
  { from: "cf-cathode-shortage", to: "cf-upstream-cut" },
  { from: "cf-upstream-cut", to: "cf-lta-breach" },
  { from: "cf-lta-breach", to: "cf-ore-price" },
  { from: "cf-ore-price", to: "cf-geopolitical" },
  { from: "cf-geopolitical", to: "cf-decision-gap" },
  { from: "cf-upstream-cut", to: "cf-backup-thin" },
  { from: "cf-backup-thin", to: "cf-cert-cycle" },
];

// WO-CEO-DATA-2 · 每指标多假设 caused_by 边（果→因）。
const MARKET_SHARE_CAUSAL_EDGES = [
  { from: "cf-share-gap", to: "cf-bid-loss" },
  { from: "cf-bid-loss", to: "cf-competitor-price" },
  { from: "cf-share-gap", to: "cf-delivery-reputation" },
];
const REVENUE_CAUSAL_EDGES = [
  { from: "cf-rev-gap", to: "cf-pipeline-shrink" },
  { from: "cf-rev-gap", to: "cf-price-erosion" },
  { from: "cf-rev-gap", to: "cf-churn" },
];
const CASH_CAUSAL_EDGES = [
  { from: "cf-cash-gap", to: "cf-ar-aging" },
  { from: "cf-ar-aging", to: "cf-customer-concentration" },
  { from: "cf-cash-gap", to: "cf-dso-stretch" },
];
const DEMAND_ATTAIN_CAUSAL_EDGES = [
  { from: "cf-demand-gap", to: "cf-forecast-bias" },
  { from: "cf-demand-gap", to: "cf-capacity-short" },
  { from: "cf-demand-gap", to: "cf-material-short" },
  // WO-METRIC-AWARE-SEAM：删跨域桥边 cf-material-short→cf-cathode-shortage（原"复用供应链域"）——它让 demand 域
  // BFS 泄漏进供应/cathode 链、归到 cf-decision-gap/cf-cert-cycle（违 metric-aware 域隔离·C5 咬）。cf-material-short
  // 本身 isRoot=true 即 demand 域合法终点根，无需再桥到 cathode（供应类 metric 仍从 cf-cathode-shortage 起·不受影响）。
];

export const CAUSAL_EDGES: { from: string; to: string }[] = [
  ...SUPPLY_CAUSAL_EDGES,
  ...MARKET_SHARE_CAUSAL_EDGES,
  ...REVENUE_CAUSAL_EDGES,
  ...CASH_CAUSAL_EDGES,
  ...DEMAND_ATTAIN_CAUSAL_EDGES,
];

const PROVINCE_GRID: Record<string, number> = { changzhou: 0.55, hefei: 0.58, xian: 0.62, chengdu: 0.78, zaozhuang: 0.7, jiangmen: 0.5 };

export interface ExtendedData {
  materials: Record<string, unknown>[];
  materialBatches: Record<string, unknown>[];
  customers: Record<string, unknown>[];
  arInvoices: Record<string, unknown>[];
  certifications: Record<string, unknown>[];
  energyMeters: Record<string, unknown>[];
  changeoverMatrix: Record<string, unknown>[];
  capexProjects: Record<string, unknown>[];
  purchaseOrders: Record<string, unknown>[];
  carbonFactors: Record<string, unknown>[];
  financeAccounts: Record<string, unknown>[];
  financeMetrics: Record<string, unknown>[];
  suppliers: Record<string, unknown>[];
  // WO-CEO-2 供应链/地缘/决策域（gap_attribution 因果链实体）
  longTermAgreements: Record<string, unknown>[];
  backupSupplierPools: Record<string, unknown>[];
  commodityPriceTrends: Record<string, unknown>[];
  decisionGaps: Record<string, unknown>[];
  causalFactors: Record<string, unknown>[];
  triggerRules: Record<string, unknown>[]; // WO-CEO-3 触发规则
  // WO-CEO-DATA-2 · 每指标多假设因果域 drill 真对象
  competitorShares: Record<string, unknown>[];
  bidRecords: Record<string, unknown>[];
  competitorPrices: Record<string, unknown>[];
  pipelineOpportunities: Record<string, unknown>[];
  winLossRecords: Record<string, unknown>[];
  priceRealizations: Record<string, unknown>[];
  arAgings: Record<string, unknown>[];
  dsoRecords: Record<string, unknown>[];
  overdueRecords: Record<string, unknown>[];
}

/** 确定性生成（基于型号/基地/订单上下文 + seed 派生子流）。scale 控工业级数据量（XL）。 */
export function generateExtended(
  seed: number,
  ctx: {
    models: { modelId: string }[];
    bases: { baseId: string; name: string }[];
    lines: { lineId: string }[];
    /** WO-CEO-DATA-2：复用 Equipment/MaterialBalance 作 capacity-short / material-short 下钻真对象。 */
    equipment?: { equipId: string; baseId?: string; oeeA?: number; oeeP?: number; oeeQ?: number }[];
    materialBalances?: { matBalId: string; gapTon?: number }[];
  },
  scale: "S" | "M" | "L" | "XL" = "L",
): ExtendedData {
  const rng = mulberry32(seed + 7919); // 独立子流，与主生成不串扰
  // WO-CEO-DATA-2：新域独立 rng，不位移下游 rngTopo / 既有 extended 输出。
  const rng2 = mulberry32(seed + 37);
  // 工业级数据量：S/M/L 保持原 demo 量级（既有测试），XL 放大到产线真实量级。
  const batchesPerMat = scale === "XL" ? 250 : 3; // 8 料 × 250 = 2000 批
  const poCount = scale === "XL" ? 3000 : 30;
  const extraCustomers = scale === "XL" ? 54 : 0; // 6 + 54 = 60 客户
  const invoicesPerCust = scale === "XL" ? 40 : 3;

  const materials = MATERIALS.map((m) => ({
    matId: m.matId,
    name: m.name,
    unitPrice: round(m.base * (0.9 + rng() * 0.2), 2),
    leadTime: 7 + Math.floor(rng() * 21),
    carbonFactor: round(8 + rng() * 40, 2),
    bomUnit: round(0.5 + rng() * 2, 3),
    dailyUse: round((50 + rng() * 200) * WAVE1_SCALE_FACTOR, 1),
    onHand: round((500 + rng() * 4000) * WAVE1_SCALE_FACTOR, 0),
    inTransit: round(rng() * 1500 * WAVE1_SCALE_FACTOR, 0),
    // C27 长协执行偏差 / C31 外协质量门：从 matId 确定性派生，各植入一处越线。
    devPct: m.matId === "pos_ncm" ? 0.08 : 0.02,
    outsourceYield: m.matId === "sep_film" ? 0.91 : 0.95,
    // Phase 2 Wave 2：扩展工程属性（固定值，不消耗 rng，保 R6）。
    materialCode: m.materialCode,
    category: m.category,
    spec: m.spec,
    unit: m.unit,
    supplierId: m.supplierIds[0],
    shelfLife: m.matId === "elyte" ? 180 : m.matId === "sep_film" ? 365 : 730,
    isKeyMaterial: m.isKey,
    status: "活跃",
  }));

  // MaterialBatch：每物料 batchesPerMat 批，植入 6 批 >90 日呆滞（XL=工业级 2000 批）
  const materialBatches: Record<string, unknown>[] = [];
  let dormantInjected = 0;
  for (const m of MATERIALS) {
    for (let i = 0; i < batchesPerMat; i++) {
      const makeDormant = dormantInjected < 6 && i === 2; // 每料第3批设呆滞，直到注满6批
      if (makeDormant) dormantInjected++;
      materialBatches.push({
        batchId: `${m.matId}_b${i}`,
        matId: m.matId,
        qty: round((200 + rng() * 800) * WAVE1_SCALE_FACTOR, 0),
        ageDays: makeDormant ? 95 + Math.floor(rng() * 60) : Math.floor(rng() * 80),
        idleDays: makeDormant ? 95 + Math.floor(rng() * 30) : Math.floor(rng() * 60),
      });
    }
  }

  // Customer：PRD-IND-order-aggregate HTML 8 客户（与订单 cust 对齐，order_of_customer 可连）+ extraCustomers 工业级补充。
  const custNames = ["整车厂A", "整车厂B", "整车厂C", "海外车企E", "商用车集团G", "储能集成商D", "储能集成商H", "电网公司F"];
  const customers = [
    ...custNames.map((name, ci) => ({
      custId: `cust_${ci}`, // ascii pk（避免中文名 sanitize 后 id 碰撞）
      custName: name,
      creditLimit: round((2000 + rng() * 8000) * WAVE1_SCALE_FACTOR, 0),
      termDays: 60,
      receivables: round(rng() * 3000 * WAVE1_SCALE_FACTOR, 0),
      wipUnbilled: round(rng() * 2000 * WAVE1_SCALE_FACTOR, 0),
      maxOverdueDays: name === "商用车集团G" ? 38 : Math.floor(rng() * 25),
    })),
    ...Array.from({ length: extraCustomers }, (_, k) => ({
      custId: `cust_x${k}`,
      custName: `客户${String(k + 1).padStart(3, "0")}`,
      creditLimit: round((1000 + rng() * 9000) * WAVE1_SCALE_FACTOR, 0),
      termDays: 60,
      receivables: round(rng() * 3000 * WAVE1_SCALE_FACTOR, 0),
      wipUnbilled: round(rng() * 2000 * WAVE1_SCALE_FACTOR, 0),
      maxOverdueDays: Math.floor(rng() * 25),
    })),
  ];

  // ARInvoice：每客户 invoicesPerCust 张（G 含逾期张）
  const arInvoices: Record<string, unknown>[] = [];
  for (const [ci, c] of customers.entries()) {
    for (let i = 0; i < invoicesPerCust; i++) {
      arInvoices.push({
        invoiceId: `arinvoice_${ci}_${i}`, // ascii pk（避免与搜索 token 碰撞）
        custName: c.custName,
        amount: round((200 + rng() * 1500) * WAVE1_SCALE_FACTOR, 0),
        overdueDays: c.custName === "商用车集团G" && i === 0 ? 38 : Math.floor(rng() * 20),
      });
    }
  }

  // Certification：型号×产线子集 18 条（量产12/认证中4/待认证2）
  const certifications: Record<string, unknown>[] = [];
  const statuses = [...Array(12).fill("量产"), ...Array(4).fill("认证中"), ...Array(2).fill("待认证")];
  let si = 0;
  outer: for (const m of ctx.models) {
    for (const l of ctx.lines) {
      if (si >= statuses.length) break outer;
      const status = statuses[si++];
      certifications.push({
        certId: `cert_${m.modelId}_${l.lineId}`.replace(/[^\w-]/g, "_"),
        modelId: m.modelId,
        lineId: l.lineId,
        status,
        certHours: 40 + Math.floor(rng() * 160),
        gapContribution: round(rng() * 30, 2),
      });
    }
  }

  // EnergyMeter：每基地一条（省电网因子；成都偏高 → S20 超标戏剧点）
  const energyMeters = ctx.bases.map((b) => ({
    meterId: `em_${b.baseId}`,
    baseId: b.baseId,
    processKey: "涂布",
    energyPerUnit: round(1.5 + rng() * 1.5, 3),
    gridFactor: PROVINCE_GRID[b.baseId] ?? round(0.5 + rng() * 0.3, 2),
  }));

  // ChangeoverMatrix：型号两两（对角 0，同体系 30–60，跨体系 90–180 —— 用名字简化）
  const changeoverMatrix: Record<string, unknown>[] = [];
  for (const a of ctx.models) {
    for (const b of ctx.models) {
      if (a.modelId === b.modelId) continue;
      const cross = a.modelId.includes("LFP") !== b.modelId.includes("LFP");
      changeoverMatrix.push({
        pairId: `${a.modelId}__${b.modelId}`,
        fromModel: a.modelId,
        toModel: b.modelId,
        minutes: cross ? 90 + Math.floor(rng() * 90) : 30 + Math.floor(rng() * 30),
      });
    }
  }

  // CapexProject：3 项目（枣庄达标 / 江门临界 / 一虚构不达标）
  const capexProjects = [
    { projectId: "capex_zaozhuang", name: "枣庄储能线", irr: 0.22, util24: 0.82, c23pass: true },
    { projectId: "capex_jiangmen", name: "江门动力线", irr: 0.155, util24: 0.76, c23pass: true },
    { projectId: "capex_virtual", name: "某低效项目", irr: 0.09, util24: 0.61, c23pass: false },
  ];

  // PurchaseOrder：poCount 单，2 单延迟（XL=工业级 3000 单）
  const purchaseOrders: Record<string, unknown>[] = [];
  for (let i = 0; i < poCount; i++) {
    const m = MATERIALS[i % MATERIALS.length]!;
    purchaseOrders.push({
      poId: `po_${i}`,
      matId: m.matId,
      qty: round((300 + rng() * 1200) * WAVE1_SCALE_FACTOR, 0),
      etaDay: 1 + Math.floor(rng() * 20),
      delayed: i === 5 || i === 17, // 植入 2 单延迟
    });
  }

  // CarbonFactor：物料 8 + 省电网 6
  const carbonFactors = [
    ...materials.map((m) => ({ factorId: `cf_${m.matId}`, kind: "material", key: m.matId, factor: m.carbonFactor })),
    ...Object.entries(PROVINCE_GRID).map(([k, v]) => ({ factorId: `cf_grid_${k}`, kind: "grid", key: k, factor: v })),
  ];

  // Phase5A 财务：每基地现金账户（确定性派生，不动 rng 流）+ 3 情景财务指标。
  const financeAccounts = ctx.bases.map((b, i) => ({
    accId: `fa_${b.baseId}`,
    baseId: b.baseId,
    cashOnHand: round(20 + ((i * 37) % 60), 1), // 亿
    receivable: round(8 + ((i * 53) % 40), 1),
    payable: round(6 + ((i * 29) % 30), 1),
    workingCapital: round(20 + ((i * 37) % 60) + 8 + ((i * 53) % 40) - (6 + ((i * 29) % 30)), 1),
  }));
  const FIN = { conservative: { cashCushion: 72, capex: 3, irr: 9.5, netMargin: 12.5 }, baseline: { cashCushion: 58, capex: 8, irr: 14.2, netMargin: 14.0 }, aggressive: { cashCushion: 42, capex: 27, irr: 18.6, netMargin: 13.2 } };
  const financeMetrics = Object.entries(FIN).map(([k, v]) => ({ metricId: `fm_${k}`, scenarioKey: k, cashCushion: v.cashCushion, irr: v.irr, capexSpent: v.capex, netMargin: v.netMargin }));

  // WO-CEO-2 供货量：正极 3 家植入减供（actual = contracted × onTimeRate → <contracted 减供）；
  // 其余供应商按 minOrderQty×频次派生一个约定量。全常数/派生·不消耗 rng·R6 字节一致。
  const suppliers = SUPPLIERS.map((s) => {
    const contracted = CATHODE_CONTRACT[s.supplierId] ?? Math.round(s.minOrderQty * 4);
    return {
      ...s, contractedSupplyTon: contracted, actualSupplyTon: Math.round(contracted * s.onTimeRate),
      // WO-METRIC-AWARE-SEAM：填 CEO-DATA-2 声明的真源履约字段（合成占位·确定性·真源 ERP/SRM 接入后覆盖）→ 字段对齐可上传。
      deliveryDate: "2026-06-30", poNumber: `PO-${s.supplierId}`,
    };
  });

  // WO-CEO-DATA-2 · 每指标多假设因果域 drill 真对象（独立 rng2 流，不位移下游 rngTopo / 既有 extended 输出）。
  const competitorShares = [
    { shareId: "share-catl-passenger", competitor: "CATL", segment: "passenger", sharePct: round(28 + rng2() * 6, 1), period: "2026-Q2" },
    { shareId: "share-catl-energy_storage", competitor: "CATL", segment: "energy_storage", sharePct: round(32 + rng2() * 6, 1), period: "2026-Q2" },
    { shareId: "share-byd-passenger", competitor: "BYD", segment: "passenger", sharePct: round(18 + rng2() * 5, 1), period: "2026-Q2" },
    { shareId: "share-lg-energy_storage", competitor: "LG Energy Solution", segment: "energy_storage", sharePct: round(12 + rng2() * 5, 1), period: "2026-Q2" },
  ];
  const bidRecords = [
    { bidId: "bid-pass-001", segment: "passenger", win: false, lossReason: "price", amount: round(12000 + rng2() * 2000, 0), competitorRef: "CATL" },
    { bidId: "bid-com-001", segment: "commercial", win: false, lossReason: "delivery", amount: round(8000 + rng2() * 1500, 0), competitorRef: "BYD" },
    { bidId: "bid-ess-001", segment: "energy_storage", win: true, amount: round(15000 + rng2() * 3000, 0), competitorRef: "LG Energy Solution" },
  ];
  const competitorPrices = [
    { priceId: "cp-catl-4680-NCM", competitor: "CATL", model: "4680-NCM", pricePerKwh: round(520 + rng2() * 40, 0), period: "2026-Q2" },
    { priceId: "cp-byd-4680-LFP", competitor: "BYD", model: "4680-LFP", pricePerKwh: round(380 + rng2() * 30, 0), period: "2026-Q2" },
    { priceId: "cp-lg-prismatic-lfp", competitor: "LG Energy Solution", model: "方形-LFP", pricePerKwh: round(410 + rng2() * 30, 0), period: "2026-Q2" },
  ];
  const pipelineOpportunities = [
    { oppId: "opp-passenger-001", segment: "passenger", stage: "proposal", amount: round(9000 + rng2() * 2000, 0), winProb: round(0.45 + rng2() * 0.15, 2) },
    { oppId: "opp-energy_storage-001", segment: "energy_storage", stage: "negotiation", amount: round(12000 + rng2() * 3000, 0), winProb: round(0.55 + rng2() * 0.15, 2) },
    { oppId: "opp-commercial-001", segment: "commercial", stage: "lead", amount: round(5000 + rng2() * 1500, 0), winProb: round(0.35 + rng2() * 0.15, 2) },
  ];
  const winLossRecords = [
    { oppId: "wl-opp-pass-001", result: "churn" as const, reason: "competitor price" },
    { oppId: "wl-opp-ess-001", result: "win" as const, reason: "delivery advantage" },
  ];
  const priceRealizations = [
    { realizationId: "pr-4680-NCM", model: "4680-NCM", listPrice: round(620 + rng2() * 20, 0), realizedPrice: round(540 + rng2() * 20, 0), period: "2026-Q2" },
    { realizationId: "pr-4680-LFP", model: "4680-LFP", listPrice: round(460 + rng2() * 20, 0), realizedPrice: round(400 + rng2() * 20, 0), period: "2026-Q2" },
  ];
  const arAgings = [
    { agingId: "ar-cust0-90p", customerRef: "cust_0", bucket: "90+", amount: round(2500 + rng2() * 1000, 0) },
    { agingId: "ar-cust0-60", customerRef: "cust_0", bucket: "60-90", amount: round(1800 + rng2() * 800, 0) },
    { agingId: "ar-cust1-30", customerRef: "cust_1", bucket: "0-30", amount: round(1200 + rng2() * 600, 0) },
  ];
  const dsoRecords = [
    { dsoId: "dso-energy_storage", segment: "energy_storage", days: 92, period: "2026-Q2" },
    { dsoId: "dso-passenger", segment: "passenger", days: 68, period: "2026-Q2" },
  ];
  const overdueRecords = [
    { overdueId: "ovd-G-001", invoiceRef: "INV-G-001", overdueDays: 38, customerRef: "cust_6" },
  ];

  // capacity-short root 下钻到真实 Equipment（选 OEE 乘积最低者；无上下文时回退常量，保独立可测）。
  const capacityEquip = ctx.equipment?.length
    ? ctx.equipment.slice().sort((a, b) => {
        const oeeA = (Number(a.oeeA) || 1) * (Number(a.oeeP) || 1) * (Number(a.oeeQ) || 1);
        const oeeB = (Number(b.oeeA) || 1) * (Number(b.oeeP) || 1) * (Number(b.oeeQ) || 1);
        return oeeA - oeeB;
      })[0]
    : undefined;
  const capacityDrillId = capacityEquip?.equipId ?? "EQ-changzhou-001";
  // WO-METRIC-AWARE-SEAM：默认 boundMetricKeys:[]（字段对齐 present·无绑定→引擎回落 cf-cathode-shortage）；
  // 上面 gap 节点自带的 boundMetricKeys 经 ...cf 覆盖默认（域根绑定=数据×引擎一套机制·握手完成）。
  const causalFactors = CAUSAL_FACTORS.map((cf) => ({
    boundMetricKeys: [] as string[],
    ...cf,
    ...(cf.factorId === "cf-capacity-short" ? { drillId: capacityDrillId } : {}),
  }));

  return {
    materials, materialBatches, customers, arInvoices, certifications, energyMeters, changeoverMatrix,
    capexProjects, purchaseOrders, carbonFactors, financeAccounts, financeMetrics, suppliers,
    // WO-METRIC-AWARE-SEAM：填 CEO-DATA-2 声明的真合同/行情字段（合成占位·确定性·真源接入后覆盖）→ 字段对齐可上传。
    longTermAgreements: LONG_TERM_AGREEMENTS.map((l) => ({
      ...l,
      priceFormula: l.priceLinked ? "碳酸锂指数联动" : "固定价",
      effectiveDate: "2026-01-01", expiryDate: "2026-12-31", deliveryDate: "2026-06-30", poNumber: `PO-${l.ltaId}`,
    })),
    backupSupplierPools: BACKUP_SUPPLIER_POOLS,
    commodityPriceTrends: COMMODITY_PRICE_TRENDS.map((c) => ({ ...c, source: "上海有色网", spec: "电池级", currency: "CNY" })),
    decisionGaps: DECISION_GAPS, causalFactors,
    triggerRules: TRIGGER_RULES,
    // WO-CEO-DATA-2 · 每指标多假设因果域 drill 真对象
    competitorShares, bidRecords, competitorPrices, pipelineOpportunities, winLossRecords,
    priceRealizations, arAgings, dsoRecords, overdueRecords,
  };
}
