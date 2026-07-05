/**
 * 锂电产销运营 20 场景目录（PRD-catalog-battery-20-scenarios §1，裁决 #26）。
 *
 * 本表是所有派生物（意图/场景入口/评测用例/启动器卡片）的**单一来源**。§9 场景启动器
 * 经 GET /b/v1/scenarios 下发本表（非前端硬编码）；每卡带 presetContext 保证"一键可推演"。
 */

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
  card("S03", "风险越线根因", "risk", "risk_root_cause", "常州物料齐套为什么这天越线？", "risk_timeline", ["C06", "C11"], "COMPUTE", "解释风险越线的根因与时序", [B("changzhou", "常州")], { baseId: "changzhou", factor: "物料齐套" }),
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
 * 启动期幂等 upsert（PRD §3.2）。mode 默认 WORKFLOW_FIRST（§3.2 语义收敛）。
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
    mode: "WORKFLOW_FIRST",
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
    targetView: "decision-scenarios",
    intentKey: s.key,
    triggerQuestion: s.question,
    solver: s.answer.solverKey ?? "",
    rules: [],
    riskLevel: "COMPUTE",
    summary: s.title,
    mode: "WORKFLOW_FIRST",
    presetContext: { targetView: "decision-scenarios", selectedObjects: [], slotPresets: s.answer.args ?? {} },
    status: "PUBLISHED",
    version: 1,
  };
}
