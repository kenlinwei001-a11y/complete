/**
 * WO-SANDBOX-E3 · 阻滞点判定器 —— 把「卡点 / 堵点 / 断点」做成**机器可判定**，产出 `ChainImpediment[]`。
 *
 * ══ 本文件的一条铁律 ═══════════════════════════════════════════════════════════
 * **本引擎里没有任何业务阈值。** 一个数字都没有。
 * 每条判据的阈值都是**从那条规则自己的表达式里读回来的**（`params.<名>` → `rule.params`，
 * 字面量 → 表达式里的那个数，字段 → 对象上的那个属性），读不回来就诚实 `UNKNOWN`。
 * 于是「改规则 params 的阈值 → 判定结果跟着变」不是靠自觉维护，而是**结构上不可能不成立**：
 * 引擎没有第二个地方可以存阈值。
 *
 * ── 为什么是"读回阈值"而不是"整体求值 expression" ────────────────────────────
 * 两者都用（见 `judgeOne`）：
 *  · **非 SUSTAIN 规则** → 直接 `evaluateExpression(rule.expression, { payload, params: rule.params })`
 *    ——就是 `SolverService.evaluateRuleRefs` / `RulesService.evaluate` 用的**同一个调用**
 *    （WO-RULE-EXPR-PARAMS 打通的那套，不新造第二套）。整条表达式生效，
 *    C09 的 `critical == TRUE AND lagHours > params.staleHours` 两个合取项都算数。
 *  · **含 SUSTAIN 的规则**（C05 `SUSTAIN(Line.utilization > 95, 3)`）→ 整体求值会**恒 false**
 *    （`evaluateAst` 无 `sustain` provider 时返回 false，见 `ruledsl.ts:554`），
 *    那是哑弹不是判定。而 `SolverContext` **没有时序访问**（本体 §5 R13 注记：
 *    "SolverContext 无时序访问（仅对象快照）"）—— 实测确认：`SolverContext` 十类里没有任何序列。
 *    故此类规则只读它声明的**红线数值**（PRD §5.1「阈值来源：规则 C* 的利用率红线」正是这个用法），
 *    在快照上比对，并**显式记 caveat + dataMode=PARTIAL**：持续天数没校验就说没校验，
 *    绝不让一条"持续 3 天"的规则悄悄退化成"这一刻超了"还装作全量判定。
 *
 * ── 三类互斥怎么裁决（不许靠 if 顺序的巧合）────────────────────────────────
 * `arbitrateByLocus` 是**唯一**裁决处，判据写死在函数注释里：同一个 locus 同时出卡点与堵点时，
 * **按「利用率是否达红线」裁决，达线 = 卡点**（PRD §5.1 / contracts `chain-sim.ts` §6 原文）。
 * 红线本身也是从规则读回来的（`utilizationRedline`），不是常数。
 * 教训来源：`wo-capacity-100pct` R7–R9 轮修的"排序契约靠 clamp 巧合"。
 *
 * ── 诚实缺席（本单的头号判据）──────────────────────────────────────────────
 * 规则没发布 / 阈值读不回来 / 指标在对象上无承载 —— 一律进 `unresolved[]` 并写清**为什么**，
 * **绝不**给一个看着合理的默认阈值再判出一堆像模像样的阻滞点。
 * （本仓刚坐实过一条死映射导致 24 张单里 12 张被静默标错，界面完全看不出来。静默错答比跑不通更糟。）
 *
 * R6 确定性：纯函数，无 `Date.now`、无随机；`scanId`/`impedimentId` 由输入哈希派生；
 * 排序走 contracts 冻结的全序比较器 `compareChainImpediment`。
 */
import {
  ChainImpedimentSchema,
  compareChainImpediment,
  isChainScopeUnscoped,
  readProcessHardCapacity,
  type ChainBreakSubtype,
  type ChainImpediment,
  type ChainImpedimentKind,
  type ChainScope,
  type ChainStage,
  type DerivedDataMode,
  type NoCandidateKind,
} from "@platform/contracts";
import type { LinkInstance, ObjectInstance } from "../domain.js";
import { canonicalJson, hashString, round } from "../prng.js";
import { enumerateImpedimentOptions } from "./impediment-options.js"; // WO-SANDBOX-S3 · 阻滞点 → 候选方案枚举器
import {
  DslError,
  evaluateExpression,
  parseExpression,
  resolveField,
  type AstNode,
  type CmpOp,
  type Operand,
} from "../ruledsl.js";
import { num, str, type SolverContext } from "./types.js";

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · 判据声明表（单一来源）—— 每条判据「用哪条规则的哪个阈值」在这里登记，别处不许再写
// ══════════════════════════════════════════════════════════════════════════════

/** 规则快照形态（= `SolverContext["rules"]` 的元素，避免跨包重定义契约 R1）。 */
export type RuleSnapshot = NonNullable<SolverContext["rules"]>[string];

export interface ImpedimentRuleBinding {
  /** 判据 id（进 `impedimentId`，必须稳定 —— 改了就是换了一条判据）。 */
  bindingId: string;
  kind: ChainImpedimentKind;
  /** `kind === "BREAK"` 时必填（contracts 硬约束）。 */
  breakSubtype?: ChainBreakSubtype;
  stage: ChainStage;
  /** 阈值与判定条件所属规则码。规则未发布 → 本判据 UNKNOWN（不兜底）。 */
  ruleKey: string;
  /**
   * 规则表达式里承载**实测值**的那个字段路径（如 `Process.parallelThroughput`）。
   * 阈值 = 同一个比较节点的**另一侧**操作数 —— 由 `readRuleThreshold` 从 AST 读回，不在此登记数值。
   */
  metricPath: string;
  /** locus 的对象类型（落到真对象上·R13）。 */
  locusObjectType: string;
  /** metricValue / threshold 的共用单位（两者不同单位 = 量纲错，R18 教训）。 */
  unit: string;
  /**
   * 阈值为 0 时的**超阈幅度分母**（severity 归一化用）。
   * 例：C06 `gapTon > 0` 的 0 不能当分母 —— 用同一对象上的 `netDemandTon`（真属性）作规模基准。
   * 缺它且阈值为 0 → severity 算不出来 → 该判据整条进 `unresolved`（不拍一个 severity）。
   */
  magnitudePath?: string;
  /** 人读：这条判据在业务上是什么意思（进不了代码逻辑，只进文档与交付说明）。 */
  semantics: string;
}

/**
 * **判据声明表**。六条，覆盖三类。
 *
 * 纪律：`ruleKey` 一律指向**已在规则库定义**的规则码（`synthetic/battery.ts BATTERY_RULES`），
 * 不虚构规则码 —— 虚构一个 "C34" 会让它看着像官方规则，实际全仓无定义（`rule-closure` 同族纪律）。
 * 某条判据今天判不出来（规则未发布 / 指标无对象承载）就诚实 `UNKNOWN`，这本身就是 R16 的生长信号。
 */
export const IMPEDIMENT_RULE_BINDINGS: readonly ImpedimentRuleBinding[] = [
  {
    // 卡点①：硬容量夹定（D3 已把柜位/库位读进本体：Process.capacityUnitKind + requiredThroughput）。
    // C02 的表达式 `Process.parallelThroughput < Process.requiredThroughput` 此前**恒不可评估**
    // （左操作数全仓无承载，见 contracts/process-capacity.ts 取证注释）——本判据把 D3 的
    // `readProcessHardCapacity().capacityPerDay` 喂进 `parallelThroughput`，让 C02 第一次真能判。
    bindingId: "BOTTLENECK.CAPACITY.process-hard-capacity",
    kind: "BOTTLENECK",
    stage: "CAPACITY",
    ruleKey: "C02",
    metricPath: "Process.parallelThroughput",
    locusObjectType: "Process",
    unit: "电芯/天",
    semantics: "并行段（化成柜位/老化库位）日通过量低于上游串行段要求 ⇒ 硬容量夹定 = 卡点（加产能有用）",
  },
  {
    // 卡点②：产线利用率达红线。C05 是 SUSTAIN 规则 —— 本判据**只读它声明的红线**，
    // 不冒充"持续 N 天"（见文件头）。红线同时是 §3 三类互斥的**裁决线**。
    bindingId: "BOTTLENECK.CAPACITY.line-utilization-redline",
    kind: "BOTTLENECK",
    stage: "CAPACITY",
    ruleKey: "C05",
    metricPath: "Line.utilization",
    locusObjectType: "Line",
    unit: "%",
    semantics: "产线利用率达/超规则红线 ⇒ 速率上限被打满 = 卡点",
  },
  {
    // 堵点①：换型损失。PRD 附录 A2 的招牌例（"利用率未达卡点线但实际/理论产出偏低 —— 换型频繁流不动"）。
    // 实测：`Order.changeoverMin` **不是 Order 的对象属性**（由 changeover_sequence 求解器算出），
    // 故本判据今天恒 UNKNOWN —— 这是"接了线没数据"，不是"没接线"，reason 里说清楚。
    bindingId: "CONGESTION.CAPACITY.order-changeover",
    kind: "CONGESTION",
    stage: "CAPACITY",
    ruleKey: "C22",
    metricPath: "Order.changeoverMin",
    locusObjectType: "Order",
    unit: "分钟",
    semantics: "换型时间过长导致流不动（能力够但排队/切换吃掉吞吐）= 堵点（加产能没用）",
  },
  {
    // 堵点②：在制/在途堆积 —— 呆滞批次。这是今天唯一有真数据的堵点判据。
    bindingId: "CONGESTION.MATERIAL.batch-idle",
    kind: "CONGESTION",
    stage: "MATERIAL",
    ruleKey: "C28",
    metricPath: "Batch.idleDays",
    locusObjectType: "MaterialBatch",
    unit: "天",
    semantics: "物料批次呆滞天数越线 ⇒ 在库/在制堆积不动 = 堵点",
  },
  {
    // 断点·物理：缺料。
    bindingId: "BREAK.MATERIAL.material-gap",
    kind: "BREAK",
    breakSubtype: "MATERIAL",
    stage: "MATERIAL",
    ruleKey: "C06",
    metricPath: "MaterialBalance.gapTon",
    locusObjectType: "MaterialBalance",
    unit: "吨",
    // C06 阈值是 0 → 超阈幅度必须换个分母，用同一对象的净需求（真属性）。
    magnitudePath: "MaterialBalance.netDemandTon",
    semantics: "物料现货缺口 > 阈值 ⇒ 下游拿不到输入 = 断点（物理断）",
  },
  {
    // 断点·数据：关键数据源延迟越线 ⇒ 该环节读数不可信 ⇒ **算不出来**（contracts 硬约束：dataMode 必须 EMPTY）。
    // 阈值 `params.staleHours` 是全仓**今天就存在**的命名阈值（C09.params，且已进 RULE_PARAM_BINDINGS）——
    // 本条是"改规则 params 一个数、一行代码不改、判定跟着翻"的纯 param SEAM。
    bindingId: "BREAK.DATA.datasource-stale",
    kind: "BREAK",
    breakSubtype: "DATA",
    // stage：C09 的数值消费方是 capacity_forecast 的 P90 健康度系数（health.staleHours/health.degraded），
    // 故落产能段 —— 不按数据源名字猜段（那是编映射）。
    stage: "CAPACITY",
    ruleKey: "C09",
    metricPath: "DataSourceHealth.lagHours",
    locusObjectType: "DataSourceHealth",
    unit: "小时",
    semantics: "关键数据源延迟超规则阈值 ⇒ 该环节算不出来 = 断点（数据断）· 算不出来也是一种发现",
  },
] as const;

/**
 * **今天全库没有承载物、故本单不产出**的判据 —— 登记在册而不是不提。
 * 断点·时间（提前期兜不住）：规则库 28 条里**没有任何一条**以提前期/到货期为主词
 * （逐条核过 C01–C33：C27 是长协执行偏差、C11 是检修缓冲、C29 是排产冻结期，都不是提前期）。
 * 编一条"leadTime > 阈值"塞进引擎就是本单明令禁止的「看起来合理的假判定」，故诚实缺席。
 */
export const UNBOUND_IMPEDIMENT_JUDGEMENTS: readonly {
  kind: ChainImpedimentKind;
  breakSubtype?: ChainBreakSubtype;
  reason: string;
}[] = [
  {
    kind: "BREAK",
    breakSubtype: "LEADTIME",
    reason:
      "断点·时间（上游可用日 > 下游需求日）在规则库 C01–C33 中无任何承载阈值的规则（逐条核过）；" +
      "本引擎拒绝自造提前期阈值 —— 需先在规则库定义一条提前期规则，本判定器随即可绑定（R16 生长信号）",
  },
] as const;

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 阈值读回（把规则表达式里的阈值**读出来**，引擎自己一个数都不存）
// ══════════════════════════════════════════════════════════════════════════════

export type ThresholdSource = "param" | "literal" | "field";

export type ThresholdRead =
  | {
      status: "OK";
      value: number;
      source: ThresholdSource;
      /** `source === "param"` 时：阈值在规则 params 里的键名（改这个旋钮即改判定 · R13）。 */
      ruleParamKey?: string;
      /** `source === "field"` 时：阈值取自对象的哪个属性。 */
      fieldPath?: string;
      /** 比较运算符（违规条件的方向，用于算超阈幅度）。 */
      op: CmpOp;
      /** 实测值是否在比较式左侧。 */
      metricOnLeft: boolean;
    }
  | { status: "UNKNOWN"; reason: string };

const pathOf = (o: Operand): string | null => (o.kind === "field" ? o.path.join(".") : null);

/** 字段路径匹配：允许「前缀可省」（与 `resolveField` 同口径：`Order.qty` 也认 `qty`）。 */
function fieldMatches(operandPath: string, metricPath: string): boolean {
  if (operandPath === metricPath) return true;
  const tail = metricPath.split(".").slice(1).join(".");
  return tail.length > 0 && operandPath === tail;
}

/** 深度优先找**第一个**以 metricPath 为一侧操作数的比较节点（含 SUSTAIN 内层）。 */
function findMetricCmp(
  node: AstNode,
  metricPath: string,
): { op: CmpOp; metric: Operand; other: Operand; metricOnLeft: boolean } | null {
  switch (node.kind) {
    case "and":
    case "or":
      return findMetricCmp(node.left, metricPath) ?? findMetricCmp(node.right, metricPath);
    case "not":
      return findMetricCmp(node.operand, metricPath);
    case "sustain":
      return findMetricCmp(node.inner, metricPath);
    case "cmp": {
      const lp = pathOf(node.left);
      const rp = pathOf(node.right);
      if (lp !== null && fieldMatches(lp, metricPath)) {
        return { op: node.op, metric: node.left, other: node.right, metricOnLeft: true };
      }
      if (rp !== null && fieldMatches(rp, metricPath)) {
        return { op: node.op, metric: node.right, other: node.left, metricOnLeft: false };
      }
      return null;
    }
  }
}

/**
 * 从规则表达式里**读回**该判据的阈值。这是本引擎唯一的阈值来源。
 *
 * 三种来源都支持，且**都是规则说了算**：
 *  · `params.<名>`  → `rule.params[名]`（WO-RULE-EXPR-PARAMS 的命名阈值 —— 改 params 即改判定）
 *  · 字面量          → 表达式里写的那个数（规则今天的形态，改 expression 即改判定）
 *  · 另一个字段      → 对象上的那个属性（如 C02 的 `Process.requiredThroughput`，改数据即改判定）
 *
 * 读不回来一律 `UNKNOWN` + 原因。**没有第四种分支**（不存在"给个默认阈值"）。
 */
export function readRuleThreshold(
  rule: Pick<RuleSnapshot, "key" | "expression" | "params">,
  metricPath: string,
  payload: Record<string, unknown>,
): ThresholdRead {
  let ast: AstNode;
  try {
    ast = parseExpression(rule.expression);
  } catch (e) {
    const msg = e instanceof DslError ? e.message : e instanceof Error ? e.message : String(e);
    return { status: "UNKNOWN", reason: `规则 ${rule.key} 表达式不可解析：${msg}` };
  }
  const hit = findMetricCmp(ast, metricPath);
  if (!hit) {
    return {
      status: "UNKNOWN",
      reason: `规则 ${rule.key} 的表达式未以 ${metricPath} 为比较操作数（${rule.expression}）—— 判据与规则口径不符，拒绝硬凑`,
    };
  }
  const { other, op, metricOnLeft } = hit;
  if (other.kind === "param") {
    const raw = rule.params?.[other.name];
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      return {
        status: "UNKNOWN",
        reason: `规则 ${rule.key} 引用命名阈值 params.${other.name}，但其 params 未声明数值（诚实缺席，不按缺省值判）`,
      };
    }
    return { status: "OK", value: raw, source: "param", ruleParamKey: other.name, op, metricOnLeft };
  }
  if (other.kind === "literal") {
    if (typeof other.value !== "number" || !Number.isFinite(other.value)) {
      return { status: "UNKNOWN", reason: `规则 ${rule.key} 的阈值不是有限数值（${String(other.value)}）` };
    }
    return { status: "OK", value: other.value, source: "literal", op, metricOnLeft };
  }
  if (other.kind === "field") {
    const path = other.path.join(".");
    const v = resolveField(payload, other.path);
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { status: "UNKNOWN", reason: `规则 ${rule.key} 的阈值取自字段 ${path}，但该对象上无有限数值` };
    }
    return { status: "OK", value: v, source: "field", fieldPath: path, op, metricOnLeft };
  }
  return { status: "UNKNOWN", reason: `规则 ${rule.key} 的阈值操作数类型 ${other.kind} 不支持读回` };
}

/**
 * 超阈幅度（违规方向上超出阈值多少，未违规为 0）。方向完全由规则的比较符决定，引擎不假设方向。
 * 规则表达式 = **违规条件**（本仓 DSL 约定），故"命中即违规"。
 */
export function breachAmount(metric: number, threshold: number, op: CmpOp, metricOnLeft: boolean): number {
  // 把「实测在右侧」的写法翻成等价的「实测在左侧」写法，避免两套分支。
  const flipped: Record<string, CmpOp> = { ">": "<", ">=": "<=", "<": ">", "<=": ">=", "==": "==", "!=": "!=", IN: "IN" };
  const eff = metricOnLeft ? op : (flipped[op] as CmpOp);
  if (eff === ">" || eff === ">=") return Math.max(0, metric - threshold);
  if (eff === "<" || eff === "<=") return Math.max(0, threshold - metric);
  return 0; // ==/!=/IN 无连续幅度可言
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · 三类互斥裁决（唯一裁决处 · 判据写在这里，不靠 if 顺序的巧合）
// ══════════════════════════════════════════════════════════════════════════════

/** 裁决前的候选（同一 locus 可能有多条）。 */
export interface ImpedimentCandidate {
  impediment: ChainImpediment;
  bindingId: string;
  /** 该 locus 的利用率读数（有就给）——裁决线比对用。 */
  utilization?: number;
  /**
   * WO-SANDBOX-S3：该阻滞点是**哪条判据**在**哪个真对象实例**上判出来的。
   * 方案枚举器要沿这两样往下走（jo in 的起点），而 `ChainImpediment` 本身只带业务 id（`locus.objectId`），
   * 不带实例 `o.id` —— 让枚举器拿业务 id 反查实例等于再造一张"类型→id 属性"的映射表，
   * 那正是本仓禁的东西。故判定时**顺手把来源带下去**，不重新猜。
   */
  origin?: { binding: ImpedimentRuleBinding; obj: ObjectInstance };
}

/**
 * **三类互斥的唯一裁决实现**（PRD §5.1 / contracts `chain-sim.ts` §6 原文）：
 *
 *   同一个 locus 同时满足卡点与堵点判据时，**按「利用率是否达红线」裁决 —— 达线 = 卡点**。
 *   理由：卡点是"能力不够"（加产能有用），堵点是"流不动"（加产能没用）；
 *   利用率达红线说明速率上限确实被打满，那就是不够，而不是流不动。
 *
 * 判据顺序（显式，不靠数组序）：
 *   ① 有卡点候选 且（该 locus 利用率 ≥ 红线 或 红线读不回来但卡点候选本身不是利用率判据）→ 取卡点
 *   ② 否则有堵点候选 → 取堵点
 *   ③ 否则取断点候选
 *   ④ 同类多条 → 按 `compareChainImpediment`（contracts 冻结全序）取第一条，R6 稳定
 *
 * `utilizationRedline` 为 `null`（红线读不回来）时**不静默当 0 或当 100**：
 * 此时若卡点候选来自"硬容量夹定"（与利用率无关的硬约束）仍取卡点；若卡点候选就是利用率判据，
 * 那它根本不会被产出（阈值读不回来的判据早在 `judgeOne` 就进了 unresolved），所以这里不会走到。
 */
export function arbitrateByLocus(
  candidates: readonly ImpedimentCandidate[],
  utilizationRedline: number | null,
): ChainImpediment[] {
  const byLocus = new Map<string, ImpedimentCandidate[]>();
  for (const c of candidates) {
    const key = `${c.impediment.locus.objectType}|${c.impediment.locus.objectId}`;
    const list = byLocus.get(key);
    if (list) list.push(c);
    else byLocus.set(key, [c]);
  }
  const kept: ChainImpediment[] = [];
  for (const list of byLocus.values()) {
    if (list.length === 1) {
      kept.push(list[0]!.impediment);
      continue;
    }
    const pickOf = (kind: ChainImpedimentKind): ChainImpediment | undefined =>
      list
        .filter((c) => c.impediment.kind === kind)
        .map((c) => c.impediment)
        .sort(compareChainImpediment)[0];
    const bottleneck = list.filter((c) => c.impediment.kind === "BOTTLENECK");
    const util = list.map((c) => c.utilization).find((u) => typeof u === "number");
    const atRedline =
      utilizationRedline !== null && typeof util === "number" ? util >= utilizationRedline : false;
    // ① 达红线 → 卡点；红线/利用率任一读不到时，只要卡点候选存在（那必是硬约束类）也取卡点。
    const bnPick = pickOf("BOTTLENECK");
    if (bottleneck.length > 0 && bnPick && (atRedline || typeof util !== "number" || utilizationRedline === null)) {
      kept.push(bnPick);
      continue;
    }
    const cgPick = pickOf("CONGESTION");
    if (cgPick) {
      kept.push(cgPick);
      continue;
    }
    const brPick = pickOf("BREAK");
    if (brPick) {
      kept.push(brPick);
      continue;
    }
    if (bnPick) kept.push(bnPick);
  }
  return kept.sort(compareChainImpediment);
}

// ══════════════════════════════════════════════════════════════════════════════
// § 4 · 扫描
// ══════════════════════════════════════════════════════════════════════════════

export interface ChainScanUnresolved {
  bindingId: string;
  kind: ChainImpedimentKind;
  breakSubtype?: ChainBreakSubtype;
  stage?: ChainStage;
  ruleKey?: string;
  status: "UNKNOWN";
  reason: string;
}

export interface ChainScanThresholdRow {
  bindingId: string;
  ruleKey: string;
  source: ThresholdSource;
  /** 改哪个旋钮会改这条判定（`source==="param"` 时给）。 */
  ruleParamKey?: string;
  fieldPath?: string;
  /** `source==="field"` 时阈值逐对象不同，这里给的是**首个被判对象**上的取值（示例值）。 */
  value: number;
  unit: string;
}

export interface ChainScanResult extends Record<string, unknown> {
  scanId: string;
  scope: ChainScope;
  ruleSetVersion?: string;
  impediments: ChainImpediment[];
  counts: { total: number; BOTTLENECK: number; CONGESTION: number; BREAK: number };
  /** 判不出来的判据 —— 诚实 UNKNOWN + 原因，绝不给假判定。 */
  unresolved: ChainScanUnresolved[];
  /** 判得出但语义被削弱的说明（如 SUSTAIN 的持续天数未校验）。 */
  caveats: { bindingId: string; ruleKey: string; note: string }[];
  /** 每条判据的阈值出处逐条亮出（R13：这条结论的旋钮在哪）。 */
  thresholds: ChainScanThresholdRow[];
  /**
   * WO-SANDBOX-S3 · 候选枚举的逐点账（探了几个杠杆锚点 / 几次试算 / 有效几个 / 下发几个 / 缺口原文）。
   * 它是「为什么这个阻滞点没有方案」的唯一可查处 —— 空白比错答更容易被当成「没问题」。
   */
  candidateStats: {
    impedimentId: string;
    anchors: number;
    probes: number;
    effective: number;
    emitted: number;
    gaps: string[];
    /** 空候选的机器可读定性（`NONE` 算过了真没有 / `UNAVAILABLE` 压根没算出来）；有候选时缺省。 */
    noCandidateKind?: NoCandidateKind;
  }[];
  /** 探针预算耗尽 → **显式**标注截断（`PRD-sandbox-redesign.md` §7.2③：不静默截断）。 */
  candidatesTruncated: boolean;
  /** 本次扫描一共跑了几次产能试算探针（性能与 R6 可复现性的账）。 */
  candidateProbes: number;
}

export interface ChainScanInput {
  c: SolverContext;
  /** `MaterialBalance` 不在 SolverContext 的核心/扩展类里（`mrp_netting` 亦是自行读取），由调用方注入。 */
  materialBalances?: ObjectInstance[];
  scope: ChainScope;
  bindings?: readonly ImpedimentRuleBinding[];
  /**
   * WO-SANDBOX-S3 · **一等关系行**（`links` 表），候选枚举器的 `LINK_HOP` join 面。
   * 缺省 `[]` → 一跳可达面为空，枚举器诚实记「本体上它是孤点」，**不会**回落成"按类型广播"
   * （那正是编映射的开始）。由调用方（`SolverService.chainImpediments`）注入，判定本身不受影响。
   */
  links?: readonly LinkInstance[];
  /**
   * WO-SANDBOX-S3-ENUM · 候选枚举的产能探针预算上界（缺省 `CANDIDATE_PROBE_BUDGET`）。
   *
   * **刻意不做成 HTTP 入参**：它是算力旋钮不是业务范围，暴露到 `args` 会被误读成"筛选条件"。
   * 存在的理由是「算不了」这条路必须**可被驱动**才不是死分支 —— 预算调小 ⇒ 逐候选试算跑不完 ⇒
   * 空候选被定性为 `UNAVAILABLE` 而非 `NONE`。判定本身（阻滞点条数/severity）不受此参数影响。
   */
  probeBudget?: number;
}

/** 该 binding 要扫的对象集合（+ 每个对象的**派生补充字段**，如 D3 硬容量算出的 parallelThroughput）。 */
function loci(
  input: ChainScanInput,
  b: ImpedimentRuleBinding,
): { obj: ObjectInstance; extra: Record<string, unknown>; label: string; objectId: string; baseId?: string }[] {
  const { c } = input;
  const mk = (
    objs: readonly ObjectInstance[],
    idProp: string,
    labelProp: string,
    extraOf?: (o: ObjectInstance) => Record<string, unknown> | null,
  ) =>
    objs.flatMap((o) => {
      const extra = extraOf ? extraOf(o) : {};
      if (extra === null) return [];
      const objectId = str(o.props[idProp], o.id);
      const label = str(o.props[labelProp], objectId);
      const baseId = typeof o.props.baseId === "string" ? o.props.baseId : undefined;
      return [{ obj: o, extra, label, objectId, ...(baseId === undefined ? {} : { baseId }) }];
    });

  switch (b.locusObjectType) {
    case "Process":
      return mk(c.processes, "processId", "name", (o) => {
        // D3 单源：柜位数 × 单柜位日通过量 × 工序良率。没打 capacityUnitKind 标签的串行工序不承载硬容量 → 不扫。
        const reading = readProcessHardCapacity(o.props);
        if (reading.status === "EMPTY") return null;
        return { parallelThroughput: reading.capacityPerDay, capacityUnitKind: reading.unitKind, units: reading.units };
      });
    case "Line":
      return mk(c.lines, "lineId", "name");
    case "Order":
      return mk(c.orders, "so", "so");
    case "MaterialBatch":
      return mk(c.materialBatches ?? [], "batchId", "batchId");
    case "MaterialBalance":
      return mk(input.materialBalances ?? [], "matBalId", "material");
    case "DataSourceHealth":
      return mk(c.dataHealth, "sourceId", "name");
    default:
      return [];
  }
}

/** 判定单条 binding。返回命中的候选 + （判不出来时的）UNKNOWN 行 + caveat + 阈值出处行。 */
function judgeOne(
  input: ChainScanInput,
  b: ImpedimentRuleBinding,
  scanId: string,
): {
  candidates: ImpedimentCandidate[];
  unresolved?: ChainScanUnresolved;
  caveat?: { bindingId: string; ruleKey: string; note: string };
  threshold?: ChainScanThresholdRow;
} {
  const { c } = input;
  const unresolved = (reason: string) => ({
    candidates: [] as ImpedimentCandidate[],
    unresolved: {
      bindingId: b.bindingId,
      kind: b.kind,
      ...(b.breakSubtype === undefined ? {} : { breakSubtype: b.breakSubtype }),
      stage: b.stage,
      ruleKey: b.ruleKey,
      status: "UNKNOWN" as const,
      reason,
    },
  });

  const rule = c.rules?.[b.ruleKey];
  if (!rule || !rule.expression.trim()) {
    return unresolved(`规则 ${b.ruleKey} 未发布或表达式为空 —— 本判据无阈值来源（不代判、不兜底）`);
  }

  const prefix = b.metricPath.split(".")[0] as string;
  const metricLeaf = b.metricPath.split(".").slice(1).join(".");
  const objs = loci(input, b);
  if (objs.length === 0) {
    return unresolved(`本体中无可判对象（${b.locusObjectType} 为空，或均未承载该判据所需属性）`);
  }

  // scope 过滤：只对**带 baseId 的 locus** 生效；不带 baseId 的对象类型（物料/数据源等）不是基地维实体。
  const wantBases = input.scope.baseIds;
  const scoped = wantBases ? objs.filter((o) => o.baseId === undefined || wantBases.includes(o.baseId)) : objs;
  if (scoped.length === 0) {
    return unresolved(`scope.baseIds 过滤后无可判对象（${b.locusObjectType}）`);
  }

  let sawMetric = false;
  let lastThresholdIssue = "";
  let thresholdRow: ChainScanThresholdRow | undefined;
  let caveat: { bindingId: string; ruleKey: string; note: string } | undefined;
  const candidates: ImpedimentCandidate[] = [];
  const hasSustain = /\bSUSTAIN\s*\(/.test(rule.expression);

  for (const l of scoped) {
    const props: Record<string, unknown> = { ...l.obj.props, ...l.extra };
    const payload: Record<string, unknown> = { [prefix]: props };
    const metricRaw = resolveField(payload, b.metricPath.split("."));
    if (typeof metricRaw !== "number" || !Number.isFinite(metricRaw)) continue; // 该对象上无此指标 → 不是"违规"，是没这个量
    sawMetric = true;
    const metric = metricRaw;

    const th = readRuleThreshold(rule, b.metricPath, payload);
    if (th.status === "UNKNOWN") {
      lastThresholdIssue = th.reason;
      continue;
    }
    if (!thresholdRow) {
      thresholdRow = {
        bindingId: b.bindingId,
        ruleKey: b.ruleKey,
        source: th.source,
        ...(th.ruleParamKey === undefined ? {} : { ruleParamKey: th.ruleParamKey }),
        ...(th.fieldPath === undefined ? {} : { fieldPath: th.fieldPath }),
        value: th.value,
        unit: b.unit,
      };
    }

    // ── 判定 ──
    // 非 SUSTAIN：整条表达式交给规则引擎（= evaluateRuleRefs / RulesService.evaluate 的同一个调用）。
    // 含 SUSTAIN：整体求值必恒 false（无 sustain provider）⇒ 退回"读回的红线 + 比较符"在快照上比对，
    //             并显式记 caveat（持续天数没校验就说没校验）。
    let violated: boolean;
    if (hasSustain) {
      violated = breachAmount(metric, th.value, th.op, th.metricOnLeft) > 0;
      caveat ??= {
        bindingId: b.bindingId,
        ruleKey: b.ruleKey,
        note:
          `规则 ${b.ruleKey} 含 SUSTAIN（持续判定），而 SolverContext 无时序访问 —— ` +
          `本次只比对快照与规则红线 ${th.value}${b.unit}，**未校验持续天数**；结论 dataMode 标 PARTIAL`,
      };
    } else {
      try {
        violated = evaluateExpression(rule.expression, { payload, params: rule.params });
      } catch (e) {
        lastThresholdIssue = `规则 ${b.ruleKey} 求值失败：${e instanceof Error ? e.message : String(e)}`;
        continue;
      }
    }
    if (!violated) continue;

    // ── severity：必须算出来（禁固定权重表）——超阈幅度 / 规模基准。
    const breach = breachAmount(metric, th.value, th.op, th.metricOnLeft);
    let denom = Math.abs(th.value);
    if (!(denom > 0)) {
      const magRaw = b.magnitudePath ? resolveField(payload, b.magnitudePath.split(".")) : undefined;
      if (typeof magRaw === "number" && Number.isFinite(magRaw) && Math.abs(magRaw) > 0) denom = Math.abs(magRaw);
    }
    if (!(denom > 0)) {
      lastThresholdIssue =
        `阈值为 0 且无规模基准（binding.magnitudePath=${b.magnitudePath ?? "未声明"}）—— ` +
        `severity 算不出来，拒绝拍一个数（${l.objectId}）`;
      continue;
    }
    const severity = Math.max(0, Math.min(100, Math.round((breach / denom) * 100)));

    const isSynthetic = c.isSynthProvenance?.(l.obj) === true;
    const dataMode: DerivedDataMode =
      b.breakSubtype === "DATA" ? "EMPTY" : hasSustain ? "PARTIAL" : isSynthetic ? "SYNTHETIC" : "LIVE";

    const impediment: ChainImpediment = ChainImpedimentSchema.parse({
      impedimentId: `imp_${b.bindingId}_${l.objectId}`,
      tenantId: c.tenantId,
      scanId,
      kind: b.kind,
      ...(b.breakSubtype === undefined ? {} : { breakSubtype: b.breakSubtype }),
      stage: b.stage,
      scope: input.scope,
      locus: { objectType: b.locusObjectType, objectId: l.objectId, label: l.label },
      severity,
      evidence: {
        solverKey: CHAIN_IMPEDIMENT_SOLVER_KEY,
        ruleKey: b.ruleKey,
        ...(th.ruleParamKey === undefined ? {} : { ruleParamKey: th.ruleParamKey }),
        ...(th.fieldPath === undefined ? {} : { derivationEdge: th.fieldPath }),
        metricValue: round(metric, 6),
        threshold: round(th.value, 6),
        unit: b.unit,
      },
      dataMode,
    });
    const util = num(props.utilization, Number.NaN);
    candidates.push({
      impediment,
      bindingId: b.bindingId,
      ...(Number.isFinite(util) ? { utilization: util } : {}),
      origin: { binding: b, obj: l.obj },
    });
  }

  if (!sawMetric) {
    return unresolved(
      `指标 ${b.metricPath} 在 ${b.locusObjectType} 上无对象承载（扫了 ${scoped.length} 个对象，无一含 ${metricLeaf}）—— ` +
        `属"接了线没数据"，不是"没接线"：补数据即可判`,
    );
  }
  if (!thresholdRow) return unresolved(lastThresholdIssue || `规则 ${b.ruleKey} 的阈值读不回来`);
  return {
    candidates,
    ...(caveat === undefined ? {} : { caveat }),
    threshold: thresholdRow,
  };
}

/** 本判定器的求解器 key（`evidence.solverKey` 单一出处 —— 验收 A1 拿它比对请求日志）。 */
export const CHAIN_IMPEDIMENT_SOLVER_KEY = "chain_impediments";

/** 裁决线（利用率红线）从规则读回，供 §3 互斥裁决用。读不回来 → `null`，不兜底。 */
export function utilizationRedlineOf(
  c: SolverContext,
  bindings: readonly ImpedimentRuleBinding[] = IMPEDIMENT_RULE_BINDINGS,
): number | null {
  const b = bindings.find((x) => x.kind === "BOTTLENECK" && x.metricPath.endsWith(".utilization"));
  if (!b) return null;
  const rule = c.rules?.[b.ruleKey];
  if (!rule) return null;
  const th = readRuleThreshold(rule, b.metricPath, {});
  return th.status === "OK" ? th.value : null;
}

/**
 * **全链阻滞点扫描**（纯函数 · R6 确定性 · 无时钟/随机）。
 *
 * 产出 `ChainImpediment[]`（三类互斥、全序排好）+ 判不出来的 `unresolved[]` + 阈值出处 `thresholds[]`。
 */
export function detectChainImpediments(input: ChainScanInput): ChainScanResult {
  const bindings = input.bindings ?? IMPEDIMENT_RULE_BINDINGS;
  const { c } = input;
  // scanId 由**输入**派生（租户 + 范围 + 规则集版本 + 判据集），同输入必得同 id（R6 字节一致）。
  const scanId = `scan_${hashString(
    canonicalJson({
      t: c.tenantId,
      s: input.scope,
      r: c.ruleSetVersion ?? "",
      b: bindings.map((b) => b.bindingId),
    }),
  ).toString(16)}`;

  const candidates: ImpedimentCandidate[] = [];
  const unresolved: ChainScanUnresolved[] = [];
  const caveats: { bindingId: string; ruleKey: string; note: string }[] = [];
  const thresholds: ChainScanThresholdRow[] = [];
  for (const b of bindings) {
    const r = judgeOne(input, b, scanId);
    candidates.push(...r.candidates);
    if (r.unresolved) unresolved.push(r.unresolved);
    if (r.caveat) caveats.push(r.caveat);
    if (r.threshold) thresholds.push(r.threshold);
  }
  // 登记在册但今天无规则承载的判据（诚实缺席 · R16 生长信号）。
  for (const u of UNBOUND_IMPEDIMENT_JUDGEMENTS) {
    unresolved.push({
      bindingId: `UNBOUND.${u.kind}${u.breakSubtype ? `.${u.breakSubtype}` : ""}`,
      kind: u.kind,
      ...(u.breakSubtype === undefined ? {} : { breakSubtype: u.breakSubtype }),
      status: "UNKNOWN",
      reason: u.reason,
    });
  }

  const arbitrated = arbitrateByLocus(candidates, utilizationRedlineOf(c, bindings));

  // ── WO-SANDBOX-S3 · 每个存活下来的阻滞点长出方案候选（G-IMPEDIMENT-OPTION-NOJOIN 的枚举那一半）──
  // 判定与枚举**同一次请求内完成**：候选是阻滞点的一部分（`ChainImpediment.candidates`），
  // 不是另一个 solver key —— 否则用户点开卡片要等第二次 round-trip（`PRD-sandbox-multiplan.md` §6.7）。
  const originById = new Map<string, { binding: ImpedimentRuleBinding; obj: ObjectInstance }>();
  for (const cand of candidates) if (cand.origin) originById.set(cand.impediment.impedimentId, cand.origin);
  const options = enumerateImpedimentOptions(arbitrated, {
    c,
    materialBalances: input.materialBalances ?? [],
    links: input.links ?? [],
    originOf: (im) => originById.get(im.impedimentId),
    ...(c.rules === undefined ? {} : { rules: c.rules }),
    ...(input.probeBudget === undefined ? {} : { probeBudget: input.probeBudget }),
  });
  const impediments = arbitrated.map((im) => {
    const o = options.byImpediment.get(im.impedimentId);
    if (!o) return im;
    // 经 schema 再 parse 一次：候选与宿主的一致性约束（impedimentId 对齐 / 空候选必带原因**与定性**）由契约把关。
    return ChainImpedimentSchema.parse({
      ...im,
      candidates: o.candidates,
      ...(o.noCandidateReason === undefined ? {} : { noCandidateReason: o.noCandidateReason }),
      ...(o.noCandidateKind === undefined ? {} : { noCandidateKind: o.noCandidateKind }),
    });
  });

  const count = (k: ChainImpedimentKind) => impediments.filter((i) => i.kind === k).length;
  return {
    scanId,
    scope: input.scope,
    ...(c.ruleSetVersion === undefined ? {} : { ruleSetVersion: c.ruleSetVersion }),
    impediments,
    counts: {
      total: impediments.length,
      BOTTLENECK: count("BOTTLENECK"),
      CONGESTION: count("CONGESTION"),
      BREAK: count("BREAK"),
    },
    unresolved,
    caveats,
    thresholds,
    candidateStats: options.stats,
    candidatesTruncated: options.truncated,
    candidateProbes: options.probesUsed,
    scopeUnscoped: isChainScopeUnscoped(input.scope),
  };
}
