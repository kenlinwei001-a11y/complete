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
  affected: { windowBefore: 7, windowAfter: 14, delayDiv: 8, jitterMod: 3, fallbackMax: 5 },
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
    targets: { gmFloor: 0.135, cashFloor: 45, capexCap: 20 },
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
  sop: { gapRed: 2, dvThreshold: 0.1, cashFloor: 50, monthlyWeeks: 4, gmTolerance: 0.5 },
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
];

const dataHealthProps: PropertyDef[] = [
  { propKey: "sourceId", dataType: "string", isPrimaryKey: true },
  { propKey: "name", dataType: "string", isPrimaryKey: false },
  { propKey: "critical", dataType: "boolean", isPrimaryKey: false },
  { propKey: "lagHours", dataType: "number", isPrimaryKey: false },
];

export function batteryObjectTypes(): Omit<ObjectTypeDef, "id" | "tenantId" | "version" | "status">[] {
  const plain = (key: string, displayName: string, properties: PropertyDef[]): Omit<ObjectTypeDef, "id" | "tenantId" | "version" | "status"> => ({
    key,
    displayName,
    properties,
    derivedProperties: [],
    sourceBindings: [],
  });
  return [
    { key: "Base", displayName: "生产基地", properties: baseProps, derivedProperties: baseDerived, sourceBindings: [] },
    { key: "Model", displayName: "电池型号", properties: modelProps, derivedProperties: modelDerived, sourceBindings: [] },
    { key: "Order", displayName: "销售订单", properties: orderProps, derivedProperties: orderDerived, sourceBindings: [] },
    plain("Line", "产线", lineProps),
    plain("Process", "工序", processProps),
    plain("Equipment", "设备", equipmentProps),
    plain("MaintPlan", "检修计划", maintPlanProps),
    plain("Segment", "应用细分", segmentProps),
    plain("Shipment", "在途批次", shipmentProps),
    plain("DataSourceHealth", "数据源健康度", dataHealthProps),
  ];
}

export function batteryLinkTypes(): Omit<LinkTypeDef, "id" | "tenantId" | "version">[] {
  return [
    { key: "model_producible_at", fromTypeKey: "Model", toTypeKey: "Base", cardinality: "N:N" },
    { key: "order_for_model", fromTypeKey: "Order", toTypeKey: "Model", cardinality: "1:N" },
    // §S1.2: certification state lives on the model↔line edge (props.status 量产 | 认证中).
    { key: "model_certified_on", fromTypeKey: "Model", toTypeKey: "Line", cardinality: "N:N" },
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
      count: { S: 12, M: 12, L: 12 },
      propGenerators: {
        util: { kind: "number", min: 0.62, max: 0.97, precision: 2 },
        gwh: { kind: "number", min: 6, max: 42, precision: 1 },
        bottleneck: { kind: "enum", values: BOTTLENECKS },
      },
    },
    {
      typeKey: "Model",
      count: { S: 6, M: 6, L: 6 },
      propGenerators: { unitPrice: { kind: "number", min: 380, max: 980, precision: 0 } },
    },
    {
      typeKey: "Order",
      count: { S: 20, M: 60, L: 200 },
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
];

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
export function generateBattery(seed: number, scale: "S" | "M" | "L"): GeneratedBattery {
  const rng = mulberry32(seed);
  const orderCount = scale === "S" ? 20 : scale === "M" ? 60 : 200;
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
    orders.push({
      so: `SO-${String(10001 + i).padStart(5, "0")}`,
      cust: pick(rng, CUSTOMERS),
      model: model.modelId,
      qty: randInt(rng, 100, 2500),
      due,
      bases: orderBases,
      status: "OPEN",
      unitPrice: model.unitPrice, // copied for the derived value formula
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
  }));

  const dataHealth = [
    { sourceId: "iot-scada", name: "IoT/SCADA 实时采集", critical: true, lagHours: 0.5 },
  ];

  return { bases, models, orders, lines, processes, equipment, maintPlans, segments, shipments, dataHealth, certLinks };
}
