import type { AgentLlmClient, LlmAgentMessage, ToolLoopEvent, ToolLoopReq } from "./types.js";

const DEFAULT_MAX_ITERATIONS = 16;

/**
 * 增量 §1.2 toolLoop 原语的通用实现：基于 adapter 的 agent() 逐轮驱动，
 * tool_use → executeTool → tool_result 回填，直至 end_turn / 迭代上限。
 *
 * 注意：AgentCore 的 QOS 工具循环（预算/权限闸/final_answer/上下文三刀）仍由
 * runAgentLoop 持有 —— 该语义层面在循环侧而非 provider 侧（QOS-PRD §6.3）。
 * 此原语供轻量调用方（如 DataCore 内部小循环 / custom 集成）使用。
 */
export async function* runToolLoop(adapter: AgentLlmClient, req: ToolLoopReq): AsyncGenerator<ToolLoopEvent> {
  const messages: LlmAgentMessage[] = [...req.messages];
  const max = req.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  for (let i = 0; i < max; i++) {
    const response = await adapter.agent({
      model: req.model,
      system: req.system,
      tools: req.tools,
      messages,
      maxTokens: req.maxTokens,
    });
    messages.push({ role: "assistant", content: response.content, raw: response.raw });
    const toolUses = response.content.filter(
      (b): b is { type: "tool_use"; id: string; name: string; input: unknown } => b.type === "tool_use",
    );
    if (response.stopReason !== "tool_use" || toolUses.length === 0) {
      yield { type: "final", response };
      return;
    }
    yield { type: "assistant_turn", response };
    const results: { type: "tool_result"; toolUseId: string; content: string; isError: boolean }[] = [];
    for (const tu of toolUses) {
      const r = await req.executeTool({ id: tu.id, name: tu.name, input: tu.input });
      results.push({ type: "tool_result", toolUseId: tu.id, content: r.content, isError: r.isError });
      yield { type: "tool_result", toolUseId: tu.id, name: tu.name, content: r.content, isError: r.isError };
    }
    messages.push({ role: "user", content: results });
  }
  // 迭代上限：以最后一轮 assistant 响应收尾
  const last = await adapter.agent({
    model: req.model,
    system: req.system,
    tools: [],
    messages,
    maxTokens: req.maxTokens,
  });
  yield { type: "final", response: last };
}
