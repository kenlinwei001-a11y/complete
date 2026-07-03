import { z } from "zod";
import { SlotDefSchema } from "./qos.js";
import { DataRequestSchema } from "./growth.js";

/**
 * FILL-BOUNDARY-GUARDRAIL · 触发补数据的内容边界判定（用户钉「触发补须有边界·否则任意问题自由补数据=数据混乱」）。
 *
 * 三道内容闸（与 GROWTH-WORKLIST 过程闸「认领」正交组合）：
 *  - **B1 槽位完备闸**：触发按钮前置条件 = 必需槽位已解析（时间窗/对象域/实体）；不完备 → `CLARIFY`
 *    先走确定性澄清（复用 Clarification「第 n/2 次确认」UI），澄清完才可触发；触发前必出**生成计划预览**
 *    （`PREVIEW`·将建类型/行数/值域来源）人确认才跑——不盲补。
 *  - **B2 模式封闭闸**：补数据只写**已发布 ObjectType schema + IndustryPack 值域**内的类型/字段；
 *    枚举有界字段（型号/基地/细分/仓类/物料）**只取注册表既有值·绝不发明新实体名**。
 *  - **B3 越界闸**：涉词表外**新实体/新类型** → `HARD_BLOCK` 拒自动合成 + 自动合成 `DataRequest`
 *    （要求人工输入「数据描述」）→ R4 审批物化为值域模板 → 才允许 SOFT 合成。
 *
 * 不变式：产出一律 PROVISIONAL / `origin=SYNTHETIC`（进看板可见可撤）。确定性纯函数（R6·同问句同槽位同判）。
 */

/** B2 生成计划预览：人确认前先看「将建哪些类型/多少行/值域来源/有界枚举取值」——不盲补。 */
export const GenerationPlanPreviewSchema = z.object({
  /** 目标对象类型（∈ 已发布 ObjectType schema·B2 封闭）。 */
  typeKey: z.string(),
  /** 将写字段（typed props）。 */
  fields: z.array(z.string()),
  /** 预计合成行数。 */
  rows: z.number().int(),
  /** 值域来源说明（注册表 + IndustryPack·R14·非凭空造）。 */
  valueDomainSource: z.string(),
  /** 有界枚举字段的取值（全取注册表既有值·B2 枚举封闭）。 */
  boundedEnums: z.array(z.object({ field: z.string(), values: z.array(z.string()) })),
  /** 产出恒 SYNTHETIC。 */
  origin: z.literal("SYNTHETIC"),
  /** 产出恒 PROVISIONAL。 */
  provisional: z.literal(true),
});
export type GenerationPlanPreview = z.infer<typeof GenerationPlanPreviewSchema>;

/** 三闸判定终态。 */
export const TriggerGateOutcomeSchema = z.enum(["CLARIFY", "PREVIEW", "HARD_BLOCK"]);
export type TriggerGateOutcome = z.infer<typeof TriggerGateOutcomeSchema>;

/**
 * 触发补数据前置边界判定结果（确定性）。
 *  - `CLARIFY`   B1 缺槽位 → `missingSlots`（复用 Clarification 槽位表单）+ round/maxRounds。
 *  - `PREVIEW`   B1 槽位齐 + B2 封闭内 → `plan`（生成计划预览·人确认才跑）。
 *  - `HARD_BLOCK` B3 越界新实体/新类型 → `dataRequest`（人工正门·要求数据描述→R4）。
 */
export const TriggerBoundaryDecisionSchema = z.object({
  outcome: TriggerGateOutcomeSchema,
  /** B1 澄清轮次（第 n/2 次确认）。 */
  round: z.number().int().optional(),
  maxRounds: z.number().int().optional(),
  /** B1：需澄清的必需槽位（复用 Clarification SLOT_FILLING）。 */
  missingSlots: z.array(SlotDefSchema).optional(),
  /** 已解析的槽位（澄清回填后累计）。 */
  resolvedSlots: z.record(z.string(), z.unknown()).optional(),
  /** B2：生成计划预览（人确认才跑）。 */
  plan: GenerationPlanPreviewSchema.optional(),
  /** B3：越界 → 精确补数请求（人工正门）。 */
  dataRequest: DataRequestSchema.optional(),
  /** 人话说明（前端直呈）。 */
  reason: z.string(),
});
export type TriggerBoundaryDecision = z.infer<typeof TriggerBoundaryDecisionSchema>;
