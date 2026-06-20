import { z } from "zod";

// ---------------------------------------------------------------------------
// OC6 平台内置提示词配置化（operational-completeness OC6）
// 分类器/抽取/建模等平台内置提示词收编为版本化模板：平台默认 + 租户 override（按租户可改）。
// 消费方经 resolvePrompt(tenantId, key) 取生效模板（租户 override ← 平台默认）。
// ---------------------------------------------------------------------------

/** 平台内置提示词键（消费方约定）。 */
export const PROMPT_KEYS = ["classifier", "extraction", "modeling", "skill_summary_lint", "answer_compose"] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];

/** 平台默认提示词（出厂单一来源；租户未 override 时生效）。 */
export const PLATFORM_PROMPT_DEFAULTS: Record<PromptKey, string> = {
  classifier: "你是意图分类器。把用户问句映射到候选意图并给置信度；无命中则判 outOfCatalog。只输出结构化结果。",
  extraction: "你是规则文档抽取器。从文档抽取约束为 {field, op, value, severity} 结构，保留 sourceQuote。",
  modeling: "你是半自动建模助手。从数据源 schema 推断对象类型/属性/主键/外键候选，输出确定性建议。",
  skill_summary_lint: "你是技能摘要审查器。检查摘要是否含『当…时使用』触发句 + 『不适用』排除句，无禁用词。",
  answer_compose: "你是答案合成器。把求解器输出 + 规则裁决组织为可溯源答案，数字必挂出处，禁止编造。",
};

export const PromptTemplateSchema = z.object({
  id: z.string(), // pt_<tenant>_<key>
  tenantId: z.string(),
  key: z.enum(PROMPT_KEYS),
  template: z.string().min(1),
  version: z.number().int(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type PromptTemplate = z.infer<typeof PromptTemplateSchema>;

/** 生效提示词（resolve 结果）：标明是 override 还是平台默认。 */
export const ResolvedPromptSchema = z.object({
  key: z.enum(PROMPT_KEYS),
  template: z.string(),
  source: z.enum(["TENANT_OVERRIDE", "PLATFORM_DEFAULT"]),
  version: z.number().int(),
});
export type ResolvedPrompt = z.infer<typeof ResolvedPromptSchema>;

export const PutPromptTemplateBodySchema = z.object({ template: z.string().min(1) });
