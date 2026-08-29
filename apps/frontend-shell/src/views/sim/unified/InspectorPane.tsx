/**
 * WO-SIM-UNIFIED-SHELL · 右栏**检视**。
 *
 * 四问的顺序照 UX 稿，**顺序即表达**（同 `sandboxModes.ts` 的模式链纪律）：
 *   这是什么 → 变了多少 → 凭什么 → 谁推的 / 推坏谁
 * 最后是「最严重的落点」与三个动作。
 *
 * ── 为什么另写而不是复用 `InspectorNodePanel.tsx` ────────────────────────────
 * 那块面板的主体是 `ChainNode`（五段瀑布 / 前置期 / 流动效率），本栏的主体是
 * **状态变量格**（`objectId × stateVar`）。裁决与理由写在 `metricWallModel.ts` 头注。
 * 本文件同样**零算术**：派生全在 `metricWallModel.ts` / `sparkline.ts`。
 */
import type { InspectorView } from "./metricWallModel";
import { sparkGeometry } from "./sparkline";
import styles from "./UnifiedSimShell.module.css";

function fmt(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, "");
}
const NUM = (n: number | null): string => (n === null ? "—" : fmt(n));

/**
 * ══ WO-SIM-TICK-GATE（2026-08-29）· 「钉到对照 / 追这条链」：把假旋钮换成诚实的缺席 ══
 *
 * ── 今天的行为是 X（实测，另一角色当场抓的）────────────────────────────────────
 * 两个按钮**可点、点了零请求**，屏底日志多一行：
 *     `动作 pin:supplyRisk（本单不落写操作）`
 * 三处同时在骗人：
 *  ① **「本单」是工单黑话** —— 用户不知道什么是"单"，这是开发内部的排期语汇上了用户屏；
 *  ② **`pin:supplyRisk` 是机器动作键**，不是人话（且把裸键 `supplyRisk` 直接印出来，
 *     而这一屏别处都走 `stateVarLabel` 显中文名）；
 *  ③ **按钮看起来是活的** —— 本仓最恨的那种「假旋钮」：点了有反馈、实际什么都没发生，
 *     用户会以为自己钉成功了，回头去对照视图里找那一项，找不到。
 *
 * ── 应该是 Y ─────────────────────────────────────────────────────────────────
 * 沿用本屏**已有**的裁决（`unifiedModes.ts` 的「未接线为什么占位禁用而不是隐藏」）：
 * **留在屏上、禁用、`title` 用人话写明它将来做什么 + 今天为什么点不动**。
 * 于是「这功能还没有」与「我点了但没生效」在屏上分得开 —— 这正是本单要修的那类混淆。
 *
 * ⛔ 不许改成「隐藏」：隐藏 = 假装没这功能（第 ① 单原文）。
 * ⛔ 不许保留可点态再在日志里道歉：那还是假旋钮，只是把谎话挪了个地方。
 */

/** 未接线动作的**唯一**文案出处（组件不在渲染处拼字符串，两处一漂就各说各话）。 */
export const PENDING_ACTION_TEXT = {
  pin: "把这个指标钉进对照区，和别的指标并排看走势。这个功能还没有做好，所以现在点不动 —— 不是你点错了。",
  trace: "顺着这个指标往上游一路追，看它是被哪几条因果边推成今天这样的。这个功能还没有做好，所以现在点不动 —— 不是你点错了。",
} as const;

export interface InspectorPaneProps {
  view: InspectorView | null;
  /** 底部抽屉展开（右栏「展开」进抽屉）。 */
  onExpand: () => void;
  /**
   * 动作回调。**今天只有「展开抽屉」是活的**；钉到对照 / 追这条链两个按钮已按上面的裁决
   * 改成禁用占位，**不再调用本回调** —— 故本 props 现在只服务于将来接线，
   * 保留是为了让接线那一单不必改挂载契约。
   */
  onAction: (action: string) => void;
}

export function InspectorPane({ view, onExpand, onAction }: InspectorPaneProps): JSX.Element {
  if (view === null) {
    return (
      <div data-testid="usim-inspector-empty" className={styles.calibre}>
        还没有选中任何状态变量 —— 点中央任一张卡进入检视。
      </div>
    );
  }
  const c = view.card;
  const g = c.series === null ? null : sparkGeometry(c.series.baseline, c.series.actual);

  return (
    <div data-testid="usim-inspector" data-statevar={c.stateVar}>
      {/* ① 这是什么 */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>这是什么</div>
        <div className={styles.cardName}>{c.label.text}</div>
        <div className={styles.cardKey}>{c.label.key}</div>
        <div className={styles.calibre} data-testid="usim-inspector-layer" data-layer={c.layer}>
          层级 {c.layer}
          {c.layerKnown ? "" : "（后端未下发层级：它不在传导图里 —— 与「它是末端」是两回事）"} · 量纲{" "}
          {c.unit ?? "无（全平台没有状态变量→单位的登记册，编一个就是造口径）"}
        </div>
        <div className={styles.calibre}>
          落点对象 {c.objectId ?? "—"} · 本变量共 {c.cellCount} 格
        </div>
      </section>

      {/* ② 变了多少 */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>变了多少</div>
        <div className={styles.bigNumber} data-testid="usim-inspector-value">
          {NUM(c.current)}
        </div>
        <div className={styles.cardDelta} data-testid="usim-inspector-delta">
          基线 {NUM(c.baseline)} → 当前 {NUM(c.current)} · Δ {c.delta === null ? "—" : `${c.delta > 0 ? "+" : ""}${fmt(c.delta)}`}
        </div>
        {/* ③ 凭什么 —— 口径标注**紧跟大数**，不是页脚。 */}
        <div className={styles.calibre} data-testid="usim-inspector-calibre">
          {c.calibre}
        </div>

        {g !== null && g.comparable > 0 ? (
          <>
            <svg
              className={styles.spark}
              viewBox="0 0 200 48"
              preserveAspectRatio="none"
              role="img"
              aria-label="基线与推演双线走势"
              data-testid="usim-inspector-spark"
            >
              {g.baseline.map((pts, i) => (
                <polyline key={`b${i}`} points={pts} fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" />
              ))}
              {g.actual.map((pts, i) => (
                <polyline key={`a${i}`} points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" />
              ))}
            </svg>
            <div className={styles.calibre}>
              {/* 强调用 <strong>：这段按纯文本渲染，markdown 星号会原样印在屏上。 */}
              值域 {NUM(g.min)} ~ {NUM(g.max)} · 两条线可比 {g.comparable} 格（缺格处<strong>断线</strong>，不插值）
            </div>
          </>
        ) : (
          <div className={styles.calibre} data-testid="usim-inspector-spark-empty">
            画不出走势：两条线在本窗口内没有一格可比（缺格 ≠ 0，不补点）
          </div>
        )}

        <div className={styles.calibre} data-testid="usim-inspector-cross">
          最早越线：
          {c.firstCrossTick === null
            ? `算不出来 —— ${c.crossReason ?? "原因未下发"}`
            : `第 ${c.firstCrossTick} 拍（第 ${c.firstCrossDays} 天）`}
        </div>
      </section>

      {/* ④ 谁推的 / 推坏谁 */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>谁推的（上游一跳）</div>
        {view.upstream.length === 0 ? (
          <div className={styles.calibre} data-testid="usim-upstream-none">
            没有入边 —— 这是个根源变量，没人推它（这是结论，不是缺数据）
          </div>
        ) : (
          <ul className={styles.list} data-testid="usim-upstream">
            {view.upstream.map((e) => (
              <li key={e.ruleKey} data-testid={`usim-up-${e.peerStateVar}`}>
                {e.peerLabel.text} <span className={styles.cardKey}>{e.peerLabel.key}</span> · 系数{" "}
                {fmt(e.coefficient)}
                {e.coefficientIsRef ? "（引用规则参数，屏上这个数不是最终值）" : ""} · 延迟 {e.delayTicks} 拍 /{" "}
                {e.delayDays} 天
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>推坏谁（下游一跳）</div>
        {view.downstream.length === 0 ? (
          <div className={styles.calibre} data-testid="usim-downstream-none">
            没有出边 —— 它不推任何人（这是结论，不是缺数据）
          </div>
        ) : (
          <ul className={styles.list} data-testid="usim-downstream">
            {view.downstream.map((e) => (
              <li key={e.ruleKey} data-testid={`usim-down-${e.peerStateVar}`}>
                {e.peerLabel.text} <span className={styles.cardKey}>{e.peerLabel.key}</span> · 系数{" "}
                {fmt(e.coefficient)}
                {e.coefficientIsRef ? "（引用规则参数，屏上这个数不是最终值）" : ""} · 延迟 {e.delayTicks} 拍 /{" "}
                {e.delayDays} 天
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 最严重的落点 —— 「没有落点」与「算不出来」是**两个屏上态** */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>最严重的落点</div>
        <div data-testid="usim-landings" data-state={view.landingsState}>
          {view.landingsState === "ok" ? (
            <ul className={styles.list}>
              {view.landings.map((l) => (
                <li key={l.stateVar} data-testid={`usim-landing-${l.stateVar}`}>
                  {l.label.text} @ {l.objectId} · Δ {l.delta > 0 ? "+" : ""}
                  {fmt(l.delta)} · {l.hops} 跳
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.calibre}>
              {view.landingsState === "none" ? "没有落点" : "算不出来"}：{view.landingsReason}
            </div>
          )}
        </div>
      </section>

      <div className={styles.actions}>
        <button type="button" data-testid="usim-act-expand" onClick={onExpand}>
          展开到底部抽屉
        </button>
        {/* 两个未接线动作：留档 + 禁用 + `title` 写明为什么点不动（判据见文件头注）。
            `data-pending` 是机器可读位，让门/测试能咬住"它今天是禁用的"这件事。 */}
        <button
          type="button"
          data-testid="usim-act-pin"
          data-pending="1"
          disabled
          title={PENDING_ACTION_TEXT.pin}
        >
          钉到对照
        </button>
        <button
          type="button"
          data-testid="usim-act-trace"
          data-pending="1"
          disabled
          title={PENDING_ACTION_TEXT.trace}
        >
          追这条链
        </button>
      </div>
    </div>
  );
}
