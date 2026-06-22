/**
 * Injectable LLM abstraction. Tests use scripted mocks.
 *
 * LLM Provider 增量 §1.2：适配器实现收编至 packages/llm-adapters（两系统共享，
 * 行为不变 —— 含 Agent 运行时增量的 capabilities/countTokens/compaction 支持）。
 * 本文件保留 AgentCore 内的类型别名：`LlmClient` = 共享包的 AgentLlmClient
 * （classify/agent/compose 操作面，QOS 工具循环语义仍在 agent/loop.ts）。
 */

export type {
  AgentLlmClient as LlmClient,
  CompletionReq,
  CompletionResp,
  FullLlmClient,
  LlmAgentMessage,
  LlmAgentRequest,
  LlmAgentResponse,
  LlmAgentToolSpec,
  LlmCapabilities,
  LlmContentBlock,
  ParseReq,
  RawClassification,
  ToolLoopEvent,
  ToolLoopReq,
} from "@platform/llm-adapters";

export { isContextWindowExceededError, LlmEmptyResponseError } from "@platform/llm-adapters";
