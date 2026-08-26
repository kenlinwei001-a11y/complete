/**
 * WO-PROCUREMENT-FRONTEND · 采购四段腿分解的**前端消费方**（纯模型层，不含 React）。
 *
 * ── 这个文件要治的病 ──────────────────────────────────────────────────────────
 * WO-SANDBOX-D2 已并线：`kit_readiness` 的每个缺料项都带上了按责任方可分解的采购段
 * （`procurement` 四段 / `ownerDays` 责任方汇总 / `criticalLeg` 最该找的那一段）。
 * 但**零前端消费方** —— 引擎算得出「该去找宇部兴产还是找远洋班轮」，界面上一个字都看不见。
 * 本文件 + `ProcurementLegsView.tsx` 就是那条缺失的链路。
 *
 * ── 纪律 ──────────────────────────────────────────────────────────────────────
 *  · **不重定义契约已有类型**（contracts-only-shared）：段/责任方/三态/`ProcurementPlan` 的形状
 *    一律 `import { … } from "@platform/contracts"`。本文件只加**前端表现层**才需要的东西：
 *    中文标签、瀑布几何、以及"engine 给的汇总 vs 契约唯一实现算出来的汇总 对不对得上"这道守卫。
 *  · **总耗时/责任方汇总/关键段一律走契约里的那份唯一实现**
 *    （`procurementTotalDays` / `procurementDaysByOwner` / `criticalProcurementLeg`），
 *    前端**不另写一份加法**。写第二份就会漂 —— 而这个特性漂掉的后果是「界面告诉用户去找错的人」。
 *  · **三态不许画成两态**：`NOT_APPLICABLE`（本段结构上不存在·真值 0 天·有依据）与
 *    `EMPTY`（取不到真值·不知道）在契约里被特意分开，本层必须把这个区别**结构化地**带到 UI，
 *    而不是靠两种颜色（颜色不可断言、色觉障碍用户也读不出）。判据见 `LEG_STATUS_PRESENTATION`。
 *
 * ── 实测与复验（保质期）──────────────────────────────────────────────────────
 * ⚠ 本段是 WO-R5 收编时补的：本文件原稿写于 2026-08-06，其中「零前端消费方」等说法**当时**为真，
 *   但没有日期就没有保质期 —— `scripts/check-stale-claims.mjs`（G-STALE-MEASURED-CLAIM 的机械半）
 *   为此报红，报得对。
 * **2026-08-13 实测**（收编时亲手跑，非沿用原稿说法）：
 *   · `pnpm --filter frontend-shell exec vitest run test/procurement-legs-reachable.test.tsx` → **12/12 通过**
 *   · `node scripts/check-view-reachable.mjs` → 视图模块 75 个 · 孤儿 **0** 个
 *   · 变异反证：撤掉 `views/registry.ts` 里 `registerRenderer("procurement-legs", …)` 那一行
 *     ⇒ 上述 12 例**全红**，且可达门当场报「孤儿 1 个：ProcurementLegsView.tsx」。
 * ⚠ 「零前端消费方」这句自 2026-08-13 起**已不再成立**（本文件自己就是那个消费方）——
 *   上文保留它是为了说明**本文件为什么存在**，不是对今天状态的断言。
 */
import {
  criticalProcurementLeg,
  isValueAddKind,
  PROCUREMENT_LEG_OWNER,
  PROCUREMENT_LEG_STEP_KIND,
  PROCUREMENT_LEGS,
  procurementDaysByOwner,
  procurementTotalDays,
  ProcurementPlanSchema,
  type ProcurementLeg,
  type ProcurementLegKind,
  type ProcurementLegStatus,
  type ProcurementOwner,
  type ProcurementPlan,
} from "@platform/contracts";
import { z } from "zod";
import { formatDays } from "./chainLineMap";

/** 采购四段分解今天唯一的真值来源（引擎 S08）。 */
export const KIT_READINESS_SOLVER_KEY = "kit_readiness";

/**
 * 求解器入参。**刻意不传 `orders`** —— 引擎 `deriveExtendedArgs` 的第一行是
 * `if (has("orders")) return args;`：一旦前端自己造 orders，采购段凭证（`procurement`）
 * 就**根本不会被推导出来**，页面会显示成"这批物料没有采购段"，而真相是我们把它绕过去了。
 * 分析窗口是唯一该由前端定的东西。
 */
export const DEFAULT_KIT_ARGS: Readonly<Record<string, unknown>> = { fromDay: 1, toDay: 14 };

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · 载荷（引擎输出形状 —— 采购段部分直接复用契约 schema，不另写一份）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 责任方汇总（引擎 `procurementDaysByOwner` 的返回形状）。
 * 这是**引擎输出**的形状而非平台契约对象，故在此就地声明；但它的**值**必须与契约的
 * 唯一实现一致，由 `buildItemVM` 当场复核（见 `ownerAgreement`）。
 */
const OwnerDaysSchema = z.object({
  days: z.record(z.string(), z.number()),
  unknownOwners: z.array(z.string()),
});

/** 引擎回传的"最该找的那一段"（`criticalProcurementLeg` 的投影）。 */
const CriticalLegSchema = z.object({
  leg: z.string(),
  owner: z.string(),
  ownerRef: z.string().nullable(),
  days: z.number().nullable(),
});

/**
 * 单个缺料项。`procurement` 用**契约的** `ProcurementPlanSchema` —— 于是引擎哪天把四段合成一个数、
 * 或者拿 0 冒充 EMPTY，前端这里当场解析失败并报出来，而不是把一个错的天数画成一根好看的柱子。
 */
export const ShortItemSchema = z.object({
  material: z.string(),
  ratio: z.number(),
  shortage: z.number(),
  earliestDay: z.number().optional(),
  coveringEtaDay: z.number().nullable().optional(),
  procurement: ProcurementPlanSchema.optional(),
  ownerDays: OwnerDaysSchema.optional(),
  criticalLeg: CriticalLegSchema.nullable().optional(),
});
export type ShortItem = z.infer<typeof ShortItemSchema>;

export const KitRowSchema = z.object({
  orderId: z.string(),
  kitRatio: z.number(),
  shortItems: z.array(ShortItemSchema),
  advice: z.string().optional(),
  earliestKitDay: z.number().nullable(),
  earliestKitDayStatus: z.string().optional(),
  earliestKitDayReason: z.string().optional(),
});
export type KitRow = z.infer<typeof KitRowSchema>;

export const KitReadinessPayloadSchema = z.object({
  rows: z.array(KitRowSchema),
  shortageCount: z.number().optional(),
  ruleRefs: z.array(z.string()).optional(),
});
export type KitReadinessPayload = z.infer<typeof KitReadinessPayloadSchema>;

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 中文标签（表现层·契约里刻意不带 UI 文案 · R14 不内联任何具体供应商/基地名）
// ══════════════════════════════════════════════════════════════════════════════

export const LEG_LABEL: Record<ProcurementLegKind, string> = {
  supplier_production: "供应商生产",
  in_transit: "在途运输",
  customs: "清关",
  incoming_inspection: "到货检验",
};

export const OWNER_LABEL: Record<ProcurementOwner, string> = {
  SUPPLIER: "供应商",
  CARRIER: "承运方",
  CUSTOMS_BROKER: "清关行",
  QUALITY_IQC: "来料检验",
};

/**
 * 「该找谁」的行动指向。`QUALITY_IQC` 单列 —— 契约注释写得很清楚：
 * 「到厂了但压在待检区，**这段是自己的锅**」。把它和三个外部责任方混着显示，
 * 用户会去打一通打不通的电话；这一维决定的是**打给谁**，不是配色。
 */
export const OWNER_IS_INTERNAL: Record<ProcurementOwner, boolean> = {
  SUPPLIER: false,
  CARRIER: false,
  CUSTOMS_BROKER: false,
  QUALITY_IQC: true,
};

/** 该段责任方的对外/对内定性文案（`criticalLeg` 横幅上直接说"去找谁"）。 */
export function ownerActionHint(owner: ProcurementOwner): string {
  return OWNER_IS_INTERNAL[owner] ? "对内：本厂质量部来料检验，这段是自家的锅" : "对外：需要向该责任方催办 / 升级";
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · 三态表现（**本单第 2 条硬要求的落点**）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 三态的表现规格。**关键判据不是颜色，是这三条互不相同的结构性事实**：
 *
 *  | 态                | `known` | 屏上天数        | 说明前缀 | 是否阻断总计 |
 *  |-------------------|---------|-----------------|----------|--------------|
 *  | `MEASURED`        | 是      | 真值（如 18.00 天） | 口径     | 否           |
 *  | `NOT_APPLICABLE`  | 是      | `0 天`（真值）   | 依据     | 否           |
 *  | `EMPTY`           | **否**  | `—`（**绝不写 0**） | 缺       | **是**       |
 *
 * `known` 这一列就是「不适用」与「不知道」的分界：
 *  · `NOT_APPLICABLE` = **知道**它是 0（境内直供本来就没有清关环节，有据可依）；
 *  · `EMPTY`          = **不知道**是多少（拿 0 冒充会让最早齐套日系统性偏早，且偏多少没人看得见）。
 * 二者对**总计**的作用也相反（契约 `procurementTotalDays`：NA 计 0、EMPTY 令总数为 `null`）——
 * 这是"它俩没被画成一样"的**功能性**证据，比任何视觉差异都硬，测试咬的就是这一条。
 */
export interface LegStatusPresentation {
  /** 三态短标签（屏上主显）。 */
  label: string;
  /** 一句话说清这个态**是什么意思**（不是配色说明）。 */
  meaning: string;
  /** 天数是否已知。`EMPTY` 为 false —— UI 据此**拒绝渲染任何数字**。 */
  known: boolean;
  /** `reason` 的前缀（三态各不相同，读者一眼知道这句话在解释什么）。 */
  reasonPrefix: string;
  /** 该段是否会让四段合计不可结算。 */
  blocksTotal: boolean;
}

export const LEG_STATUS_PRESENTATION: Record<ProcurementLegStatus, LegStatusPresentation> = {
  MEASURED: {
    label: "实测",
    meaning: "有真凭证算出来的天数（可下钻到来源对象与字段）",
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
    // ⚠ `meaning` 是**屏上文案**（图例直接渲染它），不是注释 —— 不许写 markdown 强调符，
    //   `**…**` 会原样显示成星号。同族的坑：本文件其余屏上文案同理。
    meaning: "拿不到真值 ⇒ 不知道是多少天，不拿 0 冒充（因此四段合计不可结算）",
    known: false,
    reasonPrefix: "缺",
    blocksTotal: true,
  },
};

/** 屏上天数文案。`EMPTY` 恒 `—`：这是"不许拿 0 冒充"在渲染层的最后一道闸。 */
export function legDaysText(leg: ProcurementLeg): string {
  const pres = LEG_STATUS_PRESENTATION[leg.status];
  if (!pres.known || leg.days === null) return "—";
  return formatDays(leg.days);
}

// ══════════════════════════════════════════════════════════════════════════════
// § 4 · 视图模型
// ══════════════════════════════════════════════════════════════════════════════

export interface LegVM {
  leg: ProcurementLegKind;
  label: string;
  owner: ProcurementOwner;
  ownerLabel: string;
  /** 具体责任方（供应商名 / 承运商 / 清关行 / 检验组）。指不出来 = null，**不编一个名字**。 */
  ownerRef: string | null;
  status: ProcurementLegStatus;
  presentation: LegStatusPresentation;
  days: number | null;
  daysText: string;
  reason: string | null;
  /** 真值出处（R13 悬浮即出「哪个对象类型 · 哪些 id · 哪个字段」）。非 MEASURED 恒 null。 */
  source: { objectType: string; objectIds: string[]; field: string } | null;
  /** 瀑布条宽度百分比（0–100）。天数未知 ⇒ 0（不画一根凭空的柱子）。 */
  widthPct: number;
  /** 本段是否增值（走契约 `isValueAddKind` + `PROCUREMENT_LEG_STEP_KIND`，前端不另立判据）。 */
  valueAdd: boolean;
  /** 是否本单的关键段（最该找的那一段）。 */
  critical: boolean;
}

/** 「engine 给的汇总」与「契约唯一实现算出来的汇总」是否对得上。 */
export type Agreement = "AGREE" | "MISMATCH" | "ENGINE_ABSENT";

export interface OwnerRollupVM {
  owner: ProcurementOwner;
  ownerLabel: string;
  days: number;
  /** 占**已知**四段合计的比例（0–100）；合计不可结算时为 null。 */
  pctOfTotal: number | null;
  internal: boolean;
}

export interface CriticalVM {
  leg: ProcurementLegKind;
  legLabel: string;
  owner: ProcurementOwner;
  ownerLabel: string;
  ownerRef: string | null;
  days: number;
  daysText: string;
  /** 占已知四段合计的比例（0–100）；合计不可结算 → null。 */
  pctOfTotal: number | null;
  actionHint: string;
  internal: boolean;
}

export interface ItemVM {
  material: string;
  shortage: number;
  ratio: number;
  supplierId: string | null;
  supplierName: string | null;
  legs: LegVM[];
  /** 四段合计。任一段 EMPTY → null（契约口径，前端不另算）。 */
  totalDays: number | null;
  complete: boolean;
  /** 令合计不可结算的那些段（`EMPTY`）。合计可结算时为空数组。 */
  blockingLegs: ProcurementLegKind[];
  ownerRollup: OwnerRollupVM[];
  /** 天数未知、因而**不摊到任何人头上**的责任方（契约 `unknownOwners`）。 */
  unknownOwners: ProcurementOwner[];
  critical: CriticalVM | null;
  /** 引擎下发的 `criticalLeg` 与契约唯一实现是否一致（不一致 ⇒ UI 当面报，不静默择一）。 */
  criticalAgreement: Agreement;
  /** 引擎下发的 `ownerDays` 与契约唯一实现是否一致。 */
  ownerAgreement: Agreement;
  /** 增值天数（只有 `supplier_production` 是 `work`）；合计不可结算 → null。 */
  valueAddDays: number | null;
  /** MOQ / 准时率 / 承诺 vs 期望 —— D2 把这四个此前零消费方的字段接上了线。 */
  minOrderQty: number | null;
  replenishQty: number | null;
  moqApplied: boolean;
  onTimeRate: number | null;
  expectedSlipDays: number | null;
  earliestKitDay: number | null;
  expectedKitDay: number | null;
}

export interface OrderVM {
  orderId: string;
  kitRatio: number;
  advice: string | null;
  earliestKitDay: number | null;
  earliestKitDayStatus: string | null;
  earliestKitDayReason: string | null;
  /** 带采购四段分解的缺料项。 */
  items: ItemVM[];
  /** 缺料但引擎**没给**采购段的物料（诚实列出，不假装它们不存在）。 */
  itemsWithoutProcurement: string[];
}

const roundPct = (v: number): number => Math.round(v * 1000) / 1000;

/** 引擎 `ownerDays.days` 与契约 `procurementDaysByOwner` 的逐键比对（浮点按 1e-6 容差）。 */
function sameOwnerDays(a: Record<string, number>, b: Partial<Record<ProcurementOwner, number>>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => Math.abs((a[k] ?? 0) - (b[k as ProcurementOwner] ?? 0)) < 1e-6);
}

/**
 * 一个缺料项 → 视图模型。
 *
 * **总耗时 / 责任方汇总 / 关键段全部经契约的唯一实现重算**，引擎下发的同名字段只用来**对账**：
 * 一致 → `AGREE`；不一致 → `MISMATCH`（UI 当面报出，让人去查引擎，而不是前端偷偷选一个显示）。
 * 「该找谁」答错的代价是用户打错电话 —— 这里不给静默择一留口子。
 */
export function buildItemVM(item: ShortItem): ItemVM | null {
  const plan: ProcurementPlan | undefined = item.procurement;
  if (plan === undefined) return null;

  const legs = plan.leadTime.legs;
  // 契约唯一实现（前端不另写加法）
  const total = procurementTotalDays(legs);
  const rollup = procurementDaysByOwner(legs);
  const critical = criticalProcurementLeg(legs);

  const pctOf = (days: number): number | null => (total === null || total <= 0 ? null : roundPct((days / total) * 100));

  const legVMs: LegVM[] = PROCUREMENT_LEGS.map((kind) => {
    const l = legs.find((x) => x.leg === kind);
    // 契约 schema 已经锁死四段齐全（`.length(4)` + 逐段存在性 superRefine），解析得过就不可能缺段；
    // 这里若真拿到 undefined，说明解析被绕过了 —— 宁可当场抛，也不补一段看着合理的空腿。
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
      daysText: legDaysText(l),
      reason: l.reason ?? null,
      source: l.source,
      // 天数未知 ⇒ 宽度 0：**不画一根凭空的柱子**（画了就等于把"不知道"渲染成了某个具体长度）。
      widthPct: !pres.known || l.days === null || total === null || total <= 0 ? 0 : roundPct((l.days / total) * 100),
      valueAdd: isValueAddKind(PROCUREMENT_LEG_STEP_KIND[kind]),
      critical: critical !== null && critical.leg === kind,
    };
  });

  const criticalVM: CriticalVM | null =
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
  const criticalAgreement: Agreement =
    engineCritical === undefined
      ? "ENGINE_ABSENT"
      : (engineCritical?.leg ?? null) === (critical?.leg ?? null) && (engineCritical?.owner ?? null) === (critical?.owner ?? null)
        ? "AGREE"
        : "MISMATCH";

  const engineOwnerDays = item.ownerDays;
  const ownerAgreement: Agreement =
    engineOwnerDays === undefined ? "ENGINE_ABSENT" : sameOwnerDays(engineOwnerDays.days, rollup.days) ? "AGREE" : "MISMATCH";

  const ownerRollup: OwnerRollupVM[] = PROCUREMENT_LEGS.map((k) => PROCUREMENT_LEG_OWNER[k])
    .filter((o, i, arr) => arr.indexOf(o) === i)
    .filter((o) => rollup.days[o] !== undefined)
    .map((o) => ({
      owner: o,
      ownerLabel: OWNER_LABEL[o],
      days: rollup.days[o] as number,
      pctOfTotal: pctOf(rollup.days[o] as number),
      internal: OWNER_IS_INTERNAL[o],
    }));

  const valueAddDays = total === null ? null : legVMs.filter((l) => l.valueAdd).reduce((s, l) => s + (l.days ?? 0), 0);

  return {
    material: item.material,
    shortage: item.shortage,
    ratio: item.ratio,
    supplierId: plan.supplierId,
    supplierName: plan.supplierName,
    legs: legVMs,
    totalDays: total,
    complete: plan.leadTime.complete,
    blockingLegs: legVMs.filter((l) => l.presentation.blocksTotal).map((l) => l.leg),
    ownerRollup,
    unknownOwners: rollup.unknownOwners,
    critical: criticalVM,
    criticalAgreement,
    ownerAgreement,
    valueAddDays,
    minOrderQty: plan.minOrderQty,
    replenishQty: plan.replenishQty,
    moqApplied: plan.moqApplied,
    onTimeRate: plan.onTimeRate,
    expectedSlipDays: plan.expectedSlipDays,
    earliestKitDay: plan.earliestKitDay,
    expectedKitDay: plan.expectedKitDay,
  };
}

export function buildOrderVMs(payload: KitReadinessPayload): OrderVM[] {
  return payload.rows.map((r) => {
    const items: ItemVM[] = [];
    const without: string[] = [];
    for (const it of r.shortItems) {
      const vm = buildItemVM(it);
      if (vm === null) without.push(it.material);
      else items.push(vm);
    }
    return {
      orderId: r.orderId,
      kitRatio: r.kitRatio,
      advice: r.advice ?? null,
      earliestKitDay: r.earliestKitDay,
      earliestKitDayStatus: r.earliestKitDayStatus ?? null,
      earliestKitDayReason: r.earliestKitDayReason ?? null,
      items,
      itemsWithoutProcurement: without,
    };
  });
}

/**
 * 全量「该找谁」榜：把所有缺料项的关键段按**具体责任方**归并（`ownerRef` 指不出来时退回角色）。
 * 这是整页的落点 —— 用户要的不是"晚了 36 天"，是"今天该打哪几通电话、按什么顺序打"。
 * 排序：累计天数降序 → 命中项数降序 → 责任方名（全序确定 · R6，无随机、无时钟）。
 */
export interface WhoToCallVM {
  owner: ProcurementOwner;
  ownerLabel: string;
  ownerRef: string | null;
  /** 显示名：具体责任方优先，指不出来则退回角色标签（**不编一个名字**）。 */
  displayName: string;
  internal: boolean;
  /** 该责任方作为关键段出现的物料。 */
  materials: string[];
  /** 这些关键段的天数合计。 */
  totalDays: number;
}

export function buildWhoToCall(orders: readonly OrderVM[]): WhoToCallVM[] {
  const byKey = new Map<string, WhoToCallVM>();
  for (const o of orders) {
    for (const it of o.items) {
      const c = it.critical;
      if (c === null) continue;
      const key = `${c.owner}||${c.ownerRef ?? ""}`;
      const hit = byKey.get(key);
      if (hit) {
        if (!hit.materials.includes(it.material)) hit.materials.push(it.material);
        hit.totalDays = roundPct(hit.totalDays + c.days);
      } else {
        byKey.set(key, {
          owner: c.owner,
          ownerLabel: c.ownerLabel,
          ownerRef: c.ownerRef,
          displayName: c.ownerRef ?? c.ownerLabel,
          internal: c.internal,
          materials: [it.material],
          totalDays: roundPct(c.days),
        });
      }
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.totalDays - a.totalDays || b.materials.length - a.materials.length || a.displayName.localeCompare(b.displayName),
  );
}

/** 三态在**本次结果里**各出现了多少次（页首"三态都在场"的自陈，也是测试的锚）。 */
export function statusTally(orders: readonly OrderVM[]): Record<ProcurementLegStatus, number> {
  const tally: Record<ProcurementLegStatus, number> = { MEASURED: 0, NOT_APPLICABLE: 0, EMPTY: 0 };
  for (const o of orders) for (const it of o.items) for (const l of it.legs) tally[l.status] += 1;
  return tally;
}
