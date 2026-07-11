/**
 * 锂电产销运营 20 场景目录（PRD-catalog-battery-20-scenarios §1，裁决 #26）。
 *
 * 本表是所有派生物（意图/场景入口/评测用例/启动器卡片）的**单一来源**。§9 场景启动器
 * 经 GET /b/v1/scenarios 下发本表（非前端硬编码）；每卡带 presetContext 保证"一键可推演"。
 */

import { intentModeFor } from "./intents/intent-mode.js";

export type RiskLevel = "COMPUTE" | "ACTION_DRAFT";

export interface ScenarioCard {
  sNo: string; // S01..S20
  name: string;
  view: string; // targetView
  intentKey: string;
  triggerQuestion: string;
  solver: string;
  /** ✓=已有规格复用；＋=20 场景目录 §2 新增（尚在分阶段建设）。 */
  solverStatus: "REUSED" | "NEW";
  rules: string[];
  riskLevel: RiskLevel;
  /** 一句话说明（取对应 skill summary 能力句）。 */
  summary: string;
  /** §9 presetContext：保证打开即可推演、不被反问槽位。 */
  presetContext: { targetView: string; selectedObjects: { objectType: string; objectId: string; label?: string }[]; slotPresets: Record<string, unknown> };
}

const REUSED = new Set(["S01", "S02", "S03", "S04", "S05", "S17", "S18"]);

function card(
  sNo: string,
  name: string,
  view: string,
  intentKey: string,
  triggerQuestion: string,
  solver: string,
  rules: string[],
  riskLevel: RiskLevel,
  summary: string,
  selectedObjects: ScenarioCard["presetContext"]["selectedObjects"],
  slotPresets: Record<string, unknown>,
): ScenarioCard {
  return {
    sNo,
    name,
    view,
    intentKey,
    triggerQuestion,
    solver,
    solverStatus: REUSED.has(sNo) ? "REUSED" : "NEW",
    rules,
    riskLevel,
    summary,
    presetContext: { targetView: view, selectedObjects, slotPresets },
  };
}

const M = (id: string, label: string) => ({ objectType: "Model", objectId: id, label });
const B = (id: string, label: string) => ({ objectType: "Base", objectId: id, label });

export const SCENARIO_CATALOG: ScenarioCard[] = [
  card("S01", "订单可承接性评审", "project", "capacity_feasibility", "4680-NCM 加 20% 六周能不能接？", "capacity_forecast", ["C01", "C02", "C03", "C09"], "COMPUTE", "解读产能可承接结论的口径", [M("4680-NCM", "4680-NCM")], { modelId: "4680-NCM", demandDelta: 0.2, weeks: 6 }),
  card("S02", "交期风险与受影响订单", "risk", "affected_orders", "常州基地影响哪些订单？", "affected_orders", ["C05"], "COMPUTE", "解读交期风险扫描结果", [B("changzhou", "常州")], { baseId: "changzhou" }),
  // UPG-L0-COVERAGE-FILL / CLASSIFY-FUSE 返工：S03「常州物料齐套为什么这天越线」原痛点问句改由 path-A 通用
  // causal_attribution 求解器作答（此前 risk_timeline 只出张力时序·不量化根因主驱动；且 risk_root_cause 曾 AGENT_FIRST
  // 无 LLM 恒 Path B FAILED）。slotPresets 从 {baseId,factor:"物料齐套"} 映射为 causal_attribution 真实入参：
  // 物料齐套=物料保障率 Metric（actual<floorVal 判越线）沿 MaterialBalance.gapTon 真证据字段按 material 量化根因主驱动物料。
  card("S03", "风险越线根因", "risk", "risk_root_cause", "常州物料齐套为什么这天越线？", "causal_attribution", ["C06", "C16"], "COMPUTE", "解释物料齐套越线的通用因果归因链（根因主驱动物料）", [B("changzhou", "常州")], { targetType: "Metric", valueField: "actual", thresholdField: "floorVal", direction: "below", driverType: "MaterialBalance", evidenceField: "gapTon", groupField: "material" }),
  card("S04", "月度规划体检", "audit", "plan_audit_q", "现金垫 45 亿过得了体检吗？", "plan_audit", ["C15", "C16", "C18", "C21", "C23"], "COMPUTE", "解读规划体检结论", [], { cashCushion: 4_500_000_000 }),
  // LAUNCHER-GROUNDED-QUESTIONS（Part A·PRD §3 S05 处置）：抽象问句「推荐哪个经营方案？」无具象锚点、用户点名——
  // 改具象决策问（保毛利 vs 保规模 + 管理动作），使卡面即"确实可答的具象决策"。
  card("S05", "经营方案比选", "generate", "plan_recommend", "保毛利还是保规模？给 3 个经营方案比选 + 各自的管理动作", "plan_generate", ["C08", "C15", "C18"], "COMPUTE", "解读三方案比选", [], {}),
  card("S06", "处置方案采纳", "risk", "adopt_mitigation", "采纳常州的三班制方案", "mitigation_select", ["C08", "C10"], "ACTION_DRAFT", "协助采纳风险处置方案", [B("changzhou", "常州")], { baseName: "常州", factor: "物料齐套", solutionName: "三班制" }),
  card("S07", "产线认证排期", "project", "cert_scheduling", "待认证的型号怎么排认证顺序？", "cert_schedule", ["C04", "C26"], "COMPUTE", "解读认证排期建议", [], { horizonWeeks: 12 }),
  card("S08", "物料齐套分析", "risk", "kit_analysis", "下周哪些订单缺料开不了工？", "kit_readiness", ["C06", "C16"], "COMPUTE", "解读齐套分析", [], { fromDay: 1, toDay: 14 }),
  card("S09", "长协执行与补缺", "dash", "lta_gap_q", "7 月正极长协覆盖够吗？缺口怎么补？", "lta_gap", ["C16", "C27"], "COMPUTE", "解读长协覆盖与补缺", [], { material: "三元正极", month: "2026-07" }),
  card("S10", "库存水位优化", "dash", "inventory_opt", "哪些物料超储/欠储？能释放多少资金？", "inventory_optimize", ["C16", "C28"], "COMPUTE", "解读库存优化清单", [], {}),
  card("S11", "换型排序优化", "project", "changeover_opt", "下周订单怎么排能少换型？", "changeover_sequence", ["C22", "C29"], "COMPUTE", "解读换型排序建议", [], { lineId: "常州·动力线-A", week: 1 }),
  card("S12", "良率波动诊断", "risk", "yield_diag", "涂布良率为什么掉了？", "yield_diagnosis", ["C30"], "COMPUTE", "解读良率波动诊断", [B("changzhou", "常州")], { processKey: "涂布", baseName: "常州" }),
  card("S13", "检修窗口错峰", "risk", "maint_stagger", "检修计划和交付高峰撞了怎么调？", "maintenance_stagger", ["C11"], "COMPUTE", "解读检修错峰建议", [], {}),
  card("S14", "外协决策", "generate", "outsourcing_q", "缺口 8 万套自产加班还是外协？", "outsourcing_split", ["C08", "C31"], "COMPUTE", "解读外协分配方案", [], { gap: 80000, weeks: 6 }),
  card("S15", "接单毛利评审", "dash", "quote_margin_q", "电网公司 F 这单毛利过线吗？", "quote_margin", ["C15", "C24"], "COMPUTE", "解读接单毛利评审", [], { custName: "电网公司F" }),
  card("S16", "客户信用风险", "dash", "credit_check", "商用车集团 G 还能接新单吗？", "credit_exposure", ["C13", "C32"], "COMPUTE", "解读客户信用判定", [], { custName: "商用车集团G" }),
  card("S17", "产能投资评审", "generate", "capex_review", "枣庄储能线值得投吗？", "capex_scenario", ["C18", "C23"], "COMPUTE", "解读产能投资评审", [], { scenario: "基准" }),
  card("S18", "S&OP 月度平衡", "sop", "sop_status", "本月产销平衡到哪一步了？", "sop_balance", ["C18", "C21", "C22"], "COMPUTE", "解读 S&OP 进度与平衡状态", [], {}),
  card("S19", "季度缺口对策", "quarter", "quarterly_gap_q", "Q2 缺口用什么组合补？", "quarterly_gap", ["C08", "C29"], "COMPUTE", "解读季度缺口对策组合", [], { quarter: "2026Q2" }),
  card("S20", "碳足迹核算", "dash", "carbon_q", "4680-NCM 出口欧盟的碳足迹达标吗？", "carbon_footprint", ["C33"], "COMPUTE", "解读碳足迹核算", [M("4680-NCM", "4680-NCM")], { modelId: "4680-NCM", baseName: "成都" }),
  // CORE-NL-SOLVER-ROUTING（本体 §8 MULTISRC-FUSION/QUERY30-ORCH/GAP-SCENE-C 共性根）：5 个**通用多跳求解器**
  // 早已在 datacore solver-registry 注册（route=graph·真读对象图·确定性 R6），但 S01–S20 无一指向它们 →
  // 复杂 NL 问句（「哪些断供影响最大」「隐性集中度」「毛利倒挂根因」「多源打架仲裁」「共享瓶颈」）路由零命中、
  // 落诚实缺口/OTHER。下 5 卡把它们接进目录单一来源 → seed 派生循环自动生成意图+计划（invoke_solver 指向该 solver）
  // + solver_summary 按 SOLVER_RENDER_BINDINGS 投影真实输出字段 → 路径A 可作答（非 OTHER 非缺口）。
  // slotPresets = 该求解器**真实入参**（对象类型/字段/路径·对真 DataCore 合法；mock 侧 MOCK_SOLVER_OUTPUTS 同形状回值）。
  card("S21", "共享瓶颈争用", "risk", "shared_bottleneck_q", "多条产线抢同一个瓶颈资源，谁被挤最狠？", "shared_bottleneck", ["C02", "C09"], "COMPUTE", "解读共享资源瓶颈争用与降级", [B("changzhou", "常州")], { resourceType: "Base", sharedByType: "Line", viaField: "baseId", capacityField: "formationCapDaily", demandField: "capacityDaily" }),
  card("S22", "隐性集中度", "risk", "concentration_risk_q", "有没有多个订单隐性集中依赖同一个型号/根节点？", "concentration_risk", ["C16", "C27"], "COMPUTE", "解读隐性集中单点敞口", [], { startType: "Order", path: [{ viaField: "model", toType: "Model" }] }),
  card("S23", "毛利倒挂根因", "dash", "margin_attribution_q", "哪些订单毛利倒挂？根因主驱动是哪个成本项？", "margin_attribution", ["C15", "C24"], "COMPUTE", "解读毛利倒挂根因归因", [], { targetType: "Order", costFields: [{ field: "unitPrice", label: "单价" }] }),
  card("S24", "断供影响半径", "risk", "supplier_disruption_q", "哪些供应商断供影响最大？影响半径覆盖到谁？", "supplier_disruption_radius", ["C05", "C16"], "COMPUTE", "解读断供影响半径与受累对象", [B("changzhou", "常州")], { rootType: "Base", rootId: "changzhou", layers: [{ type: "Line", viaField: "baseId" }, { type: "Process", viaField: "lineId" }, { type: "Equipment", viaField: "processId" }] }),
  // S25 slotPresets = multisource_fusion 真实入参，指向 SEED_DEMO 播的多源同事实夹具（ErpOrder/MesOrder/SrmOrder·
  // 见 datacore seedDemoMultiSourceFusion）。同一订单号（SO-3391 等）跨三源：ERP 计划交期偏早 / MES 现场实际偏晚（更权威）
  // / SRM 供方确认产能——role=order 归一后按 pk 归并。fields=[due(交期·仲裁维), cap(产能·测谎维)]：due 冲突走 AUTHORITY
  // （MES authority=3 最高→采实际交期）；cap 三源（ERP/SRM 相近·MES 虚高）→ 测谎命中 SUSPECT·审慎取最保守值不照单全收。
  // 三源而非两源：两源无法定中位判谁虚报，三源方能揪出 MES 离群（诚实测谎前提）。
  card("S25", "多源数据仲裁", "dash", "multisource_fusion_q", "多源数据打架时按什么口径仲裁？有没有测谎命中的可疑源？", "multisource_fusion", ["C05", "C16"], "COMPUTE", "解读多源融合仲裁与测谎", [], { role: "order", fields: ["due", "cap"], sources: [{ sourceLabel: "ERP", typeKey: "ErpOrder", authority: 1, asOfField: "asOf" }, { sourceLabel: "MES", typeKey: "MesOrder", authority: 3, asOfField: "asOf" }, { sourceLabel: "SRM", typeKey: "SrmOrder", authority: 2, asOfField: "asOf" }], defaultStrategy: "AUTHORITY", suspectThreshold: 0.15 }),
  // QUERY30 缺口③ Q01 样板（DESIGN-query30 §2.5·解 R3 电池卡·9洞共性根）：接单挤占推演 NL 入 QOS 场景路由。
  // 意图键 what_if_displacement_q 已在 seed 注册一等意图+计划（接单全链推演 workflow：what_if_displacement→multi_plan_compare）；
  // 本卡把 Q01 样板问句接进启动器目录单一来源 → GET /b/v1/scenarios 下发 + NL 分类命中该意图 → 路径A 真跑真求解器。
  // qty=5000 为**出厂场景默认值**（4680-NCM 一批常规接单问询量）。⛔ 不手喂大数造挤占（Q30-P1 re-scope·用户批准 2026-07-09·commit 54316bd）：
  // 常州自由日产能远大于该急单日需（dailyDemand≈120 «« 自由日产能）→ feasibleWithoutDisplacement=true·displacedCount=0。
  // 这**本就是真实答案**（「自由产能足量承接·无需挤占」是诚实结果·非失败非编造）；返工#2 曾把 qty 抬到 520000 强逼挤占 = 逼 dev 造假 = 已按 rescope 撤销。
  // 挤占机器真实性由 C7 独立在「真有紧约束的真场景」上验证（非在此卡手喂大单）：demo 真种子里 hefei 基地 4680-NCM 自由日产能=0（真紧约束），
  // 把本卡 baseId 槽切到 hefei（默认 qty=5000·出厂量·非手喂）即真挤占 SO-3415（中·位移 42 天·3 个互异再方案）——机器非死代码、真种子可复现（证据 docs/evidence/QUERY30-Q01-P1-multi-plan-fde.md）。
  card("S26", "接单挤占推演", "project", "what_if_displacement_q", "4680-NCM 加 20% 六周插进来能不能接·会挤占哪些单·有哪些方案？", "what_if_displacement", ["C34", "C35"], "COMPUTE", "解读接单挤占推演与多方案比较", [M("4680-NCM", "4680-NCM"), B("changzhou", "常州")], { model: "4680-NCM", qty: 5000, advancePct: 0.2, weeks: 6, baseId: "changzhou" }),
  // UPG-L0-COVERAGE-FILL（PRD-upstream §5.2·治「全表无通用因果归因 path-A 求解器」·补高频未覆盖类目 general_causal_attribution）：
  // 「为什么 X 恶化/越线」通用因果归因经 QOS NL 路由命中本卡 → 路径A 工作流 → causal_attribution 真求解器（读真对象图·
  // 每个归因数溯源真字段），不再静默落 Path B。slotPresets = 求解器真实入参（Metric.actual<floorVal 判越线，
  // 沿 MaterialBalance.gapTon 真证据字段量化根因主驱动物料·对真 DataCore 合法）。WORKFLOW_FIRST（价值在「越线多少/根因是谁」承载数据）。
  card("S27", "指标越线根因归因", "dash", "causal_attribution_q", "为什么这项经营指标越线恶化？根因主驱动是哪个？", "causal_attribution", ["C16"], "COMPUTE", "解读指标越线的通用因果归因链", [], { targetType: "Metric", valueField: "actual", thresholdField: "floorVal", direction: "below", driverType: "MaterialBalance", evidenceField: "gapTon", groupField: "material" }),
  // Q30-P2 求解器横铺 A（DESIGN-query30 §1 P2 行·复用现有机器·非从零）：3 张场景卡把 3 个复用求解器接进目录单一来源
  // → seed 派生循环自动生成意图+计划（invoke_solver 指向该 solver）+ solver_summary 按 SOLVER_RENDER_BINDINGS 投影真实输出字段
  // → 路径A 可作答（WORKFLOW_FIRST·价值在承载数据表）。slotPresets = 该求解器**真实入参**（对真 DataCore SEED_DEMO 合法）。
  //
  // S28 CAPEX 方案比选：复用 capex_scenario（多套产能建设方案各测算 IRR/util24/C23 后聚合择优）。slotPresets=同一需求曲线 + 两套方案（小步快跑/一步到位）。
  card("S28", "CAPEX 方案比选", "generate", "capex_alternatives_q", "枣庄储能线有几套投资方案，哪套 IRR 和回报最优？", "capex_alternatives", ["C18", "C23"], "COMPUTE", "解读 CAPEX 多方案比选与推荐", [], { scenarioKey: "枣庄储能线", demand: [50, 48, 49, 51], s0: [45, 45, 45, 45], alternatives: [{ key: "A", label: "小步快跑", projects: [{ id: "A1", q0: 1, cap: 4, capex: [3, 5], m: 1800, salvageRate: 0.05, lifeQuarters: 40 }] }, { key: "B", label: "一步到位", projects: [{ id: "B1", q0: 0, cap: 8, capex: [6, 4], m: 1800, salvageRate: 0.05, lifeQuarters: 40 }] }] }),
  // S29 全成本卷积：复用 capacity_rollup + finance_pnl（产能→成本→损益）。无入参（读 Base 产能 + FinancePlan 财务对象）。
  card("S29", "全成本卷积", "dash", "full_cost_rollup_q", "把产能卷到成本再到损益，全成本口径下经营态势如何？", "full_cost_rollup", ["C15", "C18"], "COMPUTE", "解读全成本卷积（产能→成本→损益）", [], {}),
  // S30 信号图传导：复用 supplier_disruption_radius 的反向多跳 BFS。slotPresets=常州基地沿 Line→Process→Equipment 产线图传导（对 SEED_DEMO 真图合法）。
  card("S30", "信号图传导", "risk", "signal_propagation_q", "某个信号从常州基地沿产线图传导，会扩散到哪些工序设备？", "signal_propagation", ["C05", "C16"], "COMPUTE", "解读信号沿供应链/产线图的传导半径与受影响集", [B("changzhou", "常州")], { signal: "产能扰动", rootType: "Base", rootId: "changzhou", layers: [{ type: "Line", viaField: "baseId" }, { type: "Process", viaField: "lineId" }, { type: "Equipment", viaField: "processId" }] }),
  // Q30-P3 求解器横铺 B（新域·中成本·DESIGN-query30 §1 P3 行）：5 张场景卡把 3 新域 + 2 复用类接进目录单一来源
  // → seed 派生循环自动生成意图+计划（invoke_solver 指向该 solver）+ solver_summary 按 SOLVER_RENDER_BINDINGS 投影真实输出字段
  // → 路径A 可作答（WORKFLOW_FIRST·价值在承载数据表）。slotPresets = 该求解器**真实入参**（对真 DataCore SEED_DEMO 合法）。
  //
  // S31 现金流投影：真读 FinanceAccount 期初现金 + Order 营收/交期/毛利 + Customer 账期 → 逐周现金曲线 + 13 周安全垫。无需具象锚点。
  card("S31", "现金流投影", "dash", "cash_projection_q", "未来 13 周现金流怎么走？现金安全垫最低到多少、哪一周最紧张？", "cash_projection", ["C18"], "COMPUTE", "解读现金流投影与安全垫最低点", [], { horizonWeeks: 13 }),
  // S32 人力平衡：真读 LaborShift 编制/班次 + Order 派线需求 → 逐线配工与缺口。laborPerWan 系估算参数（PARTIAL·不冒充实测）。
  card("S32", "人力平衡", "risk", "labor_balance_q", "各产线人力配得过来吗？哪些线欠配、缺多少人·班？", "labor_balance", ["C41"], "COMPUTE", "解读逐线配工与人力缺口", [], {}),
  // S33 能耗成本排程：真读 EnergyMeter 单耗/电网因子 + Order 需求 → 能耗/碳排逐周排程。⚠ SEED 无分时电价→tariff 经 slotPresets 由调用方(规划者)显式提供（非冒充种子真值·求解器 note 标注来源）；缺失则成本诚实空缺。
  card("S33", "能耗成本排程", "dash", "energy_cost_schedule_q", "各基地能耗和碳排怎么排？按分时电价这一周期的电费成本多少？", "energy_cost_schedule", ["C44"], "COMPUTE", "解读能耗/碳排逐周排程与分时电价成本", [], { horizonWeeks: 4, tariff: { peak: 1.2, flat: 0.7, valley: 0.35, shares: { peak: 0.3, flat: 0.4, valley: 0.3 } } }),
  // S34 改道决策：复用 min_cost_flow（真调 CP-SAT）。断供/停线产线（常州线）产量改道到能产同型号且有余量的候选线，最小成本流分配·arc 成本=真换型分钟。
  card("S34", "改道决策", "risk", "reroute_decision_q", "常州这条产线停了，产量改道到哪几条线总成本最低？", "reroute_decision", ["C05", "C22"], "COMPUTE", "解读断供改道最小成本流分配", [B("changzhou", "常州")], { lineId: "LINE-changzhou" }),
  // S35 多约束联合排产：复用排产族三子求解器（真调 sequencing_optimize + changeover_sequence + cert_schedule 联合解·非各自为战）。
  card("S35", "多约束联合排产", "project", "multi_constraint_schedule_q", "这批订单怎么排，既排序最优、又少换型、又不违认证就绪？", "multi_constraint_schedule", ["C22", "C26", "C29"], "COMPUTE", "解读排序+换型+认证三约束联合排产", [], { jobType: "Order", groupField: "model" }),
  // Q30-P4 跨求解器编排层（治 countermeasure 诈账根）：对策组合编排——空 slotPresets（不手喂合成杠杆·datacore 编排层
  // 真调 cert_schedule/changeover_sequence/outsourcing_split/capex_scenario 建真 gap 释放账本），求最小成本闭合缺口 + 三选二权衡。
  card("S36", "对策组合编排", "plan", "countermeasure_combo_q", "保交付/保毛利/保信用三选二，杠杆组合怎么排？", "countermeasure_combo", ["C08", "C23", "C29"], "COMPUTE", "解读跨求解器编排的最小成本杠杆组合与保交付/毛利/信用三选二权衡", [], {}),
  // Q30-P5 发育层（DESIGN-query30 §2.5·闭 G-9）：7 workflow 多步链的其余 6 条场景卡（Q01 接单全链=S26 已上）。
  // 每卡的执行计划=串起 2 个已交付求解器的多步链（见 seed.ts CHAIN_WORKFLOWS·s1→s2→render 各投真实字段+烘焙规则），
  // 经 growScenario 三环长成（PROVISIONAL 起·发育 run 留痕·非手装 GOVERNED·闭 G-9）。card.solver=链入口求解器（s1·∈注册表）。
  // slotPresets 复用既有单求解器卡的**已验证真实入参**（对 SEED_DEMO 合法·非手喂合成）。
  card("S37", "现金流预警对策链", "dash", "cash_alert_combo_chain", "未来 13 周现金流哪周最紧张？安全垫击穿了用什么杠杆组合来补缺口？", "cash_projection", ["C18"], "COMPUTE", "解读现金流投影安全垫最低点 + 缺口对策组合联动的资金预警链", [], { horizonWeeks: 13 }),
  card("S38", "断供改道决策链", "risk", "disruption_reroute_chain", "常州基地断供会波及哪些产线？停线产量改道到哪几条线总成本最低？", "supplier_disruption_radius", ["C05", "C16", "C22"], "COMPUTE", "解读断供影响半径 + 停线产量最小成本流改道的供应链应急链", [B("changzhou", "常州")], { rootType: "Base", rootId: "changzhou", layers: [{ type: "Line", viaField: "baseId" }, { type: "Process", viaField: "lineId" }, { type: "Equipment", viaField: "processId" }] }),
  card("S39", "齐套排产联检链", "project", "kit_schedule_chain", "先看下周订单物料齐套，再按排序+换型+认证三约束联合排产，这批订单怎么排？", "kit_readiness", ["C06", "C22", "C26"], "COMPUTE", "解读物料齐套就绪 + 三约束联合排产的齐套-排产联检链", [], { fromDay: 1, toDay: 14 }),
  card("S40", "全成本毛利倒挂链", "dash", "fullcost_margin_chain", "全成本口径下经营态势如何？哪些订单毛利倒挂、根因主驱动是哪个成本项？", "full_cost_rollup", ["C15", "C18", "C24"], "COMPUTE", "解读全成本卷积（产能→成本→损益）+ 订单毛利倒挂根因归因链", [], {}),
  card("S41", "信号传导集中度链", "risk", "signal_concentration_chain", "某信号从常州基地沿产线图传导会扩散到哪些工序设备？有没有隐性集中依赖同一根节点的单点敞口？", "signal_propagation", ["C05", "C16", "C27"], "COMPUTE", "解读信号沿产线图传导半径 + 隐性集中单点敞口的传导-集中度链", [B("changzhou", "常州")], { signal: "产能扰动", rootType: "Base", rootId: "changzhou", layers: [{ type: "Line", viaField: "baseId" }, { type: "Process", viaField: "lineId" }, { type: "Equipment", viaField: "processId" }] }),
  card("S42", "资本组合现金联检链", "generate", "capex_cash_chain", "在现金安全垫约束下，枣庄储能线的几套投资方案哪套 IRR 和回报最优？", "cash_projection", ["C18", "C23"], "COMPUTE", "解读现金安全垫约束 + CAPEX 多方案 IRR/回报比选的资本组合评审链", [], { horizonWeeks: 13 }),
];

export function scenarioByIntent(intentKey: string): ScenarioCard | undefined {
  return SCENARIO_CATALOG.find((s) => s.intentKey === intentKey);
}

const SEED_TENANT = "demo";
/** 域分组（启动器目录按域分组，§3.5-B）：targetView → 域名。 */
const VIEW_DOMAIN: Record<string, string> = {
  project: "产能与项目", risk: "风险与齐套", audit: "规划与平衡", generate: "规划与平衡",
  dash: "经营与财务", sop: "规划与平衡", quarter: "规划与平衡",
};

/**
 * 出厂场景目录 → 一等 Scenario（PUBLISHED）。SCENARIO_CATALOG 仍是出厂单一来源；
 * 启动期幂等 upsert（PRD §3.2）。
 *
 * WO MODE-DISPATCH-HONOR（审计簇⑦）：mode 不再一揽子 WORKFLOW_FIRST——从审核方钉死表
 * `intents/intent-mode.ts INTENT_MODE`（=MaterializedIntent.mode 的同一单一来源）按 intentKey 派生，
 * 使一等 Scenario 投影不再对 13/7 分派撒谎（yield_diag 等 7 个 agent-first 卡如实标 AGENT_FIRST）。
 */
export function scenarioFromCard(card: ScenarioCard, tenantId = SEED_TENANT): import("@platform/contracts").Scenario {
  return {
    id: `scn_${tenantId}_${card.sNo}`,
    tenantId,
    scenarioKey: card.sNo,
    name: card.name,
    domain: VIEW_DOMAIN[card.view] ?? card.view,
    targetView: card.view,
    intentKey: card.intentKey,
    triggerQuestion: card.triggerQuestion,
    solver: card.solver,
    rules: card.rules,
    riskLevel: card.riskLevel,
    summary: card.summary,
    mode: intentModeFor(card.intentKey),
    presetContext: {
      targetView: card.presetContext.targetView,
      selectedObjects: card.presetContext.selectedObjects,
      slotPresets: card.presetContext.slotPresets,
    },
    status: "PUBLISHED",
    version: 1,
  };
}

/** 出厂 20 场景的一等对象（demo 租户）——启动期幂等 upsert 用。 */
export function seedScenarios(tenantId = SEED_TENANT): import("@platform/contracts").Scenario[] {
  return SCENARIO_CATALOG.map((c) => scenarioFromCard(c, tenantId));
}

/**
 * SCENARIO-PACK-SCOPE（治启动器跨行业泄漏 · G-3 邻域）：把**非电池** IndustryPack 自带的决策场景卡
 * （`IndustryPack.scenarios`·IndustryScenario 形态）映射为一等 Scenario，供启动器目录按 pack 作用域下发。
 *
 * SCENARIO_CATALOG（上表 20 张）是**电池行业专属**的启动器来源（消费自 batteryPack 语义，字节不变 R6）；
 * 换行业则**消费该行业 pack 自带的 scenarios**（不重建）：logistics-warehouse → logisticsPack.scenarios。
 * 电池 pack `scenarios=[]`（走既有推演视图），故电池租户仍走 SCENARIO_CATALOG（seedScenarios）——零变更。
 * targetView 落 pack 物化的「决策场景」视图（datacore VIEW_DEFS["decision-scenarios"]·config-driven）。
 */
export function scenarioFromPackScenario(
  s: import("@platform/contracts").IndustryScenario,
  tenantId: string,
): import("@platform/contracts").Scenario {
  return {
    id: `scn_${tenantId}_${s.key}`,
    tenantId,
    scenarioKey: s.key,
    name: s.title,
    domain: "决策场景",
    // WO-IMPORT-SCENARIO-LAUNCHER-WIRE：导入场景可携 targetView/selectedObjects/slotPresets（G3 解析真对象）→ 卡面一键推演。
    targetView: s.targetView ?? "decision-scenarios",
    intentKey: s.key,
    triggerQuestion: s.question,
    solver: s.answer.solverKey ?? "",
    rules: [],
    riskLevel: "COMPUTE",
    summary: s.title,
    mode: "WORKFLOW_FIRST",
    presetContext: {
      targetView: s.targetView ?? "decision-scenarios",
      selectedObjects: s.selectedObjects ?? [],
      slotPresets: s.slotPresets ?? s.answer.args ?? {},
    },
    status: "PUBLISHED",
    version: 1,
  };
}
