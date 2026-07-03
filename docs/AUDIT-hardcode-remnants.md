# 审计 · 硬编码残口彻查（R14 / G-5 应用层电池锁死）

> 日期 2026-07-03 · 分支 `claude/vigilant-knuth-b1nmxn` · 触发：用户「彻查还有哪些功能是硬编码的」
> 方法：5 子代理按类分区穷扫（Hα业务实体 / Hβ视图结构8a / Hγ dispatch路由 / Hδ时间preset / Hε阈值系数）→ 审核方读码复核。
> 排除（非硬编码/已修）：`@platform/contracts` BASE_REGISTRY/SEG_REGISTRY/PLAN_GOAL_TARGETS 及其 `.map` 消费端（已 genericize 的 FIX）· 物理常数/单位换算 · `locales/**` i18n · `synthetic/**` 行业模板 · presentation 色/标/icon 映射 · mocks/test。

## 1. 统一根因（一句话）

**平台把「数据层」genericize 了（BASE/SEG_REGISTRY 单源），但「派发层 / 结构层 / 阈值层 / 时间层」仍是电池硬编码** —— 所以「换个租户/行业/场景」还得改 ~15 个文件的代码。`debattery:check` 门查不到这些（它只查业务**常数字面**，查不到 dispatch switch / 视图结构 / 阈值 / mode）。~116 处·5 簇。

## 2. 五簇（confirmed·代理读码 + 审核方复核锚点）

### 簇 Hγ · 派发/路由硬编码（**架构根因**·"换行业就得改码"）——13 处
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

### 簇 Hβ · 视图结构写死（G-5 8a·文档点名·~9视图）——22 处
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
| ε1 | `risk.ts:24,128` | severity阈92/78+加成12 · tension常数62/70/0.6/0.8/40/98 | SolverParam risk.{caseSeverity,tension} | **P1** |
| ε2 | `plan.ts:230` | verdict阈 M.length>=3 翻"可定稿但有重要风险" | SolverParam audit.verdict.medHighCount | **P1** |
| ε3 | `frontend QuarterlyRollingView:128` · `SopBalanceView:343` | LTA偏差阈5%(红) · 毛利容差0.5pp(后端已params前端重写) | ViewConfig/workspace.sopConfig | **P1** |
| ε4 | **`extended.ts` 全13 solver** | **consult NO c.params**·内联全阈值:over/under储1.5/0.8·idle 90·maint间隔26·overdue 30·EU碳70·外协通道1.0/1.4/2.5+40%/20%·urgency 70/30·lock 0.8·quote floor 0.1/band 0.01 | 每solver SolverParam/rule(C08/C11/C15/C16/C28/C32/C33) | P2(整簇) |
| ε5 | `service.ts:821,987` · `fusion.ts:224` · `capex.ts:14,184` | KPI周期系数month/quarter/year 1.0/0.97/1.04 · KSF sev gap>=2 · 融合置信0.95/0.7/0.35 · ramp[0.5,0.75,0.9,1]·surplus 5% | SolverParam | P2 |
| ε6 | frontend `SopBalance:885`·`Dashboard:765`·`RiskBoard:218`·`OrderChain:360` | gap红阈2 · warn带 threshold-15 · 瓶颈`?? 85` | ViewConfig(多数后端已params·前端重写) | P2 |
| ε7 | `capex.ts:13 TAX_RATE 0.25` | 税率(法定但辖区/情景可变) | WorkspaceConfig(debattery-allow已标) | P3 |

### 簇 Hδ · 时间/preset 写死（sim-clock权威但处处重硬编码"当前"）——14 处
| # | file:line | 硬编码 | 应由 | 严重 |
|---|---|---|---|---|
| δ1 | `scenarios-catalog.ts:71` | S11 preset lineId"常州·动力线-A"死对象(真LINE-changzhou) | ontology resolve(已在LAUNCHER-GROUNDED单) | **P1** |
| δ2 | `scenarios-catalog.ts:78` | S18 slotPresets:{}无month→sop NOT_FOUND | clock注入(已在LAUNCHER-GROUNDED单) | **P1** |
| δ3 | `extended.ts:498,545` · catalog S09/S19 · `seed.ts:77` | lta_gap默认month"2026-07"·quarterly_gap"2026Q2"(格式不符YYYY-Qn)·S09/S19 preset硬月/季·demo SOP月"2026-07"(与clock t0 2026-06错位) | sim-clock派生 | P2 |
| δ4 | `QuarterlyRollingView.tsx:30` | 前端硬编码fetchQuarterly("2026-Q3")覆盖后端clock派生 | 省略from让后端派生 | P2 |
| δ5 | `livedin/engine.ts:66` | ~40绝对叙事日期(risk case/规则史/校准提案) | t0偏移(如tick引擎) | P2 |
| δ6 | (P3) `calibration:227` fallback"2026-07-01" · `SopBalanceView:44` newMonth · ProjectSim批次日期 · connectors asOf硬日期 | clock派生 | P3 |

### 簇 Hα · 业务实体内联（应从ontology对象/registry）——20处 + debattery-allow白名单10处/36行
| # | file:line | 硬编码 | 应由 | 严重 |
|---|---|---|---|---|
| α1 | `risk.ts:860` | segOfCust `/商用车/储能/电网/`→com/ess/pas 关键词分类任意客户·非EV租户全塌pas | SEG_REGISTRY关键词/Customer.segment | **P1** |
| α2 | `scenarios-catalog.ts:61-80` | 20场景catalog烤入bases/models/processes/materials/customers/lineId | 租户ontology-authored Scenario对象 | P2 |
| α3 | `livedin/engine.ts:41,66,635` | 客户名单CUSTS · 10行风险越线pinyin baseId表 · S&OP叙事串 | Customer对象/BASE_REGISTRY/事件派生 | P2 |
| α4 | `opsteam/defaults.ts+pools.ts` · `connectors/registry.ts:265` | personas/playbook base视角+modelPool · MOCK_ERP/CRM样本数据(models/pinyin baseId/materials/customers) | 租户对象/行业模板fixture | P2 |
| α5 | `capacity.ts:58` | formation/aging电池工序特例+中文标签化成/老化 | ProcessType ontology metadata | P2 |
| α6 | (P3·~10处) | extended fallback"三元正极"/"涂布" · orchestration-skeleton 4680/电芯 · risk RISK_FACTOR_OBJ/正极串 · comprehend化成/卷绕关键词 · mapping/catalog/simclock/adminplatform/seed 各嵌常州/4680/base_manager:常州 | ontology词表/BASE_REGISTRY[0]/中性占位 | P3 |
| **白名单** | **10 文件/36行 `debattery-allow`** | GeoMap 12基地坐标·ProjectSim DEFAULT_MODELS/物流/地址·SopBalance SOP_KPI_P/段/决议·OrderChain SEG_ORDER/coef·PlanAudit字段·Dashboard 6导航副标·Calibration/Permissions/DataBuilder/Growth 4输入占位 | 多数=fallback可genericize(Base.lon/lat·simConfig·sopConfig·SEG_REGISTRY);占位类=纯UI低价值 | P2/P3 |

## 3. WO 派发（5 grouped·按簇根因治本）
| WO | 覆盖簇 | 根因治本 |
|---|---|---|
| **HARDCODE-DISPATCH-REGISTRY（新·P1·架构根因）** | Hγ | 求解器/扩展solver/industry→template 由 ~7 并行硬编码表 → **registry descriptor 驱动**(solverKey→{fn,shape,dataMode,argDeriv,ruleFieldMap,target,ruleRefs}一处)+IndustryTemplate record 选管线。加门 `dispatch-registry:check`(禁 solverKey switch 增长)。 |
| **HARDCODE-VIEW-LAYOUT（新·P1·8a收口）** | Hβ | 9视图 KPI/列/step/DAG 结构 → ViewConfig.layout 驱动(SandboxView 金标准)。4 P1(SopBalance/OrderChain×2/ProjectSim DAG)先行。 |
| **HARDCODE-SOLVER-PARAMS（新·P1）** | Hε | extended.ts 13 solver + risk/plan 阈值 → SolverParam/rule(C-系列)·前端阈值消费后端权威不重写。加门 `solver-no-inline-threshold:check`。 |
| **HARDCODE-CLOCK-DERIVE（新·P2·并入LAUNCHER-GROUNDED）** | Hδ | 全"当前"月/季/日由 sim-clock 派生·非硬编码;livedin 叙事日期改 t0 偏移。δ1/δ2 已在 LAUNCHER-GROUNDED。 |
| **HARDCODE-BIZ-ENTITY（新·P2）** | Hα | segOfCust(P1)→SEG_REGISTRY·scenario/livedin/connectors/opsteam 电池实体→租户对象/行业模板·白名单逐条 genericize 或登记冻结。 |

## 4. 诚实边界
- Hγ γ10(SCENARIO_CATALOG)/Hα α2 与 LAUNCHER-GROUNDED、INTENT-MATERIALIZE 部分重叠——接地/物化会消化一部分。
- Hε 与假值 sweep(AUDIT-fake-value)在 service.ts:1137(×0.9)、risk auditTimeline 有交集——阈值化 vs 真分位是两个角度,交由 METHOD-MC + 本簇分治。
- debattery:check 基线 0 是"业务常数字面"口径绿;本审计证 dispatch/结构/阈值/时间/mode 层硬编码是门盲区——建议门扩(dispatch-registry/solver-no-inline-threshold/view-layout-config)。
