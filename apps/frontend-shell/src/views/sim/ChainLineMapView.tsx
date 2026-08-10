import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { runSolver } from "@/api/endpoints";
import type { ViewRendererProps } from "../registry";
import {
  buildChainLineMap,
  CHAIN_LOSS_SOLVER_KEY,
  ChainLossPayloadSchema,
  formatDays,
  formatPct,
  LAYOUT,
  radialOffsetFrom,
  RING_LAYOUT,
  SHARED_BASIS_LABEL,
  STAGE_LABEL,
  STATION_RADIUS,
  STEP_KIND_LABEL,
  type ChainLineMap,
  type ChainLossPayload,
  type StationVM,
  type SuspendedVM,
} from "./chainLineMap";
import { familyIdentityOf, type FamilyAnchor } from "./chainFamilyLines";
import {
  fitTransform,
  IDENTITY_TRANSFORM,
  zoomAt,
  zoomCenter,
  ZOOM_STEP,
  type ViewTransform,
} from "./physicalTopology";
import styles from "./ChainLineMapView.module.css";

/**
 * WO-SANDBOX-F1 · 全链线路图（地铁图隐喻）。
 *
 * 站 = 环节 · 换乘站 = 共用工序（共享瓶颈） · **合流站 = 齐套 AND** · 停运区间 = 断点 · 红弧 = 返工逆行。
 * 站圈大小 ∝ 该站 `pctOfChainLoss`（映射与夹取见 `chainLineMap.ts` `stationRadius`）。
 *
 * ── 数据来源（**只有一条**）────────────────────────────────────────────────────
 * 引擎求解器 `chain_loss_attribution`（WO-SANDBOX-E1），经 `runSolver` → B 侧 `/b/v1/solvers/{key}/run`。
 * 本组件**不带任何内置数据集**：引擎没接通就显示接不通，不拿示例数据顶上（`genuine-sim` 纪律）。
 * 图例里的图元是**图元样例**（形状说明），不带任何百分比/天数，不会被误读成数据。
 *
 * ── 为什么没复用 `LayeredDag` / `ProvenanceDag` / `PmDag` ───────────────────────
 * 逐个读过实现后的判断（不是没找）：
 *  · `LayeredDag`（`components/Dag/LayeredDag.tsx`）—— 节点是**固定尺寸方块**，`DagNodeDef` 里
 *    根本没有尺寸维度；而本图最核心的编码恰恰是**站圈半径随 `pctOfChainLoss` 连续变**。
 *  · `PmDag`（同目录）—— 六层固定的分层 DAG，节点高宽是常量（`NH`/`LH`）。
 *  · `ProvenanceDag`（`components/ProvenanceDag.tsx`）—— 逐层缩进的**树**，不是几何画布。
 * 三者都没有「双环换乘站 / AND 闸门 / 停运虚线区间 / 逆行弧」这四种图元的位置，
 * 硬塞会变成「在 DAG 上贴一层 SVG」——那才是重造。
 * **真正复用的是缩放/平移那套数学**：`zoomAt` / `zoomCenter` / `fitTransform` / `ViewTransform`
 * 直接 import 自 F3 的 `physicalTopology.ts`，一行没抄（同一份实现、同一套锚点语义与上下限）。
 *
 * ── 主题 ──────────────────────────────────────────────────────────────────────
 * 零硬编码颜色：全部走 `styles/tokens.css` 的 CSS 变量 ⇒ dark / light / warm 三套自动跟随。
 * 半径/坐标是**几何**不是配色，写在 SVG 属性里（测试正是靠它咬 SEAM）。
 */

/** 提示条自动消隐时长（ms）。 */
const HINT_MS = 1600;

/**
 * 一圈上最多标几个站名。
 *
 * 实测（demo seed 42）主干 26 个站位、每个站名是 4–8 个汉字；三圈叠起来是 78 组标签，
 * 在 ~600px 宽的画布槽里必然糊成一团（真浏览器实拍确认）。
 * 处置纪律：**减的是标签，不是站** —— 站一个不少、悬浮/右栏仍给全量读数；
 * 只把「先看哪几个」标出来。选取判据 = `pctOfChainLoss` 降序（引擎给的损失占比，前端不另定优先级），
 * 并列按 stepId 字典序（R6 全序）。停运站位**不参与减标**：断点必须一直看得见。
 */
export const MAX_LABELS_PER_RING = 9;

/**
 * 该圈上要标名字的 `stepId` 集合。
 * 多圈时**只有最外那一圈标名字**（三圈站在同一角度上，标三遍是纯重复）。
 */
export function labelledStepIds(map: ChainLineMap, isLabelRing: boolean): Set<string> {
  if (!isLabelRing) return new Set();
  const ranked = [...map.stations]
    .sort((a, b) => {
      const av = a.pctOfChainLoss ?? -1;
      const bv = b.pctOfChainLoss ?? -1;
      return av !== bv ? bv - av : a.stepId < b.stepId ? -1 : 1;
    })
    .slice(0, MAX_LABELS_PER_RING);
  return new Set(ranked.map((s) => s.stepId));
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; map: ChainLineMap; summary: string | null; anchorSo: string | null }
  | { status: "error"; code: string; message: string; requestId: string | null };

/**
 * 多产品族同心环的加载态。**与主链的 `state` 分开** —— 族线是**加性叠加**：
 * 它取不到数时主链照常画，只是少了另外两圈 + 屏上说明为什么少。
 * 绝不因为族线失败就把整张图打成空态。
 */
type FamilyState =
  | { status: "off" }
  | { status: "loading"; count: number }
  | { status: "ready"; maps: ChainLineMap[] }
  | { status: "error"; message: string };

interface EnvelopeError {
  code?: string;
  message?: string;
  requestId?: string;
}

/**
 * 错误只陈述**能从响应直接读出**的事实：错误码 / 后端 message / requestId。
 * 不内联任何因果断言（"大概是没开通吧"）——`RootCausePanel` 那次把用户引去查一个好的引擎，
 * 就是因为面板自作主张写了病因。前端看不出病因，只看得见响应。
 */
function readError(e: unknown): { code: string; message: string; requestId: string | null } {
  const anyE = e as { code?: string; message?: string; requestId?: string; error?: EnvelopeError; status?: number };
  const code = anyE?.error?.code ?? anyE?.code ?? (anyE?.status ? `HTTP_${anyE.status}` : "UNKNOWN");
  const message = anyE?.error?.message ?? anyE?.message ?? String(e);
  return { code: String(code), message, requestId: anyE?.error?.requestId ?? anyE?.requestId ?? null };
}

/** 求解器入参：从 `view.options` 取，缺省 = 未限定（全域）。**不在前端编默认范围。** */
function argsFromView(view: ViewRendererProps["view"] | undefined): Record<string, unknown> {
  const opts = (view?.options ?? {}) as Record<string, unknown>;
  const args: Record<string, unknown> = {};
  if (typeof opts.so === "string" && opts.so !== "") args.so = opts.so;
  for (const dim of ["businessTypes", "baseIds", "modelIds"] as const) {
    const v = opts[dim];
    if (Array.isArray(v) && v.length > 0) args[dim] = v;
  }
  return args;
}

// ══════════════════════════════════════════════════════════════════════════════
// 图元
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 合流站图元 = **AND 闸门 + 汇流母线**。
 *
 * ⚠ 这是隐喻唯一撑不住的地方，所以它**故意长得和换乘站完全不一样**：
 *   · 换乘站（双环圆）= 地铁语义，**OR**：任一列车进站即可续行；
 *   · 合流站（D 形闸门 + 母线 + `∧` 标记）= 齐套语义，**AND**：上游全部到齐才放行。
 * 画成同一个「合并」图元就是把 OR 冒充 AND —— 用户会以为缺一样也能开工。
 */
function AndGate({ x, y, testId }: { x: number; y: number; testId: string }) {
  const h = 17;
  const w = 15;
  // D 形（逻辑 AND 门的标准形状）：左侧平直竖边 + 右侧半圆。
  const d = `M ${x - w} ${y - h} L ${x} ${y - h} A ${h} ${h} 0 0 1 ${x} ${y + h} L ${x - w} ${y + h} Z`;
  return (
    <g data-testid={testId} data-glyph="and-gate" data-join-semantics="AND">
      <path className={styles.andGate} d={d} />
      <text className={styles.andGlyphText} x={x - w / 2 + 1} y={y + 4} textAnchor="middle">
        ∧
      </text>
    </g>
  );
}

/**
 * 环形布局下的**标签摆位**（设计稿 `:788` 同法）：沿半径朝**环外**推开，按象限定文字锚点。
 * 直线布局那种"一律摆正上方"在环上会让左右两侧的站名压到线上。
 */
function labelAnchor(angle: number, r: number, x: number, y: number) {
  const co = Math.cos(angle);
  const si = Math.sin(angle);
  // 「离开环」只有一处实现（`chainLineMap.radialOffsetFrom`）——在途图层的站上徽标走的是同一个函数。
  const out = radialOffsetFrom(x, y, angle, r + 15);
  return {
    lx: out.x,
    ly: out.y,
    /** 上下两极用 middle，左右两侧朝外对齐 */
    anchor: Math.abs(co) < 0.34 ? ("middle" as const) : co > 0 ? ("start" as const) : ("end" as const),
    /** 名称行的基线微调（正下方要多让一点，正上方要少让一点） */
    dyName: si > 0.6 ? 10 : si < -0.6 ? -3 : 4,
    /** 百分比行 */
    dyPct: si > 0.6 ? 21 : si < -0.6 ? 8 : 15,
  };
}

/**
 * 站圈。`r` 是引擎 `pctOfChainLoss` 的纯函数（SEAM 的被观测量），配色全走 token。
 *
 * `sharedAcrossFamilies` = 该 `stepId` 在**每一圈族线上都出现** ⇒ 共线区段的换乘站
 * （= 共享瓶颈）。这是环形布局相对直线的**信息增益**：三个半径上同角度对齐的双环，
 * 一眼看出"这道工序被三条产品族线共用"。单圈时恒 false（一条线谈不上共线）。
 */
function Station({
  s,
  sharedAcrossFamilies = false,
  labelled = true,
  onEnter,
  onLeave,
}: {
  s: StationVM;
  sharedAcrossFamilies?: boolean;
  /** 是否在图上标出站名 —— 见 `labelledStepIds` 的密度纪律。false 时站仍在，只是名字改为悬浮出。 */
  labelled?: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const L = labelAnchor(s.angle, s.r, s.x, s.y);
  return (
    <g
      data-testid={`clm-station-${s.stepId}`}
      data-station-kind={s.glyph}
      data-step-kind={s.kind}
      data-stage={s.stage}
      data-line={s.lineId}
      data-pct={s.pctOfChainLoss === null ? "" : String(s.pctOfChainLoss)}
      data-radius={String(s.r)}
      data-shared-basis={s.sharedBasis === null ? "" : s.sharedBasis.kind}
      data-shared-families={sharedAcrossFamilies ? "1" : "0"}
      data-ring-index={s.ringIndex}
      tabIndex={0}
      role="img"
      aria-label={`${s.label}：占全链损失 ${formatPct(s.pctOfChainLoss)}`}
      onMouseEnter={onEnter}
      onFocus={onEnter}
      onMouseLeave={onLeave}
      onBlur={onLeave}
    >
      {/* 共线换乘：多圈同角度对齐时额外加一圈外环，让"三条族线共用"在图上直接可读 */}
      {sharedAcrossFamilies ? (
        <circle className={styles.sharedFamilyHalo} data-testid={`clm-shared-halo-${s.stepId}`} cx={s.x} cy={s.y} r={s.r + 5} />
      ) : null}
      {s.glyph === "interchange" ? (
        <>
          <circle className={styles.interchangeOuter} cx={s.x} cy={s.y} r={s.r} />
          <circle className={styles.interchangeInner} cx={s.x} cy={s.y} r={Math.max(2, s.r * 0.45)} />
        </>
      ) : (
        <circle className={s.glyph === "value-add" ? styles.stationValueAdd : styles.stationStop} cx={s.x} cy={s.y} r={s.r} />
      )}
      {/* 站名与读数：密度过高时只标"值得先看的那些"，其余悬浮出（站本身一个不少，见 labelledStepIds） */}
      {labelled ? (
        <>
          <text className={styles.stationName} x={L.lx} y={L.ly + L.dyName} textAnchor={L.anchor}>
            {s.label}
          </text>
          <text className={styles.stationPct} data-testid={`clm-pct-${s.stepId}`} x={L.lx} y={L.ly + L.dyPct} textAnchor={L.anchor}>
            {s.valueAdd ? "增值·不进分母" : formatPct(s.pctOfChainLoss)}
          </text>
        </>
      ) : (
        /*
         * 无名站也要能被测试与读屏找到读数（悬浮面板给全量），故保留一个隐藏读数节点。
         *
         * ⚠ WO-SANDBOX-DECLUTTER · 这里**曾经是 SVG `<title>`**，那是一个真 bug（仓主实测：
         * 「环形流程图部分，鼠标移走后弹窗没有消失，遮挡了环形图」）：
         * SVG `<title>` 会被浏览器渲染成**原生 tooltip** —— 由操作系统绘制、**不受 React 控制、
         * 恒画在最上层**（包括盖住 SVG 自己），且移开后滞留是原生 tooltip 的常见行为。
         * 本图 28 站里只标 9 个站名（`MAX_LABELS_PER_RING`），其余 19 个全走这一支 ⇒
         * 环上大半的站一碰就弹一个盖住图、还不肯走的原生框。
         *
         * 换成**视觉隐藏的 `<text>`**（`.srOnlyText` = `opacity:0` + `pointer-events:none`）：
         *  · DOM 节点与 testid 原样保留 ⇒ 咬 `clm-pct-*` 的四处测试一行不用改；
         *  · 读数文本原样保留 ⇒ 读屏仍读得到（且 `<g role="img" aria-label>` 本就是权威读法，
         *    `aria-label` 优先于 `<title>`，删 `<title>` 不降级 —— 见 metro-semantics 门里的
         *    `getByLabelText` 实测断言）；
         *  · 悬停读数的正解一直都在：React 那个 `<aside data-testid="clm-detail">` 给全量，
         *    它不是 `position:absolute`，不遮挡任何东西。
         */
        <text className={styles.srOnlyText} data-testid={`clm-pct-${s.stepId}`} x={L.lx} y={L.ly + L.dyPct} textAnchor={L.anchor}>
          {s.label} · {s.valueAdd ? "增值·不进分母" : formatPct(s.pctOfChainLoss)}
        </text>
      )}
    </g>
  );
}

/** 停运站位 = 断点。空心方框 + 叉，与任何"有值的站"在形状上就分得开。 */
function SuspendedStop({
  s,
  labelled = true,
  onEnter,
  onLeave,
}: {
  s: SuspendedVM;
  labelled?: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const a = 11;
  const L = labelAnchor(s.angle, a, s.x, s.y);
  return (
    <g
      data-testid={`clm-suspended-${s.stepId}`}
      data-station-kind="suspended"
      data-stage={s.stage}
      data-line={s.lineId}
      data-empty-kind={s.emptyKind}
      tabIndex={0}
      role="img"
      aria-label={`${s.label}：停运（断点）· ${s.emptyKind}`}
      onMouseEnter={onEnter}
      onFocus={onEnter}
      onMouseLeave={onLeave}
      onBlur={onLeave}
    >
      <rect className={styles.suspendedBox} x={s.x - a} y={s.y - a} width={a * 2} height={a * 2} rx={3} />
      <path className={styles.suspendedCross} d={`M ${s.x - 5} ${s.y - 5} L ${s.x + 5} ${s.y + 5} M ${s.x + 5} ${s.y - 5} L ${s.x - 5} ${s.y + 5}`} />
      {labelled ? (
        <>
          <text className={styles.stationName} x={L.lx} y={L.ly + L.dyName} textAnchor={L.anchor}>
            {s.label}
          </text>
          <text className={styles.suspendedTag} x={L.lx} y={L.ly + L.dyPct} textAnchor={L.anchor}>
            停运
          </text>
        </>
      ) : (
        /* 同上：原生 tooltip（SVG `<title>`）会盖住环形图且移开不消失 ⇒ 换视觉隐藏 `<text>`。
           读屏读的是 `<g role="img" aria-label>`（本组件 :281），不依赖这一节点。 */
        <text className={styles.srOnlyText} x={L.lx} y={L.ly + L.dyPct} textAnchor={L.anchor}>
          {s.label} · 停运（断点）
        </text>
      )}
    </g>
  );
}

/**
 * WO-SANDBOX-CONSOLE · 「嵌进控制台时把常驻块折起来」的**纯包装**。
 * `collapsed=false`（= 独立页默认）时渲染 `<>{children}</>` —— DOM 与包装前**逐节点相同**，零回归。
 * 折起来 ≠ 删掉：图例与 AND≠OR 警示仍在 DOM 里、仍可展开（诚实标记不许在重组时弄丢）。
 */
function MaybeCollapsed({ collapsed, label, testId, children }: { collapsed: boolean; label: string; testId: string; children: React.ReactNode }) {
  if (!collapsed) return <>{children}</>;
  return (
    <details data-testid={testId}>
      <summary style={{ cursor: "pointer", fontSize: 11, color: "var(--muted2)" }}>{label}</summary>
      {children}
    </details>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 视图
// ══════════════════════════════════════════════════════════════════════════════

// `ViewRendererProps` = `{ view: ViewConfigVM }`。声明为 Partial 是为了让本组件在
// 「registry 注册（必须可赋给 ComponentType<ViewRendererProps>）」与「可达门里裸渲染」两处都成立
// —— F3 那次正是签名不符 `ViewRendererProps` 导致 29 例 vitest 全绿而 build TS2322 红。
/**
 * WO-SANDBOX-CONSOLE 追加的**两个可选** prop（默认值 = 今天的行为，独立页 `/v/chain-line-map` 零回归）：
 *
 *  · `chrome="embedded"` —— 嵌进沙盘控制台的画布槽时，标题块折掉、图例收进 `<details>`。
 *    缩放条、守恒条、AND≠OR 警示原样保留（诚实标记不许在重组时弄丢）。
 *
 *  · `onPayload` —— 把**本组件已经取回并校验过的**那一份载荷原样回抛给宿主。
 *    存在的理由只有一条：控制台的底部 Pareto 与顶栏前置期/流动效率必须与本图**同一份响应**
 *    （口径单源是本仓铁律：`pctOfChainLoss` 的分母排除增值段，宿主不许自己再发一次请求、
 *    更不许自己重算百分比）。本 prop **不改变取数逻辑** —— 请求还是本组件发的那一次，
 *    时机还是那个时机；只是解析成功后多喊一声。
 */
export type ChainLineMapChrome = "full" | "embedded";

export interface ChainLineMapExtraProps {
  chrome?: ChainLineMapChrome;
  onPayload?: (payload: ChainLossPayload) => void;
  /**
   * WO-SANDBOX-METRO-SEMANTICS · **产品族同心环**（默认不传 = 单圈，独立页零回归）。
   *
   * 传入 N 个族锚点 ⇒ 本组件**额外**发 N 次 `chain_loss_attribution`（每族一张真实锚点订单），
   * 画成 N 圈同心环。三条线之所以不同，是因为**锚点不同**（实测 totals/归因排序/scope 都不同），
   * 不是给同一份数据上三个颜色。代价（多 N 次请求）在界面上明写。
   */
  familyAnchors?: readonly FamilyAnchor[];
}

export function ChainLineMapView({ view, chrome = "full", onPayload, familyAnchors }: Partial<ViewRendererProps> & ChainLineMapExtraProps) {
  const args = useMemo(() => argsFromView(view), [view]);
  /** 回调放 ref：宿主传匿名函数不该把取数 effect 的依赖搅动成每渲染一次就重取。 */
  const onPayloadRef = useRef(onPayload);
  onPayloadRef.current = onPayload;
  const argsKey = useMemo(() => JSON.stringify(args), [args]);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [t, setT] = useState<ViewTransform>(IDENTITY_TRANSFORM);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [famState, setFamState] = useState<FamilyState>({ status: "off" });
  const famKey = useMemo(() => JSON.stringify(familyAnchors ?? []), [familyAnchors]);

  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  /**
   * 定时器纪律（本仓刚修过 4 处「覆盖 ref 漏清 → 前一个 handle 成孤儿 → 整包随机红」）：
   * 这个 ref 只存得下一个 handle，**覆盖前必须先 clear**；卸载时也清。
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

  // ── 取数：唯一数据源 = 引擎求解器 ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    setState({ status: "loading" });
    runSolver(CHAIN_LOSS_SOLVER_KEY, JSON.parse(argsKey) as Record<string, unknown>, ac.signal).then(
      (raw) => {
        if (cancelled) return;
        const parsed = ChainLossPayloadSchema.safeParse((raw as { data?: unknown })?.data ?? raw);
        if (!parsed.success) {
          // 形状不合契约 ⇒ 报出来，不去猜、不去补字段（S0 冻结的意义就在这）。
          setState({
            status: "error",
            code: "PAYLOAD_SHAPE",
            message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · "),
            requestId: null,
          });
          return;
        }
        const payload = parsed.data;
        setState({
          status: "ready",
          map: buildChainLineMap(payload),
          summary: payload.summary ?? null,
          anchorSo: payload.anchor?.so ?? null,
        });
        // 同一份响应回抛宿主（控制台的 Pareto / 顶栏与本图**共用这一份**，不发第二次请求）。
        onPayloadRef.current?.(payload);
      },
      (e: unknown) => {
        if (cancelled) return;
        setState({ status: "error", ...readError(e) });
      },
    );
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [argsKey, reloadKey]);

  /**
   * ── 产品族同心环：每族一次求解器（锚点 = 该族 `so` 字典序最小的真实订单）─────────
   * 加性叠加：本 effect 失败不影响主链那一圈（`state` 独立）。
   * 全部请求共用一个 AbortController：切换/卸载时一起取消，不留孤儿请求。
   */
  useEffect(() => {
    const anchors = JSON.parse(famKey) as FamilyAnchor[];
    if (anchors.length === 0) {
      setFamState({ status: "off" });
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    setFamState({ status: "loading", count: anchors.length });
    Promise.all(
      anchors.map((a) =>
        runSolver(CHAIN_LOSS_SOLVER_KEY, { so: a.so }, ac.signal).then((raw) => {
          const parsed = ChainLossPayloadSchema.safeParse((raw as { data?: unknown })?.data ?? raw);
          if (!parsed.success) throw new Error(`族线 ${a.label}（${a.so}）载荷形状不合契约`);
          return { anchor: a, payload: parsed.data };
        }),
      ),
    ).then(
      (rows) => {
        if (cancelled) return;
        setFamState({
          status: "ready",
          maps: rows.map((r, i) =>
            buildChainLineMap(r.payload, { family: familyIdentityOf(r.anchor, i, rows.length, r.payload.anchor) }),
          ),
        });
      },
      (e: unknown) => {
        if (cancelled) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setFamState({ status: "error", message: readError(e).message });
      },
    );
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [famKey, reloadKey]);

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

  const bounds = state.status === "ready" ? state.map.bounds : { width: LAYOUT.minWidth, height: LAYOUT.height };

  const doFit = useCallback(() => {
    const vp = viewportSize();
    const { transform, measured } = fitTransform(vp.w, vp.h, bounds.width, bounds.height);
    setT(transform);
    // 量不到就说量不到（jsdom / 未布局 / display:none）——不假装"已适应"。
    flashHint(measured ? "已适应画布" : "画布尺寸不可测 → 已复位为 1.00×");
  }, [bounds.height, bounds.width, flashHint, viewportSize]);

  // 滚轮以光标为锚缩放：必须 non-passive 才能 preventDefault，故手绑而非 onWheel。
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
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

  const map = state.status === "ready" ? state.map : null;
  /**
   * 要画的圈：族线就绪 ⇒ 画 N 圈族线（每圈一个真实锚点）；否则画主链那一圈。
   * **不叠加** —— 族线里第一条与主链默认锚点是同一张单，叠上去等于同一条链画两遍。
   */
  const ringMaps: ChainLineMap[] = famState.status === "ready" ? famState.maps : map !== null ? [map] : [];
  /**
   * 共线区段的**真判据**（环形相对直线的信息增益，必须可算不可装饰）：
   * 一个 `stepId` 在**每一圈**上都出现 ⇒ 三条族线共用这一环节 ⇒ 它是共享瓶颈。
   * 只有一圈时该集合恒空（一条线谈不上"共线"），界面据此不画共线标记。
   */
  const sharedStepIds = useMemo(() => {
    if (ringMaps.length < 2) return new Set<string>();
    const counts = new Map<string, number>();
    for (const m of ringMaps) for (const s of m.stations) counts.set(s.stepId, (counts.get(s.stepId) ?? 0) + 1);
    return new Set([...counts.entries()].filter(([, n]) => n === ringMaps.length).map(([id]) => id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringMaps.map((m) => m.family?.key ?? "base").join("|"), ringMaps.length]);
  const hovered = ringMaps.flatMap((m) => m.stations).find((s) => s.stepId === hoverId) ?? null;
  const hoveredEmpty = ringMaps.flatMap((m) => m.suspended).find((s) => s.stepId === hoverId) ?? null;

  return (
    <div className={styles.root} data-testid="clm-root" data-chrome={chrome}>
      <header className={styles.head}>
        <div>
          {chrome === "full" ? <h3>全链线路图 · 环节损失归因</h3> : null}
          <p className={styles.sub}>
            站 = 环节 · 站圈大小 ∝ 该环节吃掉的<b>全链损失占比</b>（引擎 <code>{CHAIN_LOSS_SOLVER_KEY}</code> 的{" "}
            <code>LossAttribution</code>）。范围：
            <b data-testid="clm-scope">{Object.keys(args).length === 0 ? "未限定（全域）" : JSON.stringify(args)}</b>
          </p>
        </div>
        <div className={styles.zoomBar}>
          <button className="btn sm" type="button" aria-label="重新扫描" data-testid="clm-reload" onClick={() => setReloadKey((k) => k + 1)}>
            ↻
          </button>
          <button className="btn sm" type="button" aria-label="放大" data-testid="clm-zoom-in" onClick={() => doZoom(ZOOM_STEP)}>
            ＋
          </button>
          <button className="btn sm" type="button" aria-label="缩小" data-testid="clm-zoom-out" onClick={() => doZoom(1 / ZOOM_STEP)}>
            －
          </button>
          <button className="btn sm" type="button" aria-label="适应画布" data-testid="clm-fit" onClick={doFit}>
            ⤢
          </button>
          <span className={styles.zoomVal} data-testid="clm-zoom-readout">
            {t.k.toFixed(2)}×
          </span>
        </div>
      </header>

      {/* ── 图例：AND ≠ OR 的说明常驻（嵌入控制台时收进 details，仍在 DOM 里）──── */}
      <MaybeCollapsed collapsed={chrome === "embedded"} label="图例 · 图元说明（含 AND ≠ OR 警示）" testId="clm-legend-collapsed">
      <section className={styles.legend} data-testid="clm-legend" role="note">
        <div className={styles.legendRow}>
          <i className={styles.legendChip} data-testid="clm-legend-stop">
            <svg width="26" height="26" aria-hidden="true">
              <circle className={styles.stationStop} cx="13" cy="13" r="9" />
            </svg>
            普通站 = 环节（圈 ∝ 损失占比）
          </i>
          <i className={styles.legendChip} data-testid="clm-legend-value-add">
            <svg width="26" height="26" aria-hidden="true">
              <circle className={styles.stationValueAdd} cx="13" cy="13" r={STATION_RADIUS.min} />
            </svg>
            增值站（作业）· 不进损失分母
          </i>
          <i className={styles.legendChip} data-testid="clm-legend-interchange">
            <svg width="26" height="26" aria-hidden="true">
              <circle className={styles.interchangeOuter} cx="13" cy="13" r="9" />
              <circle className={styles.interchangeInner} cx="13" cy="13" r="4" />
            </svg>
            换乘站 = 共用工序（共享瓶颈）
          </i>
          <i className={styles.legendChip} data-testid="clm-legend-and">
            <svg width="30" height="26" aria-hidden="true">
              <AndGate x={20} y={13} testId="clm-legend-and-gate" />
            </svg>
            合流站 = <b>齐套 AND</b>
          </i>
          <i className={styles.legendChip} data-testid="clm-legend-suspended">
            <svg width="26" height="26" aria-hidden="true">
              <rect className={styles.suspendedBox} x="3" y="3" width="20" height="20" rx="3" />
              <path className={styles.suspendedCross} d="M 8 8 L 18 18 M 18 8 L 8 18" />
            </svg>
            停运区间 = 断点（算不出来）
          </i>
          <i className={styles.legendChip} data-testid="clm-legend-rework">
            <svg width="34" height="26" aria-hidden="true">
              <path className={styles.reworkArc} d="M 28 20 Q 17 2 6 20" markerEnd="url(#clm-rework-arrow)" />
            </svg>
            红弧 = 返工逆行
          </i>
        </div>
        <p className={styles.metaphorWarn} data-testid="clm-and-or-warning">
          ⚠ <b>隐喻在合流处撑不住，故两者图元不同</b>：地铁并线是 <b>OR</b>（任一列车到站即可续行）；
          齐套是 <b>AND</b>（上游<b>全部</b>到齐才放行，缺一样就开不了工）。所以合流站画成
          <b>「AND 闸门 + 汇流母线」</b>，不与换乘站（双环圆）共用图元，也不画成普通合并。
        </p>
      </section>
      </MaybeCollapsed>

      {state.status === "loading" ? (
        <p className={styles.stateLine} data-testid="clm-loading">
          正在向引擎 <code>{CHAIN_LOSS_SOLVER_KEY}</code> 取数…
        </p>
      ) : null}

      {state.status === "error" ? (
        <section className={styles.engineError} data-testid="clm-engine-error" role="alert">
          <b>引擎未取到数 · 本图不画任何替代数据</b>
          <p>
            求解器 <code>{CHAIN_LOSS_SOLVER_KEY}</code> 返回 <code data-testid="clm-error-code">{state.code}</code>：
            <span data-testid="clm-error-message">{state.message}</span>
            {state.requestId !== null ? <span data-testid="clm-error-request-id"> · requestId <code>{state.requestId}</code></span> : null}
          </p>
          <p className={styles.errorHint}>
            这条路只有一个数据源。取不到数时显示空图 + 本提示，<b>不拿示例数据顶上</b>——
            画出来的假线路图比空白更危险（<code>genuine-sim</code> 纪律）。图例里的图元只说明形状，不带任何数值。
          </p>
        </section>
      ) : null}

      {map !== null ? (
        <>
          <section className={styles.summaryBar} data-testid="clm-summary">
            <span data-testid="clm-anchor">锚点：{state.status === "ready" && state.anchorSo ? state.anchorSo : "—"}</span>
            <span data-testid="clm-conservation" data-ok={map.conservation.ok ? "1" : "0"}>
              损失守恒 Σ = {map.conservation.sumPct === null ? "—" : `${map.conservation.sumPct.toFixed(3)}%`}
              （残差 {map.conservation.residual === null ? "—" : map.conservation.residual.toExponential(1)} · 容差 ±
              {map.conservation.tolerancePct}）
            </span>
            <span data-testid="clm-stats">
              站 {map.stats.stationCount} · 停运 {map.stats.suspendedCount} · 换乘 {map.stats.interchangeCount} · 增值{" "}
              {map.stats.valueAddCount} · 返工 {map.stats.reworkCount}
            </span>
            {/* 标签密度：减的是标签不是站，必须说清楚（否则用户会以为站少了） */}
            {map.stats.stationCount > MAX_LABELS_PER_RING ? (
              <span data-testid="clm-label-thinning">
                图上按损失占比标了前 {MAX_LABELS_PER_RING} 个站名（共 {map.stats.stationCount} 站，其余悬浮出）——
                <b>减的是标签不是站</b>；停运站位不参与减标
                {ringMaps.length > 1 ? "；多圈时只有最外圈标名（三圈同角度，标三遍是重复）" : ""}
              </span>
            ) : null}
            {/* 族线状态：**代价明写**（多发了几次请求），失败也明写（主链照常画） */}
            {famState.status !== "off" ? (
              <span data-testid="clm-family-status" data-family-state={famState.status}>
                {famState.status === "loading"
                  ? `产品族同心环：取数中（额外 ${famState.count} 次 chain_loss_attribution，每族一张真实锚点单）`
                  : famState.status === "ready"
                    ? `产品族同心环 ${famState.maps.length} 圈 · 额外 ${famState.maps.length} 次求解器调用 · 共线换乘 ${sharedStepIds.size} 处` +
                      `（${famState.maps.map((m) => `${m.family?.label}=${m.family?.anchorSo}`).join(" / ")}）`
                    : `产品族同心环取数失败：${famState.message} —— 主链那一圈照常画，不因族线失败打成空态`}
              </span>
            ) : null}
          </section>

          <div className={styles.body}>
            <div
              ref={canvasRef}
              className={styles.canvas}
              data-testid="clm-canvas"
              data-zoom={t.k.toFixed(2)}
              data-pan-x={Math.round(t.x)}
              data-pan-y={Math.round(t.y)}
              tabIndex={0}
              role="group"
              aria-label="全链线路图画布（滚轮缩放·拖拽平移·快捷键 + - 0）"
              onKeyDown={onKeyDown}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              <svg
                className={styles.stage}
                data-testid="clm-stage"
                width={map.bounds.width}
                height={map.bounds.height}
                viewBox={`0 0 ${map.bounds.width} ${map.bounds.height}`}
                style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})` }}
              >
                <defs>
                  <marker id="clm-rework-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
                    <path className={styles.reworkArrowHead} d="M 0 0 L 6 3 L 0 6 z" />
                  </marker>
                </defs>

                {ringMaps.map((rm, ri) => (
                <g key={rm.family?.key ?? "base"} data-testid={`clm-ring-layer-${rm.family?.key ?? "base"}`} data-ring-index={rm.family?.ringIndex ?? 0}>
                {/* 环名（族线标识贴在环的正上方；单链形态贴主线名） */}
                {(() => { const map = rm; const labels = labelledStepIds(rm, ri === ringMaps.length - 1); return (<>
                {map.family !== null ? (
                  <text
                    className={styles.lineLabel}
                    data-testid={`clm-ring-${map.family.key}`}
                    data-ring-index={map.family.ringIndex}
                    data-anchor-so={map.family.anchorSo ?? ""}
                    x={RING_LAYOUT.cx}
                    y={RING_LAYOUT.cy - RING_LAYOUT.ry * map.family.ringOffset - 12 - map.family.ringIndex * 13}
                    textAnchor="middle"
                  >
                    ━ {map.family.label} · 锚点 {map.family.anchorSo ?? "—"}
                  </text>
                ) : (
                  map.lines
                    .filter((l) => l.slotCount > 0)
                    .map((l, i) => (
                      <text key={l.lineId} className={styles.lineLabel} data-testid={`clm-line-${l.lineId}`} x={8} y={18 + i * 14}>
                        {l.label}
                      </text>
                    ))
                )}

                {/* 区间（弧）：live / suspended / closure 三态三图元。closure 是结构推定，刻意与实边不同。 */}
                {map.segments.map((seg) => (
                  <path
                    key={seg.segmentId}
                    data-testid={`clm-seg-${seg.segmentId}`}
                    data-segment-state={seg.state}
                    className={
                      seg.state === "suspended" ? styles.trackSuspended : seg.state === "closure" ? styles.trackClosure : styles.trackLive
                    }
                    d={seg.path ?? `M ${seg.x1} ${seg.y1} L ${seg.x2} ${seg.y2}`}
                    fill="none"
                  />
                ))}

                {/* 闭环标注（只在最外圈画一次，避免三环叠三行字） */}
                {map.closureBasis !== null && (map.family?.ringIndex ?? 0) === 0 ? (
                  <text
                    className={styles.closureLabel}
                    data-testid="clm-closure-label"
                    x={RING_LAYOUT.cx}
                    y={RING_LAYOUT.cy}
                    textAnchor="middle"
                  >
                    ↻ 闭环（结构推定）：回款 → 再投入需求
                  </text>
                ) : null}

                {/* 合流站（齐套 AND）：汇流母线 + AND 闸门。图元与换乘站刻意不同。 */}
                {map.andJoin !== null ? (
                  <g data-testid="clm-and-join" data-join-semantics={map.andJoin.semantics} data-target={map.andJoin.targetStepId}>
                    {/* 环形下母线 = 支线出口 → 合流站的直连（穿环内，一眼看出"喂进来"） */}
                    <path
                      className={styles.andBus}
                      data-testid="clm-and-bus"
                      d={`M ${map.andJoin.sourceX} ${map.andJoin.sourceY} L ${(map.andJoin.sourceX + map.andJoin.targetX) / 2} ${(map.andJoin.sourceY + map.andJoin.targetY) / 2} L ${map.andJoin.targetX} ${map.andJoin.targetY}`}
                    />
                    <AndGate
                      x={(map.andJoin.sourceX + map.andJoin.targetX) / 2}
                      y={(map.andJoin.sourceY + map.andJoin.targetY) / 2}
                      testId="clm-and-gate"
                    />
                    <text
                      className={styles.andLabel}
                      x={(map.andJoin.sourceX + map.andJoin.targetX) / 2}
                      y={(map.andJoin.sourceY + map.andJoin.targetY) / 2 - 26}
                      textAnchor="middle"
                    >
                      齐套 AND · 全到齐才放行
                    </text>
                  </g>
                ) : null}

                {/* 红弧 = 返工逆行 */}
                {map.reworkArcs.map((a) => (
                  <path
                    key={a.arcId}
                    className={styles.reworkArc}
                    data-testid={`clm-rework-${a.fromStepId}`}
                    data-arc="rework"
                    data-to={a.toStepId}
                    d={a.path}
                    markerEnd="url(#clm-rework-arrow)"
                  />
                ))}

                {/* 停运站位（断点）**不参与减标**：算不出来这件事必须一直看得见 */}
                {map.suspended.map((s) => (
                  <SuspendedStop
                    key={s.stepId}
                    s={s}
                    labelled={ri === ringMaps.length - 1}
                    onEnter={() => setHoverId(s.stepId)}
                    onLeave={() => setHoverId((k) => (k === s.stepId ? null : k))}
                  />
                ))}
                {map.stations.map((s) => (
                  <Station
                    key={s.stepId}
                    s={s}
                    sharedAcrossFamilies={sharedStepIds.has(s.stepId)}
                    labelled={labels.has(s.stepId)}
                    onEnter={() => setHoverId(s.stepId)}
                    onLeave={() => setHoverId((k) => (k === s.stepId ? null : k))}
                  />
                ))}
                </>); })()}
                </g>
                ))}
              </svg>
              {hint ? (
                <div className={styles.hint} data-testid="clm-hint" role="status">
                  {hint}
                </div>
              ) : null}
            </div>

            {/* ── 站详情 ─────────────────────────────────────────────────────── */}
            <aside className={styles.detail} data-testid="clm-detail" aria-live="polite">
              {hovered !== null ? (
                <>
                  <b data-testid="clm-detail-title">{hovered.label}</b>
                  <small>
                    {STAGE_LABEL[hovered.stage]} 段 · {hovered.nodeLabel} · {STEP_KIND_LABEL[hovered.kind]}
                  </small>
                  <dl className={styles.kv}>
                    <dt>占全链损失</dt>
                    <dd data-testid="clm-detail-pct">{hovered.valueAdd ? "增值段 · 不进损失分母（S0 §5）" : formatPct(hovered.pctOfChainLoss)}</dd>
                    <dt>该段耗时</dt>
                    <dd data-testid="clm-detail-days">{formatDays(hovered.days)}</dd>
                    <dt>站圈半径</dt>
                    <dd data-testid="clm-detail-radius">{hovered.r.toFixed(2)} px（= √占比 映射 + 上下夹取）</dd>
                    {hovered.cadenceEveryDays !== null ? (
                      <>
                        <dt>节拍周期</dt>
                        <dd data-testid="clm-detail-cadence">
                          每 {hovered.cadenceEveryDays} 天一次 · 等待期望 = {hovered.cadenceEveryDays / 2} 天
                        </dd>
                      </>
                    ) : null}
                  </dl>
                  {hovered.sharedBasis !== null ? (
                    <p className={styles.detailNote} data-testid="clm-detail-shared">
                      {SHARED_BASIS_LABEL[hovered.sharedBasis.kind]}
                      {hovered.sharedBasis.kind === "explicit" ? `：${hovered.sharedBasis.dim} = ${hovered.sharedBasis.values.join(" / ")}` : ""}
                    </p>
                  ) : null}
                </>
              ) : hoveredEmpty !== null ? (
                <>
                  <b data-testid="clm-detail-title">{hoveredEmpty.label}</b>
                  <small>
                    {STAGE_LABEL[hoveredEmpty.stage]} 段 · 停运（断点）· {hoveredEmpty.emptyKind}
                  </small>
                  <p className={styles.detailNote} data-testid="clm-detail-reason">
                    {hoveredEmpty.reason}
                  </p>
                  {hoveredEmpty.probe !== null ? (
                    <p className={styles.detailProbe} data-testid="clm-detail-probe">
                      取证：{hoveredEmpty.probe}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className={styles.detailIdle} data-testid="clm-detail-idle">
                  悬停（或 Tab 聚焦）任一站查看该环节详情。停运站位会给出「为什么算不出来」与取证方式。
                </p>
              )}
            </aside>
          </div>

          {/* ── 诚实边界：本次载荷下哪些图元没有数据 ─────────────────────────── */}
          {map.notes.length > 0 ? (
            <section className={styles.notes} data-testid="clm-notes" role="note">
              <b>本次载荷的诚实边界（不画没有的东西）</b>
              <ul>
                {map.notes.map((n, i) => (
                  <li key={n} data-testid={`clm-note-${i}`}>
                    {n}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {state.status === "ready" && state.summary ? (
            <p className={styles.stateLine} data-testid="clm-engine-summary">
              引擎结论：{state.summary}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default ChainLineMapView;

/** 仅供测试引用，避免测试重复硬编码时序常数（同 `PhysicalTopologyView.__geom` 的做法）。 */
export const __timing = { HINT_MS };
