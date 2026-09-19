# AUDIT · Agent 管理页四项能力取证（WO-AGENT-ADMIN-CONSOLE §3）

> **日期**：2026-08-10 · **分支**：`claude/handoff-wo-agent-admin-console`
> **基线**：canonical `65069c61`（`origin/claude/inspiring-gates-aqczjg`）
> **判据**：铁律 0.5 三形态（没接线 / 接了线没数据 / 接了线接错地方），每条给 `file:line`。
> **本文件是取证产物本身**，不是交付说明；「实际做了什么」见 §6。

---

## 0 · 工具自证（铁律 0.6 · 报否定结论前先跑金丝雀）

本审计所有「零命中 / 无承载物 / 无读端」结论，均先跑过一个**已知必中**的样例：

| 否定结论 | 金丝雀（同一条命令、同一份路径集） | 金丝雀结果 |
|---|---|---|
| 「`Retriever/Ranker/Compressor/Assembler/Validator` 在后端零实现」 | 同一条 `grep -rniE` 在同一路径集上找 `ContextBudgeter` | **命中**（`agent/context.ts:312`） |
| 「`agentRuns` 在 `server.ts` 零命中 ⇒ 无 HTTP 读端」 | `grep -c "toolCalls" apps/agentcore/src/server.ts` | **5 命中** |
| 「`decision-trace` 在前端零消费」 | `grep -rc "QueryTask" apps/frontend-shell/src/api/endpoints.ts` | **2 命中** |

同时按铁律 0.6 的「退出码不许取管道末端」执行：否定结论一律用
`out=$(grep …); rc=$?` 取码，**不用** `grep … | head` 后读 `$?`（那恒为 0）。
实测：`out=$(grep -rn "decision-trace" apps/frontend-shell/src); rc=$?` → `rc=1`（真无命中）。

⚠️ **另一处必须自证的地方**：SSE 事件名在 `TaskEvents.emit(taskId, event, payload)` 里是**第二个**实参，
而在 `runAgentLoop` 的 `opts.emit(event, payload)` 里是**第一个**。只按其中一种形状 grep 会漏掉另一半
（CLAUDE.md 铁律 0.6 第 5 例就是这个坑）。本审计两种形状都跑了，结果分别列在 §1。

---

## 1 · Agent Trace —— **接了线接错地方**（另含一处真缺口）

### 1.1 后端确实在发，且发的是真事件

| 位置 | 事件 |
|---|---|
| `apps/agentcore/src/agent/loop.ts:672` | `opts.emit("step.started", { stepId: r.toolCallId, type: block.name })` |
| `apps/agentcore/src/agent/loop.ts:673` | `opts.emit("step.completed", …)` |
| `apps/agentcore/src/agent/loop.ts:518` | `opts.emit("step.completed", …)` |
| `apps/agentcore/src/agent/loop.ts:848` | `opts.emit("step.completed", { type: "agent_narration", … })` |

扇出与落库：`apps/agentcore/src/events.ts:14` `TaskEvents.emit` → `repos.events.append`（**落库**，故可重放）
+ 实时 listener 广播。

以第二种形状（事件名为第二实参）统计出的租户级事件表：
`answer.final ×15 · task.cancelled ×11 · routing.completed ×7 · task.failed ×4 · step.completed ×4 ·
task.accepted ×2 · routing.degraded ×2 · clarification.required · action_draft.created · decision.created ·
decision.committed · coordinator.planned · entity.out_of_domain · feedback.recorded · scenario.growth_triggered`。

### 1.2 读端齐全（三个，全是真的）

| 端点 | 定义 | 内容 |
|---|---|---|
| `GET /api/v1/queries/:taskId/events` | `server.ts:380` | SSE，支持 `Last-Event-ID` 重放（`api/sse.ts:56,69`） |
| `GET /api/v1/queries/:taskId/decision-trace` | `server.ts:426` | 聚合 task/answer/**toolCalls**（`server.ts:431,452`）→ 单一可导出 JSON |
| `GET /api/v1/queries/:taskId/trace` | `server.ts:459` | 10 节点编排 DAG 投影 |

前端别名 `/b/v1/queries/*` → `/api/v1/queries/*` 重写在 `server.ts:118`（`queries` 在重写清单内 ✅）。

### 1.3 前端早就在消费 —— 但**全部挂在查询坞 / 任务详情**，一处都不在 Agent 管理页

`sse/taskStreamReducer.ts:99-100,142-146` · `sse/useTaskStream.ts:26-27` ·
`pages/TaskDetailPage.tsx:110-114` · `components/InferenceProcessDag.tsx:54`。

> WO 提到的 `claude/handoff-wo-fe-agent-trace` 那批（`d0ce56fc`）改的是
> `components/QueryDock/Timeline.tsx` · `components/Dag/taskDag.ts` · `sse/taskStreamReducer.ts` ——
> 同样在**查询坞**。本单**只读复用**（import），**不改**这三个文件，避免与那条分支冲突。

### 1.4 定性

**接了线接错地方**：链路完整、有数据、有读端，缺的只是 Agent 管理页这个挂载点。

### 1.5 ⚠️ 同时存在一处**真缺口**（前端补不了，必须记账）

> **一次运行归不到具体 Agent 头上。**

- `QueryTaskSchema`（`packages/contracts/src/qos.ts:484-524`）**无** `agentId` / `agentKey` 字段。
- `AgentRunRecordSchema`（`qos.ts:711-722`）同样**无** `agentId`：只有 `taskId` / `model` /
  `iterations` / `budget` / `budgetExhausted` / token 数 / `contextOps`。
- 通用探索路 `runPathB` **根本不解析某个 AgentDefinition**：`orchestrator.ts:1852` 直接
  `enterExecuting(… "EXECUTING_AGENT" …)` 进探索模式，工具集由 package 白名单 ∩ {READ,COMPUTE} 决定。
- 唯一绑定 agent 的是角色协调路：`orchestrator.ts:1846` `if (prof?.agentId && await repos.agents.get(prof.agentId))`
  —— 但该 `agentId` **也没写进 run 记录**。

⇒ **「这个 Agent 的历次运行」今天不可得**，只能做「本租户 **AGENT 路径**的历次运行」。
这是本单界面上必须诚实标注的第一条，**绝不允许把租户级运行伪装成某个 Agent 的运行**。

**让它有归属的路径**（交回审核方排期，不在本单范围）：
`AgentRunRecordSchema` 加可选 `agentId`/`agentKey` → `runRolePathB` 与 `runPathB` 各自回填 →
`agentRuns` 增 `listByAgent`。属跨契约+引擎改动，须整单一个 dev 做。

---

## 2 · Execution 状态机 —— **接了线接错地方**（数据、读端、前端取数器全都现成）

| 问题 | 答案 |
|---|---|
| 状态枚举在哪定义 | `packages/contracts/src/qos.ts:269-278` `QueryTaskStatusSchema` = `ROUTING` · `AWAITING_CLARIFICATION` · `EXECUTING_WORKFLOW` · `EXECUTING_AGENT` · `COMPLETED` · `FAILED` · `CANCELLED` |
| 运行期实例存在哪 | `repos.tasks`（`QueryTask.status`，`qos.ts:492`）；memory/pg 双实现 |
| 有没有读端 | **有两个**：`GET /api/v1/queries?limit=`（`server.ts:354`，返回 `status` + `path` + `classification` + 摘要）· `GET /api/v1/queries/:taskId`（`server.ts:414`） |
| 前端有没有取数器 | **有**：`api/endpoints.ts:784-785` `fetchQueryHistory`，契约 `QueryHistoryItem`（`endpoints.ts:771-783`） |
| 今天谁在用 | 只有 `pages/admin/QueryHistoryPage.tsx:68`（推演历史页） |

另有一条**定义级**状态机（与运行态不是一回事，别混）：`AgentDefinition.status`
`qos.ts:186` = `DRAFT | PUBLISHED` —— 这条 AgentsPage 早就在显示了（`AgentsPage.tsx:95`）。

**定性**：接了线接错地方。Agent 管理页从未挂载运行态状态机。

---

## 3 · Context Manager 五段 —— **「五段」无承载物**；真实实现是另一套，且**接了线没数据 + 无读端**

⚠️ 这一项**必须拆成三句说**，合成一句就会修错地方（铁律 0.5 ①）。

### 3.1 `Retriever / Ranker / Compressor / Assembler / Validator` —— **无承载物**

在 `apps/agentcore/src` + `packages/contracts/src` 上跑大小写不敏感的
`grep -rniE "retriev|ranker|compress|assembl|validator"`，**没有任何一处是这五段流水线的实现**。
全仓唯一带这些词的地方是两份**参考原型 HTML 稿**：

- `docs/reference-prototype-decision-platform.html:1074` —— `N("检索Agent","agent","OntologyRetriever",…)`，
  一个图节点的**标签字符串**；
- `docs/demo-推演系统.html` —— 同类演示稿。

`docs/SPEC-industrial-skill.md:369` 里的 `Parser → AST → Validator → Optimizer` 是
**Skill 编译器**的阶段，与 Context Manager 无关（同名不同物，别串）。

⇒ **五段是参考原型里的概念，本仓从未实现，也没有任何端点会下发它。界面上不放占位。**

### 3.2 真实实现叫另一个名字，且是**真的**（`apps/agentcore/src/agent/context.ts`）

| 能力 | 位置 |
|---|---|
| 预算器（软/硬阈值 + 每 2 轮真实 `count_tokens`） | `context.ts:312` `ContextBudgeter`（阈值 `:314-315`，`measure` `:338`） |
| 工具结果截断（8KB · 在最大数组维度截断保结构合法 + 尾注） | `context.ts:99` `truncateToolResultJson` |
| 第 1 刀 · 折叠最旧迭代 | `context.ts:160` `foldOldestFrame`（最近 2 轮永不折叠） |
| 滚动摘要（确定性兜底 / 真 LLM 摘要器） | `context.ts:191` `defaultRollingSummary` · `context.ts:278` `makeLlmRollingSummarizer` |
| 摘要出口锚定防线 + 降级声明 | `context.ts:260` `summaryLooksAnchored` · `context.ts:227` `SUMMARY_DEGRADED_MARK` |

留痕契约：`ContextOpSchema`（`packages/contracts/src/qos.ts:703-709`），
`op ∈ {fold, compact, force_finalize}` —— **三刀，不是五段**。
组装进 run：`loop.ts:423` `...(budgeter.ops.length > 0 ? { contextOps: [...budgeter.ops] } : {})`。
触发分支：`loop.ts:747` `if (tokens > budgeter.softLimit)`；`record()` 调用点
`loop.ts:753 / 766 / 804 / 809 / 832`。

### 3.3 第一件事：**接了线没数据**（默认路阈值够不到 —— 欠账 #91）

`docs/SYSTEM-ONTOLOGY.md:1063`（`G-COMPACT-DROPS-CONSTRAINT` · #91 补记）已实测钉死：

- `softLimit = floor(min(provider maxContext, DEFAULT_MAX_CONTEXT_TOKENS=200_000) × 0.7)`；
- 200k provider（Anthropic 适配器报 `maxContextTokens: 200_000`）⇒ softLimit = **140,000**；
- 而系统**自身预算上界**允许的最坏上下文（`maxToolCalls=40` 条被 8KB 硬截断的 tool_result
  + 27 个工具 schema + 6KB system，按 `estimateTokensChars` 的 chars/3.5 口径）= **102,785 tok**；
- ⇒ **该路上 fold / compact / force_finalize 一次都不会跑，`contextOps` 恒为空数组。**

**但它不是无条件死码**：租户若配 ≤128k 上下文的 provider，softLimit 掉到 89,600 / 44,800 / 22,400
→ 同一份最坏上下文**会**触发。而且 200k 路够不到的**真原因是上游两道防线在正常工作**
（8KB 硬截断 + `maxToolCalls=40`），属设计正确而非缺陷。
该算术已被钉成不变量：`apps/agentcore/test/context-threshold-reachability.test.ts`。

⇒ 界面上**必须**显示真实的 `contextOps` 计数（默认就是 0），并把「为什么是 0」写进 `?` 浮层。
**绝不允许**画一个有五个方块在流动的假流程图。

### 3.4 第二件事：**没有 HTTP 读端**（这是本单唯一动后端的理由）

- 写入方 3 处（真在写）：`orchestrator.ts:2075 / 2364 / 2614` `repos.agentRuns.insert(result.run)`。
- 仓储双实现齐备：`persistence/memory.ts:180-185` · `persistence/pg.ts:267-277`
  （`getByTask(taskId)` 已存在，**不需要新增仓储方法**）。
- **读端：零。** `out=$(grep -n "agentRuns" apps/agentcore/src/server.ts); rc=$?` → `rc=1`
  （金丝雀：同文件 `toolCalls` 5 命中 ⇒ 工具是好的）。
- 全仓唯一 src 消费方是 `apps/agentcore/src/evals.ts:237`，且**只取 token 数**（`:238`）——
  `iterations` / `budget` / `budgetExhausted` / `contextOps` 这四项**写进库后从没有任何人读过**。
- 仅有的旁路出口是 Prometheus：`metrics.ts:134` `ac_context_ops_total` + `server.ts:207 GET /metrics`
  —— 那是**运维口径、无租户隔离**，不能当管理页数据源。

⇒ 形态是 **写了没人读**（三形态里最接近「接了线接错地方」：线接到了库，就是没接到 HTTP 面）。
按 WO §1「仅在确认某数据后端根本没下发时补下发」，本单补一条**只读**端点。

---

## 4 · Decision Replay —— **有承载物**，且是两种不同的「重放」（都不在 Agent 页）

| 含义 | 承载物 | 位置 |
|---|---|---|
| **A · 事件重放**（把这次跑的事件流按序重播） | `Last-Event-ID` 从 `query_events` 重放 | `api/sse.ts:56,69` · `events.ts:33 replayAfter` · 前端重放表 `pages/TaskDetailPage.tsx:22,98` |
| **B · 二次推演**（拿原问句重新跑一遍） | 重新 `submitQuery` | `pages/admin/QueryHistoryPage.tsx:18-26,74-76` |

**定性**：接了线接错地方 —— 两种重放都实现了、都有数据，但入口都在推演历史/任务详情页。

**诚实边界**：这两者都**不是**「决策重放」的强形态（同参数版本重跑并 diff 两次结论）。
本仓没有承载物做那件事，本单**不做也不画**。

---

## 5 · 结论表（四项定性汇总）

| # | 能力 | 定性 | 关键 file:line | 本单处置 |
|---|---|---|---|---|
| 1 | Agent Trace | **接了线接错地方** | `loop.ts:672-673` 发 · `server.ts:380/426/459` 读 | ✅ 接到 Agent 页 |
| 1b | ↳ 运行归属到具体 Agent | **无承载物** | `qos.ts:484-524` / `qos.ts:711-722` 均无 `agentId` | ⚠️ 界面诚实标注 + 交回排期 |
| 2 | Execution 状态机 | **接了线接错地方** | 枚举 `qos.ts:269-278` · 读端 `server.ts:354` | ✅ 接到 Agent 页 |
| 3a | Context Manager **五段** | **无承载物** | 仅 `docs/reference-prototype-decision-platform.html:1074` 标签 | ❌ 不画、不放占位 |
| 3b | ↳ 真实三刀（fold/compact/force_finalize） | **接了线没数据**（#91 阈值够不到） | `loop.ts:747` 分支 · `SYSTEM-ONTOLOGY.md:1063` | ✅ 显示真计数(0) + `?` 说明为什么 |
| 3c | ↳ 三刀留痕的 HTTP 读端 | **写了没人读** | 写 `orchestrator.ts:2075/2364/2614` · 读端 0 | ✅ 补只读端点 |
| 4 | Decision Replay | **接了线接错地方** | `api/sse.ts:69` · `QueryHistoryPage.tsx:18-26` | ✅ 复用既有入口（跳转，不重造） |

**四项里没有一项是「后端全空」**，所以本单不顶回；但**两项（1b / 3a）无承载物，界面上一个像素都不给**。

---

## 5.5 · 取证之外、动手时才浮出来的两条（都已处置）

这两条 grep 阶段看不见，是**亲手把链路跑一遍**才撞上的 —— 记在这里，因为它们都改变了界面该怎么写。

### 5.5.1 AGENT 路 **不等于** 有运行记录（诚实态是常态，不是异常）

实测（起 `dist/main.js` on :4102，真 submit 一条自由问句）：
task 得到 `path=AGENT` + `status=COMPLETED`，而 `/agent-run` 返 **404**。

追一层就清楚了：未接 LLM provider 时 `completeNoLlmDegradation`
（`router/orchestrator.ts:2656`）把 task 标成 `path: "AGENT"` + `COMPLETED`
并直接给一句诚实答复，**从不 `agentRuns.insert`**。

⇒ **全新部署 / 未绑定 provider 的环境，AGENT 路运行全都没有 run 记录。**
界面若把 404 当"加载失败"，仓主看到的就是一片红；若渲染成 0/0/0，那是编造的运行数据。
故本单把它做成第三态（`AgentRunProbe.NO_RUN`），显示「本次未进入 Agent 循环」+ 去绑定 provider 的路，
**且刻意不渲染统计块**（测试 ⑤ 专咬这一点，变异反证已验：渲染成全 0 即红）。

### 5.5.2 mock 与真后端形状不一致（`path: "PATH_A"`）—— 已修

`mocks/handlers.ts` 的 `GET /b/v1/queries` 此前返回 `path: "PATH_A"`，
而契约枚举只有 `WORKFLOW | AGENT`（`packages/contracts/src/qos.ts:493`），
真端点返 `t.path ?? null`（`agentcore/src/server.ts:366`）。

**后果不是抽象的**：任何按 `path` 过滤的消费方在 mock 模式下都读到**空集**。
本单的运行观测台正是第一个按 path 过滤的消费方，所以它一写就撞上了 ——
在此之前没有消费方，于是这个错值三个多月没人发现。

已改正为 `WORKFLOW`，并补两条 AGENT 路种子（一条引擎真跑过、一条走 5.5.1 的诚实降级），
新增 `decision-trace` / `agent-run` 两个 handler。
**防复发**：前端测试里 mock 载荷一律先用 `AgentRunRecordSchema` / `DecisionTraceSchema`
`parse()` 一遍再交给 MSW —— 真后端也是 `Schema.parse(...)` 之后才下发，
故「mock 能过 schema」⇒「mock 形状 = 真后端形状」，形状漂了当场红。

---

## 6 · 本单实际做了什么（与上表逐条对应）

1. **`GET /b/v1/queries/:taskId/agent-run`**（`apps/agentcore/src/server.ts`）——
   把已落库、已有 `getByTask` 仓储方法、却从无 HTTP 面的 `AgentRunRecord` 下发。
   零新增仓储方法、零新增契约字段，**纯读**；无记录返回 404 `AGENT_RUN_NOT_FOUND`。
2. **AgentsPage 新增「运行观测」区**（第一层只放数值/状态/名字）：
   本租户 AGENT 路径运行数、状态分布、最近运行列表。
3. **第二层**（点开一次运行）：执行状态机 + 工具调用（`decision-trace`）+
   上下文工程真实计数（`agent-run`）。
4. **`?` 浮层**：阈值公式、`contextOps` 为何为 0、运行归属为何缺失。
5. **诚实位**（全部可见、不删）：
   - 「本列表是**本租户 AGENT 路径**的运行，**不是本 Agent 的运行**」——
     附原因（`AgentRunRecord` 无 `agentId`）与消除路径；
   - 「上下文清理 0 次」附 #91 的真实原因，而非留白；
   - 「本次未进入 Agent 循环」（见 §5.5.1）+ 去绑定 provider 的路，**且不渲染统计块**；
   - Context Manager **五段不渲染**（无承载物 ⇒ 不放占位）。

### 6.1 · 验证输出（两向都贴，绿测试≠能用）

**后端** `apps/agentcore/test/agent-run-readsurface.seam.test.ts` —— **4/4 绿**，
且刻意不走「`repos.agentRuns.insert` 造记录再读」那条捷径（那只证明仓储会存会取），
而是 **真 submitQuery → 真 runPathB → 真 runAgentLoop → 真 insert → 真 HTTP 读**。

**前端** `apps/frontend-shell/test/agent-admin-console.test.tsx` —— **13/13 绿**，
每条断言配一条变异反证（改后端数据 → 界面必须跟着变）。

**变异反证（5 条，全部真红 —— 证明测试咬的是链路不是形状）**：

| # | 变异 | 结果 | 红在哪 |
|---|---|---|---|
| B1 | 端点改返「schema 合法但**捏造**的空记录」 | 🔴 2 红 | `expected 'run_fake' to be 'run_01KZ…'` · `expected 0 to be greater than 0` |
| B2 | 去掉端点的租户校验 | 🔴 1 红 | `expected 200 to be 404`（越租户读到了别家的 run） |
| F1 | **植入假的五段流程图**（WO 说会整单退回的那种） | 🔴 1 红 | `expected '…' not to contain 'Retriever'` |
| F2 | 无 run 时编一份全 0 的统计块（"总得有东西看"） | 🔴 1 红 | `expected <div class="_stats_…"> to be null` |
| F3 | KPI 写死成「全部成功」 | 🔴 1 红 | `expected '0次' to contain '1'` |

五条变异全部**当场真红**，回滚后 `git diff --stat` 为空、13/13 与 4/4 各自复绿。

**深浅主题**：新增 CSS **零硬编码颜色**
（`grep -nE "#[0-9a-fA-F]{3,8}|rgba?\("` 于 `AgentsPage.module.css` → 无命中；
金丝雀：同文件 `var(--` **62 命中** ⇒ 工具是好的）。
所用结构 token（`--bg2/--panel2/--line/--line2/--txt/--muted/--muted2/--accent/--hover-tint*/--popover-surface`）
在 `:root[data-theme="light"]` 与 `[data-theme="warm"]` 均有重定义；
状态色（`--ok/--warn/--amber/--danger/--on-accent`）刻意主题不变，
与既有 `.badge.green/.amber/.red`（`global.css:119-133`）**同一套约定**，不另开分身。

**typecheck**：`agentcore` 0 错；`frontend-shell` 仅剩 **2 条基线既有**错误
（`test/chain-impediments-route.test.tsx:48` · `test/sim-event-invalidation.seam.test.ts:32`），
已 `git stash` 比对确认与本单无关，本单**新增 0 条**。`frontend-shell build` 通过。

---

## 7 · 本体引用与影响

- **对象类型**：不新增。触及既有 `QueryTask` / `AgentRunRecord` / `AgentDefinition`（**只读**，零字段变更）。
- **链路**：不改编排链路。新增的是一条**读投影**：
  `repos.agentRuns.getByTask` → `GET /b/v1/queries/:taskId/agent-run` → AgentsPage 运行观测区。
- **事件**：不新增、不改名。复用既有 `step.started` / `step.completed` / `routing.completed`。
- **不变量**：
  - **R14（应用层无业务常数）** —— 新增文案一律进 `locales/zh.ts`，页面不内联；
    阈值数字（140,000 / 102,785）只出现在 `?` 浮层的**口径说明**里，且标明来源 `SYSTEM-ONTOLOGY.md:1063`，
    不参与任何计算。
  - **tenant_id everywhere** —— 新端点先 `auth(req)` 再校 `task.tenantId !== a.tenantId → 404`，
    与同文件既有三条 trace 端点同形（`server.ts:430/463`）。
- **断点**：
  - 新登记 `G-AGENTRUN-NO-READ-SURFACE`（**本单闭合**）：`AgentRunRecord` 四个字段写进库后零读端。
  - 新登记 `G-AGENTRUN-NO-AGENT-ATTRIBUTION`（**本单不闭合·交回排期**）：运行无法归属到 Agent 定义。
  - 新登记 `G-MOCK-PATH-ENUM-DRIFT`（**本单闭合**，见 §5.5.2）：前端 mock 的 `path` 取值
    （`PATH_A`）不在契约枚举内，三个多月无人发现 —— 因为在本单之前**没有任何消费方按它过滤**。
    这是「接了线没消费方所以错值不显形」的一个实例。防复发机制已落地（测试内 `Schema.parse` mock 载荷）。
  - 沿用 `G-UI-FIRSTLAYER-OVERLOAD`（信息第一层过载）—— 新增区块按 §5 分层规范做。
  - 沿用 #91 / `G-COMPACT-DROPS-CONSTRAINT` 的触发面结论，**不调阈值、不加旋钮**，只把它显示出来。
