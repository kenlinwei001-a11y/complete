import { useState } from "react";
import type { RiskTimelineOutput } from "@platform/contracts";
import { Modal } from "@/components/ui/Modal";
import { fmt } from "./shared";
import styles from "./SimViews.module.css";

/**
 * 传导链时间轴（增量 §7.10-4 / §7.11，全局唯一实现）：
 * 横向 stepper —— 事件窗 → 约束越线 → 波及订单 → 财务击穿，节点按严重度着色；
 * 受影响订单行可点开订单弹窗。数据由 risk_timeline 输出经 buildPropagation 适配。
 */

export interface PropagationOrder {
  so: string;
  cust: string;
  model: string;
  qty: number;
  due: string;
  delay: number;
}

export interface PropagationStage {
  key: "event" | "cross" | "orders" | "finance";
  title: string;
  /** 时间窗标注（如 D+1–D+5） */
  window: string;
  meta: string;
  sev: 0 | 1 | 2;
}

export interface PropagationVM {
  base: string;
  factor: string;
  stages: PropagationStage[];
  orders: PropagationOrder[];
}

const EVENT_LABEL: Record<string, string> = {
  maint_window: "检修窗",
  delivery_peak: "交付高峰",
  arrival_gap: "到货间隙",
};

/** 适配器（全局唯一）：risk_timeline 输出（events / crossDay / affectedOrders）→ 四节点传导链 */
export function buildPropagation(out: RiskTimelineOutput, cardIndex = 0): PropagationVM | null {
  const card = out.cards[cardIndex] ?? out.cards[0];
  if (!card) return null;
  const events = card.events ?? [];
  const firstEventDay = events.length > 0 ? Math.min(...events.map((e) => e.day)) : null;
  const crossed = card.crossDay != null;
  const orders = ((card.affectedOrders ?? []) as Record<string, unknown>[]).map((o) => ({
    so: String(o.so ?? ""),
    cust: String(o.cust ?? "—"),
    model: String(o.model ?? "—"),
    qty: Number(o.qty ?? 0),
    due: String(o.due ?? "—"),
    delay: Number(o.delay ?? 0),
    revenueWan: Number(o.revenueWan ?? 0),
  }));
  // 轨M 增量1（假4）：财务击穿敞口 = Σ逐单真营收（qty × 真细分单价 SEG_PRICE，后端 affected_orders 真算）→ 亿，
  // 不再前端写死 0.6 万/套。无 revenueWan（陈旧数据）则诚实标估算口径回落。
  const hasRealRevenue = orders.some((o) => o.revenueWan > 0);
  const financeWan = hasRealRevenue
    ? orders.reduce((a, o) => a + o.revenueWan, 0)
    : orders.reduce((a, o) => a + o.qty, 0) * 0.6; // 回落估算口径（仅无真营收时）
  const financeYi = Math.round(financeWan / 10000 * 100) / 100;
  const revenueMode = hasRealRevenue ? "真算" : "估算";
  const stages: PropagationStage[] = [
    {
      key: "event",
      title: "事件窗",
      window: firstEventDay != null ? `D+${firstEventDay}` : "—",
      meta:
        events.length > 0
          ? events
              .slice(0, 3)
              .map((e) => `${EVENT_LABEL[e.type] ?? e.type} D+${e.day}`)
              .join(" · ")
          : "无事件脉冲",
      sev: events.length > 0 ? 1 : 0,
    },
    {
      key: "cross",
      title: "约束越线",
      window: crossed ? `D+${card.crossDay}` : "—",
      meta: crossed
        ? `${card.base}·${card.factor} 张力峰值 ${fmt(card.peak, 0)} ≥ 阈值 ${fmt(out.threshold, 0)}`
        : `峰值 ${fmt(card.peak, 0)} 未越线（阈值 ${fmt(out.threshold, 0)}）`,
      sev: crossed ? 2 : 0,
    },
    {
      key: "orders",
      title: "波及订单",
      window: crossed ? `D+${(card.crossDay ?? 0)}–D+${(card.crossDay ?? 0) + 14}` : "—",
      meta: orders.length > 0 ? `${orders.length} 单在越线窗口内` : "窗口内无订单",
      sev: orders.length > 2 ? 2 : orders.length > 0 ? 1 : 0,
    },
    {
      key: "finance",
      title: "财务击穿",
      window: "月度滚动",
      meta: orders.length > 0 ? `延误敞口约 ${fmt(financeYi, 2)} 亿（收入口径·${revenueMode}：逐单 qty×真细分单价）` : "无财务击穿",
      sev: financeYi >= 1 ? 2 : orders.length > 0 ? 1 : 0,
    },
  ];
  return { base: card.base, factor: card.factor, stages, orders };
}

export function PropagationTimeline({ vm, testId = "ptl" }: { vm: PropagationVM; testId?: string }) {
  const [openOrder, setOpenOrder] = useState<PropagationOrder | null>(null);
  return (
    <div data-testid={testId}>
      <div className={styles.ptlHead}>
        传导链 · {vm.base} · {vm.factor}（不解决会怎样）
      </div>
      <div className={styles.ptl}>
        {vm.stages.map((st) => (
          <div key={st.key} className={styles.ptlSt} data-sev={st.sev} data-testid={`${testId}-node-${st.key}`}>
            <span className={styles.ptlW}>{st.window}</span>
            <i className={styles.ptlDot} />
            <b className={styles.ptlT}>{st.title}</b>
            <div className={styles.ptlM}>{st.meta}</div>
            {st.key === "orders" && vm.orders.length > 0 && (
              <div className={styles.ptlOs}>
                {vm.orders.slice(0, 4).map((o) => (
                  <button
                    key={o.so}
                    className={styles.ptlO}
                    data-testid={`${testId}-order-${o.so}`}
                    onClick={() => setOpenOrder(o)}
                  >
                    {o.so} <b>+{o.delay}d</b>
                  </button>
                ))}
                {vm.orders.length > 4 && <span className={styles.ptlO}>+{vm.orders.length - 4}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
      {openOrder && (
        <Modal title={`订单 ${openOrder.so}`} onClose={() => setOpenOrder(null)} width={420}>
          <div data-testid={`${testId}-order-modal`}>
            <table className="cmp">
              <tbody>
                <tr>
                  <td>客户</td>
                  <td className="zh">{openOrder.cust}</td>
                </tr>
                <tr>
                  <td>型号</td>
                  <td className="mono">{openOrder.model}</td>
                </tr>
                <tr>
                  <td>数量</td>
                  <td className="mono">{openOrder.qty.toLocaleString("zh-CN")} 套</td>
                </tr>
                <tr>
                  <td>交期</td>
                  <td className="mono">{openOrder.due}</td>
                </tr>
                <tr>
                  <td>预计延误</td>
                  <td style={{ color: "var(--danger)", fontWeight: 700 }}>{openOrder.delay} 天</td>
                </tr>
              </tbody>
            </table>
            <div className={styles.noteInfo}>来源：risk_timeline → affected_orders（越线窗口 [D−7, D+14]，一个事实一个出处）</div>
          </div>
        </Modal>
      )}
    </div>
  );
}
