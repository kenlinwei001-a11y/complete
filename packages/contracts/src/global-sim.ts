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
});
export type GlobalSimResponse = z.infer<typeof GlobalSimResponseSchema>;
