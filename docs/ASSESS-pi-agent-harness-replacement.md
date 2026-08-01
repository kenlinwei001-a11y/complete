# 评估：以 `earendil-works/pi` 替换本平台 AgentCore 运行时

> 状态：**评估稿 · 待仓主裁决**
> 依据：pi @ `583f153d`（2026-08-01，v0.83.0）全量 clone 精读 ＋ 本仓 agent 栈完整测绘
> 两侧均由独立 agent 分别取证，本文档为审核方综合。**未标注「推断」者均为源码直接读到。**

---

## 0. 结论先行

**pi 不能替换本平台的 agent 运行时；它能替换其中的一层。**

具体地：
- ✅ **可替换 `llm/*`（LLM 客户端层）** —— pi-ai 是这次评估里唯一无争议的净收益。
- ◐ **可考虑替换 `agent/loop.ts` 的「裸工具循环」内核** —— 但必须把我方全部治理层改写成 pi 的 hook，工程量与风险都在"重写"量级，收益存疑。
- ❌ **不可替换编排层 / 治理层 / 契约层**（`router/*`、`tools/{executor,budget}`、`degrade()`、SSE 契约）—— pi **明确声明不提供**等价物，且不打算提供。

一句话判据：**pi 解决的是"驱动一次本地编码会话"，我们解决的是"在多租户平台上有界、可审计、可溯源地回答业务问题"。前者是后者的一个内核，不是它的替代品。**

---

## 1. 最容易踩的坑：pi 的文档比它的代码"完整"

**这一条放在最前面，因为它最可能让人押错方向。**

`packages/agent/docs/observability.md` 读起来像一个已交付的特性——完整的 `PiObservability` 接口、span 模型、事件分类法、脱敏策略。实测：

```
grep -rn 'traceOperation|configurePiObservability|subscribePiObservability|runWithPiContext|PiObservability' packages/
→ 零命中
ls packages/ → 无 observability 目录
@opentelemetry/api 只在 packages/ai/package.json:67 作为依赖存在，src 里从未 import
```

**它是一份设计文档，不是代码。** 同类还有：
- `AgentHarness`（会话/压缩/分支）—— pi 自己的 CLI **一次都没 import 它**（`grep -rn 'AgentHarness' packages/coding-agent/src` → 零命中）。它自己的文档写着「7. Later coding-agent migration plan — Status: **Planned**」。也就是说：**我们最想用的那一层，是它自己都还没敢用的那一层。**
- 自动压缩（auto-compaction）**不在**可复用的 harness 里，只在 CLI 应用层（`coding-agent/src/core/agent-session.ts`）。其 harness 文档自陈：「Auto-compaction and retry decision points are **not implemented** in `AgentHarness` yet.」

⚠️ **任何基于 pi 文档做的工作量估算都会偏低。必须以源码为准。**

---

## 2. pi 有什么（我们缺的）

| 能力 | 出处 | 对我们的价值 |
|---|---|---|
| **45 家 provider 统一抽象** | `packages/ai/src/providers/`（10 种 wire API） | **高**。我们现在 `llm/providers.ts` 手工维护 Anthropic/OpenAI-compat/custom_http |
| **provider 怪癖的统一处理** | 各 provider 模块 + `utils/retry.ts` 的可重试/不可重试正则表 | **高**。`G-REASONING-CONTENT-DROP`（kimi/o1/R1 把结论写进 `reasoning_content`）正是"手写循环 + 各家适配器语义不齐"的结构性负担 |
| 三级注入点（整个 `streamFn` / 自定义 `Provider` / 自定义 `fetch`+`onPayload`+`onResponse`） | `agent/src/types.ts:28-32`、`ai/src/models.ts:75-120,556`、`ai/src/types.ts:126,147,152,161` | **高**。意味着可以**只用它的 provider 层**而不接受它的循环 |
| 会话树（append-only、可分支/fork）+ 三种 store 实现 | `harness/types.ts:453-464,552-563` | 中。我们目前无等价物，但也没需求驱动 |
| 流式事件模型 | `ai/src/types.ts:501-513` | 中。我们已有自己的 SSE 契约 |
| **错误契约：stream fn 不许 throw，失败必须编码进流** | `agent/src/types.ts:23-27` | 中。与我方 R7 同向 |
| MIT 许可 | `LICENSE:1` | 无障碍 |

**活跃度**：81.8k star / 2026-07 单月 493 commits / 30 天 12 个 tag。是真活跃项目，不是玩具。

---

## 3. pi 没有什么（我们赖以运转的）

> 这一节是本评估的核心。每一项在我方**都不是锦上添花，而是针对一次已记录的故障写的**。

### 3.1 治理原语：**零**

```
grep -rniE 'maxIterations|maxTurns|maxSteps|budgetUsd|costLimit|maxCost|spendLimit' packages/*/src → 零命中
grep -rniE 'loop.?detect|stuck|infinite loop|repeatedToolCall'                        packages/*/src → 零命中
```

pi 的循环**只在三种情况下停**：模型不再发工具调用 / hook 说停 / abort 触发。**没有迭代上限、没有墙钟上限、没有 token 或成本上限。** 成本被**计算**（`calculateCost`、`Usage.cost`）但**从不被执行**。

对照我方（每条后面是"没有它会出什么事"，来自本仓已记录的实测）：

| 我方治理项 | pi 等价物 | 没有它会出什么事（已实测） |
|---|---|---|
| 7 维预算 `BudgetTracker` | ❌ 无 | — |
| `maxDiscoverCalls` 专属配额 | ❌ 无 | agent 盲扫目录反复"看看有什么工具"，把整轮预算烧在找路。**真 Kimi 20 题实测 76–137s/题，99% 时延在盲选推理**（G-AGENT-BLIND-REACT） |
| `maxRoundTrips` | ❌ 无 | 迭代计数与真实 LLM 往返脱钩，实际往返可远超 maxIterations |
| `perToolCallCap` | ❌ 无 | **同工具异参刷屏**绕过环检测，一路烧满 |
| 嵌套预算共享（NestingCtx） | ❌ 无 | 子 agent / workflow-as-tool **各起各的预算**，顶层上界形同虚设（G-WORKFLOW-BUDGET-LEAK） |
| per-call LLM/工具 deadline | ◐ 仅 HTTP 层 `timeoutMs` | 某次调用挂住 → 永不返回 → **整任务 hang，10 分钟 budget 也救不了**（因为预算只在轮首查） |
| `callSignature` 环检测 + `STALL_LOOP` | ❌ 无 | agent 反复以**相同参数**调同一工具、每次都"成功"返回空结果 → 停滞计数恒复位 → **永不触发早停** |
| S01 双条件停滞早停 | ❌ 无 | 权限 DENIED + solver ERROR 反复 → 烧满 24 轮 ≈ **5 分钟像卡死**，最后拼出三个"我不会" |
| **唯一诚实降级出口 `degrade()`** | ❌ 无 | 有界终止变成 500 / 空回答 / 静默半成品。R7+R13 在 agent 路的落点就是这个函数 |
| 升级阶梯（retry → rung① 换策略 → rung② Coordinator 扇出） | ❌ 无 | 一次网络抖动被降级成"未能解答"；一次盲选失误直接判死刑 |
| 上下文三刀 | ◐ 有 compaction，但**不在可复用层** | — |
| 13 个 `qos_*` metric ＋ 强制进 `render()` 的门 | ❌ 无（observability 是设计文档） | — |

**pi 的 hook 面（`shouldStopAfterTurn` / `prepareNextTurn` / `beforeToolCall`）够用来重建这些，但策略一条都不提供。**

### 3.2 多租户：**类型系统里零存在**

```
grep -rniE 'tenant|userId|orgId|principal' packages/{server,protocol,agent}/src → 零命中
```

凭据按 **provider id 全局唯一**（`credential-store.ts:3-5`：one credential per provider）。Session 无 owner 字段。

对照我方铁律 **R2 tenant_id everywhere**：`ToolAuthCtx.tenantId` 贯穿 executor / engine / skill-probe / loop；跨租户 skill 即拒（`executor.ts:532`）。

「推断」多租户在 pi 上**可以自建**（`SessionStore`/`CredentialStore` 接口干净、无环境全局态），但**没有任何东西强制它，编译期也抓不到跨租户泄漏**。依据：上述接口完全可注入，但整个类型系统里不存在 `tenantId`。

### 3.3 MCP：**明确不做**

`packages/coding-agent/README.md:495`：「**No MCP.** Build CLI tools with READMEs, or build an extension that adds MCP support.」
全仓 `grep -rniE '\bmcp\b'` 共 **6 处命中，全是散文或无关测试字符串**。无 client、无 stdio/SSE 传输、无 server 配置 schema。

我方 **B3 MCP** 是已交付模块。替换即整块自建。

### 3.4 权限 / 沙箱：**明确不做**

- `README.md:47`：「Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access.」
- `README.md:499`：「No permission popups」
- `docs/security.md:22`：「Pi does not include a built-in sandbox… **This is intentional**.」

推荐边界是"在整个进程外面套容器/微 VM"。

对照我方：**Agent scope 隔离**（`executor.ts:136-153`，toolNames / objectTypes 越界即 `AGENT_SCOPE_VIOLATION`，**独立于用户权限**）、**entitlement 先于 authz**（关闭的功能从 tools 数组里剔除 = 对 LLM 不存在）、**OBO 透传**（`datacore-http.ts:33-37`，AgentCore **从不用自己的身份**读 A 的数据；token 剩余 <60s 即拒新调用）。这三样 pi 都不提供，`beforeToolCall` 只给了挂点。

### 3.5 其它硬障碍

| 项 | 事实 | 影响 |
|---|---|---|
| **schema 库** | tool 参数用 **typebox 1.3.7**（`ai/src/types.ts:456,483`） | 我们是 zod 4 且 **contracts-only-shared（R1）**。每个工具边界都要桥接 |
| **Node 版本** | 全包 `engines: node >=22.19.0` | 需核对我们的运行时下限（CLAUDE.md 写 Node ≥20） |
| **API 稳定性** | pre-1.0，v0.80.3→v0.83.0 = 30 天 12 个 tag；CHANGELOG 的 `[Unreleased]`/`[0.82.0]`/`[0.81.0]` 各有 Breaking Changes，包括**整个会话持久化 API 重命名**、`ExecutionEnv`→`toolContext` | 高 |
| **`packages/server` 稳定性** | README 首行：「**Experimental.** may change or be **removed without notice**」；auth 是单个共享 bearer token，无身份、无 per-session 授权 | 排除该形态 |
| **确定性** | faux provider 好用（34 个测试在用），但 `Date.now()`/`uuidv7()` **无可注入时钟**（`agent-loop.ts:785`、`agent.ts:395,506`、`repository.ts:17,21`） | 断言级确定性 OK；**字节级快照不可得** |
| **贡献治理** | `CONTRIBUTING.md:23`：新贡献者的 issue 与 PR **默认自动关闭** | 上游修 bug 是受限流程 |

---

## 4. 我方替换的爆炸半径（量化）

| 维度 | 数量 |
|---|---|
| agent 栈本体源文件 | ~28 |
| 编排/接线牵连源文件 | ~29 |
| agentcore 测试文件 / 用例 | **133 / 740** |
| 其中经 `createTestApp` 起完整栈 | **100 文件 / 574 用例** |
| 其中直接依赖 `queueAgentTurn` 脚本语义 | **50 文件 / 309 用例** |
| 前端消费 `Answer`/SSE 的文件 | 9 + mock 3；前端测试 158 文件 / 457 用例 |
| 跨包契约 | `packages/contracts/src/qos.ts` 的 Answer/AgentBudget/AgentRunRecord/AgentIteration/ContextOp —— **datacore 也 import，改契约即三包连动（R1）** |

**关键的两个数：**

1. **`agent/loop.ts` 的直接 src importer 只有 2 个**（orchestrator + engine）—— 循环本体**接口面很窄，好换**。
2. **`tools/budget.ts` 有 25 个 importer、`tools/executor.ts` 有 18 个** —— 治理层是**横切**的：预算跟着 NestingCtx 穿过 workflow / 子 agent / MCP，executor 是所有工具的唯一闸门。

**最硬的一条约束**：`scripts/check-loop-control.mjs` 的 16 条断言**正则匹配 `loop.ts` 的源码字面形状**（例如"`degraded: { reason }` 在整个文件必须恰好出现 1 次"）。**任何重写 loop.ts 的方案必然让它红，除非同时重写这道门。** 而这道门本身是「唯一诚实降级出口」这条宪法级不变量的执行者——重写它就是在拆掉执行机制。

> 一句话总结耦合形态：**替换的成本主要不在"重写 ReAct 循环"（那部分接口窄、代码不多），而在把 §3 那 10 项治理语义、9 条不变量落点、574 个用例的确定性 mock、以及那道 16 条断言的门，逐条搬过去或重建。**

---

## 5. 建议的分阶段路线（每阶段自带门与回退）

> 纪律：每阶段**独立可回退**、**独立过四包 gate**、**不改对外契约**。任何一阶段做不成，不影响已完成阶段。

### Phase 0 · 先确认要解决的是哪个问题（**不写代码**）

替换动机必须先说清，否则后面全是无效功。候选：

| 若动机是… | pi 能不能解决 | 判断 |
|---|---|---|
| **agent 太慢**（76–137s/题） | ❌ **不能** | 实测 99% 时延在 **LLM 盲选推理**，不在循环实现。换个循环框架不会变快；这是路由/提示/导航图问题（我方补丁路线已在做） |
| **多 provider 支持累** | ✅ **能，且这是最大收益** | 45 家 provider + 怪癖处理 |
| **推理型模型丢结论**（G-REASONING-CONTENT-DROP） | ✅ **能** | 它按 provider 分模块处理语义差异，我们是手写适配器 |
| **想要会话分支/回放** | ◐ 能，但那层它自己没用 | 见 §1 |
| **循环代码难维护** | ◐ 表面能 | 但治理层要全部重写，净复杂度可能不降反升 |

**产出**：一句话写清动机 + 排除掉 pi 解决不了的那些。**这一步不做，后面全是赌。**

### Phase 1 · 用 pi-ai 替换 `llm/*`（**推荐先做**）

- **范围**：只动 `apps/agentcore/src/llm/{providers,types}.ts`，实现现有 `LlmClient` 接口的一个 pi-ai backing。
- **不动**：`loop.ts` 一行不改；SSE / Answer / 治理层零改动。
- **收益**：45 家 provider；provider 怪癖处理；`onPayload`/`onResponse` 拦截点。
- **风险**：低。`llm/` 的接口面窄，且 `ScriptedLlmClient` 是按接口 mock 的 —— **574 个用例一个都不用改**。
- **门（缺一不可）**：
  1. 四包 gate 全绿；
  2. `no-llm-degradation-seam.test.ts` 等既有 LLM 相关 SEAM 全绿；
  3. **变异反证**：把 pi backing 的错误路径打断，确认相关测试转红（不是"跑通了"就算）；
  4. `qos_llm_tokens_total` 埋点口径与旧实现一致（token 计数换实现会静默改变上下文三刀的触发点 —— 这是个**隐蔽的接缝**）。
- **回退**：保留旧 provider 实现，用 env 开关切换，**默认关**（照本仓暗发纪律）。

### Phase 2 · 评估把 pi-agent-core 的循环内核塞进 `runAgentLoop`（**可选，先做 spike**）

- **形态**：不是"用 pi 的循环替代我们的"，而是**我们的 `runAgentLoop` 内部调用 pi 的 `agentLoop`**，把我方治理层实现成 pi 的 hook：
  | 我方治理项 | 落到 pi 的哪个 hook |
  |---|---|
  | 预算/迭代/往返上限 | `shouldStopAfterTurn` |
  | 环检测 `callSignature` | `beforeToolCall` + 自建状态 |
  | S01 停滞早停 | `afterToolCall` 累计 + `shouldStopAfterTurn` |
  | per-call deadline | `beforeToolCall` 里建 AbortController |
  | agent scope 门 / entitlement / OBO | `beforeToolCall` 的 `{block:true}` |
  | `degrade()` 唯一出口 | 循环返回后由我方包裹（**pi 不知道降级这回事**） |
  | provenance 从审计日志解引用 | 我方 `acceptFinalAnswer` 保留，pi 只负责跑 |
- **必须先做 spike 回答的三个问题**：
  1. `check-loop-control.mjs` 的 16 条断言如何重建？**它们守的语义不能丢**（尤其"唯一降级出口"）。
  2. typebox↔zod 桥接在每个工具边界的成本与失真（我方工具 schema 是 zod，且 contracts-only-shared）。
  3. `ScriptedLlmClient` 的四种能力（脚本队列 / **HANG 哨兵** / 函数式断言 prompt / 确定性 token 计数）能否在 pi 的 faux provider 上等价复现？**做不到就是 309 个用例逐条重写。**
- **门**：spike 结束必须给出"这三个问题的答案 + 重建工作量"，**再决定是否进入实施**。不给答案就不许开工。

### Phase 3 · 明确排除

- ❌ `@earendil-works/pi-coding-agent`（form D）—— 它是**宿主**不是库，带 `~/.pi` 文件系统约定、project trust、扩展加载器。
- ❌ `pi --mode rpc`（form E）—— 每会话一个子进程，与我们的服务模型不符。
- ❌ `packages/server`（form F）—— 自陈 experimental、可能**被无预告移除**；auth 是单共享 token、无身份。

---

## 6. 《本体引用与影响》

> 本节按 CLAUDE.md 铁律 0 填写。**本文档为评估，未改动任何接线；下列为"若实施"的影响面。**

**触及对象类型**（§2.H 交互/编排域）：`意图` · `执行计划` · `Agent 运行记录(AgentRunRecord)` · `Agent 迭代(AgentIteration)` · `上下文操作(ContextOp)` · `Skill` · `工具调用审计`

**触及链路**（§3）：编排链（`submitQuery → classify → path-A/path-B → answer.final`）· Skill 引用链 · DRIL 链

**触及事件**（§8.2「一字不差」）：9 个 SSE 事件名 ＋ 10 类 `step.completed` 伪 step type。
**Phase 1 对其影响为零；Phase 2 必须逐字保持** —— 尤其 `agent_degraded`（其 outcome = degrade reason）与 `agent_escalated`。

**触及不变量**：
- **R1 contracts-only-shared** —— typebox 引入**不得**穿过 `packages/contracts`；桥接必须留在 agentcore 内。
- **R2 tenant_id everywhere** —— pi 类型系统无 tenant，我方必须在 hook 层维持，且**编译期无保护**（新增风险）。
- **R3 entitlement 先于 authz** —— 落 `beforeToolCall`，且必须保持"关闭 = 从 tools 数组剔除"而非"调用时拒"。
- **R4 真值经 Action** —— `create_action_draft` 唯一写出口 + `writeMode` 技能必须产出 `action_draft` 块，保留在我方 `acceptFinalAnswer`。
- **R6 确定性** —— ⚠️ **本项有实质风险**：pi 的 `Date.now()`/`uuidv7()` 不可注入。若 pi 的对象进入我方被断言的输出，字节级复现将不可得。
- **R7 错误信封** —— pi 的 stream fn 契约（不许 throw、失败编码进流）与我方同向，可对接。
- **R8 OBO 透传** —— 落 `beforeToolCall` / 自定义 fetch。
- **R13 结论可溯源** —— provenance 从审计日志解引用，**必须保留在我方**（pi 无溯源概念）。

**触及门禁**（§7）：
- `loop-control:check`（16 条断言，**正则匹配 loop.ts 源码字面形状**）—— Phase 2 必然使其失效，需**同步重写**，且重写后必须做变异反证证明新门仍有牙。
- `check-system-ontology.mjs` —— 见下。

**触及断点**（§8）：
- `G-AGENT-BLIND-REACT` —— ⚠️ **pi 不解决它**（时延在盲选推理，不在循环实现）。不要把它列为替换理由。
- `G-REASONING-CONTENT-DROP` —— pi-ai 可从结构上缓解（Phase 1 顺带收益）。
- **新增断点候选 `G-PI-NO-GOVERNANCE`**（若实施 Phase 2）：外部循环框架不提供任何治理原语，全部依赖 hook 重建 —— 需在本体登记，并配一条门断言"治理 hook 全部在位"。

**回写要求**：Phase 1 落地即回写 §2.H（LLM 客户端层实现变更）；Phase 2 若实施，须回写 §2.H / §3 / §7 / §8。

---

## 7. 顺带查出的一个既有缺陷（与本评估正交，但必须记）

测绘时实测：**本体 §2.H 的 `file:line` 锚点已全面漂移**——
引用 `loop.ts:584-590`（守卫序列）/ `867-873`（S01）/ `350`（degrade）/ `223`（reflectWithCritic）/ `597-620`（三刀），
实际在 **725-731 / 1059-1065 / 444 / 305 / 737-761**。

而 `scripts/check-system-ontology.mjs:52-58` **只校验文件存在性、不校验行号**，所以漂成这样门照绿。

危害：本体自称"系统接线的单一来源"，铁律要求改动前先读它——**照着漂掉的锚点找代码会找错位置，而越是新人/新 agent 越会照着找**。在 agent 框架替换这种大改动里，这会直接放大成误改。

已立单（假绿第六形态）。建议改用**符号锚点**（`loop.ts::runAgentLoop`）替代行号，门断言该符号在该文件存在。

---

## 8. 待仓主裁决

1. **Phase 0 的动机是什么？** 这是唯一必须由你回答的问题。若动机是"agent 太慢"，**pi 不解决**，应停在这里。
2. **是否批准 Phase 1**（pi-ai 替换 LLM 客户端层）？我的建议：**批准**——风险低、收益明确、574 个用例零改动、可 env 开关回退。
3. **是否批准 Phase 2 的 spike**（只回答三个问题，不实施）？我的建议：**批准 spike，不预批实施**。三个问题的答案会把工作量从"猜"变成"算"。
4. Phase 3 排除项是否有异议？
