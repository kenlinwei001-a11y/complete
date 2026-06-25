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
- **Connection / Connector**：数据源连接（含 EXTERNAL 类：rest_api/external_feed/generic_jdbc/**mock_external**；file_upload/**prototype_html**/mock_erp/mock_crm/mock_external 有适配器）· `connectors/registry.ts`。**prototype_html（PROTOTYPE 类，DF.13c P3 导入正门）**：把上传的原型 HTML 当"文件型数据源"——`PrototypeHtmlAdapter` 经 `extractPrototypeDatasets` 把内嵌 `const NAME=[...]` 多表全量行落 RawDataset（与 file_upload 同走 createConnection→discoverSchema→sync 既有数据流，**不写死前端**），数据连接器可见此"导入文件" + field-profile 在线查看每张表（值与原型一致 R6）。
- **ExternalSignal（外部域 EXT_SIG）**：环境/市场信号一等对象（锂价/镍价/汇率/需求指数/政策/电价；signalKey 键 + value/unit/asOf/source/trend/impact）· domain=`external` · 经 mock_external 连接器同步或合成出厂 · `GET /a/v1/external-signals`（规划体检/建议敏感性输入，P2）· `synthetic/service.ts`,`connectors/registry.ts MOCK_EXTERNAL_DATA`。
- **RawDataset / RawRow**：上传/同步产出的原始表（RawDataset 带 `sourceCategory` = 来源连接 category，溯源 A11）· `connections`,`rawDatasets`,`rawRows`。
- **Connection.category（A11 per-connection 归类）**：连接**实例**级来源系统类（ERP/CRM/EXTERNAL/KB/FILE… 注册表 category 并集，**允许自定义值** R14）——创建时默认取连接器类型 registry category、可覆盖；`GET /a/v1/connector-categories`（内置并集 + 本租户已用值）· `connection.created` 事件（带 category，§4 L8）· `domain.ts Connection.category` + `connectors/registry.ts connectorCategories()`。与 DataCategory（对象类型按业务域归类）正交、可联动喂 A4 浏览器。
- **DataCategory（数据接入分类）**：把"目前的数据"（对象类型）按锂电业务域归类（销售订单/物料/设备台账…，全部出厂类型恰好归入一类）；每类可设 **系统对接 / 文件上传**（`DataCategorySetting` 按租户持久化覆盖，migration022），文件上传走该类对象类型派生的字段模版（`buildDataTemplates`，可看可下载）· `synthetic/data-categories.ts batteryDataCategories` · `GET /a/v1/data-categories[/:key/template]`、`PUT /a/v1/data-categories/:key/mode`。**字段覆盖铁律**：`batteryCoverageSlices` 为每对象类型生成单实体全字段覆盖切片 → `computeFieldCoverage`（`databuilder/slice-coverage.ts`）证每个非派生字段∈≥1 切片（`GET /a/v1/field-coverage`，battery 域 172/172 100%）。
- **业务实例册单一来源 BASE_REGISTRY / SEG_REGISTRY（跨包共享基地册/应用细分，DF.1–DF.3，`packages/contracts/src/base-registry.ts`）**：把曾散在三处（datacore `synthetic/battery.ts` BASES · 前端 `mocks/fixtures.ts` BASES · `mocks/simSolvers.ts` MOCK_BASES）+ 多处内联的 12 基地（`CanonicalBase{baseId,name,kind,position,lon,lat,util,gwh,bottleneck,lines,prodYear,mainProduct}`，命名以 HTML 原型为准）与 3 应用细分（`CanonicalSeg{seg,key,priceWan,marginPct,floorPct,color}`：乘用车/储能/商用车）收敛成 **`@platform/contracts` 单一来源**，全消费端经 `.map()`/`Object.fromEntries` **派生**（搬家不改值，R6 字节一致）。根因修：从"改一处基地/价利须手改前后端三处、漏改即崩"（G-5/R14 漂移）→"改 registry 一处、消费端自动同步"。门禁 `boundary-singlesource:check`（§7）守不回潮。SEG 价/利来源于原型（乘 2.2/18·储 1.4/13·商 1.8/15 万、floor），消费端 datacore `synthetic/battery.ts`+`solvers/risk.ts`、前端 `OrderChainView.tsx`+`simSolvers.ts`。**DF.7 边界影响图**（`BOUNDARY_IMPACT`，同文件）：显式登记"改某册波及谁"以回答铁律0「改 X 影响什么」——`members` 派生自册长、`consumers` 镜像门强制的派生消费端、`downstream` 是 grep 核实的下游面（geo-map 视图/capacity 求解器 perBaseRows/MODEL_BASE_MAP · order-chain econTable/risk affectedOrders.revenue/DemandSegment 派生）；`GET /a/v1/boundary/impact?registry=`；防漂哨兵 `boundary-impact.test`（逐条复核 consumer 在源文件确实派生，与门同口径）。**DF.4 规划目标阈值单一来源 `PLAN_GOAL_TARGETS`（同文件）**：plan_generate 经营目标基线（revGrowth/gmFloor/share/capex/cash/turns）曾**三处重复**（后端 `battery.ts planGenerate.targets` 小数口径 · 前端 `PlanGenerateView DEFAULT_GOALS` 兜底 · `fixtures.ts planGoals` mock 下发）→ 收敛单一来源（canonical 百分口径，后端 ÷100 派生 gmFloor，R6 字节复现 0.155）；扩 `boundary-singlesource` 门 + `BOUNDARY_IMPACT`。**经核实不入册**：审计阈值 `audit.*` 与方案库 `risk.mitigations` 只在 battery.ts 一处、前端经 solver API 消费 → 已单一来源（迁=纯搬家且 audit 校准耦合，无去漂价值）。**DF.10 边界册版本化**（`boundaryVersion()`，同文件）：semver（结构变更手 bump）+ 各册内容指纹（djb2 纯 JS，R6 同内容同 digest）→ 改任一业务常数即 digest 变，作改值留痕/跨服务缓存失效锚（呼应 DF.7「改 X」的时间维）；`GET /a/v1/boundary/version`。**DF.11 接地词表自本体自成长**（`solvers/service.ts deriveGroundingVocab`）：DF.8/DF.9 接地词表从静态册基底 → 自动抽已发布本体 `searchable` 字段（A3 名称类业务字段）实例名 → 新建业务域实体自动纳入接地，不必手改册（R2 仅本租户 / R6 排序去重 / 空本体退化静态册向后兼容）。**DF.12 边界册治理面板**（前端 `pages/admin/BoundaryPage`，`/admin/boundary`，admin 角色）：只读可视消费 `GET /a/v1/boundary/{impact,version}`——版本指纹（改值留痕）+ 三册（BASE/SEG/PLAN_GOAL）影响图（每册派生消费端 + 下游受影响面），回答铁律0「改 X 影响什么」；nav 入"建模与图谱"组（ADMIN_NAV `boundary`）。门B Playwright 真验。
- **订单/型号/客户集 = HTML 原型单一真相源（PRD-IND-order-aggregate 整体重播）**：出厂 battery 种子的 **Order/Model/Customer 集以原型为准**——`battery.ts HTML_ORDERS` 24 单逐字（SO-3391…SO-3540，so/cust/model/qty/due/pri），`MODELS` 6 型号（4680-NCM/2170-NCM/方形-NCM/方形-LFP/圆柱-LFP/4680-LFP，`MODEL_BASE_MAP` 确定性可产基地），`battery-extended.ts custNames` 8 客户（整车厂A/B/C·海外车企E·商用车集团G·储能集成商D/H·电网公司F，与订单 cust 对齐故 `order_of_customer` 可连）。`forecastStart=2026-06-10`（原型 T0，越线日/dueDay/逐日轴全口径锚）。规模测试 M/L/XL 以 24 单为语义基底 + rng 补足到 `orderCount`（XL=10000）。**应用细分按客户名判定（segOfCust，PRD §4.5-B）**：含「商用车」→com·含「储能/电网」→ess·否则 pas（替代旧按型号 essModels/comModels），`affected_orders` 营收/毛利/问题归类全经此。**ORDER_OVR 6 单越线注入（PRD-IND-dash，已激活）**：`affected.problems.overrides` 按 so 覆盖信用/毛利（SO-3437/3506/3540 信用 credit·SO-3470/3458/3518 压价 mAdj，含 why 文案）→ 台账确定性出现"未接/提价接"。**R8/R6**：CJK 型号 id 不再被对象 id sanitize 折叠（`service.ts` 用 `/[^\p{L}\p{N}_-]/gu` 保 CJK，方形/圆柱-LFP 不碰撞）。门B Playwright 真验（order 视图渲染 HTML 24 单 + 6 override why 经 API 核实 + 无旧数据泄露）；datacore 641 / frontend 226 全绿。
- **IndustryTemplate**：行业模板（合成数据 GenSpec 来源；battery-manufacturing 等）· `industryTemplates`。
- **SyntheticJob**：合成数据作业（industry×scale×seed 确定性）· `syntheticJobs`。**A6 拟真值域 + 越线植入**：通用合成路 `genValue` 加 `valueDomain` 支（按业务可信区间 + 分布形 normal/banded/uniform 产值，值域库 `synthetic/value-domains.ts` 按属性语义配置化 R14）；`PlantSpec` + `applyPlantCrossings` 在固定索引确定性植入越线/近边界样本（喂 VLE ④查准 + 推演戏剧点），**opt-in**（模板声明 `plants` 或 `autoPlant`，否则字节一致 R6 向后兼容）；`autoPlant` 从 BLOCK 规则违规谓词 `derivePlantFromRule` 反推默认 PlantSpec。电池路 `generateBattery` 未改（字节保持；收编同机制为后续）。契约 `GenSpec.valueDomain`/`PlantSpec`（contracts/datacore.ts）。
- **BuildPlan / BuildJob / DataBuilderAgent / ClosureReport**：**数据构建发动机**（七阶段 intake→comprehend→gap→rawin→transform→closure→publish）· `databuilder/service.ts`,`closure.ts`。
- **BuildWorkflowRun（工业级工作流运行时）**：把"故事→建域"从内存 try-块升级为**持久化步骤状态机**——6 步（dry_build→cross_scaffold→publish_build→validation→inference→record），每步状态/尝试/计时/检查点逐步落库（`build_workflow_runs`，migration023，R9 四处）→ **进程崩溃可从未完成步 resume**（已成功步跳过、context 复用）；瞬时失败按 maxAttempts **有界退避重试**（跨系统 scaffold HTTP 标 RetryableStepError）；致命失败止于该步保留现场；业务门未过返回 skip（非错误，标 SKIPPED）。执行状态（工作流跑完）与业务结论（StoryBuildRun.status，可 BLOCKED）两轴分离。引擎与步骤解耦（`databuilder/workflow-engine.ts BuildWorkflowEngine`，步骤是闭包住 AuthCtx 的纯定义）· `databuilder/service.ts runStoryWorkflow/resumeStoryWorkflow`（`runStory` 现统一经此单一执行路径）· `POST/GET /a/v1/databuilder/workflow-runs`、`POST …/:id/resume`。**异步执行**（`async:true`）：提交即返回初始 RUNNING 快照（202），引擎 `setImmediate` 后台脱离请求驱动、逐步落库检查点，客户端轮询 GET 观察进度；进程死亡留 RUNNING → `POST …/recover`（启动恢复：把孤儿 RUNNING 逐个 resume 续跑，幂等）。前端**配置化实时刷新**（`wf-live` 选择器：关闭/0.5s/1s/2s/5s；有 RUNNING 自动兜底轮询）→ 异步执行逐步实时跳动。每步状态迁移发 `buildworkflow.*` 到 outbox 作**可观测/审计流**（GET /a/v1/outbox 实时尾随；非缓存失效事件——产出缓存事件仍是已注册的 `storybuild.run_recorded` L15）。**前端时间线**（`DataBuilderPage WorkflowTimelinePanel`，data-testid `wf-timeline`）：逐运行/逐步可视化状态/尝试/计时/检查点/结构化错误，失败/暂停运行一键 `resume` 续跑（自愈），F55 回归。
- **ModuleProvisioner 注册表 + 比对现状（gap_analysis 一等步）**（`databuilder/provisioners.ts`）：把散在 gap 阶段/闭包/scaffold 三处的"需要 vs 已有"收敛成**跨模块统一 diff**——倒推 BuildPlan 的每类配套模块 `EXISTS(复用)/TO_CREATE(需新建)/MISSING(不能自动建→工单)`。**模块全集 = BuildPlan 13 个 need 数组**一一对应 13 个 provisioner（内容类 dataset/kb_doc · 结构类 ontology_type/rule/slice · 代码类 solver[缺即 MISSING] · 跨系统类 intent/plan/workflow/skill/agent/scene/mcp[现状由 scaffold 回执判定]）。**无遗漏保证**：`provisioners.test` 断言"BuildPlan 每个根级数组字段都已登记 + 已注册 provisioner"——新增配套模块未注册即测试红（"倒序"管线强制纳入统一机制）。产物落 `StoryBuildRun.gapAnalysis` + 工作流 `gap_analysis` 步检查点 + 前端 `GapAnalysisTable`（data-testid `wf-gap-analysis`）。`DatasetProvisioner` 的创建后端 = 合成数据模块（合成是某个 provisioner 的后端实现，非并列制品）。
- **双模闭包 + 未审核态（A18，§2.H）**（`databuilder/closure.ts validateClosure(plan,policy,buildMode)`）：把闭包门从"HARD 原子闸（缺一环→`gatePassed=false`→阻断/全 0）"扩为**双模**——`buildMode=STRICT`（默认，写真值）维持 HARD 阻断；`buildMode=PROVISIONAL`（未审核预览/推演 opt-in）把所有 FAILED/MISSING **降级 `severity=ADVISORY`**（如实记录全部缺口 + `advisoryCount`，但 `blocked=false`，守"不靠阻断成 0"），`gatePassed` 仍诚实反映 STRICT 口径。`StoryBuildRun.buildMode + domainTrustLevel`（PROVISIONAL 整域强标 `UNVERIFIED`）；**R13 红线**：PROVISIONAL 终态验证恒 `PROVISIONAL_ANSWER`（`verifyBuild` 拦截，**绝不** VERIFIED/answerable），答案强标"基于未审核临时件"。`POST /a/v1/databuilder/runs {buildMode}`；发 `domain.provisional_built`（L15）。诚实门 `provisional-honesty.ts checkProvisionalHonesty`（PROVISIONAL 域须 UNVERIFIED 标 + PROVISIONAL_ANSWER + 缺口 ADVISORY + 不 blocked，违则红）+ `pnpm provisional-honesty:check`。**A18.2 生成接地（DF.8，`solvers/llm-gen.ts checkGrounding` + `solvers/service.ts groundingVocab`，PRD 生成接地层核心论点「生成不造业务事实」）**：LLM 生成临时求解器时注入**已发布业务词表**（BASE_REGISTRY 基地名 + SEG_REGISTRY 细分名）进 prompt，注册前做**确定性越界校验**——扫 `computeSource` 中以 基地/产线/工厂 结尾的字符串字面量，凡不在词表内即判越界（LLM 编造了不存在的业务实体）→ `UNREGISTERED` + `rejectReason 接地校验失败：引用边界外业务实体 [...]`（绝不静默注册可调用）。窄规则只认实体后缀，不误伤单位/状态/工序文案（万套/认证中/化成柜，R6 同源同判）。**与 A18 沙箱正交**：沙箱隔副作用（确定性/无 IO），接地防造假（不引用边界外实体）。**已落 A18.1（双模闭包 + buildMode + 标签 + 验证红线 + 诚实门）· A18.2（SolverArtifact + 锁死沙箱[独立子进程]+LLM 临时求解器生成跑通 + DF.8 生成接地校验）· A18.3（PROVISIONAL 隔离物化 + R4 写真值门控[创建人 actor===createdBy 放宽]）· A18.4（逐制品晋升 GOVERNED + 求解器审核台 UI）**。审核台：`GET /a/v1/solvers/artifacts`（每 key 最新版本 + status 过滤，requireAdmin）→ 前端 `SolverReviewPage`（`/admin/solver-review`，nav 构建与成长组）列 PROVISIONAL/GOVERNED 制品 + 看冻结代码/理由/哈希/创建人 → "晋升 GOVERNED"（`POST …/:key/promote` 解锁写真值，发 `solver.status_changed`）。**整域晋升编排（已落）**：`databuilder/service.ts promoteDomain` + `POST /a/v1/databuilder/runs/:id/promote`（requireAdmin）——人工审核通过一个 PROVISIONAL 域 → 把隔离命名空间（伪租户 `tenant::prov::runId`）的本体类型/链路/对象/链路/原始表/连接器/规则/切片整体迁入真租户（id 保持、origin 留痕 `promotedFrom`）+ 发布版本 + 跑派生（governed 可查）⊕ 逐制品晋升本域产出的临时求解器 PROVISIONAL→GOVERNED ⊕ 翻转 `domainTrustLevel`→GOVERNED + 记 `StoryBuildRun.domainPromotion` + 发 `domain.promoted`（幂等：已 GOVERNED 直接返回）。前端 `DataBuilderPage` PROVISIONAL run 上"整域晋升"按钮。
- **原型 intake 正门 + schema 对账（prototype-intake，§2.A/B）**（`databuilder/prototype-intake.ts`）：让"上传 HTML 原型 → 复刻数据与关系"成可重复正门（非每次派 agent 手抠）。`parsePrototypeHtml`**确定性**抽 `<script>` 内 `const NAME=[...]` 对象数组→数据表（列/样例行）+ 关系（显式 `L(src,tgt,rel)` / `xxxRef` 命名约定→OntologyLink 候选）；**安全：绝不 eval 不可信输入**（受限正则定位 + 平衡扫描 + 轻量归一 JSON.parse，失败入 `unparsed[]` 诚实不静默丢，R6 同 HTML 同结果）。`reconcileIntake` 原型列↔既有本体字段**确定性对账**（归一名精确命中→autoMapped；映射不上/多义→`SchemaReconcileCandidate`（候选按分降序 + 建议 USE/NEW），**真歧义不调 LLM 给人确认**，类比 MergeCandidate）。`POST /a/v1/databuilder/intake`（解析 + 对账既有本体预览）+ 事件 `prototype.intake_recorded`（L15）。契约 `contracts/prototype-intake.ts`（IntakeResult/SchemaReconcileCandidate/ReconcileAction）。**已落 P1（intake 解析）+ P2-core（对账预览，stateless）+ P2 HITL（候选落 reconcile-candidates 队列 + resolve）+ DF.13c 前端面板**（`pages/admin/PrototypeIntakePage`，`/admin/prototype-intake`：粘贴 HTML → 展示解析数据表[列+样例]/关系/对账[自动映射·待确认候选·诚实未解析]，文件↔表可见；门B Playwright 真验）。**P3 导入正门（物化进库，已落）**：`POST /a/v1/databuilder/intake/import` → `connectors.importPrototype`（HTML→BlobStore→**prototype_html 连接器**→discoverSchema+sync 把内嵌多表全量落 RawDataset）→ 数据连接器可见"原型导入:文件名"连接（category=PROTOTYPE）+ field-profile 在线查看每张表（**从库读，值与原型一致 R6，绝不写死前端代码**）；发 `prototype.materialized`（L15）。解析单一来源 `extractPrototypeDatasets`（parsePrototypeHtml 取样例预览 / 适配器取全量行同源）。门B Playwright 真验全链（admin 登录→导入真实参考 HTML 24 表→数据接入可见→在线查看读库行）。契约 `IntakeImportRequest/Response`。**P3 闭环末步（物化为对象，已落）**：`POST /a/v1/databuilder/intake/objectify {connId}` → `modeling.materializeFromReconcile`——把该连接的 RawDataset 按**确定性 schema 对账**（`reconcileIntake` 列↔既有 type.field，**仅 autoMapped 精确命中入物化，候选/未命中诚实跳过不猜**）写 ObjectInstance（`origin=MATERIALIZED+datasetId`，幂等清旧再写 R6）+ 跑派生 → 进既有对象库可查（`/admin/object-types` 计数增）。**不新建/不发布类型**（"对账后的列"→既有类型，避免污染本体）；映射不上的列/表如实报 `skipped`。前端 PrototypeIntakePage「物化为对象」按钮（成功失效 `object-type-stats` 缓存 → 对象浏览器即显新计数）；发 `prototype.objectified`（L15）。契约 `IntakeObjectifyRequest/Response`。门B Playwright 真验（导入→物化→对象浏览器 Order 计数 20→22 + BASES 诚实跳过）。**P3「建模为新类型」入口（已落）**：对账映射不上的原型表（与既有本体不匹配）→ PrototypeIntakePage「建模为新类型（A3）」深链 `/admin/modeling?datasets=<rawDatasetIds>` → ModelingPage 自动开新建草案弹窗 + 预选这些数据集 → 确定性建模（`derive`，每字段建模 R12）→ **人工归域**（新增 ModelingPage 类型卡 `setDomain` 下拉，解 A4 发布门「新类型未归域必须人工归域」——此前后端 `setDomain` 操作就绪但前端无控件 = 死门）→ 发布 → 对象化 → 新类型进既有对象库。门B Playwright 真验全链（导入→建模为新类型→预选→建模→归域→发布 0 错→对象化 SUCCEEDED→对象浏览器现新类型）。**附带修真 bug**：DataCore 直连端口开发态 CORS 仅放行 GET/HEAD/POST（@fastify/cors 默认）→ PATCH/PUT/DELETE 预检被拒（归域/行内编辑等跨源失效）；显式 `methods` 列全方法修复（生产经网关同源无此问题）。
- **FDE 编排工作流节点状态图（A5，§2.H 投影读模型）**（`databuilder/fde-graph.ts projectFdeNodes`）：把 BuildWorkflowRun 的 7 个执行步**确定性投影**成 8 个 FDE 语义节点（`story→comprehend→capability→gap→generate→closure→publish→launcher`，FDE_NODE_KEYS 固定序），每节点带状态（PENDING/RUNNING/DONE/FAILED/SKIPPED）+ IO + 计时 + 下钻产物引用 + **缺口码**（FAILED：闭包断=首个失败维 CHAIN_BROKEN/SHAPE_MISMATCH…；步致命=step.error.code）。节点状态主判**产物存在性**（context 的 planId/aOk/built/closureReport/answer），步状态仅作 RUNNING/计时叠加（R6 同输入同输出）。落 `StoryBuildRun.nodes`（record 步快照 + 引擎 `onAdvance` 钩子每步迁移以 steps+计时刷新）；实时投影端点 `GET /a/v1/databuilder/workflow-runs/:id/fde-graph`；每节点状态变更发 `fde.node_advanced`（L15，跨会话/被动页实时点亮）。前端 `DataBuilderPage <FdeGraph>`（data-testid `fde-graph-*`/`fde-node-*`）：8 节点横向 DAG，状态色 + 缺口码红标，F58 回归。**观测层纪律**：不重写建域逻辑，仅把既有阶段表达为节点图（PRD-A5 §1 非目标）。
- **ScaffoldManifest 持久记录（A7，单机可见 + B 上线对账）**（`databuilder/scaffold-manifest.ts buildScaffoldManifestRecord`，挂 `StoryBuildRun.scaffoldManifest`，doc store 无 migration）：把 comprehend 倒推的 7 类 B 栈需求（intent/plan/workflow/skill/agent/mcp/scene）**无条件**展平成持久清单——**断开"可见"与"B 在线"的强耦合**。单机/未配 `AGENTCORE_BASE_URL` 时每项 `PENDING_BSTACK`（看得到倒推出的 agent systemPrompt/tools、plan steps/args、scene 定义，诚实标"待 B 对账生效"，`pendingBstack=true`、`fullChainOk=false` SOFT）；A→B 下发回执在线则按 (kind,key) 覆盖 `SCAFFOLDED/REUSED/MISSING`。`GET /a/v1/databuilder/runs/:id/scaffold-manifest` 浏览；`POST /a/v1/databuilder/reconcile-scaffold`（B 上线**幂等对账**：对含 PENDING_BSTACK 的历史 run 按 BuildPlan 重下发 → 升级 + `reconciledAt` + `scaffold.reconciled`，幂等键 tenant+runId+kind+key；未配 B 显式报错不静默）。**不在 DataCore 真建 B 栈真值（R8，真值仍归 AgentCore）**，只持久"清单+可见+待对账"。前端 `DataBuilderPage ScaffoldManifestTable`（cross_scaffold 步下钻，data-testid `wf-scaffold-manifest`/`wf-scaffold-*`，F59 回归）。事件 `scaffold.manifest_recorded`/`scaffold.reconciled`（L15）。
- **终态闭环验证（A10，StoryBuildRun.verification）**（`databuilder/service.ts verifyBuild`）：建域→R4 审批→publish 之后，把**主问句**（BuildPlan.script）再经 QOS 实跑一遍验证"现在真能答了"——守"绿测试≠能用"的终态护栏。`verification{status, question, answer, answerable, evidence, gapCode?, validationTrace, verifiedAt}`：QOS 实跑可答→`VERIFIED`（evidence RUNTIME_PROBE，活证据）· 不可答→`NOT_VERIFIED`+gapCode（回灌 FDE 节点图末节点 launcher 红）· QOS 未配→兜底直调求解器 `BUILD_STATIC`（诚实"未过 QOS 运行时"）· 无求解器需求→NOT_VERIFIED。**双路触发**：①全自动（workflow SUCCEEDED 后引擎 `onComplete` 钩子触发，= publish 后自动重跑）②亲手跑通（`POST /a/v1/databuilder/runs/:id/verify`）。复用 inference 步已实跑的 RUNTIME_PROBE 结果避免双 probe；不越界覆盖 `run.answer/inferenceEvidence`（归 inference 步）。VERIFIED 经 runId 与 growth LOOP `CONVERGED` 归一，发 `build.verified`（L15）。前端 `DataBuilderPage VerificationPanel`（终态徽章 + "重跑验证"按钮，data-testid `sbr-verify-*`，F60 回归）。
- **QuarantineRow**：异常行隔离区（SCHEMA_MISMATCH/DUP_KEY）· `quarantine.ts`。

### B. 本体/对象域（DataCore）
- **OntologyType / OntologyLink / OntologyVersion / OntologyDraft**：本体类型/链路/快照版本/草稿 · `ontology.ts`,`modeling.ts`。**A4 对象/类型浏览器**（前端 `ObjectTypesBrowserPage` `/admin/object-types`）：列已发布类型按 14 域(A3 `BUSINESS_DOMAINS`)分组 + 每类型物化对象数(`GET /a/v1/ontology/object-types/stats` 一次算 {域/属性数/派生数/PK/count}) + 域/关键词/仅有物化 筛选 + 点「看实例」下钻实例表(`GET /a/v1/objects?type=`,A6 行级过滤) → Object360/lineage(`/o/:type/:key`)。闭合用户实测"找不到已发布对象类型在哪看"缺口（R2 隔离/R3 entitlement/R14 零业务常数）。
- **ObjectInstance(objects) / Link(links)**：对象库与对象间链路（带 `origin`: SYNTHETIC/MATERIALIZED/MANUAL）· `domain.ts`。
- **MergeCandidate / ObjectMerge（实体解析 OC1）**：多源同实体 → 归一名称匹配产候选 → 人审合并（golden 存活、被并置 `mergedInto` 只见 golden、links 重指）→ 72h 可 unmerge 还原 · 真值留痕 mergedBy/mergedAt(R4) · `entity-resolution.ts` · 端点 `/a/v1/objects/merge*` · 事件 merge_candidate.created/objects.merged(§4)。
- **PropertyDef / DerivedPropertyDef**：属性 / 派生属性 · `domain.ts`。**DF.5 语义目录**：`PropertyDef`（interface，`domain.ts`）+ `FieldProfileSchema`（zod，`contracts/datacore.ts`）各 += `description?`（字段业务语义层"这列是什么"，向后兼容可选）；`buildFieldCatalog` 字段补 description；新 `searchCatalog`（`databuilder/entity-catalog.ts`，纯函数确定性 R6）按字段名/描述/单位语义匹配 → `GET /a/v1/catalog/search?q=`（自然语言"毛利率"落到具体 {typeKey.propKey}，R2 仅 ACTIVE 类型）；描述经 `SolverGenSpec.objectTypes.propDocs` 注入生成 prompt（LLM 按语义选字段，强化 DF.8 接地）。
- **DerivationSpec / DerivationRun**：派生 DSL（A4，topo 重算）· `ontology-core.ts`。
- **SliceSpec**：本体切片（root + hops，A6 逐跳过滤）· `ontology-core.ts:534`。
- **SlicePlan（A3.3 多跳切片规划器产物）**：在本租户已发布本体的 OntologyLink 图上做**确定性路径搜索**（BFS 最短路 + 固定 tie-break：跳数↑→域内边优先→toType 字典序→linkKey 字典序）→ 自动产可执行切片（root→每目标最短路 hops{linkKey,direction,toType} + 路径证据 + 跨越域集），经既有 executeSlice 可跑；搜不到→结构化 `NO_PATH`(unreachable[]，喂 A5 比差/GapReport NO_SLICE)。纯函数无 LLM/无随机（R6，同图同请求字节一致）· `ontology/slice-planner.ts planSlice` · 契约 `contracts/slice-planner.ts` · `POST /a/v1/slices/plan`（R2：仅本租户图）· 门 `slice-planner:check`。**A3.4 切片索引复用（已落）**：`ontology/slice-index.ts buildSliceIndex/lookupReusable`（派生投影 R13——沿 link 图解析每已发布切片覆盖类型集，按 rootType 索引）；`POST /a/v1/slices/plan` 先查索引，命中 rootType 匹配且 spannedTypes⊇targets 的既有切片即复用（`reused:true`，免重复造切片），未命中才新规划；`GET /a/v1/slices/index`；发 `slice.planned` 事件（§4 L1）。**A3.2 域内/跨域两库（已落）**：`ontology/slice-library.ts deriveSliceLibrary`（确定性派生——域内 `biz.<域>.<root>`：每域 root=域内首类型、hops=root 同域直接邻接；跨域 `biz.x.<from>_to_<to>`：每跨域接缝 §10.4 一张单跳切片）；`GET /a/v1/slices/library?scope=intra\|cross\|all`（预览）+ `POST /a/v1/slices/library/build`（幂等 putSliceSpec 登记为一等切片→进 A3.4 索引、QOS 可调）。**A3.1 14 域注册表（已落，§10.1）；A3.1 参考本体基线（元租户 95 节点）待后续**。
- **ObjectPropHistory**：属性时序历史（temporal）· `objectPropHistory`。
- **Domain**：归域（治理）· `domains`。
- **经营驾驶舱绿地对象类型（cockpit P1/P2，`synthetic/battery.ts`）**：数字全部经本体关系算出、前后端零写死（R14）+ 可溯源（R13）+ 同 seed 字节一致（R6，独立子流 `mulberry32(seed^hash("cockpit"))`）。P1：`DemandSegment`(forecast，派生 `revenueWan=p50×priceWan`/`marginWan=p50×priceWan×marginPct/100`) · `FinancePlan`(finance，三线与需求交叉一致) · `MaterialBalance`(material，`gapTon=net×(1−lta/100)`)。P2 + SPINE（decision/people 域）：`Metric`(经营指标库一等对象，= cockpit `PlanKpi` 归一，各视图 KPI **单一出处** R-一致；`{metricId,key,name,level(op/month/quarter/year),category,target,actual,floorVal,weight,ksfRef,ownerRef,chainKey}`，派生 `delta=actual−target`/`gapPct`，actual 经 P1 同源数据算出/数据源派生，派生投影非新真值 R13) · `KSF`(关键成功要素五要素 k_dem/k_bal/k_kit/k_cash/k_cost，audit/generate `KsfGraph` 的持久对象) · `Principal`(责任主体 org/role/person，收编 owner 字符串 + 域签) · `RootCauseChain`(根因归因模板：kpiCategory→factor→driverType.evidenceField，配成对象供 `plan_rootcause` 求解器据此算 DAG)。骨架链路 `Metric --metric_affects_ksf--> KSF` · `Metric --metric_ownedby--> Principal`(由 Metric.ksfRef/ownerRef 确定性派生);`metric_rollup` 求解器对齐目标树算 delta/miss → 各视图读此单一出处（PRD-goal-metric-owner-spine，SPINE.1-.4 已落）。**cockpit P5 / sop 绿地**：`SopVersionRow`(plan 域，S&OP 版本演进 V1→V7 demand/supply/note/isFinal，派生 `gap=demand−supply`，驱动 V5/V7 版本切换 + 版本对比表；`mrp_netting`/`finance_pnl` 求解器服务 sop 物料线/量价本利)。`AnnualScenario`(plan 域，年度情景；AOP.1 加 `note` 情景前提注解字段——乘用车放缓/储能放量/海外大单等电池域种子文案，经 `GET /a/v1/plan/aop` 下发，前端零写死 R14；`AnnualScenarioView` 渲染 note 行 + 三情景对比 chip + 分解 header 基准数字 + 缺口/过剩窗口曲线[消费 `capexScenario.demand/supply/gap/windows`]，保留活 capex_scenario/真规则 C18·C23/Action 拍板超集)。经声明式 `DASH_LAYOUT` widget（kpi/dag，`objects-aggregate`/`solver` query）渲染；归 `data-categories` 决策驾驶舱类 + `batteryCoverageSlices` 全字段覆盖。**dash 补遗（PRD §2.1/§3.3，真前端门B 验收）**：`order-ledger`（订单经营台账：受影响订单 + 应用细分筛选 + 综合毛利率聚合[SEG_REGISTRY 派生]+ 点行下钻 order-chain 逐单根因 DAG）+ `plan-drill`（规划决策推演：月/季/年 level 切换 + KPI 条 + 点未达成→根因 DAG + 一键去建议[plan-generate]/去体检[plan-audit]；`plan_rootcause` 按 `args.level`：op 读对象、**月/季/年 = op 指标按时间粒度系数确定性派生投影**[DS.1，R13 溯源 op+系数，不落 Metric 对象 → 默认读全部仍只 op，不污染 /metrics/snapshot/rootcause widget/spine 骨架；完整 PlanKpi 月季年对象化待后续]）+ `dash-problems` 问题卡可点下钻（修死按钮 bug）+ `dash-export` 导出 CSV。**后端 service.ts DASH_LAYOUT 与前端 mock fixtures.ts DASH_LAYOUT 两套须同步**（门A `cockpit-widgets:check` 守不漂）。**P3 风险看板补全（对症方案→工单闭环）**：`RiskBoardView` 风险卡详情内嵌对症方案表——`mitigation_select` 求解器（方案库 canonical 取 `params.risk.mitigations`，经 `deriveExtendedArgs` 注入 → 全 7 个风险因子可用，消除"风险卡全因子名 vs 方案库短名"接缝）按因子优选 → "采纳→工单"经 `adopt_mitigation` ActionType 生成 Action 草稿待审批（R4 真值经审批、不直改）。

### C. 规则/约束域（DataCore）
- **Rule（C01–C33…）**：规则 DSL（severity BLOCK/WARN，scopeObjectTypes；算子 AND/OR/NOT/IN/SUSTAIN/**IMPLIES**，IMPLIES=`NOT a OR b` 解析期脱糖）· `ruledsl.ts`,`rules.ts`。catalog §3 **C26–C33 已注册为一等规则**（`battery.ts rules` + `BATTERY_RULE_SCOPES`，此前硬编码在求解器、规则引擎不可见 → 现可解析/可评估/可列出；表达式=违规谓词,复杂算术取去归一化/派生字段如 `Process.yieldFloor`/`Order.daysToStart`；C33 碳护照用 IMPLIES：`NOT (Order.destination=='EU' IMPLIES Order.carbonFootprint<=Order.euCarbonThreshold)`）。
- **Rule 一等化 + `params`（G-10 规则即引用 P1/P2）**：`RuleEntry += params`（命名阈值 `Record<string,number>`，求解器读 `rule.params` 而非硬编码，改 param 即改推演）· 补全 13 条曾"被引用未定义"规则为一等规则（`C01/C02/C04/C06/C09/C10/C11/C15/C16/C21/C22/C24/C25`，连同 C26–C33 = **全部被引用码已一等化**，`rule-closure:check` 门守）· `SOLVER_RULE_REFS`（contracts 单一来源：求解器→规则引用，19 求解器 26 码）· `EvaluatedRule`（求解器透出真评估 PASS/WARN/BLOCK/NOT_APPLICABLE，关联规则显真结果非装饰）· 契约 `packages/contracts/src/datacore.ts`。
- **RuleDoc / RuleCandidate / ExtractSegment**：规则文档抽取（A2，LLM extraction）· `ruleDocs`,`ruleCandidates`。

### D. 行动/权限域（DataCore）
- **ActionType / ActionDraft**：动作类型 + 草稿（审批后 EXECUTED 才写真值；Phase9B 对象级变更）· `actions.ts`,`app.ts:290`。
- **Policy（A6）**：行级过滤策略（贯穿 query/slice/solver 读出）· `policies`,`authz`。

### E. 求解/推演域（DataCore）
- **Solver（SOLVER_KEYS，38 个）**：确定性求解器（电池域纯函数 compute；通用求解器走对象图而非电池 context）· `solvers/service.ts:14`,`extended.ts`。**A8 CP-SAT 可证最优族（经自托管 sidecar，单端点按 model 判别，未配 OPTIMIZER_BASE_URL 显式"未接入"不兜底，R6 seed+单线程确定）**：`selection_optimize`（0/1 背包）· **`assignment_optimize`**（订单/需求→基地/产线指派：每 item 一指派 + Σweight≤capacity + 成本最小化 + 资格 mask）· **`sequencing_optimize`**（产线换型排序：jobs 按 group 排序最小化相邻换型损失，AddCircuit 开放路径）· **`packing_optimize`**（产能装箱：items[size]→容量 binCapacity 箱，最小化箱数，对称破除确定性）。client `solveAssignment/solveSequencing/solvePacking`。注册表（`ontology:check` 门禁核对）：`assignment_optimize` `sequencing_optimize` `packing_optimize`
  `capacity_rollup` `capacity_forecast` `bottleneck_matrix` `risk_timeline` `affected_orders` `plan_audit` `plan_generate` `capex_scenario` `mitigation_select` `outsourcing_split` `maintenance_stagger` `quarterly_gap` `cert_schedule` `kit_readiness` `lta_gap` `inventory_optimize` `changeover_sequence` `quote_margin` `credit_exposure` `carbon_footprint` `yield_diagnosis` `countermeasure_combo` `generic_inference` `shared_bottleneck` `concentration_risk` `margin_attribution` `supplier_disruption_radius` `selection_optimize` `ksf_graph` `cockpit_kpi`（`sop_balance` 是工作流非求解器，走 `/a/v1/sop/*`）。`shared_bottleneck`（PRD-fde §8d/Q4 净室通用求解器）：读对象图按 viaField 把上游对象分组到共享资源，需求和>产能=瓶颈，按 priorityField 判降级；`SolverService.invoke` 拦截，args 字段映射任意本体即用——答"哪些工序/设备瓶颈、谁挤占谁、哪张单降级"。`concentration_risk`（PRD-fde §8c/Q5 隐性集中度）：沿多跳 ref 路径反向聚合,找"多个分散起点都依赖同一根"的暗线单点(客户→订单→物料→二级供应商:哪个供应商被最多客户隐性依赖)。`margin_attribution`（PRD-fde §8 Q3 毛利倒挂根因）：把每个目标对象成本拆成多成本项,算毛利率标记倒挂,按成本项占比定位主驱动并跨倒挂群聚合根因——答"是哪个成本项把毛利拉穿的"。`supplier_disruption_radius`（PRD-fde §8 Q2 断供影响半径）：从断供根沿"谁引用我"反向多跳逐层扇出(物料→订单→客户),算受冲击集合/扩散半径(穿透层数)/叶层敞口;与 concentration_risk 互为反向(一根扇出 vs 多源收敛)。`selection_optimize`（PRD-fde §8d 组合最优化）：**经自托管 CP-SAT sidecar**（OR-Tools, Apache-2.0；services/optimizer）——从对象图取候选项,在 Σweight≤budget 等约束下最大化 Σvalue（0/1 背包族）,给贪心/启发式给不出的**可证最优**;数据不出边界,`OPTIMIZER_BASE_URL` 发现引擎,未配置则报"未接入"(不静默兜底);R6 靠固定 seed + 单线程 + 确定性停止。`generic_inference`（generic-inference P2）包装 `recompute(dryRun+apply)`，`SolverService.invoke` 拦截→对任意已发布本体套假设值前向重算派生 before/after，非纯 compute；`POST /a/v1/solvers/generic_inference/invoke` 与 `/a/v1/inference/whatif` 同源，growth 缺求解器 B 兜底路由到此。`plan_rootcause`（cockpit P2 规划决策推演 · 根因归因 DAG，决策驾驶舱目录）：读 `PlanKpi`/`RootCauseChain`/活数据,经营 KPI 越线（actual<floorVal）→沿归因模板（RootCauseChain：kpiCategory→factor→driverType.evidenceField）逐层取证,产出多根 DAG（kpi 根→factor 因子→evidence 取证叶），每条边权重=活数据贡献占比（确定性 R6，「结构=算、模板=配成对象」）;`SolverService.invoke` 拦截,经驾驶舱声明式 widget(query.solver) 直调,不经 QOS 场景分类（故不进 discover 22,进注册表 33）——答"某 KPI 为什么没达标、根因在哪个因子、证据是哪些细分/物料"。`metric_rollup`（SPINE 经营目标-指标-责任骨架，决策驾驶舱目录）：读 `Metric` 一等对象 → 对齐目标树(`PlanTarget`) target 算 `delta`/`miss` → 输出指标数组（各视图 KPI **单一出处** R-一致，派生投影非新真值 R13，确定性 R6）;`SolverService.invoke` 拦截——答"各经营指标目标 vs 实际达成、哪些越线"。`counterfactual_timeline`（cockpit P4 反事实双轨推演，决策驾驶舱目录）：编排 `risk_timeline` 出 do-nothing baseline 与处置后(mitigation eff/tn 衰减)双曲线 + 差值（峰值削减/越线日推迟/少越线日），确定性 R6——答"如不解决 XX 风险、未来 N 天会怎样"。`order_fullchain`（cockpit P4 / order 视图 订单全链推演，决策驾驶舱目录）：`SolverService.invoke` 拦截读对象图（Order×Model×MaterialBalance×DemandSegment）→ 逐单三关联判（①交期 C02/C03 · ②齐套 C06/C16 · ③财务三闸 C15→C13→C18）+ 统一结论（信用阻断>毛利提价>交期/齐套对冲）+ 业务建模链 DAG（order→{net,bom,eco,cred}→{jcap,jkit,jfin}→vrd），确定性 R6——答"这单能不能接、为何提价、卡在哪一判"。`mrp_netting`（sop 视图 ③物料线，决策驾驶舱目录）：读 `MaterialBalance` → 净需求/长协覆盖/现货缺口/最早齐套表（C06/C16）。`finance_pnl`（sop 视图 ④ / cockpit P5，决策驾驶舱目录）：读 `FinancePlan`+`DemandSegment` → 收入/销售成本/毛利 预算vs滚动vs差异 + 毛利率行 + 结构归因（C15）。二者 `SolverService.invoke` 拦截、确定性 R6。`audit_timeline`（audit/generate 视图 每审计项独立时序，决策驾驶舱目录）：按 kind 出 90 天逐日 series + 4 阶段（事件窗→约束越线→波及订单→财务击穿），与产能推演同款逐日交互、形状由 kind hash 确定性派生（R14/R6）；**PRD §2② 每审计项带 `AuditItem.kind`（9 种口径 产销/毛利/齐套/现金/份额/爬坡/外协/capex23/struct，`plan_audit` 确定性 id→kind 映射）→ 前端 PlanAuditView 按 `item.kind` 路由 `audit_timeline({kind})` 出各项独立曲线（不再共用 risk_timeline card[0]）；复用 `riskEvents`/`affectedOrders` 引擎按 kind hash 选代表基地 → 输出 `events`+`affectedOrders`（同款悬停日点详情）**。`ksf_graph`（audit.3 / generate 视图 财务 KSF 图，决策驾驶舱目录）：`SolverService.invoke` 拦截读 `Metric`(ksfRef)+`KSF` 一等对象，投影 3 层有向图——待解决问题（越线 Metric，无则取最弱保图非空）→ 关键成功要素 KSF（5）→ 财务计划指标（Metric）；问题→KSF 威胁边、KSF→财务 支撑边（确定性 R6，派生投影非新真值 R13，注册表 39）——答"哪些问题压在哪个关键成功要素上、传导到哪些财务指标"。`cockpit_kpi`（DS.2 经营驾驶舱富 KPI，决策驾驶舱目录）：`SolverService.invoke` 拦截，从 `SopVersionRow`/`FinancePlan`/`Base`/`AnnualScenario` 对象确定性派生 5 标量（可供给V7=最终版 supply · 收入达成=收入行 rolling÷budget×100 · 利用率瓶颈=max(util) · AOP基准/现金垫=baseline 情景 revenue/cashCushion），一 solver 出、各 kpi widget `valuePath` 取（R13 溯源对象/R6）——补齐 PRD §2 缺口表 8 富 KPI。
- **SolverContext 读规则链（G-10 P2，求解器→规则）**：`SolverContext += rules`（本租户已发布规则快照，按 ruleKey 索引，含 `params`）`+ ruleSetVersion`（FNV-1a(canonicalJson) 版本指纹，R6 推演记录所用版本）· `loadContext` 注入 · `invoke` 末对 `SOLVER_RULE_REFS[solverKey]` 逐条按规则引擎评估 → 输出 `evaluatedRules`（PASS/WARN/BLOCK，字段不可解析→NOT_APPLICABLE 诚实标）+ `ruleSetVersion`。**改规则即改推演**：全 7 入口经汇聚点 `/a/v1/solvers/:key/invoke` 一次生效（现 capacity_forecast 全闸门真评估，余 18 求解器 payload 映射待 P3）· `solvers/service.ts`,`ruledsl.ts collectFieldPaths`。
- **SolverParam / SolverParamsHistory**：求解器参数（版本化，校准可改）· `solverParams`。
- **通用图求解器地板语义确定化（A13）**：`solvers/field-roles.ts resolveFieldRoles` 把"哪个类型/字段是 root/sink/resource/priority(地板)/leaf"的角色解析做成**纯函数 + 结构信号(扇入/扇出/PK/数值) + 配置词库(`field-role-lexicon.ts` R14) + 固定 tie-break**，**去掉 LLM 消歧（R6 字节一致）**；真歧义返回**确定性排序候选 + 置信度 + ambiguous 标**（取 top1 默认 / 喂 A5 比差 / A4 让人选，**绝不调 Kimi**）。覆盖 shared_bottleneck/concentration_risk/margin_attribution/supplier_disruption_radius（后者断供根=被 ref 的终端汇点，结构确定，rootId 运行期标量仍留空）· `SOLVER_FIELD_ROLES` · 契约 `FieldRoleResolutionSchema` · `GET /a/v1/solvers/:key/field-roles` · 门 `floor-semantics:check`。
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
- **CLI 通用操作外壳 + OperationIntent（A15）**（`scripts/platform-cli.mjs` + `contracts/operation-intent.ts`）：把"只能 ask 问句"的 CLI 升级为**通用操作外壳**——`platform do "<NL>"` 万能入口经 `POST /b/v1/operations/classify`（**确定性关键词打分** `classifyOperation`，R6 无 LLM；低置信/多候选→列 candidates 不瞎猜）判 **QUERY**（走 QOS ask）或 **OPERATION**（路由模块：import/model/rule/solve/synth/build/approve…）。`OPERATION_CATALOG`（配置 R14，17 条覆盖矩阵）每条带关键词/端点/必填槽/是否 R4/`cliCommand`/（不宜内联→`uiDeepLink` 跳 GUI，§3.6 求解器上传）。CLI 与 GUI **平行同源**（同一 REST + R3/R4/R8 + 事件，一端操作另一端可见），不绕审批/不本地直写。**R15 CLI 对等**（§5 新不变量 + `cli-parity:check` §7 门）：新增对外能力必须注册 cliCommand 或 uiDeepLink，否则功能洼地返工。
- **EvalSuite / EvalCase / EvalRunReport（agent evals + A14 parity）**（`agentcore/evals.ts`，§7 检测）：逐 case 经**真实 QOS 管线**实跑观测意图/工具序列/答案/时延/token，与期望（`expect{intentKey,toolSequence,answerMust/MustNot,maxToolCalls}`）比对落 `EvalRunReport`（`MOCK` 证框架 / `REAL` 真分）。**A14 parity（对 PRD 期望）**：`EvalCaseResult.failKind`（INTENT/TOOLSEQ/ANSWER/OTHER，`classifyFailKind` 首要失因）+ `EvalRunReport.parity{byFailKind 直方图, byCase 逐 case 偏差}`；PRD 期望用例库 `seedParityCases`（从 20 场景目录派生 intent+工具序列期望，`POST /b/v1/evals/seed-parity`）；真 Kimi **env-gated** 实跑（R6：不进默认 CI 抖动），mock 仅证框架。前端 `EvalsPage` parity 失因列（data-testid `eval-parity-*`）。
- **Scenario（一等对象，升级自 ScenarioCard）**：场景为一等主键（scenarioKey/name/domain/targetView/intentKey/mode/defaultAgentId/presetContext/rules/riskLevel/status DRAFT→PUBLISHED→RETIRED/version）· 持久化于 AgentCore `scenarios` 仓储 · 出厂 SCENARIO_CATALOG 启动期幂等 upsert（单一来源）· `contracts/agentcore.ts ScenarioSchema` · `scenarios-catalog.ts:60`。**所有使用 workflow/agent 的场景都在此完整可配（治理铁律）**。
- **SceneEntry（降为投影）**：视图侧投影（**viewKey 为键** · mode 兜底 · defaultAgentId · intentCatalogFilter · suggestedQuestions）· 主键关系反转为 `View ← Scenario.targetView` · `contracts/agentcore.ts:171`。
- **Task / Query**：QOS 任务（SSE 流）· `router/orchestrator.ts`,`api/sse.ts`。
- **GapReport（缺口报告 · 自成长发动机 P1）**：QOS 缺口探针把"客户问句真跑一遍 orchestrator"后的**终态 QueryTask** 映射为结构化缺口（7 码分类法 NO_INTENT/NO_PLAN/NO_SLICE/EMPTY_DATA/NO_RULE/SOLVER_NOT_FOUND/SHAPE_MISMATCH/NO_CAPABILITY + ANSWERABLE/OTHER）· 确定性纯函数 `classifyGap` · `POST /api/v1/growth/probe`（提交→等终态→分类）· `contracts/growth.ts` · `agentcore/growth/probe.ts`。需求拉动自成长的诊断起点（PRD-demand-pulled-growth-engine §5）。 P2：缺数据"真人正门"自动补 `POST /a/v1/growth/fill-data`（确定性生成 CSV→经公开上传门 connectors.upload 导入→RawDataset 可见，与手动上传无差别）+ 就地 Action 审批面板（DataBuilderPage 页内批复，§6.4）。**DF.9 真人正门 HARD/SOFT 分流（生成接地核心，`growth/data-boundary.ts decideDataGap`）**：LOOP 遇 EMPTY_DATA 时先接地判分——缺的数据**涉真实业务实体**（问句/上下文命中已发布业务词表 BASE/SEG，与 DF.8 同源单一来源）→ **HARD**：自动合成 = 造业务事实，拒绝静默合成，出**精确 DataRequest**（typeKey/columns/entities/reason）走真人正门（连接器导入/Excel→Action 审批 R4），`advanced:false` + 工单 → LOOP 收敛 BOUNDARY（已做完它能做的）；无具体实体 → **SOFT**：经管线确定性合成 PROVISIONAL（CL.2「触发合成≠伪造」）。确定性纯函数（R6），`GrowthFillResult.fillMode/dataRequest`（`contracts/growth.ts`），事件 `growth.fill_proposed` 带 fillMode。 P3：LOOP `POST /api/v1/growth/run`（探针→补齐(缺数据真人正门/否则出工单)→重跑→收敛，K 有界前端可配；终态 CONVERGED/BOUNDARY/MAX_ROUNDS）· `growth/loop.ts runGrowthLoop`。 P4：成长账本(demand-indexed,GrowthLedgerEntry)+成长工单(厂商中立施工契约 GrowthTicket OPEN→VERIFIED)持久化(仓储四处+migration007)，`GET /api/v1/growth/{ledger,tickets}`。 P5：工单施工闭环 claim→submit→verify(重跑可答→VERIFIED)；CLI 活查询面 `platform tickets/claim/grow`(厂商中立,人与 code agent 共用)；推送事件 growth.ticket_opened(§4 L13)+拉兜底 GET tickets。 P6：自成长驾驶舱前端 `/admin/growth`(运行LOOP+GapReport逐轮+收敛终态+成长账本+工单看板+需求可答率指标) · `GrowthCockpitPage.tsx` · `/b/v1/growth` 别名。
- **StoryBuildRun（故事驱动建域的历史推演记录 · 故事驱动全栈倒推 g8 P1）**：一次"故事脚本→全栈 BuildPlan→闭包→产物→（可选）答案"的端到端建域记录，串 InputManifest/BuildPlan(frozen)/ClosureReport/ScaffoldReceipt/producedConnections/producedDatasets/gapReport · `contracts/storybuildrun.ts`（含 InputManifest、ScaffoldReceipt 两个伴生契约）· `databuilder/service.ts runStory/listStoryRuns/getStoryRun` · `POST/GET /a/v1/databuilder/runs` · 仓储双实现（`story_build_runs`，migration015）· 前端历史推演记录时间线（`DataBuilderPage` sbr-timeline）。**与自成长发动机 `GrowthLedgerEntry` 经 runId 归一为同一"历史推演记录"两面**（构建期⊕运行期，PRD-fullstack-story-build-g8 §9）。P1 已落（持久层+端点+时间线+rawin 去模板化）；P2 已落（InputManifest 倒推补录表单）；P3 已落（跨系统 scaffold：BuildPlan 扩 B 栈需求 + comprehend 故事倒推全栈 + AgentCore `POST /b/v1/internal/scaffold` SERVICE_TOKEN 守闸幂等 DRAFT + DataCore closure 后 A→B 下发、ScaffoldReceipt.fullChainOk 并入终态，R11 跨系统）；P6 已落（存量回填 `POST /a/v1/databuilder/backfill`：`deriveBackfillScripts` 把既有推演能力逆向导出为故事脚本 → 逐条 runStory 补血缘 + 压测报告 BackfillReport）；P4 已落（功能缺失自检 `selfCheckGaps`：MISSING/FAILED → 7 码 GapReport 附 StoryBuildRun.gapReport；压测 `POST /a/v1/databuilder/stress`）；P5 已落（故事脚本自动生成器 `deriveGeneratedScripts` + `GET /a/v1/databuilder/generate-scripts`；推演回填 `runInference`，**§9 归一已落**：注入 `inferenceProbe`（app.ts 配 AGENTCORE_BASE_URL 时=`POST /api/v1/growth/probe` 经 AgentCore QOS orchestrator 实跑，故事整段为主问句）→ answer + `inferenceEvidence=RUNTIME_PROBE`（"建出来的域真能在 QOS 跑通"的活证据，绿测试≠能用）；未配则兜底直调求解器在建好对象上算 → `BUILD_STATIC`（诚实区分未过 QOS 运行时）。inference 可选/backfill 默认开）。**g8 P1–P6 全部落地。** 技术债已清：① 跨系统 HARD 门前置到 publish（dry build→A闭包→scaffold→全链闭合才真建落库，否则拒发布，R11 真阻断）；② comprehend 倒推扩到 workflow/skill/agent（每求解器→工作流+技能+Agent），AgentCore scaffold 全部建 DRAFT → skill/workflow/agent 页配置可见。**统一规格 P2（模块同步矩阵）**：StoryBuildRun 加 `producedArtifacts[]`（{module,kind,key,action:CREATED|UPDATED|REUSED,status:DRAFT|PUBLISHED}，`databuilder/artifacts.ts deriveProducedArtifacts` 确定性聚合 A 栈本体/切片/规则/求解器 ⊕ 连接器差集 ⊕ B 栈 scaffold 回执）；`buildModuleSyncMatrix`（contracts 纯函数派生投影，非新真值源 R13）按 `MODULE_REGISTRY` 聚合为模块同步矩阵 → 前端 `DataBuilderPage` 区5（每模块本次新增/复用计数 + DRAFT/已发布 R4 + 深链核对；**D 逐产物瀑布流**：模块行可展开为逐产物 diff 卡 before→after，DRAFT 产物surface逐产物 HITL 复用就地审批 R4，unified §5.3）。区2 全栈理解分组卡片 + 区4 快速合成（收编合成数据页模板生成）同期落地。**统一规格 P3/P3.5/P4**：① 区6 完整性·自检·信任——StoryBuildRun 加 `storyCoverage[]`（`comprehend.ts deriveStoryCoverage` 复用同一关键词目录逐句对账，未映射=未理解/未建模高亮，"没遗漏"证据）+ 前端全链闭包可视化（CHAIN/SHAPE/OBJECT/DATA/FORWARD 逐段 + R12 双向闭包徽章 HARD/SOFT）+ 推演验证痕迹回写（`buildStoryValidationTrace`：建域成功即把结论依据的输入对象经 `ontology.crossValidate` 反向核对知识图谱 → `StoryBuildRun.validationTrace`（一致性 ALL_PASS + 交叉验证 ALL_CONSISTENT，R6 确定性/R2 隔离），前端 `ValidationTracePanel` 内嵌让用户信任"完整且有据" R13）；② 区7 一键推演——`comprehend` 为求解器场景填真实 `targetView`（affected_orders→risk / capacity_forecast→project，scaffold 出的 DRAFT 场景亦带视图），前端 `InferenceButton` 经 `useQuickLaunch`（场景启动器低层 launch）以故事主问句跑 QOS → 跳 targetView 业务页注入出答案；区6 有 MISSING（闭包未过/自检缺口/跨系统断链）则诚实显示"不可达：断在 <缺口码>"，守"绿测试≠能用"；③ P4 三页归一——自成长缺口工单看板内嵌 `DataBuilderPage`（`db-growth-console`，/admin/growth 保留为聚焦视图）+ 快速合成入口同在，无功能丢失。
- **SystemObjectType / SystemInvariant / SystemBreakpoint / SystemEvent / SystemDomain / SystemSlice / SystemGate / SystemLink（Dogfooding 元层对象 · #12 落库 PoC）**：把本体本身（§2/§3/§4/§5/§7/§8/§10 + `prd-ontology-index.json`）确定性投影为元租户 `__platform__` 的 `ObjectInstance`+`Link`（origin `META`，可溯回 markdown 章节）。markdown 仍单一来源、对象只读派生（R4 豁免）· `meta/parse.ts`(纯解析 R6) + `meta/service.ts MetaOntologyService` · `POST /a/v1/meta/sync`(幂等,发 `meta.ontology_synced` L14) · `GET /a/v1/meta/{ontology,breakpoints/:id,impact}`(**Entitlement 先于 authz**：`requireMetaAccess` 先查 feature `admin.meta-ontology`(默认开)关闭→404 FEATURE_NOT_FOUND,再 MetaAccessPolicy 角色白名单门 403,配置化 P2) · 影响分析 = META links 上轻量 BFS。复用 objects/links 仓储,不新建表（R9）。业务租户经 R2 见不到（PRD-dogfooding-self-ontology）。
- **ValidationTrace（推演验证痕迹）**：凡推演用到本体切片即附于 `Answer.validationTrace`——① 一致性验证（实体定义/公理裁决/数字溯源/版本钉，本体内自动）② 交叉验证（结论对象断言 vs 知识图谱已有事实 CONSISTENT/CONFLICT/NO_EVIDENCE）。让用户信任结果（R13 输出侧纪律的"可视化成品"）· `contracts/qos.ts ValidationTraceSchema` · 组装 `workflow/executor.ts buildValidationTrace` · 前端 `components/Answer/ValidationTracePanel.tsx`。
- **MCP tool / RefReport**：外部工具 / 引用上报。
- **客户端（QOS 入口）**：Web 对话坞（`frontend-shell` QueryDock）· **CLI 对话入口**（`scripts/platform-cli.mjs`：login/ask/scenarios/approve，一句话驱动平台；人与 AI 共用）—— 均为切片 `sys.orch.query_to_answer` 的客户端，复用同一 QOS 管线。

### I. 推演沙盘域（DataCore · 增量 0 本体先行 · 设计待落，对象 schema 见 `docs/SPEC-sandbox-propagation-and-session.md` / `docs/SPEC-sandbox-readiness-certification.md`）

> 行业无关、配置驱动、确定性、可回退。传导核只认 `(typeKey, stateVar, linkKey, 系数, 延迟)`——喂任意租户本体即跑（R14 两行业验收）。复用 recompute 链路导航 + risk.ts 衰减 + simclock tick + slice-planner 范围 + actions 走正门 + closure 投影；真正新写只「propagateTick 合体算法 + SimSession 状态机」（接地真相见 `docs/GROUNDING-MAP-sandbox-review-baseline.md §C`）。

- **SimSession（会话状态机 · 全新，全代码库零命中 simclock 是单租户全局时钟非多会话）**：一次有状态推演会话（`base_snapshot` tick0 世界态[合成/连接器/切片物化，走正门] · `scope` 范围裁剪[复用 slice-planner] · `status` DRAFT|READY|RUNNING|PAUSED|ENDED · `cur_tick` · `parent_checkpoint_id` 非空=分支）· 三张全 jsonb 表（`sim_session`/`sim_tick_state`/`sim_checkpoint`，migration 026，**R9 四处同改**，零业务列换行业不改表）。
- **SimTickState（逐 tick 态快照）**：每 tick 的 `state`（对象→状态变量值 TickState）+ `pending`（延迟贡献队列快照，resume 确定性）+ `trace`（传导轨迹可视化）· PK `(session_id, tick)`。
- **SimCheckpoint（命名存档）**：`(session, tick, label)` · rollback=删 tick>cp 的态；branch=以 cp 处 tick 态为 base 开新 session。
- **PropagationRule（传导规则 · 一等类型，不塞进 RuleEntry）**：承载结构 `sourceTypeKey/sourceStateVar/viaLinkKey/targetTypeKey/targetStateVar` + 配置 `coefficient/delayTicks/combine[sum|max]/decay/clamp` · 系数/延迟**应优先引用一条可编辑规则的 `rule.params`**（G-10 P1 已落，真正兑现"改规则即改推演"；冷启动可内联）· 是**新 BuildPlan need + 注册 provisioner**（R16 倒序发育，新增 need 不注册即测试红）· 契约 `packages/contracts` sim（增量 1/3 新建）。竞品 UI `supplier.delay_risk -- SUPPLIES.risk_propagation 0.85 --> factory.supply_risk` = 本结构逐字命中（GROUNDING-MAP §F.2）。
- **SimCertification（就绪认证 · 派生投影对象，非真值，R4 豁免）**：把 SimSession 能否进推演投影成 L0-L4（INVALID→CONFIGURED→RUNNABLE→VERIFIED→CERTIFIED）+ 三维准备度（结构/知识/行为/综合）+ L4 三元组（fanoutSafe/writebackComplete/observabilityMet）+ worldCompleteness（范围预检）+ `canEnterSimulation`（=L4 ∧ trialTick.passed ∧ closure.gatePassed）+ `gaps[]`（缺件诚实，绝不静默放行）· **RL3 单源：全部 DERIVE 自既有 `closure.ts` 五维（OBJECT/DATA/FORWARD/CHAIN/SHAPE）+ GapReport + 一次 Trial Tick，零新校验逻辑**（纯函数 `deriveCertification`，增量 2 新建）· `canEnterSimulation` 对齐 `ScenarioOntogenesisRun` maturity 语义（GOVERNED=真可用/PROVISIONAL=有缺口不假装）。
- **SandboxViewConfig（沙盘视图配置 · 配置驱动 5 屏，R14）**：沙盘 5 屏（数据管道建模/逐实体/就绪认证/初始化向导/沙盘主屏）配置驱动渲染 · 复用既有 `view_configs` 形态 + 前端 `views/sim/` 组件（RadarChart/PropagationTimeline/PmDag/useLiveSolver，基本不重写）· additive 进 ModelingPage（增量 4 才落 UI，本增量只立对象）。


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
**求解器 MCP 暴露链（A1）**
```
DataCore SolverRegistry(全集 32 = 业务场景 22 + 净室通用 9 + 决策驾驶舱 1，feature 过滤) --GET /a/v1/solvers/registry-->
  AgentCore `solvers` MCP server(mcp/solvers-catalog.ts buildSolverMcpTools，确定性按名排序) --GET /b/v1/mcp/servers/solvers-->
    工具 mcp__solvers__{key}(治理页可见/mcp-router 可选) --Agent 调用--> executor A1 shim(零重写归一回 invoke_solver)
      --OBO HTTP /a/v1/solvers/{key}/invoke--> DataCore Solver
  · 收敛纪律：「无 LLM 描述不允许发布」→ 注册表每条带描述（catalog.test 守无漂移：注册表键集 === SOLVER_KEYS）
  · feature 过滤先于 authz（关 view.plan-audit → plan_audit 工具消失，R3）；与 QOS 场景 discover(22) 分列、互不影响
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
  └ **B 栈 scaffold 单机可见（A7，可见/在线解耦）**：cross_scaffold 步**无条件**把倒推 B 栈需求落
    `StoryBuildRun.scaffoldManifest`（PENDING_BSTACK）→ 单机/未配 B 也看得到生成的 agent/plan/scene 定义；
    B 上线 `reconcile-scaffold` 幂等下发升 SCAFFOLDED/REUSED（`scaffold.manifest_recorded`/`reconciled`）。诚实 SOFT/HARD。
  └ **终态闭环验证（A10）**：publish（R4 EXECUTED 落真值）后 → workflow `onComplete` 自动把主问句经 QOS
    重跑（`verifyBuild`）→ `StoryBuildRun.verification` VERIFIED/NOT_VERIFIED/BUILD_STATIC + `build.verified`；
    亲手跑通 `POST /runs/:id/verify`。闭合"建域→答案"终态一环（绿测试≠能用），与 growth LOOP CONVERGED 归一。
  └ **FDE 编排节点化（A5，观测层）**：上述执行步**确定性投影**为 8 个 FDE 语义节点
    `意图→倒推→查能力→比差→各模块生成→闭包→publish→进启动器`（`fde-graph.ts projectFdeNodes`）→
    引擎 onAdvance 每步迁移发 `fde.node_advanced` 实时点亮 + 落 `StoryBuildRun.nodes` → 前端 `<FdeGraph>`
    一眼看建域走到哪/断在哪（FAILED 节点红 + 缺口码）。不改建域真值，仅把既有阶段表达成可观测节点图。
```
**平台横切**
```
Tenant --隔离--> 一切读写/事件/缓存键    FeatureConfig --门控(先于authz)--> 端点/视图/求解器
Policy(A6) --行级过滤--> {query_objects, executeSlice, solver 读出}
LlmPurposeBinding --路由--> { classifier:QOS分类 · agent:路径B · extraction:规则抽取/构建 · modeling:建模建议 · template_gen:行业模板 · compose:llm_compose }   ⚠ 用途枚举写死、不可扩展；model 下拉依赖先选 provider
OutboxEvent --驱动--> EventSubscription(§4) --失效--> 前端缓存
```

**推演沙盘链路（增量 0 立 · 设计待落，详 `docs/SPEC-sandbox-propagation-and-session.md` / `docs/SPEC-sandbox-readiness-certification.md`）**
```
本体世界态(合成/连接器/切片物化,走正门 R16/R4) --init--> SimSession
  --propagateTick(系数×延迟,沿 viaLink 复用 recompute 导航 + risk.ts 衰减,纯函数 R6)--> SimTickState
  --checkpoint--> SimCheckpoint --branch(以 cp 态为 base)--> SimSession'
  --compare(复用 counterfactual_timeline 双序列形状)--> KPI 对比
沙盘 act(模拟态,不写真值) --采纳--> ActionDraft(走正门 R4)         ⚠ 禁直写绕审批(RL4)
closure(validateClosure 五维) ⊕ GapReport(selfcheck) ⊕ TrialTick(propagateTick/recompute 空跑1tick)
  --deriveCertification(纯投影,零新校验 RL3·增量2 已落)--> SimCertification --canEnterSimulation(L4∧trial∧gatePassed)--> 「可进入推演」
propagateTick(增量3 已落): rules.coefficient/coefficientRef→rule.params × 源态 ×(decay) 沿 viaLink → next 态 + 延迟队列(arriveTick>t) + trace；无 PUBLISHED 规则=恒等 tick(opt-in 可回退)
PropagationRule.coefficient/delayTicks --引用--> rule.params(G-10 P1 可编辑) ⚠ 改规则即改推演,禁内联常数(RL5)
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
| L8 | `connection.created` | 连接器创建（A11 带 category） | IN_SESSION | connectors, data-categories | — |
| L1 | `slice.planned` | 切片规划器（A3.4 规划/复用） | IN_SESSION | slice-library, slice-index | — |
| L9 | `kb.indexed` | 知识库索引 | IN_SESSION | kb-search, search-test | DL10 |
| L10 | `objects.merged` | 实体合并 | IN_SESSION | object-queries, dashboard, search | DL8 |
| L10 | `merge_candidate.created` | 实体解析 | NOTIFY | notifications, merge-queue | — |
| L10 | `quarantine.row_added` | 隔离区入库 | NOTIFY | notifications, quarantine | — |
| L11 | `policy.updated` | 权限变更 | IN_SESSION | dashboard, search, scenario-data, history | DL11 |
| L12 | `features.updated` | 功能开通 | IN_SESSION | workspace, navigation, scenarios, intent-catalog | DL12 |
| L13 | `growth.gap_detected` | 自成长发动机·探针检出缺口（LOOP fill 内发） | IN_SESSION | growth-ledger | — |
| L13 | `growth.fill_proposed` | 自成长发动机·补法分派（缺数据 DF.9 HARD 真人正门[出 DataRequest 不合成]/SOFT 管线合成 PROVISIONAL，载 `fillMode`；缺求解器 generic_inference B 兜底） | IN_SESSION | growth-ledger | — |
| L13 | `growth.ticket_opened` | 自成长发动机·缺功能落工单（带真实 I/O 契约+本体引用骨架；P5 推送触达；拉兜底=`GET /api/v1/growth/tickets`） | NOTIFY | growth-tickets, notifications | — |
| L13 | `growth.converged` | 自成长发动机·LOOP 收敛（问句现可答） | IN_SESSION | growth-ledger, growth-tickets | — |
| L14 | `meta.ontology_synced` | Dogfooding·系统本体自反投影重物化完成（`POST /a/v1/meta/sync`）→ 失效 `/a/v1/meta/*` 查询缓存 + meta MCP 工具结果 | INVALIDATE | meta-ontology(`/meta/*` 视图) | — |
| L15 | `storybuild.run_recorded` | 数据构建发动机·故事建域记录完成（`runStory`）→ 经 F1 全局通道失效历史推演记录/模块同步矩阵 | IN_SESSION | story-runs | — |
| L15 | `fde.node_advanced` | A5 FDE 编排工作流·节点状态推进（`fde-graph.ts projectFdeNodes` 投影 7 执行步→8 语义节点，引擎 onAdvance 每步迁移发）→ 实时点亮节点状态图（跨会话/被动页） | IN_SESSION | fde-graph, story-runs, workflow-runs | — |
| L15 | `scaffold.manifest_recorded` | A7 B 栈 scaffold 清单**无条件**落 DataCore（`scaffold-manifest.ts buildScaffoldManifestRecord`，单机/未配 AGENTCORE_BASE_URL 也可见倒推出的 agent/plan/scene 定义，状态 PENDING_BSTACK）→ 失效 scaffold 浏览 | IN_SESSION | scaffold-manifest, story-runs, workflow-runs | — |
| L15 | `scaffold.reconciled` | A7 B 上线幂等对账（`reconcileScaffold`，按 manifest 未对账项重下发 → 升 SCAFFOLDED/REUSED + fullChainOk HARD）→ 失效 scaffold 浏览 | IN_SESSION | scaffold-manifest, story-runs | — |
| L15 | `build.verified` | A10 终态闭环验证（`verifyBuild`：publish 后/手动把主问句经 QOS 重跑 → VERIFIED/NOT_VERIFIED/BUILD_STATIC，回灌 FDE 节点图末节点 + 经 runId 与 growth LOOP CONVERGED 归一）| IN_SESSION | story-runs, fde-graph, growth-ledger | — |
| L15 | `prototype.intake_recorded` | 原型 intake 正门（`prototype-intake.ts parsePrototypeHtml` 确定性抽数据表+关系 → `reconcileIntake` 对既有本体字段对账预览：映射不上生成 SchemaReconcileCandidate 给人确认，P2 落 HITL 队列）→ 失效 intake 预览/对账队列 | IN_SESSION | intake-preview, reconcile-queue | — |
| L15 | `prototype.materialized` | prototype-intake P3·HTML 导入正门物化进库（`intake/import` → prototype_html 连接器把内嵌多表全量落 RawDataset，数据连接器可见 + 在线查看从库读）→ 失效连接/原始表列表 | IN_SESSION | connections, raw-datasets | — |
| L15 | `prototype.objectified` | prototype-intake P3 闭环末步·导入表按确定性对账物化为既有类型 ObjectInstance（`intake/objectify` → modeling.materializeFromReconcile，仅 autoMapped 入物化、其余诚实跳过，幂等）→ 失效对象类型计数 | IN_SESSION | object-type-stats | — |
| L15 | `schema_reconcile.resolved` | prototype-intake P2·schema 对账候选人确认（`reconcile-candidates/:id/resolve` USE/RENAME/NEW/MERGE/DISCARD）→ 失效对账队列 | IN_SESSION | reconcile-queue | — |
| L15 | `domain.provisional_built` | A18 双模闭包·PROVISIONAL 未审核态建域完成（`closure.ts` HARD 缺口降 ADVISORY 不阻断、`buildMode=PROVISIONAL`，整域强标 `domainTrustLevel=UNVERIFIED`，终态 `PROVISIONAL_ANSWER` 绝不 VERIFIED）→ 失效历史/审核台 | IN_SESSION | story-runs, provisional-review | — |
| L15 | `solver.provisional_generated` | A18.2 LLM 临时求解器（`solvers/llm-gen.ts` 生成 → 冻结 hash+版本 → `sandbox.ts` 锁死子进程跑通自检 → 注册 SolverArtifact `status=PROVISIONAL/trustLevel=UNVERIFIED`）→ 失效求解器目录/审核台 | IN_SESSION | solver-registry, provisional-review | — |
| L15 | `solver.status_changed` | A18.4 临时求解器晋升（`promoteSolver` 人工审批 PROVISIONAL→GOVERNED，trustLevel→VERIFIED，解锁写真值 R4）→ 失效求解器目录/审核台 | IN_SESSION | solver-registry, provisional-review | — |
| L15 | `domain.promoted` | A18.4 整域晋升编排（`promoteDomain` 人工审批 PROVISIONAL 域→把隔离命名空间 `tenant::prov::runId` 的本体/对象/链路/原始表/连接器/规则/切片整体迁入真租户+发布版本+跑派生 ⊕ 逐制品晋升临时求解器 GOVERNED ⊕ 翻转 domainTrustLevel→GOVERNED）→ 失效历史/审核台/对象库/求解器目录 | IN_SESSION | story-runs, provisional-review, object-queries, solver-registry | — |
| L17 | `metric.snapshot_recorded` | SPINE.2 指标快照回采（`POST /a/v1/metrics/snapshot`：`metric_rollup` 实算 actual → 执行回采更新口径，派生投影非新真值 R13）→ 失效驾驶舱/各视图 KPI | IN_SESSION | metrics, dashboard, scenario-data | — |
| L17 | `metric.breached` | SPINE.2 指标越线（actual<floorVal → 触发 `plan_rootcause`/`risk_timeline` 推演、派 `Principal` 行动）→ 通知 + 失效风险页 | NOTIFY | metrics, dashboard, risk, notifications | — |
| L16 | `entity.out_of_domain` | 感知层·槽位解析裸串实体在本租户任何已发布类型都解析不到（`router/slots.ts fillSlots`）→ orchestrator 发任务事件 + `perception-metrics.ts` 记误触发率（域外/尝试）+ 取最近邻候选供澄清 | NOTIFY | perception-metrics | — |
| L-sim | `sim.session_created` | 推演沙盘 init 建会话（增量 1，设计待落）→ 失效沙盘会话列表 | IN_SESSION | sim-sessions | — |
| L-sim | `sim.tick_completed` | 沙盘推进 1+ tick（`propagateTick` 传导落 SimTickState，增量 1/3）→ 失效沙盘态/轨迹可视化 | IN_SESSION | sim-session-view, propagation-timeline | — |
| L-sim | `sim.checkpoint_saved` | 沙盘命名存档（增量 1）→ 失效检查点列表/分支基点 | IN_SESSION | sim-checkpoints | — |
| L-sim | `sim.branched` | 以检查点态开新分支会话（增量 1）→ 失效会话树/对比视图 | IN_SESSION | sim-sessions, sim-compare | — |

> B↔A 缓存：B 对 A 资源缓存 TTL 60s + `{kind}.updated` 事件失效（钩子 `POST /b/v1/internal/invalidate`），传播 SLO ≤60s。

---

## 5. 系统不变量（规则 = 改动不可违反的铁律）

> 来源：根 `CLAUDE.md` + 闭包/审核。违反即返工。

| # | 不变量 | 检测点 |
|---|---|---|
| R1 | **contracts-only-shared**：跨包只依赖 `@platform/contracts`；前端不重定义契约类型 | 构建/评审 |
| R2 | **tenant_id everywhere**：所有读写/事件/缓存键带 tenantId；跨租户 403/404 | 仓储层 |
| R3 | **entitlement 先于 authz**：功能关 = 不存在 → 404 `FEATURE_NOT_FOUND` | `features.ts`/`gate.ts` |
| R4 | **真值写入经 Action 审批**：对象物化/本体变更经 `domainExecutor`（Phase9B），EXECUTED 才落。**职责分离为默认策略、可配置留痕例外（SA，有意放宽）**：发起人自批默认硬阻断（STRICT=现行为）；按租户策略 `selfApprovePolicy`（env `SELF_APPROVE_POLICY` 覆盖；demo 默认 ALLOW_ADMIN）或类型 `ActionType.selfApproveAllowed` 可放行发起人自审，但**必显式留痕 `ApprovalStep.selfApproved=true`**（R13 透明可审计，杜绝悄绕）——解锁单 admin/演示租户下 provisional→governed / SOP 定稿 / gap-fill 收尾等 R4 收尾闭环 | `app.ts:290` · `actions.ts`（`tenantSelfApprovePolicy`/`selfApproveAllowedFor`） |
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
| **R15** | **CLI 对等（A15）**：每个对外模块能力必须有 CLI 等价命令（注册 `OPERATION_CATALOG`），经同一 REST + R3 + R4 + 事件触发——CLI 与 GUI 平行同源、无功能洼地；不宜 CLI 内联的（求解器上传/复杂可视化）须登记 GUI 深链（`uiDeepLink`）。新增对外能力无 CLI 命令/深链 = 功能洼地，返工。 | ✅ `cli-parity:check`（棘轮基线 `cli-parity-baseline.json`；OPERATION_CATALOG 每条须 cliCommand 或 uiDeepLink，新增不可达即红）；`POST /b/v1/operations/classify` + `platform do` 万能路由 |
| **R16** | **发育闭环（system-ontogenesis 总纲）**：系统是个体发生的有机体——**倒序发育**（从场景/需求倒推长出数据/对象/规则/求解器/Agent/工作流）⊕ **正序运作**（QOS 问句→答案沿已长成管线）是同一有机体两相（`StoryBuildRun⊕GrowthLedgerEntry by runId` 认两面）。每次发育（建域/补缺/scaffold）须自动闭合**三环**：①数据（build-to-verify 真能在正序跑通，A10）②本体（新对象/链路/事件进活体本体，dogfooding §9，非手抄）③能力（目录从注册表自动派生 `deriveOperationCatalog`/`FEATURE_REGISTRY`/`SOLVER_CATALOG`，非手维护）；产物**二分处置**（AUTO-DERIVE 自动生成 / NEEDS-HUMAN 自动开 `GrowthTicket`+通知+收件箱+深链，**绝不静默残缺**）；发育过程**透明可视**（FDE 节点图/模块同步矩阵/覆盖度）；成熟**分相位** PROVISIONAL→ADVISORY→GOVERNED（只 GOVERNED 计真值，A18）。正序 `GapReport`=生长信号自动触发倒序生长——越用越大。复用 R4/R6/R11/R12/R13/R14/R-一致。 | ◐ 机制散落已具雏形（runStory/growth LOOP/A10/A18/dogfooding/CL.1–CL.7）；`ontogenesis:check` 门（三环+二分声明性校验，已并入 `pnpm gates`）；活体本体落库 + 自动派生目录分相位演进。事件 `ontogenesis.organ_matured`（L-onto，产物 GOVERNED 转正，可选）·切片 `sys.meta.ontogenesis_loop` |
| **R17** | **决策单页（Decision-on-one-page · 前端宪法 · 推演沙盘 HANDOFF 增量 0 立）**：决策页一页看全 **数据→推演→溯源→动作→AI**，就地下钻不跳页、配置驱动密度。新决策页（沙盘主屏/数据管道建模/就绪认证）天然遵循；改动到的现有决策页对齐（不主动重排全部，渐进）。竞品沙盘屏三栏（图谱 · Runtime Health/Trust 雷达 · AI 指挥台）= R17.2 的成品参照（`GROUNDING-MAP §F.1`）。 | 🚧 拟立（增量 0 入本体即生效）；配套门 `decision-page:check`（待建·增量 4 随 UI 落）；新决策页须遵循，旧页渐进对齐 |
| **十红线（推演沙盘落地纪律 · `docs/HANDOFF-sandbox-build-and-review-contract.md` §4 · 越线即停）** | RL1 本体先行(改接线先回写本体过 `ontology:check`) · RL2 暗发(新模块 `defaultOn:false` 不动现有租户) · RL3 单一来源(不出双份；就绪=投影既有 closure 零新校验；单源门复用 `boundary-singlesource:check` 勿造 `ia-single-source:check`) · RL4 走正门(沙盘 act 模拟态，采纳才经 Action R4 写真值) · RL5 零业务常数(传导核/表无行业实体名，两行业验收 R14) · RL6 确定性(传导核纯函数，无 Date.now/随机，R6) · RL7 CLI 先于 UI(R15) · RL8 倒序长出(世界态经连接器/合成/runStory，禁硬编码 seed，R16) · RL9 additive 可回退(迁移有 down，entitlement 关=404，旧路径在) · RL10 不与在建分叉(复用 sim-views/A8/recompute/replay/ontogenesis/closure，不平行造第二套)。 | 大多复用既有不变量（RL1=R16本体先行·RL3=R-一致·RL4=R4·RL5=R14·RL6=R6·RL7=R15·RL8=R16·RL10=不分叉）；逐 PR 评审硬判据（HANDOFF §5） |

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
- **`boundary-singlesource:check` 业务实例册单一来源门（DF.1–DF.3，G-5/R14/R6）**：静态断言三 BASE 消费端（datacore `battery.ts` BASES · 前端 `fixtures.ts` BASES · `simSolvers.ts` MOCK_BASES）均从 `@platform/contracts` BASE_REGISTRY **派生**（含 `.map`）且无内联 12 基地字面量回潮（baseId 字面量 ≥6 即红），四 SEG 消费端（`battery.ts`/`risk.ts`/`OrderChainView.tsx`/`simSolvers.ts`）均引用 SEG_REGISTRY、三 PLAN_GOAL 消费端（`battery.ts`/`PlanGenerateView.tsx`/`fixtures.ts`）均引用 PLAN_GOAL_TARGETS（DF.4）——防"改一处业务常数须手改多处、漏改即前后端崩不同步"漂移复发 · `scripts/check-boundary-singlesource.mjs`，`pnpm boundary-singlesource:check`。已并入 `pnpm gates`。
- **`cockpit-widgets:check` 门A · 经营驾驶舱 PRD↔widget 覆盖对账（防结构遗漏 + 后端/mock 两套 DASH_LAYOUT 漂移）**：静态断言 PRD §2.1/§3.3 必备 widget type（kpi/metric-strip/dag/counterfactual/version-toggle/order-ledger/plan-drill）在后端 `service.ts` DASH_LAYOUT + 前端 `fixtures.ts` DASH_LAYOUT + `DashboardView` 渲染分支**三处皆有**，必备组件区块（dash-problems/feedback-chain/modules/export）在 DashboardView——任一缺即红。由来：曾判"经营驾驶舱完成"却漏 order-ledger/plan-drill 整块（jsdom 只测"渲染了的"，测不出"该有却没有的"）· `scripts/check-cockpit-widgets.mjs`，已并入 `pnpm gates`。落地即抓出 mock 缺 metric-strip/dag 真漂移。
- **`ui-smoke` 门B · UI 交互冒烟（真浏览器 Playwright，治"渲染绿但点不动/下钻断"）**：起真 dev server(VITE_MOCK :5199) + Playwright 以用户身份点经营驾驶舱关键交互（问题卡下钻 order-chain / 台账行下钻 / 规划推演去体检 / 导出 / 模块直达），断言可达；死按钮/断链即红。补 fde-delivery 真前端验收欠债（jsdom 对 div/button 都触发合成 click，测不出纯 div 死按钮——曾漏问题卡不可点 bug，218 绿测试全过）· `scripts/ui-smoke.mjs`，`pnpm ui-smoke`（环境无 chromium 则 SKIP；CI 启用需 `npx playwright install chromium`，独立 job 非 `pnpm gates` 内以免环境依赖致不稳）。
- **`cli-parity:check` CLI 对等门（R15，A15）**：静态校验 `OPERATION_CATALOG`（`contracts/operation-intent.ts`）每条都有 `cliCommand` 或 `uiDeepLink`，且 cliCommand 经 CLI 调度（`platform-cli.mjs` run{} 或 `do` 万能路由）可达；棘轮基线 `scripts/cli-parity-baseline.json` 防回潮——新增对外能力无 CLI 命令/深链即红 · `scripts/check-cli-parity.mjs`，`pnpm cli-parity:check`。已并入 `pnpm gates`。
- **`provisional-honesty:check` 未审核诚实门（A18）**：test-backed（`a18-provisional-closure.test.ts`）——PROVISIONAL 域须 `domainTrustLevel=UNVERIFIED` + 终态 `PROVISIONAL_ANSWER`（绝不 VERIFIED/answerable）+ 闭包缺口全 `ADVISORY` + 不 `blocked`；`checkProvisionalHonesty` 纯函数守"未审核态绝不谎报"（R13）· `pnpm provisional-honesty:check`。
- **`prd:check` PRD 库结构化门（治理 #2）**：解析每篇 PRD 的《本体引用与影响》§0 → 写机器可读索引 `docs/prd-ontology-index.json`（PRD↔不变量/断点，需求↔制品↔缺口可查）；校验引用的 R/G 在本体真实存在（悬空引用即红），报告断点 PRD 覆盖与缺口、遗留 PRD 缺 §0（告警） · `scripts/check-prd-ontology.mjs`，`pnpm prd:check`。
- **`rule-closure:check` 规则引用闭包门（G-10 规则即引用 P1，R11 输出侧）**：静态断言 `⋃(SOLVER_RULE_REFS, SCENARIO_CATALOG.rules) ⊆ battery.ts rules[] 定义`——求解器/场景引用的规则码必须有一等定义（否则"关联规则半空 / 改规则不改推演"），只匹配带引号 `'Cxx'`（避颜色码 `#4C90F0` 误报）· `scripts/check-rule-closure.mjs`，`pnpm rule-closure:check`。已并入 `pnpm gates`。
- **`no-hardcoded-rules:check` 求解器阈值去硬编码门（G-10 规则即引用 P2，R14 规则维度）**：保守哨兵——与已登记规则同义的业务阈值（C09 数据健康降级系数/时延、C04 认证产能系数）必须从参数读（`capacity.ts` 须含 `p.health.staleHours`/`p.health.degraded`/`p.certFactors`，且无 0.93/0.90 裸字面量），防"改规则不改推演"回潮；新求解器引入裸业务阈值需扩断言 · `scripts/check-no-hardcoded-rules.mjs`，`pnpm no-hardcoded-rules:check`。已并入 `pnpm gates`。
- **`ontology-writeback:check` 本体回写完整性门（治理 · 反向守"代码改接线却漏回写本体"）**：静态断言**每个并入 `pnpm gates` 的 `check-*.mjs` 门都在本体 §7 登记**（门名/脚本名/pnpm 别名出现在 §7）——补 `check-prd-ontology` 只查"PRD→本体悬空引用"（正向）的反向缺口（代码新增门，本体漏登记，正是 P2 漏回写 no-hardcoded 的根因）· `scripts/check-ontology-writeback.mjs`，`pnpm ontology-writeback:check`。已并入 `pnpm gates`。
- **`prd:coverage` PRD 覆盖对账门（治理）**：解析 PRD↔实现文件双向覆盖，写 `docs/prd-coverage-index.json`（covered/uncovered/coverage 比），报告哪些 PRD 缺实现锚点 · `scripts/check-prd-coverage.mjs`，`pnpm prd:coverage`。已并入 `pnpm gates`。
- **`meta:sync` 元本体自反落库门（Dogfooding P1）**：把本体 markdown 确定性投影为元对象物化进元租户 `__platform__`（八类节点：对象/不变量/断点/事件/域/切片/门/链路），R2 隔离（业务租户查不到元对象）+ 影响分析 BFS · `scripts/check-meta-sync.mjs`，`pnpm meta:sync`。已并入 `pnpm gates`。
- **`ontogenesis:check` 发育闭环门（R16，G-9）**：声明性校验 R16 发育闭环不变量在本体钉牢（倒序⊕正序两相、三环自动闭合、二分处置、分相位成熟）+ §6 静态逐卡断言（每卡 plan 有 render 步 / 卡 solver ∈ SOLVER_OUTPUT_SHAPES / 卡 rules ⊆ 已发布规则 / 卡 intentKey 有意图计划；运行期事实由 grow 测试+门B 保证，静态门诚实跳过）· `scripts/check-ontogenesis.mjs`，`pnpm ontogenesis:check`。已并入 `pnpm gates`。
- **跨服务联调冒烟**（守护 G-2 + 挡 mock 漂移）：真实 AgentCore HTTP 客户端 ↔ 真实 DataCore · `apps/datacore/test/xservice-smoke.test.ts`。
- **场景接线回归**（守护 G-1）：20 场景全有意图+计划+求解器 · `apps/agentcore/test/scenarios-wiring.test.ts`。
- **本体必读强制**（治理）：CLAUDE.md 铁律 0 + SessionStart 钩子（从 §8 动态注入未修断点，结构上不漂）+ `/ontology` skill。
- **全链闭包门（R11）**：`chain:check` 覆盖"场景↔求解器注册" + SHAPE 输出形状覆盖报告；`validateClosure` 焊进 **CHAIN**（求解器注册）+ **SHAPE**（求解器输出形状↔渲染绑定 `renderBindings`，挡 G-2 跨服务形状）两维。**余**：补齐其余求解器输出形状声明 + BuildPlan 渲染契约自动生成。详 `docs/PRD-unified-build-engine.md`。
- **推演沙盘门（G-11 · 增量 0 登记契约 · 脚本待各增量新建并入 `pnpm gates`，本步不写未存在脚本路径以免文件锚点门红）**：
  - **`sim:check`（增量 1 已建·并入 `pnpm gates`）**——静态守会话层结构不变量：migration026 四表+down(R9 可回退)、R9 四处同改(SimRepo 接口+memory+pg)、sim.* 暗发 defaultOn:false 不回潮、端点过 requireSim entitlement 门(R3)、sim 路由无 Math.random(确定性 R6)；运行时由 `apps/datacore/test/sim-session.test.ts` 覆盖(init/tick/checkpoint/rollback/branch/确定性/R2) · `scripts/check-sim.mjs`，`pnpm sim:check`。
  - **`propagation:check`（增量 3 已建·并入 `pnpm gates`）**——test-backed 守传导核：系数×延迟正确性 + 改系数即改果 + Temporal Trust（tick 只读 ≤t 态，不窥未来）+ 确定性 R6（无 Date.now/Math.random）+ 零业务常数 R14 · `scripts/check-propagation.mjs`，运行时见 `apps/datacore/test/sim-propagation.test.ts`（propagateTick 贡献/延迟/确定性/coefficientRef）。
  - **`sim-readiness:check`（增量 2 已建·并入 `pnpm gates`）**——就绪认证 = 投影既有 closure（RL3 单源）：静态扫 `deriveCertification` 不 import closure 以外校验器 + L4 三子项全真才 CERTIFIED + `canEnterSimulation` 含 trialTick.passed∧L4∧gatePassed + 缺件入 `gaps[]` 诚实 + 全局/局部同一函数 · `scripts/check-sim-readiness.mjs`，运行时见 `apps/datacore/test/sim-certification.test.ts`（详 `docs/SPEC-sandbox-readiness-certification.md §9`）。
  - **`ui-smoke:sandbox`（增量 4 已建·门B 真后端真浏览器，聚合外独立门同 `ui-smoke`）**——起真 datacore+vite + chromium，开通 sim.sandbox → 导航 `/v/sim-sandbox` → init 会话 → 点「推进 tick」→ 断言拓扑节点数=view-config nodeTypes + curTick 推进 + 就绪面板 L0-L4/诚实 gaps；无 chromium→SKIP(exit0) · `scripts/ui-smoke-sandbox.mjs`，`pnpm ui-smoke:sandbox`。
  - `decision-page:check`（R17 配套·增量 4 建）——决策页一页看全 数据→推演→溯源→动作→AI。
  - **单源门复用现存 `boundary-singlesource:check`**（沙盘 BASE/SEG/系数单一来源），**不新造 `ia-single-source:check`**（GROUNDING-MAP §A.2 裁决：重叠即违 RL3/RL10）。
  - **零业务常数**：沙盘 `sim/` 目录纳入 `debattery:check` 扫描（出现行业实体名即红，两行业验收 R14）。

---

## 8. 已知断点登记（截至 0614 全链审核）

> 这些是当前 AS-IS 的"断/弱链"，写进本体以免重复踩。详见 `docs/AUDIT-0614-fullchain.md`。

| 编号 | 断点 | 链路位置 | 性质 |
|---|---|---|---|
| G-1 | ~~20 场景仅 4 个端到端可跑（16 无 Intent/Plan）~~ **已修**：种子从 SCENARIO_CATALOG 单一来源派生全部 20 意图+计划（`mocks/seed.ts`）。~~16 个用静态 text 渲染~~ **P2 已闭静态渲染残面**：render 步改 `solver_summary` 通用投影（`workflow/executor.ts summarizeSolverOutput`——求解器真实输出→KPI/表/规则依据块，不写死任何业务数字/文案，`{{steps.s1.output}}` 经模板注入 + provId 溯源），前端任务页见的每个数都是求解器算出的真值（门B 实测 S15 quote_margin → margin/floor/diff/verdict 共 8 KPI 可见可溯）。配套 grow 诚实门：只静态占位文本（无承载数据块）→ 不充作 VERIFIED，记 `RENDER_NOT_PROJECTED`（防 P1 把"已完成推演"占位误判 GOVERNED）。**BP-4 闭最后纯指针残面**：S18 sop 卡此前特判只渲染跳转文本（"请见对应视图"）→ 改绑已注册求解器 `mrp_netting`（无入参，读 `MaterialBalance`）+ `solver_summary` → grow S18 → GOVERNED（门B 实测 materials 表 + shortageCount KPI），20 卡现全部走 invoke_solver→solver_summary | ScenarioCard→Intent→Plan→render 投影 | ✅ 已修（P2 投影闭残面 + BP-4 闭 sop 纯指针） |
| G-2 | ~~`affected_orders` plan 读 `data.rows/count`，真实返回 `affected/total` → 跨服务 FAIL~~ **已修**：DataCore 补 `rows/count/columns` 别名 `risk.ts:337`。**P2 又清两处同类残**（mock 接受、真后端拒的接缝，靠门B 真后端实测抓出）：① S03 render 硬引 `{{steps.s1.output.data.summary}}`，真实 `base_risk_profile` 切片无 summary → `TEMPLATE_RESOLUTION_ERROR`，改 `solver_summary` 通用投影（渲染切片真实字段，不脆断）② S06 `create_action_draft` 发 `baseId/solutionName`，真实 action-drafts 端点 paramsSchema 必填 `base/factor/planKey` → 400，改映射契约字段 + 补 factor 槽（presetSlots 填，可选） | Plan render↔Solver/Slice/Action 输出 | ✅ 已修（P2 清两残） |
| G-3 | ~~无场景启动器；presetContext 未注入 QOS~~ **◐ 大部修（P1+P2）**：P1 `SessionContext.presetSlots` 注入通道 + `fillSlots` 消费（`slots.ts`）+ `POST /b/v1/scenarios/:key/launch` + **零反问门**（20/20）；**P2 Scenario 升一等持久化对象**（`scenarios` 仓储四处 + 出厂幂等 upsert + DRAFT/PUBLISHED/RETIRED + `scenario.*` 事件 + 管理 CRUD `POST/PUT /b/v1/scenarios`·`/publish`·`/retire`，SceneEntry 降投影）。**待**：前端 ⌘K/目录/首页启动器 + 场景编辑器(P3)。**CL.2 agent 侧自助补数据（已落）**：path-B agent 工具集补 `fill_data`/`run_synthetic`/`build_domain`（`tools/registry.ts` + `executor.ts` + `DataGenClient`→`POST /a/v1/{growth/fill-data,synthetic/jobs,databuilder/runs}` OBO）——"信息不足/空租户"时触发**确定性、走管线、可溯源**的合成（**触发合成≠伪造**），回执只含元信息（jobId/runId/counts）+ `provisional:true`，业务数字由后续 `query_*` 读回真实物化值（铁律自洽），产出落 PROVISIONAL 经 R4 转正。**DF.9 真人正门 HARD/SOFT 分流（已落）**：给 CL.2「触发合成」装接地闸——缺数据涉真实业务实体（命中 BASE/SEG 词表）→ HARD 不合成、出精确 DataRequest 走真人正门，仅通用数据走 SOFT 合成（`growth/data-boundary.ts`，详 §2.B GapReport P2）。**CL.3 discover 真实类型名（已落）**：`discover{object_types}` 返本租户已发布 `ObjectType{key,label,domain,instanceCount}`（经 `/a/v1/ontology/object-types/stats`）；`query_objects`/`get_object` 对未知 typeKey 返 `UNKNOWN_TYPE`+`validTypes`+did-you-mean（Levenshtein，R6），类型存在但 0 实例返 `empty:true`+引导提示——区分"空 vs 不存在"，agent 照真名查不再猜 `plan_version/production_target`。**CL.4 空租户冷启动引导（已落）**：`POST /a/v1/bootstrap`（requireAdmin，OPERATION_CATALOG `bootstrap` op/R15）幂等串 7 步——合成 seed 计划域(livedIn)→核对 PlanTarget/AnnualScenario 物化→建/复用月度 SopVersion→五步法推进(步④财务取参数版本基线种子达 C18)→定稿 FINAL 走 R4(单 admin 经 SA 自审)→核对 currentPlanVersion→plan_audit(入参取当前版本/PlanTarget 基线)。任一步核对未达→停并报结构化缺口码（诚实不空转）；同 seed 字节一致(R6)、重跑跳过已成步。与既有 `bootstrap.ts`(platform_admin 超管创建)无关。详 `docs/PRD-scenario-launcher.md`/`docs/PRD-agent-data-generation-tools.md`/`docs/PRD-discover-real-type-names.md`/`docs/PRD-empty-tenant-bootstrap.md` | Scenario(一等)↔SceneEntry(投影)↔前端 · Tool(BUILTIN+3 · discover+object_types) · Bootstrap(7步编排) · plan_audit入参兜底 | ◐ P1+P2+CL.2+CL.3+CL.4+CL.6 已落 |
| G-4 | ~~意图绑定的执行计划无前端创建入口~~ **已修**：CatalogPage ＋新建执行计划（createPlan）、WorkflowsPage/SkillsPage ＋新建按钮 + mock POST handlers；g4 回归测试 + 112 前端测试绿 | Intent→Plan 配置面 | ✅ 已修 |
| G-5 | 应用层电池锁死（**本轮审计量化**：8a 视图结构写死≈9 视图含 DAG · 8b 业务数据进生产（**✅ DF.1–DF.3 收窄**：12 基地册 BASES/MOCK_BASES + 3 应用细分 SEG 价/利/色曾散写前后端三/四处 → 收敛为 `@platform/contracts` BASE_REGISTRY/SEG_REGISTRY 单一来源、消费端 `.map` 派生、`boundary-singlesource:check` 守不回潮，R6 字节一致；**DF.4 续收 plan_generate 目标阈值三处漂移→`PLAN_GOAL_TARGETS`**；经核实审计阈值/方案库已单一来源不入册） · 8c 文案/i18n 租户专属 · 8d Agent 配置/模型写死 · **8f ✅ A6 拟真值域+越线植入**：通用合成路 `valueDomain`(业务区间分布)+`PlantSpec`(确定性植入越线/近边界,规则反推 opt-in) 把电池专属"业务区间+戏剧点"升为模板可声明能力(`synthetic/value-domains.ts`,R6 向后兼容/R14 值域库配置化) · 8e ✅ `generic-inference` 通用 what-if 已落：`recompute(dryRun+apply)` 在克隆图上前向重算派生、不落真值 + `POST /a/v1/inference/whatif`，行业无关；O4b 回归证明无副作用。注：作用于 compileSpecs 派生本体；合成 demo 走 runDerivations 另一路）→ **撑不起其他租户/行业**。修法见 `docs/PRD-de-battery-multitenant-config.md`（结构←plan/ViewConfig.layout · 数据←API/WorkspaceConfig · 文案←i18n+行业别名 · Agent←表/Provider绑定）+ 新不变量 R14 + `debattery:check` 门 | 本体→生成应用→推演 | ◐ 大部修：8a 结构/8b 数据/8c 文案/8e generic-inference 已落；**`debattery:check` 基线 0**（业务常数全 genericize/config-drive/`debattery-allow` 声明）。通用 UI 文案 i18n 卫生（低价值）：启动器/首页 chrome 已迁入 `locales/zh.ts`（zh.home/zh.launcher），机制就位、其余页渐进迁移 |
| G-6 | ~~Excel parser TODO；合成在独立页；rawin 用独立 genCsv；数据模版/FK 驱动待~~ **✅ 收口（A2）**：`parseXlsx`（node-xlsx）三路统一(csv/json/xlsx)；合成并入连接器；rawin 去模板化统一到 `synthetic/schema-gen.ts`；**在线数据模版**：`synthetic/data-template.ts buildDataTemplates`（从已发布对象类型派生上传列模版、排除派生列、ref 列标注父类型）+ `GET /a/v1/data-templates[/:typeKey]`（列表/单类型 text/csv 下载）；**FK 一致生成**：`generateRelatedDatasets`（依赖序生成父表→收集真实 PK 池→子表 ref 取父表实际 PK，环降级不阻塞；样例可直接试灌、非凭空假值），单表无 ref 与旧 `generateFromSchema` 字节级一致（R6 向后兼容） | Connector→RawDataset | ✅ 三路+生成器统一；数据模版+FK 一致收口 |
| G-7 | LLM 用途枚举写死不可扩展（待 PRD P5）；~~矩阵 model 下拉 stale 绑定显示空白~~ **已修**：已绑 model 不在目录仍可见可选 `LlmProvidersPage.tsx:474` | LlmPurposeBinding | ◐ 部分修（枚举扩展待 PRD） |
| G-8 | 数据构建闭包仅 DataCore 栈、不验全链 → **◐ 大部闭合**：① `chain:check` 跨系统门 ② **ClosureReport 加 CHAIN 维**（求解器需求未注册即 gate FAIL）③ **SHAPE 维（BuildPlan 扩 AgentCore 渲染栈）**：`SOLVER_OUTPUT_SHAPES` + `renderBindings`，`validateClosure` 校验渲染绑定 ⊆ 输出形状（建图期挡 G-2）④ **跨系统 scaffold 闭合（g8-P3）**：BuildPlan 扩 B 栈需求 + comprehend 故事倒推全栈（求解器→计划/意图/场景）+ `POST /b/v1/internal/scaffold`（SERVICE_TOKEN 守闸，幂等 DRAFT scaffold + DRAFT-aware 无死路门 → ScaffoldReceipt）+ DataCore closure 后 A→B 下发、`fullChainOk` 并入 StoryBuildRun 终态（断链→FAILED，R11 跨系统）。**待**：scaffold 前置到 A publish 阻断（当前记录于 StoryBuildRun 终态，A 数据已建）；补齐其余求解器输出形状声明。⑥ **DF.6 拉取靶（视图侧 SHAPE 维，keystone）**：solver-backed 视图 `VIEW_DEFS.layout += outputFields`（声明要拉的求解器输出字段，5 视图字段经 SOLVER_OUTPUT_SHAPES 核验）；`databuilder/pull-target.ts deriveViewPullTargets/checkPullTargetCoverage`（纯函数 R6/R14）逐 (视图,字段) 比对求解器输出形状 → COVERED/UNMET/SHAPE_UNKNOWN，UNMET=视图要而求解器算不出 → 该求解器缺此输出字段 → TO_CREATE（输出侧反向-data R12 生长信号，与 renderBindings SHAPE 维互补：一从倒推绑定、一从视图声明）；`GET /a/v1/views/pull-targets`。⑤ **工业级工作流运行时（已落）**：构建执行从内存 try-块升级为持久化步骤状态机 `BuildWorkflowRun`（检查点/可重入 resume/有界重试/逐步可观测，migration023）→ 崩溃不再丢状态、单步可重试、可审计 | BuildPlan→ClosureReport→ScaffoldManifest→B 制品 | ◐ CHAIN+SHAPE+跨系统 scaffold 已闭合；执行已工作流化 |
| G-9 | 场景卡未走 R16 发育闭环：闭包靠一次性手装播种（意图/计划写死 seed.ts）、上架靠浅门（`scenarioClosure` 只查 intent/plan/agent **存在**≠能用）、运行缺则**静默掉探索**（classify→OUT_OF_CATALOG→Path B→预算耗尽→"未能产出回答"）→ **◐ P1 大部修**：① **多租户 per-id 幂等播种**（`ensureScenarioPackageSeed`，覆盖任意租户非仅 demo，移出"包存在"守卫——修 PG 真部署"包在意图空→候选恒空"根因）② **§2.4 确定性绑定**：卡带 `scenarioIntentKey` → 编排器候选命中即直接绑定意图→计划、**跳过 LLM classify**（不受 classifier 死活/目录影响，`classification.model=deterministic:scenario-bind`）③ **grow=A10 验证即上架门**（`POST /b/v1/scenarios/:key/grow`：把 `triggerQuestion` 经 QOS 正序实跑到终态→验证真出答案[非空/非兜底/非 gap]才标 `maturity=GOVERNED`，否则 PROVISIONAL+`gapCode`，**诚实不静默**）④ **留痕 `ScenarioOntogenesisRun`**（三环 data/ontology/capability + 验证结论 + 答案预览 + taskId 溯源链，落卡上，前端 ScenesPage 可见"从哪来/到哪步/缺什么"）+ 事件 `scenario.matured`/`scenario.gap_detected`（IN_SESSION SSE）。⑤ **P2 投影渲染**：16 卡 render 改 `solver_summary` 通用投影（闭 G-1 静态残面，前端见真值可溯）+ grow 诚实门加 `dataBearing` 校验（无承载数据块→`RENDER_NOT_PROJECTED`，不再把占位文案误判 GOVERNED）。⑥ **BP-4 sop 卡接真数据**：S18 此前仅渲染跳转占位文本（sop_balance 是工作流非求解器，特判只 render）→ 改绑**已注册**求解器 `mrp_netting`（无入参、读 `MaterialBalance` 出 materials/shortageCount/summary 真表，`SOLVER_OUTPUT_SHAPES` 已登记）+ `solver_summary` 投影 → grow S18 → GOVERNED（门B 实测：materials 表 3 行 + shortageCount KPI，非占位）；20 卡现全部 invoke_solver→solver_summary（消灭最后一张纯指针）。⑦ **`ontogenesis:check` 扩静态逐卡断言**（`scripts/check-ontogenesis.mjs`，并入 `pnpm gates`）：A 派生器在位（每卡 plan 有 render 步）· B 卡 solver（sop_balance→mrp_netting 映射后）∈ `SOLVER_OUTPUT_SHAPES` · C 卡 rules ⊆ 已发布规则集 · D 卡 intentKey 有意图/计划；**运行期项（§6.1 GOVERNED 卡有 VERIFIED run / §6.5 未闭环卡 maturity≠GOVERNED+gaps）静态门测不了 → 诚实跳过 log，由 grow 测试 + 门B 保证（绿测试≠能用）**。**待 P3 余**：rules 自动接 evaluate_rules + slice 自动生成 + GapReport→runGrowthLoop 自动补。契约 `ScenarioMaturity`/`ScenarioOntogenesisRun`，PRD `docs/PRD-scenario-ontogenesis.md` | 卡(胚胎)→grow(倒序发育验证)→GOVERNED→launch(确定性绑定)→answer 投影 | ◐ P1+P2 已落（多租户播种+确定性绑定+验证门+留痕+投影渲染+诚实门+BP-4 sop 真数据+静态门扩断言） |
| G-10 | 规则被引用/被写死，但非一等可编辑引用 → 关联规则半空、规则闸空过、改规则不改推演（`docs/PRD-rules-as-references.md`）→ **◐ P1+P2 已落**：① **P1 闭引用**——补全 13 条曾未定义规则为一等规则（`battery.ts rules[]` C01/C02/C04/C06/C09/C10/C11/C15/C16/C21/C22/C24/C25，含 expression/severity/`params`）+ `SOLVER_RULE_REFS`（contracts 单一来源）+ 门 `rule-closure:check`（⋃ 引用 ⊆ 已定义，杜绝"未找到定义"）+ 前端 RuleRef 显真定义/阈值。② **P2 求解器读规则**——`SolverContext += rules/ruleSetVersion`（`loadContext` 注入已发布规则快照 + FNV-1a 版本指纹，R6）；求解器 `invoke` 透出 `evaluatedRules`（真 PASS/WARN/BLOCK，字段不可解析则诚实 NOT_APPLICABLE，不冒充通过）；**改规则即改推演**已验（改 C03 阈值 0.5→0.3 发布 → capacity 推演 C03 翻转 + ruleSetVersion 变，无需改代码，全 7 入口经 `/a/v1/solvers/:key/invoke` 汇聚点一次生效）+ 门 `no-hardcoded-rules:check`。**待 P3**：规则编辑器 UI 完善 + 版本/事件失效 + 6 入口逐一 FDE 验收 + 其余求解器 payload 映射（现仅 capacity_forecast 全闸门真评估，余者 NOT_APPLICABLE 待补） | 求解器/计划读规则链 ↔ Rule 一等可编辑 | ◐ P1+P2 已落（待 P3 编辑器/全求解器映射） |
| G-11 | 有仿真积木（simclock/recompute/risk.ts 逐 tick 衰减/runStory/sim-views 重算）**无交互沙盘**：无 `SimSession` 会话状态机（simclock 是单租户全局时钟非多会话）、无 checkpoint/回滚（`workflow/checkpoint.ts` 是 NoopStore）、无 branch 分支树、无"任意本体×逐 tick×系数×延迟×多跳"通用传导核（recompute 无时间轴、risk.ts 单链路电池语境）；且沙盘若硬编码行业则违 R14 → **◐ 增量 0 本体先行已立（设计待落）**：R17 决策单页(§5) + 十红线(§5) + 6 对象 `SimSession`/`SimTickState`/`SimCheckpoint`/`PropagationRule`/`SimCertification`/`SandboxViewConfig`(§2.I) + 沙盘链路(§3) + 4 `sim.*` 事件(§4) + 沙盘门待建登记(§7) 已写入本体。**增量 1 已落（CLI 会话状态机）**：migration026 三表+传导规则表（R9 四处 SimRepo）· `/a/v1/sim/*` 端点（init/tick桩/act/checkpoint/rollback/branch/compare/world + propagation-rules CRUD，全过 entitlement 门 R3）· 7 个 `sim.*` feature 暗发 defaultOn:false（lite/Pro/旗舰按租户开）· `platform sim` CLI（cli-parity 绿）· `sim:check` 门 + `sim-session.test.ts`（确定性 R6/R2 隔离）。**tick 为恒等桩，增量 3 换真 `propagateTick`（系数×延迟引用 `rule.params`）**。**增量 2 已落（就绪认证）**：`deriveCertification` 纯投影（RL3 零新校验，投影 closure 五维+GapReport+TrialTick→L0-L4/三维/L4三元组/世界完整度/canEnterSimulation/诚实 gaps）+ `/sim/sessions/:id/{certification,scope-precheck}` 端点 + CLI certify/precheck + `sim-readiness:check` 门。**增量 3 已落（传导核）**：`propagateTick` 纯函数（系数×延迟沿 viaLink，复用 recompute 导航+risk.ts 衰减，系数引用 `rule.params`，Temporal Trust 不窥未来，确定性 R6）+ tick 桩换真传导（opt-in：有 PUBLISHED 规则才传导，可回退）+ `propagation:check` 门。**增量 4 已落（UI · 暗发）**：`SandboxView` 配置驱动主决策页（R17 一页看全，复用 PmDag/HeatStrip/RadarChart/useLiveSolver，节点/边/状态变量/KPI 全从 `SandboxViewConfig` 派生，**零行业常数 debattery:check 守**）+ `/v/sim-sandbox` 路由 + NAV 入口（`sim.sandbox` 关→入口消失/404 SimSandboxGuard，暗发可回退）+ `GET /a/v1/sim/view-config`（本体派生配置）+ `sim API` 客户端 + 就绪面板（L0-L4/canEnter/诚实 gaps）+ 门B `ui-smoke:sandbox`。**两行业 R14 已验**：① 前端两 mock config（供应链/物流）同代码零改各渲染 ② 真后端端到端——非电池租户(物流 Warehouse/Route/Shipment)同一套 sim 代码 view-config 派生该行业类型 + init/tick 跑通（`sim-session.test.ts`）。**G-11 ◐（2026-06 撤回"全闭"）：后端 0–4 数据契约齐，UI 仅 ~30-40% + demo 空世界**。UI 设计对齐审计 `docs/AUDIT-sandbox-ui-design-alignment.md`（含真启动 Playwright 三路实拍 §3.5）查实：① **实拍 demo 沙盘=空世界**（0 状态变量/0 传导规则——demo 租户从没种 propagation rules/state vars；传导引擎本身真过 live-fire）；② 前端缺**北极星**（分支→对比 UI）、**R4 红线**（采纳→Action 草稿）、初始化向导/范围预检、AI 指挥台、就绪面板 ~70% 元素（L0-L4 stepper/L4三元组/Trial Tick/scope 切换/gauge/entering——后端 `deriveCertification` 都算了前端未渲染）；③ 我 PRD 自身漏**健康雷达6维+信任雷达4维+逐对象就绪%**（待回写 `SPEC-sandbox-readiness-certification`）。**已落为真（不抹杀）**：配置驱动派生（34类型/27链接来自本体非写死，零行业常数 debattery:check 守）+ tick/检查点 + 就绪面板诚实标"暂不可进入" + 传导核 `propagateTick` 纯函数 + 两行业 R14 验。复用 G-9 发育闭环 + G-10 规则即引用。传导核模型经竞品成品逐字验证（`docs/GROUNDING-MAP-sandbox-review-baseline.md §F.2`）。缺口逐条转 `HANDOFF §6.1`（P0：采纳/分支对比/向导/就绪砌齐/给 demo 种规则；P1：双雷达/逐对象/建模数据源面板/数据管道DAG/R13溯源）。**评审教训：此前"全闭/✅可合"是验功能未验设计完整性——UI 增量须两轴核对（竞品逐元素+设计 mockup 逐元素）方可判可用** | 通用推演沙盘链路 ↔ 倒序发育长出（非硬编码行业，两行业验收 R14） | ◐ 后端 0–4 齐；**UI ~30-40%（北极星/R4/向导/AI/双雷达/逐对象/70%就绪元素缺）+ demo 空世界，砌齐前不判"可用"** |
| BP-6 | ~~相对时间引用不归结：S03「常州物料齐套为什么**这天**越线」中 `day` 槽被分类器抽成 `"这天"`，不满足 `^YYYY-MM-DD` 校验 → date 槽归结失败、留 null（时间相关卡空槽）~~ **✅ 已修**：`router/slots.ts` 加**确定性相对时间归结兜底层**（`resolveRelativeDate`/`resolveAnchorDate`，LLM 抽取之后、defaultFrom 之前）——把 这天/今天/明天/本周/下周/上周/本月/下月/上月（中英）归结成视图上下文锚点日的具体日期；锚点**仅取现有 SessionContext 字段**（`timeWindow.from` 优先，否则 `filters` 内首个 YYYY-MM-DD 值，**未新增 contract 字段**）；纯函数/UTC/确定性（R6），无锚点则**诚实留空不编造 wall clock**。覆盖 `fillSlots` 抽取槽 + presetSlots 两路。门B 实测 S03（焦点窗 2026-06-24 + presetSlots.day="这天"，确定性绑定）→ `task.slots.day="2026-06-24"`（不再 null/"这天"）。**诚实边界**：归结依赖视图把焦点日放进 `timeWindow.from`/date 类 `filters`；前端 ScenarioLauncher 当前发 `filters:{}` 且无 timeWindow → 该路无锚点时仍诚实留 null（前端注入焦点日属前端文件范畴，未触及） | Query 槽填充：classifier 抽取→`slots.ts fillSlots` 相对时间归结→date 槽 | ✅ 已修（确定性归结层，仅用现有 SessionContext） |
| BP-7 | ~~空结果静默吞掉：S19 `quarterly_gap` 跑通但 `combo:[]`、`residualGap:50` → `summarizeSolverOutput` 仅在**全空**时出"无输出数据"，对**部分空数组字段**（结果数组空但其它数组/标量非空）静默不提 → 用户看到"有缺口、对策为空"沉默空数组~~ **✅ 已修**：`workflow/executor.ts summarizeSolverOutput` 记录**值为空数组的字段**与**有意义标量数**，凡有空数组字段即 render "**为何为空 + 下一步建议**" 文本块，并**区分两类**：①【真无解】关键标量在（如 residualGap/quarter）仅结果数组空 → 当前约束下无可行项，建议放宽约束/加杠杆/扩窗口；②【数据未接齐】连关键标量也缺 → 上游切片/口径未接齐，建议先接入/补齐数据（触发合成≠伪造，走管线读回真值）再重跑。**关键修复点**：判定**不以 `!table` 为门**——求解器常同时含无关非空数组（如 `evaluatedRules`）投成表，那张表不能掩盖主结果数组（combo/rows）为空，否则又退回静默。门B 实测 S19（真后端 quarterly_gap 返 `combo:[]`+`evaluatedRules` 非空）→ 答案出"**结果为空（真无解）…「combo」为空…下一步建议…**" + 仍保留真实 KPI/表，可溯源 | Plan render：`solver_summary` 通用投影→空数组字段显性化（闭 G-1 沉默空数组面） | ✅ 已修（空结果显性化，真无解 vs 数据未接齐） |

---

## 9. 演进与维护

- 本文是**接线单一来源**：改动若新增/改变对象类型、链路、事件、不变量、门禁 → **必须同步本文对应章节**，否则大脑过期即失效。
- 治理已落地（不靠自觉）：`CLAUDE.md` 铁律 0（必读）· SessionStart 钩子（每会话动态注入 §8 未修断点）· `pnpm ontology:check`（漂移即红）· `docs/_PRD-TEMPLATE.md`（强制《本体引用与影响》）· `/ontology` skill。
- 相关文档：**`docs/OPERATING-MODEL.md`（协同进化运行模型 = 机制宪法，统摄本体与 PRD）** · `docs/PRD-unified-build-engine.md`（统一构建发动机，全链闭包将补 R11 门禁）· `docs/AUDIT-0614-fullchain.md`（全链审核）· `docs/TODO.md`（排序路线）。
- 远期可**落库**：把本文的对象类型/链路/规则注册为平台自己的 ObjectType/Link/Rule（dogfooding），让"系统本体"也能被切片/校验/推演——即用平台分析平台自身。

---

## 10. 系统自我域 · 域内切片 · 跨域节点

### 10.1 两级域辨析（别混）

- **业务本体域**（`graphmeta.ts` GRAPH_DOMAIN + **A3.1 `BUSINESS_DOMAINS` 14 域参考注册表**）：14 业务域 = factory/product/process/equip/people/quality/capacity/forecast/**sales/material/finance**/plan/**external/decision**（配置驱动 R14，可被行业模板覆盖；参考原型 16 域去 solver/agent 计算元域）——给业务对象分组、A4 浏览器分组、切片规划器 tie-break（域内边优先）、跨域接缝识别共用。`GET /a/v1/business-domains`。**这不是本节对象（本节是系统自我域）。** A3.1 余：参考本体基线（元租户 95 节点）数据量大，待后续分期。
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
| **D10 运营时序域 Ops** | 时序/时钟/回放 | TsAggSpec/Run·SimulationClock·LivedInState·OpsSchedule·Replay。时序剧本 `tsGenerators`（battery）：oee:equip · yield:process · output:line · attainment:line（产线日）· util:line · **attainment:base（CL.5 基地级日达成率序，day grain，达成率=实际/目标 接 Metric achievement 口径，供"逐日时间维度归因"；末位追加保前序列 R6 字节一致）** |
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
| **`sys.orch.query_to_answer`** | **D7** | **Client(Web对话坞/CLI)→Query→Intent→Plan→Step*→{Solver\|Slice\|Rule}→AnswerBlock→SSE（中枢链=审核全链）**。CL.7 缺口块：`AnswerBlock` 增 `gap` 类型（含 GapReport）——答案命中缺口时对话坞渲染 `<GapCard>`（缺口码 + 人话 + 按码「▶触发生成缺失数据」复用 growth/run LOOP + CONVERGED 后「继续推演」重跑原问句 + 需开发码诚实"不可达:断在<码>"+工单深链），闭 G-3 对话侧（GF.1 前端+契约 · GF.2 orchestrator 路径 B agent 失败时 `failTask` 并入 gap 块[answer.final 先于 task.failed]→对话坞出可点缺口卡而非红错，均已落；SSE 进度回灌深度/就地 R4 审批=GF.3 续）。CL.6 归因补丁：「未达成原因/达成率归因」问句 → path-B agent discover{solvers} 命中 `plan_audit` → `invoke_solver(plan_audit)` 入参三级兜底（`plan_version_id ?? currentPlanVersion ?? deriveBaseline(PlanTarget/场景包)`，`/a/v1/solvers/plan_audit/invoke` 自动补，sop.ts:419）→ X01–X05 诊断（配 attainment:base 日序做逐日时间维度归因），不再因"无版本"放弃。**inference-process 横切（已落）**：`<InferenceProcessDag>`（前端组件）把本链真实轨迹（routing.path/step 事件/answer/gap）投影为 HTML 同构的 10 节点非线性编排 DAG——边语义 `par(并行②∥③)/conv(汇聚→④)/seq/aux(历史校正旁路)/fb(执行回采⑩跨周期反馈回②④)`，点节点看逐节点 IPO（输入/过程/输出），缺口节点红（取答案 gap 块/失败态，守"绿测试≠能用"，无运行标"未跑"）；拓扑=编排定义结构 config（R14），状态由真实任务流派生（R13）；挂 QueryDock 答案块"推演过程"折叠（可复用嵌 risk/project/order/audit/generate）。SSE→DAG 节点状态映射纯渲染投影，不新增真值 |
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
