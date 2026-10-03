/**
 * WO-SANDBOX-D2 · 采购段凭证契约（`chain-sim.ts` 文件头「本单**不**冻结」里点名留给 D2 的那一条：
 * 「采购段凭证对象（`SupplierLeadTime`/`MOQ`/`ASN`…）→ D2 单」）。
 *
 * ── 这份文件要治的病 ────────────────────────────────────────────────────────
 * 采购段的耗时此前在引擎里是**一个合成数字**：`solvers/extended.ts deriveExtendedArgs` 把
 * `Material.leadTime`（合成时 `7 + rng()*21` 的一个标量）当成在途 ETA 塞进齐套判定
 * （`inTransit: [{ qty, etaDay: num(m.leadTime, 10) }]`）。于是缺料时只能回答"晚了"，
 * **回答不了"该找谁"**——供应商没排产？货在路上？卡在海关？还是到厂堆在待检区？
 *
 * 本文件把采购段拆成**四段按责任方可归属**的腿（leg），并把「怎么算总耗时」定死成一份唯一实现：
 *
 *      采购总耗时 = 供应商生产 + 在途 + 清关 + 到货检验
 *                   └SUPPLIER┘  └CARRIER┘ └BROKER┘ └QUALITY_IQC┘
 *
 * ── 纪律（与 `chain-sim.ts` 同族）────────────────────────────────────────────
 *  · **zod 4 strict**：全部 `z.strictObject` —— 少写字段抛、**多写字段也抛**。
 *  · **禁止静默兜底**：取不到真值一律 `status:"EMPTY"` + `days:null` + `reason`，
 *    **绝不返回一个看着合理的 0**。这是本仓「静默错答比跑不通更糟」的血教训的直接落点：
 *    一个假的 `customsDays: 0` 会让"最早齐套日"整整早若干天，而界面上完全看不出来。
 *  · **三态而非两态**：`MEASURED` / `NOT_APPLICABLE` / `EMPTY`。
 *    境内直供**本来就没有清关环节** —— 那是 `NOT_APPLICABLE`（真值 0 天，有据可依），
 *    不是 `EMPTY`（不知道）。把这两者混成一个 `0` 正是"假默认值"的典型形态。
 *  · **R6 确定性**：本文件全是纯函数与常量，无 `Date.now`、无随机、无时钟。
 *  · **R14**：本文件不内联任何供应商名 / 基地名 / 物料名 —— 只登记「段 → 责任方」这层**结构**，
 *    具体责任方（哪家供应商 / 哪家清关行 / 哪个检验组）由数据侧对象携带（`ownerRef`）。
 *
 * ── 反证锁（本单交付判据「变异反证」的落点）──────────────────────────────
 * `ProcurementLeadTimeSchema` 用 superRefine **硬绑** `totalDays === procurementTotalDays(legs)`
 * 且 `legs` 必须四段齐全、每段一个不同的 leg。所以"把四段耗时合成一个数"这件事在契约层就过不去：
 * 少一段 → `.length(4)` 抛；段合并 → 重复/缺失 leg 抛；总数自己编 → 等式抛。
 */
import { z } from "zod";
import type { ChainStepKind } from "./chain-sim.js";

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 四段（leg）与责任方（owner）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 采购段的四条腿。**顺序即物流顺序**（下单 → 发货 → 到港 → 放行 → 可投产），
 * `procurementTotalDays` 与前端瀑布图都按本数组顺序展开。
 */
export const PROCUREMENT_LEGS = ["supplier_production", "in_transit", "customs", "incoming_inspection"] as const;
export const ProcurementLegKindSchema = z.enum(PROCUREMENT_LEGS);
export type ProcurementLegKind = (typeof PROCUREMENT_LEGS)[number];

/**
 * 责任方（"晚了该找谁"）。这是本单**存在的理由**：一个合成的总天数回答不了这个问题。
 *  · `SUPPLIER`       供应商（没排产 / 产能不够 / 原料自己也缺）
 *  · `CARRIER`        承运方（船期 / 陆运 / 中转）
 *  · `CUSTOMS_BROKER` 清关行 & 海关（申报、查验、放行）
 *  · `QUALITY_IQC`    自家质量部来料检验（到厂了但压在待检区，**这段是自己的锅**）
 */
export const PROCUREMENT_OWNERS = ["SUPPLIER", "CARRIER", "CUSTOMS_BROKER", "QUALITY_IQC"] as const;
export const ProcurementOwnerSchema = z.enum(PROCUREMENT_OWNERS);
export type ProcurementOwner = (typeof PROCUREMENT_OWNERS)[number];

/** 段 → 责任方的**唯一登记册**。各处禁止再写一份映射（写第二份就会漂）。 */
export const PROCUREMENT_LEG_OWNER: Record<ProcurementLegKind, ProcurementOwner> = {
  supplier_production: "SUPPLIER",
  in_transit: "CARRIER",
  customs: "CUSTOMS_BROKER",
  incoming_inspection: "QUALITY_IQC",
};

/**
 * 段 → `chain-sim.ts` 五段环节 `ChainStepKind` 的投影（**复用既有增值判据单源，不新造第二套**，RL10）。
 * 判据：`chain-sim.ts` 里 **只有 `work` 是增值**。据此：
 *  · `supplier_production` → `work`    —— 物料真的在被制造出来，增值。
 *  · `in_transit`          → `handoff` —— 只换地点/换承运，位移不增值。
 *  · `customs`             → `queue`   —— 等海关/清关行放行，排队等资源。
 *  · `incoming_inspection` → `queue`   —— 等自家检验资源放行；精益口径下**检验不增值**
 *    （它不改变物料本身，只是确认它）。谁要把它改成 `work`，得先改本注释。
 */
export const PROCUREMENT_LEG_STEP_KIND: Record<ProcurementLegKind, ChainStepKind> = {
  supplier_production: "work",
  in_transit: "handoff",
  customs: "queue",
  incoming_inspection: "queue",
};

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 一条腿（ProcurementLeg）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 三态。**混成两态就会造出假默认值**：
 *  · `MEASURED`        有真凭证算出来的天数（`source` 必须指得出是哪个对象的哪个字段 · R13）。
 *  · `NOT_APPLICABLE`  这段**结构上不存在** → 真值就是 0 天，且必须说清依据
 *                      （例：供应商为境内直供 ⇒ 没有清关环节）。
 *  · `EMPTY`           取不到真值 → `days:null`。**不许拿 0 冒充**。
 */
export const PROCUREMENT_LEG_STATUSES = ["MEASURED", "NOT_APPLICABLE", "EMPTY"] as const;
export const ProcurementLegStatusSchema = z.enum(PROCUREMENT_LEG_STATUSES);
export type ProcurementLegStatus = (typeof PROCUREMENT_LEG_STATUSES)[number];

/** 真值出处（R13：悬浮即出「来源系统 · 哪个对象 · 哪个字段」）。 */
export const ProcurementLegSourceSchema = z.strictObject({
  /** 对象类型键（如 `Supplier` / `CustomsClearance` / `IncomingInspection`）。 */
  objectType: z.string().min(1),
  /** 真正被读到的对象 id 全集（多条记录取聚合时列全，便于当场下钻核对）。 */
  objectIds: z.array(z.string().min(1)).min(1),
  /** 读的哪个字段 / 哪条派生式（如 `leadTime` / `clearedDay-declaredDay`）。 */
  field: z.string().min(1),
});
export type ProcurementLegSource = z.infer<typeof ProcurementLegSourceSchema>;

export const ProcurementLegSchema = z
  .strictObject({
    leg: ProcurementLegKindSchema,
    /** 责任方角色。硬绑 `PROCUREMENT_LEG_OWNER[leg]`，见下 superRefine ①。 */
    owner: ProcurementOwnerSchema,
    /** 具体责任方（供应商名 / 承运商 / 清关行 / 检验组）。指不出来 = `null`，**不编一个名字**。 */
    ownerRef: z.string().min(1).nullable(),
    /** 该段耗时（天）。`EMPTY` ⇒ `null`；`NOT_APPLICABLE` ⇒ `0`。 */
    days: z.number().nonnegative().nullable(),
    status: ProcurementLegStatusSchema,
    /** 非 `MEASURED` 时**必填**：为什么不是实测。`MEASURED` 时可选（用于说明聚合口径）。 */
    reason: z.string().min(1).optional(),
    /** 真值出处。`MEASURED` 必须有；其余必须为 `null`（没读到东西就别装作读到了）。 */
    source: ProcurementLegSourceSchema.nullable(),
  })
  .superRefine((l, ctx) => {
    // ① 责任方不是可独立编辑的旋钮
    const expectedOwner = PROCUREMENT_LEG_OWNER[l.leg];
    if (l.owner !== expectedOwner) {
      ctx.addIssue({
        code: "custom",
        path: ["owner"],
        message: `owner 必须 == PROCUREMENT_LEG_OWNER[leg]：leg="${l.leg}" ⇒ owner 应为 ${expectedOwner}，收到 ${l.owner}`,
      });
    }
    // ② 三态与 days/source/reason 的硬绑（这三条就是"禁止假默认值"的可执行形态）
    if (l.status === "MEASURED") {
      if (l.days === null) ctx.addIssue({ code: "custom", path: ["days"], message: `status=MEASURED 必须给出天数（days 不得为 null）` });
      if (l.source === null) ctx.addIssue({ code: "custom", path: ["source"], message: `status=MEASURED 必须给出真值出处 source（R13 可溯源）` });
    }
    if (l.status === "NOT_APPLICABLE") {
      if (l.days !== 0) ctx.addIssue({ code: "custom", path: ["days"], message: `status=NOT_APPLICABLE 表示该段结构上不存在 ⇒ days 必须为 0（收到 ${String(l.days)}）` });
      if (l.reason === undefined) ctx.addIssue({ code: "custom", path: ["reason"], message: `status=NOT_APPLICABLE 必须说清依据（为什么这段不存在）` });
      if (l.source !== null) ctx.addIssue({ code: "custom", path: ["source"], message: `status=NOT_APPLICABLE 不得携带 source（没读到任何凭证）` });
    }
    if (l.status === "EMPTY") {
      if (l.days !== null) ctx.addIssue({ code: "custom", path: ["days"], message: `status=EMPTY 表示取不到真值 ⇒ days 必须为 null，**不许拿 0 冒充**（收到 ${String(l.days)}）` });
      if (l.reason === undefined) ctx.addIssue({ code: "custom", path: ["reason"], message: `status=EMPTY 必须说清缺什么（缺哪个对象 / 哪个字段）` });
      if (l.source !== null) ctx.addIssue({ code: "custom", path: ["source"], message: `status=EMPTY 不得携带 source` });
    }
  });
export type ProcurementLeg = z.infer<typeof ProcurementLegSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 四段合计（ProcurementLeadTime）—— 本单的核心判据
// ══════════════════════════════════════════════════════════════════════════

/**
 * 采购总耗时的**唯一实现**。
 *
 *   · 四段必须齐全且**互不重复**（`legs` 覆盖 `PROCUREMENT_LEGS` 全集）；否则 `null`。
 *   · 任一段 `EMPTY` → 总数 `null`（**不知道就是不知道**；拿已知三段之和冒充总数
 *     会让"最早齐套日"系统性偏早，而且偏多少没人看得见）。
 *   · `NOT_APPLICABLE` 计 0（真值，有据可依）。
 */
export function procurementTotalDays(legs: readonly ProcurementLeg[]): number | null {
  const byLeg = new Map<ProcurementLegKind, ProcurementLeg>();
  for (const l of legs) {
    if (byLeg.has(l.leg)) return null; // 同一段出现两次 = 口径已经歪了
    byLeg.set(l.leg, l);
  }
  let total = 0;
  for (const kind of PROCUREMENT_LEGS) {
    const l = byLeg.get(kind);
    if (l === undefined) return null; // 缺段
    if (l.days === null) return null; // EMPTY
    total += l.days;
  }
  return total;
}

/**
 * **ProcurementLeadTime**：一次（现实或拟议的）补货的四段分解。
 *
 * `totalDays` 保留为显式字段是为了载荷自解释（前端不必反查规则），但它**不是**可独立编辑的旋钮 ——
 * superRefine 硬绑 `totalDays === procurementTotalDays(legs)`。
 * 这正是本单「变异反证」咬的那颗牙：把四段合成一个数，这里当场抛。
 */
export const ProcurementLeadTimeSchema = z
  .strictObject({
    legs: z.array(ProcurementLegSchema).length(PROCUREMENT_LEGS.length),
    /** 四段合计（天）。四段不全 / 任一段 EMPTY → `null`。 */
    totalDays: z.number().nonnegative().nullable(),
    /** 四段是否全部可结算（== `totalDays !== null`）。 */
    complete: z.boolean(),
  })
  .superRefine((lt, ctx) => {
    const kinds = lt.legs.map((l) => l.leg);
    for (const kind of PROCUREMENT_LEGS) {
      if (!kinds.includes(kind)) {
        ctx.addIssue({ code: "custom", path: ["legs"], message: `采购段必须四段齐全（按责任方可分解），缺 leg="${kind}"` });
      }
    }
    if (new Set(kinds).size !== kinds.length) {
      ctx.addIssue({ code: "custom", path: ["legs"], message: `同一 leg 不得出现两次（收到 ${kinds.join(",")}）` });
    }
    const expected = procurementTotalDays(lt.legs);
    if (lt.totalDays !== expected) {
      ctx.addIssue({
        code: "custom",
        path: ["totalDays"],
        message: `totalDays 必须 == procurementTotalDays(legs)（四段之和 / 任一段 EMPTY 则 null）：期望 ${String(expected)}，收到 ${String(lt.totalDays)}`,
      });
    }
    if (lt.complete !== (expected !== null)) {
      ctx.addIssue({ code: "custom", path: ["complete"], message: `complete 必须 == (totalDays !== null)` });
    }
  });
export type ProcurementLeadTime = z.infer<typeof ProcurementLeadTimeSchema>;

/** 从四段构造（`totalDays`/`complete` 一律派生，**禁止手填**）。 */
export function makeProcurementLeadTime(legs: readonly ProcurementLeg[]): ProcurementLeadTime {
  const total = procurementTotalDays(legs);
  return { legs: [...legs], totalDays: total, complete: total !== null };
}

/**
 * 按责任方汇总（"这单晚的天数里，谁占了多少"）。
 * 只汇总 `MEASURED`；`NOT_APPLICABLE` 计 0；`EMPTY` 计入 `unknownOwners`（**不摊进任何人头上**）。
 */
export function procurementDaysByOwner(legs: readonly ProcurementLeg[]): { days: Partial<Record<ProcurementOwner, number>>; unknownOwners: ProcurementOwner[] } {
  const days: Partial<Record<ProcurementOwner, number>> = {};
  const unknown: ProcurementOwner[] = [];
  for (const l of legs) {
    if (l.days === null) {
      if (!unknown.includes(l.owner)) unknown.push(l.owner);
      continue;
    }
    days[l.owner] = (days[l.owner] ?? 0) + l.days;
  }
  return { days, unknownOwners: unknown };
}

/**
 * 关键段（"最该找的那一个"）= `MEASURED` 段里天数最大的一段。
 * 并列时按 `PROCUREMENT_LEGS` 顺序取靠前者（全序确定 · R6）。四段无一 `MEASURED` → `null`。
 */
export function criticalProcurementLeg(legs: readonly ProcurementLeg[]): ProcurementLeg | null {
  let best: ProcurementLeg | null = null;
  for (const kind of PROCUREMENT_LEGS) {
    const l = legs.find((x) => x.leg === kind);
    if (l === undefined || l.status !== "MEASURED" || l.days === null) continue;
    if (best === null || l.days > (best.days ?? -1)) best = l;
  }
  return best;
}

// ══════════════════════════════════════════════════════════════════════════
// § 4 · ProcurementPlan（拟议补货：四段 + 起订量 + 准时率）
// ══════════════════════════════════════════════════════════════════════════

/**
 * **ProcurementPlan**：缺料时"补这一票要多久、买多少、找谁"的完整答案。
 *
 * 两个此前**在 `solvers/` 零消费方**的供应商字段在这里真正接上线（本单任务 ①，已实测复验）：
 *  · `minOrderQty`（最小起订量）→ `replenishQty = max(缺口, MOQ)`。缺 3 吨但起订 1000 → 就得买 1000。
 *    此前齐套判定只说"缺 3 吨"，采购一下单才发现是 1000 —— 资金/库存口径当场错。
 *  · `onTimeRate`（准时交付率）→ `expectedSlipDays = 供应商段承诺天 × (1 − onTimeRate)`。
 *    **模型说明**（不许换成别的又不改这段注释）：把"不准时"建模为**期望滑期**——
 *    承诺前置期 L 的单子，以 `1−onTimeRate` 的比例发生滑期，滑期规模按 L 等比例计。
 *    这不引入任何魔法常数（无 R14 违规），且 `onTimeRate=1` ⇒ 滑期 0（退化正确）。
 *    `earliestKitDay` 是**承诺口径**（乐观），`expectedKitDay` 是**含准时率风险口径**——
 *    两个都给，让用户看得见"承诺 vs 期望"的差，而不是偷偷把风险揉进一个数。
 */
export const ProcurementPlanSchema = z
  .strictObject({
    /** 补货走的供应商。指不出来 = `null`（此时 `leadTime.legs` 里供应商段必为 `EMPTY`）。 */
    supplierId: z.string().min(1).nullable(),
    supplierName: z.string().min(1).nullable(),
    /** 四段分解（本单核心判据）。 */
    leadTime: ProcurementLeadTimeSchema,
    /** 起订量门槛（`Supplier.minOrderQty`）。无供应商 → `null`。 */
    minOrderQty: z.number().nonnegative().nullable(),
    /** 净缺口（还差多少）。 */
    shortage: z.number().nonnegative(),
    /** 实际补货量 = `max(shortage, minOrderQty)`。MOQ 取不到 → `null`（**不拿缺口冒充采购量**）。 */
    replenishQty: z.number().nonnegative().nullable(),
    /** MOQ 是否抬高了采购量（`minOrderQty > shortage`）。MOQ 取不到 → `false` 且 `replenishQty` 为 null。 */
    moqApplied: z.boolean(),
    /** 供应商准时交付率（`Supplier.onTimeRate`）。取不到 → `null`。 */
    onTimeRate: z.number().min(0).max(1).nullable(),
    /** 期望滑期天 = 供应商段天数 × (1 − onTimeRate)。任一输入缺 → `null`。 */
    expectedSlipDays: z.number().nonnegative().nullable(),
    /** 起采日（相对天，= 分析窗起点）。 */
    orderPlacedDay: z.number(),
    /** 最早齐套日（承诺口径）= `orderPlacedDay + totalDays`。四段不全 → `null`。 */
    earliestKitDay: z.number().nullable(),
    /** 期望齐套日（含准时率风险）= `earliestKitDay + expectedSlipDays`。任一缺 → `null`。 */
    expectedKitDay: z.number().nullable(),
  })
  .superRefine((p, ctx) => {
    const total = p.leadTime.totalDays;
    const expectedEarliest = total === null ? null : p.orderPlacedDay + total;
    if (p.earliestKitDay !== expectedEarliest) {
      ctx.addIssue({
        code: "custom",
        path: ["earliestKitDay"],
        message: `earliestKitDay 必须 == orderPlacedDay + leadTime.totalDays（四段不全则 null）：期望 ${String(expectedEarliest)}，收到 ${String(p.earliestKitDay)}`,
      });
    }
    const expectedExpected = p.earliestKitDay === null || p.expectedSlipDays === null ? null : p.earliestKitDay + p.expectedSlipDays;
    if (p.expectedKitDay !== expectedExpected) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedKitDay"],
        message: `expectedKitDay 必须 == earliestKitDay + expectedSlipDays（任一缺则 null）：期望 ${String(expectedExpected)}，收到 ${String(p.expectedKitDay)}`,
      });
    }
    const expectedReplenish = p.minOrderQty === null ? null : Math.max(p.shortage, p.minOrderQty);
    if (p.replenishQty !== expectedReplenish) {
      ctx.addIssue({
        code: "custom",
        path: ["replenishQty"],
        message: `replenishQty 必须 == max(shortage, minOrderQty)（MOQ 缺则 null）：期望 ${String(expectedReplenish)}，收到 ${String(p.replenishQty)}`,
      });
    }
    const expectedMoqApplied = p.minOrderQty !== null && p.minOrderQty > p.shortage;
    if (p.moqApplied !== expectedMoqApplied) {
      ctx.addIssue({ code: "custom", path: ["moqApplied"], message: `moqApplied 必须 == (minOrderQty !== null && minOrderQty > shortage)` });
    }
  });
export type ProcurementPlan = z.infer<typeof ProcurementPlanSchema>;
