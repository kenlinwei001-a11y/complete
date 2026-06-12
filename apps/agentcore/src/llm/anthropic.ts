/**
 * LLM Provider 增量 §1.2：AnthropicAdapter（现 QOS-PRD §6 实现）收编至
 * packages/llm-adapters，行为不变；此处保留 re-export 以兼容既有 import 路径。
 */
export { AnthropicLlmClient, ClassifierParseError, COMPACTION_BETA, ClassificationSchema } from "@platform/llm-adapters";
