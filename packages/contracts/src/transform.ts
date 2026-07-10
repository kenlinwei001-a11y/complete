import { z } from "zod";
import { AggregateFnSchema } from "./ontology-governance.js";

// ---------------------------------------------------------------------------
// E2 数据集转换引擎（M2 轴 · maturity master plan §5）。
// 声明式 transform DAG over datasets：SOURCE/MAP/FILTER/JOIN/AGGREGATE/WINDOW，
// 列级血缘（column lineage）+ 增量物化（inputVersions 未变则跳过重算）。
// 纯契约（zod），跨包共享。求值表达式（MAP expr / FILTER predicate）由 datacore
// 侧确定性小求值器解释（无 eval）。
// ---------------------------------------------------------------------------

/** 转换步骤种类。 */
export const TransformStepKindSchema = z.enum([
  "SOURCE",
  "MAP",
  "FILTER",
  "JOIN",
  "AGGREGATE",
  "WINDOW",
]);
export type TransformStepKind = z.infer<typeof TransformStepKindSchema>;

/** SOURCE：绑定一个输入 RawDataset（rawDatasetId 优先，否则按 name 解析）。 */
export const SourceStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("SOURCE"),
  inputs: z.array(z.string()).default([]),
  datasetRef: z.object({ rawDatasetId: z.string().optional(), name: z.string().optional() }),
});
export type SourceStep = z.infer<typeof SourceStepSchema>;

/** MAP：投影 / 计算列。expr 引用输入列；drop 删列（在计算前生效于透传列）。 */
export const MapStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("MAP"),
  inputs: z.array(z.string()).min(1),
  columns: z.array(z.object({ name: z.string().min(1), expr: z.string().min(1) })).default([]),
  drop: z.array(z.string()).optional(),
});
export type MapStep = z.infer<typeof MapStepSchema>;

/** FILTER：保留 predicate 求值为真的行。 */
export const FilterStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("FILTER"),
  inputs: z.array(z.string()).min(1),
  predicate: z.string().min(1),
});
export type FilterStep = z.infer<typeof FilterStepSchema>;

/** JOIN：inner/left，on 为等值列对；inputs = [left, right]。 */
export const JoinStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("JOIN"),
  inputs: z.array(z.string()).length(2),
  left: z.string().min(1),
  right: z.string().min(1),
  on: z.array(z.object({ leftCol: z.string().min(1), rightCol: z.string().min(1) })).min(1),
  type: z.enum(["inner", "left"]).default("inner"),
});
export type JoinStep = z.infer<typeof JoinStepSchema>;

/** AGGREGATE：groupBy + aggs（count 可省 col）。 */
export const AggregateStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("AGGREGATE"),
  inputs: z.array(z.string()).min(1),
  groupBy: z.array(z.string()).default([]),
  aggs: z
    .array(z.object({ name: z.string().min(1), fn: AggregateFnSchema, col: z.string().optional() }))
    .min(1),
});
export type AggregateStep = z.infer<typeof AggregateStepSchema>;

/** 窗口函数种类。 */
export const WindowFnSchema = z.enum(["row_number", "rank", "running_sum", "lag"]);
export type WindowFn = z.infer<typeof WindowFnSchema>;

/** WINDOW：分区 + 排序 + 窗口函数（running_sum/lag 需 col）。透传全部输入行 + 追加列。 */
export const WindowStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("WINDOW"),
  inputs: z.array(z.string()).min(1),
  partitionBy: z.array(z.string()).default([]),
  orderBy: z.array(z.object({ col: z.string().min(1), dir: z.enum(["asc", "desc"]).default("asc") })).default([]),
  functions: z
    .array(z.object({ name: z.string().min(1), fn: WindowFnSchema, col: z.string().optional() }))
    .min(1),
});
export type WindowStep = z.infer<typeof WindowStepSchema>;

export const TransformStepSchema = z.discriminatedUnion("kind", [
  SourceStepSchema,
  MapStepSchema,
  FilterStepSchema,
  JoinStepSchema,
  AggregateStepSchema,
  WindowStepSchema,
]);
export type TransformStep = z.infer<typeof TransformStepSchema>;

/** 转换规格：产生单一输出数据集的步骤 DAG。 */
export const TransformSpecSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string().min(1),
  steps: z.array(TransformStepSchema).default([]),
  outputDatasetName: z.string().min(1),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type TransformSpec = z.infer<typeof TransformSpecSchema>;

/** 建/改入参（不含 id/tenantId/时间戳）。 */
export const TransformSpecUpsertSchema = TransformSpecSchema.omit({
  id: true,
  tenantId: true,
  createdAt: true,
  updatedAt: true,
});
export type TransformSpecUpsert = z.infer<typeof TransformSpecUpsertSchema>;

// ---- 列级血缘 -------------------------------------------------------------

/** 单个输出列的血缘：溯源到（SOURCE 步骤 id, 原始列）集合 + 派生方式（步骤种类）。 */
export const ColumnLineageSchema = z.object({
  outputColumn: z.string(),
  derivedFrom: z.array(z.object({ stepId: z.string(), column: z.string() })),
  via: TransformStepKindSchema,
});
export type ColumnLineage = z.infer<typeof ColumnLineageSchema>;

export const TransformLineageSchema = z.object({ columns: z.array(ColumnLineageSchema) });
export type TransformLineage = z.infer<typeof TransformLineageSchema>;

// ---- 运行记录 -------------------------------------------------------------

export const TransformRunStatusSchema = z.enum(["SUCCEEDED", "FAILED", "SKIPPED_UP_TO_DATE"]);
export type TransformRunStatus = z.infer<typeof TransformRunStatusSchema>;

export const TransformRunSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  specId: z.string(),
  status: TransformRunStatusSchema,
  outputDatasetId: z.string(),
  rowsOut: z.number().int().nonnegative(),
  epoch: z.number().int().nonnegative(),
  /** 每个输入 RawDataset 物化时的 syncedAt（增量跳过判据）。 */
  inputVersions: z.record(z.string(), z.string()),
  lineage: TransformLineageSchema,
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  error: z.string().optional(),
});
export type TransformRun = z.infer<typeof TransformRunSchema>;

/** validate 结果单条（镜像 WfValidationIssue 形态）。 */
export const TransformValidationIssueSchema = z.object({
  stepId: z.string().optional(),
  code: z.string(),
  message: z.string(),
});
export type TransformValidationIssue = z.infer<typeof TransformValidationIssueSchema>;

export const TransformValidationResultSchema = z.object({
  ok: z.boolean(),
  issues: z.array(TransformValidationIssueSchema),
});
export type TransformValidationResult = z.infer<typeof TransformValidationResultSchema>;
