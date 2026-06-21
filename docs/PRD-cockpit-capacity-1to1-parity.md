# PRD · 经营驾驶舱 + 产能推演 参考原型 1:1 复刻（数据全链闭环）

| 项 | 值 |
|---|---|
| 版本 | v0.2 · 状态 DRAFT · 日期 2026-06-21 |
| 取代/扩展 | 扩展 `PRD-frontend.md` · `PRD-live-traceable-data.md` · `REFERENCE-HTML-INVENTORY.md`（参考原型盘点） · `PRD-fullstack-story-build-g8.md`（数据构建发动机） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md` · `REFERENCE-HTML-INVENTORY.md` · `PRD-frontend.md` · `PRD-fullstack-story-build-g8.md` |
| 参考源 | `docs/reference-prototype-decision-platform.html`（5436 行单文件原型，**与本次上传 HTML 字节一致**） |

> **v0.2 变更**（评审问答沉淀）：① 新增 §3.0 复刻方法论（写死数据三个去处 + 三步法 + ORDERS 端到端样例）；② 新增 §-1 通用前置能力「原型 intake → 数据构建发动机正门」（可分拆独立 PRD）；③ §3.2 澄清「DAG 由求解器装配、`RootCauseChain` 仅存模板、**不做前端/每场景预设 DAG 配置**」；④ 新增绿地求解器 `counterfactual_timeline`（反事实双轨推演：「如不解决 XX，未来 30 天会怎样」do-nothing vs 处置后 双曲线 + 差值）。

> 目标：把参考原型的 **「经营驾驶舱」** 与 **「产能推演（预判推演看板 + 型号/订单推演）」** 两个模块 **1:1 复刻**进真系统（当前最完整分支 `wizardly-gauss`，含 vigilant-knuth 同名两视图 + 全套数据管线）。
> **铁律**：所有数字必须经系统数据管线产生（合成 GenSpec → RawDataset → 物化 ObjectInstance → 派生 DerivedProperty / 时序 TsAgg → 求解器 → 声明式 widget 渲染），**前端/后端皆不写死业务数据**（R14 `debattery:check` 基线 0）。每个结论数字带溯源（R13）。

---

## 0. 本体引用与影响（强制）

- **触及对象类型**（§2）：
  - 既有：`Base`(factory)·`Line`·`Equipment`·`Process`·`Order`(product)·`MaintPlan`·`Shipment`·`Model`·`ForecastSnapshot`·`RiskCase`·`Solver(risk_timeline/affected_orders/capacity_forecast/capacity_rollup/bottleneck_matrix)`·`DerivedPropertyDef`·`TsAggSpec`·`SliceSpec`·`ViewConfig.layout(DashboardWidgetDef)`·`ActionType/ActionDraft`。
  - **新增对象类型**（绿地，全部经合成管线落库）：`DemandSegment`(forecast 域，S&OP 需求细分 tgt/p50/p90/act)·`SopVersionRow`(plan 域，V1→V7 版本演进)·`MaterialBalance`(material 域，MRP 净需求/长协/缺口)·`FinancePlan`(finance 域，收入/成本/毛利 预算 vs 滚动)·`PlanKpi`(plan 域，月/季/年根因链 KPI)·`RootCauseChain`(decision 域，机制根因模板=**对象非前端配置**)。
  - **新增求解器**（绿地）：`order_fullchain`(订单全链三判)·`plan_rootcause`(根因 DAG 装配)·`counterfactual_timeline`(反事实双轨推演)。
  - **§A 通用前置能力**（解耦，可独立 PRD）：`SchemaReconcileCandidate`(intake 字段对账人确认候选)+ 原型 intake 适配器（HTML→InputManifest）。
- **触及链路**（§3）：
  - `Connector(合成) → RawDataset → ObjectInstance(新6类型) → DerivedProperty → 聚合下推(/objects/aggregate) → DashboardWidget → render`（数据→本体→驾驶舱链）。
  - `Solver(risk_timeline/capacity_forecast/affected_orders/counterfactual_timeline) → SOLVER_OUTPUT_SHAPES → renderBindings → AnswerBlock/视图`（推演→渲染链，G-2 形状守护）。
  - `ActionType(预警处置/接单决策) → ActionDraft → approval → 工单写回`（对症方案采纳→工单，R4）。
  - **§A**：`Prototype(HTML) → prototype-intake → InputManifest → comprehend → BuildPlan → closure(R12) → publish(R4 审批) → ObjectInstance`；字段对不上 → `SchemaReconcileCandidate`（HITL 确认门）。
- **触及事件/数据流**（§4，遵守 D-29/R10）：复用 `derivation.completed`·`materialize.completed`·`ts.ingested`·`dataset.regenerated`·`action.executed` 失效 dashboard/risk/scenario-data；**新增** `forecast.snapshot_recorded`（capacity_forecast invoke 落 ForecastSnapshot → 失效 risk/dashboard 预测 widget，IN_SESSION）。
- **触及不变量**（§5）：
  - R2 tenant_id：新 6 类型全仓储双实现带 tenantId。
  - R6 确定性：新生成器用 `mulberry32(seed^hash)` 子流，同 (industry,scale,seed) 字节一致；六步推演/风险曲线纯函数同输入同输出。
  - R10 D-29：新指标产出发事件、驾驶舱/风险页订阅失效。
  - R11 全链闭包：新求解器/计划过 `chain:check`；SHAPE 维补 `SOLVER_OUTPUT_SHAPES`。
  - R12 双向闭包：新对象落覆盖切片（反向-对象 HARD），新字段被 widget/solver 消费（反向-data）。
  - R13 结论可溯源：每 KPI/推演数字带 `provenance`（src/fresh/formula/inputs/rule/note），来自 lineage + 派生公式。
  - **R14 应用层无业务常数**：所有 KPI 名/阈值/分段/文案来自 `ViewConfig.layout` + 派生定义 + i18n，前端零内联；过 `debattery:check`。
- **关闭/影响的已知断点**（§8）：
  - **G-5**（应用层电池锁死）：驾驶舱/风险页继续走声明式 layout + 配置驱动，不回潮。
  - **唯一“不真”接缝补齐**：`riskCases` 当前为 `livedin/engine.ts CASE_SPECS` 种子骨架（非求解器实时算）→ 本 PRD P4 让历史案例由 `risk_timeline` 在历史快照上回算（真闭环）。
- **需走的检测门禁**（§7）：闭包门（新对象覆盖切片）· `chain:check`（场景↔求解器）· `ontology:check`（漂移）· `debattery:check`（无内联业务常数）· VLE 七段（新派生：聚合==明细差分）· `field-coverage`（新类型 100%）。
- **回写承诺**：落地后回写本体 §2（新增 6 对象类型）· §3（数据→驾驶舱链、推演→渲染链补全）· §4（新增 `forecast.snapshot_recorded` 事件）· §8（riskCases 真闭环更新 G 表）。

---

## A. 通用前置能力：原型 intake → 数据构建发动机正门（§-1 · 可分拆为独立 PRD）

> 适用范围超出本两模块：**未来任何「上传一个 HTML/原型 → 复刻功能与数据」的需求**都应走这条正门，而非每次派 agent 手抠。复用既有数据构建发动机（本体 §8 G-8：`databuilder/service.ts` comprehend→BuildPlan→closure→publish + GapReport 七码 + R4 Action 审批 HITL）。

**现有可复用（已具备）**：
- `StoryScript --comprehend(LLM)--> BuildPlan{dataSources,objectTypes,rules,solverNeeds,kbDocs}`（倒推全栈）。
- `validateClosure → ClosureReport`（R12 双向闭包：反向-对象 HARD / 反向-data SOFT / 正向 HARD）+ `field-coverage` 门。
- `GapReport` 七码（`SHAPE_MISMATCH`/`NO_SLICE`/`EMPTY_DATA`/`NO_CAPABILITY`…）把"对不上"结构化。
- `InputManifest`（伴生契约，倒推补录表单）+ `runStory` 确定性生成一次（R6）+ R4 Action 审批落真值（DataBuilderPage 页内 HITL）。

**真缺口（要补的两块绿地，可独立成 `PRD-prototype-intake-databuilder.md`）**：
1. **`prototype-intake.ts`（HTML→InputManifest 抽离正门）**：解析 HTML 内嵌的 `const xxx=[...]` 数据表（如 `ORDERS/BASE_DATA/SOP_SEG`）+ 关系（`L(source,target,rel)` 边、`MODEL_DEF.bases` 映射）→ 写成 `InputManifest.dataSources`（数据）+ 链路边（关系）→ 喂 comprehend。**数据与关系都抽离、只生成一次。**（未来可扩 Figma/Excel 同一正门。）
2. **`schema-reconcile.ts`（字段对账 → 人确认门，类比实体解析 MergeCandidate）**：HTML 列 ↔ 既有 `ObjectType` 字段做归一对账——
   - 列名/类型/单位**能映射** → 自动接到既有字段；
   - **映射不上**（新字段/新类型/单位冲突）→ 生成 **`SchemaReconcileCandidate`**（新对象类型）→ DataBuilderPage 弹给人确认（沿用 / 改名 / 新建 / 丢弃）。**= 你要的"与现有字段不同则提示人确认"。**

**新增本体回写（落地后）**：§2 加 `SchemaReconcileCandidate`；§3 加 `Prototype→InputManifest→BuildPlan` 链路；§8 把"原型 intake 无自动正门"登记为新断点并标闭合。

> 边界：本能力是**通用前置基建**，与本 PRD 两模块的复刻**解耦**——本 PRD 的 6 个对象类型即便先手工经 `generateBattery` 落库也成立；intake 正门让"下一个 HTML"自动化。建议作为独立 PRD 并行推进。

---

## 1. 目标 / 非目标

### 目标
1. **经营驾驶舱**与参考原型 1:1：8 富 KPI、待解决的问题归并、订单经营台账+逐单根因 DAG、规划决策推演（月/季/年根因链 + DAG + 一键去建议/体检）、回采校准链、模块直达、AI 对话、导出、V5/V7 版本切换。
2. **产能推演**与参考原型 1:1：预判风险看板（逐日圆点轴 + 悬停当日详情 + 三档图例 + 受影响订单 + 处置最终方案表 + 对症方案库→工单）、**型号产能推演**（六步透明推演 + 配套 DAG 逐步点亮）、**订单全链推演**（三关联判 + DAG）。
3. **数据全链闭环**：上述每个数字均经管线产生，可溯源（R13），换 seed 字节一致（R6），无前端/后端写死业务数据（R14）。

### 非目标
- 不照搬原型的单文件结构 / 手写力导向图引擎 / 写死 PROV 字典（用活 lineage）。
- 不复刻原型 19 个 view 的其余 17 个（业务建模全景/S&OP 五步/年度情景台等已有或另行）——本 PRD 仅这两模块。
- 不改 AgentCore LLM 适配器（与本任务无关，且有 2 个先存失败用例）。

---

## 2. 现状与缺口（对照代码 file:line）

### 2.1 经营驾驶舱（`DashboardView.tsx` 已是声明式 widget 执行器）
| 能力 | 现状 | 缺口 |
|---|---|---|
| KPI | 4 个：`gwh`/`util`/`attain`/`orders`（`synthetic/service.ts:894` DASH_LAYOUT） | 缺 8 富 KPI：需求P50/可供给(V5/V7)/收入达成/毛利率/利用率瓶颈/齐套预警/现金垫C18/AOP基准 |
| 趋势/表 | OEE 14 日趋势 + 订单表 | — |
| 待解决的问题 | 无（`affected_orders.problems[]` 已产 4 类归并，`solvers/risk.ts:439` 未上驾驶舱） | 问题卡网格 + 归因 DAG |
| 订单经营台账 | 仅基础订单表 | 逐单根因 DAG + 状态筛选 + 综合毛利率聚合 |
| 规划决策推演 | 无 | 月/季/年 KPI 条 + 根因链 DAG（ROOT_CHAINS）+ 一键去建议/体检 |
| 回采校准链 | 无 | 实际→月→季→年 反馈链可视化 |
| 版本 V5/V7 | 无 | S&OP 版本态切换（影响 可供给/缺口/版本 chip） |
| AI 对话 / 导出 | 部分页有 | 驾驶舱预设 QA + 导出报告 |

### 2.2 产能推演（`RiskBoardView.tsx` + `risk_timeline` 求解器已高度对齐）
| 能力 | 现状 | 缺口 |
|---|---|---|
| 风险曲线引擎 | `risk_timeline`（`solvers/risk.ts:185`）：基线斜坡+事件脉冲、越线日、峰值、≤8 卡 | ✅ 引擎已对齐；参数 `BATTERY_SOLVER_PARAMS.risk` |
| 逐日轴/悬停/图例 | MiniStrip + Modal heat strip | 补：完整日期刻度轴、悬停当日详情（事件+受影响订单）、三档图例文案、首要风险对象标注 |
| 受影响订单 | `affected_orders`（`risk.ts:275`）窗口[day-7,day+14] | ✅ 已有；上看板弹窗 |
| 处置最终方案表 | 无 | 按越线日前置 7 天排程 + peak≥90 备份 + cross≤14 反提差异(C21) |
| 对症方案库 | `BATTERY_SOLVER_PARAMS.risk.mitigations` 已有 | 上 UI「采纳→工单」Action |
| 型号产能推演（六步+DAG） | `capacity_forecast`（`capacity.ts:179`）P50/P90/爬坡/检修/what-if 已有 | 六步透明推演 UI + 逐步点亮 DAG + 分批/交付地址净窗口 |
| 订单全链推演（三判+DAG） | `affected_orders` + `capacity_forecast` 可拼 | 三关联判（交期/齐套/财务）+ 推演 DAG + 接单结论 |

### 2.3 唯一“非真闭环”接缝
`riskCases`（历史处置案例）来自 `livedin/engine.ts:62 CASE_SPECS` 种子骨架 + `bundle.ts:223` 固定系数放大，**非求解器实时算** → P4 改为 `risk_timeline` 历史快照回算。

---

## 3. 设计（复用现有接缝优先 · 标注 复用/绿地/门禁）

### 3.0 复刻方法论：写死数据的「三个去处」+ 三步法（通用判定法则）

原型把"输入数据 + 业务参数 + 推导结论"**混在一起写死在前端 JS**。复刻的本质是**拆解归位**，让数字"长出来"而非"抄进去"。对原型里**任意一个数字**，按下表判性质、归位：

| 原型写死的东西 | 系统里的去处 | 谁产生它 | 锚点 |
|---|---|---|---|
| **① 原始输入数据**（24 订单、12 基地台账、S&OP 三线、物料缺口…） | 合成生成器（确定性种子）→ RawDataset → 物化 ObjectInstance（`origin` 记 rawDatasetId+rowIdx，活数据可溯） | `synthetic/battery.ts generateBattery` → `service.ts:519 putAll` | — |
| **② 业务参数/阈值**（分段单价、毛利线、越线阈值 85、脉冲幅度…） | 对象属性 或 求解器参数（按租户版本化、校准可改，**不写死在求解器**） | 对象 props / `BATTERY_SOLVER_PARAMS`（`battery.ts:50`） | — |
| **③ 推导结论**（毛利率 16.0%、产销缺口、越线日 T+n、P90…） | **不存**，由派生公式 / 时序聚合 / 求解器**实时算** | DerivedPropertyDef（`ontology.ts:628 runDerivations`）/ TsAggSpec / Solver | — |

**三步法**（对每个数字）：①**判性质**（①/②/③）→ ②**归位**（进生成器 / 进参数 / 由派生求解算）→ ③**声明式上屏**（后端 `DASH_LAYOUT`/求解器输出形状声明数据源，前端 widget 按声明渲染 + `<Provenance>` 溯源，**前端不碰具体数值**）。

**端到端样例 · ORDERS（①原始数据）**：
```
原型: const ORDERS=[{so:"SO-3391",cust:"整车厂A",model:"4680-NCM",qty:8,due:"2026-06-24"}, …24]
系统: generateBattery(seed) 产 Order 行（mulberry32(seed^hash) 子流，R6 字节一致，替代原型 hashN 伪随机）
      → putAll("Order",rows,"so") 先落 RawDataset 再物化 ObjectInstance（origin 可溯）
      → GET /a/v1/objects?type=Order&columns=so,cust,model,qty,due,status
      → order-ledger widget 渲染（前端零写死）
```
**端到端样例 · 毛利率 16.0%（③推导结论，绝不写死）**：合成 `DemandSegment`(p50/priceWan/marginPct) → 派生 `Group.blendedMarginPct = Σ(rev×marginPct)/Σrev`（topo 序求值回写）→ `objects-aggregate` 下推 → kpi widget 显示 + provenance{src=FIN/总账, formula=Σ细分加权, rule=C15}。换 seed / 改一张储能订单 → **自动重算**。
**端到端样例 · 风险曲线（③，连存都不存）**：`risk_timeline` 每次请求从对象库实时 compute（曲线不落库，R6）；驱动形状的"戏剧点"（`MaintPlan.week`/`Order.due`/`Shipment.status=DELAYED`）是①原始对象、合成期注入。

> 一句话：**写死=抄结论；把结论挪进配置=换地方抄结论；让结论从本体关系算出来=数据闭环**。本 PRD 一切数字走第三种。

### 3.1 数据层（DataCore 合成管线）— 绿地新增 6 对象类型
均落 `synthetic/battery.ts`（类型/属性/派生/链路 + 生成器）→ `synthetic/service.ts instantiateBattery`（物化）→ `data-categories.ts`（归类 + 覆盖切片自动）→ contracts schema。

1. **`DemandSegment`**（forecast 域）：`{segment(乘用车/储能/商用车), tgt, p50, p90, act, priceWan, marginPct, floorPct}`。来源映射原型 `SOP_SEG/SEG_PRICE/SEG_MARGIN`。派生：`Group.demandP50=SUM(DemandSegment.p50)`、`Group.demandTarget=SUM(tgt)`、`Group.blendedMarginPct=SUM(rev*marginPct)/SUM(rev)`。
2. **`SopVersionRow`**（plan 域）：`{ver(V1..V7), date, demand, supply, note, isFinal}`。驱动 V5/V7 版本切换 + 可供给/缺口 KPI + 回采校准链。
3. **`MaterialBalance`**（material 域）：`{material(三元正极/隔膜/电解液), netDemandTon, ltaPct, gapTon, etaDate}`。驱动齐套预警 KPI + 订单全链齐套判。
4. **`FinancePlan`**（finance 域）：`{line(收入/销售成本/毛利), budget, rolling}`。驱动收入达成 + 毛利率 KPI（与 DemandSegment 交叉验证 R-一致）。
5. **`PlanKpi`**（plan 域）：`{level(month/quarter/year), key, value, target, delta, miss(bool), chainKey}`。驱动规划决策推演 KPI 条。
6. **`RootCauseChain`**（decision 域）：`{level, chainKey, nodes:[{id,kind(result/excluded/factor/project/event/rootcause),label,prov?}], edges:[{from,to,label}], fix, ctaGenerate, ctaAudit}`。驱动根因 DAG（原型 ROOT_CHAINS）+ 问题归因 DAG。

> 现金安全垫 C18 / AOP 2027 基准：复用既有 `FinancePlan` 滚动 13 周现金流派生 + 年度情景对象（`AOP_SCEN` 口径，归 plan 域），不新增类型。

### 3.2 求解器层（DataCore）— 复用 + 3 绿地
- **复用**：`risk_timeline`（看板）、`affected_orders`（受影响订单/问题归并）、`capacity_forecast`（型号六步 P50/P90/what-if）、`capacity_rollup`（产能逐级）、`bottleneck_matrix`（瓶颈）、`generic_inference`（反事实 dryRun 重算）。
- **绿地 `order_fullchain`**：订单全链三关联判——读 `Order×Model×Base×MaterialBalance×FinancePlan`，输出 `{verdict(可接/提价X%接/不建议接), deliveryJudge, kitJudge, financeJudge, dag}`。注册 `SOLVER_KEYS` + `SOLVER_OUTPUT_SHAPES` + `loadContext` + `compute`，过 `chain:check`。
- **绿地 `plan_rootcause`**：按 (level, chainKey) 从 `PlanKpi`+`RootCauseChain` 装配 DAG（确定性，纯装配）。
- **绿地 `counterfactual_timeline`（反事实双轨推演）**：回答「**如不解决 XX 问题，未来 30 天会怎样**」。入参 `{problemRef(取自 affected_orders.problems / GapReport), horizon(默认30), mitigationKey?}`；输出 `{baselineSeries(do-nothing 自然演化), mitigatedSeries(处置后), delta:{peakCut(峰值削减), crossDelayDays(越线日推迟), ordersSaved(少受影响订单)}, events[]}`。**编排既有积木**：baseline 走 `risk_timeline`（do-nothing 前向曲线），mitigated 走 `capacity_forecast` what-if / `generic_inference` apply（处置后曲线），两条并排 + 差值。底层时序能力已具备（见 §3.5），本求解器只补"双轨对比"编排，**不引入新时序基建**。

> **§3.2 设计红线（DAG 不做"预设配置"）**：逐单根因 DAG / 规划根因 DAG 的**结构**（哪单→哪判定→哪项目→哪机制根因）一律由求解器**沿本体关系多跳算出来**（`affected_orders.problems` 的 4 层链 `risk.ts:439` + `margin_attribution`/`concentration_risk` 同类图遍历），**严禁做成"每场景一份预设 DAG 配置模块"**（那等于把节点/边当业务常数写死，违反 R14、丢溯源）。可配置的**仅是模板内容**（机制根因文字 / 对策 / 引用哪条规则）——存为一等对象 `RootCauseChain`（经管线落库、带 provenance），由 `plan_rootcause` 按 (level,chainKey) 装配进真实对象，不是前端 config。**结构=算；模板=配（成对象）**。

### 3.5 时序能力现状核对（"未来 30 天会怎样" 不缺底层，只缺编排）
本体 §2-F 时序/运营域已具备，**无需新增时序数据库**：
- **时序存储**：`ObjectPropHistory`（属性时序历史）+ `TsAggSpec/TsAggRun`（时序聚合，`timeseries.ts`）—— 建在通用仓储（pg/memory 双实现）上，功能等价时序库；当前规模够用，仅未来 IoT 秒级海量高频才需挂专用 TSDB（非当前瓶颈）。
- **模拟时钟**：`SimulationClock/ClockTickReport`（A8 tick）+ LivedInState 回放（T−365→T0）。
- **前向推演**：`risk_timeline`（30/60/90 天逐日）+ `capacity_forecast`（周级 P50/P90 + what-if）+ `generic_inference`（反事实 dryRun）。
- **越用越准**：M11 校准引擎（误差=|预测−实际|→反向调参）。
- **唯一补点**：把 do-nothing 与 mitigated 拼成双轨对比（= 上面的 `counterfactual_timeline`，编排层，非底层缺失）。

### 3.3 渲染层（前端）— 扩声明式 widget，零业务常数
- 扩 `DashboardWidgetDef`（`api/types.ts:100`）：新增 widget `type`：`problem-cards`（问题归并）、`order-ledger`（台账+逐单 DAG）、`plan-drill`（规划决策推演）、`feedback-chain`（回采校准）、`module-links`（模块直达）、`version-toggle`（V5/V7）。每个 widget 仍由后端 `DASH_LAYOUT` 下发 + query 声明数据源。新增 `WidgetQueryDef.kind`：`solver`（已有，用于 problem/order-chain）、`objects-aggregate`（已有，富 KPI）。
- 扩 `RiskBoardView.tsx`：补 逐日刻度轴、悬停当日详情、三档图例、处置方案表（读 `risk_timeline` + mitigations）、对症方案采纳→`POST /a/v1/actions`；新增 **型号产能推演** 子视图（`capacity_forecast` 六步 + DAG 组件 `<StepDag>`）与 **订单全链推演** 子视图（`order_fullchain` + `<OrderDag>`）。
- **DAG 组件**：通用 `<ProvenanceDag>`（层 result/excluded/factor/project/event/rootcause，节点带 provenance 悬浮，边带 label），数据来自求解器输出，零写死。
- **溯源**：每数字包 `<Provenance>`（已有组件），def 来自派生公式 + lineage 端点。

### 3.4 门禁新增/触及
- `chain:check`：注册 `order_fullchain`/`plan_rootcause` 输出形状。
- 覆盖切片：6 新类型经 `batteryCoverageSlices()` 自动全字段覆盖（验 `field-coverage` 100%）。
- `debattery:check`：新 widget/视图零内联业务常数（基线 0 不超）。
- VLE：新派生（demandP50/blendedMargin 等）满足「聚合==明细差分」。

---

## 4. 契约 / 端点 / 数据模型（双仓储四处同改）

- **新对象类型**：仅经合成物化为 `ObjectInstance`（复用 objects/links 仓储，**不新建表**，R9 免新表），类型/属性/派生定义在 `battery.ts`，契约形状在 `packages/contracts/src/solvers.ts`（求解器输出）+ 既有 `ObjectsPage/AggregateResult`。
- **新求解器输出 schema**（`contracts/solvers.ts`）：`OrderFullchainOutput`、`PlanRootcauseOutput`、`CounterfactualTimelineOutput`（baseline/mitigated 双序列 + delta）、`ProvenanceDagSchema`（共用 DAG 形状）。
- **新事件**：`forecast.snapshot_recorded`（capacity_forecast invoke 后）→ `event-subscriptions.ts` 加订阅，失效 risk/dashboard 预测 widget。
- **新 widget 类型**：`api/types.ts` `DashboardWidgetDef.type` 扩枚举 + 对应 query 形状；后端 `DASH_LAYOUT`（`service.ts:894`）下发。
- 端点全部复用：`POST /a/v1/objects/aggregate`、`GET /a/v1/objects`、`POST /a/v1/solvers/:key/invoke`、`POST /a/v1/timeseries/agg-query`、`GET /a/v1/history/bundle`、`POST /a/v1/actions`。

## 5. 关键流程（端到端，沿链路）

1. **富 KPI（毛利率）**：合成 `DemandSegment`+`FinancePlan` → 派生 `Group.blendedMarginPct=Σ(rev×marginPct)/Σrev` → `objects-aggregate` 下推 → `kpi` widget 渲染 `16.0%` 带 provenance（src=FIN/总账，formula=Σ细分加权，rule=C15）→ 点「追根源」→ `plan_rootcause(month,gm)` → DAG（结构变化 储能37%vs33% → SO-3431/3452 → CRM合同变更 → 机制根因）。
2. **风险看板**：`risk_timeline` 实时 compute（戏剧点经合成注入）→ 卡片/逐日轴/悬停当日 `affected_orders` → 采纳对症方案 → `POST /a/v1/actions`（C06/C11 校验）→ `action.executed` 失效看板。
3. **型号产能推演**：选型号+需求+分批 → `capacity_forecast` 六步（解析/可产网络/驱动因子/聚合/瓶颈/结论）→ `<StepDag>` 逐步点亮 → 落 `ForecastSnapshot` + `forecast.snapshot_recorded`。
4. **订单全链推演**：选订单 → `order_fullchain` 三判 → DAG → 接单结论 → 采纳→Action。
5. **反事实双轨（如不解决 XX 未来 30 天）**：问题(`affected_orders.problems`/GapReport) → `counterfactual_timeline` → baseline(do-nothing `risk_timeline`) ‖ mitigated(`capacity_forecast` what-if) → 双曲线 + delta(峰值削减/越线日推迟/少受影响订单) → 渲染对比图（每点 provenance）。

## 6. 非功能与约定（§5 不变量逐条）
- R2/R6/R10/R11/R12/R13/R14 见 §0。LLM 一律 mock；测试不依赖网络/时钟。

## 7. 验收（DoD）
- `pnpm -r build && pnpm -r test` 全绿（datacore/contracts/frontend；agentcore 维持先存 2 失败基线不恶化）。
- `pnpm chain:check` / `ontology:check` / `debattery:check` / `field-coverage`（6 新类型 100%）全过。
- **Parity 清单**：逐条对照原型截图/字段（§2 缺口表）勾验；FDE 验收纪律：亲手跑一遍前端（mock + 真后端）确认每数字可溯、换 seed 一致。
- 回写 `SYSTEM-ONTOLOGY.md` §2/§3/§4/§8。

## 8. 分期
- **P1 · 驾驶舱富 KPI + 订单台账 + 问题归并**（最高可见 parity，复用 affected_orders.problems + 新 DemandSegment/FinancePlan/MaterialBalance 派生）。
- **P2 · 规划决策推演 + 根因 DAG**（PlanKpi/RootCauseChain + plan_rootcause + `<ProvenanceDag>`）。
- **P3 · 风险看板补全 + 对症方案→工单 + 处置方案表**（扩 RiskBoardView，复用 risk_timeline）。
- **P4 · 型号/订单推演子视图 + DAG**（capacity_forecast 六步 + order_fullchain）+ **反事实双轨 `counterfactual_timeline`**（如不解决 XX 未来 30 天）+ **riskCases 真闭环**（历史快照回算）。
- **P5 · 回采校准链 + V5/V7 版本 + AI 对话 + 导出**（收尾）。
- **P0（并行/解耦，可独立 PRD）· §A 原型 intake 正门 + schema 对账 HITL**：让"下一个 HTML"自动抽数据/关系入数据构建发动机、字段不符弹人确认。**不阻塞 P1–P5**。

---

## 9. 本体引用与影响（机器索引锚，供 prd:check）
触及不变量：R2 R6 R10 R11 R12 R13 R14 · 触及断点：G-5（守护不回潮）+ G-8（intake 正门补全）+ riskCases 真闭环 · 新事件：forecast.snapshot_recorded · 新对象类型：DemandSegment SopVersionRow MaterialBalance FinancePlan PlanKpi RootCauseChain SchemaReconcileCandidate(§A) · 新求解器：order_fullchain plan_rootcause counterfactual_timeline。
