import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchObjects } from "@/api/endpoints";
import type { ViewRendererProps } from "../registry";
import {
  RING_LAYOUT,
  ringArcPointAt,
  ringRadialOffsetPoint,
  ringSegmentArc,
  ringStationAnchors,
  ringTangent,
  type RingSegmentArc,
  type RingStationAnchor,
} from "./chainLineMap";
import {
  TRANSIT_SOURCE_SPECS,
  cadenceExpectedWaitDays,
  deriveCadenceAbsence,
  deriveProcurementBranch,
  meanReleaseWaitDays,
  parseCadenceRows,
  parseInterBaseTransferRows,
  parseShipmentRows,
  parseWipLotRows,
  resolveSegments,
  resolveStations,
  simulateTransit,
  transitHorizonDays,
  type AbsenceRecord,
  type TransitBatch,
  type TransitNodeInput,
  type TransitParseResult,
  type TransitPositionMode,
  type TransitRawRow,
  type TransitSourceKey,
  type TransitSourceSpec,
  type TransitStation,
} from "./transitFlow";
import styles from "./TransitFlowLayer.module.css";

/**
 * WO-SANDBOX-F2 · **在途 / 在制层** `TransitFlowLayer` ＋ 其**宿主视图** `TransitFlowView`（本文件默认导出）。
 *
 * 区间上跑在途/在制批次 · 到限流站排队堆积 · 到节拍点批量放行 · 仿真时钟 + 播控倍速 + 事件流。
 * 所有机理在 `./transitFlow.ts`（纯函数），本文件只负责**画**与**播**。
 *
 * ⚠ 接线纪律（收口时补·F3/F4 同款教训 —— 本注释此前写的是"是图层不是独立 view，故不进
 *    `views/registry.ts`"，那句话在实测面前不成立）：`views/registry.ts` 是**手工登记**的字符串键表、
 *    无自动扫描；而设想中的宿主 F1 线路图 `ChainLineMapView.tsx` **从未挂载过本层**
 *    （实测：在 `apps/<app>/src` 与 `packages/<pkg>/src` 下 grep `TransitFlowLayer`，除本文件自身外 0 命中，
 *    无 barrel 再导出、无 `import.meta.glob`、无字符串键分发）。于是本层是**零生产调用方**——
 *    假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`：实现有、`transit-flow.seam.test.tsx` 全绿、
 *    却没有任何路由渲染得到它（测试咬的是**组件**，不是**链路**）。
 *    故本文件同时给出宿主视图 `TransitFlowView`（签名 = `Partial<ViewRendererProps>`，
 *    可赋给 `ComponentType<ViewRendererProps>`，注册即不打红构建），并由 `registry.ts`
 *    以键 `transit-flow` 登记。可达门见 `test/transit-flow-reachable.test.tsx`。
 *    图层身份不变：F1 线路图日后挂载本层时照旧传 `nodes`/`sources`，宿主与图层互不妨碍。
 *
 * ── 三条红线（写在最上面，因为它们比功能更重要）─────────────────────────────
 * ① **看不见的东西不许画出来**。三个数据源的位置精度天生不同：
 *    `InterBaseTransfer` 有发运日+到货日 → 真跑；`Shipment` 只有到货日 → 只给倒计时，**不画车**；
 *    `WIPLot` 只知道在哪台工序 → 站上驻留。
 *    任何一条支线取不到真值，就是「空 + 一行原因」，绝不给一个看起来合理的假动画。
 *    ⚠ 本条此前写的是"采购支线**画不出来** → 显示为空"，**那句话在 D2 并线后已不成立**：
 *    `PurchaseOrder` 现带 `orderDay/shipDay/arriveDay`，`CustomsClearance`/`IncomingInspection`
 *    各带两个日戳 ⇒ 四条腿的区间位置**算得出来**。今天仍不画的真实原因换成了一句更小的实话：
 *    本层的画车支线只有 `TRANSIT_SOURCE_SPECS` 那三条，采购段还没接成第四条（另一单）。
 *    这句实话**写在屏上**（`transit-branch-procurement-scope`），不许用旧的"画不出来"糊过去。
 * ② **前端零清单**：站点/区间只能来自引擎侧（宿主下发的 `nodes[]` **或对象库里的 `Cadence` 行**）
 *    或批次数据行自带的字段值；`nodeId` 当不透明 key 用，不 split、不看前缀。
 *    **「哪个站是限流站」只认引擎侧的 `cadence`**——前端不从批次行推断限流站、不维护名单。
 *    ⚠ 本条此前写的是"今天引擎发不出节拍（`Cadence` 全仓无承载物）"，**那句话在 D1 并线后已成假话**
 *    （`apps/datacore/src/synthetic/service.ts:712` `putAll("Cadence", …)` 真落库）。
 *    真实缺口是**本层从来没去问过**——WO-TRANSIT-WIRE 补上了那条查询（见下 `qCadence`）。
 * ③ **定时器纪律**：本组件全是定时器。每个句柄 ref **覆盖前先清**、卸载再清一遍。
 *    本仓刚修过 4 处「ref 只存得下最后一个 handle → 前一个成孤儿 → 整包随机红」。
 * ④ **坐标不许有第二处实现**（WO-TRANSIT-GEOMETRY 追加）：站点锚点 / 区间弧 / 弧长参数
 *    全部取自线路图的几何单源 `chainLineMap.ts` §5.2。本层此前自绘一套直线几何，
 *    与线路图的环没有共同坐标系 —— 那不是"样式不统一"，是**同一个实体在两张图上不是同一个点**。
 *
 * ── `prefers-reduced-motion` ───────────────────────────────────────────────────
 * 开启时：不跑动画（CSS 过渡关、rAF 脉冲不排）、**自动播放停用**，改为**静态标注**
 * （每辆车直接把「第 N 天 · 行程 xx%」写在旁边），仍可用步进逐日查看。
 */

// ══════════════════════════════════════════════════════════════════════════════
// WO-TRANSIT-GEOMETRY · 环上几何（坐标**只有一处实现**：`chainLineMap.ts` §5.2）
// ══════════════════════════════════════════════════════════════════════════════
/**
 * 本层此前自绘一套**直线**几何（一条横轨 + `left: p%` 绝对定位），与线路图的环
 * 没有共同坐标系 —— 同一个基地在两张图上不是同一个点，用户对不起来。现在改成：
 * 站点锚点、区间弧、弧长参数化**全部**取自 `chainLineMap.ts`（`ringStationAnchors` /
 * `ringSegmentArc` / `ringArcPointAt` / `ringRadialOffsetPoint` / `ringTangent`），
 * 本文件**不写一行三角函数**，也不写第二份 `cx/cy/rx/ry`。
 *
 * ── 三类批次三种图元（形状必须一眼分得开，不许只差个颜色深浅）────────────────
 * | 档 | 位置精度 | 图元 | 落在哪 |
 * |---|---|---|---|
 * | `interpolated`（有发运日+到货日） | 区间位置可算 | **三角形车头**（朝顺行切向） | 沿区间**弧**，按**弧长**参数化 |
 * | `arrival-only`（只有到货日） | 位置不可算 | **菱形到站徽标** + 倒计时数字 | 站上、沿半径**朝环外**推开 |
 * | `station-resident`（只知在哪站） | 位置不可算 | **横条堆叠** | 站上、沿半径**朝环内**堆叠 |
 * 后两类的锚点**在几何上就不可能落在弧上**（离环 ≥ 20px），因此"看起来在路上跑"这件事
 * 不是靠自觉避免的，是画法本身做不到 —— 这正是本层最值钱的那条判据的几何化。
 *
 * ⚠ 曾经最容易犯的错：为了让三类都能"漂亮地在环上滑"，给后两类补一个起点。
 *   那是纯发明。`Shipment` 没有起运地、`WIPLot` 没有 eta —— 补出来的进度条是编的。
 */
/**
 * 到站徽标沿半径**朝环外**推开的距离（px）。必须显著大于站圈半径，否则会压在弧上被误读成"在区间里"；
 * 也必须大于站名标签的外推距离（`RING_STATION_R + 12`），否则徽标压在站名上 —— 真浏览器实拍抓到过。
 */
const ARRIVAL_BADGE_OFFSET_PX = 36;
/** 同一站上多个到站徽标的叠放步距（px）。 */
const ARRIVAL_BADGE_STEP_PX = 15;
/** 站驻留堆叠沿半径**朝环内**的起始距离（px，取负 = 朝内）。 */
const RESIDENT_STACK_OFFSET_PX = -20;
/**
 * 堆叠排成**网格**而不是一长条。
 * 由来（真浏览器实拍抓到的）：demo seed 下 `WIPLot` 有 50 批且高度集中在少数几道工序，
 * 单列堆叠会顺着半径一路穿过环心扎到对面 —— 那不是"堆积"，那是一根刺穿全图的柱子。
 * 网格化只改**排布**，不改条数：**一批仍是一条**（`transit-resident-{batchId}` 一个不少），
 * 不做"只画前 N 个 + 省略号"那种把批次藏起来的减量。
 */
const RESIDENT_COLS = 5;
/** 网格沿**切向**的列距（px）。 */
const RESIDENT_COL_STEP_PX = 13;
/** 网格沿**半径朝内**的行距（px，取负 = 朝内）。 */
const RESIDENT_ROW_STEP_PX = -7;
/** 在途层站圈半径（px）。它只是个位置标记，不编码任何量（编码量的是线路图的站圈）。 */
const RING_STATION_R = 6;
/** 车（三角形）的长与半宽（px）。 */
const CAR_LEN = 13;
const CAR_HALF_W = 6;
/** 到站徽标（菱形）的半对角（px）。 */
const BADGE_R = 9;
/** 驻留横条的半长与高（px）。 */
const RESIDENT_HALF_W = 5;
const RESIDENT_H = 4;

/** 三类图元的形状标识 —— DOM 上的 `data-glyph` / `data-glyph-shape`，门直接咬它。 */
export const TRANSIT_GLYPHS = {
  interpolated: { glyph: "transit-car", shape: "triangle", label: "三角形车头 · 沿区间弧移动" },
  "arrival-only": { glyph: "arrival-badge", shape: "diamond", label: "菱形到站徽标 · 只挂在站上（环外）" },
  "station-resident": { glyph: "resident-stack", shape: "bar-stack", label: "横条堆叠 · 只挂在站上（环内）" },
} as const satisfies Record<TransitPositionMode, { glyph: string; shape: string; label: string }>;

/** 1× 速下每仿真日的墙钟时长（ms）。倍速 = 除以它。 */
export const TRANSIT_TICK_BASE_MS = 900;
/** 播控倍速档位。 */
export const TRANSIT_SPEEDS = [1, 2, 4, 8] as const;
export type TransitSpeed = (typeof TRANSIT_SPEEDS)[number];
/** 事件流最多显示多少条（新→旧）。 */
const EVENT_FEED_LIMIT = 40;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export interface TransitSourceRows {
  interBaseTransfer?: readonly TransitRawRow[];
  shipment?: readonly TransitRawRow[];
  wipLot?: readonly TransitRawRow[];
  /**
   * 对象库 `Cadence` 行（`GET /a/v1/objects?type=Cadence` 的 `items[]`）。
   * **`undefined` 的语义严格是「没拿到」**（判 `NOT_FETCHED`），与 `[]`（拿到了、就是 0 条 ⇒ `TENANT_EMPTY`）
   * 是两回事——混成一句"没有"就是本单在治的那个病（修法一个是接线、一个是种数据）。
   */
  cadence?: readonly TransitRawRow[];
  /** `GET /a/v1/objects?type=PurchaseOrder`（承载采购段「供应商生产」「在途」两条腿的日戳）。 */
  purchaseOrder?: readonly TransitRawRow[];
  /** `GET /a/v1/objects?type=CustomsClearance`（「清关」腿）。 */
  customsClearance?: readonly TransitRawRow[];
  /** `GET /a/v1/objects?type=IncomingInspection`（「到货检验」腿）。 */
  incomingInspection?: readonly TransitRawRow[];
}

export interface TransitFlowLayerProps {
  /**
   * 引擎下发的站点（F1 线路图挂载时由它传入）。
   * **不传 = 宿主没给**：站点退回"从批次数据行自身字段现场发现"。
   * ⚠ 不传**不再等于"节拍一律缺席"**：本层自己会去对象库读 `Cadence` 行（同为引擎侧承载），
   *   读得回来照样点亮闸门。前端在任何情况下都不自造节点清单。
   */
  nodes?: readonly TransitNodeInput[];
  /** 上层已取好的数据行；不传则本层自己取（`GET /a/v1/objects?type=…`）。 */
  sources?: TransitSourceRows;
  /** 初始仿真日（默认 0）。 */
  initialDay?: number;
  /** 初始倍速。 */
  initialSpeed?: TransitSpeed;
}

interface SourceBranch {
  spec: TransitSourceSpec;
  parsed: TransitParseResult;
  /** 取数本身失败（网络/权限）时的原因；成功则 null。 */
  fetchError: string | null;
  /** 是否还在取数。 */
  loading: boolean;
}

/**
 * 一份「缺席判定输入」的**真实来路**（WO-TRANSIT-WIRE）。
 *
 * `rows === undefined` 的语义**严格**是「没拿到这批行」：上层没喂、或本层这条查询还没回来 / 失败了。
 * 派生层据此判 `NOT_FETCHED`；`rows === []` 才是「问过了、就是 0 条」（`TENANT_EMPTY`）。
 * 这两者此前被混成同一句"没有"，而它们的修法一个是接线、一个是种数据。
 */
interface RowsProbe {
  rows: readonly TransitRawRow[] | undefined;
  /** 查询还在飞 —— 屏上必须显示"取数中"，不许在这一刻宣告"本层没去取"（那是这一刻的假话）。 */
  loading: boolean;
  /** 取数失败的人读原因；成功 / 未发起则 null。 */
  fetchError: string | null;
}

/**
 * 把「上层喂的一份行」与「本层自取的那条查询」收敛成同一个 `RowsProbe`。
 * `sources !== undefined` ⇒ 上层接管取数，本层的查询被 `enabled:false` 关掉，probe 只认上层喂的那份。
 */
function rowsProbe(
  sources: TransitSourceRows | undefined,
  given: readonly TransitRawRow[] | undefined,
  q: { items: unknown; error: unknown; loading: boolean },
): RowsProbe {
  if (sources !== undefined) return { rows: given, loading: false, fetchError: null };
  return {
    // 非数组一律读作"没拿到"，绝不把一个形状不对的响应当成"查了回 0 条"。
    rows: Array.isArray(q.items) ? (q.items as readonly TransitRawRow[]) : undefined,
    loading: q.loading,
    fetchError: errMsg(q.error),
  };
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** 取数失败的人读原因（诚实原样透出，不吞成"暂无数据"）。 */
function errMsg(e: unknown): string | null {
  return e instanceof Error ? e.message : e != null ? String(e) : null;
}

/** `prefers-reduced-motion` 探测（jsdom 无 `matchMedia`，故每一步都判存在性，不假设浏览器 API）。 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    if (typeof mq.addListener === "function") {
      mq.addListener(onChange);
      return () => mq.removeListener(onChange);
    }
    return;
  }, []);
  return reduced;
}

/** 一条支线的诚实呈现：有数据就画，没有就「空 + 原因」，绝不留白不解释。 */
function BranchHeader({ branch }: { branch: SourceBranch }) {
  const empty = branch.parsed.accepted === 0;
  return (
    <header
      className={styles.branchHead}
      data-testid={`transit-source-${branch.spec.key}`}
      data-status={branch.loading ? "LOADING" : empty ? "EMPTY" : "LIVE"}
      data-mode={branch.spec.mode}
      data-accepted={branch.parsed.accepted}
      data-rejected={branch.parsed.rejected}
    >
      <div className={styles.branchTitleRow}>
        <b className={styles.branchTitle}>{branch.spec.label}</b>
        <code className={styles.objType}>{branch.spec.objectType}</code>
        <span className={styles.badge} data-tone={empty ? "empty" : "live"}>
          {branch.loading ? "取数中" : empty ? "EMPTY" : `${branch.parsed.accepted} 批`}
        </span>
      </div>
      <p className={styles.modeReason} data-testid={`transit-source-${branch.spec.key}-mode`}>
        {branch.spec.modeReason}
      </p>
      {branch.fetchError !== null ? (
        <p className={styles.emptyReason} data-testid={`transit-source-${branch.spec.key}-reason`}>
          取数失败：{branch.fetchError} —— 判为未接入，不画。
        </p>
      ) : null}
      {branch.fetchError === null && branch.parsed.rejectReasons.length > 0 ? (
        <ul className={styles.reasonList} data-testid={`transit-source-${branch.spec.key}-reason`}>
          {branch.parsed.rejectReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {empty && branch.fetchError === null && branch.parsed.rejectReasons.length === 0 && !branch.loading ? (
        <p className={styles.emptyReason} data-testid={`transit-source-${branch.spec.key}-reason`}>
          该对象返回 0 行 —— 显示为空，不补一条示意批次。
        </p>
      ) : null}
    </header>
  );
}

export function TransitFlowLayer({ nodes, sources, initialDay = 0, initialSpeed = 1 }: TransitFlowLayerProps = {}) {
  const reduced = usePrefersReducedMotion();
  const wantFetch = sources === undefined;

  const qTransfer = useQuery({
    queryKey: ["a", "objects", { type: "InterBaseTransfer", layer: "transit-flow" }],
    queryFn: () => searchObjects("InterBaseTransfer", ""),
    enabled: wantFetch,
    retry: false,
  });
  const qShipment = useQuery({
    queryKey: ["a", "objects", { type: "Shipment", layer: "transit-flow" }],
    queryFn: () => searchObjects("Shipment", ""),
    enabled: wantFetch,
    retry: false,
  });
  const qWip = useQuery({
    queryKey: ["a", "objects", { type: "WIPLot", layer: "transit-flow" }],
    queryFn: () => searchObjects("WIPLot", ""),
    enabled: wantFetch,
    retry: false,
  });

  // ══════════════════════════════════════════════════════════════════════════
  // WO-TRANSIT-WIRE · 本单补的四条查询 —— **本层此前从来没问过这四个对象**
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * 上面三条查询之外，屏上还有两块"诚实缺席"面板（节拍闸门 / 采购在途支线）。
   * 它们此前恒空，而面板给的理由是「本体没有」—— **那句话在 D1/D2 并线之后就是假的**：
   *  · `Cadence`            —— `apps/datacore/src/synthetic/service.ts:712` `putAll("Cadence", …)` 真落库
   *                            （`apps/datacore/src/app.ts:1447` 的推演 tick 已在读它）；
   *  · `CustomsClearance`   —— 声明 `apps/datacore/src/synthetic/battery-extended.ts:169`，落库 `service.ts:775`；
   *  · `IncomingInspection` —— 声明 `battery-extended.ts:182`，落库 `service.ts:776`；
   *  · `PurchaseOrder`      —— `battery-extended.ts:157-164` 现带 `orderDay/shipDay/arriveDay` 三日戳，落库 `service.ts:773`。
   *
   * 真实病因是**接了线接错地方 / 压根没问**：判据挂在"宿主传没传 `nodes`"上，
   * 而承载在对象库的行里。本单把这四条线接上 —— 从此「缺席」是每次渲染现判的**结论**，
   * 不再是一句写死的话。取不到照样诚实缺席，但**病因分档**（没去取 / 取回来读不成 / 本租户真没有）。
   */
  const qCadence = useQuery({
    queryKey: ["a", "objects", { type: "Cadence", layer: "transit-flow" }],
    queryFn: () => searchObjects("Cadence", ""),
    enabled: wantFetch,
    retry: false,
  });
  const qPurchaseOrder = useQuery({
    queryKey: ["a", "objects", { type: "PurchaseOrder", layer: "transit-flow" }],
    queryFn: () => searchObjects("PurchaseOrder", ""),
    enabled: wantFetch,
    retry: false,
  });
  const qCustoms = useQuery({
    queryKey: ["a", "objects", { type: "CustomsClearance", layer: "transit-flow" }],
    queryFn: () => searchObjects("CustomsClearance", ""),
    enabled: wantFetch,
    retry: false,
  });
  const qInspection = useQuery({
    queryKey: ["a", "objects", { type: "IncomingInspection", layer: "transit-flow" }],
    queryFn: () => searchObjects("IncomingInspection", ""),
    enabled: wantFetch,
    retry: false,
  });

  // ⚠ 依赖只挂 useQuery 的**值**（data/error/isLoading），不挂 query 对象本身：
  //   后者每次渲染都是新引用，会让下面整条 memo 链（batches→stations→frame）每帧重算，
  //   进而让 rAF 那条 effect 每帧重排一次句柄 —— 正是"孤儿句柄"的温床。
  const branches = useMemo<SourceBranch[]>(() => {
    const pick = (key: TransitSourceKey) =>
      key === "interBaseTransfer"
        ? { items: qTransfer.data?.items, error: qTransfer.error, loading: qTransfer.isLoading }
        : key === "shipment"
          ? { items: qShipment.data?.items, error: qShipment.error, loading: qShipment.isLoading }
          : { items: qWip.data?.items, error: qWip.error, loading: qWip.isLoading };
    const parseOf = (key: TransitSourceKey, rows: readonly TransitRawRow[]): TransitParseResult =>
      key === "interBaseTransfer"
        ? parseInterBaseTransferRows(rows)
        : key === "shipment"
          ? parseShipmentRows(rows)
          : parseWipLotRows(rows);

    return TRANSIT_SOURCE_SPECS.map((spec) => {
      if (sources !== undefined) {
        return { spec, parsed: parseOf(spec.key, sources[spec.key] ?? []), fetchError: null, loading: false };
      }
      const q = pick(spec.key);
      return {
        spec,
        parsed: parseOf(spec.key, (q.items ?? []) as readonly TransitRawRow[]),
        fetchError: errMsg(q.error),
        loading: q.loading,
      };
    });
  }, [
    sources,
    qTransfer.data,
    qTransfer.error,
    qTransfer.isLoading,
    qShipment.data,
    qShipment.error,
    qShipment.isLoading,
    qWip.data,
    qWip.error,
    qWip.isLoading,
  ]);

  /** 四条新查询各自的真实来路（同款"只挂值不挂 query 对象"纪律）。 */
  const probes = useMemo(
    () => ({
      cadence: rowsProbe(sources, sources?.cadence, {
        items: qCadence.data?.items,
        error: qCadence.error,
        loading: qCadence.isLoading,
      }),
      purchaseOrder: rowsProbe(sources, sources?.purchaseOrder, {
        items: qPurchaseOrder.data?.items,
        error: qPurchaseOrder.error,
        loading: qPurchaseOrder.isLoading,
      }),
      customs: rowsProbe(sources, sources?.customsClearance, {
        items: qCustoms.data?.items,
        error: qCustoms.error,
        loading: qCustoms.isLoading,
      }),
      inspection: rowsProbe(sources, sources?.incomingInspection, {
        items: qInspection.data?.items,
        error: qInspection.error,
        loading: qInspection.isLoading,
      }),
    }),
    [
      sources,
      qCadence.data,
      qCadence.error,
      qCadence.isLoading,
      qPurchaseOrder.data,
      qPurchaseOrder.error,
      qPurchaseOrder.isLoading,
      qCustoms.data,
      qCustoms.error,
      qCustoms.isLoading,
      qInspection.data,
      qInspection.error,
      qInspection.isLoading,
    ],
  );

  const batches = useMemo<TransitBatch[]>(() => branches.flatMap((b) => b.parsed.batches), [branches]);

  /** 对象库 `Cadence` 行 → 契约 `Cadence`（读回口是 `transitFlow.ts` 的受控镜像，本文件不另写判据）。 */
  const cadenceParse = useMemo(
    () => (probes.cadence.rows === undefined ? null : parseCadenceRows(probes.cadence.rows)),
    [probes.cadence.rows],
  );

  /**
   * **引擎侧站点** = 宿主下发的 `nodes[]` ⊕ 对象库读回的 `Cadence` 行。
   *
   * 红线②原样成立：这两路**都是引擎侧**承载（`nodes[]` 由 F1 线路图下发、`Cadence` 行由种子推导后落库），
   * 本层依旧**不从批次数据行推断限流站**、不维护任何名单。
   * 两路都空 ⇒ 保持 `undefined`（＝"引擎侧什么都没给"），不退化成 `[]`——
   * 后者会让下游把"没问过"读成"问了没有"。
   */
  const engineNodes = useMemo<readonly TransitNodeInput[] | undefined>(() => {
    const fromStore = cadenceParse?.nodes ?? [];
    if (nodes === undefined && fromStore.length === 0) return nodes;
    const merged: TransitNodeInput[] = [];
    const at = new Map<string, number>();
    for (const n of nodes ?? []) {
      at.set(n.nodeId, merged.length);
      merged.push(n);
    }
    for (const n of fromStore) {
      const i = at.get(n.nodeId);
      if (i === undefined) {
        at.set(n.nodeId, merged.length);
        merged.push(n);
        continue;
      }
      // 同一个站两路都给：保住宿主给的站序与 label，只把它缺的那个 cadence 补上。
      const cur = merged[i]!;
      if (cur.cadence === undefined) merged[i] = { ...cur, cadence: n.cadence };
    }
    return merged;
  }, [nodes, cadenceParse]);

  const stations = useMemo<TransitStation[]>(() => resolveStations(engineNodes, batches), [engineNodes, batches]);
  const segments = useMemo(() => resolveSegments(batches), [batches]);
  const simInput = useMemo(() => ({ stations, batches }), [stations, batches]);
  const horizon = useMemo(() => transitHorizonDays(simInput), [simInput]);

  const [day, setDay] = useState(initialDay);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<TransitSpeed>(initialSpeed);

  const frame = useMemo(() => simulateTransit(simInput, day), [simInput, day]);

  // ── 仿真时钟（唯一句柄 ref · 覆盖前先清 · 卸载再清）────────────────────────
  const tickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTick = useCallback(() => {
    if (tickRef.current !== null) {
      clearTimeout(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearTick(); // ← 覆盖 ref 前先清，绝不让上一个 handle 变孤儿
    // 减少动态效果偏好开启 ⇒ 不自动播放（改静态标注 + 手动步进）
    if (!playing || reduced || day >= horizon) return clearTick;
    tickRef.current = setTimeout(() => {
      tickRef.current = null;
      setDay((d) => Math.min(d + 1, horizon));
    }, TRANSIT_TICK_BASE_MS / speed);
    return clearTick;
  }, [playing, reduced, speed, day, horizon, clearTick]);

  // 到窗口右端自动停（副作用独立成一条，不塞进 setState updater 里）
  useEffect(() => {
    if (playing && day >= horizon) setPlaying(false);
  }, [playing, day, horizon]);

  // 数据变化让窗口变短时把时钟夹回窗口内 —— 否则读数会出现"第 9 / 0 天"这种自相矛盾的显示
  useEffect(() => {
    setDay((d) => Math.min(d, horizon));
  }, [horizon]);

  // ── 放行脉冲（rAF · 同样是覆盖前先清 + 卸载清；reduced 下根本不排）──────────
  const [pulseNodeId, setPulseNodeId] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const clearRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const batchGateToday = useMemo(() => frame.releases.find((r) => r.day === day && r.size >= 2) ?? null, [frame, day]);

  useEffect(() => {
    clearRaf(); // ← 覆盖 rAF 句柄前先清
    if (reduced || batchGateToday === null) {
      setPulseNodeId(null);
      return clearRaf;
    }
    const nodeId = batchGateToday.nodeId;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setPulseNodeId(nodeId);
    });
    return clearRaf;
  }, [batchGateToday, reduced, clearRaf]);

  useEffect(() => () => {
    clearTick();
    clearRaf();
  }, [clearTick, clearRaf]);

  const stationById = useMemo(() => new Map(stations.map((s) => [s.nodeId, s])), [stations]);
  const labelOf = useCallback((nodeId: string) => stationById.get(nodeId)?.label ?? nodeId, [stationById]);
  const cadenceStations = useMemo(() => stations.filter((s) => s.cadence !== undefined), [stations]);
  const meanWait = useMemo(() => meanReleaseWaitDays(frame.releases), [frame]);

  // ── 两块诚实缺席面板：**每次渲染现判**，不再读那两个模块级常量 ────────────────
  /**
   * ⚠ 这里传的是**原始** `nodes` prop（不是上面合并过的 `engineNodes`）——
   *   合并后的那份把两路加在一起，`probe.fetched` 会重复计数。probe 是给人复验用的计数，
   *   必须对应"我分别问了什么、各回了几条"，不能是一个被加工过的数。
   */
  const cadenceAbsence = useMemo<AbsenceRecord>(
    () => deriveCadenceAbsence({ engineNodes: nodes, cadenceRows: probes.cadence.rows }),
    [nodes, probes.cadence.rows],
  );
  const procurementBranch = useMemo<AbsenceRecord>(
    () =>
      deriveProcurementBranch({
        purchaseOrderRows: probes.purchaseOrder.rows,
        customsRows: probes.customs.rows,
        inspectionRows: probes.inspection.rows,
      }),
    [probes.purchaseOrder.rows, probes.customs.rows, probes.inspection.rows],
  );
  /** 采购段三条查询里只要还有一条在飞，就还没到"可以下结论"的时刻。 */
  const procurementLoading =
    probes.purchaseOrder.loading || probes.customs.loading || probes.inspection.loading;
  const procurementFetchError =
    probes.purchaseOrder.fetchError ?? probes.customs.fetchError ?? probes.inspection.fetchError;

  const arrivalVehicles = useMemo(() => frame.vehicles.filter((v) => v.mode === "arrival-only"), [frame]);
  const residentVehicles = useMemo(() => frame.vehicles.filter((v) => v.mode === "station-resident"), [frame]);
  const feed = useMemo(() => [...frame.events].reverse().slice(0, EVENT_FEED_LIMIT), [frame]);

  // ── 环几何：站点锚点 / 区间弧 —— 全部来自线路图的单源，本层不再算一遍 ──────────
  const anchors = useMemo<RingStationAnchor[]>(() => ringStationAnchors(stations.map((s) => s.nodeId)), [stations]);
  const anchorByNode = useMemo(() => new Map(anchors.map((a) => [a.nodeId, a])), [anchors]);

  const segmentArcs = useMemo<RingSegmentArc[]>(() => {
    const out: RingSegmentArc[] = [];
    for (const seg of segments) {
      const from = anchorByNode.get(seg.fromNodeId);
      const to = anchorByNode.get(seg.toNodeId);
      // 站点集合是批次的并集（`resolveStations`），正常取得到；万一取不到就**不画这段**，
      // 绝不给它编一个落点 —— 一条落在编出来的坐标上的弧，比没有这条弧危险得多。
      if (from === undefined || to === undefined) continue;
      out.push(ringSegmentArc(from, to, seg.segmentId));
    }
    return out;
  }, [segments, anchorByNode]);
  const arcBySegment = useMemo(() => new Map(segmentArcs.map((a) => [a.segmentId, a])), [segmentArcs]);

  /**
   * 在途车（**唯一**能落到弧上的一类）。位置 = 该区间弧的**弧长参数** `progress`。
   * `progress === null`（还没发运）⇒ 落在起点站（t=0），且 `data-progress` 留空 ——
   * 「还没出发」与「走了 0%」在读数上必须分得开。
   */
  const cars = useMemo(() => {
    return frame.vehicles.flatMap((v) => {
      if (v.mode !== "interpolated" || v.segmentId === null) return [];
      const arc = arcBySegment.get(v.segmentId);
      if (arc === undefined) return [];
      const p = ringArcPointAt(arc.a0, arc.a1, arc.k, v.progress ?? 0);
      const tan = ringTangent(p.angle, arc.k);
      return [{ v, arc, p, tan }];
    });
  }, [frame, arcBySegment]);

  /** 只有到站日的：**站上**徽标（沿半径朝环外），同站多批向外叠。不产生任何区间位置。 */
  const arrivalGlyphs = useMemo(() => {
    const used = new Map<string, number>();
    return arrivalVehicles.flatMap((v) => {
      const a = anchorByNode.get(v.destNodeId);
      if (a === undefined) return [];
      const i = used.get(v.destNodeId) ?? 0;
      used.set(v.destNodeId, i + 1);
      const p = ringRadialOffsetPoint(a.angle, a.k, ARRIVAL_BADGE_OFFSET_PX + i * ARRIVAL_BADGE_STEP_PX);
      return [{ v, anchor: a, p }];
    });
  }, [arrivalVehicles, anchorByNode]);

  /**
   * 只知道在哪一站的：**站上**横条堆叠（沿半径朝环内，排成网格）。同样不产生任何区间位置。
   * 网格 = 半径方向分行 + 切向分列；切向也走单源的 `ringTangent`，本层不自己求导。
   */
  const residentGlyphs = useMemo(() => {
    const used = new Map<string, number>();
    return residentVehicles.flatMap((v) => {
      const a = anchorByNode.get(v.destNodeId);
      if (a === undefined) return [];
      const i = used.get(v.destNodeId) ?? 0;
      used.set(v.destNodeId, i + 1);
      const row = Math.floor(i / RESIDENT_COLS);
      const col = i % RESIDENT_COLS;
      const base = ringRadialOffsetPoint(a.angle, a.k, RESIDENT_STACK_OFFSET_PX + row * RESIDENT_ROW_STEP_PX);
      const tan = ringTangent(a.angle, a.k);
      const off = (col - (RESIDENT_COLS - 1) / 2) * RESIDENT_COL_STEP_PX;
      return [{ v, anchor: a, p: { x: base.x + tan.dx * off, y: base.y + tan.dy * off } }];
    });
  }, [residentVehicles, anchorByNode]);

  const queueSizeByNode = useMemo(() => new Map(frame.queues.map((q) => [q.nodeId, q.batchIds.length])), [frame]);

  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      setDay((d) => Math.max(0, Math.min(horizon, d + delta)));
    },
    [horizon],
  );

  return (
    <section
      className={styles.layer}
      data-testid="transit-flow-layer"
      data-day={day}
      data-horizon={horizon}
      data-playing={playing ? "1" : "0"}
      data-speed={speed}
      data-reduced-motion={reduced ? "1" : "0"}
      data-station-origin={stations[0]?.origin ?? "none"}
      aria-label="在途 / 在制批次层"
    >
      {/* ── 播控 ─────────────────────────────────────────────────────────── */}
      <div className={styles.transport} role="group" aria-label="播控">
        <button
          type="button"
          className={styles.btn}
          data-testid="transit-playpause"
          data-state={playing ? "playing" : "paused"}
          disabled={reduced || horizon === 0}
          title={reduced ? "系统偏好「减少动态效果」已开启 → 自动播放停用，请用步进" : undefined}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? "暂停" : "播放"}
        </button>
        <button type="button" className={styles.btn} data-testid="transit-step-back" onClick={() => step(-1)} disabled={day <= 0}>
          ◀ 步退
        </button>
        <button type="button" className={styles.btn} data-testid="transit-step-fwd" onClick={() => step(1)} disabled={day >= horizon}>
          步进 ▶
        </button>
        <button
          type="button"
          className={styles.btn}
          data-testid="transit-reset"
          onClick={() => {
            setPlaying(false);
            setDay(0);
          }}
        >
          复位
        </button>
        <span className={styles.speedGroup} role="group" aria-label="倍速">
          {TRANSIT_SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.speedBtn}
              data-testid={`transit-speed-${s}`}
              data-active={speed === s ? "1" : "0"}
              onClick={() => setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </span>
        <output className={styles.dayReadout} data-testid="transit-day-readout">
          第 {day} / {horizon} 天
        </output>
        <span className={styles.counts} data-testid="transit-counts">
          在途 {frame.movingCount} · 排队 {frame.heldCount}
        </span>
      </div>

      {reduced ? (
        <p className={styles.reducedNote} data-testid="transit-reduced-motion-note">
          已检测到系统偏好「减少动态效果」：**不跑动画**，自动播放停用，改为静态标注（每辆车旁直接标出当日行程），可用步进逐日查看。
        </p>
      ) : null}

      {/* ── 数据源诚实条 ─────────────────────────────────────────────────── */}
      <div className={styles.branches}>
        {branches.map((b) => (
          <BranchHeader key={b.spec.key} branch={b} />
        ))}
      </div>

      {/* ── 节拍（限流站）：只认引擎侧的 cadence（宿主 nodes[] ⊕ 对象库 Cadence 行）────── */}
      {cadenceStations.length === 0 ? (
        <div
          className={styles.absence}
          data-testid="transit-cadence-absence"
          data-status={cadenceAbsence.status}
          data-cause={cadenceAbsence.cause}
          data-fetched={cadenceAbsence.probe.fetched === null ? "" : cadenceAbsence.probe.fetched}
          data-usable={cadenceAbsence.probe.usable}
          data-loading={probes.cadence.loading ? "1" : "0"}
        >
          <b className={styles.absenceTitle}>节拍闸门 · EMPTY</b>
          {probes.cadence.loading ? (
            <p className={styles.emptyReason} data-testid="transit-cadence-fetching">
              正在取 <code className={styles.objType}>GET /a/v1/objects?type=Cadence</code> —— 还没回来，此刻不下任何结论。
            </p>
          ) : (
            <p className={styles.emptyReason}>{cadenceAbsence.reason}</p>
          )}
          {probes.cadence.fetchError !== null ? (
            <p className={styles.emptyReason} data-testid="transit-cadence-fetch-error">
              取数失败：{probes.cadence.fetchError} —— 判为**没拿到**（不是"本租户没有"），不画。
            </p>
          ) : null}
          <ul className={styles.reasonList}>
            {cadenceAbsence.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <p className={styles.unblock}>补齐路径：{cadenceAbsence.unblockedBy}</p>
        </div>
      ) : (
        <div className={styles.cadences} data-testid="transit-cadence-live" data-count={cadenceStations.length}>
          {cadenceStations.map((s) => {
            const cadence = s.cadence;
            if (cadence === undefined) return null;
            return (
              <span key={s.nodeId} className={styles.cadenceChip} data-testid={`transit-cadence-${s.nodeId}`} data-every={cadence.everyDays}>
                限流站 {s.label} · 每 {cadence.everyDays} 天开闸（{cadence.kind}）· 等待期望 {cadenceExpectedWaitDays(cadence)} 天
              </span>
            );
          })}
          {meanWait === null ? null : (
            <span className={styles.cadenceChip} data-testid="transit-mean-wait" data-value={meanWait}>
              实测平均等待 {meanWait.toFixed(2)} 天
            </span>
          )}
        </div>
      )}

      {/* ── 环上几何：站点坐标与区间弧取自线路图单源，三类批次三种图元 ──────── */}
      <div className={styles.ringWrap} data-testid="transit-segments" data-count={segments.length} data-drawn={segmentArcs.length}>
        <p className={styles.geomNote} data-testid="transit-geometry-source" data-source="chain-line-map">
          站点坐标与区间弧取自线路图几何<b>单源</b> <code className={styles.objType}>chainLineMap.ts</code>
          （同一个 <code className={styles.objType}>RING_LAYOUT</code> 椭圆 · 同一条 <code className={styles.objType}>ringAngle</code>{" "}
          均分规则 · 同一个 <code className={styles.objType}>ringArcPath</code> 弧生成器 · 车按<b>弧长参数</b>定位，不是弦的线性插值）——
          本层<b>不再自绘直线几何</b>，也不再算第二遍站点位置。
          ⚠ 但<b>同一个环不等于同一套站</b>：线路图的站是引擎 <code className={styles.objType}>chain_loss_attribution</code>{" "}
          的链路节点，本层的站是批次数据行自带的基地 / 工序 key —— 两者今天<b>没有共同的 id 维度</b>，
          故同角度<b>不代表</b>同一个实体；要真正指到同一个点，需引擎给本层下发{" "}
          <code className={styles.objType}>nodes</code>（本层 prop 已就位，等接线）。
        </p>

        {segments.length === 0 ? (
          <p className={styles.emptyReason} data-testid="transit-segments-empty">
            无可算位置的区间 —— 没有任何一条在途批次同时具备发运日与到货日，因此不画区间，也不画车。
          </p>
        ) : null}

        <svg
          className={styles.ringSvg}
          data-testid="transit-ring"
          data-station-count={anchors.length}
          data-segment-count={segmentArcs.length}
          data-car-count={cars.length}
          viewBox={`0 0 ${RING_LAYOUT.viewW} ${RING_LAYOUT.viewH}`}
          role="img"
          aria-label="在途 / 在制批次（落在与全链线路图同一套环几何上）"
        >
          {/* 环导引线：站点还没长出来时也让人看见「这是同一个环」 */}
          <ellipse
            className={styles.ringGuide}
            cx={RING_LAYOUT.cx}
            cy={RING_LAYOUT.cy}
            rx={RING_LAYOUT.rx}
            ry={RING_LAYOUT.ry}
            aria-hidden="true"
          />

          {/* 区间 = 环上的**弧**（`ringArcPath` 同一个生成器；弦会从环内穿过去） */}
          {segmentArcs.map((arc) => (
            <path
              key={arc.segmentId}
              className={styles.arc}
              data-testid={`transit-segment-${arc.segmentId}`}
              data-from={arc.fromNodeId}
              data-to={arc.toNodeId}
              data-a0={arc.a0.toFixed(6)}
              data-a1={arc.a1.toFixed(6)}
              data-length={arc.lengthPx.toFixed(3)}
              d={arc.path}
              fill="none"
            />
          ))}

          {/* 站 */}
          {anchors.map((a) => {
            const st = stationById.get(a.nodeId);
            const L = ringRadialOffsetPoint(a.angle, a.k, RING_STATION_R + 12);
            const co = Math.cos(a.angle);
            return (
              <g
                key={a.nodeId}
                className={styles.station}
                data-testid={`transit-station-${a.nodeId}`}
                data-label-source={st?.labelSource ?? "raw-id"}
                data-origin={st?.origin ?? "data-row"}
                data-cadence={st?.cadence === undefined ? "0" : "1"}
                data-pulse={pulseNodeId === a.nodeId ? "1" : "0"}
                data-queue={queueSizeByNode.get(a.nodeId) ?? 0}
                data-index={a.index}
                data-angle={a.angle.toFixed(6)}
                data-x={a.x.toFixed(2)}
                data-y={a.y.toFixed(2)}
              >
                <circle className={styles.stationDot} cx={a.x.toFixed(2)} cy={a.y.toFixed(2)} r={RING_STATION_R} />
                <text
                  className={styles.stationName}
                  x={L.x.toFixed(2)}
                  y={L.y.toFixed(2)}
                  textAnchor={Math.abs(co) < 0.34 ? "middle" : co > 0 ? "start" : "end"}
                  dominantBaseline="middle"
                >
                  {st?.label ?? a.nodeId}
                </text>
              </g>
            );
          })}

          {/* ① 可算区间位置的：三角形车头，沿弧、按**弧长参数**定位，车头朝顺行切向 */}
          {cars.map(({ v, arc, p, tan }) => {
            const nx = -tan.dy;
            const ny = tan.dx;
            const head = { x: p.x + tan.dx * CAR_LEN * 0.62, y: p.y + tan.dy * CAR_LEN * 0.62 };
            const l = { x: p.x - tan.dx * CAR_LEN * 0.38 + nx * CAR_HALF_W, y: p.y - tan.dy * CAR_LEN * 0.38 + ny * CAR_HALF_W };
            const r = { x: p.x - tan.dx * CAR_LEN * 0.38 - nx * CAR_HALF_W, y: p.y - tan.dy * CAR_LEN * 0.38 - ny * CAR_HALF_W };
            const annot = ringRadialOffsetPoint(p.angle, arc.k, 16);
            return (
              <g
                key={v.batchId}
                className={styles.car}
                data-testid={`transit-car-${v.batchId}`}
                data-glyph={TRANSIT_GLYPHS.interpolated.glyph}
                data-glyph-shape={TRANSIT_GLYPHS.interpolated.shape}
                data-state={v.state}
                data-progress={v.progress === null ? "" : v.progress.toFixed(4)}
                data-eta-day={v.arrivalDay}
                data-dispatch-day={v.dispatchDay ?? ""}
                data-segment-id={arc.segmentId}
                data-angle={p.angle.toFixed(6)}
                data-x={p.x.toFixed(2)}
                data-y={p.y.toFixed(2)}
              >
                <title>{`${v.label} · 发运第 ${v.dispatchDay ?? "—"} 天 · 到货第 ${v.arrivalDay} 天`}</title>
                <path
                  className={styles.carBody}
                  d={`M ${head.x.toFixed(2)} ${head.y.toFixed(2)} L ${l.x.toFixed(2)} ${l.y.toFixed(2)} L ${r.x.toFixed(2)} ${r.y.toFixed(2)} Z`}
                />
                {reduced ? (
                  <text
                    className={styles.carAnnot}
                    data-testid={`transit-car-annot-${v.batchId}`}
                    x={annot.x.toFixed(2)}
                    y={annot.y.toFixed(2)}
                    textAnchor="middle"
                  >
                    第 {day} 天 · 行程 {v.progress === null ? "不可算" : pct(v.progress)} · 到货第 {v.arrivalDay} 天
                  </text>
                ) : null}
              </g>
            );
          })}

          {/* ② 只有到货日的：菱形徽标**挂在站上**（沿半径朝环外）—— 几何上就落不进任何区间 */}
          {arrivalGlyphs.map(({ v, anchor, p }) => (
            <g
              key={v.batchId}
              className={styles.arrival}
              data-testid={`transit-arrival-${v.batchId}`}
              data-glyph={TRANSIT_GLYPHS["arrival-only"].glyph}
              data-glyph-shape={TRANSIT_GLYPHS["arrival-only"].shape}
              data-days-to-arrival={v.daysToArrival}
              data-state={v.state}
              data-progress=""
              data-segment-id=""
              data-station={v.destNodeId}
              data-angle={anchor.angle.toFixed(6)}
              data-x={p.x.toFixed(2)}
              data-y={p.y.toFixed(2)}
            >
              <title>{`${v.label} → ${labelOf(v.destNodeId)} · ${
                v.daysToArrival > 0 ? `还有 ${v.daysToArrival} 天到货` : `已到货 ${-v.daysToArrival} 天`
              } · 只有到货日、没有发运日 ⇒ 区间位置不可算，不画车`}</title>
              <path
                className={styles.arrivalBadge}
                d={`M ${p.x.toFixed(2)} ${(p.y - BADGE_R).toFixed(2)} L ${(p.x + BADGE_R).toFixed(2)} ${p.y.toFixed(2)} L ${p.x.toFixed(2)} ${(p.y + BADGE_R).toFixed(2)} L ${(p.x - BADGE_R).toFixed(2)} ${p.y.toFixed(2)} Z`}
              />
              <text className={styles.glyphText} x={p.x.toFixed(2)} y={(p.y + 3).toFixed(2)} textAnchor="middle">
                {v.daysToArrival > 0 ? v.daysToArrival : "✓"}
              </text>
            </g>
          ))}

          {/* ③ 只知在哪一站的：横条堆叠**挂在站上**（沿半径朝环内）—— 不画工序间行进过程 */}
          {residentGlyphs.map(({ v, anchor, p }) => (
            <g
              key={v.batchId}
              className={styles.resident}
              data-testid={`transit-resident-${v.batchId}`}
              data-glyph={TRANSIT_GLYPHS["station-resident"].glyph}
              data-glyph-shape={TRANSIT_GLYPHS["station-resident"].shape}
              data-state={v.state}
              data-progress=""
              data-segment-id=""
              data-station={v.destNodeId}
              data-angle={anchor.angle.toFixed(6)}
              data-x={p.x.toFixed(2)}
              data-y={p.y.toFixed(2)}
            >
              <title>{`${v.label} @ ${labelOf(v.destNodeId)} · ${v.qty}${v.unit}${
                v.state === "queued" ? ` · 已等 ${v.waitedDays} 天` : ""
              } · 无任何 eta ⇒ 只画站驻留`}</title>
              <rect
                className={styles.residentBar}
                x={(p.x - RESIDENT_HALF_W).toFixed(2)}
                y={(p.y - RESIDENT_H / 2).toFixed(2)}
                width={RESIDENT_HALF_W * 2}
                height={RESIDENT_H}
                rx={2}
              />
            </g>
          ))}
        </svg>

        {/* 图元图例：三类**形状**不同（不是同一形状换个深浅——那会被读成"同一种东西弱一点"） */}
        <div className={styles.glyphLegend} data-testid="transit-glyph-legend">
          {TRANSIT_SOURCE_SPECS.map((spec) => {
            const g = TRANSIT_GLYPHS[spec.mode];
            return (
              <span
                key={spec.key}
                className={styles.glyphChip}
                data-testid={`transit-glyph-legend-${spec.key}`}
                data-glyph={g.glyph}
                data-glyph-shape={g.shape}
              >
                <svg width="24" height="16" aria-hidden="true">
                  {g.shape === "triangle" ? <path className={styles.carBody} d="M 20 8 L 6 3 L 6 13 Z" /> : null}
                  {g.shape === "diamond" ? <path className={styles.arrivalBadge} d="M 12 2 L 19 8 L 12 14 L 5 8 Z" /> : null}
                  {g.shape === "bar-stack" ? (
                    <>
                      <rect className={styles.residentBar} x="3" y="3" width="18" height="3" rx="1" />
                      <rect className={styles.residentBar} x="3" y="8" width="18" height="3" rx="1" />
                    </>
                  ) : null}
                </svg>
                {spec.label} · {g.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* ── 排队堆积 ─────────────────────────────────────────────────────── */}
      <div className={styles.queues} data-testid="transit-queues" data-count={frame.queues.length}>
        {frame.queues.map((q) => (
          <div key={q.nodeId} className={styles.queue} data-testid={`transit-queue-${q.nodeId}`} data-size={q.batchIds.length} data-next-gate={q.nextGateDay ?? ""}>
            <b>{labelOf(q.nodeId)}</b> 堆积 {q.batchIds.length} 批 / {q.qty}
            {q.nextGateDay === null ? "（无节拍，随到随走）" : ` · 下次开闸第 ${q.nextGateDay} 天`}
          </div>
        ))}
      </div>

      {/* 只有到货日 / 只知在哪站的两类**已落到环上的站**（图元见上方 ②③），
          这里保留一条计数与判据说明 —— 图上看得见形状，屏上还要读得到"为什么只能画到这个程度"。 */}
      {arrivalVehicles.length + residentVehicles.length > 0 ? (
        <p
          className={styles.modeReason}
          data-testid="transit-off-ring-note"
          data-arrivals={arrivalVehicles.length}
          data-residents={residentVehicles.length}
        >
          站上图元 {arrivalVehicles.length + residentVehicles.length} 个（到站徽标 {arrivalVehicles.length} · 驻留堆叠{" "}
          {residentVehicles.length}）：这两类<b>区间位置算不出来</b>（前者没有发运日与起运地，后者没有任何 eta），
          所以它们的锚点<b>沿半径离开环</b>、几何上落不进任何区间 —— 不是画得淡一点，是根本不在路上。
        </p>
      ) : null}

      {/* ── 采购支线：**每次渲染现判**（此前是一个无条件渲染的 <div> + 写死取证）────────
          有齐全日戳 ⇒ 缺席块消失、实况块上屏；取不到 ⇒ 照样缺席，但病因分档说清。 */}
      {procurementBranch.status === "EMPTY" ? (
        <div
          className={styles.absence}
          data-testid="transit-branch-procurement"
          data-status={procurementBranch.status}
          data-cause={procurementBranch.cause}
          data-fetched={procurementBranch.probe.fetched === null ? "" : procurementBranch.probe.fetched}
          data-usable={procurementBranch.probe.usable}
          data-loading={procurementLoading ? "1" : "0"}
        >
          <b className={styles.absenceTitle}>{procurementBranch.label} · EMPTY</b>
          {procurementLoading ? (
            <p className={styles.emptyReason} data-testid="transit-procurement-fetching">
              正在取{" "}
              <code className={styles.objType}>
                GET /a/v1/objects?type=PurchaseOrder|CustomsClearance|IncomingInspection
              </code>{" "}
              —— 还没回来，此刻不下任何结论。
            </p>
          ) : (
            <p className={styles.emptyReason}>{procurementBranch.reason}</p>
          )}
          {procurementFetchError !== null ? (
            <p className={styles.emptyReason} data-testid="transit-procurement-fetch-error">
              取数失败：{procurementFetchError} —— 判为**没拿到**（不是"本租户没有"），不画。
            </p>
          ) : null}
          <ul className={styles.reasonList}>
            {procurementBranch.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <p className={styles.unblock}>补齐路径：{procurementBranch.unblockedBy}</p>
        </div>
      ) : (
        <div
          className={styles.absence}
          data-testid="transit-branch-procurement-live"
          data-status={procurementBranch.status}
          data-cause={procurementBranch.cause}
          data-fetched={procurementBranch.probe.fetched ?? ""}
          data-usable={procurementBranch.probe.usable}
        >
          <b className={styles.absenceTitle}>{procurementBranch.label} · PRESENT</b>
          <p className={styles.emptyReason}>{procurementBranch.reason}</p>
          <ul className={styles.reasonList}>
            {procurementBranch.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          {/* 诚实边界：日戳齐全 ≠ 已经画成车。四段腿今天只判定到"算得出来"，
              接成第四条 `TRANSIT_SOURCE_SPECS` 真画车是另一单（会动几何遍历面）。 */}
          <p className={styles.unblock} data-testid="transit-branch-procurement-scope">
            仅判定到「区间位置算得出来」：本层的 <b>三条画车支线</b>（
            {TRANSIT_SOURCE_SPECS.map((s) => s.objectType).join(" / ")}）里还没有采购段，
            所以<b>屏上不会出现采购段的车</b> —— 说"能画"却不画，与说"没有"一样是骗人，故在此写明。
          </p>
        </div>
      )}

      {/* ── 事件流 ───────────────────────────────────────────────────────── */}
      <ol className={styles.events} data-testid="transit-events" data-count={frame.events.length}>
        {feed.map((e, i) => (
          <li key={`${e.day}-${e.kind}-${e.nodeId}-${e.batchIds.join(",")}`} className={styles.event} data-testid={`transit-event-${i}`} data-kind={e.kind} data-day={e.day} data-size={e.batchIds.length}>
            <span className={styles.eventDay}>D{e.day}</span>
            <span className={styles.eventKind} data-kind={e.kind}>
              {e.kind === "dispatch" ? "发运" : e.kind === "arrive" ? "到站" : "放行"}
            </span>
            <span className={styles.eventText}>
              {labelOf(e.nodeId)} · {e.text}
            </span>
          </li>
        ))}
        {frame.events.length === 0 ? (
          <li className={styles.event} data-testid="transit-events-empty">
            暂无事件（没有可驱动的在途批次 —— 见上方各支线的空态原因）
          </li>
        ) : null}
      </ol>
    </section>
  );
}

/**
 * 宿主视图（`registry.ts` 以键 `transit-flow` 登记的**就是它** —— 本层唯一的生产调用方）。
 *
 * 职责只有两件，多一件都不干：
 *  ① 把 `ViewRendererProps.view.options` 里的**播控初值**收进来（`initialDay` / `initialSpeed`），
 *     且只认在册倍速档（`TRANSIT_SPEEDS`）——不在前端编一个自由值。
 *  ② 把「独立视图形态下站点从哪来」当面说清楚（见下）。
 *
 * ── 宿主**不做**的事（这三条正是本单不许踩的坑）────────────────────────────────
 *  · **不造 `nodes`**：链路节点清单只能由引擎下发；独立视图形态下没有下发方 ⇒ 传 `undefined`，
 *    让图层退回"从批次数据行自身字段现场发现站点"。**前端零清单**这条红线在宿主这里也守。
 *    ⚠ WO-TRANSIT-WIRE 修正：宿主不传 `nodes` **不再等于"节拍一律缺席"** ——
 *    图层自己会去对象库读 `Cadence` 行（同为引擎侧承载，`synthetic/service.ts:712` 落库），
 *    读得回来照样点亮闸门。此前宿主这段注释写的"节拍一律缺席"是把**当时的缺口**当成了设计。
 *  · **不造 `sources`**：不传 ⇒ 图层走自取真值（批次三类 `InterBaseTransfer|Shipment|WIPLot`
 *    ＋ 判据四类 `Cadence|PurchaseOrder|CustomsClearance|IncomingInspection`，均为在册对象类型
 *    —— 见 `apps/datacore/src/synthetic/data-categories.ts:41`(WIPLot) 与 `:64`(Shipment/InterBaseTransfer)）。
 *    **绝不喂一份 fixture 让页面看起来有货**：那会造出比空页面更坏的东西 —— 打得开、内容却是编的。
 *  · **不冒充 LIVE**：某条支线取不到真值，图层原样显示「空 + 一行原因」，宿主不兜底、不吞。
 */
/**
 * WO-SANDBOX-CONSOLE 追加的**可选** prop（默认 = 今天的行为，独立页 `/v/transit-flow` 零回归）：
 * `chrome="embedded"` —— 作为线路图模式下的**图层**挂进控制台画布槽时，把宿主那两句长说明收成一行。
 * 说明**不删**（"批次由本层自取 / 宿主不下发站点" 是诚实位），只是压缩措辞。
 */
export function TransitFlowView({ view, chrome = "full" }: Partial<ViewRendererProps> & { chrome?: "full" | "embedded" }) {
  const opts = view?.options as { initialDay?: unknown; initialSpeed?: unknown } | undefined;

  const rawDay = opts?.initialDay;
  const initialDay = typeof rawDay === "number" && Number.isFinite(rawDay) && rawDay >= 0 ? Math.floor(rawDay) : 0;

  const rawSpeed = opts?.initialSpeed;
  const initialSpeed: TransitSpeed = typeof rawSpeed === "number" ? (TRANSIT_SPEEDS.find((s) => s === rawSpeed) ?? 1) : 1;

  return (
    <div className={styles.hostRoot} data-testid="transit-flow-root" data-chrome={chrome}>
      <header className={styles.hostBar}>
        <b className={styles.hostTitle}>在途 / 在制</b>
        <small className={styles.hostNote} data-testid="transit-flow-host-source">
          {chrome === "embedded" ? (
            <>
              批次自取 <code className={styles.objType}>/a/v1/objects?type=InterBaseTransfer|Shipment|WIPLot</code>；
              判据自取 <code className={styles.objType}>Cadence|PurchaseOrder|CustomsClearance|IncomingInspection</code>
              （取不到显示空态 + 原因，<b>不补示意数据</b>）
            </>
          ) : (
            <>
              批次数据由本层自取 <code className={styles.objType}>GET /a/v1/objects?type=InterBaseTransfer|Shipment|WIPLot</code>
              ；节拍与采购段判据同样由本层自取{" "}
              <code className={styles.objType}>Cadence|PurchaseOrder|CustomsClearance|IncomingInspection</code>
              （七个在册对象类型 · 取不到就显示空态并给原因，<b>不补示意数据</b>）
            </>
          )}
        </small>
        <small className={styles.hostNote} data-testid="transit-flow-host-nodes">
          {chrome === "embedded" ? (
            <>
              <b>宿主不下发站点</b>（<code className={styles.objType}>nodes</code> 缺席）⇒ 站点现场发现；
              <b>节拍改由图层自取对象库 </b>
              <code className={styles.objType}>Cadence</code> 行（同为引擎侧，取到即点亮闸门、取不到按病因分档说明）；
              几何已<b>与线路图同源</b>（<code className={styles.objType}>chainLineMap.ts</code> 的环 / 弧 / 弧长参数），
              但两图<b>站点 key 宇宙不同</b>（链路节点 vs 基地·工序）⇒ <b>同角度不代表同一个实体</b>
            </>
          ) : (
            <>
              独立视图形态下<b>宿主不下发站点</b>（<code className={styles.objType}>nodes</code> 缺席）⇒
              站点从批次数据行自身字段现场发现；<b>但节拍不再"一律缺席"</b> ——
              图层自取对象库 <code className={styles.objType}>Cadence</code> 行（
              <code className={styles.objType}>synthetic/service.ts:712</code> 落库的那批，同为引擎侧承载），
              取到即点亮闸门、取不到按病因分档说清是「没去取 / 读不成 / 本租户真没有」；几何取自线路图单源{" "}
              <code className={styles.objType}>chainLineMap.ts</code>（同一个环、同一条均分规则、同一个弧生成器），
              <b>但两图站点 key 今天没有共同的 id 维度</b>，同角度不代表同一个实体
            </>
          )}
        </small>
      </header>
      <TransitFlowLayer initialDay={initialDay} initialSpeed={initialSpeed} />
    </div>
  );
}

export default TransitFlowView;
