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
 *  ② **算不出来的**：毛利差额 / 新增成本 / 占压应收 ⇒ 一律 `nocalc`（删除线），
 *     **且删除线的语义是「本次无法计算」，不是 0、不是「无变化」**（稿子页脚原话）。
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

import { daysForTicks } from "@platform/contracts";
import type {
  CandidateEffectKind,
  CandidateJoinKind,
  CandidateRungKind,
} from "@platform/contracts";

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
    "推演层订单仅有 0–100 的压力读数，无金额字段；将压力折算为毛利需要一个全平台未登记的系数，自拟系数即构造口径。",
  cost:
    "同上：成本增量需由压力读数折算，而折算系数无出处。",
  receivable:
    "客户对象确有应收数，但其计量单位（元 / 万元）无登记册可据，两者相差 10000 倍，故不上屏。",
} as const;

/**
 * 三行拆解的**栏目名**（唯一出处 —— 组件与接缝门都从这里取，不各抄一份字面量）。
 *
 * ⚠ 这三个串同时是 `data-testid="c0828-nocalc-{label}"` 的后缀。改名即改 testid，
 *   故门里的循环也从本常量取，**不许在测试里另写一份数组** —— 抄一份就是
 *   「期望值与被测数据各自漂」，改了一边照样绿（本仓 `quantile-field-naming` 记过这笔账）。
 */
export const MONEY_BREAKDOWN_LABELS = ["毛利差额", "新增成本", "占压应收"] as const;

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
      { label: MONEY_BREAKDOWN_LABELS[0], cell: { kind: "nocalc", why: NOCALC_WHY.margin } },
      { label: MONEY_BREAKDOWN_LABELS[1], cell: { kind: "nocalc", why: NOCALC_WHY.cost } },
      { label: MONEY_BREAKDOWN_LABELS[2], cell: { kind: "nocalc", why: NOCALC_WHY.receivable } },
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

/* ══════════════════════════════════════════════════════════════════════════════
 * 拍 ↔ 日期（WO-C0828-VOICE · 屏上时间轴改用真实日期）
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── 今天的行为是 X ──
 * 屏上一律写「第 N 拍」，并在第二层给了一句理由：
 *   > 「推演世界的时间单位是『拍』，而『一拍等于几天』今天**全平台没有登记册**。」
 * ── 应该是 Y ──
 * **那句话不成立** —— **实测于 2026-09-11**（不是读注释，是逐个打开读的）。复验：
 * `grep -n "tickDays\|createdAt\|daysForTicks" packages/contracts/src/sim.ts`
 * （金丝雀：同文件必中的 `durationTicks` 同法命中非 0 ⇒ 工具没坏）。三处坐标：
 *   · `SimSession` 上**同时**有 `tickDays`（`packages/contracts/src/sim.ts` 该字段，
 *     `z.number().int().min(1).optional()`，契约注释明写「缺省 1」）与 `createdAt`；
 *   · 换算函数 `daysForTicks(ticks, tickDays)` 也在契约里，**早就存在**；
 *   · **同一个应用的另一块屏已经在用它**（`views/sim/unified/metricWallModel.ts` 的
 *     `firstCrossDays`），且 `views/sim/console/tickAxis.ts` 是那条线的单一换算点。
 * ⇒ 真相是本仓三态里的第三态「**接了线接错地方**」：口径与函数都在，只有这块屏没挂上去。
 *   形态（铁律 0.6 句式）：**「我用『我这块屏没接这条线』当作『全平台没有这个登记』的证据。」**
 *
 * ⚠ 顺带一个会骗人的坐标，别信：`packages/contracts/src/sim.ts` 里 `tickDays` 字段
 *   **正上方那段注释**白纸黑字写着「实测 `grep -rn tickDays` 全仓 **0 命中**」——
 *   而它自己下面几行就定义了这个字段，今日实测全仓 **40+ 命中**。那段是**引入前**的观测，
 *   留在活注释里就被读成现状。（铁律 1.5 判据四：信注释 = 信台账，同样要实测。）
 *
 * ── ⛔ 为什么算术不自己写 ────────────────────────────────────────────────────
 * 「第 N 拍等于第几天」只有一份实现 —— 契约的 `daysForTicks`。各写一份 = 第二套真相源，
 * 引擎按 `ceil(N / tickDays)` 推拍、屏上按另一套算天，**这种错不会崩，只会静默算错**。
 * 本文件只做「天 → 日历日」这一段（契约不管日历），乘法一律转调契约。
 */

/** 会话的日历口径 —— 有它才谈得上日期。 */
export interface TickCalendar {
  /** 第 0 拍那一天（= 会话创建日，仓主 2026-09-11 裁决「起点用推演发起的那一天」）。 */
  readonly originMs: number;
  /** 一拍等于几天（会话 `tickDays`，缺省 1 —— 契约原话「缺失与 1 同义」）。 */
  readonly tickDays: number;
}

/**
 * 会话 → 日历口径。**拿不到就返回 `null`，⛔ 不许编一个「今天」顶上。**
 *
 * 「取不到 `createdAt`」与「这个会话没有起始日」是两个命题，而后者根本不存在
 * （`createdAt` 在契约里是必填 `z.string()`）⇒ 读不到就是**取数这一跳没到**，
 * 屏上必须退回「第 N 拍」并说明，不是悄悄拿当天日期糊上去 ——
 * 那会让一个**错了一整年也没人看得出来**的日期摆在决策屏上。
 */
export function buildTickCalendar(
  createdAt: string | undefined | null,
  tickDays: number | undefined | null,
): TickCalendar | null {
  if (typeof createdAt !== "string" || createdAt.trim() === "") return null;
  const ms = Date.parse(createdAt);
  if (!Number.isFinite(ms)) return null;
  return { originMs: ms, tickDays: Math.max(1, Math.floor(tickDays ?? 1)) };
}

const DAY_MS = 86_400_000;

/**
 * 第 `tick` 拍那一天，`YYYY-MM-DD`。
 *
 * ⚠ 一律按 **UTC 日历日**取，不走本地时区：同一个会话在两台时区不同的机器上必须显示同一天
 * （R6 确定性；后端 `createdAt` 本身就是 `…Z`）。用本地时区会让门在 CI 与本机各说一套。
 *
 * ⚠ `tickDays > 1` 时一拍横跨多天，这里给的是**该拍的起始日**。
 *   理由：扰动按「起始拍」施加，引擎在**那一拍的开头**吃掉它；且时间轴上最多 8 个点位，
 *   每点摆一个区间会把标签挤成两行。区间长度在第二层的口径说明里给出，不藏着。
 */
export function tickDateISO(cal: TickCalendar | null, tick: number): string | null {
  if (cal === null || !Number.isFinite(tick)) return null;
  // 乘法转调契约的唯一实现（`daysForTicks(t, td) = t * td`），本文件不自己写 `t * td`。
  const d = new Date(cal.originMs + daysForTicks(tick, cal.tickDays) * DAY_MS);
  return d.toISOString().slice(0, 10);
}

/**
 * 屏上主口径：`2026-09-16（第 6 拍）`。
 *
 * ⛔ 「拍」不许删干净 —— 引擎的量就是拍，两层对不上账时没有别的东西可追。
 * 拿不到日历就**只剩拍**，此时屏上另有一句说明它为什么没有日期（见组件 `calShortfall`）。
 */
export function tickLabel(cal: TickCalendar | null, tick: number, opts?: { readonly short?: boolean }): string {
  const iso = tickDateISO(cal, tick);
  if (iso === null) return `第 ${tick} 拍`;
  return `${opts?.short === true ? iso.slice(5) : iso}（第 ${tick} 拍）`;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 对策三栏的**业务语域译名**（WO-C0828-VOICE 第 4 批）
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── 今天的行为是 X ──
 * 四栏方案的「怎么连上 / 动哪个 / 效果」三行，直接渲染共享派生层
 * `views/sim/chainImpediment.ts` 的 `CANDIDATE_JOIN_LABEL` / `_RUNG_` / `_EFFECT_`。
 * 那三张表的措辞是**建模语域**，仓主逐句点名「都太『技术』，COO 看不懂」，原文例如：
 *   · 「阻滞点落在的那个对象自己就承载这个**可拨动因子**（**join 键** = **对象实例**本身，最强）」
 *   · 「沿**一等关系行（links 表）**一跳可达。关系是数据不是代码里的**类型对照表**」
 *   · 「**判据读数**纹丝不动，但下游产能真的变了」
 *
 * ── 应该是 Y ──
 * 同样三态、同样语义，换成经营会上说得出口的话。**一个态都不合并** ——
 * 合并就把「这个杠杆长在哪」这条真区分抹掉了。
 *
 * ── ⛔ 为什么译在这里，而不是去改那三张表 ────────────────────────────────────
 * `chainImpediment.ts` 是**共享派生层**，同时喂着另一块屏（`views/sim/ChainImpedimentView.tsx`
 * —— 那一页的读者是建模方，技术语域在那里是对的）。本单的范围边界写死
 * 「不碰 console0828 以外的文件（那是别人的屏）」，改共享表等于替别人改屏。
 * ⇒ 译名留在本屏，共享层一行不动。**两屏各自说各自读者的话，这不是重复，是分工。**
 *
 * ── 机制：`satisfies Record<…>` 是这里的门 ──────────────────────────────────
 * 契约哪天加一个 join / rung / effect 态而这里没跟上 ⇒ **TS 当场红**，
 * 不会静默把新态渲染成空白（与共享层那三张表同一条机制）。
 * ⛔ 别改成 `Partial<Record<…>>` —— 那正好把这道门关掉。
 */

/** 这个杠杆**长在哪** —— 原 `join`。 */
export const BIZ_JOIN = {
  LOCUS_PROP: {
    label: "就在这个环节上",
    why: "这个杠杆就长在卡住的那个环节上，动它最直接。",
  },
  LINK_HOP: {
    label: "在直接相连的上一环",
    why: "这个杠杆不在卡住的环节本身，在与它直接相连的上一环 —— 谁连着谁取自现场数据，不是写死的对照表。",
  },
  KEY_JOIN: {
    label: "同一个编号对上的另一处",
    why: "两处记的是同一个东西（编号一致），所以动那一处也管这一处。一个编号对上不止一处时一律不用 —— 分不清动的是哪一个。",
  },
  RULE_GATE: {
    label: "同一条红线管着的",
    why: "这处受阻环节与这个杠杆归同一条业务规则管（判据列那个规则码就是它），拨它能松这条线。",
  },
} as const satisfies Record<CandidateJoinKind, { readonly label: string; readonly why: string }>;

/** 目标值**是怎么定的** —— 原 `rung`。三档全部取自数据里真实存在的值，没有一个是拍的。 */
export const BIZ_RUNG = {
  THRESHOLD: {
    label: "拉回红线以内",
    why: "目标值就是这条红线本身 —— 取自规则，不是这里拍的数。",
  },
  PEER_NEXT: {
    label: "同类里的下一档",
    why: "目标值取自同类里紧挨着当前值的下一个真实数 —— 数据里真有对象在这个数上，不是拍的。",
  },
  PEER_BEST: {
    label: "同类做到过的最好水平",
    why: "目标值取自同类已经达到过的最好水平 —— 不是拍的，同类里真有人做到。",
  },
} as const satisfies Record<CandidateRungKind, { readonly label: string; readonly why: string }>;

/**
 * 动完之后**真变了什么** —— 原 `effect`。
 *
 * ⚠ 三态是**实测出来的**（拨到目标值后重算，看动了什么就是什么），不是预先分的类。
 * ⚠ `DOWNSTREAM_ONLY` 那句里的「堵点」**刻意保留** —— 它是引擎三类之一（`CONGESTION`）的名字，
 *   不是修饰语。换成泛称就把「能力不够」与「流不动」两类合并了，而两者**处置相反**
 *   （前者加产能有用，后者加产能没用）。见下 `IMPEDIMENT_KIND_PLAIN`。
 */
export const BIZ_EFFECT = {
  METRIC_SELF: {
    label: "直接把超线的指标压回来",
    why: "直接把超线的那个指标拉回红线以内。",
  },
  METRIC_DERIVED: {
    label: "间接带动超线的指标",
    why: "动的不是超线那个指标本身，但算下来它真的跟着变好了。",
  },
  DOWNSTREAM_ONLY: {
    label: "指标不变，产能真上去",
    why: "这一招不会让超线的那个数变好看，但产能是真的上去了 —— 遇到「能力够却流不动」那一类（屏上标「堵点」），只有这一类管用。",
  },
} as const satisfies Record<CandidateEffectKind, { readonly label: string; readonly why: string }>;

/* ══════════════════════════════════════════════════════════════════════════════
 * 卡点 / 堵点 / 断点 —— **三个量，不是一个量的三种叫法**
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── 查清楚了再说（⛔ 没有不查就合并）────────────────────────────────────────
 * **实测于 2026-09-11**，真后端 `SEED_DEMO=1`（本机 datacore :49317）。复验：
 *   `curl -sX POST -H 'X-Debug-User: demo:admin:admin' -H 'content-type: application/json' \
 *    -d '{"scope":{}}' http://<datacore>/a/v1/solvers/chain_impediments/invoke` 读 `data.counts`。
 * 当日回包：
 *   `counts = { total: 18, BOTTLENECK: 5, CONGESTION: 6, BREAK: 7 }`
 * ⇒ 引擎回包里每条都带 `kind`，**三类各有实例**，是三个不同的量。
 *
 * ── 今天的行为是 X ──
 * 区④ 标题写「全流程卡点与堵点」：**只点了三类里的两类**，而漏掉的 `BREAK`（断点）
 * 恰好是**条数最多的那一类（7 / 18）**；同时「卡点」又被当成三类的**统称**在别处用
 * （「扫出 N 处」「N 处卡点」）⇒ 同一个词在同一块屏上有两个意思。
 * ── 应该是 Y ──
 * 统称改用 **「受阻环节」**（不与任一类重名），三类各自保留本名并在屏上给出一句可判定含义。
 * ⛔ 不合并：三类的处置**相反**（卡点加产能有用 · 堵点加产能没用 · 断点得先接上），
 *   合并等于把这个区分抹掉 —— 而这正是本单明令不许干的那一类改动。
 */
export const IMPEDIMENT_KIND_PLAIN: Readonly<Record<string, string>> = {
  BOTTLENECK: "能力不够，做不过来 —— 加产能有用",
  CONGESTION: "能力够，但流不动（在排队 / 在途积压）—— 加产能没用",
  BREAK: "链条接不上，上一环给不了这一环要的",
};
