# A2 · Agent Core 循环与事件

**范围**：`pi2/packages/agent/src/{agent.ts, agent-loop.ts, types.ts}`（未碰 `harness/`）
**探针**：`pi2/packages/agent/test/zz-a2-{helpers,events,parallel,steer,terminate,abort-errors,abort2,recipe}.ts` — **42 条全绿**

```bash
cd <pi2>/packages/agent && npx vitest run test/zz-a2-*.test.ts
#  Test Files  7 passed (7)     Tests  42 passed (42)
```

---

## 一、能力清单（逐条带证据）

### 1.1 事件系统

> ⚠️ **先纠一条派单前提**：任务书写「11 个事件，含 `text`」。**实测只有 10 个，没有 `text` 事件。**

| 能力 | 实测结果 | 证据（命令 + 输出片段） | 判定 |
|---|---|---|---|
| 事件全集 | **10 个**，无 `text` | `npx vitest run test/zz-a2-events.test.ts --silent=false`<br>`E1_DISTINCT= ["agent_end","agent_start","message_end","message_start","message_update","tool_execution_end","tool_execution_start","tool_execution_update","turn_end","turn_start"]`<br>`E1_HAS_text_event= false` | ✅可用（但只有 10 个） |
| 文本增量在哪 | 走 `message_update.assistantMessageEvent`，子类型 `text_start/text_delta/text_end` | `E2_update_subtypes= ["text_start","text_delta","text_delta","text_delta","text_end"]`<br>`E2_deltas= ["这是一段足够长的中文回答","用来触发多个 delta 分片以","验证流式旁白可行性"]`<br>`E2_reassembled= 这是一段足够长的中文回答用来触发多个 delta 分片以验证流式旁白可行性` | ✅可用（**中文分片无乱码，可直接做流式旁白**） |
| 完整事件序（1 工具 + 1 文本收尾） | 见右 | `E1_ORDER= ["agent_start","turn_start","message_start","message_end","message_start","message_update"×6,"message_end","tool_execution_start","tool_execution_update","tool_execution_end","message_start","message_end","turn_end","turn_start","message_start","message_update"×3,"message_end","turn_end","agent_end"]` | ✅可用 |
| 载荷精度 | 逐字段见右 | `E1_KEYS agent_start -> {type}`（空载荷）<br>`E1_KEYS turn_start -> {type}`（**空载荷·无轮次号**）<br>`E1_KEYS message_start/message_end -> {message,type}`<br>`E1_KEYS message_update -> {assistantMessageEvent,message,type}`<br>`E1_KEYS tool_execution_start -> {args,toolCallId,toolName,type}`<br>`E1_KEYS tool_execution_update -> {args,partialResult,toolCallId,toolName,type}`<br>`E1_KEYS tool_execution_end -> {isError,result,toolCallId,toolName,type}`<br>`E1_KEYS turn_end -> {message,toolResults,type}`<br>`E1_KEYS agent_end -> {messages,type}` | ⚠有限制（见下） |
| `turn_start` 无轮次号 | `{type:"turn_start"}` 空载荷 | `E1_turn_start payload= {"type":"turn_start"}` | ⚠有限制（要做 Loop Control 的「第 N 轮」必须自己数） |
| `tool_execution_start` ≠ 工具真开始 | 并行模式下 3 个 start 在 t=6/26/41 就发完，工具真正 ENTER 在 t=58 | `P1_DEFAULT_EVENT_TRACE= [...start:alpha@6, start:beta@26, start:gamma@41...]`<br>`P1_DEFAULT_TOOL_TRACE= ["TOOL_ENTER:alpha@58","TOOL_ENTER:beta@58","TOOL_ENTER:gamma@58"...]` | ⚠有限制（语义是「已排队/预检中」，不是「运行中」） |
| `tool_execution_end` 有完整结果 | `result` 是完整 `AgentToolResult`，含 `details` | `E1_tool_execution_end= {"id":"c1","name":"alpha","isError":false,"result":{"content":[...],"details":{"tool":"alpha"}}}` | ✅可用 |
| `turn_end` 带本轮全部工具结果 | `toolResults` 是完整 `ToolResultMessage[]` | `E1_turn_end.message.role= assistant toolResults.len= 1 toolResults[0]= {"role":"toolResult","toolCallId":"c1","toolName":"alpha","content":[...],"details":{...},"isError":false,"timestamp":...}` | ✅可用（**做 Loop Control 的最佳挂载点**） |
| `agent_end` 带本次 run 全部新消息 | roles 齐全 | `E1_agent_end.messages.len= 4 roles= ["user","assistant","toolResult","assistant"]` | ✅可用 |
| `subscribe()` 返回的取消函数 | **真取消**，且 run 中途自我退订立即生效 | `E3_A_len= 22 B_len= 10`（B 在 tool_execution_start 时自退订，此后 0）<br>`E3_A_before= 22 A_after_unsub_second_run= 22`（A 退订后第二轮 run 一个都没收） | ✅可用 |
| 监听器串行 await | 按订阅顺序**串行**等待完成 | `E4_await_order= ["listener1-start","listener1-end","listener2"]`（listener1 内 await 20ms，listener2 等它） | ⚠有限制（旁白监听器慢 = 拖慢整个循环） |
| **监听器抛错炸掉整个 run** | 工具没执行，run 被转成 error 轮；`prompt()` **不 reject**，静默 | `E4_prompt_outcome= resolved`<br>`E4_state.messages.roles= ["user","assistant","assistant"]`（**无 toolResult = 工具没跑**）<br>`E4_state.errorMessage= LISTENER_BOOM` | ❌不可用（**观测者能杀死被观测者**） |
| 事件里的 message 是**活对象** | `message_end` 的 payload === `state.messages` 里那一条 | `E5_same_object= true`<br>`E5_after_tamper_state_text= "TAMPERED"`（改事件载荷 → transcript 被改） | ❌不可用（**旁观者可静默篡改历史**） |

### 1.2 并行 vs 串行工具执行

合法值只有 `"sequential"` / `"parallel"`（`types.ts:42`），**没有 `"serial"`**。默认 `agent.ts:230 toolExecution ?? "parallel"`。

| 能力 | 实测结果 | 证据 | 判定 |
|---|---|---|---|
| 默认真并行 | **是**。3 个 60ms 工具同刻进入、同刻退出 | `npx vitest run test/zz-a2-parallel.test.ts --silent=false`<br>`P1_enters= [58,58,58] exits= [119,119,119]`<br>`P1_max_enter_spread_ms= 0`<br>`P1_VERDICT_parallel= true (3×60ms 串行应≥180ms，实测 118ms)` | ✅可用 |
| `"sequential"` 真串行 | **是**，严格 ENTER/EXIT 配对 | `P2_interleave_check= ["TOOL_ENTER:alpha","TOOL_EXIT:alpha","TOOL_ENTER:beta","TOOL_EXIT:beta","TOOL_ENTER:gamma","TOOL_EXIT:gamma"]`<br>`P2_VERDICT_serial= true (实测 231ms)` | ✅可用 |
| **写成 `"serial"` 静默退化为并行** | **是**（TS 能拦，配置/JSON 驱动的值拦不住） | `P3_enters= [50,50,50]`<br>`P3_VERDICT_silently_parallel= true (实测 110ms)` | [有但无效]（副作用治理红线：一个拼写错 = 全并行，零告警） |
| 单工具 `executionMode:"sequential"` 毒化整批 | **是**，只标 beta 一个，整批 230ms 串行 | `P4_order= ["TOOL_ENTER:alpha@17","TOOL_EXIT:alpha@77","TOOL_ENTER:beta@93",...]`<br>`P4_VERDICT_whole_batch_serial= true (实测 230ms)` | ✅可用（**最实用的副作用治理原语**） |
| `beforeToolCall` 恒串行 | 即使并行模式，审批钩子也是一个一个跑完才 dispatch | `P1_DEFAULT_BEFORE_HOOK_ORDER= ["before:alpha@10","beforeDone:alpha@26","before:beta@26","beforeDone:beta@41","before:gamma@42","beforeDone:gamma@57"]` | ✅可用（preflight-all-then-execute：**全批预检完才动手**，审批语义正确；代价=串行延迟累加） |
| 并行下一个抛错 | 其余照跑到底，错的那个 `isError:true` | `P5_toolResults= [{"name":"alpha","isError":false,...},{"name":"beta","isError":true,"text":"boom-beta","details":{}},{"name":"gamma","isError":false,...}]` | ✅可用（无 fail-fast） |
| **串行下一个抛错也不 fail-fast** | 第 1 个炸了，第 2、3 个照跑 | `P6_THROW_SEQ_TOOL_TRACE= ["TOOL_ENTER:alpha@16","TOOL_THROW:alpha@76","TOOL_ENTER:beta@92","TOOL_EXIT:beta@152","TOOL_ENTER:gamma@168","TOOL_EXIT:gamma@228"]`<br>`P6_VERDICT_continues_after_failure= true` | ❌不可用（**串行≠事务**。上游失败下游照做，副作用无法「一荣俱荣一损俱损」） |
| 顺序保证 | `tool_execution_end` 按**完成顺序**；toolResult 消息与 transcript 按**源顺序** | `P7_tool_execution_end_ORDER= ["beta@67","gamma@108","alpha@167"]`<br>`P7_toolResult_message_ORDER= ["alpha@167","beta@167","gamma@167"]`<br>`P7_transcript_ORDER= ["alpha","beta","gamma"]` | ✅可用（transcript 确定性有保证） |
| 并行下 toolResult 消息**全批末尾一次性发** | 3 条都在 t=167（最慢那个完成后） | 同上：`toolResultMsg` 三条时间戳全 =167 | ⚠有限制（渐进式 UI 只能用 `tool_execution_end`，不能用 `message_end`） |

### 1.3 Steer vs Follow-up

| 能力 | 实测结果 | 证据 | 判定 |
|---|---|---|---|
| **Steer 不取消任何工具** | 在第 1 个工具刚开始时插话，3 个工具**全部跑完**，插话落在全部工具结果之后 | `npx vitest run test/zz-a2-steer.test.ts --silent=false`<br>`S1_TOOLS_ACTUALLY_RAN= ["alpha","beta","gamma"]`<br>`S1_TRANSCRIPT= ["user:go","assistant:[alpha\|beta\|gamma]","toolResult:alpha","toolResult:beta","toolResult:gamma","user:停下，别改数据","assistant:[]回合2"]`<br>`S1_VERDICT_steer_cancels_pending_tools= false` | [有但无效]（**「停下，别改数据」到达时数据已改完**） |
| Steer 落点 | 当前 turn 的 `turn_end` 之后、下一 `turn_start` 的首条消息 | `S2_TRANSCRIPT= ["user:go","assistant:[alpha]","toolResult:alpha","user:STEER-MSG","assistant:[]收到纠偏后的回答"]` | ✅可用（语义 = **排队插话**，不是中断） |
| Follow-up 真排队等收尾 | 落在自然收尾之后 | `S3_TRANSCRIPT= [...,"assistant:[]第一轮结论","user:FOLLOWUP-MSG","assistant:[]跟进后的结论"]` | ✅可用 |
| Steer 优先于 Follow-up | 队列排空顺序：全部 steer → 全部 followUp | `S4[one-at-a-time]_TRANSCRIPT= [...,"user:S1",…,"user:S2",…,"user:F1",…,"user:F2",…]` | ✅可用 |
| `one-at-a-time` vs `all` | one-at-a-time：4 条排队 = **4 次额外 LLM 轮**；all：合并成 2 轮 | `S4[one-at-a-time]` 5 个 assistant 轮 vs `S4[all]_TRANSCRIPT= [...,"user:S1","user:S2","assistant:t2","user:F1","user:F2","assistant:t3"]` | ✅可用（成本差 2×） |
| `prompt()` 前 steer | 立刻注入，紧跟 prompt 消息进第一轮 | `S5_TRANSCRIPT= ["user:正式提问","user:PRE-STEER","assistant:[]回答"]` | ✅可用 |
| run 中重复 `prompt()` | 明确抛错 | `S6_second_prompt= threw: Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.` | ✅可用 |
| **真中断只能靠 `abort()`** | abort 在工具 start 时 → 该工具**一次都没跑** | `S7_TOOL_RAN= []`<br>`S7_TRANSCRIPT= ["user:go","assistant:[alpha\|beta\|gamma]","toolResult:alpha","assistant:[]"]`（3 个 toolCall 只有 1 个 toolResult）<br>`S7_errorMessage= Request was aborted` | ⚠有限制（**代价见 §1.5 transcript 残缺**） |

### 1.4 有界终止的完整可能性（穷举）

`AgentLoopConfig` **有** `shouldStopAfterTurn`（`types.ts:217`，`agent-loop.ts:248` 真调用），但 `AgentOptions`（`agent.ts:97-121`）**不含此字段**，`createLoopConfig()`（`agent.ts:434-469`）**不透传**。

| 收口路径 | 能停吗 | 证据 | 代价 |
|---|---|---|---|
| `Agent` 构造参数 `shouldStopAfterTurn` | **❌ 完全不被调用** | `npx vitest run test/zz-a2-terminate.test.ts --silent=false`<br>`T1_shouldStopAfterTurn_called= 0 toolRuns= 20`（20 轮全跑） | — |
| `prepareNextTurn` / `prepareNextTurnWithContext` **返回值** | **❌ 不能停** | `T2_calls= 5 ctxKeys={ context,message,newMessages,toolResults }`<br>返回类型 `AgentLoopTurnUpdate` 只有 `{context?, model?, thinkingLevel?}`，**无 stop 字段** | 讽刺点：**判据全给你了（跟 `shouldStopAfterTurn` 的 context 一模一样），就是不给你表达「停」的字段** |
| `prepareNextTurn` 里调 `agent.abort()` | **✅ 能停** | `T3_turns= 3 toolRuns= 3 (不设上限应为 20)`<br>`T3_last6_events= ["turn_end","turn_start","message_start","message_end","turn_end","agent_end"]`<br>`T3_TRANSCRIPT_tail= [..., "assistant:aborted:Request was aborted"]` | 多一个**空的 aborted 假回合**；`state.errorMessage="Request was aborted"` → **策略停机与用户取消、网络中断三者不可区分** |
| `turn_end` 监听器里调 `agent.abort()` | **✅ 能停** | `T4_turns= 4 toolRuns= 3`<br>`T4_TRANSCRIPT_tail= ["toolResult:undefined:","assistant:aborted:Request was aborted"]` | 同上 |
| ⭐ **`afterToolCall` 返回 `{terminate:true}`** | **✅ 能停，且干净** | `T5_afterToolCall_calls= 3 toolRuns= 3 (不设上限应为 20)`<br>`T5_last5_events= ["tool_execution_end","message_start","message_end","turn_end","agent_end"]`<br>`T5_state.errorMessage= undefined` | **零额外 LLM 调用、零 aborted 脏消息、errorMessage 干净**。**这是裸 `Agent` 上唯一的原生优雅早停**——主控此前未列 |
| terminate 粒度 | 必须**整批每个**都 terminate | `T6_toolRuns= 6 (只有 beta terminate=true)`<br>`T6_VERDICT_partial_terminate_stops= false`（`agent-loop.ts:583 every()`） | 无脑 `return {terminate:true}` 即可，不难 |
| terminate 遇上排队的 steer | **steer 赢，terminate 失效** | `T7_toolRuns= 2`<br>`T7_TRANSCRIPT= ["user:go","assistant","toolResult","user:STEER","assistant","toolResult"]` | 必须配 `clearAllQueues()`（见 §1.6 RC3 复现） |
| 底层 `runAgentLoop` 直接用 + `shouldStopAfterTurn` | **✅ 完美工作** | `T8 turn1..turn3` 逐轮打印<br>`T8_turns= 3 toolRuns= 3 (不设上限应为 20)`<br>`T8_returned_messages_roles= ["user","assistant","toolResult","assistant","toolResult","assistant","toolResult"]`<br>`T8_last_event= agent_end` | 放弃 `Agent` 类：要自己写 `convertToLlm`、自己维护 transcript/`isStreaming`/`pendingToolCalls`、自己接 steer/followUp 队列、自己造失败消息。**代价 ≈ 重写 `agent.ts` 那 120 行**（可直接抄，MIT） |
| `transformContext` 抛错 | **✅ 能停**，且**唯一能携带自定义停因的路径** | `T9_transformContext_calls= 3 toolRuns= 2`<br>`T9_prompt_outcome= resolved`<br>`T9_state.errorMessage= BUDGET_EXCEEDED`<br>`T9_TRANSCRIPT_tail= ["toolResult::","assistant:error:BUDGET_EXCEEDED"]` | 违反文档契约（"must not throw"）；transcript 留一条 `stopReason:"error"` 假消息 |
| `beforeToolCall` `{block:true}` | **❌ 拦工具不拦循环**（复验主控结论，成立） | `T10_toolExecuted= 0 toolResults= 6`（6 轮全跑）<br>`T10_blocked_result= {"isError":true,"text":"越权：该工具需人工审批"}` | 只是把错误喂回模型，模型可无限重试 |

### 1.5 `abort()` 之后的状态（degrade 能否安放）

| 能力 | 实测结果 | 证据 | 判定 |
|---|---|---|---|
| **并行批中途 abort → transcript 残缺** | 3 个 toolCall 只回了 2 个 toolResult，**c3 悬空** | `npx vitest run test/zz-a2-abort-errors.test.ts --silent=false`<br>`A1_TRANSCRIPT= ["user","assistant[TC:c1\|TC:c2\|TC:c3]:toolUse","toolResult(c1):false:ok-alpha-...","toolResult(c2):true:Operation aborted","assistant[]:aborted"]`<br>`A1_AUDIT= {"calls":["c1","c2","c3"],"results":["c1","c2"],"dangling":["c3"],"orphan":[],"valid":false}`<br>`A1_VERDICT_transcript_valid_for_real_provider= false` | ❌不可用（Anthropic/OpenAI 均要求每个 tool_use 配对 tool_result → **该 transcript 送真 provider 会 400**） |
| 残缺与否**取决于 abort 落点** | 同样 abort，落在第 3 个（最后一个）时 transcript 反而合法 | `A3_audit= {"calls":["c1","c2","c3"],"results":["c1","c2","c3"],"dangling":[],"orphan":[],"valid":true}` | ❌不可用（**不确定性**：同一段代码时快时慢就决定了历史合不合法） |
| abort 后 `continue()` | **抛错，续不了** | `A3_continue= threw: Cannot continue from message role: assistant` | ⚠有限制（只能 `prompt()` 追加新 user 消息） |
| 流式中途 abort 保不保住部分文本 | **保住**，800 字保下 52 字 | `npx vitest run test/zz-a2-abort2.test.ts --silent=false`<br>`A2b_total_chars= 800 deltas_seen= 3 len_at_abort= 52`<br>`A2b_last_msg= {"role":"assistant","stopReason":"aborted","errorMessage":"Request was aborted","textLen":52}` | ✅可用（**degrade 有真素材**） |
| 半截文本永久留在上下文 | 下一轮把 48 字的断句 assistant 消息一起发回模型 | `A2c_TRANSCRIPT= ["user::len=2","assistant:aborted:len=48","user::len=3","assistant:stop:len=5"]` | ⚠有限制（无任何修复/清洗机制） |
| **abort 后拿不到「哪些工具被中断」** | 事件里能拿到，run 结束就被清空 | `A4_pendingToolCalls_AT_abort= ["c1","c2","c3"]`<br>`A4_pendingToolCalls_AFTER= []`（`agent.ts:517 finishRun()`） | ⚠有限制（**degrade 必须在事件流里自己快照**，事后问 state 什么都没有） |
| 每轮 token 用量可取 | assistant 消息带 `usage` | `A4_assistant_usage_totalTokens= [125,155]` | ✅可用 |

### 1.6 错误与重试

| 能力 | 实测结果 | 证据 | 判定 |
|---|---|---|---|
| 工具抛错怎么回给模型 | **原始 `Error.message` 原样进 transcript**；`details` 被清空成 `{}` | `R1_results= [{"name":"throwErr","isError":true,"text":"数据库连接失败 password=hunter2","details":{}},{"name":"throwStr","isError":true,"text":"裸字符串错误","details":{}},{"name":"throwObj","isError":true,"text":"[object Object]","details":{}}]` | ❌不可用（**密钥/连接串直通模型上下文，零脱敏**；抛对象则信息全丢成 `[object Object]`） |
| 未注册工具 / schema 违规 | 都变成 `isError` 工具结果，循环继续；**校验错误把原始入参回显给模型** | `R2_results= [{"name":"不存在的工具","isError":true,"text":"Tool 不存在的工具 not found"},{"name":"alpha","isError":true,"text":"Validation failed for tool \"alpha\":\n  - n: must be number\n\nReceived arguments:\n{\n  \"n\": \"字符串而非数字\"\n}"}]`<br>`R2_toolActuallyRan= 0` | ⚠有限制（入参回显 = 第二个泄漏面） |
| provider 5xx | **循环立即收尾，零重试** | `R3_TRANSCRIPT= ["user::","assistant:toolUse:","toolResult::","assistant:error:503 service unavailable (overloaded)"]`<br>`R3_VERDICT_auto_retried= false`（预置的第 3 个响应从未被消费）<br>`R3_events_tail= [...,"message_end","turn_end","agent_end"]` | ✅可用（行为明确：**`packages/agent` 这层根本不重试**） |
| 重试在哪一层 | ①`ai/src/utils/provider-retry.ts` = SDK 级 HTTP 重试（408/409/429/5xx，读 `retry-after`，`maxRetryDelayMs` 默认 60s 可配）；②`ai/src/utils/retry.ts::retryAssistantCall` = 回合级重试策略（`{enabled,maxRetries,baseDelayMs}`，指数退避），**在 `packages/agent` 里只被 compaction 用**；③TUI 那句 `Retrying (2/3) in 2s` 出自 `coding-agent/src/modes/interactive/components/status-indicator.ts:47`，由 `coding-agent/src/core/agent-session.ts` 驱动 | `grep -rn "retryAssistantCall" pi2/packages/*/src/` → 只有 `agent/src/harness/compaction/compaction.ts:132` 和 `coding-agent/src/core/compaction/compaction.ts:580`<br>`grep -rn "Retrying" pi2/packages/*/src/` → 只有 status-indicator.ts:47 | ⚠有限制（`Agent` 层无重试；**重试能力在 harness/coding-agent 层，取 `Agent` 就不带重试**）<br>*重试分类器本身质量很高*（`retry.ts` 的可重试/不可重试正则覆盖 40+ 种真实故障文本，含 quota/billing 不重试的正确判断）**[部分仅静态]** |
| 钩子自己抛错 | 被沙箱化成错误工具结果，run 存活 | `R4[before]_result= {"isError":true,"text":"HOOK_BEFORE_BOOM"}` / `R4[before]_run_survived= true`<br>`R4[after]_result= {"isError":true,"text":"HOOK_AFTER_BOOM"}` / `R4[after]_run_survived= true` | ✅可用（**但与 `subscribe` 监听器抛错炸掉整个 run 形成刺眼的不对称**） |

### 1.7 接缝驱动验证：在裸 `Agent` 上真装出「有界终止 + 诚实降级」

不验「API 存在」，验「按我方治理要求跑一遍能不能落地」（`test/zz-a2-recipe.test.ts`）。

| 场景 | 结果 | 证据 |
|---|---|---|
| **terminate 路径**（工具次数上界） | ✅ 干净：卡在 3 次、transcript 合法、无脏错误、degrade 素材齐全 | `RC1_toolRuns= 3 (上界 3)` / `RC1_stopReason= MAX_TOOL_CALLS`<br>`RC1_state.errorMessage= undefined`<br>`RC1_transcriptValid= true dangling= []`<br>`RC1_degrade= {"header":"[有界终止·MAX_TOOL_CALLS] 未能完全解答，以下为已探索到的线索：","findings":["alpha: ok-alpha-{\"n\":0}","alpha: ok-alpha-{\"n\":1}","alpha: ok-alpha-{\"n\":2}"],"lastText":"第2步思考","prov":["c0","c1","c2"]}` |
| **abort 路径**（轮次上界） | ⚠ 能停但脏：多一条 `assistant:aborted` | `RC2_toolRuns= 3` / `RC2_stopReason= MAX_TURNS`<br>`RC2_state.errorMessage= Request was aborted`<br>`RC2_roles= [...,"toolResult:","assistant:aborted"]` |
| **坑复现**：忘了 `clearAllQueues()` | ❌ terminate 被排队的 followUp 越过 | `RC3_toolRuns= 3 (期望 2，若 >2 说明 followUp 越过了 terminate)`<br>`RC3_roles= ["user","assistant","toolResult","assistant","toolResult","user","assistant","toolResult"]` |

**结论：可以装出来，但必须 `afterToolCall{terminate}` + `clearAllQueues()` + 事件流里自己快照 pendingToolCalls 三件套齐上，且轮次上界只能退而用 abort（脏）。**

---

## 二、我方对照

只读测绘：`vfy-rescat/apps/agentcore/src/agent/loop.ts`（1147 行）、`tools/budget.ts`（107 行）、`tools/executor.ts`（707 行）。**[本节为静态测绘，未跑我方服务]**

| pi 的能力 | 我方是否有 | 我方实现位置/证据 | 谁强 |
|---|---|---|---|
| 循环迭代上界 | **有，且 8 维** | `tools/budget.ts:8 BudgetTracker`；`contracts/src/qos.ts:616 DEFAULT_AGENT_BUDGET = {maxIterations:24, maxToolCalls:40, maxSolverCalls:8, maxDurationMs:600_000, maxClarifications:0, maxDiscoverCalls:8, maxRoundTrips:24}` + `perToolCallCap` | **我方碾压**（pi 裸 `Agent` 0 维） |
| 早停条件 | **有，多路**：`loop.ts:734-739` 每轮开头 4 道守卫（`isCancelled` / `durationExceeded` / `budget.exhausted` / `roundTripsExceeded`）+ `loopRepeatCap` 环检测（`callSignature`=工具名+稳定序列化入参）+ `consecutiveToolFailures`/`roundsWithoutSuccess` 停滞检测 | `loop.ts:734 if (opts.isCancelled?.()) return await degrade("FAILED");` … `loop.ts:973-978` | **我方碾压** |
| 诚实降级出口 | **有，且是唯一出口**：`loop.ts:452 degrade()` — 诚实前缀 + `synthesizePartialFindings()`（不造数）+ `scanBlocks` 未验证数字护栏 + provenance 只列 OK 工具的 toolCallId + metrics 归因 | `loop.ts:446-505`；`degraded:{reason:"TIMEOUT"\|"BUDGET_EXHAUSTED"\|"STALL_LOOP"}` | **我方碾压**（pi 零 degrade 概念） |
| 停因可判别 | **有**：`degraded.reason` 三值 + `budget.exhaustedReason` 记首因 + `stalled.reason` 两值 | `budget.ts:51 markExhausted()`；`loop.ts:164/172` | **我方碾压**（pi 的 abort 把策略停机/用户取消/网络错全塞进 `"Request was aborted"`） |
| 并行/串行工具执行 | **有，且按副作用自动判定**：全 READ 轮并行（并发≤4），含 COMPUTE/ACTION_DRAFT/EXTERNAL 即**整轮串行** | `loop.ts:1013 const allRead = toolUses.every((b) => sideEffectOf(b.name) === "READ");` `loop.ts:1019 mapLimit(toolUses, PARALLEL_READ_CONCURRENCY=4, ...)` | **我方强**（pi 要人工给每个工具标 `executionMode`；我方从工具声明的 sideEffect 自动推） |
| 并行下的确定性 | **有**：dispatch 前按 tool_use 顺序统一扣预算 | `loop.ts:1015-1018` 注释「预算确定性：dispatch 前按 tool_use 顺序统一计数」 | **我方强**（pi 并行时预算无概念） |
| 工具执行前置闸 | **有，且是真闸**：`GuardedToolExecutor` — scope 门（`AGENT_SCOPE_VIOLATION`）、objectType 门、OBO token 过期门、权限判定（`PERMISSION_DENIED`）、本体 schema 出参校验（`ONTOLOGY_VALIDATION_FAILED`）、`withTimeout` | `tools/executor.ts:91,137,148,159,178,235` | **我方碾压**（pi 的 `beforeToolCall` 拦得住工具但拦不住循环，模型可无限重试） |
| 工具重试 | **有，在循环内**：`retryable` 回执 → 有界重试，退避复用同一 per-call deadline；重试成功不入停滞计数 | `loop.ts:668-671`；`executor.ts:632 classifyRetryable()` | **我方强**（pi 的 `Agent` 层零重试，重试在 harness/coding-agent 上一层） |
| per-call 超时 | **有**：`deadline = min(llmCallTimeoutMs, budget 剩余)` | `loop.ts:663-664` | **我方强**（pi 无 per-call 超时概念，只有 provider SDK 的 HTTP 超时） |
| 事件系统 | **有但极窄**：只有 `step.started` / `step.completed`（§8.2 事件名受契约约束），旁白/升级/降级全部走 `step.completed` 伪 step（`type=agent_narration` / `agent_escalated` / `agent_degraded`） | `loop.ts:672,676,520,848` — 全文件仅 4 处 `opts.emit()` | **pi 强**（10 个事件 + token 级 `text_delta`；我方无 token 流、无 turn 边界事件、无工具 partial 更新） |
| 流式 token 旁白 | **无**。`emitNarration` 是**整段** thought 一次性发（`text: narration.slice(0,600)`），不是增量 | `loop.ts:845-848` | **pi 强** |
| Steer（执行中插话） | **无**。只有 `isCancelled?.()` 布尔取消 | `loop.ts:67, 734` | **pi 强**（但 pi 的 steer 也不中断工具，见 §1.3） |
| Follow-up 队列 | **无** | — | **pi 强** |
| 反思 / 重规划 | **有**：`reflect` 确定性复盘 + 可选 LLM critic（fail-open）+ `replanBudget` 硬有界重规划 | `loop.ts:307 reflectWithCritic`, `loop.ts:886` | **我方碾压**（pi 无） |
| Escalation Ladder | **有**：停滞时先换提示策略再试一轮，仍停滞才 degrade | `loop.ts:508-530`, `loop.ts:998` | **我方碾压**（pi 无） |
| 多租户 / 溯源 | **有**：`tenantId` 贯穿、`ProvenanceRef` 只列 OK 工具、`unverifiedNumerics` 护栏 | `loop.ts:481-492`, `tools/provenance.ts` | **我方碾压**（pi 无租户概念） |

---

## 三、我方没有、pi 有的 —— 逐条判价值

| 能力 | 对我们的价值 | 理由（结合多租户/审批/溯源/确定性约束） | 建议 |
|---|---|---|---|
| **token 级流式事件**（`message_update` + `text_delta`，中文分片实测无乱码） | **高** | 我方 `emitNarration` 只能整段发，用户看到的是「卡住 → 突然一整段」。pi 的 `text_delta` 能做真流式旁白。但**不需要取 pi 的代码**：我方 LLM 适配层本来就有流，缺的是把 delta 透到 SSE。约定上要占用 §8.2 事件名或复用 `step.completed` 伪 step | **值得学不取代码** |
| **`turn_end` 事件带完整 `{message, toolResults}`** | **高** | 这是做 Loop Control 的天然挂载点，比我方在循环体里散落判断更可测。我方现在的早停判断嵌在 `loop.ts` 主体里，加一个维度就要改主循环 | **值得学不取代码**（把我方早停判据抽成 `onTurnEnd(ctx)` 纯函数，可单测） |
| **`afterToolCall{terminate:true}` 干净早停** | 中 | 一个「工具结果自己说该停了」的优雅出口，我方目前只有 budget/停滞两类外部判据，没有「工具自身宣告终态」这一类。例：solver 返回 INFEASIBLE 时本该立刻收尾，现在还要再转一轮 | **值得学不取代码** |
| **单工具 `executionMode:"sequential"` 毒化整批** | 低 | 我方按 sideEffect 自动推，比手工标注更不易漏。pi 这个是弱化版 | **不要** |
| **Steer / Follow-up 队列** | 中 | 「用户在 agent 跑的时候补一句」是真需求，我方现在只能取消重来。但 **pi 的 steer 语义对我们是危险的**：它不中断工具，用户以为纠偏成功、实际副作用已落地。我方要做必须是「steer = 立即停在下一个工具边界」，与 pi 语义不同 | **值得学不取代码**（学 API 形状，不学语义） |
| `steeringMode/followUpMode: "all"` 合并注入 | 低 | 省 LLM 轮次的小优化 | **观望** |
| `subscribe()` 干净的退订语义 | 低 | 我方 `emit` 是单回调，够用 | **不要** |
| pi 的重试分类器（`ai/src/utils/retry.ts` 的 40+ 故障文本正则 + quota/billing 不重试） | **高** | 我方 `classifyRetryable` 覆盖面未测绘全，pi 这份是从真实 issue（#2264/#733/#3317/#4433/#3594/#6019）长出来的。**只抄正则表，不抄框架** | **立即取**（抄常量表，MIT 许可） |
| 整个 `Agent` 类作为我方循环的替代 | **负值** | 见 §四 | **不要** |

---

## 四、致命限制（若我们基于 pi 开发会踩的坑）

1. **`Agent` 类无任何有界终止，且刻意不给。** `AgentLoopConfig` 有 `shouldStopAfterTurn`，`AgentOptions` 偏偏不透传（`agent.ts:97-121` vs `types.ts:217`），而 `prepareNextTurn` 把**一模一样的判据 context** 递给你却不给 `stop` 字段（`T2_calls= 5 ctxKeys={context,message,newMessages,toolResults}`）。这不是疏漏，是**取舍**——pi 把有界性推给上层 harness。我们若用裸 `Agent`，必须自己补，且只有 `terminate`（干净）和 `abort`（脏）两条路。

2. **`abort()` 会造出送不进真 provider 的 transcript，且是否造取决于时序。** `A1_AUDIT= {"calls":["c1","c2","c3"],"results":["c1","c2"],"dangling":["c3"],"valid":false}`，而同样代码 abort 落在最后一个工具时 `valid:true`。**我方 R6 确定性铁律直接被违反**——同一输入不同机器负载会产出结构不同的历史。`agent-loop.ts:516/535` 的 `if (signal?.aborted) break;` 是根因：跳出前不补齐 tool_result。

3. **策略停机与故障不可区分。** abort 路径一律 `state.errorMessage = "Request was aborted"`（`T3/T4/RC2` 均如此）。我方 `degraded.reason` 的三值语义（TIMEOUT/BUDGET_EXHAUSTED/STALL_LOOP）在 pi 里没有容器，只能自己在外面另存一份，且**要保证外部变量与 pi 内部状态不漂移**。

4. **观测者能杀死被观测者。** `subscribe` 监听器抛错 → 工具不执行、run 变成 error 轮、`prompt()` 却 **resolved 不 reject**（`E4_prompt_outcome= resolved`，`E4_state.messages.roles= ["user","assistant","assistant"]` 无 toolResult）。我们要挂流式旁白 + Loop Control 两个监听器，任何一个偶发抛错（比如 SSE 断连）就静默毁掉整次深问。而 `beforeToolCall`/`afterToolCall` 抛错却被沙箱化（`R4` 两条均 `run_survived= true`）——**同一框架内两套错误哲学**。

5. **事件载荷是活对象，旁观者可篡改历史。** `E5_same_object= true`，改事件 payload 后 `E5_after_tamper_state_text= "TAMPERED"`。我方溯源（provenance/审计）建立在「历史不可变」上，这条直接冲突。

6. **工具异常原文直通模型上下文，零脱敏。** `R1: "数据库连接失败 password=hunter2"` 原样进 transcript；schema 校验失败还会**把原始入参回显**（`R2`）。我方 no-secrets-echo 铁律（凭据只回 credentialRef）在 pi 的默认错误路径上直接失守。

7. **`toolExecution` 非法值静默退化为并行。** `P3: toolExecution:"serial"` → `enters=[50,50,50]`，全并行零告警。配置驱动（我方习惯把这类开关放 env/config）时 TS 保护失效。我方工具有真副作用（ACTION_DRAFT / EXTERNAL），这是治理红线。

8. **串行 ≠ 事务。** `P6`：串行模式下第 1 个工具抛错，第 2、3 个照样执行到底。想要「上一步失败就别做下一步」必须自己在 `beforeToolCall` 里查前序结果——而 `beforeToolCall` 的 context 里**没有本批已完成的结果**（`BeforeToolCallContext` 只有 `assistantMessage/toolCall/args/context`）。

9. **Steer 是「排队插话」不是「中断」。** `S1`：用户喊「停下，别改数据」时，3 个工具全跑完了才收到。若照搬这个语义做人机纠偏，会给用户一个**虚假的控制感**。

10. **`Agent` 层零重试。** provider 5xx 直接收尾（`R3_VERDICT_auto_retried= false`）。重试能力在 `coding-agent/core/agent-session.ts` 上一层——**取 `Agent` 不带重试，取 harness 又进 A3 那套完全不同的机制**。

---

## 五、越界线索（边界外发现，交主控）

1. **【给 A3】重试与 Loop Control 都在 harness 层，不在 `Agent` 层。** `packages/agent/src/harness/types.ts` 有 `retry_scheduled` / `retry_attempt_start` / `retry_finished` / `before_agent_start` / `before_provider_request` / `tool_call` / `tool_result` / `queue_update` / `abort` / `settled` 等**完全另一套**扩展事件（`grep -n 'type: "' harness/types.ts`）。**「pi 的 Agent 没有 X」和「pi 没有 X」是两回事**，请 A3 交叉核对 harness 是否补了 `shouldStopAfterTurn`。

2. **【给主控】`ai/src/utils/retry.ts` 值得单独立项。** 40+ 条真实故障文本正则 + quota/billing 明确不重试的分类器（`NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN` / `RETRYABLE_PROVIDER_ERROR_PATTERN`），是 pi 全仓**最可直接抄用**的资产，与框架选型无关。MIT。

3. **【给主控】`ai/src/utils/provider-retry.ts` 的 `maxRetryDelayMs` 语义反直觉**：服务端要求的延迟**超过**上限时不是截断，而是**抛错**（`validateServerRetryDelayMs` → `throw new Error("Server requested Ns retry delay (max: Ms)")`），再由外层重试策略处理。我方若接需注意。

4. **【给主控/A1】`Agent` 与 `AgentHarness` 的能力差不是「多与少」而是「两套」。** 本单证实 `Agent` 类在 `packages/agent/src/agent.ts` 里对 `harness/` 零引用（`createLoopConfig` 只组装 `AgentLoopConfig`）。主控此前的「两套并行 agent 栈」结论在循环内核这一层**再次成立**。

---

## 六、我没能验证的（诚实列出，别装作验过）

1. **真 provider 下的 abort 行为**。dangling tool_result 会被 Anthropic/OpenAI 400 拒，这是我依据两家 API 约束的**推断**，未真发请求验证。我只证到 pi 自己产出的 transcript 结构不配对（`A1_AUDIT.valid=false`）。faux provider 不校验，所以 `A2c` 里"再 prompt 成功"不能推广。
2. **真 provider 下 abort 的 token 计费**。`T3/T4` 的 abort 路径多一个空回合，用 faux 无法判断这一轮是否真发出 HTTP 请求、是否计费。
3. **`maxRetryDelayMs` / provider-retry 的实际行为**。只读了源码（`[仅静态]`），未构造 429/5xx + `retry-after` 头的真实场景。
4. **我方 AgentCore 的对照全部是静态测绘**。§二 未跑 `http://127.0.0.1:4202`，未验证 `loopRepeatCap`/`perToolCallCap`/`escalation` 这些 opt-in 开关在生产配置下是否真的开着——注释显示它们**缺省全是禁用**（`opt-in·缺省 undefined=不限=现行为字节兼容`），所以「我方碾压」的前提是这些开关真被注入了。**这条值得主控单独派人验：治理能力写了但默认关 = §2「三种没有」里的第 4 种。**
5. **`transformContext` 抛错停机**在真 provider 下是否同样产出 `stopReason:"error"`（faux 下是）。
6. **并发监听器 + 并行工具的竞态**。我的监听器都是轻量的；真实场景下慢监听器 × 并行工具批的交互（`E4` 证明监听器是串行 await 的，会拖慢循环）未做压力验证。
7. **`prepareNextTurn` 返回替换 `context` 的实际效果**（做预算驱动裁剪的正路）——我只验了「返回 undefined 时它被调用几次、载荷是什么」，没验「真替换一个裁剪过的 context 后模型收到什么」。
