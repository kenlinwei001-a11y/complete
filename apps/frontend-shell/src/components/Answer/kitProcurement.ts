/**
 * WO-S08-KIT-PROCUREMENT-FE · 齐套问答答案里的**采购四段**（纯模型层，不含 React）。
 *
 * ── 这个文件要治的病（实测，非推测）──────────────────────────────────────────
 * WO-SANDBOX-D2 并线后，`kit_readiness` 每个缺料项都带上了按责任方可分解的采购四段
 * （`procurement.leadTime.legs` / `ownerDays` / `criticalLeg`）。但 **S08 齐套问答的答案里
 * 一个字都读不出来**：QOS 的答案块契约（`AnswerBlockSchema`）只有 text/table/kpi/…，
 * agentcore 的通用投影 `summarizeSolverOutput` 把 `rows` 投成一张表，而 `shortItems` 这一列
 * 走 `cellOf()` 的兜底分支 —— 对象数组里既无 label/name/factor/id ⇒ **整项 `JSON.stringify`**，
 * 多项以「；」相连塞进一个单元格。
 *
 * 2026-08-07 亲手跑一遍取证（内存态 datacore·SEED_DEMO=1·seed 42 →
 * `POST /a/v1/solvers/kit_readiness/invoke {fromDay:1,toDay:14}` → agentcore dist 的
 * `summarizeSolverOutput`）实测：
 *   columns = ["orderId","kitRatio","shortItems","advice","earliestKitDay","earliestKitDayStatus"]
 *   row0[2] = "{\"material\":\"elyte\",…,\"procurement\":{…四段…}}；{\"material\":\"cu_foil\",…}"
 * 即：四段**确实到了前端**，只是以一坨转义 JSON 的形态躺在表格单元格里 —— 用户看不懂，
 * 等同于零消费。本文件 + `KitProcurementLegs.tsx` 就是把那坨 JSON 翻译成「晚在哪一段、该找谁」。
 *
 * ── 纪律 ─────────────────────────────────────────────────────────────────────
 *  · **不重定义契约已有类型**（contracts-only-shared）：段/责任方/三态/`ProcurementPlan`
 *    一律 `import … from "@platform/contracts"`。
 *  · **总耗时 / 责任方汇总 / 关键段一律走契约的那份唯一实现**
 *    （`procurementTotalDays` / `procurementDaysByOwner` / `criticalProcurementLeg`）——
 *    与沙盘侧消费方**同源**靠的就是这个：两边都不自己写加法，而是调同一个函数。
 *    引擎随载荷回传的同名字段（`ownerDays` / `criticalLeg` / `leadTime.totalDays`）
 *    只用来**对账**，不一致时屏上当面报（`MISMATCH`），绝不静默择一显示 ——
 *    「该找谁」答错的代价是用户打错电话。
 *  · **三态不许画成两态**：`NOT_APPLICABLE`（结构上没有这一段·真值 0 天·有依据）与
 *    `EMPTY`（取不到真值·不知道）在契约里被特意分开，本层必须把区别**结构化**带到 UI，
 *    尤其是**功能性后果**：NA 计 0 不阻断合计；EMPTY 令合计「不可结算」并列出被哪几段挡的。
 *  · **绝不拿 0 冒充 EMPTY**：`legDaysText` 对 EMPTY 恒返回「—」（渲染层最后一道闸）。
 *  · **不编单位**：天数有契约明文口径（天）；`shortage`/`minOrderQty`/`replenishQty` 的量纲
 *    引擎今天**不下发**（本基线无 solver-units 注册表），故只显数字 + 「量纲未下发」标注，
 *    不臆造「吨」这类看着合理的单位。
 */
import {
  criticalProcurementLeg,
  isValueAddKind,
  PROCUREMENT_LEG_STEP_KIND,
  PROCUREMENT_LEGS,
  PROCUREMENT_OWNERS,
  procurementDaysByOwner,
  procurementTotalDays,
  ProcurementPlanSchema,
  type ProcurementLegKind,
  type ProcurementLegStatus,
  type ProcurementOwner,
  type ProcurementPlan,
} from "@platform/contracts";
import { z } from "zod";
// 天数文案与沙盘侧**同一实现**（口径同源的最小单元：连"18.00 天"这种小数位也不各写一份）。
import { formatDays } from "@/views/sim/chainLineMap";

export { formatDays };

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · 从答案表格里把缺料项捞回来（今天唯一的过线通道）
// ══════════════════════════════════════════════════════════════════════════════

/** `kit_readiness` 行投影必然带的列（`summarizeSolverOutput` 取 `Object.keys(rows[0])`）。 */
export const KIT_TABLE_REQUIRED_COLUMNS = ["orderId", "kitRatio", "shortItems", "advice"] as const;

/**
 * 这张表是不是 `kit_readiness` 的行投影。
 * 判据只认**列名签名**，不认标题/问句/意图键 —— 那些都可能被改文案，列名来自求解器输出的字段名。
 */
export function isKitReadinessTable(columns: readonly string[]): boolean {
  return KIT_TABLE_REQUIRED_COLUMNS.every((c) => columns.includes(c));
}

/**
 * 把 `cellOf()` 拼出来的那串 JSON 拆回对象。
 *
 * **不按「；」split**：分隔符出现在某段 `reason` 文案里就会把一条 JSON 劈成两半。
 * 这里走**花括号配平扫描**（识别字符串字面量与转义），与分隔符无关 —— 引擎哪天换个连接符也不受影响。
 */
export function scanJsonObjects(cell: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < cell.length; i++) {
    const ch = cell[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { if (depth === 0) start = i; depth++; continue; }
    if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(cell.slice(start, i + 1)));
        } catch {
          // 配平了但解析不过 = 不是 JSON。整体判失败（交给调用方回落原表），不吞不猜。
          return [];
        }
        start = -1;
      }
      continue;
    }
  }
  return depth === 0 ? out : [];
}

/**
 * 单个缺料项。`procurement` 直接用**契约的** `ProcurementPlanSchema` —— 于是引擎哪天把四段
 * 合成一个数、或拿 0 冒充 EMPTY，这里当场解析失败并回落原表，而不是把一个错的天数画成好看的柱子。
 */
export const KitShortItemSchema = z.object({
  material: z.string(),
  ratio: z.number(),
  shortage: z.number(),
  earliestDay: z.number().optional(),
  coveringEtaDay: z.number().nullable().optional(),
  procurement: ProcurementPlanSchema.optional(),
  ownerDays: z.object({ days: z.record(z.string(), z.number()), unknownOwners: z.array(z.string()) }).optional(),
  criticalLeg: z
    .object({ leg: z.string(), owner: z.string(), ownerRef: z.string().nullable(), days: z.number().nullable() })
    .nullable()
    .optional(),
});
export type KitShortItem = z.infer<typeof KitShortItemSchema>;

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 中文标签（契约刻意不带 UI 文案 · R14 不内联任何具体供应商/基地名）
// ══════════════════════════════════════════════════════════════════════════════

/** 段 → 中文名。键集由契约 `PROCUREMENT_LEGS` 定死（新增一段 → 这里编译期就红）。 */
export const LEG_LABEL: Record<ProcurementLegKind, string> = {
  supplier_production: "供应商生产",
  in_transit: "在途运输",
  customs: "清关",
  incoming_inspection: "到货检验",
};

/** 责任方 → 中文名。键集由契约 `PROCUREMENT_OWNERS` 定死。 */
export const OWNER_LABEL: Record<ProcurementOwner, string> = {
  SUPPLIER: "供应商",
  CARRIER: "承运方",
  CUSTOMS_BROKER: "清关行",
  QUALITY_IQC: "来料检验",
};

/**
 * 「该找谁」的行动指向。`QUALITY_IQC` 单列 —— 契约注释写得很清楚：
 * 「到厂了但压在待检区，**这段是自己的锅**」。混着显示，用户会去打一通打不通的电话。
 */
export const OWNER_IS_INTERNAL: Record<ProcurementOwner, boolean> = {
  SUPPLIER: false,
  CARRIER: false,
  CUSTOMS_BROKER: false,
  QUALITY_IQC: true,
};

export function ownerActionHint(owner: ProcurementOwner): string {
  return OWNER_IS_INTERNAL[owner] ? "对内：本厂质量部来料检验，这段是自家的锅" : "对外：需要向该责任方催办 / 升级";
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · 三态表现（诚实位的落点）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 三态的表现规格。关键判据不是颜色，是这三条互不相同的结构性事实：
 *
 *  | 态               | `known` | 屏上天数      | 说明前缀 | 是否阻断合计 |
 *  |------------------|---------|---------------|----------|--------------|
 *  | `MEASURED`       | 是      | 真值（18.00 天）| 口径     | 否           |
 *  | `NOT_APPLICABLE` | 是      | `0.00 天`（真值）| 依据     | 否           |
 *  | `EMPTY`          | **否**  | `—`（绝不写 0） | 缺       | **是**       |
 *
 * `known` 就是「不适用」与「不知道」的分界，二者对**合计**的作用也相反
 * （契约 `procurementTotalDays`：NA 计 0、EMPTY 令合计 `null`）—— 这是"它俩没被画成一样"的
 * **功能性**证据，比任何视觉差异都硬，测试咬的就是这一条。
 */
export interface LegStatusPresentation {
  label: string;
  meaning: string;
  known: boolean;
  reasonPrefix: string;
  blocksTotal: boolean;
}

export const LEG_STATUS_PRESENTATION: Record<ProcurementLegStatus, LegStatusPresentation> = {
  MEASURED: {
    label: "实测",
    meaning: "有真凭证算出来的天数（可查到来源对象与字段）",
    known: true,
    reasonPrefix: "口径",
    blocksTotal: false,
  },
  NOT_APPLICABLE: {
    label: "不适用",
    meaning: "这一段结构上不存在 ⇒ 真值就是 0 天，有据可依",
    known: true,
    reasonPrefix: "依据",
    blocksTotal: false,
  },
  EMPTY: {
    label: "取不到",
    // ⚠ 屏上文案（图例直接渲染），不许写 markdown 强调符 —— 会原样显示成星号。
    meaning: "拿不到真值 ⇒ 不知道是多少天，不拿 0 冒充（因此四段合计不可结算）",
    known: false,
    reasonPrefix: "缺",
    blocksTotal: true,
  },
};

/** 屏上天数文案。`EMPTY` 恒「—」：这是"不许拿 0 冒充"在渲染层的最后一道闸。 */
export function legDaysText(status: ProcurementLegStatus, days: number | null): string {
  const pres = LEG_STATUS_PRESENTATION[status];
  if (!pres.known || days === null) return "—";
  return formatDays(days);
}

// ══════════════════════════════════════════════════════════════════════════════
// § 4 · 视图模型
// ══════════════════════════════════════════════════════════════════════════════

export interface KitLegVM {
  leg: ProcurementLegKind;
  label: string;
  owner: ProcurementOwner;
  ownerLabel: string;
  /** 具体责任方；指不出来 = null（**不编一个名字**）。 */
  ownerRef: string | null;
  status: ProcurementLegStatus;
  presentation: LegStatusPresentation;
  days: number | null;
  daysText: string;
  reason: string | null;
  /** 真值出处（R13）。非 MEASURED 恒 null。 */
  source: { objectType: string; objectIds: string[]; field: string } | null;
  /** 瀑布条宽度百分比（0–100）。天数未知 ⇒ 0（不画一根凭空的柱子）。 */
  widthPct: number;
  /** 是否增值段（走契约 `isValueAddKind`，前端不另立判据）。 */
  valueAdd: boolean;
  critical: boolean;
}

/** 「引擎回传的汇总」与「契约唯一实现算出来的」是否对得上。 */
export type KitAgreement = "AGREE" | "MISMATCH" | "ENGINE_ABSENT";

export interface KitOwnerRollupVM {
  owner: ProcurementOwner;
  ownerLabel: string;
  days: number;
  pctOfTotal: number | null;
  internal: boolean;
}

export interface KitCriticalVM {
  leg: ProcurementLegKind;
  legLabel: string;
  owner: ProcurementOwner;
  ownerLabel: string;
  ownerRef: string | null;
  days: number;
  daysText: string;
  pctOfTotal: number | null;
  actionHint: string;
  internal: boolean;
}

export interface KitItemVM {
  material: string;
  shortage: number;
  ratio: number;
  /** 开工日之后**最早到货**的那一批在途 ETA（不看它够不够补缺口）。缺席 → null。 */
  earliestDay: number | null;
  /** 靠在途**真能补上缺口**的那一批 ETA；一直不够 → null（那就只能重采，走四段）。 */
  coveringEtaDay: number | null;
  supplierId: string | null;
  supplierName: string | null;
  legs: KitLegVM[];
  /** 四段合计（天）。任一段 EMPTY → null（契约口径，前端不另算）。 */
  totalDays: number | null;
  complete: boolean;
  /** 令合计不可结算的那些段（EMPTY）。可结算时为空数组。 */
  blockingLegs: ProcurementLegKind[];
  ownerRollup: KitOwnerRollupVM[];
  /** 天数未知、因而**不摊到任何人头上**的责任方（契约 `unknownOwners`）。 */
  unknownOwners: ProcurementOwner[];
  critical: KitCriticalVM | null;
  criticalAgreement: KitAgreement;
  ownerAgreement: KitAgreement;
  /** 引擎自报的 `leadTime.totalDays` 与契约重算是否一致。 */
  totalAgreement: KitAgreement;
  valueAddDays: number | null;
  minOrderQty: number | null;
  replenishQty: number | null;
  moqApplied: boolean;
  onTimeRate: number | null;
  expectedSlipDays: number | null;
  earliestKitDay: number | null;
  expectedKitDay: number | null;
}

export interface KitOrderVM {
  orderId: string;
  kitRatio: number | null;
  advice: string | null;
  /** 整单最早齐套日（相对天）。 */
  earliestKitDay: number | null;
  /** 引擎自报的诚实位：MEASURED / EMPTY。列缺席 → null。 */
  earliestKitDayStatus: string | null;
  /**
   * EMPTY 的原因。
   * ⚠ 实测：`summarizeSolverOutput` 的列名取自 `rows[0]` —— 首行不是 EMPTY 时
   * `earliestKitDayReason` 这一列**根本不在表里**，后面几行的原因随之丢失。
   * 那种情形下这里是 `null`，UI 必须说「后端未随表下发原因」，不许自己编一句。
   */
  earliestKitDayReason: string | null;
  items: KitItemVM[];
  /** 缺料但引擎**没给**采购段的物料（诚实列出，不假装它们不存在）。 */
  itemsWithoutProcurement: string[];
  /** 该行 shortItems 单元格里解析不出来的条目数（>0 时 UI 明示，不静默丢）。 */
  unparsedShortItems: number;
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

function sameOwnerDays(a: Record<string, number>, b: Partial<Record<ProcurementOwner, number>>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => Math.abs((a[k] ?? 0) - (b[k as ProcurementOwner] ?? 0)) < 1e-6);
}

/**
 * 一个缺料项 → 视图模型。没带 `procurement` → `null`（调用方把它列进「引擎未下发采购段」，
 * **不造一个四段全 EMPTY 的空壳**：那会把"后端没算"渲染成"后端算了但四段都取不到"，是两回事）。
 */
export function buildKitItemVM(item: KitShortItem): KitItemVM | null {
  const plan: ProcurementPlan | undefined = item.procurement;
  if (plan === undefined) return null;

  const legs = plan.leadTime.legs;
  // ↓ 三处全部走契约唯一实现，前端零加法
  const total = procurementTotalDays(legs);
  const rollup = procurementDaysByOwner(legs);
  const critical = criticalProcurementLeg(legs);

  const pctOf = (days: number): number | null => (total === null || total <= 0 ? null : round3((days / total) * 100));

  const legVMs: KitLegVM[] = PROCUREMENT_LEGS.map((kind) => {
    const l = legs.find((x) => x.leg === kind);
    // 契约 schema 已锁死四段齐全；真拿到 undefined 说明校验被绕过了 —— 宁可当场抛，也不补一段空腿。
    if (l === undefined) throw new Error(`采购段解析后仍缺 leg="${kind}"：载荷未经 ProcurementPlanSchema 校验`);
    const pres = LEG_STATUS_PRESENTATION[l.status];
    return {
      leg: kind,
      label: LEG_LABEL[kind],
      owner: l.owner,
      ownerLabel: OWNER_LABEL[l.owner],
      ownerRef: l.ownerRef,
      status: l.status,
      presentation: pres,
      days: pres.known ? l.days : null,
      daysText: legDaysText(l.status, l.days),
      reason: l.reason ?? null,
      source: l.source,
      widthPct: !pres.known || l.days === null || total === null || total <= 0 ? 0 : round3((l.days / total) * 100),
      valueAdd: isValueAddKind(PROCUREMENT_LEG_STEP_KIND[kind]),
      critical: critical !== null && critical.leg === kind,
    };
  });

  const criticalVM: KitCriticalVM | null =
    critical === null || critical.days === null
      ? null
      : {
          leg: critical.leg,
          legLabel: LEG_LABEL[critical.leg],
          owner: critical.owner,
          ownerLabel: OWNER_LABEL[critical.owner],
          ownerRef: critical.ownerRef,
          days: critical.days,
          daysText: formatDays(critical.days),
          pctOfTotal: pctOf(critical.days),
          actionHint: ownerActionHint(critical.owner),
          internal: OWNER_IS_INTERNAL[critical.owner],
        };

  const engineCritical = item.criticalLeg;
  const criticalAgreement: KitAgreement =
    engineCritical === undefined
      ? "ENGINE_ABSENT"
      : (engineCritical?.leg ?? null) === (critical?.leg ?? null) && (engineCritical?.owner ?? null) === (critical?.owner ?? null)
        ? "AGREE"
        : "MISMATCH";

  const ownerAgreement: KitAgreement =
    item.ownerDays === undefined ? "ENGINE_ABSENT" : sameOwnerDays(item.ownerDays.days, rollup.days) ? "AGREE" : "MISMATCH";

  // 引擎自报的合计 vs 契约重算（`ProcurementLeadTimeSchema` 已硬绑，这里是渲染前最后一次对账）
  const totalAgreement: KitAgreement = plan.leadTime.totalDays === total ? "AGREE" : "MISMATCH";

  const ownerRollup: KitOwnerRollupVM[] = PROCUREMENT_OWNERS.filter((o) => rollup.days[o] !== undefined).map((o) => ({
    owner: o,
    ownerLabel: OWNER_LABEL[o],
    days: rollup.days[o] as number,
    pctOfTotal: pctOf(rollup.days[o] as number),
    internal: OWNER_IS_INTERNAL[o],
  }));

  return {
    material: item.material,
    shortage: item.shortage,
    ratio: item.ratio,
    earliestDay: item.earliestDay ?? null,
    coveringEtaDay: item.coveringEtaDay ?? null,
    supplierId: plan.supplierId,
    supplierName: plan.supplierName,
    legs: legVMs,
    totalDays: total,
    complete: plan.leadTime.complete,
    blockingLegs: legVMs.filter((l) => l.presentation.blocksTotal).map((l) => l.leg),
    ownerRollup,
    unknownOwners: rollup.unknownOwners as ProcurementOwner[],
    critical: criticalVM,
    criticalAgreement,
    ownerAgreement,
    totalAgreement,
    valueAddDays: total === null ? null : legVMs.filter((l) => l.valueAdd).reduce((s, l) => s + (l.days ?? 0), 0),
    minOrderQty: plan.minOrderQty,
    replenishQty: plan.replenishQty,
    moqApplied: plan.moqApplied,
    onTimeRate: plan.onTimeRate,
    expectedSlipDays: plan.expectedSlipDays,
    earliestKitDay: plan.earliestKitDay,
    expectedKitDay: plan.expectedKitDay,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 5 · 表格块 → 订单视图模型
// ══════════════════════════════════════════════════════════════════════════════

type Cell = string | number | null;

function cellAt(columns: readonly string[], row: readonly Cell[], name: string): Cell | undefined {
  const i = columns.indexOf(name);
  return i < 0 ? undefined : row[i];
}

/**
 * 把 `kit_readiness` 的答案表格块解析成订单视图模型。
 *
 * 返回 `null` = **这张表不是齐套表，或 `shortItems` 一条也解析不出来** ⇒ 调用方原样渲染普通表格
 * （回落到今天的行为，绝不因为"接了新渲染"把原有信息弄丢）。
 */
export function buildKitOrderVMs(columns: readonly string[], rows: readonly (readonly Cell[])[]): KitOrderVM[] | null {
  if (!isKitReadinessTable(columns)) return null;

  const orders: KitOrderVM[] = [];
  let parsedAny = false;

  for (const row of rows) {
    const cell = cellAt(columns, row, "shortItems");
    const raws = typeof cell === "string" ? scanJsonObjects(cell) : [];
    const items: KitItemVM[] = [];
    const without: string[] = [];
    let unparsed = 0;

    for (const raw of raws) {
      const parsed = KitShortItemSchema.safeParse(raw);
      if (!parsed.success) {
        unparsed++;
        continue;
      }
      parsedAny = true;
      const vm = buildKitItemVM(parsed.data);
      if (vm === null) without.push(parsed.data.material);
      else items.push(vm);
    }

    const orderIdCell = cellAt(columns, row, "orderId");
    const kitRatioCell = cellAt(columns, row, "kitRatio");
    const adviceCell = cellAt(columns, row, "advice");
    const earliestCell = cellAt(columns, row, "earliestKitDay");
    const statusCell = cellAt(columns, row, "earliestKitDayStatus");
    const reasonCell = cellAt(columns, row, "earliestKitDayReason");

    orders.push({
      orderId: typeof orderIdCell === "string" ? orderIdCell : String(orderIdCell ?? "—"),
      kitRatio: typeof kitRatioCell === "number" ? kitRatioCell : null,
      advice: typeof adviceCell === "string" ? adviceCell : null,
      earliestKitDay: typeof earliestCell === "number" ? earliestCell : null,
      earliestKitDayStatus: typeof statusCell === "string" ? statusCell : null,
      earliestKitDayReason: typeof reasonCell === "string" && reasonCell.length > 0 ? reasonCell : null,
      items,
      itemsWithoutProcurement: without,
      unparsedShortItems: unparsed,
    });
  }

  // 一条都没解析出来 ⇒ 这张表虽然列名像齐套表，但内容不是我们认识的形状：回落原表，不硬渲染空壳。
  return parsedAny ? orders : null;
}

/** 三态在**本次结果里**各出现多少次（页首"三态都在场"的自陈，也是测试的锚）。 */
export function kitStatusTally(orders: readonly KitOrderVM[]): Record<ProcurementLegStatus, number> {
  const tally: Record<ProcurementLegStatus, number> = { MEASURED: 0, NOT_APPLICABLE: 0, EMPTY: 0 };
  for (const o of orders) for (const it of o.items) for (const l of it.legs) tally[l.status] += 1;
  return tally;
}

/**
 * 全量「该找谁」榜：把所有缺料项的关键段按**具体责任方**归并（`ownerRef` 指不出来时退回角色）。
 * 排序：累计天数降序 → 命中项数降序 → 显示名（全序确定 · R6，无随机、无时钟）。
 */
export interface KitWhoToCallVM {
  owner: ProcurementOwner;
  ownerLabel: string;
  ownerRef: string | null;
  displayName: string;
  internal: boolean;
  materials: string[];
  totalDays: number;
}

export function buildKitWhoToCall(orders: readonly KitOrderVM[]): KitWhoToCallVM[] {
  const byKey = new Map<string, KitWhoToCallVM>();
  for (const o of orders) {
    for (const it of o.items) {
      const c = it.critical;
      if (c === null) continue;
      const key = `${c.owner}||${c.ownerRef ?? ""}`;
      const hit = byKey.get(key);
      if (hit) {
        if (!hit.materials.includes(it.material)) hit.materials.push(it.material);
        hit.totalDays = round3(hit.totalDays + c.days);
      } else {
        byKey.set(key, {
          owner: c.owner,
          ownerLabel: c.ownerLabel,
          ownerRef: c.ownerRef,
          displayName: c.ownerRef ?? c.ownerLabel,
          internal: c.internal,
          materials: [it.material],
          totalDays: round3(c.days),
        });
      }
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.totalDays - a.totalDays || b.materials.length - a.materials.length || a.displayName.localeCompare(b.displayName),
  );
}

/** 缺料项在订单表里的可读摘要（替掉那坨转义 JSON；明细在下方四段面板，信息不丢）。 */
export function shortItemsSummary(order: KitOrderVM): string {
  const names = [...order.items.map((i) => i.material), ...order.itemsWithoutProcurement];
  if (names.length === 0 && order.unparsedShortItems === 0) return "无缺料项";
  const parts: string[] = [];
  if (names.length > 0) parts.push(`缺 ${names.length} 项：${names.join("、")}`);
  if (order.unparsedShortItems > 0) parts.push(`另有 ${order.unparsedShortItems} 项形状不认识（未渲染）`);
  return parts.join("；");
}

/**
 * 把 `shortItems` 那一列从转义 JSON 换成可读摘要，其余列**逐字节不动**。
 * 明细不丢 —— 全在下方四段面板里（含每项的 earliestDay / coveringEtaDay / 四段 / 责任方 / MOQ）。
 */
export function kitReadableRows(
  columns: readonly string[],
  rows: readonly (readonly Cell[])[],
  orders: readonly KitOrderVM[],
): Cell[][] {
  const idx = columns.indexOf("shortItems");
  return rows.map((row, i) => {
    const next = [...row];
    const order = orders[i];
    if (idx >= 0 && order !== undefined) next[idx] = shortItemsSummary(order);
    return next;
  });
}
