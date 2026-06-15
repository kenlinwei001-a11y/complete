import { z } from "zod";

// ---------------------------------------------------------------------------
// 统一引用模式增量 §2.1：跨模块引用总规范。
// 解析时点一律为执行时（latest = 该 key 当前 PUBLISHED 最新版）；需要稳定性的
// 场景才显式 pin 数字版本。规则引用永远 latest（不可 pin —— 约束必须全局一致）。
// ---------------------------------------------------------------------------

export const RefKindSchema = z.enum(["rule", "skill", "workflow", "plan", "agent", "mcp", "intent"]);
export type RefKind = z.infer<typeof RefKindSchema>;

export const RefVersionSchema = z.union([z.number().int(), z.literal("latest")]);
export type RefVersion = z.infer<typeof RefVersionSchema>;

export const RefSchema = z.object({
  kind: RefKindSchema,
  key: z.string(),
  version: RefVersionSchema.default("latest"),
});
export type Ref = z.infer<typeof RefSchema>;

/** 增量 §2.2 可复算性留痕：执行时解析到的实际版本（QueryTask.resolvedRefs）。 */
export const ResolvedRefSchema = z.object({
  kind: RefKindSchema,
  key: z.string(),
  version: z.number().int(),
});
export type ResolvedRef = z.infer<typeof ResolvedRefSchema>;

/** 修订 QOS-PRD §4.1：意图 → 执行计划由 planId（钉死版本）升级为 planRef。 */
export const PlanRefSchema = z.object({
  planKey: z.string(),
  version: RefVersionSchema.default("latest"),
});
export type PlanRef = z.infer<typeof PlanRefSchema>;

/** 增量 §2.3：publish 响应必须附带的影响面（references API 反查）。 */
export const PublishImpactSchema = z.object({
  agents: z.number().int(),
  plans: z.number().int(),
  intents: z.number().int(),
  refs: z.array(
    z.object({
      kind: RefKindSchema,
      key: z.string(),
      version: RefVersionSchema,
      name: z.string().optional(),
    }),
  ),
});
export type PublishImpact = z.infer<typeof PublishImpactSchema>;
