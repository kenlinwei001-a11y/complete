import type { IndustryTemplate } from "@platform/contracts";
import { BASE_REGISTRY, SEG_REGISTRY, PLAN_GOAL_TARGETS } from "@platform/contracts";
import type { DerivedPropertyDef, LinkTypeDef, ObjectTypeDef, PropertyDef } from "../domain.js";
import { hashString, mulberry32, pick, randInt, round } from "../prng.js";
import { sampleValueDomain } from "./value-domains.js";
import { ALL_FEATURE_KEYS } from "../features.js";

/**
 * A6.3 电池收编：电池路连续值域字段（util/gwh 等）改走与通用路同一个 `sampleValueDomain` 共享机制
 * （单一值生成入口），消除电池独立的 `round(lo+rng()*range,p)` 平行实现。
 * **字节不变**：显式声明 `shape:"uniform"`（不走值域库默认的 normal）+ band=[lo, lo+range] + 同 precision，
 * sampleValueDomain 的 uniform 分支公式 `round(lo+rng()*(hi-lo),p)` 与原内联式逐位一致（单次 rng 抽样·R6 baseline 门守）。
 */
function uniformDomain(rng: () => number, lo: number, range: number, precision: number, propKey = ""): number {
  return sampleValueDomain({ kind: "valueDomain", shape: "uniform", band: [lo, lo + range], precision }, propKey, rng);
}

/** Built-in battery-manufacturing template (QOS-PRD §7.6 + addendum §S1/§A8 semantics). */

// 去电池锁死（R14）：基地经纬度作为对象数据随合成下发（前端 GeoMap 读 Base.props.lon/lat，不再写死）。
// DF.1 单一来源：基地集从 @platform/contracts BASE_REGISTRY 派生（跨包唯一真相源，灭漂移 G-5/R14）。
// 命名以 HTML BASE_DATA 为准；datacore 用 {baseId,name,kind,lon,lat} 子集（值字节复现，R6）。
export const BASES: { baseId: string; name: string; kind: "动力" | "储能" | "动力+储能"; lon: number; lat: number }[] =
  BASE_REGISTRY.map((b) => ({ baseId: b.baseId, name: b.name, kind: b.kind, lon: b.lon, lat: b.lat }));

// PRD-IND-model 缺口③：型号化学体系 chem(NCM|LFP) + 业态 pos（动力/储能/动力+储能），种子配置（前端零写死）。
// PRD-IND-order-aggregate：HTML 6 型号（MODEL_DEF L1542），命名以原型为单一真相源。
export const MODELS: { modelId: string; name: string; chem: "NCM" | "LFP"; pos: string }[] = [
  { modelId: "4680-NCM", name: "4680 三元圆柱", chem: "NCM", pos: "动力" },
  { modelId: "4680-LFP", name: "4680 磷酸铁锂圆柱", chem: "LFP", pos: "动力+储能" },
  { modelId: "2170-NCM", name: "2170 三元圆柱", chem: "NCM", pos: "动力" },
  { modelId: "方形-LFP", name: "方形 磷酸铁锂", chem: "LFP", pos: "储能" },
  { modelId: "方形-NCM", name: "方形 三元", chem: "NCM", pos: "动力" },
  { modelId: "圆柱-LFP", name: "圆柱 磷酸铁锂", chem: "LFP", pos: "储能" },
];

// PRD-IND-model / PRD-IND-risk §4.6：型号→可产基地确定性映射（HTML MODEL_DEF 范式，非随机）。
const MODEL_BASE_MAP: Record<string, string[]> = {
  "4680-NCM": ["changzhou", "chengdu", "hefei"], // HTML 4680-NCM → 常州/成都/合肥
  "4680-LFP": ["changzhou", "zaozhuang"], // HTML 4680-LFP → 常州/枣庄（动力+储能）
  "2170-NCM": ["xiamen", "wuhan", "zigong"], // HTML 2170-NCM → 厦门/武汉/自贡
  "方形-LFP": ["jiangmen", "meishan", "handan", "zaozhuang"], // HTML 方形-LFP → 江门/眉山/邯郸/枣庄
  "方形-NCM": ["changzhou", "chengdu"], // HTML 方形-NCM → 常州/成都
  "圆柱-LFP": ["xinyang", "luoyang"], // HTML 圆柱-LFP → 信阳/洛阳
};

// PRD-IND-order-aggregate：HTML 8 客户（应用细分按客户名判定：含「商用车」→商用车 · 含「储能/电网」→储能 · 否则乘用车）。
const CUSTOMERS = ["整车厂A", "整车厂B", "整车厂C", "海外车企E", "商用车集团G", "储能集成商D", "储能集成商H", "电网公司F"];
const BOTTLENECKS = ["电芯", "模组", "PACK", "化成"];

// PRD-IND-order-aggregate §4：HTML 24 单逐字（so/cust/model/qty[万套]/due/pri）。单一真相源=原型。
const HTML_ORDERS: { so: string; cust: string; model: string; qty: number; due: string; pri: string }[] = [
  { so: "SO-3391", cust: "整车厂A", model: "4680-NCM", qty: 8, due: "2026-06-24", pri: "高" },
  { so: "SO-3402", cust: "整车厂B", model: "4680-NCM", qty: 12, due: "2026-07-02", pri: "高" },
  { so: "SO-3415", cust: "整车厂C", model: "4680-NCM", qty: 6, due: "2026-07-18", pri: "中" },
  { so: "SO-3420", cust: "海外车企E", model: "4680-NCM", qty: 10, due: "2026-07-09", pri: "高" },
  { so: "SO-3431", cust: "整车厂A", model: "2170-NCM", qty: 9, due: "2026-06-28", pri: "中" },
  { so: "SO-3437", cust: "商用车集团G", model: "2170-NCM", qty: 7, due: "2026-07-14", pri: "中" },
  { so: "SO-3445", cust: "整车厂B", model: "方形-NCM", qty: 11, due: "2026-07-05", pri: "高" },
  { so: "SO-3452", cust: "储能集成商D", model: "方形-LFP", qty: 14, due: "2026-06-30", pri: "高" },
  { so: "SO-3458", cust: "电网公司F", model: "方形-LFP", qty: 18, due: "2026-07-12", pri: "高" },
  { so: "SO-3464", cust: "储能集成商H", model: "方形-LFP", qty: 9, due: "2026-07-25", pri: "中" },
  { so: "SO-3470", cust: "电网公司F", model: "圆柱-LFP", qty: 6, due: "2026-07-08", pri: "中" },
  { so: "SO-3476", cust: "储能集成商D", model: "4680-LFP", qty: 8, due: "2026-07-20", pri: "中" },
  { so: "SO-3481", cust: "整车厂A", model: "4680-NCM", qty: 10, due: "2026-07-11", pri: "高" },
  { so: "SO-3486", cust: "整车厂C", model: "方形-NCM", qty: 7, due: "2026-07-22", pri: "中" },
  { so: "SO-3490", cust: "海外车企E", model: "4680-NCM", qty: 13, due: "2026-07-06", pri: "高" },
  { so: "SO-3495", cust: "电网公司F", model: "方形-LFP", qty: 15, due: "2026-07-16", pri: "高" },
  { so: "SO-3501", cust: "储能集成商H", model: "方形-LFP", qty: 11, due: "2026-07-28", pri: "中" },
  { so: "SO-3506", cust: "商用车集团G", model: "2170-NCM", qty: 8, due: "2026-07-19", pri: "中" },
  { so: "SO-3512", cust: "整车厂B", model: "方形-NCM", qty: 9, due: "2026-07-03", pri: "高" },
  { so: "SO-3518", cust: "储能集成商D", model: "方形-LFP", qty: 13, due: "2026-07-24", pri: "中" },
  { so: "SO-3523", cust: "整车厂A", model: "4680-NCM", qty: 11, due: "2026-07-13", pri: "高" },
  { so: "SO-3529", cust: "电网公司F", model: "圆柱-LFP", qty: 7, due: "2026-07-10", pri: "中" },
  { so: "SO-3534", cust: "海外车企E", model: "4680-NCM", qty: 12, due: "2026-07-27", pri: "高" },
  { so: "SO-3540", cust: "商用车集团G", model: "2170-NCM", qty: 6, due: "2026-07-17", pri: "低" },
];

/**
 * QUERY30-Q01VERT（KILL-MOCK-RED 返工·数据地基维度校正）——**订单量→电芯口径换算系数**。
 *
 * 根因：HTML 24 单的 `qty` 以**批次录入口径**（个位/两位数）记录，而 `Line.capacityDaily` 是**线级电芯日产能**
 * （化成/老化取小 ≈ 6 万只/日·真拓扑派生）。二者相差约 4 个数量级 → `what_if_displacement` 直接比较时，任何现实急单
 * 都远小于自由产能（`feasibleWithoutDisplacement=true`·零挤占），Q01「会挤占哪些单」在真种子上结构性失效。
 *
 * 治本（沿本体·非兜底）：把订单量换算到与 `capacityDaily` **同一电芯口径**（只/cell）——`qty_cells = qty × 该系数`。
 * 系数取 40000（每录入单位≈4 万只批次），使**旗舰常州 4680 线在手单在 6 周窗口内自然消费 ~93% 线产能**
 * （常州本就是全域瓶颈基地：化成瓶颈 92 · 在途覆盖<3 天，高负荷符合叙事），从而**现实急单真挤占真在手单**。
 * 仅换算**订单量**（reviewer 指定：优先缩放订单而非扭曲产能）；`capacityDaily` 及基地 `formationCapDaily/agingCapDaily`
 * （capacity_rollup / vle-oracle 消费）**不动**。R6：常量确定性·同种子字节一致。marginPct/单价/各比率为**每单位口径**不随量变。
 */
const ORDER_QTY_CELLS_PER_LOT = 40000;

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
  forecastStart: "2026-06-10",
  packCellCount: 96,
  certFactors: { 量产: 1.0, 认证中: 0.6 },
  ramp: { base: 0.88, step: 0.03, fullWeek: 5 },
  maintMult: 0.72,
  health: { normal: 0.93, degraded: 0.9, staleHours: 2 },
  // METHOD-MC-STOCHASTIC：随机模拟族离散度默认（R14 抽象角色 · 精确值见 PRD §4 · CALIBRATION 可调）。
  // 替代 health.normal=0.93 在 P90 路径的伪分位用途——P90 改由种子化 MC 真实经验分位产出。
  mc: {
    iterations: 2000,
    dispersion: { yield: 0.03, oee: 0.05, availability: 0.04, attendance: 0.02, utilization: 0.04 },
    staleDispersionMult: 1.6,
  },
  whatIf: { nightShiftCoef: 0.06, channelCoef: 0.05, outsourceMax: 0.2 },
  logistics: { byAddress: { 上海: 3, 广州: 5, 北京: 4, 成都: 6, 海外: 14 }, defaultDays: 7 },
  bottleneck: {
    factors: [...BN_FACTORS],
    // 基地→主瓶颈因素（HTML 为准：常州·化成=瓶颈工序 92 · 江门·物料齐套 90，dash/sop 同源）。
    primary: {
      常州: "瓶颈工序",
      厦门: "设备OEE",
      成都: "设备OEE",
      眉山: "人力工时",
      武汉: "良率波动",
      江门: "物料齐套",
      合肥: "设备OEE",
      信阳: "物流时长",
      枣庄: "换型损失",
      邯郸: "物料齐套",
      自贡: "人力工时",
      洛阳: "良率波动",
    },
    defaultPrimary: "瓶颈工序",
    mock: { mod: 9, factorMult: 7, primaryBase: 88, primaryCap: 97, secondaryBase: 55, secondaryCap: 83, utilHigh: 0.82, utilHighAdd: 6, utilLowAdd: 2 },
    live: { oeeK: 220, oeeBase: 30, utilK: 0.9, utilBase: 8, yieldK: 600, yieldBase: 35 },
  },
  risk: {
    threshold: 85,
    cap: 98,
    pulseWindow: 3,
    pulseDecayDen: 4,
    psFloor: 0.25,
    psStart: 68,
    psDen: 45,
    maxCards: 8,
    eventAmps: { maint_window: 14, delivery_peak: 9, arrival_gap: 10 },
    arrivalCycleDays: 14,
    // RISK-TRAJECTORY-DEFAKE（B8/B9/B6·可校准·非内联魔数）：severity 判据 / 需求张力映射 / 工时估算系数入参。
    caseSeverity: { highScore: 92, medScore: 78, primaryBonus: 12 },
    demandTension: { base: 62, loadGain: 70, shareBase: 0.6, shareGain: 0.8, utilPivot: 0.8, utilGain: 40, upsideGain: 0.5, tensionCap: 98 },
    deliveryLaborPerWan: 1.6,
    fallbackUnitPrice: 600,
    // RISKBOARD-RULES-AGENTS（C1·处置计划决策偏移入参·非内联魔数·R6 字节一致）。
    plan: { leadDays: 7, sopReflectDays: 14, backupPeakThreshold: 90, backupLeadDays: 3, backupTailDays: 7, crossFallbackDays: 14 },
    // RISKBOARD-RULES-AGENTS（C1·越线阈值可被携此命名 param 的已发布规则覆盖·真规则驱动越线日）。
    tensionThresholdParamKey: "tensionThreshold",
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
    // RISKBOARD-RULES-AGENTS（C1·影响度打分系数入参·原内联 0.2 + delay/10·R6 字节一致）。
    impactBase: 0.2,
    impactDiv: 10,
    fallbackMax: 5,
    // §S1.5 修订: problems[] 4 类归并阈值（交期/毛利/齐套/信用）
    problems: {
      gmFloor: 13.5,
      essModels: ["S192-LFP"],
      comModels: ["L148-LFP"],
      ruleKeys: { DELIVERY: "C03", MARGIN: "C15", KIT: "C06/C16", CREDIT: "C13" },
      // 母版 ROOT_LIB 8 根源（crm/push/frame/credit/lta/ramp/maint/cost）—— 8 类一等问题卡的根因配置。
      // credit/cost/maint/push 由**真算信号**（信用占用比/细分毛利/齐套间隙/越线窗口）分类；
      // frame/crm/lta/ramp 由 override.root **种子真相**指定（业务实况·与既有 override.why 同源·非运行时编造）。
      rootCauses: {
        credit: { title: "信用额度超限", ruleRefs: "C13", remedy: "信用复核 + 预收款比例上调，超限部分分批释放" },
        cost: { title: "成本结构毛利偏低", ruleRefs: "C15/C24", remedy: "细分结构调优 + 高毛利订单优先排产" },
        frame: { title: "框架协议低价条款", ruleRefs: "C03/C15", remedy: "框架价重谈 + 低价条款分批执行" },
        crm: { title: "客户合同/需求变更", ruleRefs: "C02", remedy: "需求复盘 + 合同变更走 S&OP 重排" },
        lta: { title: "长协价量波动", ruleRefs: "C03", remedy: "长协年度对标 + 价量双轨对冲" },
        maint: { title: "设备维护致齐套缺", ruleRefs: "C06/C16", remedy: "维护窗口前置备料 + 加急采购压缩到货间隙" },
        ramp: { title: "产能爬坡产出不足", ruleRefs: "C03/C21", remedy: "认证加速 + 爬坡曲线提速 / 外协兜底" },
        push: { title: "排产推动/瓶颈紧张", ruleRefs: "C03", remedy: "瓶颈专项消解 + 越线窗口订单优先排产" },
      },
      // PRD-IND-dash ORDER_OVR：逐单 override 种子（按 so 覆盖信用/毛利 + why + root 根因类型）。
      // credit/cost 既有；frame/crm/lta/ramp/maint 由 root 指定（业务实况种子·让 8 根源各有真订单落桶）。
      overrides: {
        "SO-3470": { mAdj: -3.2, why: "电网公司F 框架价压价", root: "frame" },
        "SO-3437": { credit: true, why: "商用车集团G 在手应收 9.8 亿 + 新单 12.6 亿 > 信用额度 21 亿", root: "credit" },
        "SO-3506": { credit: true, why: "商用车集团G 二次追单，信用敞口进一步放大", root: "credit" },
        "SO-3458": { mAdj: -3.0, why: "电网公司F 框架协议低价条款执行", root: "frame" },
        "SO-3518": { mAdj: -2.6, why: "储能集成商D 价格战跟价（成本上行）", root: "cost" },
        "SO-3540": { credit: true, why: "商用车集团G 低优先级单，信用额度已被占满", root: "credit" },
        "SO-3402": { why: "整车厂B 6-05 合同变更追加，需求结构突变", root: "crm" },
        "SO-3420": { why: "海外车企E 长协价量年度调整，价量双波动", root: "lta" },
        "SO-3445": { why: "常州基地 4680 产线认证中，爬坡未达节拍", root: "ramp" },
        "SO-3452": { why: "成都基地关键设备计划性维护，齐套到货后移", root: "maint" },
      },
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
      // 命名以 HTML 参考原型为准（用户裁决 2026-06-23）：枣庄储能线（基准，IRR≈19% > 15% 门槛通过）。
      baseline: {
        projects: [
          { id: "ZZ", name: "枣庄储能线", q0: 3, cap: 3.5, capex: [3, 5], m: 1800, salvageRate: 0.05, lifeQuarters: 40 },
        ],
      },
      // 激进：枣庄储能线 + 江门动力线（江门 IRR < 15% → C23 不通过）。
      aggressive: {
        projects: [
          { id: "ZZ", name: "枣庄储能线", q0: 3, cap: 3.5, capex: [3, 5], m: 1800, salvageRate: 0.05, lifeQuarters: 40 },
          { id: "JM", name: "江门动力线", q0: 4, cap: 6.0, capex: [4, 8, 7], m: 1700, salvageRate: 0.05, lifeQuarters: 40 },
        ],
      },
    },
  },
  // §7.14/§7.15 计划域（年度情景 / 季度滚动）参数 —— 全部数据驱动，不写死在端点代码里
  planview: {
    /** 12 个月季节权重（和为 12）：月目标 = 年需求 × w/12 */
    seasonal: [0.92, 0.94, 0.99, 1.01, 1.03, 1.04, 1.06, 1.08, 1.1, 1.04, 0.95, 0.84],
    /** 季度滚动修正（按距 forecastStart 的季度序号），dem = 季度目标 × (1 + corr) */
    rollingCorrPct: [0.02, 0.08, -0.06, 0.05, 0, 0],
    /** 2027 年目标 = 2026 同季 × (1 + growthYoY) */
    growthYoY: 0.08,
    weeksPerQuarter: 13,
    /** 已决策产能项目投产增量（万套/季） */
    increments: [
      { quarter: "2027-Q2", name: "合肥四期投产", delta: 2.0 },
      { quarter: "2027-Q3", name: "盐城二期爬坡", delta: 3.0 },
    ],
    // PRD-IND-quarter §4.3/§4.5(C)：长协偏差三物料 + 专属配置位（计划吨/季 + 逐行偏差%，确定性 R6，
    // 不扰动 Shipment 的 C16 齐套逻辑）；actual = planned×(1+dev/100) 实算。
    ltaMaterials: ["三元正极", "隔膜", "电解液"],
    ltaPlanned: [2800, 820, 1900],
    ltaDevPct: [-8, 1, -2],
    /** 强制一行 |偏差|>5%（升级供应风险，与风险看板到货间隙同源；首行兜底） */
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
    essShareBaseline: 49 / 132, // PRD-IND-audit §4.5-A2 取值对齐 HTML（≈0.3712）
    essShareTol: 0.05,
    capexSoft: 10,
    segMargins: Object.fromEntries(SEG_REGISTRY.map((s) => [s.key, s.marginPct])) as { pas: number; ess: number; com: number }, // DF.3 单一来源
    scoreH: 22, // PRD-IND-audit §4.5-A2 取值对齐 HTML（25→22）
    scoreM: 7, //  PRD-IND-audit §4.5-A2 取值对齐 HTML（8→7）
    passScore: 85,
    condScore: 60,
    // PRD-IND-audit §4.4：外部信号诊断 E01–E03 阈值（环境感知纳入软风险）。
    extGmBufferMin: 1.2, // E01 结构毛利与目标缓冲 < 1.2pp → 碳酸锂上行即击穿
    extDemHigh: 130, // E02 需求 P50 ≥130 → 终端上险不及预期则缺口扩大
    verdictMedCount: 3, // HARDCODE-SOLVER-PARAMS ε2：中风险项计数达此→"可定稿但有重要风险"（原 plan.ts 内联 3）
  },
  planGenerate: {
    // PRD-IND-plan-generate §4.5 取值对齐 HTML GEN_BASE/GEN_GOALS（rev=100 归一保 growth 评分=revGrowAbs×2.5）。
    base: { rev: 100, gm: 0.16, share: 18, turns: 5.6, cash: 58 },
    // DF.4 单一来源：从 PLAN_GOAL_TARGETS 派生（gmFloor=百分÷100，turnsFloor=turns；R6 字节复现 0.155/6.0）。
    targets: {
      gmFloor: PLAN_GOAL_TARGETS.gmFloorPct / 100,
      cashFloor: PLAN_GOAL_TARGETS.cashFloor,
      capexCap: PLAN_GOAL_TARGETS.capexCap,
      revGrowthPct: PLAN_GOAL_TARGETS.revGrowthPct,
      sharePts: PLAN_GOAL_TARGETS.sharePts,
      turnsFloor: PLAN_GOAL_TARGETS.turns,
    },
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
    // PRD-IND-plan-generate §4.6：外部信号敏感性（GEN_EXT_SENS 5×3，逐字 HTML L4501-4517；④i18n+②色）。
    extSens: {
      A: [["碳酸锂 +9.8%", "守价空间被成本上移部分抵消：方案毛利 +1.4pct → 约 +0.9pct", "#E8B54A"], ["竞争对手储能报价 −6%", "挑单退出的份额更快被竞对承接，客户挽留窗口收窄", "#E8B54A"], ["终端上险 +11% < 假设", "需求走弱反而有利守价路径（供需趋松时保盈利优先正确）", "#62BE77"]],
      B: [["碳酸锂 +9.8%", "低毛利储能单进一步被成本挤压：毛利 −0.8pct 恶化为约 −1.3pct，更易击穿底线", "#DD7E9E"], ["客户舆情（集成商D）", "冲量路径的应收风险被舆情放大：C13 复核可能直接拒掉部分量", "#DD7E9E"], ["终端上险背离", "冲量目标建立在偏乐观需求上，份额收益可能不及预期", "#E8B54A"]],
      C: [["四川限电预案", "成都/眉山/自贡化成 7–8 月折减 5–8%：扩产爬坡叠加限电，Q3 供给更紧", "#DD7E9E"], ["欧盟电池法", "新线若供海外，碳足迹护照需与建设同步规划（追溯改造成本高）", "#E8B54A"], ["利率/汇率环境", "CAPEX 融资成本与海外回款汇兑双重敏感", "#E8B54A"]],
      D: [["竞争动态（利用率 71%）", "行业产能宽松利好外协议价：外协费可再压 3–5%", "#62BE77"], ["舆情（供应商负面）", "外协伙伴经营异常风险需纳入资质名录动态复核", "#E8B54A"], ["碳酸锂 +9.8%", "外协报价随行就市，成本传导更快、毛利侵蚀略增", "#E8B54A"]],
      E: [["四川限电预案", "枣庄扩高端不受川区限电影响（选址优势）；川区量走外协对冲", "#62BE77"], ["碳酸锂 +9.8%", "高端守价 + 长尾外协的组合对成本上行的缓冲最好（毛利敏感度三案最低）", "#62BE77"], ["欧盟电池法", "枣庄一线规划期同步预留碳足迹数据采集，合规成本最优", "#62BE77"]],
    },
    // PRD-IND-plan-generate §4.6：执行关键点 + 必须解决问题（GEN_FOCUS 5×{keys,probs×2}，逐字 HTML L4518-4559；why=推演分析，chain=风险传播链 4 节点[标签,对象,色]）。
    focus: {
      A: { keys: "严守 C15 接单毛利线上浮 1pct；主动收缩储能长尾单；乘用车与高端储能守价。", probs: [
        { n: "储能客户份额流失", kind: "share", rule: "C21", why: "拒掉低毛利储能单后，电网F / 集成商D 类客户会转向竞对；一旦次年框架协议重谈时己方出货占比已降，议价地位反转，\"守价\"反被瓦解。所以退单必须配客户分层挽留与高端替代承接，否则一年后变成\"丢份额又丢价\"。", chain: [["拒低毛利储能单", "C15 上浮执行", "#E8B54A"], ["电网F/集成商D 转单", "储能客户·框架协议", "#54B5C4"], ["次年框架议价权弱化", "长协锁量/价格条款", "#5E8FE8"], ["份额 +6% 不达 · 守价基础动摇", "C21 结构监测", "#DD7E9E"]] },
        { n: "收入增长缺口 6pct", kind: "share", rule: null, why: "收入增速 12% 低于目标 18%；若叠加行业需求下修，AOP 基准情景将被迫下调并触发年度情景触发项挂牌。必须用高端储能扩量或服务收入主动补位，而不是被动接受缺口。", chain: [["挑单收缩", "接单结构变化", "#E8B54A"], ["收入增速 12% < 目标 18%", "收入预算线", "#54B5C4"], ["AOP 基准情景下修压力", "年度情景触发项", "#5E8FE8"], ["增长目标失守 · 触发挂牌监测", "AOP 触发项", "#DD7E9E"]] }] },
      B: { keys: "照单全收冲市场份额；信用额度从严（C13）；应收账期按周管控。", probs: [
        { n: "毛利率击穿底线", kind: "margin", rule: "C15", why: "储能低毛利单放量使结构毛利 −0.8pct，直逼 15.5% 底线；任何原料涨价或细分占比再偏 2pct 即击穿，C15 将阻断接单。必须同步推进储能降本与接单毛利线考核，否则规模是用利润换来的。", chain: [["低毛利储能单放量", "储能占比 37%→42%", "#E8B54A"], ["结构毛利 −0.8pct", "细分结构反推", "#54B5C4"], ["逼近 15.5% 底线 · 缓冲 <0.5pct", "毛利率预算线", "#5E8FE8"], ["击穿即 C15 阻断接单", "规则 C15", "#DD7E9E"]] },
        { n: "应收与现金垫承压", kind: "cash", rule: "C18", why: "冲量客户议价强、账期长，13 周现金最低点 −4 亿；应收周期再拉 5 天即跌破 50 亿红线，计划将被 C18 阻断、无法定稿。信用动态复核与回款联动必须先于放量启动。", chain: [["冲量客户账期拉长", "应收周期 +5 天", "#E8B54A"], ["13周现金最低点 54 亿", "现金流滚动测算", "#54B5C4"], ["逼近红线 50 亿 · 余量仅 4 亿", "现金安全垫", "#5E8FE8"], ["击穿即定稿阻断", "规则 C18", "#DD7E9E"]] }] },
      C: { keys: "枣庄+江门新线动工；C23 门槛测算前置（IRR≥15% · 24月利用率≥75%）；爬坡曲线按认证+调试保守化。", probs: [
        { n: "CAPEX 挤占现金垫", kind: "cash", rule: "C18/C23", why: "27 亿 CAPEX 集中支付使现金垫 58→46 亿，直接击穿 50 亿红线，规划体检即阻断。必须分期支付 / 推后一季 / 配套融资，并先过 C23 门槛测算再写入计划——顺序不能反。", chain: [["CAPEX 27 亿集中支付", "枣庄+江门建设", "#E8B54A"], ["现金垫 58→46 亿", "13周现金最低点", "#54B5C4"], ["击穿红线 50 亿", "现金安全垫", "#5E8FE8"], ["C18 阻断定稿 · C23 门槛未过", "规则 C18/C23", "#DD7E9E"]] },
        { n: "爬坡滞后吞噬新增产能", kind: "ramp", rule: null, why: "按理论爬坡率排计划，认证 T+20 与调试期未计入；参照常州动力线-B 实绩（爬坡 60% vs 计划 70%），Q3 将累出 6 万套缺口、被迫外协兜底。爬坡假设必须用 PLM 认证记录 + MES 实绩校准。", chain: [["认证 T+20 + 调试未计入", "PLM 认证记录", "#E8B54A"], ["爬坡 60% vs 计划 70%", "常州动力线-B 实绩", "#54B5C4"], ["Q3 供给累缺 6 万套", "季度滚动缺口", "#5E8FE8"], ["交付违约风险 · 外协被动兜底", "订单交期判", "#DD7E9E"]] }] },
      D: { keys: "CAPEX 不动；外协补量走资质名录；来料/过程质量管控与放量同步。", probs: [
        { n: "外协比例触红线", kind: "outsource", rule: "C08", why: "缺口全靠外协时比例逼近 20% 红线，超出部分无法承接；该红线是质量与供应安全的硬约束、不可放宽。外协必须与结构性手段（守价/扩产）组合使用，单押外协等于把承接能力封顶。", chain: [["缺口全量外协", "外协订单占比 ↗", "#E8B54A"], ["比例逼近 20%", "外协比例监测", "#54B5C4"], ["超出部分无法承接", "承接能力封顶", "#5E8FE8"], ["C08 红线 · 触线即拒单", "规则 C08", "#DD7E9E"]] },
        { n: "外协质量波动反噬", kind: "outsource", rule: null, why: "外协良率低于自产 1–2pct，不良流入会推高质量域不良率、引发客诉与退货；质量成本与商誉损失会吞掉外协省下的 CAPEX。首件鉴定 + 巡检抽检必须与放量同步，不能事后补。", chain: [["外协良率波动 −1~2pct", "QMS 外协批次", "#E8B54A"], ["不良流入 · 客诉上升", "质量域不良类别", "#54B5C4"], ["退货/返工 + 商誉损失", "质量成本", "#5E8FE8"], ["毛利侵蚀 · 大客户信任受损", "毛利率/客户关系", "#DD7E9E"]] }] },
      E: { keys: "乘用车守价 + 枣庄一线扩高端 + 长尾量外协；三对策在月度 S&OP 第⑤步统一编排时序并设里程碑监测。", probs: [
        { n: "三对策时序错配", kind: "gap", rule: null, why: "扩产爬坡期、外协切换期、守价谈判期一旦脱节，缺口立即回弹：爬坡未达而外协未就位 = 交付违约；守价先行而供给未稳 = 客户流失。混合型的全部收益建立在协同之上，时序编排不是执行细节、是方案成立的前提。", chain: [["任一对策延期", "扩产/外协/守价 三线", "#E8B54A"], ["爬坡空窗 × 外协未就位", "供给缺口回弹", "#54B5C4"], ["交付违约 + 客户流失 双风险", "订单交期判/客户关系", "#5E8FE8"], ["规模与毛利双失 · 方案收益归零", "综合评分坍塌", "#DD7E9E"]] },
        { n: "枣庄线认证爬坡风险", kind: "ramp", rule: "C23", why: "4680 高端线认证 T+20 若延期，高端储能供给出现缺口、只能回退外协兜底，外协费会吞掉混合型 +0.4pct 的毛利收益。认证里程碑必须像产能推演一样按时间窗挂牌监测、提前预判。", chain: [["认证 T+20 延期", "PLM 认证里程碑", "#E8B54A"], ["高端储能供给缺口", "枣庄一线产能", "#54B5C4"], ["回退外协兜底 · 外协费上升", "C08 外协占用", "#5E8FE8"], ["+0.4pct 毛利收益被吞噬", "方案收益", "#DD7E9E"]] }] },
    },
  },
  // PRD-IND-sop §4.5-5：收入预算口径=240（真预算 SOP_FIN[0].bud），滚动确认收入 248 → 达成率 248/240=103%（非 248/248=100%）。
  sop: { gapRed: 2, dvThreshold: 0.1, cashFloor: 50, monthlyWeeks: 4, gmTolerance: 0.5, revBudget: 240 },
  // HARDCODE-SOLVER-PARAMS（ε4·IndustryPack default）：20 场景扩展求解器业务阈值/系数——默认==原 extended.ts 内联值
  // （R6 字节一致），骨架键在 types.ts 零业务实体名（R14）。租户/行业可覆写（改 param 改果·非死值）。
  mitigation: { urgencyPivot: 70, urgencySpan: 30 },
  cert: { engineerGroups: 3, hoursPerWeek: 40 },
  lta: { lockRate: 0.8, leadDays: 30 },
  inventory: { safetyDays: 5, overMult: 1.5, underMult: 0.8, idleThreshold: 90 },
  maintenance: { window: 4, minInterval: 26, groupWeekCap: 3 },
  outsourcing: { overtimeCost: 1.0, outsourceCost: 1.4, delayCost: 2.5, overtimeCapPct: 0.4, outsourceCapPct: 0.2 },
  quote: { floorDefault: 0.1, band: 0.01 },
  credit: { overdueDays: 30 },
  carbon: { euThreshold: 70 },
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
  // oeePlan/yieldPlan：计划达成率真派生的治理计划基准（R14 应用层无业务常数——基准在此声明，由
  // 时序生成器注入 attainment:line 派生规格）。达成 = 实际/计划：oeePlan 0.85 = 设备综合效率近期改善目标，
  // yieldPlan 0.97 = 工序良率目标。实际 OEE≈0.78 / 良率≈0.952（见 tsGenerators oee:equip / yield:process），
  // 故结构性达成 ≈ (0.78/0.85)×(0.952/0.97) ≈ 0.90，缺口逐日拆为 设备效率损 + 良率损 + 排程事件损（R13）。
  planBaseline: { ltaCov: 92, kitGap: 654, gmTarget: 16.0, cashCushion: 58, capex: 0, oeePlan: 0.85, yieldPlan: 0.97 },
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
  // 地理坐标（GeoMap 着色/选址）+ 业态（动力/储能）——全建模，合成数据与字段对齐（R12）。
  { propKey: "lon", dataType: "number", isPrimaryKey: false },
  { propKey: "lat", dataType: "number", isPrimaryKey: false },
  { propKey: "position", dataType: "enum", isPrimaryKey: false },
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
  // PRD-IND-model 缺口③：化学体系 + 业态（step1/DAG 元信息，求解器 nonProducible 判定依据）。
  { propKey: "chem", dataType: "enum", isPrimaryKey: false },
  { propKey: "pos", dataType: "enum", isPrimaryKey: false },
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
  { propKey: "pri", dataType: "enum", isPrimaryKey: false }, // PRD-IND-order 优先级（高/中/低）
  { propKey: "bases", dataType: "json", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false },
  // 约束扫描所需字段（C03/C08/C13/C29）—— 确定性派生，植入少量越线行让规则真触发。
  { propKey: "demandDelta", dataType: "number", isPrimaryKey: false },
  { propKey: "outsourceRatio", dataType: "number", isPrimaryKey: false },
  { propKey: "creditUsedRatio", dataType: "number", isPrimaryKey: false },
  { propKey: "leadDays", dataType: "number", isPrimaryKey: false },
  { propKey: "unitPrice", dataType: "number", isPrimaryKey: false }, // 按型号反范式化的单价（value 派生依赖）
  // QUERY30-ONTOLOGY-EXT（§2.1 Order 挤占五件套 + 锁价/成本快照）——挤占与毛利推演的锚（Q01/Q02/Q03/Q11）。
  { propKey: "promiseDate", dataType: "date", isPrimaryKey: false }, // 承诺交期（vs due 计划交期）
  { propKey: "marginPct", dataType: "number", isPrimaryKey: false }, // 单毛利率（现仅 Segment 级 gmRate）
  { propKey: "allocatedLineIds", dataType: "json", isPrimaryKey: false }, // 占线明细（挤占分析锚·order_allocated_on 边源）
  { propKey: "penaltyClause", dataType: "number", isPrimaryKey: false }, // 违约金率（Q03）
  { propKey: "substitutable", dataType: "boolean", isPrimaryKey: false }, // 可外协标记（Q03）
  { propKey: "priceLockedUntil", dataType: "date", isPrimaryKey: false }, // 锁价期（Q02）
  { propKey: "costBreakdown", dataType: "json", isPrimaryKey: false }, // BOM 成本快照（归因粒度·Q11）
];
const orderDerived: DerivedPropertyDef[] = [{ propKey: "value", formula: "qty * unitPrice" }];

const lineProps: PropertyDef[] = [
  { propKey: "lineId", dataType: "string", isPrimaryKey: true },
  { propKey: "baseId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
  { propKey: "name", dataType: "string", isPrimaryKey: false },
  // 运营指标（利用率 + 时序聚合物化：日实际产出 / 排程达成率）——全建模对齐（R12）。
  { propKey: "utilization", dataType: "number", isPrimaryKey: false },
  { propKey: "actual_output_daily", dataType: "number", isPrimaryKey: false },
  { propKey: "schedule_attainment", dataType: "number", isPrimaryKey: false },
  // QUERY30-ONTOLOGY-EXT（§2.1 Line 三字段·最大单点缺口——线级推演此前全靠 Base 聚合值）。
  { propKey: "capacityDaily", dataType: "number", isPrimaryKey: false }, // 线级日产能（Q01/Q03）
  { propKey: "certifiedModels", dataType: "json", isPrimaryKey: false }, // 线级可产型号（Q01/Q15·认证线约束）
  { propKey: "changeoverGroup", dataType: "string", isPrimaryKey: false }, // 换型组（Q08 换型序列约束）
];

const processProps: PropertyDef[] = [
  { propKey: "processId", dataType: "string", isPrimaryKey: true },
  { propKey: "lineId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Line" },
  { propKey: "baseId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
  { propKey: "name", dataType: "string", isPrimaryKey: false },
  { propKey: "kind", dataType: "enum", isPrimaryKey: false }, // serial | formation | aging
  { propKey: "yield", dataType: "number", isPrimaryKey: false },
  { propKey: "yield_baseline", dataType: "number", isPrimaryKey: false }, // 良率基线（时序 EMA 物化）——全建模对齐（R12）
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
  { propKey: "oee_current", dataType: "number", isPrimaryKey: false }, // OEE 当前快照（时序 7d 加权物化，baseDerived.oeeIndex 依赖）——全建模对齐（R12）
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

// cockpit P1 绿地：经营驾驶舱富 KPI 数据闭环（数字从本体关系算出，前后端零写死 R14）。
const demandSegmentProps: PropertyDef[] = [
  { propKey: "segId", dataType: "string", isPrimaryKey: true },
  { propKey: "segment", dataType: "string", isPrimaryKey: false }, // 乘用车/储能/商用车
  { propKey: "tgt", dataType: "number", isPrimaryKey: false }, // 目标(万)
  { propKey: "p50", dataType: "number", isPrimaryKey: false }, // 需求 P50(万)
  { propKey: "p90", dataType: "number", isPrimaryKey: false },
  { propKey: "act", dataType: "number", isPrimaryKey: false }, // 实际(万)
  { propKey: "priceWan", dataType: "number", isPrimaryKey: false }, // 单价(万/万件)
  { propKey: "marginPct", dataType: "number", isPrimaryKey: false }, // 毛利率(%)
  { propKey: "floorPct", dataType: "number", isPrimaryKey: false }, // 毛利底线(%)
];
const demandSegmentDerived: DerivedPropertyDef[] = [
  { propKey: "revenueWan", formula: "p50 * priceWan" }, // 收入(万) = 需求×单价
  { propKey: "marginWan", formula: "p50 * priceWan * marginPct / 100" }, // 毛利额(万)
];
const financePlanProps: PropertyDef[] = [
  { propKey: "finId", dataType: "string", isPrimaryKey: true },
  { propKey: "line", dataType: "string", isPrimaryKey: false }, // 收入/销售成本/毛利
  { propKey: "budget", dataType: "number", isPrimaryKey: false }, // 预算(万)
  { propKey: "rolling", dataType: "number", isPrimaryKey: false }, // 滚动预测(万)
];
const materialBalanceProps: PropertyDef[] = [
  { propKey: "matBalId", dataType: "string", isPrimaryKey: true },
  { propKey: "material", dataType: "string", isPrimaryKey: false }, // 三元正极/隔膜/电解液
  { propKey: "unit", dataType: "string", isPrimaryKey: false }, // 吨/万㎡（MRP 表单位，PRD-IND-sop §4.4）
  { propKey: "netDemandTon", dataType: "number", isPrimaryKey: false },
  { propKey: "ltaPct", dataType: "number", isPrimaryKey: false }, // 长协覆盖(%)
  { propKey: "gapTon", dataType: "number", isPrimaryKey: false }, // 现货缺口(吨)
  { propKey: "etaDate", dataType: "string", isPrimaryKey: false },
  // 轨M 增量3（反事实排除层·根因候选）：物流执行/安全库存维度的缺口（吨）。demo 物流到货在窗口内、安全库存充足
  // → 两者恒 0（这两个候选根因反算达标）→ plan_rootcause 把它们「已排除」+理由，让根因 DAG 显反事实排除层。
  { propKey: "logisticsGapTon", dataType: "number", isPrimaryKey: false }, // 物流时效缺口(吨)：到货延误造成的齐套缺口
  { propKey: "safetyStockGapTon", dataType: "number", isPrimaryKey: false }, // 安全库存缺口(吨)：低于安全水位部分
];

// cockpit P2 + SPINE 绿地：规划决策推演 + 根因 DAG + 经营目标-指标-责任骨架。
// Metric = 指标库一等对象（目标 vs 实际，各视图 KPI 单一出处 R-一致；= cockpit PlanKpi 归一，含 level/ksfRef/ownerRef）；
// KSF = 关键成功要素（五要素）；Principal = 责任主体；RootCauseChain = 因子→指标的「归因模板」
// （配成对象 → 求解器据此沿 driverType 取活数据算贡献，「结构=算、模板=配成对象」）。
const metricProps: PropertyDef[] = [
  { propKey: "metricId", dataType: "string", isPrimaryKey: true },
  { propKey: "key", dataType: "string", isPrimaryKey: false },
  { propKey: "name", dataType: "string", isPrimaryKey: false },
  { propKey: "level", dataType: "enum", isPrimaryKey: false }, // op/month/quarter/year
  { propKey: "category", dataType: "enum", isPrimaryKey: false }, // profit/scale/material
  { propKey: "target", dataType: "number", isPrimaryKey: false },
  { propKey: "actual", dataType: "number", isPrimaryKey: false },
  { propKey: "floorVal", dataType: "number", isPrimaryKey: false }, // 底线（actual<floor → 越线）
  { propKey: "unit", dataType: "string", isPrimaryKey: false },
  { propKey: "weight", dataType: "number", isPrimaryKey: false }, // KSF 权重
  { propKey: "ksfRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "KSF" }, // 归属 KSF
  { propKey: "ownerRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Principal" }, // 责任人
  { propKey: "chainKey", dataType: "string", isPrimaryKey: false }, // 越线根因装配 key
];
const metricDerived: DerivedPropertyDef[] = [
  { propKey: "delta", formula: "actual - target" }, // 差异（带符号）
  { propKey: "gapPct", formula: "(actual - target) / target * 100" }, // 缺口%（带符号，越线为负）
];
const ksfProps: PropertyDef[] = [
  { propKey: "ksfId", dataType: "string", isPrimaryKey: true },
  { propKey: "key", dataType: "enum", isPrimaryKey: false }, // k_dem/k_bal/k_kit/k_cash/k_cost
  { propKey: "name", dataType: "string", isPrimaryKey: false },
  { propKey: "sub", dataType: "string", isPrimaryKey: false },
];
const principalProps: PropertyDef[] = [
  { propKey: "principalId", dataType: "string", isPrimaryKey: true },
  { propKey: "name", dataType: "string", isPrimaryKey: false },
  { propKey: "kind", dataType: "enum", isPrimaryKey: false }, // org/role/person
  { propKey: "parentRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Principal" },
];
// cockpit P5 / sop 绿地：S&OP 版本演进（V1→V7 需求/供给/缺口/备注），驱动 V5/V7 版本切换 + 版本对比表。
const sopVersionRowProps: PropertyDef[] = [
  { propKey: "verId", dataType: "string", isPrimaryKey: true },
  { propKey: "ver", dataType: "string", isPrimaryKey: false }, // V1..V7
  { propKey: "date", dataType: "string", isPrimaryKey: false },
  { propKey: "demand", dataType: "number", isPrimaryKey: false },
  { propKey: "supply", dataType: "number", isPrimaryKey: false },
  { propKey: "note", dataType: "string", isPrimaryKey: false },
  { propKey: "isFinal", dataType: "boolean", isPrimaryKey: false },
];
const sopVersionRowDerived: DerivedPropertyDef[] = [
  { propKey: "gap", formula: "demand - supply" }, // 产销缺口（派生）
];
const rootCauseChainProps: PropertyDef[] = [
  { propKey: "chainId", dataType: "string", isPrimaryKey: true },
  { propKey: "kpiCategory", dataType: "enum", isPrimaryKey: false }, // 关联 Metric.category
  { propKey: "factor", dataType: "string", isPrimaryKey: false }, // 根因因子名
  { propKey: "driverType", dataType: "string", isPrimaryKey: false }, // 取证对象类型（DemandSegment/MaterialBalance…）
  { propKey: "evidenceField", dataType: "string", isPrimaryKey: false }, // 量化字段（marginWan/gapTon/act…）
  { propKey: "selectField", dataType: "string", isPrimaryKey: false }, // 叶节点标签字段（segment/material）
  { propKey: "baseWeight", dataType: "number", isPrimaryKey: false }, // 配置基准权重
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
  { propKey: "note", dataType: "string", isPrimaryKey: false },
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
  // cockpit P1 绿地
  DemandSegment: "forecast", FinancePlan: "finance", MaterialBalance: "material",
  // cockpit P2 + SPINE 绿地（规划决策推演 + 根因 DAG + 目标-指标-责任骨架）
  Metric: "decision", RootCauseChain: "decision", KSF: "decision", Principal: "people",
  // cockpit P5 / sop 绿地（S&OP 版本演进）
  SopVersionRow: "plan",
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
    // cockpit P1 绿地：经营驾驶舱富 KPI（数字经派生/聚合算出，R14 零写死）。
    { key: "DemandSegment", displayName: "需求细分", domain: "forecast", properties: withGovernance("DemandSegment", demandSegmentProps), derivedProperties: demandSegmentDerived, sourceBindings: BINDINGS.DemandSegment ?? [] },
    plain("FinancePlan", "财务预算", financePlanProps),
    plain("MaterialBalance", "物料平衡", materialBalanceProps),
    // cockpit P2 + SPINE 绿地：指标库 Metric（gapPct/delta 派生，各视图 KPI 单一出处 R-一致）+ KSF + Principal + 根因归因模板。
    { key: "Metric", displayName: "经营指标", domain: "decision", properties: withGovernance("Metric", metricProps), derivedProperties: metricDerived, sourceBindings: BINDINGS.Metric ?? [] },
    plain("KSF", "关键成功要素", ksfProps),
    plain("Principal", "责任主体", principalProps),
    plain("RootCauseChain", "根因归因链", rootCauseChainProps),
    // cockpit P5 / sop 绿地：S&OP 版本演进（gap 派生）。
    { key: "SopVersionRow", displayName: "S&OP版本演进", domain: "plan", properties: withGovernance("SopVersionRow", sopVersionRowProps), derivedProperties: sopVersionRowDerived, sourceBindings: BINDINGS.SopVersionRow ?? [] },
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
    { key: "batch_lab_test", fromTypeKey: "MaterialBatch", toTypeKey: "LabTest", cardinality: "N:N" }, // quality（LIMS 实验室检测·WO-7 9/9）
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
    // Phase7A plan↔product 连边：订单→月度计划目标（按交期月匹配）→ Order 根直达 plan 域。
    { key: "order_to_plantarget", fromTypeKey: "Order", toTypeKey: "PlanTarget", cardinality: "N:N" }, // plan
    // SPINE 骨架链：指标→KSF / 指标→责任人 / 目标→责任人（各视图 KPI 单一出处 + 责任闭环的本体连线）。
    { key: "metric_affects_ksf", fromTypeKey: "Metric", toTypeKey: "KSF", cardinality: "N:N" }, // decision
    { key: "metric_ownedby", fromTypeKey: "Metric", toTypeKey: "Principal", cardinality: "N:N" }, // decision→people
    { key: "plantarget_ownedby", fromTypeKey: "PlanTarget", toTypeKey: "Principal", cardinality: "N:N" }, // plan→people（责任闭环）
    // ---- QUERY30-ONTOLOGY-EXT（§2.2 6 新边·多跳链缺失接缝）----
    { key: "order_allocated_on", fromTypeKey: "Order", toTypeKey: "Line", cardinality: "N:N" }, // 挤占（占线明细·Q01/Q03）
    { key: "order_displaces", fromTypeKey: "Order", toTypeKey: "Order", cardinality: "N:N" }, // 挤占推演边（加单挤占被挤单·Q01/Q03）
    { key: "material_supplied_by", fromTypeKey: "Material", toTypeKey: "Supplier", cardinality: "N:N" }, // 断供半径/集中度锚（Q04）
    { key: "batch_reserved_for", fromTypeKey: "MaterialBatch", toTypeKey: "Order", cardinality: "N:N" }, // 批次↔订单绑定（Q05）
    { key: "model_bom_line", fromTypeKey: "Model", toTypeKey: "BomLine", cardinality: "1:N" }, // Model→BomLine（BOM 传导桥·Q11/Q28）
    { key: "bomline_material", fromTypeKey: "BomLine", toTypeKey: "Material", cardinality: "N:N" }, // BomLine→Material（BOM 传导桥·Q11/Q28）
    { key: "datasource_feeds_type", fromTypeKey: "DataSourceHealth", toTypeKey: "ObjectType", cardinality: "N:N" }, // 源→类型血缘（降级下游定位·Q30）
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
            args: { so: "SO-3391" },
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
          // 计划（Phase7A）：订单→月度计划目标 → 第 10 域 plan（Order 根直达 plan）
          [{ linkKey: "order_to_plantarget", direction: "out", project: ["tgtId", "period", "level", "value"] }],
        ],
        maxNodes: 800,
        contractFixtures: [
          {
            name: "首单全链可达 10 域（含财务+计划）",
            args: { so: "SO-3391" },
            expect: {
              rootType: "Order",
              minNodes: 15,
              mustIncludeTypes: ["Order", "Model", "Base", "Line", "Process", "Equipment", "Material", "MaterialBatch", "PurchaseOrder", "Customer", "ARInvoice", "Shipment", "DataSourceHealth", "FinanceAccount", "PlanTarget"],
              mustIncludeLinkKeys: ["order_for_model", "model_producible_at", "line_has_process", "equip_used_in", "material_has_batch", "material_supplied_by_po", "customer_has_invoice", "base_has_shipment", "base_data_health", "base_finance", "order_to_plantarget"],
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
            args: { so: "SO-3391" },
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
    {
      // Phase6E：AnnualScenario 根的 plan/finance 专用切片（年度 AOP 决策）。
      // 修复「plan 子图仅 scenario 根可达、Order 根够不到」——以情景为根展开 目标/投资/财务。
      sliceKey: "aop_scenario_chain",
      version: 1,
      spec: {
        root: { typeKey: "AnnualScenario", selector: { filter: { key: "{{args.key}}" } } },
        paths: [
          [{ linkKey: "scenario_to_target", direction: "out", limitPerNode: 40, project: ["tgtId", "period", "level", "value"] }],
          [{ linkKey: "scenario_to_capex", direction: "out", project: ["projectId", "name", "irr", "util24", "c23pass"] }],
          [{ linkKey: "scenario_to_finance", direction: "out", project: ["metricId", "cashCushion", "irr", "capexSpent", "netMargin"] }],
        ],
        maxNodes: 200,
        contractFixtures: [
          {
            name: "基准情景根可达 plan + finance 两域",
            args: { key: "baseline" },
            expect: {
              rootType: "AnnualScenario",
              minNodes: 5,
              mustIncludeTypes: ["AnnualScenario", "PlanTarget", "CapexProject", "FinanceMetric"],
              mustIncludeLinkKeys: ["scenario_to_target", "scenario_to_capex", "scenario_to_finance"],
            },
          },
        ],
      },
    },
    // ---------------------------------------------------------------------
    // PANORAMA-SLICE-BACKFILL：七视角（GRAPH-PANORAMA-ONLY 已删）域知识以「切片形态」存续。
    // 五域各配一张声明式多跳切片（spannedTypes≥3·resolve 走真值·全景×图谱融合页页内渲染）。
    // 全用现有类型/链路，不纳入 QUERY30 新类型。确定性 R6（同 seed 字节稳）；A6 逐跳过滤 R3/行级。
    // ---------------------------------------------------------------------
    {
      // 域① 推演主干链（原 graph-backbone 视角）：Order→Model→Base→Line→Process→Equipment，旁挂 Model→Material。
      // 产能/风险推演求解器沿此主干取数——「一张订单要经哪条产线/工序/设备、用哪些物料」。
      sliceKey: "panorama.backbone",
      version: 1,
      spec: {
        root: { typeKey: "Order", selector: { byKey: "{{args.so}}" } },
        paths: [
          [
            { linkKey: "order_for_model", direction: "out", project: ["modelId", "name", "unitPrice"] },
            { linkKey: "model_producible_at", direction: "out", project: ["baseId", "name", "kind", "util", "bottleneck"] },
            { linkKey: "line_belongs_to_base", direction: "in", project: ["lineId", "name"] },
            { linkKey: "line_has_process", direction: "out", project: ["processId", "name", "kind", "yield"] },
            { linkKey: "equip_used_in", direction: "in", project: ["equipId", "oeeA", "oeeP", "oeeQ"] },
          ],
          [
            { linkKey: "order_for_model", direction: "out" },
            { linkKey: "model_uses_material", direction: "out", project: ["matId", "name", "onHand", "leadTime"] },
          ],
        ],
        maxNodes: 400,
        contractFixtures: [
          {
            name: "推演主干链首单可达 产品→工厂→工艺→设备 + 物料",
            args: { so: "SO-3391" },
            expect: {
              rootType: "Order",
              minNodes: 6,
              // 多跳锚点：Equipment 仅经 5 跳主干可达 → 降单跳即失（守「多跳非单跳」）。
              mustIncludeTypes: ["Order", "Model", "Base", "Line", "Process", "Equipment", "Material"],
              mustIncludeLinkKeys: ["order_for_model", "model_producible_at", "line_belongs_to_base", "line_has_process", "equip_used_in", "model_uses_material"],
            },
          },
        ],
      },
    },
    {
      // 域② 数据流/来源域（原 graph-flow + graph-source 视角）：物料数据溯源链
      // Order→Model→Material→MaterialBatch→LabTest（批次→LIMS 检测），旁挂 Material→采购单 与 Base→数据源健康。
      // 回答「这单的物料数据从哪来、批次经哪些实验室检测、采购与数据源可信度如何」。
      sliceKey: "panorama.dataflow",
      version: 1,
      spec: {
        root: { typeKey: "Order", selector: { byKey: "{{args.so}}" } },
        paths: [
          [
            { linkKey: "order_for_model", direction: "out", project: ["modelId", "name"] },
            { linkKey: "model_uses_material", direction: "out", project: ["matId", "name", "onHand", "leadTime"] },
            { linkKey: "material_has_batch", direction: "out", limitPerNode: 12, project: ["batchId", "qty", "ageDays", "idleDays"] },
            { linkKey: "batch_lab_test", direction: "out", limitPerNode: 8, project: ["testId", "result", "sampledAt"] },
          ],
          [
            { linkKey: "order_for_model", direction: "out" },
            { linkKey: "model_uses_material", direction: "out" },
            { linkKey: "material_supplied_by_po", direction: "out", limitPerNode: 12, project: ["poId", "qty", "etaDay", "delayed"] },
          ],
          [
            { linkKey: "order_for_model", direction: "out" },
            { linkKey: "model_producible_at", direction: "out", project: ["baseId", "name"] },
            { linkKey: "base_data_health", direction: "out", project: ["sourceId", "name", "critical", "lagHours"] },
          ],
        ],
        maxNodes: 500,
        contractFixtures: [
          {
            name: "数据流域首单可达 物料→批次→检测 + 采购 + 数据源",
            args: { so: "SO-3391" },
            expect: {
              rootType: "Order",
              minNodes: 6,
              // 多跳锚点：MaterialBatch 仅经 3 跳可达 → 降单跳即失。
              mustIncludeTypes: ["Order", "Model", "Material", "MaterialBatch", "PurchaseOrder", "Base", "DataSourceHealth"],
              mustIncludeLinkKeys: ["order_for_model", "model_uses_material", "material_has_batch", "material_supplied_by_po", "base_data_health"],
            },
          },
        ],
      },
    },
    {
      // 域③ 求解器绑定域（原 graph-solver 视角）：产能/风险求解器的输入子图——
      // 以基地为根展开 Base→Line→Process→Equipment（可产能力）+ Base→在途 + Base→检修 + Base→数据源健康。
      // 回答「产能推演/风险时间线求解器为这个基地读了哪些对象」。
      sliceKey: "panorama.solver_binding",
      version: 1,
      spec: {
        root: { typeKey: "Base", selector: { byKey: "{{args.baseId}}" } },
        paths: [
          [
            { linkKey: "line_belongs_to_base", direction: "in", project: ["lineId", "name"] },
            { linkKey: "line_has_process", direction: "out", project: ["processId", "name", "kind", "yield"] },
            { linkKey: "equip_used_in", direction: "in", project: ["equipId", "oeeA", "oeeP", "oeeQ"] },
          ],
          [{ linkKey: "base_has_shipment", direction: "out", project: ["shipId", "etaDay", "qtyTons", "status"] }],
          [{ linkKey: "base_maint_plan", direction: "out", project: ["planId", "week"] }],
          [{ linkKey: "base_data_health", direction: "out", project: ["sourceId", "name", "critical", "lagHours"] }],
        ],
        maxNodes: 400,
        contractFixtures: [
          {
            name: "求解器绑定域以基地为根可达 产线→工序→设备 + 在途/检修/数据源",
            args: { baseId: "changzhou" },
            expect: {
              rootType: "Base",
              minNodes: 4,
              // 多跳锚点：Equipment 仅经 3 跳（基地→产线→工序→设备）可达 → 降单跳即失。
              mustIncludeTypes: ["Base", "Line", "Process", "Equipment"],
              mustIncludeLinkKeys: ["line_belongs_to_base", "line_has_process", "equip_used_in"],
            },
          },
        ],
      },
    },
    {
      // 域④ 编排/决策域（原 graph-agent + graph-loop 视角）：年度决策编排链——
      // AnnualScenario→PlanTarget→责任人（目标下达闭环）+ →投资项目 + →财务指标。
      // 回答「这个年度情景把哪些目标下达给谁、配了哪些投资与财务指标」。
      sliceKey: "panorama.orchestration",
      version: 1,
      spec: {
        root: { typeKey: "AnnualScenario", selector: { filter: { key: "{{args.key}}" } } },
        paths: [
          [
            { linkKey: "scenario_to_target", direction: "out", limitPerNode: 40, project: ["tgtId", "period", "level", "value"] },
            { linkKey: "plantarget_ownedby", direction: "out", project: ["name", "role"] },
          ],
          [{ linkKey: "scenario_to_capex", direction: "out", project: ["projectId", "name", "irr", "util24"] }],
          [{ linkKey: "scenario_to_finance", direction: "out", project: ["metricId", "cashCushion", "irr", "netMargin"] }],
        ],
        maxNodes: 300,
        contractFixtures: [
          {
            name: "编排域以情景为根可达 目标→责任人 + 投资 + 财务",
            args: { key: "baseline" },
            expect: {
              rootType: "AnnualScenario",
              minNodes: 4,
              // 多跳锚点：Principal 仅经 2 跳（情景→目标→责任人）可达 → 降单跳即失。
              mustIncludeTypes: ["AnnualScenario", "PlanTarget", "Principal", "CapexProject", "FinanceMetric"],
              mustIncludeLinkKeys: ["scenario_to_target", "plantarget_ownedby", "scenario_to_capex", "scenario_to_finance"],
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
    // catalog-battery §3 C26–C33（DSL 表达式 = 违规谓词,expression 真→passed=false；复杂算术取
    // 去归一化/派生字段：yieldFloor=基线-0.02 / minYieldRate=自产-0.02 / daysToStart=开工日-today
    // / deviationPct=ABS(实际-计划)/计划。此前硬编码在求解器,规则引擎不可见;现注册为一等规则。
    { key: "C26", name: "认证资源上限", expression: "Cert.parallelTasks > Cert.engineerGroups", severity: "BLOCK" },
    { key: "C27", name: "长协执行偏差", expression: "Lta.deviationPct > 0.05", severity: "WARN" },
    { key: "C28", name: "呆滞预警", expression: "Batch.idleDays > 90", severity: "WARN" },
    { key: "C29", name: "排产冻结期", expression: "Order.daysToStart < 3", severity: "BLOCK" },
    { key: "C30", name: "良率连降停线评审", expression: "SUSTAIN(Process.dailyYield < Process.yieldFloor, 3)", severity: "BLOCK" },
    { key: "C31", name: "外协质量门", expression: "Outsource.yieldRate < Outsource.minYieldRate", severity: "BLOCK" },
    { key: "C32", name: "逾期冻结", expression: "Customer.maxOverdueDays > 30", severity: "BLOCK" },
    // C33 碳护照前置：约束 = 目的地EU IMPLIES 碳足迹<=阈值；违规 = NOT(约束)（用 IMPLIES，C33 的招牌用例）。
    { key: "C33", name: "碳护照前置", expression: "NOT (Order.destination == 'EU' IMPLIES Order.carbonFootprint <= Order.euCarbonThreshold)", severity: "BLOCK" },
    // 规则即引用（PRD-rules-as-references 附录A）：补全 13 条「被引用但未定义」规则为一等规则——
    // 消灭前端"（当前库中未找到定义）"、规则闸不再空过。expression 用既有 DSL（无算术/无 param 插值），
    // 命名阈值落 params（求解器 P2 改读 rule.params 去硬编码；改 param 即改推演）。C15/C24 毛利底线
    // 不复制 SEG_REGISTRY（单一来源），floorPct 由分段对象字段在求值期解析（params 留空）。
    { key: "C01", name: "产线设计产能上限", expression: "Line.weeklyCapacityWan > Line.designCeilingWan", severity: "BLOCK", params: {} },
    { key: "C02", name: "化成/老化串并产能口径", expression: "Process.parallelThroughput < Process.requiredThroughput", severity: "WARN", params: { tolerancePct: 0.05 } },
    { key: "C04", name: "仅认证产线计入产能", expression: "Line.certStatus != '量产'", severity: "WARN", params: { productionFactor: 1, pendingCertFactor: 0.6 } },
    { key: "C06", name: "物料齐套缺口口径(MRP)", expression: "MaterialBalance.gapTon > 0", severity: "WARN", params: {} },
    { key: "C09", name: "数据时延临时降级", expression: "DataSourceHealth.critical == TRUE AND DataSourceHealth.lagHours > 2", severity: "WARN", params: { staleHours: 2, normalFactor: 0.93, degradedFactor: 0.9 } },
    { key: "C10", name: "场景必填+行动审批留痕", expression: "Action.approver == NULL OR Action.audited == FALSE", severity: "BLOCK", params: {} },
    { key: "C11", name: "检修窗口与交付高峰错峰", expression: "MaintPlan.bufferDays < 3", severity: "WARN", params: { minBufferDays: 3 } },
    { key: "C15", name: "经营毛利底线", expression: "Order.marginPct < Order.floorPct", severity: "BLOCK", params: {} },
    { key: "C16", name: "齐套缺口预警", expression: "MaterialBalance.gapTon > 0", severity: "WARN", params: {} },
    { key: "C21", name: "产销平衡偏差", expression: "SopVersionRow.balanceDeviationPct > 0.10", severity: "WARN", params: { balanceDeviationPct: 0.1 } },
    { key: "C22", name: "换型损失/排产约束", expression: "Order.changeoverMin > 120", severity: "WARN", params: { maxChangeoverMin: 120 } },
    { key: "C24", name: "接单毛利过线", expression: "Quote.marginPct < Quote.floorPct", severity: "BLOCK", params: {} },
    { key: "C25", name: "外部终端需求假设偏离", expression: "ExternalSignal.deviationPct > 0.05", severity: "WARN", params: { assumeTolerancePct: 0.05 } },
    // QUERY30 缺口② C34–C50（DESIGN-query30 §2.3 · 17 条跨切片多跳推演约束）：全部 params 参数化（RulesPage 可见可改），
    // expression 真接求解器 evaluate_rules（SOLVER_RULE_REFS + service.ts ruleEvalPayload：measured 命名空间来自
    // 调用方真实业务输入或求解器真实产出，threshold 由 rule.params 注入 → 改 param 即改裁决；命名空间不在场 → 诚实 NOT_APPLICABLE，
    // 不冒充 PASS·红线 RL5）。C42/C45/C50 另接 S2 审批链（BATTERY_ACTION_TYPES.checkRules → submit 预检 BLOCK 短路）。
    { key: "C34", name: "挤占优先级不变量", expression: "Displace.highPriDisplaceDays > maxDisplaceDays", severity: "BLOCK", params: { maxDisplaceDays: 5 } },
    { key: "C35", name: "重大变更须≥2方案", expression: "PlanSet.schemeCount < minSchemes", severity: "BLOCK", params: { minSchemes: 2 } },
    { key: "C36", name: "锁价期现金敞口上限", expression: "LockedPrice.cashExposure > maxLockedExposure", severity: "BLOCK", params: { maxLockedExposure: 200 } },
    { key: "C37", name: "违约金/毛利权衡线", expression: "Tradeoff.netGain < minNetGain", severity: "BLOCK", params: { minNetGain: 0 } },
    { key: "C38", name: "供应商集中度红线", expression: "Supplier.concentrationPct > concentrationRedline", severity: "WARN", params: { concentrationRedline: 0.6 } },
    { key: "C39", name: "连败批次自动隔离", expression: "LabTest.consecutiveFails > maxConsecutiveFails", severity: "BLOCK", params: { maxConsecutiveFails: 2 } },
    { key: "C40", name: "检修逾期设备禁排产", expression: "Maint.overdueDays > maxOverdueDays", severity: "BLOCK", params: { maxOverdueDays: 0 } },
    { key: "C41", name: "加班时长合规上限", expression: "Labor.overtimeHours > overtimeCapHours", severity: "WARN", params: { overtimeCapHours: 36 } },
    { key: "C42", name: "信用上调审批链", expression: "CreditUplift.upliftPct > approvalThresholdPct", severity: "BLOCK", params: { approvalThresholdPct: 0.1 } },
    { key: "C43", name: "认证外包质量等效门", expression: "CertOutsource.equivalenceScore < minEquivalence", severity: "BLOCK", params: { minEquivalence: 0.9 } },
    { key: "C44", name: "谷段迁移不破交期", expression: "OffPeak.deliverySlipDays > maxSlipDays", severity: "WARN", params: { maxSlipDays: 0 } },
    { key: "C45", name: "自动对策仅生成草稿", expression: "AutoAction.autoExecutedCount > maxAutoExecute", severity: "BLOCK", params: { maxAutoExecute: 0 } },
    { key: "C46", name: "SOP final 版锁定", expression: "Sop.postFinalEdits > maxPostFinalEdits", severity: "BLOCK", params: { maxPostFinalEdits: 0 } },
    { key: "C47", name: "跨期方案多期联检", expression: "CrossPeriod.nextPeriodDeviationPct > maxCarryDeviation", severity: "WARN", params: { maxCarryDeviation: 0.1 } },
    { key: "C48", name: "复线观察期重停", expression: "Observe.rebreaks > maxRebreaks", severity: "BLOCK", params: { maxRebreaks: 0 } },
    { key: "C49", name: "断料停线损失口径统一", expression: "StopLoss.caliberVariancePct > maxCaliberVariance", severity: "WARN", params: { maxCaliberVariance: 0.05 } },
    { key: "C50", name: "降级期高危动作双签", expression: "Degrade.unsignedHighRiskActions > maxUnsigned", severity: "BLOCK", params: { maxUnsigned: 0 } },
  ],
  scenarioSeed: { views: ["dash", "graph", "risk", "order", "plan-audit", "plan-generate", "project-sim", "sop-balance"], intents: [] },
  features: [...ALL_FEATURE_KEYS],
  solverParams: BATTERY_SOLVER_PARAMS,
  // A8.6 §6.1 — measureField/weightField are battery-pack extensions consumed by the generator.
  tsGenerators: [
    { seriesKey: "oee:equip", entityType: "Equipment", grain: "day", base: { mean: 0.78, noise: 0.04 }, effects: ["maint_window_dip", "weekend_dip"], measureField: "oee", weightField: "output" },
    { seriesKey: "yield:process", entityType: "Process", grain: "day", base: { mean: 0.952, noise: 0.008 }, effects: ["maint_window_dip"], measureField: "yield" },
    { seriesKey: "output:line", entityType: "Line", grain: "day", base: { mean: 30000, noise: 1800 }, drift: 8, effects: ["weekend_dip", "maint_window_dip", "ramp_curve"], measureField: "output" },
    // R13 真派生（非 flat seed）：达成率 = 设备效率达成 × 良率达成 × 排程事件损。逐日持久化分量
    // （oeeAttain/yieldAttain/eventDip），使"为何未达成"可逐日拆为 设备效率损/良率损/检修·周末·爬坡损。
    // 计划基准 oeePlan/yieldPlan 由治理 planBaseline 注入（R14）；实际 OEE/良率分布镜像 oee:equip / yield:process。
    {
      seriesKey: "attainment:line", entityType: "Line", grain: "day", base: { mean: 0, noise: 0 },
      effects: ["weekend_dip", "maint_window_dip", "ramp_curve"], measureField: "attainment",
      derive: {
        kind: "attainment",
        oeePlan: (BATTERY_SOLVER_PARAMS.planBaseline as { oeePlan: number }).oeePlan,
        yieldPlan: (BATTERY_SOLVER_PARAMS.planBaseline as { yieldPlan: number }).yieldPlan,
        oeeMean: 0.78, oeeNoise: 0.04, yieldMean: 0.952, yieldNoise: 0.008,
      },
    },
    { seriesKey: "util:line", entityType: "Line", grain: "day", base: { mean: 92, noise: 1.2 }, effects: ["maint_window_dip"], measureField: "util" },
    // CL.5（PRD-attainment-base-daily-timeseries）：基地级日达成率序列——"本月逐日为何未达成"时间维度归因
    // 所需（现仅 attainment:line 产线级 + schedule_attainment 周聚合）。day grain、含检修/周末/爬坡剧本，
    // 达成率口径 = 实际/目标（与 Metric achievement 同源）。末位追加，保前序列 R6 字节一致。
    { seriesKey: "attainment:base", entityType: "Base", grain: "day", base: { mean: 0.918, noise: 0.018 }, effects: ["maint_window_dip", "weekend_dip", "ramp_curve"], measureField: "attainment" },
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
  // Phase9B 对象级数据变更（逐字段替换数据）：经 Action 审批后落账，EXECUTED 时把 patch 合并进对象 props
  // 并重跑派生 → 之后 resolve_slice/invoke_solver 即「二次推演」反映新数据。绝不绕过审批直改真值。
  {
    key: "对象数据变更",
    name: "对象数据变更",
    paramsSchema: {
      type: "object",
      required: ["objectId", "patch", "reason"],
      properties: { objectType: { type: "string" }, objectId: { type: "string" }, patch: { type: "object" }, reason: { type: "string" } },
    },
    checkRules: [] as string[],
    approvalChain: [{ role: "admin" }],
  },
  // QUERY30 缺口② C42 信用上调审批链（DESIGN-query30 §2.3 Q12）：信用额度上调超阈须经 S2 审批；
  // submit 预检 C42（upliftPct>approvalThresholdPct）BLOCK 即拒（防越权直改额度）。payload 携 CreditUplift 命名空间真值。
  {
    key: "信用额度上调",
    name: "信用额度上调",
    paramsSchema: {
      type: "object",
      required: ["customerId", "CreditUplift"],
      properties: { customerId: { type: "string" }, CreditUplift: { type: "object" }, reason: { type: "string" } },
    },
    checkRules: ["C42"] as string[],
    approvalChain: [{ role: "planner" }, { role: "admin" }],
  },
  // QUERY30 缺口② C45 自动对策仅生成草稿（DESIGN-query30 §2.3 Q18）：ScenarioTrigger 自动对策必经 S2 审批执行，
  // submit 预检 C45（autoExecutedCount>maxAutoExecute=0）BLOCK 即拒（防自动化越权直执行）。
  {
    key: "执行自动对策",
    name: "执行自动对策",
    paramsSchema: {
      type: "object",
      required: ["triggerId", "AutoAction"],
      properties: { triggerId: { type: "string" }, AutoAction: { type: "object" }, comboRef: { type: "string" } },
    },
    checkRules: ["C45"] as string[],
    approvalChain: [{ role: "planner" }, { role: "admin" }],
  },
  // QUERY30 缺口② C50 降级期高危动作双签（DESIGN-query30 §2.3 Q30）：关键数据源降级期间高危决策须双签，
  // submit 预检 C50（unsignedHighRiskActions>maxUnsigned=0）BLOCK 即拒（无双签的高危动作不得执行）。
  {
    key: "降级期高危决策",
    name: "降级期高危决策",
    paramsSchema: {
      type: "object",
      required: ["decisionRef", "Degrade"],
      properties: { decisionRef: { type: "string" }, Degrade: { type: "object" }, sourceKey: { type: "string" } },
    },
    checkRules: ["C50"] as string[],
    approvalChain: [{ role: "planner" }, { role: "admin" }],
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
  // catalog §3 C26–C33 作用域（映射表/影响面按此关联；与 expression 对象前缀一致）。
  C26: ["Cert"],
  C27: ["Lta"],
  C28: ["Batch"],
  C29: ["Order"],
  C30: ["Process"],
  C31: ["Outsource"],
  C32: ["Customer"],
  C33: ["Order"],
  // 规则即引用：13 条补全规则的作用域（与 expression 对象前缀一致）。
  C01: ["Line"],
  C02: ["Process"],
  C04: ["Line"],
  C06: ["MaterialBalance"],
  C09: ["DataSourceHealth"],
  C10: ["Action", "Scenario"],
  C11: ["MaintPlan"],
  C15: ["Order", "DemandSegment"],
  C16: ["MaterialBalance"],
  C21: ["SopVersionRow"],
  C22: ["Order"],
  C24: ["Quote", "DemandSegment"],
  C25: ["ExternalSignal"],
  // QUERY30 缺口② C34–C50 作用域（与 expression measured 命名空间一致；含 QUERY30-ONTOLOGY-EXT 新类型 Supplier）。
  C34: ["Order", "Line"],
  C35: ["Order"],
  C36: ["Order", "Customer"],
  C37: ["Order"],
  C38: ["Supplier", "Material"],
  C39: ["LabTest", "MaterialBatch"],
  C40: ["MaintPlan", "Equipment"],
  C41: ["LaborShift", "Process"],
  C42: ["Customer"],
  C43: ["Certification"],
  C44: ["EnergyMeter", "Order"],
  C45: ["ScenarioTrigger", "Action"],
  C46: ["SopVersionRow"],
  C47: ["PlanTarget", "AnnualScenario"],
  C48: ["Process", "Metric"],
  C49: ["Shipment", "Order"],
  C50: ["DataSourceHealth", "Action"],
};

/**
 * 轨N 增量2 · 规则 provenance（R13 溯源延伸到规则层）：出厂种子规则的「谁设定/何时/有效边界/依据」。
 * **诚实红线**：种子规则由系统出厂治理基线定义——definedBy 标"系统治理基线 v1"，**绝不编造人名**；
 * basis 标真实出处（治理规则集 / PRD），不假装有人签字。definedAt/effectiveFrom 用确定性治理基线日（R6 无 Date.now）。
 */
export const RULE_GOVERNANCE = {
  definedBy: "系统治理基线 v1",
  definedAt: "2026-06-01T00:00:00Z", // 锂电制造治理规则集出厂基线日（确定性常量）
  effectiveFrom: "2026-06-01", // 有效起；effectiveTo 留空 = 长期有效（随规则版本演进）
  basisDefault: "锂电制造治理规则集（出厂种子 · catalog §3 C-rules / PRD-rules-as-references）",
  basisByKey: {
    C03: "产能治理：产线设计上限不可突破（catalog §3 · PRD-platform-foundry-aip §S1 求解器约束）",
    C13: "客户信用风控基线（财务治理规则集 · 信用占用比 ≤ 额度）",
    C15: "毛利底线治理（财务计划基线 · 结构毛利率 ≥ 目标）",
    C18: "现金安全垫底线（S&OP 财务约束 · 13 周最低点 ≥ 阈值）",
    C23: "CAPEX 投资门槛（C1 capex_scenario · IRR/24 月利用率门槛）",
    C06: "齐套物料缺口治理（MRP 净需求 · 关键正极物料）",
    C02: "化成/老化串并产能口径（工艺产能治理）",
  } as Record<string, string>,
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
  // cockpit P1 绿地
  demandSegments: Record<string, unknown>[];
  financePlans: Record<string, unknown>[];
  materialBalances: Record<string, unknown>[];
  // cockpit P2 + SPINE 绿地
  metrics: Record<string, unknown>[];
  ksfs: Record<string, unknown>[];
  principals: Record<string, unknown>[];
  rootCauseChains: Record<string, unknown>[];
  // cockpit P5 / sop 绿地
  sopVersionRows: Record<string, unknown>[];
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
 * WO-CAP-02-SEED-VARY（§3 种子按基地分化·治恒红无涨落）：**确定性**每基地产能乘子（⛔非 rng·守 R6）。
 * 目的：让各基地真产能（化成/老化 → weeklyWan → demandCapacityTightness 的产能份额）**拉开档次**，
 * 从而风险看板的需求-产能张力在基地间**有高有低**（配合 WO-CAP-01 的真供需染红逻辑 → 有红有绿），
 * 而非当前"12 基地产能几乎同档 → 张力全簇在 56–68"的扁平态。
 *
 * 口径（守 C2·**只调产能常量·不动 util/OEE/良率时序均值**）：只乘化成通道数 channels + 老化库位 agingSlots
 * （二者派生出工序产能 + 基地共享产能上限 formationCapDaily/agingCapDaily），**不碰** util:line/oee:equip/yield:process
 * 时序均值（那会破 solvers.test.ts:211-314 的 设备OEE/良率 基线）。乘子按 baseId 固定映射（非随机·非时钟）。
 *
 * 方向（守 PRD §2 CAP-02 配比·瓶颈基地低产能）：瓶颈基地（BATTERY_SOLVER_PARAMS.bottleneck.primary :127-140
 * 已定 常州/合肥/江门 等）配**低产能乘子**（真产能↓ → 真需求/真产能占比↑ → 供需张力↑），非瓶颈基地配**高产能**。
 * 这是把"哪个基地紧"从合成扁平 util:line(mean92 全同) 挪回**真产能落差**上；配合 WO-CAP-01 用真供需张力
 * demandCapacityTightness 取代合成 util 染红后，低产能瓶颈基地→红、高产能富余基地→绿，得"有红有绿"。
 * 值域 0.82–1.25（PRD 示例配比 0.75–1.25 的收敛版），令各基地真周产能 weeklyWan 拉开约 1.5× 档次（原近扁平 1.2×）。
 * ⚠️ 校准耦合约束（实测坐实）：4680-NCM 的产地（常州/成都/合肥）产能进 `capacity_forecast|all|4680-NCM` 校准切片，
 * 幅度过大（±25%）会削弱 Process.yield 在预测中的杠杆 → m11-calibration C9 的 EMA 方法A回测改进闸不过（提案消失）。
 * 故这三地用**温和差异化**（0.92/1.08/0.92·±8%），其余基地保留强差异化（0.82–1.25）；差异化整体仍显著、确定性、守 R6。
 */
const CAPACITY_MULT_BY_BASE: Record<string, number> = {
  // 瓶颈基地（低产能·真紧约束）——PRD §2 CAP-02 示例配比
  hefei: 0.92, // 合肥（设备OEE 主瓶颈·4680-NCM 产地·温和差异化守 m11 校准回测闸）
  changzhou: 0.92, // 常州（瓶颈工序 主瓶颈·4680-NCM 产地·温和差异化守 m11 校准回测闸）
  jiangmen: 0.82, // 江门（物料齐套 主瓶颈）
  handan: 0.85, // 邯郸（物料齐套 主瓶颈）
  meishan: 0.9, // 眉山（人力工时）
  // 富余基地（高产能·相对宽松）
  wuhan: 1.1,
  xinyang: 1.05,
  zaozhuang: 1.0,
  zigong: 1.1,
  luoyang: 1.2,
  chengdu: 1.08, // 成都（4680-NCM 产地·温和差异化守 m11 校准回测闸）
  xiamen: 1.25,
};
function capacityMultOf(baseId: string): number {
  return CAPACITY_MULT_BY_BASE[baseId] ?? 1;
}

/**
 * Deterministic generation: master data (Base) → Model → Order → production
 * topology (Line/Process/Equipment) → calendars (MaintPlan/Shipment) → misc.
 * Referential integrity by construction; same seed → byte-identical output.
 */
export function generateBattery(seed: number, scale: "S" | "M" | "L" | "XL"): GeneratedBattery {
  const rng = mulberry32(seed);
  // HTML 24 单为语义基底 → 订单数下限 24（小规模即 24 单；M/L/XL 用 rng 补足到目标）。
  const orderCount = Math.max(24, scale === "S" ? 20 : scale === "M" ? 60 : scale === "XL" ? 10000 : 200);
  const t0 = Date.parse(`${BATTERY_SOLVER_PARAMS.forecastStart as string}T00:00:00Z`);

  const bases = BASES.map((b) => ({
    baseId: b.baseId,
    name: b.name,
    kind: b.kind,
    position: b.kind, // GeoMap 按 position 着色（动力/储能）
    lon: b.lon,
    lat: b.lat,
    util: uniformDomain(rng, 0.62, 0.35, 2, "util"), // A6.3 收编：原 round(0.62+rng()*0.35,2)，字节一致
    bottleneck: pick(rng, BOTTLENECKS),
    gwh: uniformDomain(rng, 6, 36, 1, "gwh"), // A6.3 收编：原 round(6+rng()*36,1)，字节一致
    formationCapDaily: 0, // filled after process generation (shared-resource cap)
    agingCapDaily: 0,
  }));

  const models = MODELS.map((m) => {
    // rng 仍按原步长消耗（n + 洗牌），保持下游订单/拓扑字节流稳定；可产基地改取确定性 MODEL_BASE_MAP。
    const n = randInt(rng, 2, 5);
    const shuffled = [...BASES.map((b) => b.baseId)];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = shuffled[i] as string;
      shuffled[i] = shuffled[j] as string;
      shuffled[j] = tmp;
    }
    const mappedBases = MODEL_BASE_MAP[m.modelId] ?? shuffled.slice(0, n);
    return {
      modelId: m.modelId,
      name: m.name,
      chem: m.chem,
      pos: m.pos,
      bases: [...mappedBases].sort(),
      unitPrice: randInt(rng, 380, 980),
      // C33：NCM 体系碳足迹 >70 阈值（越线），LFP 达标。
      carbonFootprint: m.modelId.includes("NCM") ? 76 : 58,
    };
  });

  // PRD-IND-order-aggregate：HTML 24 单逐字录入（so/cust/model/qty/due/pri，SO-3391…SO-3540），
  // 替代随机生成 → 订单全链/台账/根因 1:1。可产基地取该 model 的 MODEL_BASE_MAP（确定性）。
  const modelById = new Map(models.map((m) => [m.modelId, m]));
  const t0ms = Date.parse(`${BATTERY_SOLVER_PARAMS.forecastStart as string}T00:00:00Z`);
  // QUERY30-ONTOLOGY-EXT：Order 挤占五件套 + 锁价/成本快照（确定性派生·不依赖 rng·不移位既有字段·R6）。
  const orderExtras = (so: string, i: number, unitPrice: number, dueDay: number, orderBases: string[]) => {
    const advance = i % 8 === 0 ? 14 : 0; // 加单提前交期（Q01 "提前 20%"）
    const promiseDay = Math.max(0, dueDay - advance);
    return {
      promiseDate: new Date(t0ms + promiseDay * 86400000).toISOString().slice(0, 10),
      marginPct: round(12 + (hashString(`${so}m`) % 12) - (i % 7 === 0 ? 6 : 0), 1), // 压价行低毛利（越 floor）
      allocatedLineIds: orderBases.map((b) => `LINE-${b}`), // 占线明细（order_allocated_on 边源·真 Line id）
      penaltyClause: round((hashString(`${so}p`) % 15) / 100, 2), // 违约金率 0–0.15
      substitutable: i % 3 === 0, // 可外协标记
      priceLockedUntil: i % 9 === 0 ? new Date(t0ms + (dueDay + 30) * 86400000).toISOString().slice(0, 10) : "", // 锁价期（部分订单）
      costBreakdown: { material: round(unitPrice * 0.6, 0), labor: round(unitPrice * 0.15, 0), energy: round(unitPrice * 0.1, 0) },
    };
  };
  const orders: Record<string, unknown>[] = HTML_ORDERS.map((o, i) => {
    const model = modelById.get(o.model);
    const producible = model?.bases ?? [];
    // 落单基地：取该型号可产基地前 1（确定性，按 so 选起点以分散）；多基地型号取相邻 1–2。
    const startIdx = producible.length > 0 ? hashString(o.so) % producible.length : 0;
    const nBases = producible.length >= 3 ? 2 : 1;
    const orderBases = producible.length > 0
      ? Array.from({ length: Math.min(nBases, producible.length) }, (_, k) => producible[(startIdx + k) % producible.length] as string).sort()
      : [];
    const dueDay = Math.max(0, Math.round((Date.parse(`${o.due}T00:00:00Z`) - t0ms) / 86400000));
    return {
      so: o.so,
      cust: o.cust,
      model: o.model,
      qty: o.qty * ORDER_QTY_CELLS_PER_LOT, // 维度校正：批次口径→电芯口径（与 Line.capacityDaily 同口径·Q01 挤占真触发）
      due: o.due,
      pri: o.pri,
      bases: orderBases,
      status: "OPEN",
      unitPrice: model?.unitPrice ?? 600,
      // 约束扫描字段：确定性派生（不依赖 rng），按固定步长植入越线行（C03/C08/C13/C29）。
      demandDelta: i % 8 === 0 ? 0.6 : round((hashString(o.so) % 50) / 100, 2),
      outsourceRatio: i % 6 === 0 ? 0.35 : round((hashString(`${o.so}o`) % 18) / 100, 2),
      creditUsedRatio: i % 7 === 0 ? 1.15 : round(0.4 + (hashString(`${o.so}c`) % 50) / 100, 2),
      leadDays: dueDay,
      ...orderExtras(o.so, i, model?.unitPrice ?? 600, dueDay, orderBases),
    };
  });

  // 规模测试（M/L/XL）：HTML 24 单为语义基底，超出部分用 rng 生成补足到 orderCount（性能基线 XL=10000）。
  for (let i = orders.length; i < orderCount; i++) {
    const model = models[Math.floor(rng() * models.length)] as (typeof models)[number];
    const producible = model.bases;
    const nBases = randInt(rng, 1, Math.min(2, Math.max(1, producible.length)));
    const start = producible.length > 0 ? Math.floor(rng() * producible.length) : 0;
    const orderBases = producible.length > 0
      ? Array.from({ length: nBases }, (_, k) => producible[(start + k) % producible.length] as string).sort()
      : [];
    const dueDay = randInt(rng, 0, 180);
    const due = new Date(t0ms + dueDay * 86400000).toISOString().slice(0, 10);
    const so = `SO-9${String(i).padStart(5, "0")}`;
    orders.push({
      so, cust: pick(rng, CUSTOMERS), model: model.modelId, qty: randInt(rng, 100, 2500) * ORDER_QTY_CELLS_PER_LOT, due,
      pri: ["高", "中", "低"][i % 3], bases: orderBases, status: "OPEN", unitPrice: model.unitPrice,
      demandDelta: i % 25 === 0 ? 0.6 : round((hashString(so) % 50) / 100, 2),
      outsourceRatio: i % 17 === 0 ? 0.35 : round((hashString(`${so}o`) % 18) / 100, 2),
      creditUsedRatio: i % 13 === 0 ? 1.15 : round(0.4 + (hashString(`${so}c`) % 50) / 100, 2),
      leadDays: dueDay,
      ...orderExtras(so, i, model.unitPrice, dueDay, orderBases),
    });
  }

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
    // WO-CAP-02：确定性每基地产能乘子（乘化成通道数·非 rng·R6）。rng 抽样步长不变（仅事后乘固定映射）。
    const capMult = capacityMultOf(b.baseId);
    const channels = Math.round(randInt(rngTopo, 600, 780) * capMult);
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
    // WO-CAP-02：老化库位同乘确定性基地产能乘子（与化成同向·非 rng·R6）。
    const agingSlots = Math.round(randInt(rngTopo, 260000, 340000) * capMult);
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

  // QUERY30-ONTOLOGY-EXT：Line 三字段富化（第二遍·确定性派生自 base 产能上限 + certLinks·不消费 rng·R6）。
  //  capacityDaily = 线级瓶颈日产能（化成/老化上限取小·真拓扑派生·非 Base 聚合猜值）；
  //  certifiedModels = 该线量产/认证中型号（Q01/Q15 认证线约束锚）；changeoverGroup = 换型化学族（Q08）。
  const baseById = new Map(bases.map((b) => [b.baseId, b]));
  for (const l of lines) {
    const b = baseById.get(String(l.baseId));
    const cap = b ? Math.min(Number(b.formationCapDaily ?? 0), Number(b.agingCapDaily ?? 0)) : 0;
    const certed = certLinks.filter((cl) => cl.lineId === l.lineId).map((cl) => cl.modelId);
    const lfp = certed.filter((mid) => mid.includes("LFP")).length;
    l.capacityDaily = cap;
    l.certifiedModels = certed;
    l.changeoverGroup = certed.length === 0 ? "未定" : lfp * 2 >= certed.length ? "LFP系" : "NCM系";
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

  // 数据源健康度（Phase5B 工业级）：9 个企业源系统 + XL 档每基地 IoT 采集器。
  // lagHours 确定性，植入 3 处 >2h 降级（触发 C09 数据时延临时降级）。
  const dataHealth: Record<string, unknown>[] = [
    // 关键源(critical)统一 ≤2h → 不在种子态触发 P90 降级（与既有 capacity_forecast/数据健康行为一致）；
    // >2h 仅落在非关键源(srm/lims) → C09 仍能在数据上触发，但不扰动产能降级判定。
    { sourceId: "iot-scada", name: "IoT/SCADA 实时采集", critical: true, lagHours: 0.5 },
    { sourceId: "mes", name: "MES 生产执行", critical: true, lagHours: 1.2 },
    { sourceId: "erp", name: "ERP 销售/财务", critical: true, lagHours: 1.8 },
    { sourceId: "srm", name: "SRM 供应商协同", critical: false, lagHours: 2.6 },
    { sourceId: "plm", name: "PLM 型号/认证", critical: false, lagHours: 1.0 },
    { sourceId: "wms", name: "WMS 仓储", critical: false, lagHours: 0.8 },
    { sourceId: "qms", name: "QMS 质量", critical: true, lagHours: 1.5 },
    { sourceId: "ems", name: "EMS 能耗管理", critical: false, lagHours: 0.9 },
    { sourceId: "lims", name: "LIMS 实验室", critical: false, lagHours: 4.1 },
  ];
  if (scale === "XL") {
    for (const b of bases) {
      dataHealth.push({ sourceId: `iot-${b.baseId}`, name: `${b.name} IoT 采集器`, critical: false, lagHours: round(0.3 + (hashString(b.baseId) % 30) / 10, 1) });
    }
  }

  // PRD-IND-sop §4.3 / PRD-IND-dash §4.1：三线对照精确种子（SOP_SEG + SEG_PRICE/MARGIN/FLOOR），
  // P90 为保守下分位（< P50）；同 seed 字节一致（R6），前端三线/科目/台账同源（R-一致）。
  // DF.3 单一来源：price/margin/floor 从 SEG_REGISTRY 派生（demand 三线 tgt/p50/p90/act 为 sop 专属，保留内联）。
  const SEG_DEMAND = [
    { segment: "乘用车", tgt: 69.0, p50: 71.0, p90: 66.5, act: 66.8 },
    { segment: "储能", tgt: 45.0, p50: 49.0, p90: 45.2, act: 41.9 },
    { segment: "商用车", tgt: 13.6, p50: 12.0, p90: 11.1, act: 12.9 },
  ];
  const SEGMENTS = SEG_DEMAND.map((d) => {
    const s = SEG_REGISTRY.find((x) => x.seg === d.segment)!;
    return { ...d, price: s.priceWan, margin: s.marginPct, floor: s.floorPct };
  });
  const demandSegments = SEGMENTS.map((s, i) => ({
    segId: `dseg-${i + 1}`, segment: s.segment, tgt: s.tgt, p50: s.p50, p90: s.p90, act: s.act,
    priceWan: s.price, marginPct: s.margin, floorPct: s.floor,
  }));
  // PRD-IND-sop §4.4 SOP_MAT：MRP 净需求精确种子（缺口 = net×(1−lta/100)，C06 齐套口径）。
  const MAT = [
    { material: "三元正极", unit: "吨", net: 8180, lta: 92, eta: "2026-06-28" },
    { material: "隔膜", unit: "万㎡", net: 2376, lta: 100, eta: "" },
    { material: "电解液", unit: "吨", net: 5544, lta: 96, eta: "2026-06-25" },
  ];
  const materialBalances = MAT.map((m, i) => ({
    matBalId: `mbal-${i + 1}`, material: m.material, unit: m.unit, netDemandTon: m.net, ltaPct: m.lta,
    gapTon: round(Math.max(0, m.net * (1 - m.lta / 100)), 0),
    etaDate: m.eta,
    // 反事实排除候选维度（demo 态）：物流到货在窗口内、安全库存充足 → 这两维缺口恒 0（反算达标→排除）。
    logisticsGapTon: 0,
    safetyStockGapTon: 0,
  }));
  // 财务预算三线：收入=Σ收入细分、销售成本=收入-毛利、毛利=Σ毛利额（与 DemandSegment 交叉一致）。
  const totalRev = demandSegments.reduce((s, d) => s + (d.p50 as number) * (d.priceWan as number), 0);
  const totalMargin = demandSegments.reduce((s, d) => s + (d.p50 as number) * (d.priceWan as number) * (d.marginPct as number) / 100, 0);
  const financePlans = [
    { finId: "fin-rev", line: "收入", budget: round(totalRev * 0.98, 1), rolling: round(totalRev, 1) },
    { finId: "fin-cogs", line: "销售成本", budget: round((totalRev - totalMargin) * 0.98, 1), rolling: round(totalRev - totalMargin, 1) },
    { finId: "fin-gm", line: "毛利", budget: round(totalMargin * 0.98, 1), rolling: round(totalMargin, 1) },
  ];

  // SPINE：KSF 五要素（口径同 HTML KSF_DEF）+ 责任主体（org/role/person）。
  const ksfs = [
    { ksfId: "ksf-dem", key: "k_dem", name: "需求结构", sub: "细分占比与价格" },
    { ksfId: "ksf-bal", key: "k_bal", name: "产销爬坡", sub: "产能与达成" },
    { ksfId: "ksf-kit", key: "k_kit", name: "物料齐套", sub: "长协与现货缺口" },
    { ksfId: "ksf-cash", key: "k_cash", name: "信用现金", sub: "应收与现金垫" },
    { ksfId: "ksf-cost", key: "k_cost", name: "成本外协", sub: "制造成本与外协" },
  ];
  const principals = [
    { principalId: "prin-coo", name: "运营负责人", kind: "role", parentRef: null },
    { principalId: "prin-plan", name: "计划部", kind: "org", parentRef: "prin-coo" },
    { principalId: "prin-supply", name: "供应链部", kind: "org", parentRef: "prin-coo" },
    { principalId: "prin-fin", name: "财务部", kind: "org", parentRef: "prin-coo" },
  ];
  // SPINE：指标库 Metric（= cockpit PlanKpi 归一）。actual 全部经 P1 同源数据算出（与驾驶舱数字交叉一致，R14/R13/R-一致）；
  // 归挂 KSF + 责任人 + 越线根因 chainKey。metric_rollup 求解器据此对齐 target 算 delta/miss。
  const totalTgt = demandSegments.reduce((s, d) => s + (d.tgt as number), 0);
  const totalAct = demandSegments.reduce((s, d) => s + (d.act as number), 0);
  const totalNet = materialBalances.reduce((s, m) => s + (m.netDemandTon as number), 0);
  const totalCovered = materialBalances.reduce((s, m) => s + (m.netDemandTon as number) * (m.ltaPct as number) / 100, 0);
  const metrics = [
    { metricId: "kpi-margin", key: "gm_rate", name: "毛利率", level: "op", category: "profit", target: 16, actual: round(round(totalMargin, 1) / round(totalRev, 1) * 100, 1), floorVal: 13, unit: "%", weight: 0.4, ksfRef: "ksf-dem", ownerRef: "prin-fin", chainKey: "rc-profit-mix" },
    { metricId: "kpi-attain", key: "demand_attain", name: "需求达成率", level: "op", category: "scale", target: 100, actual: round(totalAct / totalTgt * 100, 1), floorVal: 95, unit: "%", weight: 0.3, ksfRef: "ksf-bal", ownerRef: "prin-plan", chainKey: "rc-scale-demand" },
    { metricId: "kpi-material", key: "material_cov", name: "物料保障率", level: "op", category: "material", target: 100, actual: round(totalCovered / totalNet * 100, 1), floorVal: 95, unit: "%", weight: 0.3, ksfRef: "ksf-kit", ownerRef: "prin-supply", chainKey: "rc-material-gap" },
  ];
  // cockpit P5 / sop：S&OP 版本演进 V1→V7（需求渐增、供给追赶、缺口收敛；V7 待定稿）。同源 totalRev/需求规模派生。
  const demBase = round(totalTgt, 0);
  const sopVersionRows = [1, 3, 5, 7].map((v, i) => {
    const demand = round(demBase * (0.96 + i * 0.02), 0);
    const supply = round(demand * (0.9 + i * 0.03), 0);
    return {
      verId: `sopv-V${v}`, ver: `V${v}`,
      date: isoDate(Date.UTC(2026, 4, 1) + i * 14 * 86400000),
      demand, supply,
      note: ["初版需求", "供给评审上修", "财务整合", "高管会待定稿"][i],
      isFinal: v === 7,
    };
  });
  // 根因归因模板（配成对象，确定性常数；求解器沿 driverType 取活数据算贡献 → 「结构=算、模板=配成对象」）。
  const rootCauseChains = [
    { chainId: "rc-profit-mix", kpiCategory: "profit", factor: "低毛利细分占比偏高", driverType: "DemandSegment", evidenceField: "marginWan", selectField: "segment", baseWeight: 0.5 },
    { chainId: "rc-profit-material", kpiCategory: "profit", factor: "物料成本上行", driverType: "MaterialBalance", evidenceField: "gapTon", selectField: "material", baseWeight: 0.5 },
    { chainId: "rc-scale-demand", kpiCategory: "scale", factor: "细分需求未达预期", driverType: "DemandSegment", evidenceField: "act", selectField: "segment", baseWeight: 1 },
    { chainId: "rc-material-gap", kpiCategory: "material", factor: "现货缺口扩大", driverType: "MaterialBalance", evidenceField: "gapTon", selectField: "material", baseWeight: 1 },
    // 轨M 增量3（反事实排除层·母版 §1.B）：物料保障率缺口的另两个候选根因——物流时效 / 安全库存。
    // demo 态此两维缺口恒 0（反算达标）→ plan_rootcause 贡献 0 → 显式「已排除」+理由，根因 DAG 出反事实排除层。
    { chainId: "rc-material-logistics", kpiCategory: "material", factor: "物流时效不足", driverType: "MaterialBalance", evidenceField: "logisticsGapTon", selectField: "material", baseWeight: 1 },
    { chainId: "rc-material-safety", kpiCategory: "material", factor: "安全库存不足", driverType: "MaterialBalance", evidenceField: "safetyStockGapTon", selectField: "material", baseWeight: 1 },
  ];

  return { bases, models, orders, lines, processes, equipment, maintPlans, segments, shipments, dataHealth, demandSegments, financePlans, materialBalances, metrics, ksfs, principals, rootCauseChains, sopVersionRows, certLinks };
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
  const scenario = (key: string, name: string, demand: number, note: string, decision: string, lta: string, finalized: boolean) => ({
    scnId: `AOP-${year}-${key}`,
    key,
    name,
    year,
    demand,
    note,
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
    scenario("conservative", "保守", round(annualBase * pv.scenarios.conservativeFactor, 1), "乘用车放缓、储能温和；不赌新增产能，守现金", "维持现有产线，不新增产能投资", "锂盐长协锁量 60%，季度滚动议价", false),
    scenario("baseline", "基准", annualBase, "乘用车持平 +8%、储能放量；按年度承诺扩产", "合肥四期 8GWh 扩产，2027-Q2 投产", "锂盐长协锁量 70%，年度锁价", true),
    scenario("aggressive", "激进", round(annualBase * pv.scenarios.aggressiveFactor, 1), "海外大单落地、储能高增；双基地并扩抢份额", "合肥四期 + 盐城二期合计 20GWh 扩产", "锂盐长协锁量 85%，并签三年框架", false),
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
