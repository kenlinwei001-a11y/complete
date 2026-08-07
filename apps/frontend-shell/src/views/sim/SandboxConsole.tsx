import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BASE_REGISTRY, type ChainImpedimentKind } from "@platform/contracts";
import { runSolver } from "@/api/endpoints";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ChainLineMapView } from "./ChainLineMapView";
import { deriveFamilyAnchors, fetchOrdersForFamilies, type FamilyAnchor } from "./chainFamilyLines";
import { TRANSIT_SOURCE_SPECS, CADENCE_ABSENCE, PROCUREMENT_BRANCH } from "./transitFlow";
import { PhysicalTopologyView } from "./PhysicalTopologyView";
import { NodeInspectorView } from "./InspectorNodePanel";
import TransitFlowView from "./TransitFlowLayer";
import { PLACEHOLDER_SEED_DEFAULT } from "./physicalTopology";
import { type ChainLossPayload } from "./chainLineMap";
import {
  buildChainImpedimentModel,
  CHAIN_IMPEDIMENT_SOLVER_KEY,
  ChainImpedimentPayloadSchema,
  DATA_MODE_LABEL,
  type ChainImpedimentModel,
} from "./chainImpediment";
import {
  buildPareto,
  buildStageBoard,
  CANVAS_MODES,
  CANVAS_MODE_LABEL,
  CANVAS_MODE_TITLE,
  chainStageCoverage,
  fmtDays,
  fmtFlowEff,
  fmtPct,
  IMPEDIMENT_CARDS,
  IMPEDIMENT_DESIGN_GAP,
  PARETO_TOP_N,
  SCOPE_DIMENSIONS,
  type CanvasMode,
  type NodeCardVM,
  type StepVM,
} from "./sandboxConsole";
import styles from "./SandboxConsole.module.css";

/**
 * WO-SANDBOX-CONSOLE · **推演沙盘主屏 = 一页控制台**（不是五个平级导航页）。
 *
 * ── 这个组件解决的问题 ────────────────────────────────────────────────────────
 * 上一单把 F1–F4 四个已完工组件登记进 `BUILTIN_VIEWS` 让它们「可达」，代价是它们成了
 * **四个平级导航页**（`/v/chain-line-map` `/v/transit-flow` `/v/physical-topology` `/v/node-inspector`），
 * 而沙盘主屏 `/v/sim-sandbox` 一行没动。设计稿的 IA 是**一页**：
 *   顶栏 → 阻滞点统计条 → 左(范围) 中(一块画布多模式) 右(节点检视) → 底部 Pareto + 指标行。
 * 本组件就是那一页。四个独立页保留（它们各自的 registry 键不动），本页**复用同一批组件**
 * 而不是重写它们的内部：只给它们加了默认值 = 今天行为的可选 prop（`chrome` / `onPayload` /
 * `selectedNodeId`），所以四个独立页零回归。
 *
 * ── 取数：两个求解器，各取一次 ────────────────────────────────────────────────
 *  · `chain_loss_attribution`（E1）—— **不由本组件发请求**。它由画布里的 `ChainLineMapView` 取，
 *    经新增的 `onPayload` 回抛同一份载荷；底部 Pareto、顶栏前置期/流动效率、链路阶段画布
 *    **共用这一份**。口径单源是本仓铁律：`pctOfChainLoss` 的分母排除增值段，
 *    前端不许发第二次请求、不许自己重算百分比。
 *  · `chain_impediments`（E3）—— 本组件取（顶部四卡）。视图模型走已有的
 *    `chainImpediment.ts` 派生层（不造第二套判定层）。
 *
 * ── 同一份数据三处投影，三处各答一问（不重叠）─────────────────────────────
 * 设计稿把逐环节明细画了三遍（画布卡片 / 右侧检视 / 底部 Pareto，排序与数值完全相同）。
 * 本页按「一处一问」拆：卡片只给节点级一个数 + 最大那条环节 + 页脚，其余折叠；
 * 完整逐环节表**只在右侧**；Pareto 给跨节点拉平的 Top-N。数据仍是全的，只是卡片不全画。
 *
 * ── 诚实位（本页的头号判据）──────────────────────────────────────────────────
 * 复用组件自带的诚实标记一个都没丢（物理拓扑的「格内数值为占位值」横幅、节点检视的
 * 「段耗时为占位值·不是实测」、线路图的 AND≠OR 警示与 EMPTY 停运站位、阻滞点的 dataMode 四态）。
 * 本页自己新增的诚实位：
 *  ① 范围三维**逐消费方**标接线状态（实测：`chain_loss_attribution` 连 baseIds 都不读）；
 *  ② 时窗 30/60/90D **无 ARGS**（两个求解器都没有时间窗入参）→ 控件禁用 + 徽标；
 *  ③ 链路阶段模式：设计目标 5 段 24 节点 vs 后端注册表 4 段 12 节点，差额明写；
 *  ④ 阻滞点「卡点」的设计稿措辞与引擎判据不一致 → 按引擎口径显示并说明差异。
 *
 * ── 主题 ──────────────────────────────────────────────────────────────────────
 * 零硬编码颜色（全走 `styles/tokens.css` 的 token）；主题开关直接复用顶栏那个 `ThemeToggle`
 * （三档 暗色/冷蓝/亮橙 循环 · 落 localStorage · 改 `<html data-theme>`），**不新造一套**。
 */

// ══════════════════════════════════════════════════════════════════════════════
// 宿主插槽 —— 旧沙盘主屏的功能整块搬进来，一个都不许掉
// ══════════════════════════════════════════════════════════════════════════════

export interface SandboxConsoleRailSection {
  id: string;
  title: string;
  node: ReactNode;
  defaultOpen?: boolean;
}

export interface SandboxConsoleProps {
  /** 顶栏右侧追加的标签（旧主屏的本体派生摘要 / 全局态 KPI）。 */
  topTags?: ReactNode;
  /** 控制条（旧主屏：推进 tick / 存档 / 分支 / 采纳 / tick 时间轴）。 */
  controlBar?: ReactNode;
  /** 画布第四模式「本体拓扑」的内容（旧主屏 PmDag）。不传 → 该模式显示未就绪原因。 */
  ontologyCanvas?: ReactNode;
  /** 右栏可折叠区（旧主屏：就绪认证 / 多场景对比 / AI 指挥台）。 */
  rail?: SandboxConsoleRailSection[];
}

// ══════════════════════════════════════════════════════════════════════════════
// 取数状态
// ══════════════════════════════════════════════════════════════════════════════

type ImpLoad =
  | { status: "loading" }
  | { status: "ready"; model: ChainImpedimentModel }
  | { status: "error"; code: string; message: string; requestId: string | null };

interface EnvelopeError {
  code?: string;
  message?: string;
  requestId?: string;
}

/** 错误只陈述**能从响应直接读出**的事实：错误码 / 后端 message / requestId。不内联病因猜测。 */
function readError(e: unknown): { code: string; message: string; requestId: string | null } {
  const anyE = e as { code?: string; message?: string; requestId?: string; error?: EnvelopeError; status?: number };
  const code = anyE?.error?.code ?? anyE?.code ?? (anyE?.status ? `HTTP_${anyE.status}` : "UNKNOWN");
  const message = anyE?.error?.message ?? anyE?.message ?? String(e);
  return { code: String(code), message, requestId: anyE?.error?.requestId ?? anyE?.requestId ?? null };
}

/**
 * 时窗档位。**今天没有任何求解器吃它** —— `chain_loss_attribution` 只认 `so`，
 * `chain_impediments` 只认 `scope`。故控件禁用 + 无 ARGS 徽标（不给用户一个假旋钮）。
 */
const TIME_WINDOWS = ["30D", "60D", "90D"] as const;

// ══════════════════════════════════════════════════════════════════════════════
// 组件
// ══════════════════════════════════════════════════════════════════════════════

export function SandboxConsole({ topTags, controlBar, ontologyCanvas, rail = [] }: SandboxConsoleProps) {
  const [mode, setMode] = useState<CanvasMode>("metro");
  /** 懒挂载 + 挂了不卸：切模式不重取数、不丢缩放态（设计稿三块 `.cv` 同时在 DOM 里同理）。 */
  const [mounted, setMounted] = useState<Set<CanvasMode>>(() => new Set<CanvasMode>(["metro"]));
  const [loss, setLoss] = useState<ChainLossPayload | null>(null);
  const [imp, setImp] = useState<ImpLoad>({ status: "loading" });
  const [dimKind, setDimKind] = useState<ChainImpedimentKind | null>(null);
  const [baseIds, setBaseIds] = useState<string[]>([]);
  const [honesty, setHonesty] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [railTab, setRailTab] = useState<"steps" | "vars">("steps");
  const [transitOn, setTransitOn] = useState(false);
  const [chainZoom, setChainZoom] = useState(1);
  /** 产品族同心环：**默认关**（打开 = 每族多一次求解器调用，代价在界面上明写）。 */
  const [familyOn, setFamilyOn] = useState(false);
  const [famAnchors, setFamAnchors] = useState<FamilyAnchor[] | null>(null);
  const [famDiscoverErr, setFamDiscoverErr] = useState<string | null>(null);

  // 族锚点发现：只在开关打开时拉一次订单（关着 = 零额外请求）。
  useEffect(() => {
    if (!familyOn || famAnchors !== null) return;
    let cancelled = false;
    fetchOrdersForFamilies().then(
      (rows) => {
        if (cancelled) return;
        const { anchors } = deriveFamilyAnchors(rows);
        setFamAnchors(anchors);
        setFamDiscoverErr(anchors.length === 0 ? "订单集合里没有任何合契约的 businessType ⇒ 分不出产品族，不画三个一样的环冒充" : null);
      },
      (e: unknown) => {
        if (cancelled) return;
        setFamDiscoverErr(readError(e).message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [familyOn, famAnchors]);

  const switchMode = useCallback((next: CanvasMode) => {
    setMode(next);
    setMounted((s) => (s.has(next) ? s : new Set([...s, next])));
  }, []);

  // ── 阻滞点扫描（本组件唯一自发的请求）───────────────────────────────────────
  const impArgs = useMemo(() => ({ scope: baseIds.length > 0 ? { baseIds } : {} }), [baseIds]);
  const impArgsKey = useMemo(() => JSON.stringify(impArgs), [impArgs]);
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    setImp({ status: "loading" });
    runSolver(CHAIN_IMPEDIMENT_SOLVER_KEY, JSON.parse(impArgsKey) as Record<string, unknown>, ac.signal).then(
      (raw) => {
        if (cancelled) return;
        const parsed = ChainImpedimentPayloadSchema.safeParse((raw as { data?: unknown })?.data ?? raw);
        if (!parsed.success) {
          setImp({
            status: "error",
            code: "PAYLOAD_SHAPE",
            message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · "),
            requestId: null,
          });
          return;
        }
        setImp({ status: "ready", model: buildChainImpedimentModel(parsed.data) });
      },
      (e: unknown) => {
        if (cancelled) return;
        setImp({ status: "error", ...readError(e) });
      },
    );
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [impArgsKey]);

  // ── 线路图的 view（把范围维度带给 E1；实测它今天只认 so，故这里只是不吞掉入参）────
  const lineMapView = useMemo(
    () => ({ viewKey: "chain-line-map", options: baseIds.length > 0 ? { baseIds } : {} }) as never,
    [baseIds],
  );

  const board = useMemo(() => (loss === null ? null : buildStageBoard(loss)), [loss]);
  const pareto = useMemo(() => (loss === null ? null : buildPareto(loss)), [loss]);
  const coverage = useMemo(() => chainStageCoverage(board), [board]);

  const nodeById = useMemo(() => {
    const m = new Map<string, NodeCardVM>();
    if (board !== null) for (const l of board.lanes) for (const n of l.nodes) m.set(n.nodeId, n);
    return m;
  }, [board]);
  const selected = selectedNodeId === null ? null : (nodeById.get(selectedNodeId) ?? null);

  // 选中态默认落在损失占比最大的那个节点（R6 全序：buildStageBoard 已排好）。
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current || board === null) return;
    const first = board.lanes.flatMap((l) => l.nodes).sort((a, b) => b.pctOfChainLoss - a.pctOfChainLoss)[0];
    if (first !== undefined) {
      setSelectedNodeId(first.nodeId);
      autoSelectedRef.current = true;
    }
  }, [board]);

  const totals = loss?.totals ?? null;
  const model = imp.status === "ready" ? imp.model : null;
  /** 选中类阻滞点落在哪些 stage 上（dim 联动的唯一判据，见 `stagesOfKind` 的诚实边界注）。 */
  const dimStages = useMemo(() => (dimKind === null ? new Set<string>() : stagesOfKind(model, dimKind)), [model, dimKind]);

  const pickNode = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      setRailTab("steps");
    },
    [],
  );

  const toggleBase = (id: string) =>
    setBaseIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].sort()));

  const scopeText = `${baseIds.length === 0 ? "全部基地" : `${baseIds.length} 基地`} · 业务线/产品未接线`;

  return (
    <div className={styles.root} data-testid="sandbox-console" data-mode={mode} data-honesty={honesty ? "1" : "0"}>
      {/* ══ 顶栏 ══════════════════════════════════════════════════════════════ */}
      <div className={styles.top} data-testid="sc-topbar">
        <div className={styles.logo}>
          推演<i>沙盘</i>
        </div>
        <span className={styles.tag} data-testid="sc-scale">
          端到端产销 · 后端 {coverage.backendStageCount} 段 / 本次载荷 {coverage.renderedNodeCount} 节点
        </span>

        {/* 时窗：设计稿有，但两个求解器都没有时间窗入参 ⇒ 禁用 + 无 ARGS 徽标（不给假旋钮） */}
        <div className={styles.seg} role="group" aria-label="时窗（未接线）">
          {TIME_WINDOWS.map((w) => (
            <button key={w} type="button" disabled aria-pressed={w === "60D"} data-testid={`sc-window-${w}`}>
              {w}
            </button>
          ))}
        </div>
        {honesty ? (
          <span className={`${styles.badge} ${styles.badgeGap}`} data-testid="sc-window-badge" title="chain_loss_attribution 只认 so；chain_impediments 只认 scope。两者都没有时间窗入参。">
            时窗无 ARGS
          </span>
        ) : null}

        <span className={`${styles.tag} ${styles.tagOn}`} data-testid="sc-seed">
          ● SEED {PLACEHOLDER_SEED_DEFAULT} · 确定性（物理拓扑占位值种子）
        </span>
        <span className={styles.tag} data-testid="sc-scope">
          {scopeText}
        </span>
        {topTags}
        <div className={styles.spacer} />
        <span className={`${styles.tag} ${styles.tagHot}`} data-testid="sc-leadtime">
          前置期 {fmtDays(totals?.leadTimeDays ?? null)}D · 增值 {fmtFlowEff(totals?.flowEfficiency ?? null)}
        </span>
        <div className={styles.seg}>
          <button type="button" aria-pressed={honesty} data-testid="sc-honesty-toggle" onClick={() => setHonesty((v) => !v)}>
            真实性标注
          </button>
        </div>
        <ThemeToggle />
      </div>

      {/* ══ 阻滞点统计条 ══════════════════════════════════════════════════════ */}
      <div className={styles.impBar} data-testid="sc-impbar">
        {IMPEDIMENT_CARDS.map((c) => {
          const group = model?.groups.find((g) => g.kind === c.kind) ?? null;
          const pressed = dimKind === c.kind;
          return (
            <button
              key={c.kind}
              type="button"
              className={styles.impCard}
              data-kind={c.kind}
              data-testid={`sc-imp-${c.kind}`}
              aria-pressed={pressed}
              title={c.meaning}
              onClick={() => setDimKind(pressed ? null : c.kind)}
            >
              <span className={styles.impNum} data-testid={`sc-imp-${c.kind}-count`}>
                {group === null ? "—" : group.engineCount}
              </span>
              <span className={styles.impMeta}>
                <b>{c.label}</b>
                <span>{c.meaning}</span>
              </span>
            </button>
          );
        })}
        <div className={styles.impCard} data-kind="FLOW" data-static="1" data-testid="sc-imp-FLOW">
          <span className={styles.impNum} data-testid="sc-imp-FLOW-val">
            {fmtFlowEff(totals?.flowEfficiency ?? null)}
          </span>
          <span className={styles.impMeta}>
            <b>流动效率</b>
            <span>
              增值 {fmtDays(totals?.valueAddDays ?? null)}D / 前置期 {fmtDays(totals?.leadTimeDays ?? null)}D
            </span>
          </span>
        </div>
      </div>

      {honesty ? (
        <p className={styles.noteWarn} data-testid="sc-imp-gap">
          <b>口径差（按引擎显示，不按设计稿措辞）：</b>
          {IMPEDIMENT_DESIGN_GAP}
          {model !== null ? (
            <>
              {" "}本次扫描 {model.total} 条，诚实位分布：
              {(Object.entries(model.honestyCounts) as [keyof typeof model.honestyCounts, number][])
                .filter(([, n]) => n > 0)
                .map(([m2, n]) => `${DATA_MODE_LABEL[m2]} ${n}`)
                .join(" · ") || "（空）"}
              ；判不出来 {model.unresolved.length} 条。
            </>
          ) : null}
        </p>
      ) : null}

      {/* ══ 三栏主体 ══════════════════════════════════════════════════════════ */}
      <div className={styles.mid}>
        {/* ── 左：范围 ────────────────────────────────────────────────────── */}
        <aside className={styles.pane} data-testid="sc-scope-pane">
          <div className={styles.paneHead}>
            <h2>范围</h2>
          </div>
          <div className={styles.paneBodyFlush}>
            {SCOPE_DIMENSIONS.map((dim) => {
              const wired = dim.wiring === "wired";
              return (
                <div key={dim.key} className={styles.dimGroup} data-testid={`sc-dim-${dim.key}`}>
                  <div className={styles.dimHead}>
                    <b>{dim.label}</b>
                    {honesty ? (
                      <span
                        className={`${styles.badge} ${wired ? styles.badgeOk : styles.badgeGap}`}
                        data-testid={`sc-dim-${dim.key}-badge`}
                        title={dim.note}
                      >
                        {wired ? "已接线" : "无 ARGS"}
                      </span>
                    ) : null}
                  </div>
                  {dim.key === "baseIds" ? (
                    BASE_REGISTRY.map((b) => (
                      <label key={b.baseId} className={styles.opt}>
                        <input
                          type="checkbox"
                          data-testid={`sc-base-${b.baseId}`}
                          checked={baseIds.length === 0 || baseIds.includes(b.baseId)}
                          onChange={() => toggleBase(b.baseId)}
                        />
                        <span className={styles.optName}>{b.name}</span>
                        <span className={styles.optSub}>{b.baseId}</span>
                      </label>
                    ))
                  ) : (
                    <p className={styles.note} data-testid={`sc-dim-${dim.key}-note`}>
                      {dim.note}
                    </p>
                  )}
                </div>
              );
            })}
            {honesty ? (
              <div className={styles.dimGroup}>
                <div className={styles.dimHead}>
                  <b>范围能带到哪</b>
                </div>
                <p className={styles.note} data-testid="sc-scope-reach">
                  勾选只驱动 <code>chain_impediments</code>（实测 baseIds=changzhou 时 total 15→13）。
                  <b>全链损失归因 chain_loss_attribution 不吃任何范围维度</b> —— 它只认锚点订单 <code>so</code>，
                  传 baseIds 结果逐字节不变（实测）。故底部 Pareto / 前置期 / 链路阶段画布**不随左栏变**。
                </p>
              </div>
            ) : null}
            <div className={styles.dimGroup}>
              <div className={styles.dimHead}>
                <b>阻滞点图例</b>
              </div>
              <div className={styles.legendList} data-testid="sc-legend">
                {IMPEDIMENT_CARDS.map((c) => (
                  <div key={c.kind}>
                    <b>{c.label}</b>（{c.kind}）· {c.meaning}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* ── 中：画布（一块画布多模式）─────────────────────────────────────── */}
        <main className={styles.pane} data-testid="sc-canvas-pane">
          <div className={styles.paneHead}>
            <h2 data-testid="sc-canvas-title">{CANVAS_MODE_TITLE[mode]}</h2>
            <div className={styles.seg} role="group" aria-label="画布模式">
              {CANVAS_MODES.map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} data-testid={`sc-mode-${m}`} onClick={() => switchMode(m)}>
                  {CANVAS_MODE_LABEL[m]}
                </button>
              ))}
            </div>
            {mode === "metro" ? (
              <>
                <label className={styles.layerToggle} data-testid="sc-transit-toggle">
                  <input type="checkbox" checked={transitOn} onChange={() => setTransitOn((v) => !v)} />
                  在途批次图层
                </label>
                <label className={styles.layerToggle} data-testid="sc-family-toggle" title="每族一张真实锚点订单，各调一次求解器（代价见图上说明）">
                  <input type="checkbox" checked={familyOn} onChange={() => setFamilyOn((v) => !v)} />
                  产品族同心环
                </label>
              </>
            ) : null}
            {mode === "chain" ? (
              <>
                <div className={styles.seg} role="group" aria-label="链路阶段缩放">
                  <button type="button" data-testid="sc-chain-zoom-out" onClick={() => setChainZoom((z) => Math.max(0.5, Number((z / 1.15).toFixed(3))))}>
                    －
                  </button>
                  <button type="button" data-testid="sc-chain-zoom-in" onClick={() => setChainZoom((z) => Math.min(2, Number((z * 1.15).toFixed(3))))}>
                    ＋
                  </button>
                  <button type="button" data-testid="sc-chain-zoom-fit" onClick={() => setChainZoom(1)}>
                    适应
                  </button>
                </div>
                <span className={styles.tag} data-testid="sc-chain-zoom-readout">
                  {Math.round(chainZoom * 100)}%
                </span>
              </>
            ) : null}
            <span className={styles.spacer} />
            <span className={styles.tag} data-testid="sc-canvas-hint">
              点节点 → 右栏检视 · 缩放/平移在各画布自带的缩放条
            </span>
          </div>

          <div className={styles.canvasWrap}>
            {/* 线路图（+ 在途图层）*/}
            <div className={styles.canvasSlot} hidden={mode !== "metro"} data-testid="sc-slot-metro">
              {mounted.has("metro") ? (
                <ChainLineMapView
                  view={lineMapView}
                  chrome="embedded"
                  onPayload={setLoss}
                  {...(familyOn && famAnchors !== null && famAnchors.length > 0 ? { familyAnchors: famAnchors } : {})}
                />
              ) : null}
              {familyOn && famDiscoverErr !== null ? (
                <p className={styles.errBox} data-testid="sc-family-error" role="alert">
                  <b>产品族锚点发现失败</b>：{famDiscoverErr}
                  。**不画三个一样的环冒充三条族线** —— 主链那一圈照常。
                </p>
              ) : null}
              {transitOn ? (
                <div className={styles.layerPanel} data-testid="sc-transit-layer">
                  {honesty ? <TransitComputabilityLegend /> : null}
                  <TransitFlowView chrome="embedded" />
                </div>
              ) : null}
            </div>

            {/* 物理拓扑 */}
            <div className={styles.canvasSlot} hidden={mode !== "topo"} data-testid="sc-slot-topo">
              {mounted.has("topo") ? <PhysicalTopologyView chrome="embedded" /> : null}
            </div>

            {/* 链路阶段 */}
            <div className={styles.canvasSlot} hidden={mode !== "chain"} data-testid="sc-slot-chain">
              {honesty ? (
                <p className={styles.noteWarn} data-testid="sc-chain-coverage">
                  <b>诚实边界：</b>设计目标 {coverage.designStageCount} 段 {coverage.designNodeCount} 节点
                  （{coverage.designStageNames.join(" / ")}）；
                  后端单源 <code>CHAIN_STAGES</code> 今天只有 {coverage.backendStageCount} 段
                  （{coverage.backendStageLabels.join(" / ")}）、<code>CHAIN_NODE_REGISTRY</code> 只有{" "}
                  {coverage.backendRegistryNodeCount} 个静态在册节点 ——
                  <b>
                    差 {coverage.missingStageCount} 段 {coverage.missingNodeCount} 个节点尚未建模
                  </b>
                  。本画布按后端真有的渲染（本次载荷 {coverage.renderedNodeCount} 个节点，其中{" "}
                  {coverage.renderedDynamicOpCount} 个来自动态工序命名空间 <code>capacity.op.*</code>），
                  <b>不拿 {coverage.backendRegistryNodeCount} 个冒充 {coverage.designNodeCount} 个</b>，
                  也不在前端手抄一份 24 节点词表。扩注册表要连引擎一起改，不在本单边界。
                </p>
              ) : null}
              {board === null ? (
                <p className={styles.stateLine} data-testid="sc-chain-waiting">
                  等 <code>chain_loss_attribution</code> 载荷（由线路图模式取回后共用同一份；线路图取不到数时本模式也没有数据）。
                </p>
              ) : (
                <div className={styles.stageBoard} style={{ transform: `scale(${chainZoom})`, width: `${100 / chainZoom}%` }} data-testid="sc-stage-board">
                  {board.lanes.map((lane) => (
                    <section key={lane.stage} className={styles.lane} data-testid={`sc-lane-${lane.stage}`}>
                      <div className={styles.laneHead}>
                        <span className={styles.laneName}>{lane.label}</span>
                        <span className={styles.laneStat}>
                          {lane.nodes.length} 节点 · 占全链损失{" "}
                          {fmtPct(lane.nodes.reduce((a, n) => a + n.pctOfChainLoss, 0))}
                        </span>
                      </div>
                      {lane.nodes.length === 0 ? (
                        <p className={styles.laneEmptyRow} data-testid={`sc-lane-${lane.stage}-empty`}>
                          本次载荷这一段没有节点（不是 0 天，是没有节点）。
                        </p>
                      ) : (
                        <div className={styles.laneGrid}>
                          {lane.nodes.map((n) => {
                            const hit = dimKind === null || dimStages.has(n.stage);
                            return (
                              <button
                                key={n.nodeId}
                                type="button"
                                className={`${styles.nodeCard}${hit ? "" : ` ${styles.dimmed}`}`}
                                aria-pressed={selectedNodeId === n.nodeId}
                                data-testid={`sc-node-${n.nodeId}`}
                                onClick={() => pickNode(n.nodeId)}
                              >
                                <span className={styles.nodeCardTop}>
                                  <span className={styles.nodeCardName} title={`${n.label}（${n.nodeId}）`}>
                                    {n.label}
                                  </span>
                                  <span className={styles.nodeCardPct} data-zero={n.pctOfChainLoss === 0 ? "1" : "0"}>
                                    {fmtPct(n.pctOfChainLoss)}
                                  </span>
                                </span>
                                {n.topStep === null ? (
                                  <span className={styles.nodeCardTopStep}>（本节点无非增值环节）</span>
                                ) : (
                                  <span className={styles.nodeCardTopStep} title={n.topStep.label}>
                                    最大：{n.topStep.label} {fmtDays(n.topStep.nonValueDays)}D
                                  </span>
                                )}
                                <span className={styles.nodeCardFoot}>
                                  <span>{fmtDays(n.leadTimeDays)}D</span>
                                  <span>增值 {fmtFlowEff(n.flowEfficiency)}</span>
                                  {n.collapsedCount > 0 ? (
                                    <span className={styles.nodeCardMore}>其余 {n.collapsedCount} 项 →</span>
                                  ) : null}
                                  {n.emptySteps.length > 0 ? (
                                    <span className={styles.nodeCardEmpty}>EMPTY {n.emptySteps.length}</span>
                                  ) : null}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {lane.orphanEmpty.length > 0 ? (
                        <p className={styles.laneEmptyRow} data-testid={`sc-lane-${lane.stage}-orphan`}>
                          本段另有 {lane.orphanEmpty.length} 个环节诚实标 EMPTY（算不出来，**未补 0**）：
                          {lane.orphanEmpty.map((e) => `${e.label}（${e.emptyKind}）`).join("、")}
                        </p>
                      ) : null}
                    </section>
                  ))}
                </div>
              )}
            </div>

            {/* 本体拓扑（旧主屏 PmDag）*/}
            <div className={styles.canvasSlot} hidden={mode !== "ontology"} data-testid="sc-slot-ontology">
              {ontologyCanvas ?? (
                <p className={styles.stateLine} data-testid="sc-ontology-missing">
                  本体拓扑未就绪（宿主未传入 <code>ontologyCanvas</code>）。
                </p>
              )}
            </div>
          </div>
        </main>

        {/* ── 右：节点检视 ────────────────────────────────────────────────── */}
        <aside className={styles.pane} data-testid="sc-inspect-pane">
          <div className={styles.paneHead}>
            <h2 data-testid="sc-inspect-title">{selected === null ? "节点检视" : selected.label}</h2>
            {selected !== null ? (
              <span className={styles.tag} data-testid="sc-inspect-node-id">
                {selected.nodeId}
              </span>
            ) : null}
          </div>
          <div className={styles.tabs} role="tablist">
            <button type="button" role="tab" aria-selected={railTab === "steps"} data-testid="sc-tab-steps" onClick={() => setRailTab("steps")}>
              逐环节 · 实测归因
            </button>
            <button type="button" role="tab" aria-selected={railTab === "vars"} data-testid="sc-tab-vars" onClick={() => setRailTab("vars")}>
              变量输入 · 占位
            </button>
          </div>
          <div className={styles.paneBody}>
            {railTab === "steps" ? (
              <StepDetail node={selected} honesty={honesty} />
            ) : (
              <NodeInspectorView chrome="embedded" selectedNodeId={selectedNodeId ?? undefined} onNodeIdChange={setSelectedNodeId} />
            )}
          </div>
          {rail.map((s) => (
            <details key={s.id} className={styles.railSection} open={s.defaultOpen ?? false} data-testid={`sc-rail-${s.id}`}>
              <summary>{s.title}</summary>
              <div className={styles.railBody}>{s.node}</div>
            </details>
          ))}
        </aside>
      </div>

      {/* ══ 控制条（旧主屏 tick 控制条整块搬来）══════════════════════════════ */}
      {controlBar}

      {/* ══ 底部 Pareto ══════════════════════════════════════════════════════ */}
      <div className={styles.pane} data-testid="sc-pareto-pane" style={{ flex: "none" }}>
        <div className={styles.paneHead}>
          <h2>全链损失 Pareto · 环节级</h2>
          <span className={styles.spacer} />
          <span className={styles.tag} data-testid="sc-pareto-summary">
            {pareto === null
              ? "等 chain_loss_attribution"
              : `Top${pareto.rows.length}/${pareto.totalRows} 吃掉 ${fmtPct(pareto.topPct)} 损失 · 全链非增值 ${fmtDays(pareto.nonValueDays)}D`}
          </span>
        </div>
        <div className={styles.paneBody} style={{ overflowX: "auto" }}>
          {pareto === null ? (
            <p className={styles.stateLine} data-testid="sc-pareto-waiting">
              等线路图取回 <code>chain_loss_attribution</code>（同一份响应的第三种投影，**不发第二次请求**）。
            </p>
          ) : (
            <>
              <div className={styles.pareto} data-testid="sc-pareto">
                {pareto.rows.map((r) => {
                  const max = pareto.rows[0]?.pctOfChainLoss ?? 1;
                  return (
                    <button
                      key={r.stepId}
                      type="button"
                      className={styles.paretoBar}
                      data-testid={`sc-pareto-${r.stepId}`}
                      title={`${r.nodeLabel} · ${r.stepLabel}（${r.kindLabel}）· ${fmtDays(r.nonValueDays)}D · 占全链损失 ${fmtPct(r.pctOfChainLoss)}`}
                      onClick={() => pickNode(r.nodeId)}
                    >
                      <span className={styles.paretoPct}>{fmtPct(r.pctOfChainLoss)}</span>
                      <span className={styles.paretoFill} style={{ height: `${Math.max(2, (r.pctOfChainLoss / max) * 100)}%` }} />
                      <span className={styles.paretoLabel}>
                        {r.nodeLabel}
                        <br />
                        {r.stepLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
              {honesty ? (
                <p className={styles.note} data-testid="sc-pareto-note">
                  影响率 = 该环节非增值天数 ÷ 全链非增值总量，<b>分母由引擎给</b>（
                  <code>chain_loss_attribution.attribution[].pctOfChainLoss</code>）。作业段是增值、不进分母，
                  故全链非增值环节之和恒 100%（本次守恒 Σ ={" "}
                  {loss?.conservation === undefined ? "—" : `${loss.conservation.sumPct.toFixed(3)}%`}
                  ，{loss?.conservation?.ok === true ? "在容差内" : "超容差"}）。前端不重算百分比、不定义分母。
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* ══ 底部指标卡片行（全部真值：算不出来的写 EMPTY 不写 0）══════════════ */}
      <div className={styles.metricRow} data-testid="sc-metrics">
        <MetricCard label="前置期" value={totals === null ? null : `${fmtDays(totals.leadTimeDays)}D`} sub="锚点订单全链（引擎 totals.leadTimeDays）" />
        <MetricCard label="增值天数" value={totals === null ? null : `${fmtDays(totals.valueAddDays)}D`} sub="kind=work 的环节之和" />
        <MetricCard label="非增值（损失）" value={totals === null ? null : `${fmtDays(totals.nonValueDays)}D`} sub="Pareto 的分母" />
        <MetricCard label="流动效率" value={totals === null ? null : fmtFlowEff(totals.flowEfficiency)} sub="增值 / 前置期" />
        <MetricCard
          label="环节 / 诚实缺席"
          value={totals === null ? null : `${totals.stepCount} / ${totals.emptyCount}`}
          sub="emptyCount = 算不出来的环节数（未补 0）"
        />
        <MetricCard
          label="阻滞点 / 判不出"
          value={model === null ? null : `${model.total} / ${model.unresolved.length}`}
          sub="chain_impediments · 判不出来的判据也要看得见"
        />
      </div>

      {imp.status === "error" ? (
        <p className={styles.errBox} data-testid="sc-imp-error" role="alert">
          <b>阻滞点扫描未取到数</b> · <code data-testid="sc-imp-error-code">{imp.code}</code>：
          <span data-testid="sc-imp-error-message">{imp.message}</span>
          {imp.requestId !== null ? (
            <>
              {" "}· requestId <code>{imp.requestId}</code>
            </>
          ) : null}
          。四张卡显示「—」而<b>不是 0</b>：0 条阻滞点与扫不出来是两回事。
        </p>
      ) : null}
    </div>
  );
}

/**
 * 阻滞点筛选的**命中判据**：该类阻滞点落在哪些 `stage` 上。
 *
 * ⚠ 诚实边界（真实的接缝缺口，不拿一个看着合理的映射盖过去）：
 * `chain_impediments` 的 locus 是**对象**（`MaterialBatch` / `Line` / `Process`…），
 * `chain_loss_attribution` 的节点是**链路节点**（`order.cash` / `capacity.op.OP-001`…）——
 * 两个求解器**没有共同的 id 维度**，今天只有 `stage` 能对上。
 * 故点统计条只能按 `stage` 联动 dim，**不能按节点精确点亮**。
 */
function stagesOfKind(model: ChainImpedimentModel | null, kind: ChainImpedimentKind): Set<string> {
  if (model === null) return new Set();
  return new Set(model.groups.find((g) => g.kind === kind)?.items.map((i) => i.stage) ?? []);
}

/** 位置口径 → 中文档名 + 「因此画成什么」。三档三种图元，**不许用同一个匀速滑块糊过去**。 */
const TRANSIT_MODE_LABEL: Record<string, { tier: string; glyph: string }> = {
  interpolated: { tier: "① 区间位置可算", glyph: "沿区间移动的方块（真滑）" },
  "arrival-only": { tier: "② 只有到货日", glyph: "到站倒计时徽标（**不画车**）" },
  "station-resident": { tier: "③ 只知在哪一站", glyph: "站上驻留 + 排队堆叠（不画工序间行进）" },
};

/**
 * WO-SANDBOX-METRO-SEMANTICS · **在途/在制的时序可算性分级**上屏。
 *
 * ── 为什么这块必须在控制台里，而不是留在独立页的说明文字里 ────────────────────
 * 设计稿画了一个 `D+0.0` 时钟 + `1×/4×/16×` + 区间上匀速滑动的批次方块。
 * 那套东西**恰恰是本仓明确拒绝画的**：三个数据源的位置精度天然不同
 * （`TRANSIT_SOURCE_SPECS`，字段逐条实测于 `synthetic/battery.ts`）——
 * 只有 `InterBaseTransfer` 三件套齐全（发运日 + 到货日）能真滑；
 * `Shipment` 没有发运日（那条 0→1 的进度条会是纯发明的）；
 * `WIPLot` 连 eta 都没有。把三者画成同一个匀速滑块 = 用图元冒充数据。
 * 折成图层后这套判据不能丢，故在这里原样呈现 —— `modeReason` **逐字透传**，前端不改写。
 *
 * 本组件**零自有文案**：档名/理由/必需字段全部取自 `transitFlow.ts` 的单一来源。
 */
function TransitComputabilityLegend() {
  return (
    <section className={styles.tierBox} data-testid="sc-transit-tiers" role="note">
      <div className={styles.sec} style={{ marginTop: 0 }}>在途/在制 · 时序可算性分级（替代设计稿那个假时钟）</div>
      <p className={styles.note} style={{ marginTop: 0 }} data-testid="sc-transit-tier-intro">
        设计稿的 <code>D+0.0</code> 时钟 + <code>1×/4×/16×</code> + 区间上匀速滑动的方块，
        在本仓是<b>被明确拒绝的画法</b>：三个数据源的位置精度天然不同，
        <b>只有第 ① 档能真的在区间上移动</b>。控制台不另造时钟，播控由本图层提供。
      </p>
      <ul className={styles.tierList}>
        {TRANSIT_SOURCE_SPECS.map((spec) => {
          const m = TRANSIT_MODE_LABEL[spec.mode] ?? { tier: spec.mode, glyph: "—" };
          return (
            <li key={spec.key} data-testid={`sc-transit-tier-${spec.key}`} data-mode={spec.mode}>
              <b>
                {m.tier} · {spec.label}
              </b>
              <span className={styles.tierGlyph}>⇒ {m.glyph}</span>
              {/* modeReason 逐字透传引擎侧/派生层原文，前端一个字都不改写 */}
              <em data-testid={`sc-transit-reason-${spec.key}`}>{spec.modeReason}</em>
              <code>必需字段：{spec.requiredFields.join(" · ")}</code>
            </li>
          );
        })}
        <li data-testid="sc-transit-tier-cadence" data-mode="empty">
          <b>④ 节拍闸门 · {CADENCE_ABSENCE.status}</b>
          <span className={styles.tierGlyph}>⇒ EMPTY（不画任何「这里有节拍」的假象）</span>
          <em data-testid="sc-transit-reason-cadence">{CADENCE_ABSENCE.reason}</em>
          <code>补齐路径：{CADENCE_ABSENCE.unblockedBy}</code>
        </li>
        <li data-testid="sc-transit-tier-procurement" data-mode="empty">
          <b>
            ⑤ 采购支线 · {PROCUREMENT_BRANCH.label} · {PROCUREMENT_BRANCH.status}
          </b>
          <span className={styles.tierGlyph}>⇒ 空 + 逐条取证（画不出来就说画不出来）</span>
          <em data-testid="sc-transit-reason-procurement">{PROCUREMENT_BRANCH.reason}</em>
          <code>补齐路径：{PROCUREMENT_BRANCH.unblockedBy}</code>
        </li>
      </ul>
    </section>
  );
}

/** 底部指标卡。`value === null` ⇒ 显示 `EMPTY`，**绝不显示 0**。 */
function MetricCard({ label, value, sub }: { label: string; value: string | null; sub: string }) {
  return (
    <div className={styles.metricCard} data-empty={value === null ? "1" : "0"} data-testid={`sc-metric-${label}`}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={styles.metricValue}>{value ?? "EMPTY"}</div>
      <div className={styles.metricSub}>{value === null ? "引擎未返回该项（未补 0）" : sub}</div>
    </div>
  );
}

/**
 * 右栏「逐环节 · 实测归因」——**唯一出全表的地方**（画布卡片只给一个数 + 最大那条）。
 * 全部字段直取引擎载荷：天数 = `ChainStep.days`；影响率 = `attribution[].pctOfChainLoss`。
 */
function StepDetail({ node, honesty }: { node: NodeCardVM | null; honesty: boolean }) {
  if (node === null) {
    return (
      <p className={styles.stateLine} data-testid="sc-step-detail-empty">
        点画布上的节点或底部 Pareto 的柱子，这里出该节点的完整逐环节表。
      </p>
    );
  }
  const max = node.steps.reduce((m, s) => Math.max(m, s.pctOfChainLoss ?? 0), 0);
  return (
    <div data-testid="sc-step-detail" data-node-id={node.nodeId}>
      <dl className={styles.kv}>
        <dt>所属段</dt>
        <dd>{node.stage}</dd>
        <dt>前置期</dt>
        <dd>{fmtDays(node.leadTimeDays)}D</dd>
        <dt>增值</dt>
        <dd>
          {fmtDays(node.valueAddDays)}D · {fmtFlowEff(node.flowEfficiency)}
        </dd>
        <dt>占全链损失</dt>
        <dd data-testid="sc-step-detail-node-pct">{fmtPct(node.pctOfChainLoss)}</dd>
      </dl>

      <div className={styles.sec}>逐环节明细 · {node.steps.length} 条</div>
      <table className={styles.stepTable} data-testid="sc-step-table">
        <thead>
          <tr>
            <th>环节</th>
            <th>类型</th>
            <th style={{ textAlign: "right" }}>天数</th>
            <th />
            <th style={{ textAlign: "right" }}>影响率</th>
          </tr>
        </thead>
        <tbody>
          {node.steps.map((s) => (
            <StepRow key={s.stepId} s={s} max={max} />
          ))}
        </tbody>
      </table>

      {node.emptySteps.length > 0 ? (
        <>
          <div className={styles.sec}>诚实缺席 · {node.emptySteps.length} 条</div>
          {node.emptySteps.map((e) => (
            <p key={e.stepId} className={styles.errBox} data-testid={`sc-step-empty-${e.stepId}`}>
              <b>
                {e.label} · {e.emptyKind}
              </b>
              <br />
              {e.reason}
            </p>
          ))}
        </>
      ) : null}

      {honesty ? (
        <p className={styles.note} data-testid="sc-step-detail-note">
          天数取引擎 <code>ChainStep.days</code>（期望态）；影响率取 <code>attribution[].pctOfChainLoss</code>，
          分母 = 全链非增值总量（增值段不进分母，故增值行影响率显示「—」而非 0）。
          <b>本表与画布卡片、底部 Pareto 是同一份响应的三种投影</b>，不是三次取数。
        </p>
      ) : null}
    </div>
  );
}

function StepRow({ s, max }: { s: StepVM; max: number }) {
  return (
    <tr data-value-add={s.valueAdd ? "1" : "0"} data-testid={`sc-step-${s.stepId}`}>
      <td title={s.cadenceLabel ?? undefined}>{s.label}</td>
      <td className={styles.stepKind}>{s.kindLabel}</td>
      <td className={styles.stepNum}>{fmtDays(s.days)}</td>
      <td className={styles.stepBarCell}>
        <span
          className={styles.stepBar}
          style={{ width: `${max > 0 ? Math.max(2, ((s.pctOfChainLoss ?? 0) / max) * 100) : 2}%` }}
        />
      </td>
      <td className={styles.stepPct}>{s.pctOfChainLoss === null ? "—" : fmtPct(s.pctOfChainLoss)}</td>
    </tr>
  );
}

export default SandboxConsole;
