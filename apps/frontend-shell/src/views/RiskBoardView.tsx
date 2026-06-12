import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { RiskTimelineOutput } from "@platform/contracts";
import { RiskTimelineOutputSchema } from "@platform/contracts";
import { invokeSolver, searchObjects } from "@/api/endpoints";
import { useSessionStore } from "@/store/sessionStore";
import { Modal } from "@/components/ui/Modal";
import { EChart } from "@/components/ui/EChart";
import type { ViewRendererProps } from "./registry";
import zh from "@/locales/zh";
import styles from "./RiskBoardView.module.css";

type RiskCard = RiskTimelineOutput["cards"][number];

/** 推演看板（renderer=risk-board，PRD §7.3）：风险卡网格 + 逐日 heat strip + 受影响订单弹窗 */
export default function RiskBoardView(_props: ViewRendererProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["a", "risk-timeline", {}],
    queryFn: async () => {
      const res = await invokeSolver("risk_timeline", {});
      return RiskTimelineOutputSchema.parse(res.data);
    },
  });
  const selectedObjects = useSessionStore((s) => s.selectedObjects);
  const [detail, setDetail] = useState<RiskCard | null>(null);
  const [ordersDay, setOrdersDay] = useState<{ base: string; day: number } | null>(null);

  if (isLoading || !data) return <div className="empty-state">{zh.common.loading}</div>;

  return (
    <div>
      <div className={styles.grid}>
        {data.cards.map((card) => {
          const selected = selectedObjects.some((o) => o.label === card.base);
          return (
            <div
              key={`${card.base}:${card.factor}`}
              className={`${styles.card} ${selected ? styles.cardSelected : ""}`}
              data-testid={`risk-card-${card.base}`}
              role="button"
              tabIndex={0}
              onClick={() => {
                // 选中实体写入共享 store（上下文随问句提交）
                useSessionStore.getState().toggleSelectedObject({
                  objectType: "Base",
                  objectId: `base-${card.base}`,
                  label: card.base,
                });
                setDetail(card);
              }}
              onKeyDown={(e) => e.key === "Enter" && setDetail(card)}
            >
              <div className={styles.cardHead}>
                <strong>{card.base}</strong>
                <span className="badge">{card.factor}</span>
              </div>
              <div className={styles.metrics}>
                <span>
                  {zh.risk.peak}
                  <b className="mono" style={{ color: card.peak >= data.threshold ? "var(--danger)" : "var(--txt)" }}>
                    {card.peak.toFixed(0)}
                  </b>
                </span>
                <span>
                  {zh.risk.crossDay}
                  <b className="mono">{card.crossDay != null ? `D+${card.crossDay}` : zh.risk.noCross}</b>
                </span>
              </div>
              <MiniStrip series={card.series} threshold={data.threshold} />
            </div>
          );
        })}
      </div>

      {detail && (
        <Modal title={`${detail.base} · ${detail.factor}`} onClose={() => setDetail(null)} width={720}>
          <div className="section-title">{zh.risk.dailyStrip}</div>
          <EChart
            height={140}
            testId="risk-heat-strip"
            option={{
              grid: { top: 10, bottom: 30, left: 36, right: 12 },
              tooltip: {},
              xAxis: { type: "category", data: detail.series.map((_, i) => `D+${i}`) },
              yAxis: { type: "value", max: 100, splitLine: { lineStyle: { color: "rgba(226,235,245,.07)" } } },
              series: [
                {
                  type: "bar",
                  data: detail.series.map((v) => ({
                    value: v,
                    itemStyle: { color: v >= data.threshold ? "#E0626C" : v >= data.threshold - 15 ? "#E8B54A" : "#43B7D7" },
                  })),
                },
              ],
            }}
          />
          {/* 时点点击（图表 + 可键盘到达的日条） */}
          <div className={styles.dayRow}>
            {detail.series.map((v, day) => (
              <button
                key={day}
                className={styles.dayCell}
                title={`D+${day} · ${v.toFixed(0)}`}
                data-testid={`risk-day-${day}`}
                style={{ background: heatColor(v, data.threshold) }}
                onClick={() => setOrdersDay({ base: detail.base, day })}
              />
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--muted)" }}>
            {detail.events.map((e, i) => (
              <div key={i}>
                <span className="mono">D+{e.day}</span> · {e.type} · amp {e.amp}
              </div>
            ))}
          </div>
        </Modal>
      )}

      {ordersDay && <AffectedOrdersModal base={ordersDay.base} day={ordersDay.day} onClose={() => setOrdersDay(null)} />}
    </div>
  );
}

function heatColor(v: number, threshold: number): string {
  if (v >= threshold) return "rgba(224,98,108,.85)";
  if (v >= threshold - 15) return "rgba(232,181,74,.7)";
  return `rgba(67,183,215,${0.15 + (v / 100) * 0.55})`;
}

function MiniStrip({ series, threshold }: { series: number[]; threshold: number }) {
  return (
    <div className={styles.miniStrip}>
      {series.map((v, i) => (
        <span key={i} style={{ background: heatColor(v, threshold) }} />
      ))}
    </div>
  );
}

/** 时点点击 → 受影响订单弹窗（GET {A} 对象查询） */
function AffectedOrdersModal({ base, day, onClose }: { base: string; day: number; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["a", "objects", { type: "Order", base, day }],
    queryFn: () => searchObjects("Order", "", { base, day: String(day) }),
  });
  return (
    <Modal title={`${zh.risk.affectedOrders} · ${base} · D+${day}`} onClose={onClose} width={640}>
      <table className="cmp" data-testid="affected-orders-table">
        <thead>
          <tr>
            <th>SO</th>
            <th>客户</th>
            <th>型号</th>
            <th>数量</th>
            <th>交期</th>
          </tr>
        </thead>
        <tbody>
          {(data?.items ?? []).map((o) => (
            <tr key={o.id}>
              <td>{String(o.props.so ?? o.id)}</td>
              <td className="zh">{String(o.props.cust ?? "—")}</td>
              <td>{String(o.props.model ?? "—")}</td>
              <td>{String(o.props.qty ?? "—")}</td>
              <td>{String(o.props.due ?? "—")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data && data.items.length === 0 && <div className="empty-state">{zh.common.none}</div>}
    </Modal>
  );
}
