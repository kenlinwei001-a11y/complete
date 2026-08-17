import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPropagationRules } from "@/api/endpoints";
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
}

// ══════════════════════════════════════════════════════════════════════════════
// § 组件
// ══════════════════════════════════════════════════════════════════════════════

export default function SandboxConfigPanel({ inputCards, relationTable, focusNodeKey, disabledRuleKeys }: SandboxConfigPanelProps) {
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

  const full = useMemo(() => buildRelationGraph(rules, disabledRuleKeys, typeDisplayNames), [rules, disabledRuleKeys, typeDisplayNames]);
  const reach = useMemo(() => (focusNodeKey ? downstreamReach(full, focusNodeKey) : null), [full, focusNodeKey]);
  const shown = useMemo(() => (focusNodeKey ? focusSubgraph(full, focusNodeKey) : full), [full, focusNodeKey]);
  /** 焦点在本体里、但没有任何传导规则碰它 —— 必须明说（见文件头）。 */
  const focusOffGraph = focusNodeKey !== null && reach !== null && !reach.found;

  return (
    <div className={css.cfg} data-testid="sandbox-config-panel">
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
            <RelationGraphCanvas graph={shown} focusNodeKey={focusNodeKey} />
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

/** 一条边。`<title>` 里放**算式** —— 悬停即见，不占版面（分层：算式是第二层）。 */
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
      data-testid={`sandbox-config-edge-${edge.key}`}
      data-active={edge.active ? "true" : "false"}
    >
      {/* 算式在这里第一次真正出现在屏上。表里是参数（系数/延迟），这里是它们还原成的那个算术。 */}
      <title>
        {edge.formula}
        {edge.coefficientFromRule ? "（系数取自规则表参数，屏上这个数只是内联回落值）" : ""}
        {edge.cadenceNodeId ? `（过节拍闸门 ${edge.cadenceNodeId}，到点才放行）` : ""}
        {edge.active ? "" : " · 本次推演已关掉"}
      </title>
    </path>
  );
}
