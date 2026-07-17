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

/** 严重度分级（v2·用于归因节点与结果顶层分级） */
export const SeverityKindSchema = z.enum(["critical", "major", "minor", "info"]);
export type SeverityKind = z.infer<typeof SeverityKindSchema>;

/** MetricCausalBinding 配置：metricKey → 优先因果根假设 + 域权重（v2）。
 *  实际以 RuleEntry(params) 扁平键形式持久化（例：`seg_attain_ess:cf-decision-gap`=0.6、
 *  `seg_attain_ess:domain:decision`=0.7），本 schema 供运行时解析/校验。 */
export const MetricCausalBindingSchema = z.object({
  metricKey: z.string(),
  roots: z.array(z.string()).default([]), // 优先因果根 factorId 列表
  domainWeights: z.record(z.string(), z.number()).default({}), // 按域（decision/external/supply…）的权重
  fallbackToSupplyChain: z.boolean().default(true), // 无绑定/无命中根时是否回落供应链根
});
export type MetricCausalBinding = z.infer<typeof MetricCausalBindingSchema>;

export const GapProvenanceSchema = z.object({
  kind: GapProvenanceKindSchema,
  drillType: z.string().optional(), // 下钻源对象类型（Equipment/MaterialBalance/Supplier/CommodityPriceTrend/DecisionGap）
  drillId: z.string().optional(), // 源对象 id（R13 可下钻）
  drillField: z.string().optional(), // 取值字段（oee_current/gapTon/actualSupplyTon/pctChange）
  drillValue: z.number().optional(), // 该字段真值（改它→归因变·C5 铁律）
  provenanceSynthetic: z.boolean().optional(), // 合成源诚实标灰（地缘/矿价无真源时·不冒充实测）
  severityKind: SeverityKindSchema.optional(), // v2 严重度分级
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

// ── 多假设归因结果（v2·当 Metric 有多个根假设时，每条假设的分配） ─────────────
export const MetricAttributionHypothesisSchema = z.object({
  rootFactorId: z.string(),
  rootFactorLabel: z.string(),
  allocatedGap: z.number(), // 折算到目标 gap 量纲的分配值
  share: z.number(), // 占因果层可解释量的比例
  severityKind: SeverityKindSchema,
  causalPath: z.array(z.string()).default([]), // 从结构叶到该根的路径
  leafIds: z.array(z.string()).default([]), // 本假设覆盖的叶子 id 列表
});
export type MetricAttributionHypothesis = z.infer<typeof MetricAttributionHypothesisSchema>;

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
  noGap: z.boolean().optional(), // v2·actual>=target/gap<=0 时短路边界
  levels: z.array(GapAttributionLevelSchema), // 结构反向分摊（gap 单位）
  atomicLeaves: z.array(GapAttributionNodeSchema), // ~20 叶子原子因素（结构叶 + 因果链终点）
  causalEdges: z.array(
    z.object({ from: z.string(), to: z.string(), viaLinkKey: z.string() }),
  ), // 真实遍历经过的 caused_by 边（C2·非硬编码）
  reconChecks: z.array(GapReconCheckSchema),
  reconciled: z.boolean(), // 全层勾稽通过
  residualPct: z.number(), // 顶层 residual 占 totalGap 比（C6·诚实<15%）
  severityKind: SeverityKindSchema.optional(), // v2 结果顶层严重度
  hypotheses: z.array(MetricAttributionHypothesisSchema).optional(), // v2 多假设分配
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
});
export type CommodityPriceTrend = z.infer<typeof CommodityPriceTrendSchema>;

/** 决策缺陷：因果链终点（前瞻缺失/条款缺失·可归的最终根）。severity 驱动叶级贡献。 */
export const DecisionGapSchema = z.object({
  gapId: z.string(),
  kind: z.enum(["前瞻缺失", "条款缺失"]),
  description: z.string(),
  severity: z.number(), // 0–1（严重度·改它→决策叶贡献变）
  ownerRef: z.string().optional(),
});
export type DecisionGap = z.infer<typeof DecisionGapSchema>;
