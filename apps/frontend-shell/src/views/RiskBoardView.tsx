import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { RiskTimelineOutput } from "@platform/contracts";
import { RiskTimelineOutputSchema } from "@platform/contracts";
import type { HistoryRiskCase } from "@platform/contracts";
import { fetchHistoryBundle, invokeSolver, queryTimeseriesAgg } from "@/api/endpoints";
import { useSessionStore } from "@/store/sessionStore";
import { Modal } from "@/components/ui/Modal";
import { EChart } from "@/components/ui/EChart";
import { heatColor, RiskHoverTrigger } from "@/components/Risk/RiskPopover";
import { useActionDraft } from "./sim/shared";
import type { ViewRendererProps } from "./registry";
import { InferenceProcessPanel } from "@/components/InferenceProcessPanel";
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
  const [ordersDay, setOrdersDay] = useState<{ base: string; day: number; orders: RiskCard["affectedOrders"] } | null>(null);

  if (isLoading || !data) return <div className="empty-state">{zh.common.loading}</div>;

  const maxPeak = Math.max(0, ...data.cards.map((c) => c.peak));
  return (
    <div>
      {/* §2.2-a 三档图例文案（红/黄/蓝档与 heat strip/MiniStrip 同色阈值口径）+ 首要风险（peak 最高）标注 */}
      <div data-testid="risk-legend" style={{ display: "flex", gap: 14, fontSize: 12, marginBottom: 8, alignItems: "center", color: "var(--muted)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, background: "#E0626C", borderRadius: 2 }} />{zh.risk.legendHigh}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, background: "#E8B54A", borderRadius: 2 }} />{zh.risk.legendMid}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, background: "#43B7D7", borderRadius: 2 }} />{zh.risk.legendLow}</span>
      </div>
      <div className={styles.grid}>
        {data.cards.map((card) => {
          const selected = selectedObjects.some((o) => o.label === card.base);
          const isPrimary = maxPeak > 0 && card.peak === maxPeak;
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
                useSessionStore.getState().setDockExpanded(true);
                setDetail(card);
              }}
              onKeyDown={(e) => e.key === "Enter" && setDetail(card)}
            >
              <div className={styles.cardHead}>
                <strong>{card.base}</strong>
                {isPrimary && <span className="badge" data-testid={`risk-primary-${card.base}`} style={{ background: "var(--danger)", color: "#fff", fontSize: 10 }}>{zh.risk.primaryTag}</span>}
                {/* §7.3 风险弹窗（与 order-chain 风险点 chip 共用 RiskPopover 组件） */}
                <RiskHoverTrigger
                  data={{ base: card.base, factor: card.factor, peak: card.peak, crossDay: card.crossDay, series: card.series, threshold: data.threshold }}
                  testId={`risk-factor-${card.base}`}
                >
                  <span className="badge">{card.factor}</span>
                </RiskHoverTrigger>
                {card.allFactors && card.allFactors.length > 0 && (
                  <span className="badge" style={{ fontSize: 10, opacity: 0.75 }}>
                    等{card.allFactors.length}项
                  </span>
                )}
              </div>
              {/* WO-DATAMODE-UNIFY-PROVENANCE（两正交维·诚实灰）：合成种子物化底料（provenanceSynthetic·provenance 维）
                  → 灰标"合成·未接实测"，绝不显"实测当前 N"（合成不冒充实测·KILL-MOCK-RED·铁律 0.4·用户裁定选项c=
                  接受诚实的灰）。非合成时保留 measurement 维语义（轨M 增量1）：MOCK→"估算（实测当前 N）"，
                  LIVE→"实测当前 N"（推演峰值锚定真测量值，R13 可溯）。 */}
              {card.provenanceSynthetic ? (
                <div className="badge" data-testid={`risk-datamode-${card.base}`}
                  style={{ background: "var(--panel-2, #232a33)", color: "var(--muted, #8a94a6)", fontSize: 10, alignSelf: "flex-start" }}>
                  合成·未接实测{card.currentTightness ? `（合成当前 ${Math.round(card.currentTightness.value)}）` : ""}
                </div>
              ) : card.dataMode === "MOCK" ? (
                <div className="badge" data-testid={`risk-datamode-${card.base}`}
                  style={{ background: "var(--warn, #caa23a)", color: "#1a1400", fontSize: 10, alignSelf: "flex-start" }}>
                  估算{card.currentTightness ? `（实测当前 ${Math.round(card.currentTightness.value)}）` : "（无实测）"}
                </div>
              ) : card.dataMode === "LIVE" && card.currentTightness ? (
                <div className="badge" data-testid={`risk-datamode-${card.base}`}
                  style={{ fontSize: 10, alignSelf: "flex-start", opacity: 0.8 }}>
                  实测当前 {Math.round(card.currentTightness.value)}
                </div>
              ) : null}
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
            {(() => {
              const orderDaySet = new Set(
                (detail.affectedOrders ?? [])
                  .map((o) => o.dueDay)
                  .filter((d) => d >= 0 && d < detail.series.length)
              );
              return detail.series.map((v, day) => {
                const hasOrders = orderDaySet.has(day);
                return (
                  <button
                    key={day}
                    className={styles.dayCell}
                    title={`D+${day} · ${v.toFixed(0)}${hasOrders ? " · 有受影响订单" : ""}`}
                    data-testid={`risk-day-${day}`}
                    style={{ background: heatColor(v, data.threshold) }}
                    onClick={() => {
                      if (v >= data.threshold - 15) {
                        setOrdersDay({ base: detail.base, day, orders: detail.affectedOrders });
                      }
                    }}
                  >
                    {hasOrders && <span className={styles.orderDot} />}
                  </button>
                );
              });
            })()}
          </div>
          {/* PRD-IND-risk §4.6 逐日事件可解释：标签 + 量化文案 + 来源系统（替代裸 type·amp） */}
          <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--muted)" }} data-testid="risk-events">
            {detail.events.map((e, i) => (
              <div key={i} data-testid={`risk-event-${i}`} style={{ marginBottom: 4 }}>
                <span className="mono" style={{ color: "var(--txt)" }}>D+{e.day}</span>
                {" · "}<b style={{ color: "var(--txt)" }}>{(e as { tag?: string }).tag ?? e.type}</b>
                {(e as { obj?: string }).obj ? <span style={{ color: "var(--muted2)" }}> · {(e as { obj?: string }).obj}</span> : null}
                {(e as { desc?: string }).desc ? <div>{(e as { desc?: string }).desc}</div> : <span> · amp {e.amp}</span>}
                {(e as { src?: string }).src ? <div style={{ fontSize: 10, color: "var(--muted2)" }} data-testid={`risk-event-src-${i}`}>来源：{(e as { src?: string }).src}</div> : null}
              </div>
            ))}
          </div>
          {/* cockpit P3 对症方案 → 工单（mitigation_select 优选 → 采纳经 adopt_mitigation Action 审批，R4 不直改） */}
          <MitigationPanel base={detail.base} factor={detail.factor} tightness={detail.peak} />
        </Modal>
      )}

      {ordersDay && <AffectedOrdersModal base={ordersDay.base} day={ordersDay.day} orders={ordersDay.orders} onClose={() => setOrdersDay(null)} />}

      {/* PRD-IND-risk §2.4：处置行动计划表（按越线日前置 7 天排启动 · 峰值≥90 配备份方案 · 14 天内反提 S&OP） */}
      {(data.planRows?.length ?? 0) > 0 && (
        <div className="panel" style={{ marginTop: 18 }} data-testid="risk-plan-panel">
          <div className="section-title">{zh.risk.planTitle}</div>
          <div style={{ fontSize: 11, color: "var(--muted2)", marginBottom: 8 }}>{zh.risk.planSub(data.planRows!.length)}</div>
          <table className="cmp" data-testid="risk-plan-table">
            <thead>
              <tr>
                <th>{zh.risk.planAct}</th>
                <th>{zh.risk.planDet}</th>
                <th>{zh.risk.planOwner}</th>
                <th>{zh.risk.planStart}</th>
                <th>{zh.risk.planDone}</th>
                <th>{zh.risk.planEff}</th>
                <th>{zh.risk.planRule}</th>
              </tr>
            </thead>
            <tbody>
              {data.planRows!.map((r, i) => (
                <tr key={i} data-testid={`risk-plan-row-${i}`}>
                  <td className="zh"><b>{r.act}</b></td>
                  <td className="zh">{r.det}</td>
                  <td className="zh">{r.owner}</td>
                  <td className="mono">{r.start}</td>
                  <td className="mono">{r.done}</td>
                  <td className="zh">{r.eff}</td>
                  <td><span className="badge">{r.rule}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 运营态出厂配置增量 §4.3：历史处置案例区（越线→采纳→消解；点击回放当时的时序曲线） */}
      <HistoricalCasesSection />
      {/* inference-process 横切：风险推演的编排过程 DAG */}
      <InferenceProcessPanel testId="inference-risk" solved />
    </div>
  );
}

function HistoricalCasesSection() {
  const { data } = useQuery({
    queryKey: ["a", "history-bundle", "risk-cases"],
    queryFn: () => fetchHistoryBundle({ pageSize: 1 }),
    retry: false,
  });
  const [replay, setReplay] = useState<HistoryRiskCase | null>(null);
  const cases = data?.riskCases ?? [];
  if (cases.length === 0) return null;
  return (
    <div style={{ marginTop: 20 }}>
      <div className="section-title">历史处置案例（{cases.length} 例 · 越线 → 采纳 → 消解）</div>
      <table className="cmp" data-testid="risk-cases-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>案例</th>
            <th>因子</th>
            <th>越线日</th>
            <th>采纳处置</th>
            <th>消解日</th>
            <th>受影响订单</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr
              key={c.id}
              data-testid={`risk-case-${c.caseNo}`}
              tabIndex={0}
              style={{ cursor: "pointer" }}
              onClick={() => setReplay(c)}
              onKeyDown={(e) => e.key === "Enter" && setReplay(c)}
            >
              <td className="mono">{c.caseNo}</td>
              <td className="zh">
                {c.title}
                {c.tags.map((t) => (
                  <span key={t} className="badge red" style={{ marginLeft: 6 }}>
                    {t}
                  </span>
                ))}
              </td>
              <td className="zh">{c.factor}</td>
              <td className="mono">{c.crossedAt}</td>
              <td className="zh">{c.mitigation.name}</td>
              <td className="mono">{c.resolvedAt}</td>
              <td className="mono">{c.affectedOrders.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {replay && <CaseReplayModal kase={replay} onClose={() => setReplay(null)} />}
    </div>
  );
}

/** 案例点击 → 回放当时的时序曲线（curve = query_timeseries_agg 参数，数字与回放写入同源） */
function CaseReplayModal({ kase, onClose }: { kase: HistoryRiskCase; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["a", "case-replay", kase.id],
    queryFn: () =>
      queryTimeseriesAgg({
        seriesKey: kase.curve.seriesKey,
        entityIds: [kase.curve.entityId],
        window: { from: kase.curve.from, to: kase.curve.to, grain: "day" },
        agg: "sum",
      }),
  });
  const points = data?.points ?? [];
  return (
    <Modal title={`${kase.caseNo} · ${kase.title}`} onClose={onClose} width={760}>
      <div data-testid="case-replay-modal">
        <div className="section-title">当时的时序曲线（{kase.curve.from} ~ {kase.curve.to}）</div>
        <EChart
          height={180}
          testId="case-replay-curve"
          option={{
            grid: { top: 14, bottom: 28, left: 48, right: 12 },
            tooltip: { trigger: "axis" },
            xAxis: { type: "category", data: points.map((p) => p.bucket.slice(0, 10)) },
            yAxis: { type: "value", splitLine: { lineStyle: { color: "rgba(226,235,245,.07)" } } },
            series: [
              {
                type: "line",
                smooth: true,
                data: points.map((p) => p.value),
                itemStyle: { color: "#43B7D7" },
                markLine: {
                  data: [
                    { xAxis: kase.crossedAt, label: { formatter: "越线" } },
                    { xAxis: kase.adoptedAt, label: { formatter: "采纳" } },
                    { xAxis: kase.resolvedAt, label: { formatter: "消解" } },
                  ],
                },
              },
            ],
          }}
        />
        <div className="section-title" style={{ marginTop: 10 }}>处置时间线</div>
        <div data-testid="case-timeline" style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
          {kase.timeline.map((t, i) => (
            <div key={i}>
              <span className="mono">{t.date}</span> · <span className="zh">{t.event}</span>
            </div>
          ))}
        </div>
        {kase.affectedOrders.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12.5 }} data-testid="case-affected-orders">
            受影响订单：{kase.affectedOrders.map((so) => (
              <span key={so} className="badge" style={{ marginRight: 4 }}>
                {so}
              </span>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * cockpit P3 · 对症方案 → 工单（mitigation_select 求解器按因子优选方案 → 采纳生成 adopt_mitigation
 * Action 草稿待审批，R4 真值经 Action；不直改）。方案库 = params.risk.mitigations 单一来源（全 7 因子可用）。
 */
type MitPlan = { key: string; name: string; eff: number; tn: number; cost: string; risk?: string; score: number };
function MitigationPanel({ base, factor, tightness }: { base: string; factor: string; tightness: number }) {
  const adopt = useActionDraft();
  const { data, isLoading } = useQuery({
    queryKey: ["a", "mitigation_select", base, factor, tightness],
    queryFn: async () => {
      const res = await invokeSolver("mitigation_select", { baseName: base, factor, tightness });
      return res.data as { plans?: MitPlan[]; recommended?: string; error?: string };
    },
  });
  return (
    <div style={{ marginTop: 14 }} data-testid="mitigation-panel">
      <div className="section-title">对症方案（按 见效/成本/周期 优选 · 采纳 → 工单审批）</div>
      {isLoading ? (
        <div style={{ color: "var(--muted2)" }}>{zh.common.loading}</div>
      ) : !data?.plans?.length ? (
        <div className="empty-state">{zh.common.none}</div>
      ) : (
        <table className="cmp" data-testid="mitigation-plans-table">
          <thead>
            <tr>
              <th>方案</th><th>见效(pp)</th><th>周期(周)</th><th>成本</th><th>风险</th><th>评分</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.plans.map((p) => (
              <tr key={p.key} data-testid={`mitigation-plan-${p.key}`}>
                <td className="zh">
                  {p.name}
                  {p.key === data.recommended && <span className="badge" style={{ marginLeft: 6, background: "#36BFA5", color: "#fff" }}>推荐</span>}
                </td>
                <td className="mono">{p.eff}</td>
                <td className="mono">{p.tn}</td>
                <td className="zh">{p.cost}</td>
                <td className="zh">{p.risk ?? "—"}</td>
                <td className="mono">{p.score}</td>
                <td>
                  <button
                    className="btn-sm"
                    data-testid={`mitigation-adopt-${p.key}`}
                    disabled={adopt.isPending}
                    onClick={() => adopt.mutate({ actionTypeKey: "adopt_mitigation", payload: { base, factor, planKey: p.key } })}
                  >
                    采纳→工单
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
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

/** 时点点击 → 受影响订单弹窗（直接使用 risk_timeline 卡片已计算的 affectedOrders，零额外请求） */
function AffectedOrdersModal({
  base,
  day,
  orders,
  onClose,
}: {
  base: string;
  day: number;
  orders: RiskCard["affectedOrders"];
  onClose: () => void;
}) {
  const list = (orders ?? []).filter((o) => (o as { dueDay?: number }).dueDay === day);
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
          {list.map((o, i) => (
            <tr key={i}>
              <td>{String(o.so ?? "—")}</td>
              <td className="zh">{String(o.cust ?? "—")}</td>
              <td>{String(o.model ?? "—")}</td>
              <td>{String(o.qty ?? "—")}</td>
              <td>{String(o.due ?? "—")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length === 0 && <div className="empty-state">{zh.common.none}</div>}
    </Modal>
  );
}
