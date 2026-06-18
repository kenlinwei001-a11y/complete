# PRD · 数据构建发动机页面统一规格（故事→全栈构建的单一观测控制台）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-18 |
| 取代/扩展 | **收口** `DataBuilderPage` 前端规格；统一三份后端 PRD 的页面表达：`PRD-demand-pulled-growth-engine.md`(§16 驾驶舱·已建 P1–P6) ⊕ `PRD-fullstack-story-build-g8.md`(故事入口/InputManifest/StoryBuildRun) ⊕ `PRD-unified-build-engine.md`(瀑布流逐产物 HITL/全链闭包)。**只规定"页面看到什么"，后端一律复用、不重建。** |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`(§3 链路 / §4 事件失效 / §10 切片) · 上述三份后端 PRD · `docs/PRD-frontend.md`(renderer 分发 §7) |
| 核心一句话 | 把"数据构建发动机页"做成**一页统揽**：输入故事脚本 → **看到 LLM 完整理解** → 看到**倒推要补录什么** → 看到**计划与执行 workflow 逐步瀑布流** → 看到**每个下游模块同步了没有**（本体/连接器/规则/切片/求解器/意图/计划/workflow/agent/skill/mcp/场景，新增了几个、DRAFT 还是已发布、点击即可跳去该模块核对）→ 看到**全链闭包 + 功能缺失自检** → 沉淀为**历史推演记录**。**一切在页面可见、可下钻、可溯源。** |

> **这是一份前端规格 PRD**：不新增业务逻辑，不重建任何发动机；只把已有/在立项的后端能力，统一表达为**一个控制台页面**，消除当前 `DataBuilderPage` 与 `/admin/growth` 两张皮。

## 0. 本体引用与影响（强制 · 不填即未读本体）

- **触及对象类型**（本体 §2）：
  - **页面消费（只读展示，不改语义）**：`BuildPlan/BuildJob/ClosureReport/DataBuilderAgent` · `StoryBuildRun/InputManifest`(故事入口 PRD) · `GapReport/GrowthTicket/GrowthLedger`(自成长 PRD) · 下游全栈制品 `OntologyType/Link/SliceSpec/Rule/Solver/Connector/RawDataset` ⊕ `Intent/ExecutionPlan/Workflow/Skill/Agent/MCP tool/Scenario`。
  - **本 PRD 新增（页面所需的派生投影 / 弱持久）**：`ModuleSyncMatrix`（一次构建对**每个下游模块**的同步快照：模块→{新增/更新/复用计数, DRAFT/PUBLISHED, 制品键, 深链}）—— 由 `StoryBuildRun.producedArtifacts[]` + 领域事件聚合而成（**派生，不是新真值源**）。
- **触及链路**（§3）：本页是**编排链 + 数据→本体→推演链 + 数据构建发动机链**三链产物的**汇合观测点**；消费 §4 全部产出事件来反映"已同步到各模块"。
- **触及事件/数据流**（§4，遵守 R10/D-29 —— **本 PRD 的命脉**）：页面**订阅** `ontology.published` / `materialize.completed` / `rules.updated` / `workflow.published` / `intent.published` / `scenario.published` / `connection.sync_completed` / `dataset.regenerated` / `scaffold.completed`(若立项) / `derivation.completed` / `action.executed` / 自成长 `growth.*` → 在 SLO（事件 60s）内刷新**模块同步矩阵**。**不新增事件**（纯消费侧）。
- **触及不变量**（§5，R1–R14）：
  - **R10 D-29（核心）**：模块同步矩阵是"产出操作必发事件、消费页必订阅"的**可视化成品**——每个模块的"已同步"徽章直接绑对应事件，断链即看得见。
  - **R4 真值经 Action**：页面**显式区分 DRAFT / PENDING_APPROVAL / PUBLISHED**；下游制品在审批前标"草稿（未生效）"，逐产物 HITL 就地批复后才转"已发布"。
  - **R13 结论可溯源**：每个新增制品卡片**反向链回故事脚本 + BuildPlan 段落 + 生成依据**（"为什么建这个 = 故事第 N 句"）。
  - **R2 tenant_id**：页面只显当前租户构建；元租户 `__platform__` 不在此页。
  - **R14 应用层无业务常数**：页面结构（模块清单/阶段/列）来自配置/本体，不内联电池业务常数；换租户=换配置（守 `debattery:check`）。
- **关闭/影响的已知断点**（§8）：不独立关断点；**使 G-1/G-3/G-5/G-8 的"全链是否真接通"在页面可见**（把"绿测试≠能用"的接缝暴露成 UI）。
- **需走的检测门禁**（§7）：前端无后端门，但页面须**如实呈现**全链闭包门 CHAIN/SHAPE 结果、`scenarioClosure` 无死路结果、GapReport 自检——不得粉饰为"全绿"。`debattery:check`（页面结构无业务常数）。
- **回写承诺（跨分支纪律）**：纯前端规格，**不回写本体**（不新增对象类型/链路/事件至 `SYSTEM-ONTOLOGY.md`）；`ModuleSyncMatrix` 为派生投影，若落地需登记则待相关分支合并后**零冲突追加** §2 注记，绝不编辑他人已占用行。

## 1. 目标 / 非目标

### 1.1 目标（全部为"页面可见性"）
1. **一页统揽**：`DataBuilderPage` 成为数据构建发动机的**唯一控制台**，消除与 `/admin/growth` 的分裂（后者降为本页内嵌区或合并）。
2. **故事理解全可见**：展示 comprehend 的**完整 BuildPlan 理解**——LLM 从故事读出的对象类型/规则/求解器/意图/计划/工作流/agent/skill/mcp/场景/数据源/KB，结构化呈现，不是黑盒。
3. **倒推录入可见**：InputManifest 动态补录表单——页面告诉你"还需补哪些字段才能推导"。
4. **计划与执行 workflow 逐步可见**：七阶段瀑布流 `intake→comprehend→gap→rawin→transform→closure→publish`，每阶段**实时状态 + 逐产物卡片**（可展开看明细/diff/逐产物 HITL 批复）。
5. **模块同步矩阵（你强调的核心）**：一张"**下游模块同步状态**"总表——本体/连接器/规则库/切片/求解器/意图/计划/workflow/agent/skill/mcp/场景，每个模块显示**本次新增/更新/复用了几个 + DRAFT/已发布 + 制品名 + 深链跳去该模块管理页核对**。"为匹配故事脚本新增了本体建模、新增了 workflow、agent……"全部在此一目了然。
6. **闭包 + 自检可见**：全链闭包 CHAIN/SHAPE 每段 BOUND/MISSING；GapReport 功能缺失自检；缺的→工单看板。
7. **历史推演记录可见**：StoryBuildRun 时间线，逐条回放（脚本→理解→计划→执行→同步矩阵→闭包→答案）。

### 1.2 非目标
- 不重建任何后端发动机（comprehend/scaffold/fill-data/LOOP/GapReport/工单/账本一律复用）。
- 不在本页做真值直写（一切经 Action 就地审批）。
- 不展示元租户系统本体（那是 dogfooding PRD 的 `/meta` 页）。
- 不做多人实时协同编辑（本期单人 HITL）。

## 2. 现状与缺口（对照代码，带 file:line）

**已存在（复用）**：
- `apps/frontend-shell/src/pages/admin/DataBuilderPage.tsx`：**仅** 七阶段状态灯 + 闭包数字 + 作业列表（`fetchDataBuilders`/`fetchBuildJobs`/`runDataBuilder`）。
- `/admin/growth` `GrowthCockpitPage`（自成长 P6）：LOOP/GapReport 逐轮/账本/工单/指标——**与构建页分离**。
- `DataBuilderPage` 内嵌就地审批（自成长 P2，§6.4）。
- 事件失效路由 `event-subscriptions.ts`（§4）+ 前端 `invalidateForEvent`（场景启动器 P3 已建）。

**缺口（本 PRD 补，纯前端）**：
- 无**故事理解可视化**：BuildPlan 是 JSON dump，非结构化卡片（unified §1.1.8/§5.3 要求未落，TODO 主线已记）。
- 无 **InputManifest 补录表单**（故事入口 PRD 提，前端未规格化）。
- 无**模块同步矩阵**：看不到"本次为故事新建了哪些本体/workflow/agent、同步到各模块没有、是否已发布"——**这是你要求的核心、目前完全没有**。
- 无**逐产物瀑布流卡片 + 逐产物 HITL**（仅整体状态灯）。
- 页面分裂：构建在 `DataBuilderPage`、自成长在 `/admin/growth`，**无单一控制台**。

## 3. 页面设计（分区规格；标清"复用 / 绿地 / 数据来源"）

> 布局：单页纵向分区（或左导航锚点）。下述每区给「展示 / 数据来源 / 交互」。

### 区 1 · 入口（复用 + 扩）
- **持续输入故事脚本**输入框 + 「自动生成脚本」按钮（复用故事入口 PRD 的自动生成器）+ 「选择历史 run」下拉。
- 数据来源：`POST /a/v1/databuilder/runs`（提交）；`feature.data-builder` 门控（R3）。

### 区 2 · 故事理解（绿地展示）
- 展示 comprehend 的 **BuildPlan 全栈理解**，分组卡片：**数据源 · 对象类型 · 规则 · 切片 · 求解器需求 · 意图 · 计划 · 工作流 · 技能 · Agent · MCP · 场景 · KB**。每组列出"读出的条目"，每条可悬浮看"对应故事原句"（R13 溯源）。
- 数据来源：`StoryBuildRun.buildPlan`（freeze 后）。

### 区 3 · 倒推补录（绿地展示）
- **InputManifest 动态表单**：`source=ASK_USER` 项渲染为补录控件；`REUSE_EXISTING` 给"复用既有连接器/本体"下拉。提交回填续跑。
- 数据来源：`StoryBuildRun.inputManifest`；`PATCH /a/v1/databuilder/runs/:id/inputs`。

### 区 4 · 计划与执行瀑布流（复用 unified §5.3 + 扩）
- 七阶段 `intake→comprehend→gap→rawin→transform→closure→publish` **瀑布流**，每阶段：状态(PENDING/RUNNING/DONE/FAILED) + **该阶段产物卡片**。
- **逐产物卡片**可展开：原始数据需求/字段/切片覆盖/规则/约束/skill/意图/计划/agent；**diff 预览 + 逐产物 HITL「批准/驳回」**（复用就地审批 §6.4 / `GET·POST /a/v1/actions*`）。
- 数据来源：`BuildJob.phases` + 逐产物明细；实时经事件刷新（R10）。

### 区 5 · 模块同步矩阵（绿地 · 本 PRD 的核心交付）
- 一张表，**每行一个下游模块**，列：`本次新增 | 更新 | 复用 | 状态(DRAFT/已发布) | 制品名(可展开) | 去该模块核对 →`。

| 模块 | 同步看什么 | 深链(点击跳去核对) |
|---|---|---|
| 本体建模 | 新增 ObjectType/Link/派生 | 本体浏览器 `/admin/modeling`·图谱 |
| 数据连接器 | 新增 Connection + RawDataset | 连接器页 `/admin/connections` |
| 规则库 | 新增/更新 Rule | 规则库 `/admin/rules` |
| 切片 | 新增 SliceSpec | 切片页 `/admin/slices` |
| 求解器 | 绑定/缺失(→工单) | 图谱 solver 节点 |
| 意图/计划 | 新增 Intent/ExecutionPlan | 目录 `/admin/catalog` |
| 工作流 | 新增 Workflow | `/admin/workflows` |
| 技能 | 新增 Skill | `/admin/skills` |
| Agent | 新增 Agent | `/admin/agents` |
| MCP | 新增 MCP 绑定 | `/admin/mcp` |
| 场景 | 新增 Scenario | 场景目录 `/admin/scenes` |

- **每个"已同步"徽章直接绑对应领域事件**（R10/D-29）：事件到达即点亮，未到/超 SLO 显灰/告警——**把"数据是否真同步到该模块"做成可见信号**，而非假设。
- **DRAFT vs 已发布** 显式区分（R4）：审批前标"草稿（未在该模块生效）"。
- 数据来源：`ModuleSyncMatrix`（`StoryBuildRun.producedArtifacts[]` + 订阅 §4 事件聚合）。

### 区 6 · 全链闭包 + 功能缺失自检（复用自成长 §16 + unified §4）
- **全链闭包可视化**：故事→意图→计划→求解器(输出形状)→渲染，每段 `BOUND/MISSING`（CHAIN/SHAPE）。
- **GapReport 自检面板**：7 码缺口分类 + QOS 实跑证据（断在哪步）。
- 缺功能 → **GrowthTicket 工单看板**（列表/状态/认领）。
- 数据来源：复用自成长 `GET /api/v1/growth/{probe结果,tickets}` + closure findings。

### 区 7 · 历史推演记录（复用故事入口 PRD StoryBuildRun + 扩）
- **时间线**：逐 `StoryBuildRun` 卡片 → 点击回放全过程（区 2–6 的当时快照）。
- 与成长账本并列/合并：账本按"问句↔缺口↔补法"索引,本时间线按"故事↔建域全过程"索引。
- 数据来源：`GET /a/v1/databuilder/runs`。

### 页面归属决议（消除两张皮）
- **`DataBuilderPage` = 唯一控制台**（区 1–7）。`/admin/growth` 的 LOOP/GapReport/账本/工单**降为本页区 6/区 7 的内嵌面板**；`/admin/growth` 路由保留为"自成长聚焦视图"或 301 到本页对应锚点（实现期二选一，本 PRD 倾向**内嵌合并**）。

## 4. 契约 / 端点 / 数据模型（前端为主；contracts-only-shared）
- **复用端点**：`POST/PATCH /a/v1/databuilder/runs*`（故事入口 PRD）· `GET /a/v1/build-jobs`·`/data-builders` · `GET·POST /a/v1/actions*`（就地审批）· `GET /api/v1/growth/*`（自成长）· 各模块只读列表端点（深链核对）。
- **新增契约**：`ModuleSyncMatrixSchema`（`packages/contracts/src/databuilder.ts` 扩；模块→{added,updated,reused,status,artifactRefs[],deepLink}）；`StoryBuildRun.producedArtifacts[]`（{module,kind,key,action:CREATED|UPDATED|REUSED,status:DRAFT|PUBLISHED}）。
- **事件订阅**：前端 `invalidateForEvent` 扩"模块同步矩阵"消费（复用 `GET /b/v1/event-subscriptions` 路由）。

## 5. 关键流程（端到端，页面视角）
```
输入故事脚本(区1) → 区2 看懂了什么(BuildPlan 全栈理解)
  → 区3 倒推补录(InputManifest) → 续跑
  → 区4 七阶段瀑布流逐步点亮 + 逐产物卡片 + 逐产物 HITL 批复(R4)
  → 区5 模块同步矩阵：每建一个制品 → 对应模块行 +1 → 对应事件到达 → 徽章点亮(R10) → 可深链去该模块核对
  → 区6 全链闭包(BOUND/MISSING) + GapReport 自检 + 缺的进工单
  → 区7 整个过程沉淀为 StoryBuildRun → 时间线可回放
```

## 6. 非功能与约定（§5 不变量逐条满足）
- **R10/D-29（命脉）**：模块同步矩阵每格绑 §4 事件，SLO 60s 内反映；断链审计可见。
- **R4**：DRAFT/PENDING/PUBLISHED 三态显式；审批前不显示"已生效"。
- **R13**：每制品卡片反链故事原句 + BuildPlan 依据。
- **R2**：仅当前租户；元租户不入此页。
- **R14**：模块清单/阶段/列来自配置，`debattery:check` 守无业务常数。
- **R1**：`ModuleSyncMatrix` 等契约入 `@platform/contracts`，前端不重定义。

## 7. 验收（DoD · 前端 UI 验收项）
1. `pnpm -r build && pnpm -r test`（含 frontend）全绿；`pnpm gates`(debattery 等)全绿。
2. **UI-1 故事理解**：输一段脚本 → 区 2 结构化展示全栈 BuildPlan（对象/规则/求解器/意图/工作流/agent/skill/mcp/场景），每条可溯回故事原句。
3. **UI-2 补录**：缺 seed/规模 → 区 3 出 ASK_USER 表单；补录续跑。
4. **UI-3 瀑布流逐产物 + HITL**：区 4 七阶段逐步点亮，逐产物卡片可展开 diff + 就地批复（不跳转）→ 物化生效。
5. **UI-4 模块同步矩阵（核心）**：构建后区 5 显示"本体 +N / 工作流 +N / agent +N …"，DRAFT/已发布正确，**点深链跳到对应模块管理页能核对到该制品**；对应事件到达后徽章由灰转亮（R10 回归：发事件→矩阵刷新）。
6. **UI-5 闭包+自检**：区 6 显示全链 BOUND/MISSING + GapReport 7 码 + 缺的入工单。
7. **UI-6 历史推演记录**：区 7 时间线逐 run 可回放全过程快照。
8. **UI-7 单页统揽**：`/admin/growth` 能力在本页可达（内嵌或合并），无功能丢失。
9. **R14**：`debattery:check` 绿（页面结构无内联业务常数）。

## 8. 分期
- **P1（骨架 + 理解 + 瀑布流）**：区 1/2/4 —— 故事输入 + BuildPlan 结构化理解 + 七阶段瀑布流逐产物卡片（接已有 BuildJob.phases）。
- **P2（模块同步矩阵 · 核心）**：区 5 —— `producedArtifacts` + `ModuleSyncMatrix` + 事件订阅点亮 + 深链核对 + DRAFT/已发布三态。
- **P3（补录 + 闭包 + 自检）**：区 3 InputManifest 表单 + 区 6 全链闭包可视化 + GapReport/工单内嵌（合并 `/admin/growth`）。
- **P4（历史推演记录 + 合并收口）**：区 7 StoryBuildRun 时间线回放 + 页面归属最终合并 + 指标。
- **依赖**：区 2/3/5/7 依赖 `PRD-fullstack-story-build-g8` 后端(StoryBuildRun/InputManifest/producedArtifacts)；区 6 依赖自成长发动机。**故本页落地需那两条后端先合 main**（见下纪律）。

---

> **施工前置（跨分支纪律）**：本页消费的 `StoryBuildRun/InputManifest/producedArtifacts`(故事入口 PRD) 与 `GapReport/工单/账本`(自成长 PRD) 须先落地。本分支当前只演进文档；实现需待相关后端合 main 后，再 rebase 施工。本 PRD 为**纯前端规格、不回写本体**。
