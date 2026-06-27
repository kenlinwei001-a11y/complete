import type { ObjectInstance } from "../domain.js";

/** Typed view over the per-tenant solverParams JSONB (battery defaults in synthetic/battery.ts). */
export interface SolverParamsShape {
  forecastStart: string;
  packCellCount: number;
  certFactors: Record<string, number>;
  ramp: { base: number; step: number; fullWeek: number };
  maintMult: number;
  health: { normal: number; degraded: number; staleHours: number };
  whatIf: { nightShiftCoef: number; channelCoef: number; outsourceMax: number };
  logistics: { byAddress: Record<string, number>; defaultDays: number };
  bottleneck: {
    factors: string[];
    primary: Record<string, string>;
    defaultPrimary: string;
    mock: {
      mod: number;
      factorMult: number;
      primaryBase: number;
      primaryCap: number;
      secondaryBase: number;
      secondaryCap: number;
      utilHigh: number;
      utilHighAdd: number;
      utilLowAdd: number;
    };
    live: { oeeK: number; oeeBase: number; utilK: number; utilBase: number; yieldK: number; yieldBase: number };
  };
  risk: {
    threshold: number;
    cap: number;
    rampDen: number;
    pulseWindow: number;
    pulseDecayDen: number;
    psFloor: number;
    psStart: number;
    psDen: number;
    maxCards: number;
    targetLift: { base: number; mod: number };
    eventAmps: { maint_window: number; delivery_peak: number; arrival_gap: number };
    arrivalCycleDays: number;
    mitigations: Record<string, { key: string; name: string; eff: number; tn: number; cost: string; risk: string }[]>;
  };
  affected: {
    windowBefore: number;
    windowAfter: number;
    delayDiv: number;
    jitterMod: number;
    fallbackMax: number;
    /** §S1.5 修订: problems[] 4 类归并阈值 */
    problems: {
      creditBase: number;
      creditMod: number;
      gmFloor: number;
      essModels: string[];
      comModels: string[];
      ruleKeys: Record<string, string>;
      /** 母版 ROOT_LIB 8 根源配置（credit/cost/frame/crm/lta/maint/ramp/push）：每类标题/规则号/对策。 */
      rootCauses?: Record<string, { title: string; ruleRefs: string; remedy: string }>;
      /** PRD-IND-dash ORDER_OVR：逐单越线注入（按 so 覆盖信用/毛利 + why + root 根因类型）——确定性种子。 */
      overrides?: Record<string, { credit?: boolean; mAdj?: number; why?: string; root?: string }>;
    };
  };
  /** C1 · capex_scenario 年度情景测算参数（C23 门槛 + 三情景产能项目集） */
  capexScenario?: {
    /** C23 IRR 门槛（0..1，默认 0.15） */
    irrThreshold: number;
    /** C23 24月利用率门槛（0..1，默认 0.75） */
    util24Threshold: number;
    /** 单位边际毛利（元/套，缺省项目无 m 时回落） */
    unitMargin: number;
    /** 三情景的产能项目集（投产季 q0 相对窗口起点；capex 亿/季；ramp 默认 [0.5,0.75,0.9,1.0]） */
    scenarios: Record<
      string,
      {
        projects: {
          id: string;
          name: string;
          q0: number;
          cap: number;
          ramp?: number[];
          capex: number[];
          m: number;
          salvageRate?: number;
        }[];
      }
    >;
  };
  /** §7.14/§7.15 计划域参数 */
  planview: {
    seasonal: number[];
    rollingCorrPct: number[];
    growthYoY: number;
    weeksPerQuarter: number;
    increments: { quarter: string; name: string; delta: number }[];
    ltaMaterials: string[];
    /** PRD-IND-quarter §4.5(C)：LTA 计划吨/季 + 逐行偏差%（专属配置位，缺则回落 Shipment/hash）。 */
    ltaPlanned?: number[];
    ltaDevPct?: number[];
    ltaForcedPct: number;
    deliveryPeakMin: number;
    scenarios: {
      conservativeFactor: number;
      aggressiveFactor: number;
      finance: Record<string, { cashCushion: number; capex: number; irr: number }>;
    };
  };
  audit: {
    segTolerance: number;
    gapHard: number;
    gapSoft: number;
    gmHardOver: number;
    gmSoftUnder: number;
    kitHard: number;
    kitFixTons: number;
    cashHard: number;
    cashSoft: number;
    essShareBaseline: number;
    essShareTol: number;
    capexSoft: number;
    segMargins: { pas: number; ess: number; com: number };
    scoreH: number;
    scoreM: number;
    passScore: number;
    condScore: number;
    extGmBufferMin: number;
    extDemHigh: number;
  };
  planGenerate: {
    base: { rev: number; gm: number; share: number; turns: number; cash: number };
    targets: {
      gmFloor: number;
      cashFloor: number;
      capexCap: number;
      revGrowthPct?: number;
      sharePts?: number;
      turnsFloor?: number;
    };
    paths: Record<string, { name: string; rev: number; gm: number; share: number; capex: number; turns: number; cash: number }>;
    scores: {
      profitBase: number;
      profitK: number;
      scaleBase: number;
      scaleK: number;
      cashBase: number;
      cashK: number;
      growthBase: number;
      growthK: number;
      stabBase: number;
      stabK: number;
      hardPenalty: number;
    };
    schemeNames: { steady: string; balanced: string; aggressive: string };
    gains: Record<string, string[]>;
    gives: Record<string, string[]>;
  };
  sop: {
    gapRed: number;
    dvThreshold: number;
    cashFloor: number;
    monthlyWeeks: number;
    gmTolerance: number;
    /** 增量 §7.12 KPI 条：收入预算达成% 的预算基数（亿） */
    revBudget?: number;
  };
  /**
   * 增量 §7.10 体检基线：plan-versions/current 中无法从 S&OP 步骤推导的字段
   * （长协覆盖率 / 物料缺口 / CAPEX / 毛利目标 / 现金垫）的确定性缺省值。
   */
  planBaseline?: {
    ltaCov: number;
    kitGap: number;
    gmTarget: number;
    cashCushion: number;
    capex: number;
  };
  dupSimilarityThreshold: number;
  /**
   * M11 校准算法层配置（场景包声明：可校准参数注册表 + 阈值开关）。
   * 每个参数声明 method（A=EMA / B=重放归因 / C=分位数匹配）、scope/path 与边界。
   */
  calibration?: CalibrationConfigShape;
}

export interface CalibratableParamDef {
  key: string;
  name: string;
  method: "EMA" | "REPLAY_ATTRIBUTION" | "QUANTILE";
  scope: "SOLVER_PARAMS" | "ONTOLOGY_PROPERTY";
  /** SOLVER_PARAMS: solver_params 点路径；ONTOLOGY_PROPERTY: "<ObjectType>.<prop>" */
  path: string;
  /** 方法 A：实测均值来源（ts_agg_specs key，A8 同窗口聚合） */
  observedSpecKey?: string;
  bounds: [number, number];
}

export interface CalibrationConfigShape {
  alpha: number; // 方法 A EMA 系数（默认 0.3）
  structuralDriftPct: number; // 结构性漂移闸门（默认 0.20）
  minImprovementPct: number; // §5 回测门槛（MAPE 百分点，默认 1）
  nMin: number; // §2 最小样本量/切片（默认 10）
  autoApply: boolean; // §6 自动生效开关（默认 false）
  autoApplyMaxDeltaPct: number; // 仅方法 A 且变幅 < 此值免审批（默认 0.05）
  freqLimitDays: number; // 同一 paramRef ≤1 次变更 / freqLimitDays（默认 7）
  metaLoopDays: number; // 元闭环回看天数（默认 14，模拟时钟激活时按模拟日）
  quantile: { lowCov: number; highCov: number; step: number; min: number; max: number };
  params: CalibratableParamDef[];
}

/** Ontology slice snapshot every solver computes from (deterministic input). */
export interface SolverContext {
  tenantId: string;
  params: SolverParamsShape;
  bases: ObjectInstance[];
  lines: ObjectInstance[];
  processes: ObjectInstance[];
  equipment: ObjectInstance[];
  maintPlans: ObjectInstance[];
  models: ObjectInstance[];
  orders: ObjectInstance[];
  shipments: ObjectInstance[];
  segments: ObjectInstance[];
  dataHealth: ObjectInstance[];
  /** modelId → baseId → 量产 | 认证中 (from model_certified_on edge props). */
  certByModel: Map<string, Map<string, string>>;
  // 20 场景目录 §7 扩展数据（E6b）：13 新求解器的对象数据源（optional，缺省视为空）。
  materials?: ObjectInstance[];
  materialBatches?: ObjectInstance[];
  customers?: ObjectInstance[];
  arInvoices?: ObjectInstance[];
  certifications?: ObjectInstance[];
  energyMeters?: ObjectInstance[];
  changeoverMatrix?: ObjectInstance[];
  capexProjects?: ObjectInstance[];
  purchaseOrders?: ObjectInstance[];
  carbonFactors?: ObjectInstance[];
  // 规则即引用（PRD-rules-as-references §2.2/§4）：本租户已发布规则快照（按 ruleKey 索引）+ 规则集版本
  // 指纹。求解器闸门据此调规则引擎得 PASS/WARN/BLOCK，阈值读 rule.params；推演记录 ruleSetVersion（R6）。
  // optional：缺省（如测试直接构造 ctx）视为无规则——向后兼容，不破 R6。
  rules?: Record<string, { key: string; name: string; expression: string; severity: "BLOCK" | "WARN" | "INFO"; params?: Record<string, number> }>;
  ruleSetVersion?: string;
}

export function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Days between forecastStart and an ISO date (date — start, in whole days). */
export function dayFrom(startIso: string, dateIso: string): number {
  return Math.round((Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${startIso.slice(0, 10)}T00:00:00Z`)) / 86400000);
}

export function baseName(c: SolverContext, baseId: string): string {
  const b = c.bases.find((x) => x.props.baseId === baseId);
  return str(b?.props.name, baseId);
}

export function maintWeekOf(c: SolverContext, baseId: string): number | null {
  const mp = c.maintPlans.find((m) => m.props.baseId === baseId);
  return mp ? num(mp.props.week) : null;
}
