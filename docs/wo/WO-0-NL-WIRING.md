# WO-0-NL-WIRING · 分类器接 LLM + 确定性兜底（急救·最高优先）

> 一句话：让绑定的 LLM 真正驱动意图分类器——这是"人机对话能不能用"的命门，不做，绑了 LLM 也"点了没反应"。

## 背景（够上手）
真实实测（Kimi）：问句「4680-NCM 加 20% 六周能不能接？」
- **接了 LLM**：分类器识别 `capacity_feasibility`（置信 1.0）→ path-A 确定性工作流 → COMPLETED 真答案 P50 12.3GWh。
- **没接 LLM**：分类器跑不了 → 落 path-B（要 LLM 的自由 agent）→ INTERNAL_ERROR。

结论：LLM 主要就用在**意图分类+抽槽位**这一步；分类成功后多数问题走确定性 path-A（不再需 LLM）。现在的病根 = 分类器那步没真接上绑定的 LLM。

## 🚦 文件边界（只碰这些）
- `apps/agentcore/src/router/orchestrator.ts`
- `apps/agentcore/src/router/domain-resolver.ts`
- `apps/agentcore/src/llm/providers.ts`
- 对应 test

## 产出
1. **意图理解真接 LLM**：绑定的 provider（scenario package / DataCore binding / tenant / env `QOS_CLASSIFIER_MODEL`）真正驱动 classifier。意图环节可指轻量模型，其余环节用推理档（`QOS_AGENT_MODEL`）。
2. **确定性兜底**：低置信 / 无 LLM 时走 `domainResolve` 正则 fail-safe，**不落 path-B 洪泛报错**（`DETERMINISTIC_PREFERENCE_THRESHOLD=0.6`）。
3. **降级诚实**：真答不了就明说能力边界，不编。

## SEAM 门（头号判据·env-gated 真 LLM）
- 真 LLM 下「4680-NCM 加 20% 六周能不能接」→ classify 命中 `capacity_feasibility` → path-A → **COMPLETED 真答案**。
- **无 LLM 时不 INTERNAL_ERROR**，而是确定性兜底或诚实降级（字节兼容零回归）。

## 验收
- 上面 SEAM 测通过（漏则红）。
- 四包全绿：`pnpm -r build && pnpm -r --workspace-concurrency=1 test`（datacore 勿并发 vitest）。
- 一 WO 一 handoff 分支：`claude/handoff-wo-0-nl-wiring`，不碰正线。

## 参考
`docs/PRD-agent-react-harness.md` §0.2（Kimi 铁证）、§1.5（三级路由）。
