import { z } from "zod";

/**
 * WO-SIM-DRILL-P12 · 推演**演习**契约（事件型扰动 · 事件→求解器路由表 · 统一卡点语义）。
 * 需求 `docs/PRD-sim-drill-parallel-world.md` §4.2 / §4.3 / §4.4。
 *
 * ══ 今天的行为是 X，应该是 Y（开工前**起真 datacore 4071 实测**，原文照录）══════════
 * **X（今天）**：沙盘的推演是**纯数值传导器** —— `propagateTick` 只吃 `world.state` 的
 *   36 个状态变量，沿 `PropagationRule` 扩散。实测 `grep -c "invokeSolver\|solvers\."
 *   apps/datacore/src/sim/propagation.ts` = **0**（金丝雀：同文件 `PropagationRule` = 10 命中
 *   ⇒ 工具没坏，是真的零求解器调用）。于是「把 SO-3391 交期提前 10 天」这种**业务事件**
 *   在沙盘上无从输入：`PerturbationSchema` 只收 `targetObjectId`/`targetStateVar`/`magnitude`，
 *   而交期是日期、不是可拨的数值变量，且 `due` 根本不在 `world.state` 里。
 * **Y（应该）**：业务事件是一等输入 → 按**数据驱动的路由表**分派到对口求解器 → 求解器的
 *   异构输出归一成同一张卡点清单（`DrillFinding`），每条带**诚实位**与溯源。
 *
 * ══ 为什么不扩展 `PerturbationSchema`（PRD §4.2 的理由，实测后仍然成立）══════════════
 * 那是「拨数值」语义，事件是「发生了一件事」。硬塞会让两种语义共用 `magnitude` ——
 * 下一个人读到 `magnitude: 3` 分不清是「+3 天」还是「×3」。故**新增并列的 schema**，
 * 两个输入面各管一段，一个字段都不共用。
 */

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 诚实位（R13「真推演 not 假推演」）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一条结论的**数据模式** —— 它是真算的还是估的。
 *
 * ⚠ **五个值，不是 PRD 写的两个**。PRD §4.4 原文断言「`dataMode`(LIVE/MOCK) —— **四个全带**」，
 * 起真 datacore（4071 · seed 42 · demo 租户）逐个 invoke 实测**四条里三条不成立**：
 *
 * | 求解器 | PRD 声称 | 实测（HTTP 200 回包顶层键） |
 * |---|---|---|
 * | `capacity_forecast` | LIVE/MOCK | `"LIVE"` ✅ 唯一对上的一个 |
 * | `bottleneck_matrix` | LIVE/MOCK | `"MOCK"` ✅ 值对，但 `tightness` 不在顶层（见 §4 注） |
 * | `risk_timeline`     | LIVE/MOCK | **`"PARTIAL"`** —— 第三个值，PRD 未列 |
 * | `sop_reschedule`    | LIVE/MOCK | **`undefined`** —— 该求解器**根本没有这个字段** |
 *
 * 复验命令（本文件的结论全部可这样重跑）：
 *   `curl -X POST :4071/a/v1/solvers/sop_reschedule/invoke -d '{"args":{"targetOrderId":"SO-3391","advanceDays":10}}'`
 *   → 顶层键 = `feasible,verdict,targetOrder,allocation,displaced,cost,residualQty,reconChecks,reconciled,objective,summary`
 *
 * **所以 `UNDECLARED` 是本枚举里最重要的那个值**：它承载「这个求解器没说自己是真是假」。
 * ⛔ **缺 `dataMode` 一律归 `UNDECLARED`，绝不默认成 `LIVE`** —— 默认成 LIVE 就是把
 * 「我不知道」写成「我确认是真的」，正是本仓点名的假绿形态（「我没找到」≠「它不存在」的同族）。
 * 反证在 `sim-drill.seam.test.ts` 靶②：把归一处强制成 `LIVE`，该断言当场红。
 */
export const DrillDataModeSchema = z.enum(["LIVE", "MOCK", "PARTIAL", "EMPTY", "UNDECLARED"]);
export type DrillDataMode = z.infer<typeof DrillDataModeSchema>;

/**
 * 把求解器回包里那个**来路不明**的 `dataMode` 收敛成本枚举 —— **全平台唯一实现**。
 *
 * 归一与展示必须共用同一份判据：各写一套的话，引擎认得 `PARTIAL` 而前端认不得，
 * 屏上就会把一条估算的卡点画成实测的（两套真相源的老形态）。
 */
export function normalizeDrillDataMode(raw: unknown): DrillDataMode {
  const parsed = DrillDataModeSchema.safeParse(raw);
  // ⛔ 这一行是诚实位的咽喉：不认识 / 没有 ⇒ UNDECLARED，**不是** LIVE。
  return parsed.success && parsed.data !== "UNDECLARED" ? parsed.data : "UNDECLARED";
}

/** 这条结论能不能当真值读。`LIVE` 之外一律不能 —— 屏上必须带标记。 */
export function drillDataModeIsTrustworthy(m: DrillDataMode): boolean {
  return m === "LIVE";
}

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 事件型扰动（G-DRILL-3 · PRD §4.2 的 11 类）
// ══════════════════════════════════════════════════════════════════════════

export const DrillEventKindSchema = z.enum([
  "ORDER_RESCHEDULE", // 订单改交期
  "ORDER_CANCEL", // 订单取消
  "ORDER_INSERT", // 临时插单
  "ORDER_RELOCATE", // 改交付地点
  "ORDER_REPRICE", // 改价格
  "MATERIAL_DELAY", // 物料到货延迟
  "MATERIAL_SHORTAGE", // 物料短缺
  "SUPPLIER_SWITCH", // 换供应商
  "EQUIPMENT_FAILURE", // 设备故障
  "CAPACITY_LOSS", // 产能损失
  "FORECAST_BIAS", // 预测偏差
]);
export type DrillEventKind = z.infer<typeof DrillEventKindSchema>;

/**
 * 一次「发生了一件事」。
 *
 * `payload` **刻意是开放 record 而不是判别联合**，理由是「加一个事件要改几处」这个判据：
 * 判别联合 ⇒ 加事件要同时改 ①枚举 ②payload 联合分支 ③路由表 = 三处；
 * 开放 record + §3 的 `payloadKeys` 声明 ⇒ 只改 `DRILL_EVENT_SPECS` **一处**（枚举由它的键推出）。
 * 而校验并没有因此变松：必填键、类型、缺值处置**全部登记在 §3 的规格表里**，由 `validateDrillEvent`
 * 现读现校 —— 校验规则是**数据**，不是散在引擎里的 if。
 */
export const DrillEventSchema = z.object({
  kind: DrillEventKindSchema,
  /** 具体哪一单 / 哪批料 / 哪台设备（真实对象主键，如 `SO-3391`）。 */
  targetObjectId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  /** 第几天发生（**天，不是 tick** —— 换算见 `SimSession.tickDays`）。 */
  effectiveDay: z.number().int().min(0).default(0),
});
export type DrillEvent = z.infer<typeof DrillEventSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 事件 → 求解器路由表（G-DRILL-4 · PRD §4.3 · **数据驱动，不是 if 链**）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一个求解器入参**从哪里取值** —— 声明式，编排器只做解释不做判断。
 *
 * 这是「不许 if 链」那条约束的落点：没有这层声明，编排器就必须写
 * `if (kind === "ORDER_RESCHEDULE") invoke("sop_reschedule", {targetOrderId: ev.targetObjectId, ...})`
 * —— 加一个事件就要改引擎，且撞 R14。
 */
export const DrillArgSourceSchema = z.object({
  /** 求解器那边的入参名。 */
  arg: z.string().min(1),
  /**
   * 取值来源：
   *  · `eventTarget`  = `event.targetObjectId`
   *  · `payloadKey`   = `event.payload[key]`
   *  · `horizonDays`  = 本次演习的时间窗（天）
   *  · `effectiveDay` = `event.effectiveDay`
   */
  from: z.enum(["eventTarget", "payloadKey", "horizonDays", "effectiveDay"]),
  /** `from === "payloadKey"` 时读哪个键；其余来源恒 `null`。 */
  key: z.string().nullable().default(null),
  /** 取不到值时：`true` ⇒ 整条路由跳过并记一条「未能评估」；`false` ⇒ 不传该入参照调。 */
  required: z.boolean().default(false),
});
export type DrillArgSource = z.infer<typeof DrillArgSourceSchema>;

export const DrillRouteSchema = z.object({
  solverKey: z.string().min(1),
  /** `PRIMARY` = 这个事件的主答者；`AUXILIARY` = 补充视角。仅影响排序与展示分组。 */
  role: z.enum(["PRIMARY", "AUXILIARY"]),
  args: z.array(DrillArgSourceSchema),
});
export type DrillRoute = z.infer<typeof DrillRouteSchema>;

/** 一个事件 payload 键的声明（校验规则即数据）。 */
export const DrillPayloadKeySchema = z.object({
  key: z.string().min(1),
  type: z.enum(["string", "number"]),
  required: z.boolean().default(false),
  /** 人话说明，随 `GET /a/v1/sim/drill/catalog` 下发给前端建表单用（前端**不许**自己写一份）。 */
  hint: z.string().default(""),
});
export type DrillPayloadKey = z.infer<typeof DrillPayloadKeySchema>;

export const DrillEventSpecSchema = z.object({
  kind: DrillEventKindSchema,
  /** 人话名。**后端单源** —— 前端从 catalog 端点取，不许硬编码（同 `stateVarNames` 的纪律）。 */
  label: z.string(),
  payloadKeys: z.array(DrillPayloadKeySchema),
  routes: z.array(DrillRouteSchema),
});
export type DrillEventSpec = z.infer<typeof DrillEventSpecSchema>;

/**
 * **任何事件都调**的路由（PRD §4.3 末行）。
 *
 * ⚠ PRD 那一行原文是「`risk_timeline`（horizon = 用户输入的天数） · `concentration_risk`」，
 * 但 `concentration_risk` **实测入不了参**：`POST /a/v1/solvers/concentration_risk/invoke {"args":{}}`
 * → `HTTP 400 VALIDATION_ERROR: concentration_risk 需 startType + path:[{viaField,toType}]`，
 * 而 PRD §2.1 的入参表写的是「`rootType`」—— **该行已过期**。
 * 同理 `shared_bottleneck` 实测需 `resourceType`/`sharedByType`/`viaField`（PRD 写 `upstreamType`/`viaField`）。
 * 两者都要求**本租户本体的具体类型名/字段名**才能调；在这里填死任何一个值都会是
 * 写进应用层的业务常数（破 R14），且换租户即错。
 * ⇒ 故**只登记 `risk_timeline`**，另两个留待前端把本体类型传下来时再接。
 * 这是「PRD 前提不成立就顶回来，不硬造」，不是漏做 —— 缺口在报告里点名。
 */
export const DRILL_UNIVERSAL_ROUTES: readonly DrillRoute[] = [
  {
    solverKey: "risk_timeline",
    role: "AUXILIARY",
    args: [{ arg: "horizon", from: "horizonDays", key: null, required: false }],
  },
];

/**
 * 事件规格总表 —— **加一个新事件只改这里一处**（枚举值由 `DrillEventKindSchema` 保持同步，
 * 而 `assertDrillRoutingTableComplete()` 在契约加载期就把「枚举加了、表没加」打成红）。
 *
 * 每条路由的入参名都**对着真求解器实测过**（不是照 PRD 抄）：
 *  · `sop_reschedule` 实测吃 `targetOrderId` + `advanceDays`/`newDueDate`
 *    （`apps/datacore/src/solvers/sop-reschedule.ts:19-32` 的 `SopRescheduleInput`）；
 *  · `risk_timeline` 实测吃 `horizon`（`solvers/risk.ts:423-435` 的 `RiskTimelineArgs`）；
 *  · `capacity_forecast` 实测**必须**带 `modelId`，否则 400「modelId required」——
 *    故它的 `modelId` 标 `required: true`，取不到就记「未能评估」而不是硬调一次拿 400。
 */
export const DRILL_EVENT_SPECS: readonly DrillEventSpec[] = [
  {
    kind: "ORDER_RESCHEDULE",
    label: "订单改交期",
    payloadKeys: [
      { key: "advanceDays", type: "number", required: false, hint: "提前天数（正数 = 提前）" },
      { key: "newDueDate", type: "string", required: false, hint: "新交期 ISO 日期；给了则优先于提前天数" },
    ],
    routes: [
      {
        solverKey: "sop_reschedule",
        role: "PRIMARY",
        args: [
          { arg: "targetOrderId", from: "eventTarget", key: null, required: true },
          { arg: "advanceDays", from: "payloadKey", key: "advanceDays", required: false },
          { arg: "newDueDate", from: "payloadKey", key: "newDueDate", required: false },
        ],
      },
      { solverKey: "affected_orders", role: "AUXILIARY", args: [] },
    ],
  },
  {
    kind: "ORDER_CANCEL",
    label: "订单取消",
    payloadKeys: [],
    routes: [{ solverKey: "portfolio", role: "PRIMARY", args: [] }],
  },
  {
    kind: "ORDER_INSERT",
    label: "临时插单",
    payloadKeys: [
      { key: "qtyDelta", type: "number", required: false, hint: "插单数量" },
      { key: "modelId", type: "string", required: false, hint: "型号（产能测算必需）" },
    ],
    routes: [
      { solverKey: "portfolio", role: "PRIMARY", args: [] },
      {
        solverKey: "capacity_forecast",
        role: "AUXILIARY",
        args: [
          { arg: "modelId", from: "payloadKey", key: "modelId", required: true },
          { arg: "qty", from: "payloadKey", key: "qtyDelta", required: false },
        ],
      },
    ],
  },
  {
    kind: "ORDER_RELOCATE",
    label: "改交付地点",
    payloadKeys: [{ key: "newLocationId", type: "string", required: false, hint: "新交付地点对象 id" }],
    routes: [{ solverKey: "portfolio", role: "PRIMARY", args: [] }],
  },
  {
    kind: "ORDER_REPRICE",
    label: "订单改价",
    payloadKeys: [{ key: "priceDelta", type: "number", required: false, hint: "单价变动" }],
    routes: [
      {
        solverKey: "order_fullchain",
        role: "PRIMARY",
        args: [{ arg: "so", from: "eventTarget", key: null, required: true }],
      },
    ],
  },
  {
    kind: "MATERIAL_DELAY",
    label: "物料到货延迟",
    payloadKeys: [{ key: "delayDays", type: "number", required: false, hint: "延迟天数" }],
    routes: [
      { solverKey: "supply_demand_gap_attribution", role: "PRIMARY", args: [] },
      {
        solverKey: "order_fullchain",
        role: "AUXILIARY",
        args: [{ arg: "so", from: "eventTarget", key: null, required: true }],
      },
    ],
  },
  {
    kind: "MATERIAL_SHORTAGE",
    label: "物料短缺",
    payloadKeys: [{ key: "qtyDelta", type: "number", required: false, hint: "短缺量" }],
    routes: [{ solverKey: "supply_demand_gap_attribution", role: "PRIMARY", args: [] }],
  },
  {
    kind: "SUPPLIER_SWITCH",
    label: "更换供应商",
    payloadKeys: [{ key: "newSupplierId", type: "string", required: false, hint: "新供应商对象 id" }],
    routes: [{ solverKey: "supply_demand_gap_attribution", role: "PRIMARY", args: [] }],
  },
  {
    kind: "EQUIPMENT_FAILURE",
    label: "设备故障",
    payloadKeys: [{ key: "downDays", type: "number", required: false, hint: "停机天数" }],
    routes: [{ solverKey: "bottleneck_matrix", role: "PRIMARY", args: [] }],
  },
  {
    kind: "CAPACITY_LOSS",
    label: "产能损失",
    payloadKeys: [{ key: "lossPct", type: "number", required: false, hint: "损失百分比" }],
    routes: [{ solverKey: "bottleneck_matrix", role: "PRIMARY", args: [] }],
  },
  {
    kind: "FORECAST_BIAS",
    label: "预测偏差",
    payloadKeys: [
      { key: "biasPct", type: "number", required: false, hint: "偏差百分比" },
      { key: "modelId", type: "string", required: false, hint: "型号（产能测算必需）" },
    ],
    routes: [
      {
        solverKey: "capacity_forecast",
        role: "PRIMARY",
        args: [{ arg: "modelId", from: "payloadKey", key: "modelId", required: true }],
      },
      { solverKey: "supply_demand_gap_attribution", role: "AUXILIARY", args: [] },
    ],
  },
];

/** 事件 → 规格（O(1) 查表；编排器**只**经这里拿路由，不许另建分支）。 */
const SPEC_BY_KIND = new Map<DrillEventKind, DrillEventSpec>(DRILL_EVENT_SPECS.map((s) => [s.kind, s]));

export function drillEventSpec(kind: DrillEventKind): DrillEventSpec | null {
  return SPEC_BY_KIND.get(kind) ?? null;
}

/**
 * 本次事件要调的**全部**求解器（专属路由 + 通用路由，按 solverKey **去重保序**）。
 * 去重口径：同一个 solverKey 只调一次，先登记的那条路由（含其入参声明）胜出 ——
 * 否则 `ORDER_RESCHEDULE` 的 `risk_timeline` 会被通用路由再调一遍，同一条卡点出现两次。
 */
export function drillRoutesFor(kind: DrillEventKind): DrillRoute[] {
  const spec = drillEventSpec(kind);
  const out: DrillRoute[] = [];
  const seen = new Set<string>();
  for (const r of [...(spec?.routes ?? []), ...DRILL_UNIVERSAL_ROUTES]) {
    if (seen.has(r.solverKey)) continue;
    seen.add(r.solverKey);
    out.push(r);
  }
  return out;
}

/**
 * **枚举与路由表必须同覆盖** —— 加了事件却忘了登记路由，在这里当场红，而不是等到用户点了
 * 那个事件、屏上安静地回一句「无卡点」（那正是「报『没算出来』却读作『没有风险』」的形态）。
 * 由 `sim-drill.seam.test.ts` 与 datacore 启动路径共同调用。
 */
export function assertDrillRoutingTableComplete(): void {
  const missing = DrillEventKindSchema.options.filter((k) => !SPEC_BY_KIND.has(k));
  if (missing.length > 0) {
    throw new Error(`DRILL_EVENT_SPECS 缺 ${missing.length} 个事件的路由登记：${missing.join(", ")}`);
  }
  const empty = DRILL_EVENT_SPECS.filter((s) => s.routes.length === 0).map((s) => s.kind);
  if (empty.length > 0) {
    throw new Error(`DRILL_EVENT_SPECS 有事件登记了 0 条路由（会静默无结论）：${empty.join(", ")}`);
  }
}

/** 事件自校验（规则取自 §3 规格表，**不是**散在引擎里的 if）。返回人话错因数组，空 = 通过。 */
export function validateDrillEvent(ev: DrillEvent): string[] {
  const spec = drillEventSpec(ev.kind);
  if (!spec) return [`未登记的事件类型 ${ev.kind}`];
  const errs: string[] = [];
  for (const pk of spec.payloadKeys) {
    const v = ev.payload[pk.key];
    if (v === undefined || v === null) {
      if (pk.required) errs.push(`${spec.label}缺必填字段 ${pk.key}（${pk.hint}）`);
      continue;
    }
    if (pk.type === "number" && (typeof v !== "number" || !Number.isFinite(v))) {
      errs.push(`${spec.label}的 ${pk.key} 必须是有限数，实收 ${JSON.stringify(v)}`);
    }
    if (pk.type === "string" && typeof v !== "string") {
      errs.push(`${spec.label}的 ${pk.key} 必须是字符串，实收 ${JSON.stringify(v)}`);
    }
  }
  return errs;
}

/**
 * 按路由声明**解释**出一次求解器调用的实参（纯函数 · R6）。
 *
 * 返回 `null` = 某个 `required` 入参取不到 ⇒ 调用方**必须**记一条「未能评估」，
 * 不许静默跳过（PRD §4.6 的失败处置：从清单消失 = 把「没算」读成「没事」）。
 */
export function resolveDrillArgs(
  route: DrillRoute,
  ev: DrillEvent,
  horizonDays: number,
): { args: Record<string, unknown>; missing: string[] } | null {
  const args: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const src of route.args) {
    let v: unknown;
    if (src.from === "eventTarget") v = ev.targetObjectId;
    else if (src.from === "horizonDays") v = horizonDays;
    else if (src.from === "effectiveDay") v = ev.effectiveDay;
    else v = src.key === null ? undefined : ev.payload[src.key];
    if (v === undefined || v === null || v === "") {
      if (src.required) missing.push(src.arg);
      continue;
    }
    args[src.arg] = v;
  }
  return missing.length > 0 ? { args, missing } : { args, missing: [] };
}

// ══════════════════════════════════════════════════════════════════════════
// § 4 · 统一卡点语义（G-DRILL-2 + 归一 · PRD §4.4）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 四类，**「未能评估」是其中一等公民**（PRD §4.6 我特意写死的那条）：
 * > 演习报「无卡点」和「没算出来」**必须是两个不同的屏上状态**。
 * 某求解器抛错 ⇒ 记一条 `未能评估`，**不从清单消失**。
 */
export const DrillFindingKindSchema = z.enum(["卡点", "堵点", "脆弱点", "未能评估"]);
export type DrillFindingKind = z.infer<typeof DrillFindingKindSchema>;

export const DrillFindingSchema = z.object({
  /** 稳定键（R6 全序排序的最后一道比较键，保证同输入字节级同序）。 */
  key: z.string(),
  kind: DrillFindingKindSchema,
  /** 0–100，归一到 tightness 口径。「未能评估」恒 0（它不是一个严重度，是一个空洞）。 */
  severity: z.number().min(0).max(100),
  where: z.object({
    objectType: z.string(),
    objectId: z.string(),
    label: z.string(),
  }),
  /** 第几天越线；`null` = 结构性（与时间无关，如堵点）。 */
  when: z.number().nullable(),
  /** 人话（取自 verdict / summary / 错误码，**不编**）。 */
  why: z.string(),
  source: z.object({
    /** 求解器 key，或 `"propagation"` 表示传导引擎现算。 */
    solverKey: z.string(),
    /** ⚠ 诚实位 · 必带 · 缺省一律 `UNDECLARED` 不是 `LIVE`（见 §1）。 */
    dataMode: DrillDataModeSchema,
    /** R13 溯源：这条结论由什么算出来的。 */
    provenance: z.record(z.string(), z.unknown()).default({}),
  }),
  /**
   * `sop_reschedule` 自带的守恒校验位（`Σalloc + residual == qty`）。
   * `false` ⇒ **降级展示，不进主清单**（PRD §4.6）。非该求解器的结论恒 `null` = 不适用。
   */
  reconciled: z.boolean().nullable().default(null),
  /** 原始输出片段，供下钻。 */
  evidence: z.unknown().optional(),
});
export type DrillFinding = z.infer<typeof DrillFindingSchema>;

/**
 * 一次演习的产出。
 *
 * `findings` 已排好**全序**（severity 降序 → when 升序 → key 字典序），
 * 故同输入同种子重跑逐字节一致（R6）。
 */
export const DrillReportSchema = z.object({
  /** 演习跑在哪个世界（R4-sim：必是 fork 出来的仿真世界，不是真实世界）。 */
  worldId: z.string(),
  /** 这份世界从哪个真实快照 fork 来的；`null` = 本次未 fork（无企业快照可用，诚实留白）。 */
  forkedFromStateId: z.string().nullable(),
  horizonDays: z.number().int().min(1),
  tickDays: z.number().int().min(1),
  /** 实际推进了几个 tick = `ceil(horizonDays / tickDays)`。 */
  ticks: z.number().int().min(0),
  events: z.array(DrillEventSchema),
  /** 主清单（`reconciled !== false` 的那些）。 */
  findings: z.array(DrillFindingSchema),
  /** 降级区：守恒未通过的结论（PRD §4.6）——**不删掉**，但不混进主清单。 */
  degraded: z.array(DrillFindingSchema),
  /** 每个被调求解器的回执（真调过 / 报了什么错），前端据此证明「求解器真被调用」。 */
  solverRuns: z.array(
    z.object({
      solverKey: z.string(),
      eventKind: DrillEventKindSchema.nullable(),
      ok: z.boolean(),
      dataMode: DrillDataModeSchema,
      /** 失败时的错误码/原文；成功恒 `null`。 */
      error: z.string().nullable(),
      findingCount: z.number().int().min(0),
    }),
  ),
  /**
   * 全局诚实位汇总。
   * ⚠ **`allFailed` 与「无卡点」是两个不同的屏上状态** —— 前端据此分叉渲染，
   * 绝不把 `allFailed: true` 画成「没有风险」。
   */
  summary: z.object({
    allFailed: z.boolean(),
    trustworthy: z.boolean(), // 全部结论都 LIVE 才为 true
    dataMode: DrillDataModeSchema, // 汇总口径：全 LIVE=LIVE；全 MOCK=MOCK；混合=PARTIAL；无结论=EMPTY
    text: z.string(),
  }),
});
export type DrillReport = z.infer<typeof DrillReportSchema>;

/**
 * 汇总多条结论的 dataMode（**唯一实现**，前后端共用）。
 * 混合 ⇒ `PARTIAL`（不许取「多数」——多数决会把一条 MOCK 悄悄吞掉）。
 */
export function aggregateDrillDataMode(modes: readonly DrillDataMode[]): DrillDataMode {
  if (modes.length === 0) return "EMPTY";
  const uniq = [...new Set(modes)];
  if (uniq.length === 1) return uniq[0]!;
  return "PARTIAL";
}

/**
 * 演习结论的**全序**比较（R6：同输入 → 同序，逐字节可复现）。
 * severity 降序 → when 升序（早出事的在前，`null` 排最后）→ key 字典序兜底。
 */
export function compareDrillFindings(a: DrillFinding, b: DrillFinding): number {
  if (b.severity !== a.severity) return b.severity - a.severity;
  const aw = a.when ?? Number.POSITIVE_INFINITY;
  const bw = b.when ?? Number.POSITIVE_INFINITY;
  if (aw !== bw) return aw - bw;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

// ══════════════════════════════════════════════════════════════════════════
// § 5 · 演习请求（`POST /a/v1/sim/sessions/:id/drill`）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 卡点分位阈值 —— **A 方案（仓主已拍板）：取该变量在世界里的分位数，零配置**。
 * 这两个数**不是业务常数**：它们是统计口径（「最高的 10%」「最高的 5%」），
 * 与行业/租户无关，换电池换汽车都一样。业务常数是「产能利用率超过 85% 算紧张」那种。
 */
export const DRILL_CHOKE_QUANTILE = 0.9; // 卡点：P90 以上
export const DRILL_FRAGILE_QUANTILE = 0.95; // 脆弱点：离 P95 阈值最近的那批

export const DrillRunRequestSchema = z.object({
  events: z.array(DrillEventSchema).default([]),
  /** 推演天数（仓主要的「30 天」）。 */
  horizonDays: z.number().int().min(1).max(365).default(30),
  /** 只跑卡点扫描不调求解器（一期行为）；`true` 时 `events` 可为空。 */
  scanOnly: z.boolean().default(false),
});
export type DrillRunRequest = z.infer<typeof DrillRunRequestSchema>;

/** 事件目录响应（前端建表单用；**标签与校验规则全部后端单源**）。 */
export const DrillCatalogSchema = z.object({
  specs: z.array(DrillEventSpecSchema),
  universalRoutes: z.array(DrillRouteSchema),
});
export type DrillCatalog = z.infer<typeof DrillCatalogSchema>;
