# DESIGN-QUERY30 · 30 个跨切片多跳复杂推演问句 + 全层缺口倒推

> 用户亲定（2026-07-05）：基于源数据全集 Excel 的字段（不局限于），形成 30 个跨 ≥3 本体切片的复杂多跳 query，
> 倒推需要补充的数据字段 / 本体 / 规则约束 / workflow / agent。
> 方法：每问标注【切片链 ≥3】【跳链】【现有支撑】【缺口】，全部对准活系统真值
> （35 类型字段清单=Excel 概览 sheet · 39 切片 · 规则 C01–C33 · 求解器 37 键），缺口不凭空、字段名逐一可对。
> 样例基准（用户给定）：Q01。

## 0. 本体引用与影响（铁律 0）

- **对象类型（§2）**：触及现有 35 类型（Base/Model/Order/Line/Process/Equipment/Material/MaterialBatch/LabTest/Customer/ARInvoice/Certification/EnergyMeter/ChangeoverMatrix/CapexProject/PurchaseOrder/CarbonFactor/FinanceAccount/FinanceMetric/ExternalSignal/AnnualScenario/ScenarioTrigger/PlanTarget/MaintPlan/Segment/DemandSegment/FinancePlan/MaterialBalance/Shipment/DataSourceHealth/KSF/Principal/Metric/RootCauseChain/SopVersionRow）；**新增 5 类型提案**（§2.2）：Supplier / BomLine / LtaContract / LaborShift / CarbonPassport。
- **链路（§3）**：L-QOS（问→答）、L-SOLVER（求解链）、L-SLICE（检索链）；新增「挤占推演链」Order→Line→Order(被挤)→Customer→Finance。
- **不变量**：R2（tenant everywhere·新类型仓储随身）、R6（确定性·方案枚举与比较矩阵同种子同输出）、R3（entitlement·新求解器/切片入目录过滤）。
- **断点**：承接 G-9（场景发育闭环——30 问是发育管道 ONTO-SCEN 的第一批真实喂料）、G-6（数据模板/FK——新字段落模板）、G-13①（已闭·Excel 导出即本设计的数据底料）。
- **回写要求**：新类型/边/切片/规则落地时回写本体 §2/§3/§5；本文档为设计源，不改运行时。

## 1. 三十问全清单（10 域 × 3 问）

约定：`切片`列引用现有切片键（coverage_* 为逐类型单跳，粗体为**待建**多跳切片，接 PANORAMA-SLICE-BACKFILL）；`缺口`只列该问的**新增**需求（前问已列过的不重复）。

### A. 接单挤占与重排（Q01–Q03）

**Q01（用户样例基准）**「4680-NCM 加 20% 六周能不能接？如果能接，输出多个方案和方案量化比较；同时该订单会挤占哪些订单的人、材、物、产线？毛利率是否因提前 20% 而变化？被影响订单是否也有多方案量化比较？」
- 切片链：order_fulfillment_360 × coverage_base × coverage_material × **order_displacement_720**（待建）× order_to_cash_720
- 跳链：Model(4680-NCM)→bases→Base.formationCapDaily/agingCapDaily→Line→Process(yield/shifts/attendance)→Equipment(oee)→Order(现有 24 单占用)→Material(onHand/inTransit/dailyUse)→MaterialBatch→Customer(creditLimit)→Segment(gmRate)
- 现有支撑：capacity_rollup+affected_orders+quote_margin+outsourcing_split 求解器；C03/C08/C13/C15/C24 规则；Order.demandDelta/outsourceRatio 字段
- 缺口：**字段** Order.promiseDate(承诺交期)/Order.marginPct(单毛利·现仅 Segment 级 gmRate)/Order.allocatedLineIds(占线明细·挤占分析的锚)/Line.capacityDaily(线级产能·Line 现仅 3 字段 lineId,baseId,name——**最大单点缺口**)/Line.certifiedModels(线级可产型号)；**本体** Order-ALLOCATED_ON→Line 边、Order-DISPLACES→Order 推演边；**求解器** what_if_displacement(挤占推演：方案枚举+被挤订单级联+每单再出方案·R6 确定性枚举)、multi_plan_compare(量化比较矩阵：交期/毛利/挤占数/外协比/现金占用五维)；**workflow** 接单全链推演（可行性→方案组→挤占→毛利→受影响订单→逐单再方案）；**规则** C34 挤占优先级不变量（pri 高的订单不可被低 pri 新单挤占逾 X 天）、C35 重大变更须 ≥2 方案（方案数下限门）

**Q02**「储能大客户 F 追加 30% 但要求锁价，接不接？锁价 vs 浮动两案对 Q3 现金垫、毛利底线、其他订单交期的量化冲击各是什么？」
- 切片链：order_to_cash_720 × coverage_customer × coverage_financeaccount × **cash_projection_360**（待建）
- 跳链：Customer(F.creditLimit/termDays/receivables)→Order(unitPrice/qty)→DemandSegment(priceWan/marginPct/floorPct)→FinanceAccount(cashOnHand/workingCapital)→FinanceMetric(cashCushion)→ExternalSignal(锂价 trend/elasticity)
- 现有支撑：quote_margin/credit_exposure/affected_orders；C13/C15/C18/C24
- 缺口：**字段** Order.priceLockedUntil(锁价期)/Order.indexedPriceFormula(联动公式)；**本体** PriceList/QuoteHistory(报价历史·比价依据)；**规则** C36 锁价期现金敞口上限；**workflow** 双案(锁价/浮动)并行推演+比较

**Q03**「若把武汉 2 条线整周切给 2170-NCM 加单，被挤的 5 张订单里哪些可外协、哪些只能延期赔付？总违约金 vs 增量毛利谁大？」
- 切片链：**order_displacement_720** × coverage_line × coverage_order × order_to_cash_720
- 跳链：Line(武汉)→Order(被挤 5 单)→Order.outsourceRatio→Material(outsourceYield)→Customer(termDays)→违约金→增量毛利对比
- 现有支撑：outsourcing_split/affected_orders/mitigation_select；C08/C31(外协质量门)
- 缺口：**字段** Order.penaltyClause(违约金率)/Order.substitutable(可外协标记)；**规则** C37 违约金/毛利权衡线(净增益为负禁采纳)；**skill** 挤占分析方法论(方案生成口径:延期/外协/拆单/降级四型)

### B. 物料与供应链（Q04–Q06）

**Q04**「石墨负极 8 月长协覆盖 vs 现货补口的成本差多少？若供应商 X 断供 2 周，哪些订单先停、补救组合是什么？」
- 切片链：**material_supply_360**（待建）× coverage_materialbalance × coverage_order × coverage_purchaseorder
- 跳链：Material(石墨负极.ltaPct? 现在 MaterialBalance.ltaPct)→LtaContract(**无此实体**)→PurchaseOrder(etaDay/delayed)→Shipment(coverageDays)→Order(受影响)→mitigation
- 现有支撑：lta_gap/supplier_disruption_radius/countermeasure_combo；C06/C16/C27
- 缺口：**本体** Supplier(供应商实体：现 Material 无 supplierId——断供推演无锚)、LtaContract(合同实体：承诺量/价格公式/起止/违约条款，现仅 MaterialBalance.ltaPct 聚合值)、Material-SUPPLIED_BY→Supplier 边；**字段** Material.altSupplierIds/moq；**规则** C38 供应商集中度红线(单一供应商占比>60% 预警)

**Q05**「MaterialBatch 呆滞 90 天以上的批次释放给哪些在手订单可消化？释放后安全库存缺口和资金占用各变多少？」
- 切片链：coverage_materialbatch × coverage_order × coverage_financeaccount × **material_supply_360**
- 跳链：MaterialBatch(ageDays/idleDays)→Material(safetyStockGapTon via MaterialBalance)→Order(可消化单)→FinanceAccount(workingCapital)
- 现有支撑：inventory_optimize；C28(呆滞预警)
- 缺口：**字段** MaterialBatch.reservedForSo(批次预留单号·现无批次↔订单绑定)/Material.safetyStockPolicy(策略参数·现仅缺口结果值)；**边** MaterialBatch-RESERVED_FOR→Order

**Q06**「LabTest 连续 3 批 fail 的物料，上游是哪家供应商哪个批次窗口？受污染批次已流入哪些在产订单？召回成本谁担？」
- 切片链：coverage_labtest × coverage_materialbatch × **material_supply_360** × coverage_order
- 跳链：LabTest(passed=false 连败)→MaterialBatch(batchId)→Supplier(**无**)→Order(在产)→召回成本
- 现有支撑：yield_diagnosis 部分；C31
- 缺口：**字段** MaterialBatch.supplierBatchNo(供应商批号·追溯锚)/LabTest.failMode(失效模式)；**规则** C39 连败批次自动隔离(quarantine 联动)；**workflow** 质量追溯链(检测→批次→供应商→在产订单→隔离动作)

### C. 产能设备与检修（Q07–Q09）

**Q07**「2026-08 检修计划与交付高峰撞车的基地，逐周错峰后 OEE 损失最小的排法是什么？错峰引发的换型损失谁最大？」
- 切片链：coverage_maintplan × coverage_equipment × coverage_changeovermatrix × coverage_order
- 跳链：MaintPlan(week/lastMaintStart)→Base→Line→Equipment(oeeA/P/Q/availFactor)→ChangeoverMatrix(minutes)→Order(due 高峰)
- 现有支撑：maintenance_stagger/changeover_sequence；C11/C22
- 缺口：**字段** MaintPlan.durationDays/mandatoryWindow(强制窗口·现仅 week 一格)/Equipment.maintCycleHours；**规则** C40 检修逾期设备禁排产(硬闸)

**Q08**「按 ChangeoverMatrix 重排常州下周 12 单，换型总时长最短的序列是什么？该序列与物料齐套、认证线约束冲突吗？三约束同时满足的次优解代价？」
- 切片链：coverage_changeovermatrix × coverage_order × coverage_certification × **material_supply_360**
- 跳链：ChangeoverMatrix(fromModel/toModel/minutes)→Order(12 单)→Certification(status·仅认证线计产能 C04)→Material(齐套 C06)
- 现有支撑：changeover_sequence/sequencing_optimize/kit_readiness/cert_schedule；C04/C06/C22/C29(冻结期)
- 缺口：**求解器** multi_constraint_schedule(三约束联合排产·现三求解器各自为战无联合解)；**workflow** 排产三约束联检链

**Q09**「Process.attendance 出勤率跌到 85% 时，哪些基地的瓶颈从设备转为人力？加班 vs 借调 vs 外协三案的量化比较？」
- 切片链：coverage_process × coverage_base × **labor_capacity_360**（待建）× coverage_order
- 跳链：Process(attendance/shifts/shiftHours)→Base(bottleneck)→LaborShift(**无此实体**)→Order(受影响)→三案比较
- 现有支撑：bottleneck_matrix/outsourcing_split；C05
- 缺口：**本体** LaborShift(班组实体：技能矩阵/编制/借调可行性——"人材物"的**人**目前只有 Process.attendance 一个聚合数)；**字段** Process.laborRequired(定员)/LaborShift.skillModels(可产型号技能)；**求解器** labor_balance(人力平衡)；**规则** C41 加班时长合规上限；**切片** labor_capacity_360(基地→线→班组→出勤→订单)

### D. 财务现金与信用（Q10–Q12）

**Q10**「ARInvoice 逾期 top3 客户若同时再逾期 30 天，现金垫击穿 C18 底线的日期是哪天？先收哪家的款自救效果最好？」
- 切片链：coverage_arinvoice × coverage_customer × coverage_financeaccount × **cash_projection_360**
- 跳链：ARInvoice(amount/overdueDays)→Customer(receivables/maxOverdueDays)→FinanceAccount(cashOnHand)→逐日现金投影
- 现有支撑：credit_exposure；C13/C18/C32(逾期冻结)
- 缺口：**字段** ARInvoice.dueDate/expectedPayDate(现仅 overdueDays 快照·无法投影)/FinanceAccount.dailyBurnRate；**求解器** cash_projection(逐日现金流投影·现 FinanceMetric.cashCushion 是静态值)；**切片** cash_projection_360(订单→发票→账期→现金)

**Q11**「毛利归因：本季 netMargin 掉 2.3pp，按 margin_attribution 拆到订单/物料涨价/汇率/良率四因子各占多少？哪个因子有对冲动作？」
- 切片链：coverage_financemetric × coverage_order × coverage_material × coverage_externalsignal
- 跳链：FinanceMetric(netMargin)→Order(unitPrice)→Material(unitPrice/devPct)→ExternalSignal(锂价/汇率 elasticity)→RootCauseChain(factor)
- 现有支撑：margin_attribution/countermeasure_combo；C15
- 缺口：**字段** ExternalSignal 缺汇率类信号种子(category 现无 fx)/Order.costBreakdown(BOM 成本快照·归因粒度)；**本体** BomLine(Model→Material 用量明细实体·现 Material.bomUnit 反挂无法多型号差异化)

**Q12**「客户 E 信用额度若上调 20%，能解锁哪些被 C13 卡住的单？上调后组合信用敞口 vs 坏账拨备的平衡点在哪？」
- 切片链：coverage_customer × coverage_order × coverage_arinvoice × **cash_projection_360**
- 跳链：Customer(E.creditLimit/creditUsedRatio via Order)→被卡订单→credit_exposure→拨备
- 现有支撑：credit_exposure/quote_margin；C13/C24/C32
- 缺口：**字段** Customer.badDebtProvisionPct(拨备率)/Customer.strategicTier(战略层级·上调依据)；**规则** C42 信用上调审批链(超阈值须 Action 审批·接 S2)

### E. 碳与合规认证（Q13–Q15）

**Q13**「武汉产 2170-NCM 出口欧盟：电池护照四要素(碳足迹/再生料/尽责/标签)哪项缺数？缺项补齐的最短路径和成本？」
- 切片链：**carbon_chain_360**（待建）× coverage_carbonfactor × coverage_model × coverage_certification
- 跳链：Model(carbonFootprint)→Material(carbonFactor)→EnergyMeter(gridFactor)→CarbonFactor(kind/key)→CarbonPassport(**无此实体**)→Certification
- 现有支撑：carbon_footprint 求解器；C33(碳护照前置)
- 缺口：**本体** CarbonPassport(护照实体：四要素状态/签发方/有效期——C33 引用了"碳护照"但系统无此对象)；**字段** Material.recycledPct(再生料比例)/Model.dueDiligenceStatus；**切片** carbon_chain_360(订单→型号→BOM→物料→碳因子→护照)

**Q14**「若欧盟碳价涨到 120€/t，哪些型号的出口毛利转负？改用绿电(gridFactor 减半)后恢复几个？绿电改造 CAPEX 回收期？」
- 切片链：**carbon_chain_360** × coverage_energymeter × coverage_capexproject × coverage_financemetric
- 跳链：CarbonFactor→Model(carbonFootprint×碳价)→毛利重算→EnergyMeter(gridFactor)→CapexProject(irr)
- 现有支撑：carbon_footprint/capex_scenario；C23
- 缺口：**字段** ExternalSignal 补碳价信号(category=carbon_price·带 elasticity)/EnergyMeter.greenPowerPct；**workflow** 碳价敏感性推演链(碳价→逐型号毛利→绿电改造案→CAPEX 评审)

**Q15**「Q4 认证资源(certHours)全排满的情况下，插入 4680 新版本认证会推迟哪些型号量产？认证外包 vs 顺延两案比较？」
- 切片链：coverage_certification × coverage_model × coverage_line × coverage_order
- 跳链：Certification(certHours/gapContribution)→Model→Line(认证线 C04)→Order(量产依赖)
- 现有支撑：cert_schedule；C04/C26(认证资源上限)
- 缺口：**字段** Certification.outsourceable(可外包标记)/estCompleteDate；**规则** C43 认证外包质量等效门(外包认证需等效性证明)

### F. 能源与成本（Q16–Q18）

**Q16**「按峰谷电价把高能耗工序(化成/老化)移到谷段，每基地月省多少电费？移谷后 agingSlots 周转变慢对交付的连带影响？」
- 切片链：coverage_energymeter × coverage_process × coverage_base × coverage_order
- 跳链：EnergyMeter(energyPerUnit/processKey)→Process(agingSlots/agingDays/channels)→Base→Order(due)
- 现有支撑：无专属求解器（capacity 族部分）
- 缺口：**本体/字段** TariffSchedule(峰谷电价表实体或 EnergyMeter.tariffBands——现无电价数据·只有能耗)；**求解器** energy_cost_schedule(谷段排产+交付联检)；**规则** C44 谷段迁移不破交期(能源优化让位交付)

**Q17**「单位 GWh 完全成本(料/工/能/折旧)分基地排名？成本最高基地若关停一条线，固定成本摊薄 vs 产能损失的平衡点？」
- 切片链：coverage_base × coverage_process × coverage_financeaccount × coverage_equipment
- 跳链：Base(gwh)→Material(成本)→Process(人工 via attendance)→EnergyMeter(能耗)→折旧(**无**)→FinanceAccount
- 现有支撑：capacity_rollup/margin_attribution 部分
- 缺口：**字段** Equipment.depreciationMonthly(折旧·完全成本缺一腿)/Base.fixedCostMonthly；**求解器** full_cost_rollup(完全成本卷积)

**Q18**「ExternalSignal 电价 trend 连涨三期触发 ScenarioTrigger 后，自动生成的对策组合是什么？对策执行后毛利保住几个点？」
- 切片链：coverage_externalsignal × coverage_scenariotrigger × coverage_financemetric × coverage_order
- 跳链：ExternalSignal(value/trend/elasticity)→ScenarioTrigger(condition/expr/action)→countermeasure_combo→FinanceMetric(netMargin)
- 现有支撑：countermeasure_combo/ScenarioTrigger 实体在；C25
- 缺口：**接线** ScenarioTrigger.action→workflow 自动执行链(现 status/notifiedTo 仅通知·无编排出口——接 G-14 半自动残口)；**规则** C45 自动对策仅生成草稿(执行必经 S2 审批·防自动化越权)

### G. S&OP 与年度规划（Q19–Q21）

**Q19**「2027 年度三情景(AnnualScenario)按 Q3 实际 act 回滚重算后，哪个情景的 capacityDecision 还成立？触发切换情景的条件差多少？」
- 切片链：aop_scenario_chain × coverage_annualscenario × coverage_plantarget × coverage_demandsegment
- 跳链：AnnualScenario(demand/capacityDecision/ltaLock)→PlanTarget(period/value)→DemandSegment(act vs p50/p90)→ScenarioTrigger
- 现有支撑：capex_scenario/quarterly_gap/plan_audit；C21/C25
- 缺口：**字段** AnnualScenario.switchThreshold(切换条件量化)/PlanTarget.confidence；**workflow** 年度情景滚动重校链(act 回灌→三情景重算→切换建议)

**Q20**「S&OP 产销平衡 SopVersionRow 最新版 vs 上版的 demand/supply 差异是谁改的、依据哪个信号？差异下钻到哪些 Segment 哪些基地？」
- 切片链：coverage_sopversionrow × coverage_segment × coverage_demandsegment × coverage_base
- 跳链：SopVersionRow(ver/demand/supply/isFinal)→版本 diff→Segment(baselineShare)→Base
- 现有支撑：S1.8 S&OP 模块·plan_audit
- 缺口：**字段** SopVersionRow.changedBy/changeReason/signalRef(变更留痕三件套·现无审计锚)；**规则** C46 final 版锁定(isFinal 后改动必新版本)

**Q21**「产销平衡缺口 12 万套按 quarterly_gap 拆到季后，用 countermeasure_combo 生成的补口组合里，跨季借产能的方案会不会破坏下季的 C21 平衡？」
- 切片链：aop_scenario_chain × coverage_plantarget × coverage_base × coverage_order
- 跳链：quarterly_gap→countermeasure_combo→跨季产能占用→下季 C21 重检
- 现有支撑：quarterly_gap/countermeasure_combo；C21
- 缺口：**求解器增强** countermeasure_combo 加跨期约束传播(现单期求解·跨季副作用不回检)；**规则** C47 跨期方案须多期联检

### H. 质量与根因（Q22–Q24）

**Q22**「武汉涂布良率连降 5 天，按 RootCauseChain 的 driverType 逐因子核数后，top 根因的上游是设备(oeeQ)、物料批次(LabTest)还是参数(SopVersionRow)？」
- 切片链：coverage_rootcausechain × coverage_equipment × coverage_labtest × coverage_process
- 跳链：Process(yield 连降)→RootCauseChain(factor/evidenceField/baseWeight)→Equipment(oeeQ)/LabTest(passed)/参数
- 现有支撑：yield_diagnosis(S12 已真跑)；C30(良率连降停线评审)
- 缺口：**字段** Process.yieldDaily(时序·现 yield 是快照单值·"连降 5 天"无数据基础——**时序缺口**·接 A8 ts_points 但 Process 良率未入时序)；**接线** RootCauseChain.evidenceField→真实字段解引用齿(防幽灵引用)

**Q23**「C30 触发停线评审的线，复线的三条件(良率回升/根因闭环/评审通过)各自的数据凭证在哪？复线后 72h 观察期谁盯？」
- 切片链：coverage_process × coverage_rootcausechain × coverage_metric × coverage_principal
- 跳链：C30 触发→停线→复线条件→Metric(target/actual)→Principal(ownerRef)
- 现有支撑：C30 规则在·S2 Action 审批在
- 缺口：**本体** LineStopEvent(停复线事件实体·现停线无留痕对象)；**workflow** 停线→复线三条件联检→观察期挂 Metric 的闭环链；**规则** C48 观察期内良率再破线自动重停

**Q24**「跨基地同型号良率差 >3pp 的工序，把高良率基地的 SOP 参数移植到低良率基地，预期收益和移植风险(设备代差)量化？」
- 切片链：coverage_process × coverage_base × coverage_equipment × coverage_sopversionrow
- 跳链：Process(yield 按 baseId 分组对比)→SopVersionRow(参数版本)→Equipment(ctSeconds/代差)→移植方案
- 现有支撑：yield_diagnosis/bottleneck_matrix 部分
- 缺口：**字段** Equipment.modelGeneration(设备代次·代差风险的锚)/SopVersionRow.paramSet(参数集·现仅 demand/supply 两数)；**skill** SOP 移植方法论

### I. 资本与投资（Q25–Q27）

**Q25**「江门动力线 CapexProject 若 irr 复算跌破 C23 门槛，砍掉后原规划产能缺口由哪些既有基地扩产补？扩产 vs 外协长约的十年 NPV 比较？」
- 切片链：coverage_capexproject × coverage_base × coverage_annualscenario × coverage_financemetric
- 跳链：CapexProject(irr/util24/c23pass)→AnnualScenario(capacityDecision)→Base(gwh 扩产弹性)→NPV
- 现有支撑：capex_scenario/facility_location；C23
- 缺口：**字段** Base.expansionHeadroomGwh(扩产弹性上限)/CapexProject.npv10y；**求解器** capex_alternatives(砍单后补口方案枚举)

**Q26**「三个 CapexProject 争同一笔预算(FinancePlan.budget)，按 IRR/战略权重/风险的组合评分排序？只投前二时第三个的机会成本？」
- 切片链：coverage_capexproject × coverage_financeplan × coverage_ksf × coverage_metric
- 跳链：CapexProject×3→FinancePlan(budget/rolling)→KSF(战略权重)→组合评分
- 现有支撑：selection_optimize/combinatorial_auction 可复用；C23
- 缺口：**字段** CapexProject.strategyKsfRef(挂 KSF 战略锚)/riskScore；**workflow** 资本组合评审链(评分→比选→S2 审批留痕)

**Q27**「AnnualScenario 选激进案时 capex 峰值月的现金垫是否击穿 C18？错峰付款(供应商账期 90 天)能救回几个月？」
- 切片链：coverage_annualscenario × coverage_financeaccount × **cash_projection_360** × coverage_purchaseorder
- 跳链：AnnualScenario(capex)→逐月现金投影→FinanceAccount→PurchaseOrder(付款期)→错峰重算
- 现有支撑：capex_scenario/FinanceMetric.cashCushion；C18/C23
- 缺口：**字段** PurchaseOrder.paymentTermDays(付款账期·现只有到货 etaDay)/CapexProject.spendSchedule(支出节奏)；复用 Q10 的 cash_projection 求解器

### J. 外部信号与风险传导（Q28–Q30）

**Q28**「锂价信号(ExternalSignal.elasticity)+20% 传导全链：先冲哪些 Material 成本、再冲哪些 Order 毛利、最后哪些 Segment 跌破 floorPct？对冲动作组合？」
- 切片链：coverage_externalsignal × coverage_material × coverage_order × coverage_demandsegment
- 跳链：ExternalSignal(锂价)→Material(unitPrice×elasticity)→BomLine(**无**)→Order(成本重算)→DemandSegment(marginPct vs floorPct)→countermeasure_combo
- 现有支撑：countermeasure_combo/margin_attribution；C25/C15
- 缺口：**本体** BomLine(信号→物料→型号→订单传导的**桥**·再次命中 Q11 缺口——无 BOM 明细传导断链)；**求解器** signal_propagation(信号全链传导·现 generic_inference 单跳派生不够)

**Q29**「台风预警(新信号类型)封 3 天港口：Shipment 在途哪些改陆运、哪些顺延？改运费用 vs 断料停线损失的每单决策？」
- 切片链：coverage_shipment × coverage_materialbalance × coverage_order × **material_supply_360**
- 跳链：ExternalSignal(台风)→Shipment(etaDay/qtyTons/coverageDays)→MaterialBalance(logisticsGapTon)→Order(停线风险)→每单改运/顺延决策
- 现有支撑：supplier_disruption_radius/kit_readiness 部分；C06/C16
- 缺口：**字段** ExternalSignal 补天气/物流类信号种子(category=logistics)/Shipment.transportMode+rerouteCostPerTon；**求解器** reroute_decision(逐单改运决策)；**规则** C49 断料停线损失口径(改运决策的分母统一)

**Q30**「DataSourceHealth 关键源(critical=true)时延超 C09 降级线时，哪些切片/求解器/卡的答案会降级？降级期间哪些决策必须转人工双签？」
- 切片链：coverage_datasourcehealth × **数据流域切片**（PANORAMA 待建）× coverage_metric × coverage_order
- 跳链：DataSourceHealth(lagHours/critical)→依赖它的切片→求解器→场景卡→答案 trust 降级→高危决策清单
- 现有支撑：C09(时延降级)·DataSourceHealth 实体在·trustLevel 机制在
- 缺口：**本体边** DataSourceHealth-FEEDS→ObjectType(源→类型依赖边·现降级无法定位血缘下游)；**规则** C50 降级期高危动作双签(接 S2)；**切片** 数据流域切片(RawDataset→ObjectType→Slice→Solver·已在 PANORAMA-SLICE-BACKFILL 单内)

## 2. 倒推汇总 · 全层缺口清单（30 问聚合去重）

### 2.1 数据字段增补（现有类型 · 按频次排序）

| 类型 | 新字段 | 服务问句 | 备注 |
|---|---|---|---|
| **Line** | capacityDaily / certifiedModels / changeoverGroup | Q01/Q03/Q08/Q15 | **最大单点缺口**：Line 现仅 3 字段，线级推演全靠 Base 聚合值 |
| Order | promiseDate / marginPct / allocatedLineIds / penaltyClause / substitutable / priceLockedUntil / costBreakdown | Q01/Q02/Q03/Q11 | 挤占与毛利推演的锚 |
| Material | altSupplierIds / moq / recycledPct / safetyStockPolicy | Q04/Q05/Q13 | |
| MaterialBatch | reservedForSo / supplierBatchNo | Q05/Q06 | 批次↔订单↔供应商追溯 |
| ARInvoice | dueDate / expectedPayDate | Q10 | 现金投影的前提（现仅逾期快照） |
| Customer | badDebtProvisionPct / strategicTier | Q12 | |
| Certification | outsourceable / estCompleteDate | Q15 | |
| Equipment | depreciationMonthly / modelGeneration / maintCycleHours | Q17/Q24/Q07 | 完全成本+代差 |
| EnergyMeter | tariffBands / greenPowerPct | Q16/Q14 | 或独立 TariffSchedule |
| Process | yieldDaily→时序化 / laborRequired | Q22/Q09 | 良率"连降"需入 A8 ts_points |
| SopVersionRow | changedBy / changeReason / signalRef / paramSet | Q20/Q24 | 变更留痕 |
| MaintPlan | durationDays / mandatoryWindow | Q07 | |
| PurchaseOrder | paymentTermDays | Q27 | |
| AnnualScenario | switchThreshold | Q19 | |
| Base | expansionHeadroomGwh / fixedCostMonthly | Q25/Q17 | |
| CapexProject | npv10y / strategyKsfRef / riskScore / spendSchedule | Q25/Q26/Q27 | |
| ExternalSignal | 种子补 fx/carbon_price/logistics 三类信号 | Q11/Q14/Q29 | |
| Shipment | transportMode / rerouteCostPerTon | Q29 | |

### 2.2 本体增补（新对象类型 5 + 新边 6）

| 新类型 | 字段骨架 | 服务问句 | 为什么必须是实体 |
|---|---|---|---|
| **Supplier** | supplierId/name/leadDays/qualityScore/concentrationPct | Q04/Q06/Q29 | 断供半径、集中度、追溯全挂空——Material 无供应商锚 |
| **BomLine** | bomId/modelId/matId/qtyPerUnit/substituteGroup | Q11/Q28 | 信号→物料→型号→订单的传导桥；现 bomUnit 反挂在 Material 无法多型号 |
| **LtaContract** | ltaId/matId/supplierId/committedQty/priceFormula/validFrom/To | Q04 | 现仅 MaterialBalance.ltaPct 聚合值·合同级推演(违约/重谈)无对象 |
| **LaborShift** | shiftId/baseId/lineId/headcount/skillModels/borrowable | Q09 | "人材物"的人只有 attendance 一个数 |
| **CarbonPassport** | passportId/modelId/co2PerKwh/recycledPct/dueDiligence/labelStatus/expiry | Q13/Q14 | C33 引用"碳护照"但系统无此对象 |
| 新边 | Order-ALLOCATED_ON→Line · Order-DISPLACES→Order · Material-SUPPLIED_BY→Supplier · MaterialBatch-RESERVED_FOR→Order · Model-BOM→BomLine→Material · DataSourceHealth-FEEDS→ObjectType | Q01/Q03/Q04/Q05/Q28/Q30 | 多跳链的缺失接缝 |

### 2.3 规则/约束增补（C34–C50 · 17 条）

C34 挤占优先级不变量 · C35 重大变更须≥2方案 · C36 锁价期现金敞口上限 · C37 违约金/毛利权衡线 · C38 供应商集中度红线 · C39 连败批次自动隔离 · C40 检修逾期禁排产 · C41 加班合规上限 · C42 信用上调审批链 · C43 认证外包等效门 · C44 谷段迁移不破交期 · C45 自动对策仅草稿(必经审批) · C46 SOP final 版锁定 · C47 跨期方案多期联检 · C48 复线观察期重停 · C49 断料损失口径统一 · C50 降级期高危双签

### 2.4 切片增补（多跳业务切片 6 · 接 PANORAMA-SLICE-BACKFILL 扩容）

order_displacement_720（订单→产线→被挤订单→客户→财务）· material_supply_360（物料→供应商→长协→在途→批次→订单）· labor_capacity_360（基地→线→班组→出勤→订单）· carbon_chain_360（订单→型号→BOM→物料→碳因子→护照）· cash_projection_360（订单→发票→账期→现金逐日）· 数据流域切片（已在 PANORAMA 单）

### 2.5 求解器/workflow 增补

| 新求解器 | 口径 | 服务问句 |
|---|---|---|
| what_if_displacement | 挤占推演：方案确定性枚举(延期/外协/拆单/降级)+被挤订单级联+逐单再方案(R6) | Q01/Q03 |
| multi_plan_compare | 方案量化比较矩阵：交期/毛利/挤占数/外协比/现金占用五维 | Q01/Q02/Q09/Q15 |
| cash_projection | 逐日现金流投影(发票账期+付款节奏+capex 支出) | Q10/Q27 |
| labor_balance | 人力平衡(加班/借调/外协三案) | Q09 |
| energy_cost_schedule | 峰谷排产+交付联检 | Q16 |
| full_cost_rollup | 单位 GWh 完全成本(料工能折) | Q17 |
| signal_propagation | 信号全链传导(信号→BOM→订单→Segment) | Q28 |
| reroute_decision | 物流改运逐单决策 | Q29 |
| multi_constraint_schedule | 换型×齐套×认证三约束联合排产 | Q08 |
| capex_alternatives | 砍单补口方案枚举 | Q25 |
| （增强）countermeasure_combo | 加跨期约束传播 | Q21 |

**新 workflow**（7 条链）：接单全链推演（Q01 样例链：可行性→方案组→挤占→毛利→受影响订单→逐单再方案）· 质量追溯链（Q06）· 排产三约束联检链（Q08）· 碳价敏感性链（Q14）· 年度情景滚动重校链（Q19）· 停复线闭环链（Q23）· 资本组合评审链（Q26）。全部按 ONTO-SCEN 发育管道（genome 声明 planSteps/ruleIds/sliceTargets → 三环长成），**不再手工播种**（闭 G-9 路径）。

### 2.6 agent / skill / intent 增补

- **skill**（方法论库·接 SKILL-LIBRARY-EVERYWHERE 单）：挤占分析法（方案四型枚举口径）· 供应链风险法（断供半径+集中度）· SOP 移植法 · 现金投影法 · 碳合规路径法——各带 description 上目录。
- **agent**：接单参谋 agent（绑 what_if_displacement+multi_plan_compare+quote_margin+credit_exposure，挂挤占分析 skill，规则 POST_CHECK C34/C35/C13/C24）· 供应链风控 agent（Q04/Q06/Q29 族）。
- **intent**：30 问逐一入 intent 目录成场景卡（AGENT_FIRST：Q01-03/Q09/Q24/Q25 类多方案探索；WORKFLOW：其余确定性链），经 ONTO-SCEN-GROW 发育管道长成（PROVISIONAL→ADVISORY→GOVERNED），**不走 seed 手装**。

## 3. 落地路径（依赖链 · WO 化）

```
[本文档 DESIGN-QUERY30] (设计源·已交付)
   ├─→ QUERY30-ONTOLOGY-EXT   (P1) 新 5 类型+6 边+§2.1 字段批·合成种子同步·模板/FK(G-6)
   ├─→ QUERY30-RULES          (P1) C34–C50 十七条入规则库(参数化·可编辑·接 G-10 一等引用)
   ├─→ QUERY30-ORCH           (P1) 新求解器 10+增强 1·7 workflow·2 agent·5 skill·30 intent 入目录
   │       deps: ONTOLOGY-EXT + RULES + SKILL-LIBRARY-EVERYWHERE
   └─→ 30 问经 ONTO-SCEN 发育管道逐张长成场景卡(G-9 闭环的第一批真实喂料)
           deps: ONTO-SCEN-GROW(已 BUILT 待审)→LAUNCH-DET→RENDER-PROJ(在建)
```

**分期建议**：第一期做 Q01 全链（用户样例·字段 Line/Order 批 + what_if_displacement + multi_plan_compare + 接单 workflow + C34/C35）打穿一条完整样板，再横向铺其余 29 问——避免 30 问平铺导致每问都半熟。
