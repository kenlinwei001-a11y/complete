import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchProcessDefinitions, fetchSimPropagationRules, fetchSimViewConfig } from "@/api/endpoints";
import zh from "@/locales/zh";
import { InfoPopover } from "@/components/InfoPopover";
import { WAIT_KIND_ORDER, WAIT_KIND_STYLE, type ProcessDefinitionsResponse } from "@/views/process/processWait";
import {
  buildProcessCanvasModel,
  linesCoverAll,
  liveDriveCoversAll,
  PROC_LAYOUT,
  TICK_DRIVE_ORDER,
  type ProcessCanvasModel,
  type ProcessLineVM,
  type ProcessLiveInput,
  type ProcessStationVM,
  type ProcessTickDrive,
  type ProcessTickSnapshot,
} from "./processCanvas";
import {
  fitTransform,
  IDENTITY_TRANSFORM,
  zoomAt,
  zoomCenter,
  ZOOM_STEP,
  type ViewTransform,
} from "./physicalTopology";
import { STATION_RADIUS } from "./chainLineMap";
import shell from "./SandboxConsole.module.css";
import styles from "./ProcessCanvasView.module.css";

/**
 * WO-SANDBOX-PROCESS-MODE / **WO-R9-METRO-UX** · 主画布**第五档「业务流程」**。
 *
 * ── 它回答哪一问 ──────────────────────────────────────────────────────────────
 * 前四档（线路图 / 物理拓扑 / 链路阶段 / 本体拓扑）回答的都是「时间与损失落在哪一段」；
 * 本档回答的是**「企业里到底有哪些业务活动，每一条挂在哪个本体承载物上」**。
 * 点任一站 → 右栏出 `ProcessInspectPanel`，把它的完整本体关系摊开
 * （承载类型 / 属性 / 派生 / 一跳关系 / 同承载物流程 / 打到它的杠杆 / 十六层三态）。
 *
 * ── WO-R9-METRO-UX：卡片墙 → 地铁线路图 ──────────────────────────────────────
 * 仓主两次原话：①「右侧图片是**业务端到端路线图**」（参考图 = 地铁线路样式）；
 * ② 看到第五档真屏后 —— 「**没有看到类似『地铁线路』的 UX**」。
 * 上一版的分组卡片墙信息是全的但**形不对**：卡片墙表达不出「一条线、按顺序流过若干站」。
 * 本版改成线路图，**视觉语言照第一档 `ChainLineMapView` 的既有约定**：
 * 站圈（大小 ∝ 一个数）· 连线 · 换乘双环 · 折返标记 · 图例 · 缩放/平移。
 *
 * ⚠ **没有引第二套 SVG 方案**：缩放/平移直接 import `physicalTopology.ts` 的
 *   `fitTransform` / `zoomAt` / `zoomCenter` / `ZOOM_STEP` / `IDENTITY_TRANSFORM` / `ViewTransform`
 *   （与第一档同一份实现、同一套锚点语义与上下限，一行没抄）；版面几何与折行算法在
 *   `processCanvas.ts` 里 import 自 `chainLineMap.ts`（`METRO_LAYOUT` / `STATION_RADIUS` /
 *   `metroRowPlan` / `estimateLabelWidth` / `labelBoxesOverlap`）。本文件另直接取一个
 *   `STATION_RADIUS`（画折返标记的纵向让位），仅此一处。
 *
 * ── ⛔ 两层不许混（本档的结构红线）────────────────────────────────────────────
 * 本组件**不 import** 任何节拍层的**视图模型**，**不产生也不消费 `nodeId`**，
 * 选中态是 `processKey` 而不是 `nodeId`。碰到节拍层的只有两处，都不是"接起来"：
 *  · `processCanvas.ts` 的 `chainLayerOverlap()` —— 集合求交，在屏上**证明两层不相交**；
 *  · `chainLineMap.ts` 的 `STATION_RADIUS` —— 一个**几何常量**（半径上下夹取），与
 *    「节拍层有哪 24 个节点」毫无关系。共用几何是"同一套视觉语言"，不是同一个模型。
 *
 * ── 诚实位（本档自带的，一条都不许因为改档位控件而丢）──────────────────────
 *  ① **条数现算，不写死**：屏上同时印「端点下发 N 条」与「本图上站 M 座」，
 *     N ≠ M 当场标红（`spc-count-mismatch`）。全档不出现 `65` 这个字面量。
 *  ② **标准工期 ≠ 实测滞留**：`stdDurationDays` 是模板值。这句话常驻，不折叠。
 *  ③ **域登记册查不到的域不静默并进"其它"**：单开一条线 + `data-registered="0"`。
 *  ④ **运行态本档答不了**：`ProcessInspectPanel` 的 `runtime.available` 缺席理由照原样显示。
 *  ⑤ **【本轮新增·最重要】连线是虚线，因为端点没下发先后**（`spc-order-basis`，
 *     `data-basis="display-order"`）。理由与实测反例见 `processCanvas.ts` 文件头 §0
 *     与浮层 `info-process-order-basis`。**实线在地铁隐喻里读作"这样流"，而我们没这个依据**
 *     —— 派单原话：「编一个看起来像流程的顺序，比卡片墙更坏」。
 *
 * ── 浮层纪律（`docs/CONVENTION-ui-information-layering.md` §2 R-UI-3）────────────
 * 本组件**禁止** HTML `title` 属性与 SVG `<title>` 元素（原生 tooltip：不受控 ·
 * 永远画在最上层 · 移开滞留；2026-08-10 真出过遮挡事故）。站的读数走三条**受控**通路：
 * 图上 `<text>` 标签 · `<g>` 的 `data-*`（测试与脚本）· `<g>` 的 `aria-label`（读屏）。
 * `sandbox-process-mode.seam` §D3 在**第五档挂出来之后**数 `[title]` 与 `svg title`，各须为 0。
 *
 * ── 主题 ──────────────────────────────────────────────────────────────────────
 * 零硬编码颜色：全部走 `styles/tokens.css` 的 CSS 变量；四种等待态色由
 * `processWait.WAIT_KIND_STYLE` 以变量名下发（本档不再抄一份词表）。
 * ⚠ **线不按域上色**：仓里只有 10 个 `--c-*` 语义域色，而一级业务域有 13 个 ——
 * 差的 5 个只能现编，而现编颜色 = 又一份要同步的词表；且四种等待态已经占用了
 * `--c-people/--c-forecast/--c-equip/--c-capacity`，线再用同一套色板会让**同一个颜色表示两件事**。
 * 故线一律中性色，线的身份由**线头标签 + 线号**承担（地铁图本来也靠这两样认线）。
 *
 * R6 确定性：无时钟、无随机；排序与几何全序在 `processCanvas.ts` 里定（几何只算不量）。
 */

/**
 * ⚠ WO-PROCESS-CANVAS-LIVE：`ready` 从**存模型**改成**存响应**。
 * 理由是接节拍之后模型不再只是 `res` 的函数 —— 它还吃「当前是哪一拍」；
 * 把模型冻在 state 里，推一拍就永远不会重建（画面照旧、数字照旧，而测试可能还是绿的）。
 * 现在响应存 state、模型走 `useMemo(res, liveInput)` 现算 ⇒ 换一拍必然重算。
 */
type LoadState =
  | { status: "loading" }
  | { status: "ready"; res: ProcessDefinitionsResponse }
  | { status: "error"; code: string; message: string; requestId: string | null };

interface EnvelopeError {
  code?: string;
  message?: string;
  requestId?: string;
}

/** 错误只陈述能从响应直接读出的事实，不内联病因猜测（与本页其余取数同一口径）。 */
function readError(e: unknown): { code: string; message: string; requestId: string | null } {
  const anyE = e as { code?: string; message?: string; requestId?: string; error?: EnvelopeError; status?: number };
  const code = anyE?.error?.code ?? anyE?.code ?? (anyE?.status ? `HTTP_${anyE.status}` : "UNKNOWN");
  const message = anyE?.error?.message ?? anyE?.message ?? String(e);
  return { code: String(code), message, requestId: anyE?.error?.requestId ?? anyE?.requestId ?? null };
}

export interface ProcessCanvasViewProps {
  /** 当前选中的流程 key（受控；`null` = 还没点）。**不是 nodeId** —— 两层的选中态各归各。 */
  selectedProcessKey: string | null;
  onPick: (processKey: string) => void;
  /** 诚实位总开关，与控制台其余档位共用同一个（关掉只影响本档自己的说明段）。 */
  honesty?: boolean;
}

// ══════════════════════════════════════════════════════════════════════════════
// 🔴 § 节拍观察者（WO-PROCESS-CANVAS-LIVE）—— **只读订阅，不做第二个控制器**
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 沙盘世界态缓存条目的形状。**逐字沿用** `SandboxView.WorldSnapshot`
 * （`views/sim/SandboxView.tsx:134`）—— 这里只写它的**读侧**投影，
 * 刻意不 import 那个类型：本档一旦 import `SandboxView`，就会把整棵沙盘树拖进
 * 第五档的懒挂载 chunk 里（第五档的存在意义之一就是"没点进来 = 一次请求都不发"）。
 * 形状漂了会被 §H 的门当场咬住（那条断言拿的是真 `SandboxView` 写进去的条目）。
 */
interface WorldCacheEntry {
  tick: number;
  state: Record<string, Record<string, number>>;
  origin: "DERIVED" | "MEASURED";
}

/** 沙盘世界态的缓存键前缀（`SandboxView` 的 `["a","sim-world", sessionId]`）。 */
const WORLD_KEY_PREFIX = ["a", "sim-world"] as const;

/**
 * 从查询缓存里读**当前这个世界**的快照。
 *
 * ── 为什么是"读缓存"而不是"自己建会话、自己发 tick" ──────────────────────────
 * 沙盘的会话归 `SandboxView` 所有（`sessionId` 在它的 `useState` 里），
 * 「推进 tick」这个动作也归它（`sandbox-tick-btn` → `simTick` →
 * `qc.setQueryData(["a","sim-world", id], …)`，`SandboxView.tsx:705`）。
 * 第五档要的是**同一个世界的同一拍**，所以它必须做观察者：
 *  · 自己建会话 ⇒ 屏上会出现**两个世界**，用户在控制条上推的那一拍打不到这张图 ——
 *    那正是「看起来在动、其实动的是另一个世界」这类最难查的假象；
 *  · 自己发 tick ⇒ 同一个会话被两处推进，`curTick` 互相打架。
 * ⇒ 本档**一行写操作都没有**：不 `setQueryData`、不 `invalidateQueries`、不发 tick。
 *
 * ── 为什么不用 `useQuery` 精确订阅那个键 ────────────────────────────────────
 * 因为**键里那一段 `sessionId` 只有 `SandboxView` 知道**（它在组件 state 里，没有下发）。
 * 所以这里按**前缀**找：缓存里有数据的 `["a","sim-world", <非空 id>]` 条目就是
 * 「沙盘这会儿在推的那个世界」。多个世界（分支）时取 `dataUpdatedAt` 最大的那个 ——
 * 即"沙盘最后动过的那一个"，并把 `sessionId` **写在屏上**，让读的人能核对
 * 自己看的是不是控制条上那个世界。
 *
 * ⚠ 排序里出现了时间戳（`dataUpdatedAt`），但它**不进模型**：
 *   `buildProcessCanvasModel` 收到的是选中之后的那一份快照，纯函数、R6 不受影响。
 */
function readWorldFromCache(qc: ReturnType<typeof useQueryClient>): (ProcessTickSnapshot & { updatedAt: number }) | null {
  const rows = qc
    .getQueryCache()
    .findAll({ queryKey: [...WORLD_KEY_PREFIX] })
    .map((q) => {
      const sessionId = String((q.queryKey as unknown[])[2] ?? "");
      const data = q.state.data as WorldCacheEntry | undefined;
      return { sessionId, data, updatedAt: q.state.dataUpdatedAt };
    })
    .filter((r): r is { sessionId: string; data: WorldCacheEntry; updatedAt: number } => r.sessionId.length > 0 && r.data != null);
  if (rows.length === 0) return null;
  // 全序：先按最后更新时间降序，同刻按 sessionId 升序（不留并列歧义 —— 并列时两次渲染取到不同世界，
  // 屏上会无缘无故跳一拍，而且没有任何迹象说明为什么）。
  rows.sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId));
  const top = rows[0]!;
  return { sessionId: top.sessionId, tick: top.data.tick, state: top.data.state, origin: top.data.origin, updatedAt: top.updatedAt };
}

/** 两张快照是不是同一张（避免缓存里任何一个别的查询变动都把本档重渲一遍）。 */
function sameSnapshot(a: ProcessTickSnapshot | null, b: ProcessTickSnapshot | null): boolean {
  if (a === null || b === null) return a === b;
  return a.sessionId === b.sessionId && a.tick === b.tick && a.origin === b.origin && a.state === b.state;
}

/**
 * 订阅沙盘世界态，并**自己记住上一拍**（算「相比上一节拍」用）。
 *
 * ⚠ 「上一拍」必须由本档自己留存，不能问后端要：`GET …/:id/world` 只回当前态。
 *   留存的判据是 **tick 变了**才推进 —— 同一拍内的重取（事件失效触发的 refetch）
 *   不许把 prev 冲掉，否则「相比上一拍」会变成「相比这一拍」= 恒 0，
 *   而那个 0 会被读成「这一拍什么都没动」。这条正是本仓「一个数盖住两个事实」的形态。
 */
function useSandboxWorldObserver(): { snapshot: ProcessTickSnapshot | null; prevSnapshot: ProcessTickSnapshot | null } {
  const qc = useQueryClient();
  const [snapshot, setSnapshot] = useState<ProcessTickSnapshot | null>(null);
  const prevRef = useRef<ProcessTickSnapshot | null>(null);
  const curRef = useRef<ProcessTickSnapshot | null>(null);

  useEffect(() => {
    const pull = () => {
      const next = readWorldFromCache(qc);
      const nextSnap: ProcessTickSnapshot | null =
        next === null ? null : { sessionId: next.sessionId, tick: next.tick, state: next.state, origin: next.origin };
      setSnapshot((prev) => {
        if (sameSnapshot(prev, nextSnap)) return prev;
        // 只有**换了拍**（或换了世界）才把上一张存成 prev；同一拍的重取不动 prev。
        const cur = curRef.current;
        if (cur !== null && nextSnap !== null && (cur.tick !== nextSnap.tick || cur.sessionId !== nextSnap.sessionId)) {
          prevRef.current = cur;
        }
        curRef.current = nextSnap;
        return nextSnap;
      });
    };
    pull();
    return qc.getQueryCache().subscribe(pull);
  }, [qc]);

  // prev 与 cur 必须是**同一个世界**的两拍：切了分支世界之后拿旧世界的读数作差 = 张冠李戴。
  const prev = prevRef.current;
  const usablePrev = prev !== null && snapshot !== null && prev.sessionId === snapshot.sessionId ? prev : null;
  return { snapshot, prevSnapshot: usablePrev };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 站 —— 一条业务流程
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 一座站。**换乘站画双环**（与第一档同款图元），普通站单实心圈。
 *
 * ── ⚠ 可点性：一个**只有真浏览器才抓得到**的坑（本单实测踩到并订正）────────────
 * 第一版写的是 `<g role="button" style={{pointerEvents:"all"}}>`，
 * **jsdom 里 17/17 全绿**，真浏览器里点不开检视面板（实测 playwright 超时 120s）。
 * 根因：**SVG `<g>` 自己没有几何**，`pointer-events` 加在它身上不会凭空造出一块可点区域；
 * 只有它的**子元素**（有 fill 的 circle / text）才参与命中测试。
 * 而 playwright（以及"想点这个站"的人）点的是这一组的**包围盒中心** ——
 * 那个点落在圈与下方标签**之间的空白**里，穿透过去谁也没点到。
 *
 * 这正是本仓「绿测试 ≠ 能用」的又一形态：**jsdom 不做命中测试**，
 * 所以"能不能点中"这件事它根本不度量 —— 拿它的绿当作可点性的证据就是
 * 「我用 X 当作 Y 的证据，而 X 并不度量 Y」。
 *
 * ⇒ 订正：显式补一块**透明命中圈**（`fill="transparent"`，注意不是 `fill="none"` ——
 *   `none` 不接收指针事件，`transparent` 接收）。半径 `r + 8` 且封顶：
 *   必须 < `PROC_LAYOUT.gapX / 2`，否则相邻两站的命中区会互相抢点击。
 */
function Station({
  s,
  selected,
  onPick,
}: {
  s: ProcessStationVM;
  selected: boolean;
  onPick: (k: string) => void;
}) {
  const t = zh.sim.sandbox.processCanvas;
  const color = `var(${WAIT_KIND_STYLE[s.waitKind].colorVar})`;
  const interchange = s.sharedCarrierWith.length > 0;
  /**
   * 节拍读数（WO-PROCESS-CANVAS-LIVE）。`undefined` = 本次没接节拍维（additive 回退态），
   * 此时下面每一处新增读数**一个都不渲染** —— 屏与本单之前逐字相同。
   */
  const live = s.live;
  /** 这一拍真动了 ⇒ 站圈外加一圈脉冲环（**动的证据画在站上**，不是只写在说明段里）。 */
  const moved = live?.moved === true;
  return (
    <g
      className={styles.station}
      /* ⚠ testid 与上一版**逐字不变**（`spc-card-<key>`）：结构红线那条断言
         （§C1 现算「屏上渲染的键」∩ 24 个冻结 nodeId）就是靠它取键的。
         换个名字 = 那条断言在空集合上跑、恒绿 —— 假绿的又一形态。
         2026-08-14 实测：取键的是 `renderedProcessKeys()`
         （`apps/frontend-shell/test/sandbox-process-mode.seam.test.tsx:111`，
         `getAllByTestId(/^spc-card-/)` + 读 `data-process-key`），咬它的是同文件 `:251` 的
         「C1 · 第五档渲染的键集合 ∩ CHAIN_NODE_REGISTRY 的 24 个 nodeId = ∅」。
         那条断言自带防空绿护栏（`keys.length` 与 `nodeIds.size` 都先断言 > 0），
         所以改名会**当场红**而不是恒绿——护栏在，不是靠这段注释拦。
         复验：`pnpm --filter frontend-shell exec vitest run sandbox-process-mode`。
         ⚠ 有保质期：testid 前缀、`data-process-key` 属性名、或那条断言的取键方式任一改动即须重测。 */
      data-testid={`spc-card-${s.key}`}
      data-process-key={s.key}
      data-layer="process"
      data-wait-kind={s.waitKind}
      data-interchange={interchange ? "1" : "0"}
      data-shared-with={s.sharedCarrierWith.join(",")}
      data-std-days={s.stdDurationDays}
      data-r={s.r}
      /* ── 节拍维的受控读数出口（WO-PROCESS-CANVAS-LIVE）。没接节拍维时这四个属性**不存在**，
            不是空串 —— `getAttribute` 返回 null 与返回 "" 在门里是两个不同的命题。 */
      {...(live === undefined
        ? {}
        : {
            "data-drive": live.drive,
            "data-moved": live.moved ? "1" : "0",
            "data-reading": live.reading === null ? "" : String(live.reading),
            "data-delta": live.delta === null ? "" : String(live.delta),
            "data-carrier-objects": String(live.carrierObjectCount),
          })}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      /* ⚠ **没有 `<title>`**：见组件头浮层纪律。读屏走 aria-label（`role="button"` 下生效）。 */
      aria-label={`${s.name}（${s.key}）· ${zh.processWait.waitKind[s.waitKind].label} · ${t.stdDays(s.stdDurationDays)}${
        interchange ? ` · 换乘：与 ${s.sharedCarrierWith.join("、")} 共用承载物 ${s.carrierTypeKey}` : ""
      }${live === undefined ? "" : t.stationLiveAria(live.drive, live.reading, live.delta, live.carrierObjectCount)}`}
      style={{ pointerEvents: "all" }}
      onClick={() => onPick(s.key)}
      onKeyDown={(e: ReactKeyboardEvent<SVGGElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(s.key);
        }
      }}
    >
      {/* 透明命中圈 —— 见上方注释。它必须在最前面画（在圈/字**下面**），
          否则会盖住站圈本身，把 `:hover` 的视觉反馈也一起吃掉。 */}
      <circle
        className={styles.hitArea}
        data-testid={`spc-hit-${s.key}`}
        cx={s.x}
        cy={s.y}
        r={Math.min(s.r + 8, PROC_LAYOUT.gapX / 2 - 2)}
        fill="transparent"
      />
      {selected ? <circle className={styles.stationHalo} cx={s.x} cy={s.y} r={s.r + 6} /> : null}
      {/* 这一拍真动了 —— 画一圈脉冲环。**形状编码**而不是只换颜色：
          色觉差异者与打印稿上，"变了没有"必须仍然看得出来（与本仓三态四重编码同源纪律）。 */}
      {moved ? <circle className={styles.movedRing} data-testid={`spc-moved-${s.key}`} cx={s.x} cy={s.y} r={s.r + 4} /> : null}
      {/* 不随节拍变的那批：**形状**上也标出来（虚线外环，`<circle>` 没有可渲染子节点 ⇒ 不占第一层信息块）。
          刻意**不用降低不透明度**（"灰掉"）：规范与派单都点名 —— 灰掉读作"被禁用/坏了"，
          而这里的事实是"它本来就不随节拍变"。形状说一遍、文字说一遍、`data-drive` 说一遍、
          `aria-label` 说一遍 —— 四重编码，任一渠道单独都能把它与"没数据"分开。 */}
      {live !== undefined && live.drive !== "TICK_DRIVEN" ? (
        <circle className={styles.staticRing} data-testid={`spc-static-${s.key}`} cx={s.x} cy={s.y} r={s.r + 4} />
      ) : null}
      {interchange ? (
        <>
          <circle className={styles.interchangeOuter} cx={s.x} cy={s.y} r={s.r} style={{ stroke: color }} />
          <circle className={styles.interchangeInner} cx={s.x} cy={s.y} r={Math.max(2, s.r * 0.45)} style={{ fill: color }} />
        </>
      ) : (
        <circle className={styles.stationDot} cx={s.x} cy={s.y} r={s.r} style={{ fill: color }} />
      )}
      <text className={styles.stationName} x={s.label.x} y={s.label.nameY} textAnchor="middle">
        {s.name}
      </text>
      <text className={styles.stationSub} x={s.label.x} y={s.label.subY} textAnchor="middle">
        {s.key} · {s.stdDurationDays}D
      </text>
      {/* 第三行 = 节拍读数。**只在接了节拍维时才有这一行**（没接 ⇒ 版面与本单之前一模一样）。
          三档各说各的话：
           · 随节拍变 ⇒ 印读数与增量（有增量才印增量，没有上一拍就不印一个假的 0）；
           · 接了线没数据 ⇒ 印「0 个承载对象」，**不是**印 0；
           · 本层不随节拍变 ⇒ 印那句话本身，而不是留空白（空白会被读成"加载中/坏了"）。 */}
      {live === undefined ? null : (
        <text
          className={live.drive === "TICK_DRIVEN" ? styles.stationLive : styles.stationStatic}
          data-testid={`spc-live-${s.key}`}
          data-drive={live.drive}
          x={s.label.x}
          y={s.label.subY + PROC_LAYOUT.labelLineH}
          textAnchor="middle"
        >
          {live.drive === "TICK_DRIVEN"
            ? live.reading === null
              ? t.liveNoReading
              : `${live.reading}${live.delta === null ? "" : t.deltaSuffix(live.delta)}`
            : t.driveMark[live.drive]}
        </text>
      )}
    </g>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 线 —— 一个一级业务域
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 一条线。**连线一律虚线**（`strokeDasharray` 在 CSS 里），因为端点没下发先后 ——
 * 这不是装饰，是本图最重要的诚实位（见组件头 ⑤）。
 * 折行处画一段竖向折返 + `↩` 标记：告诉读的人「线在这里换到下一行，没有断」。
 */
function Line({
  line,
  selectedProcessKey,
  onPick,
}: {
  line: ProcessLineVM;
  selectedProcessKey: string | null;
  onPick: (k: string) => void;
}) {
  const t = zh.sim.sandbox.processCanvas;
  const folds = line.stations.filter((s, i) => i > 0 && s.row !== line.stations[i - 1]!.row);
  return (
    <g
      /* ⚠ testid 逐字不变（`spc-lane-<domainKey>`）+ `data-registered` —— 诚实位 ③ 的挂点。 */
      data-testid={`spc-lane-${line.domainKey}`}
      data-registered={line.registered ? "1" : "0"}
      data-line-no={line.lineNo}
      data-stations={line.stations.length}
    >
      {/* 线头：域名 + 域 key + 线号。地铁图靠线头认线（本图刻意不给线上色，理由见组件头）。 */}
      <text className={styles.lineHead} x={line.headX} y={line.headY - 4} textAnchor="end">
        {t.lineNo(line.lineNo)}
      </text>
      <text className={styles.lineName} x={line.headX} y={line.headY + 10} textAnchor="end">
        {line.domainName}
      </text>
      <text className={styles.lineKey} x={line.headX} y={line.headY + 23} textAnchor="end">
        {line.domainKey} · {t.laneStat(line.stations.length, line.totalStdDays)}
        {!line.registered ? (
          <tspan className={styles.lineUnreg} data-testid={`spc-lane-unreg-${line.domainKey}`}>
            {" "}
            {t.laneUnregistered}
          </tspan>
        ) : null}
      </text>

      {/* 连线：**虚线**（无先后依据）。`data-order-basis` 让门能直接咬"它是不是被偷偷改成实线了"。 */}
      {line.segments.map((seg) => (
        <line
          key={`${seg.fromKey}-${seg.toKey}`}
          className={styles.rail}
          data-testid={`spc-seg-${seg.fromKey}-${seg.toKey}`}
          data-order-basis="display-order"
          x1={seg.x1}
          y1={seg.y1}
          x2={seg.x2}
          y2={seg.y2}
        />
      ))}

      {/* 折返：一条线太长换到下一行 —— 画出来才不会被读成"断了" */}
      {folds.map((s) => (
        <text key={`fold-${s.key}`} className={styles.foldMark} data-testid={`spc-fold-${s.key}`} x={s.x} y={s.y - STATION_RADIUS.max - 4} textAnchor="middle">
          ↩
        </text>
      ))}

      {line.stations.map((s) => (
        <Station key={s.key} s={s} selected={selectedProcessKey === s.key} onPick={onPick} />
      ))}
    </g>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 主组件
// ══════════════════════════════════════════════════════════════════════════════

export function ProcessCanvasView({ selectedProcessKey, onPick, honesty = true }: ProcessCanvasViewProps) {
  const t = zh.sim.sandbox.processCanvas;
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [transform, setTransform] = useState<ViewTransform>(IDENTITY_TRANSFORM);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  /** 拖拽态。`captured` = 是否**已经**越过阈值并设了指针捕获（见 `onPointerMove` 的长注释）。 */
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; captured: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    fetchProcessDefinitions()
      .then((res: ProcessDefinitionsResponse) => {
        if (!alive) return;
        setState({ status: "ready", res });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setState({ status: "error", ...readError(e) });
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * ── 节拍维的两个**租户级**输入（与会话无关，故没建会话时也照取）────────────────
   *
   * 两条都**共用宿主已经在用的缓存键与 queryFn**（`SandboxView.tsx:368` / `:493`）：
   * TanStack 按 key 去重 ⇒ 第五档挂出来**不多发一次请求**，拿到的也必然是同一份数据。
   * 另起一个键 = 第二份可能漂移的副本，那正是本仓记过的「两个 dev 各发明一套」的形态。
   *
   * `retry:false`：`sim.propagation` / 沙盘能力关着时后端回 404 FEATURE_NOT_FOUND，
   * 那是"没开通"不是"坏了"，重试无意义；取不到时本档如实说"分类算不出"，不假装全是静态。
   */
  const cfgQuery = useQuery({ queryKey: ["a", "sim", "view-config"], queryFn: fetchSimViewConfig, retry: false });
  const rulesQuery = useQuery({ queryKey: ["a", "sim-propagation-rules"], queryFn: () => fetchSimPropagationRules(), retry: false });
  const { snapshot, prevSnapshot } = useSandboxWorldObserver();

  /**
   * 节拍维输入。**两条判据源任一缺席 ⇒ 整个 `live` 为 `null`** ——
   * 于是本档逐字节退回本单之前的行为（additive 可回退），屏上另说一句"分类算不上来"，
   * 而**不是**默认把 65 条全判成「不随节拍变」：那会把"我不知道"渲染成"我知道它是静态的"，
   * 是本仓最忌的那类假陈述。
   */
  const liveInput: ProcessLiveInput | null = useMemo(() => {
    const cfg = cfgQuery.data;
    const rules = rulesQuery.data?.items;
    if (cfg === undefined || rules === undefined) return null;
    return {
      rules: rules.map((r) => ({ sourceTypeKey: r.sourceTypeKey, targetTypeKey: r.targetTypeKey })),
      nodeObjectIds: cfg.nodeObjectIds ?? {},
      snapshot,
      prevSnapshot,
    };
  }, [cfgQuery.data, rulesQuery.data, snapshot, prevSnapshot]);

  const model: ProcessCanvasModel | null = useMemo(
    () => (state.status === "ready" ? buildProcessCanvasModel(state.res, WAIT_KIND_ORDER, liveInput) : null),
    [state, liveInput],
  );
  const covered = useMemo(() => (model === null ? true : linesCoverAll(model)), [model]);
  const driveCovered = useMemo(() => (model === null ? true : liveDriveCoversAll(model)), [model]);
  /** 判据源缺席的原因（屏上要说清是"没开通/取不到"还是"没建会话"，两者处置不同）。 */
  const liveGap: "none" | "config" | "session" =
    liveInput === null ? "config" : liveInput.snapshot === null ? "session" : "none";

  const viewportSize = useCallback(() => {
    const el = canvasRef.current;
    return { w: el?.clientWidth ?? 0, h: el?.clientHeight ?? 0 };
  }, []);

  const doZoom = useCallback(
    (factor: number) => {
      const vp = viewportSize();
      setTransform((s) => zoomCenter(s, factor, vp.w, vp.h));
    },
    [viewportSize],
  );

  const stageW = model?.canvas.w ?? PROC_LAYOUT.minWidth;
  const stageH = model?.canvas.h ?? 420;

  /**
   * 适应画布。
   *
   * ── ⚠ 为什么要在 `fitTransform` 之后再夹一次（真浏览器实测逼出来的）──────────────
   * `fitTransform` 一律**居中**：`y = (viewportH − contentH·k) / 2`。
   * 当缩放被 `ZOOM_LIMITS.min`（0.4）夹住、内容仍比视口高时，这个式子是**负数** ——
   * 于是内容被往上顶出视口，**整张图的头几条线看不见了**，而屏上没有任何迹象说它被顶走了。
   *
   * **2026-08-14 真浏览器实测**（13 条线 · 65 站）：contentH≈2509，k 夹到 0.4
   * ⇒ contentH·k≈1004 > 视口 ≈560 ⇒ y ≈ −222，1 号线整条在视口上方。
   * 第一次跑真后端截图时正是它把「点站」打飘的（点击坐标落在画布之外），
   * mock（5 条线）因为装得下所以从没露过 —— 又一个「小数据集恒绿、真数据集才炸」的形态。
   *
   * ── 复验方式（分两半：能现算的现算，只能真浏览器测的说清楚它只能真浏览器测）──────
   * ① **可离线核对的那一半**（当场就能跑，不需要浏览器）：
   *    · 「13 条线 · 65 站」= 种子里 `DEMO_PROCESS_DEFINITIONS` 的条数与 distinct `domainKey`：
   *      `node -e "const s=require('fs').readFileSync('apps/datacore/src/seed.ts','utf8');
   *       const r=[...s.matchAll(/\{ key: \"(P\d\d)\", domainKey: \"(D\d\d)\"/g)];
   *       console.log(r.length, new Set(r.map(x=>x[2])).size)"` ⇒ 2026-08-14 现跑 `65 13`；
   *    · 算术：`k = ZOOM_LIMITS.min = 0.4`（`apps/frontend-shell/src/views/sim/physicalTopology.ts:832`），
   *      `fitTransform` 的居中式在同文件 `:861`；2509×0.4 = 1003.6 ≈1004，(560−1003.6)/2 = −221.8 ≈−222。
   * ② **只能真浏览器测的那一半**：`contentH≈2509` 与「视口 ≈560」是真后端 + 真布局的量值。
   *    jsdom 量不到视口 ⇒ `fitTransform` 回 `measured=false` ⇒ 本档直接退回单位变换，
   *    **这条分支在 vitest 里根本走不到**（`sandbox-process-mode` 绿不证明它对）。
   *    真浏览器复验：`docker compose up` 或双服务起来 → 沙盘第五档 → 点「适应」→
   *    看 `spc-fit-clamped` 是否出现、1 号线是否还在视口内。
   *    ⚠ 现状如实记账：`spc-fit-clamped` 今天**没有任何测试断言**（全仓仅本文件两处引用），
   *      它是一个只在真屏上才成立的诚实位，不是被门咬住的判据。
   * ⚠ 有保质期：`ZOOM_LIMITS.min` / `PROC_LAYOUT` 版面常量 / 种子流程条数任一变动即须重测。
   *
   * ⇒ 处置：装得下就居中（保持原行为），**装不下就顶左对齐**并当面说一句
   *   （`spc-fit-clamped`）—— 「缩到下限仍装不下」是一个事实，不许让它长得像"已经适应了"。
   *   ⚠ 这里**不改** `physicalTopology.fitTransform`：那是四档共用的实现，
   *   改它等于替另外三档做决定（本单范围边界之外）。故只在本档的调用点后夹一次。
   */
  const [fitClamped, setFitClamped] = useState(false);
  const doFit = useCallback(() => {
    const vp = viewportSize();
    // 量不到就退回单位变换（jsdom / 未布局 / display:none）——`fitTransform` 自己说了不假装。
    const { transform: next, measured } = fitTransform(vp.w, vp.h, stageW, stageH);
    const overflowsY = stageH * next.k > vp.h + 0.5;
    const overflowsX = stageW * next.k > vp.w + 0.5;
    setTransform({ k: next.k, x: overflowsX ? 0 : next.x, y: overflowsY ? 0 : next.y });
    setFitClamped(measured && (overflowsX || overflowsY));
  }, [stageH, stageW, viewportSize]);

  // 滚轮以光标为锚缩放：必须 non-passive 才能 preventDefault，故手绑而非 onWheel。
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setTransform((s) => zoomAt(s, e.clientX - rect.left, e.clientY - rect.top, factor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [model === null]);

  /**
   * ── ⚠ 平移与「点站」冲突：一个 **jsdom 结构上抓不到** 的真 bug（本单实测踩到）──────
   *
   * 第一版照第一档 `ChainLineMapView` 抄了平移：`onPointerDown` 里立刻
   * `setPointerCapture(e.pointerId)`。**jsdom 里 17/17 全绿，真浏览器里站点不开**。
   *
   * 根因：按 Pointer Events 规范，一旦设了指针捕获，后续 `pointerup` 与**由它合成的
   * `click`** 都会被派发到**捕获元素**（这块画布 div），而不是指针底下的那座站 ——
   * 于是站上的 `onClick` 永远不触发。
   *
   * 为什么第一档没这个毛病：它的站是 `role="img"` **不可点**（只 hover），
   * 所以照抄它的平移不会暴露这条。**"另一个档这么写"不是"这么写对"的证据。**
   *
   * 为什么 jsdom 报不出来：jsdom 的 `setPointerCapture` 是个不做重定向的空实现，
   * 「捕获会改写 click 的 target」这件事它**根本不模拟** ⇒ 这条门只能由真浏览器来把。
   * （本单的机制就是 `shot-metro.mjs`：它在真 Chromium 里点站并断言检视面板出内容。）
   *
   * ⇒ 订正：**先不捕获**；等指针真的移动超过阈值，才认定这是拖拽、才捕获。
   *   点击（位移 0）全程不进捕获态 ⇒ click 照常打到站上；
   *   拖出画布外仍要跟手，靠越过阈值后补上的那次捕获保证。
   */
  const DRAG_THRESHOLD_PX = 3;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: transform.x, oy: transform.y, captured: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.captured) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return; // 还没算拖拽 —— 别捕获，留给 click
      d.captured = true;
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }
    setTransform((s) => ({ ...s, x: d.ox + dx, y: d.oy + dy }));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d?.captured) (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      doZoom(ZOOM_STEP);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      doZoom(1 / ZOOM_STEP);
    } else if (e.key === "0") {
      e.preventDefault();
      doFit();
    }
  };

  return (
    <div className={shell.processCanvas} data-testid="spc-root">
      {honesty && model !== null ? (
        <p className={shell.noteWarn} data-testid="spc-honesty">
          {/* ① 条数现算：两个数都印出来，等号自己成立或不成立 —— 不写死任何金值 */}
          <b data-testid="spc-counts" data-total={model.total} data-laid={model.laid}>
            {t.counts(model.total, model.laid, model.lines.length)}
          </b>
          {!covered ? (
            <b className={shell.processMismatch} data-testid="spc-count-mismatch">
              {t.mismatch}
            </b>
          ) : null}
          {/* ⑤ 【本轮最重要】线怎么连 —— 第一层只留一句结论 + 档位，取证与反例进浮层 */}
          <span data-testid="spc-order-basis" data-basis={model.orderBasis}>
            <b>{t.orderBasisTitle}</b>
            <InfoPopover topic={zh.sim.sandbox.info.processOrderBasis} testId="process-order-basis">
              <span data-testid="spc-order-basis-note">{t.orderBasisDisplay}</span>
              <span data-testid="spc-order-basis-why">{t.orderBasisWhyNotNumber}</span>
              <span data-testid="spc-order-basis-where">{t.orderBasisWhereReal}</span>
            </InfoPopover>
          </span>
          {/* ③ 两层不混：交集现算，屏上就是那个数 */}
          <span data-testid="spc-disjoint" data-overlap={model.chainLayerOverlap.length}>
            {model.chainLayerOverlap.length === 0
              ? t.disjointOk
              : t.disjointBroken(model.chainLayerOverlap.join("、"))}
          </span>
          <InfoPopover topic={zh.sim.sandbox.info.processLayers} testId="process-layers">
            <span data-testid="spc-layers-note">{t.layersNote}</span>
          </InfoPopover>
          {/* ── ⑥ 【WO-PROCESS-CANVAS-LIVE·本轮新增】节拍总结 = 仓主要的那个「某个时间的 screenshot + 总结」
                 第一层**只放一句结论 + 一个 `?` 记号**，取证 / 分类判据 / 判据测不出什么 全在浮层。
                 ⚠ 三件事在这一句里必须分得开，任缺其一都会把一个事实伪装成另一个：
                   · 这是**哪一拍、哪个世界**（不写出来，"动了"是相对谁说的就没法核对）；
                   · **随节拍变的有几条 / 这一拍真动了几条**（两个数不是一回事）；
                   · **不随节拍变的有几条** —— 明说它「本层不随节拍变」，
                     既不是"没数据"，也不是"没画出来"。 */}
          <b
            className={liveGap === "none" ? styles.liveOk : styles.liveGap}
            data-testid="spc-live-summary"
            data-gap={liveGap}
            data-session={model.live?.sessionId ?? ""}
            data-tick={model.live?.tick ?? ""}
            data-prev-tick={model.live?.prevTick ?? ""}
            data-origin={model.live?.origin ?? ""}
            data-comparable={model.live?.comparable === true ? "1" : "0"}
            data-driven={model.live?.byDrive.find((g) => g.kind === "TICK_DRIVEN")?.count ?? ""}
            data-nodata={model.live?.byDrive.find((g) => g.kind === "NO_CARRIER_OBJECTS")?.count ?? ""}
            data-static={model.live?.byDrive.find((g) => g.kind === "NOT_TICK_DRIVEN")?.count ?? ""}
            data-moved={model.live?.movedKeys.length ?? ""}
          >
            {model.live === undefined
              ? t.liveConfigMissing
              : t.liveSummary({
                  sessionId: model.live.sessionId,
                  tick: model.live.tick,
                  prevTick: model.live.prevTick,
                  origin: model.live.origin,
                  comparable: model.live.comparable,
                  driven: model.live.byDrive.find((g) => g.kind === "TICK_DRIVEN")?.count ?? 0,
                  noData: model.live.byDrive.find((g) => g.kind === "NO_CARRIER_OBJECTS")?.count ?? 0,
                  staticCount: model.live.byDrive.find((g) => g.kind === "NOT_TICK_DRIVEN")?.count ?? 0,
                  moved: model.live.movedKeys.length,
                  netDelta: model.live.netDelta,
                  movedByWaitKind: model.live.movedByWaitKind.map((g) => ({
                    label: zh.processWait.waitKind[g.kind].label,
                    drivable: g.drivable,
                    moved: g.moved,
                  })),
                })}
          </b>
          <InfoPopover topic={zh.sim.sandbox.info.processTickDrive} testId="process-tick-drive">
            <span data-testid="spc-live-basis">{t.liveBasis}</span>
            {/* ⛔ 这一条是本档最要紧的诚实位：判据**测不出**「本质上该不该随节拍变」。
                   把它删掉，屏上那句「本层不随节拍变」就会被读成一个它证明不了的结论。 */}
            <span data-testid="spc-live-limit">{t.liveLimit}</span>
            <span data-testid="spc-live-waitkind-static">{t.liveWaitKindStatic}</span>
            <span data-testid="spc-live-observer">{t.liveObserver}</span>
            {model.live === undefined ? null : (
              <span data-testid="spc-live-drive-breakdown">
                {TICK_DRIVE_ORDER.map((k) => `${t.driveLabel[k]} ${model.live?.byDrive.find((g) => g.kind === k)?.count ?? 0}`).join(" · ")}
                {model.live.movedKeys.length === 0 ? "" : ` ｜ ${t.liveMovedKeys(model.live.movedKeys.join("、"))}`}
              </span>
            )}
            {!driveCovered ? (
              <span className={shell.processMismatch} data-testid="spc-live-drive-mismatch">
                {t.liveDriveMismatch}
              </span>
            ) : null}
          </InfoPopover>
          {/* ② 标准工期 ≠ 实测滞留（常驻，不折叠） */}
          <span data-testid="spc-stddays-caveat">{t.stdDaysCaveat}</span>
          {/* 换乘：有几处就说几处；一处没有也要说"这批数据就没有"，不留白 */}
          <span data-testid="spc-interchange-note" data-count={model.interchanges.length}>
            {model.interchanges.length === 0 ? t.interchangeNone : t.interchangeNote(model.interchanges.length)}
          </span>
          {model.labelOverflow.length > 0 ? (
            <span className={shell.processMismatch} data-testid="spc-label-overflow" data-count={model.labelOverflow.length}>
              {t.labelOverflow(model.labelOverflow.join("、"))}
            </span>
          ) : null}
          {model.unregisteredDomainKeys.length > 0 ? (
            <span data-testid="spc-unregistered-domains">{t.unregisteredDomains(model.unregisteredDomainKeys.join("、"))}</span>
          ) : null}
        </p>
      ) : null}

      {state.status === "loading" ? (
        <p className={shell.stateLine} data-testid="spc-loading">
          {t.loading}
        </p>
      ) : null}

      {state.status === "error" ? (
        <p className={shell.errBox} data-testid="spc-error" role="alert">
          <b>{t.errorTitle}</b> <code data-testid="spc-error-code">{state.code}</code> {state.message}
          {state.requestId !== null ? (
            <>
              {" · "}
              {zh.common.requestId}: <code>{state.requestId}</code>
            </>
          ) : null}
        </p>
      ) : null}

      {model !== null ? (
        <>
          {/* 四态计数条 ＋ 图例 ＋ 缩放控件（图元样例不带任何数字，不会被误读成数据） */}
          {/* ⚠ `data-layer="template"`（WO-PROCESS-CANVAS-LIVE 新增）：这一条四态计数数的是
              `ProcessDefinition.waitKind` —— **模板层**，推 tick 一个字都不会变。
              把它标出来，是因为它就摆在会随节拍跳的读数旁边，不标就会被读成"这四个数也在动"。
              这一拍"每一态里有几条真动了"是另一族度量，在 `spc-live-summary` 那句话里。 */}
          <div className={shell.processKindBar} data-testid="spc-kindbar" data-layer="template" data-tick-invariant="1">
            {model.byWaitKind.map((g) => (
              <span key={g.kind} className={shell.processKindChip} data-testid={`spc-kind-${g.kind}`} data-count={g.count}>
                <i aria-hidden="true" style={{ background: `var(${WAIT_KIND_STYLE[g.kind].colorVar})` }} />
                {zh.processWait.waitKind[g.kind].label}
                <b>{g.count}</b>
              </span>
            ))}
            <span className={styles.spacer} />
            <button className="btn sm" type="button" aria-label={t.zoomIn} data-testid="spc-zoom-in" onClick={() => doZoom(ZOOM_STEP)}>
              ＋
            </button>
            <button className="btn sm" type="button" aria-label={t.zoomOut} data-testid="spc-zoom-out" onClick={() => doZoom(1 / ZOOM_STEP)}>
              －
            </button>
            <button className="btn sm" type="button" aria-label={t.fit} data-testid="spc-fit" onClick={doFit}>
              ⤢
            </button>
            <span className={styles.zoomVal} data-testid="spc-zoom-readout">
              {t.zoomReadout(transform.k)}
            </span>
            {/* 缩到下限仍装不下 —— 说出来，别让它长得像"已经适应了" */}
            {fitClamped ? (
              <span className={styles.fitClamped} data-testid="spc-fit-clamped">
                {t.fitClamped}
              </span>
            ) : null}
          </div>

          {/* ── 图例 ──────────────────────────────────────────────────────────────
              **WO-PROCESS-CANVAS-LIVE 把它从第一层降到浮层**，理由是规范原文而不是腾地方：
              `docs/CONVENTION-ui-information-layering.md` §2 R-UI-3 ——「口径 / 公式 / 这个符号
              是什么意思」属浮层，第一层只放数值 / 状态 / 名字。图例整块正是"这个符号什么意思"。
              ⚠ **降层不是删除**（规范 §1）：`?` 触发器就是第一层留下的可见记号，
                四条原文一字未动、testid 一字未改，本轮新增的两个图元（脉冲环 / 虚线外环）
                也在同一处说明 —— 否则这张图上会出现"没人解释过的新符号"。
              实测（`node scripts/check-ui-first-layer.mjs --explain`）：
                first 38 → 35（回到本单之前的数）· deferred 10 → 16，
                即**内容真的搬下去了**，不是被删掉（D4 守恒判据要的正是这个方向）。 */}
          <section className={styles.legend} data-testid="spc-legend" role="note">
            <InfoPopover topic={zh.sim.sandbox.info.processLegend} testId="process-legend">
              <i className={styles.legendChip} data-testid="spc-legend-station">
                <svg width="26" height="18" aria-hidden="true">
                  <circle className={styles.stationDot} cx="13" cy="9" r="7" />
                </svg>
                {t.legendStation}
              </i>
              <i className={styles.legendChip} data-testid="spc-legend-interchange">
                <svg width="26" height="18" aria-hidden="true">
                  <circle className={styles.interchangeOuter} cx="13" cy="9" r="7" />
                  <circle className={styles.interchangeInner} cx="13" cy="9" r="3" />
                </svg>
                {t.legendInterchange}
              </i>
              <i className={styles.legendChip} data-testid="spc-legend-dashed">
                <svg width="34" height="18" aria-hidden="true">
                  <line className={styles.rail} x1="3" y1="9" x2="31" y2="9" />
                </svg>
                {t.legendDashed}
              </i>
              <i className={styles.legendChip} data-testid="spc-legend-waitkind">
                {t.legendWaitKind}
              </i>
              {/* 本轮新增的两个图元 —— 新符号必须在同一处有解释，否则屏上会多出没人说过的东西 */}
              <i className={styles.legendChip} data-testid="spc-legend-moved">
                <svg width="26" height="18" aria-hidden="true">
                  <circle className={styles.movedRing} cx="13" cy="9" r="7" />
                </svg>
                {t.legendMoved}
              </i>
              <i className={styles.legendChip} data-testid="spc-legend-static">
                <svg width="26" height="18" aria-hidden="true">
                  <circle className={styles.staticRing} cx="13" cy="9" r="7" />
                </svg>
                {t.legendStatic}
              </i>
            </InfoPopover>
          </section>

          {model.lines.length === 0 ? (
            <p className={shell.stateLine} data-testid="spc-empty">
              {t.empty}
            </p>
          ) : (
            <div
              ref={canvasRef}
              className={styles.canvas}
              /* ⚠ testid 逐字不变（`spc-board`）：§D3 的 `[title]` / `svg title` 计数就锚在它上面。 */
              data-testid="spc-board"
              data-zoom={transform.k.toFixed(2)}
              data-pan-x={Math.round(transform.x)}
              data-pan-y={Math.round(transform.y)}
              data-lines={model.lines.length}
              tabIndex={0}
              role="group"
              aria-label={t.canvasLabel}
              onKeyDown={onKeyDown}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              <svg
                className={styles.stage}
                data-testid="spc-stage"
                width={stageW}
                height={stageH}
                viewBox={`0 0 ${stageW} ${stageH}`}
                style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})` }}
              >
                {/* 换乘弧画在**站之下、线之上**：它跨线时会横穿别的线，压在站圈上会挡读数 */}
                {model.interchanges.map((ic) => (
                  <path
                    key={`${ic.fromKey}-${ic.toKey}`}
                    className={styles.interchangeArc}
                    /* ⚠ 命名空间刻意与说明段的 `spc-interchange-note` 分开：
                       `getAllByTestId(/^spc-interchange-/)` 会把那句说明也捞进来，
                       于是"逐条验弧的出处"这条断言会去查一个叫 note 的流程键 ——
                       这正是本仓记过的"我用 X 当作 Y 的证据"那类错，写测试时当场撞到过。 */
                    data-testid={`spc-ic-${ic.fromKey}-${ic.toKey}`}
                    data-carrier={ic.carrierTypeKey}
                    data-cross-line={ic.crossLine ? "1" : "0"}
                    d={ic.d}
                  />
                ))}
                {model.lines.map((line) => (
                  <Line key={line.domainKey} line={line} selectedProcessKey={selectedProcessKey} onPick={onPick} />
                ))}
              </svg>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

export default ProcessCanvasView;
