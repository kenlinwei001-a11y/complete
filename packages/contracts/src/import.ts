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
