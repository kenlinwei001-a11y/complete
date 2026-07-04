# 审计 · 硬编码残口彻查（R14 / G-5 应用层电池锁死）

> 日期 2026-07-03 · 分支 `claude/vigilant-knuth-b1nmxn` · 触发：用户「彻查还有哪些功能是硬编码的」
> 方法：5 子代理按类分区穷扫（Hα业务实体 / Hβ视图结构8a / Hγ dispatch路由 / Hδ时间preset / Hε阈值系数）→ 审核方读码复核。
> 排除（非硬编码/已修）：`@platform/contracts` BASE_REGISTRY/SEG_REGISTRY/PLAN_GOAL_TARGETS 及其 `.map` 消费端（已 genericize 的 FIX）· 物理常数/单位换算 · `locales/**` i18n · `synthetic/**` 行业模板 · presentation 色/标/icon 映射 · mocks/test。

## 1. 统一根因（一句话）

**平台把「数据层」genericize 了（BASE/SEG_REGISTRY 单源），但「派发层 / 结构层 / 阈值层 / 时间层」仍是电池硬编码** —— 所以「换个租户/行业/场景」还得改 ~15 个文件的代码。`debattery:check` 门查不到这些（它只查业务**常数字面**，查不到 dispatch switch / 视图结构 / 阈值 / mode）。~116 处·5 簇。

## 2. 五簇（confirmed·代理读码 + 审核方复核锚点）

### 簇 Hγ · 派发/路由硬编码（**架构根因**·"换行业就得改码"）——13 处 → 求解器派发簇 ✅ 已闭（HARDCODE-DISPATCH-REGISTRY）

> **✅ 闭环（HARDCODE-DISPATCH-REGISTRY·求解器派发/registry 簇 γ1/γ2/γ4 + γ3 结构先行）**：求解器派发的 **~7 张平行硬编码表**（γ1 `invokeRaw` 23 臂 `if(solverKey===)` 链 + `compute` switch · γ2 extended.ts 三联 `EXTENDED_SOLVERS` map+`extendedDataMode` switch+`deriveExtendedArgs` switch · γ4 `SOLVER_KEYS`+`SOLVER_OUTPUT_SHAPES`+`LIVE_DEFAULT_SOLVERS`+`A6_READOUT_SOLVERS`）→ 收口为**单一 registry-of-descriptors**：新增 `solvers/solver-registry.ts`（`SOLVER_REGISTRY` 每求解器一条 `{key,route,outputShape,a6Readout?,liveDefault?}`·参照 `datadep-context.ts CONTEXT_ROLES` 纯声明式范式·R14 零业务常数）；`SOLVER_KEYS`/`SOLVER_OUTPUT_SHAPES`/`LIVE_DEFAULT_SOLVERS`/`A6_READOUT_SOLVERS` 全部**从 registry 派生**（不再平行字面表）；`invokeRaw` 由 `route==="graph"` 驱动派发（迭代 registry·替代 23 臂 if 链），graph 求解器 key→私有实现的唯一绑定收口于 `graphHandlers`（**构造期断言其键集 == registry graph 集**·增删须同步两处否则 fail-fast·防漂移 teeth）；extended.ts 三联收口为 `EXTENDED_REGISTRY` 每 solver 一条 `{fn,dataMode,deriveArgs}`，三个导出从其派生。**语义零变（R6）**：全量 datacore 测试**断言不改**通过（字节一致证）；teeth `test/solver-registry.test.ts`（冻结 47 键顺序/route/flag 基线 + 派生一致性 + 三处 extended 键集不漂移）。**γ3（industry→template·结构先行）**：runJob 散落 6 处 `input.industry==="battery-manufacturing"` 平行判定收口为**一处命名事实** `usesBatteryPipeline`（语义零变）；full IndustryTemplate-record 驱动（消除电池 bespoke 特例·换行业不改码）属 **HARDCODE-BIZ-ENTITY** 后续（R14 禁「battery-manufacturing」字面进跨行业 registry 骨架·届时 battery 亦走 `instantiateGeneric`+模板数据）。**未闭（本 WO 范围外·其它文件/P2-P3）**：γ5 `ruleEvalPayload` 投影（service.ts·可后续入 descriptor.projection）· γ6 risk liveTightness · γ7 agentcore FEATURE_REGISTRY · γ8 frontend VIEW_ALIAS · γ9 graphmeta SOLVER_GRAPH（可后续从 registry descriptor 派生）· γ10 SCENARIO_CATALOG · γ11 industry→entitlement。

| # | file:line | 硬编码 | 应由 | 严重 |
|---|---|---|---|---|
| γ1 | `datacore/solvers/service.ts:2085` | 求解器分派 ~25臂 `if(solverKey===)`链(invokeRaw)+并行`switch`(compute) | registry(solverKey→handler 表驱动) | **P1** |
| γ2 | `datacore/solvers/extended.ts:402` | 13扩展solver经3并行结构(EXTENDED_SOLVERS map+extendedDataMode switch+deriveExtendedArgs switch)同键co-edit | 每solver一registry entry{fn,dataMode,argDeriv} | **P1** |
| γ3 | `datacore/synthetic/service.ts:124` | industry→template `if(industry==="battery-manufacturing")`≥6处(instantiateBattery vs generic·rule scopes·views·history·livedIn) | IndustryTemplate record 驱动 | **P1** |
| γ4 | `datacore/solvers/service.ts:47` | SOLVER_KEYS+SOLVER_OUTPUT_SHAPES(17字面)+LIVE_DEFAULT_SOLVERS+A6_READOUT_SOLVERS 并行表 | 从solver descriptor 派生 | P2 |
| γ5 | `datacore/solvers/service.ts:2174` | ruleEvalPayload per-solverKey if/else链(solver输出→rule字段名) | solver/binding descriptor projection | P2 |
| γ6 | `datacore/solvers/risk.ts:142` | liveTightness 硬编码CJK因子名(设备OEE/瓶颈工序/良率波动)接死对象字段·config声明的其他因子静默无live源 | factor→(objType,field,formula) config绑定 | P2 |
| γ7 | `agentcore/features/registry.ts:9,98` | FEATURE_REGISTRY bindings.intents/solverKeys字面(手维护镜像DataCore)+VIEW_ALIAS电池map | 单源消费DataCore feature/binding | P2 |
| γ8 | `frontend/views/registry.ts:25` | VIEW_ALIAS(与后端重复2份) | 骑scenario catalog数据 | P2 |
| γ9 | `datacore/graphmeta.ts:52` | SOLVER_GRAPH solverKey→{label,target,ruleRefs}map | solver registry descriptor | P2 |
| γ10 | `agentcore/scenarios-catalog.ts:60` | SCENARIO_CATALOG字面(缓解:seed Scenario对象·但scenarioByIntent字面查) | seed only·运行只读Scenario对象 | P2 |
| γ11 | `datacore/features.ts:208` · `app.ts:2546` | industry→entitlement if(battery)all · plan_audit required-args特例塞通用route | battery template.features · solver descriptor argHints | P3 |

### 簇 Hβ · 视图结构写死（G-5 8a·文档点名·~9视图）——22 处 → ✅ 已闭（HARDCODE-VIEW-LAYOUT）

> **✅ 闭环（HARDCODE-VIEW-LAYOUT）**：4 个 P1（β1 SopBalance 六卡 KPI 条 / β2 OrderChain 全链 KPI 卡 / β3 OrderChain 11 节点 DAG 层拓扑 / β4 ProjectSim 六层 DAG）由**内联 JS 数组**→ `ViewConfig.layout` 驱动（`kpiCards`/`kpis`/`dagLayout{kindLayers,layerTitles}`/`solverNodes`+调色板），渲染器**迭代 config**、前端常量仅 R14 兜底（换租户=换配置·金标准 SandboxView）。契约新增 `packages/contracts/src/viewlayout.ts`（KpiCardDef/DagLayerLayout/DagPalette）。value/裁决色仍按 card.key 绑求解器真值实算（逐值对照后端·不改语义·结构只换来源）。P2 复核：β5 Dashboard(moduleLinks/feedbackChain)·β6 Ledger(columns/objectType)·β7 PlanAudit(fieldGroups)/PlanGenerate(goalFields) **此前批次已 config 驱动**（无需再动）；β8 五步/六步 Step 标签走 `locales/zh` i18n（已外化非内联业务结构）。teeth `apps/frontend-shell/test/hardcode-view-layout.test.tsx`（注入独有 layout→渲染证非内联·3/3 绿）+ 真浏览器逐值对照 `docs/evidence/hardcode-view-layout-{sop,orderchain,projectsim}.png`（DEFAULT 兜底渲染=重构前逐值一致）。

| # | file:line | 硬编码结构 | 应由 | 严重 |
|---|---|---|---|---|
| β1 | `SopBalanceView.tsx:301` | 六卡KPI条(demand/supply/gap/revAttain/gm/cash)全内联(含公式/源/规则) | ViewConfig.layout.kpiCards | **P1** |
| β2 | `OrderChainView.tsx:472` | OrderFullchain 5/6-KPI条内联 | ViewConfig.layout.kpis | **P1** |
| β3 | `OrderChainView.tsx:429` | 11节点order-fullchain DAG层拓扑OFC_LAYER+4层标题内联 | 后端DAG layout(solver emit) | **P1** |
| β4 | `ProjectSimView.tsx:1120` | buildDag 六层固定DAG拓扑+边接线内联 | 后端DAG/ViewConfig.layout | **P1** |
| β5 | `DashboardView.tsx:56,64` | 6卡模块直达+5节点回采链内联(有override但默认电池) | ViewConfig.layout.moduleLinks/feedbackChain | P2 |
| β6 | `LedgerView.tsx:18` | 表列定义(SO/客户/型号/数量/交期/基地)+objectType=Order默认内联 | ViewConfig.layout.columns | P2 |
| β7 | `PlanAuditView.tsx:31` · `PlanGenerateView.tsx:56` | 体检3字段组(含乘用车/储能/商用车)·方案6目标字段 内联 | ViewConfig.layout.fieldGroups/goalFields | P2 |
| β8 | `SopBalanceView.tsx:251` · `ProjectSimView.tsx:546` | S&OP五步法·项目六步 各bespoke Step组件+step===N 分派内联 | ViewConfig.layout.steps | P2 |
| β9 | (P3·9处) | OrderChain根因DAG 4层标题 · ProjectSim driverFactors重复+dagNodeDetail switch · SopBalance DEFAULT_SEGMENTS/RESOLUTIONS/finance字段 · PlanGenerate MEET_KEYS/RadarChart 5维 · PropagationTimeline 4阶段 · Dashboard 三线series | ViewConfig.layout / 后端schema | P3 |

> 排除(已config驱动·金标准):OntologyGraphView(全view.options驱动)·SandboxView/SimInit/SimReadiness(全SandboxViewConfig派生·平台机制非业务)·AnnualScenario/Review(后端data驱动)。

### 簇 Hε · 阈值/系数写死（应入 SolverParam/rule/config）——~50 处·最大簇=extended.ts
| # | file:line | 硬编码 | 应由 | 严重 |
|---|---|---|---|---|
| ε1 | ✅ `risk.ts` | severity阈92/78+加成12 · tension常数62/70/0.6/0.8/40/98 → **已闭**（DEFAKE 迁 caseSeverity/demandTension；HARDCODE-SOLVER-PARAMS 补残留 upsideGain 0.5/tensionCap 98 入 `risk.demandTension`） | SolverParam risk.{caseSeverity,demandTension} | ✅ 已闭 |
| ε2 | ✅ `plan.ts` | verdict阈 M.length>=3 翻"可定稿但有重要风险" → **已闭**（入 `params.audit.verdictMedCount` 默认 3） | SolverParam audit.verdictMedCount | ✅ 已闭 |
| ε3 | `frontend QuarterlyRollingView:128` · `SopBalanceView:343` | LTA偏差阈5%(红) · 毛利容差0.5pp(后端已params前端重写) | ViewConfig/workspace.sopConfig | **P1** |
| ε4 | ✅ **`extended.ts` 全13+1 solver** | ~~**NO c.params**·内联全阈值~~ → **已闭**：over/under储1.5/0.8·idle90·maint间隔26·overdue30·EU碳70·外协1.0/1.4/2.5+40%/20%·urgency70/30·lock0.8·quote floor0.1/band0.01·认证40/组3 全迁入 `params.{mitigation,cert,lta,inventory,maintenance,outsourcing,quote,credit,carbon}`（骨架零业务名 R14·默认值入 battery IndustryPack）；solver 体读 `num(args.<key>,内联默认)`、`deriveArgs` 从 `c.params` 注入（真 param 驱动·默认字节一致 R6）。物理常数（1/12·365·除零 0.1）不迁·注释说明 | 每solver SolverParam(C08/C11/C15/C16/C28/C32/C33) | ✅ 已闭 |
| ε5 | `service.ts:821,987` · `fusion.ts:224` · `capex.ts:14,184` | KPI周期系数month/quarter/year 1.0/0.97/1.04 · KSF sev gap>=2 · 融合置信0.95/0.7/0.35 · ramp[0.5,0.75,0.9,1]·surplus 5% | SolverParam | P2 |
| ε6 | frontend `SopBalance:885`·`Dashboard:765`·`RiskBoard:218`·`OrderChain:360` | gap红阈2 · warn带 threshold-15 · 瓶颈`?? 85` | ViewConfig(多数后端已params·前端重写) | P2 |
| ε7 | `capex.ts:13 TAX_RATE 0.25` | 税率(法定但辖区/情景可变) | WorkspaceConfig(debattery-allow已标) | P3 |

### 簇 Hδ · 时间/preset 写死（sim-clock权威但处处重硬编码"当前"）——14 处 → **◑ datacore「当前」派生已闭（HARDCODE-CLOCK-DERIVE·δ3/δ5/δ6-calibration）**

> **◑ 收口（HARDCODE-CLOCK-DERIVE·datacore「当前」→ sim-clock t0 派生）**：新增 `apps/datacore/src/clockderive.ts`（纯函数 `currentDay/currentMonth/currentQuarter(t0)` + `DEFAULT_SIM_T0`·§A8 demo t0=2026-06-10 权威）。**δ3（datacore 部分）✅**：`extended.ts` lta_gap 默认 month `"2026-07"` → `currentMonth(c.params.forecastStart)`（=2026-06·**真 bug 修正**：旧字面与 t0 错位）· quarterly_gap 默认 quarter `"2026Q2"` → `currentQuarter(...)`（=2026-Q2·**格式修正** YYYY-Qn）· `seed.ts` demo SOP 月 `"2026-07"` → `currentMonth(forecastStart)`（=2026-06·server.ts 日志同步）。**δ6-calibration ✅**：`calibration/service.ts:237` baselineSeries 兜底 `?? "2026-07-01"` → `?? DEFAULT_SIM_T0`（无 clock 时诚实兜底至真 t0·旧字面错位真 bug）。**δ5 ✅**：`livedin/engine.ts` 35 处绝对叙事日期（CASE_SPECS 越线日/DELAY_OVERRIDES 交期/crisisWindow/规则史 changedAt/校准提案 createdAt/月度定稿锚点）→ **t0 偏移** `t0Minus(N)=addDays(NARRATIVE_T0,-N)`（`NARRATIVE_T0=forecastStart`）·改 t0 → 整条一年运营史随之平移。**R6 字节一致**：t0=2026-06-10 时 `t0Minus(N)` 逐条复现原绝对字面 → 全量 datacore 测试断言不改通过（**915 passed**=911+新 teeth 4·`livedin.test` Y4 断言 crisisWindow/CASE-007/C16 reason/MAPE 周 21 exact 值不变即证）。teeth `test/clock-derive.test.ts`（改 t0→派生月/季/日变 + extended derive 默认月/季经 `deriveExtendedArgs` 由 forecastStart 驱动·**退回硬编码 "2026-07" 即红**·已实证 `expected '2026-07' to be '2026-06'`）+ 真服务证：curl `/a/v1/solvers/lta_gap` 默认 month=2026-06 · `quarterly_gap` quarter=2026-Q2 · `/a/v1/sop/versions` 月=2026-06 · `/a/v1/synthetic/clock` t0=2026-06-10。**未闭（本 WO 范围外）**：δ1/δ2（agentcore `scenarios-catalog.ts`·LAUNCHER-GROUNDED 域）· δ4（frontend `QuarterlyRollingView`·SANDBOX 域）· δ6 前端项（`SopBalanceView`/ProjectSim·SANDBOX）· δ3 catalog S09/S19 preset（agentcore）。**保留为锚点（非「当前」·诚实边界）**：`battery.ts` 订单交期/规则出厂基线 definedAt/物料 eta（IndustryPack 需求/治理 fixture）· `synthetic/service.ts` 校准回测窗口（历史 backtest fixture）· `connectors mock` asOf（mock fixture·审计 §2 排除项）。

| # | file:line | 硬编码 | 应由 | 严重 |
|---|---|---|---|---|
| δ1 | `scenarios-catalog.ts:71` | S11 preset lineId"常州·动力线-A"死对象(真LINE-changzhou) | ontology resolve(已在LAUNCHER-GROUNDED单) | **P1** |
| δ2 | `scenarios-catalog.ts:78` | S18 slotPresets:{}无month→sop NOT_FOUND | clock注入(已在LAUNCHER-GROUNDED单) | **P1** |
| δ3 | ✅(datacore) `extended.ts` lta_gap month·quarterly_gap quarter · `seed.ts` demo SOP月 → **currentMonth/currentQuarter(t0) 派生**（格式修正+t0对齐真bug修）；catalog S09/S19(agentcore)未纳 | sim-clock派生 | P2 |
| δ4 | `QuarterlyRollingView.tsx:30` | 前端硬编码fetchQuarterly("2026-Q3")覆盖后端clock派生（SANDBOX域·未纳） | 省略from让后端派生 | P2 |
| δ5 | ✅ `livedin/engine.ts` 35绝对叙事日期(risk case/DELAY/crisisWindow/规则史/校准提案) → **t0Minus(N) 偏移**（改t0整史平移·R6字节一致 livedin.test Y4证） | t0偏移(如tick引擎) | P2 |
| δ6 | ✅(datacore) `calibration:237` fallback"2026-07-01" → **DEFAULT_SIM_T0**（真t0兜底·bug修）；前端项 `SopBalanceView`/ProjectSim(SANDBOX域·未纳)·connectors asOf(mock fixture·锚点保留) | clock派生 | P3 |

### 簇 Hα · 业务实体内联（应从ontology对象/registry）——20处 + debattery-allow白名单10处/36行 → **◐ P1 收口（HARDCODE-BIZ-ENTITY·datacore）**

> **◐ 收口（HARDCODE-BIZ-ENTITY·datacore biz-entity 逐条）**：**α1 segOfCust（P1·唯一 datacore 共享 runtime 分类逻辑）✅ 已闭**——`risk.ts segOfCust` 内联 EV 关键词判定（`/商用车/`→com·`/储能|电网/`→ess·else pas·非 EV 租户全塌 pas）→ **委派 `@platform/contracts classifySegment`**，关键词迁入 `SEG_REGISTRY[].keywords`（空 keywords=兜底 seg）单一来源，`segOfCust` 逻辑零业务名·换行业只改册不改码（R14）。默认==旧内联序列 → **R6 字节一致**（全量 datacore 测试断言不变·909 passed=905+新 teeth 4）；门牙 `test/seg-classify.test.ts`（改册 keywords→输出变·退回内联即红）+ 真服务证 `docs/evidence/hardcode-biz-entity-segofcust.md`（curl `affected_orders` bySegment 逐值一致 + registry-override 证非 EV 客户脱离 pas 兜底）。**α5 `capacity.ts` formation/aging ✅ 诚实保留**（非误迁）：`proc.props.kind` 已本体驱动，公式差异是**过程物理**（化成=通道吞吐 · 老化=库位停留），公式-as-data 化属独立大改（R6 风险）非本 WO；中文标签 化成/老化 是公式展示串。**α3/α4 `synthetic/livedin/connectors mock` ✅ 诚实保留为行业模板**：审计 §2「排除」项明列 `synthetic/**` 行业模板——CUSTOMERS/MOCK_ERP/CRM/opsteam 是 **battery IndustryPack 之正身**，R14 下业务实体正应驻此、由通用逻辑消费（换行业=换模板文件），非「共享 runtime 硬编码」。**α2 `scenarios-catalog.ts`（agentcore）** 与 LAUNCHER-GROUNDED/INTENT-MATERIALIZE 重叠，非 datacore 范围。**α6 P3 词表尾巴**：多为 fallback 占位/comprehend 关键词（agentcore），随各簇渐进。**debattery-allow 白名单（10 文件/36 行）全在 `apps/frontend-shell`**——`debattery:check` 仅扫前端 `views`/`pages/admin`（datacore/contracts 不在扫描面），由前端 owner（SANDBOX 域）逐条收口，**非 datacore biz-entity 范围**（本 WO 未触前端·门计数不变仍绿）。

| # | file:line | 硬编码 | 应由 | 严重 | 处置 |
|---|---|---|---|---|---|
| α1 | `risk.ts:921` | segOfCust `/商用车/储能/电网/`→com/ess/pas 关键词分类任意客户·非EV租户全塌pas | SEG_REGISTRY关键词/Customer.segment | **P1** | ✅ 迁 `classifySegment`+`SEG_REGISTRY.keywords`（R6 字节一致·teeth·真服务证） |
| α2 | `scenarios-catalog.ts:61-80` | 20场景catalog烤入bases/models/processes/materials/customers/lineId | 租户ontology-authored Scenario对象 | P2 | agentcore·LAUNCHER-GROUNDED 域（非 datacore biz-entity） |
| α3 | `livedin/engine.ts:41,66,635` | 客户名单CUSTS · 10行风险越线pinyin baseId表 · S&OP叙事串 | Customer对象/BASE_REGISTRY/事件派生 | P2 | 诚实保留：`synthetic/**` 行业模板 fixture（审计排除项·battery IndustryPack 正身） |
| α4 | `opsteam/defaults.ts+pools.ts` · `connectors/registry.ts:265` | personas/playbook base视角+modelPool · MOCK_ERP/CRM样本数据(models/pinyin baseId/materials/customers) | 租户对象/行业模板fixture | P2 | 诚实保留：行业模板/mock fixture（同上） |
| α5 | `capacity.ts:58` | formation/aging电池工序特例+中文标签化成/老化 | ProcessType ontology metadata | P2 | ✅ 诚实保留：过程物理（kind 已本体驱动·公式非可换业务常数） |
| α6 | (P3·~10处) | extended fallback"三元正极"/"涂布" · orchestration-skeleton 4680/电芯 · risk RISK_FACTOR_OBJ/正极串 · comprehend化成/卷绕关键词 · mapping/catalog/simclock/adminplatform/seed 各嵌常州/4680/base_manager:常州 | ontology词表/BASE_REGISTRY[0]/中性占位 | P3 | 尾巴（多 agentcore/fallback 占位）·随各簇渐进 |
| **白名单** | **10 文件/36行 `debattery-allow`** | GeoMap 12基地坐标·ProjectSim DEFAULT_MODELS/物流/地址·SopBalance SOP_KPI_P/段/决议·OrderChain SEG_ORDER/coef·PlanAudit字段·Dashboard 6导航副标·Calibration/Permissions/DataBuilder/Growth 4输入占位 | 多数=fallback可genericize(Base.lon/lat·simConfig·sopConfig·SEG_REGISTRY);占位类=纯UI低价值 | P2/P3 | 全在 `apps/frontend-shell`（前端 owner 收口·非 datacore 范围·`debattery:check` 只扫前端） |

## 3. WO 派发（5 grouped·按簇根因治本）
| WO | 覆盖簇 | 根因治本 |
|---|---|---|
| **HARDCODE-DISPATCH-REGISTRY（新·P1·架构根因）✅ 求解器派发簇已闭** | Hγ | ✅ 求解器/扩展solver 的 ~7 并行硬编码表 → **单一 `SOLVER_REGISTRY` descriptor 驱动**（`solvers/solver-registry.ts`·每 solver 一条 `{key,route,outputShape,a6Readout,liveDefault}`）；`SOLVER_KEYS`/`SOLVER_OUTPUT_SHAPES`/`LIVE_DEFAULT`/`A6_READOUT` 派生·`invokeRaw` 迭代 registry 派发（graphHandlers 构造期断言键集==registry graph 集·防漂移 teeth）·extended.ts 收口 `EXTENDED_REGISTRY{fn,dataMode,deriveArgs}`。语义零变（测试断言不改·`solver-registry.test`）。**γ3 industry→template 结构先行**（6 处判定→`usesBatteryPipeline` 一处），full IndustryTemplate-record 归 HARDCODE-BIZ-ENTITY。后续可继续把 γ5 ruleEvalPayload projection / γ9 SOLVER_GRAPH 收进 descriptor（门 `dispatch-registry:check` 待补）。 |
| **HARDCODE-VIEW-LAYOUT（新·P1·8a收口）** | Hβ | 9视图 KPI/列/step/DAG 结构 → ViewConfig.layout 驱动(SandboxView 金标准)。4 P1(SopBalance/OrderChain×2/ProjectSim DAG)先行。 |
| **HARDCODE-SOLVER-PARAMS（新·P1）✅ 求解器阈值簇已闭（ε1/ε2/ε4）** | Hε | ✅ extended.ts 全13+1 solver 内联阈值/系数 + risk.ts 残留(0.5/98) + plan.ts 判据(M≥3) → `SolverParamsShape.{mitigation,cert,lta,inventory,maintenance,outsourcing,quote,credit,carbon}`＋`risk.demandTension.{upsideGain,tensionCap}`/`audit.verdictMedCount`（骨架零业务名 R14·默认值入 battery IndustryPack·物理常数不迁）；solver 体读 `num(args.<key>,内联默认)`、`deriveArgs` 从 `c.params` 注入 → 真 param 驱动·租户可配·可校准（默认==内联→R6 字节一致·现有断言不变）。证：`docs/evidence/hardcode-solver-params-proof.mjs`（覆写 param→输出变）。**残留 ε3/ε5/ε6/ε7 属前端重写/service·fusion·capex/税率，另簇 P2/P3 未纳本 WO**；专用门 `solver-no-inline-threshold:check` 待补。 |
| **HARDCODE-CLOCK-DERIVE（新·P2）◑ datacore 已闭** | Hδ | ✅ datacore「当前」月/季/日由 sim-clock t0 派生（`clockderive.ts` helper·§A8 权威）：δ3 extended lta/quarterly 默认 + seed SOP 月 + δ6 calibration 兜底 → `currentMonth/Quarter(t0)`/`DEFAULT_SIM_T0`（含 2 真 bug 修正：旧 "2026-07" 与 t0 2026-06 错位、"2026Q2" 格式）；δ5 livedin 35 叙事日期 → `t0Minus(N)` 偏移（改 t0 整史平移）。R6 字节一致（915 passed·断言不改）·teeth `clock-derive.test`（退回硬编码即红·已实证）·真服务证。未闭：δ1/δ2/δ4/δ6前端项属 agentcore(LAUNCHER-GROUNDED)/frontend(SANDBOX)。 |
| **HARDCODE-BIZ-ENTITY（新·P2）◐ P1 收口（datacore）** | Hα | ✅ **α1 segOfCust（唯一 datacore 共享 runtime 分类逻辑）→ `classifySegment`+`SEG_REGISTRY.keywords`**（R14 换行业只改册·R6 字节一致·teeth+真服务证）；α5 capacity formation/aging **诚实保留**（过程物理·kind 已本体驱动）；α3/α4 `synthetic/livedin/connectors mock` **诚实保留为 battery IndustryPack 行业模板 fixture**（审计明列排除项）；α2/α6 属 agentcore/其它簇；**debattery-allow 白名单全在前端**（`debattery:check` 只扫前端·前端 owner 收口·非 datacore 范围）。 |

## 4. 诚实边界
- Hγ γ10(SCENARIO_CATALOG)/Hα α2 与 LAUNCHER-GROUNDED、INTENT-MATERIALIZE 部分重叠——接地/物化会消化一部分。
- Hε 与假值 sweep(AUDIT-fake-value)在 service.ts:1137(×0.9)、risk auditTimeline 有交集——阈值化 vs 真分位是两个角度,交由 METHOD-MC + 本簇分治。
- debattery:check 基线 0 是"业务常数字面"口径绿;本审计证 dispatch/结构/阈值/时间/mode 层硬编码是门盲区——建议门扩(dispatch-registry/solver-no-inline-threshold/view-layout-config)。
