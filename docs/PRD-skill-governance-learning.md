# PRD · 工业级 Skill 治理与学习闭环（SPEC §1-⑫ 落地）

| 项 | 值 |
|---|---|
| 版本 | v1.0 |
| 基线 | 分支 `claude/inspiring-gates-aqczjg` @ `f1a37a7e`（本文所有 `file:line` 均以此提交为准） |
| 上游 | `docs/SPEC-industrial-skill.md`（§1-⑫ Governance & Learning · §8 SDK 两处前置）· `docs/PRD-addendum-skill-authoring.md`（编写规范与两道发布门） |
| 解决问题 | SPEC 判 ⑫「有传感器·无执行器」。本文把「治理」与「学习」两件事分别落成**可校验的机制**：per-Skill 的 data/tool/action 三面权限（与 entitlement **一处判定**）· 可复盘的 Execution Trace（含 Prompt 版本）· 建在**正确且不裸奔**的指标上的学习闭环 · 生长回路的**人在回路审批位** |
| 范围边界 | 只写 Skill 的**治理面与学习面**。Skill 的编写规范/发布双门归 `PRD-addendum-skill-authoring.md`；Skill 包结构/编译器/SDK/运行时归 SPEC §6–§8 的姊妹 PRD；不重复定义规则 DSL / 求解器 / 工作流引擎（SPEC §5「引用而非内联」） |
| 纪律 | 本文所有「今天是 X」的断言必须带 `file:line` 或可复跑命令；核实不了的一律写「未核实」并列入 §9 |

---

## 0. 本体引用与影响

> 依 `CLAUDE.md` 铁律 0 与 `pnpm prd:check` 结构化门要求填写。本节只引用 `docs/SYSTEM-ONTOLOGY.md` 真实存在的编号（§5 R1–R18 · §8 G-1..G-12 数字断点）；命名断点（`G-ACTION-NOOP-EXEC` 等）在正文按名引用。

### 0.1 触及对象类型（本体 §2）

| 对象类型 | 域 | 本文动作 |
|---|---|---|
| `Skill`（§2.H · `packages/contracts/src/agentcore.ts:236`） | D7 编排域 | **扩** `permissions`（data/tool/action 三面）· `promptRefs`（Prompt 版本引用） |
| `SkillReference`（`packages/contracts/src/agentcore.ts:219`，kind 枚举 `:216`） | D7 | **扩 kind**：新增 `tool` / `mcp` / `actionType`（今天只有 rule/constraint/slice/ontologyType/solver/skill/workflow/agent） |
| `Feature / Entitlement`（§2.G · `packages/contracts/src/features.ts:10`） | D6 权限域 | **扩** `bindings.skills[]`——skill 的开关判定复用同一 `FeatureDef`，不另起第二套 |
| `PromptTemplate`（`packages/contracts/src/prompt-template.ts:22`） | D11 治理元域 | **扩** `PROMPT_KEYS` 覆盖 agent 侧核心 prompt；新增内容指纹 `digest` |
| **`SkillExecutionTrace`（新）** | D7↔D11 | 新增一等对象：一次 Skill 参与的执行的可复盘快照（Skill 版本 / Prompt 版本 / 工具调用 / 求解器结果 / 人工反馈） |
| **`SkillOutcomeStat`（新·纯聚合非表）** | D11 | 学习权重归集，形态复用 `DecisionOutcomeStat`（`packages/contracts/src/decision-kernel.ts:59`） |
| **`HumanCorrection`（新）** | D5 行动域 | 记录「AI 提议值 → 人工改后值」的**差量**——今天 `ActionDraft.payload` 提交后不可变（`packages/contracts/src/actions.ts:46`）、`ApprovalStep` 只有 APPROVE/REJECT（`:19`），这条通道不存在 |
| `ActionDraft / ActionType / ApprovalStep`（§2.D） | D5 | **扩** `ActionDraft.origin` 加 `skillKey/skillVersion`（今天 origin 只有 taskId/agentId/userId，`packages/contracts/src/actions.ts:47`）→ 人工采纳率才能归因到 Skill |
| `GapReport / GrowthTicket / GrowthLedgerEntry`（§2.H） | D7↔D11 | 生长回路补**人在回路审批位**（经 Action，非直写目录） |
| `EvalCase / EvalRunReport`（§2.H · `apps/agentcore/src/evals.ts`） | D11 | 复用为 Evaluation 技术面数据源；补业务面/质量面 |
| `Metrics`（`apps/datacore/src/metrics.ts` · `apps/agentcore/src/metrics.ts`） | D9/D11 | **P0 硬前置**：补租户维 + `/metrics` 鉴权 |

### 0.2 触及链路（本体 §3 / §10.3 切片）

- `sys.orch.query_to_answer`（D7 中枢链）：`Client→Query→Intent→Plan→Step*→{Solver|Slice|Rule}→AnswerBlock→SSE`。本文在这条链上**加一条平行的留痕支路** `→ SkillExecutionTrace`，不改主链形状。
- `sys.access.entitlement`（D6）：`Feature→{endpoint,view,solver}(门控,先于authz)`。本文**扩为** `Feature→{endpoint,view,solver,skill,tool,actionType}`——这是「一处判定」的落点。
- `sys.action.writeback`（D5）：`ActionType→ActionDraft→approval→ObjectInstance(props)→Derivation(二次)`。学习闭环若要改生产配置，**必须挂在这条链上**（R4 红线）。
- `sys.meta.change_loop`（D11）：`Requirement(PRD)→Ontology→Code→回写→门禁→Release`。本文新增的门须回写本体 §7。
- **新增链路**：`Skill --requires--> {tool|mcp|actionType}`（权限三面的 tool/action 半）· `Skill --traced--> SkillExecutionTrace --aggregates--> SkillOutcomeStat --consumedBy--> skill-router 排序`。
- **新增链路**：`GapReport(NO_INTENT) --proposes--> ActionDraft(生长提案) --approval--> Intent(PUBLISHED)`（生长回路的人在回路补齐）。

### 0.3 触及事件（本体 §4）

| 事件 | 新/旧 | 生产者 | 失效下游 |
|---|---|---|---|
| `skill.published` | 旧（L4） | `/b/v1/skills/:id/publish` | agent-editor.skill-bindings, skill-list |
| `growth.gap_detected` / `growth.fill_proposed` / `growth.ticket_opened` / `growth.converged` | 旧（L13） | 生长回路 | growth-ledger, growth-tickets |
| `action.pending_approval` / `action.executed` | 旧（L5） | Action 审批链 | approval-inbox, dashboard |
| `feedback.recorded` | **旧但未登记**（`apps/agentcore/src/router/orchestrator.ts:2421` 真 emit，`apps/agentcore/src/event-subscriptions.ts` 零命中） | 路径 A 反馈投票 | ⚠ 违 R10/D-29——本文补登记 |
| `skill.trace_recorded` | **新** | SkillExecutionTrace 落库 | skill-traces, skill-quality |
| `skill.correction_recorded` | **新** | 人工修正差量落库 | skill-outcome-stats, skill-traces |
| `growth.proposal_submitted` / `growth.proposal_approved` | **新** | 生长提案进/出 Action 审批链 | growth-tickets, approval-inbox, intent-catalog |

### 0.4 触及不变量（本体 §5）

- **R2 tenant_id everywhere** — 本 PRD 的**头号驱动**。今天可观测面整体缺租户维：`grep -rn "tenant" apps/datacore/src/metrics.ts apps/agentcore/src/metrics.ts` **零命中**；`grep -rnE "inc\(\s*\{[^}]*tenant" apps/datacore/src apps/agentcore/src --include=*.ts` 亦**零命中**。R2 在仓储/事件/缓存键上成立，唯独在指标上不成立。
- **R3 entitlement 先于 authz** — Skill 权限三面必须与 `FeatureDef.bindings` **同一判定函数**（`apps/agentcore/src/features/registry.ts:187 featureEnabled`），杜绝「意图开着 Skill 关着」的半开态。
- **R4 真值经 Action 审批** — 本单红线。学习闭环产生的任何**生产配置变更**（发布意图 / 调 Skill 参数 / 改权限）一律经 `ActionDraft→approvalChain→EXECUTED`，不许直写。
- **R6 确定性** — Trace 的 Prompt/Skill 版本解析、OutcomeStat 聚合、权限判定全为纯函数；同输入同输出，不取 `Date.now()`（时钟由调用方注入，仿 `ResourceQualityService.record` 的 `nowIso` 形态，`apps/agentcore/src/dril/quality.ts`）。
- **R7 错误信封统一** — 权限拒绝复用既有码：entitlement 关 → 404 `FEATURE_NOT_FOUND`；工具越界 → `AGENT_SCOPE_VIOLATION`（`apps/agentcore/src/tools/executor.ts:136`）。
- **R9 仓储双实现** — `skill_execution_traces` / `human_corrections` 两张新表须 migrations + `repo/pg.ts` + `repo/memory.ts` + 接口四处同改。
- **R10 D-29 数据流闭环** — 三个新事件必须进 `event-subscriptions.ts` 并有下游订阅；顺带补 `feedback.recorded` 的登记缺口。
- **R13 结论可溯源** — Trace 是 R13 在「AI 行为」维的对称物：结论的数字可溯源，产出结论的**过程**也必须可溯源（哪版 Skill / 哪版 Prompt / 哪些工具 / 哪个求解器结果）。
- **R14 应用层无业务常数** — 权限声明、指标口径、Trace 字段一律不得内联行业实体名。
- **R16 发育闭环** — 生长回路的「二分处置」纪律（AUTO-DERIVE 自动生成 / NEEDS-HUMAN 自动开票，绝不静默残缺）在本文延伸为：**AI 可以起草，人必须签字**。

### 0.5 触及门禁（本体 §7）

| 门 | 新/旧 | 作用 |
|---|---|---|
| Skill 发布双门（结构 lint + 评测门禁，运行态非 `pnpm gates`） | 旧 | 本文新增的 `permissions` 引用可解析性并入**门禁一** |
| `action-wiring:check` | 旧 | 生长提案新增的 ActionType 须显式归入 WIRED/NO_WRITE/NOT_IMPLEMENTED |
| `ontology-writeback:check` | 旧 | 本文新增门必须回写本体 §7，否则红 |
| `prd:check` | 旧 | 本文 §0 入图 `docs/prd-ontology-index.json` |
| **`metrics-tenant:check`（新）** | 新 | 静态断言所有业务计数器带 `tenant` 标签 + `/metrics` 不在任何公开路径集里（P0 前置防回潮） |
| **`skill-permission:check`（新）** | 新 | 静态断言 skill 权限判定**只有一个出口**（复用 `featureEnabled`），且 `permissions` 引用的 tool/actionType key 真已注册 |
| **`growth-hitl:check`（新）** | 新 | 静态断言生长回路对目录的写入口全部经 Action 审批 + 角色门，无旁路直写 |

### 0.6 触及断点（本体 §8）

| 断点 | 关系 |
|---|---|
| **G-8**（数据构建闭包不验全链） | 本文的 Trace + 权限引用校验把「Skill 声明的工具/动作是否真存在」纳入闭包，**继续收窄** G-8 的跨系统面 |
| **G-9**（场景卡未走 R16 发育闭环 · 上架靠浅门） | 生长回路的人在回路审批位是 G-9「AUTO-DERIVE / NEEDS-HUMAN 二分」的补齐，**部分收窄** |
| `G-ACTION-NOOP-EXEC`（命名断点） | 学习闭环的「人工采纳率」若把 `NOT_IMPLEMENTED` 动作的 EXECUTED 算成「采纳成功」，学到的就是假的 → §7 明确排除口径 |
| `G-SKILL-UNREACHABLE-FREE-QA`（命名断点，已闭） | 已闭的接线（`agent.skill-on-free-qa` 暗发）是本文权限三面必须覆盖的**第二条路径**——不能只治注册 agent 路 |
| `G-LLM-BUDGET-NO-CONSUMER`（命名断点，已闭） | 本文反复引用其教训：**任何新增声明必须同单接上消费方**，否则就是第二个 #92 |
| **`G-SKILL-PERM-NO-TOOL-ACTION`（本文新登记）** | 🔴 per-Skill 无工具/动作权限（详 §1.1） |
| **`G-TRACE-NO-PROMPT-VERSION`（本文新登记）** | 🟡 执行痕迹无 Prompt 版本（详 §1.2） |
| **`G-METRICS-CROSS-TENANT-AND-OPEN`（本文新登记）** | 🔴 指标跨租户混算 + `/metrics` 无鉴权（详 §1.3，P0 硬前置） |
| **`G-GROWTH-WRITE-BYPASSES-GATE`（本文新登记）** | 🔴 生长回路写目录绕过 `catalog_admin` 角色门（详 §1.4——这是对 SPEC「只报不写」判断的**订正**） |

### 0.7 回写清单（本体不回写即过期失效）

实现落地后必须回写 `docs/SYSTEM-ONTOLOGY.md`：
1. §2.H 新增 `SkillExecutionTrace` / `SkillOutcomeStat` / `HumanCorrection` 三个对象类型条目。
2. §2.H `Skill` 条目补 `permissions` 三面字段；`SkillReference` 补 kind 扩容。
3. §3 / §10.3 `sys.access.entitlement` 切片补 skill/tool/actionType 门控面。
4. §4 事件表补 `skill.trace_recorded` / `skill.correction_recorded` / `growth.proposal_submitted` / `growth.proposal_approved`，并补登 `feedback.recorded`。
5. §7 登记 `metrics-tenant:check` / `skill-permission:check` / `growth-hitl:check`（否则 `ontology-writeback:check` 红）。
6. §8 登记四个新断点，并在闭合后逐条标 ✅。

---

## 1. 问题陈述 · AS-IS 实证

> 判定口径沿用 SPEC §2：**「已有」= 机制在且有真消费方**；「有机制无消费方」单列 ⚠。

### 1.1 权限：data / tool / action 三面——tool 与 action 两面为 🔴 真缺口

**今天有什么（三层，均**不**是 per-Skill 的）：**

| 层 | 机制 | 锚点 | 粒度 |
|---|---|---|---|
| data | A6 行级过滤 | 本体 §7「A6 行级过滤（query/slice/solver 读出）」 | per-User/Role |
| data | Agent 对象类型 scope | `apps/agentcore/src/tools/executor.ts:139-152`（`scopeObjectTypes` 越界 → `AGENT_SCOPE_VIOLATION`） | per-Agent（且 **opt-in**，仅 Coordinator 角色扇出置，见 `apps/agentcore/src/engine.ts:110`） |
| tool | Agent `scopeDeclaration.toolNames` | `apps/agentcore/src/tools/executor.ts:135-137` | per-Agent |
| feature | entitlement | `apps/agentcore/src/features/registry.ts:187 featureEnabled` / `:201 intentAllowed` / `:213 solverAllowed` | per-Tenant/Role × {intent, solver, view} |

**今天没有什么：**

1. `SkillDefinitionSchema`（`packages/contracts/src/agentcore.ts:236-261`）**无任何权限字段**——15 个字段里没有 permissions / tools / actions / objectTypes。
2. `SKILL_REFERENCE_KINDS`（`packages/contracts/src/agentcore.ts:216`）= `["rule","constraint","slice","ontologyType","solver","skill","workflow","agent"]` —— **没有 `tool`、没有 `mcp`、没有 `actionType`**。即「这个 Skill 能用哪些工具、能发哪些 Action」在契约层**无处可写**。
3. `FeatureDef.bindings`（`packages/contracts/src/features.ts:16-22`）= `{intents, solverKeys, apiTags}` —— **没有 `skills`**。故 entitlement 关一个功能，**关不掉挂在它上面的 Skill**。
4. 自由问答路径的技能池 `selectTenantSkills`（`apps/agentcore/src/router/orchestrator.ts:232-240`）只按 `status==="PUBLISHED"` + 取最高版本筛选，**不过 entitlement**。
5. 唯一存在的 Skill→工具关联是**写模式判定**：`isWriteModeSkill`（`packages/contracts/src/agentcore.ts:201`）决定是否给 `create_action_draft`（探针侧 `apps/agentcore/src/skill-probe.ts:249-257`）。这是「是否给唯一写出口」的**布尔开关**，不是「能发哪些 Action」的权限表——它管不了「这个 Skill 只允许发 `adopt_mitigation`，不允许发 `定稿月度计划版本`」。

**为什么这是红的（而不是「加个字段就行」）：** 一个 Skill 今天能做什么，等于它**碰巧被挂在哪个 Agent 上**。同一个 Skill 挂到 scope 宽的 agent 上就能调全部工具；`agent.skill-on-free-qa`（`apps/agentcore/src/features/registry.ts:120`，暗发 `defaultOn:false`）开启后走的是租户级技能池，**连 agent 这层间接约束都没有**。权限的主语错了——治理的对象应该是能力单元本身。

> 登记为 **`G-SKILL-PERM-NO-TOOL-ACTION`**（🔴）。

### 1.2 Execution Trace：有 events + provenance + agentRuns，但 Prompt 无版本

**今天有什么：**

| 面 | 载体 | 锚点 | 覆盖 |
|---|---|---|---|
| 工具调用 | `ToolCallRow` | `apps/agentcore/src/persistence/repos.ts:38-48` | ✅ toolName/input/output/outcome/durationMs；⚠ **无 tenantId**（靠 taskId 关联） |
| Agent 运行 | `AgentRunRecord` | `packages/contracts/src/qos.ts:655-667` | ✅ model/iterations/budget/tokens/contextOps；🔴 **无 skill 版本、无 prompt 版本** |
| 数字溯源 | `ProvenanceRef` | `packages/contracts/src/qos.ts:320-350` | ✅ toolCallId/toolName/outputPath/snapshotVersion |
| 版本留痕 | `QueryTask.resolvedRefs` | `packages/contracts/src/qos.ts:463` + `packages/contracts/src/refs.ts:22-28` | ◐ `RefKind` **已含 `skill`**（`packages/contracts/src/refs.ts:9`），`apps/agentcore/src/engine.ts:263`/`:374` 真 emit——**但只在注册 agent 路** |

**今天没有什么：**

1. **Prompt 无版本，且是代码常量**：`AGENT_SYSTEM_CORE`（`apps/agentcore/src/agent/prompts.ts:5`）、`CEO_DEEP_QUESTION_SYSTEM`、`ROLE_SYSTEM_FRAGMENTS` 全是源码里的字符串常量。`grep -rn "promptVersion\|prompt_version\|promptHash" apps/ packages/ --include=*.ts` **零命中**。
2. **已有的 Prompt 版本化机制覆盖不到 agent 侧**：`PromptTemplate`（`packages/contracts/src/prompt-template.ts:22-31`）确有 `version` 且有租户 override（端点 `apps/datacore/src/app.ts:1072-1095`，admin only），但 `PROMPT_KEYS`（`:10`）只有 5 个：`classifier` / `extraction` / `modeling` / `skill_summary_lint` / `answer_compose`。B 侧真消费的只有 `classifier` 一个（`apps/agentcore/src/router/orchestrator.ts:1203`）。
3. **自由问答路的技能注入不留痕**：`apps/agentcore/src/router/orchestrator.ts:1731-1734` 把 `freeQaSkills` 拼进 system prompt，但该路径的 `runAgentLoop` 调用**没有 `onResolvedRef`**（对比 `apps/agentcore/src/engine.ts:263` 有）。→ 「这次回答到底哪几个 Skill 在场」在最容易被用户触发的那条路上是**不可知的**。
4. **求解器结果不入 Trace**：求解器输出散在 `ToolCallRow.output`（>64KB 只存 digest，`apps/agentcore/src/persistence/repos.ts:44`）和 `Answer.provenance` 里，没有「本次 Skill 执行用了哪个求解器、什么入参、什么结论」的收敛视图。
5. **人工反馈不挂在 Trace 上**：`POST /api/v1/queries/:taskId/feedback`（`apps/agentcore/src/server.ts:398-404`）的 UP/DOWN 投票，路径 B 落 `FallbackTrace.feedback`，**路径 A 只 emit 一个 `feedback.recorded` 事件就丢了**（`apps/agentcore/src/router/orchestrator.ts:2418-2422`），而该事件在 `apps/agentcore/src/event-subscriptions.ts` **零登记**（违 R10/D-29）。

> 登记为 **`G-TRACE-NO-PROMPT-VERSION`**（🟡：不是"没有痕迹"，是"痕迹里缺了最会变的那一维"）。改了一句 prompt 导致回归，今天没有任何数据能把两次运行区分开。

### 1.3 ⚠ Learning Loop 的两个硬前置（不修则学到的是错的）

> **【2026-08-07 · 欠账 #65 · 分支 `claude/handoff-wo-65-metrics` 状态回写】**
> 下述**前置 A 的 Action 三段埋点半**与**前置 B 两服务鉴权半**已实现并实测闭合，本体 §8
> `G-METRICS-CROSS-TENANT-AND-OPEN` 已标 ✅。实测（真 HTTP，非 inject）：
> `/metrics` 无凭证 **401** · 错 service token **401** · planner **403** · admin **200** ·
> `X-Service-Token` **200**（且**不需要** `X-Tenant-Id` → 不打断抓取）；
> 两租户各提交一次同 `action_type` → 渲染为**两条独立序列**
> （`…,tenant="demo"} 1` 与 `…,tenant="acme"} 1`），不再是合成的 `2`。
>
> **仍未做（§5 开工前请照此判断，别把上面的 ✅ 读成全绿）**：
> ① **B 侧 `qos_*` / `ac_*` 业务计数器仍无 tenant 标签**（§2.1 第 1 条的 AgentCore 半）；
> ② **`ActionDraft.origin` 的 `skillKey`/`skillVersion` 未加**（§2.1 第 3 条）——
>    没有它，per-Skill 人工采纳率仍是空中楼阁，§1.3-A「加重情节」那段依然成立；
> ③ **未新建 `metrics-tenant:check` 门**（§2.1/§2.3）——今天靠的是测试而非静态门，
>    新写的业务计数器漏 tenant 标签**不会**被自动拦下。
>
> **另订正 §2.2 第 1 条的落法（照字面做会得到一个假修）**：「把 `/metrics` 移出 `PUBLIC_PATHS`」
> **单独做不生效** —— 鉴权钩子第二行 `if (!path.startsWith("/a/")) return;` 会让 `/metrics`
> （不以 `/a/` 开头）照样逃出去，端点仍是 200，而且旧测试还会全绿（它们断言的正是"匿名 200"）。
> 必须同时新增一个「需鉴权的非 `/a/` 路径」集合。已实现见 `apps/datacore/src/app.ts`
> 的 `PROTECTED_NON_A_PATHS` / `GLOBAL_SERVICE_PATHS`。

#### 前置 A · 人工采纳率跨租户混算

- `ActionMetrics.submit(actionType, outcome)` 的标签只有 `{action_type, outcome}`：`apps/datacore/src/metrics.ts:99-101`。approval/execute/executeAttempt 同（`:103-113`）。
- 全文件零 tenant：`grep -rn "tenant" apps/datacore/src/metrics.ts apps/agentcore/src/metrics.ts` → **RC=1（零命中）**。
- 全仓零 tenant 标签的计数：`grep -rnE "inc\(\s*\{[^}]*tenant" apps/datacore/src apps/agentcore/src --include=*.ts` → **RC=1（零命中）**。
- **后果**：租户 A 提交 1 次 + 租户 B 提交 1 次 → `dc_action_submit_total{action_type="…",outcome="success"} 2`。审核方本会话实测到 `success 2` 即此。任何按此曲线算的「人工采纳率」都是**多租户合成数**，对任何一个租户都不成立。
- **加重情节**：`ActionDraft.origin`（`packages/contracts/src/actions.ts:47-51`）只有 `taskId/agentId/userId`，**没有 skillKey/skillVersion**。即便修好租户维，采纳率也**归因不到 Skill**——而 SPEC §1-⑫ 要的正是 per-Skill 的人工采纳率。

#### 前置 B · `/metrics` 两服务均无鉴权公开

- DataCore：`/metrics` 在 `PUBLIC_PATHS` 里（`apps/datacore/src/app.ts:838`），而鉴权钩子第一行就是 `if (PUBLIC_PATHS.has(path)) return;`（`:850`）——**在任何认证之前返回**；handler 本身 `app.get("/metrics", async (_req, reply) => …)`（`:911`）连 req 都不看。
- AgentCore：`app.get("/metrics", async (_req, reply) => …)`（`apps/agentcore/src/server.ts:199-202`）——**不调 `auth(req)`**；同文件相邻的业务端点第一行都是 `const a = await auth(req);`（如 `:212`）。
- **后果**：`dc_action_submit_total` 这类指标携带 `action_type`（业务动作名，中文键如 `采纳产能保障方案`、`定稿月度计划版本`）与调用量分布。无凭据 GET 即可拿到**全部租户合并的业务活动画像**。这是 R2「跨租户访问一律 403/404」在可观测面上的完整豁免。
- 复跑（本 PRD 作者**未执行**，只读代码；供实现方与审核方验证）：起本地双服务后 `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4001/metrics` 与 `:4002/metrics`，期望修复后为 **401/403**，今天为 **200**。

> 登记为 **`G-METRICS-CROSS-TENANT-AND-OPEN`**（🔴 · P0 硬前置）。
> **一句话理由：在错的、且公开裸奔的指标上建学习闭环 = 学到的东西也是错的。** 本文 §5 的任何内容，在 §2 两项前置未验收前**不许开工**。

### 1.4 生长回路 —— **订正 SPEC**：不是「只报不写」，是「写了 DRAFT，但审批位不在 R4 上、且写入口无角色门」

> SPEC §2-⑫ / §4 与本单 WO 简报均称「全仓 `intents.insert` 的调用点里没有生长回路」。**本会话核实：该结论已过期。** 据实订正如下，并把真正的缺口说准。

**今天真实的接线（可复跑 `grep -rn "scaffoldDraftIntent" apps/agentcore/src`）：**

```
classifyGap(task) → NO_INTENT + suggestedFill        apps/agentcore/src/growth/probe.ts:33,45
   ↓  buildGrowthLoopWiring.fill 的 NO_INTENT 分支    apps/agentcore/src/growth/scenario-grow.ts:93-105
scaffoldDraftIntent(deps, tenantId, query)           apps/agentcore/src/growth/scaffold.ts:54-82
   ↓  catalog.createIntent(...)                       apps/agentcore/src/growth/scaffold.ts:70
   ↓  status 恒 "DRAFT"                               apps/agentcore/src/catalog/service.ts:150
   ↓  repos.intents.insert(intent)                    apps/agentcore/src/catalog/service.ts:159
```

调用点在 `POST /api/v1/growth/run`（`apps/agentcore/src/server.ts:235-243`）与场景发育 O9（`apps/agentcore/src/server.ts:2316-2318`）。commit `6a659946`「NO_INTENT 自补」即此。**所以「系统自己知道缺什么，却没有手去补」这句话今天已不成立——手是有的。**

**真正的三个缺口（这才是本单要修的）：**

| # | 缺口 | 证据 |
|---|---|---|
| **④-a** | **写入口无角色门** —— `POST /api/v1/growth/run` 只有 `const a = await auth(req);`（`apps/agentcore/src/server.ts:236`），**没有 `requireRole`**。而同一份目录的正门 `POST /api/v1/catalog/packages/:packageId/intents` 是 `requireRole(a, "catalog_admin")`（`apps/agentcore/src/server.ts:511-513`）。→ **任何已认证用户**都能经生长回路把 DRAFT 意图/计划写进本租户目录，绕过 catalog_admin。这是本节最硬的一条：不是「AI 自动改生产意图目录」，是「**任何人都能让 AI 往目录里写草稿**」。 | `apps/agentcore/src/server.ts:236` vs `:512` |
| **④-b** | **DRAFT→PUBLISHED 这一跳不在 R4 上** —— `POST /api/v1/catalog/intents/:intentId/publish` 是 `requireRole(a, "catalog_admin")` + 直接 `catalog.publishIntent`（`apps/agentcore/src/server.ts:528-533`）。有 RBAC，**没有 ActionDraft / approvalChain / 职责分离 / 审批留痕**。生长回路产出的草稿一旦被发布，就直接进分类候选、影响所有用户的答案——这正是 R4 说的「真值写入」，却没走 R4 的路。 | `apps/agentcore/src/server.ts:528-533` · `apps/agentcore/src/catalog/service.ts:178-215` |
| **④-c** | **没有审批位的界面与队列** —— `GrowthCockpitPage`（`apps/frontend-shell/src/pages/admin/GrowthCockpitPage.tsx`）能看工单、能「认领」（`:44,107`），但**没有**「这些是 AI 起草的意图，请逐条批准/驳回」的入口。scaffold 出的 DRAFT 混在普通 DRAFT 里，与人写的无从区分——`IntentDefinition` 上唯一的线索是 `owner:"growth-engine"` 这个字符串（`apps/agentcore/src/growth/scaffold.ts:79`），没有任何一处以它为条件做过筛选或门控。 | `apps/frontend-shell/src/pages/admin/GrowthCockpitPage.tsx` · `apps/agentcore/src/growth/scaffold.ts:79` |

> 登记为 **`G-GROWTH-WRITE-BYPASSES-GATE`**（🔴）。
> 措辞纪律：本文不采用「系统只报不写」的说法——它会让实现方去建一个**已经存在**的执行器，而把真正的洞（角色门 + R4 审批位）漏掉。

### 1.5 已有的正面资产（别重造 · SPEC §5「引用而非内联」同理）

学习闭环所需的零件，仓里已有三件成品，本文一律**复用形态**而非另起：

| 资产 | 锚点 | 可复用的是什么 |
|---|---|---|
| **决策成效闭环**（`Decision` PROPOSED→COMMITTED→**REALIZED**） | `packages/contracts/src/decision-kernel.ts:33-67` · `apps/datacore/src/decision/kernel.ts:198-239` · 端点 `apps/datacore/src/app.ts:3044,3050` | 「预言 vs 实测」的完整形态：`effectivenessPct = realized ÷ predicted × 100`；`realizedGapClose` **必为外部注入**（KILL-MOCK：系统绝不自造实测）；`realizedAt` 由端点注入（R6）。`DecisionOutcomeStat` 的 `(维度, samples, avgEffectivenessPct, weight)` 就是本文 `SkillOutcomeStat` 的模子。**且它是租户隔离的**（`Decision.tenantId`）——证明「学习闭环该有的租户维」在本仓已有正确先例，缺的只是可观测面。 |
| **运行时质量分 EWMA** | `apps/agentcore/src/dril/quality.ts`（`ResourceQualityService.record`） | per-tenant × per-resource 的 `successRate/usageCount/avgLatencyMs` 确定性 EWMA；`overlayQuality` 检索期投影（不改真值源，R13）。**已按 `ctx.tenantId` 隔离**——本文的 Skill 质量分直接复用这套表与纯函数，不新建第二套。 |
| **Evals 真跑管线** | `apps/agentcore/src/evals.ts:153-193`（`run`）· `:203-216`（`feedbackQuality`） | `EvalRunReport` 已带 `tenantId` + 五项技术指标（intentAccuracy / toolCorrectness / avgToolCalls / avgLatencyMs / avgTokenCost）；`feedbackQuality` 已能把 eval 结果回灌质量分。**技术面 Evaluation 基本齐**（详 §7）。 |

**同时记录一处「算了但没人读」的欠账（#92 同族，本文 §5.3 必须避免重蹈）：** `DecisionOutcomeStat.weight` 契约注释写着「后续 decision_play 排序可读」，但 `grep -rn "DecisionOutcomeStat\|aggregateOutcomeStats"` 的命中只有 `apps/datacore/src/decision/kernel.ts`、`apps/datacore/src/app.ts` 的读端点与测试——**没有任何求解器读它**（`apps/datacore/src/solvers/` 目录零命中）。学习权重算出来了，排序器没接。

---

## 2. P0 硬前置（未验收不许开工 §5）

> 这两条不是「顺手改改」，是**门槛**。它们的验收标准与学习闭环的验收标准同等严肃。

### 2.1 前置 A · 指标补租户维（R2 补到可观测面）

**做什么**

1. `Metrics.inc/set`（`apps/datacore/src/metrics.ts:15,22` · `apps/agentcore/src/metrics.ts`）保持不变（它们是通用注册表）；**在门面层强制**：
   - `ActionMetrics` 构造改为持有 `tenantId` 或每个方法收 `tenantId` 参数，`submit/approval/execute/executeAttempt` 一律追加 `tenant` 标签（`apps/datacore/src/metrics.ts:96-114`）。
   - AgentCore 同理：`qos_tasks_total` / `qos_tool_calls_total` / `qos_llm_tokens_total` / `qos_agent_*` 等**业务计数器**补 `tenant`。
2. **基数保护（必须一并做，否则换一个事故）**：Prometheus 标签基数爆炸是真实风险。规定：
   - 只有**业务计数器**加 tenant；进程级健康指标（如 `qos_path_a_hit_ratio` 这类进程滚动窗）不加。
   - 租户标签值取 `tenantId` 原值，不拼接用户/对象 id。
   - 新增 env `METRICS_TENANT_LABEL`（默认 `1`）——单租户部署可关，关时行为与今天逐字节一致（向后兼容）。
3. **`ActionDraft.origin` 补 `skillKey`/`skillVersion`（additive optional）**，`ActionMetrics.submit` 相应补 `skill` 标签（值为 `-` 表示非 Skill 发起）。**这是「per-Skill 人工采纳率」得以成立的唯一前提**——没有它，§5 的业务面指标是空中楼阁。

**验收（效果层，非「字段加了」）**

- SEAM 测：同进程内以租户 `t1` 与 `t2` 各提交一次同 `action_type` 的 Action → `metrics.render()` 中该 metric **必须出现两条独立序列**（`tenant="t1"` 与 `tenant="t2"` 各 1），**不得**出现合成的 `2`。变异反证：去掉 tenant 标签 → 测试必红。
- SEAM 测：一个由 Skill 发起的 ActionDraft 走完 submit → `dc_action_submit_total{skill="<key>",tenant="<t>"}` 可查；非 Skill 发起的落 `skill="-"`。

**防回潮门 `metrics-tenant:check`（并入 `pnpm gates`）**

- 静态断言：`ActionMetrics` 四个方法体内均出现 `tenant` 标签键；AgentCore 登记表内的业务计数器 `inc(` 调用点均带 tenant（白名单登记进程级指标，逐条写理由，仿 `outsource-redline:check` 的「逃生舱必填理由」形态）。
- green→red 有牙：删掉任一 tenant 标签 → 门红并打印 metric 名。

### 2.2 前置 B · `/metrics` 鉴权

**做什么**

1. DataCore：把 `/metrics` **移出** `PUBLIC_PATHS`（`apps/datacore/src/app.ts:835-845`）；handler（`:911`）改为要求以下**任一**凭据：
   - `X-Service-Token === SERVICE_TOKEN`（复用 `apps/datacore/src/app.ts:854-860` 既有服务间机制，roles=["service"]）——这是 Prometheus 抓取的正门；
   - 或 admin 角色 JWT。
   其余一律 401/403（错误信封 R7）。
2. AgentCore：`apps/agentcore/src/server.ts:199` handler 首行加与上同口径的凭据校验（复用该文件既有 `auth(req)` 与服务令牌判定，**不新造第三套认证**）。
3. **租户视图（可选但强烈建议，随 §2.1 一起做）**：admin 拉取时按其 `tenantId` **过滤**渲染结果，只有 `service` 角色能拉全量。否则「补了租户维」反而让每个 admin 看到别家租户的曲线——那是把 R2 从「合成一条」恶化成「明码列出」。
4. **出货配置照做**：`docker-compose.yml` 的 prometheus/抓取侧（若有）须带 `SERVICE_TOKEN`；本项受既有 `deploy-governance:check` 门（本体 §7）约束——代码里写「部署态建议」而 compose 不照做 = 门红。

**验收**

- 测：无 header GET `/metrics` → **401/403**（两服务各一条）；带 `X-Service-Token` → 200 且内容非空；带非 admin 用户 JWT → 403。
- 变异反证：把 `/metrics` 塞回 `PUBLIC_PATHS` → `metrics-tenant:check` 的第二条断言（`/metrics` 不在任何公开路径集里）必红。

### 2.3 前置的门与本体回写

- `metrics-tenant:check` 同时守两件事（租户标签 + `/metrics` 非公开），并入 `pnpm gates`，登记进本体 §7（否则 `ontology-writeback:check` 红）。
- 本体 §8 登记 `G-METRICS-CROSS-TENANT-AND-OPEN`，闭合后标 ✅。

---

## 3. Skill 权限三面：data / tool / action（**一处判定**）

### 3.1 设计红线：不许出现第二个判定出口

SPEC §8 提「Permission：data / tool / action 三面」。本仓已有的教训（`G-SKILL-UNREACHABLE-FREE-QA` / #90 同族）是：**一个能力有两条路径，只治了一条 = 没治**。故本节第一条硬约束：

> **Skill 的启用/禁用判定，必须与 entitlement 走同一个函数 `featureEnabled`（`apps/agentcore/src/features/registry.ts:187`）。不得新增 `skillEnabled` 之类的平行实现。**

落法：`FeatureDef.bindings` 加 `skills?: string[]`（`packages/contracts/src/features.ts:16-22`），并新增 `skillAllowed(set, skillKey)`——其函数体**与 `intentAllowed`（`:201`）/ `solverAllowed`（`:213`）逐行同构**，同样是「被任一 disabled feature 绑定即不可用」。这样：

- 关掉 `view.risk-board` → 绑在它上面的 `risk_analysis` skill **同时**消失，与其 intent/solver 同步。杜绝「意图开着 Skill 关着」或反之的半开态。
- 判定入口只有一个，改口径两侧一起变（R-一致）。

### 3.2 三面定义

在 `SkillDefinitionSchema` 新增 **`permissions`（additive · optional · 缺省=最小权限**，见 §3.4 迁移**）**：

```
permissions: {
  data:   { objectTypes: string[],  // 本 Skill 允许读的对象类型（∩ A6 行级过滤 ∩ agent scope）
            slices:      string[] }, // 允许 resolve 的切片
  tool:   { allow: string[],         // 允许调用的工具/MCP 工具 key
            deny?:  string[] },      // 显式禁用（优先于 allow，用于收窄继承）
  action: { allowedTypes: string[],  // 允许 create_action_draft 的 ActionType key 集合
            maxRiskLevel?: "READ"|"COMPUTE"|"ACTION_DRAFT" }
}
```

**三面各自的强制点（都在既有强制层上加，不新建拦截器）：**

| 面 | 强制点 | 落法 |
|---|---|---|
| **data** | `apps/agentcore/src/tools/executor.ts:139-152` 既有 `scopeObjectTypes` 门 | 有效对象类型集 = `agent.scopeDeclaration.objectTypes` **∩** 本轮在场 Skill 的 `permissions.data.objectTypes`（**取交集**，Skill 只能收窄不能放宽——这是本节的第二条红线）。A6 行级过滤在 DataCore 侧不变，正交叠加。 |
| **tool** | `apps/agentcore/src/tools/executor.ts:135-137` 既有 `scopeToolNames` 门 | 有效工具集 = agent scope **∩** Skill allow **∖** Skill deny。越界返回既有 `AGENT_SCOPE_VIOLATION`（R7 不新增错误码）。 |
| **action** | `create_action_draft` 工具执行路径 | 校验目标 `actionTypeKey ∈ permissions.action.allowedTypes`；不在集内 → DENIED + 错误码 `SKILL_ACTION_NOT_PERMITTED`。**与既有 `isWriteModeSkill`（`packages/contracts/src/agentcore.ts:201`）串联**：先判「这个 Skill 是不是写模式」（决定给不给工具），再判「能发哪一型」（决定发不发得出去）。 |

**自由问答路径必须同治**：`selectTenantSkills`（`apps/agentcore/src/router/orchestrator.ts:232`）在筛完 PUBLISHED/最新版后，**追加一道 `skillAllowed(enabledFeatures, s.key)` 过滤**。这是 §3.1 红线在第二条路径上的兑现——`agent.skill-on-free-qa` 开启后，池子里的每个 skill 都必须过同一个 entitlement 判定。

### 3.3 引用可校验（SPEC §5「必配硬门」的兑现）

`SKILL_REFERENCE_KINDS`（`packages/contracts/src/agentcore.ts:216`）扩容三种：`tool` / `mcp` / `actionType`。于是 `permissions` 里列的每个 key 都能表达为 `SkillReference`，并被**发布门禁一**（结构 lint，`apps/agentcore/src/skill-lint.ts`）校验存在性：

- `tool` key ∈ `apps/agentcore/src/tools/registry.ts` 注册表（或本租户 MCP 配置）
- `actionType` key ∈ 本租户已注册 ActionType（含内置 `apps/datacore/src/actions.ts:35` `ACTION_WIRING` 覆盖的键）
- `objectTypes` ∈ 本租户已发布本体（复用 lint 既有的跨资源闭合校验路径）

**反向收益（SPEC §5 已论证，此处只补落点）**：有了引用清单，「改 `C08` / 下线某工具 / 废弃某 ActionType 会影响哪些 Skill」变成一次查询——投影进 DRIL `resource_relations`（`apps/agentcore/src/dril/resource-projector.ts` 已在写 skill→rule/solver/slice 关系），扩三种 kind 即可。

### 3.4 迁移与向后兼容

- `permissions` 为 **optional**。缺省语义**必须显式定义，且不能是「全开」**（否则等于什么都没做）：
  - 缺省 = **继承所在 agent 的 scope**（注册 agent 路径）——与今天行为逐字节一致；
  - 自由问答路径（无 agent）缺省 = **`PROBE_TOOL_NAMES` 同款只读工具集**（`apps/agentcore/src/skill-probe.ts:28`）+ `action.allowedTypes = []`（写模式 skill 除外，见下）。
  - 写模式 skill（`isWriteModeSkill`）缺省 `action.allowedTypes` 仍为 `[]` → **发布门禁一硬性要求写模式 skill 必须显式声明 `allowedTypes`**，否则拒绝发布。理由：写权限不许靠缺省获得。
- 出厂 7 个 skill（SPEC §4 实测清单）在本单内**逐个补齐 `permissions`**，否则新门一上，它们要么被门拦、要么落到缺省最小集导致行为退化——两者都会被当成「本单把系统改坏了」。

### 3.5 门 `skill-permission:check`（并入 `pnpm gates`）

1. 判定单源：全仓 `skillAllowed` 只有一处定义，且其实现引用 `featureEnabled`；不存在第二个「skill 是否可用」的判定分支。
2. 双路径覆盖：`selectTenantSkills` 调用点后必须接 `skillAllowed` 过滤（静态扫），`engine.ts` 注册 agent 路同。
3. 引用闭合：出厂 skill 的 `permissions` 中每个 tool/actionType/objectType key 可在对应注册表解析（读 dist，仿 `resource-descriptor:check` 的取数方式）。
4. 写权限不缺省：`isWriteModeSkill` 为真且 `permissions.action.allowedTypes` 为空 → 红。
5. green→red 有牙：给某 skill 加一个不存在的 tool key → 门红；删掉 `selectTenantSkills` 后的过滤 → 门红。

### 3.6 SEAM 接缝驱动测试（审核方头号判据）

> 依 `CLAUDE.md` SEAM-GATE：跨「数据半（声明）× 引擎半（强制）」的特性，必须有一条驱动接缝的组合测试。

**`skill-permission-seam.test.ts` 必测三条：**

1. **tool 面**：给 skill 声明 `tool.allow=["query_objects"]` → 挂载后让 agent 尝试调 `invoke_solver` → 断言 `DENIED` + `AGENT_SCOPE_VIOLATION`；把 `invoke_solver` 加进 allow → 同一问句断言 `OK`。**改声明，行为真变**。
2. **action 面**：写模式 skill 声明 `action.allowedTypes=["adopt_mitigation"]` → 让它尝试对 `定稿月度计划版本` 建草稿 → 断言 `SKILL_ACTION_NOT_PERMITTED`，且**未产生 ActionDraft 行**（查仓储，不只看返回码）。
3. **entitlement 一处判定**：把绑定该 skill 的 feature 关掉 → 断言**同一租户下** ① 该 intent 404 `FEATURE_NOT_FOUND` ② 该 solver 404 ③ **该 skill 不出现在自由问答的 system prompt 里**（断言拼出的 system 串不含其 summary）。三者必须**同时**发生——这条就是防「意图开着 Skill 关着」半开态的接缝断言，任一半漏即红。

---

## 4. Execution Trace（`SkillExecutionTrace`）

### 4.1 对象定义

```
SkillExecutionTrace {
  id            // sktr_
  tenantId      // R2：一等列，不靠 taskId 关联（对比 ToolCallRow 无 tenantId）
  taskId
  skillRefs[]   // { key, version, injectionMode: "AGENT_BOUND" | "TENANT_POOL" | "LOAD_SKILL" }
  promptRefs[]  // { key, version, digest }  ← 见 §4.2
  agentRunId?   // 关联 AgentRunRecord（packages/contracts/src/qos.ts:655）
  toolCalls[]   // { toolCallId, toolName, outcome, durationMs }  ← 投影自 ToolCallRow，不复制 output
  solverResults[] // { solverKey, argsDigest, outputDigest, provIds[] } ← 收敛视图（今天散在 ToolCallRow.output）
  ruleVerdicts[]  // { ruleKey, ruleVersion, verdict }  ← engine.ts:278 已 emit 该 resolvedRef，此处收敛
  answerRef     // { trustLevel, blockCount, provenanceCount, unverifiedNumerics }
  humanFeedback?  // { vote: UP|DOWN, at, by }        ← 挂 Trace，不再丢（修 §1.2-5）
  correctionId?   // → HumanCorrection（§5.1-c）
  createdAt
}
```

**纪律：**
- **投影而非复制**（R13/RL3 单源）：`toolCalls` 只存 id + 摘要，正文仍在 `ToolCallRow`；`solverResults` 只存 digest + provId，正文仍在 provenance。Trace 是**索引与版本快照**，不是第二份真值。
- **确定性**（R6）：Trace 的组装为纯函数 `projectSkillTrace(task, agentRun, toolCalls, resolvedRefs)`，时钟由调用方注入。同一次运行重放 → 同一 Trace（除 id/时间戳外逐字节一致）。
- **R2**：`tenantId` 一等列 + 所有查询按租户过滤；跨租户读 404。

### 4.2 Prompt 版本化（本节的核心，也是 🟡 的唯一解）

**问题重述**：prompt 在代码里（`apps/agentcore/src/agent/prompts.ts:5`），改了无从追溯；已有的 `PromptTemplate` 版本化只覆盖 5 个键，且 B 侧只消费 `classifier` 一个。

**方案（两步，且第二步不可省）：**

**① 扩 `PROMPT_KEYS`**（`packages/contracts/src/prompt-template.ts:10`）纳入 agent 侧核心 prompt：
`agent_system_core` · `ceo_deep_question` · `role_fragment_<role>`（五角色）· `skill_section_header`。
`PLATFORM_PROMPT_DEFAULTS`（`:14`）填入今天代码常量的**原文**——搬家不改值（R6 字节一致，仿 `BASE_REGISTRY` 收敛的做法）。`apps/agentcore/src/agent/prompts.ts` 的导出常量改为从 `PLATFORM_PROMPT_DEFAULTS` 取，**保持导出名不变**（既有 import 不动）。

**② 加内容指纹 `digest`**（`PromptTemplateSchema` 与 `ResolvedPromptSchema` 各加一个 `digest: string`）：
- `digest = djb2(template)` 纯 JS 确定性哈希——**直接复用 `boundaryVersion()` 已在用的同一套算法**（`packages/contracts/src/base-registry.ts`，本体 §2.A DF.10），不引第二种哈希。
- 平台默认（`version: 0`）也有 digest。**这是关键**：租户没 override 时 `version` 恒为 0，只靠 version 分不出「代码里那句 prompt 改没改」；digest 能。
- Trace 记 `{key, version, digest}` 三元组 → 「哪版 prompt 在跑」在**代码改动**与**租户 override**两个维度上都可追溯。

**③ 消费方必须同单接上**（`G-LLM-BUDGET-NO-CONSUMER` 的教训）：
- `apps/agentcore/src/router/orchestrator.ts:1731-1734` 的自由问答路：`baseSystem` 改为经 `resolvePromptOverride(prompts, auth, "agent_system_core")` 取（该函数已存在，`apps/agentcore/src/agent/prompts.ts:240`），并把返回的 `{version, digest}` 记进 Trace。
- `apps/agentcore/src/engine.ts:320` 注册 agent 路同。
- **验收即效果层**：改一次租户 override → 同一问句的 Trace 里 `promptRefs[0].version` 与 `digest` 必须双变，且**答案确实按新 prompt 走**（断言一个新 prompt 里独有的行为标记）。只读出来不算。

### 4.3 采集点与不采集边界

| 采集点 | 位置 | 说明 |
|---|---|---|
| 注册 agent 路 | `apps/agentcore/src/engine.ts:255-278`（已有 `onResolvedRef` 发 agent/skill/rule） | 扩为同时喂 Trace 组装器 |
| 自由问答路 | `apps/agentcore/src/router/orchestrator.ts:1731-1737` | **本文新增**：`freeQaSkills` 逐个记 `{key, version, injectionMode:"TENANT_POOL"}`（修 §1.2-3 的盲区） |
| `load_skill` 运行时加载 | `apps/agentcore/src/engine.ts:374` 已 emit skill resolvedRef | 记 `injectionMode:"LOAD_SKILL"` |
| 人工反馈 | `apps/agentcore/src/server.ts:398-404` → `orchestrator.feedback`（`:2413`） | **本文新增**：路径 A 不再只 emit 事件即丢，写 `SkillExecutionTrace.humanFeedback`；`feedback.recorded` 补进 `event-subscriptions.ts`（补 R10 缺口） |

**不采集**（诚实边界，写死在设计里以免膨胀）：不存 prompt 全文（只存 key+version+digest）；不存工具/求解器 output 正文（只存 digest + 既有 provId）；不存 LLM 原始响应。理由：Trace 的用途是**复盘与归因**，不是审计留存；正文各有其单一来源。

### 4.4 门与验收

- 门（并入 `skill-permission:check` 同一脚本或独立 `skill-trace:check`，二选一，本文不强制）：静态断言两条注入路径都接了 Trace 采集（防「只治了注册 agent 一条路」的 #90 回潮）。
- SEAM 测 `skill-trace-seam.test.ts`：
  1. 自由问答开 `agent.skill-on-free-qa` → 跑一句 → Trace 的 `skillRefs` 非空且 `injectionMode==="TENANT_POOL"`；关掉该 feature → 同一问句 Trace `skillRefs` 为空。**变异反证**：删掉 orchestrator 侧采集 → 第一条断言必红。
  2. 改租户 prompt override → 同问句两次 Trace 的 `promptRefs[].digest` 不同。
  3. 投 UP 票 → Trace 的 `humanFeedback.vote==="UP"`（**路径 A 也必须成立**——这是今天丢掉的那半）。

---

## 5. Learning Loop（人在回路 · R4 红线）

> **前置**：§2 两项未验收，本节不许开工。这不是流程洁癖——是 §1.3 已论证的「错指标 → 错结论」。

### 5.1 三类反馈信号（全部 per-tenant × per-skill）

| # | 信号 | 数据来源 | 今天有没有 |
|---|---|---|---|
| a | **二元投票** UP/DOWN | `POST /api/v1/queries/:taskId/feedback`（`apps/agentcore/src/server.ts:398`） | ◐ 有，路径 B 落 `FallbackTrace.feedback`，路径 A **丢**（`apps/agentcore/src/router/orchestrator.ts:2421`）→ §4.3 修 |
| b | **采纳/驳回** | Action 审批链终态（`ActionDraft.status`） | ◐ 有，但**归因不到 Skill**（`origin` 无 skillKey，`packages/contracts/src/actions.ts:47`）→ §2.1 修 |
| c | **人工修正差量**（AI 说 20%，人改成 10%） | — | 🔴 **完全不存在**。`ActionDraft.payload` 提交后不可变（`packages/contracts/src/actions.ts:46` 注释「提交后不可变」）；`ApprovalStep` 只有 `APPROVE/REJECT + comment`（`:19-28`）。今天要改数只能驳回后重建一张草稿，**且两张草稿之间没有任何链接**。 |

**新增 `HumanCorrection`（解 c）：**

```
HumanCorrection {
  id            // hcorr_
  tenantId
  originDraftId   // 被修正的 ActionDraft
  correctedDraftId // 修正后新建的 ActionDraft（保持 payload 不可变的既有铁律）
  traceId?        // → SkillExecutionTrace（归因到 Skill/Prompt 版本）
  deltas[]        // { path: "levers.line_b.pct", proposed: 20, corrected: 10, unit: "%" }
  reason?         // 审批人填写
  correctedBy, correctedAt
}
```

**关键设计选择（须写清理由，防实现走样）：**
- **不改 `ActionDraft.payload` 不可变的铁律**。修正 = 新建一张草稿 + 一条 `HumanCorrection` 把两张链起来。这样审计链完整（原提议、修正后提议、谁改的、改了什么、为什么），且不破坏既有 R4 语义。
- 新增端点 `POST /a/v1/action-drafts/:id/correct` —— **它本身就是一次 Action 提交**（建新草稿并进审批链），不是绕过审批的旁路。
- `deltas` 用 JSON path + 数值对，**确定性 diff**（纯函数，R6），不存自然语言描述。

### 5.2 `SkillOutcomeStat`（形态复用 `DecisionOutcomeStat`）

```
SkillOutcomeStat {
  tenantId, skillKey, skillVersion,
  samples,                 // 该 (tenant, skill, version) 的 Trace 数
  answerAcceptRate,        // UP ÷ (UP+DOWN)            ← 信号 a
  adoptionRate,            // EXECUTED ÷ 提交的 ActionDraft 数  ← 信号 b（排除口径见下）
  correctionRate,          // 有 HumanCorrection 的比例   ← 信号 c
  avgCorrectionMagnitude,  // 平均修正幅度 |corrected-proposed| ÷ |proposed|
  weight                   // 学习权重（0 地板）
}
```

**采纳率的排除口径（不写清就会算出假数）：**
- 分母**排除**「审批人主动 REJECT」以外的系统性失败？—— **不排除**。REJECT 是人的决定，正是我们要学的信号，必须计入分母。
- 分子**必须排除** `ACTION_WIRING`（`apps/datacore/src/actions.ts:35`）标 `NOT_IMPLEMENTED` / `NO_WRITE` 的动作类型。理由：`G-ACTION-NOOP-EXEC` 已坐实这些动作「审批链走完、审计留痕齐全、真值一个字节没动」。把它们算成「采纳成功」，学到的就是**「多提这种什么都不写的方案，采纳率最高」**——这是本节最危险的一个陷阱，必须在实现里显式过滤并在测试里咬住。
- 分子**必须排除** `executionResult.ok === false` 的（`packages/contracts/src/actions.ts:54-61`）。

**聚合为纯函数** `aggregateSkillOutcomeStats(traces, drafts, corrections)`，形态与 `aggregateOutcomeStats`（`apps/datacore/src/decision/outcome-stats.ts`）对齐，R6 确定性。

### 5.3 消费方（**先有消费方，再有指标**——#92 的唯一解药）

> 本文拒绝交付一个「算出来了没人读」的 `weight`。以下**至少一项**必须与指标同单落地，否则本节不予验收。

**首选消费方 · Skill 语义路由排序**：`apps/agentcore/src/agent/skill-router.ts` 的 `selectSkills`（经 `buildSkillSection` 调用，`apps/agentcore/src/agent/prompts.ts:69`）今天按语义相关性取 top-k。加一个**乘子**：`finalScore = semanticScore × (0.5 + 0.5 × weight)`。
- 效果层验收：造两个语义等价的 skill，一个 `weight` 高一个低 → 断言 top-1 是高的那个；把 weight 对调 → 断言排序翻转。**改学习权重，注入的技能真变**。
- 与 `ResourceQualityService`（`apps/agentcore/src/dril/quality.ts`）的关系：那套是 DRIL 检索期的 `successRate` EWMA（技术面），这套是业务面采纳率。**两者叠乘，不是二选一**；且**共用同一张 `resource_quality_scores` 表的扩展列**而非新建第二套表（RL3 单源）。

**次选消费方 · 治理面板**：`GrowthCockpitPage` 同级新增 Skill 治理页，列 per-skill 的三率 + 修正幅度 + 「最常被改的参数」Top-N。这一项**不能单独构成验收**（面板是「读」不是「用」），但它是 §5.4 人工决策的输入。

### 5.4 **R4 红线**：学习闭环改生产配置，一律走 Action 审批

**这是本单的红线，无例外。** 学习闭环可以**建议**，不可以**生效**：

| 学习产物 | 允许的自动行为 | 必须经 Action 的行为 |
|---|---|---|
| `weight` 变化 | ✅ 影响**检索排序**（不改任何持久化配置，等价于「今天更倾向推荐谁」） | — |
| 「建议把 skill X 的 `maxBudgetRounds` 从 4 调到 6」 | ✅ 生成建议 + 通知 | 🔒 真改字段 → `ActionDraft(actionTypeKey="skill_config_change")` → approvalChain → EXECUTED |
| 「建议下线 skill Y（采纳率 8%）」 | ✅ 生成建议 | 🔒 真 RETIRE → 经 Action |
| 「建议把 prompt 模板改成 Z」 | ✅ 生成建议 | 🔒 真 PUT `/a/v1/prompt-templates/:key` → 经 Action（今天该端点是 admin 直写，`apps/datacore/src/app.ts:1084`——本单**不**顺手改它，但学习闭环产生的变更必须走 Action 路） |

**新增 ActionType `skill_config_change`**：须在 `apps/datacore/src/actions.ts:35` `ACTION_WIRING` 显式归类（`action-wiring:check` 门要求），并在 `app.ts domainExecutor` 真接分支（标 `WIRED` 而无分支 = 门红）。**不许**落到 `UnwiredActionExecutor` 兜底——那正是 `G-ACTION-NOOP-EXEC` 的形态。

**排序乘子为什么不需要走 Action**（须写明理由，否则会被当成绕过 R4）：`weight` 只影响「本轮往 system prompt 里先塞哪个 skill 的全文」，不改任何持久化配置、不改任何业务真值、不改任何用户可见的目录状态；且全部技能仍可经 `load_skill` 取到。它与 DRIL 既有的 `overlayQuality`（检索期投影，本体 §2 明载「不改真值源」）**同性质**。若将来 `weight` 被用于**过滤**（决定哪些 skill 根本不出现），则性质改变，必须重新评估 R4 归属——**本文明确禁止把 weight 用作过滤器**。

### 5.5 SEAM 测（`skill-learning-seam.test.ts`）

1. **租户隔离真断言**：租户 t1 对 skill S 投 3 个 DOWN，租户 t2 投 3 个 UP → 断言 `SkillOutcomeStat` 两行、`answerAcceptRate` 分别为 0 与 1。**变异反证**：去掉聚合里的 tenant 维 → 变成一行 0.5 → 测试必红。（这条直接咬 §2.1 前置——前置没做，本测试跑不通。）
2. **假采纳率反证**：让 skill S 提交的全部是 `采纳经营方案`（`ACTION_WIRING` 标 `NOT_IMPLEMENTED`，`apps/datacore/src/actions.ts:59`）并全部审批通过 → 断言 `adoptionRate === 0`（不是 1）。**这条测的就是 §5.2 的排除口径**，漏了它学习闭环会学出「多提空转方案」。
3. **修正差量闭环**：AI 提议 20% → 人工 correct 到 10% → 断言 `HumanCorrection.deltas` 记 `{proposed:20, corrected:10}`，且 `avgCorrectionMagnitude === 0.5`，且新草稿走完了自己的审批链（查仓储状态，不看返回码）。
4. **消费方效果层**：改 `weight` → 同一问句注入的 top-1 skill 真变（§5.3）。
5. **R4 红线**：调用学习闭环的「应用建议」入口 → 断言**产生的是 DRAFT ActionDraft**，且在审批通过前，skill 的配置字段**一个字节没变**（读仓储核对）。

---

## 6. 生长回路：执行器接线 + 人在回路审批位

> 前提：§1.4 已订正 AS-IS——执行器**已存在**（`scaffoldDraftIntent`）。本节补的是**门**与**位**。

### 6.1 补角色门（④-a）

`POST /api/v1/growth/run`（`apps/agentcore/src/server.ts:235`）与场景发育 O9 路径（`:2316`）中，**凡会触发 catalog 写入的分支**，须校验调用方具备 `catalog_admin`。

**但不能简单地在端点加 `requireRole`** —— 那会把「跑一次探针看看缺什么」这个只读诉求也锁死（`/api/v1/growth/probe` 是纯只读，`:220-232`）。故：

- `POST /api/v1/growth/run` 新增 body 参数 `autoScaffold?: boolean`（默认 **false**，向后兼容口径见下）。
- `autoScaffold === false` → `fill` 的 scaffold 分支**不写**，改为产出 `ScaffoldProposal`（只读建议，落 `GrowthTicket.proposedDrafts`）。
- `autoScaffold === true` → 要求 `catalog_admin`，否则 403。
- **向后兼容的诚实处理**：默认值从「今天恒写」改为「默认不写」，是**行为变更**。理由是安全边界修复（越权写入），本文认为该变更正当且必须；但须在 `DEPLOY.md` 与本 PRD 验收里显式记录，并给既有调用方（前端 `GrowthCockpitPage` 的 `runGrowth`）同步传 `autoScaffold:true`（该页本就在 admin 区）。**不许**为了「零回归」把默认留成 true——那等于洞不修。

### 6.2 补 R4 审批位（④-b）

**新增 ActionType `growth_intent_publish`**（`approvalChain` 至少一级 `catalog_admin`）：

```
GapReport(NO_INTENT)
  → scaffoldDraftIntent 建 DRAFT 意图 + DRAFT 计划        （已有，不改）
  → 【新】自动创建 ActionDraft{ actionTypeKey:"growth_intent_publish",
                                payload:{ intentId, intentKey, fromQuestion, gapCode,
                                          traceId, scaffoldedDrafts[] } }
  → emit growth.proposal_submitted                        （新事件，进审批收件箱）
  → 人工审批（catalog_admin，职责分离按租户 selfApprovePolicy，
              `apps/datacore/src/actions.ts:375 selfApproveAllowedFor`）
  → EXECUTED → executor 调 B 的 publishIntent             （必须真接分支，见下）
  → emit growth.proposal_approved + intent.published      （既有 L4 事件）
```

**执行器纪律**：`growth_intent_publish` 在 `ACTION_WIRING` 标 `WIRED` 就**必须**在 `domainExecutor` 有真分支（`action-wiring:check` 断言②）。它的写回目标在 AgentCore（意图目录），A 侧执行器经服务间凭证调 B —— 这是**跨系统 Action**，本文承认它是新形态，须在实现时确认 A→B 的服务间路由与幂等（**未核实**：今天 `domainExecutor` 的分支是否已有跨系统调用先例，本文未逐一核对，见 §9）。

**驳回路径同等重要**：REJECT → DRAFT 意图打标 `RETIRED`（不留悬空草稿污染目录），`GrowthTicket` 标 `REJECTED` + 记审批意见。**这条也是学习信号**（§5.1-b）：AI 起草的意图被驳回率，是生长回路质量的直接度量。

### 6.3 补审批位的界面（④-c）

- `IntentDefinition` 已有 `owner:"growth-engine"`（`apps/agentcore/src/growth/scaffold.ts:79`）但从未被消费。本文**不**以字符串约定做门控（脆弱），而是以 **ActionDraft 队列**为准：AI 起草的意图必然对应一张 `growth_intent_publish` 草稿，它天然出现在既有审批收件箱（`action.pending_approval` 事件 → approval-inbox，本体 §4 L5）。
- `GrowthCockpitPage`（`apps/frontend-shell/src/pages/admin/GrowthCockpitPage.tsx`）新增「待审提案」区：列 `growth_intent_publish` 草稿 + 原问句 + 缺口码 + scaffold 出的制品 + 一键批准/驳回（深链到既有审批页，不重造审批 UI）。
- R15 CLI 对等：`platform growth proposals` / `platform approve <draftId>`（后者已存在于 `scripts/platform-cli.mjs`，本体 §2.H 载明 CLI 有 `approve`）。

### 6.4 门 `growth-hitl:check`（并入 `pnpm gates`）

1. 静态断言：`apps/agentcore/src/growth/` 下**所有** catalog 写入调用（`createIntent`/`createPlan`/`publishIntent`）都在 `autoScaffold` 守卫之后，或经 Action 执行器路径。
2. 静态断言：`POST /api/v1/growth/run` 的 scaffold 分支有 `catalog_admin` 校验。
3. 静态断言：`growth_intent_publish` 已在 `ACTION_WIRING` 归类且非 `NO_WRITE`。
4. green→red 有牙：把 `requireRole` 删掉 → 门红；把 `growth_intent_publish` 改标 `NO_WRITE` → 门红（与 `action-wiring:check` 断言⑤联动，`NO_WRITE` 须签实名理由）。

### 6.5 SEAM 测（`growth-hitl-seam.test.ts`）

1. **越权写入被堵**：以 `planner`（非 catalog_admin）调 `/api/v1/growth/run` + `autoScaffold:true` → 403，且**目录里没有新增任何 DRAFT 意图**（查仓储）。变异反证：删角色门 → 断言必红。
2. **人在回路真生效**：admin 跑一次 NO_INTENT 问句 → 断言 ① DRAFT 意图已建 ② `growth_intent_publish` 草稿已建且状态 `PENDING_APPROVAL` ③ **该意图仍未 PUBLISHED，不进分类候选**（用同一问句重跑，断言仍走兜底）。审批通过后 → 同一问句**真的能命中该意图**。这条把「起草 → 审批 → 生效」整条接缝驱动通。
3. **驳回不留脏**：REJECT → 断言意图 `RETIRED` 且不在分类候选里。

---

## 7. Evaluation 指标体系（技术 / 业务 / 质量三面）

> SPEC §1-⑫「Skill Evaluation：准确率 · 响应时间 · 人工采纳率 · 收益」。下表按三面展开，逐项标数据来源与今天的缺口。

### 7.1 技术面

| 指标 | 定义 | 数据来源 | 今天状态 |
|---|---|---|---|
| 成功率 | `passRate = passed ÷ total` | `EvalRunReport.passRate`（`apps/agentcore/src/evals.ts:179`） | ✅ 有，且 **per-tenant**（report 带 tenantId，`:172`） |
| 意图准确率 | `intentAccuracy` | `apps/agentcore/src/evals.ts:181` | ✅ 有 |
| 工具正确率 | `toolCorrectness` | `apps/agentcore/src/evals.ts:182` | ✅ 有 |
| 时延 | `avgLatencyMs` | `apps/agentcore/src/evals.ts:184` | ✅ 有（eval 侧）· ◐ 生产侧有 `qos_classifier_latency_ms` 直方图（`apps/agentcore/src/metrics.ts:81`），**无 tenant 维** |
| token 成本 | `avgTokenCost` | `apps/agentcore/src/evals.ts:185`（取自 `AgentRunRecord` 的 in+out tokens，`:238`） | ✅ eval 侧有 · ◐ 生产侧 `qos_llm_tokens_total`（`apps/agentcore/src/metrics.ts:126`）标签 `{model,direction,provider}`，**无 tenant / 无 skill** |
| 工具调用数 | `avgToolCalls` | `apps/agentcore/src/evals.ts:183` | ✅ 有 |
| **per-Skill 归因** | 上述全部按 skill 切分 | — | 🔴 **缺**。eval 的 `suite=skill_quality` 能按 skill 跑（`apps/agentcore/src/evals.ts:55-61` `runSkillProbe`），但**生产运行**的技术指标归因不到 skill → §4 Trace 补 |

**结论：技术面的"有没有测"基本齐（eval 侧），缺的是"生产运行时按租户×技能切分"。** §2.1（tenant 维）+ §4（Trace）落地后即可由 Trace 聚合得出，不需要新埋点。

### 7.2 业务面

| 指标 | 定义 | 数据来源 | 今天状态 |
|---|---|---|---|
| **人工采纳率** | `EXECUTED ÷ 提交草稿数`（排除口径见 §5.2） | `ActionDraft.status` + `dc_action_submit/approval/execute_total` | 🔴 **今天是错的**：跨租户混算（§1.3-A）+ 归因不到 skill（`origin` 无 skillKey）。修法 = §2.1 前置 |
| 预测准确率 | 预言 vs 实测 | `DecisionOutcome.effectivenessPct`（`packages/contracts/src/decision-kernel.ts:40`）· 校准侧 `simulatedMapeAfter < mapeBefore`（本体 §7 VLE ⑦） | ◐ **决策级有**（且租户隔离、外部注入实测、KILL-MOCK 纪律齐全）；**Skill 级无**——`Decision` 不记是哪个 Skill 产的方案 → 加 `Decision.originSkillRef?`（additive） |
| 成本节省 / 收益 | 方案带来的量化收益 | — | 🔴 **缺**。`DecisionOption` 有 `closesGap`（补缺口量），但那是**能力口径**不是**金额口径**；无「省了多少钱」的统一定义。**本文不臆造**：建议先落 `closesGap` 的实测闭环（已有），金额口径待业务定义后再补，见 §9 |
| 修正幅度 | `avgCorrectionMagnitude` | `HumanCorrection.deltas`（§5.1-c 新增） | 🔴 **完全缺**（通道不存在） |
| 生长回路质量 | AI 起草意图的批准率 | `growth_intent_publish` 草稿终态（§6.2 新增） | 🔴 缺（本文新增） |

### 7.3 质量面

| 指标 | 定义 | 数据来源 | 今天状态 |
|---|---|---|---|
| 人工评分（二元） | UP/DOWN | `POST /api/v1/queries/:taskId/feedback`（`apps/agentcore/src/server.ts:398`） | ◐ 有，但**路径 A 丢**（`apps/agentcore/src/router/orchestrator.ts:2421` 只 emit 不落）→ §4.3 修 |
| 人工评分（分级） | 1–5 星或维度评分 | — | 🔴 缺。**本文明确不新增**：在二元投票的落盘都还漏一半的情况下加分级评分，是先扩表面再补地基。列为后续。 |
| 溯源合规率 | `provenancePolicy=required` 的 skill 实际带 provenance 的比例 | Trace `answerRef.provenanceCount` + skill 的 `provenancePolicy`（`packages/contracts/src/agentcore.ts:259`） | 🔴 缺**生产侧**统计（发布门禁二在**发布时**已断言，`apps/agentcore/src/skill-probe.ts`）→ Trace 落地后可直接算 |
| 未验证数字率 | `unverifiedNumerics` 为真的答案比例 | `qos_unverified_numerics_total`（`apps/agentcore/src/metrics.ts:121`） | ◐ 有 metric，**无 tenant / 无 skill** 维 |
| 降级率 | agent 诚实降级发生率 | `qos_agent_timeout_total` / `qos_agent_loop_repeat_total` / `qos_agent_budget_exhausted_total`（`apps/agentcore/src/metrics.ts:88-115`） | ◐ 有，**无 tenant** 维 |

### 7.4 汇总：今天到底缺什么

| 判定 | 项 |
|---|---|
| ✅ 有真物且租户隔离 | eval 五项技术指标（`EvalRunReport`）· 决策成效闭环（`DecisionOutcome`）· DRIL 质量分 EWMA |
| ◐ 有 metric 但缺租户/技能维 | 全部生产侧 Prometheus 指标（**无一例外**——两文件零 tenant 命中） |
| 🔴 通道不存在 | 人工修正差量 · Skill 级预测准确率归因 · 金额口径收益 · 生产侧溯源合规率 |
| 🔴 今天算出来是错的 | 人工采纳率（跨租户混算 + 归因不到 skill） |

---

## 8. 分期与验收

> 一 WO 一 fresh dedicated dev；**跨数据/引擎两半的特性必须一个 dev 整单做**（`CLAUDE.md` LOOP 纪律③）。下表每期的「🚦范围边界」即该单的身份。

| 期 | 内容 | 🚦范围边界 | 头号验收判据（SEAM） |
|---|---|---|---|
| **P0-A** | 指标租户维 + skillKey 归因 | `apps/datacore/src/metrics.ts` · `apps/datacore/src/actions.ts` · `apps/agentcore/src/metrics.ts` · `packages/contracts/src/actions.ts` · 新建 `check-metrics-tenant.mjs`（置于 `scripts/`） | 两租户各提交一次 → 两条独立序列，**不得合成 2**（§2.1） |
| **P0-B** | `/metrics` 鉴权 + 租户视图 | `apps/datacore/src/app.ts` · `apps/agentcore/src/server.ts` · `docker-compose.yml` · 同一门脚本 | 无 header → 401/403（两服务）；`X-Service-Token` → 200 |
| **P1** | 权限三面（data/tool/action） | `packages/contracts/src/agentcore.ts` · `packages/contracts/src/features.ts` · `apps/agentcore/src/features/registry.ts` · `apps/agentcore/src/tools/executor.ts` · `apps/agentcore/src/router/orchestrator.ts` · `apps/agentcore/src/skill-lint.ts` · 新建 `check-skill-permission.mjs`（置于 `scripts/`） | §3.6 三条：改 allow 行为真变 · action 越界不落草稿 · **关 feature → intent/solver/skill 三者同时消失** |
| **P2** | Execution Trace + Prompt 版本化 | `packages/contracts/src/prompt-template.ts` · `packages/contracts/src/qos.ts` · `apps/agentcore/src/agent/prompts.ts` · `apps/agentcore/src/engine.ts` · `apps/agentcore/src/router/orchestrator.ts` · 新表迁移（R9 四处） | §4.4 三条：自由问答路 Trace 非空 · 改 override → digest 变且行为变 · **路径 A 的 UP 票落 Trace** |
| **P3** | 生长回路角色门 + R4 审批位 | `apps/agentcore/src/server.ts`（growth 段）· `apps/agentcore/src/growth/` · `apps/datacore/src/actions.ts` · `apps/datacore/src/app.ts`（domainExecutor）· `apps/frontend-shell/src/pages/admin/GrowthCockpitPage.tsx` · 新建 `check-growth-hitl.mjs`（置于 `scripts/`） | §6.5 三条：非 admin 403 且目录零新增 · **审批前不命中 / 审批后真命中** · 驳回不留脏 |
| **P4** | Learning Loop + 消费方 | `packages/contracts/src/decision-kernel.ts`（形态复用）· 新 `skill-outcome` 纯函数 · `apps/agentcore/src/agent/skill-router.ts` · `apps/agentcore/src/dril/quality.ts`（扩列非新表） | §5.5 五条，其中 **②「假采纳率反证」与④「改 weight 排序真变」为不可省** |

**每期共同底线**（`CLAUDE.md`）：
- 四包全绿（`bash scripts/gate.sh`，**禁止** `cmd | tail -n; echo "EXIT=$?"`）。
- 新增门必须并入 `pnpm gates` **并**回写本体 §7（`ontology-writeback:check` 会红）。
- 新表 R9 四处同改（migrations + pg + memory + 接口）。
- 金值/注册即更：新增 ActionType → 同步 `ACTION_WIRING` + `action-wiring:check` 基线。

---

## 9. 诚实边界（本文未核实 / 明确不做的事）

**未核实（实现前须自行核对，本文不据此下结论）：**

1. **审核方实测的 `success 2` 与 `curl /metrics` 200**：本文作者**只读代码未起服务**。代码层证据（`apps/datacore/src/app.ts:838,850,911` · `apps/agentcore/src/server.ts:199` · `apps/datacore/src/metrics.ts:99-101`）与该实测结论一致，但「实测」二字归审核方，不归本文。
2. **`domainExecutor` 是否已有跨系统（A→B）写回先例**：§6.2 的 `growth_intent_publish` 执行器需 A 调 B 的 `publishIntent`。本文未逐条核对 `apps/datacore/src/app.ts` 的 `domainExecutor` 分支是否存在同类形态。若无先例，该 ActionType 的执行器是本仓第一个跨系统写回，须额外考虑幂等/失败重试/服务间凭证——实现单须先确认。
3. **Prometheus 标签基数的真实影响面**：§2.1 提出的基数保护是设计层预案；本文未统计生产租户数量级，也未测量加标签后的内存增长。实现单须给出实测数字。
4. **`skill-router.ts` 的现有打分公式**：§5.3 提出乘子 `finalScore = semanticScore × (0.5 + 0.5 × weight)`，但本文**未读** `apps/agentcore/src/agent/skill-router.ts` 的 `selectSkills` 实现细节，系数与接入点须由实现单据实调整；本文对系数不作硬约束，只对**效果层验收**作硬约束（改 weight → 排序真变）。
5. **出厂 7 个 Skill 补 `permissions` 的具体清单**：SPEC §4 给了它们的字段填充度实测，但每个 skill 该允许哪些工具/动作，需要业务判断，本文不代填。
6. **`docs/PRD-addendum-skill-authoring.md` §0 所列的 `skill-lint:check` / `skill-eval:check` 门名**：本体 §7 已明载「二者**没有** `pnpm` 门名，原稿写的在 package.json 中不存在」。本文 §3.3 说的「并入门禁一」指的是**运行态发布门**（`POST /b/v1/skills/:id/publish` 串联的结构 lint），不是静态 CI 门——请勿据此以为有一个 `pnpm skill-lint:check`。

**明确不做（划清边界，防范围蔓延）：**

7. **不新增分级人工评分（1–5 星）**：二元投票的落盘都还漏一半（路径 A），先把地基补齐（§7.3）。
8. **不定义「成本节省」的金额口径**：`DecisionOption.closesGap` 是能力口径，换算成金额需要业务给定单位价格与折算规则；臆造一个公式会立刻变成第二个「一个事实六个数」（`G-C08-REDLINE-DRIFT` 同族）。
9. **不把 `weight` 用作过滤器**：见 §5.4 末段——用作排序不触 R4，用作过滤则触，本文禁止后者。
10. **不改 `ActionDraft.payload` 提交后不可变**：人工修正走「新建草稿 + `HumanCorrection` 链接」（§5.1），不破坏既有审计语义。
11. **不引第二套 prompt 存储**：Prompt 版本化复用既有 `PromptTemplate`（DataCore 单一真值源，B 经 REST 读，R1），不在 AgentCore 另起。
12. **不重造审批 UI**：生长提案复用既有 approval-inbox 与 `action.pending_approval` 事件（§6.3）。

**订正声明：** 本文 §1.4 与上游 `docs/SPEC-industrial-skill.md` §2-⑫、§4-D 的「生长回路只报不写 / `intents.insert` 调用点里没有它」**结论不一致**。本文据 `apps/agentcore/src/growth/scaffold.ts:54-82` → `apps/agentcore/src/catalog/service.ts:159` 的真实调用链订正为「已写 DRAFT，缺的是角色门与 R4 审批位」。SPEC 该处应随本 PRD 一并更新，否则会误导实现方去重造一个已存在的执行器。

---

## 10. 附录 · 本次核实的事实清单

> 口径：**已核实** = 本会话读过该 `file:line` 或跑过该只读命令；**未核实** = 见 §9。本文不含任何仅凭记忆或推断的「今天是 X」。

### 10.1 已核实（读代码）

| # | 事实 | 锚点 |
|---|---|---|
| 1 | `ActionMetrics` 四方法标签只有 `{action_type, outcome}` | `apps/datacore/src/metrics.ts:99-113` |
| 2 | DataCore `/metrics` 在 `PUBLIC_PATHS` 内 | `apps/datacore/src/app.ts:838` |
| 3 | 鉴权钩子对 `PUBLIC_PATHS` 立即 return（早于任何认证） | `apps/datacore/src/app.ts:850` |
| 4 | DataCore `/metrics` handler 不看 req | `apps/datacore/src/app.ts:911` |
| 5 | AgentCore `/metrics` handler 不调 `auth(req)`（相邻业务端点均调） | `apps/agentcore/src/server.ts:199-202` vs `:212` |
| 6 | `SkillDefinitionSchema` 无任何权限字段 | `packages/contracts/src/agentcore.ts:236-261` |
| 7 | `SKILL_REFERENCE_KINDS` 无 tool/mcp/actionType | `packages/contracts/src/agentcore.ts:216` |
| 8 | `FeatureDef.bindings` 无 skills | `packages/contracts/src/features.ts:16-22` |
| 9 | `intentAllowed`/`solverAllowed` 是「一处判定」的现成形态 | `apps/agentcore/src/features/registry.ts:201,213`（共用 `:187 featureEnabled`） |
| 10 | `selectTenantSkills` 不过 entitlement | `apps/agentcore/src/router/orchestrator.ts:232-240` |
| 11 | 工具 scope 门是 per-Agent 不是 per-Skill | `apps/agentcore/src/tools/executor.ts:135-137` |
| 12 | 唯一的 Skill→工具关联是写模式布尔开关 | `packages/contracts/src/agentcore.ts:201` · `apps/agentcore/src/skill-probe.ts:249-257` |
| 13 | `AgentRunRecord` 无 skill/prompt 版本 | `packages/contracts/src/qos.ts:655-667` |
| 14 | `ToolCallRow` 无 tenantId | `apps/agentcore/src/persistence/repos.ts:38-48` |
| 15 | `RefKind` 已含 `skill`，注册 agent 路真 emit | `packages/contracts/src/refs.ts:9` · `apps/agentcore/src/engine.ts:263,374` |
| 16 | 自由问答路注入技能但不留痕（无 `onResolvedRef`） | `apps/agentcore/src/router/orchestrator.ts:1731-1734` |
| 17 | `AGENT_SYSTEM_CORE` 是代码常量 | `apps/agentcore/src/agent/prompts.ts:5` |
| 18 | `PROMPT_KEYS` 只有 5 个，B 侧只消费 `classifier` | `packages/contracts/src/prompt-template.ts:10` · `apps/agentcore/src/router/orchestrator.ts:1203` |
| 19 | `PromptTemplate` 已有 `version`，端点 admin only | `packages/contracts/src/prompt-template.ts:22-31` · `apps/datacore/src/app.ts:1072-1095` |
| 20 | 生长回路**有**执行器：NO_INTENT → scaffold DRAFT 意图 | `apps/agentcore/src/growth/scenario-grow.ts:93-105` → `apps/agentcore/src/growth/scaffold.ts:54-82` |
| 21 | `createIntent` 恒落 DRAFT 并真 insert | `apps/agentcore/src/catalog/service.ts:150,159` |
| 22 | `/api/v1/growth/run` 无 `requireRole`；目录正门有 | `apps/agentcore/src/server.ts:236` vs `:511-513` |
| 23 | `publishIntent` 端点是 RBAC 直发布，无 Action 审批链 | `apps/agentcore/src/server.ts:528-533` |
| 24 | `ActionDraft.payload` 提交后不可变；`ApprovalStep` 只有 APPROVE/REJECT+comment | `packages/contracts/src/actions.ts:46,19-28` |
| 25 | `ActionDraft.origin` 无 skillKey/skillVersion | `packages/contracts/src/actions.ts:47-51` |
| 26 | 决策成效闭环（预言 vs 实测·外部注入·租户隔离）已存在 | `packages/contracts/src/decision-kernel.ts:33-67` · `apps/datacore/src/decision/kernel.ts:198-239` |
| 27 | `DecisionOutcomeStat.weight` **无求解器消费方** | `apps/datacore/src/solvers/` 零命中；仅 kernel + 读端点 `apps/datacore/src/app.ts:3050` |
| 28 | DRIL 质量分 EWMA 已按 tenantId 隔离 | `apps/agentcore/src/dril/quality.ts` |
| 29 | `EvalRunReport` 带 tenantId + 五项技术指标 | `apps/agentcore/src/evals.ts:170-190` |
| 30 | 路径 A 的 UP/DOWN 反馈只 emit 事件不落盘 | `apps/agentcore/src/router/orchestrator.ts:2413-2423` |
| 31 | `feedback.recorded` 未在事件订阅表登记（违 R10） | `apps/agentcore/src/event-subscriptions.ts` 零命中 |
| 32 | `采纳经营方案` 仍是 `NOT_IMPLEMENTED`（假采纳率的现成陷阱） | `apps/datacore/src/actions.ts:59` |
| 33 | `agent.skill-on-free-qa` 暗发 defaultOn:false | `apps/agentcore/src/features/registry.ts:120` |
| 34 | `GrowthCockpitPage` 只有工单列表 + 认领，无提案审批位 | `apps/frontend-shell/src/pages/admin/GrowthCockpitPage.tsx:44,107` |

### 10.2 已核实（可复跑只读命令）

```bash
# ① 两服务 metrics 文件零 tenant（RC=1 = 零命中）
grep -rn "tenant" apps/datacore/src/metrics.ts apps/agentcore/src/metrics.ts

# ② 全仓零 tenant 标签的计数器自增（RC=1 = 零命中）
grep -rnE "inc\(\s*\{[^}]*tenant" apps/datacore/src apps/agentcore/src --include=*.ts

# ③ 全仓无 prompt 版本概念（零命中）
grep -rn "promptVersion\|prompt_version\|promptHash" apps/ packages/ --include=*.ts

# ④ 生长回路的执行器确实存在（订正 SPEC 用）
grep -rn "scaffoldDraftIntent" apps/agentcore/src

# ⑤ 学习权重无求解器消费方
grep -rn "DecisionOutcomeStat\|aggregateOutcomeStats" apps/datacore/src/solvers/
```

### 10.3 待实现方验证（本文未跑）

```bash
# /metrics 鉴权前置：今天期望 200，修复后期望 401/403
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4001/metrics
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4002/metrics

# 跨租户混算复现：以两个租户各提交一次同型 Action 后
curl -sS http://127.0.0.1:4001/metrics | grep dc_action_submit_total
# 今天期望看到单条合成序列；P0-A 后期望看到两条带 tenant 标签的独立序列
```
