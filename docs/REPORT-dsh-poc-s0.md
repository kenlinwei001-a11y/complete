# WO-DSH-POC-S0 交回报告 · 「换心」POC 的 S0 针刺（改版）

日期：2026-08-14 ｜ 执行机：macOS（Darwin 22.6.0），主 checkout `/Users/apple/deploy/complete`
分支：`claude/handoff-wo-dsh-poc-s0` ｜ 基线：`origin/claude/verify-reclaim-6` = `85fd76df`（与 WO 给定一致）
dsh 基准：npm 全部钉 `0.1.0-rc.6`（dist-tag `next`）；源码树 `/tmp/dsh` @ `47f943859bef`（2026-08-13，"Merge PR #2519 feat/npm-public"）；Node v24.13.0

---

## 1 · 环境对齐（WO §1 复核）

- worktree `/tmp/dsh-poc-s0` @ 85fd76df；`git merge-base --is-ancestor HEAD origin/claude/inspiring-gates-aqczjg` → **非祖先，ok**（未落后）。
- `pnpm install --prefer-offline` RC=0；`@platform/contracts` build RC=0；`@platform/llm-adapters` build RC=0。
- **WO 环境段勘误（顶回，带证据）**：WO 写「本机是 /home/user/complete」——那是容器机的路径；本执行机是 macOS，主 checkout 为 `/Users/apple/deploy/complete`（`git rev-parse HEAD` = 9730a99f8，与本会话历史一致）。命令均按等价路径执行，语义不变。
- 端口：WO 说本仓 4002 —— 正确（CLAUDE.md 架构地图）；此前方案写 4005 是本机 LaunchAgent 的 env 覆盖（内存模式部署），不是仓默认值。两者不矛盾，报告以仓默认 4002 为准。

## 2 · 锚点复核（WO §2 五处订正 + 五处命中，全部亲测）

| 符号 | WO 订正值 | 本树实测 | 判定 |
|---|---|---|---|
| `runRegisteredAgent` 定义 | engine.ts:379 | **379**（`async runRegisteredAgent(opts: RunRegisteredAgentOpts)`） | ✅ 订正确实 |
| `runAgentLoop` 调用点（flag 分叉处） | engine.ts:492 | **492**（`const result = await runAgentLoop({`） | ✅ |
| `AgentLoopOpts` | loop.ts:128 | **128**（`export interface AgentLoopOpts {`） | ✅ |
| `AgentLoopResult` | loop.ts:253 | **253**（`export interface AgentLoopResult {`） | ✅ |
| `skillGovernance` | loop.ts:451 | **451**（`export function skillGovernance(...)`） | ✅ |
| 补充：`runAgentLoop` 定义 | loop.ts:471 | **471**（`export async function runAgentLoop(...)`） | ✅ |
| 文件行数 | engine 758 / loop 1334 | **758 / 1334**（wc -l） | ✅ |

WO 说「另 5 处命中」也复核为真：`crypto.ts:4-14`（encryptSecret AES-256-GCM）✅ · `mcp/runtime.ts:161-164`（credentialRef→decryptSecret）✅ · `mcp/client.ts:39-56`（sdkMcpConnectorFactory，Bearer/MCP_CREDENTIAL 注入）✅ · `contracts/agentcore.ts:100`（mcpToolFullName 拼接无规整）✅ · `PRD-query-orchestration-service.md:520-537`（§8.2 表）✅。

**WO 的推断部分成立**：engine.ts 两处偏移不一致（+188/+34）说明该文件在两根树之间真的分叉过；loop.ts 三处偏移一致（+78/+80，整段行移）。结论：**凡引用我行方案里 file:line 的，一律以本树（85fd76df）实测为准。**

### AgentLoopOpts 逐字段清单（loop.ts:128-251，本树亲读）

必填 10：`taskId: string` · `model: string` · `system: string` · `userContent: string` · `tools: AgentToolSpec[]`（不得含 final_answer/load_skill，循环自加）· `llm: LlmClient` · `executor: GuardedToolExecutor` · `budget: BudgetTracker` · `repos: Repos` · `metrics: Metrics` · `emit: (event, payload) => Promise<void>`（实为 11 个必填）。

可选 21：`tenantId?`（多供应商路由）· `attribution?: AgentRunAttributionInput`（WO-AGENTRUN-ATTRIBUTION）· `placement?: AgentRunPlacementInput`（WO-AGENTRUN-FANOUT-PERSIST）· `isCancelled?: () => boolean` · `expectsSchema?: Record<string,unknown>`（替换 final_answer schema 并返回原始入参）· `provenancePolicy?: "required"|"best_effort"|"none"`（缺省 best_effort）· `writeMode?: boolean` · `loadSkill?`（回报 body+resources+治理位 writeMode/provenancePolicy，治理位不进 tool_result 字节，缺省 fail-closed）· `runWorkflowTool?` · `finalAnswerDescription?` · `loadSkillEnabled?` · `scopeToolNames?: string[]`（scopeDeclaration.toolNames，WORKFLOW 工具也强制）· `summarizer?`（Phase7C 滚动摘要，缺省确定性兜底）· `llmCallTimeoutMs?`（G-9 per-call deadline）· `sliceSolverKeys?`（WO-QOS-2 plan 自检）· `reflect?`（WO-REFLECT-LOOP 暗发默认关）· `replanBudget?`（默认 1）· `critic?`（entitlement agent.critic，fail-open）· `emitNarration?`（WO-REASONING-TRACE 暗发）· `loopRepeatCap?`（P1 环检测，opt-in）· `perToolCallCap?`（P2，opt-in）· `retry?: {maxAttempts}`（P2，缺省 0）· `escalation?`（P2 升级阶梯，暗发缺省 false）。

messages 不进边界：循环内部 `[{role:"user", content: opts.userContent}]`（loop.ts:472）。

### AgentLoopResult 逐字段清单（loop.ts:253-286）

必填 4：`outcome: "ANSWERED"|"FAILED"|"BUDGET_EXHAUSTED"` · `answer: Answer` · `run: AgentRunRecord` · `sketch: {toolName, inputSummary}[]`。
可选 6：`structured?`（expectsSchema 时的原始 final_answer 入参）· `degraded?: {reason: "TIMEOUT"|"BUDGET_EXHAUSTED"|"STALL_LOOP"}`（G-9）· `stalled?: {reason: "STALL_LOOP"|"STALL_CONSECUTIVE"}`（P2.5 rung② 信号，escalation 关则恒 undefined）· `planFellBackToReAct?`（WO-QOS-2 观测位）· `reflected?` · `replanReason?`。

**对方案的实质影响**：适配层 I/O 契约成立，但比我方案里引用的版本**多出 attribution/placement 两个可选归属字段**（旧树没有）——适配层必须透传，否则 run 归属与扇出位置丢失。这是分叉树带来的真实增量，方案表格其余字段论断经抽读依然成立。

## 3 · S0-a 三问逐问回答

### Q1：8 包是否单独发布、能否只装 sdk 侧？

**能单独装，且能只装 sdk 侧。** 逐包 `npm view` 实测输出（2026-08-14）：

```
@deepseek-ai/dsh-agent          0.1.0-rc.6
@deepseek-ai/dsh-agent-loop     0.1.0-rc.6
@deepseek-ai/dsh-tools          latest 标 0.0.1-rc.1，但 versions 列表含 0.1.0-rc.6
@deepseek-ai/dsh-system-prompt  同上（latest 滞后）
@deepseek-ai/dsh-session        同上
@deepseek-ai/dsh-scope          同上
@deepseek-ai/dsh-llm            同上
@deepseek-ai/dsh-llm-deepseek   同上
@deepseek-ai/dsh-credentials    同上
@deepseek-ai/dsh-sdk-client     0.1.0-rc.6 可装
@deepseek-ai/dsh-sdk-protocol   0.1.0-rc.6 可装
@deepseek-ai/dsh-sdk-server     **404 不存在**（WO 写 sdk/server，真名是 dsh-sdk-jsonrpc-server）
@deepseek-ai/dsh-sdk-jsonrpc-server  dist-tags: { latest: 0.0.1-rc.5, next: 0.1.0-rc.6 }
@deepseek-ai/dsh                { latest: 0.1.0-rc.6, next: 0.1.0-rc.6 }
```

两个实测坑（报告留档）：① **dist-tag 分裂**——多数包 `latest` 停在 0.0.1-rc.1，裸 `npm install pkg@latest` 会装到与老 agent 包 peer 冲突的版本（实测 ERESOLVE：`dsh-agent@0.1.0-rc.6` 要 `dsh-invariants@^0.1.0-rc.6`，而 `dsh-llm@0.0.1-rc.1` 链要 `dsh-brand@^0.0.1-rc.1`，npm 拒装）。**必须全量钉 0.1.0-rc.6**。② sdk 三件套里 `dsh-sdk-server` 这个名字不存在，服务端真名 `@deepseek-ai/dsh-sdk-jsonrpc-server`；且它只是协议处理器，**起进程的运行时 bin 在另一个包** `@deepseek-ai/dsh-sdk-jsonrpc-demo`（bin `dsh-jsonrpc-agent`，boot 外部 cordis.yml，README「No built-in or default config exists」）。

### Q2：JSON-RPC 路能否从进程外裁决 tools/pre-execute / approval？

**协议面：不能。证据**（sdk/protocol/src/types.ts:92-110）：

```ts
export interface HarnessSdkNotificationMap {
  'session.event' / 'session.status' / 'subagent.started' / 'subagent.finished'   // 仅 4 个通知
}
export interface HarnessSdkRequestMap {
  'initialize' / 'session/prompt' / 'shutdown'                                    // 仅 3 个方法
}
```

sdk server 的 `handleRequest` switch（sdk/server/src/server.ts:190-201）同样只有这三个 case，default 抛 unknown method。**wire 上没有 approval/pre-execute 的任何方法或通知**（server README「Known Limitations」亦列：无 per-session close、无 prompt-cancel、无 per-prompt result）。

**但治理并未因此死掉**，三层补救都有源码支撑：

1. `tools/pre-execute` 的 `ask` 决策走 ApprovalService（interaction/user-approval/src/index.ts:192+），它是**插件化的 answerer 链**（"composed answerers"，无 answerer 时 fail-closed 拒绝）——我方可以在 harness 进程的 cordis.yml 里挂一个**自定义 answerer 插件**（同进程，经我们自有的 backchannel 如 HTTP 回调 agentcore 的规则引擎），把裁决桥出进程。插件是我们写的，部署在 harness 侧。
2. dsh 自家的 Host（host/apiproxy/src/api/approvals.ts）就是这么干的：approval requested 是 server-request 帧，答案走 `POST /api/respond` 回——**官方自己也是"进程内服务 + 带外回答通道"的模式**，证明该模式是一等公民而非 hack。
3. pre-execute 的 allow/deny（非 ask）本来就是我方规则引擎的判定逻辑，可直接编译进 harness 侧网桥插件，无需出进程。

结论修正原方案措辞：JSON-RPC 路的治理面 = 「harness 进程内挂我方网桥插件 + 带外通道回 agentcore」，不是「纯协议裁决」。这在路 B 下成立，但意味着 **harness 侧的 cordis.yml 与网桥插件成为我方部署物**，路 B 的「窄接口」实际宽度 = 7 个协议方法 + 一个插件部署面。

### Q3：同进程路真实耦合面

- **路 A（8 包同进程）**：钉 0.1.0-rc.6 后 `npm install` RC=0，**闭包 21 包**（package-lock 实测），`@deepseek-ai` 下 19 个 + `@standard-schema` + 嵌套 schemastery/cosmokit。**Cordis 是以 `@deepseek-ai/cordis` 名义发布的 npm 包**（非 git submodule；dsh 仓内是 vendor/ 目录，npm 上正常发布）。ESM 全量 `"type":"module"`，Node v24.13.0 直跑无转译。
- **路 B（sdk 三件套 + jsonrpc-demo bin + agent-loop）**：RC=0，**闭包 38 包**。
- 两侧都**零原生模块**（安装日志无 node-gyp/prebuild）。
- 我方 pnpm 仓共存未实测（S0 范围只许 /tmp 裸装）——这是 S1 的第一件事，已写入 §7 中止条件。

## 4 · S0-b 两路冒烟证据（/tmp 裸脚本，mock LLM，零真 key）

### 路 A（同进程）— ✅ 一次跑通

脚本 `/tmp/dsh-s0-a/smoke.mjs`（组合形态照抄 agent-loop 自带测试 `tests/loop.spec.ts` 的 harness()）：`new Context()` → LlmRuntime/SessionStore/SystemPrompt/ToolRuntime/AgentRegistry/AgentLoop 六个插件 → `registerAdapter(['mock'], 剧本适配器)` → 注册 echo_tool → `ctx.agentLoop.create(SessionId, {provider:'mock',model:'mock'})` → followup → `whenIdle()`。

输出原文（RC=0）：

```
SMOKE_A_EVENTS=["agent/inbox/spliced","turn/start","agent/inbox/spliced","step/start",
 "user/message","request/header","request/context","assistant/chunk"×6,"assistant/message",
 "tool/call","tool/result","step/end","step/start","assistant/chunk"×5,"assistant/message",
 "step/end","turn/end"]
SMOKE_A_REQUESTS=2
SMOKE_A_OK
```

剧本含一轮工具调用 + 一轮文本收尾：工具循环、事件流、quiescence 信号全部按预期。

### 路 B（JSON-RPC）— ✅ 跑通（修 3 处后）

环境：`@deepseek-ai/dsh-sdk-jsonrpc-demo` 的 bin + 自写 `/tmp/dsh-s0-b/cordis-b.yml`（sdk-jsonrpc-server + llm/session/system-prompt/tools/agent/agent-loop + 两个本地相对路径插件 `./mock-llm.mjs` `./echo-tool.mjs`）。客户端 `@deepseek-ai/dsh-sdk-client` 的 `DeepSeekHarness`，provider/model 走 `mock`。

最终输出（RC=0）：

```
TYPES=[与路 A 完全一致的 24 帧事件序列]
TURN_END={"turn":1,"reason":{"kind":"completed"}}
FINAL="final answer from dsh jsonrpc loop"
```

**过程卡点全记录**（附错误原文摘要，均真实修复非绕路）：
1. `TypeError: adapter.providerInfo is not a function`（dsh-llm/lib/index.js:987 prepareRoutes）→ 裸对象缺方法，补 `providerInfo`。
2. `adapter.providerRetryPolicy is not a function`（同文件 :990）→ 补 `providerRetryPolicy: () => undefined` + `listModels`。
3. turn 以 `{"kind":"error","error":{"message":"adapter returned invalid exact model metadata...","code":"INVALID_MODEL_INFO"}}` 收尾 → `resolveModel` 必须返回完整 `{provider, id, name}`（校验在 llm/src/index.ts:627-645，id 必须等于请求 model、provider 必须回显路由名）。**这三次报错暴露一个文档没写的事实：LlmAdapter 名义上「唯一必需方法 stream」，实际上 registerAdapter + 请求路径共调 5 个方法（providerInfo/providerRetryPolicy/resolveModel/listModels/stream），前四个不实现就分别在装配/请求期炸。写自定义适配器（我方 mock 或未来的私域模型适配）必须五件套齐。**

金丝雀自证：macOS 无 `timeout` 命令（RC=127 已弃用该写法）；所有命令均 `out=$(cmd 2>&1); rc=$?` 显式取码。

## 5 · 两路对照 + 推荐

| 维度 | 路 A（同进程 8 包） | 路 B（JSON-RPC SDK） |
|---|---|---|
| 冒烟 | ✅ 一次通 | ✅ 修 3 处接口后通 |
| 事件流保真 | 完整 24 帧直读 | **逐帧一致**（经 session.event 通知透传，无丢失） |
| 上游破坏兼容时 | agentcore 编译/运行炸 | 协议适配层报错，agentcore 照跑 |
| 治理接线（E2/E3′） | 进程内 listener 直挂 | 需 harness 侧网桥插件 + 带外通道（§3.Q2） |
| Answer 重组装（S3 最大头） | 直接拿对象 | 过序列化，从 session.event 帧重建 |
| 租户隔离 | 无进程边界，全靠外壳纪律 | **可按租户隔离实例/HOME**（进程边界天然存在） |
| 部署物 | 无新增 | cordis.yml + bin 进程 + 网桥插件（我方新运维面） |
| 闭包 | 21 包进 agentcore node_modules | 38 包在独立目录，agentcore 零侵入 |
| 性能 | 优 | 多一跳 stdio 帧（agent 循环量级可忽略） |

**推荐：路 B（JSON-RPC SDK）。**

理由（对应可行性报告选 B 的第一理由，本次实测为它补了实证）：preview 版 0.1.0-rc.6 的 dist-tag 分裂（§3.Q1 坑①）已经演示过「上游说变就变」是什么形态——路 A 下这种漂移直接进 agentcore 的编译期，路 B 下它停在独立目录里。S3（Answer 重组装）是方案自标的最大工作量，让它失败时只炸一个适配层，是这份报告里唯一不可逆风险的最小化。

**反对理由（选 B 各输在哪，不掩饰）**：
- 输给 A 的第一点：**治理接线变间接**。E2（规则闸）在路 B 必须经「harness 侧 answerer 插件 + 带外回 agentcore」，比 A 的进程内 listener 多一个网络面、多一种超时/宕机语义（answerer 缺席 = fail-closed 拒绝，这个默认恰好对我们有利，但延迟与可用性账本要重算）。
- 输给 A 的第二点：**Answer 重组装要过序列化**。`assistant/message` 帧的 ContentBlock 结构要逐类型映射到我方 `Answer.blocks`，路 A 可直接构造。这是 S3 工作量的实差，估多 0.5–1 天。
- 输给 A 的第三点：**新增运维面**。cordis.yml、bin 进程生命周期、会话 JSONL 持久化目录都是我方新部署物；「JSON-RPC 窄接口」的真实宽度 = 7 方法 + 这套部署面（§3.Q2 结论）。

若裁决者认为「preview 期耦合可控、治理直挂的价值大于爆炸半径」，路 A 也是诚实选项——但我的推荐是 B。

## 6 · E6：SSE 词表清单重跑（自带金丝雀，不照抄 WO §4）

**金丝雀先行**：首跑 `grep 'emit("task.accepted"'` RC=1（零命中）——金丝雀即不中：emit 签名是 `emit(taskId, "task.accepted", …)`，事件名是**第二实参**（CLAUDE.md 铁律 0.6 病案 #5 同款）。改模式后金丝雀命中：orchestrator.ts:538。

**PRD §8.2 清单（本树亲抽，正则 `` `[a-z_.]+` `` 过滤后 sort -u）= 9 个事件名**：
`action_draft.created` · `answer.final` · `clarification.required` · `routing.completed` · `step.completed` · `step.started` · `task.accepted` · `task.cancelled` · `task.failed`。
⚠️ **WO §4 写「8 个」漏列了 `action_draft.created`**（它就在 §8.2 表倒数第三行，载荷 `{draftId, actionType}`）。

**实际 emit 清单**（多行容忍抽取 `emit\([^)]{0,200}`，金丝雀 task.accepted 在列）按面拆开：

- **query-task SSE 面**（`deps.events.emit(taskId, …)`，即 §8.2 那个流）实发 15 个：上表 9 个全发 + `routing.degraded` · `coordinator.planned` · `entity.out_of_domain` · `decision.created` · `decision.committed` · `feedback.recorded`（PRD 表外 6 个，与 WO §4 一致）。
- **scenario 面**（`events.emit(scenarioKey, …)` 与 `emitDomainEvent(tenantId, …)`）：`scenario.growth_triggered`/`scenario.matured`/`scenario.gap_detected`/`scenario.published`/`scenario.retired`——**不是 query SSE 流的事件**（server.ts:2883/2959/3068+），WO §4 未混进来，正确。

**step.started 查证结论（WO 点名的对不上处）：实发，两处**——`loop.ts:844`（path-B 每工具调用，`emit("step.started", {stepId: r.toolCallId, type: block.name})`）与 `workflow/executor.ts:112`（路径 A 每步）。WO 的字面量 grep 没抓到的原因大概率是同一坑：它 grep 的可能是 `emit("step.started"` 单参数形态。**E6 的 15 事件词表对 dsh 事件流的可重建性三档判定**：step.started/step.completed/answer.final/task.failed/task.cancelled/routing.completed 等 9 个主事件 = **能**（dsh 有 tool/call、tool/result、assistant/message、turn/end、agent/error 对应帧）；`task.accepted`/`clarification.required` = **能**（orchestrator 壳层自发，不经 dsh）；`agent_narration`/`agent_degraded` 伪 step 载荷 = **需补信息**（narration 可映射 assistant/chunk 文本帧，degraded 的 TIMEOUT/BUDGET/STALL 三态需从 dsh 的 cancel cause + turn/end reason 推导，STALL_LOOP 无直接对应——环检测是我方 loop.ts 自有机制，dsh 无此概念，**重建不了**，须外壳保留或放弃该观测位）；`coordinator.planned`/`decision.*`/`entity.out_of_domain`/`feedback.recorded` = **不适用**（path-A/coordinator 面事件，dsh 替换 path-B 循环不产生也不需产生）。

## 7 · 成功判据补三条落地（WO §4 要求）

- **E3′（负向租户隔离）**：POC 测试中构造「租户 A 的 agent 解析租户 B 的 credentialRef」，断言自定义 CredentialProvider 返回 undefined 且 run 以 MISSING_CREDENTIAL 类错误收尾。实现注：ref 编码 `TENANT_<id>__<KEY>`，provider 按调用 scope 的 tenantId 前缀白名单校验，不匹配即拒——负向断言咬的就是这个前缀检查。
- **E6（词表覆盖率）**：按 §6 三档表逐事件验收，未覆盖项（STALL_LOOP 观测位）显式点名「放弃或外壳保留」，不许只报百分比。
- **E7（中止条件下沉）**：
  - **S1 中止**：dsh 包装进我方 pnpm workspace 后 `pnpm --filter agentcore build` 不能保持 RC=0（依赖冲突解不掉）→ 中止回报。
  - **S2 中止**：harness 侧 answerer 网桥插件在 mock 规则引擎下不能让「deny 规则 ⇒ 工具 execute 零调用」断言变绿（3 次尝试内）→ 中止回报。
  - **S3 中止**：Answer 重组装单测在 3 类 block（text / tool_use 引用 / structured）上跑不绿 → 中止回报。

## 8 · WO 勘误（我这张单写错/漏说的）

1. **「本机是 /home/user/complete」**——容器机路径；本机 macOS 是 `/Users/apple/deploy/complete`。工单若要多机复用，环境段应写「主 checkout 路径以 `git rev-parse --show-toplevel` 实测为准」。
2. **「sdk/server」包名**——npm 上不存在 `@deepseek-ai/dsh-sdk-server`（404 实测）；真名 `@deepseek-ai/dsh-sdk-jsonrpc-server`，且运行时 bin 在 `@deepseek-ai/dsh-sdk-jsonrpc-demo`（examples/jsonrpc-demo）。S0-a Q1 若照工单字面去查会得出「sdk 侧装不了」的假阴性。
3. **PRD §8.2 事件数「8 个」**——实为 9 个，漏 `action_draft.created`。
4. **「step.started grep 没抓到」**——它实发两处（loop.ts:844、executor.ts:112），grep 未中的原因是 emit 的事件名在第二实参；这不是「待查项」，是已结案的 grep 形态问题。
5. **漏说：npm dist-tag 分裂**。`latest` 停在 0.0.1-rc.1 的包占多数，不钉 0.1.0-rc.6 必撞 ERESOLVE。「钉版本」三个字不够，得写「全量钉 0.1.0-rc.6，含传递 peer」。
6. **漏说：LlmAdapter 五件套**（§4 卡点 3）。自定义适配器只实现 stream 会在装配期/请求期连炸四处——这对 S1 的 mock 适配器与我方私域模型适配都是直接成本。

## 9 · 顺带发现（本仓 bug/文档漂移，不修，仅记录）

1. **PRD §8.2 与实现漂移**：实现实发 6 个表外事件（routing.degraded 等），PRD 未收编；且 §8.2 的 `streamUrl` 写 `/api/v1/...` 而实现写 `/b/v1/...`（orchestrator.ts:551，经重写别名等价，但字面不一致）。
2. **CLAUDE.md「演示账号」行**仍写 `base_manager:常州`——seed.ts 实际 username 是 `base_manager`（角色才带「：常州」）。此为上轮部署单已报的派单人错误，本树仍未改。

## 10 · 分支与 sha

- 分支：`claude/handoff-wo-dsh-poc-s0`（本报告 = 本单唯一入仓产物，未碰 apps/**、packages/**、docs/SYSTEM-ONTOLOGY.md）
- 最终 sha：`2e4a0ca8a24eb2f946565f63dfee2d48bd6232a0`；`git ls-remote` 已确认远端同 sha（refs/heads/claude/handoff-wo-dsh-poc-s0）。
