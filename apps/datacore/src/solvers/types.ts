import type { ObjectInstance } from "../domain.js";

/** Typed view over the per-tenant solverParams JSONB (battery defaults in synthetic/battery.ts). */
export interface SolverParamsShape {
  forecastStart: string;
  packCellCount: number;
  certFactors: Record<string, number>;
  ramp: { base: number; step: number; fullWeek: number };
  maintMult: number;
  health: { normal: number; degraded: number; staleHours: number };
  /**
   * 方法库·随机模拟族离散度（METHOD-MC-STOCHASTIC · R14 零业务常数 · 可被 CALIBRATION_SWEEP 校准）。
   * 替代旧 `health.normal=0.93` 伪分位系数：P90 由「点估计×常数」→「种子化 MC 真实经验分位」。
   * dispersion=各角色变异系数 cv(σ/μ)；staleDispersionMult=关键源陈旧时对相关因子 cv 的放大倍数
   * （C09 诚实建模：陈旧→方差变宽→p90 下探，理由真实）。
   */
  mc?: {
    iterations: number;
    dispersion: Record<string, number>;
    staleDispersionMult: number;
  };
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
    pulseWindow: number;
    pulseDecayDen: number;
    psFloor: number;
    psStart: number;
    psDen: number;
    maxCards: number;
    eventAmps: { maint_window: number; delivery_peak: number; arrival_gap: number };
    arrivalCycleDays: number;
    /**
     * RISK-TRAJECTORY-DEFAKE（B8·可校准·非内联魔数）：cockpit 历史案例 severity 判据阈值。
     * score = util + (主瓶颈因子 ? primaryBonus : 0)；≥highScore→HIGH、≥medScore→MEDIUM、否则 LOW。
     */
    caseSeverity: { highScore: number; medScore: number; primaryBonus: number };
    /**
     * RISK-TRAJECTORY-DEFAKE（B9·可校准·非内联魔数）：需求-产能负载比→基地紧张度映射系数。
     * tension = base + (load−1)×loadGain×(shareBase + shareGain×share) + (util−utilPivot)×utilGain。
     */
    demandTension: {
      base: number;
      loadGain: number;
      shareBase: number;
      shareGain: number;
      utilPivot: number;
      utilGain: number;
      /** HARDCODE-SOLVER-PARAMS（ε1 残留闭合）：预测上行比权重（原 networkDemandSupplyLoad 内联 0.5）。 */
      upsideGain?: number;
      /** HARDCODE-SOLVER-PARAMS（ε1 残留闭合）：基地需求张力上限 clamp（原 demandCapacityTightness 内联 98）。 */
      tensionCap?: number;
    };
    /**
     * RISK-TRAJECTORY-DEFAKE（B6·可校准·非内联魔数）：交付高峰额外工时估算系数（人·班/万套）。
     * 估算值 = round(订单真 qty × deliveryLaborPerWan)，desc 明标「估算」（非实测工时）。
     */
    deliveryLaborPerWan: number;
    mitigations: Record<string, { key: string; name: string; eff: number; tn: number; cost: string; risk: string }[]>;
  };
  affected: {
    windowBefore: number;
    windowAfter: number;
    delayDiv: number;
    fallbackMax: number;
    /** §S1.5 修订: problems[] 4 类归并阈值 */
    problems: {
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
    /** HARDCODE-SOLVER-PARAMS（ε2 闭合）：audit 4 态判据——中风险项计数达该阈 → "可定稿但有重要风险"（原 plan.ts 内联 3）。 */
    verdictMedCount?: number;
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
  /**
   * HARDCODE-SOLVER-PARAMS（ε4 · 20 场景扩展求解器业务阈值/系数）——治 extended.ts「零 c.params·全内联魔数」。
   * 骨架键**零业务实体名**（R14）；具体默认值（含行业相关值）落 IndustryPack default `synthetic/battery.ts`。
   * 各求解器体读 `num(args.<key>, 内联默认)`（默认==原内联值→R6 字节一致），由对应 deriveArgs 注入本参数值→
   * 租户可配·可校准（改 param 改果·非死值）。全部 optional：param 缺省→回落体内内联默认（向后兼容）。
   */
  mitigation?: {
    /** urgency = max(0,(tightness−urgencyPivot)/urgencySpan)（原 70/30）。 */
    urgencyPivot: number;
    urgencySpan: number;
  };
  cert?: {
    /** C26 并行认证工程师组数缺省（原 deriveArgs 内联 3）。 */
    engineerGroups: number;
    /** 认证工时→周数换算（周 = ceil(certHours/hoursPerWeek)，原内联 40）。 */
    hoursPerWeek: number;
  };
  lta?: {
    /** 长协年度锁量占日均年需求比（原 deriveArgs 内联 0.8·audit「lock 0.8」）。 */
    lockRate: number;
    /** 现货补单最迟下单提前期缺省天（原内联 30）。 */
    leadDays: number;
  };
  inventory?: {
    /** 目标水位安全天（原 num(args.safetyDays,5)）。 */
    safetyDays: number;
    /** 超储阈：onHand > overMult×target（原内联 1.5）。 */
    overMult: number;
    /** 欠储阈：onHand < underMult×target（原内联 0.8）。 */
    underMult: number;
    /** C28 呆滞阈：idleDays > idleThreshold（原内联 90 天）。 */
    idleThreshold: number;
  };
  maintenance?: {
    /** C11 错峰检修搜索窗（±window 周·原内联 4）。 */
    window: number;
    /** 同基地两次检修最小间隔周（原内联 26）。 */
    minInterval: number;
    /** 同组同周检修上限（原内联 3）。 */
    groupWeekCap: number;
  };
  outsourcing?: {
    /** 三渠道单位成本（自产加班/外协/延期·原内联 1.0/1.4/2.5）。 */
    overtimeCost: number;
    outsourceCost: number;
    delayCost: number;
    /** 加班上限占缺口比（原内联 0.4）。 */
    overtimeCapPct: number;
    /** C08 外协上限占总需求比（原内联 0.2）。 */
    outsourceCapPct: number;
  };
  quote?: {
    /** C15/C24 细分毛利底线缺省（原 num(args.segmentFloor,0.1)）。 */
    floorDefault: number;
    /** 过线判定缓冲带（margin ≥ floor+band → 过线·原内联 0.01）。 */
    band: number;
  };
  credit?: {
    /** C32 逾期天阈：overdueDays > 此值 → 冻结（原内联 30）。 */
    overdueDays: number;
  };
  carbon?: {
    /** C33 碳足迹达标阈（原 num(args.euThreshold,70)）。 */
    euThreshold: number;
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
  // WO-FORECAST-SIM：推演接需求-产能真源——需求侧预测对象（forecast 域细分预测 DemandSegment + plan 域
  // S&OP 版本 SopVersionRow）。risk_timeline 紧张度由 demandCapacityTightness 派生（替 mockTightness 哈希），
  // 缺口 = 真预测需求 − 真产能 over horizon。optional 缺省视为空（向后兼容 R6·测试直构 ctx 不破）。
  demandSegments?: ObjectInstance[];
  sopVersions?: ObjectInstance[];
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
