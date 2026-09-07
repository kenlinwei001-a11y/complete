/**
 * WO-RATE-DIMENSION · **量纲维度**（速率 / 复合量纲）——单位字符串背后的那个结构。
 *
 * ══ 今天的行为是 X，应该是 Y ══════════════════════════════════════════════════
 *
 * **今天（X）**：`PROPERTY_UNITS`（`domain.ts`）是一份 50 条的**闭合字符串联合**，
 * `UNIT_DICTIONARY`（`ontology-governance.ts`）由它派生，REST 建类型时逐属性做一次
 * **成员判定**（`dict.has(p.unit)`）。字典里确实已有 10 条带斜杠的词条
 * （`元/kWh` `元/吨` `万套/年` `万套/月` `万套/窗口` `套/天` `套/日` `件/日` `电芯/天` `GWh/年`），
 * 但它们**只是恰好含一个斜杠的字符串** —— 没有任何代码能回答这三个问题：
 *   ① `件/日` 和 `套/日` 是不是同一族？（今天：无从判断）
 *   ② `件` 和 `件/日` 是不是同一回事？（今天：无从判断，**存量与速率没有区别**）
 *   ③ `元/kg` 的分母是什么量？（今天：无从判断，斜杠不是运算符只是一个字符）
 * 于是单位只能被**显示**（`displayUnit()`）与**比对相等**，不能被**运算**。
 *
 * **应该（Y）**：单位要有**结构** —— 分子 / 分母各是哪一个「量的种类」（kind）、
 * 相对该族基元的倍数（factor）。有了结构才谈得上
 * 「同族可比、跨族不可比」「存量 ≠ 速率」，也才谈得上让机器在**提交那一刻**拦住
 * `qtyPlanned(件) 比 max_capacity_day(件/日)` 这类**一次错两处**的比较
 * （件↔套 是族错，存量↔速率是阶错；两者今天都静默通过、四包全绿）。
 *
 * ══ 为什么计数名词各自成族（不许并） ═══════════════════════════════════════════
 *
 * `件` / `套` / `个` / `电芯` / `台` / `条` / `批` / `单` / `项` / `次` —— 每一个都是
 * **独立的 kind**（`count:<名词>`），互不可比。把 `个` 并进 `件` 需要先裁决
 * 「一个壳体算不算一件」，那是**口径决定**不是编码决定；本模块**不替任何人做这个决定**，
 * 只负责让没裁决过的比较**当场报错**而不是静默出数。
 * 同理 `h` 与 `秒` 同属 `time` 但**倍数是精确的**（1h = 1/24 天），可换算；
 * 而 `月` / `年` 的倍数是**日历口径**（365 / 365.25 / 250 工作日各有说法），
 * 故它们**登记 kind 但不登记 factor** ⇒ 同族、但换算系数标为「未裁决」，加减法照样拦。
 *
 * ⚠ 唯一被合并的一对是 `日` ≡ `天`：这不是口径选择，是**同一个单位的两种写法**
 * （1 日 = 1 天，无任何自由度）。本仓真实同时用着两者
 * （`Line.capacityDaily`=套/日 · `ProductLineCapability.maxCapacity`=套/天）。
 *
 * ══ 参数化量纲（`perRef`）—— `Material.unitPrice` 的真实形态 ═══════════════════
 *
 * `Material.unitPrice` 的真实量纲**逐行不同**：三元正极 `元/kg`、隔膜 `元/㎡`、
 * 电解液 `元/L`、电芯壳体 `元/个`（分母就写在同对象的 `Material.unit` 那一格里）。
 * 一个属性只能声明一个 `unit`，所以真实量纲**结构上无处安放** —— 改前它被声明成 `元`，
 * 即把一个**强度量**当成了**绝对额**。这不是笔误，是模型缺了「分母来自另一格」这个形态。
 *
 * 故引入 `perRef`：占位符 `计量单位` 出现在分母位（`元/计量单位`）或分子位（`计量单位`），
 * 配 `PropertyDef.unitRefProp` 指出**由哪一格提供**真实单位，
 * 由 {@link resolveParametricUnit} 在读到具体对象时求出**具体单位**（`元/kg`…）。
 * 这样 `BOMDetail.quantity(计量单位) × Material.unitPrice(元/计量单位) = 元` 的
 * 量纲抵消**在模型里是可证的**，而不是靠注释声称。
 */
import type { PropertyUnit } from "./domain.js";
import { PROPERTY_UNITS } from "./domain.js";

/**
 * 「量的种类」。**同 kind 才谈得上可比**；不同 kind 一律不可比，没有例外通道。
 *
 * `count:<名词>` 是模板字面量而非单个 `"count"`：**每个计数名词自成一族**（见头注）。
 * `perRef` 是参数化占位 —— 真实 kind 由同对象另一格的值给出，未解析前与任何 kind 都不可比。
 */
export type QuantityKind =
  | "money"
  | "energy"
  | "mass"
  | "volume"
  | "area"
  | "time"
  | "window"
  | "angle"
  | "carbon"
  | "charge"
  | "voltage"
  | "headcount"
  | "shift"
  | "score"
  | "grade"
  | "percent"
  | "none"
  | `count:${string}`
  | "perRef";

/**
 * 量纲原子：某个 kind 上的一个刻度。
 *
 * `factor` = **相对该族基元的倍数**，缺省表示「该换算系数尚未裁决」（`月`/`年`/`perRef`）。
 * ⚠ 缺省不是 1 —— 把「不知道」写成 1 正是本仓反复犯的那个形态（沉默被读成某个具体值）。
 */
export interface UnitAtom {
  kind: QuantityKind;
  /** 相对基元的倍数；**未裁决时不写**，不许拿 1 顶。 */
  factor?: number;
}

/** 量纲：分子 + 可选分母。有分母 = **速率/强度量**，无分母 = **存量/绝对量**。 */
export interface UnitDimension {
  num: UnitAtom;
  den?: UnitAtom;
}

const money = (factor: number): UnitAtom => ({ kind: "money", factor });
const energy = (factor: number): UnitAtom => ({ kind: "energy", factor });
const mass = (factor: number): UnitAtom => ({ kind: "mass", factor });
const time = (factor?: number): UnitAtom => (factor === undefined ? { kind: "time" } : { kind: "time", factor });
const count = (noun: string, factor = 1): UnitAtom => ({ kind: `count:${noun}`, factor });
const plain = (kind: QuantityKind, factor = 1): UnitAtom => ({ kind, factor });

/**
 * 参数化量纲的占位符 —— 出现在单位串里代表「这一位的真实单位由 `unitRefProp` 指的那一格给出」。
 * 选中文而非 `{x}` 之类，是为了让它在屏上/日志里读得懂（本仓单位串会直接上屏）。
 */
export const UNIT_REF_PLACEHOLDER = "计量单位";

/**
 * 全量单位 → 量纲。**`satisfies Record<PropertyUnit, …>` 是本模块的机制所在**：
 * 往 `PROPERTY_UNITS` 加一条而不在这里登记它的量纲 ⇒ **当场编译失败**。
 * 「加词条时顺手忘了说它属于哪一族」这件事从此不可能发生 —— 机器先说话，不靠人想起来。
 */
export const UNIT_DIMENSIONS = {
  dimensionless: { num: plain("none") },
  // ── 钱 ───────────────────────────────────────────────────────────────────────
  元: { num: money(1) },
  万元: { num: money(1e4) },
  亿元: { num: money(1e8) },
  "元/kWh": { num: money(1), den: energy(1) },
  "元/吨": { num: money(1), den: mass(1e3) },
  // WO-RATE-DIMENSION 新增：物料单价的四种真实分母（见 `Material.unit` 的实测取值域）。
  "元/kg": { num: money(1), den: mass(1) },
  "元/个": { num: money(1), den: count("个") },
  "元/L": { num: money(1), den: plain("volume") },
  "元/㎡": { num: money(1), den: plain("area") },
  // 参数化：分母由同对象另一格给出（`Material.unitPrice` → `Material.unit`）。
  [`元/${UNIT_REF_PLACEHOLDER}`]: { num: money(1), den: { kind: "perRef" } },
  // 参数化：分子由同对象另一格给出（`BOMDetail.quantity` → `BOMDetail.unit`）。
  [UNIT_REF_PLACEHOLDER]: { num: { kind: "perRef" } },
  // ── 能量 / 产能 ──────────────────────────────────────────────────────────────
  kWh: { num: energy(1) },
  MWh: { num: energy(1e3) },
  GWh: { num: energy(1e6) },
  Wh: { num: energy(1e-3) },
  // ── 物理计数（各自成族，见头注：不许并）──────────────────────────────────────
  套: { num: count("套") },
  万套: { num: count("套", 1e4) },
  电芯: { num: count("电芯") },
  件: { num: count("件") },
  个: { num: count("个") },
  台: { num: count("台") },
  条: { num: count("条") },
  批: { num: count("批") },
  单: { num: count("单") },
  项: { num: count("项") },
  次: { num: count("次") },
  // ── 质量 / 体积 / 面积 ───────────────────────────────────────────────────────
  吨: { num: mass(1e3) },
  kg: { num: mass(1) },
  g: { num: mass(1e-3) },
  "㎡": { num: plain("area") },
  L: { num: plain("volume") },
  // ── 电气 / 物理规格 ──────────────────────────────────────────────────────────
  Ah: { num: plain("charge") },
  V: { num: plain("voltage") },
  kgCO2e: { num: plain("carbon") },
  "°": { num: plain("angle") },
  // ── 人 / 班 ──────────────────────────────────────────────────────────────────
  人: { num: plain("headcount") },
  班: { num: plain("shift") },
  // ── 时间（基元 = 天；`月`/`年` 的倍数是日历口径，故不登记 factor）──────────────
  秒: { num: time(1 / 86400) },
  分钟: { num: time(1 / 1440) },
  h: { num: time(1 / 24) },
  天: { num: time(1) },
  周: { num: time(7) },
  月: { num: time() },
  年: { num: time() },
  // ── 速率 / 流量 ──────────────────────────────────────────────────────────────
  "万套/年": { num: count("套", 1e4), den: time() },
  "万套/月": { num: count("套", 1e4), den: time() },
  "万套/窗口": { num: count("套", 1e4), den: plain("window") },
  "套/天": { num: count("套"), den: time(1) },
  "套/日": { num: count("套"), den: time(1) },
  "件/日": { num: count("件"), den: time(1) },
  "电芯/天": { num: count("电芯"), den: time(1) },
  "GWh/年": { num: energy(1e6), den: time() },
  // ── 比例 / 评分（`%` 与 `dimensionless` **不并族** —— 那正是 100× 那个 bug 的藏身处）──
  "%": { num: plain("percent") },
  点: { num: plain("score") },
  级: { num: plain("grade") },
} as const satisfies Record<PropertyUnit, UnitDimension>;

/** 量纲查表。词表与本表由 `satisfies` 绑死，故此处不会返回 undefined。 */
export function dimensionOf(unit: PropertyUnit): UnitDimension {
  return UNIT_DIMENSIONS[unit] as UnitDimension;
}

/** 这个单位是不是**速率/强度量**（有分母）。`件` false · `件/日` true。 */
export function isRateUnit(unit: PropertyUnit): boolean {
  return dimensionOf(unit).den !== undefined;
}

/**
 * **族键** —— 可比性的唯一判据。倍数不参与（`元` 与 `万元` 同族，`件/日` 与 `套/日` 不同族）。
 * 形如 `"count:件/time"`（速率）或 `"count:件"`（存量）。
 */
export function unitFamily(unit: PropertyUnit): string {
  const d = dimensionOf(unit);
  return d.den ? `${d.num.kind}/${d.den.kind}` : d.num.kind;
}

/** 同族 ⇒ 可比（可能仍需换算系数）。跨族 ⇒ 一律不可比。 */
export function sameUnitFamily(a: PropertyUnit, b: PropertyUnit): boolean {
  return unitFamily(a) === unitFamily(b);
}

/**
 * `a → b` 的换算系数：`value_b = value_a × factor`。
 *
 * 返回 `undefined` 有两种可能，调用方**必须区别对待**（用 {@link explainUnitMismatch} 取原因）：
 *   · 跨族 —— 根本不可比；
 *   · 同族但某一端倍数**未裁决**（`月`/`年`/`perRef`）—— 可比但换算要人先拍板。
 */
export function unitConversionFactor(a: PropertyUnit, b: PropertyUnit): number | undefined {
  if (!sameUnitFamily(a, b)) return undefined;
  const scale = (d: UnitDimension): number | undefined => {
    const n = d.num.factor;
    if (n === undefined) return undefined;
    if (!d.den) return n;
    const q = d.den.factor;
    return q === undefined ? undefined : n / q;
  };
  const sa = scale(dimensionOf(a));
  const sb = scale(dimensionOf(b));
  if (sa === undefined || sb === undefined || sb === 0) return undefined;
  return sa / sb;
}

/** 两个单位是否**逐值等同**（同族且换算系数恰为 1）—— 加减法的合格线。 */
export function unitsIdentical(a: PropertyUnit, b: PropertyUnit): boolean {
  return unitConversionFactor(a, b) === 1;
}

/**
 * 不匹配的**可读原因**；两者可直接相加时返回 `undefined`。
 *
 * ⚠ 四种原因必须分开说 —— 修法完全不同：跨族要改口径、异阶要改语义、
 * 异倍数要补换算、未裁决要人拍板。糊成一句「单位不一致」等于什么都没说。
 */
export function explainUnitMismatch(a: PropertyUnit, b: PropertyUnit): string | undefined {
  if (a === b) return undefined;
  const da = dimensionOf(a);
  const db = dimensionOf(b);
  if (da.num.kind === "perRef" || da.den?.kind === "perRef" || db.num.kind === "perRef" || db.den?.kind === "perRef") {
    return `量纲未解析：'${a}' 与 '${b}' 中含参数化单位（占位符 '${UNIT_REF_PLACEHOLDER}'），需先按 unitRefProp 求出具体单位再比较`;
  }
  if (isRateUnit(a) !== isRateUnit(b)) {
    const rate = isRateUnit(a) ? a : b;
    const stock = isRateUnit(a) ? b : a;
    return `量纲阶不同：'${stock}' 是存量、'${rate}' 是速率（每单位时间/窗口的量），两者不是同一个量，不可直接比较或相加`;
  }
  if (da.num.kind !== db.num.kind) {
    return `量纲跨族：'${a}' 的分子是 ${da.num.kind}、'${b}' 的分子是 ${db.num.kind}，两族之间没有已裁决的换算口径`;
  }
  if (da.den && db.den && da.den.kind !== db.den.kind) {
    return `量纲跨族：'${a}' 的分母是 ${da.den.kind}、'${b}' 的分母是 ${db.den.kind}，两族之间没有已裁决的换算口径`;
  }
  const f = unitConversionFactor(a, b);
  if (f === undefined) {
    return `同族但换算系数未裁决：'${a}' 与 '${b}' 属于同一族 ${unitFamily(a)}，但其中至少一端的倍数是口径问题（如 月/年 的天数），必须先裁决再换算`;
  }
  if (f !== 1) {
    return `同族异倍数：'${a}' 与 '${b}' 相差 ${f} 倍，直接相加会把结果错 ${f} 倍（需显式换算）`;
  }
  return undefined;
}

/**
 * 参数化单位求值：把占位符换成 `refValue`，落回词表。
 *
 * 例：`元/计量单位` + `"kg"` → `元/kg`；`计量单位` + `"㎡"` → `㎡`。
 * `refValue` 不在词表内（如某行 `unit` 写了 `"卷"`）⇒ 返回 `undefined`，
 * 调用方按「该行量纲未知」处理，**不许回落成声明值** —— 那等于把未知读成已知。
 */
export function resolveParametricUnit(declared: PropertyUnit, refValue: string): PropertyUnit | undefined {
  if (!declared.includes(UNIT_REF_PLACEHOLDER)) return declared;
  const candidate = declared.replace(UNIT_REF_PLACEHOLDER, refValue);
  return (PROPERTY_UNITS as readonly string[]).includes(candidate) ? (candidate as PropertyUnit) : undefined;
}

/** 这个单位含参数化占位符吗（⇒ 必须配 `PropertyDef.unitRefProp`）。 */
export function isParametricUnit(unit: string): boolean {
  return unit.includes(UNIT_REF_PLACEHOLDER);
}

// ---------------------------------------------------------------------------
// 公式量纲推断（派生属性门用）
// ---------------------------------------------------------------------------

/**
 * 推断结果。`"unknown"` 是**诚实的第三态** —— 不是「无量纲」也不是「出错了」，
 * 而是「这一段表达式的量纲本模型表达不了」（如 `件 × 元` 这种乘积复合）。
 * 未知的一端**不参与**任何校验：本门只在**两端都已知**时说话，绝不拿未知当证据。
 */
export type InferredDimension = { kind: "known"; unit: PropertyUnit } | { kind: "unknown" };

const UNKNOWN: InferredDimension = { kind: "unknown" };
/** 纯数字字面量：无量纲，可与任何量纲相乘/相除，也可与任何量纲相加（缩放/偏移常数）。 */
const NUMERIC: InferredDimension = { kind: "known", unit: "dimensionless" };

export interface FormulaDimensionIssue {
  /** 出问题的那两个单位。 */
  left: PropertyUnit;
  right: PropertyUnit;
  /** 可读原因（{@link explainUnitMismatch} 的原文）。 */
  reason: string;
  /** 出问题的运算符。 */
  op: "+" | "-";
}

/**
 * 对 `evalArithmetic` 那套**同一份文法**做量纲推断，只报**加减法两端不可加**这一类问题。
 *
 * ⚠ 为什么只管加减、不管乘除与声明值：
 *   · 加减法的两端**必须同量纲**，这是无争议的算术事实，误伤面为 0（实测本仓 6 条加减式
 *     全部同族同倍数）；
 *   · 乘除会产生本模型表达不了的复合量纲（`件 × 元`），强行校验只会制造假红；
 *   · 「声明的 unit 与推断的 unit 一致」这条**今天还不成立**（`Order.value = qty(件)*unitPrice(元)`
 *     声明 `元`），要成立得先改口径 —— 那是别的单的事，本门不越界。
 *
 * ⚠ 分词与 `evalArithmetic` **共用同一条正则**（不许各抄一份 —— 抄了就是装饰品：
 *   主逻辑改了文法，本函数拿旧的去测，照样绿）。
 */
export function inferFormulaDimensionIssues(
  formula: string,
  unitOf: (identifier: string) => PropertyUnit | undefined,
): FormulaDimensionIssue[] {
  // 与 `ontology.ts evalArithmetic` 同一条分词正则。
  const tokens = formula.match(/\d+(?:\.\d+)?|[A-Za-z_][\w]*|[+\-*/()]/g) ?? [];
  const issues: FormulaDimensionIssue[] = [];
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  function parsePrimary(): InferredDimension {
    const t = next();
    if (t === undefined) return UNKNOWN;
    if (t === "(") {
      const v = parseAdd();
      if (peek() === ")") next();
      return v;
    }
    if (t === "-") return parsePrimary();
    if (/^\d/.test(t)) return NUMERIC;
    const u = unitOf(t);
    return u === undefined ? UNKNOWN : { kind: "known", unit: u };
  }
  function parseMul(): InferredDimension {
    let v = parsePrimary();
    while (peek() === "*" || peek() === "/") {
      next();
      const r = parsePrimary();
      // 与纯数字相乘/相除**保量纲**（`x / 100`、`x * 2`）；其余复合一律降级为 unknown。
      if (v.kind === "known" && r.kind === "known" && r.unit === "dimensionless") continue;
      if (v.kind === "known" && v.unit === "dimensionless" && r.kind === "known") v = r;
      else v = UNKNOWN;
    }
    return v;
  }
  function parseAdd(): InferredDimension {
    let v = parseMul();
    while (peek() === "+" || peek() === "-") {
      const op = next() as "+" | "-";
      const r = parseMul();
      if (v.kind === "known" && r.kind === "known") {
        // 无量纲常数（`x + 1`）不构成量纲冲突：它是缩放/偏移，不是「另一个量」。
        if (v.unit !== "dimensionless" && r.unit !== "dimensionless") {
          const reason = explainUnitMismatch(v.unit, r.unit);
          if (reason) issues.push({ left: v.unit, right: r.unit, reason, op });
        }
        if (v.unit === "dimensionless") v = r;
      } else {
        v = UNKNOWN;
      }
    }
    return v;
  }
  parseAdd();
  return issues;
}
