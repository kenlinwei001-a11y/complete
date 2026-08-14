/**
 * DF.1 单一来源基地册（GenerationBoundary Part A · VOCAB+TOPOLOGY 接地脊柱）。
 * 跨包唯一真相源：datacore 种子（battery.ts BASES）与前端 mock（fixtures.ts BASES /
 * simSolvers.ts MOCK_BASES）皆从此派生各自表示——消灭"改一处崩前后端不同步"漂移（G-5/R14）。
 * 命名以 HTML 参考原型 BASE_DATA 为准（用户裁决 2026-06-23）。
 * R6：本册是数据常量，迁移后各消费端派生值**字节复现当前值**（boundary-singlesource 守门）。
 *
 * 字段 = 三消费端并集：
 *  - datacore BASES 用 {baseId,name,kind,lon,lat}
 *  - 前端 fixtures BASES 用 {id=base-${name},name,util,bottleneck,gwh,position,lines,prodYear,mainProduct,lon,lat}
 *  - 前端 simSolvers MOCK_BASES 用 {name,kind}
 * kind（动力/储能/动力+储能，业态）与 position（动力/储能/混合，前端配色档）显式并存、不互推，避免映射偏差。
 */
import { ruleParamRef } from "./datacore.js";

export interface CanonicalBase {
  baseId: string; // datacore 拼音 id（changzhou…）
  name: string; // 中文名（跨端共同 key）
  kind: "动力" | "储能" | "动力+储能"; // datacore/MOCK_BASES 业态
  position: "动力" | "储能" | "混合"; // 前端 fixtures 配色档（混合 = 动力+储能）
  lon: number;
  lat: number;
  util: number; // 前端 mock 利用率
  gwh: number; // 前端 mock 产能
  bottleneck: string; // 前端 mock 瓶颈工序
  lines: number;
  prodYear: number;
  mainProduct: string;
}

/**
 * DF.3 单一来源应用细分册（GenerationBoundary · VOCAB+ENUM+RANGE）。
 * 原型 SEG（万元/套单价 + 毛利%/底线% + 配色）此前重复在 battery SEGMENTS / audit.segMargins /
 * 前端 econ / simSolvers / SEG_COLOR 多处——统一为唯一来源，各端派生（值字节复现，R6）。
 * 注：risk.ts affectedOrders 的 SEG_PRICE{0.6…} 是另一营收口径，DF.3b 单独统一（值变、非搬家）。
 */
export interface CanonicalSeg {
  seg: string; // 乘用车/储能/商用车（前端中文 key）
  key: "pas" | "ess" | "com"; // 拼音（audit/risk key）
  priceWan: number; // 万元/套
  marginPct: number; // 毛利率 %
  floorPct: number; // 毛利底线 %
  color: string; // 配色
}

export const SEG_REGISTRY: CanonicalSeg[] = [
  { seg: "乘用车", key: "pas", priceWan: 2.2, marginPct: 19, floorPct: 12, color: "#5E8FE8" },
  { seg: "储能", key: "ess", priceWan: 1.4, marginPct: 13, floorPct: 11, color: "#36BFA5" },
  { seg: "商用车", key: "com", priceWan: 1.8, marginPct: 15, floorPct: 11, color: "#DD9551" },
];

/**
 * WO-SCALE-COHERENCE · 尺度自洽锚常数（round-trip 单一来源 · R14 · R18）。
 * 病根（G-SCALE-COHERENCE）：物理(Base.gwh)/需求(DemandSegment)/产能(weeklyWan)/财务(AnnualScenario)/订单
 * 五层各自独立造、gwh 与"套(pack)"之间无任何换算常数把它们焊在一起 → 差 25~300× 不 round-trip。
 * 本册立唯一桥常数：
 *  - `packEnergyKwh`：能量/套(kWh) —— gwh↔套 的唯一换算常数（scale 无关物理常数）。
 *    名牌套 = Σ(Base.gwh)×1e6/packEnergyKwh；有效套/年 = 名牌套×util。取值令有效产能≈需求锚 375 万套（略低留缺口→供需缺口可归因）。
 *  - `operatingDaysPerYear`：年运营日 —— capacityDaily/max_capacity_day 年化口径（与 battery ×300/1e4 一致）。
 *  - `scaleAnchorRevenue`：各 scale 档目标年营收锚（亿）。S=700（= 既有 DemandSegment/CEO-Metric 锚，不动）；
 *    M/L/XL 按订单规模系数(20/300/825/10000)同比给锚（数据量档位；物理/需求册跨档不变，故 S 档为业务锚）。
 * 三常数随 BASE/SEG/PLAN 进 boundaryVersion() 指纹（改锚→digest 变，可审计/跨服务缓存失效）。
 * R6：纯常数，同 seed 字节一致。消费端 datacore/synthetic/battery.ts 派生产能/单价（禁内联魔数）。
 */
export const packEnergyKwh = 166;
export const operatingDaysPerYear = 300;
export type ScaleTier = "S" | "M" | "L" | "XL";
export const scaleAnchorRevenue: Record<ScaleTier, number> = {
  S: 700,
  M: 10500, // 700 × 300/20（订单规模系数）
  L: 28875, // 700 × 825/20
  XL: 350000, // 700 × 10000/20
};

// Wave 1 (#59)：基地产能同步放大到 700 亿收入 / 375 万套年需求规模。
// 缩放系数 SCALE = 375万套 / 132万套 ≈ 2.84（由 SEG_DEMAND 总需求推导，不硬编码在消费端）。
// gwh/lines 为产能指标随需求同比放大；util 为利用率百分比保持原设计区间；
// 所有消费端从 BASE_REGISTRY 派生，改一处全局同步（DF.1/G-5/R14）。
export const WAVE1_SCALE_FACTOR = 2.84;

export const BASE_REGISTRY: CanonicalBase[] = [
  { baseId: "changzhou", name: "常州", kind: "动力+储能", position: "混合", lon: 119.95, lat: 31.78, util: 88, gwh: 99.4, bottleneck: "化成柜", lines: 23, prodYear: 2015, mainProduct: "4680-NCM" },
  { baseId: "xiamen", name: "厦门", kind: "动力", position: "动力", lon: 118.1, lat: 24.46, util: 85, gwh: 79.5, bottleneck: "化成柜", lines: 17, prodYear: 2019, mainProduct: "VDA-NCM" },
  { baseId: "chengdu", name: "成都", kind: "动力+储能", position: "混合", lon: 104.07, lat: 30.67, util: 82, gwh: 85.2, bottleneck: "老化库", lines: 20, prodYear: 2018, mainProduct: "4680-LFP" },
  { baseId: "meishan", name: "眉山", kind: "储能", position: "储能", lon: 103.83, lat: 30.05, util: 79, gwh: 62.5, bottleneck: "化成柜", lines: 15, prodYear: 2021, mainProduct: "储能-280Ah" },
  { baseId: "wuhan", name: "武汉", kind: "动力", position: "动力", lon: 114.3, lat: 30.59, util: 80, gwh: 56.8, bottleneck: "涂布机", lines: 15, prodYear: 2022, mainProduct: "VDA-NCM" },
  { baseId: "jiangmen", name: "江门", kind: "储能", position: "储能", lon: 113.08, lat: 22.58, util: 83, gwh: 73.8, bottleneck: "老化库", lines: 17, prodYear: 2021, mainProduct: "储能-280Ah" },
  { baseId: "hefei", name: "合肥", kind: "动力", position: "动力", lon: 117.28, lat: 31.86, util: 78, gwh: 56.8, bottleneck: "化成柜", lines: 15, prodYear: 2022, mainProduct: "4680-NCM" },
  { baseId: "xinyang", name: "信阳", kind: "储能", position: "储能", lon: 114.09, lat: 32.13, util: 75, gwh: 45.4, bottleneck: "涂布机", lines: 12, prodYear: 2023, mainProduct: "储能-314Ah" },
  { baseId: "zaozhuang", name: "枣庄", kind: "动力+储能", position: "混合", lon: 117.32, lat: 34.81, util: 73, gwh: 42.6, bottleneck: "化成柜", lines: 12, prodYear: 2023, mainProduct: "4680-LFP" },
  { baseId: "handan", name: "邯郸", kind: "储能", position: "储能", lon: 114.49, lat: 36.61, util: 70, gwh: 34.1, bottleneck: "老化库", lines: 9, prodYear: 2023, mainProduct: "储能-314Ah" },
  { baseId: "zigong", name: "自贡", kind: "动力", position: "动力", lon: 104.78, lat: 29.34, util: 77, gwh: 45.4, bottleneck: "化成柜", lines: 12, prodYear: 2022, mainProduct: "刀片-LFP" },
  { baseId: "jinhua", name: "金华", kind: "动力", position: "动力", lon: 119.65, lat: 29.08, util: 76, gwh: 39.8, bottleneck: "化成柜", lines: 12, prodYear: 2023, mainProduct: "刀片-LFP" },
  { baseId: "yangzhou", name: "扬州", kind: "储能", position: "储能", lon: 119.42, lat: 32.40, util: 72, gwh: 36.9, bottleneck: "涂布机", lines: 9, prodYear: 2023, mainProduct: "储能-314Ah" },
];

/**
 * DF.4 单一来源规划目标阈值册（GenerationBoundary · VOCAB+RANGE）。
 * 方案生成(plan_generate)的经营目标基线此前**三处重复**：后端 `synthetic/battery.ts planGenerate.targets`
 * （gmFloor 小数口径）· 前端 `PlanGenerateView DEFAULT_GOALS` 兜底（gmFloorPct 百分口径）·
 * 前端 mock `fixtures.ts planGoals`（WorkspaceConfig 下发）——改一处即三处漂移（G-5/R14）。
 * 统一为唯一来源：**canonical 取百分口径**（`gmFloorPct`，前端直用、后端 ÷100 派生小数 gmFloor，
 * R6 字节复现当前值：15.5/100===0.155 精确）。各端派生由 boundary-singlesource 门守不回潮。
 * 注：审计阈值(audit.*)与方案库(risk.mitigations)只在 battery.ts 一处、前端经 API 消费 → 已单一来源，
 * 不入此册（迁移=纯搬家且 audit 校准耦合，无去漂价值）。
 */
export const PLAN_GOAL_TARGETS = {
  revGrowthPct: 18, // 营收增长目标 %
  gmFloorPct: 15.5, // 毛利率底线 %（后端 gmFloor=gmFloorPct/100）
  sharePts: 12, // 份额提升 pct
  capexCap: 20, // CAPEX 上限 亿
  cashFloor: 50, // 现金垫底线 亿
  turns: 6.0, // 库存周转目标 次（后端 turnsFloor / 前端 invTurns）
} as const;

/**
 * DF.13 外协比例红线单一来源 `OUTSOURCE_REDLINE`（规则 **C08** · GenerationBoundary · VOCAB+RANGE · R14/R-一致）。
 *
 * ── 这是什么 ──────────────────────────────────────────────────────────────
 * 「外协红线」= 一张订单允许外包给第三方代工的最大比例。超过即质量管控失控 + 毛利被外协费侵蚀，
 * 故为一条**业务红线**（`severity=WARN`：保交付但必须提示，不硬拦）。
 *
 * ── 单位（读之前先看这行，历史事故就出在这）──────────────────────────────
 * `maxRatio` 的单位是**比率 0–1**，不是百分数：20% ⇒ `0.2`。
 * 任何需要「20%」字样的用户可见文案**一律经 `outsourceRedlinePct()` 格式化**，禁止手写百分数——
 * 手写的那个数就是下次漂移的种子。
 *
 * ── 谁在用（消费端全集，`outsource-redline:check` 逐个强制派生）────────────
 *  A. 规则表达式：`datacore synthetic/battery.ts rules[C08]`（现行发布态）·
 *     `datacore livedin/engine.ts`（版本演进 + 版本史）· 前端 `mocks/livedInFixtures.ts`（版本史 mock）·
 *     前端 `mocks/fixtures.ts`（A2 规则抽取候选/已发布规则 mock）
 *  B. 求解器：`solvers/extended.ts outsourcingSplit`（外协渠道上限 = 总需求 × maxRatio）·
 *     `solvers/extended.ts quarterlyGap`（外协对策释放量）· `solvers/capacity.ts` what-if 拒绝判定
 *     （经 `BATTERY_SOLVER_PARAMS.whatIf.outsourceMax`）· 前端 `mocks/simSolvers.ts`（前端 mock 镜像）
 *  C. 用户可见文案：`capacity.ts`/`simSolvers.ts` 拒绝原因 · 前端 i18n `zh.ts outsourceCap`
 *  D. 合成数据：`synthetic/battery.ts` 订单 `outsourceRatio` 的植入越线样本与合规桶（见 `OUTSOURCE_SAMPLE`）
 *  E. AgentCore mock DataCore：`agentcore mocks/clients.ts c08Threshold`
 *
 * ── 为什么立册（真实病灶）────────────────────────────────────────────────
 * 迁移前**同一条红线有 6 个不同的数**：标准合成规则 `> 0.3` / livedin 发布态 `> 0.2` /
 * 三个求解器按 `0.2` 算 / 前端 mock 写成 `Outsource.ratio <= 0.2`（主体与极性都另一套）/
 * AgentCore mock `c08Threshold = 0.3` / 契约 `livedin.ts` 知识库答案自称「年初 v1.0 为 ≤25%」（实为 30%）。
 * 屏幕上显示 20%、引擎按 20% 算、规则库却写 30% —— 规则与推演各说各话，且**测试全绿**。
 * 仓主裁定：取 **20%**（红线只收紧不放松），并把「再次不一致」变成结构上不可能。
 *
 * R6：纯常数，同 seed 字节一致。`OUTSOURCE_REDLINE_HISTORY` 里的 30%/25%/22% 是**已退役的历史值**
 * （非重复定义）——版本史是数据，现行值只有 `OUTSOURCE_REDLINE.maxRatio` 一个出处。
 */
export const OUTSOURCE_REDLINE = {
  /** 规则码（DataCore 规则库 key）。 */
  ruleKey: "C08",
  ruleName: "外协比例红线",
  /** 规则 DSL 取值路径（违规谓词的主体）。 */
  subject: "Order.outsourceRatio",
  /** ★ 唯一真值：现行外协比例上限。单位 = **比率 0–1**（20% ⇒ 0.2）。 */
  maxRatio: 0.2,
  /** 规则 `params` 里承载该上限的命名阈值键（发布态表达式引用它，见 `outsourceRedlineViolationExpr`）。 */
  paramKey: "outsourceRatioMax",
  /** WARN = 保交付但提示风险（不 BLOCK：外协是兜底手段，硬拦会把缺口变成断供）。 */
  severity: "WARN",
  category: "外协",
  /** 现行版本标签（与 `OUTSOURCE_REDLINE_HISTORY` 末条一致）。 */
  versionLabel: "v1.3",
} as const;

/** 比率 → 百分数（20% 口径的**唯一格式化出口**；`0.2 → 20`）。文案禁止手写百分数。 */
export function outsourceRedlinePct(ratio: number = OUTSOURCE_REDLINE.maxRatio): number {
  return Math.round(ratio * 1000) / 10;
}

/**
 * 规则引擎口径的**违规谓词**（表达式为真 ⇒ `passed=false`）：`Order.outsourceRatio > 0.2`。
 * DataCore 规则 DSL 一律用这个方向（见 `synthetic/battery.ts rules[]` 注释）。
 *
 * 第二参数两种口径，**按用途选，别混**（WO-RULE-EXPR-PARAMS）：
 *  · `number`（默认）→ 渲染成**字面量**：`Order.outsourceRatio > 0.2`。
 *    用于**版本史/已退役快照**——历史上那一版的阈值就是那个数，是数据，不该随现行 params 漂。
 *  · `{ param }` → 渲染成**命名阈值引用**：`Order.outsourceRatio > params.outsourceRatioMax`。
 *    用于**发布态规则**——阈值只存 `rule.params` 一处，改 params 即同时改判定与推演
 *    （否则就是 G-C08-EXPR-PARAM-SPLIT：expression 与 params 两个数各自可编辑、谁也不校验谁）。
 */
export function outsourceRedlineViolationExpr(
  subject: string = OUTSOURCE_REDLINE.subject,
  ratio: number | { param: string } = OUTSOURCE_REDLINE.maxRatio,
): string {
  const right = typeof ratio === "number" ? String(ratio) : ruleParamRef(ratio.param);
  return `${subject} > ${right}`;
}

/** 发布态 C08 违规谓词（阈值单存 `params.outsourceRatioMax`，expression 只引用不复制）。 */
export function outsourceRedlineViolationExprPublished(): string {
  return outsourceRedlineViolationExpr(OUTSOURCE_REDLINE.subject, { param: OUTSOURCE_REDLINE.paramKey });
}

/**
 * 文档口径的**约束式**（人读的「不得超过」，如 A2 规则抽取候选的原文映射）：`Outsource.ratio <= 0.2`。
 * ⚠ 与 `outsourceRedlineViolationExpr` **极性相反**——同一个数、两种渲染，别混用：
 * 喂规则引擎必须用违规谓词式，否则语义反转（详见 DF.13 报告的极性说明）。
 */
export function outsourceRedlineConstraintExpr(
  subject: string,
  ratio: number = OUTSOURCE_REDLINE.maxRatio,
): string {
  return `${subject} <= ${ratio}`;
}

/** 外协渠道**产能上限** = 总量 × 红线（求解器分配用；总量可为总需求或缺口，由调用方定义）。 */
export function outsourceRedlineCap(total: number, ratio: number = OUTSOURCE_REDLINE.maxRatio): number {
  return total * ratio;
}

/**
 * what-if 触红线的**用户可见拒绝文案**（DataCore 求解器与前端 mock 共用同一出口 → 两端一字不差）。
 * 百分数全部由 `outsourceRedlinePct` 生成，文案里没有任何手写的数。
 */
export function outsourceRedlineRejectReason(
  actualRatio: number,
  maxRatio: number = OUTSOURCE_REDLINE.maxRatio,
): string {
  const actualPct = Math.round(actualRatio * 100 * 10) / 10;
  return `外协比例 ${actualPct}% 超过红线 ${Math.round(maxRatio * 100)}%（${OUTSOURCE_REDLINE.ruleKey}），拒绝该参数组合`;
}

/**
 * 合成数据侧的红线耦合常数（R6·防「规则变哑弹」回潮）。
 * 病史：`docs/IMPLEMENTATION-phase1-4-slice-rules.md` P1 —— 已发布规则在真实合成数据上 `violations=0`（哑弹）。
 * 订单 `outsourceRatio` 按固定步长植入越线行使 C08 真触发；这两个值与红线**强耦合**：
 * 红线一旦放松到 `violationRatio` 之上、或收紧到合规桶上界之下，C08 立刻退化为哑弹或全量误报。
 * `outsource-redline:check` 断言这两条不变量，故值虽未变也必须登记在册。
 */
export const OUTSOURCE_SAMPLE = {
  /** 植入的**越线**样本比例（不变量：必须 > `OUTSOURCE_REDLINE.maxRatio`）。 */
  violationRatio: 0.35,
  /** 合规订单比例的哈希桶模数：派生值 ∈ [0, (mod−1)/100]（不变量：(mod−1)/100 < `maxRatio`）。 */
  normalBucketMod: 18,
} as const;

/**
 * DF.14 **多处物化规则的表达式单一来源**（闭 `G-RULE-MOCK-EXPR-DRIFT`，欠账 #78 的机制面）。
 *
 * 病史（真实·测试全绿盖住了）：同一条规则在**两处各写一份 expression** ——
 * datacore 场景包种子 `synthetic/battery.ts BATTERY_RULES` 与前端 `mocks/fixtures.ts RULES`。
 * 二者曾系统性不同口径：mock 写人读的**约束式**（`<= 0.5`「不得超过」）而后端写引擎吃的**违规谓词**
 * （`> 0.5`）—— **极性相反**，照 mock 那套喂引擎则合规订单全报违规；外加主体丢前缀（`Outsource.ratio`）、
 * 对象类型被中译（`产线.utilization` 不是任何已注册类型 key ⇒ 该规则在 mock 态是哑弹）。
 *
 * 那一轮把**值**手工对齐了，但**机制**没变：两处仍各写一份字面量，谁也不校验谁 ⇒ 早晚再漂
 * （C08 是唯一例外，它经 `outsourceRedlineViolationExprPublished()` 派生，故从未漂）。
 * 本表把 C08 那个「派生而非手抄」的形态推广到**全部多处物化的规则**：expression/params 只此一处，
 * 两端 `.map()` 派生。改一个阈值 → 前后端同时变，结构上不可能再分叉。
 *
 * ⚠ 只收**会漂的业务内容**（expression + 数值 params）。`key`/`name`/`severity`/`category` 仍由各站点
 * 写字面量：规则码是标识符不是会漂的业务数，且 `rule-closure:check` 靠正则 `key: "Cxx", name:` 扫
 * `battery.ts` 建「已定义规则集」——把 key 也派生会让那道门瞎掉（C08 注释里已亲测记录）。
 *
 * 消费端（门 `rule-parity:check` 强制两端都派生）：
 *  · datacore `apps/datacore/src/synthetic/battery.ts`（BATTERY_RULES 种子）
 *  · 前端 `apps/frontend-shell/src/mocks/fixtures.ts`（RULES mock 规则库）
 *
 * R6：纯常数/纯函数，同输入字节一致。
 */
export interface ParityRuleSeed {
  /** 规则码（两端同码即同一条规则）。 */
  readonly key: string;
  /** ★ 唯一真值：规则引擎吃的**违规谓词**表达式（为真 ⇒ passed=false）。 */
  readonly expression: string;
  /** 该规则的命名阈值（`params.<名>`），阈值只此一处；无则省略。 */
  readonly params?: Readonly<Record<string, number>>;
}

/**
 * 两处物化的规则清单。C08 不在此表 —— 它已有更专的单一来源 `OUTSOURCE_REDLINE`
 * （`outsourceRedlineViolationExprPublished()`），两端都从那里派生；再抄进本表就是第三份。
 */
export const PARITY_RULE_SEEDS: readonly ParityRuleSeed[] = [
  { key: "C01", expression: "Line.weeklyCapacityWan > Line.designCeilingWan" },
  { key: "C02", expression: "Process.parallelThroughput < Process.requiredThroughput" },
  { key: "C03", expression: "Order.demandDelta > 0.5" },
  { key: "C05", expression: "SUSTAIN(Line.utilization > 95, 3)" },
  {
    key: "C09",
    // 阈值 `staleHours` 只存 params 一处，expression 引用它（WO-RULE-EXPR-PARAMS）。
    expression: `DataSourceHealth.critical == TRUE AND DataSourceHealth.lagHours > ${ruleParamRef("staleHours")}`,
    // degradedFactor 是**系数**（降到多少）不是阈值：经 RULE_PARAM_BINDINGS 投影进 `health.degraded`，
    // 不出现在 expression 里。normalFactor 刻意不在此 —— `health.normal` 归 M11 校准参数 p90_health 所有。
    params: { staleHours: 2, degradedFactor: 0.9 },
  },
  { key: "C12", expression: "SUSTAIN(Model.forecast_deviation > 0.08, 1)" },
  { key: "C13", expression: "Order.creditUsedRatio > 1" },
] as const;

/** 取某条多处物化规则的表达式；未登记即**抛错**（不静默回落一个看似正常的串）。 */
export function parityRuleExpression(key: string): string {
  const seed = PARITY_RULE_SEEDS.find((r) => r.key === key);
  if (!seed) throw new Error(`PARITY_RULE_SEEDS 未登记规则 ${key} —— 多处物化的规则必须走单一来源`);
  return seed.expression;
}

/** 取某条多处物化规则的命名阈值（返回新对象，调用方可安全放进各自的种子结构）。 */
export function parityRuleParams(key: string): Record<string, number> {
  const seed = PARITY_RULE_SEEDS.find((r) => r.key === key);
  if (!seed) throw new Error(`PARITY_RULE_SEEDS 未登记规则 ${key} —— 多处物化的规则必须走单一来源`);
  return { ...(seed.params ?? {}) };
}

/** 红线版本史一条（RETIRED 的 maxRatio = 已退役历史值，非现行值的重复定义）。 */
export interface OutsourceRedlineVersion {
  version: number;
  label: string;
  /** 该版本当时的上限（比率 0–1）。 */
  maxRatio: number;
  reason: string;
  changedAt: string;
  status: "PUBLISHED" | "RETIRED";
}

/**
 * C08 红线**版本史**单一来源（lived-in 叙事：出厂 30% 经三次复盘收紧到现行 20%）。
 * 末条 = 现行版本，其 `maxRatio` 直接引用 `OUTSOURCE_REDLINE.maxRatio`（改红线自动同步，不会出现
 * 「现行值改了、版本史还写旧值」的第二次漂移）。复盘理由里的百分数全部由 `outsourceRedlinePct` 生成。
 * 消费端：datacore `livedin/engine.ts`（真发布 + 版本史接口）· 前端 `mocks/livedInFixtures.ts`（mock 镜像）。
 */
const REDLINE_STEPS: { version: number; label: string; maxRatio: number; changedAt: string; note: (prev: number, cur: number) => string }[] = [
  { version: 1, label: "v1.0", maxRatio: 0.3, changedAt: "2025-07-01", note: (_p, c) => `场景包出厂基线（上限 ${outsourceRedlinePct(c)}%）` },
  { version: 2, label: "v1.1", maxRatio: 0.25, changedAt: "2025-09-12", note: (p, c) => `Q1 外协质量事件复盘：上限 ${outsourceRedlinePct(p)}%→${outsourceRedlinePct(c)}%` },
  { version: 3, label: "v1.2", maxRatio: 0.22, changedAt: "2026-01-09", note: (p, c) => `连续两月外协毛利侵蚀复盘：${outsourceRedlinePct(p)}%→${outsourceRedlinePct(c)}%` },
  { version: 4, label: OUTSOURCE_REDLINE.versionLabel, maxRatio: OUTSOURCE_REDLINE.maxRatio, changedAt: "2026-04-03", note: (_p, c) => `年度复盘：外协质量+毛利双重约束，收紧至 ${outsourceRedlinePct(c)}%` },
];

export const OUTSOURCE_REDLINE_HISTORY: OutsourceRedlineVersion[] = REDLINE_STEPS.map((s, i) => ({
  version: s.version,
  label: s.label,
  maxRatio: s.maxRatio,
  reason: s.note(REDLINE_STEPS[Math.max(0, i - 1)]!.maxRatio, s.maxRatio),
  changedAt: s.changedAt,
  status: i === REDLINE_STEPS.length - 1 ? "PUBLISHED" : "RETIRED",
}));

/**
 * WO-CEO-1a 统一目标登记册 GOAL_REGISTRY（企业顶层经营目标 = 一等 Metric 的 target/floor 单一来源 · R-一致）。
 * CEO 决策看板地基：把顶层目标（营收/毛利/份额/现金）与运营指标（毛利率/达成率/保障率）的
 * **目标值 target + 底线 floorVal + 责任人 ownerRef + 关键成功要素 ksfRef** 收敛为唯一出处，
 * 杜绝 Gap④ 四处漂移（`Metric.target` 硬编码 · `FinancePlan.budget` · `DemandSegment.tgt` · `PLAN_GOAL_TARGETS` 各写一份）。
 * 与 `PLAN_GOAL_TARGETS` 重叠的阈值（毛利率底线/现金底线）**直接引用 PLAN_GOAL_TARGETS**（不造第二口径 → 单一事实单一出处）。
 * 消费端 `datacore/synthetic/battery.ts` metrics[] 经 `GOAL_REGISTRY[goalKey]` 派生 target/floorVal/owner/ksf（R6 字节一致）。
 * 单位口径：营收/毛利/现金 = 亿；毛利率/份额/达成率/保障率 = %。direction=up（越大越好，`actual < floorVal` 即越线 → metric.breached）。
 */
export interface GoalTarget {
  goalKey: string; // 登记册键（顶层目标标识）
  key: string; // Metric.key（对齐视图 / PlanTarget）
  name: string;
  unit: string;
  category: string; // scale / profit / share / cash / material（根因归因 kpiCategory 对齐）
  level: "op" | "year"; // 顶层企业目标 = year（年度头条）；运营指标 = op（当前态）
  direction: "up" | "down"; // up=越大越好（actual<floorVal 越线）
  target: number;
  floorVal: number;
  weight: number;
  ksfRef: string; // → KSF（关键成功要素）
  ownerRef: string; // → Principal（责任主体）
}

export const GOAL_REGISTRY: Record<string, GoalTarget> = {
  // —— 顶层企业目标（年度口径 · CEO 决策看板头条：营收/毛利/份额/现金）——
  revenue: { goalKey: "revenue", key: "revenue", name: "营收", unit: "亿", category: "scale", level: "year", direction: "up", target: 700, floorVal: 686, weight: 0.35, ksfRef: "ksf-dem", ownerRef: "prin-fin" },
  gross_profit: { goalKey: "gross_profit", key: "gross_profit", name: "毛利", unit: "亿", category: "profit", level: "year", direction: "up", target: 112, floorVal: 108.5, weight: 0.25, ksfRef: "ksf-cost", ownerRef: "prin-fin" }, // 112=营收700×毛利率16% · 108.5=700×底线15.5%
  market_share: { goalKey: "market_share", key: "market_share", name: "市场份额", unit: "%", category: "share", level: "year", direction: "up", target: 23, floorVal: 20, weight: 0.2, ksfRef: "ksf-dem", ownerRef: "prin-plan" },
  cash: { goalKey: "cash", key: "cash", name: "经营现金", unit: "亿", category: "cash", level: "year", direction: "up", target: 60, floorVal: PLAN_GOAL_TARGETS.cashFloor, weight: 0.2, ksfRef: "ksf-cash", ownerRef: "prin-fin" }, // floor 引用 PLAN_GOAL_TARGETS.cashFloor（单一来源）
  // —— 运营指标（op 口径 · 收编现有 3 指标的 target/floor 到单一来源，杀 Metric.target 硬编码漂移）——
  gm_rate: { goalKey: "gm_rate", key: "gm_rate", name: "毛利率", unit: "%", category: "profit", level: "op", direction: "up", target: 16, floorVal: PLAN_GOAL_TARGETS.gmFloorPct, weight: 0.4, ksfRef: "ksf-dem", ownerRef: "prin-fin" }, // floor 引用 PLAN_GOAL_TARGETS.gmFloorPct（此前 Metric 硬编码 13 → 漂移，现单一来源 15.5）
  demand_attain: { goalKey: "demand_attain", key: "demand_attain", name: "需求达成率", unit: "%", category: "scale", level: "op", direction: "up", target: 100, floorVal: 95, weight: 0.3, ksfRef: "ksf-bal", ownerRef: "prin-plan" },
  material_cov: { goalKey: "material_cov", key: "material_cov", name: "物料保障率", unit: "%", category: "material", level: "op", direction: "up", target: 100, floorVal: 95, weight: 0.3, ksfRef: "ksf-kit", ownerRef: "prin-supply" },
};

/**
 * DF.7 边界影响图（GenerationBoundary · 单一来源+影响图）：把"改某条边界册会波及谁"显式登记——
 * 回答铁律0 的"改 X 会影响什么"。`members` 派生自册长（非写死）；`consumers` 镜像
 * boundary-singlesource 门所强制校验的派生消费端（门保证其不漂、`boundary-impact.test` 复核每条确实派生）；
 * `downstream` 是 grep 核实的下游受影响面（视图/求解器/派生对象），供改值前评估爆炸半径。
 */
export interface BoundaryConsumer {
  /** 派生消费端源文件。 */
  file: string;
  /** 派生绑定名（消费端把册映射成的本地表示）。 */
  binding: string;
  /** 派生方式 token（门/测试据此校验源码确实从册派生，非内联回潮）。 */
  derivesVia: string;
}
export interface BoundaryRegistryImpact {
  registry: "BASE_REGISTRY" | "SEG_REGISTRY" | "PLAN_GOAL_TARGETS";
  title: string;
  /** 成员数（派生自册长，改册自动同步）。 */
  members: number;
  /** 派生消费端（boundary-singlesource 门强制其从册派生）。 */
  consumers: BoundaryConsumer[];
  /** 下游受影响面（grep 核实：视图/求解器/派生对象）。 */
  downstream: string[];
}

export const BOUNDARY_IMPACT: BoundaryRegistryImpact[] = [
  {
    registry: "BASE_REGISTRY",
    title: "基地集",
    members: BASE_REGISTRY.length,
    consumers: [
      { file: "apps/datacore/src/synthetic/battery.ts", binding: "BASES", derivesVia: "BASE_REGISTRY.map" },
      { file: "apps/frontend-shell/src/mocks/fixtures.ts", binding: "BASES", derivesVia: "BASE_REGISTRY.map" },
      { file: "apps/frontend-shell/src/mocks/simSolvers.ts", binding: "MOCK_BASES", derivesVia: "BASE_REGISTRY.map" },
    ],
    downstream: [
      "Base 对象库（合成物化）",
      "geo-map 视图（objectType=Base，service.ts）",
      "capacity_forecast/capacity_rollup 求解器（perBaseRows 逐基地）",
      "MODEL_BASE_MAP 型号→基地确定性映射（battery.ts）",
    ],
  },
  {
    registry: "SEG_REGISTRY",
    title: "应用细分集",
    members: SEG_REGISTRY.length,
    consumers: [
      { file: "apps/datacore/src/synthetic/battery.ts", binding: "SEGMENTS / audit.segMargins", derivesVia: "SEG_REGISTRY" },
      { file: "apps/datacore/src/solvers/risk.ts", binding: "SEG_PRICE", derivesVia: "SEG_REGISTRY" },
      { file: "apps/frontend-shell/src/views/plan/OrderChainView.tsx", binding: "ECON / SEG_COLOR", derivesVia: "SEG_REGISTRY" },
      { file: "apps/frontend-shell/src/mocks/simSolvers.ts", binding: "AUDIT_T.segMargins", derivesVia: "SEG_REGISTRY" },
    ],
    downstream: [
      "order-chain 视图 econTable（量价本利）",
      "risk 求解器 affectedOrders.summary.revenue（与 econTable 同源 DF.3b）",
      "DemandSegment 派生 revenueWan=demandWanPerYearP50×priceWan / marginWan=demandWanPerYearP50×priceWan×marginPct/100（battery.ts）",
    ],
  },
  {
    registry: "PLAN_GOAL_TARGETS",
    title: "规划目标阈值集",
    members: Object.keys(PLAN_GOAL_TARGETS).length,
    consumers: [
      { file: "apps/datacore/src/synthetic/battery.ts", binding: "planGenerate.targets", derivesVia: "PLAN_GOAL_TARGETS" },
      { file: "apps/frontend-shell/src/views/sim/PlanGenerateView.tsx", binding: "DEFAULT_GOALS", derivesVia: "PLAN_GOAL_TARGETS" },
      { file: "apps/frontend-shell/src/mocks/fixtures.ts", binding: "planGoals", derivesVia: "PLAN_GOAL_TARGETS" },
    ],
    downstream: [
      "plan_generate 求解器（targets 喂方案达成判定）",
      "方案生成视图 五目标面板默认值 + WorkspaceConfig.planGoals 下发",
    ],
  },
];

/**
 * DF.10 边界册版本化（GenerationBoundary · 改值留痕 + 跨服务缓存失效锚）：
 * semver 手维护（结构变更时 bump）；digest 自动——对各册内容算确定性指纹（djb2，R6 同内容同 digest），
 * 改任一业务常数（基地/价利/目标）→ digest 变，可被审计/缓存失效检测（呼应 DF.7 影响图「改 X」的时间维）。
 * 纯 JS hash（contracts 跨前后端，不用 node:crypto）。
 */
export const BOUNDARY_SEMVER = "1.0.0";

/** 确定性字符串指纹（djb2，无依赖，前后端一致 R6）。 */
function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export interface BoundaryRegistryVersion {
  registry: "BASE_REGISTRY" | "SEG_REGISTRY" | "PLAN_GOAL_TARGETS";
  members: number;
  digest: string;
}
export interface BoundaryVersion {
  semver: string;
  /** 全册合并指纹（任一册改值即变）。 */
  digest: string;
  registries: BoundaryRegistryVersion[];
}

/** 计算当前边界册版本（semver + 内容指纹）。确定性（R6）：同内容恒同 digest。 */
export function boundaryVersion(): BoundaryVersion {
  const registries: BoundaryRegistryVersion[] = [
    { registry: "BASE_REGISTRY", members: BASE_REGISTRY.length, digest: djb2Hex(JSON.stringify(BASE_REGISTRY)) },
    { registry: "SEG_REGISTRY", members: SEG_REGISTRY.length, digest: djb2Hex(JSON.stringify(SEG_REGISTRY)) },
    { registry: "PLAN_GOAL_TARGETS", members: Object.keys(PLAN_GOAL_TARGETS).length, digest: djb2Hex(JSON.stringify(PLAN_GOAL_TARGETS)) },
  ];
  // WO-SCALE-COHERENCE：尺度锚常数进全册合并指纹（registries 仍为三册，守 boundary-version.test 结构；
  // 改 packEnergyKwh/operatingDaysPerYear/scaleAnchorRevenue → 合并 digest 变 → 可审计/跨服务缓存失效）。
  const anchorDigest = djb2Hex(JSON.stringify({ packEnergyKwh, operatingDaysPerYear, scaleAnchorRevenue }));
  return {
    semver: BOUNDARY_SEMVER,
    digest: djb2Hex(registries.map((r) => `${r.registry}:${r.digest}`).join("|") + `|ANCHORS:${anchorDigest}`),
    registries,
  };
}

/**
 * 工序车间单一来源（WO-SANDBOX-F3 并线时上提·R14 去业务锁死）。
 *
 * 由来：F3 交付时把这十道工序**内联在前端视图里**，理由是「跨 app 不许 import 源码
 * （contracts-only-shared），所以只能镜像 + 加一道 source-parity 比对门」。
 * `debattery:check` 当场判红——**镜像加比对门治的是"漂了能发现"，治不了"两处各写一份"本身**。
 * 正确解是把它上提到 contracts：`battery.ts` 与前端都从这里派生，从根上没有第二份。
 *
 * ⚠ 与「设备节拍 CT」是两个口径，勿混：本表是**工序序列**；
 *   `Equipment.ctSeconds` / `ProductLineCapability.cycleTime` 是单件加工时长。
 * ⚠ 「模组」不是工序：它只出现在 battery.ts 的 BOTTLENECKS 瓶颈标签表，属另一套词表。
 */
export interface CanonicalWorkshop {
  /** 工序中文名（对象/视图展示用） */
  readonly type: string;
  /** 工序英文后缀（产线/工序 id 拼装用） */
  readonly suffix: string;
  /** 所属链段 */
  readonly segment: "前道·电极" | "中道·装配" | "后道·电化学" | "后道·成组";
}

export const WORKSHOP_REGISTRY: readonly CanonicalWorkshop[] = [
  { type: "制浆", suffix: "slurry", segment: "前道·电极" },
  { type: "涂布", suffix: "coating", segment: "前道·电极" },
  { type: "辊压", suffix: "calendering", segment: "前道·电极" },
  { type: "分切", suffix: "slitting", segment: "前道·电极" },
  { type: "卷绕", suffix: "winding", segment: "中道·装配" },
  { type: "装配", suffix: "assembly", segment: "中道·装配" },
  { type: "注液", suffix: "filling", segment: "中道·装配" },
  { type: "化成", suffix: "formation", segment: "后道·电化学" },
  { type: "分容", suffix: "grading", segment: "后道·电化学" },
  { type: "PACK", suffix: "pack", segment: "后道·成组" },
] as const;

/**
 * 工序 → 设备型 单一来源（同 `WORKSHOP_REGISTRY` 一并上提·R14）。
 *
 * ⚠ 它与 `WORKSHOP_REGISTRY` **不是同一层建模**，键集刻意不同，勿"对齐"：
 *   本表有 `aging`（老化）而十车间链里没有；本表无 `slurry`/`grading`。
 *   这是 Workshop 层与 Process 层两套口径的真实差异——后果是「老化库」这个瓶颈
 *   在工序矩阵里定位不到列，正确处置是标 EMPTY，**不是硬塞一列点亮**。
 */
export const EQUIPMENT_TYPE_BY_PROCESS: Readonly<Record<string, string>> = {
  coating: "涂布机",
  calendering: "辊压机",
  slitting: "分切机",
  winding: "卷绕机",
  assembly: "装配线",
  filling: "注液机",
  formation: "化成柜",
  aging: "老化库",
  pack: "PACK线",
} as const;
