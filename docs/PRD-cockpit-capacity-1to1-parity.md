# PRD · 经营驾驶舱 + 产能推演 参考原型 1:1 复刻（数据全链闭环）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 |
| 取代/扩展 | 扩展 `PRD-frontend.md` · `PRD-live-traceable-data.md` · `REFERENCE-HTML-INVENTORY.md`（参考原型盘点） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md` · `REFERENCE-HTML-INVENTORY.md` · `PRD-frontend.md` |
| 参考源 | `docs/reference-prototype-decision-platform.html`（5436 行单文件原型，**与本次上传 HTML 字节一致**） |

> 目标：把参考原型的 **「经营驾驶舱」** 与 **「产能推演（预判推演看板 + 型号/订单推演）」** 两个模块 **1:1 复刻**进真系统（当前最完整分支 `wizardly-gauss`，含 vigilant-knuth 同名两视图 + 全套数据管线）。
> **铁律**：所有数字必须经系统数据管线产生（合成 GenSpec → RawDataset → 物化 ObjectInstance → 派生 DerivedProperty / 时序 TsAgg → 求解器 → 声明式 widget 渲染），**前端/后端皆不写死业务数据**（R14 `debattery:check` 基线 0）。每个结论数字带溯源（R13）。

---

## 0. 本体引用与影响（强制）

- **触及对象类型**（§2）：
  - 既有：`Base`(factory)·`Line`·`Equipment`·`Process`·`Order`(product)·`MaintPlan`·`Shipment`·`Model`·`ForecastSnapshot`·`RiskCase`·`Solver(risk_timeline/affected_orders/capacity_forecast/capacity_rollup/bottleneck_matrix)`·`DerivedPropertyDef`·`TsAggSpec`·`SliceSpec`·`ViewConfig.layout(DashboardWidgetDef)`·`ActionType/ActionDraft`。
  - **新增**（绿地，全部经合成管线落库）：`DemandSegment`(forecast 域，S&OP 需求细分 tgt/p50/p90/act)·`SopVersionRow`(plan 域，V1→V7 版本演进)·`MaterialBalance`(material 域，MRP 净需求/长协/缺口)·`FinancePlan`(finance 域，收入/成本/毛利 预算 vs 滚动)·`PlanKpi`(plan 域，月/季/年根因链 KPI)·`RootCauseChain`(decision 域，未达成指标→排除→因素→项目→事件→机制根因)。
- **触及链路**（§3）：
  - `Connector(合成) → RawDataset → ObjectInstance(新6类型) → DerivedProperty → 聚合下推(/objects/aggregate) → DashboardWidget → render`（数据→本体→驾驶舱链）。
  - `Solver(risk_timeline/capacity_forecast/affected_orders) → SOLVER_OUTPUT_SHAPES → renderBindings → AnswerBlock/视图`（推演→渲染链，G-2 形状守护）。
  - `ActionType(预警处置/接单决策) → ActionDraft → approval → 工单写回`（对症方案采纳→工单，R4）。
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

### 3.1 数据层（DataCore 合成管线）— 绿地新增 6 对象类型
均落 `synthetic/battery.ts`（类型/属性/派生/链路 + 生成器）→ `synthetic/service.ts instantiateBattery`（物化）→ `data-categories.ts`（归类 + 覆盖切片自动）→ contracts schema。

1. **`DemandSegment`**（forecast 域）：`{segment(乘用车/储能/商用车), tgt, p50, p90, act, priceWan, marginPct, floorPct}`。来源映射原型 `SOP_SEG/SEG_PRICE/SEG_MARGIN`。派生：`Group.demandP50=SUM(DemandSegment.p50)`、`Group.demandTarget=SUM(tgt)`、`Group.blendedMarginPct=SUM(rev*marginPct)/SUM(rev)`。
2. **`SopVersionRow`**（plan 域）：`{ver(V1..V7), date, demand, supply, note, isFinal}`。驱动 V5/V7 版本切换 + 可供给/缺口 KPI + 回采校准链。
3. **`MaterialBalance`**（material 域）：`{material(三元正极/隔膜/电解液), netDemandTon, ltaPct, gapTon, etaDate}`。驱动齐套预警 KPI + 订单全链齐套判。
4. **`FinancePlan`**（finance 域）：`{line(收入/销售成本/毛利), budget, rolling}`。驱动收入达成 + 毛利率 KPI（与 DemandSegment 交叉验证 R-一致）。
5. **`PlanKpi`**（plan 域）：`{level(month/quarter/year), key, value, target, delta, miss(bool), chainKey}`。驱动规划决策推演 KPI 条。
6. **`RootCauseChain`**（decision 域）：`{level, chainKey, nodes:[{id,kind(result/excluded/factor/project/event/rootcause),label,prov?}], edges:[{from,to,label}], fix, ctaGenerate, ctaAudit}`。驱动根因 DAG（原型 ROOT_CHAINS）+ 问题归因 DAG。

> 现金安全垫 C18 / AOP 2027 基准：复用既有 `FinancePlan` 滚动 13 周现金流派生 + 年度情景对象（`AOP_SCEN` 口径，归 plan 域），不新增类型。

### 3.2 求解器层（DataCore）— 复用 + 1 绿地
- **复用**：`risk_timeline`（看板）、`affected_orders`（受影响订单/问题归并）、`capacity_forecast`（型号六步 P50/P90/what-if）、`capacity_rollup`（产能逐级）、`bottleneck_matrix`（瓶颈）。
- **绿地 `order_fullchain`**：订单全链三关联判——读 `Order×Model×Base×MaterialBalance×FinancePlan`，输出 `{verdict(可接/提价X%接/不建议接), deliveryJudge, kitJudge, financeJudge, dag}`。注册 `SOLVER_KEYS` + `SOLVER_OUTPUT_SHAPES` + `loadContext` + `compute`，过 `chain:check`。
- **绿地 `plan_rootcause`**：按 (level, chainKey) 从 `PlanKpi`+`RootCauseChain` 装配 DAG（确定性，纯装配）。

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
- **新求解器输出 schema**（`contracts/solvers.ts`）：`OrderFullchainOutput`、`PlanRootcauseOutput`、`ProvenanceDagSchema`（共用 DAG 形状）。
- **新事件**：`forecast.snapshot_recorded`（capacity_forecast invoke 后）→ `event-subscriptions.ts` 加订阅，失效 risk/dashboard 预测 widget。
- **新 widget 类型**：`api/types.ts` `DashboardWidgetDef.type` 扩枚举 + 对应 query 形状；后端 `DASH_LAYOUT`（`service.ts:894`）下发。
- 端点全部复用：`POST /a/v1/objects/aggregate`、`GET /a/v1/objects`、`POST /a/v1/solvers/:key/invoke`、`POST /a/v1/timeseries/agg-query`、`GET /a/v1/history/bundle`、`POST /a/v1/actions`。

## 5. 关键流程（端到端，沿链路）

1. **富 KPI（毛利率）**：合成 `DemandSegment`+`FinancePlan` → 派生 `Group.blendedMarginPct=Σ(rev×marginPct)/Σrev` → `objects-aggregate` 下推 → `kpi` widget 渲染 `16.0%` 带 provenance（src=FIN/总账，formula=Σ细分加权，rule=C15）→ 点「追根源」→ `plan_rootcause(month,gm)` → DAG（结构变化 储能37%vs33% → SO-3431/3452 → CRM合同变更 → 机制根因）。
2. **风险看板**：`risk_timeline` 实时 compute（戏剧点经合成注入）→ 卡片/逐日轴/悬停当日 `affected_orders` → 采纳对症方案 → `POST /a/v1/actions`（C06/C11 校验）→ `action.executed` 失效看板。
3. **型号产能推演**：选型号+需求+分批 → `capacity_forecast` 六步（解析/可产网络/驱动因子/聚合/瓶颈/结论）→ `<StepDag>` 逐步点亮 → 落 `ForecastSnapshot` + `forecast.snapshot_recorded`。
4. **订单全链推演**：选订单 → `order_fullchain` 三判 → DAG → 接单结论 → 采纳→Action。

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
- **P4 · 型号/订单推演子视图 + DAG**（capacity_forecast 六步 + order_fullchain）+ **riskCases 真闭环**（历史快照回算）。
- **P5 · 回采校准链 + V5/V7 版本 + AI 对话 + 导出**（收尾）。

---

## 9. 本体引用与影响（机器索引锚，供 prd:check）
触及不变量：R2 R6 R10 R11 R12 R13 R14 · 触及断点：G-5（守护不回潮）+ riskCases 真闭环 · 新事件：forecast.snapshot_recorded · 新对象类型：DemandSegment SopVersionRow MaterialBalance FinancePlan PlanKpi RootCauseChain。
