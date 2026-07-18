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
      // WO-CEO-DATA-2 §2b：真源字段（最近一批 PO 交期/单号，接 ERP/SRM）。
      p("deliveryDate", "string"), p("poNumber", "string"),
    ]),
    // WO-CEO-2 供应链/地缘/决策域（gap_attribution 深度反向归因·因果链实体·§0 案例落成真对象）：
    def("LongTermAgreement", "长期协议", "supply", [
      p("ltaId", "string", true), p("supplierId", "string"), p("materialType", "enum"),
      p("contractedQtyTon"), p("actualDeliveredTon"), p("priceLinked", "boolean"), p("breachPenaltyWan"),
      // WO-CEO-DATA-2 §2b 真源字段：价格联动公式 + 生效/失效日期（接真 ERP/合同履约）。
      p("priceFormula", "string"), p("effectiveDate", "string"), p("expiryDate", "string"),
    ]),
    def("BackupSupplierPool", "备份供应池", "supply", [
      p("poolId", "string", true), p("materialType", "enum"), p("memberCount"), p("certWeeks"), p("procureFreqPerYear"),
    ]),
    def("CommodityPriceTrend", "矿产价格趋势", "external", [
      p("trendId", "string", true), p("commodity", "string"), p("weekOf", "string"), p("pricePerTon"), p("pctChange"),
      // WO-CEO-DATA-2 §2b 真源字段：数据来源 + 规格 + 币种（接真行情 SMM/Wind/百川）。
      p("source", "string"), p("spec", "string"), p("currency", "string"),
    ]),
    def("DecisionGap", "决策缺陷", "decision", [
      p("gapId", "string", true), p("kind", "enum"), p("description", "string"), p("severity"), p("ownerRef", "string"),
      // WO-CEO-DATA-2 §2b 真源字段：评审日期 + 证据（非实测·评审录入·接真前标灰）。
      p("reviewDate", "string"), p("evidence", "string"),
    ]),
    // 因果因素节点（caused_by 遍历的一等节点·每个下钻到真证据对象·结构叶→地缘/决策终点）：
    def("CausalFactor", "因果因素", "decision", [
      p("factorId", "string", true), p("label", "string"), p("drillType", "string"), p("drillId", "string"),
      p("drillField", "string"), p("kind", "enum"), p("isRoot", "boolean"), p("provenanceSynthetic", "boolean"),
      // WO-CEO-DATA-2：每个 CausalFactor 归属一个指标域，供引擎按指标选因果根。
      p("metricKey", "string"),
    ]),
    // WO-CEO-DATA-2 每指标多假设因果域 drill 真对象（market_share / revenue / cash / demand_attain）
    def("CompetitorShare", "竞品份额", "commercial", [
      p("shareId", "string", true), p("competitor", "string"), p("segment", "string"), p("sharePct"), p("period", "string"),
    ]),
    def("BidRecord", "竞标记录", "commercial", [
      p("bidId", "string", true), p("segment", "string"), p("win", "boolean"), p("lossReason", "string"), p("amount"), p("competitorRef", "string"),
    ]),
    def("CompetitorPrice", "竞品价格", "commercial", [
      p("priceId", "string", true), p("competitor", "string"), p("model", "string"), p("pricePerKwh"), p("period", "string"),
    ]),
    def("PipelineOpportunity", "营收漏斗", "commercial", [
      p("oppId", "string", true), p("segment", "string"), p("stage", "string"), p("amount"), p("winProb"),
    ]),
    def("WinLossRecord", "赢单丢单记录", "commercial", [
      p("recordId", "string", true), p("oppId", "string"), p("result", "enum"), p("reason", "string"), p("amount"),
    ]),
    def("PriceRealization", "价格实现", "commercial", [
      p("priceId", "string", true), p("model", "string"), p("listPrice"), p("realizedPrice"), p("period", "string"),
    ]),
    def("ARAging", "应收账款账龄", "finance", [
      p("agingId", "string", true), p("customerRef", "string"), p("bucket", "enum"), p("amount"), p("period", "string"),
    ]),
    def("DSO", "应收账款周转天数", "finance", [
      p("dsoId", "string", true), p("segment", "string"), p("days"), p("period", "string"),
    ]),
    def("OverdueRecord", "逾期记录", "finance", [
      p("overdueId", "string", true), p("invoiceRef", "string"), p("overdueDays"), p("customerRef", "string"), p("amount"),
    ]),
    // WO-CEO-3 触发规则（信号阈值→行动·一等可编辑·阈值可被 RuleEntry.params 覆盖·decision_play 引擎评估）
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
    def("ExternalSignal", "外部信号", "external", [p("signalKey", "string", true), p("name", "string"), p("category", "string"), p("value"), p("unit", "string"), p("asOf", "string"), p("source", "string"), p("trend", "string"), p("impact", "string"), p("elasticity"),
      // WO-CEO-DATA-2 §2b：外部事件引用（事件编号/报告日期，接真外部信号系统）。
      p("eventRef", "string"),
    ]),
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
  { ltaId: "lta-lfp-rbkj", supplierId: "SUP-001", materialType: "正极", contractedQtyTon: 8000, actualDeliveredTon: 7200, priceLinked: false, breachPenaltyWan: 320,
    priceFormula: "碳酸锂SMM月均价×系数1.12+加工费1.8万", effectiveDate: "2024-01-01", expiryDate: "2026-12-31" },
  { ltaId: "lta-lfp-cylk", supplierId: "SUP-003", materialType: "正极", contractedQtyTon: 4000, actualDeliveredTon: 3400, priceLinked: false, breachPenaltyWan: 180,
    priceFormula: "锁价 9.5 万/吨（无联动）", effectiveDate: "2024-06-01", expiryDate: "2026-06-30" },
  { ltaId: "lta-ncm-dskj", supplierId: "SUP-002", materialType: "正极", contractedQtyTon: 6000, actualDeliveredTon: 5850, priceLinked: true, breachPenaltyWan: 60,
    priceFormula: "MB钴+SMM镍锂联动·季度调", effectiveDate: "2025-01-01", expiryDate: "2027-12-31" },
];

// WO-CEO-2 备份供应池：正极池薄（成员少+认证周期长 → 断供无替代 → root=认证周期长）。
const BACKUP_SUPPLIER_POOLS = [
  { poolId: "pool-cathode", materialType: "正极", memberCount: 2, certWeeks: 16, procureFreqPerYear: 2 },
  { poolId: "pool-anode", materialType: "负极", memberCount: 4, certWeeks: 8, procureFreqPerYear: 4 },
];

// WO-CEO-2 矿价趋势：碳酸锂逐周上涨（地缘冲突推升 → 上游成本 → 减供/违约）。R6：常数。
const COMMODITY_PRICE_TRENDS = [
  { trendId: "licarb-w1", commodity: "碳酸锂", weekOf: "2026-06-01", pricePerTon: 84000, pctChange: 3.2, source: "SMM", spec: "电池级碳酸锂≥99.5%", currency: "CNY" },
  { trendId: "licarb-w2", commodity: "碳酸锂", weekOf: "2026-06-08", pricePerTon: 88500, pctChange: 5.4, source: "SMM", spec: "电池级碳酸锂≥99.5%", currency: "CNY" },
  { trendId: "licarb-w3", commodity: "碳酸锂", weekOf: "2026-06-15", pricePerTon: 92800, pctChange: 4.9, source: "SMM", spec: "电池级碳酸锂≥99.5%", currency: "CNY" },
  { trendId: "licarb-w4", commodity: "碳酸锂", weekOf: "2026-06-22", pricePerTon: 96000, pctChange: 3.4, source: "SMM", spec: "电池级碳酸锂≥99.5%", currency: "CNY" },
];

// WO-CEO-2 决策缺陷：因果链终点（前瞻缺失/条款缺失·可归的最终根）。
const DECISION_GAPS = [
  { gapId: "dgap-forecast", kind: "前瞻缺失", description: "矿价前瞻缺失：未预判地缘冲突推升锂价，长协未设价格联动条款", severity: 0.8, ownerRef: "prin-procure", reviewDate: "2026-06-20", evidence: "Q2 锂价回顾会议纪要#FM-0620" },
  { gapId: "dgap-clause", kind: "条款缺失", description: "长协无违约追偿/替代激活条款，断供时无兜底", severity: 0.6, ownerRef: "prin-procure", reviewDate: "2026-06-18", evidence: "LTA-SUP-003 合同扫描件" },
];

// WO-CEO-2/3 外部信号：真源事件引用示例（合成种子诚实标灰·真源上传后覆盖）。
const EXTERNAL_SIGNALS_EXTRA = [
  { signalKey: "li_carbonate_price", name: "碳酸锂现货价", category: "commodity", value: 96000, unit: "元/吨", asOf: "2026-06-22", source: "SMM", trend: "up", impact: "成本上行", elasticity: -0.35, eventRef: "EVT-COMM-2026-0622" },
];

// WO-CEO-2 供应链/地缘/决策域因果因素节点（caused_by 遍历的一等节点·每节点下钻到真证据对象）。
// 因果方向：caused_by 从「果」指向「因」（物料短缺 --caused_by--> 上游减供 …）。
// gross_profit / seg_attain 复用此域；metricKey 为空表示共享域。
const SUPPLY_CAUSAL_FACTORS = [
  { factorId: "cf-cathode-shortage", label: "正极粉短缺", drillType: "MaterialBalance", drillId: "mbal-2", drillField: "gapTon", kind: "派生", isRoot: false, provenanceSynthetic: false, metricKey: "" },
  { factorId: "cf-upstream-cut", label: "上游减供", drillType: "Supplier", drillId: "SUP-003", drillField: "actualSupplyTon", kind: "实测", isRoot: false, provenanceSynthetic: false, metricKey: "" },
  { factorId: "cf-lta-breach", label: "长协违约", drillType: "LongTermAgreement", drillId: "lta-lfp-cylk", drillField: "actualDeliveredTon", kind: "派生", isRoot: false, provenanceSynthetic: false, metricKey: "" },
  { factorId: "cf-ore-price", label: "锂价上涨", drillType: "CommodityPriceTrend", drillId: "licarb-w4", drillField: "pctChange", kind: "外部信号", isRoot: false, provenanceSynthetic: true, metricKey: "" },
  { factorId: "cf-geopolitical", label: "地缘冲突推升矿价", drillType: "ExternalSignal", drillId: "li_carbonate_price", drillField: "value", kind: "外部信号", isRoot: false, provenanceSynthetic: true, metricKey: "" },
  { factorId: "cf-backup-thin", label: "备份池不足", drillType: "BackupSupplierPool", drillId: "pool-cathode", drillField: "memberCount", kind: "派生", isRoot: false, provenanceSynthetic: false, metricKey: "" },
  { factorId: "cf-cert-cycle", label: "认证周期长(root)", drillType: "BackupSupplierPool", drillId: "pool-cathode", drillField: "certWeeks", kind: "派生", isRoot: true, provenanceSynthetic: false, metricKey: "" },
  { factorId: "cf-decision-gap", label: "价格预判缺失(root)", drillType: "DecisionGap", drillId: "dgap-forecast", drillField: "severity", kind: "决策", isRoot: true, provenanceSynthetic: false, metricKey: "" },
];

// WO-CEO-DATA-2 市场份额域因果因素（多假设：竞品价格·丢标·交付声誉）。
const MARKET_SHARE_CAUSAL_FACTORS = [
  { factorId: "cf-share-gap", label: "市场份额缺口", drillType: "CompetitorShare", drillId: "share-global", drillField: "sharePct", kind: "派生", isRoot: false, provenanceSynthetic: false, metricKey: "market_share" },
  { factorId: "cf-competitor-price", label: "竞品价格压制(root)", drillType: "CompetitorPrice", drillId: "price-ess-a", drillField: "pricePerKwh", kind: "实测", isRoot: true, provenanceSynthetic: false, metricKey: "market_share" },
  { factorId: "cf-bid-loss", label: "大客户丢标(root)", drillType: "BidRecord", drillId: "bid-ess-1", drillField: "win", kind: "实测", isRoot: true, provenanceSynthetic: false, metricKey: "market_share" },
  { factorId: "cf-delivery-reputation", label: "交付声誉受损(root)", drillType: "OverdueRecord", drillId: "od-cg", drillField: "overdueDays", kind: "实测", isRoot: true, provenanceSynthetic: false, metricKey: "market_share" },
];

// WO-CEO-DATA-2 营收域因果因素（多假设：pipeline 收缩·价格侵蚀·客户流失）。
const REVENUE_CAUSAL_FACTORS = [
  { factorId: "cf-revenue-gap", label: "营收缺口", drillType: "PipelineOpportunity", drillId: "pipe-total", drillField: "amount", kind: "派生", isRoot: false, provenanceSynthetic: false, metricKey: "revenue" },
  { factorId: "cf-pipeline-shrink", label: "pipeline 收缩(root)", drillType: "PipelineOpportunity", drillId: "pipe-ess-q3", drillField: "amount", kind: "实测", isRoot: true, provenanceSynthetic: false, metricKey: "revenue" },
  { factorId: "cf-price-erosion", label: "价格侵蚀(root)", drillType: "PriceRealization", drillId: "pr-ess-1", drillField: "realizedPrice", kind: "实测", isRoot: true, provenanceSynthetic: false, metricKey: "revenue" },
  { factorId: "cf-churn", label: "客户流失(root)", drillType: "Customer", drillId: "cust_0", drillField: "maxOverdueDays", kind: "实测", isRoot: true, provenanceSynthetic: false, metricKey: "revenue" },
];

// WO-CEO-DATA-2 现金域因果因素（多假设：AR 账龄·DSO 拉伸·客户集中度）。
const CASH_CAUSAL_FACTORS = [
  { factorId: "cf-cash-gap", label: "经营现金缺口", drillType: "ARAging", drillId: "ar-total", drillField: "amount", kind: "派生", isRoot: false, provenanceSynthetic: false, metricKey: "cash" },
  { factorId: "cf-ar-aging", label: "应收账龄恶化(root)", drillType: "ARAging", drillId: "ar-90plus", drillField: "bucket", kind: "实测", isRoot: true, provenanceSynthetic: false, metricKey: "cash" },
  { factorId: "cf-dso-stretch", label: "DSO 拉伸(root)", drillType: "DSO", drillId: "dso-ess", drillField: "days", kind: "实测", isRoot: true, provenanceSynthetic: false, metricKey: "cash" },
  { factorId: "cf-customer-concentration", label: "客户集中度(root)", drillType: "Customer", drillId: "cust_0", drillField: "receivables", kind: "实测", isRoot: true, provenanceSynthetic: false, metricKey: "cash" },
];

// WO-CEO-DATA-2 需求达成域因果因素（多假设：预测偏差·产能短缺·物料短缺）。
const DEMAND_ATTAIN_CAUSAL_FACTORS = [
  { factorId: "cf-demand-attain-gap", label: "需求达成缺口", drillType: "MaterialBalance", drillId: "mbal-2", drillField: "gapTon", kind: "派生", isRoot: false, provenanceSynthetic: false, metricKey: "demand_attain" },
  { factorId: "cf-forecast-bias", label: "预测偏差(root)", drillType: "DecisionGap", drillId: "dgap-forecast", drillField: "severity", kind: "决策", isRoot: true, provenanceSynthetic: false, metricKey: "demand_attain" },
  { factorId: "cf-capacity-short", label: "产能瓶颈(root)", drillType: "Equipment", drillId: "DYNAMIC-EQUIP", drillField: "oee_current", kind: "实测", isRoot: true, provenanceSynthetic: false, metricKey: "demand_attain" },
  { factorId: "cf-material-short", label: "物料短缺(root)", drillType: "MaterialBalance", drillId: "DYNAMIC-MBAL", drillField: "gapTon", kind: "派生", isRoot: true, provenanceSynthetic: false, metricKey: "demand_attain" },
];

export const CAUSAL_FACTORS = [
  ...SUPPLY_CAUSAL_FACTORS,
  ...MARKET_SHARE_CAUSAL_FACTORS,
  ...REVENUE_CAUSAL_FACTORS,
  ...CASH_CAUSAL_FACTORS,
  ...DEMAND_ATTAIN_CAUSAL_FACTORS,
];

// WO-CEO-3 触发规则（信号阈值→行动·decision_play 引擎评估·阈值可被 RuleEntry.params 覆盖·C3）。
// 信号：li_carbonate_price=ExternalSignal.value；licarb_pct_cum=CommodityPriceTrend 累计涨幅(引擎派生)。
const TRIGGER_RULES = [
  { triggerId: "trig-backup-cert", signalRef: "licarb_pct_cum", op: ">", threshold: 12, action: "启动备份供应商认证", actionDetail: "锂价累计涨幅越阈 → 提前激活备份池认证，压缩认证周期", cfgRuleKey: "trigger_thresholds" },
  { triggerId: "trig-lta-reprice", signalRef: "li_carbonate_price", op: ">", threshold: 90000, action: "长协重谈加价格联动条款", actionDetail: "碳酸锂现价越阈 → 触发长协价格联动条款重谈，止住违约敞口", cfgRuleKey: "trigger_thresholds" },
  { triggerId: "trig-fx-hedge", signalRef: "usd_cny", op: ">", threshold: 8, action: "启动汇率对冲", actionDetail: "汇率越阈 → 对冲出口营收（当前未越·不 fire）", cfgRuleKey: "trigger_thresholds" },
];

// WO-CEO-2 caused_by 因果边（果→因·真实物化·gap_attribution 引擎遍历输出边序列 C2）。
// 供应链域（seg_attain / gross_profit 复用）。
const SUPPLY_CAUSAL_EDGES: { from: string; to: string }[] = [
  { from: "cf-cathode-shortage", to: "cf-upstream-cut" },
  { from: "cf-upstream-cut", to: "cf-lta-breach" },
  { from: "cf-lta-breach", to: "cf-ore-price" },
  { from: "cf-ore-price", to: "cf-geopolitical" },
  { from: "cf-geopolitical", to: "cf-decision-gap" },
  { from: "cf-upstream-cut", to: "cf-backup-thin" },
  { from: "cf-backup-thin", to: "cf-cert-cycle" },
];

// 市场份额域：份额缺口→竞品价格/丢标/交付声誉。
const MARKET_SHARE_CAUSAL_EDGES: { from: string; to: string }[] = [
  { from: "cf-share-gap", to: "cf-competitor-price" },
  { from: "cf-share-gap", to: "cf-bid-loss" },
  { from: "cf-share-gap", to: "cf-delivery-reputation" },
];

// 营收域：营收缺口→pipeline 收缩/价格侵蚀/客户流失。
const REVENUE_CAUSAL_EDGES: { from: string; to: string }[] = [
  { from: "cf-revenue-gap", to: "cf-pipeline-shrink" },
  { from: "cf-revenue-gap", to: "cf-price-erosion" },
  { from: "cf-revenue-gap", to: "cf-churn" },
];

// 现金域：现金缺口→AR 账龄/DSO 拉伸/客户集中度。
const CASH_CAUSAL_EDGES: { from: string; to: string }[] = [
  { from: "cf-cash-gap", to: "cf-ar-aging" },
  { from: "cf-cash-gap", to: "cf-dso-stretch" },
  { from: "cf-cash-gap", to: "cf-customer-concentration" },
];

// 需求达成域：需求缺口→预测偏差/产能瓶颈/物料短缺。
const DEMAND_ATTAIN_CAUSAL_EDGES: { from: string; to: string }[] = [
  { from: "cf-demand-attain-gap", to: "cf-forecast-bias" },
  { from: "cf-demand-attain-gap", to: "cf-capacity-short" },
  { from: "cf-demand-attain-gap", to: "cf-material-short" },
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
  // WO-CEO-DATA-2 每指标 drill 真对象
  competitorShares: Record<string, unknown>[];
  bidRecords: Record<string, unknown>[];
  competitorPrices: Record<string, unknown>[];
  pipelineOpportunities: Record<string, unknown>[];
  winLossRecords: Record<string, unknown>[];
  priceRealizations: Record<string, unknown>[];
  arAgings: Record<string, unknown>[];
  dsos: Record<string, unknown>[];
  overdueRecords: Record<string, unknown>[];
}

/** 确定性生成（基于型号/基地/订单上下文 + seed 派生子流）。scale 控工业级数据量（XL）。 */
export function generateExtended(
  seed: number,
  ctx: {
    models: { modelId: string }[];
    bases: { baseId: string; name: string }[];
    lines: { lineId: string }[];
    equipment: { equipId: string; oeeA?: number; oeeP?: number; oeeQ?: number; oee_current?: number }[];
    materialBalances: { matBalId: string; gapTon?: number }[];
  },
  scale: "S" | "M" | "L" | "XL" = "L",
): ExtendedData {
  const rng = mulberry32(seed + 7919); // 独立子流，与主生成不串扰
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

  // WO-CEO-2 供货量：正极 3 家植入减供（actual = contracted × onTimeRate → <contracted 减供）;
  // 其余供应商按 minOrderQty×频次派生一个约定量。全常数/派生·不消耗 rng·R6 字节一致。
  const suppliers = SUPPLIERS.map((s) => {
    const contracted = CATHODE_CONTRACT[s.supplierId] ?? Math.round(s.minOrderQty * 4);
    return {
      ...s,
      contractedSupplyTon: contracted,
      actualSupplyTon: Math.round(contracted * s.onTimeRate),
      // §2b 真源字段：最近 PO 交期/单号（合成种子用确定性派生值，真源上传后覆盖）。
      deliveryDate: "2026-06-28",
      poNumber: `PO-${s.supplierId.replace("SUP-", "")}-2026Q2`,
    };
  });

  // WO-CEO-DATA-2 每指标 drill 真对象（确定性合成种子；真源上传后可经 record-materialize 覆盖）。
  const competitorShares = [
    { shareId: "share-global", competitor: "self", segment: "全球", sharePct: 21.5, period: "2026-Q2" },
    { shareId: "share-ess", competitor: "self", segment: "储能", sharePct: 28.0, period: "2026-Q2" },
    { shareId: "share-ess-comp", competitor: "竞对A", segment: "储能", sharePct: 34.5, period: "2026-Q2" },
  ];
  const bidRecords = [
    { bidId: "bid-ess-1", segment: "储能", win: false, lossReason: "竞对低价", amount: 45000, competitorRef: "竞对A" },
    { bidId: "bid-pas-1", segment: "乘用车", win: true, lossReason: "", amount: 28000, competitorRef: "" },
  ];
  const competitorPrices = [
    { priceId: "price-ess-a", competitor: "竞对A", model: "方形-LFP", pricePerKwh: 420, period: "2026-Q2" },
    { priceId: "price-ess-self", competitor: "self", model: "方形-LFP", pricePerKwh: 465, period: "2026-Q2" },
  ];
  const pipelineOpportunities = [
    { oppId: "pipe-total", segment: "合计", stage: "全部", amount: 680000, winProb: 0.35 },
    { oppId: "pipe-ess-q3", segment: "储能", stage: "Q3可关单", amount: 120000, winProb: 0.25 },
  ];
  const winLossRecords = [
    { recordId: "wl-ess-1", oppId: "pipe-ess-q3", result: "LOST" as const, reason: "价格劣势", amount: 85000 },
    { recordId: "wl-pas-1", oppId: "pipe-pas-1", result: "WIN" as const, reason: "", amount: 32000 },
  ];
  const priceRealizations = [
    { priceId: "pr-ess-1", model: "方形-LFP", listPrice: 480, realizedPrice: 465, period: "2026-Q2" },
    { priceId: "pr-pas-1", model: "4680-NCM", listPrice: 620, realizedPrice: 615, period: "2026-Q2" },
  ];
  const arAgings = [
    { agingId: "ar-total", customerRef: "ALL", bucket: "0-30", amount: 120000, period: "2026-Q2" },
    { agingId: "ar-90plus", customerRef: "商用车集团G", bucket: "90+", amount: 38000, period: "2026-Q2" },
  ];
  const dsos = [
    { dsoId: "dso-ess", segment: "储能", days: 78, period: "2026-Q2" },
    { dsoId: "dso-com", segment: "商用车", days: 95, period: "2026-Q2" },
  ];
  const overdueRecords = [
    { overdueId: "od-cg", invoiceRef: "INV-CG-001", overdueDays: 38, customerRef: "商用车集团G", amount: 12600 },
    { overdueId: "od-sd", invoiceRef: "INV-SD-001", overdueDays: 12, customerRef: "储能集成商D", amount: 8400 },
  ];

  // WO-CEO-DATA-2：动态绑定 demand_attain 产能/物料短缺下钻到真实对象（不消耗 rng·R6 稳定）。
  const worstEquip = ctx.equipment.length
    ? ctx.equipment.slice().sort((a, b) => {
        const ao = a.oee_current ?? (a.oeeA ?? 1) * (a.oeeP ?? 1) * (a.oeeQ ?? 1);
        const bo = b.oee_current ?? (b.oeeA ?? 1) * (b.oeeP ?? 1) * (b.oeeQ ?? 1);
        return ao - bo;
      })[0]
    : undefined;
  const worstMbal = ctx.materialBalances.length
    ? ctx.materialBalances.slice().sort((a, b) => (b.gapTon ?? 0) - (a.gapTon ?? 0))[0]
    : undefined;
  const causalFactors = CAUSAL_FACTORS.map((cf) => {
    if (cf.factorId === "cf-capacity-short" && worstEquip) return { ...cf, drillId: worstEquip.equipId };
    if (cf.factorId === "cf-material-short" && worstMbal) return { ...cf, drillId: worstMbal.matBalId };
    return cf;
  });

  return {
    materials, materialBatches, customers, arInvoices, certifications, energyMeters, changeoverMatrix,
    capexProjects, purchaseOrders, carbonFactors, financeAccounts, financeMetrics, suppliers,
    longTermAgreements: LONG_TERM_AGREEMENTS, backupSupplierPools: BACKUP_SUPPLIER_POOLS,
    commodityPriceTrends: COMMODITY_PRICE_TRENDS, decisionGaps: DECISION_GAPS, causalFactors,
    triggerRules: TRIGGER_RULES,
    competitorShares, bidRecords, competitorPrices, pipelineOpportunities, winLossRecords,
    priceRealizations, arAgings, dsos, overdueRecords,
  };
}
