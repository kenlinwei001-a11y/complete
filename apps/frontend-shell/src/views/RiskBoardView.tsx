import { useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { RiskTimelineOutput, ViewColumnDef } from "@platform/contracts";
import { RiskTimelineOutputSchema, BottleneckMatrixOutputSchema } from "@platform/contracts";
import type { HistoryRiskCase } from "@platform/contracts";
import { fetchHistoryBundle, invokeSolver, queryTimeseriesAgg } from "@/api/endpoints";
import { useSessionStore } from "@/store/sessionStore";
import { Modal } from "@/components/ui/Modal";
import { EChart } from "@/components/ui/EChart";
import { RiskHoverTrigger } from "@/components/Risk/RiskPopover";
import { decisionColor, decisionHeat, NO_DATA_HINT } from "@/components/DecisionValue";
import { useActionDraft } from "./sim/shared";
import { useOpenWhatIf, resolveBaseId } from "./sim/whatif";
import { useFeature } from "@/workspace/featureGate";
import type { ViewRendererProps } from "./registry";
import { InferenceProcessPanel } from "@/components/InferenceProcessPanel";
import { DataModeBadge } from "@/components/DataModeBadge";
import { DrillBack } from "@/components/DrillBack";
import zh from "@/locales/zh";
import styles from "./RiskBoardView.module.css";

type RiskCard = RiskTimelineOutput["cards"][number];
type BottleneckOutput = ReturnType<typeof BottleneckMatrixOutputSchema.parse>;

/**
 * RISKBOARD-LAYOUT-REWORK（诊断台 → 高管决策漏斗）：卡业务影响真值口径（C2/C3/C4 单一来源）。
 * 营收敞口 = Σ 受影响订单 revenueWan（后端 affectedOrders 由产能传导引擎按越线日真算·qty×细分单价·R13 可溯）；
 * 受威胁客户 = 受影响订单去重客户数。**全部读 card.affectedOrders 真值·前端不写死**（改后端真源→值随之变）。
 */
function orderRows(card: RiskCard): Record<string, unknown>[] {
  return (card.affectedOrders ?? []) as Record<string, unknown>[];
}
export function cardExposureWan(card: RiskCard): number {
  return orderRows(card).reduce((s, o) => {
    const v = typeof o.revenueWan === "number" ? o.revenueWan : Number(o.revenueWan);
    return s + (Number.isFinite(v) ? v : 0);
  }, 0);
}
export function cardThreatenedCusts(card: RiskCard): number {
  return new Set(orderRows(card).map((o) => String(o.cust ?? "")).filter((x) => x !== "")).size;
}
/**
 * C4：卡按**业务影响**排序（真数据驱动·非 peak）。排序键 = 营收敞口（万）·次序客户数、基地名定序（确定性）。
 * 改后端 affectedOrders 真源 → 排序随之变（teeth：revert→红）。峰值 peak 不参与排序键。
 */
export function cardBusinessImpact(card: RiskCard): number {
  return cardExposureWan(card);
}
export function sortCardsByImpact(cards: RiskCard[]): RiskCard[] {
  return [...cards].sort((a, b) => {
    const ea = cardBusinessImpact(a), eb = cardBusinessImpact(b);
    if (eb !== ea) return eb - ea;
    const ca = cardThreatenedCusts(a), cb = cardThreatenedCusts(b);
    if (cb !== ca) return cb - ca;
    return a.base.localeCompare(b.base);
  });
}
/**
 * C3 决策摘要头·危及客户 + 总营收敞口聚合（跨给定卡集·通常为 LIVE 决策卡）。
 * 同一订单可经多基地瓶颈受威胁（真后端：SO-xxxx 同挂 合肥/常州）——总敞口按订单号 so 去重、客户按 cust 去重，防双记虚增。
 */
export function aggregateThreat(cards: RiskCard[]): { totalExposure: number; totalCusts: number } {
  const exposureBySo = new Map<string, number>();
  const custSet = new Set<string>();
  let anonSo = 0;
  for (const c of cards) {
    for (const o of orderRows(c)) {
      const rev = typeof o.revenueWan === "number" ? o.revenueWan : Number(o.revenueWan);
      if (Number.isFinite(rev)) {
        const key = o.so != null && String(o.so) !== "" ? `so:${o.so}` : `anon:${anonSo++}`;
        exposureBySo.set(key, rev);
      }
      const cust = String(o.cust ?? "");
      if (cust !== "") custSet.add(cust);
    }
  }
  return { totalExposure: [...exposureBySo.values()].reduce((s, v) => s + v, 0), totalCusts: custSet.size };
}

/**
 * FILL-XINDUSTRY-LAYOUT（G-5 8a·R14）：受影响订单表列（型号/营收敞口等制造订单维度）默认结构。
 * 优先由 `view.layout.affectedOrderColumns` 下发·此常量仅电池兜底（换行业换 config 即换列）。
 */
const DEFAULT_AFFECTED_ORDER_COLUMNS: ViewColumnDef[] = [
  { key: "so", label: "SO" },
  { key: "cust", label: "客户" }, // debattery-allow
  { key: "model", label: "型号" }, // debattery-allow
  { key: "qty", label: "数量" }, // debattery-allow
  { key: "due", label: "交期" }, // debattery-allow
  { key: "delay", label: "预计延误" }, // debattery-allow
  { key: "revenueWan", label: "营收敞口" }, // debattery-allow
];

/**
 * WO-CAPSIM-REPLICA · 「产能推演」看板（renderer=risk-board·PRD §7.3）：1:1 复刻黑曜石 HTML 几何。
 * rk-top（标题+视角/窗口 chip）→ rk-kpi（5 指标条）→ rk-grid（每基地一卡·因素 chip）→ 点开内联 rk-det
 * （逐因素时间轴 + 对症方案 + 对话态 QA）→ 处置计划表。数据全接真求解器（risk_timeline / bottleneck_matrix /
 * mitigation_select / affected_orders）·KILL-MOCK-RED：合成/无源不决策级染红（诚实灰）。
 */
export default function RiskBoardView({ view }: ViewRendererProps) {
  // FILL-XINDUSTRY-LAYOUT（G-5 8a·R14）：产量单位/瓶颈维数兜底/越线带宽/订单列由 ViewConfig.layout 下发·常量仅兜底。
  const unit = (view.layout?.unit as string | undefined) ?? "万套"; // debattery-allow（电池产量单位兜底·换行业经 layout.unit 下发）
  const bandWidth = (view.layout?.bandWidth as number | undefined) ?? 15;
  const affectedOrderColumns = (view.layout?.affectedOrderColumns as ViewColumnDef[] | undefined) ?? DEFAULT_AFFECTED_ORDER_COLUMNS;

  // 交互态（HTML §12）：H=推演窗口 30/60/90 天；openBase=内联展开的基地（非 modal·§3 openRiskCard）。
  const [horizon, setHorizon] = useState(30);
  const [openBase, setOpenBase] = useState<string | null>(null);
  const [ordersDay, setOrdersDay] = useState<{ card: RiskCard; day: number } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["a", "risk-timeline", { horizon }],
    queryFn: async () => {
      const res = await invokeSolver("risk_timeline", { horizon });
      return RiskTimelineOutputSchema.parse(res.data);
    },
  });
  // 逐因素当前张力（基地×7因素）——供卡面因素 chip + 详情逐因素行（主因素外的因素来自此·当前值非逐日）。
  const { data: bn } = useQuery({
    queryKey: ["a", "bottleneck_matrix", "board"],
    queryFn: async () => {
      const res = await invokeSolver("bottleneck_matrix", { dataMode: "LIVE" });
      return BottleneckMatrixOutputSchema.parse(res.data);
    },
  });

  const selectedObjects = useSessionStore((s) => s.selectedObjects);
  const openWhatIf = useOpenWhatIf();
  const canWhatIf = useFeature("sim.sandbox");
  const [searchParams] = useSearchParams();
  const drilledIn = !!searchParams.get("focus");

  if (isLoading || !data) return <div className="empty-state">{zh.common.loading}</div>;

  // WO-KILL-MOCK-RED / WO-DATAMODE-UNIFY-PROVENANCE：决策级红只在真数据 + 真 provenance 时渲染。
  //   顶层/卡 dataMode 显式非 LIVE，或决策世界全合成（confidence.synthetic）⇒ MUTED（灰·不出红）。
  const notLive = (dm?: string | null): boolean => dm != null && dm !== "LIVE";
  const topLive = !notLive(data.dataMode);
  const decisionSynthetic = data.confidence?.synthetic === true;
  const cardDecisionMode = (c: RiskCard): "LIVE" | "MUTED" => {
    if (c.hasData === false) return "MUTED";
    if (decisionSynthetic) return "MUTED"; // 合成 provenance 决策世界 → 不决策级染红（KILL-MOCK-RED）
    if (c.dataMode === "LIVE") return "LIVE"; // 自报实测 + 真 provenance → 出红（真 OEE / 真供需派生）
    if (c.dataMode == null) return topLive ? "LIVE" : "MUTED"; // 未标 → 随顶层（兼容旧 fixture）
    return "MUTED"; // 显式 MOCK/SYNTHETIC / 其它非 LIVE → 中性
  };

  // WO-CAPSIM-IA-UNIFY（M2·③看板 scope=该基地）：`?focus=<baseId|名>` 下钻 → 裁剪到该基地。
  const focusId = resolveBaseId(searchParams.get("focus") ?? undefined);
  const baseScoped = focusId ? data.cards.filter((c) => resolveBaseId(c.base) === focusId) : data.cards;
  const scopedCards = focusId && baseScoped.length > 0 ? baseScoped : data.cards;
  const scopedToBase = focusId != null && baseScoped.length > 0;

  const liveCards = scopedCards.filter((c) => cardDecisionMode(c) === "LIVE");
  const livePeaks = liveCards.map((c) => c.peak ?? 0);
  const maxPeak = livePeaks.length ? Math.max(0, ...livePeaks) : 0;
  const orderedCards = sortCardsByImpact(scopedCards);

  // rk-kpi 5 指标（HTML §2·全聚合自真 risk_timeline / bottleneck·非硬编）：
  //   风险基地=有越线/临近的 LIVE 卡数；风险因素点=各基地越线/临近因素数之和；受影响订单/涉及客户=Σ 去重；最早越线=min crossDay。
  const bnRow = (base: string): BottleneckOutput["rows"][number] | undefined =>
    bn?.rows.find((r) => resolveBaseId(r.base) === resolveBaseId(base));
  const bnLive = bn?.dataMode === "LIVE";
  const factorsOver = (base: string): { factor: string; value: number | null }[] => {
    const row = bnRow(base);
    if (!row) return [];
    return (bn?.factors ?? [])
      .map((f) => ({ factor: f, value: row.tightness[f] ?? null }))
      .filter((x) => x.value != null && x.value >= data.threshold - bandWidth)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  };
  const riskFactorPoints = liveCards.reduce((s, c) => s + Math.max(1, factorsOver(c.base).length), 0);
  const { totalCusts } = aggregateThreat(liveCards);
  const allOrderCount = new Set(liveCards.flatMap((c) => orderRows(c).map((o) => String(o.so ?? "")).filter((x) => x !== ""))).size;
  const crossDays = liveCards.map((c) => c.crossDay).filter((d): d is number => d != null);
  const earliestCross = crossDays.length ? Math.min(...crossDays) : null;
  const summaryRed = liveCards.filter((c) => c.peak != null && c.peak >= data.threshold).length;
  const summaryYellow = liveCards.filter((c) => c.peak != null && c.peak >= data.threshold - bandWidth && c.peak < data.threshold).length;
  const healthNote = data.confidence?.note ?? "";

  const openCard = openBase ? orderedCards.find((c) => c.base === openBase) ?? null : null;

  return (
    <div className={styles.riskwrap}>
      {drilledIn && <DrillBack testId="risk-back" trail={[{ label: "产能推演" }]} />}

      {/* WO-CAPSIM-IA-UNIFY（M2·③看板 scope=该基地）：聚焦下钻提示条——看板已裁剪到该基地。 */}
      {scopedToBase && (
        <div data-testid="risk-scope-focus" data-focus-base={focusId} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 12.5 }}>
          <span className="badge" style={{ background: "var(--accent)", color: "#fff" }}>聚焦基地</span>
          <b className="mono">{focusId}</b>
          <span style={{ color: "var(--muted2)" }}>· 看板已裁剪到该基地推演（{scopedCards.length} 张卡）</span>
        </div>
      )}

      {/* rk-top：标题 + 视角/窗口 chip（HTML §2）。瓶颈视角为主态；30/60/90 天切窗口重算 risk_timeline。 */}
      <div className={styles.rkTop}>
        <div>
          <h3>产能推演</h3>
          <div className={styles.rkSub}>
            监测执行偏离月度计划的风险 · 未来 {horizon} 天预测越线（阈值 {data.threshold}）
            {scopedToBase && <> · 聚焦 <b className="mono">{focusId}</b></>}
          </div>
        </div>
        <div className={styles.rkHsel}>
          <span className={`${styles.tierChip} ${styles.tierChipOn}`} data-testid="risk-tab-risk">瓶颈视角</span>
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

      {/* rk-kpi 条（HTML §2）：5 指标 + 可选数据健康度横幅。值全源自真 risk_timeline/bottleneck。 */}
      <div className={styles.rkKpi} data-testid="risk-kpi">
        <RkK testId="risk-kpi-bases" value={String(summaryRed + summaryYellow)} label="风险基地" color="var(--danger)" />
        <RkK testId="risk-kpi-factorpts" value={String(riskFactorPoints)} label="风险因素点" color="var(--c-solver)" />
        <RkK testId="risk-kpi-orders" value={allOrderCount > 0 ? String(allOrderCount) : "—"} label="受影响订单(批)" color="var(--c-forecast)" />
        <RkK testId="risk-kpi-custs" value={totalCusts > 0 ? String(totalCusts) : "—"} label="涉及客户" color="var(--c-capacity)" />
        <RkK testId="risk-kpi-earliest" value={earliestCross != null ? `T+${earliestCross}` : "—"} label="最早越线日" color="var(--c-solver)" />
        {healthNote && <div className={styles.rkHealth} data-testid="risk-kpi-health">{healthNote}</div>}
      </div>

      {/* 本推演置信度（WO-FRESHNESS·决策级诚实标）：真实↔合成 × 新鲜↔陈旧 × 实测↔估算。 */}
      {data.dataMode && (
        <div data-testid="risk-confidence-banner" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>本推演置信度</span>
          <DataModeBadge mode={data.dataMode} confidence={data.confidence} testId="risk-confidence-datamode" />
        </div>
      )}

      {/* 三档图例（平台决策速查·§2.2-a·与 heat 同阈值口径）+ 首要风险（peak 最高）卡标注。 */}
      <div data-testid="risk-legend" className={styles.rkLeg} style={{ margin: "0 0 10px" }}>
        <span><i style={{ background: "#E0626C" }} />{zh.risk.legendHigh}</span>
        <span><i style={{ background: "#E8B54A" }} />{zh.risk.legendMid}</span>
        <span><i style={{ background: "#43B7D7" }} />{zh.risk.legendLow}</span>
      </div>

      {/* rk-grid：每基地一卡（HTML §3·整卡点击展开·无独立 CTA 按钮）。因素 chip 来自 bottleneck 真值。 */}
      <div className={styles.rkGrid}>
        {orderedCards.map((card) => {
          const mode = cardDecisionMode(card);
          const live = mode === "LIVE";
          const selected = selectedObjects.some((o) => o.label === card.base) || openBase === card.base;
          const noData = card.hasData === false;
          const peakColor = decisionColor(card.peak, data.threshold, live ? "LIVE" : "MOCK");
          const chips = factorsOver(card.base);
          const exposure = cardExposureWan(card);
          const custs = cardThreatenedCusts(card);
          const currentVal = card.currentTightness?.value;
          const isPrimary = live && maxPeak > 0 && card.peak === maxPeak;
          return (
            <div
              key={card.base}
              className={`${styles.rkCard} ${selected ? styles.rkCardOpen : ""}`}
              data-testid={`risk-card-${card.base}`}
              data-decision-mode={mode}
              role="button"
              tabIndex={0}
              style={{ borderColor: live ? `${peakColor}55` : "var(--border)", opacity: live || noData ? 1 : 0.82 }}
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
                  data={{ base: card.base, factor: card.factor, peak: card.peak, crossDay: card.crossDay, series: card.series, threshold: data.threshold, dataMode: live ? "LIVE" : (card.dataMode ?? "MOCK") }}
                  testId={`risk-factor-${card.base}`}
                >
                  <span className={styles.rkOwn}>{card.factor}</span>
                </RiskHoverTrigger>
              </div>
              {noData ? (
                <div className="empty-state" data-testid={`risk-nodata-${card.base}`} style={{ fontSize: 11, lineHeight: 1.55, color: "var(--muted)", marginTop: 4 }}>
                  {card.noDataReason ?? NO_DATA_HINT}
                  {card.deeplink && (
                    <div style={{ marginTop: 6 }}>
                      <Link to={card.deeplink.to} data-testid={`risk-nodata-cta-${card.base}`} onClick={(e) => e.stopPropagation()} style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>
                        {card.deeplink.label}
                      </Link>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className={styles.rkCM}>
                    <span className={styles.rkPeak} data-testid={`risk-peak-${card.base}`} style={{ color: peakColor }}>
                      {live && card.crossDay != null ? `T+${card.crossDay}` : card.peak != null ? card.peak.toFixed(0) : "—"}
                    </span>
                    <span className={styles.rkUnit}>
                      {live && card.crossDay != null ? "最早越线" : live ? "峰值张力" : "估算·无实测"}
                    </span>
                  </div>
                  {/* KILL-MOCK-RED 诚实标（G-DM-1·平台honesty层叠于1:1）：LIVE 标真实测当前值·非 LIVE 标估算无实测。 */}
                  <div className={styles.rkOwn} data-testid={`risk-datamode-${card.base}`} style={{ marginBottom: 4, color: live ? "var(--muted)" : "var(--warn)" }}>
                    {live ? `实测当前 ${currentVal != null ? Math.round(currentVal) : "—"}` : `估算·无实测${currentVal != null ? `（基线 ${Math.round(currentVal)}）` : ""}`}
                  </div>
                  {chips.length > 0 && (
                    <div className={styles.rkChips} data-testid={`risk-chips-${card.base}`}>
                      {chips.map((ch) => {
                        const col = decisionColor(ch.value, data.threshold, bnLive ? "LIVE" : "MOCK");
                        return (
                          <span key={ch.factor} className={styles.rkFchip} style={{ borderColor: `${col}66`, color: col }}>
                            {ch.factor} {ch.value != null ? Math.round(ch.value) : "—"}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div className={styles.rkCF}>
                    {/* KILL-MOCK-RED：决策级红（danger 色）只在真数据卡（live）出——合成/无源卡走中性色·不冒充决策红。 */}
                    <span data-testid={`risk-affected-${card.base}`}>
                      受威胁客户 <b data-testid={`risk-custs-${card.base}`} style={{ color: live ? "var(--danger)" : "var(--muted)" }}>{custs}</b>
                      {" · 敞口 "}
                      <b className="mono" data-testid={`risk-exposure-${card.base}`} style={{ color: live ? "var(--danger)" : "var(--muted)" }}>{exposure > 0 ? `${Math.round(exposure)} 万` : "—"}</b>
                    </span>
                    <span>{orderRows(card).length} 批订单</span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* 内联详情（HTML §3-§5·非 modal）：逐因素时间轴 + 对症方案 + 对话态 QA。 */}
      {openCard && (
        <RiskDetailPanel
          card={openCard}
          bnRow={bnRow(openCard.base)}
          bnFactors={bn?.factors ?? []}
          bnLive={bnLive}
          threshold={data.threshold}
          bandWidth={bandWidth}
          horizon={horizon}
          live={cardDecisionMode(openCard) === "LIVE"}
          isPrimary={cardDecisionMode(openCard) === "LIVE" && maxPeak > 0 && openCard.peak === maxPeak}
          canWhatIf={canWhatIf}
          openWhatIf={openWhatIf}
          onDay={(day) => setOrdersDay({ card: openCard, day })}
          unit={unit}
        />
      )}

      {ordersDay && <AffectedOrdersModal card={ordersDay.card} day={ordersDay.day} onClose={() => setOrdersDay(null)} unit={unit} columns={affectedOrderColumns} />}

      {/* 处置计划表（HTML §8）：按越线日前置排启动·采纳经审批下发工单。顶层非 LIVE ⇒ 不渲染决策级处置。 */}
      {topLive && (data.planRows?.length ?? 0) > 0 && (
        <div className={styles.rkDet} style={{ marginTop: 14 }} data-testid="risk-plan-panel">
          <div className={styles.rkDetH}>
            <b>📋 {zh.risk.planTitle}</b>
            <span>{zh.risk.planSub(data.planRows!.length)}</span>
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
                <tr key={i} data-testid={`risk-plan-row-${i}`}>
                  <td className="mono"><b>{i + 1}</b></td>
                  <td className="zh"><b>{r.act}</b>{r.det ? <><br /><span style={{ fontSize: 9, color: "var(--muted2)" }}>{r.det}</span></> : null}</td>
                  <td className="zh">{r.owner}</td>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>{r.start}</td>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>{r.done}</td>
                  <td className="zh" style={{ color: "var(--ok)" }}>{r.eff}</td>
                  <td><span className="badge">{r.rule}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 历史处置案例 + 风险推演编排过程 DAG（保留·看板下半区）。 */}
      <HistoricalCasesSection />
      <InferenceProcessPanel testId="inference-risk" solved />
    </div>
  );
}

/** rk-kpi 单卡（HTML .rk-k）：数值在上（19px 等宽·着色）、标签在下（9.5px）。 */
function RkK({ testId, value, label, color }: { testId: string; value: string; label: string; color: string }) {
  return (
    <div className={styles.rkK} data-testid={testId}>
      <b style={{ color }} data-testid={`${testId}-value`}>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/**
 * 内联详情面板（HTML §3-§5 openRiskCard #rkDetail）：
 *  逐因素时间轴（.rk-tl·主因素真逐日 series·其余因素当前值·无逐日源诚实灰）→ 图例 → 两栏（对症方案 rk-sol + 对话态 QA）。
 */
function RiskDetailPanel({
  card, bnRow, bnFactors, bnLive, threshold, bandWidth, horizon, live, isPrimary, canWhatIf, openWhatIf, onDay, unit,
}: {
  card: RiskCard;
  bnRow?: BottleneckOutput["rows"][number];
  bnFactors: string[];
  bnLive: boolean;
  threshold: number;
  bandWidth: number;
  horizon: number;
  live: boolean;
  isPrimary: boolean;
  canWhatIf: boolean;
  openWhatIf: ReturnType<typeof useOpenWhatIf>;
  onDay: (day: number) => void;
  unit: string;
}) {
  const H = card.series.length || horizon;
  // 逐因素行：主因素（真逐日 series·decisionHeat 着色·MOCK/无源→灰）+ 其余越线/临近因素（当前值·无逐日源→灰点·不伪造）。
  const others = (bnFactors ?? [])
    .filter((f) => f !== card.factor)
    .map((f) => ({ factor: f, value: bnRow?.tightness[f] ?? null }))
    .filter((x) => x.value != null && x.value >= threshold - bandWidth)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const tickLabel = (d: number): string => (d === 1 || d % 5 === 0 || d === H ? `D+${d}` : "");

  return (
    <div className={styles.rkDet} data-testid={`risk-detail-${card.base}`}>
      <div className={styles.rkDetH}>
        <b>{card.base} · 产能影响对象全景</b>
        <span>未来 {H} 天 · 悬停任意点看当日影响{isPrimary ? " · 首要风险" : ""}</span>
      </div>

      {/* 逐因素时间轴（HTML §4 .rk-tl）。 */}
      {live && card.series.length > 0 ? (
        <div className={styles.rkTl} data-testid="risk-timeline">
          <div className={styles.rkTicks}>
            {card.series.map((_, i) => (
              <span key={i} className={styles.rkTick}>{tickLabel(i + 1)}</span>
            ))}
          </div>
          {/* 主因素：真逐日 series（点击某日→受影响订单）。 */}
          <FactorRow
            label={card.factor}
            sub={`${card.currentTightness?.value != null ? Math.round(card.currentTightness.value) : "—"}→${card.peak != null ? Math.round(card.peak) : "—"} · ${card.crossDay != null ? `T+${card.crossDay} 越线` : "窗口内不越线"}`}
            color={decisionColor(card.peak, threshold, "LIVE")}
            dots={card.series.map((v) => ({ color: decisionHeat(v, threshold, "LIVE"), value: v }))}
            onDay={onDay}
          />
          {/* 其余越线/临近因素：仅当前值（无逐日源）→ 灰点 + 当前值标注（不伪造逐日·G-DM-1）。 */}
          {others.map((o) => (
            <FactorRow
              key={o.factor}
              label={o.factor}
              sub={`当前 ${o.value != null ? Math.round(o.value) : "—"} · 无逐日实测源`}
              color={decisionColor(o.value, threshold, bnLive ? "LIVE" : "MOCK")}
              dots={card.series.map(() => ({ color: "rgba(138,148,166,.28)", value: null }))}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state" data-testid="risk-detail-nodata" style={{ fontSize: 12, lineHeight: 1.7, color: "var(--muted)", marginBottom: 10 }}>
          {card.noDataReason ?? NO_DATA_HINT}
        </div>
      )}

      <div className={styles.rkLeg}>
        <span><i style={{ background: "#43B7D7" }} />&lt;{threshold - bandWidth} 正常</span>
        <span><i style={{ background: "#E8B54A" }} />{threshold - bandWidth}-{threshold - 1} 关注</span>
        <span><i style={{ background: "#E0626C" }} />≥{threshold} 瓶颈</span>
        <span style={{ marginLeft: 14, color: "var(--muted2)" }}>
          首要风险对象：{card.factor}{card.crossDay != null ? `（T+${card.crossDay} 越线）` : ""}
        </span>
      </div>

      {/* 两栏（HTML .rk-two）：左对症方案（mitigation_select 真求解器）· 右对话态 QA（同源真数据 R6）。 */}
      <div className={styles.rkTwo}>
        <MitigationCards base={card.base} factor={card.factor} tightness={card.peak ?? 0} canWhatIf={canWhatIf} openWhatIf={openWhatIf} cardFactor={card.factor} cardBase={card.base} />
        <QaPanel card={card} unit={unit} threshold={threshold} />
      </div>
    </div>
  );
}

/** 单因素时间轴行（HTML .rk-frow）：168px 标签 + 逐日圆点。主因素点可点→受影响订单。 */
function FactorRow({ label, sub, color, dots, onDay }: {
  label: string; sub: string; color: string; dots: { color: string; value: number | null }[]; onDay?: (day: number) => void;
}) {
  return (
    <div className={styles.rkFrow} data-testid={`risk-frow-${label}`}>
      <div className={styles.rkFlab}>
        <b style={{ color }}>{label}</b>
        <span>{sub}</span>
      </div>
      <div className={styles.rkDots}>
        {dots.map((d, i) => (
          <button
            key={i}
            className={styles.rkDot}
            style={{ background: d.color }}
            title={d.value != null ? `D+${i + 1} · ${Math.round(d.value)}` : `D+${i + 1} · 无实测`}
            data-testid={onDay ? `risk-dot-${i}` : undefined}
            onClick={onDay ? () => onDay(i) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

type MitPlan = { key: string; name: string; eff: number; tn: number; cost: string; risk?: string; score: number };

/** 对症方案堆叠卡（HTML §5 .rk-sol）：mitigation_select 真求解器优选·采纳→工单审批（adopt_mitigation·R4）。 */
function MitigationCards({ base, factor, tightness, canWhatIf, openWhatIf, cardBase, cardFactor }: {
  base: string; factor: string; tightness: number; canWhatIf: boolean; openWhatIf: ReturnType<typeof useOpenWhatIf>; cardBase: string; cardFactor: string;
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
  return (
    <div>
      <div className={styles.wfT} style={{ color: "var(--ok)" }}>💡 对症方案 · {factor}（{plans.length} 个）</div>
      {isLoading ? (
        <div style={{ color: "var(--muted2)", fontSize: 11 }}>{zh.common.loading}</div>
      ) : !plans.length ? (
        <div className="empty-state" style={{ fontSize: 11 }}>{zh.common.none}</div>
      ) : (
        plans.map((p, i) => (
          <div key={p.key} className={styles.rkSol} data-testid={`mitigation-plan-${p.key}`}>
            <div className={styles.rkSolH}>
              <b>
                {i + 1}. {p.name}
                {p.key === data?.recommended && <span className="badge" style={{ marginLeft: 6, background: "var(--ok)", color: "#0a1f12", fontSize: 9 }}>推荐</span>}
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
            <div className={styles.rkSolM}>见效 {p.eff}pp · 周期 {p.tn}周 · 投入:{p.cost} · 风险:{p.risk ?? "—"} · 评分 {p.score}</div>
          </div>
        ))
      )}
      {canWhatIf && (
        <button
          className={styles.fcGo}
          data-testid="risk-open-whatif"
          style={{ marginTop: 4 }}
          onClick={() => openWhatIf({ source: "risk-board", subject: cardBase, factor: cardFactor, label: `${cardBase} · ${cardFactor}` })}
        >
          开 what-if 深度推演 →
        </button>
      )}
    </div>
  );
}

/**
 * 对话态 QA（HTML §5 右栏 · WO §5 两态同源 R6）：预设问 + 追问框，答案**确定性派生自已取的真求解器输出**
 * （affectedOrders / crossDay / demandGap / exposure），非另起 LLM、非伪造——与嵌入态同一批真数据同源。
 */
function QaPanel({ card, unit, threshold }: { card: RiskCard; unit: string; threshold: number }) {
  const [ans, setAns] = useState<string>("点击下方问题，或输入追问。答案由本卡真求解器输出（受影响订单/越线日/缺口）确定性派生。");
  const [input, setInput] = useState("");
  const orders = orderRows(card);
  const custs = [...new Set(orders.map((o) => String(o.cust ?? "")).filter(Boolean))];
  const sos = orders.map((o) => String(o.so ?? "")).filter(Boolean);
  const exposure = cardExposureWan(card);
  const gap = card.demandGap;

  const answer = (q: string): string => {
    if (/客户|谁/.test(q)) return custs.length ? `受威胁客户 ${custs.length} 家：${custs.join("、")}（源：受影响订单去重）。` : "该基地当前无关联受影响客户（受影响订单为空）。";
    if (/订单|批/.test(q)) return sos.length ? `受影响订单 ${sos.length} 批：${sos.slice(0, 8).join("、")}${sos.length > 8 ? " 等" : ""}（营收敞口 ≈ ${Math.round(exposure)} 万）。` : "该基地当前无在产订单落入越线传导窗口。";
    if (/为什么|原因|越线/.test(q)) return gap ? `${card.factor} 紧张度由真需求-产能缺口派生：缺口 ≈ ${gap.gapWan} ${unit}（来源 ${gap.source}），${card.crossDay != null ? `预计 T+${card.crossDay} 越线阈值 ${threshold}` : "窗口内暂不越线"}。` : `${card.factor} ${card.crossDay != null ? `预计 T+${card.crossDay} 越线（阈值 ${threshold}）` : "窗口内暂不越线"}；峰值张力 ${card.peak != null ? Math.round(card.peak) : "—"}。`;
    if (/最坏|后果|影响/.test(q)) return `最坏后果：${custs.length} 家客户 / ${sos.length} 批订单受影响，营收敞口 ≈ ${Math.round(exposure)} 万${card.crossDay != null ? `，最早 T+${card.crossDay} 越线` : ""}。`;
    return `已知本卡真值：峰值 ${card.peak != null ? Math.round(card.peak) : "—"} · ${card.crossDay != null ? `T+${card.crossDay} 越线` : "不越线"} · 受威胁客户 ${custs.length} · 敞口 ${Math.round(exposure)} 万。可问：影响哪些客户 / 哪些订单 / 为什么越线 / 最坏后果。`;
  };
  const presets = ["影响哪些客户？", "哪些订单受影响？", "为什么会越线？", "最坏后果是什么？"];

  return (
    <div>
      <div className={styles.wfT} style={{ color: "var(--c-capacity)" }}>💬 人机对话 · 同源求解器</div>
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
          placeholder="输入追问，如：影响哪些客户？"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) { setAns(answer(input)); setInput(""); } }}
        />
        <button data-testid="risk-qa-ask" onClick={() => { if (input.trim()) { setAns(answer(input)); setInput(""); } }}>问</button>
      </div>
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
 * MOCK 卡诚实声明「张力曲线为 mock 基线启发（非实测）」；空列表给诚实解释，绝不裸空。
 */
function AffectedOrdersModal({ card, day: _day, onClose, unit, columns }: { card: RiskCard; day: number; onClose: () => void; unit: string; columns: ViewColumnDef[] }) {
  const orders = (card.affectedOrders ?? []) as Record<string, unknown>[];
  const isMock = card.dataMode === "MOCK";
  const monoKeys = useMemo(() => new Set(["qty", "due", "delay", "revenueWan"]), []);
  const cellText = (o: Record<string, unknown>, key: string): string => {
    if (key === "delay") return o.delay != null ? `+${o.delay}天` : "—";
    if (key === "revenueWan") return o.revenueWan != null ? `${o.revenueWan} 万` : "—";
    return String(o[key] ?? "—");
  };
  const baselineN = card.currentTightness?.value != null ? Math.round(card.currentTightness.value) : null;
  const demandGap = card.demandGap;
  return (
    <Modal title={`${zh.risk.affectedOrders} · ${card.base} · ${card.factor}`} onClose={onClose} width={680}>
      {!isMock && demandGap && (
        <div data-testid="affected-orders-demand-gap" style={{ background: "rgba(98,190,119,.12)", border: "1px solid var(--ok)", borderRadius: 6, padding: "8px 10px", fontSize: 11.5, color: "var(--muted)", marginBottom: 10 }}>
          ✓ 该因素（{card.factor}）紧张度由<b>真需求-产能缺口</b>派生（基线 {baselineN ?? "—"}·<b>非哈希</b>·确定性可溯）。
          缺口 = <b>预测需求 − 产能</b> ≈ <b className="mono">{demandGap.gapWan} {unit}</b>（来源：{demandGap.source}）。
        </div>
      )}
      {isMock && (
        <div data-testid="affected-orders-mock-note" style={{ background: "rgba(202,162,58,.12)", border: "1px solid var(--warn)", borderRadius: 6, padding: "8px 10px", fontSize: 11.5, color: "var(--muted)", marginBottom: 10 }}>
          ⚠ 该因素（{card.factor}）<b>无真数据源</b>，张力曲线为 mock 基线启发估算（基线 {baselineN ?? "—"}·<b>非实测</b>）。下表受影响订单由<b>产能传导引擎</b>按越线日真算，<b>非由该 mock 红色直接产生</b>。
        </div>
      )}
      <table className="cmp" data-testid="affected-orders-table">
        <thead>
          <tr>{columns.map((col) => (<th key={col.key} data-col={col.key}>{col.label}</th>))}</tr>
        </thead>
        <tbody>
          {orders.map((o, i) => (
            <tr key={String(o.so ?? i)}>
              {columns.map((col) => (<td key={col.key} className={col.key === "cust" ? "zh" : monoKeys.has(col.key) ? "mono" : undefined}>{cellText(o, col.key)}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
      {orders.length === 0 && (
        <div className="empty-state" data-testid="affected-orders-empty" style={{ fontSize: 12, lineHeight: 1.6 }}>
          该基地在越线日 {card.crossDay != null ? `D+${card.crossDay}` : "（无越线）"} 的产能传导窗口内<b>无在产订单</b>关联。
        </div>
      )}
    </Modal>
  );
}
