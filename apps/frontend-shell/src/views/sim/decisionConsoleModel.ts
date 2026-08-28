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
import type { DrillCatalog, DrillEventSpec, DrillFinding, DrillReport } from "@platform/contracts";

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
  return spec.stateEffect ? "OBJECT_ID" : "BUSINESS_KEY";
}

/**
 * 你选的这个主体，今天**进不进算式**（catalog 现算，不是猜的）。
 * `false` ⇒ 屏上必须说一句，否则用户会以为「我选了常州所以算的是常州」。
 */
export function subjectIsRead(spec: DrillEventSpec): boolean {
  if (spec.stateEffect) return true;
  return spec.routes.some((r) => r.args.some((a) => a.from === "eventTarget"));
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

/** 把一条卡点写成一句人话（**不出现规则码 / 字段名 / 机器号**，那些进第二层）。 */
export function impedimentSentence(x: RawImpediment): string {
  const e = x.evidence ?? {};
  const unit = e.unit ?? "";
  if (typeof e.metricValue === "number" && typeof e.threshold === "number" && e.threshold !== 0) {
    const overPct = Math.round(((e.metricValue - e.threshold) / Math.abs(e.threshold)) * 100);
    const dir = overPct >= 0 ? "超红线" : "低于红线";
    return `${x.locus.label} 现在 ${roundish(e.metricValue)}${unit}，红线 ${roundish(e.threshold)}${unit}（${dir} ${Math.abs(overPct)}%）`;
  }
  if (typeof e.metricValue === "number") return `${x.locus.label} 现在 ${roundish(e.metricValue)}${unit}`;
  return x.locus.label;
}

export function splitImpediments(raw: unknown): { actionable: ImpedimentRow[]; watchOnly: ImpedimentRow[]; total: number } {
  const list = ((raw as { impediments?: RawImpediment[] } | null)?.impediments ?? []) as RawImpediment[];
  const rows: ImpedimentRow[] = list.map((x) => ({
    impedimentId: x.impedimentId,
    kind: x.kind,
    severity: x.severity,
    objectType: x.locus.objectType,
    objectId: x.locus.objectId,
    label: x.locus.label,
    sentence: impedimentSentence(x),
    candidateCount: (x.candidates ?? []).length,
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

/** 「算完了但一项都没动」和「没算」是两个状态 —— 这条判据决定屏上说哪一句。 */
export function nothingMovedText(report: DrillReport | null): string | null {
  if (!report) return null;
  if (report.summary.allFailed) return null;
  const total = Object.values(report.totalByKind).reduce((a, b) => a + b, 0);
  if (total > 0) return null;
  return "算完了，一项都没动 —— 是「比过了，一项都没动」，不是「没比」。";
}
