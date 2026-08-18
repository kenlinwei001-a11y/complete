import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useInRouterContext, useNavigate } from "react-router-dom";
import { BASE_REGISTRY, CHAIN_STAGES, type ChainImpedimentKind } from "@platform/contracts";
import { runSolver } from "@/api/endpoints";
import zh from "@/locales/zh";
// WO-SANDBOX-DENSITY：`ThemeToggle` 的 import 随顶栏那颗一起去掉 ——
// 外壳顶栏（pages/ShellLayout.tsx）常驻同一颗，本页再挂一颗是重复不是分层（见顶栏那处注释）。
import { InfoPopover } from "@/components/InfoPopover";
import { ChainLineMapView } from "./ChainLineMapView";
import { deriveFamilyAnchors, fetchOrdersForFamilies, type FamilyAnchor } from "./chainFamilyLines";
import { TRANSIT_SOURCE_SPECS, CADENCE_ABSENCE, PROCUREMENT_BRANCH } from "./transitFlow";
import { PhysicalTopologyView } from "./PhysicalTopologyView";
import { NodeInspectorView } from "./InspectorNodePanel";
import TransitFlowView from "./TransitFlowLayer";
import { ProcessCanvasView } from "./ProcessCanvasView";
/**
 * WO-SANDBOX-PROCESS-MODE · 第五档的检视面板**直接复用**「流程等待态」那一页的既有组件
 * （`views/process/ProcessInspectPanel`），一行都不改：它已经把
 * 承载类型 / 属性 / 派生 / 一跳关系 / 同承载物流程 / 打到它的杠杆 / 十六层三态
 * 全部由 `GET /a/v1/process-definitions/{key}/inspect` 一次调用画出来。
 * 重写一份 = 两份措辞将来各飘各的，正是本仓最恨的那种"第二套口径"。
 * ⚠ 复用不等于搬走：`/v/process-wait` 那一页原样保留、内容不变（D4 守恒）。
 */
import { ProcessInspectPanel } from "@/views/process/ProcessInspectPanel";
import { PLACEHOLDER_SEED_DEFAULT } from "./physicalTopology";
import { CHAIN_LOSS_SOLVER_KEY, type ChainLossPayload } from "./chainLineMap";
// WO-R13-ONTOCHAIN-PANEL · 共享本体链组件：三段全部由本文件从响应字段透传，零编造。
import { OntologyChainView, type OntologyChainData } from "@/components/OntologyChain";
import {
  buildChainImpedimentModel,
  CANDIDATE_ABSENCE_LABEL,
  CHAIN_IMPEDIMENT_SOLVER_KEY,
  ChainImpedimentPayloadSchema,
  DATA_MODE_LABEL,
  type CandidateAbsenceKind,
  type CandidateVM,
  type ChainImpedimentModel,
  type ImpedimentVM,
} from "./chainImpediment";
import {
  buildPareto,
  buildStageBoard,
  CANVAS_MODES,
  CANVAS_MODE_LABEL,
  CANVAS_MODE_TITLE,
  chainNodePresence,
  chainStageCoverage,
  fmtDays,
  fmtFlowEff,
  fmtPct,
  IMPEDIMENT_CARDS,
  IMPEDIMENT_DESIGN_GAP,
  impedimentHandoffs,
  PARETO_TOP_N,
  sameOverlayBox,
  SCOPE_DIMENSIONS,
  transitOverlayBox,
  type CanvasMode,
  type EmptyNodeCardVM,
  type NodeCardVM,
  type OverlayRect,
  type StepVM,
  type TransitOverlayBox,
} from "./sandboxConsoleModel";
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
  /**
   * 本区块**当前有几条真待办**（诊断抽屉的计数由各区块自报，不由抽屉猜）。
   * 值必须来自真数据（如 `cert.gaps.length` / `model.unresolved.length`）——
   * 抽屉入口上那个数字是**承诺**，不是装饰：数字大于 0 就说明里面真有东西没解决。
   */
  issues?: number;
}

export interface SandboxConsoleProps {
  /** 顶栏右侧追加的标签（旧主屏的全局态 KPI）。 */
  topTags?: ReactNode;
  /**
   * WO-SANDBOX-DECLUTTER · **主屏唯一保留的治理信号**。
   *
   * 宿主只在「不能推演」时返回内容（`canEnterSimulation === false`），能推演时返回 `null` ⇒
   * 整条横幅**一个像素都不占**（是不渲染，不是 `hidden`）。
   * 入参 `openDiagnostics` 让横幅里的「查看详情 →」能真的把抽屉打开 ——
   * 抽屉的开合态归本组件所有，故用回调下发而不是让宿主自己造一个开关。
   */
  banner?: (openDiagnostics: () => void) => ReactNode;
  /** 控制条（旧主屏：推进 tick / 存档 / 分支 / 采纳 / tick 时间轴）。 */
  controlBar?: ReactNode;
  /**
   * WO-SANDBOX-V3 · **①左区内容 = 扰动因素输入**（`docs/PRD-sandbox-v3-three-zone.md` §1①）。
   *
   * 宿主把「我要试什么」整块塞进来（扰动类型 / 参数 / 作用范围 / 施加）。本组件只负责给它
   * 一等位置 —— **不解释、不重排、不知道里面是什么**：扰动的落点候选来自 view-config
   * （本体派生），承载物在宿主那边（R14 零业务常数）。
   *
   * ⚠ 左区是**唯一输入区**（PRD §1① 末段）。`controlBar` 与 `rail` 也一并落在左区 ——
   *   它们都是「让事情发生」的动作；摆进主区或下区就会把「试什么」和「变了什么」再次混排，
   *   而**输入与结果混排正是本页此前难读的根因之一**（PRD §1① 原话）。
   */
  inputZone?: ReactNode;
  /**
   * WO-SANDBOX-CONFIG-UX · **左区顶部的「配置面板」**（扰动因素 × 本体关系**同屏**）。
   *
   * 仓主原话三句：「所有推演的功能都需要借鉴这个设计 UX」（指
   * `docs/REF-config-page-ux.html` 的**配置页 tab**）·「核心是扰动因素输入与本体关系非常清晰，
   * 直接体现」·「按照不同的域的卡片来配置」。落成一句可验收的话就是：
   * **同一屏上左边拨扰动、右边是本体关系（含图），改任一侧另一侧当场变。**
   *
   * ⚠ 它**必须在左区之内**，不是第四个区 —— PRD §1① 的「唯一输入区」不是本单能改的，
   *   而 `sandbox-three-zone.seam.test.tsx` §3 把这条钉成了等号断言（主区/下区的输入控件集合
   *   **等于**白名单）。把带 `<select>` 的配置面板摆去别处，那条断言当场红，且它红得对。
   *
   * ── 传了它，左区就**放宽到整行**（不传 = 今天的 300px 两栏，逐字节不变）──────────
   * 理由不是"宽点好看"：本面板内部自己是两列（扰动 | 本体关系），塞进 300px 会把右列的
   * 关系表 + 图挤成一条缝 —— 那等于没做。故 `.zones` 在有配置面板时改走**上下两行**：
   * 输入区整行在上（内部两列），画布整行在下。画布因此也从 `1fr − 300px` 变成整行，
   * 只会更宽、不会更窄。
   *
   * ⚠ **默认值 = 今天的行为**（与本组件 `scopeBaseIds` 受控/非受控二合一同一条纪律）：
   *   六个不传本 prop 直接挂载本组件的门，走的仍是原来那条路，一个字都不用改。
   */
  configZone?: ReactNode;
  /**
   * WO-SANDBOX-V3 · **③下区内容 = 影响带**（PRD §1③）：逐节点指标影响 ＋ 财务指标随扰动的动态变化。
   *
   * 同样由宿主提供：这两半都要读**推演会话的世界态**（`sessionId` / `world` / `baseSnapshot`），
   * 那些 state 归 `SandboxView` 所有。本组件只提供位置与「这一区回答什么」。
   *
   * ⚠ 本区**只读**：不许出现任何写世界态的控件（判据 PRD §4.4，门在
   *   `sandbox-three-zone.seam.test.tsx` §3 —— 它把主区/下区的输入控件集合与白名单做**等号**
   *   比较，不是 `toContain`：超集上恒真的断言等于没断言）。
   */
  impactZone?: ReactNode;
  /** 画布第四模式「本体拓扑」的内容（旧主屏 PmDag）。不传 → 该模式显示未就绪原因。 */
  ontologyCanvas?: ReactNode;
  /** 右栏可折叠区（决策者用得上的：多场景对比 / AI 指挥台）。 */
  rail?: SandboxConsoleRailSection[];
  /**
   * 诊断抽屉的内容（**建模者 / 开发者 / 调试者**那三档：就绪认证、世界列表、本体派生计数…）。
   * 默认折叠；折叠时**不渲染**内部节点 —— 「默认不占屏」这件事必须是真的，
   * 不是渲染出来再用 CSS 藏起来（藏起来的东西照样进 DOM、照样被读屏念、照样让人以为屏上有）。
   */
  diagnostics?: SandboxConsoleRailSection[];
  /**
   * WO-SANDBOX-IA-CONSOLIDATE · **受控的基地范围**（两个都传才受控，都不传 = 今天的行为，零回归）。
   *
   * 为什么要把这一份 state 提到宿主：沙盘现在是**一屏五模式**（现状/归因/试一手/求最优/影响半径），
   * 而"选中的基地"必须跨模式活着 —— 不然切一次模式清一次范围，这次合并就只是"把五页塞进一个 tab 条"。
   * state 留在本组件里做不到这件事：切模式时本组件整个不渲染（硬约束是**不在 DOM**，不是 hidden）。
   *
   * ⚠ 只提 state，**不动本组件的任何布局**：左栏那些勾选框、它们的 testid、勾选语义
   *   （空数组 = 全部基地）一个字都没变；受控与否只影响 `baseIds` 存在谁的 `useState` 里。
   *   六个不带 Router 直接挂载本组件的门（sandbox-console.seam / sandbox-p0 / …）不传这两个 prop，
   *   走的仍是内部 state 那条路 —— 那正是"默认值 = 今天的行为"的意思。
   */
  scopeBaseIds?: string[];
  onScopeBaseIdsChange?: (next: string[]) => void;
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

/**
 * 下区「全链指标」折叠段 summary 上那个条数。
 *
 * ⚠ 它必须与下面 `<MetricCard>` 的真实条数一致 —— 写错了就是 summary 撒谎。
 *   `sandbox-three-zone.seam.test.tsx` 有一条断言把「summary 上的数」与
 *   「展开后 `sc-metric-*` 的实际个数」做**等号**比较，改一边不改另一边当场红。
 */
const SC_METRIC_COUNT = 6;

// ══════════════════════════════════════════════════════════════════════════════
// 组件
// ══════════════════════════════════════════════════════════════════════════════

export function SandboxConsole({
  topTags,
  banner,
  controlBar,
  inputZone,
  configZone,
  impactZone,
  ontologyCanvas,
  rail = [],
  diagnostics = [],
  scopeBaseIds,
  onScopeBaseIdsChange,
}: SandboxConsoleProps) {
  const [mode, setMode] = useState<CanvasMode>("metro");
  /** 诊断抽屉：**默认关**，且关着时内部一个节点都不渲染（见 `diagnostics` 的注）。 */
  const [diagOpen, setDiagOpen] = useState(false);
  /**
   * WO-R13-ONTOCHAIN-PANEL ③ · 顶栏结论（前置期 · 流动效率）的本体链展开态。
   * 同诊断抽屉的纪律：**默认关，关着时面板一个节点都不渲染**（不是 hidden）。
   */
  const [topChainOpen, setTopChainOpen] = useState(false);
  const openDiagnostics = useCallback(() => setDiagOpen(true), []);
  /** 懒挂载 + 挂了不卸：切模式不重取数、不丢缩放态（设计稿三块 `.cv` 同时在 DOM 里同理）。 */
  const [mounted, setMounted] = useState<Set<CanvasMode>>(() => new Set<CanvasMode>(["metro"]));
  const [loss, setLoss] = useState<ChainLossPayload | null>(null);
  const [imp, setImp] = useState<ImpLoad>({ status: "loading" });
  const [dimKind, setDimKind] = useState<ChainImpedimentKind | null>(null);
  /**
   * 基地范围：**受控/非受控二合一**（WO-SANDBOX-IA-CONSOLIDATE）。
   * 宿主同时给了 `scopeBaseIds` + `onScopeBaseIdsChange` ⇒ 用宿主那一份（跨模式活着）；
   * 否则退回内部 state = 今天的行为（六个直接挂载本组件的门一个字都不用改）。
   * 判据是**两个都给**：只给值不给回调 = 一个点不动的死勾选框，比不受控更糟。
   */
  const [ownBaseIds, setOwnBaseIds] = useState<string[]>([]);
  const controlledScope = scopeBaseIds !== undefined && onScopeBaseIdsChange !== undefined;
  const baseIds = controlledScope ? scopeBaseIds : ownBaseIds;
  /** 写口径统一成「给下一个完整值」——宿主回调没有函数式更新形态，两条路必须同一种签名。 */
  const applyBaseIds = (next: string[]) => {
    if (controlledScope) onScopeBaseIdsChange(next);
    else setOwnBaseIds(next);
  };
  const [honesty, setHonesty] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  /**
   * WO-SANDBOX-PROCESS-MODE · 第五档的选中态。
   *
   * ⚠ **刻意与 `selectedNodeId` 分成两个 state**，不是图省事没合并：
   *   `selectedNodeId` 装的是链路节拍层的 24 个冻结 nodeId（`capacity.schedule` 那种），
   *   本 state 装的是业务流程键（`P01` 那种）。合成一个 `selectedKey` 就等于承认两层同模型 ——
   *   那正是契约 `process.ts` 文件头禁止的事（且两层的检视器吃的入参根本不同）。
   *   两个 state 之间**没有任何互相写入**，切档不互相清空（切回去仍是原来选中的那个）。
   */
  const [selectedProcessKey, setSelectedProcessKey] = useState<string | null>(null);
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

  // ── 在途图层 ⇄ 线路图：叠加盒测量（WO-CONSOLE-CLEANUP ④）─────────────────────
  /**
   * 上一单交付语原文：「今天做到的是两张图坐标系相同、viewBox 相同 —— 叠加时坐标即刻对得上，
   * 无需再改几何」，**没做的是挂载点**（控制台把两者渲染成上下两个兄弟节点）。这里补的就是挂载点。
   *
   * 做法：把在途层那张环 SVG 用 CSS 钉到线路图**舞台 SVG 的同一个屏上矩形**。
   * 两张图 `viewBox` 相同 ⇒ 盒子重合即坐标重合，本文件**不碰任何几何**（`transitOverlayBox`
   * 只做矩形相减与裁切，不算角度/半径/缩放）。舞台自带 translate/scale，而
   * `getBoundingClientRect()` 给的是变换后的矩形，所以缩放平移天然跟随。
   *
   * 测量口径**只认线路图自己发布的 DOM**（`clm-stage` / `clm-canvas` 两个 testid，
   * 外加它已经挂在画布上的 `data-zoom` / `data-pan-x` / `data-pan-y`）——
   * 不 import 它的内部、不改它一行；重新测量的触发源就是那三个属性的变化 + 容器尺寸变化。
   */
  const metroStackRef = useRef<HTMLDivElement | null>(null);
  const [overlay, setOverlay] = useState<TransitOverlayBox | null>(null);
  const overlayActive = transitOn && mode === "metro";
  useEffect(() => {
    const stack = metroStackRef.current;
    if (stack === null || !overlayActive) {
      setOverlay(null);
      return;
    }
    const rectOf = (el: Element): OverlayRect => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    };
    const measure = () => {
      const stageEl = stack.querySelector('[data-testid="clm-stage"]');
      const canvasEl = stack.querySelector('[data-testid="clm-canvas"]');
      if (stageEl === null || canvasEl === null) {
        setOverlay((prev) => (prev === null ? prev : null));
        return;
      }
      const next = transitOverlayBox(rectOf(stack), rectOf(stageEl), rectOf(canvasEl));
      setOverlay((prev) => (sameOverlayBox(prev, next) ? prev : next));
    };
    measure();
    // 画布尺寸变化（分栏/窗口）——jsdom 没有 ResizeObserver，缺了就只测一次，不 polyfill、不假装。
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    ro?.observe(stack);
    // 缩放/平移：线路图把 transform 发布成画布上的三个 data-* 属性，盯着它们即可，无需读它的 state。
    const mo = new MutationObserver(() => measure());
    mo.observe(stack, {
      attributes: true,
      subtree: true,
      childList: true,
      attributeFilter: ["data-zoom", "data-pan-x", "data-pan-y"],
    });
    return () => {
      ro?.disconnect();
      mo.disconnect();
    };
  }, [overlayActive, loss, familyOn]);

  /** 叠加盒 → CSS 自定义属性（几何全在这一处落地，样式表只负责「钉」这个动作）。 */
  const overlayVars = useMemo(() => {
    if (overlay === null || !overlay.measured) return undefined;
    return {
      "--sc-ov-left": `${overlay.left}px`,
      "--sc-ov-top": `${overlay.top}px`,
      "--sc-ov-w": `${overlay.width}px`,
      "--sc-ov-h": `${overlay.height}px`,
      "--sc-ov-ct": `${overlay.clipTop}px`,
      "--sc-ov-cr": `${overlay.clipRight}px`,
      "--sc-ov-cb": `${overlay.clipBottom}px`,
      "--sc-ov-cl": `${overlay.clipLeft}px`,
    } as CSSProperties;
  }, [overlay]);

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
  /** 「在册 / 有数据 / 在册不在场」三态 —— 差额归零之后，屏上真正该说的那句话的唯一出处。 */
  const presence = useMemo(() => chainNodePresence(loss), [loss]);

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
  /** WO-R13 ③ · 顶栏结论的本体链数据（纯派生：`buildTopConclusionChain` 是模块级纯函数，见文件尾）。 */
  const topChain = useMemo(() => buildTopConclusionChain(loss), [loss]);
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

  /**
   * 点灰卡片（诚实缺席节点）：右栏切到「变量输入」页签。
   * 因为这类节点**没有逐环节表可看**（它就是没有环节），能看的是引擎给的缺席原因与探针 ——
   * 那些在 `NodeInspectorView` 的下钻区块里。切「逐环节」会给一张空表，那是把"没有"画成"空"。
   */
  const pickEmptyNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setRailTab("vars");
  }, []);

  /**
   * 点第五档的流程卡 → 右栏出 `ProcessInspectPanel`。
   * **只写 `selectedProcessKey`，一个字都不碰 `selectedNodeId` / `railTab`** ——
   * 两层的选中态互不污染，这就是「同屏不同模型」在代码里的样子。
   */
  const pickProcess = useCallback((processKey: string) => {
    setSelectedProcessKey(processKey);
  }, []);

  const toggleBase = (id: string) =>
    applyBaseIds(baseIds.includes(id) ? baseIds.filter((x) => x !== id) : [...baseIds, id].sort());

  const scopeText = `${baseIds.length === 0 ? "全部基地" : `${baseIds.length} 基地`} · 业务线/产品未接线`;

  /**
   * WO-SANDBOX-DECLUTTER · 诊断抽屉的区块清单 = **宿主给的** ⊕ **本组件自有的调试信息**。
   *
   * 本组件自有的那一档是「调试者」的读物：SEED 种子、时窗为何无 ARGS。
   * 它们此前常驻顶栏，把决策者要看的那三张阻滞点卡挤到了第二眼。
   * **搬家不是删除**：徽标原文一字未改，只是从顶栏移到这里（硬约束①）。
   */
  const diagSections: SandboxConsoleRailSection[] = [
    ...diagnostics,
    {
      id: "debug",
      title: zh.sim.sandbox.diag.debugTitle,
      node: (
        <div data-testid="sc-diag-debug" style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
          <span className={`${styles.tag} ${styles.tagOn}`} data-testid="sc-seed">
            ● SEED {PLACEHOLDER_SEED_DEFAULT} · 确定性（物理拓扑占位值种子）
          </span>
          {/* 徽标只是**记号**；「为什么」那句话的单一出处是顶栏时窗旁的 `?`（`sc-window-note`），
              这里不抄第二份 —— 抄了就是给它开一条会漂的分身。
              原来挂在这上面的 `title=` 属性也去掉了：规范 §2 明令禁止用原生 tooltip 充当浮层
              （OS 绘制 · 恒在最上层 · 移开滞留），而那句话已经在 `?` 里，逐字都在。

              ⚠ WO-SANDBOX-DENSITY 试过把**时窗那排 `disabled` 按钮 + `?`** 也一起搬到这一档
                （它们点不动、永远不会有值，占第一层四个控件位只为讲一句「这里本来该有个东西」，
                而这句话在本档已有徽标 + `?` 两个更便宜的载体）。**没有落地**，理由是
                `sandbox-declutter.test.tsx`「主屏留下的是决策者那一档」那条用例把
                `sc-window-30D/60D/90D` 明确记成「结论式顶栏…时窗档位…留着」——
                那是另一张单**记录在案的产品判断**，不在本单可改范围内（本单只改版面）。
                想拿掉这 4 个控件，得先由该单的所有者改判据，不能由我改它的测试来买。 */}
          <span className={`${styles.badge} ${styles.badgeGap}`} data-testid="sc-window-badge">
            时窗无 ARGS
          </span>
        </div>
      ),
    },
  ];
  /** 抽屉入口上的计数：各区块自报的真待办之和（没有待办时改报「收了几项」，两个都是真数）。 */
  const diagIssueTotal = diagSections.reduce((a, s) => a + (s.issues ?? 0), 0);

  /**
   * WO-SANDBOX-V3 · 下区折叠段 summary 上的**第一层记号**（PRD §2「第一层留什么记号」那一列）。
   *
   * ⚠ 计数**必须与折叠里那份是同一个来源**：`impedimentHandoffs(model, dimKind)` 就是
   *   `JumpList` 内部那一行（`SandboxConsole.tsx` 内 `useMemo(() => impedimentHandoffs(model, kind))`）。
   *   自己在这里另数一遍（比如 `model.total`）会得到**另一个数** —— 那正是本仓
   *   「拿一个看起来相关的数字当判据」的老病：summary 说 7 条、点开是 3 条，谁也不会发现。
   */
  const jumpCount = useMemo(() => impedimentHandoffs(model, dimKind).length, [model, dimKind]);

  return (
    <div className={styles.root} data-testid="sandbox-console" data-mode={mode} data-honesty={honesty ? "1" : "0"} data-diag-open={diagOpen ? "1" : "0"}>
      {/* ══ 治理横幅：**主屏唯一保留的治理信号**（能推演时整条不渲染）══════════ */}
      {banner?.(openDiagnostics)}

      {/* ══ 顶栏 ══════════════════════════════════════════════════════════════ */}
      <div className={styles.top} data-testid="sc-topbar">
        <div className={styles.logo}>
          推演<i>沙盘</i>
        </div>
        <span className={styles.tag} data-testid="sc-scale">
          端到端产销 · 后端 {coverage.backendStageCount} 段 / 本次载荷 {coverage.renderedNodeCount} 节点
        </span>

        {/* 时窗：设计稿有，但两个求解器都没有时间窗入参 ⇒ 禁用 + `?` 说明（不给假旋钮）。
            徽标本体（`sc-window-badge`）搬进诊断抽屉的「调试信息」区 —— 它是调试者的读物；
            决策者在主屏需要知道的只是「这排按钮为什么点不动」，那句话挂在 `?` 上即可。
            ⚠ WO-SANDBOX-DENSITY 想把这一整组也降进抽屉但**没做**，为什么见抽屉那一档的注释。 */}
        <div className={styles.seg} role="group" aria-label="时窗（未接线）">
          {TIME_WINDOWS.map((w) => (
            <button key={w} type="button" disabled aria-pressed={w === "60D"} data-testid={`sc-window-${w}`}>
              {w}
            </button>
          ))}
        </div>
        {honesty ? (
          <InfoPopover topic={zh.sim.sandbox.info.timeWindow} testId="window">
            <TimeWindowNote />
          </InfoPopover>
        ) : null}

        <span className={styles.tag} data-testid="sc-scope">
          {scopeText}
        </span>
        {topTags}
        <div className={styles.spacer} />
        <span className={`${styles.tag} ${styles.tagHot}`} data-testid="sc-leadtime">
          前置期 {fmtDays(totals?.leadTimeDays ?? null)}D · 增值 {fmtFlowEff(totals?.flowEfficiency ?? null)}
        </span>
        {/* WO-R13-ONTOCHAIN-PANEL ③ · 这条结论「凭什么」的本体链开关。
            硬约束①：`type="button"`（主区/下区的输入控件白名单门按等号断言，
            只放行非输入元素；本开关在顶栏，同样只用非提交按钮保持全文件一个纪律）。 */}
        <button
          type="button"
          className={styles.diagBtn}
          data-testid="sc-topchain-toggle"
          aria-expanded={topChainOpen}
          aria-controls="sc-topchain-panel"
          onClick={() => setTopChainOpen((v) => !v)}
        >
          本体链
        </button>
        {/* 诊断抽屉入口：**折叠也必须看得见**，且带真计数（藏起来找不到的抽屉 = 把内容删了） */}
        <button
          type="button"
          className={styles.diagBtn}
          data-testid="sc-diag-toggle"
          aria-expanded={diagOpen}
          aria-controls="sc-diag-panel"
          aria-label={zh.sim.sandbox.diag.entryAria}
          data-issues={String(diagIssueTotal)}
          onClick={() => setDiagOpen((v) => !v)}
        >
          {zh.sim.sandbox.diag.entry} ·{" "}
          <b data-testid="sc-diag-count">
            {diagIssueTotal > 0 ? zh.sim.sandbox.diag.pending(diagIssueTotal) : zh.sim.sandbox.diag.items(diagSections.length)}
          </b>
        </button>
        <div className={styles.seg}>
          <button type="button" aria-pressed={honesty} data-testid="sc-honesty-toggle" onClick={() => setHonesty((v) => !v)}>
            真实性标注
          </button>
        </div>
        {/* WO-SANDBOX-DENSITY · 这里原本还有一颗 `<ThemeToggle />`。**去重，不是降层**：
            外壳顶栏（`pages/ShellLayout.tsx`）已常驻同一颗（同一个组件、同一份 localStorage、
            同一个 `<html data-theme>`），实拍 1440×900 屏上**同时出现两个 🌙**，相距不到 260px。
            判据只有一条：删掉之后这个能力**一次点击仍然到得了**，且入口在每一页都可见 ——
            成立，所以这是重复而非分层。（`theme-mode.test.tsx` 直接渲染 `ThemeToggle` 本体，不经本页。） */}
      </div>

      {/* ══ WO-R13-ONTOCHAIN-PANEL ③ · 顶栏结论的本体链面板（默认关 · 关着时一个节点都不渲染）══
          数据全部来自宿主已取回的那份 chain_loss_attribution 载荷（`loss`）——
          守恒/口径数字屏上已有（下区 Pareto 的 `sc-pareto-note`），这里不复制口径文案。 */}
      {topChainOpen ? (
        <section className={styles.diagPanel} id="sc-topchain-panel" data-testid="sc-topchain-panel">
          <OntologyChainView
            conclusion={`前置期 ${fmtDays(totals?.leadTimeDays ?? null)}D · 增值 ${fmtFlowEff(totals?.flowEfficiency ?? null)}`}
            chain={topChain}
            testId="sc-topchain"
          />
        </section>
      ) : null}

      {/* ══ 诊断抽屉（默认关 · 关着时内部一个节点都不渲染）══════════════════════ */}
      {diagOpen ? (
        <section className={styles.diagPanel} id="sc-diag-panel" data-testid="sc-diag-panel">
          <div className={styles.diagHead}>
            <b>{zh.sim.sandbox.diag.title}</b>
            <span className={styles.note} style={{ margin: 0 }} data-testid="sc-diag-hint">
              {zh.sim.sandbox.diag.hint}
            </span>
            <span className={styles.spacer} />
            <button type="button" className={styles.diagBtn} data-testid="sc-diag-close" onClick={() => setDiagOpen(false)}>
              {zh.sim.sandbox.diag.close}
            </button>
          </div>
          <div className={styles.diagBody}>
            {diagSections.length === 0 ? (
              <p className={styles.note} data-testid="sc-diag-empty">
                {zh.sim.sandbox.diag.empty}
              </p>
            ) : (
              diagSections.map((s) => (
                <details key={s.id} className={styles.railSection} open={s.defaultOpen ?? true} data-testid={`sc-diag-${s.id}`}>
                  <summary>
                    {s.title}
                    {typeof s.issues === "number" && s.issues > 0 ? (
                      <span className={`${styles.badge} ${styles.badgeGap}`} data-testid={`sc-diag-${s.id}-issues`}>
                        {zh.sim.sandbox.diag.pending(s.issues)}
                      </span>
                    ) : null}
                  </summary>
                  <div className={styles.railBody}>{s.node}</div>
                </details>
              ))
            )}
          </div>
        </section>
      ) : null}


      {/* ══════════════════════════════════════════════════════════════════════
          WO-SANDBOX-V3 · **三区骨架**（`docs/PRD-sandbox-v3-three-zone.md` §1）——
          一层只回答一个问题。

            ┌──────────────┬──────────────────────────────┐
            │ ① 左：扰动输入 │ ② 主：业务端到端路线图          │
            │「我要试什么？」│「这条链现在长什么样」            │
            ├──────────────┴──────────────────────────────┤
            │ ③ 下：影响带「试了之后，哪里变了、值多少钱」      │
            └─────────────────────────────────────────────┘

          前三轮（DECLUTTER / UI-INTEGRATE / KPI-LAYER）都在**既有骨架内**做减法：
          收抽屉、收浮层、收折叠。骨架没变 —— 顶栏 KPI ＋ 四张计数卡 ＋ 阻滞点长列表 ＋
          底部三栏，**四块平级铺开，没有一块是"这一屏要回答的那个问题"**。
          形态（铁律 0.6 句式）：
            **「我用『每一块都变小了』当作『这一屏分层了』的证据，而前者并不度量后者。」**
          把四个平级块各自压缩，得到的是四个更小的平级块，不是层级。本轮换骨架。

          ⚠ 搬运纪律（D4 守恒 · PRD §2）：**允许降层，绝不允许删除**。
            下面每一块都只换了**位置与层**，块内 testid 与文案一个字没动 ——
            `sandbox-three-zone.seam.test.tsx` 两向都咬：
            ① 默认**不渲染/不可见**；② 展开后**同一批 testid、同样的文本**全部回来。
          ══════════════════════════════════════════════════════════════════════ */}
      <div className={styles.zones} data-testid="sandbox-zones">
        {/* ── ① 左区：扰动因素输入（**唯一输入区**）──────────────────────── */}
        <aside
          className={configZone ? `${styles.zoneInput} ${styles.zoneFullRow}` : styles.zoneInput}
          data-testid="sandbox-zone-input"
        >
          <div className={styles.zoneHead}>
            <h2>{zh.sim.sandbox.zones.inputTitle}</h2>
            <span className={styles.zoneQ}>{zh.sim.sandbox.zones.inputQuestion}</span>
          </div>

          {/* WO-SANDBOX-CONFIG-UX · 配置面板（扰动 | 本体关系 同屏两列）——
              左区的**第一块**：它就是这一屏要人干的那件事，摆在任何折叠块之前。 */}
          {configZone}

          {/* 扰动输入 —— 这一区的**主角**，左区唯一不折叠的一块（PRD §1①）。 */}
          {inputZone}

          {/* 控制条：推进 tick / 存档 / 分支 / 采纳 ＋ tick 时间轴 ＋ 扰动时间轴。
              它也是**输入**（"让事情发生"），故归左区；PRD §1① 要的「已施加扰动列表
              （可删、可看生效窗口）」就是其中的 `PerturbationTimeline`。 */}
          {controlBar}

          {/* 范围：PRD §2 第 4 行 —— 「它是输入，归左区」，降为折叠段；
              第一层只留**当前范围摘要一行**（`sc-scope-summary`）。
              ⚠ `<details>` 折叠态内容**仍在 DOM**（原生行为）—— 这正是 D4 要的：
                降层 ≠ 删除，`sc-base-*` 十三个复选框一个不少，只是不再占屏。 */}
          <details className={styles.zoneSection} data-testid="sc-scope-details">
            <summary data-testid="sc-scope-summary">
              {zh.sim.sandbox.zones.scopeTitle} · <b data-testid="sc-scope-summary-val">{scopeText}</b>
            </summary>
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
                        {/* WO-SANDBOX-DECLUTTER：这一维「为什么带不下去」的原文（含 service.ts:3125 那句
                            「暂不支持」并报 400）是**原理说明性文字** ⇒ 收进 `?`，原文一字不改地透传。
                            `dim.note` 的单一来源是 `sandboxConsoleModel.SCOPE_DIMENSIONS`，本处不抄第二份。 */}
                        {dim.key === "baseIds" ? null : (
                          <InfoPopover topic={zh.sim.sandbox.info.scopeDim(dim.label)} testId={`dim-${dim.key}`}>
                            <span data-testid={`sc-dim-${dim.key}-note`}>{dim.note}</span>
                          </InfoPopover>
                        )}
                      </div>
                      {/* 基地清单自己滚（`.optList`）：13 个复选框铺开就是 416px，
                          比中栏画布还高 —— 一个筛选器不该是这一屏最高的东西（规范 §1：筛选属第二层）。 */}
                      {dim.key === "baseIds" ? (
                        <div className={styles.optList} data-testid="sc-base-list">
                          {BASE_REGISTRY.map((b) => (
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
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                <div className={styles.dimGroup}>
                  <div className={styles.dimHead}>
                    {/* 「范围能带到哪」「阻滞点图例」两块也是纯说明 ⇒ 各收一个 `?`，
                        标题留在屏上（读者要知道"这里有这么一条说明"），正文按需展开。 */}
                    {honesty ? (
                      <>
                        <b>{zh.sim.sandbox.info.scopeReach}</b>
                        <InfoPopover topic={zh.sim.sandbox.info.scopeReach} testId="scope-reach">
                          <span data-testid="sc-scope-reach">
                            勾选只驱动 <code>chain_impediments</code>（实测 baseIds=changzhou 时 total 15→13）。
                            <b>全链损失归因 chain_loss_attribution 不吃任何范围维度</b> —— 它只认锚点订单{" "}
                            <code>so</code>，传 baseIds 结果逐字节不变（实测）。故底部 Pareto / 前置期 / 链路阶段画布
                            <b>不随左栏变</b>。
                          </span>
                        </InfoPopover>
                      </>
                    ) : null}
                    <span className={styles.spacer} />
                    <b>{zh.sim.sandbox.info.legend}</b>
                    <InfoPopover topic={zh.sim.sandbox.info.legend} testId="legend">
                      <span className={styles.legendList} data-testid="sc-legend">
                        {IMPEDIMENT_CARDS.map((c) => (
                          <span key={c.kind} style={{ display: "block" }}>
                            <b>{c.label}</b>（{c.kind}）· {c.meaning}
                          </span>
                        ))}
                      </span>
                    </InfoPopover>
                  </div>
                </div>
              </div>
            </aside>
          </details>

          {/*
            WO-SANDBOX-DECLUTTER 留下的折叠区（多场景对比 / AI 指挥台 / 企业状态快照 /
            快照分叉比对）—— PRD §2 末两行判的是「**已在折叠区，不动**」，故本单
            **不改它们的层**（仍是默认收起的 `<details>`），只把这一摞整体从右栏挪到左区：
            它们各自都带动作按钮（刷新对比 / 提问 / fork），按「唯一输入区」必须与输入同区。
            `sc-rail-stack` 这个 testid 与它的滚动容器语义一并保留（declutter 门咬着它）。
          */}
          <div className={styles.railStack} data-testid="sc-rail-stack">
            {rail.map((s) => (
              <details key={s.id} className={styles.railSection} open={s.defaultOpen ?? false} data-testid={`sc-rail-${s.id}`}>
                <summary>{s.title}</summary>
                <div className={styles.railBody}>{s.node}</div>
              </details>
            ))}
          </div>
        </aside>

        {/* ── ② 主区：业务端到端路线图（`ChainLineMapView` 提为主画布；物理拓扑 /
               链路阶段 / 本体拓扑降为**主区内的档位**，不再与路线图平级抢位）──────── */}
        <section
          className={configZone ? `${styles.zoneCanvas} ${styles.zoneFullRow}` : styles.zoneCanvas}
          data-testid="sandbox-zone-canvas"
        >
        {/* ── 中：画布（一块画布多模式）─────────────────────────────────────── */}
        <main className={`${styles.pane} ${styles.canvasPaneStretch}`} data-testid="sc-canvas-pane">
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
            {/* 线路图（+ 在途图层 —— **叠在同一块画布上**，不是上下两个兄弟节点）*/}
            <div className={styles.canvasSlot} hidden={mode !== "metro"} data-testid="sc-slot-metro">
              <div
                ref={metroStackRef}
                className={styles.metroStack}
                data-testid="sc-metro-stack"
                data-transit-overlay={overlayActive ? "on" : "off"}
                data-overlay-measured={overlay?.measured === true ? "1" : "0"}
                style={overlayVars}
              >
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
                    。<b>不画三个一样的环冒充三条族线</b> —— 主链那一圈照常。
                  </p>
                ) : null}
                {transitOn ? (
                  <div className={styles.layerPanel} data-testid="sc-transit-layer">
                    {honesty ? <OverlayNote box={overlay} /> : null}
                    {honesty ? <TransitComputabilityLegend /> : null}
                    <TransitFlowView chrome="embedded" />
                  </div>
                ) : null}
              </div>
            </div>

            {/* 物理拓扑 */}
            <div className={styles.canvasSlot} hidden={mode !== "topo"} data-testid="sc-slot-topo">
              {mounted.has("topo") ? <PhysicalTopologyView chrome="embedded" /> : null}
            </div>

            {/* 链路阶段 */}
            <div className={styles.canvasSlot} hidden={mode !== "chain"} data-testid="sc-slot-chain">
              {/* WO-SANDBOX-DECLUTTER（规范 §1）：第一层只留**结论式的三个数**（在册 / 有数据 /
                  算不出来 / 不在场），完整口径与取证进 `?` 浮层。原文一字未改，见 `sc-chain-coverage`。 */}
              {honesty ? (
                <p className={styles.noteWarn} data-testid="sc-chain-coverage-brief">
                  <b>在册 ≠ 有数据：</b>本段在册 {coverage.backendRegistryNodeCount} · 本次有数据{" "}
                  {presence.withSteps.length} · 诚实缺席 {presence.emptyOnly.length} · 在册不在场{" "}
                  {presence.absent.length}
                  <InfoPopover topic={zh.sim.sandbox.info.chainCoverage} testId="chain-coverage">
                    <span data-testid="sc-chain-coverage">
                  <b>诚实边界 · 在册 ≠ 有数据：</b>设计目标 {coverage.designStageCount} 段 {coverage.designNodeCount} 节点
                  （{coverage.designStageNames.join(" / ")}）；后端今天实际有{" "}
                  {coverage.backendStageCount} 段（{coverage.backendStageLabels.join(" / ")}）、
                  在册节点 {coverage.backendRegistryNodeCount} 个 ——
                  <b>
                    差 {coverage.missingStageCount} 段 {coverage.missingNodeCount} 个节点尚未建模
                  </b>
                  。<b>但补齐注册表补不出数据</b>：本次载荷里在册节点只有 {presence.withSteps.length} 个算得出天数，
                  {presence.emptyOnly.length} 个只有诚实缺席行（引擎 <code>empty[]</code> 共 {presence.emptyRowCount} 行：
                  {presence.emptyRowsByKind.map((k) => `${k.kind} ${k.count}`).join(" · ") || "（空）"}），
                  另有 {presence.absent.length} 个<b>在册不在场</b>
                  {presence.absent.length === 0 ? null : (
                    <>（{presence.absent.map((a) => `${a.label}（${a.nodeId}）`).join("、")}）</>
                  )}
                  —— 引擎既不产环节也不产 <code>EMPTY</code> 行，屏上本来完全看不见，本画布把它单列出来。
                  三态在画布上<b>形状分家</b>：实心卡 = 有数据 · 灰卡 = 诚实缺席（缺什么按引擎 <code>reason</code> 原文写在卡上）·
                  单列一行 = 在册不在场。本画布按后端真有的渲染（本次载荷 {coverage.renderedNodeCount} 个节点，其中{" "}
                  {coverage.renderedDynamicOpCount} 个来自动态工序命名空间 <code>capacity.op.*</code>），
                  <b>不拿「在册数」冒充「有数据数」</b>，也不在前端手抄一份 24 节点词表。
                    </span>
                  </InfoPopover>
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
                      {lane.nodes.length === 0 && lane.emptyNodes.length === 0 ? (
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
                                /* 形状标识：有数据 = 实心卡；诚实缺席 = 缺角灰卡（`EmptyNodeCard`）。
                                   两者**不许**只差颜色深浅 —— 判据见 sandbox-console.seam §9。 */
                                data-card-shape="solid-block"
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
                          {/* 诚实缺席节点 = 灰卡片。**与有数据的节点在形状上分家**（见 EmptyNodeCard 注） */}
                          {lane.emptyNodes.map((e) => (
                            <EmptyNodeCard
                              key={e.nodeId}
                              n={e}
                              dimmed={dimKind !== null && !dimStages.has(lane.stage)}
                              pressed={selectedNodeId === e.nodeId}
                              onPick={() => pickEmptyNode(e.nodeId)}
                            />
                          ))}
                        </div>
                      )}
                      {lane.absentNodes.length > 0 ? (
                        <p className={styles.laneAbsentRow} data-testid={`sc-lane-${lane.stage}-absent`}>
                          <b>在册不在场</b>：本段另有 {lane.absentNodes.length} 个节点在在册名单里，
                          但本次载荷<b>既没有环节、也没有 EMPTY 行</b>（引擎一个字都没提它）——
                          {lane.absentNodes.map((a) => `${a.label}（${a.nodeId}）`).join("、")}
                          。屏上单列一行，<b>不当它不存在</b>；它既不是「0 天」也不是「算不出来」，是<b>没进这次输出</b>。
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

            {/* ── 业务流程（WO-SANDBOX-PROCESS-MODE · 第五档）────────────────────────
                **另一个图层，不是把前四档扩了**：自己取数（`GET /a/v1/process-definitions`）、
                自己的选中态（`selectedProcessKey`，与节拍层的 `selectedNodeId` 各归各、互不写入）、
                右栏换成 `ProcessInspectPanel`。契约 `process.ts` 那句「两层不能合并」约束的是
                两个**数据模型**，不是「不能同屏」—— 同屏 ≠ 同模型，判据是两层键集合交集恒为空
                （现算在 `spc-disjoint` 上，SEAM 门咬死）。
                **2026-08-14 实测**：真后端 65 条流程 / mock 11 条，两次 `data-overlap` 均为 `0`；
                复验 `pnpm --filter frontend-shell exec vitest run sandbox-process-mode` 的 §C1，或屏上读该 testid 属性。
                与其余四档同样走 `mounted` 懒挂载：没点进来 = 一次请求都不发。 */}
            <div className={styles.canvasSlot} hidden={mode !== "process"} data-testid="sc-slot-process">
              {mounted.has("process") ? (
                <ProcessCanvasView selectedProcessKey={selectedProcessKey} onPick={pickProcess} honesty={honesty} />
              ) : null}
            </div>
          </div>
        </main>
        {/* ── 右：节点检视 ──────────────────────────────────────────────────
             ⚠ 两层的检视器**不共用**：链路节拍层（前四档）走 `NodeInspectorView` / `StepDetail`，
                业务流程层（第五档）走 `ProcessInspectPanel`。硬塞进同一个检视器才是真的把两层揉了
                —— 它们没有共用的数据结构（一个吃 `nodeId` + 五段耗时，一个吃 `processKey` + 本体关系）。 */}
        <aside className={styles.pane} data-testid="sc-inspect-pane" data-layer={mode === "process" ? "process" : "chain"}>
          {mode === "process" ? (
            <>
              <div className={styles.paneHead}>
                <h2 data-testid="sc-inspect-title">{zh.sim.sandbox.processCanvas.inspectTitle}</h2>
                {selectedProcessKey !== null ? (
                  <span className={styles.tag} data-testid="sc-inspect-process-key">
                    {selectedProcessKey}
                  </span>
                ) : null}
              </div>
              <div className={styles.paneBody}>
                {selectedProcessKey === null ? (
                  <p className={styles.stateLine} data-testid="sc-process-inspect-hint">
                    {zh.sim.sandbox.processCanvas.inspectHint}
                  </p>
                ) : (
                  <ProcessInspectPanel processKey={selectedProcessKey} onClose={() => setSelectedProcessKey(null)} />
                )}
              </div>
            </>
          ) : (
          <>
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
              /*
               * `lossPayload` —— **口径单源那条线补齐的最后一格**（WO-CONSOLE-CLEANUP ①）。
               * 上一单（WO-NODE-SEMANTICS）为了让 R13 下钻证据当天就能上屏，给本面板留了一条
               * **自取一次 `chain_loss_attribution`**（`{}` 无参）的退路，并在屏上明写代价，
               * 因为那个 dev 不许碰本文件、拿不到宿主 state 里的载荷。现在把那一份传下去：
               * 本页的 `chain_loss_attribution` 回到**全页一次**，面板那句文案自动从「本视图自取一次」
               * 翻成「未发第二次请求」（判据在 `node-semantics.seam` §1 与本页 SEAM 门里各咬一次）。
               *
               * `loss ?? undefined` 而不是 `loss`：载荷还没回来（或线路图取数失败）时**必须**退回自取，
               * 否则面板会拿着 `null` 当"宿主已给"，屏上说着"复用宿主那一份"却一格证据都没有 ——
               * 那是把"还没有"画成"已经有"。
               */
              <>
                {honesty ? <InspectorEvidenceGapNote /> : null}
                <NodeInspectorView
                  chrome="embedded"
                  selectedNodeId={selectedNodeId ?? undefined}
                  onNodeIdChange={setSelectedNodeId}
                  lossPayload={loss ?? undefined}
                />
              </>
            )}
          </div>
          </>
          )}
        </aside>
        </section>
      </div>

      {/* ══ ③ 下区：影响带（PRD §1③）════════════════════════════════════════════
          「试了之后，哪里变了、值多少钱」。从粗到细三块：
            汇总条（四个计数 ＋ 流动效率）→ 阻滞点逐条（折叠）→ 逐节点指标影响 ＋ 财务动态。 */}
      <section className={styles.zoneImpact} data-testid="sandbox-zone-impact">
        <div className={styles.zoneHead}>
          <h2>{zh.sim.sandbox.zones.impactTitle}</h2>
          <span className={styles.zoneQ}>{zh.sim.sandbox.zones.impactQuestion}</span>
        </div>

        {/* 汇总条：PRD §2 第 2 行 —— 四个数字**仍在**（testid 一个没动），
            但不再各占一张大卡（`.impBar` 已由四列大卡收成一条紧凑行）。 */}
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

        {/* WO-SANDBOX-V3：整条清单（截图里 7 行）降为**第二层**（PRD §2 第 3 行）。
            第一层记号 = summary 上的**条数** ——「有几条」是结论（第一层），
            「是哪几条」是明细（第二层）。 */}
        <details className={styles.zoneSection} data-testid="sc-impjump-details">
          <summary data-testid="sc-impjump-summary">
            {zh.sim.sandbox.zones.impedimentList} · <b data-testid="sc-impjump-count">{jumpCount}</b>
            {zh.sim.sandbox.zones.rows}
          </summary>
        {/* ══ 阻滞点逐条 · 点了进决策推演（WO-SANDBOX-IMP2PLAN）══════════════════
            WO-SANDBOX-DECLUTTER：口径差 / 联动口径两段**原理说明性文字**此前常驻在这上下两行，
            合计占掉主屏一大块，而它们的读者是开发者不是决策者。现在收成两个 `?`，
            挂在它们解释的那个东西（阻滞点计数）旁边 —— **一个字都没删，只换了承载方式**。 */}
        <ImpedimentJumpBar
          model={model}
          kind={dimKind}
          notes={
            honesty ? (
              <>
                <InfoPopover topic={zh.sim.sandbox.info.impedimentCaliber} testId="imp-gap">
                  <ImpedimentCaliberNote model={model} />
                </InfoPopover>
                <InfoPopover topic={zh.sim.sandbox.info.impedimentJoin} testId="imp-join-gap">
                  <ImpedimentJoinNote dimKind={dimKind} dimStageCount={dimStages.size} />
                </InfoPopover>
              </>
            ) : null
          }
        />
        </details>

        {/* ── 逐节点指标影响 ＋ 财务指标随扰动的动态变化（宿主给 · PRD §1③）── */}
        {impactZone}


        {/* Pareto 与下面那排指标卡 PRD §2 表里没点名，但它们与四张计数卡**同族**
            （都是"全链体检读数"，不是"这一屏要回答的那个数"），按同一判据降为第二层：
            第一层留 summary 上的结论（TopN / 占比 / 几项），明细点开才出。 */}
        <details className={styles.zoneSection} data-testid="sc-pareto-details">
          <summary data-testid="sc-pareto-summary-line">
            {zh.sim.sandbox.zones.pareto} ·{" "}
            <b data-testid="sc-pareto-headline">
              {pareto === null
                ? zh.sim.sandbox.zones.paretoWaiting
                : zh.sim.sandbox.zones.paretoHeadline(pareto.rows.length, pareto.totalRows, fmtPct(pareto.topPct), fmtDays(pareto.nonValueDays))}
            </b>
          </summary>
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
                等线路图把数据取回来（用的是同一份响应的第三种看法，<b>不发第二次请求</b>）。
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
                {/* 规范 §2 R-UI-3 点名的那一类：`A ÷ B` 形状的**公式**一律进 `?`。
                    第一层只留守恒结论（Σ 与是否在容差内）—— 那是结论，不是口径。 */}
                {honesty ? (
                  <p className={styles.note} data-testid="sc-pareto-note-brief">
                    守恒 Σ = {loss?.conservation === undefined ? "—" : `${loss.conservation.sumPct.toFixed(3)}%`}
                    （{loss?.conservation?.ok === true ? "在容差内" : "超容差"}）
                    <InfoPopover topic={zh.sim.sandbox.info.paretoRate} testId="pareto-note" align="right">
                      <span data-testid="sc-pareto-note">
                        影响率 = 该环节非增值天数 ÷ 全链非增值总量，<b>分母由引擎给</b>（
                        <code>chain_loss_attribution.attribution[].pctOfChainLoss</code>）。作业段是增值、不进分母，
                        故全链非增值环节之和恒 100%（本次守恒 Σ ={" "}
                        {loss?.conservation === undefined ? "—" : `${loss.conservation.sumPct.toFixed(3)}%`}
                        ，{loss?.conservation?.ok === true ? "在容差内" : "超容差"}）。前端不重算百分比、不定义分母。
                      </span>
                    </InfoPopover>
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
        </details>

        <details className={styles.zoneSection} data-testid="sc-metrics-details">
          <summary data-testid="sc-metrics-summary">
            {zh.sim.sandbox.zones.metrics} · <b>{zh.sim.sandbox.zones.metricsCount(SC_METRIC_COUNT)}</b>
          </summary>
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
        </details>

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
      </section>
    </div>
  );
}

/**
 * WO-SANDBOX-IMP2PLAN · **沙盘缺的那一跳**：屏上每条阻滞点可点 → 进 `/v/decision-play` 看方案对比。
 *
 * 在此之前四张卡只出**计数**（`sc-imp-BREAK-count` 之流）——「7 条断点」看得见，
 * 「是哪 7 条、点进去能干什么」看不见。本条把 `model.groups[].items` 逐条摊到屏上，
 * 每条是一个真跳转（`deriveImpedimentHandoff` 出 href，派生层单一出处，本组件零自造 query）。
 *
 * ── 为什么分 Router / 非 Router 两个壳（而不是直接 `useNavigate()`）──────────────
 * `useNavigate()` 在 `<Router>` 之外**会抛**（v6 invariant）。而本控制台今天被
 * `sandbox-console.seam` / `sandbox-p0` / `sandbox-view` / `metro-semantics.seam` /
 * `transit-flow.seam` / `sim-scope-local.seam` 六个门**不带 Router** 直接挂载 ——
 * 直接调就是把六个门一起打红（生产链路 App.tsx 里恒有 Router，那是"我这儿没事"的假绿）。
 * 故按 `useInRouterContext()` 分壳：**两壳渲染同一份清单**（同 href、同 testid、同诚实位），
 * 只在"点了之后走不走 SPA 路由"上分家 —— 非 Router 壳退化为普通 `<a href>`（浏览器整页跳，
 * 仍到得了目的地），**不是把这条功能藏起来**（藏起来才是silent hole）。
 */
interface JumpBarProps {
  model: ChainImpedimentModel | null;
  kind: ChainImpedimentKind | null;
  /** 说明性文字的 `?` 触发器（WO-SANDBOX-DECLUTTER）：贴在计数那一行，不另占一整段。 */
  notes?: ReactNode;
}

function ImpedimentJumpBar({ model, kind, notes }: JumpBarProps) {
  const inRouter = useInRouterContext();
  return inRouter ? <RoutedJumpBar model={model} kind={kind} notes={notes} /> : <PlainJumpBar model={model} kind={kind} notes={notes} />;
}

function RoutedJumpBar({ model, kind, notes }: JumpBarProps) {
  const navigate = useNavigate();
  return <JumpList model={model} kind={kind} notes={notes} onOpen={(href) => navigate(href)} />;
}

function PlainJumpBar({ model, kind, notes }: JumpBarProps) {
  return <JumpList model={model} kind={kind} notes={notes} onOpen={null} />;
}

function JumpList({
  model,
  kind,
  notes,
  onOpen,
}: JumpBarProps & {
  onOpen: ((href: string) => void) | null;
}) {
  const rows = useMemo(() => impedimentHandoffs(model, kind), [model, kind]);
  if (model === null) {
    return (
      <p className={styles.stateLine} data-testid="sc-imp-jump-waiting">
        等 <code>chain_impediments</code> 取回后，这里逐条列出可点的阻滞点。
        {notes}
      </p>
    );
  }
  return (
    <div className={styles.impJump} data-testid="sc-imp-jump" data-count={rows.length} data-kind={kind ?? "ALL"}>
      <p className={styles.note} data-testid="sc-imp-jump-head">
        <b>逐条阻滞点 · 点一条进决策推演看方案对比</b>
        {kind === null ? "（当前：全部 " : `（当前只看「${rows[0]?.im.kindLabel ?? kind}」 `}
        {rows.length} 条{kind === null ? "，点上面的卡可筛某一类" : "，再点一次那张卡取消筛选"}）。
        {notes}
      </p>
      <CandidateSummaryLine model={model} />
      {rows.length === 0 ? (
        <p className={styles.note} data-testid="sc-imp-jump-empty">
          本次扫描该类 0 条 —— <b>是「扫到了，没有」</b>，不是「没扫」（扫不出来会在上面报错框里出现）。
        </p>
      ) : null}
      {/*
        WO-SANDBOX-CANDIDATES-FE · 每条阻滞点下面挂它的候选区。
        ⚠ 候选区**必须是 `<a>` 的兄弟节点，不能是子节点**：候选卡里有 `InfoPopover` 的真 `<button>`，
        把可交互元素嵌进 `<a>` 里既是非法 HTML，又会让点浮层变成"点了跳走"。
        原来那个 `<a>` 一个属性都没改（href / testid / onClick / 既有断言全部原样），只是外面多包了一层。
      */}
      {rows.map(({ im, handoff }) => (
        <div key={im.impedimentId} className={styles.impJumpItem} data-testid={`sc-imp-item-${im.impedimentId}`}>
          <a
            className={styles.impJumpRow}
            data-testid={`sc-imp-jump-${im.impedimentId}`}
            data-join={handoff.join.status}
            data-degraded={im.honesty.degraded ? "1" : "0"}
            href={handoff.href}
            title={handoff.join.reason}
            onClick={
              onOpen === null
                ? undefined
                : (e) => {
                    e.preventDefault();
                    onOpen(handoff.href);
                  }
            }
          >
            <b>{im.kindLabel}</b>
            <span className={styles.impJumpLocus}>
              {im.locus.objectType}「{im.locus.label}」
            </span>
            <span className={styles.impJumpMeta}>
              {im.stage} · {im.evidence.ruleKey ?? "规则未知"} · 实测 {im.evidence.metricValue}
              {im.evidence.unit} vs 阈值 {im.evidence.threshold}
              {im.evidence.unit}
            </span>
            {/* ③ 诚实位随行：非 LIVE 的当面标出来，别让用户以为跳过去看到的是确凿结论 */}
            <span
              className={styles.impJumpBadge}
              data-testid={`sc-imp-jump-mode-${im.impedimentId}`}
              data-mode={im.honesty.mode}
            >
              {DATA_MODE_LABEL[im.honesty.mode]}
            </span>
            <span className={styles.impJumpJoin} data-testid={`sc-imp-jump-join-${im.impedimentId}`}>
              {handoff.join.status === "JOINED" ? "已对到因子" : `未对到因子 · 只带 ${handoff.join.carried.join(" / ")}`}
            </span>
          </a>
          {/* WO-R13-ONTOCHAIN-PANEL ② · 每条阻滞点的本体链开关。
              与候选区同一条硬约束：**必须是 `<a>` 的兄弟节点，不许嵌进 `<a>`**
              （按钮嵌进链接里既是非法 HTML，又会把"点开关"变成"点了跳走"）。
              上面那个 `<a>` 的 href / onClick / testid 一个属性都没动。 */}
          <ImpedimentChainLeg im={im} />
          <CandidateBlock im={im} />
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// WO-R13-ONTOCHAIN-PANEL · 结论 ⇐ 本体链（对象 → 边 → 规则/公式 三段）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ② **一条阻滞点的本体链开关 + 弹层**。
 *
 * 三段全部来自 `chain_impediments` 响应（契约 `packages/contracts/src/chain-sim.ts` 的
 * `ChainImpediment`），本组件零编造、零换算：
 *  · 对象 = `locus`（objectType/objectId/label）随行判定依据的实测值
 *    （`evidence.metricValue` + `evidence.unit`，原值原单位，不换算）；
 *  · 边   = `evidence.derivationEdge`（契约里是 optional —— 没下发就传 `null`，
 *    组件渲染诚实缺位，gaps 里写明缺的是哪个字段）；
 *  · 规则 = `evidence.ruleKey` / `ruleParamKey` / `solverKey`；
 *    `ruleKey` 为 null ⇒ 规则段**整体**交组件的诚实位（只给一个求解器名会把
 *    「谁算的依据」冒充成「哪条规则判的」），gaps 写「规则码未下发」。
 *
 * 开关硬约束：`<button type="button">`（主区/下区输入控件白名单门按**等号**断言，
 * `input/select/textarea/button[type=submit]` 之外一律不许出现）。
 */
function ImpedimentChainLeg({ im }: { im: ImpedimentVM }) {
  const [open, setOpen] = useState(false);
  const chain: OntologyChainData = {
    object: {
      type: im.locus.objectType,
      id: im.locus.objectId,
      label: im.locus.label,
      value: im.evidence.metricValue,
      unit: im.evidence.unit,
    },
    edge: im.evidence.derivationEdge,
    rule:
      im.evidence.ruleKey === null
        ? null
        : {
            ruleKey: im.evidence.ruleKey,
            ruleParamKey: im.evidence.ruleParamKey ?? undefined,
            solverKey: im.evidence.solverKey,
          },
    gaps: [
      ...(im.evidence.ruleKey === null ? ["规则码未下发：判定依据里没有规则码，规则段如实缺位（不拿求解器名冒充规则）。"] : []),
      ...(im.evidence.derivationEdge === null ? ["派生边未下发：判定依据里没有派生边字段值，边段如实缺位。"] : []),
    ],
  };
  return (
    <div className={styles.impChain}>
      <button
        type="button"
        className={styles.impChainBtn}
        data-testid={`sc-imp-chain-${im.impedimentId}`}
        aria-expanded={open}
        aria-controls={`sc-imp-chain-panel-${im.impedimentId}`}
        onClick={() => setOpen((v) => !v)}
      >
        本体链
      </button>
      {open ? (
        <div
          className={styles.impChainPanel}
          id={`sc-imp-chain-panel-${im.impedimentId}`}
          data-testid={`sc-imp-chain-panel-${im.impedimentId}`}
        >
          <OntologyChainView
            conclusion={`${im.kindLabel} · ${im.locus.objectType}「${im.locus.label}」`}
            chain={chain}
            testId={`sc-imp-chain-view-${im.impedimentId}`}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * ③ **顶栏结论（前置期 · 流动效率）的本体链数据** —— 模块级纯函数，输入只有宿主那份载荷。
 *
 * 接线判据一句话：**只有响应里真有的字段才接**。
 *  · 对象：锚点订单 = `anchor.so`（响应真有）。类型「Order」取自响应 `anchor.selection`
 *    的原文语义（「锚点订单 = Order 按 so 字典序第一张 …」—— 引擎自己说的），
 *    `anchor.selection` 原文随 gaps 上屏供复核，前端不改写。
 *  · 边：这条结论是**全链聚合**，不经单条派生边 ⇒ `null`。
 *    响应里真有的是 `evidence[].derivationEdge`（WO-R13 ① 补齐 schema 后随宿主载荷到手）——
 *    把它们**去重后逐条列进 gaps**（原值透出，不聚合成一条假边）。
 *  · 规则：只有实际求解器 key（载荷里没有规则码/公式字段）⇒ gaps 写明缺什么。
 *  · 守恒与分母口径屏上已有（下区 `sc-pareto-note`），这里**不复制口径文案**，只互指。
 */
function buildTopConclusionChain(loss: ChainLossPayload | null): OntologyChainData {
  if (loss === null) {
    return {
      object: null,
      edge: null,
      rule: { solverKey: CHAIN_LOSS_SOLVER_KEY },
      gaps: ["载荷未回：这份结论由线路图模式取回后全页共用同一份，到手前对象段与边段如实缺位（不拿占位冒充）。"],
    };
  }
  const gaps: string[] = [];
  const so = loss.anchor?.so;
  if (so === undefined) gaps.push("锚点订单未下发：响应没有锚点字段，对象段如实缺位。");
  if (loss.anchor?.selection !== undefined) gaps.push(`锚点选取口径（响应原文）：${loss.anchor.selection}`);
  const evRows = loss.evidence ?? [];
  if (loss.evidence === undefined) {
    gaps.push("下钻证据未随载荷下发 ⇒ 这条聚合结论实际走过哪些派生边无从列出（不是零条，是没给）。");
  } else {
    const edges = [...new Set(evRows.map((r) => r.derivationEdge))];
    gaps.push(
      `这条结论是全链 ${evRows.length} 个环节的聚合，不经单条派生边 ⇒ 边段如实缺位；` +
        `本次载荷实际走过的派生边共 ${edges.length} 条（原值逐条如下，逐环节的「对象→边→规则」见右栏节点检视的下钻证据）：`,
    );
    for (const e of edges) gaps.push(`派生边：${e === "" ? "（空串 = 锚点自身对象）" : e}`);
  }
  gaps.push("规则码与公式原文未下发：该载荷没有这两个字段，规则段只标算出它的求解器；守恒与分母口径见下区损失构成区的说明。");
  return {
    object: so === undefined ? null : { type: "Order", id: so },
    edge: null,
    rule: { solverKey: CHAIN_LOSS_SOLVER_KEY },
    gaps,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// WO-SANDBOX-CANDIDATES-FE · 阻滞点 → 候选对策（推演沙盘主线的最后一跳）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * **一条候选对策**。第一层只回答四个「是什么」，口径全部降到 `?` 浮层。
 *
 * ── 第一层放什么（`docs/CONVENTION-ui-information-layering.md` §1）────────────
 * 拨哪个对象 · 拨哪个属性 · 从多少拨到多少 · 真试算的效果。**只有数值/状态/名字。**
 * 档位怎么取的（`rungSource`）、join 怎么推的（`join.path`）、试算公式（`provenance.formula`）
 * 都属于「凭什么」⇒ 进浮层。浮层用 `InfoPopover`（规范 §2 的唯一实现），
 * **不用原生 `title=`** —— 那玩意由 OS 绘制、移开会滞留、永远画在最上层，
 * 2026-08-10 `ChainLineMapView` 的 SVG `<title>` 遮挡事故就是它干的。
 *
 * ── 零写死（R14）──────────────────────────────────────────────────────────────
 * 屏上每个数字、每个名字、每条原因都来自本次响应的某个字段：
 * 数值 = `fromValue`/`toValue`/`dims[].value|baseline`；名字 = `lever.*` + 宿主 `locus.label`；
 * 原因 = `rungSource`/`join.path`/`provenance.formula` **原文**。
 * 单位**一个都不在这里判断** —— 按后端下发的 `lever.valueKind` 走 `formatLeverValue`
 * （口径与 `DynamicLeverPanel` 单源同一份），后端没给 `valueKind` 就原样回显、不臆造。
 *
 * ── 为什么原值也要落到 DOM 属性上 ────────────────────────────────────────────
 * 第一层显示的是**格式化后**的值（97.2 → `97%`），而"屏上的数是不是就是响应里的数"
 * 必须能被**字节级**核验。故 `data-from`/`data-to`/`data-dim-*` 一律挂 `String(原值)`，
 * 接缝门直接拿它与回包字段比 —— 格式化层出错时它当场红，不会被"看起来差不多"盖过去。
 */
function CandidateCard({ c }: { c: CandidateVM }) {
  const t = zh.sim.sandbox.candidates;
  return (
    <li
      className={styles.candCard}
      data-testid={`sc-cand-${c.candidateId}`}
      data-effect={c.effect.kind}
      data-rung={c.rung.kind}
      data-join={c.join.kind}
      data-from={String(c.fromValue)}
      data-to={String(c.toValue)}
      data-lever-is-locus={c.leverIsLocus ? "1" : "0"}
    >
      <div className={styles.candHead}>
        {/* ① 拨哪个对象 —— 业务名优先；杠杆不在阻滞点落点上时如实说明只有业务 id */}
        <span className={styles.candLever} data-testid={`sc-cand-lever-${c.candidateId}`}>
          <small>{t.lever}</small>
          <b>
            {c.lever.objectType}「{c.leverName}」
          </b>
          {c.leverIsLocus ? null : (
            <i className={styles.candElsewhere} data-testid={`sc-cand-elsewhere-${c.candidateId}`}>
              {t.leverElsewhere}
            </i>
          )}
        </span>
        {/* ② 拨哪个属性 —— 因子名（业务口径）+ 属性码（本体口径），两个都给 */}
        <span className={styles.candProp} data-testid={`sc-cand-prop-${c.candidateId}`}>
          <small>{t.prop}</small>
          <b>{c.lever.factorName ?? c.lever.prop}</b>
          {c.lever.factorMark !== null ? <i className={styles.candMark}>{c.lever.factorMark}</i> : null}
          <code>
            {c.lever.objectType}.{c.lever.prop}
          </code>
        </span>
        {/* ③ 从多少拨到多少 —— 按 valueKind 格式化；原值随 data-from/data-to 落 DOM 供字节级核验 */}
        <span className={styles.candMove} data-testid={`sc-cand-move-${c.candidateId}`}>
          <small>{t.move}</small>
          <b>
            <span data-testid={`sc-cand-from-${c.candidateId}`}>{c.fromText}</span>
            <em className={styles.candArrow}>{c.direction}</em>
            <span data-testid={`sc-cand-to-${c.candidateId}`}>{c.toText}</span>
          </b>
        </span>
        {/* 诚实位随行：非 LIVE 的当面标出来 */}
        <span className={styles.candMode} data-testid={`sc-cand-mode-${c.candidateId}`} data-mode={c.honesty.mode}>
          {DATA_MODE_LABEL[c.honesty.mode]}
        </span>
      </div>

      {/* ④ 档位来源 + 作用方式：第一层只放**短名**，出处原文进浮层 */}
      <div className={styles.candTags}>
        <span className={styles.candTag} data-testid={`sc-cand-rung-${c.candidateId}`}>
          {t.rung}：<b>{c.rung.label}</b>
        </span>
        <span className={styles.candTag} data-testid={`sc-cand-effect-${c.candidateId}`}>
          {t.effect}：<b>{c.effect.label}</b>
        </span>
        <InfoPopover topic={zh.sim.sandbox.info.candidateHow} testId={`cand-how-${c.candidateId}`}>
          {/* 浮层 = 「凭什么」。四段全部是引擎回包原文 / 契约口径，前端一个字不改写。 */}
          <span className={styles.popSec}>
            <b>{t.rung}（{c.rung.label}）</b>
            <i>{c.rung.why}</i>
            <code data-testid={`sc-cand-rungsrc-${c.candidateId}`}>{c.rung.source}</code>
            <i className={styles.popNote}>{t.rungNote}</i>
          </span>
          <span className={styles.popSec}>
            <b>{t.effect}（{c.effect.label}）</b>
            <i>{c.effect.why}</i>
          </span>
          <span className={styles.popSec}>
            <b>{t.join}（{c.join.label}）</b>
            <i>{c.join.why}</i>
            <code data-testid={`sc-cand-joinpath-${c.candidateId}`}>{c.join.path}</code>
          </span>
          <span className={styles.popSec}>
            <b>试算公式（引擎原文）</b>
            <code data-testid={`sc-cand-formula-${c.candidateId}`}>{c.provenance.formula}</code>
            <i>
              求解器 <code>{c.provenance.solverKey}</code> · 输入 {c.provenance.inputs.join(" / ")}
            </i>
          </span>
          {c.leverIsLocus ? null : (
            <span className={styles.popSec}>
              <b>{t.lever}</b>
              <i>{t.leverIdOnly}</i>
            </span>
          )}
          <span className={styles.popSec}>
            <b>候选 id（可从公开字段反算，单源构造）</b>
            <code>{c.candidateId}</code>
          </span>
        </InfoPopover>
      </div>

      {/* ⑤ 真试算的效果：逐维前后值。`value===null` ⇒ 显示引擎给的原因，**绝不补 0** */}
      <table className={styles.candDims} data-testid={`sc-cand-dims-${c.candidateId}`}>
        <thead>
          <tr>
            <th />
            <th>{t.dimBefore}</th>
            <th>{t.dimAfter}</th>
            <th>{t.dimDelta}</th>
          </tr>
        </thead>
        <tbody>
          {c.dims.map((d) => (
            <tr
              key={d.key}
              data-testid={`sc-cand-dim-${c.candidateId}-${d.key}`}
              data-baseline={d.baseline === null ? "" : String(d.baseline)}
              data-value={d.value === null ? "" : String(d.value)}
              data-moved={d.moved ? "1" : "0"}
            >
              <td className={styles.candDimLabel}>
                {d.label}
                {d.unit === "" ? null : <small> / {d.unit}</small>}
              </td>
              {d.value === null || d.baseline === null ? (
                <td colSpan={3} className={styles.candDimEmpty}>
                  <b>{t.dimEmpty}</b>
                  {/* 引擎给的原因原文（前端不改写、不总结） */}
                  {d.reason === null ? null : <span> —— {d.reason}</span>}
                </td>
              ) : (
                <>
                  <td>{String(d.baseline)}</td>
                  <td>
                    <b>{String(d.value)}</b>
                  </td>
                  <td className={styles.candDelta} data-good={d.improvement > 0 ? "1" : "0"}>
                    {d.improvement > 0 ? "▲" : d.improvement < 0 ? "▼" : "＝"} {String(Math.abs(d.improvement))}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </li>
  );
}

/**
 * **「为什么这个阻滞点没有方案」** —— 本单的诚实位纪律，比候选本身更要紧的一半。
 *
 * ── 为什么这块不许是空白 ──────────────────────────────────────────────────────
 * 引擎注释原话：「**空白比错答更容易被当成没问题**」。生产基线 15 个阻滞点里 **11 个是诚实 NONE**——
 * 这 11 个若渲染成空白，用户读到的是「这些点没问题」，而事实是「查过了，本体上确实没有可拨的杠杆」。
 *
 * ── 三态必须分得开（修法完全相反，混了必修错地方）────────────────────────────
 *  · `NONE`        查过了确实没有 → 该修**数据面**（本体上这个落点没有可拨的杠杆）；
 *  · `UNAVAILABLE` 没算出来（探针耗尽/规则快照缺失）→ **缺答不是答**，该修**算力与接线**；
 *  · `NOT_RUN`     本次压根没跑枚举（回包无该字段）→ 与上面两个都不是一回事。
 * 第四种「请求失败」不在这里 —— 它在取数层的错误框（`sc-imp-error`），本来就分得开。
 * 判据一句话：**「我算过了，没有」「我没算出来」「我没算」是三个不同的命题。**
 *
 * 逐点账（`candidateStats`）一并上屏：探了几个锚点 / 试算几次 / 有效几个 / 下发几条 + `gaps[]` **原文**。
 * 引擎没回带这一行时也如实说「说不出探了几个锚点」，**不编一个数**。
 */
function CandidateAbsenceBlock({ im }: { im: ImpedimentVM }) {
  const t = zh.sim.sandbox.candidates;
  const a = im.absence;
  if (a === null) return null;
  return (
    <div
      className={styles.candNone}
      data-testid={`sc-cand-none-${im.impedimentId}`}
      data-absence={a.kind}
      role="note"
    >
      <div className={styles.candNoneHead}>
        <b className={styles.candNoneTag} data-absence={a.kind}>
          {a.label}
        </b>
        <span className={styles.candNoneTitle}>{t.noneTitle}</span>
        <InfoPopover topic={zh.sim.sandbox.info.candidateNone} testId={`cand-none-${im.impedimentId}`}>
          <span className={styles.popSec}>
            <b>这条断言了什么</b>
            <i>{a.claim}</i>
          </span>
          <span className={styles.popSec}>
            <b>三态为何不许合并</b>
            <i>
              「我算过了，没有」（{CANDIDATE_ABSENCE_LABEL.NONE.label}）· 「我没算出来」（
              {CANDIDATE_ABSENCE_LABEL.UNAVAILABLE.label}）·「我没算」（{CANDIDATE_ABSENCE_LABEL.NOT_RUN.label}）
              是三个不同的命题，修法完全相反 —— 合并成一句「暂无方案」就是静默错答。
            </i>
          </span>
        </InfoPopover>
      </div>

      {/* 这条结论断言了什么（第一层留可见正文，不全塞浮层 —— 诚实位允许降层但不许消失） */}
      <p className={styles.candNoneClaim} data-testid={`sc-cand-none-claim-${im.impedimentId}`}>
        {a.claim}
      </p>

      {/* 引擎写的缺席原因**原文**（前端一个字都不改写） */}
      {a.reason === null ? null : (
        <p className={styles.candNoneReason} data-testid={`sc-cand-none-reason-${im.impedimentId}`}>
          {a.reason}
        </p>
      )}

      {/* 逐点账：探了几个锚点 / 试算几次 / 有效几个 / 下发几条 */}
      {im.stat === null ? (
        <p className={styles.candNoneStat} data-testid={`sc-cand-stat-missing-${im.impedimentId}`}>
          {t.statMissing}
        </p>
      ) : (
        <p
          className={styles.candNoneStat}
          data-testid={`sc-cand-stat-${im.impedimentId}`}
          data-anchors={String(im.stat.anchors)}
          data-probes={String(im.stat.probes)}
          data-effective={String(im.stat.effective)}
          data-emitted={String(im.stat.emitted)}
        >
          {t.statLine(im.stat.anchors, im.stat.probes, im.stat.effective, im.stat.emitted)}
        </p>
      )}

      {/* gaps[] 原文逐条 —— 「缺哪根杠杆 / 缺哪类数据」的唯一可查处 */}
      {im.stat !== null && im.stat.gaps.length > 0 ? (
        <ul className={styles.candGaps} data-testid={`sc-cand-gaps-${im.impedimentId}`}>
          <li className={styles.candGapsHead}>{t.gapsTitle}</li>
          {im.stat.gaps.map((g, i) => (
            <li key={g} data-testid={`sc-cand-gap-${im.impedimentId}-${i}`}>
              {g}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * 候选面的**总账一行**：这次到底算出了多少对策，以及没算出的那些**分别是哪一种**。
 *
 * 三态**逐格分开显示、不合并成一个「没方案」** —— 合并就是本单要堵的那个静默错答。
 * 计数为 0 的格子照样显示（0 也是真数：「本次一条 UNAVAILABLE 都没有」是有信息量的结论，
 * 藏起来会让人以为这一态不存在）。
 */
function CandidateSummaryLine({ model }: { model: ChainImpedimentModel }) {
  const t = zh.sim.sandbox.candidates;
  const s = model.candidateSummary;
  return (
    <p className={styles.candSummary} data-testid="sc-cand-summary" data-total={String(s.totalCandidates)}>
      <b data-testid="sc-cand-summary-have">{t.summary(s.withCandidates, s.totalCandidates)}</b>
      <span className={styles.candSummarySep}>{t.absentSummary}</span>
      {(["NONE", "UNAVAILABLE", "NOT_RUN"] as CandidateAbsenceKind[]).map((k) => (
        <i key={k} className={styles.candSummaryTag} data-absence={k} data-testid={`sc-cand-summary-${k}`}>
          {CANDIDATE_ABSENCE_LABEL[k].label} {s.absent[k]}
        </i>
      ))}
      {s.probes === null ? null : (
        <span className={styles.candSummaryProbes} data-testid="sc-cand-summary-probes">
          {t.probes(s.probes)}
        </span>
      )}
      {s.truncated === true ? (
        <b className={styles.candSummaryTrunc} data-testid="sc-cand-summary-truncated">
          {t.truncated}
        </b>
      ) : null}
    </p>
  );
}

/** 一个阻滞点的候选区：要么逐条摊开候选，要么把「为什么没有」说清。**两者必居其一，绝不留空白。** */
function CandidateBlock({ im }: { im: ImpedimentVM }) {
  const t = zh.sim.sandbox.candidates;
  return (
    <div className={styles.candBlock} data-testid={`sc-cand-block-${im.impedimentId}`} data-count={im.candidates.length}>
      {im.candidates.length > 0 ? (
        <>
          <p className={styles.candHeadLine} data-testid={`sc-cand-head-${im.impedimentId}`}>
            <b>{t.title}</b>
            <span>{t.count(im.candidates.length)}</span>
            {im.stat === null ? null : (
              <i data-testid={`sc-cand-emit-stat-${im.impedimentId}`}>
                {t.statLine(im.stat.anchors, im.stat.probes, im.stat.effective, im.stat.emitted)}
              </i>
            )}
          </p>
          <ul className={styles.candList}>
            {im.candidates.map((c) => (
              <CandidateCard key={c.candidateId} c={c} />
            ))}
          </ul>
        </>
      ) : (
        <CandidateAbsenceBlock im={im} />
      )}
    </div>
  );
}

/**
 * WO-SANDBOX-DECLUTTER · 「口径差」说明 —— **原文一字未改**，只是从常驻段落搬进了 `?` 浮层。
 *
 * 病灶（仓主实测）：这段话此前常驻在阻滞点统计条正下方，占掉主屏一整块，
 * 而它回答的问题（「设计稿说卡点是审批闸，为什么屏上写产能打满？」）是**开发者**的问题。
 * 决策者要看的是那三张卡上的数字。所以它该贴在那些数字旁边、按需展开，而不是常驻。
 *
 * 内容全部派生：措辞差取 `chainImpediment.IMPEDIMENT_DESIGN_GAP`（单一来源），
 * 计数取本次扫描的 `model` —— 本组件零自有文案常数。
 */
function ImpedimentCaliberNote({ model }: { model: ChainImpedimentModel | null }) {
  return (
    <span data-testid="sc-imp-gap">
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
    </span>
  );
}

/**
 * WO-SANDBOX-DECLUTTER · 「联动口径」说明 —— 同上，**原文一字未改**，改的是承载方式。
 *
 * 这条此前只写在 `stagesOfKind` 的注释里（源码看得见、屏上看不见），上一单把它搬上了屏，
 * 但搬成了常驻段落。它是**真实的接缝缺口**（本体 §8 `G-IMPEDIMENT-LOSS-NOJOIN`），
 * 不是实现偷懒：两个求解器没有共同的 id 维度，硬映射会是一个"看着合理"的编造。
 * 段数取 `CHAIN_STAGES.length` 派生（12→24 那一单把段从 4 加到 5，写死的数当天就会过期）。
 */
function ImpedimentJoinNote({ dimKind, dimStageCount }: { dimKind: ChainImpedimentKind | null; dimStageCount: number }) {
  return (
    <span data-testid="sc-imp-join-gap">
      <b>不拿一个看着合理的映射盖过去：</b>
      <code>chain_impediments</code> 的 locus 是<b>对象</b>（<code>MaterialBatch</code> / <code>Line</code> /{" "}
      <code>Process</code>…），而 <code>chain_loss_attribution</code> 的节点是<b>链路节点</b>
      （<code>order.cash</code> 那一族 id）—— 两者今天<b>没有共同的 id 维度</b>，能对上的只有{" "}
      <code>stage</code>。故点统计条只能<b>按 stage 联动高亮</b>（本链路共 {CHAIN_STAGES.length} 段），
      <b>不能按节点精确点亮</b>；同一段里算得出与算不出的节点会被一起点亮，那是段级精度，不是节点级。
      {dimKind === null ? null : (
        <>
          {" "}本次选中的这一类落在 {dimStageCount}/{CHAIN_STAGES.length} 段上。
        </>
      )}
    </span>
  );
}

/** 时窗为何禁用 —— 顶栏那排灰按钮的说明（徽标本体在诊断抽屉，这里是贴在控件旁的那一句）。 */
function TimeWindowNote() {
  return (
    <span data-testid="sc-window-note">
      这两条取数一条只认锚点订单、一条只认范围，<b>都不接受时间窗</b> ⇒ 这排档位今天<b>驱动不了任何取数</b>，
      故禁用而不是给一个点得动、却什么都不改的假旋钮。
    </span>
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

/**
 * WO-CONSOLE-CLEANUP ① 的代价说明 —— **2026-08-18 已由 WO-R13-ONTOCHAIN-PANEL ① 闭环**。
 *
 * ── 这笔账的来龙去脉（旧账原文见 git 历史，这里只留结论）─────────────────────
 * 旧事实：宿主手里那份载荷经 `chainLineMap.ts` 的 `ChainLossPayloadSchema` 解析，
 * 而那个 schema 当时**没有声明 `evidence[]`** ⇒ zod strip 语义把下钻证据当场剥掉，
 * 面板那句「本节点没有下钻证据」说的是宿主这一份缺字段，不是引擎没给。
 *
 * 新事实（本单改的）：`ChainLossPayloadSchema` 已补上 `evidence[]`（行 schema 复用
 * `inspectorModel.ts` 已导出的那一份）。宿主注入的 `lossPayload` 因此**带着证据**到达
 * `InspectorNodePanel` —— 该面板本就用声明了 evidence 的读取层
 * （`NodeSemanticPayloadSchema`）解析注入载荷，故控制台里的下钻证据与独立页
 * `/v/node-inspector` 自取的**同一份来源**，两边说的是同一件事。
 * （面板本体由另一张单在改，本文件只改这段注释/文案；传参一行没动。）
 *
 * ⚠ 接缝门联动：`sandbox-console.seam.test.tsx` §9① 那两条断言（「schema 确实剥掉
 *   evidence」+ 屏上旧文案）是它自己的注释明写的**到期绊线**，本单落地后当场红 ——
 *   红得对；同单集成时已按绊线注释的设计翻转成咬「带着走 + 屏上『已接通』」。
 *
 * 屏上这块保留（不是删除）：它现在说的是「证据已接通」这件**新**事实 ——
 * 从「缺字段」翻到「已接通」若没有一句话在屏上交代，老用户会以为面板换了数据源。
 */
function InspectorEvidenceGapNote() {
  return (
    // WO-SANDBOX-DECLUTTER（规范 §1「诚实位可降层、不可删，且第一层要留记号」）：
    // 第一层只留一句**结论**（下钻证据已随宿主这一份接通），完整来龙去脉进 `?`。
    <p className={styles.noteWarn} data-testid="sc-inspect-evidence-gap-brief">
      <b>下钻证据已接通 —— 宿主这一份载荷现在带着它传给右栏。</b>
      <InfoPopover topic={zh.sim.sandbox.info.inspectorEvidence} testId="inspect-evidence" align="right">
        <span data-testid="sc-inspect-evidence-gap">
      <b>本栏复用控制台已经取回的那一份数据（不再自取第二次）。</b>
      此前控制台这一份在解析时会把「下钻证据」字段丢掉，这里只能标注「缺字段、不是引擎没给」；
      现在解析层已把这个字段补回来，宿主这一份<b>原样带着它</b>传给右栏 ——
      控制台里的下钻证据与独立的节点检视页（自取原始数据）<b>同一份来源</b>，两边说的是同一件事。
      诚实缺席行自始至终原样都在。
        </span>
      </InfoPopover>
    </p>
  );
}

/**
 * WO-CONSOLE-CLEANUP ② · **诚实缺席节点 = 灰卡片**（不是段尾一行小字）。
 *
 * ── 为什么必须是卡，且必须与有数据的卡**形状不同** ──────────────────────────────
 * 注册表 12→24 之后新增的 12 个里 10 个是 `NO_CARRIER`（`PRD-chain-24nodes.md` §3 逐个取证）。
 * 在此之前它们在画布上被折成段尾一行文字，于是「这一段有几个节点」读起来就是「有几个能算的」——
 * **「在册」与「有数据」被画成了同一件事**。卡形让"这里有一个节点"与有数据的节点同级可见。
 *
 * 而形状必须分家、**不许只靠颜色深浅**：深浅会被读成"同一种东西弱一点"，
 * 但这两者是「有承载物 / 没有承载物」两种**事实**，不是强弱两档。
 * 判据落在两处，一处漂了另一处会当场红：
 *   · `data-card-shape` —— 实心卡 `solid-block` vs 缺角卡 `notched-tag`（DOM 层，测试直接咬）；
 *   · `.emptyCard` 的 `clip-path`（几何层：真把右上角切掉，`.nodeCard` 没有这条声明）。
 * 缺什么，按引擎 `empty[].reason` **原文透传**（前端一个字都不改写、不总结、不补 0）。
 */
function EmptyNodeCard({
  n,
  dimmed,
  pressed,
  onPick,
}: {
  n: EmptyNodeCardVM;
  dimmed: boolean;
  pressed: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.emptyCard}${dimmed ? ` ${styles.dimmed}` : ""}`}
      data-card-shape="notched-tag"
      data-testid={`sc-empty-node-${n.nodeId}`}
      data-empty-kinds={n.kinds.join(",")}
      data-row-count={n.rows.length}
      aria-pressed={pressed}
      onClick={onPick}
    >
      <span className={styles.emptyCardTop}>
        <span className={styles.emptyCardName} title={`${n.label}（${n.nodeId}）`}>
          {n.label}
        </span>
        <span className={styles.emptyCardKind}>EMPTY</span>
      </span>
      <span className={styles.emptyCardFoot}>
        算不出来 · <b>未补 0</b> · {n.rows.length} 条缺席行 · {n.kinds.join(" / ")}
      </span>
      {n.rows.map((r) => (
        <span key={r.stepId} className={styles.emptyCardRow} data-testid={`sc-empty-row-${r.stepId}`} data-empty-kind={r.emptyKind}>
          <b>
            {r.label} · {r.emptyKind}
          </b>
          {/* reason / probe 逐字透传引擎原文 —— 前端不改写、不截断、不概括 */}
          <em>{r.reason}</em>
          {r.probe === undefined ? null : <code>探针：{r.probe}</code>}
        </span>
      ))}
    </button>
  );
}

/**
 * WO-CONSOLE-CLEANUP ④ · 叠加的**当面说明**。
 *
 * 只说本单新变成真的那一件事（图层钉在了线路图舞台的同一个盒子上），
 * 以及测量不到时照实标出来。**不复述**在途层自己那两句常驻诚实位
 * （「几何与线路图同源」/「同角度不代表同一个实体」）—— 那两句的单一出处在 `TransitFlowLayer`，
 * 在这里抄第二遍就是给它开一条会漂的分身。
 */
function OverlayNote({ box }: { box: TransitOverlayBox | null }) {
  const measured = box !== null && box.measured;
  return (
    <p className={styles.note} data-testid="sc-transit-overlay-note" data-measured={measured ? "1" : "0"}>
      <b>在途批次图层已叠在线路图这块画布上</b>（不再是上下两张图）：图层那张环 SVG 被钉到线路图舞台
      <b>同一个屏上矩形</b>，两图 <code>viewBox</code> 相同 ⇒ 同一坐标即同一屏点，
      本页<b>不重算任何几何</b>（缩放/平移跟着线路图走）。
      {measured ? (
        <>
          {" "}实测叠加盒 {Math.round(box.width)}×{Math.round(box.height)}px。
        </>
      ) : (
        <>
          {" "}⚠ <b>画布尺寸不可测</b>（未布局 / 隐藏 / 非浏览器环境）⇒ 本次<b>没有叠加</b>，图层按常规块排在下方 ——
          不假装"已对齐"。
        </>
      )}
    </p>
  );
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
        {/*
          * ④⑤ 两档**只报档名，不复述状态**（WO-STALE-CLAIMS）。
          *
          * 病灶原文：这两行渲染的是 `CADENCE_ABSENCE.reason` / `PROCUREMENT_BRANCH.reason` ——
          * 也就是 `deriveXxx()` **不带任何入参**那一档（`transitFlow.ts:495-496` 的零输入基线，
          * 恒为 `NOT_FETCHED`，文案「本层没去取」）。WO-TRANSIT-WIRE 之后这句话已经不成立：
          * 紧挨着本图例渲染的 `<TransitFlowView>`（下一行）**自己发四条 `searchObjects`**
          * （`Cadence` / `PurchaseOrder` / `CustomsClearance` / `IncomingInspection`）并每次渲染现调
          * `deriveCadenceAbsence({ engineNodes, cadenceRows })`。于是屏上同框出现两句互相打脸的话：
          * 图例说"没人去取"，它下面的图层正在取。**自称实测的过期声明**（本体 §8 `G-STALE-MEASURED-CLAIM`）
          * 的又一形态 —— 这次不是上游变了，是**同一屏里的邻居**变了。
          *
          * 为什么是"删状态"而不是"改成现算"：本图例**自己不取数**，改调 `deriveXxx()` 拿到的
          * 依然是同一个零输入基线 —— 换个写法说同一句假话。真正有资格说"现在有没有"的只有取数的那一方。
          * 而这块的职责本来就只是**静态可算性分级**（①②③ 全部派生自 `TRANSIT_SOURCE_SPECS` 的字段规格），
          * "这一刻取回了什么"是运行态状态，根本不属于这里 —— 混进来才是当初出错的根。
          *
          * 为什么不整块删掉这两个 `<li>`：④⑤ 是分级表的一部分（读者需要知道这两档存在且**不画**），
          * 且 `transitFlow.ts:486-490` 明写着这两个导出保留的理由就是本图例还在引用它们
          * （本单范围边界不许改那个文件）—— 全删会让那段注释当场变成新的过期声明，
          * 等于用一个同族病灶去换另一个。故只读 `.label`：它在 `deriveXxx()` 的**四个分支里恒等**
          * （`base = { key, label, probe }`），与"这次取回了什么"无关，**不带保质期**。
          */}
        <li data-testid="sc-transit-tier-cadence" data-mode="deferred">
          <b>④ {CADENCE_ABSENCE.label}</b>
          <span className={styles.tierGlyph}>⇒ 不画任何「这里有节拍」的假象；有闸门时由图层出实况块</span>
          <em data-testid="sc-transit-reason-cadence">
            本档<b>现时状态由下方图层现算并自陈</b>，本图例不复述 ——
            图例自己不取数，复述出来的只会是"零输入"那一档，与屏上正在发生的事无关。
          </em>
        </li>
        <li data-testid="sc-transit-tier-procurement" data-mode="deferred">
          <b>⑤ {PROCUREMENT_BRANCH.label}</b>
          <span className={styles.tierGlyph}>⇒ 画不出来就说画不出来（空 + 逐条取证）</span>
          <em data-testid="sc-transit-reason-procurement">
            同上：四段腿（口径取自契约那份唯一定义）的现时可画性由下方图层现算并自陈，
            本图例只给档名与画法。
          </em>
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

      {/* 表的**口径**（天数取哪个字段、分母是什么）是浮层内容；表本身才是第一/二层。 */}
      {honesty ? (
        <p className={styles.note} data-testid="sc-step-detail-note-brief">
          本表口径
          <InfoPopover topic={zh.sim.sandbox.info.stepTable} testId="step-detail" align="right">
            <span data-testid="sc-step-detail-note">
              天数取引擎 <code>ChainStep.days</code>（期望态）；影响率取 <code>attribution[].pctOfChainLoss</code>，
              分母 = 全链非增值总量（增值段不进分母，故增值行影响率显示「—」而非 0）。
              <b>本表与画布卡片、底部 Pareto 是同一份响应的三种投影</b>，不是三次取数。
            </span>
          </InfoPopover>
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
