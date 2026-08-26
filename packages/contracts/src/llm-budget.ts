import { z } from "zod";

// OC7 LLM 成本配额与降级（operational-completeness OC7）：租户级 token 月度配额 + 软/硬线。
// 软线（softLimitPct×hard）→ 降级（路径B 拒新任务前先警示/路径A 跳过非必要 compose）；硬线 → 拒。
export const LlmBudgetSchema = z.object({
  id: z.string(), // lbg_<tenant>
  tenantId: z.string(),
  hardLimitTokens: z.number().int().nonnegative(), // 0 = 不限
  softLimitPct: z.number().min(0).max(1).default(0.8),
  periodStart: z.string(),
  usedTokens: z.number().int().nonnegative().default(0),
  updatedAt: z.string(),
});
export type LlmBudget = z.infer<typeof LlmBudgetSchema>;

export const LlmBudgetStatusSchema = z.object({
  usedTokens: z.number().int(),
  hardLimitTokens: z.number().int(),
  softLimitTokens: z.number().int(),
  state: z.enum(["OK", "SOFT_EXCEEDED", "HARD_EXCEEDED"]),
  /** 降级建议：硬线→拒新 LLM 任务；软线→跳过非必要 compose/精简。 */
  degrade: z.boolean(),
});
export type LlmBudgetStatus = z.infer<typeof LlmBudgetStatusSchema>;

export const PutLlmBudgetBodySchema = z.object({
  hardLimitTokens: z.number().int().nonnegative(),
  softLimitPct: z.number().min(0).max(1).optional(),
});
export const RecordUsageBodySchema = z.object({ tokens: z.number().int().nonnegative() });
