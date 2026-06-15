/**
 * LLM Provider 增量 §1.2：OpenAICompatAdapter（OpenAI / vLLM / 国产模型 OpenAI
 * 风格端点）收编至 packages/llm-adapters，行为不变；保留 re-export 兼容既有路径。
 */
export { OpenAiLlmClient } from "@platform/llm-adapters";
export type {
  OpenAiChatCompletion,
  OpenAiChatMessage,
  OpenAiChatPort,
  OpenAiLlmClientOptions,
  OpenAiToolCall,
} from "@platform/llm-adapters";
