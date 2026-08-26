# PRD · LLM agent 空响应护栏（修 `INTERNAL_ERROR · Cannot read properties of undefined (reading 'usage')`）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-22 · 缺陷修复（防御式护栏，不改业务逻辑）|
| 取代/扩展 | 新建（bug-fix）|
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§5 R6/R7/R8 · §8 G-3）· `apps/agentcore/src/agent/loop.ts:446-474` · `packages/llm-adapters/src/anthropic.ts:129/158/175/194/228` · `packages/llm-adapters/src/openai.ts:208-249`（对照，已带 `?.` 护栏）· `apps/agentcore/src/llm/providers.ts:275 toFallback`（已正确 re-throw）|

> 一句话：经营驾驶舱"推演"（路径 B agent）报 `INTERNAL_ERROR · Cannot read properties of undefined (reading 'usage')`，根因是 **`agent/loop.ts:473` 对 `response.usage` 无判空**——当 agent-用途 LLM 调用返回 `undefined`（多为 `agent` 用途未绑定/key 失效），下一行裸读 `.usage` 即崩。本 PRD 只做**防御式护栏 + 结构化错误信封（R7）**：把"神秘崩溃"变成"可诊断的明确错误"（指明 model/用途），并顺手加固 `anthropic.ts` 同款无护栏点。**不改 LLM/agent 业务逻辑，不配 provider**（那是另一回事，根因侧）。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.D7 编排域）：`LlmClient/LlmProvider`（适配器层）·`QueryTask`（终态错误承载）·`AgentLoop`。
- **触及链路**（§3 / §10.3 `sys.orch.query_to_answer`）：`Client → Query → Intent → (路径B) Agent loop → opts.llm.agent() → response`——在 `response` 未定义时**早失败 + 结构化报错**，不让裸 deref 冒泡成 500。
- **触及事件/数据流**（§4）：无新增事件；QueryTask 终态从"未捕获异常"变为"携带明确错误码/消息"。
- **触及不变量**（§5）：
  - **R7 错误信封统一** `{error:{code,message,requestId}}`——核心：把裸 `TypeError` 收敛为统一信封（`code=LLM_EMPTY_RESPONSE`，message 指明 model/用途）。
  - **R6 确定性**：纯防御逻辑，不引入网络/随机；测试以 mock 返回 `undefined` 复现，断言抛出结构化错误（确定）。
  - **R8 认证**：根因常是 `agent` 用途 provider 未绑定/key 失效——护栏消息**提示去配 LLM 绑定**，但本 PRD 不改鉴权/绑定本身。
- **关闭/影响断点**（§8）：**G-3**（对话坞/QOS 未消费结构化缺口）——本修让"agent 用途不可用"成为**可读错误**，前端对话框可显式提示"推演用途未配置"，而非神秘失败（守"诚实暴露断点"）。
- **门禁**（§7）：`pnpm -r build && test`（新增 mock-undefined 回归）· `ontology:check` · 跨服务冒烟不破。
- **数据闭环合规**：`// 不涉数据闭环`（纯编排层防御，不新增/改动数据/对象/字段/模块）。
- **回写承诺**：若把"LLM 客户端契约：成功必返回带 usage 的合法对象，失败必 throw，禁止返回 undefined"立为约定 → 回写本体 §2.D7 注记（可选）。

## 1. 目标 / 非目标
### 目标
1. **`agent/loop.ts` 早失败护栏**：`opts.llm.agent()` 返回 `undefined`/缺 `usage` → 抛**结构化错误**（含 model + 提示"agent 用途 LLM 未配置或调用失败"），不再裸读 `.usage`。
2. **`anthropic.ts` 同款加固**：5 处 `resp.usage.input_tokens`/`response.usage.input_tokens`（:129/:158/:175/:194/:228）改为判空（缺响应/usage → 明确 throw），与 `openai.ts` 已有的 `resp.usage?.x ?? 0` 风格对齐。
3. **错误冒泡为 R7 信封**：QueryTask 终态/对话框显示 `code=LLM_EMPTY_RESPONSE`（或归一到现有错误码）+ 可读 message，而非 `INTERNAL_ERROR · Cannot read ... 'usage'`。
4. **回归测试**：mock agent 返回 `undefined` → 断言抛结构化错误且 QOS 终态为可读失败（不是未捕获 500）。

### 非目标
- 不改 agent 循环/路由/fallback 业务逻辑（`toFallback:275` 已正确 re-throw，保持）。
- 不配置 LLM provider/绑定（根因侧，单独处理；本 PRD 只让症状可诊断）。
- 不改 `openai.ts`（已带 `?.` 护栏，无需动）。

## 2. 现状与缺口（带 file:line）
| 点 | 现状 | 缺口 |
|---|---|---|
| `agent/loop.ts:473` | `totalInput += response.usage.inputTokens`（`response`= `opts.llm.agent()` :448）| **无判空**：response=undefined → 裸 `TypeError`，冒泡成 `INTERNAL_ERROR` |
| `anthropic.ts:129/158/175/194/228` | `resp.usage.input_tokens` / `response.usage.input_tokens` | **无 `?.` 护栏**：resp 缺响应/usage 同样裸崩 |
| `openai.ts:208-249` | `resp.usage?.prompt_tokens ?? 0` | ✅ 已护栏（对照样板，不动）|
| `providers.ts:275 toFallback` | `if (!fb) throw err` | ✅ 正确 re-throw（非本 bug 来源）|
| 现象 | 数据生成 OK（别的 LLM 用途已绑），推演崩（`agent` 用途未绑/key 失效）| 症状不可读 → 误判为系统 bug |

## 3. 设计（防御式护栏 + 结构化错误，最小改动）
### 3.1 `agent/loop.ts`（:472 前）
```ts
if (!response || !response.usage) {
  throw new LlmEmptyResponseError(
    `agent 用途 LLM 返回空响应（model=${opts.model}）——检查 LLM 用途绑定 'agent' 是否配置且 key 有效`
  );
}
totalInput += response.usage.inputTokens;
```
- `LlmEmptyResponseError`（或复用现有错误类型）→ 由 QOS 错误中间件映射为 R7 信封 `{code:"LLM_EMPTY_RESPONSE", message, requestId}`。
### 3.2 `anthropic.ts`（5 处）
- `const usage = resp?.usage; if (!usage) throw new LlmEmptyResponseError(...)` 后再读 `usage.input_tokens/output_tokens`；或与 openai 对齐用 `?? 0` + 整体响应判空。择一，保持适配器内一致。
### 3.3 错误映射
- 确认 agentcore 错误处理中间件把 `LlmEmptyResponseError`（及未知异常兜底）落 R7 信封，QueryTask 终态 `status=FAILED` 带该 code/message，前端对话框可读。

## 4. 契约 / 端点
- 无端点变更。可在 `contracts` 错误码集合补 `LLM_EMPTY_RESPONSE`（或归并到既有 `LLM_*`）。

## 5. 关键流程
路径B agent loop → `opts.llm.agent()` 返回 undefined → **护栏早抛 LlmEmptyResponseError** → 错误中间件 → R7 信封 → QueryTask FAILED（可读）→ 对话框显示"agent 用途未配置/调用失败"。

## 6. 非功能（§5）
R7（统一信封）· R6（mock-undefined 确定复现）· R2（租户不变）· 不引入网络/随机。

## 7. 验收（DoD）
- mock agent 返回 `undefined` → 单测断言抛 `LlmEmptyResponseError`，QOS 终态 FAILED + 可读 message（不再 `reading 'usage'`）。
- `anthropic.ts` 5 处加固，缺响应/usage 路径有单测覆盖。
- `pnpm -r build && pnpm -r test` 四包全绿（新增护栏回归）；`ontology:check` 过；跨服务冒烟不破。
- 复跑"经营驾驶舱生成数据→推演"：若 agent 用途未配，得到**可读错误**（指向 LLM 绑定），而非 INTERNAL_ERROR 崩溃。
- （根因侧另办）配好 `agent` 用途 Kimi 绑定后，推演正常完成。

## 8. 分期
- **FIX.1** `agent/loop.ts` 护栏 + `LlmEmptyResponseError` + 错误中间件映射 + 单测。
- **FIX.2** `anthropic.ts` 5 处加固 + 单测；contracts 错误码补登。

> 边界：本 PRD 只把**崩溃变可诊断**（症状）。**让推演真正跑通**需另配 `agent` 用途的存活 LLM 绑定（根因，需有效 key），不在本 PRD 范围。
