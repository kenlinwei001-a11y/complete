import { z } from "zod";

/**
 * WO-IMPORT-MULTITABLE (G1) · 企业级多表批量导入契约（"导入侧"·平台行业无关 R14）。
 *
 * 立场（HANDOFF-databuilder-genuine-and-import.md · PRD-enterprise-dataset-import.md §2）：
 *   Stage 3.15 = 外部世界生成器（造数据），平台 = 下游决策引擎。本契约只描述"把一批已上传的关联表
 *   一次成图"的导入入口——⛔ 不含任何行业/电池业务常数（ATP/BOM 配方/客户分级留外部·违 R14 即锁死电池）。
 *   FK 检测与类型反推全走既有确定性管线（modeling.ts detectFkCandidates + deriveModelingSuggestion·无 LLM·R6）。
 */

/** POST /a/v1/modeling/derive-batch 请求：一批已上传表 → 跨全部表 FK → 一张本体图（类型+链路）。 */
export const DeriveBatchRequestSchema = z.object({
  /** 已通过 /a/v1/uploads(/batch) 落库的 RawDataset id 列表（至少一张）。 */
  rawDatasetIds: z.array(z.string()).min(1),
  /**
   * 归域映射（key = 反推出的 typeKey 或 sourceDataset 名 → 14 合法业务域之一）。
   * ⛔ R14：平台不猜行业域——由调用方（导入方/运维）显式提供；autoPublish 时用于解 unassigned 发布阻断。
   * 非 14 合法业务域成员 → 拒（归域门·防幽灵域）。
   */
  domains: z.record(z.string(), z.string()).optional(),
  /** 反推后是否直接发布（默认否：产草稿供人工归域/校对后再发布）。 */
  autoPublish: z.boolean().optional(),
  /** 发布成功后是否直接物化对象（仅 autoPublish 为真时生效）。 */
  autoMaterialize: z.boolean().optional(),
  /** 发布时开启字段全建模门（R12）：导入数据源每个字段都必须建模，否则阻断发布。 */
  requireFullCoverage: z.boolean().optional(),
});
export type DeriveBatchRequest = z.infer<typeof DeriveBatchRequestSchema>;

/** derive-batch 回执里的一条链路（跨表 FK → LinkType）。 */
export const DeriveBatchLinkSchema = z.object({
  fromTypeKey: z.string(),
  toTypeKey: z.string(),
  name: z.string(),
  viaFromField: z.string(),
  viaToField: z.string(),
  cardinality: z.string(),
  confidence: z.number(),
});

/** derive-batch 回执里的一个对象类型（一张表 → 一个类型）。 */
export const DeriveBatchTypeSchema = z.object({
  typeKey: z.string(),
  sourceDataset: z.string(),
  primaryKey: z.string().nullable(),
  domain: z.string(),
  propertyCount: z.number(),
});

export const DeriveBatchResponseSchema = z.object({
  draftId: z.string(),
  status: z.string(),
  objectTypes: z.array(DeriveBatchTypeSchema),
  links: z.array(DeriveBatchLinkSchema),
  fkCandidates: z.array(
    z.object({
      fromDataset: z.string(),
      fromField: z.string(),
      toDataset: z.string(),
      toField: z.string(),
      containment: z.number(),
    }),
  ),
  /** autoPublish 成功时的已发布本体版本；否则 null（仅出草稿）。 */
  published: z.object({ ontologyVersion: z.number() }).nullable(),
  /** autoMaterialize 结果；否则 null。物化对象挂真 rawDatasetId（R-NO-ORPHAN-SOURCE）。 */
  materialize: z
    .object({
      jobId: z.string(),
      created: z.number(),
      quarantined: z.number(),
      skipped: z.array(
        z.object({ typeKey: z.string(), targetKey: z.string(), dataset: z.string(), reason: z.string() }),
      ),
    })
    .nullable(),
  /** 诚实边界：发布校验失败（未归域/缺主键/字段未全建模）时结构化返回·不静默物化空壳。 */
  publishErrors: z.array(z.object({ typeKey: z.string(), message: z.string() })).nullable(),
});
export type DeriveBatchResponse = z.infer<typeof DeriveBatchResponseSchema>;

/**
 * POST /a/v1/uploads/batch 回执：多文件 / zip 整包一次上传 N 张表（Stage 3.15 output 目录一次进）。
 * 每文件复用单文件上传正门（连接器可见·挂真 rawDatasetId），逐文件成败独立报告（不因一张坏表整批失败）。
 */
export const BatchUploadResultSchema = z.object({
  uploads: z.array(
    z.object({
      filename: z.string(),
      connId: z.string(),
      datasetName: z.string(),
      rawDatasetId: z.string().nullable(),
      rowCount: z.number().nullable(),
    }),
  ),
  errors: z.array(z.object({ filename: z.string(), message: z.string() })),
});
export type BatchUploadResult = z.infer<typeof BatchUploadResultSchema>;

/**
 * WO-IMPORT-ONTOLOGY (G2) · 客户本体直导（= Stage 3.15 的 objects.json / relations.json 形态）。
 * 平台无"导入本体"入口时只能逐类 `POST object-types` / 逐链 `upsertLinkType` 手拼——本 bundle 一次直导。
 * ⛔ R14：bundle 是外部自带本体（客户领域词），平台代码零行业常数——只搬结构、按名绑已上传数据（可选）。
 */
const IMPORT_DATA_TYPES = ["string", "number", "boolean", "date", "enum", "ref", "json"] as const;

export const OntologyImportObjectSchema = z.object({
  /** 对象类型名（客户领域词·如 Factory/ProductionLine）→ 反推 typeKey(PascalCase) + displayName。 */
  name: z.string().min(1),
  displayName: z.string().optional(),
  /** 可选归域（14 合法业务域之一·非成员即拒·防幽灵域 R14）。缺省 = 不归域（直导本体允许）。 */
  domain: z.string().optional(),
  properties: z
    .array(
      z.object({
        name: z.string().min(1),
        dataType: z.enum(IMPORT_DATA_TYPES).optional(),
        isPrimaryKey: z.boolean().optional(),
        /** 引用目标对象名（→ ref 属性·指向另一 bundle 对象或已发布类型）。 */
        refTo: z.string().optional(),
      }),
    )
    .optional(),
});

export const OntologyImportRelationSchema = z.object({
  /** 关系名（客户领域词·如 HAS/USES/PRODUCES）。 */
  name: z.string().min(1),
  /** 源/目标对象名（须解析到 bundle 对象或已发布类型·否则报 DANGLING_RELATION 不静默建断链）。 */
  from: z.string().min(1),
  to: z.string().min(1),
  cardinality: z.enum(["1:1", "1:N", "N:N"]).optional(),
});

export const OntologyImportBundleSchema = z.object({
  objects: z.array(OntologyImportObjectSchema).min(1),
  relations: z.array(OntologyImportRelationSchema).default([]),
  /** 按对象名匹配已上传 RawDataset 建 sourceBindings（字段全建模 R12）；表缺/字段缺 → 报覆盖缺口。 */
  bindDatasets: z.boolean().optional(),
  /** 严格模式：有任一覆盖缺口 → 不建不发布·结构化返回缺口（诚实边界·不静默建空/断链）。 */
  strict: z.boolean().optional(),
  /** 直导后是否发布本体版本（默认 true）。 */
  publish: z.boolean().optional(),
});
export type OntologyImportBundle = z.infer<typeof OntologyImportBundleSchema>;

/** 覆盖缺口（诚实边界）：bundle 与已上传数据/自身引用对不上的逐项报告。 */
export const OntologyImportGapSchema = z.object({
  kind: z.enum(["MISSING_TABLE", "MISSING_FIELD", "UNKNOWN_REF", "DANGLING_RELATION"]),
  object: z.string().nullable(),
  relation: z.string().nullable(),
  detail: z.string(),
});

export const OntologyImportResultSchema = z.object({
  createdTypes: z.array(z.string()),
  createdLinks: z.array(z.string()),
  /** 已按名绑定数据表的类型（含映射/未映射字段·可见覆盖）。 */
  bound: z.array(
    z.object({
      typeKey: z.string(),
      dataset: z.string(),
      mappedFields: z.array(z.string()),
      unmappedProps: z.array(z.string()),
      undeclaredFields: z.array(z.string()),
    }),
  ),
  gaps: z.array(OntologyImportGapSchema),
  /** 发布成功的本体版本；strict 阻断或 publish:false → null。 */
  ontologyVersion: z.number().nullable(),
});
export type OntologyImportResult = z.infer<typeof OntologyImportResultSchema>;

/**
 * WO-IMPORT-SCENARIO (G3) · 场景导入（Stage 3.15 场景 JSON → 平台场景卡·PRD-enterprise-dataset-import §3.3）。
 * ⛔ R14：平台**不含** Stage 3.15 业务语义（`ORDER_ACCEPTANCE→哪个求解器` 等映射**不写死平台**）——
 * 场景的 `answer` 声明式 query 由调用方（Stage 3.15 侧）给；缺省则退化为对 objectRefs 的 objects 直列（真数据·确定性）。
 * presetContext.selectedObjects 对**已物化对象库**解析（对不上 → 诚实 gap·不造幽灵引用）。
 */
const SCENARIO_ANSWER_KINDS = ["objects-aggregate", "objects", "solver"] as const;

export const ScenarioImportAnswerSchema = z.object({
  kind: z.enum(SCENARIO_ANSWER_KINDS),
  objectType: z.string().optional(),
  agg: z.enum(["sum", "avg", "count", "min", "max"]).optional(),
  prop: z.string().optional(),
  columns: z.array(z.string()).optional(),
  limit: z.number().optional(),
  solverKey: z.string().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  unit: z.string().optional(),
});

export const ScenarioImportItemSchema = z.object({
  /** 场景键（缺省从 title/type 派生·同键幂等覆盖）。 */
  key: z.string().optional(),
  /** 场景标题（缺省用 type）。 */
  title: z.string().optional(),
  /** Stage 3.15 场景类型（如 ORDER_ACCEPTANCE·仅作标题/键派生·平台不据此写死求解器 R14）。 */
  type: z.string().optional(),
  /** 决策问句（缺省生成通用问句）。 */
  question: z.string().optional(),
  /** 启动器目标视图（缺省平台默认）。 */
  targetView: z.string().optional(),
  /** 关系到的对象（objectType+业务主键 objectId）→ presetContext.selectedObjects·对真对象库解析。 */
  objectRefs: z.array(z.object({ objectType: z.string(), objectId: z.string(), label: z.string().optional() })).optional(),
  /** 槽位预置（保证打开即可推演·不被反问）。 */
  slotPresets: z.record(z.string(), z.unknown()).optional(),
  /** 声明式答案 query（调用方给·R14 平台不猜业务语义）；缺省退化为 objects 直列 objectRefs 的类型。 */
  answer: ScenarioImportAnswerSchema.optional(),
});

export const ScenarioImportRequestSchema = z.object({
  scenarios: z.array(ScenarioImportItemSchema).min(1),
});
export type ScenarioImportRequest = z.infer<typeof ScenarioImportRequestSchema>;

export const ScenarioImportGapSchema = z.object({
  kind: z.enum(["MISSING_OBJECT", "MISSING_ANSWER"]),
  scenarioKey: z.string(),
  detail: z.string(),
});

export const ScenarioImportResultSchema = z.object({
  imported: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      question: z.string(),
      targetView: z.string(),
      /** 真解析到的对象（对象库存在的·前端 selectedObjects 只放真对象）。 */
      resolvedObjects: z.array(z.object({ objectType: z.string(), objectId: z.string(), label: z.string() })),
      answerKind: z.enum(SCENARIO_ANSWER_KINDS),
      /** 诚实位：answer 是调用方声明的（true）还是缺省退化为 objects 直列（false）。 */
      answerDeclared: z.boolean(),
    }),
  ),
  gaps: z.array(ScenarioImportGapSchema),
});
export type ScenarioImportResult = z.infer<typeof ScenarioImportResultSchema>;

/**
 * WO-IMPORT-REPLACE-SYNTHETIC (G4·PRD §3.4) · 世界态源开关（`synthetic | imported`·配 WO-CAP-01 REALDEMAND）。
 * `imported` = 用导入的真业务对象作世界态源 → 求解器读真值而非 hash（翻开既有实值杠杆 `qos.risk_realdemand`，
 * 该杠杆求解器已消费 `SolverContext.features`·risk.ts 真需求-产能缺口替代 mockTightness 哈希）。**平台不改求解器内部**。
 * 守 R-NO-ORPHAN-SOURCE：`imported` 但无导入真数据（0 RawDataset）→ 诚实 warning（世界态空·不假装有真值）。
 */
export const WorldSourceSchema = z.object({
  worldSource: z.enum(["synthetic", "imported"]),
});
export type WorldSource = z.infer<typeof WorldSourceSchema>;

export const WorldSourceStatusSchema = z.object({
  worldSource: z.enum(["synthetic", "imported"]),
  /** 实值杠杆是否生效（qos.risk_realdemand·求解器读真供需公式）。 */
  realValueLeverEnabled: z.boolean(),
  /**
   * 实值杠杆是否**由真导入 provenance 支撑**（KILL-MOCK-RED 命门）：
   * true 仅当 worldSource=imported **且**有真导入 provenance 对象——杠杆开在真值上；
   * false = 杠杆即便开也非真导入支撑（合成/模板默认·不得当真 LIVE）。
   */
  leverSourcedFromRealImports: z.boolean(),
  /** 本租户已导入数据表数（RawDataset 计数）。 */
  rawDatasetCount: z.number(),
  /** 已物化对象总数（MATERIALIZED）。 */
  materializedObjectCount: z.number(),
  /**
   * **真导入 provenance** 对象数（origin=MATERIALIZED 且源连接 classifySourceOrigin=real-sourced·非合成 mock/synthetic）。
   * = imported 世界态真正可读的真值对象数；0 = 全合成，imported 不得让合成自报 LIVE。
   */
  realImportedObjectCount: z.number(),
  /** 诚实告警（imported 无真导入 → 拒翻杠杆；synthetic 但模板默认开杠杆 → 合成可能自报 LIVE）。 */
  warnings: z.array(z.string()),
});
export type WorldSourceStatus = z.infer<typeof WorldSourceStatusSchema>;
