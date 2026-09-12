# WO-0-NL-WIRING · 分类器接 LLM + 确定性兜底（急救·最高优先）

> 一句话：让绑定的 LLM 真正驱动意图分类器——这是"人机对话能不能用"的命门，不做，绑了 LLM 也"点了没反应"。

## 背景（够上手）
真实实测（Kimi）：问句「4680-NCM 加 20% 六周能不能接？」
- **接了 LLM**：分类器识别 `capacity_feasibility`（置信 1.0）→ path-A 确定性工作流 → COMPLETED 真答案 P50 12.3GWh。
- **没接 LLM**：分类器跑不了 → 落 path-B（要 LLM 的自由 agent）→ INTERNAL_ERROR。

结论：LLM 主要就用在**意图分类+抽槽位**这一步；分类成功后多数问题走确定性 path-A（不再需 LLM）。现在的病根 = 分类器那步没真接上绑定的 LLM。

## 精确崩点定位（审核方已挖·dev 直接下手）
无 LLM 时 INTERNAL_ERROR 的确切链路（`apps/agentcore/src/router/orchestrator.ts`）：
1. `classify()`（:580）无 provider → `llm.classify` 抛错 → 循环重试 3 次全失败（:609-620）→ **返回 `undefined`**（:622）。
2. 主流程 `if (!classification)`（:445）→ 落 `runPathB(taskId, auth, {outOfCatalog:true,...})`（:451）。
3. `runPathB` → `runAgentLoop` 又要 LLM provider → 无 → **INTERNAL_ERROR**。

**拦截点（产出③落地处）**：在 :445 的 `!classification` 分支（及其它落 runPathB 的分支，如 :467/:482）**先探"是否有可用 LLM provider"**——
- **无 provider** → 不进 runPathB/runAgentLoop，直接产**诚实降级答案**（status COMPLETED·文案"当前未接 LLM，无法理解自由问句；请绑定 LLM 或改用场景卡/确定性入口"）；若存在确定性候选（domainResolve/ceo-route 命中）→ 先走确定性 path-A。
- **有 provider**（真开放题）→ 照走 runPathB（字节兼容）。
> 注：`preferDeterministicSolver(domainResolve(...))`（:406）与场景卡 `scenarioIntentKey` 绑定（:357）已是确定性入口——**产出②要修的是让它们真命中**（你实测场景卡绑定仍落 path-B = 绑定意图的槽位没从上下文满足 or 该意图无对口确定性 solver → 未被 :357/:406 拦住）。dev 需查这两处为何没拦下"4680 加 20%"类问句。

## 实现配方（审核方已挖到近乎机械·test-safe·dev 照做即可）

**① 重要发现（改变优先级）**：`roleModel`（providers.ts:409）**已对 explicit provider 做 keyless 探测 + 无凭据回落到租户已绑定 LLM**（`role-model-fallback.test.ts` #4 SEAM 守）。→ **绑定了 Kimi 就该经此回落生效**（Kimi 实测证实 WITH Kimi 能跑）。**产出① wiring 基本已在**——真正要修的是**纯"无任何 LLM"崩**（产出③）+ **绑定意图仍落 path-B**（产出②）。

**② 检测"真无 provider"的干净信号**：`LlmSettings` 私有 `explicitProviderUsable`/`cfgHasCredential`（providers.ts:474-505·查 `ANTHROPIC_API_KEY`/credentialRef/apiKeyEnv·**从不抛**）。加 public `async providerAvailable(tenantId, role, explicit?)` 复用之（先按 roleModel 同序解析 spec 再判凭据）。

**③ 拦截点必须"错误态"不能"预检"（test-safe 关键·踩这里 500 测试红）**：
- 测试用 **working mock LLM**：classify 成功、但**无真凭据**（`providerAvailable=false`）。**预检会误把 500 个 mock 测试降级** → 严禁预检。
- 正解：仅当 classify **真返回 undefined**（orchestrator.ts:445·3 次重试全失败·**mock 场景 classify 成功不会 undefined**）**且** `providerAvailable(agent)=false` → 走诚实降级；否则照旧 runPathB。
- 备选：在 `failTask`（:1549-1574·"推演中断（${code}）"来源）判 code 属"无 provider 类" → 出 **COMPLETED 诚实降级**而非 FAILED（改 :1555 分支）。

**④ 降级答案**（COMPLETED·非 FAILED/INTERNAL_ERROR）：`Answer{trustLevel:"AGENT_EXPLORATORY", provenance:[], blocks:[{type:"text", markdown:"当前未接入可用 LLM，无法对自由问句做开放推理。请在 设置→LLM 绑定提供商，或改用场景卡/确定性入口提问。"}]}`；status=COMPLETED。

**⑤ 产出②（绑定意图落 path-B）另诊**：`roleModel` 回落已处理"已绑定 LLM"；你实测**场景卡绑定仍落 path-B** = `:357`（scenarioIntentKey 绑定要求槽位从上下文满足·没满足则不 bind）或 `:406`（`preferDeterministicSolver(domainResolve(...))` 对"加 20% 六周能不能接"无对口确定性 solver/未命中 `RE_ATP`）。dev 需查 `domain-resolver.ts`/`ceo-route.ts` 对"能不能接/加 X%/交期"的模式覆盖——**扩确定性正则命中 → 无 LLM 也走 path-A**。

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
