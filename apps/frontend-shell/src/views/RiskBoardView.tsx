import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RiskTimelineOutput } from "@platform/contracts";
import { RiskTimelineOutputSchema, BottleneckMatrixOutputSchema, SEG_REGISTRY } from "@platform/contracts";
import type { HistoryRiskCase } from "@platform/contracts";
import {
  fetchHistoryBundle,
  invokeSolver,
  queryTimeseriesAgg,
  saveLiveScenario,
  listLiveScenarios,
  compareLiveScenarios,
  type LiveScenario,
  type LiveScenarioMatrix,
} from "@/api/endpoints";
import { useSessionStore } from "@/store/sessionStore";
import { Modal } from "@/components/ui/Modal";
import { EChart } from "@/components/ui/EChart";
import { heatColor, RiskHoverTrigger } from "@/components/Risk/RiskPopover";
import { useActionDraft } from "./sim/shared";
import { DynamicLeverPanel } from "./sim/DynamicLeverPanel";
import type { ViewRendererProps } from "./registry";
import { InferenceProcessPanel } from "@/components/InferenceProcessPanel";
import { BaseOutlookPanel } from "./BaseOutlookPanel";
import { CapacityDerivationDag } from "./capacity/CapacityDerivationDag";
import { CapacityRampEnvelope } from "./capacity/CapacityRampEnvelope";
import { CapacityFactorOntology } from "./capacity/CapacityFactorOntology";
import { CapacityLiveDialog } from "./capacity/CapacityLiveDialog";
import { Provenance } from "@/components/Provenance";
import { DispositionDetailPanel } from "./DispositionDetailPanel";
import { ProvenanceDag, gapAttributionToBaseRootCause, type GapAttrOutput, type DagData } from "@/components/ProvenanceDag";
import { matchRiskFactorToRootCause } from "@/config/riskFactorTaxonomy";
import zh from "@/locales/zh";
import styles from "./RiskBoardView.module.css";

/** WO-CAPLIVE-2 · 产能活台当前推演态（杠杆组合 + 增益 + 影响面）——DynamicLeverPanel 上抛，供方案存/横比消费。 */
type LiveLeverState = { apply: { objectType: string; objectId: string; prop: string; value: number }[]; capGain: number; affected: number };

type RiskCard = RiskTimelineOutput["cards"][number];
type BottleneckOutput = ReturnType<typeof BottleneckMatrixOutputSchema.parse>;

/** 越线带宽（阈值下探关注区）：阈值−15 起为「关注」。参照 HTML 三档口径。 */
const BAND = 15;
/** 电池产量单位（换行业经 ViewConfig.layout.unit 下发·此处域内兜底）。WO-UNIT-NORMALIZE：Order.qty 单位=套。 */
const UNIT = "套"; // debattery-allow
/** WO-UNIT-NORMALIZE：万元→亿 单位换算（NOT 业务常数·R14）。营收=Σ qty(套)×priceWan(万元)→ /1e4 = 亿。 */
const wanToYi = (v: number) => v / 1e4;

/**
 * 三档色（与 heatColor 同阈值口径·用于文字/边框实色）：≥阈值 高危红 · [阈值−15,阈值) 关注黄 · <阈值−15 正常青。
 * v 为空（无实测/无逐日源）→ 中性灰（诚实·不伪造分档）。
 */
function tierColor(v: number | null | undefined, threshold: number): string {
  if (v == null) return "var(--muted2)";
  if (v >= threshold) return "#E0626C";
  if (v >= threshold - BAND) return "#E8B54A";
  return "#43B7D7";
}

/**
 * WO-CAPSIM-REPLICA · 「产能推演」看板（renderer=risk-board·PRD §7.3）：1:1 复刻黑曜石参照 HTML 几何。
 * rk-top（标题+视角/窗口 chip）→ rk-kpi（5 指标条）→ rk-grid（每基地一卡·因素 chip）→ 点开内联 rk-det
 * （逐因素时间轴 + 对症方案 + 对话态 QA）→ 处置计划表（导出最终规划）。数据全接真求解器（risk_timeline /
 * bottleneck_matrix / mitigation_select / affected_orders）。
 * WO-DATAMODE-UNIFY-PROVENANCE：合成种子底料（card.provenanceSynthetic）走诚实灰徽章「合成·未接实测」，
 * 绝不显「实测/LIVE」（KILL-MOCK-RED·铁律 0.4·用户裁定选项c=接受诚实的灰）。数字仍是真求解器输出（可展示）。
 */
export default function RiskBoardView(_props: ViewRendererProps) {
  // 交互态：H=推演窗口 30/60/90 天；riskTab=瓶颈视角/订单聚合 两态互斥；openBase=内联展开基地（非 modal）。
  const [horizon, setHorizon] = useState(30);
  const [riskTab, setRiskTab] = useState<"risk" | "order">("risk");
  const [openBase, setOpenBase] = useState<string | null>(null);
  const [ordersDay, setOrdersDay] = useState<{ card: RiskCard; day: number } | null>(null);
  // WO-LIVE-DISPOSITION：当前活推演杠杆 overlay（DynamicLeverPanel 上抛），用于重算行动计划。
  const [liveApply, setLiveApply] = useState<{ base: string; apply: { objectType: string; objectId: string; prop: string; value: number }[] } | null>(null);
  const [regenArgs, setRegenArgs] = useState<{ apply: { objectType: string; objectId: string; prop: string; value: number }[] } | null>(null);
  const [expandedPlanRow, setExpandedPlanRow] = useState<number | null>(null);

  const timelineArgs = useMemo(() => {
    const base: Record<string, unknown> = { horizon };
    if (regenArgs?.apply && regenArgs.apply.length > 0) base.apply = regenArgs.apply;
    return base;
  }, [horizon, regenArgs]);

  const { data, isLoading } = useQuery({
    queryKey: ["a", "risk-timeline", timelineArgs],
    queryFn: async () => {
      const res = await invokeSolver("risk_timeline", timelineArgs);
      return RiskTimelineOutputSchema.parse(res.data);
    },
  });
  // 逐因素当前张力（基地×7因素）——供卡面因素 chip + 详情逐因素行（主因素外的因素当前值·非逐日）。
  const { data: bn } = useQuery({
    queryKey: ["a", "bottleneck_matrix", "board"],
    queryFn: async () => {
      const res = await invokeSolver("bottleneck_matrix", { dataMode: "LIVE" });
      return BottleneckMatrixOutputSchema.parse(res.data);
    },
  });

  const selectedObjects = useSessionStore((s) => s.selectedObjects);

  if (isLoading || !data) return <div className="empty-state">{zh.common.loading}</div>;

  const threshold = data.threshold;
  const cards = data.cards;

  // 逐基地取 bottleneck 行（base 名直配·mock/real 同为中文名）。
  const bnRow = (base: string): BottleneckOutput["rows"][number] | undefined => bn?.rows.find((r) => r.base === base);
  // 越线/临近因素（≥阈值−15），按张力降序。
  const factorsOver = (base: string): { factor: string; value: number | null }[] => {
    const row = bnRow(base);
    if (!row) return [];
    return (bn?.factors ?? [])
      .map((f) => ({ factor: f, value: row.tightness[f] ?? null }))
      .filter((x) => x.value != null && x.value >= threshold - BAND)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  };
  // 卡面因素 chip：该基地张力最高的前 N 个真因素（1:1 每卡若干 chip·真值·非硬编）。
  const topFactors = (base: string, n: number): { factor: string; value: number | null }[] => {
    const row = bnRow(base);
    if (!row) return [];
    return (bn?.factors ?? [])
      .map((f) => ({ factor: f, value: row.tightness[f] ?? null }))
      .filter((x) => x.value != null)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      .slice(0, n);
  };

  const maxPeak = cards.length ? Math.max(0, ...cards.map((c) => c.peak)) : 0;

  // rk-kpi 5 指标（全聚合自真 risk_timeline / bottleneck·非硬编）。
  const riskFactorPoints = cards.reduce((s, c) => s + Math.max(1, factorsOver(c.base).length), 0);
  const allOrders = new Set(cards.flatMap((c) => (c.affectedOrders ?? []).map((o) => String(o.so ?? "")).filter(Boolean)));
  const allCusts = new Set(cards.flatMap((c) => (c.affectedOrders ?? []).map((o) => String(o.cust ?? "")).filter(Boolean)));
  const crossDays = cards.map((c) => c.crossDay).filter((d): d is number => d != null);
  const earliestCross = crossDays.length ? Math.min(...crossDays) : null;

  const openCard = openBase ? cards.find((c) => c.base === openBase) ?? null : null;

  return (
    <div className={styles.riskwrap}>
      {/* rk-top：标题 + 视角/窗口 chip。瓶颈视角为主态；30/60/90 天切窗口重算 risk_timeline。 */}
      <div className={styles.rkTop}>
        <div>
          <h3>产能推演</h3>
          <div className={styles.rkSub}>
            计划-执行之桥：监测执行偏离月度计划的风险 · 未来 {horizon} 天内预测越线（紧张度 ≥ {threshold}）· 偏离 → 处置 Action 或反提月度差异（C21）
          </div>
        </div>
        <div className={styles.rkHsel}>
          <span className={`${styles.tierChip} ${riskTab === "risk" ? styles.tierChipOn : ""}`} data-testid="risk-tab-risk" role="button" tabIndex={0}
            onClick={() => setRiskTab("risk")} onKeyDown={(e) => e.key === "Enter" && setRiskTab("risk")}>瓶颈视角</span>
          <span className={`${styles.tierChip} ${riskTab === "order" ? styles.tierChipOn : ""}`} data-testid="risk-tab-order" role="button" tabIndex={0}
            onClick={() => setRiskTab("order")} onKeyDown={(e) => e.key === "Enter" && setRiskTab("order")}>订单聚合</span>
          <span style={{ width: 10 }} />
          {[30, 60, 90].map((h) => (
            <span
              key={h}
              className={`${styles.tierChip} ${horizon === h ? styles.tierChipOn : ""}`}
              data-testid={`risk-window-${h}`}
              role="button"
              tabIndex={0}
              onClick={() => setHorizon(h)}
              onKeyDown={(e) => e.key === "Enter" && setHorizon(h)}
            >
              {h}天
            </span>
          ))}
        </div>
      </div>

      {/* rk-kpi 条：5 指标（值全源自真 risk_timeline/bottleneck）。 */}
      <div className={styles.rkKpi} data-testid="risk-kpi">
        <RkK testId="risk-kpi-bases" value={String(cards.length)} label="风险基地" color="#E0626C" />
        <RkK testId="risk-kpi-factorpts" value={String(riskFactorPoints)} label="风险因素点" color="var(--c-solver)" />
        <RkK testId="risk-kpi-orders" value={allOrders.size > 0 ? String(allOrders.size) : "—"} label="受影响订单(批)" color="var(--c-forecast)" />
        <RkK testId="risk-kpi-custs" value={allCusts.size > 0 ? String(allCusts.size) : "—"} label="涉及客户" color="var(--c-capacity)" />
        <RkK testId="risk-kpi-earliest" value={earliestCross != null ? `T+${earliestCross}` : "—"} label="最早越线日" color="var(--c-solver)" />
      </div>

      {/* 订单聚合 tab → 经营聚合表 + 订单明细（真 affected_orders·无源列诚实空态）。 */}
      {riskTab === "order" && <OrderAggView horizon={horizon} />}

      {riskTab === "risk" && (
        <>
          {/* rk-grid：每基地一卡（整卡点击展开·无独立 CTA）。因素 chip 来自 bottleneck 真值。 */}
          <div className={styles.rkGrid}>
            {cards.map((card) => {
              const selected = selectedObjects.some((o) => o.label === card.base) || openBase === card.base;
              const synth = card.provenanceSynthetic === true;
              const peakColor = tierColor(card.peak, threshold);
              const chips = topFactors(card.base, 2);
              const isPrimary = maxPeak > 0 && card.peak === maxPeak;
              const orderCount = card.affectedOrders?.length ?? 0;
              const factorCount = Math.max(1, factorsOver(card.base).length);
              return (
                <div
                  key={card.base}
                  className={`${styles.rkCard} ${selected ? styles.rkCardOpen : ""}`}
                  data-testid={`risk-card-${card.base}`}
                  data-synth={synth ? "1" : "0"}
                  role="button"
                  tabIndex={0}
                  style={{ borderColor: `${peakColor}55` }}
                  onClick={() => {
                    useSessionStore.getState().toggleSelectedObject({ objectType: "Base", objectId: `base-${card.base}`, label: card.base });
                    setOpenBase((b) => (b === card.base ? null : card.base));
                  }}
                  onKeyDown={(e) => e.key === "Enter" && setOpenBase((b) => (b === card.base ? null : card.base))}
                >
                  <div className={styles.rkCH}>
                    <b>
                      {card.base}
                      {isPrimary && <span className="badge" data-testid={`risk-primary-${card.base}`} style={{ marginLeft: 6, background: "var(--danger)", color: "#fff", fontSize: 9 }}>{zh.risk.primaryTag}</span>}
                    </b>
                    <RiskHoverTrigger
                      data={{ base: card.base, factor: card.factor, peak: card.peak, crossDay: card.crossDay, series: card.series, threshold }}
                      testId={`risk-factor-${card.base}`}
                    >
                      <span className={styles.rkOwn} style={{ color: peakColor }}>{card.factor}</span>
                    </RiskHoverTrigger>
                  </div>
                  {/* 诚实灰：合成种子底料 → 「合成·未接实测」（provenance 维·绝不显「实测」）。 */}
                  {synth && (
                    <span className={styles.rkSynth} data-testid={`risk-datamode-${card.base}`}>合成·未接实测</span>
                  )}
                  <div className={styles.rkCM}>
                    <span className={styles.rkPeak} data-testid={`risk-peak-${card.base}`} style={{ color: peakColor }}>
                      <Provenance
                        testId={`risk-peak-prov-${card.base}`}
                        src="risk_timeline 求解器"
                        formula="峰值张力 = max(逐日张力 series)；越线日 = 首个张力 ≥ 阈值之日（张力口径 0–100·越高越紧）"
                        inputs={[
                          card.currentTightness?.value != null
                            ? `当前张力 ${Math.round(card.currentTightness.value)}${card.currentTightness.live ? "（实测）" : "（估算）"}`
                            : "当前张力 —（无实测源）",
                          `阈值 ${threshold}`,
                          `峰值 ${Math.round(card.peak)}`,
                        ]}
                        note={synth ? "合成种子底料·未接实测（provenance 维·KILL-MOCK-RED）" : undefined}
                      >
                        {card.crossDay != null ? `T+${card.crossDay}` : card.peak.toFixed(0)}
                      </Provenance>
                    </span>
                    <span className={styles.rkUnit}>{card.crossDay != null ? "最早越线" : "峰值张力"}</span>
                  </div>
                  {chips.length > 0 && (
                    <div className={styles.rkChips} data-testid={`risk-chips-${card.base}`}>
                      {chips.map((ch) => {
                        const col = tierColor(ch.value, threshold);
                        return (
                          <span key={ch.factor} className={styles.rkFchip} style={{ borderColor: `${col}66`, color: col }}>
                            {ch.factor} {ch.value != null ? Math.round(ch.value) : "—"}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div className={styles.rkCF}>
                    <span style={{ color: peakColor }}>{factorCount} 个风险因素</span>
                    <span>{orderCount} 批订单受影响</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 内联详情（非 modal）：逐因素时间轴 + 对症方案 + 对话态 QA。 */}
          {openCard && (
            <RiskDetailPanel
              card={openCard}
              bnRow={bnRow(openCard.base)}
              bnFactors={bn?.factors ?? []}
              threshold={threshold}
              horizon={horizon}
              isPrimary={maxPeak > 0 && openCard.peak === maxPeak}
              onDay={(day) => setOrdersDay({ card: openCard, day })}
              onLiveState={(s) => setLiveApply({ base: openCard.base, apply: s.apply })}
            />
          )}

          {ordersDay && <AffectedOrdersModal card={ordersDay.card} day={ordersDay.day} onClose={() => setOrdersDay(null)} />}

          {/* 处置计划表：按越线日前置排启动·采纳经审批下发工单。导出最终规划 + 活推演重算行动计划。 */}
          {(data.planRows?.length ?? 0) > 0 && (
            <div className={styles.rkDet} style={{ marginTop: 14 }} data-testid="risk-plan-panel">
              <div className={styles.rkDetH}>
                <b>📋 {zh.risk.planTitle}</b>
                <span>
                  {zh.risk.planSub(data.planRows!.length)}
                  {"　"}
                  <span
                    className={styles.tierChip}
                    data-testid="risk-plan-regenerate"
                    role="button"
                    tabIndex={0}
                    style={{ display: "inline-block" }}
                    onClick={() => setRegenArgs({ apply: liveApply?.apply ?? [] })}
                    onKeyDown={(e) => e.key === "Enter" && setRegenArgs({ apply: liveApply?.apply ?? [] })}
                  >
                    {zh.risk.regeneratePlan}
                  </span>
                  {"　"}
                  <span className={styles.tierChip} data-testid="risk-plan-export" role="button" tabIndex={0}
                    style={{ display: "inline-block" }}
                    onClick={() => exportPlanRows(data.planRows!, zh.risk.planTitle)}
                    onKeyDown={(e) => e.key === "Enter" && exportPlanRows(data.planRows!, zh.risk.planTitle)}>
                    ⬇ 导出最终规划
                  </span>
                </span>
              </div>
              <table className="cmp" data-testid="risk-plan-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{zh.risk.planAct}</th>
                    <th>{zh.risk.planOwner}</th>
                    <th>{zh.risk.planStart}</th>
                    <th>{zh.risk.planDone}</th>
                    <th>{zh.risk.planEff}</th>
                    <th>{zh.risk.planRule}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.planRows!.map((r, i) => (
                    <>
                      <tr
                        key={i}
                        data-testid={`risk-plan-row-${i}`}
                        className={expandedPlanRow === i ? styles.rkCardOpen : ""}
                        style={{ cursor: r.steps && r.steps.length > 0 ? "pointer" : "default" }}
                        role={r.steps && r.steps.length > 0 ? "button" : undefined}
                        tabIndex={r.steps && r.steps.length > 0 ? 0 : undefined}
                        onClick={() => r.steps && r.steps.length > 0 && setExpandedPlanRow((prev) => (prev === i ? null : i))}
                        onKeyDown={(e) => e.key === "Enter" && r.steps && r.steps.length > 0 && setExpandedPlanRow((prev) => (prev === i ? null : i))}
                      >
                        <td className="mono"><b>{i + 1}</b></td>
                        <td className="zh"><b>{r.act}</b>{r.det ? <><br /><span style={{ fontSize: 9, color: "var(--muted2)" }}>{r.det}</span></> : null}</td>
                        <td className="zh">{r.owner}</td>
                        <td className="mono" style={{ whiteSpace: "nowrap" }}>{r.start}</td>
                        <td className="mono" style={{ whiteSpace: "nowrap" }}>{r.done}</td>
                        <td className="zh" style={{ color: "var(--ok)" }}>{r.eff}</td>
                        <td><span className="badge">{r.rule}</span></td>
                      </tr>
                      {expandedPlanRow === i && r.steps && r.steps.length > 0 && (
                        <tr data-testid={`risk-plan-detail-${i}`}>
                          <td colSpan={7} style={{ padding: 0, border: "none" }}>
                            <DispositionDetailPanel steps={r.steps} />
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* 历史处置案例 + 风险推演编排过程 DAG（两态共享·看板下半区）。 */}
      <HistoricalCasesSection />
      <InferenceProcessPanel testId="inference-risk" solved />
    </div>
  );
}

/** 导出最终规划：前端生成独立浅色系静态 HTML 表格文档并触发下载（非截图·去交互态·字段同页表·可进 S&OP 附件）。 */
function exportPlanRows(rows: { act: string; det?: string; owner: string; start: string; done: string; eff: string; rule: string }[], title: string) {
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m] ?? m));
  const trs = rows.map((r, i) => `<tr><td>${i + 1}</td><td><b>${esc(r.act)}</b>${r.det ? `<br><small>${esc(r.det)}</small>` : ""}</td><td>${esc(r.owner)}</td><td>${esc(r.start)}</td><td>${esc(r.done)}</td><td>${esc(r.eff)}</td><td>${esc(r.rule)}</td></tr>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:1050px;margin:24px auto;color:#1b2733}h2{font-size:18px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #dde3ea;padding:7px 9px;text-align:left}th{background:#f3f6f9}small{color:#6a7787}</style><h2>${esc(title)}</h2><table><thead><tr><th>#</th><th>行动项</th><th>负责人</th><th>启动</th><th>完成</th><th>预期效果</th><th>依据/规则</th></tr></thead><tbody>${trs}</tbody></table><p style="font-size:11px;color:#8a98a8">导出含口径，可直接进入 S&amp;OP 决议附件。</p>`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[\s·]/g, "")}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type OrderAgg = {
  summary?: { orderCount: number; totalQty: number; custCount: number; revenue: number };
  rows?: { so: string; cust: string; seg: string; model: string; qty: number; due: string; delay: number; risks?: { base?: string; factor?: string; crossDay?: number | null }[] }[];
};

/**
 * 订单聚合视图（riskTab==='order'）：受影响订单经营聚合表 + 订单明细。接真 affected_orders 求解器
 * （summary/rows·真订单·跨基地聚合）。经营表营收/毛利经 SEG_REGISTRY 单一真相源真聚合（R6·非写死 0）；
 * 库存/产能列平台暂无真源 → 诚实"—"（G-DM-1·不伪造·KILL-MOCK-RED）。基地筛选 base 参传后端真裁剪。
 */
function OrderAggView({ horizon }: { horizon: number }) {
  const [seg, setSeg] = useState<"app" | "base">("app");
  const [baseFilter, setBaseFilter] = useState<string>("__all__");
  const { data, isLoading } = useQuery({
    queryKey: ["a", "affected_orders", "agg", horizon, baseFilter],
    queryFn: async () => {
      const res = await invokeSolver("affected_orders", { horizon, ...(baseFilter !== "__all__" ? { base: baseFilter } : {}) });
      return res.data as OrderAgg;
    },
  });
  // 单价/毛利率单一真相源 = SEG_REGISTRY（按细分名或 key 均可查·R6 字节复现）。
  const segPrice = useMemo(() => Object.fromEntries(SEG_REGISTRY.flatMap((s) => [[s.seg, s.priceWan], [s.key, s.priceWan]])) as Record<string, number>, []);
  const segMargin = useMemo(() => Object.fromEntries(SEG_REGISTRY.flatMap((s) => [[s.seg, s.marginPct], [s.key, s.marginPct]])) as Record<string, number>, []);

  if (isLoading) return <div className="empty-state">{zh.common.loading}</div>;
  const rows = data?.rows ?? [];
  const bases = [...new Set(rows.flatMap((r) => (r.risks ?? []).map((k) => String(k.base ?? "")).filter(Boolean)))];
  // 经营聚合行：app→按 r.seg 聚 · base→按 risks.base 聚。营收=Σ qty×细分单价、毛利=营收×细分毛利率（真值·非写死 0；
  // 跨多基地订单在 base 维不做均摊·计入每关联基地·口径注文案说明）。库存/产能列平台无该维度真源→诚实"—"。
  const econRows: { name: string; revenue: number; gp: number; marginPct: number | null; orderCount: number }[] =
    seg === "app"
      ? [...new Set(rows.map((r) => r.seg))].map((name) => {
          const rs = rows.filter((r) => r.seg === name);
          const revenue = rs.reduce((s, r) => s + r.qty * (segPrice[r.seg] ?? 0), 0);
          const gp = rs.reduce((s, r) => s + r.qty * (segPrice[r.seg] ?? 0) * ((segMargin[r.seg] ?? 0) / 100), 0);
          return { name, revenue, gp, marginPct: revenue > 0 ? (gp / revenue) * 100 : null, orderCount: rs.length };
        })
      : bases.map((b) => {
          const rs = rows.filter((r) => (r.risks ?? []).some((k) => String(k.base ?? "") === b));
          const revenue = rs.reduce((s, r) => s + r.qty * (segPrice[r.seg] ?? 0), 0);
          const gp = rs.reduce((s, r) => s + r.qty * (segPrice[r.seg] ?? 0) * ((segMargin[r.seg] ?? 0) / 100), 0);
          return { name: b, revenue, gp, marginPct: revenue > 0 ? (gp / revenue) * 100 : null, orderCount: rs.length };
        });
  const totalRev = econRows.reduce((s, r) => s + r.revenue, 0);
  const totalGp = econRows.reduce((s, r) => s + r.gp, 0);

  return (
    <div data-testid="risk-order-agg">
      {/* 经营数据聚合表 + 分类维度切换。 */}
      <div className={styles.rkDet} style={{ marginTop: 4 }}>
        <div className={styles.rkDetH}>
          <b>受影响订单 · 经营数据看板</b>
          <span>这些订单牵动的产能与财务（{seg === "app" ? "按应用细分" : "按基地"}）· 金额单位 亿元</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", margin: "4px 0 12px", display: "flex", alignItems: "center", gap: 7 }}>
          分类维度：
          <span className={`${styles.tierChip} ${seg === "app" ? styles.tierChipOn : ""}`} data-testid="risk-seg-app" role="button" tabIndex={0} onClick={() => setSeg("app")} onKeyDown={(e) => e.key === "Enter" && setSeg("app")}>应用细分</span>
          <span className={`${styles.tierChip} ${seg === "base" ? styles.tierChipOn : ""}`} data-testid="risk-seg-base" role="button" tabIndex={0} onClick={() => setSeg("base")} onKeyDown={(e) => e.key === "Enter" && setSeg("base")}>按基地</span>
        </div>
        {econRows.length === 0 ? (
          <div className="empty-state" style={{ fontSize: 12 }}>{zh.common.none}</div>
        ) : (
          <table className="cmp" data-testid="risk-econ-table">
            <thead>
              <tr>
                <th>{seg === "app" ? "应用分类" : "基地"}</th><th>受影响产能({UNIT})</th><th>成品库存</th><th>半成品库存</th><th>原材料库存</th>
                <th>未结订单金额</th><th>毛利额</th><th>毛利率</th>
              </tr>
            </thead>
            <tbody>
              {econRows.map((r) => (
                <tr key={r.name} data-testid={`risk-econ-row-${r.name}`}>
                  <td className="zh"><b>{r.name}</b> <span style={{ color: "var(--muted2)", fontSize: 10 }}>({r.orderCount})</span></td>
                  <td className="mono" style={{ color: "var(--muted2)" }} title="平台暂无该维度受影响产能真源">—</td>
                  <td className="mono" style={{ color: "var(--muted2)" }} title="平台暂无成品库存真源">—</td>
                  <td className="mono" style={{ color: "var(--muted2)" }}>—</td>
                  <td className="mono" style={{ color: "var(--muted2)" }}>—</td>
                  <td className="mono" style={{ color: "var(--c-forecast)", fontWeight: 700 }}>
                    {r.revenue > 0 ? (
                      <Provenance testId={`risk-econ-rev-${r.name}`} src="affected_orders × SEG_REGISTRY" formula="营收(亿) = Σ 数量 × SEG 参考单价(万元/套) ÷ 1e4" inputs={["受影响订单数量", "SEG_REGISTRY 参考单价"]} note="估算口径 · SEG 参考单价（合约域单一来源）非逐单实际成交价">
                        {`${wanToYi(r.revenue).toFixed(1)} 亿`}
                      </Provenance>
                    ) : "—"}
                  </td>
                  <td className="mono" style={{ color: "var(--ok)", fontWeight: 700 }}>
                    {r.gp > 0 ? (
                      <Provenance testId={`risk-econ-gp-${r.name}`} src="affected_orders × SEG_REGISTRY" formula="毛利额(亿) = 营收 × SEG 参考毛利率" inputs={["营收", "SEG_REGISTRY 参考毛利率"]} note="估算口径 · SEG 参考毛利率非财务实测值">
                        {`${wanToYi(r.gp).toFixed(1)} 亿`}
                      </Provenance>
                    ) : "—"}
                  </td>
                  <td className="mono">
                    {r.marginPct != null ? (
                      <Provenance testId={`risk-econ-gm-${r.name}`} src="派生（affected_orders × SEG_REGISTRY）" formula="毛利率 = 毛利额 ÷ 营收 × 100%" inputs={["毛利额", "营收"]} note="估算口径 · 随 SEG 参考单价/毛利率派生">
                        {`${r.marginPct.toFixed(1)}%`}
                      </Provenance>
                    ) : "—"}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: "1px solid var(--line2)" }}>
                <td className="zh"><b>合计</b></td><td className="mono" style={{ color: "var(--muted2)" }}>—</td><td className="mono" style={{ color: "var(--muted2)" }}>—</td><td className="mono" style={{ color: "var(--muted2)" }}>—</td><td className="mono" style={{ color: "var(--muted2)" }}>—</td>
                <td className="mono" style={{ color: "var(--c-forecast)", fontWeight: 700 }} data-testid="risk-econ-total-rev">
                  {totalRev > 0 ? (
                    <Provenance testId="risk-econ-total-rev" src="affected_orders × SEG_REGISTRY" formula="合计营收(亿) = Σ 各细分营收" inputs={["各行营收（数量×SEG 参考单价）"]} note="估算口径 · SEG 参考单价非逐单实际成交价">
                      {`${wanToYi(totalRev).toFixed(1)} 亿`}
                    </Provenance>
                  ) : "—"}
                </td>
                <td className="mono" style={{ color: "var(--ok)", fontWeight: 700 }}>
                  {totalGp > 0 ? (
                    <Provenance testId="risk-econ-total-gp" src="affected_orders × SEG_REGISTRY" formula="合计毛利额(亿) = Σ 各细分毛利额" inputs={["各行毛利额"]} note="估算口径 · SEG 参考毛利率非财务实测值">
                      {`${wanToYi(totalGp).toFixed(1)} 亿`}
                    </Provenance>
                  ) : "—"}
                </td>
                <td className="mono">
                  {totalRev > 0 ? (
                    <Provenance testId="risk-econ-total-gm" src="派生（affected_orders × SEG_REGISTRY）" formula="综合毛利率 = 合计毛利额 ÷ 合计营收 × 100%" inputs={["合计毛利额", "合计营收"]} note="估算口径 · 随 SEG 参考单价/毛利率派生">
                      {`${((totalGp / totalRev) * 100).toFixed(1)}%`}
                    </Provenance>
                  ) : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        )}
        <div style={{ fontSize: 10.5, color: "var(--muted2)", lineHeight: 1.5, marginTop: 8 }}>
          未结订单金额/毛利额/毛利率经 affected_orders 真订单 × SEG_REGISTRY 单价勾稽真聚合（R13 可溯·R6 单一真相源）；产能/库存列平台暂无该维度真数据源 → 诚实"—"（不伪造·G-DM-1）。
        </div>
      </div>

      {/* 基地筛选 + 订单明细表。 */}
      <div style={{ fontSize: 12, color: "var(--muted)", margin: "12px 0 14px", display: "flex", alignItems: "center", gap: 9 }}>
        基地筛选：
        <select data-testid="risk-order-basesel" value={baseFilter} onChange={(e) => setBaseFilter(e.target.value)}
          style={{ background: "var(--panel)", border: "1px solid var(--line2)", borderRadius: 8, color: "var(--txt)", padding: "6px 12px", fontSize: 12, cursor: "pointer", minWidth: 170 }}>
          <option value="__all__">全部风险基地（{bases.length}）</option>
          {bases.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        {baseFilter !== "__all__" && (
          <span className={styles.rkFchip} data-testid="risk-order-clearbase" role="button" tabIndex={0}
            style={{ borderColor: "var(--c-capacity)", color: "var(--c-capacity)", cursor: "pointer" }}
            onClick={() => setBaseFilter("__all__")} onKeyDown={(e) => e.key === "Enter" && setBaseFilter("__all__")}>✕ 清除（当前：{baseFilter}）</span>
        )}
      </div>
      <div className={styles.rkDet} style={{ marginTop: 0 }}>
        <div className={styles.rkDetH}>
          <b>受影响订单 · 明细（{baseFilter === "__all__" ? "全部" : baseFilter}）</b>
          <span>{data?.summary?.orderCount ?? rows.length} 批 · {data?.summary?.custCount ?? 0} 家客户 · 按交期排序</span>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state" data-testid="risk-order-empty" style={{ fontSize: 12 }}>当前范围无受影响订单（无在产订单落入越线传导窗口）。</div>
        ) : (
          <table className="cmp" data-testid="risk-order-detail-table">
            <thead>
              <tr><th>订单</th><th>客户</th><th>应用</th><th>型号</th><th>数量</th><th>交期</th><th>关联风险点</th><th>延误</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={String(r.so ?? i)} data-testid={`risk-order-row-${r.so ?? i}`}>
                  <td className="mono"><b>{r.so}</b></td>
                  <td className="zh">{r.cust}</td>
                  <td><span className={styles.rkFchip} style={{ borderColor: "var(--c-capacity)", color: "var(--c-capacity)" }}>{r.seg}</span></td>
                  <td className="zh">{r.model}</td>
                  <td className="mono">
                    <Provenance testId={`risk-order-qty-${r.so ?? i}`} src="affected_orders 求解器（订单域）" formula="订单数量（套）= Order.qty 原值" inputs={[`SO ${r.so}`, `型号 ${r.model}`]} note="真值 · 受影响订单逐单数量">
                      {r.qty}
                    </Provenance>{" "}{UNIT}
                  </td>
                  <td className="mono"><b>{r.due}</b></td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, maxWidth: 420 }}>
                      {(r.risks ?? []).slice(0, 4).map((k, j) => (
                        <span key={j} className={styles.rkFchip} style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{k.base}·{k.factor}{k.crossDay != null ? ` T+${k.crossDay}` : ""}</span>
                      ))}
                      {(r.risks ?? []).length > 4 && <span className={styles.rkFchip} style={{ borderColor: "var(--line2)", color: "var(--muted2)" }}>+{(r.risks ?? []).length - 4}</span>}
                    </div>
                  </td>
                  <td className="mono" style={{ color: "var(--danger)", fontWeight: 700 }}>{r.delay != null ? `${r.delay} 天` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** rk-kpi 单卡：数值在上（等宽·着色）、标签在下。 */
function RkK({ testId, value, label, color }: { testId: string; value: string; label: string; color: string }) {
  return (
    <div className={styles.rkK} data-testid={testId}>
      <b style={{ color }} data-testid={`${testId}-value`}>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/**
 * 内联详情面板（openRiskCard #rkDetail）：逐因素时间轴（主因素真逐日 series·其余因素当前值·无逐日源诚实灰）
 * → 图例 → 两栏（对症方案 rk-sol + 对话态 QA）。
 */
function RiskDetailPanel({
  card, bnRow, bnFactors, threshold, horizon, isPrimary, onDay, onLiveState: propsOnLiveState,
}: {
  card: RiskCard;
  bnRow?: BottleneckOutput["rows"][number];
  bnFactors: string[];
  threshold: number;
  horizon: number;
  isPrimary: boolean;
  onDay: (day: number) => void;
  /** WO-LIVE-DISPOSITION：把当前活推演态上抛给 risk 看板，用于重算全局行动计划。 */
  onLiveState?: (s: LiveLeverState) => void;
}) {
  const H = card.series.length || horizon;
  const synth = card.provenanceSynthetic === true;
  const baseIdForScope = (card as { baseId?: string }).baseId ?? card.base;
  // WO-CAPLIVE-2 · 因子级根因（活能力②·G-GAP-SCOPE 已闭·前端接线）：gap_attribution 现支持 scope.baseId/factorId，
  // 前端传作用域 → 未选因子=基地级、选因子=按因子细分。无源/基地对不上 → 诚实灰（不伪造根因树）。
  const [rcFactor, setRcFactor] = useState<string | undefined>(undefined);
  const { data: ga, isLoading: gaLoading, isError: gaError } = useQuery({
    queryKey: ["a", "gap_attribution", "risk-board", baseIdForScope, rcFactor ?? "__all__"],
    queryFn: async () => {
      const scope: Record<string, unknown> = { baseId: baseIdForScope };
      if (rcFactor) scope.factorId = rcFactor;
      const res = await invokeSolver("gap_attribution", { scope });
      return res.data as GapAttrOutput;
    },
    retry: false,
  });
  // 活能力①③：DynamicLeverPanel 上抛的当前推演态，供方案存/横比消费；同时上抛给 RiskBoardView 用于重算行动计划。
  const [liveState, setLiveState] = useState<LiveLeverState>({ apply: [], capGain: 0, affected: 0 });
  const onLiveState = useCallback((s: LiveLeverState) => {
    setLiveState(s);
    propsOnLiveState?.(s);
  }, [propsOnLiveState]);
  const baseDag: DagData | undefined = gapAttributionToBaseRootCause(ga, card.base);
  // 结构/因果根因因素标签（供 CI-b「对症根因」对齐·真出处=同一 gap_attribution 投影）。
  const rootCauseFactors = (baseDag?.nodes ?? []).filter((n) => n.kind === "factor").map((n) => n.label);
  // 其余越线/临近因素（当前值·无逐日 series 源→灰点·不伪造）。
  const others = (bnFactors ?? [])
    .filter((f) => f !== card.factor)
    .map((f) => ({ factor: f, value: bnRow?.tightness[f] ?? null }))
    .filter((x) => x.value != null && x.value >= threshold - BAND)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const tickLabel = (d: number): string => (d === 1 || d % 5 === 0 || d === H ? `D+${d}` : "");
  // CT-a（⑤ 订单交付 icon）：逐日受影响订单数（与 onDay/AffectedOrdersModal 同源·同 day 口径 dueDay===i·非写死）。
  // 该日有受影响订单 → 主因素逐日点叠交付 icon，用户一眼看出哪天有订单交付受影响（尤其黄/红点）。
  const affectedByDay: number[] = new Array(H).fill(0);
  for (const o of (card.affectedOrders ?? []) as { dueDay?: number }[]) {
    const dd = o.dueDay;
    if (typeof dd === "number" && dd >= 0 && dd < H) affectedByDay[dd] = (affectedByDay[dd] ?? 0) + 1;
  }

  return (
    <div className={styles.rkDet} data-testid={`risk-detail-${card.base}`}>
      <div className={styles.rkDetH}>
        <b>{card.base} · 产能影响对象全景</b>
        <span>
          未来 {H} 天 · 悬停任意点看当日影响{isPrimary ? " · 首要风险" : ""}
          {synth ? " · 合成种子（未接实测）" : ""}
        </span>
      </div>

      {/* 逐因素时间轴。 */}
      {card.series.length > 0 ? (
        <div className={styles.rkTl} data-testid="risk-timeline">
          <div className={styles.rkTicks}>
            {card.series.map((_, i) => (
              <span key={i} className={styles.rkTick}>{tickLabel(i + 1)}</span>
            ))}
          </div>
          {/* 主因素：真逐日 series（点击某日→受影响订单）。 */}
          <FactorRow
            label={card.factor}
            sub={`${card.currentTightness?.value != null ? Math.round(card.currentTightness.value) : "—"}→${Math.round(card.peak)} · ${card.crossDay != null ? `T+${card.crossDay} 越线` : "窗口内不越线"}`}
            color={tierColor(card.peak, threshold)}
            dots={card.series.map((v) => ({ color: heatColor(v, threshold), value: v }))}
            onDay={onDay}
            affectedByDay={affectedByDay}
          />
          {/* 其余因素：仅当前值（无逐日源）→ 灰点 + 当前值标注（不伪造逐日·G-DM-1）。 */}
          {others.map((o) => (
            <FactorRow
              key={o.factor}
              label={o.factor}
              sub={`当前 ${o.value != null ? Math.round(o.value) : "—"} · 无逐日实测源`}
              color={tierColor(o.value, threshold)}
              dots={card.series.map(() => ({ color: "rgba(138,148,166,.28)", value: null }))}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state" data-testid="risk-detail-nodata" style={{ fontSize: 12, lineHeight: 1.7, color: "var(--muted)", marginBottom: 10 }}>
          该基地在当前窗口内无逐日张力序列。
        </div>
      )}

      <div className={styles.rkLeg} data-testid="risk-legend">
        <span><i style={{ background: "#43B7D7" }} />&lt;{threshold - BAND} 正常</span>
        <span><i style={{ background: "#E8B54A" }} />{threshold - BAND}-{threshold - 1} 关注</span>
        <span><i style={{ background: "#E0626C" }} />≥{threshold} 瓶颈</span>
        <span style={{ marginLeft: 14, color: "var(--muted2)" }}>
          首要风险对象：{card.factor}{card.crossDay != null ? `（T+${card.crossDay} 越线）` : ""}
        </span>
      </div>

      {/* CI-a 基地根因推演树（可信=过程可见）：为什么这基地越线——结构反向归因（设备OEE/物料gapTon/订单）
          → caused_by 溯终点根因，每节点下钻真对象字段（R13）。数据 = gap_attribution 真求解器投影到本基地。 */}
      {/* WO-CAPACITY-DEEPEN 块C · 20 因素本体图例 + 给现有根因/瓶颈因素附加本体徽标（纯附加·现有 ②④ 零改）。 */}
      <CapacityFactorOntology baseId={card.base} factors={[card.factor, ...bnFactors, ...rootCauseFactors]} />

      <RootCausePanel
        base={card.base}
        factor={card.factor}
        dag={baseDag}
        loading={gaLoading}
        error={gaError}
        hasGa={!!ga}
        factorOptions={[card.factor, ...others.map((o) => o.factor)].filter((v, i, a) => !!v && a.indexOf(v) === i)}
        rcFactor={rcFactor}
        onRcFactor={setRcFactor}
      />

      {/* WO-CAPACITY-DEEPEN 块A · 可用产能派生诊断 DAG（插在 ③ 之上·不替代四线图）。 */}
      <CapacityDerivationDag baseId={card.base} />

      {/* F1 · 每基地前瞻产能推演（30/60/90 四线 + 缺口标记 + P1 逐日过程）。基地名归一由求解器内部处理。 */}
      <BaseOutlookPanel baseId={card.base} />

      {/* WO-CAPACITY-DEEPEN 块B · 产能爬坡 min 包络（插在 ③ 之后）。 */}
      <CapacityRampEnvelope baseId={card.base} />

      {/* WO-CAPLIVE-2 活能力① · 原子因子活推演：参数化 DynamicLeverPanel 挂进产能页——targetType/targetProp 传产能目标
          （Base.weeklyCap），scopeObjectIds 传本基地×型号真对象，杠杆从⑤瓶颈反推、拖动 generic_inference 真重算
          （before/after + tornado + 每值 provenance + C08 边界·复用项目推演黄金范式·非 optimize_whatif）。 */}
      <div className={styles.rkDet} style={{ marginTop: 12 }} data-testid={`caplive-lever-${card.base}`}>
        <div className={styles.rkDetH}>
          <b>🎛 {zh.risk.live.leverTitle}</b>
          <span>{zh.risk.live.leverHint}</span>
        </div>
        <DynamicLeverPanel
          baseP50={card.peak}
          baseGap={0}
          factors={[card.factor, ...bnFactors].filter((v, i, a) => !!v && a.indexOf(v) === i)}
          scopeObjectIds={[`base-${baseIdForScope}`]}
          modelId={card.base}
          grain="process-model"
          targetType="Base"
          targetProp="weeklyCap"
          beforeLabel={zh.risk.live.leverBefore}
          adoptActionTypeKey="plan_change"
          snapshot={{ mode: "capacity", qty: 0, p50: card.peak, p90: card.peak, mainBn: card.factor }}
          onLiveState={onLiveState}
        />
      </div>

      {/* WO-CAPLIVE-2 活能力③ · 方案存/分支/横比（decision_play 范式·复用沙盘存档语义·一键采纳走 Action 审批）。 */}
      <CapacityScenarioPanel baseId={baseIdForScope} live={liveState} />

      {/* 两栏（.rk-two）：左对症方案 + 推演链（mitigation_select 真求解器）· 右对话态 QA（同源真数据 R6）。 */}
      <div className={styles.rkTwo}>
        <MitigationCards base={card.base} factor={card.factor} tightness={card.peak} threshold={threshold} rootCauseFactors={rootCauseFactors} />
        <QaPanel card={card} threshold={threshold} />
      </div>

      {/* WO-CAPLIVE-2 活能力② · 人机对话（真 NL·经 orchestrator·替 QaPanel 正则假 NL）。 */}
      <CapacityLiveDialog baseId={baseIdForScope} baseName={card.base} factor={rcFactor ?? card.factor} />
    </div>
  );
}

/**
 * CI-a 基地根因推演树面板。dag 存在 → 复用 <ProvenanceDag> 递归渲染结构+因果树（真求解器投影·R13/R14）；
 * 缺源/基地对不上/加载/报错 → **诚实灰**列出后端缺口（绝不伪造根因树·KILL-MOCK·C6）。
 */
function RootCausePanel({ base, factor, dag, loading, error, hasGa, factorOptions, rcFactor, onRcFactor }: {
  base: string; factor: string; dag: DagData | undefined; loading: boolean; error: boolean; hasGa: boolean;
  /** WO-CAPLIVE-2：因子级根因作用域（gap_attribution scope.factorId·G-GAP-SCOPE 已闭）。 */
  factorOptions: string[]; rcFactor: string | undefined; onRcFactor: (f: string | undefined) => void;
}) {
  const nodeCount = dag?.nodes.length ?? 0;
  return (
    <div className={styles.rkDet} style={{ marginTop: 12 }} data-testid={`rootcause-panel-${base}`}>
      <div className={styles.rkDetH}>
        <b>🌳 {base} · 根因推演树</b>
        <span>为什么越线：结构反向归因（设备/物料/订单）→ caused_by 溯终点根因 · 每节点下钻真对象（R13）</span>
      </div>
      {/* WO-CAPLIVE-2 · 因子作用域切换（gap_attribution scope.factorId）：选因子 → 树按因子细分（引擎已支持 base×factor）。 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", margin: "2px 0 8px", fontSize: 11 }} data-testid="rootcause-factor-scope">
        <span style={{ color: "var(--muted2)" }}>{zh.risk.live.rootcause.scopeTitle}：</span>
        <span
          className={`${styles.tierChip} ${!rcFactor ? styles.tierChipOn : ""}`}
          data-testid="rootcause-factor-all"
          role="button"
          tabIndex={0}
          onClick={() => onRcFactor(undefined)}
          onKeyDown={(e) => e.key === "Enter" && onRcFactor(undefined)}
        >
          {zh.risk.live.rootcause.allFactors}
        </span>
        {factorOptions.map((f) => (
          <span
            key={f}
            className={`${styles.tierChip} ${rcFactor === f ? styles.tierChipOn : ""}`}
            data-testid={`rootcause-factor-${f}`}
            role="button"
            tabIndex={0}
            onClick={() => onRcFactor(f)}
            onKeyDown={(e) => e.key === "Enter" && onRcFactor(f)}
          >
            {zh.risk.live.rootcause.pick(f)}
          </span>
        ))}
      </div>
      {dag && nodeCount > 0 ? (
        <>
          <ProvenanceDag data={dag} />
          {/* 诚实标注：默认按基地聚合（未按因子细分）；选因子 → 已按 scope.factorId 细分（引擎已支持 base×factor）。 */}
          {rcFactor ? (
            <div style={{ fontSize: 10.5, color: "var(--muted2)", lineHeight: 1.5, marginTop: 8 }} data-testid="rootcause-scope-note">
              {zh.risk.live.rootcause.refined(rcFactor)}
            </div>
          ) : (
            <div style={{ fontSize: 10.5, color: "var(--muted2)", lineHeight: 1.5, marginTop: 8 }} data-testid="rootcause-scope-note">
              结构+因果根因源自 gap_attribution 真求解器（按基地结构反向分摊·叶级下钻真对象字段）。
              注：当前按<b>基地</b>聚合根因，<b>未</b>按具体越线因子（{factor}）细分——点上方因子 chip 传 scope.factorId 即按因子细分（引擎已支持）。
            </div>
          )}
        </>
      ) : (
        <div className="empty-state" data-testid={`rootcause-gap-${base}`} style={{ fontSize: 12, lineHeight: 1.7, color: "var(--muted)" }}>
          <b style={{ color: "var(--muted2)" }}>根因推演树暂不可用（诚实灰·未伪造过程）</b>
          <div style={{ marginTop: 6 }}>后端缺口：
            {loading ? "gap_attribution 加载中…"
              : error ? "gap_attribution 求解器不可用/未开通（无法取结构归因）"
              : !hasGa ? "gap_attribution 无返回"
              : `gap_attribution 全局归因中无「${base}」的结构节点——引擎按全局最严重 Metric 归因，且不接受 base×factor 作用域；该基地未落入结构分摊基地集（或基地名与 Order.bases 未对齐）`}
          </div>
          <div style={{ marginTop: 4, color: "var(--muted2)" }}>补齐路径：gap_attribution 支持 base×factor 入参作用域后本树即活（前端已就绪·仅缺引擎侧作用域）。</div>
        </div>
      )}
    </div>
  );
}

/**
 * WO-CAPLIVE-2 活能力③ · 方案存 / 分支 / 横比（复用沙盘 SimCheckpoint 存档语义 + decision_play 比对矩阵范式）：
 * 把当前活推演态（DynamicLeverPanel 上抛的杠杆组合）存为命名方案 → 分支变体 → 多方案横比矩阵
 * （各格经 generic_inference 真算·改方案 apply → 矩阵随之变·KILL-MOCK）→ 一键采纳走 plan_change Action
 * （C5 门不绕·PENDING_APPROVAL 非 toast）。方案存/横比依赖 WO-LIVE-SCENARIO（未合并则 MSW 桩·集成接真点见 endpoints）。
 */
function CapacityScenarioPanel({ baseId, live }: { baseId: string; live: LiveLeverState }) {
  const qc = useQueryClient();
  const adopt = useActionDraft();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const listQ = useQuery({ queryKey: ["a", "live-scenarios", baseId], queryFn: () => listLiveScenarios(baseId), retry: false });
  const scenarios: LiveScenario[] = listQ.data?.scenarios ?? [];
  const hasLive = live.apply.length > 0;

  const save = useMutation({
    mutationFn: (parentId?: string) => saveLiveScenario({ baseId, name: name.trim() || `方案 ${scenarios.length + 1}`, parentId, apply: live.apply }),
    onSuccess: () => { setName(""); void qc.invalidateQueries({ queryKey: ["a", "live-scenarios", baseId] }); },
  });

  const compareQ = useQuery({
    queryKey: ["a", "live-scenario-compare", baseId, [...selected].sort()],
    enabled: selected.length >= 2,
    retry: false,
    queryFn: () => compareLiveScenarios(selected),
  });
  const matrix: LiveScenarioMatrix | undefined = compareQ.data;

  const toggle = (id: string): void => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const adoptScenario = (s: LiveScenario): void => {
    adopt.mutate({
      actionTypeKey: "plan_change",
      payload: {
        versionId: `risk:${baseId}:${s.id}`,
        reason: `采纳风险处置方案：${s.name}（基地 ${baseId}）`,
        baseId,
        scenarioId: s.id,
        scenarioName: s.name,
        levers: s.apply,
      },
    });
  };

  return (
    <div className={styles.rkDet} style={{ marginTop: 12 }} data-testid={`caplive-scenario-${baseId}`}>
      <div className={styles.rkDetH}>
        <b>🗂 {zh.risk.live.scenario.title}</b>
        <span>{zh.risk.live.scenario.hint}</span>
      </div>

      {/* 存当前推演态为命名方案（无活推演态 → 诚实提示不臆造）。 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 10px", flexWrap: "wrap" }}>
        <input
          value={name}
          data-testid="caplive-scenario-name"
          placeholder={zh.risk.live.scenario.namePh}
          onChange={(e) => setName(e.target.value)}
          style={{ background: "var(--panel)", border: "1px solid var(--line2)", borderRadius: 8, color: "var(--txt)", padding: "6px 12px", fontSize: 12, minWidth: 180 }}
        />
        <button className="btn sm primary" data-testid="caplive-scenario-save" disabled={!hasLive || save.isPending} onClick={() => save.mutate(undefined)}>
          {zh.risk.live.scenario.save}
        </button>
        {!hasLive && <span style={{ fontSize: 10.5, color: "var(--muted2)" }}>{zh.risk.live.scenario.saveEmpty}</span>}
      </div>

      {scenarios.length === 0 ? (
        <div className="empty-state" data-testid="caplive-scenario-empty" style={{ fontSize: 12 }}>{zh.risk.live.scenario.empty}</div>
      ) : (
        <>
          <table className="cmp" data-testid="caplive-scenario-list" style={{ fontSize: 11 }}>
            <thead>
              <tr>
                <th>{zh.risk.live.scenario.col.pick}</th>
                <th>{zh.risk.live.scenario.col.scheme}</th>
                <th>{zh.risk.live.scenario.capGain}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.id} data-testid={`caplive-scenario-row-${s.id}`}>
                  <td>
                    <input type="checkbox" data-testid={`caplive-scenario-pick-${s.id}`} checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
                  </td>
                  <td className="zh"><b>{s.name}</b>{s.parentId && <span className="badge" style={{ marginLeft: 5, fontSize: 9 }}>分支</span>}</td>
                  <td className="mono" data-testid={`caplive-scenario-capgain-${s.id}`}>{s.kpis.capGain}</td>
                  <td>
                    <button className="btn sm" data-testid={`caplive-scenario-branch-${s.id}`} disabled={!hasLive || save.isPending} onClick={() => save.mutate(s.id)}>
                      {zh.risk.live.scenario.branch}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0" }}>
            <button className="btn sm" data-testid="caplive-scenario-compare" disabled={selected.length < 2} onClick={() => void compareQ.refetch()}>
              {zh.risk.live.scenario.compare}
            </button>
            <span style={{ fontSize: 10.5, color: "var(--muted2)" }}>{zh.risk.live.scenario.pickHint}</span>
          </div>

          {/* 横比矩阵：各格 = 各方案 generic_inference 真算（改方案 apply → 矩阵变·KILL-MOCK）。 */}
          {matrix && matrix.rows.length > 0 && (
            <table className="cmp" data-testid="caplive-scenario-matrix" style={{ fontSize: 11 }}>
              <thead>
                <tr>
                  <th>{zh.risk.live.scenario.col.scheme}</th>
                  {matrix.dims.map((d) => <th key={d.key}>{d.label}</th>)}
                  <th>{zh.risk.live.scenario.ruleFlag}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((r) => {
                  const s = scenarios.find((x) => x.id === r.scenarioId);
                  return (
                    <tr key={r.scenarioId} data-testid={`caplive-matrix-row-${r.scenarioId}`}>
                      <td className="zh"><b>{r.name}</b></td>
                      {matrix.dims.map((d) => (
                        <td key={d.key} className="mono" data-testid={`caplive-matrix-${d.key}-${r.scenarioId}`}>
                          {d.key === "capGain" ? (
                            <Provenance testId={`caplive-mx-${r.scenarioId}`} src="generic_inference · 方案重算" formula="产能增益 = Σ 下游派生 after − before" inputs={[r.name]}>
                              {r.cells[d.key] ?? 0}
                            </Provenance>
                          ) : (
                            r.cells[d.key] ?? 0
                          )}
                        </td>
                      ))}
                      <td data-testid={`caplive-matrix-rule-${r.scenarioId}`}>{r.ruleFlag ? "⚠ C08" : "—"}</td>
                      <td>
                        <button className="btn sm primary" data-testid={`caplive-scenario-adopt-${r.scenarioId}`} disabled={!s || adopt.isPending} onClick={() => s && adoptScenario(s)}>
                          {zh.risk.live.scenario.adopt}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div style={{ fontSize: 10, color: "var(--muted2)", marginTop: 6 }} data-testid="caplive-scenario-gate-note">
            {zh.risk.live.scenario.adopted}
          </div>
        </>
      )}
    </div>
  );
}

/** 单因素时间轴行（.rk-frow）：168px 标签 + 逐日圆点。主因素点可点→受影响订单。 */
function FactorRow({ label, sub, color, dots, onDay, affectedByDay }: {
  label: string; sub: string; color: string; dots: { color: string; value: number | null }[]; onDay?: (day: number) => void;
  /** CT-a（⑤）：逐日受影响订单数（index=day·与 onDay/AffectedOrdersModal 同源）。>0 的日叠交付 icon。 */
  affectedByDay?: number[];
}) {
  return (
    <div className={styles.rkFrow} data-testid={`risk-frow-${label}`}>
      <div className={styles.rkFlab}>
        <b style={{ color }}>{label}</b>
        <span>{sub}</span>
      </div>
      <div className={styles.rkDots}>
        {dots.map((d, i) => {
          const nAff = affectedByDay?.[i] ?? 0; // CT-a：该日受影响订单数（同源真数据·非写死）
          const dotTitle = d.value != null ? `D+${i + 1} · ${Math.round(d.value)}` : `D+${i + 1} · 无实测`;
          const title = nAff > 0 ? `${dotTitle} · ${nAff} 单交付受影响` : dotTitle;
          return (
            <button
              key={i}
              className={styles.rkDot}
              style={{ background: d.color, position: "relative", overflow: "visible" }}
              title={title}
              aria-label={title}
              data-testid={onDay ? `risk-dot-${i}` : undefined}
              data-affected={nAff > 0 ? nAff : undefined}
              onClick={onDay ? () => onDay(i) : undefined}
            >
              {nAff > 0 && (
                // ⑤ 订单交付受影响 icon（该日 affected_orders 非空·同源）——小三角挂在点上方，一眼可辨。
                <span
                  aria-hidden="true"
                  data-testid={`risk-dot-order-${i}`}
                  style={{ position: "absolute", top: -7, left: "50%", transform: "translateX(-50%)", fontSize: 8, lineHeight: 1, color: "var(--ink, #e8b54a)", pointerEvents: "none" }}
                >
                  ▾
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type MitPlan = { key: string; name: string; eff: number; tn: number; cost: string; risk?: string; score: number };

// CI-b「对症根因」对齐词表已外置到 config/riskFactorTaxonomy（R14：锂电领域关键词不内联视图·换行业只改配置层）。

/**
 * CI-b 对症方案 + 方案比对推演链（可信=过程可见）：mitigation_select 真求解器优选。
 * ① 对症根因（对齐 CI-a 根因树结构节点）② score 拆解——**跨方案比对矩阵**（见效/周期/投入/风险/综合评分·真出处·
 * 非单一数字）解释为何推荐者综合分最高 ③ 预期堵口（峰值张力 − 见效pp → 是否消解越线·源 mitigation_select.eff）。
 * ④ 采纳仍走 adopt_mitigation → Action 草稿待审批（C5 门不绕·不直接执行）。全部数字来自求解器（KILL-MOCK·R13）。
 */
function MitigationCards({ base, factor, tightness, threshold, rootCauseFactors }: {
  base: string; factor: string; tightness: number; threshold: number; rootCauseFactors: string[];
}) {
  const adopt = useActionDraft();
  const { data, isLoading } = useQuery({
    queryKey: ["a", "mitigation_select", base, factor, tightness],
    queryFn: async () => {
      const res = await invokeSolver("mitigation_select", { baseName: base, factor, tightness });
      return res.data as { plans?: MitPlan[]; recommended?: string; error?: string };
    },
  });
  const plans = data?.plans ?? [];
  const recommended = data?.recommended;
  // 综合评分降序 = 求解器优选序（真出处·排名供「为何推荐」）。
  const ranked = [...plans].sort((a, b) => b.score - a.score);
  const rankOf = (key: string) => ranked.findIndex((p) => p.key === key) + 1;
  const matched = matchRiskFactorToRootCause(factor, rootCauseFactors);

  return (
    <div>
      <div className={styles.wfT} style={{ color: "var(--ok)" }}>💡 对症方案 · 比对推演 · {factor}（{plans.length} 个）</div>
      {isLoading ? (
        <div style={{ color: "var(--muted2)", fontSize: 11 }}>{zh.common.loading}</div>
      ) : !plans.length ? (
        <div className="empty-state" style={{ fontSize: 11 }} data-testid="mitigation-empty">{zh.common.none}</div>
      ) : (
        <>
          {/* ② score 拆解 = 跨方案比对矩阵（非单一数字·真出处 mitigation_select.plans[]）：一眼见谁综合分最高·为何。 */}
          <div style={{ fontSize: 10.5, color: "var(--muted)", margin: "2px 0 5px" }}>为什么推荐？综合评分 = 见效 × 紧迫度 ÷（投入档 × 周期）——比对如下（评分降序）：</div>
          <table className="cmp" data-testid="mitigation-matrix" style={{ fontSize: 11, marginBottom: 10 }}>
            <thead>
              <tr><th>方案</th><th>见效(pp)</th><th>周期(周)</th><th>投入</th><th>风险</th><th>综合评分</th></tr>
            </thead>
            <tbody>
              {ranked.map((p) => (
                <tr key={p.key} data-testid={`mitigation-matrix-row-${p.key}`} style={p.key === recommended ? { background: "rgba(98,190,119,.12)" } : undefined}>
                  <td className="zh"><b>{p.name}</b>{p.key === recommended && <span className="badge" style={{ marginLeft: 5, background: "var(--ok)", color: "#0a1f12", fontSize: 9 }}>推荐</span>}</td>
                  <td className="mono" data-testid={`mitigation-eff-${p.key}`} style={{ color: "var(--ok)" }}>{p.eff}</td>
                  <td className="mono">{p.tn}</td>
                  <td className="zh">{p.cost}</td>
                  <td className="zh">{p.risk ?? "—"}</td>
                  <td className="mono" data-testid={`mitigation-score-${p.key}`}><b>{p.score}</b></td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 逐方案推演链：① 对症根因 ② 评分排名 ③ 预期堵口 ④ 采纳→草稿（C5）。 */}
          {ranked.map((p) => {
            const after = Math.round((tightness - p.eff) * 10) / 10;
            const clears = after < threshold;
            return (
              <div key={p.key} className={styles.rkSol} data-testid={`mitigation-plan-${p.key}`}>
                <div className={styles.rkSolH}>
                  <b>
                    {rankOf(p.key)}. {p.name}
                    {p.key === recommended && <span className="badge" style={{ marginLeft: 6, background: "var(--ok)", color: "#0a1f12", fontSize: 9 }}>推荐</span>}
                  </b>
                  <button
                    className={styles.fcGo}
                    data-testid={`mitigation-adopt-${p.key}`}
                    disabled={adopt.isPending}
                    onClick={() => adopt.mutate({ actionTypeKey: "adopt_mitigation", payload: { base, factor, planKey: p.key } })}
                  >
                    采纳→工单
                  </button>
                </div>
                {/* 推演链（过程可见·非裸结论）。 */}
                <div className={styles.rkSolM} data-testid={`mitigation-chain-${p.key}`} style={{ display: "grid", gap: 3 }}>
                  <span data-testid={`mitigation-target-${p.key}`}>
                    ① 对症根因：{matched ? <>直指根因树「<b style={{ color: "var(--c-solver)" }}>{matched}</b>」</> : <>针对越线因子「{factor}」<span style={{ color: "var(--muted2)" }}>（根因树未见对齐的结构节点·据实）</span></>}
                  </span>
                  <span>② 评分构成：见效 {p.eff}pp · 周期 {p.tn}周 · 投入 {p.cost} · 风险 {p.risk ?? "—"} → 综合 <b>{p.score}</b>（{p.key === recommended ? "全案最高·故推荐" : `第 ${rankOf(p.key)} 名`}）</span>
                  <span data-testid={`mitigation-block-${p.key}`}>
                    ③ 预期堵口：峰值张力 {Math.round(tightness)} − 见效 {p.eff}pp → <b style={{ color: clears ? "var(--ok)" : "var(--danger)" }}>{after}</b>
                    {clears ? `（预计消解越线·<阈值 ${threshold}）` : `（仍越线·需叠加方案）`} <span style={{ color: "var(--muted2)" }}>· 源 mitigation_select.eff</span>
                  </span>
                </div>
              </div>
            );
          })}
          <div style={{ fontSize: 10, color: "var(--muted2)", marginTop: 6 }} data-testid="mitigation-gate-note">
            ④ 采纳经 <b>adopt_mitigation</b> 生成 Action 草稿 → 审批后下发工单（C5 门不绕·前端不直改计划）。
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 对话态 QA（右栏 · 两态同源 R6）：预设问 + 追问框，答案**确定性派生自本卡已取的真求解器输出**
 * （affectedOrders / crossDay / peak / factor），非另起 LLM、非伪造——与嵌入态同一批真数据同源。
 */
function QaPanel({ card, threshold }: { card: RiskCard; threshold: number }) {
  const [ans, setAns] = useState<string>(zh.risk.qa.intro);
  const [input, setInput] = useState("");
  const orders = (card.affectedOrders ?? []) as Record<string, unknown>[];
  const custs = [...new Set(orders.map((o) => String(o.cust ?? "")).filter(Boolean))];
  const sos = orders.map((o) => String(o.so ?? "")).filter(Boolean);

  const answer = (q: string): string => {
    if (/客户|谁/.test(q)) return custs.length ? `受威胁客户 ${custs.length} 家：${custs.join("、")}（源：受影响订单去重）。` : "该基地当前无关联受影响客户（受影响订单为空）。";
    if (/订单|批/.test(q)) return sos.length ? `受影响订单 ${sos.length} 批：${sos.slice(0, 8).join("、")}${sos.length > 8 ? " 等" : ""}。` : "该基地当前无在产订单落入越线传导窗口。";
    if (/为什么|原因|越线/.test(q)) return `${card.factor} ${card.crossDay != null ? `预计 T+${card.crossDay} 越线（阈值 ${threshold}）` : "窗口内暂不越线"}；峰值张力 ${Math.round(card.peak)}。`;
    if (/最坏|后果|影响/.test(q)) return `最坏后果：${custs.length} 家客户 / ${sos.length} 批订单受影响${card.crossDay != null ? `，最早 T+${card.crossDay} 越线` : ""}。`;
    return `已知本卡真值：峰值 ${Math.round(card.peak)} · ${card.crossDay != null ? `T+${card.crossDay} 越线` : "不越线"} · 受威胁客户 ${custs.length} · 订单 ${sos.length} 批。可问：影响哪些客户 / 哪些订单 / 为什么越线 / 最坏后果。`;
  };
  const presets = ["影响哪些客户？", "哪些订单受影响？", "为什么会越线？", "最坏后果是什么？"];

  return (
    <div>
      {/* 假NL 修：诚实标"预设快答·非智能问答"——入口是关键词匹配非自然语言理解/LLM；答案数字仍派生自本卡真求解器输出。 */}
      <div className={styles.wfT} style={{ color: "var(--c-capacity)" }}>{zh.risk.qa.title}</div>
      <div className={styles.qaChips}>
        {presets.map((q) => (
          <button key={q} className={styles.qaChip} data-testid={`qa-chip-${q}`} onClick={() => setAns(answer(q))}>{q}</button>
        ))}
      </div>
      <div className={styles.rkAns} data-testid="risk-qa-answer">{ans}</div>
      <div className={styles.rkAsk}>
        <input
          value={input}
          data-testid="risk-qa-input"
          placeholder={zh.risk.qa.placeholder}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) { setAns(answer(input)); setInput(""); } }}
        />
        <button data-testid="risk-qa-ask" onClick={() => { if (input.trim()) { setAns(answer(input)); setInput(""); } }}>{zh.risk.qa.ask}</button>
      </div>
      <div data-testid="risk-qa-disclosure" style={{ marginTop: 6, fontSize: 10, color: "var(--muted2)", lineHeight: 1.5 }}>{zh.risk.qa.disclosure}</div>
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
          <tr><th>编号</th><th>案例</th><th>因子</th><th>越线日</th><th>采纳处置</th><th>消解日</th><th>受影响订单</th></tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr key={c.id} data-testid={`risk-case-${c.caseNo}`} tabIndex={0} style={{ cursor: "pointer" }} onClick={() => setReplay(c)} onKeyDown={(e) => e.key === "Enter" && setReplay(c)}>
              <td className="mono">{c.caseNo}</td>
              <td className="zh">{c.title}{c.tags.map((t) => (<span key={t} className="badge red" style={{ marginLeft: 6 }}>{t}</span>))}</td>
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

/** 案例点击 → 回放当时的时序曲线（curve = query_timeseries_agg 参数，数字与回放写入同源）。 */
function CaseReplayModal({ kase, onClose }: { kase: HistoryRiskCase; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["a", "case-replay", kase.id],
    queryFn: () => queryTimeseriesAgg({ seriesKey: kase.curve.seriesKey, entityIds: [kase.curve.entityId], window: { from: kase.curve.from, to: kase.curve.to, grain: "day" }, agg: "sum" }),
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
            series: [{ type: "line", smooth: true, data: points.map((p) => p.value), itemStyle: { color: "#43B7D7" }, markLine: { data: [{ xAxis: kase.crossedAt, label: { formatter: "越线" } }, { xAxis: kase.adoptedAt, label: { formatter: "采纳" } }, { xAxis: kase.resolvedAt, label: { formatter: "消解" } }] } }],
          }}
        />
        <div className="section-title" style={{ marginTop: 10 }}>处置时间线</div>
        <div data-testid="case-timeline" style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
          {kase.timeline.map((t, i) => (<div key={i}><span className="mono">{t.date}</span> · <span className="zh">{t.event}</span></div>))}
        </div>
        {kase.affectedOrders.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12.5 }} data-testid="case-affected-orders">
            受影响订单：{kase.affectedOrders.map((so) => (<span key={so} className="badge" style={{ marginRight: 4 }}>{so}</span>))}
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * 时点点击 → 受影响订单弹窗（渲染风险卡已带的真受影响订单 card.affectedOrders·产能传导引擎按越线日真算·非哈希查询）。
 * 空列表给诚实解释，绝不裸空。
 */
function AffectedOrdersModal({ card, day, onClose }: { card: RiskCard; day: number; onClose: () => void }) {
  const orders = (card.affectedOrders ?? []) as Record<string, unknown>[];
  const list = orders.filter((o) => (o as { dueDay?: number }).dueDay === day);
  return (
    <Modal title={`${zh.risk.affectedOrders} · ${card.base} · D+${day}`} onClose={onClose} width={640}>
      <table className="cmp" data-testid="affected-orders-table">
        <thead>
          <tr><th>SO</th><th>客户</th><th>型号</th><th>数量</th><th>交期</th></tr>
        </thead>
        <tbody>
          {list.map((o, i) => (
            <tr key={String(o.so ?? i)}>
              <td className="mono">{String(o.so ?? "—")}</td>
              <td className="zh">{String(o.cust ?? "—")}</td>
              <td className="zh">{String(o.model ?? "—")}</td>
              <td className="mono">{String(o.qty ?? "—")} {UNIT}</td>
              <td className="mono">{String(o.due ?? "—")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length === 0 && (
        <div className="empty-state" data-testid="affected-orders-empty" style={{ fontSize: 12, lineHeight: 1.6 }}>
          该基地在 D+{day} 的产能传导窗口内<b>无在产订单</b>关联。
        </div>
      )}
    </Modal>
  );
}
