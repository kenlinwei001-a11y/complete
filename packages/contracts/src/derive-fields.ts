import { z } from "zod";

/**
 * WO-DB-DERIVE-DECISION-FIELDS (G4·派生引擎契约) · 导入记录字段 → 决策字段 **可配置映射表**。
 *
 * 立场（REVIEW-field-schema-user-vs-platform.md §4 · PRD-enterprise-dataset-import.md §3.4 G4）：
 *   导入的**记录型**数据（factory/production_line/equipment…真业务记录）落库后是"世界的账"；平台求解器
 *   读的是**决策型**字段（Base.util / Base.oeeIndex …），这些字段**不在源记录里**——必须由派生引擎从**真导入值**
 *   聚合算出（治假推演的正解：决策量从真记录算，而非 hash/写死·KILL-MOCK-RED）。
 *
 * ⛔ R14（应用层无业务常数·generality-mandatory）：本契约只描述"聚合口径"（哪个源类型的哪个字段·按哪个键
 *   分组·用什么算子），**零行业/电池常数**。电池只是**一份** mapping 实例（由导入方/运维以数据提供），
 *   平台代码不内联任何 `util=avg(line.oee)` 之类的电池特定映射——换行业只换 mapping 数据，代码不动。
 *
 * R6 确定性：同 (mapping, 源对象快照) → 字节级同派生结果（引擎无 Date.now/Math.random/hash 造值）。
 * R13 溯源：每个派生值挂 sourceObjectIds（贡献它的真源对象）→ 可逐值回溯"从哪些真记录算来"。
 */

/** 聚合算子（口径·非业务常数）：把一组源记录的数值字段聚成一个决策值。 */
export const DecisionFieldOpSchema = z.enum([
  "avg", // 均值（如 Base.oeeIndex = 各设备 oee 均值）
  "sum", // 求和（如 Base 产能 = 各线名义产能之和）
  "min", // 最小（瓶颈取最紧）
  "max", // 最大
  "count", // 计数（真记录条数·非数值字段）
  "ratio", // 比值：Σfield / ΣdenomField（如 util = Σ实际产出 / Σ额定产能）
  "weighted_avg", // 加权均值：Σ(field×weight) / Σweight（如按产能加权的 OEE）
]);
export type DecisionFieldOp = z.infer<typeof DecisionFieldOpSchema>;

/**
 * 一条派生规则：目标决策字段 ← 对某源对象类型某字段按分组键的聚合。
 * 例（电池·由导入方以数据提供·非平台内联）：
 *   { target:{objectType:"Base",field:"oeeIndex"}, source:{objectType:"Equipment",field:"oee_current",groupByField:"baseId"},
 *     op:"avg", targetKeyField:"baseId" }
 *   { target:{objectType:"Base",field:"util"}, source:{objectType:"ProductionLine",field:"oee",groupByField:"factory_id"},
 *     op:"avg", targetKeyField:"factory_id", scale:0.01 }  // 源 oee 是百分数 → ×0.01 归一到 0..1
 */
export const DecisionFieldRuleSchema = z.object({
  /** 目标：写到哪个对象类型的哪个决策字段（求解器读点·如 Base.util）。 */
  target: z.object({ objectType: z.string().min(1), field: z.string().min(1) }),
  /** 源：从哪个对象类型的哪个数值字段聚合。 */
  source: z.object({
    objectType: z.string().min(1),
    /** 被聚合的数值字段（ratio 时为分子字段）。 */
    field: z.string().min(1),
    /** ratio 分母字段（op=ratio 必填·否则忽略）。 */
    denomField: z.string().optional(),
    /** weighted_avg 权重字段（op=weighted_avg 必填·否则忽略）。 */
    weightField: z.string().optional(),
    /** 源记录上指向目标业务键的外键字段（分组键·如 production_line.factory_id）。 */
    groupByField: z.string().min(1),
  }),
  op: DecisionFieldOpSchema,
  /** 目标对象上承载业务键的字段（源 groupByField 引用它·如 Base.baseId / Base.factory_id）。 */
  targetKeyField: z.string().min(1),
  /** 聚合后线性缩放（如百分数→比例 0.01·量纲对齐·非业务常数·由映射声明）。 */
  scale: z.number().optional(),
  /** 结果下/上限（如 util 夹到 0..1）。 */
  clampMin: z.number().optional(),
  clampMax: z.number().optional(),
  /** 结果小数位（缺省 6·R6 字节稳定）。 */
  precision: z.number().int().min(0).max(10).optional(),
});
export type DecisionFieldRule = z.infer<typeof DecisionFieldRuleSchema>;

export const DecisionFieldMappingSchema = z.object({
  rules: z.array(DecisionFieldRuleSchema).min(1),
});
export type DecisionFieldMapping = z.infer<typeof DecisionFieldMappingSchema>;

/** 派生真源诚实位：LIVE=全贡献源为真导入对象；PARTIAL=部分；SYNTHETIC=全合成物化；EMPTY=无真源（诚实空态·不造）。 */
export const DerivedDataModeSchema = z.enum(["LIVE", "PARTIAL", "SYNTHETIC", "EMPTY"]);
export type DerivedDataMode = z.infer<typeof DerivedDataModeSchema>;

/** 一个目标对象一条派生结果（挂真源 provenance·R13）。 */
export const DerivedFieldResultSchema = z.object({
  targetType: z.string(),
  targetId: z.string(),
  targetKey: z.string(),
  field: z.string(),
  op: DecisionFieldOpSchema,
  sourceType: z.string(),
  sourceField: z.string(),
  /** 派生值；null = 无真数值源贡献（诚实空态·绝不 hash/兜底造）。 */
  value: z.number().nullable(),
  /** 贡献该值的真源记录条数。 */
  contributingCount: z.number(),
  /** R13：贡献该值的源对象 id（可逐值回溯真记录·排序稳定）。 */
  sourceObjectIds: z.array(z.string()),
  dataMode: DerivedDataModeSchema,
});
export type DerivedFieldResult = z.infer<typeof DerivedFieldResultSchema>;

/** POST /a/v1/derive/decision-fields 请求：给 mapping（可配置·导入方提供·R14），跑派生引擎写决策字段。 */
export const DeriveDecisionFieldsRequestSchema = z.object({
  mapping: DecisionFieldMappingSchema,
  /** 仅预演不落库（dryRun·默认 false）。 */
  dryRun: z.boolean().optional(),
});
export type DeriveDecisionFieldsRequest = z.infer<typeof DeriveDecisionFieldsRequestSchema>;

export const DeriveDecisionFieldsResponseSchema = z.object({
  /** 世界态源（consume WO-IMPORT-REPLACE-SYNTHETIC：imported 才让真派生值上决策）。 */
  worldSource: z.enum(["synthetic", "imported"]),
  results: z.array(DerivedFieldResultSchema),
  /** 实际写回目标对象数（dryRun 时为 0）。 */
  written: z.number(),
  /** 整体诚实位（取最弱·全 LIVE 才 LIVE）。 */
  dataMode: DerivedDataModeSchema,
  /** 诚实边界：无真源/世界态 synthetic 等提示（不静默冒充真值）。 */
  warnings: z.array(z.string()),
});
export type DeriveDecisionFieldsResponse = z.infer<typeof DeriveDecisionFieldsResponseSchema>;
