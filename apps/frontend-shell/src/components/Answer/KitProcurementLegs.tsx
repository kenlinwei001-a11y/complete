import { Fragment } from "react";
import {
  buildKitWhoToCall,
  formatDays,
  kitStatusTally,
  LEG_STATUS_PRESENTATION,
  type KitItemVM,
  type KitOrderVM,
} from "./kitProcurement";
import styles from "./KitProcurementLegs.module.css";

/**
 * WO-S08-KIT-PROCUREMENT-FE · 齐套问答答案里的**采购四段**渲染。
 *
 * 版面顺序 = 用户读答案的顺序：
 *   ① 该找谁总榜（全量关键段按具体责任方归并·累计天数降序）
 *   ② 逐单：齐套率 / 建议 / 最早齐套日（诚实位：EMPTY 说"算不出来 + 原因"）
 *   ③ 逐缺料项：关键段横幅 → 四段瀑布（三态四重编码）→ 合计 → 责任方汇总 → MOQ/准时率
 *
 * 三态四重编码（`NOT_APPLICABLE` ≠ `EMPTY` 的落点，去掉颜色仍一眼可分）：
 *   ① `data-status` 属性 ② 文案标签 + reason 前缀（口径/依据/缺）
 *   ③ 形状纹理（实心条 / 零宽塌陷 / 斜纹洞）
 *   ④ **功能性后果**：NA 计 0 不阻断合计；EMPTY 令合计显示「不可结算」并列出被哪几段挡的。
 *   第 ④ 条最硬 —— 把"不适用"和"不知道"画成一样的界面做不出这个差别。
 */
export function KitProcurementLegs({
  orders,
  provId,
  taskId,
  provIndex,
}: {
  /** 已由 `buildKitOrderVMs` 解析好的订单（调用方解析一次，表格与本面板共用同一份，不二次解析）。 */
  orders: KitOrderVM[];
  provId: string;
  taskId: string;
  provIndex: (provId: string) => number;
}) {
  // 宁可什么都不画，也不画空壳。
  if (orders.length === 0) return null;

  const whoToCall = buildKitWhoToCall(orders);
  const tally = kitStatusTally(orders);

  return (
    <div className={styles.wrap} data-testid="kit-procurement">
      <div className={styles.head}>
        <span className={styles.title}>采购四段分解 · 晚在哪一段、该找谁</span>
        {/* 溯源角标只挂在上方表格上（同一 provId 挂两处会造出两个同 testid 的角标）；
            这里只声明数据同源，不另起一个溯源入口。 */}
        <span className={styles.muted} data-testid="kit-source-note">
          数据源：上表同一份 kit_readiness 输出（{provIndex(provId) > 0 ? `溯源 ${provIndex(provId)}` : "见上表溯源角标"}）
        </span>
      </div>

      {/* 三态自陈：本次结果里三态各出现几次（读者据此判断"看到的是不是全实测"）。 */}
      <div className={styles.tally} data-testid="kit-status-tally">
        {(["MEASURED", "NOT_APPLICABLE", "EMPTY"] as const).map((s) => (
          <span key={s} className={styles.tallyItem} data-status={s} data-testid={`kit-tally-${s}`}>
            <i className={styles.swatch} data-status={s} aria-hidden />
            {LEG_STATUS_PRESENTATION[s].label} {tally[s]} 段
            <em className={styles.tallyMeaning}>{LEG_STATUS_PRESENTATION[s].meaning}</em>
          </span>
        ))}
      </div>

      {/* ① 该找谁总榜 */}
      <section className={styles.section} data-testid="kit-who-to-call">
        <div className={styles.sectionTitle}>该找谁（关键段按责任方归并）</div>
        {whoToCall.length === 0 ? (
          <p className={styles.absence} data-testid="kit-who-empty">
            本次结果里没有任何一段是实测的 ⇒ 算不出「最该找的那一段」。不猜一个责任方顶上。
          </p>
        ) : (
          <ol className={styles.callList}>
            {whoToCall.map((w) => (
              <li key={`${w.owner}|${w.ownerRef ?? ""}`} data-testid={`kit-call-${w.owner}`} data-internal={w.internal ? "1" : "0"}>
                <b className={styles.callName}>{w.displayName}</b>
                <span className={styles.callRole}>{w.ownerLabel}</span>
                <span className={styles.callTag}>{w.internal ? "对内" : "对外"}</span>
                <span className="mono">{formatDays(w.totalDays)}</span>
                <span className={styles.callMats}>{w.materials.join("、")}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ② 逐单 */}
      {orders.map((o) => (
        <OrderPanel key={o.orderId} order={o} />
      ))}
    </div>
  );
}

function OrderPanel({ order }: { order: KitOrderVM }) {
  const empty = order.earliestKitDayStatus === "EMPTY" || order.earliestKitDay === null;
  return (
    <section className={styles.order} data-testid={`kit-order-${order.orderId}`}>
      <div className={styles.orderHead}>
        <b className="mono">{order.orderId}</b>
        {order.kitRatio !== null && (
          <span className={styles.orderKpi}>
            齐套率 <span className="mono">{(order.kitRatio * 100).toFixed(2)}%</span>
          </span>
        )}
        {order.advice !== null && <span className="badge">{order.advice}</span>}
        <span className={styles.orderKpi} data-testid={`kit-earliest-${order.orderId}`} data-status={empty ? "EMPTY" : "MEASURED"}>
          最早齐套日{" "}
          {empty ? (
            <em className={styles.unknown}>算不出来</em>
          ) : (
            <span className="mono">第 {order.earliestKitDay} 天</span>
          )}
        </span>
      </div>
      {empty && (
        <p className={styles.absence} data-testid={`kit-earliest-reason-${order.orderId}`}>
          缺：
          {order.earliestKitDayReason ??
            "后端未随表下发原因（`earliestKitDayReason` 不在本表列里 —— 列名取自首行，首行可结算时该列整列缺席）。"}
        </p>
      )}
      {order.itemsWithoutProcurement.length > 0 && (
        <p className={styles.absence} data-testid={`kit-no-procurement-${order.orderId}`}>
          {/* ⚠ 屏上文案不许写 markdown 强调符（会原样显示成星号）。 */}
          以下缺料项引擎未下发采购段凭证，本面板不为它们画四段（没算 ≠ 四段都取不到）：
          {order.itemsWithoutProcurement.join("、")}
        </p>
      )}

      {order.items.map((it) => (
        <ItemPanel key={it.material} item={it} orderId={order.orderId} />
      ))}
    </section>
  );
}

function ItemPanel({ item, orderId }: { item: KitItemVM; orderId: string }) {
  const testKey = `${orderId}-${item.material}`;
  return (
    <div className={styles.item} data-testid={`kit-item-${testKey}`}>
      <div className={styles.itemHead}>
        <b>{item.material}</b>
        <span className={styles.muted}>
          缺口 <span className="mono">{item.shortage}</span>
          <em className={styles.unitNote}>（量纲引擎未下发）</em>
        </span>
        <span className={styles.muted}>
          供应商 {item.supplierName ?? <em className={styles.unknown}>指不出来</em>}
        </span>
        <span className={styles.muted} data-testid={`kit-transit-${testKey}`}>
          在途最早到货 {dayOrUnknown(item.earliestDay)} · 靠在途补齐 {dayOrUnknown(item.coveringEtaDay)}
        </span>
      </div>

      {/* 关键段横幅：整个特性的落点 —— 用户要的是"打哪通电话" */}
      {item.critical === null ? (
        <p className={styles.absence} data-testid={`kit-critical-absent-${testKey}`}>
          四段无一实测 ⇒ 算不出关键段，不指认任何责任方。
        </p>
      ) : (
        <p className={styles.critical} data-testid={`kit-critical-${testKey}`} data-owner={item.critical.owner}>
          最该找：<b>{item.critical.ownerRef ?? item.critical.ownerLabel}</b>（{item.critical.ownerLabel}）·{" "}
          {item.critical.legLabel} <span className="mono">{item.critical.daysText}</span>
          {item.critical.pctOfTotal !== null && <span className="mono">（占 {item.critical.pctOfTotal}%）</span>} ·{" "}
          {item.critical.actionHint}
        </p>
      )}

      {/* 四段瀑布 */}
      <ul className={styles.legs}>
        {item.legs.map((l) => (
          <li key={l.leg} className={styles.leg} data-testid={`kit-leg-${testKey}-${l.leg}`} data-status={l.status} data-critical={l.critical ? "1" : "0"}>
            <span className={styles.legLabel}>
              {l.label}
              {l.valueAdd && <em className={styles.valueAdd}>增值</em>}
            </span>
            <span className={styles.barTrack}>
              <i className={styles.bar} data-status={l.status} style={{ width: `${l.widthPct}%` }} aria-hidden />
            </span>
            <span className={styles.legDays} data-testid={`kit-legdays-${testKey}-${l.leg}`}>
              {l.daysText}
            </span>
            <span className={styles.legStatus} data-status={l.status}>
              {l.presentation.label}
            </span>
            <span className={styles.legOwner}>
              {l.ownerLabel}
              {l.ownerRef !== null && <span className={styles.legOwnerRef}>{l.ownerRef}</span>}
            </span>
            {l.reason !== null && (
              <span className={styles.legReason}>
                {l.presentation.reasonPrefix}：{l.reason}
              </span>
            )}
            {l.source !== null && (
              <span className={`${styles.legSource} mono`}>
                出处：{l.source.objectType}.{l.source.field}（{l.source.objectIds.length} 条）
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* 合计 —— 三态的功能性后果就落在这一行 */}
      <p className={styles.total} data-testid={`kit-total-${testKey}`} data-complete={item.complete ? "1" : "0"}>
        四段合计：
        {item.totalDays === null ? (
          <>
            <em className={styles.unknown}>不可结算</em>
            <span className={styles.absenceInline}>
              被这几段挡住：{item.blockingLegs.map((k) => item.legs.find((l) => l.leg === k)?.label ?? k).join("、")}
              （取不到真值，拿已知几段之和冒充会让最早齐套日系统性偏早）
            </span>
          </>
        ) : (
          <span className="mono">{formatDays(item.totalDays)}</span>
        )}
      </p>

      {/* 责任方汇总 */}
      <p className={styles.owners} data-testid={`kit-owners-${testKey}`}>
        责任方分摊：
        {item.ownerRollup.length === 0 ? (
          <em className={styles.unknown}>无可分摊天数</em>
        ) : (
          item.ownerRollup.map((r, i) => (
            <Fragment key={r.owner}>
              {i > 0 && " · "}
              <span data-testid={`kit-owner-${testKey}-${r.owner}`}>
                {r.ownerLabel} <span className="mono">{formatDays(r.days)}</span>
                {r.pctOfTotal !== null && <span className="mono">（{r.pctOfTotal}%）</span>}
              </span>
            </Fragment>
          ))
        )}
        {item.unknownOwners.length > 0 && (
          <span className={styles.absenceInline} data-testid={`kit-unknown-owners-${testKey}`}>
            天数未知、不摊到任何人头上：{item.unknownOwners.map((o) => item.legs.find((l) => l.owner === o)?.ownerLabel ?? o).join("、")}
          </span>
        )}
      </p>

      {/* MOQ / 准时率 / 承诺 vs 期望 */}
      <p className={styles.moq} data-testid={`kit-moq-${testKey}`}>
        起订量 {numOrUnknown(item.minOrderQty)} · 建议采购量 {numOrUnknown(item.replenishQty)}
        {item.moqApplied && <span className="badge amber">起订量抬高了采购量</span>} · 准时率{" "}
        {item.onTimeRate === null ? <em className={styles.unknown}>取不到</em> : <span className="mono">{(item.onTimeRate * 100).toFixed(0)}%</span>} ·
        期望滑期 {item.expectedSlipDays === null ? <em className={styles.unknown}>算不出</em> : <span className="mono">{formatDays(item.expectedSlipDays)}</span>}
      </p>
      <p className={styles.kitDays} data-testid={`kit-days-${testKey}`}>
        承诺口径最早齐套日 {dayOrUnknown(item.earliestKitDay)} · 含准时率风险的期望齐套日 {dayOrUnknown(item.expectedKitDay)}
      </p>

      {/* 对账：引擎自报 vs 契约唯一实现。不一致当面报，不静默择一。 */}
      {(item.criticalAgreement === "MISMATCH" || item.ownerAgreement === "MISMATCH" || item.totalAgreement === "MISMATCH") && (
        <p className={styles.mismatch} data-testid={`kit-mismatch-${testKey}`}>
          ⚠ 引擎自报的汇总与契约唯一实现算出来的对不上（
          {[
            item.criticalAgreement === "MISMATCH" ? "关键段" : null,
            item.ownerAgreement === "MISMATCH" ? "责任方分摊" : null,
            item.totalAgreement === "MISMATCH" ? "四段合计" : null,
          ]
            .filter((x) => x !== null)
            .join("、")}
          ）。屏上显示的是契约重算值；请核对引擎侧 —— 这里不替它选一个看着对的。
        </p>
      )}
    </div>
  );
}

/** 数量类：引擎今天不下发量纲，故只显数字；取不到显「取不到」，**绝不写 0**。 */
function numOrUnknown(v: number | null) {
  return v === null ? <em className={styles.unknown}>取不到</em> : <span className="mono">{v}</span>;
}

function dayOrUnknown(v: number | null) {
  return v === null ? <em className={styles.unknown}>算不出</em> : <span className="mono">第 {v} 天</span>;
}
