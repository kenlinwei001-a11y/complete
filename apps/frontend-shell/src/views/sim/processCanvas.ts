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
 *    有 6 条链、覆盖 **9** 条流程（`P25/P33/P34/P35/P41/P42/P43/P47/P51`），其中
 *    **只有 2 条是真多站**（`P33→P34→P35`、`P43→P47`），
 *    每一行都是逐条查实测数据填出来的。
 *    ⚠ **2026-08-14 现跑订正**：本句原写「覆盖 8 条流程」，实际是 9 ——
 *      `flowRuleCoveredProcessKeys()` 是「端点/文档/测试共用同一份，不许各数一遍」的
 *      单一事实源（`apps/datacore/src/process/flow-rules.ts:218`），它当日返回 9 个键。
 *      复验：`node -e "import('./apps/datacore/dist/process/flow-rules.js').then(m=>
 *      console.log(m.BATTERY_PROCESS_FLOW_RULES.length, m.flowRuleCoveredProcessKeys()))"`
 *      ⇒ `6 [ 'P25','P33','P34','P35','P41','P42','P43','P47','P51' ]`（需先 `pnpm -r build`）。
 *      同一句话的另一份拷贝在 `locales/zh.ts` 的 `orderBasisWhereReal`（屏上那句），已同步订正。
 *    它经 `process_flow_time` 求解器与
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
import type { TickState } from "@platform/contracts";
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
  /**
   * 节拍读数（WO-PROCESS-CANVAS-LIVE）。
   *
   * ⚠ **不传 `live` 参数时这个键根本不存在**（不是 `undefined`、不是 `null`）——
   * 那是 additive 契约的字面意思：`JSON.stringify(build(res, order))` 与本单之前**逐字节相同**。
   * 用 `?:` + 条件展开而不是 `X | null` 就是为了这一条：写成 `live: null` 会让每一座站
   * 多出 `"live":null` 十一个字节，"可回退"当场变成一句空话。
   */
  readonly live?: ProcessStationLiveVM;
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

// ══════════════════════════════════════════════════════════════════════════════
// 🔴 § 1.5 · 节拍维（WO-PROCESS-CANVAS-LIVE）
//     —— 本段回答仓主那句「它应该是在推演沙盘里面，且是一个**动态的数据变化**」
// ══════════════════════════════════════════════════════════════════════════════
/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ 本段最重要的那条判断（比接线本身更重要）：**不是所有流程都该被 tick 驱动**
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 派单原话：「『年度场景』『KSF』『竞对价格』这类本来就不随节拍变 ——
 * 强行让它们跟着 tick 抖动**就是造假**」。
 *
 * 于是屏上必须能把两件事分开：**「照不亮」** 与 **「本来就不该亮」**。
 * 本仓的老形态是「一个数盖住两个事实」，所以这里**不许**只给一个"有没有读数"的布尔。
 *
 * ── 判据（三档，全部现算，前端零字面量名单）────────────────────────────────
 * 判据必须能从**下发的数据**推出来，不许拍脑袋。可用的只有两样，都是端点真下发的：
 *   ① `GET /a/v1/sim/propagation-rules` 的 `sourceTypeKey ∪ targetTypeKey`
 *      —— **传导引擎在结构上够得着哪些对象类型**；
 *   ② `GET /a/v1/sim/view-config` 的 `nodeObjectIds[typeKey]`
 *      —— **这个世界里该类型有没有真物化对象**。
 *
 * | 档 | 判据 | 定性（三形态，修法不同） |
 * |---|---|---|
 * | `TICK_DRIVEN`        | carrier ∈ 规则两端类型 **且** 该类型有物化对象 | 推 tick 它真会动 |
 * | `NO_CARRIER_OBJECTS` | carrier ∈ 规则两端类型，但该类型 0 个物化对象 | **接了线没数据**：补数据即动 |
 * | `NOT_TICK_DRIVEN`    | carrier ∉ 规则两端类型                       | **没接线**：引擎结构上写不到它 |
 *
 * 为什么这条判据是**结构性**的而不是经验性的：`propagateTick`
 * （`apps/datacore/src/sim/propagation.ts:442`）唯一的写法是
 * `next[targetObjectId][targetStateVar] = …`，而 `targetObjectId` 只能来自规则的
 * `targetTypeKey` 那一端。⇒ 承载类型不在规则两端集合里的流程，**节拍怎么推都不会动**，
 * 这不是"今天恰好没变"，是"不可能变"。故屏上说「本层不随节拍变」是**事实陈述**，
 * 不是"暂时没数据"的委婉说法。
 *
 * **实测日期 2026-08-14**（真后端种子·数字有保质期，别照抄）：65 条流程 / 64 种承载物 ×
 * 13 条传导规则（两端共 11 种类型）⇒ 三档实为 **9 / 0 / 56**，即今天只有 **13.8%** 会随节拍动。
 * 复验命令（与 `locales/zh.ts` 的 `liveBasis` 同一条，别另抄一套）：
 *   `node -e "const s=require('fs').readFileSync('apps/datacore/src/seed.ts','utf8');
 *    const b=s.slice(s.indexOf('const DEMO_PROCESS_DEFINITIONS'),s.indexOf('export async function seedDemoProcessLayer'));
 *    const d=[...b.matchAll(/carrierTypeKey: \"([A-Za-z0-9_]+)\"/g)].map(m=>m[1]);
 *    const r=s.slice(s.indexOf('const DEMO_PROPAGATION_RULES'),s.indexOf('export async function seedDemoPropagationRules'));
 *    const t=new Set([...r.matchAll(/^\s*(?:source|target)TypeKey: \"([A-Za-z0-9_]+)\"/gm)].map(m=>m[1]));
 *    console.log(d.length, t.size, d.filter(x=>t.has(x)).length)"`  ⇒ 当日现跑 `65 11 9`。
 * ⚠ 抽规则时**必须逐字段抽**（种子里 `viaLinkKey` 行尾带 `// 实测 …` 注释，
 *   要求五行连续的整体正则会静默漏抽 8/13 而金丝雀照样绿 —— 本单亲手踩过，
 *   记账在 `docs/SYSTEM-ONTOLOGY.md` §8 `G-PROCESS-TICK-COVERAGE`）。
 * 缺口与「该补哪些传导规则」的建议同样登记在那一行。
 *
 * ── ⚠ 这条判据**测不出**的那件事（必须当面说，不许让它长得像已经答了）──────────
 * `NOT_TICK_DRIVEN` 只说明「**今天的传导图够不着它**」，
 * **不说明**「它本质上不该随节拍变」。
 * 「年度场景 / KSF」（真的不随日节拍变）与「物料平衡 / 工单」（该随节拍变、只是还没建模）
 * 今天**落在同一档里**，而端点下发的字段里没有任何一位能把它们分开 ——
 * 分开需要**建模判断**，不在 `ProcessDefinition`（strictObject，字段就那 9 个）
 * 也不在 `PropagationRule` 里。
 * ⇒ 本档如实把这句话写在屏上（`spc-live-limit`），不拿一个算得出的数去冒充一个算不出的结论。
 * 这正是本仓「我用 X 当作 Y 的证据，而 X 并不度量 Y」那条戒律的正面用法。
 */
export type ProcessTickDrive = "TICK_DRIVEN" | "NO_CARRIER_OBJECTS" | "NOT_TICK_DRIVEN";

/** 三档的稳定展示序（R6：不依赖 Map 迭代序；屏上与模型同一份序）。 */
export const TICK_DRIVE_ORDER: readonly ProcessTickDrive[] = ["TICK_DRIVEN", "NO_CARRIER_OBJECTS", "NOT_TICK_DRIVEN"];

/**
 * 传导规则的**两端类型投影**。
 *
 * ⚠ 刻意只取两个字段，不吃整条 `PropagationRule`：本层要回答的只有
 * 「引擎够不够得着这类承载物」，系数 / 延迟 / 闸门 / combine 与这件事无关。
 * 把整条规则搬进视图模型 = 把引擎语义复制到前端，那是第二套真相源。
 */
export interface ProcessLiveRuleRef {
  readonly sourceTypeKey: string;
  readonly targetTypeKey: string;
}

/**
 * 某一刻的世界态快照 = 仓主要的那个「**基于某个时间 screenshot**」。
 *
 * `origin` 照 `WorldOrigin` 的既有口径逐字沿用（`SandboxView.tsx:133`）：
 * `MEASURED` = tick 回包（后端真算的）· `DERIVED` = 建会话时塞的占位。
 * **两者绝不合并**：拿占位当实测就是本仓记过的「拿平均值冒充现场」。
 */
export interface ProcessTickSnapshot {
  readonly sessionId: string;
  readonly tick: number;
  readonly state: TickState;
  readonly origin: "MEASURED" | "DERIVED";
}

/**
 * 节拍维的输入。**整个参数是 optional 的**（见 `buildProcessCanvasModel` 的 additive 契约）。
 *
 * ⚠ `snapshot` 可以为 `null` 而 `rules` 仍非空：沙盘还没建会话时，
 * 「哪些流程随节拍变」这件事**照样算得出来**（那是租户级配置，与会话无关）。
 * 把分类与读数绑成一个开关，会让"没建会话"长得像"全都不随节拍变" —— 又一次"一个数盖两个事实"。
 */
export interface ProcessLiveInput {
  /** 已发布传导规则的两端类型（`GET /a/v1/sim/propagation-rules`）。 */
  readonly rules: readonly ProcessLiveRuleRef[];
  /** `SandboxViewConfig.nodeObjectIds`：对象类型 → 真物化对象 id。缺席 = 该类型 0 个对象。 */
  readonly nodeObjectIds: Readonly<Record<string, readonly string[]>>;
  /** 当前观察到的世界态；沙盘还没建会话 ⇒ `null`（分类照算，读数没有）。 */
  readonly snapshot: ProcessTickSnapshot | null;
  /** 上一次观察到的世界态（算「相比上一节拍」用）；首次观察 ⇒ `null`。 */
  readonly prevSnapshot: ProcessTickSnapshot | null;
}

/** 一座站的节拍读数。**不传 `live` 时这个键在模型里根本不存在**（additive 可回退）。 */
export interface ProcessStationLiveVM {
  readonly drive: ProcessTickDrive;
  /** 该承载类型在这个世界里的物化对象数（现算自 `nodeObjectIds`，不写死）。 */
  readonly carrierObjectCount: number;
  /**
   * 本 tick 的读数 = 该承载类型**全部对象、全部状态变量**的均值（两位小数）。
   * 无对象 / 无状态变量 ⇒ `null`（**不是 0**：0 是一个读数，`null` 是"没有读数"）。
   */
  readonly reading: number | null;
  /** 相比上一次观察的变化量；上一次没有、或两次任一无读数 ⇒ `null`。 */
  readonly delta: number | null;
  /** 这一拍真的动了没有（`delta` 非空且超过 `MOVE_EPS`）。 */
  readonly moved: boolean;
  /** 读数由哪几个状态变量来（升序）——屏上要能说出这个数是从哪儿来的。 */
  readonly stateVarKeys: readonly string[];
}

/**
 * 整张图的节拍维。
 *
 * ══ ⚠ 这里有一条**必须当面说清楚的口径**（派单里那句话按字面做会造假）══════════
 * 派单 4.3 举的例子是「相比上一节拍，等外部方 **+3**」。
 * **照字面做是错的**，而且错得很隐蔽：`byWaitKind` 数的是
 * `ProcessDefinition.waitKind` —— **模板层**的分类，它来自
 * `GET /a/v1/process-definitions`，**一个 tick 都不会改变它**
 * （改它要改流程台账，不是推时间）。
 * 所以「等外部方 +3」这句话在本平台今天**永远是假的**：那个数恒定 15。
 *
 * ⇒ 本档的处置：`byWaitKind`（模板分布）**原样保留、明说它不随节拍变**；
 *   真正随节拍变的另立一族 `movedByWaitKind` —— **每一态里有几条这一拍真的动了**。
 *   两者同屏、分开标注。这就是「复用已有的 byWaitKind、不另造一份计数」的正确读法：
 *   复用的是**同一份分组**，新增的是**同一分组上的另一个度量**。
 */
export interface ProcessLiveVM {
  /** 这张快照是哪个世界的（屏上要写出来 —— "某个时间的 screenshot" 得说清是哪个时间、哪个世界）。 */
  readonly sessionId: string | null;
  readonly tick: number | null;
  readonly prevTick: number | null;
  readonly origin: "MEASURED" | "DERIVED" | null;
  /**
   * 三档各几条。**每次由本函数按当次下发数据重算**，`TICK_DRIVE_ORDER` 全列（含 0 条的档 ——
   * 「这一档是 0」与「这一档没算」在屏上必须分得开）。前端不写死任何条数。
   * 判据与当日数字（2026-08-14 现跑 9 / 0 / 56）见本文件 `ProcessTickDrive` 的文档块，
   * 复验命令也在那里（同一条，别另抄一套）；
   * 恒等式「三档之和 == `total`」由 `liveDriveCoversAll` 现算，门在
   * `apps/frontend-shell/test/sandbox-process-live.seam.test.tsx` §B1。
   */
  readonly byDrive: readonly { readonly kind: ProcessTickDrive; readonly count: number }[];
  /** 结构上会随节拍变的流程键（升序）。 */
  readonly drivableKeys: readonly string[];
  /** 这一拍**真的动了**的流程键（升序）。 */
  readonly movedKeys: readonly string[];
  /**
   * 逐等待态：该态里有几条是节拍驱动的、其中几条这一拍真动了。
   * ⚠ 与 `ProcessCanvasModel.byWaitKind` **同一套分组、不同的度量** —— 别把两者读成一件事。
   */
  readonly movedByWaitKind: readonly {
    readonly kind: ProcessWaitKind;
    readonly drivable: number;
    readonly moved: number;
  }[];
  /** 这一拍全部动量的代数和（两位小数）。`null` = 这一拍没有任何可比读数。 */
  readonly netDelta: number | null;
  /** 有没有上一拍可比（`false` ⇒ 屏上说"这是第一张快照，没有可比的上一拍"，不显示一个假的 0）。 */
  readonly comparable: boolean;
}

/** 「动了」的判据阈值。传导核 `round12` 到 12 位，故 1e-9 足以把浮点噪声挡在外面。 */
export const MOVE_EPS = 1e-9;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * 一个承载类型在某快照下的读数：该类型全部对象、全部状态变量的均值。
 *
 * 为什么是**均值**而不是求和：对象数在不同类型间差两个数量级
 * （真后端实测 `Line` 数十 vs `Order` 数百），求和会让"圈更大"只反映"对象更多"。
 * 返回 `null` 而不是 0 —— 「没有读数」与「读数是 0」在屏上必须分得开。
 */
function carrierReading(
  state: TickState,
  objectIds: readonly string[],
): { value: number | null; stateVarKeys: string[] } {
  const varKeys = new Set<string>();
  let sum = 0;
  let n = 0;
  for (const id of objectIds) {
    const row = state[id];
    if (row === undefined) continue;
    for (const [k, v] of Object.entries(row)) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      varKeys.add(k);
      sum += v;
      n += 1;
    }
  }
  return { value: n === 0 ? null : round2(sum / n), stateVarKeys: [...varKeys].sort() };
}

/** 承载类型 → 三档之一。**判据现算，前端零名单**（见 `ProcessTickDrive` 的长注释）。 */
export function classifyTickDrive(
  carrierTypeKey: string,
  ruleTypeKeys: ReadonlySet<string>,
  carrierObjectCount: number,
): ProcessTickDrive {
  if (!ruleTypeKeys.has(carrierTypeKey)) return "NOT_TICK_DRIVEN";
  return carrierObjectCount > 0 ? "TICK_DRIVEN" : "NO_CARRIER_OBJECTS";
}

/**
 * 金丝雀：喂一个**已知必中**的样例进去，三档必须各自说得出话。
 * 一个恒返回 `NOT_TICK_DRIVEN` 的实现同样能让"56 条不随节拍变"这条断言全绿 ——
 * 所以在报「有 N 条不随节拍变」之前，必须先证明这个函数**能说「随」**。
 */
export function classifyTickDriveCanary(): { driven: ProcessTickDrive; noData: ProcessTickDrive; dark: ProcessTickDrive } {
  const rules = new Set(["CanaryType"]);
  return {
    driven: classifyTickDrive("CanaryType", rules, 3),
    noData: classifyTickDrive("CanaryType", rules, 0),
    dark: classifyTickDrive("NotInGraph", rules, 3),
  };
}

export interface ProcessCanvasModel {
  /** 端点下发的流程条数（唯一真值源，**前端不写死**）。 */
  readonly total: number;
  /** 各条线站数之和。与 `total` 不等即为渲染层漏画（见 `linesCoverAll`）。 */
  readonly laid: number;
  readonly lines: readonly ProcessLineVM[];
  /** 端点下发但域登记册里没有的 domainKey（非空 ⇒ 接缝漂移，屏上明写，不静默并进"其它"）。 */
  readonly unregisteredDomainKeys: readonly string[];
  /**
   * 四态各几条（等待类型词表来自契约，本文件不另抄一份）。
   *
   * ⚠ **这一族数不随节拍变**（WO-PROCESS-CANVAS-LIVE 现测）：`waitKind` 是
   * `ProcessDefinition` 的字段 = **模板层**分类，来自 `GET /a/v1/process-definitions`。
   * 推 tick 改的是世界态（`TickState`），改不到流程台账 ⇒ 这四个数恒定。
   * 「这一拍每一态里有几条真动了」是另一族度量，见 `ProcessLiveVM.movedByWaitKind`。
   */
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
  /**
   * 节拍维（WO-PROCESS-CANVAS-LIVE）。**不传 `live` 参数时这个键不存在** —— 同 `ProcessStationVM.live`。
   */
  readonly live?: ProcessLiveVM;
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
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 站名标签是**几行**？—— WO-PROCESS-CANVAS-LIVE 把它从 2 行变成了 3 行
 * ══════════════════════════════════════════════════════════════════════════════
 * 不接节拍维：站名 + `P## · N天` = **2 行**（本单之前的样子）。
 * 接了节拍维：再加一行读数 / 「不随节拍」 = **3 行**。
 *
 * ⚠ **这不是"多画一行字"那么简单，它会当场压字**（2026-08-14 本单现算逼出来的，
 *   不是想出来的）。`labelBoxH`(26) 恰好 = 2 × `labelLineH`(13)，
 *   而 `labelTierGap`(28) 只比它多 **2px** —— 那 2px 就是同侧两层之间的全部余量：
 *     · 基线（2 行）：tier0 占 [13, 39]，tier1 起于 41 ⇒ 余 **+2px**  ✅
 *     · 加第三行不动层距：tier0 占 [13, **52**]，tier1 仍起于 41 ⇒ **−11px，压字** ⛔
 *   而且 `labelOverflow` 那套检测**看不见**这一类：它比的是**同一层内**相邻标签的水平包围盒，
 *   压的是**跨层的垂直方向** —— 又一次「我用 X 当作 Y 的证据，而 X 并不度量 Y」。
 *
 * ⇒ 处置：层距与块高在接节拍维时各加一个 `labelLineH`，把基线那 **+2px** 的余量**原样还原**：
 *     · 修后（3 行 + 层距 28→41）：tier0 占 [13, 52]，tier1 起于 54 ⇒ 余 **+2px** ✅
 *     · 标签带厚度 67 → 93，恰好等于 tier1 第三行的底（93）⇒ 不溢出到下一条线。
 *   复算（纯算术，随时可跑）：
 *     `node -e "const B=13,G=28,T=2,H=26,L=13;const b3=L*3,g=G+L,h=H+L;
 *      console.log('基线余量',(B+G)-(B+L*2), '不改层距',(B+G)-(B+b3), '修后',(B+g)-(B+b3),
 *      '带厚', B+(T-1)*G+H, '→', B+(T-1)*g+h)"`
 *     ⇒ 当日现跑 `基线余量 2 不改层距 -11 修后 2 带厚 67 → 93`。
 *   门（机器判据，不是这段注释）：`labelTiersFit()` ＋
 *     `apps/frontend-shell/test/sandbox-process-live.seam.test.tsx` §G9；
 *     复验命令：`pnpm --filter frontend-shell exec vitest run sandbox-process-live`。
 *     变异反证已实测：把上面两个 `withLive` 分支撤掉（= 本 bug 的原始形态）⇒ §G9 当场红（RC=1）。
 *
 * ⛔ **默认参数 `false` 是 additive 契约的一部分**：不传节拍维时这三个函数的返回值
 *   与本单之前**逐字节相同**（几何一动，`canvas.h` / 每座站的 `y` 全会变，§G1 当场红）。
 * ⚠ 有保质期：`METRO_LAYOUT` 的 `labelBoxH` / `labelTierGap` / `labelLineH` 任一变动，
 *   上面每个数都作废，须重跑那条算术而不是照抄。
 */
export function procLabelTierGapPx(withLive = false): number {
  return PROC_LAYOUT.labelTierGap + (withLive ? PROC_LAYOUT.labelLineH : 0);
}

/** 单个标签块的高度（`withLive` 时容纳第三行）。 */
export function procLabelBoxHPx(withLive = false): number {
  return PROC_LAYOUT.labelBoxH + (withLive ? PROC_LAYOUT.labelLineH : 0);
}

/**
 * 「同侧分层不许压字」的**现算判据**（机器判据，不是上面那段注释）。
 * 层距与块高都必须 ≥ 实际要画的行数 × 行高 —— 任一不成立即会跨层压字，
 * 而 `labelOverflow` 那套水平检测**看不到**它。门在 `sandbox-process-live.seam.test.tsx` §G9。
 */
export function labelTiersFit(withLive = false): boolean {
  const need = (withLive ? 3 : 2) * PROC_LAYOUT.labelLineH;
  return procLabelTierGapPx(withLive) >= need && procLabelBoxHPx(withLive) >= need;
}

/**
 * 单侧标签带的最大厚度（px）= 第一层让位 + 分层推开的总量 + 标签块高。
 * 与第一档 `metroLabelBandPx()` 同式（那边还加了站圈半径，这里在 `lineGapPx()` 里单独加）。
 */
export function procLabelBandPx(withLive = false): number {
  return PROC_LAYOUT.labelBase + (PROC_LAYOUT.maxLabelTiers - 1) * procLabelTierGapPx(withLive) + procLabelBoxHPx(withLive);
}

/**
 * 两条线（或同一条线折行后两行）之间的垂直距离。**推出来的**：
 * 站圈上缘 + 换乘弧拱高（线**上方**）+ 站圈下缘 + 标签带（线**下方**）+ 走线沟。
 * 少任一项就会出现「上一条线的标签压到下一条线的换乘弧」——门直接验算这个不等式。
 */
export function lineGapPx(withLive = false): number {
  return (
    STATION_RADIUS.max + PROC_LAYOUT.interchangeRise + STATION_RADIUS.max + procLabelBandPx(withLive) + PROC_LAYOUT.gutter
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
 * 交替而不是全挤一层，是因为中文站名的估宽**逼近**相邻站间距 `gapX`(150)，余量薄。
 *
 * **2026-08-14 现跑**（`estimateLabelWidth` 是纯函数，定义在 `chainLineMap.ts:567`：
 * 码位 > U+00FF 按 1 字号宽、其余按 0.55，`labelFontPx = 11`）：
 *   · 65 条种子流程名里最宽的是 P16「客户收货地点与物流条款维护」13 个全角字 = **143px**；
 *   · 「产能投资立项与评审」是 **9** 个全角字 = **99px**。
 *     ⚠ 本句原写「8 个全角字 ≈ 88px」——**字数与像素各少算一个字**，本轮现跑订正。
 *   · 单层时相邻两站相撞的判据是 `labelBoxesOverlap`（`chainLineMap.ts:590`）：
 *     `(w_a + w_b) / 2 + labelGapX(8) > gapX(150)`，即两名合计 > **284px**；
 *     最宽的两条相加已 271px（143 + 128），余量不到 5%。
 *     两层交替把同层水平间距翻到 300px，判据放宽到合计 > 584px。
 * 复验（同一份 `estimateLabelWidth` 的公式，别另抄一套）：
 *   `node -e "const s=require('fs').readFileSync('apps/datacore/src/seed.ts','utf8');
 *    const n=[...s.matchAll(/name: \"([^\"]+)\", ownerFunctionKey/g)].map(m=>m[1]);
 *    const e=t=>[...t].reduce((a,c)=>a+((c.codePointAt(0)>0xff)?11:11*0.55),0);
 *    console.log(n.length, Math.max(...n.map(e)))"` ⇒ 2026-08-14 现跑 `65 143`。
 * ⚠ 有保质期：`PROC_LAYOUT.gapX` / `METRO_LAYOUT.labelFontPx` / `labelGapX` / 种子流程名
 *   任一变动，上面每个数都作废，须重跑而不是照抄。
 *
 * 封顶两层后仍撞的，**如实记进 `labelOverflow`**，不再加层。
 */
export function placeStationLabel(
  x: number,
  y: number,
  r: number,
  col: number,
  name: string,
  sub: string,
  withLive = false,
): ProcessLabelVM {
  const tier = col % PROC_LAYOUT.maxLabelTiers;
  const top = y + r + PROC_LAYOUT.labelBase + tier * procLabelTierGapPx(withLive);
  const w = Math.max(estimateLabelWidth(name, PROC_LAYOUT.labelFontPx), estimateLabelWidth(sub, PROC_LAYOUT.labelFontPx));
  return {
    tier,
    x,
    nameY: top + PROC_LAYOUT.labelLineH,
    subY: top + PROC_LAYOUT.labelLineH * 2,
    // ⚠ 块高随行数走（见 `procLabelBoxHPx` 的长注释）：第三行的基线恰好落在块底，
    //    块高不跟着长 = 屏上有字、包围盒不认它 ⇒ 压字检测对它一言不发。
    box: { x: x - w / 2, y: top, w, h: procLabelBoxHPx(withLive) },
  };
}

/** 第 `index` 个站位落在本条线的第几行第几列、画布坐标是多少（与第一档同一套折行算法）。 */
export function procSlotPoint(
  index: number,
  plan: MetroRowPlan,
  y0: number,
  withLive = false,
): { row: number; col: number; x: number; y: number } {
  const row = Math.min(plan.rowCount - 1, Math.floor(index / plan.perRow));
  const col = index - row * plan.perRow;
  return { row, col, x: PROC_LAYOUT.padX + col * PROC_LAYOUT.gapX, y: y0 + row * lineGapPx(withLive) };
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
 * 判据⑤：**additive 可回退**（WO-PROCESS-CANVAS-LIVE）。第三参 `live` 省略 / `null` 时，
 *        返回值与本单之前**逐字节相同**（`live` 键在两层上都不出现）。
 *        这不是"尽量兼容"，是**门咬住的恒等式** —— 判据在
 *        `sandbox-process-live.seam.test.tsx` §G：把基线实现的输出 `JSON.stringify`
 *        与现实现不传 `live` 的输出比字符串，不等即红。
 */
export function buildProcessCanvasModel(
  res: ProcessDefinitionsResponse,
  waitKindOrder: readonly ProcessWaitKind[],
  live?: ProcessLiveInput | null,
): ProcessCanvasModel {
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

  // ── 节拍维：先按**承载类型**算一遍（同类型的多条流程共享同一份读数，不重复算 N 遍）
  //    `liveByKey === null` ⇒ 全程走本单之前那条路，一个键都不多产出（additive 契约）。
  const liveByKey: Map<string, ProcessStationLiveVM> | null = live == null ? null : (() => {
    const ruleTypeKeys = new Set<string>();
    for (const r of live.rules) {
      ruleTypeKeys.add(r.sourceTypeKey);
      ruleTypeKeys.add(r.targetTypeKey);
    }
    const byCarrierLive = new Map<string, ProcessStationLiveVM>();
    for (const carrier of new Set(res.definitions.map((p) => p.carrierTypeKey))) {
      const ids = live.nodeObjectIds[carrier] ?? [];
      const drive = classifyTickDrive(carrier, ruleTypeKeys, ids.length);
      const now = live.snapshot === null ? { value: null, stateVarKeys: [] as string[] } : carrierReading(live.snapshot.state, ids);
      const before = live.prevSnapshot === null ? { value: null, stateVarKeys: [] as string[] } : carrierReading(live.prevSnapshot.state, ids);
      const delta = now.value === null || before.value === null ? null : round2(now.value - before.value);
      byCarrierLive.set(carrier, {
        drive,
        carrierObjectCount: ids.length,
        reading: now.value,
        delta,
        moved: delta !== null && Math.abs(delta) > MOVE_EPS,
        stateVarKeys: now.stateVarKeys,
      });
    }
    const m = new Map<string, ProcessStationLiveVM>();
    for (const p of res.definitions) m.set(p.key, byCarrierLive.get(p.carrierTypeKey)!);
    return m;
  })();

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

  // ⚠ 几何随「有没有第三行」走（见 `procLabelBandPx` 的长注释）。`withLive === false` 时
  //    下面每个几何量与本单之前逐字节相同 —— additive 契约就靠这一个布尔守住。
  const withLive = liveByKey !== null;
  const gap = lineGapPx(withLive);
  const stationByKey = new Map<string, { st: ProcessStationVM; lineIdx: number }>();
  let cursorY = PROC_LAYOUT.padTop + STATION_RADIUS.max + PROC_LAYOUT.interchangeRise;

  const lines: ProcessLineVM[] = orderedDomains.map(([domainKey, defs], lineIdx) => {
    const plan = plans[lineIdx]!;
    const y0 = cursorY;
    const stations: ProcessStationVM[] = defs.map((p, i) => {
      const slot = procSlotPoint(i, plan, y0, withLive);
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
        label: placeStationLabel(slot.x, slot.y, r, slot.col, p.name, sub, withLive),
        // ⚠ 条件展开而不是 `live: liveByKey?.get(...)` —— 后者在不传时会留下一个
        //    `"live":undefined` 的属性槽（`JSON.stringify` 虽然会丢它，但 `Object.keys`
        //    与逐键比对会分家）。additive 契约要的是**键根本不存在**。
        ...(liveByKey === null ? {} : { live: liveByKey.get(p.key)! }),
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

  // ── 节拍维汇总。`movedByWaitKind` 复用**上面这同一套 waitKind 分组**（不另造一份分组），
  //    只是在同一分组上换了一个度量：不是"这一态有几条流程"，是"这一态里有几条这一拍真动了"。
  const liveVM: ProcessLiveVM | null =
    liveByKey === null
      ? null
      : (() => {
          const rows = sorted.map((p) => ({ p, l: liveByKey.get(p.key)! }));
          const movedKeys = rows.filter((r) => r.l.moved).map((r) => r.p.key).sort((a, b) => a.localeCompare(b));
          const drivableKeys = rows.filter((r) => r.l.drive === "TICK_DRIVEN").map((r) => r.p.key).sort((a, b) => a.localeCompare(b));
          const deltas = rows.map((r) => r.l.delta).filter((d): d is number => d !== null);
          return {
            sessionId: live?.snapshot?.sessionId ?? null,
            tick: live?.snapshot?.tick ?? null,
            prevTick: live?.prevSnapshot?.tick ?? null,
            origin: live?.snapshot?.origin ?? null,
            byDrive: TICK_DRIVE_ORDER.map((kind) => ({ kind, count: rows.filter((r) => r.l.drive === kind).length })),
            drivableKeys,
            movedKeys,
            movedByWaitKind: waitKindOrder.map((kind) => ({
              kind,
              drivable: rows.filter((r) => r.p.waitKind === kind && r.l.drive === "TICK_DRIVEN").length,
              moved: rows.filter((r) => r.p.waitKind === kind && r.l.moved).length,
            })),
            netDelta: deltas.length === 0 ? null : round2(deltas.reduce((a, b) => a + b, 0)),
            // 「有没有上一拍可比」= 真的拿到过上一张快照，且**不是同一拍**。
            // 同一拍与自己比恒得 0 —— 那个 0 会被读成"这一拍什么都没动"，是假的。
            comparable:
              live?.prevSnapshot != null && live.snapshot != null && live.prevSnapshot.tick !== live.snapshot.tick,
          };
        })();

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
    canvas: { w: canvasW, h: Math.max(1, cursorY - gap + STATION_RADIUS.max + procLabelBandPx(withLive) + PROC_LAYOUT.padBottom) },
    maxStdDays,
    labelOverflow,
    ...(liveVM === null ? {} : { live: liveVM }),
  };
}

/**
 * 「本图上有几条会随节拍变」的**现算判据**（不写死条数，同 `linesCoverAll` 的做法）。
 * 三档之和必须等于总条数 —— 分档不许漏人，也不许一条被数两遍。
 */
export function liveDriveCoversAll(m: ProcessCanvasModel): boolean {
  if (m.live === undefined) return true;
  return m.live.byDrive.reduce((s, g) => s + g.count, 0) === m.total;
}

/**
 * 「一条不少」的**现算判据**（不写死条数）：各条线铺开的站数 == 端点下发的条数。
 * 屏上把两个数都印出来，不合等号即为漏画 —— 判据是恒等式，不是某个金值。
 */
export function linesCoverAll(m: ProcessCanvasModel): boolean {
  return m.total === m.laid;
}
