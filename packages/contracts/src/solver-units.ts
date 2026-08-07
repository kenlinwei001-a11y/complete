/**
 * WO-OUTPUT-UNITS（欠账 #63 剩下的「裸数字无单位」半条）· 求解器输出数值字段的**量纲单一真值**。
 *
 * ── 为什么还要这张表（既有三张表管不到的那一片）──
 * 本仓已有三处「后端发单位、前端只格式化」的单源表，各管一片，**互不重叠**：
 *   · `LEVER_PROP_META`（datacore solvers/service.ts）—— 杠杆属性（Equipment.oee_current…）的 unit+kind
 *   · `OBJECTIVE_UNITS`（contracts global-sim.ts）  —— portfolio 多目标键（ontime/delay/cost…）
 *   · `TIGHTNESS_METRIC`（contracts solvers.ts）    —— 张力 0–100 量程
 *   · `PropertyDef.unit`（datacore domain.ts）      —— 本体属性 → generic_inference rows[].unit
 * 管不到的正是**求解器自己算出来的顶层数字**：`capacity_forecast.p50`、`base_capacity_outlook.horizons[].available`、
 * `affected_orders.summary.revenue` …… 它们不是本体属性、不是杠杆、不是目标键，于是四张表一张都不覆盖。
 *
 * ── 取证（2026-08-07 机械枚举·非人眼核对）──
 * 走 17 个求解器的真实输出树，报「带值数字字段 + 同级无任何量纲元数据」：**184 处**。
 * 其中最刺眼的一条：`capacity_forecast` 的**顶层 p50/p90/gap/baselineDemand/effectiveDemand 全是裸的**——
 * 而上一轮 WO-UNIT-MEANING 只给**下钻明细表** `byProcessModel[].unit="套/天"` 配了单位。
 * 于是「用户问这个数是天还是周」的那个数字（首屏大数）恰恰还是裸的，配了单位的是它下面的小表。
 *
 * ── 机制（照既有的扩·不造第二套）──
 * 形状与 `OBJECTIVE_UNITS` 一致：`字段路径 → { label, unit, kind }`；`kind` 决定前端怎么格式化
 * （与 `LEVER_PROP_META` 的 `LeverValueKind` 同一套词：ratio→0–1 存储显示为 %；其余整数 + 单位后缀）。
 * 下发方式：`SolverService.invoke` 在输出根挂一个 **`units` 键**（纯加字段·既有字段逐字节不变·R6），
 * 前端 `units[字段名]` 取 unit/kind 只做格式化 —— **前端不得自己猜单位**（猜 = 第二真值源）。
 *
 * ── 诚实边界（写死在这里，别悄悄扩）──
 * ① **只登记能从代码/口径注释确证的量纲**。确证不了的**故意不登记**，下游诚实回落裸数字，
 *    并在 `docs` 与本注释里留作残口 —— 与 `PROP_DISPLAY_NAMES`「诚实留白，不臆造中文名」同一条纪律。
 *    已知残口（**不臆造**）：`carbon_footprint` 的 total / breakdown 各项 / threshold —— `Model.carbonFootprint`
 *    的 `PropertyDef` 至今无 `unit`，全仓无经确证的碳排量纲真源，就近编一个「kgCO₂e」是造假不是修 bug。
 * ② 本表覆盖的求解器由 `UNITS_COVERED_SOLVERS` 显式列出；未列 = **未覆盖**，不假装已治
 *    （门 `scripts/check-output-units.mjs` 只对已列者要求全覆盖，并逐个报出未覆盖清单）。
 * ③ 单位口径**必须与求解器实算一致**，改口径要同时改这里 —— 门会拿真实输出对账，对不上即红。
 */

/** 值类（与 datacore `LEVER_PROP_META` 的 LeverValueKind 同一套词·前端按此格式化）。 */
export type SolverValueKind = "qty" | "ratio" | "days" | "hours" | "minutes" | "count" | "money" | "index";

export interface SolverFieldUnit {
  /** 中文业务名（首屏可直接当标签用·与 PROP_DISPLAY_NAMES 同一条「不懂代码的人看得懂吗」判据）。 */
  label: string;
  /** 量纲后缀（"" = 无量纲纯计数，前端不加后缀）。 */
  unit: string;
  kind: SolverValueKind;
  /** 口径备注（量程/价基/窗口等易误读处·如「0–100 指数非百分比」「亿元·价基 priceWan」）。 */
  note?: string;
}

/** 字段路径写法：顶层用 `p50`；数组行内字段用 `perBaseRows[].weeklyCap`；嵌套用 `summary.revenue`。 */
export type SolverUnitTable = Record<string, SolverFieldUnit>;

const wanTao = (label: string, note?: string): SolverFieldUnit => ({ label, unit: "万套", kind: "qty", ...(note ? { note } : {}) });
const tao = (label: string, note?: string): SolverFieldUnit => ({ label, unit: "套", kind: "qty", ...(note ? { note } : {}) });

/**
 * `capacity_forecast` —— 口径经 `apps/datacore/src/solvers/capacity.ts` 实算逐行核对：
 * `computeBaselineDemand` 末行 `round(total / 10000, 4) // 万套/窗口`；`p50 = Σ_base cumTotal`（同尺度）；
 * `p90 = p50 × healthFactor`；`gap = effectiveDemand − p90`。**全族同为「万套/窗口」**，不是套、不是万套/周。
 */
const CAPACITY_FORECAST_UNITS: SolverUnitTable = {
  p50: wanTao("P50 可用产能", "窗口累计（非日/周）·Σ_base weeklyCap×certFactor×curveMult"),
  p90: wanTao("P90 可用产能", "窗口累计·p50 × healthFactor（承诺口径·保守）"),
  gap: wanTao("产能缺口", "effectiveDemand − p90；≤0 = 可承接（富余）"),
  qty: wanTao("请求需求量", "入参回显·0 = 未指定，改用订单簿基线"),
  baselineDemand: wanTao("订单簿基线需求", "Σ Order.qty(套)/1e4·窗口内 OPEN 单"),
  effectiveDemand: wanTao("有效需求", "(qty>0?qty:baselineDemand) × (1+demandDelta)"),
  thresholdQty: wanTao("还能再接", "mode:threshold 分支·P90 天花板 − 已占基线需求"),
  weeks: { label: "推演窗口", unit: "周", kind: "days", note: "可为小数（亚周窗口·1/7 = 1 天）" },
  demandDelta: { label: "需求增量", unit: "%", kind: "ratio", note: "相对增量·0.2 = 上浮 20%" },
  gapPct: { label: "缺口率", unit: "%", kind: "ratio" },
  healthFactor: { label: "数据健康系数", unit: "", kind: "ratio", note: "P90 折减系数·非百分比展示量" },
  totalBases: { label: "基地总数", unit: "个", kind: "count" },
  producibleCount: { label: "可产基地数", unit: "个", kind: "count" },
  "perBaseRows[].weeklyCap": wanTao("周产能", "万套/周（注意：与 p50 的「万套/窗口」不同尺度）"),
  "perBaseRows[].cumTotal": wanTao("窗口累计产能", "该基地对 p50 的贡献·与 p50 同尺度"),
  "perBaseRows[].certFactor": { label: "认证系数", unit: "", kind: "ratio", note: "认证中 0.6 / 量产 1.0" },
  "perBaseRows[].tightness": { label: "张力", unit: "/100", kind: "index", note: "0–100 紧张度指数·**不是**被测量本身的百分比（见 TIGHTNESS_METRIC）" },
  "perBaseRows[].maintWeek": { label: "检修周次", unit: "周", kind: "count", note: "第几周检修·序号非时长" },
};

/**
 * `base_capacity_outlook` —— 四线口径见 `apps/datacore/src/solvers/base-outlook.ts` 文件头 ①②③④：
 * available/inProduction/futureOrders/salesForecast/demand/gap **全为「套」**（byModel 已有的 `unit:"套"` 同尺度）。
 */
const BASE_OUTLOOK_UNITS: SolverUnitTable = {
  "horizons[].available": tao("可用产能", "Σ Line.capacityDaily×(1−util) × 窗口天"),
  "horizons[].inProduction": tao("在产订单占用", "未完工 WorkOrder.qtyActual 铺到窗"),
  "horizons[].futureOrders": tao("未来订单", "Order.due 落窗内（首基地=本基地）Σqty"),
  "horizons[].salesForecast": tao("销售预测", "ΣDemandSegment.p50×1e4 按产能占比摊到窗"),
  "horizons[].demand": tao("需求合计", "inProduction + futureOrders"),
  "horizons[].gap": tao("缺口/富余", "available − demand；负 = 缺口"),
  "horizons[].horizon": { label: "窗口", unit: "天", kind: "days" },
  "horizons[].crossDay": { label: "首越线日", unit: "T+天", kind: "days", note: "累计需求首次越过可用产能的那一天" },
  "horizons[].lines[].value": tao("四线取值"),
  "horizons[].dayPlan[].closesGap": tao("该步可补缺口"),
  "horizons[].dayPlan[].triggerValue": tao("触发阈值"),
  "horizons[].dayPlan[].day": { label: "执行日", unit: "T+天", kind: "days", note: "自 forecastStart 起第几天（序数·非时长）" },
  "dayPlan[].closesGap": tao("该步可补缺口"),
  "dayPlan[].triggerValue": tao("触发阈值"),
  "dayPlan[].day": { label: "执行日", unit: "T+天", kind: "days", note: "自 forecastStart 起第几天（序数·非时长）" },
};

/**
 * `affected_orders` —— 金额口径是 **G-UNIT-NORMALIZE 结案时定死的**：
 * `金额(亿) = Σ qty(套) × priceWan(万元/套) / 1e4`（risk.ts:1312/1452 两处同价基同公式）。
 * 这条正是当年「未结订单金额 97592 亿·真值 <50 亿」那个 ×1e4 炸的收口口径，**不许改写**。
 */
const AFFECTED_ORDERS_UNITS: SolverUnitTable = {
  "summary.revenue": { label: "涉及金额", unit: "亿元", kind: "money", note: "Σqty(套)×priceWan(万元/套)/1e4·价基 SEG_PRICE" },
  "summary.totalQty": tao("涉及数量"),
  "summary.orderCount": { label: "涉及订单", unit: "单", kind: "count" },
  "summary.custCount": { label: "涉及客户", unit: "家", kind: "count" },
  "rows[].qty": tao("订单数量"),
  "rows[].delay": { label: "预计延误", unit: "天", kind: "days" },
  "problems[].financeImpact": { label: "财务影响", unit: "亿元", kind: "money", note: "与 summary.revenue 同价基同公式" },
  "problems[].orderCount": { label: "订单数", unit: "单", kind: "count" },
  // 逐单风险 chip —— 审计中**误导性最强**的一处：「设备OEE 76」紧贴 OEE 会被直接读成 OEE=76%，
  // 真实含义是「设备OEE 这个因素的张力 76/100」（见 contracts solvers.ts TIGHTNESS_METRIC）。
  "rows[].risks[].peak": { label: "峰值张力", unit: "/100", kind: "index", note: "0–100 紧张度指数·**不是**被测量本身的百分比" },
  "rows[].risks[].threshold": { label: "越线阈值", unit: "/100", kind: "index", note: "与 peak 同量程" },
  "rows[].risks[].crossDay": { label: "越线日", unit: "T+天", kind: "days", note: "张力首次越过阈值的那一天（序数）" },
};

/** `atp_check` —— 承诺量族全为「套」（Order.qty 存储口径·G-UNIT-NORMALIZE 结案：qty 计套不计万套）。 */
const ATP_CHECK_UNITS: SolverUnitTable = {
  requestedQty: tao("需求量"),
  committableQty: tao("可承接量"),
  shortfallQty: tao("缺口量"),
  "breakdown[].qty": tao("分项量"),
};

/** 已覆盖求解器（门只对这几个要求全覆盖·未列者由门逐个报出为**未覆盖残口**，不假装已治）。 */
export const SOLVER_FIELD_UNITS: Record<string, SolverUnitTable> = {
  capacity_forecast: CAPACITY_FORECAST_UNITS,
  base_capacity_outlook: BASE_OUTLOOK_UNITS,
  affected_orders: AFFECTED_ORDERS_UNITS,
  atp_check: ATP_CHECK_UNITS,
};

export const UNITS_COVERED_SOLVERS = Object.keys(SOLVER_FIELD_UNITS);

/** 求解器 → 其输出字段量纲表（未覆盖 → undefined·调用方据此**不挂** units 键，而非挂个空对象冒充已治）。 */
export const solverUnitsFor = (solverKey: string): SolverUnitTable | undefined => SOLVER_FIELD_UNITS[solverKey];

/**
 * 数值 + 量纲 → 展示串（**前端唯一该做的事**·量纲本身一律后端发）。
 * `ratio`：0–1 存储自动 ×100 显示 %（与 `DynamicLeverPanel.fmtLeverValue` 同口径）。
 * 缺量纲元数据 → 诚实回落裸数字（不臆造后缀）。
 */
export function formatSolverValue(v: number | null | undefined, meta?: SolverFieldUnit): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (!meta) return String(v);
  if (meta.kind === "ratio" && meta.unit === "%") return `${Math.round(v <= 1 && v >= -1 ? v * 100 : v)}%`;
  return meta.unit ? `${v}${meta.unit}` : String(v);
}
