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

## 真实实测证据（产品负责人·无 LLM 本地跑）
| 问法 | 判给哪条路 | 结果 |
|---|---|---|
| 「4680-NCM 加 20% 六周能不能接」自由问 | AI 智能体路 path-B | ❌ agent 推演中断 INTERNAL_ERROR |
| 同问题 + **场景卡意图绑定** | **还是 path-B** | ❌ 一样失败 |

→ 两条尖锐结论：**(甲)** 连**已绑定意图的场景卡**都落 path-B，说明确定性路由**没吃到绑定/已知意图**——这不只是"缺 LLM"，是路由本身漏了确定性入口；**(乙)** path-B 无 LLM 时是 **INTERNAL_ERROR 崩**，不是诚实降级。

## 产出
1. **意图理解真接 LLM**：绑定的 provider（scenario package / DataCore binding / tenant / env `QOS_CLASSIFIER_MODEL`）真正驱动 classifier。意图环节可指轻量模型，其余环节用推理档（`QOS_AGENT_MODEL`）。
2. **确定性入口吃到已知意图（对应证据甲）**：**场景卡绑定意图 / `domainResolve` 高置信（≥0.6）→ 必走 path-A 确定性，压根不进 path-B**（不需 LLM）。修当前"连绑定意图都落 path-B"的漏。
3. **path-B 无 LLM 诚实降级（对应证据乙）**：真开放题落 path-B 且无 LLM/provider 不可达时 → **诚实降级**（"当前未接 LLM，仅能给确定性结论/明确能力边界"），**绝不 INTERNAL_ERROR 崩**。

## SEAM 门（头号判据）
- **无 LLM**：① 场景卡绑定意图问句 → **path-A** → 出确定性答案（不崩·证据甲修复）；② 纯自由开放问 → path-B **诚实降级文案**（非 INTERNAL_ERROR·证据乙修复）。
- **真 LLM（env-gated）**：「4680-NCM 加 20% 六周能不能接」自由问 → classify 命中 `capacity_feasibility` → path-A → **COMPLETED 真答案**。
- 字节兼容零回归。

## 验收
- 上面 SEAM 测通过（漏则红）。
- 四包全绿：`pnpm -r build && pnpm -r --workspace-concurrency=1 test`（datacore 勿并发 vitest）。
- 一 WO 一 handoff 分支：`claude/handoff-wo-0-nl-wiring`，不碰正线。

## 参考
`docs/PRD-agent-react-harness.md` §0.2（Kimi 铁证）、§1.5（三级路由）。
