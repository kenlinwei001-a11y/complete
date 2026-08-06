import {
  BASE_REGISTRY,
  CADENCE_STEP_KIND,
  CAPACITY_FACTOR_BINDINGS,
  CHAIN_STEP_KINDS,
  HARD_CAPACITY_UNIT_SPECS,
  RULE_PARAM_BINDINGS,
  computeLossAttribution,
  expectedCadenceWaitDays,
  isValueAddKind,
  lossConservationResidual,
  nodeFlowEfficiency,
  nodeLeadTimeDays,
  nodeValueAddDays,
  type CadenceKind,
  type ChainNode,
  type ChainStep,
  type ChainStepKind,
} from "@platform/contracts";

/**
 * WO-SANDBOX-F4 · 节点检视面板的**纯派生层**（零 JSX / 零颜色 / 零副作用 / 零时钟）。
 *
 * ── 三条铁则（审核方 2026-08-05 中途补充约束，直接写进本文件的类型里）──────────────
 *  ① **不写死任何节点清单 / 节点 ID / 「某节点有哪些变量」的映射表。**
 *     `nodeId` 是**不透明键**：本文件从不解析它（**零 `split(".")`**、零前缀匹配），
 *     `stage` 一律读契约字段 `ChainNode.stage`。节点与变量集**全部由调用方传入**
 *     （`InspectorInput`），本文件只提供「怎么算」，不提供「有哪些节点」。
 *     背景：S0 把 `nodeId` 冻成自由串且**无 ID 单源注册表**，D1 与 E1 两个 dev 因此各自
 *     发明了一套全链节点 ID、互相看不见。前端再写第三套，就是把这个洞焊死。
 *  ② **五段分桶不自己算**：`kind` 五值是 S0 冻结的（`CHAIN_STEP_KINDS`），直接按 `kind` 分组；
 *     「哪种算增值」一律走契约导出的 `isValueAddKind`，**前端不复写判据**。
 *  ③ **流动效率 / 前置期 / 增值量不写第二份公式**：全走 `nodeFlowEfficiency` /
 *     `nodeLeadTimeDays` / `nodeValueAddDays`（`packages/contracts/src/chain-sim.ts`）。
 *
 * ── 诚实位（本仓刚坐实过「一条死映射让 24 张单里 12 张被静默标错业务线、界面完全看不出来」）──
 *  · 每个变量必带 `carrier: 有 | 薄 | 缺` + 取证 `evidence`（file:line 级），**缺的不给假默认值**：
 *    `value === null`（EMPTY），控件仍可拨（供 what-if），但拨出来的数一律标 `WHATIF`，**永不冒充 LIVE**。
 *  · 段级同理：算不出来的段**根本不进 `ChainNode.steps`**（S0 strict 要求 `days: number`），
 *    而是登记为 `StepAbsence`。瀑布里该桶显示 `EMPTY + 原因`，**不补 0**。
 *  · 有缺席时前置期是**被低估的**——`InspectorReadout.absentCount > 0` 即为该事实的机器可读标记，
 *    面板必须显式呈现（"分母不含 N 个诚实缺席段"），否则流动效率会静默偏高。
 *
 * ── 七类变量的推演机理各不相同 ⇒ 控件必须分开（本单的关键设计约束）────────────────
 *    T 时长 / K 节拍 / B 批量 / C 能力 → 连续滑杆（K 另带「相位不进公式」的特殊语义）
 *    P 概率 → 滑杆但值域 [0,1] 且显示为百分比
 *    R 规则 → **必须引规则码**：改的是 `rule.params` 的某个命名阈值，不是一个自由数字
 *    S 结构 → **离散分支换拓扑**：选中即改段集（增/删段），**做成滑杆即退单**
 */

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · 七类变量与其控件形态
// ══════════════════════════════════════════════════════════════════════════════

/** 七类变量码。顺序即面板分组顺序。 */
export const VAR_CLASSES = ["T", "K", "B", "C", "P", "R", "S"] as const;
export type VarClass = (typeof VAR_CLASSES)[number];

/**
 * 控件形态。**五种，不是七种**——七类里 T/B/C 共用连续滑杆，其余四类各有各的形态。
 * `discrete` 与 `range` 是**互斥**的两种 DOM 形态：`discrete` 渲染 `role="radio"` 选项组，
 * **绝不渲染 `input[type=range]`**（S 类做成滑杆即退单，测试直接咬这一点）。
 */
export const VAR_CONTROLS = ["range", "cadence", "probability", "rule-param", "discrete"] as const;
export type VarControl = (typeof VAR_CONTROLS)[number];

/** 类 → 控件的**唯一映射**（面板与测试同读一份，杜绝"面板画一种、测试断言另一种"）。 */
export const VAR_CONTROL_BY_CLASS: Readonly<Record<VarClass, VarControl>> = {
  T: "range",
  K: "cadence",
  B: "range",
  C: "range",
  P: "probability",
  R: "rule-param",
  S: "discrete",
};

/** 类的人读名与机理一句话（显示在分组头，让用户看得见"为什么这一类的控件长得不一样"）。 */
export const VAR_CLASS_META: Readonly<Record<VarClass, { label: string; mechanism: string }>> = {
  T: { label: "T · 时长", mechanism: "直接设定某一段的天数——改多少，该段就是多少" },
  K: { label: "K · 节拍", mechanism: "到点才办 ⇒ 等待期望 = everyDays ÷ 2（均匀到达假设）；相位 offsetDays 不进公式" },
  B: { label: "B · 批量", mechanism: "整批攒齐才走 ⇒ 该段天数与批量成正比" },
  C: { label: "C · 能力", mechanism: "同样在制量下 ⇒ 该段天数与有效能力成反比（能力翻倍 → 该段减半）" },
  P: { label: "P · 概率", mechanism: "值域 [0,1]，按百分比读；概率本身不是天数，落到天数要有换算承载物" },
  R: { label: "R · 规则", mechanism: "改的是某条规则的命名阈值（rule.params），不是一个自由数字——面板必须显示引了哪条规则的哪个 param" },
  S: { label: "S · 结构", mechanism: "离散分支换拓扑：选中即增/删段，段集本身变了——所以它不能是滑杆" },
};

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 承载状态（有 / 薄 / 缺）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 契约承载状态。**这三个字不是文案，是判据**：
 *  · `有` —— contracts 层有字段/注册表承载 **且** 有 src 侧真消费方（不是只有 test 引用）。
 *  · `薄` —— 承载物存在但线接得不全（字段在但值域无单源册 / 有种子无消费方 / 登记了但 writable:false）。
 *  · `缺` —— 今天没有承载物。**缺的一律 `value: null`（EMPTY），不给假默认值。**
 * 三分法与 CLAUDE.md 铁律 0.5 的「没接线 / 接了线没数据 / 接了线接错地方」同源：修法完全不同，混了必修错地方。
 */
export const CARRIERS = ["有", "薄", "缺"] as const;
export type Carrier = (typeof CARRIERS)[number];

/**
 * 读数来源。四档，**刻意不合并**：
 *  · `LIVE`        引擎真值（只有 `dataMode === "LIVE"` 的未拨段配得上）
 *  · `PLACEHOLDER` 占位基线（W3 用 mock 数据施工的阶段产物·seed 派生可复现，但**不是实测**）
 *  · `WHATIF`      用户拨出来的试算值（含"无承载但为试算物化"的段）
 *  · `EMPTY`       算不出来（诚实缺席·**不补 0**）
 * 合并 PLACEHOLDER 与 WHATIF 会让"系统给的占位"和"我自己拨的"分不清 —— 那正是静默错答的温床。
 */
export const PROVENANCES = ["LIVE", "PLACEHOLDER", "WHATIF", "EMPTY"] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const PROVENANCE_LABEL: Readonly<Record<Provenance, string>> = {
  LIVE: "引擎真值",
  PLACEHOLDER: "占位·未接真值",
  WHATIF: "what-if 试算",
  EMPTY: "无承载·诚实缺席",
};

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · 变量 → 段的作用算子（数据，不是写死的 if）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 一个变量怎么作用到段上。**全部按 `stepId` 定位**（不透明键，不解析、不猜）。
 * 目标段不存在（被 S 类拓扑删掉、或本就诚实缺席且未被 what-if 填补）⇒ 该算子**自然不生效**，
 * 面板据此把该变量标成「本拓扑下不适用」——这是 S 类"换拓扑"真实性的副产物，不是特判。
 */
export type VarEffect =
  /** T 类：直接设定该段天数。 */
  | { readonly op: "setDays"; readonly stepId: string }
  /** K 类：设定该等节拍段的周期；天数由契约唯一实现 `expectedCadenceWaitDays` 产出（= /2）。 */
  | { readonly op: "setCadenceEveryDays"; readonly stepId: string }
  /** K 类相位：契约字段在（`Cadence.offsetDays`），但 S0 §2 明写**不进期望公式** ⇒ 读数不动。 */
  | { readonly op: "setCadencePhase"; readonly stepId: string }
  /** C/R 类：该段天数与本值**成反比**（`days *= baseline / value`）。 */
  | { readonly op: "scaleDaysInverse"; readonly stepId: string }
  /** B 类：该段天数与本值**成正比**（`days *= value / baseline`）。 */
  | { readonly op: "scaleDaysDirect"; readonly stepId: string }
  /** R 类：该段天数**加上**换算后的增量（`days += (value − baseline) / divisor`，如小时→天 divisor=24）。 */
  | { readonly op: "addDaysScaled"; readonly stepId: string; readonly divisor: number }
  /** S 类：改段集（补丁挂在选项上）。 */
  | { readonly op: "topology" }
  /** 不驱动读数——**必须同时给 `inertReason`**，否则就是"拨了没反应"的静默错答。 */
  | { readonly op: "inert" };

/** S 类的一个离散分支。选中即把补丁作用到段集上（删段 / 增段），**这就是"换拓扑"**。 */
export interface StructureOption {
  readonly optionId: string;
  readonly label: string;
  /** 选中后从段集中移除的段 id。 */
  readonly removeStepIds?: readonly string[];
  /** 选中后追加的段（自带 days 基线；可再被 T 类变量覆盖）。 */
  readonly addSteps?: readonly ChainStep[];
  /** 这条分支改了什么拓扑（显示在选项下方，别让用户猜）。 */
  readonly note: string;
}

/** 数值型变量的取值域（UI 决策，不是业务常数）。 */
export interface VarDomain {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** R 类的规则引用——**R 类必须有它**，否则就退化成一个自由数字。 */
export interface RuleParamRef {
  /** 规则码（如 `C09`）。 */
  readonly ruleKey: string;
  /** `rule.params` 内的命名阈值键。 */
  readonly param: string;
  /** 投影到 `solver_params` 的点分路径（`RULE_PARAM_BINDINGS.path`）。 */
  readonly path: string;
  /** 该阈值在推演里怎么用（`RULE_PARAM_BINDINGS.note`）。 */
  readonly note: string;
}

/** 一个可拨变量。 */
export interface InspectorVariable {
  readonly varId: string;
  readonly cls: VarClass;
  readonly label: string;
  /** 单位（天/小时/%/个/…）。`probability` 控件忽略它，按 % 显示。 */
  readonly unit: string;
  /** 契约承载状态。 */
  readonly carrier: Carrier;
  /** 承载取证：file:line 级，能被复验方直接翻到。`carrier !== "有"` 时必须写清缺在哪。 */
  readonly evidence: string;
  /** 基线值。`carrier === "缺"` ⇒ **必须为 null**（EMPTY，不给假默认值）。 */
  readonly baseline: number | null;
  /** 数值域（`discrete` 控件为 undefined）。 */
  readonly domain?: VarDomain;
  /** 作用算子。 */
  readonly effect: VarEffect;
  /** `effect.op === "inert"` 时必填：为什么拨了不动读数。 */
  readonly inertReason?: string;
  /** S 类选项集（`discrete` 控件必填，且**至少 2 项**）。 */
  readonly options?: readonly StructureOption[];
  /** S 类基线选项（`null` = 无承载，初始不选任何一项）。 */
  readonly baselineOptionId?: string | null;
  /** R 类规则引用（`rule-param` 控件必填）。 */
  readonly ruleRef?: RuleParamRef;
}

/**
 * 一个**算不出来**的段（诚实缺席）。它**不进 `ChainNode.steps`**（S0 strict 要求 `days: number`，
 * 塞进去就得编一个数）。瀑布里对应桶显示 `EMPTY + reason`。
 * 若某个 what-if 变量（`setDays` / `setCadenceEveryDays`）指向 `stepId` 且被拨出了值，
 * 则**按 what-if 物化**该段并标 `WHATIF`——试算可以，冒充实测不行。
 */
export interface StepAbsence {
  readonly stepId: string;
  readonly kind: ChainStepKind;
  readonly label: string;
  /** 为什么算不出来（要具体到"缺哪个承载物"，不是"暂无数据"）。 */
  readonly reason: string;
  /**
   * `kind === "cadence"` 时**必填**：what-if 物化该段时要给的节拍类型。
   * S0 的 `ChainStepSchema` 硬绑「等节拍段必须带 `cadence`」，而 `CadenceSchema.kind` 是必填枚举 ——
   * 于是"物化一个 what-if 等节拍段"就绕不开选一个类型。**这个选择必须由调用方给**，
   * 不能藏在算法里写死一个：算法里的默认值正是"看着合理的默认值"式静默兜底。
   */
  readonly whatIfCadenceKind?: CadenceKind;
}

/** 面板的全部输入。**节点与变量集都由调用方给**——面板自己不知道有哪些节点。 */
export interface InspectorInput {
  /** 只含**有值**的段（S0 strict）。`nodeId` 是不透明键，本模块从不解析。 */
  readonly node: ChainNode;
  /** 诚实缺席的段。 */
  readonly absences: readonly StepAbsence[];
  /** 可拨变量集。 */
  readonly variables: readonly InspectorVariable[];
  /** 读数来源标注：整份输入是引擎真值还是占位。占位时面板挂常驻横幅。 */
  readonly dataMode: "LIVE" | "PLACEHOLDER";
  /** 占位时说明占位在哪（`dataMode === "PLACEHOLDER"` 必填）。 */
  readonly placeholderNote?: string;
}

/** 变量当前值。数值类 → `number | null`；S 类 → `optionId | null`。 */
export type VarValues = Readonly<Record<string, number | string | null>>;

// ══════════════════════════════════════════════════════════════════════════════
// § 4 · 五段瀑布 + 流动效率（全部经 S0 契约函数，前端不写第二份公式）
// ══════════════════════════════════════════════════════════════════════════════

/** 五段的人读名。顺序不在这里定——顺序一律取 `CHAIN_STEP_KINDS`（S0 冻结）。 */
export const STEP_KIND_LABEL: Readonly<Record<ChainStepKind, string>> = {
  queue: "排队",
  cadence: "等节拍",
  work: "作业",
  rework: "返工",
  handoff: "交接",
};

export interface WaterfallBucket {
  readonly kind: ChainStepKind;
  readonly label: string;
  /** **一律取 `isValueAddKind(kind)`**——前端不复写"哪种算增值"。 */
  readonly valueAdd: boolean;
  /** 天数；`null` = 该桶诚实缺席（不补 0）。 */
  readonly days: number | null;
  /** 占前置期比（0–100）；缺席或前置期为 0 → null。 */
  readonly pctOfLead: number | null;
  /** 占**全链非增值总量**比（S0 `computeLossAttribution` 口径·分母排除增值段）；增值桶恒 null。 */
  readonly pctOfChainLoss: number | null;
  readonly provenance: Provenance;
  readonly absenceReason?: string;
  readonly stepIds: readonly string[];
}

export interface InspectorReadout {
  /** 应用变量后的节点（只含**有值**的段）。 */
  readonly node: ChainNode;
  /** 五桶，顺序 = `CHAIN_STEP_KINDS`。 */
  readonly buckets: readonly WaterfallBucket[];
  /** 前置期（天）= `nodeLeadTimeDays(node)`。 */
  readonly leadTimeDays: number;
  /** 增值（天）= `nodeValueAddDays(node)`。 */
  readonly valueAddDays: number;
  /** 流动效率 = `nodeFlowEfficiency(node)`（前置期 0 → null，诚实缺席不冒充 0）。 */
  readonly flowEfficiency: number | null;
  /** 仍诚实缺席的段数。**> 0 ⇒ 前置期被低估、流动效率被高估**，面板必须显式说。 */
  readonly absentCount: number;
  /** 被 what-if 覆盖的段数（读数已不是纯引擎值）。 */
  readonly whatIfCount: number;
  /** 损失守恒残差 = Σ pctOfChainLoss − 100（空表 → null）。 */
  readonly lossResidual: number | null;
  /** 本轮**未生效**的变量（目标段不存在）。面板据此标「本拓扑下不适用」。 */
  readonly inapplicableVarIds: readonly string[];
}

const numOrNull = (v: number | string | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const strOrNull = (v: number | string | null | undefined): string | null => (typeof v === "string" ? v : null);

/** 变量的当前生效值：`values` 里给了就用给的，否则用基线。 */
export function effectiveNumber(v: InspectorVariable, values: VarValues): number | null {
  const raw = values[v.varId];
  return raw === undefined ? v.baseline : numOrNull(raw);
}

/** S 类的当前选项 id：`values` 里给了就用给的，否则用基线选项。 */
export function effectiveOption(v: InspectorVariable, values: VarValues): string | null {
  const raw = values[v.varId];
  if (raw === undefined) return v.baselineOptionId ?? null;
  return strOrNull(raw);
}

/** 该变量是否被用户拨离基线（用来判 `WHATIF`）。 */
function isOverridden(v: InspectorVariable, values: VarValues): boolean {
  const raw = values[v.varId];
  if (raw === undefined) return false;
  if (v.options) return strOrNull(raw) !== (v.baselineOptionId ?? null);
  return numOrNull(raw) !== v.baseline;
}

/** 取出算子的目标段 id（`topology` / `inert` 无目标）。 */
function effectTarget(e: VarEffect): string | null {
  return e.op === "topology" || e.op === "inert" ? null : e.stepId;
}

/**
 * 应用变量 → 得到新的段集 + 每段的来源标注。
 *
 * **确定性（R6）**：拓扑补丁按 `variables` 数组序应用，数值算子按 `setDays/setCadence → 乘性 → 加性` 三段式，
 * 乘性内部可交换（连乘），故与遍历顺序无关。全程无时钟、无随机。
 */
function applySteps(
  input: InspectorInput,
  values: VarValues,
): { steps: ChainStep[]; prov: Map<string, Provenance>; inapplicable: string[] } {
  // ── 阶段 1：S 类拓扑补丁（先换拓扑，再算数值）────────────────────────────────
  let steps: ChainStep[] = [...input.node.steps];
  const whatIfSteps = new Set<string>();

  for (const v of input.variables) {
    if (v.effect.op !== "topology" || !v.options) continue;
    const picked = effectiveOption(v, values);
    if (picked === null) continue;
    const opt = v.options.find((o) => o.optionId === picked);
    if (!opt) continue;
    if (opt.removeStepIds && opt.removeStepIds.length > 0) {
      const drop = new Set(opt.removeStepIds);
      steps = steps.filter((s) => !drop.has(s.stepId));
    }
    if (opt.addSteps) {
      for (const add of opt.addSteps) {
        if (steps.some((s) => s.stepId === add.stepId)) continue;
        steps.push(add);
        // S 类若本身无承载（缺），它追加的段也不是实测 → 标 what-if。
        if (v.carrier === "缺" || isOverridden(v, values)) whatIfSteps.add(add.stepId);
      }
    }
  }

  // ── 阶段 2：诚实缺席段的 what-if 物化（只在用户真拨了值时才造段，否则保持 EMPTY）──
  for (const ab of input.absences) {
    if (steps.some((s) => s.stepId === ab.stepId)) continue;
    const driver = input.variables.find((v) => effectTarget(v.effect) === ab.stepId && (v.effect.op === "setDays" || v.effect.op === "setCadenceEveryDays"));
    if (!driver) continue;
    const val = effectiveNumber(driver, values);
    if (val === null) continue; // 没拨值 → 保持 EMPTY，绝不补 0
    const days = driver.effect.op === "setCadenceEveryDays" ? expectedCadenceWaitDays({ everyDays: val }) : val;
    // 等节拍段必须带 `cadence`（S0 硬绑），而节拍类型由 `StepAbsence` 提供；调用方没给就**不物化**这一段
    // ——宁可继续 EMPTY，也不在算法里替它挑一个类型（那是静默兜底）。
    if (ab.kind === CADENCE_STEP_KIND && ab.whatIfCadenceKind === undefined) continue;
    const base: ChainStep = {
      stepId: ab.stepId,
      nodeId: input.node.nodeId,
      label: ab.label,
      kind: ab.kind,
      days,
      valueAdd: isValueAddKind(ab.kind),
      ...(ab.whatIfCadenceKind === undefined ? {} : { cadence: { everyDays: val, kind: ab.whatIfCadenceKind } }),
    };
    steps.push(base);
    whatIfSteps.add(ab.stepId);
  }

  const byId = new Map(steps.map((s) => [s.stepId, s] as const));
  /** 诚实缺席的段 id：变量指向它 ≠ 「本拓扑下不适用」，而是「没值可算」——两件事，标错就误导。 */
  const absentIds = new Set(input.absences.map((a) => a.stepId));
  const inapplicable: string[] = [];

  // ── 阶段 3：数值算子 ────────────────────────────────────────────────────────
  const setDays = new Map<string, number>();
  const cadenceEvery = new Map<string, number>();
  const mult = new Map<string, number>();
  const add = new Map<string, number>();

  for (const v of input.variables) {
    const target = effectTarget(v.effect);
    if (target === null) continue;
    if (!byId.has(target)) {
      if (!absentIds.has(target)) inapplicable.push(v.varId); // 段被 S 类拓扑删掉/未启用 ⇒ 本拓扑下不适用
      continue;
    }
    const val = effectiveNumber(v, values);
    if (val === null) continue; // 无值 = 诚实缺席，不参与运算（绝不当 0 用）
    if (isOverridden(v, values)) whatIfSteps.add(target);
    switch (v.effect.op) {
      case "setDays":
        setDays.set(target, val);
        break;
      case "setCadenceEveryDays":
        cadenceEvery.set(target, val);
        break;
      case "setCadencePhase":
        // 相位只移动每一次具体等待，**不改期望**（S0 §2 推导）。故这里刻意什么都不做。
        break;
      case "scaleDaysInverse":
        if (v.baseline !== null && val > 0) mult.set(target, (mult.get(target) ?? 1) * (v.baseline / val));
        break;
      case "scaleDaysDirect":
        if (v.baseline !== null && v.baseline > 0) mult.set(target, (mult.get(target) ?? 1) * (val / v.baseline));
        break;
      case "addDaysScaled":
        if (v.baseline !== null && v.effect.divisor !== 0) add.set(target, (add.get(target) ?? 0) + (val - v.baseline) / v.effect.divisor);
        break;
      default:
        break;
    }
  }

  const out: ChainStep[] = steps.map((s) => {
    let days = s.days;
    const forced = setDays.get(s.stepId);
    if (forced !== undefined) days = forced;
    const every = cadenceEvery.get(s.stepId);
    if (every !== undefined) days = expectedCadenceWaitDays({ everyDays: every });
    days *= mult.get(s.stepId) ?? 1;
    days += add.get(s.stepId) ?? 0;
    if (!Number.isFinite(days) || days < 0) days = 0; // S0 schema：days 必须非负有限
    const next: ChainStep = { ...s, days };
    if (every !== undefined && s.cadence) next.cadence = { ...s.cadence, everyDays: every };
    return next;
  });

  const baseProv: Provenance = input.dataMode === "LIVE" ? "LIVE" : "PLACEHOLDER";
  const prov = new Map<string, Provenance>();
  for (const s of out) prov.set(s.stepId, whatIfSteps.has(s.stepId) ? "WHATIF" : baseProv);
  return { steps: out, prov, inapplicable };
}

/**
 * 面板读数的**唯一实现**。前置期 / 增值 / 流动效率 / 损失占比**全部经 S0 契约函数**——
 * 本文件不写第二份除法（审核方补充约束 ③）。
 */
export function computeInspectorReadout(input: InspectorInput, values: VarValues = {}): InspectorReadout {
  const { steps, prov, inapplicable } = applySteps(input, values);
  const node: ChainNode = { ...input.node, steps };

  const leadTimeDays = nodeLeadTimeDays(node);
  const valueAddDays = nodeValueAddDays(node);
  const flowEfficiency = nodeFlowEfficiency(node);

  // 损失归因走契约唯一实现（分母 = 全链非增值总量，排除增值段）。
  const lossRows = computeLossAttribution(steps);
  const lossByStep = new Map(lossRows.map((r) => [r.stepId, r.pctOfChainLoss] as const));
  const lossResidual = lossConservationResidual(lossRows);

  const baseProv: Provenance = input.dataMode === "LIVE" ? "LIVE" : "PLACEHOLDER";

  // 桶序 = `CHAIN_STEP_KINDS`（S0 冻结的五值），**前端不自己排、不自己分**。
  const buckets: WaterfallBucket[] = CHAIN_STEP_KINDS.map((kind) => {
    const mine = steps.filter((s) => s.kind === kind);
    const valueAdd = isValueAddKind(kind); // ← 契约唯一判据，不复写
    const label = STEP_KIND_LABEL[kind];
    if (mine.length === 0) {
      const ab = input.absences.find((a) => a.kind === kind);
      return {
        kind,
        label,
        valueAdd,
        days: null,
        pctOfLead: null,
        pctOfChainLoss: null,
        provenance: "EMPTY" as const,
        absenceReason: ab ? ab.reason : "本节点的段集里没有这一段（不是算不出来，是拓扑上就没有）",
        stepIds: [],
      };
    }
    const days = mine.reduce((sum, s) => sum + s.days, 0);
    const anyWhatIf = mine.some((s) => prov.get(s.stepId) === "WHATIF");
    const lossPct = valueAdd ? null : mine.reduce((sum, s) => sum + (lossByStep.get(s.stepId) ?? 0), 0);
    return {
      kind,
      label,
      valueAdd,
      days,
      pctOfLead: leadTimeDays > 0 ? (days / leadTimeDays) * 100 : null,
      pctOfChainLoss: lossPct,
      provenance: anyWhatIf ? ("WHATIF" as const) : baseProv,
      stepIds: mine.map((s) => s.stepId),
    };
  });

  // 仍然算不出来的段数（被 what-if 物化的不算）。>0 ⇒ 前置期被低估、流动效率被高估。
  const absentCount = input.absences.filter((a) => !steps.some((s) => s.stepId === a.stepId)).length;
  const whatIfCount = [...prov.values()].filter((p) => p === "WHATIF").length;

  return { node, buckets, leadTimeDays, valueAddDays, flowEfficiency, absentCount, whatIfCount, lossResidual, inapplicableVarIds: inapplicable };
}

/**
 * 该变量**是否驱动读数**的唯一判据。面板与测试同读这一份，杜绝"面板画一种、门断言另一种"。
 *
 * 不驱动有三种来源，**每一种都必须配 `inertReason`**：
 *  ① `op === "inert"`          —— 压根没有链把它算进耗时（零消费方 / 换算缺承载）；
 *  ② `op === "setCadencePhase"` —— 公式本身与它无关（相位不进期望，S0 §2）；
 *  ③ 目标段在当前拓扑下不存在  —— 由 `InspectorReadout.inapplicableVarIds` 给出，不在本函数里判。
 * 「拨了没反应」若不当面解释，就是静默错答；本仓刚坐实过一条死映射让 24 张单里 12 张被静默标错业务线。
 */
export function drivesReadout(v: InspectorVariable): boolean {
  if (v.effect.op === "inert" || v.effect.op === "setCadencePhase") return false;
  return v.inertReason === undefined;
}

/** 变量分组（顺序 = `VAR_CLASSES`）。面板据此渲染七个分组，缺类也留组（显示"本节点无此类变量"）。 */
export function groupByClass(variables: readonly InspectorVariable[]): { cls: VarClass; vars: InspectorVariable[] }[] {
  return VAR_CLASSES.map((cls) => ({ cls, vars: variables.filter((v) => v.cls === cls) }));
}

// ══════════════════════════════════════════════════════════════════════════════
// § 5 · 占位输入构造器（W3 按 S0 契约先做、用 mock 数据；W4 收口换真数据）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 确定性伪随机（R6：同 seed 字节一致，无时钟/无 `Math.random`）。
 * 与 `physicalTopology.ts` 同族做法——占位值必须可复现，否则连"两次跑一样"都证不了。
 */
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
const jitter = (seed: number, key: string, lo: number, hi: number): number => {
  const r = (hash32(`${seed}:${key}`) % 10000) / 10000;
  return Math.round((lo + (hi - lo) * r) * 100) / 100;
};

/** 段 id 一律从**调用方给的 `nodeId`** 派生（`${nodeId}::${kind}`），本文件不持有任何节点 id 清单。 */
export const stepIdOf = (nodeId: string, suffix: string): string => `${nodeId}::${suffix}`;

const CADENCE_ABSENCE_REASON =
  "缺承载：`Cadence` 对象全仓 0 条（运行态实测 `GET /a/v1/objects?type=Cadence` → total 0，对象类型尚不存在）。" +
  "等待期望公式已由 S0 冻结（`expectedCadenceWaitDays`），但**没有值可以喂给它**——滑杆留着供 what-if，当前值不给假默认。";

const REWORK_ABSENCE_REASON =
  "缺承载：仓里有不良数量与判定（DefectRecord / QualityLot / InspectionResult），但**没有返工工时或天数字段**；" +
  "从不良数换算成天数需要「单件返工工时率」，那个数今天不存在 ⇒ 返工天数算不出来，标 EMPTY 不补 0。";

/**
 * 造一份**占位**输入。三条纪律：
 *  ① `nodeId` / `label` / `stage` **全部由调用方给**——本函数不认识任何具体节点。
 *  ② 段 id 由 `nodeId` 派生，不写死。
 *  ③ 变量的落点尽量**从 contracts 注册表派生**（`CAPACITY_FACTOR_BINDINGS` / `HARD_CAPACITY_UNIT_SPECS` /
 *     `RULE_PARAM_BINDINGS` / `BASE_REGISTRY`）——改注册表，面板跟着变（这就是 SEAM 的咬点）。
 */
export function buildPlaceholderInspectorInput(args: {
  nodeId: string;
  label: string;
  stage: ChainNode["stage"];
  seed?: number;
}): InspectorInput {
  const { nodeId, label, stage } = args;
  const seed = args.seed ?? 42;
  const sid = (suffix: string) => stepIdOf(nodeId, suffix);

  const queueDays = jitter(seed, `${nodeId}/queue`, 2, 9);
  const workDays = jitter(seed, `${nodeId}/work`, 0.4, 2.2);
  const handoffDays = jitter(seed, `${nodeId}/handoff`, 0.5, 3);

  const mkStep = (suffix: string, kind: ChainStepKind, days: number, stepLabel: string): ChainStep => ({
    stepId: sid(suffix),
    nodeId,
    label: stepLabel,
    kind,
    days,
    valueAdd: isValueAddKind(kind),
  });

  const steps: ChainStep[] = [
    mkStep("queue", "queue", queueDays, "排队等资源"),
    mkStep("work", "work", workDays, "实际作业"),
    mkStep("handoff", "handoff", handoffDays, "交接流转"),
  ];

  // 诚实缺席两段：等节拍（Cadence 对象 0 条）与返工（无返工工时率）。**不进 steps。**
  const absences: StepAbsence[] = [
    // `whatIfCadenceKind` 由本构造器（= 调用方）显式给出：本节点的等节拍属于**会议型**（到点开会才过）。
    // 真接引擎后这个值应来自 `Cadence.kind` 实例；今天 `Cadence` 对象 0 条，所以它是 what-if 的一部分。
    { stepId: sid("cadence"), kind: "cadence", label: "等节拍", reason: CADENCE_ABSENCE_REASON, whatIfCadenceKind: "meeting" },
    { stepId: sid("rework"), kind: "rework", label: "返工", reason: REWORK_ABSENCE_REASON },
  ];

  // ── C 类：从硬容量单元规格 + 20 因子绑定**派生**落点（不内联属性名）──────────
  const unitSpec = HARD_CAPACITY_UNIT_SPECS[0];
  const unitsBinding = unitSpec ? CAPACITY_FACTOR_BINDINGS.find((b) => b.prop === unitSpec.unitsProp) : undefined;
  const yieldBinding = CAPACITY_FACTOR_BINDINGS.find((b) => b.prop.startsWith("yield") && b.writable);

  // ── R 类：从规则 params 绑定表**派生**（改绑定表 → 面板跟着变）────────────────
  const derateBinding = RULE_PARAM_BINDINGS.find((b) => b.param === "pendingCertFactor");
  const staleBinding = RULE_PARAM_BINDINGS.find((b) => b.param === "staleHours");
  const ruleRefOf = (b: (typeof RULE_PARAM_BINDINGS)[number]): RuleParamRef => ({
    ruleKey: b.ruleKey,
    param: b.param,
    path: b.path,
    note: b.note,
  });

  // ── S 类：承接基地选项**派生自 BASE_REGISTRY**（不内联基地名）──────────────
  const siteOptions: StructureOption[] = BASE_REGISTRY.slice(0, 3).map((b, i) => ({
    optionId: b.baseId,
    label: b.name,
    ...(i === 0
      ? {}
      : {
          addSteps: [mkStep("transfer", "handoff", jitter(seed, `${nodeId}/transfer/${b.baseId}`, 1, 4), "跨基地流转")],
        }),
    note:
      i === 0
        ? "本地承接：段集不变（基线拓扑）"
        : "跨基地承接：段集**追加一段交接**（跨基地流转），这是拓扑变化，不是把某个数调大",
  }));

  const variables: InspectorVariable[] = [
    // ── T 时长 ────────────────────────────────────────────────────────────────
    {
      varId: "T1",
      cls: "T",
      label: "作业时长",
      unit: "天",
      carrier: "有",
      evidence: "`ChainStep.days`（kind=work）· packages/contracts/src/chain-sim.ts:223（S0 冻结）",
      baseline: workDays,
      domain: { min: 0, max: 10, step: 0.1 },
      effect: { op: "setDays", stepId: sid("work") },
    },
    {
      varId: "T2",
      cls: "T",
      label: "交接固定时长",
      unit: "天",
      carrier: "有",
      evidence: "`ChainStep.days`（kind=handoff）· packages/contracts/src/chain-sim.ts:223（S0 冻结）",
      baseline: handoffDays,
      domain: { min: 0, max: 15, step: 0.1 },
      effect: { op: "setDays", stepId: sid("handoff") },
    },
    {
      varId: "T3",
      cls: "T",
      label: "跨基地流转时长",
      unit: "天",
      carrier: "薄",
      evidence:
        "`InterBaseTransfer.transitDays` · packages/contracts/src/interbase-transfer.ts:32（契约字段在 + 真种子 + `etaDay` 派生管线消费），" +
        "但 `apps/datacore/src/solvers/` **零直接消费方**（实测 grep 计数 0）⇒ 薄，非有",
      baseline: jitter(seed, `${nodeId}/transit`, 1, 4),
      domain: { min: 0, max: 20, step: 0.5 },
      effect: { op: "setDays", stepId: sid("transfer") },
    },

    // ── K 节拍 ────────────────────────────────────────────────────────────────
    {
      varId: "K1",
      cls: "K",
      label: "节拍周期 everyDays",
      unit: "天",
      carrier: "缺",
      evidence:
        "公式**有**（`expectedCadenceWaitDays` · chain-sim.ts:108）但**值缺**：`Cadence` 对象全仓 0 条" +
        "（运行态实测 `GET /a/v1/objects?type=Cadence` → total 0）；D1 写了推导模块但零生产调用方，从没落库。" +
        "⇒ 当前值 EMPTY，滑杆仅供 what-if",
      baseline: null,
      domain: { min: 1, max: 60, step: 1 },
      effect: { op: "setCadenceEveryDays", stepId: sid("cadence") },
    },
    {
      varId: "K2",
      cls: "K",
      label: "节拍相位 offsetDays",
      unit: "天",
      carrier: "缺",
      evidence:
        "`Cadence.offsetDays` · chain-sim.ts:73（契约字段在），但同上无 `Cadence` 实例；" +
        "且全仓**零运行时消费方**（只有契约与其单测引用）",
      baseline: null,
      domain: { min: 0, max: 30, step: 1 },
      effect: { op: "setCadencePhase", stepId: sid("cadence") },
      inertReason:
        "相位**不进等待期望公式**（S0 §2 推导：均匀到达假设下相位只移动每一次具体等待，不改期望）。" +
        "拨它读数**必然不动**——这不是没接线，是公式本身与它无关。",
    },

    // ── B 批量 ────────────────────────────────────────────────────────────────
    {
      varId: "B1",
      cls: "B",
      label: "过站批量 lotQty",
      unit: "件",
      carrier: "缺",
      evidence:
        "contracts 层**零承载**：`lotSize|batchSize|batchQty|lotQty` 全仓 0 命中；" +
        "`GlobalSimRequest.allowSplit`（global-sim.ts:125）只是**布尔开关**，不是批量数",
      baseline: null,
      domain: { min: 1, max: 5000, step: 50 },
      effect: { op: "scaleDaysDirect", stepId: sid("queue") },
    },
    {
      varId: "B2",
      cls: "B",
      label: "采购最小起订量 minOrderQty",
      unit: "件",
      carrier: "缺",
      evidence:
        "契约层无此字段；datacore 种子有真值（apps/datacore/src/synthetic/battery-extended.ts:152-159），" +
        "但 `apps/datacore/src/solvers/` **0 消费方**（实测 grep 计数 0）⇒ 前端拿不到、也没人算它",
      baseline: null,
      domain: { min: 0, max: 5000, step: 100 },
      effect: { op: "inert" },
      inertReason: "跨包只能依赖 `@platform/contracts`（R1 contracts-only-shared），而它只存在于 datacore 种子里 ⇒ 前端无从取值，更不该编一个。",
    },

    // ── C 能力 ────────────────────────────────────────────────────────────────
    ...(unitSpec && unitsBinding
      ? [
          {
            varId: "C1",
            cls: "C" as const,
            label: `硬容量单元数（${unitSpec.unitKind}）`,
            unit: "个",
            carrier: "有" as const,
            evidence:
              `\`Process.${unitSpec.unitsProp}\` · packages/contracts/src/process-capacity.ts:58（\`HARD_CAPACITY_UNIT_SPECS.unitsProp\`）` +
              ` + 20 因子绑定 ${unitsBinding.mark} · capacity-factors.ts:51（writable）+ 真消费方 apps/datacore/src/solvers/capacity.ts:75`,
            // 对齐滑杆步长（10 的整数倍）：否则 `min + n*step` 的取值域里落不到"基线的两倍"，
            // 机理判据（能力翻倍 → 排队减半）就只能测个大概方向，测不了精确值。
            baseline: Math.round(jitter(seed, `${nodeId}/units`, 400, 2000) / 10) * 10,
            domain: { min: 50, max: 4000, step: 10 },
            effect: { op: "scaleDaysInverse" as const, stepId: sid("queue") },
          },
          {
            varId: "C2",
            cls: "C" as const,
            label: "单元日通过量",
            unit: "件/日",
            carrier: "有" as const,
            evidence:
              `\`Process.${unitSpec.rateProp}\` · process-capacity.ts:58（\`HARD_CAPACITY_UNIT_SPECS.rateProp\`，rateKind=${unitSpec.rateKind}）` +
              " + 真消费方 apps/datacore/src/solvers/capacity.ts:75",
            baseline: Math.round(jitter(seed, `${nodeId}/rate`, 40, 140)),
            domain: { min: 10, max: 300, step: 1 },
            effect: { op: "scaleDaysInverse" as const, stepId: sid("queue") },
          },
        ]
      : []),

    // ── P 概率 ────────────────────────────────────────────────────────────────
    ...(yieldBinding
      ? [
          {
            varId: "P1",
            cls: "P" as const,
            label: "工序良率",
            unit: "",
            carrier: "有" as const,
            evidence:
              `\`${yieldBinding.objectType}.${yieldBinding.prop}\` · 20 因子绑定 ${yieldBinding.mark} · capacity-factors.ts:57（writable）` +
              " + 真消费方 apps/datacore/src/solvers/capacity.ts:255-271（良率基线再基·改它即改 p50）",
            baseline: jitter(seed, `${nodeId}/yield`, 0.88, 0.98),
            domain: { min: 0, max: 1, step: 0.01 },
            effect: { op: "inert" as const },
            inertReason:
              "良率本身有承载，但**落到「返工天数」的换算缺承载**：仓里有不良数量与判定，没有返工工时/天数字段，" +
              "缺「单件返工工时率」⇒ 拿良率去编一个返工天数就是静默错答。返工桶因此标 EMPTY，本变量不驱动读数。",
          },
        ]
      : []),
    {
      varId: "P2",
      cls: "P",
      label: "供应商准时率",
      unit: "",
      carrier: "薄",
      evidence:
        "datacore 种子有真值（battery-extended.ts:152-159 逐供应商 onTimeRate）+ `livedin.ts:227` 有同名字段（另一口径），" +
        "但 `apps/datacore/src/solvers/` **0 消费方**（实测 grep 计数 0）⇒ 薄",
      baseline: null,
      domain: { min: 0, max: 1, step: 0.01 },
      effect: { op: "inert" },
      inertReason: "零求解器消费方 ⇒ 今天没有任何一条链把它算进耗时；面板显示它是为了让缺口**看得见**，不是为了让它假装能算。",
    },

    // ── R 规则 ────────────────────────────────────────────────────────────────
    ...(derateBinding
      ? [
          {
            varId: "R1",
            cls: "R" as const,
            label: "认证中产线降额系数",
            unit: "",
            carrier: "有" as const,
            evidence: `\`RULE_PARAM_BINDINGS\` · packages/contracts/src/datacore.ts:201（${derateBinding.ruleKey}.${derateBinding.param} → solver_params \`${derateBinding.path}\`）`,
            baseline: 0.6,
            domain: { min: 0.05, max: 1, step: 0.05 },
            effect: { op: "scaleDaysInverse" as const, stepId: sid("queue") },
            ruleRef: ruleRefOf(derateBinding),
          },
        ]
      : []),
    ...(staleBinding
      ? [
          {
            varId: "R2",
            cls: "R" as const,
            label: "上游数据新鲜度阈值",
            unit: "小时",
            carrier: "有" as const,
            evidence: `\`RULE_PARAM_BINDINGS\` · datacore.ts:201（${staleBinding.ruleKey}.${staleBinding.param} → solver_params \`${staleBinding.path}\`）`,
            baseline: 24,
            domain: { min: 0, max: 120, step: 1 },
            effect: { op: "addDaysScaled" as const, stepId: sid("handoff"), divisor: 24 },
            ruleRef: ruleRefOf(staleBinding),
          },
        ]
      : []),

    // ── S 结构（离散·换拓扑）──────────────────────────────────────────────────
    {
      varId: "S1",
      cls: "S",
      label: "工艺路线",
      unit: "",
      carrier: "薄",
      evidence:
        "`ChainScope.modelIds` · chain-sim.ts:162 有字段，但**值域无 contracts 级单源册**（S0 注释 chain-sim.ts:152-154 明写）；" +
        "`Routing` / `Operation` 对象只在 datacore（battery.ts:2133 / 2234），跨包不可 import（R1）",
      baseline: null,
      baselineOptionId: "route-standard",
      effect: { op: "topology" },
      options: [
        { optionId: "route-standard", label: "路线 A · 标准", note: "基线段集：排队 + 作业 + 交接（等节拍与返工为诚实缺席）" },
        {
          optionId: "route-merged",
          label: "路线 B · 并工序",
          removeStepIds: [sid("handoff")],
          note: "相邻两道工序并到同一工位 ⇒ **删掉交接段**。段集少一段，不是把交接时长调成 0",
        },
        {
          optionId: "route-split",
          label: "路线 C · 分流并行",
          addSteps: [mkStep("merge", "handoff", jitter(seed, `${nodeId}/merge`, 0.3, 1.5), "并行支线汇合")],
          note: "拆两条并行支线 ⇒ **多一段汇合交接**。段集多一段",
        },
      ],
    },
    {
      varId: "S2",
      cls: "S",
      label: "承接基地",
      unit: "",
      carrier: "有",
      evidence:
        "`ChainScope.baseIds` · chain-sim.ts:160，值域 `CANONICAL_BASE_IDS` 派生自 `BASE_REGISTRY`（chain-sim.ts:121）⇒ 选项集是派生的，不是手抄",
      baseline: null,
      baselineOptionId: siteOptions[0]?.optionId ?? null,
      effect: { op: "topology" },
      options: siteOptions,
    },
    {
      varId: "S3",
      cls: "S",
      label: "离线复检工序开关",
      unit: "",
      carrier: "缺",
      evidence:
        "全仓无「工序启停」承载：`Process` 属性表（apps/datacore/src/synthetic/battery.ts:914-941）无 status/enabled；" +
        "`Line.status` 是产线维且 20 因子绑定 ⑳ 标 `writable:false`（capacity-factors.ts:70）⇒ 今天拨不动",
      baseline: null,
      baselineOptionId: null, // ← 缺承载 ⇒ **不给默认选项**，初始不选
      effect: { op: "topology" },
      options: [
        { optionId: "qc-off", label: "关（不复检）", note: "段集不变" },
        {
          optionId: "qc-on",
          label: "开（离线复检）",
          addSteps: [
            mkStep("qc-queue", "queue", jitter(seed, `${nodeId}/qc-queue`, 0.5, 3), "等检"),
            mkStep("qc-handoff", "handoff", jitter(seed, `${nodeId}/qc-handoff`, 0.2, 1), "送检交接"),
          ],
          note: "开一道离线复检 ⇒ **多两段（等检 + 送检交接）**。复检不增值，故不产生 work 段",
        },
      ],
    },
  ];

  return {
    node: { nodeId, label, stage, steps },
    absences,
    variables,
    dataMode: "PLACEHOLDER",
    placeholderNote:
      "本面板的段耗时为 seed 派生**占位值**（同 seed 字节一致·可复现），不是实测。" +
      "W3 按 S0 冻结契约先做、用 mock 数据；W4 收口换引擎真值。承载状态（有/薄/缺）逐条给了 file:line 取证，那部分是实测的。",
  };
}
