import { useMemo } from "react";
import { SEG_REGISTRY } from "@platform/contracts";
import { fmt, useActionDraft } from "./shared";
import styles from "./GlobalSimView.module.css";

/**
 * WO-GSIM-3 · 区⑦ 底栏客户级影响——被挤单 → **真客户名 + 应用细分 + 交付地 + 影响额**（R13/R14·零杜撰）。
 *
 * 真源：被挤单 orderId 反查 portfolio.displaced（真联合解产物）× 视图已加载的真 Order 对象
 *   （cust/model/qty/bases 全读 o.props·真客户名如广汽/长安/国家电网…来自真 order·非内联）。
 * 应用细分按客户名判定（PRD §4.5-B segOfCust）：含"商用车"→com·含"储能/电网"→ess·否则 pas；
 * 影响额(亿) = qty(套) × SEG_REGISTRY.priceWan(万元/套) ÷ 1e4（G-UNIT-NORMALIZE 统一口径·SEG 价单一来源）。
 * 行动按钮**占位**（P2·别做写回·G-DECISION 方案对比可视先落·采纳走 Action 审批另单）。
 */

export interface OrderVM { id: string; cust: string; model: string; qty: number; due: string; base?: string }
export interface DisplacedVM { orderId: string; kind: string; qty: number; model?: string }

/** 应用细分标签取自 SEG_REGISTRY（单一来源·非内联·R14）。 */
const segLabelOf = (segKey: string): string => SEG_REGISTRY.find((s) => s.key === segKey)?.seg ?? segKey;
const priceWanOf = (segKey: string): number => SEG_REGISTRY.find((s) => s.key === segKey)?.priceWan ?? 0;
/** 客户名→应用细分关键词（PRD §4.5-B·按客户名判定·替代按型号）。判定关键词是业务规则兜底。 */
const COM_KW = ["商用车", "客车", "重工", "Leyland"]; // debattery-allow：segOfCust 商用车判定关键词（业务规则·非展示常数）
const ESS_KW = ["储能", "电网", "电力", "电投"]; // debattery-allow：segOfCust 储能判定关键词（业务规则·非展示常数）
function segKeyOfCust(cust: string): "pas" | "ess" | "com" {
  if (COM_KW.some((k) => cust.includes(k))) return "com";
  if (ESS_KW.some((k) => cust.includes(k))) return "ess";
  return "pas";
}

interface ImpactRow {
  orderId: string; cust: string; model: string; qty: number;
  segLabel: string; segColor: string; deliverTo: string; impactYi: number; traceable: boolean;
}

export function CustomerImpactBar({ displaced, orders }: { displaced: DisplacedVM[]; orders: OrderVM[] }) {
  // 死按钮修：行动按钮接 S2 Action 审批（plan_change 草稿·不直接写回真值·R4）。
  const adopt = useActionDraft();
  const rows = useMemo<ImpactRow[]>(() => {
    const orderById = new Map(orders.map((o) => [o.id, o]));
    return displaced
      .filter((d) => d.kind === "order") // 只对销售订单归因客户（WIP/预测无客户主体·诚实不编）
      .map((d) => {
        const o = orderById.get(d.orderId);
        const cust = o?.cust ?? "";
        const segKey = segKeyOfCust(cust);
        const qty = d.qty || o?.qty || 0;
        const segMeta = SEG_REGISTRY.find((s) => s.key === segKey);
        return {
          orderId: d.orderId,
          cust: cust || "（未匹配到订单·客户未知）",
          model: o?.model ?? d.model ?? "—",
          qty,
          segLabel: segLabelOf(segKey),
          segColor: segMeta?.color ?? "#8b96a8",
          deliverTo: o?.base ?? "—",
          impactYi: Math.round((qty * priceWanOf(segKey)) / 1e4 * 1000) / 1000,
          traceable: !!o, // 可溯真 order（反查命中）
        };
      })
      .sort((a, b) => b.impactYi - a.impactYi || a.orderId.localeCompare(b.orderId));
  }, [displaced, orders]);

  const totalYi = Math.round(rows.reduce((s, r) => s + r.impactYi, 0) * 1000) / 1000;

  return (
    <div className={styles.glass} data-testid="global-sim-customer-impact">
      <span className={styles.grpLabel}>[ 客户级影响 · 被挤单 → 真客户 / 应用细分 / 交付地 / 影响额 ]</span>
      {rows.length === 0 ? (
        <div className={styles.empty} data-testid="global-sim-impact-empty">当前联合解无被挤订单（全部订单获排·无客户受影响）</div>
      ) : (
        <>
          <div className={styles.cardGrid} data-testid="global-sim-impact-list">
            {rows.map((r) => (
              <div key={r.orderId} className={`${styles.orderCard} ${styles.displaced}`} data-testid={`global-sim-impact-${r.orderId}`}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <strong data-testid={`global-sim-impact-cust-${r.orderId}`}>{r.cust}</strong>
                  <span className={styles.segChip} style={{ borderColor: r.segColor, color: r.segColor }}>{r.segLabel}</span>
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: "#a7b1c2" }}>
                  {r.orderId} · {r.model} · <span className="amt">{fmt(r.qty, 0)}</span> 套未获排
                </div>
                <div style={{ marginTop: 3, fontSize: 11 }}>
                  交付地 {r.deliverTo} · 影响额 <b className={styles.textPrimary} data-testid={`global-sim-impact-yi-${r.orderId}`}>{r.impactYi.toFixed(2)}</b> 亿
                  {!r.traceable && <span className={styles.textMuted}> · 未溯到订单</span>}
                </div>
                {/* 死按钮修：接 S2 Action 审批（plan_change 草稿·不直接写回真值·R4）。inline 样式覆盖占位灰底 → 可点。 */}
                <div className={styles.actionsPlaceholder} data-testid={`global-sim-impact-actions-${r.orderId}`}>
                  <button
                    className={styles.btnPlaceholder}
                    data-testid={`global-sim-impact-coord-${r.orderId}`}
                    disabled={adopt.isPending}
                    style={{ cursor: adopt.isPending ? "wait" : "pointer", color: "var(--c-capacity, #43B7D7)", borderStyle: "solid", borderColor: "rgba(67,183,215,.4)" }}
                    title="生成 plan_change 草稿 → S2 审批（本单不写回真值）"
                    onClick={() => adopt.mutate({ actionTypeKey: "plan_change", payload: { intent: "coordinate_capacity", orderId: r.orderId, cust: r.cust, seg: r.segLabel, qty: r.qty, impactYi: r.impactYi } })}
                  >
                    协调加产
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className={styles.summary} data-testid="global-sim-impact-summary">
            被挤订单合计影响额 <b className={styles.textPrimary}>{totalYi.toFixed(2)}</b> 亿（Σqty×SEG 价÷1e4·真客户名来自订单对象·可溯真 order·R13）·
            行动按钮生成 plan_change 草稿 → S2 审批（本单不直接写回真值·R4）。
          </div>
        </>
      )}
    </div>
  );
}
