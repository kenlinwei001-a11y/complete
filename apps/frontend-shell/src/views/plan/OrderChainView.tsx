import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { OrderProblemGroup } from "@platform/contracts";
import { SEG_REGISTRY } from "@platform/contracts";
import { runSolver, queryObjectsPaged } from "@/api/endpoints";
import { useSessionStore } from "@/store/sessionStore";
import { RiskHoverTrigger } from "@/components/Risk/RiskPopover";
import { decisionColor, isLiveDecision, decisionVerdictColor, notLiveDecision } from "@/components/DecisionValue";
import { DecisionModeBanner } from "@/components/DecisionModeBanner";
import { LayeredDag, type DagEdgeDef, type DagNodeDef } from "@/components/Dag/LayeredDag";
import { RuleRef } from "@/components/RuleRef";
import { useActionDraft } from "../sim/shared";
import { Modal } from "@/components/ui/Modal";
import { Provenance } from "@/components/Provenance";
import type { AffectedOrdersOutputVM } from "@/api/types";
import type { ViewRendererProps } from "../registry";
import { fmt, SnapshotBadge } from "../sim/shared";
import { InferenceProcessPanel } from "@/components/InferenceProcessPanel";
import { DrillBack } from "@/components/DrillBack";
import zh from "@/locales/zh";
import simStyles from "../sim/SimViews.module.css";
import styles from "./PlanViews.module.css";

// DF.3 单一来源：SEG 配色/价/利从 @platform/contracts SEG_REGISTRY 派生（与 datacore 同源）。
const SEG_COLOR: Record<string, string> = Object.fromEntries(SEG_REGISTRY.map((s) => [s.seg, s.color]));
const CHIP_LIMIT = 4;

// PRD-IND-order-aggregate §4.5-A/C：经营数据看板 econTable 口径（SEG 价/利 + 在制/库存系数）。
// view.layout 优先下发，常量仅兜底（R14）；ordEcon 逐订单派生、按应用细分聚合。
const ECON_DEFAULT = {
  segPrice: Object.fromEntries(SEG_REGISTRY.map((s) => [s.seg, s.priceWan])) as Record<string, number>, // DF.3 单一来源（万元/套）
  segMargin: Object.fromEntries(SEG_REGISTRY.map((s) => [s.seg, s.marginPct / 100])) as Record<string, number>, // DF.3 单一来源（%→分数）
  coef: { fg: [0.22, 0.12], wip: [0.3, 0.15], rm: [0.18, 0.1] }, // debattery-allow：成品/在制/原料占营收系数 [base, hash幅度]
};
const SEG_ORDER = ["乘用车", "商用车", "储能"]; // debattery-allow：econ 看板细分行展示顺序（非业务数值）

interface EconAgg {
  cap: number;
  fg: number;
  wip: number;
  rm: number;
  sales: number;
  gp: number;
}

/** 问题类别 → 中文。轨R #1：母版 ROOT_LIB 8 根源 + 旧 4 类向后兼容。 */
const CATEGORY_LABEL: Partial<Record<OrderProblemGroup["category"], string>> = {
  credit: "信用", cost: "成本", frame: "框架", crm: "合同", lta: "长协", maint: "维护", ramp: "爬坡", push: "排产",
  DELIVERY: "交期", MARGIN: "毛利", KIT: "齐套", CREDIT: "信用",
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
  // 轨M 增量1（假3 复审修·RL5）：库存占营收系数从后端 view.layout.econ 下发（换租户=换配置），
  // 不再用前端写死的 ECON_DEFAULT.coef；segPrice/segMargin 仍取 SEG_REGISTRY 契约单一来源（真价/利）。
  const deliveredEcon = view.layout?.econ as { coef?: typeof ECON_DEFAULT.coef; assumed?: boolean; note?: string } | undefined;
  const econCfg = { ...ECON_DEFAULT, coef: deliveredEcon?.coef ?? ECON_DEFAULT.coef };
  // 库存系数是否为后端下发的固定假设（assumed）+ 披露文案（无下发则前端兜底·明标）。
  const econNote = deliveredEcon?.note ?? "成品库存/在制/原料 = 营收 × 行业占比固定假设（无实测库存数据，前端兜底系数）";

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
  // WO-DATAMODE-SWEEP（KILL-MOCK-RED 漏网点）：affected_orders 显式非 LIVE（合成/估算）时，待解决问题卡红标 + 延误红降级为中性灰。
  const ocNotLive = notLiveDecision(out.dataMode);

  // 经营数据看板：逐订单 econ 派生 → 按应用细分 / 风险基地聚合（前端纯派生，零写死值来自 econCfg）。
  const empty = (): EconAgg => ({ cap: 0, fg: 0, wip: 0, rm: 0, sales: 0, gp: 0 });
  const econGroups = new Map<string, { color: string; agg: EconAgg }>();
  const econTotal = empty();
  for (const r of out.rows) {
    const price = econCfg.segPrice[r.seg] ?? 0.6;
    const sales = r.qty * price;
    // 轨M 增量1（假3 真推演红线）：营收/毛利=真算（真细分单价/毛利率 SEG_REGISTRY）。
    // 成品库存/在制/原料无实测库存数据 → 营收×行业占比固定系数的**透明估算**（去掉 hashN 现编的假精度），
    // 表头诚实标"估算（营收×行业占比·无实测库存）"——绝不裸渲染成与真算无差别。
    const e: EconAgg = {
      cap: r.qty,
      sales,
      gp: sales * (econCfg.segMargin[r.seg] ?? 0.13),
      fg: sales * econCfg.coef.fg[0]!,
      wip: sales * econCfg.coef.wip[0]!,
      rm: sales * econCfg.coef.rm[0]!,
    };
    // app 模式按应用细分；base 模式按首个关联风险基地（跨基地订单计入首基地）。
    const key = segMode === "app" ? r.seg : (r.risks[0]?.base?.replace("基地", "").replace("·总部", "") ?? "其他");
    const color = segMode === "app" ? (segColors[r.seg] ?? "#7E8BEE") : "#54B5C4";
    let g = econGroups.get(key);
    if (!g) {
      g = { color, agg: empty() };
      econGroups.set(key, g);
    }
    for (const k of ["cap", "fg", "wip", "rm", "sales", "gp"] as const) {
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
      {/* 轨N 增量1·N-D1/D2/D3：下钻面包屑 + 返回——从驾驶舱台账/问题卡/事件卡进得来也回得去（去死路）。
          R17：迁到统一 DrillBack 组件（行为不变 + idx 兜底直链落地更稳）；testId 沿用 order-chain-back。 */}
      <DrillBack
        testId="order-chain-back"
        fallbackTo="/v/dash"
        trail={[{ label: "经营驾驶舱", to: "/v/dash" }, { label: "订单全链聚合" }]}
      />
      <div className={simStyles.head}>
        <div>
          <h3>{zh.orderChain.title}</h3>
          <div className={simStyles.sub}>
            交期 + 齐套 + 财务 三关联判：订单分配至风险基地 → 受影响明细与待解决问题归并（affected_orders 求解输出 problems[]）。
            <SnapshotBadge snapshotVersion={snapshotVersion} tool="affected_orders" />
          </div>
        </div>
      </div>

      {/* WO-DATAMODE-SWEEP：affected_orders 合成/估算披露横幅——非 LIVE 时问题卡红标/延误红降级为中性灰 + 顶部诚实标。 */}
      <DecisionModeBanner dataMode={out.dataMode} testId="oc-datamode-banner" note="受影响订单/待解决问题裁决由合成订单基线推演，接入真实订单数据后转真实裁决" />

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
              {/* 轨M 增量1（假3）：成品库存/在制/原料无实测库存数据 → 营收×行业占比估算，表头诚实标"估算"。 */}
              <th title={`${econNote}（营收×${Math.round(econCfg.coef.fg[0]! * 100)}%）`}>{zh.orderChain.econFg}<sup data-testid="econ-est-fg" style={{ color: "var(--warn,#caa23a)", fontSize: 9 }}> 估算·{Math.round(econCfg.coef.fg[0]! * 100)}%</sup></th>
              <th title={`${econNote}（营收×${Math.round(econCfg.coef.wip[0]! * 100)}%）`}>{zh.orderChain.econWip}<sup style={{ color: "var(--warn,#caa23a)", fontSize: 9 }}> 估算·{Math.round(econCfg.coef.wip[0]! * 100)}%</sup></th>
              <th title={`${econNote}（营收×${Math.round(econCfg.coef.rm[0]! * 100)}%）`}>{zh.orderChain.econRm}<sup style={{ color: "var(--warn,#caa23a)", fontSize: 9 }}> 估算·{Math.round(econCfg.coef.rm[0]! * 100)}%</sup></th>
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
                <td>{fmt(r.cap, 1)}</td>
                <td>{fmt(r.fg, 1)}</td>
                <td>{fmt(r.wip, 1)}</td>
                <td>{fmt(r.rm, 1)}</td>
                <td>{fmt(r.sales, 1)}</td>
                <td>{fmt(r.gp, 1)}</td>
                <td>{fmt(r.gmRate, 1)}%</td>
              </tr>
            ))}
            <tr data-testid="oc-econ-total" style={{ fontWeight: 700 }}>
              <td>{zh.orderChain.econTotal}</td>
              <td>{fmt(econTotal.cap, 1)}</td>
              <td>{fmt(econTotal.fg, 1)}</td>
              <td>{fmt(econTotal.wip, 1)}</td>
              <td>{fmt(econTotal.rm, 1)}</td>
              <td>{fmt(econTotal.sales, 1)}</td>
              <td>{fmt(econTotal.gp, 1)}</td>
              <td>{fmt(econGmRate, 1)}%</td>
            </tr>
          </tbody>
        </table>
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
                  <td>{fmt(r.qty, 2)} 万套</td>
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
                          // WO-KILL-MOCK-RED 治本：非 LIVE / 无真峰值 → 灰（不出红越线 chip）；仅真数据出决策色。
                          style={{ color: decisionColor(k.peak, k.threshold ?? 85, k.dataMode, { calm: "var(--amber)", warn: "var(--amber)" }), borderColor: "currentcolor", cursor: "default" }}
                        >
                          {k.base}·{k.factor} {isLiveDecision(k.dataMode) && k.crossDay != null ? `D+${k.crossDay}` : "未越线"}
                        </RiskHoverTrigger>
                      ))}
                      {more > 0 && (
                        <span className={styles.chip} data-testid={`oc-risk-more-${r.so}`}>
                          +{more}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ color: decisionVerdictColor("var(--danger)", out.dataMode), fontWeight: 700 }}>{zh.orderChain.delayDays(r.delay)}</td>
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
            <button key={p.category} className={styles.probCard} data-testid={`oc-problem-${p.category}`} onClick={() => setOpenProblem(p)}
              /* WO-DATAMODE-SWEEP（FIX·补漏）：合成/估算（非 LIVE）时问题卡决策红左边框降级中性——8 张「N单受影响·财务X亿」红卡在合成数据上=合成充真。 */
              style={ocNotLive ? { borderLeftColor: "var(--muted2)" } : undefined}>
              <div className={styles.probTitle}>
                <span className={ocNotLive ? "badge" : "badge red"} style={{ marginRight: 6, ...(ocNotLive ? { color: "var(--muted)" } : {}) }}>
                  {categoryLabels[p.category] ?? p.category}
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

/**
 * ORD 订单全链推演面板（order_fullchain）：订单选择器 → 6 KPI + 统一结论（三色）+ 三判明细 + 11 节点
 * 业务建模链 DAG + 采纳→Action（C10 留痕）。三判由求解器实算，前端零写死（R14）。
 */
type OFC = {
  so: string; verdict: string; vc: string;
  kpis: { qty: number; segment: string; marginPct: number; floorPct: number; deliveryP90: number; kitGap: number };
  judges: { cap: { verdict: string; p50: number; p90: number; demand: number; ruleRefs: string[] }; kit: { verdict: string; material: string; gapTon: number; eta: string; ruleRefs: string[] }; fin: { verdict: string; marginPct: number; floorPct: number; creditUsedRatio: number; priceUpPct: number; ruleRefs: string[] } };
  conds: string[]; dag: { nodes: { id: string; kind: string; label: string }[]; edges: { from: string; to: string }[] }; summary: string;
  dataMode?: string | null;
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

  // WO-DATAMODE-SWEEP：合成/估算（非 LIVE）时统一结论（不建议接/信用阻断）裁决色降级为中性灰。
  const ofcVerdictColor = decisionVerdictColor(data?.vc ?? "var(--txt)", data?.dataMode, "var(--muted)");
  const nodes: DagNodeDef[] = (data?.dag.nodes ?? []).map((n) => ({
    id: n.id, layer: OFC_LAYER[n.kind] ?? 1, label: n.label,
    color: n.kind === "verdict" ? ofcVerdictColor : n.kind === "judge" ? "#E8B54A" : n.kind === "order" ? "#7E8BEE" : "#5E8FE8",
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
          {/* WO-DATAMODE-SWEEP：合成/估算披露横幅——非 LIVE 时统一结论裁决色降级为中性灰 + 诚实标。 */}
          <DecisionModeBanner dataMode={data.dataMode} testId="ofc-datamode-banner" note="订单三关联判（交期/齐套/财务）由合成订单基线推演，接入真实订单/信用数据后转真实裁决" />
          {/* 6 KPI + 统一结论（轨N 跟进2·KPI 裸数字接 Provenance：逐卡悬浮出 来源/公式/输入/规则，接 order_fullchain 真值）。 */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "6px 0" }}>
            {([
              ["数量×细分", `${data.kpis.qty} · ${data.kpis.segment}`, { formula: "订单数量 × 应用细分（按客户名判定）", inputs: ["Order.qty", "客户→细分映射"], rule: undefined }],
              ["交期判", data.judges.cap.verdict, { formula: "产能周曲线 P90 vs 需求量 → 可达/不可达", inputs: ["可产基地节拍×OEE×良率", "订单需求量"], rule: data.judges.cap.ruleRefs.join("/") }],
              ["齐套缺口", `${data.kpis.kitGap} 吨`, { formula: "净需求 − 长协覆盖 − 现货", inputs: ["MaterialBalance 净需求", "长协覆盖", "现货库存"], rule: data.judges.kit.ruleRefs.join("/") }],
              ["毛利率", `${data.kpis.marginPct}%`, { formula: "细分毛利率（SEG_REGISTRY 单一来源）", inputs: ["应用细分", "SEG 毛利率"], rule: data.judges.fin.ruleRefs.join("/") }],
              ["毛利底线", `${data.kpis.floorPct}%`, { formula: "细分毛利底线（财务计划基线）", inputs: ["应用细分", "毛利底线"], rule: data.judges.fin.ruleRefs.join("/") }],
            ] as [string, string, { formula: string; inputs: string[]; rule?: string }][]).map(([k, v, prov]) => (
              <div key={k} className="panel" style={{ padding: 8, minWidth: 96 }}>
                <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{k}</div>
                <Provenance testId={`ofc-kpi-${k}`} src="order_fullchain 求解器（订单全链推演）" formula={prov.formula} inputs={prov.inputs} rule={prov.rule}>
                  <b>{v}</b>
                </Provenance>
              </div>
            ))}
            <div className="panel" data-testid="ofc-verdict" style={{ padding: 8, minWidth: 120, borderLeft: `3px solid ${ofcVerdictColor}` }}>
              <div style={{ fontSize: 10.5, color: "var(--muted)" }}>统一结论</div>
              <b style={{ color: ofcVerdictColor }}>{data.verdict}</b>
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
              {/* 轨N 增量1·N-R1：规则号接 RuleRef（悬浮出定义/阈值/作用域/版本）·N-N1：关键值接 Provenance（接 order_fullchain 真值）。 */}
              <tr>
                <td>①交期·产能</td><td>{data.judges.cap.verdict}</td>
                <td className="mono">
                  <Provenance testId="ofc-judge-cap" src="order_fullchain 求解器 · 交期产能判（Order×Model 可产基地周曲线）" formula="P90 = 产能周曲线 90 分位累计；vs 需求量" inputs={["可产基地节拍×OEE×良率", "爬坡曲线+检修窗", "订单需求量"]} rule={data.judges.cap.ruleRefs.join("/")}>
                    P90 {data.judges.cap.p90} vs 需求 {data.judges.cap.demand}
                  </Provenance>
                </td>
                <td className="mono">{data.judges.cap.ruleRefs.length > 0 ? <RuleRef code={data.judges.cap.ruleRefs.join("/")} /> : "—"}</td>
              </tr>
              <tr>
                <td>②齐套·MRP</td><td>{data.judges.kit.verdict}</td>
                <td className="mono">
                  <Provenance testId="ofc-judge-kit" src="order_fullchain 求解器 · 齐套 MRP 判（MaterialBalance 净需求）" formula="缺口吨 = 净需求 − 长协覆盖 − 现货" inputs={["关键物料净需求", "长协覆盖", "现货库存", "在途 ETA"]} rule={data.judges.kit.ruleRefs.join("/")}>
                    {data.judges.kit.material} 缺 {data.judges.kit.gapTon} 吨
                  </Provenance>
                </td>
                <td className="mono">{data.judges.kit.ruleRefs.length > 0 ? <RuleRef code={data.judges.kit.ruleRefs.join("/")} /> : "—"}</td>
              </tr>
              <tr>
                <td>③财务·经营</td><td>{data.judges.fin.verdict}</td>
                <td className="mono">
                  <Provenance testId="ofc-judge-fin" src="order_fullchain 求解器 · 财务三闸（毛利/信用/价）" formula="细分毛利率 vs 底线；信用占用比；提价% = 达底线所需" inputs={["细分毛利率（SEG_REGISTRY）", "毛利底线", "客户信用占用比"]} rule={data.judges.fin.ruleRefs.join("/")}>
                    毛利 {data.judges.fin.marginPct}% vs 底线 {data.judges.fin.floorPct}%
                  </Provenance>
                </td>
                <td className="mono">{data.judges.fin.ruleRefs.length > 0 ? <RuleRef code={data.judges.fin.ruleRefs.join("/")} /> : "—"}</td>
              </tr>
            </tbody>
          </table>
          <button className="btn sm" data-testid="ofc-adopt" style={{ marginTop: 8 }} disabled={adopt.isPending}
            onClick={() => adopt.mutate({ actionTypeKey: "plan_change", payload: { so: data.so, verdict: data.verdict, reason: data.summary } })}>
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
