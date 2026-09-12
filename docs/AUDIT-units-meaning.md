# 审计 · 数字缺单位/缺意义（全应用只读扫描）

> 缘起：用户「系统所有类似的数字，需要配套它的意义，让用户看得懂，不是只是显示一个数字」。
> 方法：5 组视图（产能/风险/推演/驾驶舱/S&OP）× 后端出数源并行只读审计 → 去重排优先级。
> 范式：已修的 #58 杠杆单位（后端 `LEVER_PROP_META` 单源发 `unit`/`valueKind`，前端只格式化·R14 不内联）。

**总览**：34 条发现 → 去重 **26 处**展示面；**~19 处可后端治本单源**，7 处前端纯展示补字；**8 处 HIGH 可见度**。
**范式级根因**：`objectiveValues` / `tightness` / `generic_inference rows` 三处「字段无单位元数据」= 本体 §8 断点 **G-UNIT-NORMALIZE**；后端一次配 unit 字典可连带消掉矩阵/旋钮/杠杆/派生多处，优先于逐视图内联补字。
**避让**：凡触及 `RiskBoardView` / `buildRiskPlanRows` / 处置表 → ⚠ 活推演 dev 领地·暂缓（避冲突）。

---

## 🔴 P0 — 用户已明确困惑
| 项 | 修法 | file:line |
|---|---|---|
| **capacity p50 = 工序日产能（用户问「是天/周/月/年」）** | `computeByProcessModel` p50 下发 `unit:'套/天'`，provenance.formula 同带 | `apps/datacore/src/solvers/capacity.ts:289` |

## 🐞 真 bug（错单位，非缺单位）
| 项 | 修法 | file:line |
|---|---|---|
| 换型标「分」但真口径为**小时**（与 :720 及后端矛盾） | 内联「分」改「小时」；治本由后端下发 changeover `unit:'小时'` | `apps/frontend-shell/src/views/sim/GlobalSimView.tsx:748` |

## 【可治本单源】后端加 unit/valueLabel，前端只格式化

### HIGH
| 项 | 最小修法 | file:line |
|---|---|---|
| 按产品 T+30/60/90 累计产能裸整数 | `outlookByModel` p50At30/60/90 发 `unit:'套'` | `BaseOutlookPanel.tsx:100` |
| 按产品缺口 gap（同页「按基地」已带「套」→ 页内不一致） | `outlookByModel.gap` 发 `unit:'套'` | `BaseOutlookPanel.tsx:104` |
| 7维KPI「在途运费」freight 裸整数 | `GlobalSimKpi.freight` 配 `unit:'元'` | `GlobalSimView.tsx:721` |
| 7维KPI「毛利代理」margin 裸整数 | `GlobalSimKpi.margin` 配 `unit:'元'` | `GlobalSimView.tsx:722` |
| 「总代价」后端 `cost.unit` 已存在但前端未读；被挤/固定单缺「单」 | 前端读现成 `d.cost.unit`；代价单位措辞明确为「惩罚加权分·非货币」避免被当元读 | `GlobalSimView.tsx:709` |
| ⚠ 因素 chip「设备OEE **76**」→ 易被误读成 OEE=76%（误导性最强） | `tightness` 发 `{unit:'紧张度',valueKind:'index',scale:'0–100'}`，chip 显「张力76/100」 | `RiskBoardView.tsx:243` |
| ⚠ 卡片主数字 peak 峰值张力（量纲只藏在 hover） | `risk_timeline` 随 peak/currentTightness 发 unit/scale，主数字旁补「/100」 | `RiskBoardView.tsx:232` |

### MED
| 项 | 最小修法 | file:line |
|---|---|---|
| 派生诊断 DAG 各层张力（0–100 无量程） | tightness 带量程，值旁标「/100」 | `CapacityDerivationDag.tsx:86` |
| 方案对比矩阵 延误量/换型/成品库存/代价 四列裸整数 | `objectiveValues` 配 unit 字典（套·天/小时/套·天/代价单位） | `GlobalSimView.tsx:736` |
| 方法旋钮「按期/换型/代价」无单位 | 复用 `objectiveValues` 单位字典 | `GlobalSimView.tsx:675` |
| 自由杠杆 leverDeltas 7维 before/after（仅 changeoverHours 有单位） | `LeverKpi7` 配 unit 字典 | `GlobalSimLevers.tsx:205` |
| 通用假设推演 before→after 派生字段 | rows 逐行附 `PropertyDef.unit`，前端 fmtVal 后拼 | `WhatIfView.tsx:299` |
| 问题聚合「财务影响」裸数字（口径为亿） | `problems[]` 发 `unit:'亿元'` | `DashboardView.tsx:1122` |
| 反事实「峰值削减」peakCut（同行其余已带单位） | `delta.peakCut` 发 unit/label（「张力点」） | `DashboardView.tsx:901` |
| ⚠ 方案「产能增益」capGain 无单位 | capGain 发 `unit:'套/周'`，前端复用 fmtLeverValue | `RiskBoardView.tsx:892` |
| ⚠ 详情逐因素张力「62→83」 | tightness 带 unit 统一格式化 | `RiskBoardView.tsx:616` |

### LOW
| 项 | 修法 | file:line |
|---|---|---|
| ⚠ 逐日 tooltip「D+5 · 78」 | 拼「D+5 · 紧张度78/100」 | `RiskBoardView.tsx:974` |
| ⚠ 历史回放 y 轴裸刻度 | curve 携 seriesKey→unit，设 yAxis.name | `RiskBoardView.tsx:1203` |

## 【前端纯展示】
| 项 | 可见度 | 修法 | file:line |
|---|---|---|---|
| 长协本季实际到货 actual 裸数字（相邻 planned 已带单位） | HIGH | 补「吨/季」 | `QuarterlyRollingView.tsx:129` |
| S&OP 版本「供给」裸数字（同行 gap 已带「万套」） | MED | 补「万套」 | `DashboardView.tsx:942` |
| 受影响订单「数量」列（易与万套混淆） | LOW | 列头改「数量(套)」 | `DashboardView.tsx:501` |
| ⚠ 历史案例「受影响订单」计数 | LOW | 补「批」 | `RiskBoardView.tsx:1175` |
| ⚠ 处置计划 det 内嵌「峰值83」 | LOW | 补「/100」·**待活推演 dev 落定** | `apps/datacore/src/solvers/risk.ts:449` |

---

**落地顺序**：P0 p50 → 真 bug 换型分/小时 → HIGH 单源批（BaseOutlook + GlobalSim + Quarterly）→ Risk 系列等活推演 dev 落定后打包 → MED/LOW 随后端 unit 字典铺开。
