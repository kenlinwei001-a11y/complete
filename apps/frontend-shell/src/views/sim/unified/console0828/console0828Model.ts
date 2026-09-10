/**
 * ══ WO-SIM-CONSOLE-0828 · 区③ / ③b / ④ 的**判据层**（零 React、零取数）═══════════
 *
 * 设计稿 `docs/design/UI-sim-console-20260828.html`（md5 `b6e2ce7b365e4d3d7ca01135db83e426`，
 * 38,215 字节）区③「钱上差多少」· 区③b「落在谁头上」· 区④「哪儿会出事」。
 *
 * ══ ⛔ 本文件最重要的一条纪律：**没有的钱不许编出来** ═══════════════════════════
 *
 * 设计稿区③ 画的是「毛利 118.9 亿 → 62.4 亿，少 56.5 亿」。**这三个数今天算不出来**，
 * 而且**稿子自己就知道**——它页脚白纸黑字写着：
 *   > 「毛利那三个数今天引擎有已知缺陷，按『这次算不出来』降级上线。」
 * 并且它把「少收的钱」那一行**已经**画成了删除线（`class="nocalc"`）。
 *
 * ── 今天的行为是 X（2026-09-10 真后端实测，我自己那个 datacore :42317）────────────
 * 推演世界里 **500 个 `obj_order_*` 共 2000 个数值格，全部是 0–100 的压力数**
 * （`costPressure` / `demandPressure` / `orderChurn` / `shortageRisk`），
 * **没有一格是金额**。而对象层同一个 id 上有真金额：
 * `obj_order_SO-3391` = `{cust:"广汽集团", qty:7259, due:"2026-06-24", value:161135282}`。
 * ⇒ 想要「毛利少了多少」，就得把 0–100 的压力数乘一个系数换成钱 —— **那个系数全平台没有登记册**，
 *   编一个就是造口径（与 `objectFacts.ts` 纪律 ② 同一条：宁可少一行，不摆一个可能差 10000 倍的数）。
 *
 * ── 应该是 Y ─────────────────────────────────────────────────────────────────
 * 分两类，**分开说，不合并**：
 *  ① **算得出来的**：波及订单的**敞口金额** = Σ`Order.value`（对象层真值，元）。
 *     它不是「少赚了多少」，它是「**有多少钱的单被这次扰动碰到了**」—— 口径写在第二层。
 *  ② **算不出来的**：毛利差 / 多花的成本 / 压住的应收 ⇒ 一律 `nocalc`（删除线），
 *     **且删除线的语义是「这次算不出来」，不是 0、不是「无变化」**（稿子页脚原话）。
 *
 * ⚠ 这不是偷懒，是判据：本仓铁律 1.5 的原话是「**跑得起来不度量算得对**」。
 *   摆一个编出来的毛利，屏上会好看很多，而它恰好是那条铁律点名的那种病。
 *
 * ══ 订单簿总额：**我自己算的，两个现成的数都没照抄** ═════════════════════════════
 * 实测 `Σ Order.value = 45,464,327,004 元 = 454.64 亿`（500 张单，500 张都有 `value`，缺值 0 张）。
 * 复验命令（分页翻到底，**不许拿首页 50 条当全集**）：
 *   `GET /a/v1/objects?type=Order&page=N&pageSize=500` 直到 `hasMore=false`，累加 `props.value`；
 *   与服务端回显 `total=500` 对账。
 * · 设计稿写的是「订单簿 **427.11 亿**」⇒ **与实测对不上，本文件不采用**。
 * · CLAUDE.md 写的是 454.64 亿 ⇒ 与我实测**逐元相同**，但本文件仍**现算**不写死
 *   （写死的数不会自己失效，这是本仓治过多次的病）。
 * ⚠ 同族三个数**不是订单量，别拿来当订单相关口径**：601.50 亿 = 供给侧 AOP 计划 ·
 *   700.00 亿 = 需求 P50 预测 · 250.60 亿 = 方案寻优毛利。只有订单簿总额随订单簿变。
 */

/** 推演世界一格的读数表：`objectId → { stateVar: number }`。 */
export type WorldCells = Readonly<Record<string, Readonly<Record<string, number>>>>;

/** 对象层一条记录的业务字段。 */
export interface OrderRow {
  readonly id: string;
  readonly cust: string | null;
  readonly qty: number | null;
  readonly value: number | null;
  readonly due: string | null;
  readonly status: string | null;
  readonly model: string | null;
}

/** 一格的变化。`before`/`after` 都是推演层读数（0–100 压力数，**不是钱**）。 */
export interface CellDelta {
  readonly objectId: string;
  readonly stateVar: string;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
}

/**
 * 世界前后差分。
 *
 * ⚠ **判据落在下游，不落在源格**（本仓已因此误判三次，WO 派单里点名）：
 * 实测同一条扰动，源格 `Base.loadIndex` 只动 **0.008248**（**实测于 2026-09-10**；复验：`POST /a/v1/sim/sessions/sims_demo_seed_world/perturbations` 后 `POST /a/v1/sim/sessions/sims_demo_seed_world/tick`，读回包 `state` 里源格与下游格两个数）（96.718340 → 96.710092），
 * 而下游 130 条产线的 `utilPressure` 合计动了 **148.908054** —— 相差 **18,053 倍**。
 * 源变量被顶在域上界附近（~99.7/100），分辨率被饱和吃光；**拿源格判断「生没生效」必然误判**。
 * 故本函数**不区分源与下游**，把所有动了的格一并交出，由调用方按对象类型取用。
 *
 * @param eps 视为「没动」的阈值。浮点噪声会让大量格出现 1e-13 级抖动，
 *            全算成「动了」会把 7295 格全报成波及面 —— 那不是波及面，那是噪声。
 */
export function diffWorld(before: WorldCells, after: WorldCells, eps = 1e-9): readonly CellDelta[] {
  const out: CellDelta[] = [];
  for (const [oid, cells] of Object.entries(after)) {
    const prev = before[oid];
    if (prev === undefined) continue;
    for (const [sv, v] of Object.entries(cells)) {
      const p = prev[sv];
      if (typeof p !== "number" || typeof v !== "number") continue;
      const d = v - p;
      if (Math.abs(d) <= eps) continue;
      out.push({ objectId: oid, stateVar: sv, before: p, after: v, delta: d });
    }
  }
  // 稳定序（R6 确定性）：先按幅度降序，再按 id 字典序 —— 同输入同输出。
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.objectId.localeCompare(b.objectId));
}

/** 一个金额在屏上的三态。**「算不出来」与「是 0」必须分得开**（稿上删除线的语义）。 */
export type MoneyCell =
  | { readonly kind: "value"; readonly yuan: number }
  /** 这次算不出来 —— 屏上画删除线，**不是 0，也不是「无变化」**。 */
  | { readonly kind: "nocalc"; readonly why: string };

/** 区③「钱上差多少」。 */
export interface MoneyView {
  /** 波及订单的敞口合计（元）—— 对象层 `Order.value` 求和，真金额。 */
  readonly exposure: number;
  /** 波及的订单张数。 */
  readonly exposedOrders: number;
  /** 订单簿总额（元）与张数 —— 现算，**不写死**。 */
  readonly bookTotal: number;
  readonly bookOrders: number;
  /** 三行拆解（稿上那三行；算不出来的照实画删除线）。 */
  readonly breakdown: readonly { readonly label: string; readonly cell: MoneyCell }[];
  /** 「主要是 X」——贡献最大的那件事的名字；`null` = 这次没有可归因的单一主因。 */
  readonly mainCause: string | null;
  /** 金丝雀：世界里一共有几张单被读到（0 ⇒ 遍历坏了，不许报「没有波及」）。 */
  readonly ordersSeen: number;
}

/** 三个算不出来的量，各自的原因（**唯一出处**，组件不拼串）。 */
export const NOCALC_WHY = {
  margin:
    "推演层的订单只有 0–100 的压力数，没有一格是金额；把压力换算成毛利需要一个全平台没有登记的系数，编一个就是造口径。",
  cost:
    "同上：成本增量要从压力数折算，而折算系数今天没有出处。",
  receivable:
    "客户对象上确有应收数，但它的单位（元还是万元）今天没有任何登记册说得清，差一个 10000 倍，故不摆上屏。",
} as const;

/**
 * 区③。
 *
 * @param deltas   世界差分（`diffWorld` 的结果）
 * @param orders   对象层全部订单（**必须是全量**，翻页翻到底的那份；拿首页 50 条会把 500 张读成 50）
 * @param causeOf  `objectId → 是哪件事推的`；用于「主要是 X」。取不到就返回 `null`，不硬凑。
 */
export function buildMoneyView(
  deltas: readonly CellDelta[],
  orders: readonly OrderRow[],
  causeOf: (objectId: string) => string | null,
): MoneyView {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const touched = new Set<string>();
  for (const d of deltas) if (byId.has(d.objectId)) touched.add(d.objectId);

  let exposure = 0;
  for (const id of touched) {
    const v = byId.get(id)?.value;
    if (typeof v === "number" && Number.isFinite(v)) exposure += v;
  }
  let bookTotal = 0;
  for (const o of orders) if (typeof o.value === "number" && Number.isFinite(o.value)) bookTotal += o.value;

  // 「主要是 X」：按敞口把波及订单归到推它的那件事上，取最大的那一件。
  const byCause = new Map<string, number>();
  for (const id of touched) {
    const c = causeOf(id);
    if (c === null) continue;
    byCause.set(c, (byCause.get(c) ?? 0) + (byId.get(id)?.value ?? 0));
  }
  const ranked = [...byCause.entries()].sort((a, b) => b[1] - a[1]);
  // 只有一件事时它当然是主因；多件事时必须**真的领先**才敢说「主要是它」，否则不说。
  // ⚠ 逐个解构再判空，不写 `ranked[0][1] > ranked[1][1]` —— 本包开了
  //   `noUncheckedIndexedAccess`，下标取值是 `T | undefined`，链式下标当场 TS2532。
  const first = ranked[0];
  const second = ranked[1];
  const mainCause =
    first === undefined ? null : second === undefined ? first[0] : first[1] > second[1] ? first[0] : null;

  return {
    exposure,
    exposedOrders: touched.size,
    bookTotal,
    bookOrders: orders.length,
    breakdown: [
      { label: "毛利差", cell: { kind: "nocalc", why: NOCALC_WHY.margin } },
      { label: "多花的成本", cell: { kind: "nocalc", why: NOCALC_WHY.cost } },
      { label: "压住的应收", cell: { kind: "nocalc", why: NOCALC_WHY.receivable } },
    ],
    mainCause,
    ordersSeen: orders.length,
  };
}

/** 区③b 客户表的一行。 */
export interface CustomerRow {
  readonly cust: string;
  readonly orders: number;
  readonly value: number;
  /** 占订单簿的比例（0–1）。 */
  readonly share: number;
  /** 这次扰动波及了它几张单。 */
  readonly touchedOrders: number;
  readonly touchedValue: number;
}

/** 区③b「落在谁头上」。 */
export interface CustomerView {
  readonly rows: readonly CustomerRow[];
  /** 500 张单的三段分布（现算，**不写死** 350/100/50）。 */
  readonly statusDist: readonly { readonly status: string; readonly label: string; readonly n: number }[];
  readonly touchedCustomers: number;
  readonly totalCustomers: number;
}

/** 订单状态枚举 → 人话。⛔ 屏上不许直接印 `IN_PRODUCTION` 这种接口枚举。 */
export const ORDER_STATUS_TEXT: Readonly<Record<string, string>> = {
  COMPLETED: "已完成",
  IN_PRODUCTION: "在产",
  OPEN: "已下待排产",
};

export function buildCustomerView(
  orders: readonly OrderRow[],
  touchedIds: ReadonlySet<string>,
  topN = 6,
): CustomerView {
  const agg = new Map<string, { orders: number; value: number; tOrders: number; tValue: number }>();
  const status = new Map<string, number>();
  let book = 0;
  for (const o of orders) {
    const c = o.cust ?? "（无客户名）";
    const e = agg.get(c) ?? { orders: 0, value: 0, tOrders: 0, tValue: 0 };
    const v = typeof o.value === "number" && Number.isFinite(o.value) ? o.value : 0;
    e.orders += 1; e.value += v; book += v;
    if (touchedIds.has(o.id)) { e.tOrders += 1; e.tValue += v; }
    agg.set(c, e);
    const s = o.status ?? "（无状态）";
    status.set(s, (status.get(s) ?? 0) + 1);
  }
  const rows = [...agg.entries()]
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, topN)
    .map(([cust, e]) => ({
      cust, orders: e.orders, value: e.value,
      share: book === 0 ? 0 : e.value / book,
      touchedOrders: e.tOrders, touchedValue: e.tValue,
    }));
  return {
    rows,
    statusDist: [...status.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => ({ status: s, label: ORDER_STATUS_TEXT[s] ?? s, n })),
    touchedCustomers: [...agg.values()].filter((e) => e.tOrders > 0).length,
    totalCustomers: agg.size,
  };
}

/**
 * 金额折算成人话。**复用既有单源** —— 本仓已有两处金额折算，第三处一写三处迟早各说各话。
 * 这里刻意不自己写 `1e8`：`console/ParetoChart.fmtXTick` 就是那一份。
 */
export { fmtXTick as fmtMoney } from "../../console/ParetoChart";

/** 区④ 时间线上的一站。 */
export interface TimelinePoint {
  /** 第几拍（推演的时间单位；**不叫「天」** —— 拍与天的换算今天没有登记册）。 */
  readonly tick: number;
  readonly label: string;
  readonly detail: string;
}

/**
 * 区④ 的时间线。
 *
 * ⚠ 设计稿把横轴写成「第 2 天 / 第 8 天 …往后 30 天」。**今天没有「拍→天」的换算出处**，
 *   把拍直接读成天就是造口径。故本函数只按**拍**给点位，屏上也只写「第 N 拍」，
 *   并在第二层说明为什么不写天。
 */
export function buildTimeline(
  series: readonly { readonly tick: number; readonly touched: number; readonly exposure: number }[],
): readonly TimelinePoint[] {
  return series.map((s) => ({
    tick: s.tick,
    label: `第 ${s.tick} 拍`,
    detail: `这一拍有 ${s.touched} 张单被推动`,
  }));
}
