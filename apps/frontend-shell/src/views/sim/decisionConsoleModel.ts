/**
 * WO-DECISION-CONSOLE · 经营决策者版「推演与对策」页的**纯函数层**。
 *
 * 这里只放「从回包算出屏上那个数」的推导，**不碰 React、不碰 fetch、不读时钟**
 * —— 与 `chainImpediment.ts` / `sandboxConsoleModel.ts` 同一条纪律：
 * 算法可单测，视图只负责摆位置。
 *
 * ══ 开工前的实测复现（派单要求的「今天的行为是 X，应该是 Y」）══════════════
 * 全部在起真 datacore（seed 42 · demo 租户 · 内存模式 · 端口 4131）上亲手跑的，
 * 每条都给了命令与回包原文（报告里逐条列了）。与派单/规格给的**线索**不一致的，
 * 一律以实测为准，并在下面对应的位置写清楚。
 *
 *  1. **事件目录**：`GET /a/v1/sim/drill/catalog` 实测回 **11 类**（不是规格写的 8 条）。
 *     ⇒ 前端一行都不许写死清单，`label` / `payloadKeys` / `hint` 全部现读渲染。
 *  2. **`targetObjectId` 在今天的后端有两种含义**（本单实测出来的、规格里没有的一条）：
 *     · `stateEffect !== null` 的事件（今天只有 `MATERIAL_REPRICE`）：路由用
 *       `repos.objects.get(targetObjectId)` 校验落点类型 ⇒ 必须传**对象 id**
 *       （`obj_material_pos_lfp` 通过；`pos_lfp` 回「对象在本租户不存在」）。
 *     · `stateEffect === null` 的事件：`eventTarget` 直接喂给求解器入参
 *       （`sop_reschedule.targetOrderId` / `order_fullchain.so`）⇒ 必须传**业务键**
 *       （`SO-3391` 通过并回 2 条真结论；`obj_order_SO-3391` 回「order not found」）。
 *     ⇒ `subjectIdFormFor()` 就是这条判据的唯一落点，**由 catalog 现算，不写死表**。
 *  3. **有些事件今天根本不读你选的那个主体**：`ORDER_CANCEL` / `ORDER_RELOCATE` /
 *     `EQUIPMENT_FAILURE` / `CAPACITY_LOSS` / `MATERIAL_SHORTAGE` / `ORDER_INSERT`
 *     的全部路由都是 `args: []` 且无 `stateEffect` ⇒ 主体只进回执、不进算式。
 *     `subjectIsRead()` 从 catalog 现算这件事，屏上据此给一句诚实位 ——
 *     **不许让用户以为「我选了常州所以算的是常州」**。
 *  4. **方案库的类别 join 落在基地卡上，不在卡点上**（派单说「卡点自带类别」，实测不成立）：
 *     · `chain_impediments` 的 18 条**没有 `category` 字段**；候选的 `lever.factorName`
 *       取值是 `物料到货/瓶颈工序/利用率/在岗出勤·熟练/工序良率`，与方案库的 7 个组名
 *       只有「瓶颈工序」一个字面重合 ⇒ 拿它去 join 就是编对应关系。
 *     · `risk_timeline` 的 8 张基地卡**每张都带 `factor`**，且 8/8 全部命中方案库的键
 *       （`物料齐套/设备OEE/人力工时/瓶颈工序/物流时长/换型损失/良率波动`）。
 *     · 后端 `adopt_mitigation` 这个 actionType 的必填参恰好是 `{base, factor, planKey}`
 *       —— **后端自己就是按「基地 × 类别 × 方案键」记账的**，这是最硬的旁证。
 *     ⇒ 第 ⑤ 区按**基地**给方案，`planCategoryOf()` 只认 `card.factor`。
 */
import type { DrillEventSpec, DrillFinding, DrillReport } from "@platform/contracts";

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 事件模板 → 主体选择器（**scope 由 catalog 现算，前端不写第二份事件清单**）
// ══════════════════════════════════════════════════════════════════════════

/** 主体候选从哪个对象类型来，以及屏上叫什么。`null` = 今天这类事件不需要选主体。 */
export interface SubjectScope {
  /** 本体类型键（喂 `GET /a/v1/objects?type=`）。 */
  typeKey: string;
  /** 屏上的一句话（「选哪个客户」）。 */
  label: string;
  /** 用哪个属性当显示名（读不到就退回 id —— 不编）。 */
  nameProp: string;
  /** 候选多不多：`LIST` = 直接铺（≤20 行）；`SEARCH` = 必须搜（500 张单那种）。 */
  mode: "LIST" | "SEARCH";
  /** `SEARCH` 档的提示语。 */
  searchHint?: string;
  /** 二级选择器（基地 → 产线）。 */
  child?: { typeKey: string; label: string; nameProp: string; filterParam: string };
}

/**
 * 主体候选的**呈现范围**（哪一类对象、铺还是搜）。
 *
 * ⚠ 这张表是**呈现选择**，不是第二套事件真相源 —— 它的键是契约枚举 `DrillEventKind`，
 * 值只回答「给用户看哪一类对象」。事件有哪几类、叫什么、要填什么，**全部**来自
 * `GET /a/v1/sim/drill/catalog`。后端加一个事件：本表没有它 ⇒ 走
 * `SUBJECT_FALLBACK`（一个诚实的手填框 + 一行说明），**事件照样上屏、照样能跑**，
 * 不会像今天那样出现「筛选（共 11337 个落点）」那种一格都选不动的下拉。
 *
 * 每条的候选数都是实测的（`POST /a/v1/objects/aggregate` count）：
 * Customer 20 · Model 6 · Material 8 · Base 13 · Line 130（每基地 10）·
 * DemandSegment 3 · Order **500**（⇒ 只能搜，不能铺）。
 */
const SUBJECT_SCOPE: Record<string, SubjectScope> = {
  // ── 订单口的三件事：500 张单，只能搜（铺出来就是今天那个 11337 行的病）───────
  ORDER_RESCHEDULE: { typeKey: "Order", label: "哪一张单", nameProp: "so", mode: "SEARCH", searchHint: "输单号（SO-3391）或客户名（广汽）" },
  ORDER_CANCEL: { typeKey: "Order", label: "哪一张单", nameProp: "so", mode: "SEARCH", searchHint: "输单号（SO-3391）或客户名（广汽）" },
  ORDER_RELOCATE: { typeKey: "Order", label: "哪一张单", nameProp: "so", mode: "SEARCH", searchHint: "输单号（SO-3391）或客户名（广汽）" },
  /**
   * ⚠ 派单表把「订单改价」归到「客户 + 型号」那一格 —— **实测不成立，已按实测改**：
   * `ORDER_REPRICE` 的主路由 `order_fullchain` 的 `so` 是 `required: true` 且取自
   * `eventTarget`；传客户 id 实测回「order obj_customer_cust_0 not found」。
   * 改价改的是**某一张单**的卖价，所以它和另外三件一样走订单搜索。
   */
  ORDER_REPRICE: { typeKey: "Order", label: "哪一张单", nameProp: "so", mode: "SEARCH", searchHint: "输单号（SO-3391）或客户名（广汽）" },
  // ── 临时插单：路由不读主体（portfolio 无参），型号走 payload.modelId ──────────
  ORDER_INSERT: { typeKey: "Customer", label: "哪个客户加单", nameProp: "custName", mode: "LIST" },
  // ── 物料口的三件事：8 种料，直接铺 ─────────────────────────────────────────
  MATERIAL_DELAY: { typeKey: "Material", label: "哪种料", nameProp: "name", mode: "LIST" },
  MATERIAL_SHORTAGE: { typeKey: "Material", label: "哪种料", nameProp: "name", mode: "LIST" },
  MATERIAL_REPRICE: { typeKey: "Material", label: "哪种料", nameProp: "name", mode: "LIST" },
  // ── 设备故障：基地 → 产线（13 → 每个 10，两级都在 20 行以内）────────────────
  EQUIPMENT_FAILURE: {
    typeKey: "Base",
    label: "哪个基地",
    nameProp: "name",
    mode: "LIST",
    child: { typeKey: "Line", label: "哪条线", nameProp: "name", filterParam: "base" },
  },
  CAPACITY_LOSS: { typeKey: "Base", label: "哪个基地", nameProp: "name", mode: "LIST" },
  FORECAST_BIAS: { typeKey: "Model", label: "哪个型号", nameProp: "name", mode: "LIST" },
};

/** 表里没有这类事件时的诚实兜底：手填 + 说清楚为什么要手填。 */
export const SUBJECT_FALLBACK = {
  label: "对谁",
  note: "这类事件是后端新加的，这里还没有给它配好可选清单 —— 先手填对象编号；填错了回执会直说「未能施加」，不会静默跑成 0。",
};

export function subjectScopeFor(kind: string): SubjectScope | null {
  return SUBJECT_SCOPE[kind] ?? null;
}

/**
 * 这个事件的 `targetObjectId` 该传**对象 id** 还是**业务键** —— 见文件头 §2 的实测。
 * 判据只有一条：有没有 `stateEffect`。有 ⇒ 路由要拿它去 `repos.objects.get`。
 */
export function subjectIdFormFor(spec: DrillEventSpec): "OBJECT_ID" | "BUSINESS_KEY" {
  /**
   * ⚠ **判据换了一条**（WO-EVENTS-WRITE-STATE）。旧版是「有 `stateEffect` ⇒ 对象 id」，
   * 而本单给 11 类事件全补了落点 ⇒ 照旧版会**全部**变成对象 id，
   * 于是 `sop_reschedule.targetOrderId` 收到 `obj_order_SO-3391`，
   * 实测当场回 `Order obj_order_SO-3391 not found`（本单真跑过，不是推理）。
   *
   * 新判据：**求解器那一路更严，它赢** —— 只要有任何一条路由拿 `eventTarget` 当入参，
   * 就传业务键；剩下的才传对象 id。世界态落点那一路**两种都认**
   * （后端 `resolveLanding`：先按对象 id 查，查不到再按 `keyProp` 在该类型内找），
   * 所以让严的那一边定形态是安全的。
   */
  const solverReadsTarget = spec.routes.some((r) => r.args.some((a) => a.from === "eventTarget"));
  return solverReadsTarget ? "BUSINESS_KEY" : "OBJECT_ID";
}

/**
 * 你选的这个主体，今天**进不进算式**（catalog 现算，不是猜的）。
 * `false` ⇒ 屏上必须说一句，否则用户会以为「我选了常州所以算的是常州」。
 *
 * ⚠ **落点取自 payload 的不算「读主体」**：`ORDER_INSERT` 屏上选的是客户，
 * 而落点是 `payload.modelId` 指的那个**型号** —— 客户确实没进算式（本世界的
 * `Customer` 只有应收侧的出边，需求侧一条都没有）。把它算成 `true` 就是
 * 让屏上说一句假话，正是 COO 卡点 ⑤ 骂的那件事。
 */
export function subjectIsRead(spec: DrillEventSpec): boolean {
  if (spec.stateEffect && spec.stateEffect.targetFrom === "eventTarget") return true;
  return spec.routes.some((r) => r.args.some((a) => a.from === "eventTarget"));
}

/**
 * 这件事**真正落到哪个东西上**的一句人话（`null` = 它今天不动世界态）。
 * 屏上要用它把「你选的主体」与「真正被算的东西」分开说 —— 两者不一定是同一个。
 */
export function landingNoteFor(spec: DrillEventSpec): string | null {
  const eff = spec.stateEffect;
  if (!eff) return null;
  if (eff.targetFrom === "payloadKey") {
    return `这件事真正压到的是你填的那个「${eff.targetKey}」，不是你选的那个主体 —— 本世界里主体那一类对象在关系图上没有对应方向的边。`;
  }
  return "这件事会真的改到数上，所以它要求主体是一个真实存在的对象。";
}

/**
 * 🔴 **这个选择器最终要不要产出一个 id** —— COO 实测「设备故障必炸」的成因就是这一条
 * （`ApiClientError: events.N.targetObjectId: Too small`）。
 *
 * ── 今天的行为是 X，应该是 Y ──────────────────────────────────────────────────
 * · **X**：旧判据是「这类事件读不读主体」（`!subjectRead || pickedId`）。而「设备故障」是
 *   **两级**选择器（基地 → 产线），选完基地那一步会**故意清空** `pickedId`（等你选产线）。
 *   两件事撞在一起：`subjectRead=false` ⇒ 不要求 ⇒ 用户选完基地就能按〔加进去〕⇒
 *   `targetObjectId: ""` ⇒ 后端 `z.string().min(1)` 打回一句**英文 zod 报错**。
 *   而「产能损失」用**同一个 13 基地下拉**但**没有第二级**，选完就有值 ⇒ 它是好的。
 *   COO 那句「同一个下拉在产能损失上是好的 ⇒ 这是一处漏」判得完全对。
 * · **Y**：判据落在「**屏上摆了选择器就必须选到叶子那一层**」，与「读不读主体」无关。
 *
 * ⚠ **为什么把它从 `.tsx` 里提到这一层**：本单给 11 类事件都补了世界态落点 ⇒
 * `subjectIsRead` 现在几乎恒为 `true`，**旧写法恰好也不会再炸** —— 那是**巧合不是修复**。
 * 巧合不会在回归时说话，所以它必须变成一条**测得到**的判据（铁律 0.6：
 * 「机制的判据是机器先说话，不是人先想起来」）。下一个「不读主体」的新事件只要
 * 配了两级选择器，这条断言当场红，而不是等 COO 再点一次那个下拉。
 */
export function needsLeafPick(scope: SubjectScope | null, spec: DrillEventSpec): boolean {
  if (scope === null) return false; // 没有选择器（手填兜底那一路）⇒ 不由这条判据管
  if (scope.child) return true; // 两级选择器：选到第二级才算选完，与读不读主体无关
  return subjectIsRead(spec);
}

/** 屏上给这条事件用的 id（对象 id 或业务键），由上面两条判据决定。 */
export function targetIdOf(spec: DrillEventSpec, picked: { id: string; props: Record<string, unknown> }, nameProp: string): string {
  if (subjectIdFormFor(spec) === "OBJECT_ID") return picked.id;
  const key = picked.props[nameProp];
  return typeof key === "string" && key.length > 0 ? key : picked.id;
}

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 卡点：能动的 N 处 / 只能盯着的 M 处（**必须分栏**）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一条**改法**（`chain_impediments` 的 `candidates[]` 归一）。
 *
 * ── 为什么要把它抬到这一层（COO 实测点名的第三条硬伤）─────────────────────────
 * 旧版 `splitImpediments` 只留了 `candidates.length` 这个**计数**，原始候选整个丢掉 ⇒
 * 屏上那 4 颗「有 N 种改法 ▸」按下去**无处可展开**，只能滚到第 ⑤ 区看基地的通用打法库
 * —— 而那一区讲的是「常州·瓶颈工序」，跟被点的那 4 个卡点（物料批次 / 物料平衡 /
 * 金华分切线 / 自贡分容线）**不是同一个主语**。COO 原话：
 * 「点前点后整块 `<main>` 文本 diff 为空」「跟我点的那 4 个卡点不是一回事」。
 *
 * ⚠ 这些数**全部来自引擎回包，一个都不编**：`label` / `fromValue` / `toValue` /
 * `dims[]`（含 `baseline`，所以「改完变成多少」是可核的）/ `rungSource`（这一档是
 * 怎么定出来的）/ `provenance.formula`（怎么算的）。查表给不出 `fromValue→toValue`
 * 与逐维 baseline 对照 —— 这正是「这不是查表」的证据。
 *
 * 2026-08-29 真后端实测：`POST /a/v1/solvers/chain_impediments/invoke {"args":{"scope":{}}}`
 * 回 18 条卡点，其中带 `candidates[]` 的 4 条就是屏上那 4 颗按钮（各 2 / 2 / 4 / 4 种改法）。
 */
export interface ImpedimentCandidate {
  candidateId: string;
  /** 人话标题：`产线·利用率 ↓ 89.9153（瓶颈工序·LINE-WS-jinhua-slitting）`。 */
  label: string;
  /** 拨哪一格：对象类型 / 对象 / 属性 / 因子中文名。 */
  leverText: string;
  fromValue: number | null;
  toValue: number | null;
  unit: string;
  /** 这一档是怎么定出来的（同侪极值 / 紧邻下一档…），引擎原文。 */
  rungSource: string;
  /** 逐维效果：改完 vs 不改（`value` vs `baseline`），带单位与「越小越好还是越大越好」。 */
  dims: { label: string; value: number; baseline: number; unit: string; betterWhenLower: boolean; dataMode: string }[];
  /** 引擎自陈的算法（含 patch 语义与判据规则号）。 */
  formula: string;
  dataMode: string;
}

export interface ImpedimentRow {
  impedimentId: string;
  kind: string;
  severity: number;
  objectType: string;
  objectId: string;
  label: string;
  /** 一句人话：`常州 的产能 3,694 套/日，红线 1,760 套/日（超 110%）`。 */
  sentence: string;
  candidateCount: number;
  /** **这条卡点自己的**那几条改法（不是基地的通用打法库）。 */
  candidates: ImpedimentCandidate[];
  /** 引擎自陈的「为什么一条方案都给不出」原文，一字不改。 */
  noCandidateReason: string | null;
  dataMode: string;
  ruleKey: string | null;
}

interface RawImpediment {
  impedimentId: string;
  kind: string;
  severity: number;
  locus: { objectType: string; objectId: string; label: string };
  evidence?: { ruleKey?: string; metricValue?: number; threshold?: number; unit?: string };
  dataMode: string;
  candidates?: unknown[];
  noCandidateReason?: string | null;
}

/** 数字写法：「估」档不给小数（§3.2-F 位数就是精度承诺）。 */
export function roundish(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1000) return Math.round(n).toLocaleString("zh-CN");
  if (a >= 10) return n.toFixed(0);
  if (a >= 1) return n.toFixed(1);
  return n.toFixed(2);
}

/**
 * 把一条卡点写成一句人话（**不出现规则码 / 字段名 / 机器号**，那些进第二层）。
 *
 * ⚠ 一条实测踩到的坑：`自贡分容线` 是 `95.358 vs 95`，四舍五入后屏上写成
 * 「现在 95%，红线 95%（超红线 0%）」—— **读起来像「没问题」，而它是一条真越线**。
 * 故：两个数舍到同一位时补一位小数；超幅不足 1% 时保留一位小数、且绝不写成 0。
 * 这是「位数就是精度承诺」的另一面 —— 精度不足会把「刚越线」说成「没越线」。
 */
export function impedimentSentence(x: RawImpediment): string {
  const e = x.evidence ?? {};
  const unit = e.unit ?? "";
  if (typeof e.metricValue === "number" && typeof e.threshold === "number" && e.threshold !== 0) {
    const collide = roundish(e.metricValue) === roundish(e.threshold);
    const m = collide ? e.metricValue.toFixed(2) : roundish(e.metricValue);
    const t = collide ? e.threshold.toFixed(2) : roundish(e.threshold);
    const overRaw = ((e.metricValue - e.threshold) / Math.abs(e.threshold)) * 100;
    const dir = overRaw >= 0 ? "超红线" : "低于红线";
    const over = Math.abs(overRaw) < 1 ? Math.abs(overRaw).toFixed(1) : String(Math.round(Math.abs(overRaw)));
    return `${x.locus.label} 现在 ${m}${unit}，红线 ${t}${unit}（${dir} ${over}%）`;
  }
  if (typeof e.metricValue === "number") return `${x.locus.label} 现在 ${roundish(e.metricValue)}${unit}`;
  return x.locus.label;
}

/**
 * @param typeName 本体类型键 → 中文业务名（`GET /a/v1/ontology/object-types` 的 `displayName`，
 *   **后端单源**，前端不内联映射表）。没有它 ⇒ 屏上只剩 `pos_lfp_b2` 这种机器键，
 *   用户读不出「这是一批料」还是「一条线」。
 */
/**
 * 把引擎的 `candidates[]` 归一成屏上要的形状。**一个数都不编**：
 * 取不到的一律留 `null` / 空串，屏上照实少显示一格，绝不填 0 或「低」——
 * 那正是本文件 `sortMitigations` 头注里点名的那种犯法（把不认识的折成最好的一档）。
 */
function normalizeCandidates(raw: unknown, typeName?: Map<string, string>): ImpedimentCandidate[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => {
    const x = c as Record<string, unknown>;
    const lever = (x.lever ?? {}) as Record<string, unknown>;
    const typeKey = String(lever.objectType ?? "");
    const cn = typeName?.get(typeKey) ?? typeKey;
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return {
      candidateId: String(x.candidateId ?? ""),
      label: String(x.label ?? ""),
      leverText: `${cn} ${String(lever.objectId ?? "")} 的「${String(lever.factorName ?? lever.prop ?? "")}」`,
      fromValue: num(x.fromValue),
      toValue: num(x.toValue),
      unit: String(lever.unit ?? ""),
      rungSource: String(x.rungSource ?? ""),
      dims: (Array.isArray(x.dims) ? x.dims : []).map((d) => {
        const y = d as Record<string, unknown>;
        return {
          label: String(y.label ?? ""),
          value: Number(y.value ?? 0),
          baseline: Number(y.baseline ?? 0),
          unit: String(y.unit ?? ""),
          betterWhenLower: y.betterWhen === "lower",
          dataMode: String(y.dataMode ?? "UNDECLARED"),
        };
      }),
      formula: String((x.provenance as Record<string, unknown> | undefined)?.formula ?? ""),
      dataMode: String(x.dataMode ?? "UNDECLARED"),
    };
  });
}

export function splitImpediments(
  raw: unknown,
  typeName?: Map<string, string>,
): { actionable: ImpedimentRow[]; watchOnly: ImpedimentRow[]; total: number } {
  const list = ((raw as { impediments?: RawImpediment[] } | null)?.impediments ?? []) as RawImpediment[];
  const rows: ImpedimentRow[] = list.map((x) => ({
    impedimentId: x.impedimentId,
    kind: x.kind,
    severity: x.severity,
    objectType: x.locus.objectType,
    objectId: x.locus.objectId,
    label: x.locus.label,
    sentence: `${typeName?.get(x.locus.objectType) ?? ""}${typeName?.get(x.locus.objectType) ? " " : ""}${impedimentSentence(x)}`,
    candidateCount: (x.candidates ?? []).length,
    candidates: normalizeCandidates(x.candidates, typeName),
    noCandidateReason: x.noCandidateReason ?? null,
    dataMode: x.dataMode,
    ruleKey: x.evidence?.ruleKey ?? null,
  }));
  return {
    actionable: rows.filter((r) => r.candidateCount > 0),
    watchOnly: rows.filter((r) => r.candidateCount === 0),
    total: rows.length,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 事件顺序线（**标题不许写「传导时间轴」** —— 实测最长累计 2 天，那张图是假的）
// ══════════════════════════════════════════════════════════════════════════

export interface OrderedEvent {
  day: number;
  text: string;
  /** `RISK` = 越线；`ORDER` = 某张单会晚。 */
  kind: "RISK" | "ORDER";
  estimated: boolean;
}

interface OtdRow { so: string; dueDay: number; delayDays: number; onTime: boolean }

/**
 * 事情按天排队。两个来源，都带**真的天数**：
 *  · 演习结论里 `when != null` 的那些（`risk_timeline` 回的「第 N 天越过阈值」）；
 *  · `otdBatch.rows` 里到期日在窗口内、且判为会晚的单。
 * ⚠ `delayDays` 引擎自陈是 `hash(so) mod 3` 的确定性估算、**非实测交付延误**
 * ⇒ 一律标「估」。
 */
export function orderedEvents(findings: DrillFinding[], otdRows: OtdRow[], horizonDays: number): OrderedEvent[] {
  const out: OrderedEvent[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    if (f.when === null || f.when === undefined) continue;
    if (f.when < 0 || f.when > horizonDays) continue;
    const text = `${f.where.label}${f.why ? ` —— ${f.why}` : ""}`;
    const k = `${f.when}::${text}`;
    if (seen.has(k)) continue; // 两个事件各路由一次 risk_timeline ⇒ 同一条会回两遍
    seen.add(k);
    out.push({ day: f.when, text, kind: "RISK", estimated: f.source.dataMode !== "LIVE" });
  }
  for (const r of otdRows) {
    if (r.onTime) continue;
    if (r.dueDay < 0 || r.dueDay > horizonDays) continue;
    const k = `${r.dueDay}::${r.so}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ day: r.dueDay, text: `${r.so} 到期，预计晚 ${r.delayDays} 天`, kind: "ORDER", estimated: true });
  }
  return out.sort((a, b) => a.day - b.day || (a.text < b.text ? -1 : 1));
}

// ══════════════════════════════════════════════════════════════════════════
// § 4 · 客户与订单（**合计敞口按订单去重**，绝不把各基地敞口相加）
// ══════════════════════════════════════════════════════════════════════════

export interface ExposureOrderRow { so: string; cust: string; model: string; qty: number; due: string; dueDay: number; revenueYi: number; seg: string }
export interface BaseCard {
  baseId: string;
  baseName: string;
  factor: string;
  status: string;
  revenueYi: number;
  orderCount: number;
  customerCount: number;
  orders: ExposureOrderRow[];
  doNothing: unknown;
}

/**
 * 敞口两个口径，**屏上只用去重那个**。
 * 实测：8 张卡直接相加 = 89.5771 亿；按 `so` 去重 = 63.1605 亿（53 张不重复的单），
 * 差 1.418×，根因是 `Order.bases` 是数组（`SO-3402` 同时挂常州与金华）。
 * 两个数都返回：基地卡旁要标一句「含跨基地订单，各基地不可直接相加」，
 * 而那句话本身需要「相加会是多少」这个数才站得住。
 */
export function exposureTotals(cards: BaseCard[]): { dedupedYi: number; naiveSumYi: number; orderCount: number; customerCount: number } {
  let naive = 0;
  const byOrder = new Map<string, ExposureOrderRow>();
  for (const c of cards) {
    naive += c.revenueYi || 0;
    for (const o of c.orders ?? []) byOrder.set(o.so, o);
  }
  const orders = [...byOrder.values()];
  return {
    dedupedYi: orders.reduce((a, o) => a + (o.revenueYi || 0), 0),
    naiveSumYi: naive,
    orderCount: orders.length,
    customerCount: new Set(orders.map((o) => o.cust)).size,
  };
}

export interface CustomerRow {
  custId: string;
  custName: string;
  orderCount: number;
  valueYi: number;
  sharePct: number;
  receivablesWan: number;
  creditLimitWan: number;
  maxOverdueDays: number;
  overCredit: boolean;
}

/**
 * 敞口最大的几家客户。订单侧的张数/金额来自 `objects/aggregate` 按 `cust` 分组（真聚合），
 * 应收/额度/逾期来自 `Customer` 对象本身。两边按**客户名**对齐 ——
 * 实测 `Order.cust` 与 `Customer.custName` 500/500 对得上（LOOP5 §0 的金丝雀之一）。
 */
export function topCustomers(
  agg: { group: Record<string, string | null>; metrics: Record<string, number | null> }[],
  customers: { props: Record<string, unknown> }[],
  bookTotalValue: number,
  topN: number,
): CustomerRow[] {
  const byName = new Map<string, Record<string, unknown>>();
  for (const c of customers) {
    const n = c.props.custName;
    if (typeof n === "string") byName.set(n, c.props);
  }
  const rows: CustomerRow[] = agg.map((r) => {
    const name = r.group.cust ?? "";
    const p = byName.get(name) ?? {};
    const value = r.metrics.sum_value ?? 0;
    const receivables = Number(p.receivables ?? 0);
    const limit = Number(p.creditLimit ?? 0);
    return {
      custId: String(p.custId ?? name),
      custName: name,
      orderCount: r.metrics.count_so ?? 0,
      valueYi: value / 1e8,
      sharePct: bookTotalValue > 0 ? (value / bookTotalValue) * 100 : 0,
      receivablesWan: receivables,
      creditLimitWan: limit,
      maxOverdueDays: Number(p.maxOverdueDays ?? 0),
      overCredit: limit > 0 && receivables > limit,
    };
  });
  return rows.sort((a, b) => b.valueYi - a.valueYi).slice(0, topN);
}

// ══════════════════════════════════════════════════════════════════════════
// § 5 · 方案（类别 join 在**基地卡**上，见文件头 §4）
// ══════════════════════════════════════════════════════════════════════════

export interface Mitigation { key: string; name: string; eff: number; tn: number; cost: string; risk: string }

/** 这张基地卡的问题类别 —— 方案库的键。`null` = 对不上（诚实留白，不硬凑）。 */
export function planCategoryOf(card: BaseCard | null, library: Record<string, Mitigation[]>): string | null {
  if (!card) return null;
  return card.factor && library[card.factor] ? card.factor : null;
}

export type SortKey = "tn" | "cost" | "risk";
const COST_ORDER = ["低", "中", "高", "极高"];
const RISK_ORDER = ["低", "中", "高"];

/**
 * 只排序，不推荐（§6-4）。
 * ⚠ 未登记的档位排最后而**不是**当成「低」—— 把不认识的值折成最好的一档，
 * 就是本仓那条「绝不许填 0、绝不许填『低』」的另一种犯法。
 */
export function sortMitigations(list: Mitigation[], key: SortKey): Mitigation[] {
  const rank = (m: Mitigation): number => {
    if (key === "tn") return m.tn;
    const table = key === "cost" ? COST_ORDER : RISK_ORDER;
    const i = table.indexOf(key === "cost" ? m.cost : m.risk);
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };
  return [...list].sort((a, b) => rank(a) - rank(b) || (a.key < b.key ? -1 : 1));
}

// ══════════════════════════════════════════════════════════════════════════
// § 6 · 诚实位（三态必须分得开）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 引擎原文里的**源码文件名 / 行号**要隐去 —— 其余一个字不改。
 *
 * 两条规矩在这里打架，两条都得守：
 *  · `CONVENTION-ui-information-layering §1`：诚实位**允许降层、绝不允许删除**；
 *  · `R-UI-4`：**源码文件名 + 行号打在用户屏上是明令禁止的**（哪怕在第二层）。
 * 折中只有一个：把源码坐标换成一句「（出处已隐去）」，**其余原文照录**，
 * 并在屏上说明做过这一处替换 —— 静默替换等于篡改原文。
 *
 * 实测会踩到这条的原文（`finance_world_projection.notes[0]`）：
 * 「…与 FinancePlan 收入行之间今天**没有任何传导规则**（`seed.ts` 13 条里六方向全查过）…」
 */
export const SOURCE_REF_MASK = "（源码出处已按界面规范隐去）";
export function scrubSourceRefs(raw: string): string {
  return raw
    .replace(/`?[A-Za-z0-9_./-]+\.(ts|tsx|mjs|js|json)(:\d+(-\d+)?)?`?/g, SOURCE_REF_MASK)
    .replace(new RegExp(`(${SOURCE_REF_MASK})+`, "g"), SOURCE_REF_MASK);
}

export interface HonestyNote {
  /** 屏上一句人话。 */
  text: string;
  /** 引擎/接口的原文，**一字不改**。 */
  raw: string;
  /** 影响哪一区（点它能跳回去）。 */
  anchor: string;
}

/**
 * 页脚那一行「这一屏有 N 处成色你需要知道」的内容，逐条从**回包自陈**里取，不自己编。
 */
export function collectHonesty(input: {
  report: DrillReport | null;
  specsByKind: Map<string, DrillEventSpec>;
  impedimentsRaw: unknown;
  financeNotes: string[];
  riskDataMode: string | null;
}): HonestyNote[] {
  const out: HonestyNote[] = [];
  const r = input.report;
  if (r) {
    if (r.truncated) {
      const total = Object.values(r.totalByKind).reduce((a, b) => a + b, 0);
      out.push({
        text: `这次一共扫出 ${total.toLocaleString("zh-CN")} 条结论，屏上只列了最要紧的那几条`,
        raw: r.summary.text,
        anchor: "z4",
      });
    }
    for (const e of r.appliedStateEffects) {
      if (e.applied) continue;
      out.push({ text: `「${input.specsByKind.get(e.eventKind)?.label ?? e.eventKind}」这件事没能打到世界上`, raw: JSON.stringify(e), anchor: "z3" });
    }
    for (const run of r.solverRuns) {
      if (run.ok) continue;
      out.push({ text: `有一路算没跑通（${run.solverKey}）`, raw: run.error ?? "（引擎没给原文）", anchor: "z4" });
    }
    for (const ev of r.events) {
      const spec = input.specsByKind.get(ev.kind);
      if (!spec || subjectIsRead(spec)) continue;
      out.push({
        text: `「${spec.label}」今天不读你选的那个主体 —— 它只决定去问哪几个算法`,
        raw: `该事件的全部路由入参声明为空（routes[].args = []）且无世界态落点（stateEffect = null）；主体只进回执，不进算式。`,
        anchor: "z1",
      });
    }
    if (r.summary.allFailed) {
      out.push({ text: "这次每一路算都没跑通 —— 屏上的空不是「没有风险」", raw: r.summary.text, anchor: "z3" });
    }
  }
  for (const n of input.financeNotes) out.push({ text: "钱这一段有一行是诚实缺席的", raw: n, anchor: "z3" });
  const im = (input.impedimentsRaw as { caveats?: unknown[] } | null)?.caveats;
  if (Array.isArray(im)) {
    for (const c of im) {
      const text = typeof c === "string" ? c : JSON.stringify(c);
      out.push({ text: "卡点判定有一条自带保留意见", raw: text, anchor: "z4" });
    }
  }
  if (input.riskDataMode && input.riskDataMode !== "LIVE") {
    out.push({
      text: "这一屏的数来自模拟数据，不是你们系统的实时数",
      raw: `risk_timeline.dataMode = ${input.riskDataMode}`,
      anchor: "z3b",
    });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// § 7 · 报错要说人话（COO 实测点名的第二条硬伤）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 把接口报错翻成一句**经营者读得懂的话**，并保留原文供第二层查看。
 *
 * ── 今天的行为是 X，应该是 Y（COO 实测原文照录）─────────────────────────────
 * · **X**：屏上直接打 `ApiClientError: events.2.targetObjectId: Too small: expected
 *   string to have >=1 characters`。COO 原话：「报错原文是给工程师看的，不是给我看的
 *   —— 我不知道该找谁、也不知道我做错了什么」。
 * · **Y**：第一层说人话 + 说清**我该做什么**；原文降到第二层（`Raw`），
 *   一个字都不删（`CONVENTION-ui-information-layering §1`：诚实位允许降层、不允许删除）。
 *
 * ⚠ **只翻译认得出的形态，认不出的一律原样透出**。硬编一句「出错了，请重试」
 * 会把一条本来能自救的错误变成一堵墙 —— 那是把「我不知道」写成「你别问了」，
 * 与本仓那条「缺 dataMode 一律 UNDECLARED、绝不默认 LIVE」是同一条纪律。
 */
export function humanizeApiError(raw: string): { text: string; recognized: boolean } {
  // zod 的 `events.N.<字段>: Too small` —— 少填了主体
  const tooSmall = /events\.(\d+)\.targetObjectId:\s*Too small/i.exec(raw);
  if (tooSmall) {
    return {
      text: `第 ${Number(tooSmall[1]) + 1} 件事没有指定主体（那一格空着就提交了）。回左边把它删掉重加一次，两级选择器要选到**第二级**才算选完。`,
      recognized: true,
    };
  }
  const tooSmallAny = /events\.(\d+)\.(\w+):\s*Too small/i.exec(raw);
  if (tooSmallAny) {
    return { text: `第 ${Number(tooSmallAny[1]) + 1} 件事有一格必填的没填（${tooSmallAny[2]}）。回左边把它删掉重加一次。`, recognized: true };
  }
  if (/VALIDATION_ERROR/i.test(raw)) {
    return { text: "你加的事里有一格填得不对，后台没收。左边逐条看一下必填项，删掉重加一次。", recognized: true };
  }
  if (/\b(404|FEATURE_NOT_FOUND)\b/.test(raw)) {
    return { text: "这个租户没开推演这项功能 —— 这不是你填错了，是权限/开关的事，找管理员开。", recognized: true };
  }
  if (/\b(401|403|FORBIDDEN|UNAUTHORIZED)\b/i.test(raw)) {
    return { text: "登录态过期或者你这个角色没有推演权限。重新登录一次；还是不行就是角色的事。", recognized: true };
  }
  if (/Failed to fetch|NetworkError|ECONNREFUSED|fetch failed/i.test(raw)) {
    return { text: "连不上后台 —— 这不是你填错了。等一下再按一次〔算一下〕；一直这样就是服务没起来。", recognized: true };
  }
  // ⛔ 认不出来就照实说「认不出」，并把原文原样给出，不编一句安慰话
  return { text: "这次没算成，而这条报错这里还没有对应的人话说明 —— 原文如下，请连同它一起找工程。", recognized: false };
}

// ══════════════════════════════════════════════════════════════════════════
// § 8 · 屏上每个数**吃不吃你加的那几件事**（WO-EVENTS-WRITE-STATE · COO 病灶的正面回答）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 🔴 **COO 那句「一个数都没动」的真正答案，也是本单最后一处「装作会算」**。
 *
 * ── 今天的行为是 X，应该是 Y（2026-08-29 起真 datacore · seed 42 · demo 实测，原文照录）──
 * 复验（三条命令，任何人可重跑）：
 *   ① `POST /a/v1/sim/sessions/:id/drill`，同一算例把 `pctChange` 取 15 与 100000 各一次
 *   ② `POST /a/v1/solvers/risk_timeline/invoke {"args":{}}` 各一次 —— 比 8 张卡的指纹
 *   ③ `POST /a/v1/solvers/chain_impediments/invoke {"args":{"scope":{}}}` 各一次 —— 比 18 条 id
 * · **X**：第一层最大的那个数上面白纸黑字写着「**这 N 件事凑一块，往后 30 天**」，
 *   而那个数（63.16 亿 / 53 张单 / 会晚 26 张）来自 `risk_timeline`，
 *   前端给它的实参实测是 **`{}`** —— **一个 event 都没传进去**。
 *   `chain_impediments`（18 处卡点）同理，实参是 `{scope:{}}`。
 *   ⇒ 这两路**结构上不可能**随事件变。实测坐实：把 `pctChange` 从 15 拉到 100000，
 *   `risk_timeline` 的 8 张卡指纹**逐字节相同**、`chain_impediments` 的 18 条 id **逐字节相同**；
 *   同一次对照里，真吃事件的那一路 `findingsChanged` 从 **0 → 104**。
 *   ⇒ 用户改了输入 → 抬头说「这几件事凑一块」→ 底下那个数纹丝不动 ⇒
 *   他只能得出「这系统在骗我」这一个结论。**而他是对的**：那行抬头是一句错误归因。
 * · **Y**：每个第一层的数都必须**自己说清楚它吃不吃你加的事**。
 *   吃的（演习那一路）照常；不吃的**当场标出来**，并指路到真会动的那个数。
 *
 * ── 为什么是「声明」不是在 JSX 里写死一句话 ──────────────────────────────────
 * 与本单 `DRILL_EVENT_SPECS` 同一条纪律：判据是**数据**，因此可被测试咬住。
 * 写在 JSX 里的一句提示，下次有人给 `risk_timeline` 接上事件入参时**不会有任何东西提醒他来改**，
 * 于是一句当时正确的话会静默地变成假话 —— 本仓管这个叫「注释不是机制」。
 *
 * ⚠ **判据落在「这一路的实参里有没有事件」上**，不落在「这个数看起来该不该变」上。
 * 后者是感觉，前者是可以指着代码点头的事实（`DecisionConsoleView` 的 `Promise.all` 那一段）。
 */
export interface ScreenNumberProvenance {
  /** 这个数在屏上的名字（人话，与屏上那行字一致）。 */
  label: string;
  /** 它由哪一路算出来 —— 用屏上第 ⑥ 区那份耗时清单里的同一个说法，不另起一套叫法。 */
  route: string;
  /**
   * 这一路的实参里**有没有**本次事件。
   * `false` ⇒ 屏上必须标「不随你加的事变」，否则就是错误归因。
   */
  consumesEvents: boolean;
  /** 不吃事件时，这个数到底在回答什么问题（不许只说「它不动」就完事）。 */
  answers: string;
}

/**
 * 屏上第一层那几个数的出处表 —— **与 `DecisionConsoleView` 的 `Promise.all` 逐路对应**。
 *
 * ⛔ 改动那段 `Promise.all` 的实参时**必须同步改这里**：
 * `decision-console-model.test.ts` 的接缝断言会把「表里说不吃事件、而那一路的实参里出现了 events」
 * 打成红 —— 这就是「机器先说话」的那一半。
 */
export const SCREEN_NUMBER_PROVENANCE: readonly ScreenNumberProvenance[] = [
  {
    label: "这 30 天交不出去的货（亿）· 多少张单 · 会晚多少张",
    route: "算每个基地这 30 天紧到什么程度",
    consumesEvents: false,
    answers: "这个世界**当下**每个基地紧到什么程度 —— 它是本次演习的**背景板**，不是结果。",
  },
  {
    label: "哪儿会出事（处）",
    route: "全链扫红线 + 枚举改法",
    consumesEvents: false,
    answers: "本体真值上**当下**扫得出的卡点与改法 —— 同样是背景板。",
  },
  {
    label: "产销缺口（万套）",
    route: "演习里的供需缺口归因",
    consumesEvents: false,
    answers: "它读**本体真值**（在手量与需求量），不读这次推出来的世界态 ⇒ 幅度拉到 10 万倍也是同一个数。",
  },
  {
    label: "N 条顺着关系推出来的结论因此改变",
    route: "把事情施加上去 + 往后推 30 天 + 扫一遍卡住的地方",
    consumesEvents: true,
    answers: "",
  },
  {
    label: "世界态改动了多少格",
    route: "把事情施加上去 + 往后推 30 天 + 扫一遍卡住的地方",
    consumesEvents: true,
    answers: "",
  },
];

/**
 * 屏上要打的那句话：**哪几个数不随你加的事变，哪个才是会变的那个**。
 *
 * `null` = 还没算过（没结果时不该先吓唬人）。
 */
export function invariantNumbersNote(report: DrillReport | null): {
  text: string;
  raw: string;
  movingLabels: string[];
  frozenLabels: string[];
} | null {
  if (!report) return null;
  const frozen = SCREEN_NUMBER_PROVENANCE.filter((p) => !p.consumesEvents);
  const moving = SCREEN_NUMBER_PROVENANCE.filter((p) => p.consumesEvents);
  if (frozen.length === 0) return null;
  return {
    text:
      `⚠ 这一屏上有 ${frozen.length} 个数**不随你加的事变** —— 你把幅度从 15 改成 100000，它们也是同一个数。` +
      `它们回答的是「这个世界当下什么样」，不是「你加的这几件事之后会怎样」。` +
      `真的会随你加的事变的是：${moving.map((m) => `「${m.label}」`).join("、")}。`,
    raw:
      frozen
        .map((p) => `· ${p.label}\n  由「${p.route}」那一路算；本次传给它的实参里**没有**你加的事件 ⇒ 结构上不会变。\n  它其实在回答：${p.answers}`)
        .join("\n") +
      // ⚠ 日期前必须留一个非词字符：写成 `\n\n2026-08-29` 时，源码里 `\` `n` 紧挨着 `2`，
      //   `stale-claims` 的日期正则 `\b20\d{2}-...` 卡在词边界上匹配不到 —— 本单实测踩过一次。
      `\n\n 实测于 2026-08-29（真后端 seed 42 · 复验端点 POST /a/v1/sim/sessions/:id/drill）：\n` +
      `同一个「物料价格变动」把幅度从 15 拉到 100000 ——\n` +
      `· 每个基地紧到什么程度：8 张卡逐字节相同\n· 全链卡点：18 条 id 逐字节相同\n· 产销缺口：81 → 81\n` +
      `· 而演习那一路「顺着关系推出来的结论」：0 条改变 → 104 条改变。\n` +
      `你自己就能复验，不用看代码：把上面那件事的幅度改一个大得离谱的数，再按一次〔算一下〕——\n` +
      `这几个数会一动不动，而「N 条结论因此改变」会变。`,
    movingLabels: moving.map((m) => m.label),
    frozenLabels: frozen.map((f) => f.label),
  };
}

/** 「算完了但一项都没动」和「没算」是两个状态 —— 这条判据决定屏上说哪一句。 */
export function nothingMovedText(report: DrillReport | null): string | null {
  if (!report) return null;
  if (report.summary.allFailed) return null;
  const total = Object.values(report.totalByKind).reduce((a, b) => a + b, 0);
  if (total > 0) return null;
  return "算完了，一项都没动 —— 是「比过了，一项都没动」，不是「没比」。";
}
