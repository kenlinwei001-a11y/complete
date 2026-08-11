import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { OrderProblemGroup } from "@platform/contracts";
import { SEG_REGISTRY, formatTightness } from "@platform/contracts";
import { runSolver, queryObjectsPaged } from "@/api/endpoints";
import { useSessionStore } from "@/store/sessionStore";
import { RiskHoverTrigger } from "@/components/Risk/RiskPopover";
import { LayeredDag, type DagEdgeDef, type DagNodeDef } from "@/components/Dag/LayeredDag";
import { useActionDraft } from "../sim/shared";
import { Provenance } from "@/components/Provenance";
import type { AffectedOrderRowVM, AffectedOrdersOutputVM } from "@/api/types";
import type { ViewRendererProps } from "../registry";
import { fmt, SnapshotBadge } from "../sim/shared";
import { InferenceProcessPanel } from "@/components/InferenceProcessPanel";
import zh from "@/locales/zh";
import simStyles from "../sim/SimViews.module.css";
import styles from "./PlanViews.module.css";

// DF.3 单一来源：SEG 配色/价/利从 @platform/contracts SEG_REGISTRY 派生（与 datacore 同源）。
const SEG_COLOR: Record<string, string> = Object.fromEntries(SEG_REGISTRY.map((s) => [s.seg, s.color]));
const CHIP_LIMIT = 4;

// PRD-IND-order-aggregate §4.5-A/C：经营数据看板 econTable 口径。
// 假3 修（KILL-MOCK）：删 hashN + 写死 coef 现编库存。产能=真订单量；营收/毛利=量×SEG_REGISTRY 参考单价/毛利率
// （可溯·R6 单一真相源·估算口径·缺数诚实 0）；成品/在制/原料库存平台暂无该维度真源 → 诚实"—"（抄 OrderAggView·G-DM-1）。
// view.layout 优先下发，常量仅兜底（R14）；ordEcon 逐订单派生、按应用细分聚合。
const ECON_DEFAULT = {
  segPrice: Object.fromEntries(SEG_REGISTRY.map((s) => [s.seg, s.priceWan])) as Record<string, number>, // DF.3 单一来源（万元/套）
  segMargin: Object.fromEntries(SEG_REGISTRY.map((s) => [s.seg, s.marginPct / 100])) as Record<string, number>, // DF.3 单一来源（%→分数）
};
const SEG_ORDER = ["乘用车", "商用车", "储能"]; // debattery-allow：econ 看板细分行展示顺序（非业务数值）

/** 假3：econ 逐格 Provenance 作者标注（抄 LedgerView）——产能=真值；营收/毛利/毛利率=SEG 参考价估算口径，据实披露。 */
const ECON_PROV: Record<"cap" | "sales" | "gp" | "gmRate", { src: string; formula: string; inputs: string[]; note: string }> = {
  cap: { src: "affected_orders 求解器（订单域）", formula: "未结产能 = Σ 受影响订单.数量（套）", inputs: ["受影响订单数量"], note: "真值 · affected_orders 逐单数量聚合" },
  sales: { src: "affected_orders × SEG_REGISTRY", formula: "营收(亿) = Σ 数量 × SEG 参考单价(万元/套) ÷ 1e4", inputs: ["受影响订单数量", "SEG_REGISTRY 参考单价"], note: "估算口径 · SEG 参考单价（合约域单一来源）非逐单实际成交价" },
  gp: { src: "affected_orders × SEG_REGISTRY", formula: "毛利(亿) = 营收 × SEG 参考毛利率", inputs: ["营收", "SEG_REGISTRY 参考毛利率"], note: "估算口径 · SEG 参考毛利率非财务实测值" },
  gmRate: { src: "派生", formula: "毛利率 = 毛利 ÷ 营收 × 100%", inputs: ["毛利", "营收"], note: "估算口径 · 随 SEG 参考单价/毛利率派生" },
};
/** 逐格：把 econ 数字包 Provenance（缺真源的库存列另走诚实"—"，不进此列）。 */
function econCell(kind: keyof typeof ECON_PROV, value: number, tid: string, pct = false) {
  const p = ECON_PROV[kind];
  return (
    <td className="mono">
      <Provenance testId={tid} src={p.src} formula={p.formula} inputs={p.inputs} note={p.note}>
        <span>{fmt(value, 1)}{pct ? "%" : ""}</span>
      </Provenance>
    </td>
  );
}

interface EconAgg {
  cap: number;
  sales: number;
  gp: number;
}

/** 问题类别 → 中文（4 类归并：交期/毛利/齐套/信用） */
const CATEGORY_LABEL: Record<OrderProblemGroup["category"], string> = {
  DELIVERY: "交期",
  MARGIN: "毛利",
  KIT: "齐套",
  CREDIT: "信用",
};

/** 根因链四层着色：订单 → 判定 → 根因 → 对策 */
const CHAIN_COLORS = ["#7E8BEE", "#E8B54A", "#DD7E9E", "#62BE77"];
const CHAIN_TITLES = ["订单", "判定", "根因", "对策"];
/** 契约 `OrderRootChainSchema.layers[].kind` 枚举顺序 —— 与 CHAIN_TITLES 逐位对应（层名单一来源，不再抄第二份）。 */
const LAYER_KINDS = ["order", "judgement", "rootCause", "remedy"] as const;
type LayerKind = (typeof LAYER_KINDS)[number];
const LAYER_KIND_LABEL = Object.fromEntries(LAYER_KINDS.map((k, i) => [k, CHAIN_TITLES[i]!])) as Record<LayerKind, string>;

// ---------------------------------------------------------------------------
// WO-ORDER-ROW-DETAIL · 内联展开原语（**可复用**：表内行展开 / 网格卡展开共用同一面板体）
// 关键约束：展开体必须渲染在被点节点的**紧邻下一个兄弟**位置（相对位置即语义），
// 不浮层、不跳页、不挂到容器末尾；表内 colSpan 由调用方从表头列定义**现算**传入，禁止写死。
// ---------------------------------------------------------------------------

/** 表内联展开行：`<tr><td colSpan>`。colSpan 必须由调用方按表头列数现算（`COLS.length`）。 */
export function InlineDetailRow({ colSpan, testId, children }: { colSpan: number; testId: string; children: ReactNode }) {
  return (
    <tr className={styles.inlineRow} data-testid={testId} data-inline-detail="row">
      <td colSpan={colSpan}>{children}</td>
    </tr>
  );
}

/** 网格内联展开项：整行贯通（`grid-column: 1 / -1`），渲染在被点卡片的紧邻下一个兄弟。 */
export function InlineDetailGridItem({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div className={styles.inlineGridItem} style={{ gridColumn: "1 / -1" }} data-testid={testId} data-inline-detail="grid">
      {children}
    </div>
  );
}

/** 两种宿主共用的展开面板体（标题 + 右上动作区 + 正文）。 */
export function InlineDetailPanel({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.inlinePanel}>
      <div className={styles.inlinePanelHead}>
        <span>{title}</span>
        {actions}
      </div>
      {children}
    </div>
  );
}

/** 展开面板里的「标签 + 值」字段格。 */
function InlineField({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className={styles.inlineField}>
      <span className={styles.inlineFieldLabel}>{label}</span>
      <span data-testid={testId}>{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 追加需求 · 问题卡「归因分析叙述」派生（**零写死 R14**）
// 铁律：每句叙述必须绑定 `affected_orders.problems[]` 的具体字段——同一份 rootChains 既画图（ProblemDag）
// 又讲话（本函数），**不另调接口、不造第二套因果**。推不出的层一律进 gaps 诚实披露，绝不用通顺空话补齐。
// ---------------------------------------------------------------------------

export interface NarrLine {
  key: string;
  text: string;
  /** 该句所绑字段的取值路径（进 <Provenance> 推导公式，肉眼可查出处）。 */
  formula: string;
  inputs: string[];
  note: string;
}
export interface ProblemNarrative {
  lines: NarrLine[];
  gaps: string[];
}

/**
 * problems[] 一组 → 归因叙述 + 缺口清单。纯函数、无副作用、不读全局，数字与名字全部来自入参字段。
 * @param g 求解器回传的问题组（未做任何前端加工）
 * @param categoryLabel 类别中文名（来自 ViewConfig.layout.categoryLabels，非内联行业名）
 */
export function deriveProblemNarrative(g: OrderProblemGroup, categoryLabel: string): ProblemNarrative {
  const lines: NarrLine[] = [];
  const gaps: string[] = [];

  // ① 规模句：orderCount / financeImpact 逐字段搬运（不四舍五入到别的口径——financeImpact 沿用卡面同一 toFixed(1)）
  lines.push({
    key: "scale",
    text: zh.orderChain.narrScale(categoryLabel, g.title, g.orderCount, g.financeImpact.toFixed(1)),
    formula: "problems[].category → categoryLabels · problems[].title · problems[].orderCount · problems[].financeImpact",
    inputs: ["problems[].orderCount", "problems[].financeImpact"],
    note: "逐字段搬运求解器输出，无二次加工",
  });

  // ② 共性根因句：rootCauseSummary 原文；空则进缺口（不用同义句糊过去）
  if (g.rootCauseSummary.trim()) {
    lines.push({
      key: "common",
      text: zh.orderChain.narrCommon(g.rootCauseSummary),
      formula: "problems[].rootCauseSummary",
      inputs: ["problems[].rootCauseSummary"],
      note: "求解器归并结论原文搬运",
    });
  } else {
    gaps.push(zh.orderChain.narrGapNoSummary);
  }

  // ③ 逐单因果句：**按 kind 取层**（不按下标——下标顺序变了就会张冠李戴），缺任一跳则该单进缺口、不出句
  if (g.rootChains.length === 0) gaps.push(zh.orderChain.narrGapNoChains);
  for (const c of g.rootChains) {
    const byKind = new Map(c.layers.map((l) => [l.kind, l.label]));
    const need: LayerKind[] = ["judgement", "rootCause", "remedy"];
    const missing = need.filter((k) => !(byKind.get(k) ?? "").trim());
    if (missing.length > 0) {
      gaps.push(zh.orderChain.narrGapLayer(c.orderId, missing.map((k) => LAYER_KIND_LABEL[k]).join("/")));
      continue;
    }
    lines.push({
      key: `chain-${c.orderId}`,
      text: zh.orderChain.narrChain(c.orderId, byKind.get("judgement")!, byKind.get("rootCause")!, byKind.get("remedy")!),
      formula: `problems[].rootChains[orderId=${c.orderId}].layers[kind=judgement/rootCause/remedy].label`,
      inputs: ["rootChains[].orderId", "rootChains[].layers[].label"],
      note: "逐层 label 原文搬运；判定/根因/对策 = 契约 layers[].kind 枚举，非前端编派",
    });
  }

  // ④ 覆盖度句 + 缺口：rootChains 条数 vs orderCount —— 少的那几单**明说推不出**，不拿共性根因顶替
  lines.push({
    key: "coverage",
    text: zh.orderChain.narrCoverage(g.rootChains.length, g.orderCount),
    formula: "problems[].rootChains.length / problems[].orderCount",
    inputs: ["problems[].rootChains.length", "problems[].orderCount"],
    note: "覆盖度为派生比值；分子分母均为响应字段",
  });
  if (g.rootChains.length < g.orderCount) gaps.push(zh.orderChain.narrGapPartial(g.orderCount - g.rootChains.length, g.orderCount));

  return { lines, gaps };
}

/**
 * 受影响订单明细表**列定义单一来源**：表头由它渲染，展开行 colSpan = 它的长度（现算）。
 * 加列/删列只改这一处，展开行自动跟随——写死 colSpan 那种改一处漏一处的坑在此关掉。
 */
const DETAIL_COLS = [
  zh.orderChain.colOrder,
  zh.orderChain.colCust,
  zh.orderChain.colSeg,
  zh.orderChain.colModel,
  zh.orderChain.colQty,
  zh.orderChain.colDue,
  zh.orderChain.colRisks,
  zh.orderChain.colDelay,
  zh.orderChain.colCtx,
] as const;

/** 逐单营收暴露的溯源标注（口径与 econ 看板同源，但**分母是单张订单**故单列一份，不复用 Σ 版公式）。 */
const ROW_ECON_PROV = {
  src: "affected_orders × SEG_REGISTRY",
  formula: "本单营收暴露(亿) = rows[].qty(套) × SEG 参考单价(万元/套) ÷ 1e4",
  inputs: ["rows[].qty", "SEG_REGISTRY 参考单价"],
  note: "估算口径 · SEG 参考单价（合约域单一来源）非本单实际成交价；affected_orders 不带逐单成交价，故只能给估算",
};

/**
 * WO-ORDER-ROW-DETAIL ① 订单行内详情体。
 * **只摊开本次响应真有的字段**（R14 零写死 · 缺数诚实）：
 *   · `due` 完整日期（列上被 `slice(5)` 截成月-日，这里给全）
 *   · `risks[]` **全量**（列上被 CHIP_LIMIT 截断 + 折叠成「+N」，这里一条不落，且每条把 peak/threshold/series 摊开）
 *   · 逐单营收暴露 = qty × SEG 参考单价（估算口径，挂 <Provenance> 明示非成交价）
 * 响应没带回的（逐单成交价/毛利/齐套缺口/信用占用）→ 底部诚实披露，**不臆造、不另调接口**。
 */
function OrderRowDetail({ row, segPrice, picked }: { row: AffectedOrderRowVM; segPrice: number | undefined; picked: boolean }) {
  const revenueYi = segPrice != null ? (row.qty * segPrice) / 1e4 : null;
  return (
    <InlineDetailPanel
      title={zh.orderChain.rowDetailTitle(row.so)}
      actions={
        picked ? (
          <span className={`${styles.chip} ${styles.ctxBtnOn}`} data-testid={`oc-detail-ctx-${row.so}`}>
            {zh.orderChain.ctxInBadge}
          </span>
        ) : null
      }
    >
      <div className={styles.inlineGrid}>
        {/* 列上是 due.slice(5)（只有月-日）；详情给完整日期——这才是"比列多"的部分 */}
        <InlineField label={zh.orderChain.rowDetailDue} testId={`oc-detail-due-${row.so}`}>
          <b className="mono">{row.due}</b>
        </InlineField>
        <InlineField label={zh.orderChain.colDelay} testId={`oc-detail-delay-${row.so}`}>
          <b className="mono">{zh.orderChain.delayDays(row.delay)}</b>
        </InlineField>
        <InlineField label={zh.orderChain.rowRevenueLabel} testId={`oc-detail-rev-${row.so}`}>
          {revenueYi != null ? (
            <Provenance testId={`row-rev-${row.so}`} src={ROW_ECON_PROV.src} formula={ROW_ECON_PROV.formula} inputs={ROW_ECON_PROV.inputs} note={ROW_ECON_PROV.note}>
              <b className="mono">{fmt(revenueYi, 2)}</b>
            </Provenance>
          ) : (
            /* 该细分无参考单价 → 诚实"—"，不拿默认价顶（econ 看板同一诚实口径） */
            <span style={{ color: "var(--muted2)" }}>—</span>
          )}
        </InlineField>
      </div>

      {/* risks 全量：条数以 row.risks.length 为准，**不经 CHIP_LIMIT** */}
      <div className={styles.inlineSubTitle} data-testid={`oc-detail-risks-title-${row.so}`}>
        {zh.orderChain.rowDetailRisksTitle(row.risks.length)}
      </div>
      <table className="cmp" data-testid={`oc-detail-risks-${row.so}`}>
        <thead>
          <tr>
            <th>{zh.orderChain.rowRiskBase}</th>
            <th>{zh.orderChain.rowRiskFactor}</th>
            <th>{zh.orderChain.rowRiskCross}</th>
            <th>{zh.orderChain.rowRiskPeak}</th>
            <th>{zh.orderChain.rowRiskThreshold}</th>
            <th>{zh.orderChain.rowRiskSeries}</th>
          </tr>
        </thead>
        <tbody>
          {row.risks.map((k, i) => (
            <tr key={`${k.base}-${k.factor}-${i}`} data-testid={`oc-detail-risk-${row.so}-${i}`}>
              <td className="zh">{k.base}</td>
              <td className="zh">{k.factor}</td>
              <td className="mono">{k.crossDay != null ? `D+${k.crossDay}` : zh.orderChain.rowRiskNotCrossed}</td>
              {/* WO-UNIT-MEANING：峰值是张力 0–100 指数，一律经 contracts formatTightness 带量纲，不裸数 */}
              <td className="mono">{formatTightness(k.peak)}</td>
              <td className="mono">{k.threshold != null ? formatTightness(k.threshold) : zh.orderChain.rowRiskNoField}</td>
              <td className="mono">{k.series ? zh.orderChain.rowRiskSeriesDays(k.series.length) : zh.orderChain.rowRiskNoField}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.inlineGap} data-testid={`oc-detail-gap-${row.so}`}>
        {zh.orderChain.rowDetailGap}
      </div>
    </InlineDetailPanel>
  );
}

/**
 * 追加需求 · 问题卡归因叙述体：叙述（每句挂 <Provenance> 出处）+ 缺口披露 + **同一份 rootChains 的图形视图**。
 * 图与话同源（都读 group.rootChains），不另调接口、不造第二套因果。
 */
function ProblemNarrativePanel({ group, categoryLabel }: { group: OrderProblemGroup; categoryLabel: string }) {
  const { lines, gaps } = deriveProblemNarrative(group, categoryLabel);
  return (
    <InlineDetailPanel title={`${group.title} · ${zh.orderChain.narrTitle}`}>
      <div data-testid={`oc-narr-${group.category}`}>
        {lines.map((l) => (
          <div key={l.key} className={styles.narrLine}>
            {/* 每句旁挂溯源（六要素弹窗）——禁止原生 title=，出处必须点得开看得见 */}
            <Provenance testId={`narr-${group.category}-${l.key}`} src={zh.orderChain.narrProvSrc} formula={l.formula} inputs={l.inputs} note={l.note}>
              <span data-testid={`oc-narr-line-${group.category}-${l.key}`}>{l.text}</span>
            </Provenance>
          </div>
        ))}
      </div>
      {/* 推不出的部分：明说缺什么字段，绝不用通顺空话补齐 */}
      {gaps.length > 0 && (
        <div className={styles.inlineGap} data-testid={`oc-narr-gaps-${group.category}`}>
          <b>{zh.orderChain.narrGapTitle}</b>
          {gaps.map((g, i) => (
            <div key={i} data-testid={`oc-narr-gap-${group.category}-${i}`}>
              · {g}
            </div>
          ))}
        </div>
      )}
      <div className={simStyles.noteInfo} data-testid={`oc-narr-scope-${group.category}`}>
        {zh.orderChain.narrScopeNote}
      </div>
      <div className={styles.inlineSubTitle}>{zh.orderChain.narrDagTitle}</div>
      <ProblemDag group={group} />
    </InlineDetailPanel>
  );
}

/** 订单全链聚合（renderer=order-chain，§7.16）：affected_orders 扩展输出消费面 */
export default function OrderChainView({ view }: ViewRendererProps) {
  // 去电池锁死 8a（R14）：问题分类标签 + 产品段配色由 ViewConfig.layout 声明，常量仅兜底
  const categoryLabels = (view.layout?.categoryLabels as Record<string, string> | undefined) ?? CATEGORY_LABEL;
  const segColors = (view.layout?.segColors as Record<string, string> | undefined) ?? SEG_COLOR;
  const [baseFilter, setBaseFilter] = useState<string>("");
  /** 追加需求：问题卡改**行内展开**（叙述 + 同源因果图），不再弹浮层——按 category 键（组内唯一）。 */
  const [openProblemCat, setOpenProblemCat] = useState<string | null>(null);
  /** WO-ORDER-ROW-DETAIL ①：当前展开详情的订单号（展开体渲染在该行紧邻下方）。 */
  const [openSo, setOpenSo] = useState<string | null>(null);
  const [searchParams] = useSearchParams(); // 从驾驶舱问题卡下钻：?problem=<category> 自动展开该类归因
  const [segMode, setSegMode] = useState<"app" | "base">("app"); // econ 看板分组：应用细分 / 风险基地
  const econCfg = (view.layout?.econ as typeof ECON_DEFAULT | undefined) ?? ECON_DEFAULT;
  /**
   * WO-ORDER-ROW-DETAIL ②：对话上下文选中态**订阅式**读取（原实现只 `getState()` 写不读 →
   * 写进去了屏上零反馈，这正是"点了没反应"的另一半）。此处订阅使徽章随 store 实时亮。
   */
  const selectedObjects = useSessionStore((s) => s.selectedObjects);
  const inCtx = (so: string) => selectedObjects.some((o) => o.objectType === "Order" && o.objectId === `ord-${so}`);

  const { data, isLoading } = useQuery({
    queryKey: ["b", "affected-orders", { base: baseFilter }],
    queryFn: async () => {
      const res = await runSolver("affected_orders", baseFilter ? { base: baseFilter } : {});
      return { out: res.data as AffectedOrdersOutputVM, snapshotVersion: res.snapshotVersion };
    },
  });
  // 全量基地清单（筛选器选项固定，不随过滤结果收窄）
  const { data: allData } = useQuery({
    queryKey: ["b", "affected-orders", { base: "" }],
    queryFn: async () => {
      const res = await runSolver("affected_orders", {});
      return { out: res.data as AffectedOrdersOutputVM, snapshotVersion: res.snapshotVersion };
    },
  });

  const riskBases = useMemo(
    () => [...new Set((allData?.out.rows ?? []).flatMap((r) => r.risks.map((k) => k.base)))],
    [allData],
  );

  // 驾驶舱「待解决问题」卡下钻：?problem=<category> → 数据就绪后自动展开该类归因（叙述 + 同源因果图）。
  const problemQuery = searchParams.get("problem");
  useEffect(() => {
    if (!problemQuery || !data) return;
    const match = data.out.problems.find((p) => p.category === problemQuery);
    if (match) setOpenProblemCat(match.category);
  }, [problemQuery, data]);

  if (isLoading || !data) return <div className="empty-state">{zh.common.loading}</div>;
  const { out, snapshotVersion } = data;

  // 经营数据看板：逐订单 econ 派生 → 按应用细分 / 风险基地聚合。
  // 产能=真订单量；营收/毛利=量×SEG_REGISTRY 参考单价/毛利率（可溯·估算口径·缺 SEG 数诚实 0）；库存无真源→下方诚实"—"。
  const empty = (): EconAgg => ({ cap: 0, sales: 0, gp: 0 });
  const econGroups = new Map<string, { color: string; agg: EconAgg }>();
  const econTotal = empty();
  for (const r of out.rows) {
    const price = econCfg.segPrice[r.seg] ?? 0; // 缺 SEG 参考单价 → 诚实 0（不臆造 0.6）
    // WO-UNIT-NORMALIZE §3：sales(亿) = qty(套) × priceWan(万元/套) / 1e4。
    const sales = (r.qty * price) / 1e4;
    const e: EconAgg = {
      cap: r.qty,
      sales,
      gp: sales * (econCfg.segMargin[r.seg] ?? 0), // 缺 SEG 参考毛利率 → 诚实 0（不臆造 0.13）
    };
    // app 模式按应用细分；base 模式按首个关联风险基地（跨基地订单计入首基地）。
    const key = segMode === "app" ? r.seg : (r.risks[0]?.base?.replace("基地", "").replace("·总部", "") ?? "其他");
    const color = segMode === "app" ? (segColors[r.seg] ?? "#7E8BEE") : "#54B5C4";
    let g = econGroups.get(key);
    if (!g) {
      g = { color, agg: empty() };
      econGroups.set(key, g);
    }
    for (const k of ["cap", "sales", "gp"] as const) {
      g.agg[k] += e[k];
      econTotal[k] += e[k];
    }
  }
  const econRows = [...econGroups.entries()]
    .map(([key, g]) => ({ key, color: g.color, ...g.agg, gmRate: g.agg.sales > 0 ? (g.agg.gp / g.agg.sales) * 100 : 0 }))
    .sort((a, b) => (segMode === "app" ? SEG_ORDER.indexOf(a.key) - SEG_ORDER.indexOf(b.key) : b.sales - a.sales));
  const econGmRate = econTotal.sales > 0 ? (econTotal.gp / econTotal.sales) * 100 : 0;

  return (
    <div data-testid="order-chain-view">
      <div className={simStyles.head}>
        <div>
          <h3>{zh.orderChain.title}</h3>
          <div className={simStyles.sub}>
            交期 + 齐套 + 财务 三关联判：订单分配至风险基地 → 受影响明细与待解决问题归并（affected_orders 求解输出 problems[]）。
            <SnapshotBadge snapshotVersion={snapshotVersion} tool="affected_orders" />
          </div>
        </div>
      </div>

      {/* ORD：订单全链推演（订单中心，order_fullchain 三判 + 统一结论 + 11 节点 DAG）。问题归并作超集保留在下方。 */}
      <OrderFullchainPanel />

      {/* 基地筛选器（下拉 + 清除 chip） */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <label style={{ fontSize: 11.5, color: "var(--muted)" }}>
          {zh.orderChain.baseFilter}
          <select
            value={baseFilter}
            aria-label={zh.orderChain.baseFilter}
            data-testid="oc-base-filter"
            style={{ marginLeft: 8 }}
            onChange={(e) => setBaseFilter(e.target.value)}
          >
            <option value="">{zh.orderChain.allBases(riskBases.length)}</option>
            {riskBases.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        {baseFilter && (
          <button className={styles.chip} style={{ cursor: "pointer", color: "var(--c-capacity)", borderColor: "var(--c-capacity)" }} data-testid="oc-clear-filter" onClick={() => setBaseFilter("")}>
            {zh.orderChain.clearFilter(baseFilter)}
          </button>
        )}
      </div>

      {/* 财务影响汇总条 */}
      <div className={styles.sumBar} data-testid="oc-summary">
        <div className={simStyles.kpi}>
          <b data-testid="oc-sum-orders">{out.summary.orderCount}</b>
          <span>{zh.orderChain.sumOrders}</span>
        </div>
        <div className={simStyles.kpi}>
          {/* 订单全链关键数字（#4 backlog）：受影响量/营收六要素溯源 */}
          <Provenance
            testId="oc-qty"
            src="affected_orders 求解器（订单/物料域）"
            formula="受影响数量 = Σ 分配至风险基地的订单.数量"
            inputs={["受影响订单明细", "订单数量"]}
            note="口径 [T−7, T+14] 时窗内、风险基地命中的订单"
          >
            <b data-testid="oc-sum-qty">{fmt(out.summary.totalQty, 2)}</b>
          </Provenance>
          <span>{zh.orderChain.sumQty}</span>
        </div>
        <div className={simStyles.kpi}>
          <b data-testid="oc-sum-custs">{out.summary.custCount}</b>
          <span>{zh.orderChain.sumCusts}</span>
        </div>
        <div className={simStyles.kpi}>
          <Provenance
            testId="oc-revenue"
            src="affected_orders 求解器（财务域）"
            formula="受影响营收 = Σ 受影响订单(数量 × 单价)"
            inputs={["受影响订单数量", "型号单价（PLM/财务）"]}
            note="头部财务影响：受影响订单的营收暴露合计"
          >
            <b data-testid="oc-sum-revenue">{fmt(out.summary.revenue, 2)}</b>
          </Provenance>
          <span>{zh.orderChain.sumRevenue}</span>
        </div>
      </div>

      {/* 经营数据看板 econTable（PRD-IND-order-aggregate §4.5-A）：产能/库存/在制/原料/营收/毛利按细分聚合 */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{zh.orderChain.econSection}</span>
          <span data-testid="oc-segsel">
            <button
              className={styles.chip}
              style={{ cursor: "pointer", ...(segMode === "app" ? { color: "var(--c-capacity)", borderColor: "var(--c-capacity)" } : {}) }}
              data-testid="oc-segmode-app"
              onClick={() => setSegMode("app")}
            >
              {zh.orderChain.byApp}
            </button>
            <button
              className={styles.chip}
              style={{ cursor: "pointer", marginLeft: 6, ...(segMode === "base" ? { color: "var(--c-capacity)", borderColor: "var(--c-capacity)" } : {}) }}
              data-testid="oc-segmode-base"
              onClick={() => setSegMode("base")}
            >
              {zh.orderChain.byBase}
            </button>
          </span>
        </div>
        <table className="cmp" data-testid="oc-econ-table">
          <thead>
            <tr>
              <th>{segMode === "app" ? zh.orderChain.colSeg : zh.orderChain.colBase}</th>
              <th>{zh.orderChain.econCap}</th>
              <th>{zh.orderChain.econFg}</th>
              <th>{zh.orderChain.econWip}</th>
              <th>{zh.orderChain.econRm}</th>
              <th>{zh.orderChain.econSales}</th>
              <th>{zh.orderChain.econGp}</th>
              <th>{zh.orderChain.econGmRate}</th>
            </tr>
          </thead>
          <tbody>
            {econRows.map((r) => (
              <tr key={r.key} data-testid={`oc-econ-row-${r.key}`}>
                <td>
                  <span className={styles.chip} style={{ color: r.color, borderColor: `${r.color}66` }}>
                    {r.key}
                  </span>
                </td>
                {econCell("cap", r.cap, `cap-${r.key}`)}
                {/* 库存三列平台无该维度真源 → 诚实"—"（抄 OrderAggView·不伪造） */}
                <td className="mono" style={{ color: "var(--muted2)" }} title={zh.orderChain.econNoSource}>—</td>
                <td className="mono" style={{ color: "var(--muted2)" }} title={zh.orderChain.econNoSource}>—</td>
                <td className="mono" style={{ color: "var(--muted2)" }} title={zh.orderChain.econNoSource}>—</td>
                {econCell("sales", r.sales, `sales-${r.key}`)}
                {econCell("gp", r.gp, `gp-${r.key}`)}
                {econCell("gmRate", r.gmRate, `gm-${r.key}`, true)}
              </tr>
            ))}
            <tr data-testid="oc-econ-total" style={{ fontWeight: 700 }}>
              <td>{zh.orderChain.econTotal}</td>
              {econCell("cap", econTotal.cap, "cap-total")}
              <td className="mono" style={{ color: "var(--muted2)" }} title={zh.orderChain.econNoSource}>—</td>
              <td className="mono" style={{ color: "var(--muted2)" }} title={zh.orderChain.econNoSource}>—</td>
              <td className="mono" style={{ color: "var(--muted2)" }} title={zh.orderChain.econNoSource}>—</td>
              {econCell("sales", econTotal.sales, "sales-total")}
              {econCell("gp", econTotal.gp, "gp-total")}
              {econCell("gmRate", econGmRate, "gm-total", true)}
            </tr>
          </tbody>
        </table>
        {/* 假3 披露脚注（抄 OrderAggView）：营收/毛利经 SEG 参考价勾稽（估算口径·可溯）；库存诚实"—"。 */}
        <div className={simStyles.noteInfo} data-testid="oc-econ-footnote">{zh.orderChain.econFootnote}</div>
      </div>

      {/* 受影响订单明细 */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="section-title">
          {zh.orderChain.detailSection}（{baseFilter || "全部风险基地"}）
        </div>
        <table className="cmp" data-testid="oc-detail-table">
          <thead>
            <tr>
              {/* 表头由 DETAIL_COLS 单一来源渲染 —— 展开行 colSpan 现算自同一数组，加列即自动跟随（禁写死） */}
              {DETAIL_COLS.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {out.rows.map((r) => {
              const shown = r.risks.slice(0, CHIP_LIMIT);
              const more = r.risks.length - shown.length;
              const expanded = openSo === r.so;
              const picked = inCtx(r.so);
              return (
                /* Fragment 保证展开行是数据行的**紧邻下一个兄弟**（相对位置即语义，不许挂到表尾） */
                <Fragment key={r.so}>
                  <tr
                    data-testid={`oc-row-${r.so}`}
                    data-expanded={expanded ? "1" : "0"}
                    style={{ cursor: "pointer" }}
                    title={zh.orderChain.rowHint}
                    onClick={() => setOpenSo(expanded ? null : r.so)}
                  >
                    <td>
                      <b>{r.so}</b>
                      {/* ②可见选中态：订单已在对话上下文时，行上直接看得见（此前写进 store 屏上零反馈） */}
                      {picked && (
                        <span className={`${styles.chip} ${styles.ctxBtnOn}`} data-testid={`oc-ctx-badge-${r.so}`} style={{ marginLeft: 6 }}>
                          {zh.orderChain.ctxInBadge}
                        </span>
                      )}
                    </td>
                    <td className="zh">{r.cust}</td>
                    <td>
                      <span className={styles.chip} style={{ color: segColors[r.seg], borderColor: `${segColors[r.seg]}66` }}>
                        {r.seg}
                      </span>
                    </td>
                    <td>{r.model}</td>
                    <td>{fmt(r.qty, 0)} 套</td>
                    <td>
                      <b>{r.due.slice(5)}</b>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className={styles.riskChips}>
                        {shown.map((k, i) => (
                          <RiskHoverTrigger
                            key={i}
                            data={k}
                            className={styles.chip}
                            testId={`oc-risk-chip-${r.so}-${k.base}`}
                            style={{ color: k.peak >= (k.threshold ?? 85) ? "var(--danger)" : "var(--amber)", borderColor: "currentcolor", cursor: "default" }}
                          >
                            {k.base}·{k.factor} {k.crossDay != null ? `D+${k.crossDay}` : "未越线"}
                          </RiskHoverTrigger>
                        ))}
                        {more > 0 && (
                          <span className={styles.chip} data-testid={`oc-risk-more-${r.so}`}>
                            +{more}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ color: "var(--danger)", fontWeight: 700 }}>{zh.orderChain.delayDays(r.delay)}</td>
                    {/* ②显式入口：对话上下文的写入不再藏在整行点击里，行尾给一个说得清自己在干什么的按钮 */}
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className={`${styles.ctxBtn} ${picked ? styles.ctxBtnOn : ""}`}
                        data-testid={`oc-ctx-btn-${r.so}`}
                        aria-pressed={picked}
                        title={zh.orderChain.ctxHint}
                        onClick={() =>
                          // 原链原样保留（objectType/objectId/label 三字段一字未改），只是换到显式入口上
                          useSessionStore.getState().toggleSelectedObject({ objectType: "Order", objectId: `ord-${r.so}`, label: r.so })
                        }
                      >
                        {picked ? zh.orderChain.ctxRemove : zh.orderChain.ctxAdd}
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <InlineDetailRow colSpan={DETAIL_COLS.length} testId={`oc-detail-row-${r.so}`}>
                      <OrderRowDetail row={r} segPrice={econCfg.segPrice[r.seg]} picked={picked} />
                    </InlineDetailRow>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {/* 聚合口径脚注（原样保留） */}
        <div className={simStyles.noteInfo} data-testid="oc-caliber">
          {zh.orderChain.caliber}
        </div>
      </div>

      {/* 待解决问题卡区（4 类归并） */}
      <div className="panel">
        <div className="section-title">{zh.orderChain.problemSection}</div>
        <div className={styles.probGrid} data-testid="oc-problems">
          {out.problems.map((p) => {
            const open = openProblemCat === p.category;
            return (
              /* 与订单行同一套内联展开原语：展开体是被点卡片的**紧邻下一个兄弟**（不再弹浮层） */
              <Fragment key={p.category}>
                <button
                  className={`${styles.probCard} ${open ? styles.probCardOpen : ""}`}
                  data-testid={`oc-problem-${p.category}`}
                  aria-expanded={open}
                  onClick={() => setOpenProblemCat(open ? null : p.category)}
                >
                  <div className={styles.probTitle}>
                    <span className="badge red" style={{ marginRight: 6 }}>
                      {categoryLabels[p.category]}
                    </span>
                    {p.title}
                  </div>
                  <div className={styles.probMeta}>
                    {zh.orderChain.problemOrders(p.orderCount)} · {zh.orderChain.problemFinance(p.financeImpact)}
                    <div className="zh">{p.rootCauseSummary}</div>
                  </div>
                </button>
                {open && (
                  <InlineDetailGridItem testId={`oc-problem-detail-${p.category}`}>
                    <ProblemNarrativePanel group={p} categoryLabel={categoryLabels[p.category] ?? p.category} />
                  </InlineDetailGridItem>
                )}
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* inference-process 横切：订单全链推演的编排过程 DAG */}
      <InferenceProcessPanel testId="inference-order" solved />
    </div>
  );
}

/**
 * ORD 订单全链推演面板（order_fullchain）：订单选择器 → 6 KPI + 统一结论（三色）+ 三判明细 + 11 节点
 * 业务建模链 DAG + 采纳→Action（C10 留痕）。三判由求解器实算，前端零写死（R14）。
 */
type OFC = {
  so: string; verdict: string; vc: string;
  kpis: { qty: number; segment: string; marginPct: number; floorPct: number; deliveryP90: number; kitGap: number };
  judges: { cap: { verdict: string; p50: number; p90: number; demand: number; ruleRefs: string[] }; kit: { verdict: string; material: string; gapTon: number; eta: string; ruleRefs: string[] }; fin: { verdict: string; marginPct: number; floorPct: number; creditUsedRatio: number; priceUpPct: number; ruleRefs: string[] } };
  conds: string[]; dag: { nodes: { id: string; kind: string; label: string }[]; edges: { from: string; to: string }[] }; summary: string;
};
const OFC_LAYER: Record<string, number> = { order: 0, network: 1, bom: 1, economics: 1, credit: 1, judge: 2, verdict: 3 };
const OFC_LAYER_TITLES = ["订单", "建模链", "三关联判", "结论"];
function OrderFullchainPanel() {
  const adopt = useActionDraft();
  const [so, setSo] = useState<string>("");
  const { data: orders } = useQuery({
    queryKey: ["a", "objects", "Order", "ofc-selector"],
    queryFn: () => queryObjectsPaged("Order", 1, 100, {}),
  });
  const soList = useMemo(() => (orders?.items ?? []).map((o) => String(o.props.so)).sort(), [orders]);
  const { data, isLoading } = useQuery({
    queryKey: ["b", "order_fullchain", so],
    queryFn: async () => (await runSolver("order_fullchain", so ? { so } : {})).data as OFC,
  });

  const nodes: DagNodeDef[] = (data?.dag.nodes ?? []).map((n) => ({
    id: n.id, layer: OFC_LAYER[n.kind] ?? 1, label: n.label,
    color: n.kind === "verdict" ? data!.vc : n.kind === "judge" ? "#E8B54A" : n.kind === "order" ? "#7E8BEE" : "#5E8FE8",
  }));
  const edges: DagEdgeDef[] = (data?.dag.edges ?? []).map((e) => ({ from: e.from, to: e.to }));

  return (
    <div className="panel" style={{ marginBottom: 14 }} data-testid="ofc-panel">
      <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        订单全链推演（三关联判 → 统一结论）
        <select data-testid="ofc-so-select" value={so} onChange={(e) => setSo(e.target.value)} style={{ fontSize: 12 }}>
          <option value="">{soList[0] ? `首单 ${soList[0]}` : "首单"}</option>
          {soList.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {isLoading || !data ? (
        <div style={{ color: "var(--muted2)" }}>{zh.common.loading}</div>
      ) : (
        <>
          {/* 6 KPI + 统一结论 */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "6px 0" }}>
            {[
              ["数量×细分", `${data.kpis.qty} · ${data.kpis.segment}`],
              ["交期判", data.judges.cap.verdict],
              ["齐套缺口", `${data.kpis.kitGap} 吨`],
              ["毛利率", `${data.kpis.marginPct}%`],
              ["毛利底线", `${data.kpis.floorPct}%`],
            ].map(([k, v]) => (
              <div key={k} className="panel" style={{ padding: 8, minWidth: 96 }}><div style={{ fontSize: 10.5, color: "var(--muted)" }}>{k}</div><b>{v}</b></div>
            ))}
            <div className="panel" data-testid="ofc-verdict" style={{ padding: 8, minWidth: 120, borderLeft: `3px solid ${data.vc}` }}>
              <div style={{ fontSize: 10.5, color: "var(--muted)" }}>统一结论</div>
              <b style={{ color: data.vc }}>{data.verdict}</b>
            </div>
          </div>
          {data.conds.length > 0 && (
            <ul style={{ fontSize: 11.5, color: "var(--muted)", margin: "2px 0 8px 16px" }} data-testid="ofc-conds">
              {data.conds.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          )}
          {/* 11 节点业务建模链 DAG */}
          <LayeredDag nodes={nodes} edges={edges} layerTitles={OFC_LAYER_TITLES} testId="ofc-dag" />
          {/* 三判明细表 */}
          <table className="cmp" data-testid="ofc-judges" style={{ marginTop: 8 }}>
            <thead><tr><th>关联判</th><th>结论</th><th>关键值</th><th>规则</th></tr></thead>
            <tbody>
              <tr><td>①交期·产能</td><td>{data.judges.cap.verdict}</td><td className="mono">P90 {data.judges.cap.p90} vs 需求 {data.judges.cap.demand}</td><td className="mono">{data.judges.cap.ruleRefs.join("/")}</td></tr>
              <tr><td>②齐套·MRP</td><td>{data.judges.kit.verdict}</td><td className="mono">{data.judges.kit.material} 缺 {data.judges.kit.gapTon} 吨</td><td className="mono">{data.judges.kit.ruleRefs.join("/")}</td></tr>
              <tr><td>③财务·经营</td><td>{data.judges.fin.verdict}</td><td className="mono">毛利 {data.judges.fin.marginPct}% vs 底线 {data.judges.fin.floorPct}%</td><td className="mono">{data.judges.fin.ruleRefs.join("/")}</td></tr>
            </tbody>
          </table>
          <button className="btn sm" data-testid="ofc-adopt" style={{ marginTop: 8 }} disabled={adopt.isPending}
            onClick={() => adopt.mutate({ actionTypeKey: "plan_change", payload: { versionId: `order-chain:${data.so}`, reason: data.summary, so: data.so, verdict: data.verdict } })}>
            采纳结论 → 工单（C10 留痕）
          </button>
        </>
      )}
    </div>
  );
}

/** 逐单根因 DAG（LayeredDag 四层：订单 → 判定 → 根因 → 对策） */
function ProblemDag({ group }: { group: OrderProblemGroup }) {
  const nodes: DagNodeDef[] = [];
  const edges: DagEdgeDef[] = [];
  group.rootChains.forEach((chain, ci) => {
    let prev: string | null = null;
    chain.layers.forEach((layer, li) => {
      const id = `${ci}-${layer.kind}`;
      nodes.push({ id, layer: li, label: layer.label, sub: li > 0 ? chain.orderId : undefined, color: CHAIN_COLORS[li] });
      if (prev) edges.push({ from: prev, to: id });
      prev = id;
    });
  });
  return <LayeredDag nodes={nodes} edges={edges} layerTitles={CHAIN_TITLES} testId="problem-dag" />;
}
