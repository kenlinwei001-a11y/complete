import styles from "./LayeredDag.module.css";

/**
 * 通用分层 DAG SVG（增量 PRD §0-3 / §7.16 / §7.19）：
 * 节点按 layer 分纵向泳道（layer 0 在最左），同层节点纵向堆叠；
 * edges 显式给出（跨层连线）。颜色按节点 kind 由调用方着色。
 */
export interface DagNodeDef {
  id: string;
  layer: number;
  label: string;
  sub?: string;
  color?: string;
  /**
   * fail=红（失败步）/ warn=橙（被拒/超预算）/ dim=淡出 /
   * **excluded=被排除项（判据 U4b）**。
   *
   * ⚠ `dim` 与 `excluded` **语义完全不同，不许互相顶替**（`DisruptionRadiusView.tsx:268`
   * 那个 `state:"dim"` 标的是「本层 count=0 断链」，不是「被排除」——两者屏上都发灰，
   * 混了就会把「算出来是 0」读成「我把它关掉了」，结论完全相反）。
   */
  state?: "fail" | "warn" | "dim" | "excluded";
  /**
   * 判据 U4b · **为什么被排除**（`state==="excluded"` 时必给）。
   *
   * 判据原文要的是「看得见被排除的是**谁**、**为什么**」——只把节点留在图上、
   * 不说为什么，用户看到一个灰节点仍然不知道自己关掉了什么，等于只答了一半。
   * 故本字段由 `assertExcludedHasReason` 在**生产入口**咬死：漏了当场抛，
   * 不给「悄悄退化成一个没有理由的灰节点」留路（与 `assertDagNodeFacts` 同一处理）。
   *
   * ⚠ 请保持**短句**（图上第一层，`check-ui-first-layer` 咬 ≥24 字的成段说明）。
   */
  excludedReason?: string;
}

/**
 * 判据 U4b 的生产期断言：标了 `excluded` 却没给理由 ⇒ 抛。
 *
 * 写在生产代码而不是只写测试，理由与 `assertDagNodeFacts` 逐字同源：
 * 这个失败模式**在屏上看不出来**（灰节点照样画得出来、图照样好看），
 * 只有真去核对「我到底关掉了什么」的人才会发现无从下手。
 */
export function assertExcludedHasReason(nodes: readonly DagNodeDef[]): readonly DagNodeDef[] {
  for (const n of nodes) {
    if (n.state === "excluded" && !n.excludedReason?.trim()) {
      throw new Error(`LayeredDag 节点 ${n.id} 标了 excluded 却没给 excludedReason —— 判据 U4b 要「谁」也要「为什么」`);
    }
  }
  return nodes;
}

export interface DagEdgeDef {
  from: string;
  to: string;
}

const COL_W = 168;
const NODE_W = 142;
const NODE_H = 44;
const V_GAP = 14;
const PAD = 18;

export function LayeredDag({
  nodes,
  edges,
  layerTitles,
  onNodeClick,
  testId = "layered-dag",
}: {
  nodes: DagNodeDef[];
  edges: DagEdgeDef[];
  layerTitles?: string[];
  onNodeClick?: (node: DagNodeDef) => void;
  testId?: string;
}) {
  // 判据 U4b：断言放在**组件入口**而不是各页各调一次 —— 各页各调必然漏一页，
  // 而漏掉的那一页恰好就是"标了 excluded 却没理由"的那一页（手抄名单必漏，本体 §8）。
  assertExcludedHasReason(nodes);
  const excludedNodes = nodes.filter((n) => n.state === "excluded");
  const layerCount = nodes.reduce((m, n) => Math.max(m, n.layer + 1), 0);
  const byLayer = new Map<number, DagNodeDef[]>();
  for (const n of nodes) {
    if (!byLayer.has(n.layer)) byLayer.set(n.layer, []);
    byLayer.get(n.layer)!.push(n);
  }
  const titleH = layerTitles ? 22 : 0;
  const maxRows = Math.max(1, ...[...byLayer.values()].map((l) => l.length));
  const width = layerCount * COL_W + PAD * 2;
  const height = titleH + maxRows * (NODE_H + V_GAP) + PAD * 2;

  const pos = new Map<string, { x: number; y: number }>();
  for (const [layer, list] of byLayer) {
    const totalH = list.length * NODE_H + (list.length - 1) * V_GAP;
    const startY = titleH + PAD + (height - titleH - PAD * 2 - totalH) / 2;
    list.forEach((n, i) => {
      pos.set(n.id, { x: PAD + layer * COL_W, y: startY + i * (NODE_H + V_GAP) });
    });
  }

  const stateColor = (n: DagNodeDef): string =>
    n.state === "fail"
      ? "var(--danger)"
      : n.state === "warn"
        ? "var(--amber)"
        : // 被排除项走 `--muted2`：它要**可见地降级**（还看得清是谁），不是消失、也不是报错。
          n.state === "excluded"
          ? "var(--muted2)"
          : (n.color ?? "var(--accent)");

  return (
    <div className={styles.wrap} data-testid={testId} data-layers={layerCount}>
      <svg width={width} height={height} role="img">
        {layerTitles?.map((t, i) => (
          <text key={i} x={PAD + i * COL_W + NODE_W / 2} y={14} className={styles.layerTitle}>
            {t}
          </text>
        ))}
        {edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = b.x;
          const y2 = b.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={i}
              className={styles.edge}
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              fill="none"
            />
          );
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id)!;
          const c = stateColor(n);
          const excluded = n.state === "excluded";
          return (
            <g
              key={n.id}
              transform={`translate(${p.x},${p.y})`}
              className={`${styles.node} ${n.state === "dim" ? styles.dim : ""} ${excluded ? styles.excluded : ""}`}
              data-testid={`${testId}-node-${n.id}`}
              data-layer={n.layer}
              data-state={n.state ?? "normal"}
              /* 判据 U4b 的机检落点：理由**跟着节点走**，不是页面别处另写一句
                 （另写一句 = 图上仍看不出这个节点为什么灰，且两处必然漂）。 */
              data-excluded-reason={excluded ? n.excludedReason : undefined}
              role={onNodeClick ? "button" : undefined}
              tabIndex={onNodeClick ? 0 : undefined}
              onClick={() => onNodeClick?.(n)}
              onKeyDown={(e) => e.key === "Enter" && onNodeClick?.(n)}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={9}
                fill={`${cssColorAlpha(c)}`}
                stroke={c}
                strokeWidth={1.4}
                /* 虚线走**内联** style：判据要落在计算样式上（同 `RelationGraphCanvas` 头注的实测结论）。 */
                style={{ strokeDasharray: excluded ? "4 3" : "none" }}
              />
              <text x={10} y={n.sub ? 18 : 26} className={styles.label} fill={excluded ? "var(--muted)" : "var(--txt)"}>
                {clip(n.label, excluded ? 10 : 13)}
              </text>
              {/* 「已排除」是**文字**那一路：只靠颜色/虚线表达状态，在低对比主题下等于没表达
                  （`EdgeActivePanel` 头注那条实测结论，本组件照搬）。 */}
              {excluded && (
                <text x={NODE_W - 8} y={18} className={styles.excludedTag} textAnchor="end" data-testid={`${testId}-excluded-${n.id}`}>
                  ✕ 已排除
                </text>
              )}
              {n.sub && (
                <text x={10} y={34} className={styles.sub}>
                  {clip(n.sub, 16)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {/*
        判据 U4b 的「**为什么**」那一半 —— 与图**同一块**，不是折叠区、不是点开才出。
        节点框只有 142px 宽，塞不下一句理由；而判据要的正是「看得见被排除的是谁、为什么」，
        所以理由落在紧贴图下的这条图例里：谁（label）+ 为什么（excludedReason）逐条并列。
        ⛔ 不许改成 `<details>`：本仓实测闭合 `<details>` 的子节点 `getBoundingClientRect()`
           仍返回非零旧矩形 ⇒ 屏上看不见、版面门数上不降，两头落空。
      */}
      {excludedNodes.length > 0 && (
        <ul className={styles.excludedLegend} data-testid={`${testId}-excluded-legend`}>
          {excludedNodes.map((n) => (
            /*
              ⚠ 整条压成**一个**文本节点（不是 swatch + `<b>` + `<span>` 三块）。
              初稿那种写法被 `ui-first-layer:check` 的 D1 棘轮咬出「纯往第一层堆」
              （第一层信息块 3 → 6）。判据 U4b 要的是「看得见谁、为什么」——
              那是**一句话**，不是三个信息块；拆成三块既不增信息也踩规范。
            */
            <li key={n.id} data-testid={`${testId}-excluded-why-${n.id}`}>{`✕ ${n.label} · ${n.excludedReason}`}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** CSS 变量无法直接做透明度混合 → 用透明面板底色，边框承载语义色 */
function cssColorAlpha(_c: string): string {
  return "rgba(226,235,245,0.04)";
}
