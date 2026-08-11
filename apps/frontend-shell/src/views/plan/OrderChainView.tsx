import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { OrderProblemGroup } from "@platform/contracts";
import { SEG_REGISTRY } from "@platform/contracts";
import { runSolver, queryObjectsPaged } from "@/api/endpoints";
import { useSessionStore } from "@/store/sessionStore";
import { RiskHoverTrigger } from "@/components/Risk/RiskPopover";
import { LayeredDag, type DagEdgeDef, type DagNodeDef } from "@/components/Dag/LayeredDag";
import { useActionDraft } from "../sim/shared";
import { Modal } from "@/components/ui/Modal";
import { Provenance } from "@/components/Provenance";
import type { AffectedOrdersOutputVM } from "@/api/types";
import type { ViewRendererProps } from "../registry";
// WO-SCOPE-HONESTY-FE：三个求解器共用的「这次算的是谁」唯一实现（不在本页另做一套）。
import { KitScopeBar, QuoteScopeBar, type KitScopeVM, type QuoteScopeVM } from "../ScopeHonesty";
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

/** 订单全链聚合（renderer=order-chain，§7.16）：affected_orders 扩展输出消费面 */
export default function OrderChainView({ view }: ViewRendererProps) {
  // 去电池锁死 8a（R14）：问题分类标签 + 产品段配色由 ViewConfig.layout 声明，常量仅兜底
  const categoryLabels = (view.layout?.categoryLabels as Record<string, string> | undefined) ?? CATEGORY_LABEL;
  const segColors = (view.layout?.segColors as Record<string, string> | undefined) ?? SEG_COLOR;
  const [baseFilter, setBaseFilter] = useState<string>("");
  const [openProblem, setOpenProblem] = useState<OrderProblemGroup | null>(null);
  const [searchParams] = useSearchParams(); // 从驾驶舱问题卡下钻：?problem=<category> 自动展开根因 DAG
  const [segMode, setSegMode] = useState<"app" | "base">("app"); // econ 看板分组：应用细分 / 风险基地
  const econCfg = (view.layout?.econ as typeof ECON_DEFAULT | undefined) ?? ECON_DEFAULT;

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

  // 驾驶舱「待解决问题」卡下钻：?problem=<category> → 数据就绪后自动展开该类逐单根因 DAG。
  const problemQuery = searchParams.get("problem");
  useEffect(() => {
    if (!problemQuery || !data) return;
    const match = data.out.problems.find((p) => p.category === problemQuery);
    if (match) setOpenProblem(match);
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

      {/*
        WO-SCOPE-HONESTY-FE ②③ · 齐套 / 报价毛利的**作用域诚实位消费页**。
        接线前 `kit_readiness` 与 `quote_margin` 在整个前端**零调用方**（`grep -rn` 全 src 各 1 处 / 0 处，
        金丝雀 `risk_timeline` 同命令命中 5 个文件 ⇒ 工具是好的、结论是真的）——
        引擎半算出来的诚实位没有任何一块屏幕在读。挂在本页是因为它就是「订单 × 基地」的落点：
        上面那个基地筛选器**同一个值**驱动 `affected_orders` 与 `kit_readiness`，
        于是「换基地 → 齐套口径真变」在同一屏上当场可核。
      */}
      <KitQuoteScopePanel baseFilter={baseFilter} rows={allData?.out.rows ?? []} />

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
              <th>{zh.orderChain.colOrder}</th>
              <th>{zh.orderChain.colCust}</th>
              <th>{zh.orderChain.colSeg}</th>
              <th>{zh.orderChain.colModel}</th>
              <th>{zh.orderChain.colQty}</th>
              <th>{zh.orderChain.colDue}</th>
              <th>{zh.orderChain.colRisks}</th>
              <th>{zh.orderChain.colDelay}</th>
            </tr>
          </thead>
          <tbody>
            {out.rows.map((r) => {
              const shown = r.risks.slice(0, CHIP_LIMIT);
              const more = r.risks.length - shown.length;
              return (
                <tr
                  key={r.so}
                  data-testid={`oc-row-${r.so}`}
                  style={{ cursor: "pointer" }}
                  onClick={() =>
                    // 行点击 → 订单写入 selectedObjects（对话上下文）
                    useSessionStore.getState().toggleSelectedObject({ objectType: "Order", objectId: `ord-${r.so}`, label: r.so })
                  }
                >
                  <td>
                    <b>{r.so}</b>
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
                </tr>
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
          {out.problems.map((p) => (
            <button key={p.category} className={styles.probCard} data-testid={`oc-problem-${p.category}`} onClick={() => setOpenProblem(p)}>
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
          ))}
        </div>
      </div>

      {openProblem && (
        <Modal title={`${openProblem.title} · ${zh.orderChain.dagTitle}`} onClose={() => setOpenProblem(null)} width={860}>
          <ProblemDag group={openProblem} />
        </Modal>
      )}
      {/* inference-process 横切：订单全链推演的编排过程 DAG */}
      <InferenceProcessPanel testId="inference-order" solved />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * WO-SCOPE-HONESTY-FE ②③ · 齐套 / 报价毛利 —— 作用域诚实位的消费面
 *
 * 「这次算的是谁」这件事，`kit_readiness` 与 `quote_margin` 的回包里都写着，
 * 但接线前**没有任何一块屏幕在读**。两个求解器在这里各自的病灶不同，故**分开写、分开说**：
 *
 *  · `kit_readiness` —— 基地维**真接线**（换基地 → 订单池真收窄 → 答案真变）。
 *    危险的是**抽样**：引擎固定只取订单池前 8 张，此前完全隐形 ⇒ 用户会把 `shortageCount=8`
 *    读成「共 8 张缺料单」，而它其实是「抽样的 8 张里 8 张缺料」。故 `orderPoolTotal` /
 *    `sampled` **必须在第一层**（它们不是解释，是这个数的量纲）。
 *
 *  · `quote_margin` —— 型号维**真接线**，客户维**今天真的没有**（price/mfgRate/logistics/
 *    segmentFloor 四项全是引擎写死常数，`Customer` 上无报价、无细分底线字段）。
 *    ⚠ 所以这里**不许**把客户名旁边那个 margin 画成"按这个客户算出来的"：
 *    后端门里有一条**反向**断言 —— 换客户 margin 必须**不变**、但必须标 `NOT_APPLIED`。
 *    假装它生效，和默默忽略它，是同一种错的两个方向。
 * ════════════════════════════════════════════════════════════════════════ */

/** 求解器回包（只取本面板要渲的字段；两者契约包里都还没有 output schema，故为视图侧只读类型）。 */
type KitOut = { rows?: { orderId: string; kitRatio: number }[]; shortageCount?: number; scope?: KitScopeVM };
type QuoteOut = { price?: number; bomCost?: number; cost?: number; margin?: number; segmentFloor?: number; verdict?: string; scope?: QuoteScopeVM };

/** 错误信封 → 人话（400 AMBIGUOUS_SCOPE 是**诚实拒答**，不是页面坏了，必须显式说出来）。 */
function solverErrText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m;
}

function KitQuoteScopePanel({ baseFilter, rows }: { baseFilter: string; rows: { model: string; cust: string }[] }) {
  // 型号 / 客户候选集**真取自订单明细响应**（R14 零写死）——不在前端另拍一张型号表。
  const models = useMemo(() => [...new Set(rows.map((r) => r.model).filter(Boolean))].sort(), [rows]);
  const custs = useMemo(() => [...new Set(rows.map((r) => r.cust).filter(Boolean))].sort(), [rows]);
  const [modelId, setModelId] = useState("");
  const [custName, setCustName] = useState("");

  // 基地筛选器**同一个值**驱动齐套：换基地 → args.base 变 → queryKey 变 → 真重调 → scope 真变。
  const kit = useQuery({
    queryKey: ["b", "kit_readiness", { base: baseFilter }],
    queryFn: async () => (await runSolver("kit_readiness", baseFilter ? { base: baseFilter } : {})).data as KitOut,
    retry: false,
  });
  const quote = useQuery({
    queryKey: ["b", "quote_margin", { modelId, custName }],
    queryFn: async () =>
      (await runSolver("quote_margin", { ...(modelId ? { modelId } : {}), ...(custName ? { custName } : {}) })).data as QuoteOut,
    retry: false,
  });

  return (
    <div className="panel" style={{ marginBottom: 14 }} data-testid="oc-scope-panel">
      <div className="section-title">{zh.orderChain.scopeSection}</div>

      {/* ── ② 齐套：口径 + 抽样两数 + shortageCount 的读法 ───────────────────── */}
      <div style={{ marginBottom: 10 }} data-testid="oc-kit-block">
        <div style={{ fontSize: 12, marginBottom: 2 }}>{zh.orderChain.kitTitle}</div>
        {kit.isError ? (
          <div data-testid="oc-kit-error" style={{ fontSize: 11.5, color: "#E0626C" }}>{solverErrText(kit.error)}</div>
        ) : kit.data === undefined ? (
          <div style={{ fontSize: 11.5, color: "var(--muted2)" }}>{zh.common.loading}</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              {/* 第一层最大的那一级只给「本页要回答的那个数」——缺料单数（R-UI-2）。 */}
              <b className="mono" data-testid="oc-kit-shortage" style={{ fontSize: 20 }}>{kit.data.shortageCount ?? "—"}</b>
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{zh.orderChain.kitShortageLabel}</span>
            </div>
            <KitScopeBar scope={kit.data.scope} shortageCount={kit.data.shortageCount} testId="oc-kit-scope" />
          </>
        )}
      </div>

      {/* ── ③ 报价毛利：型号维生效 / 客户维不生效 ─────────────────────────────── */}
      <div data-testid="oc-quote-block">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, marginBottom: 2 }}>
          <span>{zh.orderChain.quoteTitle}</span>
          <select data-testid="oc-quote-model" aria-label={zh.orderChain.quoteModelSel} value={modelId} onChange={(e) => setModelId(e.target.value)} style={{ fontSize: 11.5 }}>
            <option value="">{zh.orderChain.quoteModelAny}</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select data-testid="oc-quote-cust" aria-label={zh.orderChain.quoteCustSel} value={custName} onChange={(e) => setCustName(e.target.value)} style={{ fontSize: 11.5 }}>
            <option value="">{zh.orderChain.quoteCustAny}</option>
            {custs.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {quote.isError ? (
          <div data-testid="oc-quote-error" style={{ fontSize: 11.5, color: "#E0626C" }}>{solverErrText(quote.error)}</div>
        ) : quote.data === undefined ? (
          <div style={{ fontSize: 11.5, color: "var(--muted2)" }}>{zh.common.loading}</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <b className="mono" data-testid="oc-quote-margin" style={{ fontSize: 20 }}>
                {quote.data.margin === undefined ? "—" : `${(quote.data.margin * 100).toFixed(2)}%`}
              </b>
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{zh.orderChain.quoteMarginLabel}</span>
              <span className="mono" style={{ fontSize: 11.5 }} data-testid="oc-quote-verdict">{quote.data.verdict ?? "—"}</span>
            </div>
            <QuoteScopeBar scope={quote.data.scope} testId="oc-quote-scope" />
          </>
        )}
      </div>
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
