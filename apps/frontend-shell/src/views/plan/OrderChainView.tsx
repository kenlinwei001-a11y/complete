import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OrderProblemGroup } from "@platform/contracts";
import { runSolver, queryObjectsPaged } from "@/api/endpoints";
import { useSessionStore } from "@/store/sessionStore";
import { RiskHoverTrigger } from "@/components/Risk/RiskPopover";
import { LayeredDag, type DagEdgeDef, type DagNodeDef } from "@/components/Dag/LayeredDag";
import { useActionDraft } from "../sim/shared";
import { Modal } from "@/components/ui/Modal";
import { Provenance } from "@/components/Provenance";
import type { AffectedOrdersOutputVM } from "@/api/types";
import type { ViewRendererProps } from "../registry";
import { fmt, SnapshotBadge } from "../sim/shared";
import { InferenceProcessPanel } from "@/components/InferenceProcessPanel";
import zh from "@/locales/zh";
import simStyles from "../sim/SimViews.module.css";
import styles from "./PlanViews.module.css";

const SEG_COLOR: Record<string, string> = { 乘用车: "#5E8FE8", 商用车: "#DD9551", 储能: "#36BFA5" }; // debattery-allow：view.layout.segColors 缺失兜底（纯配色映射）
const CHIP_LIMIT = 4;

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

  if (isLoading || !data) return <div className="empty-state">{zh.common.loading}</div>;
  const { out, snapshotVersion } = data;

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
