import {
  AopResponseSchema,
  QuarterlyResponseSchema,
  MappingRowSchema,
  CalibrationReportSchema,
  CalibrationProposalSchema,
  CalibrationHistoryEntrySchema,
  CalibrationConvergencePointSchema,
  type CalibrationConvergencePoint,
  DataHealthResponseSchema,
  OrderProblemGroupSchema,
  type AopResponse,
  type QuarterlyResponse,
  type MappingRow,
  type CalibrationReport,
  type CalibrationProposal,
  type CalibrationHistoryEntry,
  type DataHealthResponse,
  type OrderProblemGroup,
} from "@platform/contracts";
import type { AffectedOrderRowVM, AffectedOrdersOutputVM, OrderRiskRefVM } from "@/api/types";
import { RISK_TIMELINE } from "./fixtures";

// ---------------------------------------------------------------------------
// 剩余视图增量固定数据（全部经契约 schema.parse 校验 —— 与 DataCore 端点同形）
// ---------------------------------------------------------------------------

/** §7.14 年度情景规划台（AOP 2027，基准已拍板；一条 TRIGGERED 触发记录） */
export const AOP_RESPONSE: AopResponse = AopResponseSchema.parse({
  scenarios: [
    {
      id: "aop-2027-conservative",
      key: "conservative",
      name: "保守",
      year: 2027,
      demand: 1420,
      note: "乘用车放缓、储能温和；不赌新增产能，守现金",
      capacityDecision: "现有 12 基地 + 爬坡即可，不新增产线；利用率 81%",
      ltaLock: "正极锁 70%（8.8 万吨）",
      finance: { revenue: 3050, capex: 0, irr: 0 },
      ruleChecks: [
        { ruleKey: "C18", passed: true, explanation: "现金安全垫最稳：13 周最低点 78 亿 ≥ 底线 50 亿（expression: cashCushion >= 50）" },
      ],
      finalized: false,
    },
    {
      id: "aop-2027-baseline",
      key: "baseline",
      name: "基准 ★",
      year: 2027,
      demand: 1580,
      note: "乘用车持平 +8%、储能放量；按年度承诺扩产",
      capacityDecision: "枣庄 +1 条储能线（2026-Q4 动工 · 2027-Q3 投产）；Q2–Q3 6 周窗口缺口以外协过渡",
      ltaLock: "锁 80%（11.2 万吨）+ 10% 价格联动",
      finance: { revenue: 3400, capex: 14, irr: 0.19 },
      ruleChecks: [
        { ruleKey: "C18", passed: true, explanation: "现金安全垫达标：13 周最低点 62 亿 ≥ 底线 50 亿（expression: cashCushion >= 50）" },
        { ruleKey: "C23", passed: true, explanation: "产能建设门槛通过：IRR 19% ≥ 15% 且利用率预测 ≥ 75%（expression: irr >= 0.15 AND utilForecast >= 0.75）" },
      ],
      finalized: true,
      finalizedAt: "2026-05-30T10:00:00Z",
      capexScenario: {
        quarters: ["2026-Q3", "2026-Q4", "2027-Q1", "2027-Q2", "2027-Q3", "2027-Q4", "2028-Q1", "2028-Q2"],
        demand: [382, 398, 372, 404, 428, 452, 470, 488],
        supply: [376, 390, 392, 412, 446, 470, 488, 488],
        gap: [6, 8, -20, -8, -18, -18, -18, 0],
        windows: [{ kind: "surplus", fromQ: "2027-Q1", toQ: "2027-Q1" }],
        projects: [{ id: "ZZ", name: "枣庄储能线", irr: 19.0, util24: 0.81, c23pass: true }],
      },
    },
    {
      id: "aop-2027-aggressive",
      key: "aggressive",
      name: "激进",
      year: 2027,
      demand: 1760,
      note: "海外大单落地、储能高增；双基地并扩抢份额",
      capacityDecision: "枣庄储能线 + 江门动力线（同步动工）；人力提前 2 季招训",
      ltaLock: "锁 85% + 前驱体二级锁定",
      finance: { revenue: 3780, capex: 27, irr: 0.17 },
      ruleChecks: [
        { ruleKey: "C18", passed: false, explanation: "现金安全垫黄色提示：13 周最低点 52 亿，接近底线 50 亿（expression: cashCushion >= 50）" },
        { ruleKey: "C23", passed: false, explanation: "枣庄储能线：IRR 19.0%（门槛 15.0%）· 24月利用率 81.0%（门槛 75.0%）→ 通过；江门动力线：IRR 12.5%（门槛 15.0%）· 24月利用率 79.7%（门槛 75.0%）→ 不通过" },
      ],
      finalized: false,
      capexScenario: {
        quarters: ["2026-Q3", "2026-Q4", "2027-Q1", "2027-Q2", "2027-Q3", "2027-Q4", "2028-Q1", "2028-Q2"],
        demand: [382, 398, 372, 404, 428, 452, 470, 488],
        supply: [376, 390, 392, 430, 488, 530, 560, 560],
        gap: [6, 8, -20, -26, -60, -78, -90, -72],
        windows: [{ kind: "gap", fromQ: "2026-Q3", toQ: "2026-Q4" }, { kind: "surplus", fromQ: "2027-Q3", toQ: "2028-Q2" }],
        projects: [
          { id: "ZZ", name: "枣庄储能线", irr: 19.0, util24: 0.81, c23pass: true },
          { id: "JM", name: "江门动力线", irr: 12.5, util24: 0.797, c23pass: false },
        ],
      },
    },
  ],
  triggers: [
    {
      id: "trg-overseas",
      condition: "海外大单签约（≥80 万套/年）",
      action: "激进情景升级：江门动力线动工",
      status: "MONITORING",
    },
    {
      id: "trg-ess",
      condition: "储能需求连续 2 季 > 基准 +8%",
      action: "枣庄二期评审启动",
      status: "TRIGGERED",
      triggeredAt: "2026-06-08T09:00:00Z",
      notifiedTo: ["投资委员会", "规划部"],
    },
  ],
  decomposition: [
    { period: "2027", level: "year", value: 1580, targetRef: "target-aop-2027" },
    { period: "2026-Q3", level: "quarter", value: 382, targetRef: "sop-target-2026-Q3" },
    { period: "2026-Q4", level: "quarter", value: 398, targetRef: "sop-target-2026-Q4" },
    { period: "2027-Q1", level: "quarter", value: 372, targetRef: "sop-target-2027-Q1" },
    { period: "2027-Q2", level: "quarter", value: 404, targetRef: "sop-target-2027-Q2" },
    { period: "2027-Q3", level: "quarter", value: 428, targetRef: "sop-target-2027-Q3" },
    { period: "2027-Q4", level: "quarter", value: 452, targetRef: "sop-target-2027-Q4" },
    { period: "2026-07", level: "month", value: 127.6, targetRef: "sop-target-2026-07" },
    { period: "2026-08", level: "month", value: 128.0, targetRef: "sop-target-2026-08" },
    { period: "2026-09", level: "month", value: 126.4, targetRef: "sop-target-2026-09" },
  ],
});

/** §7.15 季度滚动（6 季；一条 |偏差|>5% 长协行 → 升级供应风险 + 跳合肥） */
export const QUARTERLY_RESPONSE: QuarterlyResponse = QuarterlyResponseSchema.parse({
  rows: [
    { q: "2026-Q3", dem: 382, sup: 376, gap: 6, events: [{ label: "常州夜班常态化" }, { label: "江门齐套治理" }] },
    { q: "2026-Q4", dem: 398, sup: 390, gap: 8, events: [{ label: "枣庄储能线动工（CAPEX 14亿）", ruleKey: "C23" }] },
    { q: "2027-Q1", dem: 372, sup: 392, gap: -20, events: [{ label: "春节检修季 · 供给冗余回补库存" }] },
    { q: "2027-Q2", dem: 404, sup: 396, gap: 8, events: [{ label: "6 周窗口缺口 → 外协过渡（≤20%）", ruleKey: "C08" }] },
    { q: "2027-Q3", dem: 428, sup: 430, gap: -2, events: [{ label: "枣庄线投产 +22/季 · 爬坡 60%→90%" }] },
    { q: "2027-Q4", dem: 452, sup: 448, gap: 4, events: [{ label: "枣庄满产 · 江门线视触发条件" }] },
  ],
  ltaDeviation: [
    { material: "三元正极", planned: 2800, actual: 2576, deviationPct: -8.0, breach: true, note: "到货延迟 · 触发到货间隙事件", baseId: "合肥" },
    { material: "隔膜", planned: 820, actual: 828, deviationPct: 1.0, breach: false, note: "正常" },
    { material: "电解液", planned: 1900, actual: 1862, deviationPct: -2.0, breach: false, note: "正常" },
  ],
});

/** §7.20 映射表（服务端按数据域分组排序后下发） */
export const MAPPING_ROWS: MappingRow[] = MappingRowSchema.array().parse([
  { domain: "工厂", objectKey: "Base", displayName: "基地", kind: "object", sourceSystem: "ERP/SAP", keyProps: ["name★", "util", "gwh"], rules: ["C05"], derivations: [], lineage: { connName: "ERP 主数据", dataset: "plants", fieldCount: 12 } },
  { domain: "工厂", objectKey: "Line", displayName: "产线", kind: "object", sourceSystem: "MES", keyProps: ["lineNo★", "schedule_attainment"], rules: [], derivations: ["schedule_attainment = rollup(week, 排产 vs 实绩)"], lineage: { connName: "MES 制造执行", dataset: "lines", fieldCount: 18 } },
  { domain: "产品", objectKey: "Order", displayName: "订单", kind: "object", sourceSystem: "CRM", keyProps: ["so★", "qty", "due"], rules: ["C13", "C15"], derivations: [], lineage: { connName: "CRM 订单", dataset: "orders", fieldCount: 16 } },
  { domain: "产品", objectKey: "Model", displayName: "型号", kind: "object", sourceSystem: "PLM", keyProps: ["modelNo★"], rules: [], derivations: [], lineage: { connName: "PLM", dataset: "models", fieldCount: 8 } },
  { domain: "工艺", objectKey: "Process", displayName: "工序", kind: "object", sourceSystem: "MES", keyProps: ["procKey★", "yield_baseline"], rules: [], derivations: ["yield_baseline = ts_agg(yield_daily, avg, 7d)"], lineage: { connName: "MES 制造执行", dataset: "process", fieldCount: 9 } },
  { domain: "设备", objectKey: "Equipment", displayName: "设备", kind: "object", sourceSystem: "IoT/SCADA", keyProps: ["equipNo★", "oee_current"], rules: [], derivations: ["oee_current = ts_agg(oee_daily, weighted_avg, 7d)"], lineage: { connName: "IoT 时序通道", dataset: "oee:equip", fieldCount: 6 } },
  { domain: "产能", objectKey: "CapacityPyramid", displayName: "产能金字塔", kind: "object", sourceSystem: "派生", keyProps: ["week★", "p50", "p90"], rules: ["C03"], derivations: ["p90 = capacity_forecast(p90)"], lineage: { fieldCount: 0 } },
  { domain: "预测", objectKey: "DemandForecast", displayName: "需求预测", kind: "object", sourceSystem: "派生", keyProps: ["period★"], rules: ["C12"], derivations: [], lineage: { fieldCount: 0 } },
  { domain: "求解器", objectKey: "capacity_forecast", displayName: "产能推演求解器", kind: "solver", sourceSystem: "求解", keyProps: [], rules: ["C03", "C09"], derivations: ["p50/p90 = Σ 基地周产能 × 爬坡 × 检修 × 认证"], lineage: { fieldCount: 0 } },
  { domain: "求解器", objectKey: "risk_timeline", displayName: "风险时间线求解器", kind: "solver", sourceSystem: "求解", keyProps: [], rules: [], derivations: ["tension(d) = base + Σ event.amp"], lineage: { fieldCount: 0 } },
  { domain: "智能体", objectKey: "explore_agent", displayName: "探索 Agent", kind: "agent", sourceSystem: "智能体", keyProps: [], rules: [], derivations: [], lineage: { fieldCount: 0 } },
]);

/** §7.21 校准报告（穿越 8% 阈值 + 一个 C12 触发标记） */
export const CALIBRATION_REPORT_BASE: CalibrationReport = CalibrationReportSchema.parse({
  points: [
    { date: "2026-03-20", mape: 6.2 },
    { date: "2026-03-27", mape: 6.8 },
    { date: "2026-04-03", mape: 7.4 },
    { date: "2026-04-10", mape: 8.6 },
    { date: "2026-04-17", mape: 9.4 },
    { date: "2026-04-24", mape: 8.9 },
    { date: "2026-05-01", mape: 8.1 },
    { date: "2026-05-08", mape: 7.2 },
    { date: "2026-05-15", mape: 6.4 },
    { date: "2026-05-22", mape: 5.8 },
    { date: "2026-05-29", mape: 5.2 },
    { date: "2026-06-05", mape: 4.9 },
  ],
  thresholdPct: 8,
  triggerMarks: [{ date: "2026-04-17", ruleKey: "C12" }],
  // M11 增量：30d 双口径 + solverKey×基地×型号 切片（nMin=10，不足只报告不提案）
  points30d: [
    { date: "2026-04-17", mape: 8.1 },
    { date: "2026-05-15", mape: 7.0 },
    { date: "2026-06-05", mape: 5.6 },
  ],
  nMin: 10,
  slices: [
    { sliceKey: "capacity_forecast|all|4680-NCM", solverKey: "capacity_forecast", baseId: "all", modelId: "4680-NCM", nPairs: 42, mape7d: 4.9, mape30d: 5.6, bias: 0.031, coverage: 0.9, flags: [] },
    { sliceKey: "capacity_forecast|changzhou|4680-NCM", solverKey: "capacity_forecast", baseId: "changzhou", modelId: "4680-NCM", nPairs: 6, mape7d: 5.4, mape30d: 6.1, bias: 0.05, coverage: 0.83, flags: ["INSUFFICIENT_SAMPLES"] },
  ],
});

/** M11：方法（EMA/重放归因/分位数）+ 回测证据 + HOLD/REJECTED 状态 + 元闭环 realizedMape */
export const CALIBRATION_PROPOSALS: CalibrationProposal[] = CalibrationProposalSchema.array().parse([
  {
    // CALIB-HONEST-EMPTY·C4：demo 冷启动 seed 提案·证据手填(非真实校准配对回测)→ UI 标 SYNTHETIC。
    id: "prop-1", parameter: "化成节拍", objectRef: "工序-化成", currentValue: 5.2, proposedValue: 5.6,
    basis: { windowFrom: "2026-04-01", windowTo: "2026-05-31", samples: 1840 }, status: "PENDING",
    sliceKey: "capacity_forecast|all|4680-NCM", paramRef: { scope: "SOLVER_PARAMS", path: "ct.formation" }, method: "REPLAY_ATTRIBUTION",
    evidence: { windowFrom: "2026-04-01", windowTo: "2026-05-31", nPairs: 1840, mapeBefore: 9.4, simulatedMapeAfter: 6.8, bias: 0.062, flags: ["ATTRIBUTION_SHARE:0.82"], synthetic: true },
    synthetic: true,
  },
  {
    id: "prop-2", parameter: "良率基线", objectRef: "工序-化成", currentValue: 0.975, proposedValue: 0.968,
    basis: { windowFrom: "2026-03-01", windowTo: "2026-04-30", samples: 1240 }, status: "APPLIED",
    sliceKey: "capacity_forecast|all|方形-LFP", paramRef: { scope: "ONTOLOGY_PROPERTY", path: "Process.yield" }, method: "EMA",
    evidence: { windowFrom: "2026-03-01", windowTo: "2026-04-30", nPairs: 1240, mapeBefore: 8.8, simulatedMapeAfter: 6.4, bias: -0.034, flags: [] },
    realizedMape: 6.9,
  },
  {
    id: "prop-3", parameter: "OEE 基线", objectRef: "设备-CZ-07", currentValue: 0.86, proposedValue: 0.84,
    basis: { windowFrom: "2026-01-01", windowTo: "2026-02-28", samples: 980 }, status: "ROLLED_BACK",
    sliceKey: "capacity_forecast|changzhou|4680-NCM", paramRef: { scope: "ONTOLOGY_PROPERTY", path: "Equipment.oee" }, method: "EMA",
    evidence: { windowFrom: "2026-01-01", windowTo: "2026-02-28", nPairs: 980, mapeBefore: 8.1, simulatedMapeAfter: 7.0, bias: 0.018, flags: [] },
  },
  {
    id: "prop-4", parameter: "P90 健康度系数", objectRef: "Solver:capacity_forecast", currentValue: 0.93, proposedValue: 0.92,
    basis: { windowFrom: "2026-05-01", windowTo: "2026-05-31", samples: 360 }, status: "REJECTED",
    sliceKey: "capacity_forecast|all|圆柱-LFP", paramRef: { scope: "SOLVER_PARAMS", path: "health.normal" }, method: "QUANTILE",
    evidence: { windowFrom: "2026-05-01", windowTo: "2026-05-31", nPairs: 360, mapeBefore: 7.2, simulatedMapeAfter: 7.2, bias: 0.01, flags: ["COVERAGE_BEFORE:0.83", "COVERAGE_AFTER:0.83", "NO_IMPROVEMENT"] },
  },
  {
    id: "prop-5", parameter: "工序良率基线", objectRef: "Model:2170-NCM", currentValue: 0.96, proposedValue: 0.71,
    basis: { windowFrom: "2026-05-01", windowTo: "2026-05-31", samples: 280 }, status: "HOLD",
    sliceKey: "capacity_forecast|all|2170-NCM", paramRef: { scope: "ONTOLOGY_PROPERTY", path: "Process.yield" }, method: "EMA",
    evidence: { windowFrom: "2026-05-01", windowTo: "2026-05-31", nPairs: 280, mapeBefore: 11.3, simulatedMapeAfter: 11.3, bias: 0.21, flags: ["STRUCTURAL_SHIFT", "DRIFT:0.26"] },
  },
]);

export const CALIBRATION_HISTORY: CalibrationHistoryEntry[] = CalibrationHistoryEntrySchema.array().parse([
  { at: "2026-04-18T08:00:00Z", trigger: "C12", changedParams: ["化成节拍", "良率基线"], mapeBefore: 9.4, mapeAfter: 6.4, proposalId: "prop-2", method: "EMA", simulatedMapeAfter: 6.4, realizedMape: 6.9 },
  { at: "2026-02-09T08:00:00Z", trigger: "手动", changedParams: ["OEE 基线"], mapeBefore: 8.8, mapeAfter: 7.1, proposalId: "prop-3", method: "EMA", simulatedMapeAfter: 7.1 },
]);

/**
 * WO-CALIB-CONVERGENCE-UI（G-VIS-1·退回窄修）：「越用越准」收敛史——mock 值对齐**真后端引擎产物** 25→13.64→5.26
 * （seed 真校准配对 actual=predicted×(1-bias)·bias 0.20/0.12/0.05 → ape=bias/(1-bias) → mapePct·§2.E）。
 * 前端所见(mock) = 后端真值(真引擎)·非手绘（reviewer 抓的手绘 8.6→6.1 已废）。可变数组——sweep handler 追加一致轮。
 */
export const CALIBRATION_CONVERGENCE: CalibrationConvergencePoint[] = CalibrationConvergencePointSchema.array().parse([
  { round: 1, at: "2026-06-20T02:00:00Z", trigger: "CALIBRATION_SWEEP", mapeBefore: 30, mapeAfter: 25, slicesEvaluated: 12, proposalsCreated: 3, autoApplied: 1, paramsVersion: 4 },
  { round: 2, at: "2026-06-27T02:00:00Z", trigger: "CALIBRATION_SWEEP", mapeBefore: 25, mapeAfter: 13.64, slicesEvaluated: 12, proposalsCreated: 2, autoApplied: 2, paramsVersion: 5 },
  { round: 3, at: "2026-07-01T02:00:00Z", trigger: "CALIBRATION_SWEEP", mapeBefore: 13.64, mapeAfter: 5.26, slicesEvaluated: 12, proposalsCreated: 1, autoApplied: 2, paramsVersion: 6 },
]);

/** §7.22 数据健康度（IoT 延迟 4.2h → DELAYED，命中 C09 降级：与 capacity_forecast mock 同口径） */
export const DATA_HEALTH: DataHealthResponse = DataHealthResponseSchema.parse({
  sources: [
    { connId: "conn-erp", name: "ERP 主数据", system: "ERP/SAP", lastDataAt: "2026-06-12T07:40:00Z", latencyMin: 20, thresholdMin: 1440, status: "OK" },
    { connId: "conn-crm", name: "CRM 订单", system: "CRM", lastDataAt: "2026-06-12T07:25:00Z", latencyMin: 35, thresholdMin: 240, status: "OK" },
    {
      connId: "conn-iot",
      name: "IoT 时序通道",
      system: "IoT/SCADA",
      lastDataAt: "2026-06-12T03:48:00Z",
      latencyMin: 252,
      thresholdMin: 120,
      status: "DELAYED",
      degradeImpact: { p90From: 0.93, p90To: 0.9, affectedSolvers: ["capacity_forecast", "聚合求解器"] },
    },
  ],
  overall: "DELAYED",
});

// ---------------------------------------------------------------------------
// §7.16 affected_orders 扩展输出（rows + summary + problems[]）
// ---------------------------------------------------------------------------

const riskRef = (base: string, factor?: string): OrderRiskRefVM => {
  const card = RISK_TIMELINE.cards.find((c) => c.base === base && (!factor || c.factor === factor)) ?? RISK_TIMELINE.cards[0]!;
  // WO-KILL-MOCK-RED 阶段②：透传 dataMode（缺省 → RiskPopover 保守走灰·不出假红越线）。
  return { base: card.base, factor: card.factor, crossDay: card.crossDay, peak: card.peak, series: card.series, threshold: RISK_TIMELINE.threshold, dataMode: card.dataMode ?? RISK_TIMELINE.dataMode };
};

export const AFFECTED_ROWS: AffectedOrderRowVM[] = [
  { so: "SO-10001", cust: "蔚途汽车", seg: "乘用车", model: "4680-NCM", qty: 1.5, due: "2026-06-20", delay: 6, risks: [riskRef("常州"), riskRef("江门")] },
  { so: "SO-10006", cust: "星河储能", seg: "储能", model: "储能-280Ah", qty: 1.82, due: "2026-06-24", delay: 4, risks: [riskRef("江门")] },
  { so: "SO-10013", cust: "蔚途汽车", seg: "乘用车", model: "4680-NCM", qty: 1.5, due: "2026-07-02", delay: 3, risks: [riskRef("常州")] },
  { so: "SO-10004", cust: "蓝海电网", seg: "储能", model: "储能-314Ah", qty: 1.1, due: "2026-06-28", delay: 5, risks: [riskRef("常州"), riskRef("合肥"), riskRef("江门"), riskRef("眉山"), riskRef("成都")] },
  { so: "SO-10008", cust: "山岳重工", seg: "商用车", model: "VDA-NCM", qty: 0.9, due: "2026-07-05", delay: 2, risks: [riskRef("眉山")] },
  { so: "SO-10011", cust: "极光新能源", seg: "储能", model: "储能-280Ah", qty: 1.3, due: "2026-07-08", delay: 2, risks: [riskRef("江门")] },
  { so: "SO-10016", cust: "山岳重工", seg: "商用车", model: "刀片-LFP", qty: 0.8, due: "2026-07-12", delay: 1, risks: [riskRef("武汉")] },
  { so: "SO-10019", cust: "蔚途汽车", seg: "乘用车", model: "4680-LFP", qty: 1.2, due: "2026-07-15", delay: 2, risks: [riskRef("成都")] },
];

const SEG_PRICE: Record<string, number> = { 乘用车: 0.9, 商用车: 0.85, 储能: 0.45 };
// WO-BIZVIEW-DOWNSTREAM ②：mock 对齐真后端 marginLedger（细分毛利率·真后端亦下发此字段）——逐细分毛利率。
const SEG_MARGIN: Record<string, number> = { 乘用车: 18, 商用车: 15, 储能: 13 };

const chain = (orderId: string, judgement: string, rootCause: string, remedy: string) => ({
  orderId,
  layers: [
    { kind: "order" as const, label: orderId },
    { kind: "judgement" as const, label: judgement },
    { kind: "rootCause" as const, label: rootCause },
    { kind: "remedy" as const, label: remedy },
  ],
});

export const ORDER_PROBLEMS: OrderProblemGroup[] = OrderProblemGroupSchema.array().parse([
  {
    category: "DELIVERY",
    title: "交期风险",
    orderCount: 5,
    financeImpact: 4.2,
    rootCauseSummary: "化成柜张力 D+5 越线 + 交付高峰叠加，P90 口径周供给不足",
    rootChains: [
      chain("SO-10001", "交期判：P90 周供给 < 周需求", "常州化成柜张力 D+5 越线", "化成夜班 + 预留 1 周缓冲"),
      chain("SO-10004", "交期判：多基地风险叠加", "合肥到货间隙 → 可产网络收敛", "加急 200 吨正极对冲"),
    ],
  },
  {
    category: "MARGIN",
    title: "毛利不达线",
    orderCount: 2,
    financeImpact: 1.6,
    rootCauseSummary: "框架价压价至接单毛利线（C15）以下",
    rootChains: [chain("SO-10008", "毛利判：测算 9.8% < 商用车线 11%", "框架协议低价 + 议价偏移", "建议提价 2.2% 接单")],
  },
  {
    category: "KIT",
    title: "齐套缺口",
    orderCount: 2,
    financeImpact: 1.1,
    rootCauseSummary: "三元正极长协执行偏差 −8% → 库存+在途覆盖不足",
    rootChains: [chain("SO-10011", "齐套判：正极缺口 86 吨", "长协到货延迟（到货间隙事件）", "加急采购 · 最早齐套 06-29")],
  },
  {
    category: "CREDIT",
    title: "信用超限",
    orderCount: 1,
    financeImpact: 1.3,
    rootCauseSummary: "在手应收 + 新单金额 > 授信额度（C13）",
    rootChains: [chain("SO-10019", "信用判：超限 1.4 亿", "在手应收 9.8 亿叠加新单", "预付款 ≥40% 或追加担保")],
  },
]);

/** 按基地过滤后的完整求解输出（handler 调用） */
export function affectedOrdersOutput(base?: string): AffectedOrdersOutputVM {
  let rows = AFFECTED_ROWS;
  if (base) {
    rows = rows
      .filter((r) => r.risks.some((k) => k.base === base))
      .map((r) => ({ ...r, risks: r.risks.filter((k) => k.base === base) }));
  }
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const revenue = rows.reduce((s, r) => s + r.qty * (SEG_PRICE[r.seg] ?? 0.6), 0);
  // WO-BIZVIEW-DOWNSTREAM ②：综合毛利率逐细分贡献勾稽（Σ贡献=综合毛利率·闭合）——mock 对齐真后端 marginLedger 字段。
  const targetPct = 16;
  const segMap = new Map<string, { revenue: number; orderCount: number }>();
  for (const r of rows) {
    const rev = r.qty * (SEG_PRICE[r.seg] ?? 0.6);
    const g = segMap.get(r.seg) ?? { revenue: 0, orderCount: 0 };
    g.revenue += rev; g.orderCount += 1;
    segMap.set(r.seg, g);
  }
  const totalRev = [...segMap.values()].reduce((s, g) => s + g.revenue, 0) || 1;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const bySegment = [...segMap.entries()].map(([seg, g]) => {
    const revShare = g.revenue / totalRev;
    const marginPct = SEG_MARGIN[seg] ?? 15;
    return {
      seg,
      revenue: Math.round(g.revenue * 10) / 10,
      revShare: round(revShare),
      marginPct,
      contributionPp: round(marginPct * revShare),
      gapContributionPp: round((marginPct - targetPct) * revShare),
      orderCount: g.orderCount,
    };
  });
  const gmRatePct = Math.round(bySegment.reduce((s, b) => s + b.contributionPp, 0) * 100) / 100;
  return {
    summary: {
      orderCount: rows.length,
      totalQty: Math.round(totalQty * 100) / 100,
      custCount: new Set(rows.map((r) => r.cust)).size,
      revenue: Math.round(revenue * 100) / 100,
    },
    rows,
    problems: ORDER_PROBLEMS,
    marginLedger: {
      gmRatePct,
      targetPct,
      gapPp: Math.round((gmRatePct - targetPct) * 100) / 100,
      reconciled: true,
      bySegment,
    },
  };
}

/** 校准报告按三级筛选确定性微调（演示下钻联动；同输入同输出） */
export function calibrationReportFor(filters: { objectType?: string; baseId?: string; solverKey?: string }): CalibrationReport {
  const key = `${filters.objectType ?? ""}|${filters.baseId ?? ""}|${filters.solverKey ?? ""}`;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 97;
  const delta = (h % 5) * 0.1;
  return {
    ...CALIBRATION_REPORT_BASE,
    points: CALIBRATION_REPORT_BASE.points.map((p) => ({ ...p, mape: Math.round((p.mape + delta) * 10) / 10 })),
  };
}
