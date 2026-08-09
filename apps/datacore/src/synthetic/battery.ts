import type { IndustryTemplate, BusinessType } from "@platform/contracts";
import { BASE_REGISTRY, SEG_REGISTRY, PLAN_GOAL_TARGETS, GOAL_REGISTRY, WAVE1_SCALE_FACTOR, packEnergyKwh, operatingDaysPerYear, scaleAnchorRevenue, WORKSHOP_REGISTRY, EQUIPMENT_TYPE_BY_PROCESS } from "@platform/contracts";
// DF.13 外协红线单一来源（C08）：规则表达式 / what-if 上限 / 合成越线样本三处**全部派生**，禁内联裸阈值（R14·R-一致）。
import { OUTSOURCE_REDLINE, OUTSOURCE_SAMPLE, outsourceRedlinePct, outsourceRedlineViolationExpr } from "@platform/contracts";
// WO-RULE-EXPR-PARAMS：规则 DSL 的命名阈值引用（`params.<名>`）——阈值只存 rule.params 一处，禁在 expression 里复写。
import { ruleParamRef } from "@platform/contracts";
import type { ExcSeverity, ExcStatus } from "@platform/contracts";
import type { DerivedPropertyDef, LinkTypeDef, ObjectTypeDef, PropertyDef } from "../domain.js";
import { hashString, mulberry32, pick, randInt, round } from "../prng.js";
import { ALL_FEATURE_KEYS } from "../features.js";
import { SEEDED_VIEW_KEYS } from "./view-manifest.js";

/** Built-in battery-manufacturing template (QOS-PRD §7.6 + addendum §S1/§A8 semantics). */

// 去电池锁死（R14）：基地经纬度作为对象数据随合成下发（前端 GeoMap 读 Base.props.lon/lat，不再写死）。
// DF.1 单一来源：基地集从 @platform/contracts BASE_REGISTRY 派生（跨包唯一真相源，灭漂移 G-5/R14）。
// 命名以 HTML BASE_DATA 为准；datacore 用 {baseId,name,kind,lon,lat} 子集（值字节复现，R6）。
export const BASES: {
  baseId: string;
  name: string;
  kind: "动力" | "储能" | "动力+储能";
  lon: number;
  lat: number;
  util: number;
  gwh: number;
  bottleneck: string;
  lines: number;
}[] = BASE_REGISTRY.map((b) => ({
  baseId: b.baseId,
  name: b.name,
  kind: b.kind,
  lon: b.lon,
  lat: b.lat,
  util: b.util,
  gwh: b.gwh,
  bottleneck: b.bottleneck,
  lines: b.lines,
}));

/**
 * DF.1 单一来源：**单条基地引用**也查册派生（不只 BASES 集合）——WO-76 修。
 * 剧本/参数里写死 `baseId: "changzhou"` 与内联整个基地集是同一类漂移（G-5/R14），
 * 只是粒度为"单条"：册里改 baseId 或删该基地，引用会静默指向不存在的基地。
 * name 是册自述的"跨端共同 key"；查不到即抛，不留悬空引用。R6：值与迁移前字节一致。
 */
export function baseIdOf(name: string): string {
  const hit = BASE_REGISTRY.find((b) => b.name === name);
  if (!hit) throw new Error(`[battery] 基地「${name}」不在 BASE_REGISTRY 单一来源册（DF.1/R14）`);
  return hit.baseId;
}

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
export const MODEL_BASE_MAP: Record<string, string[]> = {
  "4680-NCM": ["changzhou", "chengdu", "hefei", "jinhua"], // HTML 4680-NCM → 常州/成都/合肥/金华
  "4680-LFP": ["changzhou", "zaozhuang"], // HTML 4680-LFP → 常州/枣庄（动力+储能）
  "2170-NCM": ["xiamen", "wuhan", "zigong"], // HTML 2170-NCM → 厦门/武汉/自贡
  "方形-LFP": ["jiangmen", "meishan", "handan", "zaozhuang"], // HTML 方形-LFP → 江门/眉山/邯郸/枣庄
  "方形-NCM": ["changzhou", "chengdu", "jinhua"], // HTML 方形-NCM → 常州/成都/金华
  "圆柱-LFP": ["xinyang", "yangzhou"], // HTML 圆柱-LFP → 信阳/扬州
};

// WO-GSIM-1-DATA · 基地间地理距离（haversine）——灭 G-TRANSIT-NOT-GEO（在途天数此前是哈希常量·与地理无关）。
// 经纬度取自 BASE_REGISTRY 单一来源（R14·不内联坐标）；任意 (fromBase,toBase) 对可查（非仅 MODEL_BASE_MAP 相邻对）。
// 纯确定性（无 rng/时钟·R6）；同基地→距离 0（→ 运费 0）。
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // 地球平均半径(km)
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 基地间公路直线距离(km)·haversine 于 BASE_REGISTRY 经纬度（单一来源·R14）。任意基地对可查·同基地=0。 */
export function baseDistanceKm(fromBase: string, toBase: string): number {
  const a = BASE_REGISTRY.find((b) => b.baseId === fromBase);
  const b = BASE_REGISTRY.find((x) => x.baseId === toBase);
  if (!a || !b) throw new Error(`base not in registry: ${fromBase}/${toBase}`);
  return haversineKm(a.lat, a.lon, b.lat, b.lon);
}

// WO-GSIM-1-DATA · 供芯图（G-CELL-PACK-2STAGE 数据半·纯派生函数·非新对象类型→不撞 golden 类型计数）。
// 电芯→电池包两段制：每个纯 PACK 基地（factory_type==="PACK"）由哪些可产芯基地（CELL/CELL+PACK）就近供芯。
// factory_type 从生成态 bases 行读（非重派生·守 §2 单一来源）；就近排序按 baseDistanceKm（同距以 baseId 稳定次序断平·R6）。
export function cellSourceMap(bases: { baseId: string; factory_type?: string }[]): Record<string, string[]> {
  const cellBases = bases.filter((b) => b.factory_type === "CELL" || b.factory_type === "CELL+PACK");
  const packBases = bases.filter((b) => b.factory_type === "PACK");
  const map: Record<string, string[]> = {};
  for (const p of packBases) {
    map[p.baseId] = cellBases
      .map((c) => ({ id: c.baseId, d: baseDistanceKm(p.baseId, c.baseId) }))
      .sort((x, y) => x.d - y.d || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
      .map((x) => x.id);
  }
  return map;
}

/**
 * WO-OPT-WHATIF-DATA · 基地**选址成本**派生（补 §8 `G-WHATIF-NL-UNREACHABLE` 的**数据半**——
 * 该断点此前标「✅ 已闭」，实况是只闭了**路由半**：路由通了、求解器在，但 demo 本体没有成本字段 ⇒ 100% 降级）。
 *
 * 病根（「接了线没数据」形态②）：`optimize_whatif` 的 `facility_location` 自动装配
 * （`solvers/service.ts assembleBaselineFromSelection`）要求决策承载类型上存在**命中成本词库
 * （`solvers/field-role-lexicon.ts ROLE_LEXICON.cost`）的数值字段**才能绑 `open_cost`/`assign_cost` 角色；
 * 而 demo 的 `Base` 数值属性只有 util/gwh/formationCapDaily/agingCapDaily/lon/lat —— 一个成本字段都没有
 * ⇒ 装配恒报缺 `open_cost` ⇒ 会话路由虽真命中、真 invoke，仍 100% 降级 path-B，用户拿不到优化结论。
 *
 * **R6 命门（本单最大的坑）**：两个成本值**全部由已有量派生、零 rng 消耗**——照 WO-CEO-DATA-2
 * （`Equipment.oee_current` 由 A×P×Q 派生）同一路子。不抽新随机数 ⇒ `rngTopo`/`rng` 消耗序列一字不动
 * ⇒ 下游全部合成值零位移、同 (industry,scale,seed) 仍字节一致。
 *
 *  - `openCost`（万元/年·年固定开办成本）= 铭牌产能 × 单位产能固定成本 + 产线数 × 单线固定成本。
 *    两个入参 gwh/lines 都取自 BASE_REGISTRY 单一来源（DF.1·R14·不内联基地字面量）。
 *  - `serveCost`（万元/需求点·年·单位需求点干线履约成本）= **产能加权全网平均干线距离** × 每公里费率。
 *    距离走既有 `baseDistanceKm`（haversine on BASE_REGISTRY·单一来源）——西部基地（成都/眉山/自贡）
 *    网络可达性差 ⇒ 履约成本高，东部基地低，是真地理信号而非随机噪声。
 */
export function baseOpenCostWan(gwh: number, lines: number): number {
  const c = BATTERY_SOLVER_PARAMS.facilityCost as { gwhFixedWan: number; lineFixedWan: number; servePerKmWan: number };
  return round(gwh * c.gwhFixedWan + lines * c.lineFixedWan, 2);
}

/** 产能加权全网平均干线距离(km)·haversine 于 BASE_REGISTRY（纯派生·无 rng·同基地距 0 计入权重）。 */
export function baseNetworkMeanDistanceKm(baseId: string): number {
  const totalGwh = BASE_REGISTRY.reduce((s, b) => s + b.gwh, 0);
  const weighted = BASE_REGISTRY.reduce((s, b) => s + b.gwh * baseDistanceKm(baseId, b.baseId), 0);
  return totalGwh > 0 ? weighted / totalGwh : 0;
}

export function baseServeCostWan(baseId: string): number {
  const c = BATTERY_SOLVER_PARAMS.facilityCost as { gwhFixedWan: number; lineFixedWan: number; servePerKmWan: number };
  return round(baseNetworkMeanDistanceKm(baseId) * c.servePerKmWan, 2);
}

// PRD-IND-order-aggregate：HTML 8 客户（应用细分按客户名判定：含「商用车」→商用车 · 含「储能/电网」→储能 · 否则乘用车）。
const CUSTOMERS = [
  // 乘用车
  "广汽集团", "长安汽车", "吉利汽车", "东风汽车", "小鹏汽车",
  // 商用车
  "宇通客车", "金龙客车", "奇瑞", "瑞驰新能源", "Ashok Leyland",
  // 储能
  "国家电网", "国家电投", "南方电网", "龙源电力",
];

// WO-W5·业务类型（乘/商/储）单一来源客户册：客户名 → 业务类型（passenger|commercial|storage）。
// 显式映射（不靠 regex·防「国家电投」不含「电网」被误判乘用车 / 奇瑞·瑞驰不含「客车」被误判乘用车的旧坑）。
export const CUSTOMER_BUSINESS_TYPE: Record<string, BusinessType> = {
  广汽集团: "passenger", 长安汽车: "passenger", 吉利汽车: "passenger", 东风汽车: "passenger", 小鹏汽车: "passenger",
  宇通客车: "commercial", 金龙客车: "commercial", 奇瑞: "commercial", 瑞驰新能源: "commercial", "Ashok Leyland": "commercial",
  国家电网: "storage", 国家电投: "storage", 南方电网: "storage", 龙源电力: "storage",
};
/** 客户 → 业务类型（册命中优先·未知客户按名兜底 regex·仍无 → 乘用车 default）。 */
export function businessTypeOfCustomer(cust: string): BusinessType {
  const hit = CUSTOMER_BUSINESS_TYPE[cust];
  if (hit) return hit;
  if (/储能|电网|电投|电力/.test(cust)) return "storage";
  if (/客车|商用/.test(cust)) return "commercial";
  return "passenger";
}
/** 细分名（乘用车/储能/商用车）→ 业务类型枚举（DemandSegment.segment 口径）。 */
export function businessTypeOfSegment(segment: string): BusinessType {
  if (/储能/.test(segment)) return "storage";
  if (/商用/.test(segment)) return "commercial";
  return "passenger";
}
/**
 * WO-W5·业务类型订单量整形（确定性 R6·体量极小仅商用车）：商用车订单波动大 → 按 volatilityFactors 取模缩放
 * （hashString(so)%len·同 seed 字节一致），乘用/储能不动（量口径不变·金值安全）。返回 ≥1 的整数套。
 */
export function shapeBusinessTypeQty(businessType: BusinessType, qty: number, so: string): number {
  const reg = (BATTERY_SOLVER_PARAMS.businessTypeRegime as Record<string, { volatilityFactors?: number[] }>)[businessType];
  const factors = reg?.volatilityFactors;
  if (!factors || factors.length === 0) return qty;
  const f = factors[hashString(so) % factors.length]!;
  return Math.max(1, Math.round(qty * f));
}
const BOTTLENECKS = ["电芯", "模组", "PACK", "化成"];

// PRD-IND-order-aggregate §4：HTML 24 单语义基底（so/cust/model/qty/due/pri）。
// 按年营收 700 亿元企业规模校准：qty 单位=套，均价≈1.8 万元/套，月营收≈58 亿元 →
// 月需≈32,000 套；200 单/月则单均≈1,600 套。原原型数字（6~18）按「万套」理解偏大、按「套」理解偏小，
// 统一调整为 500~2,700 套区间，与 extra orders 同分布（randInt 500~2,700），保持相对大小关系不变。
export const HTML_ORDERS: { so: string; cust: string; model: string; qty: number; due: string; pri: string }[] = [
  { so: "SO-3391", cust: "广汽集团", model: "4680-NCM", qty: 7259, due: "2026-06-24", pri: "高" },
  { so: "SO-3402", cust: "长安汽车", model: "4680-NCM", qty: 14518, due: "2026-07-02", pri: "高" },
  { so: "SO-3415", cust: "吉利汽车", model: "4680-NCM", qty: 4033, due: "2026-07-18", pri: "中" },
  { so: "SO-3420", cust: "东风汽车", model: "4680-NCM", qty: 10485, due: "2026-07-09", pri: "高" },
  { so: "SO-3431", cust: "广汽集团", model: "2170-NCM", qty: 8872, due: "2026-06-28", pri: "中" },
  { so: "SO-3437", cust: "宇通客车", model: "2170-NCM", qty: 5646, due: "2026-07-14", pri: "中" },
  { so: "SO-3445", cust: "长安汽车", model: "方形-NCM", qty: 12098, due: "2026-07-05", pri: "高" },
  { so: "SO-3452", cust: "国家电网", model: "方形-LFP", qty: 17744, due: "2026-06-30", pri: "高" },
  { so: "SO-3458", cust: "南方电网", model: "方形-LFP", qty: 21777, due: "2026-07-12", pri: "高" },
  { so: "SO-3464", cust: "国家电投", model: "方形-LFP", qty: 8872, due: "2026-07-25", pri: "中" },
  { so: "SO-3470", cust: "南方电网", model: "圆柱-LFP", qty: 4033, due: "2026-07-08", pri: "中" },
  { so: "SO-3476", cust: "国家电网", model: "4680-LFP", qty: 7259, due: "2026-07-20", pri: "中" },
  { so: "SO-3481", cust: "广汽集团", model: "4680-NCM", qty: 10485, due: "2026-07-11", pri: "高" },
  { so: "SO-3486", cust: "吉利汽车", model: "方形-NCM", qty: 5646, due: "2026-07-22", pri: "中" },
  { so: "SO-3490", cust: "东风汽车", model: "4680-NCM", qty: 16131, due: "2026-07-06", pri: "高" },
  { so: "SO-3495", cust: "南方电网", model: "方形-LFP", qty: 19357, due: "2026-07-16", pri: "高" },
  { so: "SO-3501", cust: "国家电投", model: "方形-LFP", qty: 12098, due: "2026-07-28", pri: "中" },
  { so: "SO-3506", cust: "宇通客车", model: "2170-NCM", qty: 7259, due: "2026-07-19", pri: "中" },
  { so: "SO-3512", cust: "长安汽车", model: "方形-NCM", qty: 8872, due: "2026-07-03", pri: "高" },
  { so: "SO-3518", cust: "国家电网", model: "方形-LFP", qty: 16131, due: "2026-07-24", pri: "中" },
  { so: "SO-3523", cust: "广汽集团", model: "4680-NCM", qty: 12098, due: "2026-07-13", pri: "高" },
  { so: "SO-3529", cust: "南方电网", model: "圆柱-LFP", qty: 5646, due: "2026-07-10", pri: "中" },
  { so: "SO-3534", cust: "东风汽车", model: "4680-NCM", qty: 14518, due: "2026-07-27", pri: "高" },
  { so: "SO-3540", cust: "宇通客车", model: "2170-NCM", qty: 4033, due: "2026-07-17", pri: "低" },
];

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

// WO-SCALE-COHERENCE（R18 realized 层·断裂点E'）：realized 产出序列 output:line 的锚均值 + 排产达成率。
// output:line 生成器锚均值（tsGenerators 内 base.mean 单一来源）；per-base 尺度据此派生。
export const OUTPUT_LINE_BASE_MEAN = 30000;
// 实现产出 = 基地夹定产能(formationCapDaily=computeRollup dailyCells) × 排产达成率（= attainment:line/base 基准 0.914，
// 供给紧俏锂电按此达成率兑现）。留 ~8.6% 达成缺口 = 校准良率信号所踏的真实缺口（非尺度断裂）。
export const REALIZED_ATTAINMENT = 0.55;
/**
 * output:line per-base 尺度因子：令 realized(mean-over-lines) = 基地夹定产能 × 排产达成率，与 computeRollup 同锚。
 * 断裂点E'（dev 原单遗漏的第六层）：capacity(computeRollup) 已按 gwh 派生到 365万套/年锚，但 realized(output:line)
 * 仍锁死玩具均值 30000（≈148万套/年·40% 达成）→ 校准 predicted/actual 脱尺度 1.3~4.6× → MAPE 恒 134% 淹没良率信号。
 */
export function outputLineScaleForBase(baseFormationCapDaily: number): number {
  if (!(baseFormationCapDaily > 0)) return REALIZED_ATTAINMENT; // 兜底 ≈ 原 30000 尺度
  return (baseFormationCapDaily * REALIZED_ATTAINMENT) / OUTPUT_LINE_BASE_MEAN;
}

// 名义工序良率（电池包基线 Process.yield 均值口径·数据侧单一来源）：computeRollup 与 VLE 独立产能链(vle-oracle)
// 均以「基地代表良率/名义」缩放共享化成/老化封顶——令 gwh 夹点保留良率敏感度（M11 校准杠杆），基线(良率≈名义)
// 缩放≈1 不动锚。放数据侧(battery)供引擎与 oracle 同口径共享输入常数，不违 oracle 逻辑独立性。
export const NOMINAL_PROCESS_YIELD = 0.973;

// ---------------------------------------------------------------------------
// 规则库（A5 · 场景包种子）—— **业务阈值的单一上游真源**
// ---------------------------------------------------------------------------
// G-10 P4：本数组必须定义在 `BATTERY_SOLVER_PARAMS` **之前**，因为凡与规则同义的推演系数/阈值
// （C04 认证系数 · C09 数据健康降级 · C18 现金底线 · C21 产销偏差）一律由 `ruleParamOf()` 从这里派生，
// 不再在 solver_params 里各写一份同值字面量（此前那份"诱饵"才是求解器真读的，改规则不改推演）。
// 运行期同源：`RULE_PARAM_BINDINGS` + `RulesService` 发布投影（改规则 → solver_params 随之变）。
export const BATTERY_RULES: NonNullable<IndustryTemplate["rules"]> = [
  { key: "C03", name: "产能上限约束", expression: "Order.demandDelta > 0.5", severity: "BLOCK", category: "产能" },
    // DF.13 C08 外协红线：**表达式与命名阈值同源生成**，禁内联。此前 expression 写死一个比现行更宽的常数，
    // 而三个求解器、界面文案、livedin 发布态都按现行红线走 —— 规则库与推演各说各话，且四包测试全绿。
    // WO-RULE-EXPR-PARAMS（闭掉 G-C08-EXPR-PARAM-SPLIT）：expression 现在**引用** `params.outsourceRatioMax`
    // 而不再把同一个数再渲染一遍字面量 —— 阈值在这条规则上只剩 params 一处，改它即同时改判定与推演
    // （`RULE_PARAM_BINDINGS` 已补上 C08 → `whatIf.outsourceMax` 那一行，此前该 param 全仓零消费方 = 诱饵）。
    // ⚠ key/name/severity/category 刻意保持**字面量**：规则码是标识符、不是会漂的业务数，
    //   且 `rule-closure:check` 靠正则 `key: "Cxx", name:` 扫本表建"已定义规则集"——把 key 也派生会让它瞎掉
    //   （亲测：改成 OUTSOURCE_REDLINE.ruleKey 后该门立刻报「C08 被引用但未定义」）。**只有阈值该单源**。
    { key: "C08", name: "外协比例红线", expression: outsourceRedlineViolationExpr(OUTSOURCE_REDLINE.subject, { param: OUTSOURCE_REDLINE.paramKey }), severity: "WARN", params: { [OUTSOURCE_REDLINE.paramKey]: OUTSOURCE_REDLINE.maxRatio }, category: "外协" },
  { key: "C13", name: "客户信用额度", expression: "Order.creditUsedRatio > 1", severity: "BLOCK", category: "财务" },
  // A8.5 timeseries rules — evaluated against ts_agg_runs by RULE_SCAN (SUSTAIN).
  { key: "C05", name: "产线利用率持续越线", expression: "SUSTAIN(Line.utilization > 95, 3)", severity: "WARN", category: "产能" },
  { key: "C12", name: "预测偏差触发重校", expression: "SUSTAIN(Model.forecast_deviation > 0.08, 1)", severity: "WARN", category: "需求" },
  // §7.14 年度情景规则校验（情景卡的 C18/C23 行走真实规则引擎）。
  // C18 params.cashFloor：现金垫底线 —— 出厂值从**目标登记册** `PLAN_GOAL_TARGETS.cashFloor` 派生
  // （不再写第三份同值 50：此前 sop.cashFloor / planGenerate.targets.cashFloor / C18 expression 各一份）。
  // 出厂后它是**可编辑的当期口径**：发布新版 C18 即投影进 solver_params 的两处现金底线（见 RULE_PARAM_BINDINGS）。
  // WO-RULE-EXPR-PARAMS：expression 引用 `params.cashFloor`，不再复写一遍 50 —— 此前改 params 只改了
  // 求解器算数（sop.cashFloor / planGenerate.targets.cashFloor），C18 自己的判定仍按 expression 里的 50 走。
  { key: "C18", name: "现金垫底线", expression: `AnnualScenario.cashCushion < ${ruleParamRef("cashFloor")}`, severity: "BLOCK", params: { cashFloor: PLAN_GOAL_TARGETS.cashFloor }, category: "财务" },
  { key: "C23", name: "CAPEX 情景测算门槛", expression: "AnnualScenario.capex >= 10", severity: "WARN", category: "财务" },
  // catalog-battery §3 C26–C33（DSL 表达式 = 违规谓词,expression 真→passed=false；复杂算术取
  // 去归一化/派生字段：yieldFloor=基线-0.02 / minYieldRate=自产-0.02 / daysToStart=开工日-today
  // / deviationPct=ABS(实际-计划)/计划。此前硬编码在求解器,规则引擎不可见;现注册为一等规则。
  { key: "C26", name: "认证资源上限", expression: "Cert.parallelTasks > Cert.engineerGroups", severity: "BLOCK", category: "认证" },
  { key: "C27", name: "长协执行偏差", expression: "Lta.deviationPct > 0.05", severity: "WARN", category: "物料" },
  { key: "C28", name: "呆滞预警", expression: "Batch.idleDays > 90", severity: "WARN", category: "物料" },
  { key: "C29", name: "排产冻结期", expression: "Order.daysToStart < 3", severity: "BLOCK", category: "排产" },
  { key: "C30", name: "良率连降停线评审", expression: "SUSTAIN(Process.dailyYield < Process.yieldFloor, 3)", severity: "BLOCK", category: "质量" },
  { key: "C31", name: "外协质量门", expression: "Outsource.yieldRate < Outsource.minYieldRate", severity: "BLOCK", category: "外协" },
  { key: "C32", name: "逾期冻结", expression: "Customer.maxOverdueDays > 30", severity: "BLOCK", category: "财务" },
  // C33 碳护照前置：约束 = 目的地EU IMPLIES 碳足迹<=阈值；违规 = NOT(约束)（用 IMPLIES，C33 的招牌用例）。
  { key: "C33", name: "碳护照前置", expression: "NOT (Order.destination == 'EU' IMPLIES Order.carbonFootprint <= Order.euCarbonThreshold)", severity: "BLOCK", category: "合规" },
  // 规则即引用（PRD-rules-as-references 附录A）：补全 13 条「被引用但未定义」规则为一等规则——
  // 消灭前端"（当前库中未找到定义）"、规则闸不再空过。expression 用既有 DSL（无算术/无 param 插值），
  // 命名阈值落 params（求解器 P2 改读 rule.params 去硬编码；改 param 即改推演）。C15/C24 毛利底线
  // 不复制 SEG_REGISTRY（单一来源），floorPct 由分段对象字段在求值期解析（params 留空）。
  // **P4 纪律（不许并存）**：params 只保留「被真消费」的命名阈值——
  //   ① 被 `RULE_PARAM_BINDINGS` 投影进 solver_params 的（C04/C09/C18/C21）；
  //   ② 其余阈值若已写在 expression 里并由规则引擎真求值，就**不再复制一份进 params**
  //      （C11 minBufferDays / C22 maxChangeoverMin / C25 assumeTolerancePct 曾各存一份同值副本、
  //       全代码库无人读 = 诱饵，已删；阈值单源 = expression）。
  { key: "C01", name: "产线设计产能上限", expression: "Line.weeklyCapacityWan > Line.designCeilingWan", severity: "BLOCK", params: {}, category: "产能" },
  { key: "C02", name: "化成/老化串并产能口径", expression: "Process.parallelThroughput < Process.requiredThroughput", severity: "WARN", params: {}, category: "产能" },
  // C04 **刻意不引用 params**（别"顺手统一"）：它的 expression 是**分类谓词**（认证状态≠量产），
  // 里面没有可参数化的数值阈值；而它的两个 params 是**产能折算系数**（算数维，经 RULE_PARAM_BINDINGS
  // 投影进 `certFactors.*` 供求解器乘）。二者不是同一个数的两份拷贝，故无分叉可言 —— 这条规则
  // 本来就没有 G-C08-EXPR-PARAM-SPLIT 那个病。硬塞一个 `params.x` 进去只会造出一个新的假阈值。
  { key: "C04", name: "仅认证产线计入产能", expression: "Line.certStatus != '量产'", severity: "WARN", params: { productionFactor: 1, pendingCertFactor: 0.6 }, category: "认证" },
  { key: "C06", name: "物料齐套缺口口径(MRP)", expression: "MaterialBalance.gapTon > 0", severity: "WARN", params: {}, category: "物料" },
  // C09 params：staleHours（何时降级）+ degradedFactor（降到多少）= 规则拥有的两个真阈值，投影进
  // solver_params `health.*`。**normalFactor 已删**：未降级时的 P90 基线系数 `health.normal` 归 M11 校准
  // 参数 `p90_health`（QUANTILE 方法按覆盖率反解）所有——规则再声明一份同值就是第二个写者 + 诱饵。
  // WO-RULE-EXPR-PARAMS：`> params.staleHours` 取代写死的 `> 2` —— 阈值只存 params 一处。
  { key: "C09", name: "数据时延临时降级", expression: `DataSourceHealth.critical == TRUE AND DataSourceHealth.lagHours > ${ruleParamRef("staleHours")}`, severity: "WARN", params: { staleHours: 2, degradedFactor: 0.9 }, category: "质量" },
  { key: "C10", name: "场景必填+行动审批留痕", expression: "Action.approver == NULL OR Action.audited == FALSE", severity: "BLOCK", params: {}, category: "合规" },
  { key: "C11", name: "检修窗口与交付高峰错峰", expression: "MaintPlan.bufferDays < 3", severity: "WARN", params: {}, category: "排产" },
  { key: "C15", name: "经营毛利底线", expression: "Order.marginPct < Order.floorPct", severity: "BLOCK", params: {}, category: "财务" },
  { key: "C16", name: "齐套缺口预警", expression: "MaterialBalance.gapTon > 0", severity: "WARN", params: {}, category: "物料" },
  // WO-RULE-EXPR-PARAMS：`> params.balanceDeviationPct` 取代写死的 `> 0.10`（曾是同值第二份）。
  { key: "C21", name: "产销平衡偏差", expression: `SopVersionRow.balanceDeviationPct > ${ruleParamRef("balanceDeviationPct")}`, severity: "WARN", params: { balanceDeviationPct: 0.1 }, category: "规划" },
  { key: "C22", name: "换型损失/排产约束", expression: "Order.changeoverMin > 120", severity: "WARN", params: {}, category: "换型" },
  { key: "C24", name: "接单毛利过线", expression: "Quote.marginPct < Quote.floorPct", severity: "BLOCK", params: {}, category: "财务" },
  { key: "C25", name: "外部终端需求假设偏离", expression: "ExternalSignal.deviationPct > 0.05", severity: "WARN", params: {}, category: "需求" },
];

/**
 * G-10 P4 · **场景包侧单源取值口径**：solver_params 种子里凡与某条规则同义的阈值，一律经此函数从
 * `BATTERY_RULES` 取——**禁止再写一份同值字面量**（那份就是"改规则不改推演"的诱饵）。
 * 取不到即**抛错**（种子构建期炸，不静默回落一个看似正常的数）——规则被删/改名要立刻暴露，别让
 * 推演悄悄换了口径（诚实 > 好看；拒绝 > 静默错数）。
 */
export function ruleParamOf(ruleKey: string, param: string): number {
  const v = BATTERY_RULES.find((r) => r.key === ruleKey)?.params?.[param];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`场景包规则 ${ruleKey}.params.${param} 缺失或非数值 —— solver_params 无法从规则派生（G-10 单源）`);
  }
  return v;
}

export const BATTERY_SOLVER_PARAMS: Record<string, unknown> = {
  forecastStart: "2026-06-10",
  packCellCount: 96,
  // WO-SCALE-COHERENCE（R14/R18）：gwh↔套 桥常数 + 尺度锚，值来自 @platform/contracts 单一来源（禁内联）。
  packEnergyKwh, // 能量/套(kWh)：Base.gwh×1e6/packEnergyKwh = 名牌套
  operatingDaysPerYear, // 年运营日：capacityDaily/max_capacity_day 年化口径
  scaleAnchorRevenue, // 各 scale 档目标年营收锚（亿）
  // 产能微观参数按 gwhᵢ 派生的确定性系数（令 capacity_rollup 的 min 绑定 gwh 夹点·不改求解器）。
  scaleCoherence: {
    lineHeadroom: 1.2, // 线级夹点相对基地(gwh)夹点的余量 → 令 min() 绑基地夹点(化成/老化)而非玩具线级
    channelOutputBase: 85, // 单化成通道日产(套) 基值
    channelOutputSpan: 11, // 单化成通道日产抖动幅（确定性 hash·85–95）
    agingHeadroom: 1.02, // 老化库位相对线级夹点余量
    serialCellsPerCtSec: 79600, // 保守估：串行工序在最坏 avail/oee/yield/att/util 下 日产(电芯)/(1/ct) 系数 → 据此反解 ctSeconds 令 serial≥夹点
    ctSecMin: 0.4, // 节拍下限（防大基地 ct 过小失真）
    ctSecMax: 1.9, // 节拍上限（小基地保留原区间量级）
    modelPriceVarPpk: 30, // 型号单价 ±30‰ 确定性微差（围绕 SEG.priceWan）
  },
  // G-10 P4 单源：认证系数 = C04 的命名阈值（此前这里另存一份同值 { 量产:1.0, 认证中:0.6 }，
  // 求解器只读这份、C04.params 没人读 → 改规则不改推演）。
  certFactors: { 量产: ruleParamOf("C04", "productionFactor"), 认证中: ruleParamOf("C04", "pendingCertFactor") },
  ramp: { base: 0.88, step: 0.03, fullWeek: 5 },
  maintMult: 0.72,
  health: { normal: 0.93, degraded: 0.9, staleHours: 2 },
  // DF.13：outsourceMax 是 C08 红线在求解器侧的同一个数 → 从 OUTSOURCE_REDLINE 派生（禁内联裸阈值）。
  whatIf: { nightShiftCoef: 0.06, channelCoef: 0.05, outsourceMax: OUTSOURCE_REDLINE.maxRatio },  logistics: { byAddress: { 上海: 3, 广州: 5, 北京: 4, 成都: 6, 海外: 14 }, defaultDays: 7 },
  // WO-GSIM-1-DATA · 跨基地调拨物流费率常数（R14：业务常数入册·禁生成环内联魔数）。
  // transitDays = ceil(baseDistanceKm / dailyTruckKm)（下限 minTransitDays·同区非 0）；
  // freightCost = baseDistanceKm × tonKmRate × (qty × qtyToTon)（确定性·同基地=0 距=0 费=0）。
  interbase: { dailyTruckKm: 600, minTransitDays: 1, tonKmRate: 0.55, qtyToTon: 0.4 },
  // WO-OPT-WHATIF-DATA · 设施选址成本费率册（R14：业务常数入册·禁生成环内联魔数）。
  // Base.openCost = gwh × gwhFixedWan + lines × lineFixedWan（规模派生·万元/年）；
  // Base.serveCost = 产能加权全网平均干线距离km × servePerKmWan（地理派生·万元/需求点·年）。
  // 三个费率**只在此一处**；两个派生量都不消耗 rng（R6 字节一致，见 baseOpenCostWan/baseServeCostWan）。
  facilityCost: { gwhFixedWan: 120, lineFixedWan: 260, servePerKmWan: 0.05 },
  // WO-W5 · 业务类型（乘/商/储）经营场景 regime（R14·入册·禁求解器内联魔数）。三类差异化经营场景的确定性种子参数：
  //   dedicationWeight：该业务线在共享工厂中的**专线产能配比**——求解器据此按类可产基地年产能 × 权重算类占用率
  //     （util = 类年需求 / 类年产能×权重）。默认令三类占用率落到产品负责人 spec 的三档：乘用车产能不足(>1)、
  //     储能~95%稳、商用车空闲(<0.6)。改需求集(勾选) → util 真变（capacity 与需求解耦·非前端假过滤）。
  //   earlyDeliveryLeadDays：乘用车部分客户需**提前交付**的提前天数（订单加 early 标 + earlyDue 提前交期·additive）。
  //   earlyDeliveryMod：乘用车订单命中提前交付的确定性取模（hashString(so)%mod===0·同 seed 字节一致 R6）。
  businessTypeRegime: {
    passenger: { dedicationWeight: 0.86, earlyDeliveryLeadDays: 14, earlyDeliveryMod: 3 }, // → 占用率≈1.20（产能不足·>1）
    // 商用车 volatilityFactors：订单量确定性高波动整形（hashString(so)%len 取因子·体量极小仅商用·R6 字节一致）→ 订单波动大。
    commercial: { dedicationWeight: 1.0, volatilityFactors: [0.32, 2.3, 0.55, 1.9] }, // → 占用率≈0.40（产能空闲·<0.6）+ 订单波动
    storage: { dedicationWeight: 0.84 }, // → 占用率≈0.95（稳·订单平稳经 util 稳定体现）
  } as Record<string, { dedicationWeight: number; earlyDeliveryLeadDays?: number; earlyDeliveryMod?: number; volatilityFactors?: number[] }>,
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
      金华: "设备OEE",
      扬州: "良率波动",
    },
    defaultPrimary: "瓶颈工序",
    mock: { mod: 9, factorMult: 7, primaryBase: 88, primaryCap: 97, secondaryBase: 55, secondaryCap: 83, utilHigh: 0.82, utilHighAdd: 6, utilLowAdd: 2 },
    // WO-SANDBOX-D3 · hardCapShortfallK：硬容量缺口比 → 张力 的换算系数。
    // 100 表示「上游要求里有 x% 推不进硬容量单元 ⇒ 张力 x」。**未夹定（capacity ≥ required）时张力恒 0**
    // —— 硬约束不是连续张力，没夹住就不该虚报紧张（这也令基线逐字节不回归）。
    live: { oeeK: 220, oeeBase: 30, utilK: 0.9, utilBase: 8, yieldK: 600, yieldBase: 35, hardCapShortfallK: 100 },
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
      // PRD-IND-dash ORDER_OVR（L3222-3229）：6 单 override 逐字种子。按 so 命中即覆盖信用/毛利 + why。
      // 命中 HTML 24 单（SO-3470/3458/3518 压价 mAdj · SO-3437/3506/3540 信用 credit）→ 台账出现"未接/提价接"。
      overrides: {
        "SO-3470": { mAdj: -3.2, why: "南方电网 框架价压价" },
        "SO-3437": { credit: true, why: "宇通客车 在手应收 9.8 亿 + 新单 12.6 亿 > 信用额度 21 亿" },
        "SO-3506": { credit: true, why: "宇通客车 二次追单，信用敞口进一步放大" },
        "SO-3458": { mAdj: -3.0, why: "南方电网 框架协议低价条款执行" },
        "SO-3518": { mAdj: -2.6, why: "国家电网 价格战跟价" },
        "SO-3540": { credit: true, why: "宇通客车 低优先级单，信用额度已被占满" },
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
      // redline-allow：turns 是**库存周转**增量（次），与外协红线无关；此行含「外协型」只是方案名。
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
        { n: "外协比例触红线", kind: "outsource", rule: "C08", why: `缺口全靠外协时比例逼近 ${outsourceRedlinePct()}% 红线，超出部分无法承接；该红线是质量与供应安全的硬约束、不可放宽。外协必须与结构性手段（守价/扩产）组合使用，单押外协等于把承接能力封顶。`, chain: [["缺口全量外协", "外协订单占比 ↗", "#E8B54A"], [`比例逼近 ${outsourceRedlinePct()}%`, "外协比例监测", "#54B5C4"], ["超出部分无法承接", "承接能力封顶", "#5E8FE8"], ["C08 红线 · 触线即拒单", "规则 C08", "#DD7E9E"]] },
        { n: "外协质量波动反噬", kind: "outsource", rule: null, why: "外协良率低于自产 1–2pct，不良流入会推高质量域不良率、引发客诉与退货；质量成本与商誉损失会吞掉外协省下的 CAPEX。首件鉴定 + 巡检抽检必须与放量同步，不能事后补。", chain: [["外协良率波动 −1~2pct", "QMS 外协批次", "#E8B54A"], ["不良流入 · 客诉上升", "质量域不良类别", "#54B5C4"], ["退货/返工 + 商誉损失", "质量成本", "#5E8FE8"], ["毛利侵蚀 · 大客户信任受损", "毛利率/客户关系", "#DD7E9E"]] }] },
      E: { keys: "乘用车守价 + 枣庄一线扩高端 + 长尾量外协；三对策在月度 S&OP 第⑤步统一编排时序并设里程碑监测。", probs: [
        { n: "三对策时序错配", kind: "gap", rule: null, why: "扩产爬坡期、外协切换期、守价谈判期一旦脱节，缺口立即回弹：爬坡未达而外协未就位 = 交付违约；守价先行而供给未稳 = 客户流失。混合型的全部收益建立在协同之上，时序编排不是执行细节、是方案成立的前提。", chain: [["任一对策延期", "扩产/外协/守价 三线", "#E8B54A"], ["爬坡空窗 × 外协未就位", "供给缺口回弹", "#54B5C4"], ["交付违约 + 客户流失 双风险", "订单交期判/客户关系", "#5E8FE8"], ["规模与毛利双失 · 方案收益归零", "综合评分坍塌", "#DD7E9E"]] },
        { n: "枣庄线认证爬坡风险", kind: "ramp", rule: "C23", why: "4680 高端线认证 T+20 若延期，高端储能供给出现缺口、只能回退外协兜底，外协费会吞掉混合型 +0.4pct 的毛利收益。认证里程碑必须像产能推演一样按时间窗挂牌监测、提前预判。", chain: [["认证 T+20 延期", "PLM 认证里程碑", "#E8B54A"], ["高端储能供给缺口", "枣庄一线产能", "#54B5C4"], ["回退外协兜底 · 外协费上升", "C08 外协占用", "#5E8FE8"], ["+0.4pct 毛利收益被吞噬", "方案收益", "#DD7E9E"]] }] },
    },
  },
  // PRD-IND-sop §4.5-5：收入预算口径=240（真预算 SOP_FIN[0].bud），滚动确认收入 248 → 达成率 248/240=103%（非 248/248=100%）。
  // G-10 P4 单源：dvThreshold ← C21.balanceDeviationPct（产销偏差）· cashFloor ← C18.cashFloor（现金垫底线）。
  sop: { gapRed: 2, dvThreshold: ruleParamOf("C21", "balanceDeviationPct"), cashFloor: ruleParamOf("C18", "cashFloor"), monthlyWeeks: 4, gmTolerance: 0.5, revBudget: 240 },
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
  // 地理坐标（GeoMap 着色/选址）+ 业态（动力/储能）——全建模，合成数据与字段对齐（R12）。
  { propKey: "lon", dataType: "number", isPrimaryKey: false },
  { propKey: "lat", dataType: "number", isPrimaryKey: false },
  { propKey: "position", dataType: "enum", isPrimaryKey: false },
  // SA-4：factory 台账字段（R12 全建模对齐）
  { propKey: "factory_code", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "province", dataType: "string", isPrimaryKey: false },
  { propKey: "city", dataType: "string", isPrimaryKey: false },
  { propKey: "factory_type", dataType: "enum", isPrimaryKey: false }, // CELL | PACK | CELL+PACK
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // 运营中 | 在建 | 停产
  { propKey: "start_date", dataType: "date", isPrimaryKey: false },
  // WO-OPT-WHATIF-DATA · 选址决策成本（**末位追加·不动前序序**·守 R6）。
  // 这两个字段是 optimize_whatif/facility_location 自动装配唯一缺的那半：`assembleBaselineFromSelection`
  // 按 ROLE_LEXICON.cost 词库在决策承载类型上找数值字段绑 open_cost / assign_cost，Base 此前一个都没有
  // ⇒ 装配恒报缺 ⇒ 会话真命中也只能降级 path-B。声明序即角色序：**第一个**命中成本词库的数值字段绑
  // open_cost（openCost），**第二个**绑 assign_cost（serveCost）——故两者不可换位。
  { propKey: "openCost", dataType: "number", isPrimaryKey: false, description: "基地年固定开办成本（万元/年）= 铭牌年产能 × 单位产能固定成本 + 产线数 × 单线固定成本；facility_location 的 open_cost 系数源。" },
  { propKey: "serveCost", dataType: "number", isPrimaryKey: false, description: "单位需求点年均干线履约成本（万元/需求点·年）= 产能加权全网平均干线距离 × 每公里费率；facility_location 的 assign_cost 系数源。" },
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
  // Phase 2：产品工程域扩展属性（R12 全建模对齐）
  { propKey: "seriesId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "ProductSeries" },
  { propKey: "productCode", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "capacity", dataType: "number", isPrimaryKey: false }, // Ah
  { propKey: "voltage", dataType: "number", isPrimaryKey: false }, // V
  { propKey: "energy", dataType: "number", isPrimaryKey: false }, // Wh
  { propKey: "dimension", dataType: "string", isPrimaryKey: false }, // 长×宽×高 mm
  { propKey: "weight", dataType: "number", isPrimaryKey: false }, // g
  { propKey: "applicationDomain", dataType: "enum", isPrimaryKey: false }, // 储能 | 乘用车 | 商用车 | 消费电子
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // 量产 | 试产 | 研发中 | 退役
];
const modelDerived: DerivedPropertyDef[] = [
  { propKey: "totalDemand", formula: "SUM(Order.qty BY model)" },
  { propKey: "orderCount", formula: "COUNT(Order.so BY model)" },
];

// Phase 2 Wave 1：产品域基础对象（ProductPlatform / ProductSeries / ProductVersion）
const productPlatformProps: PropertyDef[] = [
  { propKey: "platformId", dataType: "string", isPrimaryKey: true },
  { propKey: "platformCode", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "name", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "category", dataType: "enum", isPrimaryKey: false }, // LFP | 三元 | 固态
  { propKey: "description", dataType: "string", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // 活跃 | 退役 | 规划中
];

const productSeriesProps: PropertyDef[] = [
  { propKey: "seriesId", dataType: "string", isPrimaryKey: true },
  { propKey: "seriesCode", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "platformId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "ProductPlatform" },
  { propKey: "name", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "category", dataType: "enum", isPrimaryKey: false }, // 280Ah储能 | 314Ah储能 | 4680动力 | 2170动力 | 刀片动力
  { propKey: "voltageRange", dataType: "string", isPrimaryKey: false },
  { propKey: "capacityRange", dataType: "string", isPrimaryKey: false },
  { propKey: "targetMarket", dataType: "enum", isPrimaryKey: false }, // 储能 | 乘用车 | 商用车 | 消费电子
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // 活跃 | 退役 | 开发中
];

const productVersionProps: PropertyDef[] = [
  { propKey: "versionId", dataType: "string", isPrimaryKey: true },
  { propKey: "modelId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Model" },
  { propKey: "versionCode", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "versionName", dataType: "string", isPrimaryKey: false },
  { propKey: "ecnNumber", dataType: "string", isPrimaryKey: false },
  { propKey: "effectiveDate", dataType: "date", isPrimaryKey: false },
  { propKey: "expireDate", dataType: "date", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // 量产 | 试产 | 研发中 | 退役
  { propKey: "changeReason", dataType: "string", isPrimaryKey: false },
];

// Phase 2 Wave 3：BOM + 工艺路线 + 工序 + 工艺能力边界
const bomHeaderProps: PropertyDef[] = [
  { propKey: "bomId", dataType: "string", isPrimaryKey: true },
  { propKey: "bomCode", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "versionId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "ProductVersion" },
  { propKey: "modelId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Model" },
  { propKey: "bomName", dataType: "string", isPrimaryKey: false },
  { propKey: "bomLevel", dataType: "number", isPrimaryKey: false },
  { propKey: "effectiveDate", dataType: "date", isPrimaryKey: false },
  { propKey: "expireDate", dataType: "date", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false },
];

const bomDetailProps: PropertyDef[] = [
  { propKey: "bomDetailId", dataType: "string", isPrimaryKey: true },
  { propKey: "bomId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "BOMHeader" },
  { propKey: "materialId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Material" },
  { propKey: "sequence", dataType: "number", isPrimaryKey: false },
  { propKey: "quantity", dataType: "number", isPrimaryKey: false },
  { propKey: "lossRate", dataType: "number", isPrimaryKey: false },
  { propKey: "unit", dataType: "string", isPrimaryKey: false },
  { propKey: "level", dataType: "number", isPrimaryKey: false },
  { propKey: "parentItemId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Material" },
  { propKey: "isKeyComponent", dataType: "boolean", isPrimaryKey: false },
  { propKey: "effectiveDate", dataType: "date", isPrimaryKey: false },
  { propKey: "expireDate", dataType: "date", isPrimaryKey: false },
];

const routingProps: PropertyDef[] = [
  { propKey: "routingId", dataType: "string", isPrimaryKey: true },
  { propKey: "routingCode", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "modelId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Model" },
  { propKey: "versionId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "ProductVersion" },
  { propKey: "routingName", dataType: "string", isPrimaryKey: false },
  { propKey: "operationCount", dataType: "number", isPrimaryKey: false },
  { propKey: "totalStandardTime", dataType: "number", isPrimaryKey: false },
  { propKey: "totalYield", dataType: "number", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false },
  { propKey: "effectiveDate", dataType: "date", isPrimaryKey: false },
];

const operationProps: PropertyDef[] = [
  { propKey: "operationId", dataType: "string", isPrimaryKey: true },
  { propKey: "operationCode", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "routingId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Routing" },
  { propKey: "operationSeq", dataType: "number", isPrimaryKey: false },
  { propKey: "operationName", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "description", dataType: "string", isPrimaryKey: false },
  { propKey: "operationType", dataType: "enum", isPrimaryKey: false },
  { propKey: "standardTime", dataType: "number", isPrimaryKey: false },
  { propKey: "setupTime", dataType: "number", isPrimaryKey: false },
  { propKey: "yield", dataType: "number", isPrimaryKey: false },
  { propKey: "isCritical", dataType: "boolean", isPrimaryKey: false },
  { propKey: "workCenterType", dataType: "enum", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false },
];

const processCapabilityProps: PropertyDef[] = [
  { propKey: "capabilityId", dataType: "string", isPrimaryKey: true },
  { propKey: "operationId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Operation" },
  { propKey: "parameterName", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "paramCode", dataType: "string", isPrimaryKey: false },
  { propKey: "unit", dataType: "string", isPrimaryKey: false },
  { propKey: "minValue", dataType: "number", isPrimaryKey: false },
  { propKey: "maxValue", dataType: "number", isPrimaryKey: false },
  { propKey: "targetValue", dataType: "number", isPrimaryKey: false },
  { propKey: "tolerance", dataType: "number", isPrimaryKey: false },
  { propKey: "ucl", dataType: "number", isPrimaryKey: false },
  { propKey: "lcl", dataType: "number", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false },
];

// Phase 2 Wave 4：质量标准 + 检验特性 + 制造能力
const qualityStandardProps: PropertyDef[] = [
  { propKey: "standardId", dataType: "string", isPrimaryKey: true },
  { propKey: "standardCode", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "modelId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Model" },
  { propKey: "versionId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "ProductVersion" },
  { propKey: "itemName", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "itemCode", dataType: "string", isPrimaryKey: false },
  { propKey: "targetValue", dataType: "number", isPrimaryKey: false },
  { propKey: "toleranceUpper", dataType: "number", isPrimaryKey: false },
  { propKey: "toleranceLower", dataType: "number", isPrimaryKey: false },
  { propKey: "unit", dataType: "string", isPrimaryKey: false },
  { propKey: "testMethod", dataType: "string", isPrimaryKey: false },
  { propKey: "samplingRate", dataType: "number", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false },
];

const inspectionCharacteristicProps: PropertyDef[] = [
  { propKey: "charId", dataType: "string", isPrimaryKey: true },
  { propKey: "standardId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "QualityStandard" },
  { propKey: "charName", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "charCode", dataType: "string", isPrimaryKey: false },
  { propKey: "inspectionType", dataType: "enum", isPrimaryKey: false },
  { propKey: "inspectionMethod", dataType: "string", isPrimaryKey: false },
  { propKey: "samplingRate", dataType: "number", isPrimaryKey: false },
  { propKey: "frequency", dataType: "string", isPrimaryKey: false },
  { propKey: "controlMethod", dataType: "enum", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false },
];

const productLineCapabilityProps: PropertyDef[] = [
  { propKey: "capId", dataType: "string", isPrimaryKey: true },
  { propKey: "productId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Model" },
  { propKey: "versionId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "ProductVersion" },
  { propKey: "lineId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Line" },
  { propKey: "capability", dataType: "enum", isPrimaryKey: false },
  { propKey: "maxCapacity", dataType: "number", isPrimaryKey: false },
  { propKey: "cycleTime", dataType: "number", isPrimaryKey: false },
  { propKey: "yield", dataType: "number", isPrimaryKey: false },
  { propKey: "priority", dataType: "number", isPrimaryKey: false },
  { propKey: "changeoverTime", dataType: "number", isPrimaryKey: false },
  { propKey: "constraints", dataType: "string", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false },
];

const productEquipmentCapabilityProps: PropertyDef[] = [
  { propKey: "equipCapId", dataType: "string", isPrimaryKey: true },
  { propKey: "productId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Model" },
  { propKey: "versionId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "ProductVersion" },
  { propKey: "equipmentId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Equipment" },
  { propKey: "capability", dataType: "enum", isPrimaryKey: false },
  { propKey: "maxSpeed", dataType: "number", isPrimaryKey: false },
  { propKey: "minSpeed", dataType: "number", isPrimaryKey: false },
  { propKey: "setupTime", dataType: "number", isPrimaryKey: false },
  { propKey: "qualifiedOperators", dataType: "number", isPrimaryKey: false },
  { propKey: "certificationRequired", dataType: "boolean", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false },
];

// Phase 2 Wave 5：工程变更历史
const engineeringChangeProps: PropertyDef[] = [
  { propKey: "changeId", dataType: "string", isPrimaryKey: true },
  { propKey: "changeNumber", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "changeType", dataType: "enum", isPrimaryKey: false },
  { propKey: "modelId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Model" },
  { propKey: "versionId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "ProductVersion" },
  { propKey: "changeReason", dataType: "string", isPrimaryKey: false },
  { propKey: "description", dataType: "string", isPrimaryKey: false },
  { propKey: "affectedObjects", dataType: "json", isPrimaryKey: false },
  { propKey: "effectiveDate", dataType: "date", isPrimaryKey: false },
  { propKey: "approvedBy", dataType: "string", isPrimaryKey: false },
  { propKey: "approvedDate", dataType: "date", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false },
];

// Phase 2 Wave 2：物料替代关系
const materialAlternativeProps: PropertyDef[] = [
  { propKey: "altId", dataType: "string", isPrimaryKey: true },
  { propKey: "primaryMaterialId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Material" },
  { propKey: "alternativeMaterialId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Material" },
  { propKey: "priority", dataType: "number", isPrimaryKey: false },
  { propKey: "approvalStatus", dataType: "enum", isPrimaryKey: false },
  { propKey: "effectiveDate", dataType: "date", isPrimaryKey: false },
  { propKey: "expireDate", dataType: "date", isPrimaryKey: false },
  { propKey: "changeReason", dataType: "string", isPrimaryKey: false },
  { propKey: "verifiedBy", dataType: "string", isPrimaryKey: false },
  { propKey: "verifiedDate", dataType: "date", isPrimaryKey: false },
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
  // WO-W5·业务类型维度（乘/商/储·全局推演勾选筛选 + 分口径聚合）。early/earlyDue = 乘用车部分客户提前交付（三重张力之一）。
  { propKey: "businessType", dataType: "enum", isPrimaryKey: false }, // passenger | commercial | storage
  { propKey: "early", dataType: "boolean", isPrimaryKey: false }, // 是否需提前交付（乘用车部分客户）
  { propKey: "earlyDue", dataType: "date", isPrimaryKey: false }, // 提前交期（early 时·= due − 提前天数）
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
  // SA-5：产线台账字段（R12 全建模对齐）
  { propKey: "line_code", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "max_capacity_day", dataType: "number", isPrimaryKey: false }, // 件/日
  // 线级运营日产能（**套/日**·与需求同口径；supply_demand_gap_attribution 读它 ×300/1e4→万套年化产能）。
  // 单位口径钉死：demand/gap 皆万套(套=pack)，故此字段=套/日 而非 max_capacity_day 的件/日(cell)，避免单位炸。
  { propKey: "capacityDaily", dataType: "number", isPrimaryKey: false }, // 套/日
  { propKey: "target_yield", dataType: "number", isPrimaryKey: false }, // %
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // 运行中 | 停机 | 调试
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
  // WO-SANDBOX-D3 · 硬容量约束的两个新承载物（只落在**真有**硬容量单元的工序上；串行工序**不带此二属性**，
  // 消费方据此诚实标 EMPTY，绝不给默认柜位数）。
  //   capacityUnitKind  —— 硬容量单元语义标签（化成柜位 / 老化库位…），是引擎通用发现硬容量的入口；
  //                        单元数与速率的**数值单源仍是 channels / agingSlots 本身**（见 contracts
  //                        `HARD_CAPACITY_UNIT_SPECS`），刻意不另存副本，否则拨 ② 杠杆（Process.channels）
  //                        会让副本悄悄漂移。
  //   requiredThroughput —— 上游串行段要求该并行段承接的日吞吐（电芯/天）。**这是本单真正新增的信息**：
  //                        没有它就无法判「柜位够不够」，只能取 min 而说不出谁夹定、差多少。
  //                        规则 C02 `Process.parallelThroughput < Process.requiredThroughput` 早已按名引用
  //                        该量，但此前 Process 上无此属性（故 C02 恒不可评估）。
  { propKey: "capacityUnitKind", dataType: "enum", isPrimaryKey: false, description: "硬容量单元类型（化成柜位 | 老化库位）；无此属性 = 该工序不承载硬容量单元" },
  { propKey: "requiredThroughput", dataType: "number", isPrimaryKey: false, unit: "电芯/天", description: "上游串行段要求该并行段承接的日吞吐（判「柜位够不够」的比较基准）" },
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
  // SA-6：设备台账字段（R12 全建模对齐）
  { propKey: "equipment_code", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "equipment_type", dataType: "enum", isPrimaryKey: false }, // 涂布机 | 辊压机 | 分切机 | 卷绕机 | 装配线 | 注液机 | 化成柜 | 老化库 | PACK线
  { propKey: "manufacturer", dataType: "string", isPrimaryKey: false },
  { propKey: "install_date", dataType: "date", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // 正常 | 维修中 | 待报废
  // WO-SA-2：设备可靠性工程字段（故障推演真信号·诚实合成非实测·R12 全建模对齐）
  { propKey: "mtbf", dataType: "number", isPrimaryKey: false, unit: "h", description: "平均无故障时间（小时·越高越可靠）" },
  { propKey: "mttr", dataType: "number", isPrimaryKey: false, unit: "h", description: "平均修复时间（小时·越低越好）" },
  { propKey: "health_score", dataType: "number", isPrimaryKey: false, unit: "%", description: "设备健康度（0-100·越高越健康）" },
];

// SA-3：车间对象属性（Base↔Workshop↔Line 四层结构）
const workshopProps: PropertyDef[] = [
  { propKey: "workshopId", dataType: "string", isPrimaryKey: true },
  { propKey: "baseId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
  { propKey: "name", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "processType", dataType: "enum", isPrimaryKey: false }, // 制浆 | 涂布 | 辊压 | 分切 | 卷绕 | 装配 | 注液 | 化成 | 分容 | PACK
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
/**
 * WO-SANDBOX-D1×E1 接缝 · 节拍对象属性表。
 *
 * 行来自 `synthetic/cadence.ts` 的 `cadenceObjectRows()`（种子自身发生序列推导，非拍脑袋）。
 * `nodeId` 取值受 `CHAIN_NODE_REGISTRY` 约束（契约 §2.5 单源），**不是自由串**。
 * `dataMode === "EMPTY"` 的行**照样落库**：诚实缺席必须可查询，
 * 否则「本仓没有这个节拍」与「本仓压根没登记这个环节」在下游长得一模一样。
 */
const cadenceProps: PropertyDef[] = [
  { propKey: "nodeId", dataType: "string", isPrimaryKey: true, description: "全链节点 id（取值受契约 CHAIN_NODE_REGISTRY 约束，不是自由串）" },
  { propKey: "label", dataType: "string", isPrimaryKey: false, description: "节点人读名（由注册表派生，不在本表另存一份）" },
  { propKey: "stage", dataType: "enum", isPrimaryKey: false, description: "所属链路阶段：DEMAND 需求 | ORDER 订单 | CAPACITY 产能 | MATERIAL 物料" },
  { propKey: "dataMode", dataType: "enum", isPrimaryKey: false, description: "诚实位：SYNTHETIC=从种子发生序列真推出了周期 | EMPTY=推不出（此时不给默认值，见 emptyReason）" },
  { propKey: "everyDays", dataType: "number", isPrimaryKey: false, unit: "天", description: "节拍周期长度：这个环节多久处理一次。EMPTY 行不带此属性（缺席即缺席，不补 0）" },
  { propKey: "offsetDays", dataType: "number", isPrimaryKey: false, unit: "天", description: "周期内相位（第几天开闸），∈[0, everyDays)。⚠ 不进等待期望公式——相位移动的是每一次具体等待，不改变期望" },
  { propKey: "cadenceKind", dataType: "enum", isPrimaryKey: false, description: "节拍性质：meeting 会议 | batch 攒批 | settlement 结算 | shipping 发运" },
  { propKey: "flowGate", dataType: "boolean", isPrimaryKey: false, description: "是否产品流要等的闸门。false=周期性停机（如检修窗）——是真周期但产品不是在等它开始，故不摊进全链前置期，否则会凭空多出一段假等待" },
  { propKey: "intervalCount", dataType: "number", isPrimaryKey: false, unit: "个", description: "证据强度：推导该周期时采到的间隔样本数（前端可据此标『证据薄』）" },
  { propKey: "emptyReason", dataType: "string", isPrimaryKey: false, description: "推不出周期的机器可读原因：NO_CARRIER 连可查的集合都没有（要加字段）| NO_INTERVAL 发生次数不足两次 | NON_UNIFORM 间隔不等长（那是一串事件，不是一个节拍）。前者要加字段、后两者要补数据，修法不同不可混标" },
  { propKey: "note", dataType: "string", isPrimaryKey: false, description: "口径说明与取证记录（该节拍从哪个集合的哪个时刻字段推出，或为什么查不到）" },
];
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
  { propKey: "businessType", dataType: "enum", isPrimaryKey: false }, // WO-W5·业务类型（passenger|commercial|storage·= 细分名映射）
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
  // WO-SEG-ATTR-SCOPE：细分达成率指标（seg_attain_ess/pas/com）携业态（storage|passenger|commercial·经
  // businessTypeOfSegment 派生，与 Order.businessType 同源同口径 R-一致），供 gap_attribution 按业态裁订单。
  // 声明于类型以对齐合成字段（否则 seg Metric 实例的 businessType 成孤儿字段·synthetic-field-alignment 红）。
  { propKey: "businessType", dataType: "enum", isPrimaryKey: false }, // passenger | commercial | storage（仅 seg 指标有·非 seg 指标缺省）
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
/**
 * WO-ADOPT-MITIGATION · 已采纳处置方案台账（`adopt_mitigation` Action 审批通过后的**唯一落点**）。
 *
 * 病灶：`adopt_mitigation` 审批通过后一个字节不写 → 用户点「采纳」，风险曲线纹丝不动。
 * 引擎半本来就齐（`risk.ts tensionSeries` 接 `{eff,tn}`、`params.risk.mitigations` 带量化效果），
 * **唯一缺的是"哪个方案被真采纳了"这条记录**。本类型即那条记录：
 *   risk_timeline 逐 (baseId,factor) 查 ACTIVE 采纳 → 把 {eff,tn} 喂进**真曲线**（不是"如果采纳"的对照曲线）。
 * eff/tn 由执行器从 `params.risk.mitigations[factor]` **解出后落库**（非猜、非默认值）：
 * 解不出即诚实失败，绝不写一个猜的 eff/tn（③ 拒绝 > 静默错数）。
 * 不变量：同一 (baseId,factor) 至多一条 ACTIVE（执行器写前先把旧的置 REVOKED·② 单源 > 并存）。
 */
const adoptedMitigationProps: PropertyDef[] = [
  { propKey: "adoptionId", dataType: "string", isPrimaryKey: true, description: "采纳记录唯一标识（一次审批通过写一条）" },
  { propKey: "baseId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base", description: "方案生效的生产基地（经 resolveBaseId 严格解析·解不出即拒写）" },
  { propKey: "factor", dataType: "string", isPrimaryKey: false, description: "被处置的瓶颈因素（params.bottleneck.factors 之一，如 瓶颈工序/设备OEE/物流时长）" },
  { propKey: "planKey", dataType: "string", isPrimaryKey: false, description: "方案库中的方案键（params.risk.mitigations[factor][].key）" },
  { propKey: "planName", dataType: "string", isPrimaryKey: false, description: "方案中文名（审计可读·随 planKey 自方案库解出，非自由填写）" },
  { propKey: "eff", dataType: "number", isPrimaryKey: false, unit: "点", description: "张力削减量：生效后风险张力逐日下调的幅度（自方案库解出·拒绝臆造）" },
  { propKey: "tn", dataType: "number", isPrimaryKey: false, unit: "天", description: "生效天 T+n：自该日起风险曲线开始扣减 eff，之前逐日不变" },
  { propKey: "adoptedAt", dataType: "string", isPrimaryKey: false, description: "采纳时间（ISO 时间戳·审批通过写入时刻）" },
  { propKey: "actionDraftId", dataType: "string", isPrimaryKey: false, description: "来源 Action 草稿 id（R13 溯回完整审批链：谁提、谁批、何时执行）" },
  { propKey: "status", dataType: "enum", isPrimaryKey: false, description: "采纳状态 ACTIVE｜REVOKED；同一 (baseId,factor) 至多一条 ACTIVE，改采新方案时旧条置 REVOKED" },
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

// WO-WAREHOUSE-CUSTLOC：仓库（每基地 N 仓·库存仓位落点·成品仓 FINISHED 必有供 WO-INVENTORY FG 挂位）。
const warehouseProps: PropertyDef[] = [
  { propKey: "warehouseId", dataType: "string", isPrimaryKey: true },
  { propKey: "baseId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
  { propKey: "name", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "whType", dataType: "enum", isPrimaryKey: false }, // RAW | FINISHED | TRANSIT
  { propKey: "capacityUnits", dataType: "number", isPrimaryKey: false },
  { propKey: "province", dataType: "string", isPrimaryKey: false },
  { propKey: "city", dataType: "string", isPrimaryKey: false },
];
// WO-INTERBASE-TRANSFER：跨基地调拨台账（从字符串杠杆升一等·R13 可溯真对象）。
// fromBase/toBase→Base(baseId)·model→Model(modelId) 用 ref；status 用 enum；
// etaDay 走 derivedProperties（数值管线 dispatchDay+transitDays），etaDate/dispatchDate 为 ISO 展示。
const interBaseTransferProps: PropertyDef[] = [
  { propKey: "transferId", dataType: "string", isPrimaryKey: true },
  { propKey: "fromBase", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
  { propKey: "toBase", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
  { propKey: "model", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Model" },
  { propKey: "qty", dataType: "number", isPrimaryKey: false }, // 套
  { propKey: "transitDays", dataType: "number", isPrimaryKey: false }, // 距离派生 = ceil(baseDistanceKm / dailyTruckKm)（WO-GSIM-1-DATA）
  { propKey: "freightCost", dataType: "number", isPrimaryKey: false }, // 运费 = baseDistanceKm × tonKmRate × (qty × qtyToTon)（WO-GSIM-1-DATA）
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // PLANNED | IN_TRANSIT | DELIVERED | CANCELLED
  { propKey: "dispatchDate", dataType: "date", isPrimaryKey: false },
  { propKey: "dispatchDay", dataType: "number", isPrimaryKey: false }, // 相对 forecastStart 的天偏移（etaDay 派生输入）
  { propKey: "etaDay", dataType: "number", isPrimaryKey: false }, // 派生 = dispatchDay + transitDays（derivedProperties 管线算）
  { propKey: "etaDate", dataType: "date", isPrimaryKey: false }, // = forecastStart + etaDay 的 ISO 展示
  { propKey: "reason", dataType: "string", isPrimaryKey: false },
];
// etaDate(到货) = dispatch + transitDays：数值派生管线只支持数值算术，故派生落在 etaDay（天偏移·确定性·无时钟）。
const interBaseTransferDerived: DerivedPropertyDef[] = [{ propKey: "etaDay", formula: "dispatchDay + transitDays" }];

const dataHealthProps: PropertyDef[] = [
  { propKey: "sourceId", dataType: "string", isPrimaryKey: true },
  { propKey: "name", dataType: "string", isPrimaryKey: false },
  { propKey: "critical", dataType: "boolean", isPrimaryKey: false },
  { propKey: "lagHours", dataType: "number", isPrimaryKey: false },
];

// WO-INVENTORY-3TIER：成品库存（按 model×warehouse 一行）+ 统一库存流水（收/发/移/退）。
// 三层闭环 WIP(WIPLot)→完工入库事务(InventoryTxn RECEIPT)→成品库存(FinishedGoodsInventory)。
const finishedGoodsInvProps: PropertyDef[] = [
  { propKey: "fgId", dataType: "string", isPrimaryKey: true },
  { propKey: "model", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Model" },
  { propKey: "warehouseId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Warehouse" }, // 成品仓（WO-WAREHOUSE 已落）
  { propKey: "qtyOnHand", dataType: "number", isPrimaryKey: false }, // = Σ RECEIPT − Σ ISSUE（勾稽）
  { propKey: "qtyReserved", dataType: "number", isPrimaryKey: false },
  { propKey: "asOf", dataType: "date", isPrimaryKey: false },
];
// 可用量派生（qtyAvailable = qtyOnHand − qtyReserved）：派生投影非新真值（R13），走 derivedProperties。
const finishedGoodsInvDerived: DerivedPropertyDef[] = [{ propKey: "qtyAvailable", formula: "qtyOnHand - qtyReserved" }];

// WO-ATP-PROMISE · 订单承诺台账（一订单一承诺行·ATP/CTP「能不能接、何时交」）。
const orderPromiseProps: PropertyDef[] = [
  { propKey: "promiseId", dataType: "string", isPrimaryKey: true },
  { propKey: "orderRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Order" },
  { propKey: "model", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Model" },
  { propKey: "requestedQty", dataType: "number", isPrimaryKey: false }, // 订单需求量
  { propKey: "committableQty", dataType: "number", isPrimaryKey: false }, // 可承接量 = min(需求, 现货+在制未交+交期前可排产能)
  { propKey: "promiseDate", dataType: "date", isPrimaryKey: false }, // 满足全量最早日
  { propKey: "atpStatus", dataType: "enum", isPrimaryKey: false }, // CONFIRMED | PARTIAL | UNMET
  { propKey: "shortfallQty", dataType: "number", isPrimaryKey: false }, // 缺口 = requestedQty − committableQty
  { propKey: "bottleneck", dataType: "enum", isPrimaryKey: false }, // 产能 | 库存 | 物料 | 齐套（无缺口 → null）
  { propKey: "asOf", dataType: "date", isPrimaryKey: false }, // 承诺基准日（固定 T0·R6）
];

// WO-ORDERLINE · 订单明细行（SO→型号行·一单多型号多行·勾稽 Σ行===头·行级独立态）。
const orderLineProps: PropertyDef[] = [
  { propKey: "lineId", dataType: "string", isPrimaryKey: true }, // SO-3391-L1
  { propKey: "orderRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Order" }, // 该行属于哪张订单
  { propKey: "lineNo", dataType: "number", isPrimaryKey: false }, // 行号（1 起·首行保原单 model）
  { propKey: "model", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Model" }, // 该行型号
  { propKey: "qty", dataType: "number", isPrimaryKey: false, unit: "件" }, // Σ BY orderRef === Order.qty（勾稽）
  { propKey: "due", dataType: "date", isPrimaryKey: false }, // 交期（继承订单头）
  { propKey: "lineStatus", dataType: "enum", isPrimaryKey: false }, // OPEN | COMMITTED | PARTIAL | SHIPPED
  { propKey: "unitPrice", dataType: "number", isPrimaryKey: false, unit: "元" }, // 按行 model 反范式化（Model.unitPrice 单一来源·R14）
];

const inventoryTxnProps: PropertyDef[] = [
  { propKey: "txnId", dataType: "string", isPrimaryKey: true },
  { propKey: "txnType", dataType: "enum", isPrimaryKey: false }, // RECEIPT | ISSUE | TRANSFER | RETURN
  { propKey: "fgRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "FinishedGoodsInventory" },
  { propKey: "woRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "WorkOrder" }, // 收货来源工单
  { propKey: "qty", dataType: "number", isPrimaryKey: false }, // 带正负
  { propKey: "fromWarehouse", dataType: "string", isPrimaryKey: false },
  { propKey: "toWarehouse", dataType: "string", isPrimaryKey: false },
  { propKey: "refDoc", dataType: "string", isPrimaryKey: false },
  { propKey: "occurredAt", dataType: "date", isPrimaryKey: false },
];

// Phase 3 MES Domain: Production Planning
const workOrderProps: PropertyDef[] = [
  { propKey: "woId", dataType: "string", isPrimaryKey: true },
  { propKey: "moNo", dataType: "string", isPrimaryKey: false },
  { propKey: "modelId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Model" },
  { propKey: "lineId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Line" },
  { propKey: "baseId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
  { propKey: "qtyPlanned", dataType: "number", isPrimaryKey: false },
  { propKey: "qtyActual", dataType: "number", isPrimaryKey: false },
  { propKey: "startDate", dataType: "date", isPrimaryKey: false },
  { propKey: "endDate", dataType: "date", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // 已排产 | 生产中 | 已完成 | 已关闭
];

const productionScheduleProps: PropertyDef[] = [
  { propKey: "schedId", dataType: "string", isPrimaryKey: true },
  { propKey: "woId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "WorkOrder" },
  { propKey: "lineId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Line" },
  { propKey: "shift", dataType: "enum", isPrimaryKey: false }, // 白班 | 夜班
  { propKey: "scheduledDate", dataType: "date", isPrimaryKey: false },
  { propKey: "qty", dataType: "number", isPrimaryKey: false },
  { propKey: "priority", dataType: "number", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // 已确认 | 已执行 | 已取消
];

const shiftPlanProps: PropertyDef[] = [
  { propKey: "shiftId", dataType: "string", isPrimaryKey: true },
  { propKey: "lineId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Line" },
  { propKey: "baseId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
  { propKey: "shiftName", dataType: "string", isPrimaryKey: false },
  { propKey: "plannedHeadcount", dataType: "number", isPrimaryKey: false },
  { propKey: "actualHeadcount", dataType: "number", isPrimaryKey: false },
  { propKey: "date", dataType: "date", isPrimaryKey: false },
  { propKey: "hours", dataType: "number", isPrimaryKey: false },
];

// Phase 3 MES Domain: WIP Tracking
const wipLotProps: PropertyDef[] = [
  { propKey: "lotId", dataType: "string", isPrimaryKey: true },
  { propKey: "woId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "WorkOrder" },
  { propKey: "modelId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Model" },
  { propKey: "lineId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Line" },
  { propKey: "currentProcess", dataType: "string", isPrimaryKey: false },
  { propKey: "qty", dataType: "number", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // 在制 | 待检 | 合格 | 报废
  { propKey: "startTime", dataType: "date", isPrimaryKey: false },
  { propKey: "lastMoveTime", dataType: "date", isPrimaryKey: false },
];

const wipMoveProps: PropertyDef[] = [
  { propKey: "moveId", dataType: "string", isPrimaryKey: true },
  { propKey: "lotId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "WIPLot" },
  { propKey: "fromProcess", dataType: "string", isPrimaryKey: false },
  { propKey: "toProcess", dataType: "string", isPrimaryKey: false },
  { propKey: "qty", dataType: "number", isPrimaryKey: false },
  { propKey: "moveTime", dataType: "date", isPrimaryKey: false },
  { propKey: "operatorId", dataType: "string", isPrimaryKey: false },
];

const wipQualityCheckpointProps: PropertyDef[] = [
  { propKey: "checkpointId", dataType: "string", isPrimaryKey: true },
  { propKey: "lotId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "WIPLot" },
  { propKey: "processName", dataType: "string", isPrimaryKey: false },
  { propKey: "checkType", dataType: "enum", isPrimaryKey: false }, // 首检 | 巡检 | 末检
  { propKey: "result", dataType: "enum", isPrimaryKey: false }, // 通过 | 不通过 | 待定
  { propKey: "checkTime", dataType: "date", isPrimaryKey: false },
  { propKey: "inspectorId", dataType: "string", isPrimaryKey: false },
];

// Phase 3 MES Domain: Quality Execution
const qualityLotProps: PropertyDef[] = [
  { propKey: "qlotId", dataType: "string", isPrimaryKey: true },
  { propKey: "woId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "WorkOrder" },
  { propKey: "modelId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Model" },
  { propKey: "lineId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Line" },
  { propKey: "batchSize", dataType: "number", isPrimaryKey: false },
  { propKey: "sampleSize", dataType: "number", isPrimaryKey: false },
  { propKey: "passQty", dataType: "number", isPrimaryKey: false },
  { propKey: "failQty", dataType: "number", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // 待检 | 合格 | 不合格 | 特采
  { propKey: "inspectDate", dataType: "date", isPrimaryKey: false },
];

const inspectionResultProps: PropertyDef[] = [
  { propKey: "resultId", dataType: "string", isPrimaryKey: true },
  { propKey: "qlotId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "QualityLot" },
  { propKey: "charId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "InspectionCharacteristic" },
  { propKey: "measuredValue", dataType: "number", isPrimaryKey: false },
  { propKey: "targetValue", dataType: "number", isPrimaryKey: false },
  { propKey: "upperLimit", dataType: "number", isPrimaryKey: false },
  { propKey: "lowerLimit", dataType: "number", isPrimaryKey: false },
  { propKey: "result", dataType: "enum", isPrimaryKey: false }, // 合格 | 不合格
  { propKey: "inspectTime", dataType: "date", isPrimaryKey: false },
];

const defectRecordProps: PropertyDef[] = [
  { propKey: "defectId", dataType: "string", isPrimaryKey: true },
  { propKey: "qlotId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "QualityLot" },
  { propKey: "lotId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "WIPLot" },
  { propKey: "defectType", dataType: "enum", isPrimaryKey: false }, // 外观 | 尺寸 | 性能 | 安全
  { propKey: "severity", dataType: "enum", isPrimaryKey: false }, // 轻微 | 一般 | 严重
  { propKey: "qty", dataType: "number", isPrimaryKey: false },
  { propKey: "description", dataType: "string", isPrimaryKey: false },
  { propKey: "foundAt", dataType: "date", isPrimaryKey: false },
  { propKey: "processName", dataType: "string", isPrimaryKey: false },
];

// Phase 3 MES Domain: Equipment Execution
const equipmentOEEProps: PropertyDef[] = [
  { propKey: "oeeId", dataType: "string", isPrimaryKey: true },
  { propKey: "equipId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Equipment" },
  { propKey: "lineId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Line" },
  { propKey: "baseId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
  { propKey: "date", dataType: "date", isPrimaryKey: false },
  { propKey: "availability", dataType: "number", isPrimaryKey: false },
  { propKey: "performance", dataType: "number", isPrimaryKey: false },
  { propKey: "quality", dataType: "number", isPrimaryKey: false },
  { propKey: "oee", dataType: "number", isPrimaryKey: false },
  { propKey: "plannedProductionTime", dataType: "number", isPrimaryKey: false },
  { propKey: "actualProductionTime", dataType: "number", isPrimaryKey: false },
];

const equipmentDowntimeProps: PropertyDef[] = [
  { propKey: "dtId", dataType: "string", isPrimaryKey: true },
  { propKey: "equipId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Equipment" },
  { propKey: "lineId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Line" },
  { propKey: "baseId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
  { propKey: "startTime", dataType: "date", isPrimaryKey: false },
  { propKey: "endTime", dataType: "date", isPrimaryKey: false },
  { propKey: "durationMin", dataType: "number", isPrimaryKey: false },
  { propKey: "reason", dataType: "enum", isPrimaryKey: false }, // 故障 | 换型 | 待料 | 计划停机 | 其他
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // 进行中 | 已恢复
];

const equipmentAlarmProps: PropertyDef[] = [
  { propKey: "alarmId", dataType: "string", isPrimaryKey: true },
  { propKey: "equipId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Equipment" },
  { propKey: "lineId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Line" },
  { propKey: "alarmCode", dataType: "string", isPrimaryKey: false },
  { propKey: "alarmLevel", dataType: "enum", isPrimaryKey: false }, // 提示 | 警告 | 紧急
  { propKey: "message", dataType: "string", isPrimaryKey: false },
  { propKey: "triggeredAt", dataType: "date", isPrimaryKey: false },
  { propKey: "clearedAt", dataType: "date", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // 活跃 | 已确认 | 已清除
];

// ---------------------------------------------------------------------------
// WO-EXCEPTION-EVENT · 四源归一「异常事件」聚合投影（G-EXCEPTION-SCATTER）。
// 病根：EquipmentDowntime / EquipmentAlarm / DefectRecord / TriggerRule（+MaterialBalance 缺料）
// 五处散落、无统一入口 → Agent「全监听」无处落地。ExceptionEvent = 确定性聚合投影。
// R6：纯从源行派生（无随机/无时钟/不消费 mulberry32 流·同源同投影字节一致）。
// R13：refType/refId 保留下钻回源对象。R14：严重度阈值集中配置表（不散落魔数）。
// ---------------------------------------------------------------------------
const exceptionEventProps: PropertyDef[] = [
  { propKey: "excId", dataType: "string", isPrimaryKey: true, searchable: true },
  { propKey: "excType", dataType: "enum", isPrimaryKey: false }, // MATERIAL_SHORTAGE | EQUIPMENT | QUALITY | CUSTOMER
  { propKey: "source", dataType: "enum", isPrimaryKey: false }, // downtime | alarm | defect | trigger | material_balance
  { propKey: "severity", dataType: "enum", isPrimaryKey: false }, // LOW | MEDIUM | HIGH | CRITICAL
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // OPEN | ACK | RESOLVED
  { propKey: "refType", dataType: "string", isPrimaryKey: false }, // 源对象类型键（R13 下钻）
  { propKey: "refId", dataType: "string", isPrimaryKey: false }, // 源对象业务主键
  { propKey: "summary", dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "occurredAt", dataType: "date", isPrimaryKey: false }, // 源时间戳或 T0 派生
];

/** R14：严重度阈值配置表（集中·可审计·非散落魔数）。 */
export const EXCEPTION_SEVERITY_CONFIG = {
  // 停机：按 durationMin 分档（分钟·降序命中）。
  downtime: [
    { min: 240, sev: "CRITICAL" },
    { min: 120, sev: "HIGH" },
    { min: 60, sev: "MEDIUM" },
    { min: 0, sev: "LOW" },
  ] as { min: number; sev: ExcSeverity }[],
  // 告警：按 alarmLevel 枚举（默认 MEDIUM）。
  alarmLevel: { 紧急: "CRITICAL", 警告: "HIGH", 提示: "LOW" } as Record<string, ExcSeverity>,
  // 缺陷：按 severity 枚举（默认 MEDIUM）+ qty 升档阈值。
  defectSeverity: { 严重: "HIGH", 一般: "MEDIUM", 轻微: "LOW" } as Record<string, ExcSeverity>,
  defectQtyCritical: 4, // qty ≥ 此值 → CRITICAL（大批量不良升级）
  // 触发规则：按比较算子（默认 MEDIUM）。
  triggerOp: { ">": "HIGH", ">=": "HIGH", "<": "MEDIUM", "<=": "MEDIUM", "==": "LOW" } as Record<string, ExcSeverity>,
  // 缺料：按 gapTon 分档（吨·降序命中）。
  materialGap: [
    { min: 5000, sev: "CRITICAL" },
    { min: 2000, sev: "HIGH" },
    { min: 500, sev: "MEDIUM" },
    { min: 0, sev: "LOW" },
  ] as { min: number; sev: ExcSeverity }[],
};

function bucketByThreshold(value: number, table: { min: number; sev: ExcSeverity }[]): ExcSeverity {
  for (const row of table) if (value >= row.min) return row.sev;
  return "LOW";
}

// 源状态字段 → 统一处置状态（无源状态默认 OPEN）。
const DOWNTIME_STATUS: Record<string, ExcStatus> = { 进行中: "OPEN", 已恢复: "RESOLVED" };
const ALARM_STATUS: Record<string, ExcStatus> = { 活跃: "OPEN", 已确认: "ACK", 已清除: "RESOLVED" };

export interface ExceptionSourceBundle {
  equipmentDowntimes?: Record<string, unknown>[];
  equipmentAlarms?: Record<string, unknown>[];
  defectRecords?: Record<string, unknown>[];
  triggerRules?: Record<string, unknown>[];
  materialBalances?: Record<string, unknown>[];
}

/**
 * 四源（+缺料）归一投影：从各源行确定性投影统一异常事件。
 * refType/refId 保留下钻回源对象（R13）；occurredAt 取源时间戳或 T0 派生；纯函数（R6）。
 * 分源投影可拆调（generateBattery 投 4 本地源·service 层投 trigger 源后合并），皆字节一致。
 */
export function projectExceptionEvents(src: ExceptionSourceBundle, t0: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const t0Iso = new Date(t0).toISOString().slice(0, 10);
  // 设备停机 → EQUIPMENT
  for (const dt of src.equipmentDowntimes ?? []) {
    const dtId = String(dt.dtId);
    const dur = Number(dt.durationMin ?? 0);
    out.push({
      excId: `EXC-DT-${dtId}`,
      excType: "EQUIPMENT",
      source: "downtime",
      severity: bucketByThreshold(dur, EXCEPTION_SEVERITY_CONFIG.downtime),
      status: DOWNTIME_STATUS[String(dt.status)] ?? "OPEN",
      refType: "EquipmentDowntime",
      refId: dtId,
      summary: `设备 ${String(dt.equipId)} 停机 ${dur} 分钟（${String(dt.reason ?? "")}）`,
      occurredAt: String(dt.startTime ?? t0Iso),
    });
  }
  // 设备告警 → EQUIPMENT
  for (const al of src.equipmentAlarms ?? []) {
    const alarmId = String(al.alarmId);
    const level = String(al.alarmLevel ?? "");
    out.push({
      excId: `EXC-AL-${alarmId}`,
      excType: "EQUIPMENT",
      source: "alarm",
      severity: EXCEPTION_SEVERITY_CONFIG.alarmLevel[level] ?? "MEDIUM",
      status: ALARM_STATUS[String(al.status)] ?? "OPEN",
      refType: "EquipmentAlarm",
      refId: alarmId,
      summary: `设备 ${String(al.equipId)} 告警 ${String(al.alarmCode ?? "")}（${level}）`,
      occurredAt: String(al.triggeredAt ?? t0Iso),
    });
  }
  // 缺陷记录 → QUALITY
  for (const df of src.defectRecords ?? []) {
    const defectId = String(df.defectId);
    const qty = Number(df.qty ?? 0);
    const sevEnum = String(df.severity ?? "");
    const severity: ExcSeverity =
      qty >= EXCEPTION_SEVERITY_CONFIG.defectQtyCritical
        ? "CRITICAL"
        : EXCEPTION_SEVERITY_CONFIG.defectSeverity[sevEnum] ?? "MEDIUM";
    out.push({
      excId: `EXC-DF-${defectId}`,
      excType: "QUALITY",
      source: "defect",
      severity,
      status: "OPEN",
      refType: "DefectRecord",
      refId: defectId,
      summary: `缺陷 ${String(df.defectType ?? "")} ×${qty}（${sevEnum}·${String(df.processName ?? "")}）`,
      occurredAt: String(df.foundAt ?? t0Iso),
    });
  }
  // 触发规则 → CUSTOMER（信号阈值→行动的客户/市场侧监听）
  for (const tr of src.triggerRules ?? []) {
    const triggerId = String(tr.triggerId);
    const op = String(tr.op ?? "");
    out.push({
      excId: `EXC-TR-${triggerId}`,
      excType: "CUSTOMER",
      source: "trigger",
      severity: EXCEPTION_SEVERITY_CONFIG.triggerOp[op] ?? "MEDIUM",
      status: "OPEN",
      refType: "TriggerRule",
      refId: triggerId,
      summary: `触发规则 ${String(tr.signalRef ?? "")} ${op} ${String(tr.threshold ?? "")} → ${String(tr.action ?? "")}`,
      occurredAt: t0Iso,
    });
  }
  // 物料平衡缺口 → MATERIAL_SHORTAGE（仅 gapTon>0，缺料才成异常，缺料域有数据）
  for (const mb of src.materialBalances ?? []) {
    const gap = Number(mb.gapTon ?? 0);
    if (!(gap > 0)) continue;
    const matBalId = String(mb.matBalId);
    out.push({
      excId: `EXC-MB-${matBalId}`,
      excType: "MATERIAL_SHORTAGE",
      source: "material_balance",
      severity: bucketByThreshold(gap, EXCEPTION_SEVERITY_CONFIG.materialGap),
      status: "OPEN",
      refType: "MaterialBalance",
      refId: matBalId,
      summary: `${String(mb.material ?? "")} 现货缺口 ${gap} ${String(mb.unit ?? "")}`,
      occurredAt: String(mb.etaDate || t0Iso),
    });
  }
  return out;
}

// Phase 3 MES Domain: Maintenance Execution
const maintenanceOrderProps: PropertyDef[] = [
  { propKey: "moId", dataType: "string", isPrimaryKey: true },
  { propKey: "equipId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Equipment" },
  { propKey: "lineId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Line" },
  { propKey: "baseId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
  { propKey: "maintType", dataType: "enum", isPrimaryKey: false }, // 预防性 | 预测性 |  corrective
  { propKey: "priority", dataType: "enum", isPrimaryKey: false }, // 低 | 中 | 高 | 紧急
  { propKey: "plannedStart", dataType: "date", isPrimaryKey: false },
  { propKey: "plannedEnd", dataType: "date", isPrimaryKey: false },
  { propKey: "actualStart", dataType: "date", isPrimaryKey: false },
  { propKey: "actualEnd", dataType: "date", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // 待执行 | 执行中 | 已完成 | 已取消
];

const sparePartConsumptionProps: PropertyDef[] = [
  { propKey: "consumptionId", dataType: "string", isPrimaryKey: true },
  { propKey: "moId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "MaintenanceOrder" },
  { propKey: "partCode", dataType: "string", isPrimaryKey: false },
  { propKey: "partName", dataType: "string", isPrimaryKey: false },
  { propKey: "qtyUsed", dataType: "number", isPrimaryKey: false },
  { propKey: "unit", dataType: "string", isPrimaryKey: false },
  { propKey: "consumedAt", dataType: "date", isPrimaryKey: false },
];

// Phase 3 MES Domain: Labor Tracking
const operatorAttendanceProps: PropertyDef[] = [
  { propKey: "attId", dataType: "string", isPrimaryKey: true },
  { propKey: "operatorId", dataType: "string", isPrimaryKey: false },
  { propKey: "operatorName", dataType: "string", isPrimaryKey: false },
  { propKey: "lineId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Line" },
  { propKey: "baseId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
  { propKey: "date", dataType: "date", isPrimaryKey: false },
  { propKey: "shift", dataType: "enum", isPrimaryKey: false }, // 白班 | 夜班
  { propKey: "checkIn", dataType: "date", isPrimaryKey: false },
  { propKey: "checkOut", dataType: "date", isPrimaryKey: false },
  { propKey: "hoursWorked", dataType: "number", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // 正常 | 迟到 | 早退 | 缺勤
];

const operatorSkillCertProps: PropertyDef[] = [
  { propKey: "certId", dataType: "string", isPrimaryKey: true },
  { propKey: "operatorId", dataType: "string", isPrimaryKey: false },
  { propKey: "skillName", dataType: "string", isPrimaryKey: false },
  { propKey: "skillLevel", dataType: "enum", isPrimaryKey: false }, // 初级 | 中级 | 高级 | 技师
  { propKey: "certifiedBy", dataType: "string", isPrimaryKey: false },
  { propKey: "certifiedDate", dataType: "date", isPrimaryKey: false },
  { propKey: "expireDate", dataType: "date", isPrimaryKey: false },
  { propKey: "status", dataType: "enum", isPrimaryKey: false }, // 有效 | 过期 | 吊销
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
export const BINDINGS: Record<string, { connId: string; dataset: string; fieldMappings: Record<string, string> }[]> = {
  Base: [{ connId: "conn-mes", dataset: "mes_base_master", fieldMappings: { baseId: "BASE_ID", name: "BASE_NAME", kind: "BASE_KIND", gwh: "NAMEPLATE_GWH", util: "UTILIZATION", factory_code: "FACTORY_CODE", province: "PROVINCE", city: "CITY", factory_type: "FACTORY_TYPE", status: "STATUS", start_date: "START_DATE" } }],
  Model: [{ connId: "conn-plm", dataset: "plm_models", fieldMappings: { modelId: "MODEL_ID", name: "MODEL_NAME", unitPrice: "UNIT_PRICE" } }],
  Order: [{ connId: "conn-erp", dataset: "erp_sales_orders", fieldMappings: { so: "SO_NO", cust: "CUSTOMER", model: "MODEL_ID", qty: "QTY", due: "DUE_DATE", status: "STATUS" } }],
  Line: [{ connId: "conn-mes", dataset: "mes_lines", fieldMappings: { lineId: "LINE_ID", baseId: "BASE_ID", name: "LINE_NAME", line_code: "LINE_CODE", max_capacity_day: "MAX_CAP_DAY", target_yield: "TARGET_YIELD", status: "STATUS" } }],
  Workshop: [{ connId: "conn-mes", dataset: "mes_workshops", fieldMappings: { workshopId: "WS_ID", baseId: "BASE_ID", name: "WS_NAME", processType: "PROC_TYPE" } }],
  Process: [{ connId: "conn-mes", dataset: "mes_processes", fieldMappings: { processId: "PROC_ID", lineId: "LINE_ID", name: "PROC_NAME", kind: "PROC_KIND", yield: "YIELD" } }],
  Equipment: [{ connId: "conn-iot", dataset: "iot_equipment", fieldMappings: { equipId: "EQUIP_ID", processId: "PROC_ID", ctSeconds: "CT_SECONDS", availFactor: "AVAIL", oeeA: "OEE_A", oeeP: "OEE_P", oeeQ: "OEE_Q", equipment_code: "EQUIP_CODE", equipment_type: "EQUIP_TYPE", manufacturer: "MANUFACTURER", install_date: "INSTALL_DATE", status: "STATUS" } }],
  MaintPlan: [{ connId: "conn-mes", dataset: "mes_maint_plans", fieldMappings: { planId: "PLAN_ID", baseId: "BASE_ID", week: "PLAN_WEEK" } }],
  Segment: [{ connId: "conn-erp", dataset: "erp_segments", fieldMappings: { segKey: "SEG_KEY", name: "SEG_NAME", gmRate: "GM_RATE" } }],
  Shipment: [{ connId: "conn-srm", dataset: "srm_shipments", fieldMappings: { shipId: "SHIP_ID", baseId: "BASE_ID", etaDay: "ETA_DAY", qtyTons: "QTY_TONS" } }],
  DataSourceHealth: [{ connId: "conn-iot", dataset: "iot_source_health", fieldMappings: { sourceId: "SOURCE_ID", lagHours: "LAG_HOURS" } }],
  // Phase 2：产品工程域源系统绑定
  ProductPlatform: [{ connId: "conn-plm", dataset: "plm_platforms", fieldMappings: { platformId: "PLATFORM_ID", platformCode: "PLATFORM_CODE", name: "PLATFORM_NAME", category: "CATEGORY", status: "STATUS" } }],
  ProductSeries: [{ connId: "conn-plm", dataset: "plm_series", fieldMappings: { seriesId: "SERIES_ID", seriesCode: "SERIES_CODE", platformId: "PLATFORM_ID", name: "SERIES_NAME", category: "CATEGORY", voltageRange: "VOLTAGE_RANGE", capacityRange: "CAP_RANGE", targetMarket: "TARGET_MARKET", status: "STATUS" } }],
  ProductVersion: [{ connId: "conn-plm", dataset: "plm_versions", fieldMappings: { versionId: "VERSION_ID", modelId: "MODEL_ID", versionCode: "VERSION_CODE", versionName: "VERSION_NAME", ecnNumber: "ECN_NO", effectiveDate: "EFF_DATE", expireDate: "EXP_DATE", status: "STATUS", changeReason: "CHANGE_REASON" } }],
  MaterialAlternative: [{ connId: "conn-plm", dataset: "plm_material_alts", fieldMappings: { altId: "ALT_ID", primaryMaterialId: "PRIMARY_MAT_ID", alternativeMaterialId: "ALT_MAT_ID", priority: "PRIORITY", approvalStatus: "APPROVAL_STATUS", effectiveDate: "EFF_DATE", expireDate: "EXP_DATE", changeReason: "CHANGE_REASON", verifiedBy: "VERIFIED_BY", verifiedDate: "VERIFIED_DATE" } }],
  // Phase 3 MES Domain bindings
  WorkOrder: [{ connId: "conn-mes", dataset: "mes_work_orders", fieldMappings: { woId: "WO_ID", moNo: "MO_NO", modelId: "MODEL_ID", lineId: "LINE_ID", baseId: "BASE_ID", qtyPlanned: "QTY_PLANNED", qtyActual: "QTY_ACTUAL", startDate: "START_DATE", endDate: "END_DATE", status: "STATUS" } }],
  ProductionSchedule: [{ connId: "conn-mes", dataset: "mes_schedules", fieldMappings: { schedId: "SCHED_ID", woId: "WO_ID", lineId: "LINE_ID", shift: "SHIFT", scheduledDate: "SCHED_DATE", qty: "QTY", priority: "PRIORITY", status: "STATUS" } }],
  ShiftPlan: [{ connId: "conn-mes", dataset: "mes_shift_plans", fieldMappings: { shiftId: "SHIFT_ID", lineId: "LINE_ID", baseId: "BASE_ID", shiftName: "SHIFT_NAME", plannedHeadcount: "PLAN_HC", actualHeadcount: "ACT_HC", date: "SHIFT_DATE", hours: "HOURS" } }],
  WIPLot: [{ connId: "conn-mes", dataset: "mes_wip_lots", fieldMappings: { lotId: "LOT_ID", woId: "WO_ID", modelId: "MODEL_ID", lineId: "LINE_ID", currentProcess: "CUR_PROC", qty: "QTY", status: "STATUS", startTime: "START_TIME", lastMoveTime: "LAST_MOVE" } }],
  WIPMove: [{ connId: "conn-mes", dataset: "mes_wip_moves", fieldMappings: { moveId: "MOVE_ID", lotId: "LOT_ID", fromProcess: "FROM_PROC", toProcess: "TO_PROC", qty: "QTY", moveTime: "MOVE_TIME", operatorId: "OP_ID" } }],
  WIPQualityCheckpoint: [{ connId: "conn-qms", dataset: "qms_wip_checkpoints", fieldMappings: { checkpointId: "CHK_ID", lotId: "LOT_ID", processName: "PROC_NAME", checkType: "CHK_TYPE", result: "RESULT", checkTime: "CHK_TIME", inspectorId: "INSP_ID" } }],
  QualityLot: [{ connId: "conn-qms", dataset: "qms_quality_lots", fieldMappings: { qlotId: "QLOT_ID", woId: "WO_ID", modelId: "MODEL_ID", lineId: "LINE_ID", batchSize: "BATCH_SIZE", sampleSize: "SAMPLE_SIZE", passQty: "PASS_QTY", failQty: "FAIL_QTY", status: "STATUS", inspectDate: "INSP_DATE" } }],
  InspectionResult: [{ connId: "conn-qms", dataset: "qms_inspection_results", fieldMappings: { resultId: "RES_ID", qlotId: "QLOT_ID", charId: "CHAR_ID", measuredValue: "MEAS_VAL", targetValue: "TGT_VAL", upperLimit: "UCL", lowerLimit: "LCL", result: "RESULT", inspectTime: "INSP_TIME" } }],
  DefectRecord: [{ connId: "conn-qms", dataset: "qms_defects", fieldMappings: { defectId: "DEF_ID", qlotId: "QLOT_ID", lotId: "LOT_ID", defectType: "DEF_TYPE", severity: "SEVERITY", qty: "QTY", description: "DESC", foundAt: "FOUND_AT", processName: "PROC_NAME" } }],
  EquipmentOEE: [{ connId: "conn-iot", dataset: "iot_oee_daily", fieldMappings: { oeeId: "OEE_ID", equipId: "EQUIP_ID", lineId: "LINE_ID", baseId: "BASE_ID", date: "OEE_DATE", availability: "AVAIL", performance: "PERF", quality: "QUAL", oee: "OEE", plannedProductionTime: "PLAN_TIME", actualProductionTime: "ACT_TIME" } }],
  EquipmentDowntime: [{ connId: "conn-iot", dataset: "iot_downtime", fieldMappings: { dtId: "DT_ID", equipId: "EQUIP_ID", lineId: "LINE_ID", baseId: "BASE_ID", startTime: "START_TIME", endTime: "END_TIME", durationMin: "DUR_MIN", reason: "REASON", status: "STATUS" } }],
  EquipmentAlarm: [{ connId: "conn-iot", dataset: "iot_alarms", fieldMappings: { alarmId: "ALARM_ID", equipId: "EQUIP_ID", lineId: "LINE_ID", alarmCode: "ALARM_CODE", alarmLevel: "ALARM_LEVEL", message: "MSG", triggeredAt: "TRIG_TIME", clearedAt: "CLR_TIME", status: "STATUS" } }],
  MaintenanceOrder: [{ connId: "conn-eam", dataset: "eam_maint_orders", fieldMappings: { moId: "MO_ID", equipId: "EQUIP_ID", lineId: "LINE_ID", baseId: "BASE_ID", maintType: "MAINT_TYPE", priority: "PRIORITY", plannedStart: "PLAN_START", plannedEnd: "PLAN_END", actualStart: "ACT_START", actualEnd: "ACT_END", status: "STATUS" } }],
  SparePartConsumption: [{ connId: "conn-eam", dataset: "eam_spare_parts", fieldMappings: { consumptionId: "CONS_ID", moId: "MO_ID", partCode: "PART_CODE", partName: "PART_NAME", qtyUsed: "QTY_USED", unit: "UNIT", consumedAt: "CONS_AT" } }],
  OperatorAttendance: [{ connId: "conn-hr", dataset: "hr_attendance", fieldMappings: { attId: "ATT_ID", operatorId: "OP_ID", operatorName: "OP_NAME", lineId: "LINE_ID", baseId: "BASE_ID", date: "ATT_DATE", shift: "SHIFT", checkIn: "CHECK_IN", checkOut: "CHECK_OUT", hoursWorked: "HOURS", status: "STATUS" } }],
  OperatorSkillCert: [{ connId: "conn-hr", dataset: "hr_skill_certs", fieldMappings: { certId: "CERT_ID", operatorId: "OP_ID", skillName: "SKILL", skillLevel: "LEVEL", certifiedBy: "CERT_BY", certifiedDate: "CERT_DATE", expireDate: "EXP_DATE", status: "STATUS" } }],
};

/** 治理增量 §1：电池模板各对象类型的归域（与 graphmeta.GRAPH_DOMAIN 同源）。 */
export const BATTERY_TYPE_DOMAIN: Record<string, string> = {
  Cadence: "capacity",
  Base: "factory", Workshop: "factory", Line: "factory", Process: "process", Equipment: "equip", MaintPlan: "equip",
  Order: "product", Model: "product", Segment: "product", Shipment: "capacity",
  // WO-WAREHOUSE-CUSTLOC：仓库归 factory 域（库存仓位属工厂设施）
  Warehouse: "factory",
  InterBaseTransfer: "capacity", // WO-INTERBASE-TRANSFER：跨基地调拨（在途运力·同 Shipment 归 capacity 域）
  ProductPlatform: "product", ProductSeries: "product", ProductVersion: "product",
  BOMHeader: "product", BOMDetail: "product", Routing: "process", Operation: "process", ProcessCapabilityWindow: "process",
  QualityStandard: "quality", InspectionCharacteristic: "quality",
  ProductLineCapability: "factory", ProductEquipmentCapability: "equip",
  EngineeringChange: "product", MaterialAlternative: "supply",
  Supplier: "supply",
  DataSourceHealth: "quality", AnnualScenario: "plan", ScenarioTrigger: "plan", PlanTarget: "plan",
  // cockpit P1 绿地
  DemandSegment: "forecast", FinancePlan: "finance", MaterialBalance: "material",
  // cockpit P2 + SPINE 绿地（规划决策推演 + 根因 DAG + 目标-指标-责任骨架）
  Metric: "decision", RootCauseChain: "decision", KSF: "decision", Principal: "people",
  // WO-ADOPT-MITIGATION：已采纳处置方案（决策落地台账·归 decision 域，同 RootCauseChain/DecisionGap）
  AdoptedMitigation: "decision",
  // cockpit P5 / sop 绿地（S&OP 版本演进）
  SopVersionRow: "plan",
  // Phase 3 MES Domain
  WorkOrder: "process", ProductionSchedule: "process", ShiftPlan: "people",
  WIPLot: "process", WIPMove: "process", WIPQualityCheckpoint: "quality",
  QualityLot: "quality", InspectionResult: "quality", DefectRecord: "quality",
  EquipmentOEE: "equip", EquipmentDowntime: "equip", EquipmentAlarm: "equip",
  MaintenanceOrder: "equip", SparePartConsumption: "equip",
  OperatorAttendance: "people", OperatorSkillCert: "people",
  // WO-EXCEPTION-EVENT 四源归一异常事件（归 quality 域·跨域聚合投影，DataCategory 归 decision_cockpit）
  ExceptionEvent: "quality",
  // WO-INVENTORY-3TIER 库存三层闭环（成品库存 + 统一流水；归 supply 域·refbase 归一化 supply→material）
  FinishedGoodsInventory: "supply", InventoryTxn: "supply",
  // WO-ATP-PROMISE 订单承诺台账（ATP/CTP·随订单归 commercial 域·refbase 14 域含 commercial）
  OrderPromise: "commercial",
  // WO-ORDERLINE 订单明细行（SO→型号行·与 Order 同域 product·DOMAIN_MAP）
  OrderLine: "product",
  // WO-SANDBOX-D2 采购段两段新承载：清关归 supply（责任方=清关行，采购组织协调面）；
  // 到货检验归 quality（责任方=自家质量部 IQC）——两段分属两个责任方，故分属两个域。
  CustomsClearance: "supply", IncomingInspection: "quality",
};

// ---------------------------------------------------------------------------
// WO-SCHEMA-ZH · 属性中文业务名（PropertyDef.displayName）单一真值表
//
// 病根：本体 Schema 的属性键是英文接线名（Material.leadTime / Equipment.oee_current /
// Process.yield_baseline），界面直接显示键名 → 没参与建模的业务专家读不懂"这个数字是什么"。
// 不改 propKey：key 被求解器 / 规则 DSL / 派生公式 / golden 计数 / mock 引用，改它连带打断整条链；
// 正确做法是**补一层展示名**，与 unit 并列，在此**一处**定义、经 PropertyDef.displayName 全链下发。
//
// 单源纪律（单源 > 并存）：
//  · 前端**不得**自建中文名映射，只消费 `displayName ?? propKey`（缺则诚实回落裸键，不渲染空白）；
//  · 与求解器杠杆标签 LEVER_PROP_META.label（形如「物料·到货周期」= 类型简称 + "·" + 属性名）**收敛成一份**：
//    重叠属性（见 test/schema-display-name.seam.test.ts）此处的名 === 该 label "·" 之后的后缀，属性级中文名只有一个串。
//
// 诚实留白（诚实 > 好看）：**只登记能从代码/注释/规则表达式确证业务含义的属性**。含义未确证者故意不登记
// （如 Base.position 与 kind 同值语义存疑、Material.devPct 无消费方口径不明），下游回落 propKey，
// 留白 = 待业务确认的清单，**不臆造中文名**（编错比不编危险：业务专家会照着错的理解）。
// ---------------------------------------------------------------------------
export const PROP_DISPLAY_NAMES: Record<string, string> = {
  // ---- 工厂 / 产线 / 工序 / 设备 ----
  "Base.baseId": "基地编号", "Base.name": "基地名称", "Base.kind": "业态类型", "Base.util": "产能利用率",
  "Base.bottleneck": "瓶颈环节", "Base.gwh": "铭牌年产能", "Base.formationCapDaily": "化成日产能",
  "Base.agingCapDaily": "老化日产能", "Base.lon": "经度", "Base.lat": "纬度",
  "Base.factory_code": "工厂编码", "Base.province": "省份", "Base.city": "城市",
  "Base.factory_type": "工厂类型", "Base.status": "运营状态", "Base.start_date": "投产日期",
  // WO-OPT-WHATIF-DATA · 选址决策成本（optimize_whatif/facility_location 的 open_cost / assign_cost 系数源）
  "Base.openCost": "年固定开办成本", "Base.serveCost": "单位需求点履约成本",
  "Line.lineId": "产线编号", "Line.baseId": "所属基地", "Line.name": "产线名称",
  "Line.utilization": "利用率", // ← 与 LEVER_PROP_META["Line.utilization"].label「产线·利用率」同一串
  "Line.actual_output_daily": "日实际产出", "Line.schedule_attainment": "排产达成率",
  "Line.line_code": "产线编码", "Line.max_capacity_day": "日最大产能", "Line.capacityDaily": "日运营产能",
  "Line.target_yield": "目标良率", "Line.status": "产线状态",
  "Workshop.workshopId": "车间编号", "Workshop.baseId": "所属基地", "Workshop.name": "车间名称",
  "Workshop.processType": "工艺类型",
  "Process.processId": "工序编号", "Process.lineId": "所属产线", "Process.baseId": "所属基地",
  "Process.name": "工序名称", "Process.kind": "工序类别", "Process.yield": "良率",
  "Process.yield_baseline": "良率基线", // ← LEVER「工序·良率基线」
  "Process.shiftHours": "班次工时", // ← LEVER「工序·班次工时」
  "Process.shifts": "班次数", // ← LEVER「工序·班次数」
  "Process.attendance": "出勤率", // ← LEVER「工序·出勤率」
  "Process.utilization": "利用率", "Process.channels": "化成通道数",
  "Process.channelOutputDaily": "单通道日产出", "Process.agingSlots": "老化工位数", "Process.agingDays": "老化天数",
  // WO-SANDBOX-D3 · 硬容量约束
  "Process.capacityUnitKind": "硬容量单元类型", "Process.requiredThroughput": "上游要求日吞吐",
  "Equipment.equipId": "设备编号", "Equipment.processId": "所属工序", "Equipment.lineId": "所属产线",
  "Equipment.baseId": "所属基地", "Equipment.ctSeconds": "节拍", "Equipment.availFactor": "可用系数",
  "Equipment.oeeA": "OEE可用率", "Equipment.oeeP": "OEE表现性", "Equipment.oeeQ": "OEE质量率",
  "Equipment.oee_current": "OEE", // ← LEVER「设备·OEE」
  "Equipment.equipment_code": "设备编码", "Equipment.equipment_type": "设备类型",
  "Equipment.manufacturer": "制造厂商", "Equipment.install_date": "安装日期", "Equipment.status": "设备状态",
  "Equipment.mtbf": "平均无故障时间", "Equipment.mttr": "平均修复时间", "Equipment.health_score": "设备健康度",
  "MaintPlan.planId": "检修计划编号", "MaintPlan.baseId": "所属基地", "MaintPlan.week": "计划周次",
  "MaintPlan.lastMaintStart": "上次检修开始日",
  "Warehouse.warehouseId": "仓库编号", "Warehouse.baseId": "所属基地", "Warehouse.name": "仓库名称",
  "Warehouse.whType": "仓库类型", "Warehouse.capacityUnits": "仓储容量", "Warehouse.province": "省份",
  "Warehouse.city": "城市",

  // ---- 产品 / 工程主数据 ----
  "Model.modelId": "型号编号", "Model.name": "型号名称", "Model.chem": "化学体系", "Model.pos": "业态定位",
  "Model.bases": "可产基地", "Model.unitPrice": "单价", "Model.carbonFootprint": "碳足迹",
  "Model.seriesId": "所属系列", "Model.productCode": "产品编码", "Model.capacity": "电芯容量",
  "Model.voltage": "标称电压", "Model.energy": "单体能量", "Model.dimension": "外形尺寸",
  "Model.weight": "单体重量", "Model.applicationDomain": "应用领域", "Model.status": "生命周期状态",
  "ProductPlatform.platformId": "平台编号", "ProductPlatform.platformCode": "平台编码",
  "ProductPlatform.name": "平台名称", "ProductPlatform.category": "技术路线",
  "ProductPlatform.description": "平台说明", "ProductPlatform.status": "平台状态",
  "ProductSeries.seriesId": "系列编号", "ProductSeries.seriesCode": "系列编码",
  "ProductSeries.platformId": "所属平台", "ProductSeries.name": "系列名称", "ProductSeries.category": "系列类别",
  "ProductSeries.voltageRange": "电压范围", "ProductSeries.capacityRange": "容量范围",
  "ProductSeries.targetMarket": "目标市场", "ProductSeries.status": "系列状态",
  "ProductVersion.versionId": "版本编号", "ProductVersion.modelId": "所属型号",
  "ProductVersion.versionCode": "版本编码", "ProductVersion.versionName": "版本名称",
  "ProductVersion.ecnNumber": "工程变更单号", "ProductVersion.effectiveDate": "生效日期",
  "ProductVersion.expireDate": "失效日期", "ProductVersion.status": "版本状态",
  "ProductVersion.changeReason": "变更原因",
  "BOMHeader.bomId": "BOM编号", "BOMHeader.bomCode": "BOM编码", "BOMHeader.versionId": "所属产品版本",
  "BOMHeader.modelId": "所属型号", "BOMHeader.bomName": "BOM名称", "BOMHeader.bomLevel": "BOM层级",
  "BOMHeader.effectiveDate": "生效日期", "BOMHeader.expireDate": "失效日期", "BOMHeader.status": "状态",
  "BOMDetail.bomDetailId": "BOM明细编号", "BOMDetail.bomId": "所属BOM", "BOMDetail.materialId": "物料",
  "BOMDetail.sequence": "行序号", "BOMDetail.quantity": "单台用量", "BOMDetail.lossRate": "损耗率",
  "BOMDetail.unit": "计量单位", "BOMDetail.level": "BOM层级", "BOMDetail.parentItemId": "上级物料",
  "BOMDetail.isKeyComponent": "是否关键件", "BOMDetail.effectiveDate": "生效日期",
  "BOMDetail.expireDate": "失效日期",
  "Routing.routingId": "工艺路线编号", "Routing.routingCode": "工艺路线编码", "Routing.modelId": "适用型号",
  "Routing.versionId": "适用产品版本", "Routing.routingName": "工艺路线名称", "Routing.operationCount": "工序数",
  "Routing.totalStandardTime": "标准总工时", "Routing.totalYield": "累计良率", "Routing.status": "状态",
  "Routing.effectiveDate": "生效日期",
  "Operation.operationId": "工序编号", "Operation.operationCode": "工序编码",
  "Operation.routingId": "所属工艺路线", "Operation.operationSeq": "工序顺序",
  "Operation.operationName": "工序名称", "Operation.description": "工序说明",
  "Operation.operationType": "工序类型", "Operation.standardTime": "标准工时",
  "Operation.setupTime": "准备工时", "Operation.yield": "工序良率", "Operation.isCritical": "是否关键工序",
  "Operation.workCenterType": "工作中心类型", "Operation.status": "状态",
  "ProcessCapabilityWindow.capabilityId": "能力边界编号", "ProcessCapabilityWindow.operationId": "所属工序",
  "ProcessCapabilityWindow.parameterName": "参数名称", "ProcessCapabilityWindow.paramCode": "参数编码",
  "ProcessCapabilityWindow.unit": "计量单位", "ProcessCapabilityWindow.minValue": "下限值",
  "ProcessCapabilityWindow.maxValue": "上限值", "ProcessCapabilityWindow.targetValue": "目标值",
  "ProcessCapabilityWindow.tolerance": "公差", "ProcessCapabilityWindow.ucl": "控制上限",
  "ProcessCapabilityWindow.lcl": "控制下限", "ProcessCapabilityWindow.status": "状态",
  "EngineeringChange.changeId": "变更编号", "EngineeringChange.changeNumber": "变更单号",
  "EngineeringChange.changeType": "变更类型", "EngineeringChange.modelId": "涉及型号",
  "EngineeringChange.versionId": "涉及产品版本", "EngineeringChange.changeReason": "变更原因",
  "EngineeringChange.description": "变更说明", "EngineeringChange.affectedObjects": "影响对象",
  "EngineeringChange.effectiveDate": "生效日期", "EngineeringChange.approvedBy": "批准人",
  "EngineeringChange.approvedDate": "批准日期", "EngineeringChange.status": "状态",
  "MaterialAlternative.altId": "替代关系编号", "MaterialAlternative.primaryMaterialId": "主用物料",
  "MaterialAlternative.alternativeMaterialId": "替代物料", "MaterialAlternative.priority": "替代优先级",
  "MaterialAlternative.approvalStatus": "审批状态", "MaterialAlternative.effectiveDate": "生效日期",
  "MaterialAlternative.expireDate": "失效日期", "MaterialAlternative.changeReason": "变更原因",
  "MaterialAlternative.verifiedBy": "验证人", "MaterialAlternative.verifiedDate": "验证日期",
  "ProductLineCapability.capId": "产线能力编号", "ProductLineCapability.productId": "型号",
  "ProductLineCapability.versionId": "产品版本", "ProductLineCapability.lineId": "产线",
  "ProductLineCapability.capability": "可产能力", "ProductLineCapability.maxCapacity": "最大产能",
  "ProductLineCapability.cycleTime": "节拍", "ProductLineCapability.yield": "良率",
  "ProductLineCapability.priority": "优先级", "ProductLineCapability.changeoverTime": "换型时长",
  "ProductLineCapability.constraints": "约束说明", "ProductLineCapability.status": "状态",
  "ProductEquipmentCapability.equipCapId": "设备能力编号", "ProductEquipmentCapability.productId": "型号",
  "ProductEquipmentCapability.versionId": "产品版本", "ProductEquipmentCapability.equipmentId": "设备",
  "ProductEquipmentCapability.capability": "设备支持能力", "ProductEquipmentCapability.maxSpeed": "最高速度",
  "ProductEquipmentCapability.minSpeed": "最低速度", "ProductEquipmentCapability.setupTime": "准备工时",
  "ProductEquipmentCapability.qualifiedOperators": "持证操作工数",
  "ProductEquipmentCapability.certificationRequired": "是否需持证", "ProductEquipmentCapability.status": "状态",

  // ---- 商务 / 订单 / 交付 ----
  "Order.so": "订单号", "Order.cust": "客户", "Order.model": "型号", "Order.qty": "订单数量",
  "Order.due": "交期", "Order.pri": "优先级", "Order.bases": "承接基地", "Order.status": "订单状态",
  "Order.demandDelta": "需求增量比例", // 有效需求 = 基线 × (1 + demandDelta)（capacity.ts PRD-CAP-DEMANDDELTA）
  "Order.outsourceRatio": "外协比例", // ← LEVER「订单·外协比例」
  "Order.creditUsedRatio": "信用额度使用率", "Order.leadDays": "交付前置天数", "Order.unitPrice": "单价",
  "Order.businessType": "业务类型", "Order.early": "是否提前交付", "Order.earlyDue": "提前交期",
  "OrderLine.lineId": "订单行号", "OrderLine.orderRef": "所属订单", "OrderLine.lineNo": "行序号",
  "OrderLine.model": "型号", "OrderLine.qty": "数量", "OrderLine.due": "交期",
  "OrderLine.lineStatus": "行状态", "OrderLine.unitPrice": "单价",
  "OrderPromise.promiseId": "承诺编号", "OrderPromise.orderRef": "所属订单", "OrderPromise.model": "型号",
  "OrderPromise.requestedQty": "需求量", "OrderPromise.committableQty": "可承接量",
  "OrderPromise.promiseDate": "承诺交付日", "OrderPromise.atpStatus": "承诺状态",
  "OrderPromise.shortfallQty": "缺口量", "OrderPromise.bottleneck": "瓶颈环节",
  "OrderPromise.asOf": "承诺基准日",
  "Shipment.shipId": "在途批次号", "Shipment.baseId": "目的基地",
  "Shipment.etaDay": "到货天", // ← LEVER「在途·到货天」
  "Shipment.status": "在途状态", "Shipment.qtyTons": "数量", "Shipment.coverageDays": "齐套覆盖天数",
  "InterBaseTransfer.transferId": "调拨单号", "InterBaseTransfer.fromBase": "调出基地",
  "InterBaseTransfer.toBase": "调入基地", "InterBaseTransfer.model": "型号",
  "InterBaseTransfer.qty": "调拨数量", "InterBaseTransfer.transitDays": "在途天数",
  "InterBaseTransfer.freightCost": "运费", "InterBaseTransfer.status": "调拨状态",
  "InterBaseTransfer.dispatchDate": "发运日期", "InterBaseTransfer.dispatchDay": "发运天",
  "InterBaseTransfer.etaDay": "到货天", "InterBaseTransfer.etaDate": "预计到货日",
  "InterBaseTransfer.reason": "调拨原因",

  // ---- 库存 / 物料平衡 ----
  "FinishedGoodsInventory.fgId": "成品库存编号", "FinishedGoodsInventory.model": "型号",
  "FinishedGoodsInventory.warehouseId": "所在仓库", "FinishedGoodsInventory.qtyOnHand": "在库数量",
  "FinishedGoodsInventory.qtyReserved": "已预留数量", "FinishedGoodsInventory.asOf": "统计日期",
  "InventoryTxn.txnId": "流水号", "InventoryTxn.txnType": "流水类型", "InventoryTxn.fgRef": "关联成品库存",
  "InventoryTxn.woRef": "来源工单", "InventoryTxn.qty": "数量", "InventoryTxn.fromWarehouse": "调出仓库",
  "InventoryTxn.toWarehouse": "调入仓库", "InventoryTxn.refDoc": "关联单据", "InventoryTxn.occurredAt": "发生时间",
  "MaterialBalance.matBalId": "物料平衡编号", "MaterialBalance.material": "物料",
  "MaterialBalance.unit": "计量单位", "MaterialBalance.netDemandTon": "净需求量",
  "MaterialBalance.ltaPct": "长协覆盖率", "MaterialBalance.gapTon": "现货缺口",
  "MaterialBalance.etaDate": "预计到货日",

  // ---- 生产执行（MES） ----
  "WorkOrder.woId": "工单编号", "WorkOrder.moNo": "制造单号", "WorkOrder.modelId": "型号",
  "WorkOrder.lineId": "产线", "WorkOrder.baseId": "基地", "WorkOrder.qtyPlanned": "计划数量",
  "WorkOrder.qtyActual": "实际数量", "WorkOrder.startDate": "开工日期", "WorkOrder.endDate": "完工日期",
  "WorkOrder.status": "工单状态",
  "ProductionSchedule.schedId": "排程编号", "ProductionSchedule.woId": "关联工单",
  "ProductionSchedule.lineId": "产线", "ProductionSchedule.shift": "班次",
  "ProductionSchedule.scheduledDate": "排产日期", "ProductionSchedule.qty": "排产数量",
  "ProductionSchedule.priority": "优先级", "ProductionSchedule.status": "排程状态",
  "ShiftPlan.shiftId": "班次计划编号", "ShiftPlan.lineId": "产线", "ShiftPlan.baseId": "基地",
  "ShiftPlan.shiftName": "班次名称", "ShiftPlan.plannedHeadcount": "计划人数",
  "ShiftPlan.actualHeadcount": "实际人数", "ShiftPlan.date": "日期", "ShiftPlan.hours": "工时",
  "WIPLot.lotId": "在制批号", "WIPLot.woId": "关联工单", "WIPLot.modelId": "型号", "WIPLot.lineId": "产线",
  "WIPLot.currentProcess": "当前工序", "WIPLot.qty": "数量", "WIPLot.status": "批次状态",
  "WIPLot.startTime": "投产时间", "WIPLot.lastMoveTime": "最后流转时间",
  "WIPMove.moveId": "流转编号", "WIPMove.lotId": "在制批次", "WIPMove.fromProcess": "来源工序",
  "WIPMove.toProcess": "去向工序", "WIPMove.qty": "数量", "WIPMove.moveTime": "流转时间",
  "WIPMove.operatorId": "操作工工号",
  "WIPQualityCheckpoint.checkpointId": "质检点编号", "WIPQualityCheckpoint.lotId": "在制批次",
  "WIPQualityCheckpoint.processName": "工序名称", "WIPQualityCheckpoint.checkType": "检验类型",
  "WIPQualityCheckpoint.result": "检验结论", "WIPQualityCheckpoint.checkTime": "检验时间",
  "WIPQualityCheckpoint.inspectorId": "检验员",

  // ---- 质量 ----
  "QualityStandard.standardId": "标准编号", "QualityStandard.standardCode": "标准编码",
  "QualityStandard.modelId": "适用型号", "QualityStandard.versionId": "适用产品版本",
  "QualityStandard.itemName": "检验项目", "QualityStandard.itemCode": "项目编码",
  "QualityStandard.targetValue": "目标值", "QualityStandard.toleranceUpper": "上偏差",
  "QualityStandard.toleranceLower": "下偏差", "QualityStandard.unit": "计量单位",
  "QualityStandard.testMethod": "检测方法", "QualityStandard.samplingRate": "抽样比例",
  "QualityStandard.status": "状态",
  "InspectionCharacteristic.charId": "检验特性编号", "InspectionCharacteristic.standardId": "所属质量标准",
  "InspectionCharacteristic.charName": "特性名称", "InspectionCharacteristic.charCode": "特性编码",
  "InspectionCharacteristic.inspectionType": "检验类型",
  "InspectionCharacteristic.inspectionMethod": "检验方法",
  "InspectionCharacteristic.samplingRate": "抽样比例", "InspectionCharacteristic.frequency": "检验频次",
  "InspectionCharacteristic.controlMethod": "控制方式", "InspectionCharacteristic.status": "状态",
  "QualityLot.qlotId": "质检批号", "QualityLot.woId": "关联工单", "QualityLot.modelId": "型号",
  "QualityLot.lineId": "产线", "QualityLot.batchSize": "批量", "QualityLot.sampleSize": "抽样数",
  "QualityLot.passQty": "合格数", "QualityLot.failQty": "不合格数", "QualityLot.status": "检验状态",
  "QualityLot.inspectDate": "检验日期",
  "InspectionResult.resultId": "检验结果编号", "InspectionResult.qlotId": "质检批次",
  "InspectionResult.charId": "检验特性", "InspectionResult.measuredValue": "实测值",
  "InspectionResult.targetValue": "目标值", "InspectionResult.upperLimit": "上限值",
  "InspectionResult.lowerLimit": "下限值", "InspectionResult.result": "判定结论",
  "InspectionResult.inspectTime": "检验时间",
  "DefectRecord.defectId": "缺陷编号", "DefectRecord.qlotId": "质检批次", "DefectRecord.lotId": "在制批次",
  "DefectRecord.defectType": "缺陷类型", "DefectRecord.severity": "严重度", "DefectRecord.qty": "数量",
  "DefectRecord.description": "缺陷描述", "DefectRecord.foundAt": "发现时间",
  "DefectRecord.processName": "发生工序",

  // ---- 设备执行 / 维修 / 人员 ----
  "EquipmentOEE.oeeId": "OEE记录编号", "EquipmentOEE.equipId": "设备", "EquipmentOEE.lineId": "产线",
  "EquipmentOEE.baseId": "基地", "EquipmentOEE.date": "统计日期", "EquipmentOEE.availability": "可用率",
  "EquipmentOEE.performance": "表现性", "EquipmentOEE.quality": "质量率", "EquipmentOEE.oee": "综合设备效率",
  "EquipmentOEE.plannedProductionTime": "计划生产时间", "EquipmentOEE.actualProductionTime": "实际生产时间",
  "EquipmentDowntime.dtId": "停机编号", "EquipmentDowntime.equipId": "设备",
  "EquipmentDowntime.lineId": "产线", "EquipmentDowntime.baseId": "基地",
  "EquipmentDowntime.startTime": "停机开始", "EquipmentDowntime.endTime": "停机结束",
  "EquipmentDowntime.durationMin": "停机时长", "EquipmentDowntime.reason": "停机原因",
  "EquipmentDowntime.status": "停机状态",
  "EquipmentAlarm.alarmId": "告警编号", "EquipmentAlarm.equipId": "设备", "EquipmentAlarm.lineId": "产线",
  "EquipmentAlarm.alarmCode": "告警代码", "EquipmentAlarm.alarmLevel": "告警级别",
  "EquipmentAlarm.message": "告警内容", "EquipmentAlarm.triggeredAt": "触发时间",
  "EquipmentAlarm.clearedAt": "清除时间", "EquipmentAlarm.status": "告警状态",
  "MaintenanceOrder.moId": "维修工单号", "MaintenanceOrder.equipId": "设备",
  "MaintenanceOrder.lineId": "产线", "MaintenanceOrder.baseId": "基地",
  "MaintenanceOrder.maintType": "维修类型", "MaintenanceOrder.priority": "优先级",
  "MaintenanceOrder.plannedStart": "计划开始", "MaintenanceOrder.plannedEnd": "计划结束",
  "MaintenanceOrder.actualStart": "实际开始", "MaintenanceOrder.actualEnd": "实际结束",
  "MaintenanceOrder.status": "工单状态",
  "SparePartConsumption.consumptionId": "备件消耗编号", "SparePartConsumption.moId": "关联维修工单",
  "SparePartConsumption.partCode": "备件编码", "SparePartConsumption.partName": "备件名称",
  "SparePartConsumption.qtyUsed": "消耗数量", "SparePartConsumption.unit": "计量单位",
  "SparePartConsumption.consumedAt": "消耗时间",
  "OperatorAttendance.attId": "考勤编号", "OperatorAttendance.operatorId": "操作工工号",
  "OperatorAttendance.operatorName": "操作工姓名", "OperatorAttendance.lineId": "产线",
  "OperatorAttendance.baseId": "基地", "OperatorAttendance.date": "日期", "OperatorAttendance.shift": "班次",
  "OperatorAttendance.checkIn": "上班打卡", "OperatorAttendance.checkOut": "下班打卡",
  "OperatorAttendance.hoursWorked": "出勤工时", "OperatorAttendance.status": "考勤状态",
  "OperatorSkillCert.certId": "技能认证编号", "OperatorSkillCert.operatorId": "操作工工号",
  "OperatorSkillCert.skillName": "技能名称", "OperatorSkillCert.skillLevel": "技能等级",
  "OperatorSkillCert.certifiedBy": "认证机构", "OperatorSkillCert.certifiedDate": "认证日期",
  "OperatorSkillCert.expireDate": "失效日期", "OperatorSkillCert.status": "认证状态",
  "ExceptionEvent.excId": "异常事件编号", "ExceptionEvent.excType": "异常类型", "ExceptionEvent.source": "来源",
  "ExceptionEvent.severity": "严重度", "ExceptionEvent.status": "处理状态",
  "ExceptionEvent.refType": "源对象类型", "ExceptionEvent.refId": "源对象主键",
  "ExceptionEvent.summary": "事件摘要", "ExceptionEvent.occurredAt": "发生时间",
  "DataSourceHealth.sourceId": "数据源编号", "DataSourceHealth.name": "数据源名称",
  "DataSourceHealth.critical": "是否关键数据源", "DataSourceHealth.lagHours": "数据时延",

  // ---- 经营 / 计划 / 指标 ----
  "Segment.segKey": "细分编码", "Segment.name": "细分名称", "Segment.gmRate": "毛利率",
  "Segment.baselineShare": "基线份额",
  "DemandSegment.segId": "需求细分编号", "DemandSegment.segment": "细分名称", "DemandSegment.tgt": "目标量",
  "DemandSegment.p50": "需求P50", "DemandSegment.p90": "需求P90", "DemandSegment.act": "实际量",
  "DemandSegment.priceWan": "单价", "DemandSegment.marginPct": "毛利率", "DemandSegment.floorPct": "毛利底线",
  "DemandSegment.businessType": "业务类型",
  "FinancePlan.finId": "财务科目编号", "FinancePlan.line": "科目", "FinancePlan.budget": "预算",
  "FinancePlan.rolling": "滚动预测",
  "Metric.metricId": "指标编号", "Metric.key": "指标键", "Metric.name": "指标名称",
  "Metric.level": "考核周期", "Metric.category": "指标类别", "Metric.target": "目标值",
  "Metric.actual": "实际值", "Metric.floorVal": "底线值", "Metric.unit": "计量单位", "Metric.weight": "权重",
  "Metric.ksfRef": "所属关键成功要素", "Metric.ownerRef": "责任人", "Metric.chainKey": "根因链键",
  "Metric.businessType": "业务类型",
  "KSF.ksfId": "要素编号", "KSF.key": "要素键", "KSF.name": "要素名称", "KSF.sub": "要素说明",
  "Principal.principalId": "责任主体编号", "Principal.name": "名称", "Principal.kind": "主体类型",
  "Principal.parentRef": "上级主体",
  "SopVersionRow.verId": "版本行编号", "SopVersionRow.ver": "版本号", "SopVersionRow.date": "版本日期",
  "SopVersionRow.demand": "需求量", "SopVersionRow.supply": "供给量", "SopVersionRow.note": "备注",
  "SopVersionRow.isFinal": "是否定版",
  "RootCauseChain.chainId": "归因链编号", "RootCauseChain.kpiCategory": "指标类别",
  "RootCauseChain.factor": "根因因子", "RootCauseChain.driverType": "取证对象类型",
  "RootCauseChain.evidenceField": "量化字段", "RootCauseChain.selectField": "叶节点标签字段",
  "RootCauseChain.baseWeight": "基准权重",
  "AnnualScenario.scnId": "情景编号", "AnnualScenario.key": "情景键", "AnnualScenario.name": "情景名称",
  "AnnualScenario.year": "年度", "AnnualScenario.demand": "需求量", "AnnualScenario.note": "备注",
  "AnnualScenario.capacityDecision": "产能决策", "AnnualScenario.ltaLock": "长协锁定",
  "AnnualScenario.revenue": "营业收入", "AnnualScenario.capex": "资本开支", "AnnualScenario.irr": "内部收益率",
  "AnnualScenario.cashCushion": "现金垫", "AnnualScenario.finalized": "是否定稿",
  "AnnualScenario.finalizedAt": "定稿时间",
  "ScenarioTrigger.trigId": "触发条件编号", "ScenarioTrigger.condition": "触发条件",
  "ScenarioTrigger.expr": "判定表达式", "ScenarioTrigger.action": "触发行动",
  "ScenarioTrigger.status": "监控状态", "ScenarioTrigger.triggeredAt": "触发时间",
  "ScenarioTrigger.notifiedTo": "通知对象",
  "PlanTarget.tgtId": "计划目标编号", "PlanTarget.period": "期间", "PlanTarget.level": "期间粒度",
  "PlanTarget.value": "目标值", "PlanTarget.year": "年度", "PlanTarget.scenarioKey": "所属情景",

  // ---- 供应链（对象类型定义在 battery-extended.ts，展示名仍在本表·单源） ----
  "Material.matId": "物料标识", "Material.name": "物料名称", "Material.unitPrice": "单价",
  "Material.leadTime": "到货周期", // ← LEVER「物料·到货周期」
  "Material.onHand": "现货库存", // ← LEVER「物料·现货库存」
  "Material.carbonFactor": "碳排因子", "Material.bomUnit": "BOM单耗", "Material.dailyUse": "日耗用量",
  "Material.inTransit": "在途量", "Material.outsourceYield": "外协良率", "Material.materialCode": "物料编码",
  "Material.category": "物料类别", "Material.spec": "规格型号", "Material.unit": "计量单位",
  "Material.supplierId": "主供应商", "Material.shelfLife": "保质期", "Material.isKeyMaterial": "是否关键物料",
  "Material.status": "物料状态",
  "Supplier.supplierId": "供应商编号", "Supplier.supplierCode": "供应商编码", "Supplier.name": "供应商名称",
  "Supplier.category": "供应类别", "Supplier.materialType": "供应物料类型", "Supplier.rating": "供应商评级",
  "Supplier.region": "所在区域", "Supplier.leadTime": "到货周期", "Supplier.minOrderQty": "最小起订量",
  "Supplier.onTimeRate": "准时交付率", "Supplier.status": "合作状态",
  "Supplier.contractedSupplyTon": "合同供货量", "Supplier.actualSupplyTon": "实际供货量",
  // WO-SANDBOX-D2 采购段责任方维度（清关是否存在 / 在途归谁）
  "Supplier.sourceMode": "供货模式", "Supplier.originCountry": "原产国",
  "Supplier.transitDays": "在途运输天数", "Supplier.carrierName": "承运方",
  "Supplier.deliveryDate": "最近交货日期", "Supplier.poNumber": "最近采购单号",
  "MaterialBatch.batchId": "批次号", "MaterialBatch.matId": "物料", "MaterialBatch.qty": "批次数量",
  "MaterialBatch.ageDays": "库龄天数", "MaterialBatch.idleDays": "呆滞天数",
  "PurchaseOrder.poId": "采购单号", "PurchaseOrder.matId": "物料", "PurchaseOrder.qty": "采购数量",
  "PurchaseOrder.etaDay": "到货天", "PurchaseOrder.delayed": "是否延迟",
  // WO-SANDBOX-D2 采购段四段日戳 + 责任方
  "PurchaseOrder.supplierId": "供应商", "PurchaseOrder.sourceMode": "供货模式",
  "PurchaseOrder.orderDay": "下单天", "PurchaseOrder.shipDay": "发货天", "PurchaseOrder.arriveDay": "到厂天",
  "CustomsClearance.clearanceId": "清关单号", "CustomsClearance.poId": "采购单",
  "CustomsClearance.supplierId": "供应商", "CustomsClearance.portName": "口岸",
  "CustomsClearance.brokerName": "清关行", "CustomsClearance.declaredDay": "申报天",
  "CustomsClearance.clearedDay": "放行天", "CustomsClearance.holdDays": "查验滞留天数",
  "CustomsClearance.status": "清关状态",
  "IncomingInspection.inspectionId": "检验单号", "IncomingInspection.poId": "采购单",
  "IncomingInspection.matId": "物料", "IncomingInspection.inspectorTeam": "检验班组",
  "IncomingInspection.arrivedDay": "到货待检天", "IncomingInspection.releasedDay": "检验放行天",
  "IncomingInspection.sampleQty": "抽检数", "IncomingInspection.defectQty": "不合格数",
  "IncomingInspection.result": "检验结论",
  "LongTermAgreement.ltaId": "长协编号", "LongTermAgreement.supplierId": "供应商",
  "LongTermAgreement.materialType": "物料类型", "LongTermAgreement.contractedQtyTon": "合同量",
  "LongTermAgreement.actualDeliveredTon": "实际交付量", "LongTermAgreement.priceLinked": "是否价格联动",
  "LongTermAgreement.breachPenaltyWan": "违约金", "LongTermAgreement.priceFormula": "价格联动公式",
  "LongTermAgreement.effectiveDate": "生效日期", "LongTermAgreement.expiryDate": "到期日期",
  "BackupSupplierPool.poolId": "备份供应池编号", "BackupSupplierPool.materialType": "物料类型",
  "BackupSupplierPool.memberCount": "在册供应商数", "BackupSupplierPool.certWeeks": "认证周期",
  "BackupSupplierPool.procureFreqPerYear": "年采购频次",
  "CommodityPriceTrend.trendId": "行情记录编号", "CommodityPriceTrend.commodity": "矿产品种",
  "CommodityPriceTrend.weekOf": "所属周", "CommodityPriceTrend.pricePerTon": "吨价",
  "CommodityPriceTrend.pctChange": "环比变动", "CommodityPriceTrend.source": "数据来源",
  "CommodityPriceTrend.spec": "规格", "CommodityPriceTrend.currency": "币种",
  "CarbonFactor.factorId": "碳因子编号", "CarbonFactor.kind": "因子类别",
  "CarbonFactor.key": "关联对象键", "CarbonFactor.factor": "因子值",
  "EnergyMeter.meterId": "计量点编号", "EnergyMeter.baseId": "所属基地",
  "EnergyMeter.processKey": "所属工序", "EnergyMeter.energyPerUnit": "单位产品能耗",
  "EnergyMeter.gridFactor": "电网排放因子",
  "ChangeoverMatrix.pairId": "换型组合编号", "ChangeoverMatrix.fromModel": "换出型号",
  "ChangeoverMatrix.toModel": "换入型号", "ChangeoverMatrix.minutes": "换型分钟数",
  "ChangeoverMatrix.hours": "换型小时数", "ChangeoverMatrix.lineId": "产线",
  "Certification.certId": "认证编号", "Certification.modelId": "型号", "Certification.lineId": "产线",
  "Certification.status": "认证状态", "Certification.certHours": "认证工时",
  "Certification.gapContribution": "可解锁产能", // = 求解器 certification_plan 输出的 unlockCapacity
  "CapexProject.projectId": "投资项目编号", "CapexProject.name": "项目名称",
  "CapexProject.irr": "内部收益率",
  "CapexProject.util24": "24月利用率", // 口径同 capex.ts 注释「24 月利用率」与前端既有标签
  "CapexProject.c23pass": "投资门槛C23是否通过",

  // ---- 商务 / 财务 / 外部信号（CEO 反向归因域·对象类型定义在 battery-extended.ts） ----
  "Customer.custId": "客户编号", "Customer.custName": "客户名称", "Customer.creditLimit": "信用额度",
  "Customer.termDays": "账期天数", "Customer.receivables": "应收余额",
  "Customer.wipUnbilled": "未开票在制金额", "Customer.maxOverdueDays": "最长逾期天数",
  "CustomerLocation.locId": "客户地点编号", "CustomerLocation.customerRef": "所属客户",
  "CustomerLocation.province": "省份", "CustomerLocation.city": "城市",
  "CustomerLocation.address": "详细地址", "CustomerLocation.isDeliveryDefault": "是否默认交付地",
  "CustomerLocation.lon": "经度", "CustomerLocation.lat": "纬度",
  "ARInvoice.invoiceId": "发票编号", "ARInvoice.custName": "客户名称",
  "ARInvoice.amount": "发票金额", "ARInvoice.overdueDays": "逾期天数",
  "ARAging.agingId": "账龄记录编号", "ARAging.customerRef": "客户", "ARAging.bucket": "账龄区间",
  "ARAging.amount": "金额", "ARAging.period": "期间",
  "DSO.dsoId": "周转天数记录编号", "DSO.segment": "细分市场", "DSO.days": "应收周转天数",
  "DSO.period": "期间",
  "OverdueRecord.overdueId": "逾期记录编号", "OverdueRecord.invoiceRef": "关联发票",
  "OverdueRecord.overdueDays": "逾期天数", "OverdueRecord.customerRef": "客户",
  "OverdueRecord.amount": "逾期金额",
  "FinanceAccount.accId": "财务账户编号", "FinanceAccount.baseId": "所属基地",
  "FinanceAccount.cashOnHand": "库存现金", "FinanceAccount.receivable": "应收账款",
  "FinanceAccount.payable": "应付账款", "FinanceAccount.workingCapital": "营运资金",
  "FinanceMetric.metricId": "财务指标编号", "FinanceMetric.scenarioKey": "所属情景",
  "FinanceMetric.cashCushion": "现金垫", "FinanceMetric.irr": "内部收益率",
  "FinanceMetric.capexSpent": "已投资本开支", "FinanceMetric.netMargin": "净利率",
  "GrossMarginBridge.bridgeId": "毛利桥编号", "GrossMarginBridge.lever": "影响杠杆",
  "GrossMarginBridge.segment": "细分市场", "GrossMarginBridge.impactYi": "影响额（亿元）",
  "GrossMarginBridge.driver": "驱动因子", "GrossMarginBridge.period": "期间",
  "CompetitorShare.shareId": "份额记录编号", "CompetitorShare.competitor": "竞争对手",
  "CompetitorShare.segment": "细分市场", "CompetitorShare.sharePct": "市场份额",
  "CompetitorShare.period": "期间",
  "CompetitorPrice.priceId": "竞品价格编号", "CompetitorPrice.competitor": "竞争对手",
  "CompetitorPrice.model": "对标型号", "CompetitorPrice.pricePerKwh": "度电价格",
  "CompetitorPrice.period": "期间",
  "PriceRealization.priceId": "价格实现编号", "PriceRealization.model": "型号",
  "PriceRealization.listPrice": "挂牌价", "PriceRealization.realizedPrice": "实际成交价",
  "PriceRealization.period": "期间",
  "BidRecord.bidId": "竞标编号", "BidRecord.segment": "细分市场", "BidRecord.win": "是否中标",
  "BidRecord.lossReason": "丢标原因", "BidRecord.amount": "竞标金额",
  "BidRecord.competitorRef": "竞争对手",
  "PipelineOpportunity.oppId": "商机编号", "PipelineOpportunity.segment": "细分市场",
  "PipelineOpportunity.stage": "漏斗阶段", "PipelineOpportunity.amount": "商机金额",
  "PipelineOpportunity.winProb": "赢单概率",
  "WinLossRecord.recordId": "赢丢单记录编号", "WinLossRecord.oppId": "关联商机",
  "WinLossRecord.result": "赢丢单结果", "WinLossRecord.reason": "原因", "WinLossRecord.amount": "金额",
  "TriggerRule.triggerId": "触发规则编号", "TriggerRule.signalRef": "关联信号",
  "TriggerRule.op": "比较算子", "TriggerRule.threshold": "触发阈值",
  "TriggerRule.action": "触发行动", "TriggerRule.actionDetail": "行动详情",
  "TriggerRule.cfgRuleKey": "关联规则键",
  "DecisionGap.gapId": "决策缺陷编号", "DecisionGap.kind": "缺陷类别",
  "DecisionGap.description": "缺陷描述", "DecisionGap.severity": "严重度",
  "DecisionGap.ownerRef": "责任人", "DecisionGap.reviewDate": "评审日期",
  "DecisionGap.evidence": "评审证据",
  "CausalFactor.factorId": "因果因子编号", "CausalFactor.label": "因子名称",
  "CausalFactor.drillType": "下钻对象类型", "CausalFactor.drillId": "下钻对象主键",
  "CausalFactor.drillField": "下钻字段", "CausalFactor.kind": "因子类别",
  "CausalFactor.isRoot": "是否根因", "CausalFactor.provenanceSynthetic": "是否合成来源",
  "CausalFactor.metricKey": "所属指标",
  "ExternalSignal.signalKey": "信号键", "ExternalSignal.name": "信号名称",
  "ExternalSignal.category": "信号类别", "ExternalSignal.value": "信号值",
  "ExternalSignal.unit": "计量单位", "ExternalSignal.asOf": "数据日期",
  "ExternalSignal.source": "数据来源", "ExternalSignal.trend": "趋势",
  "ExternalSignal.impact": "影响方向", "ExternalSignal.elasticity": "弹性系数",
  "ExternalSignal.eventRef": "外部事件编号",
};

/**
 * 属性中文业务名解析（`Type.prop` 精确命中；未登记 → undefined = 诚实留白，调用方回落 propKey）。
 * 单一入口：battery.ts 的 withGovernance 与 battery-extended.ts 的 def() 都经此，不留第二份表。
 */
export function propDisplayName(typeKey: string, propKey: string): string | undefined {
  return PROP_DISPLAY_NAMES[`${typeKey}.${propKey}`];
}

/** 给一组 PropertyDef 贴上中文业务名（已自带 displayName 的不覆盖；未登记的保持缺省）。 */
export function withPropDisplayNames(typeKey: string, props: PropertyDef[]): PropertyDef[] {
  return props.map((p) => {
    const zh = p.displayName ?? propDisplayName(typeKey, p.propKey);
    return zh ? { ...p, displayName: zh } : p;
  });
}

/** 治理增量 §3/§4：名称类字段 searchable=true（A3 建议同语义）+ 单位补充。 */
function withGovernance(key: string, props: PropertyDef[]): PropertyDef[] {
  const units: Record<string, Record<string, string>> = {
    // WO-OPT-WHATIF-DATA：openCost/serveCost 显式标口径（R18）——「万元」是 facility_location 目标值的单位，
    // 不标则 Δ目标值在答案里是个没量纲的裸数（同 WO-UNITPRICE-SCALE 的病）。
    Base: { gwh: "GWh", util: "%", openCost: "万元", serveCost: "万元" },
    Model: { unitPrice: "元" },
    // WO-UNITPRICE-SCALE（R18 口径显式标注）：Order.unitPrice 此前**未声明单位**，而同源的
    // Model.unitPrice / OrderLine.unitPrice 都已标 "元" —— 缺声明正是「两处单价看着冲突」的温床。
    // 补齐后 Order.unitPrice 的元/套口径在 propDef 层可自证（消费侧另见 solvers/service.ts orderVal）。
    Order: { qty: "件", unitPrice: "元" },
    Shipment: { qtyTons: "吨" },
  };
  return withPropDisplayNames(key, props).map((p) => {
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
  /** 同 plain，但带类型级 description（`ontology-descriptions:check` 要求 ACTIVE 类型必须有非空描述）。 */
  const plainD = (
    key: string,
    displayName: string,
    description: string,
    properties: PropertyDef[],
  ): Omit<ObjectTypeDef, "id" | "tenantId" | "version" | "status"> => ({ ...plain(key, displayName, properties), description });
  return [
    { key: "Base", displayName: "生产基地", domain: "factory", properties: withGovernance("Base", baseProps), derivedProperties: baseDerived, sourceBindings: BINDINGS.Base ?? [] },
    { key: "Model", displayName: "电池型号", domain: "product", properties: withGovernance("Model", modelProps), derivedProperties: modelDerived, sourceBindings: BINDINGS.Model ?? [] },
    plain("ProductPlatform", "产品平台", productPlatformProps),
    plain("ProductSeries", "产品系列", productSeriesProps),
    plain("ProductVersion", "产品版本", productVersionProps),
    plain("BOMHeader", "BOM主表", bomHeaderProps),
    plain("BOMDetail", "BOM明细", bomDetailProps),
    plain("Routing", "工艺路线", routingProps),
    plain("Operation", "工序定义", operationProps),
    plain("ProcessCapabilityWindow", "工艺能力边界", processCapabilityProps),
    plain("QualityStandard", "质量标准", qualityStandardProps),
    plain("InspectionCharacteristic", "检验特性", inspectionCharacteristicProps),
    plain("ProductLineCapability", "产品产线能力", productLineCapabilityProps),
    plain("ProductEquipmentCapability", "产品设备能力", productEquipmentCapabilityProps),
    plain("EngineeringChange", "工程变更", engineeringChangeProps),
    plain("MaterialAlternative", "物料替代关系", materialAlternativeProps),
    { key: "Order", displayName: "销售订单", domain: "product", properties: withGovernance("Order", orderProps), derivedProperties: orderDerived, sourceBindings: BINDINGS.Order ?? [] },
    // WO-ORDERLINE：订单明细行（SO→型号行·一单多型号多行·紧随 Order·勾稽 Σ行===头）
    plain("OrderLine", "订单明细行", orderLineProps),
    plain("Line", "产线", lineProps),
    plain("Workshop", "车间", workshopProps),
    plain("Process", "工序", processProps),
    plain("Equipment", "设备", equipmentProps),
    plain("MaintPlan", "检修计划", maintPlanProps),
    plain("Segment", "应用细分", segmentProps),
    plain("Shipment", "在途批次", shipmentProps),
    // WO-WAREHOUSE-CUSTLOC：仓库（库存仓位与交付地理落点·factory 域）
    plain("Warehouse", "仓库", warehouseProps),
    // WO-INVENTORY-3TIER：成品库存（qtyAvailable 派生）+ 统一库存流水。
    { key: "FinishedGoodsInventory", displayName: "成品库存", domain: "supply", properties: withGovernance("FinishedGoodsInventory", finishedGoodsInvProps), derivedProperties: finishedGoodsInvDerived, sourceBindings: BINDINGS.FinishedGoodsInventory ?? [] },
    plain("InventoryTxn", "库存流水", inventoryTxnProps),
    // WO-ATP-PROMISE：订单承诺台账（ATP/CTP·净读三源算可承接量+承诺日+瓶颈）
    plain("OrderPromise", "订单承诺", orderPromiseProps),
    // WO-INTERBASE-TRANSFER：跨基地调拨台账（etaDay 派生·R13 可溯真对象）。
    { key: "InterBaseTransfer", displayName: "跨基地调拨", domain: "capacity", properties: withGovernance("InterBaseTransfer", interBaseTransferProps), derivedProperties: interBaseTransferDerived, sourceBindings: BINDINGS.InterBaseTransfer ?? [] },
    plain("DataSourceHealth", "数据源健康度", dataHealthProps),
    plain("AnnualScenario", "年度情景", annualScenarioProps),
    plain("ScenarioTrigger", "情景触发条件", scenarioTriggerProps),
    plain("PlanTarget", "计划目标", planTargetProps),
    // cockpit P1 绿地：经营驾驶舱富 KPI（数字经派生/聚合算出，R14 零写死）。
    plainD("Cadence", "节拍", "全链各环节的**节拍**——「这个环节多久处理一次」。等待期望 = everyDays / 2（均匀到达假设），是推演沙盘里最值钱的一维：实测全链损失里等节拍占比最高的一类。值全部由种子自身的发生序列推导，推不出的诚实标 EMPTY 并给机器可读原因，绝不补 0（0 的语义是「随到随办」，等于把节拍当不存在）。⚠ 与设备节拍 CT（秒/只，单件加工时间）是两个口径，勿混用。", cadenceProps),
    { key: "DemandSegment", displayName: "需求细分", domain: "forecast", properties: withGovernance("DemandSegment", demandSegmentProps), derivedProperties: demandSegmentDerived, sourceBindings: BINDINGS.DemandSegment ?? [] },
    plain("FinancePlan", "财务预算", financePlanProps),
    plain("MaterialBalance", "物料平衡", materialBalanceProps),
    // cockpit P2 + SPINE 绿地：指标库 Metric（gapPct/delta 派生，各视图 KPI 单一出处 R-一致）+ KSF + Principal + 根因归因模板。
    { key: "Metric", displayName: "经营指标", domain: "decision", properties: withGovernance("Metric", metricProps), derivedProperties: metricDerived, sourceBindings: BINDINGS.Metric ?? [] },
    plain("KSF", "关键成功要素", ksfProps),
    plain("Principal", "责任主体", principalProps),
    plain("RootCauseChain", "根因归因链", rootCauseChainProps),
    // WO-ADOPT-MITIGATION：已采纳处置方案台账（adopt_mitigation 执行器落点 → risk_timeline 真曲线消费）。
    // 出厂**无实例**（运行期由 Action 审批写入），故不入 generation/BINDINGS——注册为一等类型使其可查/可下钻/可审计。
    plainD(
      "AdoptedMitigation",
      "已采纳处置方案",
      "风险处置方案的采纳台账：记录「哪个基地的哪个瓶颈因素、采纳了哪个方案、何时生效、削减多少张力」。" +
        "它是 risk_timeline 真曲线的输入——没有这条记录，点了「采纳」曲线也不会动（G-ACTION-NOOP-EXEC）。" +
        "出厂零实例，运行期由 adopt_mitigation 动作审批通过后写入。",
      adoptedMitigationProps,
    ),
    // cockpit P5 / sop 绿地：S&OP 版本演进（gap 派生）。
    { key: "SopVersionRow", displayName: "S&OP版本演进", domain: "plan", properties: withGovernance("SopVersionRow", sopVersionRowProps), derivedProperties: sopVersionRowDerived, sourceBindings: BINDINGS.SopVersionRow ?? [] },
    // Phase 3 MES Domain: Production Planning
    plain("WorkOrder", "生产工单", workOrderProps),
    plain("ProductionSchedule", "生产排程", productionScheduleProps),
    plain("ShiftPlan", "班次计划", shiftPlanProps),
    // Phase 3 MES Domain: WIP Tracking
    plain("WIPLot", "在制批次", wipLotProps),
    plain("WIPMove", "在制移动", wipMoveProps),
    plain("WIPQualityCheckpoint", "在制质检点", wipQualityCheckpointProps),
    // Phase 3 MES Domain: Quality Execution
    plain("QualityLot", "质检批次", qualityLotProps),
    plain("InspectionResult", "检验结果", inspectionResultProps),
    plain("DefectRecord", "缺陷记录", defectRecordProps),
    // Phase 3 MES Domain: Equipment Execution
    plain("EquipmentOEE", "设备OEE", equipmentOEEProps),
    plain("EquipmentDowntime", "设备停机", equipmentDowntimeProps),
    plain("EquipmentAlarm", "设备告警", equipmentAlarmProps),
    // WO-EXCEPTION-EVENT：四源归一异常事件（EquipmentDowntime/Alarm/DefectRecord/TriggerRule/MaterialBalance 聚合投影）
    plain("ExceptionEvent", "异常事件", exceptionEventProps),
    // Phase 3 MES Domain: Maintenance Execution
    plain("MaintenanceOrder", "维修工单", maintenanceOrderProps),
    plain("SparePartConsumption", "备件消耗", sparePartConsumptionProps),
    // Phase 3 MES Domain: Labor Tracking
    plain("OperatorAttendance", "操作工考勤", operatorAttendanceProps),
    plain("OperatorSkillCert", "操作工技能认证", operatorSkillCertProps),
  ];
}

export function batteryLinkTypes(): Omit<LinkTypeDef, "id" | "tenantId" | "version">[] {
  return [
    { key: "model_producible_at", fromTypeKey: "Model", toTypeKey: "Base", cardinality: "N:N" },
    { key: "order_for_model", fromTypeKey: "Order", toTypeKey: "Model", cardinality: "1:N" },
    // §S1.2: certification state lives on the model↔line edge (props.status 量产 | 认证中).
    { key: "model_certified_on", fromTypeKey: "Model", toTypeKey: "Line", cardinality: "N:N" },
    // SA-3：Workshop 车间层链路（Base→Workshop→Line 四层结构）
    // 契约 cardinality 只允许 1:1/1:N/N:N；N:1 语义通过翻转方向表达为 1:N。
    { key: "workshop_belongs_to_base", fromTypeKey: "Base", toTypeKey: "Workshop", cardinality: "1:N" },
    // WO-WAREHOUSE-CUSTLOC：仓库归属基地（Warehouse N:1 Base；契约方向翻转为 Base 1:N Warehouse，参照 workshop_belongs_to_base）
    { key: "warehouse_of_base", fromTypeKey: "Base", toTypeKey: "Warehouse", cardinality: "1:N" },
    { key: "line_belongs_to_workshop", fromTypeKey: "Workshop", toTypeKey: "Line", cardinality: "1:N" },
    // line_belongs_to_base 保留向后兼容（Workshop 层不删旧链路）
    { key: "line_belongs_to_base", fromTypeKey: "Base", toTypeKey: "Line", cardinality: "1:N" },
    // Phase 2：产品域层级链路（ProductPlatform → ProductSeries → Model → ProductVersion → BOM → Routing）
    { key: "series_belongs_to_platform", fromTypeKey: "ProductSeries", toTypeKey: "ProductPlatform", cardinality: "N:1" },
    { key: "model_belongs_to_series", fromTypeKey: "Model", toTypeKey: "ProductSeries", cardinality: "N:1" },
    { key: "version_belongs_to_model", fromTypeKey: "ProductVersion", toTypeKey: "Model", cardinality: "N:1" },
    { key: "bom_belongs_to_version", fromTypeKey: "BOMHeader", toTypeKey: "ProductVersion", cardinality: "N:1" },
    { key: "detail_belongs_to_bom", fromTypeKey: "BOMDetail", toTypeKey: "BOMHeader", cardinality: "N:1" },
    { key: "detail_uses_material", fromTypeKey: "BOMDetail", toTypeKey: "Material", cardinality: "N:1" },
    { key: "routing_belongs_to_model", fromTypeKey: "Routing", toTypeKey: "Model", cardinality: "N:1" },
    { key: "operation_belongs_to_routing", fromTypeKey: "Operation", toTypeKey: "Routing", cardinality: "N:1" },
    { key: "capability_belongs_to_operation", fromTypeKey: "ProcessCapabilityWindow", toTypeKey: "Operation", cardinality: "N:1" },
    // quality
    { key: "standard_belongs_to_model", fromTypeKey: "QualityStandard", toTypeKey: "Model", cardinality: "N:1" },
    { key: "char_belongs_to_standard", fromTypeKey: "InspectionCharacteristic", toTypeKey: "QualityStandard", cardinality: "N:1" },
    // factory/equip
    { key: "product_line_capability", fromTypeKey: "ProductLineCapability", toTypeKey: "Line", cardinality: "N:N" },
    { key: "product_equip_capability", fromTypeKey: "ProductEquipmentCapability", toTypeKey: "Equipment", cardinality: "N:N" },
    // lifecycle
    { key: "change_affects_model", fromTypeKey: "EngineeringChange", toTypeKey: "Model", cardinality: "N:1" },
    // supply（Wave 2：物料替代 + 供应商）
    { key: "alt_for_material", fromTypeKey: "MaterialAlternative", toTypeKey: "Material", cardinality: "N:N" },
    { key: "material_supplied_by", fromTypeKey: "Material", toTypeKey: "Supplier", cardinality: "N:1" },
    { key: "line_has_process", fromTypeKey: "Line", toTypeKey: "Process", cardinality: "1:N" }, // process
    { key: "equip_used_in", fromTypeKey: "Equipment", toTypeKey: "Process", cardinality: "N:N" }, // equip（多设备归一工序）
    { key: "model_uses_material", fromTypeKey: "Model", toTypeKey: "Material", cardinality: "N:N" }, // supply
    // ── WO-P1 · 供应「影响方向」反向边（REQ143 补传导边的地基）──────────────────────────
    // 为什么必须是**新 key** 而不是往上面三条里反向塞行：
    //   上面的 `order_for_model`/`model_uses_material`/`material_supplied_by` 表达的是**归属/FK**
    //   （订单属于哪个型号、型号用哪些料、料的主供是谁），方向是「下游→上游」。
    //   而扰动传导要的是**物流/影响方向**「上游→下游」（供应商断供 → 物料短缺 → 型号缺料 → 订单交不出）。
    //   传导引擎只沿 `fromId→toId` 走（`sim/propagation.ts` navOut），拿归属边跑影响传导必然走反。
    //   实测（`node scripts/…` 全本体盘点）：**没有任何一条边的 toTypeKey 是 Order**——
    //   `promise_for_order`/`line_of_order` 虽指向 Order，但其 from 端 OrderPromise/OrderLine 自身零入边，
    //   ⇒ 不补这三条，供应侧扰动在图上**根本走不到 Order**。
    //   同名 key 反向塞行会违反该 key 自己声明的 fromTypeKey/toTypeKey，并污染既有切片的
    //   `direction:"out"` 遍历，故一律另立 key、与归属边共存互不干扰。
    // 三条边的实例全部由既有对象 FK **确定性反投影**（同一份数据换个方向落），无随机/无时钟 ⇒ R6 同 seed 字节一致。
    { key: "supplier_supplies_material", fromTypeKey: "Supplier", toTypeKey: "Material", cardinality: "1:N" }, // supply（影响向·`material_supplied_by` 之逆）
    { key: "material_used_by_model", fromTypeKey: "Material", toTypeKey: "Model", cardinality: "N:N" }, // supply→product（影响向·`model_uses_material` 之逆）
    { key: "model_demanded_by_order", fromTypeKey: "Model", toTypeKey: "Order", cardinality: "1:N" }, // product→commercial（影响向·`order_for_model` 之逆）
    { key: "order_of_customer", fromTypeKey: "Order", toTypeKey: "Customer", cardinality: "N:N" }, // commercial（多单归一客户）
    // WO-WAREHOUSE-CUSTLOC：客户交付地点归属客户（CustomerLocation N:1 Customer·参照 order_of_customer 方向）
    { key: "custloc_of_customer", fromTypeKey: "CustomerLocation", toTypeKey: "Customer", cardinality: "N:N" }, // commercial（多地点归一客户）
    // 8 域切片增量：补全 supply 深链 / commercial 深链 / 工厂扩展 / 设备-检修 / 产能 / 质量 / 计划 跨域边。
    { key: "model_has_cert", fromTypeKey: "Model", toTypeKey: "Certification", cardinality: "N:N" }, // factory（认证）
    { key: "customer_has_invoice", fromTypeKey: "Customer", toTypeKey: "ARInvoice", cardinality: "N:N" }, // commercial（应收）
    { key: "material_has_batch", fromTypeKey: "Material", toTypeKey: "MaterialBatch", cardinality: "N:N" }, // supply（批次）
    { key: "material_supplied_by_po", fromTypeKey: "Material", toTypeKey: "PurchaseOrder", cardinality: "N:N" }, // supply（采购）
    // WO-SANDBOX-D2：采购段按责任方可分解的三条链路（这一单谁供的 / 谁清的关 / 谁检的货）。
    { key: "po_from_supplier", fromTypeKey: "PurchaseOrder", toTypeKey: "Supplier", cardinality: "N:1" }, // supply（采购责任方）
    { key: "po_customs_cleared_by", fromTypeKey: "PurchaseOrder", toTypeKey: "CustomsClearance", cardinality: "N:1" }, // supply（清关，仅进口单）
    { key: "po_inspected_by", fromTypeKey: "PurchaseOrder", toTypeKey: "IncomingInspection", cardinality: "N:1" }, // quality（到货检验）
    { key: "material_carbon", fromTypeKey: "Material", toTypeKey: "CarbonFactor", cardinality: "N:N" }, // supply（碳因子）
    { key: "base_energy_meter", fromTypeKey: "Base", toTypeKey: "EnergyMeter", cardinality: "N:N" }, // factory（能耗）
    { key: "base_has_shipment", fromTypeKey: "Base", toTypeKey: "Shipment", cardinality: "N:N" }, // capacity（在途）
    // WO-INTERBASE-TRANSFER：跨基地调拨三条链路（调拨→调出基地/调入基地/型号·N:1·下钻到 BASE_REGISTRY 真基地/Model）。
    { key: "transfer_from_base", fromTypeKey: "InterBaseTransfer", toTypeKey: "Base", cardinality: "N:1" }, // capacity（调出）
    { key: "transfer_to_base", fromTypeKey: "InterBaseTransfer", toTypeKey: "Base", cardinality: "N:1" }, // capacity（调入）
    { key: "transfer_of_model", fromTypeKey: "InterBaseTransfer", toTypeKey: "Model", cardinality: "N:1" }, // capacity→product（型号）
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
    // WO-CEO-2 gap_attribution：因果边（果→因·CausalFactor 一等因果链·gap_attribution 引擎遍历·GAP-ATTR）。
    { key: "caused_by", fromTypeKey: "CausalFactor", toTypeKey: "CausalFactor", cardinality: "N:N" }, // decision（因果链）
    { key: "plantarget_ownedby", fromTypeKey: "PlanTarget", toTypeKey: "Principal", cardinality: "N:N" }, // plan→people（责任闭环）
    // Phase 3 MES Domain links
    { key: "wo_for_model", fromTypeKey: "WorkOrder", toTypeKey: "Model", cardinality: "N:1" }, // process
    { key: "wo_on_line", fromTypeKey: "WorkOrder", toTypeKey: "Line", cardinality: "N:1" }, // process
    { key: "sched_for_wo", fromTypeKey: "ProductionSchedule", toTypeKey: "WorkOrder", cardinality: "N:1" }, // process
    { key: "shift_for_line", fromTypeKey: "ShiftPlan", toTypeKey: "Line", cardinality: "N:1" }, // people
    { key: "wip_for_wo", fromTypeKey: "WIPLot", toTypeKey: "WorkOrder", cardinality: "N:1" }, // process
    { key: "wip_on_line", fromTypeKey: "WIPLot", toTypeKey: "Line", cardinality: "N:1" }, // process
    { key: "move_for_lot", fromTypeKey: "WIPMove", toTypeKey: "WIPLot", cardinality: "N:1" }, // process
    { key: "checkpoint_for_lot", fromTypeKey: "WIPQualityCheckpoint", toTypeKey: "WIPLot", cardinality: "N:1" }, // quality
    { key: "qlot_for_wo", fromTypeKey: "QualityLot", toTypeKey: "WorkOrder", cardinality: "N:1" }, // quality
    { key: "result_for_qlot", fromTypeKey: "InspectionResult", toTypeKey: "QualityLot", cardinality: "N:1" }, // quality
    { key: "result_for_char", fromTypeKey: "InspectionResult", toTypeKey: "InspectionCharacteristic", cardinality: "N:1" }, // quality
    { key: "defect_for_qlot", fromTypeKey: "DefectRecord", toTypeKey: "QualityLot", cardinality: "N:1" }, // quality
    { key: "defect_for_wiplot", fromTypeKey: "DefectRecord", toTypeKey: "WIPLot", cardinality: "N:1" }, // quality
    { key: "oee_for_equip", fromTypeKey: "EquipmentOEE", toTypeKey: "Equipment", cardinality: "N:1" }, // equip
    { key: "dt_for_equip", fromTypeKey: "EquipmentDowntime", toTypeKey: "Equipment", cardinality: "N:1" }, // equip
    { key: "alarm_for_equip", fromTypeKey: "EquipmentAlarm", toTypeKey: "Equipment", cardinality: "N:1" }, // equip
    // WO-EXCEPTION-EVENT：异常事件→源对象溯源边（R13·全监听下钻）。toType 为异构（5 源）·代表声明为 EquipmentDowntime，
    // 真实归属由 ExceptionEvent.refType 判别（edge props.refType 落每边真实源类型）。
    { key: "exc_sourced_from", fromTypeKey: "ExceptionEvent", toTypeKey: "EquipmentDowntime", cardinality: "N:1" }, // quality（四源归一溯源）
    { key: "maint_for_equip", fromTypeKey: "MaintenanceOrder", toTypeKey: "Equipment", cardinality: "N:1" }, // equip
    { key: "spare_for_maint", fromTypeKey: "SparePartConsumption", toTypeKey: "MaintenanceOrder", cardinality: "N:1" }, // equip
    { key: "att_for_line", fromTypeKey: "OperatorAttendance", toTypeKey: "Line", cardinality: "N:1" }, // people
    { key: "cert_for_operator", fromTypeKey: "OperatorSkillCert", toTypeKey: "OperatorAttendance", cardinality: "N:1" }, // people
    // WO-INVENTORY-3TIER 库存三层闭环链路（成品库存 → 型号/仓位；流水 → 成品/工单）
    { key: "fg_of_model", fromTypeKey: "FinishedGoodsInventory", toTypeKey: "Model", cardinality: "N:1" }, // supply
    { key: "fg_at_warehouse", fromTypeKey: "FinishedGoodsInventory", toTypeKey: "Warehouse", cardinality: "N:1" }, // supply→factory
    { key: "txn_for_fg", fromTypeKey: "InventoryTxn", toTypeKey: "FinishedGoodsInventory", cardinality: "N:1" }, // supply
    { key: "txn_from_wo", fromTypeKey: "InventoryTxn", toTypeKey: "WorkOrder", cardinality: "N:1" }, // supply→process（完工入库溯源）
    // WO-ATP-PROMISE 订单承诺链路（承诺台账 → 订单·一订单一承诺 N:1）
    { key: "promise_for_order", fromTypeKey: "OrderPromise", toTypeKey: "Order", cardinality: "N:1" }, // commercial（承诺溯源到订单）
    // WO-ORDERLINE 订单拆行链路（明细行 → 订单·一订单 N 行 N:1 · 明细行 → 型号·N:1）
    { key: "line_of_order", fromTypeKey: "OrderLine", toTypeKey: "Order", cardinality: "N:1" }, // product（行溯源到订单头）
    { key: "orderline_for_model", fromTypeKey: "OrderLine", toTypeKey: "Model", cardinality: "N:1" }, // product（行→型号·一单多型号真表达）
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
            { linkKey: "line_belongs_to_base", direction: "out", project: ["lineId", "baseId", "name"] },
            { linkKey: "line_has_process", direction: "out", project: ["processId", "name", "kind", "yield", "utilization"] },
            { linkKey: "equip_used_in", direction: "in", project: ["equipId", "processId", "ctSeconds", "availFactor", "oeeA", "oeeP", "oeeQ"] },
          ],
          // product → factory（经 Workshop 层）→ Line：SA-3 Base→Workshop→Line 四层可达
          [
            { linkKey: "order_for_model", direction: "out" },
            { linkKey: "model_producible_at", direction: "out" },
            { linkKey: "workshop_belongs_to_base", direction: "out", project: ["workshopId", "baseId", "name", "processType"] },
            { linkKey: "line_belongs_to_workshop", direction: "out", project: ["lineId", "baseId", "name"] },
          ],
          // product → supply（型号 BOM 物料）
          [
            { linkKey: "order_for_model", direction: "out" },
            { linkKey: "model_uses_material", direction: "out", project: ["matId", "name", "unitPrice", "leadTime", "carbonFactor", "onHand"] },
          ],
          // commercial（下单客户信用画像）
          [{ linkKey: "order_of_customer", direction: "out", project: ["custId", "custName", "creditLimit", "termDays", "receivables", "maxOverdueDays"] }],
        ],
        maxNodes: 600,
        contractFixtures: [
          {
            name: "首单全链可达 6 域",
            args: { so: "SO-3391" },
            expect: {
              rootType: "Order",
              minNodes: 10,
              mustIncludeTypes: ["Order", "Model", "Base", "Workshop", "Line", "Process", "Equipment", "Material", "Customer"],
              mustIncludeLinkKeys: ["order_for_model", "model_producible_at", "workshop_belongs_to_base", "line_belongs_to_workshop", "line_has_process", "equip_used_in", "model_uses_material", "order_of_customer"],
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
            { linkKey: "line_belongs_to_base", direction: "out", project: ["lineId", "name"] },
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
            { linkKey: "line_belongs_to_base", direction: "out", project: ["lineId", "name"] },
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
  // WO-RULES-CLASSIFY：每条规则授予业务类别 category（产能/物料/财务/合规/换型/认证/外协/质量/需求/排产/规划）——
  // 规则库分类筛选与「约束条件」独立入口的真元数据单一来源（前端只读渲染，非写死清单；约束条件另按 severity=BLOCK 判别）。
  // G-10 P4：规则数组已上提为 `BATTERY_RULES`（本文件顶部，定义在 BATTERY_SOLVER_PARAMS 之前），
  // 因为推演系数要从它派生（`ruleParamOf`）——规则是阈值的单一上游真源，不是 solver_params 的副本。
  rules: BATTERY_RULES,
  // scenarioSeed.views 单一来源 = view-manifest.SEEDED_VIEW_KEYS（BUILTIN_VIEWS.filter(seed)·防第 4 处漂移·
  // 现含 global-sim：此前手维护此处漏接 → 内存态重启后「全局推演」隐身·WO-MEMORY-VIEW-RESILIENCE §4.2）。
  scenarioSeed: { views: [...SEEDED_VIEW_KEYS], intents: [] },
  features: [...ALL_FEATURE_KEYS],
  solverParams: BATTERY_SOLVER_PARAMS,
  // A8.6 §6.1 — measureField/weightField are battery-pack extensions consumed by the generator.
  tsGenerators: [
    { seriesKey: "oee:equip", entityType: "Equipment", grain: "day", base: { mean: 0.78, noise: 0.04 }, effects: ["maint_window_dip", "weekend_dip"], measureField: "oee", weightField: "output" },
    { seriesKey: "yield:process", entityType: "Process", grain: "day", base: { mean: 0.952, noise: 0.008 }, effects: ["maint_window_dip"], measureField: "yield" },
    { seriesKey: "output:line", entityType: "Line", grain: "day", base: { mean: OUTPUT_LINE_BASE_MEAN, noise: 1800 }, drift: 8, effects: ["weekend_dip", "maint_window_dip", "ramp_curve"], measureField: "output" },
    { seriesKey: "attainment:line", entityType: "Line", grain: "day", base: { mean: 0.914, noise: 0.02 }, measureField: "attainment" },
    { seriesKey: "util:line", entityType: "Line", grain: "day", base: { mean: 92, noise: 1.2 }, effects: ["maint_window_dip"], measureField: "util" },
    // CL.5（PRD-attainment-base-daily-timeseries）：基地级日达成率序列——"本月逐日为何未达成"时间维度归因
    // 所需（现仅 attainment:line 产线级 + schedule_attainment 周聚合）。day grain、含检修/周末/爬坡剧本，
    // 达成率口径 = 实际/目标（与 Metric achievement 同源）。末位追加，保前序列 R6 字节一致。
    { seriesKey: "attainment:base", entityType: "Base", grain: "day", base: { mean: 0.918, noise: 0.018 }, effects: ["maint_window_dip", "weekend_dip", "ramp_curve"], measureField: "attainment" },
  ],
  scenarioScript: [
    { tick: 3, event: "iot_delay", params: { lagHours: 4.2 } },
    { tick: 5, event: "shipment_delay", params: { baseId: baseIdOf("常州"), days: 5 } },
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
  // 增量 §7.13：项目推演 what-if「采纳产能保障方案」（payload = 动态杠杆组合 + 推演快照）。
  // WO-LEVER-ADOPT-DRIFT：前端已从「焊死 3 系数 whatIf」迁到「动态杠杆组合 levers[{objectType,objectId,prop,value}]」
  // （见 DynamicLeverPanel.adoptCombo「替原 whatIf 三系数」）；schema 随之改 required whatIf→levers（否则采纳恒
  // 报 `payload.whatIf is required` 假阴）。whatIf 保留为可选属性（向后兼容旧草稿·不再必填）。
  {
    key: "采纳产能保障方案",
    name: "采纳产能保障方案",
    paramsSchema: {
      type: "object",
      required: ["modelId", "levers"],
      properties: { modelId: { type: "string" }, levers: { type: "array" }, whatIf: { type: "object" }, snapshot: { type: "object" } },
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
  // OntoFlow（PRD v2 P3）流水线发布物化：审批通过后把样例/上传 rows 经数据处理折叠成对象落库
  // （origin=PIPELINE），坏行入隔离区。真值写入门控。嫁接自 main 平行线。
  {
    key: "流水线发布物化",
    name: "流水线发布物化",
    paramsSchema: {
      type: "object",
      required: ["workflowId", "nodeId", "rows"],
      properties: { workflowId: { type: "string" }, nodeId: { type: "string" }, rows: { type: "array" } },
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
  C24: ["Order", "DemandSegment"], // WO-RC1: 前向闭合修——scope 归真实类型 Order（marginPct/floorPct 与 Quote 命名空间同值·镜像 C15）·Quote 仅 eval 期注入命名空间非本体对象类型（沙盘 cert 前向闭合硬前置）
  C25: ["ExternalSignal"],
};

export interface GeneratedBattery {
  bases: Record<string, unknown>[];
  models: Record<string, unknown>[];
  orders: Record<string, unknown>[];
  productPlatforms: Record<string, unknown>[];
  productSeries: Record<string, unknown>[];
  productVersions: Record<string, unknown>[];
  bomHeaders: Record<string, unknown>[];
  bomDetails: Record<string, unknown>[];
  routings: Record<string, unknown>[];
  operations: Record<string, unknown>[];
  processCapabilities: Record<string, unknown>[];
  qualityStandards: Record<string, unknown>[];
  inspectionCharacteristics: Record<string, unknown>[];
  productLineCapabilities: Record<string, unknown>[];
  productEquipmentCapabilities: Record<string, unknown>[];
  engineeringChanges: Record<string, unknown>[];
  materialAlternatives: Record<string, unknown>[];
  workshops: Record<string, unknown>[];
  lines: Record<string, unknown>[];
  processes: Record<string, unknown>[];
  equipment: Record<string, unknown>[];
  maintPlans: Record<string, unknown>[];
  segments: Record<string, unknown>[];
  shipments: Record<string, unknown>[];
  // WO-WAREHOUSE-CUSTLOC：仓库（每基地 N 仓·库存仓位落点）
  warehouses: Record<string, unknown>[];
  /** WO-INTERBASE-TRANSFER：跨基地调拨台账（一等对象·可查/可溯·R13）。 */
  interBaseTransfers: Record<string, unknown>[];
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
  // Phase 3 MES Domain
  workOrders: Record<string, unknown>[];
  productionSchedules: Record<string, unknown>[];
  shiftPlans: Record<string, unknown>[];
  wipLots: Record<string, unknown>[];
  wipMoves: Record<string, unknown>[];
  wipQualityCheckpoints: Record<string, unknown>[];
  qualityLots: Record<string, unknown>[];
  inspectionResults: Record<string, unknown>[];
  defectRecords: Record<string, unknown>[];
  equipmentOEEs: Record<string, unknown>[];
  equipmentDowntimes: Record<string, unknown>[];
  equipmentAlarms: Record<string, unknown>[];
  // WO-EXCEPTION-EVENT：四源归一异常事件（本地 4 源投影；trigger 源在 service 层合并·见 projectExceptionEvents）。
  exceptionEvents: Record<string, unknown>[];
  maintenanceOrders: Record<string, unknown>[];
  sparePartConsumptions: Record<string, unknown>[];
  operatorAttendances: Record<string, unknown>[];
  operatorSkillCerts: Record<string, unknown>[];
  // WO-INVENTORY-3TIER：成品库存 + 库存流水（完工入库确定性派生）
  finishedGoodsInv: Record<string, unknown>[];
  inventoryTxns: Record<string, unknown>[];
  // WO-ATP-PROMISE：订单承诺台账（对每 OPEN 订单确定性算 ATP 基线）
  orderPromises: Record<string, unknown>[];
  // WO-ORDERLINE：订单明细行（SO→型号行·一单多型号多行·勾稽 Σ行===头·additive 不动 24 单头级基线）
  orderLines: Record<string, unknown>[];
}

const SERIAL_STEPS = [
  { suffix: "coating", name: "涂布" },
  { suffix: "winding", name: "卷绕" },
  { suffix: "assembly", name: "装配" },
];

// SA-3：10 车间定义（制浆→PACK），Workshop 为 Base 与 Line 之间新增层
const WORKSHOP_DEFS = WORKSHOP_REGISTRY.map((w) => ({ type: w.type, suffix: w.suffix })); // 单源见 contracts/base-registry.ts

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 完工工单状态（供完工入库派生判定；WorkOrder.status 枚举中的"已完工"口径）。 */
const COMPLETED_WO_STATUSES = new Set(["已完成", "已关闭"]);

/**
 * WO-INVENTORY-3TIER · 完工入库派生（确定性·非事件后处理·R6）。
 *
 * 遍历已完工 WorkOrder（status∈{已完成,已关闭} 且 qtyActual>0）→ 每单产一条 InventoryTxn{RECEIPT,qty:+qtyActual}
 * 并把该 model×warehouse 的 FinishedGoodsInventory.qtyOnHand += qtyActual。
 * 勾稽铁律：FG.qtyOnHand = Σ该 model×warehouse RECEIPT.qty − Σ ISSUE.qty（本切片仅 RECEIPT，故 = Σ RECEIPT）。
 * SEAM 铁律：改 WorkOrder.qtyActual → RECEIPT.qty 与 FG.qtyOnHand 同步变（KILL-MOCK-RED）。
 *
 * @param finishedWhByBase baseId → 成品仓 warehouseId（whType=FINISHED；WO-WAREHOUSE 每基地必有）
 * 纯函数：无 random / 无时钟；FG 键按 fgId 稳定排序、Txn 按入参 workOrders 顺序 → 字节一致。
 */
export function deriveFinishedGoodsIntake(
  workOrders: Record<string, unknown>[],
  finishedWhByBase: Map<string, string>,
  asOf: string,
): { finishedGoodsInv: Record<string, unknown>[]; inventoryTxns: Record<string, unknown>[] } {
  const fgMap = new Map<string, { fgId: string; model: string; warehouseId: string; qtyOnHand: number; qtyReserved: number; asOf: string }>();
  const inventoryTxns: Record<string, unknown>[] = [];
  for (const wo of workOrders) {
    const status = String(wo.status ?? "");
    const qtyActual = Number(wo.qtyActual ?? 0);
    if (!COMPLETED_WO_STATUSES.has(status) || qtyActual <= 0) continue;
    const modelId = String(wo.modelId ?? "");
    const baseId = String(wo.baseId ?? "");
    const warehouseId = finishedWhByBase.get(baseId);
    if (!warehouseId) continue; // 无成品仓（理论不发生：每基地必有 FINISHED 仓）→ 诚实跳过不臆造
    const fgId = `FG-${modelId}-${warehouseId}`;
    let fg = fgMap.get(fgId);
    if (!fg) {
      fg = { fgId, model: modelId, warehouseId, qtyOnHand: 0, qtyReserved: 0, asOf };
      fgMap.set(fgId, fg);
    }
    fg.qtyOnHand += qtyActual;
    inventoryTxns.push({
      txnId: `TXN-RCPT-${String(wo.woId)}`,
      txnType: "RECEIPT",
      fgRef: fgId,
      woRef: String(wo.woId),
      qty: qtyActual, // 带正负：入库为正
      fromWarehouse: "",
      toWarehouse: warehouseId,
      refDoc: String(wo.moNo ?? wo.woId),
      occurredAt: String(wo.endDate ?? asOf),
    });
  }
  const finishedGoodsInv = [...fgMap.values()]
    .sort((a, b) => (a.fgId < b.fgId ? -1 : a.fgId > b.fgId ? 1 : 0))
    .map((f) => ({ fgId: f.fgId, model: f.model, warehouseId: f.warehouseId, qtyOnHand: f.qtyOnHand, qtyReserved: f.qtyReserved, asOf: f.asOf }));
  return { finishedGoodsInv, inventoryTxns };
}

// ──────────────────────────────────────────────────────────────────────────
// WO-ATP-PROMISE · 订单承诺（ATP/CTP）净室核心算法（数据半 seed 与引擎半 atp_check 单一口径）。
// ──────────────────────────────────────────────────────────────────────────

/** 完工工单状态集合（完工单 qtyActual 已入库 FG，故在制未交源须排除完工单，避免双算）。 */
const ATP_COMPLETED_WO_STATUSES = COMPLETED_WO_STATUSES;

const DAY_MS_ATP = 86400000;
const atpNum = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/** atp_check 三源供给输入（纯对象·仓储 props 与生成数组两侧同结构喂入·净读无副作用）。 */
export interface AtpSupplyInputs {
  finishedGoodsInv: Record<string, unknown>[]; // 读 model / qtyOnHand / qtyReserved
  workOrders: Record<string, unknown>[]; // 读 modelId / qtyActual / status
  lines: Record<string, unknown>[]; // 读 baseId / max_capacity_day
}

/** 单订单 ATP 计算结果（committableQty = Σbreakdown·shortfall = requested − committable·勾稽）。 */
export interface OrderPromiseResult {
  requestedQty: number;
  committableQty: number;
  promiseDate: string | null;
  atpStatus: "CONFIRMED" | "PARTIAL" | "UNMET";
  shortfallQty: number;
  bottleneck: "产能" | "库存" | "物料" | "齐套" | null;
  breakdown: { source: "现货" | "在制" | "排产"; qty: number }[];
  // 诊断字段（承诺卡口透明化·供 solver summary 与测试断言）
  onHand: number;
  wip: number;
  dailyCapacity: number;
  dueDay: number;
}

/**
 * 净室 ATP：对单订单读三源供给算「能不能接、何时交」（纯函数·无 random/时钟·R6）。
 *  ① 现货 onHand   = Σ 可用成品库存（qtyOnHand − qtyReserved，≥0）·按 model 匹配
 *  ② 在制 wip      = Σ 未完工工单 qtyActual（完工单已入 FG 故排除）·按 modelId 匹配
 *  ③ 排产 capacity = Σ 可产产线 max_capacity_day × 交期前净生产窗口天（baseId ∈ 订单可产基地）
 * committableQty = min(requestedQty, onHand + wip + 交期前可排产能)；
 * promiseDate    = 满足全量最早日（现货即 asOf；需排产则按日产能累加到齐量日；不可产 → null）；
 * atpStatus/bottleneck/shortfall 诚实透出卡在哪源。
 * SEAM 铁律：改 Line.max_capacity_day（产能）或 FG.qtyOnHand（库存）→ committableQty/promiseDate 真变。
 */
export function computeOrderPromise(
  order: { model: unknown; qty: unknown; due: unknown; bases: unknown },
  supply: AtpSupplyInputs,
  asOf: string,
): OrderPromiseResult {
  const model = String(order.model ?? "");
  const requestedQty = Math.max(0, atpNum(order.qty));
  const orderBases = Array.isArray(order.bases) ? (order.bases as unknown[]).map(String) : [];

  // ① 现货（可用成品库存·按 model）
  const onHand = supply.finishedGoodsInv
    .filter((f) => String(f.model ?? "") === model)
    .reduce((s, f) => s + Math.max(0, atpNum(f.qtyOnHand) - atpNum(f.qtyReserved)), 0);

  // ② 在制未交（未完工工单 qtyActual·按 modelId·排除完工单避免双算）
  const wip = supply.workOrders
    .filter((w) => String(w.modelId ?? "") === model && !ATP_COMPLETED_WO_STATUSES.has(String(w.status ?? "")) && atpNum(w.qtyActual) > 0)
    .reduce((s, w) => s + atpNum(w.qtyActual), 0);

  // ③ 交期前可排产能（可产产线日产能 × 交期前净生产窗口天）
  const dailyCapacity = supply.lines
    .filter((l) => orderBases.length > 0 && orderBases.includes(String(l.baseId ?? "")))
    .reduce((s, l) => s + Math.max(0, atpNum(l.max_capacity_day)), 0);
  const asOfMs = Date.parse(`${asOf.slice(0, 10)}T00:00:00Z`);
  const dueMs = Date.parse(`${String(order.due ?? "").slice(0, 10)}T00:00:00Z`);
  const dueDay = Number.isFinite(dueMs) ? Math.max(0, Math.round((dueMs - asOfMs) / DAY_MS_ATP)) : 0;
  const capBeforeDue = dailyCapacity * dueDay;

  // 三源按 现货→在制→排产 顺序填满需求（committableQty = Σbreakdown·勾稽）
  const onHandUsed = Math.min(onHand, requestedQty);
  const wipUsed = Math.min(wip, Math.max(0, requestedQty - onHandUsed));
  const capUsed = Math.min(capBeforeDue, Math.max(0, requestedQty - onHandUsed - wipUsed));
  const committableQty = onHandUsed + wipUsed + capUsed;
  const shortfallQty = Math.max(0, requestedQty - committableQty);

  // 满足全量最早日：现货+在制够即 asOf；否则按日产能累加到齐量日（可超交期）；无可排产能 → null
  const neededFromProduction = Math.max(0, requestedQty - onHand - wip);
  let promiseDate: string | null;
  if (neededFromProduction <= 0) {
    promiseDate = asOf;
  } else if (dailyCapacity > 0) {
    const daysNeeded = Math.ceil(neededFromProduction / dailyCapacity);
    promiseDate = isoDate(asOfMs + daysNeeded * DAY_MS_ATP);
  } else {
    promiseDate = null; // 无可产产线 → 全量承诺日不可期
  }

  // 状态：全量按期(CONFIRMED) / 部分(PARTIAL) / 交期前几无(UNMET)
  const atpStatus: OrderPromiseResult["atpStatus"] =
    shortfallQty <= 0 ? "CONFIRMED" : committableQty > 0 ? "PARTIAL" : "UNMET";
  // 卡口：有缺口才透出——有可产产线→产能不足；无可产产线→无从排产（齐套/产线缺）
  const bottleneck: OrderPromiseResult["bottleneck"] =
    shortfallQty <= 0 ? null : dailyCapacity > 0 ? "产能" : "齐套";

  const breakdown: OrderPromiseResult["breakdown"] = [
    { source: "现货", qty: round(onHandUsed, 0) },
    { source: "在制", qty: round(wipUsed, 0) },
    { source: "排产", qty: round(capUsed, 0) },
  ];

  return {
    requestedQty,
    committableQty: round(committableQty, 0),
    promiseDate,
    atpStatus,
    shortfallQty: round(shortfallQty, 0),
    bottleneck,
    breakdown,
    onHand: round(onHand, 0),
    wip: round(wip, 0),
    dailyCapacity: round(dailyCapacity, 0),
    dueDay,
  };
}

/**
 * WO-ATP-PROMISE · 订单承诺台账种子（对每张 OPEN 订单产一条基线 OrderPromise·与 atp_check 同口径）。
 * 纯派生：无 rng（不插既有 rng 流中间→字节流不变 R6）、无时钟（asOf 取固定 T0）。
 * promiseId 由订单号确定性派生（AP-<so>）。
 */
export function deriveOrderPromises(
  orders: Record<string, unknown>[],
  finishedGoodsInv: Record<string, unknown>[],
  workOrders: Record<string, unknown>[],
  lines: Record<string, unknown>[],
  asOf: string,
): Record<string, unknown>[] {
  const supply: AtpSupplyInputs = {
    finishedGoodsInv: finishedGoodsInv.map((f) => ({ model: f.model, qtyOnHand: f.qtyOnHand, qtyReserved: f.qtyReserved })),
    workOrders: workOrders.map((w) => ({ modelId: w.modelId, qtyActual: w.qtyActual, status: w.status })),
    lines: lines.map((l) => ({ baseId: l.baseId, max_capacity_day: l.max_capacity_day })),
  };
  const out: Record<string, unknown>[] = [];
  for (const o of orders) {
    if (String(o.status ?? "") !== "OPEN") continue; // 仅 OPEN 订单需承诺
    const r = computeOrderPromise({ model: o.model, qty: o.qty, due: o.due, bases: o.bases }, supply, asOf);
    out.push({
      promiseId: `AP-${String(o.so)}`,
      orderRef: String(o.so),
      model: String(o.model ?? ""),
      requestedQty: r.requestedQty,
      committableQty: r.committableQty,
      promiseDate: r.promiseDate,
      atpStatus: r.atpStatus,
      shortfallQty: r.shortfallQty,
      bottleneck: r.bottleneck,
      asOf,
    });
  }
  return out;
}

/**
 * WO-ORDERLINE · 订单拆行种子（SO→型号明细行·一单多型号多行·Phase3）。
 * 确定性拆行（独立哈希子流 `hashString("oline_"+so)`·**不插既有 order rng 流中间**→24 单头级字节基线不移 R6）：
 *  - so 哈希偶数 → 拆 2-3 行到**不同 model**（首行保原单 model·不破坏既有 order_for_model 与 24 单基线·additive）；奇数 → 1 行。
 *  - **勾稽铁律** `Σ OrderLine.qty (BY orderRef) === Order.qty`（拆行不改总量·确定性比例分配·**尾行取余额保 Σ 精确**·仿 WO-Q7 末叶取余额）。
 *  - `lineStatus` 种子基线态（`STATUSES[(h+i)%4]`·连续行 i 必不同态→一单多行天然多态·**行级独立态**）。
 *  - `unitPrice` 按行 model 反范式化（`Model.unitPrice` 单一来源·守 R14·勿写死）。
 * 纯派生：无 rng（不插 rng 流）、无时钟（due 继承订单头）。lineId=`<so>-L<lineNo>`。
 */
export function deriveOrderLines(
  orders: Record<string, unknown>[],
  models: Record<string, unknown>[],
): Record<string, unknown>[] {
  const STATUSES = ["OPEN", "COMMITTED", "PARTIAL", "SHIPPED"] as const;
  const modelIds = models.map((m) => String(m.modelId));
  const priceOf = new Map(models.map((m) => [String(m.modelId), Number(m.unitPrice ?? 0)]));
  const out: Record<string, unknown>[] = [];
  for (const o of orders) {
    const so = String(o.so);
    const m0 = String(o.model ?? "");
    const totalQty = Number(o.qty ?? 0);
    const h = hashString(`oline_${so}`);
    // 拆行数：偶数 → 2-3 行（不同型号）· 奇数 → 1 行（确定性）。
    const nLines = h % 2 === 0 ? 2 + (Math.floor(h / 4) % 2) : 1;
    // 型号池：首行保原单 model·其余从型号池按 so 哈希旋转取 distinct（一单多型号真表达）。
    const lineModels: string[] = [m0];
    if (nLines > 1 && modelIds.length > 0) {
      const rot = h % modelIds.length;
      for (let k = 0; k < modelIds.length && lineModels.length < nLines; k++) {
        const mid = modelIds[(rot + k) % modelIds.length] as string;
        if (!lineModels.includes(mid)) lineModels.push(mid);
      }
    }
    const realN = lineModels.length; // 型号池不足时可能 < nLines（诚实）
    // qty 确定性比例分配（权重 hash 派生）·尾行取余额保 Σ 精确。
    const weights = lineModels.map((_, i) => 1 + (hashString(`${so}-L${i + 1}_w`) % 100));
    const W = weights.reduce((a, b) => a + b, 0);
    let allocated = 0;
    for (let i = 0; i < realN; i++) {
      const lineNo = i + 1;
      const lm = lineModels[i] as string;
      // 尾行取余额（Σ 精确）；非尾行按权重 floor 分配（≥1·totalQty 千级不会分光）。
      const qty = i === realN - 1 ? totalQty - allocated : Math.max(1, Math.floor((totalQty * (weights[i] as number)) / W));
      allocated += qty;
      out.push({
        lineId: `${so}-L${lineNo}`,
        orderRef: so,
        lineNo,
        model: lm,
        qty,
        due: o.due,
        lineStatus: STATUSES[(h + i) % 4],
        unitPrice: priceOf.get(lm) ?? Number(o.unitPrice ?? 0),
      });
    }
  }
  return out;
}

/**
 * Deterministic generation: master data (Base) → Model → Order → production
 * topology (Line/Process/Equipment) → calendars (MaintPlan/Shipment) → misc.
 * Referential integrity by construction; same seed → byte-identical output.
 */
export function generateBattery(seed: number, scale: "S" | "M" | "L" | "XL"): GeneratedBattery {
  const rng = mulberry32(seed);
  // HTML 24 单为语义基底 → 订单数下限 24（小规模即 24 单；M/L/XL 用 rng 补足到目标）。
  const orderCount = Math.max(24, scale === "S" ? 20 : scale === "M" ? 300 : scale === "XL" ? 10000 : 825);
  const t0 = Date.parse(`${BATTERY_SOLVER_PARAMS.forecastStart as string}T00:00:00Z`);

  const bases = BASES.map((b) => {
    // Wave 1 (#59)：产能指标从 BASE_REGISTRY 单一来源派生，消灭随机值与边界册漂移（G-5/R14）。
    // 保留原 rng() 调用以维持下游订单/拓扑字节流不变（R6）。
    void rng();
    void rng();
    void rng();
    return {
      baseId: b.baseId,
      name: b.name,
      kind: b.kind,
      position: b.kind, // GeoMap 按 position 着色（动力/储能）
      lon: b.lon,
      lat: b.lat,
      util: b.util,
      bottleneck: b.bottleneck,
      gwh: b.gwh,
      formationCapDaily: 0, // filled after process generation (shared-resource cap)
      agingCapDaily: 0,
      // SA-4：factory 台账字段（R12 全建模对齐，确定性映射守 R6）
      factory_code: `${b.baseId.slice(0, 2).toUpperCase()}01`,
      province: ({ changzhou: "江苏", xiamen: "福建", chengdu: "四川", meishan: "四川", wuhan: "湖北", jiangmen: "广东", hefei: "安徽", xinyang: "河南", zaozhuang: "山东", handan: "河北", zigong: "四川", jinhua: "浙江", yangzhou: "江苏" } as Record<string, string>)[b.baseId] ?? b.baseId,
      city: b.name,
      factory_type: b.kind === "动力+储能" ? "CELL+PACK" : b.kind === "动力" ? "CELL" : "PACK",
      status: "运营中",
      start_date: ({ changzhou: "2015-06-01", xiamen: "2019-03-01", chengdu: "2021-08-01", meishan: "2022-01-01", wuhan: "2020-05-01", jiangmen: "2021-03-01", hefei: "2023-01-01", xinyang: "2022-06-01", zaozhuang: "2023-06-01", handan: "2022-09-01", zigong: "2021-11-01", jinhua: "2023-09-01", yangzhou: "2022-04-01" } as Record<string, string>)[b.baseId] ?? "2020-01-01",
      // WO-OPT-WHATIF-DATA · 选址决策成本：**纯派生·零 rng 消耗**（照 WO-CEO-DATA-2 Equipment.oee_current 路子）。
      // 入参 gwh/lines 取自 BASE_REGISTRY（DF.1 单一来源）、距离走 baseDistanceKm（haversine 同一册）——
      // 不抽新随机数 ⇒ rng 消耗序列一字不动 ⇒ 下游订单/拓扑合成值零位移（R6 字节一致）。
      // 末位追加，故 props 键序（→ RawDataset.fields 序）前序不动。
      openCost: baseOpenCostWan(b.gwh, b.lines),
      serveCost: baseServeCostWan(b.baseId),
    };
  });

  // WO-WAREHOUSE-CUSTLOC：每基地 N 仓（成品仓 FINISHED 必有·供 WO-INVENTORY FG 挂位；原料仓 RAW 必有；
  // 中转仓 TRANSIT 由确定性哈希决定有无 → 2~3 仓/基地）。独立 hashString 子流·不消耗 rng（不插既有流中间→
  // 守 R6 字节基线·下游合成值零位移）。省市从生成态 bases 派生（base.province/base.city 源 BASE_REGISTRY，
  // 守 boundary-singlesource·不内联基地字面量）。
  const WH_TYPE_LABEL: Record<string, string> = { RAW: "原料", FINISHED: "成品", TRANSIT: "中转" };
  const warehouses = bases.flatMap((b) => {
    const whTypes = ["RAW", "FINISHED"]; // 成品仓 FINISHED + 原料仓 RAW 每基地必有
    if (hashString(`wh_transit_${b.baseId}`) % 2 === 0) whTypes.push("TRANSIT"); // 确定性第三仓
    return whTypes.map((whType) => ({
      warehouseId: `WH-${b.baseId}-${whType}`,
      baseId: b.baseId,
      name: `${b.city}${WH_TYPE_LABEL[whType]}仓`,
      whType,
      capacityUnits: 5000 + (hashString(`wh_cap_${b.baseId}_${whType}`) % 45000),
      province: b.province,
      city: b.city,
    }));
  });

  // Phase 2 Wave 1：产品域基础（ProductPlatform / ProductSeries / ProductVersion）
  const productPlatforms = [
    { platformId: "PLAT-001", platformCode: "LFP-Platform", name: "LFP 平台", category: "LFP", description: "磷酸铁锂产品平台", status: "活跃" },
    { platformId: "PLAT-002", platformCode: "NCM-Platform", name: "三元平台", category: "三元", description: "三元锂产品平台", status: "活跃" },
    { platformId: "PLAT-003", platformCode: "Solid-State-Platform", name: "固态电池平台", category: "固态", description: "固态电池产品平台", status: "规划中" },
  ];
  const productSeries = [
    { seriesId: "FAM-001", seriesCode: "280Ah-ESS", platformId: "PLAT-001", name: "280Ah 储能系列", category: "280Ah储能", voltageRange: "3.0-3.6V", capacityRange: "200-320Ah", targetMarket: "储能", status: "活跃" },
    { seriesId: "FAM-002", seriesCode: "314Ah-ESS", platformId: "PLAT-001", name: "314Ah 储能系列", category: "314Ah储能", voltageRange: "3.0-3.6V", capacityRange: "300-350Ah", targetMarket: "储能", status: "活跃" },
    { seriesId: "FAM-003", seriesCode: "4680-PAS", platformId: "PLAT-002", name: "4680 动力系列", category: "4680动力", voltageRange: "3.6-4.2V", capacityRange: "250-350Ah", targetMarket: "乘用车", status: "活跃" },
    { seriesId: "FAM-004", seriesCode: "2170-PAS", platformId: "PLAT-002", name: "2170 动力系列", category: "2170动力", voltageRange: "3.6-4.2V", capacityRange: "40-60Ah", targetMarket: "乘用车", status: "活跃" },
    { seriesId: "FAM-005", seriesCode: "Solid-ESS", platformId: "PLAT-003", name: "固态储能系列", category: "固态储能", voltageRange: "3.5-4.0V", capacityRange: "400-500Ah", targetMarket: "储能", status: "开发中" },
    { seriesId: "FAM-006", seriesCode: "Solid-PAS", platformId: "PLAT-003", name: "固态动力系列", category: "固态动力", voltageRange: "3.5-4.0V", capacityRange: "400-500Ah", targetMarket: "乘用车", status: "开发中" },
  ];
  const MODEL_SERIES_MAP: Record<string, string> = {
    "4680-NCM": "FAM-003",
    "4680-LFP": "FAM-001",
    "2170-NCM": "FAM-004",
    "方形-LFP": "FAM-002",
    "方形-NCM": "FAM-003",
    "圆柱-LFP": "FAM-001",
  };
  const MODEL_SPEC_MAP: Record<string, Record<string, unknown>> = {
    "4680-NCM": { productCode: "P-4680-NCM-300", capacity: 300, voltage: 3.7, energy: 1110, dimension: "80×80×120", weight: 350, applicationDomain: "乘用车", status: "量产" },
    "4680-LFP": { productCode: "P-4680-LFP-250", capacity: 250, voltage: 3.2, energy: 800, dimension: "80×80×120", weight: 380, applicationDomain: "储能", status: "量产" },
    "2170-NCM": { productCode: "P-2170-NCM-050", capacity: 50, voltage: 3.6, energy: 180, dimension: "21×70", weight: 70, applicationDomain: "乘用车", status: "量产" },
    "方形-LFP": { productCode: "P-SQ-LFP-314", capacity: 314, voltage: 3.2, energy: 1005, dimension: "174×72×205", weight: 5200, applicationDomain: "储能", status: "量产" },
    "方形-NCM": { productCode: "P-SQ-NCM-150", capacity: 150, voltage: 3.7, energy: 555, dimension: "148×26×91", weight: 2200, applicationDomain: "乘用车", status: "量产" },
    "圆柱-LFP": { productCode: "P-CYL-LFP-100", capacity: 100, voltage: 3.2, energy: 320, dimension: "46×80", weight: 1800, applicationDomain: "储能", status: "量产" },
  };

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
    const spec = MODEL_SPEC_MAP[m.modelId];
    // WO-SCALE-COHERENCE 断裂点C：Model.unitPrice 从 SEG_REGISTRY 派生（元/套=priceWan×1e4，±确定性微差），
    // 消灭"订单侧 ~600 元/套 vs 需求侧 ~18667 元/套 差 31×"。型号→细分统一按 pos 映射（动力→乘用车 pas / 储能→ess），
    // Order.unitPrice=model.unitPrice 自动继承（Model 侧与 Order 侧同一口径，不打架 R14）。
    void randInt(rng, 380, 980); // R6：保持 rng 流步长不变（下游订单/拓扑字节一致）
    const sc = BATTERY_SOLVER_PARAMS.scaleCoherence as { modelPriceVarPpk: number };
    const seg = SEG_REGISTRY.find((s) => s.key === (m.pos === "储能" ? "ess" : "pas"))!;
    const priceVar = ((hashString(`${m.modelId}:unitprice`) % (2 * sc.modelPriceVarPpk + 1)) - sc.modelPriceVarPpk) / 1000; // ±modelPriceVarPpk‰
    const unitPrice = Math.round(seg.priceWan * 1e4 * (1 + priceVar));
    return {
      modelId: m.modelId,
      name: m.name,
      chem: m.chem,
      pos: m.pos,
      bases: [...mappedBases].sort(),
      unitPrice,
      // C33：NCM 体系碳足迹 >70 阈值（越线），LFP 达标。
      carbonFootprint: m.modelId.includes("NCM") ? 76 : 58,
      seriesId: MODEL_SERIES_MAP[m.modelId],
      ...spec,
    };
  });

  // ProductVersion：每 Model 2-3 个版本（确定性，不消耗 rng）
  const productVersions: Record<string, unknown>[] = [];
  const VERSION_DEFS = [
    { versionCode: "V1.0", versionName: "初始量产版", ecnNumber: "ECN-2024-001", effectiveDate: "2024-01-01", expireDate: "2024-12-31", status: "量产", changeReason: "首批量产导入" },
    { versionCode: "V1.1", versionName: "工艺优化版", ecnNumber: "ECN-2024-006", effectiveDate: "2024-06-01", expireDate: "2025-06-30", status: "量产", changeReason: "涂布速度优化+良率提升" },
    { versionCode: "V2.0", versionName: "下一代试产版", ecnNumber: "ECN-2025-001", effectiveDate: "2025-01-01", expireDate: "", status: "试产", changeReason: "材料体系升级" },
  ];
  for (const m of models) {
    const nVersions = 2 + (hashString(m.modelId as string) % 2);
    for (let vi = 0; vi < nVersions; vi++) {
      const vd = VERSION_DEFS[vi]!;
      productVersions.push({
        versionId: `VER-${m.modelId}-${vd.versionCode}`,
        modelId: m.modelId,
        ...vd,
      });
    }
  }

  // Phase 2 Wave 3：BOM + Routing + Operation + ProcessCapabilityWindow（确定性，不消耗 rng）
  const bomHeaders: Record<string, unknown>[] = [];
  const bomDetails: Record<string, unknown>[] = [];
  const routings: Record<string, unknown>[] = [];
  const operations: Record<string, unknown>[] = [];
  const processCapabilities: Record<string, unknown>[] = [];

  // 标准工序库（10 工序）
  const STD_OPERATIONS = [
    { operationCode: "OP-001", operationName: "混料", operationType: "制造", standardTime: 30, setupTime: 5, yield: 0.998, isCritical: true, workCenterType: "制浆线" },
    { operationCode: "OP-002", operationName: "涂布", operationType: "制造", standardTime: 120, setupTime: 30, yield: 0.985, isCritical: true, workCenterType: "涂布线" },
    { operationCode: "OP-003", operationName: "辊压", operationType: "制造", standardTime: 60, setupTime: 20, yield: 0.992, isCritical: true, workCenterType: "辊压机" },
    { operationCode: "OP-004", operationName: "分切", operationType: "制造", standardTime: 45, setupTime: 15, yield: 0.995, isCritical: false, workCenterType: "分切机" },
    { operationCode: "OP-005", operationName: "卷绕", operationType: "制造", standardTime: 90, setupTime: 25, yield: 0.990, isCritical: true, workCenterType: "卷绕机" },
    { operationCode: "OP-006", operationName: "装配", operationType: "制造", standardTime: 75, setupTime: 20, yield: 0.993, isCritical: true, workCenterType: "装配线" },
    { operationCode: "OP-007", operationName: "注液", operationType: "制造", standardTime: 40, setupTime: 30, yield: 0.995, isCritical: true, workCenterType: "注液机" },
    { operationCode: "OP-008", operationName: "化成", operationType: "制造", standardTime: 720, setupTime: 60, yield: 0.997, isCritical: true, workCenterType: "化成柜" },
    { operationCode: "OP-009", operationName: "分容", operationType: "制造", standardTime: 360, setupTime: 30, yield: 0.996, isCritical: false, workCenterType: "分容柜" },
    { operationCode: "OP-010", operationName: "PACK", operationType: "制造", standardTime: 180, setupTime: 45, yield: 0.994, isCritical: true, workCenterType: "PACK线" },
  ];

  // 工艺参数模板（每工序 3-5 个参数）
  const CAPABILITY_TEMPLATES: Record<string, Array<{ parameterName: string; paramCode: string; unit: string; minValue: number; maxValue: number; targetValue: number; tolerance: number; ucl: number; lcl: number }>> = {
    "混料": [
      { parameterName: "搅拌速度", paramCode: "SPEED", unit: "rpm", minValue: 800, maxValue: 1200, targetValue: 1000, tolerance: 100, ucl: 1300, lcl: 700 },
      { parameterName: "浆料粘度", paramCode: "VISC", unit: "mPa·s", minValue: 3000, maxValue: 6000, targetValue: 4500, tolerance: 500, ucl: 6500, lcl: 2500 },
    ],
    "涂布": [
      { parameterName: "温度", paramCode: "TEMP", unit: "℃", minValue: 75, maxValue: 85, targetValue: 80, tolerance: 5, ucl: 87, lcl: 73 },
      { parameterName: "压力", paramCode: "PRESS", unit: "N", minValue: 100, maxValue: 120, targetValue: 110, tolerance: 10, ucl: 125, lcl: 95 },
      { parameterName: "速度", paramCode: "SPEED", unit: "m/min", minValue: 10, maxValue: 15, targetValue: 12, tolerance: 2, ucl: 16, lcl: 9 },
    ],
    "辊压": [
      { parameterName: "辊压压力", paramCode: "ROLL_PRESS", unit: "MPa", minValue: 15, maxValue: 25, targetValue: 20, tolerance: 3, ucl: 28, lcl: 12 },
      { parameterName: "辊缝间隙", paramCode: "GAP", unit: "μm", minValue: 80, maxValue: 120, targetValue: 100, tolerance: 10, ucl: 130, lcl: 70 },
    ],
    "分切": [
      { parameterName: "张力", paramCode: "TENSION", unit: "N", minValue: 50, maxValue: 80, targetValue: 65, tolerance: 10, ucl: 90, lcl: 40 },
      { parameterName: "毛刺", paramCode: "BURR", unit: "μm", minValue: 0, maxValue: 7, targetValue: 3, tolerance: 2, ucl: 8, lcl: 0 },
    ],
    "卷绕": [
      { parameterName: "卷绕张力", paramCode: "WIND_TENSION", unit: "N", minValue: 20, maxValue: 40, targetValue: 30, tolerance: 5, ucl: 45, lcl: 15 },
      { parameterName: "对齐度", paramCode: "ALIGN", unit: "mm", minValue: 0, maxValue: 0.5, targetValue: 0.2, tolerance: 0.1, ucl: 0.6, lcl: 0 },
      { parameterName: "速度", paramCode: "SPEED", unit: "m/s", minValue: 0.8, maxValue: 1.5, targetValue: 1.1, tolerance: 0.2, ucl: 1.7, lcl: 0.6 },
    ],
    "装配": [
      { parameterName: "焊接电流", paramCode: "WELD_CURR", unit: "A", minValue: 800, maxValue: 1200, targetValue: 1000, tolerance: 100, ucl: 1300, lcl: 700 },
      { parameterName: "焊接时间", paramCode: "WELD_TIME", unit: "ms", minValue: 2, maxValue: 5, targetValue: 3, tolerance: 0.5, ucl: 5.5, lcl: 1.5 },
    ],
    "注液": [
      { parameterName: "注液量", paramCode: "FILL_VOL", unit: "mL", minValue: 4.5, maxValue: 5.5, targetValue: 5, tolerance: 0.3, ucl: 5.8, lcl: 4.2 },
      { parameterName: "真空度", paramCode: "VACUUM", unit: "kPa", minValue: -98, maxValue: -85, targetValue: -92, tolerance: 5, ucl: -80, lcl: -100 },
      { parameterName: "环境温度", paramCode: "ENV_TEMP", unit: "℃", minValue: 20, maxValue: 25, targetValue: 23, tolerance: 2, ucl: 27, lcl: 18 },
    ],
    "化成": [
      { parameterName: "充电电流", paramCode: "CHG_CURR", unit: "A", minValue: 0.1, maxValue: 0.3, targetValue: 0.2, tolerance: 0.05, ucl: 0.35, lcl: 0.08 },
      { parameterName: "化成温度", paramCode: "FORM_TEMP", unit: "℃", minValue: 40, maxValue: 50, targetValue: 45, tolerance: 3, ucl: 53, lcl: 37 },
    ],
    "分容": [
      { parameterName: "放电倍率", paramCode: "DISCHG_RATE", unit: "C", minValue: 0.2, maxValue: 0.5, targetValue: 0.33, tolerance: 0.1, ucl: 0.6, lcl: 0.15 },
      { parameterName: "容量偏差", paramCode: "CAP_DEV", unit: "%", minValue: 0, maxValue: 3, targetValue: 1, tolerance: 1, ucl: 4, lcl: 0 },
    ],
    "PACK": [
      { parameterName: "焊接温度", paramCode: "PACK_WELD_TEMP", unit: "℃", minValue: 200, maxValue: 300, targetValue: 250, tolerance: 30, ucl: 330, lcl: 170 },
      { parameterName: "绝缘阻抗", paramCode: "INSULATION", unit: "MΩ", minValue: 100, maxValue: 500, targetValue: 300, tolerance: 50, ucl: 550, lcl: 80 },
    ],
  };

  // BOM 物料模板（简化版，引用 battery-extended.ts 中已有的物料 ID）
  const BOM_ITEM_TEMPLATES: Array<{ materialId: string; quantity: number; unit: string; level: number; isKeyComponent: boolean }> = [
    { materialId: "pos_ncm", quantity: 1.05, unit: "kg", level: 1, isKeyComponent: true },
    { materialId: "pos_lfp", quantity: 1.0, unit: "kg", level: 1, isKeyComponent: true },
    { materialId: "neg_graphite", quantity: 0.45, unit: "kg", level: 1, isKeyComponent: true },
    { materialId: "sep_film", quantity: 12, unit: "㎡", level: 1, isKeyComponent: true },
    { materialId: "elyte", quantity: 0.3, unit: "L", level: 1, isKeyComponent: true },
    { materialId: "cu_foil", quantity: 0.2, unit: "kg", level: 1, isKeyComponent: false },
    { materialId: "al_foil", quantity: 0.15, unit: "kg", level: 1, isKeyComponent: false },
    { materialId: "cell_case", quantity: 1, unit: "个", level: 1, isKeyComponent: true },
  ];

  let bomSeq = 0;
  let opSeq = 0;
  let capSeq = 0;
  for (const v of productVersions) {
    const modelId = v.modelId as string;
    const versionId = v.versionId as string;
    const versionCode = (v.versionCode as string) ?? "V1.0";

    // BOMHeader
    const bomId = `BOM-${modelId}-${versionCode}`;
    bomHeaders.push({
      bomId,
      bomCode: `BOM-${modelId}-${versionCode}`,
      versionId,
      modelId,
      bomName: `${modelId} ${versionCode} BOM`,
      bomLevel: 3,
      effectiveDate: v.effectiveDate,
      expireDate: v.expireDate,
      status: v.status,
    });

    // BOMDetail：每 BOM 8 行（与现有物料对齐）
    for (const [bi, item] of BOM_ITEM_TEMPLATES.entries()) {
      // LFP 型号跳过 NCM 正极，NCM 型号跳过 LFP 正极
      if (modelId.includes("LFP") && item.materialId === "pos_ncm") continue;
      if (modelId.includes("NCM") && item.materialId === "pos_lfp") continue;
      bomDetails.push({
        bomDetailId: `BDTL-${bomId}-${bi}`,
        bomId,
        materialId: item.materialId,
        sequence: bi + 1,
        quantity: item.quantity,
        lossRate: 0.02,
        unit: item.unit,
        level: item.level,
        parentItemId: null,
        isKeyComponent: item.isKeyComponent,
        effectiveDate: v.effectiveDate,
        expireDate: v.expireDate,
      });
    }

    // Routing
    const routingId = `RT-${modelId}-${versionCode}`;
    const totalStdTime = STD_OPERATIONS.reduce((s, o) => s + o.standardTime, 0);
    const totalYield = STD_OPERATIONS.reduce((p, o) => p * o.yield, 1);
    routings.push({
      routingId,
      routingCode: `RT-${modelId}-${versionCode}`,
      modelId,
      versionId,
      routingName: `${modelId} ${versionCode} 工艺路线`,
      operationCount: STD_OPERATIONS.length,
      totalStandardTime: totalStdTime,
      totalYield: round(totalYield, 6),
      status: v.status,
      effectiveDate: v.effectiveDate,
    });

    // Operation（每 Routing 10 工序）
    for (const [oi, sop] of STD_OPERATIONS.entries()) {
      const operationId = `${routingId}-${sop.operationCode}`;
      operations.push({
        operationId,
        operationCode: sop.operationCode,
        routingId,
        operationSeq: oi + 1,
        operationName: sop.operationName,
        description: `${sop.operationName}工序`,
        operationType: sop.operationType,
        standardTime: sop.standardTime,
        setupTime: sop.setupTime,
        yield: sop.yield,
        isCritical: sop.isCritical,
        workCenterType: sop.workCenterType,
        status: "生效",
      });

      // ProcessCapabilityWindow（每工序 2-3 参数）
      const caps = CAPABILITY_TEMPLATES[sop.operationName] ?? [];
      for (const [ci, cap] of caps.entries()) {
        processCapabilities.push({
          capabilityId: `CAP-${operationId}-${ci}`,
          operationId,
          ...cap,
          status: "生效",
        });
      }
    }
  }

  // PRD-IND-order-aggregate：HTML 24 单逐字录入（so/cust/model/qty/due/pri，SO-3391…SO-3540），
  // 替代随机生成 → 订单全链/台账/根因 1:1。可产基地取该 model 的 MODEL_BASE_MAP（确定性）。
  const modelById = new Map(models.map((m) => [m.modelId, m]));
  const t0ms = Date.parse(`${BATTERY_SOLVER_PARAMS.forecastStart as string}T00:00:00Z`);
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
    // WO-W5·业务类型维度（additive·不改既有 qty/due 数值口径·R6）：客户名 → 业务类型；乘用车部分客户需提前交付
    // → early:true + earlyDue（提前 earlyDeliveryLeadDays 天·确定性 hashString(so)%mod）；商用/储能 无提前交付标。
    const businessType = businessTypeOfCustomer(o.cust);
    const btReg = (BATTERY_SOLVER_PARAMS.businessTypeRegime as Record<string, { earlyDeliveryLeadDays?: number; earlyDeliveryMod?: number; volatilityFactors?: number[] }>)[businessType] ?? {};
    const early = businessType === "passenger" && (hashString(o.so) % (btReg.earlyDeliveryMod ?? 3) === 0);
    const earlyDue = early ? new Date(Date.parse(`${o.due}T00:00:00Z`) - (btReg.earlyDeliveryLeadDays ?? 14) * 86400000).toISOString().slice(0, 10) : undefined;
    const qty = shapeBusinessTypeQty(businessType, o.qty, o.so);
    return {
      so: o.so,
      cust: o.cust,
      model: o.model,
      qty,
      due: o.due,
      pri: o.pri,
      bases: orderBases,
      status: "OPEN",
      unitPrice: model?.unitPrice ?? 600,
      businessType,
      early,
      ...(earlyDue ? { earlyDue } : {}),
      // 约束扫描字段：确定性派生（不依赖 rng），按固定步长植入越线行（C03/C08/C13/C29）。
      demandDelta: i % 8 === 0 ? 0.6 : round((hashString(o.so) % 50) / 100, 2),
      // DF.13：越线样本/合规桶与 C08 红线强耦合（红线放松到样本之上 → C08 立刻变哑弹）→ 从 OUTSOURCE_SAMPLE 派生，值不变。
      outsourceRatio: i % 6 === 0 ? OUTSOURCE_SAMPLE.violationRatio : round((hashString(`${o.so}o`) % OUTSOURCE_SAMPLE.normalBucketMod) / 100, 2),
      creditUsedRatio: i % 7 === 0 ? 1.15 : round(0.4 + (hashString(`${o.so}c`) % 50) / 100, 2),
      leadDays: dueDay,
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
    const cust = pick(rng, CUSTOMERS);
    const businessType = businessTypeOfCustomer(cust);
    const btReg = (BATTERY_SOLVER_PARAMS.businessTypeRegime as Record<string, { earlyDeliveryLeadDays?: number; earlyDeliveryMod?: number }>)[businessType] ?? {};
    const early = businessType === "passenger" && (hashString(so) % (btReg.earlyDeliveryMod ?? 3) === 0);
    const earlyDue = early ? new Date(t0ms + Math.max(0, dueDay - (btReg.earlyDeliveryLeadDays ?? 14)) * 86400000).toISOString().slice(0, 10) : undefined;
    orders.push({
      so, cust, model: model.modelId, qty: shapeBusinessTypeQty(businessType, randInt(rng, 1420, 7668), so), due,
      pri: ["高", "中", "低"][i % 3], bases: orderBases, status: "OPEN", unitPrice: model.unitPrice,
      businessType, early, ...(earlyDue ? { earlyDue } : {}),
      demandDelta: i % 25 === 0 ? 0.6 : round((hashString(so) % 50) / 100, 2),
      outsourceRatio: i % 17 === 0 ? OUTSOURCE_SAMPLE.violationRatio : round((hashString(`${so}o`) % OUTSOURCE_SAMPLE.normalBucketMod) / 100, 2), // DF.13 同上（规模补足段）

      creditUsedRatio: i % 13 === 0 ? 1.15 : round(0.4 + (hashString(`${so}c`) % 50) / 100, 2),
      leadDays: dueDay,
    });
  }

  // WO-ORDERLINE：订单拆行（SO→型号明细行·一单多型号多行）。独立哈希子流·**不插既有 order rng 流**→
  // 24 单头级字节基线不移（R6）；additive 只加 OrderLine 行、Order 头级对象数不变。
  const orderLines = deriveOrderLines(orders, models);

  const rngTopo = mulberry32(seed ^ hashString("topology"));
  const workshops: Record<string, unknown>[] = [];
  const lines: Record<string, unknown>[] = [];
  const processes: Record<string, unknown>[] = [];
  const equipment: Record<string, unknown>[] = [];
  const scaleCoh = BATTERY_SOLVER_PARAMS.scaleCoherence as {
    lineHeadroom: number; channelOutputBase: number; channelOutputSpan: number; agingHeadroom: number;
    serialCellsPerCtSec: number; ctSecMin: number; ctSecMax: number;
  };
  const nLinesPerBase = WORKSHOP_DEFS.length;
  for (const b of bases) {
    // WO-SCALE-COHERENCE 断裂点B：产能微观参数按 gwhᵢ 派生（令 computeRollup 的 min 绑定 gwh 夹点·不改求解器）。
    // 物理→套：名牌套/年 = gwhᵢ×1e6/packEnergyKwh；有效套/年 = 名牌套×util（util 为百分数，÷100）。
    const utilFrac = b.util / 100; // BASE_REGISTRY.util 为百分口径（88/85…），÷100 取分数
    const annualEffectivePacks = (b.gwh * 1e6) / packEnergyKwh * utilFrac; // 有效套/年（名牌×利用率）
    // 化成/老化 基地共享夹点（电芯/日）——周产能口径：weeklyWan=dailyCells×7/packCellCount/1e4 → ×52 年化=52×7=364 日历日。
    const baseDailyCellsWeekly = Math.round((annualEffectivePacks * (BATTERY_SOLVER_PARAMS.packCellCount as number)) / (52 * 7));
    // 每线套/日（供 supply_demand ×operatingDaysPerYear/1e4 年化）——13 基地×10 线 Σ×300/1e4 = Σ有效套/1e4 = 名牌×util 尺度。
    const perLineDailyPacks = Math.max(1, Math.round(annualEffectivePacks / (operatingDaysPerYear * nLinesPerBase)));
    // 线级夹点（电芯/日）：略高于基地夹点（headroom）→ lineMean 不低于基地夹点 → min() 绑 gwh 夹点（非玩具线级=SEAM 反例）。
    const lineTargetCells = Math.round(baseDailyCellsWeekly * scaleCoh.lineHeadroom);
    // 节拍反解：令串行工序在最坏因子下日产 ≥ lineTargetCells（serialCellsPerCtSec/ct ≥ target → ct ≤ 系数/target）。
    const ctSecondsBase = Math.min(scaleCoh.ctSecMax, Math.max(scaleCoh.ctSecMin, round(scaleCoh.serialCellsPerCtSec / lineTargetCells, 2)));
    for (const wsDef of WORKSHOP_DEFS) {
      const workshopId = `WS-${b.baseId}-${wsDef.suffix}`;
      workshops.push({
        workshopId,
        baseId: b.baseId,
        name: `${b.name}${wsDef.type}车间`,
        processType: wsDef.type,
      });
      const lineId = `LINE-${workshopId}`;
      const lineHash = hashString(lineId);
      lines.push({
        lineId,
        baseId: b.baseId,
        name: `${b.name}${wsDef.type}线`,
        // SA-5：产线台账字段（R12 全建模对齐）
        line_code: lineId.replace("LINE-", "L-"),
        // WO-SCALE-COHERENCE：件/日(电芯) = 套/日 × 单PACK电芯数（gwhᵢ 派生·确定性·无 rng）。
        max_capacity_day: perLineDailyPacks * (BATTERY_SOLVER_PARAMS.packCellCount as number),
        // 套/日 运营日产能：gwhᵢ 派生（Σ全线 ×operatingDaysPerYear/1e4 = 名牌×util 尺度，与需求万套同口径）
        // → supply_demand 产能缺口叶出真数(非虚空)。
        capacityDaily: perLineDailyPacks, // 套/日 · gwhᵢ 派生 · 确定性(R6·无 rng)
        target_yield: round(0.95 + (lineHash % 100) / 100 * 0.04, 3),
        status: lineHash % 10 < 9 ? "运行中" : "调试",
      });
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
          const equipId = `${processId}-E${e}`;
          const equipHash = hashString(equipId);
          const typeMap: Record<string, string> = EQUIPMENT_TYPE_BY_PROCESS; // 单源见 contracts/base-registry.ts
          const processSuffix = processId.split("-").pop() ?? "";
          const manufacturerPool = ["先导智能", "赢合科技", "利元亨", "科恒股份", "大族激光"];
          void rngTopo(); // WO-SCALE-COHERENCE R6：占 ctSeconds 原 rng 位（保持后续 avail/oee 字节一致），ct 改 gwhᵢ 派生
          equipment.push({
            equipId,
            processId,
            lineId,
            baseId: b.baseId,
            // 节拍(s/电芯)：gwhᵢ 派生 → 串行工序日产 ≥ 基地夹点（令 min 绑 gwh 夹点·非玩具线级）
            ctSeconds: ctSecondsBase,
            availFactor: round(0.86 + rngTopo() * 0.08, 3),
            oeeA: round(0.9 + rngTopo() * 0.06, 3),
            oeeP: round(0.88 + rngTopo() * 0.08, 3),
            oeeQ: round(0.96 + rngTopo() * 0.03, 3),
            // SA-6：设备台账字段（R12 全建模对齐）
            equipment_code: equipId,
            equipment_type: typeMap[processSuffix] ?? processSuffix,
            manufacturer: manufacturerPool[hashString(b.baseId) % manufacturerPool.length]!,
            install_date: isoDate(Date.parse(`${b.start_date}T00:00:00Z`) + 90 * 86400000),
            status: equipHash % 20 < 19 ? "正常" : "维修中",
            // WO-SA-2 可靠性字段：由 equipId 加盐哈希确定性派生（不占 rngTopo 流·避免下游合成值位移·R6 字节一致），
            // 诚实合成非实测——对象 origin=SYNTHETIC，前端经 provenanceSynthetic 走诚实灰不冒充 LIVE（KILL-MOCK-RED）。
            mtbf: 300 + (hashString(`${equipId}:mtbf`) % 501), // 平均无故障时间 300-800h
            mttr: round(2 + (hashString(`${equipId}:mttr`) % 61) / 10, 1), // 平均修复时间 2.0-8.0h
            health_score: 78 + (hashString(`${equipId}:health`) % 21), // 设备健康度 78-98
          });
        }
      }
      // WO-CEO-DATA-2：Equipment.oee_current 由 A×P×Q 派生（不额外消耗 rngTopo·R6 字节一致）。
      for (const eq of equipment) {
        if (eq.oee_current === undefined) {
          eq.oee_current = round(Number(eq.oeeA) * Number(eq.oeeP) * Number(eq.oeeQ), 3);
        }
      }
      // WO-SCALE-COHERENCE：化成通道数/单通道日产按 gwhᵢ 派生（令线级化成夹点 ≥ 基地夹点·headroom）。
      void randInt(rngTopo, 600, 780); // R6：占原 channels rng 位
      void randInt(rngTopo, 80, 95); // R6：占原 channelOutputDaily rng 位
      const channelOutputDaily = scaleCoh.channelOutputBase + (hashString(`${lineId}:cod`) % scaleCoh.channelOutputSpan); // 85–95 套/通道·日
      const channels = Math.ceil(lineTargetCells / (channelOutputDaily * 0.97)); // 通道数×日产×良率 ≥ 线级夹点
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
        // WO-SANDBOX-D3：把「有多少个化成柜位」升为**可被引擎通用发现的硬容量约束**。
        // 单元数/速率不复制（仍读上面的 channels/channelOutputDaily），只加语义标签 + 比较基准。
        capacityUnitKind: "化成柜位",
        // requiredThroughput = 上游串行段要求该并行段承接的日吞吐。
        // 取 `lineTargetCells`（本线串行段被反解节拍夹定到的目标日产·同一段代码 :3489 算出），
        // 不是拍脑袋的常数：串行工序的 ctSeconds 正是按 "串行日产 ≥ lineTargetCells" 反解的，
        // 故「上游能推给化成多少」= lineTargetCells。R6：纯 gwhᵢ 派生，无 rng。
        requiredThroughput: lineTargetCells,
      });
      void randInt(rngTopo, 260000, 340000); // R6：占原 agingSlots rng 位
      const agingDays = 5;
      // 老化库位按 gwhᵢ 派生（agingSlots/agingDays = 线级老化夹点 ≥ 线级夹点·headroom）。
      const agingSlots = Math.ceil(lineTargetCells * agingDays * scaleCoh.agingHeadroom);
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
        // WO-SANDBOX-D3：老化库位是同族硬容量约束（数据早已存在，此前同样无人当约束读）。
        capacityUnitKind: "老化库位",
        requiredThroughput: lineTargetCells,
      });
      // Shared-resource caps：仅第一个 workshop 更新基地级共享容量（避免重复覆盖）
      if (wsDef.suffix === WORKSHOP_DEFS[0]!.suffix) {
        void randInt(rngTopo, 2000, 6000); // R6：占原 formationCapDaily 噪声 rng 位
        void randInt(rngTopo, 2000, 6000); // R6：占原 agingCapDaily 噪声 rng 位
        // WO-SCALE-COHERENCE 断裂点B 主修：基地共享化成/老化夹点 = gwhᵢ 派生日电芯数 → computeRollup 的 min 由 gwh 夹定。
        b.formationCapDaily = baseDailyCellsWeekly;
        b.agingCapDaily = baseDailyCellsWeekly;
      }
    }
  }

  // Phase 2 Wave 4：质量标准 + 检验特性 + 制造能力（确定性，不消耗 rng）
  const qualityStandards: Record<string, unknown>[] = [];
  const inspectionCharacteristics: Record<string, unknown>[] = [];
  const productLineCapabilities: Record<string, unknown>[] = [];
  const productEquipmentCapabilities: Record<string, unknown>[] = [];

  // 质量项模板
  const QUALITY_ITEMS = [
    { itemName: "容量", itemCode: "CAP", targetValue: 300, toleranceUpper: 0.02, toleranceLower: -0.02, unit: "Ah", testMethod: "充放电测试", samplingRate: 100 },
    { itemName: "内阻", itemCode: "IR", targetValue: 0.8, toleranceUpper: 0, toleranceLower: -0.8, unit: "mΩ", testMethod: "交流内阻测试", samplingRate: 100 },
    { itemName: "外观", itemCode: "APP", targetValue: 0, toleranceUpper: 0, toleranceLower: 0, unit: "级", testMethod: "目视检测", samplingRate: 100 },
    { itemName: "尺寸", itemCode: "DIM", targetValue: 80, toleranceUpper: 0.5, toleranceLower: -0.5, unit: "mm", testMethod: "卡尺测量", samplingRate: 50 },
    { itemName: "循环寿命", itemCode: "CYC", targetValue: 3000, toleranceUpper: 0, toleranceLower: -500, unit: "次", testMethod: "循环测试", samplingRate: 5 },
    { itemName: "安全", itemCode: "SAF", targetValue: 0, toleranceUpper: 0, toleranceLower: 0, unit: "级", testMethod: "针刺/过充", samplingRate: 10 },
  ];

  // 检验特性模板
  const INSPECTION_TEMPLATES = [
    { charName: "全检", charCode: "FI", inspectionType: "全检", inspectionMethod: "设备检测", samplingRate: 100, frequency: "每班", controlMethod: "SPC" },
    { charName: "抽检", charCode: "SI", inspectionType: "抽检", inspectionMethod: "设备检测", samplingRate: 5, frequency: "每批次", controlMethod: "直方图" },
  ];

  for (const m of models) {
    const modelId = m.modelId as string;
    // QualityStandard：每 Model 6 项
    for (const [qi, qItem] of QUALITY_ITEMS.entries()) {
      const standardId = `QS-${modelId}-${qItem.itemCode}`;
      qualityStandards.push({
        standardId,
        standardCode: `QS-${modelId}-${qItem.itemCode}`,
        modelId,
        versionId: null,
        ...qItem,
        status: "生效",
      });
      // InspectionCharacteristic：每标准 2 项
      for (const [ci, insp] of INSPECTION_TEMPLATES.entries()) {
        inspectionCharacteristics.push({
          charId: `CHAR-${standardId}-${ci}`,
          standardId,
          ...insp,
          status: "生效",
        });
      }
    }

    // ProductLineCapability：该 model 可产基地中的 line（稀疏，仅可生产的）
    const producibleBases = new Set(m.bases as string[]);
    for (const l of lines) {
      const lineBaseId = l.baseId as string;
      if (!producibleBases.has(lineBaseId)) continue;
      // 只取制浆车间线（每个可产基地 1 条）作为代表，避免数据爆炸
      if (!(l.lineId as string).endsWith("-slurry")) continue;
      const lineHash = hashString(`${modelId}_${l.lineId}`);
      productLineCapabilities.push({
        capId: `PLC-${modelId}-${l.lineId}`,
        productId: modelId,
        versionId: null,
        lineId: l.lineId,
        capability: "可生产",
        maxCapacity: 1500 + (lineHash % 3000),
        cycleTime: round(1.5 + (lineHash % 100) / 100, 2),
        yield: round(0.94 + (lineHash % 50) / 1000, 3),
        priority: 1 + (lineHash % 5),
        changeoverTime: 30 + (lineHash % 120),
        constraints: "",
        status: "生效",
      });
    }

    // ProductEquipmentCapability：该 model 可产基地中的 equipment（稀疏）
    for (const eq of equipment) {
      const eqBaseId = eq.baseId as string;
      if (!producibleBases.has(eqBaseId)) continue;
      // 只取部分设备（每基地前 4 台）
      const equipHash = hashString(`${modelId}_${eq.equipId}`);
      if (equipHash % 3 !== 0) continue; // 稀疏化：只取 1/3
      productEquipmentCapabilities.push({
        equipCapId: `PEC-${modelId}-${eq.equipId}`,
        productId: modelId,
        versionId: null,
        equipmentId: eq.equipId,
        capability: "支持",
        maxSpeed: round(80 + (equipHash % 120), 1),
        minSpeed: round(10 + (equipHash % 30), 1),
        setupTime: 15 + (equipHash % 45),
        qualifiedOperators: 2 + (equipHash % 8),
        certificationRequired: equipHash % 5 === 0,
        status: "生效",
      });
    }
  }

  // Phase 2 Wave 5：工程变更历史（确定性，不消耗 rng）
  const engineeringChanges: Record<string, unknown>[] = [];
  const CHANGE_TEMPLATES = [
    { changeType: "材料变更", description: "正极材料供应商切换", status: "已实施", effectiveDate: "2025-03-15", approvedBy: "张三", approvedDate: "2025-03-01" },
    { changeType: "工艺变更", description: "涂布速度优化提升", status: "已批准", effectiveDate: "2025-06-01", approvedBy: "李四", approvedDate: "2025-05-20" },
    { changeType: "设计变更", description: "电芯结构优化", status: "已实施", effectiveDate: "2024-09-10", approvedBy: "王五", approvedDate: "2024-08-25" },
    { changeType: "质量改进", description: "化成工序温控精度提升", status: "审批中", effectiveDate: "", approvedBy: "", approvedDate: "" },
  ];
  let changeSeq = 0;
  for (const m of models) {
    const modelId = m.modelId as string;
    const nChanges = 1 + (hashString(modelId) % 2);
    for (let ci = 0; ci < nChanges; ci++) {
      const tpl = CHANGE_TEMPLATES[changeSeq % CHANGE_TEMPLATES.length]!;
      changeSeq++;
      engineeringChanges.push({
        changeId: `ECN-${modelId}-${ci + 1}`,
        changeNumber: `ECN-2025-${String(changeSeq).padStart(3, "0")}`,
        changeType: tpl.changeType,
        modelId,
        versionId: null,
        changeReason: tpl.description,
        description: tpl.description,
        affectedObjects: JSON.stringify([{ type: "BOM", id: `BOM-${modelId}-V1.0` }]),
        effectiveDate: tpl.effectiveDate,
        approvedBy: tpl.approvedBy,
        approvedDate: tpl.approvedDate,
        status: tpl.status,
      });
    }
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
      certLinks.push({ modelId: m.modelId, lineId: `LINE-WS-${baseId}-${WORKSHOP_DEFS[0]!.suffix}`, baseId, status });
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
    qtyTons: randInt(rngShip, 170, 682),
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
  // 需求结构：乘用车201.7 / 储能139.2 / 商用车34.1（合计375万套/年），
  // 经 SEG_REGISTRY 单价推导 totalRev=700.0亿、gmRate≈17.0%（R14 从边界册派生）。
  // WO-SCALE-COHERENCE 锚：此需求层(375万套/700亿)= scaleAnchorRevenue.S 锚（Σp50×priceWan===scaleAnchorRevenue.S），
  // 是被金值锁死的事实锚（spine.test:58 硬钉 revenue.actual===700）——本单不动锚，把物理/产能/财务/订单四层往此对齐。
  // 派生结果==既有锚值：V*=R*/P̄=700/1.8667=375万套（=Σp50），tgt/p50/p90/act 数值字节一致（下方内联即锚值本体）。
  const SEG_DEMAND = [
    { segment: "乘用车", tgt: 201.7, p50: 201.7, p90: 199.6, act: 200.6 },
    { segment: "储能", tgt: 139.2, p50: 139.2, p90: 108.4, act: 100.5 },
    { segment: "商用车", tgt: 34.1, p50: 34.1, p90: 34.0, act: 39.5 },
  ];
  const SEGMENTS = SEG_DEMAND.map((d) => {
    const s = SEG_REGISTRY.find((x) => x.seg === d.segment)!;
    return { ...d, price: s.priceWan, margin: s.marginPct, floor: s.floorPct };
  });
  const demandSegments = SEGMENTS.map((s, i) => ({
    segId: `dseg-${i + 1}`, segment: s.segment, tgt: s.tgt, p50: s.p50, p90: s.p90, act: s.act,
    priceWan: s.price, marginPct: s.margin, floorPct: s.floor,
    // WO-W5·业务类型维度（additive·细分名 → 类型枚举·求解器按类聚合预测口径）。
    businessType: businessTypeOfSegment(s.segment),
  }));
  // Wave 1 (#59)：物料净需求按 375万套 / 132万套 ≈ 2.84 放大，与需求规模对齐；
  // MAT 扩至 9 项关键物料，覆盖正极/负极/隔膜/电解液/铜铝箔/结构件/包材。
  const MAT = [
    { material: "三元正极", unit: "吨", net: 23231, lta: 92, eta: "2026-06-28" },
    { material: "磷酸铁锂正极", unit: "吨", net: 8208, lta: 94, eta: "2026-06-27" },
    { material: "石墨负极", unit: "吨", net: 9975, lta: 93, eta: "2026-06-29" },
    { material: "隔膜", unit: "万㎡", net: 6748, lta: 100, eta: "" },
    { material: "电解液", unit: "吨", net: 15745, lta: 96, eta: "2026-06-25" },
    { material: "铜箔", unit: "吨", net: 4425, lta: 91, eta: "2026-06-30" },
    { material: "铝箔", unit: "吨", net: 3323, lta: 95, eta: "2026-06-26" },
    { material: "电芯壳体", unit: "万个", net: 36000, lta: 99, eta: "2026-06-24" },
    { material: "包材", unit: "万套", net: 750, lta: 100, eta: "" },
  ];
  const materialBalances = MAT.map((m, i) => ({
    matBalId: `mbal-${i + 1}`, material: m.material, unit: m.unit, netDemandTon: m.net, ltaPct: m.lta,
    gapTon: round(Math.max(0, m.net * (1 - m.lta / 100)), 0),
    etaDate: m.eta,
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
    // WO-CEO-1a item3：三应用细分业务线责任主体（细分 Metric 的 owner，责任闭环 owner/越线）。
    { principalId: "prin-seg-pas", name: "乘用车业务线", kind: "org", parentRef: "prin-plan" },
    { principalId: "prin-seg-ess", name: "储能业务线", kind: "org", parentRef: "prin-supply" },
    { principalId: "prin-seg-com", name: "商用车业务线", kind: "org", parentRef: "prin-plan" },
  ];
  // SPINE：指标库 Metric（= cockpit PlanKpi 归一）。actual 全部经 P1 同源数据算出（与驾驶舱数字交叉一致，R14/R13/R-一致）；
  // 归挂 KSF + 责任人 + 越线根因 chainKey。metric_rollup 求解器据此对齐 target 算 delta/miss。
  const totalTgt = demandSegments.reduce((s, d) => s + (d.tgt as number), 0);
  const totalAct = demandSegments.reduce((s, d) => s + (d.act as number), 0);
  const totalNet = materialBalances.reduce((s, m) => s + (m.netDemandTon as number), 0);
  const totalCovered = materialBalances.reduce((s, m) => s + (m.netDemandTon as number) * (m.ltaPct as number) / 100, 0);
  // WO-CEO-1a：顶层目标升一等 Metric（营收/毛利/份额/现金）+ 运营指标 target/floorVal 收编 GOAL_REGISTRY（R-一致，杀 Gap④ 漂移）。
  // `goalMetric`：target/floorVal/owner/ksf/name/unit/level/category 一律取自 GOAL_REGISTRY 单一来源；只 actual + 可选 chainKey 由本地传入。
  // actual 诚实来源：营收=Σ需求×价（totalRev，真实聚合）· 毛利=Σ需求×价×毛利率（totalMargin）· 现金=baseline 情景现金垫（params 同源）·
  //   份额=诚实合成种子（无外部市场规模真源 → provenanceSynthetic 轴标合成，绝不冒充实测 KILL-MOCK-RED）· 运营三指标沿用 P1 同源派生。
  const goalMetric = (metricId: string, goalKey: string, actual: number, chainKey?: string) => {
    const g = GOAL_REGISTRY[goalKey]!;
    return { metricId, key: g.key, name: g.name, level: g.level, category: g.category, target: g.target, actual, floorVal: g.floorVal, unit: g.unit, weight: g.weight, ksfRef: g.ksfRef, ownerRef: g.ownerRef, ...(chainKey ? { chainKey } : {}) };
  };
  const cashActual = (BATTERY_SOLVER_PARAMS.planview as { scenarios: { finance: { baseline: { cashCushion: number } } } }).scenarios.finance.baseline.cashCushion;
  const marketShareActual = 21.5; // 诚实合成：无市场规模真数据源，种子常数（synthetic 标灰，不冒充实测）
  const metrics: Record<string, unknown>[] = [
    // 运营指标（op）——metricId 保持既有 kpi-margin/attain/material 不变（R6 obj id 集稳定）；target/floorVal 现取自 GOAL_REGISTRY。
    goalMetric("kpi-margin", "gm_rate", round(round(totalMargin, 1) / round(totalRev, 1) * 100, 1), "rc-profit-mix"),
    goalMetric("kpi-attain", "demand_attain", round(totalAct / totalTgt * 100, 1), "rc-scale-demand"),
    goalMetric("kpi-material", "material_cov", round(totalCovered / totalNet * 100, 1), "rc-material-gap"),
    // 顶层企业目标（year · CEO 决策看板头条）——营收700亿此前仅 Σp50×price 局部变量，现升一等 Metric（有 target/floor/owner/越线）。
    goalMetric("kpi-revenue", "revenue", round(totalRev, 1), "rc-scale-demand"),
    goalMetric("kpi-gross-profit", "gross_profit", round(totalMargin, 1), "rc-profit-mix"),
    goalMetric("kpi-share", "market_share", marketShareActual),
    goalMetric("kpi-cash", "cash", cashActual),
  ];
  // WO-CEO-1a item3：三应用细分升带责任 Metric（owner + 越线）。达成率=act/tgt×100，floor=95（储能 72.2%<95 → 越线，owner=储能业务线）。
  const SEG_METRIC_KEY: Record<string, string> = { 乘用车: "pas", 储能: "ess", 商用车: "com" };
  for (const d of demandSegments) {
    const k = SEG_METRIC_KEY[d.segment as string]!;
    metrics.push({
      metricId: `kpi-seg-${k}`, key: `seg_attain_${k}`, name: `${d.segment}达成率`, level: "op", category: "segment",
      businessType: businessTypeOfSegment(d.segment as string), // WO-SEG-ATTR-SCOPE：细分升 Metric 一等字段（储能→storage·与 Order.businessType 同源同口径·R-一致），使 gap_attribution 按业态裁订单
      target: 100, actual: round((d.act as number) / (d.tgt as number) * 100, 1), floorVal: 95, unit: "%", weight: 0.1,
      ksfRef: "ksf-dem", ownerRef: `prin-seg-${k}`, chainKey: "rc-scale-demand",
    });
  }
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
  ];

  // Phase 2 Wave 2：物料替代关系（基于现有 8 种物料的简化替代矩阵，固定值不消耗 rng）。
  const materialAlternatives = [
    { altId: "ALT-001", primaryMaterialId: "pos_ncm", alternativeMaterialId: "pos_lfp", priority: 3, approvalStatus: "限条件", effectiveDate: "2025-01-01", expireDate: undefined, changeReason: "跨化学体系应急替代", verifiedBy: "张三", verifiedDate: "2025-02-15" },
    { altId: "ALT-002", primaryMaterialId: "pos_lfp", alternativeMaterialId: "pos_ncm", priority: 3, approvalStatus: "限条件", effectiveDate: "2025-01-01", expireDate: undefined, changeReason: "跨化学体系应急替代", verifiedBy: "张三", verifiedDate: "2025-02-15" },
    { altId: "ALT-003", primaryMaterialId: "sep_film", alternativeMaterialId: "elyte", priority: 2, approvalStatus: "待审批", effectiveDate: undefined, expireDate: undefined, changeReason: "工艺验证中", verifiedBy: undefined, verifiedDate: undefined },
    { altId: "ALT-004", primaryMaterialId: "cell_case", alternativeMaterialId: "al_foil", priority: 1, approvalStatus: "已批准", effectiveDate: "2024-06-01", expireDate: "2026-06-01", changeReason: "包材替代验证通过", verifiedBy: "李四", verifiedDate: "2024-05-20" },
    { altId: "ALT-005", primaryMaterialId: "cu_foil", alternativeMaterialId: "al_foil", priority: 2, approvalStatus: "待审批", effectiveDate: undefined, expireDate: undefined, changeReason: "成本优化评估", verifiedBy: undefined, verifiedDate: undefined },
  ];

  // Phase 3 MES Domain: Production Planning
  const rngMES = mulberry32(seed ^ hashString("mes"));
  const workOrders: Record<string, unknown>[] = [];
  const productionSchedules: Record<string, unknown>[] = [];
  const shiftPlans: Record<string, unknown>[] = [];
  const wipLots: Record<string, unknown>[] = [];
  const wipMoves: Record<string, unknown>[] = [];
  const wipQualityCheckpoints: Record<string, unknown>[] = [];
  const qualityLots: Record<string, unknown>[] = [];
  const inspectionResults: Record<string, unknown>[] = [];
  const defectRecords: Record<string, unknown>[] = [];
  const equipmentOEEs: Record<string, unknown>[] = [];
  const equipmentDowntimes: Record<string, unknown>[] = [];
  const equipmentAlarms: Record<string, unknown>[] = [];
  const maintenanceOrders: Record<string, unknown>[] = [];
  const sparePartConsumptions: Record<string, unknown>[] = [];
  const operatorAttendances: Record<string, unknown>[] = [];
  const operatorSkillCerts: Record<string, unknown>[] = [];

  // MES generation helpers
  const MES_STATUSES = {
    wo: ["已排产", "生产中", "已完成", "已关闭"],
    sched: ["已确认", "已执行", "已取消"],
    wip: ["在制", "待检", "合格", "报废"],
    qlot: ["待检", "合格", "不合格", "特采"],
    insp: ["合格", "不合格"],
    defect: ["外观", "尺寸", "性能", "安全"],
    severity: ["轻微", "一般", "严重"],
    dtReason: ["故障", "换型", "待料", "计划停机", "其他"],
    alarmLevel: ["提示", "警告", "紧急"],
    alarmStatus: ["活跃", "已确认", "已清除"],
    maintType: ["预防性", "预测性", " corrective"],
    maintPriority: ["低", "中", "高", "紧急"],
    maintStatus: ["待执行", "执行中", "已完成", "已取消"],
    attStatus: ["正常", "迟到", "早退", "缺勤"],
    skillLevel: ["初级", "中级", "高级", "技师"],
    certStatus: ["有效", "过期", "吊销"],
  };

  const WO_MODELS = ["4680-NCM", "4680-LFP", "方形-LFP", "储能-280Ah", "储能-314Ah"];

  // WorkOrders: 2 per line (deterministic, using rngMES)
  for (const l of lines) {
    const lineId = l.lineId as string;
    const baseId = l.baseId as string;
    for (let w = 0; w < 2; w++) {
      const modelId = WO_MODELS[hashString(`${lineId}_wo${w}`) % WO_MODELS.length]!;
      const qtyPlanned = round((500 + (hashString(`${lineId}_wo${w}q`) % 1500)) * WAVE1_SCALE_FACTOR, 0);
      const qtyActual = Math.floor(qtyPlanned * (0.85 + (hashString(`${lineId}_wo${w}a`) % 15) / 100));
      const startOffset = hashString(`${lineId}_wo${w}s`) % 14;
      const startDate = isoDate(t0 + startOffset * 86400000);
      const endDate = isoDate(t0 + (startOffset + 7 + (hashString(`${lineId}_wo${w}e`) % 7)) * 86400000);
      const woId = `WO-${lineId}-${w}`;
      workOrders.push({
        woId,
        moNo: `MO-${woId}`,
        modelId,
        lineId,
        baseId,
        qtyPlanned,
        qtyActual,
        startDate,
        endDate,
        // WO-INVENTORY-3TIER：状态确定性铺满 4 态（此前 w%4 仅取到 已排产/生产中·从无完工单 →
        // 完工入库派生无源）。改按 woId 哈希铺满 → 约半数 已完成/已关闭 可承接 FG 入库（R6 确定性）。
        status: MES_STATUSES.wo[hashString(`${woId}_status`) % MES_STATUSES.wo.length]!,
      });

      // ProductionSchedule per WorkOrder: 2-3 schedules
      const nSched = 2 + (hashString(woId) % 2);
      for (let s = 0; s < nSched; s++) {
        productionSchedules.push({
          schedId: `SCH-${woId}-${s}`,
          woId,
          lineId,
          shift: s % 2 === 0 ? "白班" : "夜班",
          scheduledDate: isoDate(t0 + (startOffset + s) * 86400000),
          qty: Math.floor(qtyPlanned / nSched),
          priority: 1 + (hashString(`${woId}_sch${s}`) % 5),
          status: MES_STATUSES.sched[s % MES_STATUSES.sched.length],
        });
      }

      // WIPLot per WorkOrder
      const wipQty = Math.floor(qtyPlanned * 0.9);
      const wipStatus = MES_STATUSES.wip[hashString(`${woId}_wip`) % MES_STATUSES.wip.length];
      wipLots.push({
        lotId: `LOT-${woId}`,
        woId,
        modelId,
        lineId,
        currentProcess: "涂布",
        qty: wipQty,
        status: wipStatus,
        startTime: startDate,
        lastMoveTime: isoDate(t0 + (startOffset + 2) * 86400000),
      });

      // WIPMove per WIPLot: 2-4 moves
      const processesMES = ["涂布", "辊压", "分切", "卷绕", "装配", "注液", "化成", "分容"];
      const nMoves = 2 + (hashString(`${woId}_move`) % 3);
      for (let m = 0; m < nMoves; m++) {
        wipMoves.push({
          moveId: `MV-${woId}-${m}`,
          lotId: `LOT-${woId}`,
          fromProcess: processesMES[m],
          toProcess: processesMES[m + 1] ?? "PACK",
          qty: Math.floor(wipQty * (0.9 + (hashString(`${woId}_mv${m}`) % 10) / 100)),
          moveTime: isoDate(t0 + (startOffset + m) * 86400000),
          operatorId: `OP-${hashString(`${woId}_op${m}`) % 100}`,
        });
      }

      // WIPQualityCheckpoint per WIPLot: 1-2 checkpoints
      const nChk = 1 + (hashString(`${woId}_chk`) % 2);
      for (let c = 0; c < nChk; c++) {
        wipQualityCheckpoints.push({
          checkpointId: `CHK-${woId}-${c}`,
          lotId: `LOT-${woId}`,
          processName: processesMES[c + 2] ?? "化成",
          checkType: ["首检", "巡检", "末检"][hashString(`${woId}_ct${c}`) % 3],
          result: hashString(`${woId}_cr${c}`) % 10 < 9 ? "通过" : "不通过",
          checkTime: isoDate(t0 + (startOffset + c + 1) * 86400000),
          inspectorId: `INSP-${hashString(`${woId}_insp${c}`) % 20}`,
        });
      }

      // QualityLot per WorkOrder
      const batchSize = qtyPlanned;
      const sampleSize = Math.max(5, Math.floor(batchSize * 0.02));
      const passQty = Math.floor(sampleSize * (0.92 + (hashString(`${woId}_qp`) % 8) / 100));
      const failQty = sampleSize - passQty;
      qualityLots.push({
        qlotId: `QLOT-${woId}`,
        woId,
        modelId,
        lineId,
        batchSize,
        sampleSize,
        passQty,
        failQty,
        status: failQty === 0 ? "合格" : failQty < 3 ? "特采" : "不合格",
        inspectDate: endDate,
      });

      // InspectionResult per QualityLot (simplified: 2 results)
      for (let r = 0; r < 2; r++) {
        const measured = 0.95 + (hashString(`${woId}_ir${r}`) % 10) / 100;
        inspectionResults.push({
          resultId: `IR-${woId}-${r}`,
          qlotId: `QLOT-${woId}`,
          charId: `CHAR-QS-${modelId}-CAP-${r}`,
          measuredValue: round(measured, 3),
          targetValue: 0.98,
          upperLimit: 1.0,
          lowerLimit: 0.95,
          result: measured >= 0.95 ? "合格" : "不合格",
          inspectTime: endDate,
        });
      }

      // DefectRecord (sparse: ~30% of WOs)
      if (hashString(`${woId}_def`) % 3 === 0) {
        defectRecords.push({
          defectId: `DEF-${woId}`,
          qlotId: `QLOT-${woId}`,
          lotId: `LOT-${woId}`,
          defectType: MES_STATUSES.defect[hashString(`${woId}_dt`) % MES_STATUSES.defect.length],
          severity: MES_STATUSES.severity[hashString(`${woId}_sev`) % MES_STATUSES.severity.length],
          qty: 1 + (hashString(`${woId}_dq`) % 5),
          description: "过程异常",
          foundAt: isoDate(t0 + (startOffset + 3) * 86400000),
          processName: "涂布",
        });
      }
    }
  }

  // EquipmentOEE / Downtime / Alarm per equipment (daily snapshot for past 7 days)
  const today = t0;
  for (const eq of equipment) {
    const equipId = eq.equipId as string;
    const lineId = eq.lineId as string;
    const baseId = eq.baseId as string;
    // OEE snapshot for past 7 days
    for (let d = 0; d < 7; d++) {
      const avail = round(0.85 + (hashString(`${equipId}_oee${d}`) % 15) / 100, 3);
      const perf = round(0.88 + (hashString(`${equipId}_perf${d}`) % 10) / 100, 3);
      const qual = round(0.95 + (hashString(`${equipId}_qual${d}`) % 5) / 100, 3);
      equipmentOEEs.push({
        oeeId: `OEE-${equipId}-${d}`,
        equipId,
        lineId,
        baseId,
        date: isoDate(today - d * 86400000),
        availability: avail,
        performance: perf,
        quality: qual,
        oee: round(avail * perf * qual, 3),
        plannedProductionTime: 480,
        actualProductionTime: round(480 * avail, 0),
      });
    }
    // Downtime (sparse: ~20% of equipment)
    if (hashString(`${equipId}_dt`) % 5 === 0) {
      const dur = 15 + (hashString(`${equipId}_dur`) % 120);
      equipmentDowntimes.push({
        dtId: `DT-${equipId}`,
        equipId,
        lineId,
        baseId,
        startTime: isoDate(today - (hashString(`${equipId}_dts`) % 3) * 86400000) + "T08:00:00Z",
        endTime: isoDate(today - (hashString(`${equipId}_dts`) % 3) * 86400000) + `T${String(8 + Math.floor(dur / 60)).padStart(2, "0")}:${String(dur % 60).padStart(2, "0")}:00Z`,
        durationMin: dur,
        reason: MES_STATUSES.dtReason[hashString(`${equipId}_dtr`) % MES_STATUSES.dtReason.length],
        status: "已恢复",
      });
    }
    // Alarm (sparse: ~15% of equipment)
    if (hashString(`${equipId}_al`) % 7 === 0) {
      equipmentAlarms.push({
        alarmId: `ALM-${equipId}`,
        equipId,
        lineId,
        alarmCode: `ALM-${hashString(`${equipId}_ac`) % 100}`,
        alarmLevel: MES_STATUSES.alarmLevel[hashString(`${equipId}_alv`) % MES_STATUSES.alarmLevel.length],
        message: "设备异常告警",
        triggeredAt: isoDate(today - (hashString(`${equipId}_at`) % 2) * 86400000) + "T10:00:00Z",
        clearedAt: isoDate(today - (hashString(`${equipId}_at`) % 2) * 86400000) + "T12:00:00Z",
        status: "已清除",
      });
    }
  }

  // MaintenanceOrder per equipment (sparse: ~25%)
  for (const eq of equipment) {
    const equipId = eq.equipId as string;
    if (hashString(`${equipId}_mo`) % 4 !== 0) continue;
    const lineId = eq.lineId as string;
    const baseId = eq.baseId as string;
    const moId = `MO-${equipId}`;
    const plannedStartOffset = hashString(`${equipId}_ps`) % 14;
    const plannedEndOffset = plannedStartOffset + 1 + (hashString(`${equipId}_pe`) % 3);
    maintenanceOrders.push({
      moId,
      equipId,
      lineId,
      baseId,
      maintType: MES_STATUSES.maintType[hashString(`${equipId}_mt`) % MES_STATUSES.maintType.length],
      priority: MES_STATUSES.maintPriority[hashString(`${equipId}_mp`) % MES_STATUSES.maintPriority.length],
      plannedStart: isoDate(t0 + plannedStartOffset * 86400000),
      plannedEnd: isoDate(t0 + plannedEndOffset * 86400000),
      actualStart: isoDate(t0 + plannedStartOffset * 86400000),
      actualEnd: isoDate(t0 + (plannedEndOffset - 1) * 86400000),
      status: "已完成",
    });
    // SparePartConsumption per MaintenanceOrder
    sparePartConsumptions.push({
      consumptionId: `SPC-${moId}`,
      moId,
      partCode: `PART-${hashString(`${equipId}_part`) % 100}`,
      partName: "备件",
      qtyUsed: 1 + (hashString(`${equipId}_pq`) % 5),
      unit: "个",
      consumedAt: isoDate(t0 + plannedStartOffset * 86400000),
    });
  }

  // ShiftPlan per line (2 shifts per day for 7 days)
  for (const l of lines) {
    const lineId = l.lineId as string;
    const baseId = l.baseId as string;
    for (let d = 0; d < 7; d++) {
      for (const shiftName of ["白班", "夜班"]) {
        const plannedHC = 8 + (hashString(`${lineId}_sh${d}_${shiftName}`) % 8);
        const actualHC = Math.max(0, plannedHC - (hashString(`${lineId}_ah${d}_${shiftName}`) % 3));
        shiftPlans.push({
          shiftId: `SHIFT-${lineId}-${d}-${shiftName}`,
          lineId,
          baseId,
          shiftName: `${l.name}${shiftName}`,
          plannedHeadcount: plannedHC,
          actualHeadcount: actualHC,
          date: isoDate(t0 + d * 86400000),
          hours: shiftName === "白班" ? 11 : 11,
        });
      }
    }
  }

  // OperatorAttendance per line (2 operators per shift, 7 days)
  const operatorPool = Array.from({ length: 50 }, (_, i) => ({ id: `OP-${String(i + 1).padStart(3, "0")}`, name: `操作工${i + 1}` }));
  for (const l of lines) {
    const lineId = l.lineId as string;
    const baseId = l.baseId as string;
    for (let d = 0; d < 7; d++) {
      for (const shiftName of ["白班", "夜班"]) {
        const op = operatorPool[hashString(`${lineId}_att${d}_${shiftName}`) % operatorPool.length]!;
        const hours = 10 + (hashString(`${lineId}_hrs${d}_${shiftName}`) % 2);
        operatorAttendances.push({
          attId: `ATT-${lineId}-${d}-${shiftName}`,
          operatorId: op.id,
          operatorName: op.name,
          lineId,
          baseId,
          date: isoDate(t0 + d * 86400000),
          shift: shiftName,
          checkIn: isoDate(t0 + d * 86400000) + "T08:00:00Z",
          checkOut: isoDate(t0 + d * 86400000) + `T${String(8 + hours).padStart(2, "0")}:00:00Z`,
          hoursWorked: hours,
          status: MES_STATUSES.attStatus[hashString(`${lineId}_as${d}_${shiftName}`) % MES_STATUSES.attStatus.length],
        });
      }
    }
  }

  // OperatorSkillCert (deterministic per operator)
  const skillPool = ["涂布操作", "卷绕操作", "化成操作", "PACK操作", "质检操作"];
  for (const op of operatorPool) {
    const nSkills = 1 + (hashString(op.id) % 3);
    for (let s = 0; s < nSkills; s++) {
      const skill = skillPool[hashString(`${op.id}_sk${s}`) % skillPool.length]!;
      operatorSkillCerts.push({
        certId: `CERT-${op.id}-${s}`,
        operatorId: op.id,
        skillName: skill,
        skillLevel: MES_STATUSES.skillLevel[hashString(`${op.id}_sl${s}`) % MES_STATUSES.skillLevel.length],
        certifiedBy: "培训部",
        certifiedDate: "2024-01-15",
        expireDate: "2026-01-15",
        status: MES_STATUSES.certStatus[hashString(`${op.id}_cs${s}`) % MES_STATUSES.certStatus.length],
      });
    }
  }

  // WO-EXCEPTION-EVENT：四源归一异常事件投影（本地 4 源：停机/告警/缺陷/缺料 → EQUIPMENT/QUALITY/MATERIAL_SHORTAGE）。
  // 独立于 mulberry32 主流（纯从已生成源行派生·无随机/时钟），不移位下游字节（R6）。
  // 第 5 源 TriggerRule（→CUSTOMER）在 service 层合并（triggerRules 出自 generateExtended，同一 projectExceptionEvents）。
  const exceptionEvents = projectExceptionEvents(
    { equipmentDowntimes, equipmentAlarms, defectRecords, materialBalances },
    t0,
  );

  // WO-INVENTORY-3TIER · 完工入库派生（确定性·从 workOrders 真值派生 FG + RECEIPT 流水；无 rng/时钟·R6）。
  // 成品仓落点：每基地成品仓（whType=FINISHED，WO-WAREHOUSE 每基地必有）。asOf=预测起点 t0。
  const finishedWhByBase = new Map<string, string>();
  for (const w of warehouses) {
    if (w.whType === "FINISHED") finishedWhByBase.set(String(w.baseId), String(w.warehouseId));
  }
  const { finishedGoodsInv, inventoryTxns } = deriveFinishedGoodsIntake(workOrders, finishedWhByBase, isoDate(t0));

  // WO-ATP-PROMISE · 订单承诺台账（对每 OPEN 订单净读三源算 ATP 基线·与 atp_check 同口径·无 rng/时钟·R6）。
  // 放在 FG 派生后：需现货(FG)/在制(workOrders)/产能(lines) 三源已就绪；纯派生不消耗 rng（不插既有流中间）。
  const orderPromises = deriveOrderPromises(orders, finishedGoodsInv, workOrders, lines, isoDate(t0));

  // WO-INTERBASE-TRANSFER：跨基地调拨台账（一等对象·R13）。
  // 配对规则：对每个多产地型号（MODEL_BASE_MAP ≥2 基地），在其可产基地相邻对间产一条调拨
  //（bases[i]→bases[i+1]，如 4680-NCM: 常州→成都→合肥→金华 得 3 条），基地全取自 MODEL_BASE_MAP
  //（其值域已是 BASE_REGISTRY baseId·不内联新基地字面量，守 R14/boundary-singlesource）。
  // qty/transitDays/dispatchDay 由独立哈希子流 hashString("xfer_"+from+to+model) 派生（不插既有 rng 流·R6 字节基线不动）；
  // etaDay 由 derivedProperties(dispatchDay+transitDays) 管线算；etaDate/dispatchDate 为 ISO 展示（无时钟）。
  const xferT0 = Date.parse(`${BATTERY_SOLVER_PARAMS.forecastStart as string}T00:00:00Z`);
  const baseNameById = new Map(bases.map((b) => [b.baseId as string, b.name as string]));
  const XFER_STATUS = ["PLANNED", "IN_TRANSIT", "DELIVERED"] as const;
  // WO-GSIM-1-DATA · 物流费率常数（R14·BATTERY_SOLVER_PARAMS 单一来源·不内联魔数）。
  const ibp = BATTERY_SOLVER_PARAMS.interbase as { dailyTruckKm: number; minTransitDays: number; tonKmRate: number; qtyToTon: number };
  // 距离派生在途天数（灭 G-TRANSIT-NOT-GEO）：ceil(距/日卡车里程)，下限 minTransitDays（同区非 0）。
  const transitDaysFor = (fromId: string, toId: string): number =>
    Math.max(ibp.minTransitDays, Math.ceil(baseDistanceKm(fromId, toId) / ibp.dailyTruckKm));
  // 运费（灭 G-NO-FREIGHT-COST）：距 × 吨公里费率 × (套×吨/套)；同基地 距=0 → 费=0。确定性（无 rng·R6）。
  const freightCostFor = (fromId: string, toId: string, qty: number): number =>
    Math.round(baseDistanceKm(fromId, toId) * ibp.tonKmRate * (qty * ibp.qtyToTon));
  const interBaseTransfers: Record<string, unknown>[] = [];
  for (const [modelId, producibleBases] of Object.entries(MODEL_BASE_MAP)) {
    for (let i = 0; i + 1 < producibleBases.length; i++) {
      const fromId = producibleBases[i]!;
      const toId = producibleBases[i + 1]!;
      const h = hashString(`xfer_${fromId}_${toId}_${modelId}`);
      const qty = 500 + (h % 46) * 100; // 500..5000 套
      const transitDays = transitDaysFor(fromId, toId); // 距离派生（非哈希·G-TRANSIT-NOT-GEO）
      const dispatchDay = 1 + (Math.floor(h / 1000) % 20); // 1..20（相对 forecastStart）
      const etaDay = dispatchDay + transitDays; // 与 derivedProperties 同式（materialize 早填，管线重算不变·R6）
      const freightCost = freightCostFor(fromId, toId, qty); // 距离×费率派生（G-NO-FREIGHT-COST）
      const status = XFER_STATUS[h % XFER_STATUS.length]!;
      const fromName = baseNameById.get(fromId) ?? fromId;
      const toName = baseNameById.get(toId) ?? toId;
      interBaseTransfers.push({
        transferId: `XFER-${fromId}-${toId}-${modelId}`,
        fromBase: fromId,
        toBase: toId,
        model: modelId,
        qty,
        transitDays,
        freightCost,
        status,
        dispatchDate: isoDate(xferT0 + dispatchDay * 86400000),
        dispatchDay,
        etaDay,
        etaDate: isoDate(xferT0 + etaDay * 86400000),
        reason: `${fromName}→${toName} ${modelId} 产能调剂`,
      });
    }
  }
  // WO-GSIM-1-DATA T5 · 电芯→电池包两段制跨基地供芯样本（G-CELL-PACK-2STAGE·SEAM 物料）。
  // 每个纯 PACK 基地（factory_type==="PACK"）由 cellSourceMap 就近首选 CELL/CELL+PACK 基地供芯，
  // 落成真 InterBaseTransfer（fromBase=就近芯厂→toBase=PACK 厂），令「供芯图（数据）× 调拨事实」接缝可查。
  // model 取该 PACK 基地在 MODEL_BASE_MAP 的首个可产型号（reverse map·芯型即包型）。纯确定性（无 rng·R6）。
  const modelByBase = new Map<string, string>();
  for (const [mId, bs] of Object.entries(MODEL_BASE_MAP)) for (const bid of bs) if (!modelByBase.has(bid)) modelByBase.set(bid, mId);
  const csMap = cellSourceMap(bases as { baseId: string; factory_type?: string }[]);
  for (const [packBaseId, sources] of Object.entries(csMap)) {
    const nearest = sources[0];
    const modelId = modelByBase.get(packBaseId);
    if (!nearest || !modelId) continue;
    const h = hashString(`cellxfer_${nearest}_${packBaseId}_${modelId}`);
    const qty = 800 + (h % 30) * 100; // 800..3700 套（电芯批量→包装配）
    const transitDays = transitDaysFor(nearest, packBaseId);
    const dispatchDay = 1 + (Math.floor(h / 1000) % 20);
    const etaDay = dispatchDay + transitDays;
    const freightCost = freightCostFor(nearest, packBaseId, qty);
    const status = XFER_STATUS[h % XFER_STATUS.length]!;
    const fromName = baseNameById.get(nearest) ?? nearest;
    const toName = baseNameById.get(packBaseId) ?? packBaseId;
    interBaseTransfers.push({
      transferId: `XFER-CELL-${nearest}-${packBaseId}-${modelId}`,
      fromBase: nearest,
      toBase: packBaseId,
      model: modelId,
      qty,
      transitDays,
      freightCost,
      status,
      dispatchDate: isoDate(xferT0 + dispatchDay * 86400000),
      dispatchDay,
      etaDay,
      etaDate: isoDate(xferT0 + etaDay * 86400000),
      reason: `${fromName}→${toName} ${modelId} 电芯→电池包就近供芯`,
    });
  }

  return { bases, models, orders, productPlatforms, productSeries, productVersions, bomHeaders, bomDetails, routings, operations, processCapabilities, qualityStandards, inspectionCharacteristics, productLineCapabilities, productEquipmentCapabilities, engineeringChanges, materialAlternatives, workshops, lines, processes, equipment, maintPlans, segments, shipments, warehouses, interBaseTransfers, dataHealth, demandSegments, financePlans, materialBalances, metrics, ksfs, principals, rootCauseChains, sopVersionRows, certLinks, workOrders, productionSchedules, shiftPlans, wipLots, wipMoves, wipQualityCheckpoints, qualityLots, inspectionResults, defectRecords, equipmentOEEs, equipmentDowntimes, equipmentAlarms, exceptionEvents, maintenanceOrders, sparePartConsumptions, operatorAttendances, operatorSkillCerts, finishedGoodsInv, inventoryTxns, orderPromises, orderLines };
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
