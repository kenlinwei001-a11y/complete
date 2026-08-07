import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchObjects } from "@/api/endpoints";
import type { ViewRendererProps } from "../registry";
import {
  CADENCE_ABSENCE,
  PROCUREMENT_BRANCH,
  TRANSIT_SOURCE_SPECS,
  cadenceExpectedWaitDays,
  meanReleaseWaitDays,
  parseInterBaseTransferRows,
  parseShipmentRows,
  parseWipLotRows,
  resolveSegments,
  resolveStations,
  simulateTransit,
  transitHorizonDays,
  type TransitBatch,
  type TransitNodeInput,
  type TransitParseResult,
  type TransitRawRow,
  type TransitSourceKey,
  type TransitSourceSpec,
  type TransitStation,
  type TransitVehicle,
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
 *    `WIPLot` 只知道在哪台工序 → 站上驻留。采购支线**画不出来** → 显示为空并逐条给出取证。
 *    任何一条支线取不到真值，就是「空 + 一行原因」，绝不给一个看起来合理的假动画。
 * ② **前端零清单**：站点/区间只能来自引擎下发的 `nodes[]` 或批次数据行自带的字段值；
 *    `nodeId` 当不透明 key 用，不 split、不看前缀。**「哪个站是限流站」只认引擎下发的 `node.cadence`**。
 *    今天引擎发不出节拍（`Cadence` 全仓无承载物），所以界面上**不画任何"这里有节拍"的假象**。
 * ③ **定时器纪律**：本组件全是定时器。每个句柄 ref **覆盖前先清**、卸载再清一遍。
 *    本仓刚修过 4 处「ref 只存得下最后一个 handle → 前一个成孤儿 → 整包随机红」。
 *
 * ── `prefers-reduced-motion` ───────────────────────────────────────────────────
 * 开启时：不跑动画（CSS 过渡关、rAF 脉冲不排）、**自动播放停用**，改为**静态标注**
 * （每辆车直接把「第 N 天 · 行程 xx%」写在旁边），仍可用步进逐日查看。
 */

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
}

export interface TransitFlowLayerProps {
  /**
   * 引擎下发的站点（F1 线路图挂载时由它传入）。
   * **不传 = 引擎没给**：站点退回"从批次数据行自身字段现场发现"，且节拍一律缺席。
   * 前端在任何情况下都不自造节点清单。
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

  const batches = useMemo<TransitBatch[]>(() => branches.flatMap((b) => b.parsed.batches), [branches]);
  const stations = useMemo<TransitStation[]>(() => resolveStations(nodes, batches), [nodes, batches]);
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

  const vehiclesBySegment = useMemo(() => {
    const m = new Map<string, TransitVehicle[]>();
    for (const v of frame.vehicles) {
      if (v.segmentId === null || v.mode !== "interpolated") continue;
      const list = m.get(v.segmentId);
      if (list === undefined) m.set(v.segmentId, [v]);
      else list.push(v);
    }
    return m;
  }, [frame]);

  const arrivalVehicles = useMemo(() => frame.vehicles.filter((v) => v.mode === "arrival-only"), [frame]);
  const residentVehicles = useMemo(() => frame.vehicles.filter((v) => v.mode === "station-resident"), [frame]);
  const feed = useMemo(() => [...frame.events].reverse().slice(0, EVENT_FEED_LIMIT), [frame]);

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

      {/* ── 节拍（限流站）：只认引擎下发的 node.cadence ────────────────────── */}
      {cadenceStations.length === 0 ? (
        <div className={styles.absence} data-testid="transit-cadence-absence" data-status={CADENCE_ABSENCE.status}>
          <b className={styles.absenceTitle}>节拍闸门 · EMPTY</b>
          <p className={styles.emptyReason}>{CADENCE_ABSENCE.reason}</p>
          <ul className={styles.reasonList}>
            {CADENCE_ABSENCE.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <p className={styles.unblock}>补齐路径：{CADENCE_ABSENCE.unblockedBy}（本层机制已具备，接线后不改代码即点亮）</p>
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

      {/* ── 区间（可算位置的才画车）───────────────────────────────────────── */}
      <div className={styles.segments} data-testid="transit-segments" data-count={segments.length}>
        {segments.length === 0 ? (
          <p className={styles.emptyReason} data-testid="transit-segments-empty">
            无可算位置的区间 —— 没有任何一条在途批次同时具备发运日与到货日，因此不画区间，也不画车。
          </p>
        ) : (
          segments.map((seg) => {
            const cars = vehiclesBySegment.get(seg.segmentId) ?? [];
            return (
              <div key={seg.segmentId} className={styles.segment} data-testid={`transit-segment-${seg.segmentId}`}>
                <div className={styles.segEnds}>
                  <span
                    className={styles.station}
                    data-testid={`transit-station-${seg.fromNodeId}`}
                    data-label-source={stationById.get(seg.fromNodeId)?.labelSource ?? "raw-id"}
                  >
                    {labelOf(seg.fromNodeId)}
                  </span>
                  <span className={styles.segArrow} aria-hidden="true">
                    ───────
                  </span>
                  <span
                    className={styles.station}
                    data-testid={`transit-station-${seg.toNodeId}`}
                    data-label-source={stationById.get(seg.toNodeId)?.labelSource ?? "raw-id"}
                    data-cadence={stationById.get(seg.toNodeId)?.cadence === undefined ? "0" : "1"}
                    data-pulse={pulseNodeId === seg.toNodeId ? "1" : "0"}
                  >
                    {labelOf(seg.toNodeId)}
                  </span>
                </div>
                <div className={styles.track}>
                  {cars.map((v) => (
                    <span
                      key={v.batchId}
                      className={styles.car}
                      data-testid={`transit-car-${v.batchId}`}
                      data-state={v.state}
                      data-progress={v.progress === null ? "" : v.progress.toFixed(4)}
                      data-eta-day={v.arrivalDay}
                      data-dispatch-day={v.dispatchDay ?? ""}
                      style={{ left: `${(v.progress ?? 0) * 100}%` }}
                      title={`${v.label} · 发运第 ${v.dispatchDay ?? "—"} 天 · 到货第 ${v.arrivalDay} 天`}
                    >
                      <i className={styles.carDot} aria-hidden="true" />
                      {reduced ? (
                        <em className={styles.carAnnot} data-testid={`transit-car-annot-${v.batchId}`}>
                          第 {day} 天 · 行程 {v.progress === null ? "不可算" : pct(v.progress)} · 到货第 {v.arrivalDay} 天
                        </em>
                      ) : null}
                    </span>
                  ))}
                </div>
              </div>
            );
          })
        )}
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

      {/* ── 只有到货日的（不画车，只给倒计时）─────────────────────────────── */}
      {arrivalVehicles.length > 0 ? (
        <div className={styles.arrivals} data-testid="transit-arrivals" data-count={arrivalVehicles.length}>
          <p className={styles.modeReason}>以下批次**只有到货日、没有发运日** ⇒ 区间位置不可算，只给到站倒计时，不画车：</p>
          {arrivalVehicles.map((v) => (
            <span
              key={v.batchId}
              className={styles.arrival}
              data-testid={`transit-arrival-${v.batchId}`}
              data-days-to-arrival={v.daysToArrival}
              data-state={v.state}
              data-progress=""
            >
              {v.label} → {labelOf(v.destNodeId)} · {v.daysToArrival > 0 ? `还有 ${v.daysToArrival} 天到货` : `已到货 ${-v.daysToArrival} 天`}
            </span>
          ))}
        </div>
      ) : null}

      {/* ── 站驻留的在制批次 ──────────────────────────────────────────────── */}
      {residentVehicles.length > 0 ? (
        <div className={styles.residents} data-testid="transit-residents" data-count={residentVehicles.length}>
          {residentVehicles.map((v) => (
            <span key={v.batchId} className={styles.resident} data-testid={`transit-resident-${v.batchId}`} data-state={v.state} data-node={v.destNodeId}>
              {v.label} @ {labelOf(v.destNodeId)} · {v.qty}
              {v.unit}
              {v.state === "queued" ? ` · 已等 ${v.waitedDays} 天` : ""}
            </span>
          ))}
        </div>
      ) : null}

      {/* ── 采购支线：D2 交付前一律为空（本单核心诚实判据）──────────────────── */}
      <div className={styles.absence} data-testid="transit-branch-procurement" data-status={PROCUREMENT_BRANCH.status}>
        <b className={styles.absenceTitle}>{PROCUREMENT_BRANCH.label} · EMPTY</b>
        <p className={styles.emptyReason}>{PROCUREMENT_BRANCH.reason}</p>
        <ul className={styles.reasonList}>
          {PROCUREMENT_BRANCH.evidence.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <p className={styles.unblock}>补齐路径：{PROCUREMENT_BRANCH.unblockedBy}</p>
      </div>

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
 *  · **不造 `nodes`**：站点（及"哪个站是限流站"的唯一判据 `node.cadence`）只能由引擎下发；
 *    独立视图形态下引擎不下发 ⇒ 传 `undefined`，让图层退回"从批次数据行自身字段现场发现站点"，
 *    并由图层的 `transit-cadence-absence` 块逐条给出节拍缺席的取证。**前端零清单**这条红线在宿主这里也守。
 *  · **不造 `sources`**：不传 ⇒ 图层走自取真值（`GET /a/v1/objects?type=InterBaseTransfer|Shipment|WIPLot`，
 *    三者均为在册对象类型 —— 见 `apps/datacore/src/synthetic/data-categories.ts:41`(WIPLot)
 *    与 `:64`(Shipment/InterBaseTransfer)）。**绝不喂一份 fixture 让页面看起来有货**：
 *    那会造出比空页面更坏的东西 —— 打得开、内容却是编的。
 *  · **不冒充 LIVE**：某条支线取不到真值，图层原样显示「空 + 一行原因」，宿主不兜底、不吞。
 */
/**
 * WO-SANDBOX-CONSOLE 追加的**可选** prop（默认 = 今天的行为，独立页 `/v/transit-flow` 零回归）：
 * `chrome="embedded"` —— 作为线路图模式下的**图层**挂进控制台画布槽时，把宿主那两句长说明收成一行。
 * 说明**不删**（"批次由本层自取 / 引擎未下发站点" 是诚实位），只是压缩措辞。
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
              批次自取 <code className={styles.objType}>/a/v1/objects?type=InterBaseTransfer|Shipment|WIPLot</code>
              （取不到显示空态 + 原因，<b>不补示意数据</b>）
            </>
          ) : (
            <>
              批次数据由本层自取 <code className={styles.objType}>GET /a/v1/objects?type=InterBaseTransfer|Shipment|WIPLot</code>
              （三个在册对象类型 · 取不到就显示空态并给原因，<b>不补示意数据</b>）
            </>
          )}
        </small>
        <small className={styles.hostNote} data-testid="transit-flow-host-nodes">
          {chrome === "embedded" ? (
            <>
              <b>引擎未下发站点</b>（<code className={styles.objType}>nodes</code> 缺席）⇒ 站点现场发现、节拍缺席；
              本图层<b>未与线路图站点坐标对齐</b>（对齐要改图层几何，不在本单边界）
            </>
          ) : (
            <>
              独立视图形态下<b>引擎未下发站点</b>（<code className={styles.objType}>nodes</code> 缺席）⇒
              站点从批次数据行自身字段现场发现、节拍一律缺席；挂到全链线路图作图层时由线路图传入引擎站点
            </>
          )}
        </small>
      </header>
      <TransitFlowLayer initialDay={initialDay} initialSpeed={initialSpeed} />
    </div>
  );
}

export default TransitFlowView;
