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
  card("S01", "订单可承接性评审", "project", "capacity_feasibility", "4680-NCM 加 20% 六周能不能接？", "capacity_forecast", ["C01", "C02", "C03", "C09"], "COMPUTE", "解读产能可承接结论的口径", [M("4680-NCM", "4680-NCM")], { model: "4680-NCM", demandDelta: 0.2, weeks: 6 }),
  card("S02", "交期风险与受影响订单", "risk", "affected_orders", "常州基地影响哪些订单？", "affected_orders", ["C05"], "COMPUTE", "解读交期风险扫描结果", [B("changzhou", "常州")], { base: "changzhou" }),
  card("S03", "风险越线根因", "risk", "risk_root_cause", "常州物料齐套为什么这天越线？", "risk_timeline", ["C06", "C11"], "COMPUTE", "解释风险越线的根因与时序", [B("changzhou", "常州")], { base: "changzhou" }),
  card("S04", "月度规划体检", "audit", "plan_audit_q", "现金垫 45 亿过得了体检吗？", "plan_audit", ["C15", "C16", "C18", "C21", "C23"], "COMPUTE", "解读规划体检结论", [], { cashCushion: 4_500_000_000 }),
  card("S05", "经营方案比选", "generate", "plan_recommend", "推荐哪个经营方案？", "plan_generate", ["C08", "C15", "C18"], "COMPUTE", "解读三方案比选", [], {}),
  card("S06", "处置方案采纳", "risk", "adopt_mitigation", "采纳常州的三班制方案", "mitigation_select", ["C08", "C10"], "ACTION_DRAFT", "协助采纳风险处置方案", [B("changzhou", "常州")], { base: "常州", factor: "物料齐套", solutionName: "三班制" }),
  card("S07", "产线认证排期", "project", "cert_scheduling", "待认证的型号怎么排认证顺序？", "cert_schedule", ["C04", "C26"], "COMPUTE", "解读认证排期建议", [], { horizonWeeks: 12 }),
  // ★ WO-DERIVED-INTENT-SLOT-DEAF §3.4 裁决（S08·无写死实体·**刻意不新增 base 槽**）：
  //   本卡没有写死实体，只有时间窗（fromDay/toDay）——这两个键会派生成槽，用户改窗口能生效。
  //   工单 §2.1 说的「问任何基地 → 全网口径」属实，但**修法不在 B 侧**：`kit_readiness` 全链
  //   **没有基地维**（`extended.ts deriveExtendedArgs.kit_readiness` 的 `orders` = `c.orders.slice(0,8)`，
  //   `catalog.ts` argHints 也只有 `orders`）。在 agentcore 侧凭空造一个求解器不认的 `base` 入参
  //   = 在 B 侧造第二套语义（正是 §3.1 禁止的），故不做；缺口见工单 §6 遗留缺口 ①。
  card("S08", "物料齐套分析", "risk", "kit_analysis", "下周哪些订单缺料开不了工？", "kit_readiness", ["C06", "C16"], "COMPUTE", "解读齐套分析", [], { fromDay: 1, toDay: 14 }),
  card("S09", "长协执行与补缺", "dash", "lta_gap_q", "7 月正极长协覆盖够吗？缺口怎么补？", "lta_gap", ["C16", "C27"], "COMPUTE", "解读长协覆盖与补缺", [], { material: "三元正极", month: "2026-07" }),
  card("S10", "库存水位优化", "dash", "inventory_opt", "哪些物料超储/欠储？能释放多少资金？", "inventory_optimize", ["C16", "C28"], "COMPUTE", "解读库存优化清单", [], {}),
  // ★ WO-DERIVED-INTENT-SLOT-DEAF §3.4 裁决（S11·② 改中性默认）：`lineId` 原写死 `"常州·动力线-A"`，
  //   而本卡问句「下周订单怎么排能少换型？」**不点名任何产线** —— 这个值不是卡的主语，是凭空钉上去的。
  //   证据（引擎半）：`changeover_sequence` 只把 lineId **原样回显**（`extended.ts deriveExtendedArgs`
  //   `lineId: str(args.lineId,"L1")`），排序用的 `orders` 取 `c.orders.slice(0,6)` **不按产线过滤** ——
  //   于是回显出的「常州·动力线-A」是一个**冒充作用域的标签**。改中性（空 = 未指定产线）：
  //   用户说了产线 → 槽把用户的值送到求解器；没说 → 诚实标未指定，而不是替他选一条线。
  card("S11", "换型排序优化", "project", "changeover_opt", "下周订单怎么排能少换型？", "changeover_sequence", ["C22", "C29"], "COMPUTE", "解读换型排序建议", [], { lineId: "", week: 1 }),
  // ★ WO-DERIVED-INTENT-SLOT-DEAF §3.4 裁决（S12·`processKey` ① 合理默认 / `base` ② 改中性默认）：
  //   `processKey:"涂布"` 是本卡问句的主语（「**涂布**良率为什么掉了？」）→ 保留。
  //   `base:"常州"` 不是（问句不点名基地），而且它连**读者都没有**：`deriveExtendedArgs.yield_diagnosis`
  //   读的是 `args.baseName`，`yieldDiagnosis` 本体只读 `series`/`events`（`extended.ts:210-217`，
  //   无 series 恒返 `dataMode:"EMPTY"`）—— 一个没人读、却在留痕里冒充作用域的死键。改中性（未指定）。
  //   ⚠ 引擎半遗留：`yield_diagnosis` 全链**没有基地维**（见工单 §6 遗留缺口 ②），越界不在本单修。
  card("S12", "良率波动诊断", "risk", "yield_diag", "涂布良率为什么掉了？", "yield_diagnosis", ["C30"], "COMPUTE", "解读良率波动诊断", [B("changzhou", "常州")], { processKey: "涂布", base: "" }),
  card("S13", "检修窗口错峰", "risk", "maint_stagger", "检修计划和交付高峰撞了怎么调？", "maintenance_stagger", ["C11"], "COMPUTE", "解读检修错峰建议", [], {}),
  card("S14", "外协决策", "generate", "outsourcing_q", "缺口 8 万套自产加班还是外协？", "outsourcing_split", ["C08", "C31"], "COMPUTE", "解读外协分配方案", [], { gap: 80000, weeks: 6 }),
  // ★ WO-DERIVED-INTENT-SLOT-DEAF §3.4 裁决（S15·① 合理默认·保留）：`custName:"电网公司F"` 正是本卡
  //   问句的主语（「**电网公司 F** 这单毛利过线吗？」），作为**本卡**的默认作用域合理；病不在这个值，
  //   在于它此前**独占** args（用户问别的客户也顶不掉）——那一半由本单的槽位+merge 治。
  //   ⚠ 如实更正工单 §2.1 的措辞：`quote_margin` **根本不读 custName**（`extended.ts:303-319` 只读
  //   price/bom/mfgRate/logistics/segmentFloor），所以「问别的客户毛利 → 拿到电网公司F 的毛利」不成立；
  //   真实形态是**任何客户都拿到同一份 BOM 口径毛利**（假个性化）——引擎半缺客户维，见工单 §6 遗留缺口 ③。
  card("S15", "接单毛利评审", "dash", "quote_margin_q", "电网公司 F 这单毛利过线吗？", "quote_margin", ["C15", "C24"], "COMPUTE", "解读接单毛利评审", [], { custName: "电网公司F" }),
  // ★ WO-DERIVED-INTENT-SLOT-DEAF §3.4 裁决（S16·① 合理默认·保留）：`custName:"商用车集团G"` 是本卡
  //   问句的主语（「**商用车集团 G** 还能接新单吗？」）。这是 16 张里**唯一**一个求解器真按该实参过滤的
  //   实体维（`credit_exposure`：匹配不到抛 `AMBIGUOUS_SCOPE`、未指定则 `scope:ALL` 全域合计，
  //   `extended.ts:498-527`），故也是本单差分门**输出层**断言的落点。
  card("S16", "客户信用风险", "dash", "credit_check", "商用车集团 G 还能接新单吗？", "credit_exposure", ["C13", "C32"], "COMPUTE", "解读客户信用判定", [], { custName: "商用车集团G" }),
  card("S17", "产能投资评审", "generate", "capex_review", "枣庄储能线值得投吗？", "capex_scenario", ["C18", "C23"], "COMPUTE", "解读产能投资评审", [], { scenario: "基准" }),
  card("S18", "S&OP 月度平衡", "sop", "sop_status", "本月产销平衡到哪一步了？", "sop_balance", ["C18", "C21", "C22"], "COMPUTE", "解读 S&OP 进度与平衡状态", [], {}),
  card("S19", "季度缺口对策", "quarter", "quarterly_gap_q", "Q2 缺口用什么组合补？", "quarterly_gap", ["C08", "C29"], "COMPUTE", "解读季度缺口对策组合", [], { quarter: "2026Q2" }),
  // ★ WO-DERIVED-INTENT-SLOT-DEAF §3.4 裁决（S20·`modelId` ① 合理默认 / `baseName` ② 改中性默认）：
  //   `modelId:"4680-NCM"` 是本卡问句的主语（「**4680-NCM** 出口欧盟的碳足迹达标吗？」）→ 保留。
  //   `baseName:"成都"` 不是（问句不点名基地），而 `carbon_footprint` **把 baseName 原样写进输出**
  //   （`extended.ts:398-421` 的返回体含 `baseName`），物料/能耗却取 `c` 全量、不按基地过滤 ——
  //   于是答案上印着「成都」，算的却是全网：**静默错答的教科书形态**。改中性（未指定）。
  //   ⚠ 引擎半遗留：`carbon_footprint` 无基地/型号维过滤（见工单 §6 遗留缺口 ④）。
  card("S20", "碳足迹核算", "dash", "carbon_q", "4680-NCM 出口欧盟的碳足迹达标吗？", "carbon_footprint", ["C33"], "COMPUTE", "解读碳足迹核算", [M("4680-NCM", "4680-NCM")], { modelId: "4680-NCM", baseName: "" }),
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
