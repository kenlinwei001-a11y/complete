import { z } from "zod";

/**
 * 原型 intake 正门 + schema 对账 HITL（prototype-intake）。
 *
 * 让"上传一个 HTML/原型 → 复刻数据与关系"成为可重复正门（非每次派 agent 手抠）：
 *  ① prototype-intake：确定性解析原型内嵌数据表（`const NAME=[...]`）+ 关系（`L(src,tgt,rel)` / ref 命名）→ IntakeResult；
 *  ② schema-reconcile：原型列 ↔ 既有本体字段确定性对账——能映射自动接、映射不上生成 SchemaReconcileCandidate（人确认，类比 MergeCandidate）。
 * 解析/对账皆纯函数（R6，同原型同结果）；真歧义不调 LLM → 给确定性排序候选交人。
 */

/** 解析出的候选数据集（NAME=表名，对象 key=列；保留少量样例行供画像/预览）。 */
export const ProtoDatasetSchema = z.object({
  name: z.string(),
  columns: z.array(z.string()),
  rowCount: z.number().int(),
  sampleRows: z.array(z.record(z.string(), z.unknown())).default([]),
});
export type ProtoDataset = z.infer<typeof ProtoDatasetSchema>;

/** 解析出的候选关系边（原型 L()/ref 命名约定 → OntologyLink 候选）。 */
export const ProtoLinkSchema = z.object({
  from: z.string(),
  to: z.string(),
  rel: z.string(),
  /** 来源：explicit=L() 显式构造 · ref=列命名约定（xxxRef/xxxId 指向另一表）。 */
  origin: z.enum(["explicit", "ref"]),
});
export type ProtoLink = z.infer<typeof ProtoLinkSchema>;

/** intake 解析结果：数据 + 关系 + 未解析块（诚实列出，不静默丢）。 */
export const IntakeResultSchema = z.object({
  dataSources: z.array(ProtoDatasetSchema),
  links: z.array(ProtoLinkSchema),
  /** 解析不了的字面量/块（NAME + 原因）——诚实暴露，供人工补。 */
  unparsed: z.array(z.object({ name: z.string(), reason: z.string() })).default([]),
});
export type IntakeResult = z.infer<typeof IntakeResultSchema>;

/** 对账人确认动作（类比 MergeCandidate 的人审动作）。 */
export const RECONCILE_ACTIONS = ["USE", "RENAME", "NEW", "MERGE", "DISCARD"] as const;
export const ReconcileActionSchema = z.enum(RECONCILE_ACTIONS);
export type ReconcileAction = z.infer<typeof ReconcileActionSchema>;

/** 字段对账人确认候选（映射不上/冲突/多候选同分 → 弹人确认）。 */
export const SchemaReconcileCandidateSchema = z.object({
  datasetName: z.string(),
  prototypeColumn: z.string(),
  /** 既有本体字段候选（按分降序）。 */
  candidates: z.array(z.object({ targetType: z.string(), targetField: z.string(), score: z.number() })),
  /** 系统建议动作（人可改）：有高分候选→USE；无候选→NEW。 */
  suggestedAction: ReconcileActionSchema,
  status: z.enum(["PENDING", "RESOLVED"]).default("PENDING"),
  /** P2 持久化字段（preview 态可空；落库后填）。 */
  id: z.string().optional(),
  tenantId: z.string().optional(),
  /** WO-INTAKE-VISIBILITY（G-VIS-1）：CSV/上传 objectify 路径落库时带来源连接 + 列名 + 样本值（前端逐列确认可见上下文）。 */
  connId: z.string().optional(),
  column: z.string().optional(),
  sampleValues: z.array(z.unknown()).optional(),
  /** 人确认的动作（RESOLVED 时）。 */
  resolvedAction: ReconcileActionSchema.optional(),
  /** RENAME/USE 时人选的目标字段；NEW 时新建字段名。 */
  resolvedTarget: z.string().optional(),
  resolvedAt: z.string().optional(),
});
export type SchemaReconcileCandidate = z.infer<typeof SchemaReconcileCandidateSchema>;

/** P2 resolve 请求：人对某对账候选拍板 USE/RENAME/NEW/MERGE/DISCARD（+目标字段）。 */
export const ReconcileResolveBodySchema = z.object({
  action: ReconcileActionSchema,
  target: z.string().optional(),
});
export type ReconcileResolveBody = z.infer<typeof ReconcileResolveBodySchema>;

/** 对账预览：自动映射成功项 + 待人确认候选。 */
export const ReconcilePreviewSchema = z.object({
  autoMapped: z.array(z.object({ datasetName: z.string(), column: z.string(), targetType: z.string(), targetField: z.string() })),
  candidates: z.array(SchemaReconcileCandidateSchema),
});
export type ReconcilePreview = z.infer<typeof ReconcilePreviewSchema>;

/** POST /a/v1/databuilder/intake 响应：解析结果 + 对账预览。 */
export const IntakeResponseSchema = z.object({
  intake: IntakeResultSchema,
  reconcile: ReconcilePreviewSchema,
});
export type IntakeResponse = z.infer<typeof IntakeResponseSchema>;

export const IntakeRequestSchema = z.object({
  /** 原型源文本（HTML，本期；figma/xlsx 预留接口）。 */
  html: z.string().min(1),
  format: z.enum(["html"]).default("html"),
});
export type IntakeRequest = z.infer<typeof IntakeRequestSchema>;

/** P3 导入正门请求：原型 HTML 物化进库（经 prototype_html 连接器，数据连接器可见 + 在线查看）。 */
export const IntakeImportRequestSchema = z.object({
  html: z.string().min(1),
  filename: z.string().default("prototype.html"),
  format: z.enum(["html"]).default("html"),
});
export type IntakeImportRequest = z.infer<typeof IntakeImportRequestSchema>;

/** P3 闭环末步请求：把某连接（原型导入）的 RawDataset 按对账物化为 ObjectInstance。 */
export const IntakeObjectifyRequestSchema = z.object({
  connId: z.string().min(1),
});
export type IntakeObjectifyRequest = z.infer<typeof IntakeObjectifyRequestSchema>;

/** P3 闭环末步响应：物化进既有对象库的明细（每表→类型→条数）+ 诚实跳过项。 */
export const IntakeObjectifyResponseSchema = z.object({
  jobId: z.string(),
  materialized: z.array(z.object({ dataset: z.string(), type: z.string(), count: z.number().int() })),
  skipped: z.array(z.object({ dataset: z.string(), reason: z.string() })),
});
export type IntakeObjectifyResponse = z.infer<typeof IntakeObjectifyResponseSchema>;

/** P3 导入响应：落库的连接 + 各 RawDataset 概要（id/name/rowCount/列）。 */
export const IntakeImportResponseSchema = z.object({
  connection: z.object({ id: z.string(), name: z.string(), category: z.string().optional() }).passthrough(),
  datasets: z.array(z.object({ id: z.string(), name: z.string(), rowCount: z.number().int(), fields: z.array(z.string()) })),
  rowCounts: z.record(z.string(), z.number()),
});
export type IntakeImportResponse = z.infer<typeof IntakeImportResponseSchema>;
