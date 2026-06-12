import { z } from "zod";

// ---------------------------------------------------------------------------
// 多 LLM 支持（修订 QOS-PRD §6：不再 Anthropic 专用，provider 可配置）
// ---------------------------------------------------------------------------

export const LlmProviderKindSchema = z.enum([
  "anthropic", // 官方 @anthropic-ai/sdk
  "openai", // 官方 openai SDK
  "openai_compatible", // 任意 OpenAI 兼容端点（DeepSeek/Qwen/vLLM/Ollama 等，自定义 baseUrl）
]);
export type LlmProviderKind = z.infer<typeof LlmProviderKindSchema>;

export const LlmProviderConfigSchema = z.object({
  id: z.string(), // llmp_
  tenantId: z.string().optional(), // 缺省 = 平台级
  key: z.string(), // 引用名，如 "anthropic-default" / "deepseek"
  kind: LlmProviderKindSchema,
  baseUrl: z.string().optional(), // openai_compatible 必填
  /** 密钥从该环境变量读取（如 ANTHROPIC_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY）或凭据库引用 */
  apiKeyEnv: z.string().optional(),
  credentialRef: z.string().optional(),
  defaultHeaders: z.record(z.string(), z.string()).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]),
});
export type LlmProviderConfig = z.infer<typeof LlmProviderConfigSchema>;

/** 模型角色绑定：哪个角色用哪个 provider 的哪个模型（场景包/租户可覆盖） */
export const ModelRoleSchema = z.enum([
  "classifier", // 意图分类（低延迟结构化输出）
  "agent", // Agent 工具循环
  "extraction", // 规则文档抽取
  "modeling", // 本体建模建议
  "template", // 行业模板生成
  "compose", // llm_compose 步骤
  "embedding", // 向量嵌入
]);
export type ModelRole = z.infer<typeof ModelRoleSchema>;

export const ModelBindingSchema = z.object({
  role: ModelRoleSchema,
  providerKey: z.string(),
  model: z.string(),
});
export type ModelBinding = z.infer<typeof ModelBindingSchema>;

// ---------------------------------------------------------------------------
// Embedding（求解器增量 PRD §S4：EmbeddingProvider 接口，可配置真实实现）
// ---------------------------------------------------------------------------

export const EmbeddingProviderConfigSchema = z.object({
  kind: z.enum(["pseudo", "openai_compatible", "voyage"]), // pseudo = 确定性哈希伪向量（CI/无网络）
  baseUrl: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  model: z.string().optional(),
  dim: z.number().int().default(1024),
});
export type EmbeddingProviderConfig = z.infer<typeof EmbeddingProviderConfigSchema>;

// ---------------------------------------------------------------------------
// LLM Provider 配置体系增量 §1.1（落位 DataCore；表 llm_providers）
// apiKey write-only：写入即 AES-GCM 密文，API/日志永不回显，响应仅 hasApiKey。
// ---------------------------------------------------------------------------

export const LlmModelCapabilitiesSchema = z.object({
  tools: z.boolean(),
  structuredOutput: z.boolean(),
  maxContext: z.number().int(),
});
export type LlmModelCapabilities = z.infer<typeof LlmModelCapabilitiesSchema>;

export const LlmProviderModelSchema = z.object({
  modelId: z.string().min(1),
  displayName: z.string(),
  capabilities: LlmModelCapabilitiesSchema,
});
export type LlmProviderModel = z.infer<typeof LlmProviderModelSchema>;

/** 增量 §1.1 provider kind（custom_http 仅预留接口） */
export const LlmProviderKindV2Schema = z.enum(["anthropic", "openai_compatible", "custom_http"]);
export type LlmProviderKindV2 = z.infer<typeof LlmProviderKindV2Schema>;

/** 平台级模板的保留租户 id（platform_admin 维护，租户可克隆） */
export const PLATFORM_TENANT_ID = "platform";

export const LlmProviderSchema = z.object({
  id: z.string(), // llmp_
  tenantId: z.string(), // PLATFORM_TENANT_ID = 平台级模板
  name: z.string().min(1),
  kind: LlmProviderKindV2Schema,
  baseUrl: z.string().optional(), // openai_compatible 必填；anthropic 可空（官方端点）
  models: z.array(LlmProviderModelSchema),
  status: z.enum(["ACTIVE", "DISABLED"]),
  /** 不可用时的降级目标（≤1 级，禁止链式：目标自身不得再有 fallback） */
  fallbackProviderId: z.string().optional(),
  /** 响应侧派生字段：密钥已配置（明文永不回显） */
  hasApiKey: z.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

// ---------------------------------------------------------------------------
// 增量 §1.3 用途绑定（租户级默认 + 场景包覆盖）
// ---------------------------------------------------------------------------

export const LlmPurposeSchema = z.enum([
  "classifier", // QOS 意图分类
  "agent", // 路径 B 工具循环
  "extraction", // A2 规则文档抽取
  "modeling", // A3 建模建议
  "template_gen", // A7 行业模板生成
  "compose", // workflow llm_compose 步骤
]);
export type LlmPurpose = z.infer<typeof LlmPurposeSchema>;

/** 用途矩阵的固定行序（§1.4 绑定矩阵 UI 与校验共用）。 */
export const LLM_PURPOSES = LlmPurposeSchema.options;

export const PurposeBindingSchema = z.object({
  purpose: LlmPurposeSchema,
  providerId: z.string(),
  modelId: z.string(),
});
export type PurposeBinding = z.infer<typeof PurposeBindingSchema>;

/**
 * 增量 §1.3 默认能力要求。`tools` 为硬性要求（绑定时校验拒绝 —— 工具循环不做提示词
 * 模拟）；`structuredOutput` 缺失时绑定仍可保存，但运行期走 JSON-mode 降级
 * （提示 + zod 校验重试 ≤2，见 §1.2），响应附 warnings。
 */
export const PURPOSE_CAPABILITY_REQUIREMENTS: Record<
  LlmPurpose,
  { tools?: boolean; structuredOutput?: boolean }
> = {
  classifier: { structuredOutput: true },
  agent: { tools: true, structuredOutput: true },
  extraction: { structuredOutput: true },
  modeling: { structuredOutput: true },
  template_gen: { structuredOutput: true },
  compose: {},
};
