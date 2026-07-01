import { z } from "zod";

/**
 * WO-MULTISRC-FUSION-DOMAIN · N1 多源融合（冲突仲裁 + 测谎）——建在 SolverBinding 层之上。
 *
 * 背景（Maven「价值在接缝」第一条·跨筒仓融合）：ERP/MES/SRM 对**同一事实**各执一词（订单交期 vs
 * 产能 vs 在途到货）。SolverBinding（WO-SOLVER-ONTOLOGY-BINDING·B3/G-17）已把多源类型→canonical
 * role（同一 Order 来自 ERP 表和 MES 表，经绑定都映到 role=order）。本层在此之上：
 *  - **归并**：同 role 的多源实例按业务主键 (pk) 合成一个 `FusedObject`（每字段带各源取值 + 溯源）。
 *  - **冲突仲裁**：多源同字段不一致 → 规则驱动仲裁（权威源优先 / 新鲜度优先 / 多数票），走 A5 规则
 *    DSL（可编辑·G-10），采纳哪个源 + 为何 全留痕。
 *  - **测谎**：跨源同字段**数值**不一致超阈值 → 标 `SUSPECT` + 置信降级（**不照单全收·R13**；尤其防
 *    某基地虚报产能好看）。测谎不洗白：SUSPECT 常驻，仲裁只在诚实标注前提下取审慎值。
 *  - **带置信+溯源答案**：`dataMode` 反映跨源一致性（全一致 LIVE / 有冲突 PARTIAL / 有测谎命中 MOCK
 *    审慎），逐字段可溯回源。
 *  - **AUDIT 问责**：仲裁/测谎全经统一 append-only 审计（WO-AUDIT-OBS）留痕，可复盘。
 *
 * 不变量：R13（置信/测谎不照单全收）· R6（融合/仲裁/测谎无随机·同输入同输出）· R2（仅本租户）·
 * R4（采纳走审批·本层只给带置信答案不直写真值）· G-10（仲裁规则可编辑）。
 */

/** 单源在某字段上的取值（溯源到源 + 该源置信）。 */
export const FieldSourceValueSchema = z.object({
  /** 源标识（业务语义源系统标签，如 "ERP"/"MES"/"SRM"；来自 sources[].sourceLabel）。 */
  source: z.string(),
  /** 该源对象类型 key（SolverBinding 绑定到 canonical role 的真实类型）。 */
  typeKey: z.string(),
  /** 该源报的取值（原样，未仲裁）。 */
  value: z.unknown(),
  /** 该源在本字段的置信（0–1；权威源高、非权威低；测谎命中的越界源被下调）。 */
  confidence: z.number(),
});
export type FieldSourceValue = z.infer<typeof FieldSourceValueSchema>;

/** 仲裁策略（规则驱动·G-10 可编辑）。 */
export const ArbitrationStrategySchema = z.enum([
  "AUTHORITY", // 权威源优先（sources[].authority 高者胜）
  "FRESHNESS", // 新鲜度优先（asOf 最新者胜）
  "MAJORITY", // 多数票（取众数；平票回退权威）
  "CONSERVATIVE", // 审慎（测谎命中时取最保守/最不利值，不照单全收虚报）
]);
export type ArbitrationStrategy = z.infer<typeof ArbitrationStrategySchema>;

/** 融合后单字段：仲裁取值 + 各源溯源 + 冲突/测谎判定。 */
export const FusedFieldSchema = z.object({
  field: z.string(),
  /** 仲裁采纳的最终取值。 */
  value: z.unknown(),
  /** 采纳来自哪个源（仲裁结论·溯源）。 */
  chosenSource: z.string(),
  /** 采纳理由（人话：为何取此源·哪条策略/规则）。 */
  reason: z.string(),
  /** 采纳所用仲裁策略。 */
  strategy: ArbitrationStrategySchema,
  /** 是否多源冲突（≥2 源取值不同）。 */
  conflict: z.boolean(),
  /** 测谎命中（数值跨源不一致超阈值 → 疑虚报）。命中则本对象整体 SUSPECT。 */
  suspect: z.boolean(),
  /** 测谎证据（命中时：跨源极差 / 阈值 / 疑越界源）。 */
  suspectEvidence: z
    .object({
      spread: z.number(), // 跨源相对极差（(max-min)/|median|）
      threshold: z.number(), // 触发阈值
      outlierSource: z.string(), // 疑虚报的源（偏离中位最远）
      outlierValue: z.number(),
      median: z.number(),
    })
    .optional(),
  /** 本字段置信（跨源一致=高；冲突降；测谎命中再降·R13 不照单全收）。 */
  confidence: z.number(),
  /** 逐源取值溯源。 */
  sources: z.array(FieldSourceValueSchema),
});
export type FusedField = z.infer<typeof FusedFieldSchema>;

/** 融合对象：多源同 pk 归并 + 逐字段仲裁 + 整体测谎裁决。 */
export const FusedObjectSchema = z.object({
  /** 业务主键（多源共享的 pk 值）。 */
  pk: z.string(),
  /** canonical role（如 order）。 */
  role: z.string(),
  /** 逐字段融合结果。 */
  fields: z.array(FusedFieldSchema),
  /** 整体裁决：TRUSTED（无测谎命中）/ SUSPECT（有测谎命中·置信降级不照单全收）。 */
  verdict: z.enum(["TRUSTED", "SUSPECT"]),
  /** 参与融合的源标签集（≥2 才谈融合）。 */
  contributingSources: z.array(z.string()),
  /** 对象整体置信（逐字段置信最小值·审慎口径·R13）。 */
  confidence: z.number(),
});
export type FusedObject = z.infer<typeof FusedObjectSchema>;

/** 单个融合源声明：canonical role 下的一个源（经 SolverBinding 归一到同一 role）。 */
export const FusionSourceSchema = z.object({
  /** 业务语义源标签（如 "ERP"/"MES"/"SRM"）。 */
  sourceLabel: z.string().min(1),
  /** 该源真实对象类型 key（本租户已发布本体·DF.8 接地）。 */
  typeKey: z.string().min(1),
  /** 该源 pk 字段（缺省取类型 primaryKey；用于跨源归并对齐）。 */
  pkField: z.string().optional(),
  /** 权威度（AUTHORITY 策略据此；数值越大越权威）。缺省 0。 */
  authority: z.number().optional(),
  /** 新鲜度字段（FRESHNESS 策略读此 ISO 日期/时间戳字段，最新者胜）。 */
  asOfField: z.string().optional(),
  /** canonicalField → 该源真实字段名映射（缺省字段名一致；与 SolverBinding.fieldMap 同范式）。 */
  fieldMap: z.record(z.string(), z.string()).optional(),
});
export type FusionSource = z.infer<typeof FusionSourceSchema>;

/** multisource_fusion 求解器入参。 */
export const MultiSourceFusionArgsSchema = z.object({
  /** canonical role（仅溯源标注·如 "order"）。缺省 "object"。 */
  role: z.string().optional(),
  /** ≥2 个源（各经 SolverBinding 已归一到同一 role）。 */
  sources: z.array(FusionSourceSchema).min(2),
  /** 参与融合/仲裁的 canonical 字段集（逐源经 fieldMap 映射到真实字段读值）。 */
  fields: z.array(z.string()).min(1),
  /** 数值测谎阈值（跨源相对极差超此 → SUSPECT）。缺省取本租户规则 params 或 0.15。 */
  suspectThreshold: z.number().optional(),
  /** 默认仲裁策略（可被 A5 规则/字段级覆盖）。缺省 AUTHORITY。 */
  defaultStrategy: ArbitrationStrategySchema.optional(),
});
export type MultiSourceFusionArgs = z.infer<typeof MultiSourceFusionArgsSchema>;

/** SolverDataMode 头条（与 solvers.ts 同枚举·此处独立声明避免跨文件耦合）。 */
const FusionDataModeSchema = z.enum(["LIVE", "MOCK", "PARTIAL", "STALE", "SYNTHETIC"]);

/** multisource_fusion 求解器输出。 */
export const MultiSourceFusionOutputSchema = z
  .object({
    role: z.string(),
    /** 逐 pk 的融合对象（确定性按 pk 排序）。 */
    fused: z.array(FusedObjectSchema),
    /** 测谎命中总数（SUSPECT 对象数）。 */
    suspectCount: z.number(),
    /** 有冲突（多源不一致）的对象数。 */
    conflictCount: z.number(),
    /** 头条诚实位：全源一致 LIVE / 有冲突 PARTIAL / 有测谎命中 MOCK（审慎·不冒充真值）。 */
    dataMode: FusionDataModeSchema,
    /** 采用的仲裁策略集（溯源）。 */
    strategies: z.array(ArbitrationStrategySchema),
    /** 人话摘要（多少对象归并·多少冲突仲裁·多少测谎命中）。 */
    summary: z.string(),
  })
  .catchall(z.unknown());
export type MultiSourceFusionOutput = z.infer<typeof MultiSourceFusionOutputSchema>;

/**
 * FusedObject 快照（落库·可查·AUDIT 复盘锚）。求解器每次融合把裁决为 SUSPECT 或有冲突的对象
 * 快照 append 落 `fused_objects`（R9 仓储双实现·R2 租户隔离）。append-only 语义（只插不改），
 * 供事后"当时融合取了哪源/为何/测谎命中什么"复盘（与 audit_log 互补：审计记动作，此记融合态全貌）。
 */
export const FusedObjectSnapshotSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  role: z.string(),
  pk: z.string(),
  verdict: z.enum(["TRUSTED", "SUSPECT"]),
  /** 完整融合对象（逐字段仲裁 + 溯源 + 测谎证据）。 */
  fused: FusedObjectSchema,
  /** 触发本快照的请求 id（跨系统贯穿·与 audit requestId 同锚）。 */
  requestId: z.string().optional(),
  at: z.string(),
});
export type FusedObjectSnapshot = z.infer<typeof FusedObjectSnapshotSchema>;
