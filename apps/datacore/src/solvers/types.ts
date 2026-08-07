import {
  matchObjectRefInType,
  pickObjectRefResolution,
  type ObjectRefResolution,
  type RefTypeDefLike,
} from "@platform/contracts";
import type { ObjectInstance } from "../domain.js";
// WO-ARGNAME-SCOPE（#103）：作用域键不受认 → AMBIGUOUS_SCOPE 400（errors.ts 零依赖·不成环）。
import { AppError } from "../errors.js";

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
    // WO-SANDBOX-D3：hardCapShortfallK 为**可选**——老租户 solverParams 里没有它时，
    // 硬容量读数诚实退化为 EMPTY（reason 说明缺参），**不静默按 0 或某个默认系数算**。
    live: { oeeK: number; oeeBase: number; utilK: number; utilBase: number; yieldK: number; yieldBase: number; hardCapShortfallK?: number };
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
      /** PRD-IND-dash ORDER_OVR：逐单越线注入（按 so 覆盖信用/毛利，含 why 文案）——确定性种子让台账出现"未接/提价接"。 */
      overrides?: Record<string, { credit?: boolean; mAdj?: number; why?: string }>;
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

/**
 * Ontology slice snapshot every solver computes from (deterministic input).
 *
 * WO-DATACORE-LAZY-SOLVER-CONTEXT（性能注记·字段结构不变）：核心 10 类
 * （bases/lines/processes/equipment/maintPlans/models/orders/shipments/segments/dataHealth）此前一律全表扫。
 * loadContext 现支持按 solverKey 裁剪（见 service.ts `SOLVER_REQUIRED_TYPES` 声明表 + `dc.lazy-solver-context` 暗发门）——
 * 未声明的核心类型置 `[]`（求解器不读即逐字节等价）。**字段形状本身不改**：裁掉的类型仍是 `ObjectInstance[]`（空数组），
 * 求解器无需感知加载策略。⚠ certByModel 由 Line+Model+model_certified_on link 派生 → 需它的求解器必须连带声明 Line+Model。
 * params/rules/ruleSetVersion/isSynthProvenance 便宜且共享 → 永远加载（不裁）。
 */
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
  /**
   * 供应商台账（`Supplier`）。**两个单同时要了这张表，此处是合并后的唯一声明**（并线时 D2 与
   * WO-DECISION-INFO 各自加过一次 → `error TS2300: Duplicate identifier 'suppliers'`；
   * 两侧语义相同，故合并注释而非并存两个字段）。
   *
   * · WO-SANDBOX-D2 · 采购段按责任方分解所需的三类真源之一（随 `withExtended` 一起加载）。
   *   此前 `Supplier` 压根不在 SolverContext 里 —— 这就是 `minOrderQty`/`onTimeRate`
   *   在 `solvers/` 零消费方的**结构性原因**（不是"没人想用"，是引擎根本拿不到这张表）。
   * · WO-DECISION-INFO ③.2 · 外协补足的**提前期**真值来源（`leadTime`，只认 `status==='合格'`：
   *   观察/淘汰的供应商不能当作可依赖的外协前置期）。缺省 `[]` → 诚实 EMPTY（不回落 `+14` 魔数）。
   */
  suppliers?: ObjectInstance[];
  customsClearances?: ObjectInstance[];
  incomingInspections?: ObjectInstance[];
  carbonFactors?: ObjectInstance[];
  /**
   * WO-ADOPT-MITIGATION · 已采纳处置方案台账（对象类型 `AdoptedMitigation`·由 `adopt_mitigation` Action
   * 审批执行写入）。**按需加载**（见 service.ts `ADOPTION_AWARE_SOLVERS`：仅 risk_timeline /
   * counterfactual_timeline 载·其余求解器不扫此类型），故与核心 10 类的 solverKey 裁剪机制正交。
   *
   * 消费方 `risk.ts riskTimeline`：逐 (baseId,factor) 取 status==="ACTIVE" 的采纳记录 → 把其 {eff,tn}
   * 喂进 **真曲线** `tensionSeries`（不是 `card.mitigated` 那条"如果采纳会怎样"的对照曲线）。
   * optional：缺省 / 空数组（测试直构 ctx / 无人采纳）→ 与采纳功能上线前**逐字节一致**（向后兼容 R6）。
   */
  adoptedMitigations?: ObjectInstance[];
  /**
   * WO-DECISION-INFO ③.2 · 跨基地调拨台账（`InterBaseTransfer`）—— 处置推演的**跨基地在途前置期**真值来源
   * （`transitDays` 距离派生 `ceil(baseDistanceKm/dailyTruckKm)`）+ 跨基地运费单价来源（`freightCost/qty`）。
   * **按需加载**（service.ts `DECISION_INFO_SOLVERS`·照 ADOPTION_AWARE_SOLVERS 写法），缺省 `[]` →
   * 前置期诚实 EMPTY（不回落 `+7` 魔数），与本单上线前逐字节一致（向后兼容 R6）。
   */
  interBaseTransfers?: ObjectInstance[];
  // 规则即引用（PRD-rules-as-references §2.2/§4）：本租户已发布规则快照（按 ruleKey 索引）+ 规则集版本
  // 指纹。求解器闸门据此调规则引擎得 PASS/WARN/BLOCK，阈值读 rule.params；推演记录 ruleSetVersion（R6）。
  // optional：缺省（如测试直接构造 ctx）视为无规则——向后兼容，不破 R6。
  rules?: Record<string, { key: string; name: string; expression: string; severity: "BLOCK" | "WARN" | "INFO"; params?: Record<string, number | string | string[]> }>;
  ruleSetVersion?: string;
  // WO-DATAMODE-UNIFY-PROVENANCE（唯一真相合成 provenance 谓词·SolverService.buildSynthProvenancePredicate 注入）：
  // 逐对象判"是否合成种子物化"——origin SYNTHETIC ∪（MATERIALIZED 且 datasetId ∈ 合成源连接的物化数据集集）。
  // 求解器据此把**合成对象**派生的紧张度/卡/行加性标 provenanceSynthetic（measurement 维 live/dataMode 不动，两维正交），
  // 使合成数据绝不冒充 LIVE/实测（闭 G-DATAMODE-PROVENANCE-LEAK）。optional：缺省（测试直构 ctx / 无合成源）
  // 视为"全非合成"→ 现行行为不变（向后兼容 R6）。
  isSynthProvenance?: (o: ObjectInstance) => boolean;
}

export function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/**
 * WO-BASE-ID-FIDELITY · base 标识符规范化**单一出处**（跨 solver 复用·勿散落）。
 * 认多形态并归一到「裸 base 键」：
 *   - `obj_base_<id>`（synthetic 图节点 id·synthetic/service.ts toId=`obj_base_${baseId}`）→ strip 前缀 → `<id>`
 *   - `<id>`（baseId 拼音 changzhou）/ 中文名（常州）→ 原样（由调用方各自按 baseId/name 匹配）
 *   - object ref（{objectId} / {baseId} / {id}）→ 取其 id 字段再归一
 * 只做**字符串归一**（strip 前缀 + 对象取 id + trim），不做数据查找——各调用方（risk.resolveBaseId /
 * bottleneckMatrix.resolveRef / service.gapAttribution.normalizeBaseId / capacity 基地过滤）按自身数据集匹配。
 * R6 纯函数·无随机/时钟/副作用。空/无效 → ""。
 */
export function normalizeBaseRef(ref: unknown): string {
  let s: string;
  if (ref !== null && typeof ref === "object") {
    const o = ref as Record<string, unknown>;
    s =
      typeof o.objectId === "string" ? o.objectId :
      typeof o.baseId === "string" ? o.baseId :
      typeof o.id === "string" ? o.id : "";
  } else {
    s = typeof ref === "string" ? ref : ref == null ? "" : String(ref);
  }
  s = s.trim();
  if (s.startsWith("obj_base_")) s = s.slice("obj_base_".length);
  return s;
}

// ---------------------------------------------------------------------------
// WO-BASE-SLOT-UNIFY §A 引擎半 · base **解析**改走共享解析器（`G-BASE-SLOT-TYPE-SPLIT` 引擎侧）
//
// 病根（真 Kimi 实测）：`capacity_forecast` 收到用户原话「常州工厂」→ 老 `resolveBaseId` 只做
// `props.baseId === key || props.name === key` **精确**比对（`BASE_REGISTRY` 规范名是裸「常州」）
// → 400 `unknown base: 常州工厂` → 任务 FAILED。agent 工具直调（`sim_*` / DRIL）**不经槽位层**，
// 所以光把 AgentCore 的槽改成 objectRef 治不了这条路 —— 两半必须一起改。
//
// ⛔ 单一出处纪律（工单：「现在已经有两套了，这单是来收口不是来加的」）：
//   本函数**一行匹配逻辑都不写**，规则全部来自 contracts `matchObjectRefInType`
//   （AgentCore 槽位层 / DataCore `ontology.resolveObjectRef` / mock 调的是**同一个**函数）。
//   DataCore 侧**没有也不许有**第三套中文名匹配 / 任何「中文名 → id」词表（R14 应用层零业务常数）。
//
// 接受层级 id / name / alias / **partial**：`partial`（人话近指·「常州工厂」「常州基地」→ `Base.name=常州`）
// 是这条路真正缺的那一档，且**只在精确层零命中时才兜底**（见 object-ref-resolve.ts ③），
// 故所有既有精确入参逐字节不回归（R6）。歧义仍走既有机制（`ambiguous` + 候选·绝不静默取第一个）。
// ---------------------------------------------------------------------------

/**
 * 从**行数据本身**结构化派生 `RefTypeDefLike`（求解器上下文没有 ObjectTypeDef，只有对象行）。
 *
 * 零业务常数（R14）：属性表 = 行里真出现过的键；主键按平台**命名约定** `<typeKey 首字母小写>Id`
 * 派生（`Base→baseId`、`Model→modelId`，与 `synthetic/battery.ts baseProps isPrimaryKey:true` 一致）。
 * 名称类属性由 contracts `identifyingProps` 自己按「去分隔符后以 name 结尾」结构判定，本函数不参与。
 * `searchable` 无从得知 → 不声明（alias 档在求解器侧自然不可用·诚实退化，不臆造）。
 * 排序确定（属性名字典序）→ R6 同输入同输出。
 */
export function refTypeDefFromRows(typeKey: string, rows: readonly ObjectInstance[]): RefTypeDefLike {
  const pk = `${typeKey.charAt(0).toLowerCase()}${typeKey.slice(1)}Id`;
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.props)) keys.add(k);
  return {
    key: typeKey,
    properties: [...keys].sort().map((propKey) => (propKey === pk ? { propKey, isPrimaryKey: true } : { propKey })),
  };
}

/**
 * base 引用 → 解析结果（**归一 + 匹配的单一出处**·纯函数 R6）。
 * 调用方只负责「取哪些行」（`c.bases` 已带租户隔离 + A6 行级过滤），匹配语义一律走共享解析器。
 * 解析失败/歧义时带回 `attempts`/`candidates`（试了什么键、扫了几行、为什么不匹）——
 * 让下一个人不必从 400 一路追回来（R13 可诊断）。
 */
export function resolveBaseRef(bases: readonly ObjectInstance[], ref: unknown): ObjectRefResolution {
  const rows = bases.map((b) => ({ id: b.id, props: b.props }));
  const { hits, attempt } = matchObjectRefInType({
    ref,
    objectType: "Base",
    typeDef: refTypeDefFromRows("Base", bases),
    rows,
    accept: ["id", "name", "alias", "partial"],
  });
  return pickObjectRefResolution(ref, hits, [attempt]);
}

// ---------------------------------------------------------------------------
// WO-ARGNAME-SCOPE（欠账 #103）· base 作用域**参数键**的单一出处
//
// 病根（2026-08-07 实测复现·非推理）：`capacity_forecast` 只读 `args.base` 一个键。
//   modelId=4680-NCM / seed 42 / 13 基地：
//     base   = "changzhou" → scope=BASE p50=5.5176   ← 认
//     baseId = "changzhou" → scope=ALL  p50=12.3016  ← **静默答全网**
//     baseId = "chengdu"   → scope=ALL  p50=12.3016  ← 与上一行**逐字节相同**
//     baseName="常州"      → scope=ALL  p50=12.3016  ← 静默答全网
//     baseId = "火星基地"   → scope=ALL  p50=12.3016  ← 连不存在的基地都不报错
//   而 `catalog.ts argHints` 只写 `{modelId,qty,weeks}`、contracts `CapacityForecastArgs`
//   也没登记 `base` —— agent 看见的两处「机器可读入参说明」里**都没有基地这一维**，
//   于是照猜 `baseId`（兄弟求解器 affected_orders/bottleneck_matrix/base_capacity_outlook 确实读这个键）
//   → 用户以为问的是某个基地，拿到的是全网。这是**静默错答**，比 400 坏得多。
//
// 三态定性（铁律 0.5）：**「接了线接错地方」** —— base 作用域这条线是通的（scope:BASE 真能收窄），
//   只是入口只开了 `base` 一个键名；不是「没接线」也不是「没数据」。
//
// 口径（照 `credit_exposure`/`carbon_footprint` 既有样板·不造第二种）：
//   ① **要么认**：`base`/`baseId`/`baseName`/`baseRef` 四别名归一到同一条解析路（本函数）；
//   ② **要么报错**：键名形似基地作用域但不在受认集（`baseIds`/`base_id`/`basename`…）
//      → `AMBIGUOUS_SCOPE` 400；两个受认键给了**互相冲突**的值 → 同样 400；
//   ③ **绝不静默忽略**：任何情况下都不许「收到一个我不读的作用域键，然后照样答全网」。
//
// ⚠ 边界（刻意不动的部分·避免造第二种错误码）：**「键认识但值解析不到」** 仍走各求解器既有的
//   解析器与既有错误码（capacity → `risk.resolveBaseId` 的 `VALIDATION_ERROR unknown base`；
//   carbon_footprint → `resolveBaseRef` + `AMBIGUOUS_SCOPE`）。本函数只回答「用哪个键」，
//   不回答「这个值指向谁」—— 后者早有单一出处（`resolveBaseRef`），重复实现才是造第二套。
// ---------------------------------------------------------------------------

/** base 作用域参数的**受认别名集**（单一出处·新增别名只在这里加）。 */
export const BASE_SCOPE_ARG_KEYS = ["base", "baseId", "baseName", "baseRef"] as const;

/** 形似 base 作用域但**不在受认集**的键 → 报错而非静默忽略（`baseIds`/`base_id`/`basename`/`baseKey`…）。 */
const BASE_SCOPE_LOOKALIKE = /^base[s_A-Z]/;

/** 命中的 base 作用域参数：`argKey` 留痕「你传的是哪个键」（R13 可诊断）。 */
export interface BaseScopeArgPick {
  argKey: string;
  raw: unknown;
}

/**
 * 从 args 里取 base 作用域引用（**键名的单一出处**·纯函数 R6·无 IO）。
 *
 * @returns `undefined` = 真的没给基地（调用方走全域并**显式**标 `scope:"ALL"`，这是合法的诚实全网）。
 * @throws `AppError(AMBIGUOUS_SCOPE, 400)` 当 ① 形似作用域键但不受认，或 ② 多个受认键互相冲突。
 */
export function pickBaseScopeArg(solverKey: string, args: Record<string, unknown>): BaseScopeArgPick | undefined {
  const accepted = new Set<string>(BASE_SCOPE_ARG_KEYS);
  // ② 不认识的作用域键 → 报错（这一条正是 #103 的治本：静默忽略 = 冒充全网答案）。
  const strays = Object.keys(args)
    .filter((k) => !accepted.has(k) && BASE_SCOPE_LOOKALIKE.test(k))
    .filter((k) => normalizeBaseRef(args[k]) !== "" || Array.isArray(args[k]));
  if (strays.length > 0)
    throw new AppError(
      "AMBIGUOUS_SCOPE",
      `${solverKey}：收到无法消费的基地作用域参数 ${strays.map((k) => `「${k}」`).join("、")}` +
        `——本求解器只认 ${BASE_SCOPE_ARG_KEYS.map((k) => `\`${k}\``).join("/")}。` +
        `拒绝把它静默忽略后照答全网合计（那样用户会以为问的是某个基地·R-ARG-FIDELITY·G-ARG-DROP-SEAM）`,
      400,
    );

  const present = BASE_SCOPE_ARG_KEYS.filter((k) => k in args)
    .map((k) => ({ argKey: k as string, raw: args[k], norm: normalizeBaseRef(args[k]) }))
    .filter((p) => p.norm !== "");
  if (present.length === 0) return undefined;

  // ①b 多键冲突 → 报错（绝不在两个基地里挑一个冒充答案·同 credit_exposure 拒绝落首个客户的理由）。
  const distinct = [...new Set(present.map((p) => p.norm))];
  if (distinct.length > 1)
    throw new AppError(
      "AMBIGUOUS_SCOPE",
      `${solverKey}：同时收到互相冲突的基地作用域参数（${present.map((p) => `${p.argKey}="${p.norm}"`).join("、")}）` +
        `——拒绝在多个基地里挑一个冒充答案（R-ARG-FIDELITY）`,
      400,
    );
  return { argKey: present[0]!.argKey, raw: present[0]!.raw };
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

/**
 * WO-DATAMODE-UNIFY-PROVENANCE（provenance 维·两正交维模型）：某基地一张卡/一行的**底层决策对象**是否合成种子物化。
 * 底料 = 该 Base 对象本身 + 喂 liveTightness measurement 的设备/产线/工序（OEE/利用率/良率来源）。
 * 任一合成物化 → true。谓词缺省（无合成源 / 测试直构 ctx）→ false，现行行为不变（向后兼容 R6·确定性无随机/时钟）。
 *
 * ⚠ 这是 **provenance 维**（合成种子），与 **measurement 维**（liveTightness.live·读到真 OEE/util/良率即 LIVE）正交：
 * 本函数**不改** live/dataMode，只加性透出"底料是否合成"，供前端把合成数据走诚实灰、绝不冒充实测（铁律 0.4）。
 */
export function baseProvenanceSynthetic(c: SolverContext, baseId: string): boolean {
  const p = c.isSynthProvenance;
  if (!p) return false;
  const base = c.bases.find((b) => str(b.props.baseId) === baseId);
  const objs: ObjectInstance[] = [
    ...(base ? [base] : []),
    ...c.equipment.filter((e) => str(e.props.baseId) === baseId),
    ...c.lines.filter((l) => str(l.props.baseId) === baseId),
    ...c.processes.filter((pr) => str(pr.props.baseId) === baseId),
  ];
  return objs.some((o) => p(o));
}
