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
// 增量 §1.5（Phase8）厂商目录：配置页按厂商预填 baseUrl + 提供型号下拉。
// Moonshot/GLM(智谱)/MiniMax/DeepSeek/Qwen/Gemini 均为 OpenAI 兼容端点 → kind=openai_compatible，
// 仅 baseUrl/model 不同（Gemini 走其 OpenAI 兼容端点）；Anthropic 为原生。无需新增适配器。
// 该目录仅驱动 UI 预填；后端仍按 kind+baseUrl+model 自由配置（不锁枚举）。
// ---------------------------------------------------------------------------

export const LlmVendorSchema = z.object({
  key: z.string(), // 厂商键（anthropic/openai/moonshot/zhipu/minimax/gemini/deepseek/qwen）
  displayName: z.string(),
  kind: LlmProviderKindV2Schema, // 该厂商对应的 provider kind
  defaultBaseUrl: z.string().optional(),
  docUrl: z.string().optional(),
  models: z.array(LlmProviderModelSchema),
});
export type LlmVendor = z.infer<typeof LlmVendorSchema>;

const cap = (tools: boolean, structuredOutput: boolean, maxContext: number): LlmModelCapabilities => ({ tools, structuredOutput, maxContext });
const m = (modelId: string, displayName: string, c: LlmModelCapabilities): LlmProviderModel => ({ modelId, displayName, capabilities: c });

/** 厂商 + 型号目录（配置页下拉数据源；可随厂商发版增删，不影响后端）。 */
export const LLM_VENDOR_CATALOG: LlmVendor[] = [
  {
    key: "anthropic", displayName: "Anthropic（Claude）", kind: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com", docUrl: "https://docs.anthropic.com",
    models: [
      m("claude-opus-4-8", "Claude Opus 4.8", cap(true, true, 200000)),
      m("claude-sonnet-4-6", "Claude Sonnet 4.6", cap(true, true, 200000)),
      m("claude-haiku-4-5-20251001", "Claude Haiku 4.5", cap(true, true, 200000)),
    ],
  },
  {
    key: "openai", displayName: "OpenAI", kind: "openai_compatible",
    defaultBaseUrl: "https://api.openai.com/v1", docUrl: "https://platform.openai.com/docs",
    models: [
      m("gpt-4o", "GPT-4o", cap(true, true, 128000)),
      m("gpt-4o-mini", "GPT-4o mini", cap(true, true, 128000)),
      m("o3", "o3", cap(true, true, 200000)),
      m("o4-mini", "o4-mini", cap(true, true, 200000)),
    ],
  },
  {
    key: "moonshot", displayName: "Moonshot（月之暗面 Kimi）", kind: "openai_compatible",
    defaultBaseUrl: "https://api.moonshot.cn/v1", docUrl: "https://platform.moonshot.cn",
    models: [
      m("kimi-k2-5", "Kimi 2.5", cap(true, true, 256000)),
      m("kimi-k2-5-long-context", "Kimi 2.5 Long Context", cap(true, true, 2000000)),
      m("kimi-k2", "Kimi K2", cap(true, true, 256000)),
      m("kimi-k1-5", "Kimi K1.5", cap(true, true, 256000)),
      m("moonshot-v1-128k", "Moonshot v1 128K", cap(true, true, 128000)),
      m("moonshot-v1-32k", "Moonshot v1 32K", cap(true, true, 32000)),
      m("moonshot-v1-8k", "Moonshot v1 8K", cap(true, true, 8000)),
    ],
  },
  {
    key: "zhipu", displayName: "智谱 GLM（Zhipu）", kind: "openai_compatible",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4", docUrl: "https://open.bigmodel.cn/dev/api",
    models: [
      m("glm-5-5", "GLM-5.5", cap(true, true, 256000)),
      m("glm-5-2", "GLM-5.2", cap(true, true, 200000)),
      m("glm-4.6", "GLM-4.6", cap(true, true, 200000)),
      m("glm-4.5", "GLM-4.5", cap(true, true, 128000)),
      m("glm-4-plus", "GLM-4-Plus", cap(true, true, 128000)),
      m("glm-4-air", "GLM-4-Air", cap(true, true, 128000)),
      m("glm-4-flash", "GLM-4-Flash", cap(true, true, 128000)),
    ],
  },
  {
    key: "minimax", displayName: "MiniMax", kind: "openai_compatible",
    defaultBaseUrl: "https://api.minimaxi.com/v1", docUrl: "https://platform.minimaxi.com",
    models: [
      m("MiniMax-Text-01", "MiniMax-Text-01", cap(true, true, 1000000)),
      m("abab6.5s-chat", "abab6.5s", cap(true, true, 245000)),
    ],
  },
  {
    key: "gemini", displayName: "Google Gemini（OpenAI 兼容端点）", kind: "openai_compatible",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", docUrl: "https://ai.google.dev/gemini-api/docs/openai",
    models: [
      m("gemini-2.5-pro", "Gemini 2.5 Pro", cap(true, true, 1000000)),
      m("gemini-2.5-flash", "Gemini 2.5 Flash", cap(true, true, 1000000)),
      m("gemini-2.0-flash", "Gemini 2.0 Flash", cap(true, true, 1000000)),
    ],
  },
  {
    key: "deepseek", displayName: "DeepSeek（深度求索）", kind: "openai_compatible",
    defaultBaseUrl: "https://api.deepseek.com/v1", docUrl: "https://api-docs.deepseek.com",
    models: [
      m("deepseek-v4", "DeepSeek-V4", cap(true, true, 128000)),
      m("deepseek-v4-pro", "DeepSeek-V4 Pro", cap(true, true, 128000)),
      m("deepseek-chat", "DeepSeek-V3 Chat", cap(true, true, 64000)),
      m("deepseek-reasoner", "DeepSeek-R1 Reasoner", cap(true, false, 64000)),
    ],
  },
  {
    key: "qwen", displayName: "通义千问 Qwen（DashScope）", kind: "openai_compatible",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", docUrl: "https://help.aliyun.com/zh/dashscope",
    models: [
      m("qwen-max", "Qwen-Max", cap(true, true, 32000)),
      m("qwen-plus", "Qwen-Plus", cap(true, true, 131000)),
      m("qwen-turbo", "Qwen-Turbo", cap(true, true, 1000000)),
    ],
  },
];

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
  "comprehend", // 数据构建发动机：故事脚本意图解析→全栈倒推（听懂任意业务语言；缺则确定性关键词地板）
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
  comprehend: { structuredOutput: true },
};

/** execution-semantics §5.4：LLM 故障降级逐次 provider 尝试审计（providerId/结果/耗时）。 */
export const ProviderAttemptSchema = z.object({
  tenantId: z.string(),
  providerId: z.string(),
  outcome: z.enum(["OK", "FALLBACK_TRIGGERED", "FALLBACK_OK", "FALLBACK_FAILED"]),
  ms: z.number(),
  at: z.string(),
});
export type ProviderAttempt = z.infer<typeof ProviderAttemptSchema>;
