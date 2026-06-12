import { z } from "zod";

// ---------------------------------------------------------------------------
// Feature Entitlement 增量 PRD：功能开通与前端展示配置
// ---------------------------------------------------------------------------

export const FeatureLevelSchema = z.enum(["VIEW", "BLOCK", "ACTION"]);
export type FeatureLevel = z.infer<typeof FeatureLevelSchema>;

export const FeatureDefSchema = z.object({
  key: z.string(), // 三层命名：view.dash / shell.query-dock / act.export …
  name: z.string(),
  level: FeatureLevelSchema,
  defaultOn: z.boolean(),
  requires: z.array(z.string()).optional(), // BLOCK/ACTION 必须声明所属 VIEW
  bindings: z
    .object({
      intents: z.array(z.string()).optional(),
      solverKeys: z.array(z.string()).optional(),
      apiTags: z.array(z.string()).optional(),
    })
    .optional(),
});
export type FeatureDef = z.infer<typeof FeatureDefSchema>;

export const FeatureConfigSchema = z.object({
  tenantId: z.string(),
  role: z.string().optional(), // 空 = 租户层；角色层只允许在租户开通集合内收窄
  overrides: z.record(z.string(), z.boolean()),
  configVersion: z.number().int(),
  updatedBy: z.string(),
  updatedAt: z.string(),
});
export type FeatureConfig = z.infer<typeof FeatureConfigSchema>;

/** GET /a/v1/tenants/{id}/features 的解析结果（B 侧消费同此） */
export const ResolvedFeaturesSchema = z.object({
  features: z.array(z.string()), // 展开后的最终生效 key 集合
  configVersion: z.number().int(),
});
export type ResolvedFeatures = z.infer<typeof ResolvedFeaturesSchema>;

export const FeatureErrorCodes = {
  FEATURE_NOT_FOUND: "FEATURE_NOT_FOUND", // 404，不泄露功能存在性
  ROLE_CANNOT_EXCEED_TENANT: "ROLE_CANNOT_EXCEED_TENANT", // 422
} as const;
