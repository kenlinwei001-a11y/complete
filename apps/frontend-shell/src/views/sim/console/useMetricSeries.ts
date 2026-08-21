/**
 * WO-SIM-FE-HOME · 底部「指标甘特」的**唯一取数口**。
 *
 * ── 为什么是一个 hook 而不是把数写进 JSX ────────────────────────────────────
 * 真端点还在做（`WO-SIM-BE-SERIES`）。派单原文：「本单先用规格 HTML 里那套占位数，
 * 但必须把取数抽成一个 `useMetricSeries()` hook，端点一到只换 hook 内部；
 * ⚠️ 占位数不许散在 JSX 里，否则接真数据时要满屏找」。
 * 于是本文件是**占位数在本仓的唯一落点**：`MetricGantt.tsx` 只认下面这个返回形状，
 * 端点落地时改的是 `useMetricSeries` 的函数体，视图一行不用动。
 *
 * ── 诚实位（不许静默）──────────────────────────────────────────────────────
 * 返回值带 `source`。今天恒为 `"placeholder"`，**这不是可以省略的元数据** ——
 * 屏上要读得出「这几个数不是真算出来的」，不许拿占位数冒充实测（本仓「绿测试≠能用」同族纪律）。
 * 端点接上后 `source` 变 `"endpoint"`，视图的诚实标记自动消失，无需再改视图。
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
import { chainNodeDef, type ChainNodeDef } from "@platform/contracts";

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
  /** `up` = 数变差（红）· `dn` = 数变好（绿）。**不是「变大/变小」** —— 稼动率跌是 `dn`。 */
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
   * 数据出身。`placeholder` = 规格占位数（`WO-SIM-BE-SERIES` 端点未到）；
   * `endpoint` = 真端点回包。视图据此决定要不要在屏上标「占位」。
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

const SPEC_ROWS: readonly SpecRow[] = [ // hardcoded-data-allow —— **规格占位数**，端点 WO-SIM-BE-SERIES 未到；派单原文要求先用它并把取数收进 useMetricSeries()，端点一到只换 hook 内部。这是全仓唯一一份，不许再抄第二处
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

/**
 * 指标甘特的取数。
 *
 * @param sessionId 沙盘世界 id。**今天不读它** —— 形参先摆好，端点（`WO-SIM-BE-SERIES`）到位时
 *   这里换成 `useQuery({ queryKey:["a","sim-metric-series",sessionId], … })`，
 *   **调用方与返回形状都不用改**。先留形参是刻意的：等端点到了再加参数，
 *   意味着届时视图也要跟着改一次，那正是本 hook 想省掉的那次改动。
 */
export function useMetricSeries(sessionId?: string): MetricSeries {
  void sessionId;
  return PLACEHOLDER;
}
