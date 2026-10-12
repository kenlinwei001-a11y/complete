import { z } from "zod";

// ---------------------------------------------------------------------------
// OC6 平台内置提示词配置化（operational-completeness OC6）
// 分类器/抽取/建模等平台内置提示词收编为版本化模板：平台默认 + 租户 override（按租户可改）。
// 消费方经 resolvePrompt(tenantId, key) 取生效模板（租户 override ← 平台默认）。
// ---------------------------------------------------------------------------

/** 平台内置提示词键（消费方约定）。 */
export const PROMPT_KEYS = [
  "classifier",
  /**
   * WO-DOMAIN-BY-INTENT · **域目录**（每个域一条描述：覆盖什么业务问题 / 不覆盖什么）。
   * 分类器据它与问句的**意图**做语义匹配 → 回 `domainRole`（选哪个域的角色 agent 作答）；
   * 「选哪个域」与「选上之后能看什么」是两份数据：本键只影响**路牌**，角色 agent 的对象域/工具面由
   * 其 scopeDeclaration 另行强制（越界拒），二者不合并。
   */
  "classifier_domains",
  "extraction",
  "modeling",
  "skill_summary_lint",
  "answer_compose",
] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];

/** 平台默认提示词（出厂单一来源；租户未 override 时生效）。 */
export const PLATFORM_PROMPT_DEFAULTS: Record<PromptKey, string> = {
  classifier: "你是意图分类器。把用户问句映射到候选意图并给置信度；无命中则判 outOfCatalog。只输出结构化结果。",
  /**
   * WO-DOMAIN-BY-INTENT · 出厂域目录（三域 + "都套不上"的兜底）。**覆盖/不覆盖都要写** ——
   * 只写覆盖会让两个域都能套上同一句模糊问句，判据就退化成"看哪个域先写"。
   * ⚠ 这里只描述**业务语义**（覆盖什么业务问题），⛔ 不写对象域/工具/仓库/权限 —— 那是另一份数据（见 gate）。
   * 租户可经 `PUT /a/v1/prompt-templates/classifier_domains` 整体替换（改描述**不改代码**）。
   */
  classifier_domains: [
    "- supply-chain（供应链·物料齐套）：覆盖 物料齐套与供应保障、供应商与采购到货、库存与长协覆盖、断供/缺料类问题；不覆盖 产能与排产、质量判定。",
    "- production（生产·产能瓶颈）：覆盖 产能与产线瓶颈、排产/换型/爬坡、工序与设备利用率（OEE）类问题；不覆盖 物料供应保障、质量判定。",
    "- quality（质量·良率）：覆盖 质量与良率、检验与不良/缺陷、一致性/合规（含批次、设备质量记录）类问题；不覆盖 物料供应保障、产能与排产。",
    "以上三域都套不上（如单纯罗列某对象的记录/字段清单、平台操作、与三域无关的泛问）⇒ domainRole=null（由通用 agent 作答）。",
  ].join("\n"),
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
