import { z } from "zod";

// ---------------------------------------------------------------------------
// OC3 环境间配置迁移 + 跨系统 Saga（execution-semantics §3 + operational-completeness OC3）
// 配置包导出/导入：DRY_RUN_OK→APPLYING_A→APPLYING_B→COMMITTED，B 段失败 → COMPENSATING→COMPENSATED
// （回滚 A）。schemaVersion 兼容校验 + 冲突策略。首个配置维度 = 功能开通 overrides（entitlement =
// 可售包形态，set-all/restore-all 补偿清晰）；bundle 可扩展其他维度。
// ---------------------------------------------------------------------------

export const CONFIG_BUNDLE_SCHEMA_VERSION = "1.0";

export const ConfigBundleSchema = z.object({
  /** 平台 schema 版本（跨环境兼容校验：major 不匹配 → 拒绝导入）。 */
  platformSchemaVersion: z.string().default(CONFIG_BUNDLE_SCHEMA_VERSION),
  sourceTenantId: z.string(),
  exportedAt: z.string(),
  /** DataCore 侧：功能开通 overrides（A 段应用对象）。 */
  featureOverrides: z.record(z.string(), z.boolean()).default({}),
  /** AgentCore 侧配置（跨系统 Saga B 段；opaque 透传给 B 客户端）。 */
  agentCore: z.record(z.string(), z.unknown()).optional(),
});
export type ConfigBundle = z.infer<typeof ConfigBundleSchema>;

export const ImportConflictPolicySchema = z.enum(["SKIP", "OVERWRITE", "FAIL"]);
export type ImportConflictPolicy = z.infer<typeof ImportConflictPolicySchema>;

export const ImportDiffSchema = z.object({
  featureOverrides: z.object({
    added: z.array(z.string()), // 目标没有的键
    changed: z.array(z.object({ key: z.string(), from: z.boolean(), to: z.boolean() })), // 值不同 = 冲突
    same: z.array(z.string()),
  }),
  /** 冲突键（changed）；policy=FAIL 时阻断导入。 */
  conflicts: z.array(z.string()),
});
export type ImportDiff = z.infer<typeof ImportDiffSchema>;

export const ImportJobStateSchema = z.enum([
  "VALIDATING",
  "DRY_RUN_OK",
  "APPLYING_A",
  "APPLYING_B",
  "COMMITTED",
  "COMPENSATING",
  "COMPENSATED",
  "FAILED",
]);
export type ImportJobState = z.infer<typeof ImportJobStateSchema>;

export const ImportJobSchema = z.object({
  id: z.string(), // imp_
  tenantId: z.string(),
  state: ImportJobStateSchema,
  schemaVersion: z.string(),
  dryRun: z.boolean(),
  conflictPolicy: ImportConflictPolicySchema,
  diff: ImportDiffSchema.optional(),
  error: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ImportJob = z.infer<typeof ImportJobSchema>;

export const ImportBundleBodySchema = z.object({
  bundle: ConfigBundleSchema,
  dryRun: z.boolean().default(false),
  conflictPolicy: ImportConflictPolicySchema.default("OVERWRITE"),
});
export type ImportBundleBody = z.infer<typeof ImportBundleBodySchema>;
