/**
 * WO-SIM-UNIFIED-SHELL · 底部抽屉（三栏：传导链图 · 落点逐条 · 双线图）。
 *
 * 右栏「展开到底部抽屉」进来，可收起。与右栏**同一份派生结果**（`InspectorView`）——
 * 抽屉不另取一次数、不另算一遍，否则两处会各说各话。
 *
 * ⚠ 「落点逐条」这一栏是**可滚动全量**（右栏只给最严重的 N 条）。
 *   两栏的差别是**条数**，不是口径 —— 口径漂了就会出现「右栏说 3 条、抽屉说 5 条」。
 */
import type { InspectorView } from "./metricWallModel";
import { sparkGeometry } from "./sparkline";
import styles from "./UnifiedSimShell.module.css";

function fmt(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, "");
}

export interface BottomDrawerProps {
  view: InspectorView | null;
  /** 双线图的窗口跨度（天）——由会话的 `tickDays` × 窗口格数现算，不写死 60。 */
  windowDays: number | null;
}

export function BottomDrawer({ view, windowDays }: BottomDrawerProps): JSX.Element {
  if (view === null) {
    return (
      <div className={styles.drawer} data-testid="usim-drawer">
        <div className={styles.drawerCol} data-testid="usim-drawer-empty">
          <div className={styles.calibre}>选中一个状态变量后，这里展开它的传导链、落点与走势。</div>
        </div>
      </div>
    );
  }
  const c = view.card;
  const g = c.series === null ? null : sparkGeometry(c.series.baseline, c.series.actual, { width: 320, height: 120, pad: 6 });

  return (
    <div className={styles.drawer} data-testid="usim-drawer" data-statevar={c.stateVar}>
      {/* ① 传导链图（上游一跳 → 本变量 → 下游一跳）。**不做多跳闭包** —— 多跳是引擎的事。 */}
      <div className={styles.drawerCol} data-testid="usim-drawer-chain">
        <div className={styles.sectionHead}>传导链（各一跳）</div>
        <ul className={styles.list}>
          {view.upstream.map((e) => (
            <li key={`u-${e.ruleKey}`}>
              {e.peerLabel.text} —{fmt(e.coefficient)}/{e.delayTicks}拍→ {c.label.text}
            </li>
          ))}
          <li>
            <strong>{c.label.text}</strong>
          </li>
          {view.downstream.map((e) => (
            <li key={`d-${e.ruleKey}`}>
              {c.label.text} —{fmt(e.coefficient)}/{e.delayTicks}拍→ {e.peerLabel.text}
            </li>
          ))}
        </ul>
        {view.upstream.length === 0 && view.downstream.length === 0 ? (
          <div className={styles.calibre}>这个变量在传导图里没有任何边。</div>
        ) : null}
      </div>

      {/* ② 落点逐条（全量·可滚动）。两个空态互斥，屏上分得开。 */}
      <div className={styles.drawerCol} data-testid="usim-drawer-landings" data-state={view.landingsState}>
        <div className={styles.sectionHead}>落点逐条</div>
        {view.landingsState === "ok" ? (
          <ul className={styles.list}>
            {view.landings.map((l) => (
              <li key={l.stateVar}>
                {l.label.text} @ {l.objectId} · Δ {l.delta > 0 ? "+" : ""}
                {fmt(l.delta)}
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.calibre}>
            {view.landingsState === "none" ? "没有落点" : "算不出来"}：{view.landingsReason}
          </div>
        )}
      </div>

      {/* ③ 双线图。窗口跨度**现算**，屏上标出来。 */}
      <div className={styles.drawerCol} data-testid="usim-drawer-series">
        <div className={styles.sectionHead}>
          基线 / 推演双线{windowDays === null ? "" : ` · 窗口 ${windowDays} 天`}
        </div>
        {g !== null && g.comparable > 0 ? (
          <svg className={styles.spark} viewBox="0 0 320 120" preserveAspectRatio="none" role="img" aria-label="基线与推演双线走势">
            {g.baseline.map((pts, i) => (
              <polyline key={`b${i}`} points={pts} fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" />
            ))}
            {g.actual.map((pts, i) => (
              <polyline key={`a${i}`} points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" />
            ))}
          </svg>
        ) : (
          <div className={styles.calibre} data-testid="usim-drawer-series-empty">
            画不出走势：两条线在本窗口内没有一格可比。
          </div>
        )}
      </div>
    </div>
  );
}
