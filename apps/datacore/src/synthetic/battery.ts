import type { IndustryTemplate } from "@platform/contracts";
import type { DerivedPropertyDef, LinkTypeDef, ObjectTypeDef, PropertyDef } from "../domain.js";
import { hashString, mulberry32, pick, randInt, round } from "../prng.js";
import { ALL_FEATURE_KEYS } from "../features.js";

/** Built-in battery-manufacturing template (QOS-PRD §7.6 + addendum §S1/§A8 semantics). */

export const BASES: { baseId: string; name: string; kind: "动力" | "储能" }[] = [
  { baseId: "changzhou", name: "常州", kind: "动力" },
  { baseId: "hefei", name: "合肥", kind: "动力" },
  { baseId: "xian", name: "西安", kind: "动力" },
  { baseId: "yibin", name: "宜宾", kind: "储能" },
  { baseId: "liyang", name: "溧阳", kind: "动力" },
  { baseId: "qingdao", name: "青岛", kind: "储能" },
  { baseId: "nanjing", name: "南京", kind: "动力" },
  { baseId: "chengdu", name: "成都", kind: "储能" },
  { baseId: "fuzhou", name: "福州", kind: "储能" },
  { baseId: "changsha", name: "长沙", kind: "动力" },
  { baseId: "huizhou", name: "惠州", kind: "储能" },
  { baseId: "yancheng", name: "盐城", kind: "动力" },
];

export const MODELS: { modelId: string; name: string }[] = [
  { modelId: "4680-NCM", name: "4680 三元圆柱" },
  { modelId: "4680-LFP", name: "4680 磷酸铁锂圆柱" },
  { modelId: "L300-NCM", name: "L300 三元长电芯" },
  { modelId: "L148-LFP", name: "L148 铁锂方形" },
  { modelId: "P28-NCM", name: "P28 软包三元" },
  { modelId: "S192-LFP", name: "S192 储能电芯" },
];

const CUSTOMERS = ["星辰汽车", "蓝海储能", "极光电动", "云岭新能源", "晨风车业", "沧浪电网"];
const BOTTLENECKS = ["电芯", "模组", "PACK", "化成"];

// ---------------------------------------------------------------------------
// §S1 scenario-pack solver parameters (battery defaults — NEVER hardcoded in solver code)
// ---------------------------------------------------------------------------

export const BN_FACTORS = [
  "瓶颈工序",
  "设备OEE",
  "人力工时",
  "物料齐套",
  "物流时长",
  "换型损失",
  "良率波动",
] as const;

export const BATTERY_SOLVER_PARAMS: Record<string, unknown> = {
  forecastStart: "2026-07-01",
  packCellCount: 96,
  certFactors: { 量产: 1.0, 认证中: 0.6 },
  ramp: { base: 0.88, step: 0.03, fullWeek: 5 },
  maintMult: 0.72,
  health: { normal: 0.93, degraded: 0.9, staleHours: 2 },
  whatIf: { nightShiftCoef: 0.06, channelCoef: 0.05, outsourceMax: 0.2 },
  logistics: { byAddress: { 上海: 3, 广州: 5, 北京: 4, 成都: 6, 海外: 14 }, defaultDays: 7 },
  bottleneck: {
    factors: [...BN_FACTORS],
    primary: {
      常州: "瓶颈工序",
      合肥: "设备OEE",
      西安: "人力工时",
      宜宾: "物料齐套",
      溧阳: "换型损失",
      青岛: "物流时长",
      南京: "良率波动",
      成都: "设备OEE",
      福州: "物料齐套",
      长沙: "瓶颈工序",
      惠州: "物流时长",
      盐城: "人力工时",
    },
    defaultPrimary: "瓶颈工序",
    mock: { mod: 9, factorMult: 7, primaryBase: 88, primaryCap: 97, secondaryBase: 55, secondaryCap: 83, utilHigh: 0.82, utilHighAdd: 6, utilLowAdd: 2 },
    live: { oeeK: 220, oeeBase: 30, utilK: 0.9, utilBase: 8, yieldK: 600, yieldBase: 35 },
  },
  risk: {
    threshold: 85,
    cap: 98,
    rampDen: 0.72,
    pulseWindow: 3,
    pulseDecayDen: 4,
    psFloor: 0.25,
    psStart: 68,
    psDen: 45,
    maxCards: 8,
    targetLift: { base: 8, mod: 13 },
    eventAmps: { maint_window: 14, delivery_peak: 9, arrival_gap: 10 },
    arrivalCycleDays: 14,
    mitigations: {
      物料齐套: [
        { key: "early_stock", name: "提前备料", eff: 12, tn: 2, cost: "中", risk: "低" },
        { key: "alt_supplier", name: "备选供应商切换", eff: 9, tn: 5, cost: "高", risk: "中" },
        { key: "air_freight", name: "空运补料", eff: 15, tn: 1, cost: "极高", risk: "低" },
      ],
      设备OEE: [
        { key: "preventive", name: "预防性维护前置", eff: 10, tn: 3, cost: "中", risk: "低" },
        { key: "spare_line", name: "备用产线切换", eff: 14, tn: 4, cost: "高", risk: "中" },
        { key: "vendor_support", name: "厂商驻场支持", eff: 8, tn: 2, cost: "中", risk: "低" },
      ],
      人力工时: [
        { key: "night_shift", name: "增开夜班", eff: 11, tn: 2, cost: "中", risk: "低" },
        { key: "temp_labor", name: "临时用工", eff: 8, tn: 3, cost: "中", risk: "中" },
        { key: "cross_train", name: "跨基地借调", eff: 9, tn: 5, cost: "低", risk: "中" },
      ],
      瓶颈工序: [
        { key: "debottleneck", name: "瓶颈工序扩容", eff: 13, tn: 6, cost: "高", risk: "中" },
        { key: "reroute", name: "工艺路线调整", eff: 9, tn: 3, cost: "中", risk: "中" },
        { key: "outsource_step", name: "工序外协", eff: 10, tn: 4, cost: "高", risk: "高" },
      ],
      物流时长: [
        { key: "pre_position", name: "前置仓备货", eff: 10, tn: 3, cost: "中", risk: "低" },
        { key: "dual_route", name: "双线路运输", eff: 8, tn: 2, cost: "中", risk: "低" },
        { key: "expedite", name: "加急运输", eff: 12, tn: 1, cost: "高", risk: "低" },
      ],
      换型损失: [
        { key: "smed", name: "快速换型改善", eff: 9, tn: 7, cost: "低", risk: "低" },
        { key: "batch_merge", name: "批次合并排产", eff: 7, tn: 2, cost: "低", risk: "中" },
        { key: "freeze_window", name: "冻结排产窗口", eff: 8, tn: 3, cost: "低", risk: "中" },
      ],
      良率波动: [
        { key: "spc_tighten", name: "SPC 管控收紧", eff: 8, tn: 4, cost: "低", risk: "低" },
        { key: "golden_batch", name: "黄金批次参数回滚", eff: 11, tn: 2, cost: "中", risk: "低" },
        { key: "incoming_audit", name: "来料加严检验", eff: 7, tn: 3, cost: "中", risk: "低" },
      ],
    },
  },
  affected: {
    windowBefore: 7,
    windowAfter: 14,
    delayDiv: 8,
    jitterMod: 3,
    fallbackMax: 5,
    // §S1.5 修订: problems[] 4 类归并阈值（交期/毛利/齐套/信用）
    problems: {
      creditBase: 0.7,
      creditMod: 60,
      gmFloor: 13.5,
      essModels: ["S192-LFP"],
      comModels: ["L148-LFP"],
      ruleKeys: { DELIVERY: "C03", MARGIN: "C15", KIT: "C06/C16", CREDIT: "C13" },
    },
  },
  // C1 · capex_scenario 年度情景测算（C23 门槛 + 三情景产能项目集）。
  // q0 = 投产季相对窗口起点（0 = 2026-Q3 起的第一季）；capex 亿/季；m 元/套。
  capexScenario: {
    irrThreshold: 0.15,
    util24Threshold: 0.75,
    unitMargin: 1800,
    scenarios: {
      // 保守：不新增产能 → 无项目（IRR/util24 不参与，c23pass 视为不适用）
      conservative: { projects: [] },
      // 基准：合肥四期 8GWh，2027-Q2（窗口起点 2026-Q3 → 第 3 季投产）。IRR≈19% > 15% 门槛。
      baseline: {
        projects: [
          { id: "HF4", name: "合肥四期", q0: 3, cap: 3.5, capex: [3, 5], m: 1800, salvageRate: 0.05, lifeQuarters: 40 },
        ],
      },
      // 激进：合肥四期 + 盐城二期（盐城 2027-Q3 → 第 4 季投产）。盐城 IRR≈9% < 15% → C23 不通过。
      aggressive: {
        projects: [
          { id: "HF4", name: "合肥四期", q0: 3, cap: 3.5, capex: [3, 5], m: 1800, salvageRate: 0.05, lifeQuarters: 40 },
          { id: "YC2", name: "盐城二期", q0: 4, cap: 6.0, capex: [4, 8, 7], m: 1700, salvageRate: 0.05, lifeQuarters: 40 },
        ],
      },
    },
  },
  // §7.14/§7.15 计划域（年度情景 / 季度滚动）参数 —— 全部数据驱动，不写死在端点代码里
  planview: {
    /** 12 个月季节权重（和为 12）：月目标 = 年需求 × w/12 */
    seasonal: [0.92, 0.94, 0.99, 1.01, 1.03, 1.04, 1.06, 1.08, 1.1, 1.04, 0.95, 0.84],
    /** 季度滚动修正（按距 forecastStart 的季度序号），dem = 季度目标 × (1 + corr) */
    rollingCorrPct: [0.02, 0.08, -0.06, 0, 0, 0],
    /** 2027 年目标 = 2026 同季 × (1 + growthYoY) */
    growthYoY: 0.08,
    weeksPerQuarter: 13,
    /** 已决策产能项目投产增量（万套/季） */
    increments: [
      { quarter: "2027-Q2", name: "合肥四期投产", delta: 2.0 },
      { quarter: "2027-Q3", name: "盐城二期爬坡", delta: 3.0 },
    ],
    ltaMaterials: ["碳酸锂", "正极材料", "负极材料", "电解液", "隔膜", "铜箔"],
    /** 强制一行 |偏差|>5%（升级供应风险，与风险看板到货间隙同源） */
    ltaForcedPct: -8,
    deliveryPeakMin: 5,
    scenarios: {
      conservativeFactor: 0.88,
      aggressiveFactor: 1.18,
      finance: {
        conservative: { cashCushion: 72, capex: 3, irr: 9.5 },
        baseline: { cashCushion: 58, capex: 8, irr: 14.2 },
        aggressive: { cashCushion: 42, capex: 27, irr: 18.6 },
      },
    },
  },
  audit: {
    segTolerance: 0.5,
    gapHard: 2,
    gapSoft: 0.3,
    gmHardOver: 0.3,
    gmSoftUnder: 0.5,
    kitHard: 800,
    kitFixTons: 200,
    cashHard: 50,
    cashSoft: 55,
    essShareBaseline: 0.32,
    essShareTol: 0.05,
    capexSoft: 10,
    segMargins: { pas: 18, ess: 13, com: 15 },
    scoreH: 25,
    scoreM: 8,
    passScore: 85,
    condScore: 60,
  },
  planGenerate: {
    base: { rev: 100, gm: 0.142, share: 17, turns: 6.0, cash: 70 },
    targets: { gmFloor: 0.135, cashFloor: 45, capexCap: 20, revGrowthPct: 18, sharePts: 12, turnsFloor: 6.0 },
    paths: {
      A: { name: "保毛利型", rev: 1.12, gm: 0.014, share: 6, capex: 0, turns: 0.6, cash: 6 },
      B: { name: "保规模型", rev: 1.22, gm: -0.008, share: 16, capex: 2, turns: -0.4, cash: -4 },
      C: { name: "扩产型", rev: 1.2, gm: 0.002, share: 22, capex: 27, turns: -0.2, cash: -12 },
      D: { name: "外协型", rev: 1.16, gm: -0.005, share: 12, capex: 0, turns: 0.2, cash: 2 },
      E: { name: "混合型", rev: 1.18, gm: 0.004, share: 14, capex: 14, turns: 0.3, cash: -2 },
    },
    scores: { profitBase: 50, profitK: 22, scaleBase: 40, scaleK: 3, cashBase: 50, cashK: 4, growthBase: 30, growthK: 2.5, stabBase: 90, stabK: 2.2, hardPenalty: 15 },
    schemeNames: { steady: "稳健", balanced: "均衡", aggressive: "进取" },
    gains: {
      A: ["毛利率提升", "现金垫加厚"],
      B: ["市场份额大幅提升", "营收增长最高"],
      C: ["产能规模扩张", "份额提升最大"],
      D: ["轻资产扩张", "弹性供给"],
      E: ["增长与盈利平衡", "风险分散"],
    },
    gives: {
      A: ["份额增长有限"],
      B: ["毛利率下滑", "现金消耗"],
      C: ["CAPEX 高企", "现金垫变薄"],
      D: ["外协质量风险"],
      E: ["中等 CAPEX 投入"],
    },
  },
  sop: { gapRed: 2, dvThreshold: 0.1, cashFloor: 50, monthlyWeeks: 4, gmTolerance: 0.5, revBudget: 248 },
  // M11 校准算法层（PRD-addendum-m11-calibration §4）：可校准参数注册表 + 阈值/开关（场景包配置）。
  calibration: {
    alpha: 0.3, // 方法 A · EMA
    structuralDriftPct: 0.2, // |observed−current|/current > 20% → STRUCTURAL_SHIFT，不出 EMA 提案
    minImprovementPct: 1, // §5 回测门槛：mapeBefore − simulatedMapeAfter ≥ 1pct
    nMin: 10, // §2 最小样本量/切片
    autoApply: false, // §6 默认关闭；开启时仅方法 A 且变幅 <5% 免审批
    autoApplyMaxDeltaPct: 0.05,
    freqLimitDays: 7, // 同一 paramRef ≤1 次/周
    metaLoopDays: 14, // APPLIED 后 14（模拟）日回写 realizedMape
    quantile: { lowCov: 0.85, highCov: 0.95, step: 0.01, min: 0.85, max: 0.98 }, // 方法 C
    params: [
      // 直接可观测（A8 实测均值）→ 方法 A
      { key: "yield_baseline", name: "工序良率基线", method: "EMA", scope: "ONTOLOGY_PROPERTY", path: "Process.yield", observedSpecKey: "yield_daily", bounds: [0.7, 0.995] },
      // 间接系数（确定性重放单因子归因）→ 方法 B（认证系数等场景包可按需追加同方法条目）
      { key: "ramp_base", name: "产能预测·爬坡系数基线", method: "REPLAY_ATTRIBUTION", scope: "SOLVER_PARAMS", path: "ramp.base", bounds: [0.6, 1] },
      // P90 健康度系数（覆盖率目标）→ 方法 C（与 C09 临时降级独立叠乘）
      { key: "p90_health", name: "P90 健康度系数", method: "QUANTILE", scope: "SOLVER_PARAMS", path: "health.normal", bounds: [0.85, 0.98] },
    ],
  },
  // 增量 §7.10：plan-versions/current 基线缺省（S&OP 步骤推不出的字段，确定性常数）
  planBaseline: { ltaCov: 92, kitGap: 654, gmTarget: 16.0, cashCushion: 58, capex: 0 },
  dupSimilarityThreshold: 0.92,
};

// ---------------------------------------------------------------------------
// Object types
// ---------------------------------------------------------------------------

const baseProps: PropertyDef[] = [
  { propKey: "baseId", dataType: "string", isPrimaryKey: true },
  { propKey: "name", dataType: "string", isPrimaryKey: false },
  { propKey: "kind", dataType: "enum", isPrimaryKey: false },
  { propKey: "util", dataType: "number", isPrimaryKey: false },
  { propKey: "bottleneck", dataType: "enum", isPrimaryKey: false },
  { propKey: "gwh", dataType: "number", isPrimaryKey: false },
  { propKey: "formationCapDaily", dataType: "number", isPrimaryKey: false },
  { propKey: "agingCapDaily", dataType: "number", isPrimaryKey: false },
];
const baseDerived: DerivedPropertyDef[] = [
  { propKey: "orderCount", formula: "COUNT(Order.so BY bases)" },
  { propKey: "committedQty", formula: "SUM(Order.qty BY bases)" },
  // A8/T3: snapshot property (Equipment.oee_current) is a legal leaf of the derivation graph.
  { propKey: "oeeIndex", formula: "AVG(Equipment.oee_current BY baseId)" },
];

const modelProps: PropertyDef[] = [
  { propKey: "modelId", dataType: "string", isPrimaryKey: true },
  { propKey: "name", dataType: "string", isPrimaryKey: false },
  { propKey: "bases", dataType: "json", isPrimaryKey: false },
  { propKey: "unitPrice", dataType: "number", isPrimaryKey: false },
  // C33 碳护照前置（NCM 体系碳足迹偏高 → 越线）。
  { propKey: "carbonFootprint", dataType: "number", isPrimaryKey: false },
];
const modelDerived: DerivedPropertyDef[] = [
  { propKey: "totalDemand", formula: "SUM(Order.qty BY model)" },
  { propKey: "orderCount", formula: "COUNT(Order.so BY model)" },
];

const orderProps: PropertyDef[] = [
  { propKey: "so", dataType: "string", isPrimaryKey: true },
  { propKey: "cust", dataType: "string", isPrimaryKey: false },
  { propKey: "model", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Model" },
  { propKey: "qty", dataType: "number", isPrimaryKey: false },
  { propKey: "due", dataType: "date", isPrimaryKey: false },
  { propKey: "bases", dataType: "json", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false },
  // 约束扫描所需字段（C03/C08/C13/C29）—— 确定性派生，植入少量越线行让规则真触发。
  { propKey: "demandDelta", dataType: "number", isPrimaryKey: false },
  { propKey: "outsourceRatio", dataType: "number", isPrimaryKey: false },
  { propKey: "creditUsedRatio", dataType: "number", isPrimaryKey: false },
  { propKey: "leadDays", dataType: "number", isPrimaryKey: false },
];
const orderDerived: DerivedPropertyDef[] = [{ propKey: "value", formula: "qty * unitPrice" }];

const lineProps: PropertyDef[] = [
  { propKey: "lineId", dataType: "string", isPrimaryKey: true },
  { propKey: "baseId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
  { propKey: "name", dataType: "string", isPrimaryKey: false },
];

const processProps: PropertyDef[] = [
  { propKey: "processId", dataType: "string", isPrimaryKey: true },
  { propKey: "lineId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Line" },
  { propKey: "baseId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
  { propKey: "name", dataType: "string", isPrimaryKey: false },
  { propKey: "kind", dataType: "enum", isPrimaryKey: false }, // serial | formation | aging
  { propKey: "yield", dataType: "number", isPrimaryKey: false },
  { propKey: "shiftHours", dataType: "number", isPrimaryKey: false },
  { propKey: "shifts", dataType: "number", isPrimaryKey: false },
  { propKey: "attendance", dataType: "number", isPrimaryKey: false },
  { propKey: "utilization", dataType: "number", isPrimaryKey: false },
  { propKey: "channels", dataType: "number", isPrimaryKey: false },
  { propKey: "channelOutputDaily", dataType: "number", isPrimaryKey: false },
  { propKey: "agingSlots", dataType: "number", isPrimaryKey: false },
  { propKey: "agingDays", dataType: "number", isPrimaryKey: false },
];

const equipmentProps: PropertyDef[] = [
  { propKey: "equipId", dataType: "string", isPrimaryKey: true },
  { propKey: "processId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Process" },
  { propKey: "lineId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Line" },
  { propKey: "baseId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
  { propKey: "ctSeconds", dataType: "number", isPrimaryKey: false },
  { propKey: "availFactor", dataType: "number", isPrimaryKey: false },
  { propKey: "oeeA", dataType: "number", isPrimaryKey: false },
  { propKey: "oeeP", dataType: "number", isPrimaryKey: false },
  { propKey: "oeeQ", dataType: "number", isPrimaryKey: false },
];

const maintPlanProps: PropertyDef[] = [
  { propKey: "planId", dataType: "string", isPrimaryKey: true },
  { propKey: "baseId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
  { propKey: "week", dataType: "number", isPrimaryKey: false }, // forecast week (1-based, from forecastStart)
  { propKey: "lastMaintStart", dataType: "date", isPrimaryKey: false }, // aligned dip in the 90d history
];

const segmentProps: PropertyDef[] = [
  { propKey: "segKey", dataType: "string", isPrimaryKey: true },
  { propKey: "name", dataType: "string", isPrimaryKey: false },
  { propKey: "gmRate", dataType: "number", isPrimaryKey: false }, // percent
  { propKey: "baselineShare", dataType: "number", isPrimaryKey: false },
];

const shipmentProps: PropertyDef[] = [
  { propKey: "shipId", dataType: "string", isPrimaryKey: true },
  { propKey: "baseId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
  { propKey: "etaDay", dataType: "number", isPrimaryKey: false }, // relative to forecastStart
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // IN_TRANSIT | ARRIVED | DELAYED
  { propKey: "qtyTons", dataType: "number", isPrimaryKey: false },
  { propKey: "coverageDays", dataType: "number", isPrimaryKey: false }, // C16 齐套覆盖天数（常州在途偏紧 → 越线）
];

const dataHealthProps: PropertyDef[] = [
  { propKey: "sourceId", dataType: "string", isPrimaryKey: true },
  { propKey: "name", dataType: "string", isPrimaryKey: false },
  { propKey: "critical", dataType: "boolean", isPrimaryKey: false },
  { propKey: "lagHours", dataType: "number", isPrimaryKey: false },
];

// §7.14 计划域对象（年度情景 / 触发条件 / 目标分解 —— S&OP 目标线同源对象）
const annualScenarioProps: PropertyDef[] = [
  { propKey: "scnId", dataType: "string", isPrimaryKey: true },
  { propKey: "key", dataType: "enum", isPrimaryKey: false }, // conservative | baseline | aggressive
  { propKey: "name", dataType: "string", isPrimaryKey: false },
  { propKey: "year", dataType: "number", isPrimaryKey: false },
  { propKey: "demand", dataType: "number", isPrimaryKey: false },
  { propKey: "capacityDecision", dataType: "string", isPrimaryKey: false },
  { propKey: "ltaLock", dataType: "string", isPrimaryKey: false },
  { propKey: "revenue", dataType: "number", isPrimaryKey: false },
  { propKey: "capex", dataType: "number", isPrimaryKey: false },
  { propKey: "irr", dataType: "number", isPrimaryKey: false },
  { propKey: "cashCushion", dataType: "number", isPrimaryKey: false },
  { propKey: "finalized", dataType: "boolean", isPrimaryKey: false },
  { propKey: "finalizedAt", dataType: "date", isPrimaryKey: false },
];

const scenarioTriggerProps: PropertyDef[] = [
  { propKey: "trigId", dataType: "string", isPrimaryKey: true },
  { propKey: "condition", dataType: "string", isPrimaryKey: false },
  { propKey: "expr", dataType: "string", isPrimaryKey: false }, // 后端规则扫描表达式（metrics payload）
  { propKey: "action", dataType: "string", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // MONITORING | TRIGGERED
  { propKey: "triggeredAt", dataType: "date", isPrimaryKey: false },
  { propKey: "notifiedTo", dataType: "json", isPrimaryKey: false },
];

const planTargetProps: PropertyDef[] = [
  { propKey: "tgtId", dataType: "string", isPrimaryKey: true },
  { propKey: "period", dataType: "string", isPrimaryKey: false }, // "2026" | "2026-Q1" | "2026-01"
  { propKey: "level", dataType: "enum", isPrimaryKey: false }, // year | quarter | month
  { propKey: "value", dataType: "number", isPrimaryKey: false },
  { propKey: "year", dataType: "number", isPrimaryKey: false },
  { propKey: "scenarioKey", dataType: "string", isPrimaryKey: false },
];

/** §7.20 血缘：源系统绑定（连接器·数据集·字段映射），mapping 表与图谱 source 视角共用 */
const BINDINGS: Record<string, { connId: string; dataset: string; fieldMappings: Record<string, string> }[]> = {
  Base: [{ connId: "conn-mes", dataset: "mes_base_master", fieldMappings: { baseId: "BASE_ID", name: "BASE_NAME", kind: "BASE_KIND", gwh: "NAMEPLATE_GWH", util: "UTILIZATION" } }],
  Model: [{ connId: "conn-plm", dataset: "plm_models", fieldMappings: { modelId: "MODEL_ID", name: "MODEL_NAME", unitPrice: "UNIT_PRICE" } }],
  Order: [{ connId: "conn-erp", dataset: "erp_sales_orders", fieldMappings: { so: "SO_NO", cust: "CUSTOMER", model: "MODEL_ID", qty: "QTY", due: "DUE_DATE", status: "STATUS" } }],
  Line: [{ connId: "conn-mes", dataset: "mes_lines", fieldMappings: { lineId: "LINE_ID", baseId: "BASE_ID", name: "LINE_NAME" } }],
  Process: [{ connId: "conn-mes", dataset: "mes_processes", fieldMappings: { processId: "PROC_ID", lineId: "LINE_ID", name: "PROC_NAME", kind: "PROC_KIND", yield: "YIELD" } }],
  Equipment: [{ connId: "conn-iot", dataset: "iot_equipment", fieldMappings: { equipId: "EQUIP_ID", processId: "PROC_ID", ctSeconds: "CT_SECONDS", availFactor: "AVAIL", oeeA: "OEE_A", oeeP: "OEE_P", oeeQ: "OEE_Q" } }],
  MaintPlan: [{ connId: "conn-mes", dataset: "mes_maint_plans", fieldMappings: { planId: "PLAN_ID", baseId: "BASE_ID", week: "PLAN_WEEK" } }],
  Segment: [{ connId: "conn-erp", dataset: "erp_segments", fieldMappings: { segKey: "SEG_KEY", name: "SEG_NAME", gmRate: "GM_RATE" } }],
  Shipment: [{ connId: "conn-srm", dataset: "srm_shipments", fieldMappings: { shipId: "SHIP_ID", baseId: "BASE_ID", etaDay: "ETA_DAY", qtyTons: "QTY_TONS" } }],
  DataSourceHealth: [{ connId: "conn-iot", dataset: "iot_source_health", fieldMappings: { sourceId: "SOURCE_ID", lagHours: "LAG_HOURS" } }],
};

/** 治理增量 §1：电池模板各对象类型的归域（与 graphmeta.GRAPH_DOMAIN 同源）。 */
export const BATTERY_TYPE_DOMAIN: Record<string, string> = {
  Base: "factory", Line: "factory", Process: "process", Equipment: "equip", MaintPlan: "equip",
  Order: "product", Model: "product", Segment: "product", Shipment: "capacity",
  DataSourceHealth: "quality", AnnualScenario: "plan", ScenarioTrigger: "plan", PlanTarget: "plan",
};

/** 治理增量 §3/§4：名称类字段 searchable=true（A3 建议同语义）+ 单位补充。 */
function withGovernance(key: string, props: PropertyDef[]): PropertyDef[] {
  const units: Record<string, Record<string, string>> = {
    Base: { gwh: "GWh", util: "%" },
    Model: { unitPrice: "元" },
    Order: { qty: "件" },
    Shipment: { qtyTons: "吨" },
  };
  return props.map((p) => {
    const out = { ...p };
    if (p.propKey === "name" || p.propKey === "displayName" || (p.isPrimaryKey && p.dataType === "string")) {
      out.searchable = true;
    }
    const u = units[key]?.[p.propKey];
    if (u) out.unit = u;
    return out;
  });
}

export function batteryObjectTypes(): Omit<ObjectTypeDef, "id" | "tenantId" | "version" | "status">[] {
  const plain = (key: string, displayName: string, properties: PropertyDef[]): Omit<ObjectTypeDef, "id" | "tenantId" | "version" | "status"> => ({
    key,
    displayName,
    domain: BATTERY_TYPE_DOMAIN[key] ?? "unassigned",
    properties: withGovernance(key, properties),
    derivedProperties: [],
    sourceBindings: BINDINGS[key] ?? [],
  });
  return [
    { key: "Base", displayName: "生产基地", domain: "factory", properties: withGovernance("Base", baseProps), derivedProperties: baseDerived, sourceBindings: BINDINGS.Base ?? [] },
    { key: "Model", displayName: "电池型号", domain: "product", properties: withGovernance("Model", modelProps), derivedProperties: modelDerived, sourceBindings: BINDINGS.Model ?? [] },
    { key: "Order", displayName: "销售订单", domain: "product", properties: withGovernance("Order", orderProps), derivedProperties: orderDerived, sourceBindings: BINDINGS.Order ?? [] },
    plain("Line", "产线", lineProps),
    plain("Process", "工序", processProps),
    plain("Equipment", "设备", equipmentProps),
    plain("MaintPlan", "检修计划", maintPlanProps),
    plain("Segment", "应用细分", segmentProps),
    plain("Shipment", "在途批次", shipmentProps),
    plain("DataSourceHealth", "数据源健康度", dataHealthProps),
    plain("AnnualScenario", "年度情景", annualScenarioProps),
    plain("ScenarioTrigger", "情景触发条件", scenarioTriggerProps),
    plain("PlanTarget", "计划目标", planTargetProps),
  ];
}

export function batteryLinkTypes(): Omit<LinkTypeDef, "id" | "tenantId" | "version">[] {
  return [
    { key: "model_producible_at", fromTypeKey: "Model", toTypeKey: "Base", cardinality: "N:N" },
    { key: "order_for_model", fromTypeKey: "Order", toTypeKey: "Model", cardinality: "1:N" },
    // §S1.2: certification state lives on the model↔line edge (props.status 量产 | 认证中).
    { key: "model_certified_on", fromTypeKey: "Model", toTypeKey: "Line", cardinality: "N:N" },
    // 跨域切片 order_fulfillment_360：补全 product→factory→process→equip→supply→commercial 链路边。
    { key: "line_belongs_to_base", fromTypeKey: "Line", toTypeKey: "Base", cardinality: "N:N" }, // factory（多线归一基地）
    { key: "line_has_process", fromTypeKey: "Line", toTypeKey: "Process", cardinality: "1:N" }, // process
    { key: "equip_used_in", fromTypeKey: "Equipment", toTypeKey: "Process", cardinality: "N:N" }, // equip（多设备归一工序）
    { key: "model_uses_material", fromTypeKey: "Model", toTypeKey: "Material", cardinality: "N:N" }, // supply
    { key: "order_of_customer", fromTypeKey: "Order", toTypeKey: "Customer", cardinality: "N:N" }, // commercial（多单归一客户）
    // 8 域切片增量：补全 supply 深链 / commercial 深链 / 工厂扩展 / 设备-检修 / 产能 / 质量 / 计划 跨域边。
    { key: "model_has_cert", fromTypeKey: "Model", toTypeKey: "Certification", cardinality: "N:N" }, // factory（认证）
    { key: "customer_has_invoice", fromTypeKey: "Customer", toTypeKey: "ARInvoice", cardinality: "N:N" }, // commercial（应收）
    { key: "material_has_batch", fromTypeKey: "Material", toTypeKey: "MaterialBatch", cardinality: "N:N" }, // supply（批次）
    { key: "material_supplied_by_po", fromTypeKey: "Material", toTypeKey: "PurchaseOrder", cardinality: "N:N" }, // supply（采购）
    { key: "material_carbon", fromTypeKey: "Material", toTypeKey: "CarbonFactor", cardinality: "N:N" }, // supply（碳因子）
    { key: "base_energy_meter", fromTypeKey: "Base", toTypeKey: "EnergyMeter", cardinality: "N:N" }, // factory（能耗）
    { key: "base_has_shipment", fromTypeKey: "Base", toTypeKey: "Shipment", cardinality: "N:N" }, // capacity（在途）
    { key: "base_maint_plan", fromTypeKey: "Base", toTypeKey: "MaintPlan", cardinality: "N:N" }, // equip（检修）
    { key: "model_changeover", fromTypeKey: "Model", toTypeKey: "ChangeoverMatrix", cardinality: "N:N" }, // factory（换型）
    { key: "model_in_segment", fromTypeKey: "Model", toTypeKey: "Segment", cardinality: "N:N" }, // product（细分）
    { key: "base_data_health", fromTypeKey: "Base", toTypeKey: "DataSourceHealth", cardinality: "N:N" }, // quality（数据源）
    { key: "scenario_to_target", fromTypeKey: "AnnualScenario", toTypeKey: "PlanTarget", cardinality: "N:N" }, // plan（目标）
    { key: "scenario_to_capex", fromTypeKey: "AnnualScenario", toTypeKey: "CapexProject", cardinality: "N:N" }, // plan（投资）
    // Phase5A 财务域边：基地→财务账户（Order 根可达 finance，凑 9 域）、情景→财务指标。
    { key: "base_finance", fromTypeKey: "Base", toTypeKey: "FinanceAccount", cardinality: "N:N" }, // finance
    { key: "scenario_to_finance", fromTypeKey: "AnnualScenario", toTypeKey: "FinanceMetric", cardinality: "N:N" }, // finance
  ];
}

/**
 * 跨 6 域本体切片 order_fulfillment_360（产品履约全景）。
 * 链路：Order(product) → Model(product) → Base(factory) → Line(factory) → Process(process) → Equipment(equip)，
 * 并旁挂 Model → Material(supply) 与 Order → Customer(commercial)。
 * 两个推演场景（affected_orders 推演 / plan_audit 体检）均先经此切片检索，再喂求解器。
 * root 按 args.so 选定单一订单 → 展开该订单的完整履约树（便于逐节点取证）。
 */
export function batteryBuiltinSlices(): { sliceKey: string; version: number; spec: import("../domain.js").SliceSpecRecord["spec"] }[] {
  return [
    {
      sliceKey: "order_fulfillment_360",
      version: 1,
      spec: {
        root: { typeKey: "Order", selector: { byKey: "{{args.so}}" } },
        paths: [
          // product → factory → process → equip 主干
          [
            { linkKey: "order_for_model", direction: "out", project: ["modelId", "name", "unitPrice"] },
            { linkKey: "model_producible_at", direction: "out", project: ["baseId", "name", "kind", "util", "bottleneck", "gwh"] },
            { linkKey: "line_belongs_to_base", direction: "in", project: ["lineId", "baseId", "name"] },
            { linkKey: "line_has_process", direction: "out", project: ["processId", "name", "kind", "yield", "utilization"] },
            { linkKey: "equip_used_in", direction: "in", project: ["equipId", "processId", "ctSeconds", "availFactor", "oeeA", "oeeP", "oeeQ"] },
          ],
          // product → supply（型号 BOM 物料）
          [
            { linkKey: "order_for_model", direction: "out" },
            { linkKey: "model_uses_material", direction: "out", project: ["matId", "name", "unitPrice", "leadTime", "carbonFactor", "onHand"] },
          ],
          // commercial（下单客户信用画像）
          [{ linkKey: "order_of_customer", direction: "out", project: ["custId", "custName", "creditLimit", "termDays", "receivables", "maxOverdueDays"] }],
        ],
        maxNodes: 500,
        contractFixtures: [
          {
            name: "首单全链可达 6 域",
            args: { so: "SO-10001" },
            expect: {
              rootType: "Order",
              minNodes: 10,
              mustIncludeTypes: ["Order", "Model", "Base", "Line", "Process", "Equipment", "Material", "Customer"],
              mustIncludeLinkKeys: ["order_for_model", "model_producible_at", "line_belongs_to_base", "line_has_process", "equip_used_in", "model_uses_material", "order_of_customer"],
            },
          },
        ],
      },
    },
    {
      // 跨 8 域：产品·工厂·工艺·设备·供给·商务·产能·质量（订单到回款全链 + 数据可信度）。
      sliceKey: "order_to_cash_720",
      version: 1,
      spec: {
        root: { typeKey: "Order", selector: { byKey: "{{args.so}}" } },
        paths: [
          // 产品→工厂→工艺→设备
          [
            { linkKey: "order_for_model", direction: "out", project: ["modelId", "name", "unitPrice"] },
            { linkKey: "model_producible_at", direction: "out", project: ["baseId", "name", "kind", "util"] },
            { linkKey: "line_belongs_to_base", direction: "in", project: ["lineId", "name"] },
            { linkKey: "line_has_process", direction: "out", project: ["processId", "name", "kind", "yield"] },
            { linkKey: "equip_used_in", direction: "in", project: ["equipId", "oeeA", "oeeP", "oeeQ"] },
          ],
          // 供给：物料→批次
          [
            { linkKey: "order_for_model", direction: "out" },
            { linkKey: "model_uses_material", direction: "out", project: ["matId", "name", "onHand", "leadTime"] },
            { linkKey: "material_has_batch", direction: "out", limitPerNode: 20, project: ["batchId", "qty", "ageDays", "idleDays"] },
          ],
          // 供给：物料→采购单
          [
            { linkKey: "order_for_model", direction: "out" },
            { linkKey: "model_uses_material", direction: "out" },
            { linkKey: "material_supplied_by_po", direction: "out", limitPerNode: 20, project: ["poId", "qty", "etaDay", "delayed"] },
          ],
          // 商务：客户→应收
          [
            { linkKey: "order_of_customer", direction: "out", project: ["custId", "custName", "creditLimit", "receivables", "maxOverdueDays"] },
            { linkKey: "customer_has_invoice", direction: "out", limitPerNode: 20, project: ["invoiceId", "amount", "overdueDays"] },
          ],
          // 产能：基地→在途
          [
            { linkKey: "order_for_model", direction: "out" },
            { linkKey: "model_producible_at", direction: "out" },
            { linkKey: "base_has_shipment", direction: "out", project: ["shipId", "etaDay", "qtyTons", "status"] },
          ],
          // 质量：基地→数据源健康
          [
            { linkKey: "order_for_model", direction: "out" },
            { linkKey: "model_producible_at", direction: "out" },
            { linkKey: "base_data_health", direction: "out", project: ["sourceId", "name", "critical", "lagHours"] },
          ],
          // 财务（Phase5A）：基地→财务账户 → 第 9 域 finance
          [
            { linkKey: "order_for_model", direction: "out" },
            { linkKey: "model_producible_at", direction: "out" },
            { linkKey: "base_finance", direction: "out", project: ["accId", "cashOnHand", "receivable", "payable", "workingCapital"] },
          ],
        ],
        maxNodes: 800,
        contractFixtures: [
          {
            name: "首单全链可达 9 域（含财务）",
            args: { so: "SO-10001" },
            expect: {
              rootType: "Order",
              minNodes: 15,
              mustIncludeTypes: ["Order", "Model", "Base", "Line", "Process", "Equipment", "Material", "MaterialBatch", "PurchaseOrder", "Customer", "ARInvoice", "Shipment", "DataSourceHealth", "FinanceAccount"],
              mustIncludeLinkKeys: ["order_for_model", "model_producible_at", "line_has_process", "equip_used_in", "material_has_batch", "material_supplied_by_po", "customer_has_invoice", "base_has_shipment", "base_data_health", "base_finance"],
            },
          },
        ],
      },
    },
    {
      // 跨 8 域 · 最大广度（在 order_to_cash_720 基础上加认证/能耗/换型/细分/检修）。
      sliceKey: "enterprise_360",
      version: 1,
      spec: {
        root: { typeKey: "Order", selector: { byKey: "{{args.so}}" } },
        paths: [
          [
            { linkKey: "order_for_model", direction: "out", project: ["modelId", "name"] },
            { linkKey: "model_producible_at", direction: "out", project: ["baseId", "name", "kind"] },
            { linkKey: "line_belongs_to_base", direction: "in", project: ["lineId", "name"] },
            { linkKey: "line_has_process", direction: "out", project: ["processId", "name", "yield"] },
            { linkKey: "equip_used_in", direction: "in", project: ["equipId", "oeeA"] },
          ],
          [{ linkKey: "order_for_model", direction: "out" }, { linkKey: "model_uses_material", direction: "out", project: ["matId", "name", "onHand"] }, { linkKey: "material_has_batch", direction: "out", limitPerNode: 10, project: ["batchId", "idleDays"] }],
          [{ linkKey: "order_for_model", direction: "out" }, { linkKey: "model_uses_material", direction: "out" }, { linkKey: "material_carbon", direction: "out", project: ["factorId", "factor"] }],
          [{ linkKey: "order_of_customer", direction: "out", project: ["custId", "custName"] }, { linkKey: "customer_has_invoice", direction: "out", limitPerNode: 10, project: ["invoiceId", "overdueDays"] }],
          [{ linkKey: "order_for_model", direction: "out" }, { linkKey: "model_has_cert", direction: "out", project: ["certId", "status", "certHours"] }],
          [{ linkKey: "order_for_model", direction: "out" }, { linkKey: "model_changeover", direction: "out", limitPerNode: 6, project: ["pairId", "minutes"] }],
          [{ linkKey: "order_for_model", direction: "out" }, { linkKey: "model_in_segment", direction: "out", project: ["segKey", "name", "gmRate"] }],
          [{ linkKey: "order_for_model", direction: "out" }, { linkKey: "model_producible_at", direction: "out" }, { linkKey: "base_energy_meter", direction: "out", project: ["meterId", "gridFactor"] }],
          [{ linkKey: "order_for_model", direction: "out" }, { linkKey: "model_producible_at", direction: "out" }, { linkKey: "base_has_shipment", direction: "out", project: ["shipId", "etaDay"] }],
          [{ linkKey: "order_for_model", direction: "out" }, { linkKey: "model_producible_at", direction: "out" }, { linkKey: "base_maint_plan", direction: "out", project: ["planId", "week"] }],
          [{ linkKey: "order_for_model", direction: "out" }, { linkKey: "model_producible_at", direction: "out" }, { linkKey: "base_data_health", direction: "out", project: ["sourceId", "lagHours"] }],
        ],
        maxNodes: 1000,
        contractFixtures: [
          {
            name: "首单最大广度可达 8 域 + 12 类节点",
            args: { so: "SO-10001" },
            expect: {
              rootType: "Order",
              minNodes: 20,
              mustIncludeTypes: ["Order", "Model", "Base", "Line", "Process", "Equipment", "Material", "MaterialBatch", "CarbonFactor", "Customer", "ARInvoice", "Certification", "ChangeoverMatrix", "Segment", "EnergyMeter", "Shipment", "MaintPlan", "DataSourceHealth"],
              mustIncludeLinkKeys: ["model_has_cert", "material_carbon", "customer_has_invoice", "model_changeover", "model_in_segment", "base_energy_meter", "base_maint_plan", "base_data_health"],
            },
          },
        ],
      },
    },
  ];
}

export const BATTERY_TEMPLATE: IndustryTemplate = {
  industryKey: "battery-manufacturing",
  ontology: {
    objectTypes: batteryObjectTypes(),
    linkTypes: batteryLinkTypes(),
  },
  generation: [
    {
      typeKey: "Base",
      count: { S: 12, M: 12, L: 12, XL: 12 },
      propGenerators: {
        util: { kind: "number", min: 0.62, max: 0.97, precision: 2 },
        gwh: { kind: "number", min: 6, max: 42, precision: 1 },
        bottleneck: { kind: "enum", values: BOTTLENECKS },
      },
    },
    {
      typeKey: "Model",
      count: { S: 6, M: 6, L: 6, XL: 6 },
      propGenerators: { unitPrice: { kind: "number", min: 380, max: 980, precision: 0 } },
    },
    {
      typeKey: "Order",
      count: { S: 20, M: 60, L: 200, XL: 10000 },
      propGenerators: {
        so: { kind: "pattern", pattern: "SO-{seq:5}" },
        cust: { kind: "enum", values: CUSTOMERS },
        model: { kind: "fkSample", refTypeKey: "Model" },
        qty: { kind: "number", min: 100, max: 2500, precision: 0 },
        due: { kind: "date", from: "2026-07-01", to: "2026-12-31" },
      },
    },
  ],
  rules: [
    { key: "C03", name: "产能上限约束", expression: "Order.demandDelta > 0.5", severity: "BLOCK" },
    { key: "C08", name: "外协比例红线", expression: "Order.outsourceRatio > 0.3", severity: "WARN" },
    { key: "C13", name: "客户信用额度", expression: "Order.creditUsedRatio > 1", severity: "BLOCK" },
    // A8.5 timeseries rules — evaluated against ts_agg_runs by RULE_SCAN (SUSTAIN).
    { key: "C05", name: "产线利用率持续越线", expression: "SUSTAIN(Line.utilization > 95, 3)", severity: "WARN" },
    { key: "C12", name: "预测偏差触发重校", expression: "SUSTAIN(Model.forecast_deviation > 0.08, 1)", severity: "WARN" },
    // §7.14 年度情景规则校验（情景卡的 C18/C23 行走真实规则引擎）。
    { key: "C18", name: "现金垫底线", expression: "AnnualScenario.cashCushion < 50", severity: "BLOCK" },
    { key: "C23", name: "CAPEX 情景测算门槛", expression: "AnnualScenario.capex >= 10", severity: "WARN" },
  ],
  scenarioSeed: { views: ["dash", "graph", "risk", "order", "plan-audit", "plan-generate", "project-sim", "sop-balance"], intents: [] },
  features: [...ALL_FEATURE_KEYS],
  solverParams: BATTERY_SOLVER_PARAMS,
  // A8.6 §6.1 — measureField/weightField are battery-pack extensions consumed by the generator.
  tsGenerators: [
    { seriesKey: "oee:equip", entityType: "Equipment", grain: "day", base: { mean: 0.78, noise: 0.04 }, effects: ["maint_window_dip", "weekend_dip"], measureField: "oee", weightField: "output" },
    { seriesKey: "yield:process", entityType: "Process", grain: "day", base: { mean: 0.952, noise: 0.008 }, effects: ["maint_window_dip"], measureField: "yield" },
    { seriesKey: "output:line", entityType: "Line", grain: "day", base: { mean: 30000, noise: 1800 }, drift: 8, effects: ["weekend_dip", "maint_window_dip", "ramp_curve"], measureField: "output" },
    { seriesKey: "attainment:line", entityType: "Line", grain: "day", base: { mean: 0.914, noise: 0.02 }, measureField: "attainment" },
    { seriesKey: "util:line", entityType: "Line", grain: "day", base: { mean: 92, noise: 1.2 }, effects: ["maint_window_dip"], measureField: "util" },
  ],
  scenarioScript: [
    { tick: 3, event: "iot_delay", params: { lagHours: 4.2 } },
    { tick: 5, event: "shipment_delay", params: { baseId: "changzhou", days: 5 } },
    { tick: 8, event: "yield_drop", params: { utilBoost: 8, yieldFactor: 0.95 } },
  ],
};

/** A8.2 built-in aggregation specs for the battery pack. */
export const BATTERY_TS_AGG_SPECS: {
  key: string;
  seriesKey: string;
  window: { grain: "shift" | "day" | "week"; rolling?: number };
  agg: "avg" | "sum" | "min" | "max" | "p95" | "weighted_avg";
  weightField?: string;
  output: { objectType: string; property: string };
}[] = [
  { key: "oee_daily_7d", seriesKey: "oee:equip", window: { grain: "day", rolling: 7 }, agg: "weighted_avg", weightField: "output", output: { objectType: "Equipment", property: "oee_current" } },
  { key: "yield_daily", seriesKey: "yield:process", window: { grain: "day" }, agg: "avg", output: { objectType: "Process", property: "yield_baseline" } },
  { key: "line_output_daily", seriesKey: "output:line", window: { grain: "day" }, agg: "sum", output: { objectType: "Line", property: "actual_output_daily" } },
  { key: "schedule_attainment", seriesKey: "attainment:line", window: { grain: "week" }, agg: "avg", output: { objectType: "Line", property: "schedule_attainment" } },
  { key: "line_util_daily", seriesKey: "util:line", window: { grain: "day" }, agg: "avg", output: { objectType: "Line", property: "utilization" } },
  { key: "forecast_dev_daily", seriesKey: "forecast_dev:model", window: { grain: "day" }, agg: "avg", output: { objectType: "Model", property: "forecast_deviation" } },
];

/** S2: built-in ActionTypes for the battery pack. */
export const BATTERY_ACTION_TYPES = [
  {
    key: "adopt_mitigation",
    name: "采纳处置方案",
    paramsSchema: { type: "object", required: ["base", "factor", "planKey"], properties: { base: { type: "string" }, factor: { type: "string" }, planKey: { type: "string" } } },
    checkRules: [] as string[],
    approvalChain: [{ role: "planner" }, { role: "admin" }],
  },
  {
    key: "plan_change",
    name: "计划变更",
    paramsSchema: { type: "object", required: ["versionId", "reason"], properties: { versionId: { type: "string" }, reason: { type: "string" }, patch: { type: "object" } } },
    checkRules: [] as string[],
    approvalChain: [{ role: "admin" }],
  },
  // §7.14 「拍板情景」：finalize 经 Action 审批执行（不直改）。
  {
    key: "AOP情景拍板",
    name: "AOP 情景拍板",
    paramsSchema: { type: "object", required: ["scenarioKey", "year"], properties: { scenarioKey: { type: "string" }, year: { type: "number" } } },
    checkRules: [] as string[],
    approvalChain: [{ role: "admin" }],
  },
  // §7.21 校准参数变更：提案批准/回滚走 §S2 审批流。
  {
    key: "校准参数变更",
    name: "校准参数变更",
    paramsSchema: { type: "object", required: ["proposalId", "mode"], properties: { proposalId: { type: "string" }, mode: { type: "string" } } },
    checkRules: [] as string[],
    approvalChain: [{ role: "admin" }],
  },
  // 增量 §0-4 / §7.11：规划建议「采纳方案」（payload = 方案快照 + 当前目标面板值）。
  {
    key: "采纳经营方案",
    name: "采纳经营方案",
    paramsSchema: {
      type: "object",
      required: ["schemeNo", "scheme", "targets"],
      properties: { schemeNo: { type: "string" }, pathKey: { type: "string" }, scheme: { type: "object" }, targets: { type: "object" } },
    },
    checkRules: [] as string[],
    approvalChain: [{ role: "admin" }],
  },
  // 增量 §7.12：S&OP 定稿走 Action（payload = 版本快照 + 决议清单），EXECUTED → 版本 FINAL（C22 锁定）。
  {
    key: "定稿月度计划版本",
    name: "定稿月度计划版本",
    paramsSchema: {
      type: "object",
      required: ["versionId", "snapshot"],
      properties: { versionId: { type: "string" }, month: { type: "string" }, snapshot: { type: "object" }, resolutions: { type: "array" } },
    },
    checkRules: [] as string[],
    approvalChain: [{ role: "admin" }],
  },
  // 增量 §7.12 锁定态「发起变更」：FINAL 版本字段变更的唯一合法路径。
  {
    key: "计划版本变更",
    name: "计划版本变更",
    paramsSchema: {
      type: "object",
      required: ["versionId", "reason"],
      properties: { versionId: { type: "string" }, reason: { type: "string" }, patch: { type: "object" } },
    },
    checkRules: [] as string[],
    approvalChain: [{ role: "admin" }],
  },
  // 增量 §7.13：项目推演 what-if「采纳产能保障方案」（payload = 参数组合 + 推演快照）。
  {
    key: "采纳产能保障方案",
    name: "采纳产能保障方案",
    paramsSchema: {
      type: "object",
      required: ["modelId", "whatIf"],
      properties: { modelId: { type: "string" }, whatIf: { type: "object" }, snapshot: { type: "object" } },
    },
    checkRules: [] as string[],
    approvalChain: [{ role: "admin" }],
  },
];

/** 模板规则的 scopeObjectTypes（合成种子使用；默认 Order）。 */
export const BATTERY_RULE_SCOPES: Record<string, string[]> = {
  C03: ["Order"],
  C08: ["Order"],
  C13: ["Order"],
  C05: ["Line"],
  C12: ["Model"],
  C18: ["AnnualScenario"],
  C23: ["AnnualScenario"],
};

export interface GeneratedBattery {
  bases: Record<string, unknown>[];
  models: Record<string, unknown>[];
  orders: Record<string, unknown>[];
  lines: Record<string, unknown>[];
  processes: Record<string, unknown>[];
  equipment: Record<string, unknown>[];
  maintPlans: Record<string, unknown>[];
  segments: Record<string, unknown>[];
  shipments: Record<string, unknown>[];
  dataHealth: Record<string, unknown>[];
  /** model ↔ line certification edges with props.status (量产 | 认证中). */
  certLinks: { modelId: string; lineId: string; baseId: string; status: "量产" | "认证中" }[];
}

const SERIAL_STEPS = [
  { suffix: "coating", name: "涂布" },
  { suffix: "winding", name: "卷绕" },
  { suffix: "assembly", name: "装配" },
];

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Deterministic generation: master data (Base) → Model → Order → production
 * topology (Line/Process/Equipment) → calendars (MaintPlan/Shipment) → misc.
 * Referential integrity by construction; same seed → byte-identical output.
 */
export function generateBattery(seed: number, scale: "S" | "M" | "L" | "XL"): GeneratedBattery {
  const rng = mulberry32(seed);
  const orderCount = scale === "S" ? 20 : scale === "M" ? 60 : scale === "XL" ? 10000 : 200;
  const t0 = Date.parse(`${BATTERY_SOLVER_PARAMS.forecastStart as string}T00:00:00Z`);

  const bases = BASES.map((b) => ({
    baseId: b.baseId,
    name: b.name,
    kind: b.kind,
    util: round(0.62 + rng() * 0.35, 2),
    bottleneck: pick(rng, BOTTLENECKS),
    gwh: round(6 + rng() * 36, 1),
    formationCapDaily: 0, // filled after process generation (shared-resource cap)
    agingCapDaily: 0,
  }));

  const models = MODELS.map((m) => {
    const n = randInt(rng, 2, 5);
    const shuffled = [...BASES.map((b) => b.baseId)];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = shuffled[i] as string;
      shuffled[i] = shuffled[j] as string;
      shuffled[j] = tmp;
    }
    return {
      modelId: m.modelId,
      name: m.name,
      bases: shuffled.slice(0, n).sort(),
      unitPrice: randInt(rng, 380, 980),
      // C33：NCM 体系碳足迹 >70 阈值（越线），LFP 达标。
      carbonFootprint: m.modelId.includes("NCM") ? 76 : 58,
    };
  });

  const orders: Record<string, unknown>[] = [];
  for (let i = 0; i < orderCount; i++) {
    const model = models[Math.floor(rng() * models.length)] as (typeof models)[number];
    const producible = model.bases;
    const nBases = randInt(rng, 1, Math.min(2, producible.length));
    const start = Math.floor(rng() * producible.length);
    const orderBases = Array.from({ length: nBases }, (_, k) => producible[(start + k) % producible.length] as string).sort();
    const dueDay = randInt(rng, 0, 180);
    const due = new Date(Date.UTC(2026, 6, 1) + dueDay * 86400000).toISOString().slice(0, 10);
    const so = `SO-${String(10001 + i).padStart(5, "0")}`;
    // 约束扫描字段：从确定性量(i / hashString(so) / dueDay)派生，不动 rng 流（保持既有字节级一致）；
    // 按固定步长植入越线行：C03 demandDelta>0.5、C08 outsourceRatio>0.2、C13 creditUsedRatio>1、C29 leadDays<3。
    orders.push({
      so,
      cust: pick(rng, CUSTOMERS),
      model: model.modelId,
      qty: randInt(rng, 100, 2500),
      due,
      bases: orderBases,
      status: "OPEN",
      unitPrice: model.unitPrice, // copied for the derived value formula
      demandDelta: i % 25 === 0 ? 0.6 : round((hashString(so) % 50) / 100, 2),
      outsourceRatio: i % 17 === 0 ? 0.35 : round((hashString(`${so}o`) % 18) / 100, 2),
      creditUsedRatio: i % 13 === 0 ? 1.15 : round(0.4 + (hashString(`${so}c`) % 50) / 100, 2),
      leadDays: dueDay,
    });
  }

  // ---- production topology (separate sub-streams keep base/model/order streams stable) --
  const rngTopo = mulberry32(seed ^ hashString("topology"));
  const lines: Record<string, unknown>[] = [];
  const processes: Record<string, unknown>[] = [];
  const equipment: Record<string, unknown>[] = [];
  for (const b of bases) {
    const lineId = `LINE-${b.baseId}`;
    lines.push({ lineId, baseId: b.baseId, name: `${b.name}一号线` });
    for (const step of SERIAL_STEPS) {
      const processId = `${lineId}-${step.suffix}`;
      processes.push({
        processId,
        lineId,
        baseId: b.baseId,
        name: step.name,
        kind: "serial",
        yield: round(0.95 + rngTopo() * 0.04, 3),
        shiftHours: 11,
        shifts: 2,
        attendance: round(0.92 + rngTopo() * 0.06, 3),
        utilization: round(0.88 + rngTopo() * 0.08, 3),
        channels: 0,
        channelOutputDaily: 0,
        agingSlots: 0,
        agingDays: 0,
      });
      for (let e = 1; e <= 2; e++) {
        equipment.push({
          equipId: `${processId}-E${e}`,
          processId,
          lineId,
          baseId: b.baseId,
          ctSeconds: round(1.1 + rngTopo() * 0.5, 2),
          availFactor: round(0.86 + rngTopo() * 0.08, 3),
          oeeA: round(0.9 + rngTopo() * 0.06, 3),
          oeeP: round(0.88 + rngTopo() * 0.08, 3),
          oeeQ: round(0.96 + rngTopo() * 0.03, 3),
        });
      }
    }
    const channels = randInt(rngTopo, 600, 780);
    const channelOutputDaily = randInt(rngTopo, 80, 95);
    processes.push({
      processId: `${lineId}-formation`,
      lineId,
      baseId: b.baseId,
      name: "化成",
      kind: "formation",
      yield: round(0.97 + rngTopo() * 0.02, 3),
      shiftHours: 24,
      shifts: 1,
      attendance: 1,
      utilization: 1,
      channels,
      channelOutputDaily,
      agingSlots: 0,
      agingDays: 0,
    });
    const agingSlots = randInt(rngTopo, 260000, 340000);
    const agingDays = 5;
    processes.push({
      processId: `${lineId}-aging`,
      lineId,
      baseId: b.baseId,
      name: "老化",
      kind: "aging",
      yield: 1,
      shiftHours: 24,
      shifts: 1,
      attendance: 1,
      utilization: 1,
      channels: 0,
      channelOutputDaily: 0,
      agingSlots,
      agingDays,
    });
    // Shared-resource caps slightly above single-line capability (C01 design ceiling).
    b.formationCapDaily = channels * channelOutputDaily + randInt(rngTopo, 2000, 6000);
    b.agingCapDaily = Math.floor(agingSlots / agingDays) + randInt(rngTopo, 2000, 6000);
  }

  // ---- maintenance plans: forecast week 3..10 + the aligned historic occurrence --
  const maintPlans = bases.map((b, i) => {
    const week = 3 + ((i + seed) % 8);
    return {
      planId: `MP-${b.baseId}`,
      baseId: b.baseId,
      week,
      lastMaintStart: isoDate(t0 - (12 - week) * 7 * 86400000),
    };
  });

  // ---- certification edges: each model has 量产 and ≥1 认证中 line --
  const rngCert = mulberry32(seed ^ hashString("cert"));
  const certLinks: GeneratedBattery["certLinks"] = [];
  for (const m of models) {
    const mb = m.bases as string[];
    mb.forEach((baseId, idx) => {
      const status: "量产" | "认证中" =
        idx === 0 ? "量产" : idx === mb.length - 1 ? "认证中" : rngCert() < 0.7 ? "量产" : "认证中";
      certLinks.push({ modelId: m.modelId, lineId: `LINE-${baseId}`, baseId, status });
    });
  }

  const segments = [
    { segKey: "pas", name: "乘用车", gmRate: 18, baselineShare: 0.52 },
    { segKey: "ess", name: "储能", gmRate: 13, baselineShare: 0.32 },
    { segKey: "com", name: "商用车", gmRate: 15, baselineShare: 0.16 },
  ];

  const rngShip = mulberry32(seed ^ hashString("shipments"));
  const shipments = bases.map((b) => ({
    shipId: `SHIP-${b.baseId}`,
    baseId: b.baseId,
    etaDay: randInt(rngShip, 2, 16),
    status: "IN_TRANSIT",
    qtyTons: randInt(rngShip, 60, 240),
    coverageDays: b.baseId === "changzhou" ? 2 : 5, // C16：常州在途覆盖 <3 天（越线戏剧点）
  }));

  const dataHealth = [
    { sourceId: "iot-scada", name: "IoT/SCADA 实时采集", critical: true, lagHours: 0.5 },
  ];

  return { bases, models, orders, lines, processes, equipment, maintPlans, segments, shipments, dataHealth, certLinks };
}

// ---------------------------------------------------------------------------
// §7.14 计划域种子：年度情景 ×3 / 触发条件 ×4 / 年→季→月目标分解（PlanTarget）。
// 分解值锚定在与 S&OP 平衡台同源的供给口径（weeklyTotalWan 来自 S1.1 rollup），
// 同 (industry, scale, seed) 重跑字节级一致 —— 不使用时钟与随机性。
// ---------------------------------------------------------------------------

export interface GeneratedPlanDomain {
  scenarios: Record<string, unknown>[];
  triggers: Record<string, unknown>[];
  planTargets: Record<string, unknown>[];
}

export function generatePlanDomain(weeklyTotalWan: number, avgUnitPrice: number): GeneratedPlanDomain {
  const pv = BATTERY_SOLVER_PARAMS.planview as {
    seasonal: number[];
    scenarios: {
      conservativeFactor: number;
      aggressiveFactor: number;
      finance: Record<string, { cashCushion: number; capex: number; irr: number }>;
    };
  };
  const year = 2026;
  const annualBase = round(weeklyTotalWan * 52, 1);
  const fin = pv.scenarios.finance;
  const revenueOf = (demand: number) => round((demand * avgUnitPrice) / 10000, 1); // 万套×元/套 → 亿
  const scenario = (key: string, name: string, demand: number, decision: string, lta: string, finalized: boolean) => ({
    scnId: `AOP-${year}-${key}`,
    key,
    name,
    year,
    demand,
    capacityDecision: decision,
    ltaLock: lta,
    revenue: revenueOf(demand),
    capex: (fin[key] as { capex: number }).capex,
    irr: (fin[key] as { irr: number }).irr,
    cashCushion: (fin[key] as { cashCushion: number }).cashCushion,
    finalized,
    ...(finalized ? { finalizedAt: `${year}-06-20T09:00:00.000Z` } : {}),
  });
  const scenarios = [
    scenario("conservative", "保守", round(annualBase * pv.scenarios.conservativeFactor, 1), "维持现有产线，不新增产能投资", "锂盐长协锁量 60%，季度滚动议价", false),
    scenario("baseline", "基准", annualBase, "合肥四期 8GWh 扩产，2027-Q2 投产", "锂盐长协锁量 70%，年度锁价", true),
    scenario("aggressive", "激进", round(annualBase * pv.scenarios.aggressiveFactor, 1), "合肥四期 + 盐城二期合计 20GWh 扩产", "锂盐长协锁量 85%，并签三年框架", false),
  ];

  // 目标分解：月值 = 年需求 × 季节权重/12；末月吸收舍入差 → 年 = Σ季 = Σ月（同源勾稽）。
  const demand = annualBase;
  const months: { period: string; value: number }[] = [];
  let acc = 0;
  for (let m = 1; m <= 12; m++) {
    const w = pv.seasonal[m - 1] as number;
    const v = m === 12 ? round(demand - acc, 2) : round((demand * w) / 12, 2);
    acc = round(acc + v, 2);
    months.push({ period: `${year}-${String(m).padStart(2, "0")}`, value: v });
  }
  const quarters: { period: string; value: number }[] = [];
  for (let q = 0; q < 4; q++) {
    const v = round((months[q * 3] as { value: number }).value + (months[q * 3 + 1] as { value: number }).value + (months[q * 3 + 2] as { value: number }).value, 2);
    quarters.push({ period: `${year}-Q${q + 1}`, value: v });
  }
  const yearValue = round(quarters.reduce((a, q) => a + q.value, 0), 2);
  const target = (period: string, level: string, value: number) => ({
    tgtId: `PT-${period}`,
    period,
    level,
    value,
    year,
    scenarioKey: "baseline",
  });
  const planTargets = [
    target(String(year), "year", yearValue),
    ...quarters.map((q) => target(q.period, "quarter", q.value)),
    ...months.map((m) => target(m.period, "month", m.value)),
  ];

  // 触发条件挂牌（expr 在后端 RULE_SCAN 周期里对 metrics 求值；一条已触发）。
  const triggers = [
    {
      trigId: "TRG-1",
      condition: "季度产销缺口 > 4 万套",
      expr: "quarterGapMax > 4",
      action: "启动激进情景预案评审，升级高管决策会",
      status: "TRIGGERED",
      triggeredAt: "2026-06-28T08:00:00.000Z",
      notifiedTo: ["admin", "planner"],
    },
    {
      trigId: "TRG-2",
      condition: "储能细分需求增速连续 2 季 > 25%",
      expr: "essGrowthPct > 25",
      action: "上调储能产线认证优先级，追加 S192 认证",
      status: "MONITORING",
    },
    {
      trigId: "TRG-3",
      condition: "长协到货偏差率 |绝对值| > 12%",
      expr: "ltaDevMaxAbs > 12",
      action: "升级供应风险，启动备选供应商切换",
      status: "MONITORING",
    },
    {
      trigId: "TRG-4",
      condition: "锂价指数单月涨幅 > 20%",
      expr: "lithiumIndexMoM > 20",
      action: "触发保守情景成本重测，重审长协锁量",
      status: "MONITORING",
    },
  ];
  return { scenarios, triggers, planTargets };
}
