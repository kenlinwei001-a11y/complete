import { z } from "zod";

/**
 * WO-GSIM-2-SOLVER · 全域联合仿真（GlobalSim）请求/响应契约（zod schema）。
 *
 * 说明（"§1 不存在故按 §3 创建"）：工单原稿把本契约标为「§1」，但正线并无 §1 文本；本文件按工单
 * **§3 冻结契约**为唯一权威落成 zod schema（字段形状一字不改·消费方 = datacore portfolio 求解器）。
 *
 * 在既有联合守恒 portfolio（G-PORTFOLIO-LOCAL-ONLY 已闭）之上加 7 维联合数学（同一套线性/装箱模型·
 * 跨「数据(换型 seed 口径/电芯来源) + 引擎(portfolio)」两半·一人整单）：
 *   ① 物料联合约束（materialConstraint）  ② 产线粒度 + 换型按小时（lineGranularity）
 *   ③ 电芯-Pack 两阶段网络（twoStage）    ④ 订单分批（allowSplit）
 *   ⑤ 杠杆再优化（levers）                ⑥ 优先级硬锁（priorityLocks·must_serve）
 *   ⑦ 递进批次承诺（committedBatches → 复用 portfolio committed 预扣机制）
 *
 * 单位红线（★用户校正）：换型全链**小时**（changeoverHours·不残留分钟）。
 * 诚实红线（KILL-MOCK-RED）：WO-DATA 未落的供给（baseDistanceKm/transitDays/freightCost/cellSourceMap/
 * Line.capacityDaily）用 mock 时**标注来源**；`materialConstraint:false` / 无线级实测 → 诚实回退全局值 + 标注，
 * 不假装真数据。确定性 R6（forecastStart 锚·禁 Date.now/random·同输入同杠杆两跑对象/KPI 字节一致）。
 */

// ── 业务类型维度（WO-W5·乘用车/商用车/储能三类差异化经营场景） ──

/**
 * 业务类型（乘用车/商用车/储能）——全局推演的一等数据维度（R14·不写死电池魔数）。
 * 三类真实经营场景截然不同（产品负责人 spec）：
 *   passenger 乘用车：产能不足 + 销售预测远大于实际订单（预测虚高）+ 部分客户需提前交付；
 *   commercial 商用车：产能空闲 + 订单波动大；
 *   storage 储能：产能 ~95% 稳定 + 订单平稳。
 * Order/DemandSegment 各带此维度（合成种子按类型差异化·R6 同 seed 字节一致），
 * 求解器按类型分口径聚合（各类占用率/预测缺口/交付率分别可算），前端可勾选筛选后**真重算**。
 */
export const BusinessTypeSchema = z.enum(["passenger", "commercial", "storage"]);
export type BusinessType = z.infer<typeof BusinessTypeSchema>;

/** 业务类型中文标签（细分 segment 名 ↔ 类型枚举，单一来源·前后端同口径）。 */
export const BUSINESS_TYPE_LABEL: Record<BusinessType, string> = {
  passenger: "乘用车",
  commercial: "商用车",
  storage: "储能",
};

// ── 请求侧 ──

/** 决策订单项（进联合决策集·`x[i,b,t]` 自由变量）。 */
export const GlobalSimDecisionItemSchema = z.object({
  orderId: z.string(),
  model: z.string().optional(),
  qty: z.number().optional(),
});
export type GlobalSimDecisionItem = z.infer<typeof GlobalSimDecisionItemSchema>;

/**
 * 递进批次承诺（committedBatches）：已提交的批次转 portfolio `committed` 承诺占用（固定背景·预扣净产能），
 * decisionSet 在剩余产能上联合解。SEAM：提交批次1 → 该基地净产能真减 → 后续单排布随之变。
 */
export const GlobalSimCommittedBatchSchema = z.object({
  batchId: z.string().optional(),
  orderId: z.string().optional(),
  base: z.string(),
  model: z.string().optional(),
  window: z.number().optional(),
  qty: z.number(),
});
export type GlobalSimCommittedBatch = z.infer<typeof GlobalSimCommittedBatchSchema>;

/**
 * 杠杆（levers·灭 G-WHATIF-HARDCODED-LEVERS）：经 capacity_forecast/generic_inference 真派生调产能/物料 → 重解，
 * 返相对上版 KPI delta（可溯）。`key` 如 formationChannels（化成通道）；`target` = 基地/物料 id；`delta` = 增量。
 */
export const GlobalSimLeverSchema = z.object({
  key: z.string(),
  target: z.string(),
  delta: z.number(),
});
export type GlobalSimLever = z.infer<typeof GlobalSimLeverSchema>;

/** 优先级硬锁（priorityLocks → must_serve 硬约束·保护有代价·总代价真升）。customer 或 segment 二选一。 */
export const GlobalSimPriorityLockSchema = z.object({
  customer: z.string().optional(),
  segment: z.string().optional(),
});
export type GlobalSimPriorityLock = z.infer<typeof GlobalSimPriorityLockSchema>;

/** 优化目标键（≥1·各求一次联合解量化利弊）。 */
export const GlobalSimObjectiveSchema = z.enum([
  "max_ontime",
  "min_delay",
  "min_changeover",
  "min_cost",
  "min_fg_inventory",
]);
export type GlobalSimObjective = z.infer<typeof GlobalSimObjectiveSchema>;

/**
 * ⑤ G-VAR-3 · 求解方法旋钮（多目标组合法·灭 G-WHATIF-HARDCODED-LEVERS 方法半）：把「怎么权衡多目标」
 * 做成可调旋钮——三法结果形状截然不同（改旋钮 → 引擎按对应方法真重解 → objectiveValues/分配真变）：
 *   weighted 加权：各目标按权重线性组合（改权重 → 天平偏移）；
 *   epsilon ε-约束：主目标最优、次目标各不超过 ε 上界（收紧 ε → 主目标让位）；
 *   lexicographic 字典序：按优先级序逐层最优（改优先序 → 分层结果换形）。
 */
export const GlobalSimMethodSchema = z.enum(["weighted", "epsilon", "lexicographic"]);
export type GlobalSimMethod = z.infer<typeof GlobalSimMethodSchema>;

/** ε-约束单条界（key = 次目标键·bound = 上界·收紧即约束更紧·主目标让位）。 */
export const GlobalSimEpsilonSchema = z.object({
  key: z.string(),
  bound: z.number(),
});
export type GlobalSimEpsilon = z.infer<typeof GlobalSimEpsilonSchema>;

export const GlobalSimRequestSchema = z.object({
  /** 推演范围标签（如 "全乘用车跨基地"·仅供溯源/展示）。 */
  scope: z.string().optional(),
  /** 决策订单集（缺省 = 全 OPEN 订单）。 */
  decisionSet: z.array(GlobalSimDecisionItemSchema).optional(),
  /** 递进已承诺批次（转 committed 预扣·固定背景）。 */
  committedBatches: z.array(GlobalSimCommittedBatchSchema).optional(),
  /** 方案目标集（≥1·缺省 [max_ontime, min_cost]）。 */
  objectives: z.array(GlobalSimObjectiveSchema).optional(),
  /** 杠杆再优化（灭 G-WHATIF-HARDCODED-LEVERS）。 */
  levers: z.array(GlobalSimLeverSchema).optional(),
  /** 物料联合约束开关（无物料数据 → false 诚实兜底不假装）。 */
  materialConstraint: z.boolean().optional(),
  /** 订单分批开关（x∈{0,1} → y∈ℤ≥0·Σ_b,t y=qty·加分批固定成本+最小批量）。 */
  allowSplit: z.boolean().optional(),
  /** 产线粒度开关（cap[b,t] → cap[b,line,t]·换型按小时读线上当前在跑型号）。 */
  lineGranularity: z.boolean().optional(),
  /** 电芯-Pack 两阶段网络开关（电芯段→transit→Pack 段→交付=Pack 完工窗·两笔守恒）。 */
  twoStage: z.boolean().optional(),
  /** 优先级硬锁（must_serve）。 */
  priorityLocks: z.array(GlobalSimPriorityLockSchema).optional(),
  /** 冻结子集（复用 portfolio·不进决策集·产能预留或释放）。 */
  frozenOrderIds: z.array(z.string()).optional(),
  frozenCapacityMode: z.enum(["reserve", "release"]).optional(),
  /** 求解种子（R6·缺省 42）。 */
  seed: z.number().optional(),
  /**
   * WO-W5·业务类型勾选筛选（乘/商/储）：非空 → 只对勾选类型的订单+预测集联合推演，产能作用域收窄到该类
   * 订单可产基地 → 矩阵/KPI/客户级影响**真变**（后端真重算·非前端假过滤）。缺省/空 = 全类型（向后兼容）。
   */
  businessTypes: z.array(BusinessTypeSchema).optional(),
  /**
   * ③ G-VAR-1 · 分批交付 per-order 开关（灭「一次交付」硬口径）：集合内订单 → 引擎按分批重算（x∈{0,1}→
   * y∈ℤ≥0·Σ子批=qty·各批可落不同窗口/基地）→ 交付率/成品持库真变。与全局 allowSplit 并存（并集·additive）。
   */
  splitOrderIds: z.array(z.string()).optional(),
  /**
   * ④ G-VAR-2 · 最终交期 per-order（orderId → 最终可接受交付日·自 forecastStart 的天偏移）：放宽该单可排的
   * 最晚时间窗上界 → 引擎在更晚窗口仍可行地承接（而非被挤）→ 推演出「目标交期 vs 最终可达交期」差（真求解·非写死）。
   */
  finalDueDays: z.record(z.string(), z.number()).optional(),
  /** ⑤ G-VAR-3 · 求解方法（缺省 weighted·仅当带方法旋钮时驱动 methodScenario 联合重解）。 */
  method: GlobalSimMethodSchema.optional(),
  /** ⑤ 加权法权重（objectiveKey → 权重·改权重 → 加权组合天平真偏移）。 */
  methodWeights: z.record(z.string(), z.number()).optional(),
  /** ⑤ ε-约束上界集（收紧 ε → 主目标让位·分配真变）。 */
  epsilon: z.array(GlobalSimEpsilonSchema).optional(),
  /** ⑤ 字典序优先级（objectiveKey 序·改序 → 分层最优换形）。 */
  priority: z.array(z.string()).optional(),
});
export type GlobalSimRequest = z.infer<typeof GlobalSimRequestSchema>;

// ── 响应侧 ──

/** 方案 KPI（换型全链小时·在途库存/运费两阶段网络产物·margin 毛利代理）。 */
export const GlobalSimKpiSchema = z.object({
  ontime: z.number(), // 按期项数（max_ontime 主目标值）
  cost: z.number(), // 综合代价（延误+换型+运费+持有+未排罚）
  changeoverHours: z.number(), // ★换型全链小时（不残留分钟）
  freight: z.number(), // 在途运费（电芯→Pack·cell→pack freightCost）
  fgInv: z.number(), // 成品持有（提前生产压库·fgHoldUnits）
  transitInv: z.number(), // 在途库存（两阶段网络在途 qty×transitDays）
  margin: z.number(), // 毛利代理（营收 − cost·相对量·可溯）
});
export type GlobalSimKpi = z.infer<typeof GlobalSimKpiSchema>;

/** 溯源（R13·每 KPI/分配/被挤带 provenance·数字红线）。 */
export const GlobalSimProvenanceSchema = z.object({
  kind: z.string(),
  drillType: z.string(),
  drillId: z.string(),
  drillField: z.string(),
  drillValue: z.number(),
  /** WO-DATA 未落 → mock 来源标注（诚实红线）；真源接入后为 null。 */
  mockNote: z.string().nullable().optional(),
});
export type GlobalSimProvenance = z.infer<typeof GlobalSimProvenanceSchema>;

/** 联合分配格（订单 → 基地×窗口×qty·产线粒度时 base=`baseId#lineId`）。 */
export const GlobalSimAllocationSchema = z.object({
  orderId: z.string(),
  base: z.string(),
  line: z.string().nullable().optional(),
  window: z.number(),
  qty: z.number(),
  model: z.string().optional(),
  onTime: z.boolean(),
  provenance: GlobalSimProvenanceSchema,
});
export type GlobalSimAllocation = z.infer<typeof GlobalSimAllocationSchema>;

/** 电芯段批次（cellBase 供芯基地·cellWindow 完芯窗·qty）。 */
export const GlobalSimCellBatchSchema = z.object({
  cellBase: z.string(),
  cellWindow: z.number(),
  qty: z.number(),
});
export type GlobalSimCellBatch = z.infer<typeof GlobalSimCellBatchSchema>;

/**
 * 两阶段排产行（电芯段 batches → transit → Pack 段 → 交付）。deliverDay = Pack 完工窗 + 在途；
 * SEAM：改 transitDays/距离 → deliverDay 真变；freightCost 计入 cost；transitInv 在途库存。
 */
export const GlobalSimScheduleRowSchema = z.object({
  orderId: z.string(),
  batches: z.array(GlobalSimCellBatchSchema), // 电芯段（供芯基地占 cell 产能·可拆多批）
  transitDays: z.number(), // 电芯→Pack 在途天（距离派生·WO-DATA 未落时 mock 标注）
  freightCost: z.number(), // 电芯→Pack 运费（计入 cost 目标）
  packBase: z.string(), // Pack 段基地（占本基地 pack 产能）
  packWindow: z.number(), // Pack 完工窗
  changeoverHours: z.number(), // ★该行换型小时（全链小时）
  deliverDay: z.number(), // 交付日（= Pack 完工 + 在途·真含 transitDays）
  status: z.string(), // ok | material_blocked | displaced | split
  provenance: GlobalSimProvenanceSchema.optional(),
});
export type GlobalSimScheduleRow = z.infer<typeof GlobalSimScheduleRowSchema>;

/** 单方案（一目标一联合解·KPI + 分配 + 溯源）。 */
export const GlobalSimScenarioSchema = z.object({
  key: GlobalSimObjectiveSchema,
  kpi: GlobalSimKpiSchema,
  allocation: z.array(GlobalSimAllocationSchema),
  provenance: GlobalSimProvenanceSchema,
  // ── WO-SURFACE-7DIM · 驾驶舱经典兼容层（additive·并列不替换）──
  // 编排响应在 7 维 kpi 之上 additively 并列经典 portfolio 方案字段，令决策驾驶舱既有「方案量化多维比对」
  // 矩阵/读数绑定（objectiveValues.ontime/delay/changeover/fgInventory/cost·servedCount/displacedCount/servedQty）
  // 在发起编排（twoStage 等）后不掉线。缺省（纯 7 维消费方）时诚实省略。
  objectiveValues: z.record(z.string(), z.number()).optional(),
  servedCount: z.number().optional(),
  displacedCount: z.number().optional(),
  servedQty: z.number().optional(),
});
export type GlobalSimScenario = z.infer<typeof GlobalSimScenarioSchema>;

/** 被卡单归因（物料短缺 → 具体 Material+Supplier·R13 数字红线）。 */
export const GlobalSimBlockedSchema = z.object({
  orderId: z.string(),
  reason: z.enum(["material", "capacity", "unserved"]),
  material: z.string().nullable(),
  supplier: z.string().nullable(),
  qty: z.number(),
  provenance: GlobalSimProvenanceSchema,
});
export type GlobalSimBlocked = z.infer<typeof GlobalSimBlockedSchema>;

/** 杠杆再优化 delta（相对无杠杆基版·每 KPI before/after·可溯·灭 G-WHATIF-HARDCODED-LEVERS）。 */
export const GlobalSimLeverDeltaSchema = z.object({
  lever: GlobalSimLeverSchema,
  before: GlobalSimKpiSchema,
  after: GlobalSimKpiSchema,
  provenance: GlobalSimProvenanceSchema,
});
export type GlobalSimLeverDelta = z.infer<typeof GlobalSimLeverDeltaSchema>;

// ── WO-SURFACE-7DIM · 驾驶舱经典兼容层 schema（additive·编排响应并列经典 portfolio 字段）──
// 目的：发起编排（twoStage/materialConstraint/levers/priorityLocks/globalSim → globalSimOptimize）后，
// 决策驾驶舱既有绑定（热力矩阵 capacityLedger / 分配台账 allocation / 被挤·固定卡 displaced·frozen /
// 读数 cost / 客户级影响 displaced）不因返回 GlobalSimResponse（7 维）而掉线——7 维在其上叠加，不替换。
// provenance 复用 GlobalSimProvenanceSchema（mockNote 可选·经典 Prov 无该字段亦兼容）。

/** 经典联合分配格（portfolio.allocation 形状·驱动热力矩阵/分配台账/排产表 model·onTime）。 */
export const GlobalSimClassicAllocSchema = z.object({
  item: z.string(),
  kind: z.string(),
  committed: z.boolean(),
  base: z.string(),
  baseName: z.string(),
  window: z.number(),
  windowStartDay: z.number().optional(),
  qty: z.number(),
  model: z.string().optional(),
  dueDay: z.number().optional(),
  delayDays: z.number(),
  onTime: z.boolean(),
  provenance: GlobalSimProvenanceSchema,
});
export type GlobalSimClassicAlloc = z.infer<typeof GlobalSimClassicAllocSchema>;

/** 经典被挤单（portfolio.displaced 形状·驱动客户级影响 CustomerImpactBar + 被挤卡）。 */
export const GlobalSimClassicDisplacedSchema = z.object({
  orderId: z.string(),
  kind: z.string(),
  qty: z.number(),
  model: z.string().optional(),
  provenance: GlobalSimProvenanceSchema,
});
export type GlobalSimClassicDisplaced = z.infer<typeof GlobalSimClassicDisplacedSchema>;

/** 共享产能守恒逐格台账（驱动热力矩阵 + 守恒台账）。 */
export const GlobalSimCapacityLedgerSchema = z.object({
  baseId: z.string(),
  window: z.number(),
  cap: z.number(),
  allocated: z.number(),
});
export type GlobalSimCapacityLedger = z.infer<typeof GlobalSimCapacityLedgerSchema>;

/** 冻结/固定单（驱动固定单卡）。 */
export const GlobalSimFrozenSchema = z.object({
  orderId: z.string(),
  base: z.string(),
  window: z.number(),
  qty: z.number(),
  frozen: z.literal(true).optional(),
});
export type GlobalSimFrozen = z.infer<typeof GlobalSimFrozenSchema>;

/** 经典代价分解（驱动读数「总代价」）。 */
export const GlobalSimCostSchema = z.object({
  delay: z.number(),
  changeover: z.number(),
  unserved: z.number(),
  total: z.number(),
  unit: z.string().optional(),
});
export type GlobalSimCost = z.infer<typeof GlobalSimCostSchema>;

/**
 * WO-W5·业务类型分口径汇总（乘/商/储各一行·求解器按类型真聚合，非前端写死三套假数）。
 * 三类真实经营场景经此逐项量化：
 *   capacityUtil 占用率（储能≈0.95 稳 / 乘用车>1 产能不足 / 商用车<0.6 空闲）；
 *   forecastGap 预测虚高缺口（forecastQty − orderQty·乘用车最大·预测远大于实际订单）；
 *   earlyDeliveryCount 需提前交付订单数（乘用车三重张力之一）；
 *   orderQtyCv 订单量变异系数（商用车订单波动大）。
 * 每值确定性派生自真种子 + 真求解分配（R6/R13·改勾选集 → 真重算 → 真变）。
 */
export const GlobalSimBusinessTypeSummarySchema = z.object({
  businessType: BusinessTypeSchema,
  label: z.string(), // 中文标签（乘用车/商用车/储能）
  orderCount: z.number(), // 该类在范围内订单数
  orderQty: z.number(), // 订单总量（套·实际订单）
  forecastQty: z.number(), // 销售预测总量（套·DemandSegment.p50×1e4）
  forecastGap: z.number(), // 预测缺口 = forecastQty − orderQty（乘用车预测虚高 → 大正值）
  earlyDeliveryCount: z.number(), // 需提前交付订单数（乘用车部分客户提前交期）
  orderQtyMean: z.number(), // 订单量均值（套）
  orderQtyCv: z.number(), // 订单量变异系数 σ/μ（商用车波动大 → 高）
  capacityAnnual: z.number(), // 该类可产基地年有效产能（套/年·R13 溯 Line.capacityDaily）
  demandAnnual: z.number(), // 该类年需求（forecast + 订单·套/年）
  capacityUtil: z.number(), // 占用率 = demandAnnual / capacityAnnual（储能≈0.95 / 乘用车>1 / 商用车<0.6）
  allocatedQty: z.number(), // 联合求解为该类实排产量（套·主方案）
  displacedQty: z.number(), // 该类被挤量（套·产能不足体现）
  provenance: GlobalSimProvenanceSchema,
});
export type GlobalSimBusinessTypeSummary = z.infer<typeof GlobalSimBusinessTypeSummarySchema>;

/**
 * ④ G-VAR-2 · 每订单「目标交期 vs 最终可达交期」推演（真求解·非写死）。
 *   targetDueDay：原始目标交期（seed due·天）；finalDueDay：用户设的最终可接受交期（天·null=未设）；
 *   achievableDay：联合求解可达交付日（天·含两阶段在途·null=被挤未获排）；
 *   gapDays = achievableDay − targetDueDay（正=晚于目标·null=不可达）；meetsFinal：可达 ≤ 最终交期（null=未设/不可达）。
 */
export const GlobalSimDueComparisonSchema = z.object({
  orderId: z.string(),
  targetDueDay: z.number(),
  finalDueDay: z.number().nullable(),
  achievableDay: z.number().nullable(),
  gapDays: z.number().nullable(),
  meetsFinal: z.boolean().nullable(),
  provenance: GlobalSimProvenanceSchema,
});
export type GlobalSimDueComparison = z.infer<typeof GlobalSimDueComparisonSchema>;

/**
 * ⑤ G-VAR-3 · 方法旋钮驱动的联合方案（三法结果形状不同·改旋钮真重解）。
 * 与 scenarios[]（逐目标单解·比对矩阵）正交：本方案是按 method 组合全目标的**单一联合解**，
 * objectiveValues/allocation 随 权重/ε上界/字典序 真变（前端假旋钮此门抓）。
 */
export const GlobalSimMethodScenarioSchema = z.object({
  method: GlobalSimMethodSchema,
  objectiveValues: z.record(z.string(), z.number()),
  servedCount: z.number(),
  displacedCount: z.number(),
  servedQty: z.number(),
  allocation: z.array(GlobalSimAllocationSchema),
  /** 回显生效的方法旋钮（权重/ε/优先序·溯源可审）。 */
  weights: z.record(z.string(), z.number()).optional(),
  epsilon: z.array(GlobalSimEpsilonSchema).optional(),
  priority: z.array(z.string()).optional(),
  provenance: GlobalSimProvenanceSchema,
});
export type GlobalSimMethodScenario = z.infer<typeof GlobalSimMethodScenarioSchema>;

export const GlobalSimResponseSchema = z.object({
  scenarios: z.array(GlobalSimScenarioSchema),
  schedule: z.array(GlobalSimScheduleRowSchema),
  blocked: z.array(GlobalSimBlockedSchema),
  leverDeltas: z.array(GlobalSimLeverDeltaSchema),
  /** 联合守恒逐格台账（allocated ≤ 净cap·两阶段两笔守恒）。 */
  reconciled: z.boolean(),
  /** 诚实标注：本次哪些字段用了 mock（WO-DATA 未落）。 */
  mockNotes: z.array(z.string()),
  /** 物料约束是否真启用（无数据 → false 诚实兜底）。 */
  materialConstraint: z.boolean(),
  status: z.string(),
  optimal: z.boolean(),
  summary: z.string(),
  // ── WO-SURFACE-7DIM · 驾驶舱经典兼容层（additive·并列经典 portfolio 字段·缺省诚实省略）──
  allocation: z.array(GlobalSimClassicAllocSchema).optional(),
  capacityLedger: z.array(GlobalSimCapacityLedgerSchema).optional(),
  displaced: z.array(GlobalSimClassicDisplacedSchema).optional(),
  frozen: z.array(GlobalSimFrozenSchema).optional(),
  cost: GlobalSimCostSchema.optional(),
  feasible: z.boolean().optional(),
  objectiveValues: z.record(z.string(), z.number()).optional(),
  // WO-W5·业务类型分口径汇总（乘/商/储各一行·additive·缺省诚实省略；勾选筛选态按选中类型作用域收窄）。
  businessTypeSummary: z.array(GlobalSimBusinessTypeSummarySchema).optional(),
  /** WO-W5·本次推演生效的业务类型筛选（回显·空/缺省 = 全类型）。 */
  businessTypes: z.array(BusinessTypeSchema).optional(),
  /** ④ G-VAR-2·每订单目标vs最终可达交期推演（additive·缺省省略）。 */
  dueComparison: z.array(GlobalSimDueComparisonSchema).optional(),
  /** ⑤ G-VAR-3·方法旋钮驱动的联合方案（additive·仅带方法旋钮时出·缺省省略）。 */
  methodScenario: GlobalSimMethodScenarioSchema.optional(),
});
export type GlobalSimResponse = z.infer<typeof GlobalSimResponseSchema>;
