import { useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { RiskTimelineOutput, ViewColumnDef } from "@platform/contracts";
import { RiskTimelineOutputSchema, BottleneckMatrixOutputSchema, SEG_REGISTRY } from "@platform/contracts";
import type { HistoryRiskCase } from "@platform/contracts";
import { fetchHistoryBundle, invokeSolver, queryTimeseriesAgg, submitQuery } from "@/api/endpoints";
import { useSessionStore } from "@/store/sessionStore";
import { useWorkspace, firstPackageId } from "@/workspace/useWorkspace";
import { Modal } from "@/components/ui/Modal";
import { EChart } from "@/components/ui/EChart";
import { RiskHoverTrigger } from "@/components/Risk/RiskPopover";
import { NO_DATA_HINT } from "@/components/DecisionValue";
import { TaskRun } from "@/components/QueryDock/TaskRun";
import { useActionDraft } from "./sim/shared";
import { useOpenWhatIf, resolveBaseId } from "./sim/whatif";
import { useFeature } from "@/workspace/featureGate";
import type { ViewRendererProps } from "./registry";
import { InferenceProcessPanel } from "@/components/InferenceProcessPanel";
import { DrillBack } from "@/components/DrillBack";
import { BoardReadinessTrustBar } from "./sim/BoardReadinessTrustBar";
import zh from "@/locales/zh";
import styles from "./RiskBoardView.module.css";

type RiskCard = RiskTimelineOutput["cards"][number];
type BottleneckOutput = ReturnType<typeof BottleneckMatrixOutputSchema.parse>;

/**
 * Gap#5 · 张力三档配色（1:1 复刻黑曜石 `riskColor`：正常绿 / 关注金 / 瓶颈玫红）——**仅本看板模块作用域**，
 * 不改全局 tokens.css、不改共享 decisionColor/decisionHeat（其它视图色板不受影响）。
 * 守 KILL-MOCK-RED：非 LIVE（合成/无实测源）或无值 → 中性灰，**绝不冒充决策色**。返回 hex 以支持 `${col}55/66` 透明度拼接。
 */
const RK_NORMAL = "#62BE77";
const RK_WATCH = "#D2B04C";
const RK_JAM = "#DD7E9E";
const RK_MUTED = "#8A94A6";
function riskTierColor(value: number | null | undefined, threshold: number, live: boolean, band = 15): string {
  if (value == null || !live) return RK_MUTED;
  if (value >= threshold) return RK_JAM;
  if (value >= threshold - band) return RK_WATCH;
  return RK_NORMAL;
}

/**
 * RISKBOARD-LAYOUT-REWORK（诊断台 → 高管决策漏斗）：卡业务影响真值口径（C2/C3/C4 单一来源）。
 * 营收敞口 = Σ 受影响订单 revenueWan（后端 affectedOrders 由产能传导引擎按越线日真算·qty×细分单价·R13 可溯）；
 * 受威胁客户 = 受影响订单去重客户数。**全部读 card.affectedOrders 真值·前端不写死**（改后端真源→值随之变）。
 */
function orderRows(card: RiskCard): Record<string, unknown>[] {
  return (card.affectedOrders ?? []) as Record<string, unknown>[];
}
const numOf = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
/** 万套 → 套（1 万套 = 10000 套）·真实量纲定义（非后端 lot→cell 内部种子系数）。 */
const UNITS_PER_WAN = 10000;

/**
 * C1（越线0/crossDay=null 不挂整单营收·敞口按真缺口比例折算）：受影响敞口占已受影响订单营收的比例。
 * - **已越线**（crossDay!=null·瓶颈真被击穿）：受影响订单确将延误 → 全单在险，比例 = 1（口径不变·守既有测试）。
 * - **未越线**（crossDay==null·产能尚未击穿）：仅存结构性缺口 demandGap.gapWan（万套）→ 敞口按缺口体量占
 *   已受影响订单量的比例折算：frac = clamp(gapWan×10000 / Σqty, 0, 1)。等价于「缺口(套) × 每套真营收」，
 *   即缺口体量的真实营收价值（近零缺口 → 近零敞口·而非整单）。
 * - 未越线且无 demandGap（非需求驱动因子）→ 缺口未量化 → 比例 0（诚实·不伪造整单在险·KILL-MOCK-RED）。
 */
export function exposureFraction(card: RiskCard): number {
  if (card.crossDay != null) return 1;
  const gapWan = typeof card.demandGap?.gapWan === "number" ? card.demandGap.gapWan : 0;
  const totalQty = orderRows(card).reduce((s, o) => s + numOf(o.qty), 0);
  if (totalQty <= 0 || gapWan <= 0) return 0;
  return Math.min(1, Math.max(0, (gapWan * UNITS_PER_WAN) / totalQty));
}
export function cardExposureWan(card: RiskCard): number {
  const totalRev = orderRows(card).reduce((s, o) => s + numOf(o.revenueWan), 0);
  return totalRev * exposureFraction(card);
}
/** C3（决策者可读）：营收敞口金额（万）→ ≥1亿 显「X.X亿」，否则「N 万」（避免裸「4320000万」不可读）。 */
export function fmtExposureWan(wan: number): string {
  if (wan >= 10000) return `${(wan / 10000).toFixed(1)}亿`;
  return `${Math.round(wan)} 万`;
}
export function cardThreatenedCusts(card: RiskCard): number {
  return new Set(orderRows(card).map((o) => String(o.cust ?? "")).filter((x) => x !== "")).size;
}

export type DecisionMode = "LIVE" | "MUTED";
/**
 * C2（同源风险诚实标一致·单一判据）：卡级 dataMode 判据**唯一函数**——RiskBoardView 卡与沙盘 RiskTop3 共用，
 * 杜绝同一常州风险一处「实测」一处「估算·无实测」。规则（KILL-MOCK-RED）：
 *   无真源(hasData=false) / 合成决策世界(confidence.synthetic) / 显式非 LIVE ⇒ MUTED；
 *   自报 LIVE ⇒ LIVE；未标 dataMode ⇒ 随顶层（旧 fixture 向后兼容）。
 */
export function cardDecisionMode(
  card: { dataMode?: string | null; hasData?: boolean },
  topDataMode?: string | null,
  confidence?: { synthetic?: boolean } | null,
): DecisionMode {
  const topLive = !(topDataMode != null && topDataMode !== "LIVE");
  if (card.hasData === false) return "MUTED";
  if (confidence?.synthetic === true) return "MUTED";
  if (card.dataMode === "LIVE") return "LIVE";
  if (card.dataMode == null) return topLive ? "LIVE" : "MUTED";
  return "MUTED";
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
    // C1：每卡按其真缺口比例折算（未越线卡缺口近零→敞口近零），同订单跨基地取最大在险防双记。
    const frac = exposureFraction(c);
    for (const o of orderRows(c)) {
      const rev = numOf(o.revenueWan) * frac;
      const key = o.so != null && String(o.so) !== "" ? `so:${o.so}` : `anon:${anonSo++}`;
      const prev = exposureBySo.get(key) ?? 0;
      if (rev > prev) exposureBySo.set(key, rev);
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
  const [riskTab, setRiskTab] = useState<"risk" | "order">("risk"); // HTML §12#2：瓶颈视角 / 订单聚合 两态互斥。
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
  // C2：卡级 dataMode 判据走**共享** cardDecisionMode（与沙盘 RiskTop3 同源·同一常州风险标注一致）。
  const cardMode = (c: RiskCard): DecisionMode => cardDecisionMode(c, data.dataMode, data.confidence);

  // WO-CAPSIM-IA-UNIFY（M2·③看板 scope=该基地）：`?focus=<baseId|名>` 下钻 → 裁剪到该基地。
  const focusId = resolveBaseId(searchParams.get("focus") ?? undefined);
  const baseScoped = focusId ? data.cards.filter((c) => resolveBaseId(c.base) === focusId) : data.cards;
  const scopedCards = focusId && baseScoped.length > 0 ? baseScoped : data.cards;
  const scopedToBase = focusId != null && baseScoped.length > 0;

  const liveCards = scopedCards.filter((c) => cardMode(c) === "LIVE");
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
  // 卡面因素 chip：取该基地张力最高的前 N 个真因素（1:1 复刻 A 的每卡 2 chip·真值·非硬编）。
  const topFactors = (base: string, n: number): { factor: string; value: number | null }[] => {
    const row = bnRow(base);
    if (!row) return [];
    return (bn?.factors ?? [])
      .map((f) => ({ factor: f, value: row.tightness[f] ?? null }))
      .filter((x) => x.value != null)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      .slice(0, n);
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

      {/* WO-SANDBOX-READINESS-UX：紧凑单行就绪信任条（嵌 header 区·非通栏·rk-grid 主体不动）。
          消费既有 GLOBAL SimCertification（守 RL3 只渲染）；entitlement 关/无 token → 组件自返回 null 诚实不渲染。 */}
      <BoardReadinessTrustBar />

      {/* rk-top：标题 + 视角/窗口 chip（HTML §2）。瓶颈视角为主态；30/60/90 天切窗口重算 risk_timeline。 */}
      <div className={styles.rkTop}>
        <div>
          <h3>产能推演</h3>
          <div className={styles.rkSub}>
            计划-执行之桥：监测执行偏离月度计划的风险 · 未来 {horizon} 天内预测越线（紧张度 ≥ {data.threshold}）· 偏离 → 处置 Action 或反提月度差异（C21）
            {scopedToBase && <> · 聚焦 <b className="mono">{focusId}</b></>}
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

      {/* rk-kpi 条（HTML §2）：5 指标 + 可选数据健康度横幅。值全源自真 risk_timeline/bottleneck。 */}
      <div className={styles.rkKpi} data-testid="risk-kpi">
        {/* Gap#4c 全元素悬浮溯源：每个 KPI 数字挂溯源浮层（口径 + 真源求解器），信任=出处可当场亮出。 */}
        <RkK testId="risk-kpi-bases" value={String(summaryRed + summaryYellow)} label="风险基地" color="var(--danger)"
          prov={{ title: "风险基地", rows: [["口径", "LIVE 卡中 峰值≥阈值(瓶颈) 或 ≥阈值−带宽(关注) 的基地数"], ["真源", "risk_timeline 求解器 · cards[].peak"], ["当前", `瓶颈 ${summaryRed} · 关注 ${summaryYellow}`]] }} />
        <RkK testId="risk-kpi-factorpts" value={String(riskFactorPoints)} label="风险因素点" color="var(--c-solver)"
          prov={{ title: "风险因素点", rows: [["口径", "各 LIVE 基地 越线/临近 因素数之和（每基地至少计 1）"], ["真源", "bottleneck_matrix 求解器 · rows[].tightness"]] }} />
        <RkK testId="risk-kpi-orders" value={allOrderCount > 0 ? String(allOrderCount) : "—"} label="受影响订单(批)" color="var(--c-forecast)"
          prov={{ title: "受影响订单", rows: [["口径", "Σ LIVE 卡 affectedOrders 去重 SO"], ["真源", "affected_orders 传导引擎（按越线日真算·非哈希）"]] }} />
        <RkK testId="risk-kpi-custs" value={totalCusts > 0 ? String(totalCusts) : "—"} label="涉及客户" color="var(--c-capacity)"
          prov={{ title: "涉及客户", rows: [["口径", "受影响订单去重客户数（cust 去重）"], ["真源", "affected_orders · aggregateThreat"]] }} />
        <RkK testId="risk-kpi-earliest" value={earliestCross != null ? `T+${earliestCross}` : "—"} label="最早越线日" color="var(--c-solver)"
          prov={{ title: "最早越线日", rows: [["口径", "min crossDay（各 LIVE 卡首个 ≥阈值 日）"], ["真源", "risk_timeline · cards[].crossDay"]] }} />
        {healthNote && <div className={styles.rkHealth} data-testid="risk-kpi-health">{healthNote}</div>}
      </div>

      {/* HTML §12#2：订单聚合 tab → 经营聚合表 + 订单明细（真 affected_orders·无源列诚实空态）。 */}
      {riskTab === "order" && <OrderAggView horizon={horizon} unit={unit} />}

      {riskTab === "risk" && (
      <>
      {/* rk-grid：每基地一卡（HTML §3·整卡点击展开·无独立 CTA 按钮）。因素 chip 来自 bottleneck 真值。 */}
      <div className={styles.rkGrid}>
        {orderedCards.map((card) => {
          const mode = cardMode(card);
          const live = mode === "LIVE";
          const selected = selectedObjects.some((o) => o.label === card.base) || openBase === card.base;
          const noData = card.hasData === false;
          const peakColor = riskTierColor(card.peak, data.threshold, live, bandWidth);
          const chips = topFactors(card.base, 2);
          const exposure = cardExposureWan(card);
          const custs = cardThreatenedCusts(card);
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
                  {chips.length > 0 && (
                    <div className={styles.rkChips} data-testid={`risk-chips-${card.base}`}>
                      {chips.map((ch) => {
                        const col = riskTierColor(ch.value, data.threshold, bnLive, bandWidth);
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
                      受威胁客户{" "}
                      <ProvenanceHover title="受威胁客户" testId={`risk-custs-prov-${card.base}`}
                        rows={[["口径", "本卡 affectedOrders 去重客户数"], ["真源", "affected_orders（产能传导引擎按越线日真算·非哈希）"]]}>
                        <b data-testid={`risk-custs-${card.base}`} style={{ color: live ? "var(--danger)" : "var(--muted)" }}>{custs}</b>
                      </ProvenanceHover>
                      {" · 敞口 "}
                      <ProvenanceHover title="营收敞口" testId={`risk-exposure-prov-${card.base}`}
                        rows={[["口径", "Σ affectedOrders.revenueWan × 在险比例"], ["在险比例", card.crossDay != null ? "已越线 → 1（全单在险）" : "未越线 → 按缺口体量占比折算"], ["真源", "affected_orders · demandGap"]]}>
                        <b className="mono" data-testid={`risk-exposure-${card.base}`} style={{ color: live ? "var(--danger)" : "var(--muted)" }}>{exposure > 0 ? fmtExposureWan(exposure) : "—"}</b>
                      </ProvenanceHover>
                    </span>
                    <span>{orderRows(card).length} 批订单</span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Gap#4b 缺失分类面板：无真实数据源（hasData=false / MUTED）的基地·因素 → 诚实列出 + 去补齐深链，
          不静默跳过、不假红（KILL-MOCK-RED·铁律0.6：去假后补齐真实数据让功能真能用）。 */}
      {(() => {
        const missing = scopedCards.filter((c) => c.hasData === false || cardMode(c) === "MUTED");
        return missing.length > 0 ? <MissingPanel cards={missing} /> : null;
      })()}

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
          live={cardMode(openCard) === "LIVE"}
          isPrimary={cardMode(openCard) === "LIVE" && maxPeak > 0 && openCard.peak === maxPeak}
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
            <span>
              {zh.risk.planSub(data.planRows!.length)}
              {"　"}
              {/* HTML §8：导出最终规划——前端生成独立浅色系静态 HTML 文档下载（非截图·字段同表·去交互态）。 */}
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
      </>
      )}

      {/* 历史处置案例 + 风险推演编排过程 DAG（保留·看板下半区·两态共享）。
          Gap#4d：solved 绑真数据态（topLive·顶层 LIVE 才算"已出结论"）——非 LIVE→节点回退"未跑"（诚实·非恒真占位）。
          DAG 拓扑/IPO 为编排定义（R14 config·非业务假值），节点状态派生于真实推演态。 */}
      <HistoricalCasesSection />
      <InferenceProcessPanel testId="inference-risk" solved={topLive} />

    </div>
  );
}

/** HTML §8 导出最终规划：前端生成独立浅色系静态 HTML 表格文档并触发下载（非截图·去交互态·字段同页表·可进 S&OP 附件）。 */
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
  rows?: { so: string; cust: string; seg: string; model: string; qty: number; due: string; delay: number; risks?: { base?: string; factor?: string; cross?: number | string }[] }[];
  marginLedger?: { bySegment?: { seg: string; revenue: number; marginPct: number; orderCount: number }[] };
};

/**
 * 订单聚合视图（HTML §6·riskTab==='order'）：受影响订单经营聚合表 + 订单明细。
 * 接真 affected_orders 求解器（summary/rows/marginLedger.bySegment 真价利·SEG_REGISTRY 勾稽）。
 * 经营表库存/产能列平台暂无真源 → 诚实"—"（G-DM-1·不伪造），未结订单金额/毛利额/毛利率走真 marginLedger。
 */
function OrderAggView({ horizon, unit }: { horizon: number; unit: string }) {
  const [seg, setSeg] = useState<"app" | "base">("app");
  const [baseFilter, setBaseFilter] = useState<string>("__all__");
  const { data, isLoading } = useQuery({
    queryKey: ["a", "affected_orders", "agg", horizon, baseFilter],
    queryFn: async () => {
      const res = await invokeSolver("affected_orders", { horizon, ...(baseFilter !== "__all__" ? { base: baseFilter } : {}) });
      return res.data as OrderAgg;
    },
  });
  if (isLoading) return <div className="empty-state">{zh.common.loading}</div>;
  const rows = data?.rows ?? [];
  const bySeg = data?.marginLedger?.bySegment ?? [];
  const bases = [...new Set(rows.flatMap((r) => (r.risks ?? []).map((k) => String(k.base ?? "")).filter(Boolean)))];
  // 单价/毛利率单一真相源 = SEG_REGISTRY（按细分名或 key 均可查·R6 字节复现）。
  const segPrice: Record<string, number> = Object.fromEntries(SEG_REGISTRY.flatMap((s) => [[s.seg, s.priceWan], [s.key, s.priceWan]]));
  const segMargin: Record<string, number> = Object.fromEntries(SEG_REGISTRY.flatMap((s) => [[s.seg, s.marginPct], [s.key, s.marginPct]]));
  // 经营聚合行：app→marginLedger.bySegment（真营收/毛利）；base→按 risks.base 聚该基地订单营收=Σ qty×细分单价、
  // 毛利率=营收加权（真值·非写死 0；SEG_REGISTRY 勾稽）。库存/产能列平台无该维度真源→诚实"—"。
  const econRows: { name: string; revenue: number; marginPct: number | null; orderCount: number }[] =
    seg === "app"
      ? bySeg.map((s) => ({ name: s.seg, revenue: s.revenue, marginPct: s.marginPct, orderCount: s.orderCount }))
      : bases.map((b) => {
          const rs = rows.filter((r) => (r.risks ?? []).some((k) => String(k.base ?? "") === b));
          const revenue = rs.reduce((s, r) => s + r.qty * (segPrice[r.seg] ?? 0), 0);
          const gp = rs.reduce((s, r) => s + r.qty * (segPrice[r.seg] ?? 0) * ((segMargin[r.seg] ?? 0) / 100), 0);
          return { name: b, revenue, marginPct: revenue > 0 ? (gp / revenue) * 100 : null, orderCount: rs.length };
        });
  const totalRev = econRows.reduce((s, r) => s + r.revenue, 0);

  return (
    <div data-testid="risk-order-agg">
      {/* §6a 经营数据聚合表 + 分类维度切换。 */}
      <div className={styles.rkDet} style={{ marginTop: 4 }}>
        <div className={styles.rkDetH}>
          <b>受影响订单 · 经营数据看板</b>
          <span>这些订单牵动的产能与财务（{seg === "app" ? "按应用细分" : "按基地"}）· 金额单位 万元</span>
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
                <th>{seg === "app" ? "应用分类" : "基地"}</th><th>受影响产能({unit})</th><th>成品库存</th><th>半成品库存</th><th>原材料库存</th>
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
                  <td className="mono" style={{ color: "var(--c-forecast)", fontWeight: 700 }}>{r.revenue > 0 ? `${Math.round(r.revenue)} 万` : "—"}</td>
                  <td className="mono" style={{ color: "var(--ok)", fontWeight: 700 }}>{r.marginPct != null && r.revenue > 0 ? `${Math.round((r.revenue * r.marginPct) / 100)} 万` : "—"}</td>
                  <td className="mono">{r.marginPct != null ? `${r.marginPct.toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
              <tr style={{ borderTop: "1px solid var(--border-strong)" }}>
                <td className="zh"><b>合计</b></td><td className="mono" style={{ color: "var(--muted2)" }}>—</td><td className="mono" style={{ color: "var(--muted2)" }}>—</td><td className="mono" style={{ color: "var(--muted2)" }}>—</td><td className="mono" style={{ color: "var(--muted2)" }}>—</td>
                <td className="mono" style={{ color: "var(--c-forecast)", fontWeight: 700 }}>{totalRev > 0 ? `${Math.round(totalRev)} 万` : "—"}</td><td className="mono">—</td><td className="mono">—</td>
              </tr>
            </tbody>
          </table>
        )}
        <div style={{ fontSize: 10.5, color: "var(--muted2)", lineHeight: 1.5, marginTop: 8 }}>
          未结订单金额/毛利额/毛利率来自 affected_orders 真 marginLedger（SEG_REGISTRY 单价勾稽·R13 可溯）；产能/库存列平台暂无该维度真数据源 → 诚实"—"（不伪造·G-DM-1）。
        </div>
      </div>

      {/* §6b 基地筛选 + 订单明细表。 */}
      <div style={{ fontSize: 12, color: "var(--muted)", margin: "12px 0 14px", display: "flex", alignItems: "center", gap: 9 }}>
        基地筛选：
        <select data-testid="risk-order-basesel" value={baseFilter} onChange={(e) => setBaseFilter(e.target.value)}
          style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--txt)", padding: "6px 12px", fontSize: 12, cursor: "pointer", minWidth: 170 }}>
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
                  <td><span className={styles.rkFchip} style={{ borderColor: "var(--c-capacity)66", color: "var(--c-capacity)" }}>{r.seg}</span></td>
                  <td className="zh">{r.model}</td>
                  <td className="mono">{r.qty} {unit}</td>
                  <td className="mono"><b>{r.due}</b></td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, maxWidth: 420 }}>
                      {(r.risks ?? []).slice(0, 4).map((k, j) => (
                        <span key={j} className={styles.rkFchip} style={{ borderColor: "var(--danger)66", color: "var(--danger)" }}>{k.base}·{k.factor}{k.cross != null ? ` T+${k.cross}` : ""}</span>
                      ))}
                      {(r.risks ?? []).length > 4 && <span className={styles.rkFchip} style={{ borderColor: "var(--border)", color: "var(--muted2)" }}>+{(r.risks ?? []).length - 4}</span>}
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

/** rk-kpi 单卡（HTML .rk-k）：数值在上（19px 等宽·着色）、标签在下（9.5px）。可挂溯源浮层（prov）。 */
function RkK({ testId, value, label, color, prov }: { testId: string; value: string; label: string; color: string; prov?: { title: string; rows: [string, string][] } }) {
  const inner = <b style={{ color }} data-testid={`${testId}-value`}>{value}</b>;
  return (
    <div className={styles.rkK} data-testid={testId}>
      {prov ? <ProvenanceHover title={prov.title} rows={prov.rows} testId={`${testId}-prov`}>{inner}</ProvenanceHover> : inner}
      <span>{label}</span>
    </div>
  );
}

/**
 * Gap#4c 通用溯源浮层（全元素悬浮溯源·信任=出处可当场亮出）：包住任意数字/条目，悬停弹口径+真源。
 * 复用 RiskHoverTrigger 的门面语义（本模块通用版·非风险因素专用弹窗），tip 走 portal + pointer-events:none。
 */
function ProvenanceHover({ title, rows, children, testId }: { title: string; rows: [string, string][]; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState({ left: 0, bottom: 0 });
  const w = typeof window !== "undefined" ? window.innerWidth : 1200;
  return (
    <span
      ref={ref}
      data-testid={testId}
      style={{ borderBottom: "1px dashed var(--border-strong)", cursor: "help" }}
      onMouseEnter={() => {
        const r = ref.current?.getBoundingClientRect();
        if (r) setAnchor({ left: r.left, bottom: r.bottom });
        setOpen(true);
      }}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open &&
        createPortal(
          <div className={styles.rkTip} style={{ left: Math.max(10, Math.min(w - 300, anchor.left)), top: anchor.bottom + 6, width: 280 }} role="tooltip" data-testid={testId ? `${testId}-pop` : undefined}>
            <div className={styles.rkTipH}><b>溯源 · {title}</b></div>
            {rows.map(([k, v], i) => (
              <div key={i} style={{ fontSize: 10.5, color: "var(--muted)", lineHeight: 1.55 }}>
                <b style={{ color: "var(--muted2)" }}>{k}：</b>{v}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </span>
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
  // 逐因素行：主因素（真逐日 series·riskTierColor 三档着色·MOCK/无源→灰）+ 其余越线/临近因素（当前值·无逐日源→灰点·不伪造）。
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
          {/* 主因素：真逐日 series（点击某日→受影响订单；Gap#2 悬停任意点→富逐日 tip）。 */}
          <FactorRow
            label={card.factor}
            sub={`${card.currentTightness?.value != null ? Math.round(card.currentTightness.value) : "—"}→${card.peak != null ? Math.round(card.peak) : "—"} · ${card.crossDay != null ? `T+${card.crossDay} 越线` : "窗口内不越线"}`}
            color={riskTierColor(card.peak, threshold, live, bandWidth)}
            dots={card.series.map((v) => ({ color: riskTierColor(v, threshold, live, bandWidth), value: v }))}
            onDay={onDay}
            tipFor={(i) => buildDayTip(card, card.factor, i, threshold, live, bandWidth, unit)}
          />
          {/* 其余越线/临近因素：仅当前值（无逐日源）→ 灰点 + 当前值标注（不伪造逐日·G-DM-1）。 */}
          {others.map((o) => (
            <FactorRow
              key={o.factor}
              label={o.factor}
              sub={`当前 ${o.value != null ? Math.round(o.value) : "—"} · 无逐日实测源`}
              color={riskTierColor(o.value, threshold, bnLive, bandWidth)}
              dots={card.series.map(() => ({ color: "rgba(138,148,166,.28)", value: null }))}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state" data-testid="risk-detail-nodata" style={{ fontSize: 12, lineHeight: 1.7, color: "var(--muted)", marginBottom: 10 }}>
          {card.noDataReason ?? NO_DATA_HINT}
        </div>
      )}

      <div className={styles.rkLeg} data-testid="risk-legend">
        <span><i style={{ background: RK_NORMAL }} />&lt;{threshold - bandWidth} 正常</span>
        <span><i style={{ background: RK_WATCH }} />{threshold - bandWidth}-{threshold - 1} 关注</span>
        <span><i style={{ background: RK_JAM }} />≥{threshold} 瓶颈</span>
        <span style={{ marginLeft: 14, color: "var(--muted2)" }}>
          首要风险对象：{card.factor}{card.crossDay != null ? `（T+${card.crossDay} 越线）` : ""}
        </span>
      </div>

      {/* 两栏（HTML .rk-two）：左对症方案 topN 对比矩阵（mitigation_select 真求解器）· 右对话态 QA（真调 agt_risk Agent·铁律0.4）。 */}
      <div className={styles.rkTwo}>
        <MitigationCards base={card.base} factor={card.factor} tightness={card.peak ?? 0} canWhatIf={canWhatIf} openWhatIf={openWhatIf} cardFactor={card.factor} cardBase={card.base} />
        <QaPanel card={card} />
      </div>
    </div>
  );
}

type DayTipData = {
  day: number;
  value: number | null;
  color: string;
  factor: string;
  events: { tag?: string; desc?: string; src?: string }[];
  orders: { so: string; cust: string; qty: string; due: string; impact: string; over: boolean }[];
  totalOrders: number;
  moreCount: number;
};

/**
 * Gap#2 富逐日 tip 数据（1:1 复刻黑曜石 showDayTip）：当日紧张度 + 该日事件脉冲 + 受影响订单明细。
 * 全取本卡真值——series（逐日 tension）/ events（驱动事件）/ affectedOrders（传导引擎真算）·非哈希、非前端写死。
 */
function buildDayTip(card: RiskCard, factor: string, idx0: number, threshold: number, live: boolean, band: number, unit: string): DayTipData {
  const day = idx0 + 1;
  const value = card.series[idx0] ?? null;
  const over = value != null && value >= threshold;
  const events = (card.events ?? []).filter((e) => (!e.factors?.length || e.factors.includes(factor)) && Math.abs(e.day - day) <= 3);
  const all = (card.affectedOrders ?? []) as Record<string, unknown>[];
  const orders = all.slice(0, 4).map((o) => ({
    so: String(o.so ?? "—"),
    cust: String(o.cust ?? "—"),
    qty: o.qty != null ? `${o.qty}${unit}` : "—",
    due: o.due != null ? String(o.due).slice(5) : "—",
    impact: over ? (o.delay != null ? `延误${o.delay}天` : "延误") : "关注",
    over,
  }));
  return { day, value, color: riskTierColor(value, threshold, live, band), factor, events, orders, totalOrders: all.length, moreCount: Math.max(0, all.length - orders.length) };
}

/** Gap#2 逐日圆点：悬停→富 tip（showDayTip）；有 onDay 则点击→受影响订单弹窗。 */
function DayDot({ idx, color, value, onDay, tip }: { idx: number; color: string; value: number | null; onDay?: (day: number) => void; tip: DayTipData | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState({ left: 0, bottom: 0, width: 0 });
  return (
    <button
      ref={ref}
      className={styles.rkDot}
      style={{ background: color }}
      title={tip ? undefined : value != null ? `D+${idx + 1} · ${Math.round(value)}` : `D+${idx + 1} · 无实测`}
      data-testid={onDay ? `risk-dot-${idx}` : undefined}
      onClick={onDay ? () => onDay(idx) : undefined}
      onMouseEnter={() => {
        const r = ref.current?.getBoundingClientRect();
        if (r) setAnchor({ left: r.left, bottom: r.bottom, width: r.width });
        setOpen(true);
      }}
      onMouseLeave={() => setOpen(false)}
    >
      {open && tip && <RiskDayTip tip={tip} anchor={anchor} />}
    </button>
  );
}

/** Gap#2 富逐日 tip 浮层（portal · pointer-events:none · 1:1 复刻 rk-tip 结构：头部值 + 事件脉冲 + 订单小表）。 */
function RiskDayTip({ tip, anchor }: { tip: DayTipData; anchor: { left: number; bottom: number; width: number } }) {
  const tw = 340;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.max(10, Math.min(vw - tw - 10, anchor.left + anchor.width / 2 - tw / 2));
  const top = Math.min(anchor.bottom + 8, vh - 40);
  return createPortal(
    <div className={styles.rkTip} style={{ left, top, width: tw }} role="tooltip" data-testid="risk-day-tip">
      <div className={styles.rkTipH}>
        <b>D+{tip.day}</b>（T+{tip.day}）· {tip.factor} 紧张度 <b style={{ color: tip.color }}>{tip.value != null ? Math.round(tip.value) : "—"}</b>
      </div>
      <div className={styles.rkTipEv} data-testid="risk-day-tip-ev">
        {tip.events.length
          ? tip.events.map((e, i) => (<div key={i}>{[e.tag, e.desc].filter(Boolean).join(" ")}{e.src ? `（来源：${e.src}）` : ""}</div>))
          : "基线负荷自然爬升（无事件脉冲）"}
      </div>
      <table className="cmp" style={{ marginTop: 6 }}>
        <thead><tr><th>订单</th><th>客户</th><th>数量</th><th>交期</th><th>影响</th></tr></thead>
        <tbody>
          {tip.orders.length ? (
            tip.orders.map((o, i) => (
              <tr key={i}>
                <td className="mono"><b>{o.so}</b></td>
                <td className="zh">{o.cust}</td>
                <td className="mono">{o.qty}</td>
                <td className="mono">{o.due}</td>
                <td style={{ color: o.over ? RK_JAM : "var(--c-forecast)" }}>{o.impact}</td>
              </tr>
            ))
          ) : (
            <tr><td colSpan={5} style={{ color: "var(--muted2)" }}>该窗口无直接受影响订单</td></tr>
          )}
          {tip.moreCount > 0 && (<tr><td colSpan={5} style={{ color: "var(--muted2)" }}>… 等 {tip.totalOrders} 批</td></tr>)}
        </tbody>
      </table>
    </div>,
    document.body,
  );
}

/** 单因素时间轴行（HTML .rk-frow）：168px 标签 + 逐日圆点。主因素点可点→受影响订单·悬停→富逐日 tip。 */
function FactorRow({ label, sub, color, dots, onDay, tipFor }: {
  label: string; sub: string; color: string; dots: { color: string; value: number | null }[]; onDay?: (day: number) => void; tipFor?: (dayIdx: number) => DayTipData | null;
}) {
  return (
    <div className={styles.rkFrow} data-testid={`risk-frow-${label}`}>
      <div className={styles.rkFlab}>
        <b style={{ color }}>{label}</b>
        <span>{sub}</span>
      </div>
      <div className={styles.rkDots}>
        {dots.map((d, i) => (
          <DayDot key={i} idx={i} color={d.color} value={d.value} onDay={onDay} tip={tipFor ? tipFor(i) : null} />
        ))}
      </div>
    </div>
  );
}

/** Gap#4b 缺失分类面板：无真实数据源的基地·因素诚实列出（不假红/不静默）+ 去补齐深链。 */
function MissingPanel({ cards }: { cards: RiskCard[] }) {
  return (
    <div className={styles.rkDet} data-testid="risk-missing-panel" style={{ marginTop: 14, borderStyle: "dashed" }}>
      <div className={styles.rkDetH}>
        <b>⊕ 缺失分类 · 无真实数据源（{cards.length}）</b>
        <span>诚实标注·不冒充决策红（KILL-MOCK-RED）；接入真源后自动纳入推演</span>
      </div>
      <table className="cmp" data-testid="risk-missing-table">
        <thead>
          <tr><th>基地 / 对象</th><th>首要因素</th><th>缺失原因</th><th>去补齐</th></tr>
        </thead>
        <tbody>
          {cards.map((c) => (
            <tr key={c.base} data-testid={`risk-missing-${c.base}`}>
              <td className="zh"><b>{c.base}</b></td>
              <td className="zh">{c.factor}</td>
              <td style={{ color: "var(--muted)", fontSize: 11 }}>{c.noDataReason ?? "该因素无实测张力（无真 OEE/利用率/良率源）"}</td>
              <td>
                {c.deeplink ? (
                  <Link to={c.deeplink.to} data-testid={`risk-missing-cta-${c.base}`} style={{ color: "var(--accent)", fontWeight: 600, fontSize: 11 }}>{c.deeplink.label}</Link>
                ) : (
                  <span style={{ color: "var(--muted2)", fontSize: 11 }}>接入连接器 / 上传实测</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
      {/* Gap#4a：mitigation_select 返回多方案 → 五维对比矩阵（见效/周期/投入/风险/评分），非仅堆叠列表·推荐行高亮·逐行可采纳。 */}
      <div className={styles.wfT} style={{ color: "var(--ok)" }}>💡 对症方案 · {factor}（{plans.length} 个 · 对比矩阵）</div>
      {isLoading ? (
        <div style={{ color: "var(--muted2)", fontSize: 11 }}>{zh.common.loading}</div>
      ) : !plans.length ? (
        <div className="empty-state" style={{ fontSize: 11 }}>{zh.common.none}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="cmp" data-testid="mitigation-compare">
            <thead>
              <tr><th>方案</th><th>见效(pp)</th><th>周期(周)</th><th>投入</th><th>风险</th><th>评分</th><th></th></tr>
            </thead>
            <tbody>
              {plans.map((p, i) => {
                const rec = p.key === data?.recommended;
                return (
                  <tr key={p.key} data-testid={`mitigation-plan-${p.key}`} style={rec ? { background: "rgba(98,190,119,.08)" } : undefined}>
                    <td className="zh">
                      <b>{i + 1}. {p.name}</b>
                      {rec && <span className="badge" data-testid={`mitigation-rec-${p.key}`} style={{ marginLeft: 6, background: "var(--ok)", color: "#0a1f12", fontSize: 9 }}>推荐</span>}
                    </td>
                    <td className="mono" style={{ color: "var(--ok)", fontWeight: 700 }}>{p.eff}</td>
                    <td className="mono">{p.tn}</td>
                    <td className="zh">{p.cost}</td>
                    <td className="zh">{p.risk ?? "—"}</td>
                    <td className="mono"><b>{p.score}</b></td>
                    <td>
                      <button
                        className={styles.fcGo}
                        data-testid={`mitigation-adopt-${p.key}`}
                        disabled={adopt.isPending}
                        onClick={() => adopt.mutate({ actionTypeKey: "adopt_mitigation", payload: { base, factor, planKey: p.key } })}
                      >
                        采纳→工单
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
 * 对话态 QA（HTML §5 右栏）· Gap#1 命门·铁律0.4：**真调风险 Agent（agt_risk）**，不再本地正则派生假答案。
 * 提交经 QOS 主链 `POST /b/v1/queries`（意图 risk_root_cause/yield_diag/maint_stagger → agt_risk），
 * 携本卡 base+factor 上下文 → useTaskStream 流式回吐真 Agent 答案（复用 TaskRun：时间线 + 逐字流 + AnswerCard + 编排 DAG）。
 * 无可用意图包 → 诚实禁用态（不伪造）；提交失败 → 诚实错误徽标。答案真源与嵌入态求解器同一批真数据（R6）。
 */
function QaPanel({ card }: { card: RiskCard }) {
  const { data: workspace } = useWorkspace();
  const packageId = firstPackageId(workspace);
  const [turns, setTurns] = useState<{ localId: string; query: string; taskId?: string; error?: string }[]>([]);
  const [input, setInput] = useState("");

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || !packageId) return;
    const localId = crypto.randomUUID();
    setTurns((t) => [...t, { localId, query: text }]);
    setInput("");
    try {
      // 组装 SessionContext：显式带本卡 base（选中对象）+ factor（filters）→ Agent 有明确推演主体（不靠全局态漂移）。
      const bctx = useSessionStore.getState().buildContext();
      const context = {
        ...bctx,
        view: bctx.view || "risk",
        selectedObjects: [
          { objectType: "Base", objectId: `base-${card.base}`, label: card.base },
          ...bctx.selectedObjects.filter((o) => o.label !== card.base),
        ].slice(0, 10),
        filters: { ...bctx.filters, factor: card.factor },
      };
      const res = await submitQuery({ packageId, query: text, context }, crypto.randomUUID());
      setTurns((t) => t.map((x) => (x.localId === localId ? { ...x, taskId: res.taskId } : x)));
    } catch (e) {
      setTurns((t) => t.map((x) => (x.localId === localId ? { ...x, error: (e as Error).message } : x)));
    }
  };

  const presets = ["为什么会越线？", "影响哪些客户？", "哪些订单受影响？", "最坏后果是什么？"];

  return (
    <div>
      <div className={styles.wfT} style={{ color: "var(--c-capacity)" }}>💬 人机对话 · 真 Agent（agt_risk）</div>
      <div className={styles.qaChips}>
        {presets.map((q) => (
          <button key={q} className={styles.qaChip} data-testid={`qa-chip-${q}`} disabled={!packageId} onClick={() => void ask(q)}>{q}</button>
        ))}
      </div>
      {turns.length === 0 ? (
        <div className={styles.rkAns} data-testid="risk-qa-answer">
          {packageId
            ? `点击上方问题或输入追问 → 经 QOS 路由到风险 Agent（agt_risk）真实推演本卡（${card.base}·${card.factor}），逐 token 流式回答（真源同本卡求解器）。`
            : "对话 Agent 未就绪（当前工作区无可用意图包）——请先配置意图/场景包后再问。"}
        </div>
      ) : (
        <div data-testid="risk-qa-answer" style={{ display: "grid", gap: 12, maxHeight: 460, overflowY: "auto" }}>
          {turns.map((t) => (
            <div key={t.localId} data-testid={`risk-qa-turn-${t.localId}`}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>🧑 {t.query}</div>
              {t.taskId ? (
                <TaskRun taskId={t.taskId} onRetry={() => void ask(t.query)} />
              ) : t.error ? (
                <div className="badge red" data-testid="risk-qa-error">{t.error}</div>
              ) : (
                <div style={{ fontSize: 11, color: "var(--muted2)" }}>{zh.common.loading}</div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className={styles.rkAsk}>
        <input
          value={input}
          data-testid="risk-qa-input"
          placeholder="输入追问，如：影响哪些客户？"
          disabled={!packageId}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) void ask(input); }}
        />
        <button data-testid="risk-qa-ask" disabled={!packageId} onClick={() => { if (input.trim()) void ask(input); }}>问</button>
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
