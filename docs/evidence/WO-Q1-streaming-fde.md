# FDE 证据：WO-Q1 QOS Path B 流式反馈（增量1 + 增量2·真 Kimi 实跑）

> 环境：datacore :4001（SEED_DEMO=1·KIMI_API_KEY operator 提供·env 不入 git·R5）+ agentcore :4002。
> LLM=Kimi(Moonshot) kimi-k2.6（openai_compatible·真打）。

## 根因（审核方走查 §1）
Path B 自由问句：① 分类期 ~30s 纯静默（`task.accepted→routing.completed` 间无帧）；② 终答无 token 级流式；
③ `reasoning_content`（Kimi 推理思考）被丢弃（adapter `agent()` 非流式·只读 content）。

## 增量1（分类期首进度帧·已交付 3fe2d10）
orchestrator 在 classify 调用前后发 `step.started/step.completed{stepId:classify}`（复用既有 SSE 事件集·
前端 selectStepRows 直接渲染思考态·不改 Path A）→ 首进度帧 accept 后毫秒级出。门 `qos-a.test.ts` WO-Q1。

## 增量2（终答增量流式 + reasoning 捕获·本次）
- **adapter**（`packages/llm-adapters/src/openai.ts`）：`agent()` 在调用方给 `onDelta` 时走 `stream:true`，
  逐 chunk 累计 content/`reasoning_content`/tool_calls，每段经 onDelta 回吐；`reasoningText` 入响应。
  兜底：返回非异步迭代器（桩/不支持流式网关）→ 退回单次补全处理（不崩·不重复调用）。
- **loop**（`agent/loop.ts`）：agent() 调用传 `onDelta: (c) => emit("answer.delta", c)`（复用既有 emit→SSE）。
- **SSE/前端**：契约 StreamEvent += `answer.delta`；reducer 累计 `streamingText`(text)/`reasoningText`(reasoning)；
  useTaskStream KNOWN_EVENTS += answer.delta。

### 真跑（真 Kimi·真 HTTP SSE /b/v1/queries/:id/events）
Path B 自由问句「用一句话介绍这个平台能帮制造业做什么。」(pkg_battery_manufacturing·view dash)：
```
event 序列：task.accepted → step.started/step.completed{classify}(增量1) → routing.completed
            → 475 × answer.delta → answer.final
answer.delta 帧 = 475：422 reasoning 增量（Kimi 思考·此前被丢）+ 53 text 增量（终答 token 级）
  reasoning 样例：{"reasoning":"用户"} {"reasoning":"要求"} {"reasoning":"用"} {"reasoning":"一句话"} …
answer.final：{"trustLevel":"AGENT_EXPLORATORY","blocks":[{"type":"text","markdown":
  "这是一个面向制造业的运营决策平台，通过将工厂、产线、订单等业务对象进行本体化建模，提供数据透明洞察、
   规则校验、产能推演与沙盘模拟等确定性计算能力，帮助企业实现生产运营的可视、可算、可决策。"}], …}
```
判据全过：分类期有首进度帧(非静默)✓ · 终答 token 级增量流式(475 帧·非一次到位)✓ · reasoning_content
不再丢(422 思考增量实时可见)✓ · 不改 Path A(工作流不走 agent 循环·无 answer.delta)✓ · answer.final
仍交付结构化答案✓。

### 门（单测）
- `packages/llm-adapters/src/openai.test.ts`：流式 onDelta 逐 token 回吐 content+reasoning、reasoningText、
  tool_calls 跨 chunk 重组、stopReason/usage；无 onDelta→非流式(向后兼容)。
- `apps/frontend-shell/test/taskStreamReducer.test.ts`：answer.delta 增量累计 streamingText/reasoningText。
- `apps/agentcore/test/qos-a.test.ts`：增量1 classify 首帧。
- 回归：agentcore 全绿（loop 始终传 onDelta·mock/非流式桩经 adapter 兜底退回单次·llm-providers.test 6/6）。

## 距北极星 / 诚实标注
- ✅ 真做到：真 Kimi 下终答 token 级增量流式 + 推理思考实时可见（SSE 层 475 帧实证）；adapter 流式 +
  reasoning 捕获 + 兜底非流式网关。
- 📏 前端可视渲染：reducer 累计已单测；QueryDock 把 streamingText/reasoningText 渲成"实时预览/思考中"
  的 UI 组件 + 真浏览器实拍**未做**（reducer 已就绪·属前端展示层增量）。
- 📏 开放式深问句预算/收敛调优（Kimi 慢→复杂问句易 BUDGET_EXCEEDED）属 WO-Q1 §3 方向③·另列（本次未动）。
- ⚠️ answer.delta 每 token 一帧落 events 仓（475 帧/任务）；高频可加批量/节流（生产优化·本次未做）。
