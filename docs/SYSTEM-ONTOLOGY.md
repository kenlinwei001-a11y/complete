# 系统本体 · 平台自我元模型（"大脑"）

> **这是平台的自我元模型——用平台自己的本体语言（对象类型 / 链路 / 规则 / 行动 / 检测 / 数据流）给平台自身建模。**
> **使用协议（强制）**：任何需求改进或 bug 解决，**先读本文 → 定位涉及的对象类型与链路 → 检查相关不变量 → 走对应检测门禁 → 再动手**。改完若新增/改变了某条链路或事件，**必须回写本文**（本文是系统接线的单一来源）。
>
> 版本 v1.0 · 日期 2026-06-15 · 锚点为 `file:line`（随代码演进需校准）。两系统：**DataCore A**（`apps/datacore`，`/a/v1`，170 端点）· **AgentCore B**（`apps/agentcore`，`/api/v1`+`/b/v1`，88 端点）· **frontend-shell**。

---

## 0. 怎么用这个大脑（read-first 协议）

遇到一个需求/bug，按序：
1. **定位对象类型**（§2）：这事涉及哪些制品（意图？执行计划？求解器？连接器？规则？）。
2. **沿链路追全链**（§3）：从入口到产出，把链路走一遍——**断点常在链路的"接缝"而非模块内部**（参见 §8 已知断点）。
3. **查不变量**（§5）：改动是否违反系统级铁律（tenant_id / entitlement 先于 authz / 真值经 Action / 确定性 / 全链闭包 …）。
4. **走检测门禁**（§7）：闭包门 / validate / 准备度 / 行级过滤 / VLE——改完必须过。
5. **看数据流**（§4）：若产出型操作，必须发对应领域事件，下游消费页必须订阅（D-29）。
6. **回写本文**：新增/改链路或事件 → 更新 §3/§4/§8。

> 核心教训（来自全链审核）：**"绿测试 ≠ 能用"**。单元测试在 mock 下全绿，但链路接缝（跨系统形状、意图→计划接线、场景→答案闭合）断了测不出来。所以分析必须沿**链路**走，不能只看模块。

---

## 1. 顶层地图

```
                    ┌─────────────────────────── frontend-shell ───────────────────────────┐
                    │ 业务视图(规划与平衡/推演与风险/驾驶舱…) · 对话坞 · 管理台(20+页) · 数据构建发动机页 │
                    └───────────────┬───────────────────────────────────┬───────────────────┘
                          /b|api/v1 │ (SSE 不缓冲)                       │ /a/v1
        ┌───────────────────────────▼──────────────┐      ┌─────────────▼───────────────────────────┐
        │ AgentCore B（交互/编排）                   │ OBO  │ DataCore A（数据/本体/推演真值）          │
        │ QOS 编排 · 意图/执行计划 · Agent/Skill ·   │─────▶│ 连接器 · 本体/对象/切片/派生 · 规则 ·     │
        │ Workflow · MCP · 场景入口 · 场景目录       │ 透传 │ Action 审批 · 求解器 · 合成/校准 · 时序 · │
        │ (持久化: agents/skills/workflows/intents/  │ JWT  │ 数据构建发动机 · IAM/权限 · LLM Provider  │
        │  plans/packages/scenes/tasks)              │      │ (持久化: ~75 仓储实体, 见 §2)            │
        └────────────────────────────────────────────┘      └──────────────────────────────────────────┘
                    松耦合：B 只经 A 的公开 REST（OBO 透传用户身份）取数；前端是两系统汇合点。
```

层次（自下而上）：**数据接入 → 本体/对象 → 派生/切片 → 规则/约束 → 求解/推演 → 行动写回 → 意图/计划/场景 → 问句/答案**。

---

## 2. 对象类型目录（系统制品 = 自我本体的"实体"）

> 每条：制品 · 一句话 · 锚点。生命周期统一资源模式多为 `DRAFT→PUBLISHED→RETIRED`。

### A. 数据接入域（DataCore）
- **Connection / Connector**：数据源连接（含 EXTERNAL 类：rest_api/external_feed/generic_jdbc/**mock_external**；file_upload/mock_erp/mock_crm/mock_external 有适配器）· `connectors/registry.ts`。
- **ExternalSignal（外部域 EXT_SIG）**：环境/市场信号一等对象（锂价/镍价/汇率/需求指数/政策/电价；signalKey 键 + value/unit/asOf/source/trend/impact）· domain=`external` · 经 mock_external 连接器同步或合成出厂 · `GET /a/v1/external-signals`（规划体检/建议敏感性输入，P2）· `synthetic/service.ts`,`connectors/registry.ts MOCK_EXTERNAL_DATA`。
- **RawDataset / RawRow**：上传/同步产出的原始表 · `connections`,`rawDatasets`,`rawRows`。
- **DataCategory（数据接入分类）**：把"目前的数据"（对象类型）按锂电业务域归类（销售订单/物料/设备台账…，全部出厂类型恰好归入一类）；每类可设 **系统对接 / 文件上传**（`DataCategorySetting` 按租户持久化覆盖，migration022），文件上传走该类对象类型派生的字段模版（`buildDataTemplates`，可看可下载）· `synthetic/data-categories.ts batteryDataCategories` · `GET /a/v1/data-categories[/:key/template]`、`PUT /a/v1/data-categories/:key/mode`。**字段覆盖铁律**：`batteryCoverageSlices` 为每对象类型生成单实体全字段覆盖切片 → `computeFieldCoverage`（`databuilder/slice-coverage.ts`）证每个非派生字段∈≥1 切片（`GET /a/v1/field-coverage`，battery 域 172/172 100%）。
- **IndustryTemplate**：行业模板（合成数据 GenSpec 来源；battery-manufacturing 等）· `industryTemplates`。
- **SyntheticJob**：合成数据作业（industry×scale×seed 确定性）· `syntheticJobs`。
- **BuildPlan / BuildJob / DataBuilderAgent / ClosureReport**：**数据构建发动机**（七阶段 intake→comprehend→gap→rawin→transform→closure→publish）· `databuilder/service.ts`,`closure.ts`。
- **BuildWorkflowRun（工业级工作流运行时）**：把"故事→建域"从内存 try-块升级为**持久化步骤状态机**——6 步（dry_build→cross_scaffold→publish_build→validation→inference→record），每步状态/尝试/计时/检查点逐步落库（`build_workflow_runs`，migration023，R9 四处）→ **进程崩溃可从未完成步 resume**（已成功步跳过、context 复用）；瞬时失败按 maxAttempts **有界退避重试**（跨系统 scaffold HTTP 标 RetryableStepError）；致命失败止于该步保留现场；业务门未过返回 skip（非错误，标 SKIPPED）。执行状态（工作流跑完）与业务结论（StoryBuildRun.status，可 BLOCKED）两轴分离。引擎与步骤解耦（`databuilder/workflow-engine.ts BuildWorkflowEngine`，步骤是闭包住 AuthCtx 的纯定义）· `databuilder/service.ts runStoryWorkflow/resumeStoryWorkflow`（`runStory` 现统一经此单一执行路径）· `POST/GET /a/v1/databuilder/workflow-runs`、`POST …/:id/resume`。每步状态迁移发 `buildworkflow.*` 到 outbox 作**可观测/审计流**（GET /a/v1/outbox 实时尾随；非缓存失效事件——产出缓存事件仍是已注册的 `storybuild.run_recorded` L15）。**前端时间线**（`DataBuilderPage WorkflowTimelinePanel`，data-testid `wf-timeline`）：逐运行/逐步可视化状态/尝试/计时/检查点/结构化错误，失败/暂停运行一键 `resume` 续跑（自愈），F55 回归。
- **ModuleProvisioner 注册表 + 比对现状（gap_analysis 一等步）**（`databuilder/provisioners.ts`）：把散在 gap 阶段/闭包/scaffold 三处的"需要 vs 已有"收敛成**跨模块统一 diff**——倒推 BuildPlan 的每类配套模块 `EXISTS(复用)/TO_CREATE(需新建)/MISSING(不能自动建→工单)`。**模块全集 = BuildPlan 13 个 need 数组**一一对应 13 个 provisioner（内容类 dataset/kb_doc · 结构类 ontology_type/rule/slice · 代码类 solver[缺即 MISSING] · 跨系统类 intent/plan/workflow/skill/agent/scene/mcp[现状由 scaffold 回执判定]）。**无遗漏保证**：`provisioners.test` 断言"BuildPlan 每个根级数组字段都已登记 + 已注册 provisioner"——新增配套模块未注册即测试红（"倒序"管线强制纳入统一机制）。产物落 `StoryBuildRun.gapAnalysis` + 工作流 `gap_analysis` 步检查点 + 前端 `GapAnalysisTable`（data-testid `wf-gap-analysis`）。`DatasetProvisioner` 的创建后端 = 合成数据模块（合成是某个 provisioner 的后端实现，非并列制品）。
- **QuarantineRow**：异常行隔离区（SCHEMA_MISMATCH/DUP_KEY）· `quarantine.ts`。

### B. 本体/对象域（DataCore）
- **OntologyType / OntologyLink / OntologyVersion / OntologyDraft**：本体类型/链路/快照版本/草稿 · `ontology.ts`,`modeling.ts`。
- **ObjectInstance(objects) / Link(links)**：对象库与对象间链路（带 `origin`: SYNTHETIC/MATERIALIZED/MANUAL）· `domain.ts`。
- **MergeCandidate / ObjectMerge（实体解析 OC1）**：多源同实体 → 归一名称匹配产候选 → 人审合并（golden 存活、被并置 `mergedInto` 只见 golden、links 重指）→ 72h 可 unmerge 还原 · 真值留痕 mergedBy/mergedAt(R4) · `entity-resolution.ts` · 端点 `/a/v1/objects/merge*` · 事件 merge_candidate.created/objects.merged(§4)。
- **PropertyDef / DerivedPropertyDef**：属性 / 派生属性 · `domain.ts`。
- **DerivationSpec / DerivationRun**：派生 DSL（A4，topo 重算）· `ontology-core.ts`。
- **SliceSpec**：本体切片（root + hops，A6 逐跳过滤）· `ontology-core.ts:534`。
- **ObjectPropHistory**：属性时序历史（temporal）· `objectPropHistory`。
- **Domain**：归域（治理）· `domains`。

### C. 规则/约束域（DataCore）
- **Rule（C01–C33…）**：规则 DSL（severity BLOCK/WARN，scopeObjectTypes；算子 AND/OR/NOT/IN/SUSTAIN/**IMPLIES**，IMPLIES=`NOT a OR b` 解析期脱糖）· `ruledsl.ts`,`rules.ts`。catalog §3 **C26–C33 已注册为一等规则**（`battery.ts rules` + `BATTERY_RULE_SCOPES`，此前硬编码在求解器、规则引擎不可见 → 现可解析/可评估/可列出；表达式=违规谓词,复杂算术取去归一化/派生字段如 `Process.yieldFloor`/`Order.daysToStart`；C33 碳护照用 IMPLIES：`NOT (Order.destination=='EU' IMPLIES Order.carbonFootprint<=Order.euCarbonThreshold)`）。
- **RuleDoc / RuleCandidate / ExtractSegment**：规则文档抽取（A2，LLM extraction）· `ruleDocs`,`ruleCandidates`。

### D. 行动/权限域（DataCore）
- **ActionType / ActionDraft**：动作类型 + 草稿（审批后 EXECUTED 才写真值；Phase9B 对象级变更）· `actions.ts`,`app.ts:290`。
- **Policy（A6）**：行级过滤策略（贯穿 query/slice/solver 读出）· `policies`,`authz`。

### E. 求解/推演域（DataCore）
- **Solver（SOLVER_KEYS，28 个）**：确定性求解器（电池域纯函数 compute；末六位 `generic_inference`/`shared_bottleneck`/`concentration_risk`/`margin_attribution`/`supplier_disruption_radius`/`selection_optimize` 为行业无关通用求解器，走对象图而非电池 context；`selection_optimize` 经自托管 CP-SAT sidecar）· `solvers/service.ts:14`,`extended.ts`。注册表（`ontology:check` 门禁核对）：
  `capacity_rollup` `capacity_forecast` `bottleneck_matrix` `risk_timeline` `affected_orders` `plan_audit` `plan_generate` `capex_scenario` `mitigation_select` `outsourcing_split` `maintenance_stagger` `quarterly_gap` `cert_schedule` `kit_readiness` `lta_gap` `inventory_optimize` `changeover_sequence` `quote_margin` `credit_exposure` `carbon_footprint` `yield_diagnosis` `countermeasure_combo` `generic_inference` `shared_bottleneck` `concentration_risk` `margin_attribution` `supplier_disruption_radius` `selection_optimize`（`sop_balance` 是工作流非求解器，走 `/a/v1/sop/*`）。`shared_bottleneck`（PRD-fde §8d/Q4 净室通用求解器）：读对象图按 viaField 把上游对象分组到共享资源，需求和>产能=瓶颈，按 priorityField 判降级；`SolverService.invoke` 拦截，args 字段映射任意本体即用——答"哪些工序/设备瓶颈、谁挤占谁、哪张单降级"。`concentration_risk`（PRD-fde §8c/Q5 隐性集中度）：沿多跳 ref 路径反向聚合,找"多个分散起点都依赖同一根"的暗线单点(客户→订单→物料→二级供应商:哪个供应商被最多客户隐性依赖)。`margin_attribution`（PRD-fde §8 Q3 毛利倒挂根因）：把每个目标对象成本拆成多成本项,算毛利率标记倒挂,按成本项占比定位主驱动并跨倒挂群聚合根因——答"是哪个成本项把毛利拉穿的"。`supplier_disruption_radius`（PRD-fde §8 Q2 断供影响半径）：从断供根沿"谁引用我"反向多跳逐层扇出(物料→订单→客户),算受冲击集合/扩散半径(穿透层数)/叶层敞口;与 concentration_risk 互为反向(一根扇出 vs 多源收敛)。`selection_optimize`（PRD-fde §8d 组合最优化）：**经自托管 CP-SAT sidecar**（OR-Tools, Apache-2.0；services/optimizer）——从对象图取候选项,在 Σweight≤budget 等约束下最大化 Σvalue（0/1 背包族）,给贪心/启发式给不出的**可证最优**;数据不出边界,`OPTIMIZER_BASE_URL` 发现引擎,未配置则报"未接入"(不静默兜底);R6 靠固定 seed + 单线程 + 确定性停止。`generic_inference`（generic-inference P2）包装 `recompute(dryRun+apply)`，`SolverService.invoke` 拦截→对任意已发布本体套假设值前向重算派生 before/after，非纯 compute；`POST /a/v1/solvers/generic_inference/invoke` 与 `/a/v1/inference/whatif` 同源，growth 缺求解器 B 兜底路由到此。
- **SolverParam / SolverParamsHistory**：求解器参数（版本化，校准可改）· `solverParams`。
- **ForecastSnapshot / RiskCase / SopVersion**：预测快照 / 风险案 / S&OP 月度平衡台 · `sop.ts`。
- **Calibration{Pairs,Proposals,History,Forecasts}**：M11 校准引擎（EMA/重放归因/分位）· `calibration/`。

### F. 时序/运营域（DataCore）
- **TsAggSpec / TsAggRun / TsLateArrival**：时序聚合 · `timeseries.ts`。
- **SimulationClock / ClockTickReport**：模拟时钟（A8 tick）· `simulationClocks`。
- **LivedInState**：运营态"活着的"状态 · `livedin/`。
- **OpsSchedule / ScheduledJob / SchedulerRun / ReplayProgress**：运营调度与回放 · `opsteam/`,`replay`。

### G. 治理/平台域（DataCore）
- **Tenant / User**：多租户与用户（IAM，JWT RS256+JWKS）· `tenants`,`auth.ts`。
- **FeatureConfig / DynamicFeature / FeatureAudit**：功能开通（entitlement）· `features.ts`。
- **PromptTemplate（OC6）/ LlmBudget（OC7）/ FactoryCalendar（OC9）/ WritebackEcho（OC5）· 运营完备性平台配置**：① OC6 平台内置提示词配置化（平台默认 `PLATFORM_PROMPT_DEFAULTS` + 租户 override，`resolvePrompt` 生效；`GET/PUT /a/v1/prompt-templates`,migration018）；② OC7 LLM 成本配额（租户 token 软/硬线 → 降级/拒，`GET/PUT/record /a/v1/llm-budgets`,migration019）；③ OC9 工厂日历（净生产窗口扣减：周末+节假日/检修扣除、加班日补回，春节周用例；`/a/v1/calendars/:key{,/net-window}`,migration020）；④ OC5 写回回声抑制（Action 写回登记→源回流对账：同值 `ECHO_SUPPRESSED`/异值 `writeback.divergence`(L5) 告警；`/a/v1/writeback-echoes{,/reconcile}`,migration021）。`contracts/{prompt-template,llm-budget,factory-calendar,writeback-echo}.ts`,仓储四处。
- **ConfigBundle / ImportJob（OC3 环境间配置迁移 + 跨系统 Saga · execution-semantics §3）**：导出本租户配置（首维=featureOverrides，entitlement=可售包形态）为 `ConfigBundle`（带 `platformSchemaVersion`）→ 另一环境导入跑 **Saga 状态机**：`VALIDATING`(schemaVersion major 兼容 + 未知键拒)→`DRY_RUN_OK`(diff vs 目标,冲突=changed)→`APPLYING_A`(DataCore featureOverrides)→`APPLYING_B`(AgentCore,注入客户端)→`COMMITTED`；B 失败→`COMPENSATING`(回滚 A 到导入前)→`COMPENSATED`（Saga 一致）。冲突策略 SKIP/OVERWRITE/FAIL · `config-bundle.ts ConfigBundleService` · `GET/POST /a/v1/config-bundles/{export,import}`(admin) · `import_jobs`(migration017,R9 四处) · `bundle_import` 执行锁。`contracts/config-bundle.ts`。
- **LlmProvider / LlmPurposeBinding**：LLM 供应商 + **用途绑定矩阵**（6 用途 classifier/agent/extraction/modeling/template_gen/compose）· `contracts/llm.ts:205`。
- **Notification / OutboxEvent / IdempotencyRecord**：通知中心 / 事件出箱 / 幂等 · `outbox.ts`。
- **KbDoc / KbChunk**：知识库（索引/检索）· `kb.ts`。
- **ElementRef / ReportedRef**：引用图谱（rule/skill/workflow/plan/agent/mcp/intent 的出向引用）· `refs.ts`。

### H. 交互/编排域（AgentCore）
- **ScenarioPackage**：场景包（`pkg_battery_manufacturing`，目前写死电池）· `mocks/seed.ts:19`。
- **Intent**：意图（触发问句/示例→分类；slots；**planRef→执行计划**；riskLevel）· `contracts/agentcore.ts`。
- **ExecutionPlan / Workflow**：执行计划（kind=PLAN）/ 编排（kind=ORCHESTRATION，含 invoke_agent/mcp）；步骤 query_objects/invoke_solver/evaluate_rules/render · `workflow/executor.ts`。
- **Skill / Agent**：技能（解读能力句）/ 智能体（systemPrompt+tools+skills+ruleBindings）· `agent/loop.ts`。
- **Scenario（一等对象，升级自 ScenarioCard）**：场景为一等主键（scenarioKey/name/domain/targetView/intentKey/mode/defaultAgentId/presetContext/rules/riskLevel/status DRAFT→PUBLISHED→RETIRED/version）· 持久化于 AgentCore `scenarios` 仓储 · 出厂 SCENARIO_CATALOG 启动期幂等 upsert（单一来源）· `contracts/agentcore.ts ScenarioSchema` · `scenarios-catalog.ts:60`。**所有使用 workflow/agent 的场景都在此完整可配（治理铁律）**。
- **SceneEntry（降为投影）**：视图侧投影（**viewKey 为键** · mode 兜底 · defaultAgentId · intentCatalogFilter · suggestedQuestions）· 主键关系反转为 `View ← Scenario.targetView` · `contracts/agentcore.ts:171`。
- **Task / Query**：QOS 任务（SSE 流）· `router/orchestrator.ts`,`api/sse.ts`。
- **GapReport（缺口报告 · 自成长发动机 P1）**：QOS 缺口探针把"客户问句真跑一遍 orchestrator"后的**终态 QueryTask** 映射为结构化缺口（7 码分类法 NO_INTENT/NO_PLAN/NO_SLICE/EMPTY_DATA/NO_RULE/SOLVER_NOT_FOUND/SHAPE_MISMATCH/NO_CAPABILITY + ANSWERABLE/OTHER）· 确定性纯函数 `classifyGap` · `POST /api/v1/growth/probe`（提交→等终态→分类）· `contracts/growth.ts` · `agentcore/growth/probe.ts`。需求拉动自成长的诊断起点（PRD-demand-pulled-growth-engine §5）。 P2：缺数据"真人正门"自动补 `POST /a/v1/growth/fill-data`（确定性生成 CSV→经公开上传门 connectors.upload 导入→RawDataset 可见，与手动上传无差别）+ 就地 Action 审批面板（DataBuilderPage 页内批复，§6.4）。 P3：LOOP `POST /api/v1/growth/run`（探针→补齐(缺数据真人正门/否则出工单)→重跑→收敛，K 有界前端可配；终态 CONVERGED/BOUNDARY/MAX_ROUNDS）· `growth/loop.ts runGrowthLoop`。 P4：成长账本(demand-indexed,GrowthLedgerEntry)+成长工单(厂商中立施工契约 GrowthTicket OPEN→VERIFIED)持久化(仓储四处+migration007)，`GET /api/v1/growth/{ledger,tickets}`。 P5：工单施工闭环 claim→submit→verify(重跑可答→VERIFIED)；CLI 活查询面 `platform tickets/claim/grow`(厂商中立,人与 code agent 共用)；推送事件 growth.ticket_opened(§4 L13)+拉兜底 GET tickets。 P6：自成长驾驶舱前端 `/admin/growth`(运行LOOP+GapReport逐轮+收敛终态+成长账本+工单看板+需求可答率指标) · `GrowthCockpitPage.tsx` · `/b/v1/growth` 别名。
- **StoryBuildRun（故事驱动建域的历史推演记录 · 故事驱动全栈倒推 g8 P1）**：一次"故事脚本→全栈 BuildPlan→闭包→产物→（可选）答案"的端到端建域记录，串 InputManifest/BuildPlan(frozen)/ClosureReport/ScaffoldReceipt/producedConnections/producedDatasets/gapReport · `contracts/storybuildrun.ts`（含 InputManifest、ScaffoldReceipt 两个伴生契约）· `databuilder/service.ts runStory/listStoryRuns/getStoryRun` · `POST/GET /a/v1/databuilder/runs` · 仓储双实现（`story_build_runs`，migration015）· 前端历史推演记录时间线（`DataBuilderPage` sbr-timeline）。**与自成长发动机 `GrowthLedgerEntry` 经 runId 归一为同一"历史推演记录"两面**（构建期⊕运行期，PRD-fullstack-story-build-g8 §9）。P1 已落（持久层+端点+时间线+rawin 去模板化）；P2 已落（InputManifest 倒推补录表单）；P3 已落（跨系统 scaffold：BuildPlan 扩 B 栈需求 + comprehend 故事倒推全栈 + AgentCore `POST /b/v1/internal/scaffold` SERVICE_TOKEN 守闸幂等 DRAFT + DataCore closure 后 A→B 下发、ScaffoldReceipt.fullChainOk 并入终态，R11 跨系统）；P6 已落（存量回填 `POST /a/v1/databuilder/backfill`：`deriveBackfillScripts` 把既有推演能力逆向导出为故事脚本 → 逐条 runStory 补血缘 + 压测报告 BackfillReport）；P4 已落（功能缺失自检 `selfCheckGaps`：MISSING/FAILED → 7 码 GapReport 附 StoryBuildRun.gapReport；压测 `POST /a/v1/databuilder/stress`）；P5 已落（故事脚本自动生成器 `deriveGeneratedScripts` + `GET /a/v1/databuilder/generate-scripts`；推演回填 `runInference`，**§9 归一已落**：注入 `inferenceProbe`（app.ts 配 AGENTCORE_BASE_URL 时=`POST /api/v1/growth/probe` 经 AgentCore QOS orchestrator 实跑，故事整段为主问句）→ answer + `inferenceEvidence=RUNTIME_PROBE`（"建出来的域真能在 QOS 跑通"的活证据，绿测试≠能用）；未配则兜底直调求解器在建好对象上算 → `BUILD_STATIC`（诚实区分未过 QOS 运行时）。inference 可选/backfill 默认开）。**g8 P1–P6 全部落地。** 技术债已清：① 跨系统 HARD 门前置到 publish（dry build→A闭包→scaffold→全链闭合才真建落库，否则拒发布，R11 真阻断）；② comprehend 倒推扩到 workflow/skill/agent（每求解器→工作流+技能+Agent），AgentCore scaffold 全部建 DRAFT → skill/workflow/agent 页配置可见。**统一规格 P2（模块同步矩阵）**：StoryBuildRun 加 `producedArtifacts[]`（{module,kind,key,action:CREATED|UPDATED|REUSED,status:DRAFT|PUBLISHED}，`databuilder/artifacts.ts deriveProducedArtifacts` 确定性聚合 A 栈本体/切片/规则/求解器 ⊕ 连接器差集 ⊕ B 栈 scaffold 回执）；`buildModuleSyncMatrix`（contracts 纯函数派生投影，非新真值源 R13）按 `MODULE_REGISTRY` 聚合为模块同步矩阵 → 前端 `DataBuilderPage` 区5（每模块本次新增/复用计数 + DRAFT/已发布 R4 + 深链核对；**D 逐产物瀑布流**：模块行可展开为逐产物 diff 卡 before→after，DRAFT 产物surface逐产物 HITL 复用就地审批 R4，unified §5.3）。区2 全栈理解分组卡片 + 区4 快速合成（收编合成数据页模板生成）同期落地。**统一规格 P3/P3.5/P4**：① 区6 完整性·自检·信任——StoryBuildRun 加 `storyCoverage[]`（`comprehend.ts deriveStoryCoverage` 复用同一关键词目录逐句对账，未映射=未理解/未建模高亮，"没遗漏"证据）+ 前端全链闭包可视化（CHAIN/SHAPE/OBJECT/DATA/FORWARD 逐段 + R12 双向闭包徽章 HARD/SOFT）+ 推演验证痕迹回写（`buildStoryValidationTrace`：建域成功即把结论依据的输入对象经 `ontology.crossValidate` 反向核对知识图谱 → `StoryBuildRun.validationTrace`（一致性 ALL_PASS + 交叉验证 ALL_CONSISTENT，R6 确定性/R2 隔离），前端 `ValidationTracePanel` 内嵌让用户信任"完整且有据" R13）；② 区7 一键推演——`comprehend` 为求解器场景填真实 `targetView`（affected_orders→risk / capacity_forecast→project，scaffold 出的 DRAFT 场景亦带视图），前端 `InferenceButton` 经 `useQuickLaunch`（场景启动器低层 launch）以故事主问句跑 QOS → 跳 targetView 业务页注入出答案；区6 有 MISSING（闭包未过/自检缺口/跨系统断链）则诚实显示"不可达：断在 <缺口码>"，守"绿测试≠能用"；③ P4 三页归一——自成长缺口工单看板内嵌 `DataBuilderPage`（`db-growth-console`，/admin/growth 保留为聚焦视图）+ 快速合成入口同在，无功能丢失。
- **SystemObjectType / SystemInvariant / SystemBreakpoint / SystemEvent / SystemDomain / SystemSlice / SystemGate / SystemLink（Dogfooding 元层对象 · #12 落库 PoC）**：把本体本身（§2/§3/§4/§5/§7/§8/§10 + `prd-ontology-index.json`）确定性投影为元租户 `__platform__` 的 `ObjectInstance`+`Link`（origin `META`，可溯回 markdown 章节）。markdown 仍单一来源、对象只读派生（R4 豁免）· `meta/parse.ts`(纯解析 R6) + `meta/service.ts MetaOntologyService` · `POST /a/v1/meta/sync`(幂等,发 `meta.ontology_synced` L14) · `GET /a/v1/meta/{ontology,breakpoints/:id,impact}`(**Entitlement 先于 authz**：`requireMetaAccess` 先查 feature `admin.meta-ontology`(默认开)关闭→404 FEATURE_NOT_FOUND,再 MetaAccessPolicy 角色白名单门 403,配置化 P2) · 影响分析 = META links 上轻量 BFS。复用 objects/links 仓储,不新建表（R9）。业务租户经 R2 见不到（PRD-dogfooding-self-ontology）。
- **ValidationTrace（推演验证痕迹）**：凡推演用到本体切片即附于 `Answer.validationTrace`——① 一致性验证（实体定义/公理裁决/数字溯源/版本钉，本体内自动）② 交叉验证（结论对象断言 vs 知识图谱已有事实 CONSISTENT/CONFLICT/NO_EVIDENCE）。让用户信任结果（R13 输出侧纪律的"可视化成品"）· `contracts/qos.ts ValidationTraceSchema` · 组装 `workflow/executor.ts buildValidationTrace` · 前端 `components/Answer/ValidationTracePanel.tsx`。
- **MCP tool / RefReport**：外部工具 / 引用上报。
- **客户端（QOS 入口）**：Web 对话坞（`frontend-shell` QueryDock）· **CLI 对话入口**（`scripts/platform-cli.mjs`：login/ask/scenarios/approve，一句话驱动平台；人与 AI 共用）—— 均为切片 `sys.orch.query_to_answer` 的客户端，复用同一 QOS 管线。

---

## 3. 关系图谱（链路 = 模块间关系）

> `A --关系--> B`。**⚠ = 已知断/弱链（见 §8）**。

**编排链（问句→答案）**
```
Query --classify--> Intent --planRef--> ExecutionPlan --step--> { Solver | SliceSpec | Rule | ActionType | render }
                       │                                              │
                       └─(路径B回退)──> Agent --uses--> Skill          ├ invoke_solver --OBO HTTP--> DataCore Solver
                                              │                        ├ query_objects --> ObjectInstance(A6过滤)
                                              ├ ruleBindings--> Rule    └ evaluate_rules --> Rule(BLOCK 短路)
                                              └ tools--> Solver/MCP
ExecutionPlan --render--> AnswerBlock{ table|kpi|text|rule_violation|action_draft } --SSE--> 前端
                       ├─**B→A 存在性探针（引用闭合·发布门）**：workflow 步骤 solverKey/ruleIds + agent scopeDeclaration.objectTypes
                       │  发布前经 DataCore 校验真实存在（probeMissingRefs，fail-open；不存在=死路拒发布）
                       └─**B→A 交叉验证（推演验证痕迹·运行时）**：用到 resolve_slice 的推演完成时，把结论对象断言
                          --OBO HTTP /a/v1/ontology/cross-validate--> DataCore 对照知识图谱已有事实核对（fail-open），
                          连同一致性检查组装为 Answer.validationTrace（前端 ValidationTracePanel 展示，让用户信任）
```
**场景/入口链**
```
ScenarioCard --view--> View(规划与平衡/推演与风险/…)
ScenarioCard --intentKey--> Intent          ✅ 20/20 接通（种子从目录派生意图+计划，G-1 已修）
ScenarioCard --presetContext--> SessionContext{selectedObjects, presetSlots} --POST /b/v1/scenarios/:key/launch--> Query
                                  ✅ P1 已接通（presetSlots 注入通道 + fillSlots 消费 + launch 端点；20/20 零反问门 scenarios-wiring）；前端启动器待 P3
Scenario --intentKey--> Intent --planRef--> ExecutionPlan · --defaultAgentId--> Agent   ✅ P2 一等对象；**引用闭合「无死路」上架门**（scenarioClosure：意图存在+绑计划+AGENT模式agent已发布，断链拒发布 409）+ computeReferences 反查（Agent/Workflow 页可见"被场景引用"）
SceneEntry --viewKey--> View · --defaultAgentId--> Agent · --intentCatalogFilter--> Intent   （降为投影）
```
**数据→本体→推演链**
```
Connector --produces--> RawDataset --suggest/modeling--> OntologyDraft --publish--> OntologyType/Link/Version
RawDataset --materialize(幂等)--> ObjectInstance --runDerivations--> DerivedProperty
SyntheticJob --gen(seed)--> Connection(合成源)+RawDataset/RawRow --materialize--> ObjectInstance(origin 溯回 rawDatasetId/rowIdx)/Link   ✅ 活数据可溯 P1（synthetic/service.ts；不再凭空落对象）        IndustryTemplate --驱动--> SyntheticJob
ObjectType <--reads-- Solver(入参字段)     ObjectType <--scopes-- Rule     ObjectType --domain--> SliceSpec
SolverParam <--adjusts-- Calibration       Action(EXECUTED) --writeback--> ObjectInstance(props,二次派生)
Connector --upload(.csv/.json/⚠.xlsx-TODO)--> RawDataset    ⚠ 无"数据模版定义"；合成已并入连接器（产 Connection+RawDataset，活数据可溯 P1）
Connector(EXTERNAL/mock_external) --sync--> RawDataset(external_signals) --materialize--> ExternalSignal(domain=external)   ✅ EXT_SIG P1（一等对象+连接器+GET /a/v1/external-signals）
ExternalSignal --敏感性(elasticity)--> 规划指标(毛利/需求/出口营收/成本)   ✅ P2（POST /a/v1/external-signals/sensitivity：Δ指标pp=Δ信号%×elasticity 按 impact 聚合，确定性无副作用）
ObjectInstance --lineage 反查--> RawRow→RawDataset→Connection + 派生口径   ✅ P2 端点（GET /a/v1/lineage/object/:type/:id）+ P3 前端悬浮溯源（LedgerView `<Provenance>` 组件，数据源原始表经 FieldProfilePage 可见）；结果→求解器入参对象 lineage 待后续
```
**数据构建发动机链（需求拉动）**
```
StoryScript --comprehend(LLM)--> BuildPlan{dataSources,objectTypes,rules,solverNeeds(+args 倒推),kbDocs}
  └ **自造求解器名确定性收敛**（`comprehend.ts SOLVER_ALIASES/normalizeSolverKey`，R6）：思维型 LLM 即便给了已注册
    目录(`comprehendSystemWithSolvers`)，仍会按问句语义自造 capacity_feasibility/schedule_impact 等名 →
    闭包 SOLVER_NOT_FOUND、链路 BLOCKED。装配 `assemblePlanBody(...,SOLVER_KEYS)` 时把已知同义名硬收敛到
    平台真实 key（capacity_feasibility→capacity_forecast、schedule_impact→affected_orders、displacement→
    shared_bottleneck、profit_loss→margin_attribution…），使链路闭合不依赖 LLM 措辞；未命中者原样保留→仍作自成长工单浮现。
  └ **FDE 求解器参数自动倒推**（`databuilder/solver-args.ts deriveSolverArgs`，确定性 R6）：从对象类型字段/ref 结构推出
    多跳求解器路径/字段映射（shared_bottleneck/concentration_risk/margin_attribution），写入 `solverNeeds.args`→`planNeeds.args`
    →scaffold `ExecutionPlan invoke_solver step.params.args`→启动器跑此计划即真调求解器**出答案（非空答）**；
    需运行期标量(rootId/budget)的求解器诚实留空（不编造）。闭合 G-3"场景→答案"的求解器入参一环。
BuildPlan --validateClosure--> ClosureReport{反向-对象, 反向-data, 正向-求解器入参}  ⚠ 闭包不含 AgentCore 栈/全链
BuildPlan --gap(幂等)--> 复用已有/标缺  --rawin--> Connector/KB  --transform--> 本体/规则/派生  --publish(Action)--> 真值
  └ **工业级工作流运行时**（`workflow-engine.ts BuildWorkflowEngine`）：上述 HARD 门以**持久化步骤状态机**承载——
    StoryScript→[dry_build→cross_scaffold→publish_build→validation→inference→record] 每步落库检查点 →
    崩溃可 resume（已成功步跳过、context 复用）；瞬时失败有界退避重试；致命失败止于该步保留现场。
    `runStory` 与 `POST /a/v1/databuilder/workflow-runs` 共用同一组步骤（单一执行路径）。**不再是内存 try-块**。
  └ **比对现状 gap_analysis（一等步 · ModuleProvisioner 注册表）**：cross_scaffold 后插入——倒推 BuildPlan
    vs 系统现状 → 跨模块统一 diff（需要/复用/新建/缺）。这是"倒序"管线 query→倒推→**比对现状**→创建 的接缝。
    13 个 provisioner 覆盖 BuildPlan 全部 need 数组，覆盖门强制新模块纳入（`provisioners.ts analyzeGap`）。
```
**平台横切**
```
Tenant --隔离--> 一切读写/事件/缓存键    FeatureConfig --门控(先于authz)--> 端点/视图/求解器
Policy(A6) --行级过滤--> {query_objects, executeSlice, solver 读出}
LlmPurposeBinding --路由--> { classifier:QOS分类 · agent:路径B · extraction:规则抽取/构建 · modeling:建模建议 · template_gen:行业模板 · compose:llm_compose }   ⚠ 用途枚举写死、不可扩展；model 下拉依赖先选 provider
OutboxEvent --驱动--> EventSubscription(§4) --失效--> 前端缓存
```

---

## 4. 数据流与事件失效图（模块间数据关系的单一来源）

> 来源：`apps/agentcore/src/event-subscriptions.ts`（经 `GET /b/v1/event-subscriptions` 下发前端缓存失效路由）。**D-29 铁律**：任何产出型操作（上传/发布/生成/审批/tick）完成**必须**发对应领域事件，下游消费页**必须**订阅并在 SLO（事件 60s / 配置 TTL 5min）内反映。
>
> **F1 全局领域事件交付通道（实时环地基，2026 收口）**：前端 `useDomainEventStream`（挂 `ShellLayout`，登录后常驻）按 `?since` 游标轮询 `GET /a/v1/outbox`（datacore 真实 outbox 馈源，租户隔离 R2），对**任何来源**的领域事件调 `invalidateForEvent`——补上此前"`invalidateForEvent` 仅由发起方自己 mutation 本地触发、跨用户/被动页不更新"的缺口（PROP-1 不重登反映）。`store/eventInvalidation.ts` 的 `EVENT_INVALIDATES` 扩入真实发出的 `synthetic.tick_completed/action.executed/calibration.proposed/calibration.rolled_back/objects.merged`。**E-c 双源（已落）**：AgentCore 新建 `domain_events` 持久化（migration008，R9 四处）+ 发布时 `emitDomainEvent`（intent/agent/workflow/scenario.published+retired）+ `GET /b/v1/outbox` 馈源；前端 `useDomainEventStream` 同时轮询 `/a` 与 `/b` 两源（独立游标、跨源 eventId 去重），B 侧管理配置变更从此也跨会话传播。**E-a（已落）**：`storybuild.run_recorded`。

| 环 | 事件 | 生产者 | 层级 | 失效下游 | 断链审计 |
|---|---|---|---|---|---|
| L1 | `raw_dataset.uploaded` | 连接器上传 | IN_SESSION | raw-datasets, modeling.dataset-picker | DL1 |
| L1 | `ontology.published` | 本体发布 | IN_SESSION | object-types, dashboard, scenario-data, derivation | DL2 |
| L1 | `derivation.completed` | 派生管线 | IN_SESSION | dashboard, risk, scenario-data, object-queries | — |
| L1 | `materialize.completed` | 对象化作业 | IN_SESSION | dashboard, object-queries, scenario-data | — |
| L2 | `ts.ingested` | 时序上传 | IN_SESSION | dashboard.curves, solver-inputs | — |
| L3 | `rules.updated` | 规则发布 | IN_SESSION | rule-library, agent/workflow-editor.rule-bindings | DL3 |
| L4 | `workflow.published` | 工作流发布 | IN_SESSION | intent-editor.workflow-bindings, agent-editor.tool-bindings, workflow-list | — |
| L4 | `agent.published` | Agent 发布 | IN_SESSION | agent-editor.tool-bindings | — |
| L4 | `intent.published` | 意图发布 | IN_SESSION | scene-entry.intent-filter, scenarios, intent-catalog | — |
| L4 | `scene_entry.updated` | 场景入口编辑 | IN_SESSION | scenarios, scene-entries | — |
| L4 | `scenario.published` | 场景发布（升一等对象） | IN_SESSION | scenarios, scene-entries, intent-catalog | — |
| L4 | `scenario.retired` | 场景退役 | IN_SESSION | scenarios, scene-entries, intent-catalog | — |
| L5 | `action.pending_approval` | Action 提交 | NOTIFY | notifications, approval-inbox | — |
| L5 | `action.executed` | Action 写回 | IN_SESSION | dashboard, object-queries | DL4 |
| L5 | `writeback.divergence` | 回声对账 | NOTIFY | notifications, dashboard | DL4 |
| L6 | `calibration.applied` | 校准批准 | IN_SESSION | calibration-report, solver-params | DL5 |
| L7 | `intent.promoted` | 兜底孵化 | IN_SESSION | intent-catalog, fallback-stats | DL6 |
| L8 | `synthetic.tick_completed` | 模拟时钟 tick | IN_SESSION | dashboard, risk, scenario-data, calibration-report | DL7 |
| L8 | `dataset.regenerated` | 合成生成 | IN_SESSION | dashboard, risk, scenario-data, ontology-graph, rule-library | — |
| L8 | `connection.sync_completed` | 连接器同步 | IN_SESSION | dashboard, scenario-data, object-queries | DL9 |
| L9 | `kb.indexed` | 知识库索引 | IN_SESSION | kb-search, search-test | DL10 |
| L10 | `objects.merged` | 实体合并 | IN_SESSION | object-queries, dashboard, search | DL8 |
| L10 | `merge_candidate.created` | 实体解析 | NOTIFY | notifications, merge-queue | — |
| L10 | `quarantine.row_added` | 隔离区入库 | NOTIFY | notifications, quarantine | — |
| L11 | `policy.updated` | 权限变更 | IN_SESSION | dashboard, search, scenario-data, history | DL11 |
| L12 | `features.updated` | 功能开通 | IN_SESSION | workspace, navigation, scenarios, intent-catalog | DL12 |
| L13 | `growth.gap_detected` | 自成长发动机·探针检出缺口（LOOP fill 内发） | IN_SESSION | growth-ledger | — |
| L13 | `growth.fill_proposed` | 自成长发动机·补法分派（缺数据正门/缺求解器 generic_inference B 兜底） | IN_SESSION | growth-ledger | — |
| L13 | `growth.ticket_opened` | 自成长发动机·缺功能落工单（带真实 I/O 契约+本体引用骨架；P5 推送触达；拉兜底=`GET /api/v1/growth/tickets`） | NOTIFY | growth-tickets, notifications | — |
| L13 | `growth.converged` | 自成长发动机·LOOP 收敛（问句现可答） | IN_SESSION | growth-ledger, growth-tickets | — |
| L14 | `meta.ontology_synced` | Dogfooding·系统本体自反投影重物化完成（`POST /a/v1/meta/sync`）→ 失效 `/a/v1/meta/*` 查询缓存 + meta MCP 工具结果 | INVALIDATE | meta-ontology(`/meta/*` 视图) | — |
| L15 | `storybuild.run_recorded` | 数据构建发动机·故事建域记录完成（`runStory`）→ 经 F1 全局通道失效历史推演记录/模块同步矩阵 | IN_SESSION | story-runs | — |
| L16 | `entity.out_of_domain` | 感知层·槽位解析裸串实体在本租户任何已发布类型都解析不到（`router/slots.ts fillSlots`）→ orchestrator 发任务事件 + `perception-metrics.ts` 记误触发率（域外/尝试）+ 取最近邻候选供澄清 | NOTIFY | perception-metrics | — |

> B↔A 缓存：B 对 A 资源缓存 TTL 60s + `{kind}.updated` 事件失效（钩子 `POST /b/v1/internal/invalidate`），传播 SLO ≤60s。

---

## 5. 系统不变量（规则 = 改动不可违反的铁律）

> 来源：根 `CLAUDE.md` + 闭包/审核。违反即返工。

| # | 不变量 | 检测点 |
|---|---|---|
| R1 | **contracts-only-shared**：跨包只依赖 `@platform/contracts`；前端不重定义契约类型 | 构建/评审 |
| R2 | **tenant_id everywhere**：所有读写/事件/缓存键带 tenantId；跨租户 403/404 | 仓储层 |
| R3 | **entitlement 先于 authz**：功能关 = 不存在 → 404 `FEATURE_NOT_FOUND` | `features.ts`/`gate.ts` |
| R4 | **真值写入经 Action 审批**：对象物化/本体变更经 `domainExecutor`（Phase9B），EXECUTED 才落 | `app.ts:290` |
| R5 | **no-secrets-echo**：凭据 AES-GCM 落库，响应仅 credentialRef | 连接器/LLM/MCP |
| R6 | **确定性**：同 (industry,scale,seed) 字节级一致；求解器同输入同输出；测试不依赖网络/时钟/随机；LLM mock | 合成/求解器/构建 freezePlan |
| R7 | **错误信封统一** `{error:{code,message,requestId}}` | 两系统 |
| R8 | **认证**：生产 Bearer JWT（A 签发，B 经 JWKS 验签）；开发 `X-Debug-User`；服务间 `SERVICE_TOKEN` | `auth.ts` |
| R9 | **仓储双实现**：memory(测试)+pg(DATABASE_URL)；新表四处同改(migrations+pg+memory+repo接口) | `repo/` |
| R10 | **D-29 数据流闭环**：产出操作必发事件、下游必订阅（§4） | `event-subscriptions.ts` |
| **R11** | **全链闭包（审核新增，当前部分违反）**：每个 ScenarioCard 必须 Intent+Plan+Solver(输出形状匹配渲染模板)+render 全接通，否则不可上架 | ⚠ 16/20 违反；缺构建时门禁 |
| R12 | **双向闭包（数据构建）**：对象必落切片(反向-对象 HARD)、字段必被消费(反向-data SOFT)、求解器入参必存在(正向 HARD) | `closure.ts` |
| **R13** | **结论可溯源（信任 = 出处 + 推导可当场亮出）**：凡推演结论里的数字必为可溯源对象——悬浮即出 `{来源系统·新鲜度·推导公式·输入因子·关联规则·备注}`（参考 PRD §1.2/§4，与 R12 输入侧"字段全建模"对称的输出侧纪律）。源系统降级时，依赖它的派生数字自动标降级、置信度(P90)随之下调(C09)。覆盖优先级见 `docs/REFERENCE-HTML-INVENTORY.md` 信任章。 | `<Provenance>` + lineage 端点；前端 `provenance.test` |
| R-一致 | **一个事实一个出处**：同一指标在驾驶舱/S&OP/体检口径一致（同一对象库派生），跨视图同值 | 单一对象库 + 聚合下推 |
| **R14** | **应用层无业务常数（多租户）**：前端组件不得内联业务数据/结构/租户专属文案；一律来自本体/WorkspaceConfig/ViewConfig.layout/i18n。换租户=换配置不改代码。守护 G-5 不回潮。 | ✅ `debattery:check`（基线 0：无未声明业务常数；兜底逐行 `// debattery-allow`）；标杆 `DashboardView`/`LedgerView` |

---

## 6. 行动（系统状态变更，多数经 Action 审批）

发布本体(publishVersion) · 物化对象(materialize) · 创建/审批 ActionDraft · 对象级数据变更(Phase9B) · 运行派生(runDerivations) · 生成合成数据(syntheticJob) · 模拟时钟 tick · 校准提案应用(calibration.applied) · 规则发布 · 意图/工作流/技能/Agent 发布·退役 · 场景入口编辑 · 构建发动机 publish · 实体合并 · 隔离行 reprocess/discard · 功能开通配置 · LLM 用途绑定。

---

## 7. 检测/门禁（改动必须过）

- **闭包门**（数据构建）：object/data/forward 三向，HARD 失败拒发布 · `closure.ts`。
- **validate**（工作流/本体）：DAG 环 / 类型 / render 末步 / storageMode 一致性。
- **准备度评分**（实体/子图成熟度）。
- **entitlement 门**：FEATURE_NOT_FOUND（先于 authz）。
- **规则 BLOCK 短路**（工作流步骤遇 BLOCK 终止）。
- **A6 行级过滤**（query/slice/solver 读出）。
- **VLE 闭环验证引擎**（七段断言 + 三覆盖率，独立参照预言机双算）· `validation` · `apps/datacore/src/vle.ts`。七段全覆盖：①接入(GenSpec 行数守恒) · ②对象化(产出>0 + 引用完整性) · ③聚合派生(聚合==明细差分,经 query 路径) · ④规则查全查准(独立 plain-JS 谓词:字段齐备查全 + 植入越线行 C03 查准) · ⑤求解器执行(供需双侧非退化,负载非空跑) · ⑥行动终态(R4:已注册 ActionType 审批链非空,无直写后门) · ⑦校准注入(提案 simulatedMapeAfter<mapeBefore,无反校准)。`assertionCov = 已覆盖规范段/7`（非硬编码 1）；VL7 静态独立性:vle.ts 不 import `solvers/service`/`ruledsl`——参照预言机独立于被测，杜绝"用被测算被测"。
- **断链审计 DL1–DL12**（§4，每个产出环必须有事件+订阅）。
- **`ontology:check` 本体漂移门禁**（治理新增）：事件/求解器/文件锚点/钩子不漂 即 build 红 · `scripts/check-system-ontology.mjs`，`pnpm ontology:check`。
- **`chain:check` 全链闭包门（第一块砖，R11）**：跨系统静态校验"场景声明的求解器 DataCore 必须注册"，否则路径A 全链断（SOLVER_NOT_FOUND）即红 · `scripts/check-chain-closure.mjs`，`pnpm chain:check`。
- **`debattery:check` 去电池锁死门（R14）**：静态扫描前端视图/页内联的业务常数（基地名/型号/工序/产品段）；棘轮基线 `scripts/debattery-baseline.json` 防回潮——命中超基线即红 · `scripts/check-debattery.mjs`，`pnpm debattery:check`。`// debattery-allow` 豁免必要兜底。
- **`prd:check` PRD 库结构化门（治理 #2）**：解析每篇 PRD 的《本体引用与影响》§0 → 写机器可读索引 `docs/prd-ontology-index.json`（PRD↔不变量/断点，需求↔制品↔缺口可查）；校验引用的 R/G 在本体真实存在（悬空引用即红），报告断点 PRD 覆盖与缺口、遗留 PRD 缺 §0（告警） · `scripts/check-prd-ontology.mjs`，`pnpm prd:check`。
- **跨服务联调冒烟**（守护 G-2 + 挡 mock 漂移）：真实 AgentCore HTTP 客户端 ↔ 真实 DataCore · `apps/datacore/test/xservice-smoke.test.ts`。
- **场景接线回归**（守护 G-1）：20 场景全有意图+计划+求解器 · `apps/agentcore/test/scenarios-wiring.test.ts`。
- **本体必读强制**（治理）：CLAUDE.md 铁律 0 + SessionStart 钩子（从 §8 动态注入未修断点，结构上不漂）+ `/ontology` skill。
- **全链闭包门（R11）**：`chain:check` 覆盖"场景↔求解器注册" + SHAPE 输出形状覆盖报告；`validateClosure` 焊进 **CHAIN**（求解器注册）+ **SHAPE**（求解器输出形状↔渲染绑定 `renderBindings`，挡 G-2 跨服务形状）两维。**余**：补齐其余求解器输出形状声明 + BuildPlan 渲染契约自动生成。详 `docs/PRD-unified-build-engine.md`。

---

## 8. 已知断点登记（截至 0614 全链审核）

> 这些是当前 AS-IS 的"断/弱链"，写进本体以免重复踩。详见 `docs/AUDIT-0614-fullchain.md`。

| 编号 | 断点 | 链路位置 | 性质 |
|---|---|---|---|
| G-1 | ~~20 场景仅 4 个端到端可跑（16 无 Intent/Plan）~~ **已修**：种子从 SCENARIO_CATALOG 单一来源派生全部 20 意图+计划（`mocks/seed.ts`），mock 求解器兜底（`mocks/clients.ts`）；195 测试绿。*注：16 个用静态 text 渲染，richer 解读走路径B/skill（后续）* | ScenarioCard→Intent→Plan | ✅ 已修 |
| G-2 | ~~`affected_orders` plan 读 `data.rows/count`，真实返回 `affected/total` → 跨服务 FAIL~~ **已修**：DataCore 补 `rows/count/columns` 别名 `risk.ts:337` | Plan render↔Solver 输出 | ✅ 已修 |
| G-3 | ~~无场景启动器；presetContext 未注入 QOS~~ **◐ 大部修（P1+P2）**：P1 `SessionContext.presetSlots` 注入通道 + `fillSlots` 消费（`slots.ts`）+ `POST /b/v1/scenarios/:key/launch` + **零反问门**（20/20）；**P2 Scenario 升一等持久化对象**（`scenarios` 仓储四处 + 出厂幂等 upsert + DRAFT/PUBLISHED/RETIRED + `scenario.*` 事件 + 管理 CRUD `POST/PUT /b/v1/scenarios`·`/publish`·`/retire`，SceneEntry 降投影）。**待**：前端 ⌘K/目录/首页启动器 + 场景编辑器(P3)。详 `docs/PRD-scenario-launcher.md` | Scenario(一等)↔SceneEntry(投影)↔前端 | ◐ P1+P2 后端闭环已落 |
| G-4 | ~~意图绑定的执行计划无前端创建入口~~ **已修**：CatalogPage ＋新建执行计划（createPlan）、WorkflowsPage/SkillsPage ＋新建按钮 + mock POST handlers；g4 回归测试 + 112 前端测试绿 | Intent→Plan 配置面 | ✅ 已修 |
| G-5 | 应用层电池锁死（**本轮审计量化**：8a 视图结构写死≈9 视图含 DAG · 8b 业务数据进生产 · 8c 文案/i18n 租户专属 · 8d Agent 配置/模型写死 · 8e ✅ `generic-inference` 通用 what-if 已落：`recompute(dryRun+apply)` 在克隆图上前向重算派生、不落真值 + `POST /a/v1/inference/whatif`，行业无关；O4b 回归证明无副作用。注：作用于 compileSpecs 派生本体；合成 demo 走 runDerivations 另一路）→ **撑不起其他租户/行业**。修法见 `docs/PRD-de-battery-multitenant-config.md`（结构←plan/ViewConfig.layout · 数据←API/WorkspaceConfig · 文案←i18n+行业别名 · Agent←表/Provider绑定）+ 新不变量 R14 + `debattery:check` 门 | 本体→生成应用→推演 | ◐ 大部修：8a 结构/8b 数据/8c 文案/8e generic-inference 已落；**`debattery:check` 基线 0**（业务常数全 genericize/config-drive/`debattery-allow` 声明）。通用 UI 文案 i18n 卫生（低价值）：启动器/首页 chrome 已迁入 `locales/zh.ts`（zh.home/zh.launcher），机制就位、其余页渐进迁移 |
| G-6 | ~~Excel parser TODO；合成在独立页；rawin 用独立 genCsv；数据模版/FK 驱动待~~ **✅ 收口（A2）**：`parseXlsx`（node-xlsx）三路统一(csv/json/xlsx)；合成并入连接器；rawin 去模板化统一到 `synthetic/schema-gen.ts`；**在线数据模版**：`synthetic/data-template.ts buildDataTemplates`（从已发布对象类型派生上传列模版、排除派生列、ref 列标注父类型）+ `GET /a/v1/data-templates[/:typeKey]`（列表/单类型 text/csv 下载）；**FK 一致生成**：`generateRelatedDatasets`（依赖序生成父表→收集真实 PK 池→子表 ref 取父表实际 PK，环降级不阻塞；样例可直接试灌、非凭空假值），单表无 ref 与旧 `generateFromSchema` 字节级一致（R6 向后兼容） | Connector→RawDataset | ✅ 三路+生成器统一；数据模版+FK 一致收口 |
| G-7 | LLM 用途枚举写死不可扩展（待 PRD P5）；~~矩阵 model 下拉 stale 绑定显示空白~~ **已修**：已绑 model 不在目录仍可见可选 `LlmProvidersPage.tsx:474` | LlmPurposeBinding | ◐ 部分修（枚举扩展待 PRD） |
| G-8 | 数据构建闭包仅 DataCore 栈、不验全链 → **◐ 大部闭合**：① `chain:check` 跨系统门 ② **ClosureReport 加 CHAIN 维**（求解器需求未注册即 gate FAIL）③ **SHAPE 维（BuildPlan 扩 AgentCore 渲染栈）**：`SOLVER_OUTPUT_SHAPES` + `renderBindings`，`validateClosure` 校验渲染绑定 ⊆ 输出形状（建图期挡 G-2）④ **跨系统 scaffold 闭合（g8-P3）**：BuildPlan 扩 B 栈需求 + comprehend 故事倒推全栈（求解器→计划/意图/场景）+ `POST /b/v1/internal/scaffold`（SERVICE_TOKEN 守闸，幂等 DRAFT scaffold + DRAFT-aware 无死路门 → ScaffoldReceipt）+ DataCore closure 后 A→B 下发、`fullChainOk` 并入 StoryBuildRun 终态（断链→FAILED，R11 跨系统）。**待**：scaffold 前置到 A publish 阻断（当前记录于 StoryBuildRun 终态，A 数据已建）；补齐其余求解器输出形状声明。⑤ **工业级工作流运行时（已落）**：构建执行从内存 try-块升级为持久化步骤状态机 `BuildWorkflowRun`（检查点/可重入 resume/有界重试/逐步可观测，migration023）→ 崩溃不再丢状态、单步可重试、可审计 | BuildPlan→ClosureReport→ScaffoldManifest→B 制品 | ◐ CHAIN+SHAPE+跨系统 scaffold 已闭合；执行已工作流化 |

---

## 9. 演进与维护

- 本文是**接线单一来源**：改动若新增/改变对象类型、链路、事件、不变量、门禁 → **必须同步本文对应章节**，否则大脑过期即失效。
- 治理已落地（不靠自觉）：`CLAUDE.md` 铁律 0（必读）· SessionStart 钩子（每会话动态注入 §8 未修断点）· `pnpm ontology:check`（漂移即红）· `docs/_PRD-TEMPLATE.md`（强制《本体引用与影响》）· `/ontology` skill。
- 相关文档：**`docs/OPERATING-MODEL.md`（协同进化运行模型 = 机制宪法，统摄本体与 PRD）** · `docs/PRD-unified-build-engine.md`（统一构建发动机，全链闭包将补 R11 门禁）· `docs/AUDIT-0614-fullchain.md`（全链审核）· `docs/TODO.md`（排序路线）。
- 远期可**落库**：把本文的对象类型/链路/规则注册为平台自己的 ObjectType/Link/Rule（dogfooding），让"系统本体"也能被切片/校验/推演——即用平台分析平台自身。

---

## 10. 系统自我域 · 域内切片 · 跨域节点

### 10.1 两级域辨析（别混）

- **业务本体域**（`graphmeta.ts:8` GRAPH_DOMAIN）：factory/product/capacity/process/equip/people/quality/forecast/plan ——给**电池业务对象**分组；图谱视角另挂 solver/agent 元节点。**这不是本节对象。**
- **系统自我域**（本节）：平台**机器本身**的功能域——比业务域高一个抽象层，描述"系统由哪些功能簇构成、簇间怎么接线"。本节正式化 §2 的 A–H 分组为"域 + 域内切片 + 跨域节点"。

### 10.2 系统自我域清单（11 域）

| 域 | 范畴 | 主要对象类型（§2） |
|---|---|---|
| **D1 接入域 Ingest** | 数据/故事进系统 | Connector(含 EXTERNAL/mock_external)·RawDataset·**ExternalSignal(外部域 EXT_SIG)**·IndustryTemplate·SyntheticJob·BuildPlan/Job·DataBuilderAgent·ClosureReport·QuarantineRow |
| **D2 本体域 Ontology** | 类型/对象/派生/切片 | OntologyType/Link/Version/Draft·ObjectInstance·Link·PropertyDef·DerivationSpec/Run·SliceSpec·ObjectPropHistory |
| **D3 规则域 Rules** | 约束/规则 | Rule·RuleDoc·RuleCandidate·ExtractSegment·ruledsl |
| **D4 推演域 Solving** | 求解/校准/仿真 | Solver(SOLVER_KEYS)·SolverParam·Calibration*·ForecastSnapshot·RiskCase·SopVersion·generic-inference(TO-BE) |
| **D5 行动域 Action** | 真值写回 | ActionType·ActionDraft·approval·domainExecutor(Phase9B) |
| **D6 权限域 Access** | 隔离/鉴权/门控 | Tenant·User·IAM·Policy(A6)·Feature/Entitlement |
| **D7 编排域 Orchestration** | 问句→答案 | QOS·Intent·ExecutionPlan/Workflow·Skill·Agent·MCP·Task·classify/route/SSE |
| **D8 场景域 Scenario** | 场景/入口/视图 | ScenarioPackage·ScenarioCard·SceneEntry·View·presetContext·launcher(TO-BE) |
| **D9 信息流域 Flow** | 事件/失效/通知 | OutboxEvent·EventSubscription(§4)·Notification·B→A缓存失效·D-29 |
| **D10 运营时序域 Ops** | 时序/时钟/回放 | TsAggSpec/Run·SimulationClock·LivedInState·OpsSchedule·Replay |
| **D11 治理元域 Meta** | 管理其余 10 域 | 系统本体·PRD库·ontology:check·闭包/全链闭包门·CLAUDE.md/钩子/skill |

> D11 是"管理其它域"的元域——协同进化机制（§9 + 运行模型）就活在这里。

### 10.3 域内本体切片（= 可追溯子图，复用 SliceSpec 形态 root→hops）

命名 `sys.<域>.<形状>`；这些切片**就是各域的关键链路**，也是全链闭包门要逐条验证"端到端通"的对象。

| 切片键 | 域 | root → hops（子图） |
|---|---|---|
| `sys.ingest.data_to_object` | D1→D2 | Connector→RawDataset→ObjectType→ObjectInstance→Derivation |
| `sys.ingest.build_closure` | D1 | StoryScript→BuildPlan→ClosureReport→{ObjectType,Rule,Solver需求} |
| `sys.ontology.type_lineage` | D2 | ObjectType→PropertyDef→DerivationSpec→SliceSpec |
| `sys.rules.scope_binding` | D3 | Rule→ObjectType(scope) + Rule→agent/workflow.ruleBindings |
| `sys.solving.invoke` | D4 | Solver→ObjectType(读)→SolverParam（同输入同输出） |
| `sys.solving.calibration` | D4 | Calibration→SolverParam(版本化)→重放 |
| `sys.action.writeback` | D5 | ActionType→ActionDraft→approval→ObjectInstance(props)→Derivation(二次) |
| `sys.access.row_filter` | D6 | User→Role→Policy(A6)→ObjectInstance(过滤) |
| `sys.access.entitlement` | D6 | Feature→{endpoint,view,solver}(门控,先于authz) |
| **`sys.orch.query_to_answer`** | **D7** | **Client(Web对话坞/CLI)→Query→Intent→Plan→Step*→{Solver\|Slice\|Rule}→AnswerBlock→SSE（中枢链=审核全链）** |
| `sys.scenario.launch` | D8 | ScenarioCard→View + →Intent + →presetContext→Query |
| `sys.flow.event_to_refresh` | D9 | OutboxEvent→EventSubscription→ConsumerView（=§4 全表） |
| `sys.ops.tick` | D10 | SimulationClock→tick→{ObjectInstance,TS}→Derivation→dashboard |
| **`sys.meta.change_loop`** | **D11** | **Requirement(PRD)→Ontology(影响分析)→Code→回写→门禁→Release（=协同进化闭环）** |

### 10.4 跨域节点（接缝 = 断点高发区）

横跨多域的对象 = 系统的**接缝**。核心规律：**断点几乎全在跨域节点上**（"断点常在接缝"的形式化）。

| 跨域节点 | 桥接的域 | 关联断点 |
|---|---|---|
| **ObjectType / ObjectInstance** | D2↔D1↔D4↔D3↔D5↔D6（最横切） | 改动涟漪最广 |
| **Solver** | D4↔D7(invoke_solver)↔D2(读对象) | **G-2**（Solver↔Plan 输出形状） |
| **ExecutionPlan/Workflow** | D7↔D1(构建生成)↔D4(调solver) | **G-1**（Intent↔Plan 接线） |
| **Intent** | D7↔D8(场景) | **G-3/G-4** |
| **Rule** | D3↔D7(evaluate)↔D5(BLOCK)↔D4(约束) | — |
| **SliceSpec** | D2↔D7(resolve_slice)↔D6(逐跳过滤) | — |
| **OutboxEvent** | D9↔**所有域**→前端（信息流主干） | D-29 / DL1–DL12 |
| **ActionType/ActionDraft** | D5↔D2(物化)↔D7(create_draft) | R4 不变量 |
| **Policy(A6)** | D6↔D2/D4/D7（读出过滤横切） | — |
| **Feature(Entitlement)** | D6↔**所有域**（门控） | R3 |
| **Tenant** | D6↔**所有域**（隔离） | R2 |
| **BuildPlan/ClosureReport** | D1↔D2+D3+D4+(扩后)D7/D8 | **G-8**（闭包不跨到 D7/D8） |

### 10.5 与机制的联系（为什么这么切）

1. **跨域节点 = 全链闭包门(R11) 的守护焦点**：G-1/G-2/G-8 都坐在跨域节点上 → 闭包门重点验证这些接缝的"形状/接线/可运行"。
2. **跨域切片 = 闭包门的验证对象**：尤其 `sys.orch.query_to_answer`（中枢链）与 `sys.ingest.build_closure`（构建链）——全链闭包门就是"这两条切片必须端到端通"。
3. **域 = 影响分析的单位 + 权限/责任的边界**：一个需求先落到域 → 再沿域内切片定位 → 跨域节点提示涟漪范围。
4. **可落库 dogfooding**：这些切片用平台自己的 `SliceSpec`(root→hops) 形态写 → 未来把系统本体注册为平台对象后，可用平台的 `executeSlice` 真去"切系统自己"、用规则引擎校验系统不变量、用推演做"改这个节点影响哪些切片"的 what-if。**用平台分析平台自身的闭环在此落地。**
