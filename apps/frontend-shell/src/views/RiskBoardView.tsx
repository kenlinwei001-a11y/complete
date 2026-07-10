import { useState } from "react";
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
import { useOpenWhatIf } from "./sim/whatif";
import { useFeature } from "@/workspace/featureGate";
import type { ViewRendererProps } from "./registry";
import { InferenceProcessPanel } from "@/components/InferenceProcessPanel";
import { DataModeBadge } from "@/components/DataModeBadge";
import { DrillBack } from "@/components/DrillBack";
import zh from "@/locales/zh";
import styles from "./RiskBoardView.module.css";

type RiskCard = RiskTimelineOutput["cards"][number];

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

/** 推演看板（renderer=risk-board，PRD §7.3）：风险卡网格 + 逐日 heat strip + 受影响订单弹窗 */
export default function RiskBoardView({ view }: ViewRendererProps) {
  // FILL-XINDUSTRY-LAYOUT（G-5 8a·R14）：产量单位/瓶颈维数兜底/越线带宽/订单列由 ViewConfig.layout 下发·常量仅兜底。
  const unit = (view.layout?.unit as string | undefined) ?? "万套"; // debattery-allow（电池产量单位兜底·换行业经 layout.unit 下发）
  const factorCount = (view.layout?.factorCount as number | undefined) ?? 7;
  const bandWidth = (view.layout?.bandWidth as number | undefined) ?? 15;
  const affectedOrderColumns = (view.layout?.affectedOrderColumns as ViewColumnDef[] | undefined) ?? DEFAULT_AFFECTED_ORDER_COLUMNS;
  const { data, isLoading } = useQuery({
    queryKey: ["a", "risk-timeline", {}],
    queryFn: async () => {
      const res = await invokeSolver("risk_timeline", {});
      return RiskTimelineOutputSchema.parse(res.data);
    },
  });
  const selectedObjects = useSessionStore((s) => s.selectedObjects);
  const [detail, setDetail] = useState<RiskCard | null>(null);
  const [ordersDay, setOrdersDay] = useState<{ card: RiskCard; day: number } | null>(null);
  // WO-E2（沙盘 what-if 进决策日常）：风险红点一键「开 what-if」→ 带该风险上下文进沙盘（复用既有沙盘链）。
  const openWhatIf = useOpenWhatIf();
  // R3 修正：沙盘暗发·默认关——仅 sim.sandbox entitlement 开通时才现「开 what-if」按钮，否则关（避免落沙盘 404 死路）。
  const canWhatIf = useFeature("sim.sandbox");
  // R17 下钻回退：仅当带 ?focus=（从地图/季度滚动「查看风险」下钻进）才显返回；
  // 无 focus = 从左导航直达的顶层视图，不显（避免污染顶层入口）。
  const [searchParams] = useSearchParams();
  const drilledIn = !!searchParams.get("focus");

  if (isLoading || !data) return <div className="empty-state">{zh.common.loading}</div>;

  // WO-KILL-MOCK-RED 阶段②（治本·渲染门）：决策级红/越线/峰值/planRows 只在真数据时渲染。
  // 判据（向后兼容·仅显式非 LIVE 才抑制，未标 dataMode 的旧 fixture/真 LIVE 保持既有行为）：
  //   顶层 dataMode 未标或 ===LIVE  ⊕  该卡 dataMode 未标或 ===LIVE  ⊕  hasData!==false。
  //   任一为「显式非 LIVE」(MOCK/SYNTHETIC/…) 或 hasData===false ⇒ MUTED（灰/空态·不出红）。
  //   洛阳·设备OEE（后端合成租户返 SYNTHETIC 或该因子 MOCK/hasData=false）⇒ 命中 MUTED。
  const notLive = (dm?: string | null): boolean => dm != null && dm !== "LIVE";
  const topLive = !notLive(data.dataMode);
  // WO-RISK-FIX bug①（旗舰预判失真·修 KILL-MOCK-RED 顶层门对 LIVE 卡过度抑制的回归）：
  //   卡**自报 dataMode==="LIVE"**（后端由真实测 OEE liveTightness 算出·hasData!==false）⇒ LIVE
  //   —— 即便顶层 dataMode=SYNTHETIC（demo 对象合成），真实测卡的越线/峰值/series 仍照常出（真数据非顶层能抹）。
  //   卡未标 dataMode（旧 fixture）⇒ 随顶层 topLive（向后兼容）；卡显式非 LIVE（MOCK/SYNTHETIC）或 hasData=false ⇒ MUTED。
  // WO-CAP-01-REALDEMAND（闭 G-SIM-FAKE·诚实位）：合成源卡（后端 risk.ts 令 source=SYNTHETIC 的合成扁平产线
  //   利用率兜底卡）dataMode 继承 "SYNTHETIC" 而非自报 LIVE → 命中下方 `return "MUTED"`，**不决策级染红**（走灰
  //   估算·无实测）；真供需/真实测卡（dataMode="LIVE"）仍如常出真张力/越线红。前端无需改判据——后端诚实位下沉即生效。
  const cardDecisionMode = (c: RiskCard): "LIVE" | "MUTED" => {
    if (c.hasData === false) return "MUTED";
    if (c.dataMode === "LIVE") return "LIVE"; // 自报实测 → 出红（不被顶层合成过度抑制·非伪造：真 OEE / 真供需派生）
    if (c.dataMode == null) return topLive ? "LIVE" : "MUTED"; // 未标 → 随顶层（兼容旧 fixture/真 LIVE 顶层）
    return "MUTED"; // 显式 MOCK/SYNTHETIC（含 WO-CAP-01 合成源卡）/其它非 LIVE → 中性
  };
  // 首要风险仅在真数据卡间取（避免合成/mock 峰值抢「首要」红标）。
  const liveCards = data.cards.filter((c) => cardDecisionMode(c) === "LIVE");
  const livePeaks = liveCards.map((c) => c.peak ?? 0);
  const maxPeak = livePeaks.length ? Math.max(0, ...livePeaks) : 0;
  // C4：卡按业务影响（营收敞口）排序——真数据驱动·非 peak（改后端 affectedOrders 真源→次序随之变）。
  const orderedCards = sortCardsByImpact(data.cards);
  // C3 决策摘要头（高管决策漏斗）：全部聚合自真 risk_timeline（非硬编）。
  //   红/黄基地数 = LIVE 卡按峰值越阈值/临近分档；最早越线日 = LIVE 卡 crossDay 最小；
  //   危及客户数/总敞口 = Σ 各卡 affectedOrders 去重客户/revenueWan（真值）；对策数 = planRows 行数。
  const summaryRed = liveCards.filter((c) => c.peak != null && c.peak >= data.threshold).length;
  const summaryYellow = liveCards.filter((c) => c.peak != null && c.peak >= data.threshold - bandWidth && c.peak < data.threshold).length;
  const crossDays = liveCards.map((c) => c.crossDay).filter((d): d is number => d != null);
  const earliestCross = crossDays.length ? Math.min(...crossDays) : null;
  // 危及客户/总敞口只聚合 LIVE 决策卡（与红/黄/最早越线同口径）——不让 MOCK/合成估算张力的卡虚增决策级威胁数字（诚实边界）；
  // 并按订单号 so 去重敞口、cust 去重客户（同订单多基地受威胁防双记）。
  const { totalExposure, totalCusts } = aggregateThreat(liveCards);
  const mitigationCount = data.planRows?.length ?? 0;
  return (
    <div>
      {drilledIn && <DrillBack testId="risk-back" trail={[{ label: "风险看板" }]} />}
      {/* C3 决策摘要头（诊断台→高管决策漏斗）：一屏聚合当前推演的决策级真值——红/黄基地、最早越线、危及客户、总敞口、对策数。
          值源自真 risk_timeline（LIVE 卡 + affectedOrders 真算），非硬编；无真数据自然归零（诚实）。 */}
      <div className={styles.summary} data-testid="risk-decision-summary">
        <SummaryStat testId="risk-summary-red" label="越线基地" value={String(summaryRed)} tone="danger" suffix="个" />
        <SummaryStat testId="risk-summary-yellow" label="临近基地" value={String(summaryYellow)} tone="warn" suffix="个" />
        <SummaryStat testId="risk-summary-earliest" label="最早越线" value={earliestCross != null ? `D+${earliestCross}` : "—"} />
        <SummaryStat testId="risk-summary-custs" label="危及客户" value={String(totalCusts)} suffix="家" />
        <SummaryStat testId="risk-summary-exposure" label="营收敞口" value={totalExposure > 0 ? String(Math.round(totalExposure)) : "—"} suffix={totalExposure > 0 ? "万" : ""} tone="danger" />
        <SummaryStat testId="risk-summary-mitigations" label="对策" value={String(mitigationCount)} suffix="项" />
      </div>
      {/* §2.2-a 三档图例文案（红/黄/蓝档与 heat strip/MiniStrip 同色阈值口径）+ 首要风险（peak 最高）标注 */}
      <div data-testid="risk-legend" style={{ display: "flex", gap: 14, fontSize: 12, marginBottom: 8, alignItems: "center", color: "var(--muted)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, background: "#E0626C", borderRadius: 2 }} />{zh.risk.legendHigh}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, background: "#E8B54A", borderRadius: 2 }} />{zh.risk.legendMid}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, background: "#43B7D7", borderRadius: 2 }} />{zh.risk.legendLow}</span>
      </div>
      {/* WO-FRESHNESS：置信度三维（真实↔合成 × 新鲜↔陈旧 × 实测↔估算）——决策级诚实标，悬浮见三维分解。 */}
      {data.dataMode && (
        <div data-testid="risk-confidence-banner" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>本推演置信度</span>
          <DataModeBadge mode={data.dataMode} confidence={data.confidence} testId="risk-confidence-datamode" />
          {data.confidence?.note && (
            <span style={{ fontSize: 11, color: "var(--muted2)" }}>{data.confidence.note}</span>
          )}
        </div>
      )}
      <div className={styles.grid}>
        {orderedCards.map((card) => {
          const selected = selectedObjects.some((o) => o.label === card.base);
          const mode = cardDecisionMode(card);
          const live = mode === "LIVE";
          const isPrimary = live && maxPeak > 0 && card.peak === maxPeak;
          // hasData=false（无真源诚实空态卡·洛阳原案）：整卡灰、显 noDataReason、移出越线判定。
          const noData = card.hasData === false;
          const currentVal = card.currentTightness?.value;
          return (
            <div
              key={`${card.base}:${card.factor}`}
              className={`${styles.card} ${selected ? styles.cardSelected : ""}`}
              data-testid={`risk-card-${card.base}`}
              data-decision-mode={mode}
              role="button"
              tabIndex={0}
              style={live ? undefined : { opacity: 0.72 }}
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
                {isPrimary && <span className="badge" data-testid={`risk-primary-${card.base}`} style={{ background: "var(--danger)", color: "#fff", fontSize: 10 }}>{zh.risk.primaryTag}</span>}
                {/* §7.3 风险弹窗（与 order-chain 风险点 chip 共用 RiskPopover 组件）·透传 dataMode（非 LIVE→灰） */}
                <RiskHoverTrigger
                  data={{ base: card.base, factor: card.factor, peak: card.peak, crossDay: card.crossDay, series: card.series, threshold: data.threshold, dataMode: live ? "LIVE" : (card.dataMode ?? "MOCK") }}
                  testId={`risk-factor-${card.base}`}
                >
                  <span className="badge">{card.factor}</span>
                </RiskHoverTrigger>
              </div>
              {/* WO-KILL-MOCK-RED 治本：无真源诚实空态卡（hasData=false·含洛阳·设备OEE）——
                  不渲染峰值/越线/日条红，只出 noDataReason 引导接入真实数据。 */}
              {noData ? (
                <div className="empty-state" data-testid={`risk-nodata-${card.base}`}
                  style={{ fontSize: 11.5, lineHeight: 1.6, color: "var(--muted)", marginTop: 4 }}>
                  {card.noDataReason ?? NO_DATA_HINT}
                  {/* CAPACITY-BASECARDS-REALDATA：actionable 深链去数据接入/上传（非静默跳过·非假红）——
                      stopPropagation 避免触发卡片 setDetail。 */}
                  {card.deeplink && (
                    <div style={{ marginTop: 6 }}>
                      <Link
                        to={card.deeplink.to}
                        data-testid={`risk-nodata-cta-${card.base}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontSize: 11.5, color: "var(--accent, #43B7D7)", fontWeight: 600 }}
                      >
                        {card.deeplink.label}
                      </Link>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* C2 卡面副标题：受威胁客户 + 营收敞口——读 card.affectedOrders 真值（去重客户 / Σ revenueWan），
                      前端不写死；无关联订单则诚实"—"（改后端真源→值随之变）。 */}
                  {(() => {
                    const custs = cardThreatenedCusts(card);
                    const exposure = cardExposureWan(card);
                    return (
                      <div className={styles.subtitle} data-testid={`risk-affected-${card.base}`}>
                        受威胁客户 <b data-testid={`risk-custs-${card.base}`}>{custs}</b>
                        <span style={{ margin: "0 6px", color: "var(--line2)" }}>·</span>
                        营收敞口 <b className="mono" data-testid={`risk-exposure-${card.base}`}>{exposure > 0 ? `${Math.round(exposure)} 万` : "—"}</b>
                      </div>
                    );
                  })()}
                  {/* 诚实标 dataMode：MOCK/合成/无真源 → "估算·无实测"；仅真数据卡标"实测当前 N"。 */}
                  {!live && (
                    <div className="badge" data-testid={`risk-datamode-${card.base}`} title="该因素无真数据源（或合成/顶层非实测），基线张力为启发/合成估算（非实测）——不作决策红"
                      style={{ background: "var(--warn, #caa23a)", color: "#1a1400", fontSize: 10, alignSelf: "flex-start" }}>
                      估算·无实测{currentVal != null ? `（基线 ${Math.round(currentVal)}）` : ""}
                    </div>
                  )}
                  {live && currentVal != null && (
                    <div className="badge" data-testid={`risk-datamode-${card.base}`}
                      style={{ fontSize: 10, alignSelf: "flex-start", opacity: 0.8 }}>
                      实测当前 {Math.round(currentVal)}
                    </div>
                  )}
                  <div className={styles.metrics}>
                    <span>
                      {zh.risk.peak}
                      <b className="mono" style={{ color: decisionColor(card.peak, data.threshold, live ? "LIVE" : "MOCK") }}>
                        {card.peak != null ? card.peak.toFixed(0) : "—"}
                      </b>
                    </span>
                    <span>
                      {zh.risk.crossDay}
                      {/* 治本：非 LIVE 不出越线日（哈希/合成越线不作决策结论）。 */}
                      <b className="mono">{live && card.crossDay != null ? `D+${card.crossDay}` : zh.risk.noCross}</b>
                    </span>
                  </div>
                  <MiniStrip series={card.series} threshold={data.threshold} dataMode={live ? "LIVE" : "MOCK"} />
                  {/* C1 卡面一级「开推演对策」：一键带 {base,factor} presetContext 进沙盘（复用既有沙盘链·非仅详情内 risk-open-whatif）。
                      sim.sandbox entitlement 关时诚实降级为禁用态 + 说明，不 navigate（避免落沙盘 404 死路）。 */}
                  <div className={styles.cardActions}>
                    {canWhatIf ? (
                      <button
                        className="btn sm primary"
                        data-testid={`risk-card-whatif-${card.base}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          openWhatIf({ source: "risk-board", subject: card.base, factor: card.factor, label: `${card.base} · ${card.factor}` });
                        }}
                      >
                        开推演对策 →
                      </button>
                    ) : (
                      <button
                        className="btn sm"
                        data-testid={`risk-card-whatif-${card.base}`}
                        data-disabled-reason="sim.sandbox"
                        disabled
                        title="推演沙盘（sim.sandbox）未开通——开通后可就此风险一键开对策推演（当前不跳转，避免落沙盘 404 死路）"
                        onClick={(e) => e.stopPropagation()}
                      >
                        开推演对策（未开通）
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {detail && (
        <Modal title={`${detail.base} · ${detail.factor}`} onClose={() => setDetail(null)} width={720}>
          {/* WO-E2：就此风险一键「开 what-if」→ 带上下文（基地/因素）进推演沙盘，对比基线、决策完即弃/采纳（R3 隔离）。
              R3 门控：仅 sim.sandbox entitlement 开通才现（关→不现，避免落沙盘 404 死路）。 */}
          {canWhatIf && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <button
                className="btn sm primary"
                data-testid="risk-open-whatif"
                onClick={() =>
                  openWhatIf({
                    source: "risk-board",
                    subject: detail.base,
                    factor: detail.factor,
                    label: `${detail.base} · ${detail.factor}`,
                  })
                }
              >
                就此问题开 what-if 推演 →
              </button>
            </div>
          )}
          {(() => {
            // 治本：详情弹窗同顶层门——detail 非真数据卡（合成/无真源/hasData=false）不渲染红越线曲线/日条，出诚实空态。
            const detailLive = cardDecisionMode(detail) === "LIVE";
            if (!detailLive || detail.series.length === 0) {
              return (
                <div className="empty-state" data-testid="risk-detail-nodata" style={{ fontSize: 12, lineHeight: 1.7, color: "var(--muted)" }}>
                  {detail.noDataReason ?? NO_DATA_HINT}
                </div>
              );
            }
            return (
              <>
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
                          itemStyle: { color: v >= data.threshold ? "#E0626C" : v >= data.threshold - bandWidth ? "#E8B54A" : "#43B7D7" },
                        })),
                      },
                    ],
                  }}
                />
                {/* 时点点击（图表 + 可键盘到达的日条·仅真数据卡染色，decisionHeat 门） */}
                <div className={styles.dayRow}>
                  {detail.series.map((v, day) => (
                    <button
                      key={day}
                      className={styles.dayCell}
                      title={`D+${day} · ${v.toFixed(0)}`}
                      data-testid={`risk-day-${day}`}
                      style={{ background: decisionHeat(v, data.threshold, "LIVE") }}
                      onClick={() => setOrdersDay({ card: detail, day })}
                    />
                  ))}
                </div>
              </>
            );
          })()}
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
          {/* 轨N 增量3·风险点详情：该基地瓶颈因素逐项（接现成 bottleneck_matrix·LIVE/MOCK 诚实标，不新建风险引擎）。 */}
          <BottleneckDetailPanel base={detail.base} threshold={data.threshold} factorCount={factorCount} bandWidth={bandWidth} />
          {/* cockpit P3 对症方案 → 工单（mitigation_select 优选 → 采纳经 adopt_mitigation Action 审批，R4 不直改）。
              无真峰值（合成/无真源卡）→ tightness 传 0，后端按方案性价比排序（不据假紧迫度推荐）。 */}
          <MitigationPanel base={detail.base} factor={detail.factor} tightness={detail.peak ?? 0} />
        </Modal>
      )}

      {ordersDay && <AffectedOrdersModal card={ordersDay.card} day={ordersDay.day} onClose={() => setOrdersDay(null)} unit={unit} columns={affectedOrderColumns} />}

      {/* PRD-IND-risk §2.4：处置行动计划表（按越线日前置 7 天排启动 · 峰值≥90 配备份方案 · 14 天内反提 S&OP）。
          治本：顶层非 LIVE（合成/无真源）⇒ 决策级处置工单不渲染（哈希/合成越线不产处置结论）。 */}
      {topLive && (data.planRows?.length ?? 0) > 0 && (
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
/**
 * 轨N 增量3·风险点详情弹窗：该基地瓶颈因素逐项细节（工序/资源 7 维张力 + 主瓶颈 + 越线状态）。
 * 接现成 bottleneck_matrix 求解器（基地×7因素已算）·请求 LIVE（守 genuine-sim 红线，有真数据走真算）·
 * 诚实标 dataMode（LIVE 实测 / MOCK 无真数据源估算），不新建风险引擎、不前端写死（R13/R14）。
 */
function BottleneckDetailPanel({ base, threshold, factorCount, bandWidth }: { base: string; threshold: number; factorCount: number; bandWidth: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["a", "bottleneck_matrix", "detail", base],
    queryFn: async () => {
      const res = await invokeSolver("bottleneck_matrix", { dataMode: "LIVE" });
      return BottleneckMatrixOutputSchema.parse(res.data);
    },
  });
  const row = data?.rows.find((r) => r.base === base);
  return (
    <div style={{ marginTop: 14 }} data-testid="bottleneck-detail-panel">
      <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        该基地瓶颈因素逐项（{data?.factors.length ?? factorCount} 维 · bottleneck_matrix）
        {data && (
          <span className="badge" data-testid="bottleneck-detail-datamode"
            style={{ background: data.dataMode === "LIVE" ? "rgba(98,190,119,.18)" : "rgba(210,176,76,.18)", color: data.dataMode === "LIVE" ? "var(--ok)" : "#D2B04C", fontSize: 10 }}>
            {data.dataMode === "LIVE" ? "实测 LIVE" : "估算 MOCK（无实测数据源）"}
          </span>
        )}
      </div>
      {isLoading ? (
        <div style={{ color: "var(--muted2)" }}>{zh.common.loading}</div>
      ) : !row ? (
        <div className="empty-state">{zh.common.none}</div>
      ) : (
        <table className="cmp" data-testid="bottleneck-detail-table">
          <thead><tr><th>瓶颈因素</th><th>张力</th><th>状态</th></tr></thead>
          <tbody>
            {data!.factors.map((f) => {
              // WO-KILL-MOCK-RED 治本：无真源格子 = null（不伪造）——该格走灰、状态"无实测"，不染红/不判越线。
              // 向后兼容：仅显式非 LIVE（或 null 格）才灰化；未标 dataMode 的旧 fixture/真 LIVE 保持既有行为。
              const raw = row.tightness[f];
              const dmNotLive = data!.dataMode != null && data!.dataMode !== "LIVE";
              const cellLive = !dmNotLive && raw != null;
              const v = raw ?? 0;
              const isPrimary = cellLive && row.primary === f;
              return (
                <tr key={f} data-testid={`bottleneck-factor-${f}`}>
                  <td className="zh">
                    {f}
                    {isPrimary && <span className="badge" style={{ marginLeft: 6, background: "var(--danger)", color: "#fff", fontSize: 10 }}>主瓶颈</span>}
                  </td>
                  <td className="mono">
                    <span style={{ display: "inline-block", width: 120, height: 8, borderRadius: 4, background: "var(--bg2)", position: "relative", verticalAlign: "middle", marginRight: 6 }}>
                      <span style={{ position: "absolute", left: 0, top: 0, height: 8, borderRadius: 4, width: `${Math.min(100, v)}%`, background: decisionHeat(raw, threshold, cellLive ? "LIVE" : "MOCK") }} />
                    </span>
                    {raw != null ? Math.round(v) : "—"}
                  </td>
                  <td className="zh" style={{ color: decisionColor(raw, threshold, cellLive ? "LIVE" : "MOCK", { calm: "var(--muted)" }) }}>
                    {!cellLive ? "无实测" : v >= threshold ? "越线" : v >= threshold - bandWidth ? "关注" : "正常"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div style={{ marginTop: 6, fontSize: 10.5, color: "var(--muted2)" }}>
        来源：bottleneck_matrix 求解器（基地×7因素 · LIVE=实测 设备OEE/产线利用率/良率，MOCK=无真数据源诚实标）· R13 可溯
      </div>
    </div>
  );
}

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

/** C3 决策摘要头单格：标签 + 大数 + 单位后缀（tone 决定红/黄/中性色·纯展示·值由父层真聚合传入）。 */
function SummaryStat({ testId, label, value, suffix, tone }: { testId: string; label: string; value: string; suffix?: string; tone?: "danger" | "warn" }) {
  const color = tone === "danger" ? "var(--danger)" : tone === "warn" ? "var(--warn, #caa23a)" : "var(--txt)";
  return (
    <div className={styles.summaryStat} data-testid={testId}>
      <div className={styles.summaryLabel}>{label}</div>
      <div className={styles.summaryValue} style={{ color }}>
        <span className="mono" data-testid={`${testId}-value`}>{value}</span>
        {suffix ? <span className={styles.summarySuffix}>{suffix}</span> : null}
      </div>
    </div>
  );
}

function MiniStrip({ series, threshold, dataMode }: { series: number[]; threshold: number; dataMode?: string | null }) {
  return (
    <div className={styles.miniStrip}>
      {series.map((v, i) => (
        <span key={i} style={{ background: decisionHeat(v, threshold, dataMode) }} />
      ))}
    </div>
  );
}

/**
 * A★（旗舰·空洞数据冰山修）时点点击 → 受影响订单弹窗。
 * 根因修：原版 `searchObjects("Order",{base,day})` 用 mock 标签「洛阳」+ 非订单维度 day 查询 → 恒命中 0 →
 * 裸「暂无数据」死路（用户旗舰投诉「红色点开却暂无数据」）。改为渲染 **风险卡已带的真受影响订单**
 * `card.affectedOrders`——由产能传导引擎按越线日 D+crossDay 真算（订单 props.bases 含该基地·交期落窗口），
 * 非哈希标签查询。MOCK 卡诚实声明「张力曲线为 mock 基线启发（非实测）」；空列表给诚实解释，**绝不裸空**。
 */
function AffectedOrdersModal({ card, day: _day, onClose, unit, columns }: { card: RiskCard; day: number; onClose: () => void; unit: string; columns: ViewColumnDef[] }) {
  const orders = (card.affectedOrders ?? []) as Record<string, unknown>[];
  const isMock = card.dataMode === "MOCK";
  // FILL-XINDUSTRY-LAYOUT（G-5 8a·R14）：列头 label 由 layout.affectedOrderColumns 驱动·迭代 columns；
  // value 按 col.key 从订单对象取值/格式化（绑后端真值·不改语义）。换行业换 config 即换列（型号→区域…）。
  const monoKeys = new Set(["qty", "due", "delay", "revenueWan"]);
  const cellText = (o: Record<string, unknown>, key: string): string => {
    if (key === "delay") return o.delay != null ? `+${o.delay}天` : "—";
    if (key === "revenueWan") return o.revenueWan != null ? `${o.revenueWan} 万` : "—";
    return String(o[key] ?? "—");
  };
  const baselineN = card.currentTightness?.value != null ? Math.round(card.currentTightness.value) : null;
  // WO-FORECAST-SIM：需求驱动因素的真缺口溯源（gapWan=预测需求−产能·真源 DemandSegment/SopVersion），LIVE 诚实位。
  // demandGap 已是 RiskCardSchema 一等字段（contracts solvers.ts），直接读·无需内联类型断言。
  const demandGap = card.demandGap;
  return (
    <Modal title={`${zh.risk.affectedOrders} · ${card.base} · ${card.factor}`} onClose={onClose} width={680}>
      {/* LIVE 诚实位：需求驱动因素的张力由真需求-产能缺口派生（非哈希）；缺口=预测需求−产能可溯 */}
      {!isMock && demandGap && (
        <div
          data-testid="affected-orders-demand-gap"
          style={{ background: "rgba(98,190,119,.12)", border: "1px solid var(--ok,#62be77)", borderRadius: 6, padding: "8px 10px", fontSize: 11.5, color: "var(--muted)", marginBottom: 10 }}
        >
          ✓ 该因素（{card.factor}）紧张度由<b>真需求-产能缺口</b>派生（基线 {baselineN ?? "—"}·<b>非哈希</b>·确定性可溯）。
          缺口 = <b>预测需求 − 产能</b> ≈ <b className="mono">{demandGap.gapWan} {unit}</b>（来源：{demandGap.source}）。
          下表受影响订单由产能传导引擎按越线日 {card.crossDay != null ? `D+${card.crossDay}` : "推演终点"} 真算。
        </div>
      )}
      {/* 诚实位：MOCK 卡张力曲线为启发估算（非实测）；受影响订单由产能传导引擎按越线日真算 */}
      {isMock && (
        <div
          data-testid="affected-orders-mock-note"
          style={{ background: "rgba(202,162,58,.12)", border: "1px solid var(--warn,#caa23a)", borderRadius: 6, padding: "8px 10px", fontSize: 11.5, color: "var(--muted)", marginBottom: 10 }}
        >
          ⚠ 该因素（{card.factor}）<b>无真数据源</b>，张力曲线为 mock 基线启发估算（基线 {baselineN ?? "—"}·确定性派生·<b>非实测</b>）。
          下表受影响订单由<b>产能传导引擎</b>按越线日 {card.crossDay != null ? `D+${card.crossDay}` : "推演终点"} 真算（订单经该基地生产、交期落传导窗口），<b>非由该 mock 红色直接产生</b>。
        </div>
      )}
      <table className="cmp" data-testid="affected-orders-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} data-col={col.key}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map((o, i) => (
            <tr key={String(o.so ?? i)}>
              {columns.map((col) => (
                <td key={col.key} className={col.key === "cust" ? "zh" : monoKeys.has(col.key) ? "mono" : undefined}>
                  {cellText(o, col.key)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {/* 禁裸「暂无数据」死路：空列表给诚实解释（该越线日传导窗口内无在产订单），非裸 none */}
      {orders.length === 0 && (
        <div className="empty-state" data-testid="affected-orders-empty" style={{ fontSize: 12, lineHeight: 1.6 }}>
          该基地在越线日 {card.crossDay != null ? `D+${card.crossDay}` : "（无越线）"} 的产能传导窗口内<b>无在产订单</b>关联
          （订单需经 <b>{card.base}</b> 生产且交期落窗口）。
          {isMock ? "此红色为 mock 基线启发值，本就不由真实订单产生。" : ""}
        </div>
      )}
    </Modal>
  );
}
