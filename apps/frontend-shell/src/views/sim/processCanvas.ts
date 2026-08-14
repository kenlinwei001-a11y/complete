/**
 * WO-SANDBOX-PROCESS-MODE / **WO-R9-METRO-UX** · 推演沙盘主画布**第五档「业务流程」**的纯派生层。
 *
 * ── 这个文件解决的问题 ────────────────────────────────────────────────────────
 * 仓主原话：「点击每个 node 后展示与其他 node ＋ node 内部 sub-node 的**完整本体关系**」
 * 「右侧节点要**完整**」。65 条业务流程此前只在「流程等待态」那一页出现，沙盘主画布看不见；
 * 上一轮把它判成「两层不能合并 ⇒ 只能放在别的页」——**那个判断是错的**。
 *
 * ── WO-R9-METRO-UX：为什么从**卡片泳道**改成**地铁线路图** ────────────────────
 * 仓主两次原话：①「右侧图片是**业务端到端路线图**」（附参考图 = 地铁线路样式）；
 * ② 看到第五档真屏后 —— 「**没有看到类似『地铁线路』的 UX**」。
 * 上一版把 65 条按域铺成分组卡片墙：信息是全的，但**形不对** ——
 * 卡片墙表达不出「一条线、按顺序流过若干站」这件事，而那正是仓主要的语义。
 * 本轮改成与第一档 `ChainLineMapView` **同一套视觉语言**的线路图：站圈 / 连线 / 换乘 /
 * 图例 / 缩放平移，几何常量与算法**直接 import 自 `chainLineMap.ts`**（同一份实现，不抄第二套）。
 *
 * ── ⛔ 本档必须守住的那条约束（它没有被放宽，只是被读对了）─────────────────────
 * `packages/contracts/src/process.ts` 文件头原文：链路节拍层（24 条 `CHAIN_NODE_REGISTRY`）
 * 与业务流程层（65 条 `ProcessDefinition`）「两层粒度不同，**不能互相替代，也不能合并**」。
 * 那句话约束的是**两个数据模型**：不许互相顶替、不许揉成一张表。
 * 它**没有**约束「不能同屏」—— 同屏 ≠ 同模型。
 *
 * 故本档是**另一个图层**：自己的取数（`GET /a/v1/process-definitions`）、自己的检视面板
 * （`ProcessInspectPanel`）、自己的选中态（`processKey`，不是 `nodeId`），
 * 只是共用同一块画布区域与同一套档位按钮。本文件**不 import** `sandboxConsoleModel` 的任何
 * 节点视图模型，也**不写**任何 `nodeId`。
 *
 * ⚠ **本轮新增的 import 边界说明（别读成"两层合并了"）**：本文件现在从 `chainLineMap.ts`
 *   import 了 6 个符号，**逐个都是几何**，一个不多：
 *   `METRO_LAYOUT`（版面常量）· `STATION_RADIUS`（半径上下夹取）· `metroRowPlan`（折行方案）·
 *   `estimateLabelWidth`（纯函数估字宽）· `labelBoxesOverlap`（包围盒相交）· `LabelBox`/`MetroRowPlan`（类型）。
 *   那些是**画布坐标算法**，与「链路节拍层有哪 24 个节点」毫无关系。
 *   本文件**一个** `StationVM` / `ChainLineMap` / `ChainStage` / `stepId` 都没 import，
 *   一个 `nodeId` 都不读、不显示、不映射。判据仍由下面 §2 的交集函数现算并画到屏上。
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 §0 · 「线怎么连」的依据 —— **本档不臆造顺序**（WO-R9 最容易出错的那一条）
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 派单原话：「**线怎么连必须有真依据，不许臆造顺序**……编一个看起来像流程的顺序，
 * 比卡片墙更坏 —— 它看着专业，但那个顺序不会因为现实变化而变」。
 * 故先把「后端到底下发了什么」查到取值处（铁律 0.5：grep 不是结论，追到取值处），结论如下：
 *
 * **① 本档取数端点 `GET /a/v1/process-definitions` 里，流程与流程之间一条先后关系都没有。**
 *    这不是「我 grep 没找到」，是**结构证明**：响应里的每条流程都过
 *    `ProcessDefinitionSchema`，而它是 `z.strictObject`（多一个字段就抛），
 *    字段恰好是 `id/tenantId/key/domainKey/name/ownerFunctionKey/stdDurationDays/
 *    waitKind/carrierTypeKey` —— **没有 predecessor / successor / stationIndex / order**。
 *    `strictObject` 同时保证后端不可能"多发一个字段"而前端没接到。
 *
 * **② 编号相邻 ≠ 先后。** `P##` 是业务 key 不是序关系，两个**实测反例**（都在
 *    `apps/datacore/src/process/flow-rules.ts` 文件头，是真跑数据逼出来的，不是推的）：
 *    · 真实链 B 是 `P43 → P47`，**跳过** P44/P45/P46 —— 编号连续的三条根本不在这条链上；
 *    · 第一版把链 B 写成 `P42 → P43 → P47`，真跑一遍 `P42.avgGapDaysToNext = **−9.82 天**`
 *      —— 负的站间间隔，机器当场把建模错误抖出来（P42 工单下达是**伞**，不是前一站）。
 *    ⇒ **把 P## 升序画成箭头，就是在复现那个已经被实测证伪的错误。本档不这么做。**
 *
 * **③ 真正的站序确实存在，但不在本档够得着的地方。**
 *    `BATTERY_PROCESS_FLOW_RULES`（`apps/datacore/src/process/flow-rules.ts:104`）
 *    有 6 条链、覆盖 8 条流程，其中**只有 2 条是真多站**（`P33→P34→P35`、`P43→P47`），
 *    每一行都是逐条查实测数据填出来的。它经 `process_flow_time` 求解器与
 *    `GET /a/v1/process-definitions/{key}/instances` 下发（带 `flowKey` + `stationIndex`），
 *    **不经本档这个端点**。要在本档画出实测站序，需要改 datacore 加一条下发 —— 那在本单
 *    范围边界之外，故**如实缺席**并把探针写在屏上，不偷偷编一个顺序顶上。
 *
 * ⇒ **处置（照派单指定的退路）**：退回**按域分线** —— 一条线 = 一个一级业务域。
 *    · 线与线的**上下次序** = 端点下发的 `ProcessDomain.order`。⚠ 契约对该字段的原文是
 *      「**展示序**（确定性 R6：种子固定，不靠 Map 迭代序）」—— 那是**稳定展示序**，
 *      **不是业务先后**。故本档只拿它排版，屏上明写这一句，不许读成「D01 之后是 D02」。
 *    · 站在线上的**左右次序** = 域内 `key` 升序（全序、确定性），**同样不是先后**。
 *    · **连线一律画虚线**（`orderBasis = "display-order"`）：实线在地铁隐喻里读作"这样流"，
 *      而我们没有这个依据。**虚线是这张图最重要的诚实位** —— 哪天真拿到实测站序，
 *      再把那几段改成实线，语义差别一眼可辨。
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * § 结构红线：两层的键集合必须**交集为空**（机器先说话，不靠人记得）
 * ══════════════════════════════════════════════════════════════════════════════
 * `chainLayerOverlap()` 现算「本档要渲染的流程键」∩「24 个冻结 nodeId」。
 * **2026-08-14 实测**（原文来自 `verify-reclaim-6` 的 `4ee79122`，rebase 时**保留不丢**）：
 * 真后端 65 条 / mock 11 条，交集均为空（屏上 `spc-disjoint[data-overlap]="0"`）。
 * 复验：`pnpm --filter frontend-shell exec vitest run sandbox-process-mode`（§A1 先证该函数**能说「有」**，
 * 否则它说「没有」一文不值；§C1 才咬交集为空）。⚠ 有保质期：两层任一侧改键空间即须重测。
 * ⚠ WO-R9-METRO-UX 起，这个交集算的是**真要画上去的那批键**（`lines→stations→key`），
 *   不是响应里那批 —— 两者今天恒等，但**度量的不是同一件事**（响应干净、渲染时改名的话，
 *   按响应算会屏上写 0 而 DOM 里真有交集）。改成同源后，§C1 的「同源判据」那条断言才咬得住。
 * 非空 = 有人把两层揉了（例如把 `ProcessDefinition` 塞进 `CHAIN_NODE_REGISTRY`，
 * 或给流程编了个 `capacity.*` 形状的键）。这个数**画在屏上**（`spc-disjoint`），
 * 并被 `sandbox-process-mode.seam.test.tsx` 咬死 —— 揉了当场红。
 * ⚠ 这里 import `CHAIN_NODE_REGISTRY` 是为了**证明两层不相交**，不是为了合并它们。
 *
 * ── 条数不写死 ────────────────────────────────────────────────────────────────
 * 全档不出现 `65`。总数一律来自端点下发的 `definitions.length`；
 * 「一条不少」的判据是**现算的恒等式**：`total === Σ 各线站数`（`linesCoverAll`），
 * 而不是把某个金值抄进前端（种子一变就假红/假绿，本仓 #99 的老坑）。
 *
 * R6 确定性：纯函数，无 `Date.now`、无随机；排序全序（域按 `order` 再按 `key`，
 * 流程按 `key` 升序），几何**只算不量**（不摸 DOM、不依赖字体加载），
 * 同输入两次渲染字节级一致。
 */
import { CHAIN_NODE_REGISTRY, type ProcessDefinition, type ProcessWaitKind } from "@platform/contracts";
import type { ProcessDefinitionsResponse } from "@/views/process/processWait";
import {
  METRO_LAYOUT,
  STATION_RADIUS,
  estimateLabelWidth,
  labelBoxesOverlap,
  metroRowPlan,
  type LabelBox,
  type MetroRowPlan,
} from "./chainLineMap";

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · 视图模型
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 线路图上的**一个站** = 一条业务流程。字段分两族，别混：
 *  · **数据族**（`key`…`domainKey`）—— 响应的**投影**，不新增口径、不派生任何业务数字；
 *  · **几何族**（`x`/`y`/`r`/`label*`）—— 画布坐标，纯几何，与业务含义无关。
 */
export interface ProcessStationVM {
  readonly key: string;
  readonly name: string;
  readonly waitKind: ProcessWaitKind;
  readonly ownerFunctionKey: string;
  /** 责任职能展示名；登记册里查不到 ⇒ 回退原 key（**不静默留空**，空白会把断线伪装成"没有"）。 */
  readonly ownerName: string;
  readonly stdDurationDays: number;
  /** 承载物类型键 —— 这是「node 内部 sub-node 的完整本体关系」那条链的入口。 */
  readonly carrierTypeKey: string;
  readonly domainKey: string;
  /**
   * **换乘站**：与本站**共用同一个承载物**的其它流程键（升序）。非空 ⇒ 画双环。
   *
   * ⚠ 语义必须当面说清楚（照第一档 `AND≠OR` 那条诚实位的做法）：
   * 共用承载物**只说明两条流程作用在同一个对象上**，
   * **不说明它们有先后、也不说明有依赖**。契约 `process.ts` 文件头原文：
   * 「两条流程共用同一个承载物（如 P37 MPS 与 P40 APS 都落在 ProductionSchedule）……
   *   共用不是空壳」。本档把它画成换乘，是因为它是端点下发的字段里
   *   **唯一一条真的把两条流程连起来的关系** —— 不是因为它像先后。
   */
  readonly sharedCarrierWith: readonly string[];
  /** 站圈半径（px）。∝ √(标准工期 / 本次下发的最大标准工期)，见 `processStationRadius`。 */
  readonly r: number;
  readonly x: number;
  readonly y: number;
  /** 本站在所属线上的第几行第几列（折行用；`metroSlotPoint` 的同一套算法）。 */
  readonly row: number;
  readonly col: number;
  /** 站名/读数两行的摆位（一律在线**下方**，同侧分两层交替，见 `placeStationLabel`）。 */
  readonly label: ProcessLabelVM;
}

/** 站名标签的摆位结果。几何只算不量 ⇒ 「相邻标签不压字」在模型层就可断言。 */
export interface ProcessLabelVM {
  /** 同侧第几层（0 / 1 交替）。 */
  readonly tier: number;
  /** `textAnchor="middle"` 的 x。 */
  readonly x: number;
  /** 站名行基线。 */
  readonly nameY: number;
  /** 读数行（`P## · N天`）基线。 */
  readonly subY: number;
  readonly box: LabelBox;
}

/**
 * **一条线 = 一个一级业务域**。
 *
 * ⚠ 为什么不是「一条线 = 一条端到端业务链」：因为端点没下发流程间先后（见文件头 §0）。
 * 按域分线是派单指定的退路，且它是**真的**：`domainKey` 就在响应里，不是编的。
 */
export interface ProcessLineVM {
  readonly domainKey: string;
  readonly domainName: string;
  /** 该域在登记册里有没有登记。`false` ⇒ 域名回退为裸 key，并在屏上标出来。 */
  readonly registered: boolean;
  /**
   * 线号（1 起，按本次排序后的位次现算）。地铁图的「几号线」——
   * **纯展示编号**，不是 `ProcessDomain.order` 的透传，也不承诺任何业务次序。
   */
  readonly lineNo: number;
  readonly stations: readonly ProcessStationVM[];
  /** 该域累计标准工期（天，一位小数）。**标准工期不是实测滞留**，措辞由调用方负责。 */
  readonly totalStdDays: number;
  /** 折行方案（站数超过一行装得下时）。 */
  readonly rowPlan: MetroRowPlan;
  /** 本条线第一行的基线 y。 */
  readonly y0: number;
  /** 线头标签的锚点（画在最左，x < 站位起点）。 */
  readonly headX: number;
  readonly headY: number;
  /** 连接相邻两站的线段（**虚线**，见 `orderBasis`）。折行处不连（由折行竖线接）。 */
  readonly segments: readonly ProcessSegmentVM[];
}

/** 两站之间的一段连线。 */
export interface ProcessSegmentVM {
  readonly fromKey: string;
  readonly toKey: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** 一条换乘弧：把两条**共用承载物**的流程连起来（画在线**上方**，不与站名标签抢地方）。 */
export interface ProcessInterchangeVM {
  readonly carrierTypeKey: string;
  readonly fromKey: string;
  readonly toKey: string;
  /** 二次贝塞尔的 `d`（起点/控制点/终点都在画布坐标系里）。 */
  readonly d: string;
  /** 两端是否在**不同的线**上（跨线换乘在地铁图里才是"换乘"的本意）。 */
  readonly crossLine: boolean;
}

/**
 * 「线怎么连」的依据档位。**画在屏上、被门咬**，不是注释里的一句话。
 *  · `display-order` —— 端点没下发先后，连线只表示「同一条线上按稳定展示序排列」⇒ **虚线**。
 *  · `measured`      —— 实测站序（今天本档拿不到，见文件头 §0 ③）⇒ 将来才画实线。
 *
 * 留下第二个档位**不是**为了以后好扩展，是为了让「今天是哪一档」这件事在类型上就得选一个，
 * 不会有人默默把虚线改成实线而没有任何地方需要跟着改。
 */
export type ProcessOrderBasis = "display-order" | "measured";

export interface ProcessCanvasModel {
  /** 端点下发的流程条数（唯一真值源，**前端不写死**）。 */
  readonly total: number;
  /** 各条线站数之和。与 `total` 不等即为渲染层漏画（见 `linesCoverAll`）。 */
  readonly laid: number;
  readonly lines: readonly ProcessLineVM[];
  /** 端点下发但域登记册里没有的 domainKey（非空 ⇒ 接缝漂移，屏上明写，不静默并进"其它"）。 */
  readonly unregisteredDomainKeys: readonly string[];
  /** 四态各几条（等待类型词表来自契约，本文件不另抄一份）。 */
  readonly byWaitKind: readonly { readonly kind: ProcessWaitKind; readonly count: number }[];
  /** 结构红线：与链路节拍层 24 个冻结 nodeId 的键交集。**恒须为空**。 */
  readonly chainLayerOverlap: readonly string[];
  /** 换乘弧（共用承载物）。空数组 = 本次下发里没有任何两条流程共用承载物。 */
  readonly interchanges: readonly ProcessInterchangeVM[];
  /** 站序依据档位。今天恒为 `display-order`，理由见文件头 §0。 */
  readonly orderBasis: ProcessOrderBasis;
  /** 画布尺寸（缩放/平移的 `fitTransform` 要用）。 */
  readonly canvas: { readonly w: number; readonly h: number };
  /**
   * 本次下发里最长的标准工期（天）。站圈半径按它归一 ——
   * **相对量，不是绝对量**：换一批数据圈会重新分布，屏上图例必须把这句话说出来。
   */
  readonly maxStdDays: number;
  /**
   * 分层封顶后**仍然摆不下**的站名（升序）。非空 ⇒ 屏上如实标出来，
   * 不偷偷藏一个标签，也不假装没挤（照第一档 `labelOverflow` 的既有做法）。
   */
  readonly labelOverflow: readonly string[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 结构红线：两层键集合不相交
// ══════════════════════════════════════════════════════════════════════════════

/** 24 个冻结 nodeId 的集合。**只用于求交集**（证明不相交），不用于渲染、不用于映射。 */
const CHAIN_NODE_IDS: ReadonlySet<string> = new Set(CHAIN_NODE_REGISTRY.map((n) => n.nodeId));

/**
 * 现算「这批流程键」∩「链路节拍层 nodeId」。
 *
 * 返回空数组 = 两层没被揉在一起（今天的事实）。返回非空 = **本档把两层合并了**，
 * 那正是 `contracts/src/process.ts` 文件头禁止的事。判据放在这里而不是只放在测试里，
 * 是因为「写在注释里的纪律不是机制」—— 这个数会被画到屏上，也会被 SEAM 门咬。
 */
export function chainLayerOverlap(processKeys: readonly string[]): string[] {
  return processKeys.filter((k) => CHAIN_NODE_IDS.has(k)).sort();
}

/** 金丝雀：喂一个**已知必中**的 nodeId 进去，它必须被判为重叠。 */
export function chainLayerOverlapCanaryKey(): string {
  const first = CHAIN_NODE_REGISTRY[0];
  if (first === undefined) throw new Error("[processCanvas] CHAIN_NODE_REGISTRY 为空 —— 契约坏了，不是两层不相交");
  return first.nodeId;
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · 几何常量 —— **算出来的，不是"看着够"拍出来的**
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 本档的版面常量。凡能由 `chainLineMap.METRO_LAYOUT` / `STATION_RADIUS` 推出来的
 * **一律推**，不另写一个数 —— 第一档的注释原文：
 * 「写死一个"看着够"的数字就是下一次压字的种子」。
 */
export const PROC_LAYOUT = {
  /**
   * 相邻站位水平间距。比第一档的 `METRO_LAYOUT.gapX`(122) 宽，理由是**本档每一站都要标名字**
   * （第一档只标一部分，靠 `pickLabelledStepIds` 抽稀）。
   * 硬约束：必须 > `2 × STATION_RADIUS.max`（相邻最大两站不重叠）—— 由门验算，不靠肉眼。
   */
  gapX: 150,
  /** 左侧留白：要容得下**线头标签**（域名 + 域 key + 线号）。 */
  padX: 168,
  padTop: 52,
  padBottom: 44,
  /** 标签第一层与站圈边缘的距离（沿用第一档口径）。 */
  labelBase: METRO_LAYOUT.labelBase,
  /** 同侧标签分层的层距（沿用第一档口径，必须 ≥ `labelBoxH`）。 */
  labelTierGap: METRO_LAYOUT.labelTierGap,
  /** 同侧最多分几层。**故意封顶**（同第一档）：不封顶就会用"再加一层"掩盖版面挤。 */
  maxLabelTiers: METRO_LAYOUT.maxLabelTiers,
  labelBoxH: METRO_LAYOUT.labelBoxH,
  labelFontPx: METRO_LAYOUT.labelFontPx,
  labelLineH: METRO_LAYOUT.labelLineH,
  labelGapX: METRO_LAYOUT.labelGapX,
  /** 换乘弧向上拱起的高度（画在线上方；下方是标签带，两者不抢地方）。 */
  interchangeRise: 26,
  /** 行/线之间额外的走线沟。 */
  gutter: 14,
  minWidth: METRO_LAYOUT.minWidth,
} as const;

/**
 * 单侧标签带的最大厚度（px）= 第一层让位 + 分层推开的总量 + 标签块高。
 * 与第一档 `metroLabelBandPx()` 同式（那边还加了站圈半径，这里在 `lineGapPx()` 里单独加）。
 */
export function procLabelBandPx(): number {
  return PROC_LAYOUT.labelBase + (PROC_LAYOUT.maxLabelTiers - 1) * PROC_LAYOUT.labelTierGap + PROC_LAYOUT.labelBoxH;
}

/**
 * 两条线（或同一条线折行后两行）之间的垂直距离。**推出来的**：
 * 站圈上缘 + 换乘弧拱高（线**上方**）+ 站圈下缘 + 标签带（线**下方**）+ 走线沟。
 * 少任一项就会出现「上一条线的标签压到下一条线的换乘弧」——门直接验算这个不等式。
 */
export function lineGapPx(): number {
  return (
    STATION_RADIUS.max + PROC_LAYOUT.interchangeRise + STATION_RADIUS.max + procLabelBandPx() + PROC_LAYOUT.gutter
  );
}

/**
 * **站圈大小 ∝ 标准工期**（面积 ∝ 工期 ⇒ 半径 ∝ √工期），再叠上下夹取。
 *
 * ── 为什么不直接调第一档的 `stationRadius()` ────────────────────────────────
 * 那个函数的定义域是**百分比**（`pctOfChainLoss`，0–100，占比语义）。
 * 把「天」喂进去是**单位错误**：60 天会被读成 60%，而 1 天被读成 1% ——
 * 数字碰巧在范围内，所以**不会报错，只会画错**，正是最难发现的一类。
 * 故本档自己按 `maxStdDays` 归一，但**复用同一套上下夹取常量与同一条 √ 映射**，
 * 保证两档的"圈大小"读法一致（这才是"同一套视觉语言"的意思）。
 *
 * `maxStdDays <= 0`（理论上不可能：契约要求 `stdDurationDays` 为正）⇒ 一律给 `min`，
 * 不做除零。
 */
export function processStationRadius(days: number, maxStdDays: number): number {
  if (!(maxStdDays > 0) || !(days > 0)) return STATION_RADIUS.min;
  const ratio = Math.max(0, Math.min(1, days / maxStdDays));
  const r = STATION_RADIUS.min + (STATION_RADIUS.max - STATION_RADIUS.min) * Math.sqrt(ratio);
  return Math.round(Math.max(STATION_RADIUS.min, Math.min(STATION_RADIUS.max, r)) * 100) / 100;
}

/**
 * 站名标签摆位：一律在线**下方**（上方留给换乘弧），同侧按列号奇偶**分两层交替**。
 *
 * 交替而不是全挤一层，是因为中文站名普遍比 `gapX` 宽（实测「产能投资立项与评审」
 * 8 个全角字 ≈ 88px，加上读数行仍逼近间距）；两层交替把有效水平间距翻倍。
 * 封顶两层后仍撞的，**如实记进 `labelOverflow`**，不再加层。
 */
export function placeStationLabel(x: number, y: number, r: number, col: number, name: string, sub: string): ProcessLabelVM {
  const tier = col % PROC_LAYOUT.maxLabelTiers;
  const top = y + r + PROC_LAYOUT.labelBase + tier * PROC_LAYOUT.labelTierGap;
  const w = Math.max(estimateLabelWidth(name, PROC_LAYOUT.labelFontPx), estimateLabelWidth(sub, PROC_LAYOUT.labelFontPx));
  return {
    tier,
    x,
    nameY: top + PROC_LAYOUT.labelLineH,
    subY: top + PROC_LAYOUT.labelLineH * 2,
    box: { x: x - w / 2, y: top, w, h: PROC_LAYOUT.labelBoxH },
  };
}

/** 第 `index` 个站位落在本条线的第几行第几列、画布坐标是多少（与第一档同一套折行算法）。 */
export function procSlotPoint(index: number, plan: MetroRowPlan, y0: number): { row: number; col: number; x: number; y: number } {
  const row = Math.min(plan.rowCount - 1, Math.floor(index / plan.perRow));
  const col = index - row * plan.perRow;
  return { row, col, x: PROC_LAYOUT.padX + col * PROC_LAYOUT.gapX, y: y0 + row * lineGapPx() };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 4 · 组装
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 把 `GET /a/v1/process-definitions` 的响应折成第五档要用的**线路图**视图模型。
 *
 * 判据①：**一条都不许掉**。域登记册里查不到的 `domainKey` 不丢弃，单开一条线并标
 *        `registered:false` —— 静默丢弃会让「后端漏发了这个域」与「前端漏画了这个域」
 *        在屏幕上长得一模一样。
 * 判据②：**排序确定性**（R6）。域按 `order` 升序、同序按 `key`；未登记域排最后按 key；
 *        线内流程按 `key` 升序。不依赖响应序、不依赖 `Map` 迭代序。
 * 判据③：**不写死条数**。`total` 取 `definitions.length`；四态计数按契约词表全列（含 0 条的态）。
 * 判据④：**不臆造顺序**。`orderBasis` 恒为 `display-order`，连线画虚线（见文件头 §0）。
 */
export function buildProcessCanvasModel(res: ProcessDefinitionsResponse, waitKindOrder: readonly ProcessWaitKind[]): ProcessCanvasModel {
  const domainName = new Map(res.domains.map((d) => [d.key, d.name] as const));
  const domainOrder = new Map(res.domains.map((d) => [d.key, d.order] as const));
  const ownerName = new Map(res.ownerFunctions.map((f) => [f.key, f.displayName] as const));

  // ── 承载物 → 用它的流程键（升序）。换乘关系的**唯一**来源，现算不写死。
  const byCarrier = new Map<string, string[]>();
  for (const p of res.definitions) {
    const bucket = byCarrier.get(p.carrierTypeKey);
    if (bucket === undefined) byCarrier.set(p.carrierTypeKey, [p.key]);
    else bucket.push(p.key);
  }
  for (const v of byCarrier.values()) v.sort((a, b) => a.localeCompare(b));

  const maxStdDays = res.definitions.reduce((m, p) => Math.max(m, p.stdDurationDays), 0);

  const sorted = [...res.definitions].sort((a, b) => a.key.localeCompare(b.key));

  const byDomain = new Map<string, ProcessDefinition[]>();
  for (const p of sorted) {
    const bucket = byDomain.get(p.domainKey);
    if (bucket === undefined) byDomain.set(p.domainKey, [p]);
    else bucket.push(p);
  }

  const unregisteredDomainKeys = [...byDomain.keys()].filter((k) => !domainName.has(k)).sort();

  const orderedDomains = [...byDomain.entries()].sort(([ka], [kb]) => {
    // 已登记域排在未登记域之前；组内按 order，再按 key —— 全序，无并列歧义。
    const ra = domainName.has(ka);
    const rb = domainName.has(kb);
    if (ra !== rb) return ra ? -1 : 1;
    const oa = domainOrder.get(ka) ?? Number.MAX_SAFE_INTEGER;
    const ob = domainOrder.get(kb) ?? Number.MAX_SAFE_INTEGER;
    return oa - ob || ka.localeCompare(kb);
  });

  // ── 画布宽度由**最宽的那一行**决定（各线折行方案可能不同）。
  const plans = orderedDomains.map(([, defs]) => metroRowPlan(defs.length));
  const widestRow = plans.reduce((m, p) => Math.max(m, p.perRow), 1);
  const canvasW = Math.max(PROC_LAYOUT.minWidth, PROC_LAYOUT.padX + PROC_LAYOUT.padX / 2 + Math.max(0, widestRow - 1) * PROC_LAYOUT.gapX);

  const gap = lineGapPx();
  const stationByKey = new Map<string, { st: ProcessStationVM; lineIdx: number }>();
  let cursorY = PROC_LAYOUT.padTop + STATION_RADIUS.max + PROC_LAYOUT.interchangeRise;

  const lines: ProcessLineVM[] = orderedDomains.map(([domainKey, defs], lineIdx) => {
    const plan = plans[lineIdx]!;
    const y0 = cursorY;
    const stations: ProcessStationVM[] = defs.map((p, i) => {
      const slot = procSlotPoint(i, plan, y0);
      const r = processStationRadius(p.stdDurationDays, maxStdDays);
      const sub = `${p.key} · ${round1(p.stdDurationDays)}天`;
      return {
        key: p.key,
        name: p.name,
        waitKind: p.waitKind,
        ownerFunctionKey: p.ownerFunctionKey,
        ownerName: ownerName.get(p.ownerFunctionKey) ?? p.ownerFunctionKey,
        stdDurationDays: p.stdDurationDays,
        carrierTypeKey: p.carrierTypeKey,
        domainKey: p.domainKey,
        sharedCarrierWith: (byCarrier.get(p.carrierTypeKey) ?? []).filter((k) => k !== p.key),
        r,
        x: slot.x,
        y: slot.y,
        row: slot.row,
        col: slot.col,
        label: placeStationLabel(slot.x, slot.y, r, slot.col, p.name, sub),
      };
    });
    for (const st of stations) stationByKey.set(st.key, { st, lineIdx });

    // 相邻两站连一段（**同一行内**才连；折行处由视图画竖向折返，不在这里造一段横跨画布的假线）。
    const segments: ProcessSegmentVM[] = [];
    for (let i = 1; i < stations.length; i += 1) {
      const a = stations[i - 1]!;
      const b = stations[i]!;
      if (a.row !== b.row) continue;
      segments.push({ fromKey: a.key, toKey: b.key, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }

    cursorY = y0 + plan.rowCount * gap;
    return {
      domainKey,
      domainName: domainName.get(domainKey) ?? domainKey,
      registered: domainName.has(domainKey),
      lineNo: lineIdx + 1,
      stations,
      totalStdDays: round1(defs.reduce((s, p) => s + p.stdDurationDays, 0)),
      rowPlan: plan,
      y0,
      headX: PROC_LAYOUT.padX - STATION_RADIUS.max - 14,
      headY: y0,
      segments,
    };
  });

  // ── 换乘弧：每个「共用承载物」的组内**相邻两条**连一条（组内 3 条就是 2 条弧，不画完全图）。
  const interchanges: ProcessInterchangeVM[] = [];
  for (const [carrierTypeKey, keys] of [...byCarrier.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (keys.length < 2) continue;
    for (let i = 1; i < keys.length; i += 1) {
      const a = stationByKey.get(keys[i - 1]!);
      const b = stationByKey.get(keys[i]!);
      if (a === undefined || b === undefined) continue;
      const rise = PROC_LAYOUT.interchangeRise;
      const y1 = a.st.y - a.st.r;
      const y2 = b.st.y - b.st.r;
      const cx = (a.st.x + b.st.x) / 2;
      const cy = Math.min(y1, y2) - rise;
      interchanges.push({
        carrierTypeKey,
        fromKey: a.st.key,
        toKey: b.st.key,
        d: `M ${a.st.x} ${y1} Q ${cx} ${cy} ${b.st.x} ${y2}`,
        crossLine: a.lineIdx !== b.lineIdx,
      });
    }
  }

  // ── 标签压字体检：同一层里 x 相邻的两个标签包围盒不许相交。撞了就如实记账。
  const labelOverflow: string[] = [];
  for (const line of lines) {
    const byTier = new Map<string, ProcessStationVM[]>();
    for (const st of line.stations) {
      const k = `${st.row}#${st.label.tier}`;
      const bucket = byTier.get(k);
      if (bucket === undefined) byTier.set(k, [st]);
      else bucket.push(st);
    }
    for (const group of byTier.values()) {
      const ordered = [...group].sort((a, b) => a.label.box.x - b.label.box.x);
      for (let i = 1; i < ordered.length; i += 1) {
        if (labelBoxesOverlap(ordered[i - 1]!.label.box, ordered[i]!.label.box, PROC_LAYOUT.labelGapX)) {
          labelOverflow.push(ordered[i]!.key);
        }
      }
    }
  }
  labelOverflow.sort((a, b) => a.localeCompare(b));

  const byWaitKind = waitKindOrder.map((kind) => ({
    kind,
    count: sorted.filter((p) => p.waitKind === kind).length,
  }));

  return {
    total: res.definitions.length,
    laid: lines.reduce((s, l) => s + l.stations.length, 0),
    lines,
    unregisteredDomainKeys,
    byWaitKind,
    /**
     * ⚠ 交集必须算**真的要画上去的那批键**（`lines→stations→key`），
     * 不是响应里那批（`res.definitions`）。两者今天恒等，但**它们度量的不是同一件事**：
     * 响应里干净、渲染时被改名成 `capacity.*` 的话，按响应算会屏上写着 0 而 DOM 里真有交集
     * —— 那正是本仓铁律 0.6 那句「我用 X 当作 Y 的证据，而 X 并不度量 Y」。
     * 改这一行是写变异反证时逼出来的：按响应算的版本，变异体只红一半。
     */
    chainLayerOverlap: chainLayerOverlap(lines.flatMap((l) => l.stations.map((s) => s.key))),
    interchanges,
    // ⛔ 恒为 `display-order`：端点没下发先后（文件头 §0），改成 `measured` 之前
    //    必须先有一条真的下发实测站序的取数 —— 光把这个字面量改掉就是造假。
    orderBasis: "display-order",
    canvas: { w: canvasW, h: Math.max(1, cursorY - gap + STATION_RADIUS.max + procLabelBandPx() + PROC_LAYOUT.padBottom) },
    maxStdDays,
    labelOverflow,
  };
}

/**
 * 「一条不少」的**现算判据**（不写死条数）：各条线铺开的站数 == 端点下发的条数。
 * 屏上把两个数都印出来，不合等号即为漏画 —— 判据是恒等式，不是某个金值。
 */
export function linesCoverAll(m: ProcessCanvasModel): boolean {
  return m.total === m.laid;
}
