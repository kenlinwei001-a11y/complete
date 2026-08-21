/**
 * WO-SIM-FE-HOME → **WO-SIM-FE-SERIES-WIRE** · 底部「指标甘特」的**唯一取数口**。
 *
 * ══ 病灶：今天的行为是 X，应该是 Y（WO-SIM-FE-SERIES-WIRE 开工前实测）══════════
 *
 * **X（改造前实测原文，`useMetricSeries.ts:156-159`）**：
 * ```ts
 * export function useMetricSeries(sessionId?: string): MetricSeries {
 *   void sessionId;
 *   return PLACEHOLDER;
 * }
 * ```
 * 函数体**丢掉入参**，`PLACEHOLDER.source` 是**编译期常量** `"placeholder"`。
 * 上一张单（`WO-SIM-FE-HOST`）已把 `sessionId` 一路送到 `MetricGantt` 的门口
 * （`SandboxHomeRoute` → `useConsoleSession` → `SandboxHome` → `MetricGantt`），
 * 但宿主透什么值下来都翻不动这一位 —— 这是本仓三态里的**第一态：没接线**
 * （不是「接了线没数据」：那种形态里入参至少会被读一次）。
 *
 * **Y（本单落地）**：真调 `GET /a/v1/sim/sessions/:id/metric-series`，
 * 把回包（`SimMetricSeriesResponse`）投影成下面的 `MetricSeries`，`source` 反映**真实出身**：
 * 拿到回包 ⇒ `"endpoint"`；没会话 / 请求失败 / 回包零指标 ⇒ 仍落规格占位并如实标 `"placeholder"`。
 *
 * ── 为什么是一个 hook 而不是把数写进 JSX ────────────────────────────────────
 * 首版派单原文：「必须把取数抽成一个 `useMetricSeries()` hook，端点一到只换 hook 内部；
 * ⚠️ 占位数不许散在 JSX 里，否则接真数据时要满屏找」。本单正是那次预留的兑现：
 * **`MetricGantt.tsx` 一行没动**，改的全在本文件的函数体里。
 *
 * ── 诚实位（不许静默）──────────────────────────────────────────────────────
 * 返回值带 `source`，**这不是可以省略的元数据** —— 屏上要读得出「这几个数不是真算出来的」，
 * 不许拿占位数冒充实测（本仓「绿测试≠能用」同族纪律）。视图把它挂在
 * `[data-testid=sandbox-home-gantt]` 的 `data-source` 上：属性对测试可见、对像素不可见，
 * 四页的像素级 1:1 验收线因此不受影响。
 *
 * ── 占位数的出处 ────────────────────────────────────────────────────────────
 * 逐条取自规格 `docs/ux-spec/sandbox/sandbox-home.html` 的 `ROWS[]`（第 437–450 行），
 * 一个字节没改。规格 README §「已知的取舍」明写：四页的数字是**内部自洽的一套**
 * （产能 −18% → 稼动率 −18.0pp → Q3 缺口 6 万套 → 外协 ¥1,840万），
 * 接真数据时**整套换掉**，不许只换一半 —— 换一半屏上就自相矛盾。
 *
 * ── 段上的站名为什么绕一道「段位代号」──────────────────────────────────────
 * 甘特段里有一半是**链路环节**（请购 / 采购下单 / 到货检验 / 入厂在途 / 齐套发料 / 老化静置），
 * 契约 §2.5 明写「`label` 人读名，前端**不另维护中文映射表**，一律取这里」，
 * 门 `scripts/check-chain-node-singlesource.mjs` 判据 L 就守这条（≥3 个在册 label 字面量即红，
 * 首版本文件正是被它当场逼回来的）。所以站名一律 `chainNodeDef(nodeId).label` 现取；
 * 而占位表里若直接写 nodeId 又会撞判据 C（值位的在册 id 算「第二份注册表」）。
 * 故 nodeId **只出现在 `SEGMENT_NODES` 的键位**（键类型锚在契约上 ⇒ 编译期绑死，
 * 判据 C 明文按机制放行），占位表按**段位代号**引用它。
 */
import { useQuery } from "@tanstack/react-query";
import { chainNodeDef, type ChainNodeDef, type SimMetricSeriesResponse } from "@platform/contracts";
import { api } from "@/api/apiClient";
// 端点路径取**既有单源** `metricSeriesPath()`（`useParetoFrontier.ts`，同目录、同一条端点）。
// 在这里再写一遍 `/a/v1/sim/sessions/${id}/metric-series` 就是第二份路径字面量 ——
// 后端哪天改了前缀，两处只会改一处，而没有任何东西会报错。
import { metricSeriesPath } from "./useParetoFrontier";

/** 在册节点 id 的字面量联合（派生自契约本尊，不是本地起个同名别名白嫖）。 */
type RegisteredChainNodeId = ChainNodeDef["nodeId"];

/** 甘特段引用链路环节时用的**段位代号**（本文件内部坐标，不是第二套节点 id）。 */
type SegmentSlot = "REQ" | "PO" | "IQC" | "INBOUND" | "KIT" | "AGING";

/**
 * 段位 ← 在册节点。**键 = nodeId（编译期绑死：改册即 TS2353）**，值声明这一段怎么显示。
 * · `suffix` 跟在站名后（规格里的批次号 `3/16`）；
 * · `short` 是**显示简称**，不是第二套站名 —— 规格为控宽把「入厂在途与清关」写成「入厂在途」
 *   （`sandbox-home.html` 第 441/446 行原文），单源仍是注册表，这里只记「这一格放不下全名」。
 */
const SEGMENT_NODES = {
  "material.purchase_req": { slot: "REQ" },
  "material.purchase_order": { slot: "PO" },
  "material.iqc": { slot: "IQC" },
  "material.inbound_transit": { slot: "INBOUND", short: "入厂在途" },
  "material.kitting": { slot: "KIT", suffix: " 3/16" },
  "capacity.aging": { slot: "AGING", suffix: " 3/16" },
} satisfies Partial<Record<RegisteredChainNodeId, { slot: SegmentSlot; suffix?: string; short?: string }>>;

/** 段位代号 → 屏上文字。站名现取注册表，**本文件零 label 字面量**。 */
export const SEGMENT_SLOT_TEXT: Record<SegmentSlot, string> = Object.fromEntries(
  Object.entries(SEGMENT_NODES).map(([nodeId, d]) => {
    const spec = d as { slot: SegmentSlot; suffix?: string; short?: string };
    return [spec.slot, `${spec.short ?? chainNodeDef(nodeId)?.label ?? nodeId}${spec.suffix ?? ""}`];
  }),
) as Record<SegmentSlot, string>;

/** 段的色调。逐个对应规格 `.seg.b/.a/.r/.g/.o`（蓝=计划段 / 琥珀 / 红=风险 / 绿=缓冲释放 / 空心=前后结转）。 */
export type MetricSegmentTone = "b" | "a" | "r" | "g" | "o";

export interface MetricSegment {
  /** 起点，占轨道宽度的百分比（0–100）。 */
  startPct: number;
  /** 宽度，占轨道宽度的百分比。 */
  widthPct: number;
  tone: MetricSegmentTone;
  /** 段上的文字（已解析：链路环节取注册表站名，非环节是原创文案）。 */
  label: string;
}

export interface MetricRow {
  /** 域名（交付域 / 成本域 / 库存域 / 产能域）。**只在该域第一行给**，续行省略 = 与上一行同域。 */
  group?: string;
  /** 指标名。 */
  name: string;
  /** 基线值（扰动前）。 */
  baseline: string;
  /** 扰动后值。 */
  after: string;
  /**
   * 箭头方向。**两种数据模式下这一位的口径不同，且必须分开读**（合成一句就骗人）：
   *  · **占位模式**（规格那 12 行）：规格是按「数变差 = `up`（红）/ 数变好 = `dn`（绿）」画的
   *    —— 那是人对着一套自洽的编造数字标出来的好坏，稼动率跌标成 `dn` 就是这么来的。
   *  · **真端点模式**（`projectMetricSeries`）：只表示**变大 / 变小**，**不表示变好 / 变坏**。
   *    全仓没有「状态变量 → 极性」的登记册，编一个极性就是新造口径。
   * ⚠ 别把真端点那一侧「优化」成红绿好坏语义（详见 `projectMetricSeries` 里的行内注释）。
   * ⚠ 已知缺口：本枚举**没有「持平 / 不可判」**第三态，真数据模式下这两种情形只能落 `dn`。
   */
  direction: "up" | "dn";
  segments: MetricSegment[];
}

export interface MetricSeries {
  rows: MetricRow[];
  /** 轨道时间刻度文本（`00:00` … `28:00`），条数即刻度数。 */
  ticks: string[];
  /** 播放头位置，占轨道宽度的百分比。 */
  playheadPct: number;
  /**
   * 数据出身。`endpoint` = `GET …/:id/metric-series` 的真回包；
   * `placeholder` = 规格占位数（没会话 / 这一跳失败 / 回包零指标三种情形，见 `useMetricSeries`）。
   * 视图据此决定要不要在屏上标「占位」。
   */
  source: "endpoint" | "placeholder";
}

/** 段文字的引用：段位代号（取注册表站名）或原创文案。 */
type SegmentRef = SegmentSlot | { text: string };
/** 规格 `ROWS[].s[]`：`[startPct, widthPct, tone, 段文字]`。 */
type SpecSegment = readonly [number, number, MetricSegmentTone, SegmentRef];
type SpecRow = readonly [string | undefined, string, string, string, "up" | "dn", readonly SpecSegment[]];

const RELEASE: SegmentRef = { text: "缓冲释放" };
const CARRY: SegmentRef = { text: "结转" };

const SPEC_ROWS: readonly SpecRow[] = [ // hardcoded-data-allow —— **规格占位数**，只在「没会话 / 这一跳失败 / 回包零指标」三种情形下上屏，且届时 source 恒为 placeholder。这是全仓唯一一份，不许再抄第二处
  ["交付域", "交付准时率", "94.2%", "88.6%", "up", [[2, 9, "o", "REQ"], [13, 17, "b", "KIT"], [32, 16, "b", "AGING"], [52, 12, "g", RELEASE], [70, 9, "o", CARRY]]],
  [undefined, "订单履约率", "96.8%", "91.2%", "up", [[3, 10, "o", "PO"], [15, 16, "b", "KIT"], [34, 15, "b", "AGING"], [54, 13, "g", RELEASE], [73, 8, "o", CARRY]]],
  [undefined, "受影响客户", "0 家", "7 家", "up", [[2, 10, "o", "IQC"], [15, 15, "b", "KIT"], [33, 16, "b", "AGING"], [54, 12, "g", RELEASE], [73, 8, "o", CARRY]]],
  [undefined, "受影响订单", "0 批", "23 批", "up", [[4, 8, "o", "INBOUND"], [14, 17, "b", "KIT"], [35, 14, "b", "AGING"], [55, 11, "g", RELEASE], [71, 9, "o", CARRY]]],
  ["成本域", "单位成本", "¥0.403/Wh", "¥0.412/Wh", "up", [[3, 9, "o", "PO"], [14, 16, "b", "KIT"], [33, 15, "b", "AGING"], [53, 13, "g", RELEASE], [72, 9, "o", CARRY]]],
  [undefined, "外协兜底成本", "¥0", "¥1,840万", "up", [[4, 8, "o", "REQ"], [14, 17, "b", "KIT"], [35, 14, "b", "AGING"], [55, 11, "g", RELEASE], [71, 9, "o", CARRY]]],
  [undefined, "跨基地调拨费", "¥210万", "¥620万", "up", [[2, 11, "o", "IQC"], [16, 15, "b", "KIT"], [34, 16, "b", "AGING"], [54, 12, "g", RELEASE], [72, 9, "o", CARRY]]],
  ["库存域", "在制库存", "¥2.14亿", "¥2.47亿", "up", [[3, 10, "o", "PO"], [15, 16, "b", "KIT"], [34, 15, "b", "AGING"], [54, 13, "g", RELEASE], [73, 8, "o", CARRY]]],
  [undefined, "成品库存周转", "18.2 次", "15.4 次", "up", [[2, 12, "o", "INBOUND"], [16, 14, "b", "KIT"], [33, 17, "b", "AGING"], [53, 13, "g", RELEASE], [71, 10, "o", CARRY]]],
  ["产能域", "产线稼动率", "89.3%", "71.3%", "dn", [[2, 11, "o", "IQC"], [15, 14, "b", "KIT"], [32, 17, "b", "AGING"], [54, 12, "g", RELEASE], [71, 10, "o", CARRY]]],
  [undefined, "Q3 产能缺口", "0 万套", "6.0 万套", "up", [[1, 11, "o", "REQ"], [14, 14, "r", "KIT"], [31, 17, "b", "AGING"], [53, 12, "g", RELEASE], [72, 10, "o", CARRY]]],
  [undefined, "全链非增值", "18.4 D", "21.6 D", "up", [[3, 10, "o", "PO"], [16, 15, "b", "KIT"], [34, 16, "b", "AGING"], [55, 11, "g", RELEASE], [72, 9, "o", CARRY]]],
];

/** 规格 `tick`/`laneHead`：`for(i=0;i<=14;i++) String(i*2).padStart(2,"0")+":00"`。**两处共用这一份**。 */
export const HOUR_TICKS: readonly string[] = Array.from({ length: 15 }, (_, i) => `${String(i * 2).padStart(2, "0")}:00`);

/** 规格 `play.style.left="41%"`。 */
const PLAYHEAD_PCT = 41;

const segText = (ref: SegmentRef): string => (typeof ref === "string" ? SEGMENT_SLOT_TEXT[ref] : ref.text);

const PLACEHOLDER: MetricSeries = {
  rows: SPEC_ROWS.map(([group, name, baseline, after, direction, segs]) => ({
    ...(group === undefined ? {} : { group }),
    name,
    baseline,
    after,
    direction,
    segments: segs.map(([startPct, widthPct, tone, ref]) => ({ startPct, widthPct, tone, label: segText(ref) })),
  })),
  ticks: [...HOUR_TICKS],
  playheadPct: PLAYHEAD_PCT,
  source: "placeholder",
};

// ══════════════════════════════════════════════════════════════════════════
// § 真端点投影（WO-SIM-FE-SERIES-WIRE）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 端点 `segments[].source` → 屏上色调。**三个不同事实，三种色调，不许合并成一种**：
 *  · `cadence` = 规则声明的节拍节点 = **建模方显式绑定**的全链环节（最强一档）⇒ 蓝片 `b`；
 *  · `domain`  = 按规则落域（D01–D13）推的**回落档**                        ⇒ 琥珀 `a`；
 *  · 端点没给 / 给了本前端不认识的值                                        ⇒ 空心 `o`（中性，不猜）。
 *
 * ⚠ 刻意**不用** `r`（红=风险）与 `g`（绿=缓冲释放）：那两档承载的是**好坏**语义，
 *   而 `source` 说的是「这个环节归属是怎么算出来的」，与好坏无关。
 *   按数值大小自己分档去点红绿，就是在没有极性登记册的前提下**新造口径**
 *   （同下面 `direction` 那条注释，同族纪律）。
 * ⚠ 也刻意**不把 `domain` 也映射成 `o`**：那样「按落域推出来的段」与「压根没给出身的段」
 *   在屏上长得一模一样 —— 一个色调盖住两个不同事实，正是本仓反复记账的那个病。
 */
const SOURCE_TONE: Readonly<Record<string, MetricSegmentTone>> = { cadence: "b", domain: "a" };

/** 出身不明的段用中性空心片。**不猜**一个档位出来。 */
const UNKNOWN_SOURCE_TONE: MetricSegmentTone = "o";

/**
 * 序列的**首个有效读数**。缺格（`null`）**跳过，绝不插值**。
 *
 * 契约 `SimMetricSeriesItem.baseline/actual` 明写「缺格 = `null`（『这个世界里没有这一格』
 * ≠『这一格是 0』）」。插出来的点会被读成实测值（屏上和真值长得一模一样），
 * 补 0 则把「没有这一格」说成「这一格是 0」—— 两种都是拿编出来的数冒充实测。
 * 整列全 `null` ⇒ 返回 `null` ⇒ 屏上是 `—`，不是 `0`。
 */
function firstReading(xs: readonly (number | null)[]): number | null {
  for (const v of xs) if (typeof v === "number") return v;
  return null;
}

/** 序列的**末个有效读数**。语义同 `firstReading`，方向相反（尾部缺格照样跳过，不外推）。 */
function lastReading(xs: readonly (number | null)[]): number | null {
  for (let i = xs.length - 1; i >= 0; i--) {
    const v = xs[i];
    if (typeof v === "number") return v;
  }
  return null;
}

/**
 * 读数 → 屏上文字。
 *
 * · `null` ⇒ `—`（**不是 `0`**，见 `firstReading` 注释）；
 * · **不追加任何单位**：契约 `SimMetricSeriesItem.unit` 恒 `null` 且注释写死了理由
 *   （全仓没有「状态变量 → 单位」的登记册）。编一个「%」或「天」出来就是新造口径。
 *   万一哪天真登记了单位，这里再照 `m.unit` 拼 —— 那时它不再是编的。
 * · 只做**显示取整**（两位小数），不改数值口径：62px 的等宽格放不下长尾小数。
 */
const reading = (v: number | null, unit: string | null): string =>
  v === null ? "—" : `${Math.round(v * 100) / 100}${unit === null ? "" : ` ${unit}`}`;

/**
 * 行名。**同名行会撞 React key**（`MetricGantt` 用 `key={r.name}`、`data-testid` 也带行名），
 * 而端点的 `label` 取自「状态变量 → 人话名」单源表 ⇒ **不同对象的同一状态变量必然同名**
 * （`obj_a.loadIndex` 与 `obj_b.loadIndex` 都叫「负荷指数」）。这不是理论风险，是默认情形。
 *
 * 撞名时**用回包里已有的 `objectId` 消歧**（不是编一个后缀）：`名字·对象id`。
 * 极端情形（同对象同名两条）退回契约保证唯一的 `key`（`${objectId}.${stateVar}`）。
 * ⚠ `MetricRow` 没有 `key` 字段、签名在本单冻结 ⇒ 只能把唯一性做进 `name` 这一格。
 */
function rowNames(metrics: readonly SimMetricSeriesResponse["metrics"][number][]): string[] {
  const seen = new Map<string, number>();
  for (const m of metrics) seen.set(m.label, (seen.get(m.label) ?? 0) + 1);
  const used = new Set<string>();
  return metrics.map((m) => {
    let n = (seen.get(m.label) ?? 0) > 1 ? `${m.label}·${m.objectId}` : m.label;
    if (used.has(n)) n = m.key;
    used.add(n);
    return n;
  });
}

/**
 * 回包 → 视图模型。**纯函数**（无 `Date.now()`、无随机数）：同回包逐字节同模型。
 *
 * ── 轨道坐标：`tick` 是**格**不是点 ────────────────────────────────────────────
 * 段是**闭区间** `[fromTick, toTick]`，故按「每个 tick 占 `100/格数` 宽」换算：
 * 单格段拿到一格宽而不是 0 宽（0 宽 = 屏上看不见 = 把一条真存在的归属抹掉）。
 * 代价是段的左沿与 `MetricGantt` 轨道头的刻度文字（点式 `i/(n-1)`）差半格 —— 已知近似，
 * 不是对不齐的 bug；要消除得同时改视图的刻度摆法，那在本单的 🚦 范围边界之外。
 *
 * ── 段上的字：在册环节走注册表，非在册走回包 ──────────────────────────────────
 * `source:"cadence"` 的 `nodeId` 取值域是 `CHAIN_NODE_REGISTRY` 在册 id ⇒ 站名现取注册表
 * （契约 §2.5「前端不另维护中文映射表」）；`source:"domain"` 的 `nodeId` 是业务域键
 * （D01–D13），不在链路册里 ⇒ 用回包自带的 `label`。**本文件零 label 字面量**照旧成立。
 *
 * ── 域名（`group`）为什么整列不给 ────────────────────────────────────────────
 * 规格占位那套「交付域 / 成本域 / 库存域 / 产能域」是**人写的分组**，而回包里
 * **没有任何「状态变量 → 业务域」的登记册**可查（`unit` 恒 `null` 是同一笔账的另一半：
 * 连单位都没登记，更没有域）。按序号硬派一套域名 = 编口径；把 `objectId` 裸串竖排上屏
 * = 把开发口径推到用户脸上。故真数据模式下**一行都不带 `group`**，竖排域名列留空 ——
 * 这是**诚实缺席**，已写进交单报告的「没做的格」，不是漏了。
 */
export function projectMetricSeries(res: SimMetricSeriesResponse): MetricSeries {
  const ticks = res.ticks;
  const t0 = ticks[0] ?? 0;
  const tN = ticks[ticks.length - 1] ?? t0;
  /** 窗口里的**格数**（闭区间）。空窗口按 1 兜底，只为不除零。 */
  const cells = Math.max(1, tN - t0 + 1);
  const names = rowNames(res.metrics);

  const rows: MetricRow[] = res.metrics.map((m, i) => ({
    // `group` 整列不给 —— 理由见函数头注「域名为什么整列不给」。
    name: names[i] as string,
    baseline: reading(firstReading(m.baseline), m.unit),
    after: reading(lastReading(m.actual), m.unit),
    // ⚠ 真数据模式下 `up`/`dn` 只表示**变大 / 变小**，**不表示变好 / 变坏**。
    //   全仓没有「状态变量 → 极性」的登记册（契约 `SimMetricSeriesItem.unit` 的注释已为
    //   同一件事立过账：连单位都没有登记册，更没有极性），编一个极性出来就是新造口径。
    //   **别把这里「优化」成红绿好坏语义** —— 那会让屏上每个指标的红绿都是猜的，
    //   而且猜错了不会有任何东西报错（永远绿的那种错）。
    // ⚠ 已知缺口：`MetricRow.direction` 只有两态，**没有「持平 / 不可判」**（签名本单冻结）。
    //   故持平、或任一端缺格时一律落 `dn` —— 取 `dn` 不取 `up` 是因为 `up` 在样式上是告警色，
    //   拿「没变 / 不知道」去点一个告警是**主动误报**，比落在中性偏静的那一档更糟。
    direction: directionOf(firstReading(m.baseline), lastReading(m.actual)),
    segments: m.segments.map((s) => ({
      startPct: ((s.fromTick - t0) / cells) * 100,
      widthPct: Math.max(0, ((s.toTick - s.fromTick + 1) / cells) * 100),
      tone: SOURCE_TONE[s.source] ?? UNKNOWN_SOURCE_TONE,
      label: chainNodeDef(s.nodeId)?.label ?? s.label,
    })),
  }));

  return {
    rows,
    // 逐格照抄回包的 tick 序列（后端给的是整型 tick，屏上是文本刻度）。
    // **不补齐、不改写、不套 `HOUR_TICKS` 那套占位时刻** —— 那是墙钟口径，这里是模拟时钟。
    ticks: ticks.map((t) => String(t)),
    playheadPct: playheadPctOf(res),
    source: "endpoint",
  };
}

/** 变大 = `up`，变小 = `dn`。**只表示方向，不表示好坏**（理由见调用点的注释）。 */
function directionOf(before: number | null, after: number | null): "up" | "dn" {
  if (before === null || after === null) return "dn";
  return after > before ? "up" : "dn";
}

/**
 * 播放头 = **世界线当前格**在窗口里的位置。**绝不拿墙钟算** —— 这是模拟时钟，
 * 与 `Date.now()` 没有任何关系（拿墙钟算出来的播放头，会在同一个回包上每秒给出不同答案）。
 *
 * 回包里**没有 `curTick` 字段**。当前格是这样**推出来**的，前提写在明面上：
 * 本 hook **不发 `from`/`to`** ⇒ 后端 `requestedTo = args.to ?? curTick`
 * （`apps/datacore/src/sim/metric-series.ts` 的窗口收敛段）⇒ `toTick === curTick`。
 * ⚠ 这条推理**只在不发窗口参数时成立**。哪天这里加了 `?from=&to=`，它立刻失效。
 *   故实现写成「在 `ticks` 里**找** `toTick` 的下标」而不是直接写死 100：
 *   找不到（窗口不含当前格 / `ticks` 为空）⇒ **置 0**，不猜。
 */
function playheadPctOf(res: SimMetricSeriesResponse): number {
  const i = res.ticks.indexOf(res.toTick);
  if (i < 0) return 0;
  const span = res.ticks.length - 1;
  return span <= 0 ? 0 : (i / span) * 100;
}

/**
 * 指标甘特的取数。**签名与调用方（`MetricGantt`）一字未动**，改的全在函数体里。
 *
 * @param sessionId 沙盘世界 id（由 `SandboxHomeRoute` → `useConsoleSession` 一路透下来）。
 *   **没有 id ⇒ 一个请求都不发**（`enabled:false`），而不是发一个必然 404 的请求去换同一个结论。
 *
 * 三种情形一律回落规格占位、并把 `source` 如实标成 `"placeholder"`：
 *   ① 没会话（`enabled:false`）· ② 这一跳失败（404 / 500 / 网络，`retry:false` 不重试）·
 *   ③ 回包零指标（这个世界还没有任何可画的指标 —— 画一张空表比落占位更难看，
 *      但**诚实位仍是 `placeholder`**：屏上那 12 行确实不是算出来的）。
 *
 * 缓存键与 `useContributionSeries` / `useExecutionCompare` **共用** `["a","sim-metric-series",id]`：
 * 同一会话的这条端点全仓只打一次，且三处同时随 `sim.*` 事件失效（`store/eventInvalidation.ts`）。
 */
export function useMetricSeries(sessionId?: string): MetricSeries {
  const enabled = sessionId !== undefined && sessionId !== "";
  const q = useQuery({
    queryKey: ["a", "sim-metric-series", sessionId ?? ""],
    enabled,
    retry: false,
    queryFn: () => api.a<SimMetricSeriesResponse>(metricSeriesPath(sessionId as string)),
  });
  if (!enabled || q.data === undefined || q.data.metrics.length === 0) return PLACEHOLDER;
  return projectMetricSeries(q.data);
}
