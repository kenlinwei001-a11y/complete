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

---

# 附录 A · 「强化」而非「替换」路线（第二轮 · 审核方亲手读源码后重写）

> 触发：仓主校正提法 —— 不是替换运行时，而是**把 agent 的 UI/UX/CLI 升级到 pi 的水准，作为查遗补漏**；
> 并指出「目前 agent 的优势在满足本系统定制化，短板是不够完整、**不是一个可扩展的系统**」。
> 且要求 **不要着急下结论，逐一看 pi 的手册与代码再分析**。
> 本附录的所有事实均为**审核方亲手 grep / 读源码**所得（正文第 1–10 节是二手综合，保留但降级为背景）。

## A.1 先纠正正文的一个切法错误

正文按**包**切（pi-ai / pi-agent-core / pi-coding-agent / pi-tui）。**这个切法不准**，因为
**包的边界与成熟度边界不重合**：`pi-agent-core` 里 `agentLoop` 是它自己天天在跑的，
而同包的 `AgentHarness` **它自己一次都没用过**。按包给结论会把两者混为一谈。

**改按「它自己用不用」切。** 判据不是文档写没写，是 `grep` 得到的实际引用。

## A.2 亲手验的「文档有 · 代码无」（这是本次评估最重要的发现）

pi 呈现出一种成规模的特征：**它的文档在描述一个比代码更完整的系统**。逐条是我自己跑的 grep：

| 声称的能力 | 文档 | 代码 | 取证 |
|---|---|---|---|
| durable harness `lane`（一 session 多并行 leaf） | **148 处** | **0** | `grep -rniE '\blane\b' packages/agent/src/harness` |
| `provisioned`（预分配 id） | **65 处** | **0** | 同上 |
| `checkpoint` | 41 处 | **1** | 同上 |
| `harnessEntry`（编排事实私有日志） | 20 处 | **0** | 同上 |
| `createRef` | 3 处 | **0** | 同上 |
| observability（span/trace/脱敏） | 376 行完整接口 | **0** | `grep traceOperation\|PiObservability packages/` |
| skill frontmatter `allowed-tools`（工具预授权） | 文档表格正式列出 | **0** | `SkillFrontmatter` 只声明 `name`/`description`/`disable-model-invocation`，未知字段**静默丢弃** |

两份 harness 文档的标题原文就是 `# Durable AgentHarness **plan**` 与 `# Durable AgentHarness **design**`，
合计 **4217 行**。

**`AgentHarness` 谁在用**：全仓非 `packages/agent/` 的引用只有 `packages/evals`（评测脚手架，
且是它自己的 `createPiCodingAgentHarness`，**同名不同物**）与 `protocol/schemas.ts:37` 的**一句注释**。
**产品 CLI 零引用。**

> ⚠️ **结论不是「pi 不好」** —— 81.8k star、月均约 500 commit，是真活跃的真项目。
> 结论是：**任何「pi 已具备 X 能力」的判断都必须落到 grep 上，否则会系统性高估**；
> 而这个高估**恰好集中在我们最想要的那几层**（可扩展性之外的持久化编排、可观测性），
> 因为那正是它还在设计、还没建的部分。
>
> 其中 `allowed-tools` 最刺眼：用户在 skill 里写了它、以为做了工具预授权，**实际一字节不生效且无任何警告**。
> 这正是本仓反复清理的「声明了但没接线」，出现在一个我们打算借鉴的项目里 —— **借鉴时必须连它的坑一起识别**。

## A.3 我们与 pi 在可扩展性上不是强弱，是**正交**

亲手取证：

```
apps/agentcore/src 里：
  registerTool / registerProvider / registerCommand / plugin / extension / loadExtension
    → 全部 0 处命中
  BUILTIN 工具表 tools/registry.ts：31 个条目 / 492 行 —— 改它要动源码 + 重部署
但同时：
  repos.skills 32 处 · repos.agents 46 处 · repos.workflows 31 处 · repos.llmProviders 8 处
```

| 面 | 我们 | pi |
|---|---|---|
| **数据面**（skill/agent/workflow/rule/solver/对象类型/场景卡） | ✅ DB 驱动 · 带版本 · **带发布门**（skill-probe 要求 ≥3 用例且 passRate=1、依赖闭合检查、skill-lint） | ❌ 基本没有（Skill = 扔个 markdown 文件） |
| **代码面**（工具/供应商/命令/提示词/渲染器/UI 面板） | ❌ **全要改源码 + 重部署** | ✅ 运行时可注册 · 33 个事件 · npm/git 分发 · ~70 个可跑例子 |

**所以要拿的是 pi 的代码面扩展模型，同时把我们的数据面治理原样保住。**
这比"替换运行时"目标清晰得多、风险小得多，且**不碰 `loop.ts`、不碰 `check-loop-control` 那 16 条断言、不碰 SSE 契约**。

## A.4 亲手读到的、值得抄的具体设计

> 以下每条都是我读 `extensions.md` 原文所得，不是转述。

**① 工具运行时可注册**（`extensions.md:1341`）：`registerTool` 在加载期与启动后都能调，
在 `session_start`、命令处理器、任意事件里都行；**新工具当场对 LLM 可见，无需 `/reload`**。

**② 工具自带提示词贡献**（`promptSnippet` / `promptGuidelines`）：不是中心化一个提示词文件列全部工具，
而是每个工具携带自己那一行。
> 附带一条**踩过才写得出的经验**（原文）：`promptGuidelines` 是**平铺**追加、**无工具名前缀**，
> 每条必须自己点名工具 —— **不要写 "Use this tool when..."，LLM 分不出 "this" 指谁**。
> 我们现在是 `agent/prompts.ts` 集中八段纪律；若改成工具自带，必然撞同一个坑。

**③ `prepareArguments`**：可选兼容垫片，**在 schema 校验之前**跑，把旧字段折叠进新参数形状。
= **工具参数的版本兼容缝**。我们没有：工具 schema 一改就是破坏性的。

**④ `renderCall` / `renderResult`**：工具**自带渲染**。对照我们 `AnswerBlock` 是 6 个固定类型的 union，
工具带不了自己的渲染器 —— 这是"代码面不可扩展"最具体的一个实例。

**⑤ `ctx.signal` 贯到扩展自己的异步工作**：扩展里 `fetch` 传 `ctx.signal`，
用户按 Esc 能把**扩展自己发起的请求**一起取消。我们的 AbortSignal 只覆盖 LLM 与工具调用。

**⑥ 顺序保证与「不保证」都写明**（`extensions.md:749-760`）：
`tool_call` 触发前会等先前 Agent 事件排干（故 `ctx.sessionManager` 是最新的）；
但并行模式下**明确不保证**看得到同一条 assistant 消息里兄弟工具的结果。
—— **把不保证的东西写进契约**，这个习惯本身值得抄。

**⑦ 双队列消息模型**（steer / followUp）：Enter = 下一轮 LLM 前插入、Alt+Enter = 全干完再说、
Alt+Up = 取回队列到编辑器、**Escape = 中止并把队列文本还给编辑器**（不吞消息）。
对我们同样适用：「agent 正在跑一个 3 分钟的求解，用户想补一句约束」现在只能 cancel。

## A.5 对我们的硬红线（抄之前必须先加的东西）

**🔴 `tool_call` 里 `event.input` 可原地 mutate，且原文写着「No re-validation is performed after your mutation」**
（`extensions.md:761-765`，我逐字读到）。

对 pi 无所谓（单人本地、用户即 root）。对我们**等于让扩展绕过契约层**：
我们的工具 schema 是 zod 且 **contracts-only-shared（R1）**。
⇒ **要抄这套扩展模型，必须在 mutate 之后重新做 zod 校验**，否则 R1 当场失效。

其余必须自建、pi 明确不做的：多租户（类型系统零存在）、执行期权限闸（`project_trust` 是**加载期**闸门不是执行期）、
沙箱（"This is intentional"）、MCP。

## A.6 修正后的路线

| Phase | 内容 | 判断 |
|---|---|---|
| **0** | **先定动机**（不写代码） | 不变。若动机是"agent 太慢"，pi 不解决 |
| **1** | pi-ai 替换 `llm/*` | 不变。**批准**（574 用例零改动、env 开关默认关） |
| **1.5**（新） | **代码面扩展点**：仿 pi 的 `registerTool`/`registerCommand`/事件+归约链，落到我们的工具/命令/提示词/渲染器表面 | **这是本次评估新增的、最对症的一块**（正对「不是可扩展系统」这个短板）。**前置硬条件：mutate 后必须重做 zod 校验** |
| **2'**（新） | **CLI 交互升级**：`scripts/platform-cli.mjs` 从一次性命令 → 常驻交互会话（双队列 steering / 会话恢复 / 成本可见）。`pi-tui` 依赖只有 `get-east-asian-width` + `marked`、**零 peer**，是四个包里意识形态负担最轻的 | 候选。与已有 **R15「CLI 对等」不变量 + `cli-parity:check` 棘轮门 + RL7「CLI 先于 UI」**同向，不是支线 |
| **2** | 换循环内核 | **降为最低优先**。按新框架它收益最小、风险最大 |
| **3** | coding-agent / rpc / server | 排除（不变） |

## A.7 本附录的《本体引用与影响》（增量）

- **触及不变量**：新增 **R1 风险**（typebox↔zod 边界、扩展 mutate 后不重校验）；
  **R3** 扩展注册的工具必须同样受 entitlement 前置过滤（关闭 = 从 tools 数组剔除）；
  **R2** 扩展注册面必须带 tenantId 作用域（pi 无此概念）。
- **触及门禁**：若做 Phase 1.5，需新增一道门断言「扩展注册的工具全部经 zod 重校验 + 经 agent scope 闸」。
- **触及断点**：新增候选 **G-EXT-BYPASS-CONTRACT**（扩展绕过契约层）——若实施 Phase 1.5 须登记。
- **R15 CLI 对等**：Phase 2' 天然与之同向；新增交互能力须同步登记 `OPERATION_CATALOG`。

---

# 附录 B · 亲手真跑（第三轮 · 仓主指令「不仅要看是否有哪些功能，而是真实测试功能的完整性」+「从前端实际测试」）

附录 A 的事实靠 **grep**；本附录的事实靠 **跑**。方法：`npm ci` + `npm run build` 装出真构建，写探针测 API 层，
用 **pty + pyte 真 VT 模拟器** 驱动 TUI 截真屏，用**假 OpenAI 兼容端点**跑通真回合。
凡与附录 A 冲突处，**以本附录为准**（跑赢读）。

## B.0 基线（先证跑得起来，否则后面的红都不算数）

| 项 | 结果 |
|---|---|
| `npm ci` | RC=0（226 包） |
| `npm run build` | RC=0 |
| `pi-agent-core` 自测 | **282 passed / 1 skipped / 19 文件 / 6.5s** |
| `pi-coding-agent` 自测 | **1697 passed / 16 failed / 48 skipped（195 文件中 6 红）** |

16 红**全部定性为环境**，非缺陷：本机以 **root** 运行（`chmod 000` 文件仍可读 → 6 条 `EACCES`/`not writable`
断言的前提不成立）+ **`fd` 未安装**（`find.ts:214 ensureTool("fd", true)` 硬依赖）。已逐条核对，未发现真缺陷。

## B.1 API 层探针（`packages/agent/test/zz-probe*.test.ts`）

| 探针 | 问题 | 实测 | 结论 |
|---|---|---|---|
| P0 | 基线：faux provider + `Agent` 能跑、工具真被调 | `toolCalls=1 msgs=4` | ✅ |
| P1 | 循环有没有内建迭代上限 | 请求 30 连轮 → `actualToolCalls=30` | **无任何上限** |
| P2 | 能否只靠 hook 建出上限 | `turns=0 toolCalls=30` | **`Agent` 类的 `AgentOptions` 根本不接受 `shouldStopAfterTurn`** |
| Q1 | `beforeToolCall` 返回 `block:true` 能否停住循环 | `seen=20 executed=3 blocked=17` | **拦得住工具，拦不住循环** —— 预算耗尽后仍在烧 17 轮模型调用 |
| Q2 | `abort()` 之后拿得到什么 | `lastRole=assistant lastStop=aborted lastContent=[] err="Request was aborted"` | **无任何钩子注入诚实的部分结论**；`state.messages` 里的 3 条工具结果得自己在循环外重建 |
| Q3 | `beforeToolCall` 里改参数会不会重校验 | ctxKeys=`["assistantMessage","toolCall","args","context"]`；schema 声明 `n:Number`，**工具实收 `{"n":"NOT_A_NUMBER"}`** | **脏值直达工具，零重校验**（对应 A 附录已列的 R1 风险，现已实证） |
| P4 | 同脚本两遍是否字节一致 | `identical=false`，首差在 `"timestamp":1785639388003` vs `…004` | **无可注入时钟**，R6 需自建 |
| PROBE3 | `skills.md:148` 列的 7 个 frontmatter 字段活下来几个 | 解析后键只剩 `name/description/content/filePath/disableModelInvocation`；`allowed-tools`/`license`/`compatibility`/`metadata` 全 `null`，**`diagnostics=[]`** | **文档承诺"预授权工具清单"，实际连字段都没读，且零诊断** |
| PROBE3b | 字段拼错能否发现 | `allowedtools`、`totally-made-up-field` 全静默吞掉，`diagnostics=[]` | **fail-open**，与我们「假绿」同族 |

**结论修正（推翻附录 A 的措辞）**：不是"hook 够用、策略缺失"，而是 **用 `Agent` 类就拿不到收口 hook**。
`shouldStopAfterTurn` 只在 `AgentLoopConfig`（`types.ts:217`，`agent-loop.ts:248` 消费）里，
`AgentOptions` 只有 `beforeToolCall`/`afterToolCall`/`prepareNextTurn`/`prepareNextTurnWithContext`。

## B.2 结构性发现：pi 有**两套并行的 agent 栈**，产品跑的是治理弱的那套

| | `Agent`（`agent.ts`） | `AgentHarness`（`harness/`） |
|---|---|---|
| 出货 CLI `packages/coding-agent`（183 源/195 测试） | **`sdk.ts:294 new Agent({...})`** | **零引用**（全包只有 2 处散文里的 "harness" 字样） |
| 被谁用 | CLI | 仅 `packages/evals`(3) + `packages/protocol`(1) |
| 暴露 `shouldStopAfterTurn` | 否 | **也否**（`agent-harness.ts:497` 自己内部用 `beforeToolCall`） |
| 设计文档 | — | `harness.md`(2390，标题 *plan*) + `harness-v2.md`(1827，*design*) + `agent-harness.md`(506) |

两套栈连工具都各写一份：`agent/src/harness/tools/image.ts:56-68` 与 `coding-agent/src/utils/mime.ts:67-80` 是同一段逻辑的两份拷贝。
**「按包切」不准，「按它自己用不用」才准**——这是附录 A 已定的判据，本轮又添一例。

## B.3 「文档写了、实际没有」——必须分五类，性质完全不同

**① 文档明说"故意不做"（诚实，不是坑）** ——附录 A 把 MCP/subagent 列进"缺口"是**误判**，此处纠正：

> `usage.md:301`「It intentionally does not include built-in MCP, sub-agents, permission popups, plan mode, to-dos, or background bash.」
> `README:495`「**No MCP.**」·`README:497`「**No sub-agents.**」

**② 设计稿词汇，代码里为零（读文档必然高估）**

| 概念 | harness 文档提及 | 源码 | 备注 |
|---|---|---|---|
| `lane` | 240 | **0** | grep 的 9 处命中全是 `colorPlanes` 子串 |
| `provisioned` | 42 | **0** | |
| `checkpoint` | 41 | 2 | |
| `createRef` | 3 | **0** | |
| observability（span/trace/metrics） | **376 行专文** | **0** | `observability.md` 标题即 *Design Notes* |

**③ 文档当能力写、实测无效** → B.1 的 PROBE3/PROBE3b（`allowed-tools` 等 4 字段静默丢弃 + 零诊断）。

**④ 能力存在但不在你以为的那层** → B.2（`shouldStopAfterTurn` 只在底层 loop；`AgentHarness` 不被产品用）。

**⑤ 有，但语义与直觉相反** → B.1 的 Q1/Q3/P4（block 不停循环 · 脏参直达 · 无注入时钟）。

## B.4 TUI 实跑（pty + pyte 真 VT，逐屏截图）

**pi 没有 Web 前端**：UI = 自研 TUI（`packages/tui` 37 源/30 测试）；`packages/client`+`server` 是 CBOR 远程会话协议，非 Web UI。

**做得好的（可直接学）**

| 项 | 实测 |
|---|---|
| **中文宽字符** | 按显示宽度正确折行；退格删**整字**；左右移按**字符**不按格；插入精确落在「交\|期」之间 —— 无半字符撕裂。**我们全中文，这条是硬需求，pi 过关** |
| `!` bash 直执行 | `!ls -la` 真跑，输出内联渲染 |
| `/` 命令菜单 | 23 条，可滚动带描述 |
| `ctrl+o` | 20 条键位（alt+enter 排队追问 / ctrl+g 外部编辑器 / 拖文件附件） |
| `/model` | 115 模型，模糊搜索，右侧实时详情 |
| `/settings` | 27 项，可搜索，Enter/Space 就地切换 |
| 自定义模型接入 | 只写一份 `models.json`（`baseUrl` + `api: openai-completions`），**零代码**接上假端点跑通 |
| `esc` 中断 | spinner → `Operation aborted`，**工具确未执行**，会话继续可用 |

**实测出来的问题**

- **B.4.1 启动期从 GitHub 下 `fd` 二进制，失败即静默降级**：屏顶留下
  `fd not found. Downloading...` / `Failed to download fd: GitHub API error: 403` 后照常进会话，
  而 **`@` 文件补全整个死掉**（`@`/`@READ`/`@src/al` 三种写法均无弹窗）。
  **变异反证**：把一个 fd 塞进 PATH → 403 行消失、补全立刻复活（列出 `src/`、`README.md`、`alpha.ts`），`@src/a` 还能过滤。
  源码自证 `interactive-mode.ts:727`「*fd for autocomplete, rg for grep tool*」。
  → **对我们是部署级阻断**：内网/代理环境首启即残废且不报警。
  （更正：`find` 工具**本来就不在默认工具集**，见 B.4.3，所以 fd 挂掉打死的是 `@` 补全，不是默认会话的 find。）

- **B.4.2 工具执行零审批 —— 有实物证据**：让假模型返回 bash 工具调用
  `echo TOOL_REALLY_RAN > /tmp/pi-approval-probe.txt`，屏幕上只有事后回显（`$ … / done / Took 0.0s`），
  而 `cat /tmp/pi-approval-probe.txt` → **`TOOL_REALLY_RAN`**。
  这是 README 明写的取舍，但现在是坐实的：**我们平台 R4「真值经 Action」+ 人工审批门，这一层 pi 一行都没有。**

- **B.4.3 只给模型 4 个工具**：假端点收到 `["read","bash","edit","write"]`；源码对得上——
  `createCodingTools()` 只返回这 4 个，`find/grep/ls` 在另一套 `createReadOnlyTools()` 里（`tools/index.ts`）。

- **B.4.4 中断后什么都拿不到**：屏幕上只有 `Operation aborted` —— 与 B.1 的 Q2 完全一致。
  **UI 忠实反映了底层没有诚实降级接缝**，不是 UI 没做。

## B.5 对路线的影响

| 附录 A 结论 | 本轮实测后 |
|---|---|
| Phase 1（pi-ai 换 `llm/*`）**批准** | **不变**，B.0 的 282/1697 绿支持它 |
| Phase 1.5（代码面扩展点）**前置硬条件：mutate 后重做 zod 校验** | **从"预防性要求"升级为"实证必需"** —— Q3 已证脏值直达工具 |
| Phase 2（换循环内核）**最低优先** | **进一步降级**：P2/Q1/Q2 证明 `Agent` 类上建不出「有界终止 + 诚实降级」，我们的 `degrade()` 无处安放 |
| Phase 2'（CLI 交互升级） | **加强**：B.4 的中文宽字符、命令面板、设置面板、模型选择器都实测可用，是最值得学的一块 |
| — | **新增 B.4.1 部署前置**：任何引入 pi CLI 的方案必须预置 `fd`/`rg` 或设 `PI_OFFLINE=1`，否则内网首启静默残废 |
| — | **新增 B.4.2 硬缺口**：审批门必须我们自建，pi 侧零基础 |

## B.6 复现方式（探针与驱动器）

- API 层：`packages/agent/test/zz-probe-governance.test.ts`（P0–P4）、`zz-probe2.test.ts`（Q1–Q3）、`zz-probe3-skill.test.ts`（PROBE3/3b）。
  注意 pi 的 vitest 配 `silent: "passed-only"`，**必须 `--silent=false` 才看得到 console 输出**（否则通过的探针一个字都不打，等于白跑）。
- TUI 层：`pty-drive.py`（pty + pyte，脚本化 `wait/send/key/snap`）+ `fake-llm.py`（假 OpenAI 兼容端点，第 1 轮回 bash 工具调用）。
- 变异反证：fd 有/无对照（B.4.1）；工具执行留痕文件（B.4.2）。
