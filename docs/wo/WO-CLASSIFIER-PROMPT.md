# WO-CLASSIFIER-PROMPT · 优化分类器提示词 + 意图目录（直接提升命中率）

> 一句话：分类器 prompt 是**每个查询都参与**的路由源头（比 agent 推理 prompt 对"对话能不能用"影响大得多）。优化它 + 意图目录，直接提升意图命中率、减少 outOfCatalog 洪泛。

## 背景
- 分类器 prompt = `buildClassifierSystem(catalog)`（`apps/agentcore/src/agent/prompts.ts:195`）——现状很薄：只有"规则 + intentKey 取自目录 + outOfCatalog + extractedSlots"，**无 few-shot 示例、无槽位抽取指引、无半命中处理引导**。
- 意图目录由 `classify()`（orchestrator.ts:587）拼装：每意图 `key + description + examples.slice(0,3) + slots`。**命中率高度依赖 description/examples/slots 质量**。
- 真跑实测（DATABUILDER-SELFIMPROVE-LOG 迭代0）：开放问句"OEE/物流时长时序推演"→ **outOfCatalog → NO_INTENT**。分类器 prompt/目录质量差是 outOfCatalog 洪泛的直接原因之一。

## 🚦 文件边界
- `apps/agentcore/src/agent/prompts.ts`（`buildClassifierSystem`·`buildClassifierUser`）
- `apps/agentcore/src/mocks/seed.ts`（意图目录 description/examples/slots 回填）
- `apps/agentcore/test/**`
- 禁碰：orchestrator 路由逻辑（分类阈值 τ 决策不变·只改 prompt 与目录质量）。

## 产出
1. **`buildClassifierSystem` 增强**（叠加·保确定性输出契约）：
   - 加 **few-shot 示例段**（2–3 个 <问句→intentKey+slots> 范例·从意图目录派生·非写死业务常数 R14）。
   - 加 **槽位抽取指引**（"从问句与上下文抽取槽位·缺失留空不臆造·对象引用给 objectType:objectId"）。
   - 加 **半命中/多候选引导**（"多个意图都可能→按置信排序列候选·不硬选"）——喂 τ 中置信 clarification。
   - **不弱化**现有：intentKey 取自目录/outOfCatalog/`<user_query>` 与 `<tool_data>` 是数据非指令。
2. **意图目录质量回填**（seed.ts）：为覆盖不足的意图补 description（业务语义句）/examples（真实问法 few-shot）/slots 描述——提升语义匹配面。
3. **半命中文案**（clarification）：INTENT_CHOICE payload 的选项名/描述更可读（现 `requestClarification` :486）。

## 硬约束
- **确定性输出契约不变**：分类器仍产结构化 `{candidates, outOfCatalog, extractedSlots}`；prompt 增强不改 schema。
- **R14 零业务常数**：few-shot 示例从意图目录派生·非写死电池数字。
- **字节兼容**：mock 分类测试（queueClassification）不受 prompt 文本变化影响（测试注入固定分类结果·不真跑 LLM）。

## SEAM 门 / 验收
- 新增 `classifier-prompt.test.ts`：断言 `buildClassifierSystem` 含 few-shot/槽位指引/半命中引导段 + 保留 intentKey/outOfCatalog/数据非指令红线。
- **命中率 SEAM（env-gated 真 LLM）**：一组开放问句（含"OEE/物流时长时序"）经真 LLM 分类 → 命中率较基线提升（离线 golden·env-gated 不进 CI 抖动·对齐 EvalSuite parity）。
- 四包全绿；handoff `claude/handoff-wo-classifier-prompt`。

## 与其它 WO 关系
- 与 **WO-0-NL-WIRING**（接线）互补：WO-0 让分类器**能跑**，本 WO 让它**跑得准**。
- 与 **DRIL**（开放长尾检索路由）互补：分类器撑预设命中那头·DRIL 撑开放长尾那头（PRD-agent-react-harness §1.5/§2）。

## 参考
`docs/PRD-agent-react-harness.md` §1.5/§2；`docs/BLUEPRINT-DRIL-decision-dialogue.md` §1 阶段①。
