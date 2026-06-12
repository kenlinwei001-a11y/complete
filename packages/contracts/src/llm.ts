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
