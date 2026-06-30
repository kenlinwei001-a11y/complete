# HANDOFF · 人机对话入口 = 配置完整的场景入口（场景级 Agent 接地）

> **来源**：用户在「规划体检」人机对话入口问开放式管理问句「目前达到这个规划的目标，需要做哪些管理事项才能完成？」→ 系统答「请换个问法。本入口仅支持以下预设问题：[20 预设意图]」。用户判断：**该入口没完成预设配置——它需要 agent-first，把本页数据作上下文/数据源，且该 agent 需配齐 规则/意图/skill/MCP/求解器/本体库检索。这只是冰山一角；所有人机对话入口都要作为场景入口完成预设配置。**
>
> **审核方定位（📖读源 + 真跑链路坐实，非 grep 臆断）**：用户诊断属实，且根因在**链路接缝**（断点常在接缝而非模块内部）。下文按本体 read-first 协议给出《本体引用与影响》+ 根因 + 分阶段设计 + FDE 真值判据。

---

## §0 一句话

平台**已有**场景级 Agent 的全部接线骨架（`Scenario` 一等对象带 `defaultAgentId/presetContext/rules/mode/intentKey/targetView`，本体「治理铁律：所有用 workflow/agent 的场景都在此完整可配」），但**绝大多数视图级对话入口的预设配置是空的/半截的**：① mode 落在 `WORKFLOW_ONLY`（命不中 20 预设意图即「请换个问法」拒答），② 即便回落 Path B 也是**通用 agent**、未按场景配置（本页数据上下文 + 场景规则 + skill/MCP/求解器 + 本体切片检索）。**冰山**：这不是「规划体检」一个页面的 bug，是「对话入口未作为场景入口完成配置」的系统性缺口。

---

## §1 本体引用与影响（强制·read-first 协议产出）

- **对象类型（§2.H）**：`Scenario`(一等·`scenarios` 仓储) · `SceneEntry`(视图投影·viewKey 键) · `Intent`(→planRef) · `ExecutionPlan/Workflow` · `Agent`(systemPrompt+tools+skills+ruleBindings) · `Skill` · `Rule`(C0x·一等可编辑·`params`) · `SliceSpec`(本体切片) · `MCP tool`(`mcp__solvers__*`) · `SessionContext`(presetSlots/selectedObjects) · `Task/Query`(QOS SSE)。
- **链路（§3）**：
  - **编排链（问句→答案）**：`Query --classify--> Intent --planRef--> ExecutionPlan`（Path A 快）`└─(路径B回退)──> Agent --uses--> Skill/tools(Solver/MCP)/ruleBindings(Rule)`。
  - **场景/入口链**：`Scenario --intentKey--> Intent` · `--defaultAgentId--> Agent` · `--presetContext--> SessionContext --launch--> Query` · `SceneEntry --viewKey--> View · mode`。
- **不变量（§5）**：R2 租户隔离（场景配置/切片按 tenant）· **R3 Entitlement 先于 authz**（`qos.agent-fallback` defaultOn:true·关→全局 WORKFLOW_ONLY；场景 agent 走 feature 门）· R4 真值经 Action（对话内「采纳→Action 草稿」不直改）· R13 溯源/诚实（答案带 provenance + 「部分数字未能溯源」诚实位）· **R14 零业务常数**（场景 agent 配置必须配置化/派生，不得写死电池）。
- **检测门禁（§7）**：场景引用闭合门 `scenarioClosure`（意图存在+绑计划+AGENT 模式 agent 已发布，断链拒发布）· `ontogenesis:check`（逐卡 plan/solver/rules/intent 静态断言）· 拟新增 `scene-agent-config:check`（见 §4 Phase D）。
- **数据流/事件（§4）**：`scenario.*`(matured/gap_detected/growth_triggered) · QOS SSE(answer.delta/final)。
- **触及断点（§8）**：
  - **G-3（场景启动器/presetContext 注入 QOS·◐）**：本设计**深化 G-3**——从「presetContext 注入通道已通」推进到「**每个对话入口的场景 agent 预设配置完整**」（mode + defaultAgentId + 本页数据上下文 + 规则/skill/MCP/求解器/本体切片绑定）。当前 G-3 的「◐」正卡在这层配置完整性。
  - **G-9（场景卡发育闭环·◐）**：场景 agent 的「配齐」应成为场景 `maturity=GOVERNED` 的一部分——配置半截 = 未发育完成，grow 门须诚实拦。
  - **G-10（规则即引用·◐）**：场景规则（如 plan-audit C15/C16/C18/C21/C23）须经 `ruleBindings` 真绑进场景 agent，对话答案能透出规则裁决（PASS/WARN/BLOCK），非装饰。
- **回写计划（改了链路/断点 → 必回写）**：落地后回写 §2.H（`Scenario` 补「场景 agent 配置完整性」语义）· §3 场景/入口链（补「场景 agent 接地：本页数据切片 + 规则 + 求解器 MCP」）· §8 G-3（细化判据：配置完整性而非仅 presetContext 注入）。

---

## §2 根因（📖读源坐实·链路接缝）

| # | 现象 | 根因（文件:行） | 性质 |
|---|---|---|---|
| R1 | 开放式问句被「请换个问法」拒答 | 该视图 `SceneEntry.mode = WORKFLOW_ONLY`（`orchestrator.ts:209-210` 取 `sceneEntries.byView`，默认 WORKFLOW_FIRST；命不中→`:864 completeWorkflowOnlyMiss`）。`qos.agent-fallback` defaultOn:true（`features/registry.ts:70`）故拒答只能来自 mode 本身 | 配置接缝（mode 选错） |
| R2 | 即便回落 Path B 也答不接地/烧预算 | 回落是**通用 agent**，非场景 agent：未注入本页 `presetContext`/场景切片、未绑场景 `rules`、未限定 skill/MCP/求解器子集 | 配置接缝（agent 未按场景配） |
| R3 | 场景对象有槽但没填 | `Scenario{defaultAgentId,presetContext,rules,mode}` 槽位齐（`scenarios-catalog.ts`·S04 plan_audit_q 带 rules[C15/C16/C18/C21/C23]+presetContext{cashCushion}），但 `defaultAgentId` 多为空、mode 非 AGENT_FIRST、rules 未绑进对话 agent | 配置未完成（非接线缺失） |
| R4 | 系统性（冰山） | 无「每个对话入口都必须是配置完整的场景入口」的强制门 → 配置完整性靠自觉、逐页漂移 | 缺门禁 |

> **关键**：这不是要新建机制——骨架（Scenario 一等对象 + Agent + ruleBindings + 求解器 MCP + slice-planner + presetContext 注入）全在。是**把每个对话入口的场景配置真正填满 + 立门防半截上架**。对齐参考原型设计意图（`docs/reference-prototype-decision-platform.html:3532`「AI 对话 · 基于本页实时数据回答 · 编排 Agent 调用求解器与本体」）。

---

## §3 设计：场景入口配置规范（SceneAgentSpec）

**目标态**：每个人机对话入口 = 一个 `PUBLISHED` 且**配置完整**的场景入口，其对话由**场景级 Agent** 驱动：

1. **mode**：开放式为常态的页（规划体检/驾驶舱/风险看板…）用 **`WORKFLOW_FIRST`**（命中 20 预设意图走 Path A 秒答 · 命不中回落**场景 agent**而非拒答）或 **`AGENT_FIRST`**（纯探索页直接进场景 agent）。**禁止无理由的 `WORKFLOW_ONLY`**（拒答是反模式）。
2. **场景级 Agent（`defaultAgentId` → 一个配置好的 Agent）**，按场景配齐（用户列的「规则/意图/skill/MCP/求解器/本体库检索」逐项落地）：
   - **本页数据作上下文/数据源**：注入 `presetContext`（本页当前 view/选中对象/槽位）+ **场景本体切片**（`SliceSpec`/`slice-planner` 取该场景子图）→ agent 的 `query_*`/`get_object` 在此切片内接地（CL.3 真实类型名）。
   - **规则**：`ruleBindings` 绑该场景规则（plan-audit→C15/C16/C18/C21/C23），对话答案透出规则裁决（G-10）。
   - **意图**：场景的 `intentCatalogFilter` 限定本入口可命中的 Path A 意图子集（20 预设按场景分流）。
   - **skill**：绑该场景的解读 skill（能力句）。
   - **MCP / 求解器**：限定该场景可调的求解器 MCP 工具子集（plan-audit→plan_audit/plan_generate/mrp_netting…），非全集 32。
   - **本体库检索**：agent 经 `discover`/`catalog/search` 在本租户已发布本体内接地（DF.5/DF.11 接地词表）。
3. **诚实位**：场景 agent 答案沿用已验的 `⚠️ 部分数字未能溯源，仅供参考` + `[n]` 溯源标（与 hollow-data 治理同一诚实纪律——见 `REVIEW-hollow-data-iceberg-and-requeue.md`）。
4. **配置化 R14**：`SceneAgentSpec` 是**配置/派生**（每场景一份，零电池写死），换租户/行业经绑定层重映射，不改代码。

> **本设计的「根问题解」（铁律0）**：不是逐页手写 agent（便捷但漂移），而是立 **`SceneAgentSpec` 单一来源 + 出厂幂等播种 + 上架门**，让「对话入口配置完整」结构性可保证、半截配置上不了架。

---

## §4 分阶段（建议 dev 实施顺序）

- **Phase A · 配置审计 + mode 收口（小·先做）**：审计全部视图对话入口的 `SceneEntry.mode` + `defaultAgentId`；把「开放式为常态」页的 `WORKFLOW_ONLY` 改 `WORKFLOW_FIRST`/`AGENT_FIRST`，确保有 `defaultAgentId`。**判据**：规划体检入口问开放式管理问句**不再「请换个问法」**，回落到场景 agent。
- **Phase B · SceneAgentSpec 配齐（核心）**：定义 `SceneAgentSpec`（每场景：systemPrompt 模板 + presetContext + sliceTargets + ruleBindings + skillRefs + solverMcpAllow + intentFilter），出厂幂等播种；先**试点「规划体检」一个场景**做模板，跑通再批量铺到 20+ 入口。**判据**：规划体检 agent 答开放式管理问句时，**真调 plan_audit/plan_generate 求解器 + 评估 C15/C18 + 引本页规划数据**，给出接地的「管理事项」清单（非通用泛答、非烧预算）。
- **Phase C · 接地 + 诚实位（与 hollow-data 治理合流）**：场景 agent 答案注入本页切片接地 + 带溯源/诚实徽章。**判据**：答案每个数字可溯源或诚实标「未溯源」；无凭空业务数（DF.8 接地校验）。
- **Phase D · 防半截上架门（根问题解·防回潮）**：新增 `scene-agent-config:check`——每个 PUBLISHED 视图对话入口须满足 {mode≠WORKFLOW_ONLY 或显式声明只读预设 + defaultAgentId 存在且已发布 + rules⊆已发布 + solverMcpAllow⊆注册表 + sliceTargets 可达}，否则门红。并入 `pnpm gates` + 纳入场景 `maturity=GOVERNED`（G-9）。**判据**：故意留一个半截配置的入口 → 门红拒发布。

---

## §5 FDE 真值判据（审核方据此真跑核发·绝不「绿测试=能用」）

1. **规划体检·开放式管理问句真跑**：真浏览器登录 demo → 规划体检页人机对话问「目前达到这个规划的目标，需要做哪些管理事项才能完成？」→ **得到接地的结构化答复**（引本页规划/财务/物料真值 + 调 plan_audit/plan_generate 求解器 + 透出 C15/C18 规则裁决 + 三条管理事项），**非「请换个问法」、非通用泛答、非预算耗尽兜底**。实拍。
2. **场景内接地**：答案引用的对象/数字落在本场景切片内（plan 域），可溯源；越界实体被接地门拦（DF.8）。
3. **诚实位**：未溯源数字带 `⚠️ 部分数字未能溯源`，不裸渲染冒充真值。
4. **系统性（抽样 ≥3 入口）**：驾驶舱 / 风险看板 / 订单全链 各自的对话入口同样不再拒答、各自接本页数据 + 本场景求解器/规则。
5. **门禁防回潮**：`scene-agent-config:check` 绿；故意造半截配置入口→门红。
6. **不破 Path A**：20 预设意图仍秒答（命中即走确定性 Path A，不被场景 agent 拖慢）。

---

## §6 边界（诚实·不在本单范围）

- 真 LLM 依赖：场景 agent 开放式答案需真 LLM provider（Kimi 等）配置；mock 环境只验路由/接地/配置 plumbing，富答案由真 Kimi env-gated 验（既有 WO-Q1 范式）。
- 不自动发布意图/计划（R4 墙）：场景 agent 配置经正门发布，不绕审批。
- 与 hollow-data 治理（item 1）合流于「接地 + 诚实位」，但二者独立可并行。

---
*审核方设计交付（design+review·非 dev 实装）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
