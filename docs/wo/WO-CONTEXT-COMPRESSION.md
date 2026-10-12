# WO-CONTEXT-COMPRESSION · 接真 LLM 滚动摘要器（完成上下文压缩最后一块）

> 一句话：上下文压缩已完成 80%（Token 预算器 + tool_result 截断 + 三刀清理 + 滚动摘要框架）——**只缺一块**：`defaultRollingSummary` 是确定性拼接，真 LLM 摘要器只是没接的 hook。本 WO 实现并接上它。

## 背景（审核方已核实·代码锚点确切）
- 现状（`apps/agentcore/src/agent/context.ts`）：
  - ✅ `ContextBudgeter`（软 70%/硬 90%·count_tokens 每 2 轮实测）· ✅ `truncateToolResultJson`（tool_result 截断 8KB）· ✅ 三刀清理（`foldOldestFrame` 折叠最旧轮 / compaction / `CONTEXT_FULL_REMINDER` 强制收尾）· ✅ 滚动摘要框架。
  - ❌ `defaultRollingSummary`（:191）是**确定性拼接**（去重+有界 1600 字）；注释（:188）说"生产可注入 LLM 摘要器覆盖（llmRollingSummarizer）"——**但该 LLM 摘要器根本没实现**。
- 注入点（`apps/agentcore/src/agent/loop.ts`）：`:196 const summarize = opts.summarizer ?? defaultRollingSummary` —— `opts.summarizer` 由 runAgentLoop 调用方传入；唯一调用点 `orchestrator.ts:1066 runAgentLoop({...})` **未传 summarizer**（故恒走确定性兜底）。
- 可复用：`llm.compose(...)`（`llm/types.ts`·`execute-plan.ts:166` 已用）产 LLM 文本；mock `ScriptedLlmClient.composeResults`（`llm/mock.ts:42`）可 stub 测试；`providerAvailable`（急救新增·`providers.ts`）判"真有 LLM"。

## 🚦 文件边界
- `apps/agentcore/src/agent/context.ts`（新增 `makeLlmRollingSummarizer`）
- `apps/agentcore/src/router/orchestrator.ts`（`:1066 runAgentLoop` 调用处注入 summarizer）
- `apps/agentcore/test/**`（SEAM 测）
- 禁碰：其它 runAgentLoop 无关逻辑；providers.ts（`providerAvailable` 已在，只调用）。

## 产出
1. **`makeLlmRollingSummarizer(llm, model, tenantId, providerAvailable)`**（context.ts）：返回 `(notes: string[]) => Promise<string>`——
   - `providerAvailable=true`：调 `llm.compose({model, tenantId, system:"把以下已折叠轮次的调查笔记压成≤1600字中文'前情摘要'，只保留已验证事实+工具名+数字，去重，不编造", user: notes.join("\n")})` → 返回摘要；compose 抛错 → 兜底 `defaultRollingSummary(notes)`。
   - `providerAvailable=false`：直接 `defaultRollingSummary(notes)`（fail-open·CI 可复现·零额外 LLM 调用）。
2. **注入**（orchestrator.ts:1066）：`runAgentLoop({..., summarizer: makeLlmRollingSummarizer(this.deps.engine.deps.llm, model, task.tenantId, await this.deps.llmSettings.providerAvailable(task.tenantId, "compose", pkg.composeModel))})`。（role 用 "compose" 或 "agent"·与摘要用途一致）

## 硬约束
- **fail-open**：无 provider / compose 抛错 → 退 `defaultRollingSummary`，**绝不阻断 agent 循环**（现有 500 测全走此路·零回归）。
- **R6/CI 可复现**：mock 无 composeResults 时退确定性；测试注入 composeResults 验 LLM 路。
- 数字红线不放松：摘要"仅供回忆·业务事实仍以工具结果为准"（沿用 loop.ts:206 既有措辞）。

## SEAM 门 / 验收
- 新增 `context-compression-seam.test.ts`：① 有 provider + queue composeResults → 折叠轮触发 → 摘要用 LLM compose 输出（断言 compose 被调 + 摘要含 stub 文本）；② 无 provider → 退 `defaultRollingSummary`（断言 compose 未被调·字节兼容）。
- 四包全绿：`pnpm -r build && pnpm -r --workspace-concurrency=1 test`（datacore 勿并发 vitest）。
- handoff 分支 `claude/handoff-wo-context-compression`。

## 参考
`docs/PRD-agent-react-harness.md`（Harness §5 状态管理·工作记忆）；急救 `providers.ts providerAvailable` 同款 fail-open 判定。
