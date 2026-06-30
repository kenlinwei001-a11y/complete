# classifier 关思考（per-binding disableThinking + 配置页开关）— FDE 真值证据

> 背景：QOS 分类慢的本质 = 用了思考模型（kimi-k2.6 是 reasoning 模型，分类一次先生成思维链再出结构化结果，10–90s）。
> 用户提供 Moonshot 文档证实 kimi-k2.5/2.6 支持 `"thinking":{"type":"disabled"}` 跳过思维链。本单在**用途绑定矩阵**
> 增加每行「关思考」开关：classifier 这类低延迟任务关思考 → 秒级直出；agent 留思考（工具循环需要推理）。

## 设计决策：per-binding（按用途）而非 per-model（按模型）

- **per-model 不可行**：provider 模型以 modelId 为键，无法让「kimi-k2.6（带思考）」与「kimi-k2.6（关思考）」共存。
- **per-binding 正解**：开关挂在 `LlmPurposeBinding` 上 → 同一模型 kimi-k2.6 可被 classifier 用途关思考、agent 用途留思考。
  根因解（不是把思考模型整体降级），符合「一切以解决根本问题为准绳」。

## 实现链路（contracts → adapter → 路由 → 持久化 → UI）

| 层 | 文件 | 改动 |
|---|---|---|
| 契约 | `packages/contracts/src/llm.ts` | `PurposeBindingSchema += disableThinking?: boolean` |
| 适配器接口 | `packages/llm-adapters/src/types.ts` | `AgentLlmClient.classify` 入参 += `disableThinking?` |
| OpenAI-compat 适配器 | `packages/llm-adapters/src/openai.ts` | `classify/classifyOnce`：`disableThinking` → 注入 `thinking:{type:"disabled"}`（非该系列模型忽略此键无害） |
| B 路由 | `apps/agentcore/src/llm/providers.ts` | 熔断/路由两处 `classify` 入参 += `disableThinking`（spread 透传）；`LlmSettings.roleDisableThinking(tenant,role)` 读 DataCore 绑定 |
| B 编排 | `apps/agentcore/src/router/orchestrator.ts` | `classify()`：`roleModel` 后取 `roleDisableThinking("classifier")` → 传入 `llm.classify({...,disableThinking})` |
| B mock | `apps/agentcore/src/llm/mock.ts` | classify 入参 += `disableThinking`（忽略，测试桩） |
| A 端点 | `apps/datacore/src/llmproviders.ts` | `BindingsPutSchema` item += `disableThinking?`；`putBindings` 持久化、`bindings()` 回读 |
| A 领域 | `apps/datacore/src/domain.ts` | `LlmPurposeBindingRecord += disableThinking?`（JSONB doc 落库，无需 migration） |
| A 种子 | `apps/datacore/src/seed.ts` | demo classifier 绑定默认 `disableThinking:true`（含旧绑定升级回写路径） |
| 前端 | `apps/frontend-shell/src/pages/admin/LlmProvidersPage.tsx` | 用途矩阵每行新增「关思考」勾选框（绑了 provider+model 才可勾） |

## 真值证据 1 · Moonshot 直连 A/B（机制坐实，3 组查询）

同一分类 prompt，`thinking` 默认（ON）vs `thinking:{type:"disabled"}`（OFF），真打 `https://api.moonshot.cn/v1`、model=kimi-k2.6：

| 查询 | thinking ON | thinking DISABLED | reasoning_content |
|---|---|---|---|
| 常州基地这个月的瓶颈工序在哪里？ | **10.08s** | **3.36s** | 561 字符 → **0 字符** |
| 上个季度毛利下滑主要是哪些订单拖的？ | 8.52s | 2.94s | — |
| 洛阳基地未来30天有什么风险？ | 6.65s | 2.98s | — |

- 关思考后 `reasoning_content` 归零（确实跳过了思维链），延迟 ~2.5–3×↓；**两种模式分类结果一致**（bottleneck_matrix conf 0.95）——关思考不损分类质量。

## 真值证据 2 · 端到端真跑（经 B orchestrator → DataCore 绑定 → adapter 注入）

真起 datacore(:4401, SEED_DEMO + KIMI_API_KEY) + agentcore(:4402, SERVICE_TOKEN 直连 A 绑定目录)，同一问句、同一模型、仅切 classifier 绑定的 `disableThinking`：

| classifier 绑定 | `POST /api/v1/queries` → task.classification.latencyMs | model |
|---|---|---|
| `disableThinking=true`（seed 默认） | **3600ms** | `dcp:llmp_…:kimi-k2.6` |
| `disableThinking` 关（PUT 改绑 + 缓存失效后） | **12712ms** | 同一 `kimi-k2.6` |

- 验证了完整接线：seed 种 classifier `disableThinking:true` → A 落库 → `GET /a/v1/llm-bindings` 回读 True（其余用途 None）→ B `roleDisableThinking` 读到 → orchestrator 传入 classify → adapter 注入 `thinking:disabled`。
- **3.5× 提速**（12.7s→3.6s），同时治真实用户 QOS 路由分类阶段静默卡顿。

## 单测 / 门

- `pnpm -r build` 4 包全绿；`pnpm -r test`：contracts 3 · llm-adapters 15 · agentcore 354 · frontend 289 · datacore 789，全绿（新增字段 optional·向后兼容，未破既有）。

## 距北极星还差什么（诚实）

- 本单只让 classifier 默认关思考；**其余用途（agent 等）默认留思考**——运营若要给别的用途关思考，到用途矩阵手动勾。
- 关思考是 Moonshot kimi-k2.5/2.6 专属能力；**非 Moonshot 思考模型**（如别家 reasoning 模型）此键被忽略，不会报错但也不提速——跨厂商统一「关思考」语义留待 PRD。
- E 单（WO-10②）已确认 eval REAL 默认超时 90s 是另一层根因解（防超时饥饿伪影）；本单的关思考让真实分类落到 ~3.6s，两者叠加后 8s 旧默认其实也够用了，但 90s 仍作安全垫保留。
