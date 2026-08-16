import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RiskTimelineOutput } from "@platform/contracts";
import { RiskTimelineOutputSchema, BottleneckMatrixOutputSchema, SEG_REGISTRY, TIGHTNESS_METRIC, formatTightness } from "@platform/contracts";
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
import { RiskHoverTrigger } from "@/components/Risk/RiskPopover";
import { useActionDraft, ExportReportButton } from "./sim/shared";
import type { ProvenanceReport } from "./sim/exportProvenance";
import { DynamicLeverPanel } from "./sim/DynamicLeverPanel";
import type { ViewRendererProps } from "./registry";
import { InferenceProcessPanel } from "@/components/InferenceProcessPanel";
import EdgeActivePanel from "./sim/EdgeActivePanel";
import { BaseOutlookPanel } from "./BaseOutlookPanel";
import { DispositionDetailPanel } from "./DispositionDetailPanel";
import { CapacityDerivationDag } from "./capacity/CapacityDerivationDag";
import { CapacityRampEnvelope } from "./capacity/CapacityRampEnvelope";
import { CapacityFactorOntology } from "./capacity/CapacityFactorOntology";
import { CapacityLiveDialog } from "./capacity/CapacityLiveDialog";
import { Provenance } from "@/components/Provenance";
import { InfoPopover } from "@/components/InfoPopover";
import { ScopeHonestyBadge } from "@/components/ScopeHonestyBadge";
import { ExposurePanel } from "./risk/ExposurePanel";
import { DoNothingPanel } from "./risk/DoNothingPanel";
import { DispositionOptionsPanel } from "./risk/DispositionOptionsPanel";
import { ProvenanceDag, gapAttributionToBaseRootCause, type GapAttrOutput, type DagData } from "@/components/ProvenanceDag";
import { matchRiskFactorToRootCause } from "@/config/riskFactorTaxonomy";
// WO-FACTOR-SCOPE-SINGLESOURCE：因子作用域的**值**类型走契约品牌类型（裸 string 赋不进来 → 词表错配编译期红）。
import type { CausalFactorId, RefinableFactor } from "@platform/contracts";
import zh from "@/locales/zh";
import styles from "./RiskBoardView.module.css";

/** WO-CAPLIVE-2 · 产能活台当前推演态（杠杆组合 + 增益 + 影响面）——DynamicLeverPanel 上抛，供方案存/横比消费。 */
type LiveLeverState = { apply: { objectType: string; objectId: string; prop: string; value: number }[]; capGain: number; affected: number };

type RiskCard = RiskTimelineOutput["cards"][number];
/** WO-LIVE-DISPOSITION：处置表行（契约单源·前端不重定义 R1/R14）。 */
type PlanRow = NonNullable<RiskTimelineOutput["planRows"]>[number];
type BottleneckOutput = ReturnType<typeof BottleneckMatrixOutputSchema.parse>;

/** 越线带宽（阈值下探关注区）：阈值−15 起为「关注」。参照 HTML 三档口径。 */
const BAND = 15;

/**
 * WO-DISPOSITION-INLINE-ROW · 处置计划表**列定义的单一来源**。
 *
 * `<thead>` 与「行内展开行」的 `colSpan` **同吃这一份** —— 以后加/减一列只改这里，两处一起动。
 * 修前展开面板挂在 `</table>` 之后、根本没有 colSpan；若照抄写死 `colSpan={7}`，加列当天就错位，
 * 且错位是纯视觉的、任何测试都咬不住（=下一个「绿测试≠能用」）。故此处不写死，从列数现算。
 */
const PLAN_COLUMNS: readonly string[] = [
  "#",
  zh.risk.planAct,
  zh.risk.planOwner,
  zh.risk.planStart,
  zh.risk.planDone,
  zh.risk.planEff,
  zh.risk.planRule,
];
/** 电池产量单位（换行业经 ViewConfig.layout.unit 下发·此处域内兜底）。WO-UNIT-NORMALIZE：Order.qty 单位=套。 */
const UNIT = "套"; // debattery-allow
/** WO-UNIT-NORMALIZE：万元→亿 单位换算（NOT 业务常数·R14）。营收=Σ qty(套)×priceWan(万元)→ /1e4 = 亿。 */
const wanToYi = (v: number) => v / 1e4;

/**
 * 基地对象的**真 objectId**（对齐后端 `synthetic/service.ts` 的 `obj_${type}_${pk}` 形态：`obj_base_changzhou`）。
 *
 * 修前本视图传 `base-${card.base}`（中文名，如 `base-常州`）——该形态**只存在于前端 mock fixture**，
 * 后端对象库里没有这个 id。症状：在风险看板点常州风险卡（视觉已高亮"选中"）→ 对话坞问「受影响订单有哪些」
 * → 系统反问「请提供基地」（选中态在后端解析不出对象，等于没选）；同一基地在地图页点却正常
 * （`GeoMapView` 传的是 objects 端点返回的真 `b.id`）。
 *
 * 入参优先用 `card.baseId`（求解器回传的规范 baseId，如 `xinyang`）；已是 `obj_base_` 前缀则原样返回
 * （幂等·后端 `normalizeBaseRef` 也认这两种形态）。
 */
/**
 * WO-DECISION-INFO-FE ④ · 按**影响面**排看板（纯函数·可单测·零副作用）。
 *
 * ⚠ `cards[]` 的数组序是既有排序契约（越线日↑ → 实测当前张力↓ → peak↓ → 基地名，由 `preferRiskCard`
 *   与 `capacity-page-100pct ①R1b/①R1c` 双向咬死）——**本函数不改它**（不原地 sort，返回新数组）。
 *   求解器另给的 `exposureOrder` 是 `cards[].exposure.rank` 的**同一次计算投影**（零敞口基地一律沉底），
 *   所以这里只按它取序，**绝不在前端另造一套排序算法**（造第二套 = 两个序迟早漂移）。
 *
 * 缺席/落单的诚实处置：`exposureOrder` 缺席 → 原样返回数组序；某张卡不在 `exposureOrder` 里
 * （后端没给该基地敞口）→ 保持它们彼此的既有相对序、整体附在末尾，**不给它编一个名次**。
 */
export function orderCardsByExposure<T extends { baseId: string }>(cards: readonly T[], exposureOrder?: readonly string[]): T[] {
  if (!exposureOrder || exposureOrder.length === 0) return [...cards];
  const rank = new Map(exposureOrder.map((b, i) => [b, i]));
  return cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ra = rank.get(a.c.baseId) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.c.baseId) ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || a.i - b.i;
    })
    .map((x) => x.c);
}

export const baseObjectId = (ref: string | { base: string; baseId?: string }): string => {
  // 两种入参：卡对象（优先 baseId·缺则**回落基地名**，不伪造 obj_base_undefined）或裸 baseId 串。
  const id = typeof ref === "string" ? ref : (ref.baseId ?? "");
  if (!id) return typeof ref === "string" ? ref : ref.base;
  return id.startsWith("obj_base_") ? id : `obj_base_${id}`;
};

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
  // WO-LIVE-DISPOSITION T2/T3（治 G-DISPOSITION-STATIC 前端半）：
  // ① `boardLive` 把 RiskDetailPanel 里 DynamicLeverPanel 上抛的推演态**提到看板级**——处置表才吃得到杠杆
  //    （修前 liveState 只在详情面板内部、完全没回流 planRows → 调杠杆处置表纹丝不动 = 用户痛点②）。
  // ② `livePlan` = 点「⚙ 生成/重算行动计划」后用当前 apply 重新 invoke risk_timeline 得到的处置表（真重算·不是前端改字）。
  // ③ `openPlanRow` = 点开的行 index → DispositionDetailPanel 逐 step 展开推导过程（用户痛点③）。
  const [boardLive, setBoardLive] = useState<LiveLeverState>({ apply: [], capGain: 0, affected: 0 });
  const onBoardLive = useCallback((s: LiveLeverState) => setBoardLive(s), []);
  const [livePlan, setLivePlan] = useState<{ rows: PlanRow[]; leverCount: number } | null>(null);
  const [openPlanRow, setOpenPlanRow] = useState<number | null>(null);
  // WO-DECISION-INFO-FE ④：看板展示序 —— 默认按**影响面**（exposureOrder·零敞口沉底），
  // 可切回求解器数组序（越线日↑→张力↓）。两个序都留着，因为它们回答的是两个不同的问题
  // （"谁最快出事" vs "出事落在谁身上"），把其中一个藏起来就是替用户做了他该做的判断。
  const [orderMode, setOrderMode] = useState<"exposure" | "solver">("exposure");

  const { data, isLoading } = useQuery({
    queryKey: ["a", "risk-timeline", { horizon }],
    queryFn: async () => {
      const res = await invokeSolver("risk_timeline", { horizon });
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

  // WO-LIVE-DISPOSITION T2 · 「⚙ 生成/重算行动计划」：把当前杠杆推演态（boardLive.apply）作 overlay 回传
  // risk_timeline **服务端真重算**（克隆-覆写产能链 → 真缺口 → 三杠杆贪心派生），不在前端拼字。
  // apply 空 → 基线方案（等同现状·后端逐字节兼容）；apply 非空 → 标注「含 N 项杠杆推演」。
  const regen = useMutation({
    mutationFn: async (apply: LiveLeverState["apply"]) => {
      const res = await invokeSolver("risk_timeline", apply.length > 0 ? { horizon, apply } : { horizon });
      return RiskTimelineOutputSchema.parse(res.data);
    },
    onSuccess: (out, apply) => {
      setLivePlan({ rows: out.planRows ?? [], leverCount: apply.length });
      setOpenPlanRow(null);
    },
  });

  if (isLoading || !data) return <div className="empty-state">{zh.common.loading}</div>;

  const threshold = data.threshold;
  const cards = data.cards;
  // 展示序（不动 data.cards 本身）：exposureOrder 缺席 → 自动回落数组序，并在下方 chip 处说明为什么。
  const hasExposureOrder = (data.exposureOrder?.length ?? 0) > 0;
  const displayCards = orderMode === "exposure" && hasExposureOrder ? orderCardsByExposure(cards, data.exposureOrder) : cards;

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

  // WO-CAPACITY-PAGE-100PCT ⑨：修前「首要风险」= `card.peak === max(peak)`，而 peak 被求解器 cap 封顶（98）
  // → 7/8 张卡 peak 全等于 98 → **7 张卡同时挂"⚠ 首要风险"**（徽章失去意义）。求解器现已按
  // 越线日↑→实测当前张力↓→峰值↓ 全序返回，故"首要"= 该序第一张（唯一·可核查），不再靠封顶值比大小。
  // ⚠️ 审核方复并注记：本行在 WO-CAPACITY-PAGE-100PCT 并线时**整块丢失**（cherry-pick 冲突取错版本，
  //    退回了 maxPeak 写法），测试半却完整并入 → 带红并线。别再退回 `Math.max(peak)`：
  //    `saturateTension` 让 peak 互不相同后徽章会"看着只挂一个"，那是巧合不是契约（本仓反复出事的病根）。
  const primaryBase = cards[0]?.base;

  // rk-kpi 5 指标（全聚合自真 risk_timeline / bottleneck·非硬编）。
  const riskFactorPoints = cards.reduce((s, c) => s + Math.max(1, factorsOver(c.base).length), 0);
  const allOrders = new Set(cards.flatMap((c) => (c.affectedOrders ?? []).map((o) => String(o.so ?? "")).filter(Boolean)));
  const allCusts = new Set(cards.flatMap((c) => (c.affectedOrders ?? []).map((o) => String(o.cust ?? "")).filter(Boolean)));
  const crossDays = cards.map((c) => c.crossDay).filter((d): d is number => d != null);
  const earliestCross = crossDays.length ? Math.min(...crossDays) : null;

  const openCard = openBase ? cards.find((c) => c.base === openBase) ?? null : null;
  // WO-LIVE-DISPOSITION：处置表数据源 = 点过「生成/重算」则用**重算结果**（吃当前杠杆推演态），否则基线查询结果。
  const planRows: PlanRow[] = livePlan?.rows ?? data.planRows ?? [];

  /**
   * WO-U7-U9-REST · 判据 U9：导出物自带出处与生成时间 —— 换用共享件 `exportProvenance`
   * （缺 basis/时间戳直接抛）。旧 `exportPlanRows` 的失败模式它亲手演示过：页脚自称
   * 「导出含口径」，通篇却没有生成时间、也没有求解器/入参出处 ⇒ 拿它进决议附件的人无法复算。
   * 复算必需的都在 basis：求解器、窗口、阈值、以及这份表是基线还是吃了 N 项杠杆的重算结果
   * （同一张表两种来源，复算路径完全不同，不写清就是又一份「页脚自称」）。
   */
  const buildPlanReport = (): ProvenanceReport => ({
    docName: zh.risk.planTitle,
    basis: [
      `求解器 risk_timeline（窗口 ${horizon} 天 · 阈值 ${threshold} · 同输入同输出）`,
      livePlan
        ? `本表为「生成/重算行动计划」结果，吃 ${livePlan.leverCount} 项杠杆推演（非基线）`
        : "本表为基线查询结果（未吃杠杆推演）",
    ],
    sections: [
      {
        heading: zh.risk.planTitle,
        head: ["#", "行动项", "负责人", "启动", "完成", "预期效果", "依据/规则"],
        rows: planRows.map((r, i) => [i + 1, r.det ? `${r.act}（${r.det}）` : r.act, r.owner, r.start, r.done, r.eff, r.rule]),
      },
    ],
  });
  // 换推演窗口 → 丢弃上一窗口的重算结果（否则 30 天窗算出的计划挂在 90 天窗下=串窗·诚实回落基线）。
  const pickHorizon = (h: number) => {
    setHorizon(h);
    setLivePlan(null);
    setOpenPlanRow(null);
  };

  return (
    <div className={styles.riskwrap}>
      {/* rk-top：标题 + 视角/窗口 chip。瓶颈视角为主态；30/60/90 天切窗口重算 risk_timeline。 */}
      <div className={styles.rkTop}>
        <div>
          <h3>产能推演</h3>
          {/* 规范 §1：第一层只留窗口与阈值这两个**数值**；「这一页在回答什么」属解释 → `?` 浮层。 */}
          <div className={styles.rkSub}>
            未来 {horizon} 天 · 阈值 {threshold}
            <InfoPopover topic={zh.risk.info.bridge} testId="risk-bridge">
              <p>{zh.risk.info.bridgeBody}</p>
            </InfoPopover>
            {/* 欠账 #178（后→前这一跳）：`risk_timeline` 随结果下发作用域诚实位
                （`apps/datacore/src/solvers/risk.ts:775-777`·BASE/ALL 两条返回路全带），
                且**已在契约里显式声明**（`packages/contracts/src/solvers.ts:351-354`）——
                声明这件事本身就是引擎侧的原话：「zod 默认 strip 未声明键 …… 加性字段必须同时
                在契约里声明，否则等于没加」。声明了、下发了，前端却零消费方 ⇒ 屏上这一屏
                「产能推演」的卡、KPI、越线日全是**全网**口径，而用户随时可能读成某个基地的数
                （引擎侧记的病历原话：问「枣庄」拿到 8 张别的基地的卡，屏上一个字都看不出来）。
                挂在窗口/阈值这条结果元信息行上：**整屏结论共用一个口径**，不该只贴在某个 KPI 上。
                载荷直传 `data`（`RiskTimelineOutputSchema.parse` 的产物，四个键都在），
                不重定义契约类型（R1 contracts-only-shared）。 */}
            <ScopeHonestyBadge payload={data} testId="risk-timeline" />
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
              onClick={() => pickHorizon(h)}
              onKeyDown={(e) => e.key === "Enter" && pickHorizon(h)}
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
          {/* WO-DECISION-INFO-FE ④ · 展示序开关：影响面序（求解器 exposureOrder·零敞口沉底）↔ 求解器数组序。
              缺 exposureOrder（旧后端/桩）→ chip 停用并说明"后端未下发"，绝不在前端自己排一套冒充。 */}
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--muted)", margin: "0 0 10px" }} data-testid="risk-order-mode">
            <span>看板排序：</span>
            {/* WO-R5 收编时改：两个 chip 原各挂一个承载**排序公式**的原生 `title=`，
                被 hover-layer 那道棘轮门当场拦下（79 → 82）。按规范 §2 R-UI-3
                「公式与口径不在第一层，且禁止用 HTML title 属性充当浮层」搬进 InfoPopover。
                第一层留 chip 名（状态/名字），公式进浮层 —— 且 `?` 触发器本身就是那个可见记号，
                不是静默降层。 */}
            <InfoPopover topic="看板排序口径" testId="risk-order-mode">
              <div>
                <b>影响面序</b>：按求解器 <code>exposureOrder</code>（金额↓ → 单数↓ → 最早交期↑；零敞口基地一律沉底）。
                它是 <code>cards[].exposure.rank</code> 的同一次计算投影，前端不另排一套。
                {!hasExposureOrder && <>　⚠ 本次响应<b>未返回</b> <code>exposureOrder</code>（契约中为 optional），该档不可选。</>}
              </div>
              <div style={{ marginTop: 6 }}>
                <b>越线日序</b>：求解器数组序（越线日↑ → 实测当前张力↓ → 峰值↓ → 基地名）。
              </div>
            </InfoPopover>
            <span className={`${styles.tierChip} ${orderMode === "exposure" && hasExposureOrder ? styles.tierChipOn : ""}`}
              data-testid="risk-order-mode-exposure" role="button" tabIndex={0}
              aria-disabled={!hasExposureOrder}
              onClick={() => hasExposureOrder && setOrderMode("exposure")}
              onKeyDown={(e) => e.key === "Enter" && hasExposureOrder && setOrderMode("exposure")}>
              影响面序
            </span>
            <span className={`${styles.tierChip} ${orderMode === "solver" || !hasExposureOrder ? styles.tierChipOn : ""}`}
              data-testid="risk-order-mode-solver" role="button" tabIndex={0}
              onClick={() => setOrderMode("solver")}
              onKeyDown={(e) => e.key === "Enter" && setOrderMode("solver")}>
              越线日序
            </span>
            <span style={{ fontSize: 12, color: "var(--muted2)" }} data-testid="risk-order-mode-note">
              {hasExposureOrder
                ? "「影响面序」= 求解器 exposureOrder（与 exposure.rank 同一次计算的投影，前端不另排）；零敞口基地沉底。⚠ 首要风险徽章始终跟着**越线日序**第一张卡走。"
                : "本次响应未返回 exposureOrder（契约中为 optional）→ 只能按越线日序展示，前端不自造影响面排序。"}
            </span>
          </div>
          {/* rk-grid：每基地一卡（整卡点击展开·无独立 CTA）。因素 chip 来自 bottleneck 真值。 */}
          <div className={styles.rkGrid}>
            {displayCards.map((card) => {
              const selected = selectedObjects.some((o) => o.label === card.base) || openBase === card.base;
              const synth = card.provenanceSynthetic === true;
              const peakColor = tierColor(card.peak, threshold);
              const chips = topFactors(card.base, 2);
              const isPrimary = card.base === primaryBase;
              const orderCount = card.affectedOrders?.length ?? 0;
              const factorCount = Math.max(1, factorsOver(card.base).length);
              return (
                <div
                  key={card.base}
                  className={`${styles.rkCard} ${selected ? styles.rkCardOpen : ""}`}
                  data-testid={`risk-card-${card.base}`}
                  data-synth={synth ? "1" : "0"}
                  // 影响面排序键直挂 DOM（= 求解器 exposure.rank·前端不重算）：既供测试咬"零敞口沉底"，
                  // 也让"这张卡为什么排在这儿"可当场核。缺席则不挂（不编一个名次）。
                  data-exposure-rank={card.exposure?.rank}
                  data-has-exposure={card.exposure ? (card.exposure.hasExposure ? "1" : "0") : undefined}
                  role="button"
                  tabIndex={0}
                  style={{ borderColor: `${peakColor}55` }}
                  onClick={() => {
                    // 选中态必须携**真 objectId**（`obj_base_<baseId>`），否则对话坞拿到的作用域在后端解析不出对象 →
                    // 「受影响订单有哪些」被反问「请提供基地」（视觉选中≠真选中）。`card.baseId` 由 risk_timeline 回传。
                    useSessionStore.getState().toggleSelectedObject({ objectType: "Base", objectId: baseObjectId(card.baseId), label: card.base });
                    setOpenBase((b) => (b === card.base ? null : card.base));
                  }}
                  onKeyDown={(e) => e.key === "Enter" && setOpenBase((b) => (b === card.base ? null : card.base))}
                >
                  <div className={styles.rkCH}>
                    <b>
                      {card.base}
                      {isPrimary && <span className="badge" data-testid={`risk-primary-${card.base}`} style={{ marginLeft: 6, background: "var(--danger)", color: "#fff", fontSize: 12 }}>{zh.risk.primaryTag}</span>}
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
                        {/* WO-UNIT-MEANING：峰值是 0–100 张力指数（量纲原只藏在 hover 里）→ 主数字直接带量程。 */}
                        {card.crossDay != null ? `T+${card.crossDay}` : formatTightness(card.peak)}
                      </Provenance>
                    </span>
                    <span className={styles.rkUnit}>{card.crossDay != null ? "最早越线" : `峰值张力（${TIGHTNESS_METRIC.hint}）`}</span>
                  </div>
                  {chips.length > 0 && (
                    <div className={styles.rkChips} data-testid={`risk-chips-${card.base}`}>
                      {chips.map((ch) => {
                        const col = tierColor(ch.value, threshold);
                        return (
                          // WO-UNIT-MEANING：原渲染「设备OEE 76」——76 紧贴 OEE 会被读成 OEE=76%，
                          // 实为该因素的**张力 76/100**（误导性最强的一处）。经 formatTightness 单源带量纲。
                          //
                          // WO-UI-DECLUTTER-TOP3：原生 `title=` 承载的口径说明搬进 `?` 浮层（规范 §2 明令禁止
                          // 用 `title` 当浮层：OS 绘制、不可控样式、移动端不可达、移开会滞留）。
                          // 量纲仍留在**第一层**（`formatTightness` 带 `/100`），浮层只解释「凭什么这么算」。
                          // `aria-label` 保留 —— 读屏用户不靠 hover。
                          <span key={ch.factor} className={styles.rkFchip} style={{ borderColor: `${col}66`, color: col }}
                            aria-label={`${ch.factor} 的紧张度（${TIGHTNESS_METRIC.scaleMin}–${TIGHTNESS_METRIC.scaleMax}·${TIGHTNESS_METRIC.hint}）·非该指标本身的值`}>
                            {ch.factor} {formatTightness(ch.value)}
                          </span>
                        );
                      })}
                      <InfoPopover topic={zh.risk.info.tightness} testId={`tightness-${card.base}`}>
                        <p>{zh.risk.info.tightnessBody(TIGHTNESS_METRIC.scaleMin, TIGHTNESS_METRIC.scaleMax, TIGHTNESS_METRIC.hint)}</p>
                      </InfoPopover>
                    </div>
                  )}
                  <div className={styles.rkCF}>
                    <span style={{ color: peakColor }}>{factorCount} 个风险因素</span>
                    <span>{orderCount} 批订单受影响</span>
                  </div>
                  {/* WO-DECISION-INFO-FE ① · 卡面影响面摘要（"这事有多大、落在谁身上"——此前整块没渲染）。
                      三分支各不相同，**不许合并**：缺席=未知 / 零敞口=一等结论 / 有敞口=真数字。 */}
                  <CardExposureLine card={card} />
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
              isPrimary={openCard.base === primaryBase}
              onDay={(day) => setOrdersDay({ card: openCard, day })}
              onLiveStateChange={onBoardLive}
            />
          )}

          {ordersDay && <AffectedOrdersModal card={ordersDay.card} day={ordersDay.day} onClose={() => setOrdersDay(null)} />}

          {/* 处置计划表：按越线日前置排启动·采纳经审批下发工单。导出最终规划（前端生成独立浅色 HTML 文档下载）。
              WO-LIVE-DISPOSITION：① 「⚙ 生成/重算行动计划」触发按钮（吃 boardLive.apply → 后端真重算）；
              ② 每行可点开 → DispositionDetailPanel 逐 step 推导过程 + provenance（R13）。 */}
          {(planRows.length ?? 0) > 0 && (
            <div className={styles.rkDet} style={{ marginTop: 14 }} data-testid="risk-plan-panel">
              <div className={styles.rkDetH}>
                <b>
                  📋 {zh.risk.planTitle}
                  <InfoPopover topic={zh.risk.info.planRow} testId="plan-howto">
                    <p>{zh.risk.info.planRowBody}</p>
                    <p>{zh.risk.plan.regenHint}</p>
                  </InfoPopover>
                </b>
                <span>
                  {zh.risk.planSub(planRows.length)}
                  {"　"}
                  {/* WO-UI-DECLUTTER-TOP3：`title=` → `aria-label`（规范 §2 禁用原生 tooltip 充当浮层）；
                      口径本身由下方「这张表怎么读」`?` 浮层统一承载，不再每个控件各挂一条。 */}
                  <span className={styles.tierChip} data-testid="risk-plan-regen" role="button" tabIndex={0}
                    aria-label={zh.risk.plan.regenHint}
                    style={{ display: "inline-block" }}
                    onClick={() => regen.mutate(boardLive.apply)}
                    onKeyDown={(e) => e.key === "Enter" && regen.mutate(boardLive.apply)}>
                    {regen.isPending ? zh.risk.plan.regenBusy : zh.risk.plan.regen}
                  </span>
                  {"　"}
                  <span data-testid="risk-plan-live-note" style={{ fontSize: 12, color: "var(--muted2)" }}>
                    {livePlan
                      ? livePlan.leverCount > 0
                        ? `（${zh.risk.plan.withLevers(livePlan.leverCount)}）`
                        : `（${zh.risk.plan.baseline}）`
                      : boardLive.apply.length > 0
                        ? `（${zh.risk.plan.withLevers(boardLive.apply.length)} · ${zh.risk.plan.regenHint}）`
                        : ""}
                  </span>
                  {/* WO-CAPACITY-PAGE-100PCT ⑪（D 类静默降级）：契约里 `planRows[].overlay {count,capRatio}` 一直有值，
                      前端**从来没渲染过** → 用户拖完 5 根杠杆点「重算」，表格一个字没变、页面也不解释为什么，
                      看着就像"杠杆是假的"。这里把引擎的回执如实亮出来：杠杆落在哪些基地的产能链上、比值多少、
                      其中几个基地窗内确有缺口（行动项因此重算）、几个无缺口（故不变）。 */}
                  {livePlan && <OverlayEffectNote rows={planRows} />}
                  {"　"}
                  {/* WO-U7-U9-REST · 判据 U9：换成共享导出件（出处 + 生成时间，缺一直接抛）。
                      旧 testid risk-plan-export 已由 export-report-risk 接替（risk-order-tab 测试同步改）。 */}
                  <ExportReportButton pageKey="risk" build={buildPlanReport} />
                </span>
              </div>
              <table className="cmp" data-testid="risk-plan-table">
                <thead>
                  <tr>
                    {/* 列定义单一来源 = PLAN_COLUMNS（展开行的 colSpan 同源·加列不错位）。 */}
                    {PLAN_COLUMNS.map((label, ci) => (
                      <th key={ci}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* WO-DISPOSITION-INLINE-ROW（WO-R1 2026-08-13 从 `claude/integ-ui-w5` 补进来的那一跳）：
                      详情**紧跟被点那一行**（`<tr><td colSpan>` 展开行），不再挂在 `</table>` 之后 ——
                      修前 17 行的表点第 3 行，详情跑到整张表最下面，用户既要滚到底、又看不出这段详情属于哪一行。
                      ⚠ 收编时**保留 canonical 的 `aria-label`**、没有跟 w5 回退成 `title=`：
                      canonical 的 WO-UI-DECLUTTER-TOP3 已把逐行原生 `title=` 改掉了
                      （规范 §2 明令 `title` 不是浮层），照搬 w5 会把那条已闭的账重新打开。 */}
                  {planRows.map((r, i) => {
                    const rowOpen = openPlanRow === i;
                    const toggle = () => setOpenPlanRow(rowOpen ? null : i);
                    const detailId = `risk-plan-detail-${i}`;
                    return (
                      <Fragment key={i}>
                        <tr data-testid={`risk-plan-row-${i}`} role="button" tabIndex={0}
                          aria-label={zh.risk.plan.rowHint}
                          aria-expanded={rowOpen}
                          aria-controls={rowOpen ? detailId : undefined}
                          className={rowOpen ? styles.rkPlanRowOpen : undefined}
                          style={{ cursor: "pointer", background: rowOpen ? "var(--panel2, rgba(120,160,200,.10))" : undefined }}
                          onClick={toggle}
                          onKeyDown={(e) => e.key === "Enter" && toggle()}>
                          <td className="mono"><b>{i + 1}</b></td>
                          <td className="zh"><b>{r.act}</b>{r.det ? <><br /><span style={{ fontSize: 12, color: "var(--muted2)" }}>{r.det}</span></> : null}</td>
                          <td className="zh">{r.owner}</td>
                          <td className="mono" style={{ whiteSpace: "nowrap" }}>{r.start}</td>
                          <td className="mono" style={{ whiteSpace: "nowrap" }}>{r.done}</td>
                          <td className="zh" style={{ color: "var(--ok-txt)" }}>{r.eff}</td>
                          <td><span className="badge">{r.rule}</span></td>
                        </tr>
                        {rowOpen && (
                          <tr data-testid={`risk-plan-detail-row-${i}`} className={styles.rkPlanDetailRow}>
                            <td id={detailId} colSpan={PLAN_COLUMNS.length}>
                              <DispositionDetailPanel row={r} onClose={() => setOpenPlanRow(null)} />
                              {/* WO-DECISION-INFO-FE ③ · 多方案与代价（A/B/C + 成本 + 副作用 + 前置期 R13）：
                                  DispositionDetailPanel 只讲**一条**贪心路径（"系统认为该这么办"），
                                  决策者要的是"有哪几种办法、各要付什么代价"——那一份在 planRows[].options 里，此前零消费。
                                  ⚠ 位置：必须与 DetailPanel **同一个 <td> 内联**，不许挂到 </table> 之后 ——
                                  收编来源分支正是挂在表后，而 disposition-inline-row.seam 咬的是**相对位置**
                                  （详情节点序号 == 被点行序号+1），挂表后既渲染两遍又当场红。 */}
                              <DispositionOptionsPanel row={r} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* 历史处置案例 + 风险推演编排过程 DAG（两态共享·看板下半区）。 */}
      <HistoricalCasesSection />
      <InferenceProcessPanel testId="inference-risk" solved />
      {/* WO-ACTIVE-EDGE-UX 挂载点 —— **这是工单那张表漏掉的第 9 页**。
          工单 §1 按 registry 里"带推演语义的 renderer"列了 8 页，把本页读成了「风险看板」；
          但**真实 workspace 下发的标题是「产能推演」**（`mocks/fixtures.ts` 的
          `{ key: "risk", title: "产能推演", renderer: "risk-board" }`，后端 BUILTIN_VIEWS 同源）。
          判据落在**用户看到的那个名字**上，不落在文件名/renderer key 上 ——
          「所有推演的功能」是按用户认知说的，不是按我们的目录说的。 */}
      <EdgeActivePanel pageKey="risk-board" />
    </div>
  );
}

/**
 * WO-DECISION-INFO-FE ① · 卡面「影响面」一行（`card.exposure` 的最小可决策投影）。
 *
 * 三分支语义完全不同，混成一句就是撒谎：
 *   缺席（后端没下发该 optional 字段）→ 「影响面：本次未返回」（**未知**，不是"没有影响"）
 *   `hasExposure:false`               → 「本窗无订单敞口 · 已沉底」（**一等结论**，附窗外最近一张在多远）
 *   有敞口                            → 「#rank · N 张单 · X 亿元 · M 家客户」（后端那一份数字的直投，不重算）
 */
function CardExposureLine({ card }: { card: RiskCard }) {
  const exp = card.exposure;
  if (!exp) {
    return (
      <div className={styles.rkCF} data-testid={`risk-exposure-line-${card.base}`} data-exposure="ABSENT" style={{ color: "var(--muted2)" }}>
        <span>影响面：本次未返回（cards[].exposure 缺席）</span>
      </div>
    );
  }
  if (!exp.hasExposure) {
    const nx = exp.nextOutsideWindow;
    return (
      <div className={styles.rkCF} data-testid={`risk-exposure-line-${card.base}`} data-exposure="EMPTY" style={{ color: "var(--muted2)" }}>
        <span>本窗无订单敞口 · 已沉底（#{exp.rank}）</span>
        <span>{nx ? `窗外最近 ${nx.qty}${exp.units.qty}（超窗 ${nx.daysBeyondWindow} 天）` : "窗外亦无单"}</span>
      </div>
    );
  }
  return (
    <div className={styles.rkCF} data-testid={`risk-exposure-line-${card.base}`} data-exposure="OK">
      <span style={{ color: "var(--c-forecast-txt)" }}>影响面 #{exp.rank} · {exp.orderCount} 张单 · {exp.customerCount} 家客户</span>
      <span style={{ color: "var(--ok-txt)" }}>{exp.revenueYi} {exp.units.revenue}</span>
    </div>
  );
}

/**
 * WO-CAPACITY-PAGE-100PCT ⑪ · 杠杆推演回执（治「调完杠杆点重算·屏幕一个字没变·也不说为什么」的静默降级）。
 * 数据全部来自求解器回传的 `planRows[].overlay`（`{count, capRatio}`·契约既有字段·前端零编造）：
 *   - capRatio ≠ 1 → 杠杆**真落在**该基地产能链上（比值即覆写后/基线）
 *   - capRatio = 1 → 杠杆没落在该基地链上（诚实说"未落在本基地产能链"，不假装有效）
 *   - shortfall = 0 → 该基地窗内本就无缺口，行动项**理应**不变（这才是"没变"的真原因）
 */
function OverlayEffectNote({ rows }: { rows: PlanRow[] }) {
  const byBase = new Map<string, { capRatio: number; shortfall: number }>();
  for (const r of rows) {
    const ov = r.overlay;
    if (!ov || !r.baseId) continue;
    if (!byBase.has(r.baseId)) byBase.set(r.baseId, { capRatio: ov.capRatio, shortfall: r.shortfall ?? 0 });
  }
  if (byBase.size === 0) return null;
  const landed = [...byBase.entries()].filter(([, v]) => v.capRatio !== 1);
  const withGap = landed.filter(([, v]) => v.shortfall > 0);
  /*
   * ═══ 规范 §4 豁免声明（docs/CONVENTION-ui-information-layering.md §4「豁免要在代码注释里写明理由」）═══
   *
   * **豁免对象**：本回执整块（`risk-plan-overlay-note`）留在第一层，不降浮层、不折叠。
   *
   * **理由一（它是结论，不是解释）**：本块回答的是「我拖完杠杆点了重算，为什么表格一个字没变」。
   *   按规范 §1 的三层准入，这属于**状态**（好/警/危里的"警"）——第一层的正当住户。
   *   它的前身正是 WO-CAPACITY-PAGE-100PCT ⑪ 记的那次**静默降级**事故：契约里 `planRows[].overlay`
   *   一直有值、前端从来没渲染过，用户只看见"杠杆像是假的"。把它降回一次点击之后 = 复现那个事故。
   *
   * **理由二（`×` 在这里是量纲不是公式）**：门的 R-UI-3 判据用 `[×÷]` 作口径/公式的代理指标，
   *   而本块里的 `×0.980` 是**比值本身**（capRatio 的记法），不是 `A × B ÷ C` 那种算法口径。
   *   代理指标在这里过匹配了 —— 按规范 §1「数值本身」的原文，它该留第一层。
   *   `apps/frontend-shell/test/capacity-page-100pct.test.tsx:135` 正是断言 `hefei ×0.980`
   *   出现在这个节点上：这条断言守的就是"引擎回执必须亮出来"。
   *
   * **不豁免的部分**：本块**没有**任何口径说明或推导过程；真需要解释"杠杆怎么算的"时，
   *   那句解释归上方杠杆面板的 `?` 浮层，不归这里。豁免只覆盖这一个回执节点。
   */
  return (
    <span data-testid="risk-plan-overlay-note" style={{ fontSize: 12, color: "var(--muted2)" }}>
      {landed.length === 0
        ? "（杠杆未落在任何风险基地的产能链上 → 行动项理应不变）"
        : `（杠杆落在 ${landed.map(([b, v]) => `${b} ×${v.capRatio.toFixed(3)}`).join("、")}；其中 ${withGap.length} 个基地窗内有缺口→行动项已随之重算，${landed.length - withGap.length} 个窗内无缺口→行动项理应不变）`}
    </span>
  );
}

/** （旧 `exportPlanRows` 已随 WO-U7-U9-REST 退役：页脚自称「含口径」却无时间戳无出处 ——
    导出统一走 `sim/exportProvenance` 共享件，缺 basis/时间戳直接抛。） */

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
  const { data, isLoading, error } = useQuery({
    queryKey: ["a", "affected_orders", "agg", horizon, baseFilter],
    queryFn: async () => {
      const res = await invokeSolver("affected_orders", { horizon, ...(baseFilter !== "__all__" ? { base: baseFilter } : {}) });
      return res.data as OrderAgg;
    },
  });
  // 同「诚实灰」纪律：请求失败 ≠ "没有受影响订单"。修前失败 → data undefined → rows=[] → 界面说
  // "当前范围无受影响订单（无在产订单落入越线传导窗口）"——把**请求失败**伪装成一个**业务结论**。
  const fail = error ? observedFailure(error) : null;
  const failLine = fail
    ? `affected_orders 请求失败${fail.status != null ? ` · HTTP ${fail.status}` : ""}${fail.code ? ` · 错误码 ${fail.code}` : ""}${fail.requestId ? ` · requestId ${fail.requestId}` : ""}${fail.message ? ` · ${fail.message}` : ""}`
    : "";
  // 单价/毛利率单一真相源 = SEG_REGISTRY（按细分名或 key 均可查·R6 字节复现）。
  const segPrice = useMemo(() => Object.fromEntries(SEG_REGISTRY.flatMap((s) => [[s.seg, s.priceWan], [s.key, s.priceWan]])) as Record<string, number>, []);
  const segMargin = useMemo(() => Object.fromEntries(SEG_REGISTRY.flatMap((s) => [[s.seg, s.marginPct], [s.key, s.marginPct]])) as Record<string, number>, []);

  // WO-CAPACITY-PAGE-100PCT ⑭（R8 轮·下拉自锁死）：修前选项集 = **当前这一次（已被 base 过滤的）响应**派生，
  // 选中「合肥」后响应里只剩合肥 → 下拉当场塌成「全部风险基地(1) + 合肥」，**没法直接改选金华**（必须先点 ✕清除），
  // 且「全部风险基地（N）」的 N 从 13 变成 1 —— 那是个**假的总数**（R-一致：同一事实一个出处）。
  // 修法：选项集只在 `__all__`（未过滤）响应回来时刷新并记住；过滤态沿用全域选项集，绝不用过滤结果冒充全域。
  const [baseOptions, setBaseOptions] = useState<string[]>([]);
  const allBases = useMemo(
    () => (baseFilter === "__all__" ? [...new Set((data?.rows ?? []).flatMap((r) => (r.risks ?? []).map((k) => String(k.base ?? "")).filter(Boolean)))] : null),
    [baseFilter, data],
  );
  useEffect(() => {
    if (allBases && allBases.join("|") !== baseOptions.join("|")) setBaseOptions(allBases);
  }, [allBases, baseOptions]);

  if (isLoading) return <div className="empty-state">{zh.common.loading}</div>;
  const rows = data?.rows ?? [];
  // `bases` = **本次响应里真有的基地**（经营表按基地聚合时只能列这些，不许凭空多出空行）。
  const bases = [...new Set(rows.flatMap((r) => (r.risks ?? []).map((k) => String(k.base ?? "")).filter(Boolean)))];
  // `selectBases` = **全域**基地（下拉可选项），过滤态下沿用记住的全域集合，故能直接从合肥改选金华。
  const selectBases = baseFilter === "__all__" ? bases : baseOptions.length > 0 ? baseOptions : bases;
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
          <b>
            受影响订单 · 经营数据看板
            {/* WO-UI-DECLUTTER-TOP3：表下那段「取数怎么勾稽 / 为什么有列是 —」的成段说明降进这里（规范 §1 浮层放「凭什么」）。 */}
            <InfoPopover topic={zh.risk.info.econSource} testId="order-agg-source">
              <p>{zh.risk.info.econSourceBody}</p>
            </InfoPopover>
          </b>
          <span>这些订单牵动的产能与财务（{seg === "app" ? "按应用细分" : "按基地"}）· 金额单位 亿元</span>
        </div>
        {/*
          WO-CAPACITY-PAGE-100PCT ⑬：口径交底（R-一致·同屏两个数必须解释得清）。
          本表 = 未来 {horizon} 天内交期、且落在**任一**基地风险窗内的订单（全基地）；
          顶部 KPI「受影响订单(批)」= 上方看板**展示的那几张风险卡**的并集，覆盖面更窄，故可能略少。
          （修前本表窗口写死 180 天，30/60/90 chip 拖了不动、且与 KPI 差一大截——已修，见 risk.ts affectedOrdersAggregate。）
        */}
        {/*
          WO-UI-DECLUTTER-TOP3（规范 §2 R-UI-3「口径不在第一层」）：
          第一层只留**范围本身**（窗口天数 + 覆盖面），「与顶部 KPI 为何对不上」这条口径差降进 `?` 浮层。
          `?` 触发器即规范 §1 要求的「可见记号」——降层不是删除。
        */}
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }} data-testid="risk-order-agg-caliber">
          未来 {horizon} 天内交期 · 全部基地
          <InfoPopover topic={zh.risk.info.caliber} testId="order-agg-caliber">
            <p>{zh.risk.info.caliberBody}</p>
          </InfoPopover>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 12px", display: "flex", alignItems: "center", gap: 7 }}>
          分类维度：
          <span className={`${styles.tierChip} ${seg === "app" ? styles.tierChipOn : ""}`} data-testid="risk-seg-app" role="button" tabIndex={0} onClick={() => setSeg("app")} onKeyDown={(e) => e.key === "Enter" && setSeg("app")}>应用细分</span>
          <span className={`${styles.tierChip} ${seg === "base" ? styles.tierChipOn : ""}`} data-testid="risk-seg-base" role="button" tabIndex={0} onClick={() => setSeg("base")} onKeyDown={(e) => e.key === "Enter" && setSeg("base")}>按基地</span>
        </div>
        {econRows.length === 0 ? (
          <div className="empty-state" style={{ fontSize: 12 }} data-testid="risk-econ-empty">{fail ? failLine : zh.common.none}</div>
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
                  <td className="zh"><b>{r.name}</b> <span style={{ color: "var(--muted2)", fontSize: 12 }}>({r.orderCount})</span></td>
                  {/* WO-UI-DECLUTTER-TOP3：逐格 `title=`（原生 tooltip·规范 §2 禁用）撤掉，
                      「为什么是 —」由列头旁的「经营数据取数来源」`?` 浮层一次说清；
                      `aria-label` 保留，读屏用户不靠 hover 也拿得到这条诚实位。 */}
                  <td className="mono" style={{ color: "var(--muted2)" }} aria-label={zh.risk.info.econNoSource}>—</td>
                  <td className="mono" style={{ color: "var(--muted2)" }} aria-label={zh.risk.info.econNoSource}>—</td>
                  <td className="mono" style={{ color: "var(--muted2)" }}>—</td>
                  <td className="mono" style={{ color: "var(--muted2)" }}>—</td>
                  <td className="mono" style={{ color: "var(--c-forecast-txt)", fontWeight: 700 }}>
                    {r.revenue > 0 ? (
                      <Provenance testId={`risk-econ-rev-${r.name}`} src="affected_orders × SEG_REGISTRY" formula="营收(亿) = Σ 数量 × SEG 参考单价(万元/套) ÷ 1e4" inputs={["受影响订单数量", "SEG_REGISTRY 参考单价"]} note="估算口径 · SEG 参考单价（合约域单一来源）非逐单实际成交价">
                        {`${wanToYi(r.revenue).toFixed(1)} 亿`}
                      </Provenance>
                    ) : "—"}
                  </td>
                  <td className="mono" style={{ color: "var(--ok-txt)", fontWeight: 700 }}>
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
                <td className="mono" style={{ color: "var(--c-forecast-txt)", fontWeight: 700 }} data-testid="risk-econ-total-rev">
                  {totalRev > 0 ? (
                    <Provenance testId="risk-econ-total-rev" src="affected_orders × SEG_REGISTRY" formula="合计营收(亿) = Σ 各细分营收" inputs={["各行营收（数量×SEG 参考单价）"]} note="估算口径 · SEG 参考单价非逐单实际成交价">
                      {`${wanToYi(totalRev).toFixed(1)} 亿`}
                    </Provenance>
                  ) : "—"}
                </td>
                <td className="mono" style={{ color: "var(--ok-txt)", fontWeight: 700 }}>
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
        {/* 这段原在表下第一层铺开（口径 + 公式 + 诚实位三合一，>60 字）——
            已整段降进上方「经营数据取数来源」`?` 浮层，内容一字未删（规范 §1：允许降层，绝不允许删除）。 */}
      </div>

      {/* 基地筛选 + 订单明细表。 */}
      <div style={{ fontSize: 12, color: "var(--muted)", margin: "12px 0 14px", display: "flex", alignItems: "center", gap: 9 }}>
        基地筛选：
        <select data-testid="risk-order-basesel" value={baseFilter} onChange={(e) => setBaseFilter(e.target.value)}
          style={{ background: "var(--panel)", border: "1px solid var(--line2)", borderRadius: 8, color: "var(--txt)", padding: "6px 12px", fontSize: 12, cursor: "pointer", minWidth: 170 }}>
          <option value="__all__">全部风险基地（{selectBases.length}）</option>
          {selectBases.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        {baseFilter !== "__all__" && (
          <span className={styles.rkFchip} data-testid="risk-order-clearbase" role="button" tabIndex={0}
            style={{ borderColor: "var(--c-capacity)", color: "var(--c-capacity-txt)", cursor: "pointer" }}
            onClick={() => setBaseFilter("__all__")} onKeyDown={(e) => e.key === "Enter" && setBaseFilter("__all__")}>✕ 清除（当前：{baseFilter}）</span>
        )}
      </div>
      <div className={styles.rkDet} style={{ marginTop: 0 }}>
        <div className={styles.rkDetH}>
          <b>受影响订单 · 明细（{baseFilter === "__all__" ? "全部" : baseFilter}）</b>
          <span>{data?.summary?.orderCount ?? rows.length} 批 · {data?.summary?.custCount ?? 0} 家客户 · 按交期排序</span>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state" data-testid="risk-order-empty" style={{ fontSize: 12 }}>
            {/* 第一层留**状态**（"无受影响订单"）；求解器名与筛选条件是诊断信息 → 浮层（规范 §1）。 */}
            {fail ? failLine : "当前范围内无受影响订单"}
            {!fail && (
              <InfoPopover topic={zh.risk.info.caliber} testId="order-empty-why">
                <p>affected_orders 返回 0 行：当前范围（窗口 + 基地筛选）内无受影响订单。</p>
                <p>{zh.risk.info.caliberBody}</p>
              </InfoPopover>
            )}
          </div>
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
                  <td><span className={styles.rkFchip} style={{ borderColor: "var(--c-capacity)", color: "var(--c-capacity-txt)" }}>{r.seg}</span></td>
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
                        <span key={j} className={styles.rkFchip} style={{ borderColor: "var(--danger)", color: "var(--danger-txt)" }}>{k.base}·{k.factor}{k.crossDay != null ? ` T+${k.crossDay}` : ""}</span>
                      ))}
                      {(r.risks ?? []).length > 4 && <span className={styles.rkFchip} style={{ borderColor: "var(--line2)", color: "var(--muted2)" }}>+{(r.risks ?? []).length - 4}</span>}
                    </div>
                  </td>
                  <td className="mono" style={{ color: "var(--danger-txt)", fontWeight: 700 }}>{r.delay != null ? `${r.delay} 天` : "—"}</td>
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
  card, bnRow, bnFactors, threshold, horizon, isPrimary, onDay, onLiveStateChange,
}: {
  card: RiskCard;
  bnRow?: BottleneckOutput["rows"][number];
  bnFactors: string[];
  threshold: number;
  horizon: number;
  isPrimary: boolean;
  onDay: (day: number) => void;
  /** WO-LIVE-DISPOSITION：把 DynamicLeverPanel 上抛的推演态**继续上抛到看板级**，供处置表「生成/重算」消费。 */
  onLiveStateChange?: (s: LiveLeverState) => void;
}) {
  const H = card.series.length || horizon;
  const synth = card.provenanceSynthetic === true;
  const baseIdForScope = (card as { baseId?: string }).baseId ?? card.base;
  // WO-CAPLIVE-2 · 因子级根因（活能力②·G-GAP-SCOPE 已闭·前端接线）：gap_attribution 现支持 scope.baseId/factorId，
  // 前端传作用域 → 未选因子=基地级、选因子=按因子细分。无源/基地对不上 → 诚实灰（不伪造根因树）。
  //
  // ⚠ WO-FACTOR-SCOPE-SINGLESOURCE（本状态的类型是**病灶的直接对策**·别改回 string）：
  // 修前这里是 `useState<string>`，chip 传的是卡面因子名（BN 张力词表中文名「瓶颈工序」…），
  // 而引擎认的是 `CausalFactor.factorId`（`cf-*`）—— 两张词表交集 **0** ⇒ 7 个按钮返回逐字节相同的树。
  // 现在类型是**品牌类型** `CausalFactorId`：裸 `string`（如 `card.factor`）赋不进来，
  // 一旦有人写回 `onRcFactor(card.factor)` / `factorOptions={[card.factor, …]}`，`tsc` 当场红。
  // 取证与词表全表见 `docs/AUDIT-factor-scope-vocab.md`。
  const [rcFactor, setRcFactor] = useState<CausalFactorId | undefined>(undefined);
  // 空态只能陈述**可观测事实**（HTTP 状态码 / 错误码 / requestId / 响应里实际有哪些基地）→ 必须拿到真错误对象，
  // 不能只留一个 isError 布尔（布尔只够说"失败了"，说不出"失败在哪"，于是过去被一句内联的因果猜测顶替）。
  const { data: ga, isLoading: gaLoading, error: gaError } = useQuery({
    queryKey: ["a", "gap_attribution", "risk-board", baseIdForScope, rcFactor ?? "__all__"],
    queryFn: async () => {
      const scope: Record<string, unknown> = { baseId: baseIdForScope };
      if (rcFactor) scope.factorId = rcFactor;
      const res = await invokeSolver("gap_attribution", { scope });
      return res.data as GapAttrOutput;
    },
    retry: false,
  });
  // 活能力①③：DynamicLeverPanel 上抛的当前推演态，供方案存/横比消费。
  // WO-LIVE-DISPOSITION：**同时**上抛到看板级（onLiveStateChange）——修前它只停在本面板内，处置表拿不到 →
  // 「调完杠杆点行动计划实时输出」根本没接线（用户痛点②的结构性病根）。
  const [liveState, setLiveState] = useState<LiveLeverState>({ apply: [], capGain: 0, affected: 0 });
  const onLiveState = useCallback(
    (s: LiveLeverState) => {
      setLiveState(s);
      onLiveStateChange?.(s);
    },
    [onLiveStateChange],
  );
  const baseDag: DagData | undefined = gapAttributionToBaseRootCause(ga, card.base);
  // 结构/因果根因因素标签（供 CI-b「对症根因」对齐·真出处=同一 gap_attribution 投影）。
  const rootCauseFactors = (baseDag?.nodes ?? []).filter((n) => n.kind === "factor").map((n) => n.label);
  // 其余因素（当前值·无逐日 series 源→灰点·不伪造 G-DM-1）。展示**所有有值因素**（含物流时长等低张力项）——
  // 用户要看全貌·不再按阈值隐藏（否则物流时长 61–69<70 被藏、看着像"缺数据"；灰点+当前值已诚实标"无逐日源"）。
  const others = (bnFactors ?? [])
    .filter((f) => f !== card.factor)
    .map((f) => ({ factor: f, value: bnRow?.tightness[f] ?? null }))
    .filter((x) => x.value != null)
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
            // WO-UNIT-MEANING：「62→83」原无量纲（易读成百分比）→ 带张力量程单源。
            sub={`${formatTightness(card.currentTightness?.value)}→${formatTightness(card.peak)} · ${card.crossDay != null ? `T+${card.crossDay} 越线` : "窗口内不越线"}`}
            color={tierColor(card.peak, threshold)}
            values={card.series}
            threshold={threshold}
            onDay={onDay}
            affectedByDay={affectedByDay}
          />
          {/* 其余因素：逐因素真逐日序列（治 #1/#3·per-factor tensionSeries）——每因素走与主因素**同一** tensionSeries
              机制、由该因素实测当前张力（liveTightness）起锚 + 确定性前瞻（riskTarget 爬坡 + 真事件脉冲）→ 真蓝→黄→红
              逐日梯度（非持平示意）。诚实：series 从真当前张力**派生**（非写死轨迹），卡级 provenanceSynthetic 已披露合成
              种子。无 factorSeries（旧后端/契约缺字段）时回落持平当前值 + 标"无逐日源"（向后兼容 R6·绝不伪造逐日变化）。 */}
          {others.map((o) => {
            const fs = card.factorSeries?.[o.factor];
            if (fs && fs.length > 0) {
              const peakF = Math.max(...fs);
              const crossIdx = fs.findIndex((v) => v >= threshold); // 0-based → 越线日 T+(idx+1)（与 card.crossDay 口径一致）
              return (
                <FactorRow
                  key={o.factor}
                  label={o.factor}
                  sub={`${formatTightness(o.value)}→${formatTightness(peakF)} · ${crossIdx >= 0 ? `T+${crossIdx + 1} 越线` : "窗口内不越线"}`}
                  color={tierColor(peakF, threshold)}
                  values={fs}
                  threshold={threshold}
                />
              );
            }
            // 回落（无 factorSeries）：持平当前值 + 诚实标"无逐日源"（向后兼容·绝不伪造逐日变化·G-DM-1）。
            return (
              <FactorRow
                key={o.factor}
                label={o.factor}
                sub={`当前 ${o.value != null ? Math.round(o.value) : "—"} · 持平示意（无逐日源）`}
                color={tierColor(o.value, threshold)}
                // 无逐日源 → 逐日全等于当前值：hi===lo → 全等高，诚实呈现"确实没有逐日变化"（不伪造起伏）。
                values={card.series.map(() => o.value)}
                threshold={threshold}
              />
            );
          })}
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

      {/* WO-DECISION-INFO-FE ①② · 决策信息两块（影响面 / 不作为后果）——挂在图例之后、根因树之前：
          用户读完"几号越线"，紧接着要问的就是「该不该管（落在谁身上）」与「不管会怎样」。
          两块都走各自的缺席/EMPTY 分支，绝不渲染空壳或 0（诚实位·本仓红线）。 */}
      <div className={styles.rkDet} style={{ marginTop: 12 }} data-testid={`decision-info-${card.base}`}>
        <div className={styles.rkDetH}>
          <b>🎯 {card.base} · 决策信息</b>
          <span>该不该管（影响面）· 不管会怎样（不作为后果）—— 数据源 risk_timeline.cards[].exposure / .doNothing</span>
        </div>
        <ExposurePanel exposure={card.exposure} baseName={card.base} />
        <DoNothingPanel doNothing={card.doNothing} baseName={card.base} />
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
        ga={ga}
        scopeBaseId={baseIdForScope}
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
          beforeValue={card.peak}
          baseGap={0}
          factors={[card.factor, ...bnFactors].filter((v, i, a) => !!v && a.indexOf(v) === i)}
          // 杠杆发现按 `scope.includes(o.id)` 逐对象过滤（datacore `service.ts discoverLevers`）→ 必须是真 objectId。
          scopeObjectIds={[baseObjectId(baseIdForScope)]}
          modelId={card.base}
          grain="process-model"
          targetType="Base"
          targetProp="weeklyCap"
          beforeLabel={zh.risk.live.leverBefore}
          adoptActionTypeKey="plan_change"
          snapshot={{ mode: "capacity", qty: 0, capWanP50: card.peak, capWanP90: card.peak, mainBn: card.factor }}
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
 * 请求失败时的**可观测事实**（只读 ApiClientError 的公开字段，不做任何推断）。
 * 拿不到结构化字段（网络层抛的裸 Error）→ 只回 message，宁可少说也不猜。
 */
function observedFailure(err: unknown): { status?: number; code?: string; requestId?: string; message: string } {
  if (err && typeof err === "object") {
    const e = err as { status?: unknown; code?: unknown; requestId?: unknown; message?: unknown };
    return {
      ...(typeof e.status === "number" ? { status: e.status } : {}),
      ...(typeof e.code === "string" ? { code: e.code } : {}),
      ...(typeof e.requestId === "string" ? { requestId: e.requestId } : {}),
      message: typeof e.message === "string" ? e.message : String(err),
    };
  }
  return { message: String(err) };
}

/**
 * CI-a 基地根因推演树面板。dag 存在 → 复用 <ProvenanceDag> 递归渲染结构+因果树（真求解器投影·R13/R14）；
 * 无树 → **诚实灰**。
 *
 * ⚠ 本面板的诚实纪律（曾经违反·把用户引偏过一次排查方向）：
 * 「诚实灰」诚实的只是「我没有数据」，**病因不是我能从这儿看出来的**。此前这里
 * ① 把 `loading` 和 error/空数据塞进同一个「暂不可用」块（请求还在飞，界面已宣告失败）；
 * ② 无条件渲染一行「补齐路径：gap_attribution 支持 base×factor 入参作用域后本树即活（仅缺引擎侧作用域）」——
 *    不分支、斩钉截铁，且**该结论早已过期**（本体 §8 `G-GAP-SCOPE` 已闭：`gapAttribution` 早就接受
 *    `scope.baseId/factorId`；本面板自己就在传 scope）。用户照着这句话去查引擎，而引擎是好的。
 * 现在：loading 独立成加载态（不出现"暂不可用"）；失败/空态**只陈述能从响应直接读出的事实**
 * （HTTP 状态码 / 错误码 / requestId / 响应里实际返回了哪些基地）；下一步动作按分支给且必带依据（错误码或字段名），
 * 不内联任何"引擎缺什么"的因果断言。
 */
function RootCausePanel({ base, factor, dag, loading, error, ga, scopeBaseId, rcFactor, onRcFactor }: {
  base: string; factor: string; dag: DagData | undefined; loading: boolean;
  /** 真错误对象（ApiClientError：status/code/requestId/message）——空态据此陈述事实，不做因果推断。 */
  error: unknown;
  /** 求解器原始返回（用于陈述"响应里实际有哪些基地"这类可观测事实）。 */
  ga: GapAttrOutput | undefined;
  /** 本次实际发出的 scope.baseId（可复现请求·让用户自己去核，而不是听我猜）。 */
  scopeBaseId: string;
  /**
   * WO-FACTOR-SCOPE-SINGLESOURCE：因子作用域**只收 id**（品牌类型）。
   * 候选集 **不再由调用方传入**——它是引擎回执 `ga.scope.availableFactors` 的投影（单一来源）。
   * 修前这里收一个 `factorOptions: string[]`，调用方拿卡面因子名去拼 ⇒ 传出去的值引擎一个都不认。
   */
  rcFactor: CausalFactorId | undefined; onRcFactor: (f: CausalFactorId | undefined) => void;
}) {
  const nodeCount = dag?.nodes.length ?? 0;
  const reqLine = `gap_attribution · scope.baseId=${scopeBaseId}${rcFactor ? ` · scope.factorId=${rcFactor}` : ""}`;
  // 响应里 L1 结构层实际返回了哪些节点（= "归因基地集"）——纯读响应字段，不推断。
  const l1Labels = (ga?.levels?.find((L) => L.depth === 1)?.nodes ?? []).map((n) => n.factor).filter(Boolean);
  // ── 因子 chip 候选：**引擎下发的可细分因子集**（单一来源·前端零拼装）──────────────────────
  // 只有引擎在本基地真解析到承载对象的因子才在这个列表里 ⇒ 界面上不存在「点了永远不生效」的按钮。
  const scope = ga?.scope;
  const factorOptions: RefinableFactor[] = scope?.availableFactors ?? [];
  // 传了因子但引擎明说没生效（词表不认 / 本基地无承载对象）——件四：这不能只是一行小字。
  const factorRejected = Boolean(rcFactor) && scope?.factorApplied === false;
  return (
    <div className={styles.rkDet} style={{ marginTop: 12 }} data-testid={`rootcause-panel-${base}`}>
      <div className={styles.rkDetH}>
        <b>
          🌳 {base} · 根因推演树
          {/* WO-UI-DECLUTTER-TOP3：「归因怎么算出来的」整段降进 `?` 浮层（规范 §1：浮层回答「凭什么」）。 */}
          <InfoPopover topic={zh.risk.info.rootcause} testId={`rootcause-how-${base}`}>
            <p>{zh.risk.info.rootcauseBody}</p>
          </InfoPopover>
        </b>
      </div>
      {/* WO-FACTOR-SCOPE-SINGLESOURCE · 因子作用域切换：chip 的**值 = CausalFactor.factorId**（引擎认的键），
          **显示 = label**（用户认得的因子名）；候选集来自引擎回执 `scope.availableFactors`，前端零拼装。
          修前显示什么就传什么（BN 中文因子名），引擎一个都不认 ⇒ 7 个按钮返回同一棵树。 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", margin: "2px 0 8px", fontSize: 12 }} data-testid="rootcause-factor-scope">
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
            key={f.factorId}
            className={`${styles.tierChip} ${rcFactor === f.factorId ? styles.tierChipOn : ""}`}
            data-testid={`rootcause-factor-${f.factorId}`}
            data-factor-label={f.label}
            title={zh.risk.live.rootcause.chipTitle(f.label, f.drillType, f.drillField, f.objectCount)}
            role="button"
            tabIndex={0}
            onClick={() => onRcFactor(f.factorId)}
            onKeyDown={(e) => e.key === "Enter" && onRcFactor(f.factorId)}
          >
            {zh.risk.live.rootcause.pick(f.label)}
          </span>
        ))}
        {/* 一个可细分因子都没有 → 据实说，而不是画一排点不动的按钮（件三：永远不生效的按钮比没有按钮更糟）。 */}
        {!loading && factorOptions.length === 0 ? (
          <span data-testid="rootcause-factor-none" style={{ color: "var(--muted2)" }}>
            {scope?.availableFactorsNote ?? zh.risk.live.rootcause.noneAvailable}
          </span>
        ) : null}
      </div>
      {/* 件四 · 兜底态表达强度：引擎明说「没按这个因子细分」时，必须是**用户不可能忽略**的形态
          （整条告警条 + 一键回到基地级），而不是树底下一行 10.5px 的小字 —— 旧形态见本文件
          `data-testid="rootcause-scope-note"` 那两个分支（fontSize: 12·灰字），是被漏看的那一行。
          复验：`apps/frontend-shell/test/caplive-cockpit.test.tsx` SEAM②b（断言 role=alert + 引擎原话 + 一键回基地级）。 */}
      {factorRejected ? (
        <div
          data-testid="rootcause-factor-rejected"
          role="alert"
          style={{
            display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
            border: "1px solid var(--danger)", borderRadius: 6, padding: "6px 10px", margin: "0 0 8px",
            background: "color-mix(in srgb, var(--danger) 10%, transparent)", fontSize: 12, lineHeight: 1.6,
          }}
        >
          <b style={{ color: "var(--danger-txt)" }}>{zh.risk.live.rootcause.notRefinedTitle}</b>
          <span>{scope?.factorNote ?? zh.risk.live.rootcause.notRefinedFallback(String(rcFactor))}</span>
          <span
            className={styles.tierChip}
            data-testid="rootcause-factor-reset"
            role="button"
            tabIndex={0}
            onClick={() => onRcFactor(undefined)}
            onKeyDown={(e) => e.key === "Enter" && onRcFactor(undefined)}
          >
            {zh.risk.live.rootcause.backToBase}
          </span>
        </div>
      ) : null}
      {loading ? (
        /* 加载态**独立**：请求还在飞，什么结论都还没有 → 只说"在取"，绝不出现"暂不可用"。 */
        <div className="empty-state" data-testid={`rootcause-loading-${base}`} style={{ fontSize: 12, lineHeight: 1.7, color: "var(--muted)" }}>
          <b style={{ color: "var(--muted2)" }}>正在取「{base}」的根因归因…</b>
          {/* 请求串是**调试信息**（规范 §1 第一层明确不许放）→ 降进折叠区；
              `<summary>` 本身就是规范 §1 要求的「可见记号」，一次点击即见，未删一字。 */}
          <details className={styles.rkDiag}>
            <summary className={styles.rkDiagSum}>{zh.risk.info.rootcauseDiag}</summary>
            <div style={{ marginTop: 6 }}>请求：<span className="mono">{reqLine}</span></div>
          </details>
        </div>
      ) : dag && nodeCount > 0 ? (
        <>
          <ProvenanceDag data={dag} />
          {/* WO-CAPACITY-PAGE-100PCT ③ · 作用域标注**以引擎回传的 scope 为准**（不再由前端假设"点了就细分了"）：
              factorApplied=true → 真按因子细分；传了因子但引擎无该因果域 → 据实说"未按该因子细分"并给引擎原话。 */}
          {/* 向后兼容（R6·不回归）：只有引擎**显式**回执 `factorApplied:false` 时才走"未细分"诚实注解；
              旧后端/桩不带 scope 字段（undefined）→ 维持原"已按因子细分"语义，既有 SEAM 测试零回归。 */}
          {rcFactor && !factorRejected ? (
            <div style={{ fontSize: 12, color: "var(--muted2)", lineHeight: 1.5, marginTop: 8 }} data-testid="rootcause-scope-note">
              {/* 引擎回执里的 factorLabel 优先（人话）；旧后端/桩不带 scope（undefined）→ 回落 id，语义不变 R6。 */}
              {zh.risk.live.rootcause.refined(scope?.factorLabel ?? String(rcFactor))}
            </div>
          ) : (
            /* WO-UI-DECLUTTER-TOP3：诚实位的**状态**（「未按因子细分」）留第一层；
               「怎么才能细分 / 数据源怎么算」这段口径降进 `?` 浮层。规范 §1：静默降层等于删除 ——
               故第一层仍看得见「未按因子细分」这个记号，浮层只承接解释。 */
            <div style={{ fontSize: 12, color: "var(--muted2)", lineHeight: 1.5, marginTop: 8 }} data-testid="rootcause-scope-note">
{zh.risk.live.rootcause.baseAggregatedShort}
              <InfoPopover topic={zh.risk.info.rootcause} testId={`rootcause-scope-${base}`}>
                <p>{zh.risk.info.rootcauseBody}</p>
                {/* canonical 原本把这整段口径直接渲染在第一层；本单把它降进浮层，
                    **不删**（D4 守恒）——仍走同一个 i18n 函数，不内联、不丢参数。 */}
                <p>{zh.risk.live.rootcause.baseAggregated(factor)}</p>
              </InfoPopover>
            </div>
          )}
        </>
      ) : (
        <div className="empty-state" data-testid={`rootcause-gap-${base}`} style={{ fontSize: 12, lineHeight: 1.7, color: "var(--muted)" }}>
          <b style={{ color: "var(--muted2)" }}>根因推演树无数据（诚实灰·未伪造过程）</b>
          {/*
            WO-UI-DECLUTTER-TOP3（规范 §1：第一层不许放「诊断信息 · 调试信息」）：
            诚实位的**结论**（上面那句「无数据·未伪造过程」）留在第一层；
            请求串 / HTTP 状态码 / 错误码 / requestId / 响应字段路径 / 排查下一步 —— 这些是**诊断**，
            整块降进折叠区。`<summary>` 即规范 §1 要求的「可见记号」，**一字未删**（§1 红线：允许降层，绝不允许删除）。
          */}
          <details className={styles.rkDiag} data-testid={`rootcause-diag-${base}`}>
            <summary className={styles.rkDiagSum}>{zh.risk.info.rootcauseDiag}</summary>
            <div style={{ marginTop: 6 }}>请求：<span className="mono">{reqLine}</span></div>
            {error ? (
            /* 失败态：只报响应里读得出的东西——HTTP 状态码、错误码、requestId、后端 message。不猜原因。 */
            (() => {
              const f = observedFailure(error);
              return (
                <>
                  <div style={{ marginTop: 4 }} data-testid={`rootcause-fact-${base}`}>
                    观测到：请求失败
                    {f.status != null ? ` · HTTP ${f.status}` : ""}
                    {f.code ? ` · 错误码 ${f.code}` : ""}
                    {f.requestId ? ` · requestId ${f.requestId}` : ""}
                    {f.message ? ` · 后端 message：${f.message}` : ""}
                  </div>
                  <div style={{ marginTop: 4, color: "var(--muted2)" }} data-testid={`rootcause-next-${base}`}>
                    {/* 下一步按分支给，依据 = 上面那个错误码本身，不内联任何"引擎缺什么"的结论。 */}
                    下一步：以上面的<b>错误码</b>
                    {f.requestId ? "与 requestId " : ""}
                    在 DataCore 侧核对该次 <span className="mono">/a/v1/solvers/gap_attribution/invoke</span> 调用；
                    错误码含义以后端错误信封 <span className="mono">{"{error:{code,message,requestId}}"}</span> 为准。
                  </div>
                </>
              );
            })()
          ) : !ga ? (
            <div style={{ marginTop: 4 }} data-testid={`rootcause-fact-${base}`}>
              观测到：请求已完成但<b>响应体为空</b>（无 data）。
            </div>
          ) : (
            <>
              <div style={{ marginTop: 4 }} data-testid={`rootcause-fact-${base}`}>
                观测到：响应已返回（归因指标 <span className="mono">{ga.rootMetric?.key ?? "—"}</span>），但结构层（levels.depth=1）
                的 {l1Labels.length} 个节点里<b>没有「{base}」</b>
                {l1Labels.length > 0 ? <>——本次返回的是：<span className="mono">{l1Labels.join("、")}</span></> : "（结构层为空）"}。
              </div>
              <div style={{ marginTop: 4, color: "var(--muted2)" }} data-testid={`rootcause-next-${base}`}>
                {/* 依据 = 上面列出的字段名 levels[0].nodes[].factor 与本基地名，不做"谁的锅"的因果断言。 */}
                下一步：比对本卡基地名与响应 <span className="mono">levels[depth=1].nodes[].factor</span> 的取值是否同名；
                若确实不在该集合内，则本窗口下该基地无结构归因份额可展开。
              </div>
            </>
            )}
          </details>
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
        {!hasLive && <span style={{ fontSize: 12, color: "var(--muted2)" }}>{zh.risk.live.scenario.saveEmpty}</span>}
      </div>

      {scenarios.length === 0 ? (
        <div className="empty-state" data-testid="caplive-scenario-empty" style={{ fontSize: 12 }}>{zh.risk.live.scenario.empty}</div>
      ) : (
        <>
          <table className="cmp" data-testid="caplive-scenario-list" style={{ fontSize: 12 }}>
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
                  <td className="zh"><b>{s.name}</b>{s.parentId && <span className="badge" style={{ marginLeft: 5, fontSize: 12 }}>分支</span>}</td>
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
            <span style={{ fontSize: 12, color: "var(--muted2)" }}>{zh.risk.live.scenario.pickHint}</span>
          </div>

          {/* 横比矩阵：各格 = 各方案 generic_inference 真算（改方案 apply → 矩阵变·KILL-MOCK）。 */}
          {matrix && matrix.rows.length > 0 && (
            <table className="cmp" data-testid="caplive-scenario-matrix" style={{ fontSize: 12 }}>
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
          <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 6 }} data-testid="caplive-scenario-gate-note">
            {zh.risk.live.scenario.adopted}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 逐日点的**双通道编码**（治「30 个点只表达 1 个 bit」）。
 *
 * ── 取证（信阳·30 天·seed 42·`risk_timeline` 真调）──
 * 后端逐日值**是真的逐日变化**：瓶颈工序 91,91,92,…,96,97,97.72,97.85,97.95,97.94,… 共 15 个不同值；
 * 设备OEE 14 个、人力工时 16 个。**丢信息的是渲染层**：旧 `heatColor(v,threshold)` 对 `v ≥ threshold`
 * 一律返回同一个 `rgba(224,98,108,.85)`、对 `[threshold−15, threshold)` 一律同一个黄——三个全程 ≥85 的因子
 * 于是 30 个点同色（零信息量），低张力因子则只有「蓝一段/黄一段」一次跳变。
 *
 * 现在：
 * - **颜色通道**：三档 hue 不动（图例口径不变：≥阈值红 / 关注黄 / 正常青），但**档内不透明度随真值连续变化**；
 * - **高度通道（非颜色）**：柱高 = 该日值在**本行自身值域** `[lo,hi]` 中的相对位置——即使整行全红，
 *   "哪天开始爬 / 哪天到顶 / 还有几天可干预"也直接看得出（色觉障碍同样可读）。
 * 值恒定的行（无逐日源的回落态）→ `hi===lo` → 全等高，诚实呈现"确实没有逐日变化"，不伪造起伏。
 */
function dotVisual(v: number | null, threshold: number, lo: number, hi: number): { color: string; fill: number } {
  if (v == null) return { color: "rgba(138,148,166,.28)", fill: 0.16 };
  const hue = v >= threshold ? "224,98,108" : v >= threshold - BAND ? "232,181,74" : "67,183,215";
  const t = hi > lo ? (v - lo) / (hi - lo) : 1; // 本行值域内的相对位置 0..1
  return { color: `rgba(${hue},${(0.34 + t * 0.62).toFixed(3)})`, fill: 0.24 + t * 0.76 };
}

/**
 * 单因素时间轴行（.rk-frow）：168px 标签 + 逐日柱。主因素柱可点→受影响订单。
 * `values` 是该因素的真逐日张力（求解器 series/factorSeries 原值·前端不再预先压成颜色）。
 */
function FactorRow({ label, sub, color, values, threshold, onDay, affectedByDay }: {
  label: string; sub: string; color: string; values: (number | null)[]; threshold: number; onDay?: (day: number) => void;
  /** CT-a（⑤）：逐日受影响订单数（index=day·与 onDay/AffectedOrdersModal 同源）。>0 的日叠交付 icon。 */
  affectedByDay?: number[];
}) {
  const nums = values.filter((v): v is number => v != null);
  const lo = nums.length > 0 ? Math.min(...nums) : 0;
  const hi = nums.length > 0 ? Math.max(...nums) : 0;
  return (
    <div className={styles.rkFrow} data-testid={`risk-frow-${label}`} data-span={nums.length > 0 ? `${lo}~${hi}` : undefined}>
      <div className={styles.rkFlab}>
        <b style={{ color }}>{label}</b>
        <span>{sub}</span>
      </div>
      <div className={styles.rkDots}>
        {values.map((v, i) => {
          const nAff = affectedByDay?.[i] ?? 0; // CT-a：该日受影响订单数（同源真数据·非写死）
          const { color: dc, fill } = dotVisual(v, threshold, lo, hi);
          // WO-UNIT-MEANING：逐日点 tooltip 带张力量程（单源）。顶端压缩带里 formatTightness 会把
          // 97.95/97.55 都四舍五入成同一个「98」→ 额外附**未取整真值**，让"哪天最重"在 hover 里也读得出。
          const exact = v != null && !Number.isInteger(v) ? `（精确 ${v.toFixed(2)}）` : "";
          const dotTitle = v != null ? `D+${i + 1} · ${formatTightness(v)}${exact}` : `D+${i + 1} · 无实测`;
          const title = nAff > 0 ? `${dotTitle} · ${nAff} 单交付受影响` : dotTitle;
          return (
            <button
              key={i}
              className={styles.rkDot}
              style={{
                background: "transparent",
                position: "relative",
                overflow: "visible",
                height: 20,
                borderRadius: 3,
                display: "flex",
                alignItems: "flex-end",
              }}
              /*
               * ═══ 规范 §4 豁免声明（§4「豁免要在代码注释里写明理由」）═══
               *
               * **豁免对象**：逐日张力条上**每个日格**的原生 `title=`（全页仅此一处保留）。
               *
               * **理由（换成真浮层会更糟，不是不想换）**：本条是 30 / 60 / 90 个日格的密集时序带，
               *   每格宽约 6px。规范 §2 要的 `?` 触发器在这里落不下 —— 真要落，就是一屏 90 个 `?`，
               *   那恰好是规范 §0 反对的「第一层堆料」，比原生 tooltip 更违规范。
               *   本页其余 5 处原生 `title=` 已全部换成 `InfoPopover` / `aria-label`（见上方各处注释），
               *   只有这一处的**几何**不允许。
               *
               * **不适用规范 §2 点名的那次事故**：那次是 `ChainLineMapView.tsx` 的 **SVG `<title>`**
               *   在环形图上滞留并遮挡图形本身。本处是 HTML `<div>` 的 `title` 属性，不进 SVG 绘制层、
               *   不参与图形合成，无遮挡路径。
               *
               * **诚实位不丢**：`aria-label` 同值并存 —— 读屏与键盘用户不靠 hover 也拿得到这个数。
               *
               * **有测试咬住**：`risk-honest-gray-and-daily.test.tsx:201`、
               *   `risk-order-delivery-icon.test.tsx:61`、`f23.order-chain.test.tsx:82`
               *   三处断言这个 `title` 的内容 —— 它承载的是**数值**（当日张力 / 受影响单数），
               *   按规范 §1 本就属第一层，只是借 tooltip 做了逐格投递。
               */
              title={title}
              aria-label={title}
              data-testid={onDay ? `risk-dot-${i}` : undefined}
              data-affected={nAff > 0 ? nAff : undefined}
              data-value={v != null ? String(v) : undefined}
              data-fill={v != null ? String(Math.round(fill * 100)) : undefined}
              onClick={onDay ? () => onDay(i) : undefined}
            >
              {/* 高度通道：柱高编码真值（非颜色通道·全红行也有形状）。 */}
              <i
                aria-hidden="true"
                style={{ display: "block", width: "100%", height: `${Math.round(fill * 100)}%`, minHeight: 3, background: dc, borderRadius: 2 }}
              />
              {nAff > 0 && (
                // ⑤ 订单交付受影响 icon（该日 affected_orders 非空·同源）——小三角挂在点上方，一眼可辨。
                <span
                  aria-hidden="true"
                  data-testid={`risk-dot-order-${i}`}
                  style={{ position: "absolute", top: -7, left: "50%", transform: "translateX(-50%)", fontSize: 12, lineHeight: 1, color: "var(--ink, #e8b54a)", pointerEvents: "none" }}
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
  const { data, isLoading, error: mitError } = useQuery({
    queryKey: ["a", "mitigation_select", base, factor, tightness],
    queryFn: async () => {
      const res = await invokeSolver("mitigation_select", { baseName: base, factor, tightness });
      return res.data as { plans?: MitPlan[]; recommended?: string; error?: string };
    },
  });
  // 同纪律：请求失败 ≠ "没有对症方案"。失败时报可观测事实（状态码/错误码/requestId），不显示成"无"。
  const mitFail = mitError ? observedFailure(mitError) : null;
  const plans = data?.plans ?? [];
  const recommended = data?.recommended;
  // 综合评分降序 = 求解器优选序（真出处·排名供「为何推荐」）。
  const ranked = [...plans].sort((a, b) => b.score - a.score);
  const rankOf = (key: string) => ranked.findIndex((p) => p.key === key) + 1;
  const matched = matchRiskFactorToRootCause(factor, rootCauseFactors);

  return (
    <div>
      {/*
        WO-UI-DECLUTTER-TOP3 · 本页第一层最刺眼的一条（普查点名）：
        「为什么推荐？综合评分 = 见效 × 紧迫度 ÷（投入档 × 周期）」——**口径公式**摆在第一层，
        正是规范 §2 R-UI-3 原文点名的 `A × B ÷ C` 形态。连同「④ 采纳经 adopt_mitigation…」
        这条流程说明一起降进本 `?` 浮层；第一层只留结论（谁分最高）与那张比对矩阵的数字。
      */}
      <div className={styles.wfT} style={{ color: "var(--ok-txt)" }}>
        💡 对症方案 · 比对推演 · {factor}（{plans.length} 个）
        <InfoPopover topic={zh.risk.info.score} testId="mitigation-score-calc">
          <p>{zh.risk.info.scoreBody}</p>
          <p>{zh.risk.info.adoptGateBody}</p>
        </InfoPopover>
      </div>
      {isLoading ? (
        <div style={{ color: "var(--muted2)", fontSize: 12 }}>{zh.common.loading}</div>
      ) : mitFail ? (
        <div className="empty-state" style={{ fontSize: 12 }} data-testid="mitigation-error">
          mitigation_select 请求失败
          {mitFail.status != null ? ` · HTTP ${mitFail.status}` : ""}
          {mitFail.code ? ` · 错误码 ${mitFail.code}` : ""}
          {mitFail.requestId ? ` · requestId ${mitFail.requestId}` : ""}
          {mitFail.message ? ` · ${mitFail.message}` : ""}
        </div>
      ) : !plans.length ? (
        <div className="empty-state" style={{ fontSize: 12 }} data-testid="mitigation-empty">{zh.common.none}</div>
      ) : (
        <>
          {/* ② score 拆解 = 跨方案比对矩阵（非单一数字·真出处 mitigation_select.plans[]）：一眼见谁综合分最高·为何。
              评分公式已降进上方「综合评分口径」`?` 浮层（规范 R-UI-3），此处只留排序事实。 */}
          <div style={{ fontSize: 12, color: "var(--muted)", margin: "2px 0 5px" }}>评分降序</div>
          <table className="cmp" data-testid="mitigation-matrix" style={{ fontSize: 12, marginBottom: 10 }}>
            <thead>
              <tr><th>方案</th><th>见效(pp)</th><th>周期(周)</th><th>投入</th><th>风险</th><th>综合评分</th></tr>
            </thead>
            <tbody>
              {ranked.map((p) => (
                <tr key={p.key} data-testid={`mitigation-matrix-row-${p.key}`} style={p.key === recommended ? { background: "rgba(98,190,119,.12)" } : undefined}>
                  <td className="zh"><b>{p.name}</b>{p.key === recommended && <span className="badge" style={{ marginLeft: 5, background: "var(--ok)", color: "#0a1f12", fontSize: 12 }}>推荐</span>}</td>
                  <td className="mono" data-testid={`mitigation-eff-${p.key}`} style={{ color: "var(--ok-txt)" }}>{p.eff}</td>
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
                    {p.key === recommended && <span className="badge" style={{ marginLeft: 6, background: "var(--ok)", color: "#0a1f12", fontSize: 12 }}>推荐</span>}
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
                    ① 对症根因：{matched ? <>直指根因树「<b style={{ color: "var(--c-solver-txt)" }}>{matched}</b>」</> : <>针对越线因子「{factor}」<span style={{ color: "var(--muted2)" }}>（根因树未见对齐的结构节点·据实）</span></>}
                  </span>
                  <span>② 评分构成：见效 {p.eff}pp · 周期 {p.tn}周 · 投入 {p.cost} · 风险 {p.risk ?? "—"} → 综合 <b>{p.score}</b>（{p.key === recommended ? "全案最高·故推荐" : `第 ${rankOf(p.key)} 名`}）</span>
                  <span data-testid={`mitigation-block-${p.key}`}>
                    ③ 预期堵口：峰值张力 {Math.round(tightness)} − 见效 {p.eff}pp → <b style={{ color: clears ? "var(--ok-txt)" : "var(--danger-txt)" }}>{after}</b>
                    {/* 数据来源（`mitigation_select.eff`）按规范 §1 属浮层「凭什么」那一层，已收进
                        上方「综合评分口径」浮层；第一层只留堵口后的**数值**与是否消解的**状态**。 */}
                    {clears ? `（预计消解越线·<阈值 ${threshold}）` : `（仍越线·需叠加方案）`}
                  </span>
                </div>
              </div>
            );
          })}
          {/* 「采纳之后会发生什么」这段流程说明已降进上方「综合评分口径」浮层；
              第一层保留链路名本身（adopt_mitigation → Action 审批）——那是**名字**，属第一层。 */}
          <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 6 }} data-testid="mitigation-gate-note">
            ④ 采纳经 <b>adopt_mitigation</b> → Action 审批（C5）
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
      <div className={styles.wfT} style={{ color: "var(--c-capacity-txt)" }}>{zh.risk.qa.title}</div>
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
      {/* WO-UI-DECLUTTER-TOP3：诚实位「这不是智能问答」降进 `?` 浮层，
          第一层留 `?` 记号（规范 §1：静默降层等于删除 —— 记号不能省）。 */}
      <div data-testid="risk-qa-disclosure" style={{ marginTop: 6, fontSize: 12, color: "var(--muted2)", lineHeight: 1.5 }}>
        <InfoPopover topic={zh.risk.info.qa} testId="risk-qa-disclosure-info">
          <p>{zh.risk.qa.disclosure}</p>
          <p>{zh.risk.qa.intro}</p>
        </InfoPopover>
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
      {/*
        WO-UI-DECLUTTER-TOP3（规范 §1：**逐项明细属第二层**，第一层只放结论/数值/名字）：
        历史案例表是 7 列 × N 行的**明细**，本页的问题是「未来会不会越线」，历史是佐证不是结论。
        故整表降到一次点击之后；第一层留「N 例 · 越线 → 采纳 → 消解」这个**数值 + 名字**，
        `<summary>` 即规范 §1 要求的可见记号。表内容一行未删（§1 红线）。
      */}
      <details className={styles.rkCases} data-testid="risk-cases-disclosure">
        <summary className="section-title">历史处置案例（{cases.length} 例 · 越线 → 采纳 → 消解）</summary>
        <table className="cmp" data-testid="risk-cases-table">
        <thead>
          {/* 末列此前只出一个裸数「3」——列名「受影响订单」不足以说明是**批数**还是套数，故列头带单位（与 §7.3 台账「N 批」同口径）。 */}
          <tr><th>编号</th><th>案例</th><th>因子</th><th>越线日</th><th>采纳处置</th><th>消解日</th><th>受影响订单(批)</th></tr>
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
      </details>
      {replay && <CaseReplayModal kase={replay} onClose={() => setReplay(null)} />}
    </div>
  );
}

/** 案例点击 → 回放当时的时序曲线（curve = query_timeseries_agg 参数，数字与回放写入同源）。 */
function CaseReplayModal({ kase, onClose }: { kase: HistoryRiskCase; onClose: () => void }) {
  // 回放口径三元组（与下面 queryTimeseriesAgg 的入参**同一常量**，避免图注与真实请求漂移）。
  const CURVE_AGG = "sum" as const;
  const CURVE_GRAIN = "day" as const;
  const { data } = useQuery({
    queryKey: ["a", "case-replay", kase.id],
    queryFn: () => queryTimeseriesAgg({ seriesKey: kase.curve.seriesKey, entityIds: [kase.curve.entityId], window: { from: kase.curve.from, to: kase.curve.to, grain: CURVE_GRAIN }, agg: CURVE_AGG }),
  });
  const points = data?.points ?? [];
  // WO-UNIT-MEANING · 纵轴口径：此前 y 轴是纯裸数值（「38000」既可能是套数也可能是 OEE%）。
  // 单源现状：`QueryTimeseriesAggOutput.points[]` 只有 {entityId,bucket,value}，**没有 unit 字段**，
  // `RiskCaseSchema.curve` 也只给 seriesKey——契约里没有 seriesKey→单位的字典可消费。故此处**不臆造单位**，
  // 而是标注可核验的真口径：序列键 + 聚合方式 + 粒度 + 实体（单位随该序列定义走，由 seriesKey 唯一确定）。
  // 收敛路径：后端 /a/v1/timeseries/agg-query 回传 series.unit（或 contracts 出 SERIES_UNITS 字典）后，此处改为直接消费。
  const yAxisCaption = `纵轴：序列 ${kase.curve.seriesKey} · 按${CURVE_GRAIN === "day" ? "日" : CURVE_GRAIN}${CURVE_AGG === "sum" ? "合计" : CURVE_AGG} · 实体 ${kase.curve.entityId}`;
  return (
    <Modal title={`${kase.caseNo} · ${kase.title}`} onClose={onClose} width={760}>
      <div data-testid="case-replay-modal">
        <div className="section-title">当时的时序曲线（{kase.curve.from} ~ {kase.curve.to}）</div>
        <div data-testid="case-replay-axis-caption" style={{ fontSize: 12, color: "var(--muted2)", marginBottom: 2 }}>
          {yAxisCaption}
          <span style={{ marginLeft: 6 }}>（量纲随该序列定义·接口未回传 unit 字段，故只标口径不臆造单位）</span>
        </div>
        <EChart
          height={180}
          testId="case-replay-curve"
          option={{
            grid: { top: 22, bottom: 28, left: 48, right: 12 },
            tooltip: { trigger: "axis" },
            xAxis: { type: "category", data: points.map((p) => p.bucket.slice(0, 10)), name: "日期", nameLocation: "end" },
            // 轴名 = 真口径（seriesKey·聚合·粒度），浏览器里贴在 y 轴顶端；jsdom 无 canvas 故同文案另以 caption 落 DOM。
            yAxis: { type: "value", name: `${kase.curve.seriesKey}（${CURVE_GRAIN === "day" ? "日" : CURVE_GRAIN}${CURVE_AGG === "sum" ? "合计" : CURVE_AGG}）`, nameTextStyle: { fontSize: 12 }, splitLine: { lineStyle: { color: "rgba(226,235,245,.07)" } } },
            series: [{ name: kase.curve.seriesKey, type: "line", smooth: true, data: points.map((p) => p.value), itemStyle: { color: "#43B7D7" }, markLine: { data: [{ xAxis: kase.crossedAt, label: { formatter: "越线" } }, { xAxis: kase.adoptedAt, label: { formatter: "采纳" } }, { xAxis: kase.resolvedAt, label: { formatter: "消解" } }] } }],
          }}
        />
        <div className="section-title" style={{ marginTop: 10 }}>处置时间线</div>
        <div data-testid="case-timeline" style={{ display: "grid", gap: 4, fontSize: 12 }}>
          {kase.timeline.map((t, i) => (<div key={i}><span className="mono">{t.date}</span> · <span className="zh">{t.event}</span></div>))}
        </div>
        {kase.affectedOrders.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12 }} data-testid="case-affected-orders">
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
