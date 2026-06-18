# PRD · 数据构建发动机页面统一规格（故事→全栈构建的单一观测控制台）

| 项 | 值 |
|---|---|
| 版本 | v0.3 · 状态 DRAFT · 日期 2026-06-18 |
| 取代/扩展 | **收口** `DataBuilderPage` 前端规格；统一三份后端 PRD 的页面表达：`PRD-demand-pulled-growth-engine.md`(§16 驾驶舱·已建 P1–P6) ⊕ `PRD-fullstack-story-build-g8.md`(故事入口/InputManifest/StoryBuildRun) ⊕ `PRD-unified-build-engine.md`(瀑布流逐产物 HITL/全链闭包)。**三页归一**：本页同时**收编 `SyntheticPage`(合成数据页)** —— 合成"生成"降为本页 rawin 的一种填数模式，仅"模拟时钟"留外（见 §3 区 4 + 页面归属决议）。**只规定"页面看到什么"，后端一律复用、不重建。** |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`(§3 链路 / §4 事件失效 / §10 切片) · 上述三份后端 PRD · `docs/PRD-frontend.md`(renderer 分发 §7) |
| 核心一句话 | 把"数据构建发动机页"做成**一页统揽**：输入故事脚本 → **看到 LLM 完整理解** → 看到**倒推要补录什么** → 看到**计划与执行 workflow 逐步瀑布流** → 看到**每个下游模块同步了没有**（本体/连接器/规则/切片/求解器/意图/计划/workflow/agent/skill/mcp/场景，新增了几个、DRAFT 还是已发布、点击即可跳去该模块核对）→ 看到**全链闭包 + 功能缺失自检 + 故事覆盖度 + 验证痕迹（信任"内容完整"）** → 沉淀为**历史推演记录** → **一键「推演」直接落到该故事最可能被触发的真实业务页面（"绿测试≠能用"的现场证明）**。**一切在页面可见、可下钻、可溯源、可亲自跑通。** |

> **这是一份前端规格 PRD**：不新增业务逻辑，不重建任何发动机；只把已有/在立项的后端能力，统一表达为**一个控制台页面**，消除当前 `DataBuilderPage` 与 `/admin/growth` 两张皮。

## 0. 本体引用与影响（强制 · 不填即未读本体）

- **触及对象类型**（本体 §2）：
  - **页面消费（只读展示，不改语义）**：`BuildPlan/BuildJob/ClosureReport/DataBuilderAgent` · `StoryBuildRun/InputManifest`(故事入口 PRD) · `GapReport/GrowthTicket/GrowthLedger`(自成长 PRD) · `SyntheticJob/IndustryTemplate`(合成数据页收编：模板驱动合成填数) · 下游全栈制品 `OntologyType/Link/SliceSpec/Rule/Solver/Connector/RawDataset` ⊕ `Intent/ExecutionPlan/Workflow/Skill/Agent/MCP tool/Scenario`。**`SimulationClock/ClockTickReport`（A8 模拟时钟）不入本页**——属运营时序关切，留时序/运营页。
  - **信任与推演相关（复用平台既有机制）**：`ValidationTrace`（推演验证痕迹：一致性验证 + 交叉验证，`contracts/qos.ts` · 前端 `ValidationTracePanel.tsx`，让用户信任结果，R13）· `Scenario.targetView`（场景落点视图，决定"推演"跳哪页）· `useScenarioLaunch`（场景启动器 P3 已建：注入 presetContext + submitQuery + 对话坞 SSE）· `POST /b/v1/scenarios/:key/launch`。
  - **本 PRD 新增（页面所需的派生投影 / 弱持久）**：`ModuleSyncMatrix`（一次构建对**每个下游模块**的同步快照：模块→{新增/更新/复用计数, DRAFT/PUBLISHED, 制品键, 深链}）—— 由 `StoryBuildRun.producedArtifacts[]` + 领域事件聚合而成（**派生，不是新真值源**）。
- **触及链路**（§3）：本页是**编排链 + 数据→本体→推演链 + 数据构建发动机链**三链产物的**汇合观测点**；消费 §4 全部产出事件来反映"已同步到各模块"。
- **触及事件/数据流**（§4，遵守 R10/D-29 —— **本 PRD 的命脉**）：页面**订阅** `ontology.published` / `materialize.completed` / `rules.updated` / `workflow.published` / `intent.published` / `scenario.published` / `connection.sync_completed` / `dataset.regenerated` / `scaffold.completed`(若立项) / `derivation.completed` / `action.executed` / 自成长 `growth.*` → 在 SLO（事件 60s）内刷新**模块同步矩阵**。**不新增事件**（纯消费侧）。
- **触及不变量**（§5，R1–R14）：
  - **R10 D-29（核心）**：模块同步矩阵是"产出操作必发事件、消费页必订阅"的**可视化成品**——每个模块的"已同步"徽章直接绑对应事件，断链即看得见。
  - **R4 真值经 Action**：页面**显式区分 DRAFT / PENDING_APPROVAL / PUBLISHED**；下游制品在审批前标"草稿（未生效）"，逐产物 HITL 就地批复后才转"已发布"。
  - **R13 结论可溯源（信任=出处+推导可当场亮出）**：每个新增制品卡片**反向链回故事脚本 + BuildPlan 段落 + 生成依据**（"为什么建这个 = 故事第 N 句"）；"推演"结果复用 `ValidationTrace`（一致性 + 交叉验证）让用户信任。
  - **R11 全链闭包（信任"完整"+ 现场证明）**：页面展示 CHAIN/SHAPE BOUND/MISSING + R12 双向闭包（对象落切片/字段被消费/求解器入参存在）+ **故事覆盖度**（每句故事是否映射到制品）；**"推演"按钮在真实业务页跑通建出的场景 = "绿测试≠能用"的活证据**。
  - **R2 tenant_id**：页面只显当前租户构建；元租户 `__platform__` 不在此页。
  - **R14 应用层无业务常数**：页面结构（模块清单/阶段/列）来自配置/本体，不内联电池业务常数；换租户=换配置（守 `debattery:check`）。
- **关闭/影响的已知断点**（§8）：不独立关断点；**使 G-1/G-3/G-5/G-8 的"全链是否真接通"在页面可见**（把"绿测试≠能用"的接缝暴露成 UI）。
- **需走的检测门禁**（§7）：前端无后端门，但页面须**如实呈现**全链闭包门 CHAIN/SHAPE 结果、`scenarioClosure` 无死路结果、GapReport 自检——不得粉饰为"全绿"。`debattery:check`（页面结构无业务常数）。
- **回写承诺（跨分支纪律）**：纯前端规格，**不回写本体**（不新增对象类型/链路/事件至 `SYSTEM-ONTOLOGY.md`）；`ModuleSyncMatrix` 为派生投影，若落地需登记则待相关分支合并后**零冲突追加** §2 注记，绝不编辑他人已占用行。

## 1. 目标 / 非目标

### 1.1 目标（全部为"页面可见性"）
1. **一页统揽（三页归一）**：`DataBuilderPage` 成为数据构建发动机的**唯一控制台**，消除与 `/admin/growth`(自成长驾驶舱) 及 `/admin/synthetic`(合成数据页) 的分裂——后两者分别降为本页内嵌区（区 6/区 8）与 rawin 填数模式（区 4）。保留"故事建域"与"快速合成"两个入口，不强迫先写故事才能合成。
2. **故事理解全可见**：展示 comprehend 的**完整 BuildPlan 理解**——LLM 从故事读出的对象类型/规则/求解器/意图/计划/工作流/agent/skill/mcp/场景/数据源/KB，结构化呈现，不是黑盒。
3. **倒推录入可见**：InputManifest 动态补录表单——页面告诉你"还需补哪些字段才能推导"。
4. **计划与执行 workflow 逐步可见**：七阶段瀑布流 `intake→comprehend→gap→rawin→transform→closure→publish`，每阶段**实时状态 + 逐产物卡片**（可展开看明细/diff/逐产物 HITL 批复）。
5. **模块同步矩阵（你强调的核心）**：一张"**下游模块同步状态**"总表——本体/连接器/规则库/切片/求解器/意图/计划/workflow/agent/skill/mcp/场景，每个模块显示**本次新增/更新/复用了几个 + DRAFT/已发布 + 制品名 + 深链跳去该模块管理页核对**。"为匹配故事脚本新增了本体建模、新增了 workflow、agent……"全部在此一目了然。
6. **闭包 + 自检可见**：全链闭包 CHAIN/SHAPE 每段 BOUND/MISSING；GapReport 功能缺失自检；缺的→工单看板。
7. **历史推演记录可见**：StoryBuildRun 时间线，逐条回放（脚本→理解→计划→执行→同步矩阵→闭包→答案）。
8. **信任"内容完整"**：在闭包+自检之上，补 ① **故事覆盖度**（每句故事都映射到了制品吗？未映射片段高亮——证"没遗漏"）② **验证痕迹 ValidationTrace**（一致性验证 + 交叉验证，复用平台既有机制）③ **R12 双向闭包徽章**（对象落切片/字段被消费/求解器入参存在）——三者合起来让用户敢信"生成的是完整的、不是漏了一半的半成品"。
9. **一键「推演」→ 落到真实触发页面**：构建完成后一个「推演」按钮，点击即把该故事的主问句跑一遍 QOS → 解析出意图/场景 → **自动跳转到该故事最可能被触发的业务页面**（`Scenario.targetView`，如规划与平衡/推演与风险/驾驶舱）+ 注入 presetContext 出答案。让用户**亲手在真实页面验证"建出来的东西真能用"**（闭合"绿测试≠能用"）。

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

### 区 4 · 计划与执行瀑布流（复用 unified §5.3 + 扩；**收编合成数据生成**）
- 七阶段 `intake→comprehend→gap→rawin→transform→closure→publish` **瀑布流**，每阶段：状态(PENDING/RUNNING/DONE/FAILED) + **该阶段产物卡片**。
- **`rawin` 填数模式选择器（收编合成数据页 · unified 目标 5 三路统一）**：在 rawin 阶段提供 ④ 选一的填数方式，由需求字段统一驱动——
  - **a. 模板驱动合成**（收编 `SyntheticPage` StepOne：选 `IndustryTemplate` + 规模 + seed → `SyntheticService.runJob`，无 LLM、确定性 R6）；
  - **b. 故事 schema 驱动合成**（无模板时按 `BuildPlan.objectTypes` 现造，故事入口 PRD §3.4）；
  - **c. 上传 Excel/CSV/JSON + 模版上传模式**（`parseXlsx` 三路统一）：上传入口直接给「**下载该对象类型 CSV 模版**」（搬自本体浏览器 `OntologyGraphView downloadCsvTemplate`，模版列=字段全建模源字段）；上传后**对照模版校验列**（缺列/多列/类型不符提示），不符进**隔离区**（`QuarantineRow` SCHEMA_MISMATCH）——回应"连接器入口要有数据模版 + 支持模版上传模式"。
  - **d. 在线数据模版**（按需求字段定义 schema → 下载模版 → 即上述 c 的"按模版上传"闭环）。
  - 四种产物统一为 `Connection+RawDataset`，落点连接器、进区 5 同步矩阵。
  - **生成多少条由"数据量判定阶梯"决定**（故事显式 > 关系基数推断 > scale 档位 > InputManifest 问用户，详 `PRD-fullstack-story-build-g8.md` §3.4）；模式 a/b 的数量来源在此可见、可在区 3 补录调。
- **逐产物卡片**可展开：原始数据需求/字段/切片覆盖/规则/约束/skill/意图/计划/agent；**diff 预览 + 逐产物 HITL「批准/驳回」**（复用就地审批 §6.4 / `GET·POST /a/v1/actions*`）。
- **合成生成报告内嵌**（收编 `SyntheticPage` Report）：rowCounts/规则扫描/派生抽样复算 作为 rawin 产物卡片明细展示，不再另开页。
- 数据来源：`BuildJob.phases` + 逐产物明细 + `POST /a/v1/synthetic/jobs`（模板模式）；实时经事件刷新（R10）。

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

### 区 6 · 完整性、自检与信任（复用自成长 §16 + unified §4 + 既有 ValidationTrace）
> 本区回答用户的"我凭什么信这是**完整**的？"——四个递进信号：
- **① 全链闭包可视化**：故事→意图→计划→求解器(输出形状)→渲染，每段 `BOUND/MISSING`（CHAIN/SHAPE）；任一 MISSING = 不完整、可见。
- **② R12 双向闭包徽章**：对象必落切片（HARD）/ 字段必被消费（SOFT）/ 求解器入参必存在（HARD）——本体级"建全了没有"。
- **③ 故事覆盖度（绿地）**：把故事**逐句**与 BuildPlan 产物对账——每句映射到哪些制品；**未映射的句子高亮标"未理解/未建模"**（呼应 TODO「切片缺失/超域」诊断）。这是"没遗漏"的直接证据，也喂区 7 的下一步。
- **④ 验证痕迹 ValidationTrace（复用）**：构建产物若已可推演，复用 `buildValidationTrace`（一致性验证：实体定义/公理裁决/数字溯源/版本钉 + 交叉验证：结论断言 vs 知识图谱 CONSISTENT/CONFLICT/NO_EVIDENCE），前端 `ValidationTracePanel` 内嵌——R13 的"可视化成品"。
- **GapReport 自检面板**：7 码缺口分类 + QOS 实跑证据（断在哪步）；缺功能 → **GrowthTicket 工单看板**。
- 数据来源：closure findings + 故事覆盖度（BuildPlan↔script 映射）+ `ValidationTrace`（`contracts/qos.ts`）+ 自成长 `GET /api/v1/growth/{probe结果,tickets}`。

### 区 7 · 一键「推演」→ 落到真实触发页面（绿地编排，复用场景启动器）
> 本区回答用户的"这东西**真能用**吗？"——不靠绿测试，靠**亲手在真实页面跑通**。
- **「推演」按钮**（构建完成后高亮）。点击流程：
  1. 取该 `StoryBuildRun` 的**主问句**（故事派生的触发问句 / 主意图）。
  2. 经 QOS `classify → intent → scenario`（复用 orchestrator）解析出**目标场景**；若场景仍 DRAFT，取 `BuildPlan.sceneNeeds[0].targetView` 兜底。
  3. **自动跳转到 `Scenario.targetView`**（规划与平衡 / 推演与风险 / 驾驶舱 …）——"这个故事的问题最可能在这一页被触发"。
  4. 复用 `useScenarioLaunch`：注入 `presetContext` + `submitQuery` → 对话坞 SSE 出答案 + 区 6 的 `ValidationTrace` 一并展示。
- **"最可能哪页"的判定**：以解析出的场景 `targetView` 为准（场景=视图的一等映射，本体 §3 场景/入口链）；多场景时按主意图置信度排序，给"主落点 + 其它候选页"列表。
- **失败也诚实**：若主问句跑 QOS 仍断（区 6 有 MISSING），「推演」按钮显示"当前不可达：断在 <缺口码>"，并链到该缺口的补齐/工单——**不假装能跳**（守"绿测试≠能用"）。
- 数据来源：复用 `POST /b/v1/scenarios/:key/launch` + `useScenarioLaunch`（场景启动器 P3 已建）+ orchestrator classify。

### 区 8 · 历史推演记录（复用故事入口 PRD StoryBuildRun + 扩）
- **时间线**：逐 `StoryBuildRun` 卡片 → 点击回放全过程（区 2–6 的当时快照）。
- 与成长账本并列/合并：账本按"问句↔缺口↔补法"索引,本时间线按"故事↔建域全过程"索引。
- 数据来源：`GET /a/v1/databuilder/runs`。

### 页面归属决议（三页归一，消除三张皮）
- **`DataBuilderPage` = 唯一控制台**（区 1–8）。
- **收编 `/admin/growth`（自成长驾驶舱）**：LOOP/GapReport/账本/工单**降为本页区 6/区 8 内嵌面板**；路由保留为"自成长聚焦视图"或 301 到本页锚点（倾向内嵌合并）。
- **收编 `/admin/synthetic`（合成数据页）**：① "生成"能力（模板/规模/seed）→ **区 4 rawin 填数模式 a**；② 六阶段报告 → 区 4 产物卡片明细；③ 那个"看不到已生成数据"的 UX 痛点 → 直接被**区 5 同步矩阵 + 连接器深链**消解；④ **唯独"模拟时钟控制台"（A8 tick）移出**——它是运营时序、非构建，迁到时序/运营页（本 PRD 不接管）。`/admin/synthetic` 路由降为"快速合成入口"（直达区 4 模式 a，跳过故事）或 301 到本页。
- **⚠ 待决（模拟时钟落点）**：模拟时钟（tick 1d/7d、reset、剧本时间线、tick 报告流：`fetchSimClock`/`tickSimClock`/`fetchTickReports`）移出构建页后**需明确新家**——候选 ① 并入运营调度页 `/admin/ops-schedule`；② 新开"模拟时钟 / 时序推进"页。本 PRD 倾向 ②（职责清晰：A8 模拟时钟 + tick 报告 + `synthetic.tick_completed` 事件驱动 dashboard/risk 刷新自成一页）。**落地前须定夺，勿在融合时遗漏。**
- **保留双入口**：区 1 同时提供「故事建域」与「快速合成」按钮——心智不同（合成=已知模板出 demo/测试数据、无 LLM；故事=有需求倒推全栈），融页但不强迫先写故事。

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
  → 区6 完整性信任四信号：全链闭包(BOUND/MISSING) + R12 双向闭包 + 故事覆盖度(未映射高亮) + ValidationTrace + GapReport 自检/工单
  → 区7 点「推演」→ classify 主问句 → 解析场景 → 跳 targetView 真实业务页 → useScenarioLaunch 注入出答案(亲手验证能用)
  → 区8 整个过程沉淀为 StoryBuildRun → 时间线可回放
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
7. **UI-6 历史推演记录**：区 8 时间线逐 run 可回放全过程快照。
8. **UI-7 三页归一**：`/admin/growth` 与 `/admin/synthetic` 能力在本页可达（内嵌/降为 rawin 模式），无功能丢失；模板驱动合成在区 4 可跑出数据并进区 5 矩阵；模拟时钟不在本页（已迁出）。
9. **UI-8 信任完整**：区 6 显示故事覆盖度（构造一段含未建模片段的故事 → 该句高亮"未理解"）+ ValidationTrace 面板 + R12 双向闭包徽章；闭包有 MISSING 时不显示"完整"。
10. **UI-9 一键推演跳转**：构建一个端到端可跑的场景 → 点「推演」→ **跳转到该场景 `targetView` 页并出答案**（回归：跳对页 + 注入 presetContext + SSE）；构造一个仍缺求解器的故事 → 「推演」显示"不可达：断在 SOLVER_NOT_FOUND"并链到工单（不假装可跳）。
11. **R14**：`debattery:check` 绿（页面结构无内联业务常数）。

### 7.A 验收场景 A1–A5（跨域多跳 · 页面可见性 + 推演落点 + 持久化）
> 与 `PRD-fullstack-story-build-g8.md` §7.A 同一组用例，此处验收**前端表达**：缺口是否在页面列清、能否一键推演落到"项目沙盘推演"、过程是否持久。当前本体缺 Supplier/二级供应商/BOM 对象与对应求解器，故这 5 问验证"如实倒推 + 自动补大部 + 求解器出工单、不假装秒答"。

| 用例 | 区5 模块同步矩阵应显示 | 区6 完整性/自检 | 区7 一键推演落点 |
|---|---|---|---|
| **A1 违约传导** | 切片 +1(共享节点)；求解器扩展不足→工单 | 故事覆盖度命中订单→产线→订单→客户→营收 | 跳 `ProjectSimView`(项目沙盘推演) 出传导面 |
| **A2 断供半径** | **本体 +2(Supplier/BOM)**+链路+数据；求解器缺→工单 | 闭包对"BOM爆炸求解器"段标 MISSING | 缺求解器 → 显示"不可达:SOLVER_NOT_FOUND"+链工单 |
| **A3 毛利根因** | 切片 +1(因果路径)；归因求解器部分→工单 | 覆盖度命中工艺→稼动→物料价→返工 | 跳 推演/根因视图 出归因分解 |
| **A4 瓶颈冲突** | 规则 +N(排产降级)；冲突求解器→工单 | 闭包对"冲突推演"段 MISSING | 跳 项目沙盘推演 出冲突/降级结果或工单提示 |
| **A5 隐性集中度** | **本体 +1(二级供应商)**+反向聚合切片；求解器缺→工单 | 覆盖度命中客户→订单→物料→二级供应商 | 缺求解器 → 诚实"不可达"+工单 |

**A1–A5 页面共同验收点**：① 区2 故事理解结构化展示倒推出的对象/切片/规则/求解器；② 区5 同步矩阵把"新增 Supplier/BOM/二级供应商、新增切片/规则、求解器缺→工单"逐模块列清 + 深链核对；③ 区6 故事覆盖度高亮未映射语义、闭包对缺求解器段标 MISSING（不显示"完整"）；④ 区7「推演」对可跑通的跳 `ProjectSimView` 出答案+ValidationTrace、对缺求解器的诚实显示不可达并链工单；⑤ 区8 每个用例 = 一条 `StoryBuildRun` 持久，可在"项目沙盘推演/历史推演记录"回放。

## 8. 分期
- **P1（骨架 + 理解 + 瀑布流 + 收编合成）**：区 1/2/4 —— 故事输入 + 快速合成入口 + BuildPlan 结构化理解 + 七阶段瀑布流逐产物卡片 + **rawin 填数模式选择器（模板驱动合成收编 `SyntheticPage`，时钟迁出）**。
- **P2（模块同步矩阵 · 核心）**：区 5 —— `producedArtifacts` + `ModuleSyncMatrix` + 事件订阅点亮 + 深链核对 + DRAFT/已发布三态。
- **P3（补录 + 闭包 + 自检 + 信任）**：区 3 InputManifest 表单 + 区 6 全链闭包可视化 + 故事覆盖度 + ValidationTrace + R12 徽章 + GapReport/工单内嵌（合并 `/admin/growth`）。
- **P3.5（一键推演）**：区 7 「推演」按钮 —— classify 主问句 → 解析场景 → 跳 `targetView` + `useScenarioLaunch` 注入出答案（复用场景启动器，不可达时诚实提示）。依赖故事建出的 Scenario 已可启动。
- **P4（历史推演记录 + 合并收口）**：区 8 StoryBuildRun 时间线回放 + 页面归属最终合并 + 指标。
- **依赖**：区 2/3/5/8 依赖 `PRD-fullstack-story-build-g8` 后端(StoryBuildRun/InputManifest/producedArtifacts)；区 6 依赖自成长发动机。**故本页落地需那两条后端先合 main**（见下纪律）。

---

> **施工前置（跨分支纪律）**：本页消费的 `StoryBuildRun/InputManifest/producedArtifacts`(故事入口 PRD) 与 `GapReport/工单/账本`(自成长 PRD) 须先落地。本分支当前只演进文档；实现需待相关后端合 main 后，再 rebase 施工。本 PRD 为**纯前端规格、不回写本体**。
