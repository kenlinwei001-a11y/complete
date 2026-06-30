# 设计 · 锂电 CEO 10 问的全链数据接线（源→导入→处理→流转→求解器→约束→规则）

> 用户：这 10 问需要哪些源数据、从哪个模块导入、哪个模块怎么处理、流转到哪、需要哪些求解器、约束、规则配套？
> 按系统本体「沿链路走」逐问拆**接线单**。所有"来源系统/对象类型/求解器/规则码"均**钉到真实系统**（`graphmeta.TYPE_SOURCE_SYSTEM` + 连接器注册表 + 46 求解器 + C01–C26 规则）。标 ✅已在 / ◐部分 / 🔴缺真接入。

## §0 标准数据流骨架（所有问题共用）

```
真实来源系统(9)          A1 连接器        A3 半自动建模      A4 本体对象库          求解器(A4)        A5 规则DSL
─────────────         ──────────       ────────────      ──────────────        ──────────       ──────────
ERP/MES/SCADA/SRM  →  连接器导入(sync)→ 字段映射→对象类型 → 对象+链+派生         → invokeSolver  → C-code 裁决 → 答案
PLM/WMS/QMS/LIMS      (CDC delta-merge   (A3 dataset       (A8 时序: util/oee/    (loadContext     (evaluate_rules)  ↑
+ EXTERNAL 信号        WO-PIPE-INCR①②)   →entityType)      良率/锂价 入 ts_point)  注入对象+时序)                    A6 行级权限过滤
```
- **导入**=A1 连接器（`/a/v1/connections/:id/sync`·CDC 增量·WO-PIPE-INCR①②✅）。
- **处理**=A3 建模（源字段→对象类型·`TYPE_SOURCE_SYSTEM` 归因）+ A8 时序（OEE/util/良率/锂价等随时间的量入 `ts_point`/`ts_agg`）+ A4 派生（`runDerivations`）。
- **流转**=A4 本体对象库 → 求解器 `loadContext` 注入（对象+时序+规则参数）。
- **求解**=46 求解器之一/组合 → 输出带 `dataMode` 诚实位。
- **规则**=A5 规则 DSL（C-code）`evaluate_rules` 裁决。
- **权限**=A6 行级过滤贯穿（CEO 看全域·基地经理看本基地）。

## §1 逐问接线单

| # | 源数据 @ 来源系统 | 导入(A1连接器) | 处理(A3建模/A8时序) | 求解器(A4) | 约束/规则(A5) | 缺口 |
|---|---|---|---|---|---|---|
| **Q1 交付守不守** | Order交期@**ERP** · Base/Line/Process产能@**MES** · Equipment OEE@**SCADA** · MaterialBalance齐套@**WMS** · Shipment在途@**SRM** | erp/mes/scada/wms/srm | A8 时序(util/oee/良率) → A4 派生齐套缺口 | `order_fullchain`(三闸) + `affected_orders` | C02/C03 交期 · C06/C16 齐套 | 🔴 **N1**(现单合成源·真 ERP/MES/SRM 各执一词的融合未通) |
| **Q2 锂价传导毛利** | **锂价@EXTERNAL**(`li_carbonate_price`✅连接器) · BOM用量@**PLM**(Model/Material) · 订单价@**ERP** · 毛利底线 DemandSegment.floorPct@**ERP** | external信号 + erp/plm | A8 时序(锂价曲线) → 成本传导派生 | `quote_margin`/`finance_pnl`/`margin_attribution` | C15 毛利底线 | ◐ 逐单成本传导(锂价源✅·传导链部分) |
| **Q3 产能倾斜(动力/储能)** | Order@ERP · 毛利 FinancePlan@ERP · 回款 ARInvoice@ERP · 需求 DemandSegment/SopVersionRow@ERP · 产能 Base@MES | erp/mes | A8 时序(需求/产能) → 派生 | `capacity_forecast`/`finance_pnl`/`plan_generate` | C03 产能 · C15 毛利 · C21 细分 · C18 现金 | 📐 四维权衡接地(SCENE+E2) |
| **Q4 接不接大单** | 新单+现有 Order@ERP · 产能 Base@MES · 齐套 MaterialBalance@WMS · 毛利 DemandSegment@ERP · 可产网络 Model.bases@PLM | erp/mes/wms/plm | A4 派生 + 拆单分配 | `order_fullchain`+`capacity_forecast`+`assignment_optimize`(拆单) | C02/C03 交期 · C06 齐套 · C15 毛利 | 📐 **E2**(挤掉谁=行动后果模拟) |
| **Q5 卡脖子料预警** | MaterialBalance缺口@WMS · PurchaseOrder/Shipment lead-time@SRM · 排产计划 | wms/srm | A8 时序(库存消耗) → 缺口趋势 | `kit_readiness`/`lta_gap` | C06 齐套 · C16 安全库存/在途覆盖 | 🔴 **N2**前瞻预警 + lead-time 真 SRM 源 |
| **Q6 基地良率波及** | 良率 LabTest@**LIMS**/Process@MES · Order@ERP · 多基地 Base@MES | lims/mes/erp | A8 时序(良率曲线·异常) → 派生 | `yield_diagnosis`+`affected_orders`+`assignment_optimize`(挪) | C06/C16 齐套 | 📐 **E2**(挪后两边重算对比) |
| **Q7 现金 vs 扩产** | 回款 ARInvoice@ERP · 采购 PurchaseOrder@SRM · CapexProject@ERP · 现金底线 FinancePlan@ERP | erp/srm | A8 时序(现金流入/流出叠加) | `capex_scenario`+`plan_audit`(现金闸) | C18 现金垫 · C13 信用/账期 | ◐ 跨源前瞻现金流(N1+E·现金流时序叠加) |
| **Q8 客户砍单消化** | Order变更@ERP · 已备 MaterialBalance@WMS · 其他客户需求 DemandSegment@ERP · 财务 | erp/wms | A4 派生(反向再配置) | `inventory_optimize`+`assignment_optimize`(转单) | C16 安全库存 · C28 | 📐 **E2**(砍单情景注入) |
| **Q9 多基地负载不均** | util Base@MES · 可产网络 Model.bases@PLM · Order@ERP · 物流成本 | mes/plm/erp | A8 时序(util) → 再分配派生 | `assignment_optimize`+`risk_timeline`(重算) | C02/C03 交期/产能 | 📐 **E2**(一键挪后对比基线) |
| **Q10 目标差距归因** | 全域 KPI: FinancePlan@ERP+Order@ERP+Base@MES · 目标 PlanTarget@ERP | erp/mes | A4 派生(KSF 关键成功要素) | `plan_audit`/`plan_rootcause`(KSF DAG)+`metric_rollup` | C15/C18/C21/C23 全族 | 📐 **E2**(杠杆并排择优) |

## §2 共性（接线看下来的规律）

1. **9 个真实来源系统都要真连接器**——ERP(Order/财务/计划)、MES(基地/产线/工序)、SCADA(设备遥测)、SRM(在途/采购)、PLM(型号/认证)、WMS(库存/物料)、LIMS(检测)、QMS(质量)、EXTERNAL(锂价/电价/EV需求)。**现 demo 全经单一合成连接器物化**（诚实标·WO-7 已坐实归因），真接入是上游。
2. **外部市场信号连接器已在**（`li_carbonate_price`/`nickel_price`/`industrial_power_price`/`usd_cny`/`ev_demand_index`/`ess_subsidy_signal`）——Q2 锂价、Q7 电价/汇率这类**真外部源已有连接器框架**✅。
3. **A8 时序是隐形骨架**——Q1 良率/util、Q2 锂价、Q5 库存消耗、Q7 现金流、Q9 util 都靠 A8 时序（`ts_point`/`ts_agg` + 模拟时钟）支撑"随时间变"——这也是 M11 校准 observed 的来源（E1 闭环）。
4. **规则高度复用**——C02/C03(交期产能)、C06/C16(齐套)、C13(信用)、C15(毛利)、C18(现金)、C21(细分)反复出现——**规则是配置驱动一等引用**（但 G-10：现规则被引用非一等可编辑·改规则即重算待补）。

## §3 缺口（接线断在哪·与前述一致但更具体）

| 缺口 | 接线断点 | 命中问 | WO |
|---|---|---|---|
| 🔴 **真多源接入 + 融合(N1)** | A1 现单合成源·真 ERP/MES/SRM 各执一词未融 | Q1·Q5·Q7 | 真连接器接入(上游) + **WO-MULTISRC-FUSION**(仲裁/测谎) |
| 📐 **E2 行动后果模拟** | 求解器算单点·"这动作的连锁后果"未沙盘化 | Q4·Q6·Q8·Q9·Q10 | **WO-E2** |
| 🔴 **N2 前瞻预警** | risk_timeline 阈值触发·趋势前瞻缺 | Q5 | **WO-LEADING-INDICATOR** |
| ◐ **A8 时序真接入** | 时序现合成·真 SCADA/MES 流未接 | Q1·Q2·Q5·Q7·Q9 | 真时序源接入(上游·E1 校准依赖) |
| ◐ **规则一等可编辑(G-10)** | 改规则即重算的 what-if | Q10·Q3 | 规则库增量 |

## §4 一句话
**这 10 问的接线，"求解器(算)+规则(裁)+A8时序(骨架)" 本系统都备齐了；断点集中在三处：① A1 真多源接入(现合成单源)+融合(N1) · ② E2 行动后果模拟 · ③ A8 真时序流接入。** 把这三处接通，CEO 这 10 问就从"求解器各算一块"变成"源数据真融→一个可执行决策"。**锂价/电价等外部源连接器已在（Q2/Q7 半通），最该补的是 ERP/MES/SRM 的"同一事实多源融合"(N1)。**

## 本体引用与影响
- **链路**：`数据(9源)→A1连接器→A3建模→A4本体(+A8时序)→loadContext→求解器→A5规则→答案`（A6 权限贯穿）——10 问各取其段。
- **对象类型**：Order/Base/Line/Process/Equipment/MaterialBalance/Shipment/PurchaseOrder/Model/DemandSegment/SopVersionRow/FinancePlan/ARInvoice/CapexProject/LabTest（`TYPE_SOURCE_SYSTEM` 真归因）。
- **不变量**：R6(确定性)·R13(诚实位/dataMode)·R4(行动审批)·R14(连接器 category 自定义)·R2(tenant)。
- **断点**：G-N1(多源融合)·G-10(规则可编辑)·G-11/G-12(沙盘行动后果)·N2(前瞻)·A8 真时序源。建议 N1 提 P1。

---
*审核方设计接线（design+review·钉真实来源系统/对象/求解器/规则·非真起服务实拍）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
