import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPropagationRules, fetchSimPerturbations } from "@/api/endpoints";
import { InfoPopover } from "@/components/InfoPopover";
import {
  buildRelationGraph,
  downstreamReach,
  focusSubgraph,
  RELATION_FORMULA_PROVENANCE,
  RELATION_FORMULA_PROVENANCE_DETAIL,
  type RelationEdgeVM,
  type RelationGraphVM,
  type RelationNodeVM,
} from "./sandboxRelationGraph";
import css from "./SandboxConfigPanel.module.css";

/**
 * ══ WO-SANDBOX-CONFIG-UX · **扰动因素 × 本体关系 同屏配置面板**（共享件）══
 *
 * 仓主指定的两份参照物（`docs/REF-config-page-ux.html` 的**配置页 tab** ＋
 * `docs/REF-ontology-twin-ux.html` 的**本体关系语义分层**）合起来只说了一件事：
 *
 *   > **同一屏上：左边拨扰动因素，右边是本体关系（含图），改任一侧另一侧当场变。**
 *
 * 改前我们两侧都有，但**不同屏**：扰动表单在左区一等位置（`SandboxView.tsx` 的
 * `sandbox-input-zone-body`），而本体关系分散在两处 ——
 *   · 传导边开关 `EdgeActivePanel` 被塞在 `controlBar` 里，跟着 tick 控制条一起挤进 **300px 宽的左栏**；
 *   · 传导规则逐条清单 `sandbox-propagation-list` 更深，在左栏折叠区「本体派生」那一格里
 *     （`<details>` 且 `defaultOpen` 未设 ⇒ **默认收起**）。
 * 于是「拨一下 → 看关系怎么变」这个动作在屏上根本连不起来：一边在表单里，一边要先展开一个抽屉。
 *
 * ── 两种分域机制并存，判据是「表单形态是否同构」（参照物左右两栏各示范一种）──────
 *  · **异构 ⇒ 各占一张卡片、同时可见**（参照物左栏三张卡：表格 / 角色卡+时间格 / 简表，
 *    形状互不相同，压成 chip 切片会逼用户为了看另一类而离开这一类）；
 *  · **同构 ⇒ chip 切片，点一个只看一类**（参照物右栏 36 个原生量，形状全相同，
 *    一次全倒才是灾难）。
 * ⇒ 我们的 **35 条传导规则是同构的**（每条都是"源.量纲 →系数/延迟→ 目标.量纲 + 一个开关"），
 *   `EdgeActivePanel` 现有的 chip 切片**是对的，本单一个字不改**，整块作为 `relationTable`
 *   传进来；本组件只负责**给它一个够宽的位置**并在它下面**接上图**。
 * ⇒ 扰动输入侧形态不同的几类**各占一卡**（`inputCards`），由宿主决定有哪几卡 ——
 *   本组件**不知道**卡里是什么（R14：落点候选、量纲名、基地清单全是租户本体派生，不进共享件）。
 *
 * ── ⛔ 不许照抄参照物的数字 ─────────────────────────────────────────────────
 * 参照物把 36 个原生量压成 9 类。**我们不是 9**：本仓 35 条传导边由后端 `resolveRuleDomain`
 * 现算出 **9 个业务域 + 1 个未归域 = 10 片，每片 2–7 行**（今日实测分布见交单报告）。
 * 数字接近是巧合；依据是**我们自己的域登记册**，不是抄来的阈值。
 *
 * ── 图为什么裁成「焦点的下游」而不是画全图 ───────────────────────────────────
 * 40 个量纲 / 35 条边全画出来是一张读不完的网。而用户此刻在问的是
 * 「**我正要拨的这个东西**会波及什么」—— 所以图的焦点 = **扰动落点**（宿主传 `focusNodeKey`），
 * 画它的下游子图。这同时把「双向联动」的两个方向都接上了：
 *   ① 左边换落点/换量纲 ⇒ 右边图**当场换一张**（子图不同）；
 *   ② 右边关掉一条边   ⇒ 可达集变小 ⇒ 图**当场少一层/少一支**，下游读数跟着变。
 *
 * ⚠ 焦点量纲**不在任何传导规则上**时，本组件明说「扰动它不会沿本体链路扩散」而不是画个空图 ——
 *   空图与"图没加载出来"在屏上长得一模一样，那是本仓反复治的静默错答形态。
 *
 * ══ WO-SANDBOX-CONFIG-COLLAPSE（2026-08-17 追加，**上文一个字未改**）══════════════
 *
 * 上一张单做对了「同屏」，但**代价是画布（地铁图）与 tick 控制条整体被挤到折线以下**：
 * 真浏览器实测（`check-layout-legibility.mjs`），改前主画布区顶边
 * **1440×900 → top=1453px · 1280×800 → top=1472px**，要滚半屏多才看得见第一个像素。
 * 仓主裁决：**配置面板默认收起成一条，点开才展开；地铁图留在首屏当主角。**
 * ⇒ 本单**不推翻上文任何内容**（关系图 / 算式清单 / 双向联动 / 原生量派生量全部保留），
 *   只改**默认展开态**与**它在首屏的占位**。
 *
 * ── 折叠为什么只能用行内 `display`（三条路两条是坑，邻单 WO-SANDBOX-DENSITY 已实测）──
 *  · `<details>/<summary>` ⛔ —— Chromium 141 实测：闭合 `<details>` 的子节点
 *    `getBoundingClientRect()` **仍返回非零旧矩形**，版面门的 `visible()` 照数
 *    ⇒ 折了等于没折，门上一个控件都不少（取证记在 `layout-legibility-baseline.json` 的 `why` 里）。
 *  · **条件渲染**（不满足就不 render）⛔ —— 会把别的单已落地的 `getByTestId(...)` 再点击的
 *    断言全打红（`sandbox-config-ux.seam.test.tsx` 有 15 例是这个形态）。
 *    且它顶了本仓 D4 守恒：**允许降层，不允许删除** —— 折叠不是删除，内容仍须在 DOM 里。
 *  · **CSS module 类名** ⛔ —— vitest 配置 `css:false` ⇒ 类名在 jsdom 里量不到，
 *    本单自己的判据就成了摆设（`SandboxView.tsx` 的 `sandbox-more-actions` 记着同一条）。
 *  · **行内 `style={{display}}`** ✅ —— 唯一同时满足「门数得对」「别人的断言不红」「自己测得到」。
 *
 * ── 横幅上的三个数**一律现算，不许写死**（本仓专治「手抄名单」：名单里没有的永远绿、永远漏）──
 *   已施加 N ← `["a","sim-perturbations", sessionId]`（**与 `PerturbationTimeline` 同一个
 *     queryKey 同一支 queryFn** ⇒ 零额外请求、零新增 mock 面，且施加/撤销后宿主一失效它就跟着变）；
 *   传导边 M / 启用 K ← `buildRelationGraph(rules, disabledRuleKeys)` 的 `edges.length` /
 *     `activeEdgeCount`，与图上那两个数**同一个来源**（各算一份迟早对不上）。
 */

// ══════════════════════════════════════════════════════════════════════════════
// § 版面常数（**尺寸**，不是业务阈值 —— 换租户不变）
// ══════════════════════════════════════════════════════════════════════════════

/** 图上一个量纲盒的宽/高，以及层间/行间距。SVG 视口按节点分布现算，不写死画布尺寸。 */
const NODE_W = 158;
const NODE_H = 34;
const COL_GAP = 56;
const ROW_GAP = 12;
/** 图内文字**不低于 12px**（本仓字号硬底：`check-text-legibility` 的 `FLOOR_PX` ＋ `layout-legibility:check` 真浏览器实测同一档）。 */
const GRAPH_FS = 12;

// ══════════════════════════════════════════════════════════════════════════════
// § Props
// ══════════════════════════════════════════════════════════════════════════════

/** 左列的一张扰动输入卡。**一卡 = 一种形态**（异构才分卡，见文件头判据）。 */
export interface SandboxConfigCard {
  /** 稳定 id（testid 后缀）。 */
  id: string;
  title: string;
  /** 一句「这一卡填什么」。参照物每张卡都有这一行，缺了卡就只是个容器。 */
  hint: string;
  node: ReactNode;
}

export interface SandboxConfigPanelProps {
  /** 左列：扰动因素输入，异构各占一卡。 */
  inputCards: SandboxConfigCard[];
  /**
   * 右列上半：本体关系**表**。宿主传 `EdgeActivePanel`（chip 切片 + 开关 + 差值表）——
   * 本组件不重画一份表：重画就是第二套真相源，两处开关状态迟早对不上。
   */
  relationTable: ReactNode;
  /**
   * 图的焦点量纲键（`类型键.状态变量`，用 `relationNodeKey` 拼）= **当前扰动落点**。
   * `null` ⇒ 不裁，画全图（并在屏上说明这是全图，免得被当成"焦点子图恰好很大"）。
   */
  focusNodeKey: string | null;
  /**
   * 本次推演**关掉**的传导边（会话级反事实 `SimSession.disabledRuleKeys`）。
   *
   * ⚠ 单一真相源是**会话**，不是 `EdgeActivePanel` 的内部候选集 —— 后者是"用户还在试"的中间态，
   *   该组件自己的注释写着「试的过程不该改会话」。图画的是**这个世界**，不是试到一半的假设；
   *   拿未落盘的候选集画图，屏上就会出现一个数据库里并不存在的世界。
   *   （代价诚实写在交单报告：拨开关到图重画之间隔着一次「应用到本会话」。）
   */
  disabledRuleKeys: readonly string[];
  /**
   * 推演会话 id —— **只用来现算横幅上那个「已施加 N 条」**（与 `PerturbationTimeline` 共用缓存）。
   * `null` ⇒ 还没会话，横幅上那一格显示 `—` 而不是 `0`：
   * 「还没有会话」与「有会话但一条都没施加」是两件事，写成同一个 `0` 就是静默错答。
   */
  sessionId?: string | null;
  /**
   * 折叠态（**受控**，宿主持有）。默认 `false` = 收起成一条横幅。
   *
   * ⚠ 为什么不放本组件内部 `useState`：`SandboxConsole` 的**分栏方式**要跟着它变
   *   （展开 = 上下两行给面板让宽 · 收起 = 回到 `300px | 1fr`，画布因此回到第一屏）。
   *   state 藏在本组件里，那边就读不到，只能再存一份 —— 两份状态迟早对不上。
   *
   * ⚠ 不传 ⇒ **恒展开且不出横幅**（= 上一张单的行为，逐字节不变）。
   *   §4 变异反证那两例直接挂载本组件、不传这两个 prop，一个字都不用改。
   */
  open?: boolean;
  onToggle?: () => void;
}

// ══════════════════════════════════════════════════════════════════════════════
// § 组件
// ══════════════════════════════════════════════════════════════════════════════

export default function SandboxConfigPanel({
  inputCards,
  relationTable,
  focusNodeKey,
  disabledRuleKeys,
  sessionId = null,
  open,
  onToggle,
}: SandboxConfigPanelProps) {
  /** 不受控（宿主没传 `open`）⇒ 恒展开、不出横幅 = 上一张单的行为。 */
  const collapsible = open !== undefined;
  const expanded = open ?? true;
  /**
   * **与 `EdgeActivePanel` 共用同一个 queryKey 与同一支 queryFn** ⇒ 零额外请求、零新增 mock 面。
   * （那个组件的文件头记着一次实测教训：给共享面板加一个新 endpoint 依赖，会把全仓 29 个
   * 对 `@/api/endpoints` 做部分 mock 的测试文件一起打红。共用现成的这条路没有这个代价。）
   */
  const rulesQuery = useQuery({
    queryKey: ["a", "sim-propagation-rules"],
    queryFn: () => fetchPropagationRules(true),
    staleTime: 60_000,
  });
  const rules = useMemo(() => rulesQuery.data?.items ?? [], [rulesQuery.data]);

  /** 类型人话名随边下发（读时投影），与 `EdgeActivePanel` 同一份口径，不另取一次本体。 */
  const typeDisplayNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rules) {
      if (r.sourceTypeName) m.set(r.sourceTypeKey, r.sourceTypeName);
      if (r.targetTypeName) m.set(r.targetTypeKey, r.targetTypeName);
    }
    return m;
  }, [rules]);

  /**
   * 横幅上的「已施加 N 条」—— **与 `PerturbationTimeline` 同 key 同 fn**（共享缓存）。
   * 宿主在施加/撤销后 `invalidateQueries(["a","sim-perturbations", sessionId])`
   * （`SandboxView.tsx` 两处），故这个数**会跟着真实数据变**，不是渲染时抄下来的快照。
   */
  const perturbationsQuery = useQuery({
    queryKey: ["a", "sim-perturbations", sessionId ?? ""],
    queryFn: () => fetchSimPerturbations(sessionId as string),
    enabled: collapsible && !!sessionId,
    staleTime: 5_000,
  });

  const full = useMemo(() => buildRelationGraph(rules, disabledRuleKeys, typeDisplayNames), [rules, disabledRuleKeys, typeDisplayNames]);
  const reach = useMemo(() => (focusNodeKey ? downstreamReach(full, focusNodeKey) : null), [full, focusNodeKey]);
  const shown = useMemo(() => (focusNodeKey ? focusSubgraph(full, focusNodeKey) : full), [full, focusNodeKey]);
  /** 焦点在本体里、但没有任何传导规则碰它 —— 必须明说（见文件头）。 */
  const focusOffGraph = focusNodeKey !== null && reach !== null && !reach.found;

  /**
   * 横幅上的三个数 —— **全部现算**（写死一个，新增一条扰动/一条边它就开始撒谎）。
   *
   * ⚠ 加载态显式说「…」而不是先显示 0：0 是一个**有意义的答案**（"一条都没有"），
   *   拿它当"还不知道"用，就是本仓反复治的静默错答形态。
   */
  const appliedCount = sessionId ? (perturbationsQuery.isPending ? null : perturbationsQuery.data?.items.length ?? 0) : null;
  const edgeCount = rulesQuery.isLoading ? null : full.edges.length;
  const activeEdgeCount = rulesQuery.isLoading ? null : full.activeEdgeCount;
  const num = (v: number | null) => (v === null ? "—" : String(v));

  const panel = (
    <div
      className={css.cfg}
      data-testid="sandbox-config-panel"
      id="sandbox-config-body"
      /**
       * ⛔ 折叠**只能**走行内 `display`，三条替代路都实测过是坑（见文件头 WO-…-COLLAPSE 那段）。
       * ⚠ 展开值必须写 `grid` 而不是留空/`block`：`.cfg` 本身就是两列 grid，
       *   写成 `block` 会把「同屏两列」这件事在展开态悄悄拆掉（上一张单的验收判据当场失效）。
       */
      style={collapsible ? { display: expanded ? "grid" : "none" } : undefined}
    >
      {/* ── 左列：扰动因素输入（异构各占一卡，同时可见）──────────────────────── */}
      <div className={css.col} data-testid="sandbox-config-input-col">
        <div className={css.colHead}>
          <h3>扰动因素</h3>
          <span className={css.colQ}>我要改哪个量、改多少</span>
        </div>
        {inputCards.map((c) => (
          <section key={c.id} className={css.card} data-testid={`sandbox-config-card-${c.id}`}>
            <h4 className={css.cardTitle}>{c.title}</h4>
            <p className={css.cardHint}>{c.hint}</p>
            <div className={css.cardBody}>{c.node}</div>
          </section>
        ))}
      </div>

      {/* ── 右列：本体关系（表 + 图**同卡片**）───────────────────────────────── */}
      <div className={css.col} data-testid="sandbox-config-relation-col">
        <div className={css.colHead}>
          <h3>本体关系</h3>
          <span className={css.colQ}>这个量沿哪些边传下去、传多少</span>
        </div>
        {/*
          ⚠ 表与图在**同一个 `<section>`** 里（验收判据「图与表同卡片」）——
            不是另一个路由、不是另一个 tab、也不是一个抽屉。
            关掉表里那一行的开关，下面这张图讲的就是**同一件事**；分开摆，读者要自己在脑子里对齐。
        */}
        <section className={css.card} data-testid="sandbox-config-card-relations">
          <div className={css.relationTable} data-testid="sandbox-config-relation-table">
            {relationTable}
          </div>

          <div className={css.graphHead}>
            <h4 className={css.cardTitle} data-testid="sandbox-config-graph-title">
              {focusNodeKey === null ? "本体关系图 · 全图" : "本体关系图 · 扰动落点的下游"}
            </h4>
            <InfoPopover topic={RELATION_FORMULA_PROVENANCE} testId="relation-formula-provenance">
              <span data-testid="sandbox-config-formula-provenance">{RELATION_FORMULA_PROVENANCE_DETAIL}</span>
            </InfoPopover>
            <span className={css.graphCount} data-testid="sandbox-config-graph-count">
              {shown.nodes.length} 个量纲 · {shown.activeEdgeCount} 条边参与推演
              {shown.edges.length > shown.activeEdgeCount ? ` · ${shown.edges.length - shown.activeEdgeCount} 条已关掉` : ""}
            </span>
          </div>

          {rulesQuery.isLoading ? (
            <p className={css.note} data-testid="sandbox-config-graph-loading">
              传导规则加载中…
            </p>
          ) : rules.length === 0 ? (
            <p className={css.note} data-testid="sandbox-config-graph-no-rules">
              本租户没有已发布的传导规则 —— 没有边可画。扰动只会改落点自己那一个数，不会沿链路扩散。
            </p>
          ) : focusOffGraph ? (
            /* 诚实缺席：这不是"图坏了"，是这个落点真的没接在任何传导规则上。 */
            <p className={css.note} data-testid="sandbox-config-graph-focus-absent">
              当前扰动落点 <code className={css.mono}>{focusNodeKey}</code> 不是任何传导规则的端点 ——
              扰动它<b>不会沿本体链路扩散</b>，下游读数一格都不会动。换一个落点或量纲，这里会画出它的下游。
            </p>
          ) : (
            <>
              <RelationGraphCanvas graph={shown} focusNodeKey={focusNodeKey} />
              {/* 算式**可见**（不是悬停才出）—— 参照物那句「公式与依据均可见」的我们这一侧。 */}
              <EdgeFormulaList edges={shown.edges} />
            </>
          )}

          {/* 下游读数 —— 「关掉一条边 ⇒ 这个数当场变小」的落点（验收判据要求断言落在**数**上）。 */}
          {reach !== null && reach.found && (
            <p className={css.reach} data-testid="sandbox-config-reach">
              从 <code className={css.mono}>{focusNodeKey}</code> 出发，沿<b>参与推演</b>的边可以走到{" "}
              <b data-testid="sandbox-config-reach-nodes">{reach.nodeKeys.length}</b> 个下游量纲、经过{" "}
              <b data-testid="sandbox-config-reach-edges">{reach.edgeKeys.length}</b> 条边。
              <span className={css.noteInline}>
                这是<b>结构可达</b>（这条链在不在），不是量级 —— 量级要跑对照，见上表的差值。
              </span>
            </p>
          )}
        </section>
      </div>
    </div>
  );

  if (!collapsible) return panel;

  return (
    <div className={css.shell} data-testid="sandbox-config-shell" data-open={expanded ? "1" : "0"}>
      {/*
        ── 折叠横幅 ──────────────────────────────────────────────────────────────
        它**不是装饰条**：收起时它是这一整块在屏上留下的全部记号，所以必须自己说清
        「里面有什么、有多少」—— 只写「扰动配置 ▸」等于把内容藏进一个看不出份量的抽屉。
        （本仓 D4：降层必须留一句「这里有话要说」，且那句话要带**真计数**。）

        ⚠ 用 `<button>` 不用 `<summary>`：`<summary>` 只在 `<details>` 里有语义，
          而 `<details>` 这条路已被实测否掉（闭合子节点矩形仍非零 ⇒ 版面门照数）。
      */}
      <button
        type="button"
        className={css.bar}
        data-testid="sandbox-config-bar"
        aria-expanded={expanded}
        aria-controls="sandbox-config-body"
        onClick={onToggle}
      >
        <span className={css.barTitle}>要施加什么</span>
        <span className={css.barSep} aria-hidden="true">｜</span>
        <span className={css.barStat}>
          已施加 <b data-testid="sandbox-config-bar-applied">{num(appliedCount)}</b> 条
        </span>
        <span className={css.barSep} aria-hidden="true">｜</span>
        <span className={css.barStat}>
          传导边 <b data-testid="sandbox-config-bar-edges">{num(edgeCount)}</b> 条（其中启用{" "}
          <b data-testid="sandbox-config-bar-active">{num(activeEdgeCount)}</b> 条）
        </span>
        <span className={css.barHint} data-testid="sandbox-config-bar-hint">
          {expanded ? "收起 ▴" : "展开配置 ▾"}
        </span>
      </button>
      {panel}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 图
// ══════════════════════════════════════════════════════════════════════════════

interface Placed {
  node: RelationNodeVM;
  x: number;
  y: number;
}

/**
 * 分层关系图。**左→右 = 派生方向**（与 `docs/REF-ontology-twin-ux.html` 主链图同向）。
 *
 * ⛔ **原生量 / 派生量的区分必须落在「计算样式」上，不能只靠类名** ——
 *   类名在 jsdom 里查不到样式（没有样式表），于是"两者视觉可分"这条判据就退化成
 *   "两者类名不同"，而类名不同证明不了屏上看得出来。故虚线/实线用**内联 `strokeDasharray`**：
 *   `getComputedStyle(rect).strokeDasharray` 在 jsdom 里读得到（本单实测：`"4 3"` vs `"none"`），
 *   判据因而咬得住真实渲染属性。
 *   ⚠ 同理，关掉的边也用内联 `strokeDasharray` 区分，不用 `opacity` ——
 *     本仓已实测过 `opacity` 会把已达标的对比度再压暗一档，且它在静态对比度判据里看不见。
 */
function RelationGraphCanvas({ graph, focusNodeKey }: { graph: RelationGraphVM; focusNodeKey: string | null }) {
  const placed = useMemo(() => {
    const byLayer = new Map<number, RelationNodeVM[]>();
    for (const n of graph.nodes) {
      const cur = byLayer.get(n.layer);
      if (cur) cur.push(n);
      else byLayer.set(n.layer, [n]);
    }
    const out = new Map<string, Placed>();
    for (const [layer, list] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
      list.forEach((node, row) => {
        out.set(node.key, { node, x: layer * (NODE_W + COL_GAP), y: row * (NODE_H + ROW_GAP) });
      });
    }
    return out;
  }, [graph]);

  const width = Math.max(...[...placed.values()].map((p) => p.x + NODE_W), NODE_W) + 2;
  const height = Math.max(...[...placed.values()].map((p) => p.y + NODE_H), NODE_H) + 2;

  return (
    <div className={css.graphWrap} data-testid="sandbox-config-graph">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="本体关系图：左到右为派生方向，虚线框为派生量，实线框为原生量"
        data-testid="sandbox-config-graph-svg"
        data-node-count={graph.nodes.length}
        data-edge-count={graph.edges.length}
        data-active-edge-count={graph.activeEdgeCount}
      >
        {/* 边先画（压在节点之下）。 */}
        {graph.edges.map((e) => {
          const a = placed.get(e.from);
          const b = placed.get(e.to);
          if (!a || !b) return null;
          return <RelationEdgePath key={e.key} edge={e} a={a} b={b} />;
        })}
        {[...placed.values()].map((p) => (
          <RelationNodeBox key={p.node.key} placed={p} focused={p.node.key === focusNodeKey} />
        ))}
      </svg>
      <p className={css.legend} data-testid="sandbox-config-graph-legend">
        <span>
          <svg width="16" height="12" aria-hidden="true">
            <rect x="1" y="1" width="14" height="10" rx="2" fill="var(--bg2)" stroke="var(--accent)" style={{ strokeDasharray: "none" }} />
          </svg>
          原生量（没有边写它 · 你拨的就是它）
        </span>
        <span>
          <svg width="16" height="12" aria-hidden="true">
            <rect x="1" y="1" width="14" height="10" rx="2" fill="var(--panel2)" stroke="var(--muted2)" style={{ strokeDasharray: "3 2" }} />
          </svg>
          派生量（由规则算出）
        </span>
        <span>
          <svg width="16" height="12" aria-hidden="true">
            <path d="M1,6 L15,6" stroke="var(--danger)" strokeWidth="1.5" style={{ strokeDasharray: "3 3" }} />
          </svg>
          已关掉的边（本次推演假装它不存在）
        </span>
      </p>
    </div>
  );
}

/** 一个量纲盒。人话名在上（对象类型）· 系统键在下（量纲）—— 与关系表两级同构。 */
function RelationNodeBox({ placed, focused }: { placed: Placed; focused: boolean }) {
  const { node, x, y } = placed;
  const derived = node.kind === "derived";
  return (
    <g data-testid={`sandbox-config-node-${node.key}`} data-kind={node.kind} data-focused={focused ? "1" : "0"}>
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={NODE_H}
        rx={4}
        fill={derived ? "var(--panel2)" : "var(--bg2)"}
        stroke={focused ? "var(--warn)" : derived ? "var(--muted2)" : "var(--accent)"}
        strokeWidth={focused ? 2 : 1}
        // ⚠ 虚线/实线走**内联**样式：判据要落在计算样式上（见 `RelationGraphCanvas` 头注）。
        style={{ strokeDasharray: derived ? "4 3" : "none" }}
        data-testid={`sandbox-config-node-rect-${node.key}`}
      />
      <text x={x + 7} y={y + 14} fontSize={GRAPH_FS} fill="var(--txt)">
        {node.typeName}
      </text>
      <text x={x + 7} y={y + 27} fontSize={GRAPH_FS} fill="var(--muted2)" fontFamily="var(--font-mono)">
        {node.stateVar}
      </text>
    </g>
  );
}

/**
 * 一条边。
 *
 * ⛔ **不许用 `<title>`（SVG 的或 HTML 的都不许）** —— 这不是风格偏好，是本仓的一条既有棘轮：
 *   `sandbox-ui-integrate.seam.test.tsx` §2③-2 断言「SVG `<title>` 恒为 0 · 原生 title 只降不升」，
 *   来历是 2026-08-10 环形图上悬停提示**滞留遮挡**那次事故。本单初稿把算式塞进 `<title>`，
 *   被该门当场报红（`expected 3 to be +0`）——**机器先说话，不是人想起来**（铁律 0.6）。
 *   算式因此改成图下方的**可见清单**（见 `EdgeFormulaList`）。
 *   ⇒ 这一改反而更贴参照物：它那句「公式与依据**均可见**」本来就不是悬停才出的东西。
 *   无障碍读法走 `aria-label`（读屏能念，不产生悬停浮层）。
 */
function RelationEdgePath({ edge, a, b }: { edge: RelationEdgeVM; a: Placed; b: Placed }) {
  const x1 = a.x + NODE_W;
  const y1 = a.y + NODE_H / 2;
  const x2 = b.x;
  const y2 = b.y + NODE_H / 2;
  const mid = (x1 + x2) / 2;
  return (
    <path
      d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
      fill="none"
      stroke={edge.active ? "var(--line2)" : "var(--danger)"}
      strokeWidth={1.5}
      style={{ strokeDasharray: edge.active ? "none" : "3 3" }}
      aria-label={`${edge.formula}${edge.active ? "" : " · 本次推演已关掉"}`}
      data-testid={`sandbox-config-edge-${edge.key}`}
      data-active={edge.active ? "true" : "false"}
    />
  );
}

/**
 * 算式清单 —— **本单要害缺口的落点**。
 *
 * 改前屏上这条边的位置写的是 `系数 0.35 · 延迟 1 tick`：那是**把公式写成了参数**，
 * 读者读不出这条边在说什么。参照物每条边都给一句能读的算式（「商机=线索×市场转化率」），
 * 差距就在这一行。
 *
 * ⚠ 它是**还原**不是编造，出处记号与全文在上方那个 `?` 里（`RELATION_FORMULA_PROVENANCE`）。
 * ⚠ 状态变量只能显系统键 —— 本体里没有它们的中文名（后端欠账，已挂账）。
 */
function EdgeFormulaList({ edges }: { edges: readonly RelationEdgeVM[] }) {
  if (edges.length === 0) return null;
  return (
    <ul className={css.formulaList} data-testid="sandbox-config-formulas">
      {edges.map((e) => (
        <li key={e.key} className={css.formulaRow} data-testid={`sandbox-config-formula-${e.key}`} data-active={e.active ? "true" : "false"}>
          <code className={css.formulaText}>{e.formula}</code>
          {e.coefficientFromRule && (
            <span className={css.formulaTag} data-testid={`sandbox-config-formula-ref-${e.key}`}>
              系数取自规则表参数（屏上这个数只是内联回落值）
            </span>
          )}
          {e.cadenceNodeId !== null && (
            <span className={css.formulaTag}>过节拍闸门 {e.cadenceNodeId} · 到点才放行</span>
          )}
          {!e.active && (
            <span className={css.formulaOff} data-testid={`sandbox-config-formula-off-${e.key}`}>
              本次推演已关掉
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
