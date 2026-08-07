import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ViewRendererProps } from "../registry";
import { aggregateObjects, searchObjects } from "@/api/endpoints";
import { tokenStore } from "@/api/tokenStore";
import {
  buildTopology,
  clampZoom,
  fitTransform,
  heatAlpha,
  HEAT_BAND_LABEL,
  HEAT_THRESHOLDS,
  IDENTITY_TRANSFORM,
  PLACEHOLDER_SEED_DEFAULT,
  PROCESS_CHAIN_SOURCE,
  PROVENANCE_BADGE,
  PROVENANCE_LABEL,
  REAL_DATA_ENTRYPOINTS,
  TOPOLOGY_FACT_QUERIES,
  zoomAt,
  zoomCenter,
  ZOOM_STEP,
  type AggRow,
  type HeatBand,
  type Measure,
  type TopologyCell,
  type TopologyFacts,
  type ViewTransform,
} from "./physicalTopology";
import styles from "./PhysicalTopologyView.module.css";

/**
 * WO-SANDBOX-F3 · 物理拓扑视图（基地 × 产线 × 工序）。
 *
 * 13 基地（`BASE_REGISTRY` 派生）× 10 工序（datacore 合成种子 `WORKSHOP_DEFS` 镜像）的热力流水矩阵，
 * 悬停任一格出该工序详情。派生细节与"哪些数是真的"见 `physicalTopology.ts` 顶注。
 *
 * 诚实红线（本视图的存在意义之一）：
 *  · 格内每条度量**逐条标来源**：`真值·对象聚合` / `占位·未接真值` / `EMPTY·无数据源`。
 *    页面顶部常驻横幅 + 每格角标 + 详情面板逐项标注，占位绝不冒充实测；算不出来标 `EMPTY`，不补 0。
 *  · 真值格的详情面板同时给出 **`basis` 算式**（Σ/Σ 加权、max 取最慢工位…）—— 口径不许藏在代码里。
 *  · 基地级 利用率/产能/产线数/瓶颈 是 `BASE_REGISTRY` 真值，标 `真值·基地册`，与格内分开呈现。
 *  · 瓶颈设备型定位不到工序列（如「老化库」不在十车间链上）→ 明说定位不到，不挑一列点亮。
 *
 * WO-TOPO-REALDATA 接线：四条格内度量改读 DataCore 对象聚合（口径全在 `physicalTopology.ts` §5.5，
 * 本文件只做传输与呈现，**一行口径都不许写在这里**）。取不到（未登录 / 请求失败 / 后端无该对象）
 * → `buildTopology(seed, null)` 回到接线前的占位行为，并把原因写进每条度量的 `reason`。
 *
 * 交互：滚轮以光标为锚缩放 · 拖拽平移 · 适应画布；快捷键 `+` / `-` / `0`（画布获焦后生效）。
 * 主题：零硬编码颜色，全部走 `styles/tokens.css` 的 CSS 变量 → dark / light / warm 三套自动跟随。
 */

/** 提示条自动消隐时长（ms）。 */
const HINT_MS = 1600;
/** 矩阵几何（CSS 像素，供 grid 模板与 fit 计算共用）。 */
const ROW_HEAD_W = 168;
const CELL_W = 92;
/** 车间册一次取满（实测 130 行；`pageSize` 上限 500，够用且留余量）。 */
const WORKSHOP_PAGE_SIZE = "500";

function fmt(m: Measure): string {
  if (m.value === null) return "EMPTY";
  return `${m.value}${m.unit ? ` ${m.unit}` : ""}`;
}

/**
 * 真值载荷拉取：**四个只读请求并发**，请求体全部引自 `TOPOLOGY_FACT_QUERIES`（口径单源）。
 * 本函数只负责搬运，不做任何合并/换算 —— 合并口径在 `buildCellFacts`，一处。
 */
export async function fetchTopologyFacts(): Promise<TopologyFacts> {
  const [oee, equipment, wip, workshops] = await Promise.all([
    aggregateObjects(TOPOLOGY_FACT_QUERIES.oee as unknown as Parameters<typeof aggregateObjects>[0]),
    aggregateObjects(TOPOLOGY_FACT_QUERIES.equipment as unknown as Parameters<typeof aggregateObjects>[0]),
    aggregateObjects(TOPOLOGY_FACT_QUERIES.wip as unknown as Parameters<typeof aggregateObjects>[0]),
    searchObjects("Workshop", "", { pageSize: WORKSHOP_PAGE_SIZE }),
  ]);
  return {
    oee: oee.rows as AggRow[],
    equipment: equipment.rows as AggRow[],
    wip: wip.rows as AggRow[],
    workshops: workshops.items.map((i) => i.props),
  };
}

/** 一条度量的诚实呈现：值 + 来源标签 + 口径算式（占位/EMPTY 一眼可辨）。 */
function MeasureLine({ label, m, testId }: { label: string; m: Measure; testId: string }) {
  return (
    <div className={styles.measureLine} data-testid={testId} data-provenance={m.provenance}>
      <span className={styles.measureLabel}>{label}</span>
      <b className={m.value === null ? styles.measureEmpty : styles.measureValue}>{fmt(m)}</b>
      <em className={styles.provTag} data-prov-tag={m.provenance}>
        {PROVENANCE_LABEL[m.provenance]}
      </em>
      {m.basis ? (
        <small className={styles.basis} data-testid={`${testId}-basis`}>
          口径：{m.basis}
        </small>
      ) : null}
      {m.reason ? <small className={styles.reason}>{m.reason}</small> : null}
    </div>
  );
}

// ⚠ 审核方并线修：原签名 `{ seed?: number }` **不符合 renderer 契约** `ViewRendererProps`
//    （= `{ view: ViewConfigVM }`），registry 注册时 TS2322 直接打红构建。
//    vitest 不做类型检查，所以 29 例组件测试全绿、构建却是红的——「绿测试 ≠ 能用」的教科书形态。
//    今天本组件尚未消费 `view`（渲染的是占位数据），故声明为 Partial 并显式忽略；
//    接真值时（W4·G1）从 `view` 取 scope/viewKey 即可，届时改为必填。
/**
 * WO-SANDBOX-CONSOLE 追加的**可选** prop（默认值 = 今天的行为，独立页 `/v/physical-topology` 零回归）：
 *  · `chrome="embedded"` —— 嵌进沙盘控制台的画布槽时，标题块（h3 + 一段来源说明）折进
 *    一行紧凑说明，缩放条原样保留。**占位数据横幅与图例一个字都不动** —— 诚实标记不许在重组时弄丢。
 */
export type PhysicalTopologyChrome = "full" | "embedded";

export function PhysicalTopologyView({
  seed = PLACEHOLDER_SEED_DEFAULT,
  chrome = "full",
}: Partial<ViewRendererProps> & { seed?: number; chrome?: PhysicalTopologyChrome }) {
  /**
   * 有会话才去读租户数据（对象读取一律 tenant-scoped，无 token 必 401）。
   * `useSyncExternalStore` 而不是读一次快照：登录后要**自动**补拉，不能让用户手动刷新。
   */
  const hasToken = useSyncExternalStore(
    tokenStore.subscribe,
    () => tokenStore.get() !== null,
    () => false,
  );
  const factsQ = useQuery({
    queryKey: ["a", "physical-topology-facts"],
    queryFn: fetchTopologyFacts,
    enabled: hasToken,
    // retry 会排退避定时器；本视图失败即回落占位（有诚实文案），不值得为它留孤儿句柄。
    retry: false,
    staleTime: 60_000,
  });
  const matrix = useMemo(() => buildTopology(seed, factsQ.data ?? null), [seed, factsQ.data]);
  const [t, setT] = useState<ViewTransform>(IDENTITY_TRANSFORM);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  /**
   * 定时器纪律（本仓刚修过 4 处「覆盖 ref 漏清 → 孤儿定时器 → 整包随机红」）：
   * 这个 ref 只存得下一个 handle，**覆盖前必须先 clear**；卸载时也清（见下方 useEffect）。
   */
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHintTimer = useCallback(() => {
    if (hintTimerRef.current !== null) {
      clearTimeout(hintTimerRef.current);
      hintTimerRef.current = null;
    }
  }, []);

  const flashHint = useCallback(
    (text: string) => {
      clearHintTimer(); // ← 覆盖 ref 前先清，绝不让上一个 handle 变孤儿
      setHint(text);
      hintTimerRef.current = setTimeout(() => {
        hintTimerRef.current = null;
        setHint(null);
      }, HINT_MS);
    },
    [clearHintTimer],
  );

  useEffect(() => clearHintTimer, [clearHintTimer]); // 卸载清

  const contentSize = useCallback(() => {
    const stage = stageRef.current;
    return {
      w: stage?.offsetWidth ?? 0,
      h: stage?.offsetHeight ?? 0,
    };
  }, []);

  const viewportSize = useCallback(() => {
    const el = canvasRef.current;
    return { w: el?.clientWidth ?? 0, h: el?.clientHeight ?? 0 };
  }, []);

  const doZoom = useCallback(
    (factor: number) => {
      const vp = viewportSize();
      setT((s) => zoomCenter(s, factor, vp.w, vp.h));
    },
    [viewportSize],
  );

  const doFit = useCallback(() => {
    const vp = viewportSize();
    const ct = contentSize();
    const { transform, measured } = fitTransform(vp.w, vp.h, ct.w, ct.h);
    setT(transform);
    // 量不到就说量不到（jsdom / 未布局 / display:none）——不假装"已适应"。
    flashHint(measured ? "已适应画布" : "画布尺寸不可测 → 已复位为 1.00×");
  }, [contentSize, flashHint, viewportSize]);

  // 滚轮以光标为锚缩放：必须 non-passive 才能 preventDefault，故手绑而非 onWheel。
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return; // 未布局：不做无意义的变换
      e.preventDefault();
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setT((s) => zoomAt(s, e.clientX - rect.left, e.clientY - rect.top, factor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: t.x, oy: t.y };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setT((s) => ({ ...s, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
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

  const cellByKey = useMemo(() => {
    const m = new Map<string, TopologyCell>();
    for (const r of matrix.rows) for (const c of r.cells) m.set(c.key, c);
    return m;
  }, [matrix]);

  const hovered = hoverKey ? (cellByKey.get(hoverKey) ?? null) : null;
  const hoveredRow = hovered ? matrix.rows.find((r) => r.base.baseId === hovered.baseId) ?? null : null;
  const gridTemplate = `${ROW_HEAD_W}px repeat(${matrix.processes.length}, ${CELL_W}px)`;
  const { stats } = matrix;
  const diag = matrix.factsDiagnostics;

  return (
    <div className={styles.root} data-testid="phys-topo" data-chrome={chrome}>
      <header className={styles.head}>
        <div>
          {chrome === "full" ? <h3>物理拓扑 · 基地 × 产线 × 工序</h3> : null}
          <p className={styles.sub}>
            {stats.baseCount} 个基地 × {stats.processCount} 道工序 = {stats.cellCount} 格热力流水图。
            基地轴派生自 <code>BASE_REGISTRY</code>（跨端单一来源），工序轴镜像自{" "}
            <code>{PROCESS_CHAIN_SOURCE.file}</code> 的 <code>{PROCESS_CHAIN_SOURCE.symbol}</code>。
          </p>
        </div>
        <div className={styles.zoomBar}>
          <button className="btn sm" type="button" aria-label="放大" data-testid="phys-topo-zoom-in" onClick={() => doZoom(ZOOM_STEP)}>
            ＋
          </button>
          <button className="btn sm" type="button" aria-label="缩小" data-testid="phys-topo-zoom-out" onClick={() => doZoom(1 / ZOOM_STEP)}>
            －
          </button>
          <button className="btn sm" type="button" aria-label="适应画布" data-testid="phys-topo-fit" onClick={doFit}>
            ⤢
          </button>
          <span className={styles.zoomVal} data-testid="phys-topo-zoom-readout">
            {t.k.toFixed(2)}×
          </span>
        </div>
      </header>

      {/* ── 数据来源横幅：常驻、不可折叠。真值与占位值逐格分层，占位绝不冒充实测。 ─────
          ⚠ testid `phys-topo-placeholder-banner` 与正文里的「占位值」三字是**跨视图契约**：
             沙盘控制台的 SEAM 门（test/sandbox-console.seam.test.tsx:360）靠它证明"重组时诚实位没丢"。
             改名或让这句话在某个分支下消失 = 那道门失守。故第一段的口径说明**恒定出现**，不随数据变。 */}
      <section className={styles.placeholderBanner} data-testid="phys-topo-placeholder-banner" role="note">
        <b className={styles.bannerTitle} data-testid="phys-topo-banner-title">
          {stats.realMeasures > 0
            ? `⚑ 格内 ${stats.realCells}/${stats.cellCount} 格已接真值；其余仍为占位值（未接真实数据）`
            : "⚠ 格内数值为占位值（未接真实数据）"}
        </b>
        <p data-testid="phys-topo-banner-legend">
          逐格标注来源，三档不许混同：<b>真值·对象聚合</b>（DataCore <code>EquipmentOEE</code> /{" "}
          <code>Equipment</code> / <code>WIPLot</code> 服务端聚合，详情面板附算式）·<b>占位值</b>
          （<code>seed={matrix.seed}</code> 确定性派生，<b>不是实测</b>）·<code>EMPTY</code>（算不出来就标空，
          <b>不补 0</b>）。仅基地行首的 利用率 / 产能 / 产线数 / 瓶颈 是 <code>BASE_REGISTRY</code> 真值。
        </p>
        <p data-testid="phys-topo-banner-stats">
          当前：真值度量 {stats.realMeasures} 项 · 占位度量 {stats.placeholderMeasures} 项 · EMPTY 度量{" "}
          {stats.emptyMeasures} 项 · 瓶颈定位不到列 {stats.unlocatedBottlenecks} 个基地。
          {factsQ.isError ? (
            <span className={styles.entryGap} data-testid="phys-topo-facts-error">
              {" "}真值读取失败（{(factsQ.error as Error).message}）→ 全格回落占位，不拿旧值/假值顶替。
            </span>
          ) : null}
          {!hasToken ? (
            <span className={styles.entryGap} data-testid="phys-topo-facts-anonymous">
              {" "}未登录 → 不读租户对象，全格回落占位。
            </span>
          ) : null}
          {factsQ.isLoading ? <span data-testid="phys-topo-facts-loading"> 真值加载中…（先显示占位，到货后整体替换）</span> : null}
          {diag ? (
            <span data-testid="phys-topo-facts-diagnostics">
              {" "}接线诊断：命中 {diag.cellsWithFacts} 格 · 车间册映射不到列 {diag.unmappedWorkshops} 行 · 孤儿事实行（
              OEE {diag.orphanRows.oee} / 设备 {diag.orphanRows.equipment} / 在制 {diag.orphanRows.wip}）已丢弃**不摊到任何一格** ·
              OEE 因计划工时不等权判 EMPTY {diag.oeeUnweighted} 格。
            </span>
          ) : null}
        </p>
        <details className={styles.entrypoints} data-testid="phys-topo-entrypoints">
          <summary>真值接线台账（哪几条通了 / 哪几条仍是缺口）</summary>
          <ul>
            {REAL_DATA_ENTRYPOINTS.map((ep) => (
              <li key={`${ep.field}-${ep.source}`} data-testid={`phys-topo-entry-${ep.source}`} data-status={ep.status}>
                <code>{ep.field}</code> ← <b>{ep.source}</b>
                <span className={styles.entryStatus} data-status={ep.status}>
                  {ep.status === "connected" ? "已接线" : "仍是缺口"}
                </span>
                <div className={styles.entryShape}>今日产出：{ep.shapeToday}</div>
                <div className={styles.entryGap}>{ep.status === "connected" ? "口径：" : "缺口："}{ep.gap}</div>
              </li>
            ))}
          </ul>
        </details>
      </section>

      {/* ── 图例 ────────────────────────────────────────────────────────────────── */}
      <div className={styles.legend} data-testid="phys-topo-legend">
        <span className={styles.legendGroup}>
          热力（计划工时利用率）：
          {(["idle", "normal", "tight", "over", "empty"] as HeatBand[]).map((b) => (
            <i key={b} className={styles.legendChip} data-band={b} data-testid={`phys-topo-legend-${b}`}>
              <u className={styles.legendSwatch} data-band={b} />
              {HEAT_BAND_LABEL[b]}
            </i>
          ))}
        </span>
        <span className={styles.legendGroup}>
          来源：
          {(["registry", "aggregate", "placeholder", "empty"] as const).map((p) => (
            <i key={p} className={styles.legendChip} data-prov-tag={p} data-testid={`phys-topo-legend-prov-${p}`}>
              {PROVENANCE_LABEL[p]}
            </i>
          ))}
        </span>
        <span className={styles.legendGroup}>阈值：偏紧 ≥{HEAT_THRESHOLDS.tight}% · 过载 ≥{HEAT_THRESHOLDS.over}%</span>
      </div>

      <div className={styles.body}>
        {/* ── 画布（缩放/平移）───────────────────────────────────────────────── */}
        <div
          ref={canvasRef}
          className={styles.canvas}
          data-testid="phys-topo-canvas"
          data-zoom={t.k.toFixed(2)}
          data-pan-x={Math.round(t.x)}
          data-pan-y={Math.round(t.y)}
          tabIndex={0}
          role="group"
          aria-label="物理拓扑画布（滚轮缩放·拖拽平移·快捷键 + - 0）"
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <div
            ref={stageRef}
            className={styles.stage}
            data-testid="phys-topo-stage"
            style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})` }}
          >
            {/* 段带（四段） */}
            <div className={styles.segRow} style={{ gridTemplateColumns: gridTemplate }}>
              <div className={styles.corner}>基地 \ 工序</div>
              {matrix.segments.map((seg) => {
                const span = matrix.processes.filter((p) => p.segment === seg.key).length;
                return (
                  <div
                    key={seg.key}
                    className={styles.segCell}
                    data-testid={`phys-topo-seg-${seg.key}`}
                    style={{ gridColumn: `span ${span}` }}
                  >
                    {seg.label}
                  </div>
                );
              })}
            </div>

            {/* 工序表头 */}
            <div className={styles.colRow} style={{ gridTemplateColumns: gridTemplate }}>
              <div className={styles.corner} />
              {matrix.processes.map((p) => (
                <div key={p.suffix} className={styles.colHead} data-testid={`phys-topo-col-${p.suffix}`} data-segment={p.segment}>
                  <b>{p.name}</b>
                  <small>
                    {p.seq}·{p.equipmentType ?? "—"}
                  </small>
                </div>
              ))}
            </div>

            {/* 矩阵体 */}
            <div role="grid" aria-label="基地×工序热力矩阵" data-testid="phys-topo-grid">
              {matrix.rows.map((row) => (
                <div
                  key={row.base.baseId}
                  role="row"
                  className={styles.row}
                  data-testid={`phys-topo-row-${row.base.baseId}`}
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  <div className={styles.rowHead} data-testid={`phys-topo-rowhead-${row.base.baseId}`}>
                    <b>{row.base.name}</b>
                    <small className={styles.rowMeta} data-provenance="registry">
                      {row.base.kind} · 利用率 {row.util.value}% · {row.gwh.value}GWh · {row.lines.value} 线
                    </small>
                    <small
                      className={styles.rowBn}
                      data-testid={`phys-topo-bn-${row.base.baseId}`}
                      data-located={row.bottleneck.processSuffix === null ? "0" : "1"}
                    >
                      瓶颈 {row.bottleneck.equipmentType}
                      {row.bottleneck.processSuffix === null ? "（本图定位不到列）" : ""}
                    </small>
                  </div>
                  {row.cells.map((c) => (
                    <div
                      key={c.key}
                      role="gridcell"
                      tabIndex={0}
                      className={styles.cell}
                      data-testid={`phys-topo-cell-${c.baseId}-${c.process.suffix}`}
                      data-band={c.band}
                      data-provenance={c.util.provenance}
                      data-bottleneck={c.isBottleneck ? "1" : "0"}
                      aria-label={`${c.baseName} ${c.process.name}：${PROVENANCE_LABEL[c.util.provenance]} 计划工时利用率 ${c.util.value ?? "EMPTY"}%`}
                      onMouseEnter={() => setHoverKey(c.key)}
                      onFocus={() => setHoverKey(c.key)}
                      onMouseLeave={() => setHoverKey((k) => (k === c.key ? null : k))}
                    >
                      <u className={styles.fill} data-band={c.band} style={{ opacity: heatAlpha(c.util) }} />
                      <span className={styles.cellVal}>{c.util.value ?? "—"}</span>
                      {/* 来源角标：每一格自带，杜绝"看久了以为是实测"；真值格也标，免得两种数看起来一样 */}
                      <em className={styles.cellProv} data-prov-tag={c.util.provenance} title={PROVENANCE_LABEL[c.util.provenance]}>
                        {PROVENANCE_BADGE[c.util.provenance]}
                      </em>
                      {c.isBottleneck ? <s className={styles.bnFlag} aria-hidden="true" /> : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          {hint ? (
            <div className={styles.hint} data-testid="phys-topo-hint" role="status">
              {hint}
            </div>
          ) : null}
        </div>

        {/* ── 悬停详情 ──────────────────────────────────────────────────────────── */}
        <aside className={styles.detail} data-testid="phys-topo-detail" aria-live="polite">
          {hovered && hoveredRow ? (
            <>
              <div className={styles.detailHead}>
                <b data-testid="phys-topo-detail-title">
                  {hovered.baseName} · {hovered.process.name}
                </b>
                <small>
                  {hovered.process.segmentLabel} · 第 {hovered.process.seq} 道 · 设备型{" "}
                  {hovered.process.equipmentType ?? "EMPTY（typeMap 无该车间）"}
                </small>
              </div>
              {hovered.isBottleneck ? (
                <p className={styles.detailBn} data-testid="phys-topo-detail-bottleneck">
                  ⚑ 该基地登记瓶颈落在本工序（<code>BASE_REGISTRY.bottleneck = {hoveredRow.bottleneck.equipmentType}</code>）
                </p>
              ) : null}
              {/* ⚠ 「计划工时利用率」≠ 行首「产能利用率」：前者 = Σ实际生产时间÷Σ计划生产时间（设备侧），
                     后者 = BASE_REGISTRY.util（基地产能侧）。两个口径**刻意不共用中文名**，共用即事故。 */}
              <MeasureLine label="计划工时利用率" m={hovered.util} testId="phys-topo-detail-util" />
              <MeasureLine label="OEE" m={hovered.oee} testId="phys-topo-detail-oee" />
              <MeasureLine label="在制" m={hovered.wip} testId="phys-topo-detail-wip" />
              <MeasureLine label="节拍" m={hovered.takt} testId="phys-topo-detail-takt" />
              <hr className={styles.hr} />
              <div className={styles.detailSection}>基地级真值（BASE_REGISTRY）</div>
              <MeasureLine label="基地产能利用率" m={hoveredRow.util} testId="phys-topo-detail-base-util" />
              <MeasureLine label="名义产能" m={hoveredRow.gwh} testId="phys-topo-detail-base-gwh" />
              <MeasureLine label="产线数" m={hoveredRow.lines} testId="phys-topo-detail-base-lines" />
              {hoveredRow.bottleneck.processSuffix === null ? (
                <p className={styles.detailWarn} data-testid="phys-topo-detail-bn-unlocated">
                  {hoveredRow.bottleneck.reason}
                </p>
              ) : null}
            </>
          ) : (
            <p className={styles.detailIdle} data-testid="phys-topo-detail-idle">
              悬停（或用 Tab 聚焦）任一格查看该工序详情。
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

export default PhysicalTopologyView;

/** 仅供测试引用，避免测试重复硬编码几何常数。 */
export const __geom = { ROW_HEAD_W, CELL_W, HINT_MS, clampZoom };
