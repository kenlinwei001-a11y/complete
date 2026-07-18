import { z } from "zod";

/**
 * WO-CEO-2 · gap_attribution 深度反向归因引擎契约（本体登记见 SYSTEM-ONTOLOGY.md §2/§3/§4/§5/§8 GAP-ATTR）。
 *
 * 北极星：总目标缺口 → 沿本体反向多跳（结构链·gap 单位分摊）+ 沿 `caused_by` 因果边继续溯（因果链·占比）
 * → 分摊到 ~20 个叶子原子因素，每层勾稽 Σ子+residual=父gap，每叶从真颗粒派生、每跳可溯（R13）。
 *
 * 两种遍历别混（§3 算法）：
 *  ① 结构反向分摊：gap 单位可量化，父 gap 按 子驱动值×归因系数(R14) 分摊，归一到**父 gap 量纲**（非到 1），
 *     每层强制 Σ子贡献 + residual = 父gap（硬勾稽·residual 诚实承未解释）。
 *  ② 因果遍历：结构叶的"问题"节点沿 caused_by 边溯到地缘/决策终点——不再切 gap，是因果解释 + 贡献占比。
 *
 * 铁律（KILL-MOCK-RED）：叶级贡献由**真颗粒对象值**派生（OEE/齐套/供货/矿价）——改一颗粒→归因跟着变；禁叙事常数。
 * 无真数据源的地缘/矿价诚实合成标灰（provenanceSynthetic·你本机数据 agent 会灌真）。
 */

// ── 归因节点出处（R13 每跳可溯·kind = 真值来源性质） ────────────────────────────
export const GapProvenanceKindSchema = z.enum([
  "实测", // 真颗粒实测值（Equipment.oee_current / Order.value）
  "派生", // 本体派生字段（MaterialBalance.gapTon 等）
  "外部信号", // ExternalSignal / CommodityPriceTrend（合成源诚实标灰）
  "决策", // DecisionGap（决策缺陷·因果链终点·布尔/severity）
]);
export type GapProvenanceKind = z.infer<typeof GapProvenanceKindSchema>;

export const GapProvenanceSchema = z.object({
  kind: GapProvenanceKindSchema,
  drillType: z.string().optional(), // 下钻源对象类型（Equipment/MaterialBalance/Supplier/CommodityPriceTrend/DecisionGap）
  drillId: z.string().optional(), // 源对象 id（R13 可下钻）
  drillField: z.string().optional(), // 取值字段（oee_current/gapTon/actualSupplyTon/pctChange）
  drillValue: z.number().optional(), // 该字段真值（改它→归因变·C5 铁律）
  provenanceSynthetic: z.boolean().optional(), // 合成源诚实标灰（地缘/矿价无真源时·不冒充实测）
});
export type GapProvenance = z.infer<typeof GapProvenanceSchema>;

// ── 归因节点（结构层 or 因果层的一个因素） ─────────────────────────────────────
export const GapAttributionNodeSchema = z.object({
  id: z.string(),
  factor: z.string(), // 因素名（人话·如"化成瓶颈"/"正极粉短缺"/"上游减供"）
  contribution: z.number(), // 贡献值（已折算到目标 gap 量纲）
  unit: z.string(), // 量纲（折算后 = 目标 gap 单位，如 亿/pt）
  share: z.number().optional(), // 占父节点 gap 的比例（诊断用·非勾稽口径）
  path: z.array(z.string()).default([]), // 结构反向路径（对象 id 序列·从目标 Metric 到本节点）
  causalPath: z.array(z.string()).default([]), // 因果边序列（caused_by 遍历真实经过的节点·非硬编码文案）
  provenance: GapProvenanceSchema,
});
export type GapAttributionNode = z.infer<typeof GapAttributionNodeSchema>;

// ── 结构分摊的一层（每层勾稽 Σ子+residual=父gap） ───────────────────────────────
export const GapAttributionLevelSchema = z.object({
  depth: z.number().int(),
  label: z.string(), // 层名（如"业务细分"/"基地×线"/"瓶颈"/"订单"）
  nodes: z.array(GapAttributionNodeSchema),
  residual: z.number(), // 本层未解释残差（诚实承·Σ子 + residual = 父gap）
});
export type GapAttributionLevel = z.infer<typeof GapAttributionLevelSchema>;

// ── 勾稽校验记录（C1·逐层 Σ子+residual==父gap，浮点误差 ≤1e-4） ─────────────────
export const GapReconCheckSchema = z.object({
  depth: z.number().int(),
  label: z.string(),
  parentGap: z.number(),
  sumChildren: z.number(),
  residual: z.number(),
  ok: z.boolean(), // |sumChildren + residual − parentGap| ≤ 1e-4
});
export type GapReconCheck = z.infer<typeof GapReconCheckSchema>;

// ── 引擎产物：瀑布 DAG + 叶子表 + residual ────────────────────────────────────
export const GapAttributionOutputSchema = z.object({
  rootMetric: z.object({
    key: z.string(),
    name: z.string(),
    unit: z.string(),
    target: z.number(),
    actual: z.number(),
    gap: z.number(), // target − actual（缺口·正=未达）
  }),
  totalGap: z.number(),
  levels: z.array(GapAttributionLevelSchema), // 结构反向分摊（gap 单位）
  atomicLeaves: z.array(GapAttributionNodeSchema), // ~20 叶子原子因素（结构叶 + 因果链终点）
  causalEdges: z.array(
    z.object({ from: z.string(), to: z.string(), viaLinkKey: z.string() }),
  ), // 真实遍历经过的 caused_by 边（C2·非硬编码）
  reconChecks: z.array(GapReconCheckSchema),
  reconciled: z.boolean(), // 全层勾稽通过
  residualPct: z.number(), // 顶层 residual 占 totalGap 比（C6·诚实<15%）
  summary: z.string(),
});
export type GapAttributionOutput = z.infer<typeof GapAttributionOutputSchema>;

// ── 新增本体对象 schema（供应链 / 地缘 / 决策域·contracts-only-shared R1） ────────

/** 长协：约定量 / 价格联动条款有无 / 违约成本 / 实际交付（actual<contracted → 违约·因果链一环）。 */
export const LongTermAgreementSchema = z.object({
  ltaId: z.string(),
  supplierId: z.string(),
  materialType: z.string(),
  contractedQtyTon: z.number(), // 约定量
  actualDeliveredTon: z.number(), // 实际交付（< 约定 = 违约）
  priceLinked: z.boolean(), // 价格联动条款有无（无 → 矿价涨不传导保护 → 决策缺陷）
  breachPenaltyWan: z.number(), // 违约成本（万元）
  // WO-CEO-DATA-2：接真 ERP/合同履约留的字段（真源前标灰）。
  priceFormula: z.string().optional(), // 价格联动公式
  effectiveDate: z.string().optional(),
  expiryDate: z.string().optional(),
  deliveryDate: z.string().optional(),
  poNumber: z.string().optional(),
});
export type LongTermAgreement = z.infer<typeof LongTermAgreementSchema>;

/** 备份供应池：成员数 / 认证周期 / 采购频次（成员少+认证长 → 断供时无替代 → root=认证周期长）。 */
export const BackupSupplierPoolSchema = z.object({
  poolId: z.string(),
  materialType: z.string(),
  memberCount: z.number().int(), // 备份成员数（少 → 池薄）
  certWeeks: z.number(), // 认证周期（周·长 → 临时切换来不及·root 原子因素）
  procureFreqPerYear: z.number(),
});
export type BackupSupplierPool = z.infer<typeof BackupSupplierPoolSchema>;

/** 矿产价格趋势：逐周价格 + 涨幅（碳酸锂/硫酸镍·涨 → 上游成本 → 减供/违约）。 */
export const CommodityPriceTrendSchema = z.object({
  trendId: z.string(),
  commodity: z.string(), // 碳酸锂 / 硫酸镍
  weekOf: z.string(), // ISO 周锚（YYYY-MM-DD）
  pricePerTon: z.number(),
  pctChange: z.number(), // 环比涨幅（%·正=涨）
  // WO-CEO-DATA-2：真行情溯源字段。
  source: z.string().optional(),
  spec: z.string().optional(), // 电池级 / 工业级
  currency: z.string().optional(),
});
export type CommodityPriceTrend = z.infer<typeof CommodityPriceTrendSchema>;

/** 决策缺陷：因果链终点（前瞻缺失/条款缺失·可归的最终根）。severity 驱动叶级贡献。 */
export const DecisionGapSchema = z.object({
  gapId: z.string(),
  kind: z.enum(["前瞻缺失", "条款缺失"]),
  description: z.string(),
  severity: z.number(), // 0–1（严重度·改它→决策叶贡献变）
  ownerRef: z.string().optional(),
  // WO-CEO-DATA-2：评审录入溯源。
  reviewDate: z.string().optional(),
  evidence: z.string().optional(),
});
export type DecisionGap = z.infer<typeof DecisionGapSchema>;

/** 供应商：接真 ERP/SRM 供货履约字段。 */
export const SupplierSchema = z.object({
  supplierId: z.string(),
  supplierCode: z.string(),
  name: z.string(),
  category: z.string(),
  materialType: z.string(),
  rating: z.string(),
  region: z.string(),
  leadTime: z.number(),
  minOrderQty: z.number(),
  onTimeRate: z.number(),
  status: z.string(),
  // WO-CEO-DATA-2：真源供货履约字段。
  contractedSupplyTon: z.number().optional(),
  actualSupplyTon: z.number().optional(),
  deliveryDate: z.string().optional(),
  poNumber: z.string().optional(),
});
export type Supplier = z.infer<typeof SupplierSchema>;

// ── WO-CEO-DATA-2 · 每指标多假设因果域 drill 真对象 schema（contracts-only-shared） ──

/** 市场份额域：竞品份额（按竞品·细分·周期）。 */
export const CompetitorShareSchema = z.object({
  shareId: z.string(),
  competitor: z.string(),
  segment: z.string(),
  sharePct: z.number(), // 百分点 0–100
  period: z.string(),
});
export type CompetitorShare = z.infer<typeof CompetitorShareSchema>;

/** 市场份额域：投标记录（win/lossReason 是丢标率根因）。 */
export const BidRecordSchema = z.object({
  bidId: z.string(),
  segment: z.string(),
  win: z.boolean(),
  lossReason: z.string().optional(), // price / delivery / competitor / churn / ...
  amount: z.number(),
  competitorRef: z.string().optional(),
});
export type BidRecord = z.infer<typeof BidRecordSchema>;

/** 市场份额域：竞品价格（pricePerKwh 驱动份额压力）。 */
export const CompetitorPriceSchema = z.object({
  priceId: z.string(),
  competitor: z.string(),
  model: z.string(),
  pricePerKwh: z.number(), // 元/kWh
  period: z.string(),
});
export type CompetitorPrice = z.infer<typeof CompetitorPriceSchema>;

/** 营收域：商机漏斗（amount / winProb / stage）。 */
export const PipelineOpportunitySchema = z.object({
  oppId: z.string(),
  segment: z.string(),
  stage: z.string(), // lead / proposal / negotiation / closed
  amount: z.number(),
  winProb: z.number(), // 0–1
});
export type PipelineOpportunity = z.infer<typeof PipelineOpportunitySchema>;

/** 营收域：赢单/丢单记录（result / reason）。 */
export const WinLossRecordSchema = z.object({
  oppId: z.string(),
  result: z.enum(["win", "loss", "churn"]),
  reason: z.string().optional(),
});
export type WinLossRecord = z.infer<typeof WinLossRecordSchema>;

/** 营收域：价格实现（listPrice vs realizedPrice 是价格侵蚀真值）。 */
export const PriceRealizationSchema = z.object({
  realizationId: z.string(),
  model: z.string(),
  listPrice: z.number(),
  realizedPrice: z.number(),
  period: z.string(),
});
export type PriceRealization = z.infer<typeof PriceRealizationSchema>;

/** 现金域：AR 账龄桶（bucket=90+ 是现金恶化真值）。 */
export const ARAgingSchema = z.object({
  agingId: z.string(),
  customerRef: z.string(),
  bucket: z.string(), // 0-30 / 30-60 / 60-90 / 90+
  amount: z.number(),
});
export type ARAging = z.infer<typeof ARAgingSchema>;

/** 现金域：DSO（days 是现金回收拉长真值）。 */
export const DSOSchema = z.object({
  dsoId: z.string(),
  segment: z.string(),
  days: z.number(),
  period: z.string(),
});
export type DSO = z.infer<typeof DSOSchema>;

/** 现金域：逾期记录（overdueDays 是客户集中度/现金恶化真值）。 */
export const OverdueRecordSchema = z.object({
  overdueId: z.string(),
  invoiceRef: z.string(),
  overdueDays: z.number(),
  customerRef: z.string(),
});
export type OverdueRecord = z.infer<typeof OverdueRecordSchema>;
