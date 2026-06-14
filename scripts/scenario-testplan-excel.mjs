#!/usr/bin/env node
/**
 * 工业级推演测试方案 —— 10 个复杂场景（非 demo 简单推演）Excel 生成器。
 *
 * 借鉴原型 docs/demo-推演系统.html 的推演模块（产能推演/项目推演/规划体检/年度情景/
 * 季度滚动/瓶颈矩阵），把每个场景拆解为：本体切片(跨域路径) + 数据量 +
 * 智能体(skills/约束/规则) 或 工作流(节点)。
 *
 * 目标：用这些场景把系统跑通工业级测试、补充工业级数据、找出需补充的模块/缺失功能。
 * 因此每个场景都标注「现状(✓存在 / ✚需补充)」，并在「缺口」表汇总。
 *
 * 内容基于对当前系统的实查（2026-06）：
 *   - 注册数据域 11：factory/product/process/equip/quality/capacity/forecast/people/plan/finance/unassigned
 *     （注：对象类型已使用 supply/commercial 两域，但二者未在域注册表 → 缺口）
 *   - 链路边 8：order_for_model / order_of_customer / model_producible_at / model_certified_on /
 *     line_belongs_to_base / line_has_process / equip_used_in / model_uses_material
 *     → 当前最大连通切片 = order_fulfillment_360（6 域）。8 域切片需新增边（见缺口表）。
 *   - 求解器 21、skills 20、已发布规则 16（C01–C33 子集）。
 *
 * 用法：node scripts/scenario-testplan-excel.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- SpreadsheetML 2003 builder -------------------------------------------
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
const cell = (v, style) => {
  const isNum = typeof v === "number" && Number.isFinite(v);
  return `    <Cell${style ? ` ss:StyleID="${style}"` : ""}><Data ss:Type="${isNum ? "Number" : "String"}">${isNum ? v : esc(v)}</Data></Cell>`;
};
const row = (cells, h) => `   <Row${h ? ` ss:Height="${h}"` : ""}>\n${cells.join("\n")}\n   </Row>`;
const colsDef = (widths) => widths.map((w) => `   <Column ss:Width="${w}"/>`).join("\n");
const sheet = (name, widths, rows) => `  <Worksheet ss:Name="${esc(name)}">\n  <Table>\n${colsDef(widths)}\n${rows.join("\n")}\n  </Table>\n   <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions>\n  </Worksheet>`;
const wb = (sheets) => `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Top" ss:WrapText="1"/><Font ss:FontName="Microsoft YaHei" ss:Size="10"/></Style>
  <Style ss:ID="title"><Font ss:Bold="1" ss:Size="14" ss:Color="#1F4E79"/></Style>
  <Style ss:ID="h2"><Font ss:Bold="1" ss:Size="11" ss:Color="#1F4E79"/></Style>
  <Style ss:ID="hdr"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#2E75B6" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
  <Style ss:ID="k"><Font ss:Bold="1"/></Style>
  <Style ss:ID="d5"><Interior ss:Color="#FFF2CC" ss:Pattern="Solid"/><Alignment ss:Vertical="Top" ss:WrapText="1"/></Style>
  <Style ss:ID="d8"><Interior ss:Color="#E2EFDA" ss:Pattern="Solid"/><Alignment ss:Vertical="Top" ss:WrapText="1"/></Style>
  <Style ss:ID="gap"><Font ss:Color="#C00000"/><Alignment ss:Vertical="Top" ss:WrapText="1"/></Style>
  <Style ss:ID="ok"><Font ss:Color="#548235"/></Style>
 </Styles>
${sheets.join("\n")}
</Workbook>`;

// ===========================================================================
// 10 个复杂场景定义（grounded 在实查清单；标注 ✓存在 / ✚需补充）
// ===========================================================================
const SCEN = [
  {
    no: "S1", name: "跨基地交期危机闭环推演",
    kind: "风险预判 + 根因 + 处置闭环（多求解器串联 + Action 写回）",
    slice: "order_fulfillment_360 ✓",
    domains: "产品→工厂→工艺→设备→供给→商务", nd: 6,
    data: "全量 10,060 订单池过滤常州在手单(数十) · 12 基地 · 12 产线 · 144 设备 · 90 天 OEE/良率/产出时序(61,320 点)",
    drive: "智能体（路径 B · 探索式多轮）",
    cfg: "Skills：s02_受影响订单解读 / s03_风险越线根因 / s06_处置方案采纳\n求解器：affected_orders → risk_timeline → mitigation_select\n规则(POST_CHECK)：C03 产能上限 / C05 利用率持续越线 / C13 客户信用\n写操作：降级为 Action 草稿 adopt_mitigation（审批后执行）",
    out: "受影响订单清单(逐单延误/影响度) + 4 类问题归并 + 根因时间线 + 处置方案 + Action 草稿",
    gap: "✚ resolve_slice 作为 B 路径内置工具需确认/补齐；mitigation_select 入参需对接 risk_timeline 输出（当前手传 args）",
  },
  {
    no: "S2", name: "新型号产能爬坡可承接性 + 认证解锁联合推演",
    kind: "产能推演 + 认证排期 + 齐套（确定性工作流）",
    slice: "product_ramp_5d ✚（新建）",
    domains: "产品→工厂→工艺→设备→供给", nd: 5,
    data: "6 型号 × 12 产线认证 18 条 · 144 设备 takt/OEE · 8 物料 BOM · 90 天爬坡时序",
    drive: "工作流（路径 A · 确定性）",
    cfg: "节点：① query_objects(Model,filter) ② resolve_slice(product_ramp_5d) ③ invoke_solver(capacity_forecast P50/P90) ④ invoke_solver(cert_schedule) ⑤ invoke_solver(kit_readiness) ⑥ evaluate_rules(C03,C26) ⑦ 汇总卡(可承接结论+解锁产能)",
    out: "P50/P90 可承接量 + 瓶颈工序 + 认证排期(先认证谁/解锁多少) + 齐套缺口",
    gap: "✚ 新切片 product_ramp_5d；✚ 边 model_has_cert(Model→Certification)；cert_schedule 需 Certification 对象入参（现仅 args）",
  },
  {
    no: "S3", name: "客户信用-接单毛利联审推演",
    kind: "毛利评审 + 信用敞口（商务域深推演）",
    slice: "order_commercial_5d ✚（新建）",
    domains: "产品→商务(客户/发票)→供给→工厂→工艺", nd: 5,
    data: "60 客户 · 2,400 应收发票 · 10,060 订单 · 8 物料成本 · 12 基地",
    drive: "智能体（路径 B）",
    cfg: "Skills：s15_接单毛利解读 / s16_客户信用解读\n求解器：quote_margin → credit_exposure\n规则：C13 信用额度 / C15 毛利红线(✚未发布) / C32 逾期冻结",
    out: "单笔毛利是否过线(成本拆解) + 客户敞口/逾期 + 可否接新单判定",
    gap: "✚ 边 customer_has_invoice(Customer→ARInvoice)；✚ 规则 C15 毛利红线未发布；credit_exposure 需 ARInvoice 聚合入参",
  },
  {
    no: "S4", name: "订单到回款全链推演 order_to_cash_720",
    kind: "端到端履约+现金联动（8 域大切片工作流）",
    slice: "order_to_cash_720 ✚（新建）",
    domains: "产品→商务→工厂→工艺→设备→供给→产能→计划", nd: 8,
    data: "10,060 订单 · 60 客户 · 2,400 发票 · 3,000 采购单 · 12 在途批次 · 17 计划目标 · 144 设备",
    drive: "工作流（路径 A）",
    cfg: "节点：resolve_slice(order_to_cash_720) → kit_readiness → lta_gap → credit_exposure → quarterly_gap → evaluate_rules(C13,C27,C29) → 现金/交付/齐套三联汇总",
    out: "全链可交付率 + 现金回收预测 + 齐套/长协缺口 + 计划目标达成偏差",
    gap: "✚ 边×3：material_supplied_by_po、base_has_shipment、order_to_plantarget；✚ 跨 5 求解器编排器；财务域(现金)无对象类型",
  },
  {
    no: "S5", name: "供应链中断·多基地再平衡推演",
    kind: "断供冲击波 + 再平衡(齐套/长协/外协/库存)（8 域）",
    slice: "supply_disruption_8d ✚（新建）",
    domains: "供给→产品→工厂→工艺→设备→商务→产能→计划", nd: 8,
    data: "8 物料 · 2,000 物料批次 · 3,000 采购单(2 延迟) · 12 在途 · 12 检修计划 · 10,060 订单",
    drive: "智能体（路径 B · 多步对策组合）",
    cfg: "Skills：s08_齐套 / s09_长协 / s10_库存优化 / s14_外协分配\n求解器：kit_readiness → lta_gap → inventory_optimize → outsourcing_split → quarterly_gap\n规则：C06/C16 齐套 / C08 外协红线 / C27 长协偏差 / C28 呆滞预警",
    out: "断供影响订单波 + 再平衡组合(备料/切换/外协/调拨) + 成本与释放资金",
    gap: "✚ 边×4：material_has_batch、material_supplied_by_po、base_has_shipment、base_maint_plan；PO.delayed → 触发 re-plan 无求解器；规则 C06/C16 未发布",
  },
  {
    no: "S6", name: "季度产销缺口对策组合推演",
    kind: "缺口归因 + 对策组合 + 体检(季度滚动 → 规划体检)（8 域）",
    slice: "quarterly_gap_8d ✚（新建）",
    domains: "计划→产品→工厂→工艺→供给→产能→商务→设备", nd: 8,
    data: "17 计划目标 · 3 年度情景 · 4 触发条件 · 10,060 订单 · 12 基地产能 · 8 物料",
    drive: "工作流（路径 A · 带分支）",
    cfg: "节点：resolve_slice → quarterly_gap →【分支】cert_schedule | outsourcing_split | changeover_sequence | capex_scenario → plan_audit → evaluate_rules(C18,C23) → AOP情景拍板 Action",
    out: "各季缺口 + 对策组合成本对比 + 体检评分/结论 + 情景拍板草稿",
    gap: "✚ 边：order/model→PlanTarget、scenario→CapexProject；缺口对策「组合优化」无 meta-求解器；ScenarioTrigger 表达式扫描未接 RULE_SCAN",
  },
  {
    no: "S7", name: "碳护照合规·出口准入推演",
    kind: "碳足迹核算 + 认证 + 出口准入（8 域）",
    slice: "carbon_passport_8d ✚（新建）",
    domains: "产品→供给(物料/碳因子)→工厂(能耗)→工艺→设备→商务→质量→计划", nd: 8,
    data: "8 物料 + 14 碳因子 · 12 能耗计量 · 6 型号认证 18 · 60 客户(出口) · 碳预算(计划)",
    drive: "智能体（路径 B）",
    cfg: "Skills：s20_碳足迹解读 / s07_认证排期\n求解器：carbon_footprint → cert_schedule\n规则：C33 碳护照前置 / C26 认证资源上限",
    out: "型号碳足迹(物料+能耗) + 是否达标 + 出口准入/降碳路径 + 认证排期",
    gap: "✚ 边×2：material_carbon(Material→CarbonFactor)、base_energy_meter(Base→EnergyMeter)；✚ 派生属性 Model.carbonFootprint(C33 引用但缺)；质量域碳数据可信度无对象",
  },
  {
    no: "S8", name: "数据质量→产能可信度推演",
    kind: "数据新鲜度/缺口 → 产能置信带(质量域驱动)（8 域）",
    slice: "data_trust_8d ✚（新建）",
    domains: "质量→工厂→工艺→设备→产品→供给→产能→计划", nd: 8,
    data: "数据源健康仅 1 条(✚需扩到≥20源) · 144 设备 ts 新鲜度 · 60 工序良率 · 12 在途",
    drive: "工作流（路径 A）",
    cfg: "节点：resolve_slice → query_timeseries_agg(OEE/良率新鲜度) → bottleneck_matrix → capacity_forecast(置信带) → evaluate_rules(C09,C12) → 数据可信度报告",
    out: "各源时延/缺口 + 受影响产能置信带 + 临时降级建议 + 重校触发",
    gap: "✚ 边 base_data_health(Base→DataSourceHealth)；DataSourceHealth 仅 1 行(数据量严重不足)；✚ 规则 C09 临时降级未发布；ts 新鲜度→产能折减求解器缺失",
  },
  {
    no: "S9", name: "年度 AOP 情景拍板（CAPEX+长协+财务联动）",
    kind: "年度情景测算 + 方案生成 + 体检 + 拍板（8 域）",
    slice: "aop_scenario_8d ✚（新建）",
    domains: "计划(情景/目标/投资)→产品→工厂→工艺→供给→商务→产能→财务", nd: 8,
    data: "3 年度情景 · 17 计划目标 · 3 CAPEX 项目 · 6 型号 · 8 物料长协 · 60 客户现金",
    drive: "工作流（路径 A · 多求解器）",
    cfg: "节点：resolve_slice → capex_scenario(C23 门槛) → lta_gap → plan_generate(三方案) → plan_audit → evaluate_rules(C18,C23) → AOP情景拍板 Action(审批链)",
    out: "三情景(保守/基准/激进) IRR/现金/产能 + 推荐方案 + 体检 + 拍板草稿",
    gap: "✚ 财务域(finance)无对象类型——现金/IRR 仅存于 solver 参数 → 无法切片；✚ 边 AnnualScenario→PlanTarget/CapexProject；plan_generate 跨域取数尚靠 args",
  },
  {
    no: "S10", name: "检修错峰-OEE-良率联合优化",
    kind: "设备/工艺时序联合优化(检修+OEE+良率+换型)（8 域）",
    slice: "maint_oee_yield_8d ✚（新建）",
    domains: "设备→工艺→工厂→产品→供给→产能→质量→计划", nd: 8,
    data: "12 检修计划 · 144 设备 OEE 时序 · 60 工序良率 · 30 换型矩阵 · 12 在途 · 90 天",
    drive: "智能体（路径 B）",
    cfg: "Skills：s11_换型排序 / s12_良率诊断 / s13_检修错峰\n求解器：maintenance_stagger → yield_diagnosis → changeover_sequence → bottleneck_matrix\n规则：C05 利用率越线 / C30 良率连降停线 / C22 冻结期",
    out: "检修错峰排期 + 良率掉点根因 + 换型最优序 + 瓶颈定位",
    gap: "✚ 边×3：base_maint_plan、model_changeover(Model→ChangeoverMatrix)、base_has_shipment；yield_diagnosis/maintenance_stagger 需直接消费 ts(现 args)",
  },
];

// 切片跨域路径明细（root + hops；✓存在 / ✚需补充）
const SLICEDEF = [
  ["order_fulfillment_360 ✓", "Order", "Order→Model [order_for_model ✓] · Model→Base [model_producible_at ✓] · Base←Line [line_belongs_to_base ✓] · Line→Process [line_has_process ✓] · Process←Equipment [equip_used_in ✓] · Model→Material [model_uses_material ✓] · Order→Customer [order_of_customer ✓]", "6（全部边已存在，开箱即用）"],
  ["product_ramp_5d ✚", "Model", "Model→Base→Line→Process(✓) · Process←Equipment(✓) · Model→Material(✓) · Model→Certification [model_has_cert ✚]", "5（认证边需补）"],
  ["order_commercial_5d ✚", "Order", "Order→Customer(✓)→ARInvoice [customer_has_invoice ✚] · Order→Model→Material(✓) · Model→Base→Line→Process(✓)", "5（应收边需补）"],
  ["order_to_cash_720 ✚", "Order", "Order→Customer→ARInvoice(✚) · Order→Model→Base→Line→Process←Equipment(✓) · Model→Material→PurchaseOrder [material_supplied_by_po ✚] · Base→Shipment [base_has_shipment ✚] · Order→PlanTarget [order_to_plantarget ✚]", "8（需补 4 边）"],
  ["supply_disruption_8d ✚", "Material", "Material→MaterialBatch [material_has_batch ✚] · Material→PurchaseOrder(✚) · Material←Model→Base→Line→Process←Equipment(✓) · Order→Customer(✓) · Base→Shipment(✚) · Base→MaintPlan [base_maint_plan ✚]", "8（需补 4 边）"],
  ["quarterly_gap_8d ✚", "PlanTarget", "PlanTarget←Order [order_to_plantarget ✚] · Order→Model→Base→Line→Process←Equipment(✓) · Model→Material(✓) · Base→Shipment(✚) · Order→Customer(✓)", "8（需补 2 边）"],
  ["carbon_passport_8d ✚", "Model", "Model→Material→CarbonFactor [material_carbon ✚] · Model→Base→EnergyMeter [base_energy_meter ✚] · Base→Line→Process←Equipment(✓) · Model→Certification(✚) · Order→Customer(✓) · (质量:碳数据健康) · (计划:碳预算)", "8（需补 3 边 + 质量/计划接点）"],
  ["data_trust_8d ✚", "DataSourceHealth", "Base→DataSourceHealth [base_data_health ✚] · Base→Line→Process←Equipment(✓ ts) · Model→Material(✓) · Base→Shipment(✚) · Order(✓)", "8（需补 2 边 + 扩数据源）"],
  ["aop_scenario_8d ✚", "AnnualScenario", "AnnualScenario→PlanTarget [scenario_to_target ✚] · AnnualScenario→CapexProject [scenario_to_capex ✚] · Model→Base→Line→Process(✓) · Model→Material(✓) · Order→Customer→ARInvoice(✚) · Base→Shipment(✚) · (财务:现金/IRR ✚无对象)", "8（需补 4 边 + 财务域对象）"],
  ["maint_oee_yield_8d ✚", "MaintPlan", "Base→MaintPlan [base_maint_plan ✚] · Line→Process←Equipment(✓ ts) · Model→ChangeoverMatrix [model_changeover ✚] · Model→Base(✓) · Model→Material(✓) · Base→Shipment(✚) · (质量:数据健康)", "8（需补 3 边）"],
];

// 缺口与补充建议（优先级 P0 阻断 / P1 重要 / P2 增强）
const GAPS = [
  ["P0", "链路边（本体）", "新增 13 条跨域链路边", "8 域切片所需边大多不存在；当前 8 边仅连通 6 域。补全：model_has_cert / customer_has_invoice / material_has_batch / material_supplied_by_po / material_carbon / base_has_shipment / base_energy_meter / base_data_health / base_maint_plan / model_changeover / order_to_plantarget / scenario_to_target / scenario_to_capex", "battery.ts batteryLinkTypes() + service.ts instantiateBattery() 边实例生成（仿 6 域切片做法，对象 FK 确定性派生）"],
  ["P0", "数据域注册", "补注册 supply / commercial 两域", "Material/MaterialBatch/PO/CarbonFactor 用 supply、Customer/ARInvoice 用 commercial，但域注册表只有 11 域不含这二者 → 治理域开关/分组/检索切面对其失效", "service.ts seedDomains() 增加 supply、commercial"],
  ["P0", "财务域对象", "新增 Finance 对象类型（现金流/IRR/资产）", "finance 域已注册但无任何对象类型；现金/IRR 仅存于 solver 参数 → AOP/order-to-cash 无法把财务纳入切片", "新增 ObjectType + 生成器 + 绑定（migrations/repo/synthetic 同步）"],
  ["P1", "规则发布缺口", "补建并发布 C01/C06/C09/C15/C16/C21/C22 等", "求解器代码/处置库引用这些规则键，但已发布规则只有 16 条 → 这些约束永不触发", "/a/v1/rules 创建+发布；补 scopeObjectTypes"],
  ["P1", "派生属性缺口", "补齐规则表达式引用但对象上不存在的属性", "如 Model.carbonFootprint(C33)/Material.devPct(C27)/Material.outsourceYield(C31)/Order.leadDays(C29)/Order.creditUsedRatio(C13)/Order.demandDelta(C03) → 规则扫描恒为空", "A4 派生 DSL 增列 + 重跑 runDerivations"],
  ["P1", "求解器编排", "新增跨域「对策组合/再平衡」meta-求解器或工作流编排", "S4/S5/S6 需多求解器联动求最优组合，现状只能逐个调用、靠人脑拼", "B2 Workflow 编排 + 可选 meta-solver（确定性）"],
  ["P1", "切片作为工具", "确认/补齐 resolve_slice 进 B 路径(Agent)与 A 路径(Workflow)工具白名单", "推演需 Agent/Workflow 先经切片检索；若 resolve_slice 非内置工具则场景无法真正经切片", "agentcore 工具注册 + 白名单 + 参数透传"],
  ["P2", "切片根选择器", "支持多根(filter)/全基地/时间旅行(asOf) 根选择", "现 root.selector 仅 byKey 单根；工业级需「整基地受影响单」「某季全部目标」「历史快照」批量根", "ontology-core executeSlice 增 filter 多根 + asOfEpoch"],
  ["P2", "时序作为切片/节点", "ts(OEE/良率/产出)接入切片与工作流节点", "S8/S10 强依赖 ts 新鲜度与趋势，但切片只走对象/链路，ts 仅在求解器内部取", "query_timeseries_agg 作为工作流节点 + 切片旁路 ts 投影"],
  ["P2", "工业级数据补充", "扩充稀疏域数据量到工业级", "DataSourceHealth 仅 1 行、Segment 3、Certification 18、CapexProject 3 → 不足以支撑 S6/S8/S9 工业级测试；建议 数据源≥20、认证≥120、情景投资项目≥10", "battery-extended.ts 生成器 XL 档放大 + 戏剧点植入"],
  ["P2", "ScenarioTrigger 扫描", "把 ScenarioTrigger.expr 接入 RULE_SCAN 周期求值", "4 条触发条件仅挂牌，expr 未被周期引擎对 metrics 求值 → S6 季度缺口触发不自动", "scheduler RULE_SCAN 扩展 metrics 上下文"],
];

// ===========================================================================
const mainHdr = ["编号", "场景名称", "推演类型（复杂度）", "本体切片", "跨域路径（数据域链）", "跨域数", "关键数据量（工业级）", "驱动方式", "智能体/工作流配置（skills·约束·规则 / 节点）", "预期推演结论", "主要缺口（需补充）"];
const mainRows = [
  row([cell("10 个工业级复杂推演场景清单（黄=跨5域 · 绿=跨8域）", "title")]),
  row([cell("说明：✓=当前已具备开箱即用；✚=需补充（见『缺口与补充建议』表）。目标=跑通工业级测试 + 补数据 + 找缺口。", "k")]),
  row(mainHdr.map((h) => cell(h, "hdr")), 30),
];
for (const s of SCEN) {
  const ds = s.nd >= 8 ? "d8" : "d5";
  mainRows.push(row([
    cell(s.no, "k"), cell(s.name, "k"), cell(s.kind), cell(s.slice, ds),
    cell(s.domains, ds), cell(s.nd, ds), cell(s.data), cell(s.drive),
    cell(s.cfg), cell(s.out), cell(s.gap, "gap"),
  ]));
}

const sliceHdr = ["切片 key", "根类型 root", "跨域路径（hops · ✓存在/✚需补充）", "跨域数 / 边缺口"];
const sliceRows = [
  row([cell("本体切片与跨域路径明细", "title")]),
  row([cell("每条 hop 标注链路边及是否已存在；✚ 边需在 battery.ts/service.ts 补充（仿 order_fulfillment_360 的对象 FK 确定性派生）。", "k")]),
  row(sliceHdr.map((h) => cell(h, "hdr")), 30),
  ...SLICEDEF.map(([k, root, path, nd]) => row([cell(k, "k"), cell(root), cell(path), cell(nd, k.includes("✓") ? "ok" : "d8")])),
];

const gapHdr = ["优先级", "类别", "缺口/补充项", "为什么（影响哪些场景）", "落点（改哪里）"];
const gapRows = [
  row([cell("缺口与补充建议汇总（按优先级）", "title")]),
  row([cell("P0=阻断 8 域切片/治理 · P1=影响推演正确性/完整性 · P2=工业级规模与体验增强。", "k")]),
  row(gapHdr.map((h) => cell(h, "hdr")), 30),
  ...GAPS.map((g) => row(g.map((c, i) => cell(c, i === 0 ? "k" : i === 2 ? "gap" : undefined)))),
];

const ovRows = [
  row([cell("工业级推演测试方案 · 10 复杂场景（含跨域本体切片 / 数据量 / 智能体或工作流 / 缺口）", "title")]),
  row([cell("")]),
  row([cell("目标", "k"), cell("用 10 个复杂（非 demo）推演场景把系统跑通工业级测试，补充工业级数据，定位需补充的模块与缺失功能。")]),
  row([cell("跨域要求达成", "k"), cell("跨 5 域场景 3 个（S2/S3 + S1 实为 6 域）；跨 8 域场景 7 个（S4–S10）。满足『≥3 个跨5域、≥5 个跨8域』。")]),
  row([cell("借鉴", "k"), cell("原型 docs/demo-推演系统.html 的推演模块：产能推演/项目推演/规划体检/年度情景/季度滚动/瓶颈矩阵。")]),
  row([cell("")]),
  row([cell("当前系统实查（2026-06）", "h2")]),
  row([cell("注册数据域", "k"), cell("11：factory/product/process/equip/quality/capacity/forecast/people/plan/finance/unassigned（⚠ 对象已用 supply/commercial 两域却未注册 → P0 缺口）")]),
  row([cell("链路边", "k"), cell("8：order_for_model / order_of_customer / model_producible_at / model_certified_on / line_belongs_to_base / line_has_process / equip_used_in / model_uses_material → 当前最大连通切片 = order_fulfillment_360（6 域）")]),
  row([cell("求解器", "k"), cell("21：capacity_rollup/capacity_forecast/bottleneck_matrix/risk_timeline/affected_orders/plan_audit/plan_generate/capex_scenario + mitigation_select/cert_schedule/kit_readiness/lta_gap/inventory_optimize/changeover_sequence/yield_diagnosis/maintenance_stagger/outsourcing_split/quote_margin/credit_exposure/quarterly_gap/carbon_footprint")]),
  row([cell("Skills", "k"), cell("20：s01–s20（订单可承接/受影响订单/根因/体检/方案比选/处置/认证/齐套/长协/库存/换型/良率/检修/外协/毛利/信用/投资/S&OP/季度缺口/碳足迹）")]),
  row([cell("已发布规则", "k"), cell("16（C01–C33 子集：C03/C05/C08/C12/C13/C18/C23/C26–C33 等；⚠ C01/C06/C09/C15/C16/C21/C22 被代码引用却未发布 → P1 缺口）")]),
  row([cell("工业级数据(XL)", "k"), cell("订单 10,060 · 物料批次 2,000 · 采购单 3,000 · 客户 60 · 对象 17,820 · 链路 20,208 · 时序点 61,320 + livedIn 一年回放")]),
  row([cell("")]),
  row([cell("本工作簿表", "h2")]),
  row([cell("① 10 场景清单", "k"), cell("每场景：名称 / 切片 / 跨域路径 / 跨域数 / 数据量 / 驱动(Agent或Workflow) / 配置 / 结论 / 缺口")]),
  row([cell("② 本体切片与跨域路径", "k"), cell("每切片 root + 逐 hop 链路边（✓存在/✚需补充）")]),
  row([cell("③ 缺口与补充建议", "k"), cell("按 P0/P1/P2 汇总：改哪里、为什么、影响哪些场景")]),
];

const xml = wb([
  sheet("总览", [60, 520], ovRows),
  sheet("① 10 场景清单", [44, 150, 150, 130, 200, 44, 230, 110, 320, 230, 240], mainRows),
  sheet("② 本体切片与跨域路径", [160, 90, 520, 130], sliceRows),
  sheet("③ 缺口与补充建议", [54, 100, 200, 320, 230], gapRows),
]);

const outDir = join(ROOT, "deliverables");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "工业级推演测试方案-10场景.xls");
writeFileSync(outPath, "﻿" + xml, "utf8");
console.log("✅ 已导出:", outPath);
console.log(`   场景 ${SCEN.length}（跨5域 ${SCEN.filter((s) => s.nd === 5).length} · 跨6域 ${SCEN.filter((s) => s.nd === 6).length} · 跨8域 ${SCEN.filter((s) => s.nd === 8).length}）· 切片 ${SLICEDEF.length} · 缺口 ${GAPS.length}`);
