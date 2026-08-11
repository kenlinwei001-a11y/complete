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
  drillId: z.string().optional(), // 源对象 id（R13 可下钻；"*" 表示按类型聚合）
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
  // WO-CEO-DATA-2 §2b 真源字段：价格联动公式 + 生效/失效日期（接真 ERP/合同履约）。
  priceFormula: z.string().optional(),
  effectiveDate: z.string().optional(),
  expiryDate: z.string().optional(),
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
  // WO-CEO-DATA-2 §2b 真源字段：数据来源 + 规格 + 币种（接真行情 SMM/Wind/百川）。
  source: z.string().optional(),
  spec: z.string().optional(),
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
  // WO-CEO-DATA-2 §2b 真源字段：评审日期 + 证据（非实测·评审录入·接真前标灰）。
  reviewDate: z.string().optional(),
  evidence: z.string().optional(),
});
export type DecisionGap = z.infer<typeof DecisionGapSchema>;

// ── WO-FACTOR-SCOPE-SINGLESOURCE · 因子作用域**单一来源**（治 G-CAPFACTOR-VOCAB-SPLIT） ──────
//
// 病灶（`docs/AUDIT-factor-scope-vocab.md`）：产能推演页的 7 个因子 chip 传的是 **BN 张力词表**
// 的中文因子名（`瓶颈工序`/`设备OEE`…·出处 `synthetic/battery.ts:225 BN_FACTORS`），
// 而 `gap_attribution` 的 `scope.factorId` 认的是 **`CausalFactor.factorId`**（`cf-*`）。
// 两张词表交集 = **0** ⇒ 7 个按钮返回逐字节相同的基地树，「按因子细分」一次都没生效过。
//
// 单源三件套（缺一件病就会以另一种形态复发）：
//  ① **值绑 id·显示绑 label**：chip 的 value 必须是 `CausalFactorId`，label 只用于渲染。
//  ② **候选集由引擎下发**：`GapScope.availableFactors` —— 前端不得再从卡面因子名拼候选，
//     「哪些因子今天真能细分」只有引擎（种子数据 + 本基地是否有承载对象）知道。
//  ③ **编译期拦截**：`CausalFactorId` 是**品牌类型**，裸 `string`（如 `card.factor`）**不可赋值**给它
//     ⇒ 一旦有人写回 `factorOptions={[card.factor, ...]}`，`tsc` 当场红，而不是等用户点了才发现。
//     反伪造：唯一合法铸造口是 `asCausalFactorId()`（只接受引擎回执里的 id）。

/** 因果因子 id 的**品牌类型**：裸 string 不可赋值 ⇒ 把 BN 因子名当 factorId 传会在编译期红。 */
export type CausalFactorId = string & { readonly __brand: "CausalFactorId" };

/** 唯一合法铸造口：只应喂**引擎回执**里的 id（`GapScope.availableFactors[].factorId`）。 */
export function asCausalFactorId(raw: string): CausalFactorId {
  return raw as CausalFactorId;
}

/** zod 侧同源（解析引擎回执时用；`transform` 后拿到的就是品牌类型）。 */
export const CausalFactorIdSchema = z.string().min(1).transform(asCausalFactorId);

/** 因果因素节点（caused_by 遍历的一等节点·每节点下钻到真证据对象）。 */
export const CausalFactorSchema = z.object({
  factorId: z.string(),
  label: z.string(),
  drillType: z.string(),
  drillId: z.string(),
  drillField: z.string(),
  kind: z.enum(["实测", "派生", "外部信号", "决策"]),
  isRoot: z.boolean(),
  provenanceSynthetic: z.boolean(),
  // WO-CEO-DATA-2：每个 CausalFactor 归属一个指标域，供引擎按指标选因果根。
  metricKey: z.string().optional(),
  // ── WO-FACTOR-SCOPE-SINGLESOURCE · 作用域内解析声明（**数据驱动**·R14）─────────────────
  // 产能域的 7 个因子必须落到**本基地**的对象（否则 13 张基地卡同一份证据 = R1「8/8 卡全同」老病）。
  // 而 `drillId` 是单值 ⇒ 这里声明「怎么在作用域内挑那一个对象」，由引擎在查询期解析。
  // 绝不在引擎里内联「哪个因子查哪张表」的 if 链 —— 那就是第二套词表，本单要消灭的正是这个。
  /** 作用域字段：该 drillType 上承载基地键的属性名（如 `baseId`）。给了才做 per-base 解析。 */
  baseScopeField: z.string().optional(),
  /** 作用域内选谁：`max` = 该字段最大者最紧（利用率/到货天/停机时长）；`min` = 最小者最紧（OEE/良率/班次工时/齐套天数）。 */
  drillPick: z.enum(["max", "min"]).optional(),
  /** 归一口径（把真值折成 0–1 的"紧张度"权重，喂结构分摊）：
   *  - `ratio`        字段本身即 0–1 比率，紧张度 = 值（越大越紧·如利用率）
   *  - `inverseRatio` 字段本身即 0–1 比率，紧张度 = 1 − 值（越小越紧·如 OEE/良率）
   *  - `popMax`       非比率量，按**本作用域内最大值**归一，紧张度 = 值/最大（越大越紧·如到货天/停机分钟）
   *  - `popMin`       非比率量，按**本作用域内最大值**归一，紧张度 = 1 − 值/最大（越小越紧·如班次工时/齐套天数）
   */
  drillNorm: z.enum(["ratio", "inverseRatio", "popMax", "popMin"]).optional(),
  /** 可选等值过滤（如 `EquipmentDowntime.reason === "换型"`）。 */
  drillFilterField: z.string().optional(),
  drillFilterValue: z.string().optional(),
});
export type CausalFactor = z.infer<typeof CausalFactorSchema>;

/**
 * 引擎下发的「本作用域内**真能细分**的因子」——前端 chip 候选集的**唯一**来源。
 * 只有当该因子在本基地**真解析得到承载对象**（objectCount>0）时才会出现在这个列表里
 * ⇒ 界面上不存在「点了永远不生效」的按钮（缺数据的基地直接不下发该 chip，并在 note 里说明）。
 */
export const RefinableFactorSchema = z.object({
  factorId: CausalFactorIdSchema,
  label: z.string(), // 显示名（= CausalFactor.label·如「设备OEE」）
  drillType: z.string(), // 细分后下钻到哪类对象（人话可见·R13）
  drillField: z.string(),
  objectCount: z.number().int(), // 本作用域内解析到的承载对象数（>0 才下发）
});
export type RefinableFactor = z.infer<typeof RefinableFactorSchema>;

/** `gap_attribution` 回执里的**实际生效作用域**（引擎单一出处·前端不再自行推断）。 */
export const GapScopeSchema = z.object({
  baseId: z.string().optional(),
  displayName: z.string().optional(),
  exposure: z.boolean().optional(),
  factorId: z.string().optional(),
  /** 真按该因子细分了吗（false = 传了但引擎无该因果域 → 界面必须据实说，不许假装细分了）。 */
  factorApplied: z.boolean().optional(),
  factorLabel: z.string().optional(),
  factorNote: z.string().optional(),
  /** 本作用域可细分因子集（chip 候选单源）。 */
  availableFactors: z.array(RefinableFactorSchema).optional(),
  /** 一条都没有时的诚实原因（如"本基地无这些因子的承载对象"）。 */
  availableFactorsNote: z.string().optional(),
});
export type GapScope = z.infer<typeof GapScopeSchema>;

// ── WO-CEO-DATA-2 每指标多假设因果域 drill 真对象 schema ────────────────────────

/** 市场份额：竞品份额（按细分/周期）。 */
export const CompetitorShareSchema = z.object({
  shareId: z.string(),
  competitor: z.string(),
  segment: z.string(),
  sharePct: z.number(),
  period: z.string(),
});
export type CompetitorShare = z.infer<typeof CompetitorShareSchema>;

/** 竞标记录：逐单 win/loss + 丢标原因 + 金额 + 竞品引用。 */
export const BidRecordSchema = z.object({
  bidId: z.string(),
  segment: z.string(),
  win: z.boolean(),
  lossReason: z.string(),
  amount: z.number(),
  competitorRef: z.string(),
});
export type BidRecord = z.infer<typeof BidRecordSchema>;

/** 竞品价格：竞品×型号×周期 价格（$/kWh）。 */
export const CompetitorPriceSchema = z.object({
  priceId: z.string(),
  competitor: z.string(),
  model: z.string(),
  pricePerKwh: z.number(),
  period: z.string(),
});
export type CompetitorPrice = z.infer<typeof CompetitorPriceSchema>;

/** 营收漏斗：逐机会阶段/金额/赢率。 */
export const PipelineOpportunitySchema = z.object({
  oppId: z.string(),
  segment: z.string(),
  stage: z.string(),
  amount: z.number(),
  winProb: z.number(),
});
export type PipelineOpportunity = z.infer<typeof PipelineOpportunitySchema>;

/** 赢单/丢单记录：逐单结果/原因/金额。 */
export const WinLossRecordSchema = z.object({
  recordId: z.string(),
  oppId: z.string(),
  result: z.enum(["WIN", "LOST"]),
  reason: z.string(),
  amount: z.number(),
});
export type WinLossRecord = z.infer<typeof WinLossRecordSchema>;

/** 价格实现：型号×周期 列表价 vs 实际成交价。 */
export const PriceRealizationSchema = z.object({
  priceId: z.string(),
  model: z.string(),
  listPrice: z.number(),
  realizedPrice: z.number(),
  period: z.string(),
});
export type PriceRealization = z.infer<typeof PriceRealizationSchema>;

/** 应收账款账龄：逐客户×账龄桶金额。 */
export const ARAgingSchema = z.object({
  agingId: z.string(),
  customerRef: z.string(),
  bucket: z.enum(["0-30", "30-60", "60-90", "90+"]),
  amount: z.number(),
  period: z.string(),
});
export type ARAging = z.infer<typeof ARAgingSchema>;

/** DSO：逐细分×周期 天数。 */
export const DSOSchema = z.object({
  dsoId: z.string(),
  segment: z.string(),
  days: z.number(),
  period: z.string(),
});
export type DSO = z.infer<typeof DSOSchema>;

/** 逾期记录：逐发票逾期天数/金额。 */
export const OverdueRecordSchema = z.object({
  overdueId: z.string(),
  invoiceRef: z.string(),
  overdueDays: z.number(),
  customerRef: z.string(),
  amount: z.number(),
});
export type OverdueRecord = z.infer<typeof OverdueRecordSchema>;

/**
 * WO-TIER3-CASH-GM · 毛利桥（GrossMarginBridge）：gross_profit 专属反向归因域的 drill 真对象。
 * 把毛利缺口拆到「量/价/成本」三杠杆 —— impactYi 是**数据字段**（R14·非引擎叙事常数），
 * 由既有种子（DemandSegment p50/priceWan/marginPct/floorPct/act × MaterialBalance gapTon/netDemandTon）
 * 确定性派生（R6·无 rng/时钟）。gap_attribution 按 metricKey=gross_profit 路由到 cf-gm-gap→量/价/成本三根，
 * 每叶 drillType=GrossMarginBridge·drillField=impactYi·drillValue!==0（C5 改颗粒→归因变）。
 */
export const GrossMarginBridgeSchema = z.object({
  bridgeId: z.string(),
  lever: z.enum(["total", "volume", "price", "cost"]), // 杠杆：合计/量/价/成本
  segment: z.string(), // 代表细分（人话溯源）
  impactYi: z.number(), // 毛利影响（亿·数据字段·改它→该根贡献变·C5）
  driver: z.string(), // 驱动说明（人话）
  period: z.string(),
});
export type GrossMarginBridge = z.infer<typeof GrossMarginBridgeSchema>;
